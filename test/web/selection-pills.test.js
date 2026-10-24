const { test } = require('node:test');
const assert = require('node:assert');
const {
  NO_SELECTION, cardPart, pathPart, queryPart, typedQueryPart, addPart, stepBack, resolveSelection,
  selectionAfterPill, selectionAfterBoxEdit, pillQueriesDropped, pillQueriesAdded,
} = require('../../plugin/skills/web/web/selection');
const { parseSearchQuery, filterCards, searchHasAlt, searchAddAlt, searchRemoveAlt } = require('../../plugin/skills/web/web/search');

// What a click on a pill does to the selection and to the search box, as one
// decision the page carries out. Pills follow the status pills' rules. A click
// ('toggle', whatever modifier is held) turns one pill on or off and leaves the
// others as they were: on, its query joins the selection and the box as one more
// alternative; off, it goes out of both. A right-click ('solo') makes the pill the
// only one on with the box holding its query alone, and on the pill that is already
// the only one on it turns every pill off, the default (the status pills' default
// is all on, so theirs turns all back on). The first pill on is the anchor and the
// later ones are additions. The box and the selection are worked out together here,
// from the search module's own alternatives, so what the box shows and what is
// selected cannot disagree.

const alts = { has: searchHasAlt, add: searchAddAlt, remove: searchRemoveAlt };
const selectionOf = (...parts) => parts.reduce((s, p) => addPart(s, p), NO_SELECTION);
const REVIEW = 'review:';
const BLOCKED = 'blocked:';
const WAITING = 'waiting:';
const gesture = (kind, query, selection, boxText) => selectionAfterPill(kind, query, { selection, boxText, alts });
const shape = (selection) => ({ anchor: selection.anchor, additions: selection.additions });

// --- a click: turn one pill on or off ---------------------------------------------------

test('a click on an off pill with nothing selected turns it on: its query is the anchor and the box holds it', () => {
  const next = gesture('toggle', REVIEW, NO_SELECTION, '');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(next.boxText, 'review:');
  assert.strictEqual(next.rangeStart, null, 'a query anchor leaves no range start');
});

test('a click on a second off pill turns it on beside the first: the first stays the anchor, the second is an addition, and the box grows', () => {
  const next = gesture('toggle', BLOCKED, selectionOf(queryPart(REVIEW)), 'review:');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [queryPart(BLOCKED)] });
  assert.strictEqual(next.boxText, 'review: | blocked:');
  assert.strictEqual(next.rangeStart, undefined, 'the range start is left as it was');
});

test('a third pill joins at the end and leaves the first two as they were', () => {
  const two = gesture('toggle', BLOCKED, selectionOf(queryPart(REVIEW)), 'review:');
  const three = gesture('toggle', WAITING, two.selection, two.boxText);
  assert.deepStrictEqual(three.selection.additions, [queryPart(BLOCKED), queryPart(WAITING)]);
  assert.strictEqual(three.boxText, 'review: | blocked: | waiting:');
});

test('a click on an on pill turns it off and takes its query out of the box, and the other pills stay as they were', () => {
  const three = selectionOf(queryPart(REVIEW), queryPart(BLOCKED), queryPart(WAITING));
  const next = gesture('toggle', BLOCKED, three, 'review: | blocked: | waiting:');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [queryPart(WAITING)] });
  assert.strictEqual(next.boxText, 'review: | waiting:');
  assert.strictEqual(next.rangeStart, undefined, 'the anchor stayed, so the range start is left as it was');
});

test('a click on the anchor pill turns it off and the next pill becomes the anchor', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  const next = gesture('toggle', REVIEW, grown, 'review: | blocked:');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(BLOCKED), additions: [] });
  assert.strictEqual(next.boxText, 'blocked:');
  assert.strictEqual(next.rangeStart, null, 'a query anchor leaves no range start');
});

