const { test } = require('node:test');
const assert = require('node:assert');
const {
  NO_SELECTION, cardPart, pathPart, queryPart, typedQueryPart, addPart, stepBack, resolveSelection,
  selectionAfterPill, selectionAfterBoxEdit,
} = require('../web/selection');
const { parseSearchQuery, filterCards, searchHasAlt, searchAddAlt, searchRemoveAlt } = require('../web/search');

// What a click on a pill does to the selection and to the search box, as one
// decision the page carries out. A click, with either button, makes the pill's
// query the anchor and puts it in the box; a click on the only pill that is on
// turns it off and empties the box. Shift adds the pill's matches to the
// selection and grows the box to `anchor | pill`, and takes them out again the
// second time. The box and the selection are worked out together here, from the
// search module's own alternatives, so what the box shows and what is selected
// cannot disagree.

const alts = { has: searchHasAlt, add: searchAddAlt, remove: searchRemoveAlt };
const selectionOf = (...parts) => parts.reduce((s, p) => addPart(s, p), NO_SELECTION);
const REVIEW = 'review:';
const BLOCKED = 'blocked:';
const WAITING = 'waiting:';
const gesture = (kind, query, selection, boxText) => selectionAfterPill(kind, query, { selection, boxText, alts });
const shape = (selection) => ({ anchor: selection.anchor, additions: selection.additions });

// --- a click ----------------------------------------------------------------------

test('a click on a pill with nothing selected makes its query the anchor and writes it to the box', () => {
  const next = gesture('click', REVIEW, NO_SELECTION, '');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(next.boxText, 'review:');
  assert.strictEqual(next.rangeStart, null, 'a query anchor leaves no range start');
});

test('a click replaces whatever was selected, additions included, and whatever the box held', () => {
  const picked = selectionOf(cardPart(1), cardPart(2), pathPart(3));
  const next = gesture('click', REVIEW, picked, 'status:doing');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(next.boxText, 'review:');
});

test('a click on another pill replaces the one that was on', () => {
  const next = gesture('click', BLOCKED, selectionOf(queryPart(REVIEW)), 'review:');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(BLOCKED), additions: [] });
  assert.strictEqual(next.boxText, 'blocked:');
});

test('a click on a pill that is on with others added keeps it as the anchor and drops the additions', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  const next = gesture('click', REVIEW, grown, 'review: | blocked:');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(next.boxText, 'review:');
});

test('a click on a pill that is on as an addition makes it the anchor', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  const next = gesture('click', BLOCKED, grown, 'review: | blocked:');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(BLOCKED), additions: [] });
  assert.strictEqual(next.boxText, 'blocked:');
});

test('a click on the only pill that is on turns it off, empties the selection and clears the box', () => {
  const next = gesture('click', REVIEW, selectionOf(queryPart(REVIEW)), 'review:');
  assert.deepStrictEqual(shape(next.selection), { anchor: null, additions: [] });
  assert.strictEqual(next.boxText, '');
  assert.strictEqual(next.rangeStart, null);
});

test('a click on a pill that is on, with the box grown by a cue, clears the box too', () => {
  const next = gesture('click', REVIEW, selectionOf(queryPart(REVIEW)), 'review: assignee:@human');
  assert.strictEqual(next.selection, NO_SELECTION);
  assert.strictEqual(next.boxText, '');
});

test('the pill\'s query is written as the pill gives it, spaces and all', () => {
  const next = gesture('click', 'tags:ui   status:doing', NO_SELECTION, '');
  assert.strictEqual(next.boxText, 'tags:ui status:doing');
  assert.deepStrictEqual(next.selection.anchor, queryPart('tags:ui status:doing'));
});

// --- shift ------------------------------------------------------------------------

test('shift on a pill with nothing selected does what a click does: there is no anchor to grow from', () => {
  const next = gesture('add', REVIEW, NO_SELECTION, '');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(next.boxText, 'review:');
});

test('shift on a pill after another adds its query to the selection and grows the box to "anchor | pill"', () => {
  const next = gesture('add', BLOCKED, selectionOf(queryPart(REVIEW)), 'review:');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(REVIEW), additions: [queryPart(BLOCKED)] });
  assert.strictEqual(next.boxText, 'review: | blocked:');
  assert.strictEqual(next.rangeStart, undefined, 'the range start is left as it was');
});

test('shift again takes the pill\'s part out of the box and the selection', () => {
  const grown = gesture('add', BLOCKED, selectionOf(queryPart(REVIEW)), 'review:');
  const back = gesture('add', BLOCKED, grown.selection, grown.boxText);
  assert.deepStrictEqual(shape(back.selection), { anchor: queryPart(REVIEW), additions: [] });
  assert.strictEqual(back.boxText, 'review:');
});

