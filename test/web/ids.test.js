const { test } = require('node:test');
const assert = require('node:assert');
const ids = require('../../plugin/skills/web/web/ids');
const cases = require('./ids-cases.json');

// The id rule (ADR 0014) is one table of cases, test/web/ids-cases.json. The
// snapshot's Python copy runs the same table, so the two cannot drift. Every
// expected value in the table is written out by hand.

test('parseId reads a bare id into its prefix and number, and refuses anything else', () => {
  for (const c of cases.parse) assert.deepStrictEqual(ids.parseId(c.in), c.id, JSON.stringify(c.in));
});

test('idKey writes the whole id unpadded, the form a map key or a data attribute holds', () => {
  for (const c of cases.key) assert.strictEqual(ids.idKey(c.in), c.key, JSON.stringify(c.in));
});

test('compareIds orders by prefix first, then by number, with plain ids before prefixed ones', () => {
  for (const c of cases.compare) assert.strictEqual(Math.sign(ids.compareIds(c.a, c.b)), c.order, `${c.a} vs ${c.b}`);
});

test('sortIds returns a new list in id order and leaves its input alone', () => {
  for (const c of cases.sort) {
    const input = c.in.slice();
    assert.deepStrictEqual(ids.sortIds(input), c.out, JSON.stringify(c.in));
    assert.deepStrictEqual(input, c.in);
  }
});

test('formatId pads the number to the board digits and keeps the prefix', () => {
  for (const c of cases.format) {
    const got = c.digits === null ? ids.formatId(c.id) : ids.formatId(c.id, c.digits);
    assert.strictEqual(got, c.out, `${c.id} at ${c.digits}`);
  }
});

test('parseMention reads a whole mention, with its board when it has one', () => {
  for (const c of cases.mention) {
    const got = ids.parseMention(c.in);
    const want = c.id === null ? null : { board: c.board, id: c.id };
    assert.deepStrictEqual(got && { board: got.board, id: ids.idKey(got) }, want, JSON.stringify(c.in));
  }
});

test('findMentions lists every mention in a text, in order, and skips what only looks like one', () => {
  for (const c of cases.mentions) {
    const got = ids.findMentions(c.text).map((m) => ({ match: m.match, board: m.board, id: ids.idKey(m) }));
    assert.deepStrictEqual(got, c.found, JSON.stringify(c.text));
  }
});

test('findMentions gives each match its place in the text', () => {
  const text = 'a fpp#G3 and #7';
  const [first, second] = ids.findMentions(text);
  assert.deepStrictEqual([first.start, first.end], [2, 8]);
  assert.deepStrictEqual([second.start, second.end], [13, 15]);
  for (const m of [first, second]) assert.strictEqual(text.slice(m.start, m.end), m.match);
});

test('findMentions gives the same answer when called twice, whatever ran between', () => {
  const text = 'see #G3 and #7';
  const once = ids.findMentions(text);
  assert.strictEqual(ids.findMentions(text).length, 2);
  assert.deepStrictEqual(ids.findMentions(text), once);
});

test('the id functions take a number, a parsed id or a string alike', () => {
  assert.strictEqual(ids.idKey(7), '7');
  assert.strictEqual(ids.idKey({ prefix: 'G', number: 3 }), 'G3');
  assert.strictEqual(ids.formatId(7), '0007');
  assert.strictEqual(ids.formatId({ prefix: '_', number: 12 }, 3), '_012');
  assert.strictEqual(ids.compareIds(7, '7'), 0);
  assert.ok(ids.compareIds(7, { prefix: 'G', number: 7 }) < 0);
  assert.deepStrictEqual(ids.sortIds([10, 9]), [9, 10]);
});

test('numbers that are not ids are refused', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, 1e16, null, undefined, {}, { prefix: 'g', number: 1 }, { prefix: '', number: -2 }]) {
    assert.strictEqual(ids.parseId(bad), null, String(bad));
    assert.strictEqual(ids.idKey(bad), null, String(bad));
    assert.strictEqual(ids.formatId(bad), null, String(bad));
  }
});

test('plain ids stay plain numbers in a mixed list: #9 comes before #10, #7 before #G7', () => {
  assert.deepStrictEqual(ids.sortIds(['G7', '10', '7', 'G10', '9']), ['7', '9', '10', 'G7', 'G10']);
  assert.notStrictEqual(ids.idKey('7'), ids.idKey('G7'));
});

test('the module is a dual-environment pure module: a plain script sets window.kanbanIds', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'ids.js'), 'utf8');
  const win = {};
  new Function('window', src)(win);
  assert.strictEqual(win.kanbanIds.idKey('G0003'), 'G3');
  assert.deepStrictEqual(Object.keys(win.kanbanIds).sort(), Object.keys(ids).sort());
});
