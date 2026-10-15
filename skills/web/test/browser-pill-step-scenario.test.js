const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive } = require('../scripts/card-store');
const { parseConfig } = require('../scripts/config-store');
const { materialize } = require('./browser/boards');
const { parseSearchQuery, filterCards, searchTermText } = require('../web/search');
const { pillList, pillRows, pillStep, pillsOn } = require('../web/pills');
const { NO_SELECTION, queryPart } = require('../web/selection');
const scenarios = require('./browser/scenarios');
const scenario = require('./browser/scenarios/pill-step');

// The browser runner's pill-step scenario only runs in a browser (in CI). What it expects of
// the plan board is held here to the pill list's own step, over the board's config and cards,
// the in-page expressions it sends are all parsed, and the scenario is run once against a
// stand-in page so a typo in it fails here and not only in a slow browser run.

const roots = [];
const planBoard = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-pill-step-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('plan', dir);
  const live = listActive(dir);
  const config = parseConfig(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'));
  const matchIds = (query) => new Set(filterCards(live, parseSearchQuery(query, 'plan'), { board: 'plan' }).map((c) => c.id));
  const list = pillList(live, matchIds, { pills: config.pills, cards: live, term: searchTermText });
  return { live, list };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'pill-step.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { CASES } = scenario;

// The pills the key lands on, one press at a time from off, the way the page applies a step:
// a solo of the pill the step answers, and the pill that is on alone, soloed again, is every pill off.
function walkOf(list, direction) {
  const landed = [];
  let selection = NO_SELECTION;
  for (let guard = 0; guard < list.length + 2; guard++) {
    const pill = pillStep(list, selection, direction);
    const off = pillsOn(selection, list).length === 1 && pillsOn(selection, list)[0] === pill;
    if (off) return landed;
    landed.push(pill);
    selection = { anchor: queryPart(pill.query), additions: [] };
  }
  throw new Error('the walk never ends');
}

test('the scenario is in the runner, on the plan board, with time for its walks', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'pill-step'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.ok(scenario.timeoutMs >= 60000);
});

test('the walk the scenario names is the walk the pill list\'s own step makes over the plan board, forward and back', () => {
  const { list } = planBoard();
  assert.deepStrictEqual(walkOf(list, 1).map((p) => p.label), CASES.walk);
  assert.deepStrictEqual(walkOf(list, -1).map((p) => p.label), [...CASES.walk].reverse());
  assert.deepStrictEqual(CASES.walk.slice(0, 5), ['blocked', 'review', 'waiting', 'next', 'assignee:@human'], 'the built-ins, then the board\'s pills, in the panel\'s order');
  assert.ok(!CASES.walk.includes('next-up'), 'the tag pill that holds the next pill\'s query is the same step');
});

test('each step writes the query the scenario says, the count it says, and turns on the buttons it says', () => {
  const { list } = planBoard();
  for (const label of CASES.walk) {
    const pill = list.find((p) => p.label === label);
    assert.strictEqual(pill.query, CASES.queries[label], label);
    assert.strictEqual(pill.count, CASES.counts[label], label);
    const on = list.filter((p) => p.query === pill.query).map((p) => p.label);
    assert.deepStrictEqual(on, CASES.on[label], `${label}: the buttons that are on together`);
  }
});

test('the pills behind the "+2 more" button are the last pills of the walk, and the scenario names them', () => {
  const { list } = planBoard();
  const rows = pillRows(list, []);
  const shownLabels = rows.filter((r) => r.kind !== 'more').map((r) => r.label);
  const hiddenLabels = list.map((p) => p.label).filter((l) => !shownLabels.includes(l));
  assert.deepStrictEqual(hiddenLabels, CASES.behindButton);
  assert.deepStrictEqual(CASES.walk.slice(-2), CASES.behindButton);
});

test('the scenario\'s first steps are made with the panel closed and the rest with it open, and the walk is longer than the closed steps', () => {
  assert.strictEqual(CASES.closedSteps, 2);
  assert.ok(CASES.walk.length > CASES.closedSteps + 2);
});

