const { test, after } = require('node:test');
const assert = require('node:assert');

const { graphBuild, graphFanPlace } = require('../web/graph-model');
const { depthMap } = require('../web/nesting');
const { sliceCards } = require('../web/slices');
const {
  STATUSES, HIERARCHY, loadBoard, cleanUp, card, drawnModel, buildOf,
} = require('./helpers/fan-boards');

// The tier fan's classification: which band, ring, sector or block of the
// Unnested block each card is placed in. graphFanPlace is the one pure function
// that decides it; the layout (graph-fan-layout.test.js) turns it into
// positions. The plan board is the browser runner's own fixture, so what is
// asserted here about its cards is what the runner sees on the page.

after(cleanUp);

const load = loadBoard;
const planModel = (opts) => drawnModel(load('plan'), opts);

// --- the band is the slice -----------------------------------------------------------

test('place: each card sits in the band of its slice, the slice function of the whole board', () => {
  const board = load('plan');
  const m = drawnModel(board);
  const slices = sliceCards(board.all, board.config.hierarchy, depthMap(board.all, board.ctx));
  const { places } = graphFanPlace(m, { statuses: STATUSES });
  assert.ok(m.nodes.length > 20);
  for (const n of m.nodes) assert.strictEqual(places.get(n.id).band, slices.byId.get(n.id).index, `card ${n.id}`);
  assert.deepStrictEqual([1, 2, 7, 22].map((id) => places.get(id).band), [0, 1, 2, 3], 'one band per tier, tier 1 first');
});

test('place: a hidden or an archived parent never moves a card to another band', () => {
  const board = load('plan');
  const slices = sliceCards(board.all, board.config.hierarchy, depthMap(board.all, board.ctx));
  const live = board.live.map((c) => c.id);
  const bands = (m) => new Map(m.nodes.map((n) => [n.id, graphFanPlace(m, { statuses: STATUSES }).places.get(n.id).band]));
  const hidden = bands(drawnModel(board, { visible: live.filter((id) => id !== 2 && id !== 22) }));
  for (const [id, band] of hidden) assert.strictEqual(band, slices.byId.get(id).index, `card ${id}, parents 2 and 22 hidden`);
  assert.strictEqual(hidden.get('8'), slices.byId.get('8').index, 'card 8 is at depth 2 although its parent is not drawn');
  assert.strictEqual(slices.byId.get('8').kind, 'depth');
  assert.strictEqual(slices.byId.get('8').depth, 2);
  const archived = board.all.map((c) => (c.id === '2' || c.id === '22' ? { ...c, archived: true } : c));
  const asArchived = graphBuild(archived, { ctx: board.ctx, hierarchy: board.config.hierarchy, visibleIds: new Set(live.filter((id) => id !== 2 && id !== 22)) });
  const sliced = sliceCards(archived, board.config.hierarchy, depthMap(archived, board.ctx));
  for (const [id, band] of bands(asArchived)) assert.strictEqual(band, sliced.byId.get(id).index, `card ${id}, parents 2 and 22 archived`);
});

// --- bands: tiers first, then a ring per depth --------------------------------------

const bandNames = (place) => place.bands.map((b) => (b.slice.kind === 'tier' ? b.slice.name : `depth ${b.slice.depth}`));

test('place: the bands run from tier 1 innermost to the last tier, then the depth rings in depth order', () => {
  const place = graphFanPlace(planModel(), { statuses: STATUSES });
  assert.deepStrictEqual(bandNames(place), ['goal', 'strategy', 'objective', 'epic', 'depth 1', 'depth 2', 'depth 4', 'depth 5']);
  assert.deepStrictEqual(place.bands.map((b) => b.count), [2, 2, 1, 1, 4, 1, 1, 1]);
});

test('place: a depth with no card without a tier gets no ring, and a tier nobody is in keeps a thin band', () => {
  const place = graphFanPlace(planModel(), { statuses: STATUSES });
  const names = bandNames(place);
  assert.ok(!names.includes('depth 0'), 'depth 0 holds only loose cards, which are in the Unnested block');
  assert.ok(!names.includes('depth 3'), 'depth 3 holds only the epic, which is in its tier');
  const sparse = graphFanPlace(buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })], ['goal', 'epic']), { statuses: STATUSES });
  assert.deepStrictEqual(bandNames(sparse), ['goal', 'epic', 'depth 1']);
  assert.deepStrictEqual(sparse.bands.map((b) => [b.count, b.subs]), [[0, 0], [1, 1], [1, 1]]);
});

test('place: a goal nested under an epic sits in the goal band, with no warning', () => {
  const { places } = graphFanPlace(planModel(), { statuses: STATUSES });
  assert.strictEqual(places.get('25').band, 0);
  assert.strictEqual(places.get('25').block, null);
  assert.strictEqual(places.get('22').band, 3);
});

test('place: a card whose type is outside the hierarchy sits in the ring of its depth', () => {
  const m = planModel();
  const { places } = graphFanPlace(m, { statuses: STATUSES });
  const axis = m.axis;
  assert.deepStrictEqual([23, 24].map((id) => axis[places.get(id).band].depth), [4, 5], 'a story and a task, by depth');
  assert.strictEqual(axis[places.get('23').band].kind, 'depth');
  assert.strictEqual(places.get('23').block, null, 'a nested card is never in the Unnested block');
});

