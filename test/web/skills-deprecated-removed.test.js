const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- skills-deprecated/ deleted, no dangling references ----------------------
// Repo-hygiene guard: the retired board/dashboard/dependencies skills were
// deleted outright (tracked deletion, recoverable via git history), so the
// folder must not resurface and the two docs that pointed at it must not
// keep dead pointers. kanban/ is excluded — card files are managed elsewhere.

const repoRoot = path.join(__dirname, '..', '..', '..');

test('skills-deprecated/ is gone from the repo root', () => {
  assert.ok(!fs.existsSync(path.join(repoRoot, 'skills-deprecated')));
});

test('GLOSSARY.md no longer points at skills-deprecated/', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'GLOSSARY.md'), 'utf8');
  assert.ok(!text.includes('skills-deprecated'));
});

test('skills/web/SKILL.md no longer points at skills-deprecated/', () => {
  const text = fs.readFileSync(path.join(repoRoot, 'skills', 'web', 'SKILL.md'), 'utf8');
  assert.ok(!text.includes('skills-deprecated'));
});
