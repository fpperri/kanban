const { test } = require('node:test');
const assert = require('node:assert');
const { threadOf } = require('../web/nesting');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra) => Object.assign({ id, parent: null, rank: null, priority: 'Normal', status: 'todo', archived: false }, extra);
const shape = (thread) => thread.map((e) => (e.kind === 'card' ? e.id : `${e.kind}:${e.ref || e.id}`));

test('thread: a story three levels down has three parents above it, root first', () => {
  const cards = [card(1), card(2, { parent: 1 }), card(3, { parent: 2 }), card(4, { parent: 3 })];
  const thread = threadOf(cards, 4, CTX);
  assert.deepStrictEqual(shape(thread), [1, 2, 3]);
  assert.strictEqual(thread[0].card, cards[0], 'a card entry carries the card itself');
});

test('thread: a root has an empty thread', () => {
  assert.deepStrictEqual(threadOf([card(1), card(2, { parent: 1 })], 1, CTX), []);
});

test('thread: a card that is not on the board has an empty thread', () => {
  assert.deepStrictEqual(threadOf([card(1)], 99, CTX), []);
});

test('thread: an archived parent is still a parent', () => {
  const cards = [card(1, { archived: true }), card(2, { parent: 1 })];
  const thread = threadOf(cards, 2, CTX);
  assert.deepStrictEqual(shape(thread), [1]);
  assert.strictEqual(thread[0].card.archived, true);
});

test('thread: a parent written with this board\'s own name resolves as local', () => {
  const cards = [card(12), card(13, { parent: 'kanban#12' })];
  assert.deepStrictEqual(shape(threadOf(cards, 13, CTX)), [12]);
});

test('thread: a parent that names no card ends the thread with an unresolved marker', () => {
  const cards = [card(3, { parent: 99 }), card(4, { parent: 3 })];
  const thread = threadOf(cards, 4, CTX);
  assert.deepStrictEqual(shape(thread), ['unresolved:99', 3], 'the marker sits above the last card found');
  assert.strictEqual(thread[0].id, 99);
});

test('thread: a parent on another board ends it with that card\'s mention, not followed', () => {
  const cards = [card(3, { parent: 'fpp#4' }), card(4, { parent: 3 })];
  const thread = threadOf(cards, 4, CTX);
  assert.deepStrictEqual(shape(thread), ['other-board:fpp#4', 3]);
  assert.strictEqual(thread[0].board, 'fpp');
  assert.strictEqual(thread[0].id, 4);
});

test('thread: another board is not followed even when it has a card with that id here', () => {
  const cards = [card(4), card(5, { parent: 'fpp#4' })];
  assert.deepStrictEqual(shape(threadOf(cards, 5, CTX)), ['other-board:fpp#4']);
});

test('thread: two cards that name each other stop at the repeating card and flag the loop', () => {
  const cards = [card(1, { parent: 2 }), card(2, { parent: 1 })];
  const thread = threadOf(cards, 1, CTX);
  assert.deepStrictEqual(shape(thread), ['loop:1', 2]);
  assert.strictEqual(thread[0].card, cards[0], 'the loop entry carries the repeating card');
});

test('thread: a card that names itself as parent is a loop of one', () => {
  const cards = [card(7, { parent: 7 })];
  assert.deepStrictEqual(shape(threadOf(cards, 7, CTX)), ['loop:7']);
});

test('thread: a card hanging off a loop walks into it once and stops at the first repeat', () => {
  const cards = [card(1, { parent: 2 }), card(2, { parent: 3 }), card(3, { parent: 1 }), card(9, { parent: 1 })];
  const thread = threadOf(cards, 9, CTX);
  assert.deepStrictEqual(shape(thread), ['loop:1', 3, 2, 1]);
});

test('thread: junk in the parent field reads as no parent', () => {
  assert.deepStrictEqual(threadOf([card(2, { parent: 'soon' })], 2, CTX), []);
});

test('thread: the parent may come as the raw frontmatter string', () => {
  const cards = [card(1), card(2, { parent: ' "1"' })];
  assert.deepStrictEqual(shape(threadOf(cards, 2, CTX)), [1]);
});

// --- children, as the detail lists them --------------------------------------

const { childrenOf } = require('../web/nesting');
const kids = (cards, id) => childrenOf(cards, id, CTX).map((c) => c.id);

test('children: in rank order, unranked after by priority then id', () => {
  const cards = [
    card(1),
    card(8, { parent: 1 }),
    card(7, { parent: 1, priority: 'High' }),
    card(5, { parent: 1, rank: 30 }),
    card(3, { parent: 1, rank: 10 }),
    card(4, { parent: 1, rank: 20 }),
    card(9, { parent: 2, rank: 1 }),
  ];
  assert.deepStrictEqual(kids(cards, 1), [3, 4, 5, 7, 8]);
});

test('children: archived children are listed, flagged by their archived field', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10, archived: true }), card(3, { parent: 1, rank: 20 })];
  const list = childrenOf(cards, 1, CTX);
  assert.deepStrictEqual(list.map((c) => [c.id, c.archived]), [[2, true], [3, false]]);
});

test('children: a leaf has none', () => {
  assert.deepStrictEqual(kids([card(1), card(2, { parent: 1 })], 2), []);
});

test('children: a loop lists each card under the other, once', () => {
  const cards = [card(1, { parent: 2 }), card(2, { parent: 1 })];
  assert.deepStrictEqual(kids(cards, 1), [2]);
  assert.deepStrictEqual(kids(cards, 2), [1]);
});
