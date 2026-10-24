const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const td = require('../../plugin/skills/web/scripts/todo-store');
const sp = require('../../plugin/skills/web/scripts/scratchpad-store');
const { StatusError } = require('../../plugin/skills/web/scripts/store-common');

// The todo store (docs/adr/0021): one `<padded id>.todo.md` per card or group in the folder `todos:`
// names, a GitHub task list a person or an AI edits by hand. Reading is tolerant (a line that is not
// an item is kept and shown as written), a write changes the line it is about and keeps every other
// byte, and every write names the version it read.

function tmpBoard(config = 'name: t\ntodos: .todos\n', files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-todos-'));
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const refused = (fn, status) => assert.throws(fn, (e) => e instanceof StatusError && e.status === status);
const FILE = '.todos/0007.todo.md';
const shape = (list) => list.lines.map((l) => (l.item ? `${'>'.repeat(l.depth)}${l.done ? 'x' : 'o'} ${l.text}` : `= ${l.text}`));

// a write that names the version just read
const add = (dir, t, text, parent) => td.addTodo(dir, t, { text, parent, version: td.readTodos(dir, t).version });
const set = (dir, t, index, change) => td.setTodo(dir, t, { index, ...change, version: td.readTodos(dir, t).version });
const del = (dir, t, index) => td.deleteTodo(dir, t, { index, version: td.readTodos(dir, t).version });
const indent = (dir, t, index) => td.indentTodo(dir, t, { index, version: td.readTodos(dir, t).version });
const outdent = (dir, t, index) => td.outdentTodo(dir, t, { index, version: td.readTodos(dir, t).version });
const move = (dir, t, index, by) => td.moveTodo(dir, t, { index, by, version: td.readTodos(dir, t).version });

test('the folder is the one todos: names, relative to the board; none when the line is absent', () => {
  const dir = tmpBoard();
  add(dir, '7', 'first');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.todos')), ['0007.todo.md']);
  for (const off of [tmpBoard('name: t\n'), tmpBoard(null)]) {
    assert.deepStrictEqual(td.listTargets(off), []);
    refused(() => td.readTodos(off, '7'), 404);
    refused(() => td.addTodo(off, '7', { text: 'x', version: '' }), 404);
  }
});

test('a target with no file reads as an empty list that does not exist yet, and reading creates nothing', () => {
  const dir = tmpBoard();
  const list = td.readTodos(dir, '7');
  assert.deepStrictEqual({ ...list, version: typeof list.version }, { target: '7', exists: false, file: '0007.todo.md', version: 'string', text: '', lines: [] });
  assert.ok(!fs.existsSync(path.join(dir, '.todos')));
});

test('a task list reads: [ ] open, [x] and [X] done, nested by two or more spaces or a tab, any other line kept as written', () => {
  const dir = tmpBoard(undefined, {
    [FILE]: ['# Before the handoff', '- [ ] one', '\t- [ ] one tab', '- [x] two', '  - [X] two a', '    - [ ] two a i', '* [ ] star', '+ [ ] plus', 'a plain line', '', '- [ ] three', '- [ ]not an item', '-[ ] nor this', ''].join('\n'),
  });
  const list = td.readTodos(dir, '7');
  assert.deepStrictEqual(shape(list), [
    '= # Before the handoff', 'o one', '>o one tab', 'x two', '>x two a', '>>o two a i', 'o star', 'o plus', '= a plain line', 'o three', '= - [ ]not an item', '= -[ ] nor this',
  ]);
  assert.deepStrictEqual(list.lines.map((l) => l.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12], 'a blank line is no line to show, and the others keep their line number');
  assert.strictEqual(list.exists, true);
  assert.strictEqual(list.file, '0007.todo.md');
});

test('one space does not nest, and an item under a plain line starts a new list', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n - [ ] b\nplain\n  - [ ] c\n' });
  assert.deepStrictEqual(shape(td.readTodos(dir, '7')), ['o a', 'o b', '= plain', 'o c']);
});

test('CRLF reads as lines, and the item text is the text without a line ending', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] one\r\n- [x] two\r\n' });
  assert.deepStrictEqual(shape(td.readTodos(dir, '7')), ['o one', 'x two']);
});

