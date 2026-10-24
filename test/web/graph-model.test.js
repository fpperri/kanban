const { test } = require('node:test');
const assert = require('node:assert');
const {
  GRAPH_KINDS, mergeGraphLayout,
  graphBuild, graphRadius, graphNeighbours,
  graphLayoutHierarchy,
  graphLayout, graphSignature, graphLayoutCacheClear, graphFit,
  graphVisibleIds, graphZoomAt, graphPlan,
  graphLinkPaths,
} = require('../web/graph-model');
const { sliceCards, sliceDepths } = require('../web/slices');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra = {}) => ({
  id: String(id), title: `card ${id}`, status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, ...extra,
});
const build = (cards, visibleIds = null) => graphBuild(cards, { ctx: CTX, visibleIds });
const plain = (layout) => JSON.parse(JSON.stringify({ ...layout, pos: [...layout.pos] }));
const finite = (layout) => [...layout.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  && Object.values(layout.bounds).every(Number.isFinite);
const ang = (p) => Math.atan2(p.y, p.x);

// --- build -----------------------------------------------------------------------

test('build: parent links run parent to child, wait links run waited-for to waiter (the head sits on the card that waits)', () => {
  const m = build([card(1), card(2, { parent: 1 }), card(3, { waiting_for: ['2'] })]);
  assert.deepStrictEqual(m.links, [
    { from: '1', to: '2', kind: 'parent' },
    { from: '2', to: '3', kind: 'wait' },
  ]);
  const n1 = m.byId.get('1');
  assert.strictEqual(n1.kids, 1);
  assert.strictEqual(n1.deg, 1);
  assert.strictEqual(m.byId.get('2').deg, 2);
  assert.strictEqual(m.byId.get('2').parentId, '1');
  assert.strictEqual(m.byId.get('2').depth, 1);
  assert.strictEqual(m.byId.get('2').rootId, '1');
});

test('build: an archived parent that is not drawn makes the child a root', () => {
  const pool = [card(1, { archived: true, status: 'done' }), card(2, { parent: 1 })];
  const m = build(pool, new Set(['2']));
  assert.strictEqual(m.links.length, 0);
  assert.strictEqual(m.byId.get('2').parentId, null);
  assert.strictEqual(m.byId.get('2').rootId, '2');
  assert.strictEqual(m.byId.get('2').depth, 0);
});

test('build: a parent on another board leaves the card a root', () => {
  const m = build([card(2, { parent: 'other#1' }), card(1)]);
  assert.strictEqual(m.links.length, 0);
  assert.strictEqual(m.byId.get('2').parentId, null);
  const own = build([card(1), card(2, { parent: 'kanban#1' })]);
  assert.strictEqual(own.byId.get('2').parentId, '1');
});

test('build: a parent cycle loses the smallest id parent link', () => {
  const m = build([card(3, { parent: 2 }), card(2, { parent: 1 }), card(1, { parent: 3 }), card(9, { parent: 9 })]);
  assert.strictEqual(m.byId.get('1').parentId, null);
  assert.strictEqual(m.byId.get('2').parentId, '1');
  assert.strictEqual(m.byId.get('3').parentId, '2');
  assert.strictEqual(m.byId.get('9').parentId, null);
  assert.strictEqual(m.nodes.length, 4);
  assert.deepStrictEqual(m.nodes.filter((n) => n.rootId === '1').map((n) => n.id), ['1', '2', '3']);
});

test('build: dangling, self and duplicate waits are dropped', () => {
  const m = build([card(1, { waiting_for: ['1', '99', '2', '2'] }), card(2)]);
  assert.deepStrictEqual(m.links, [{ from: '2', to: '1', kind: 'wait' }]);
});

test('build: a card waiting on a hidden card still reads waiting; done waits do not', () => {
  const pool = [card(1, { waiting_for: ['2'] }), card(2), card(3, { waiting_for: ['4'] }), card(4, { status: 'done' })];
  const m = build(pool, new Set(['1', '3']));
  assert.strictEqual(m.byId.get('1').waiting, true);
  assert.strictEqual(m.byId.get('3').waiting, false);
  assert.strictEqual(m.links.length, 0);
});

test('build: blocked and review flags follow the sticker values', () => {
  const m = build([card(1, { blocked: 'no reply' }), card(2, { review: true }), card(3, { blocked: false, review: 'false' })]);
  assert.strictEqual(m.byId.get('1').blocked, true);
  assert.strictEqual(m.byId.get('1').review, false);
  assert.strictEqual(m.byId.get('2').review, true);
  assert.strictEqual(m.byId.get('3').blocked, false);
  assert.strictEqual(m.byId.get('3').review, false);
});

test('build: nodes come in outline order, parents before children, siblings by rank', () => {
  const m = build([
    card(5), card(4, { parent: 1, rank: 2 }), card(3, { parent: 1, rank: 1 }), card(2, { parent: 3 }), card(1),
  ]);
  assert.deepStrictEqual(m.nodes.map((n) => n.id), ['1', '3', '2', '4', '5']);
});

test('build: visibleIds null draws every card; empty pool is fine', () => {
  assert.strictEqual(build([card(1), card(2)]).nodes.length, 2);
  const e = build([]);
  assert.deepStrictEqual([e.nodes, e.links], [[], []]);
});

test('radius grows with degree and with having kids', () => {
  assert.strictEqual(graphRadius({ deg: 0, kids: 0 }), 4);
  assert.strictEqual(graphRadius({ deg: 2, kids: 1 }), 4 + Math.sqrt(4) * 3);
});

// --- tiers -----------------------------------------------------------------------

const treeCards = () => [
  card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 2 }), card(5, { parent: 2 }),
  card(6), card(7, { parent: 6 }), card(8), card(9),
];
const trees = () => build(treeCards());

