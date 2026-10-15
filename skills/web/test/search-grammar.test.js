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

// --- round brackets group, and can nest ---------------------------------------

test('"tags:ui (status:doing | status:todo)" is the ui cards in doing or todo', () => {
  assert.deepStrictEqual(ids('tags:ui (status:doing | status:todo)'), [1, 2]);
});

test('a bracket holding an or parses as one or term beside the terms around it', () => {
  assert.deepStrictEqual(parseSearchQuery('tags:ui (status:doing | status:todo)'), [
    { field: 'tags', value: 'ui' },
    { field: 'or', alts: [[{ field: 'status', value: 'doing' }], [{ field: 'status', value: 'todo' }]] },
  ]);
});

test('a bracket inside a bracket groups the same way as a single bracket', () => {
  const single = ids('tags:ui (status:doing | status:todo)');
  assert.deepStrictEqual(ids('tags:ui ((status:doing | status:todo))'), single);
  assert.deepStrictEqual(ids('(tags:ui) (((status:doing) | (status:todo)))'), single);
  assert.deepStrictEqual(ids('((tags:ui (status:doing | status:todo)))'), single);
  assert.deepStrictEqual(ids('(zephyr | (scheduler | domain)) status:done | #1'), [1, 5]);
});

test('a bracket decides which alternative an and belongs to, where precedence alone would not', () => {
  assert.deepStrictEqual(ids('status:doing | status:todo tags:grilling'), [1, 4]);
  assert.deepStrictEqual(ids('(status:doing | status:todo) tags:grilling'), [4]);
});

test('(draft) is the same query as draft: the same terms and the same cards', () => {
  assert.deepStrictEqual(parseSearchQuery('(draft)'), parseSearchQuery('draft'));
  assert.deepStrictEqual(parseSearchQuery('(status:todo tags:ui) zephyr'), parseSearchQuery('status:todo tags:ui zephyr'));
  const drafts = [card(7, { title: 'Draft the notes' }), card(8, { title: 'Ship it' })];
  assert.deepStrictEqual(ids('(draft)', drafts), ids('draft', drafts));
  assert.deepStrictEqual(ids('(draft)', drafts), [7]);
});

test('a bracket counts only at a token edge, so fix(auth) and a(b)c stay literal text', () => {
  assert.deepStrictEqual(parseSearchQuery('fix(auth)'), [{ field: null, value: 'fix(auth)' }]);
  assert.deepStrictEqual(parseSearchQuery('a(b)c'), [{ field: null, value: 'a(b)c' }]);
  assert.deepStrictEqual(parseSearchQuery('title:(x)'), [{ field: 'title', value: '(x)' }]);
  const titled = [card(7, { title: 'fix(auth) redirect' }), card(8, { title: 'fix auth' })];
  assert.deepStrictEqual(ids('fix(auth)', titled), [7]);
});

test('a literal bracket pair at the edge of a grouped token still closes the group', () => {
  assert.deepStrictEqual(parseSearchQuery('(fix(auth))'), [{ field: null, value: 'fix(auth)' }]);
  assert.deepStrictEqual(parseSearchQuery('(zephyr fix(auth)) | #1'), [
    { field: 'or', alts: [[{ field: null, value: 'zephyr' }, { field: null, value: 'fix(auth)' }], [{ field: 'id', value: '1' }]] },
  ]);
});

test('an unclosed bracket reads to the end of the input and a stray closing bracket is ignored', () => {
  assert.deepStrictEqual(ids('tags:ui (status:doing | status:todo'), [1, 2]);
  assert.deepStrictEqual(ids('(zephyr'), [1]);
  assert.deepStrictEqual(ids('zephyr)'), [1]);
  assert.deepStrictEqual(ids(') zephyr'), [1]);
  assert.deepStrictEqual(ids('(zephyr))'), [1]);
  assert.deepStrictEqual(ids('((zephyr'), [1]);
});

test('an empty bracket, or one holding only bars or not-yet-terms, is an empty alternative and is dropped', () => {
  const all = CARDS.map((c) => c.id);
  assert.deepStrictEqual(ids('()'), all);
  assert.deepStrictEqual(ids('( )'), all);
  assert.deepStrictEqual(ids('(|)'), all);
  assert.deepStrictEqual(ids('(status:)'), all);
  assert.deepStrictEqual(ids('tags:ui ()'), ids('tags:ui'));
  assert.deepStrictEqual(ids('tags:ui | ()'), ids('tags:ui'));
  assert.deepStrictEqual(ids('tags:ui (status:doing |)'), ids('tags:ui status:doing'));
});