test('a file reads by the number whatever its padding, and the canonical name wins', () => {
  const dir = tmpBoard(undefined, { '.todos/7.todo.md': '- [ ] short', '.todos/000007.todo.md': '- [ ] long' });
  assert.deepStrictEqual(shape(td.readTodos(dir, '7')), ['o long'], 'sorted names: the first one found when none is canonical');
  fs.writeFileSync(path.join(dir, FILE), '- [ ] canon');
  assert.deepStrictEqual(shape(td.readTodos(dir, '7')), ['o canon']);
  assert.strictEqual(td.readTodos(dir, '0007').file, '0007.todo.md');
});

test('adding makes the folder and the file named by the board\'s idDigits, and a group is its own list', () => {
  const dir = tmpBoard('todos: lists\nidDigits: 3\n');
  const list = td.addTodo(dir, '7', { text: 'first', version: td.readTodos(dir, '7').version });
  assert.strictEqual(list.file, '007.todo.md');
  assert.strictEqual(read(dir, 'lists/007.todo.md'), '- [ ] first\n');
  assert.strictEqual(add(dir, 'I12', 'g').file, 'I012.todo.md');
  assert.ok(!fs.existsSync(path.join(dir, 'lists', '007.todo.md.tmp')), 'no temp file is left');
});

test('adding appends at the end, or under an item as its last child, and changes no other line', () => {
  const dir = tmpBoard(undefined, { [FILE]: '# notes\r\n- [ ] a\r\n  - [ ] a1\r\n- [x] b\r\n' });
  add(dir, '7', 'c');
  assert.strictEqual(read(dir, FILE), '# notes\r\n- [ ] a\r\n  - [ ] a1\r\n- [x] b\r\n- [ ] c\r\n', 'the file\'s own line ending');
  add(dir, '7', 'a2', 1);
  assert.strictEqual(read(dir, FILE), '# notes\r\n- [ ] a\r\n  - [ ] a1\r\n  - [ ] a2\r\n- [x] b\r\n- [ ] c\r\n');
  add(dir, '7', 'a2 x', 3);
  assert.strictEqual(read(dir, FILE), '# notes\r\n- [ ] a\r\n  - [ ] a1\r\n  - [ ] a2\r\n    - [ ] a2 x\r\n- [x] b\r\n- [ ] c\r\n');
  add(dir, '7', 'b1', 5);
  assert.deepStrictEqual(shape(td.readTodos(dir, '7')).slice(5), ['x b', '>o b1', 'o c']);
});

test('an add and a move answer the line the item is on now', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n  - [ ] a1\n- [ ] b\n\n- [ ] c\n' });
  assert.strictEqual(add(dir, '7', 'd').at, 5);
  assert.strictEqual(add(dir, '7', 'a2', 0).at, 2);
  assert.strictEqual(move(dir, '7', 3, -1).at, 0, 'b went above a and its child');
  assert.strictEqual(read(dir, FILE).split('\n')[0], '- [ ] b');
  assert.strictEqual(move(dir, '7', 0, 1).at, 3, 'and back down past a, a1 and a2');
  assert.strictEqual(move(dir, '7', 6, 1).at, 6, 'the last sibling does not move, and says where it is');
  assert.deepStrictEqual(shape(td.readTodos(dir, '7')), ['o a', '>o a1', '>o a2', 'o b', 'o c', 'o d']);
});

test('U+2028 and U+2029 are refused in an item like any control character, and a hand-written line that holds one is still an item', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] one two\n- [ ] x\n' });
  assert.deepStrictEqual(shape(td.readTodos(dir, '7')), ['o one two', 'o x']);
  set(dir, '7', 0, { done: true });
  assert.strictEqual(read(dir, FILE), '- [x] one two\n- [ ] x\n', 'it ticks');
  const v = td.readTodos(dir, '7').version;
  for (const bad of ['a b', 'a b', 'a\u0085b']) {
    refused(() => td.addTodo(dir, '7', { text: bad, version: v }), 400);
    refused(() => td.setTodo(dir, '7', { index: 0, text: bad, version: v }), 400);
  }
});

