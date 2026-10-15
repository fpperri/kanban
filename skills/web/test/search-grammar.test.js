const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSearchQuery, cardMatchesQuery, filterCards, searchTermText, searchAddTerm, searchRemoveTerm, searchBracket, searchSuggestionItems,
} = require('../web/search');

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

// --- waiting: ----------------------------------------------------------------

// Card 21 waits for card 20, which is not done, so it is waiting. Card 22 waits
// only for done card 23. Card 24 waits only for card 99, which no card answers
// to. Card 25 waits for done card 23 and not-done card 20. Card 26 is archived
// and not done, and card 27 waits for it, because waiting ignores where a card
// lives. Card 28 is itself done and still waits for card 20.
const WAITS = [
  card(20, { title: 'The thing waited for', status: 'doing' }),
  card(21, { title: 'Waits for a doing card', waiting_for: [20] }),
  card(22, { title: 'Waits for a done card', waiting_for: [23] }),
  card(23, { title: 'A done card', status: 'done' }),
  card(24, { title: 'Waits for a dangling id', waiting_for: [99] }),
  card(25, { title: 'Waits for both', waiting_for: [23, 20] }),
  card(26, { title: 'Archived and not done', status: 'backlog', archived: true }),
  card(27, { title: 'Waits for an archived card', waiting_for: [26] }),
  card(28, { title: 'Done and waiting', status: 'done', waiting_for: [20] }),
  card(29, { title: 'Waits for nothing' }),
];

test('waiting: matches a card waiting for a card that is not done', () => {
  assert.deepStrictEqual(ids('waiting:', WAITS), [21, 25, 27, 28]);
});

test('waiting: does not match a card whose only waits are on done cards or dangling ids', () => {
  const found = ids('waiting:', WAITS);
  assert.ok(!found.includes(22), 'waits only for a done card');
  assert.ok(!found.includes(24), 'waits only for a dangling id');
  assert.ok(!found.includes(29), 'waits for nothing');
});

test('waiting: reads the whole board it is given, archived cards included', () => {
  const onlyLive = WAITS.filter((c) => !c.archived);
  assert.deepStrictEqual(ids('waiting:', onlyLive), [21, 25, 28], 'without card 26 the wait of card 27 dangles');
});

test('waiting: is a complete term of its own and not a value, so waiting:3 stays literal text', () => {
  assert.deepStrictEqual(parseSearchQuery('waiting:'), [{ field: 'waiting', value: '' }]);
  assert.deepStrictEqual(parseSearchQuery('WAITING:'), [{ field: 'waiting', value: '' }]);
  assert.deepStrictEqual(parseSearchQuery('waiting:3'), [{ field: null, value: 'waiting:3' }]);
  const literal = [card(7, { title: 'See waiting:3 for details' }), card(8, { waiting_for: [20] }), card(20, { status: 'doing' })];
  assert.deepStrictEqual(ids('waiting:3', literal), [7]);
});

test('waiting: composes with the rest of the grammar, inside an or and inside a bracket', () => {
  assert.deepStrictEqual(ids('waiting: status:done', WAITS), [28]);
  assert.deepStrictEqual(ids('waiting: | #29', WAITS), [21, 25, 27, 28, 29]);
  assert.deepStrictEqual(ids('status:todo (waiting: | #29)', WAITS), [21, 25, 27, 29]);
  assert.deepStrictEqual(ids('tags:ui | waiting:', CARDS.concat(WAITS)).sort((a, b) => a - b), [1, 2, 3, 21, 25, 27, 28]);
});

test('the resolver turns waiting: into an id term over the whole board, once, and leaves the parsed terms alone', () => {
  const { resolveTerms } = require('../web/search');
  const terms = parseSearchQuery('waiting: | #29');
  const [resolved] = resolveTerms(WAITS, terms, {});
  assert.strictEqual(resolved.field, 'or');
  assert.strictEqual(resolved.alts[0][0].field, 'ids');
  assert.deepStrictEqual([...resolved.alts[0][0].ids].sort((a, b) => a - b), [21, 25, 27, 28]);
  assert.strictEqual(terms[0].alts[0][0].field, 'waiting', 'the parsed terms are not rewritten in place');
});

test('a waiting: term that was never resolved matches nothing, as tree: and path: do', () => {
  assert.strictEqual(cardMatchesQuery(WAITS[1], parseSearchQuery('waiting:')), false);
});

// --- the term interface: add a term, remove a term, bracket a query -----------

