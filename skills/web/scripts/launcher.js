'use strict';
// A double-clickable OS launcher for a board's kanban-web server, so
// restarting an already-visited board costs no tokens. All logic lives here;
// the per-OS file it writes is a thin wrapper that just calls back into this
// script's `run` subcommand with absolute paths.
//
//   node launcher.js write <kanban-dir>   — run by the skill after a start.
//   node launcher.js run   <kanban-dir>   — what the wrapper calls. Never run
//                                           by an agent.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');
const cs = require('./card-store');
const cfg = require('./config-store');

// ---------------------------------------------------------------------------
// Pure helpers — no fs/network/process I/O below this line until noted.
// ---------------------------------------------------------------------------

function osWrapperExt(platform) {
  if (platform === 'win32') return '.cmd';
  if (platform === 'darwin') return '.command';
  return '.sh';
}

function wrapperFileName(baseName, platform) {
  return baseName + osWrapperExt(platform);
}

function pidFileName(baseName) {
  return `${baseName}.pid`;
}

// The marker every wrapper carries so a future `write` can tell which board
// it already serves without trusting the filename alone.
function markerLine(boardDirAbs) {
  return `kanban-web-board: ${boardDirAbs}`;
}

function markerCommentLine(platform, boardDirAbs) {
  const line = markerLine(boardDirAbs);
  return platform === 'win32' ? `rem ${line}` : `# ${line}`;
}

const MARKER_RE = /kanban-web-board:\s*(.+?)\s*$/m;
function parseMarkerBoardDir(text) {
  const m = MARKER_RE.exec(String(text || ''));
  return m ? m[1] : null;
}

