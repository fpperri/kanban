'use strict';
// Pure helpers for the assignee badge and the shared HTML-escaping
// used everywhere a card-derived string is interpolated into innerHTML. No DOM
// access here on purpose — same dual-environment pattern as refresh-policy.js/
// column-state.js: loaded as a plain <script> in the browser (app.js calls
// escapeHtml/assigneeBadge as bare globals) AND required directly by
// node --test, without needing a DOM/jsdom shim.

const ACOL = (typeof module !== 'undefined' && module.exports)
  ? require('./assignee-colors')
  : window;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Empty string when unset (server sends null) so no "undefined"/blank badge
// ever renders; escaped like every other card-derived string.
//
// The handle itself wears the assignee color as tinted text — no separate
// dot glyph. `assignees` is
// the board's config registry (state.assignees) — optional so old call
// sites/tests that don't pass one still render (no registry = every handle
// hashes, same as statusColor with no custom statuses configured). The
// hashed case gets an `.assignee-text--palette-N` class (app.css — same 8
// hexes/numbering as status-colors.js's STATUS_PALETTE, a parallel class
// family since it sets `color` not statusBadge()'s `background`). A
// RESERVED config.yaml color has no fixed class (open value space), so the
// span rides a `data-assignee-color` attribute instead; app.js paints it via
// one CSSOM assignment after insertion — never a string style="" attribute
// (CSP style-src 'self', no unsafe-inline).
function assigneeBadge(card, assignees) {
  if (!card.assignee) return '';
  const handle = card.assignee;
  const cls = ACOL.assigneeColorClass(handle, assignees);
  const textClass = cls ? ` assignee-text--${cls}` : '';
  const reserved = cls ? '' : ` data-assignee-color="${escapeHtml(ACOL.assigneeColor(handle, assignees) || '')}"`;
  return `<span class="card-assignee${textClass}" title="${escapeHtml(handle)}"${reserved}>${escapeHtml(handle)}</span>`;
}

// The @human/@hitl/@afk role trio is THE canonical default — a
// board whose config.yaml has NO assignees registry still suggests exactly
// these three. Shapes mirror config-store registry entries. Suggest, never
// validate: free-text handles stay legal everywhere.
const DEFAULT_ASSIGNEES = [
  { handle: '@human', name: 'Human', kind: 'human', description: 'A human can grab it. Final say on trusted and destructive calls.' },
  { handle: '@hitl', name: 'AI (HITL)', kind: 'ai-hitl', description: 'AI will grab it but needs a human in the loop (grilling, spec, tickets, approval) — it should make the AI think twice.' },
  { handle: '@afk', name: 'AI (AFK)', kind: 'ai-afk', description: 'The AI can execute fully autonomously.' },
];

// A configured registry always wins untouched; only empty/absent falls back.
function resolveAssignees(list) {
  return list && list.length ? list : DEFAULT_ASSIGNEES;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { escapeHtml, assigneeBadge, resolveAssignees, DEFAULT_ASSIGNEES };
} else {
  window.escapeHtml = escapeHtml;
  window.assigneeBadge = assigneeBadge;
  window.resolveAssignees = resolveAssignees;
  window.DEFAULT_ASSIGNEES = DEFAULT_ASSIGNEES;
}
