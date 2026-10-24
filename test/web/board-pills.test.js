const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseSearchQuery, filterCards, searchTermText, searchAddAlt, searchRemoveAlt } = require('../../plugin/skills/web/web/search');
const { pillList, pillEntries, pillRows, pillIsOn, pillsOn } = require('../../plugin/skills/web/web/pills');
const { NO_SELECTION, queryPart, addPart } = require('../../plugin/skills/web/web/selection');

// A board's own pills, after the three built-ins: each entry of its `pills:` is a
// query (shown as its query) or a label and a query (shown as its label), and a
// `field:*` entry becomes one pill per distinct value the board's active cards hold,
// labelled by the value, sorted, matching that value exactly. The first eight of a
// field's values show and a "+N more" row stands for the rest. The search module does
// the matching, over the whole board; the list counts the matches among the cards it
// is given, which the page makes the view's cards after the status pills and Archive,
// before the search box and any cut (R13).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], file: `${String(id).padStart(4, '0')}.card.md`,
  assignee: null, type: null, waiting_for: [], blocked: null, review: null, archived: false, ...over,
});

const matchOver = (cards) => (query) => new Set(filterCards(cards, parseSearchQuery(query), {}).map((c) => c.id));
const BUILT_INS = ['blocked', 'review', 'waiting'];
const labelsOf = (list) => list.map((p) => p.label);

// 1 grill, 2 grilling, 3 grill and next-up, 4 a tag with a space, 5 none, 6 done.
const BOARD = [
  card(1, { tags: ['grill'], assignee: '@human' }),
  card(2, { tags: ['grilling'], assignee: '@afk' }),
  card(3, { tags: ['grill', 'next-up'], assignee: '@human' }),
  card(4, { tags: ['two words'], assignee: '@hitl' }),
  card(5),
  card(6, { status: 'done', tags: ['next-up'], assignee: '@afk' }),
];
const board = (pills, over = {}) => ({ pills, cards: BOARD, term: searchTermText, ...over });
const list = (pills, over) => pillList(BOARD, matchOver(BOARD), board(pills, over));

test('the board\'s own pills follow blocked, review and waiting, in config order', () => {
  const pills = [{ label: 'next', query: 'tags:"next-up"' }, { label: 'mine', query: 'assignee:@human' }, { label: 'ui', query: 'tags:ui' }];
  assert.deepStrictEqual(labelsOf(list(pills)), [...BUILT_INS, 'next', 'mine', 'ui']);
  assert.deepStrictEqual(list(pills).slice(3).map((p) => p.query), ['tags:"next-up"', 'assignee:@human', 'tags:ui']);
});

test('a labelled entry shows its label and an unlabelled entry shows its query', () => {
  const shown = list([{ label: 'next', query: 'tags:"next-up"' }, { query: 'assignee:@human' }, 'status:done', { label: '  ', query: 'type:epic' }]);
  assert.deepStrictEqual(labelsOf(shown).slice(3), ['next', 'assignee:@human', 'status:done', 'type:epic']);
});

test('a board pill counts the cards its query matches, among the cards given', () => {
  const shown = list([{ label: 'next', query: 'tags:"next-up"' }, { label: 'mine', query: 'assignee:@human' }]);
  assert.deepStrictEqual(shown.slice(3).map((p) => [p.label, p.count]), [['next', 2], ['mine', 2]]);
  const withoutDone = pillList(BOARD.filter((c) => c.status !== 'done'), matchOver(BOARD), board([{ label: 'next', query: 'tags:"next-up"' }]));
  assert.strictEqual(withoutDone[3].count, 1, 'card 6 is done and out of the given cards');
});

test('a board with no pills, or with something that is not a list, gets only the three built-ins', () => {
  for (const pills of [undefined, null, [], 'tags:*', 7, { label: 'x', query: 'y' }]) {
    assert.deepStrictEqual(labelsOf(list(pills)), BUILT_INS, String(JSON.stringify(pills)));
  }
  assert.deepStrictEqual(labelsOf(pillList(BOARD, matchOver(BOARD))), BUILT_INS, 'no board at all');
  assert.deepStrictEqual(labelsOf(pillList(BOARD, matchOver(BOARD), null)), BUILT_INS);
});

