const { test } = require('node:test');
const assert = require('node:assert');
const { shouldSkipAutoRefresh } = require('../web/refresh-policy');

test('shouldSkipAutoRefresh skips while any modal is open', () => {
  assert.strictEqual(shouldSkipAutoRefresh({ modalOpen: true, dragging: false, hidden: false }), true);
});

test('shouldSkipAutoRefresh skips while a drag is in progress', () => {
  assert.strictEqual(shouldSkipAutoRefresh({ modalOpen: false, dragging: true, hidden: false }), true);
});

test('shouldSkipAutoRefresh skips while the tab is hidden', () => {
  assert.strictEqual(shouldSkipAutoRefresh({ modalOpen: false, dragging: false, hidden: true }), true);
});

test('shouldSkipAutoRefresh allows a poll when nothing is blocking it', () => {
  assert.strictEqual(shouldSkipAutoRefresh({ modalOpen: false, dragging: false, hidden: false }), false);
});

test('shouldSkipAutoRefresh treats multiple simultaneous conditions same as one', () => {
  assert.strictEqual(shouldSkipAutoRefresh({ modalOpen: true, dragging: true, hidden: true }), true);
});

// A focused column-sort control (the native <select> popup in
// particular) gets silently ripped out from under the user when renderBoard()
// wipes #board on a poll tick — the DOM removal closes an open dropdown with
// no error and no indication why. Block the same way an open modal does.
test('shouldSkipAutoRefresh skips while a board sort control is focused', () => {
  assert.strictEqual(shouldSkipAutoRefresh({ modalOpen: false, dragging: false, hidden: false, boardControlFocused: true }), true);
});

test('shouldSkipAutoRefresh allows a poll when boardControlFocused is absent (back-compat)', () => {
  assert.strictEqual(shouldSkipAutoRefresh({ modalOpen: false, dragging: false, hidden: false }), false);
});