test('adding a term to an empty query gives that term, and to a single alternative appends it', () => {
  assert.strictEqual(searchAddTerm('', 'tags:ui'), 'tags:ui');
  assert.strictEqual(searchAddTerm('   ', 'tags:ui'), 'tags:ui');
  assert.strictEqual(searchAddTerm('assignee:@afk', 'tags:ui'), 'assignee:@afk tags:ui');
  assert.strictEqual(searchAddTerm('title:"two words" status:doing', 'tags:ui'), 'title:"two words" status:doing tags:ui');
});

test('adding a term adds it to every alternative, so it binds to all of them and not only the last', () => {
  assert.strictEqual(searchAddTerm('blocked: | review:', 'tags:ui'), 'blocked: tags:ui | review: tags:ui');
  assert.strictEqual(searchAddTerm('a b | c | d', 'tags:ui'), 'a b tags:ui | c tags:ui | d tags:ui');
  const added = searchAddTerm('status:doing | #12', 'tags:ui');
  assert.deepStrictEqual(ids(added), ids('tags:ui status:doing | tags:ui #12'));
  assert.deepStrictEqual(ids(added), [1], 'card 12 has no ui tag, so only the doing ui card is left');
});

test('adding a term to a query with a bracket keeps the bracket whole and adds beside it', () => {
  assert.strictEqual(searchAddTerm('tags:ui (status:doing | status:todo)', 'tags:grill'), 'tags:ui (status:doing | status:todo) tags:grill');
  assert.deepStrictEqual(ids(searchAddTerm('(status:doing | status:todo) | #12', 'tags:ui')), [1, 2]);
});

test('adding a term the alternative already holds changes nothing, and the text comes back as it was', () => {
  assert.strictEqual(searchAddTerm('tags:ui', 'tags:ui'), 'tags:ui');
  assert.strictEqual(searchAddTerm('a   tags:ui', 'tags:ui'), 'a   tags:ui', 'not even the spacing is touched');
  assert.strictEqual(searchAddTerm('a tags:ui | b tags:ui', 'tags:ui'), 'a tags:ui | b tags:ui');
  assert.strictEqual(searchAddTerm('a tags:ui | b', 'tags:ui'), 'a tags:ui | b tags:ui', 'only the alternative without it gains it');
});

test('a trailing bar or an empty alternative does not become a lone term in the result', () => {
  assert.strictEqual(searchAddTerm('a |', 'tags:ui'), 'a tags:ui');
  assert.strictEqual(searchAddTerm('| a', 'tags:ui'), 'a tags:ui');
});

test('a term with a value that holds spaces is added as one quoted term', () => {
  assert.strictEqual(searchTermText('tags', 'two words'), 'tags:"two words"');
  assert.strictEqual(searchTermText('tags', 'ui'), 'tags:ui');
  assert.strictEqual(searchTermText('assignee', '@afk'), 'assignee:@afk');
  assert.strictEqual(searchTermText(null, 'two words'), '"two words"');
  assert.strictEqual(searchTermText('blocked', ''), 'blocked:');
  const added = searchAddTerm('a | b', { field: 'tags', value: 'two words' });
  assert.strictEqual(added, 'a tags:"two words" | b tags:"two words"');
  assert.deepStrictEqual(parseSearchQuery(added)[0].alts.map((alt) => alt[1]), [
    { field: 'tags', value: 'two words', exact: true },
    { field: 'tags', value: 'two words', exact: true },
  ]);
  const tagged = [card(7, { title: 'a', tags: ['two words'] }), card(8, { title: 'a', tags: ['two'] })];
  assert.deepStrictEqual(ids(searchAddTerm('a', { field: 'tags', value: 'two words' }), tagged), [7]);
  assert.strictEqual(searchAddTerm(added, { field: 'tags', value: 'two words' }), added, 'adding it again is a no-op');
});

test('a quote inside a value cannot be written and is left out, so the term still parses as one', () => {
  assert.strictEqual(searchTermText('tags', 'say "hi"'), 'tags:"say hi"');
  assert.strictEqual(searchTermText('tags', '"x'), 'tags:x');
  assert.strictEqual(searchTermText(null, '(x'), '"(x"');
});

test('removing a term takes it out of every alternative', () => {
  assert.strictEqual(searchRemoveTerm('blocked: tags:ui | review: tags:ui', 'tags:ui'), 'blocked: | review:');
  assert.strictEqual(searchRemoveTerm('a tags:ui b', 'tags:ui'), 'a b');
  assert.strictEqual(searchRemoveTerm('tags:ui', 'tags:ui'), '');
  assert.strictEqual(searchRemoveTerm('a | tags:ui', 'tags:ui'), 'a', 'an alternative left empty is dropped');
  assert.strictEqual(searchRemoveTerm('a tags:"two words"', { field: 'tags', value: 'two words' }), 'a');
});

