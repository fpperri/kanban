const { test } = require('node:test');
const assert = require('node:assert');
const {
  NO_SELECTION, cardPart, pathPart, queryPart, typedQueryPart, setAnchor, addPart, selectionAfterEscape,
  selectionAfterClick, isTypedAnchor, boxAfterGraphClick, isolateAfterWrite,
} = require('../web/selection');

// Isolate in the selection module: Esc steps back in three stages (isolate off, then every
// addition, then the anchor), a click on a card while isolated moves the anchor and leaves the
// text the box holds as it is, and an isolate that is a query in the box ends when the box
// holds none. The isolate state is { previous } while on, the text the box held before, and
// null (or no isolate at all) while off. Where the page carries these out is pinned in
// isolate.test.js.

const grown = (...parts) => parts.reduce((next, part) => addPart(next, part), NO_SELECTION);
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
  assert.strictEqual(next.rangeStart, 9);
});

const ISOLATE_TEXT = '#3 | #5 | path:7';

test('a plain click in the Graph clears the box when nothing is isolated, and leaves the isolate text alone while isolated', () => {
  assert.strictEqual(boxAfterGraphClick('select', { boxText: 'review:', typedBefore: false, typedAfter: false, isolated: false }), '');
  assert.strictEqual(boxAfterGraphClick('select', { boxText: ISOLATE_TEXT, typedBefore: false, typedAfter: false, isolated: true }), ISOLATE_TEXT);
});

test('Shift or Ctrl keeps the box unless it took out a card the typed query lit, and while isolated it keeps the isolate text either way', () => {
  for (const action of ['toggle', 'range']) {
    assert.strictEqual(boxAfterGraphClick(action, { boxText: 'zephyr', typedBefore: true, typedAfter: true, isolated: false }), 'zephyr', action);
    assert.strictEqual(boxAfterGraphClick(action, { boxText: 'zephyr', typedBefore: true, typedAfter: false, isolated: false }), '', `${action}: the box no longer names the anchor`);
    assert.strictEqual(boxAfterGraphClick(action, { boxText: ISOLATE_TEXT, typedBefore: true, typedAfter: false, isolated: true }), ISOLATE_TEXT, `${action}: isolated`);
  }
});

test('a click that opens a card or reaches a cue never writes the box', () => {
  for (const action of ['open', 'cue', 'peek']) {
    assert.strictEqual(boxAfterGraphClick(action, { boxText: 'zephyr', typedBefore: false, typedAfter: false, isolated: false }), 'zephyr', action);
  }
});

test('a typed anchor in the Graph that an isolated click replaces leaves the isolate text where it is', () => {
  const selection = grown(typedQueryPart('zephyr'), cardPart(4));
  assert.ok(isTypedAnchor(selection));
  const next = selectionAfterClick('select', 9, { selection, resolved: new Set([4]), rangeStart: null, order: [], matchQuery });
  assert.strictEqual(isTypedAnchor(next.selection), false);
  assert.strictEqual(boxAfterGraphClick('select', { boxText: ISOLATE_TEXT, typedBefore: true, typedAfter: false, isolated: true }), ISOLATE_TEXT);
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
