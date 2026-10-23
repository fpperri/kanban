const { test } = require('node:test');
const assert = require('node:assert');
const {
  HOVER_SHOW_KINDS, HOVER_SHOW_GRAPHS, hoverShowDefaults, mergeHoverShow, hoverShowWith, hoverShowGraph, hoverShowIds, hoverShowTiles,
} = require('../web/hover-show');

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

test('the six sets, in the panel\'s order, and the two graph kinds that keep their own choice', () => {
  assert.deepStrictEqual(HOVER_SHOW_KINDS, ['dtree', 'htree', 'dpath', 'hpath', 'dlinks', 'hlinks']);
  assert.deepStrictEqual(HOVER_SHOW_GRAPHS, ['hierarchy', 'flow']);
});

test('the defaults: the Hierarchy lights dlinks and hlinks, the Flow dlinks alone, and each call gives a copy', () => {
  assert.deepStrictEqual(hoverShowDefaults(), { hierarchy: ['dlinks', 'hlinks'], flow: ['dlinks'] });
  hoverShowDefaults().hierarchy.push('dtree');
  assert.deepStrictEqual(hoverShowDefaults().hierarchy, ['dlinks', 'hlinks']);
});

test('mergeHoverShow: nothing, junk and a corrupt text read as the defaults', () => {
  for (const saved of [null, undefined, '', 'not json', '[]', '7', 7, [], true, '{"hierarchy": 3}']) {
    assert.deepStrictEqual(mergeHoverShow(saved), hoverShowDefaults(), String(saved));
  }
});

test('mergeHoverShow: a kept choice is read per graph kind, from the stored text or its parsed value', () => {
  const kept = { hierarchy: ['htree', 'dpath'], flow: ['dtree'] };
  assert.deepStrictEqual(mergeHoverShow(kept), kept);
  assert.deepStrictEqual(mergeHoverShow(JSON.stringify(kept)), kept);
  assert.deepStrictEqual(mergeHoverShow({ flow: ['hlinks'] }), { hierarchy: ['dlinks', 'hlinks'], flow: ['hlinks'] }, 'a kind the store lacks keeps its default');
});

test('mergeHoverShow: unknown sets and repeats drop, the rest come back in the panel\'s order', () => {
  assert.deepStrictEqual(mergeHoverShow({ hierarchy: ['hlinks', 'nope', 'dtree', 'hlinks', 7, null] }).hierarchy, ['dtree', 'hlinks']);
  assert.deepStrictEqual(mergeHoverShow({ hierarchy: ['tree', 'path'] }).hierarchy, [], 'only the six count');
});

test('mergeHoverShow: nothing ticked is a choice, not a missing one', () => {
  assert.deepStrictEqual(mergeHoverShow({ hierarchy: [], flow: [] }), { hierarchy: [], flow: [] });
});

test('mergeHoverShow: a kind the store holds that this version does not draw is dropped', () => {
  assert.deepStrictEqual(Object.keys(mergeHoverShow({ tiers: ['dtree'], hierarchy: ['dtree'] })), ['hierarchy', 'flow']);
});

test('hoverShowWith ticks or unticks one set of one graph kind, keeps the panel\'s order, and leaves the rest and its argument alone', () => {
  const start = hoverShowDefaults();
  const ticked = hoverShowWith(start, 'hierarchy', 'dtree', true);
  assert.deepStrictEqual(ticked, { hierarchy: ['dtree', 'dlinks', 'hlinks'], flow: ['dlinks'] });
  assert.deepStrictEqual(start, hoverShowDefaults(), 'the argument is not touched');
  assert.deepStrictEqual(hoverShowWith(ticked, 'hierarchy', 'dlinks', false).hierarchy, ['dtree', 'hlinks']);
  assert.deepStrictEqual(hoverShowWith(start, 'flow', 'hlinks', true).flow, ['dlinks', 'hlinks']);
  assert.deepStrictEqual(hoverShowWith(start, 'flow', 'dlinks', true), start, 'ticking a ticked set changes nothing');
  assert.deepStrictEqual(hoverShowWith(start, 'flow', 'dlinks', false).flow, [], 'the last one can be unticked');
});

test('hoverShowWith ignores a set or a graph kind it does not know', () => {
  const start = hoverShowDefaults();
  assert.deepStrictEqual(hoverShowWith(start, 'hierarchy', 'tree', true), start);
  assert.deepStrictEqual(hoverShowWith(start, 'tiers', 'dtree', true), start);
});

test('hoverShowGraph: the Flow has its own setting, and every other view (the Hierarchy, the Board, the Map) reads the Hierarchy\'s', () => {
  assert.strictEqual(hoverShowGraph('graph', 'flow'), 'flow');
  assert.strictEqual(hoverShowGraph('graph', 'hierarchy'), 'hierarchy');
  for (const view of ['board', 'map', 'calendar', 'gantt']) {
    assert.strictEqual(hoverShowGraph(view, 'flow'), 'hierarchy', `${view} reads the Hierarchy's setting even when the Graph last showed the Flow`);
  }
  assert.strictEqual(hoverShowGraph('graph', 'tiers'), 'hierarchy', 'a layout this version does not draw reads as the Hierarchy');
});

