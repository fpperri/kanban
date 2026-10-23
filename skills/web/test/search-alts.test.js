const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards, searchHasAlt, searchAddAlt, searchRemoveAlt, searchWithTerms } = require('../web/search');

// Growing and shrinking the box by one alternative: the search module's term
// interface for a pill added to a selection with Shift. The box is a list of
// alternatives joined by `|`, `|` binds loosest, so an alternative is added or
// taken out whole and the others are never touched. Each returns the new text,
// and the text it was handed when nothing changed.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], file: `${String(id).padStart(4, '0')}.card.md`,
  assignee: null, type: null, waiting_for: [], blocked: null, review: null, ...over,
});
const CARDS = [
  card(1, { status: 'doing', tags: ['ui'], review: 'check it' }),
  card(2, { status: 'todo', tags: ['ui'], blocked: 'vendor' }),
  card(3, { status: 'backlog', tags: ['data'], waiting_for: [1] }),
  card(4, { status: 'done', tags: ['ui'] }),
];
const ids = (q) => filterCards(CARDS, parseSearchQuery(q), {}).map((c) => c.id);

test('adding an alternative to a single term grows the box to "term | alternative"', () => {
  assert.strictEqual(searchAddAlt('review:', 'blocked:'), 'review: | blocked:');
  assert.deepStrictEqual(ids(searchAddAlt('review:', 'blocked:')), [1, 2], 'both sets are shown');
});

test('adding to an empty box gives the alternative alone', () => {
  assert.strictEqual(searchAddAlt('', 'blocked:'), 'blocked:');
  assert.strictEqual(searchAddAlt('   ', 'blocked:'), 'blocked:');
});

test('the alternative joins at the end of a box that already holds several, and none of them is touched', () => {
  assert.strictEqual(searchAddAlt('review: | blocked:', 'waiting:'), 'review: | blocked: | waiting:');
  assert.strictEqual(searchAddAlt('status:doing | #12', 'blocked:'), 'status:doing | #12 | blocked:');
});

test('a box that holds spaces is bracketed as one alternative, so the new one is clearly beside it and not part of it', () => {
  assert.strictEqual(searchAddAlt('tags:ui status:doing', 'blocked:'), '(tags:ui status:doing) | blocked:');
  assert.deepStrictEqual(ids(searchAddAlt('tags:ui status:doing', 'blocked:')), [1, 2]);
});

test('an alternative that is already bracketed is not bracketed again when another joins', () => {
  const once = searchAddAlt('tags:ui status:doing', 'blocked:');
  assert.strictEqual(searchAddAlt(once, 'review:'), '(tags:ui status:doing) | blocked: | review:');
});

test('an alternative with spaces or a | of its own is added bracketed, as one alternative', () => {
  assert.strictEqual(searchAddAlt('review:', 'tags:ui status:doing'), 'review: | (tags:ui status:doing)');
  assert.strictEqual(searchAddAlt('', 'tags:ui status:doing'), 'tags:ui status:doing');
});

test('an alternative the box already holds changes nothing, and the text comes back as it was', () => {
  assert.strictEqual(searchAddAlt('review: | blocked:', 'blocked:'), 'review: | blocked:');
  assert.strictEqual(searchAddAlt('review:   |  blocked:', 'blocked:'), 'review:   |  blocked:', 'not even the spacing is touched');
  assert.strictEqual(searchAddAlt('review:', 'review:'), 'review:');
  assert.strictEqual(searchAddAlt('(tags:ui status:doing) | review:', 'tags:ui status:doing'), '(tags:ui status:doing) | review:', 'a bracket and its inside are one alternative');
});

test('a trailing bar or an empty alternative in the box is dropped, never kept as a lone term', () => {
  assert.strictEqual(searchAddAlt('review: |', 'blocked:'), 'review: | blocked:');
  assert.strictEqual(searchAddAlt('| review:', 'blocked:'), 'review: | blocked:');
});

test('adding an empty alternative changes nothing', () => {
  assert.strictEqual(searchAddAlt('review:', ''), 'review:');
  assert.strictEqual(searchAddAlt('review:', '   '), 'review:');
});

test('removing an alternative takes it out and leaves the rest as they were', () => {
  assert.strictEqual(searchRemoveAlt('review: | blocked:', 'blocked:'), 'review:');
  assert.strictEqual(searchRemoveAlt('review: | blocked:', 'review:'), 'blocked:');
  assert.strictEqual(searchRemoveAlt('review: | blocked: | waiting:', 'blocked:'), 'review: | waiting:');
});

test('removing the only alternative empties the box', () => {
  assert.strictEqual(searchRemoveAlt('review:', 'review:'), '');
});

test('removing an alternative from a box that holds a bracketed one gives back the text before it was added', () => {
  const start = 'tags:ui status:doing';
  const grown = searchAddAlt(start, 'blocked:');
  assert.strictEqual(searchRemoveAlt(grown, 'blocked:'), start);
});

test('add then remove gets the box back, whatever it held', () => {
  for (const start of ['review:', 'a b', 'a | b', 'review: | blocked:', '(a b) | c', 'tags:ui (status:doing | status:todo)']) {
    const grown = searchAddAlt(start, 'waiting:');
    assert.notStrictEqual(grown, start, start);
    assert.deepStrictEqual(ids(searchRemoveAlt(grown, 'waiting:')), ids(start), `${start} matches what it matched`);
  }
  assert.strictEqual(searchRemoveAlt(searchAddAlt('review:', 'waiting:'), 'waiting:'), 'review:');
  assert.strictEqual(searchRemoveAlt(searchAddAlt('a | b', 'waiting:'), 'waiting:'), 'a | b');
});

