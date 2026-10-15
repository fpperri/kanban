'use strict';
// The one guard behind the single-key shortcuts: `/` focuses the search box,
// and the keys added later (the slice keys, `n`) read the same guard unchanged.
// It has two parts. The typing check is for a key that would insert a
// character: it stays off while focus is in a field. The surface check is for
// a key that would act on the board behind an open popup: it stays off while
// one is up. Ctrl+F inserts nothing, so it reads only the surface check and
// still works from inside a text field.
//
// The surfaces are pinned by name. The search panel is deliberately not one:
// the slice keys work while it is open. The preferences sheet does not exist
// yet; its entry is here so the sheet takes the guard the day it lands.
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

function keyGuardSurface(doc) {
  const open = KEY_GUARD_SURFACES.find((s) => doc.querySelector(s.selector));
  return open ? open.name : null;
}

function keyGuardOff(doc) {
  return keyGuardTyping(doc) || keyGuardSurface(doc) !== null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KEY_GUARD_SURFACES, keyGuardTyping, keyGuardSurface, keyGuardOff };
} else {
  window.KEY_GUARD_SURFACES = KEY_GUARD_SURFACES;
  window.keyGuardTyping = keyGuardTyping;
  window.keyGuardSurface = keyGuardSurface;
  window.keyGuardOff = keyGuardOff;
}
