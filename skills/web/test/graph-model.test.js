const { test } = require('node:test');
const assert = require('node:assert');
const {
  GRAPH_LAYOUTS, mergeGraphLayout,
  graphBuild, graphRadius, graphNeighbours,
  graphLayoutTiers, graphLayoutStatus, graphLayoutForce,
  graphLayout, graphSignature, graphLayoutCacheClear, graphFit,
  graphVisibleIds, graphZoomAt, graphPlan,
} = require('../web/graph-model');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra = {}) => ({
  id, title: `card ${id}`, status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, ...extra,
});
const build = (cards, visibleIds = null) => graphBuild(cards, { ctx: CTX, visibleIds });
const plain = (layout) => JSON.parse(JSON.stringify({ ...layout, pos: [...layout.pos] }));
const finite = (layout) => [...layout.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  && Object.values(layout.bounds).every(Number.isFinite);
const ang = (p) => Math.atan2(p.y, p.x);

// --- build -----------------------------------------------------------------------

test('build: parent links run parent to child, wait links run waiter to waited', () => {
  const m = build([card(1), card(2, { parent: 1 }), card(3, { waiting_for: [2] })]);
  assert.deepStrictEqual(m.links, [
    { from: 1, to: 2, kind: 'parent' },
    { from: 3, to: 2, kind: 'wait' },
  ]);
  const n1 = m.byId.get(1);
  assert.strictEqual(n1.kids, 1);
  assert.strictEqual(n1.deg, 1);
  assert.strictEqual(m.byId.get(2).deg, 2);
  assert.strictEqual(m.byId.get(2).parentId, 1);
  assert.strictEqual(m.byId.get(2).depth, 1);
  assert.strictEqual(m.byId.get(2).rootId, 1);
});

test('build: an archived parent that is not drawn makes the child a root', () => {
  const pool = [card(1, { archived: true, status: 'done' }), card(2, { parent: 1 })];
  const m = build(pool, new Set([2]));
  assert.strictEqual(m.links.length, 0);
  assert.strictEqual(m.byId.get(2).parentId, null);
  assert.strictEqual(m.byId.get(2).rootId, 2);
  assert.strictEqual(m.byId.get(2).depth, 0);
});

test('build: a parent on another board leaves the card a root', () => {
  const m = build([card(2, { parent: 'other#1' }), card(1)]);
  assert.strictEqual(m.links.length, 0);
  assert.strictEqual(m.byId.get(2).parentId, null);
  const own = build([card(1), card(2, { parent: 'kanban#1' })]);
  assert.strictEqual(own.byId.get(2).parentId, 1);
});

test('build: a parent cycle loses the smallest id parent link', () => {
  const m = build([card(3, { parent: 2 }), card(2, { parent: 1 }), card(1, { parent: 3 }), card(9, { parent: 9 })]);
  assert.strictEqual(m.byId.get(1).parentId, null);
  assert.strictEqual(m.byId.get(2).parentId, 1);
  assert.strictEqual(m.byId.get(3).parentId, 2);
  assert.strictEqual(m.byId.get(9).parentId, null);
  assert.strictEqual(m.nodes.length, 4);
  assert.deepStrictEqual(m.nodes.filter((n) => n.rootId === 1).map((n) => n.id), [1, 2, 3]);
});

test('build: dangling, self and duplicate waits are dropped', () => {
  const m = build([card(1, { waiting_for: [1, 99, 2, 2] }), card(2)]);
  assert.deepStrictEqual(m.links, [{ from: 1, to: 2, kind: 'wait' }]);
});

test('build: a card waiting on a hidden card still reads waiting; done waits do not', () => {
  const pool = [card(1, { waiting_for: [2] }), card(2), card(3, { waiting_for: [4] }), card(4, { status: 'done' })];
  const m = build(pool, new Set([1, 3]));
  assert.strictEqual(m.byId.get(1).waiting, true);
  assert.strictEqual(m.byId.get(3).waiting, false);
  assert.strictEqual(m.links.length, 0);
});

test('build: blocked and review flags follow the sticker values', () => {
  const m = build([card(1, { blocked: 'no reply' }), card(2, { review: true }), card(3, { blocked: false, review: 'false' })]);
  assert.strictEqual(m.byId.get(1).blocked, true);
  assert.strictEqual(m.byId.get(1).review, false);
  assert.strictEqual(m.byId.get(2).review, true);
  assert.strictEqual(m.byId.get(3).blocked, false);
  assert.strictEqual(m.byId.get(3).review, false);
});

test('build: nodes come in outline order, parents before children, siblings by rank', () => {
  const m = build([
    card(5), card(4, { parent: 1, rank: 2 }), card(3, { parent: 1, rank: 1 }), card(2, { parent: 3 }), card(1),
  ]);
  assert.deepStrictEqual(m.nodes.map((n) => n.id), [1, 3, 2, 4, 5]);
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

const forest = () => build([
  card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 2 }), card(5, { parent: 2 }),
  card(6), card(7, { parent: 6 }), card(8), card(9),
]);

test('tiers: each depth sits on ring 90 + 85 * depth', () => {
  const m = forest();
  const l = graphLayoutTiers(m);
  for (const n of m.nodes.filter((x) => x.parentId !== null || x.kids)) {
    const p = l.pos.get(n.id);
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - (90 + 85 * n.depth)) < 1e-6, `card ${n.id}`);
  }
  assert.deepStrictEqual(l.rings.map((r) => [r.r, r.label]), [
    [90, 'roots'], [175, 'depth 1'], [260, 'depth 2'], [345, 'unnested'],
  ]);
});

