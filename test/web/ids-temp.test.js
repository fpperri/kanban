const { test } = require('node:test');
const assert = require('node:assert');
const ids = require('../../plugin/skills/web/web/ids');

// A temporary id (`n1`, `n2`, ...) is what a page that carries its board gives a card or group made in
// it, until the board allocates the real one. It never looks like a real id: real ids start with a
// capital, an underscore or a digit.

test('a temporary id reads as an id whose prefix is n', () => {
  assert.deepStrictEqual(ids.parseId('n1'), { prefix: 'n', number: 1 });
  assert.deepStrictEqual(ids.parseId('n0012'), { prefix: 'n', number: 12 });
  assert.strictEqual(ids.idKey('n7'), 'n7');
  assert.strictEqual(ids.formatId('n7', 4), 'n0007');
});

test('isTempId is true for a temporary id and for nothing a board allocates', () => {
  for (const t of ['n1', 'n20', 'n0003']) assert.strictEqual(ids.isTempId(t), true, t);
  for (const r of ['1', '7', 'G3', '_12', 'DW845', 'n', 'N1', 'nn1', 'n1a', 'n-1', ' n1', '', null, undefined, 12]) assert.strictEqual(ids.isTempId(r), false, String(r));
});

test('temporary ids sort after every real id, by number', () => {
  assert.deepStrictEqual(ids.sortIds(['n2', '7', 'n1', 'G3', '_4']), ['7', 'G3', '_4', 'n1', 'n2']);
});

test('ID_SOURCE matches a temporary id and keeps its groups out of the way', () => {
  const re = new RegExp(`^/api/cards/(${ids.ID_SOURCE})(/archive)?$`);
  assert.deepStrictEqual(re.exec('/api/cards/n3/archive').slice(1), ['n3', '/archive']);
  assert.deepStrictEqual(re.exec('/api/cards/G3').slice(1), ['G3', undefined]);
  assert.strictEqual(re.exec('/api/cards/x3'), null);
});

test('a mention does not read a temporary id: it is no id a text can name', () => {
  assert.deepStrictEqual(ids.findMentions('see #n1 and #7').map((m) => m.match), ['#7']);
});
