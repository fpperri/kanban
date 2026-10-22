const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lb = require('../scripts/logbook-store');
const sp = require('../scripts/scratchpad-store');
const td = require('../scripts/todo-store');

// The logbook, scratchpad and todos stores follow the `vars:` block and <repo> (docs/adr/0022).

function repoBoard(config, { git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-path-stores-'));
  if (git) fs.mkdirSync(path.join(root, '.git'));
  const dir = path.join(root, '.kanban');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return { root, dir };
}

const list = (p) => (fs.existsSync(p) ? fs.readdirSync(p).sort() : []);

test('a logbook under a variable writes and lists there', () => {
  const { root, dir } = repoBoard('name: t\nvars:\n  cortex: <repo>/.cortex\nlogbook: <cortex>/logbook\n');
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'hello' });
  assert.deepStrictEqual(list(path.join(root, '.cortex', 'logbook')), ['2026.10.16.logbook.md']);
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note), ['hello']);
});

test('a scratchpad and a todo list under a variable that is a relative path resolve against the board', () => {
  const { dir } = repoBoard('name: t\nvars:\n  here: store\nscratchpad: <here>/pads\ntodos: <here>/lists\n');
  sp.writePad(dir, '7', 'x');
  td.addTodo(dir, '7', { text: 'a', version: td.readTodos(dir, '7').version });
  assert.deepStrictEqual(list(path.join(dir, 'store', 'pads')), ['0007.scratchpad.md']);
  assert.deepStrictEqual(list(path.join(dir, 'store', 'lists')), ['0007.todo.md']);
});

test('<repo> puts a scratchpad at the git root', () => {
  const { root, dir } = repoBoard('name: t\nscratchpad: <repo>/.pads\n');
  sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(list(path.join(root, '.pads')), ['0007.scratchpad.md']);
});

test('with no git root the feature that uses <repo> is off and writes nothing, the others work', () => {
  const { root, dir } = repoBoard('name: t\nlogbook: <repo>/.logbook\nscratchpad: <repo>/.pads\ntodos: .todos\n', { git: false });
  assert.throws(() => lb.addNote(dir, { day: '2026-10-16', target: '', note: 'x' }), { status: 404 });
  assert.throws(() => sp.writePad(dir, '7', 'x'), { status: 404 });
  assert.deepStrictEqual(lb.listNotes(dir), []);
  assert.deepStrictEqual(sp.listTargets(dir), []);
  assert.deepStrictEqual(list(root).filter((n) => n !== '.kanban'), []);
  td.addTodo(dir, '7', { text: 'a', version: td.readTodos(dir, '7').version });
  assert.deepStrictEqual(list(path.join(dir, '.todos')), ['0007.todo.md']);
});
