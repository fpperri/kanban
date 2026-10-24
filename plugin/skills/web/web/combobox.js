'use strict';
// Hand-rolled combobox rules. Native <datalist> is
// unusable inside VSCode's Simple Browser — the popup renders at wrong
// coordinates and its filter-by-current-value hides every other option on a
// prefilled field — so the form draws its own menu. Pure logic here, DOM
// wiring in app.js; same dual-environment pattern as the other web modules.
//
// Options are { value, label? } objects. Free text stays legal everywhere:
// the menu only ever suggests, the input keeps whatever was typed.

// Which options to show for the input's current text:
// - empty segment, or segment exactly equal to an option → ALL options (a
//   prefilled 'Normal' must not hide High/Low — the datalist failure mode)
// - otherwise substring match, case-insensitive, on value or label
// In tag mode the "segment" is the text after the last comma, so completing
// one tag of a comma-separated list works.
function comboboxSuggestions(options, text, { tagMode = false } = {}) {
  const seg = (tagMode ? String(text).split(',').pop() : String(text)).trim().toLowerCase();
  if (seg === '' || options.some((o) => String(o.value).toLowerCase() === seg)) return options.slice();
  return options.filter((o) =>
    String(o.value).toLowerCase().includes(seg) || String(o.label || '').toLowerCase().includes(seg));
}

// What the input's value becomes when a suggestion is picked. In tag mode:
// - append: true → the pick is a browse-pick (menu opened by focus, nothing
//   typed) — add the choice as a NEW segment, keeping the complete last tag
// - append: false → the pick completes the segment being typed — replace it
// Either way a tag never appears twice.
function applyChoice(text, choice, { tagMode = false, append = false } = {}) {
  if (!tagMode) return choice;
  const segs = append ? String(text).split(',') : String(text).split(',').slice(0, -1);
  const kept = segs.map((p) => p.trim()).filter((p) => p !== '');
  if (kept.some((t) => t.toLowerCase() === String(choice).toLowerCase())) return kept.join(', ');
  return [...kept, choice].join(', ');
}

// Up/Down highlight math. `current` is the existing highlight
// index, -1 meaning none highlighted yet. `direction` is +1 (Down) or -1 (Up).
// Wraps at both ends. An out-of-range `current` is treated the same as none —
// purely defensive: app.js's own attachCombobox resets highlightIndex to -1
// on every (re)open, including a re-filter mid-typing (see its open()), so a
// stale index never actually reaches this function through that real caller.
// This guard just keeps the pure function safe for any caller that doesn't
// share that discipline, rather than describing a scenario that happens today.
function nextHighlightIndex(length, current, direction) {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return direction > 0 ? 0 : length - 1;
  const next = (current + direction) % length;
  return next < 0 ? next + length : next;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { comboboxSuggestions, applyChoice, nextHighlightIndex };
} else {
  window.comboboxSuggestions = comboboxSuggestions;
  window.applyChoice = applyChoice;
  window.nextHighlightIndex = nextHighlightIndex;
}
