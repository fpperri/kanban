'use strict';
// Ctrl+S / Cmd+S saves the open popup: the keyboard twin of that
// popup's Save/Apply button, so a save habit formed in every other editor
// works mid-typing here instead of popping the browser's save-page dialog.
// Pure decision logic only — given the chord and which save-capable popups
// are open, return the popup key to save, or null. app.js maps the key to
// the concrete action (requestSubmit for the edit form, an Apply .click()
// for the bulk popups). Same dual-environment export pattern as the other
// web/*.js helpers (form-guard.js, column-sort.js, ...).
//
// Scope contract: only popups with ONE unambiguous save action participate.
// The edit/create modal saves via its form; bulkSingle and bulkSchedule via
// their single Apply button. bulk-tags is deliberately absent — it has two
// competing actions (add tag / remove tags), so Ctrl+S there stays a no-op
// rather than guessing. Chord is strict: exactly Ctrl+S or Cmd+S — Alt or
// Shift chords (e.g. Ctrl+Shift+S "save as" muscle memory) never match,
// mirroring the Alt+Enter hotkey's strictness.

// Priority order is deterministic tie-breaking only; the popups are mutually
// exclusive in practice.
const SAVE_ORDER = ['edit', 'bulkSingle', 'bulkSchedule'];

function saveHotkeyTarget(chord, open) {
  if (!chord || !open) return null;
  const key = typeof chord.key === 'string' ? chord.key.toLowerCase() : '';
  if (key !== 's') return null;
  if (!chord.ctrlKey && !chord.metaKey) return null;
  if (chord.altKey || chord.shiftKey) return null;
  for (const k of SAVE_ORDER) { if (open[k]) return k; }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { saveHotkeyTarget, SAVE_ORDER };
} else {
  window.saveHotkeyTarget = saveHotkeyTarget;
  window.SAVE_ORDER = SAVE_ORDER;
}
