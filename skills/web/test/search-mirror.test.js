const { test } = require('node:test');
const assert = require('node:assert');
const { searchMirrorBox, searchIsolateText } = require('../web/search');
const { cardPart, pathPart, queryPart, typedQueryPart } = require('../web/selection');

// A click on a card writes the selection into the box with isolate off (searchMirrorBox): the isolate
// text of its parts, the box's run of slices kept, and a part that is one query written as it was typed.
// Where the page writes it, and why the write is never a typed search, is pinned in
// selection-mirror-wiring.test.js.

test('a card is #id, and several parts are joined with |, as Isolate writes them', () => {
  assert.strictEqual(searchMirrorBox('', [cardPart(34)]), '#34');
  assert.strictEqual(searchMirrorBox('#34', [cardPart(34), cardPart(36)]), '#34 | #36');
  assert.strictEqual(searchMirrorBox('anything the box held', [cardPart(34), pathPart(40)]), '#34 | path:40');
});

test('a query part beside a card is the isolate text of the query: dpath:185 | #14', () => {
  assert.strictEqual(searchMirrorBox('dpath:185', [typedQueryPart('dpath:185'), cardPart(14)]), 'dpath:185 | #14');
  assert.strictEqual(searchMirrorBox('', [cardPart(14), queryPart('status:doing tags:ui')]), '#14 | (status:doing tags:ui)');
});

test('a part that is one query is written as it was typed, in no bracket', () => {
  assert.strictEqual(searchMirrorBox('', [typedQueryPart('status:doing tags:ui')]), 'status:doing tags:ui');
  assert.strictEqual(searchMirrorBox('', [queryPart('review: | blocked:')]), 'review: | blocked:');
  assert.strictEqual(searchMirrorBox('', [typedQueryPart('  dpath:185 ')]), 'dpath:185');
  assert.strictEqual(searchIsolateText([queryPart('status:doing tags:ui')]), '(status:doing tags:ui)', 'the isolate text would have bracketed it');
});

test('the run of slices the box holds is kept after the text, and a query part does not write it twice', () => {
  assert.strictEqual(searchMirrorBox('foo slice:epic..2', [cardPart(34)]), '#34 slice:epic..2');
  assert.strictEqual(searchMirrorBox('slice:epic..2', [cardPart(34), cardPart(36)]), '(#34 | #36) slice:epic..2');
  assert.strictEqual(searchMirrorBox('tags:ui slice:epic..2', [typedQueryPart('tags:ui slice:epic..2')]), 'tags:ui slice:epic..2');
  assert.strictEqual(searchMirrorBox('tags:ui slice:epic..2', [typedQueryPart('tags:ui slice:epic..2'), cardPart(34)]), '(tags:ui | #34) slice:epic..2');
});

test('an empty selection leaves the box with its run of slices alone', () => {
  assert.strictEqual(searchMirrorBox('(#34 | #36) slice:epic..2', []), 'slice:epic..2');
  assert.strictEqual(searchMirrorBox('#34', []), '');
  assert.strictEqual(searchMirrorBox('', []), '');
});

test('a part that is no term yet writes nothing, as in Isolate', () => {
  assert.strictEqual(searchMirrorBox('', [cardPart(34), typedQueryPart('status:')]), '#34');
});

test('the cut a dropped pill held in its own query goes with it, one copy only', () => {
  assert.strictEqual(searchMirrorBox('review: slice:goal', [cardPart(34)], ['review: slice:goal']), '#34');
  assert.strictEqual(searchMirrorBox('slice:goal slice:goal', [cardPart(34)], ['slice:goal']), '#34 slice:goal', 'a cut the box held before stays');
  assert.strictEqual(searchMirrorBox('slice:goal', [cardPart(34)], []), '#34 slice:goal');
  assert.strictEqual(searchMirrorBox('slice:goal', [cardPart(34)]), '#34 slice:goal');
});

test('the same selection written twice gives the same text, so a repeat click leaves the box as it was', () => {
  const parts = [cardPart(34), cardPart(36)];
  const once = searchMirrorBox('foo slice:epic..2', parts);
  assert.strictEqual(searchMirrorBox(once, parts), once);
});
