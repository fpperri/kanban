'use strict';
// Android Back on the phone layout steps back the way Esc does. The page keeps one history entry of its
// own while a menu, a light or a selection stands (the entry is marked in its history state), so that
// Back has something to pop; the Back that pops it runs one step (the open menu, then the light, then the
// selection's steps) and the page goes forward to the entry again while something is left. With nothing
// lit or selected there is no entry, and Back is the browser's: it closes the card details, then leaves
// the page. The card's own steps (card-history.js) are untouched; the entry stands beside them in the
// history, and a Back that lands on a card's step is the card's.
//
// The page makes its entry from a tap, and never from a Back: the browser's Back button skips every
// entry of a document that added one without a user activation, and a back or forward ends the
// activation (Chromium's history manipulation intervention), so an entry pushed while a Back was being
// answered would be skipped by the next press and the page would be left with the selection standing.
// A Back therefore goes forward to the entry it popped, which adds none.
//
// Pure: the rules only. app.js reads the page, pushes the entry and carries the step out. Same
// dual-environment export pattern as phone-width.js.

const BACK_ENTRY_KEY = 'kanbanBack';
const BACK_UNDER_KEY = 'kanbanBackUnder';

// The entry is kept once the double-tap window has passed, so the first tap of a double tap, which the
// second undoes, leaves none behind.
const BACK_ENTRY_SETTLE_MS = 400;

// How long the page waits for the entry it went forward to: a landing on the entry within this is the
// page's own return, and changes nothing.
const BACK_RETURN_MS = 1000;

// The events the browser counts as a user activation, and with them the page's right to make an entry:
// a mouse press, a finger or pen lifted, a key but Esc. A back or forward uses the activation up.
const BACK_ACTIVATION_EVENTS = ['mousedown', 'pointerdown', 'pointerup', 'touchend', 'keydown'];

function activatesHistory(type, e) {
  if (!e) return false;
  if (type === 'keydown') return e.key !== 'Escape';
  if (type === 'pointerdown') return e.pointerType === 'mouse';
  if (type === 'pointerup') return e.pointerType !== 'mouse';
  return type === 'mousedown' || type === 'touchend';
}

function backEntryState() {
  return { [BACK_ENTRY_KEY]: true };
}

function isBackEntry(state) {
  return !!state && typeof state === 'object' && state[BACK_ENTRY_KEY] === true;
}

// The state of a card's step pushed from where the person is now (`current`, history.state): marked when
// that is the page's own entry or a step already marked, because the page's entry then stands below the
// card, and a Back that closes the card lands on it. Null otherwise, as every card step was.
function backCardState(current) {
  return isBackEntry(current) || isBackUnder(current) ? { [BACK_UNDER_KEY]: true } : null;
}

function isBackUnder(state) {
  return !!state && typeof state === 'object' && state[BACK_UNDER_KEY] === true;
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

// What a popstate was, for a page that was on its own entry (`onEntry`) or not, that was going forward to
// its entry (`returning`) or not, and that landed on an entry with this state: 'popped' when the entry
// went (Back from it), 'returned' when the page went forward to it again after a step, 'landed' on an entry
// of its own (a Back from a card's step above it, or Forward), 'moved' when neither entry is involved.
function backTraversal({ onEntry, state, returning = false }) {
  if (isBackEntry(state)) return returning ? 'returned' : 'landed';
  return onEntry ? 'popped' : 'moved';
}

// What to do with the Back that popped the entry. 'step' runs the step. 'pass' lets the Back through
// (history.back() once more): nothing is lit or selected, or the window is wider than the line now. 'hold'
// leaves a popup that covers the page alone: nothing moves, and the page goes forward to the entry again
// if something stands. With the card details open under a light or a selection (the Back popped the entry
// the menu over the details had): when the page's entry stands below the details' step (`under`) the Back
// passes through and lands on it, closing the details; otherwise 'uncover': the details close here and
// their step becomes the page's entry, so the light or the selection has one without one being pushed.
function backPopAction({ phone, modalOpen, details, step, under = false }) {
  if (!phone) return 'pass';
  if (modalOpen) return 'hold';
  if (step === null) return 'pass';
  if (details && step !== 'menu' && step !== 'more-menu') return under ? 'pass' : 'uncover';
  return 'step';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BACK_ENTRY_SETTLE_MS, BACK_RETURN_MS, BACK_ACTIVATION_EVENTS, activatesHistory, backEntryState, isBackEntry, backCardState, isBackUnder, backEntryWanted, backStep, backTraversal, backPopAction };
} else {
  window.BACK_ENTRY_SETTLE_MS = BACK_ENTRY_SETTLE_MS;
  window.BACK_RETURN_MS = BACK_RETURN_MS;
  window.BACK_ACTIVATION_EVENTS = BACK_ACTIVATION_EVENTS;
  window.activatesHistory = activatesHistory;
  window.backEntryState = backEntryState;
  window.isBackEntry = isBackEntry;
  window.backCardState = backCardState;
  window.isBackUnder = isBackUnder;
  window.backEntryWanted = backEntryWanted;
  window.backStep = backStep;
  window.backTraversal = backTraversal;
  window.backPopAction = backPopAction;
}