// Case-insensitive on Windows (the one platform whose filesystem is), exact
// elsewhere. `platform` is a parameter (default process.platform) so this
// stays testable independent of the host running the tests.
function sameBoardDir(a, b, platform = process.platform) {
  if (a == null || b == null) return false;
  const na = path.resolve(String(a));
  const nb = path.resolve(String(b));
  return platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

// `kanban_web`, then `kanban_web-<board-name>`, then numbered variants — only
// reached when a same-folder collision is with a DIFFERENT board (see
// chooseWrapperName). The cap is generous headroom, never expected in
// practice.
function* wrapperNameCandidates(sanitizedBoardName) {
  yield 'kanban_web';
  yield `kanban_web-${sanitizedBoardName}`;
  for (let n = 2; n < 1000; n++) yield `kanban_web-${sanitizedBoardName}-${n}`;
}

// `existing`: [{ baseName, markerBoardDir, markerBoardDirExists }] for
// wrapper files already sitting in the target folder (this OS's extension
// only; `markerBoardDirExists` is the caller's disk check, kept out of this
// pure function — see listWrapperMarkers). Picks the first candidate name
// that is: free, already serves the SAME board (rewriting a same-board
// launcher is the normal healing path), or names a board dir that no longer
// exists at all — reclaimed rather than left dead forever, e.g. after the
// project folder was renamed (#281 review). A name serving a different,
// still-real board — or one whose marker can't be read at all — is skipped,
// never overwritten.
function chooseWrapperName(boardDirAbs, boardName, existing, platform = process.platform) {
  const suffix = cs.slugify(boardName) || 'board';
  for (const candidate of wrapperNameCandidates(suffix)) {
    const match = existing.find((e) => e.baseName === candidate);
    if (!match) return candidate;
    if (sameBoardDir(match.markerBoardDir, boardDirAbs, platform)) return candidate;
    if (match.markerBoardDir != null && match.markerBoardDirExists === false) return candidate;
  }
  throw new Error(`could not find a free launcher name for ${boardDirAbs}`);
}

// The board name (config.yaml `name:`, or a folder name) lands verbatim in
// the .cmd `title` line, which isn't quoted — cmd.exe parses that line for
// `&`/`|`/`<`/`>`/`^`/`%`/`"` before `title` ever sees them, so an untrusted
// name (config.yaml is tracked repo content) could run its own command the
// moment the human double-clicks the wrapper. Titles are cosmetic, so a
// blunt replace is fine; nothing here needs to round-trip.
function sanitizeForWindowsTitle(name) {
  return String(name || '').replace(/[\r\n]+/g, ' ').replace(/[&|<>^%"]/g, '_').trim();
}

function renderWrapper({ platform, boardDirAbs, boardName, nodePath, helperPath }) {
  const marker = markerCommentLine(platform, boardDirAbs);
  if (platform === 'win32') {
    return [
      '@echo off',
      // Runs before anything else executes so the REST of the script — the
      // `if exist` path check below included — reads its own non-ASCII
      // bytes (a board path, a board name) as UTF-8 instead of whatever OEM
      // code page this Windows install defaults cmd.exe to.
      'chcp 65001 >nul',
      marker,
      `title Kanban Web - ${sanitizeForWindowsTitle(boardName)}`,
      `if exist "${helperPath}" goto run`,
      'echo The kanban plugin has moved or updated. Run /kanban:web once to rewrite this launcher.',
      'pause',
      'exit /b 1',
      ':run',
      `"${nodePath}" "${helperPath}" run "${boardDirAbs}"`,
      'if errorlevel 1 pause',
      '',
    ].join('\r\n');
  }
  return [
    '#!/bin/sh',
    marker,
    `if [ ! -f "${helperPath}" ]; then`,
    '  echo "The kanban plugin has moved or updated. Run /kanban:web once to rewrite this launcher."',
    '  exit 1',
    'fi',
    `exec "${nodePath}" "${helperPath}" run "${boardDirAbs}"`,
    '',
  ].join('\n');
}

// Appends any `names` not already present (as a whole trimmed line) to an
// info/exclude-shaped text, once each, preserving everything already there.
// Idempotent: writing the same names twice is a no-op the second time.
function mergeExcludeEntries(existing, names) {
  const text = String(existing || '');
  const lines = text.length ? text.split(/\r?\n/) : [];
  const hadTrailingNewline = text.endsWith('\n');
  const body = hadTrailingNewline ? lines.slice(0, -1) : lines;
  const present = new Set(body.map((l) => l.trim()));
  const toAdd = names.filter((n) => !present.has(n));
  if (!toAdd.length) return text;
  return [...body, ...toAdd].join('\n') + '\n';
}

// pid file shape shared with .kanban-app.pid: pid on line 1, port on line 2.
function parsePidFileText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const pid = Number(lines[0]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const port = Number(lines[1]);
  return { pid, port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null };
}

// Every port worth asking "is this board already running here", in priority
// order (paired pid file, then .kanban-app.pid, then config.yaml's pin),
// deduped. Callers gate pairedPort/appPort on liveness themselves. Unlike a
// single precedence pick, EVERY candidate gets probed — a stale paired pid
// naming the wrong port must never shadow a genuinely running server whose
// own .kanban-app.pid or config pin would have answered (#281 review: the
// old single-candidate choosePort let exactly that happen and then deleted
// the live server's .kanban-app.pid out from under it).
function candidatePorts({ pairedPort, appPort, configPort }) {
  const isPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;
  return [...new Set([pairedPort, appPort, configPort].filter(isPort))];
}

// A pid file is a convenience, never the proof — this is the proof: a port
// only counts as "running this board" once something answered on it AND that
// something's own boardDir resolves to the one we're asking about.
function decideRunning({ port, answeredBoardDir, targetBoardDir, platform = process.platform }) {
  if (port == null || !answeredBoardDir) return false;
  return sameBoardDir(answeredBoardDir, targetBoardDir, platform);
}

// ---------------------------------------------------------------------------
// I/O — fs, git, http, child_process.
// ---------------------------------------------------------------------------

function runGit(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return null;
  }
}

function gitRepoRoot(boardDirAbs) {
  const out = runGit(['rev-parse', '--show-toplevel'], boardDirAbs);
  return out ? path.resolve(out) : null;
}

// Resolved with --git-path (not a hardcoded `.git/info/exclude`) so a
// worktree or submodule board still lands on its real, shared exclude file.
function gitInfoExcludePath(boardDirAbs) {
  const out = runGit(['rev-parse', '--git-path', 'info/exclude'], boardDirAbs);
  if (!out) return null;
  return path.resolve(boardDirAbs, out);
}

// WHERE the wrapper/pid pair live: the board's repo root, or — no
// repository — the board dir's own parent folder.
function resolveWhere(boardDirAbs) {
  const root = gitRepoRoot(boardDirAbs);
  return { dir: root || path.dirname(boardDirAbs), repoRoot: root };
}

// `excludePath` is null for "no repository" (resolved by the caller, which
// already needed gitRepoRoot for WHERE — this stays a plain write so that
// case costs no extra git process).
function ensureExcludeEntries(excludePath, names) {
  if (!excludePath) return;
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  let existing = '';
  try { existing = fs.readFileSync(excludePath, 'utf8'); } catch (_) { /* absent = empty */ }
  const merged = mergeExcludeEntries(existing, names);
  if (merged !== existing) fs.writeFileSync(excludePath, merged);
}

// config.yaml's `name:` else the parent-folder derivation — the exact same
// fallback GET /api/board already applies, reused rather than re-derived.
function boardDisplayName(boardDirAbs) {
  const config = cfg.readConfig(boardDirAbs);
  return config.name || cs.projectName(boardDirAbs);
}

function listWrapperMarkers(whereDir, platform) {
  const ext = osWrapperExt(platform);
  let files;
  try { files = fs.readdirSync(whereDir); } catch (_) { return []; }
  const re = new RegExp(`^kanban_web(?:-.+)?${ext.replace('.', '\\.')}$`);
  const out = [];
  for (const f of files) {
    if (!re.test(f)) continue;
    let text = '';
    try { text = fs.readFileSync(path.join(whereDir, f), 'utf8'); } catch (_) { continue; }
    const markerBoardDir = parseMarkerBoardDir(text);
    out.push({
      baseName: f.slice(0, f.length - ext.length),
      markerBoardDir,
      // A parsed marker naming a board dir that's gone (the project moved
      // or was renamed away) makes this wrapper reclaimable — see
      // chooseWrapperName. An unparseable marker (null) is a different,
      // more cautious case and stays non-reclaimable, so this flag is
      // meaningless there.
      markerBoardDirExists: markerBoardDir == null ? true : fs.existsSync(markerBoardDir),
    });
  }
  return out;
}

function readPidFile(file) {
  if (!fs.existsSync(file)) return null;
  try { return parsePidFileText(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

// process.kill(pid, 0) throws if the pid is gone; EPERM means it exists but
// we can't signal it (still alive, just not ours to touch).
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function probeBoardDir(port, timeoutMs) {
  return new Promise((resolve) => {
    // `req.destroy()` on a timeout does not reliably re-emit as an 'error'
    // across Node versions, so the timeout path resolves directly rather
    // than counting on the 'error' handler to fire afterward.
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    const req = http.get({ host: '127.0.0.1', port, path: '/api/board', timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          finish(typeof json.boardDir === 'string' ? json.boardDir : null);
        } catch (_) { finish(null); }
      });
      res.on('error', () => finish(null));
    });
    req.on('timeout', () => { req.destroy(); finish(null); });
    req.on('error', () => finish(null));
  });
}

function openBrowser(url) {
  if (process.env.KANBAN_WEB_NO_BROWSER === '1') return;
  let cmd, args;
  if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '""', url]; }
  else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch (_) { /* best-effort only */ }
}

