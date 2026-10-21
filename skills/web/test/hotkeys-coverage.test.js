const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOTKEYS } = require('../web/hotkeys');
const { keysRead, keysListed, keysMissing } = require('./helpers/key-reads');

// The Hotkeys list has to name every key the page answers. The keys the handlers read are
// found in the scripts' own source (helpers/key-reads.js), so a handler added for a new key
// fails here until the list (hotkeys.js) has an entry for it, and an entry for a key no
// handler reads fails too, so the list never promises what the page does not do.

const WEB = path.join(__dirname, '..', 'web');
const sources = fs.readdirSync(WEB).filter((f) => f.endsWith('.js')).sort()
  .map((file) => ({ file, text: fs.readFileSync(path.join(WEB, file), 'utf8') }));

// Keys the page reads that are not hotkeys, and why: a key of one control's own list, and a
// modifier that is only noted as held.
const NOT_HOTKEYS = {
  ArrowDown: 'moves the highlight in the search box\'s list of suggestions',
  ArrowUp: 'moves the highlight in the search box\'s list of suggestions',
  Shift: 'noted as held, so a card shows what a Shift click would add',
  Backspace: 'clears the notes palette\'s subject chip when its note box is empty',
};

// --- the scan reads the forms the page's handlers are written in ----------------------------------

test('the scan sees a key compared with a literal, in either order, with or without lower-casing', () => {
  const src = [
    "if (e.key !== '/') return;",
    "if (!e.key || e.key.toLowerCase() !== 'p') return;",
    "if (event.key === 'Escape') {}",
    "if ('Enter' === e.key) {}",
    "const x = e.key === ' ';",
  ].join('\n');
  assert.deepStrictEqual([...keysRead(src)].sort(), [' ', '/', 'Enter', 'Escape', 'p']);
});

test('the scan sees a literal array tested against the key and a constant list of keys', () => {
  assert.deepStrictEqual([...keysRead("if (['[', ']'].includes(e.key)) {}")].sort(), ['[', ']']);
  assert.deepStrictEqual([...keysRead("const SLICE_RUN_KEYS = ['[', ']', '{', '}'];")].sort(), ['[', ']', '{', '}']);
});

test('the scan reads a bare key only in a file that takes it from an event\'s key, and reads letters whatever their case', () => {
  const hotkey = "const key = typeof chord.key === 'string' ? chord.key.toLowerCase() : '';\nif (key !== 'S') return null;";
  assert.deepStrictEqual([...keysRead(hotkey)], ['s']);
  assert.deepStrictEqual([...keysRead("if (key === 'slice') return 1;")], [], 'a field name in a file with no event is not a key');
  const option = ["if (e.key === 'Enter') open();", 'function setOption(key, value) {', "  if (key === 'unnested') renderBoard();", '}'].join(String.fromCharCode(10));
  assert.deepStrictEqual([...keysRead(option)], ['Enter'], 'the name of an option in a file that also reads an event is not a key');
});

test('a source that reads no key gives none', () => {
  assert.deepStrictEqual([...keysRead('const a = 1; if (b.key === c) {}')], []);
});

// --- the list holds every key the page reads ------------------------------------------------------

test('every key a page script reads is in the Hotkeys list, but the keys that are not hotkeys', () => {
  const missing = keysMissing(sources.map((s) => s.text), HOTKEYS, NOT_HOTKEYS);
  assert.deepStrictEqual(missing, [], `the page reads ${missing.map((k) => JSON.stringify(k)).join(', ')} and hotkeys.js has no entry for it`);
});

test('a key the page reads and the list lacks is reported: drop an entry from the list, or add a handler', () => {
  const without = (id) => HOTKEYS.filter((entry) => entry.id !== id);
  const texts = sources.map((s) => s.text);
  assert.deepStrictEqual(keysMissing(texts, without('names'), NOT_HOTKEYS), ['l']);
  assert.deepStrictEqual(keysMissing(texts, without('note'), NOT_HOTKEYS), ['n']);
  assert.deepStrictEqual(keysMissing(texts, without('note-row'), NOT_HOTKEYS), ['a'], 'e and d are still listed: they are Ctrl+E and Ctrl+Shift+D too');
  assert.deepStrictEqual(keysMissing(texts, without('slice'), NOT_HOTKEYS), ['[', ']', '{', '}'].sort());
  assert.deepStrictEqual(keysMissing(texts, without('find'), NOT_HOTKEYS), ['f']);
  assert.deepStrictEqual(keysMissing(texts, without('hotkeys'), NOT_HOTKEYS), ['?']);
  assert.deepStrictEqual(keysMissing([...texts, "if (e.key === 'x') {}"], HOTKEYS, NOT_HOTKEYS), ['x']);
  assert.deepStrictEqual(keysMissing([...texts, "if (e.key.toLowerCase() === 'X') {}"], HOTKEYS, NOT_HOTKEYS), ['x']);
});

test('an exemption is a key the page reads: none is left over after a handler goes', () => {
  const read = new Set(sources.flatMap((s) => [...keysRead(s.text)]));
  assert.deepStrictEqual(Object.keys(NOT_HOTKEYS).filter((key) => !read.has(key)), []);
});

test('every key the list names is read by some page script', () => {
  const read = new Set(sources.flatMap((s) => [...keysRead(s.text)]));
  const unread = [...keysListed(HOTKEYS)].filter((key) => !read.has(key));
  assert.deepStrictEqual(unread, [], 'the list names a key no handler reads');
});

test('the Hotkeys list is not one of the exemptions', () => {
  const listed = keysListed(HOTKEYS);
  assert.deepStrictEqual(Object.keys(NOT_HOTKEYS).filter((key) => listed.has(key)), []);
});
