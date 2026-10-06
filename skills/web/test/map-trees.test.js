const { test } = require('node:test');
const assert = require('node:assert');
const { buildRelationsGraph } = require('../web/dependency-graph');
const { MAP_OPTION_DEFAULTS, mapShapeRelations } = require('../web/map-relations');
const { card, familyChainingToOneEnd, treeWithArchivedAndBacklogChildren } = require('./map-fixtures');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };

function shape(cards, options = {}, visible = null) {
  return mapShapeRelations(buildRelationsGraph(cards, visible, CTX), { ...MAP_OPTION_DEFAULTS, ...options });
}
const idsOf = (graph) => [...graph.ids].sort((a, b) => a - b);

// Two real trees and a loose chain, as one board holds them side by side.
const board = () => [
  ...familyChainingToOneEnd(),
  ...treeWithArchivedAndBacklogChildren(),
  card(500, 'todo'),
  card(501, 'todo', { waiting_for: [500] }),
];

test('one graph per tree, the biggest first', () => {
  const view = shape(board());
  assert.deepStrictEqual(view.graphs.map(idsOf), [
    [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
    [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    [500, 501],
  ]);
});

test('trees of the same size come in order of their lowest card', () => {
  const view = shape([card(9, 'todo'), card(10, 'todo', { parent: 9 }), card(3, 'todo'), card(4, 'todo', { parent: 3 })]);
  assert.deepStrictEqual(view.graphs.map(idsOf), [[3, 4], [9, 10]]);
});

test('the one-graph choice holds every related card in a single graph', () => {
  const view = shape(board(), { group: 'one' });
  assert.strictEqual(view.graphs.length, 1);
  assert.strictEqual(view.graphs[0].ids.length, 24);
});

test('a graph carries only its own edges, lines and layout edges', () => {
  const view = shape(board());
  const family = view.graphs.find((g) => g.ids.includes(10));
  assert.ok(family.edges.every((e) => family.ids.includes(e.from) && family.ids.includes(e.to)));
  assert.deepStrictEqual(family.lines.map((l) => l.child), [19]);
  assert.ok(family.layoutEdges.every((e) => family.ids.includes(e.from) && family.ids.includes(e.to)));
  assert.strictEqual(view.graphs.flatMap((g) => g.edges).length, 12 + 8 + 1);
});

test('a card stays in its tree whichever lines are drawn', () => {
  const on = shape(board());
  for (const options of [{ parentLines: 'off' }, { depLines: 'off' }, { parentLines: 'off', depLines: 'off', relayout: 'reflow' }]) {
    assert.deepStrictEqual(shape(board(), options).graphs.map(idsOf), on.graphs.map(idsOf), JSON.stringify(options));
  }
});

test('cards linked only through the same parent on another board share a tree; another mention is another tree', () => {
  const view = shape([
    card(2, 'todo', { parent: 'shop#7' }),
    card(3, 'todo', { parent: 'shop#7' }),
    card(4, 'todo', { parent: 'shop#8' }),
  ]);
  assert.strictEqual(view.graphs.length, 2);
  assert.deepStrictEqual(view.graphs[0].nodes.map((n) => n.id).sort(), [2, 3]);
  assert.deepStrictEqual(view.graphs[1].nodes.map((n) => n.id), [4]);
});

test('a stub is part of the tree it joins and counts for the size order', () => {
  const view = shape([card(1, 'todo'), card(2, 'todo', { parent: 1 }), card(3, 'todo', { parent: 1 }), card(7, 'todo', { parent: 99 })],
    {}, new Set([1, 2, 7]));
  assert.deepStrictEqual(view.graphs.map((g) => g.nodes.length), [2, 1]);
  assert.deepStrictEqual(view.graphs[0].ghosts.map((g) => g.id), [3]);
  assert.deepStrictEqual(view.graphs[1].ghosts.map((g) => g.id), [99]);
});

// --- the roots a graph's heading names ---------------------------------------

test('the heading of a family names its root', () => {
  const [family] = shape(familyChainingToOneEnd()).graphs;
  assert.deepStrictEqual(family.roots, [10]);
});

test('a tree with two roots names both, lowest first', () => {
  const [tree] = shape([card(5, 'todo'), card(2, 'todo'), card(6, 'todo', { parent: 5, waiting_for: [3] }), card(3, 'todo', { parent: 2, waiting_for: [6] })]).graphs;
  assert.deepStrictEqual(tree.roots, [2, 5]);
});

test('a chain with no parent names the card that waits on none', () => {
  const [chain] = shape([card(2, 'todo', { waiting_for: [1] }), card(1, 'todo'), card(3, 'todo', { waiting_for: [2] })]).graphs;
  assert.deepStrictEqual(chain.roots, [1]);
});

test('a child whose parent is a stub is the root of what is shown', () => {
  const [tree] = shape([card(1, 'todo'), card(2, 'todo', { parent: 1 })], {}, new Set([2])).graphs;
  assert.deepStrictEqual(tree.roots, [2]);
});

test('a loop of parents still names a root', () => {
  const [loop] = shape([card(1, 'todo', { parent: 2 }), card(2, 'todo', { parent: 1 })]).graphs;
  assert.deepStrictEqual(loop.roots, [1]);
});
