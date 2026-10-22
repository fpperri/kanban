const { test } = require('node:test');
const assert = require('node:assert');

const {
  GRAPH_LAYOUTS, mergeGraphLayout, graphBuild, graphLayout, graphLayoutFlow, graphSignature, graphLayoutCacheClear, graphPlan,
  graphNeighbours, graphRestLit, graphLinkPaths, graphRadius,
} = require('../web/graph-model');
const { graphFlowPath, graphFlowMarks } = require('../web/graph-flow');

// The Flow as the Graph model finishes and draws it: the layout kind, its cache and signature, the
// bounds, the plan's dots, arrows and marks, and what the pointer or a lone card lights. The columns
// themselves are pinned in graph-flow.test.js.

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra = {}) => ({
  id: String(id), title: `card ${id}`, status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, ...extra,
});
const TYPES = [{ name: 'epic', icon: 'diamond' }];
const cards = () => [
  card(1, { status: 'done' }), card(2, { waiting_for: ['1'], parent: 9, type: 'epic' }), card(3, { waiting_for: ['2'], status: 'doing', blocked: true }),
  card(4), card(9, { type: 'epic' }),
];
const model = (list = cards()) => graphBuild(list, { ctx: CTX, types: TYPES });
const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Map ? [...x] : x)));
const planOf = (m, deps = 'frontier') => {
  const layout = graphLayout(m, 'flow', { deps });
  return { layout, plan: graphPlan(m, layout, { kind: 'flow', statusClass: (s) => s, titleOf: (c) => c.title, types: TYPES }) };
};

test('flow is a layout the Graph can be on, beside the one of the Hierarchy, and anything else is Tiers', () => {
  assert.deepStrictEqual(GRAPH_LAYOUTS, ['tiers']);
  assert.strictEqual(mergeGraphLayout('flow'), 'flow');
  for (const k of GRAPH_LAYOUTS) assert.strictEqual(mergeGraphLayout(k), k);
  for (const bad of [undefined, null, '', 'hierarchy', 'Flow', 7]) assert.strictEqual(mergeGraphLayout(bad), 'tiers');
});

test('the layout carries the flow, finishes its bounds round every dot and mark, and is the same layout as graphLayout gives', () => {
  const m = model();
  const l = graphLayoutFlow(m, { deps: 'all' });
  assert.ok(l.flow && l.flow.columns.length > 0 && l.flow.strip);
  assert.deepStrictEqual([l.rings, l.spokes], [[], []]);
  for (const p of l.pos.values()) assert.ok(p.x >= l.bounds.x0 && p.x <= l.bounds.x1 && p.y >= l.bounds.y0 && p.y <= l.bounds.y1);
  for (const b of l.flow.boxes) assert.ok(b.x0 >= l.bounds.x0 && b.y0 >= l.bounds.y0 && b.x1 <= l.bounds.x1 && b.y1 <= l.bounds.y1);
  assert.deepStrictEqual(plain(graphLayout(m, 'flow', { deps: 'all' })), plain(l));
  assert.ok(Object.values(l.bounds).every(Number.isFinite));
});

test('the layout is kept for what decides it: the same cards and switch give the same layout, another switch gives another', () => {
  graphLayoutCacheClear();
  const m = model();
  const frontier = graphLayout(m, 'flow', { deps: 'frontier' });
  assert.strictEqual(graphLayout(m, 'flow', { deps: 'frontier' }), frontier);
  assert.strictEqual(graphLayout(m, 'flow', {}), frontier, 'no switch is frontier');
  assert.notStrictEqual(graphLayout(m, 'flow', { deps: 'all' }), frontier);
  assert.notStrictEqual(graphSignature(m, 'flow', { deps: 'all' }), graphSignature(m, 'flow', { deps: 'frontier' }));
  assert.strictEqual(graphSignature(m, 'flow', {}), graphSignature(m, 'flow', { deps: 'frontier' }));
  assert.notStrictEqual(graphSignature(m, 'flow', {}), graphSignature(m, 'tiers', {}));
  assert.strictEqual(graphSignature(m, 'tiers', { deps: 'all' }), graphSignature(m, 'tiers', {}), 'the Hierarchy does not read the switch');
});

test('a card done or undone moves the layout, since the signature holds the statuses', () => {
  const was = graphSignature(model(), 'flow', { deps: 'frontier' });
  const next = cards();
  next[1] = { ...next[1], status: 'done' };
  assert.notStrictEqual(graphSignature(model(next), 'flow', { deps: 'frontier' }), was);
});

