const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { read, section, fenced } = require('./helpers/doc-text');
const { parseConfig, readConfig } = require('../../plugin/skills/web/scripts/config-store');
const { BUILTINS, PATH_KEYS, resolvePaths } = require('../../plugin/skills/web/scripts/path-vars');
const logbook = require('../../plugin/skills/web/scripts/logbook-store');
const scratchpad = require('../../plugin/skills/web/scripts/scratchpad-store');
const todos = require('../../plugin/skills/web/scripts/todo-store');
const { readGroups } = require('../../plugin/skills/web/scripts/group-store');
const ids = require('../../plugin/skills/web/web/ids');

// The notes kit's files are written by hand by agents, from the kanban skill: a day file of the
// logbook, a scratchpad page, a todo list, a group file, and the paths that hold them. Each example
// the skill shows is written to a board and read by the real store, and what the store reads is
// compared with what the example says; the names and the placeholders are held to the code's.

const skill = read('plugin', 'skills', 'kanban', 'SKILL.md');
const logbookSection = section(skill, '### The logbook: notes in day files', '### The scratchpad');
const scratchpadSection = section(skill, '### The scratchpad: a disposable page per card or group', '### The todo list');
const todoSection = section(skill, '### The todo list: a task list per card or group', '### The placeholders');
const placeholderSection = section(skill, '### The placeholders in the logbook, scratchpad and todo paths', '### Groups: files');
const groupSection = section(skill, '### Groups: files that list their cards', '### Migrating `epic: true`');
const readmeStarter = section(read('README.md'), '## Starter config', '## More docs');

