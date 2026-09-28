const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');
const launcher = require('../scripts/launcher');

const LAUNCHER_PATH = path.join(__dirname, '..', 'scripts', 'launcher.js');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor(fn, { timeout = 8000, interval = 50 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, interval));
  }
}

function killQuiet(pid) {
  if (!pid) return;
  try { process.kill(pid); } catch (_) { /* already gone */ }
}

// --- pure: OS naming -------------------------------------------------------

test('osWrapperExt/wrapperFileName/pidFileName per OS', () => {
  assert.strictEqual(launcher.osWrapperExt('win32'), '.cmd');
  assert.strictEqual(launcher.osWrapperExt('darwin'), '.command');
  assert.strictEqual(launcher.osWrapperExt('linux'), '.sh');
  assert.strictEqual(launcher.wrapperFileName('kanban_web', 'win32'), 'kanban_web.cmd');
  assert.strictEqual(launcher.wrapperFileName('kanban_web-alpha', 'darwin'), 'kanban_web-alpha.command');
  assert.strictEqual(launcher.pidFileName('kanban_web-alpha'), 'kanban_web-alpha.pid');
});

// --- pure: marker line ------------------------------------------------------

test('markerCommentLine uses rem on Windows, # elsewhere', () => {
  assert.strictEqual(launcher.markerCommentLine('win32', 'C:\\board'), 'rem kanban-web-board: C:\\board');
  assert.strictEqual(launcher.markerCommentLine('linux', '/home/x/board'), '# kanban-web-board: /home/x/board');
});

test('parseMarkerBoardDir reads either comment style, and null when absent', () => {
  assert.strictEqual(launcher.parseMarkerBoardDir('rem kanban-web-board: C:\\a\\b\r\ntitle x'), 'C:\\a\\b');
  assert.strictEqual(launcher.parseMarkerBoardDir('#!/bin/sh\n# kanban-web-board: /a/b\nexec x'), '/a/b');
  assert.strictEqual(launcher.parseMarkerBoardDir('@echo off\ntitle nope'), null);
  assert.strictEqual(launcher.parseMarkerBoardDir(''), null);
});

// --- pure: board-dir equality ----------------------------------------------

test('sameBoardDir is case-insensitive on win32, case-sensitive elsewhere', () => {
  assert.ok(launcher.sameBoardDir('C:\\Board\\X', 'c:\\board\\x', 'win32'));
  assert.ok(!launcher.sameBoardDir('/Board/X', '/board/x', 'linux'));
  assert.ok(launcher.sameBoardDir('/board/x', '/board/x', 'linux'));
});

test('sameBoardDir is false for a different path, or a missing side', () => {
  assert.ok(!launcher.sameBoardDir('C:\\a', 'C:\\b', 'win32'));
  assert.ok(!launcher.sameBoardDir(null, 'C:\\a', 'win32'));
  assert.ok(!launcher.sameBoardDir('C:\\a', undefined, 'win32'));
});

// --- pure: collision naming --------------------------------------------------

test('wrapperNameCandidates: kanban_web, then the board-name suffix, then numbered', () => {
  const first3 = [];
  const it = launcher.wrapperNameCandidates('alpha');
  for (let i = 0; i < 3; i++) first3.push(it.next().value);
  assert.deepStrictEqual(first3, ['kanban_web', 'kanban_web-alpha', 'kanban_web-alpha-2']);
});

test('chooseWrapperName picks kanban_web when nothing exists yet', () => {
  const name = launcher.chooseWrapperName('/board/one', 'One', [], 'linux');
  assert.strictEqual(name, 'kanban_web');
});

test('chooseWrapperName reuses kanban_web for the SAME board (healing rewrite)', () => {
  const existing = [{ baseName: 'kanban_web', markerBoardDir: '/board/one' }];
  const name = launcher.chooseWrapperName('/board/one', 'One', existing, 'linux');
  assert.strictEqual(name, 'kanban_web');
});

test('chooseWrapperName suffixes when kanban_web already serves a DIFFERENT board', () => {
  const existing = [{ baseName: 'kanban_web', markerBoardDir: '/board/other' }];
  const name = launcher.chooseWrapperName('/board/two', 'Two', existing, 'linux');
  assert.strictEqual(name, 'kanban_web-two');
});