test('half-typed input never throws, whatever the mix of bars, brackets and prefixes', () => {
  const pieces = ['|', '(', ')', 'a', 'status:', ' ', 'tags:ui', '||', '#', '()'];
  const queries = new Set(['a | status:', '| |', '((', '))', '(|', '|)', '(a |', 'a | (b |', ') | (']);
  for (const x of pieces) for (const y of pieces) for (const z of pieces) queries.add(x + y + z);
  queries.forEach((q) => {
    assert.doesNotThrow(() => {
      const terms = parseSearchQuery(q);
      filterCards(CARDS, terms);
    }, JSON.stringify(q));
  });
});

// --- quotes ------------------------------------------------------------------

test('tags:"grill" matches a card tagged grill and not a card tagged only grilling', () => {
  assert.deepStrictEqual(ids('tags:grill'), [1, 4], 'unquoted is still a substring');
  assert.deepStrictEqual(ids('tags:"grill"'), [1]);
  assert.deepStrictEqual(ids('tags:"grilling"'), [4]);
});

test('a quoted value matches the whole value, ignoring case, or any one element of a list field', () => {
  assert.deepStrictEqual(ids('tags:"GRILL"'), [1]);
  assert.deepStrictEqual(ids('tags:"ui"'), [1, 2, 3], 'one of several tags is enough');
  assert.deepStrictEqual(ids('tags:"gri"'), [], 'a part of a tag is not the tag');
  assert.deepStrictEqual(ids('status:"doing"'), [1, 4]);
  assert.deepStrictEqual(ids('status:"do"'), []);
  const people = [card(7, { assignee: '@afk', priority: 'High', type: 'goal' }), card(8, { assignee: '@afk-extra', priority: 'Highest', type: 'goal-x' })];
  assert.deepStrictEqual(ids('assignee:"@AFK"', people), [7]);
  assert.deepStrictEqual(ids('a:"@afk"', people), [7]);
  assert.deepStrictEqual(ids('priority:"high"', people), [7]);
  assert.deepStrictEqual(ids('type:"goal"', people), [7]);
  assert.deepStrictEqual(ids('file:"0007.card.md"', people), [7]);
});

test('a quoted title: or body: value matches only a card whose whole field is that text, in any letter case', () => {
  assert.deepStrictEqual(ids('title:"zephyr migration"'), [1]);
  assert.deepStrictEqual(ids('title:"ZEPHYR Migration"'), [1]);
  assert.deepStrictEqual(ids('title:"zephyr"'), [], 'a word of the title is not the title');
  assert.deepStrictEqual(ids('title:zephyr'), [1], 'unquoted is still a substring');
  const bodied = [card(7, { body: 'Ship the release notes' }), card(8, { body: 'Ship the release notes and the changelog' })];
  assert.deepStrictEqual(ids('body:"ship the release notes"', bodied), [7]);
  assert.deepStrictEqual(ids('body:"release notes"', bodied), []);
});

test('a quoted value keeps its spaces and the terms around it keep theirs', () => {
  assert.deepStrictEqual(ids('title:"move the data layer" status:todo'), [2]);
  assert.deepStrictEqual(ids('status:todo title:"move the data layer"'), [2]);
  assert.deepStrictEqual(ids('title:"move the data layer" | #1'), [1, 2]);
});

test('quoted text with no field matches the phrase in a title, body or tag, and not words that are apart', () => {
  const phrased = [
    card(7, { title: 'Fix two words here' }),
    card(8, { title: 'Two apart words' }),
    card(9, { body: 'The body says two words too.' }),
    card(10, { tags: ['two words'] }),
    card(11, { title: 'words two' }),
    card(12, { body: 'two\nwords across a line break' }),
  ];
  assert.deepStrictEqual(ids('"two words"', phrased), [7, 9, 10, 12]);
  assert.deepStrictEqual(ids('"TWO WORDS"', phrased), [7, 9, 10, 12]);
  assert.deepStrictEqual(ids('two words', phrased), [7, 8, 9, 10, 11, 12], 'unquoted words are two terms that may be apart');
});

