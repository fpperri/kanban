const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// dlinks: and hlinks: name a card's direct neighbours, beside the four Explore sets. The docs that name the
// search terms say what each is, that they are typed (no Explore item), and the snapshot knows them.

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
const webDoc = read('docs', 'web.md');
const webSkill = read('plugin', 'skills', 'web', 'SKILL.md');
const snapshotSkill = read('plugin', 'skills', 'snapshot', 'SKILL.md');
const crossHarness = read('docs', 'cross-harness.md');
const glossary = read('GLOSSARY.md');

test('docs/web.md says what the two terms are, that they are typed, and which cards they leave out', () => {
  assert.match(webDoc, /`dlinks:<id>` is the card, what it waits for and what waits on it, one hop over `waiting_for` both ways/);
  assert.match(webDoc, /`hlinks:<id>` is the card, its parent on this board and its children, one hop over `parent`/);
  assert.match(webDoc, /have no Explore item; you type them./);
  assert.doesNotMatch(webDoc, /pick them from the box's suggestions/);
  assert.match(webDoc, /an unknown id matches nothing, a parent on another board, a missing one and a self-link are no link, and archived cards count, as in the four sets above/);
});

test('the web skill lists the two terms with the four, one hop and typed only', () => {
  assert.match(webSkill, /`dlinks:<id>`\/`hlinks:<id>` \(`#` optional\) are a card's direct neighbours, one hop and no further/);
  assert.match(webSkill, /`dlinks:` the card, what it waits for and what waits on it, `hlinks:` the card, its parent on this board and its children \(typed terms, no Explore item\)/);
});

test('the snapshot skill says its search knows the two and its sheet and menu offer no item for them', () => {
  assert.match(snapshotSkill, /`dlinks:<id>`\/`hlinks:<id>` \(`#`-tolerant\) are a card's direct neighbours, one hop/);
  assert.match(snapshotSkill, /The search knows them as kanban-web's does; the sheet and the card menu offer no item for them/);
});

test('the glossary names the two beside the Explore sets, search terms only', () => {
  assert.match(glossary, /Two smaller sets sit beside them as search terms only, with no menu item: `dlinks:` is the card, what it waits for and what waits on it, and `hlinks:` is the card, its parent and its children, one hop each and no further/);
});

test('the cross-harness note says the Explore sets module also serves the two terms, not only the four', () => {
  assert.match(crossHarness, /and its `dlinks:` and `hlinks:` terms \(`skills\/web\/web\/explore-sets\.js`\)/);
  assert.doesNotMatch(crossHarness, /`dtree:`\s*terms read \(`skills/);
});
