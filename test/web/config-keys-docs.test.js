const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The three config keys a board may declare, hierarchy:, pills: and a type's
// icon:, are written down where the people and the agents who read config.yaml
// look: the kanban skill's config section is the contract, the web skill and
// the README name what the board answer carries.

const repoRoot = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(repoRoot, ...p), 'utf8').replace(/\r\n/g, '\n');
const flatten = (text) => text.replace(/\s+/g, ' ');

const kanbanSkill = read('plugin', 'skills', 'kanban', 'SKILL.md');
const webSkill = read('plugin', 'skills', 'web', 'SKILL.md');
const readme = read('README.md');

const configSection = (() => {
  const start = kanbanSkill.indexOf('### `config.yaml`');
  const end = kanbanSkill.indexOf('### `notifications.md`');
  assert.ok(start !== -1 && end > start, 'the config.yaml section is found');
  return kanbanSkill.slice(start, end);
})();
const flatConfig = flatten(configSection);

test('the kanban skill\'s config example shows a hierarchy, a pills block and an icon on a type', () => {
  const example = configSection.slice(configSection.indexOf('```yaml'), configSection.indexOf('```\n', configSection.indexOf('```yaml') + 7));
  assert.match(example, /^hierarchy: \[[^\]]+\]/m);
  assert.match(example, /^pills:\s*(#.*)?\n\s+- /m);
  assert.match(example, /^\s+icon: (circle|square|diamond|triangle|hexagon|star)\b/m);
});

test('the kanban skill says what the hierarchy is: ordered type names, top first, that orders drawing and slicing and enforces nothing', () => {
  assert.match(flatConfig, /\*\*`hierarchy`/);
  assert.match(flatConfig, /ordered list of type names, top (level|tier) first/i);
  assert.match(flatConfig, /without regard to case/);
  assert.match(flatConfig, /orders drawing and slicing and enforces nothing/);
});

test('the kanban skill gives the forms a pill may take, and warns that "- tags: grill" is a label and a query', () => {
  assert.match(flatConfig, /\*\*`pills`/);
  assert.match(flatConfig, /block form/);
  assert.match(flatConfig, /a query on its own/);
  assert.match(flatConfig, /one-key map from a label to a query/);
  assert.ok(flatConfig.includes("- next: 'tags:\"next-up\"'"), 'the labelled example');
  assert.ok(flatConfig.includes('`- tags: grill`'), 'names the footgun');
  assert.match(flatConfig, /`- tags: grill`[^.]*label `tags`[^.]*query `grill`/);
  assert.match(flatConfig, /colon followed by a space/);
});

test('the kanban skill lists the six icon names and says an entry with none, or an unknown one, is drawn as before', () => {
  assert.match(flatConfig, /\*\*`icon`/);
  for (const name of ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star']) {
    assert.ok(flatConfig.includes(`\`${name}\``), `${name} is named`);
  }
  assert.match(flatConfig, /no icon, or an unknown name, is drawn as it is today/);
});

test('the kanban skill says only a human, or a session told to, writes these keys, and that they are no new exception', () => {
  assert.match(flatConfig, /Only a human, or a session a human tells to, writes `hierarchy:`, `pills:` and `icon:`/);
  assert.match(flatConfig, /nothing that services the board invents them/);
  assert.match(flatConfig, /not exceptions to "never invent a config key"/);
});

test('the kanban skill keeps its three named exceptions sentence', () => {
  assert.ok(flatConfig.includes('never invent a key beyond the three named exceptions above (`name:`, `artifact:`, `port:`)'));
});

test('the web skill says the board answer carries hierarchy, pills and each type\'s icon, and keeps its suggest-never-validate sentence', () => {
  const flat = flatten(webSkill);
  assert.match(flat, /\*\*`hierarchy`\*\*/);
  assert.match(flat, /`GET \/api\/board` carries it as `hierarchy: \[name, \.\.\.\]`/);
  assert.match(flat, /\*\*`pills`\*\*/);
  assert.match(flat, /`GET \/api\/board` carries them as `pills: \[\{label, query\}\]`/);
  assert.match(flat, /types: \[\{name, color\}\]`[^.]*`icon`/);
  assert.match(flat, /assignees, priorities, tags and types lists all \*\*suggest, never validate\*\*/);
});

test('the README config example and text name the hierarchy, the pills, the icon and the answer keys', () => {
  const flat = flatten(readme.slice(readme.indexOf('## config.yaml'), readme.indexOf('## More docs')));
  assert.match(flat, /hierarchy: \[/);
  assert.match(flat, /pills:/);
  assert.match(flat, /icon: /);
  assert.match(flat, /`hierarchy`, `pills` and each type's `icon`/);
});
