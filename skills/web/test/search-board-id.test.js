const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards } = require('../web/search');

const ID19 = [{ field: 'id', value: '19' }];

test('a term naming this board plus an id parses as the exact-id term', () => {
  assert.deepStrictEqual(parseSearchQuery('cortex-herd#19', 'cortex-herd'), ID19);
});

test('the board name compares without regard to case', () => {
  assert.deepStrictEqual(parseSearchQuery('Cortex-Herd#19', 'cortex-herd'), ID19);
  assert.deepStrictEqual(parseSearchQuery('cortex-herd#19', 'Cortex-Herd'), ID19);
});

test('board names with dots and hyphens work', () => {
  assert.deepStrictEqual(parseSearchQuery('webapp.core#7', 'webapp.core'), [{ field: 'id', value: '7' }]);
});

test('a term naming another board keeps the plain-text behaviour', () => {
  assert.deepStrictEqual(parseSearchQuery('other-board#19', 'cortex-herd'), [{ field: null, value: 'other-board#19' }]);
});

test('without a board name nothing is rewritten', () => {
  assert.deepStrictEqual(parseSearchQuery('cortex-herd#19'), [{ field: null, value: 'cortex-herd#19' }]);
  assert.deepStrictEqual(parseSearchQuery('cortex-herd#19', ''), [{ field: null, value: 'cortex-herd#19' }]);
});

test('the id part must be all digits', () => {
  assert.deepStrictEqual(parseSearchQuery('cortex-herd#19a', 'cortex-herd'), [{ field: null, value: 'cortex-herd#19a' }]);
  assert.deepStrictEqual(parseSearchQuery('cortex-herd#', 'cortex-herd'), [{ field: null, value: 'cortex-herd#' }]);
});

test('the name must be the whole text before the last #', () => {
  assert.deepStrictEqual(parseSearchQuery('my-cortex-herd#19', 'cortex-herd'), [{ field: null, value: 'my-cortex-herd#19' }]);
});

test('other terms still AND with the board-id term and filtering shows only that card', () => {
  const cards = [{ id: 19, title: 'a' }, { id: 20, title: 'b' }];
  const terms = parseSearchQuery('Cortex-Herd#19', 'cortex-herd');
  assert.deepStrictEqual(filterCards(cards, terms).map((c) => c.id), [19]);
});

test('the live search box hands the board name to the parser', () => {
  const js = require('node:fs').readFileSync(require('node:path').join(__dirname, '../web/app.js'), 'utf8');
  const fn = js.match(/function currentSearchTerms\([\s\S]*?\n\}/)[0];
  assert.match(fn, /parseSearchQuery\([^)]*state\.projectName\)/);
});