test('a click on the only pill that is on turns it off, empties the selection and clears the box', () => {
  const next = gesture('toggle', REVIEW, selectionOf(queryPart(REVIEW)), 'review:');
  assert.strictEqual(next.selection, NO_SELECTION);
  assert.strictEqual(next.boxText, '');
  assert.strictEqual(next.rangeStart, null);
});

test('a click turns a pill on beside text typed in the box, where there is no anchor to grow from: it joins as one more alternative, and off again takes only it out', () => {
  const on = gesture('toggle', REVIEW, NO_SELECTION, 'zephyr');
  assert.deepStrictEqual(shape(on.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(on.boxText, 'zephyr | review:');
  const off = gesture('toggle', REVIEW, on.selection, on.boxText);
  assert.strictEqual(off.selection, NO_SELECTION);
  assert.strictEqual(off.boxText, 'zephyr');
});

test('the pill\'s query is written as the pill gives it, spaces and all', () => {
  const next = gesture('toggle', 'tags:ui   status:doing', NO_SELECTION, '');
  assert.strictEqual(next.boxText, 'tags:ui status:doing');
  assert.deepStrictEqual(next.selection.anchor, queryPart('tags:ui status:doing'));
});

test('a box that holds spaces grows by one bracketed alternative, and shrinks back to the text it had', () => {
  const grown = gesture('toggle', BLOCKED, selectionOf(queryPart('tags:ui status:doing')), 'tags:ui status:doing');
  assert.strictEqual(grown.boxText, '(tags:ui status:doing) | blocked:');
  const back = gesture('toggle', BLOCKED, grown.selection, grown.boxText);
  assert.strictEqual(back.boxText, 'tags:ui status:doing');
});

test('with a hand-picked card as the anchor and an empty box a click adds the pill and leaves the box empty: nothing is hidden, so nothing needs showing', () => {
  const picked = selectionOf(cardPart(7));
  const next = gesture('toggle', REVIEW, picked, '');
  assert.deepStrictEqual(shape(next.selection), { anchor: cardPart(7), additions: [queryPart(REVIEW)] });
  assert.strictEqual(next.boxText, '');
});

test('with a hand-picked card as the anchor and text in the box a click grows the box so the pill\'s cards are not hidden by it, and off again shrinks it', () => {
  const picked = selectionOf(cardPart(7));
  const next = gesture('toggle', REVIEW, picked, 'status:doing');
  assert.strictEqual(next.boxText, 'status:doing | review:');
  const back = gesture('toggle', REVIEW, next.selection, next.boxText);
  assert.deepStrictEqual(shape(back.selection), { anchor: cardPart(7), additions: [] });
  assert.strictEqual(back.boxText, 'status:doing');
});

test('a click on a pill that is an addition to a card anchor, with an empty box, takes it out and leaves the box alone', () => {
  const picked = selectionOf(cardPart(7), queryPart(REVIEW));
  const next = gesture('toggle', REVIEW, picked, '');
  assert.deepStrictEqual(shape(next.selection), { anchor: cardPart(7), additions: [] });
  assert.strictEqual(next.boxText, '');
});

test('next to a typed anchor a click keeps the typed anchor and adds the pill beside it', () => {
  const typed = selectionOf(typedQueryPart('zephyr'));
  const next = gesture('toggle', REVIEW, typed, 'zephyr');
  assert.deepStrictEqual(shape(next.selection), { anchor: typedQueryPart('zephyr'), additions: [queryPart(REVIEW)] });
  assert.strictEqual(next.boxText, 'zephyr | review:');
});

// --- a right-click: solo ---------------------------------------------------------------

test('a right-click on an off pill with nothing selected makes it the only one on: its query is the anchor and the box holds it alone', () => {
  const next = gesture('solo', REVIEW, NO_SELECTION, '');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(next.boxText, 'review:');
  assert.strictEqual(next.rangeStart, null);
});

test('a right-click on an off pill replaces whatever was selected, cards and other pills included, and whatever the box held', () => {
  const picked = selectionOf(cardPart(1), cardPart(2), pathPart(3));
  const next = gesture('solo', REVIEW, picked, 'status:doing');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(next.boxText, 'review:');
  const others = gesture('solo', WAITING, selectionOf(queryPart(REVIEW), queryPart(BLOCKED)), 'review: | blocked:');
  assert.deepStrictEqual(shape(others.selection), { anchor: queryPart(WAITING), additions: [] });
  assert.strictEqual(others.boxText, 'waiting:');
});

test('a right-click on an on pill that is not alone makes it the only one on, whether it was the anchor or an addition', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  const anchor = gesture('solo', REVIEW, grown, 'review: | blocked:');
  assert.deepStrictEqual(shape(anchor.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(anchor.boxText, 'review:');
  const addition = gesture('solo', BLOCKED, grown, 'review: | blocked:');
  assert.deepStrictEqual(shape(addition.selection), { anchor: queryPart(BLOCKED), additions: [] });
  assert.strictEqual(addition.boxText, 'blocked:');
});

test('a right-click on the only pill that is on turns every pill off and empties the box: pills default to all off', () => {
  const next = gesture('solo', REVIEW, selectionOf(queryPart(REVIEW)), 'review:');
  assert.strictEqual(next.selection, NO_SELECTION);
  assert.strictEqual(next.boxText, '');
  assert.strictEqual(next.rangeStart, null);
});

test('turning the soloed pill off empties only what the pills put in the box and leaves the cards the selection holds', () => {
  const picked = selectionOf(cardPart(7), queryPart(REVIEW));
  const next = gesture('solo', REVIEW, picked, 'status:doing | review:');
  assert.deepStrictEqual(shape(next.selection), { anchor: cardPart(7), additions: [] });
  assert.strictEqual(next.boxText, 'status:doing');
  const typed = gesture('solo', REVIEW, selectionOf(typedQueryPart('zephyr'), queryPart(REVIEW)), 'zephyr | review:');
  assert.deepStrictEqual(shape(typed.selection), { anchor: typedQueryPart('zephyr'), additions: [] });
  assert.strictEqual(typed.boxText, 'zephyr');
});

test('solo, then a right-click on it again, and then solo once more: the rule is the status pills\' round trip, with all off as the default', () => {
  const one = gesture('solo', BLOCKED, NO_SELECTION, '');
  const none = gesture('solo', BLOCKED, one.selection, one.boxText);
  assert.deepStrictEqual([none.selection, none.boxText], [NO_SELECTION, '']);
  const again = gesture('solo', BLOCKED, none.selection, none.boxText);
  assert.deepStrictEqual(shape(again.selection), { anchor: queryPart(BLOCKED), additions: [] });
  assert.strictEqual(again.boxText, 'blocked:');
});

test('a pill gesture changes none of the selections it is given', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  const before = JSON.stringify(grown);
  gesture('toggle', REVIEW, grown, 'review: | blocked:');
  gesture('toggle', BLOCKED, grown, 'review: | blocked:');
  gesture('toggle', WAITING, grown, 'review: | blocked:');
  gesture('solo', REVIEW, grown, 'review: | blocked:');
  gesture('solo', WAITING, grown, 'review: | blocked:');
  assert.strictEqual(JSON.stringify(grown), before);
  assert.strictEqual(JSON.stringify(NO_SELECTION), '{"anchor":null,"additions":[]}');
});

// --- the cards the selection reaches ------------------------------------------------

const CARDS = [
  { id: 1, title: 'one', status: 'todo', blocked: 'vendor', review: null, waiting_for: [], tags: [] },
  { id: 2, title: 'two', status: 'todo', blocked: null, review: 'copy', waiting_for: [], tags: [] },
  { id: 3, title: 'three', status: 'done', blocked: null, review: 'PR', waiting_for: [], tags: [] },
  { id: 4, title: 'four', status: 'todo', blocked: null, review: null, waiting_for: [1], tags: [] },
];
const matchQuery = (text) => new Set(filterCards(CARDS, parseSearchQuery(text), {}).map((c) => c.id));
const reached = (selection, shown = null) => [...resolveSelection(selection, matchQuery, shown)].map(Number).sort((a, b) => a - b);

test('outside the Graph a pill\'s matches are the selection, and so are the bulk targets; the second pill adds its own', () => {
  const one = gesture('toggle', REVIEW, NO_SELECTION, '');
  assert.deepStrictEqual(reached(one.selection), [2, 3], 'the done review card is selected too');
  const two = gesture('toggle', BLOCKED, one.selection, one.boxText);
  assert.deepStrictEqual(reached(two.selection), [1, 2, 3]);
  const three = gesture('toggle', BLOCKED, two.selection, two.boxText);
  assert.deepStrictEqual(reached(three.selection), [2, 3]);
});

test('the selection only reaches cards the view shows: with the box on the pill\'s query the matches are all shown', () => {
  const one = gesture('toggle', REVIEW, NO_SELECTION, '');
  assert.deepStrictEqual(reached(one.selection, new Set([2, 3, 4])), [2, 3]);
  assert.deepStrictEqual(reached(one.selection, new Set([4])), []);
});

test('step back from a grown pill selection drops the added pill and leaves the first, then the anchor', () => {
  const two = gesture('toggle', BLOCKED, gesture('toggle', REVIEW, NO_SELECTION, '').selection, 'review:');
  assert.deepStrictEqual(shape(stepBack(two.selection)), { anchor: queryPart(REVIEW), additions: [] });
  assert.deepStrictEqual(shape(stepBack(stepBack(two.selection))), { anchor: null, additions: [] });
});

// --- the box edited by hand -----------------------------------------------------------

const stateOf = (selection, rangeStart = null) => ({ selection, rangeStart });
const afterEdit = (selection, boxText, rangeStart) => selectionAfterBoxEdit(stateOf(selection, rangeStart), boxText, searchHasAlt);

test('typing after a pill\'s query leaves the box without it, so the pill is dropped', () => {
  const next = afterEdit(selectionOf(queryPart(REVIEW)), 'review:x');
  assert.strictEqual(next.selection, NO_SELECTION);
  assert.strictEqual(next.rangeStart, null);
});

test('clearing the box drops the pills it held', () => {
  assert.strictEqual(afterEdit(selectionOf(queryPart(REVIEW), queryPart(BLOCKED)), '').selection, NO_SELECTION);
});

test('only the pill the box no longer holds is dropped, and the one it still holds is the anchor', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  assert.deepStrictEqual(shape(afterEdit(grown, 'review: | blockedx').selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.deepStrictEqual(shape(afterEdit(grown, 'reviewx | blocked:').selection), { anchor: queryPart(BLOCKED), additions: [] });
});

test('while the box still holds every pill, the selection is the very one it was', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  const state = stateOf(grown, null);
  assert.strictEqual(selectionAfterBoxEdit(state, 'review: | blocked:', searchHasAlt), state);
  assert.strictEqual(selectionAfterBoxEdit(state, '(review:) | blocked: | other', searchHasAlt), state, 'more text elsewhere in the box is no reason to drop them');
});

test('hand-picked cards, paths and a typed query are never dropped by an edit of the box', () => {
  const picked = selectionOf(cardPart(1), pathPart(2), typedQueryPart('zeph'));
  const state = stateOf(picked, 1);
  assert.strictEqual(selectionAfterBoxEdit(state, 'anything else', searchHasAlt), state);
  assert.strictEqual(selectionAfterBoxEdit(state, '', searchHasAlt), state);
});

test('a pill dropped from among cards leaves the cards, and when the anchor goes the next part is the anchor with its range start', () => {
  const mixed = selectionOf(queryPart(REVIEW), cardPart(5), cardPart(6));
  const next = afterEdit(mixed, 'nothing', null);
  assert.deepStrictEqual(shape(next.selection), { anchor: cardPart(5), additions: [cardPart(6)] });
  assert.strictEqual(next.rangeStart, '5', 'the new anchor is a card, so a Shift range may begin there');
});

test('the box held whole by a pill with spaces in its query counts as held, spacing aside', () => {
  const picked = selectionOf(queryPart('tags:ui status:doing'));
  const state = stateOf(picked);
  assert.strictEqual(selectionAfterBoxEdit(state, 'tags:ui   status:doing', searchHasAlt), state);
});

test('an edit never changes the selection it is given', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  const before = JSON.stringify(grown);
  afterEdit(grown, '');
  assert.strictEqual(JSON.stringify(grown), before);
});

// --- Esc takes the pills a step drops out of the box ----------------------------------

test('a step back reports the pill queries it dropped: the additions first, then the anchor', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED), queryPart(WAITING));
  const first = stepBack(grown);
  assert.deepStrictEqual(pillQueriesDropped(grown, first), [BLOCKED, WAITING]);
  const second = stepBack(first);
  assert.deepStrictEqual(pillQueriesDropped(first, second), [REVIEW]);
  assert.deepStrictEqual(pillQueriesDropped(second, stepBack(second)), []);
});

