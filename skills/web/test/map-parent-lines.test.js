const { test } = require('node:test');
const assert = require('node:assert');
const { mapParentLineEnds } = require('../web/map-relations');
const { familyChainingToOneEnd, treeWithArchivedAndBacklogChildren } = require('./map-fixtures');

// What the map hands the rule: every card whose parent is a card on the board.
const childrenOf = (cards) => cards
  .filter((c) => c.parent != null)
  .map((c) => ({ id: c.id, parent: c.parent, waitsOn: c.waiting_for }));

const endsOf = (children, side) => {
  const ends = mapParentLineEnds(children);
  return [...ends].filter(([, e]) => e[side]).map(([id]) => id).sort((a, b) => a - b);
};

test('a parent below its children is joined by the one child nobody waits on', () => {
  assert.deepStrictEqual(endsOf(childrenOf(familyChainingToOneEnd()), 'below'), [19]);
});

test('a parent above its children is joined by the two children that wait on no sibling', () => {
  assert.deepStrictEqual(endsOf(childrenOf(familyChainingToOneEnd()), 'above'), [11, 12]);
});

test('children with no dependency to or from a sibling always end a line, whichever side the parent sits', () => {
  const children = childrenOf(treeWithArchivedAndBacklogChildren());
  for (const loose of [47, 48, 49, 51]) {
    assert.deepStrictEqual({ ...mapParentLineEnds(children).get(loose) }, { below: true, above: true }, `#${loose}`);
  }
});

test('in a family with several chains each chain ends on its own', () => {
  const children = childrenOf(treeWithArchivedAndBacklogChildren());
  assert.deepStrictEqual(endsOf(children, 'below'), [43, 45, 47, 48, 49, 51]);
  assert.deepStrictEqual(endsOf(children, 'above'), [41, 47, 48, 49, 50, 51]);
});

test('a chain that loops has no end, so every child keeps its line', () => {
  const children = [
    { id: 2, parent: 1, waitsOn: [3] },
    { id: 3, parent: 1, waitsOn: [2] },
    { id: 4, parent: 1, waitsOn: [] },
  ];
  assert.deepStrictEqual(endsOf(children, 'below'), [2, 3, 4]);
  assert.deepStrictEqual(endsOf(children, 'above'), [2, 3, 4]);
});

test('only a dependency between siblings counts: a wait on the parent, on a cousin or on a missing card does not', () => {
  const children = [
    { id: 10, parent: 1, waitsOn: [1, 20, 99] },
    { id: 11, parent: 1, waitsOn: [10] },
    { id: 20, parent: 2, waitsOn: [] },
  ];
  assert.deepStrictEqual(endsOf(children, 'below'), [11, 20]);
  assert.deepStrictEqual(endsOf(children, 'above'), [10, 20]);
});

test('a card waiting for itself, or twice for the same sibling, changes nothing', () => {
  const children = [
    { id: 2, parent: 1, waitsOn: [2] },
    { id: 3, parent: 1, waitsOn: [2, 2] },
  ];
  assert.deepStrictEqual(endsOf(children, 'below'), [3]);
  assert.deepStrictEqual(endsOf(children, 'above'), [2]);
});

test('two parents are read apart, even when their children wait on each other', () => {
  const children = [
    { id: 10, parent: 1, waitsOn: [] },
    { id: 11, parent: 2, waitsOn: [10] },
  ];
  assert.deepStrictEqual({ ...mapParentLineEnds(children).get(10) }, { below: true, above: true });
  assert.deepStrictEqual({ ...mapParentLineEnds(children).get(11) }, { below: true, above: true });
});

test('a parent on a loop of parents still has each child as the end of its own family', () => {
  const children = [{ id: 1, parent: 2, waitsOn: [] }, { id: 2, parent: 1, waitsOn: [] }];
  assert.deepStrictEqual(endsOf(children, 'below'), [1, 2]);
});

test('no child means no ends', () => {
  assert.strictEqual(mapParentLineEnds([]).size, 0);
});
