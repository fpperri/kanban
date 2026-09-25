const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- tree:/path: dependency-focus parity ------------------------------------
// The feature started web-only; the snapshot reached parity via tree:/path:
// search terms plus card-sheet tap actions. Two parity docs (CONTEXT.md's
// "Surfaces and parity" table and skills/web/SKILL.md's Dependency tree/path
// bullet) both carry the "a feature added to one editor lands in the other, or
// gets a line in this table saying why not" commitment. Guard that both docs
// (a) still describe tree:/path: as mirrored in the snapshot and (b) do not
// describe the snapshot as pending/not-yet-mirrored, so a reader trusting
// either doc doesn't conclude the snapshot still lacks the feature.
// The second doc used to be skills/cli/SKILL.md's "Parity with kanban-web"
// section; the cli surface was retired and that file deleted.

const repoRoot = path.join(__dirname, '..', '..', '..');
const contextDoc = fs.readFileSync(path.join(repoRoot, 'CONTEXT.md'), 'utf8');
const webSkill = fs.readFileSync(path.join(repoRoot, 'skills', 'web', 'SKILL.md'), 'utf8');
const stalePendingSnapshot = /(not yet mirrored|still pending)[^.]*snapshot|snapshot[^.]*(not yet mirrored|still pending)/i;

test('CONTEXT.md parity table notes tree:/path: mirrored in the snapshot, not pending', () => {
  assert.match(contextDoc, /tree:[\s\S]{0,200}path:[\s\S]{0,400}mirrored/);
  assert.match(contextDoc, /mirrored[\s\S]{0,400}snapshot/i);
  assert.doesNotMatch(contextDoc, stalePendingSnapshot);
});

test('skills/web/SKILL.md dependency-focus bullet notes tree:/path: mirrored in the snapshot, not pending', () => {
  // Coupled on purpose: two independent existence checks would pass even if
  // the parity sentence were deleted and the phrase re-appeared elsewhere in
  // this 982-line file. The window spans the bullet, not the whole document.
  assert.match(webSkill, /`tree:<id>`[\s\S]{0,80}`path:<id>`[\s\S]{0,1400}Mirrored in the snapshot/);
  assert.doesNotMatch(webSkill, stalePendingSnapshot);
});