test('tiers: each depth sits on its own ring, a band of 56 further out than the last, the first at 88', () => {
  const m = trees();
  const l = graphLayoutHierarchy(m);
  for (const n of m.nodes.filter((x) => x.parentId !== null || x.kids)) {
    const p = l.pos.get(n.id);
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - (88 + 56 * n.depth)) < 1e-6, `card ${n.id}`);
  }
  assert.deepStrictEqual(l.rings.map((r) => [r.r, r.label]), [
    [88, 'depth 0'], [144, 'depth 1'], [200, 'depth 2'], [256, 'unnested'],
  ], 'and the cards with no relative, by default, on one ring a band further out');
});

test('tiers: over this fixture, unfiltered, the depths the slice module gives are the rings the layout draws', () => {
  const cards = treeCards();
  const slices = sliceCards(cards, [], sliceDepths(cards, [], CTX));
  const m = build(cards);
  const l = graphLayoutHierarchy(m);
  const ringFor = (depth) => l.rings.find((r) => r.label === `depth ${depth}`);
  for (const n of m.nodes) {
    const slice = slices.byId.get(n.id);
    assert.strictEqual(slice.kind, 'depth', `card ${n.id}`);
    assert.strictEqual(slice.depth, n.depth, `card ${n.id}`);
    if (n.parentId === null && !n.kids) continue;
    const p = l.pos.get(n.id);
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - ringFor(slice.depth).r) < 1e-6, `card ${n.id} sits on the ring of its slice`);
  }
  assert.deepStrictEqual(slices.axis.map((s) => [s.depth, s.count]), [[0, 4], [1, 3], [2, 2]]);
  assert.deepStrictEqual(l.rings.slice(0, slices.axis.length).map((r) => r.label), ['depth 0', 'depth 1', 'depth 2']);
});

test('tiers: children sit inside the sector of their root, and a parent sits between its children', () => {
  const m = trees();
  const l = graphLayoutHierarchy(m);
  const a = (id) => {
    const turn = ang(l.pos.get(id));
    return turn < l.fan.to - 1e-9 ? turn + 2 * Math.PI : turn;
  };
  const [first, second] = l.sectors;
  assert.deepStrictEqual([first.rootId, first.leaves, second.rootId, second.leaves], ['1', 3, '6', 1]);
  for (const id of ['1', '2', '3', '4', '5']) assert.ok(a(id) <= first.from + 1e-9 && a(id) >= first.to - 1e-9, `card ${id} outside sector of 1`);
  for (const id of ['6', '7']) assert.ok(a(id) <= second.from + 1e-9 && a(id) >= second.to - 1e-9, `card ${id} outside sector of 6`);
  assert.ok(a('4') > a('2') && a('2') > a('5') && a('5') > a('3'), 'the children of 2 are left of 3, and 2 is between its own');
  assert.ok(a('2') > a('1') && a('1') > a('3'), 'and 1 is between its children 2 and 3');
});

