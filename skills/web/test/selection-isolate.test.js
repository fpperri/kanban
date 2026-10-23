const { test } = require('node:test');
const assert = require('node:assert');
const {
  NO_SELECTION, cardPart, pathPart, queryPart, typedQueryPart, setAnchor, addPart, selectionAfterEscape,
  selectionAfterClick, isTypedAnchor, pillQueriesDropped, isolateAfterWrite, isolateRecord, isolatePreviousFrom, cardMenuFor, canvasMenuFor,
} = require('../web/selection');
const { searchMirrorBox } = require('../web/search');

// Isolate in the selection module: Esc steps back in three stages (isolate off, then every
// addition, then the anchor), a click on a card while isolated moves the anchor and leaves the
// text the box holds as it is, and an isolate that is a query in the box ends when the box
// holds none. The isolate state is { previous } while on, the text the box held before, and
// null (or no isolate at all) while off. Where the page carries these out is pinned in
// isolate.test.js.

const grown = (...parts) => parts.reduce((next, part) => addPart(next, part), NO_SELECTION);
const partsOf = (selection) => (selection.anchor ? [selection.anchor].concat(selection.additions) : []);
const ISOLATED = { previous: 'review:' };

// --- Esc: three stages ---------------------------------------------------------------

test('the first Esc turns isolate off and leaves the selection and the range start exactly as they were', () => {
  const selection = grown(cardPart(3), cardPart(5), pathPart(7));
  const state = { selection, rangeStart: 5, isolate: ISOLATED };
  const next = selectionAfterEscape(state);
  assert.strictEqual(next.isolate, null);
  assert.strictEqual(next.selection, selection, 'the same selection, not a copy');
  assert.strictEqual(next.rangeStart, 5);
});

test('the next Esc drops every addition and the one after drops the anchor: isolate, then the additions, then the anchor', () => {
  let state = { selection: grown(cardPart(3), cardPart(5), pathPart(7), queryPart('tags:ui')), rangeStart: 5, isolate: ISOLATED };
  const walk = [];
  for (let step = 0; step < 4; step++) {
    const next = selectionAfterEscape(state);
    walk.push([!!state.isolate && !next.isolate, next.selection.additions.length, !!next.selection.anchor]);
    state = { isolate: null, ...next };
  }
  assert.deepStrictEqual(walk, [
    [true, 3, true],
    [false, 0, true],
    [false, 0, false],
    [false, 0, false],
  ]);
});

test('with isolate on and nothing picked, Esc still turns isolate off: the box holds the isolate text, not a selection', () => {
  const state = { selection: NO_SELECTION, rangeStart: null, isolate: ISOLATED };
  const next = selectionAfterEscape(state);
  assert.notStrictEqual(next, state, 'a step was taken');
  assert.strictEqual(next.isolate, null);
});

test('with isolate off, Esc steps back as it did before: the same state comes back when nothing is picked', () => {
  const state = { selection: NO_SELECTION, rangeStart: null, isolate: null };
  assert.strictEqual(selectionAfterEscape(state), state);
  const plain = { selection: NO_SELECTION, rangeStart: null };
  assert.strictEqual(selectionAfterEscape(plain), plain, 'a state with no isolate at all is a state with isolate off');
});

test('stepping back does not change the state handed in, isolate included', () => {
  const state = { selection: grown(cardPart(3), cardPart(5)), rangeStart: 5, isolate: ISOLATED };
  const before = JSON.stringify(state);
  selectionAfterEscape(state);
  assert.strictEqual(JSON.stringify(state), before);
});

// --- clicks while isolated: the anchor moves, the box stays ------------------------------

const matchQuery = () => new Set();

test('while isolated, a plain card click sets the anchor to that card and drops the additions, as it does when not isolated', () => {
  const selection = grown(cardPart(3), cardPart(5), pathPart(7));
  const next = selectionAfterClick('select', 9, { selection, resolved: new Set([3, 5, 7]), rangeStart: 5, order: [], matchQuery });
  assert.deepStrictEqual(next.selection, setAnchor(NO_SELECTION, cardPart(9)));
  assert.strictEqual(next.rangeStart, '9');
});

// With isolate off a click writes the selection it made into the box (searchMirrorBox): the
// gesture's selection (selectionAfterClick) is what the box then shows. While isolated the page
// writes nothing at all, and the click moves the anchor only (pinned in isolate-markup.test.js).
const afterClick = (action, id, selection, box, resolved = new Set()) => {
  const next = selectionAfterClick(action, id, { selection, resolved, rangeStart: null, order: [String(id)], matchQuery });
  return { ...next, box: searchMirrorBox(box, partsOf(next.selection), pillQueriesDropped(selection, next.selection)) };
};

test('a plain click shows the card in the box, whatever the box held, and keeps the cut', () => {
  assert.strictEqual(afterClick('select', 34, NO_SELECTION, 'review:').box, '#34');
  assert.strictEqual(afterClick('select', 34, grown(cardPart(3), cardPart(5)), '#3 | #5').box, '#34');
  assert.strictEqual(afterClick('select', 34, NO_SELECTION, 'zephyr slice:goal..strategy').box, '#34 slice:goal..strategy');
});

test('Shift or Ctrl adds the card to the box, and a Ctrl-click on a picked card takes it out of it', () => {
  const one = afterClick('toggle', 36, grown(cardPart(34)), '#34', new Set(['34']));
  assert.strictEqual(one.box, '#34 | #36');
  const out = afterClick('toggle', 34, one.selection, one.box, new Set(['34', '36']));
  assert.strictEqual(out.box, '#36');
  const none = afterClick('toggle', 36, out.selection, out.box, new Set(['36']));
  assert.strictEqual(none.box, '', 'an empty selection empties the box');
  assert.strictEqual(afterClick('toggle', 36, grown(cardPart(36)), '#36 slice:goal..strategy', new Set(['36'])).box, 'slice:goal..strategy', 'but for its cut');
});

