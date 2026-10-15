const { test, after } = require('node:test');
const assert = require('node:assert');

const {
  graphBuild, graphLayoutTiers, graphLayout, graphPlan, graphFit, graphVisibleIds, graphRadius,
} = require('../web/graph-model');
const scenario = require('./browser/scenarios/tier-fan');
const {
  STATUSES, CTX, loadBoard, cleanUp, card, drawnModel, buildOf,
} = require('./helpers/fan-boards');

// What the tier fan draws around its dots: a guide arc and a caption for each
// band, dividers between the sectors, a caption for the loose cards that have a
// tier, and the Unnested block with its title and a caption for each column.
// graphPlan is the one pure function that turns the layout (graph-fan-layout.test.js)
// into those marks; graph-view.js only stamps them as SVG. The plan board is the
// browser runner's own fixture, so what is asserted here about its bands and
// columns is what the runner sees on the page.

after(cleanUp);

const planBoard = loadBoard('plan');
const PLAN = scenario.CASES.plan;
const OPTS = { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title };
const layoutOf = (m) => graphLayoutTiers(m, { statuses: STATUSES });
const planOf = (m) => graphPlan(m, layoutOf(m), OPTS);
const planModel = (opts) => drawnModel(planBoard, opts);
const rim = (l) => (l.bands.length ? l.bands[l.bands.length - 1].r1 : 0);
const ringsOf = (l) => l.bands.reduce((n, b) => n + b.rings.length, 0);

// --- a guide arc and a caption for each band ------------------------------------------------

test('drawing: the plan board has a caption for each tier band and each depth ring that holds a card, in axis order, with its name and count', () => {
  const plan = planOf(planModel());
  assert.deepStrictEqual(plan.captions.map((c) => [c.name, c.count]), [
    ['goal', PLAN.tiers[0].length], ['strategy', PLAN.tiers[1].length], ['objective', PLAN.tiers[2].length], ['epic', PLAN.tiers[3].length],
    ['depth 1', PLAN.depths[0].length], ['depth 2', PLAN.depths[1].length], ['depth 4', PLAN.depths[2].length], ['depth 5', PLAN.depths[3].length],
  ]);
});

test('drawing: a depth ring nobody is on draws no guide arc and no caption', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  const names = plan.captions.map((c) => c.name);
  assert.ok(!names.includes('roots'), 'depth 0 holds only cards in tiers or the Unnested block');
  assert.ok(!names.includes('depth 3'), 'depth 3 holds only the epic, which is in its tier');
  const bandArcs = plan.guides.filter((g) => !g.sub);
  assert.strictEqual(bandArcs.length, 8, 'one arc for each of the eight bands');
  assert.deepStrictEqual(bandArcs.map((g) => g.band), l.bands.map((b) => b.index), 'in axis order');
  assert.ok(l.bands[0].rings.length === 2, 'the goal band has two rows: card 25 is a goal nested in the goal 1');
  assert.strictEqual(plan.guides.length, ringsOf(l), 'and a lighter arc through each further row of a band');
  assert.deepStrictEqual(plan.guides.filter((g) => g.sub).map((g) => g.band), [0]);
});

test('drawing: each guide arc is a round arc through the fan at its band\'s ring, from the flat edge on the left to the fan\'s right edge', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  const rings = l.bands.flatMap((b) => b.rings);
  plan.guides.forEach((g, i) => {
    const m2 = /^M(-?[\d.]+) (-?[\d.]+)A([\d.]+) ([\d.]+) 0 0 0 (-?[\d.]+) (-?[\d.]+)$/.exec(g.d);
    assert.ok(m2, `guide ${i}: ${g.d}`);
    const [, x0, y0, rx, ry, x1, y1] = m2.map(Number);
    assert.ok(Math.abs(rx - rings[i]) < 0.01 && Math.abs(ry - rings[i]) < 0.01, `guide ${i} has the radius of its ring`);
    assert.ok(Math.abs(Math.hypot(x0, y0) - rings[i]) < 0.02 && Math.abs(Math.hypot(x1, y1) - rings[i]) < 0.02, `guide ${i} starts and ends on its ring`);
    assert.ok(x0 < 0 && Math.abs(y0) < 0.01, `guide ${i} starts at the flat edge, on the left`);
    assert.ok(x1 > 0 && y1 > 0, `guide ${i} ends at the fan's right edge, below the flat edge`);
    assert.strictEqual(g.cls.split(' ')[0], 'graph-guide');
  });
});