test('tiers: unnested cards go to the Unnested block outside the rings, in a column for their status, when the option is the table', () => {
  const m = trees();
  const l = graphLayoutHierarchy(m, { unnested: 'table' });
  const outer = 88 + 56 * 2 + 28;
  assert.strictEqual(l.bands[l.bands.length - 1].r1, outer);
  for (const id of ['8', '9']) assert.ok(Math.hypot(l.pos.get(id).x, l.pos.get(id).y) > outer + 20, `card ${id}`);
  assert.deepStrictEqual(l.block.columns.map((c) => [c.label, c.ids]), [['todo', ['8', '9']]]);
});

test('tiers: deterministic, finite, and safe on 0 and 1 node', () => {
  const m = trees();
  assert.deepStrictEqual(plain(graphLayoutHierarchy(m)), plain(graphLayoutHierarchy(m)));
  assert.ok(finite(graphLayoutHierarchy(m)));
  assert.ok(finite(graphLayoutHierarchy(build([]))));
  assert.ok(finite(graphLayoutHierarchy(build([card(1)]))));
});

test('tiers: bounds contain every node including its radius', () => {
  const m = trees();
  const l = graphLayoutHierarchy(m);
  for (const n of m.nodes) {
    const p = l.pos.get(n.id);
    const r = graphRadius(n);
    assert.ok(p.x - r >= l.bounds.x0 && p.x + r <= l.bounds.x1 && p.y - r >= l.bounds.y0 && p.y + r <= l.bounds.y1);
  }
});

// --- fit -------------------------------------------------------------------------

test('fit: centres the bounds and caps the scale', () => {
  const f = graphFit({ x0: -100, y0: -50, x1: 100, y1: 50 }, 800, 600);
  assert.strictEqual(f.k, Math.min(680 / 200, 480 / 100, 2.5));
  assert.ok(Math.abs(0 * f.k + f.x - 400) < 1e-9 && Math.abs(0 * f.k + f.y - 300) < 1e-9);
  const tiny = graphFit({ x0: 0, y0: 0, x1: 10, y1: 10 }, 800, 600);
  assert.strictEqual(tiny.k, 2.5);
  assert.ok(Math.abs(5 * tiny.k + tiny.x - 400) < 1e-9);
});

test('fit: degenerate bounds and tiny viewports stay finite and positive', () => {
  for (const f of [
    graphFit({ x0: 3, y0: 3, x1: 3, y1: 3 }, 800, 600),
    graphFit({ x0: 0, y0: 0, x1: 100, y1: 100 }, 50, 50),
    graphFit({ x0: 0, y0: 0, x1: 100, y1: 100 }, 0, 0),
  ]) {
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y) && f.k > 0);
  }
  assert.strictEqual(graphFit({ x0: 0, y0: 0, x1: 10, y1: 10 }, 800, 600, 60, 1).k, 1);
});

// --- neighbours ------------------------------------------------------------------

test('neighbours: the id plus everything it shares a link with', () => {
  const m = build([card(1), card(2, { parent: 1 }), card(3, { waiting_for: ['1'] }), card(4)]);
  assert.deepStrictEqual([...graphNeighbours(m, '1')].sort(), ['1', '2', '3']);
  assert.deepStrictEqual([...graphNeighbours(m, '4')], ['4']);
  assert.deepStrictEqual([...graphNeighbours(m, '99')], ['99']);
});

// --- layout names ----------------------------------------------------------------

test('mergeGraphLayout: the Graph draws the Hierarchy or the Flow; anything else, tiers and a layout once offered included, is the Hierarchy', () => {
  assert.deepStrictEqual(GRAPH_KINDS, ['hierarchy', 'flow']);
  for (const k of GRAPH_KINDS) assert.strictEqual(mergeGraphLayout(k), k);
  for (const bad of [undefined, null, '', 'tiers', 'Flow', 'radial', 7, {}, 'force', 'status']) assert.strictEqual(mergeGraphLayout(bad), 'hierarchy');
});

