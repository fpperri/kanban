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

async function waitFor(fn, { timeout = 20000, interval = 50 } = {}) {
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

// Takes the WHOLE process tree rooted at `pid` (win32: a spawned cmd.exe or
// launcher may itself have spawned node/server.js children a plain kill
// would orphan) — belt-and-braces cleanup so a failed assertion never leaves
// a server running.
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' }); } catch (_) { /* already gone */ }
    return;
  }
  killQuiet(pid);
}

// Backstop for a board's OWN .kanban-app.pid, independent of whatever pid we
// think we're tracking — belt-and-braces so a failed assertion (which skips
// the rest of a test body) never leaves the server running.
function killBoardAppPid(boardDir) {
  try {
    const info = launcher.parsePidFileText(fs.readFileSync(path.join(boardDir, '.kanban-app.pid'), 'utf8'));
    if (info) killTree(info.pid);
  } catch (_) { /* absent is fine */ }
}

// --- pure: OS naming -------------------------------------------------------

test('osWrapperExt/wrapperFileName/pidFileName per OS', () => {
  assert.strictEqual(launcher.osWrapperExt('win32'), '.cmd');
  assert.strictEqual(launcher.osWrapperExt('darwin'), '.command');
  assert.strictEqual(launcher.osWrapperExt('linux'), '.sh');
  assert.strictEqual(launcher.wrapperFileName('kanban_web', 'win32'), 'kanban_web.cmd');
  assert.strictEqual(launcher.wrapperFileName('kanban_web-alpha', 'darwin'), 'kanban_web-alpha.command');
  assert.strictEqual(launcher.pidFileName('kanban_web-alpha'), 'kanban_web-alpha.pid');
  assert.strictEqual(launcher.lockFileName('kanban_web-alpha'), 'kanban_web-alpha.lock');
});

// --- pure: marker line ------------------------------------------------------

test('markerCommentLine uses rem on Windows, # elsewhere; POSIX writes the board dir as a JSON string', () => {
  assert.strictEqual(launcher.markerCommentLine('win32', 'C:\\board'), 'rem kanban-web-board: C:\\board');
  assert.strictEqual(launcher.markerCommentLine('linux', '/home/x/board'), '# kanban-web-board: "/home/x/board"');
});

test('parseMarkerBoardDir reads either comment style, the current JSON-string POSIX form AND the legacy raw form, and null when absent', () => {
  assert.strictEqual(launcher.parseMarkerBoardDir('rem kanban-web-board: C:\\a\\b\r\ntitle x', 'win32'), 'C:\\a\\b');
  assert.strictEqual(launcher.parseMarkerBoardDir('#!/bin/sh\n# kanban-web-board: "/a/b"\nexec x', 'linux'), '/a/b', 'current JSON-string form');
  assert.strictEqual(launcher.parseMarkerBoardDir('#!/bin/sh\n# kanban-web-board: /a/b\nexec x', 'linux'), '/a/b', 'legacy raw form, from a wrapper written by an older launcher.js');
  assert.strictEqual(launcher.parseMarkerBoardDir('@echo off\ntitle nope'), null);
  assert.strictEqual(launcher.parseMarkerBoardDir(''), null);
});

test('markerCommentLine/parseMarkerBoardDir (POSIX) round-trip a board dir with a newline embedded in it', () => {
  const evil = '/tmp/weird\nboard';
  const line = launcher.markerCommentLine('linux', evil);
  assert.ok(!line.includes('\n'), 'the whole marker stays ONE physical line — the newline is JSON-escaped as \\n, not a real line break');
  assert.strictEqual(launcher.parseMarkerBoardDir(line, 'linux'), evil);
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

test('chooseWrapperName reuses a wrapper it already owns at ANY suffix rank, even when an earlier-ranked name has since freed up', () => {
  // Two's own wrapper landed on the SECOND numbered suffix earlier (both
  // `kanban_web` and `kanban_web-two` were taken by other boards at the
  // time). One of those other boards is gone now, freeing `kanban_web` — but
  // picking that free slot would abandon Two's real wrapper as an orphaned
  // duplicate and leave `run()` pairing against the wrong pid file.
  const existing = [
    { baseName: 'kanban_web-two-2', markerBoardDir: '/board/two', markerBoardDirExists: true },
  ];
  const name = launcher.chooseWrapperName('/board/two', 'Two', existing, 'linux');
  assert.strictEqual(name, 'kanban_web-two-2', 'reuses its own existing wrapper rather than the free kanban_web slot');
});

// --- pure: wrapper text ------------------------------------------------------

test('renderWrapper (win32): marker, helper and node checks, one-line exec, CRLF', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\Users\\x y\\board\\.kanban', boardName: 'X Board',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\Users\\x y\\launcher.js', baseName: 'kanban_web',
  });
  assert.match(text, /^@echo off\r\n/);
  assert.match(text, /rem kanban-web-board: C:\\Users\\x y\\board\\\.kanban\r\n/);
  assert.match(text, /if not exist "C:\\Users\\x y\\launcher\.js" goto stale\r\n/);
  assert.match(text, /if not exist "C:\\node\.exe" goto stale\r\n/);
  assert.match(text, /\r\n"C:\\node\.exe" "C:\\Users\\x y\\launcher\.js" run "C:\\Users\\x y\\board\\\.kanban" "kanban_web" && exit \/b 0 \|\| \(pause & exit \/b 1\)\r\n:stale\r\n/);
  assert.ok(!text.includes('\n\n'), 'no bare LF introduced alongside CRLF');
});

test('renderWrapper (win32): setlocal DisableDelayedExpansion runs right after @echo off, before any path is read', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\board', boardName: 'Board',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\launcher.js', baseName: 'kanban_web',
  });
  const lines = text.split('\r\n');
  assert.strictEqual(lines[0], '@echo off');
  assert.strictEqual(lines[1], 'setlocal DisableDelayedExpansion');
});

test('renderWrapper (win32): success exits 0, any failure pauses then always exits 1 on the same physical line, never leaking pause\'s own errorlevel', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\board', boardName: 'Board',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\launcher.js', baseName: 'kanban_web',
  });
  // `if errorlevel 1` is a signed >= comparison and silently misses a
  // negative exit code; `&&`/`||` test the whole exit status.
  assert.ok(!/if errorlevel/.test(text), 'the signed "if errorlevel N" form must be gone entirely');
  const lines = text.split('\r\n');
  const exec = lines.findIndex((l) => l.startsWith('"C:\\node.exe"'));
  assert.match(lines[exec], / && exit \/b 0 \|\| \(pause & exit \/b 1\)$/,
    'success exits 0; any failure pauses then always exits 1, on the same physical line, never replaying pause\'s own exit code');
  assert.strictEqual(lines[exec + 1], ':stale', 'only the stale branch follows, reached by goto alone');
});

