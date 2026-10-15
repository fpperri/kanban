const { test, after } = require('node:test');
const assert = require('node:assert');

const {
  graphBuild, graphFanPlace, graphLayoutTiers, graphLayout, graphSignature, graphLayoutCacheClear, graphRadius, graphVisibleIds,
} = require('../web/graph-model');
const {
  STATUSES, HIERARCHY, CTX, loadBoard, cleanUp, card, drawnModel, buildOf,
} = require('./helpers/fan-boards');

// The tier fan's geometry: where the positions, bands, sectors and the Unnested
// block of graphLayoutTiers come to, and what makes its cache key. The place of
// each card (graphFanPlace) is pinned in graph-fan.test.js.

after(cleanUp);

const planModel = (opts) => drawnModel(loadBoard('plan'), opts);
const fanOf = (m) => graphLayoutTiers(m, { statuses: STATUSES, unnested: 'table' });
const places = (m) => graphFanPlace(m, { statuses: STATUSES }).places;
const radius = (l, id) => Math.hypot(l.pos.get(id).x, l.pos.get(id).y);
const turnOf = (l, p) => {
  const a = Math.atan2(p.y, p.x);
  return a < l.fan.to - 1e-9 ? a + 2 * Math.PI : a;
};
const angleOf = (l, id) => turnOf(l, l.pos.get(id));
const finiteLayout = (l) => [...l.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  && Object.values(l.bounds).every(Number.isFinite);
const kidsOf = (root, n, first) => Array.from({ length: n }, (_, i) => card(first + i, { parent: root }));

// --- bands and rings -----------------------------------------------------------------

test('fan: every dot of a tier sits closer to the centre than every dot of the next tier, and the cards with no tier sit outside every tier band', () => {
  const m = planModel();
  const l = fanOf(m);
  const tierOf = (id) => ({ goal: 0, strategy: 1, objective: 2, epic: 3 })[m.byId.get(id).card.type];
  const byTier = [0, 1, 2, 3].map((t) => m.nodes.filter((n) => tierOf(n.id) === t).map((n) => radius(l, n.id)));
  assert.deepStrictEqual(byTier.map((rs) => rs.length), [2, 2, 1, 1]);
  for (let t = 0; t < 3; t++) assert.ok(Math.max(...byTier[t]) < Math.min(...byTier[t + 1]), `tier ${t + 1} is inside tier ${t + 2}`);
  const outerTier = l.bands[3].r1;
  const untiered = m.nodes.filter((n) => tierOf(n.id) === undefined);
  assert.ok(untiered.length > 15);
  for (const n of untiered) assert.ok(radius(l, n.id) > outerTier, `card ${n.id} is outside the tier bands`);
});

test('fan: each band is a stretch of radius that holds its dots, tier 1 first, with no gap and no overlap', () => {
  const m = planModel();
  const l = fanOf(m);
  const place = graphFanPlace(m, { statuses: STATUSES });
  assert.deepStrictEqual(l.bands.map((b) => b.index), place.bands.map((b) => b.index));
  for (let i = 0; i < l.bands.length; i++) {
    const b = l.bands[i];
    assert.ok(b.r1 > b.r0, `band ${i}`);
    if (i) assert.strictEqual(b.r0, l.bands[i - 1].r1, `band ${i} starts where the one inside it ends`);
    assert.strictEqual(b.rings.length, Math.max(1, b.subs));
    for (const r of b.rings) assert.ok(r > b.r0 && r < b.r1);
  }
  for (const n of m.nodes) {
    const p = place.places.get(n.id);
    if (p.sector === null) continue;
    const band = l.bands.find((b) => b.index === p.band);
    assert.ok(Math.abs(radius(l, n.id) - band.rings[p.sub]) < 1e-6, `card ${n.id} is on the ring of its band`);
  }
});

test('fan: a tier nobody is in keeps a thin band, and a ring is drawn through every row of dots', () => {
  const l = fanOf(buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })], ['goal', 'epic']));
  assert.deepStrictEqual(l.bands.map((b) => b.count), [0, 1, 1]);
  const [goal, epic] = l.bands;
  assert.ok(goal.r1 - goal.r0 > 0 && goal.r1 - goal.r0 < epic.r1 - epic.r0, 'the empty band is thinner than one with a card in it');
  assert.deepStrictEqual(l.rings.map((r) => r.label), ['goal', 'epic', 'depth 1']);
  assert.deepStrictEqual(l.rings.map((r) => r.r), l.bands.flatMap((b) => b.rings));
});