// --- cache -----------------------------------------------------------------------

test('cache: an identical signature returns the identical layout; blocked/review do not change it', () => {
  graphLayoutCacheClear();
  const a = build([card(1), card(2, { parent: 1 })]);
  const b = build([card(1, { blocked: 'x', review: true }), card(2, { parent: 1 })]);
  assert.strictEqual(graphSignature(a, 'hierarchy'), graphSignature(b, 'hierarchy'));
  const la = graphLayout(a, 'hierarchy');
  assert.strictEqual(graphLayout(b, 'hierarchy'), la);
  assert.notStrictEqual(graphLayout(a, 'flow'), la);
});

test('cache: a status change or a different statuses list changes the signature', () => {
  const a = build([card(1, { status: 'todo' })]);
  const b = build([card(1, { status: 'doing' })]);
  assert.notStrictEqual(graphSignature(a, 'hierarchy'), graphSignature(b, 'hierarchy'));
  assert.notStrictEqual(graphSignature(a, 'hierarchy', { statuses: ['a', 'b'] }), graphSignature(a, 'hierarchy', { statuses: ['b', 'a'] }));
});

test('cache: holds at most 8 entries, evicting the oldest', () => {
  graphLayoutCacheClear();
  const first = build([card(100)]);
  const lf = graphLayout(first, 'hierarchy');
  for (let i = 0; i < 8; i++) graphLayout(build([card(i + 1)]), 'hierarchy');
  assert.notStrictEqual(graphLayout(first, 'hierarchy'), lf);
});

test('layout dispatcher: unknown kind falls back to tiers', () => {
  graphLayoutCacheClear();
  const m = trees();
  assert.deepStrictEqual(plain(graphLayout(m, 'nope')), plain(graphLayoutHierarchy(m)));
});

// --- plan ------------------------------------------------------------------------

const planOpts = (extra = {}) => ({ statusClass: (s) => s, titleOf: (c) => c.title, ...extra });
const sampleCards = () => [
  card(1, { status: 'doing' }),
  card(2, { parent: 1, status: 'done' }),
  card(3, { parent: 1, blocked: true }),
  card(4, { parent: 1, waiting_for: ['2', '3'], review: true }),
  card(5, { waiting_for: ['9'] }),
  card(6, { archived: true, status: 'done' }),
];

test('plan: node classes, order and title', () => {
  const m = build(sampleCards());
  const plan = graphPlan(m, graphLayout(m, 'hierarchy'), planOpts({ selectedIds: new Set(['3']), hoveredId: '2' }));
  assert.deepStrictEqual(plan.nodes.map((n) => n.id), m.nodes.map((n) => n.id));
  const by = (id) => plan.nodes.find((n) => n.id === id);
  assert.match(by('1').cls, /^graph-node card-el status-doing/);
  assert.ok(by('1').cls.includes('has-kids'));
  assert.ok(by('1').cls.includes('graph-hub'));
  assert.ok(by('2').cls.includes('is-done') && by('2').cls.includes('hover-highlight'));
  assert.ok(by('3').cls.includes('selected') && by('3').cls.includes('is-blocked'));
  assert.ok(by('4').cls.includes('is-waiting') && by('4').cls.includes('is-review'));
  assert.ok(by('6').cls.includes('archived'));
  assert.strictEqual(by('6').title, '#6 card 6 (done, archived)');
  assert.strictEqual(by('3').title, '#3 card 3 (todo)');
  assert.ok(!by('5').cls.includes('graph-hub'));
});

test('plan: the default status class cannot smuggle a second class', () => {
  const m = build([card(1, { status: 'a hidden' })]);
  const plan = graphPlan(m, graphLayout(m, 'hierarchy'), { titleOf: (c) => c.title });
  assert.ok(!plan.nodes[0].cls.split(' ').includes('hidden'));
  assert.ok(plan.nodes[0].cls.includes('status-a-hidden'));
});

