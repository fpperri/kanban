const { test, after } = require('node:test');
const assert = require('node:assert');

const {
  graphBuild, graphUnnestedIds, graphFanPlace, graphLayoutTiers, graphLayout, graphSignature, graphLayoutCacheClear, graphRadius, graphPlan, graphFit,
} = require('../web/graph-model');
const {
  STATUSES, HIERARCHY, CTX, loadBoard, cleanUp, card, drawnModel, rootShapedCards, captionRects, clashes,
} = require('./helpers/fan-boards');

// The tier fan's Unnested option: where the cards with no parent, no children and no
// tier are drawn. off leaves them out of the Graph and every relation to a card that is
// drawn with them; outermost, depth 0 and table are the layouts (below). The plan board
// is the browser runner's own fixture, so what is asserted about its cards is what the
// runner sees on the page.

after(cleanUp);

// A board whose hierarchy is goal, strategy, objective, epic:
//   1 goal, with 2 under it and 3 under 2     one tree
//   4 epic, alone                             a loose card with a tier
//   5, 6, 7, 8 alone, no tier                 unnested (todo, doing, done, todo)
//   9 alone, no tier, archived                unnested too
//   10 under card 11, which is not on the board   no children and no parent drawn: unnested
// Card 6 waits for card 2 and card 3 waits for card 5, so a relation joins an unnested
// card to a drawn one each way.
const cards = () => [
  card(1, { type: 'goal' }),
  card(2, { parent: 1, status: 'doing' }),
  card(3, { parent: 2, waiting_for: ['5'], status: 'backlog' }),
  card(4, { type: 'epic', status: 'doing' }),
  card(5, { status: 'todo' }),
  card(6, { status: 'doing', waiting_for: ['2'] }),
  card(7, { status: 'done' }),
  card(8, { status: 'todo' }),
  card(9, { status: 'done', archived: true }),
  card(10, { status: 'todo', parent: 11 }),
];
const build = (extra = {}) => graphBuild(cards(), { ctx: CTX, hierarchy: HIERARCHY, ...extra });
const ids = (m) => m.nodes.map((n) => n.id).sort((a, b) => a - b);
const rel = (m) => m.links.map((l) => `${l.from}${l.kind === 'wait' ? '~' : '>'}${l.to}`).sort();

// --- off ------------------------------------------------------------------------------------------

test('off: the model leaves out every card with no relative and no tier, archived or not, and the relations that joined them to a drawn card', () => {
  const all = build();
  assert.deepStrictEqual(ids(all), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 'asked for nothing, the model draws every card');
  assert.deepStrictEqual(rel(all), ['1>2', '2>3', '2~6', '5~3']);
  const off = build({ unnested: 'off' });
  assert.deepStrictEqual(ids(off), ['1', '2', '3', '4'], 'the tree and the loose card with a tier stay');
  assert.deepStrictEqual(rel(off), ['1>2', '2>3'], 'no relation to a card that is not drawn');
});

test('off: what a card is does not change with its neighbours leaving: it stays waiting, keeps its slice and its degree counts what is drawn', () => {
  const all = build();
  const off = build({ unnested: 'off' });
  assert.strictEqual(off.byId.get('3').waiting, true, 'card 3 still waits for card 5, which is not drawn');
  for (const n of off.nodes) {
    assert.strictEqual(n.sliceIndex, all.byId.get(n.id).sliceIndex, `card ${n.id}`);
    assert.strictEqual(n.nested, all.byId.get(n.id).nested, `card ${n.id}`);
  }
  assert.strictEqual(all.byId.get('3').deg, 2);
  assert.strictEqual(off.byId.get('3').deg, 1, 'the arrow to card 5 is not drawn, so it does not count');
  assert.strictEqual(off.byId.get('2').deg, 2, 'card 2 keeps its parent and its child');
  assert.deepStrictEqual(off.axis, all.axis, 'the board\'s axis is the whole board\'s');
});

test('off: any other mode, or none, draws the cards: only off hides them', () => {
  for (const unnested of ['outermost', 'depth 0', 'table', undefined, 'every']) {
    assert.deepStrictEqual(ids(build({ unnested })), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], String(unnested));
  }
});

test('off: a card the search or a status pill hides is not drawn either way, and one that is drawn but unnested leaves', () => {
  const off = build({ unnested: 'off', visibleIds: new Set(['1', '2', '3', '5', '6']) });
  assert.deepStrictEqual(ids(off), ['1', '2', '3']);
  assert.deepStrictEqual(rel(off), ['1>2', '2>3']);
});