test('hoverShowIds: the union of the ticked sets for the card', () => {
  assert.deepStrictEqual(hoverShowIds(['dlinks', 'hlinks'], BOARD, 3), set(['1', '2', '3', '5']), 'waits for 2, parent 1, child 5');
  assert.deepStrictEqual(hoverShowIds(['dlinks'], BOARD, 5), set(['4', '5', '8', '9']));
  assert.deepStrictEqual(hoverShowIds(['hlinks'], BOARD, 5), set(['3', '5']));
  assert.deepStrictEqual(hoverShowIds(['dpath', 'hpath'], BOARD, 5), set(['1', '3', '4', '5', '8', '9']), 'two transitive sets, one over each relation');
  assert.deepStrictEqual(hoverShowIds(['dtree'], BOARD, 8), set(['4', '5', '8', '9']));
  assert.deepStrictEqual(hoverShowIds(['htree'], BOARD, 7), set(['6', '7']));
});

test('hoverShowIds: all six together are the cards any of them reach, each card once', () => {
  const all = hoverShowIds(HOVER_SHOW_KINDS, BOARD, 4);
  assert.deepStrictEqual(all, set(['1', '2', '3', '4', '5', '8', '9']));
});

test('hoverShowIds: nothing ticked is an empty set, a card the board lacks is an empty set, and a stranger is itself', () => {
  assert.deepStrictEqual(hoverShowIds([], BOARD, 3), set([]));
  assert.deepStrictEqual(hoverShowIds(['dlinks', 'hlinks'], BOARD, 99), set([]));
  assert.deepStrictEqual(hoverShowIds(HOVER_SHOW_KINDS, BOARD, 10), set(['10']));
});

test('hoverShowIds: a set this version does not know adds nothing, and the card may be given as a number', () => {
  assert.deepStrictEqual(hoverShowIds(['tree', 'dlinks'], BOARD, 5), set(['4', '5', '8', '9']));
  assert.deepStrictEqual(hoverShowIds(['dlinks'], BOARD, 5), hoverShowIds(['dlinks'], BOARD, '5'));
});

test('hoverShowIds: archived cards count, as in the sets themselves', () => {
  const board = BOARD.concat([{ id: '11', status: 'archive', parent: 10 }]);
  assert.deepStrictEqual(hoverShowIds(['hlinks'], board, 10), set(['10', '11']));
});

test('hoverShowIds follows the ctx the sets are given: a parent on another board is no link', () => {
  const board = [{ id: '1', status: 'todo', parent: 'fpp#4' }, { id: '2', status: 'todo', parent: 1 }, { id: '3', status: 'todo', parent: 'kanban#2' }];
  assert.deepStrictEqual(hoverShowIds(['hlinks'], board, 1, { board: 'kanban' }), set(['1', '2']));
  assert.deepStrictEqual(hoverShowIds(['hlinks'], board, 3, { board: 'kanban' }), set(['2', '3']), 'the board own name in board#id form is a parent');
});

test('hoverShowTiles: the cards that take the hover look outside the Graph are the card and its sets', () => {
  assert.deepStrictEqual(hoverShowTiles(['dlinks', 'hlinks'], BOARD, 3), set(['1', '2', '3', '5']));
  assert.deepStrictEqual(hoverShowTiles([], BOARD, 3), set(['3']), 'with nothing ticked the hovered card still takes the look, as it always has');
  assert.deepStrictEqual(hoverShowTiles(['dlinks'], BOARD, 99), set(['99']), 'a card the board lacks (a lane header, say) is itself');
  assert.strictEqual(hoverShowTiles(['dlinks'], BOARD, null), null, 'nothing hovered, nothing lit');
});

test('with the defaults the Graph\'s hover lights what it lit before: the card and one hop over parent and waiting_for', () => {
  for (const id of BOARD.map((c) => c.id)) {
    const hops = new Set([id]);
    for (const c of BOARD) {
      const related = [...(c.waiting_for || []).map(String), ...(c.parent === undefined ? [] : [String(c.parent)])];
      if (c.id === id) related.forEach((r) => hops.add(r));
      if (related.includes(id)) hops.add(c.id);
    }
    assert.deepStrictEqual(hoverShowIds(hoverShowDefaults().hierarchy, BOARD, id), hops, `card ${id}`);
  }
});

test('with the Flow default the hover lights what the Flow lit before: the card and one hop over waiting_for alone', () => {
  assert.deepStrictEqual(hoverShowIds(hoverShowDefaults().flow, BOARD, 3), set(['2', '3']));
  assert.deepStrictEqual(hoverShowIds(hoverShowDefaults().flow, BOARD, 1), set(['1']), 'a parent is no line in the Flow');
});
