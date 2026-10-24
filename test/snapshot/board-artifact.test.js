const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Card #239: the Snapshot is delivered as the board's Board artifact — one
// hosted page per board, refreshed in place. These are static text checks of the
// generator (no DOM, no Python execution) confirming the page's naming and what
// travels in the file survive edits.

const buildSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'plugin', 'skills', 'snapshot', 'scripts', 'build_editor.py'),
  'utf8'
);

test('page <title> template names it the Kanban Snapshot', () => {
  assert.match(buildSrc, /<title>[^<]*— Kanban Snapshot<\/title>/);
});

test('header chrome labels the base stamp "snapshot · base:"', () => {
  assert.ok(
    buildSrc.includes('snapshot · base:'),
    'expected the header span text "snapshot · base:" in build_editor.py'
  );
});

// An archived card's body travels in the file, capped rather than stripped, so a file built from a board
// is a full text extract of it up to the cap.
test('the generator still caps rather than strips archived bodies', () => {
  assert.match(buildSrc, /c\["body"\] = c\["body"\]\[:1500\]/,
    'archived body handling changed');
});