// `launcher.js write` — (re)writes the current OS's wrapper + registers its
// names in info/exclude. Returns the wrapper's absolute path.
function writeLauncher(boardDirArg) {
  const boardDirAbs = path.resolve(boardDirArg);
  if (!fs.existsSync(boardDirAbs)) throw new Error(`board dir not found: ${boardDirAbs}`);
  const platform = process.platform;
  const { dir: whereDir, repoRoot } = resolveWhere(boardDirAbs);
  fs.mkdirSync(whereDir, { recursive: true });
  const boardName = boardDisplayName(boardDirAbs);
  const existing = listWrapperMarkers(whereDir, platform);
  const baseName = chooseWrapperName(boardDirAbs, boardName, existing, platform);
  const wrapperPath = path.join(whereDir, wrapperFileName(baseName, platform));
  const pidPath = path.join(whereDir, pidFileName(baseName));
  const text = renderWrapper({
    platform, boardDirAbs, boardName,
    nodePath: process.execPath,
    helperPath: __filename,
  });
  fs.writeFileSync(wrapperPath, text);
  if (platform !== 'win32') { try { fs.chmodSync(wrapperPath, 0o755); } catch (_) {} }
  const excludePath = repoRoot ? gitInfoExcludePath(boardDirAbs) : null;
  ensureExcludeEntries(excludePath, [path.basename(wrapperPath), path.basename(pidPath)]);
  return wrapperPath;
}

