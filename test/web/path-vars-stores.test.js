const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lb = require('../scripts/logbook-store');
const sp = require('../scripts/scratchpad-store');
const td = require('../scripts/todo-store');

// The logbook, scratchpad and todos stores follow the `vars:` block and <repo> (docs/adr/0023).

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

test('the refusal for a repo-less path says it needs a git root, in each store', () => {
  const { dir } = repoBoard('name: t\nlogbook: <repo>/.logbook\nscratchpad: <repo>/.pads\ntodos: <repo>/.todos\n', { git: false });
  const said = (fn) => { try { fn(); } catch (e) { return e.message; } return ''; };
  for (const message of [
    said(() => lb.addNote(dir, { day: '2026-10-16', target: '', note: 'x' })),
    said(() => sp.readPad(dir, '7')),
    said(() => td.readTodos(dir, '7')),
  ]) assert.match(message, /needs a git root.*none was found/);
});

test('a folder made by a write is seen on the next read, inside and after a scoped read', () => {
  const { dir } = repoBoard('name: t\nscratchpad: pads/<card>\n');
  fs.writeFileSync(path.join(dir, '0007.a.card.md'), '---\nid: 7\nstatus: todo\n---\n# a\n');
  const iter = require('../scripts/iteration-folders');
  iter.scoped(() => assert.deepStrictEqual(sp.listTargets(dir), []));
  sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(sp.listTargets(dir), ['7']);
  iter.scoped(() => {
    assert.deepStrictEqual(sp.listTargets(dir), ['7']);
    assert.deepStrictEqual(sp.listTargets(dir), ['7']);
  });
});

test('within one scope the same folders are listed once', () => {
  const { dir } = repoBoard('name: t\nscratchpad: pads/<card>\n');
  const iter = require('../scripts/iteration-folders');
  fs.mkdirSync(path.join(dir, 'pads', '0007.a'), { recursive: true });
  const real = fs.readdirSync;
  const reads = (fn) => {
    let calls = 0;
    fs.readdirSync = (...a) => { calls++; return real(...a); };
    try { iter.scoped(fn); } finally { fs.readdirSync = real; }
    return calls;
  };
  const once = reads(() => sp.listTargets(dir));
  assert.ok(once > 0);
  assert.strictEqual(reads(() => { sp.listTargets(dir); sp.listTargets(dir); sp.listTargets(dir); }), once);
});
