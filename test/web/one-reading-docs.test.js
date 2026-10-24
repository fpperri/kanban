const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web docs and the kanban skill say that a folder two placeholders of a path both name is
// read once, as the kind its id says; path-one-reading.test.js holds the behaviour.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const webDocs = flat(read('docs', 'web.md'));
const kanbanSkill = flat(read('skills', 'kanban', 'SKILL.md'));

test('the web docs say a folder both placeholders could name is read once, as the kind its id says', () => {
  assert.match(webDocs, /With `<iteration>` and `<card>` side by side, a folder both could name \(`work\/0007\.fix-login`, a card's folder with no iteration\) is read once, as the kind its id says: an iteration's id makes it the iteration's, a card's or a group's makes it the card's\./);
});

test('the kanban skill says the same folder is read once, as a card\'s folder when its id is a card\'s or a group\'s', () => {
  assert.match(kanbanSkill, /With `<iteration>` and `<card>` side by side, one folder can be named two ways \(`work\/0007\.fix-login` is a card's folder with no iteration, and could be read as an iteration's\): it is one folder, so read its files once, as a card's folder when its id is a card's or a group's and not an iteration's\./);
});