test('the plan draws a dot for each card in the flow\'s radius and the type\'s mark, and an arrow for each dependency only', () => {
  const m = model();
  const { layout, plan } = planOf(m);
  assert.strictEqual(plan.nodes.length, m.nodes.length);
  for (const n of plan.nodes) {
    assert.strictEqual(n.r, layout.flow.radius.get(n.id));
    assert.deepStrictEqual([n.x, n.y], [Math.round(layout.pos.get(n.id).x * 100) / 100, Math.round(layout.pos.get(n.id).y * 100) / 100]);
  }
  assert.strictEqual(plan.nodes.find((n) => n.id === '2').shape, 'diamond');
  assert.ok(plan.nodes.find((n) => n.id === '3').cls.includes('status-doing') && plan.nodes.find((n) => n.id === '3').cls.includes('is-blocked'));
  assert.ok(plan.nodes.find((n) => n.id === '1').cls.includes('is-done'));
  const byPair = (a, b) => `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`);
  const links = plan.links.slice().sort(byPair);
  assert.deepStrictEqual(links.map((l) => [l.from, l.to, l.kind, l.arrow]), [['1', '2', 'wait', true], ['2', '3', 'wait', true]], 'the parent line of card 2 is not drawn');
  assert.deepStrictEqual(links.map((l) => l.d), [graphFlowPath(layout.flow, '1', '2'), graphFlowPath(layout.flow, '2', '3')]);
  assert.deepStrictEqual([plan.guides, plan.captions, plan.tints, plan.dividers, plan.block, plan.looseCaption], [[], [], [], [], null, null]);
});

test('every link of the model has its path, in the model\'s order, so the plan\'s lines can be found by index', () => {
  const m = model();
  const layout = graphLayout(m, 'flow', { deps: 'frontier' });
  const paths = graphLinkPaths(m, layout, 'flow');
  assert.strictEqual(paths.length, m.links.length);
  m.links.forEach((l, i) => { if (l.kind === 'wait') assert.strictEqual(paths[i], graphFlowPath(layout.flow, l.from, l.to)); });
});

test('the plan carries the marks behind the dots: a frame and a heading for each column and the strip', () => {
  const m = model();
  const { layout, plan } = planOf(m);
  assert.deepStrictEqual(plan.flow, graphFlowMarks(layout.flow));
  assert.deepStrictEqual(plan.flow.texts.map((t) => t.text), ['done · 1', 'ready now · 1', '1 step · 1', 'no dependency either way · 2 cards']);
});

test('the plan of a layout of the Hierarchy has no mark of the flow, and a flow layout with no kind given is read as the flow', () => {
  const m = model();
  for (const kind of GRAPH_LAYOUTS) {
    const plan = graphPlan(m, graphLayout(m, kind, { statuses: ['todo', 'doing', 'done'] }), { kind, statusClass: (s) => s });
    assert.deepStrictEqual(plan.flow, { rects: [], texts: [], heads: [] }, kind);
  }
  const layout = graphLayout(m, 'flow', { deps: 'all' });
  const plan = graphPlan(m, layout, { statusClass: (s) => s });
  assert.deepStrictEqual(plan.links.map((l) => l.kind), ['wait', 'wait']);
  assert.ok(plan.flow.texts.length > 0);
});

test('a dependency that is not drawn, or a card that is hidden, leaves the flow with the cards that are', () => {
  const m = graphBuild(cards(), { ctx: CTX, types: TYPES, visibleIds: new Set(['2', '3', '4']) });
  const { layout, plan } = planOf(m);
  assert.deepStrictEqual(plan.nodes.map((n) => n.id).sort(), ['2', '3', '4']);
  assert.deepStrictEqual(layout.flow.columns.map((c) => c.label), ['ready now', '1 step']);
  assert.deepStrictEqual(layout.flow.strip.ids, ['4']);
});

test('the hierarchy radius is not the flow radius: a parent does not enlarge a flow dot', () => {
  const m = model();
  const layout = graphLayout(m, 'flow', { deps: 'frontier' });
  const parent = m.byId.get('9');
  assert.ok(graphRadius(parent) > layout.flow.radius.get('9'));
});

test('a card lights with the cards its dependencies join to it in the flow, and with its parent and children in the Hierarchy', () => {
  const m = model();
  assert.deepStrictEqual([...graphNeighbours(m, '2')].sort(), ['1', '2', '3', '9']);
  assert.deepStrictEqual([...graphNeighbours(m, '2', 'wait')].sort(), ['1', '2', '3']);
  assert.deepStrictEqual([...graphNeighbours(m, '9', 'wait')], ['9']);
  const lines = planOf(m).plan.links;
  const rest = (linkKind) => graphRestLit(m, { selectedIds: new Set(['2']), loneCardId: '2', linkKind }, lines);
  assert.deepStrictEqual([...rest('wait').nodes].sort(), ['1', '2', '3']);
  assert.deepStrictEqual([...rest('wait').links].sort(), [0, 1]);
  const many = graphRestLit(m, { selectedIds: new Set(['1', '3']), loneCardId: null, linkKind: 'wait' }, lines);
  assert.deepStrictEqual([...many.nodes].sort(), ['1', '3']);
  assert.strictEqual(many.links.size, 0);
});

