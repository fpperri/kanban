const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// What the snapshot's docs promise about its Map, pinned so the skill, the human guide and
// the cross-harness note keep saying what the page draws.

const root = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const skill = read('skills', 'snapshot', 'SKILL.md');
const guide = flat(read('docs', 'snapshot.md'));
const found = /\n## The Map\n([\s\S]*?)\n## /.exec(skill);
const section = found ? flat(found[1]) : '';

test('the skill has a Map section that follows Nested cards', () => {
  assert.ok(skill.indexOf('\n## The Map\n') > skill.indexOf('\n## Nested cards\n'));
});

test('the Map section says the page embeds the map module as is, and where the two copies of the builder are pinned', () => {
  assert.ok(section.includes('skills/web/web/map-relations.js'));
  assert.ok(section.includes('test/map-embed.test.js'));
  assert.ok(section.includes('buildRelGraph'));
  assert.ok(section.includes('buildRelationsGraph'));
  assert.ok(section.includes('test/map-parity.test.js'));
});

test('the Map section describes the defaults it draws, one by one', () => {
  assert.match(section, /dashed line/);
  assert.match(section, /chain ends/i);
  assert.match(section, /the parent below its children/);
  assert.match(section, /one graph per tree/i);
  assert.match(section, /biggest first/);
  assert.match(section, /\*\*No relations\.\*\*/);
  assert.match(section, /doing, todo, backlog/);
  assert.match(section, /centered/);
  assert.match(section, /type chip/);
  assert.match(section, /thin roll-up bar/);
});

test('the Map section says it shows the board as embedded, not what is queued', () => {
  assert.match(section, /board as embedded/);
});

test('the skill lists the options row and the bar click among what the editor leaves to kanban-web', () => {
  const notDo = skill.slice(skill.indexOf('## What the editor deliberately does not do'));
  assert.match(notDo, /\*\*No Map options\.\*\*/);
  assert.match(flat(notDo), /a click on a roll-up bar opens the card/);
});

test('the skill keeps no word of the map that the change made false', () => {
  for (const stale of ['membership itself draws no line', 'draws no line', 'shapes the layout but']) {
    assert.ok(!flat(skill).includes(stale), `the skill still says: ${stale}`);
  }
});

test('the human guide says what the Map draws and where its options live', () => {
  assert.doesNotMatch(guide, /draws no line/);
  assert.match(guide, /dashed lines from a parent to its children/);
  assert.match(guide, /\*\*No relations\*\* row/);
  assert.match(guide, /Map options row is kanban-web's/);
});

test('the cross-harness note says the generator needs the map module beside it too', () => {
  const note = flat(read('docs', 'cross-harness.md'));
  assert.match(note, /skills\/web\/web\/map-relations\.js/);
});
