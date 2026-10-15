const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSearchQuery, filterCards, searchSetSlice, searchSplitSlice, searchJoinSlice, searchCutOnly,
  searchHasAlt, searchAddAlt, searchRemoveAlt,
} = require('../web/search');

// The slice section writes its run into the box as a slice: term at the top level of
// the query, ANDed over the whole of it. The search module's term interface does the
// writing: a run added to a query that holds | brackets that query, or it would cut only
// the last group; a run set again replaces the one there; and the box's alternatives (the
// pills' side of the interface) leave the run alone, so a pill and a run live in one box.

const HIERARCHY = ['goal', 'strategy', 'objective', 'epic'];
const card = (id, type, parent, tags) => ({
  id, type, parent, tags, title: `Card ${id}`, body: '', status: id % 2 ? 'todo' : 'doing', priority: 'Normal', assignee: '', waiting_for: [],
});
const CARDS = [
  card(1, 'goal', null, ['ui']),
  card(2, 'strategy', null, ['ui']),
  card(3, 'epic', null, ['api']),
  card(4, 'story', 3, ['ui']),
  card(5, 'task', 4, ['ui']),
  card(6, 'story', null, []),
  card(7, 'goal', null, ['api']),
  card(12, 'epic', null, ['ui']),
];
const CTX = { board: 'b', hierarchy: HIERARCHY };
const sliceValues = (text) => parseSearchQuery(text, 'b').filter((t) => t.field === 'slice').map((t) => t.value);
const idsOf = (text) => filterCards(CARDS, parseSearchQuery(text, 'b'), CTX).map((c) => c.id).sort((a, b) => a - b);
const both = (a, b) => idsOf(a).filter((id) => idsOf(b).includes(id));

// --- setting the run ---------------------------------------------------------------------------

test('a run is written as a slice: term, alone in an empty box', () => {
  assert.strictEqual(searchSetSlice('', 'goal..epic'), 'slice:goal..epic');
  assert.strictEqual(searchSetSlice('   ', '1'), 'slice:1');
});

test('a run joins a query of one alternative as one more term', () => {
  assert.strictEqual(searchSetSlice('tags:ui', '..epic'), 'tags:ui slice:..epic');
  assert.strictEqual(searchSetSlice('tags:ui status:todo', 'epic..'), 'tags:ui status:todo slice:epic..');
});

test('setting a run on tags:ui | #12 changes only the slice: term and keeps the meaning of the rest', () => {
  const written = searchSetSlice('tags:ui | #12', 'goal..epic');
  assert.strictEqual(written, '(tags:ui | #12) slice:goal..epic');
  assert.deepStrictEqual(idsOf(written), both('tags:ui | #12', 'slice:goal..epic'));
  assert.deepStrictEqual(idsOf(written), [1, 2, 12], 'card 12 is named and in the run; the api cards and the cards below the tiers are out');
  assert.notDeepStrictEqual(idsOf('tags:ui | #12 slice:goal..epic'), idsOf(written), 'the term simply appended binds to the last group only');
});

test('setting a run again, or clearing it, takes the bracket off a query that no longer needs it', () => {
  const written = searchSetSlice('tags:ui | #12', 'goal..epic');
  assert.strictEqual(searchSetSlice(written, 'strategy'), '(tags:ui | #12) slice:strategy');
  assert.strictEqual(searchSetSlice(written, ''), 'tags:ui | #12');
  assert.strictEqual(searchSetSlice('(tags:ui | #12) slice:goal', ''), 'tags:ui | #12');
});

test('a run replaces the slice: term the box holds, whatever its letter case or spacing', () => {
  assert.strictEqual(searchSetSlice('tags:ui slice:goal', '..epic'), 'tags:ui slice:..epic');
  assert.strictEqual(searchSetSlice('Slice:GOAL   tags:ui', '1'), 'tags:ui slice:1');
  assert.strictEqual(searchSetSlice('slice:goal slice:epic', '1'), 'slice:1', 'both terms of a hand-typed pair go');
  assert.strictEqual(searchSetSlice('slice:goal', 'epic'), 'slice:epic');
});

test('a run set to none takes the slice: term out and nothing else', () => {
  assert.strictEqual(searchSetSlice('tags:ui slice:goal', ''), 'tags:ui');
  assert.strictEqual(searchSetSlice('slice:goal', ''), '');
  assert.strictEqual(searchSetSlice('slice:goal |', ''), '', 'the bar left dangling after it goes too');
});

test('no run to set and none in the box leaves the text as it was, byte for byte', () => {
  for (const text of ['', 'tags:ui', 'tags:ui |', 'a | b ', '(a | b)  c', 'title:"unclosed']) assert.strictEqual(searchSetSlice(text, ''), text, JSON.stringify(text));
});

