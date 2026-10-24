const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const scenario = require('./browser/scenarios/config-keys');
const scenarios = require('./browser/scenarios');
const { materialize } = require('./browser/boards');
const { readConfig } = require('../../plugin/skills/web/scripts/config-store');

// The config-keys scenario only runs in a browser (in CI). Here its logic runs
// against a stand-in page: a vm that holds `state` the way the real page does,
// loads each board's real config through the real reader when the scenario
// opens it, and applies it again when the scenario's poll runs. What is varied
// is what the page does with it, so a scenario that could never fail is caught.

const tmpRoots = [];
after(() => { for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true }); });

function answerFor(key) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-keys-scenario-${key}-`));
  tmpRoots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const config = readConfig(dir);
  return JSON.parse(JSON.stringify({ name: config.name, hierarchy: config.hierarchy, pills: config.pills, types: config.types }));
}
const ANSWERS = { plan: answerFor('plan'), malformed: answerFor('malformed') };

// `apply(state, answer)` is what the stand-in page does with a board answer on
// the load and on a poll.
function standIn({ onLoad, onPoll }) {
  const checks = [];
  let answer = null;
  const ctx = vm.createContext({
    state: { hierarchy: [], pills: [], types: [] },
    document: {
      getElementById: () => ({ get textContent() { return answer ? answer.name : ''; } }),
      querySelectorAll: () => ({ length: answer ? 3 : 0 }),
    },
    autoRefreshTick: async () => { onPoll(ctx.state, answer); },
  });
  const run = (expr) => vm.runInContext(expr, ctx);
  const page = {
    checks,
    opened: [],
    check: (name, ok) => checks.push([name, !!ok]),
    open: async (p, key) => { page.opened.push([key, p]); answer = ANSWERS[key]; onLoad(ctx.state, answer); },
    ev: async (expr) => run(expr),
    waitFor: async (expr) => !!run(expr),
  };
  return page;
}

const apply = (state, answer) => {
  state.hierarchy = answer.hierarchy || [];
  state.pills = answer.pills || [];
  state.types = answer.types || [];
};
const failed = (page) => page.checks.filter(([, ok]) => !ok).map(([n]) => n);

test('the scenario is registered, on the plan board with the malformed board beside it', () => {
  assert.ok(scenarios.includes(scenario));
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['malformed']);
});

test('what the scenario expects is what the real reader makes of each fixture board', () => {
  for (const key of ['plan', 'malformed']) {
    const a = ANSWERS[key];
    const icons = a.types.filter((t) => t.icon !== undefined).map((t) => [t.name, t.icon]);
    assert.deepStrictEqual({ hierarchy: a.hierarchy, pills: a.pills, icons }, scenario.EXPECTED[key], key);
  }
});

test('a page that holds the config after the load and puts it back on a poll passes every check, on both boards', async () => {
  const page = standIn({ onLoad: apply, onPoll: apply });
  await scenario.run(page);
  assert.deepStrictEqual(page.opened.map(([k, p]) => `${k}${p}`), ['plan/', 'malformed/']);
  assert.deepStrictEqual(failed(page), []);
  assert.strictEqual(page.checks.length, 8);
});

test('a page that does not put the config back on a poll fails the poll check, and only that one', async () => {
  const page = standIn({ onLoad: apply, onPoll: () => {} });
  await scenario.run(page);
  assert.deepStrictEqual(failed(page), [
    'plan: the page holds them again after a poll',
    'malformed: the page holds them again after a poll',
  ]);
});

test('a page that holds the config only from the load fails the poll check even when the load left it in place', async () => {
  const page = standIn({ onLoad: apply, onPoll: (state, answer) => { state.hierarchy = answer.hierarchy; } });
  await scenario.run(page);
  assert.ok(failed(page).includes('plan: the page holds them again after a poll'));
});

test('a page that drops the hierarchy, the pills or the icons on the load fails the load check', async () => {
  for (const drop of ['hierarchy', 'pills', 'icons']) {
    const page = standIn({
      onLoad: (state, answer) => {
        apply(state, answer);
        if (drop === 'icons') state.types = state.types.map(({ name, color }) => ({ name, color }));
        else state[drop] = [];
      },
      onPoll: apply,
    });
    await scenario.run(page);
    assert.deepStrictEqual(failed(page), [
      "plan: the page holds the hierarchy, the pills and each type's icon after the load",
      "malformed: the page holds the hierarchy, the pills and each type's icon after the load",
    ], drop);
  }
});

test('a page that holds the broken entries of the malformed board as written fails that board\'s check', async () => {
  const page = standIn({
    onLoad: (state, answer) => { apply(state, answer); if (answer.name === 'malformed') state.hierarchy = ['Goal', 'goal', '', 'Epic', 'EPIC']; },
    onPoll: apply,
  });
  await scenario.run(page);
  assert.deepStrictEqual(failed(page), ["malformed: the page holds the hierarchy, the pills and each type's icon after the load"]);
});

test('the scenario never waits on a fixed sleep: it waits on the page', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'config-keys.js'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src));
});
