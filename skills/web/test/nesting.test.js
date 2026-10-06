const { test } = require('node:test');
const assert = require('node:assert');
const { parseParent, parseRank, childrenOf, depthOf, outlineOrder, hasNesting } = require('../web/nesting');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra) => Object.assign({ id, parent: null, rank: null, priority: 'Normal', status: 'todo', archived: false }, extra);
const order = (cards, ctx = CTX) => outlineOrder(cards, ctx).ids;

// --- reading parent and rank ------------------------------------------

test('parseParent: a number or digit string names a card on this board', () => {
  assert.deepStrictEqual(parseParent(12, 'kanban'), { board: null, id: 12, local: true });
  assert.deepStrictEqual(parseParent('12', 'kanban'), { board: null, id: 12, local: true });
  assert.deepStrictEqual(parseParent(' 12 ', 'kanban'), { board: null, id: 12, local: true });
});

test('parseParent: board#id names a card on another board', () => {
  assert.deepStrictEqual(parseParent('fpp#4', 'kanban'), { board: 'fpp', id: 4, local: false });
});

test('parseParent: the own board name in board#id counts as this board', () => {
  assert.deepStrictEqual(parseParent('shop.proj#12', 'shop.proj'), { board: null, id: 12, local: true });
});

test('parseParent: surrounding quotes are ignored, as the snapshot writes board#id quoted', () => {
  assert.deepStrictEqual(parseParent('"fpp#4"', 'kanban'), { board: 'fpp', id: 4, local: false });
  assert.deepStrictEqual(parseParent('"7"', 'kanban'), { board: null, id: 7, local: true });
});

test('parseParent: anything else is no parent', () => {
  for (const junk of [null, undefined, '', '  ', 'soon', '#4', 'fpp#', 'fpp#x', '4.5', '-3', 'a#b#4', true, {}, NaN, 1.5]) {
    assert.strictEqual(parseParent(junk, 'kanban'), null, `${JSON.stringify(junk)} reads as no parent`);
  }
});

test('parseRank: a number or numeric string, anything else is no rank', () => {
  assert.strictEqual(parseRank(10), 10);
  assert.strictEqual(parseRank('20'), 20);
  assert.strictEqual(parseRank(' 25 '), 25);
  assert.strictEqual(parseRank('"30"'), 30);
  assert.strictEqual(parseRank('-5'), -5);
  assert.strictEqual(parseRank('12.5'), 12.5);
  assert.strictEqual(parseRank(0), 0);
});

test('parseRank: blank, junk and non-finite values read as no rank (blank is not zero)', () => {
  for (const junk of [null, undefined, '', '   ', 'abc', '1e3', '0x10', 'Infinity', NaN, Infinity, true, {}, '10 20']) {
    assert.strictEqual(parseRank(junk), null, `${JSON.stringify(junk)} reads as no rank`);
  }
});

// --- outline order ----------------------------------------------------

test('outline order: the parent comes first, then its children in rank order', () => {
  const cards = [
    card(4, { parent: 1, rank: 30 }),
    card(2, { parent: 1, rank: 20 }),
    card(1),
    card(3, { parent: 1, rank: 10 }),
  ];
  assert.deepStrictEqual(order(cards), [1, 3, 2, 4]);
});

test('outline order: an unranked sibling follows the ranked ones; unranked siblings follow priority, then id', () => {
  const cards = [
    card(1),
    card(5, { parent: 1, priority: 'Low' }),
    card(4, { parent: 1, priority: 'High' }),
    card(3, { parent: 1, priority: 'High' }),
    card(2, { parent: 1, rank: 90 }),
  ];
  assert.deepStrictEqual(order(cards), [1, 2, 3, 4, 5]);
});

test('outline order: priority follows the board list, and an unknown priority comes after every known one', () => {
  const cards = [
    card(1),
    card(2, { parent: 1, priority: 'Whenever' }),
    card(3, { parent: 1, priority: 'Low' }),
    card(4, { parent: 1, priority: 'Urgent' }),
  ];
  assert.deepStrictEqual(order(cards, { board: 'kanban', priorities: ['Urgent', 'Low'] }), [1, 4, 3, 2]);
  assert.deepStrictEqual(order(cards, { board: 'kanban' }), [1, 3, 2, 4], 'no list falls back to High, Normal, Low');
});

test('outline order: equal ranks fall back to board name, then id', () => {
  const cards = [
    card(1),
    card(2, { parent: 1, rank: 10, board: 'b' }),
    card(3, { parent: 1, rank: 10, board: 'a' }),
    card(4, { parent: 1, rank: 10, board: 'a' }),
  ];
  assert.deepStrictEqual(order(cards), [1, 3, 4, 2]);
});

test('outline order: a rank of 0 is a rank, and a negative rank sorts before it', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 0 }), card(3, { parent: 1 }), card(4, { parent: 1, rank: -10 })];
  assert.deepStrictEqual(order(cards), [1, 4, 2, 3]);
});

test('outline order: a tree reads depth first, each level in rank order', () => {
  const cards = [
    card(1, { rank: 20 }),
    card(2, { rank: 10 }),
    card(3, { parent: 1, rank: 10 }),
    card(4, { parent: 2, rank: 20 }),
    card(5, { parent: 2, rank: 10 }),
    card(6, { parent: 5 }),
  ];
  assert.deepStrictEqual(order(cards), [2, 5, 6, 4, 1, 3]);
});

