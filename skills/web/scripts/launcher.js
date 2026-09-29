'use strict';
// A double-clickable OS launcher for a board's kanban-web server, so
// restarting an already-visited board costs no tokens. All logic lives here;
// the per-OS file it writes is a thin wrapper that just calls back into this
// script's `run` subcommand with absolute paths.
//
//   node launcher.js write <kanban-dir> [server args...]  — run by the skill
//                                           after a start, passing the exact
//                                           same arguments it gave server.js.
//   node launcher.js run   <kanban-dir> <baseName> [server args...]
//                                        — what the wrapper calls. Never run
//                                           by an agent.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const cs = require('./card-store');
const cfg = require('./config-store');
const srv = require('./server');

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

// The start-lock file's name — see acquireStartLock/releaseStartLock.
function lockFileName(baseName) {
  return `${baseName}.lock`;
}

// The marker every wrapper carries so a future `write` can tell which board
// it already serves without trusting the filename alone. POSIX writes the
// board dir as a JSON string on ONE physical line: the raw path used to go
// in verbatim after `# kanban-web-board: `, so a newline embedded in the
// path (a hostile or just unlucky folder name) ended the `#` comment early
// and let whatever followed run as its own shell command the next time the
// wrapper was invoked. `JSON.stringify` escapes an embedded newline as the
// two characters `\n`, which can never end the line, and round-trips
// exactly through `JSON.parse` in parseMarkerBoardDir below. Win32 paths
// cannot contain a newline at all, so the win32 side keeps writing the raw
// path — but still strips any CR/LF defensively before it ever reaches a
// `rem` line, belt-and-braces against the same class of bug.
function markerLine(boardDirAbs, platform = process.platform) {
  if (platform === 'win32') {
    return `kanban-web-board: ${String(boardDirAbs).replace(/[\r\n]+/g, '')}`;
  }
  return `kanban-web-board: ${JSON.stringify(String(boardDirAbs))}`;
}

function markerCommentLine(platform, boardDirAbs) {
  const line = markerLine(boardDirAbs, platform);
  return platform === 'win32' ? `rem ${line}` : `# ${line}`;
}

