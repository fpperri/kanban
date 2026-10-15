const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listActive, listArchived } = require('../scripts/card-store');
const { readConfig } = require('../scripts/config-store');
const { parseSearchQuery, filterCards } = require('../web/search');
const { materialize } = require('./browser/boards');
const scenarios = require('./browser/scenarios');
const sliceTerm = require('./browser/scenarios/slice-term');

// The browser runner's slice-term scenario only runs in a browser (in CI). What
// it expects each cut to show is held here to the search module over each
// board's own cards and the hierarchy the board's own reader gives the page, and
// the scenario is run once against a stand-in page so a typo in it fails here
// and not only in a slow browser run.

const roots = [];
const load = (key) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-slice-${key}-`));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const live = listActive(dir);
  return { live, all: live.concat(listArchived(dir)), config: readConfig(dir) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const found = (board, name, query) => {
  const ctx = { board: name, hierarchy: board.config.hierarchy };
  return new Set(filterCards(board.all, parseSearchQuery(query, name), ctx).map((c) => c.id));
};
const shownBy = (board, name, query) => {
  const hit = found(board, name, query);
  return board.live.filter((c) => hit.has(c.id)).map((c) => c.id).sort((a, b) => a - b);
};
const datedShownBy = (board, name, query) => {
  const hit = found(board, name, query);
  return board.live.filter((c) => hit.has(c.id) && (c.start_date || c.end_date || c.due_date)).map((c) => c.id).sort((a, b) => a - b);
};

test('the scenario is in the runner, on the plan board, and also drives the fixture and malformed boards', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'slice-term'), sliceTerm);
  assert.strictEqual(sliceTerm.board, 'plan');
  assert.deepStrictEqual(sliceTerm.alsoBoards, ['fixture', 'malformed']);
});

test('on the plan board, slice:goal..objective keeps the goal, strategy and objective cards, and slice:0 keeps both dated cards', () => {
  const board = load('plan');
  const { cut, depthZero } = sliceTerm.CASES.plan;
  assert.deepStrictEqual(shownBy(board, 'plan', cut.query), cut.shows);
  assert.deepStrictEqual(datedShownBy(board, 'plan', cut.query), [], 'no dated card is in the cut, so the Gantt and the Calendar have nothing to draw');
  assert.deepStrictEqual(datedShownBy(board, 'plan', depthZero.query), depthZero.datedShows);
  const types = new Map(board.live.map((c) => [c.id, c.type]));
  assert.deepStrictEqual(cut.shows.map((id) => types.get(id)), ['goal', 'strategy', 'objective', 'goal', 'strategy']);
  assert.deepStrictEqual(depthZero.datedShows.map((id) => types.get(id)), ['task', 'task']);
});

test('the live cards each case starts from are the boards\' live cards, and the cuts hide some of them', () => {
  const ids = (board) => board.live.map((c) => c.id).sort((a, b) => a - b);
  const plan = load('plan');
  assert.deepStrictEqual(ids(plan), sliceTerm.CASES.plan.live);
  assert.deepStrictEqual(ids(load('fixture')), sliceTerm.CASES.fixture.live);
  assert.deepStrictEqual(ids(load('malformed')), sliceTerm.CASES.malformed.live);
  assert.ok(sliceTerm.CASES.plan.cut.shows.length < sliceTerm.CASES.plan.live.length);
  assert.ok(sliceTerm.CASES.fixture.shows.length < sliceTerm.CASES.fixture.live.length);
  const noHierarchy = { ...plan, config: { hierarchy: [] } };
  assert.deepStrictEqual(shownBy(noHierarchy, 'plan', sliceTerm.CASES.plan.cut.query), sliceTerm.CASES.plan.live, 'without the hierarchy the same term cuts nothing');
});

test('on today\'s fixture board, which has no hierarchy, slice:1 keeps exactly the depth-1 cards', () => {
  const board = load('fixture');
  assert.deepStrictEqual(board.config.hierarchy, []);
  const { query, shows } = sliceTerm.CASES.fixture;
  assert.deepStrictEqual(shownBy(board, 'fixture', query), shows);
  const root = board.live.find((c) => c.id === 1);
  assert.strictEqual(root.parent, null, 'card 1 is a root');
  assert.deepStrictEqual(shows, board.live.filter((c) => c.parent === 1).map((c) => c.id).sort((a, b) => a - b), 'the cards directly under it');
});

test('on the malformed board a cut naming a tier written twice in mixed case keeps that tier\'s cards', () => {
  const board = load('malformed');
  const { tier, other, run } = sliceTerm.CASES.malformed;
  for (const { query, shows } of [tier, other, run]) {
    assert.deepStrictEqual(shownBy(board, 'malformed', query), shows, query);
  }
  assert.deepStrictEqual(board.config.hierarchy, ['Goal', 'goal', 'Epic', 'EPIC'], 'each tier is listed twice in mixed case');
  const types = new Map(board.live.map((c) => [c.id, c.type]));
  assert.strictEqual(types.get(tier.shows[0]), 'Goal');
  assert.strictEqual(types.get(other.shows[0]), 'epic', 'the card writes the tier in a third case than the board\'s first listing');
});

test('the selectors the scenario reads name classes and containers the page really draws', () => {
  const web = path.join(__dirname, '..', 'web');
  const pageSource = ['app.js', 'app.html', 'graph-view.js'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  assert.deepStrictEqual(Object.keys(sliceTerm.SELECTORS), ['board', 'map', 'gantt', 'calendar', 'graph']);
  for (const [view, selector] of Object.entries(sliceTerm.SELECTORS)) {
    for (const m of selector.matchAll(/(?:^|[ .#])([a-z][\w-]*)(?=[ .[]|$)/g)) {
      assert.ok(pageSource.includes(m[1]), `${view}: ${m[1]} is not in the page code`);
    }
  }
});

test('the scenario waits on the page and never on a fixed sleep', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'slice-term.js'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
});

test('the scenario reads no page global, so a rename in the page cannot break it with an eval error', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'slice-term.js'), 'utf8');
  assert.ok(!/Page globals this scenario reads/.test(src));
  assert.ok(!/\b(state|selectedIds|autoRefreshTick|renderGraphView)\b/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
});

test('run against a stand-in page, the scenario writes each query to the box and makes its checks without throwing', async () => {
  const written = [];
  const opened = [];
  const checks = [];
  const page = {
    ev: async (expr) => {
      const m = /i\.value=("(?:[^"\\]|\\.)*")/.exec(expr);
      if (m) written.push(JSON.parse(m[1]));
      return '';
    },
    send: async () => {},
    open: async (url, key) => { opened.push([url, key]); },
    waitFor: async () => true,
    shot: async () => {},
    check: (name, ok) => checks.push([name, ok]),
  };
  await sliceTerm.run(page);
  const { plan, fixture, malformed } = sliceTerm.CASES;
  assert.deepStrictEqual(opened.map(([, key]) => key).filter((k, i, all) => all.indexOf(k) === i), ['plan', 'fixture', 'malformed']);
  assert.ok(opened.some(([url]) => url.startsWith('/?view=map')));
  assert.ok(opened.some(([url]) => url.startsWith('/?view=gantt')));
  assert.ok(opened.some(([url]) => url.startsWith('/?view=calendar')));
  assert.ok(opened.some(([url]) => url.startsWith('/?view=graph')));
  for (const query of [plan.cut.query, plan.depthZero.query, fixture.query, malformed.tier.query, malformed.other.query, malformed.run.query]) {
    assert.ok(written.includes(query), `the scenario writes ${query}`);
  }
  assert.deepStrictEqual(checks.filter(([, ok]) => !ok), [], 'every check passes against a page that answers yes');
  assert.deepStrictEqual(checks.map(([name]) => name), [
    'plan: the Board shows every live card before any cut',
    'plan: slice:goal..objective on the Board shows only the goal, strategy and objective cards',
    'plan: the Map draws cards before any cut',
    'plan: the Map shows the same cards under the cut',
    'plan: slice:0 draws both dated cards on the Gantt',
    'plan: the cut draws none of them on the Gantt',
    'plan: slice:0 draws a dated card on the Calendar',
    'plan: the cut draws none of them on the Calendar',
    'plan: the Graph draws dots before any cut',
    'plan: the Graph draws no dot outside the cut',
    'fixture: the Board shows every live card before any cut',
    'fixture: slice:1 keeps only the depth-1 cards',
    'malformed: the Board shows every live card before any cut',
    'malformed: slice:goal keeps the card of the tier the board lists as Goal and goal',
    'malformed: slice:EPIC keeps the card of the tier the board lists as Epic and EPIC',
    'malformed: slice:goal..epic keeps the cards of both tiers',
  ]);
});
