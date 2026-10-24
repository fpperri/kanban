const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lb = require('../../plugin/skills/web/scripts/logbook-store');
const gs = require('../../plugin/skills/web/scripts/group-store');

// A board whose logbook: names <iteration> (docs/adr/0019), with its groups under .groups.
function tmpBoard(config = 'name: t\nlogbook: sprints/<iteration>/.logbook\ngroups: .groups\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-logbook-iter-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

function iteration(dir, id, fileName, start, end, extra = '') {
  const folder = path.join(dir, '.groups', 'iteration');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${fileName}.md`), `---\nid: ${id}\nname: x\n${start ? `start_date: ${start}\n` : ''}${end ? `end_date: ${end}\n` : ''}${extra}cards: []\n---\n`);
}

const at = (dir, ...parts) => path.join(dir, ...parts);
const list = (p) => (fs.existsSync(p) ? fs.readdirSync(p).sort() : []);
const sprints = (dir) => list(at(dir, 'sprints'));

function twoSprints(dir) {
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  iteration(dir, '6', '0006.sprint-497', '2026-10-26', '2026-11-06');
}

test('a note on a day inside an iteration lands in that iteration\'s folder', () => {
  const dir = tmpBoard();
  twoSprints(dir);
  const made = lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'inside' });
  assert.deepStrictEqual(sprints(dir), ['0005.sprint-496']);
  assert.deepStrictEqual(list(at(dir, 'sprints', '0005.sprint-496', '.logbook')), ['2026.10.16.0007.logbook.md']);
  assert.strictEqual(made.file, '0005.sprint-496/2026.10.16.0007.logbook.md');
});

test('a note on a day no iteration holds drops the segment, and both list', () => {
  const dir = tmpBoard();
  twoSprints(dir);
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'inside' });
  const out = lb.addNote(dir, { day: '2026-10-25', target: '', note: 'between' });
  assert.deepStrictEqual(list(at(dir, 'sprints', '.logbook')), ['2026.10.25.logbook.md']);
  assert.strictEqual(out.file, '2026.10.25.logbook.md');
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => [n.day, n.note, n.file]).sort(), [
    ['2026-10-16', 'inside', '0005.sprint-496/2026.10.16.0007.logbook.md'],
    ['2026-10-25', 'between', '2026.10.25.logbook.md'],
  ]);
});

test('both end days of an iteration hold a note', () => {
  const dir = tmpBoard();
  twoSprints(dir);
  lb.addNote(dir, { day: '2026-10-12', target: '', note: 'first day' });
  lb.addNote(dir, { day: '2026-10-23', target: '', note: 'last day' });
  assert.deepStrictEqual(list(at(dir, 'sprints', '0005.sprint-496', '.logbook')), ['2026.10.12.logbook.md', '2026.10.23.logbook.md']);
});

test('two iterations holding a day: the one that started first wins', () => {
  const dir = tmpBoard();
  iteration(dir, '6', '0006.later', '2026-10-14', '2026-10-30');
  iteration(dir, '5', '0005.earlier', '2026-10-12', '2026-10-23');
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'overlap' });
  assert.deepStrictEqual(sprints(dir), ['0005.earlier']);
});

test('a note aimed at an iteration goes to that iteration whatever its day', () => {
  const dir = tmpBoard();
  twoSprints(dir);
  lb.addNote(dir, { day: '2026-10-16', target: '6', note: 'aimed' });
  assert.deepStrictEqual(sprints(dir), ['0006.sprint-497']);
  lb.addNote(dir, { day: '2027-01-01', target: '5', note: 'aimed, far day' });
  assert.deepStrictEqual(sprints(dir), ['0005.sprint-496', '0006.sprint-497']);
});

test('an undated iteration holds no day, but a note aimed at it still goes to its folder', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.open', '', '');
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'by day' });
  assert.deepStrictEqual(sprints(dir), ['.logbook']);
  lb.addNote(dir, { day: '2026-10-16', target: '5', note: 'aimed' });
  assert.deepStrictEqual(sprints(dir), ['.logbook', '0005.open']);
});

test('only groups in the iteration folder are iterations', () => {
  const dir = tmpBoard();
  fs.mkdirSync(at(dir, '.groups', 'workflow'), { recursive: true });
  fs.writeFileSync(at(dir, '.groups', 'workflow', '0005.flow.md'), '---\nid: 5\nname: flow\nstart_date: 2026-10-12\nend_date: 2026-10-23\ncards: []\n---\n');
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'x' });
  assert.deepStrictEqual(sprints(dir), ['.logbook']);
});

test('a renamed group keeps its folder: the folder is matched by the id at its front', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.new-name', '2026-10-12', '2026-10-23');
  fs.mkdirSync(at(dir, 'sprints', '0005.old-name', '.logbook'), { recursive: true });
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'x' });
  assert.deepStrictEqual(sprints(dir), ['0005.old-name']);
  assert.deepStrictEqual(list(at(dir, 'sprints', '0005.old-name', '.logbook')), ['2026.10.16.logbook.md']);
});

test('a folder whose id is padded differently still matches', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint', '2026-10-12', '2026-10-23');
  fs.mkdirSync(at(dir, 'sprints', '5', '.logbook'), { recursive: true });
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'x' });
  assert.deepStrictEqual(sprints(dir), ['5']);
});

test('with no groups: line the segment is dropped', () => {
  const dir = tmpBoard('name: t\nlogbook: sprints/<iteration>/.logbook\n');
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'x' });
  assert.deepStrictEqual(sprints(dir), ['.logbook']);
});

test('the placeholder may lead the path or end it', () => {
  const lead = tmpBoard('name: t\nlogbook: <iteration>/log\ngroups: .groups\n');
  twoSprints(lead);
  lb.addNote(lead, { day: '2026-10-16', target: '', note: 'x' });
  assert.deepStrictEqual(list(at(lead, '0005.sprint-496', 'log')), ['2026.10.16.logbook.md']);
  const end = tmpBoard('name: t\nlogbook: runs/<iteration>\ngroups: .groups\n');
  twoSprints(end);
  lb.addNote(end, { day: '2026-10-16', target: '', note: 'in' });
  lb.addNote(end, { day: '2026-10-25', target: '', note: 'out' });
  assert.deepStrictEqual(list(at(end, 'runs')), ['0005.sprint-496', '2026.10.25.logbook.md']);
  assert.deepStrictEqual(lb.listNotes(end).map((n) => n.note).sort(), ['in', 'out']);
});

test('reading covers each iteration folder that exists, a past one included, and the dropped folder', () => {
  const dir = tmpBoard();
  iteration(dir, '6', '0006.now', '2026-10-26', '2026-11-06');
  const put = (rel, note) => {
    fs.mkdirSync(at(dir, ...rel.slice(0, -1)), { recursive: true });
    fs.writeFileSync(at(dir, ...rel), `---\nentries:\n  - note: ${note}\n---\n`);
  };
  put(['sprints', '0003.gone', '.logbook', '2026.09.01.logbook.md'], 'past');
  put(['sprints', '0006.now', '.logbook', '2026.10.27.logbook.md'], 'current');
  put(['sprints', '.logbook', '2026.10.01.logbook.md'], 'loose');
  put(['sprints', 'notes', '.logbook', '2026.10.02.logbook.md'], 'not an iteration folder');
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note).sort(), ['current', 'loose', 'past']);
});

test('an unknown placeholder reads as an ordinary folder name; a write to it is refused with what and why', () => {
  const dir = tmpBoard('name: t\nlogbook: sprints/<sprint>/.logbook\ngroups: .groups\n');
  assert.deepStrictEqual(lb.listNotes(dir), []);
  assert.throws(() => lb.addNote(dir, { day: '2026-10-16', target: '', note: 'x' }), (e) => e.status === 400 && /Windows/.test(e.message) && /<iteration>/.test(e.message) && /< or >/.test(e.message), 'a one-sentence refusal');
  assert.deepStrictEqual(list(at(dir, 'sprints')), []);
});

test('a path without the placeholder reads and writes as it always did', () => {
  const dir = tmpBoard('name: t\nlogbook: log\ngroups: .groups\n');
  twoSprints(dir);
  const made = lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'x' });
  assert.strictEqual(made.file, '2026.10.16.0007.logbook.md');
  assert.deepStrictEqual(list(at(dir, 'log')), ['2026.10.16.0007.logbook.md']);
});

test('edit and delete act on the file the note is in, and move nothing', () => {
  const dir = tmpBoard();
  twoSprints(dir);
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
  lb.addNote(dir, { day: '2026-10-25', target: '7', at: '09:10', note: 'b' });
  const find = (note) => lb.listNotes(dir).find((n) => n.note === note);
  const a = find('a');
  const edited = lb.editNote(dir, { day: a.day, target: a.target, index: a.index, file: a.file, expect: a }, { note: 'a2' });
  assert.strictEqual(edited.file, '0005.sprint-496/2026.10.16.0007.logbook.md');
  const b = find('b');
  lb.deleteNote(dir, { day: b.day, target: b.target, index: b.index, file: b.file, expect: b });
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note), ['a2']);
  assert.deepStrictEqual(list(at(dir, 'sprints', '.logbook')), []);
});

test('a note joins the day file that already exists, even in the folder with the segment dropped', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:00', note: 'before the iteration existed' });
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  const second = lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', note: 'after' });
  assert.strictEqual(second.file, '2026.10.16.0007.logbook.md');
  assert.deepStrictEqual(sprints(dir), ['.logbook']);
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => [n.note, n.file]), [
    ['before the iteration existed', '2026.10.16.0007.logbook.md'],
    ['after', '2026.10.16.0007.logbook.md'],
  ]);
});

test('a note joins the existing day file in an iteration folder when the rules would now say another', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'first' });
  iteration(dir, '4', '0004.earlier', '2026-10-01', '2026-10-30');
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'second' });
  assert.deepStrictEqual(sprints(dir), ['0005.sprint-496']);
});

test('the same day and target in two folders are two files; a ref names the one it means', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'before the iteration existed' });
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  fs.mkdirSync(at(dir, 'sprints', '0005.sprint-496', '.logbook'), { recursive: true });
  fs.writeFileSync(at(dir, 'sprints', '0005.sprint-496', '.logbook', '2026.10.16.0007.logbook.md'), '---\nentries:\n  - note: after\n---\n');
  const notes = lb.listNotes(dir);
  assert.deepStrictEqual(notes.map((n) => [n.note, n.file]).sort(), [
    ['after', '0005.sprint-496/2026.10.16.0007.logbook.md'],
    ['before the iteration existed', '2026.10.16.0007.logbook.md'],
  ]);
  const old = notes.find((n) => n.note.startsWith('before'));
  lb.deleteNote(dir, { day: old.day, target: old.target, index: old.index, file: old.file, expect: old });
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note), ['after']);
});

const refOf = (n) => ({ day: n.day, target: n.target, index: n.index, file: n.file, expect: n });

test('assigning to an iteration itself moves the note into that iteration\'s folder', () => {
  const dir = tmpBoard();
  twoSprints(dir);
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
  const a = lb.listNotes(dir)[0];
  const moved = lb.assignNote(dir, refOf(a), '6');
  assert.strictEqual(moved.file, '0006.sprint-497/2026.10.16.0006.logbook.md');
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.file), ['0006.sprint-497/2026.10.16.0006.logbook.md']);
  assert.deepStrictEqual(list(at(dir, 'sprints', '0005.sprint-496', '.logbook')), []);
});

test('assigning to a card or to nothing keeps the note in the folder it is in', () => {
  const dir = tmpBoard();
  twoSprints(dir);
  lb.addNote(dir, { day: '2026-10-16', target: '6', at: '09:10', note: 'a' });
  const a = lb.listNotes(dir)[0];
  assert.strictEqual(a.file, '0006.sprint-497/2026.10.16.0006.logbook.md');
  const moved = lb.assignNote(dir, refOf(a), '7');
  assert.strictEqual(moved.file, '0006.sprint-497/2026.10.16.0007.logbook.md');
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.file), ['0006.sprint-497/2026.10.16.0007.logbook.md']);
  assert.deepStrictEqual(list(at(dir, 'sprints', '0005.sprint-496', '.logbook')), []);
  const b = lb.listNotes(dir)[0];
  assert.strictEqual(lb.assignNote(dir, refOf(b), '').file, '0006.sprint-497/2026.10.16.logbook.md');
});

test('assigning a loose note keeps it in the dropped-segment folder, whatever iteration holds its day', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'a' });
  twoSprints(dir);
  const a = lb.listNotes(dir)[0];
  const moved = lb.assignNote(dir, refOf(a), '8');
  assert.strictEqual(moved.file, '2026.10.16.0008.logbook.md');
  assert.deepStrictEqual(sprints(dir), ['.logbook']);
});

test('assigning to a target that already has a day file for that day joins it, in whichever folder it is', () => {
  const dir = tmpBoard();
  twoSprints(dir);
  lb.addNote(dir, { day: '2026-10-16', target: '8', at: '08:00', note: 'in the iteration' });
  fs.mkdirSync(at(dir, 'sprints', '.logbook'), { recursive: true });
  fs.writeFileSync(at(dir, 'sprints', '.logbook', '2026.10.16.0007.logbook.md'), '---\nentries:\n  - note: already there\n---\n');
  const a = lb.listNotes(dir).find((n) => n.note === 'in the iteration');
  const moved = lb.assignNote(dir, refOf(a), '7');
  assert.strictEqual(moved.file, '2026.10.16.0007.logbook.md');
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => [n.note, n.file]).sort(), [
    ['already there', '2026.10.16.0007.logbook.md'],
    ['in the iteration', '2026.10.16.0007.logbook.md'],
  ]);
});

test('deleting a target\'s files sweeps every folder', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'loose' });
  twoSprints(dir);
  lb.addNote(dir, { day: '2026-10-27', target: '7', note: 'in' });
  lb.addNote(dir, { day: '2026-10-28', target: '7', note: 'in 2' });
  lb.addNote(dir, { day: '2026-10-16', target: '8', note: 'other' });
  assert.strictEqual(lb.deleteTargetFiles(dir, '7'), 3);
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note), ['other']);
});

test('groups reads the iteration file name the folder takes', () => {
  const dir = tmpBoard();
  twoSprints(dir);
  assert.deepStrictEqual(gs.readGroups(dir).list.map((g) => g.file), ['.groups/iteration/0005.sprint-496.md', '.groups/iteration/0006.sprint-497.md']);
});

test('a group file whose name does not start with its id still gets a folder that reads back', () => {
  const dir = tmpBoard();
  iteration(dir, '5', 'sprint-496', '2026-10-12', '2026-10-23');
  const made = lb.addNote(dir, { day: '2026-10-16', target: '', note: 'x' });
  assert.strictEqual(made.file, '0005.sprint-496/2026.10.16.logbook.md');
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note), ['x']);
});