test('a third pill joins at the end and leaves the first two as they were', () => {
  const two = gesture('add', BLOCKED, selectionOf(queryPart(REVIEW)), 'review:');
  const three = gesture('add', WAITING, two.selection, two.boxText);
  assert.deepStrictEqual(three.selection.additions, [queryPart(BLOCKED), queryPart(WAITING)]);
  assert.strictEqual(three.boxText, 'review: | blocked: | waiting:');
  const noMiddle = gesture('add', BLOCKED, three.selection, three.boxText);
  assert.deepStrictEqual(noMiddle.selection.additions, [queryPart(WAITING)]);
  assert.strictEqual(noMiddle.boxText, 'review: | waiting:');
});

test('shift on the anchor pill takes it out and the next part becomes the anchor', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  const next = gesture('add', REVIEW, grown, 'review: | blocked:');
  assert.deepStrictEqual(shape(next.selection), { anchor: queryPart(BLOCKED), additions: [] });
  assert.strictEqual(next.boxText, 'blocked:');
});

test('shift on the only pill that is on turns it off and clears the box, as a click does', () => {
  const next = gesture('add', REVIEW, selectionOf(queryPart(REVIEW)), 'review:');
  assert.strictEqual(next.selection, NO_SELECTION);
  assert.strictEqual(next.boxText, '');
});

test('shift grows a box that holds spaces by one bracketed alternative, and shrinks it back to the text it had', () => {
  const grown = gesture('add', BLOCKED, selectionOf(queryPart('tags:ui status:doing')), 'tags:ui status:doing');
  assert.strictEqual(grown.boxText, '(tags:ui status:doing) | blocked:');
  const back = gesture('add', BLOCKED, grown.selection, grown.boxText);
  assert.strictEqual(back.boxText, 'tags:ui status:doing');
});

test('shift with a hand-picked card as the anchor and an empty box adds the pill and leaves the box empty: nothing is hidden, so nothing needs showing', () => {
  const picked = selectionOf(cardPart(7));
  const next = gesture('add', REVIEW, picked, '');
  assert.deepStrictEqual(shape(next.selection), { anchor: cardPart(7), additions: [queryPart(REVIEW)] });
  assert.strictEqual(next.boxText, '');
});

test('shift with a hand-picked card as the anchor and text in the box grows the box so the pill\'s cards are not hidden by it', () => {
  const picked = selectionOf(cardPart(7));
  const next = gesture('add', REVIEW, picked, 'status:doing');
  assert.strictEqual(next.boxText, 'status:doing | review:');
  const back = gesture('add', REVIEW, next.selection, next.boxText);
  assert.deepStrictEqual(shape(back.selection), { anchor: cardPart(7), additions: [] });
  assert.strictEqual(back.boxText, 'status:doing');
});

test('shift on a pill that is an addition to a card anchor, with an empty box, takes it out and leaves the box alone', () => {
  const picked = selectionOf(cardPart(7), queryPart(REVIEW));
  const next = gesture('add', REVIEW, picked, '');
  assert.deepStrictEqual(shape(next.selection), { anchor: cardPart(7), additions: [] });
  assert.strictEqual(next.boxText, '');
});

test('shift next to a typed anchor keeps the typed anchor and adds the pill beside it', () => {
  const typed = selectionOf(typedQueryPart('zephyr'));
  const next = gesture('add', REVIEW, typed, 'zephyr');
  assert.deepStrictEqual(shape(next.selection), { anchor: typedQueryPart('zephyr'), additions: [queryPart(REVIEW)] });
  assert.strictEqual(next.boxText, 'zephyr | review:');
});

test('a pill gesture changes none of the selections it is given', () => {
  const grown = selectionOf(queryPart(REVIEW), queryPart(BLOCKED));
  const before = JSON.stringify(grown);
  gesture('click', REVIEW, grown, 'review: | blocked:');
  gesture('add', BLOCKED, grown, 'review: | blocked:');
  gesture('add', WAITING, grown, 'review: | blocked:');
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
const reached = (selection, shown = null) => [...resolveSelection(selection, matchQuery, shown)].sort((a, b) => a - b);

test('outside the Graph a pill\'s matches are the selection, and so are the bulk targets; the second pill adds its own', () => {
  const one = gesture('click', REVIEW, NO_SELECTION, '');
  assert.deepStrictEqual(reached(one.selection), [2, 3], 'the done review card is selected too');
  const two = gesture('add', BLOCKED, one.selection, one.boxText);
  assert.deepStrictEqual(reached(two.selection), [1, 2, 3]);
  const three = gesture('add', BLOCKED, two.selection, two.boxText);
  assert.deepStrictEqual(reached(three.selection), [2, 3]);
});

test('the selection only reaches cards the view shows: with the box on the pill\'s query the matches are all shown', () => {
  const one = gesture('click', REVIEW, NO_SELECTION, '');
  assert.deepStrictEqual(reached(one.selection, new Set([2, 3, 4])), [2, 3]);
  assert.deepStrictEqual(reached(one.selection, new Set([4])), []);
});

test('step back from a grown pill selection drops the added pill and leaves the first, then the anchor', () => {
  const two = gesture('add', BLOCKED, gesture('click', REVIEW, NO_SELECTION, '').selection, 'review:');
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
  assert.strictEqual(next.rangeStart, 5, 'the new anchor is a card, so a Shift range may begin there');
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
