const { test, after } = require('node:test');
const assert = require('node:assert');

const {
  graphBuild, graphLayoutTiers, graphLayout, graphPlan, graphFit, graphVisibleIds, graphRadius,
} = require('../web/graph-model');
const scenario = require('./browser/scenarios/tier-fan');
const {
  STATUSES, CTX, loadBoard, cleanUp, card, drawnModel, buildOf, captionRects, clashes, rootShapedCards,
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
const layoutOf = (m) => graphLayoutTiers(m, { statuses: STATUSES, unnested: 'table' });
const planOf = (m) => graphPlan(m, layoutOf(m), OPTS);
const planModel = (opts) => drawnModel(planBoard, opts);
const rim = (l) => (l.bands.length ? l.bands[l.bands.length - 1].r1 : 0);
const outerRing = (l) => Math.max(0, ...l.rings.map((r) => r.r));
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

test('drawing: each guide arc is a round arc at its band\'s ring, the whole way round but for the seam at the top', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  const rings = l.bands.flatMap((b) => b.rings);
  plan.guides.forEach((g, i) => {
    const m2 = /^M(-?[\d.]+) (-?[\d.]+)A([\d.]+) ([\d.]+) 0 ([01]) ([01]) (-?[\d.]+) (-?[\d.]+)$/.exec(g.d);
    assert.ok(m2, `guide ${i}: ${g.d}`);
    const [, x0, y0, rx, ry, large, sweep, x1, y1] = m2.map(Number);
    assert.ok(Math.abs(rx - rings[i]) < 0.01 && Math.abs(ry - rings[i]) < 0.01, `guide ${i} has the radius of its ring`);
    assert.ok(Math.abs(Math.hypot(x0, y0) - rings[i]) < 0.02 && Math.abs(Math.hypot(x1, y1) - rings[i]) < 0.02, `guide ${i} starts and ends on its ring`);
    assert.ok(x0 < 0 && y0 < 0 && x1 > 0 && y1 < 0, `guide ${i} starts left of the seam and ends right of it, both above the centre`);
    assert.ok(Math.abs(x0 + x1) < 0.02 && Math.abs(y0 - y1) < 0.02, `guide ${i} leaves the seam centred on the top`);
    assert.deepStrictEqual([large, sweep], [1, 0], `guide ${i} is the long way round, turning as the fan does`);
    assert.strictEqual(g.cls.split(' ')[0], 'graph-guide');
  });
});

test('drawing: a caption stands on the seam level with its band\'s first ring, and neighbours take opposite sides of it so they never touch', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  assert.strictEqual(plan.captions.length, l.bands.length);
  plan.captions.forEach((c, i) => {
    assert.ok(Math.abs(c.y + l.bands[i].rings[0]) < 0.01, `caption ${i} is level with the first ring of its band, above the centre`);
    assert.strictEqual(c.side, i % 2 ? 'right' : 'left');
    assert.strictEqual(c.anchor, i % 2 ? 'start' : 'end', 'its text runs away from the seam');
    assert.ok(c.x * (i % 2 ? 1 : -1) > 0 && Math.abs(c.x) < 20, `caption ${i} starts beside the seam`);
  });
  assert.ok(plan.captions.every((c, i) => i === 0 || c.y < plan.captions[i - 1].y), 'and they climb the seam in axis order, tier 1 at the bottom');
  assert.strictEqual(plan.captions[0].dy, plan.captions[1].dy, 'each is centred on its ring');
});

test('drawing: a tier nobody is in keeps a faint guide arc and a muted caption with the count 0', () => {
  const m = buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })], ['goal', 'epic']);
  const plan = planOf(m);
  assert.deepStrictEqual(plan.captions.map((c) => [c.name, c.count, c.muted]), [['goal', 0, true], ['epic', 1, false], ['depth 1', 1, false]]);
  assert.deepStrictEqual(plan.guides.map((g) => g.cls.includes('graph-guide-empty')), [true, false, false]);
});

