const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseConfig } = require('../../plugin/skills/web/scripts/config-store');

// The starter file is the single source of what a board begins with. The README
// section and the kanban skill's text say the same thing in prose, and the bundled
// demo board carries it, so a change to the file that the words do not follow fails here.

const root = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const flatten = (text) => text.replace(/\s+/g, ' ');

const starterText = read('plugin', 'skills', 'kanban', 'starter-config.yaml');
const starter = parseConfig(starterText);

const readme = read('README.md');
const readmeSection = (() => {
  const start = readme.indexOf('## Starter config');
  const end = readme.indexOf('\n## ', start + 1);
  assert.ok(start !== -1 && end > start, 'the README has a Starter config section');
  return readme.slice(start, end);
})();

const skill = read('plugin', 'skills', 'kanban', 'SKILL.md');
const skillConfig = (() => {
  const start = skill.indexOf('### `config.yaml`');
  const end = skill.indexOf('### `notifications.md`');
  assert.ok(start !== -1 && end > start, 'the config.yaml section is found');
  return skill.slice(start, end);
})();
const skillStarter = (() => {
  const start = skillConfig.indexOf('**The starter config.**');
  assert.ok(start !== -1, 'the skill has a starter config paragraph');
  const end = skillConfig.indexOf('\n**', start + 1);
  return skillConfig.slice(start, end === -1 ? undefined : end);
})();
const flatReadme = flatten(readmeSection);
const flatSkill = flatten(skillStarter);

const hierarchy = `[${starter.hierarchy.join(', ')}]`;

test('the starter file has the plan types, and the README table gives each one its colour and icon', () => {
  assert.ok(starter.types.length >= 7);
  for (const t of starter.types) {
    const row = new RegExp(`^\\| \`${t.name}\` \\| ${t.color ? `\`${t.color}\`` : 'none'} \\| ${t.icon ? `\`${t.icon}\`` : 'none'} \\|$`, 'm');
    assert.match(readmeSection, row, `the README table row for ${t.name}`);
  }
});

test('the README section and the skill both name the hierarchy and every prefix of the starter file', () => {
  for (const [name, text] of [['README', flatReadme], ['skill', flatSkill]]) {
    assert.ok(text.includes(`\`${hierarchy}\``), `${name} names the hierarchy ${hierarchy}`);
    for (const [prefix, target] of Object.entries(starter.prefixes)) {
      assert.ok(text.includes(`\`${prefix}: ${target}\``), `${name} names the prefix ${prefix}: ${target}`);
    }
  }
});

test('the skill names every starter type', () => {
  for (const t of starter.types) assert.ok(flatSkill.includes(`\`${t.name}\``), `the skill names ${t.name}`);
});

test('the README and the skill say the lines can be changed, that cards made before a prefix keep their numbers, and that the five features are on', () => {
  assert.match(flatReadme, /every line can be changed or deleted/);
  assert.match(flatSkill, /every line can be changed or deleted/);
  assert.match(flatReadme, /card made before its prefix was declared keeps its plain number/);
  assert.match(flatSkill, /card made before a prefix is declared keeps its plain number/);
  for (const [name, text] of [['README', flatReadme], ['skill', flatSkill]]) {
    for (const line of ['logbook:', 'scratchpad:', 'todos:', 'groups:', 'iterations: true']) {
      assert.ok(text.includes(line), `${name} gives the line ${line}`);
    }
    assert.match(text, /gear sheet/);
    assert.doesNotMatch(text, /off until|stays? off|are not in the config|not lines of it/i, `${name} does not call the five features off`);
  }
  assert.match(flatReadme, /iterations \(`iterations: true`\) are on in the starter, so every new board has them/);
  assert.match(flatSkill, /writes the logbook, scratchpad, todo lists, groups and iterations lines for a new board/);
  assert.match(flatSkill, /adds the missing ones to an existing board when a human asks/);
  assert.match(flatSkill, /never invents them otherwise/);
});