// Finds the baseName an earlier `write` already assigned to this board (by
// marker match) so `run` writes/reads the SAME paired pid file the wrapper
// sitting next to it names — `run` never re-derives a fresh collision name.
function resolveBaseNameForBoard(whereDir, boardDirAbs, platform) {
  const match = listWrapperMarkers(whereDir, platform).find((e) => sameBoardDir(e.markerBoardDir, boardDirAbs, platform));
  return match ? match.baseName : 'kanban_web';
}

// Windows has no real POSIX signals: a console Ctrl+C delivers CTRL_C_EVENT
// straight to every process sharing that console — including the child,
// which is spawned with stdio inherited for exactly this reason — so the
// child already gets its own copy independent of anything we do here.
// child.kill(sig) on win32 is TerminateProcess regardless of `sig`, racing
// that hard kill against the child's own graceful SIGINT handler (which is
// what unlinks .kanban-app.pid) and reliably winning (#281 review). POSIX
// signals are real, not console-shared, so forwarding there is both safe
// and necessary — the child has no other way to hear about it.
function shouldForwardSignal(platform = process.platform) {
  return platform !== 'win32';
}

// A child killed by a signal reports `code: null` — on win32 that includes
// the ordinary, deliberate Ctrl+C stop (see shouldForwardSignal), so treat
// that case as success rather than the wrapper's `if errorlevel 1 pause`
// firing after every normal stop.
function launcherExitCode(code, sawSigint) {
  if (code != null) return code;
  return sawSigint ? 0 : 1;
}

// Spawns server.js in THIS window (stdio inherited — the launcher's window
// is the server's console), waits for it to report a real bound port, writes
// the paired pid file, opens the browser, then stays attached until the
// child exits, forwarding Ctrl+C/TERM to it (POSIX only — see
// shouldForwardSignal) and cleaning up after. `appPidAlive` says whether
// .kanban-app.pid named a live pid as of run()'s check — only a truly dead
// one is cleared here, never a live one (#281 review: a live .kanban-app.pid
// can only belong to a real server, and by the time run() reaches here every
// candidate port has already been probed and none answered as this board).
function startAndAttach(boardDirAbs, pidPath, appPidAlive) {
  return new Promise((resolve) => {
    const serverPath = path.join(__dirname, 'server.js');
    const appPidPath = path.join(boardDirAbs, '.kanban-app.pid');
    if (!appPidAlive) { try { fs.unlinkSync(appPidPath); } catch (_) { /* absent is fine */ } }
    const child = spawn(process.execPath, [serverPath, boardDirAbs], { stdio: 'inherit' });

    // stdio is inherited (so the window IS the server's console), which
    // means we can't pipe its stdout to read the bound port — poll the pid
    // file server.js itself writes on a successful bind instead, keyed by
    // matching child.pid so a stale leftover file is never mistaken for it.
    let pollTimer = setInterval(() => {
      const info = readPidFile(appPidPath);
      if (info && info.pid === child.pid && info.port) {
        clearInterval(pollTimer);
        pollTimer = null;
        fs.writeFileSync(pidPath, `${child.pid}\n${info.port}\n`);
        openBrowser(`http://localhost:${info.port}`);
      }
    }, 150);

    const forward = (sig) => { try { child.kill(sig); } catch (_) {} };
    let sawSigint = false;
    const onSigint = () => { sawSigint = true; if (shouldForwardSignal()) forward('SIGINT'); };
    const onSigterm = () => { if (shouldForwardSignal()) forward('SIGTERM'); };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    child.on('exit', (code) => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      const cur = readPidFile(pidPath);
      if (cur && cur.pid === child.pid) { try { fs.unlinkSync(pidPath); } catch (_) {} }
      resolve(launcherExitCode(code, sawSigint));
    });
  });
}