test('malformed entries are skipped without error, and the good ones around them stay', () => {
  const bad = [null, undefined, 3, true, [], ['tags:x'], {}, { label: 'no query' }, { query: '' }, { query: '   ' }, { query: 5 }, { label: 'x', query: null }, { query: {} }, '', '   '];
  const good = { label: 'next', query: 'tags:"next-up"' };
  assert.doesNotThrow(() => list([...bad, good, ...bad]));
  assert.deepStrictEqual(labelsOf(list([...bad, good, ...bad])), [...BUILT_INS, 'next']);
  assert.deepStrictEqual(labelsOf(list(bad)), BUILT_INS);
});

test('an entry the matcher or a card cannot handle never throws either: odd cards, a matcher that answers oddly', () => {
  const odd = [null, 4, 'x', { tags: 'ui' }, { tags: [null, 3, {}] }, card(9, { assignee: 7, status: null })];
  assert.doesNotThrow(() => pillList(BOARD, matchOver(BOARD), { pills: [{ query: 'tags:*' }, { query: 'assignee:*' }, { query: 'status:*' }], cards: odd, term: searchTermText }));
  assert.doesNotThrow(() => pillList(BOARD, () => undefined, board([{ query: 'tags:*' }])));
  assert.doesNotThrow(() => pillList(BOARD, matchOver(BOARD), { pills: [{ query: 'tags:*' }], cards: 'nope', term: searchTermText }));
  assert.doesNotThrow(() => pillList(BOARD, matchOver(BOARD), { pills: [{ query: 'tags:*' }], cards: BOARD, term: 'nope' }));
});

test('each board pill has a key of its own, and an entry repeated by its query is listed once', () => {
  const shown = list([{ label: 'a', query: 'tags:ui' }, { label: 'b', query: 'tags:ui' }, { label: 'c', query: 'tags:api' }]);
  assert.deepStrictEqual(labelsOf(shown).slice(3), ['a', 'c']);
  assert.strictEqual(new Set(shown.map((p) => p.key)).size, shown.length);
  assert.ok(shown.every((p) => typeof p.key === 'string' && p.key));
});

test('spacing in a query does not make a second pill of it', () => {
  const shown = list([{ label: 'a', query: 'tags:ui   status:doing' }, { label: 'b', query: 'tags:ui status:doing' }]);
  assert.deepStrictEqual(labelsOf(shown).slice(3), ['a']);
});

// --- the term writer ------------------------------------------------------------------------

test('the term writer writes a scoped value as a quoted, exact term when asked, and its other writes stay as they were', () => {
  assert.strictEqual(searchTermText('tags', 'grill', true), 'tags:"grill"');
  assert.deepStrictEqual(parseSearchQuery(searchTermText('tags', 'grill', true)), [{ field: 'tags', value: 'grill', exact: true }]);
  assert.strictEqual(searchTermText('tags', 'two words', true), 'tags:"two words"');
  assert.strictEqual(searchTermText('assignee', '@human', true), 'assignee:"@human"');
  assert.strictEqual(searchTermText('tags', 'grill'), 'tags:grill', 'asked for nothing, it writes the substring term');
  assert.strictEqual(searchTermText('tags', 'grill', false), 'tags:grill');
  assert.strictEqual(searchTermText(null, 'grill', true), 'grill', 'bare text has no scope to be exact in');
  assert.strictEqual(searchTermText('tags', 'say "hi"', true), 'tags:"say hi"', 'a quote inside a value is left out, as it is without the flag');
});

// --- field:* -----------------------------------------------------------------------------

test('tags:* gives one pill per distinct tag on the board, sorted, each labelled by its tag', () => {
  const shown = list([{ label: 'tags:*', query: 'tags:*' }]);
  assert.deepStrictEqual(labelsOf(shown), [...BUILT_INS, 'grill', 'grilling', 'next-up', 'two words']);
});

