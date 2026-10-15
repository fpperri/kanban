'use strict';
// The keys a page script's handlers read, found in its source: what hotkeys-coverage.test.js
// holds the Hotkeys list to. Not a test file (the suite runs *.test.js only).
//
// A key is read where the source compares an event's `key` with a literal (`e.key !== '/'`,
// `e.key.toLowerCase() === 'n'`, `'x' === e.key`), tests it against a literal array
// (`['[', ']'].includes(e.key)`), or names it in a constant list of keys (`const SLICE_RUN_KEYS
// = ['[', ']']`). A bare `key` compared with a literal counts only in a file that reads an
// event's key somewhere, which is how save-hotkey.js and search-hotkey.js read theirs (the
// search module's `key === 'slice'` names a field, and the file reads no event). A handler that
// reads its key some other way (a `switch` on it, a lookup table) is not seen, and a key
// added that way is a gap in this scan, not in the list.

const EVENT = String.raw`\b(?:e|ev|event|evt|chord)\.key`;
const LITERAL = String.raw`'((?:[^'\\]|\\.)*)'`;
const COMPARE = String.raw`\s*(?:===|!==)\s*`;

// `typeof chord.key === 'string'` asks about the type, not the key.
const FORMS = [
  new RegExp(`(?<!typeof\\s+)${EVENT}(?:\\.toLowerCase\\(\\))?${COMPARE}${LITERAL}`, 'g'),
  new RegExp(`${LITERAL}${COMPARE}${EVENT}\\b`, 'g'),
];
const BARE = new RegExp(`(?<![.\\w$])key${COMPARE}${LITERAL}`, 'g');
const ARRAY = String.raw`\[((?:\s*'(?:[^'\\]|\\.)*'\s*,?)*)\s*\]`;
const ARRAY_TEST = new RegExp(`${ARRAY}\\.includes\\(\\s*(?:e|ev|event|evt)\\.key`, 'g');
// A constant named ..._KEYS (SLICE_RUN_KEYS); the Hotkeys list itself, HOTKEYS, is not one.
const KEY_LIST = new RegExp(`\\bconst\\s+[A-Z0-9]+(?:_[A-Z0-9]+)*_KEYS\\s*=\\s*${ARRAY}`, 'g');
const ELEMENTS = /'((?:[^'\\]|\\.)*)'/g;

const unescape = (text) => text.replace(/\\(.)/g, '$1');

// Letters are read whatever their case (the handlers lower-case them), every other key as it is.
const readKey = (key) => (key.length === 1 ? key.toLowerCase() : key);

// The keys one script's source reads, as a Set.
function keysRead(source) {
  const keys = new Set();
  const add = (text) => keys.add(readKey(unescape(text)));
  for (const form of FORMS) for (const m of source.matchAll(form)) add(m[1]);
  if (new RegExp(EVENT).test(source)) for (const m of source.matchAll(BARE)) add(m[1]);
  for (const list of [ARRAY_TEST, KEY_LIST]) {
    for (const m of source.matchAll(list)) for (const el of m[1].matchAll(ELEMENTS)) add(el[1]);
  }
  return keys;
}

// What the list says the page reads, as a Set in the same case rule.
function keysListed(hotkeys) {
  return new Set(hotkeys.flatMap((entry) => entry.reads.map(readKey)));
}

// The keys a source reads that the list does not name and the exemptions do not excuse.
function keysMissing(sources, hotkeys, exempt = {}) {
  const listed = keysListed(hotkeys);
  const missing = new Set();
  for (const source of sources) {
    for (const key of keysRead(source)) if (!listed.has(key) && !Object.prototype.hasOwnProperty.call(exempt, key)) missing.add(key);
  }
  return [...missing].sort();
}

module.exports = { keysRead, keysListed, keysMissing };
