const { test } = require('node:test');
const assert = require('node:assert');
const { buildRelationsGraph, layerNodes } = require('../web/dependency-graph');
const { MAP_OPTION_DEFAULTS, mapShapeRelations, mapOrderRow } = require('../web/map-relations');
const { card, treeWithArchivedAndBacklogChildren } = require('./map-fixtures');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const STATUSES = ['backlog', 'todo', 'review', 'qa', 'doing', 'done'];

const graphOf = (nodes, ghosts = []) => ({ nodes, ghosts });
const n = (id, status, extra = {}) => ({ id, status, archived: false, ...extra });

test('a row reads doing, todo, backlog, the other live statuses in column order, done, archived, then stubs', () => {
  const graph = graphOf(
    [n(1, 'done'), n(2, 'qa'), n(3, 'backlog'), n(4, 'done', { archived: true }), n(5, 'doing'), n(6, 'review'), n(7, 'todo')],
    [{ id: 8, status: 'doing' }],
  );
  assert.deepStrictEqual(mapOrderRow([1, 2, 3, 4, 5, 6, 7, 8], graph, 'status', STATUSES), [5, 7, 3, 6, 2, 1, 4, 8]);
});

test('cards of one rank keep the order the layout gave them', () => {
  const graph = graphOf([n(9, 'todo'), n(4, 'todo'), n(7, 'todo'), n(2, 'doing')]);
  assert.deepStrictEqual(mapOrderRow([9, 4, 7, 2], graph, 'status', STATUSES), [2, 9, 4, 7]);
});

test('the layout order choice leaves a row as the layout gave it', () => {
  const graph = graphOf([n(1, 'done'), n(2, 'doing')]);
  assert.deepStrictEqual(mapOrderRow([1, 2], graph, 'layout', STATUSES), [1, 2]);
});

test('an archived card is after a done one, whatever its own status', () => {
  const graph = graphOf([n(1, 'doing', { archived: true }), n(2, 'done'), n(3, 'backlog', { archived: true })]);
  assert.deepStrictEqual(mapOrderRow([1, 2, 3], graph, 'status', STATUSES), [2, 1, 3]);
});

test('status names compare without regard to case', () => {
  const graph = graphOf([n(1, 'Backlog'), n(2, 'DOING')]);
  assert.deepStrictEqual(mapOrderRow([1, 2], graph, 'status', STATUSES), [2, 1]);
});

test('a status the board does not list reads as another live status, after the listed ones', () => {
  const graph = graphOf([n(1, 'done'), n(2, 'mystery'), n(3, 'qa')]);
  assert.deepStrictEqual(mapOrderRow([1, 2, 3], graph, 'status', STATUSES), [3, 2, 1]);
});

test('every kind of stub is last: a hidden card, an id with no card, a parent on another board', () => {
  const graph = graphOf([n(1, 'done', { archived: true })], [{ id: 2, status: 'doing' }, { id: 3, status: null, missing: true }, { id: -1, status: null, missing: true, external: 'shop#7' }]);
  assert.deepStrictEqual(mapOrderRow([-1, 3, 2, 1], graph, 'status', STATUSES), [1, -1, 3, 2]);
});

test('the row is a new array: the one it was given is not reordered', () => {
  const row = [1, 2];
  mapOrderRow(row, graphOf([n(1, 'done'), n(2, 'doing')]), 'status', STATUSES);
  assert.deepStrictEqual(row, [1, 2]);
});

test('the first row of the archived-and-backlog tree starts with the two backlog children', () => {
  const [tree] = mapShapeRelations(buildRelationsGraph(treeWithArchivedAndBacklogChildren(), null, CTX), MAP_OPTION_DEFAULTS).graphs;
  const layer = layerNodes(tree.ids, tree.layoutEdges);
  const top = tree.ids.filter((id) => layer.get(id) === 0);
  assert.deepStrictEqual(top, [41, 47, 48, 49, 50, 51], 'the layout alone puts the oldest first');
  assert.deepStrictEqual(mapOrderRow(top, tree, 'status', ['backlog', 'todo', 'doing', 'done']), [47, 48, 41, 49, 50, 51]);
});
