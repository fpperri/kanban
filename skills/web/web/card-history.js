'use strict';
// Pure decision logic for the page's address: the card detail popup in the browser's OWN
// history, and the search box's text and isolate flag in the query string. The popup is
// wired in so Alt+Left/Alt+Right, the mouse back/forward
// buttons, and the browser's own arrows all step between opened cards with no
// separate keyboard shortcut fighting them. No DOM here — same
// dual-environment pattern as deep-link.js/refresh-policy.js: loaded as a
// plain <script> in the browser (app.js calls these as bare globals) AND
// required directly by node --test. app.js does the actual
// history.pushState/openDetailModal/closeDetailModal calls; this module only
// decides what URL (if any) a step should carry, and what a popstate landing
// on a URL means for the popup.
//
// Opening and closing a card are deliberately push-only — never a "replace".
// Opening card A, then a mention of B inside it, then a mention back to A
// again are three separate user gestures a person may want to walk back
// through one at a time, exactly like three page visits; collapsing any of
// them into a replace would make Back skip a step the user actually took. The
// one exception isn't a replace, it's a no-op: opening (or closing) the exact
// card the URL already names pushes nothing, so clicking the same tile twice
// — or a popstate landing back on it — never grows a run of duplicate steps.
//
// The search box's text is the other thing the address carries (`q`), and it
// is never a step of its own: nextSearchAddress below says what `q` should
// become, and the caller REPLACES the entry it is on, so typing grows no
// history. Back and Forward never write the box; when one lands on an entry
// whose `q` differs from the box, the caller replaces that entry with the
// box's text. `isolate=1` rides beside `q` the same way: it is never a step either.

// The `card` param out of a querystring, applying the same hasCard/id rules
// as deep-link.js's parseDeepLink (a missing value, or one that is no id, reads
// as "no card"; the id is the whole id, `7` or `G7`) — reimplemented narrowly
// here (card only, not q/view) since neither a pushed step nor a popstate
// landing ever needs to touch the search query or the view mode. Also what a
// popstate handler reads off the browser-updated location.search to decide
// between opening the named card and closing the popup.
const CH_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

function cardIdFromSearch(search) {
  const params = new URLSearchParams(search || '');
  if (!params.has('card')) return null;
  return CH_IDS.idKey(params.get('card'));
}

// What opening (targetId a card id) or closing (targetId null)
// should do to CURRENT_SEARCH (location.search, as a plain string so this
// stays testable without a DOM). Returns the new search string to push
// (leading "?", or "" for none of the params survive), preserving every
// OTHER param the URL already carries (q, isolate, view, ...) — only `card` changes.
// Returns null instead when CURRENT_SEARCH already names this exact target,
// open or closed alike: the caller must not push a duplicate step.
function nextCardHistorySearch(currentSearch, targetId) {
  const params = new URLSearchParams(currentSearch || '');
  const target = targetId == null ? null : CH_IDS.idKey(targetId);
  if (cardIdFromSearch(currentSearch) === target) return null;
  if (target === null) params.delete('card');
  else params.set('card', target);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// What the address (CURRENT_SEARCH, location.search as a plain string) should
// be once the search box holds BOX_TEXT: `q` is the box's text, or gone when
// the box is empty or blank, and every OTHER parameter (card, view, and
// whatever a later one adds) stays as it was. ISOLATED says whether isolate is on:
// then `isolate=1` stands beside `q`, and it is gone when isolate is off or the box
// holds no query (an isolate with no query is nothing). Returns the new search string
// (leading "?", or "" when nothing is left), or null when the address already
// matches — the caller replaces the history entry only when this is not null,
// so fast typing never hammers the browser's limit on history replacements.
// The text goes in verbatim, trailing spaces included, and is encoded by
// URLSearchParams, so "#", "|", quotes and spaces never become a fragment or
// get mangled; parseDeepLink trims on the way back in.
function nextSearchAddress(currentSearch, boxText, isolated) {
  const params = new URLSearchParams(currentSearch || '');
  const text = typeof boxText === 'string' ? boxText : '';
  let changed = false;
  if (text.trim()) {
    if (params.get('q') !== text) { params.set('q', text); changed = true; }
  } else if (params.has('q')) {
    params.delete('q');
    changed = true;
  }
  if (isolated && text.trim()) {
    if (params.get('isolate') !== '1') { params.set('isolate', '1'); changed = true; }
  } else if (params.has('isolate')) {
    params.delete('isolate');
    changed = true;
  }
  if (!changed) return null;
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cardIdFromSearch, nextCardHistorySearch, nextSearchAddress };
} else {
  window.cardIdFromSearch = cardIdFromSearch;
  window.nextCardHistorySearch = nextCardHistorySearch;
  window.nextSearchAddress = nextSearchAddress;
}
