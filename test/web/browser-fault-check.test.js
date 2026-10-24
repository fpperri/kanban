const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findLeftovers, problemsForForcedThrow, problemsForKilledChrome } = require('./browser/fault-check');

// fault-check.js runs the browser runner twice against a real Chrome, once with
// a scenario forced to throw and once with Chrome killed mid-run, and judges the
// result. The judging and the search for leftovers are tested here against made
// up output and a made up process table; the runs themselves are in CI.

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-faultcheck-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function fakeProc(root, procs) {
  const proc = tmp();
  for (const [pid, args] of Object.entries(procs)) {
    fs.mkdirSync(path.join(proc, pid));
    fs.writeFileSync(path.join(proc, pid, 'cmdline'), `${args.join('\0')}\0`);
  }
  fs.mkdirSync(path.join(proc, 'self'));
  fs.writeFileSync(path.join(proc, 'cpuinfo'), 'not a process');
  return proc;
}

test('a temporary board copy left in the temp folder is a leftover', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'kanban-browser-abc123'));
  fs.mkdirSync(path.join(root, '.org.chromium.Chromium.xyz'));
  const found = findLeftovers({ tmpRoot: root, procDir: path.join(root, 'no-proc') });
  assert.deepStrictEqual(found.dirs, ['kanban-browser-abc123']);
});

test('a clean temp folder has no leftovers', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'x');
  assert.deepStrictEqual(findLeftovers({ tmpRoot: root, procDir: path.join(root, 'no-proc') }).dirs, []);
});

test('a process still running on the run\'s temporary folder is a leftover, whatever it is', () => {
  const root = tmp();
  const proc = fakeProc(root, {
    4001: ['/usr/bin/google-chrome', '--headless=new', `--user-data-dir=${path.join(root, 'kanban-browser-abc123', 'profile')}`],
    4002: ['/usr/bin/node', 'server.js', path.join(root, 'kanban-browser-abc123', 'board-plan'), '41234'],
    4003: ['/usr/bin/node', 'something-else.js'],
    4004: ['/usr/bin/google-chrome', `--user-data-dir=${path.join(os.tmpdir(), 'someone-elses-profile')}`],
  });
  const found = findLeftovers({ tmpRoot: root, procDir: proc });
  assert.deepStrictEqual(found.processes.map((p) => p.pid), [4001, 4002]);
  assert.strictEqual(found.checkedProcesses, true);
});

test('where there is no process table the processes are reported as not checked', () => {
  const root = tmp();
  const found = findLeftovers({ tmpRoot: root, procDir: path.join(root, 'no-proc') });
  assert.strictEqual(found.checkedProcesses, false);
  assert.deepStrictEqual(found.processes, []);
});

const clean = { dirs: [], processes: [], checkedProcesses: true };
const forcedOutput = [
  '== graph  (board fixture)',
  'FAIL  [graph] scenario failed: forced to fail by --fault throw:graph',
  '== smoke  (board plan, malformed)',
  'PASS  [smoke] plan: the board view renders',
  'FAIL  graph       0.0s  forced to fail by --fault throw:graph',
  'PASS  smoke       4.2s  21 checks',
  '1 passed, 1 failed (2 scenarios, 21 checks)',
].join('\n');

test('a forced throw is judged right when the scenario fails under its name, the other still runs and the exit is non-zero', () => {
  assert.deepStrictEqual(problemsForForcedThrow({ code: 1, out: forcedOutput, leftovers: clean }), []);
});

test('a forced throw is judged wrong when the run exits zero, the scenario is not named or the other one did not run', () => {
  assert.match(problemsForForcedThrow({ code: 0, out: forcedOutput, leftovers: clean }).join('\n'), /exit/);
  assert.match(problemsForForcedThrow({ code: 1, out: forcedOutput.replace('FAIL  graph', 'ok    graph'), leftovers: clean }).join('\n'), /graph/);
  assert.match(problemsForForcedThrow({ code: 1, out: forcedOutput.replace(/PASS {2}smoke.*\n/, ''), leftovers: clean }).join('\n'), /smoke/);
});

const killedOutput = [
  '== held  (board fixture)',
  'FAIL  [held] scenario failed: Chrome is gone: killed by SIGKILL',
  'FAIL  held        0.1s  Chrome is gone: killed by SIGKILL',
  '0 passed, 1 failed (1 scenarios, 0 checks)',
].join('\n');

test('a killed Chrome is judged right when the run exits non-zero in time and leaves nothing behind', () => {
  assert.deepStrictEqual(problemsForKilledChrome({ code: 1, out: killedOutput, ms: 4000, limitMs: 30000, leftovers: clean }), []);
});

test('a killed Chrome is judged wrong when the run exits zero, is slow, or leaves a board copy or a process behind', () => {
  const judge = (over) => problemsForKilledChrome({ code: 1, out: killedOutput, ms: 4000, limitMs: 30000, leftovers: clean, ...over }).join('\n');
  assert.match(judge({ code: 0 }), /exit/);
  assert.match(judge({ ms: 31000 }), /took 31s.*30s/);
  assert.match(judge({ out: 'PASS everything' }), /Chrome is gone/);
  assert.match(judge({ leftovers: { ...clean, dirs: ['kanban-browser-abc'] } }), /kanban-browser-abc/);
  assert.match(judge({ leftovers: { ...clean, processes: [{ pid: 7, cmd: 'google-chrome' }] } }), /pid 7/);
});

test('a killed Chrome that ends the run in a harness error is not the graceful failure the run owes', () => {
  const out = `${killedOutput}\nHARNESS ERROR: Error: boom`;
  assert.match(problemsForKilledChrome({ code: 3, out, ms: 100, limitMs: 30000, leftovers: clean }).join('\n'), /harness error/);
});
