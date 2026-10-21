const { test } = require('node:test');
const assert = require('node:assert');
const { searchEnterKeyGoes, searchEnterTarget, searchEnterOpens, searchEnterPan } = require('../web/search-enter');

// Enter in the search box goes to the first match; a second Enter on that card opens it when it
// was the only match. The decisions are here; app.js does the focus, the scroll and the pan.

const plain = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, repeat: false, defaultPrevented: false };

test('a plain Enter with the suggestion list closed goes to the match', () => {
  assert.strictEqual(searchEnterKeyGoes(plain, { menuHidden: true }), true);
});

test('Enter does not go while the suggestion list is open or took the key', () => {
  assert.strictEqual(searchEnterKeyGoes(plain, { menuHidden: false }), false);
  assert.strictEqual(searchEnterKeyGoes({ ...plain, defaultPrevented: true }, { menuHidden: true }), false);
});

test('Enter does not go with a modifier, while composing, on a repeat, or for another key', () => {
  for (const change of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }, { key: 'a' }]) {
    assert.strictEqual(searchEnterKeyGoes({ ...plain, ...change }, { menuHidden: true }), false, JSON.stringify(change));
  }
});

test('the target is the first card in reading order that the query matches', () => {
  assert.strictEqual(searchEnterTarget(['7', '3', '9'], new Set(['9', '3'])), '3');
});

test('a card listed twice, or matches off the page, change nothing', () => {
  assert.strictEqual(searchEnterTarget(['4', '4', '5'], new Set(['5', '4'])), '4');
  assert.strictEqual(searchEnterTarget(['1', '2'], new Set(['8'])), null);
});

test('no matches, or no query, give no target', () => {
  assert.strictEqual(searchEnterTarget(['1', '2'], new Set()), null);
  assert.strictEqual(searchEnterTarget(['1', '2'], null), null);
});

test('a second Enter opens the card only when it is the one match', () => {
  assert.strictEqual(searchEnterOpens(new Set(['12']), '12'), true);
  assert.strictEqual(searchEnterOpens(new Set([12]), '12'), true);
  assert.strictEqual(searchEnterOpens(new Set(['12', '13']), '12'), false);
  assert.strictEqual(searchEnterOpens(new Set(['12']), '13'), false);
  assert.strictEqual(searchEnterOpens(null, '12'), false);
});

test('the pan puts a dot in the middle of the stage and keeps the zoom', () => {
  assert.deepStrictEqual(searchEnterPan({ x: 5, y: 6, k: 2 }, { x: 100, y: 50 }, 800, 600), { x: 200, y: 200, k: 2 });
});