test('fan: a tier whose cards nest in one another gets a ring for each level, labelled', () => {
  const l = fanOf(buildOf([card(1, { type: 'epic' }), card(2, { type: 'epic', parent: 1 })], ['epic']));
  assert.deepStrictEqual(l.rings.map((r) => r.label), ['epic', 'epic 2']);
  assert.ok(radius(l, 1) < radius(l, 2));
});

test('fan: without a hierarchy the bands are the depth rings in depth order, and loose cards are in the block', () => {
  const m = buildOf([
    card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 2 }), card(5), card(6),
  ], []);
  const l = fanOf(m);
  assert.deepStrictEqual(l.bands.map((b) => b.slice.depth), [0, 1, 2]);
  assert.deepStrictEqual(l.rings.map((r) => r.label), ['roots', 'depth 1', 'depth 2']);
  const radii = [1, 2, 4].map((id) => radius(l, id));
  assert.deepStrictEqual(radii, [...radii].sort((a, b) => a - b));
  assert.ok(Math.abs(radius(l, 2) - radius(l, 3)) < 1e-9, 'siblings share a ring');
  for (const id of [5, 6]) assert.ok(radius(l, id) > l.bands[2].r1, `loose card ${id} is outside the rings`);
  assert.deepStrictEqual(l.block.columns.map((c) => c.ids), [[5, 6]]);
});

// --- sectors ---------------------------------------------------------------------------

test('fan: each tree sits in its own stretch of the fan, in order, and a card sits between its children', () => {
  const m = buildOf([
    card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 2 }), card(5, { parent: 2 }),
    card(6), card(7, { parent: 6 }), card(8, { parent: 6 }),
  ], []);
  const l = fanOf(m);
  assert.strictEqual(l.sectors.length, 2);
  const [a, b] = l.sectors;
  assert.ok(a.from > a.to && b.from > b.to, 'a sector runs from its left edge round to its right edge');
  assert.ok(a.to > b.from, 'the first tree is left of the second, with a gap between');
  const within = (id, s) => angleOf(l, id) <= s.from + 1e-9 && angleOf(l, id) >= s.to - 1e-9;
  for (const id of [1, 2, 3, 4, 5]) assert.ok(within(id, a), `card ${id} is in the first sector`);
  for (const id of [6, 7, 8]) assert.ok(within(id, b), `card ${id} is in the second sector`);
  assert.ok(angleOf(l, 2) < angleOf(l, 4) && angleOf(l, 2) > angleOf(l, 5), 'a parent is between its children');
  assert.ok(angleOf(l, 4) > angleOf(l, 5), 'siblings follow the outline, left to right');
  assert.ok(angleOf(l, 2) > angleOf(l, 3), 'and so do the children of one parent and its sibling');
});