test('renderWrapper (win32): a literal % in the board/node/helper path survives as %%, not swallowed by cmd', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\100% done\\.kanban', boardName: 'Board',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\launcher.js', baseName: 'kanban_web',
  });
  assert.match(text, /rem kanban-web-board: C:\\100%% done\\\.kanban\r\n/);
  assert.match(text, /\r\n"C:\\node\.exe" "C:\\launcher\.js" run "C:\\100%% done\\\.kanban" "kanban_web" && exit \/b 0 \|\|/);
});

test('renderWrapper (win32): chcp 65001 runs right after setlocal, before any path/name is read', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\Users\\x\\Diseño y más\\.kanban', boardName: 'Board',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\launcher.js', baseName: 'kanban_web',
  });
  const lines = text.split('\r\n');
  assert.strictEqual(lines[0], '@echo off');
  assert.strictEqual(lines[1], 'setlocal DisableDelayedExpansion');
  assert.strictEqual(lines[2], 'chcp 65001 >nul');
});

test('renderWrapper (win32): board-name cmd metacharacters never reach the title line raw', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\board', boardName: 'R&D board > out.txt & del /s *',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\launcher.js', baseName: 'kanban_web',
  });
  const titleLine = text.split('\r\n').find((l) => l.startsWith('title '));
  assert.ok(titleLine, 'has a title line');
  assert.ok(!/[&|<>^%"]/.test(titleLine), `title line must carry no cmd metacharacters: ${titleLine}`);
});

test('renderWrapper (win32): every argument on the exec line is quoted, including & and ( ) in a path', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\R&D (x)\\.kanban', boardName: 'Board',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\launcher.js', baseName: 'kanban_web-two',
  });
  assert.match(text, /\r\n"C:\\node\.exe" "C:\\launcher\.js" run "C:\\R&D \(x\)\\\.kanban" "kanban_web-two" && exit \/b 0 \|\|/);
});

test('renderWrapper (win32): serverArgs (a port and --allow-origin) are appended, quoted and %-escaped, in order, after baseName', () => {
  const text = launcher.renderWrapper({
    platform: 'win32', boardDirAbs: 'C:\\board', boardName: 'Board',
    nodePath: 'C:\\node.exe', helperPath: 'C:\\launcher.js', baseName: 'kanban_web',
    serverArgs: ['7801', '--allow-origin', 'https://100% tunnel.example.com'],
  });
  assert.match(
    text,
    /\r\n"C:\\node\.exe" "C:\\launcher\.js" run "C:\\board" "kanban_web" "7801" "--allow-origin" "https:\/\/100%% tunnel\.example\.com" && exit \/b 0 \|\|/,
  );
});

test('sanitizeForWindowsTitle strips cmd metacharacters and collapses newlines to spaces', () => {
  assert.strictEqual(launcher.sanitizeForWindowsTitle('R&D board'), 'R_D board');
  assert.strictEqual(launcher.sanitizeForWindowsTitle('a > b < c | d ^ e % f " g'), 'a _ b _ c _ d _ e _ f _ g');
  assert.strictEqual(launcher.sanitizeForWindowsTitle('line1\nline2\r\nline3'), 'line1 line2 line3');
  assert.strictEqual(launcher.sanitizeForWindowsTitle(''), '');
  assert.strictEqual(launcher.sanitizeForWindowsTitle(null), '');
});

