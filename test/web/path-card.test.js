const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lb = require('../../plugin/skills/web/scripts/logbook-store');
const sp = require('../../plugin/skills/web/scripts/scratchpad-store');
const td = require('../../plugin/skills/web/scripts/todo-store');

// The path of the logbook, scratchpad or todos may hold <card> (docs/adr/0023): the target's file
// name without its extension, matched to its target by the id at the front of the folder's name.

function tmpBoard(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-path-card-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

function card(dir, file, id) {
  fs.writeFileSync(path.join(dir, file), `---\nid: ${id}\nstatus: todo\n---\n# a card\n`);
}

function group(dir, file, id, extra = '') {
  const folder = path.join(dir, '.groups');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, file), `---\nid: ${id}\nname: x\n${extra}cards: []\n---\n`);
}

const at = (dir, ...parts) => path.join(dir, ...parts);
const list = (p) => (fs.existsSync(p) ? fs.readdirSync(p).sort() : []);

test('a card\'s scratchpad page goes to a folder named by its card file', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>/.scratchpad\n');
  card(dir, '0007.fix-login.card.md', 7);
  const pad = sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(list(at(dir, 'pads', '0007.fix-login', '.scratchpad')), ['0007.scratchpad.md']);
  assert.strictEqual(pad.folder, 'pads/0007.fix-login/.scratchpad');
});

test('an archived card names its folder too', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>\n');
  fs.mkdirSync(at(dir, 'archived'));
  card(dir, 'archived/0007.old-one.card.md', 7);
  sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(list(at(dir, 'pads')), ['0007.old-one']);
});

test('a group\'s todo list goes to a folder named by its group file', () => {
  const dir = tmpBoard('name: t\ntodos: lists/<card>\ngroups: .groups\n');
  group(dir, 'I0002.zephyr-2.md', 'I2');
  td.addTodo(dir, 'I2', { text: 'a', version: td.readTodos(dir, 'I2').version });
  assert.deepStrictEqual(list(at(dir, 'lists', 'I0002.zephyr-2')), ['I0002.todo.md']);
});

test('a note about a card goes to the card\'s folder, a note about nothing drops the segment', () => {
  const dir = tmpBoard('name: t\nlogbook: log/<card>\n');
  card(dir, '0007.fix-login.card.md', 7);
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'about the card' });
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'about nothing' });
  assert.deepStrictEqual(list(at(dir, 'log')), ['0007.fix-login', '2026.10.16.logbook.md']);
  assert.deepStrictEqual(list(at(dir, 'log', '0007.fix-login')), ['2026.10.16.0007.logbook.md']);
  const notes = lb.listNotes(dir);
  assert.deepStrictEqual(notes.map((n) => [n.note, n.file]).sort(), [['about nothing', '2026.10.16.logbook.md'], ['about the card', '0007.fix-login/2026.10.16.0007.logbook.md']]);
});

test('a renamed card keeps its folder: the folder is matched by the id at its front', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>\n');
  card(dir, '0007.new-name.card.md', 7);
  fs.mkdirSync(at(dir, 'pads', '0007.old-name'), { recursive: true });
  sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(list(at(dir, 'pads')), ['0007.old-name']);
  assert.deepStrictEqual(list(at(dir, 'pads', '0007.old-name')), ['0007.scratchpad.md']);
});

test('a folder whose id is padded differently still matches', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>\n');
  card(dir, '0007.fix-login.card.md', 7);
  fs.mkdirSync(at(dir, 'pads', '7.short'), { recursive: true });
  sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(list(at(dir, 'pads')), ['7.short']);
});

test('of several folders with the card\'s id, the one named as the card file is named wins', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>\n');
  card(dir, '0007.fix-login.card.md', 7);
  fs.mkdirSync(at(dir, 'pads', '0007.a-first'), { recursive: true });
  fs.mkdirSync(at(dir, 'pads', '0007.fix-login'), { recursive: true });
  sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(list(at(dir, 'pads', '0007.fix-login')), ['0007.scratchpad.md']);
});

test('a page that exists is read and written where it is, even after its card is renamed', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>\n');
  card(dir, '0007.first-name.card.md', 7);
  sp.writePad(dir, '7', 'one');
  fs.renameSync(at(dir, '0007.first-name.card.md'), at(dir, '0007.second-name.card.md'));
  assert.strictEqual(sp.readPad(dir, '7').body, 'one');
  const again = sp.writePad(dir, '7', 'two');
  assert.strictEqual(again.folder, 'pads/0007.first-name');
  assert.deepStrictEqual(list(at(dir, 'pads')), ['0007.first-name']);
});

