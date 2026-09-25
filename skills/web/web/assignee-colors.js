'use strict';
// Pure assignee -> color rules. No DOM here — same dual-
// environment pattern as status-colors.js/column-state.js: loaded as a plain
// <script> in the browser (assignee-badge.js/app.js call these as bare
// globals) AND required directly by node --test.
//
// Mirrors status-colors.js's contract exactly: a config.yaml `assignees`
// registry entry may reserve a `color` for its handle (same suggest-never-
// validate field as name/kind/description) — reserved wins; absent, the
// handle hashes into the SAME fixed 8-color palette custom statuses use
// (STATUS_PALETTE/statusHash, reused verbatim via the namespace-require
// pattern date-picker.js/gantt-model.js already use for calendar-model.js —
// not forked), so every assignee gets a stable color with no state to store.

const SCOL = (typeof module !== 'undefined' && module.exports)
  ? require('./status-colors')
  : window;

function normalizeHandle(handle) {
  return String(handle == null ? '' : handle).trim();
}

// Registry lookup is exact-match on the handle string — the same contract
// column-sort.js's assignee sort already relies on for registry rank, unlike
// statusColor's case/whitespace-folded match against status NAMES.
function findAssigneeEntry(handle, assignees) {
  const h = normalizeHandle(handle);
  if (!h || !assignees) return null;
  return assignees.find((a) => a && a.handle === h) || null;
}

function assigneeColor(handle, assignees) {
  const h = normalizeHandle(handle);
  if (!h) return null;
  const entry = findAssigneeEntry(h, assignees);
  if (entry && entry.color) return entry.color; // reserved wins, trusted as-is (never validated)
  return SCOL.STATUS_PALETTE[SCOL.statusHash(h.toLowerCase()) % SCOL.STATUS_PALETTE.length];
}

// The CSS-class twin of assigneeColor(), same reasoning as statusColorClass:
// a strict `style-src 'self'` CSP blocks inline style="" attributes. The
// HASHED outcome lands on one of the 8 fixed palette slots, which already has
// a hex — the SAME hexes status-colors.js's own `.status-dot--palette-N`
// bakes in, mirrored by assignee-badge.js's own `.assignee-text--palette-N`
// text-color rules (assignee color tints the handle text,
// not a dot, so it needs its own class family with the same numbering/hexes
// rather than reusing the dot's `background` rule verbatim). A RESERVED
// custom color is an open value space with no class to reuse, so this
// returns null for that case — the caller paints it with one small CSSOM
// assignment instead (never a string style attribute; see app.js's
// paintAssigneeColors / assignee-badge.js's data-assignee-color attribute).
function assigneeColorClass(handle, assignees) {
  const h = normalizeHandle(handle);
  if (!h) return null;
  const entry = findAssigneeEntry(h, assignees);
  if (entry && entry.color) return null;
  return `palette-${SCOL.statusHash(h.toLowerCase()) % SCOL.STATUS_PALETTE.length}`;
}

// The theme-following twin of assigneeColor() for inline CSSOM paints: a
// reserved color exactly as given, otherwise the hashed slot's token.
function assigneeColorVar(handle, assignees) {
  const h = normalizeHandle(handle);
  if (!h) return null;
  const entry = findAssigneeEntry(h, assignees);
  if (entry && entry.color) return entry.color;
  return `var(--hash-${SCOL.HASH_SLOTS[SCOL.statusHash(h.toLowerCase()) % SCOL.STATUS_PALETTE.length]})`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeHandle, findAssigneeEntry, assigneeColor, assigneeColorClass, assigneeColorVar };
} else {
  window.normalizeHandle = normalizeHandle;
  window.findAssigneeEntry = findAssigneeEntry;
  window.assigneeColor = assigneeColor;
  window.assigneeColorClass = assigneeColorClass;
  window.assigneeColorVar = assigneeColorVar;
}
