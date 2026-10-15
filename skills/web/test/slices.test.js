const { test } = require('node:test');
const assert = require('node:assert');
const { depthOf, depthMap } = require('../web/nesting');
const { sliceCards } = require('../web/slices');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra) => Object.assign({ id, parent: null, rank: null, priority: 'Normal', status: 'todo', archived: false }, extra);

// One board that holds every case a slice has to settle: a full tier chain, a
// goal under an epic, loose tiered and untiered cards, a parent cycle, a parent
// that is missing, a parent on another board and an archived parent.
//
//   1 goal > 2 strategy > 3 objective > 4 epic > 5 story > 6 task
//   7 goal under epic 4 (nested against the hierarchy)
//   8 epic, 18 Goal: loose tiered cards (18 in another letter case)
//   9 story, 10 no type: loose untiered roots
//   11 task <-> 12 story: a parent cycle; 13 sits under 11
//   14 under card 99, which is not on the board; 17 under a card on another board
//   15 archived story under goal 1; 16 sits under 15
const HIERARCHY = ['goal', 'strategy', 'objective', 'epic'];
const fixture = () => [
  card(1, { type: 'goal' }),
  card(2, { type: 'strategy', parent: 1 }),
  card(3, { type: 'objective', parent: 2 }),
  card(4, { type: 'epic', parent: 3 }),
  card(5, { type: 'story', parent: 4 }),
  card(6, { type: 'task', parent: 5 }),
  card(7, { type: 'goal', parent: 4 }),
  card(8, { type: 'epic' }),
  card(9, { type: 'story' }),
  card(10),
  card(11, { type: 'task', parent: 12 }),
  card(12, { type: 'story', parent: 11 }),
  card(13, { parent: 11 }),
  card(14, { parent: 99 }),
  card(15, { type: 'story', parent: 1, archived: true, status: 'done' }),
  card(16, { parent: 15 }),
  card(17, { parent: 'other#3' }),
  card(18, { type: 'Goal' }),
];
const objectOf = (map) => Object.fromEntries([...map].sort((a, b) => a[0] - b[0]));

// --- the board-wide depth map --------------------------------------------------

test('depth map: parents above each card, a root is 0, archived cards counted', () => {
  assert.deepStrictEqual(objectOf(depthMap(fixture(), CTX)), {
    1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 4, 8: 0, 9: 0, 10: 0,
    11: 1, 12: 1, 13: 2, 14: 0, 15: 1, 16: 2, 17: 0, 18: 0,
  });
});

test('depth map: gives every card the depth the nesting module already gives it, loops included', () => {
  const cards = fixture();
  const map = depthMap(cards, CTX);
  for (const c of cards) assert.strictEqual(map.get(c.id), depthOf(cards, c.id, CTX), `card ${c.id}`);
});

test('depth map: only parents on this board count, so another board or a missing card ends the count', () => {
  const cards = [
    card(1, { parent: 'other#9' }), card(2, { parent: 1 }), card(3, { parent: 2 }),
    card(4, { parent: 77 }), card(5, { parent: 4 }),
    card(6, { parent: 'kanban#2' }), card(7, { parent: 'soon' }), card(8, { parent: 7 }),
  ];
  assert.deepStrictEqual(objectOf(depthMap(cards, CTX)), { 1: 0, 2: 1, 3: 2, 4: 0, 5: 1, 6: 2, 7: 0, 8: 1 });
});

test('depth map: a parent loop stops at the card it would repeat, and a card under a loop counts the whole loop', () => {
  const cards = [
    card(1, { parent: 3 }), card(2, { parent: 1 }), card(3, { parent: 2 }),
    card(4, { parent: 4 }),
    card(5, { parent: 1 }), card(6, { parent: 5 }),
    card(7, { parent: 8 }), card(8, { parent: 7 }),
  ];
  const map = depthMap(cards, CTX);
  assert.deepStrictEqual(objectOf(map), { 1: 2, 2: 2, 3: 2, 4: 0, 5: 3, 6: 4, 7: 1, 8: 1 });
  for (const c of cards) assert.strictEqual(map.get(c.id), depthOf(cards, c.id, CTX), `card ${c.id}`);
});

test('depth map: the first of two cards with one id is the card, as in the nesting tree', () => {
  const cards = [card(1), card(2, { parent: 1 }), card(2, { parent: null })];
  assert.deepStrictEqual(objectOf(depthMap(cards, CTX)), { 1: 0, 2: 1 });
});

test('depth map: a 6000-deep chain gets its depths without a stack overflow', () => {
  const cards = [];
  for (let id = 1; id <= 6000; id++) cards.push(card(id, { parent: id === 1 ? null : id - 1 }));
  cards.reverse();
  const map = depthMap(cards, CTX);
  assert.strictEqual(map.size, 6000);
  assert.strictEqual(map.get(1), 0);
  assert.strictEqual(map.get(3000), 2999);
  assert.strictEqual(map.get(6000), 5999);
});

