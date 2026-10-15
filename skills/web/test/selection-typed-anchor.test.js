const { test } = require('node:test');
const assert = require('node:assert');
const {
  NO_SELECTION, cardPart, pathPart, queryPart, setAnchor, addPart, removeCard, pruneSelectionParts,
  typedQueryPart, isTypedAnchor, selectionAfterTyping, selectionOnViewSwitch, loneCard, selectionAfterClick,
} = require('../web/selection');
const { parseSearchQuery, filterCards } = require('../web/search');

// A search typed in the Graph is the anchor of the selection, and the anchor keeps
// where it came from: a typed query is the one anchor that stops being one when
// the Graph is left (R14), where a pill's query stays. These are the pure
// operations; the page's plumbing is pinned in graph-lights-wiring.test.js.

const parts = (selection) => [selection.anchor, ...selection.additions];
const selectionOf = (...list) => list.reduce((s, part) => addPart(s, part), NO_SELECTION);

test('a typed query is a query part that remembers it was typed', () => {
  assert.deepStrictEqual(typedQueryPart('zephyr'), { kind: 'query', text: 'zephyr', source: 'typing' });
  assert.strictEqual(queryPart('zephyr').source, undefined, 'a pill\'s query carries no such source');
});

test('only an anchor that is a typed query is a typed anchor: not a card, not a pill\'s query, not a typed query that is an addition', () => {
  assert.strictEqual(isTypedAnchor(selectionOf(typedQueryPart('zephyr'))), true);
  assert.strictEqual(isTypedAnchor(selectionOf(queryPart('zephyr'))), false);
  assert.strictEqual(isTypedAnchor(selectionOf(cardPart(1))), false);
  assert.strictEqual(isTypedAnchor(selectionOf(cardPart(1), typedQueryPart('zephyr'))), false);
  assert.strictEqual(isTypedAnchor(NO_SELECTION), false);
});

// --- typing in the Graph --------------------------------------------------------------

test('typing into an empty selection makes the text the anchor', () => {
  assert.deepStrictEqual(selectionAfterTyping(NO_SELECTION, 'zephyr'), { anchor: typedQueryPart('zephyr'), additions: [] });
});

test('typing while a card is the anchor makes the text a new anchor and drops the card and its additions, as a click on a card does the other way round', () => {
  const picked = selectionOf(cardPart(1), cardPart(2), pathPart(3));
  assert.deepStrictEqual(selectionAfterTyping(picked, 'zephyr'), { anchor: typedQueryPart('zephyr'), additions: [] });
});

test('typing again while the text is the anchor changes the text and keeps the additions', () => {
  const picked = selectionOf(typedQueryPart('zeph'), cardPart(5), cardPart(6));
  assert.deepStrictEqual(selectionAfterTyping(picked, 'zephyr'), { anchor: typedQueryPart('zephyr'), additions: [cardPart(5), cardPart(6)] });
});

test('typing the text that is already the anchor changes nothing, not even the reference', () => {
  const picked = selectionOf(typedQueryPart('zephyr'), cardPart(5));
  assert.strictEqual(selectionAfterTyping(picked, 'zephyr'), picked);
});

test('an empty box drops the typed anchor and its additions together: the model has no anchor-less state', () => {
  const picked = selectionOf(typedQueryPart('zephyr'), cardPart(5), cardPart(6));
  assert.strictEqual(selectionAfterTyping(picked, ''), NO_SELECTION);
  assert.strictEqual(selectionAfterTyping(picked, '   '), NO_SELECTION, 'blanks are an empty box');
});

test('an empty box leaves a selection whose anchor is not a typed query as it was', () => {
  for (const picked of [NO_SELECTION, selectionOf(cardPart(1), cardPart(2)), selectionOf(queryPart('blocked:'), cardPart(2))]) {
    assert.strictEqual(selectionAfterTyping(picked, ''), picked);
  }
});

test('typing hands back a new selection and changes none it was given', () => {
  const picked = selectionOf(typedQueryPart('zeph'), cardPart(5));
  selectionAfterTyping(picked, 'zephyr');
  selectionAfterTyping(picked, '');
  assert.deepStrictEqual(parts(picked), [typedQueryPart('zeph'), cardPart(5)]);
});

// --- leaving and entering the Graph ---------------------------------------------------

test('leaving the Graph drops a typed anchor and nothing else; the first addition becomes the anchor, as when any anchor goes', () => {
  const picked = selectionOf(typedQueryPart('zephyr'), cardPart(5), cardPart(6));
  const left = selectionOnViewSwitch(picked, { from: 'graph', to: 'board', boxText: 'zephyr' });
  assert.deepStrictEqual(left, { anchor: cardPart(5), additions: [cardPart(6)] });
  assert.strictEqual(selectionOnViewSwitch(selectionOf(typedQueryPart('zephyr')), { from: 'graph', to: 'map', boxText: 'zephyr' }).anchor, null, 'a typed query alone leaves nothing selected');
});

