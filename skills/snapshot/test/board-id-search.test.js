const { test } = require('node:test');
const assert = require('node:assert');
const { board, idsIn, open, tiles } = require('./nesting-view');

const B = board('', [[18, 'todo', 'Eighteen'], [19, 'todo', 'Nineteen'], [20, 'done', 'Twenty']]);
const shown = (page) => tiles(page).map((n) => Number(n.dataset.card)).sort((a, b) => a - b);
const search = (text) => open(B, (page) => { page.type(page.byId('q'), text); return shown(page); });

test('the board name plus an id finds that card, like #id', () => {
  assert.deepStrictEqual(search('#19'), [19]);
  assert.deepStrictEqual(search('order#19'), [19]);
});

test('the board name compares without regard to case', () => {
  assert.deepStrictEqual(search('Order#19'), [19]);
});

test('another board name keeps the plain-text behaviour and finds nothing', () => {
  assert.deepStrictEqual(search('other-board#19'), []);
});
