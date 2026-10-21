const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The docs say what ADR 0019 decided: `logbook:` and `scratchpad:` may hold `<iteration>`, which stands for
// the iteration's folder, named as its group file is, matched by the id at its front. The rules live in
// iteration-folders.js and are tested there; these tests pin that the places a person or an agent reads say
// them, and agree.

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');

const docs = flat(read('docs', 'web.md'));
const webSkill = flat(read('skills', 'web', 'SKILL.md'));
const kanbanSkill = flat(read('skills', 'kanban', 'SKILL.md'));
const readme = flat(read('README.md'));

test('every doc names the placeholder and the group file name the folder takes', () => {
  for (const [where, text] of [['the web doc', docs], ['the web skill', webSkill], ['the kanban skill', kanbanSkill]]) {
    assert.match(text, /`<iteration>`/, where);
    assert.match(text, /0005\.sprint-496/, `${where}: the folder is named as the group file is`);
  }
});

test('the kanban skill tells an agent where a note and a page go, and that nothing moves a file', () => {
  assert.match(kanbanSkill, /the iteration whose dates hold the note's day/);
  assert.match(kanbanSkill, /started first/);
  assert.match(kanbanSkill, /a note aimed at an iteration goes to that iteration's folder/);
  assert.match(kanbanSkill, /the iteration its card or group is a member of/);
  assert.match(kanbanSkill, /the segment is dropped/);
  assert.match(kanbanSkill, /read and edited where it is/);
  assert.match(kanbanSkill, /id at the front of its name/);
});

test('the web doc and skill say reading covers every folder and the gear shows the folder a write goes to today', () => {
  for (const [where, text] of [['the web doc', docs], ['the web skill', webSkill]]) {
    assert.match(text, /every folder the path can name/, where);
    assert.match(text, /a new write goes to today/, where);
  }
});

test('the web skill says what a note\'s file and a page\'s folder read when the path holds the placeholder', () => {
  assert.match(webSkill, /`file` then reads `<iteration folder>\/<day file>`/);
  assert.match(webSkill, /`folder`, the path with the segment filled in/);
});

test('the README names the placeholder beside the lines that switch the folders on', () => {
  assert.match(readme, /`<iteration>`/);
  assert.match(readme, /0005.sprint-496/);
});