test('renderWrapper (linux/mac): shebang, marker, helper-exists check, exec, LF only, single-quoted', () => {
  const text = launcher.renderWrapper({
    platform: 'linux', boardDirAbs: '/home/x y/board/.kanban', boardName: 'X Board',
    nodePath: '/usr/bin/node', helperPath: '/home/x y/launcher.js', baseName: 'kanban_web',
  });
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.match(text, /# kanban-web-board: "\/home\/x y\/board\/\.kanban"\n/);
  assert.match(text, /if \[ ! -f '\/home\/x y\/launcher\.js' \] \|\| \[ ! -x '\/usr\/bin\/node' \]; then/);
  assert.match(text, /exec '\/usr\/bin\/node' '\/home\/x y\/launcher\.js' run '\/home\/x y\/board\/\.kanban' 'kanban_web'/);
  assert.ok(!text.includes('\r'), 'no CR in a POSIX shell script');
});

test('renderWrapper (linux/mac): an embedded single quote is escaped, not left to break the shell line', () => {
  const text = launcher.renderWrapper({
    platform: 'linux', boardDirAbs: "/home/o'brien/.kanban", boardName: "O'Brien",
    nodePath: '/usr/bin/node', helperPath: '/usr/lib/launcher.js', baseName: 'kanban_web',
  });
  assert.match(text, /exec '\/usr\/bin\/node' '\/usr\/lib\/launcher\.js' run '\/home\/o'\\''brien\/\.kanban' 'kanban_web'/);
});

test('renderWrapper (linux/mac): serverArgs (a port and --allow-origin) are appended, single-quoted, in order, after baseName', () => {
  const text = launcher.renderWrapper({
    platform: 'linux', boardDirAbs: '/home/x/board/.kanban', boardName: 'Board',
    nodePath: '/usr/bin/node', helperPath: '/usr/lib/launcher.js', baseName: 'kanban_web',
    serverArgs: ['7801', '--allow-origin', "https://tunnel's.example.com"],
  });
  assert.match(
    text,
    /exec '\/usr\/bin\/node' '\/usr\/lib\/launcher\.js' run '\/home\/x\/board\/\.kanban' 'kanban_web' '7801' '--allow-origin' 'https:\/\/tunnel'\\''s\.example\.com'\n$/,
  );
});

test('renderWrapper (linux/mac): a newline embedded in the board dir cannot break out of the marker comment — the injection this exists to close', () => {
  // Before the fix, the raw path went straight into the `#` comment: a
  // newline inside it ended the comment right there, and whatever followed
  // on the "next line" of the wrapper ran as its OWN shell command the next
  // time the wrapper was invoked (an injected `touch` was observed running
  // this way).
  const evil = '/tmp/board\ntouch /tmp/pwned';
  const text = launcher.renderWrapper({
    platform: 'linux', boardDirAbs: evil, boardName: 'Board',
    nodePath: '/usr/bin/node', helperPath: '/usr/lib/launcher.js', baseName: 'kanban_web',
  });
  const lines = text.split('\n');
  const markerIdx = lines.findIndex((l) => l.startsWith('# kanban-web-board:'));
  assert.ok(markerIdx >= 0, 'has a marker line');
  assert.ok(
    markerIdx + 1 >= lines.length || !lines[markerIdx + 1].includes('touch'),
    'the injected command never lands on its own executable line',
  );
  // The exec line's single-quoted board-dir argument is allowed to SPAN
  // physical lines — a literal newline inside single quotes is safe verbatim
  // in POSIX sh — so only the marker comment is asserted to stay one line.
  assert.strictEqual(launcher.parseMarkerBoardDir(text, 'linux'), evil, 'round-trips back to the real path');
});

// --- pure: cmd/sh escaping ---------------------------------------------------

test('escapePercentForCmd doubles every % (cmd.exe collapses %% to a literal %)', () => {
  assert.strictEqual(launcher.escapePercentForCmd('100% done'), '100%% done');
  assert.strictEqual(launcher.escapePercentForCmd('a%b%c'), 'a%%b%%c');
  assert.strictEqual(launcher.escapePercentForCmd('no percent here'), 'no percent here');
});

test('singleQuotePosix wraps in single quotes and escapes an embedded quote via the \'\\\'\' trick', () => {
  assert.strictEqual(launcher.singleQuotePosix('/a/b'), "'/a/b'");
  assert.strictEqual(launcher.singleQuotePosix("it's"), "'it'\\''s'");
});

test('parseMarkerBoardDir un-escapes %% back to % for a win32 marker; a posix marker is never doubled and passes through', () => {
  assert.strictEqual(launcher.parseMarkerBoardDir('rem kanban-web-board: C:\\100%% done\\board', 'win32'), 'C:\\100% done\\board');
  assert.strictEqual(launcher.parseMarkerBoardDir('# kanban-web-board: /100%% done/board', 'linux'), '/100%% done/board');
});

// --- pure: info/exclude merge ------------------------------------------------

test('missingExcludeNames finds names not yet present as a whole trimmed line', () => {
  assert.deepStrictEqual(launcher.missingExcludeNames('', ['a', 'b']), ['a', 'b']);
  assert.deepStrictEqual(launcher.missingExcludeNames('existing\na\n', ['a', 'c']), ['c']);
  assert.deepStrictEqual(launcher.missingExcludeNames('a\nb\n', ['a', 'b']), []);
});

test('missingExcludeNames accepts a raw Buffer, decoding byte-for-byte (latin1), never as UTF-8', () => {
  assert.deepStrictEqual(launcher.missingExcludeNames(Buffer.from('a\nb\n', 'utf8'), ['a', 'c']), ['c']);
});

test('excludeAppendBuffer: nothing to add returns null (idempotent, no I/O)', () => {
  assert.strictEqual(launcher.excludeAppendBuffer('a\n', []), null);
});

test('excludeAppendBuffer adds a leading newline only when the buffer is non-empty and lacks a trailing one', () => {
  assert.strictEqual(launcher.excludeAppendBuffer('', ['a', 'b']).toString('utf8'), 'a\nb\n');
  assert.strictEqual(launcher.excludeAppendBuffer('existing\n', ['a']).toString('utf8'), 'a\n');
  assert.strictEqual(launcher.excludeAppendBuffer(Buffer.from('existing', 'utf8'), ['a']).toString('utf8'), '\na\n');
});

// --- pure: pid file parsing --------------------------------------------------

test('parsePidFileText reads pid + port, tolerates a missing/bad port', () => {
  assert.deepStrictEqual(launcher.parsePidFileText('123\n7777\n'), { pid: 123, port: 7777 });
  assert.deepStrictEqual(launcher.parsePidFileText('123\n'), { pid: 123, port: null });
  assert.deepStrictEqual(launcher.parsePidFileText('123\nnope\n'), { pid: 123, port: null });
  assert.strictEqual(launcher.parsePidFileText(''), null);
  assert.strictEqual(launcher.parsePidFileText('not-a-pid\n7777\n'), null);
});

// --- integration: start lock -------------------------------------------------

test('acquireStartLock: an absent lock is taken and names our pid; a lock naming a live pid is not acquired; release removes only a lock we own', () => {
  const dir = tmpDir('kanban-launcher-lock-');
  const lockPath = path.join(dir, 'kanban_web.lock');
  try {
    assert.strictEqual(launcher.acquireStartLock(lockPath), true, 'an absent lock is acquired');
    assert.strictEqual(launcher.readLockPid(lockPath), process.pid, 'the lock names the acquiring pid');

    // The lock now names OUR OWN pid, which is alive — from
    // acquireStartLock's point of view that's indistinguishable from a
    // different live process holding it, so a second attempt correctly
    // fails rather than acquiring twice.
    assert.strictEqual(launcher.acquireStartLock(lockPath), false, 'a lock naming a live pid blocks a second acquire');

    launcher.releaseStartLock(lockPath);
    assert.strictEqual(fs.existsSync(lockPath), false, 'release removes a lock we own');

    // Releasing an already-absent lock is a no-op, not an error.
    launcher.releaseStartLock(lockPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireStartLock reclaims a lock naming a dead pid instead of blocking forever', async () => {
  const dir = tmpDir('kanban-launcher-lock-stale-');
  const lockPath = path.join(dir, 'kanban_web.lock');
  try {
    // A pid guaranteed dead: spawn a trivial process and wait for it to exit.
    const deadPid = await new Promise((resolve) => {
      const p = spawn(process.execPath, ['-e', 'process.exit(0)']);
      p.on('exit', () => resolve(p.pid));
    });
    fs.writeFileSync(lockPath, String(deadPid));

    assert.strictEqual(launcher.acquireStartLock(lockPath), true, 'a stale lock is reclaimed, never left to jam every future run');
    assert.strictEqual(launcher.readLockPid(lockPath), process.pid);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireStartLock reclaims a lock naming a LIVE but unrelated pid once its mtime is stale (~30s) — pid reuse or a synced-in lock file must never wait forever', () => {
  const dir = tmpDir('kanban-launcher-lock-agedstale-');
  const lockPath = path.join(dir, 'kanban_web.lock');
  try {
    // process.pid IS alive (it's this very test process) but is completely
    // unrelated to this lock — the exact shape of a Windows-reused pid or a
    // lock file that arrived through a synced folder naming some other
    // machine's pid. Liveness alone can't tell that apart from a real
    // holder; age is what backs it up.
    fs.writeFileSync(lockPath, String(process.pid));
    const old = new Date(Date.now() - 40000);
    fs.utimesSync(lockPath, old, old);

    assert.strictEqual(launcher.acquireStartLock(lockPath), true, 'a lock older than the stale-age limit is reclaimed even though its named pid is alive');
    assert.strictEqual(launcher.readLockPid(lockPath), process.pid);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireStartLock does NOT reclaim a lock naming a live pid while it is still fresh (under the stale-age limit)', () => {
  const dir = tmpDir('kanban-launcher-lock-freshlive-');
  const lockPath = path.join(dir, 'kanban_web.lock');
  try {
    fs.writeFileSync(lockPath, String(process.pid)); // fresh mtime, just written
    assert.strictEqual(launcher.acquireStartLock(lockPath), false, 'a fresh lock naming a live pid still blocks — only AGE, not liveness alone, makes it stale');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('releaseStartLock leaves alone a lock that names a DIFFERENT pid — never removes a lock this process does not own', () => {
  const dir = tmpDir('kanban-launcher-lock-foreign-');
  const lockPath = path.join(dir, 'kanban_web.lock');
  try {
    fs.writeFileSync(lockPath, '999999999');
    launcher.releaseStartLock(lockPath);
    assert.ok(fs.existsSync(lockPath), 'a lock naming a different pid is left in place');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  assert.deepStrictEqual(
    launcher.candidatePorts({ pairedPort: null, appPort: null, cliPort: 4, configPort: 5 }),
    [4, 5],
    'a CLI port outranks the config pin, same as server.js\'s own resolvePort precedence',
  );
});

test('cliPortFromServerArgs: a bindable port argument wins; --allow-origin flags are skipped; anything unusable reads as "no CLI port"', () => {
  assert.strictEqual(launcher.cliPortFromServerArgs(['7801']), 7801);
  assert.strictEqual(launcher.cliPortFromServerArgs(['--allow-origin', 'https://x.example.com', '7801']), 7801,
    'the port is found after skipping the --allow-origin flag and its value');
  assert.strictEqual(launcher.cliPortFromServerArgs(['7801', '--allow-origin=https://x.example.com']), 7801);
  assert.strictEqual(launcher.cliPortFromServerArgs([]), null, 'no args, no CLI port');
  assert.strictEqual(launcher.cliPortFromServerArgs(['--allow-origin', 'https://x.example.com']), null, 'only --allow-origin, no port');
  assert.strictEqual(launcher.cliPortFromServerArgs(['0']), null, 'not a bindable port');
  assert.strictEqual(launcher.cliPortFromServerArgs(['abc']), null, 'not a number');
  assert.strictEqual(launcher.cliPortFromServerArgs(['70000']), null, 'out of range');
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
    assert.strictEqual((excludeText.match(/^kanban_web\.lock$/m) || []).length, 1);

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

test('writeLauncher: an unchanged wrapper is not rewritten, so a window running it never reads shifted bytes', () => {
  const parent = tmpDir('kanban-launcher-same-');
  try {
    const board = path.join(parent, '.kanban');
    fs.mkdirSync(board);
    const w = launcher.writeLauncher(board);
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(w, old, old);
    const before = fs.statSync(w).mtimeMs;
    assert.strictEqual(launcher.writeLauncher(board), w);
    assert.strictEqual(fs.statSync(w).mtimeMs, before, 'same bytes, no write');
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

test('writeLauncher: a board nested several levels inside a repo still writes at the repo TOP level, and the bare exclude pattern still matches from there', () => {
  const repo = initRepo();
  const ext = launcher.osWrapperExt(process.platform);
  try {
    const board = path.join(repo, 'projects', 'nested', '.kanban');
    fs.mkdirSync(board, { recursive: true });
    const w = launcher.writeLauncher(board);
    assert.strictEqual(w, path.join(repo, `kanban_web${ext}`), 'the wrapper lands at the repo root, never the board\'s own subfolder');

    const excludePath = launcher.gitInfoExcludePath(board);
    const excludeText = fs.readFileSync(excludePath, 'utf8');
    // The pattern the writer adds has no leading slash, so it is NOT
    // anchored to the top level — git treats a bare basename pattern as
    // matching at any depth, which is exactly what's needed since a
    // repository write is always at the top level anyway (the "no
    // repository" fallback has no exclude step at all).
    assert.match(excludeText, new RegExp(`^kanban_web${ext.replace('.', '\\.')}$`, 'm'));
    assert.ok(!excludeText.includes(`/kanban_web${ext}`), 'the entry is a bare name, not anchored with a leading slash');

    // git itself agrees the wrapper is excluded, checked from deep inside
    // the tree — proof the pattern actually works, not just its shape.
    const status = execFileSync('git', ['status', '--porcelain', '--ignored'], { cwd: board, encoding: 'utf8' });
    assert.ok(!new RegExp(`kanban_web${ext.replace('.', '\\.')}`).test(status.split('\n').filter((l) => !l.startsWith('!!')).join('\n')),
      'the wrapper never shows as untracked');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('writeLauncher: a repo path with non-ASCII characters resolves correctly — git output is decoded as utf8, never latin1/binary', () => {
  const base = tmpDir('kanban-launcher-nonascii-repo-');
  const ext = launcher.osWrapperExt(process.platform);
  try {
    const repo = path.join(base, 'Diseño y más');
    fs.mkdirSync(repo);
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    const board = path.join(repo, '.kanban');
    fs.mkdirSync(board);

    assert.strictEqual(launcher.gitRepoRoot(board), path.resolve(repo));
    const excludePath = launcher.gitInfoExcludePath(board);
    assert.ok(excludePath && excludePath.includes('Diseño y más'), 'the git-path decoded correctly, not mangled');

    const w = launcher.writeLauncher(board);
    assert.strictEqual(w, path.join(repo, `kanban_web${ext}`));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('writeLauncher: info/exclude bytes it does not understand survive untouched — a latin-1 comment with no trailing newline gets a newline then the new names appended, never rewritten', () => {
  const repo = initRepo();
  const ext = launcher.osWrapperExt(process.platform);
  try {
    const excludePath = path.join(repo, '.git', 'info', 'exclude');
    // "# café" in latin-1: the 'é' is byte 0xE9, not valid UTF-8 on its own —
    // decoding this as utf8 and rewriting the whole file would replace it
    // with U+FFFD, permanently mangling it. No trailing newline either.
    const latin1Comment = Buffer.from([0x23, 0x20, 0x63, 0x61, 0x66, 0xe9]); // "# caf\xE9"
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.writeFileSync(excludePath, latin1Comment);

    const board = path.join(repo, '.kanban');
    fs.mkdirSync(board);
    launcher.writeLauncher(board);

    const after = fs.readFileSync(excludePath);
    assert.deepStrictEqual(after.subarray(0, latin1Comment.length), latin1Comment, 'the original bytes survive byte-for-byte, unmangled');
    assert.strictEqual(after[latin1Comment.length], 0x0a, 'a newline was inserted before the appended names');
    const appended = after.subarray(latin1Comment.length + 1).toString('utf8');
    assert.match(appended, new RegExp(`^kanban_web${ext.replace('.', '\\.')}\\nkanban_web\\.pid\\nkanban_web\\.lock\\n$`));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('writeLauncher: the exclude step runs BEFORE the wrapper write — a read-only info/exclude fails loudly and leaves no wrapper behind', () => {
  const repo = initRepo();
  const ext = launcher.osWrapperExt(process.platform);
  const board = path.join(repo, '.kanban');
  const excludePath = path.join(repo, '.git', 'info', 'exclude');
  try {
    fs.mkdirSync(board);
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    fs.writeFileSync(excludePath, 'existing\n');
    fs.chmodSync(excludePath, 0o444);

    assert.throws(() => launcher.writeLauncher(board), 'a read-only exclude file makes the whole write fail, not silently skip');

    const wrapperPath = path.join(repo, `kanban_web${ext}`);
    assert.strictEqual(fs.existsSync(wrapperPath), false, 'no wrapper is left behind when the exclude write fails first');
  } finally {
    try { fs.chmodSync(excludePath, 0o644); } catch (_) { /* absent is fine */ }
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- integration: run --------------------------------------------------------

test('run: starts the server, writes the paired pid, a concurrent run starts nothing, cleanly killing the server removes the pid, a stale paired pid does not block a start', async () => {
  const port = await freePort();
  // Nested one level below the mkdtemp folder (proj/.kanban), not the
  // mkdtemp folder itself, so `where` (its PARENT — no git repo here) is
  // test-private too, never the shared OS temp root every other test also
  // writes `kanban_web.pid` into.
  const proj = tmpDir('kanban-launcher-run-');
  const dir = path.join(proj, '.kanban');
  fs.mkdirSync(dir);
  const where = path.dirname(dir);
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
    killTree(serverPid);
    await proc1Exit;
    await waitFor(() => !fs.existsSync(pidPath));
  } finally {
    killTree(serverPid);
    if (proc1 && proc1.exitCode === null) killTree(proc1.pid);
    killBoardAppPid(dir);
    try { fs.unlinkSync(pidPath); } catch (_) { /* already removed */ }
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('run: a stale paired pid (dead pid) does not block a start', async () => {
  const port = await freePort();
  const proj = tmpDir('kanban-launcher-stale-'); // nested — see N4 note above
  const dir = path.join(proj, '.kanban');
  fs.mkdirSync(dir);
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
    killTree(serverPid);
    if (proc1 && proc1.exitCode === null) killTree(proc1.pid);
    killBoardAppPid(dir);
    try { fs.unlinkSync(pidPath); } catch (_) { /* already removed */ }
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('run: a stale paired pid naming a live-but-unrelated pid on the wrong port must not shadow a genuinely running server, nor delete its .kanban-app.pid', async () => {
  const port = await freePort();
  const proj = tmpDir('kanban-launcher-liveapp-'); // nested — see N4 note above
  const dir = path.join(proj, '.kanban');
  fs.mkdirSync(dir);
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
    killTree(serverProc && serverProc.pid);
    killBoardAppPid(dir);
    try { fs.unlinkSync(pairedPidPath); } catch (_) { /* already removed */ }
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('run: two runs racing for the same pinned port — exactly one server survives, kanban_web.pid names it, and both runs end without error', async () => {
  const port = await freePort();
  const proj = tmpDir('kanban-launcher-race-'); // nested — see N4 note above
  const dir = path.join(proj, '.kanban');
  fs.mkdirSync(dir);
  const where = path.dirname(dir);
  const pidPath = path.join(where, 'kanban_web.pid');
  fs.writeFileSync(path.join(dir, 'config.yaml'), `port: ${port}\n`);

  const spawnRun = () => spawn(process.execPath, [LAUNCHER_PATH, 'run', dir], {
    env: { ...process.env, KANBAN_WEB_NO_BROWSER: '1' },
    stdio: 'ignore',
  });

  let proc1 = null;
  let proc2 = null;
  let serverPid = null;
  try {
    // Fired back to back, no await between them, so both race
    // acquireStartLock for the same wrapper — one wins the lock and spawns,
    // the other waits on the winner rather than also spawning (which, for a
    // pinned port, would otherwise race the OS-level bind and hit
    // EADDRINUSE — server.js treats a busy pin as a startup error, never a
    // silent increment).
    proc1 = spawnRun();
    proc2 = spawnRun();

    await waitFor(() => fs.existsSync(pidPath) && fs.readFileSync(pidPath, 'utf8').trim() !== '');
    const info = launcher.parsePidFileText(fs.readFileSync(pidPath, 'utf8'));
    assert.ok(info, 'the paired pid file names the surviving server');
    assert.strictEqual(info.port, port);
    serverPid = info.pid;
    assert.ok(launcher.isPidAlive(serverPid), 'that pid is actually alive');

    const seenBoardDir = await waitFor(() => launcher.probeBoardDir(port, 500));
    assert.ok(launcher.sameBoardDir(seenBoardDir, dir), 'the survivor answers as this board');

    // The loser is whichever of the two exits on its own first — a launcher
    // still attached to a live server (the winner) never exits until that
    // server does, so the one that exits first must be the one that lost
    // the start lock and recovered by finding the board already served.
    const loserExit = await waitFor(() => {
      if (proc1.exitCode !== null) return { winner: proc2, code: proc1.exitCode };
      if (proc2.exitCode !== null) return { winner: proc1, code: proc2.exitCode };
      return false;
    });
    assert.strictEqual(loserExit.code, 0, 'the loser exits 0 — it opens the browser to the board the winner is serving rather than starting a second one');
    assert.strictEqual(launcher.parsePidFileText(fs.readFileSync(pidPath, 'utf8')).pid, serverPid,
      'the loser never overwrote or deleted the winner\'s paired pid');
    // The winner is still attached to its live server, exactly as a normal
    // single-run start would be — it hasn't "ended" at all, let alone with
    // an error.
    assert.strictEqual(loserExit.winner.exitCode, null, 'the winner is still attached to its running server');
  } finally {
    killTree(serverPid);
    if (proc1 && proc1.exitCode === null) killTree(proc1.pid);
    if (proc2 && proc2.exitCode === null) killTree(proc2.pid);
    killBoardAppPid(dir);
    try { fs.unlinkSync(pidPath); } catch (_) { /* already removed */ }
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('run: two runs racing for the same UNPINNED board — exactly one server survives, not two on two different auto-incremented ports', async () => {
  const proj = tmpDir('kanban-launcher-unpinned-race-'); // nested — see N4 note above
  const dir = path.join(proj, '.kanban');
  fs.mkdirSync(dir);
  const where = path.dirname(dir);
  const pidPath = path.join(where, 'kanban_web.pid');
  // No config.yaml `port:` — unpinned. A losing spawn here would never hit
  // EADDRINUSE the way a pinned one does: server.js auto-increments past a
  // busy port instead of failing, so without the start lock BOTH racers'
  // spawns would succeed, each on its own free port, leaving two live
  // servers for one board. A CLI port (S5) is used here instead of the bare
  // 7777 default so this auto-increment race — which can genuinely claim a
  // handful of ports near its start — never touches this desktop's live
  // boards on 7777-7800: a CLI port still auto-increments on EADDRINUSE in
  // server.js exactly like the bare default does (it isn't a pin — see
  // server.js's resolvePort/start), so the race itself is unchanged.
  const defaultPort = await freePort();

  const spawnRun = () => spawn(process.execPath, [LAUNCHER_PATH, 'run', dir, 'kanban_web', String(defaultPort)], {
    env: { ...process.env, KANBAN_WEB_NO_BROWSER: '1' },
    stdio: 'ignore',
  });

  let proc1 = null;
  let proc2 = null;
  let serverPid = null;
  try {
    proc1 = spawnRun();
    proc2 = spawnRun();

    await waitFor(() => fs.existsSync(pidPath) && fs.readFileSync(pidPath, 'utf8').trim() !== '');
    const info = launcher.parsePidFileText(fs.readFileSync(pidPath, 'utf8'));
    assert.ok(info, 'the paired pid file names the surviving server');
    serverPid = info.pid;
    assert.ok(launcher.isPidAlive(serverPid), 'that pid is actually alive');

    const seenBoardDir = await waitFor(() => launcher.probeBoardDir(info.port, 500));
    assert.ok(launcher.sameBoardDir(seenBoardDir, dir), 'the survivor answers as this board');

    const loserExit = await waitFor(() => {
      if (proc1.exitCode !== null) return { winner: proc2, code: proc1.exitCode };
      if (proc2.exitCode !== null) return { winner: proc1, code: proc2.exitCode };
      return false;
    });
    assert.strictEqual(loserExit.code, 0, 'the loser exits 0 — it waited for the winner rather than starting its own server');
    assert.strictEqual(loserExit.winner.exitCode, null, 'the winner is still attached to its running server');

    // The defect this guards against: a would-be second server that bound
    // to its OWN free port near the default would never be caught by
    // checking the pid files alone (a second server.js would just overwrite
    // .kanban-app.pid), so scan every port the auto-increment could have
    // landed on and confirm only ONE of them is actually serving this board.
    let answering = 0;
    for (let p = defaultPort; p < defaultPort + 20; p++) {
      const otherBoardDir = await launcher.probeBoardDir(p, 150);
      if (otherBoardDir && launcher.sameBoardDir(otherBoardDir, dir)) answering++;
    }
    assert.strictEqual(answering, 1, 'exactly one live server answers as this board across the whole auto-increment range');
  } finally {
    killTree(serverPid);
    if (proc1 && proc1.exitCode === null) killTree(proc1.pid);
    if (proc2 && proc2.exitCode === null) killTree(proc2.pid);
    killBoardAppPid(dir);
    try { fs.unlinkSync(pidPath); } catch (_) { /* already removed */ }
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('run: an explicit baseName (the wrapper\'s own third argument) pairs with that exact pid file, never the marker-order guess', async () => {
  const port = await freePort();
  const proj = tmpDir('kanban-launcher-explicit-basename-'); // nested — see N4 note above
  const dir = path.join(proj, '.kanban');
  fs.mkdirSync(dir);
  const where = path.dirname(dir);
  fs.writeFileSync(path.join(dir, 'config.yaml'), `port: ${port}\n`);

  // No wrapper is written to disk at all here — resolveBaseNameForBoard's
  // marker-order FALLBACK guess would default to 'kanban_web', which is the
  // WRONG pid file for a board whose real wrapper (per the third argument
  // below, exactly as renderWrapper now embeds it) is 'kanban_web-two'.
  const explicitPidPath = path.join(where, 'kanban_web-two.pid');
  const wrongGuessPidPath = path.join(where, 'kanban_web.pid');

  let proc = null;
  let serverPid = null;
  try {
    proc = spawn(process.execPath, [LAUNCHER_PATH, 'run', dir, 'kanban_web-two'], {
      env: { ...process.env, KANBAN_WEB_NO_BROWSER: '1' },
      stdio: 'ignore',
    });

    await waitFor(() => fs.existsSync(explicitPidPath) && fs.readFileSync(explicitPidPath, 'utf8').trim() !== '');
    const info = launcher.parsePidFileText(fs.readFileSync(explicitPidPath, 'utf8'));
    assert.ok(info, 'the paired pid file is the one named by the explicit baseName argument');
    assert.strictEqual(info.port, port);
    serverPid = info.pid;
    assert.ok(!fs.existsSync(wrongGuessPidPath), 'the wrong marker-order guess pid file was never created');
  } finally {
    killTree(serverPid);
    if (proc && proc.exitCode === null) killTree(proc.pid);
    killBoardAppPid(dir);
    try { fs.unlinkSync(explicitPidPath); } catch (_) { /* already removed */ }
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

// --- integration: replayed server args (S5) -----------------------------------

test('writeLauncher: a written wrapper carries the replayed server args (a port and --allow-origin) in order', () => {
  const parent = tmpDir('kanban-launcher-writeargs-');
  try {
    const board = path.join(parent, '.kanban');
    fs.mkdirSync(board);
    const w = launcher.writeLauncher(board, ['7801', '--allow-origin', 'https://tunnel.example.com']);
    const content = fs.readFileSync(w, 'utf8');
    const node = process.execPath;
    const helper = LAUNCHER_PATH;
    if (process.platform === 'win32') {
      assert.ok(content.includes(`"${node}" "${helper}" run "${path.resolve(board)}" "kanban_web" "7801" "--allow-origin" "https://tunnel.example.com"`));
    } else {
      assert.ok(content.includes(`run '${path.resolve(board)}' 'kanban_web' '7801' '--allow-origin' 'https://tunnel.example.com'`));
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('run: a CLI port (as a written wrapper would replay) is what actually gets bound, on an otherwise-unpinned board', async () => {
  const port = await freePort();
  const proj = tmpDir('kanban-launcher-cliport-'); // nested — see N4 note above
  const dir = path.join(proj, '.kanban');
  fs.mkdirSync(dir); // no config.yaml at all — genuinely unpinned
  const where = path.dirname(dir);
  const pidPath = path.join(where, 'kanban_web.pid');

  let proc = null;
  let serverPid = null;
  try {
    proc = spawn(process.execPath, [LAUNCHER_PATH, 'run', dir, 'kanban_web', String(port)], {
      env: { ...process.env, KANBAN_WEB_NO_BROWSER: '1' },
      stdio: 'ignore',
    });

    await waitFor(() => fs.existsSync(pidPath) && fs.readFileSync(pidPath, 'utf8').trim() !== '');
    const info = launcher.parsePidFileText(fs.readFileSync(pidPath, 'utf8'));
    assert.ok(info, 'the paired pid file parses');
    assert.strictEqual(info.port, port, 'the CLI port was bound, not the 7777 default');
    serverPid = info.pid;
  } finally {
    killTree(serverPid);
    if (proc && proc.exitCode === null) killTree(proc.pid);
    killBoardAppPid(dir);
    try { fs.unlinkSync(pidPath); } catch (_) { /* already removed */ }
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

test('run: the running check finds a board already served on its CLI port — no config pin, no paired pid file, only the CLI port names it', async () => {
  const port = await freePort();
  const proj = tmpDir('kanban-launcher-cliport-running-'); // nested — see N4 note above
  const dir = path.join(proj, '.kanban');
  fs.mkdirSync(dir); // unpinned
  const appPidPath = path.join(dir, '.kanban-app.pid');

  let serverProc = null;
  try {
    // Started the documented way — `server.js <dir> <port>`, never through
    // the launcher — so only .kanban-app.pid exists; nothing has EVER
    // written a paired kanban_web.pid for this board.
    serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'server.js'), dir, String(port)], { stdio: 'ignore' });
    await waitFor(() => fs.existsSync(appPidPath) && fs.readFileSync(appPidPath, 'utf8').trim() !== '');

    const exitCode = await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [LAUNCHER_PATH, 'run', dir, 'kanban_web', String(port)], {
        env: { ...process.env, KANBAN_WEB_NO_BROWSER: '1' },
        stdio: 'ignore',
      });
      proc.on('exit', resolve);
      proc.on('error', reject);
    });

    assert.strictEqual(exitCode, 0, 'the already-running board is found via the replayed CLI port, so nothing new is spawned');
  } finally {
    killTree(serverProc && serverProc.pid);
    killBoardAppPid(dir);
    fs.rmSync(proj, { recursive: true, force: true });
  }
});

// --- integration: real cmd.exe parse (win32 only) ----------------------------
//
// A Node-side render check (regex on the string renderWrapper returns) can't
// catch a real cmd.exe parsing bug — the code page it reads bytes under, its
// own quote/metacharacter/%-expansion rules. These tests really run the
// written .cmd through cmd.exe.

// Runs `cmdLine` (a real command line, e.g. `chcp 437 >nul & call "<wrapper>"`)
// through a real cmd.exe /c, exactly as typed — `windowsVerbatimArguments`
// is required here: without it, Node applies its normal argv-escaping (meant
// for an ordinary executable) on top of the quotes already in `cmdLine`,
// which cmd.exe's own quirky /c parsing does not understand and which
// silently breaks a path containing `&`/`(`/`)` (cmd's /c strips a wrapping
// quote pair unless the quoted text is free of those characters — see
// Microsoft's documented /c rule) or non-ASCII bytes.
function runCmdLine(cmdLine, env, cmdArgs = ['/d', '/c']) {
  return spawn('cmd.exe', [...cmdArgs, cmdLine], { env, stdio: 'ignore', windowsVerbatimArguments: true });
}

async function assertWrapperServesBoard(wrapperPath, dir, port, spawnIt) {
  const pidPath = wrapperPath.replace(/\.cmd$/i, '.pid');
  let cmdProc = null;
  let serverPid = null;
  try {
    cmdProc = spawnIt();
    // A wrapper whose helper isn't found never writes this pid file at all —
    // waiting for it (rather than scraping stdout) is the simplest proof the
    // "plugin has moved" fallback did NOT fire and the real path reached
    // node.
    await waitFor(() => fs.existsSync(pidPath) && fs.readFileSync(pidPath, 'utf8').trim() !== '');
    const info = launcher.parsePidFileText(fs.readFileSync(pidPath, 'utf8'));
    assert.ok(info, 'the paired pid file parses');
    serverPid = info.pid;
    assert.strictEqual(info.port, port, 'the pinned port was bound');
    const seenBoardDir = await waitFor(() => launcher.probeBoardDir(port, 500));
    assert.ok(launcher.sameBoardDir(seenBoardDir, dir), 'the board path reached node intact and the server answers as THIS board');
  } finally {
    killTree(serverPid);
    if (cmdProc && cmdProc.exitCode === null) killTree(cmdProc.pid);
    killBoardAppPid(dir);
    try { fs.unlinkSync(pidPath); } catch (_) { /* already removed */ }
  }
}

test('write+run (win32, real cmd parse): a non-ASCII board path survives double-clicking under OEM code page 437',
  { skip: process.platform !== 'win32' }, async () => {
    const port = await freePort();
    const proj = tmpDir('kanban-launcher-cp437-');
    const boardParent = path.join(proj, 'Diseño y más');
    fs.mkdirSync(boardParent, { recursive: true });
    const dir = path.join(boardParent, '.kanban');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'config.yaml'), `port: ${port}\n`);
    const wrapperPath = launcher.writeLauncher(dir);

    // Sets the OEM code page cmd.exe reads BYTES under first — `& call
    // "<wrapper>"` on the same command line means the non-ASCII path text
    // itself arrives via argv (already Unicode, never byte-decoded); only
    // the WRAPPER FILE's own bytes, read once `call` opens it, are subject
    // to the 437 page, exactly as a real double-click would read them.
    const env = { ...process.env, KANBAN_WEB_NO_BROWSER: '1' };
    try {
      await assertWrapperServesBoard(wrapperPath, dir, port,
        () => runCmdLine(`chcp 437 >nul & call "${wrapperPath}"`, env));
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });

test('write+run (win32, real cmd parse): & and ( ) in the board path do not break the quoted arguments',
  { skip: process.platform !== 'win32' }, async () => {
    const port = await freePort();
    const proj = tmpDir('kanban-launcher-metachar-');
    const boardParent = path.join(proj, 'R&D (x)');
    fs.mkdirSync(boardParent, { recursive: true });
    const dir = path.join(boardParent, '.kanban');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'config.yaml'), `port: ${port}\n`);
    const wrapperPath = launcher.writeLauncher(dir);

    try {
      await assertWrapperServesBoard(wrapperPath, dir, port,
        () => runCmdLine(`call "${wrapperPath}"`, { ...process.env, KANBAN_WEB_NO_BROWSER: '1' }));
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });

test('write+run (win32, real cmd parse): a literal % in the board path survives cmd\'s %-expansion, and re-writing heals in place',
  { skip: process.platform !== 'win32' }, async () => {
    const port = await freePort();
    const proj = tmpDir('kanban-launcher-percent-');
    const boardParent = path.join(proj, '100% done');
    fs.mkdirSync(boardParent, { recursive: true });
    const dir = path.join(boardParent, '.kanban');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'config.yaml'), `port: ${port}\n`);
    const wrapperPath = launcher.writeLauncher(dir);

    // The marker round-trips through the %%-doubling: a second write for the
    // SAME board recognizes it and heals in place rather than suffixing a
    // "different board" it can't actually read back correctly.
    const wrapperPath2 = launcher.writeLauncher(dir);
    assert.strictEqual(wrapperPath2, wrapperPath, 'the %-escaped marker round-trips, so this is recognized as the SAME board');

    try {
      await assertWrapperServesBoard(wrapperPath, dir, port,
        () => runCmdLine(`call "${wrapperPath}"`, { ...process.env, KANBAN_WEB_NO_BROWSER: '1' }));
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });

test('write+run (win32, real cmd parse): setlocal DisableDelayedExpansion protects a "!" in the board path under cmd /v:on (or the DelayedExpansion registry key)',
  { skip: process.platform !== 'win32' }, async () => {
    const port = await freePort();
    const proj = tmpDir('kanban-launcher-bang-');
    const boardParent = path.join(proj, 'a!b');
    fs.mkdirSync(boardParent, { recursive: true });
    const dir = path.join(boardParent, '.kanban');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'config.yaml'), `port: ${port}\n`);
    const wrapperPath = launcher.writeLauncher(dir);

    // Without `setlocal DisableDelayedExpansion`, `cmd /v:on` makes THIS
    // batch file's own lines get scanned for `!...!` expansion: the lone
    // `!` in `a!b` would silently vanish before node ever sees the path,
    // sending `repo\ab\.kanban` instead of `repo\a!b\.kanban` — the board
    // dir the server is told to serve would not exist, and
    // assertWrapperServesBoard's wait for the pid file would time out.
    try {
      await assertWrapperServesBoard(wrapperPath, dir, port,
        () => runCmdLine(`chcp 437 >nul & call "${wrapperPath}"`, { ...process.env, KANBAN_WEB_NO_BROWSER: '1' }, ['/v:on', '/d', '/c']));
    } finally {
      fs.rmSync(proj, { recursive: true, force: true });
    }
  });

test('write+run (win32, real cmd parse): success exits 0, any failure pauses then exits 1 — never leaks the pause command\'s own errorlevel out through a double-click',
  { skip: process.platform !== 'win32' }, async () => {
    // Reproduces the exact N7 defect: `cmd /c "kanban_web.cmd"` — how a
    // double-click actually runs the wrapper — used to come back 0 for a
    // real failure (errorlevel 3, -1 both observed in the wild), because the
    // OLD `|| pause & exit /b` gave `exit /b` no code of its own, so it
    // replayed whatever `pause` itself returned. A tiny stub stands in for
    // the helper so the failure is deterministic and instant.
    const dir = tmpDir('kanban-launcher-exitcode-');
    const runWithExitCode = (code) => {
      const stubPath = path.join(dir, `stub-${code}.js`);
      fs.writeFileSync(stubPath, `process.exit(${code});\n`);
      const wrapperPath = path.join(dir, `wrapper-${code}.cmd`);
      const text = launcher.renderWrapper({
        platform: 'win32', boardDirAbs: dir, boardName: 'Board',
        nodePath: process.execPath, helperPath: stubPath, baseName: 'kanban_web',
      });
      fs.writeFileSync(wrapperPath, text);
      return new Promise((resolve, reject) => {
        const proc = spawn('cmd.exe', ['/d', '/c', `call "${wrapperPath}"`], {
          stdio: ['pipe', 'ignore', 'ignore'], windowsVerbatimArguments: true,
        });
        proc.on('error', reject);
        proc.on('exit', (exitCode) => resolve(exitCode));
        // The failure branch's `pause` blocks on stdin — a pipe buffers this
        // write until pause actually reads it, so no timing race.
        try { proc.stdin.write('\r\n'); proc.stdin.end(); } catch (_) {}
      });
    };
    try {
      assert.notStrictEqual(await runWithExitCode(3), 0, 'a helper exiting 3 must not leak through the wrapper as exit code 0');
      assert.notStrictEqual(await runWithExitCode(-1), 0, 'a helper exiting -1 must not leak through as 0 either');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
