const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// What the snapshot's docs promise about type icons and the board's pills,
// pinned so the skill, the human guide and the cross-harness note keep saying
// what the page does.

const root = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const skill = flat(read('skills', 'snapshot', 'SKILL.md'));
const guide = flat(read('docs', 'snapshot.md'));
const crossHarness = flat(read('docs', 'cross-harness.md'));

const bullet = (start) => {
  const at = skill.indexOf(start);
  assert.ok(at !== -1, `${start} is in the snapshot skill`);
  const next = skill.indexOf(' - **', at + start.length);
  return skill.slice(at, next === -1 ? undefined : next);
};

test('the skill\'s type chip bullet says a type with an icon starts its chip with that glyph, in the chip\'s own colour', () => {
  const chips = bullet('**Type chips.**');
  assert.match(chips, /`icon:`/);
  assert.match(chips, /starts its chip with that glyph/);
  assert.match(chips, /chip's own colou?r/);
  for (const name of ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star']) assert.ok(chips.includes(name), `${name} is named`);
});

test('the skill\'s type chip bullet says a type with no icon, or an unknown icon name, wears the chip it always wore', () => {
  assert.match(bullet('**Type chips.**'), /no icon, or an unknown icon name, wears the chip it always wore/);
});

test('the skill says the glyphs are the web skill\'s own module, embedded as is and pinned by an embed test', () => {
  const chips = bullet('**Type chips.**');
  assert.match(chips, /skills\/web\/web\/type-icons\.js/);
  assert.match(chips, /embedded as is/);
  assert.match(chips, /test\/type-icons-embed\.test\.js/);
});

test('the skill says the page also holds the board\'s pills, a label and a query each, in config order, and that the config readers are twins', () => {
  const chips = bullet('**Type chips.**');
  assert.match(chips, /`pills:`/);
  assert.match(chips, /a label and a query/);
  assert.match(chips, /in config order/);
  assert.match(chips, /test\/nesting-config\.test\.js/);
});

test('the human guide says a type with an icon starts its chip with that glyph', () => {
  assert.match(guide, /icon/);
  assert.match(guide, /starts its chip with that glyph/);
});

test('the cross-harness note says the generator needs the type icons module beside it too', () => {
  assert.match(crossHarness, /skills\/web\/web\/type-icons\.js/);
});