test('tiers: children sit inside the parent sector and share it by leaf count', () => {
  const m = forest();
  const l = graphLayoutTiers(m);
  const a = (id) => ang(l.pos.get(id));
  const within = (id, lo, hi) => {
    const x = (a(id) - lo + 4 * Math.PI) % (2 * Math.PI);
    return x >= -1e-9 && x <= ((hi - lo) % (2 * Math.PI)) + 1e-9;
  };
  const sector = (id) => {
    const leaves = (n) => {
      const ks = m.nodes.filter((k) => k.parentId === n);
      return ks.length ? ks.reduce((s, k) => s + leaves(k.id), 0) : 1;
    };
    return leaves(id);
  };
  assert.strictEqual(sector(1), 3);
  const w1 = a(1) - (-Math.PI / 2);
  const lo = -Math.PI / 2;
  const hi = lo + 2 * w1;
  for (const id of [2, 3, 4, 5]) assert.ok(within(id, lo, hi), `card ${id} outside sector of 1`);
  const lo2 = lo;
  const hi2 = lo + 2 * w1 * (2 / 3);
  for (const id of [4, 5]) assert.ok(within(id, lo2, hi2), `card ${id} outside sector of 2`);
});

test('tiers: unnested cards go on the outer ring, alternating outward', () => {
  const m = forest();
  const l = graphLayoutTiers(m);
  const outer = 90 + 85 * 3;
  const radii = [8, 9].map((id) => Math.hypot(l.pos.get(id).x, l.pos.get(id).y));
  assert.ok(Math.abs(radii[0] - outer) < 1e-6);
  assert.ok(Math.abs(radii[1] - (outer + 24)) < 1e-6);
});

test('tiers: deterministic, finite, and safe on 0 and 1 node', () => {
  const m = forest();
  assert.deepStrictEqual(plain(graphLayoutTiers(m)), plain(graphLayoutTiers(m)));
  assert.ok(finite(graphLayoutTiers(m)));
  assert.ok(finite(graphLayoutTiers(build([]))));
  assert.ok(finite(graphLayoutTiers(build([card(1)]))));
});

test('tiers: bounds contain every node including its radius', () => {
  const m = forest();
  const l = graphLayoutTiers(m);
  for (const n of m.nodes) {
    const p = l.pos.get(n.id);
    const r = graphRadius(n);
    assert.ok(p.x - r >= l.bounds.x0 && p.x + r <= l.bounds.x1 && p.y - r >= l.bounds.y0 && p.y + r <= l.bounds.y1);
  }
});

// --- status ----------------------------------------------------------------------

const statusCards = () => [
  card(1, { status: 'backlog' }), card(2, { status: 'todo' }), card(3, { status: 'doing' }), card(4, { status: 'done' }),
];
const ringOfNode = (l, id, cx = 0) => Math.hypot(l.pos.get(id).x - cx, l.pos.get(id).y);

test('status: rings run done, doing, todo, backlog from the centre', () => {
  const m = build(statusCards());
  const l = graphLayoutStatus(m, { statuses: ['backlog', 'todo', 'doing', 'done'] });
  assert.deepStrictEqual(l.rings.map((r) => r.label), ['done (1)', 'doing (1)', 'todo (1)', 'backlog (1)']);
  const radii = l.rings.map((r) => r.r);
  assert.deepStrictEqual(radii, [...radii].sort((a, b) => a - b));
  assert.strictEqual(radii[0], 48);
  assert.ok(ringOfNode(l, 4) < ringOfNode(l, 3) && ringOfNode(l, 3) < ringOfNode(l, 2) && ringOfNode(l, 2) < ringOfNode(l, 1));
  assert.strictEqual(l.titles.length, 0);
});

