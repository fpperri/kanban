const { test, after } = require('node:test');
const assert = require('node:assert');

const scenario = require('./browser/scenarios/graph-flow');
const scenarios = require('./browser/scenarios');
const { graphBuild, graphNeighbours, graphQueryEffect } = require('../web/graph-model');
const { graphFlowPlace, graphFlowMarks } = require('../web/graph-flow');
const { parseSearchQuery, filterCards } = require('../web/search');
const { loadBoard, cleanUp } = require('./helpers/fan-boards');

// The graph-flow scenario only runs in a browser (in CI). Here its lists are held to the Flow layout and
// the Graph model over the plan board's own cards, so a wrong expectation fails in the unit suite and not
// only in a slow browser run.

after(cleanUp);

const board = loadBoard('plan');
const searchCtx = { ...board.ctx, hierarchy: board.config.hierarchy };
const CASE = scenario.CASES.plan;
const sorted = (list) => [...list].map(Number).sort((a, b) => a - b);
const modelOf = (visible = board.live.map((c) => c.id)) => graphBuild(board.all, { ctx: board.ctx, hierarchy: board.config.hierarchy, types: board.config.types, visibleIds: new Set(visible) });
const flowOf = (deps, model = modelOf()) => graphFlowPlace(model, { deps });
const headsOf = (flow) => graphFlowMarks(flow).texts.map((t) => t.text);
const columnsOf = (flow) => flow.columns.map((c) => sorted(c.ids));

test('the scenario is in the runner, on the plan board with the fixture board beside it', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'graph-flow'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['fixture']);
  assert.ok(scenario.timeoutMs >= 60000 && scenario.timeoutMs <= 120000);
});

test('the columns, their headings and the strip are the Flow layout\'s, in frontier and in all', () => {
  for (const deps of ['frontier', 'all']) {
    const flow = flowOf(deps);
    assert.deepStrictEqual(columnsOf(flow), CASE[deps].columns, deps);
    assert.deepStrictEqual(headsOf(flow), CASE[deps].heads, deps);
    assert.strictEqual(flow.strip.count, CASE.strip, deps);
  }
});

test('the board is what the scenario says: 26 live cards, seven joined by a wait, one of them done, the rest with no dependency either way', () => {
  const model = modelOf();
  assert.strictEqual(model.nodes.length, CASE.dots);
  const waits = model.links.filter((l) => l.kind === 'wait');
  assert.deepStrictEqual(waits.map((l) => `${l.from}>${l.to}`).sort(), CASE.arrows.slice().sort());
  const joined = new Set(waits.flatMap((l) => [l.from, l.to]));
  assert.strictEqual(joined.size, 8);
  assert.strictEqual(model.nodes.length - joined.size, CASE.strip);
  assert.strictEqual(model.byId.get(String(CASE.done)).status, 'done');
  assert.ok(model.nodes.filter((n) => n.status === 'done' && joined.has(n.id)).length === 1, 'card 5 is the only done card with a dependency');
  assert.notStrictEqual(model.byId.get(String(CASE.typed)).shape, 'circle', 'the typed card draws a mark, not a round dot');
});

test('a lone card lights with its dependencies in the Flow, and its parent besides in the Hierarchy', () => {
  const model = modelOf();
  const id = String(CASE.lone.card);
  assert.deepStrictEqual(sorted(graphNeighbours(model, id, 'wait')), CASE.lone.lit);
  assert.ok(graphNeighbours(model, id).has('1'), 'in the Hierarchy card 1, its parent, lights too');
  assert.strictEqual(model.byId.get(id).parentId, '1');
});

test('the query lights a done card and a card in the strip', () => {
  const terms = parseSearchQuery(CASE.search.query, board.name);
  const lit = sorted(filterCards(board.all, terms, searchCtx).map((c) => c.id)).filter((id) => board.live.some((c) => Number(c.id) === id));
  assert.deepStrictEqual(lit, CASE.search.lit);
  const flow = flowOf('frontier');
  const columnOf = (id) => flow.columns.find((c) => c.ids.includes(String(id)));
  assert.strictEqual(columnOf(CASE.done).label, 'done');
  assert.strictEqual(columnOf(10), undefined, 'card 10 is in the strip');
  assert.ok(flow.strip.ids.includes('10'));
});

test('without the done cards the Flow has no done column, 27 has no dependency drawn and goes to the strip', () => {
  const visible = board.live.filter((c) => c.status !== 'done').map((c) => c.id);
  const model = modelOf(visible);
  const flow = flowOf('frontier', model);
  const want = CASE.withoutDone;
  assert.strictEqual(model.nodes.length, want.dots);
  assert.deepStrictEqual(headsOf(flow), want.frontier.heads);
  assert.deepStrictEqual(columnsOf(flow), want.frontier.columns);
  assert.strictEqual(flow.strip.count, want.strip);
  assert.ok(flow.strip.ids.includes('27'));
});

test('the slice cut draws the cards the scenario says, none of which waits for another', () => {
  const terms = parseSearchQuery(CASE.cut.query, board.name);
  const match = { terms, ids: new Set(filterCards(board.all, terms, searchCtx).map((c) => String(c.id))) };
  const effect = graphQueryEffect(match, board.all, searchCtx);
  const live = new Set(board.live.map((c) => String(c.id)));
  const draws = sorted([...effect.visibleIds].filter((id) => live.has(id)));
  assert.deepStrictEqual(draws, CASE.cut.draws);
  const flow = flowOf('frontier', modelOf(draws.map(String)));
  assert.deepStrictEqual(flow.columns, []);
  assert.deepStrictEqual(headsOf(flow), [`no dependency either way · ${draws.length} cards`]);
});

test('the isolated cards are laid out by the dependencies between them', () => {
  const want = CASE.isolated;
  const model = modelOf(want.draws.map(String));
  const flow = flowOf('frontier', model);
  assert.deepStrictEqual(headsOf(flow), want.heads);
  assert.deepStrictEqual(columnsOf(flow), want.columns);
  assert.strictEqual(flow.strip, null);
  assert.deepStrictEqual(model.links.filter((l) => l.kind === 'wait').map((l) => `${l.from}>${l.to}`).sort(), want.arrows);
  assert.strictEqual(want.text, want.draws.map((id) => `#${id}`).join(' | '));
});

test('the loop the scenario adds goes where the scenario says, in frontier and in all', () => {
  const extra = [
    { id: '30', title: 'Loop first', status: 'todo', archived: false, parent: null, waiting_for: ['31'], blocked: false, review: false },
    { id: '31', title: 'Loop second', status: 'todo', archived: false, parent: null, waiting_for: ['30'], blocked: false, review: false },
    { id: '32', title: 'Loop behind it', status: 'todo', archived: false, parent: null, waiting_for: ['30'], blocked: false, review: false },
  ];
  const cards = board.all.concat(extra);
  const model = graphBuild(cards, { ctx: board.ctx, hierarchy: board.config.hierarchy, types: board.config.types, visibleIds: new Set(board.live.concat(extra).map((c) => c.id)) });
  const frontier = headsOf(graphFlowPlace(model, { deps: 'frontier' }));
  assert.deepStrictEqual(frontier, [...CASE.frontier.heads.slice(0, 3), ...CASE.loop.frontier, CASE.frontier.heads.at(-1)]);
  assert.deepStrictEqual(headsOf(graphFlowPlace(model, { deps: 'all' })), [...CASE.loop.all, CASE.all.heads.at(-1)]);
});
