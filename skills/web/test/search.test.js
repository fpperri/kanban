const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, cardMatchesQuery, filterCards, searchSuggestionItems } = require('../web/search');

// --- parseSearchQuery: the search syntax table ----------------------------

test('parseSearchQuery on empty/blank input yields no terms', () => {
  assert.deepStrictEqual(parseSearchQuery(''), []);
  assert.deepStrictEqual(parseSearchQuery('   '), []);
  assert.deepStrictEqual(parseSearchQuery(undefined), []);
  assert.deepStrictEqual(parseSearchQuery(null), []);
});

test('#42 shorthand parses as an exact id term', () => {
  assert.deepStrictEqual(parseSearchQuery('#42'), [{ field: 'id', value: '42' }]);
});

test('id:42 parses as an exact id term, same as #42', () => {
  assert.deepStrictEqual(parseSearchQuery('id:42'), [{ field: 'id', value: '42' }]);
});

test('title: / body: / status: / priority: / tags: / file: / assignee: parse as their own scoped term', () => {
  assert.deepStrictEqual(parseSearchQuery('title:foo'), [{ field: 'title', value: 'foo' }]);
  assert.deepStrictEqual(parseSearchQuery('body:foo'), [{ field: 'body', value: 'foo' }]);
  assert.deepStrictEqual(parseSearchQuery('status:doing'), [{ field: 'status', value: 'doing' }]);
  assert.deepStrictEqual(parseSearchQuery('priority:high'), [{ field: 'priority', value: 'high' }]);
  assert.deepStrictEqual(parseSearchQuery('tags:ui'), [{ field: 'tags', value: 'ui' }]);
  assert.deepStrictEqual(parseSearchQuery('file:0011'), [{ field: 'file', value: '0011' }]);
  assert.deepStrictEqual(parseSearchQuery('assignee:@afk'), [{ field: 'assignee', value: '@afk' }]);
});

// A:/a: is a thin alias for assignee: — same field, same
// value/lowercasing rules, just a shorter prefix to type.
test('A: and a: alias assignee:, case-insensitively on the prefix itself', () => {
  assert.deepStrictEqual(parseSearchQuery('A:@afk'), [{ field: 'assignee', value: '@afk' }]);
  assert.deepStrictEqual(parseSearchQuery('a:@afk'), [{ field: 'assignee', value: '@afk' }]);
  assert.deepStrictEqual(parseSearchQuery('A:@AFK'), [{ field: 'assignee', value: '@afk' }]); // value still lowercased
});

test('a valueless A:/a: prefix (mid-typing) is dropped, same as the other scoped prefixes', () => {
  assert.deepStrictEqual(parseSearchQuery('A:'), []);
  assert.deepStrictEqual(parseSearchQuery('a:'), []);
});

// --- ADR 0009: review:/blocked: sticker scopes ------------------

test('review: and blocked: parse as their own scoped term, value lowercased like the other substring scopes', () => {
  assert.deepStrictEqual(parseSearchQuery('review:PR'), [{ field: 'review', value: 'pr' }]);
  assert.deepStrictEqual(parseSearchQuery('blocked:Vendor'), [{ field: 'blocked', value: 'vendor' }]);
});

test('UNLIKE every other scoped prefix, a bare review:/blocked: (no value) is a COMPLETE term, not dropped', () => {
  assert.deepStrictEqual(parseSearchQuery('review:'), [{ field: 'review', value: '' }]);
  assert.deepStrictEqual(parseSearchQuery('blocked:'), [{ field: 'blocked', value: '' }]);
});

test('bare text (no prefix) parses as a null-field term', () => {
  assert.deepStrictEqual(parseSearchQuery('foo'), [{ field: null, value: 'foo' }]);
});

test('multiple space-separated terms parse independently, each keeping its own prefix', () => {
  assert.deepStrictEqual(parseSearchQuery('status:todo tags:app'), [
    { field: 'status', value: 'todo' },
    { field: 'tags', value: 'app' },
  ]);
});

test('extra/irregular whitespace between terms is collapsed', () => {
  assert.deepStrictEqual(parseSearchQuery('  status:todo    tags:app  '), [
    { field: 'status', value: 'todo' },
    { field: 'tags', value: 'app' },
  ]);
});

test('field prefix name is case-insensitive; the value is lowercased for substring fields', () => {
  assert.deepStrictEqual(parseSearchQuery('TITLE:Foo'), [{ field: 'title', value: 'foo' }]);
  assert.deepStrictEqual(parseSearchQuery('Status:Doing'), [{ field: 'status', value: 'doing' }]);
});

test('id: value is kept verbatim (not lowercased) — exact numeric compare needs no case folding', () => {
  assert.deepStrictEqual(parseSearchQuery('ID:42'), [{ field: 'id', value: '42' }]);
});

