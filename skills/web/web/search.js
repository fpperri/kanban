'use strict';
// Pure query parser + matcher for the board search box. No DOM here —
// same dual-environment pattern as refresh-policy.js/column-state.js: loaded as a
// plain <script> in the browser (app.js calls these as bare globals) AND required
// directly by node --test.
//
// Syntax (space-separated terms AND together; each prefix binds to its own term).
// Grammar around the terms, lexed by lexSearch and parsed by parseSearchAlts:
//   a | b         or: `|` binds looser than a space, so `tags:ui status:doing | #12`
//                 is (ui and doing) or card 12. The parse of an or is one term,
//                 { field: 'or', alts: [[term, ...], ...] }; a query with no or
//                 is the same flat list of terms as before. An empty alternative
//                 (a trailing `|`, `a | status:`) is dropped, never every card.
//   ( a | b )     round brackets group and nest. A bracket holding no or is spliced
//                 into the terms around it, so `(draft)` parses as `draft`.
//   "two words"   quotes: with no scope a phrase, matched like bare text; after a
//                 scope (`tags:"grill"`) the whole value, ignoring case, or any one
//                 element of a list, and for title:/body: the whole field. A scoped
//                 quoted term carries `exact: true`.
//   waiting:      bare only: the card waits for at least one card that is not done.
//                 A value (`waiting:3`) is literal text.
// `|` counts only as a token of its own and brackets only at a token's edge, so
// `a|b` and `fix(auth)` stay literal; a quote opens only at the start of a token
// or after a scope's colon. Nothing here throws on half-typed input: an unclosed
// quote or bracket reads to the end, a stray closing bracket is ignored.
// searchAddTerm/searchRemoveTerm/searchBracket/searchTermText are the term
// interface for code that writes the box.
//
// The terms:
//   #42 / id:42   exact card id; `<board name>#42` (this board, any case) is the same
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
// card) pair doesn't have — see resolveTerms below for where that happens.
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

// The scope a prefix names, or null when it names none. Only these scopes open
// a quote after their colon; `foo:"bar baz"` with an unknown prefix is text.
function searchScope(prefix) {
  const low = prefix.toLowerCase();
  const key = FIELD_ALIASES[low] || low;
  return key === 'id' || KNOWN_FIELDS.includes(key) || GRAPH_FIELDS.includes(key) || STICKER_FIELDS.includes(key) ? key : null;
}

