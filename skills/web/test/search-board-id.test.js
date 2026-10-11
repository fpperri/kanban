const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards } = require('../web/search');

const ID19 = [{ field: 'id', value: '19' }];

test('a term naming this board plus an id parses as the exact-id term', () => {
  assert.deepStrictEqual(parseSearchQuery('webapp#19', 'webapp'), ID19);
});

test('the board name compares without regard to case', () => {
  assert.deepStrictEqual(parseSearchQuery('WebApp#19', 'webapp'), ID19);
  assert.deepStrictEqual(parseSearchQuery('webapp#19', 'WebApp'), ID19);
});

test('board names with dots and hyphens work', () => {
  assert.deepStrictEqual(parseSearchQuery('webapp.core#7', 'webapp.core'), [{ field: 'id', value: '7' }]);
  assert.deepStrictEqual(parseSearchQuery('web-app#5', 'web-app'), [{ field: 'id', value: '5' }]);
});

test('a term naming another board keeps the plain-text behaviour', () => {
  assert.deepStrictEqual(parseSearchQuery('other-board#19', 'webapp'), [{ field: null, value: 'other-board#19' }]);
});

test('without a board name nothing is rewritten', () => {
  assert.deepStrictEqual(parseSearchQuery('webapp#19'), [{ field: null, value: 'webapp#19' }]);
  assert.deepStrictEqual(parseSearchQuery('webapp#19', ''), [{ field: null, value: 'webapp#19' }]);
});

test('the id part must be all digits', () => {
  assert.deepStrictEqual(parseSearchQuery('webapp#19a', 'webapp'), [{ field: null, value: 'webapp#19a' }]);
  assert.deepStrictEqual(parseSearchQuery('webapp#', 'webapp'), [{ field: null, value: 'webapp#' }]);
});

test('the name must be the whole text before the last #', () => {
  assert.deepStrictEqual(parseSearchQuery('my-webapp#19', 'webapp'), [{ field: null, value: 'my-webapp#19' }]);
});

test('other terms still AND with the board-id term and filtering shows only that card', () => {
  const cards = [{ id: 19, title: 'a' }, { id: 20, title: 'b' }];
  const terms = parseSearchQuery('WebApp#19', 'webapp');
  assert.deepStrictEqual(filterCards(cards, terms).map((c) => c.id), [19]);
});

test('the live search box hands the board name to the parser', () => {
  const js = require('node:fs').readFileSync(require('node:path').join(__dirname, '../web/app.js'), 'utf8');
  const fn = js.match(/function currentSearchTerms\([\s\S]*?\n\}/)[0];
  assert.match(fn, /parseSearchQuery\([^)]*state\.projectName\)/);
});