test('removing a term reaches into brackets and drops a bracket it empties', () => {
  assert.strictEqual(searchRemoveTerm('a (tags:ui | b)', 'tags:ui'), 'a (b)');
  assert.strictEqual(searchRemoveTerm('a (tags:ui)', 'tags:ui'), 'a');
  assert.strictEqual(searchRemoveTerm('a ((tags:ui) | tags:ui)', 'tags:ui'), 'a');
});

test('removing a term that is not there returns the text as it was', () => {
  assert.strictEqual(searchRemoveTerm('a   |  b', 'tags:ui'), 'a   |  b');
  assert.strictEqual(searchRemoveTerm('', 'tags:ui'), '');
  assert.strictEqual(searchRemoveTerm('tags:uikit', 'tags:ui'), 'tags:uikit', 'a term is removed whole, never in part');
});

test('add then remove gets the query back, and the box matches what it matched before', () => {
  const start = 'blocked: | review:';
  const there = searchAddTerm(start, 'tags:ui');
  assert.strictEqual(searchRemoveTerm(there, 'tags:ui'), start);
});

test('bracketing a query that holds a | or spaces wraps it, so it can be one term of another query', () => {
  assert.strictEqual(searchBracket('a | b'), '(a | b)');
  assert.strictEqual(searchBracket('a b'), '(a b)');
  assert.strictEqual(searchBracket('tags:ui status:doing'), '(tags:ui status:doing)');
  assert.strictEqual(searchBracket('  a   b  '), '(a   b)');
  const wrapped = searchBracket('tags:ui | status:done');
  assert.deepStrictEqual(ids(`${wrapped} #1`), [1], 'ANDed with another term, the whole or is one side');
  assert.deepStrictEqual(ids('tags:ui | status:done #1'), [1, 2, 3], 'where unbracketed the and would bind only to the last alternative');
});

test('bracketing a single term, an empty query or a query already in one bracket changes nothing but the edges', () => {
  assert.strictEqual(searchBracket('a'), 'a');
  assert.strictEqual(searchBracket('path:40'), 'path:40');
  assert.strictEqual(searchBracket('title:"two words"'), 'title:"two words"', 'a quoted value with spaces is still one term');
  assert.strictEqual(searchBracket('  a  '), 'a');
  assert.strictEqual(searchBracket(''), '');
  assert.strictEqual(searchBracket('   '), '');
  assert.strictEqual(searchBracket('(a | b)'), '(a | b)');
  assert.strictEqual(searchBracket('((a b))'), '((a b))');
});

// --- suggestions complete the token under the caret --------------------------

const FIELD_NAMES = ['title', 'body', 'status', 'priority', 'tags', 'file', 'assignee', 'type'];
const complete = (before, segment, after = '') => [{ value: before + segment + after, label: segment }]
  .concat(FIELD_NAMES.map((f) => ({ value: `${before}${f}:${segment}${after}`, label: `${f}:${segment}` })));

test('suggestions complete the token typed after an open bracket, leaving the bracket and the terms before it', () => {
  assert.deepStrictEqual(searchSuggestionItems('(sta'), complete('(', 'sta'));
  assert.deepStrictEqual(searchSuggestionItems('tags:ui (sta'), complete('tags:ui (', 'sta'));
  assert.deepStrictEqual(searchSuggestionItems('tags:ui ((sta'), complete('tags:ui ((', 'sta'));
});

test('suggestions complete the token typed after a |, leaving what stands before it', () => {
  assert.deepStrictEqual(searchSuggestionItems('status:todo | @af'), complete('status:todo | ', '@af'));
  assert.deepStrictEqual(searchSuggestionItems('(a | b) | c'), complete('(a | b) | ', 'c'));
  assert.deepStrictEqual(searchSuggestionItems('tags:ui (status:doing | sta'), complete('tags:ui (status:doing | ', 'sta'));
});

test('suggestions complete the token typed inside a quote, keeping the quote open as it is', () => {
  assert.deepStrictEqual(searchSuggestionItems('"two wo'), complete('', '"two wo'));
  assert.deepStrictEqual(searchSuggestionItems('tags:ui "two wo'), complete('tags:ui ', '"two wo'));
  assert.deepStrictEqual(searchSuggestionItems('(a | "two wo'), complete('(a | ', '"two wo'));
});