test('depth map: built once per board, so it reads each card once however many cards there are', () => {
  let reads = 0;
  const counted = (id, parent) => ({
    id, rank: null, priority: 'Normal', archived: false,
    get parent() { reads++; return parent; },
  });
  const cards = [];
  for (let id = 1; id <= 400; id++) cards.push(counted(id, id === 1 ? null : id - 1));
  const map = depthMap(cards, CTX);
  assert.strictEqual(map.get(400), 399);
  assert.strictEqual(reads, 400);
});

// --- each card's slice ---------------------------------------------------------

// Slices the cards given, with depths from the whole board: the cards a view
// shows are `shown`, the board is `board`.
const slicesOf = (shown, hierarchy, board = shown) => sliceCards(shown, hierarchy, depthMap(board, CTX));
const withTiers = (shown, board) => slicesOf(shown, HIERARCHY, board);
// A slice as a test reads it: a tier by its name, a depth by its number.
const placeOf = (model, id) => {
  const s = model.byId.get(id);
  return s.kind === 'tier' ? s.name : s.depth;
};
const placesOf = (model) => Object.fromEntries([...model.byId.keys()].sort((a, b) => a - b).map((id) => [id, placeOf(model, id)]));

test('a card whose type is in the hierarchy is in that tier, in any letter case, whatever its parent is', () => {
  const m = withTiers(fixture());
  for (const [id, tier] of [[1, 'goal'], [2, 'strategy'], [3, 'objective'], [4, 'epic'], [8, 'epic'], [18, 'goal']]) {
    assert.strictEqual(placeOf(m, id), tier, `card ${id}`);
  }
  assert.strictEqual(placeOf(m, 7), 'goal', 'a goal under an epic is in the goal slice');
  const cased = withTiers([card(1, { type: 'EPIC' }), card(2, { type: 'Epic', parent: 1 }), card(3, { type: ' epic ', parent: 2 })]);
  assert.deepStrictEqual(placesOf(cased), { 1: 'epic', 2: 'epic', 3: 'epic' });
});

test('a card whose type is outside the hierarchy, or that has no type, is in the slice of its depth', () => {
  const m = withTiers(fixture());
  assert.deepStrictEqual(placesOf(m), {
    1: 'goal', 2: 'strategy', 3: 'objective', 4: 'epic', 5: 4, 6: 5, 7: 'goal', 8: 'epic', 9: 0, 10: 0,
    11: 1, 12: 1, 13: 2, 14: 0, 15: 1, 16: 2, 17: 0, 18: 'goal',
  });
});

test('without a hierarchy every slice is a depth, whatever the types say', () => {
  const depths = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 4, 8: 0, 9: 0, 10: 0, 11: 1, 12: 1, 13: 2, 14: 0, 15: 1, 16: 2, 17: 0, 18: 0 };
  for (const none of [undefined, null, [], 'goal', {}, ['', '  ', 5, null]]) {
    assert.deepStrictEqual(placesOf(slicesOf(fixture(), none)), depths, JSON.stringify(none));
  }
});

test('a card keeps its slice when its parent is archived or missing from the cards being sliced', () => {
  const board = fixture();
  const shown = board.filter((c) => ![15, 4, 11].includes(c.id));
  const m = withTiers(shown, board);
  assert.strictEqual(placeOf(m, 16), 2, 'the parent 15 is archived and not in the list');
  assert.strictEqual(placeOf(m, 5), 4, 'the parent 4 is not in the list');
  assert.strictEqual(placeOf(m, 13), 2, 'the parent 11 is not in the list');
  assert.strictEqual(placeOf(m, 7), 'goal');
  assert.deepStrictEqual([...m.byId.keys()].sort((a, b) => a - b), shown.map((c) => c.id).sort((a, b) => a - b));
  const alone = withTiers([card(5, { type: 'story', parent: 4 })], board);
  assert.strictEqual(placeOf(alone, 5), 4, 'and the board-wide depth, not the list, decides');
});

// --- the axis --------------------------------------------------------------------

// The axis as a test reads it: [place, count] in axis order.
const axisOf = (model) => model.axis.map((s) => [s.kind === 'tier' ? s.name : s.depth, s.count]);

test('the axis lists every tier in hierarchy order, then depths 0 to the deepest card without a tier, each with its count', () => {
  assert.deepStrictEqual(axisOf(withTiers(fixture())), [
    ['goal', 3], ['strategy', 1], ['objective', 1], ['epic', 2],
    [0, 4], [1, 3], [2, 2], [3, 0], [4, 1], [5, 1],
  ]);
});