test('the order of the tag pills is the same whatever order the cards come in, and letter case does not split a tag in two', () => {
  const cards = [card(1, { tags: ['Zeta', 'alpha'] }), card(2, { tags: ['ALPHA', 'beta'] }), card(3, { tags: ['alpha'] })];
  const a = pillList(cards, matchOver(cards), { pills: [{ query: 'tags:*' }], cards, term: searchTermText });
  const b = pillList(cards, matchOver(cards), { pills: [{ query: 'tags:*' }], cards: [...cards].reverse(), term: searchTermText });
  assert.deepStrictEqual(labelsOf(a).slice(3).map((s) => s.toLowerCase()), ['alpha', 'beta', 'zeta']);
  assert.deepStrictEqual(labelsOf(a).length, 6);
  assert.deepStrictEqual(labelsOf(b).slice(3).map((s) => s.toLowerCase()), ['alpha', 'beta', 'zeta']);
  assert.deepStrictEqual(a.slice(3).map((p) => p.key), b.slice(3).map((p) => p.key), 'the key does not depend on which spelling was met first');
  assert.deepStrictEqual(a.slice(3).map((p) => p.count), [3, 1, 1], 'ALPHA, alpha and Alpha are one pill matching all three cards');
});

test('each tag pill matches only the cards that hold exactly that tag: grill never catches grilling', () => {
  const shown = list([{ query: 'tags:*' }]);
  const byLabel = Object.fromEntries(shown.slice(3).map((p) => [p.label, p]));
  assert.deepStrictEqual([...matchOver(BOARD)(byLabel.grill.query)].sort(), [1, 3]);
  assert.deepStrictEqual([...matchOver(BOARD)(byLabel.grilling.query)].sort(), [2]);
  assert.deepStrictEqual([...matchOver(BOARD)(byLabel['next-up'].query)].sort(), [3, 6]);
  assert.deepStrictEqual(shown.slice(3).map((p) => [p.label, p.count]), [['grill', 2], ['grilling', 1], ['next-up', 2], ['two words', 1]]);
});

test('a value with a space stays one exact term, and the pill\'s query reads back as that one term', () => {
  const pill = list([{ query: 'tags:*' }]).find((p) => p.label === 'two words');
  assert.strictEqual(pill.query, 'tags:"two words"');
  assert.deepStrictEqual(parseSearchQuery(pill.query), [{ field: 'tags', value: 'two words', exact: true }]);
  assert.strictEqual(pill.count, 1);
});

test('a value holding a bar or brackets stays one exact term, so its pill joins the box and leaves it without touching the rest', () => {
  const cards = [card(1, { tags: ['a | b (c)'] }), card(2, { tags: ['a'] })];
  const pill = pillList(cards, matchOver(cards), { pills: [{ query: 'tags:*' }], cards, term: searchTermText }).find((p) => p.label === 'a | b (c)');
  assert.deepStrictEqual([...matchOver(cards)(pill.query)], [1]);
  assert.strictEqual(searchAddAlt('review:', pill.query), `review: | ${pill.query}`);
  assert.strictEqual(searchRemoveAlt(`review: | ${pill.query}`, pill.query), 'review:');
});

test('a value is written the way the search module writes an exact term, so the query is the module\'s own text', () => {
  const asked = [];
  const term = (field, value, exact) => { asked.push([field, value, exact]); return searchTermText(field, value, exact); };
  list([{ query: 'tags:*' }], { term });
  assert.deepStrictEqual(asked, [['tags', 'grill', true], ['tags', 'grilling', true], ['tags', 'next-up', true], ['tags', 'two words', true]]);
});