test('status: default statuses apply when none are given', () => {
  const l = graphLayoutStatus(build(statusCards()));
  assert.deepStrictEqual(l.rings.map((r) => r.status), ['done', 'doing', 'todo', 'backlog']);
});

test('status: custom statuses reverse correctly', () => {
  const m = build([card(1, { status: 'a' }), card(2, { status: 'b' }), card(3, { status: 'c' })]);
  const l = graphLayoutStatus(m, { statuses: ['a', 'b', 'c'] });
  assert.deepStrictEqual(l.rings.map((r) => r.status), ['c', 'b', 'a']);
  assert.ok(ringOfNode(l, 3) < ringOfNode(l, 2) && ringOfNode(l, 2) < ringOfNode(l, 1));
});

test('status: an unlisted status folds into the first column ring', () => {
  const m = build([card(1, { status: 'backlog' }), card(2, { status: 'weird' })]);
  const l = graphLayoutStatus(m, { statuses: ['backlog', 'todo', 'doing', 'done'] });
  const backlog = l.rings.find((r) => r.status === 'backlog');
  assert.strictEqual(backlog.count, 2);
  assert.ok(Math.abs(ringOfNode(l, 2) - backlog.r) < 1e-6);
});

test('status: archived cards form a second clump to the right with the same ring labels', () => {
  const m = build([card(1, { status: 'todo' }), card(2, { status: 'done', archived: true })]);
  const l = graphLayoutStatus(m, { statuses: ['backlog', 'todo', 'doing', 'done'] });
  assert.strictEqual(l.rings.length, 8);
  assert.deepStrictEqual(l.rings.slice(0, 4).map((r) => r.status), l.rings.slice(4).map((r) => r.status));
  assert.deepStrictEqual(l.rings.map((r) => r.label), [
    'done (0)', 'doing (0)', 'todo (1)', 'backlog (0)', 'done (1)', 'doing (0)', 'todo (0)', 'backlog (0)',
  ]);
  assert.ok(l.rings[4].cx > l.rings[0].cx);
  assert.ok(l.pos.get(2).x > l.pos.get(1).x);
  assert.ok(Math.abs(ringOfNode(l, 2, l.rings[4].cx) - l.rings[4].r) < 1e-6);
  assert.deepStrictEqual(l.titles.map((t) => t.text), ['live', 'archive']);
  assert.ok(finite(l));
});

test('status: a crowded ring spills onto a second track without overlap', () => {
  const cards = [];
  for (let i = 1; i <= 60; i++) cards.push(card(i, { status: 'done' }));
  const m = build(cards);
  const l = graphLayoutStatus(m, { statuses: ['backlog', 'todo', 'doing', 'done'] });
  const radii = new Set(m.nodes.map((n) => Math.round(ringOfNode(l, n.id))));
  assert.ok(radii.size >= 2, 'expected a second track');
  for (let i = 0; i < m.nodes.length; i++) {
    for (let j = i + 1; j < m.nodes.length; j++) {
      const a = m.nodes[i];
      const b = m.nodes[j];
      const pa = l.pos.get(a.id);
      const pb = l.pos.get(b.id);
      const min = graphRadius(a) + graphRadius(b);
      assert.ok(Math.hypot(pa.x - pb.x, pa.y - pb.y) >= min * 0.9, `${a.id} overlaps ${b.id}`);
    }
  }
  assert.ok(finite(l));
});

test('status: deterministic and safe on 0 and 1 node', () => {
  const m = build(statusCards());
  assert.deepStrictEqual(plain(graphLayoutStatus(m)), plain(graphLayoutStatus(m)));
  assert.ok(finite(graphLayoutStatus(build([]))));
  assert.ok(finite(graphLayoutStatus(build([card(1)]))));
});

// --- force -----------------------------------------------------------------------

test('force: deterministic and finite; deg-0 cards sit beyond the connected radius', () => {
  const m = build([
    card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { waiting_for: [3] }), card(5), card(6),
  ]);
  const a = graphLayoutForce(m);
  assert.deepStrictEqual(plain(a), plain(graphLayoutForce(m)));
  assert.ok(finite(a));
  const far = Math.max(...[1, 2, 3, 4].map((id) => Math.hypot(a.pos.get(id).x, a.pos.get(id).y)));
  for (const id of [5, 6]) assert.ok(Math.hypot(a.pos.get(id).x, a.pos.get(id).y) > far + 59);
});

