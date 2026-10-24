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
//                 is a flat list of terms. An empty alternative
//                 (a trailing `|`, `a | status:`) is dropped, never every card.
//   ( a | b )     round brackets group and nest. A bracket holding no or is spliced
//                 into the terms around it, so `(draft)` parses as `draft`.
//   "two words"   quotes: with no scope a phrase, matched like bare text; after a
//                 scope (`tags:"grill"`) the whole value, ignoring case, or any one
//                 element of a list, and for title:/body: the whole field. A scoped
//                 quoted term carries `exact: true`.
//   waiting:      bare only: the card waits for at least one card that is not done.
//                 A value (`waiting:3`) is literal text.
// `|` and brackets count only at a token's edge, so `a|b` and `fix(auth)` stay
// literal while `a |b` means `a | b`; a quote opens only at the start of a token
// or after a scope's colon. Nothing here throws on half-typed input: an unclosed
// quote or bracket reads to the end, a stray closing bracket is ignored.
// searchAddTerm/searchBracket/searchTermText are the term
// interface for code that writes the box; searchHasAlt/searchAddAlt/searchRemoveAlt
// are its other half, for a query that joins the box as one more alternative, and
// searchSetSlice is its third, for the run of slices the slice section writes (it reads the
// run off the parse: the top-level terms with the field slice).
//
// The terms:
//   #42 / id:42   exact card id; `<board name>#42` (this board, any case) is the same;
//                 another board's `fpp#42` is searched as text, and the search panel says which
//                 board holds the card (searchOtherBoardMentions)
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
//   hpath:74 / htree:74 / dpath:74 / dtree:74   (`#` optional) the four sets Explore writes into
//                 the search box for card #74, each by one relation alone, where tree: and path: walk both.
//                 hpath: is the hierarchy path: its parents up to the root and every card
//                 nested under it. htree: is the whole parent tree from its root down.
//                 Both follow `parent` only. dpath: is everything it waits for and
//                 everything waiting on it, transitively; dtree: is its connected set.
//                 Both follow `waiting_for` only. Archived cards are walked as tree: walks
//                 them, an unknown id matches nothing.
//   dlinks:74 / hlinks:74   (`#` optional) card #74's direct neighbours, one hop and no further. dlinks: is the
//                 card, what it waits for and what waits on it; hlinks: is the card, its parent and its
//                 children. Each follows one relation alone, and treats a missing or
//                 other-board parent, a self-link and an archived card as the four sets above do.
//   slice:objective..2   the cards in a run of slices: the slices module's axis, the
//                 tiers of the board's hierarchy top first, then the depths of the cards
//                 with no tier. An end is a tier name (any letter case) or a depth
//                 number; `slice:goal` is that one slice, `slice:goal..` and
//                 `slice:..goal` leave an end open, an end the axis does not have is
//                 open too, and a reversed pair is swapped. A single unknown name,
//                 `slice:..` and a name half typed cut nothing, so typing never hides
//                 every card; a bare `slice:` is dropped like `status:`.
//   group:I2 / group:zephyr-2   the cards a group lists (docs/adr/0015), found by the group's
//                 id or its name in any letter case (`#` optional). Like review:/blocked:, a
//                 bare `group:` is a complete term: every card that is in any group. A leading
//                 hyphen negates it: `-group:` the cards in no group, `-group:I2` the cards that
//                 group does not list. The groups come in with the query's context (`ctx.groups`,
//                 each { id, name, cards }); a page that gives none finds no group, so every card
//                 is ungrouped there.
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
// The four Explore sets are explore-sets.js's, named by its list of kinds.
const EXS = (typeof module !== 'undefined' && module.exports) ? require('./explore-sets') : window;
// Named WBS (not WB) — dependency-graph.js already claims WB in this shared
// page scope (every web/*.js top-level name must be unique).
const WBS = (typeof module !== 'undefined' && module.exports) ? require('./waiting-blocked') : window;
// slice: reads the slices module and the nesting module; named SLM and NSM so no
// two page scripts claim one name.
const SLM = (typeof module !== 'undefined' && module.exports) ? require('./slices') : window;
const NSM = (typeof module !== 'undefined' && module.exports) ? require('./nesting') : window;
// Ids are read and compared through the id module (a card is `#7` or `#G7`, never a number).
const SEARCH_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

// The key of a card in an id set: its whole-id string. A value that is no id (the
// snapshot's queued cards are `n1`, `n2`) keys as its own text, so two of them never meet.
function searchKey(id) {
  const key = SEARCH_IDS.idKey(id);
  return key === null ? String(id) : key;
}