test('assignee:* gives one pill per distinct assignee, each matching exactly that assignee', () => {
  const shown = list([{ query: 'assignee:*' }]);
  assert.deepStrictEqual(labelsOf(shown).slice(3), ['@afk', '@hitl', '@human']);
  assert.deepStrictEqual(shown.slice(3).map((p) => p.query), ['assignee:"@afk"', 'assignee:"@hitl"', 'assignee:"@human"']);
  assert.deepStrictEqual(shown.slice(3).map((p) => p.count), [2, 1, 2]);
  assert.deepStrictEqual([...matchOver(BOARD)(shown[5].query)].sort(), [1, 3], '@human only');
  const longer = [card(1, { assignee: '@human' }), card(2, { assignee: '@human-reviewer' })];
  const exact = pillList(longer, matchOver(longer), { pills: [{ query: 'assignee:*' }], cards: longer, term: searchTermText });
  assert.deepStrictEqual(exact.slice(3).map((p) => [p.label, p.count]), [['@human', 1], ['@human-reviewer', 1]], '@human does not catch @human-reviewer');
});

test('a:* is assignee:*, and the field name is read in any letter case', () => {
  assert.deepStrictEqual(labelsOf(list([{ query: 'a:*' }])).slice(3), ['@afk', '@hitl', '@human']);
  assert.deepStrictEqual(labelsOf(list([{ query: 'Tags:*' }])).slice(3), ['grill', 'grilling', 'next-up', 'two words']);
});

test('status:*, priority:* and type:* expand too, one pill per value', () => {
  const cards = [card(1, { status: 'doing', priority: 'High', type: 'epic' }), card(2, { status: 'todo', type: 'story' }), card(3, { status: 'doing', type: 'epic' })];
  const make = (query) => pillList(cards, matchOver(cards), { pills: [{ query }], cards, term: searchTermText }).slice(3).map((p) => [p.label, p.count]);
  assert.deepStrictEqual(make('status:*'), [['doing', 2], ['todo', 1]]);
  assert.deepStrictEqual(make('priority:*'), [['High', 1], ['Normal', 2]]);
  assert.deepStrictEqual(make('type:*'), [['epic', 2], ['story', 1]]);
});

test('a field:* entry on a field with no list of values, or that is not a field at all, is skipped', () => {
  for (const query of ['title:*', 'body:*', 'file:*', 'blocked:*', 'nonsense:*', 'review:*']) {
    assert.deepStrictEqual(labelsOf(list([{ query }, { label: 'next', query: 'tags:"next-up"' }])).slice(3), ['next'], query);
  }
});

test('a query that only ends in a star, or holds one, is an ordinary query and is not expanded', () => {
  assert.deepStrictEqual(labelsOf(list([{ query: 'tags:* status:done' }, { query: 'grill*' }, { query: '*' }, { query: ':*' }])).slice(3), ['tags:* status:done', 'grill*', '*', ':*']);
});

test('a label on a field:* entry does not name its pills: each is labelled by its value', () => {
  assert.deepStrictEqual(labelsOf(list([{ label: 'every tag', query: 'tags:*' }])).slice(3), ['grill', 'grilling', 'next-up', 'two words']);
});

test('values come from the cards the board gives, not from the cards counted', () => {
  const view = BOARD.filter((c) => c.id === 1);
  const shown = pillList(view, matchOver(BOARD), board([{ query: 'tags:*' }]));
  assert.deepStrictEqual(labelsOf(shown).slice(3), ['grill', 'grilling', 'next-up', 'two words'], 'a tag the view does not hold still has its pill');
  assert.deepStrictEqual(shown.slice(3).map((p) => p.count), [1, 0, 0, 0]);
});

test('a board with no tags, or no card holding the field, gives no pill for it and is no error', () => {
  const none = [card(1), card(2)];
  assert.deepStrictEqual(labelsOf(pillList(none, matchOver(none), { pills: [{ query: 'tags:*' }, { query: 'assignee:*' }], cards: none, term: searchTermText })), BUILT_INS);
});

