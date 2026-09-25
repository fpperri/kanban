'use strict';
// Pure decision logic for wiring the card detail popup into the browser's OWN
// history (kanban.proj#277) — so Alt+Left/Alt+Right, the mouse back/forward
// buttons, and the browser's own arrows all step between opened cards with no
// separate keyboard shortcut fighting them. No DOM here — same
// dual-environment pattern as deep-link.js/refresh-policy.js: loaded as a
// plain <script> in the browser (app.js calls these as bare globals) AND
// required directly by node --test. app.js does the actual
// history.pushState/openDetailModal/closeDetailModal calls; this module only
// decides what URL (if any) a step should carry, and what a popstate landing
// on a URL means for the popup.
//
// The model is deliberately push-only — there is no "replace" step. Opening
// card A, then a mention of B inside it, then a mention back to A again are
// three separate user gestures a person may want to walk back through one at
// a time, exactly like three page visits; collapsing any of them into a
// replace would make Back skip a step the user actually took. The one
// exception isn't a replace, it's a no-op: opening (or closing) the exact
// card the URL already names pushes nothing, so clicking the same tile twice
// — or a popstate landing back on it — never grows a run of duplicate steps.

// The `card` param out of a querystring, applying the same hasCard/id rules
// as deep-link.js's parseDeepLink (a missing, non-numeric, or
// non-positive-integer value all read as "no card") — reimplemented narrowly
// here (card only, not q/view) since neither a pushed step nor a popstate
// landing ever needs to touch the search query or the view mode. Also what a
// popstate handler reads off the browser-updated location.search to decide
// between opening the named card and closing the popup.
function cardIdFromSearch(search) {
  const params = new URLSearchParams(search || '');
  if (!params.has('card')) return null;
  const id = Number(params.get('card'));
  return Number.isInteger(id) && id > 0 ? id : null;
}

// What opening (targetId a positive integer) or closing (targetId null)
// should do to CURRENT_SEARCH (location.search, as a plain string so this
// stays testable without a DOM). Returns the new search string to push
// (leading "?", or "" for none of the params survive), preserving every
// OTHER param the URL already carries (q, view, ...) — only `card` changes.
// Returns null instead when CURRENT_SEARCH already names this exact target,
// open or closed alike: the caller must not push a duplicate step.
function nextCardHistorySearch(currentSearch, targetId) {
  const params = new URLSearchParams(currentSearch || '');
  if (cardIdFromSearch(currentSearch) === targetId) return null;
  if (targetId == null) params.delete('card');
  else params.set('card', String(targetId));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cardIdFromSearch, nextCardHistorySearch };
} else {
  window.cardIdFromSearch = cardIdFromSearch;
  window.nextCardHistorySearch = nextCardHistorySearch;
}
