const { test } = require('node:test');
const assert = require('node:assert');
const { buildRelationsGraph, layerNodes } = require('../web/dependency-graph');
const { MAP_OPTION_DEFAULTS, mapShapeRelations } = require('../web/map-relations');
const { card, familyChainingToOneEnd, treeWithArchivedAndBacklogChildren } = require('./map-fixtures');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };

function shape(cards, options = {}, visible = null) {
  return mapShapeRelations(buildRelationsGraph(cards, visible, CTX), { ...MAP_OPTION_DEFAULTS, ...options });
}
const all = (view, key) => view.graphs.flatMap((g) => g[key]);
const edgeKeys = (edges) => edges.map((e) => `${e.from}>${e.to}`).sort();
const layersOf = (view) => Object.fromEntries(view.graphs.flatMap((g) => [...layerNodes(g.ids, g.layoutEdges)]).sort((a, b) => a[0] - b[0]));

// --- dependency lines --------------------------------------------------------

test('dependency lines on draw every waiting_for edge, off draw none', () => {
  const cards = familyChainingToOneEnd();
  assert.strictEqual(all(shape(cards, { depLines: 'on' }), 'edges').length, 12);
  assert.strictEqual(all(shape(cards, { depLines: 'off' }), 'edges').length, 0);
});

// --- layout: keep or reflow --------------------------------------------------

test('with layout keep, no line toggle moves a card', () => {
  const cards = familyChainingToOneEnd();
  const reference = layersOf(shape(cards));
  for (const parentLines of ['chain', 'all', 'off']) {
    for (const depLines of ['on', 'off']) {
      assert.deepStrictEqual(layersOf(shape(cards, { parentLines, depLines })), reference, `${parentLines} / ${depLines}`);
    }
  }
});

test('with layout reflow, only the lines drawn place the cards', () => {
  const cards = familyChainingToOneEnd();
  const layers = layersOf(shape(cards, { relayout: 'reflow', parentLines: 'off', depLines: 'off' }));
  assert.deepStrictEqual(new Set(Object.values(layers)), new Set([0]), 'with nothing drawn every card sits in the first row');
  const chainOnly = layersOf(shape(cards, { relayout: 'reflow', parentLines: 'chain', depLines: 'off' }));
  assert.deepStrictEqual(chainOnly[10], 1);
  assert.deepStrictEqual(chainOnly[19], 0);
});

test('a parent sits after all its children when below, and before them when above', () => {
  const cards = familyChainingToOneEnd();
  const below = layersOf(shape(cards));
  assert.ok(Object.entries(below).every(([id, layer]) => Number(id) === 10 || layer < below[10]));
  const above = layersOf(shape(cards, { parent: 'above' }));
  assert.ok(Object.entries(above).every(([id, layer]) => Number(id) === 10 || layer > above[10]));
});

test('a child that waits on its parent is placed by that dependency alone, with no second edge for the pair', () => {
  const view = shape([card(1, 'todo'), card(2, 'todo', { parent: 1, waiting_for: [1] })]);
  assert.deepStrictEqual(edgeKeys(all(view, 'layoutEdges')), ['1>2']);
});

// --- which cards are in a graph, and which have no relation ----------------

test('a card with only a parent is in a graph, and a card with no relation at all is in No relations', () => {
  const view = shape([card(1, 'todo'), card(2, 'todo', { parent: 1 }), card(3, 'todo')]);
  assert.deepStrictEqual(view.noRelations, [3]);
  assert.deepStrictEqual(view.graphs.flatMap((g) => g.ids).sort(), [1, 2]);
});

test('a parent with children and nothing else is in a graph, not in No relations', () => {
  const view = shape(familyChainingToOneEnd());
  assert.deepStrictEqual(view.noRelations, []);
});

test('turning every line off leaves each card where its relations put it, and No relations unchanged', () => {
  const cards = [...familyChainingToOneEnd(), card(400, 'todo')];
  const on = shape(cards);
  const off = shape(cards, { parentLines: 'off', depLines: 'off' });
  assert.deepStrictEqual(off.noRelations, [400]);
  assert.deepStrictEqual(off.noRelations, on.noRelations);
  assert.deepStrictEqual(off.graphs.flatMap((g) => g.ids).sort(), on.graphs.flatMap((g) => g.ids).sort());
});

test('a visible card whose only relation is a hidden one is in a graph, beside the stub', () => {
  const view = shape([card(1, 'done'), card(2, 'todo', { parent: 1 })], {}, new Set([2]));
  assert.deepStrictEqual(view.noRelations, []);
  assert.deepStrictEqual(view.graphs.flatMap((g) => g.ids).sort(), [1, 2]);
  assert.deepStrictEqual(view.graphs[0].ghosts.map((g) => g.id), [1]);
});

test('a card whose parent is on another board is in a graph with that stub, not in No relations', () => {
  const view = shape([card(2, 'todo', { parent: 'shop#7' }), card(3, 'todo')]);
  assert.deepStrictEqual(view.noRelations, [3]);
  assert.strictEqual(view.graphs[0].ghosts[0].external, 'shop#7');
});

test('an empty board has no graph and nothing in No relations', () => {
  const view = shape([]);
  assert.deepStrictEqual(view.graphs, []);
  assert.deepStrictEqual(view.noRelations, []);
});