test('the scenario does not wait on a fixed sleep', () => {
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
});

test('the ids the scenario drives are in the page', () => {
  const web = path.join(__dirname, '..', 'web');
  const page = ['app.html', 'search-panel.js', 'app.css'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  for (const name of ['search-panel', 'search-chip', 'search-pills', 'query-pill', 'query-pill-label', 'query-pill-more', 'search-clear-btn', 'prefs-btn', 'detail-modal', 'detail-close', 'context-menu', 'prefs-sheet', 'search-input']) {
    assert.ok(page.includes(name) || fs.readFileSync(path.join(web, 'app.js'), 'utf8').includes(name), `${name} is in the page`);
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in one
// fails here, and the keys it presses are logged. Whether each check holds is for the browser.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], keys: [] };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 120)}`); }
  };
  const answer = (expr) => {
    if (/^\[\.\.\.new Set\(\[\.\.\.document\.querySelectorAll\('#board \.card-el'\)\]/.test(expr)) return Array.from({ length: 24 }, (_, i) => i + 1);
    if (/getElementById\('search-chip'\)/.test(expr)) return { hidden: false, text: '1', name: '1 on: x', title: '1 on: x' };
    if (/getElementById\('search-input'\)\.value$/.test(expr)) return '';
    return true;
  };
  return {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    open: async (p) => { log.opened.push(p); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async () => ({ x: 10, y: 10 }),
    click: async () => {},
    key: async (name, mods = {}) => { log.keys.push([name, mods]); },
    rightClick: async () => true,
    check: (name, ok) => log.checks.push([name, ok]),
  };
}

test('run once against a stand-in page the scenario finishes, and every expression it sends to the page parses', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.bad, [], 'an expression the scenario sends does not parse');
  assert.ok(page.log.exprs.length > 100, 'it sends the page a lot of expressions');
  const names = page.log.checks.map(([n]) => n);
  assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a check name used twice');
  for (const n of names) assert.ok(n.length > 12 && /[a-z]/.test(n), n);
});

test('it presses m once per pill and once more to turn every pill off, and Shift+m the same, each press a real key', async () => {
  const page = standIn();
  await scenario.run(page);
  const plain = page.log.keys.filter(([k, mods]) => k === 'm' && !Object.keys(mods).length);
  const shift = page.log.keys.filter(([k, mods]) => k === 'M' && mods.shift === true);
  const steps = CASES.walk.length;
  const views = CASES.views.length;
  assert.strictEqual(plain.length, steps + 1 + 1 + 1 + 1 + 1 + 1 + 2 * views, 'the walk, off, starting over, then the box, a card menu, the sheet and a dialog, then two in each view');
  assert.strictEqual(shift.length, 1 + steps + 1 + 2 * views, 'off before the first, the walk back, off again, then two in each view');
  assert.strictEqual(page.log.keys.filter(([k, mods]) => k === 'm' && (mods.ctrl || mods.alt)).length, 2, 'Ctrl+m and Alt+m');
});

test('it makes a check for every step of both walks, each named by its pill', async () => {
  const page = standIn();
  await scenario.run(page);
  const names = page.log.checks.map(([n]) => n);
  for (const label of CASES.walk) {
    assert.ok(names.includes(`m turns on the ${label} pill alone`), `forward ${label}`);
    assert.ok(names.includes(`Shift+m turns on the ${label} pill alone`), `backward ${label}`);
  }
  for (const part of ['turns every pill off and brings every card back', 'starts over', 'typed in the search box is a letter', 'Ctrl or Alt', 'card menu up', 'preferences sheet up', 'dialog up']) {
    assert.ok(names.some((n) => n.includes(part)), part);
  }
  for (const view of CASES.views) assert.ok(names.some((n) => n.startsWith(`${view}: m writes`)), view);
});

test('it loads the plan board cold, opens a card by its address, and loads each of the other views', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.opened, ['/', `/?card=${CASES.card}`, ...CASES.views.map((v) => `/?view=${v}`)]);
});
