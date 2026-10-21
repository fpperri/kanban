'use strict';
// The one guard behind the single-key shortcuts: every key hotkeys.js lists that types
// nothing but reads a character (`/`, `p`, `m`, `i`, `l`, `n`, `?` and the slice keys) reads it,
// and so does Esc, through keyGuardEscape.
// It has two parts. The typing check is for a key that would insert a
// character: it stays off while focus is in a field. The surface check is for
// a key that would act on the board behind an open popup: it stays off while
// one is up. Ctrl+F inserts nothing, so it reads only the surface check and
// still works from inside a text field.
//
// The surfaces are pinned by name. The search panel is deliberately not one:
// the slice keys work while it is open. The preferences sheet is one: the
// single-key shortcuts and Ctrl+F stay off while it is up. On the real page
// #notif-modal and #prefs-sheet are .modal-backdrop too, so the 'dialog' entry answers for
// them and keyGuardSurface never names 'notifications' or 'preferences' there; those two
// entries are a safety net behind it, for a surface that stops being a .modal-backdrop.
// A key may name one popup that does not turn it off (`n` notes the card whose details are open):
// it passes that popup's selector, and any other popup open besides still does.
//
// Pure: callers pass the document, so Node tests drive it with a fake. Same
// dual-environment export pattern as save-hotkey.js and search-hotkey.js.
const KEY_GUARD_SURFACES = [
  { name: 'menu', selector: '#context-menu:not(.hidden)' },
  { name: 'dialog', selector: '.modal-backdrop:not(.hidden)' },
  { name: 'notifications', selector: '#notif-modal:not(.hidden)' },
  { name: 'preferences', selector: '#prefs-sheet:not(.hidden)' },
];

function keyGuardTyping(doc) {
  const active = doc && doc.activeElement;
  if (!active) return false;
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || !!active.isContentEditable;
}

// `except` is the selector of one popup that may stay open without turning the guard off (`n`
// notes the open card, so the card details do not stop it); any other popup still does.
function keyGuardSurface(doc, except) {
  const open = KEY_GUARD_SURFACES.find((s) => doc.querySelector(except && s.name === 'dialog' ? `${s.selector}:not(${except})` : s.selector));
  return open ? open.name : null;
}

function keyGuardOff(doc, except) {
  return keyGuardTyping(doc) || keyGuardSurface(doc, except) !== null;
}

// What Esc does once nothing has taken it: 'clear-box' when focus is in the
// search box (the one text field Esc is for), 'step' when the selection steps
// back, null when Esc is not ours. The step runs only while the guard is on
// (nobody typing, nothing open), so Esc in any other text field, and Esc behind
// an open surface, never touches the selection. An open surface wins over the box.
function keyGuardEscape(doc, searchBox) {
  if (keyGuardSurface(doc) !== null) return null;
  if (searchBox && doc.activeElement === searchBox) return 'clear-box';
  return keyGuardTyping(doc) ? null : 'step';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KEY_GUARD_SURFACES, keyGuardTyping, keyGuardSurface, keyGuardOff, keyGuardEscape };
} else {
  window.KEY_GUARD_SURFACES = KEY_GUARD_SURFACES;
  window.keyGuardTyping = keyGuardTyping;
  window.keyGuardSurface = keyGuardSurface;
  window.keyGuardOff = keyGuardOff;
  window.keyGuardEscape = keyGuardEscape;
}
