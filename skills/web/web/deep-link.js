'use strict';
// ?card=<id>&q=<search>&view=<board|map|gantt|calendar> deep links: parses
// location.search into which card to open, which query to filter by, and
// which view to switch to.
// Pure parse-only logic, same dual-environment export pattern as
// search-hotkey.js/refresh-policy.js — app.js's DOMContentLoaded handler
// does the DOM part (switching viewMode, calling openDetailModal,
// scrollIntoView) exactly once, right after the first loadBoard() resolves;
// nothing here holds state, so there's nothing that could re-fire on the 5s
// poll or fight the localStorage-persisted view mode.

const DEEP_LINK_VIEWS = new Set(['board', 'map', 'gantt', 'calendar']);

// `search` is location.search ("?card=194&view=board"), a plain string so
// this stays testable from Node without a DOM. "No deep link in play" — the
// overwhelming common case, every normal load — is *none* of the three keys
// resolving to anything, returned as null so callers can skip the whole flow
// with one falsy check. It is deliberately NOT "no `card` key": `card` points
// at ONE card, `q` points at a SET, and `view` points at neither, so each
// stands on its own and a link may carry any combination (kanban.proj#262).
//
// `hasCard` exists to keep two different situations apart, because both leave
// id null: a link that never asked for a card, and a link that asked with an
// unusable value. Only the second owes the user a toast — the first is just a
// q-and/or-view link, and toasting it would fire on every status-page link.
// A `card` value that isn't a positive integer still resolves the REST of the
// link rather than discarding it: one bad key is not a reason to drop a query
// and a view that both parsed fine.
//
// `q` is trimmed, and empty-or-whitespace-only reads as absent rather than as
// a filter matching everything — "?q=" is a link that forgot its query, not a
// request for an empty search. Its value is never inspected beyond that: it is
// the board's own search grammar, handed to the search box verbatim, so
// anything search.js parses is exactly what a link can carry and there is no
// second query language to keep in step.
//
// An unrecognized/missing `view` resolves to null: no view switch, normal
// load's persisted view stands.
function parseDeepLink(search) {
  if (typeof search !== 'string' || !search) return null;
  let params;
  try { params = new URLSearchParams(search); } catch (e) { return null; }
  const hasCard = params.has('card');
  const rawQ = params.get('q');
  const q = typeof rawQ === 'string' && rawQ.trim() ? rawQ.trim() : null;
  const rawView = params.get('view');
  const view = DEEP_LINK_VIEWS.has(rawView) ? rawView : null;
  if (!hasCard && q === null && view === null) return null;
  const id = Number(params.get('card'));
  return {
    hasCard,
    id: hasCard && Number.isInteger(id) && id > 0 ? id : null,
    q,
    view,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDeepLink, DEEP_LINK_VIEWS };
} else {
  window.parseDeepLink = parseDeepLink;
  window.DEEP_LINK_VIEWS = DEEP_LINK_VIEWS;
}
