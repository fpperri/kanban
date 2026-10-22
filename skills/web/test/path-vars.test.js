const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cfg = require('../scripts/config-store');

// The `vars:` block and the built-in word <repo> in the logbook:, scratchpad: and todos: paths
// (docs/adr/0023). readConfig answers `paths`, the three paths with the variables and <repo> filled
// in ('' = off), and `pathNotices`, what the server says on stderr at startup.

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-path-vars-'));
}

function board(config, { git = null, nest = '.kanban' } = {}) {
  const root = tmp();
  if (git === 'dir') fs.mkdirSync(path.join(root, '.git'));
  if (git === 'file') fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/w\n');
  const dir = path.join(root, nest);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return { root, dir };
}

const slash = (p) => p.replace(/\\/g, '/');

test('a variable at the start of a path is replaced by its value', () => {
  const { dir } = board('name: t\nvars:\n  notes: ../shared\nlogbook: <notes>/logbook\n');
  assert.strictEqual(cfg.readConfig(dir).paths.logbook, '../shared/logbook');
});

test('a variable in the middle of a path is replaced by its value', () => {
  const { dir } = board('name: t\nvars:\n  work: execution\nscratchpad: base/<work>/.scratchpad\n');
  assert.strictEqual(cfg.readConfig(dir).paths.scratchpad, 'base/execution/.scratchpad');
});

test('the three paths each take a variable', () => {
  const { dir } = board('name: t\nvars:\n  x: here\nlogbook: <x>/l\nscratchpad: <x>/s\ntodos: <x>/t\n');
  const { paths } = cfg.readConfig(dir);
  assert.deepStrictEqual([paths.logbook, paths.scratchpad, paths.todos], ['here/l', 'here/s', 'here/t']);
});

test('a variable value may use <repo> and <iteration>', () => {
  const { root, dir } = board('name: t\nvars:\n  cortex: <repo>/.cortex\nlogbook: <cortex>/execution/<iteration>/.logbook\n', { git: 'dir' });
  assert.strictEqual(cfg.readConfig(dir).paths.logbook, `${slash(root)}/.cortex/execution/<iteration>/.logbook`);
});

test('a quoted value and a value with a trailing comment are read as a value', () => {
  const { dir } = board('name: t\nvars:\n  a: "../one two"\n  b: ../three # why\nlogbook: <a>/x\nscratchpad: <b>/y\n');
  const { paths } = cfg.readConfig(dir);
  assert.deepStrictEqual([paths.logbook, paths.scratchpad], ['../one two/x', '../three/y']);
});

test('a variable inside a variable is not expanded, and is named', () => {
  const { dir } = board('name: t\nvars:\n  a: one\n  b: <a>/two\nlogbook: <b>/x\n');
  const config = cfg.readConfig(dir);
  assert.strictEqual(config.paths.logbook, '<a>/two/x');
  assert.strictEqual(config.pathNotices.length, 1);
  assert.match(config.pathNotices[0], /`b`/);
  assert.match(config.pathNotices[0], /<a>/);
});

test('a variable named like a built-in word is ignored and named, never fatal', () => {
  const { dir } = board('name: t\nvars:\n  card: oops\n  iteration: oops\n  repo: oops\n  ok: fine\nlogbook: <ok>/x\nscratchpad: <card>/s\n');
  const config = cfg.readConfig(dir);
  assert.deepStrictEqual(config.vars, { ok: 'fine' });
  assert.strictEqual(config.paths.logbook, 'fine/x');
  assert.strictEqual(config.paths.scratchpad, '<card>/s');
  for (const word of ['card', 'iteration', 'repo']) assert.ok(config.pathNotices.some((n) => n.includes(`\`${word}\``) && /built-in/.test(n)), word);
});