test('off: a card whose only relative is hidden is still nested, so hiding the relative never moves it into the cards that off leaves out', () => {
  const m = build({ unnested: 'off', visibleIds: new Set(['1', '3', '4', '5']) });
  assert.deepStrictEqual(ids(m), ['1', '3', '4'], 'card 2 is hidden by the search, card 3 keeps its place in the tree and card 5 goes');
});

test('graphUnnestedIds: the cards with no parent, no children and no tier on the whole board, whatever is drawn', () => {
  assert.deepStrictEqual([...graphUnnestedIds(cards(), { ctx: CTX, hierarchy: HIERARCHY })].sort((a, b) => a - b), ['5', '6', '7', '8', '9', '10']);
  assert.deepStrictEqual([...graphUnnestedIds(cards(), { ctx: CTX, hierarchy: [] })].sort((a, b) => a - b), ['4', '5', '6', '7', '8', '9', '10'], 'with no hierarchy a card with no tier is every card with no relative, the epic 4 among them');
  assert.deepStrictEqual([...graphUnnestedIds([], { ctx: CTX, hierarchy: HIERARCHY })], []);
  assert.deepStrictEqual([...graphUnnestedIds(undefined, { ctx: CTX })], []);
});

test('graphUnnestedIds is what off leaves out, on the plan board and a board with no hierarchy', () => {
  for (const key of ['plan', 'fixture', 'malformed']) {
    const board = loadBoard(key);
    const opts = { ctx: board.ctx, hierarchy: board.config.hierarchy };
    const whole = graphBuild(board.all, opts);
    const off = graphBuild(board.all, { ...opts, unnested: 'off' });
    const left = new Set(whole.nodes.map((n) => n.id).filter((id) => !off.byId.has(id)));
    assert.deepStrictEqual([...left].sort((a, b) => a - b), [...graphUnnestedIds(board.all, opts)].sort((a, b) => a - b), key);
  }
  const plan = loadBoard('plan');
  assert.deepStrictEqual([...graphUnnestedIds(plan.all, { ctx: plan.ctx, hierarchy: plan.config.hierarchy })].sort((a, b) => a - b), ['9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '20', '21', '27', '28', '29']);
});

// --- depth 0 ----------------------------------------------------------------------------------------

const place = (m, unnested) => graphFanPlace(m, { statuses: STATUSES, unnested });
const bandName = (b) => (b.slice.kind === 'tier' ? b.slice.name : `depth ${b.slice.depth}`);
const bandNames = (p) => p.bands.map(bandName);
const radius = (l, id) => Math.hypot(l.pos.get(id).x, l.pos.get(id).y);
const turnOf = (l, p) => {
  const a = Math.atan2(p.y, p.x);
  return a < l.fan.to - 1e-9 ? a + 2 * Math.PI : a;
};
const PLAN_UNNESTED = ['9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '27', '28', '29'];

test('depth 0: the cards go on the depth 0 ring, which the axis puts after the tier bands and before depth 1', () => {
  const m = build();
  const there = place(m, 'depth 0');
  assert.deepStrictEqual(bandNames(there), ['goal', 'strategy', 'objective', 'epic', 'depth 0', 'depth 1', 'depth 2']);
  assert.deepStrictEqual(there.bands.map((b) => b.count), [1, 0, 0, 1, 6, 1, 1], 'the six cards are the depth 0 ring\'s own');
  const ring = there.bands.find((b) => b.slice.kind === 'depth' && b.slice.depth === 0);
  for (const id of [5, 6, 7, 8, 9, 10]) {
    const at = there.places.get(id);
    assert.strictEqual(at.block, null, `card ${id} is in no block`);
    assert.strictEqual(at.band, ring.index, `card ${id} is in the depth 0 band`);
    assert.strictEqual(at.sub, 0, `card ${id} is on the band's one ring`);
  }
  assert.strictEqual(ring.subs, 1);
  assert.deepStrictEqual(there.columns, [], 'there is no block to draw');
});

test('depth 0: they share a sector of their own, after the trees and the loose cards with a tier, whose cards they never mix with', () => {
  const m = build();
  const there = place(m, 'depth 0');
  assert.deepStrictEqual(there.sectors.map((s) => s.kind), ['tree', 'loose', 'unnested']);
  const own = there.sectors[2];
  assert.deepStrictEqual(own.tops, ['5', '6', '7', '8', '9', '10']);
  assert.strictEqual(own.leaves, 6);
  assert.strictEqual(own.rootId, null);
  for (const id of own.tops) assert.strictEqual(there.places.get(id).sector, 2, `card ${id}`);
  assert.strictEqual(there.places.get('4').sector, 1, 'the loose card with a tier keeps its sector');
  assert.strictEqual(there.places.get('1').sector, 0);
});

test('depth 0: with none, there is no sector and no ring for them, and nothing else moves', () => {
  const m = graphBuild(cards().filter((c) => c.id <= 4), { ctx: CTX, hierarchy: HIERARCHY });
  const there = place(m, 'depth 0');
  assert.deepStrictEqual(there.sectors.map((s) => s.kind), ['tree', 'loose']);
  assert.deepStrictEqual(bandNames(there), ['goal', 'strategy', 'objective', 'epic', 'depth 1', 'depth 2']);
});

test('every other mode keeps them out of the rings, in the status columns the block and the outermost ring read', () => {
  const m = build();
  const table = place(m, 'table');
  for (const unnested of ['outermost', 'off', undefined, 'every']) {
    const other = place(m, unnested);
    assert.deepStrictEqual([...other.places], [...table.places], String(unnested));
    assert.deepStrictEqual(other.columns.map((c) => [c.label, c.ids]), table.columns.map((c) => [c.label, c.ids]), String(unnested));
    assert.deepStrictEqual(other.sectors.map((s) => s.kind), ['tree', 'loose'], String(unnested));
  }
  assert.deepStrictEqual(table.columns.map((c) => [c.label, c.ids]), [['todo', ['5', '8', '10']], ['doing', ['6']], ['done', ['7']], ['archived', ['9']]]);
  assert.deepStrictEqual(bandNames(table), ['goal', 'strategy', 'objective', 'epic', 'depth 1', 'depth 2']);
});

test('depth 0 on the plan board: the 13 cards fill the depth 0 ring, the only card of that depth, between the tier bands and depth 1', () => {
  const m = drawnModel(loadBoard('plan'));
  const there = place(m, 'depth 0');
  assert.deepStrictEqual(bandNames(there), ['goal', 'strategy', 'objective', 'epic', 'depth 0', 'depth 1', 'depth 2', 'depth 4', 'depth 5']);
  const ring = there.bands[4];
  assert.strictEqual(ring.count, PLAN_UNNESTED.length);
  assert.deepStrictEqual(m.nodes.filter((n) => there.places.get(n.id).band === ring.index).map((n) => n.id).sort((a, b) => a - b), PLAN_UNNESTED);
});

test('depth 0 draws them on one ring just outside the tier bands and inside depth 1, in their own stretch of the fan', () => {
  const m = drawnModel(loadBoard('plan'));
  const l = graphLayoutTiers(m, { statuses: STATUSES, unnested: 'depth 0' });
  assert.strictEqual(l.block, null);
  const rs = PLAN_UNNESTED.map((id) => radius(l, id));
  assert.ok(Math.max(...rs) - Math.min(...rs) < 1e-6, 'one ring');
  assert.ok(Math.min(...rs) > l.bands[3].r1, 'outside the tier bands');
  const depth1 = ['3', '4', '5', '6'].map((id) => radius(l, id));
  assert.ok(Math.max(...rs) < Math.min(...depth1), 'inside depth 1');
  const own = l.sectors.find((s) => s.kind === 'unnested');
  assert.deepStrictEqual(own.tops.slice().sort((a, b) => a - b), PLAN_UNNESTED);
  for (const id of PLAN_UNNESTED) {
    const a = turnOf(l, l.pos.get(id));
    assert.ok(a <= own.from + 1e-9 && a >= own.to - 1e-9, `card ${id} is in its sector`);
  }
  for (const s of l.sectors.filter((x) => x !== own)) {
    assert.ok(s.to >= own.from - 1e-9 || s.from <= own.to + 1e-9, 'sectors do not overlap');
  }
  assert.ok([...l.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  for (let i = 0; i < PLAN_UNNESTED.length; i++) {
    for (let j = i + 1; j < PLAN_UNNESTED.length; j++) {
      const a = l.pos.get(PLAN_UNNESTED[i]);
      const b = l.pos.get(PLAN_UNNESTED[j]);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 14, `${PLAN_UNNESTED[i]} and ${PLAN_UNNESTED[j]}`);
    }
  }
});

test('depth 0 captions the ring as depth 0 does: depth 0, with the cards of the ring counted in its tip, and no Unnested block', () => {
  const m = drawnModel(loadBoard('plan'));
  const l = graphLayoutTiers(m, { statuses: STATUSES, unnested: 'depth 0' });
  const cap = l.captions.find((c) => c.name === 'depth 0');
  assert.strictEqual(cap.count, PLAN_UNNESTED.length);
  assert.deepStrictEqual(cap.split, [['backlog', 4], ['todo', 4], ['doing', 2], ['done', 3]]);
  assert.strictEqual(cap.term, 'slice:0');
  assert.strictEqual(l.block, null);
});

// --- outermost ----------------------------------------------------------------------------------------

const PLAN_BY_STATUS = [['11', '14', '18', '28'], ['10', '13', '17', '27'], ['9', '15'], ['12', '16', '29']];
const outermost = (m, extra = {}) => graphLayoutTiers(m, { statuses: STATUSES, unnested: 'outermost', ...extra });
const planAll = () => {
  const board = loadBoard('plan');
  return graphBuild(board.all, { ctx: board.ctx, hierarchy: board.config.hierarchy });
};
// The cards of the ring in the order the fan seats them: from the left of the seam, round.
const seated = (l, ids) => ids.slice().sort((a, b) => turnOf(l, l.pos.get(b)) - turnOf(l, l.pos.get(a)));
const ringBand = (l) => l.bands[l.bands.length - 1];

test('outermost: the cards sit on one ring outside every other dot and every band, the guide of the last band', () => {
  const m = drawnModel(loadBoard('plan'));
  const l = outermost(m);
  const rs = PLAN_UNNESTED.map((id) => radius(l, id));
  assert.ok(Math.max(...rs) - Math.min(...rs) < 1e-6, 'one ring');
  const rest = m.nodes.filter((n) => !PLAN_UNNESTED.includes(n.id));
  assert.ok(rest.length > 10);
  for (const n of rest) assert.ok(radius(l, n.id) < Math.min(...rs), `card ${n.id} is inside the ring`);
  const last = ringBand(l);
  assert.deepStrictEqual(last.rings, [rs[0]], 'the ring is the last band, its own radius the cards\'');
  const before = l.bands[l.bands.length - 2];
  assert.ok(last.r0 >= before.r1 - 1e-9 && last.r1 > last.rings[0], 'it lies outside the band before it');
  assert.ok(rs[0] > before.r1, 'outside the deepest depth ring');
  assert.strictEqual(l.block, null, 'there is no block');
});

test('outermost is the default: a layout asked for no unnested mode draws the ring, and so does a stored mode this version does not offer', () => {
  const m = drawnModel(loadBoard('plan'));
  const set = new Set(PLAN_UNNESTED.map((id) => radius(graphLayoutTiers(m, { statuses: STATUSES }), id).toFixed(6)));
  assert.strictEqual(set.size, 1);
  assert.strictEqual(graphLayoutTiers(m, { statuses: STATUSES }).block, null);
  assert.strictEqual(graphLayoutTiers(m, { statuses: STATUSES, unnested: 'ring' }).block, null);
});

test('outermost groups the cards by status, in the board\'s order, round the ring from the left of the seam, archived ones last', () => {
  const m = drawnModel(loadBoard('plan'));
  const l = outermost(m);
  assert.deepStrictEqual(seated(l, PLAN_UNNESTED), PLAN_BY_STATUS.flat(), 'backlog, todo, doing, done, each in the outline\'s order');
  const withArchived = planAll();
  const all = outermost(withArchived);
  assert.deepStrictEqual(seated(all, PLAN_UNNESTED.concat(['20', '21'])), PLAN_BY_STATUS.flat().concat(['20', '21']), 'archived cards come last');
  assert.deepStrictEqual(ringBand(all).split.map(([s]) => s), ['backlog', 'todo', 'doing', 'done', 'archived']);
});

test('outermost keeps the cards a dot apart, and off the seam where the captions stand', () => {
  const l = outermost(drawnModel(loadBoard('plan')));
  for (let i = 0; i < PLAN_UNNESTED.length; i++) {
    const a = l.pos.get(PLAN_UNNESTED[i]);
    assert.ok(turnOf(l, a) <= l.fan.from + 1e-9 && turnOf(l, a) >= l.fan.to - 1e-9, `card ${PLAN_UNNESTED[i]} is not on the seam`);
    for (let j = i + 1; j < PLAN_UNNESTED.length; j++) {
      const b = l.pos.get(PLAN_UNNESTED[j]);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 14, `${PLAN_UNNESTED[i]} and ${PLAN_UNNESTED[j]}`);
    }
  }
});

test('outermost captions the ring unnested, last, on the seam level with the ring, and its tip counts the cards by status and names no slice', () => {
  const l = outermost(drawnModel(loadBoard('plan')));
  const cap = l.captions[l.captions.length - 1];
  assert.strictEqual(cap.name, 'unnested');
  assert.strictEqual(cap.count, PLAN_UNNESTED.length);
  assert.deepStrictEqual(cap.split, [['backlog', 4], ['todo', 4], ['doing', 2], ['done', 3]]);
  assert.strictEqual(cap.term, null, 'the ring is not a slice');
  assert.strictEqual(cap.y, -radius(l, PLAN_UNNESTED[0]), 'level with the ring');
  assert.deepStrictEqual(l.captions.map((c) => c.name), ['goal', 'strategy', 'objective', 'epic', 'depth 1', 'depth 2', 'depth 4', 'depth 5', 'unnested'], 'after the depth rings');
  assert.deepStrictEqual(l.rings.map((r) => r.label).slice(-1), ['unnested']);
});

// Whether every dot is clear of the text of the ring's caption (its box, as the layout gives it).
const clearOfCaption = (m, l) => {
  const cap = l.captions[l.captions.length - 1];
  const box = { x0: cap.side === 'right' ? cap.x : cap.x - cap.w, x1: cap.side === 'right' ? cap.x + cap.w : cap.x, y0: cap.y - cap.h / 2, y1: cap.y + cap.h / 2 };
  return m.nodes.filter((n) => {
    const p = l.pos.get(n.id);
    const near = { x: Math.max(box.x0, Math.min(p.x, box.x1)), y: Math.max(box.y0, Math.min(p.y, box.y1)) };
    return Math.hypot(p.x - near.x, p.y - near.y) <= graphRadius(n);
  }).map((n) => n.id);
};

test('outermost leaves the room for its caption: no dot of the ring is under the text, however many cards crowd the ring', () => {
  const plan = drawnModel(loadBoard('plan'));
  assert.deepStrictEqual(clearOfCaption(plan, outermost(plan)), []);
  for (const n of [1, 3, 8, 40, 150, 600]) {
    const crowd = Array.from({ length: n }, (_, i) => card(i + 1, { status: STATUSES[i % STATUSES.length] }));
    const m = graphBuild(crowd, { ctx: CTX, hierarchy: [] });
    assert.deepStrictEqual(clearOfCaption(m, outermost(m)), [], `${n} cards`);
  }
});

test('outermost: the loose caption stands outside the ring, and the bounds hold the ring, its dots and its caption', () => {
  const m = drawnModel(loadBoard('plan'));
  const l = outermost(m);
  const reach = radius(l, PLAN_UNNESTED[0]);
  assert.ok(Math.hypot(l.looseCaption.x, l.looseCaption.y) > reach, 'the caption of the loose cards with a tier is outside the ring');
  for (const n of m.nodes) {
    const p = l.pos.get(n.id);
    assert.ok(p.x - graphRadius(n) >= l.bounds.x0 && p.x + graphRadius(n) <= l.bounds.x1 && p.y - graphRadius(n) >= l.bounds.y0 && p.y + graphRadius(n) <= l.bounds.y1, `card ${n.id}`);
  }
  const r = ringBand(l).rings[0];
  assert.ok(l.bounds.x0 <= -r && l.bounds.x1 >= r && l.bounds.y0 <= -r && l.bounds.y1 >= r, 'the whole circle of the ring');
  const cap = l.captions[l.captions.length - 1];
  assert.ok(cap.y - cap.h / 2 >= l.bounds.y0);
});

test('outermost: the same cards, the same layout: deterministic, finite, and the same objects from the cache', () => {
  const m = drawnModel(loadBoard('plan'));
  assert.deepStrictEqual(JSON.stringify([...outermost(m).pos]), JSON.stringify([...outermost(m).pos]));
  const l = outermost(m);
  assert.ok([...l.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) && Object.values(l.bounds).every(Number.isFinite));
});

test('outermost grows its ring for a crowd: 150 cards stay a dot apart, off the seam, grouped by status', () => {
  const crowd = Array.from({ length: 150 }, (_, i) => card(i + 1, { status: STATUSES[(i * 7) % STATUSES.length] }));
  const m = graphBuild(crowd, { ctx: CTX, hierarchy: [] });
  const l = outermost(m);
  const ids = m.nodes.map((n) => n.id);
  for (let i = 0; i < ids.length; i++) {
    const a = l.pos.get(ids[i]);
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y));
    for (let j = i + 1; j < ids.length; j++) {
      const b = l.pos.get(ids[j]);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= graphRadius(m.byId.get(ids[i])) + graphRadius(m.byId.get(ids[j])), `${ids[i]} and ${ids[j]}`);
    }
  }
  const statusOf = (id) => STATUSES.indexOf(m.byId.get(id).status);
  const order = seated(l, ids).map(statusOf);
  assert.deepStrictEqual(order, order.slice().sort((a, b) => a - b), 'grouped by status in the board\'s order');
  assert.ok(radius(l, ids[0]) > 150 * 14 / (2 * Math.PI), 'the ring is as big as the crowd needs');
});

