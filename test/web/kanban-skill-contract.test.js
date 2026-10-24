const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT, read, section, fenced } = require('./helpers/doc-text');
const { parseConfig, KEY_ORDER, ICON_NAMES, groupFolderOf } = require('../../plugin/skills/web/scripts/config-store');
const { toJSON, readCardFile } = require('../../plugin/skills/web/scripts/card-store');
const { parseNotifications } = require('../../plugin/skills/web/scripts/notifications-store');
const { parseParent } = require('../../plugin/skills/web/web/nesting');

// What an agent or a person copies from the kanban skill, the README's config section and the web
// skill's config example: the config.yaml they show, the card frontmatter, the notifications entry,
// the starter, the commands. Each is read by the real module, and what the module reads is where the
// expectation comes from, so a doc is held to the file formats and not to its own sentences.

const skill = read('plugin', 'skills', 'kanban', 'SKILL.md');
const configSection = section(skill, '### `config.yaml`', '### `notifications.md`');
const readme = read('README.md');
const readmeConfig = section(readme, '## config.yaml', '## Starter config');
const readmeStarter = section(readme, '## Starter config', '## More docs');
const webSkill = read('plugin', 'skills', 'web', 'SKILL.md');
const webConfig = section(webSkill, '## Board config: `config.yaml`', '\n## ');

const EXAMPLES = [
  ['the kanban skill', fenced(configSection, 'yaml')[0]],
  ['the README', fenced(readmeConfig, 'yaml')[0]],
  ['the web skill', fenced(webConfig, 'yaml')[0]],
];

const KNOWN_TO_THE_READER = new Set(Object.keys(parseConfig('')));
// Keys the example shows that no module reads: the Board artifact URL is read by the session that
// publishes the snapshot (plugin/skills/snapshot/references/board-artifact.md), not by code.
const NOT_READ_BY_CODE = { artifact: 'the snapshot skill reads it, in prose' };

const topKeys = (yaml) => [...yaml.matchAll(/^([A-Za-z]\w*):/gm)].map((m) => m[1]);

test('the examples are found', () => {
  for (const [where, example] of EXAMPLES) assert.ok(example && example.length > 200, `${where} has a config.yaml example`);
});

test('every top-level key a config.yaml example shows is one the config reader reads', () => {
  for (const [where, example] of EXAMPLES) {
    const unread = topKeys(example).filter((key) => !KNOWN_TO_THE_READER.has(key) && !(key in NOT_READ_BY_CODE));
    assert.deepStrictEqual(unread, [], `${where} shows ${unread.join(', ')}, which the reader ignores`);
  }
});

test('an exemption is a key some example shows: none is left over', () => {
  const shown = new Set(EXAMPLES.flatMap(([, example]) => topKeys(example)));
  assert.deepStrictEqual(Object.keys(NOT_READ_BY_CODE).filter((key) => !shown.has(key)), []);
});

test('every key the reader reads from the file is documented in the kanban skill\'s config section', () => {
  const documented = (key) => configSection.includes(`\`${key}`) || new RegExp(`^${key}:`, 'm').test(configSection);
  for (const key of [...KEY_ORDER, 'vars']) assert.ok(documented(key), `${key} is documented`);
});

test('the registry in each example reads as the role trio: three handles with the three kinds the grab rules name', () => {
  const kindsNamed = [...section(skill, '**Grab semantics for AI writers:**', 'Status values are').matchAll(/`kind: ([\w-]+)`/g)].map((m) => m[1]);
  assert.deepStrictEqual(kindsNamed, ['human', 'ai-hitl', 'ai-afk']);
  for (const [where, example] of EXAMPLES) {
    const handles = parseConfig(example).assignees;
    assert.deepStrictEqual(handles.map((a) => a.kind), kindsNamed, where);
    for (const a of handles) assert.match(a.handle, /^@\w+$/, where);
  }
});

