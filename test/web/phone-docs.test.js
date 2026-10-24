const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The phone layout and its words, pinned in the docs: docs/web.md and GLOSSARY.md say them
// in the glossary's words, and SKILL.md says which desktop controls the phone leaves out.

const root = path.join(__dirname, '..', '..');
const flat = (s) => s.replace(/\s+/g, ' ');
const docs = flat(fs.readFileSync(path.join(root, 'docs', 'web.md'), 'utf8'));
const glossary = flat(fs.readFileSync(path.join(root, 'GLOSSARY.md'), 'utf8'));
const skill = flat(fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'SKILL.md'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8');

const TERMS = ['phone layout', 'status tabs', 'view bar', 'Statuses section', 'bottom sheet', 'span cycle button', 'header date'];

for (const [name, text] of [['docs/web.md', docs], ['GLOSSARY.md', glossary]]) {
  test(`${name} names every word of the phone layout`, () => {
    for (const term of TERMS) assert.ok(text.toLowerCase().includes(term.toLowerCase()), `${name} says "${term}"`);
  });
}

test('the glossary defines the phone layout under the one width line', () => {
  assert.match(glossary, /\*\*Phone layout\*\*:[^*]*760 px/);
  assert.match(glossary, /\*\*Status tabs\*\*:/);
  assert.match(glossary, /\*\*View bar\*\*:/);
  assert.match(glossary, /\*\*Bottom sheet\*\*:/);
  assert.match(glossary, /\*\*Span cycle button\*\*:/);
  assert.match(glossary, /\*\*Header date\*\*:/);
});

test('docs/web.md has a phone layout section that says what the phone does at 760 px', () => {
  assert.match(docs, /## The phone layout/);
  assert.match(docs, /below 760 px/);
});

test('SKILL.md says status tabs replace the column header below 760 px and the desktop text stays', () => {
  assert.match(skill, /status tabs replace the column header below 760 px/);
  assert.match(skill, /\*\*Collapsible columns\*\* — every column header has a collapse\/expand toggle/);
  assert.match(skill, /\*\*Per-column sorting\*\* — each \(expanded\) column header has a sort-field dropdown/);
});

test('SKILL.md says which desktop controls the phone leaves out', () => {
  const m = skill.match(/\*\*Left out on a phone\*\* — ([^\n]*?)(?= - \*\*)/);
  assert.ok(m, 'the left-out paragraph is present');
  for (const word of ['sorting', 'collapsing', 'AI-prompt add', 'selection gestures']) assert.ok(m[1].includes(word), word);
});

test('the docs name the header buttons by the words the header shows', () => {
  const labels = [...html.matchAll(/<span class="btn-label">([^<]+)<\/span>/g)].map((x) => x[1]);
  for (const word of ['Calendar', 'Gantt', 'Map view', 'Graph', 'New card', 'Refresh']) {
    assert.ok(labels.includes(word), `the header shows "${word}"`);
    assert.ok(docs.includes(word), `docs/web.md says "${word}"`);
  }
  assert.ok(docs.includes('Board view'), 'docs/web.md says "Board view"');
  assert.match(docs, /Board, Calendar, Gantt, Map and Graph/, 'the view bar lists the views');
});

test('every repository path docs/web.md names exists', () => {
  const raw = fs.readFileSync(path.join(root, 'docs', 'web.md'), 'utf8');
  const paths = new Set();
  for (const m of raw.matchAll(/`((?:plugin\/skills|docs|examples)\/[A-Za-z0-9_./-]+)`/g)) paths.add(m[1]);
  for (const m of raw.matchAll(/\]\((?!https?:|#)([^)#\s]+)/g)) paths.add(path.posix.join('docs', m[1]));
  assert.ok(paths.size > 0);
  for (const p of paths) assert.ok(fs.existsSync(path.join(root, p)), `${p} exists`);
});