test('the axis lists a tier no card has, and no depth when every card has a tier', () => {
  assert.deepStrictEqual(axisOf(withTiers([card(9, { type: 'story' }), card(10)])), [
    ['goal', 0], ['strategy', 0], ['objective', 0], ['epic', 0], [0, 2],
  ]);
  assert.deepStrictEqual(axisOf(withTiers([card(1, { type: 'goal' }), card(2, { type: 'Epic', parent: 1 })])), [
    ['goal', 1], ['strategy', 0], ['objective', 0], ['epic', 1],
  ]);
  assert.deepStrictEqual(axisOf(withTiers([])), [['goal', 0], ['strategy', 0], ['objective', 0], ['epic', 0]]);
  assert.deepStrictEqual(axisOf(slicesOf([], undefined)), []);
});

test('without a hierarchy the axis is the depths alone', () => {
  assert.deepStrictEqual(axisOf(slicesOf(fixture(), [])), [[0, 7], [1, 4], [2, 3], [3, 1], [4, 2], [5, 1]]);
});

test('the axis counts the cards it is given, the depths still board-wide', () => {
  const board = fixture();
  const shown = board.filter((c) => !c.archived && c.id !== 3);
  assert.deepStrictEqual(axisOf(withTiers(shown, board)), [
    ['goal', 3], ['strategy', 1], ['objective', 0], ['epic', 2],
    [0, 4], [1, 2], [2, 2], [3, 0], [4, 1], [5, 1],
  ]);
  const deepOnly = withTiers([card(6, { type: 'task', parent: 5 })], board);
  assert.deepStrictEqual(axisOf(deepOnly).slice(4), [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 1]]);
});

test('hierarchy names are compared without regard to case, the first of two duplicates wins, blank names are ignored', () => {
  const cards = [card(1, { type: 'goal' }), card(2, { type: 'EPIC' }), card(3, { type: 'epic' }), card(4, { type: 'story' })];
  const m = slicesOf(cards, ['Goal', 'epic', 'GOAL', '', '   ', 'Epic', null, 7, 'story ']);
  assert.deepStrictEqual(m.axis.filter((s) => s.kind === 'tier').map((s) => s.name), ['Goal', 'epic', 'story']);
  assert.deepStrictEqual(axisOf(m), [['Goal', 1], ['epic', 2], ['story', 1]]);
  const flipped = slicesOf(cards, ['epic', 'Goal', 'EPIC']);
  assert.deepStrictEqual(axisOf(flipped).slice(0, 2), [['epic', 2], ['Goal', 1]]);
});

test('over the unit fixture every card is in exactly one slice, and the counts add up to the number of cards', () => {
  const cards = fixture();
  const m = withTiers(cards);
  assert.strictEqual(cards.length, 18);
  assert.deepStrictEqual([...m.byId.keys()].sort((a, b) => a - b), cards.map((c) => c.id));
  assert.strictEqual(m.axis.reduce((sum, s) => sum + s.count, 0), cards.length);
  const tally = new Map();
  for (const c of cards) tally.set(m.byId.get(c.id), (tally.get(m.byId.get(c.id)) || 0) + 1);
  for (const s of m.axis) assert.strictEqual(tally.get(s) || 0, s.count, `${s.kind} ${s.name === undefined ? s.depth : s.name}`);
  assert.deepStrictEqual([...tally.keys()].filter((s) => !m.axis.includes(s)), [], 'every card is in a slice the axis lists');
});

test('each slice knows its place on the axis, and a card is in the very slice the axis lists', () => {
  const m = withTiers(fixture());
  assert.deepStrictEqual(m.axis.map((s) => s.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.strictEqual(m.byId.get(7), m.axis[0]);
  assert.strictEqual(m.byId.get(6), m.axis[9]);
  assert.strictEqual(m.axis[0].key, 'goal');
  assert.strictEqual(m.axis[4].key, undefined);
});

test('slicing never reads a card\'s parent: the depth map is built once per board, not once per card', () => {
  let reads = 0;
  const cards = [];
  for (let id = 1; id <= 300; id++) {
    const parent = id === 1 ? null : id - 1;
    cards.push({ id, type: id % 50 === 0 ? 'epic' : 'story', rank: null, priority: 'Normal', get parent() { reads++; return parent; } });
  }
  const depths = depthMap(cards, CTX);
  assert.strictEqual(reads, 300);
  reads = 0;
  const m = sliceCards(cards, HIERARCHY, depths);
  assert.strictEqual(reads, 0);
  assert.strictEqual(m.axis.length, 4 + 299, 'four tiers, then depths 0 to 298: card 299 is the deepest without a tier');
  assert.strictEqual(m.byId.get(300).kind, 'tier');
  assert.strictEqual(m.byId.get(299).depth, 298);
});

test('a card the depth map does not know is read as a root, and a damaged depth is read as a root', () => {
  const m = sliceCards([card(1), card(2), card(3), card(4)], HIERARCHY, new Map([[2, -3], [3, 1.5], [4, 'deep']]));
  assert.deepStrictEqual(placesOf(m), { 1: 0, 2: 0, 3: 0, 4: 0 });
  assert.deepStrictEqual(axisOf(m).slice(4), [[0, 4]]);
});