test('fan: the sectors share the whole circle but a narrow seam straight up, where the captions stand', () => {
  const m = planModel();
  const l = fanOf(m);
  const sweep = l.fan.from - l.fan.to;
  assert.ok(sweep > 1.9 * Math.PI && sweep < 2 * Math.PI, `the fan sweeps ${sweep} radians, all but the seam`);
  assert.ok(Math.abs((l.fan.from + l.fan.to) / 2 - Math.PI / 2) < 1e-9, 'the sweep is centred on the bottom, so the seam is on the top');
  for (const s of l.sectors) assert.ok(s.from <= l.fan.from + 1e-9 && s.to >= l.fan.to - 1e-9);
  const cards = [];
  let id = 1;
  for (let t = 0; t < 8; t++) {
    const root = id++;
    cards.push(card(root));
    for (let k = 0; k < 5; k++) cards.push(card(id++, { parent: root }));
  }
  const crowd = fanOf(buildOf(cards, []));
  const quadrant = (p) => `${p.x < 0 ? 'left' : 'right'} ${p.y < 0 ? 'top' : 'bottom'}`;
  assert.deepStrictEqual([...new Set([...crowd.pos.values()].map(quadrant))].sort(), ['left bottom', 'left top', 'right bottom', 'right top']);
});

test('fan: a tier band, a depth ring, the sector of a tree and the sector of loose cards with a tier each spread their dots over the whole circle', () => {
  const quarters = (l, ids) => [...new Set(ids.map((id) => `${l.pos.get(id).x < 0 ? 'left' : 'right'} ${l.pos.get(id).y < 0 ? 'top' : 'bottom'}`))].sort();
  const all = ['left bottom', 'left top', 'right bottom', 'right top'];
  const goals = Array.from({ length: 12 }, (_, i) => [card(100 + 2 * i, { type: 'goal' }), card(101 + 2 * i, { parent: 100 + 2 * i })]).flat();
  const loose = Array.from({ length: 12 }, (_, i) => card(300 + i, { type: 'epic' }));
  const one = [card(1, { type: 'goal' }), ...kidsOf(1, 40, 2)];
  const crowd = fanOf(buildOf(goals));
  assert.deepStrictEqual(quarters(crowd, goals.filter((c) => c.type === 'goal').map((c) => c.id)), all, 'the goal band');
  assert.deepStrictEqual(quarters(crowd, goals.filter((c) => c.type !== 'goal').map((c) => c.id)), all, 'the ring of depth 1');
  assert.deepStrictEqual(quarters(fanOf(buildOf(loose)), loose.map((c) => c.id)), all, 'the loose sector');
  assert.deepStrictEqual(quarters(fanOf(buildOf(one)), one.slice(1).map((c) => c.id)), all, 'the sector of one tree');
  for (const l of [crowd, fanOf(buildOf(loose)), fanOf(buildOf(one))]) assert.ok(finiteLayout(l));
});

test('fan: a lone tree sits opposite the seam, its root at the bottom and its children either side, the outline running left to right along the bottom', () => {
  const m = buildOf([card(1), card(2, { parent: 1 }), card(3, { parent: 1 })], []);
  const l = fanOf(m);
  assert.ok(Math.abs(l.pos.get(1).x) < 1e-6 && l.pos.get(1).y > 0, 'the root is straight down');
  assert.ok(l.pos.get(2).x < 0 && l.pos.get(3).x > 0);
});

test('fan: a sector\'s share of the fan follows its leaf count', () => {
  const m = buildOf([card(1), ...kidsOf(1, 12, 10), card(2), ...kidsOf(2, 4, 30)], []);
  const l = fanOf(m);
  assert.deepStrictEqual(l.sectors.map((s) => s.leaves), [12, 4]);
  const width = (s) => s.from - s.to;
  assert.ok(Math.abs(width(l.sectors[0]) / width(l.sectors[1]) - 3) < 1e-9, `${width(l.sectors[0])} over ${width(l.sectors[1])}`);
});

test('fan: loose cards with a tier share a sector of their own, apart from every tree, each in its own tier band', () => {
  const m = planModel();
  const l = fanOf(m);
  assert.deepStrictEqual(l.sectors.map((s) => s.kind), ['tree', 'loose']);
  const [tree, loose] = l.sectors;
  assert.ok(tree.to > loose.from, 'the loose sector is right of the tree');
  assert.ok(angleOf(l, 26) <= loose.from + 1e-9 && angleOf(l, 26) >= loose.to - 1e-9);
  for (const n of m.nodes.filter((x) => places(m).get(x.id).sector === 0)) assert.ok(angleOf(l, n.id) >= tree.to - 1e-9, `card ${n.id} is not in the loose sector`);
  const band = l.bands.find((b) => b.index === 1);
  assert.ok(radius(l, 26) > band.r0 && radius(l, 26) < band.r1, 'the loose strategy is in the strategy band');
});