test('a byte order mark at the start of the file is read past and kept when the file is written', () => {
  const dir = tmpBoard(undefined, { [FILE]: '﻿- [ ] one\r\n- [ ] two\r\n' });
  assert.deepStrictEqual(shape(td.readTodos(dir, '7')), ['o one', 'o two']);
  set(dir, '7', 0, { done: true });
  assert.strictEqual(read(dir, FILE), '﻿- [x] one\r\n- [ ] two\r\n');
  add(dir, '7', 'three');
  assert.strictEqual(read(dir, FILE), '﻿- [x] one\r\n- [ ] two\r\n- [ ] three\r\n');
  del(dir, '7', 0);
  assert.strictEqual(read(dir, FILE), '﻿- [ ] two\r\n- [ ] three\r\n');
  move(dir, '7', 0, 1);
  assert.strictEqual(read(dir, FILE), '﻿- [ ] three\r\n- [ ] two\r\n');
  assert.deepStrictEqual(td.counts(dir), { 7: { open: 2, total: 2 } });
});

test('the size limit is on growth: a write never makes a file bigger than the limit, but can still change one that is already over it', () => {
  const filler = `${'x'.repeat(100)}\n`.repeat(3100);
  const dir = tmpBoard(undefined, { [FILE]: `- [ ] one\n- [ ] two\n${filler}` });
  assert.ok(read(dir, FILE).length > td.MAX_FILE);
  set(dir, '7', 0, { done: true });
  assert.ok(read(dir, FILE).startsWith('- [x] one\n'));
  move(dir, '7', 0, 1);
  assert.ok(read(dir, FILE).startsWith('- [ ] two\n- [x] one\n'));
  set(dir, '7', 0, { text: 'tw' });
  refused(() => add(dir, '7', 'one more'), 413);
  refused(() => set(dir, '7', 0, { text: 'a much longer text than it had before' }), 413);
  del(dir, '7', 0);
  assert.ok(read(dir, FILE).startsWith('- [x] one\n'));
  const small = tmpBoard();
  const fill = `${'y'.repeat(100)}\n`.repeat(2970);
  fs.mkdirSync(path.join(small, '.todos'));
  fs.writeFileSync(path.join(small, FILE), fill);
  add(small, '7', 'fits');
  refused(() => add(small, '7', 'z'.repeat(30)), 413);
});

test('counts reads at most the size limit of a file, and counts what it read', () => {
  const head = '- [ ] a\n- [x] b\n';
  const dir = tmpBoard(undefined, { [FILE]: head + `${'p'.repeat(99)}\n`.repeat(3100) + '- [ ] beyond the limit\n' });
  assert.deepStrictEqual(td.counts(dir), { 7: { open: 1, total: 2 } });
});

test('indent makes an item the last child of the sibling above it, its own children along, and changes no other line', () => {
  const dir = tmpBoard(undefined, { [FILE]: '# top\n- [ ] a\n  - [ ] a1\n- [ ] b\n  - [ ] b1\n    - [ ] b1x\n- [ ] c\n' });
  const r = indent(dir, '7', 3);
  assert.strictEqual(read(dir, FILE), '# top\n- [ ] a\n  - [ ] a1\n  - [ ] b\n    - [ ] b1\n      - [ ] b1x\n- [ ] c\n');
  assert.strictEqual(r.at, 3);
  assert.deepStrictEqual(shape(r), ['= # top', 'o a', '>o a1', '>o b', '>>o b1', '>>>o b1x', 'o c']);
  indent(dir, '7', 6);
  assert.strictEqual(read(dir, FILE), '# top\n- [ ] a\n  - [ ] a1\n  - [ ] b\n    - [ ] b1\n      - [ ] b1x\n  - [ ] c\n', 'c goes under a, after b and its children');
});

test('indent with no sibling above, or on the first item of a parent, changes nothing', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n  - [ ] a1\n  - [ ] a2\n- [ ] b\n' });
  const before = read(dir, FILE);
  assert.strictEqual(indent(dir, '7', 0).at, 0);
  assert.strictEqual(indent(dir, '7', 1).at, 1);
  assert.strictEqual(read(dir, FILE), before);
  indent(dir, '7', 2);
  assert.strictEqual(read(dir, FILE), '- [ ] a\n  - [ ] a1\n    - [ ] a2\n- [ ] b\n');
});

