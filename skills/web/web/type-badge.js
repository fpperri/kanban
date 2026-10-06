'use strict';
// Pure helpers for the card-type chip. No DOM access — same dual-environment
// pattern as assignee-badge.js: a plain <script> in the browser, required
// directly by node --test.
//
// A card's `type` is free text; the board's `types:` list (config.yaml) only
// suggests names and may give one an OPTIONAL color. A type the list does not
// know, or one listed without a color, is a neutral chip. A configured color
// is an open value space (hex, name, ...), so it rides a `data-type-color`
// attribute and app.js paints it after insertion; a string style="" would be
// blocked by the strict style-src 'self' CSP.

const ASSIGNEE_BADGE = (typeof module !== 'undefined' && module.exports)
  ? require('./assignee-badge')
  : window;

function typeKey(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}

function typeColor(type, types) {
  const key = typeKey(type);
  const hit = (types || []).find((t) => typeKey(t.name) === key);
  return hit && hit.color ? hit.color : '';
}

function typeBadge(card, types) {
  const text = String(card.type == null ? '' : card.type).trim();
  if (!text) return '';
  const color = typeColor(text, types);
  const esc = ASSIGNEE_BADGE.escapeHtml;
  const colorAttr = color ? ` data-type-color="${esc(color)}"` : '';
  return `<span class="type-chip" title="${esc(text)}"${colorAttr}>${esc(text)}</span>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { typeBadge, typeColor };
} else {
  window.typeBadge = typeBadge;
  window.typeColor = typeColor;
}
