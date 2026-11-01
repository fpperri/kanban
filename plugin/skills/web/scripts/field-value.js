'use strict';
// A card field's value as a person would call it the same: an empty text, an empty list or nothing at all
// is one value, and a number reads as its text (the edit form sends a rank or a parent as text, the card
// holds a rank as a number). The page compares an edit with the card with it (scripts/page-source.js), and
// the apply compares an edit's value with the one an earlier edit set (scripts/apply-tray.js), so the two
// agree on what changed. Same dual-environment pattern as ids.js: required by node --test and the apply,
// and loaded as a plain <script> (one global, window.kanbanFieldValue).

const fieldValueModule = (() => {
  const plain = (v) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? null : Array.isArray(v) ? JSON.stringify(v) : String(v));
  const sameValue = (a, b) => plain(a) === plain(b);
  return { plain, sameValue };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = fieldValueModule;
} else {
  window.kanbanFieldValue = fieldValueModule;
}