const MARKER_RE = /kanban-web-board:\s*(.+?)\s*$/m;
// `platform` matters only for win32: renderWrapper doubles every `%` in the
// board dir it writes into a .cmd's marker (cmd.exe's line-reader collapses
// `%%` before a rem comment ever sees it, even without executing the line),
// so reading it back has to undo that doubling to recover the real path.
// POSIX reads the current JSON-string form (see markerLine above) and falls
// back to the raw legacy form only when JSON.parse fails — a wrapper
// written by an older launcher.js still heals in place instead of being
// treated as unparseable and orphaned.
function parseMarkerBoardDir(text, platform = process.platform) {
  const m = MARKER_RE.exec(String(text || ''));
  if (!m) return null;
  if (platform === 'win32') return m[1].replace(/%%/g, '%');
  try {
    const parsed = JSON.parse(m[1]);
    if (typeof parsed === 'string') return parsed;
  } catch (_) { /* legacy raw (unquoted) marker — fall through */ }
  return m[1];
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

// `kanban_web`, then `kanban_web-<board-name>`, then numbered variants —
// since the wrapper now lives IN the board directory (one board per
// folder), a collision here is never two DIFFERENT boards genuinely
// sharing a folder at once; it's a leftover wrapper from before the folder
// held this board at all (most commonly: the folder was copied from
// another board's, wrapper file and all — see chooseWrapperName). The cap
// is generous headroom, never expected in practice.
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
// project folder was renamed. A name serving a different,
// still-real board — e.g. a wrapper copied along when this folder was
// cloned from another board's — or one whose marker can't be read at all —
// is skipped, never overwritten.
function chooseWrapperName(boardDirAbs, boardName, existing, platform = process.platform) {
  // A wrapper already naming THIS board — at ANY suffix rank — always wins
  // first, even when an earlier-ranked candidate (e.g. the bare
  // `kanban_web`) has since freed up: picking that free slot instead would
  // abandon this board's real wrapper as an orphaned duplicate and leave
  // `run()` pairing against the wrong pid file.
  const own = existing.find((e) => sameBoardDir(e.markerBoardDir, boardDirAbs, platform));
  if (own) return own.baseName;
  const suffix = cs.slugify(boardName) || 'board';
  for (const candidate of wrapperNameCandidates(suffix)) {
    const match = existing.find((e) => e.baseName === candidate);
    if (!match) return candidate;
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

// cmd.exe's line-reader collapses a doubled `%` to one literal `%` on every
// line it reads — comments included — before it ever considers `%1`,
// `%~dp0`, `%VAR%` and the like. A single, undoubled `%` in an embedded path
// (e.g. a folder named "100% done") can vanish, corrupt an unrelated part of
// the SAME line, or pair with a later `%` on that line to trigger a bogus
// variable expansion. Doubling sidesteps all three.
function escapePercentForCmd(s) {
  return String(s).replace(/%/g, '%%');
}

// POSIX `sh` has no `%`-style quirk; single-quoting alone protects a path
// there, including one with `$`, backticks, spaces or metacharacters — the
// only character that can't appear inside single quotes is a single quote
// itself, closed/escaped/reopened with the standard `'\''` trick.
function singleQuotePosix(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function renderWrapper({ platform, boardDirAbs, boardName, nodePath, helperPath, baseName, serverArgs = [] }) {
  if (platform === 'win32') {
    const dir = escapePercentForCmd(boardDirAbs);
    const node = escapePercentForCmd(nodePath);
    const helper = escapePercentForCmd(helperPath);
    const marker = markerCommentLine(platform, dir);
    const argsPart = serverArgs.map((a) => `"${escapePercentForCmd(a)}"`).join(' ');
    // `&& exit /b 0 || (pause & exit /b 1)`: success exits 0, any failure —
    // negative codes included, `&&`/`||` test the whole exit status, not the
    // signed `if errorlevel N` comparison — pauses so a double-click window
    // stays readable, then always exits 1. The OLD `|| pause & exit /b` left
    // `exit /b` with NO code of its own, so it replayed whatever `pause`
    // itself returned — under `cmd /c "kanban_web.cmd"` (how a double-click
    // actually runs it) that let a real failure (errorlevel 3, -1, seen in
    // the wild) come back out as exit code 0.
    const runCmd = [`"${node}" "${helper}" run "${dir}" "${baseName}"`, argsPart].filter(Boolean).join(' ');
    return [
      '@echo off',
      // Right after @echo off, before any line carries a path: without it,
      // `cmd /v:on` (or the machine-wide DelayedExpansion registry key)
      // makes THIS script's own lines get scanned for `!...!` expansion —
      // any lone `!` in a board path (e.g. `repo\a!b\.kanban`) silently
      // vanishes before node ever sees it, sending the wrong path.
      'setlocal DisableDelayedExpansion',
      // Runs before anything else executes so the REST of the script — the
      // `if exist` path check below included — reads its own non-ASCII
      // bytes (a board path, a board name) as UTF-8 instead of whatever OEM
      // code page this Windows install defaults cmd.exe to.
      'chcp 65001 >nul',
      marker,
      `title Kanban Web - ${sanitizeForWindowsTitle(boardName)}`,
      `if not exist "${helper}" goto stale`,
      `if not exist "${node}" goto stale`,
      // One physical line on purpose: cmd re-reads a batch file by byte
      // offset after each command, and the skill rewrites this file on
      // every start, possibly while this window is still serving. Ending
      // the line with `exit /b 1` (the failure branch) means nothing after
      // it is ever read.
      `${runCmd} && exit /b 0 || (pause & exit /b 1)`,
      ':stale',
      'echo This launcher is out of date: the kanban plugin or Node moved. Run /kanban:web once to rewrite it.',
      'pause',
      'exit /b 1',
      '',
    ].join('\r\n');
  }
  const marker = markerCommentLine(platform, boardDirAbs);
  const node = singleQuotePosix(nodePath);
  const helper = singleQuotePosix(helperPath);
  const dir = singleQuotePosix(boardDirAbs);
  const base = singleQuotePosix(baseName);
  const argsPart = serverArgs.map((a) => singleQuotePosix(a)).join(' ');
  const execLine = ['exec', node, helper, 'run', dir, base, argsPart].filter(Boolean).join(' ');
  return [
    '#!/bin/sh',
    marker,
    `if [ ! -f ${helper} ] || [ ! -x ${node} ]; then`,
    '  echo "This launcher is out of date: the kanban plugin or Node moved. Run /kanban:web once to rewrite it."',
    '  exit 1',
    'fi',
    execLine,
    '',
  ].join('\n');
}

// Which `names` are missing (as a whole trimmed line) from an
// info/exclude-shaped file. Byte-safe on purpose: info/exclude is git's, not
// ours, and may hold lines that aren't valid UTF-8 (a latin-1 comment, say).
// Decoding as latin1 for the split/trim is lossless for the 1-byte-per-char
// comparison this needs and never risks mangling bytes it doesn't touch —
// unlike decoding as utf8, which would silently corrupt any invalid sequence
// the moment it's re-encoded.
function missingExcludeNames(existingBuf, names) {
  const text = Buffer.isBuffer(existingBuf) ? existingBuf.toString('latin1') : String(existingBuf || '');
  const lines = text.length ? text.split(/\r?\n/) : [];
  const present = new Set(lines.map((l) => l.trim()));
  return names.filter((n) => !present.has(n));
}

// Bytes to APPEND (never rewrite) to add `missing` names to an
// info/exclude-shaped file whose current bytes are `existingBuf` — adds a
// leading newline first only when the file is non-empty and doesn't already
// end with one. Returns null when there's nothing to add (idempotent: a
// second write of the same names is a no-op).
function excludeAppendBuffer(existingBuf, missing) {
  if (!missing.length) return null;
  const buf = Buffer.isBuffer(existingBuf) ? existingBuf : Buffer.from(String(existingBuf || ''), 'latin1');
  const needsLeadingNewline = buf.length > 0 && buf[buf.length - 1] !== 0x0a;
  const text = (needsLeadingNewline ? '\n' : '') + missing.join('\n') + '\n';
  return Buffer.from(text, 'utf8');
}

// gitignore/exclude escaping for ONE path SEGMENT (a folder name taken from
// the board's repo-relative prefix — see anchoredExcludeName). A literal
// `\`, `*`, `?`, `[`, `#` or `!` inside a real folder name is otherwise
// gitignore's own escape/wildcard/comment/negation syntax; backslash-escaping
// each makes it match as the literal character instead, wherever in the
// segment it falls. wildmatch() (what an exclude/gitignore file's patterns
// are parsed with) treats `\` as a general escape character throughout a
// pattern, not just at line-start, so escaping `#`/`!` here is safe even
// though those two are only special when they open the WHOLE line — ours
// always opens with `/` (see anchoredExcludeName) — belt-and-braces for a
// future caller of this function that might not add its own leading slash.
function escapeGitExcludeSegment(seg) {
  return String(seg).replace(/[\\*?[#!]/g, '\\$&');
}

// One exclude-file pattern for `name` (one of the launcher's own fixed
// filenames, or `<lock>.*` — passed through verbatim, never escaped itself:
// it's ours, not a folder name, and that trailing `*` is a deliberate
// wildcard), anchored to the repository TOP LEVEL with a leading `/` so it
// only ever matches this board's own directory, never a same-named file
// elsewhere in the tree. `prefix` is `git rev-parse --show-prefix`'s output
// run IN the board directory — see gitShowPrefix — a POSIX-separated,
// trailing-slash path from the repo top level (or '' when the board dir IS
// the top level), split back into segments and escaped one at a time.
function anchoredExcludeName(prefix, name) {
  const segs = String(prefix || '').split('/').filter(Boolean).map(escapeGitExcludeSegment);
  return ['', ...segs, name].join('/');
}

// A wrapper embeds `serverArgs` as literal text in a shell/cmd command
// line — quoting alone can't make that safe, because server.js's own
// allowlist only ever compares a NORMALIZED origin (`new URL(v).origin` —
// see originMatches in server.js), so an operator can hand it
// `https://host/"&echo x>PWNED.txt&"` or an origin with an embedded CR/LF
// and have it accepted, then replayed verbatim into `launcher.js write`
// (SKILL.md passes the exact arguments already given to server.js). On
// win32 a literal `"` inside a quoted cmd.exe argument ends the quoted
// string right there — nothing that follows on the line is quoted at all —
// so no amount of escaping the OUTSIDE of that string closes it; the
// untrusted suffix has to never reach the wrapper in the first place. This
// re-derives every argument from its parsed, semantic value instead of
// trusting the original string: the port becomes a bare digit string (any
// non-digit content, quotes included, throws rather than passing through),
// and each --allow-origin is re-emitted from ITS OWN `new URL(v).origin` —
// which can only ever be `<scheme>://<host>[:<port>]`, so whatever garbage
// followed the real origin in the input is simply not part of the output.
// Any argument that isn't exactly the port or an --allow-origin flag is
// rejected outright: this replays a `server.js` start, never arbitrary
// strings. The win32 character check below is belt-and-braces on top of
// that — normalization already rules every one of these characters out for
// a URL's `.origin`, but a future scheme this doesn't anticipate should
// fail loudly here rather than reach the wrapper.
function sanitizeServerArgsForWrapper(serverArgs, platform) {
  const { origins, rest } = srv.extractAllowOriginArgs(serverArgs || []);
  if (rest.length > 1) {
    throw new Error(`launcher.js write: unexpected server argument(s) ${rest.slice(1).map((a) => JSON.stringify(a)).join(', ')} — only a port and --allow-origin are replayed`);
  }
  const out = [];
  if (rest.length === 1) {
    const portArg = String(rest[0]);
    if (!/^\d+$/.test(portArg)) {
      throw new Error(`launcher.js write: the port argument ${JSON.stringify(rest[0])} is not a plain port number`);
    }
    out.push(portArg);
  }
  for (const origin of origins) {
    let normalized;
    try { normalized = new URL(origin).origin; } catch (_) {
      throw new Error(`launcher.js write: --allow-origin value ${JSON.stringify(origin)} is not a valid URL`);
    }
    out.push(`--allow-origin=${normalized}`);
  }
  if (platform === 'win32') {
    for (const a of out) {
      if (/["\r\n]/.test(a) || a.endsWith('\\')) {
        throw new Error(`launcher.js write: server argument ${JSON.stringify(a)} cannot be safely embedded in a .cmd wrapper`);
      }
    }
  }
  return out;
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
// order (paired pid file, then .kanban-app.pid, then the CLI port `run` was
// given — see cliPortFromServerArgs — then config.yaml's pin), deduped.
// Callers gate pairedPort/appPort on liveness themselves. Unlike a single
// precedence pick, EVERY candidate gets probed — a stale paired pid naming
// the wrong port must never shadow a genuinely running server whose own
// .kanban-app.pid or config pin would have answered — an earlier,
// single-candidate choosePort let exactly that happen and then deleted the
// live server's .kanban-app.pid out from under it. `cliPort` ranks ahead of
// `configPort` for the same reason server.js's own resolvePort prefers a CLI
// argument over the config pin: a caller-supplied port is a more specific
// instruction than the board's default pin.
function candidatePorts({ pairedPort, appPort, cliPort, configPort }) {
  const isPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;
  return [...new Set([pairedPort, appPort, cliPort, configPort].filter(isPort))];
}

// Which of the server arguments `run` was given (everything the wrapper/CLI
// passed along verbatim after the board dir — see runLauncher/writeLauncher)
// is the port argument, applying the exact same rule server.js's own
// resolvePort applies to ITS CLI arg: a bindable port number wins, anything
// else (missing, `0`, NaN, out of range) reads as "no CLI port given". Kept
// separate from resolvePort (which also consults config.yaml) because
// findServedPort/pollForServedBoard already fold the config pin in on their
// own — this only needs to know what server.js is about to be told, so the
// running check can probe that port too before deciding whether to spawn.
function cliPortFromServerArgs(serverArgs) {
  let rest;
  try { ({ rest } = srv.extractAllowOriginArgs(serverArgs || [])); } catch (_) { return null; }
  const arg = rest[0];
  if (arg === undefined || arg === null || String(arg).trim() === '') return null;
  const n = Number(arg);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

// A pid file is a convenience, never the proof — this is the proof: a port
// only counts as "running this board" once something answered on it AND that
// something's own boardDir resolves to the one we're asking about.
function decideRunning({ port, answeredBoardDir, targetBoardDir, platform = process.platform }) {
  if (port == null || !answeredBoardDir) return false;
  return sameBoardDir(answeredBoardDir, targetBoardDir, platform);
}

function boardUrl(port, host = '127.0.0.1') {
  return `http://${host}:${port}`;
}

// Which host the browser opens. `localhost` is what the skill and the
// server's own URL line use, and the app keeps its view settings per origin,
// so opening the same origin keeps them together. But `localhost` can
// resolve to ::1 first, where a different server may sit on the same port,
// so it is used only when it answers as THIS board; otherwise 127.0.0.1,
// the address the running check just proved.
function browserHost(localhostBoardDir, boardDirAbs, platform = process.platform) {
  return sameBoardDir(localhostBoardDir, boardDirAbs, platform) ? 'localhost' : '127.0.0.1';
}

// ---------------------------------------------------------------------------
// I/O — fs, git, http, child_process.
// ---------------------------------------------------------------------------

function runGit(args, cwd) {
  try {
    // Trailing newlines only: a POSIX repository path may end in a space.
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r?\n+$/, '');
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

// `git rev-parse --show-prefix` run IN the board directory: the board's own
// path from the repository top level, POSIX-separated with a trailing `/`
// (empty string when the board dir IS the top level) — what anchors the
// exclude patterns to THIS board's directory alone (see anchoredExcludeName)
// instead of matching a same-named file anywhere in the tree. `runGit`
// already decodes as utf8 and trims only a trailing newline — a real
// trailing space in a folder name is data, never stripped.
function gitShowPrefix(boardDirAbs) {
  const out = runGit(['rev-parse', '--show-prefix'], boardDirAbs);
  return out == null ? '' : out;
}

// WHERE the wrapper/pid/lock pair live NOW: the board directory itself —
// one board per folder, so a board's launcher files never have to share
// this folder with a different board's the way a repo-root or parent-folder
// "where" once could. See writeLauncher's migration step for the location
// an older launcher.js used instead, healed forward on write.
function resolveWhere(boardDirAbs) {
  return { dir: boardDirAbs, repoRoot: gitRepoRoot(boardDirAbs) };
}

// `excludePath` is null for "no repository" (resolved by the caller, which
// already needed gitRepoRoot for WHERE — this stays a plain write so that
// case costs no extra git process). Reads the file as raw bytes and only
// ever APPENDS — never a read-modify-rewrite of the whole file — so bytes
// this function doesn't understand (git's, not ours) survive untouched.
function ensureExcludeEntries(excludePath, names) {
  if (!excludePath) return;
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  let buf = Buffer.alloc(0);
  try { buf = fs.readFileSync(excludePath); } catch (_) { /* absent = empty */ }
  const toAppend = excludeAppendBuffer(buf, missingExcludeNames(buf, names));
  if (toAppend) fs.appendFileSync(excludePath, toAppend);
}

// config.yaml's `name:` else the parent-folder derivation — the exact same
// fallback GET /api/board already applies, reused rather than re-derived.
function boardDisplayName(boardDirAbs) {
  const config = cfg.readConfig(boardDirAbs);
  return config.name || cs.projectName(boardDirAbs);
}

// `lstat`, not `existsSync` — see the comment on `markerBoardDirExists`
// below for why the distinction matters.
function boardDirStillThere(boardDirAbs) {
  try { fs.lstatSync(boardDirAbs); return true; } catch (_) { return false; }
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
    const markerBoardDir = parseMarkerBoardDir(text, platform);
    out.push({
      baseName: f.slice(0, f.length - ext.length),
      markerBoardDir,
      // A parsed marker naming a board dir that's gone (the project moved
      // or was renamed away) makes this wrapper reclaimable — see
      // chooseWrapperName. An unparseable marker (null) is a different,
      // more cautious case and stays non-reclaimable, so this flag is
      // meaningless there.
      //
      // `lstat`, never a symlink-following `existsSync`: a no-repository
      // board whose folder is a junction to a removable drive still lstats
      // successfully while unplugged — the junction ENTRY is still sitting
      // right there, only the drive it points at is gone — so it reads as
      // "still exists" and a sibling board in the same folder never reclaims
      // its wrapper out from under it. `existsSync` follows the link and
      // would report the same dangling junction as gone, which is exactly
      // wrong: the directory entry itself hasn't moved. A REAL rename/move
      // removes that entry outright, which is what makes `lstat` throw and
      // is the only case this should ever reclaim.
      markerBoardDirExists: markerBoardDir == null ? true : boardDirStillThere(markerBoardDir),
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

function probeBoardDir(port, timeoutMs, host = '127.0.0.1') {
  return new Promise((resolve) => {
    // `req.destroy()` on a timeout does not reliably re-emit as an 'error'
    // across Node versions, so the timeout path resolves directly rather
    // than counting on the 'error' handler to fire afterward.
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    const req = http.get({ host, port, path: '/api/board', timeout: timeoutMs }, (res) => {
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

async function openBoard(port, boardDirAbs) {
  if (process.env.KANBAN_WEB_NO_BROWSER === '1') return;
  const viaLocalhost = await probeBoardDir(port, 500, 'localhost');
  openBrowser(boardUrl(port, browserHost(viaLocalhost, boardDirAbs)));
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
// names in info/exclude. Returns the wrapper's absolute path. `serverArgs`
// is every argument the skill just passed to `server.js` after the board
// dir (a port and/or `--allow-origin ...`), embedded verbatim into the
// wrapper's exec line so `launcher.js run` replays the exact same start.
// cmd.exe's own command-line buffer tops out at 8191 characters; a longer
// physical line silently truncates or splits instead of erroring — the root
// cause once saw `&&` itself become part of the port argument. 8000 leaves
// headroom without chasing the exact boundary.
const MAX_WIN32_EXEC_LINE = 8000;

function writeLauncher(boardDirArg, serverArgs = []) {
  const boardDirAbs = path.resolve(boardDirArg);
  if (!fs.existsSync(boardDirAbs)) throw new Error(`board dir not found: ${boardDirAbs}`);
  const platform = process.platform;
  // Sanitize BEFORE any fs write — see sanitizeServerArgsForWrapper — so a
  // rejected argument fails loudly and leaves nothing behind, the same
  // "nothing half-written" guarantee the exclude-file-first ordering below
  // already gives the rest of this function.
  const safeServerArgs = sanitizeServerArgsForWrapper(serverArgs, platform);
  const { dir: whereDir, repoRoot } = resolveWhere(boardDirAbs);
  const boardName = boardDisplayName(boardDirAbs);
  const existing = listWrapperMarkers(whereDir, platform);
  const baseName = chooseWrapperName(boardDirAbs, boardName, existing, platform);
  const wrapperPath = path.join(whereDir, wrapperFileName(baseName, platform));
  const pidPath = path.join(whereDir, pidFileName(baseName));
  const lockPath = path.join(whereDir, lockFileName(baseName));

  const text = renderWrapper({
    platform, boardDirAbs, boardName, baseName, serverArgs: safeServerArgs,
    nodePath: process.execPath,
    helperPath: __filename,
  });
  // Rendering is pure — checked, and rejected, before ANY fs write (the
  // mkdir/exclude-entries/wrapper-write below), so a wrapper too long for
  // cmd.exe to read back correctly is never written half-usable.
  if (platform === 'win32') {
    const execLine = text.split('\r\n').find((l) => l.endsWith('&& exit /b 0 || (pause & exit /b 1)'));
    if (execLine && execLine.length > MAX_WIN32_EXEC_LINE) {
      throw new Error(`launcher.js write: the rendered command line is ${execLine.length} characters, over cmd.exe's safe ${MAX_WIN32_EXEC_LINE}-character limit — shorten the board path or the --allow-origin arguments`);
    }
  }

  fs.mkdirSync(whereDir, { recursive: true });

  // Exclude entries FIRST: if this throws (e.g. a read-only info/exclude),
  // NOTHING is written — an untracked kanban_web.cmd left behind by a
  // half-finished write is worse than a clean error, since it silently
  // keeps working (still launches the board) while never actually getting
  // excluded from `git status`/`git add`. Anchored (leading `/`) to the
  // board's own path from the repo top level — see anchoredExcludeName/
  // gitShowPrefix — so the pattern only ever matches THIS board's
  // directory, never a same-named file elsewhere in the tree. `<lock>.*`
  // covers the lock's temp and reclaim-ticket siblings, which a launcher
  // killed mid-operation can leave behind.
  const excludePath = repoRoot ? gitInfoExcludePath(boardDirAbs) : null;
  const excludeNames = excludePath
    ? (() => {
        const prefix = gitShowPrefix(boardDirAbs);
        return [path.basename(wrapperPath), path.basename(pidPath), path.basename(lockPath), `${path.basename(lockPath)}.*`]
          .map((n) => anchoredExcludeName(prefix, n));
      })()
    : [];
  ensureExcludeEntries(excludePath, excludeNames);

  // Unchanged bytes are not rewritten: a window running this wrapper keeps
  // reading it by byte offset.
  let current = null;
  try { current = fs.readFileSync(wrapperPath, 'utf8'); } catch (_) {}
  if (current !== text) fs.writeFileSync(wrapperPath, text);
  if (platform !== 'win32') { try { fs.chmodSync(wrapperPath, 0o755); } catch (_) {} }

  // MIGRATION: the wrapper/pid/lock used to live at the repository
  // top level, or — no repository — the board dir's own parent (the OLD
  // `resolveWhere`). Now that the board's own copy above is written and
  // live, heal that forward: reclaim an old-location wrapper for THIS SAME
  // board (by marker), together with its paired pid, lock and the lock's
  // temp/reclaim-ticket siblings.
  migrateOldLocationLauncher(boardDirAbs, whereDir, repoRoot, platform);

  return wrapperPath;
}

// Every file matching `<lockBaseName>.*` sitting in `dir` — the lock's own
// temp-write and reclaim-ticket siblings (see createLockAtomic/
// reclaimStaleLock) — removed as part of the old-location migration cleanup
// below. Best-effort: a file already gone, or one this process can't
// remove, is simply skipped rather than failing the whole write.
function removeLockSiblings(dir, lockBaseName) {
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { return; }
  const prefix = `${lockBaseName}.`;
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
  }
}

// MIGRATION: reclaims a launcher an OLDER launcher.js left at the OLD
// location (the repo top level, or — no repository — the board dir's own
// parent) for THIS SAME board, once the new, board-directory copy is
// already written and live. Applies the exact same marker contract as
// everywhere else in this file: a wrapper whose marker names a DIFFERENT
// board (a real collision — e.g. this folder was cloned from that board's,
// wrapper file and all) or whose marker can't be read at all is left
// completely alone, never guessed at. The exclude lines an older write
// added to info/exclude are harmless left as-is; only the files themselves
// move. A LIVE process the old paired pid names is never signalled by
// this — only the FILE pairing is removed — and the board still reads as
// running afterward exactly as before: `findServedPort`'s own running check
// goes through `.kanban-app.pid` (server.js's, untouched here) and the
// `/api/board` probe, neither of which this old-location pid file was ever
// the proof for in the first place.
function migrateOldLocationLauncher(boardDirAbs, newWhereDir, repoRoot, platform) {
  const oldDir = repoRoot || path.dirname(boardDirAbs);
  if (sameBoardDir(oldDir, newWhereDir, platform)) return; // old and new location are the same folder — nothing to migrate away from
  for (const marker of listWrapperMarkers(oldDir, platform)) {
    if (marker.markerBoardDir == null) continue; // unreadable marker — never touched
    if (!sameBoardDir(marker.markerBoardDir, boardDirAbs, platform)) continue; // a different board's wrapper — never touched
    try { fs.unlinkSync(path.join(oldDir, wrapperFileName(marker.baseName, platform))); } catch (_) {}
    try { fs.unlinkSync(path.join(oldDir, pidFileName(marker.baseName))); } catch (_) {}
    try { fs.unlinkSync(path.join(oldDir, lockFileName(marker.baseName))); } catch (_) {}
    removeLockSiblings(oldDir, lockFileName(marker.baseName));
  }
}

// FALLBACK ONLY: a wrapper written by this version of launcher.js passes its
// own baseName as run()'s third argument (see renderWrapper/runLauncher), so
// `run` pairs with the exact pid file the wrapper that invoked it names,
// never a guess. This marker-match guess stays here only for a wrapper
// written by an OLDER launcher.js (no third argument yet): guessing by
// marker order can pick the WRONG wrapper's pid file when more than one on
// disk happens to name the same board.
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
// what unlinks .kanban-app.pid) and reliably winning. POSIX
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

// Polls up to `timeoutMs` for the board to turn out to be served by SOMEONE
// ELSE — the paired pid file is deliberately not a candidate here, only
// .kanban-app.pid, the CLI port `run` was given, and the config pin, since
// this exists for exactly one case: our own child just failed to bind (see
// startAndAttach's exit handler) and another launcher racing us for the same
// pinned port may have won a moment before or after. Returns the answering
// port, or null on timeout.
async function pollForServedBoard(boardDirAbs, appPidPath, { timeoutMs = 2000, intervalMs = 150 } = {}, cliPort = null) {
  const config = cfg.readConfig(boardDirAbs);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const appPid = readPidFile(appPidPath);
    const ports = candidatePorts({
      pairedPort: null,
      appPort: appPid && isPidAlive(appPid.pid) ? appPid.port : null,
      cliPort,
      configPort: config.port || null,
    });
    for (const port of ports) {
      const answeredBoardDir = await probeBoardDir(port, 500);
      if (decideRunning({ port, answeredBoardDir, targetBoardDir: boardDirAbs })) return port;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Spawns server.js in THIS window (stdio inherited — the launcher's window
// is the server's console), waits for it to report a real bound port, writes
// the paired pid file, opens the browser, then stays attached until the
// child exits, forwarding Ctrl+C/TERM to it (POSIX only — see
// shouldForwardSignal) and cleaning up after. `appPidAlive` says whether
// .kanban-app.pid named a live pid as of run()'s check — only a truly dead
// one is cleared here, never a live one (a live .kanban-app.pid can only
// belong to a real server, and by the time run() reaches here every
// candidate port has already been probed and none answered as this board).
// `onDecided`, if given, fires exactly once — the instant the outcome of
// THIS start attempt is known (the paired pid got written, or the child
// exited without ever binding) — so a caller holding a start lock (see
// acquireStartLock) can release it the moment it's no longer needed, rather
// than for this whole function's lifetime (which, for a successful start,
// is as long as the server stays up).
//
// The signal handlers and the child's `exit` listener are both wired up
// synchronously, in the same tick as the spawn, before any await — so
// there's no gap where a Ctrl+C (or the child dying on its own) during the
// wait for the bound-port poll would skip this same cleanup path. Whatever
// reason the child exits for (killed, crashed, Ctrl+C, a clean stop), this
// is the one place that ever removes the paired pid file, and only while it
// still names that child — a closed console window is the one way to leave
// it stale, since that terminates this whole process tree before any of
// this code gets to run.
function startAndAttach(boardDirAbs, pidPath, appPidAlive, onDecided, serverArgs = []) {
  return new Promise((resolve) => {
    const serverPath = path.join(__dirname, 'server.js');
    const appPidPath = path.join(boardDirAbs, '.kanban-app.pid');
    if (!appPidAlive) { try { fs.unlinkSync(appPidPath); } catch (_) { /* absent is fine */ } }
    const child = spawn(process.execPath, [serverPath, boardDirAbs, ...serverArgs], { stdio: 'inherit' });

    let decided = false;
    const decide = () => { if (decided) return; decided = true; if (onDecided) onDecided(); };

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
        decide();
        openBoard(info.port, boardDirAbs);
      }
    }, 150);

    const forward = (sig) => { try { child.kill(sig); } catch (_) {} };
    let sawSigint = false;
    const onSigint = () => { sawSigint = true; if (shouldForwardSignal()) forward('SIGINT'); };
    const onSigterm = () => { if (shouldForwardSignal()) forward('SIGTERM'); };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    child.on('exit', (code) => {
      decide();
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      const cur = readPidFile(pidPath);
      if (cur && cur.pid === child.pid) { try { fs.unlinkSync(pidPath); } catch (_) {} }

      // A losing race for a pinned port: our own server.js failed to bind
      // (EADDRINUSE on a pin is a startup error, never a silent increment —
      // see server.js) but another launcher racing us for this same board
      // won and is already serving it. Treat that as success — open the
      // browser to the board that's actually up — rather than surfacing our
      // own bind failure and pausing on an apparent error.
      if (code != null && code !== 0 && !sawSigint) {
        pollForServedBoard(boardDirAbs, appPidPath, undefined, cliPortFromServerArgs(serverArgs)).then((servedPort) => {
          if (servedPort != null) { openBoard(servedPort, boardDirAbs).then(() => resolve(0)); return; }
          resolve(launcherExitCode(code, sawSigint));
        });
        return;
      }
      resolve(launcherExitCode(code, sawSigint));
    });
  });
}

// Lock content is `<pid> <token>` — the token is a random id unique to THIS
// acquisition, never reused, so "is this still MY lock" can be answered
// exactly (see stillHoldsStartLock/releaseStartLock) even in the one case
// pid alone can't cover: this very process reclaiming a lock more than once
// across retries. Tolerant of the legacy pid-only format an older
// launcher.js wrote (no space, no token) — that still parses, just with
// `token: null`, so it can never match anything and reads as foreign.
function randomLockToken() {
  return crypto.randomBytes(8).toString('hex');
}

function lockContentFor(pid, token) {
  return `${pid} ${token}`;
}

function parseLockContent(text) {
  const trimmed = String(text == null ? '' : text).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const pid = Number(parts[0]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return { pid, token: parts.length > 1 ? parts[1] : null };
}

function readLockPid(lockPath) {
  try {
    const parsed = parseLockContent(fs.readFileSync(lockPath, 'utf8'));
    return parsed ? parsed.pid : null;
  } catch (_) { return null; }
}

function lockAgeMs(lockPath) {
  try { return Date.now() - fs.statSync(lockPath).mtimeMs; } catch (_) { return 0; }
}

// Everything readable about whatever is CURRENTLY sitting at `lockPath`,
// taken as close together as separate syscalls allow — the mtime first,
// then the bytes, so a later comparison (see reclaimStaleLock) can tell "the
// same lock I judged stale a moment ago" from "a fresh one someone just
// took" even though nothing here is one atomic operation. Returns null only
// when the path is actually gone (ENOENT on the stat itself) — a lock that
// exists but whose content can't be read comes back with `parsed: null`,
// never as absent; see acquireStartLock for why that distinction matters.
function statLock(lockPath) {
  let mtimeMs;
  try { mtimeMs = fs.statSync(lockPath).mtimeMs; } catch (_) { return null; }
  let raw = '';
  try { raw = fs.readFileSync(lockPath, 'utf8'); } catch (_) { /* vanished just now, or unreadable */ }
  return { mtimeMs, raw, parsed: parseLockContent(raw) };
}

// Gives `lockPath` its content with no window where the name exists but is
// still empty. The old `fs.writeFileSync(lockPath, ..., { flag: 'wx' })`
// path is actually TWO syscalls under the hood — open(O_CREAT|O_EXCL) then
// write() — and the open alone already makes the lock exist, zero bytes,
// before the pid ever lands in it; a reader landing in that gap saw an
// unreadable lock and treated it as stale (see the old acquireStartLock).
// Writing the full content to a throwaway, uniquely-named temp file first —
// an ordinary, complete synchronous write — and only then giving the LOCK's
// own name a link to that same, already-full inode closes the gap: the name
// `lockPath` never resolves to anything until the bytes behind it are
// whole. `fs.linkSync` failing with EEXIST means someone else's lock is
// already there, exactly like the old `wx` write did. The temp name is
// removed either way; the content lives on through the link, never through
// the temp name. Falls back to the old `wx` write on a filesystem that
// can't hardlink at all — network shares mostly (EPERM/ENOTSUP/EXDEV), but
// also FAT/exFAT, where CreateHardLink's failure libuv maps to EISDIR —
// where the empty-then-written window is, unavoidably, back.
function isPendingDeleteCode(code) {
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

function createLockAtomic(lockPath, content) {
  const tmp = `${lockPath}.${process.pid}.${randomLockToken()}.tmp`;
  fs.writeFileSync(tmp, content);
  try {
    fs.linkSync(tmp, lockPath);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    if (e.code === 'EPERM' || e.code === 'ENOTSUP' || e.code === 'EXDEV' || e.code === 'EISDIR') {
      try {
        fs.writeFileSync(lockPath, content, { flag: 'wx' });
        return true;
      } catch (e2) {
        // On Windows a name whose previous file is still being deleted
        // refuses a new create with EPERM (EACCES/EBUSY under a scanner):
        // someone just released or reclaimed it, so this round is lost,
        // not broken. The temp write above already proved the folder
        // itself is writable.
        if (e2.code === 'EEXIST' || isPendingDeleteCode(e2.code)) return false;
        throw e2;
      }
    }
    throw e;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

// Reclaims a lock already judged stale (see acquireStartLock) WITHOUT the
// old check-then-delete — and without `fs.renameSync` at all. It measured as
// genuinely unreliable for this under concurrent racers on this Windows
// filesystem: two threads racing `renameSync` off the SAME source (even to
// the SAME destination) can BOTH come back success, and two threads racing
// plain `fs.unlinkSync` on the SAME path can too (a stress probe against
// this exact setup saw ~25-48% of trials report a double "success" for
// each) — almost certainly a filter-driver artifact (AV/indexing) rather
// than a Node bug, but real on a machine this code has to run on regardless.
// `fs.linkSync` creating a brand-new destination name did NOT show this
// (0/200 in the same probe), matching what createLockAtomic already leans
// on, so reclaiming is built on the same "exclusive create of a brand-new
// name" idea — but via a plain `wx` write, not a link. A ticket's bytes are
// never read by anyone (only its existence, via EEXIST, is ever
// consulted), so the empty-then-written window `createLockAtomic` goes to
// such lengths to avoid, for the LOCK's own content, simply doesn't matter
// here — and `wx` needs no hard-link support at all, so it works on every
// filesystem createLockAtomic itself has to fall back for (see above).
//
// Every racer that judges the SAME exact stale generation (identical bytes
// AND mtime — see `snap`) computes the SAME deterministic "reclaim ticket"
// name for it. Only one of them can create that exact name — reliably
// exclusive — so exactly one racer becomes its ticket-holder and goes on to
// unlink `lockPath`. Every other racer sees EEXIST.
//
// A ticket-holder that then dies before unlinking `lockPath` (window
// closed, process killed) would otherwise wedge this generation forever:
// `lockPath` never leaves, so every later racer keeps recomputing the same
// ticket name and keeps losing it to the dead holder's orphaned ticket.
// So EEXIST is not itself the final word — a ticket younger than
// LOCK_STALE_MS means its holder is plausibly still mid-reclaim (a handful
// of sync fs calls, never actually this slow) and is respected as-is, but
// once a ticket has sat that long its holder is presumed dead, and the next
// racer to see it steps up a generation (`.reclaim.<hash>.<n>`) rather than
// deferring to it forever. Only one racer at a time can win any given
// generation's ticket, so this still ends with exactly one arbiter, just
// possibly a few generations deep.
//
// The ticket-holder is now the ONLY thread that will ever call
// `fs.unlinkSync(lockPath)` for this generation — no concurrent racing on
// that call, so the flakiness above doesn't apply to it. The unlink is
// not safe on its own, though: a slow racer can win this generation's ticket after
// the first winner has already reclaimed the lock, released it, and a new
// lock has been taken at `lockPath`. The re-check right before unlinking is
// what stops that racer deleting the new lock, so it is load-bearing.
const RECLAIM_TICKET_GENERATION_LIMIT = 1000;

function reclaimStaleLock(lockPath, snap) {
  const identity = `${snap.mtimeMs}|${snap.raw}`;
  const baseTicketPath = `${lockPath}.reclaim.${crypto.createHash('sha1').update(identity).digest('hex').slice(0, 16)}`;

  let ticketPath = null;
  for (let gen = 0; gen < RECLAIM_TICKET_GENERATION_LIMIT; gen++) {
    const candidate = gen === 0 ? baseTicketPath : `${baseTicketPath}.${gen}`;
    try {
      fs.writeFileSync(candidate, '', { flag: 'wx' });
      ticketPath = candidate;
      break;
    } catch (e) {
      // A ticket still being deleted by the racer that just used it refuses
      // a new create on Windows (see isPendingDeleteCode): that racer is
      // mid-reclaim, so defer to it exactly as for EEXIST.
      if (isPendingDeleteCode(e.code)) return;
      if (e.code !== 'EEXIST') throw e;
    }
    if (lockAgeMs(candidate) < LOCK_STALE_MS) return; // a live racer already owns this generation — defer to them
    // Otherwise its holder is presumed dead: loop and try the next generation.
  }
  if (ticketPath == null) return; // pathologically many dead generations in a row — give up this round, retry later

  const current = statLock(lockPath);
  if (current && current.mtimeMs === snap.mtimeMs && current.raw === snap.raw) {
    try { fs.unlinkSync(lockPath); } catch (_) {}
  }
  try { fs.unlinkSync(ticketPath); } catch (_) {}
}

// Serializes the "decide whether to start a server" window across racing
// `run()` calls for the SAME wrapper. Without this, two runs fired close
// together each probe, each see nothing answering yet, and each spawn their
// own server.js — for a PINNED port the loser's bind fails outright
// (EADDRINUSE on a pin is fatal, recovered via pollForServedBoard in
// startAndAttach above), but for the common unpinned case server.js just
// auto-increments past the busy port, so the loser's spawn quietly succeeds
// too and two live servers end up serving the same board.
//
// A lock that already exists but names a dead pid was left by a launcher
// whose whole process tree died (e.g. the console window was force-closed)
// before it could release it; that's reclaimed rather than left to jam
// every future run for this board.
//
// A lock naming a LIVE pid is not automatically safe, though: Windows
// reuses a pid the moment its process exits (a console window closed
// mid-start is exactly this), and a lock file arriving through a synced
// folder can name some other machine's pid entirely, alive here by sheer
// coincidence. Neither case is distinguishable from a real holder by pid
// liveness alone, so age backs it up — a start never takes long, so a lock
// older than LOCK_STALE_MS is reclaimed regardless of what its pid says.
//
// A lock whose content can't be read at all (or is empty) is never treated
// as stale outright, only as stale once it's also OLD: createLockAtomic
// means that can no longer happen for a lock THIS code wrote, but it costs
// nothing to stay cautious about one that arrived some other way (a synced
// folder catching it truly mid-write, say) — a young, unreadable lock is
// exactly what a lock a heartbeat into being created looks like from the
// outside, and reclaiming it is the old bug.
const LOCK_STALE_MS = 30000;

// The token each successful acquireStartLock call took its lock with,
// keyed by lockPath — this process's own record of what it currently holds,
// consulted by stillHoldsStartLock and releaseStartLock so this process
// only ever touches a lock its OWN most recent acquisition actually won,
// never a later generation it lost track of.
const heldStartLockTokens = new Map();

function acquireStartLock(lockPath, maxStaleRetries = 20) {
  for (let i = 0; i < maxStaleRetries; i++) {
    const token = randomLockToken();
    if (createLockAtomic(lockPath, lockContentFor(process.pid, token))) {
      heldStartLockTokens.set(lockPath, token);
      return true;
    }

    const snap = statLock(lockPath);
    if (!snap) continue; // vanished between the failed create and this stat — try again

    // Stale when its mtime is more than LOCK_STALE_MS from now in EITHER
    // direction: a future mtime (clock skew on a synced folder) would
    // otherwise never age out, while a just-written lock can read a
    // millisecond ahead of Date.now() and must still count as fresh.
    const fresh = Math.abs(Date.now() - snap.mtimeMs) < LOCK_STALE_MS;
    const holderAlive = !!(snap.parsed && isPidAlive(snap.parsed.pid));
    // A readable lock is held only while its pid is alive AND it's fresh.
    // An unreadable/empty one has no pid to check liveness against, so age
    // alone decides — see the LOCK_STALE_MS comment above.
    const held = snap.parsed ? (holderAlive && fresh) : fresh;
    if (held) return false;

    reclaimStaleLock(lockPath, snap);
  }
  return false;
}

// Whether THIS process still holds `lockPath` with the exact token its own
// last successful acquireStartLock call took it with — never true after
// another process has verified-reclaimed it out from under this one (see
// reclaimStaleLock), and never true for a lock this process never actually
// won. The caller in runLauncher checks this right before spawning the
// server, so a token it lost between acquiring and spawning is caught
// before a second server ever starts.
function stillHoldsStartLock(lockPath) {
  const myToken = heldStartLockTokens.get(lockPath);
  if (myToken == null) return false;
  const snap = statLock(lockPath);
  return !!(snap && snap.parsed && snap.parsed.token === myToken);
}

// Only removes the lock while it still carries the token OUR most recent
// successful acquireStartLock call took it with — never a later
// generation's lock this process happened to lose the race to reclaim, and
// never a lock this process never actually won in the first place.
function releaseStartLock(lockPath) {
  const myToken = heldStartLockTokens.get(lockPath);
  heldStartLockTokens.delete(lockPath);
  if (myToken == null) return;
  const snap = statLock(lockPath);
  if (!snap || !snap.parsed || snap.parsed.token !== myToken) return;
  try { fs.unlinkSync(lockPath); } catch (_) {}
}

// Every candidate port this board might already be served on (paired pid
// file, then .kanban-app.pid, then the CLI port `run` was given, then
// config.yaml's pin), probed in order — the board counts as running the
// moment ANY of them answers as it, never shadowed by an earlier candidate
// (e.g. a stale paired pid naming the wrong port) that simply didn't answer.
// Returns the answering port, or null. Reads the pid files and config fresh
// on every call: runLauncher calls this both before AND after taking the
// start lock, since the state on disk can change in the gap between the two.
async function findServedPort(boardDirAbs, pidPath, appPidPath, platform, cliPort = null) {
  const pairedPid = readPidFile(pidPath);
  const appPid = readPidFile(appPidPath);
  const pairedAlive = !!pairedPid && isPidAlive(pairedPid.pid);
  const appAlive = !!appPid && isPidAlive(appPid.pid);
  const config = cfg.readConfig(boardDirAbs);
  const ports = candidatePorts({
    pairedPort: pairedAlive ? pairedPid.port : null,
    appPort: appAlive ? appPid.port : null,
    cliPort,
    configPort: config.port || null,
  });
  for (const port of ports) {
    const answeredBoardDir = await probeBoardDir(port, 800);
    if (decideRunning({ port, answeredBoardDir, targetBoardDir: boardDirAbs, platform })) return port;
  }
  return null;
}

// `launcher.js run` — what the wrapper calls. Checks whether the board is
// already served; if so opens the browser and exits 0 starting nothing.
// Otherwise takes the start lock (see acquireStartLock) so at most one
// racing `run()` for this wrapper ever gets to the spawn decision at a
// time: the loser instead waits for the winner to either finish binding —
// proof is .kanban-app.pid or the config pin, same as an already-running
// board — or give up, and retries from the top if the winner never
// produces a running server at all. `explicitBaseName` is the wrapper's own
// base name (its third argv) — pairing against the exact pid file the
// invoking wrapper names, never a marker-order guess; falls back to the
// guess only for an older wrapper that never passed one. `serverArgs` is
// everything the wrapper was written with after the board dir/baseName (a
// port and/or --allow-origin — see writeLauncher/renderWrapper), replayed
// verbatim into the spawned server.js so a board started the documented way
// restarts with the exact same port/origin instead of drifting to 7777.
async function runLauncher(boardDirArg, explicitBaseName, serverArgs = []) {
  const boardDirAbs = path.resolve(boardDirArg);
  if (!fs.existsSync(boardDirAbs)) throw new Error(`board dir not found: ${boardDirAbs}`);
  const platform = process.platform;
  const { dir: whereDir } = resolveWhere(boardDirAbs);
  const baseName = explicitBaseName || resolveBaseNameForBoard(whereDir, boardDirAbs, platform);
  const pidPath = path.join(whereDir, pidFileName(baseName));
  const appPidPath = path.join(boardDirAbs, '.kanban-app.pid');
  const lockPath = path.join(whereDir, lockFileName(baseName));
  const cliPort = cliPortFromServerArgs(serverArgs);

  let toldWaiting = false;
  for (;;) {
    const served = await findServedPort(boardDirAbs, pidPath, appPidPath, platform, cliPort);
    if (served != null) { await openBoard(served, boardDirAbs); return 0; }

    if (!acquireStartLock(lockPath)) {
      // Someone else is already deciding (or starting) this exact board's
      // server. Wait for THEM rather than racing our own probe/spawn
      // against theirs.
      if (!toldWaiting) {
        console.log('Kanban app: another launch is already starting this board — waiting for it...');
        toldWaiting = true;
      }
      const servedByOther = await pollForServedBoard(boardDirAbs, appPidPath, { timeoutMs: 8000 }, cliPort);
      if (servedByOther != null) { await openBoard(servedByOther, boardDirAbs); return 0; }
      continue; // the lock holder never produced a running server — retry
    }

    try {
      // Re-check under the lock: the board could have gone from "not
      // served" to "served and the lock already released" in the gap
      // between the probe above and winning the lock just now.
      const servedNow = await findServedPort(boardDirAbs, pidPath, appPidPath, platform, cliPort);
      if (servedNow != null) { await openBoard(servedNow, boardDirAbs); return 0; }
      // One more check, right before actually spawning: a verified stale
      // reclaim (see reclaimStaleLock) can, in principle, have taken this
      // lock away from us in the gap since acquireStartLock returned —
      // proceeding to spawn anyway would risk a second server for this
      // board. If we've lost it, we own nothing to release; go back around
      // and wait for whoever holds it now instead.
      if (!stillHoldsStartLock(lockPath)) continue;
      const appPid = readPidFile(appPidPath);
      const appAlive = !!appPid && isPidAlive(appPid.pid);
      return await startAndAttach(boardDirAbs, pidPath, appAlive, () => releaseStartLock(lockPath), serverArgs);
    } finally {
      // Belt-and-braces: startAndAttach's onDecided already releases the
      // lock on every path it takes, but this guarantees it never survives
      // a run() call that returns or throws for any other reason.
      releaseStartLock(lockPath);
    }
  }
}

module.exports = {
  osWrapperExt, wrapperFileName, pidFileName, lockFileName, markerLine, markerCommentLine, parseMarkerBoardDir,
  sameBoardDir, wrapperNameCandidates, chooseWrapperName, sanitizeForWindowsTitle,
  escapePercentForCmd, singleQuotePosix, renderWrapper, sanitizeServerArgsForWrapper,
  missingExcludeNames, excludeAppendBuffer, escapeGitExcludeSegment, anchoredExcludeName, parsePidFileText,
  candidatePorts, cliPortFromServerArgs, decideRunning,
  shouldForwardSignal, launcherExitCode, boardDisplayName, resolveWhere, gitRepoRoot, gitShowPrefix, boardUrl, browserHost,
  gitInfoExcludePath, listWrapperMarkers, boardDirStillThere, resolveBaseNameForBoard, readPidFile, isPidAlive,
  probeBoardDir, openBrowser, pollForServedBoard, findServedPort,
  readLockPid, parseLockContent, acquireStartLock, stillHoldsStartLock, releaseStartLock, lockAgeMs,
  removeLockSiblings, migrateOldLocationLauncher,
  writeLauncher, runLauncher,
};

if (require.main === module) {
  const [, , cmd, boardDirArg, ...rest] = process.argv;
  if (cmd === 'write' && boardDirArg) {
    try {
      const wrapperPath = writeLauncher(boardDirArg, rest);
      console.log(`Launcher written: ${wrapperPath}`);
    } catch (e) { console.error(e.message); process.exit(1); }
  } else if (cmd === 'run' && boardDirArg) {
    const [baseNameArg, ...serverArgs] = rest;
    runLauncher(boardDirArg, baseNameArg, serverArgs).then((code) => process.exit(code)).catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    console.error('usage: launcher.js write <kanban-dir> [server args...]');
    console.error('       launcher.js run <kanban-dir> <baseName> [server args...]');
    process.exit(1);
  }
}
