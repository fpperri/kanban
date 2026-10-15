const { test } = require('node:test');
const assert = require('node:assert');
const { depthOf, depthMap } = require('../web/nesting');

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