test('plan: parent links curve in tiers; waits end at the rim', () => {
  const m = build(sampleCards());
  const curved = graphPlan(m, graphLayout(m, 'hierarchy'), planOpts());
  const parent = curved.links.find((l) => l.kind === 'parent');
  assert.match(parent.d, /^M[-\d.]+ [-\d.]+Q/);
  assert.strictEqual(parent.arrow, false);
  const lay = graphLayout(m, 'hierarchy');
  const plan = graphPlan(m, lay, planOpts());
  const wait = plan.links.find((l) => l.kind === 'wait' && l.from === '2' && l.to === '4');
  assert.strictEqual(wait.arrow, true);
  assert.match(wait.cls, /graph-link-wait/);
  const [ex, ey] = wait.d.split('L')[1].split(' ').map(Number);
  const t = lay.pos.get('4');
  assert.ok(Math.abs(Math.hypot(ex - t.x, ey - t.y) - (graphRadius(m.byId.get('4')) + 2)) < 0.05);
});

test('plan: guides and dividers come from the layout; output is finite and deterministic', () => {
  const m = build(sampleCards());
  for (const kind of ['hierarchy']) {
    const lay = graphLayout(m, kind, { statuses: ['backlog', 'todo', 'doing', 'done'] });
    const a = graphPlan(m, lay, planOpts());
    const b = graphPlan(m, lay, planOpts());
    assert.deepStrictEqual(a, b);
    const nums = JSON.stringify(a).match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);
    assert.ok(nums.every(Number.isFinite));
    // The tier fan draws its bands as guide arcs and its sectors' spokes as dividers.
    assert.strictEqual(a.guides.length, lay.rings.length);
    assert.strictEqual(a.dividers.length, lay.spokes.length);
    assert.ok(!JSON.stringify(a).includes('NaN'));
  }
  assert.strictEqual(graphPlan(m, graphLayout(m, 'hierarchy'), planOpts()).dividers.length, 0, 'one tree needs no sector dividers');
  const two = build([card(1), card(2, { parent: 1 }), card(3), card(4, { parent: 3 })]);
  assert.strictEqual(graphPlan(two, graphLayout(two, 'hierarchy'), planOpts()).dividers.length, 1, 'two trees get a divider between them');
  const empty = build([]);
  const e = graphPlan(empty, graphLayout(empty, 'hierarchy'), planOpts());
  assert.deepStrictEqual(e.nodes, []);
});

test('visibleIds: filter composes with search by intersection, null when nothing narrows', () => {
  const pool = [card(1), card(2, { status: 'done' }), card(3, { archived: true })];
  const statuses = ['todo', 'done'];
  const filter = { todo: true, done: true, archive: false };
  assert.deepStrictEqual([...graphVisibleIds(pool, null, filter, statuses)].sort(), ['1', '2']);
  assert.deepStrictEqual([...graphVisibleIds(pool, new Set(['2', '3']), filter, statuses)], ['2']);
  assert.strictEqual(graphVisibleIds(pool, null, { todo: true, done: true, archive: true }, statuses), null);
  assert.deepStrictEqual([...graphVisibleIds(pool, new Set(['3']), { todo: true, done: true, archive: true }, statuses)], ['3']);
});

test('zoomAt: the world point under the pointer stays put and k clamps', () => {
  const v = { x: 40, y: -10, k: 1.5 };
  const z = graphZoomAt(v, 300, 200, 1.4);
  assert.ok(Math.abs((300 - z.x) / z.k - (300 - v.x) / v.k) < 1e-9);
  assert.ok(Math.abs((200 - z.y) / z.k - (200 - v.y) / v.k) < 1e-9);
  assert.strictEqual(graphZoomAt(v, 0, 0, 100).k, 8);
  assert.strictEqual(graphZoomAt(v, 0, 0, 0.0001).k, 0.1);
  assert.strictEqual(graphZoomAt(v, 0, 0, 1).k, 1.5);
  assert.deepStrictEqual(graphZoomAt(v, 5, 5, 3, 0.5, 2).k, 2);
});

test('tiers: one root with 150 children keeps neighbours on the ring apart', () => {
  const cards = [card(1)];
  for (let i = 2; i <= 151; i++) cards.push(card(i, { parent: 1 }));
  const m = build(cards);
  const l = graphLayoutHierarchy(m);
  assert.ok(finite(l));
  const kids = m.nodes.filter((n) => n.parentId === '1').map((n) => l.pos.get(n.id));
  kids.sort((p, q) => ang(p) - ang(q));
  for (let i = 0; i < kids.length; i++) {
    const a = kids[i];
    const b = kids[(i + 1) % kids.length];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 14, `gap ${i}`);
  }
});