test('drawing: a caption stands on the flat edge above its ring, and neighbours alternate between two rows so they never touch', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  assert.strictEqual(plan.captions.length, l.bands.length);
  plan.captions.forEach((c, i) => {
    assert.ok(Math.abs(c.x + l.bands[i].rings[0]) < 0.01, `caption ${i} is above the first ring of its band, on the left`);
    assert.strictEqual(c.y, 0);
    assert.strictEqual(c.row, i % 2);
  });
  assert.notStrictEqual(plan.captions[0].dy, plan.captions[1].dy, 'the two rows are at different heights');
  assert.strictEqual(plan.captions[0].dy, plan.captions[2].dy);
});

test('drawing: a tier nobody is in keeps a faint guide arc and a muted caption with the count 0', () => {
  const m = buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })], ['goal', 'epic']);
  const plan = planOf(m);
  assert.deepStrictEqual(plan.captions.map((c) => [c.name, c.count, c.muted]), [['goal', 0, true], ['epic', 1, false], ['depth 1', 1, false]]);
  assert.deepStrictEqual(plan.guides.map((g) => g.cls.includes('graph-guide-empty')), [true, false, false]);
});

test('drawing: a muted caption that would run into a caption beside it on its row is left out, and the arc stays', () => {
  const m = buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })], ['goal', 'strategy', 'objective', 'epic']);
  const plan = planOf(m);
  const names = plan.captions.map((c) => c.name);
  assert.ok(names.includes('epic'), 'the tier with a card is always captioned');
  assert.ok(names.length < 4, `thin empty bands 20 apart cannot all be captioned: ${names.join(', ')}`);
  assert.strictEqual(plan.guides.length, 5, 'but every band keeps its arc');
  const rows = [0, 1].map((r) => plan.captions.filter((c) => c.row === r).sort((p, q) => p.x - q.x));
  for (const row of rows) {
    for (let i = 0; i + 1 < row.length; i++) assert.ok(row[i + 1].x - row[i].x > 50, 'two captions on a row are a text apart');
  }
});

test('drawing: a board without a hierarchy captions the depth rings by depth, and no tier', () => {
  const board = loadBoard('fixture');
  const plan = planOf(drawnModel(board));
  assert.deepStrictEqual(plan.captions.map((c) => c.name), ['roots', 'depth 1', 'depth 2']);
  assert.deepStrictEqual(plan.captions.map((c) => c.count), scenario.CASES.fixture.depths.map((ids) => ids.length));
});

// --- dividers between the sectors -----------------------------------------------------------

const angleOf = (x, y) => Math.atan2(y, x);

test('drawing: one divider between each pair of neighbouring sectors, and a single sector needs none', () => {
  const plan = planOf(planModel());
  assert.strictEqual(plan.dividers.length, 1, 'the plan board has a tree and the loose cards with a tier');
  const trees = buildOf([card(1), card(2, { parent: 1 }), card(3), card(4, { parent: 3 }), card(5), card(6, { parent: 5 })], []);
  assert.strictEqual(planOf(trees).dividers.length, 2);
  assert.strictEqual(planOf(buildOf([card(1), card(2, { parent: 1 })], [])).dividers.length, 0);
  assert.strictEqual(planOf(buildOf([])).dividers.length, 0);
});

