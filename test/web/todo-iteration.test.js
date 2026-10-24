const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const td = require('../scripts/todo-store');

// The todos path may hold <iteration> (docs/adr/0019, docs/adr/0021): a list goes to the iteration its
// card or group is a member of, else the one holding the day it is first written, else the segment is
// dropped; a list that exists is read and written where it is.

function tmpBoard(config = 'name: t\ntodos: lists/<iteration>/.todos\ngroups: .groups\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-todo-iter-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

function iteration(dir, id, fileName, start, end, cards = []) {
  const folder = path.join(dir, '.groups', 'iteration');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${fileName}.md`), `---\nid: ${id}\nname: x\n${start ? `start_date: ${start}\n` : ''}${end ? `end_date: ${end}\n` : ''}cards: [${cards.join(', ')}]\n---\n`);
}

const at = (dir, ...parts) => path.join(dir, ...parts);
const list = (p) => (fs.existsSync(p) ? fs.readdirSync(p).sort() : []);
const lists = (dir) => list(at(dir, 'lists'));
const TODAY = '2026-10-16';
const first = (dir, target, text, opts) => td.addTodo(dir, target, { text, version: td.readTodos(dir, target, opts).version }, opts);

test('a card that is a member of an iteration keeps its list in that iteration\'s folder', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  iteration(dir, '6', '0006.sprint-497', '2026-10-26', '2026-11-06', [8]);
  const made = first(dir, '7', 'hello', { today: '2026-12-01' });
  assert.deepStrictEqual(list(at(dir, 'lists', '0005.sprint-496', '.todos')), ['0007.todo.md']);
  assert.strictEqual(made.folder, 'lists/0005.sprint-496/.todos');
  assert.strictEqual(made.file, '0007.todo.md');
});

test('a card in several iterations: the one that started first', () => {
  const dir = tmpBoard();
  iteration(dir, '6', '0006.later', '2026-10-14', '2026-10-30', [7]);
  iteration(dir, '5', '0005.earlier', '2026-10-12', '2026-10-23', [7]);
  first(dir, '7', 'x', { today: TODAY });
  assert.deepStrictEqual(lists(dir), ['0005.earlier']);
});

test('a card in no iteration goes to the iteration holding the day it is first written', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  iteration(dir, '6', '0006.sprint-497', '2026-10-26', '2026-11-06');
  first(dir, '7', 'x', { today: '2026-10-27' });
  assert.deepStrictEqual(lists(dir), ['0006.sprint-497']);
});

test('with no iteration at all, the segment is dropped', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  const made = first(dir, '7', 'x', { today: '2026-11-20' });
  assert.deepStrictEqual(lists(dir), ['.todos']);
  assert.strictEqual(made.folder, 'lists/.todos');
});

test('an iteration\'s own list goes to its own folder', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  iteration(dir, '6', '0006.sprint-497', '2026-10-26', '2026-11-06');
  first(dir, '6', 'x', { today: TODAY });
  assert.deepStrictEqual(lists(dir), ['0006.sprint-497']);
});

test('a list that exists is read and written where it is, even after its card changes iteration', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  first(dir, '7', 'one', { today: TODAY });
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', []);
  iteration(dir, '6', '0006.sprint-497', '2026-10-26', '2026-11-06', [7]);
  const opts = { today: '2026-10-27' };
  assert.deepStrictEqual(td.readTodos(dir, '7', opts).lines.map((l) => l.text), ['one']);
  const again = first(dir, '7', 'two', opts);
  assert.deepStrictEqual(again.lines.map((l) => l.text), ['one', 'two']);
  assert.strictEqual(again.folder, 'lists/0005.sprint-496/.todos');
  assert.deepStrictEqual(lists(dir), ['0005.sprint-496']);
});

test('a list not written yet reads as empty and names the folder a write would use', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  const read = td.readTodos(dir, '7', { today: TODAY });
  assert.deepStrictEqual({ ...read, version: 0 }, { target: '7', exists: false, file: '0007.todo.md', folder: 'lists/0005.sprint-496/.todos', version: 0, text: '', lines: [] });
  assert.deepStrictEqual(lists(dir), []);
});

test('a whole-text write for a list not written yet makes it in the folder a first write would use', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  const opts = { today: TODAY };
  const made = td.writeTodos(dir, '7', { text: '- [ ] pasted\n', version: td.readTodos(dir, '7', opts).version }, opts);
  assert.deepStrictEqual(list(at(dir, 'lists', '0005.sprint-496', '.todos')), ['0007.todo.md']);
  assert.strictEqual(made.folder, 'lists/0005.sprint-496/.todos');
  assert.strictEqual(fs.readFileSync(at(dir, 'lists', '0005.sprint-496', '.todos', '0007.todo.md'), 'utf8'), '- [ ] pasted\n');
});

test('reading finds a list in any folder, and lists and counts every target of every folder', () => {
  const dir = tmpBoard();
  const put = (rel, text) => {
    fs.mkdirSync(at(dir, ...rel.slice(0, -1)), { recursive: true });
    fs.writeFileSync(at(dir, ...rel), text);
  };
  put(['lists', '0003.gone', '.todos', '0002.todo.md'], '- [x] old\n');
  put(['lists', '.todos', '0010.todo.md'], '- [ ] loose\n- [ ] more\n');
  put(['lists', 'notes', '.todos', '0099.todo.md'], '- [ ] not an iteration folder\n');
  assert.deepStrictEqual(td.listTargets(dir), ['2', '10']);
  assert.deepStrictEqual(td.counts(dir), { 2: { open: 0, total: 1 }, 10: { open: 2, total: 2 } });
  assert.deepStrictEqual(td.readTodos(dir, '2').lines.map((l) => l.text), ['old']);
  assert.strictEqual(td.readTodos(dir, '99').exists, false);
});

test('deleting a target\'s lists sweeps every folder', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  first(dir, '7', 'in', { today: TODAY });
  fs.mkdirSync(at(dir, 'lists', '.todos'), { recursive: true });
  fs.writeFileSync(at(dir, 'lists', '.todos', '0007.todo.md'), '- [ ] loose\n');
  fs.writeFileSync(at(dir, 'lists', '.todos', '0008.todo.md'), '- [ ] other\n');
  assert.strictEqual(td.deleteTargetFiles(dir, '7'), 2);
  assert.deepStrictEqual(td.listTargets(dir), ['8']);
});

test('an unknown placeholder reads as an ordinary folder name; a write to it is refused with what and why', () => {
  const dir = tmpBoard('name: t\ntodos: lists/<sprint>/.todos\n');
  assert.deepStrictEqual(td.listTargets(dir), []);
  assert.strictEqual(td.readTodos(dir, '7').exists, false);
  assert.throws(() => td.addTodo(dir, '7', { text: 'x', version: td.readTodos(dir, '7').version }), (e) => e.status === 400 && /Windows/.test(e.message) && /<iteration>/.test(e.message));
  assert.deepStrictEqual(lists(dir), []);
});

test('a path without the placeholder is one folder and its records carry no folder', () => {
  const dir = tmpBoard('name: t\ntodos: .todos\ngroups: .groups\n');
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  const made = first(dir, '7', 'x');
  assert.ok(!('folder' in made));
  assert.deepStrictEqual(list(at(dir, '.todos')), ['0007.todo.md']);
});