test('the types, the pills and the prefixes in each example read as the keys describe them', () => {
  for (const [where, example] of EXAMPLES) {
    const config = parseConfig(example);
    for (const t of config.types.filter((entry) => entry.icon)) assert.ok(ICON_NAMES.includes(t.icon), `${where}: ${t.icon} is an icon name`);
    assert.ok(config.types.some((t) => t.icon), `${where}: shows a type with an icon`);
    assert.ok(config.hierarchy.length >= 2, `${where}: shows a hierarchy`);
    assert.ok(config.pills.length >= 2, `${where}: shows pills`);
    for (const p of config.pills) assert.ok(p.label && p.query, `${where}: a pill has a label and a query`);
    assert.ok(config.pills.some((p) => p.label !== p.query), `${where}: shows a labelled pill`);
    assert.ok(config.pills.some((p) => p.label === p.query), `${where}: shows a pill that is its own label`);
    if (config.groups) {
      const folders = Object.values(config.prefixes).map((target) => groupFolderOf(config, target)).filter((f) => f !== null);
      assert.ok(folders.includes(''), `${where}: shows the groups folder itself as a prefix`);
      assert.ok(folders.some((f) => f !== ''), `${where}: shows a prefix for a folder inside it`);
    }
  }
});

test('the six icon names the code knows are the six the skill and the examples list', () => {
  const iconSection = section(configSection, '**`icon`', '**`prefixes`');
  for (const name of ICON_NAMES) {
    assert.ok(iconSection.includes(`\`${name}\``), `${name} is named in the icon paragraph`);
    for (const [where, example] of EXAMPLES) assert.ok(example.includes(name), `${where}'s example lists ${name}`);
  }
});

test('every card field the reader gives back has a bullet in the skill\'s Card Fields list', () => {
  const fields = section(skill, '## Card Fields', '## Creating a Card');
  const derived = new Set(['title', 'body', 'archived', 'file']);
  for (const field of Object.keys(toJSON({ file: 'x.card.md' })).filter((key) => !derived.has(key))) {
    assert.ok(fields.includes(`\n- \`${field}\` `), `${field} has a bullet`);
  }
});

