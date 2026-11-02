'use strict';
// Android Back on the phone layout steps back the way Esc does. The page keeps one history entry of its
// own while a menu, a light or a selection stands (the entry is marked in its history state), so that
// Back has something to pop; the Back that pops it runs one step of Esc, in Esc's order (the in-page
// question, the open menu, a popup, the search panel, then the light, then the selection's steps) and the
// page goes forward to the entry again while something is left. With nothing lit or selected there is no
// entry, and Back is the browser's: it closes the card details, then leaves the page. The card's own steps
// (card-history.js) are untouched; the entry stands beside them in the history, and a Back that lands on a
// card's step is the card's. A card opened from a link is the document's first entry, with nothing of the
// page's below it: there a Back cannot step what stands behind the details, and the page is left after them.
//
// The page makes its entry from a tap, and never from a Back: the browser's Back button skips every
// entry of a document that added one without a user activation, and a back or forward ends the
// activation (Chromium's history manipulation intervention), so an entry pushed while a Back was being
// answered would be skipped by the next press and the page would be left with the selection standing.
// A Back therefore goes forward to the entry it popped, which adds none. Every state the page pushes
// carries a rising number, so that a Forward to a step above the entry is told from the Back that pops it.
//
// Pure: the rules only. app.js reads the page, pushes the entry and carries the step out. Same
// dual-environment export pattern as phone-width.js.

const BACK_ENTRY_KEY = 'kanbanBack';
const BACK_UNDER_KEY = 'kanbanBackUnder';
const BACK_SEQ_KEY = 'kanbanSeq';

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
  if (!e || e.isTrusted === false) return false;
  if (type === 'keydown') return e.key !== 'Escape';
  if (type === 'pointerdown') return e.pointerType === 'mouse';
  if (type === 'pointerup') return e.pointerType !== 'mouse';
  return type === 'mousedown' || type === 'touchend';
}

// Every state the page pushes carries a number that rises with each push, so that a popstate can tell
// whether the browser went down the history (a Back) or up it (a Forward) by comparing the number of the
// entry it landed on with the one the page was on. A state with no number (the page the person came from,
// a state of someone else's) is below them all.
function backSeqOf(state) {
  const seq = state && typeof state === 'object' ? state[BACK_SEQ_KEY] : undefined;
  return typeof seq === 'number' && Number.isFinite(seq) && seq > 0 ? seq : 0;
}

function backEntryState(seq) {
  return { [BACK_ENTRY_KEY]: true, [BACK_SEQ_KEY]: seq };
}

function isBackEntry(state) {
  return !!state && typeof state === 'object' && state[BACK_ENTRY_KEY] === true;
}

// The state of a card's step pushed from where the person is now (`current`, history.state): marked when
// that is the page's own entry or a step already marked, because the page's entry then stands below the
// card, and a Back that closes the card lands on it. Every card step carries its number, marked or not.
function backCardState(current, seq) {
  const state = { [BACK_SEQ_KEY]: seq };
  if (isBackEntry(current) || isBackUnder(current)) state[BACK_UNDER_KEY] = true;
  return state;
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

// What Esc closes, top first. The keydown listener and a Back both walk it, so that a Back takes the step Esc
// takes: the in-page question (it answers no), then the four popups that take Esc in a listener of their own,
// which runs before the chain and keeps the key from it (the date picker, the group dialog, the tray),
// the More menu, the card menu, the notifications, the preferences sheet, the card details, the edit form, a
// bulk popup, any other popup (Esc closes nothing there, and a Back holds), the notes palette (its own listener
// yields to every popup above it, and to the card details it does not: it draws above them), the search panel,
// then the light, then the selection.
const BACK_STEP_ORDER = ['ask', 'date-picker', 'group-dialog', 'tray', 'more-menu', 'menu', 'notifications', 'settings', 'details', 'edit-form', 'bulk-popup', 'other-popup', 'notes-palette', 'search-panel', 'light', 'selection'];

// The steps a Back closes whatever the card details are doing: a popup or a menu, which stands above them.
const BACK_OVER_STEPS = ['ask', 'date-picker', 'group-dialog', 'tray', 'more-menu', 'menu', 'notifications', 'settings', 'edit-form', 'bulk-popup', 'notes-palette'];

// The one step a Back takes, given the names of what stands: the first of them in Esc's order. null when
// nothing is left.
function backStep(standing) {
  return BACK_STEP_ORDER.find((name) => standing.includes(name)) || null;
}

// What a popstate was, for a page that was on its own entry (`onEntry`) or not, on the entry numbered `at`,
// that was going forward to its entry (`returning`) or not, and that landed on an entry with this state:
// 'popped' when the entry went (Back from it), 'returned' when the page went forward to it again after a
// step, 'landed' on an entry of its own (a Back from a card's step above it, or Forward), 'moved' when
// neither entry is involved. A landing on a higher number is a Forward and never a Back, so it is never
// 'popped': a Forward to the card step above the entry leaves the entry, and the card's own listener opens it.
function backTraversal({ onEntry, state, returning = false, at = 0 }) {
  if (isBackEntry(state)) return returning ? 'returned' : 'landed';
  if (backSeqOf(state) > at) return 'moved';
  return onEntry ? 'popped' : 'moved';
}

// What to do with the Back that popped the entry. 'step' runs the step. 'pass' lets the Back through
// (history.back() once more): nothing is left to step, or the window is wider than the line now. 'hold'
// leaves a popup that has no step in BACK_STEP_ORDER, over a light, a selection or the search panel (none
// has one today: every popup the page draws is a step, and this keeps a popup added without one from being
// stepped behind): nothing moves, and the page goes forward to the entry again. A popup or a menu Back
// closes is a step whatever stands under it. With the card details open under a light or a selection (the Back popped the entry the menu
// over the details had): when the page's entry stands below the details' step (`under`) the Back passes
// through and lands on it, closing the details; otherwise 'uncover': the details close here and their
// step becomes the page's entry, so the light or the selection has one without one being pushed.
function backPopAction({ phone, modalOpen, details, step, under = false }) {
  if (!phone) return 'pass';
  if (step === null) return 'pass';
  if (BACK_OVER_STEPS.includes(step)) return 'step';
  if (modalOpen) return 'hold';
  if (details) return under ? 'pass' : 'uncover';
  return 'step';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BACK_ENTRY_SETTLE_MS, BACK_RETURN_MS, BACK_ACTIVATION_EVENTS, BACK_STEP_ORDER, activatesHistory, backEntryState, isBackEntry, backSeqOf, backCardState, isBackUnder, backEntryWanted, backStep, backTraversal, backPopAction };
} else {
  window.BACK_ENTRY_SETTLE_MS = BACK_ENTRY_SETTLE_MS;
  window.BACK_RETURN_MS = BACK_RETURN_MS;
  window.BACK_ACTIVATION_EVENTS = BACK_ACTIVATION_EVENTS;
  window.BACK_STEP_ORDER = BACK_STEP_ORDER;
  window.activatesHistory = activatesHistory;
  window.backEntryState = backEntryState;
  window.isBackEntry = isBackEntry;
  window.backSeqOf = backSeqOf;
  window.backCardState = backCardState;
  window.isBackUnder = isBackUnder;
  window.backEntryWanted = backEntryWanted;
  window.backStep = backStep;
  window.backTraversal = backTraversal;
  window.backPopAction = backPopAction;
}
