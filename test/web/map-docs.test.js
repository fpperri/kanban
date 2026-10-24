const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const skill = flat(read('plugin', 'skills', 'web', 'SKILL.md'));
const guide = flat(read('docs', 'web.md'));
const { MAP_OPTION_VALUES } = require('../../plugin/skills/web/web/map-relations');

const section = skill.slice(skill.indexOf('**Dependency map**'), skill.indexOf('**Calendar view**'));

test('the web skill\'s Dependency map section is found', () => {
  assert.ok(section.length > 3000, `${section.length} characters`);
});

test('the web skill describes the parent lines, chain ends first, with both sides of the rule', () => {
  assert.match(section, /dashed line in the dependency grey/);
  assert.match(section, /\*\*Chain ends\*\*, the default/);
  assert.match(section, /with the parent below, the children no sibling waits for; with it above, the children that wait for no sibling/);
  assert.match(section, /always a child with no dependency to or from a sibling/);
  assert.match(section, /never from a grandparent to a grandchild/);
});

test('the web skill says a parent on another board is a stub with a line, and a parent is not a dependency', () => {
  assert.match(section, /a parent on another board is one dimmed stub per `board#id` mention/);
  assert.match(section, /A parent is not a dependency: it never makes a card waiting/);
});

test('the web skill names the eight Map options, their values and the storage key', () => {
  for (const label of ['Parent lines', 'Dependency lines', 'Graphs', 'Parent sits', 'Align', 'Row order', 'Layout', 'Cards']) {
    assert.ok(section.includes(label), label);
  }
  for (const phrase of ['chain ends / all / off', 'on / off', 'one per tree / one graph', 'below / above', 'center / left', 'by status / layout', 'keep / reflow', 'rich / plain']) {
    assert.ok(section.includes(phrase), phrase);
  }
  assert.match(section, /`map\.options`/);
  assert.match(section, /not URL parameters/);
  assert.strictEqual(Object.keys(MAP_OPTION_VALUES).length, 8, 'the doc counts eight');
});

test('the web skill describes the trees, the No relations row, the row order and rich nodes', () => {
  assert.match(section, /one small graph per \*\*tree\*\*/);
  assert.match(section, /stacked biggest first/);
  assert.match(section, /\*\*No relations\*\*, holds only cards with no dependency, no parent and no children/);
  assert.match(section, /doing, todo, backlog, any other live status in column order, done, archived, then stubs/);
  assert.match(section, /a click on a bar flips every bar and never opens the card/);
  assert.match(section, /map-relations\.js/);
});

test('the web skill keeps no word of the map that the change made false', () => {
  for (const stale of [
    'membership is never drawn as a line',
    'draws no line',
    'adds nothing to the map',
    '"No dependencies" row',
    'isolated-row',
    'Dependency graph (',
  ]) {
    assert.ok(!skill.includes(stale), `the skill still says: ${stale}`);
  }
});

test('the human guide says what the map draws now, and drops what it no longer does', () => {
  const map = guide.slice(guide.indexOf('## Dependency map'), guide.indexOf('## Gantt'));
  assert.match(map, /dashed lines from a \*\*parent\*\* to its children/);
  assert.match(map, /where their dependency chain ends/);
  assert.match(map, /\*\*No relations\*\* row/);
  assert.match(map, /\*\*Map options\*\* row/);
  assert.match(map, /remembered per board in your browser/);
  assert.doesNotMatch(map, /Nesting itself draws no line/);
  assert.doesNotMatch(map, /no dependencies drop into/);
});

test('the web skill and the guide say the options row is always shown in the option panel, and an old fold is ignored', () => {
  assert.match(section, /The options row is always shown in the option panel, with no toggle of its own; an `options` value left in `map\.sections\.collapsed` by an older\s+version is dropped when that entry is read/);
  const map = guide.slice(guide.indexOf('## Dependency map'), guide.indexOf('## Gantt'));
  assert.match(map, /The options are always shown in it; the panel is what hides them, and\s+a fold remembered from before the panel is ignored/);
});

test('the guide and the web skill say the option panel starts closed at every width, and a kept choice wins', () => {
  assert.match(guide, /panel starts closed, at every width, until you open it with the panel icon; from 760 px wide it opens beside the view, below it over the view as a sheet with a close button of its own that adds no sideways scroll\. The choice is remembered per board/);
  assert.match(skill, /else the panel starts closed at every width \(`viewPanelDefault` is false\): a kept `true` opens it, from 760 px wide beside the view, and a window that crosses the line draws the view again/);
  assert.doesNotMatch(guide, /panel is open from 760 px wide and closed below it/);
  assert.doesNotMatch(skill, /else the screen decides: open from 760 px wide, closed below/);
});
