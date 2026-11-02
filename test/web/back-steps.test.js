const { test } = require('node:test');
const assert = require('node:assert');
const {
  BACK_ENTRY_SETTLE_MS, BACK_RETURN_MS, BACK_ACTIVATION_EVENTS, activatesHistory, backEntryState, isBackEntry, backCardState, isBackUnder, backEntryWanted, backStep, backTraversal, backPopAction,
} = require('../../plugin/skills/web/web/back-steps');

// Back on the phone layout, as the rules the page asks. The page keeps one history entry of its own
// while a menu, a light or a selection stands, answers the Back that pops it with one step of Esc, and
// lets every other Back through. The entry is made from a tap and never from a Back: the browser's Back
// button skips the entries a page made without one. The browser scenarios run it with history.back().

const quiet = { phone: true, menu: false, light: false, selection: false, details: false };

test('the page marks its own entry in the history state, and no other state reads as one', () => {
  assert.strictEqual(isBackEntry(backEntryState()), true);
  for (const other of [null, undefined, {}, { card: 7 }, { kanbanBack: false }, { kanbanBack: 1 }, 'kanbanBack', 7]) {
    assert.strictEqual(isBackEntry(other), false, JSON.stringify(other));
  }
});

test("a card's step pushed from the page's entry, or from a step marked so, is marked: the entry stands below the card", () => {
  const entry = backEntryState();
  const under = backCardState(entry);
  assert.strictEqual(isBackUnder(under), true);
  assert.strictEqual(isBackEntry(under), false, "it is a card's step, not an entry");
  assert.strictEqual(isBackUnder(backCardState(under)), true, 'and so is the step after it');
  for (const other of [null, undefined, {}, { card: 7 }, 'x']) {
    assert.strictEqual(backCardState(other), null, JSON.stringify(other));
  }
  for (const other of [null, undefined, {}, entry, { kanbanBackUnder: 1 }, 'kanbanBackUnder']) {
    assert.strictEqual(isBackUnder(other), false, JSON.stringify(other));
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

test('what the browser counts as a user activation is a mouse press, a finger lifted, a key but Esc: the page makes its entry only after one', () => {
  assert.deepStrictEqual([...BACK_ACTIVATION_EVENTS].sort(), ['keydown', 'mousedown', 'pointerdown', 'pointerup', 'touchend']);
  assert.strictEqual(activatesHistory('mousedown', {}), true);
  assert.strictEqual(activatesHistory('touchend', {}), true);
  assert.strictEqual(activatesHistory('pointerup', { pointerType: 'touch' }), true);
  assert.strictEqual(activatesHistory('pointerup', { pointerType: 'pen' }), true);
  assert.strictEqual(activatesHistory('pointerup', { pointerType: 'mouse' }), false, 'a mouse press activates when it goes down');
  assert.strictEqual(activatesHistory('pointerdown', { pointerType: 'mouse' }), true);
  assert.strictEqual(activatesHistory('pointerdown', { pointerType: 'touch' }), false, 'a finger that is only down has not tapped yet');
  assert.strictEqual(activatesHistory('keydown', { key: 'n' }), true);
  assert.strictEqual(activatesHistory('keydown', { key: 'Enter' }), true);
  assert.strictEqual(activatesHistory('keydown', { key: 'Escape' }), false, 'Esc is not an activation');
  assert.strictEqual(activatesHistory('click', {}), false);
  assert.strictEqual(activatesHistory('keydown', null), false);
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

test('the landing on the entry the page went forward to after a step is its own return, and nothing else is', () => {
  const entry = backEntryState();
  assert.strictEqual(backTraversal({ onEntry: false, state: entry, returning: true }), 'returned');
  assert.strictEqual(backTraversal({ onEntry: false, state: entry, returning: false }), 'landed');
  assert.strictEqual(backTraversal({ onEntry: false, state: null, returning: true }), 'moved', 'a landing elsewhere is not the return');
  assert.strictEqual(backTraversal({ onEntry: true, state: null, returning: true }), 'popped');
  assert.ok(BACK_RETURN_MS >= 500 && BACK_RETURN_MS <= 5000, 'long enough for the browser to go forward, short enough that a stray landing is not taken for it');
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

test('over the card details a Back closes the menu first; a light or a selection behind them is uncovered by closing the details here, and nothing behind them passes through', () => {
  const ask = (over) => backPopAction({ phone: true, modalOpen: false, details: true, step: 'selection', ...over });
  assert.strictEqual(ask({ step: 'menu' }), 'step');
  assert.strictEqual(ask({ step: 'more-menu' }), 'step');
  assert.strictEqual(ask({ step: 'light' }), 'uncover');
  assert.strictEqual(ask({ step: 'selection' }), 'uncover');
  assert.strictEqual(ask({ step: null }), 'pass');
});

test("with the page's entry below the details' step the Back passes through to it, which closes the details and keeps the entry", () => {
  const ask = (over) => backPopAction({ phone: true, modalOpen: false, details: true, step: 'selection', under: true, ...over });
  assert.strictEqual(ask({ step: 'light' }), 'pass');
  assert.strictEqual(ask({ step: 'selection' }), 'pass');
  assert.strictEqual(ask({ step: 'menu' }), 'step', 'a menu is still closed first');
});