test('cards, paths and a typed query are not pill queries, so a step that drops only those reports nothing', () => {
  const picked = selectionOf(cardPart(1), pathPart(2), typedQueryPart('zeph'));
  assert.deepStrictEqual(pillQueriesDropped(picked, stepBack(picked)), []);
  assert.deepStrictEqual(pillQueriesDropped(picked, NO_SELECTION), []);
});

test('a pill query that is still in the selection afterwards is not reported', () => {
  const grown = selectionOf(cardPart(1), queryPart(REVIEW));
  assert.deepStrictEqual(pillQueriesDropped(grown, grown), []);
});

test('stepping back from a grown pill selection and taking each step out of the box gets the box to "review:" and then to nothing', () => {
  const two = gesture('toggle', BLOCKED, gesture('toggle', REVIEW, NO_SELECTION, '').selection, 'review:');
  const one = stepBack(two.selection);
  const boxOne = pillQueriesDropped(two.selection, one).reduce((text, query) => searchRemoveAlt(text, query), two.boxText);
  assert.strictEqual(boxOne, 'review:');
  const none = stepBack(one);
  const boxNone = pillQueriesDropped(one, none).reduce((text, query) => searchRemoveAlt(text, query), boxOne);
  assert.strictEqual(boxNone, '');
});

test('pillQueriesAdded is the other side of pillQueriesDropped: the pill queries a step put in, in the order they were picked', () => {
  const none = selectionOf(cardPart(1));
  const one = selectionOf(cardPart(1), queryPart(REVIEW));
  const two = selectionOf(cardPart(1), queryPart(REVIEW), queryPart(BLOCKED));
  assert.deepStrictEqual(pillQueriesAdded(none, one), [REVIEW]);
  assert.deepStrictEqual(pillQueriesAdded(one, two), [BLOCKED]);
  assert.deepStrictEqual(pillQueriesAdded(none, two), [REVIEW, BLOCKED]);
  assert.deepStrictEqual(pillQueriesAdded(two, one), [], 'a pill going off adds nothing');
  assert.deepStrictEqual(pillQueriesAdded(one, one), []);
  assert.deepStrictEqual(pillQueriesAdded(none, selectionOf(cardPart(1), pathPart(2), typedQueryPart('zeph'))), [], 'cards, paths and a typed query are no pill queries');
  assert.deepStrictEqual(pillQueriesAdded(two, none), pillQueriesDropped(none, two));
});