test('tiers: a 6000-deep parent chain lays out without recursing', () => {
  const cards = [card(1)];
  for (let i = 2; i <= 6000; i++) cards.push(card(i, { parent: i - 1 }));
  const m = build(cards);
  const l = graphLayoutHierarchy(m);
  assert.strictEqual(l.pos.size, 6000);
  assert.ok(finite(l));
});

test('graphLinkPaths matches the d strings graphPlan emits, in every layout', () => {
  const m = build([card(1), card(2, { parent: 1 }), card(3, { parent: 1, waiting_for: ['2'] }), card(4, { status: 'done', archived: true, waiting_for: ['1'] })]);
  for (const kind of ['hierarchy']) {
    const layout = graphLayout(m, kind, { statuses: ['todo', 'done'] });
    const plan = graphPlan(m, layout, { kind });
    assert.deepStrictEqual(graphLinkPaths(m, layout), plan.links.map((l) => l.d), kind);
    assert.strictEqual(graphLinkPaths(m, layout).length, m.links.length);
  }
});

// --- type icons ------------------------------------------------------------------

const ICON_TYPES = [
  { name: 'goal', color: '', icon: 'star' },
  { name: 'epic', color: '', icon: 'square' },
  { name: 'story', color: '', icon: 'circle' },
  { name: 'bug', color: '', icon: 'blob' },
  { name: 'task', color: '' },
];
const buildTyped = (cards, types = ICON_TYPES) => graphBuild(cards, { ctx: CTX, types });
const planOf = (m) => graphPlan(m, graphLayout(m, 'hierarchy'), planOpts());
const cornerPoints = (d) => [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((p) => Math.hypot(Number(p[1]), Number(p[2])));
const SHAPES = ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star'];

test('build: a node whose type has an icon carries that shape', () => {
  const m = buildTyped([card(1, { type: 'goal' }), card(2, { type: 'epic' }), card(3, { type: 'Goal ' })]);
  assert.strictEqual(m.byId.get('1').shape, 'star');
  assert.strictEqual(m.byId.get('2').shape, 'square');
  assert.strictEqual(m.byId.get('3').shape, 'star', 'the type matches without regard to case or space, as the chip does');
});

test('build: a node with no icon, an unknown icon, no type or an unlisted type gets the circle', () => {
  const m = buildTyped([
    card(1, { type: 'task' }), card(2, { type: 'bug' }), card(3), card(4, { type: 'spike' }), card(5, { type: 'story' }), card(6, { type: '' }),
  ]);
  for (const id of ['1', '2', '3', '4', '5', '6']) assert.strictEqual(m.byId.get(id).shape, 'circle', `card ${id}`);
});

test('build: an icon name that is hostile text, not one of the six, gives the circle', () => {
  const types = ['__proto__', 'constructor', 'toString', 'Star', '<script>', 'star"><x', 7, ['star']].map((icon, i) => ({ name: `t${i}`, color: '', icon }));
  const m = buildTyped(types.map((t, i) => card(i + 1, { type: t.name })), types);
  for (const n of m.nodes) assert.strictEqual(n.shape, 'circle', n.card.type);
});

test('build: with no types list at all (an old server, no config) every node is a circle', () => {
  const m = graphBuild([card(1, { type: 'goal' })], { ctx: CTX });
  assert.strictEqual(m.byId.get('1').shape, 'circle');
  assert.strictEqual(graphBuild([card(1, { type: 'goal' })], { ctx: CTX, types: null }).byId.get('1').shape, 'circle');
});

test('plan: a node of a type with an icon is drawn in that outline, and a circle node has none', () => {
  const m = buildTyped([card(1, { type: 'goal' }), card(2, { type: 'epic' }), card(3, { type: 'bug' }), card(4, { type: 'story' }), card(5)]);
  const by = (id) => planOf(m).nodes.find((n) => n.id === id);
  assert.strictEqual(by('1').shape, 'star');
  assert.match(by('1').d, /^M.*Z$/);
  assert.strictEqual(cornerPoints(by('1').d).length, 10, 'a star has ten corners');
  assert.strictEqual(cornerPoints(by('2').d).length, 4, 'a square has four');
  for (const id of ['3', '4', '5']) {
    assert.strictEqual(by(id).shape, 'circle', `card ${id}`);
    assert.strictEqual(by(id).d, '', `card ${id} draws the round dot`);
  }
});

test('plan: the outline is drawn for the node radius, so it grows with the degree', () => {
  const m = buildTyped([card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { type: 'goal' })]);
  const plan = planOf(m);
  const hub = plan.nodes.find((n) => n.id === '1');
  const loose = plan.nodes.find((n) => n.id === '4');
  assert.ok(hub.r > loose.r);
  assert.ok(Math.max(...cornerPoints(hub.d)) > Math.max(...cornerPoints(loose.d)));
  assert.ok(Math.abs(Math.max(...cornerPoints(loose.d)) - loose.r * 1.4) < 0.02, 'a star reaches 1.4 times the dot radius');
});

