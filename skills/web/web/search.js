'use strict';
// Pure query parser + matcher for the board search box. No DOM here —
// same dual-environment pattern as refresh-policy.js/column-state.js: loaded as a
// plain <script> in the browser (app.js calls these as bare globals) AND required
// directly by node --test.
//
// Syntax (space-separated terms AND together; each prefix binds to its own term):
//   #42 / id:42   exact card id
//   title:foo     substring on title
//   body:foo      substring on markdown body
//   status:doing  substring on status
//   priority:high substring on priority
//   tags:ui       substring on any one tag
//   file:0011     substring on the card's filename (basename)
//   assignee:@afk substring on the card's assignee handle. `A:`/`a:` is a
//                 thin alias for this same scope — resolved to
//                 'assignee' at parse time, before the KNOWN_FIELDS value/
//                 lowercasing logic runs, so it shares every rule below with
//                 the long form (case-insensitive substring, dropped when
//                 valueless mid-typing).
//   type:objective substring on the card's type (free text; the board's
//                 `types:` list only suggests names, it never filters).
//   review: / blocked:   sticker scopes (ADR 0009) — UNLIKE every
//                 KNOWN_FIELDS scope above, a bare `review:`/`blocked:` (no
//                 value) is a COMPLETE term meaning "the sticker is present"
//                 (the shared isReviewValue/isBlockedValue predicate), never
//                 dropped as mid-typing. `review:PR` / `blocked:vendor` is a
//                 case-insensitive substring match on the sticker's text.
//   tree:74 / tree:#74   card #74's dependency tree — the connected component
//                 (undirected) reachable from card 74 over the edges the
//                 map's graph is built from (waiting_for + parent edges —
//                 parent edges shape layout but draw no line).
//   path:74 / path:#74   card #74's dependency path — the directed cone:
//                 everything transitively upstream + downstream through card
//                 74, over the same edges. Narrower than tree: (excludes
//                 sibling branches with no directed relation to 74).
//   bare text     substring on title OR body OR any tag — the "don't remember
//                 which field" fallback. An unrecognized `foo:bar` prefix also
//                 lands here (searched as the literal string "foo:bar") rather
//                 than silently matching nothing on a typo'd field name.
// All matching is case-insensitive except the id's exact comparison; tree:/
// path: compare numerically (leading zeros/whitespace normalize the same way
// dependency-graph.js's treeIds/pathIds normalize their id argument).
//
// A recognized prefix with nothing after the colon yet (e.g. "status:" mid-
// keystroke, before the value is typed) is not-yet-a-term and is dropped
// entirely — same as an empty query yields no terms (see filterCards below).
// Without this, String.prototype.includes('') would make that term match
// every card, flashing a false "everything matched" state for one keystroke.
//
// tree:/path: resolution needs the full card graph, which a single (term,
// card) pair doesn't have — see filterCards below for where that happens.
const DG = (typeof module !== 'undefined' && module.exports) ? require('./dependency-graph') : window;
// Named WBS (not WB) — dependency-graph.js already claims WB in this shared
// page scope (every web/*.js top-level name must be unique).
const WBS = (typeof module !== 'undefined' && module.exports) ? require('./waiting-blocked') : window;

const KNOWN_FIELDS = ['title', 'body', 'status', 'priority', 'tags', 'file', 'assignee', 'type'];
// tree:/path: are deliberately NOT in KNOWN_FIELDS — that array drives the
// lowercased-substring value semantics, which don't apply to a numeric id.
const GRAPH_FIELDS = ['tree', 'path'];
// ADR 0009: review:/blocked: are their own field family — a
// bare value is a valid presence term (unlike KNOWN_FIELDS, where a bare
// scope is dropped as mid-typing), so they're parsed separately below.
const STICKER_FIELDS = ['review', 'blocked'];
// `A:`/`a:` is a thin alias for `assignee:` — resolved here,
// before the KNOWN_FIELDS check, so the alias falls through the exact same
// value/lowercasing path as the long form rather than duplicating it.
const FIELD_ALIASES = { a: 'assignee' };