test('drawing: a muted caption that would run into a caption on its side of the seam is left out, and the arc stays', () => {
  const chain = [card(1, { type: 'epic' })];
  for (let i = 2; i <= 15; i++) chain.push(card(i, { parent: i - 1 }));
  const m = buildOf(chain, ['goal', 'strategy', 'objective', 'epic']);
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  const names = plan.captions.map((c) => c.name);
  assert.ok(names.includes('epic'), 'the tier with a card is always captioned');
  assert.ok(l.textScale < 0.5, 'the fan is big, so a line of text is a long way in the world');
  assert.ok(!names.includes('objective'), `the thin empty bands 20 apart cannot all be captioned: ${names.join(', ')}`);
  assert.deepStrictEqual(names.slice(0, 2), ['goal', 'strategy'], 'the first of them is, on opposite sides');
  assert.strictEqual(plan.guides.length, 3 + 1 + 14, 'but every band keeps its arc');
  for (const side of ['left', 'right']) {
    const column = plan.captions.filter((c) => c.side === side).sort((p, q) => p.y - q.y);
    for (let i = 0; i + 1 < column.length; i++) assert.ok(column[i + 1].y - column[i].y >= 14 / l.textScale - 1e-9, 'two captions on a side are a line apart');
  }
  const small = planOf(buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })], ['goal', 'strategy', 'objective', 'epic']));
  assert.deepStrictEqual(small.captions.map((c) => c.name), ['goal', 'strategy', 'objective', 'epic', 'depth 1'], 'a small fan has room for them all');
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
  // the plan rounds each number to a hundredth, so two that meet can be 0.015 apart
  for (let i = 1; i < plan.block.columns.length; i++) assert.ok(plan.block.columns[i].x >= plan.block.columns[i - 1].x + plan.block.columns[i - 1].w - 0.02, 'columns do not overlap');
});