test('fan: dividers run between sectors, and a single sector needs none', () => {
  const two = fanOf(buildOf([card(1), card(2, { parent: 1 }), card(3), card(4, { parent: 3 })], []));
  assert.strictEqual(two.spokes.length, 1);
  assert.ok(two.spokes[0].angle < two.sectors[0].to && two.spokes[0].angle > two.sectors[1].from, 'the divider is in the gap');
  assert.ok(two.spokes[0].r1 > two.bands[two.bands.length - 1].r1);
  assert.strictEqual(fanOf(buildOf([card(1), card(2, { parent: 1 })], [])).spokes.length, 0);
});

test('fan: an archived card stays out of the fan until the Archive status pill shows it, and then takes the place of its slice', () => {
  const board = loadBoard('plan');
  const filter = (archive) => ({ backlog: true, todo: true, doing: true, done: true, archive });
  const fanWith = (archive) => {
    const m = graphBuild(board.all, { ctx: board.ctx, hierarchy: board.config.hierarchy, visibleIds: graphVisibleIds(board.all, null, filter(archive), STATUSES) });
    return { m, l: fanOf(m) };
  };
  const hidden = fanWith(false);
  for (const id of [19, 20, 21]) assert.ok(!hidden.l.pos.has(id), `archived card ${id} is not drawn`);
  const shown = fanWith(true);
  for (const id of [19, 20, 21]) assert.ok(shown.l.pos.has(id), `archived card ${id} is drawn`);
  assert.ok(Math.abs(radius(shown.l, 19) - radius(shown.l, 8)) < 1e-6, 'archived 19 is at depth 2, on the ring of card 8');
  assert.deepStrictEqual(shown.l.block.columns.map((c) => c.label), ['backlog', 'todo', 'doing', 'done', 'archived']);
  assert.deepStrictEqual(shown.l.block.columns[4].ids, [20, 21]);
});

// --- the Unnested block ------------------------------------------------------------------

test('fan: the Unnested block holds a column per status, outside the fan, its cards at least a dot apart', () => {
  const m = planModel();
  const l = fanOf(m);
  const outer = l.bands[l.bands.length - 1].r1;
  assert.deepStrictEqual(l.block.columns.map((c) => c.label), ['backlog', 'todo', 'doing', 'done']);
  for (const col of l.block.columns) {
    for (const id of col.ids) {
      const p = l.pos.get(id);
      assert.ok(p.x >= l.block.x + col.x && p.x <= l.block.x + col.x + col.w, `card ${id} is inside its column`);
      assert.ok(p.y >= l.block.y && p.y <= l.block.y + l.block.h, `card ${id} is inside the block`);
    }
  }
  for (let i = 1; i < l.block.columns.length; i++) {
    assert.ok(l.block.columns[i].x >= l.block.columns[i - 1].x + l.block.columns[i - 1].w - 1e-9, 'columns follow the status order and do not overlap');
  }
  for (const n of m.nodes.filter((x) => places(m).get(x.id).block)) assert.ok(radius(l, n.id) > outer + 20, `card ${n.id} is clear of the rim`);
  const ids = l.block.columns.flatMap((c) => c.ids);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = l.pos.get(ids[i]);
      const b = l.pos.get(ids[j]);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 16, `${ids[i]} and ${ids[j]}`);
    }
  }
  assert.strictEqual(fanOf(buildOf([card(1), card(2, { parent: 1 })], [])).block, null);
});

