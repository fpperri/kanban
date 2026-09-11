const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- tree:/path: dependency-focus parity ------------------------------------
// The feature started web-only; cli reached parity via scoped "Dependencies
// tree/path for #id" Mermaid views and the snapshot via tree:/path: search terms
// plus card-sheet tap actions. The two parity docs (CONTEXT.md's "Surfaces and
// parity" table and skills/cli/SKILL.md's "Parity with kanban-web" section)
// both carry an explicit "a feature added to one editor lands in the other, or
// gets a line in this table saying why not" commitment. Guard that both docs
// (a) still describe tree:/path: as mirrored in cli AND the snapshot, and (b) do
// not describe the snapshot as pending/not-yet-mirrored, so a reader trusting
// either doc doesn't conclude the snapshot still lacks the feature.

const repoRoot = path.join(__dirname, '..', '..', '..');
const contextDoc = fs.readFileSync(path.join(repoRoot, 'CONTEXT.md'), 'utf8');
const cliSkill = fs.readFileSync(path.join(repoRoot, 'skills', 'cli', 'SKILL.md'), 'utf8');
const stalePendingSnapshot = /(not yet mirrored|still pending)[^.]*snapshot|snapshot[^.]*(not yet mirrored|still pending)/i;

test('CONTEXT.md parity table notes tree:/path: mirrored in cli and the snapshot, not pending', () => {
  assert.match(contextDoc, /tree:[\s\S]{0,200}path:[\s\S]{0,400}mirrored/);
  assert.match(contextDoc, /mirrored[\s\S]{0,400}snapshot/i);
  assert.doesNotMatch(contextDoc, stalePendingSnapshot);
});

test('skills/cli/SKILL.md parity section notes tree:/path: mirrored in cli and the snapshot, not pending', () => {
  assert.match(cliSkill, /tree:[\s\S]{0,200}path:[\s\S]{0,400}mirror/);
  assert.match(cliSkill, /snapshot/i);
  assert.doesNotMatch(cliSkill, stalePendingSnapshot);
});
