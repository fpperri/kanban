'use strict';
// Ctrl+F / Cmd+F: focuses the board's search box and
// pre-fills "#" with the caret right after it, so typing digits immediately
// forms the #<id> exact-match term in a couple of keystrokes. Pure chord +
// value-decision logic only, same dual-environment export pattern as
// save-hotkey.js — app.js's keydown listener does the DOM part (focus,
// preventDefault, setting .value/selection).
//
// Decision — an existing query in the box: SELECT it, don't clobber it with
// "#". An empty box getting "#" prefilled is the whole point of the feature
// (erasing it by hand to type something else instead is fine, cheap), but
// silently nuking a query someone already typed on the very chord that's
// supposed to help them search would be hostile. Select-all also mirrors
// what Ctrl+F/Cmd+F already does in every browser's native find bar
// (re-opening it re-selects the prior term), so the muscle memory carries
// over: keep typing to replace it, or arrow off to edit in place.
//
// Decision — suppressed while a surface is open (key-guard.js names them: a popup, the
// card menu, the notifications panel, the preferences sheet): yes. Every popup shares
// the .modal-backdrop convention (position:fixed, inset:0 — app.css), which
// covers the whole viewport, so the search bar sits fully hidden behind it
// whenever one is open. Unlike Ctrl+S, whose TARGET is the open
// popup itself, this hotkey's target is a board-level control the popup is
// actively covering — focusing it there would silently steal keystrokes from
// the popup's own fields with nothing on screen to explain why. Same
// "no reachable target, no-op, browser default stands" contract as
// save-hotkey's, just the mirror condition: that one fires only INSIDE a
// popup, this one only fires OUTSIDE one.
const SHK_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

function searchHotkeyPrefill(chord, ctx) {
  if (!chord) return null;
  const key = typeof chord.key === 'string' ? chord.key.toLowerCase() : '';
  if (key !== 'f') return null;
  if (!chord.ctrlKey && !chord.metaKey) return null;
  if (chord.altKey || chord.shiftKey) return null;
  if (!ctx || ctx.surfaceOpen) return null;
  const value = String(ctx.currentValue || '');
  if (!value) return { value: '#', selectionStart: 1, selectionEnd: 1 };
  return { value, selectionStart: 0, selectionEnd: value.length };
}

// The "#" prefill above is only meant to stick while the
// user is still typing an id (digits). Called on every 'input' event with
// the box's current value — as long as everything after the "#" is digits
// (or nothing yet), the "#" stays; the moment a non-numeric char shows up
// in there, the id search is off the table, so drop the leading "#" and
// let the rest read as a plain search term. Only while the box holds that one
// token: a second token or a | after the id (`#12 | #14`, or the `#12 | path:40`
// that isolate writes) means the "#" is part of a query, and stays. Returns
// null (no change) rather than echoing the input back unchanged, so callers
// can skip touching value/selection when nothing needs to move.
function searchHashStrip(value) {
  if (typeof value !== 'string' || value[0] !== '#') return null;
  const rest = value.slice(1).trimEnd();
  if (/\s/.test(rest) || rest === '' || SHK_IDS.parseId(rest) !== null || /^_?[A-Z]*$/.test(rest)) return null;
  return value.slice(1);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { searchHotkeyPrefill, searchHashStrip };
} else {
  window.searchHotkeyPrefill = searchHotkeyPrefill;
  window.searchHashStrip = searchHashStrip;
}
