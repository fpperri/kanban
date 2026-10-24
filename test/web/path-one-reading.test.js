const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lb = require('../scripts/logbook-store');
const sp = require('../scripts/scratchpad-store');
const td = require('../scripts/todo-store');

// With <iteration> and <card> side by side, one folder can be named two ways: `work/0007.a` is an
// iteration's folder with the card dropped, or a card's folder with the iteration dropped. It is read
// once, as the kind its id says (docs/adr/0023).

function tmpBoard(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-path-one-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

function card(dir, file, id) {
  fs.writeFileSync(path.join(dir, file), `---\nid: ${id}\nstatus: todo\n---\n# a card\n`);
}

function iteration(dir, file, id, cards) {
  const folder = path.join(dir, '.groups', 'iteration');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, file), `---\nid: ${id}\nname: x\nstart_date: 2026-10-12\nend_date: 2026-10-23\ncards: [${cards.join(', ')}]\n---\n`);
}

const at = (dir, ...parts) => path.join(dir, ...parts);
const list = (p) => (fs.existsSync(p) ? fs.readdirSync(p).sort() : []);
const SIDE_BY_SIDE = 'name: t\nlogbook: work/<iteration>/<card>/.logbook\nscratchpad: work/<iteration>/<card>/.pad\ntodos: work/<iteration>/<card>/.pad\ngroups: .groups\n';

test('with no iteration, a note in a card\'s folder lists once', () => {
  const dir = tmpBoard(SIDE_BY_SIDE);
  card(dir, '0007.a.card.md', 7);
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'one' });
  assert.deepStrictEqual(list(at(dir, 'work')), ['0007.a']);
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note), ['one']);
});

test('with no iteration, a card\'s page and list in its folder count once', () => {
  const dir = tmpBoard(SIDE_BY_SIDE);
  card(dir, '0007.a.card.md', 7);
  sp.writePad(dir, '7', 'x');
  td.addTodo(dir, '7', { text: 'a', version: td.readTodos(dir, '7').version });
  assert.deepStrictEqual(sp.listTargets(dir), ['7']);
  assert.deepStrictEqual(td.listTargets(dir), ['7']);
  assert.deepStrictEqual(td.counts(dir), { 7: { open: 1, total: 1 } });
});

test('a note in a card\'s folder assigned to another card goes to that card\'s folder', () => {
  const dir = tmpBoard(SIDE_BY_SIDE);
  card(dir, '0007.a.card.md', 7);
  card(dir, '0008.b.card.md', 8);
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'n' });
  const n = lb.listNotes(dir)[0];
  lb.assignNote(dir, { day: n.day, target: n.target, index: n.index, file: n.file, expect: n }, '8');
  assert.deepStrictEqual(list(at(dir, 'work')), ['0007.a', '0008.b']);
  assert.deepStrictEqual(list(at(dir, 'work', '0008.b', '.logbook')), ['2026.10.16.0008.logbook.md']);
  assert.deepStrictEqual(list(at(dir, 'work', '0007.a')), ['.logbook']);
  assert.deepStrictEqual(lb.listNotes(dir).map((n2) => [n2.target, n2.note]), [['8', 'n']]);
});

test('an iteration\'s folder still reads as the iteration\'s: a note about nothing in it lists once and moves within it', () => {
  const dir = tmpBoard(SIDE_BY_SIDE);
  card(dir, '0007.a.card.md', 7);
  iteration(dir, '0005.sprint-496.md', 5, []);
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'board' });
  assert.deepStrictEqual(list(at(dir, 'work', '0005.sprint-496', '.logbook')), ['2026.10.16.logbook.md']);
  const notes = lb.listNotes(dir);
  assert.deepStrictEqual(notes.map((n) => n.note), ['board']);
  const n = notes[0];
  lb.assignNote(dir, { day: n.day, target: n.target, index: n.index, file: n.file, expect: n }, '7');
  assert.deepStrictEqual(list(at(dir, 'work', '0005.sprint-496', '0007.a', '.logbook')), ['2026.10.16.0007.logbook.md']);
});

test('a card\'s folder inside an iteration\'s folder and a card\'s folder outside both read once', () => {
  const dir = tmpBoard(SIDE_BY_SIDE);
  card(dir, '0007.a.card.md', 7);
  card(dir, '0008.b.card.md', 8);
  iteration(dir, '0005.sprint-496.md', 5, [7]);
  sp.writePad(dir, '7', 'in', { today: '2026-10-16' });
  sp.writePad(dir, '8', 'out', { today: '2026-11-30' });
  assert.deepStrictEqual(list(at(dir, 'work')), ['0005.sprint-496', '0008.b']);
  assert.deepStrictEqual(sp.listTargets(dir), ['7', '8']);
  assert.strictEqual(sp.readPad(dir, '7').body, 'in');
  assert.strictEqual(sp.readPad(dir, '8').body, 'out');
});