test('removing an alternative that is not there returns the text as it was', () => {
  assert.strictEqual(searchRemoveAlt('review:   |  blocked:', 'waiting:'), 'review:   |  blocked:');
  assert.strictEqual(searchRemoveAlt('', 'review:'), '');
  assert.strictEqual(searchRemoveAlt('review:', ''), 'review:');
});

test('an alternative is removed whole, never in part: a term inside a longer alternative stays', () => {
  assert.strictEqual(searchRemoveAlt('review: assignee:@afk | blocked:', 'review:'), 'review: assignee:@afk | blocked:');
  assert.strictEqual(searchRemoveAlt('tags:uikit | review:', 'tags:ui'), 'tags:uikit | review:');
});

test('a bracket and its inside are one alternative when it is taken out', () => {
  assert.strictEqual(searchRemoveAlt('(tags:ui status:doing) | blocked:', 'tags:ui status:doing'), 'blocked:');
  assert.strictEqual(searchRemoveAlt('tags:ui status:doing | blocked:', 'tags:ui status:doing'), 'blocked:');
});

test('an alternative with a | of its own is added as its parts and taken out as its parts', () => {
  const grown = searchAddAlt('review:', 'tags:ui | tags:data');
  assert.strictEqual(grown, 'review: | tags:ui | tags:data');
  assert.strictEqual(searchHasAlt(grown, 'tags:ui | tags:data'), true);
  assert.strictEqual(searchRemoveAlt(grown, 'tags:ui | tags:data'), 'review:');
});

test('asking whether the box holds an alternative', () => {
  assert.strictEqual(searchHasAlt('review: | blocked:', 'blocked:'), true);
  assert.strictEqual(searchHasAlt('review: | blocked:', 'waiting:'), false);
  assert.strictEqual(searchHasAlt('review:', 'review:'), true);
  assert.strictEqual(searchHasAlt('review: assignee:@afk', 'review:'), false, 'a longer alternative is not the one asked for');
  assert.strictEqual(searchHasAlt('', 'review:'), false);
  assert.strictEqual(searchHasAlt('review:', ''), false);
  assert.strictEqual(searchHasAlt('(tags:ui status:doing) | x', 'tags:ui   status:doing'), true, 'spacing and a bracket do not matter');
});

test('unclosed quotes and brackets never throw, and are shut where text is written after them', () => {
  assert.doesNotThrow(() => searchAddAlt('tags:"two wo', 'blocked:'));
  assert.doesNotThrow(() => searchRemoveAlt('(a | b', 'blocked:'));
  assert.doesNotThrow(() => searchHasAlt('a)', 'blocked:'));
  const grown = searchAddAlt('title:"two wo', 'blocked:');
  assert.deepStrictEqual(parseSearchQuery(grown)[0].alts.map((alt) => alt.length), [1, 1], 'the half-typed quote does not swallow the alternative');
});

// --- a pick writes terms: Space on a hovered card and Explore's Path and Tree ---------------------------

test('searchWithTerms replaces what the box held but for its run of slices, and keeps the slices where they were', () => {
  assert.strictEqual(searchWithTerms('', 'dlinks:12 | hlinks:12', false), 'dlinks:12 | hlinks:12');
  assert.strictEqual(searchWithTerms('tags:ui zephyr', 'dlinks:12 | hlinks:12', false), 'dlinks:12 | hlinks:12');
  assert.strictEqual(searchWithTerms('tags:ui slice:goal', 'dlinks:12', false), 'dlinks:12 slice:goal');
  assert.strictEqual(searchWithTerms('slice:goal', 'dlinks:12', false), 'dlinks:12 slice:goal', 'a box holding only a cut takes the terms beside it');
});

test('with add the terms join what the box holds as more alternatives, an empty box takes them as a plain write does', () => {
  assert.strictEqual(searchWithTerms('dlinks:12 | hlinks:12', 'dlinks:7 | hlinks:7', true), 'dlinks:12 | hlinks:12 | dlinks:7 | hlinks:7');
  assert.strictEqual(searchWithTerms('tags:ui', 'dlinks:12', true), 'tags:ui | dlinks:12');
  assert.strictEqual(searchWithTerms('', 'dlinks:12 | hlinks:12', true), searchWithTerms('', 'dlinks:12 | hlinks:12', false));
  assert.strictEqual(searchWithTerms('slice:goal', 'dlinks:12', true), searchWithTerms('slice:goal', 'dlinks:12', false), 'a cut alone is no query to add to');
  assert.strictEqual(searchWithTerms('tags:ui slice:goal', 'dlinks:12', true), '(tags:ui | dlinks:12) slice:goal', 'the cut stays, beside the bracketed alternatives');
});

test('adding terms the box already holds changes nothing', () => {
  assert.strictEqual(searchWithTerms('dlinks:12 | hlinks:12', 'dlinks:12 | hlinks:12', true), 'dlinks:12 | hlinks:12');
  assert.strictEqual(searchWithTerms('hlinks:12 | dlinks:12', 'dlinks:12 | hlinks:12', true), 'hlinks:12 | dlinks:12');
});