test('drawing: the block\'s title is Unnested, and each column is captioned with its status, inside the column, both counted in their tips', () => {
  const plan = planOf(planModel());
  const { block } = plan;
  assert.deepStrictEqual([block.title.name, block.title.count], ['Unnested', PLAN.block.length]);
  assert.ok(block.title.x >= block.x && block.title.x < block.x + block.w);
  for (const col of block.columns) {
    assert.deepStrictEqual([col.caption.name, col.caption.count], [col.label, col.ids.length]);
    assert.ok(col.caption.x >= col.x && col.caption.x < col.x + col.w, `${col.label}'s caption starts in its column`);
    assert.ok(col.w >= col.label.length * 6, `${col.label}'s column is wide enough for its caption`);
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

// The loose caption's box in the world, measured as the page draws it at `v` (a fit).
const worldBox = (r, v) => ({ x0: (r.l - v.x) / v.k, x1: (r.r - v.x) / v.k, y0: (r.t - v.y) / v.k, y1: (r.b - v.y) / v.k });
const boxCorners = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]];
const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const turnOf = (l, x, y) => {
  const a = Math.atan2(y, x);
  return a < l.fan.to - 1e-9 ? a + 2 * Math.PI : a;
};
const manyLoose = (n, first = 10) => Array.from({ length: n }, (_, i) => card(first + i, { type: 'epic' }));
const LOOSE_BOARDS = {
  'the plan board': () => planModel(),
  'only loose cards with a tier': () => buildOf([card(1, { type: 'goal' }), card(2, { type: 'epic' }), card(3, { type: 'epic' }), card(4)]),
  'one small tree and many loose cards with a tier': () => buildOf([card(1), card(2, { parent: 1 }), ...manyLoose(30)]),
  'one loose card with a tier among many trees': () => buildOf([
    ...Array.from({ length: 8 }, (_, i) => [card(100 + 2 * i), card(101 + 2 * i, { parent: 100 + 2 * i })]).flat(), card(5, { type: 'epic' }), card(6),
  ]),
  'a loose card with a tier and a block of loose cards': () => buildOf([card(1, { type: 'goal' }), ...Array.from({ length: 25 }, (_, i) => card(10 + i, { status: STATUSES[i % 4] }))]),
};

test('drawing: the sector of loose cards with a tier has a caption with a count, outside the rim at the middle of the sector', () => {
  const plan = planOf(planModel());
  assert.deepStrictEqual([plan.looseCaption.name, plan.looseCaption.count], ['Unnested, with a tier', 1]);
  assert.ok(Object.values(plan.looseCaption).every((v) => typeof v !== 'number' || Number.isFinite(v)));
  const two = planOf(buildOf([card(1, { type: 'goal' }), card(2, { type: 'epic' }), card(3, { type: 'goal' }), card(4, { parent: 3 })], ['goal', 'strategy', 'objective', 'epic']));
  assert.strictEqual(two.looseCaption.count, 2, 'one caption counts every loose card with a tier');
  assert.strictEqual(planOf(buildOf([card(1), card(2, { parent: 1 })], [])).looseCaption, null, 'no loose card with a tier, no caption');
  for (const [name, make] of Object.entries(LOOSE_BOARDS)) {
    const m = make();
    const l = layoutOf(m);
    const p = graphPlan(m, l, OPTS);
    const caption = p.looseCaption;
    assert.ok(caption, name);
    const sector = l.sectors.find((s) => s.kind === 'loose');
    const turn = turnOf(l, caption.x, caption.y);
    assert.ok(turn <= sector.from + 1e-6 && turn >= sector.to - 1e-6, `${name}: the caption is in the direction of its sector`);
    const v = graphFit(l.bounds, 1600, 800);
    const [rect] = captionRects({ captions: [], looseCaption: caption, block: null }, v);
    const box = worldBox(rect, v);
    for (const [x, y] of boxCorners(box)) assert.ok(Math.hypot(x, y) > rim(l), `${name}: a corner of the caption at ${Math.round(x)},${Math.round(y)} is outside the rim`);
    if (p.block) assert.ok(!meets(box, { x0: p.block.x, y0: p.block.y, x1: p.block.x + p.block.w, y1: p.block.y + p.block.h }), `${name}: the caption is clear of the Unnested block`);
  }
});

test('drawing: the loose caption stands to the side of its sector with its text running away from the fan, and above or below it at the top and bottom', () => {
  const side = (make) => {
    const m = make();
    return planOf(m).looseCaption;
  };
  const only = side(LOOSE_BOARDS['only loose cards with a tier']);
  assert.strictEqual(only.anchor, 'middle', 'a sector all the way round has its middle at the bottom');
  assert.ok(only.y > 0 && Math.abs(only.x) < 1);
  const many = side(LOOSE_BOARDS['one small tree and many loose cards with a tier']);
  assert.ok(['start', 'middle', 'end'].includes(many.anchor));
  const check = (c) => {
    if (c.anchor === 'start') assert.ok(c.x > 0, 'text that starts at the point runs away from the fan on the right');
    if (c.anchor === 'end') assert.ok(c.x < 0, 'and on the left');
  };
  for (const make of Object.values(LOOSE_BOARDS)) check(side(make));
});

test('drawing: the force and status layouts draw no arcs, captions, dividers, block or loose caption', () => {
  const m = planModel();
  for (const kind of ['force', 'status']) {
    const plan = graphPlan(m, graphLayout(m, kind, { statuses: STATUSES, unnested: 'table' }), { ...OPTS, kind });
    assert.deepStrictEqual([plan.guides, plan.captions, plan.dividers], [[], [], []], kind);
    assert.strictEqual(plan.block, null, kind);
    assert.strictEqual(plan.looseCaption, null, kind);
  }
  const tiers = planOf(m);
  assert.ok(tiers.block && tiers.guides.length && tiers.captions.length && tiers.dividers.length && tiers.looseCaption, 'and the tiers layout does');
});

// --- the bounds Fit frames --------------------------------------------------------------------------------

test('drawing: the bounds hold the whole circle, with the captions on its seam, and the block', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  const b = l.bounds;
  assert.ok(b.x0 <= -outerRing(l) + 1 && b.x1 >= outerRing(l) - 1, 'the outer arc reaches both sides');
  assert.ok(b.y0 <= -outerRing(l) + 1 && b.y1 >= outerRing(l) - 1, 'and the top as well as the bottom');
  for (const c of plan.captions) assert.ok(c.y >= b.y0 && c.y <= b.y1 && c.x >= b.x0 && c.x <= b.x1, `caption ${c.name} is inside`);
  for (const [x, y] of corners(plan.block)) assert.ok(x >= b.x0 - 0.01 && x <= b.x1 + 0.01 && y >= b.y0 - 0.01 && y <= b.y1 + 0.01, `block corner ${x},${y}`);
});