test('plan: the child ring and the flag ring clear every shape, the star included', () => {
  for (const shape of SHAPES) {
    const types = [{ name: 't', color: '', icon: shape }];
    const kids = buildTyped([card(1, { type: 't', blocked: true }), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 1 })], types);
    const withKids = planOf(kids).nodes.find((n) => n.id === '1');
    const farthest = shape === 'circle' ? withKids.r : Math.max(...cornerPoints(withKids.d));
    assert.ok(withKids.kidsRing > farthest + 2, `${shape}: the child ring ${withKids.kidsRing} clears a corner at ${farthest}`);
    assert.ok(withKids.flagRing > withKids.kidsRing + 2, `${shape}: the flag ring sits outside the child ring`);

    const flagged = buildTyped([card(1, { type: 't', review: true })], types);
    const alone = planOf(flagged).nodes[0];
    const reach = shape === 'circle' ? alone.r : Math.max(...cornerPoints(alone.d));
    assert.ok(alone.flagRing > reach + 2, `${shape}: the flag ring ${alone.flagRing} clears a corner at ${reach}`);
  }
});

test('plan: a node with no icon keeps the rings and label it had, 3 and 6 beyond its radius', () => {
  const m = buildTyped([card(1, { blocked: true }), card(2, { parent: 1 }), card(3, { review: true })]);
  const plan = planOf(m);
  const parent = plan.nodes.find((n) => n.id === '1');
  assert.strictEqual(parent.kidsRing, parent.r + 3);
  assert.strictEqual(parent.flagRing, parent.r + 6);
  assert.strictEqual(parent.reach, parent.r);
  const single = plan.nodes.find((n) => n.id === '3');
  assert.strictEqual(single.flagRing, single.r + 3);
});

test('plan: the id label starts beyond the shape, not inside it', () => {
  const m = buildTyped([card(1, { type: 'goal' }), card(2, { type: 'task' })]);
  const plan = planOf(m);
  assert.ok(plan.nodes.find((n) => n.id === '1').reach > plan.nodes.find((n) => n.id === '1').r);
  assert.strictEqual(plan.nodes.find((n) => n.id === '2').reach, plan.nodes.find((n) => n.id === '2').r);
});

test('plan: a type with an icon changes no position, whatever layout draws it', () => {
  const cards = [card(1, { type: 'goal' }), card(2, { parent: 1, type: 'epic' }), card(3, { parent: 1 })];
  for (const kind of ['hierarchy']) {
    const typed = graphPlan(buildTyped(cards), graphLayout(buildTyped(cards), kind), planOpts({ kind }));
    const bare = graphPlan(build(cards), graphLayout(build(cards), kind), planOpts({ kind }));
    assert.deepStrictEqual(typed.nodes.map((n) => [n.id, n.x, n.y, n.r]), bare.nodes.map((n) => [n.id, n.x, n.y, n.r]), kind);
    assert.deepStrictEqual(typed.links, bare.links, kind);
  }
});

test('plan: no class, title or attribute the plan emits carries the icon name', () => {
  const m = buildTyped([card(1, { type: 'goal' })], [{ name: 'goal', color: '', icon: 'star' }]);
  const node = planOf(m).nodes[0];
  assert.ok(!/star/.test(node.cls));
  assert.ok(!/star/.test(node.title));
  assert.ok(!/star/.test(node.d));
});
