const { test } = require('node:test');
const assert = require('node:assert');
const {
  BACK_ENTRY_SETTLE_MS, backEntryState, isBackEntry, backEntryWanted, backStep, backTraversal, backPopAction,
} = require('../../plugin/skills/web/web/back-steps');

// Back on the phone layout, as the rules the page asks. The page keeps one history entry of its own
// while a menu, a light or a selection stands, answers the Back that pops it with one step of Esc, and
// lets every other Back through. The browser scenarios run it with history.back().

const quiet = { phone: true, menu: false, light: false, selection: false, details: false };

test('the page marks its own entry in the history state, and no other state reads as one', () => {
  assert.strictEqual(isBackEntry(backEntryState()), true);
  for (const other of [null, undefined, {}, { card: 7 }, { kanbanBack: false }, { kanbanBack: 1 }, 'kanbanBack', 7]) {
    assert.strictEqual(isBackEntry(other), false, JSON.stringify(other));
  }
});

test('an entry is kept at the phone layout while a menu, a light or a selection stands', () => {
  assert.strictEqual(backEntryWanted(quiet), false);
  assert.strictEqual(backEntryWanted({ ...quiet, menu: true }), true);
  assert.strictEqual(backEntryWanted({ ...quiet, light: true }), true);
  assert.strictEqual(backEntryWanted({ ...quiet, selection: true }), true);
  assert.strictEqual(backEntryWanted({ ...quiet, menu: true, light: true, selection: true }), true);
});

test('no entry is kept at the desk layout, whatever stands', () => {
  for (const stands of [{ menu: true }, { light: true }, { selection: true }, { menu: true, light: true, selection: true }]) {
    assert.strictEqual(backEntryWanted({ ...quiet, ...stands, phone: false }), false, JSON.stringify(stands));
  }
});

test('a light or a selection behind the card details keeps no entry: Back closes the details first, and a menu over them keeps one', () => {
  assert.strictEqual(backEntryWanted({ ...quiet, light: true, details: true }), false);
  assert.strictEqual(backEntryWanted({ ...quiet, selection: true, details: true }), false);
  assert.strictEqual(backEntryWanted({ ...quiet, menu: true, details: true }), true);
  assert.strictEqual(backEntryWanted({ ...quiet, menu: true, selection: true, details: true }), true);
});

test('the entry waits out the double-tap window before it is kept, so a double tap that undoes its first tap leaves none', () => {
  assert.ok(BACK_ENTRY_SETTLE_MS >= 300, 'longer than the browser lets two taps be one double tap');
  assert.ok(BACK_ENTRY_SETTLE_MS <= 1000, 'short enough that a Back a moment after a tap still finds it');
});

test('Back steps the open More menu, then the card menu, then the light, then the selection, one at a time', () => {
  assert.strictEqual(backStep({ moreMenu: true, menu: true, light: true, selection: true }), 'more-menu');
  assert.strictEqual(backStep({ moreMenu: false, menu: true, light: true, selection: true }), 'menu');
  assert.strictEqual(backStep({ moreMenu: false, menu: false, light: true, selection: true }), 'light');
  assert.strictEqual(backStep({ moreMenu: false, menu: false, light: false, selection: true }), 'selection');
  assert.strictEqual(backStep({ moreMenu: false, menu: false, light: false, selection: false }), null);
});

test('a Back that pops the page\'s entry is the one step of Esc, the next entry down is not touched', () => {
  const entry = backEntryState();
  assert.strictEqual(backTraversal({ onEntry: true, state: null }), 'popped');
  assert.strictEqual(backTraversal({ onEntry: true, state: { card: 7 } }), 'popped');
  assert.strictEqual(backTraversal({ onEntry: false, state: entry }), 'landed');
  assert.strictEqual(backTraversal({ onEntry: true, state: entry }), 'landed');
  assert.strictEqual(backTraversal({ onEntry: false, state: null }), 'moved');
});

test('a popped entry steps at the phone layout, passes through when there is nothing to step, and holds under a popup', () => {
  const ask = (over) => backPopAction({ phone: true, modalOpen: false, details: false, step: 'selection', ...over });
  assert.strictEqual(ask({}), 'step');
  assert.strictEqual(ask({ step: 'light' }), 'step');
  assert.strictEqual(ask({ step: 'menu' }), 'step');
  assert.strictEqual(ask({ step: 'more-menu' }), 'step');
  assert.strictEqual(ask({ step: null }), 'pass', 'nothing lit or selected: the Back is the browser\'s');
  assert.strictEqual(ask({ phone: false }), 'pass', 'the window was widened to the desk layout since');
  assert.strictEqual(ask({ modalOpen: true }), 'hold', 'a popup over the page keeps its place');
  assert.strictEqual(ask({ modalOpen: true, step: null }), 'hold');
});

test('over the card details a Back closes the menu first, and otherwise passes through to close the details', () => {
  const ask = (over) => backPopAction({ phone: true, modalOpen: false, details: true, step: 'selection', ...over });
  assert.strictEqual(ask({ step: 'menu' }), 'step');
  assert.strictEqual(ask({ step: 'more-menu' }), 'step');
  assert.strictEqual(ask({ step: 'light' }), 'pass');
  assert.strictEqual(ask({ step: 'selection' }), 'pass');
  assert.strictEqual(ask({ step: null }), 'pass');
});