// --- the lanes -------------------------------------------------------------------------------

const LANE_TYPES = [{ name: 'goal', icon: 'diamond', color: '#a33' }, { name: 'strategy' }];
const laneCards = () => [
  card(1, { type: 'goal', title: 'Ship it' }), card(2, { parent: 1 }), card(3, { parent: 1, waiting_for: ['2'] }),
  card(4, { type: 'strategy', title: 'Plan' }), card(5, { parent: 4, status: 'doing' }), card(6, { parent: 4, waiting_for: ['5'] }),
];
const laneModel = () => graphBuild(laneCards(), { ctx: CTX, types: LANE_TYPES, hierarchy: ['goal', 'strategy'] });
const lanePlan = (m, lanes = true, deps = 'frontier') => {
  const layout = graphLayout(m, 'flow', { deps, lanes });
  return { layout, plan: graphPlan(m, layout, { kind: 'flow', statusClass: (s) => s, titleOf: (c) => c.title, types: LANE_TYPES }) };
};

test('the Lanes switch is part of the layout\'s signature and its cache, and only for the Flow', () => {
  graphLayoutCacheClear();
  const m = laneModel();
  const flat = graphLayout(m, 'flow', { deps: 'frontier' });
  const laned = graphLayout(m, 'flow', { deps: 'frontier', lanes: true });
  assert.notStrictEqual(laned, flat);
  assert.strictEqual(graphLayout(m, 'flow', { deps: 'frontier', lanes: true }), laned);
  assert.strictEqual(graphLayout(m, 'flow', { deps: 'frontier', lanes: false }), flat, 'off is the default');
  assert.deepStrictEqual(laned.flow.lanes.map((l) => l.key), ['1', '4']);
  assert.notStrictEqual(graphSignature(m, 'flow', { lanes: true }), graphSignature(m, 'flow', {}));
  assert.strictEqual(graphSignature(m, 'tiers', { lanes: true }), graphSignature(m, 'tiers', {}), 'the Hierarchy does not read the switch');
});

test('a card moved to another tier moves its lane, since the signature holds the slices of the cards in lanes', () => {
  const was = graphSignature(laneModel(), 'flow', { lanes: true });
  const next = laneCards();
  next[3] = { ...next[3], type: 'task' };
  const m = graphBuild(next, { ctx: CTX, types: LANE_TYPES, hierarchy: ['goal', 'strategy'] });
  assert.notStrictEqual(graphSignature(m, 'flow', { lanes: true }), was);
});

test('the plan carries a header for each lane: the lane card\'s tier, #id title and counts, its tip, and its type\'s mark in the type\'s colour', () => {
  const { layout, plan } = lanePlan(laneModel());
  assert.deepStrictEqual(plan.flow.heads.map((h) => h.id), ['1', '4']);
  const [goal, strategy] = plan.flow.heads;
  assert.strictEqual(goal.text, 'goal \u00b7 #1 Ship it \u00b7 2 cards \u00b7 1 ready');
  assert.strictEqual(strategy.text, 'strategy \u00b7 #4 Plan \u00b7 2 cards \u00b7 1 ready');
  assert.strictEqual(goal.title, '#1 Ship it (todo)');
  assert.strictEqual(strategy.title, '#4 Plan (todo)');
  assert.ok(goal.icon && /^M/.test(goal.icon.d) && goal.icon.color === '#a33');
  assert.strictEqual(strategy.icon, null, 'a type with no icon has no mark');
  assert.deepStrictEqual([goal.x, goal.y], [layout.flow.lanes[0].x + 10, layout.flow.lanes[0].y + 19]);
  assert.deepStrictEqual(plan.flow.rects.filter((r) => r.cls === 'graph-flow-lane').length, 2);
});

test('the lanes draw the same dots and arrows as the flat Flow, and the lane card\'s header is not a dot', () => {
  const m = laneModel();
  const flat = lanePlan(m, false).plan;
  const laned = lanePlan(m, true).plan;
  assert.deepStrictEqual(laned.nodes.map((n) => n.id), flat.nodes.map((n) => n.id));
  assert.deepStrictEqual(laned.links.map((l) => [l.from, l.to]), flat.links.map((l) => [l.from, l.to]));
  assert.deepStrictEqual(flat.flow.heads, []);
});
