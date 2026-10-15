const { test } = require('node:test');
const assert = require('node:assert');

const { EXIT, runScenarios, exitCodeFor, summaryLines, withFault } = require('./browser/harness');

// The loop that runs the browser runner's scenarios, driven here with a fake
// environment in place of Chrome: a scenario that throws, hangs or loses its
// browser must be recorded under its own name and must not stop the rest.

function fakeEnv({ errors = [] } = {}) {
  let release;
  const gone = new Promise((r) => { release = r; });
  return {
    gone,
    lose: (why) => release(why),
    begun: [],
    ended: [],
    async begin(sc, ctx) { this.begun.push(sc.name); return { check: ctx.check, scope: ctx.scope }; },
    async end(sc, rec) { this.ended.push([sc.name, rec.status]); },
    async consoleErrors() { return errors; },
  };
}
const ok = (name, ...checks) => ({ name, board: 'fixture', run: async (page) => { for (const c of checks) page.check(c, true); } });
const quiet = { timeoutMs: 1000, log: () => {} };
const byName = (results) => Object.fromEntries(results.map((r) => [r.name, r]));

test('a scenario whose checks all pass is recorded as PASS with its checks', async () => {
  const [r] = await runScenarios([ok('graph', 'one', 'two')], fakeEnv(), quiet);
  assert.strictEqual(r.name, 'graph');
  assert.strictEqual(r.status, 'PASS');
  assert.deepStrictEqual(r.checks.map((c) => c.name), ['one', 'two', 'no console errors or exceptions']);
  assert.strictEqual(exitCodeFor([r]), EXIT.OK);
});

test('a failing check fails its scenario and the run, and the others still run', async () => {
  const bad = { name: 'bad', board: 'fixture', run: async (page) => { page.check('fine', true); page.check('broken', false, { got: 1 }); } };
  const results = await runScenarios([bad, ok('after', 'x')], fakeEnv(), quiet);
  assert.deepStrictEqual(results.map((r) => [r.name, r.status]), [['bad', 'FAIL'], ['after', 'PASS']]);
  assert.strictEqual(exitCodeFor(results), EXIT.FAILED);
});

test('every check is logged under its scenario name, and a failure carries its detail', async () => {
  const lines = [];
  const sc = { name: 'graph', board: 'fixture', run: async (page) => { page.check('a thing', true); page.check('another', false, { n: 2 }); } };
  await runScenarios([sc], fakeEnv(), { timeoutMs: 1000, log: (l) => lines.push(l) });
  assert.ok(lines.includes('PASS  [graph] a thing'), lines.join('\n'));
  assert.ok(lines.includes('FAIL  [graph] another  {"n":2}'), lines.join('\n'));
});

test('a scenario forced to throw is reported FAIL under its name, the others still run, and the run exits non-zero', async () => {
  const lines = [];
  const scenarios = withFault([ok('graph', 'g'), ok('smoke', 's')], { kind: 'throw', scenario: 'graph' });
  const results = await runScenarios(scenarios, fakeEnv(), { timeoutMs: 1000, log: (l) => lines.push(l) });
  assert.deepStrictEqual(results.map((r) => [r.name, r.status]), [['graph', 'FAIL'], ['smoke', 'PASS']]);
  assert.match(results[0].error, /forced to fail/);
  assert.ok(lines.some((l) => /^FAIL {2}\[graph\] .*forced to fail/.test(l)), lines.join('\n'));
  assert.notStrictEqual(exitCodeFor(results), EXIT.OK);
});

test('a scenario that throws on its own is the same: FAIL under its name, the rest run', async () => {
  const boom = { name: 'boom', board: 'fixture', run: async () => { throw new TypeError('x is not a function'); } };
  const results = await runScenarios([ok('first', 'a'), boom, ok('last', 'b')], fakeEnv(), quiet);
  assert.deepStrictEqual(results.map((r) => [r.name, r.status]), [['first', 'PASS'], ['boom', 'FAIL'], ['last', 'PASS']]);
  assert.match(results[1].error, /x is not a function/);
});

test('a fault naming no scenario is refused rather than ignored', () => {
  assert.throws(() => withFault([ok('graph')], { kind: 'throw', scenario: 'nope' }), /unknown scenario 'nope'/);
  assert.deepStrictEqual(withFault([ok('graph')], null).map((s) => s.name), ['graph']);
});

test('a scenario that hangs is cut off at its own timeout and the next one runs', async () => {
  const hang = { name: 'hang', board: 'fixture', timeoutMs: 60, run: () => new Promise(() => {}) };
  const t0 = Date.now();
  const results = await runScenarios([hang, ok('next', 'n')], fakeEnv(), quiet);
  assert.ok(Date.now() - t0 < 900, 'it waited for the default timeout instead of its own');
  assert.strictEqual(results[0].status, 'FAIL');
  assert.match(results[0].error, /timed out after 0\.06s/);
  assert.strictEqual(results[1].status, 'PASS');
});

test('the default timeout applies to a scenario that names none', async () => {
  const hang = { name: 'hang', board: 'fixture', run: () => new Promise(() => {}) };
  const [r] = await runScenarios([hang], fakeEnv(), { timeoutMs: 50, log: () => {} });
  assert.match(r.error, /timed out after 0\.05s/);
});