test('drawing: Fit lands every dot, caption and the block inside the stage, at a stage of any size', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  for (const [w, h] of [[1280, 640], [1000, 700], [1600, 900]]) {
    const v = graphFit(l.bounds, w, h);
    const inside = (x, y, what) => {
      const sx = x * v.k + v.x;
      const sy = y * v.k + v.y;
      assert.ok(sx >= 0 && sx <= w && sy >= 0 && sy <= h, `${what} at ${Math.round(sx)},${Math.round(sy)} of ${w}x${h}`);
    };
    for (const n of plan.nodes) inside(n.x, n.y, `dot ${n.id}`);
    for (const [x, y] of corners(plan.block)) inside(x, y, 'block corner');
    for (const r of captionRects(plan, v)) {
      assert.ok(r.l >= 0 && r.r <= w && r.t >= 0 && r.b <= h, `caption ${r.name} at ${Math.round(r.l)},${Math.round(r.t)} of ${w}x${h}`);
    }
    for (const r of [-1, 1]) inside(r * outerRing(l), 0, 'the outer arc');
    inside(0, -outerRing(l), 'the top of the outer arc');
    inside(0, outerRing(l), 'the bottom of the outer arc');
  }
});

// --- no two captions overlap ------------------------------------------------------------------------------

// Each is a board the fan is drawn for. The first draw and the Fit button both frame the
// bounds with graphFit, so a fit on a stage is both.
const STAGES = [[1600, 800], [1280, 720], [1000, 700]];
const archiveShown = () => {
  const filter = { backlog: true, todo: true, doing: true, done: true, archive: true };
  return graphBuild(planBoard.all, { ctx: planBoard.ctx, hierarchy: planBoard.config.hierarchy, visibleIds: graphVisibleIds(planBoard.all, null, filter, STATUSES) });
};
const FAN_BOARDS = () => ({
  'the plan board': planModel(),
  'the plan board with the Archive pill on': archiveShown(),
  'the fixture board': drawnModel(loadBoard('fixture')),
  'the malformed board': drawnModel(loadBoard('malformed')),
  'a board the size of a real shop board': buildOf(rootShapedCards()),
  'a board of loose cards in every status': buildOf(Array.from({ length: 60 }, (_, i) => card(i + 1, { status: STATUSES[i % 4] })), []),
  'a board of trees in every tier': buildOf(rootShapedCards().filter((c) => c.type !== undefined || c.parent !== null)),
});

test('drawing: no two captions overlap, the bands\', the loose cards\' and the block\'s, on a stage of any ordinary size, at the first draw and after Fit', () => {
  for (const [name, m] of Object.entries(FAN_BOARDS())) {
    const l = layoutOf(m);
    const plan = graphPlan(m, l, OPTS);
    for (const [w, h] of STAGES) {
      const v = graphFit(l.bounds, w, h);
      const rects = captionRects(plan, v);
      assert.ok(rects.length >= 3, `${name}: there are captions to measure`);
      assert.deepStrictEqual(clashes(rects), [], `${name} on ${w}x${h} at k=${v.k.toFixed(2)}`);
    }
  }
});

test('drawing: the block\'s title and column captions stand inside its frame at the fit of a stage of any ordinary size', () => {
  for (const [name, m] of Object.entries(FAN_BOARDS())) {
    const l = layoutOf(m);
    const plan = graphPlan(m, l, OPTS);
    if (!plan.block) continue;
    for (const [w, h] of STAGES) {
      const v = graphFit(l.bounds, w, h);
      const frame = { x0: plan.block.x, y0: plan.block.y, x1: plan.block.x + plan.block.w, y1: plan.block.y + plan.block.h };
      const rects = captionRects({ captions: [], looseCaption: null, block: plan.block }, v);
      for (const r of rects) {
        const b = worldBox(r, v);
        assert.ok(b.x0 >= frame.x0 - 0.5 && b.x1 <= frame.x1 + 0.5 && b.y0 >= frame.y0 - 0.5 && b.y1 <= frame.y1 + 0.5, `${name} on ${w}x${h}: ${r.name} is inside the frame`);
      }
    }
  }
});