test('reading covers every card folder and the folder with the segment dropped', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>\n');
  card(dir, '0007.a.card.md', 7);
  card(dir, '0008.b.card.md', 8);
  sp.writePad(dir, '7', 'x');
  sp.writePad(dir, '8', 'y');
  fs.mkdirSync(at(dir, 'pads'), { recursive: true });
  fs.writeFileSync(at(dir, 'pads', '0009.scratchpad.md'), 'loose');
  assert.deepStrictEqual(sp.listTargets(dir), ['7', '8', '9']);
  assert.strictEqual(sp.readPad(dir, '9').body, 'loose');
});

test('<card> and <iteration> together: both segments are filled', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<iteration>/<card>\ngroups: .groups\n');
  card(dir, '0007.fix-login.card.md', 7);
  fs.mkdirSync(at(dir, '.groups', 'iteration'), { recursive: true });
  fs.writeFileSync(at(dir, '.groups', 'iteration', '0005.sprint-496.md'), '---\nid: 5\nname: x\nstart_date: 2026-10-12\nend_date: 2026-10-23\ncards: [7]\n---\n');
  const pad = sp.writePad(dir, '7', 'x', { today: '2026-10-16' });
  assert.deepStrictEqual(list(at(dir, 'pads', '0005.sprint-496', '0007.fix-login')), ['0007.scratchpad.md']);
  assert.strictEqual(pad.folder, 'pads/0005.sprint-496/0007.fix-login');
});

test('a target with no file is named by its padded id', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>\n');
  sp.writePad(dir, '12', 'x');
  assert.deepStrictEqual(list(at(dir, 'pads')), ['0012']);
});

test('assigning a note to another card puts it in that card\'s folder', () => {
  const dir = tmpBoard('name: t\nlogbook: log/<card>\n');
  card(dir, '0007.a.card.md', 7);
  card(dir, '0008.b.card.md', 8);
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'n' });
  const n = lb.listNotes(dir)[0];
  lb.assignNote(dir, { day: n.day, target: n.target, index: n.index, file: n.file, expect: n }, '8');
  assert.deepStrictEqual(list(at(dir, 'log', '0008.b')), ['2026.10.16.0008.logbook.md']);
});

test('a path with no <card> reads and writes as it always did', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads\n');
  card(dir, '0007.a.card.md', 7);
  const pad = sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(list(at(dir, 'pads')), ['0007.scratchpad.md']);
  assert.strictEqual(pad.folder, undefined);
});

test('cards 7 and 70, G7 and 7, and a group and a card with one number each get their own folder', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>\ngroups: .groups\n');
  card(dir, '0007.seven.card.md', 7);
  card(dir, '0070.seventy.card.md', 70);
  card(dir, 'G0007.goal-seven.card.md', 'G7');
  group(dir, 'I0007.group-seven.md', 'I7');
  for (const id of ['7', '70', 'G7', 'I7']) sp.writePad(dir, id, id);
  assert.deepStrictEqual(list(at(dir, 'pads')), ['0007.seven', '0070.seventy', 'G0007.goal-seven', 'I0007.group-seven']);
  for (const id of ['7', '70', 'G7', 'I7']) assert.strictEqual(sp.readPad(dir, id).body, id);
  assert.strictEqual(list(at(dir, 'pads', '0007.seven')).length, 1);
});

test('a file name cannot add a separator or a .. segment to the path', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<card>/s\ngroups: .groups\n');
  card(dir, '..card.md', 7);
  card(dir, '....card.md', 8);
  group(dir, '...md', 'I2');
  const outside = path.dirname(dir);
  for (const id of ['7', '8', 'I2']) {
    const pad = sp.writePad(dir, id, 'x');
    assert.ok(!pad.folder.split('/').some((s) => s === '..' || s === '.'), pad.folder);
    assert.ok(path.relative(at(dir, 'pads'), at(dir, ...pad.folder.split('/'))).split(path.sep)[0] !== '..', pad.folder);
  }
  assert.deepStrictEqual(list(outside).filter((n) => n === 's'), []);
  assert.strictEqual(list(at(dir, 'pads')).length, 3);
});

test('a variable value is the owner\'s own: <card> filling never adds to it', () => {
  const dir = tmpBoard('name: t\nvars:\n  base: ../sibling/pads\nscratchpad: <base>/<card>\n');
  card(dir, '0007.a.card.md', 7);
  sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(list(path.join(path.dirname(dir), 'sibling', 'pads')), ['0007.a']);
});
