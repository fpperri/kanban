const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The plugin ships from plugin/: both installers copy whole folders, so a test, a screenshot or a
// sample board inside it would be installed with it. These hold the layout.

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    out.push(full);
    if (e.isDirectory()) walk(full, out);
  }
  return out;
};

test('the marketplace entry points at plugin/ and the marketplace file stays at the repo root', () => {
  const market = JSON.parse(read('.claude-plugin', 'marketplace.json'));
  assert.strictEqual(market.plugins.length, 1);
  assert.strictEqual(market.plugins[0].source, './plugin');
  assert.ok(fs.existsSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json')));
  assert.ok(!fs.existsSync(path.join(root, '.claude-plugin', 'plugin.json')));
  assert.strictEqual(JSON.parse(read('plugin', '.claude-plugin', 'plugin.json')).skills, './skills/');
});

test('plugin/ holds the four skills and nothing a test, a doc or a sample board owns', () => {
  const inside = walk(path.join(root, 'plugin')).map((p) => path.relative(path.join(root, 'plugin'), p).split(path.sep).join('/'));
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'plugin', 'skills')).sort(), ['artifact', 'kanban', 'snapshot', 'web']);
  for (const name of ['artifact', 'kanban', 'snapshot', 'web']) assert.ok(inside.includes(`skills/${name}/SKILL.md`), name);
  const offenders = inside.filter((p) => /(^|\/)(test|tests|docs|examples)$/.test(p) || /\.test\.js$/.test(p) || /(^|\/)fixture[\w-]*$/.test(p));
  assert.deepStrictEqual(offenders, []);
});

test('the repo tracks exactly four SKILL.md files, so the skills installer lists four skills and no fixture', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/);
  const found = tracked.filter((f) => f.toLowerCase().endsWith('skill.md'));
  assert.deepStrictEqual(found.sort(), ['plugin/skills/artifact/SKILL.md', 'plugin/skills/kanban/SKILL.md', 'plugin/skills/snapshot/SKILL.md', 'plugin/skills/web/SKILL.md']);
});

test('the tests, the docs and the examples sit outside plugin/', () => {
  for (const dir of [['test', 'web'], ['test', 'snapshot'], ['docs'], ['examples', 'demo-board']]) {
    assert.ok(fs.existsSync(path.join(root, ...dir)), dir.join('/'));
  }
  assert.ok(!fs.existsSync(path.join(root, 'skills')), 'no skills/ folder is left at the repo root');
});