// `launcher.js run` — what the wrapper calls. Checks whether the board is
// already served; if so opens the browser and exits 0 starting nothing,
// otherwise starts the server and stays attached to it.
async function runLauncher(boardDirArg) {
  const boardDirAbs = path.resolve(boardDirArg);
  if (!fs.existsSync(boardDirAbs)) throw new Error(`board dir not found: ${boardDirAbs}`);
  const platform = process.platform;
  const { dir: whereDir } = resolveWhere(boardDirAbs);
  const baseName = resolveBaseNameForBoard(whereDir, boardDirAbs, platform);
  const pidPath = path.join(whereDir, pidFileName(baseName));
  const appPidPath = path.join(boardDirAbs, '.kanban-app.pid');

  const pairedPid = readPidFile(pidPath);
  const appPid = readPidFile(appPidPath);
  const pairedAlive = !!pairedPid && isPidAlive(pairedPid.pid);
  const appAlive = !!appPid && isPidAlive(appPid.pid);
  const config = cfg.readConfig(boardDirAbs);

  const ports = candidatePorts({
    pairedPort: pairedAlive ? pairedPid.port : null,
    appPort: appAlive ? appPid.port : null,
    configPort: config.port || null,
  });

  // Every candidate gets probed — the board counts as running the moment
  // ANY of them answers as it, never shadowed by an earlier candidate (e.g.
  // a stale paired pid naming the wrong port) that simply didn't answer.
  for (const port of ports) {
    const answeredBoardDir = await probeBoardDir(port, 800);
    if (decideRunning({ port, answeredBoardDir, targetBoardDir: boardDirAbs, platform })) {
      openBrowser(`http://localhost:${port}`);
      return 0;
    }
  }

  return startAndAttach(boardDirAbs, pidPath, appAlive);
}

module.exports = {
  osWrapperExt, wrapperFileName, pidFileName, markerLine, markerCommentLine, parseMarkerBoardDir,
  sameBoardDir, wrapperNameCandidates, chooseWrapperName, sanitizeForWindowsTitle, renderWrapper,
  mergeExcludeEntries, parsePidFileText, candidatePorts, decideRunning, shouldForwardSignal,
  launcherExitCode, boardDisplayName, resolveWhere, gitRepoRoot, gitInfoExcludePath,
  listWrapperMarkers, resolveBaseNameForBoard, readPidFile, isPidAlive, probeBoardDir, openBrowser,
  writeLauncher, runLauncher,
};

if (require.main === module) {
  const [, , cmd, boardDirArg] = process.argv;
  if (cmd === 'write' && boardDirArg) {
    try {
      const wrapperPath = writeLauncher(boardDirArg);
      console.log(`Launcher written: ${wrapperPath}`);
    } catch (e) { console.error(e.message); process.exit(1); }
  } else if (cmd === 'run' && boardDirArg) {
    runLauncher(boardDirArg).then((code) => process.exit(code)).catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    console.error('usage: launcher.js <write|run> <kanban-dir>');
    process.exit(1);
  }
}