test('outermost: a board of unnested cards alone is a ring round the centre, with its caption, and no block', () => {
  const l = outermost(graphBuild([card(1), card(2), card(3, { status: 'done' })], { ctx: CTX, hierarchy: [] }));
  assert.strictEqual(l.block, null);
  assert.strictEqual(l.bands.length, 1);
  assert.deepStrictEqual(l.captions.map((c) => [c.name, c.count]), [['unnested', 3]]);
  assert.ok([...l.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.ok(radius(l, 1) > 60);
});

test('outermost: no unnested card, no ring and no caption', () => {
  const m = graphBuild(cards().filter((c) => c.id <= 4), { ctx: CTX, hierarchy: HIERARCHY });
  const l = outermost(m);
  assert.deepStrictEqual(l.captions.map((c) => c.name), ['goal', 'strategy', 'objective', 'epic', 'depth 1', 'depth 2']);
  assert.strictEqual(l.block, null);
  assert.strictEqual(l.bands.length, 6);
});

// --- what is drawn --------------------------------------------------------------------------------------

const OPTS = { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title };
const planFor = (unnested, m = drawnModel(loadBoard('plan'))) => graphPlan(m, graphLayoutTiers(m, { statuses: STATUSES, unnested }), OPTS);

test('outermost draws a guide arc and a caption for the ring beside the bands\', no block, and every dot where the layout put it', () => {
  const table = planFor('table');
  const ring = planFor('outermost');
  assert.strictEqual(ring.block, null);
  assert.ok(table.block, 'table has the block');
  assert.strictEqual(ring.guides.length, table.guides.length + 1, 'one guide arc more than the bands have');
  const cap = ring.captions[ring.captions.length - 1];
  assert.deepStrictEqual([cap.name, cap.count, cap.kind, cap.muted, cap.cls], ['unnested', 13, 'unnested', false, 'graph-caption']);
  assert.deepStrictEqual(cap.tip.lines, ['13 cards', 'backlog 4 · todo 4 · doing 2 · done 3']);
  assert.strictEqual(cap.tip.term, null, 'it cuts to no slice');
  assert.ok(Number.isFinite(cap.x) && Number.isFinite(cap.y));
  for (const id of PLAN_UNNESTED) {
    const n = ring.nodes.find((x) => x.id === id);
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `card ${id}`);
  }
  assert.ok(ring.guides.every((g) => !/NaN|undefined|Infinity/.test(g.d)));
});

test('outermost draws the relations of the cards on the ring as it draws every relation: from the card waited for to the card that waits', () => {
  const plan = planFor('outermost');
  const waits = plan.links.filter((l) => l.kind === 'wait');
  assert.ok(waits.some((l) => l.from === '5' && l.to === '27'), 'card 27 is on the ring and waits for card 5');
  for (const l of plan.links) assert.ok(!/NaN|undefined|Infinity/.test(l.d), `${l.from} to ${l.to}`);
});

test('depth 0 and table draw the loose caption beside what they always did, and the caption of the ring is the depth 0 band\'s, depth 0', () => {
  const m = drawnModel(loadBoard('plan'));
  const depth = planFor('depth 0', m);
  assert.deepStrictEqual(depth.captions.map((c) => c.name), ['goal', 'strategy', 'objective', 'epic', 'depth 0', 'depth 1', 'depth 2', 'depth 4', 'depth 5']);
  assert.strictEqual(depth.block, null);
  assert.ok(depth.dividers.length > planFor('table', m).dividers.length, 'the unnested sector is parted from its neighbour, one divider more');
  assert.ok(depth.looseCaption && depth.looseCaption.name === 'Unnested, with a tier');
  const table = planFor('table', m);
  assert.deepStrictEqual(table.block.title.name, 'Unnested');
  assert.strictEqual(table.captions.some((c) => c.name === 'unnested'), false);
});

// --- every mode on every board: the captions, and what Fit frames --------------------------------------------

const MODES = ['outermost', 'depth 0', 'off', 'table'];
const STAGES = [[1600, 800], [1280, 720], [1000, 700]];
const modelOf = (cards, ctx, hierarchy, mode, visible = null) => graphBuild(cards, { ctx, hierarchy, visibleIds: visible && new Set(visible), unnested: mode });
const BOARDS = () => {
  const plan = loadBoard('plan');
  const fixture = loadBoard('fixture');
  const malformed = loadBoard('malformed');
  const shaped = rootShapedCards();
  const live = (b) => b.live.map((c) => c.id);
  return {
    'the plan board': (mode) => modelOf(plan.all, plan.ctx, plan.config.hierarchy, mode, live(plan)),
    'the plan board with the Archive pill on': (mode) => modelOf(plan.all, plan.ctx, plan.config.hierarchy, mode),
    'the fixture board': (mode) => modelOf(fixture.all, fixture.ctx, fixture.config.hierarchy, mode, live(fixture)),
    'the malformed board': (mode) => modelOf(malformed.all, malformed.ctx, malformed.config.hierarchy, mode, live(malformed)),
    'a board the size of a real shop board': (mode) => modelOf(shaped, CTX, HIERARCHY, mode),
    'a board of loose cards in every status': (mode) => modelOf(Array.from({ length: 60 }, (_, i) => card(i + 1, { status: STATUSES[i % 4] })), CTX, [], mode),
    'a board of 400 loose cards': (mode) => modelOf(Array.from({ length: 400 }, (_, i) => card(i + 1, { status: STATUSES[(i * 3) % 4] })), CTX, [], mode),
    'a board of trees in every tier': (mode) => modelOf(shaped.filter((c) => c.type !== undefined || c.parent !== null), CTX, HIERARCHY, mode),
  };
};

test('in every mode no two captions overlap and Fit lands every dot, caption and the circle inside the stage, on any board and stage', () => {
  for (const [name, make] of Object.entries(BOARDS())) {
    for (const mode of MODES) {
      const m = make(mode);
      const l = graphLayoutTiers(m, { statuses: STATUSES, unnested: mode });
      const plan = graphPlan(m, l, OPTS);
      for (const [w, h] of STAGES) {
        const v = graphFit(l.bounds, w, h);
        const where = `${name}, ${mode}, ${w}x${h} at k=${v.k.toFixed(2)}`;
        assert.deepStrictEqual(clashes(captionRects(plan, v)), [], where);
        for (const n of plan.nodes) {
          const sx = n.x * v.k + v.x;
          const sy = n.y * v.k + v.y;
          assert.ok(Number.isFinite(sx) && sx >= 0 && sx <= w && sy >= 0 && sy <= h, `${where}: dot ${n.id}`);
        }
        for (const r of captionRects(plan, v)) assert.ok(r.l >= 0 && r.r <= w && r.t >= 0 && r.b <= h, `${where}: caption ${r.name}`);
        const reach = Math.max(0, ...l.rings.map((r) => r.r));
        for (const [x, y] of [[-reach, 0], [reach, 0], [0, -reach], [0, reach]]) {
          const sx = x * v.k + v.x;
          const sy = y * v.k + v.y;
          assert.ok(sx >= 0 && sx <= w && sy >= 0 && sy <= h, `${where}: the circle at ${Math.round(sx)},${Math.round(sy)}`);
        }
      }
    }
  }
});

test('outermost: the text of the unnested caption is clear of every dot on every board and stage', () => {
  for (const [name, make] of Object.entries(BOARDS())) {
    const m = make('outermost');
    const l = graphLayoutTiers(m, { statuses: STATUSES, unnested: 'outermost' });
    const plan = graphPlan(m, l, OPTS);
    for (const [w, h] of STAGES) {
      const v = graphFit(l.bounds, w, h);
      const cap = captionRects(plan, v).find((r) => r.name === 'unnested');
      assert.strictEqual(!!cap, graphFanPlace(m, { statuses: STATUSES }).columns.length > 0, `${name}: a ring has its caption, and a board with none has neither`);
      if (!cap) continue;
      for (const n of plan.nodes) {
        const sx = n.x * v.k + v.x;
        const sy = n.y * v.k + v.y;
        const reach = n.reach * v.k;
        const hit = sx + reach > cap.l && sx - reach < cap.r && sy + reach > cap.t && sy - reach < cap.b;
        assert.ok(!hit, `${name} on ${w}x${h}: dot ${n.id} is under the caption`);
      }
    }
  }
});

// --- the cache key and the re-fit ---------------------------------------------------------------------

test('the mode is in the layout\'s cache key: each mode is a layout of its own, the same mode the same one', () => {
  const m = drawnModel(loadBoard('plan'));
  graphLayoutCacheClear();
  const layouts = new Map(['outermost', 'depth 0', 'table'].map((unnested) => [unnested, graphLayout(m, 'tiers', { statuses: STATUSES, unnested })]));
  assert.strictEqual(new Set(layouts.values()).size, 3, 'three modes, three layouts');
  for (const [unnested, l] of layouts) assert.strictEqual(graphLayout(m, 'tiers', { statuses: STATUSES, unnested }), l, unnested);
  assert.strictEqual(graphLayout(m, 'tiers', { statuses: STATUSES }), layouts.get('outermost'), 'no mode is the default, outermost');
  assert.strictEqual(graphLayout(m, 'tiers', { statuses: STATUSES, unnested: 'every' }), layouts.get('outermost'), 'and so is one the row does not offer');
});

test('the mode is in the signature the view compares to re-fit an untouched view, since it changes what Fit frames, in Tiers only', () => {
  const m = drawnModel(loadBoard('plan'));
  const sig = (kind, unnested) => graphSignature(m, kind, { statuses: STATUSES, unnested });
  assert.strictEqual(new Set(['outermost', 'depth 0', 'table'].map((u) => sig('tiers', u))).size, 3);
  assert.strictEqual(sig('tiers', undefined), sig('tiers', 'outermost'));
  for (const kind of ['force', 'status']) assert.strictEqual(sig(kind, 'table'), sig(kind, 'outermost'), `${kind} does not read it`);
  assert.strictEqual(graphSignature(m, 'tiers', { statuses: STATUSES, unnested: 'table', order: 'rank', lines: 'all' }), sig('tiers', 'table'), 'and nothing else of the row\'s');
});

test('off is the cards leaving the model: its layout is the layout of a board without them, and Fit frames what is left', () => {
  const board = loadBoard('plan');
  const opts = { ctx: board.ctx, hierarchy: board.config.hierarchy };
  const off = graphBuild(board.all.filter((c) => !c.archived), { ...opts, unnested: 'off' });
  const l = graphLayoutTiers(off, { statuses: STATUSES, unnested: 'off' });
  assert.strictEqual(l.block, null);
  assert.deepStrictEqual(l.captions.map((c) => c.name), ['goal', 'strategy', 'objective', 'epic', 'depth 1', 'depth 2', 'depth 4', 'depth 5'], 'no unnested caption');
  for (const id of PLAN_UNNESTED) assert.ok(!l.pos.has(id), `card ${id} has no place`);
  const kept = off.nodes.map((n) => n.id).sort((a, b) => a - b);
  assert.ok(kept.every((id) => !PLAN_UNNESTED.includes(id)));
  const outer = l.bands[l.bands.length - 1];
  assert.ok(l.bounds.x1 <= outer.r1 + 100 && l.bounds.y1 <= outer.r1 + 100, 'the bounds are the fan\'s, with no block beside it');
  const table = graphLayoutTiers(drawnModel(board), { statuses: STATUSES, unnested: 'table' });
  assert.ok(l.bounds.x1 < table.bounds.x1, 'Fit frames less than the block made it');
});

test('table keeps the block as it was, whatever the cards: a column for each status outside the rim, and no ring', () => {
  const m = drawnModel(loadBoard('plan'));
  const l = graphLayoutTiers(m, { statuses: STATUSES, unnested: 'table' });
  assert.deepStrictEqual(l.block.columns.map((c) => [c.label, c.ids]), [['backlog', ['11', '14', '18', '28']], ['todo', ['10', '13', '17', '27']], ['doing', ['9', '15']], ['done', ['12', '16', '29']]]);
  assert.deepStrictEqual(l.captions.map((c) => c.name), ['goal', 'strategy', 'objective', 'epic', 'depth 1', 'depth 2', 'depth 4', 'depth 5']);
  const outer = l.bands[l.bands.length - 1].r1;
  for (const id of PLAN_UNNESTED) assert.ok(radius(l, id) > outer + 20, `card ${id} is outside the rim`);
});
