const { test } = require('node:test');
const assert = require('node:assert');
const { buildRelationsGraph, layerNodes, treeIds } = require('../web/dependency-graph');
const { MAP_OPTION_DEFAULTS, mapShapeRelations } = require('../web/map-relations');
const { familyChainingToOneEnd, treeWithArchivedAndBacklogChildren } = require('./map-fixtures');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };

// What the Map draws for a search such as tree:<id>: the relations of the visible
// cards, shaped by the options.
function shape(cards, options = {}, rootId = null) {
  const visible = rootId == null ? null : treeIds(cards, rootId, CTX);
  return mapShapeRelations(buildRelationsGraph(cards, visible, CTX), { ...MAP_OPTION_DEFAULTS, ...options });
}

const linesOf = (view) => view.graphs.flatMap((g) => g.lines).map((l) => [l.parent, l.child]).sort((a, b) => a[1] - b[1]);

test('the parent below its children draws one parent line, from the child that ends the chain', () => {
  const view = shape(familyChainingToOneEnd(), {}, 10);
  assert.deepStrictEqual(linesOf(view), [[10, 19]]);
});

test('the parent above its children draws two, to the children that start the chain', () => {
  const view = shape(familyChainingToOneEnd(), { parent: 'above' }, 10);
  assert.deepStrictEqual(linesOf(view), [[10, 11], [10, 12]]);
});

test('parent lines "all" draws one to each of the nine children, "off" draws none', () => {
  const cards = familyChainingToOneEnd();
  assert.strictEqual(linesOf(shape(cards, { parentLines: 'all' }, 10)).length, 9);
  assert.strictEqual(linesOf(shape(cards, { parentLines: 'off' }, 10)).length, 0);
});