test('a run already written as it would be written leaves the text as it was', () => {
  assert.strictEqual(searchSetSlice('(tags:ui | #12) slice:goal..epic', 'goal..epic'), '(tags:ui | #12) slice:goal..epic');
  assert.strictEqual(searchSetSlice('tags:ui slice:epic', 'epic'), 'tags:ui slice:epic');
});

test('a slice: term inside a bracket or after a | is the query\'s own, not the run: it stays, and the run goes on the outside', () => {
  assert.strictEqual(searchSetSlice('tags:ui | slice:goal', 'epic'), '(tags:ui | slice:goal) slice:epic');
  assert.strictEqual(searchSetSlice('(slice:goal | #3) tags:ui', 'epic'), '(slice:goal | #3) tags:ui slice:epic');
  assert.strictEqual(searchSetSlice('(slice:goal | #3) tags:ui', ''), '(slice:goal | #3) tags:ui');
});

test('a bracket holding no | is part of the top level, so a run inside it is the run', () => {
  assert.strictEqual(searchSetSlice('(tags:ui slice:goal)', 'epic'), 'tags:ui slice:epic');
  assert.strictEqual(searchSetSlice('(slice:goal) tags:ui', ''), 'tags:ui');
});

test('a query half typed gets the run without losing or running into what is typed', () => {
  assert.strictEqual(searchSetSlice('tags:ui |', 'epic'), 'tags:ui slice:epic');
  assert.strictEqual(searchSetSlice('tags:ui | status:', 'epic'), '(tags:ui | status:) slice:epic');
  assert.strictEqual(searchSetSlice('title:"foo', 'epic'), 'title:"foo" slice:epic');
  assert.strictEqual(searchSetSlice('tags:ui slice:', 'epic'), 'tags:ui slice:epic');
});

test('a value with spaces is quoted, so it stays one term', () => {
  assert.strictEqual(searchSetSlice('', 'my tier..epic'), 'slice:"my tier..epic"');
  assert.deepStrictEqual(sliceValues('slice:"my tier..epic"'), ['my tier..epic']);
});

test('setting a run never changes what the rest of the query matches: the cards are the old ones inside the run', () => {
  const queries = ['', 'tags:ui', 'tags:ui | #12', 'tags:api | tags:ui status:todo', '(tags:ui | #12)', 'tags:ui |', '(slice:goal | #3) tags:ui', 'tags:ui | slice:epic', '#4 | #7 | #12', 'title:"Card 5"'];
  const values = ['goal..epic', '..strategy', 'epic..', '0', 'strategy', '1..2'];
  for (const query of queries) {
    for (const value of values) {
      const written = searchSetSlice(query, value);
      assert.deepStrictEqual(idsOf(written), both(query, `slice:${value}`), `${JSON.stringify(query)} cut to ${value} is ${JSON.stringify(written)}`);
      assert.deepStrictEqual(idsOf(searchSetSlice(written, '')), idsOf(query), `${JSON.stringify(query)} with its run taken out again`);
    }
  }
});

// --- reading the run ------------------------------------------------------------------------------

test('the run the slice section reads is the parse\'s slice: terms at the top level, the ones the Graph hides by', () => {
  assert.deepStrictEqual(sliceValues('slice:goal..epic'), ['goal..epic']);
  assert.deepStrictEqual(sliceValues('(tags:ui | #12) slice:goal..epic'), ['goal..epic']);
  assert.deepStrictEqual(sliceValues('slice:goal slice:epic'), ['goal', 'epic']);
  assert.deepStrictEqual(sliceValues('(slice:goal) tags:ui'), ['goal']);
  assert.deepStrictEqual(sliceValues('tags:ui | slice:goal'), []);
  assert.deepStrictEqual(sliceValues('(slice:goal | #3) tags:ui'), []);
  assert.deepStrictEqual(sliceValues('slice:'), [], 'a slice: with no value yet is no term');
  assert.deepStrictEqual(sliceValues(''), []);
  assert.deepStrictEqual(sliceValues('slice:goal |'), ['goal'], 'an empty alternative is dropped, so what is left is the whole query');
});

test('the terms set apart are exactly the slice: terms the parse holds at the top level', () => {
  const queries = [
    'slice:goal', 'tags:ui slice:goal', '(tags:ui | #12) slice:goal..epic', 'tags:ui | slice:goal', '(slice:goal | #3) slice:epic', '(slice:goal) (slice:epic)',
    'slice:goal |', 'slice:goal | status:', 'a | b slice:x', '(a slice:1)', '((slice:1))', 'slice:goal slice:epic tags:ui', '', 'tags:ui',
  ];
  for (const q of queries) {
    const top = sliceValues(q);
    assert.deepStrictEqual(searchSplitSlice(q).slices.map((text) => sliceValues(text)[0]), top, q);
  }
});