test('the card the skill shows is one the reader reads, in a file named as the skill names them', () => {
  const creating = section(skill, '## Creating a Card', '## Moving a Card');
  const [example] = fenced(creating, 'markdown');
  assert.ok(example, 'the example card is found');
  assert.match(creating, /<0000-id>\.<kebab-case-name>\.card\.md/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-skill-card-'));
  try {
    const file = path.join(dir, '0001.implement-user-authentication.card.md');
    fs.writeFileSync(file, example);
    const card = readCardFile(file);
    const lines = new Map([...example.split('\n---\n')[0].matchAll(/^(\w+): (.*)$/gm)].map((m) => [m[1], m[2]]));
    assert.strictEqual(card.id, lines.get('id'));
    assert.strictEqual(card.status, lines.get('status'));
    assert.strictEqual(card.priority, lines.get('priority'));
    assert.strictEqual(card.assignee, JSON.parse(lines.get('assignee')));
    assert.strictEqual(card.due_date, lines.get('due_date'));
    assert.deepStrictEqual(card.tags, lines.get('tags').slice(1, -1).split(', '));
    assert.strictEqual(card.title, /^# (.+)$/m.exec(example)[1]);
    const handles = parseConfig(EXAMPLES[0][1]).assignees.map((a) => a.handle);
    assert.ok(handles.includes(card.assignee), 'the assignee is a handle of the registry the skill shows');
    for (const key of lines.keys()) assert.ok(skill.includes(`\n- \`${key}\` `), `${key} is a field the skill lists`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the notifications entry the skill shows is one the reader reads, with a TLDR-first message', () => {
  const [example] = fenced(section(skill, '### `notifications.md`', '### The logbook'), 'yaml');
  const [entry, ...rest] = parseNotifications(example);
  assert.ok(entry, 'the entry is read');
  assert.strictEqual(rest.length, 0);
  const lines = new Map([...example.matchAll(/^\s*(?:- )?(\w+): (.*)$/gm)].map((m) => [m[1], m[2]]));
  assert.strictEqual(String(entry.id), lines.get('id'));
  assert.strictEqual(entry.level, lines.get('level'));
  assert.strictEqual(entry.read, false);
  assert.strictEqual(entry.from, JSON.parse(lines.get('from')));
  assert.ok(entry.message.includes('; more: '), 'the message has the separator the renderers look for');
});

test('a parent written the ways the skill shows reads as a parent, and this board\'s own name in board#id form is this board', () => {
  const bullet = skill.split('\n').find((line) => line.startsWith('- `parent` '));
  const shown = [...bullet.matchAll(/`((?:[\w-]+#)?_?[A-Z]*\d+)`/g)].map((m) => m[1]);
  assert.ok(shown.some((s) => s.includes('#')) && shown.some((s) => !s.includes('#')), 'both forms are shown');
  for (const text of shown) {
    const own = parseParent(text, 'webapp');
    assert.ok(own, `${text} reads as a parent`);
    if (text.includes('#')) {
      assert.strictEqual(parseParent(text, text.split('#')[0]).local, true, `${text} on its own board`);
      assert.strictEqual(own.local, false, `${text} from another board`);
    } else {
      assert.strictEqual(own.local, true);
    }
  }
});

test('the starter is what the skill and the README say it is', () => {
  const starter = parseConfig(read('plugin', 'skills', 'kanban', 'starter-config.yaml'));
  const starterPara = section(skill, '**The starter config.**', '\n- **A new board.**').replace(/\s+/g, ' ');
  const readmeText = readmeStarter.replace(/\s+/g, ' ');
  const hierarchy = `[${starter.hierarchy.join(', ')}]`;
  for (const [where, text] of [['the skill', starterPara], ['the README', readmeText]]) {
    assert.ok(text.includes(`\`${hierarchy}\``) || text.includes(`**Hierarchy:** \`${hierarchy}\``), `${where} names ${hierarchy}`);
    for (const [prefix, target] of Object.entries(starter.prefixes)) assert.ok(text.includes(`${prefix}: ${target}`), `${where} names the prefix ${prefix}: ${target}`);
    for (const t of starter.types) assert.ok(text.includes(`\`${t.name}\``), `${where} names the type ${t.name}`);
    for (const key of ['logbook', 'scratchpad', 'todos', 'groups']) assert.ok(text.includes(`\`${key}: ${starter[key]}\``), `${where} gives ${key}: ${starter[key]}`);
    assert.ok(text.includes(`\`iterations: ${starter.iterations}\``), `${where} gives iterations`);
    assert.ok(text.includes(`\`kanban: ${starter.vars.kanban}\``), `${where} gives the starter's variable`);
  }
  for (const t of starter.types) {
    const row = new RegExp(`^\\| \`${t.name}\` \\| ${t.color ? `\`${t.color}\`` : 'none'} \\| ${t.icon ? `\`${t.icon}\`` : 'none'} \\|$`, 'm');
    assert.match(readmeStarter, row, `the README table row for ${t.name}`);
  }
});

test('the bundled demo board carries the starter\'s types, hierarchy and prefixes', () => {
  const starter = parseConfig(read('plugin', 'skills', 'kanban', 'starter-config.yaml'));
  const demo = parseConfig(read('examples', 'demo-board', 'config.yaml'));
  for (const t of starter.types) assert.ok(demo.types.some((d) => d.name === t.name), `the demo board has ${t.name}`);
  assert.deepStrictEqual(demo.hierarchy, starter.hierarchy);
  assert.deepStrictEqual(demo.prefixes, starter.prefixes);
});

test('each command the skill and the README show runs a script that exists and knows the flags shown', () => {
  const shown = [
    ...fenced(section(skill, '**The starter config.**', '**Grab semantics'), 'bash'),
    ...fenced(section(skill, '### Migrating `epic: true`', '## Human surfaces'), 'bash'),
    ...fenced(readmeStarter, 'bash'),
  ].flatMap((block) => block.split('\n')).filter((line) => /\bnode |\bbash /.test(line));
  assert.ok(shown.length >= 5, 'the commands are found');
  const scripts = new Set();
  for (const line of shown) {
    const [, name] = /\b((?:apply-starter|migrate_epic_to_type)\.(?:js|sh))\b/.exec(line) || [];
    assert.ok(name, `the command runs a script: ${line}`);
    const file = path.join(ROOT, 'plugin', 'skills', 'kanban', 'scripts', name);
    assert.ok(fs.existsSync(file), `${name} exists`);
    const source = fs.readFileSync(file, 'utf8');
    for (const [flag] of line.matchAll(/--[\w-]+/g)) assert.ok(source.includes(flag), `${name} knows ${flag}`);
    scripts.add(name);
  }
  assert.deepStrictEqual([...scripts].sort(), ['apply-starter.js', 'migrate_epic_to_type.sh']);
});