test('chooseWrapperName never picks a name that serves a different board, even the suffixed one', () => {
  const existing = [
    { baseName: 'kanban_web', markerBoardDir: '/board/other' },
    { baseName: 'kanban_web-two', markerBoardDir: '/board/yet-another' },
  ];
  const name = launcher.chooseWrapperName('/board/two', 'Two', existing, 'linux');
  assert.strictEqual(name, 'kanban_web-two-2');
});

test('chooseWrapperName treats an unparseable marker as belonging to a different board', () => {
  const existing = [{ baseName: 'kanban_web', markerBoardDir: null }];
  const name = launcher.chooseWrapperName('/board/two', 'Two', existing, 'linux');
  assert.strictEqual(name, 'kanban_web-two');
});

test('chooseWrapperName reclaims a name whose marker board dir no longer exists (moved/renamed project)', () => {
  const existing = [{ baseName: 'kanban_web', markerBoardDir: '/board/gone', markerBoardDirExists: false }];
  const name = launcher.chooseWrapperName('/board/two', 'Two', existing, 'linux');
  assert.strictEqual(name, 'kanban_web', 'the dead marker is reclaimed rather than suffixed');
});

test('chooseWrapperName does NOT reclaim a name whose marker board dir still exists', () => {
  const existing = [{ baseName: 'kanban_web', markerBoardDir: '/board/other', markerBoardDirExists: true }];
  const name = launcher.chooseWrapperName('/board/two', 'Two', existing, 'linux');
  assert.strictEqual(name, 'kanban_web-two');
});

// --- pure: wrapper text ------------------------------------------------------

test('renderWrapper (win32): marker, helper-exists check, exec line, CRLF', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\Users\\x y\\board\\.kanban', boardName: 'X Board',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\Users\\x y\\launcher.js',
  });
  assert.match(text, /^@echo off\r\n/);
  assert.match(text, /rem kanban-web-board: C:\\Users\\x y\\board\\\.kanban\r\n/);
  assert.match(text, /if exist "C:\\Users\\x y\\launcher\.js" goto run/);
  assert.match(text, /:run\r\n"C:\\node\.exe" "C:\\Users\\x y\\launcher\.js" run "C:\\Users\\x y\\board\\\.kanban"/);
  assert.match(text, /if errorlevel 1 pause/);
  assert.ok(!text.includes('\n\n'), 'no bare LF introduced alongside CRLF');
});

test('renderWrapper (win32): chcp 65001 runs right after @echo off, before any path/name is read', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\Users\\x\\Diseño y más\\.kanban', boardName: 'Board',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\launcher.js',
  });
  const lines = text.split('\r\n');
  assert.strictEqual(lines[0], '@echo off');
  assert.strictEqual(lines[1], 'chcp 65001 >nul');
});

test('renderWrapper (win32): board-name cmd metacharacters never reach the title line raw', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\board', boardName: 'R&D board > out.txt & del /s *',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\launcher.js',
  });
  const titleLine = text.split('\r\n').find((l) => l.startsWith('title '));
  assert.ok(titleLine, 'has a title line');
  assert.ok(!/[&|<>^%"]/.test(titleLine), `title line must carry no cmd metacharacters: ${titleLine}`);
});

test('sanitizeForWindowsTitle strips cmd metacharacters and collapses newlines to spaces', () => {
  assert.strictEqual(launcher.sanitizeForWindowsTitle('R&D board'), 'R_D board');
  assert.strictEqual(launcher.sanitizeForWindowsTitle('a > b < c | d ^ e % f " g'), 'a _ b _ c _ d _ e _ f _ g');
  assert.strictEqual(launcher.sanitizeForWindowsTitle('line1\nline2\r\nline3'), 'line1 line2 line3');
  assert.strictEqual(launcher.sanitizeForWindowsTitle(''), '');
  assert.strictEqual(launcher.sanitizeForWindowsTitle(null), '');
});