test('a token the caret is not in is not completed: nothing after a bar, a closed bracket or a space', () => {
  assert.deepStrictEqual(searchSuggestionItems('a |'), []);
  assert.deepStrictEqual(searchSuggestionItems('a | '), []);
  assert.deepStrictEqual(searchSuggestionItems('('), []);
  assert.deepStrictEqual(searchSuggestionItems('(a '), []);
  assert.deepStrictEqual(searchSuggestionItems('(a)'), []);
  assert.deepStrictEqual(searchSuggestionItems('"two words" '), []);
  assert.deepStrictEqual(searchSuggestionItems('"'), []);
});

test('a token that already names a scope is not completed, quoted or not', () => {
  assert.deepStrictEqual(searchSuggestionItems('(status:do'), []);
  assert.deepStrictEqual(searchSuggestionItems('tags:"gri'), []);
  assert.deepStrictEqual(searchSuggestionItems('a | owner:bob'), []);
});

test('with a caret the token under it is completed and the text after it is kept', () => {
  const text = '(sta | status:todo)';
  assert.deepStrictEqual(searchSuggestionItems(text, 4), complete('(', 'sta', ' | status:todo)'));
  assert.deepStrictEqual(searchSuggestionItems('a "two wo b', 9), complete('a ', '"two wo b'), 'an open quote reads to the end, caret or not');
  assert.deepStrictEqual(searchSuggestionItems('one two three', 7), complete('one ', 'two', ' three'));
  assert.deepStrictEqual(searchSuggestionItems(text, 5), [], 'a caret in the space after the token completes nothing');
  assert.deepStrictEqual(searchSuggestionItems('(sta)', 5), [], 'a caret after the closing bracket completes nothing');
  assert.deepStrictEqual(searchSuggestionItems('(sta)', 4), complete('(', 'sta', ')'));
});

test('without a caret the end of the text is where the typing is, as before', () => {
  assert.deepStrictEqual(searchSuggestionItems('status:todo @afk').slice(0, 1), [{ value: 'status:todo @afk', label: '@afk' }]);
  assert.deepStrictEqual(searchSuggestionItems('one two', undefined), complete('one ', 'two'));
});

test('an unclosed quote is closed where a term is added after it, so the term is not swallowed by the quote', () => {
  assert.strictEqual(searchAddTerm('a "b', 'tags:ui'), 'a "b" tags:ui');
  assert.strictEqual(searchAddTerm('tags:"two wo | b', 'status:doing'), 'tags:"two wo | b" status:doing');
  assert.deepStrictEqual(ids(searchAddTerm('zephyr "mig', 'tags:ui')), [1]);
  assert.strictEqual(searchAddTerm('a (b', 'tags:ui'), 'a (b) tags:ui', 'an open bracket is closed the same way');
  assert.strictEqual(searchRemoveTerm('a "b tags:ui', 'tags:ui'), 'a "b tags:ui', 'inside the quote it is text, not a term');
  assert.strictEqual(searchRemoveTerm('a "b" tags:ui', 'tags:ui'), 'a "b"');
});

test('waiting: reads ids the way the waiting rule does, so a card from a page that keeps ids as text still waits', () => {
  const textual = [
    card('7', { title: 'waits', waiting_for: ['8'] }),
    card('8', { title: 'waited for', status: 'doing' }),
    card('9', { title: 'waits for a done card', waiting_for: ['10'] }),
    card('10', { title: 'done', status: 'done' }),
    card('n1', { title: 'a card made in the editor and not applied yet', waiting_for: ['n1'] }),
  ];
  assert.deepStrictEqual(ids('waiting:', textual), ['7']);
});

test('a trailing |, "a | status:", an unclosed quote, an unclosed bracket and a stray closing bracket never throw, in the parser, the matcher or the suggestions', () => {
  for (const q of ['tags:ui |', 'a | status:', 'tags:"gri', '"two wo', 'tags:ui (status:doing', '(((', 'tags:ui) status:doing', ')', '(a | b))']) {
    assert.doesNotThrow(() => {
      filterCards(CARDS, parseSearchQuery(q));
      searchSuggestionItems(q);
      searchSuggestionItems(q, 0);
      searchAddTerm(q, 'tags:x');
      searchRemoveTerm(q, 'tags:x');
      searchBracket(q);
    }, JSON.stringify(q));
  }
});