test('outdent moves an item to just after its parent\'s block, children along; later siblings stay under the parent', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n  - [ ] a1\n    - [ ] a1x\n  - [ ] a2\n  - [ ] a3\n- [ ] b\n' });
  const r = outdent(dir, '7', 1);
  assert.strictEqual(read(dir, FILE), '- [ ] a\n  - [ ] a2\n  - [ ] a3\n- [ ] a1\n  - [ ] a1x\n- [ ] b\n');
  assert.strictEqual(r.at, 3);
  const second = outdent(dir, '7', 4);
  assert.strictEqual(read(dir, FILE), '- [ ] a\n  - [ ] a2\n  - [ ] a3\n- [ ] a1\n- [ ] a1x\n- [ ] b\n');
  assert.strictEqual(second.at, 4);
});

test('outdent at the top level changes nothing, and a nested item goes to its grandparent\'s level', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n- [ ] b\n  - [ ] b1\n    - [ ] b1x\n' });
  const before = read(dir, FILE);
  assert.strictEqual(outdent(dir, '7', 0).at, 0);
  assert.strictEqual(read(dir, FILE), before);
  outdent(dir, '7', 3);
  assert.strictEqual(read(dir, FILE), '- [ ] a\n- [ ] b\n  - [ ] b1\n  - [ ] b1x\n');
});

test('indent and outdent keep CRLF, a file without a final line ending, and follow a tab-indented file', () => {
  const crlf = tmpBoard(undefined, { [FILE]: '- [ ] a\r\n- [ ] b\r\n  - [ ] b1\r\n' });
  indent(crlf, '7', 1);
  assert.strictEqual(read(crlf, FILE), '- [ ] a\r\n  - [ ] b\r\n    - [ ] b1\r\n');
  outdent(crlf, '7', 1);
  assert.strictEqual(read(crlf, FILE), '- [ ] a\r\n- [ ] b\r\n  - [ ] b1\r\n');
  const bare = tmpBoard(undefined, { [FILE]: '- [ ] a\n  - [ ] a1\n- [ ] b' });
  indent(bare, '7', 2);
  assert.strictEqual(read(bare, FILE), '- [ ] a\n  - [ ] a1\n  - [ ] b');
  outdent(bare, '7', 2);
  assert.strictEqual(read(bare, FILE), '- [ ] a\n  - [ ] a1\n- [ ] b');
  const tabs = tmpBoard(undefined, { [FILE]: '- [ ] a\n\t- [ ] a1\n- [ ] b\n\t- [ ] b1\n' });
  indent(tabs, '7', 2);
  assert.strictEqual(read(tabs, FILE), '- [ ] a\n\t- [ ] a1\n\t- [ ] b\n\t\t- [ ] b1\n', 'the file\'s own tab, children along');
  outdent(tabs, '7', 2);
  assert.strictEqual(read(tabs, FILE), '- [ ] a\n\t- [ ] a1\n- [ ] b\n\t- [ ] b1\n');
  const first = tmpBoard(undefined, { [FILE]: '- [ ] a\n- [ ] b\n' });
  indent(first, '7', 1);
  assert.strictEqual(read(first, FILE), '- [ ] a\n  - [ ] b\n', 'two spaces when the sibling has no child to follow');
});

test('a plain line between siblings ends the list: the item above it is no sibling, and plain lines under an item go with it', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\nplain\n- [ ] b\n' });
  indent(dir, '7', 2);
  assert.strictEqual(read(dir, FILE), '- [ ] a\nplain\n- [ ] b\n');
  const under = tmpBoard(undefined, { [FILE]: '- [ ] a\n- [ ] b\n  a note under b\n  - [ ] b1\n- [ ] c\n' });
  indent(under, '7', 1);
  assert.strictEqual(read(under, FILE), '- [ ] a\n  - [ ] b\n    a note under b\n    - [ ] b1\n- [ ] c\n');
  const gap = tmpBoard(undefined, { [FILE]: '- [ ] a\n\n- [ ] b\n' });
  indent(gap, '7', 2);
  assert.strictEqual(read(gap, FILE), '- [ ] a\n  - [ ] b\n\n');
});

