'use strict';
// A card's `type` is free text; the board's `types:` list (config.yaml) only
// suggests names and may give one an OPTIONAL color. A type the list does not
// know, or one listed without a color, is a neutral chip. A configured color
// is an open value space (hex, name, ...), so it rides a `data-type-color`
// attribute and app.js paints it after insertion; a string style="" would be
// blocked by the strict style-src 'self' CSP.
//
// A type the list gives an icon (type-icons.js holds the closed table of six)
// starts its chip with that glyph. The glyph is plain text inside the chip, so
// it wears the chip's colour, painted from the same data attribute; the icon
// name itself never reaches the markup, only the table's own character does.

const ASSIGNEE_BADGE = (typeof module !== 'undefined' && module.exports)
  ? require('./assignee-badge')
  : window;
const TYPE_BADGE_ICONS = (typeof module !== 'undefined' && module.exports)
  ? require('./type-icons')
  : window;

function typeKey(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}

function typeColor(type, types) {
  const key = typeKey(type);
  const hit = (types || []).find((t) => typeKey(t.name) === key);
  return hit && hit.color ? hit.color : '';
}

// Types off (typesOn: false, docs/adr/0018): the gate for the two LISTS. The views read the board's
// types and hierarchy through this, so with it off they hold none, as on a board that declares none;
// the payload itself is left as written. It is not the whole of types off: the flag also reaches
// typeBadge (a card's chip), the edit form's Type field and the detail's type line, which draw a card's own
// word rather than a list and read `typesOn` themselves.
function boardTypeView(data) {
  const typesOn = !data || data.typesOn !== false;
  return { typesOn, types: typesOn ? (data && data.types) || [] : [], hierarchy: typesOn ? (data && data.hierarchy) || [] : [] };
}

// typesOn is the board's flag; off, a typed card still carries no chip, since a chip needs no listed type.
function typeBadge(card, types, typesOn) {
  if (typesOn === false) return '';
  const text = String(card.type == null ? '' : card.type).trim();
  if (!text) return '';
  const color = typeColor(text, types);
  const esc = ASSIGNEE_BADGE.escapeHtml;
  const colorAttr = color ? ` data-type-color="${esc(color)}"` : '';
  const glyph = TYPE_BADGE_ICONS.typeIconGlyph(TYPE_BADGE_ICONS.typeIconOf(text, types));
  const icon = glyph ? `<span class="type-icon" aria-hidden="true">${glyph}</span>` : '';
  return `<span class="type-chip" title="${esc(text)}"${colorAttr}>${icon}${esc(text)}</span>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { typeBadge, typeColor, boardTypeView };
} else {
  window.typeBadge = typeBadge;
  window.typeColor = typeColor;
  window.boardTypeView = boardTypeView;
}
