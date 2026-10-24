const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read } = require('./helpers/doc-text');

// A path in a doc is copied into a shell, a link or a file picker. Every doc that names a path of the
// repo names one that is there: a file in backticks that starts in one of the repo's folders, and the
// target of every Markdown link. A path written for the installed plugin (`skills/web/web/search.js`,
// from the plugin's folder) or for a skill's own folder (`scripts/migrate_epic_to_type.sh`, in the
// kanban skill) is looked up from there too. The ADRs are history and say what the layout was then.

const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));

const DOCS = [
  'README.md', 'GLOSSARY.md', 'SECURITY.md',
  ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`),
  ...walk('plugin').filter((f) => f.endsWith('.md')),
].filter((f) => fs.existsSync(path.join(ROOT, f)));

const FOLDERS = ['plugin', 'skills', 'docs', 'examples', 'test', 'scripts', 'references', 'web', '.github', '.claude-plugin'];
const FILE = new RegExp(String.raw`\`((?:${FOLDERS.map((f) => f.replace('.', '\\.')).join('|')})/(?:[\w.-]+/)*[\w.-]+\.(?:js|py|sh|md|yaml|yml|json|html|css|png|jpg))\``, 'g');
const LINK = /\]\((?!https?:|mailto:|#)([^)#\s]+\.(?:md|png|jpg|js|py|sh|json|ya?ml|html))/g;

function pathsIn(file) {
  const text = read(file);
  const found = [];
  for (const m of text.matchAll(FILE)) if (!/[<>*{}$]/.test(m[1])) found.push({ from: 'root', path: m[1] });
  for (const m of text.matchAll(LINK)) found.push({ from: 'doc', path: m[1] });
  return found;
}

function candidates(file, found) {
  if (found.from === 'doc') return [path.posix.join(path.posix.dirname(file), found.path)];
  const skill = /^plugin\/skills\/([^/]+)\//.exec(file);
  return [found.path, `plugin/${found.path}`, ...(skill ? [`plugin/skills/${skill[1]}/${found.path}`] : [])];
}

test('the docs are found, and they name paths', () => {
  assert.ok(DOCS.includes('README.md') && DOCS.includes('docs/web.md') && DOCS.includes('docs/testing.md'));
  assert.ok(DOCS.some((f) => f.endsWith('SKILL.md')) && DOCS.some((f) => f.includes('/references/')));
  assert.ok(DOCS.flatMap((f) => pathsIn(f)).length >= 40, 'the scan finds the paths the docs name');
});

test('every repository path a doc names exists, from the repo, from the plugin or from the skill the doc belongs to', () => {
  const missing = [];
  for (const file of DOCS) {
    for (const found of pathsIn(file)) {
      if (!candidates(file, found).some((c) => fs.existsSync(path.join(ROOT, c)))) missing.push(`${file} -> ${found.path}`);
    }
  }
  assert.deepStrictEqual(missing, []);
});

test('the scan reads a path in backticks and a link, and leaves a placeholder and a board path alone', () => {
  const sample = 'See `docs/web.md`, `plugin/skills/<name>/SKILL.md`, `archived/notifications.md` and [the guide](web.md#top).';
  assert.deepStrictEqual([...sample.matchAll(FILE)].map((m) => m[1]).filter((p) => !/[<>*{}$]/.test(p)), ['docs/web.md']);
  assert.deepStrictEqual([...sample.matchAll(LINK)].map((m) => m[1]), ['web.md']);
});