function parseTerm(token) {
  const idShorthand = token.match(/^#(\d+)$/);
  if (idShorthand) return { field: 'id', value: idShorthand[1] };

  const prefixed = token.match(/^([A-Za-z]+):(.*)$/);
  if (prefixed) {
    const key = FIELD_ALIASES[prefixed[1].toLowerCase()] || prefixed[1].toLowerCase();
    if (key === 'id') {
      const value = prefixed[2].trim();
      return value ? { field: 'id', value } : null;
    }
    if (GRAPH_FIELDS.includes(key)) {
      // id accepts an optional leading '#' (tree:74 and tree:#74
      // are the same term) — kept case-verbatim like id:, no lowercasing.
      const value = prefixed[2].trim().replace(/^#/, '');
      return value ? { field: key, value } : null;
    }
    if (KNOWN_FIELDS.includes(key)) {
      const value = prefixed[2].trim().toLowerCase();
      return value ? { field: key, value } : null;
    }
    // ADR 0009: bare review:/blocked: is itself a complete "sticker present"
    // term — always returned, even with an empty value (never dropped).
    if (STICKER_FIELDS.includes(key)) {
      return { field: key, value: prefixed[2].trim().toLowerCase() };
    }
  }

  return { field: null, value: token.toLowerCase() };
}

function parseSearchQuery(raw) {
  return String(raw || '').trim().split(/\s+/).filter(Boolean).map(parseTerm).filter(Boolean);
}

function termMatchesCard(term, card) {
  const title = (card.title || '').toLowerCase();
  const body = (card.body || '').toLowerCase();
  const tags = card.tags || [];
  switch (term.field) {
    case 'id': return String(card.id) === term.value;
    case 'title': return title.includes(term.value);
    case 'body': return body.includes(term.value);
    case 'status': return (card.status || '').toLowerCase().includes(term.value);
    case 'priority': return (card.priority || '').toLowerCase().includes(term.value);
    case 'tags': return tags.some((t) => t.toLowerCase().includes(term.value));
    case 'file': return (card.file || '').toLowerCase().includes(term.value);
    case 'assignee': return (card.assignee || '').toLowerCase().includes(term.value);
    case 'type': return (card.type || '').toLowerCase().includes(term.value);
    // ADR 0009: bare (no value) = the shared presence predicate; a value =
    // case-insensitive substring on the sticker's own text (never the raw
    // field — a bare `true` sticker's text is '', which no non-empty
    // substring term matches, exactly mirroring the pill's own label).
    case 'review': return term.value ? WBS.reviewReason(card.review).toLowerCase().includes(term.value) : WBS.isReviewValue(card.review);
    case 'blocked': return term.value ? WBS.blockedReason(card.blocked).toLowerCase().includes(term.value) : WBS.isBlockedValue(card.blocked);
    // pre-resolved by filterCards (below) into an id Set — a raw,
    // unresolved 'tree'/'path' term has no graph to resolve against here (a
    // single (term, card) pair isn't enough), so it matches nothing rather
    // than throwing. Always goes through filterCards in practice.
    case 'tree': case 'path': return false;
    case 'ids': return term.ids.has(Number(card.id));
    default: // bare term: title + body + tags
      return title.includes(term.value) || body.includes(term.value)
        || tags.some((t) => t.toLowerCase().includes(term.value));
  }
}

function cardMatchesQuery(card, terms) {
  return terms.every((term) => termMatchesCard(term, card));
}

// tree:/path: terms need the FULL card graph to resolve (connected
// component / directed cone), not just the one card being tested — so they're
// resolved ONCE here, up front, against `cards` (the same array filterCards
// was called with), via dependency-graph.js's treeIds/pathIds — which in turn
// build their adjacency from buildDependencyGraph(cards, null).edges, the
// exact edge set (waiting_for + parent edges) the map's graph is built from
// (parent edges shape layout but draw no line). Each 'tree'/
// 'path' term becomes an 'ids' term (an already-resolved Set) before the
// per-card cardMatchesQuery pass runs, so termMatchesCard's 'ids' case stays a
// pure, cheap Set.has() with no graph access of its own.
//
// Contract note: `cards` here doubles as "the cards to filter down" AND (only
// when a tree:/path: term is present) "the universe to build the graph from".
// Every filterCards call site MUST pass the full board (active + archived),
// never a pre-filtered subset — traversal is always over live + archived
// cards, by design. A subset would silently produce a
// wrong/smaller graph with no error.
function resolveGraphTerms(cards, terms, ctx) {
  if (!terms.some((t) => t.field === 'tree' || t.field === 'path')) return terms;
  return terms.map((term) => {
    if (term.field === 'tree') return { field: 'ids', value: term.value, ids: DG.treeIds(cards, term.value, ctx) };
    if (term.field === 'path') return { field: 'ids', value: term.value, ids: DG.pathIds(cards, term.value, ctx) };
    return term;
  });
}

// Convenience: empty terms means "no active query" — everything matches. `ctx`
// is the nesting context ({ board }), which tree:/path: need to read a parent
// written as this board's own name.
function filterCards(cards, terms, ctx) {
  if (!terms.length) return cards;
  const resolved = resolveGraphTerms(cards, terms, ctx);
  return cards.filter((card) => cardMatchesQuery(card, resolved));
}

// The search box's autocomplete dropdown. Pure candidate
// generation — no DOM, mirrors every other module here. Only the LAST
// whitespace-separated segment of the query is ever completed (the terms
// before it are query grammar the parser already accepted; re-suggesting
// scopes for them would be noise), same "complete what's currently being
// typed" contract as combobox.js's tagMode, just space- instead of
// comma-delimited.
//
// Given that segment, offers the bare term plus every KNOWN_FIELDS scoped
// form (title:/body:/status:/priority:/tags:/file:/assignee: — literally
// "the grammar", so a future new scope shows up here for free with no
// second list to maintain). tree:/path: are excluded: they take a numeric
// card id, not free text, so completing e.g. "tree:@afk" would never match
// anything.
//
// No suggestions (empty array, dropdown stays closed) when:
// - the segment is empty (nothing typed yet, or trailing whitespace —
//   same "not-yet-a-term" contract parseTerm uses for a bare "status:")
// - the segment already carries a recognized OR unrecognized `foo:` prefix
//   (a colon anywhere in it) — it's already scoped, or already a bare
//   fallback term; re-offering scopes on top of that reads as broken, not
//   helpful
//
// `value` is the FULL replacement text for the input (prior terms preserved
// verbatim, segment replaced) — so picking a suggestion is a plain whole-
// value swap, no special-cased "insert at cursor" logic needed. `label` is
// just the new term, undecorated by the terms before it, so the menu reads
// as "here's what this word could become" rather than repeating the whole
// query back on every row.
function searchSuggestionItems(raw) {
  const text = String(raw || '');
  if (/\s$/.test(text)) return []; // trailing space: no segment is being typed right now
  const parts = text.split(/\s+/).filter(Boolean);
  const segment = parts.pop() || '';
  if (!segment || segment.includes(':')) return [];
  const prefix = parts.length ? `${parts.join(' ')} ` : '';
  const items = [{ value: prefix + segment, label: segment }];
  KNOWN_FIELDS.forEach((field) => {
    const label = `${field}:${segment}`;
    items.push({ value: prefix + label, label });
  });
  return items;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseSearchQuery, cardMatchesQuery, filterCards, searchSuggestionItems };
} else {
  window.parseSearchQuery = parseSearchQuery;
  window.cardMatchesQuery = cardMatchesQuery;
  window.filterCards = filterCards;
  window.searchSuggestionItems = searchSuggestionItems;
}