test('indent and outdent are refused like the other writes: stale version 409, no version 400, a plain line 404', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n- [ ] b\nplain\n' });
  const v = td.readTodos(dir, '7').version;
  fs.writeFileSync(path.join(dir, FILE), '- [ ] a\n- [ ] b\nplain\n- [ ] by hand\n');
  for (const op of [td.indentTodo, td.outdentTodo]) {
    refused(() => op(dir, '7', { index: 1, version: v }), 409);
    refused(() => op(dir, '7', { index: 1 }), 400);
    refused(() => op(dir, '7', { index: 2, version: td.readTodos(dir, '7').version }), 404);
    refused(() => op(dir, '7', { index: '1', version: td.readTodos(dir, '7').version }), 400);
  }
  assert.strictEqual(read(dir, FILE), '- [ ] a\n- [ ] b\nplain\n- [ ] by hand\n');
});

test('a child of a tab-indented item is indented with a tab', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n\t- [ ] b\n' });
  add(dir, '7', 'b1', 1);
  assert.strictEqual(read(dir, FILE), '- [ ] a\n\t- [ ] b\n\t\t- [ ] b1\n');
});

test('a file with no final line ending keeps none, and the line before the new one gains the one it lacked', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n- [ ] b' });
  add(dir, '7', 'c');
  assert.strictEqual(read(dir, FILE), '- [ ] a\n- [ ] b\n- [ ] c');
});

test('ticking and unticking change the one character in the brackets', () => {
  const dir = tmpBoard(undefined, { [FILE]: '# keep\r\n* [ ]   spaced   text  \r\n  - [X] done\r\n' });
  set(dir, '7', 1, { done: true });
  assert.strictEqual(read(dir, FILE), '# keep\r\n* [x]   spaced   text  \r\n  - [X] done\r\n');
  set(dir, '7', 2, { done: false });
  assert.strictEqual(read(dir, FILE), '# keep\r\n* [x]   spaced   text  \r\n  - [ ] done\r\n');
  const before = read(dir, FILE);
  set(dir, '7', 2, { done: false });
  set(dir, '7', 1, { done: true });
  assert.strictEqual(read(dir, FILE), before, 'already so: nothing changes, not even X to x');
  set(dir, '7', 2, { done: true });
  assert.ok(read(dir, FILE).includes('  - [x] done'));
});

test('editing an item replaces its text and keeps its bullet, indent, mark and line ending', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\r\n\t* [x] old   \r\n- [ ] c\r\n' });
  const list = set(dir, '7', 1, { text: '  new text  ' });
  assert.strictEqual(read(dir, FILE), '- [ ] a\r\n\t* [x] new text\r\n- [ ] c\r\n');
  assert.deepStrictEqual(shape(list), ['o a', '>x new text', 'o c']);
  set(dir, '7', 0, { text: 'A', done: true });
  assert.ok(read(dir, FILE).startsWith('- [x] A\r\n'));
});

test('deleting an item takes its children and the lines under it with it, and nothing else', () => {
  const dir = tmpBoard(undefined, { [FILE]: '# top\n- [ ] a\n  - [ ] a1\n    note under a1\n  - [ ] a2\n\n- [ ] b\n- [ ] c\n' });
  del(dir, '7', 1);
  assert.strictEqual(read(dir, FILE), '# top\n\n- [ ] b\n- [ ] c\n');
  del(dir, '7', 3);
  assert.strictEqual(read(dir, FILE), '# top\n\n- [ ] b\n');
});

test('moving swaps an item with its sibling above or below, children along, and the lines between stay put', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n  - [ ] a1\n- [ ] b\n  - [ ] b1\n\n- [ ] c\n' });
  move(dir, '7', 2, -1);
  assert.strictEqual(read(dir, FILE), '- [ ] b\n  - [ ] b1\n- [ ] a\n  - [ ] a1\n\n- [ ] c\n');
  move(dir, '7', 2, 1);
  assert.strictEqual(read(dir, FILE), '- [ ] b\n  - [ ] b1\n- [ ] c\n\n- [ ] a\n  - [ ] a1\n', 'the blank line stays where it was');
});