test('a value the term writer cannot carry, or one that is blank, has no pill', () => {
  const cards = [card(1, { tags: ['say "hi"', '  ', 'ok', ''] }), card(2, { tags: ['two   words', 'two words'] })];
  const shown = pillList(cards, matchOver(cards), { pills: [{ query: 'tags:*' }], cards, term: searchTermText });
  assert.deepStrictEqual(labelsOf(shown).slice(3), ['ok', 'two words'], 'one pill for the two spellings, none for the quote');
  assert.strictEqual(shown[4].count, 1);
});

test('without a term writer there is nothing to expand with: the expansion is skipped and the other entries stay', () => {
  const shown = pillList(BOARD, matchOver(BOARD), { pills: [{ query: 'tags:*' }, { label: 'next', query: 'tags:"next-up"' }], cards: BOARD });
  assert.deepStrictEqual(labelsOf(shown).slice(3), ['next']);
});

test('two entries on one field expand once, and an expansion keeps its place between the entries around it', () => {
  const shown = list([{ label: 'first', query: 'status:done' }, { query: 'assignee:*' }, { query: 'a:*' }, { label: 'last', query: 'tags:"next-up"' }]);
  assert.deepStrictEqual(labelsOf(shown).slice(3), ['first', '@afk', '@hitl', '@human', 'last']);
});

test('each value pill is keyed by its field and its value, and the key stays when the cards change', () => {
  const a = list([{ query: 'tags:*' }, { query: 'assignee:*' }]).slice(3);
  const keys = a.map((p) => p.key);
  assert.strictEqual(new Set(keys).size, keys.length);
  const grew = pillList(BOARD.concat(card(9, { tags: ['aaa'], assignee: '@zed' })), matchOver(BOARD), board([{ query: 'tags:*' }, { query: 'assignee:*' }], { cards: BOARD.concat(card(9, { tags: ['aaa'], assignee: '@zed' })) })).slice(3);
  for (const p of a) assert.ok(grew.some((q) => q.key === p.key), `${p.label} keeps its key`);
  const tag = a.find((p) => p.label === 'grill');
  const assignee = a.find((p) => p.label === '@human');
  assert.notStrictEqual(tag.key, assignee.key);
  assert.ok(!BUILT_INS.includes(tag.key));
});

// --- the rows: eight, then "+N more" ---------------------------------------------------------------