test('force: many isolated cards use two alternating radii', () => {
  const cards = [card(1), card(2, { parent: 1 })];
  for (let i = 3; i < 30; i++) cards.push(card(i));
  const l = graphLayoutForce(build(cards));
  const radii = new Set([3, 4, 5, 6].map((id) => Math.round(Math.hypot(l.pos.get(id).x, l.pos.get(id).y))));
  assert.strictEqual(radii.size, 2);
});

test('force: zero and one node are safe', () => {
  assert.ok(finite(graphLayoutForce(build([]))));
  assert.ok(finite(graphLayoutForce(build([card(1)]))));
  assert.ok(finite(graphLayoutForce(build([card(1), card(2, { parent: 1 })]))));
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
  const m = build([card(1), card(2, { parent: 1 }), card(3, { waiting_for: [1] }), card(4)]);
  assert.deepStrictEqual([...graphNeighbours(m, 1)].sort(), [1, 2, 3]);
  assert.deepStrictEqual([...graphNeighbours(m, 4)], [4]);
  assert.deepStrictEqual([...graphNeighbours(m, 99)], [99]);
});

// --- layout names ----------------------------------------------------------------

test('mergeGraphLayout: valid names pass, anything else is tiers', () => {
  assert.deepStrictEqual(GRAPH_LAYOUTS, ['tiers', 'force', 'status']);
  for (const k of GRAPH_LAYOUTS) assert.strictEqual(mergeGraphLayout(k), k);
  for (const bad of [undefined, null, '', 'radial', 7, {}]) assert.strictEqual(mergeGraphLayout(bad), 'tiers');
});

// --- cache -----------------------------------------------------------------------

test('cache: an identical signature returns the identical layout; blocked/review do not change it', () => {
  graphLayoutCacheClear();
  const a = build([card(1), card(2, { parent: 1 })]);
  const b = build([card(1, { blocked: 'x', review: true }), card(2, { parent: 1 })]);
  assert.strictEqual(graphSignature(a, 'force'), graphSignature(b, 'force'));
  const la = graphLayout(a, 'force');
  assert.strictEqual(graphLayout(b, 'force'), la);
  assert.notStrictEqual(graphLayout(a, 'tiers'), la);
});

test('cache: a status change or a different statuses list changes the signature', () => {
  const a = build([card(1, { status: 'todo' })]);
  const b = build([card(1, { status: 'doing' })]);
  assert.notStrictEqual(graphSignature(a, 'status'), graphSignature(b, 'status'));
  assert.notStrictEqual(graphSignature(a, 'status', { statuses: ['a', 'b'] }), graphSignature(a, 'status', { statuses: ['b', 'a'] }));
});

test('cache: holds at most 8 entries, evicting the oldest', () => {
  graphLayoutCacheClear();
  const first = build([card(100)]);
  const lf = graphLayout(first, 'tiers');
  for (let i = 0; i < 8; i++) graphLayout(build([card(i + 1)]), 'tiers');
  assert.notStrictEqual(graphLayout(first, 'tiers'), lf);
});

test('layout dispatcher: unknown kind falls back to tiers', () => {
  graphLayoutCacheClear();
  const m = forest();
  assert.deepStrictEqual(plain(graphLayout(m, 'nope')), plain(graphLayoutTiers(m)));
});

// --- plan ------------------------------------------------------------------------

const planOpts = (extra = {}) => ({ statusClass: (s) => s, titleOf: (c) => c.title, ...extra });
const sampleCards = () => [
  card(1, { status: 'doing' }),
  card(2, { parent: 1, status: 'done' }),
  card(3, { parent: 1, blocked: true }),
  card(4, { parent: 1, waiting_for: [2, 3], review: true }),
  card(5, { waiting_for: [9] }),
  card(6, { archived: true, status: 'done' }),
];

test('plan: node classes, order and title', () => {
  const m = build(sampleCards());
  const plan = graphPlan(m, graphLayout(m, 'tiers'), planOpts({ selectedIds: new Set([3]), hoveredId: 2 }));
  assert.deepStrictEqual(plan.nodes.map((n) => n.id), m.nodes.map((n) => n.id));
  const by = (id) => plan.nodes.find((n) => n.id === id);
  assert.match(by(1).cls, /^graph-node card-el status-doing/);
  assert.ok(by(1).cls.includes('has-kids'));
  assert.ok(by(1).cls.includes('graph-hub'));
  assert.ok(by(2).cls.includes('is-done') && by(2).cls.includes('hover-highlight'));
  assert.ok(by(3).cls.includes('selected') && by(3).cls.includes('is-blocked'));
  assert.ok(by(4).cls.includes('is-waiting') && by(4).cls.includes('is-review'));
  assert.ok(by(6).cls.includes('archived'));
  assert.strictEqual(by(6).title, '#6 card 6 (done, archived)');
  assert.strictEqual(by(3).title, '#3 card 3 (todo)');
  assert.strictEqual(by(1).hub, true);
  assert.strictEqual(by(5).hub, false);
});