test('renderWrapper (linux/mac): shebang, marker, helper-exists check, exec, LF only', () => {
  const text = launcher.renderWrapper({
    platform: 'linux', boardDirAbs: '/home/x y/board/.kanban', boardName: 'X Board',
    nodePath: '/usr/bin/node', helperPath: '/home/x y/launcher.js',
  });
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.match(text, /# kanban-web-board: \/home\/x y\/board\/\.kanban\n/);
  assert.match(text, /if \[ ! -f "\/home\/x y\/launcher\.js" \]; then/);
  assert.match(text, /exec "\/usr\/bin\/node" "\/home\/x y\/launcher\.js" run "\/home\/x y\/board\/\.kanban"/);
  assert.ok(!text.includes('\r'), 'no CR in a POSIX shell script');
});

// --- pure: info/exclude merge ------------------------------------------------

test('mergeExcludeEntries adds names once, appends to what is already there', () => {
  assert.strictEqual(launcher.mergeExcludeEntries('', ['a', 'b']), 'a\nb\n');
  assert.strictEqual(launcher.mergeExcludeEntries('existing\n', ['a']), 'existing\na\n');
  assert.strictEqual(launcher.mergeExcludeEntries('a\nb\n', ['a', 'c']), 'a\nb\nc\n');
});

test('mergeExcludeEntries is a no-op once every name is already present', () => {
  const once = launcher.mergeExcludeEntries('', ['a', 'b']);
  assert.strictEqual(launcher.mergeExcludeEntries(once, ['a', 'b']), once);
});

test('mergeExcludeEntries tolerates a file missing its final newline', () => {
  assert.strictEqual(launcher.mergeExcludeEntries('a', ['b']), 'a\nb\n');
});

// --- pure: pid file parsing --------------------------------------------------

test('parsePidFileText reads pid + port, tolerates a missing/bad port', () => {
  assert.deepStrictEqual(launcher.parsePidFileText('123\n7777\n'), { pid: 123, port: 7777 });
  assert.deepStrictEqual(launcher.parsePidFileText('123\n'), { pid: 123, port: null });
  assert.deepStrictEqual(launcher.parsePidFileText('123\nnope\n'), { pid: 123, port: null });
  assert.strictEqual(launcher.parsePidFileText(''), null);
  assert.strictEqual(launcher.parsePidFileText('not-a-pid\n7777\n'), null);
});

// --- pure: port choice + running decision ------------------------------------

test('candidatePorts: every live/pinned port, in priority order, deduped, nulls dropped', () => {
  assert.deepStrictEqual(launcher.candidatePorts({ pairedPort: 1, appPort: 2, configPort: 3 }), [1, 2, 3]);
  assert.deepStrictEqual(launcher.candidatePorts({ pairedPort: null, appPort: 2, configPort: 3 }), [2, 3]);
  assert.deepStrictEqual(launcher.candidatePorts({ pairedPort: null, appPort: null, configPort: 3 }), [3]);
  assert.deepStrictEqual(launcher.candidatePorts({ pairedPort: null, appPort: null, configPort: null }), []);
  assert.deepStrictEqual(
    launcher.candidatePorts({ pairedPort: 7777, appPort: 7777, configPort: 7777 }),
    [7777],
    'the same port named by multiple sources is probed once',
  );
});

test('shouldForwardSignal: POSIX forwards Ctrl+C/TERM to the child; win32 does not (the child already gets its own console event)', () => {
  assert.strictEqual(launcher.shouldForwardSignal('linux'), true);
  assert.strictEqual(launcher.shouldForwardSignal('darwin'), true);
  assert.strictEqual(launcher.shouldForwardSignal('win32'), false);
});

test('launcherExitCode: a real exit code wins; a signal-killed child (code null) reads as 0 only when we saw Ctrl+C ourselves', () => {
  assert.strictEqual(launcher.launcherExitCode(0, false), 0);
  assert.strictEqual(launcher.launcherExitCode(1, false), 1);
  assert.strictEqual(launcher.launcherExitCode(null, false), 1);
  assert.strictEqual(launcher.launcherExitCode(null, true), 0);
});

test('decideRunning requires both a port and a matching answered boardDir', () => {
  assert.strictEqual(launcher.decideRunning({ port: null, answeredBoardDir: '/b', targetBoardDir: '/b' }), false);
  assert.strictEqual(launcher.decideRunning({ port: 7777, answeredBoardDir: null, targetBoardDir: '/b' }), false);
  assert.strictEqual(launcher.decideRunning({ port: 7777, answeredBoardDir: '/other', targetBoardDir: '/b', platform: 'linux' }), false);
  assert.strictEqual(launcher.decideRunning({ port: 7777, answeredBoardDir: '/b', targetBoardDir: '/b', platform: 'linux' }), true);
  assert.strictEqual(launcher.decideRunning({ port: 7777, answeredBoardDir: 'C:\\B', targetBoardDir: 'c:\\b', platform: 'win32' }), true);
});

// --- integration: write ------------------------------------------------------

function initRepo() {
  const dir = tmpDir('kanban-launcher-repo-');
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

test('writeLauncher: wrapper at the repo root, exclude entries, rewrite heals in place, collision suffixes a second board, first launcher untouched', () => {
  const repo = initRepo();
  const ext = launcher.osWrapperExt(process.platform);
  try {
    const board1 = path.join(repo, '.kanban');
    fs.mkdirSync(board1);
    fs.writeFileSync(path.join(board1, 'config.yaml'), 'name: Alpha Board\n');

    const w1 = launcher.writeLauncher(board1);
    assert.strictEqual(w1, path.join(repo, `kanban_web${ext}`));
    const board1Abs = path.resolve(board1);
    let content1 = fs.readFileSync(w1, 'utf8');
    assert.ok(content1.includes(launcher.markerLine(board1Abs)), 'wrapper carries the board marker');
    assert.ok(content1.includes(LAUNCHER_PATH), 'wrapper calls back into this launcher.js by absolute path');
    assert.ok(content1.includes(process.execPath), 'wrapper pins the node binary used at write time');

    const excludePath = launcher.gitInfoExcludePath(board1);
    assert.ok(excludePath, 'repo has an info/exclude path');
    let excludeText = fs.readFileSync(excludePath, 'utf8');
    assert.strictEqual((excludeText.match(new RegExp(`^kanban_web${ext.replace('.', '\\.')}$`, 'm')) || []).length, 1);
    assert.strictEqual((excludeText.match(/^kanban_web\.pid$/m) || []).length, 1);

    // Rewriting the same board heals in place: same path, marker unchanged,
    // and the exclude file does not grow a duplicate line.
    const w1b = launcher.writeLauncher(board1);
    assert.strictEqual(w1b, w1);
    const excludeText2 = fs.readFileSync(excludePath, 'utf8');
    assert.strictEqual(excludeText2, excludeText, 'writing twice does not duplicate exclude entries');

    // A second board in the same repo collides on kanban_web and gets suffixed.
    const board2 = path.join(repo, '.kanban2');
    fs.mkdirSync(board2);
    fs.writeFileSync(path.join(board2, 'config.yaml'), 'name: Beta Board\n');
    const w2 = launcher.writeLauncher(board2);
    assert.strictEqual(w2, path.join(repo, `kanban_web-beta-board${ext}`));
    assert.notStrictEqual(w2, w1);

    // The first board's launcher is never touched by the second board's write.
    const content1After = fs.readFileSync(w1, 'utf8');
    assert.strictEqual(content1After, content1, 'board 1 launcher is byte-for-byte unchanged');
    assert.ok(content1After.includes(launcher.markerLine(board1Abs)));

    const excludeText3 = fs.readFileSync(excludePath, 'utf8');
    assert.strictEqual((excludeText3.match(new RegExp(`^kanban_web-beta-board${ext.replace('.', '\\.')}$`, 'm')) || []).length, 1);
    assert.strictEqual((excludeText3.match(/^kanban_web-beta-board\.pid$/m) || []).length, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('writeLauncher: no repository writes to the board dir\'s parent folder and skips info/exclude', () => {
  const parent = tmpDir('kanban-launcher-norepo-');
  const ext = launcher.osWrapperExt(process.platform);
  try {
    const board = path.join(parent, '.kanban');
    fs.mkdirSync(board);
    const w = launcher.writeLauncher(board);
    assert.strictEqual(w, path.join(parent, `kanban_web${ext}`));
    assert.strictEqual(launcher.gitInfoExcludePath(board), null);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('writeLauncher: renaming/moving the project heals the launcher in place instead of orphaning it', () => {
  const base = tmpDir('kanban-launcher-moved-');
  const ext = launcher.osWrapperExt(process.platform);
  try {
    const oldProj = path.join(base, 'proj-old');
    fs.mkdirSync(oldProj);
    const oldBoard = path.join(oldProj, '.kanban');
    fs.mkdirSync(oldBoard);
    const w1 = launcher.writeLauncher(oldBoard);
    assert.strictEqual(w1, path.join(oldProj, `kanban_web${ext}`));

    // The whole project folder moves — the wrapper file moves with it, but
    // its marker still names the OLD absolute board path until healed.
    const newProj = path.join(base, 'proj-new');
    fs.renameSync(oldProj, newProj);
    const newBoard = path.join(newProj, '.kanban');

    const w2 = launcher.writeLauncher(newBoard);
    assert.strictEqual(w2, path.join(newProj, `kanban_web${ext}`), 'the familiar name is reclaimed, never suffixed');
    const content = fs.readFileSync(w2, 'utf8');
    assert.ok(content.includes(launcher.markerLine(path.resolve(newBoard))), 'the marker now names the current board dir');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// --- integration: run --------------------------------------------------------

test('run: starts the server, writes the paired pid, a concurrent run starts nothing, cleanly killing the server removes the pid, a stale paired pid does not block a start', async () => {
  const port = await freePort();
  const dir = tmpDir('kanban-launcher-run-');
  const where = path.dirname(dir); // no git repo here -> parent folder
  const pidPath = path.join(where, 'kanban_web.pid');
  fs.writeFileSync(path.join(dir, 'config.yaml'), `port: ${port}\n`);

  let proc1 = null;
  let serverPid = null;
  try {
    proc1 = spawn(process.execPath, [LAUNCHER_PATH, 'run', dir], {
      env: { ...process.env, KANBAN_WEB_NO_BROWSER: '1' },
      stdio: 'ignore',
    });

    await waitFor(() => fs.existsSync(pidPath) && fs.readFileSync(pidPath, 'utf8').trim() !== '');
    const info = launcher.parsePidFileText(fs.readFileSync(pidPath, 'utf8'));
    assert.ok(info, 'paired pid file parses');
    assert.strictEqual(info.port, port, 'the pinned port was used, unchanged');
    serverPid = info.pid;
    assert.notStrictEqual(serverPid, proc1.pid, 'the paired pid names the spawned server, not the launcher itself');

    const seenBoardDir = await waitFor(() => launcher.probeBoardDir(port, 500));
    assert.ok(launcher.sameBoardDir(seenBoardDir, dir), 'the port answers as THIS board');

    // A second run while the first is up starts nothing and exits 0.
    const secondExit = await new Promise((resolve, reject) => {
      const proc2 = spawn(process.execPath, [LAUNCHER_PATH, 'run', dir], {
        env: { ...process.env, KANBAN_WEB_NO_BROWSER: '1' },
        stdio: 'ignore',
      });
      proc2.on('exit', (code) => resolve(code));
      proc2.on('error', reject);
    });
    assert.strictEqual(secondExit, 0, 'an already-running board exits 0 without starting anything');
    const infoAfter = launcher.parsePidFileText(fs.readFileSync(pidPath, 'utf8'));
    assert.strictEqual(infoAfter.pid, serverPid, 'the paired pid still names the original server');

    // Killing the server the launcher is attached to removes the paired pid
    // file, and the launcher process (watching the child) exits too.
    const proc1Exit = new Promise((resolve) => proc1.on('exit', (code) => resolve(code)));
    killQuiet(serverPid);
    await proc1Exit;
    await waitFor(() => !fs.existsSync(pidPath));
  } finally {
    killQuiet(serverPid);
    if (proc1 && proc1.exitCode === null) killQuiet(proc1.pid);
    try { fs.unlinkSync(pidPath); } catch (_) { /* already removed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run: a stale paired pid (dead pid) does not block a start', async () => {
  const port = await freePort();
  const dir = tmpDir('kanban-launcher-stale-');
  const where = path.dirname(dir);
  const pidPath = path.join(where, 'kanban_web.pid');
  fs.writeFileSync(path.join(dir, 'config.yaml'), `port: ${port}\n`);

  // A pid that is guaranteed dead: spawn a trivial process and wait for it
  // to exit, then reuse its now-free pid number.
  const deadPid = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', 'process.exit(0)']);
    p.on('exit', () => resolve(p.pid));
  });
  fs.writeFileSync(pidPath, `${deadPid}\n${port + 1}\n`);

  let proc1 = null;
  let serverPid = null;
  try {
    proc1 = spawn(process.execPath, [LAUNCHER_PATH, 'run', dir], {
      env: { ...process.env, KANBAN_WEB_NO_BROWSER: '1' },
      stdio: 'ignore',
    });

    await waitFor(() => {
      if (!fs.existsSync(pidPath)) return false;
      const info = launcher.parsePidFileText(fs.readFileSync(pidPath, 'utf8'));
      return info && info.pid !== deadPid ? info : false;
    });
    const info = launcher.parsePidFileText(fs.readFileSync(pidPath, 'utf8'));
    assert.notStrictEqual(info.pid, deadPid, 'the stale pid was overwritten by a real, live one');
    assert.strictEqual(info.port, port, 'the pinned port was actually bound');
    serverPid = info.pid;

    const seenBoardDir = await waitFor(() => launcher.probeBoardDir(port, 500));
    assert.ok(launcher.sameBoardDir(seenBoardDir, dir));
  } finally {
    killQuiet(serverPid);
    if (proc1 && proc1.exitCode === null) killQuiet(proc1.pid);
    try { fs.unlinkSync(pidPath); } catch (_) { /* already removed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run: a stale paired pid naming a live-but-unrelated pid on the wrong port must not shadow a genuinely running server, nor delete its .kanban-app.pid', async () => {
  const port = await freePort();
  const dir = tmpDir('kanban-launcher-liveapp-');
  const where = path.dirname(dir);
  const appPidPath = path.join(dir, '.kanban-app.pid');
  const pairedPidPath = path.join(where, 'kanban_web.pid');
  fs.writeFileSync(path.join(dir, 'config.yaml'), `port: ${port}\n`);

  let serverProc = null;
  try {
    // The board is already running the SKILL's way — server.js started
    // directly, never through the launcher — so only .kanban-app.pid exists.
    serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'server.js'), dir], { stdio: 'ignore' });
    await waitFor(() => fs.existsSync(appPidPath) && fs.readFileSync(appPidPath, 'utf8').trim() !== '');
    const appInfo = launcher.parsePidFileText(fs.readFileSync(appPidPath, 'utf8'));
    assert.strictEqual(appInfo.port, port);

    // A paired pid left stale by a closed window: its pid number now
    // happens to belong to this very (guaranteed-alive) test process, and
    // it names a port nothing is listening on.
    const wrongPort = await freePort();
    fs.writeFileSync(pairedPidPath, `${process.pid}\n${wrongPort}\n`);

    const exitCode = await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [LAUNCHER_PATH, 'run', dir], {
        env: { ...process.env, KANBAN_WEB_NO_BROWSER: '1' },
        stdio: 'ignore',
      });
      proc.on('exit', resolve);
      proc.on('error', reject);
    });

    assert.strictEqual(exitCode, 0, 'the already-running board is found via .kanban-app.pid/the config pin, not shadowed by the stale paired pid alone');
    assert.ok(fs.existsSync(appPidPath), '.kanban-app.pid is never deleted out from under a live server');
    const appInfoAfter = launcher.parsePidFileText(fs.readFileSync(appPidPath, 'utf8'));
    assert.strictEqual(appInfoAfter.pid, appInfo.pid, 'still names the original, still-running server');
  } finally {
    killQuiet(serverProc && serverProc.pid);
    try { fs.unlinkSync(pairedPidPath); } catch (_) { /* already removed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