const TEN = Array.from({ length: 10 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
const TEN_CARDS = TEN.map((tag, i) => card(i + 1, { tags: [tag] }));
const tenList = () => pillList(TEN_CARDS, matchOver(TEN_CARDS), { pills: [{ query: 'tags:*' }], cards: TEN_CARDS, term: searchTermText });
const describe = (rows) => rows.map((r) => (r.kind === 'more' ? `[${r.label}]` : r.label));

test('ten values show eight pills and a "+2 more" row', () => {
  assert.strictEqual(tenList().length, 13, 'the list holds all ten value pills');
  assert.deepStrictEqual(describe(pillRows(tenList())), [...BUILT_INS, ...TEN.slice(0, 8), '[+2 more]']);
});

test('opening the rest shows every value pill and the row says it can fold them back; folding hides them again', () => {
  const open = pillRows(tenList(), ['tags']);
  assert.deepStrictEqual(describe(open), [...BUILT_INS, ...TEN, '[fewer]']);
  const more = open[open.length - 1];
  assert.strictEqual(more.expanded, true);
  assert.deepStrictEqual(describe(pillRows(tenList(), [])), [...BUILT_INS, ...TEN.slice(0, 8), '[+2 more]']);
  assert.strictEqual(pillRows(tenList(), [])[11].expanded, false);
});

test('the more row names its field and how many are behind it, and has a key of its own that no pill has', () => {
  const rows = pillRows(tenList());
  const more = rows[rows.length - 1];
  assert.strictEqual(more.kind, 'more');
  assert.strictEqual(more.group, 'tags');
  assert.strictEqual(more.hidden, 2);
  assert.ok(!tenList().some((p) => p.key === more.key));
  assert.strictEqual(pillRows(tenList(), ['tags']).pop().key, more.key, 'the same key folded or not, so the button stays the button');
  assert.ok(pillRows(tenList(), ['tags']).pop().hidden === 2);
});

test('eight values show all eight and no more row, nine show eight and "+1 more"', () => {
  const cards = (n) => TEN_CARDS.slice(0, n);
  const rowsOf = (n) => pillRows(pillList(cards(n), matchOver(cards(n)), { pills: [{ query: 'tags:*' }], cards: cards(n), term: searchTermText }));
  assert.deepStrictEqual(describe(rowsOf(8)), [...BUILT_INS, ...TEN.slice(0, 8)]);
  assert.deepStrictEqual(describe(rowsOf(9)), [...BUILT_INS, ...TEN.slice(0, 8), '[+1 more]']);
});

test('each field:* entry has its own eight and its own more row, and opening one leaves the other as it was', () => {
  const cards = TEN.map((tag, i) => card(i + 1, { tags: [tag], assignee: `@a${String(i + 1).padStart(2, '0')}` }));
  const both = pillList(cards, matchOver(cards), { pills: [{ query: 'tags:*' }, { label: 'mine', query: 'assignee:@a01' }, { query: 'assignee:*' }], cards, term: searchTermText });
  const closed = describe(pillRows(both, []));
  assert.deepStrictEqual(closed, [...BUILT_INS, ...TEN.slice(0, 8), '[+2 more]', 'mine', ...TEN.slice(0, 8).map((t) => `@a${t.slice(1)}`), '[+2 more]']);
  const tagsOpen = describe(pillRows(both, ['tags']));
  assert.deepStrictEqual(tagsOpen, [...BUILT_INS, ...TEN, '[fewer]', 'mine', ...TEN.slice(0, 8).map((t) => `@a${t.slice(1)}`), '[+2 more]']);
});

test('built-in and plain board pills are never hidden behind a more row', () => {
  const plain = Array.from({ length: 12 }, (_, i) => ({ label: `p${i}`, query: `title:p${i}` }));
  const rows = pillRows(pillList(BOARD, matchOver(BOARD), board(plain)));
  assert.deepStrictEqual(describe(rows), [...BUILT_INS, ...plain.map((p) => p.label)]);
});

test('a group that is asked to open and is not there is no error', () => {
  assert.doesNotThrow(() => pillRows(tenList(), ['assignee', 'nope', null, 3]));
  assert.doesNotThrow(() => pillRows(tenList(), null));
  assert.doesNotThrow(() => pillRows([], undefined));
  assert.deepStrictEqual(pillRows([]), []);
});

// --- counts (R13) ------------------------------------------------------------------------------------

test('turning one pill on leaves every other pill\'s count unchanged: the counts are taken over the cards given, whatever the selection', () => {
  const pills = [{ label: 'next', query: 'tags:"next-up"' }, { query: 'tags:*' }, { query: 'assignee:*' }];
  const before = pillList(BOARD, matchOver(BOARD), board(pills));
  assert.ok(before.length > 8, 'the pills of the entries and of both expansions are in the list');
  const counts = (l) => l.map((p) => [p.key, p.count]);
  let selection = NO_SELECTION;
  for (const pill of before) {
    selection = addPart(selection, queryPart(pill.query));
    assert.ok(pillsOn(selection, before).some((p) => p.key === pill.key), `${pill.label} is on`);
    assert.deepStrictEqual(counts(pillList(BOARD, matchOver(BOARD), board(pills))), counts(before), `after ${pill.label}`);
  }
});

test('a status pill turned off lowers the counts by the cards it hides: the list is given the cards the view still shows', () => {
  const pills = [{ label: 'next', query: 'tags:"next-up"' }, { query: 'tags:*' }, { query: 'assignee:*' }];
  const all = pillList(BOARD, matchOver(BOARD), board(pills));
  const noDone = pillList(BOARD.filter((c) => c.status !== 'done'), matchOver(BOARD), board(pills));
  const count = (l, label) => l.find((p) => p.label === label).count;
  assert.strictEqual(count(all, 'next'), 2);
  assert.strictEqual(count(noDone, 'next'), 1, 'card 6 is done');
  assert.strictEqual(count(all, '@afk'), 2);
  assert.strictEqual(count(noDone, '@afk'), 1);
  assert.strictEqual(count(noDone, '@human'), count(all, '@human'), 'a pill that held no done card is not lowered');
  assert.deepStrictEqual(noDone.map((p) => p.key), all.map((p) => p.key), 'and no pill left the list');
});

test('a value pill whose cards are all hidden stays in the list with a zero, so it can still be found', () => {
  const noDone = pillList(BOARD.filter((c) => c.status !== 'done'), matchOver(BOARD), board([{ query: 'status:*' }]));
  assert.deepStrictEqual(noDone.slice(3).map((p) => [p.label, p.count]), [['done', 0], ['todo', 5]]);
});

// --- on, and the chip ------------------------------------------------------------------------------------

test('a board pill is on while its query is the anchor or an addition, as a built-in is', () => {
  const shown = list([{ label: 'next', query: 'tags:"next-up"' }, { query: 'tags:*' }]);
  const next = shown.find((p) => p.label === 'next');
  const grill = shown.find((p) => p.label === 'grill');
  const selection = addPart(addPart(NO_SELECTION, queryPart(grill.query)), queryPart('blocked:'));
  assert.strictEqual(pillIsOn(selection, grill), true);
  assert.strictEqual(pillIsOn(selection, next), false);
  assert.deepStrictEqual(pillsOn(addPart(selection, queryPart(next.query)), shown).map((p) => p.label), ['blocked', 'next', 'grill', 'next-up'],
    'a board pill and a value pill with one query are on together, as one query is one thing in the selection');
});

test('pillEntries lists the same pills as pillList without counting anything: the chip reads it', () => {
  let asked = 0;
  const entries = pillEntries(board([{ query: 'tags:*' }]));
  const counted = pillList(BOARD, (q) => { asked++; return matchOver(BOARD)(q); }, board([{ query: 'tags:*' }]));
  assert.deepStrictEqual(entries.map((p) => [p.key, p.label, p.query]), counted.map((p) => [p.key, p.label, p.query]));
  assert.ok(entries.every((p) => !('count' in p)));
  assert.strictEqual(asked, counted.length);
  assert.deepStrictEqual(pillEntries().map((p) => p.label), BUILT_INS);
});

test('each call hands out a fresh list: changing one pill never changes the next', () => {
  const first = list([{ query: 'tags:*' }]);
  first[3].label = 'changed';
  first.pop();
  assert.deepStrictEqual(labelsOf(list([{ query: 'tags:*' }])).slice(3), ['grill', 'grilling', 'next-up', 'two words']);
});

// --- loading -----------------------------------------------------------------------------------------------------

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const source = fs.readFileSync(path.join(WEB, 'pills.js'), 'utf8').split('\r\n').join('\n');

test('the pill-list module still needs no other module, so a snapshot can embed it', () => {
  assert.doesNotMatch(source, /\brequire\(/);
  assert.doesNotMatch(source, /\bimport\b/);
  assert.doesNotMatch(source, /<\/script/i);
  assert.doesNotMatch(source, /__[A-Z_]+__/);
});

test('loaded alone as a plain script, the module expands a field:* entry, given a term writer and the search module\'s matcher', () => {
  const window = {};
  const page = vm.createContext({ window });
  vm.runInContext(source, page);
  for (const name of ['pillList', 'pillEntries', 'pillRows']) assert.strictEqual(typeof window[name], 'function', name);
  const got = window.pillList([card(1, { tags: ['a'] })], () => [1], {
    pills: [{ label: 'tags:*', query: 'tags:*' }], cards: [card(1, { tags: ['a'] })], term: (field, value) => `${field}:"${value}"`,
  });
  assert.deepStrictEqual(Array.from(got, (p) => p.label), ['blocked', 'review', 'waiting', 'a']);
  assert.strictEqual(got[3].query, 'tags:"a"');
});
