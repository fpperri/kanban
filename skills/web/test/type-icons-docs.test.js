const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill says where a type's icon is drawn: on the type chip wherever a
// chip is drawn, and as the outline of the card's dot in the Graph.

const repoRoot = path.join(__dirname, '..', '..', '..');
const webSkill = fs.readFileSync(path.join(repoRoot, 'skills', 'web', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const flat = webSkill.replace(/\s+/g, ' ');

const bullet = (start) => {
  const at = flat.indexOf(start);
  assert.ok(at !== -1, `${start} is in the web skill`);
  const next = flat.indexOf(' - **', at + start.length);
  return flat.slice(at, next === -1 ? undefined : next);
};

test('the card type chip bullet says a type with an icon starts its chip with that glyph, in the chip\'s colour, in every view that draws a chip', () => {
  const chip = bullet('**Card type chip**');
  assert.match(chip, /`icon:`/);
  assert.match(chip, /starts its chip with that glyph/);
  assert.match(chip, /chip's own colou?r/);
  for (const place of ['Board', 'Archive', 'Map', 'card details']) assert.ok(chip.includes(place), `${place} is named`);
  assert.match(chip, /type-icons\.js/);
  assert.match(chip, /no icon, or an unknown icon name, is the chip it was before icons/);
});

test('the Graph bullet says a dot of a type with an icon is drawn in that outline, still in its status colour', () => {
  const graph = bullet('**Graph view**');
  assert.match(graph, /A type with an icon draws its dot in that outline/);
  assert.match(graph, /status colou?r/);
  assert.match(graph, /the child ring and the flag rings sit outside every shape/);
  assert.match(graph, /round dot/);
});

test('the icon bullet says the closed table of six is the only thing an icon name is looked up in', () => {
  const icon = bullet('**`icon`**');
  assert.doesNotMatch(icon, /A later change draws it/);
  assert.match(icon, /chip glyph and the Graph dot's outline/);
  assert.match(icon, /closed table of six/);
  assert.match(icon, /never markup, a class name/);
});