test('drawing: a divider runs along the gap between its two sectors, from near the centre out past the cards of both, with finite coordinates', () => {
  const m = buildOf([card(1), card(2, { parent: 1 }), card(3, { parent: 2 }), card(4), card(5, { parent: 4 })], []);
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  const [d] = plan.dividers;
  assert.ok(Object.values(d).every(Number.isFinite));
  const a = angleOf(d.x2 - d.x1, d.y2 - d.y1);
  assert.ok(a < l.sectors[0].to && a > l.sectors[1].from, 'it lies between the sectors');
  assert.ok(Math.hypot(d.x1, d.y1) < l.bands[0].r0, 'it starts inside the first band');
  const reach = Math.max(...m.nodes.map((n) => Math.hypot(l.pos.get(n.id).x, l.pos.get(n.id).y)));
  assert.ok(Math.hypot(d.x2, d.y2) > reach, 'and runs past the outermost card of either sector');
  assert.ok(Math.hypot(d.x2, d.y2) <= rim(l) + 0.01, 'but no farther than the rim');
});

test('drawing: a divider stops short of a mark that stands on it, and carries on beyond', () => {
  const m = buildOf([card(1), card(2, { parent: 1 }), card(3), card(4, { parent: 3 }), card(5, { parent: 3 })], []);
  const l = layoutOf(m);
  const spoke = l.spokes[0];
  const middle = (l.bands[0].r0 + l.bands[0].r1) / 2;
  const pos = new Map(l.pos);
  pos.set(2, { x: Math.cos(spoke.angle) * middle, y: Math.sin(spoke.angle) * middle });
  const moved = { ...l, pos };
  const plan = graphPlan(m, moved, OPTS);
  assert.strictEqual(plan.dividers.length, 2, 'the divider is in two pieces');
  const at = (d) => [Math.hypot(d.x1, d.y1), Math.hypot(d.x2, d.y2)];
  const [first, second] = plan.dividers.map(at).sort((p, q) => p[0] - q[0]);
  assert.ok(first[1] < middle - graphRadius(m.byId.get(2)), 'the first piece ends before the mark');
  assert.ok(second[0] > middle + graphRadius(m.byId.get(2)), 'the second starts after it');
  assert.strictEqual(planOf(m).dividers.length, 1, 'and with no mark on it, a whole line');
});

// --- the Unnested block ---------------------------------------------------------------------------

const corners = (b) => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
const treeOf = (hierarchy) => (c) => hierarchy.includes(String(c.type || '').toLowerCase());

// The loose cards without a tier, worked out from the cards alone: no parent, no
// child, and a type outside the hierarchy.
function unnested(board, { archived = false } = {}) {
  const cards = board.all;
  const parents = new Set(cards.filter((c) => c.parent != null).map((c) => c.parent));
  const tiered = treeOf(board.config.hierarchy.map((h) => h.toLowerCase()));
  return cards.filter((c) => !!c.archived === archived && (c.parent == null || !cards.some((p) => p.id === c.parent))
    && !parents.has(c.id) && !tiered(c));
}

test('drawing: the Unnested block\'s box lies wholly outside the fan\'s rim, with room to spare', () => {
  for (const key of ['plan', 'fixture', 'malformed']) {
    const board = loadBoard(key);
    const m = drawnModel(board);
    const l = layoutOf(m);
    const plan = graphPlan(m, l, OPTS);
    assert.ok(plan.block, `${key} has loose cards without a tier`);
    for (const [x, y] of corners(plan.block)) assert.ok(Math.hypot(x, y) > rim(l) + 20, `${key}: a corner of the box at ${x},${y}`);
    for (const id of plan.block.columns.flatMap((c) => c.ids)) {
      const p = l.pos.get(id);
      assert.ok(p.x >= plan.block.x && p.x <= plan.block.x + plan.block.w && p.y >= plan.block.y && p.y <= plan.block.y + plan.block.h, `${key}: card ${id} is inside the box`);
    }
  }
  const small = planOf(buildOf([card(1), card(2, { status: 'done' })], []));
  assert.ok(small.block.x < 0 && small.block.x + small.block.w > 0, 'with no fan the box is centred');
  assert.strictEqual(planOf(buildOf([card(1), card(2, { parent: 1 })], [])).block, null, 'a board with no loose card without a tier has no block');
});