test('leaving the Graph keeps every other selection as it was, the same reference', () => {
  for (const picked of [NO_SELECTION, selectionOf(cardPart(1), cardPart(2)), selectionOf(queryPart('blocked:'), cardPart(2)), selectionOf(cardPart(1), typedQueryPart('zephyr'))]) {
    for (const to of ['board', 'map', 'calendar', 'gantt']) {
      assert.strictEqual(selectionOnViewSwitch(picked, { from: 'graph', to, boxText: 'zephyr' }), picked, to);
    }
  }
});

test('entering the Graph with nothing selected makes the box the anchor again', () => {
  const entered = selectionOnViewSwitch(NO_SELECTION, { from: 'board', to: 'graph', boxText: 'zephyr' });
  assert.deepStrictEqual(entered, { anchor: typedQueryPart('zephyr'), additions: [] });
});

test('entering the Graph with an empty box, or with something selected, changes nothing: a selection carried in stays and the box has no effect until it is edited', () => {
  const carried = selectionOf(cardPart(1), cardPart(2));
  assert.strictEqual(selectionOnViewSwitch(NO_SELECTION, { from: 'board', to: 'graph', boxText: '' }), NO_SELECTION);
  assert.strictEqual(selectionOnViewSwitch(NO_SELECTION, { from: 'board', to: 'graph', boxText: '  ' }), NO_SELECTION);
  assert.strictEqual(selectionOnViewSwitch(carried, { from: 'board', to: 'graph', boxText: 'zephyr' }), carried);
});

test('a switch between two views that are not the Graph changes nothing', () => {
  const carried = selectionOf(cardPart(1));
  assert.strictEqual(selectionOnViewSwitch(carried, { from: 'board', to: 'map', boxText: 'zephyr' }), carried);
  assert.strictEqual(selectionOnViewSwitch(NO_SELECTION, { from: 'board', to: 'map', boxText: 'zephyr' }), NO_SELECTION);
});

// --- the lone card --------------------------------------------------------------------

test('a lone card is a selection that is one card part: the anchor with no additions', () => {
  assert.strictEqual(loneCard(selectionOf(cardPart(7))), 7);
  assert.strictEqual(loneCard(NO_SELECTION), null);
  assert.strictEqual(loneCard(selectionOf(cardPart(7), cardPart(8))), null);
});

test('a query is never a lone card, however few cards it matches; nor is a path or a tree', () => {
  assert.strictEqual(loneCard(selectionOf(typedQueryPart('zephyr'))), null);
  assert.strictEqual(loneCard(selectionOf(queryPart('blocked:'))), null);
  assert.strictEqual(loneCard(selectionOf(pathPart(7))), null);
});

// --- the rest of the model carries the source -----------------------------------------

test('the parts keep their source through a poll that prunes gone cards and through taking a card out', () => {
  const board = [{ id: 1, title: 'zephyr one', body: '', status: 'todo', tags: [] }, { id: 2, title: 'zephyr two', body: '', status: 'todo', tags: [] }, { id: 3, title: 'other', body: '', status: 'todo', tags: [] }];
  const match = (text) => new Set(filterCards(board, parseSearchQuery(text), {}).map((c) => c.id));
  const typed = selectionOf(typedQueryPart('zephyr'), cardPart(3));
  assert.strictEqual(isTypedAnchor(pruneSelectionParts(typed, [1, 2, 3])), true);
  assert.strictEqual(isTypedAnchor(pruneSelectionParts(typed, [1, 2])), true, 'the card addition went, the query stays');
  assert.strictEqual(isTypedAnchor(removeCard(typed, 3, match)), true, 'a card taken out of the additions leaves the anchor');
  const turned = removeCard(typed, 1, match);
  assert.strictEqual(isTypedAnchor(turned), false, 'a card taken out of the query turns the query into its other cards, which were not typed');
  assert.deepStrictEqual(parts(turned), [cardPart(2), cardPart(3)]);
});

test('a plain click on a card sets a card anchor, so the typed anchor is gone; Shift or Ctrl adds the card and keeps the typed anchor (R3)', () => {
  const typed = selectionOf(typedQueryPart('zephyr'));
  const match = () => new Set();
  const resolved = new Set([1]);
  const click = (action, id) => selectionAfterClick(action, id, { selection: typed, resolved, rangeStart: null, order: [], matchQuery: match }).selection;
  assert.deepStrictEqual(click('select', 9), { anchor: cardPart(9), additions: [] });
  assert.deepStrictEqual(click('toggle', 9), { anchor: typedQueryPart('zephyr'), additions: [cardPart(9)] });
});

test('setting the anchor from a card replaces a typed anchor and its additions', () => {
  assert.deepStrictEqual(setAnchor(selectionOf(typedQueryPart('zephyr'), cardPart(5)), cardPart(9)), { anchor: cardPart(9), additions: [] });
});
