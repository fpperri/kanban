'use strict';
// Enter in the search box goes to the match. The first Enter, with the suggestion list closed,
// closes the search panel, brings the first card the query matches in the view to the middle and
// gives it keyboard focus; the query, the filter or highlight, and the selection stay as they were.
// A second Enter on that card opens its details when it was the only card the query matched.
// Pure decisions only, same dual-environment export pattern as search-hotkey.js: app.js does the
// focus, the scroll and the pan.

// Whether this keydown in the box is the Enter that goes to the match: a plain Enter, not a held
// one, not part of an IME composition, with no row of the suggestion list highlighted (a
// highlighted row is the list's to pick).
function searchEnterKeyGoes(e, ctx) {
  if (!e || e.key !== 'Enter' || !ctx || ctx.highlighted) return false;
  if (e.defaultPrevented || e.isComposing || e.repeat) return false;
  return !(e.shiftKey || e.ctrlKey || e.metaKey || e.altKey);
}

// The first of the view's cards, in reading order, that the query matches; null when none does or
// there is no query (matchIds null). Ids compare as text, so a number and its string agree.
function searchEnterTarget(orderedIds, matchIds) {
  if (!matchIds) return null;
  const matched = new Set([...matchIds].map(String));
  for (const id of orderedIds) if (matched.has(String(id))) return String(id);
  return null;
}

// Whether Enter on the card `id` opens it whatever the click preference says: the query matched
// that card and no other in what the view shows.
function searchEnterOpens(matchIds, id) {
  if (!matchIds || matchIds.size !== 1) return false;
  return String(id) === String([...matchIds][0]);
}

// The Graph's view with the dot at (node.x, node.y) in the middle of a w by h stage, same zoom.
function searchEnterPan(view, node, w, h) {
  return { x: w / 2 - view.k * node.x, y: h / 2 - view.k * node.y, k: view.k };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { searchEnterKeyGoes, searchEnterTarget, searchEnterOpens, searchEnterPan };
} else {
  window.searchEnterKeyGoes = searchEnterKeyGoes;
  window.searchEnterTarget = searchEnterTarget;
  window.searchEnterOpens = searchEnterOpens;
  window.searchEnterPan = searchEnterPan;
}