test('moving a nested item stays inside its parent, and past the first or last sibling changes nothing', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n  - [ ] a1\n  - [ ] a2\n- [ ] b\n' });
  const first = read(dir, FILE);
  move(dir, '7', 1, -1);
  move(dir, '7', 2, 1);
  move(dir, '7', 0, -1);
  move(dir, '7', 3, 1);
  assert.strictEqual(read(dir, FILE), first);
  move(dir, '7', 2, -1);
  assert.strictEqual(read(dir, FILE), '- [ ] a\n  - [ ] a2\n  - [ ] a1\n- [ ] b\n');
});

test('an item never moves across a plain line: that line ends the list', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\nplain\n- [ ] b\n' });
  move(dir, '7', 2, -1);
  assert.strictEqual(read(dir, FILE), '- [ ] a\nplain\n- [ ] b\n');
});

test('moving the last line of a file with no final line ending keeps the file without one', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n- [ ] b' });
  move(dir, '7', 1, -1);
  assert.strictEqual(read(dir, FILE), '- [ ] b\n- [ ] a');
});

test('a write that names an old version is refused with 409 and nothing is written', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n' });
  const stale = td.readTodos(dir, '7').version;
  fs.writeFileSync(path.join(dir, FILE), '- [ ] a\n- [ ] by hand\n');
  const before = read(dir, FILE);
  refused(() => td.addTodo(dir, '7', { text: 'x', version: stale }), 409);
  refused(() => td.setTodo(dir, '7', { index: 0, done: true, version: stale }), 409);
  refused(() => td.deleteTodo(dir, '7', { index: 0, version: stale }), 409);
  refused(() => td.moveTodo(dir, '7', { index: 0, by: 1, version: stale }), 409);
  assert.strictEqual(read(dir, FILE), before);
  assert.notStrictEqual(td.readTodos(dir, '7').version, stale);
});

test('a list not written yet has a version too, and a file made meanwhile refuses the write', () => {
  const dir = tmpBoard();
  const v = td.readTodos(dir, '7').version;
  fs.mkdirSync(path.join(dir, '.todos'));
  fs.writeFileSync(path.join(dir, FILE), '- [ ] there first\n');
  refused(() => td.addTodo(dir, '7', { text: 'x', version: v }), 409);
  assert.strictEqual(read(dir, FILE), '- [ ] there first\n');
});

test('a write must name a version, and a request that is wrong is refused with its status', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n# plain\n' });
  const v = td.readTodos(dir, '7').version;
  refused(() => td.addTodo(dir, '7', { text: 'x' }), 400);
  refused(() => td.addTodo(dir, '7', { text: 'x', version: 5 }), 400);
  refused(() => td.addTodo(dir, '../7', { text: 'x', version: v }), 400);
  refused(() => td.addTodo(dir, '7', { text: '', version: v }), 400);
  refused(() => td.addTodo(dir, '7', { text: '   ', version: v }), 400);
  refused(() => td.addTodo(dir, '7', { text: 'two\nlines', version: v }), 400);
  refused(() => td.addTodo(dir, '7', { text: 12, version: v }), 400);
  refused(() => td.addTodo(dir, '7', { text: 'x'.repeat(td.MAX_ITEM + 1), version: v }), 413);
  refused(() => td.addTodo(dir, '7', { text: 'x', parent: 1, version: v }), 404);
  refused(() => td.addTodo(dir, '7', { text: 'x', parent: 9, version: v }), 404);
  refused(() => td.setTodo(dir, '7', { index: 1, done: true, version: v }), 404);
  refused(() => td.setTodo(dir, '7', { index: 0, version: v }), 400);
  refused(() => td.setTodo(dir, '7', { index: 0, done: 'yes', version: v }), 400);
  refused(() => td.setTodo(dir, '7', { index: 0, text: '', version: v }), 400);
  refused(() => td.setTodo(dir, '7', { index: '0', done: true, version: v }), 400);
  refused(() => td.deleteTodo(dir, '7', { index: 5, version: v }), 404);
  refused(() => td.moveTodo(dir, '7', { index: 0, by: 2, version: v }), 400);
  assert.strictEqual(read(dir, FILE), '- [ ] a\n# plain\n');
});

