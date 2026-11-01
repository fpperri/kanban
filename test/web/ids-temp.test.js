const { test } = require('node:test');
const assert = require('node:assert');
const ids = require('../../plugin/skills/web/web/ids');

// A temporary id (`n1`, `n2`, ...) is what a page that carries its board gives a card or group made in it,
// until the board allocates the real one. It never looks like a real id: real ids start with a capital, an
// underscore or a digit. It is no id unless the page asks (acceptTempIds), so the Snapshot, which embeds this
// module and keeps its own n1, n2, ..., reads it as it always did.

const accepting = (fn) => () => {
  ids.acceptTempIds(true);
  try { fn(); } finally { ids.acceptTempIds(false); }
};

test('by default a temporary id is text that is no id, and isTempId alone tells it', () => {
  assert.strictEqual(ids.parseId('n1'), null);
  assert.strictEqual(ids.idKey('n1'), null);
  assert.strictEqual(ids.parseId({ prefix: 'n', number: 1 }), null);
  assert.strictEqual(new RegExp(`^${ids.ID_SOURCE}$`).test('n1'), false);
  assert.strictEqual(ids.isTempId('n1'), true);
  assert.strictEqual(ids.tempNumber('n12'), 12);
});

test('isTempId is true for a temporary id and for nothing a board allocates, and tempNumber follows it', () => {
  for (const t of ['n1', 'n20', 'n0003']) assert.strictEqual(ids.isTempId(t), true, t);
  for (const r of ['1', '7', 'G3', '_12', 'DW845', 'N1', 'n', 'nn1', 'n1a', 'n-1', ' n1', '', null, undefined, 12]) {
    assert.strictEqual(ids.isTempId(r), false, String(r));
    assert.strictEqual(ids.tempNumber(r), null, String(r));
  }
});

test('once a page accepts temporary ids, one reads as an id whose prefix is n', accepting(() => {
  assert.deepStrictEqual(ids.parseId('n1'), { prefix: 'n', number: 1 });
  assert.deepStrictEqual(ids.parseId('n0012'), { prefix: 'n', number: 12 });
  assert.deepStrictEqual(ids.parseId({ prefix: 'n', number: 3 }), { prefix: 'n', number: 3 });
  assert.strictEqual(ids.idKey('n7'), 'n7');
  assert.strictEqual(ids.formatId('n7', 4), 'n0007');
}));

test('accepting temporary ids changes no real id and still refuses what is no id', accepting(() => {
  assert.deepStrictEqual(ids.parseId('G3'), { prefix: 'G', number: 3 });
  assert.deepStrictEqual(ids.parseId('7'), { prefix: '', number: 7 });
  for (const bad of ['n', 'nn1', 'n1a', 'n-1', ' n1', 'g3', 'x3']) assert.strictEqual(ids.parseId(bad), null, bad);
}));

test('temporary ids sort after every real id, by number', accepting(() => {
  assert.deepStrictEqual(ids.sortIds(['n2', '7', 'n1', 'G3', '_4']), ['7', 'G3', '_4', 'n1', 'n2']);
}));

test('ID_SOURCE matches a temporary id only while they are accepted, and keeps its groups out of the way', () => {
  const re = () => new RegExp(`^/api/cards/(${ids.ID_SOURCE})(/archive)?$`);
  assert.strictEqual(re().exec('/api/cards/n3/archive'), null);
  ids.acceptTempIds(true);
  try {
    assert.deepStrictEqual(re().exec('/api/cards/n3/archive').slice(1), ['n3', '/archive']);
    assert.deepStrictEqual(re().exec('/api/cards/G3').slice(1), ['G3', undefined]);
    assert.strictEqual(re().exec('/api/cards/x3'), null);
  } finally { ids.acceptTempIds(false); }
  assert.strictEqual(re().exec('/api/cards/n3'), null);
});

test('a mention does not read a temporary id, accepted or not: it is no id a text can name', accepting(() => {
  assert.deepStrictEqual(ids.findMentions('see #n1 and #7').map((m) => m.match), ['#7']);
}));
