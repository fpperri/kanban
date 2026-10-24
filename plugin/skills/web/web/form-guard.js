'use strict';
// Pure dirty-check for the create/edit form. No DOM access — the
// caller snapshots field values on modal open and asks isDirty(snapshot,
// current) before a backdrop-click close. Dual-environment module, same
// pattern as refresh-policy.js.

// Strict shallow comparison over own keys: any changed value, added key, or
// missing key counts as dirty. A null/undefined snapshot is never dirty —
// there's no baseline to lose, so a close must not speedbump.
function isDirty(snapshot, current) {
  if (snapshot == null) return false;
  const a = Object.keys(snapshot);
  const b = Object.keys(current || {});
  if (a.length !== b.length) return true;
  return a.some((k) => !(k in current) || snapshot[k] !== current[k]);
}

// Minimal-first create form — the pure mode → presentation decision.
// The create modal opens with just Title + a "Show more fields" button; edit
// always opens full. `expanded` is the per-open reveal flag: openModal passes
// false on every open (one-way per open, nothing persisted), the show-more
// click re-asks with true. Hiding is presentation only — the hidden fields
// keep the defaults openModal set, so the save payload never changes.
function isMinimalCreate(isEdit, expanded) {
  return !isEdit && !expanded;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isDirty, isMinimalCreate };
} else {
  window.isDirty = isDirty;
  window.isMinimalCreate = isMinimalCreate;
}
