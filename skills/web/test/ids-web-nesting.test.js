const { test } = require('node:test');
const assert = require('node:assert');
const nesting = require('../web/nesting');

// A board holding #7 and #G7 (and #9, #10): the whole id is the identity, so
// the outline, the tree and the parent reader treat #7 and #G7 as two cards.
const ctx = { board: 'main', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra) => ({ id, priority: 'Normal', ...extra });

test('parseParent reads a prefixed id and hands the whole id back as a string', () => {
  assert.deepStrictEqual(nesting.parseParent('G7', 'main'), { board: null, id: 'G7', local: true });
  assert.deepStrictEqual(nesting.parseParent('main#G7', 'main'), { board: null, id: 'G7', local: true });
  assert.deepStrictEqual(nesting.parseParent('other#G7', 'main'), { board: 'other', id: 'G7', local: false });
  assert.deepStrictEqual(nesting.parseParent('12', 'main'), { board: null, id: '12', local: true });
  assert.deepStrictEqual(nesting.parseParent(12, 'main'), { board: null, id: '12', local: true });
  assert.deepStrictEqual(nesting.parseParent('0012', 'main'), { board: null, id: '12', local: true });
  assert.strictEqual(nesting.parseParent('g7', 'main'), null);
  assert.strictEqual(nesting.parseParent('other#g7', 'main'), null);
});

test('#7 and #G7 are two cards: each keeps its own children in the outline', () => {
  const cards = [card('7'), card('G7'), card('10', { parent: '7' }), card('9', { parent: 'G7' }), card('11', { parent: '7' })];
  assert.deepStrictEqual(nesting.outlineOrder(cards, ctx).ids, ['7', '10', '11', 'G7', '9']);
  assert.deepStrictEqual(nesting.childrenOf(cards, 'G7', ctx).map((c) => c.id), ['9']);
  assert.deepStrictEqual(nesting.childrenOf(cards, '7', ctx).map((c) => c.id), ['10', '11']);
});

test('numbers and strings name the same card, so a payload that sends either nests the same way', () => {
  const cards = [card(7), card('G7'), card(10, { parent: 7 })];
  assert.deepStrictEqual(nesting.outlineOrder(cards, ctx).ids, ['7', '10', 'G7']);
  assert.deepStrictEqual(nesting.childrenOf(cards, '7', ctx).map((c) => c.id), [10]);
});

test('siblings with no rank sort plain ids first and #9 before #10', () => {
  const cards = [card('G1'), card('10'), card('9'), card('_2'), card('G10')];
  assert.deepStrictEqual(nesting.outlineOrder(cards, ctx).ids, ['9', '10', 'G1', 'G10', '_2']);
});

test('the thread, the depth and the roll-up follow a prefixed parent', () => {
  const cards = [card('G7'), card('7', { parent: 'G7' }), card('8', { parent: '7' })];
  assert.deepStrictEqual(nesting.threadOf(cards, '8', ctx).map((e) => e.id), ['G7', '7']);
  assert.strictEqual(nesting.depthOf(cards, '8', ctx), 2);
  assert.strictEqual(nesting.depthMap(cards, ctx).get('8'), 2);
  const idx = nesting.rollupIndex(cards, ctx);
  assert.strictEqual(idx.altitudeOf('G7'), 2);
  assert.strictEqual(idx.altitudeOf('7'), 1);
  assert.deepStrictEqual(idx.leavesBelow('G7').map((c) => c.id), ['8']);
});

test('a parent loop is entered at its lowest id', () => {
  const cards = [card('G1', { parent: 'G2' }), card('G2', { parent: 'G1' }), card('5', { parent: '5x' })];
  assert.deepStrictEqual(nesting.outlineOrder(cards, ctx).ids, ['5', 'G1', 'G2']);
});

test('reorder names neighbours by whole id', () => {
  const cards = [card('7', { rank: 10 }), card('G7', { rank: 20 }), card('9', { rank: 30 })];
  assert.deepStrictEqual(nesting.reorderPlan(cards, '9', { prev: '7', next: 'G7' }, ctx), { rank: 15, renumber: [] });
  assert.deepStrictEqual(nesting.reorderPlan(cards, '9', { prev: null, next: '7' }, ctx), { rank: 0, renumber: [] });
  assert.ok(nesting.reorderPlan(cards, '9', { prev: '9', next: 'G7' }, ctx).error);
});
