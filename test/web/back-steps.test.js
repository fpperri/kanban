const { test } = require('node:test');
const assert = require('node:assert');
const {
  BACK_ENTRY_SETTLE_MS, BACK_RETURN_MS, BACK_ACTIVATION_EVENTS, BACK_STEP_ORDER, activatesHistory, backEntryState, isBackEntry, backSeqOf, backCardState, isBackUnder, backEntryWanted, backStep, backTraversal, backPopAction,
} = require('../../plugin/skills/web/web/back-steps');

// Back on the phone layout, as the rules the page asks. The page keeps one history entry of its own
// while a menu, a light or a selection stands, answers the Back that pops it with one step of Esc, and
// lets every other Back through. The entry is made from a tap and never from a Back: the browser's Back
// button skips the entries a page made without one. The browser scenarios run it with history.back().

const quiet = { phone: true, menu: false, light: false, selection: false, details: false };

test('the page marks its own entry in the history state, and no other state reads as one', () => {
  assert.strictEqual(isBackEntry(backEntryState(3)), true);
  for (const other of [null, undefined, {}, { card: 7 }, { kanbanBack: false }, { kanbanBack: 1 }, 'kanbanBack', 7]) {
    assert.strictEqual(isBackEntry(other), false, JSON.stringify(other));
  }
});

test('every state the page pushes carries a rising number, and a state without one is below them all', () => {
  assert.strictEqual(backSeqOf(backEntryState(3)), 3);
  assert.strictEqual(backSeqOf(backCardState(null, 4)), 4);
  assert.strictEqual(backSeqOf(backCardState(backEntryState(3), 5)), 5);
  for (const other of [null, undefined, {}, { card: 7 }, { kanbanSeq: '3' }, { kanbanSeq: NaN }, { kanbanSeq: -1 }, 'kanbanSeq', 7]) {
    assert.strictEqual(backSeqOf(other), 0, JSON.stringify(other));
  }
});

