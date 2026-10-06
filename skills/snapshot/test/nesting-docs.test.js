const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// What the snapshot's docs promise about nested cards, pinned so the skill, the
// apply protocol and the human docs keep saying the same thing the page does.

const root = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills', 'snapshot', 'SKILL.md');
const protocol = read('skills', 'snapshot', 'references', 'apply-protocol.md');
const guide = read('docs', 'snapshot.md');

test('the skill lists type: among the scoped search terms', () => {
  assert.match(skill, /`file:`\/`type:` scoped substrings/);
});

test('the skill has a Nested cards section covering chips, order, roll-ups, the thread and the tray', () => {
  const section = /\n## Nested cards\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(section, 'a Nested cards section');
  for (const phrase of ['Type chips', 'Outline order', 'Roll-ups', 'The thread', 'Changing type and parent', 'skills/web/web/nesting.js']) {
    assert.ok(section[1].includes(phrase), `the section mentions ${phrase}`);
  }
});

test('the skill says rank is not editable in the snapshot, in the section and in the does-not-do list', () => {
  assert.match(skill, /\*\*Rank is not editable here\.\*\*/);
  const notDo = skill.slice(skill.indexOf('## What the editor deliberately does not do'));
  assert.match(notDo, /\*\*No rank editing\.\*\*/);
});

test('the apply protocol shows the type and parent shapes and says the editor never sends rank', () => {
  assert.ok(protocol.includes('{"fm":{"type":"epic"}}'));
  assert.ok(protocol.includes('{"fm":{"parent":"12"}}'));
  assert.ok(protocol.includes('{"fm":{"parent":"fpp#4"}}'));
  assert.match(protocol, /The editor never sends `rank`\./);
});

test('the human guide describes the nested view and keeps rank in the web editor', () => {
  assert.match(guide, /## Nested cards/);
  assert.match(guide, /never `rank`, which you change by dragging/);
});
