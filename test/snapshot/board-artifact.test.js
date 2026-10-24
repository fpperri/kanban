const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Card #239: the Snapshot is delivered as the board's Board artifact — one
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

test('page <title> template names it the Kanban Snapshot', () => {
  assert.match(buildSrc, /<title>[^<]*— Kanban Snapshot<\/title>/);
});

test('header chrome labels the base stamp "snapshot · base:"', () => {
  assert.ok(
    buildSrc.includes('snapshot · base:'),
    'expected the header span text "snapshot · base:" in build_editor.py'
  );
});

test('SKILL.md points at the board-artifact reference', () => {
  assert.ok(
    skillSrc.includes('references/board-artifact.md'),
    'expected skills/snapshot/SKILL.md to mention references/board-artifact.md'
  );
});

// --- Delivery default (KISS) -------------------------------------------
// Publishing was briefly the default whenever the Artifact tool existed. That
// route opens with a gallery round-trip and ends at "confirm before minting",
// so it could not complete without asking — a default that mandates a
// confirmation is an opt-in wearing a default's clothes, and it charged every
// plain "build me the board" two extra turns. These pin the corrected shape so
// it cannot drift back without a test going red.

test('the delivery default is build-and-hand-over, not publish', () => {
  assert.match(
    skillSrc,
    /\*\*Delivery: build the file and hand it over\. That is the whole default\.\*\*/,
    'SKILL.md no longer states building as the delivery default',
  );
});

test('publishing is described as opt-in, gated on the human asking', () => {
  assert.match(
    skillSrc,
    /\*\*Publishing is opt-in, and only when the human actually asks for it\*\*/,
    'SKILL.md no longer gates publishing on an explicit request',
  );
});

test('the delivery step does not route to publishing merely because the tool exists', () => {
  const at = skillSrc.indexOf('**Delivery: build the file');
  assert.ok(at !== -1, 'delivery step missing');
  const step = skillSrc.slice(at, at + 1200);
  assert.doesNotMatch(
    step,
    /Artifact tool available[^.]*publish/i,
    'the delivery step again makes publishing conditional on the tool being present',
  );
});

// --- Docs must not lie about what travels in the file -------------------
// SKILL.md claimed archived bodies were "stripped" and the cards "never
// tappable". Both were false: the generator re-caps archived bodies at 1500
// characters and archived cards open a read-only sheet. That matters more than
// an ordinary doc slip, because a reader who believes bodies are stripped may
// publish the file somewhere hosted. These pin the doc against the code.
const buildSrcText = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'build_editor.py'), 'utf8');

test('the generator still caps rather than strips archived bodies', () => {
  assert.match(buildSrcText, /c\["body"\] = c\["body"\]\[:1500\]/,
    'archived body handling changed — SKILL.md says capped at 1500 and must be updated with it');
});

test('SKILL.md does not claim archived bodies are stripped', () => {
  assert.doesNotMatch(skillSrc, /bodies stripped/,
    'SKILL.md claims archived bodies are stripped; the generator caps them instead');
});

test('SKILL.md warns that bodies travel in the file', () => {
  assert.match(skillSrc, /bodies NOT stripped/,
    'the archive sentence no longer states that bodies travel in the file');
  assert.match(skillSrc, /full text extract, not a summary/,
    'the publish warning is gone — a reader could ship archived bodies unaware');
});
