const { test } = require('node:test');
const assert = require('node:assert');
const { hpathIds, htreeIds, dpathIds, dtreeIds } = require('../web/explore-sets');

const set = (ids) => new Set(ids);

// 1 is the root; 2 and 3 are under 1; 4 is under 2; 5 is under 3; 6 is a root of its own with child 7.
// Dependencies: 3 waits for 2, 5 waits for 4, 8 and 9 wait for 5, 10 is a stranger.
const BOARD = [
  { id: '1', status: 'todo' },
  { id: '2', status: 'todo', parent: 1 },
  { id: '3', status: 'todo', parent: 1, waiting_for: ['2'] },
  { id: '4', status: 'todo', parent: 2 },
  { id: '5', status: 'todo', parent: 3, waiting_for: ['4'] },
  { id: '6', status: 'todo' },
  { id: '7', status: 'todo', parent: 6 },
  { id: '8', status: 'todo', waiting_for: ['5'] },
  { id: '9', status: 'todo', waiting_for: ['5'] },
  { id: '10', status: 'todo' },
];

test('hpathIds: the card, its parents up to the root and every card nested under it, parent links only', () => {
  assert.deepStrictEqual(hpathIds(BOARD, 2), set(['1', '2', '4']));
  assert.deepStrictEqual(hpathIds(BOARD, 5), set(['1', '3', '5']));
  assert.deepStrictEqual(hpathIds(BOARD, 1), set(['1', '2', '3', '4', '5']));
  assert.deepStrictEqual(hpathIds(BOARD, 10), set(['10']), 'a card with no parent and no children is its own path');
});

test('htreeIds: the whole parent tree from the card\'s root down, parent links only', () => {
  assert.deepStrictEqual(htreeIds(BOARD, 4), set(['1', '2', '3', '4', '5']));
  assert.deepStrictEqual(htreeIds(BOARD, 7), set(['6', '7']));
  assert.deepStrictEqual(htreeIds(BOARD, 10), set(['10']));
});

test('dpathIds: everything the card waits for and everything waiting on it, transitively, waiting_for only', () => {
  assert.deepStrictEqual(dpathIds(BOARD, 5), set(['4', '5', '8', '9']), 'it waits for 4, and 8 and 9 wait for it');
  assert.deepStrictEqual(dpathIds(BOARD, 3), set(['2', '3']));
  assert.deepStrictEqual(dpathIds(BOARD, 8), set(['4', '5', '8']), 'a sibling that waits on the same card is no part of it');
  assert.deepStrictEqual(dpathIds(BOARD, 10), set(['10']));
});

test('dtreeIds: the connected set over waiting_for, so the sibling that waits on the same card is in', () => {
  assert.deepStrictEqual(dtreeIds(BOARD, 8), set(['4', '5', '8', '9']));
  assert.deepStrictEqual(dtreeIds(BOARD, 2), set(['2', '3']));
  assert.deepStrictEqual(dtreeIds(BOARD, 10), set(['10']));
});

test('the four ignore the other relation: parents do not link a dependency set and dependencies do not link a hierarchy set', () => {
  assert.deepStrictEqual(dpathIds(BOARD, 1), set(['1']), '1 is a parent of 2 and 3 and waits for nothing');
  assert.deepStrictEqual(hpathIds(BOARD, 8), set(['8']), '8 waits for 5 and has no parent');
  assert.deepStrictEqual(dtreeIds(BOARD, 7), set(['7']));
  assert.deepStrictEqual(htreeIds(BOARD, 9), set(['9']));
});

test('an id may be a string or a number, and an unknown id or garbage is an empty set', () => {
  for (const fn of [hpathIds, htreeIds, dpathIds, dtreeIds]) {
    assert.deepStrictEqual(fn(BOARD, '5'), fn(BOARD, 5));
    assert.deepStrictEqual(fn(BOARD, 999), set());
    assert.deepStrictEqual(fn(BOARD, 'abc'), set());
    assert.deepStrictEqual(fn([], 1), set());
  }
});

test('a missing parent or a missing dependency is no edge and no member', () => {
  const lone = [{ id: '1', parent: 40, waiting_for: ['41'] }, { id: '2', parent: 1 }];
  assert.deepStrictEqual(hpathIds(lone, 2), set(['1', '2']));
  assert.deepStrictEqual(htreeIds(lone, 2), set(['1', '2']));
  assert.deepStrictEqual(dpathIds(lone, 1), set(['1']));
  assert.deepStrictEqual(dtreeIds(lone, 1), set(['1']));
});

test('a parent on another board is a root here, and the board\'s own name in board#id form is a parent', () => {
  const cards = [
    { id: '12', title: 'p' },
    { id: '13', parent: 'kanban#12' },
    { id: '14', parent: 'fpp#12' },
  ];
  assert.deepStrictEqual(htreeIds(cards, 13, { board: 'kanban' }), set(['12', '13']));
  assert.deepStrictEqual(hpathIds(cards, 14, { board: 'kanban' }), set(['14']), 'fpp#12 is another board\'s card');
  assert.deepStrictEqual(hpathIds(cards, 14, { board: 'fpp' }), set(['12', '14']));
  assert.deepStrictEqual(hpathIds(cards, 14), set(['14']), 'no board name, no own-name parent');
});

test('loops do not hang: a parent loop, a self-parent, a dependency loop and a self-wait', () => {
  const parents = [{ id: '1', parent: 2 }, { id: '2', parent: 1 }, { id: '3', parent: 3 }];
  assert.deepStrictEqual(hpathIds(parents, 1), set(['1', '2']));
  assert.deepStrictEqual(htreeIds(parents, 1), set(['1', '2']));
  assert.deepStrictEqual(htreeIds(parents, 2), set(['1', '2']));
  assert.deepStrictEqual(hpathIds(parents, 3), set(['3']));
  assert.deepStrictEqual(htreeIds(parents, 3), set(['3']));
  const waits = [{ id: '1', waiting_for: ['2'] }, { id: '2', waiting_for: ['1'] }, { id: '3', waiting_for: ['3'] }];
  assert.deepStrictEqual(dpathIds(waits, 1), set(['1', '2']));
  assert.deepStrictEqual(dtreeIds(waits, 2), set(['1', '2']));
  assert.deepStrictEqual(dpathIds(waits, 3), set(['3']));
  assert.deepStrictEqual(dtreeIds(waits, 3), set(['3']));
});

test('archived cards are walked like any other: archive is a location', () => {
  const cards = [{ id: '1' }, { id: '2', parent: 1, archived: true }, { id: '3', waiting_for: ['2'] }];
  assert.deepStrictEqual(hpathIds(cards, 1), set(['1', '2']));
  assert.deepStrictEqual(dpathIds(cards, 3), set(['2', '3']));
});

test('prefixed ids key as their whole id and never meet a bare number', () => {
  const cards = [{ id: 'G1' }, { id: 'G2', parent: 'G1' }, { id: '1' }, { id: '2', waiting_for: ['G1'] }];
  assert.deepStrictEqual(hpathIds(cards, 'G1'), set(['G1', 'G2']));
  assert.deepStrictEqual(htreeIds(cards, 'G2'), set(['G1', 'G2']));
  assert.deepStrictEqual(dtreeIds(cards, 'G1'), set(['G1', '2']));
  assert.deepStrictEqual(dtreeIds(cards, 1), set(['1']));
});