test('fan: a board of loose cards only draws the block alone, centred under the centre', () => {
  const l = fanOf(buildOf([card(1), card(2), card(3, { status: 'done' })], []));
  assert.strictEqual(l.bands.length, 0);
  assert.strictEqual(l.rings.length, 0);
  assert.ok(l.block.x < 0 && l.block.x + l.block.w > 0);
  assert.ok(finiteLayout(l));
});

// --- any board -----------------------------------------------------------------------------

test('fan: positions are deterministic and finite, on zero, one and many cards', () => {
  const m = planModel();
  assert.deepStrictEqual(JSON.stringify([...fanOf(m).pos]), JSON.stringify([...fanOf(m).pos]));
  assert.ok(finiteLayout(fanOf(m)));
  assert.ok(finiteLayout(fanOf(buildOf([]))));
  assert.ok(finiteLayout(fanOf(buildOf([card(1, { type: 'goal' })]))));
  assert.ok(finiteLayout(fanOf(buildOf([card(1)]))));
});

test('fan: a 6000-deep parent chain lays out without recursing', () => {
  const cards = [card(1)];
  for (let i = 2; i <= 6000; i++) cards.push(card(i, { parent: i - 1 }));
  const l = fanOf(buildOf(cards, []));
  assert.strictEqual(l.pos.size, 6000);
  assert.ok(finiteLayout(l));
  assert.strictEqual(l.bands.length, 6000);
});

test('fan: 150 siblings under one root keep neighbours on their ring apart', () => {
  const m = buildOf([card(1), ...kidsOf(1, 150, 2)], []);
  const l = fanOf(m);
  assert.ok(finiteLayout(l));
  const kids = m.nodes.filter((n) => n.parentId === 1).map((n) => l.pos.get(n.id));
  kids.sort((p, q) => turnOf(l, q) - turnOf(l, p));
  for (let i = 0; i + 1 < kids.length; i++) assert.ok(Math.hypot(kids[i].x - kids[i + 1].x, kids[i].y - kids[i + 1].y) >= 14, `gap ${i}`);
});

test('fan: no two dots on the rings overlap, on a crowded board with parents of every size', () => {
  const cards = [];
  let id = 1;
  for (let t = 0; t < 14; t++) {
    const root = id++;
    cards.push(card(root, { type: t % 3 ? undefined : 'goal' }));
    for (let k = 0; k < 1 + ((t * 7) % 9); k++) {
      const mid = id++;
      cards.push(card(mid, { parent: root }));
      for (let j = 0; j < (k + t) % 5; j++) cards.push(card(id++, { parent: mid, type: j % 2 ? 'epic' : undefined }));
    }
  }
  const m = buildOf(cards);
  const l = fanOf(m);
  const ring = m.nodes.filter((n) => places(m).get(n.id).sector !== null);
  assert.ok(ring.length > 120, `${ring.length} cards on the rings`);
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const a = l.pos.get(ring[i].id);
      const b = l.pos.get(ring[j].id);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= graphRadius(ring[i]) + graphRadius(ring[j]), `${ring[i].id} overlaps ${ring[j].id}`);
    }
  }
});

test('fan: the bounds hold every dot, ring and the block', () => {
  const m = planModel();
  const l = fanOf(m);
  for (const n of m.nodes) {
    const p = l.pos.get(n.id);
    const r = graphRadius(n);
    assert.ok(p.x - r >= l.bounds.x0 && p.x + r <= l.bounds.x1 && p.y - r >= l.bounds.y0 && p.y + r <= l.bounds.y1, `card ${n.id}`);
  }
  assert.ok(l.bounds.y1 >= l.block.y + l.block.h - 1e-6);
});

// --- the cache key --------------------------------------------------------------------------