test('an unrecognized field prefix falls back to a bare term over the whole token', () => {
  assert.deepStrictEqual(parseSearchQuery('owner:bob'), [{ field: null, value: 'owner:bob' }]);
});

test('#-prefixed non-numeric token is not id shorthand — falls back to a bare term', () => {
  assert.deepStrictEqual(parseSearchQuery('#42abc'), [{ field: null, value: '#42abc' }]);
  assert.deepStrictEqual(parseSearchQuery('#abc'), [{ field: null, value: '#abc' }]);
});

test('a scoped prefix with no value yet (mid-typing, e.g. "status:") is dropped, not a matches-everything term', () => {
  assert.deepStrictEqual(parseSearchQuery('status:'), []);
  assert.deepStrictEqual(parseSearchQuery('id:'), []);
  assert.deepStrictEqual(parseSearchQuery('title:'), []);
  assert.deepStrictEqual(parseSearchQuery('body:'), []);
  assert.deepStrictEqual(parseSearchQuery('priority:'), []);
  assert.deepStrictEqual(parseSearchQuery('tags:'), []);
  assert.deepStrictEqual(parseSearchQuery('file:'), []);
  assert.deepStrictEqual(parseSearchQuery('assignee:'), []);
});

test('a valueless scoped prefix mixed with a real term keeps only the real term', () => {
  assert.deepStrictEqual(parseSearchQuery('status:todo tags:'), [{ field: 'status', value: 'todo' }]);
});

// --- cardMatchesQuery / filterCards: matching semantics --------------------

const CARDS = [
  { id: 1, title: 'Fix login bug', body: 'Users cannot log in with SSO.', status: 'todo', priority: 'High', tags: ['bug', 'auth'], file: '0001.fix-login-bug.card.md' },
  { id: 2, title: 'Add search box', body: 'Field-scoped query syntax for the board.', status: 'doing', priority: 'Normal', tags: ['app', 'feature', 'search'], file: '0002.add-search-box.card.md' },
  { id: 42, title: 'Refactor auth module', body: 'Split token refresh into its own file.', status: 'backlog', priority: 'Normal', tags: ['auth', 'refactor'], file: '0042.refactor-auth-module.card.md' },
];

function idsFor(query) {
  return filterCards(CARDS, parseSearchQuery(query)).map((c) => c.id);
}

test('#42 matches only that card id, exactly', () => {
  assert.deepStrictEqual(idsFor('#42'), [42]);
});

test('id:42 matches only that card id, exactly', () => {
  assert.deepStrictEqual(idsFor('id:42'), [42]);
});

test('id search never partial-matches (id:4 does not match card 42)', () => {
  assert.deepStrictEqual(idsFor('id:4'), []);
});

test('title: substring-matches the title, case-insensitively', () => {
  assert.deepStrictEqual(idsFor('title:search'), [2]);
  assert.deepStrictEqual(idsFor('title:SEARCH'), [2]);
});

test('body: substring-matches the markdown body', () => {
  assert.deepStrictEqual(idsFor('body:token'), [42]);
});

test('status: is substring, not exact — "do" matches both todo and doing', () => {
  assert.deepStrictEqual(idsFor('status:do').sort(), [1, 2]);
});

test('priority: substring-matches, case-insensitively', () => {
  assert.deepStrictEqual(idsFor('priority:high'), [1]);
  assert.deepStrictEqual(idsFor('priority:HIGH'), [1]);
});

test('tags: matches if ANY one tag contains the substring', () => {
  assert.deepStrictEqual(idsFor('tags:auth').sort(), [1, 42]);
});

test('file: substring-matches the basename', () => {
  assert.deepStrictEqual(idsFor('file:0042'), [42]);
});

test('assignee: substring-matches the handle, case-insensitively; A:/a: match identically', () => {
  const cards = [
    { id: 1, title: 'x', body: '', status: 'todo', priority: 'Normal', tags: [], file: '', assignee: '@afk' },
    { id: 2, title: 'y', body: '', status: 'todo', priority: 'Normal', tags: [], file: '', assignee: '@hitl' },
  ];
  const idsFor2 = (q) => filterCards(cards, parseSearchQuery(q)).map((c) => c.id);
  assert.deepStrictEqual(idsFor2('assignee:afk'), [1]);
  assert.deepStrictEqual(idsFor2('assignee:AFK'), [1]);
  assert.deepStrictEqual(idsFor2('A:afk'), [1]);
  assert.deepStrictEqual(idsFor2('a:afk'), [1]);
  assert.deepStrictEqual(idsFor2('assignee:hitl'), [2]);
});