test('outline order: ranks and parents arrive as raw frontmatter strings too', () => {
  const cards = [
    card(3, { parent: '"1"', rank: '20' }),
    card(2, { parent: '1', rank: ' 10 ' }),
    card(1),
  ];
  assert.deepStrictEqual(order(cards), [1, 2, 3]);
});

test('outline order: a parent on another board or a missing parent makes a root; the own board name is this board', () => {
  const cards = [
    card(1),
    card(2, { parent: 'fpp#1', rank: 10 }),
    card(3, { parent: 99, rank: 20 }),
    card(4, { parent: 'kanban#1' }),
  ];
  assert.deepStrictEqual(order(cards), [2, 3, 1, 4]);
});

test('outline order: the index maps each id to its position in the order', () => {
  const cards = [card(2, { parent: 1 }), card(1), card(3)];
  const { ids, index } = outlineOrder(cards, CTX);
  assert.deepStrictEqual(ids, [1, 2, 3]);
  assert.deepStrictEqual([...index.entries()], [[1, 0], [2, 1], [3, 2]]);
});

test('outline order: archived parents and children take part like any card', () => {
  const cards = [card(2, { parent: 1, archived: true }), card(1, { archived: true }), card(3, { parent: 1 })];
  assert.deepStrictEqual(order(cards), [1, 2, 3]);
});

test('outline order: a parent loop never loses or repeats a card, and the lowest id of the loop is its entry', () => {
  const cards = [
    card(9),
    card(2, { parent: 1 }),
    card(1, { parent: 2 }),
    card(3, { parent: 2 }),
    card(7, { parent: 7 }),
    card(8, { parent: 7 }),
  ];
  assert.deepStrictEqual(order(cards), [9, 1, 2, 3, 7, 8]);
});

test('outline order: a branch hanging under a loop does not jump ahead of the loop it hangs from', () => {
  const cards = [card(5, { parent: 6 }), card(6, { parent: 5 }), card(3, { parent: 6 })];
  assert.deepStrictEqual(order(cards), [5, 6, 3]);
});

test('outline order does not reorder the array it is given', () => {
  const cards = [card(2, { parent: 1 }), card(1)];
  outlineOrder(cards, CTX);
  assert.deepStrictEqual(cards.map((c) => c.id), [2, 1]);
});

test('outline order of no cards is empty', () => {
  const { ids, index } = outlineOrder([], CTX);
  assert.deepStrictEqual(ids, []);
  assert.strictEqual(index.size, 0);
});

// --- children and depth -----------------------------------------------

test('childrenOf lists a card\'s children in sibling order; a leaf has none', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 20 }), card(3, { parent: 1, rank: 10 }), card(4, { parent: 3 })];
  assert.deepStrictEqual(childrenOf(cards, 1, CTX).map((c) => c.id), [3, 2]);
  assert.deepStrictEqual(childrenOf(cards, 4, CTX), []);
  assert.deepStrictEqual(childrenOf(cards, 99, CTX), []);
});

test('depthOf counts the parents above a card: a root is 0', () => {
  const cards = [card(1), card(2, { parent: 1 }), card(3, { parent: 2 }), card(4, { parent: 3 })];
  assert.deepStrictEqual([1, 2, 3, 4].map((id) => depthOf(cards, id, CTX)), [0, 1, 2, 3]);
});

test('depthOf stops where the chain ends: other board, missing parent, loop', () => {
  const cards = [
    card(1, { parent: 'fpp#4' }),
    card(2, { parent: 1 }),
    card(3, { parent: 99 }),
    card(4, { parent: 5 }),
    card(5, { parent: 4 }),
    card(6, { parent: 6 }),
  ];
  assert.strictEqual(depthOf(cards, 1, CTX), 0);
  assert.strictEqual(depthOf(cards, 2, CTX), 1);
  assert.strictEqual(depthOf(cards, 3, CTX), 0);
  assert.strictEqual(depthOf(cards, 4, CTX), 1, 'a loop stops at the repeating card');
  assert.strictEqual(depthOf(cards, 6, CTX), 0);
  assert.strictEqual(depthOf(cards, 99, CTX), 0, 'an unknown card is not nested');
});

// --- hasNesting -------------------------------------------------------

test('hasNesting: true when any card has a rank or a parent, in either form', () => {
  assert.strictEqual(hasNesting([card(1), card(2)]), false);
  assert.strictEqual(hasNesting([card(1), card(2, { rank: 10 })]), true);
  assert.strictEqual(hasNesting([card(1), card(2, { rank: 0 })]), true);
  assert.strictEqual(hasNesting([card(1), card(2, { parent: 1 })]), true);
  assert.strictEqual(hasNesting([card(1), card(2, { parent: 'fpp#4' })]), true);
  assert.strictEqual(hasNesting([card(1), card(2, { parent: '"fpp#4"', rank: '' })]), true);
});

test('hasNesting: a blank or junk rank or parent does not count', () => {
  assert.strictEqual(hasNesting([card(1, { parent: 'soon', rank: 'abc' }), card(2, { parent: '', rank: '' })]), false);
  assert.strictEqual(hasNesting([]), false);
});