test('a name is letters, digits, - and _; another is ignored and named', () => {
  const { dir } = board('name: t\nvars:\n  my-dir_2: ok\n  "bad name": no\nlogbook: <my-dir_2>/x\n');
  const config = cfg.readConfig(dir);
  assert.deepStrictEqual(config.vars, { 'my-dir_2': 'ok' });
  assert.strictEqual(config.paths.logbook, 'ok/x');
  assert.ok(config.pathNotices.some((n) => n.includes('bad name')));
});

test('a placeholder is a whole segment only: a variable inside a longer name stays text', () => {
  const { dir } = board('name: t\nvars:\n  a: one\nlogbook: x<a>y/l\n');
  assert.strictEqual(cfg.readConfig(dir).paths.logbook, 'x<a>y/l');
});

test('an unknown <word> stays an ordinary folder name and is named', () => {
  const { dir } = board('name: t\nlogbook: logs/<sprint>/x\nscratchpad: <iteration>/<card>/s\n');
  const config = cfg.readConfig(dir);
  assert.strictEqual(config.paths.logbook, 'logs/<sprint>/x');
  assert.strictEqual(config.pathNotices.length, 1);
  assert.match(config.pathNotices[0], /logbook/);
  assert.match(config.pathNotices[0], /<sprint>/);
});

test('a path with no placeholder reads exactly as written and says nothing', () => {
  const { dir } = board('name: t\nvars:\n  a: one\nlogbook: .logbook\nscratchpad: ../pads\ntodos: /abs/todos\n');
  const config = cfg.readConfig(dir);
  assert.deepStrictEqual(config.paths, { logbook: '.logbook', scratchpad: '../pads', todos: '/abs/todos' });
  assert.deepStrictEqual(config.pathNotices, []);
  assert.strictEqual(config.logbook, '.logbook');
});

test('a config with no vars: block has no variables and the raw keys stay as written', () => {
  const { dir } = board('name: t\nlogbook: <cortex>/x\n');
  const config = cfg.readConfig(dir);
  assert.deepStrictEqual(config.vars, {});
  assert.strictEqual(config.logbook, '<cortex>/x');
});

test('<repo> is the nearest folder at or above the board that has .git', () => {
  const { root, dir } = board('name: t\nlogbook: <repo>/.logbook\n', { git: 'dir', nest: 'a/b/.kanban' });
  assert.strictEqual(cfg.readConfig(dir).paths.logbook, `${slash(root)}/.logbook`);
});

test('<repo> is the board\'s own folder when .git is there', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'config.yaml'), 'name: t\nlogbook: <repo>/.logbook\n');
  assert.strictEqual(cfg.readConfig(root).paths.logbook, `${slash(root)}/.logbook`);
});

test('<repo> is found from a git worktree, whose .git is a file', () => {
  const { root, dir } = board('name: t\nscratchpad: <repo>/.pads\n', { git: 'file' });
  assert.strictEqual(cfg.readConfig(dir).paths.scratchpad, `${slash(root)}/.pads`);
});

test('the nearest .git wins over one further up', () => {
  const { root, dir } = board('name: t\ntodos: <repo>/t\n', { git: 'dir', nest: 'inner/.kanban' });
  fs.mkdirSync(path.join(root, 'inner', '.git'));
  assert.strictEqual(cfg.readConfig(dir).paths.todos, `${slash(path.join(root, 'inner'))}/t`);
});

test('with no git root a path that uses <repo> is off and named; the others stay on', () => {
  const { dir } = board('name: t\nvars:\n  c: <repo>/.c\nlogbook: <repo>/.logbook\nscratchpad: <c>/s\ntodos: .todos\n');
  const config = cfg.readConfig(dir);
  assert.strictEqual(config.paths.logbook, '');
  assert.strictEqual(config.paths.scratchpad, '');
  assert.strictEqual(config.paths.todos, '.todos');
  assert.strictEqual(config.pathNotices.filter((n) => /logbook/.test(n) && /<repo>/.test(n)).length, 1);
  assert.strictEqual(config.pathNotices.filter((n) => /scratchpad/.test(n) && /<repo>/.test(n)).length, 1);
});