// A quoted token: `"two words"` or `title:"two words"`, closed or still open
// at the end of the input. Whitespace inside collapses to one space. A quoted
// scoped value is an exact one (`exact`: the whole value, or any one element of
// a list); id:, tree: and path: take the value as they would unquoted; quoted
// text with no scope is a phrase, matched like bare text. Nothing inside the
// quotes is a term yet: `tags:""` is dropped, like `tags:`.
function parseQuotedTerm(scope, rest) {
  const inner = (rest.endsWith('"') ? rest.slice(0, -1) : rest).replace(/\s+/g, ' ').trim();
  if (!inner) return null;
  if (!scope) return { field: null, value: inner.toLowerCase() };
  if (scope === 'id') return { field: 'id', value: inner };
  if (GRAPH_FIELDS.includes(scope)) return { field: scope, value: inner.replace(/^#/, '') };
  return { field: scope, value: inner.toLowerCase(), exact: true };
}

function parseTerm(token, board) {
  const quoted = /^(?:([A-Za-z]+):)?"([\s\S]*)$/.exec(token);
  if (quoted) {
    const scope = quoted[1] ? searchScope(quoted[1]) : null;
    if (!quoted[1] || scope) return parseQuotedTerm(scope, quoted[2]);
  }

  const idShorthand = token.match(/^#(\d+)$/);
  if (idShorthand) return { field: 'id', value: idShorthand[1] };

  // `<this board's name>#<id>` is how cards are named in chat; pasted, it
  // finds the card like `#<id>`. Split at the LAST '#': board names may hold dots and hyphens.
  const hash = token.lastIndexOf('#');
  if (board && hash > 0 && /^\d+$/.test(token.slice(hash + 1))
    && token.slice(0, hash).toLowerCase() === String(board).toLowerCase()) {
    return { field: 'id', value: token.slice(hash + 1) };
  }

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
    // waiting: is a complete term of its own, like review:/blocked:, and takes
    // no value: `waiting:3` falls through to bare text below.
    if (key === 'waiting' && !prefixed[2]) return { field: 'waiting', value: '' };
    // ADR 0009: bare review:/blocked: is itself a complete "sticker present"
    // term — always returned, even with an empty value (never dropped).
    if (STICKER_FIELDS.includes(key)) {
      return { field: key, value: prefixed[2].trim().toLowerCase() };
    }
  }

  return { field: null, value: token.toLowerCase() };
}

// How many of a chunk's trailing ) close a group. A ) that closes a ( inside
// the same chunk is part of the text, which keeps fix(auth) literal.
function searchClosers(body) {
  let run = 0;
  while (run < body.length && body[body.length - 1 - run] === ')') run++;
  if (!run) return 0;
  const before = body.slice(0, body.length - run);
  const opened = before.split('(').length - before.split(')').length;
  return run - Math.min(run, Math.max(0, opened));
}

// Where a quote opens in the chunk starting at `start`: the chunk's first
// character, or the character after a recognized scope's colon. -1 for none.
function searchQuoteAt(s, start) {
  if (s[start] === '"') return start;
  const scoped = /([A-Za-z]+):"/y;
  scoped.lastIndex = start;
  const m = scoped.exec(s);
  return m && searchScope(m[1]) ? start + m[0].length - 1 : -1;
}

// The lexer: the query as tokens with their place in the text. A token is
// `text` (one term as typed), `or` (a lone |), `open` (a ( at the front of a
// chunk) or `close` (a ) at the back). Brackets and | count only at a token's
// edge, so a|b stays one text token.
function lexSearch(raw) {
  const s = String(raw == null ? '' : raw);
  const tokens = [];
  const close = (at) => tokens.push({ kind: 'close', start: at, end: at + 1 });
  let at = 0;
  while (at < s.length) {
    if (/\s/.test(s[at])) { at++; continue; }
    while (s[at] === '(') tokens.push({ kind: 'open', start: at, end: ++at });
    if (at >= s.length || /\s/.test(s[at])) continue;
    const start = at;
    const quote = searchQuoteAt(s, start);
    if (quote >= 0) {
      // A quote runs to the next quote, or to the end of the input when unclosed.
      const shut = s.indexOf('"', quote + 1);
      at = shut < 0 ? s.length : shut + 1;
      tokens.push({ kind: 'text', start, end: at });
      while (s[at] === ')') close(at++);
      continue;
    }
    let end = start;
    while (end < s.length && !/\s/.test(s[end])) end++;
    const bodyEnd = end - searchClosers(s.slice(start, end));
    if (bodyEnd > start) tokens.push({ kind: s.slice(start, bodyEnd) === '|' ? 'or' : 'text', start, end: bodyEnd });
    for (at = bodyEnd; at < end; at++) close(at);
  }
  return { text: s, tokens };
}

// The parser: tokens to alternatives, each a list of items (a text token, or
// { group } holding the alternatives inside a bracket). An unclosed bracket
// reads to the end of the input; a closing bracket with no bracket open is
// ignored.
function parseSearchAlts(tokens) {
  let at = 0;
  const read = (depth) => {
    const alts = [[]];
    while (at < tokens.length) {
      const token = tokens[at++];
      if (token.kind === 'or') alts.push([]);
      else if (token.kind === 'open') alts[alts.length - 1].push({ group: read(depth + 1) });
      else if (token.kind === 'close') { if (depth > 0) return alts; }
      else alts[alts.length - 1].push(token);
    }
    return alts;
  };
  return read(0);
}

// Alternatives to terms: an empty alternative (no items, or only not-yet-terms)
// is dropped, since an all-of-nothing check is true and it would match every
// card while someone types. One alternative left is the flat term list, and a
// bracket holding one is spliced into the list around it; two or more are one
// `or` term holding them.
function searchAltsToTerms(alts, text, board) {
  const lists = alts
    .map((alt) => alt.flatMap((item) => (item.group
      ? searchAltsToTerms(item.group, text, board)
      : [parseTerm(text.slice(item.start, item.end), board)].filter(Boolean))))
    .filter((list) => list.length);
  if (lists.length <= 1) return lists[0] || [];
  return [{ field: 'or', alts: lists }];
}

function parseSearchQuery(raw, board) {
  const lexed = lexSearch(raw);
  return searchAltsToTerms(parseSearchAlts(lexed.tokens), lexed.text, board);
}

// Runs of whitespace as one space, so a phrase or a whole title or body reads
// the same across a line break.
function searchFlat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// A scoped term's test on one field's text: a substring, or with `exact` (a
// quoted value) the whole text, in either case ignoring letter case.
function searchFieldHit(text, term) {
  const low = String(text || '').toLowerCase();
  return term.exact ? searchFlat(low) === term.value : low.includes(term.value);
}

// --- The term interface. Code that writes to the box (a cue click, and later a
// pill, a slice or isolate) edits the text through these, never by joining
// strings: `|` binds looser than a space, so a term appended to `a | b` would
// bind to b only. Each returns the new text, and the text it was handed when
// nothing changed, so a caller can tell a no-op by comparing.

// One item of the parse as text: a term as it was typed, or a bracket rebuilt
// around what is left in it (nothing, when it is empty).
function searchItemText(item, text) {
  if (!item.group) return text.slice(item.start, item.end);
  const inner = searchRenderAlts(item.group, text);
  return inner ? `(${inner})` : '';
}

function searchRenderAlts(alts, text) {
  return alts
    .map((alt) => alt.map((item) => searchItemText(item, text)).filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' | ');
}

// A term as it is written in the box. A value holding spaces is quoted so it
// stays one term (which makes a scoped value an exact one); a quote inside a
// value cannot be written, so it is left out. Bare text that would read as a
// bracket or a bar is quoted too.
function searchTermText(field, value) {
  const v = String(value == null ? '' : value).replace(/"/g, '').replace(/\s+/g, ' ').trim();
  const quote = /\s/.test(v) || (!field && /^\(|\)$|^\|$/.test(v));
  const written = quote ? `"${v}"` : v;
  return field ? `${field}:${written}` : written;
}

function searchTermString(term) {
  return typeof term === 'string' ? term.trim() : searchTermText(term.field, term.value);
}

// Adds `term` (text, or { field, value }) to every alternative of the query. An
// alternative that already holds it keeps it once; an empty alternative is
// dropped, not given a lone term.
function searchAddTerm(raw, term) {
  const text = String(raw == null ? '' : raw);
  const add = searchTermString(term);
  if (!add) return text;
  const alts = parseSearchAlts(lexSearch(text).tokens).filter((alt) => alt.length);
  if (!alts.length) return add;
  let changed = false;
  const written = alts.map((alt) => {
    const parts = alt.map((item) => searchItemText(item, text)).filter(Boolean);
    if (!parts.includes(add)) { parts.push(add); changed = true; }
    return parts.join(' ');
  });
  return changed ? written.join(' | ') : text;
}

// Removes `term` wherever it stands, inside brackets too, and drops a bracket
// or an alternative that is left empty.
function searchRemoveTerm(raw, term) {
  const text = String(raw == null ? '' : raw);
  const drop = searchTermString(term);
  if (!drop) return text;
  let removed = false;
  const strip = (alts) => alts.map((alt) => alt.flatMap((item) => {
    if (item.group) return [{ group: strip(item.group) }];
    if (text.slice(item.start, item.end) !== drop) return [item];
    removed = true;
    return [];
  }));
  const left = strip(parseSearchAlts(lexSearch(text).tokens));
  return removed ? searchRenderAlts(left, text) : text;
}

// Wraps a query that holds more than one term, or a |, in round brackets, so it
// can stand as one term of a longer query. One term (a quoted value with spaces
// is one), an empty query and a query that is already one bracket come back as
// they are, trimmed.
function searchBracket(raw) {
  const text = String(raw == null ? '' : raw).trim();
  const alts = parseSearchAlts(lexSearch(text).tokens);
  return alts.length === 1 && alts[0].length <= 1 ? text : `(${text})`;
}

function termMatchesCard(term, card) {
  const title = (card.title || '').toLowerCase();
  const body = (card.body || '').toLowerCase();
  const tags = card.tags || [];
  switch (term.field) {
    case 'id': return String(card.id) === term.value;
    case 'title': return searchFieldHit(title, term);
    case 'body': return searchFieldHit(body, term);
    case 'status': return searchFieldHit(card.status, term);
    case 'priority': return searchFieldHit(card.priority, term);
    case 'tags': return tags.some((t) => searchFieldHit(t, term));
    case 'file': return searchFieldHit(card.file, term);
    case 'assignee': return searchFieldHit(card.assignee, term);
    case 'type': return searchFieldHit(card.type, term);
    // ADR 0009: bare (no value) = the shared presence predicate; a value =
    // case-insensitive substring on the sticker's own text (never the raw
    // field — a bare `true` sticker's text is '', which no non-empty
    // substring term matches, exactly mirroring the pill's own label).
    case 'review': return term.value ? searchFieldHit(WBS.reviewReason(card.review), term) : WBS.isReviewValue(card.review);
    case 'blocked': return term.value ? searchFieldHit(WBS.blockedReason(card.blocked), term) : WBS.isBlockedValue(card.blocked);
    // pre-resolved by filterCards (below) into an id Set — a raw,
    // unresolved 'tree'/'path'/'waiting' term has no graph to resolve against
    // here (a single (term, card) pair isn't enough), so it matches nothing
    // rather than throwing. Always goes through filterCards in practice.
    case 'tree': case 'path': case 'waiting': return false;
    case 'ids': return term.ids.has(Number(card.id));
    case 'or': return term.alts.some((alt) => alt.length > 0 && alt.every((t) => termMatchesCard(t, card)));
    default: { // bare term: title + body + tags; a phrase reads across a line break
      const flat = term.value.includes(' ') ? searchFlat : (text) => text;
      return flat(title).includes(term.value) || flat(body).includes(term.value)
        || tags.some((t) => flat(t.toLowerCase()).includes(term.value));
    }
  }
}

function cardMatchesQuery(card, terms) {
  return terms.every((term) => termMatchesCard(term, card));
}

// tree:/path: terms need the FULL card graph to resolve (connected
// component / directed cone), not just the one card being tested — so they're
// resolved ONCE here, up front, against `cards` (the same array filterCards
// was called with). Each 'tree'/'path' term becomes an 'ids' term (an
// already-resolved Set) before the per-card cardMatchesQuery pass runs, so
// termMatchesCard's 'ids' case stays a pure, cheap Set.has() with no graph
// access of its own.
//
// resolveTerms is that one pass, and it is recursive: an or term carries
// `alts`, arrays of terms, and each array resolves by the same call. `waiting:`
// resolves here, and `slice:` will too.
//
// The context says where the graph comes from. By default it is
// dependency-graph.js's treeIds/pathIds — which in turn build their adjacency
// from buildDependencyGraph(cards, null).edges, the exact edge set
// (waiting_for + parent edges) the map's graph is built from (parent edges
// shape layout but draw no line). A context with `graph: { treeIds, pathIds }`
// hands in its own functions instead, each called as (cards, id, ctx), so the
// snapshot can resolve over the graph it already holds.
//
// Contract note: `cards` here doubles as "the cards to filter down" AND (only
// when a tree:/path: term is present) "the universe to build the graph from".
// Every filterCards call site MUST pass the full board (active + archived),
// never a pre-filtered subset — traversal is always over live + archived
// cards, by design. A subset would silently produce a
// wrong/smaller graph with no error.
//
// waiting: resolves here too, over the same whole board: the ids of the cards
// waiting for at least one card that is not done (waiting-blocked.js's
// unresolvedWaits, so a dangling id never makes a card waiting). `memo` is the
// recursion's own, so the board is walked once however many groups hold it.
function resolveTerms(cards, terms, ctx, memo = {}) {
  const graph = (ctx && ctx.graph) || DG;
  let changed = false;
  const resolved = terms.map((term) => {
    let next = term;
    if (term.field === 'tree') next = { field: 'ids', value: term.value, ids: graph.treeIds(cards, term.value, ctx) };
    else if (term.field === 'path') next = { field: 'ids', value: term.value, ids: graph.pathIds(cards, term.value, ctx) };
    else if (term.field === 'waiting') {
      if (!memo.waiting) {
        const byId = new Map(cards.map((c) => [c.id, c]));
        memo.waiting = new Set(cards.filter((c) => WBS.unresolvedWaits(c.waiting_for, byId).length > 0).map((c) => Number(c.id)));
      }
      next = { field: 'ids', value: term.value, ids: memo.waiting };
    } else if (Array.isArray(term.alts)) {
      const alts = term.alts.map((alt) => resolveTerms(cards, alt, ctx, memo));
      if (alts.some((alt, i) => alt !== term.alts[i])) next = Object.assign({}, term, { alts });
    }
    if (next !== term) changed = true;
    return next;
  });
  return changed ? resolved : terms;
}

// Convenience: empty terms means "no active query" — everything matches. `ctx`
// is the nesting context ({ board }), which tree:/path: need to read a parent
// written as this board's own name.
function filterCards(cards, terms, ctx) {
  if (!terms.length) return cards;
  const resolved = resolveTerms(cards, terms, ctx);
  return cards.filter((card) => cardMatchesQuery(card, resolved));
}

// The search box's autocomplete dropdown. Pure candidate
// generation — no DOM, mirrors every other module here. Only the token under
// the caret (the end of the text when no caret is given) is ever completed:
// the terms around it are query grammar the parser already accepted, and
// re-suggesting scopes for them would be noise. The lexer finds the token, so
// one typed after an open bracket, after a `|` or inside an open quote is
// completed as it stands, bracket, bar or quote left where it is. Same
// "complete what's currently being typed" contract as combobox.js's tagMode,
// just space- instead of comma-delimited.
//
// Given that segment, offers the bare term plus every KNOWN_FIELDS scoped
// form (title:/body:/status:/priority:/tags:/file:/assignee: — literally
// "the grammar", so a future new scope shows up here for free with no
// second list to maintain). tree:/path: are excluded: they take a numeric
// card id, not free text, so completing e.g. "tree:@afk" would never match
// anything.
//
// No suggestions (empty array, dropdown stays closed) when:
// - no token is being typed (nothing typed yet, trailing whitespace, or the
//   caret is on a bracket or a `|` — same "not-yet-a-term" contract parseTerm
//   uses for a bare "status:")
// - the segment already carries a recognized OR unrecognized `foo:` prefix
//   (a colon anywhere in it) — it's already scoped, or already a bare
//   fallback term; re-offering scopes on top of that reads as broken, not
//   helpful
//
// `value` is the FULL replacement text for the input (the text before and
// after the token preserved verbatim, the token replaced) — so picking a
// suggestion is a plain whole-value swap, no special-cased "insert at cursor"
// logic needed. `label` is just the new term, undecorated by the text around
// it, so the menu reads as "here's what this word could become" rather than
// repeating the whole query back on every row.
function searchSuggestionItems(raw, caret) {
  const text = String(raw || '');
  const at = Number.isInteger(caret) ? Math.max(0, Math.min(caret, text.length)) : text.length;
  // The token being typed is the text token the caret sits in or at the end of.
  // A bracket, a | or a space is not one, so none of them is completed.
  const token = lexSearch(text).tokens.find((t) => t.kind === 'text' && t.start < at && at <= t.end);
  if (!token) return [];
  const segment = text.slice(token.start, token.end);
  if (segment.includes(':') || segment === '"') return [];
  const before = text.slice(0, token.start);
  const after = text.slice(token.end);
  const items = [{ value: before + segment + after, label: segment }];
  KNOWN_FIELDS.forEach((field) => {
    const label = `${field}:${segment}`;
    items.push({ value: before + label + after, label });
  });
  return items;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseSearchQuery, cardMatchesQuery, filterCards, resolveTerms, searchSuggestionItems,
    searchTermText, searchAddTerm, searchRemoveTerm, searchBracket,
  };
} else {
  window.parseSearchQuery = parseSearchQuery;
  window.cardMatchesQuery = cardMatchesQuery;
  window.filterCards = filterCards;
  window.resolveTerms = resolveTerms;
  window.searchSuggestionItems = searchSuggestionItems;
  window.searchTermText = searchTermText;
  window.searchAddTerm = searchAddTerm;
  window.searchRemoveTerm = searchRemoveTerm;
  window.searchBracket = searchBracket;
}