test('a query with no slice: term at the top level is its own rest, untouched', () => {
  for (const q of ['', 'tags:ui', 'a | b ', '(a | b)', 'tags:ui | slice:goal']) assert.deepStrictEqual(searchSplitSlice(q), { rest: q, slices: [] }, JSON.stringify(q));
});

test('what is left once the terms are set apart is the query as its alternatives, with an outer bracket opened', () => {
  assert.deepStrictEqual(searchSplitSlice('(tags:ui | #12) slice:goal..epic'), { rest: 'tags:ui | #12', slices: ['slice:goal..epic'] });
  assert.deepStrictEqual(searchSplitSlice('tags:ui status:todo slice:goal'), { rest: 'tags:ui status:todo', slices: ['slice:goal'] });
  assert.deepStrictEqual(searchSplitSlice('slice:goal'), { rest: '', slices: ['slice:goal'] });
});

test('joining the terms back puts the query in a bracket when it has more than one alternative, and not when it has one', () => {
  assert.strictEqual(searchJoinSlice('a | b', ['slice:x']), '(a | b) slice:x');
  assert.strictEqual(searchJoinSlice('a b', ['slice:x']), 'a b slice:x');
  assert.strictEqual(searchJoinSlice('', ['slice:x']), 'slice:x');
  assert.strictEqual(searchJoinSlice('a | b', []), 'a | b', 'no terms, no bracket');
  assert.strictEqual(searchJoinSlice('a | b', ['slice:x', 'slice:y']), '(a | b) slice:x slice:y');
});

// --- the box's alternatives leave the run where it stands -------------------------------------------

test('a pill\'s alternative is in a box that also holds a run', () => {
  assert.strictEqual(searchHasAlt('review: slice:epic', 'review:'), true);
  assert.strictEqual(searchHasAlt('(review: | blocked:) slice:epic', 'blocked:'), true);
  assert.strictEqual(searchHasAlt('(review: | blocked:) slice:epic', 'waiting:'), false);
  assert.strictEqual(searchHasAlt('slice:epic', 'review:'), false);
});

test('adding an alternative to a box that holds a run adds it beside the others, inside the bracket', () => {
  assert.strictEqual(searchAddAlt('review: slice:epic', 'blocked:'), '(review: | blocked:) slice:epic');
  assert.strictEqual(searchAddAlt('(review: | blocked:) slice:epic', 'waiting:'), '(review: | blocked: | waiting:) slice:epic');
  assert.strictEqual(searchAddAlt('slice:epic', 'blocked:'), 'blocked: slice:epic');
  assert.strictEqual(searchAddAlt('review: slice:epic', 'review:'), 'review: slice:epic', 'one the box holds is not added twice');
});

test('taking an alternative out of a box that holds a run leaves the run, and the bracket once it is not needed', () => {
  assert.strictEqual(searchRemoveAlt('(review: | blocked:) slice:epic', 'blocked:'), 'review: slice:epic');
  assert.strictEqual(searchRemoveAlt('review: slice:epic', 'review:'), 'slice:epic');
  assert.strictEqual(searchRemoveAlt('(review: | blocked:) slice:epic', 'waiting:'), '(review: | blocked:) slice:epic', 'nothing to take out, the text as it was');
});

test('the alternatives of a box with no run are as they were', () => {
  assert.strictEqual(searchAddAlt('review:', 'blocked:'), 'review: | blocked:');
  assert.strictEqual(searchRemoveAlt('review: | blocked:', 'blocked:'), 'review:');
  assert.strictEqual(searchHasAlt('review: | blocked:', 'review:'), true);
  assert.strictEqual(searchHasAlt('tags:ui | slice:epic', 'slice:epic'), true, 'a slice: term that is one alternative among others is just an alternative');
});

test('searchCutOnly keeps the top-level slice: terms and nothing else', () => {
  assert.strictEqual(searchCutOnly('zephyr slice:goal..strategy'), 'slice:goal..strategy');
  assert.strictEqual(searchCutOnly('slice:goal..strategy'), 'slice:goal..strategy');
  assert.strictEqual(searchCutOnly('(tags:ui | #12) slice:epic.. slice:..3'), 'slice:epic.. slice:..3');
  assert.strictEqual(searchCutOnly('zephyr'), '');
  assert.strictEqual(searchCutOnly('slice:goal | tags:ui'), '', 'a term under | is the query\'s own');
  assert.strictEqual(searchCutOnly(''), '');
  assert.strictEqual(searchCutOnly(null), '');
});
