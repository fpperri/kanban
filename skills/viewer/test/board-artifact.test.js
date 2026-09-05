const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Card #239: the Viewer is delivered as the board's Board artifact — one
// hosted page per board, refreshed in place. These are static text checks
// (no DOM, no Python execution) confirming the naming and the pointer to
// the reference procedure survive edits.

const buildSrc = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'build_editor.py'),
  'utf8'
);
const skillSrc = fs.readFileSync(
  path.join(__dirname, '..', 'SKILL.md'),
  'utf8'
);

test('page <title> template names it the Kanban Viewer', () => {
  assert.match(buildSrc, /<title>[^<]*— Kanban Viewer<\/title>/);
});

test('header chrome labels the base stamp "viewer · base:"', () => {
  assert.ok(
    buildSrc.includes('viewer · base:'),
    'expected the header span text "viewer · base:" in build_editor.py'
  );
});

test('SKILL.md points at the board-artifact reference', () => {
  assert.ok(
    skillSrc.includes('references/board-artifact.md'),
    'expected skills/viewer/SKILL.md to mention references/board-artifact.md'
  );
});