test('review:/blocked: bare term matches exactly the cards passing the sticker predicate (ADR 0009)', () => {
  const cards = [
    { id: 1, title: 'a', body: '', status: 'todo', priority: 'Normal', tags: [], review: 'PR #6' },
    { id: 2, title: 'b', body: '', status: 'todo', priority: 'Normal', tags: [], blocked: 'vendor outage' },
    { id: 3, title: 'c', body: '', status: 'todo', priority: 'Normal', tags: [], review: 'false', blocked: 'no' }, // both clear (YAML special-case)
    { id: 4, title: 'd', body: '', status: 'todo', priority: 'Normal', tags: [] }, // neither field present
  ];
  const idsFor3 = (q) => filterCards(cards, parseSearchQuery(q)).map((c) => c.id);
  assert.deepStrictEqual(idsFor3('review:'), [1]);
  assert.deepStrictEqual(idsFor3('blocked:'), [2]);
});

test('review:<text> / blocked:<text> substring-match the sticker text, case-insensitively — a card missing the field never matches', () => {
  const cards = [
    { id: 1, title: 'a', body: '', status: 'todo', priority: 'Normal', tags: [], review: 'PR #6' },
    { id: 2, title: 'b', body: '', status: 'todo', priority: 'Normal', tags: [], review: 'read the design doc' },
    { id: 3, title: 'c', body: '', status: 'todo', priority: 'Normal', tags: [], blocked: 'vendor outage' },
  ];
  const idsFor3 = (q) => filterCards(cards, parseSearchQuery(q)).map((c) => c.id);
  assert.deepStrictEqual(idsFor3('review:PR'), [1]);
  assert.deepStrictEqual(idsFor3('review:pr'), [1]);
  assert.deepStrictEqual(idsFor3('blocked:vendor'), [3]);
  assert.deepStrictEqual(idsFor3('review:nope'), []);
});

test('a bare `review: true`/`blocked: true` sticker (text unspecified) is present but matches no substring term', () => {
  const cards = [{ id: 1, title: 'a', body: '', status: 'todo', priority: 'Normal', tags: [], review: true }];
  const idsFor3 = (q) => filterCards(cards, parseSearchQuery(q)).map((c) => c.id);
  assert.deepStrictEqual(idsFor3('review:'), [1], 'bare presence still matches');
  assert.deepStrictEqual(idsFor3('review:x'), [], 'no text to substring-match against');
});

test('bare text hits title + body + tags, not status/priority', () => {
  assert.deepStrictEqual(idsFor('auth').sort(), [1, 42]); // tag/title/body hits
  assert.deepStrictEqual(idsFor('high'), []); // only appears in priority — bare term must NOT match it
});

test('multiple space-separated terms AND together (status:todo tags:app = todo cards tagged app)', () => {
  assert.deepStrictEqual(idsFor('status:todo tags:bug'), [1]);
  assert.deepStrictEqual(idsFor('status:todo tags:search'), []); // card1 has no "search" tag, card2 isn't todo
});

test('multiple bare terms AND together across fields', () => {
  assert.deepStrictEqual(idsFor('auth module'), [42]); // card1 has "auth" tag but no "module" anywhere
});

test('an empty query matches every card (no filtering)', () => {
  assert.deepStrictEqual(filterCards(CARDS, parseSearchQuery('')), CARDS);
});

test('cardMatchesQuery with zero terms is vacuously true (Array.every on [])', () => {
  assert.strictEqual(cardMatchesQuery(CARDS[0], []), true);
});

test('typing "status:" with no value yet does not flash a false all-match — same as an empty query', () => {
  assert.deepStrictEqual(idsFor('status:'), CARDS.map((c) => c.id));
});

// --- tree:<id> / path:<id> --------------------------------------

test('tree: and path: parse as their own scoped term, id kept case-verbatim like id:', () => {
  assert.deepStrictEqual(parseSearchQuery('tree:74'), [{ field: 'tree', value: '74' }]);
  assert.deepStrictEqual(parseSearchQuery('path:74'), [{ field: 'path', value: '74' }]);
});

test('tree:/path: strip an optional leading # — tree:74 and tree:#74 parse identically', () => {
  assert.deepStrictEqual(parseSearchQuery('tree:#74'), [{ field: 'tree', value: '74' }]);
  assert.deepStrictEqual(parseSearchQuery('path:#74'), [{ field: 'path', value: '74' }]);
});

test('a valueless tree:/path: prefix (mid-typing) is dropped, same as the other scoped prefixes', () => {
  assert.deepStrictEqual(parseSearchQuery('tree:'), []);
  assert.deepStrictEqual(parseSearchQuery('path:'), []);
  assert.deepStrictEqual(parseSearchQuery('tree:#'), []);
});

const GRAPH_CARDS = [
  { id: 1, title: 'root', status: 'done', waiting_for: [] },
  { id: 2, title: 'branch B', status: 'todo', waiting_for: [1] },
  { id: 3, title: 'branch C', status: 'todo', waiting_for: [1] },
  { id: 9, title: 'loner', status: 'todo', waiting_for: [] },
];