test('a scenario cut off by its timeout can no longer record checks or touch the page', async () => {
  let lateCheck;
  const slow = {
    name: 'slow', board: 'fixture', timeoutMs: 30,
    run: async (page) => { await new Promise((r) => setTimeout(r, 80)); lateCheck = page; page.check('late', true); },
  };
  const [r] = await runScenarios([slow], fakeEnv(), quiet);
  await new Promise((res) => setTimeout(res, 120));
  assert.ok(lateCheck, 'the abandoned scenario never reached its late check');
  assert.ok(!r.checks.some((c) => c.name === 'late'));
});

test('Chrome lost mid-scenario fails that scenario at once, long before its timeout', async () => {
  const env = fakeEnv();
  const stuck = { name: 'stuck', board: 'fixture', timeoutMs: 20000, run: () => { setTimeout(() => env.lose('exited with signal SIGKILL'), 20); return new Promise(() => {}); } };
  const t0 = Date.now();
  const [r] = await runScenarios([stuck], env, { timeoutMs: 20000, log: () => {} });
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
  assert.strictEqual(r.status, 'FAIL');
  assert.match(r.error, /Chrome is gone: exited with signal SIGKILL/);
});

test('with Chrome gone, the scenarios still to run fail without being started, and the run exits non-zero', async () => {
  const env = fakeEnv();
  let started = 0;
  const later = (name) => ({ name, board: 'fixture', run: async () => { started += 1; } });
  const first = { name: 'first', board: 'fixture', run: () => { env.lose('crashed'); return new Promise(() => {}); } };
  const results = await runScenarios([first, later('second'), later('third')], env, quiet);
  assert.deepStrictEqual(results.map((r) => r.status), ['FAIL', 'FAIL', 'FAIL']);
  assert.strictEqual(started, 0);
  assert.deepStrictEqual(env.begun, ['first']);
  assert.match(results[2].error, /Chrome is gone: crashed/);
  assert.strictEqual(exitCodeFor(results), EXIT.FAILED);
});

test('console errors during a scenario fail it, and a quiet console is a check that passes', async () => {
  const noisy = await runScenarios([ok('s', 'fine')], fakeEnv({ errors: ['{"text":"boom"}'] }), quiet);
  const failing = noisy[0].checks.find((c) => c.name === 'no console errors or exceptions');
  assert.strictEqual(failing.ok, false);
  assert.strictEqual(noisy[0].status, 'FAIL');
  const calm = await runScenarios([ok('s', 'fine')], fakeEnv(), quiet);
  assert.strictEqual(calm[0].checks.find((c) => c.name === 'no console errors or exceptions').ok, true);
});

test('each scenario begins on its own board and is ended afterwards, also when it threw', async () => {
  const env = fakeEnv();
  const boom = { name: 'boom', board: 'plan', run: async () => { throw new Error('x'); } };
  await runScenarios([ok('a'), boom], env, quiet);
  assert.deepStrictEqual(env.begun, ['a', 'boom']);
  assert.deepStrictEqual(env.ended, [['a', 'PASS'], ['boom', 'FAIL']]);
});

test('a scenario whose begin fails is recorded as FAIL and the run goes on', async () => {
  const env = fakeEnv();
  const realBegin = env.begin.bind(env);
  env.begin = async (sc, ctx) => { if (sc.name === 'a') throw new Error('the board would not load'); return realBegin(sc, ctx); };
  const results = await runScenarios([ok('a'), ok('b')], env, quiet);
  assert.deepStrictEqual(results.map((r) => r.status), ['FAIL', 'PASS']);
  assert.match(results[0].error, /the board would not load/);
});

test('running the scenarios in reverse order gives the same results', async () => {
  const mk = () => [ok('graph', 'g1', 'g2'), { name: 'smoke', board: 'plan', run: async (p) => { p.check('s1', true); p.check('s2', false); } }, ok('third', 't1')];
  const forward = await runScenarios(mk(), fakeEnv(), quiet);
  const reversed = await runScenarios(mk().reverse(), fakeEnv(), quiet);
  const shape = (rs) => JSON.stringify(Object.entries(byName(rs)).sort().map(([n, r]) => [n, r.status, r.checks]));
  assert.strictEqual(shape(reversed), shape(forward));
});

test('the exit code is 1 when nothing ran, so an empty run never passes', () => {
  assert.strictEqual(exitCodeFor([]), EXIT.FAILED);
});

test('the summary names every scenario with its verdict, then the totals', async () => {
  const boom = { name: 'boom', board: 'fixture', run: async () => { throw new Error('nope'); } };
  const results = await runScenarios([ok('graph', 'a', 'b'), boom], fakeEnv(), quiet);
  const lines = summaryLines(results);
  assert.ok(lines.some((l) => /^PASS +graph\b.*3 checks/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^FAIL +boom\b.*nope/.test(l)), lines.join('\n'));
  assert.match(lines[lines.length - 1], /1 passed, 1 failed \(2 scenarios, 3 checks\)/);
});
