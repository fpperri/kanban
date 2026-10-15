const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { EXIT, createRegistry, isAlive, runScenarios, exitCodeFor } = require('./browser/harness');

// The runner starts a server per board, one Chrome and a temporary copy of each
// board. When Chrome dies mid-run, or the run ends any other way, none of them
// may be left behind. These tests use harmless stand-ins for the processes: a
// node child that sleeps. Nothing here starts a server or a browser.

const SLEEPER = ['-e', 'setInterval(() => {}, 1000)'];
const started = (rec) => new Promise((resolve, reject) => { rec.child.once('spawn', resolve); rec.child.once('error', reject); });
const quiet = { timeoutMs: 10000, log: () => {} };

function fixtureRegistry() {
  const reg = createRegistry();
  const root = reg.tmpDir('kanban-browser-test-');
  fs.mkdirSync(path.join(root, 'board'));
  fs.writeFileSync(path.join(root, 'board', '0001.card.md'), 'a temporary board copy');
  return { reg, root };
}

test('cleanup stops every process it started and removes every folder it made', async () => {
  const { reg, root } = fixtureRegistry();
  const server = reg.spawn('server', process.execPath, SLEEPER);
  const chrome = reg.spawn('chrome', process.execPath, SLEEPER);
  await Promise.all([started(server), started(chrome)]);
  assert.ok(isAlive(server.child.pid) && isAlive(chrome.child.pid));
  const problems = await reg.cleanup();
  assert.deepStrictEqual(problems, []);
  assert.ok(!isAlive(server.child.pid), 'the server process is still running');
  assert.ok(!isAlive(chrome.child.pid), 'the Chrome process is still running');
  assert.ok(!fs.existsSync(root), 'the temporary board copy is still there');
});

test('cleanup is safe to call twice', async () => {
  const { reg } = fixtureRegistry();
  const a = await reg.cleanup();
  const b = await reg.cleanup();
  assert.deepStrictEqual([a, b], [[], []]);
});

test('a process that already exited does not trouble cleanup', async () => {
  const { reg } = fixtureRegistry();
  const quick = reg.spawn('quick', process.execPath, ['-e', '']);
  await quick.exited;
  assert.deepStrictEqual(await reg.cleanup(), []);
});

test('a tracked process says why it exited', async () => {
  const { reg } = fixtureRegistry();
  const rec = reg.spawn('chrome', process.execPath, ['-e', 'process.exit(7)']);
  assert.match(await rec.exited, /exited with code 7/);
  await reg.cleanup();
});

test('killing Chrome mid-run fails the scenario within its timeout and leaves no process or board copy behind', async () => {
  const { reg, root } = fixtureRegistry();
  const server = reg.spawn('server', process.execPath, SLEEPER);
  const chrome = reg.spawn('chrome', process.execPath, SLEEPER);
  await Promise.all([started(server), started(chrome)]);

  const env = {
    gone: chrome.exited,
    async begin(sc, ctx) { return { check: ctx.check }; },
    async end() {},
    async consoleErrors() { return []; },
  };
  const midRun = {
    name: 'graph', board: 'fixture', timeoutMs: 8000,
    run: () => { setTimeout(() => process.kill(chrome.child.pid, 'SIGKILL'), 60); return new Promise(() => {}); },
  };
  const t0 = Date.now();
  const results = await runScenarios([midRun, { name: 'smoke', board: 'plan', run: async () => {} }], env, quiet);
  const took = Date.now() - t0;

  assert.ok(took < 3000, `the run took ${took}ms, so it waited for the timeout`);
  assert.deepStrictEqual(results.map((r) => r.status), ['FAIL', 'FAIL']);
  assert.match(results[0].error, /Chrome is gone/);
  assert.notStrictEqual(exitCodeFor(results), EXIT.OK);

  assert.deepStrictEqual(await reg.cleanup(), []);
  assert.ok(!isAlive(chrome.child.pid), 'Chrome is still running');
  assert.ok(!isAlive(server.child.pid), 'the server is still running');
  assert.ok(!fs.existsSync(root), 'the temporary board copy is still there');
});

test('a folder made under the registry lives in the system temp folder and carries the prefix it was given', () => {
  const { reg, root } = fixtureRegistry();
  assert.strictEqual(path.dirname(root), os.tmpdir());
  assert.ok(path.basename(root).startsWith('kanban-browser-test-'));
  return reg.cleanup();
});