test('a quoted term parses to an exact scoped term or a phrase, and an unquoted one is unchanged', () => {
  assert.deepStrictEqual(parseSearchQuery('tags:"Grill"'), [{ field: 'tags', value: 'grill', exact: true }]);
  assert.deepStrictEqual(parseSearchQuery('title:"Two  words"'), [{ field: 'title', value: 'two words', exact: true }]);
  assert.deepStrictEqual(parseSearchQuery('"Two  words"'), [{ field: null, value: 'two words' }]);
  assert.deepStrictEqual(parseSearchQuery('tags:grill'), [{ field: 'tags', value: 'grill' }]);
});

test('inside quotes a | a bracket and a prefix are plain text', () => {
  const marked = [card(7, { title: 'a | b' }), card(8, { title: 'fix (auth) now' }), card(9, { title: 'status:doing is how it reads' })];
  assert.deepStrictEqual(ids('"a | b"', marked), [7]);
  assert.deepStrictEqual(ids('title:"a | b"', marked), [7]);
  assert.deepStrictEqual(ids('"(auth)"', marked), [8]);
  assert.deepStrictEqual(ids('("fix (auth)" | zzz)', marked), [8]);
  assert.deepStrictEqual(ids('"status:doing"', marked), [9]);
});

test('a quote opens only at the start of a token or right after a field prefix, and elsewhere is literal', () => {
  assert.deepStrictEqual(parseSearchQuery('5"'), [{ field: null, value: '5"' }]);
  assert.deepStrictEqual(parseSearchQuery('say"hi there"'), [{ field: null, value: 'say"hi' }, { field: null, value: 'there"' }]);
  assert.deepStrictEqual(parseSearchQuery('owner:"bob smith"'), [{ field: null, value: 'owner:"bob' }, { field: null, value: 'smith"' }]);
  assert.deepStrictEqual(parseSearchQuery('waiting:"x"'), [{ field: null, value: 'waiting:"x"' }]);
});

test('a bracket can hold a quote and a quote can end right before a closing bracket', () => {
  assert.deepStrictEqual(ids('("two words")', [card(7, { title: 'a two words b' })]), [7]);
  assert.deepStrictEqual(ids('tags:ui (title:"zephyr migration" | title:"retire the scheduler")'), [1]);
  assert.deepStrictEqual(ids('(title:"zephyr migration" | title:"retire the scheduler") tags:"ui"'), [1]);
});

test('an unclosed quote reads to the end of the input, and an empty quote is not a term', () => {
  const all = CARDS.map((c) => c.id);
  assert.deepStrictEqual(ids('tags:"grill'), [1]);
  assert.deepStrictEqual(ids('tags:"two words'), []);
  assert.deepStrictEqual(ids('"zephyr mig'), [1]);
  assert.deepStrictEqual(ids('"'), all);
  assert.deepStrictEqual(ids('""'), all);
  assert.deepStrictEqual(ids('tags:""'), all);
  assert.deepStrictEqual(ids('tags:"'), all);
  assert.deepStrictEqual(ids('tags:ui | ""'), ids('tags:ui'));
  assert.deepStrictEqual(ids('tags:"ui" "'), ids('tags:"ui"'));
});

test('half-typed quotes mixed with bars and brackets never throw', () => {
  const pieces = ['|', '(', ')', '"', 'a', 'tags:', ' ', 'title:"', 'x"'];
  const queries = new Set();
  for (const x of pieces) for (const y of pieces) for (const z of pieces) queries.add(x + y + z);
  queries.forEach((q) => {
    assert.doesNotThrow(() => filterCards(CARDS, parseSearchQuery(q)), JSON.stringify(q));
  });
});

test('quoted id:, tree: and path: values are the same as unquoted ones, and a quoted sticker text matches the whole text', () => {
  assert.deepStrictEqual(ids('id:"12"'), [12]);
  assert.deepStrictEqual(parseSearchQuery('tree:"#12"'), parseSearchQuery('tree:12'));
  const stuck = [card(7, { blocked: 'vendor outage' }), card(8, { blocked: 'vendor' }), card(9, { review: 'PR #6' })];
  assert.deepStrictEqual(ids('blocked:vendor', stuck), [7, 8]);
  assert.deepStrictEqual(ids('blocked:"vendor"', stuck), [8]);
  assert.deepStrictEqual(ids('blocked:"Vendor Outage"', stuck), [7]);
  assert.deepStrictEqual(ids('review:"pr #6"', stuck), [9]);
});