test('the targets that have a list are listed by id from the file names alone, and the counts are open over all', () => {
  const dir = tmpBoard(undefined, {
    '.todos/0010.todo.md': '- [ ] a\n- [x] b\n', '.todos/0002.todo.md': 'only text\n', '.todos/I0001.todo.md': '- [x] a\n  - [ ] b\n  - [x] c\n',
    '.todos/0002.other.md': '', '.todos/notes.todo.md': '', '.todos/7.todo.md.tmp': '', '.todos/0003.scratchpad.md': '- [ ] not mine\n',
  });
  assert.deepStrictEqual(td.listTargets(dir), ['2', '10', 'I1']);
  assert.deepStrictEqual(td.counts(dir), { 10: { open: 1, total: 2 }, I1: { open: 1, total: 3 } });
  assert.deepStrictEqual(td.listTargets(tmpBoard('name: t\n')), []);
  assert.deepStrictEqual(td.counts(tmpBoard('name: t\n')), {});
});

test('deleting a target\'s lists removes every padding of it and counts them; the rest stay', () => {
  const dir = tmpBoard(undefined, { '.todos/0007.todo.md': 'a', '.todos/7.todo.md': 'b', '.todos/0008.todo.md': 'c' });
  assert.strictEqual(td.deleteTargetFiles(dir, '7'), 2);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.todos')), ['0008.todo.md']);
  assert.strictEqual(td.deleteTargetFiles(dir, '7'), 0);
  assert.strictEqual(td.deleteTargetFiles(tmpBoard('name: t\n'), '7'), 0);
  assert.strictEqual(td.deleteTargetFiles(dir, 'nope'), 0);
});

test('todos and the scratchpad may share a folder: each store reads only its own kind of file and neither deletes the other\'s', () => {
  const dir = tmpBoard('name: t\nscratchpad: .both\ntodos: .both\n', { '.both/0007.scratchpad.md': 'free text\n', '.both/0007.todo.md': '- [ ] a\n', '.both/0008.scratchpad.md': 'x', '.both/0009.todo.md': '- [x] y\n' });
  assert.deepStrictEqual(td.listTargets(dir), ['7', '9']);
  assert.deepStrictEqual(sp.listTargets(dir), ['7', '8']);
  assert.strictEqual(sp.readPad(dir, '7').body, 'free text\n');
  assert.deepStrictEqual(shape(td.readTodos(dir, '7')), ['o a']);
  add(dir, '7', 'b');
  sp.writePad(dir, '7', 'new text\n');
  assert.strictEqual(read(dir, '.both/0007.todo.md'), '- [ ] a\n- [ ] b\n');
  assert.strictEqual(read(dir, '.both/0007.scratchpad.md'), 'new text\n');
  assert.strictEqual(td.deleteTargetFiles(dir, '7'), 1);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.both')).sort(), ['0007.scratchpad.md', '0008.scratchpad.md', '0009.todo.md']);
  assert.strictEqual(sp.deleteTargetFiles(dir, '9'), 0);
  assert.ok(fs.existsSync(path.join(dir, '.both', '0009.todo.md')));
});

// ---------- the whole text (the tab's Edit) ----------

test('a read carries the file\'s whole text with plain new lines and no byte order mark, empty for a list not written yet', () => {
  const dir = tmpBoard(undefined, { [FILE]: '\uFEFF# plan\r\n- [ ] a\r\n\r\n  notes\r\n- [x] b' });
  assert.strictEqual(td.readTodos(dir, '7').text, '# plan\n- [ ] a\n\n  notes\n- [x] b');
  assert.strictEqual(td.readTodos(dir, '3').text, '');
});

// a whole-text write that names the version just read
const writeText = (dir, t, text) => td.writeTodos(dir, t, { text, version: td.readTodos(dir, t).version });