test('each feature paragraph of the skill says the starter writes the line and an AI servicing a board does not invent it otherwise', () => {
  for (const key of ['groups', 'iterations', 'logbook', 'scratchpad', 'todos']) {
    const start = skillConfig.indexOf(`**\`${key}\` `);
    assert.ok(start !== -1, `the skill has a ${key} paragraph`);
    const end = skillConfig.indexOf('\n\n', start);
    const para = flatten(skillConfig.slice(start, end));
    assert.match(para, /starter writes the line for a new board/, key);
    assert.match(para, /otherwise nothing that services the board invents it/, key);
    assert.doesNotMatch(para, /A human writes the line, or/, key);
  }
});

test('ADR 0022 records the change and the README points to it', () => {
  const adr = read('docs', 'adr', '0022-the-starter-turns-the-notes-kit-on.md');
  assert.match(adr, /Status: accepted/);
  assert.match(flatten(adr), /ADR 0017/);
  assert.match(flatten(adr), /a board can still delete the lines/i);
  assert.match(flatten(read('README.md')), /ADR 0022/);
});

test('the starter file turns the five features on, each line with its meaning', () => {
  assert.strictEqual(starter.logbook, '<kanban>/.logbook/<iteration>/<card>/');
  assert.strictEqual(starter.scratchpad, '<kanban>/.scratchpad/<iteration>/<card>/');
  assert.strictEqual(starter.todos, '<kanban>/.todo/<iteration>/<card>/');
  assert.deepStrictEqual(starter.vars, { kanban: '.' });
  assert.strictEqual(starter.groups, '.groups');
  assert.strictEqual(starter.iterations, true);
  for (const key of ['logbook', 'scratchpad', 'todos', 'groups', 'iterations']) {
    assert.match(starterText, new RegExp(`^${key}: \\S.*# \\S`, 'm'), `${key} is a line with its meaning`);
  }
  assert.match(flatten(starterText), /Every line can be changed or deleted/);
  assert.match(flatten(starterText.replace(/^# ?/gm, '')), /deleting a kit line \(or switching it off in the web's gear sheet\) turns that feature off/i);
});

test('the skill says how to run the script on an existing board, dry first, and the script exists', () => {
  assert.match(skillStarter, /apply-starter\.js <kanban-dir>\.\.\. --dry-run/);
  assert.match(skillStarter, /apply-starter\.js <kanban-dir>\.\.\. +# adds them/);
  assert.match(readmeSection, /apply-starter\.js \.kanban --dry-run/);
  assert.ok(fs.existsSync(path.join(root, 'plugin', 'skills', 'kanban', 'scripts', 'apply-starter.js')));
  assert.match(flatSkill, /write `name:` on line 1 and the starter file's content under it/);
});

test('no document still shows the hierarchy example with an initiative', () => {
  for (const f of [['README.md'], ['plugin', 'skills', 'kanban', 'SKILL.md'], ['plugin', 'skills', 'web', 'SKILL.md']]) {
    assert.doesNotMatch(read(...f), /hierarchy: \[[^\]]*initiative/, f.join('/'));
  }
  assert.match(skillConfig, /^hierarchy: \[goal, strategy, objective, epic\]/m);
});

test('the bundled demo board carries the starter: its types, hierarchy and prefixes', () => {
  const demo = parseConfig(read('examples', 'demo-board', 'config.yaml'));
  for (const t of starter.types) assert.ok(demo.types.some((d) => d.name === t.name), `the demo board has ${t.name}`);
  assert.deepStrictEqual(demo.hierarchy, starter.hierarchy);
  assert.deepStrictEqual(demo.prefixes, starter.prefixes);
});

test('the README and the skill say a type the board has gets the starter colour or icon only where its entry has none', () => {
  assert.match(flatReadme, /colour or icon only where that entry has none/);
  assert.match(flatSkill, /`color:` or `icon:` on a type the board has when that entry has none/);
  assert.match(flatSkill, /a value the entry has is never changed/);
});
