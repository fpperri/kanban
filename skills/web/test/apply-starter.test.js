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
  assert.strictEqual(starter.groups, '');
  assert.strictEqual(starter.logbook, '');
  assert.strictEqual(starter.scratchpad, '');
  assert.strictEqual(starter.iterations, false);
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
  assert.deepStrictEqual(cfg.types.slice(0, 3), [{ name: 'epic', color: '#f0883e' }, { name: 'Objective', color: '#111111' }, { name: 'spike', color: '' }]);
  assert.deepStrictEqual(cfg.types.slice(3).map((t) => t.name), ['goal', 'strategy', 'story', 'task', 'bug']);
  assert.strictEqual(cfg.types.find((t) => t.name === 'goal').icon, 'star');
  assert.strictEqual(cfg.assignees.length, 1);
  assert.ok(after.startsWith(before.slice(0, before.indexOf('assignees:')).replace('  - name: spike\n', '  - name: spike\n')), 'everything before the new lines is untouched');
  assert.ok(after.includes('  - name: spike\n  - name: goal\n'), 'the new types follow the last type, inside the block');
  assert.ok(after.includes('assignees:\n  - handle: "@human"\n    name: "Human"\n'), 'the assignees block is untouched');
  assert.ok(after.indexOf('hierarchy:') > after.indexOf('name: "Human"'), 'hierarchy and prefixes are appended at the end');
  assert.deepStrictEqual(cfg.hierarchy, starter.hierarchy);
  assert.deepStrictEqual(cfg.prefixes, starter.prefixes);
});

test('a type is matched without regard to case and is never recoloured or given an icon', () => {
  const before = 'types:\n  - name: GOAL\n    color: "#000001"\n';
  const dir = board(before);
  run(dir);
  const cfg = parseConfig(read(dir));
  assert.deepStrictEqual(cfg.types[0], { name: 'GOAL', color: '#000001' });
  assert.strictEqual(cfg.types.filter((t) => t.name.toLowerCase() === 'goal').length, 1);
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
  assert.ok(after.startsWith('# my board\r\nname: crlf\r\nnextId: 3\r\ntypes:\r\n  - name: epic\r\n    color: "#f0883e"\r\n  - name: goal\r\n'));
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
