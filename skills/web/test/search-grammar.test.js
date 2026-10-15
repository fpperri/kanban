const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, cardMatchesQuery, filterCards } = require('../web/search');

// The search grammar beyond space-separated terms: `|` for or, round brackets,
// quoted values and `waiting:`. Driven through the search module's own seam, a
// query string in and the cards it matches out; the old forms stay pinned in
// search.test.js, search-type.test.js and search-board-id.test.js.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], file: `${String(id).padStart(4, '0')}.card.md`,
  assignee: null, type: null, waiting_for: [], blocked: null, review: null, ...over,
});

const CARDS = [
  card(1, { title: 'Zephyr migration', status: 'doing', tags: ['ui', 'grill'] }),
  card(2, { title: 'Move the data layer', status: 'todo', tags: ['ui'] }),
  card(3, { title: 'Write the cutover plan', status: 'backlog', tags: ['ui'] }),
  card(4, { title: 'Audit the bucket', status: 'doing', tags: ['grilling'] }),
  card(5, { title: 'Retire the scheduler', status: 'done', tags: ['data'] }),
  card(12, { title: 'Renew the domain', status: 'backlog', tags: [] }),
];

const ids = (q, cards = CARDS, ctx) => filterCards(cards, parseSearchQuery(q), ctx).map((c) => c.id);

// --- | is or, and spaces bind tighter -----------------------------------------

test('"tags:ui status:doing | #12" is ui and doing, or card 12', () => {
  assert.deepStrictEqual(ids('tags:ui status:doing | #12'), [1, 12]);
});

test('an or between bare words matches either, not both', () => {
  assert.deepStrictEqual(ids('zephyr | scheduler'), [1, 5]);
});

test('a query with no | parses to the same flat term list as before', () => {
  assert.deepStrictEqual(parseSearchQuery('status:todo tags:app'), [
    { field: 'status', value: 'todo' },
    { field: 'tags', value: 'app' },
  ]);
});

test('an or is one term holding its alternatives, each a list of terms', () => {
  assert.deepStrictEqual(parseSearchQuery('tags:ui status:doing | #12'), [
    { field: 'or', alts: [[{ field: 'tags', value: 'ui' }, { field: 'status', value: 'doing' }], [{ field: 'id', value: '12' }]] },
  ]);
});

test('an empty alternative is dropped, so a trailing | matches what the query before it matches', () => {
  assert.deepStrictEqual(ids('tags:ui |'), ids('tags:ui'));
  assert.deepStrictEqual(ids('| tags:ui'), ids('tags:ui'));
  assert.deepStrictEqual(ids('tags:ui | | status:done'), [1, 2, 3, 5]);
  assert.deepStrictEqual(parseSearchQuery('tags:ui |'), parseSearchQuery('tags:ui'));
});

test('an alternative that is only a not-yet-a-term is empty and dropped, never every card', () => {
  assert.deepStrictEqual(ids('tags:ui | status:'), ids('tags:ui'));
  assert.deepStrictEqual(ids('tags:ui | status:doing'), [1, 2, 3, 4]);
});

test('a lone | or only bars parse to no terms, so nothing narrows', () => {
  assert.deepStrictEqual(parseSearchQuery('|'), []);
  assert.deepStrictEqual(parseSearchQuery('| |'), []);
  assert.deepStrictEqual(ids('|'), CARDS.map((c) => c.id));
});

test('| counts only as a token of its own, so a|b and a |b stay literal text', () => {
  assert.deepStrictEqual(parseSearchQuery('a|b'), [{ field: null, value: 'a|b' }]);
  assert.deepStrictEqual(parseSearchQuery('a |b'), [{ field: null, value: 'a' }, { field: null, value: '|b' }]);
  assert.deepStrictEqual(parseSearchQuery('a| b'), [{ field: null, value: 'a|' }, { field: null, value: 'b' }]);
  const piped = [card(7, { title: 'left|right' }), card(8, { title: 'left' })];
  assert.deepStrictEqual(ids('left|right', piped), [7]);
});

test('cardMatchesQuery reads an or term, and an alternative with no terms matches nothing', () => {
  const terms = parseSearchQuery('zephyr | scheduler');
  assert.strictEqual(cardMatchesQuery(CARDS[0], terms), true);
  assert.strictEqual(cardMatchesQuery(CARDS[4], terms), true);
  assert.strictEqual(cardMatchesQuery(CARDS[1], terms), false);
  assert.strictEqual(cardMatchesQuery(CARDS[0], [{ field: 'or', alts: [[]] }]), false);
});