function onBoard(config, files, then) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-notes-kit-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), config);
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), text);
    }
    return then(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The file names a section writes out, such as `0007.scratchpad.md`, as [name, id].
const namesIn = (text, kind) => [...text.matchAll(new RegExp(String.raw`\b((?:_|[A-Z]+)?\d+)\.${kind}\.md\b`, 'g'))].map((m) => [m[0], m[1]]);

// The day-file names a section writes out, as [name, day, target id or ''].
const dayNamesIn = (text) => [...text.matchAll(/\b(\d{4})\.(\d\d)\.(\d\d)(?:\.((?:_|[A-Z]+)?\d+))?\.logbook\.md\b/g)]
  .map((m) => [m[0], `${m[1]}-${m[2]}-${m[3]}`, m[4] === undefined ? '' : ids.idKey(m[4])]);

test('the logbook example is read as the notes it says, and the day-file names the skill gives are the names the store makes', () => {
  const [example] = fenced(logbookSection, 'yaml');
  const timed = [...example.matchAll(/^\s+- at: "([^"]+)"/gm)].map((m) => m[1]);
  const authors = [...example.matchAll(/by: "(@\w+)"/g)].map((m) => m[1]);
  const block = /note: \|-\n((?:\s{6,}.+\n)+)/.exec(example)[1].split('\n').filter(Boolean).map((l) => l.trim()).join('\n');
  onBoard('logbook: .logbook\n', { '.logbook/2026.10.16.0007.logbook.md': `${example}` }, (dir) => {
    const notes = logbook.listNotes(dir);
    assert.deepStrictEqual(notes.map((n) => n.by), authors);
    assert.deepStrictEqual(notes.map((n) => n.at).filter(Boolean), timed);
    assert.strictEqual(notes[0].note, /note: (two .+)$/m.exec(example)[1]);
    assert.strictEqual(notes[1].note, block);
    assert.deepStrictEqual(notes.map((n) => [n.day, n.target]), [['2026-10-16', '7'], ['2026-10-16', '7']]);
  });
  const names = dayNamesIn(logbookSection);
  assert.ok(names.length >= 3 && names.some(([, , target]) => target === ''), 'the skill writes out day-file names, with and without a target');
  for (const [name, day, target] of names) assert.strictEqual(logbook.canonicalName(day, target, 4), name);
});

test('the scratchpad example is read as three refs and the body below, and the names are the store\'s', () => {
  const [example] = fenced(scratchpadSection, 'yaml');
  const refs = [...example.slice(0, example.indexOf('\n---', 4)).matchAll(/^\s+- (.+?)\s*$/gm)].map((m) => m[1].replace(/^"|"$/g, ''));
  assert.strictEqual(refs.length, 3);
  onBoard('scratchpad: .scratchpad\n', { '.scratchpad/0007.scratchpad.md': example }, (dir) => {
    const pad = scratchpad.readPad(dir, '7');
    assert.deepStrictEqual(pad.refs, refs);
    assert.strictEqual(pad.body, example.slice(example.indexOf('\n---\n', 4) + 5).replace(/^\n/, ''));
  });
  const names = namesIn(scratchpadSection, 'scratchpad');
  assert.deepStrictEqual(names.map(([name]) => name), ['0007.scratchpad.md', 'I0002.scratchpad.md']);
  for (const [name, id] of names) assert.strictEqual(scratchpad.canonicalName(ids.idKey(id), 4), name);
});

test('the todo items the skill writes out are read as open and done, a child by its indent, and the names are the store\'s', () => {
  const spans = [...todoSection.matchAll(/`(- \[[ x]\] text)`/g)].map((m) => m[1]);
  assert.deepStrictEqual(spans, ['- [ ] text', '- [x] text']);
  const text = `${spans[0]}\n${spans[1]}\n  ${spans[0]}\nnot an item\n`;
  onBoard('todos: .todos\n', { '.todos/0007.todo.md': text }, (dir) => {
    const lines = todos.readTodos(dir, '7').lines;
    assert.deepStrictEqual(lines.map((l) => (l.item ? [l.depth, l.done] : null)), [[0, false], [0, true], [1, false], null]);
    assert.strictEqual(lines[3].text, 'not an item');
  });
  const names = namesIn(todoSection, 'todo');
  assert.deepStrictEqual(names.map(([name]) => name), ['0007.todo.md', 'I0002.todo.md']);
  for (const [name, id] of names) assert.strictEqual(todos.canonicalName(ids.idKey(id), 4), name);
});

test('the group file the skill shows is read as the group it says, from the folder it sits in', () => {
  const [example] = fenced(groupSection, 'yaml');
  const line = (key) => new RegExp(`^${key}: *([^#\\n]*?) *(?:#.*)?$`, 'm').exec(example)[1];
  const file = /`(\.groups\/iteration\/I0002\.zephyr-2\.md)`/.exec(groupSection) || [null, '.groups/iteration/I0002.zephyr-2.md'];
  onBoard('groups: .groups\nprefixes:\n  I: .groups/iteration\n', { [file[1]]: example }, (dir) => {
    const read = readGroups(dir);
    assert.strictEqual(read.list.length, 1);
    const [group] = read.list;
    assert.strictEqual(group.id, line('id'));
    assert.strictEqual(group.name, line('name'));
    assert.strictEqual(group.start_date, line('start_date'));
    assert.strictEqual(group.end_date, line('end_date'));
    assert.strictEqual(group.auto_join, line('auto_join') === 'true');
    assert.deepStrictEqual(group.cards, line('cards').slice(1, -1).split(', '));
    assert.strictEqual(group.extra.owner, JSON.parse(line('owner')), 'a key the board does not know is kept');
    assert.strictEqual(group.folder, 'iteration');
    assert.strictEqual(read.prefixes.iteration, 'I');
  });
  assert.deepStrictEqual(dayNamesIn(groupSection).map(([name]) => name), ['2026.10.16.I0002.logbook.md']);
});

test('the placeholders the code fills are the ones the skill and the README name', () => {
  assert.deepStrictEqual([...BUILTINS].sort(), ['card', 'iteration', 'repo']);
  for (const word of BUILTINS) {
    assert.ok(placeholderSection.includes(`\`<${word}>\``), `the skill names <${word}>`);
    assert.ok(readmeStarter.includes(`\`<${word}>\``), `the README names <${word}>`);
  }
  for (const key of PATH_KEYS) {
    assert.ok(placeholderSection.includes(`\`${key}:\``), `the skill lists ${key}: among the paths`);
    assert.ok(skill.includes(`**\`${key}\` —`), `${key}: has its own paragraph`);
  }
});

test('the path and the variable the skill writes out resolve as it says: <repo> is the git root, and with none the feature is off', () => {
  const configSection = section(skill, '### `config.yaml`', '### `notifications.md`');
  const vars = parseConfig(fenced(configSection, 'yaml')[0]).vars;
  const [name, value] = Object.entries(vars)[0];
  const example = new RegExp(`logbook: (<${name}>/[^\`)]+)`).exec(placeholderSection)[1];
  const parsed = parseConfig(`vars:\n  ${name}: ${value}\nlogbook: ${example}\n`);
  assert.strictEqual(parsed.logbook, example);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-notes-kit-'));
  try {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.kanban'));
    const inside = resolvePaths(path.join(repo, '.kanban'), parsed).paths.logbook;
    assert.strictEqual(inside, `${repo.replace(/\\/g, '/')}/${value.replace('<repo>/', '')}/${example.replace(`<${name}>/`, '')}`);
    fs.mkdirSync(path.join(root, 'loose'));
    assert.strictEqual(resolvePaths(path.join(root, 'loose'), parsed).paths.logbook, '', 'no git root: off');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the folder keys the skill documents are read as folders, and a board without one keeps no such notes', () => {
  for (const key of PATH_KEYS) {
    assert.strictEqual(parseConfig(`${key}: .notes\n`)[key], '.notes');
    assert.strictEqual(parseConfig('name: x\n')[key], '');
  }
  onBoard('name: x\n', {}, (dir) => assert.strictEqual(readConfig(dir).paths.logbook, ''));
});
