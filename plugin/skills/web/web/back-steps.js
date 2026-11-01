'use strict';
// Android Back on the phone layout steps back the way Esc does. The page keeps one history entry of its
// own while a menu, a light or a selection stands (the entry is marked in its history state), so that
// Back has something to pop; the Back that pops it runs one step (the open menu, then the light, then the
// selection's steps) and the page keeps the entry again while something is left. With nothing lit or
// selected there is no entry, and Back is the browser's: it closes the card details, then leaves the
// page. The card's own steps (card-history.js) are untouched; the entry stands beside them in the
// history, and a Back that lands on a card's step is the card's.
//
// Pure: the rules only. app.js reads the page, pushes the entry and carries the step out. Same
// dual-environment export pattern as phone-width.js.

const BACK_ENTRY_KEY = 'kanbanBack';

// The entry is kept once the double-tap window has passed, so the first tap of a double tap, which the
// second undoes, leaves none behind.
const BACK_ENTRY_SETTLE_MS = 400;

function backEntryState() {
  return { [BACK_ENTRY_KEY]: true };
}

function isBackEntry(state) {
  return !!state && typeof state === 'object' && state[BACK_ENTRY_KEY] === true;
}

// Whether the page should hold its entry: at the phone layout while a card menu stands, or a light or a
// selection. Over the card details a light or a selection keeps none (the details cover them, and Back
// closes the details first); a menu over the details does.
function backEntryWanted({ phone, menu, light, selection, details }) {
  if (!phone) return false;
  return !!(menu || (!details && (light || selection)));
}

// The one step a Back takes, in Esc's order: the More menu, the card menu, the light, then the
// selection (its isolate, its additions, its anchor, as Esc steps them). null when nothing is left.
function backStep({ moreMenu, menu, light, selection }) {
  if (moreMenu) return 'more-menu';
  if (menu) return 'menu';
  if (light) return 'light';
  if (selection) return 'selection';
  return null;
}

// What a popstate was, for a page that was on its own entry (`onEntry`) or not, and that landed on an
// entry with this state: 'popped' when the entry went (Back from it), 'landed' on an entry of its own (a
// Back from a card's step above it, or Forward), 'moved' when neither entry is involved.
function backTraversal({ onEntry, state }) {
  if (isBackEntry(state)) return 'landed';
  return onEntry ? 'popped' : 'moved';
}

// What to do with the Back that popped the entry. 'step' runs the step. 'pass' lets the Back through
// (history.back() once more): nothing is lit or selected, or the window is wider than the line now, or
// the card details are open under a light or a selection and Back closes the details. 'hold' leaves a
// popup that covers the page alone: the entry comes back if something stands, and nothing else moves.
function backPopAction({ phone, modalOpen, details, step }) {
  if (!phone) return 'pass';
  if (modalOpen) return 'hold';
  if (step === null) return 'pass';
  if (details && step !== 'menu' && step !== 'more-menu') return 'pass';
  return 'step';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BACK_ENTRY_SETTLE_MS, backEntryState, isBackEntry, backEntryWanted, backStep, backTraversal, backPopAction };
} else {
  window.BACK_ENTRY_SETTLE_MS = BACK_ENTRY_SETTLE_MS;
  window.backEntryState = backEntryState;
  window.isBackEntry = isBackEntry;
  window.backEntryWanted = backEntryWanted;
  window.backStep = backStep;
  window.backTraversal = backTraversal;
  window.backPopAction = backPopAction;
}
