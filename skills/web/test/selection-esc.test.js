const { test } = require('node:test');
const assert = require('node:assert');
const {
  NO_SELECTION, cardPart, pathPart, queryPart, setAnchor, addPart, resolveSelection, selectionAfterEscape,
} = require('../web/selection');
const { parseSearchQuery, filterCards } = require('../web/search');

// Esc steps the selection back one stage at a time: the first Esc drops every
// addition at once and leaves the anchor, the next drops the anchor. A bulk
// action takes its list of target cards once, when it starts, from the resolved
// selection. These are the pure parts; where the page wires them is pinned
// in selection-plumbing.test.js.

const grown = (...parts) => parts.reduce((next, part) => addPart(next, part), NO_SELECTION);
const idsOf = (set) => [...set].map(Number).sort((a, b) => a - b);

// --- the Esc step ------------------------------------------------------------------

test('the first Esc drops every addition at once and leaves the anchor', () => {
  const state = { selection: grown(cardPart(3), cardPart(5), pathPart(7), queryPart('tags:ui')), rangeStart: 5 };
  const next = selectionAfterEscape(state);
  assert.deepStrictEqual(next.selection, { anchor: cardPart(3), additions: [] });
});

test('the next Esc drops the anchor, and a third has nothing left to step back from', () => {
  const once = selectionAfterEscape({ selection: grown(cardPart(3), cardPart(5)), rangeStart: 5 });
  const twice = selectionAfterEscape(once);
  assert.deepStrictEqual(twice.selection, NO_SELECTION);
  assert.strictEqual(selectionAfterEscape(twice), twice, 'nothing picked: the same state comes back, so the caller skips the repaint');
});

test('the additions never drop one at a time: a selection of ten cards is anchor-only after one Esc', () => {
  const selection = grown(...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(cardPart));
  assert.deepStrictEqual(selectionAfterEscape({ selection, rangeStart: 10 }).selection, { anchor: cardPart(1), additions: [] });
});

test('an anchor that is a query stays a query after the first Esc and goes on the second', () => {
  const state = { selection: grown(queryPart('assignee:@afk'), cardPart(9)), rangeStart: 9 };
  const once = selectionAfterEscape(state);
  assert.deepStrictEqual(once.selection, { anchor: queryPart('assignee:@afk'), additions: [] });
  assert.deepStrictEqual(selectionAfterEscape(once).selection, NO_SELECTION);
});

test('a lone anchor goes on the first Esc', () => {
  const state = { selection: setAnchor(NO_SELECTION, cardPart(4)), rangeStart: 4 };
  assert.deepStrictEqual(selectionAfterEscape(state).selection, NO_SELECTION);
});

test('the range start follows: after the additions go it is the anchor card, so a Shift range cannot start from a card that is no longer picked', () => {
  const next = selectionAfterEscape({ selection: grown(cardPart(3), cardPart(5), cardPart(8)), rangeStart: 8 });
  assert.strictEqual(next.rangeStart, '3');
});

test('the range start is dropped when the anchor is not a card, and when the anchor goes', () => {
  assert.strictEqual(selectionAfterEscape({ selection: grown(queryPart('tags:ui'), cardPart(2)), rangeStart: 2 }).rangeStart, null);
  assert.strictEqual(selectionAfterEscape({ selection: grown(cardPart(3)), rangeStart: 3 }).rangeStart, null);
});

test('stepping back does not change the state handed in', () => {
  const state = { selection: grown(cardPart(3), cardPart(5)), rangeStart: 5 };
  const before = JSON.stringify(state);
  selectionAfterEscape(state);
  assert.strictEqual(JSON.stringify(state), before);
});

test('with nothing picked Esc changes nothing, whatever the range start', () => {
  const state = { selection: NO_SELECTION, rangeStart: null };
  assert.strictEqual(selectionAfterEscape(state), state);
});

// --- bulk targets are fixed when the action starts ------------------------------------

function boardOf(cards) {
  const matchQuery = (text) => new Set(filterCards(cards, parseSearchQuery(text, 'board'), {}).map((c) => c.id));
  return { cards, matchQuery };
}

test('a target list taken from a selection that holds a query part keeps every card that matched when it was taken, even after those cards stop matching', () => {
  const cards = [1, 2, 3, 4].map((id) => ({ id: String(id), title: `card ${id}`, status: 'todo', tags: [], assignee: id === 4 ? '@human' : '@afk' }));
  const { matchQuery } = boardOf(cards);
  const selection = setAnchor(NO_SELECTION, queryPart('assignee:@afk'));

  const targets = [...resolveSelection(selection, matchQuery, null)];
  assert.deepStrictEqual(targets, ['1', '2', '3']);

  for (const card of cards) if (card.assignee === '@afk') card.assignee = '@human';
  assert.deepStrictEqual(targets, ['1', '2', '3'], 'the list taken does not move with the cards');
  assert.deepStrictEqual(idsOf(resolveSelection(selection, matchQuery, null)), [], 'while the selection itself, worked out again, has lost them');
});

test('a card that comes to match after the list was taken is not in it', () => {
  const cards = [1, 2, 3].map((id) => ({ id, title: `card ${id}`, status: 'todo', tags: [], assignee: id === 1 ? '@afk' : '@human' }));
  const { matchQuery } = boardOf(cards);
  const selection = setAnchor(NO_SELECTION, queryPart('assignee:@afk'));
  const targets = [...resolveSelection(selection, matchQuery, null)];
  cards[2].assignee = '@afk';
  assert.deepStrictEqual(targets, [1]);
  assert.deepStrictEqual(idsOf(resolveSelection(selection, matchQuery, null)), [1, 3]);
});

test('the target list is in the order the parts were added, a card once, and limited to the cards the view shows', () => {
  const cards = [1, 2, 3, 4].map((id) => ({ id: String(id), title: `card ${id}`, status: 'todo', tags: [], assignee: id === 1 || id === 3 ? '@afk' : '' }));
  const { matchQuery } = boardOf(cards);
  const selection = grown(cardPart(4), queryPart('assignee:@afk'), cardPart(3));
  assert.deepStrictEqual([...resolveSelection(selection, matchQuery, null)], ['4', '1', '3']);
  assert.deepStrictEqual([...resolveSelection(selection, matchQuery, new Set(['1', '4']))], ['4', '1'], 'a card the view hides never joins');
});
