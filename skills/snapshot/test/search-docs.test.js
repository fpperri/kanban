const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// What the snapshot skill promises about its search box, pinned so the skill
// keeps saying what the page does: it runs the web's own search module.

const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const section = /\nA search box under the header[\s\S]*?\n\n/.exec(skill);

test('the skill\'s search section names the assignee scope and its a: alias', () => {
  assert.ok(section, 'a search section');
  assert.match(section[0], /`assignee:`[^.]*`a:`/, 'assignee: and its a: alias are named together');
  assert.match(section[0], /case-insensitive substring[^.]*assignee handle/, 'and the scope says what it matches');
});

test('the skill\'s search section says the page runs the web\'s own search module', () => {
  assert.ok(section, 'a search section');
  assert.match(section[0], /skills\/web\/web\/search\.js/);
});

test('the cross-harness note says the generator needs the search module and the waiting rules beside it too', () => {
  const note = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'cross-harness.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(note, /skills\/web\/web\/search\.js/);
  assert.match(note, /skills\/web\/web\/waiting-blocked\.js/);
});

test('the skill keeps type: among the scoped substrings the nesting docs pin', () => {
  assert.match(skill, /`file:`\/`type:` scoped substrings/);
});