const KNOWN_FIELDS = ['title', 'body', 'status', 'priority', 'tags', 'file', 'assignee', 'type'];
// tree:/path:, the four Explore sets and the two links sets are deliberately NOT in KNOWN_FIELDS — that array
// drives the lowercased-substring value semantics, which don't apply to a card id. Each
// names the graph function that resolves it (resolveTerms).
const GRAPH_FIELDS = ['tree', 'path'].concat(EXS.EXPLORE_KINDS, EXS.LINK_KINDS);
const graphFunctionName = (field) => `${field}Ids`;
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
  return key === 'id' || key === 'slice' || key === 'group' || KNOWN_FIELDS.includes(key) || GRAPH_FIELDS.includes(key) || STICKER_FIELDS.includes(key) ? key : null;
}

// A quoted token: `"two words"` or `title:"two words"`, closed or still open
// at the end of the input. Whitespace inside collapses to one space. A quoted
// scoped value is an exact one (`exact`: the whole value, or any one element of
// a list); id:, tree:, path: and slice: take the value as they would unquoted; quoted
// text with no scope is a phrase, matched like bare text. Nothing inside the
// quotes is a term yet: `tags:""` is dropped, like `tags:`.
function parseQuotedTerm(scope, rest) {
  const inner = (rest.endsWith('"') ? rest.slice(0, -1) : rest).replace(/\s+/g, ' ').trim();
  if (!inner) return null;
  if (!scope) return { field: null, value: inner.toLowerCase() };
  if (scope === 'id' || scope === 'slice') return { field: scope, value: inner };
  if (scope === 'group') return { field: 'group', value: inner.replace(/^#/, '') };
  if (GRAPH_FIELDS.includes(scope)) return { field: scope, value: inner.replace(/^#/, '') };
  return { field: scope, value: inner.toLowerCase(), exact: true };
}

function parseTerm(token, board) {
  const notGroup = /^-group:"([\s\S]*)$/i.exec(token);
  if (notGroup) {
    const term = parseQuotedTerm('group', notGroup[1]);
    return term && Object.assign(term, { not: true });
  }
  const quoted =/^(?:([A-Za-z]+):)?"([\s\S]*)$/.exec(token);
  if (quoted) {
    const scope = quoted[1] ? searchScope(quoted[1]) : null;
    if (!quoted[1] || scope) return parseQuotedTerm(scope, quoted[2]);
  }

  // `#7` and `#G7` are two cards: the id module reads the whole id, and `#a371f7` or
  // `# Heading` are no id.
  const idShorthand = token[0] === '#' ? SEARCH_IDS.idKey(token.slice(1)) : null;
  if (idShorthand !== null) return { field: 'id', value: idShorthand };

  // `<this board's name>#<id>` is how cards are named in chat; pasted, it
  // finds the card like `#<id>`. Split at the LAST '#': board names may hold dots and hyphens.
  const hash = token.lastIndexOf('#');
  const boardId = board && hash > 0 ? SEARCH_IDS.idKey(token.slice(hash + 1)) : null;
  if (boardId !== null && token.slice(0, hash).toLowerCase() === String(board).toLowerCase()) {
    return { field: 'id', value: boardId };
  }

  // group: and its negation are one complete term each, a bare one included (every card in a group, or in none).
  const group = /^(-?)group:(.*)$/i.exec(token);
  if (group) {
    const term = { field: 'group', value: group[2].trim().replace(/^#/, '') };
    return group[1] ? Object.assign(term, { not: true }) : term;
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
    if (key === 'slice') {
      const value = prefixed[2].trim();
      return value ? { field: 'slice', value } : null;
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
  const scoped = /(-?)([A-Za-z]+):"/y;
  scoped.lastIndex = start;
  const m = scoped.exec(s);
  return m && searchScope(m[2]) && (m[1] === '' || m[2].toLowerCase() === 'group') ? start + m[0].length - 1 : -1;
}

// The lexer: the query as tokens with their place in the text. A token is
// `text` (one term as typed), `or` (a | at the front or the back of a chunk, or
// a chunk of nothing else), `open` (a ( at the front of a chunk) or `close` (a )
// at the back). Brackets and | count only at a token's edge, so a|b and
// fix(auth) stay one text token, while `a |b` and `(a| b)` mean what `a | b` does.
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
      tokens.push({ kind: 'text', start, end: at, open: shut < 0 });
      while (s[at] === ')') close(at++);
      continue;
    }
    let end = start;
    while (end < s.length && !/\s/.test(s[end])) end++;
    const bodyEnd = end - searchClosers(s.slice(start, end));
    const or = (i) => tokens.push({ kind: 'or', start: i, end: i + 1 });
    let from = start;
    while (from < bodyEnd && s[from] === '|') or(from++);
    let to = bodyEnd;
    while (to > from && s[to - 1] === '|') to--;
    if (to > from) tokens.push({ kind: 'text', start: from, end: to });
    for (let i = to; i < bodyEnd; i++) or(i);
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

// The cards the box names on other boards: one { board, id } per bare text token that the id
// module reads whole as a mention `<name>#<id>` (the name as typed) whose name is not this
// board's, the same card named twice (any case in the name) once. Quoted text, scoped terms,
// a `#id` with no name and what the id module does not read as a mention (a URL fragment, a
// hex colour) are no mention.
function searchOtherBoardMentions(raw, board) {
  const lexed = lexSearch(raw);
  const found = [];
  const seen = new Set();
  for (const token of lexed.tokens) {
    if (token.kind !== 'text') continue;
    const m = SEARCH_IDS.parseMention(lexed.text.slice(token.start, token.end));
    if (!m || !m.board || (board && m.board.toLowerCase() === String(board).toLowerCase())) continue;
    const id = `${m.prefix}${m.number}`;
    const key = `${m.board.toLowerCase()}#${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ board: m.board, id });
  }
  return found;
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

// --- The term interface. Code that writes to the box (a cue click, a pill, a slice
// or isolate) edits the text through these, never by joining
// strings: `|` binds looser than a space, so a term appended to `a | b` would
// bind to b only. Each returns the new text, and the text it was handed when
// nothing changed, so a caller can tell a no-op by comparing.

// One item of the parse as text: a term as it was typed, or a bracket rebuilt
// around what is left in it (nothing, when it is empty). A quote still open is
// shut, so a term written after it is not read as part of its text.
function searchItemText(item, text) {
  if (!item.group) return text.slice(item.start, item.end) + (item.open ? '"' : '');
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
// bracket or a bar is quoted too, and so is a scoped value with a bar at its back, which
// the lexer would read as the bar between two alternatives (a scope shields the front
// of its value). With `exact` a scoped value is always quoted,
// so it matches the whole value, or any one element of a list (`tags:"grill"`,
// which never catches `grilling`); bare text has no scope to be exact in.
function searchTermText(field, value, exact = false) {
  const v = String(value == null ? '' : value).replace(/"/g, '').replace(/\s+/g, ' ').trim();
  const bar = field ? /\|$/ : /^\||\|$/;
  const quote = /\s/.test(v) || (!field && /^\(|\)$/.test(v)) || bar.test(v) || (!!field && exact === true && v !== '');
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

// Wraps a query that holds more than one term, or a |, in round brackets, so it
// can stand as one term of a longer query. One term (a quoted value with spaces
// is one), an empty query and a query that is already one bracket come back as
// they are, trimmed.
function searchBracket(raw) {
  const text = String(raw == null ? '' : raw).trim();
  const alts = parseSearchAlts(lexSearch(text).tokens);
  return alts.length === 1 && alts[0].length <= 1 ? text : `(${text})`;
}

// --- The run of slices. The slice section writes its run as a slice: term at the top
// level of the query: one of the terms ANDed over the whole of it, as the parse reads
// them, which is the same term the Graph hides by (graphQueryEffect). A slice: term
// inside a bracket that holds a |, or in one alternative of a query that holds one, is
// the query's own and stays where it is. A run added to a query that holds | brackets
// that query, or it would cut only the last group. The run is not an alternative of the
// box: the alternatives below (the pills' side) set it apart and put it back.

// The alternatives of `alts` that hold at least one term: the parser drops the others.
function searchLiveAlts(alts, text) {
  return alts.filter((alt) => alt.some((item) => (item.group
    ? searchLiveAlts(item.group, text).length > 0
    : !!parseTerm(text.slice(item.start, item.end)))));
}

// The query split into its top-level slice: terms, as typed (a value still open in a
// quote is shut), and the rest of it. Where a query has two or more live alternatives
// nothing in it is at the top level. The rest is written as its alternatives, with an
// outer bracket opened ((a | b) slice:x leaves a | b); a query with no such term is its
// own rest, as it was typed.
function searchSplitSlice(raw) {
  const text = String(raw == null ? '' : raw);
  const slices = [];
  const strip = (alts) => {
    if (searchLiveAlts(alts, text).length > 1) return alts;
    return alts.map((alt) => alt.flatMap((item) => {
      if (item.group) return [{ group: strip(item.group) }];
      if (!/^slice:/i.test(text.slice(item.start, item.end))) return [item];
      slices.push(searchItemText(item, text));
      return [];
    }));
  };
  const left = strip(parseSearchAlts(lexSearch(text).tokens));
  if (!slices.length) return { rest: text, slices };
  return { rest: searchAltUnwrapped(searchRenderAlts(left, text)), slices };
}

// What searchSplitSlice set apart, put back: after the rest, bracketed when the rest
// has more than one alternative.
function searchJoinSlice(rest, slices) {
  const tail = slices.join(' ');
  if (!tail) return rest;
  const alts = searchAltTexts(rest);
  if (!alts.length) return tail;
  return `${alts.length > 1 ? `(${alts.join(' | ')})` : alts[0]} ${tail}`;
}

// What a gesture that clears the box leaves in it: the top-level slice: terms alone. A cut
// is a cut of the view and no search, so the typed query and the pills' alternatives go and
// the cut stays, as it does when a pill or Isolate rewrites the box.
function searchCutOnly(raw) {
  return searchJoinSlice('', searchSplitSlice(raw).slices);
}

// `slices` with one copy of each cut in `cuts` taken out, and no more. A pill whose own query is a
// cut writes it next to the one the box held when the two are the same cut, so the box holds two
// copies, and the pill going off takes out its copy: the one the box held stays.
function searchWithoutCuts(slices, cuts) {
  const left = slices.slice();
  for (const cut of cuts) {
    const at = left.indexOf(cut);
    if (at >= 0) left.splice(at, 1);
  }
  return left;
}

// The query with its top-level slice: terms replaced by one for `value` (the text after
// `slice:`), or by none when the value is empty. The rest of the query keeps its meaning,
// and a query with nothing to change comes back as it was.
function searchSetSlice(raw, value) {
  const text = String(raw == null ? '' : raw);
  const { rest, slices } = searchSplitSlice(text);
  const run = String(value == null ? '' : value).trim() ? [searchTermText('slice', value)] : [];
  if (!slices.length && !run.length) return text;
  return searchJoinSlice(rest, run);
}

// --- The alternatives of the box. A query joins the box as one more alternative
// (`review: | blocked:`) and leaves it the same way, whole, whatever else the
// box holds, since `|` binds loosest. An alternative that holds spaces is
// bracketed once the box holds more than one, so it reads as one unit; a
// bracket and what is inside it are one alternative; a query with a | of its
// own counts as its parts. A run of slices (above) is not one: it stays out of them and
// is put back where it was.

// The box as a list of its alternatives, each as text; the empty ones are left out.
function searchAltTexts(raw) {
  const text = String(raw == null ? '' : raw);
  return parseSearchAlts(lexSearch(text).tokens)
    .map((alt) => alt.map((item) => searchItemText(item, text)).filter(Boolean).join(' '))
    .filter(Boolean);
}

// An alternative with its one outer bracket opened, however deep: (a b) is a b.
function searchAltUnwrapped(altText) {
  const text = altText.trim();
  const alts = parseSearchAlts(lexSearch(text).tokens);
  if (alts.length === 1 && alts[0].length === 1 && alts[0][0].group) return searchAltUnwrapped(searchRenderAlts(alts[0][0].group, text));
  return text;
}

// What two alternatives are compared by: the text with its bracket opened and its spacing even.
function searchAltKey(altText) {
  return searchAltUnwrapped(altText).replace(/\s+/g, ' ');
}

// The text for a list of alternatives: one alone as it is, several each in its
// own bracket when it holds more than one term.
function searchAltsText(list) {
  return list.length === 1 ? searchAltUnwrapped(list[0]) : list.map(searchBracket).join(' | ');
}

// Whether the box holds every alternative of `term` (text, or { field, value }).
function searchHasAlt(raw, term) {
  const wanted = searchAltTexts(searchTermString(term)).map(searchAltKey);
  if (!wanted.length) return false;
  const have = new Set(searchAltTexts(searchSplitSlice(raw).rest).map(searchAltKey));
  return wanted.every((key) => have.has(key));
}

// Adds `term` to the box as one more alternative, after the ones it holds. An
// alternative the box already holds is not added twice; when none is new, or
// the term is empty, the text comes back as it was.
function searchAddAlt(raw, term) {
  const text = String(raw == null ? '' : raw);
  const { rest, slices } = searchSplitSlice(text);
  const have = searchAltTexts(rest);
  const keys = new Set(have.map(searchAltKey));
  const fresh = [];
  for (const alt of searchAltTexts(searchTermString(term))) {
    const key = searchAltKey(alt);
    if (keys.has(key)) continue;
    keys.add(key);
    fresh.push(alt);
  }
  return fresh.length ? searchJoinSlice(searchAltsText(have.concat(fresh)), slices) : text;
}

// The box after a pick writes `terms` (the text of one or more alternatives): they replace what the
// box held but for its run of slices, or with `add` join it as more alternatives (searchAddAlt), so an
// empty box takes them either way. Explore's Path and Tree and Space on a hovered card write this way.
function searchWithTerms(raw, terms, add) {
  const text = String(raw == null ? '' : raw);
  return add ? searchAddAlt(text, terms) : searchJoinSlice(terms, searchSplitSlice(text).slices);
}

// Takes `term` out of the box as the alternative it is, whatever else the box
// holds. Only a whole alternative goes: a term inside a longer one stays. What is
// left is written as it would have been before the term was added, and a text
// with nothing to take out comes back as it was.
function searchRemoveAlt(raw, term) {
  const text = String(raw == null ? '' : raw);
  const gone = new Set(searchAltTexts(searchTermString(term)).map(searchAltKey));
  if (!gone.size) return text;
  const { rest, slices } = searchSplitSlice(text);
  const have = searchAltTexts(rest);
  const left = have.filter((alt) => !gone.has(searchAltKey(alt)));
  return left.length === have.length ? text : searchJoinSlice(searchAltsText(left), slices);
}

// The terms of one alternative, in order, a bracket as one.
function searchAltTerms(altText) {
  const text = searchAltUnwrapped(altText);
  const alts = parseSearchAlts(lexSearch(text).tokens);
  return alts.length === 1 ? alts[0].map((item) => searchItemText(item, text)).filter(Boolean) : [];
}

// Takes `term` out of the box as searchRemoveAlt does, and with it every alternative it has
// grown into. A click on a cue adds its term to every alternative, so a pill's `review:` becomes
// `review: assignee:@human`: still the pill's alternative, which goes when the pill does, while
// text typed beside it (another alternative) stays. An alternative is the pill's grown one when it
// holds every term of the pill's, in whatever order; the pill's own terms are in the box only
// through the pill, since typing in the box turns it off. A run of slices stays, but for the cut a
// pill holds in its own query (a board pill `slice:goal`), which is the pill's and goes with it.
function searchRemoveGrownAlt(raw, term) {
  const text = String(raw == null ? '' : raw);
  const base = searchAltTexts(searchTermString(term)).map((alt) => {
    const own = searchSplitSlice(alt);
    return { key: searchAltKey(alt), terms: searchAltTerms(own.rest), cut: own.slices };
  });
  const { rest, slices } = searchSplitSlice(text);
  const have = searchAltTexts(rest);
  const left = have.filter((alt) => {
    const terms = searchAltTerms(alt);
    return !base.some((own) => own.key === searchAltKey(alt) || (own.terms.length && own.terms.every((t) => terms.includes(t))));
  });
  const cut = base.flatMap((own) => own.cut);
  const kept = searchWithoutCuts(slices, cut);
  return left.length === have.length && kept.length === slices.length ? text : searchJoinSlice(searchAltsText(left), kept);
}

// --- Isolate. Switching it on writes the selection into the box as `part | part | ...`
// (the isolate text), each part by its criterion rather than a frozen list of cards, so a
// card that comes to match a query part joins on the next poll, and the address carries it.
// A card is `#id`, a path `path:id`, a tree `tree:id`; a query is its own text, in brackets
// when it holds a | or spaces (a search typed in the box, `dpath:185` included, is a query) (searchBracket, so the grammar's token-edge rules apply). A
// query part that is not a term yet (`status:`) selects nothing, so it writes nothing: a
// lone half-typed term would otherwise isolate every card. A query part with a card taken
// out is already its other cards by then (selection.js selectionWithoutCard), so it is written as
// them. `parts` are the selection's parts, { kind: 'card' | 'path' | 'tree', id } or
// { kind: 'query', text }. What the text matches is what the selection resolves to over
// the whole board.

// A path or a tree: named whole by a card's id.
function searchIsNamedPart(part) {
  return !!part && (part.kind === 'path' || part.kind === 'tree');
}

function searchIsolatePartText(part) {
  if (!part) return '';
  if (part.kind === 'card') return `#${part.id}`;
  if (searchIsNamedPart(part)) return `${part.kind}:${part.id}`;
  if (part.kind !== 'query') return '';
  const text = String(part.text == null ? '' : part.text).trim();
  return parseSearchQuery(text).length ? searchBracket(text) : '';
}

function searchIsolateText(parts) {
  return (Array.isArray(parts) ? parts : []).map(searchIsolatePartText).filter(Boolean).join(' | ');
}

// The box as it reads once `text` is written to it: the run of slices the box held put back after
// it (searchSplitSlice, searchJoinSlice), but for one copy of each cut that `dropped`, the queries of
// pills the write takes off, held in their own text: a pill's cut goes with the pill, and a cut the
// box held before, if it is the same cut, stays (searchWithoutCuts). Isolate, a click's mirror and a
// pill's gesture all write the box this way, so the cut is kept in one place.
function searchBoxSaying(current, text, dropped) {
  const held = searchSplitSlice(current).slices;
  const slices = searchWithoutCuts(held, (dropped || []).flatMap((query) => searchSplitSlice(query).slices));
  return searchJoinSlice(text, slices);
}

// What the box holds while isolated: the isolate text, with the run of slices the box held
// put back after it. The cut stays in effect, because
// the selection only covers the cards the view shows and a card the cut hides is not in
// it. The rest of the previous text goes; the page remembers it. No part to write, no text.
// The rest needs no keeping: with isolate off the box hides nothing but by its cut, so the
// selection already holds every card, path and tree it names whole.
function searchIsolateBox(previous, parts) {
  const text = searchIsolateText(parts);
  return text ? searchBoxSaying(previous, text) : '';
}

// What the box holds when a click, or a step of Esc, has left the selection as `parts` and isolate is
// off: the isolate text of the parts, the box's run of slices kept (the cut is no selection). The
// box mirrors the selection, it does not become a query typed: a part that is one query is written
// as it was typed, in no bracket, so a step down to it leaves the box as the person wrote it; the
// slices a query part carries are the box's run already, so they are not written twice. `dropped`
// are the queries of the pills the click took off: a cut such a pill held in its own query goes with
// it, one copy only, as when the pill is turned off (searchWithoutCuts). Nothing selected leaves the
// cut alone.
function searchMirrorBox(current, parts, dropped) {
  const shown = (Array.isArray(parts) ? parts : []).map((part) => (part && part.kind === 'query' ? { ...part, text: searchSplitSlice(part.text).rest } : part));
  const lone = shown.length === 1 && shown[0].kind === 'query';
  return searchBoxSaying(current, lone ? String(shown[0].text).trim() : searchIsolateText(shown), dropped);
}

// Whether the box already says `parts` as searchMirrorBox would write them: the mirror of the
// selection needs no write.
function searchBoxMirrors(current, parts) {
  return current === searchMirrorBox(current, parts, []);
}

// Whether the box holds a query the person made, as against the picks a click mirrored into it:
// text beyond its run of slices that is not the isolate text of the picked cards, paths and trees.
// A query part of the selection (a pill's, or the one typed in the Graph) is the person's own, so
// it does not count as a pick here.
function searchBoxHoldsTyped(current, parts) {
  if (!searchSplitSlice(current).rest.trim()) return false;
  return !searchBoxMirrors(current, (Array.isArray(parts) ? parts : []).filter((part) => part && part.kind !== 'query'));
}

// What the box holds when isolate goes off: the text it held before, exactly as it was,
// except that the run of slices is the one the box holds now, since the slice section may
// have moved it while isolated and the cut is not part of what isolate takes away. A cut
// that did not move leaves the previous text untouched, as it was typed.
function searchIsolateRestore(current, previous) {
  const was = searchSplitSlice(previous);
  const now = searchSplitSlice(current).slices;
  if (now.join(' ') === was.slices.join(' ')) return String(previous == null ? '' : previous);
  return searchJoinSlice(was.rest, now);
}

function termMatchesCard(term, card) {
  const title = (card.title || '').toLowerCase();
  const body = (card.body || '').toLowerCase();
  const tags = card.tags || [];
  if (GRAPH_FIELDS.includes(term.field)) return false;
  switch (term.field) {
    case 'id': return searchKey(card.id) === searchKey(term.value);
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
    // unresolved graph term ('tree', 'path' and the four Explore sets), 'waiting' or 'slice' has no
    // graph to resolve against here (a single (term, card) pair isn't enough), so it matches
    // nothing rather than throwing. Always goes through filterCards in practice.
    case 'waiting': case 'slice': case 'group': return false;
    case 'ids': return term.ids.has(searchKey(card.id));
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
// was called with). Each 'tree'/'path'/'hpath'/'htree'/'dpath'/'dtree'/'dlinks'/'hlinks' term becomes an 'ids' term (an
// already-resolved Set) before the per-card cardMatchesQuery pass runs, so
// termMatchesCard's 'ids' case stays a pure, cheap Set.has() with no graph
// access of its own.
//
// resolveTerms is that one pass, and it is recursive: an or term carries
// `alts`, arrays of terms, and each array resolves by the same call. `waiting:`
// and `slice:` resolve here too. `slice:` reads the context's `hierarchy` (type
// names, top tier first) and the depths of the whole board, so a card is in the
// same slice whatever the rest of the query filters out.
//
// The context says where the graph comes from. By default it is
// dependency-graph.js's treeIds/pathIds — which in turn build their adjacency
// from buildDependencyGraph(cards, null).edges, the exact edge set
// (waiting_for + parent edges) the map's graph is built from (parent edges
// shape layout but draw no line). A context with `graph: { treeIds, pathIds, hpathIds,
// htreeIds, dpathIds, dtreeIds, dlinksIds, hlinksIds }` hands in its own functions instead, each called as
// (cards, id, ctx), so the snapshot can resolve over the graph it already holds; one it
// leaves out is the dependency graph's.
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
    if (GRAPH_FIELDS.includes(term.field)) {
      const name = graphFunctionName(term.field);
      next = { field: 'ids', value: term.value, ids: (graph[name] || (EXS.EXPLORE_KINDS.includes(term.field) || EXS.LINK_KINDS.includes(term.field) ? EXS : DG)[name])(cards, term.value, ctx) };
    } else if (term.field === 'slice') next = { field: 'ids', value: term.value, ids: sliceIds(cards, term.value, ctx, memo) };
    else if (term.field === 'group') next = { field: 'ids', value: term.value, ids: groupIds(cards, term, ctx) };
    else if (term.field === 'waiting') {
      if (!memo.waiting) {
        // Only a real card resolves a waiting_for entry: a queued card (`n1`) is not one.
        const byId = new Map(cards.filter((c) => SEARCH_IDS.idKey(c.id) !== null).map((c) => [SEARCH_IDS.idKey(c.id), c]));
        memo.waiting = new Set(cards.filter((c) => WBS.unresolvedWaits(c.waiting_for, byId).length > 0).map((c) => searchKey(c.id)));
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

// The ids a group: term allows. The groups it names are those of the context whose id or
// name is the value, ignoring case (a bare value names every group); the ids are the cards
// they list, or with a hyphen (`not`) every other card of the board.
function groupIds(cards, term, ctx) {
  const groups = (ctx && Array.isArray(ctx.groups)) ? ctx.groups : [];
  const want = term.value.toLowerCase();
  const named = want === '' ? groups : groups.filter((g) => String(g.id).toLowerCase() === want || String(g.name || '').toLowerCase() === want);
  const members = new Set(named.flatMap((g) => g.cards || []).map(searchKey));
  return term.not ? new Set(cards.map((c) => searchKey(c.id)).filter((id) => !members.has(id))) : members;
}

// The slices of the whole board, { axis, byId } (the slices module's), built once
// for a pass through `memo` when it is given. A cut and the suggestions the box
// offers for one read it alike, so they cannot disagree about what a slice is. null
// when the page has not loaded the slices and nesting modules.
function searchSlices(cards, ctx, memo) {
  if (typeof SLM.sliceCards !== 'function' || typeof SLM.sliceDepths !== 'function' || typeof NSM.depthMap !== 'function') return null;
  const build = () => SLM.sliceCards(cards, ctx && ctx.hierarchy, SLM.sliceDepths(cards, ctx && ctx.hierarchy, ctx));
  if (!memo) return build();
  if (!memo.slices) memo.slices = build();
  return memo.slices;
}

// Where an end of a cut sits on the axis (a tier by name, a depth by number),
// -1 when the axis has no such slice or the end is empty.
function sliceEndIndex(axis, text) {
  const key = text.trim().toLowerCase();
  const at = axis.find((s) => (s.kind === 'tier' ? s.key === key : String(s.depth) === key));
  return at ? at.index : -1;
}

// The ids in the run of slices a slice: value names. An end with no slice is open,
// so a value with neither end known is no cut. A page that has not loaded slices.js
// and nesting.js cuts nothing.
function sliceIds(cards, value, ctx, memo) {
  const slices = searchSlices(cards, ctx, memo);
  if (!slices) return new Set(cards.map((c) => searchKey(c.id)));
  const { axis, byId } = slices;
  const dots = value.indexOf('..');
  let from = sliceEndIndex(axis, dots < 0 ? value : value.slice(0, dots));
  let to = sliceEndIndex(axis, dots < 0 ? value : value.slice(dots + 2));
  if (from >= 0 && to >= 0 && from > to) [from, to] = [to, from];
  const first = from < 0 ? 0 : from;
  const last = to < 0 ? axis.length - 1 : to;
  return new Set(cards.filter((c) => { const at = byId.get(searchKey(c.id)).index; return at >= first && at <= last; }).map((c) => searchKey(c.id)));
}

// Convenience: empty terms means "no active query" — everything matches. `ctx`
// is the nesting context ({ board }), which tree:/path: need to read a parent
// written as this board's own name.
function filterCards(cards, terms, ctx) {
  if (!terms.length) return cards;
  const resolved = resolveTerms(cards, terms, ctx);
  return cards.filter((card) => cardMatchesQuery(card, resolved));
}

// The names a slice: term can be written with on this board: the slices of its axis,
// the tiers of its hierarchy in order, every one it names, then the depths from 0 to
// the deepest card with no tier. Each is an end the cut reads as it stands, so the box
// never offers an end that would be left open, and a caption's tip names one of them.
function searchSliceNames(cards, ctx) {
  const slices = Array.isArray(cards) ? searchSlices(cards, ctx, null) : null;
  if (!slices) return [];
  return slices.axis.map((s) => (s.kind === 'tier' ? s.name : String(s.depth)));
}

// The suggestions for a slice: token: after `slice:` and after `..`, the board's slice
// names that start with what is typed there, each written as the whole term it
// would complete. The caret says which end is being typed: before the dots (or with
// none) the first, after them the second, and the end under the caret is the one
// replaced, the other kept as it stands. A name with a space is written quoted, and
// the quote then holds both ends (`slice:"big goal..objective"`), the one form the
// parser reads a spaced name in. Nothing for a term already typed in full. `null`
// when the token is not a slice: one.
function searchSliceItems(text, token, at, namesOf) {
  const raw = text.slice(token.start, token.end);
  const scope = /^slice:/i.exec(raw);
  if (!scope) return null;
  const names = namesOf();
  const quoted = raw[scope[0].length] === '"';
  const from = token.start + scope[0].length + (quoted ? 1 : 0);
  const to = token.end - (quoted && !token.open ? 1 : 0);
  const body = text.slice(from, Math.max(from, to));
  const pos = Math.max(0, Math.min(at - from, body.length));
  const dots = body.indexOf('..');
  const second = dots >= 0 && pos >= dots + 2;
  const head = second ? body.slice(0, dots + 2) : '';
  const tail = !second && dots >= 0 ? body.slice(dots) : '';
  const typed = (second ? body.slice(dots + 2, pos) : body.slice(0, dots >= 0 ? Math.min(pos, dots) : pos)).trim().toLowerCase();
  const items = [];
  for (const name of names) {
    if (!name.toLowerCase().startsWith(typed)) continue;
    const label = searchTermText('slice', head + name + tail);
    if (label.toLowerCase() === raw.toLowerCase()) continue;
    items.push({ value: text.slice(0, token.start) + label + text.slice(token.end), label });
  }
  return items;
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
// A `slice:` token is the one scoped token that is completed: given the board's
// cards and context (the arguments filterCards takes) it offers the slice names
// after the colon and after `..` (searchSliceItems). Without them it offers none.
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
function searchSuggestionItems(raw, caret, cards, ctx) {
  const text = String(raw || '');
  const at = Number.isInteger(caret) ? Math.max(0, Math.min(caret, text.length)) : text.length;
  // The token being typed is the text token the caret sits in or at the end of.
  // A bracket, a | or a space is not one, so none of them is completed.
  const token = lexSearch(text).tokens.find((t) => t.kind === 'text' && t.start < at && at <= t.end);
  if (!token) return [];
  const slices = searchSliceItems(text, token, at, () => searchSliceNames(cards, ctx));
  if (slices) return slices;
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
    parseSearchQuery, searchOtherBoardMentions, cardMatchesQuery, filterCards, resolveTerms, searchSuggestionItems,
    searchTermText, searchAddTerm, searchBracket, searchHasAlt, searchAddAlt, searchWithTerms, searchRemoveAlt, searchRemoveGrownAlt,
    searchSplitSlice, searchJoinSlice, searchWithoutCuts, searchSetSlice, searchCutOnly,
    searchIsolateText, searchBoxSaying, searchIsolateBox, searchMirrorBox, searchBoxMirrors, searchBoxHoldsTyped, searchIsolateRestore,
  };
} else {
  window.parseSearchQuery = parseSearchQuery;
  window.searchOtherBoardMentions = searchOtherBoardMentions;
  window.cardMatchesQuery = cardMatchesQuery;
  window.filterCards = filterCards;
  window.resolveTerms = resolveTerms;
  window.searchSuggestionItems = searchSuggestionItems;
  window.searchTermText = searchTermText;
  window.searchAddTerm = searchAddTerm;
  window.searchBracket = searchBracket;
  window.searchHasAlt = searchHasAlt;
  window.searchAddAlt = searchAddAlt;
  window.searchWithTerms = searchWithTerms;
  window.searchRemoveAlt = searchRemoveAlt;
  window.searchRemoveGrownAlt = searchRemoveGrownAlt;
  window.searchSplitSlice = searchSplitSlice;
  window.searchJoinSlice = searchJoinSlice;
  window.searchWithoutCuts = searchWithoutCuts;
  window.searchSetSlice = searchSetSlice;
  window.searchCutOnly = searchCutOnly;
  window.searchIsolateText = searchIsolateText;
  window.searchBoxSaying = searchBoxSaying;
  window.searchIsolateBox = searchIsolateBox;
  window.searchMirrorBox = searchMirrorBox;
  window.searchBoxMirrors = searchBoxMirrors;
  window.searchBoxHoldsTyped = searchBoxHoldsTyped;
  window.searchIsolateRestore = searchIsolateRestore;
}
