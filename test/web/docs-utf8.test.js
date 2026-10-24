const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');

const markdownIn = (dir) => {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : markdownIn(rel);
    return e.name.endsWith('.md') ? [rel] : [];
  });
};

const docs = ['README.md', 'GLOSSARY.md', ...markdownIn('docs'), ...markdownIn('skills')].filter((f) => fs.existsSync(path.join(root, f)));

test('every doc decodes as strict UTF-8', () => {
  assert.ok(docs.some((f) => f.endsWith('SKILL.md')), 'the skill docs are covered');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const f of docs) {
    assert.doesNotThrow(() => decoder.decode(fs.readFileSync(path.join(root, f))), `${f} is not valid UTF-8`);
  }
});