test('cache: the layout\'s key changes when a card\'s type or the hierarchy changes, and not when only a sticker does', () => {
  graphLayoutCacheClear();
  const cards = (type) => [card(1, { type }), card(2, { parent: 1 }), card(3)];
  const key = (cs, hierarchy) => graphSignature(buildOf(cs, hierarchy), 'tiers', { statuses: STATUSES });
  assert.notStrictEqual(key(cards('goal'), HIERARCHY), key(cards('epic'), HIERARCHY), 'a card\'s type');
  assert.notStrictEqual(key(cards('goal'), HIERARCHY), key(cards('goal'), ['epic', 'goal']), 'the hierarchy\'s order');
  assert.notStrictEqual(key(cards('goal'), HIERARCHY), key(cards('goal'), []), 'the hierarchy itself');
  assert.notStrictEqual(key(cards('goal'), HIERARCHY), key(cards('goal'), ['Goal', 'strategy', 'objective', 'epic']), 'the spelling of a tier, which names its band');
  assert.notStrictEqual(key([card(1, { type: 'story' })], []), key([card(1, { type: 'task' })], []), 'a type that is in no hierarchy');
  assert.strictEqual(key(cards('goal'), HIERARCHY), key(cards('GOAL'), HIERARCHY), 'a type compares without regard to case, as a tier does');
  const sticky = cards('goal');
  sticky[2] = { ...sticky[2], blocked: 'no reply', review: true };
  assert.strictEqual(key(cards('goal'), HIERARCHY), key(sticky, HIERARCHY), 'blocked and review change a colour, not a place');
  const first = graphLayout(buildOf(cards('goal')), 'tiers', { statuses: STATUSES });
  assert.notStrictEqual(graphLayout(buildOf(cards('epic')), 'tiers', { statuses: STATUSES }), first, 'an edit redraws');
  assert.strictEqual(graphLayout(buildOf(cards('goal')), 'tiers', { statuses: STATUSES }), first, 'the same cards reuse the layout');
});

test('fan: the icon a type draws with moves no dot, so editing it does not redraw the fan, yet the widest outline still clears its neighbours', () => {
  const cards = [card(1, { type: 'goal' }), ...kidsOf(1, 30, 2).map((c) => ({ ...c, type: 'epic' }))];
  const layout = (icons) => fanOf(graphBuild(cards, { ctx: CTX, hierarchy: HIERARCHY, types: icons }));
  const star = layout([{ name: 'goal', color: '', icon: 'star' }, { name: 'epic', color: '', icon: 'star' }]);
  const round = layout([{ name: 'goal', color: '' }, { name: 'epic', color: '' }]);
  assert.deepStrictEqual([...star.pos], [...round.pos]);
  const m = graphBuild(cards, { ctx: CTX, hierarchy: HIERARCHY });
  const kids = m.nodes.filter((n) => n.parentId === 1).map((n) => star.pos.get(n.id));
  kids.sort((p, q) => turnOf(star, q) - turnOf(star, p));
  const starReach = 1.4 * graphRadius(m.byId.get(2));
  for (let i = 0; i + 1 < kids.length; i++) assert.ok(Math.hypot(kids[i].x - kids[i + 1].x, kids[i].y - kids[i + 1].y) >= 2 * starReach, `stars ${i} and ${i + 1} do not touch`);
});

test('cache: a hidden parent changes the key, since it moves its child to another band', () => {
  const withParent = graphSignature(buildOf([card(2, { parent: 1 }), card(1)], [], [2]), 'tiers', {});
  const noParent = graphSignature(buildOf([card(2)], [], [2]), 'tiers', {});
  assert.notStrictEqual(withParent, noParent, 'card 2 is drawn as a root in both, but at depth 1 in one and depth 0 in the other');
});

test('cache: the force and status layouts keep the key they had, so a type edit does not lose a dragged arrangement', () => {
  const a = buildOf([card(1, { type: 'goal' }), card(2)], HIERARCHY);
  const b = buildOf([card(1, { type: 'epic' }), card(2)], []);
  for (const kind of ['force', 'status']) assert.strictEqual(graphSignature(a, kind, { statuses: STATUSES }), graphSignature(b, kind, { statuses: STATUSES }), kind);
});