test('drawing: the block has a column for each status, in the board\'s order, and each holds exactly the loose cards without a tier in that status', () => {
  const plan = planOf(planModel());
  const want = unnested(planBoard);
  assert.deepStrictEqual(want.map((c) => c.id).sort((a, b) => a - b), PLAN.block, 'the fixture\'s own list');
  assert.deepStrictEqual(plan.block.columns.map((c) => c.label), STATUSES);
  for (const col of plan.block.columns) {
    assert.deepStrictEqual(col.ids.slice().sort((a, b) => a - b), want.filter((c) => c.status === col.label).map((c) => c.id).sort((a, b) => a - b), col.label);
    assert.strictEqual(col.count, col.ids.length);
  }
  for (let i = 1; i < plan.block.columns.length; i++) assert.ok(plan.block.columns[i].x >= plan.block.columns[i - 1].x + plan.block.columns[i - 1].w - 1e-9, 'columns do not overlap');
});

test('drawing: the block\'s title is Unnested and its count, and each column is captioned with its status and count, inside the column', () => {
  const plan = planOf(planModel());
  const { block } = plan;
  assert.deepStrictEqual([block.title.name, block.title.count], ['Unnested', PLAN.block.length]);
  assert.ok(block.title.x >= block.x && block.title.x < block.x + block.w);
  for (const col of block.columns) {
    assert.deepStrictEqual([col.caption.name, col.caption.count], [col.label, col.ids.length]);
    assert.ok(col.caption.x >= col.x && col.caption.x < col.x + col.w, `${col.label}'s caption starts in its column`);
    assert.ok(col.w >= `${col.label} ${col.count}`.length * 6, `${col.label}'s column is wide enough for its caption`);
    assert.strictEqual(col.caption.y, block.title.y, 'the captions share a baseline under the title');
  }
  assert.ok(block.title.dy.startsWith('-'), 'the title stands above the captions');
});

test('drawing: an archived loose card without a tier gets an archived column last, once the Archive status pill shows it', () => {
  const filter = (archive) => ({ backlog: true, todo: true, doing: true, done: true, archive });
  const model = (archive) => graphBuild(planBoard.all, { ctx: planBoard.ctx, hierarchy: planBoard.config.hierarchy, visibleIds: graphVisibleIds(planBoard.all, null, filter(archive), STATUSES) });
  const hidden = planOf(model(false)).block;
  assert.ok(!hidden.columns.some((c) => c.label === 'archived'));
  const shown = planOf(model(true)).block;
  const last = shown.columns[shown.columns.length - 1];
  assert.deepStrictEqual([last.label, last.count], ['archived', unnested(planBoard, { archived: true }).length]);
  assert.deepStrictEqual(last.ids.slice().sort((a, b) => a - b), unnested(planBoard, { archived: true }).map((c) => c.id).sort((a, b) => a - b));
  assert.strictEqual(shown.title.count, hidden.title.count + last.count);
});

// --- the loose cards with a tier --------------------------------------------------------------------