test("a card's step pushed from the page's entry, or from a step marked so, is marked: the entry stands below the card", () => {
  const entry = backEntryState(1);
  const under = backCardState(entry, 2);
  assert.strictEqual(isBackUnder(under), true);
  assert.strictEqual(isBackEntry(under), false, "it is a card's step, not an entry");
  assert.strictEqual(isBackUnder(backCardState(under, 3)), true, 'and so is the step after it');
  for (const other of [null, undefined, {}, { card: 7 }, 'x']) {
    const step = backCardState(other, 2);
    assert.strictEqual(isBackUnder(step), false, JSON.stringify(other));
    assert.strictEqual(isBackEntry(step), false);
    assert.strictEqual(backSeqOf(step), 2, 'a step with no entry below it still carries its number');
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

test('an event the page dispatched itself is no activation, whatever its type', () => {
  assert.strictEqual(activatesHistory('touchend', { isTrusted: true }), true);
  assert.strictEqual(activatesHistory('touchend', { isTrusted: false }), false);
  assert.strictEqual(activatesHistory('mousedown', { isTrusted: false }), false);
  assert.strictEqual(activatesHistory('keydown', { key: 'n', isTrusted: false }), false);
  assert.strictEqual(activatesHistory('pointerup', { pointerType: 'touch', isTrusted: false }), false);
  assert.strictEqual(activatesHistory('pointerdown', { pointerType: 'mouse', isTrusted: false }), false);
});

test('the entry waits out the double-tap window before it is kept, so a double tap that undoes its first tap leaves none', () => {
  assert.ok(BACK_ENTRY_SETTLE_MS >= 300, 'longer than the browser lets two taps be one double tap');
  assert.ok(BACK_ENTRY_SETTLE_MS <= 1000, 'short enough that a Back a moment after a tap still finds it');
});

// Esc's order, top first, written out from the listeners that take the key: the in-page question (a window
// listener), the date picker, the group dialog and the tray (document listeners that run before the chain),
// then the chain the keydown listener walks: the More menu, the card menu, the notifications, the preferences
// sheet, the card details, the edit form, a bulk popup, any other popup, then the notes palette (which yields
// to every popup above it), the search panel, the light and the selection.
const ESC_ORDER = ['ask', 'date-picker', 'group-dialog', 'tray', 'more-menu', 'menu', 'notifications', 'settings', 'details', 'edit-form', 'bulk-popup', 'other-popup', 'notes-palette', 'search-panel', 'light', 'selection'];

test("Back takes the first thing standing in Esc's order, one at a time, and nothing when nothing stands", () => {
  ESC_ORDER.forEach((step, i) => {
    assert.strictEqual(backStep(ESC_ORDER.slice(i)), step, `with ${step} and everything below it standing`);
    assert.strictEqual(backStep([step]), step, `with ${step} alone`);
  });
  assert.strictEqual(backStep([]), null);
  assert.strictEqual(backStep([...ESC_ORDER].reverse()), 'ask', "the order is the table's, not the list's");
  assert.deepStrictEqual([...BACK_STEP_ORDER], ESC_ORDER, 'the table the page walks is this one');
});

test('the search panel closes after the menus and the popups and before the light and the selection', () => {
  assert.strictEqual(backStep(['search-panel', 'light', 'selection']), 'search-panel');
  assert.strictEqual(backStep(['search-panel', 'menu']), 'menu');
  assert.strictEqual(backStep(['search-panel', 'bulk-popup']), 'bulk-popup');
  assert.strictEqual(backStep(['light', 'selection']), 'light');
});

test('the four popups that take Esc in their own listeners are layers of their own: the date picker, the group dialog and the tray first, the notes palette after every popup and before the search panel', () => {
  assert.strictEqual(backStep(['menu', 'date-picker']), 'date-picker', 'Esc closes only the picker, whatever it stands over');
  assert.strictEqual(backStep(['edit-form', 'date-picker']), 'date-picker');
  assert.strictEqual(backStep(['bulk-popup', 'date-picker']), 'date-picker');
  assert.strictEqual(backStep(['menu', 'group-dialog']), 'group-dialog');
  assert.strictEqual(backStep(['bulk-popup', 'tray']), 'tray');
  assert.strictEqual(backStep(['notes-palette', 'group-dialog']), 'group-dialog', 'the palette yields to a popup');
  assert.strictEqual(backStep(['notes-palette', 'tray']), 'tray');
  for (const popup of ['menu', 'more-menu', 'notifications', 'settings', 'edit-form', 'bulk-popup', 'other-popup']) {
    assert.strictEqual(backStep(['notes-palette', popup]), popup, `the palette yields to ${popup}`);
  }
  assert.strictEqual(backStep(['search-panel', 'notes-palette']), 'notes-palette');
  assert.strictEqual(backStep(['light', 'notes-palette']), 'notes-palette');
  assert.strictEqual(backStep(['selection', 'notes-palette']), 'notes-palette');
  assert.strictEqual(backStep(['ask', 'date-picker', 'tray']), 'ask', 'the question is answered first, as the window listener answers it first');
});

test('a name the table does not know is no step', () => {
  assert.strictEqual(backStep(['somewhere']), null);
  assert.strictEqual(backStep(['somewhere', 'light']), 'light');
});

test("a Back that pops the page's entry is the one step of Esc, the next entry down is not touched", () => {
  const entry = backEntryState(2);
  assert.strictEqual(backTraversal({ onEntry: true, state: null, at: 2 }), 'popped');
  assert.strictEqual(backTraversal({ onEntry: true, state: { card: 7 }, at: 2 }), 'popped');
  assert.strictEqual(backTraversal({ onEntry: false, state: entry, at: 3 }), 'landed');
  assert.strictEqual(backTraversal({ onEntry: true, state: entry, at: 3 }), 'landed');
  assert.strictEqual(backTraversal({ onEntry: false, state: null, at: 2 }), 'moved');
  assert.strictEqual(backTraversal({ onEntry: true, state: null }), 'popped', 'a page that knows no position is on the lowest');
});

test("a traversal to a higher position is a Forward, never a Back: from the entry it is not popped", () => {
  const card = backCardState(backEntryState(1), 2);
  assert.strictEqual(backTraversal({ onEntry: true, state: card, at: 1 }), 'moved', 'Forward to the card step above the entry');
  assert.strictEqual(backTraversal({ onEntry: true, state: backCardState(null, 9), at: 1 }), 'moved', 'however far above');
  assert.strictEqual(backTraversal({ onEntry: true, state: backCardState(null, 1), at: 1 }), 'popped', 'the same position is no Forward');
  assert.strictEqual(backTraversal({ onEntry: true, state: backCardState(null, 1), at: 2 }), 'popped', 'a lower one is the Back');
  assert.strictEqual(backTraversal({ onEntry: true, state: null, at: 2 }), 'popped', 'a state with no number is the lowest');
  assert.strictEqual(backTraversal({ onEntry: true, state: backEntryState(4), at: 1 }), 'landed', "Forward to an entry of the page's own is its landing");
});

test('the landing on the entry the page went forward to after a step is its own return, and nothing else is', () => {
  const entry = backEntryState(2);
  assert.strictEqual(backTraversal({ onEntry: false, state: entry, returning: true }), 'returned');
  assert.strictEqual(backTraversal({ onEntry: false, state: entry, returning: false }), 'landed');
  assert.strictEqual(backTraversal({ onEntry: false, state: null, returning: true }), 'moved', 'a landing elsewhere is not the return');
  assert.strictEqual(backTraversal({ onEntry: true, state: null, returning: true }), 'popped');
  assert.ok(BACK_RETURN_MS >= 500 && BACK_RETURN_MS <= 5000, 'long enough for the browser to go forward, short enough that a stray landing is not taken for it');
});

test('a popped entry steps at the phone layout, passes through when there is nothing to step, and holds under a popup Back does not close', () => {
  const ask = (over) => backPopAction({ phone: true, modalOpen: false, details: false, step: 'selection', ...over });
  assert.strictEqual(ask({}), 'step');
  assert.strictEqual(ask({ step: 'light' }), 'step');
  assert.strictEqual(ask({ step: 'search-panel' }), 'step');
  assert.strictEqual(ask({ step: 'menu' }), 'step');
  assert.strictEqual(ask({ step: 'more-menu' }), 'step');
  assert.strictEqual(ask({ step: null }), 'pass', "nothing lit or selected: the Back is the browser's");
  assert.strictEqual(ask({ phone: false }), 'pass', 'the window was widened to the desk layout since');
  assert.strictEqual(ask({ modalOpen: true }), 'hold', 'a popup Back does not close keeps its place while something stands under it');
  assert.strictEqual(ask({ modalOpen: true, step: 'light' }), 'hold');
  assert.strictEqual(ask({ modalOpen: true, step: 'search-panel' }), 'hold');
  assert.strictEqual(ask({ modalOpen: true, step: null }), 'pass', 'with nothing left to step the Back goes through, popup or not');
});

test('a popup Back closes is a step, with a popup standing or not, and over the card details too', () => {
  const ask = (over) => backPopAction({ phone: true, modalOpen: true, details: false, step: 'selection', ...over });
  for (const step of ['ask', 'date-picker', 'group-dialog', 'tray', 'more-menu', 'menu', 'notifications', 'settings', 'edit-form', 'bulk-popup', 'notes-palette']) {
    assert.strictEqual(ask({ step }), 'step', step);
    assert.strictEqual(ask({ step, details: true }), 'step', `${step}, over the card details`);
  }
});

test('over the card details a Back closes the menu first; a light or a selection behind them is uncovered by closing the details here, and nothing behind them passes through', () => {
  const ask = (over) => backPopAction({ phone: true, modalOpen: false, details: true, step: 'selection', ...over });
  assert.strictEqual(ask({ step: 'menu' }), 'step');
  assert.strictEqual(ask({ step: 'more-menu' }), 'step');
  assert.strictEqual(ask({ step: 'search-panel' }), 'uncover');
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