test('filterCards resolves tree:<id> to the connected component, over the FULL cards array passed in', () => {
  assert.deepStrictEqual(idsFor2(GRAPH_CARDS, 'tree:2').sort(), [1, 2, 3]);
});

test('filterCards resolves path:<id> to the directed cone, excluding a sibling branch tree: would include', () => {
  assert.deepStrictEqual(idsFor2(GRAPH_CARDS, 'path:2').sort(), [1, 2]);
});

test('filterCards: tree:/path: on an unknown id matches nothing (empty result, no error)', () => {
  assert.deepStrictEqual(idsFor2(GRAPH_CARDS, 'tree:999'), []);
  assert.deepStrictEqual(idsFor2(GRAPH_CARDS, 'path:999'), []);
});

test('filterCards: tree:/path: on an isolated card (no edges) resolves to just itself', () => {
  assert.deepStrictEqual(idsFor2(GRAPH_CARDS, 'tree:9'), [9]);
  assert.deepStrictEqual(idsFor2(GRAPH_CARDS, 'path:9'), [9]);
});

test('filterCards: tree:/path: compose with the rest of the query by plain intersection (AND)', () => {
  // tree:2 -> {1,2,3}; status:todo narrows to {2,3}
  assert.deepStrictEqual(idsFor2(GRAPH_CARDS, 'tree:2 status:todo').sort(), [2, 3]);
  // path:2 -> {1,2}; status:todo narrows to {2}
  assert.deepStrictEqual(idsFor2(GRAPH_CARDS, 'path:2 status:todo'), [2]);
});

test('filterCards: tree:#<id> (leading #) resolves the same as tree:<id>', () => {
  assert.deepStrictEqual(idsFor2(GRAPH_CARDS, 'tree:#2').sort(), idsFor2(GRAPH_CARDS, 'tree:2').sort());
});

test('cardMatchesQuery called directly with an UNRESOLVED tree:/path: term matches nothing (no graph to resolve against) — always go through filterCards for tree:/path:', () => {
  assert.strictEqual(cardMatchesQuery(GRAPH_CARDS[0], [{ field: 'tree', value: '1' }]), false);
  assert.strictEqual(cardMatchesQuery(GRAPH_CARDS[0], [{ field: 'path', value: '1' }]), false);
});

function idsFor2(cards, query) {
  return filterCards(cards, parseSearchQuery(query)).map((c) => c.id);
}

// --- searchSuggestionItems: the search box autocomplete --

test('typing a bare fragment suggests it plain, plus every KNOWN_FIELDS scoped form', () => {
  assert.deepStrictEqual(searchSuggestionItems('@afk'), [
    { value: '@afk', label: '@afk' },
    { value: 'title:@afk', label: 'title:@afk' },
    { value: 'body:@afk', label: 'body:@afk' },
    { value: 'status:@afk', label: 'status:@afk' },
    { value: 'priority:@afk', label: 'priority:@afk' },
    { value: 'tags:@afk', label: 'tags:@afk' },
    { value: 'file:@afk', label: 'file:@afk' },
    { value: 'assignee:@afk', label: 'assignee:@afk' },
    { value: 'type:@afk', label: 'type:@afk' },
  ]);
});

test('an empty query, or a query ending in whitespace (no segment being typed), suggests nothing', () => {
  assert.deepStrictEqual(searchSuggestionItems(''), []);
  assert.deepStrictEqual(searchSuggestionItems('   '), []);
  assert.deepStrictEqual(searchSuggestionItems('status:todo '), []);
});

test('a segment that already carries a colon (recognized or not) suggests nothing — already scoped', () => {
  assert.deepStrictEqual(searchSuggestionItems('status:do'), []);
  assert.deepStrictEqual(searchSuggestionItems('owner:bob'), []);
});

test('earlier terms are preserved verbatim in `value`, untouched in `label`', () => {
  const items = searchSuggestionItems('status:todo @afk');
  assert.deepStrictEqual(items[0], { value: 'status:todo @afk', label: '@afk' });
  const assigneeItem = items.find((i) => i.label === 'assignee:@afk');
  assert.deepStrictEqual(assigneeItem, { value: 'status:todo assignee:@afk', label: 'assignee:@afk' });
});

test('multiple earlier terms all survive into value, space-joined, only the last segment completes', () => {
  const items = searchSuggestionItems('status:todo tags:ui af');
  assert.deepStrictEqual(items[0], { value: 'status:todo tags:ui af', label: 'af' });
  const assigneeItem = items.find((i) => i.label === 'assignee:af');
  assert.deepStrictEqual(assigneeItem, { value: 'status:todo tags:ui assignee:af', label: 'assignee:af' });
});
