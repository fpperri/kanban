const { test } = require('node:test');
const assert = require('node:assert');
const { buildRelationsGraph, buildDependencyGraph } = require('../web/dependency-graph');
const { mapShapeRelations } = require('../web/map-relations');
const { card, familyChainingToOneEnd } = require('./map-fixtures');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const ids = (list) => list.map((x) => x.id).sort((a, b) => a - b);
const pairKeys = (rel) => rel.pairs.map((p) => `${p.child}>${p.parent}`).sort();

test('every card is a node, every waiting_for an edge, and each child a pair with its parent', () => {
  const rel = buildRelationsGraph(familyChainingToOneEnd(), null, CTX);
  assert.deepStrictEqual(ids(rel.nodes), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.strictEqual(rel.edges.length, 12);
  assert.ok(rel.edges.every((e) => e.kind === 'dep'), 'a parent is not a dependency');
  assert.strictEqual(rel.pairs.length, 9);
  assert.deepStrictEqual(rel.ghosts, []);
});

test('only the immediate parent is paired: a grandchild is never paired with its grandparent', () => {
  const rel = buildRelationsGraph([card(1, 'todo'), card(2, 'todo', { parent: 1 }), card(3, 'todo', { parent: 2 })], null, CTX);
  assert.deepStrictEqual(pairKeys(rel), ['2>1', '3>2']);
});

test('a parent written as this board\'s own name pairs like a plain id', () => {
  const rel = buildRelationsGraph([card(1, 'todo'), card(2, 'todo', { parent: 'kanban#1' })], null, CTX);
  assert.deepStrictEqual(pairKeys(rel), ['2>1']);
});

test('a card that is its own parent is paired with nobody', () => {
  const rel = buildRelationsGraph([card(1, 'todo', { parent: 1 })], null, CTX);
  assert.deepStrictEqual(rel.pairs, []);
});

test('a hidden parent of a visible child is a dimmed stub that still holds its place in the pair', () => {
  const rel = buildRelationsGraph([card(1, 'done'), card(2, 'todo', { parent: 1 })], new Set([2]), CTX);
  assert.deepStrictEqual(ids(rel.nodes), [2]);
  assert.deepStrictEqual(ids(rel.ghosts), [1]);
  assert.strictEqual(rel.ghosts[0].status, 'done');
  assert.deepStrictEqual(pairKeys(rel), ['2>1']);
});

test('a hidden child of a visible parent is a stub too', () => {
  const rel = buildRelationsGraph([card(1, 'todo'), card(2, 'todo', { parent: 1 })], new Set([1]), CTX);
  assert.deepStrictEqual(ids(rel.ghosts), [2]);
  assert.deepStrictEqual(pairKeys(rel), ['2>1']);
});

test('a pair with neither end visible is left out, and so are its stubs', () => {
  const rel = buildRelationsGraph([card(1, 'todo'), card(2, 'todo', { parent: 1 }), card(3, 'todo')], new Set([3]), CTX);
  assert.deepStrictEqual(rel.pairs, []);
  assert.deepStrictEqual(rel.ghosts, []);
});

test('a parent id with no card is a "not found" stub, and each child keeps its own pair to it', () => {
  const rel = buildRelationsGraph([card(2, 'todo', { parent: 99 }), card(3, 'todo', { parent: 99 })], null, CTX);
  assert.deepStrictEqual(pairKeys(rel), ['2>99', '3>99']);
  assert.strictEqual(rel.ghosts.length, 1);
  assert.strictEqual(rel.ghosts[0].id, 99);
  assert.strictEqual(rel.ghosts[0].missing, true);
  assert.strictEqual(rel.pairs[0].ends, null);
});

test('a parent on another board is one stub named by its mention, shared by every child that names it', () => {
  const rel = buildRelationsGraph([
    card(2, 'todo', { parent: 'shop#7' }),
    card(3, 'todo', { parent: 'shop#7' }),
    card(4, 'todo', { parent: 'shop#8' }),
  ], null, CTX);
  assert.deepStrictEqual(rel.ghosts.map((g) => g.external).sort(), ['shop#7', 'shop#8']);
  const stub = (ref) => rel.ghosts.find((g) => g.external === ref);
  assert.ok(stub('shop#7').id < 0, 'a stub has an id no card can have');
  assert.deepStrictEqual(rel.pairs.filter((p) => p.parent === stub('shop#7').id).map((p) => p.child), [2, 3]);
  assert.ok(rel.pairs.every((p) => p.ends === null));
});

test('a hidden child of a parent on another board brings no stub', () => {
  const rel = buildRelationsGraph([card(1, 'todo'), card(2, 'todo', { parent: 'shop#7' })], new Set([1]), CTX);
  assert.deepStrictEqual(rel.ghosts, []);
  assert.deepStrictEqual(rel.pairs, []);
});

test('which children end a family is read on the whole board, so hiding a sibling never moves a line', () => {
  const cards = familyChainingToOneEnd();
  const visible = new Set([10, 16, 17, 18]);
  const rel = buildRelationsGraph(cards, visible, CTX);
  const end = rel.pairs.filter((p) => p.ends.below).map((p) => p.child);
  assert.deepStrictEqual(end, [19], 'the one child that ends the chain is a stub here, and still the one');
  assert.deepStrictEqual(ids(rel.ghosts).includes(19), true);
});

test('a dependency between a child and its parent is an edge and still a pair', () => {
  const rel = buildRelationsGraph([card(1, 'todo'), card(2, 'todo', { parent: 1, waiting_for: [1] })], null, CTX);
  assert.deepStrictEqual(rel.edges.map((e) => `${e.from}>${e.to}`), ['1>2']);
  assert.deepStrictEqual(pairKeys(rel), ['2>1']);
});

test('a hidden child in the middle of a chain is a stub of its visible parent, though no visible card waits on it', () => {
  const rel = buildRelationsGraph([
    card(1, 'todo'),
    card(2, 'todo', { parent: 1 }),
    card(3, 'todo', { parent: 1, waiting_for: [2] }),
    card(4, 'todo', { parent: 1, waiting_for: [3] }),
  ], new Set([1, 4]), CTX);
  assert.deepStrictEqual(ids(rel.ghosts), [2, 3]);
  assert.deepStrictEqual(pairKeys(rel), ['2>1', '3>1', '4>1']);
});

test('a card id present twice is one node, the copy the card lookup resolves (the archived one)', () => {
  const cards = [card(5, 'todo'), card(5, 'done', { archived: true }), card(6, 'todo'), card(7, 'todo', { waiting_for: [6] })];
  const rel = buildRelationsGraph(cards, null, CTX);
  assert.deepStrictEqual(rel.nodes.map((n) => n.id), [5, 6, 7]);
  assert.strictEqual(rel.nodes[0].archived, true);
  assert.strictEqual(rel.nodes[0].status, 'done');
  assert.deepStrictEqual(mapShapeRelations(rel, {}).noRelations, [5]);
  const dep = buildDependencyGraph(cards, null, CTX);
  assert.deepStrictEqual(dep.nodes.map((n) => n.id), [5, 6, 7]);
  assert.strictEqual(dep.nodes[0].archived, true);
});