test('drawing: the sector of loose cards with a tier has a caption with a count, beside its outermost card', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  const loose = l.sectors.find((s) => s.kind === 'loose');
  assert.deepStrictEqual(loose.tops, [26]);
  assert.deepStrictEqual([plan.looseCaption.name, plan.looseCaption.count], ['Unnested, with a tier', 1]);
  const at = l.pos.get(26);
  assert.ok(plan.looseCaption.x >= at.x - 1 && plan.looseCaption.x < at.x + 40, 'it starts at the card and runs away from the fan');
  assert.ok(plan.looseCaption.y < at.y - graphRadius(m.byId.get(26)), 'and stands above the dot, clear of it');
  assert.ok(Object.values(plan.looseCaption).every((v) => typeof v !== 'number' || Number.isFinite(v)));

  const two = planOf(buildOf([card(1, { type: 'goal' }), card(2, { type: 'epic' }), card(3, { type: 'goal' }), card(4, { parent: 3 })], ['goal', 'strategy', 'objective', 'epic']));
  assert.strictEqual(two.looseCaption.count, 2, 'one caption counts every loose card with a tier');
  assert.strictEqual(planOf(buildOf([card(1), card(2, { parent: 1 })], [])).looseCaption, null, 'no loose card with a tier, no caption');
});

test('drawing: the force and status layouts draw no arcs, captions, dividers, block or loose caption', () => {
  const m = planModel();
  for (const kind of ['force', 'status']) {
    const plan = graphPlan(m, graphLayout(m, kind, { statuses: STATUSES }), { ...OPTS, kind });
    assert.deepStrictEqual([plan.guides, plan.captions, plan.dividers], [[], [], []], kind);
    assert.strictEqual(plan.block, null, kind);
    assert.strictEqual(plan.looseCaption, null, kind);
  }
  const tiers = planOf(m);
  assert.ok(tiers.block && tiers.guides.length && tiers.captions.length && tiers.dividers.length && tiers.looseCaption, 'and the tiers layout does');
});

// --- the bounds Fit frames --------------------------------------------------------------------------------

test('drawing: the bounds hold the captions above the flat edge, the block and the loose caption, and not the empty half above the fan', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  const b = l.bounds;
  assert.ok(b.y0 < 0, 'room above the flat edge for the captions');
  assert.ok(b.y0 > -rim(l) / 4, `but not the empty upper half of a full circle: ${b.y0}`);
  for (const c of plan.captions) {
    assert.ok(b.x0 <= c.x - c.name.length * 3, `caption ${c.name} is inside on the left`);
    assert.ok(b.x1 >= c.x + c.name.length * 3, `and on the right`);
  }
  assert.ok(b.x0 <= -rim(l) + 1, 'the outer arc reaches the left edge');
  for (const [x, y] of corners(plan.block)) assert.ok(x >= b.x0 - 0.01 && x <= b.x1 + 0.01 && y >= b.y0 - 0.01 && y <= b.y1 + 0.01, `block corner ${x},${y}`);
  const solo = graphLayoutTiers(buildOf([card(1, { type: 'goal' })], ['goal']), { statuses: STATUSES });
  const soloPlan = graphPlan(buildOf([card(1, { type: 'goal' })], ['goal']), solo, OPTS);
  assert.ok(soloPlan.looseCaption);
  const text = `${soloPlan.looseCaption.name} ${soloPlan.looseCaption.count}`;
  assert.ok(solo.bounds.x1 >= soloPlan.looseCaption.x + text.length * 6, 'the loose caption is inside when it is the farthest thing right');
  assert.ok(solo.bounds.y0 <= soloPlan.looseCaption.y - 11);
});

test('drawing: Fit lands every dot, caption and the block inside the stage, at a stage of any size', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  for (const [w, h] of [[1280, 640], [900, 700], [1600, 900]]) {
    const v = graphFit(l.bounds, w, h);
    const inside = (x, y, what) => {
      const sx = x * v.k + v.x;
      const sy = y * v.k + v.y;
      assert.ok(sx >= 0 && sx <= w && sy >= 0 && sy <= h, `${what} at ${Math.round(sx)},${Math.round(sy)} of ${w}x${h}`);
    };
    for (const n of plan.nodes) inside(n.x, n.y, `dot ${n.id}`);
    for (const c of plan.captions) inside(c.x, -25 / v.k, `caption ${c.name}`);
    for (const [x, y] of corners(plan.block)) inside(x, y, 'block corner');
  }
});
