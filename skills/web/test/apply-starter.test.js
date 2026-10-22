const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseConfig } = require('../scripts/config-store');

const root = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(root, 'skills', 'kanban', 'scripts', 'apply-starter.js');
const STARTER = path.join(root, 'skills', 'kanban', 'starter-config.yaml');
const starter = parseConfig(fs.readFileSync(STARTER, 'utf8'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'starter-'));
const board = (config) => {
  const dir = path.join(tmp(), '.kanban');
  fs.mkdirSync(dir);
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
};
const read = (dir) => fs.readFileSync(path.join(dir, 'config.yaml'), 'latin1');
const run = (...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

test('the starter file reads as the plan: seven types, the four-level hierarchy and the prefixes', () => {
  assert.deepStrictEqual(starter.types.map((t) => t.name), ['goal', 'strategy', 'objective', 'epic', 'story', 'task', 'bug']);
  assert.deepStrictEqual(starter.types.slice(0, 5).map((t) => [t.color, t.icon]), [
    ['#e3b341', 'star'], ['#f0883e', 'hexagon'], ['#a371f7', 'diamond'], ['#58a6ff', 'square'], ['#3fb950', 'circle'],
  ]);
  assert.strictEqual(starter.types[5].icon, 'triangle');
  assert.deepStrictEqual(starter.hierarchy, ['goal', 'strategy', 'objective', 'epic']);
  assert.deepStrictEqual(starter.prefixes, {
    G: 'goal', S: 'strategy', O: 'objective', _: '.groups', I: '.groups/iteration', W: '.groups/workflow', DW: '.groups/workflow/dynamic',
  });
  assert.strictEqual(starter.groups, '.groups');
  assert.strictEqual(starter.logbook, '.logbook');
  assert.strictEqual(starter.scratchpad, '.scratchpad');
  assert.strictEqual(starter.todos, '.todos');
  assert.strictEqual(starter.iterations, true);
});

test('a board with no config.yaml gets the starter file as it is', () => {
  const dir = board(null);
  const r = run(dir);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(read(dir), fs.readFileSync(STARTER, 'latin1'));
  assert.match(r.out, /created config\.yaml/);
});

test('a config with fpp-style types gets the missing types and keeps its own, colours and all', () => {
  const before = 'name: fpp\nnextId: 9\ntypes:\n  - name: epic\n    color: "#f0883e"\n  - name: Objective\n    color: "#111111"\n  - name: spike\nassignees:\n  - handle: "@human"\n    name: "Human"\n';
  const dir = board(before);
  const r = run(dir);
  assert.strictEqual(r.status, 0);
  const after = read(dir);
  const cfg = parseConfig(after);
  assert.deepStrictEqual(cfg.types.slice(0, 3), [
    { name: 'epic', color: '#f0883e', icon: 'square' },
    { name: 'Objective', color: '#111111', icon: 'diamond' },
    { name: 'spike', color: '' },
  ]);
  assert.deepStrictEqual(cfg.types.slice(3).map((t) => t.name), ['goal', 'strategy', 'story', 'task', 'bug']);
  assert.strictEqual(cfg.types.find((t) => t.name === 'goal').icon, 'star');
  assert.strictEqual(cfg.assignees.length, 1);
  assert.ok(after.startsWith('name: fpp\nnextId: 9\ntypes:\n  - name: epic\n    color: "#f0883e"\n    icon: square\n  - name: Objective\n    color: "#111111"\n    icon: diamond\n  - name: spike\n  - name: goal\n'), 'icons join the entries that have none, and the new types follow the last type, inside the block');
  assert.ok(after.includes('assignees:\n  - handle: "@human"\n    name: "Human"\n'), 'the assignees block is untouched');
  assert.ok(after.indexOf('hierarchy:') > after.indexOf('name: "Human"'), 'hierarchy and prefixes are appended at the end');
  assert.deepStrictEqual(cfg.hierarchy, starter.hierarchy);
  assert.deepStrictEqual(cfg.prefixes, starter.prefixes);
});

const rest = 'hierarchy: [goal, strategy, objective, epic]\nprefixes:\n  G: goal\n  S: strategy\n  O: objective\n  _: .groups\n  I: .groups/iteration\n  W: .groups/workflow\n  DW: .groups/workflow/dynamic\nlogbook: x\nscratchpad: x\ntodos: x\ngroups: x\niterations: x\n';
const others = (names) => names.map((n) => starter.types.find((t) => t.name === n)).flatMap((t) => {
  const lines = [`  - name: ${t.name}`];
  if (t.color) lines.push(`    color: "${t.color}"`);
  if (t.icon) lines.push(`    icon: ${t.icon}`);
  return t.color || t.icon ? lines : [`  - ${t.name}`];
}).join('\n') + '\n';
const all = ['goal', 'strategy', 'objective', 'epic', 'story', 'task', 'bug'];

test('an entry with a colour and no icon gets the starter icon, matched without regard to case, and its colour stays', () => {
  const dir = board('types:\n  - name: GOAL\n    color: "#000001"\n');
  const r = run(dir);
  const after = read(dir);
  assert.ok(after.startsWith('types:\n  - name: GOAL\n    color: "#000001"\n    icon: star\n  - name: strategy\n'));
  assert.deepStrictEqual(parseConfig(after).types[0], { name: 'GOAL', color: '#000001', icon: 'star' });
  assert.strictEqual(parseConfig(after).types.filter((t) => t.name.toLowerCase() === 'goal').length, 1);
  assert.match(r.out, /added colours and icons \(GOAL: icon\)/);
});

test('an entry with an icon and no colour gets the starter colour and keeps its icon', () => {
  const dir = board('types:\n  - name: epic\n    icon: hexagon\n');
  run(dir);
  assert.ok(read(dir).startsWith('types:\n  - name: epic\n    icon: hexagon\n    color: "#58a6ff"\n  - name: goal\n'));
});

test('a bare entry becomes a block entry that keeps its name, its comment and its place', () => {
  const dir = board('types:\n  - story   # kept\n  - epic\nnextId: 4\n');
  const r = run(dir);
  const after = read(dir);
  assert.ok(after.startsWith('types:\n  - name: story   # kept\n    color: "#3fb950"\n    icon: circle\n  - name: epic\n    color: "#58a6ff"\n    icon: square\n  - name: goal\n'));
  assert.ok(after.includes('\nnextId: 4\n'));
  assert.deepStrictEqual(parseConfig(after).types.slice(0, 2), [
    { name: 'story', color: '#3fb950', icon: 'circle' },
    { name: 'epic', color: '#58a6ff', icon: 'square' },
  ]);
  assert.match(r.out, /colours and icons \(story: color and icon, epic: color and icon\)/);
  const dry = run('--dry-run', board('types:\n  - story   # kept\n')).out;
  assert.match(dry, /^\+ {1,3}- name: story {3}# kept$/m);
  assert.match(dry, /^\+ {1,5}icon: circle$/m);
});

test('an entry with a colour, an icon and its own values stays byte-identical, and a type the starter lacks too', () => {
  const entries = 'types:\n  - name: goal\n    color: "#123456"\n    icon: circle\n  - name: spike\n    color: "#abcdef"\n  - bug\n';
  const dir = board(entries);
  run(dir);
  const after = read(dir);
  assert.ok(after.startsWith(entries.replace('  - bug\n', '  - bug\n')));
  assert.strictEqual(after.indexOf('  - name: goal\n    color: "#123456"\n    icon: circle\n  - name: spike\n    color: "#abcdef"\n  - bug\n  - name: strategy\n'), 'types:\n'.length);
});

test('a board whose entries already hold the starter values is left as it is', () => {
  const before = `name: done\ntypes:\n${others(all)}${rest}`;
  const dir = board(before);
  const r = run(dir);
  assert.strictEqual(read(dir), before);
  assert.match(r.out, /nothing to add/);
});

test('an inline types list is told its colours and icons were not added', () => {
  const dir = board('types: [epic, goal, story, task, bug, strategy, objective]\n');
  const r = run(dir);
  assert.match(r.out, /types is an inline list; colours and icons not added/);
});

test('a different hierarchy is reported and left as it was', () => {
  const before = 'hierarchy: [theme, initiative, epic]\n';
  const dir = board(before);
  const r = run(dir);
  const after = read(dir);
  assert.ok(after.startsWith(before));
  assert.deepStrictEqual(parseConfig(after).hierarchy, ['theme', 'initiative', 'epic']);
  assert.strictEqual(after.match(/^hierarchy:/gm).length, 1);
  assert.match(r.out, /hierarchy[^\n]*differs[^\n]*theme, initiative, epic/);
});

test('the same hierarchy in block form is not reported', () => {
  const dir = board('hierarchy:\n  - Goal\n  - strategy\n  - objective\n  - epic\n');
  const r = run(dir);
  assert.doesNotMatch(r.out, /differs/);
});

test('prefixes: a board keeps its own entries, gets the missing ones and hears of a differing target', () => {
  const before = 'prefixes:\n  G: group\n  K: story\n  O: objective\nnextId: 5\n';
  const dir = board(before);
  const r = run(dir);
  const after = read(dir);
  const cfg = parseConfig(after);
  assert.strictEqual(cfg.prefixes.G, 'group');
  assert.strictEqual(cfg.prefixes.K, 'story');
  assert.strictEqual(cfg.prefixes.O, 'objective');
  assert.strictEqual(cfg.prefixes.S, 'strategy');
  assert.strictEqual(cfg.prefixes.DW, '.groups/workflow/dynamic');
  assert.deepStrictEqual(cfg.prefixClashes, []);
  assert.ok(after.startsWith('prefixes:\n  G: group\n  K: story\n  O: objective\n  S: strategy\n'), 'the new entries sit inside the block');
  assert.ok(after.includes('\nnextId: 5\n'));
  assert.match(r.out, /prefix G[^\n]*group[^\n]*goal/);
});

test('a prefix whose type already has another prefix is not added a second time', () => {
  const dir = board('prefixes:\n  X: goal\n');
  const r = run(dir);
  const cfg = parseConfig(read(dir));
  assert.strictEqual(cfg.prefixes.G, undefined);
  assert.strictEqual(cfg.prefixes.X, 'goal');
  assert.match(r.out, /goal[^\n]*X/);
});

test('the group prefixes follow a groups folder the board already names', () => {
  const dir = board('groups: planning/groups\n');
  run(dir);
  const cfg = parseConfig(read(dir));
  assert.strictEqual(cfg.prefixes._, 'planning/groups');
  assert.strictEqual(cfg.prefixes.I, 'planning/groups/iteration');
  assert.strictEqual(cfg.prefixes.DW, 'planning/groups/workflow/dynamic');
  assert.strictEqual(cfg.groups, 'planning/groups');
});

test('CRLF files stay CRLF and every other byte stays', () => {
  const before = '# my board\r\nname: crlf\r\nnextId: 3\r\ntypes:\r\n  - name: epic\r\n    color: "#f0883e"\r\nlogbook: logbook\r\n\r\n# tail comment\r\n';
  const dir = board(before);
  run(dir);
  const after = read(dir);
  assert.ok(!/(^|[^\r])\n/.test(after), 'no bare LF');
  assert.ok(after.startsWith('# my board\r\nname: crlf\r\nnextId: 3\r\ntypes:\r\n  - name: epic\r\n    color: "#f0883e"\r\n    icon: square\r\n  - name: goal\r\n'));
  assert.ok(after.includes('\r\nlogbook: logbook\r\n\r\n# tail comment\r\n'), 'the lines after the types block are untouched');
  assert.strictEqual(parseConfig(after).logbook, 'logbook');
  assert.deepStrictEqual(parseConfig(after).prefixes, starter.prefixes);
});

test('a file with no final newline gains no newline it does not need', () => {
  const dir = board('name: x');
  run(dir);
  const after = read(dir);
  assert.ok(after.startsWith('name: x\ntypes:\n'));
  assert.ok(!after.endsWith('\n'));
});

test('a dry run prints the lines it would add and writes nothing', () => {
  const before = 'name: dry\ntypes:\n  - name: epic\n';
  const dir = board(before);
  const r = run('--dry-run', dir);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(read(dir), before);
  assert.deepStrictEqual(fs.readdirSync(dir), ['config.yaml']);
  assert.match(r.out, /would add/);
  assert.match(r.out, /^\+ {1,3}- name: goal$/m);
  assert.match(r.out, /^\+ hierarchy: \[goal, strategy, objective, epic\]$/m);
  assert.match(r.out, /^\+ {1,3}DW: \.groups\/workflow\/dynamic$/m);
  assert.doesNotMatch(r.out, /^\+ {1,3}- name: epic$/m);
});

test('a dry run on a board with no config.yaml creates no file', () => {
  const dir = board(null);
  const r = run(dir, '--dry-run');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  assert.match(r.out, /would create config\.yaml/);
});

test('a second run adds nothing and writes nothing', () => {
  for (const before of [null, 'name: again\ntypes:\n  - epic\n', 'name: crlf\r\nprefixes:\r\n  G: goal\r\n']) {
    const dir = board(before);
    run(dir);
    const once = read(dir);
    const file = path.join(dir, 'config.yaml');
    const mtime = fs.statSync(file).mtimeMs;
    const r = run(dir);
    assert.strictEqual(read(dir), once);
    assert.strictEqual(fs.statSync(file).mtimeMs, mtime);
    assert.match(r.out, /nothing to add/);
    assert.match(run('--dry-run', dir).out, /nothing to add/);
  }
});

test('several boards in one run print one summary line each, in order', () => {
  const a = board(null);
  const b = board('name: b\n');
  const c = board(null);
  run(c);
  const r = run('--dry-run', a, b, c);
  const summaries = r.out.split('\n').filter((l) => /^[^\s+]/.test(l));
  assert.strictEqual(summaries.length, 3);
  assert.ok(summaries[0].startsWith(a) && summaries[1].startsWith(b) && summaries[2].startsWith(c));
  assert.match(summaries[2], /nothing to add/);
});

test('a missing directory is an error for that board, and the other boards are still done', () => {
  const ok = board(null);
  const gone = path.join(tmp(), 'nope');
  const r = run(gone, ok);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.out + r.err, /nope/);
  assert.ok(fs.existsSync(path.join(ok, 'config.yaml')));
});

test('an inline types list or an inline prefixes map is reported and left alone', () => {
  const before = 'types: [epic, story]\nprefixes: { G: goal }\n';
  const dir = board(before);
  const r = run(dir);
  assert.ok(read(dir).startsWith(before));
  assert.match(r.out, /types[^\n]*inline/);
  assert.match(r.out, /prefixes[^\n]*inline/);
});

test('no directory given is a usage error', () => {
  const r = run();
  assert.strictEqual(r.status, 2);
  assert.match(r.err, /usage/i);
});

const KITS = ['logbook', 'scratchpad', 'todos', 'groups', 'iterations'];
const kitValues = { logbook: '.logbook', scratchpad: '.scratchpad', todos: '.todos', groups: '.groups', iterations: true };

test('a board with none of the five feature lines gets all five, at the end, and nothing else changes', () => {
  const before = 'name: fpp\nnextId: 3\ntypes:\n  - name: epic\n    color: "#58a6ff"\n    icon: square\nhierarchy: [goal, strategy, objective, epic]\n';
  const dir = board(before);
  const only = 'name: fpp\nnextId: 3\n';
  const dirOnly = board(only);
  const r = run(dirOnly);
  assert.strictEqual(r.status, 0);
  const cfg = parseConfig(read(dirOnly));
  for (const key of KITS) assert.strictEqual(cfg[key], kitValues[key], key);
  assert.ok(read(dirOnly).startsWith(only));
  run(dir);
  for (const key of KITS) assert.strictEqual(parseConfig(read(dir))[key], kitValues[key], key);
});

test('a feature line the board already has keeps its value, and only the missing ones are added', () => {
  const before = 'name: fpp\nlogbook: notes\niterations: false\nscratchpad: ../pads\n';
  const dir = board(before);
  run(dir);
  const after = read(dir);
  assert.ok(after.startsWith(before));
  const cfg = parseConfig(after);
  assert.strictEqual(cfg.logbook, 'notes');
  assert.strictEqual(cfg.iterations, false);
  assert.strictEqual(cfg.scratchpad, '../pads');
  assert.strictEqual(cfg.todos, '.todos');
  assert.strictEqual(cfg.groups, '.groups');
  assert.strictEqual((after.match(/^logbook:/gm) || []).length, 1);
  assert.strictEqual((after.match(/^iterations:/gm) || []).length, 1);
});

test('a commented-out feature line is not the key, so the line is added and the comment stays', () => {
  const before = 'name: fpp\n# logbook: logbook\n#   groups: x\n';
  const dir = board(before);
  run(dir);
  const after = read(dir);
  assert.ok(after.startsWith(before));
  assert.strictEqual(parseConfig(after).logbook, '.logbook');
  assert.match(after, /^logbook: \.logbook/m);
});

test('the dry run lists the feature lines it would add, one summary line for the board, and writes nothing', () => {
  const before = 'name: fpp\nlogbook: notes\n';
  const dir = board(before);
  const r = run('--dry-run', dir);
  assert.strictEqual(read(dir), before);
  const summaries = r.out.split('\n').filter((l) => /^[^\s+]/.test(l));
  assert.strictEqual(summaries.length, 1);
  assert.match(summaries[0], /would add/);
  for (const key of ['scratchpad', 'todos', 'groups', 'iterations']) assert.match(r.out, new RegExp(`^\\+ ${key}: `, 'm'), key);
  assert.doesNotMatch(r.out, /^\+ logbook:/m);
});

test('the feature lines keep a CRLF file CRLF and add a final line ending when the file has none', () => {
  const before = 'name: fpp\r\nnextId: 3';
  const dir = board(before);
  run(dir);
  const after = read(dir);
  assert.ok(after.startsWith(before));
  assert.ok(!/[^\r]\n/.test(after), 'every line ends CRLF');
  for (const key of KITS) assert.strictEqual(parseConfig(after)[key], kitValues[key], key);
});

test('a board that has all five lines, or the starter itself, has nothing to add', () => {
  const lines = 'name: x\nlogbook: a\nscratchpad: b\ntodos: c\ngroups: d\niterations: false\n';
  const dir = board(lines);
  run(dir);
  const once = read(dir);
  for (const key of KITS) assert.strictEqual((once.match(new RegExp(`^${key}:`, 'gm')) || []).length, 1, key);
  assert.match(run('--dry-run', dir).out, /nothing to add/);
});
