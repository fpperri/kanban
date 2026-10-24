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

test('the apply protocol names one way to write a parent that holds a #: quoted', () => {
  assert.doesNotMatch(protocol, /either way/);
  assert.ok(protocol.includes('`parent: "fpp#4"`'), 'the quoted line is the one shown');
  assert.match(protocol.replace(/\s+/g, ' '), /a bare `parent: fpp#4` already on a card reads the same/);
});

test('the skill lists what the page leaves to kanban-web: the done warning, the bar mode and rank editing', () => {
  const notDo = skill.slice(skill.indexOf('## What the editor deliberately does not do'));
  assert.match(notDo, /\*\*No warning for a parent marked done with leaves open\.\*\*/);
  assert.match(notDo, /\*\*No bar mode\.\*\*/);
  assert.match(notDo, /\*\*No rank editing\.\*\*/);
});

test('the skill says which helpers the page writes itself, not that nothing needs syncing by hand', () => {
  const section = /\n## Nested cards\n([\s\S]*?)\n## /.exec(skill)[1].replace(/\s+/g, ' ');
  assert.doesNotMatch(section, /nothing to keep in sync by hand/);
  for (const helper of ['typeColor', 'rollupSegs', 'rollupBlock', 'nesting-parity.test.js']) {
    assert.ok(section.includes(helper), `${helper} is named`);
  }
});

test('the human guide says the rules are shared and the drawing is not', () => {
  assert.doesNotMatch(guide, /so both surfaces always agree/);
  assert.match(guide.replace(/\s+/g, ' '), /drawing and the type color match are the snapshot's own/);
});

test('the cross-harness note says the generator needs the web skill\'s nesting module beside it', () => {
  const note = read('docs', 'cross-harness.md').replace(/\s+/g, ' ');
  assert.match(note, /skills\/web\/web\/nesting\.js/);
  assert.match(note, /kanban-web/);
});
