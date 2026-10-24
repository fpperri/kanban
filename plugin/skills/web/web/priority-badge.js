'use strict';
// Pure helper for priority emphasis. No DOM access — same
// dual-environment pattern as assignee-badge.js: loaded as a plain <script>
// in the browser (app.js calls priorityBadge as a bare global) AND required
// directly by node --test.
//
// Emphasis is positional in the board's configured `priorities` list
// (falling back to the built-in High/Normal/Low), never a hardcoded string
// check: first = hot (the classic red HIGH treatment), last of a 3+ list =
// muted, everything else — middle tiers and unknown free-text values —
// renders neutral. A two-item list has no muted tier: with only a top and a
// default there's nothing "below normal" to de-emphasize.

const FALLBACK_PRIORITIES = ['High', 'Normal', 'Low'];

function badgeEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function priorityBadge(card, priorities) {
  const list = priorities && priorities.length ? priorities : FALLBACK_PRIORITIES;
  const i = list.indexOf(card.priority);
  if (i === 0) return { className: 'high', label: badgeEscape(String(card.priority).toUpperCase()) };
  if (i === list.length - 1 && list.length >= 3) return { className: 'low', label: badgeEscape(String(card.priority).toUpperCase()) };
  return { className: '', label: '' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { priorityBadge };
} else {
  window.priorityBadge = priorityBadge;
}
