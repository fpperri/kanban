'use strict';
// Reading a doc for a contract test: the repo's text with LF endings, one section of it, and the
// fenced examples in it. Not a test file (the suite runs *.test.js only).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const flat = (text) => text.replace(/\s+/g, ' ');

// The text from the first occurrence of `from` up to the next occurrence of `to` after it (the end of
// the text when `to` is left out or not found). Throws when `from` is not there, so a renamed heading
// fails the test that reads it instead of leaving it to read nothing.
function section(text, from, to) {
  const start = text.indexOf(from);
  if (start === -1) throw new Error(`no "${from}" in the text`);
  const end = to === undefined ? -1 : text.indexOf(to, start + from.length);
  return text.slice(start, end === -1 ? undefined : end);
}

// The bodies of the fenced blocks of one language, in order.
function fenced(text, lang) {
  const out = [];
  const re = new RegExp('^```' + lang + '[^\\n]*\\n([\\s\\S]*?)^```', 'gm');
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]);
  return out;
}

module.exports = { ROOT, read, flat, section, fenced };