test('place: a card of the same tier nested under its own tier takes the next ring of that band, so the two never share a ring', () => {
  const m = buildOf([card(1, { type: 'epic' }), card(2, { type: 'epic', parent: 1 }), card(3, { type: 'epic', parent: 2 }), card(4, { type: 'epic', parent: 1 })], ['epic']);
  const { places, bands } = graphFanPlace(m, { statuses: STATUSES });
  assert.deepStrictEqual([1, 2, 3, 4].map((id) => places.get(id).sub), [0, 1, 2, 1]);
  assert.deepStrictEqual(bands.map((b) => [b.count, b.subs]), [[4, 3]]);
});

// --- sectors and the Unnested block ---------------------------------------------------

test('place: each root with the cards nested under it takes its own sector, in outline order', () => {
  const m = buildOf([
    card(1), card(2, { parent: 1 }), card(3, { parent: 2 }), card(4), card(5, { parent: 4 }), card(6, { parent: 4 }), card(7, { parent: 99 }),
  ], []);
  const { places, sectors } = graphFanPlace(m, { statuses: STATUSES });
  assert.deepStrictEqual(sectors.map((s) => [s.kind, s.rootId, s.leaves]), [['tree', 1, 1], ['tree', 4, 2]]);
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((id) => places.get(id).sector), [0, 0, 0, 1, 1, 1]);
  assert.strictEqual(places.get('7').sector, null, 'a card with a parent that is not on the board and no children is loose');
  assert.strictEqual(places.get('7').block, 'todo');
});

test('place: loose cards with a tier share one sector of their own, after the trees', () => {
  const { places, sectors } = graphFanPlace(planModel(), { statuses: STATUSES });
  assert.deepStrictEqual(sectors.map((s) => [s.kind, s.rootId]), [['tree', 1], ['loose', null]]);
  assert.deepStrictEqual(sectors[1].tops, [26]);
  assert.strictEqual(places.get('26').sector, 1);
  assert.strictEqual(places.get('26').block, null);
  const two = graphFanPlace(buildOf([card(1, { type: 'goal' }), card(2, { type: 'epic' }), card(3, { type: 'goal' }), card(4, { parent: 3 })], HIERARCHY), { statuses: STATUSES });
  assert.deepStrictEqual(two.sectors.map((s) => [s.kind, s.tops]), [['tree', [3]], ['loose', [1, 2]]]);
  assert.strictEqual(two.places.get('1').sector, two.places.get('2').sector);
});

test('place: a card that is nested on the board stays in its tree, not the loose sector or the block, when its relatives are hidden', () => {
  const board = load('plan');
  const m = drawnModel(board, { visible: board.live.map((c) => c.id).filter((id) => ![2, 3, 4, 5, 6].includes(id)) });
  const { places, sectors } = graphFanPlace(m, { statuses: STATUSES });
  assert.strictEqual(m.byId.get('1').kids, 0, 'no child of card 1 is drawn');
  assert.strictEqual(sectors[places.get('1').sector].kind, 'tree', 'card 1 still has children on the board');
  assert.strictEqual(places.get('1').block, null);
  const bare = buildOf([card(1), card(2, { parent: 1 }), card(3), card(4, { parent: 5 })], [], [1, 3, 4]);
  const bare1 = graphFanPlace(bare, { statuses: STATUSES });
  assert.strictEqual(bare1.places.get('1').block, null, 'a parent whose only child is hidden is not in the Unnested block');
  assert.strictEqual(bare1.sectors[bare1.places.get('1').sector].kind, 'tree');
  assert.strictEqual(bare1.places.get('3').block, 'todo', 'a card with no relatives at all is');
  assert.strictEqual(bare1.places.get('4').block, 'todo', 'and so is one whose parent is not on the board');
});

test('place: loose cards with no tier fall in the Unnested block, grouped by status in the board\'s order', () => {
  const { places, columns } = graphFanPlace(planModel(), { statuses: STATUSES });
  assert.deepStrictEqual(columns.map((c) => [c.label, c.ids]), [
    ['backlog', [11, 14, 18, 28]], ['todo', [10, 13, 17, 27]], ['doing', [9, 15]], ['done', [12, 16, 29]],
  ]);
  for (const c of columns) for (const id of c.ids) {
    assert.strictEqual(places.get(id).block, c.label, `card ${id}`);
    assert.strictEqual(places.get(id).sector, null, `card ${id}`);
  }
});

test('place: the Unnested block follows the board\'s own statuses, folds an unlisted status into the first, and ends with archived cards', () => {
  const m = buildOf([
    card(1, { status: 'b' }), card(2, { status: 'a' }), card(3, { status: 'gone' }), card(4, { status: 'b', archived: true }), card(5, { status: 'c' }),
  ], []);
  const { columns } = graphFanPlace(m, { statuses: ['a', 'b', 'c'] });
  assert.deepStrictEqual(columns.map((c) => [c.label, c.ids]), [['a', ['2', '3']], ['b', ['1']], ['c', ['5']], ['archived', ['4']]]);
});