test('plan: isHover predicate wins over hoveredId', () => {
  const m = build([card(1), card(2)]);
  const plan = graphPlan(m, graphLayout(m, 'force'), planOpts({ isHover: (id) => id === 2, hoveredId: 1 }));
  assert.ok(!plan.nodes[0].cls.includes('hover-highlight'));
  assert.ok(plan.nodes[1].cls.includes('hover-highlight'));
});

test('plan: parent links curve in tiers and status, straight in force; waits end at the rim', () => {
  const m = build(sampleCards());
  for (const kind of ['tiers', 'status']) {
    const plan = graphPlan(m, graphLayout(m, kind), planOpts());
    const parent = plan.links.find((l) => l.kind === 'parent');
    assert.match(parent.d, /^M[-\d.]+ [-\d.]+Q/, kind);
    assert.strictEqual(parent.arrow, false);
  }
  const force = graphPlan(m, graphLayout(m, 'force'), planOpts());
  assert.match(force.links.find((l) => l.kind === 'parent').d, /^M[-\d.]+ [-\d.]+L/);
  const lay = graphLayout(m, 'tiers');
  const plan = graphPlan(m, lay, planOpts());
  const wait = plan.links.find((l) => l.kind === 'wait' && l.from === 4 && l.to === 2);
  assert.strictEqual(wait.arrow, true);
  assert.match(wait.cls, /graph-link-wait/);
  const [ex, ey] = wait.d.split('L')[1].split(' ').map(Number);
  const t = lay.pos.get(2);
  assert.ok(Math.abs(Math.hypot(ex - t.x, ey - t.y) - (graphRadius(m.byId.get(2)) + 2)) < 0.05);
});

test('plan: status layout marks cross-clump links', () => {
  const m = build([card(1, { archived: true, status: 'done' }), card(2, { parent: 1 }), card(3), card(4, { parent: 3 })]);
  const plan = graphPlan(m, graphLayout(m, 'status', { statuses: ['todo', 'doing', 'done'] }), planOpts());
  const cross = plan.links.filter((l) => l.cls.includes('graph-link-cross'));
  assert.deepStrictEqual(cross.map((l) => `${l.from}>${l.to}`), ['1>2']);
  const tiers = graphPlan(m, graphLayout(m, 'tiers'), planOpts());
  assert.ok(tiers.links.every((l) => !l.cls.includes('cross')));
});

test('plan: rings, spokes and titles come from the layout; output is finite and deterministic', () => {
  const m = build(sampleCards());
  for (const kind of GRAPH_LAYOUTS) {
    const lay = graphLayout(m, kind, { statuses: ['backlog', 'todo', 'doing', 'done'] });
    const a = graphPlan(m, lay, planOpts());
    const b = graphPlan(m, lay, planOpts());
    assert.deepStrictEqual(a, b);
    const nums = JSON.stringify(a).match(/-?\d+(\.\d+)?(e-?\d+)?/g).map(Number);
    assert.ok(nums.every(Number.isFinite));
    assert.strictEqual(a.rings.length, lay.rings.length);
    assert.strictEqual(a.spokes.length, lay.spokes.length);
    assert.ok(a.rings.every((r) => r.cls === 'graph-ring'));
    assert.ok(!JSON.stringify(a).includes('NaN'));
  }
  const tiers = graphPlan(m, graphLayout(m, 'tiers'), planOpts());
  assert.ok(tiers.spokes.length > 0);
  const empty = build([]);
  const e = graphPlan(empty, graphLayout(empty, 'tiers'), planOpts());
  assert.deepStrictEqual(e.nodes, []);
});

test('visibleIds: filter composes with search by intersection, null when nothing narrows', () => {
  const pool = [card(1), card(2, { status: 'done' }), card(3, { archived: true })];
  const statuses = ['todo', 'done'];
  const filter = { todo: true, done: true, archive: false };
  assert.deepStrictEqual([...graphVisibleIds(pool, null, filter, statuses)].sort(), [1, 2]);
  assert.deepStrictEqual([...graphVisibleIds(pool, new Set([2, 3]), filter, statuses)], [2]);
  assert.strictEqual(graphVisibleIds(pool, null, { todo: true, done: true, archive: true }, statuses), null);
  assert.deepStrictEqual([...graphVisibleIds(pool, new Set([3]), { todo: true, done: true, archive: true }, statuses)], [3]);
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