test('a click that adds to a typed query shows it beside the card as it was typed, and the query stays the typed anchor', () => {
  const selection = grown(typedQueryPart('zephyr'));
  const next = afterClick('toggle', 4, selection, 'zephyr', new Set(['1']));
  assert.strictEqual(next.box, 'zephyr | #4');
  assert.ok(isTypedAnchor(next.selection), 'the parts are what the click made them: the box is not written back into them');
  assert.strictEqual(afterClick('select', 4, selection, 'zephyr').box, '#4');
});

test('a click that opens a card or reaches a cue selects nothing new', () => {
  const pill = grown(queryPart('review:'));
  for (const action of ['open', 'cue', 'peek']) {
    assert.deepStrictEqual(selectionAfterClick(action, 9, { selection: pill, resolved: new Set(), rangeStart: null, order: [], matchQuery }).selection, pill, action);
  }
});

test('a plain click replaces a typed anchor in the Graph, isolated or not', () => {
  const selection = grown(typedQueryPart('zephyr'), cardPart(4));
  assert.ok(isTypedAnchor(selection));
  const next = selectionAfterClick('select', 9, { selection, resolved: new Set([4]), rangeStart: null, order: [], matchQuery });
  assert.strictEqual(isTypedAnchor(next.selection), false);
});

// --- an isolate is a query in the box ----------------------------------------------------

test('isolate stays on while the box holds a query, whether it was edited by hand or written by a pill or a slice', () => {
  for (const reason of ['typing', 'clear', 'pill', 'slice', 'cue', 'link', 'prefill', 'selection']) {
    assert.strictEqual(isolateAfterWrite(ISOLATED, '#3 | #5', reason), ISOLATED, reason);
  }
});

test('isolate ends when the box is left holding none: the isolate text is gone, so is the isolate', () => {
  for (const reason of ['typing', 'clear', 'pill', 'slice', 'selection']) {
    assert.strictEqual(isolateAfterWrite(ISOLATED, '', reason), null, reason);
    assert.strictEqual(isolateAfterWrite(ISOLATED, '   ', reason), null, `${reason}: blanks are an empty box`);
  }
});

test('its own writes never end it: turning it on or off writes the box with the reason isolate', () => {
  assert.strictEqual(isolateAfterWrite(ISOLATED, '', 'isolate'), ISOLATED, 'the restored text may be empty, and the page ends the isolate itself');
});

test('with isolate off a write changes nothing', () => {
  assert.strictEqual(isolateAfterWrite(null, '', 'typing'), null);
  assert.strictEqual(isolateAfterWrite(undefined, 'x', 'typing'), undefined);
});

// --- what the browser keeps for a reload -----------------------------------------------------

test('the kept record gives the text from before isolating back, for the very isolate text it was kept with', () => {
  const raw = isolateRecord('zephyr tags:ui', '#2 | #5');
  assert.strictEqual(isolatePreviousFrom(raw, '#2 | #5'), 'zephyr tags:ui');
  assert.strictEqual(isolatePreviousFrom(raw, '  #2 | #5  '), 'zephyr tags:ui', 'the link\'s query is trimmed, as the deep-link reader trims it');
  assert.strictEqual(isolatePreviousFrom(isolateRecord('', '#2'), '#2'), '', 'an empty text before is empty');
});

test('the kept text is unknown, and so empty, for another isolate text or for a record that is missing or unreadable', () => {
  const raw = isolateRecord('zephyr', '#2 | #5');
  assert.strictEqual(isolatePreviousFrom(raw, '#2'), '', 'another isolate text');
  for (const bad of [null, undefined, '', 'not json', '42', 'null', '[]', '{}', '{"previous":3,"text":"#2"}', '{"previous":"x"}']) {
    assert.strictEqual(isolatePreviousFrom(bad, '#2'), '', String(bad));
  }
  assert.strictEqual(isolatePreviousFrom(raw, undefined), '');
});

test('the record is JSON of the previous text and the trimmed isolate text, and tolerates missing values', () => {
  assert.deepStrictEqual(JSON.parse(isolateRecord('a', ' #2 ')), { previous: 'a', text: '#2' });
  assert.deepStrictEqual(JSON.parse(isolateRecord(undefined, null)), { previous: '', text: '' });
});

// --- the menu on a card -----------------------------------------------------------------------

test('a right-click inside the selection offers Isolate, and one outside it does not', () => {
  const resolved = new Set([2, 5]);
  assert.strictEqual(cardMenuFor(resolved, 2).isolate, true);
  assert.strictEqual(cardMenuFor(resolved, 5).isolate, true);
  assert.strictEqual(cardMenuFor(resolved, 3).isolate, false);
  assert.strictEqual(cardMenuFor(new Set(), 3).isolate, false, 'with nothing selected the card is outside it');
});

test('the card details\' own menu offers no Isolate, even for a card inside the selection', () => {
  assert.strictEqual(cardMenuFor(new Set([2, 5]), 2, { fromDetail: true }).isolate, false);
  assert.strictEqual(cardMenuFor(new Set([2, 5]), 3, { fromDetail: true }).isolate, false);
});

test('the menu for the empty canvas is Isolate alone: no card, no bulk entry, no Peek, no Add, no Path or Tree', () => {
  assert.deepStrictEqual(canvasMenuFor(), { ids: [], inSelection: false, peek: false, add: false, isolate: true, clicked: null, canvas: true });
});

test('the canvas menu is a fresh object each time', () => {
  assert.notStrictEqual(canvasMenuFor(), canvasMenuFor());
});