test('a whole-text write makes the file exactly that text, in the file\'s own line endings, and answers the list as it now reads', () => {
  const crlf = tmpBoard(undefined, { [FILE]: '- [ ] a\r\n- [ ] b\r\n' });
  const made = writeText(crlf, '7', '# plan\n- [ ] b\n  - [x] b1\n\nloose words\n- [ ] a');
  assert.strictEqual(read(crlf, FILE), '# plan\r\n- [ ] b\r\n  - [x] b1\r\n\r\nloose words\r\n- [ ] a');
  assert.deepStrictEqual(shape(made), ['= # plan', 'o b', '>x b1', '= loose words', 'o a']);
  assert.strictEqual(made.text, '# plan\n- [ ] b\n  - [x] b1\n\nloose words\n- [ ] a');
  assert.strictEqual(made.version, td.readTodos(crlf, '7').version);
  const lf = tmpBoard(undefined, { [FILE]: '- [ ] a\n' });
  writeText(lf, '7', '- [ ] one\r\n- [ ] two\n');
  assert.strictEqual(read(lf, FILE), '- [ ] one\n- [ ] two\n', 'a CRLF in the text is the file\'s ending too');
});

test('a whole-text write over a list that changed since it was read is refused with 409 and writes nothing; one with no version or no text with 400', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n' });
  const stale = td.readTodos(dir, '7').version;
  fs.writeFileSync(path.join(dir, FILE), '- [ ] a\n- [ ] by hand\n');
  assert.throws(() => td.writeTodos(dir, '7', { text: 'mine\n', version: stale }), (e) => e instanceof StatusError && e.status === 409 && /changed on disk/.test(e.message));
  refused(() => td.writeTodos(dir, '7', { text: 'mine\n' }), 400);
  const v = td.readTodos(dir, '7').version;
  refused(() => td.writeTodos(dir, '7', { text: 12, version: v }), 400);
  refused(() => td.writeTodos(dir, '7', { version: v }), 400);
  refused(() => td.writeTodos(dir, '7', null), 400);
  assert.strictEqual(read(dir, FILE), '- [ ] a\n- [ ] by hand\n');
});

test('a whole text over the size limit is refused with 413, even over a file already past it, and writes nothing', () => {
  const dir = tmpBoard(undefined, { [FILE]: '- [ ] a\n' });
  assert.throws(() => writeText(dir, '7', 'x'.repeat(td.MAX_FILE + 1)), (e) => e instanceof StatusError && e.status === 413 && /too long/.test(e.message));
  writeText(dir, '7', 'x'.repeat(td.MAX_FILE));
  assert.strictEqual(read(dir, FILE).length, td.MAX_FILE, 'the limit itself fits');
  const crlf = tmpBoard(undefined, { [FILE]: '- [ ] a\r\n' });
  refused(() => writeText(crlf, '7', 'y\n'.repeat(td.MAX_FILE / 2)), 413); // the limit is on the file as written, its line endings included
  assert.strictEqual(read(crlf, FILE), '- [ ] a\r\n');
  const over = tmpBoard(undefined, { [FILE]: 'z'.repeat(td.MAX_FILE + 10) });
  refused(() => writeText(over, '7', 'z'.repeat(td.MAX_FILE + 5)), 413);
  assert.strictEqual(read(over, FILE).length, td.MAX_FILE + 10);
});

test('a whole-text write for a target with no list makes the file in its folder, named by the board\'s idDigits', () => {
  const dir = tmpBoard();
  assert.ok(!fs.existsSync(path.join(dir, '.todos')));
  const made = writeText(dir, '7', '- [ ] first\n- [ ] second\n');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, '.todos')), ['0007.todo.md']);
  assert.strictEqual(read(dir, FILE), '- [ ] first\n- [ ] second\n');
  assert.strictEqual(made.exists, true);
  writeText(dir, 'I2', 'group notes');
  assert.strictEqual(read(dir, '.todos/I0002.todo.md'), 'group notes');
});

test('a whole-text write keeps a byte order mark, and the text read back is the text written', () => {
  const dir = tmpBoard(undefined, { [FILE]: '\uFEFF- [ ] one\r\n' });
  const made = writeText(dir, '7', '- [x] one\n- [ ] two\n');
  assert.strictEqual(read(dir, FILE), '\uFEFF- [x] one\r\n- [ ] two\r\n');
  assert.strictEqual(made.text, '- [x] one\n- [ ] two\n');
  assert.deepStrictEqual(td.counts(dir), { 7: { open: 1, total: 2 } });
});
