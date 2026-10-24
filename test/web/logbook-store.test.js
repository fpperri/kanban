const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lb = require('../../plugin/skills/web/scripts/logbook-store');

function tmpBoard(config = 'name: t\nlogbook: logbook\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-logbook-'));
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

const folder = (dir) => path.join(dir, 'logbook');
const read = (dir, name) => fs.readFileSync(path.join(folder(dir), name), 'utf8');
const names = (dir) => (fs.existsSync(folder(dir)) ? fs.readdirSync(folder(dir)).sort() : []);
function put(dir, name, text) {
  fs.mkdirSync(folder(dir), { recursive: true });
  fs.writeFileSync(path.join(folder(dir), name), text);
}

test('with no logbook: line nothing is listed and a write is refused', () => {
  const dir = tmpBoard('name: t\n');
  assert.deepStrictEqual(lb.listNotes(dir), []);
  assert.throws(() => lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'x' }), (e) => e.status === 404);
  assert.deepStrictEqual(names(dir), []);
});

test('a note lands in the day file of its card, named by day and padded id', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'two enum renames left' });
  assert.deepStrictEqual(names(dir), ['2026.10.16.0007.logbook.md']);
  assert.strictEqual(read(dir, '2026.10.16.0007.logbook.md'), '---\nentries:\n  - at: "09:10"\n    by: "@human"\n    note: two enum renames left\n---\n');
});

test('a note on nothing goes to the day file with no id; a prefixed id is padded after its prefix', () => {
  const dir = tmpBoard('name: t\nlogbook: logbook\nidDigits: 3\n');
  lb.addNote(dir, { day: '2026-10-16', target: '', note: 'standup ran long' });
  lb.addNote(dir, { day: '2026-10-16', target: 'G3', at: '08:00', note: 'goal reread' });
  assert.deepStrictEqual(names(dir), ['2026.10.16.G003.logbook.md', '2026.10.16.logbook.md']);
});

test('an untimed note has no at line; entries sort by time with untimed last', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', note: 'untimed one' });
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '14:00', note: 'later' });
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', by: '@afk', note: 'earlier' });
  assert.strictEqual(read(dir, '2026.10.16.0007.logbook.md'),
    '---\nentries:\n  - at: "09:10"\n    by: "@afk"\n    note: earlier\n  - at: "14:00"\n    by: "@human"\n    note: later\n  - by: "@human"\n    note: untimed one\n---\n');
});

test('listNotes reads every day file: day, target, time, author, text, and its place in the file', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
  lb.addNote(dir, { day: '2026-10-15', target: '', note: 'b' });
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '08:00', by: '@afk', note: 'c' });
  const notes = lb.listNotes(dir).map((n) => [n.day, n.target, n.index, n.at, n.by, n.note]);
  assert.deepStrictEqual(notes.sort((x, y) => String(x).localeCompare(String(y))), [
    ['2026-10-15', '', 0, null, '@human', 'b'],
    ['2026-10-16', '7', 0, '08:00', '@afk', 'c'],
    ['2026-10-16', '7', 1, '09:10', '@human', 'a'],
  ]);
});

test('a hand-written file is read whatever its padding, quoting, order and layout', () => {
  const dir = tmpBoard();
  put(dir, '2026.10.16.7.logbook.md', '---\nentries:\n- at: 9:05\n  by: "@afk"\n  note: "said \\"hi\\" # kept"\n- note: bare text with #12 in it\n  at: "11:00"\n---\nfree text\n');
  const notes = lb.listNotes(dir);
  assert.deepStrictEqual(notes.map((n) => [n.target, n.at, n.by, n.note]), [
    ['7', '09:05', '@afk', 'said "hi" # kept'],
    ['7', '11:00', '', 'bare text with #12 in it'],
  ]);
});

test('files that are not day files, or name no id, are skipped', () => {
  const dir = tmpBoard();
  put(dir, 'README.md', 'x');
  put(dir, '2026.10.16.logbook.md.tmp', 'x');
  put(dir, '2026.13.40.logbook.md', '---\nentries:\n  - note: a\n---\n');
  put(dir, '2026.10.16.zz.logbook.md', '---\nentries:\n  - note: a\n---\n');
  put(dir, '2026.10.16.0007.logbook.md', '---\nentries:\n  - note: kept\n---\n');
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note), ['kept']);
});

test('a block-scalar note reads its lines; a note with newlines is written as one', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'first line\n  indented second\n\nlast' });
  const text = read(dir, '2026.10.16.0007.logbook.md');
  assert.strictEqual(text, '---\nentries:\n  - at: "09:10"\n    by: "@human"\n    note: |-\n      first line\n        indented second\n\n      last\n---\n');
  assert.strictEqual(lb.listNotes(dir)[0].note, 'first line\n  indented second\n\nlast');
});

test('a note that plain YAML would misread is written quoted and reads back whole', () => {
  const dir = tmpBoard();
  const tricky = ['fixed #12 today', 'key: value', '- dash first', '"quoted"', '42', 'true', ' padded ', 'tab\there', 'back\\slash', '@afk asked', '[x]', 'ends with colon:'];
  for (const note of tricky) lb.addNote(dir, { day: '2026-10-16', target: '7', note });
  const back = lb.listNotes(dir).map((n) => n.note).sort();
  assert.deepStrictEqual(back, tricky.map((n) => n.trim()).sort());
  for (const note of ['fixed #12 today', 'key: value', '42', 'true']) {
    assert.ok(read(dir, '2026.10.16.0007.logbook.md').includes(`note: "${note}"`), note);
  }
});

test('a write keeps unknown frontmatter keys, unknown entry keys, comments and the body byte for byte', () => {
  const dir = tmpBoard();
  const before = '---\ntitle: Friday\nentries:\n  # morning\n  - at: "09:10"\n    mood: tired\n    by: "@human"\n    note: first\n    tags: [a, b]\n---\n\nFree markdown.\n- a list\n';
  put(dir, '2026.10.16.0007.logbook.md', before);
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', note: 'second' });
  assert.strictEqual(read(dir, '2026.10.16.0007.logbook.md'),
    '---\ntitle: Friday\nentries:\n  # morning\n  - at: "09:10"\n    mood: tired\n    by: "@human"\n    note: first\n    tags: [a, b]\n  - at: "10:00"\n    by: "@human"\n    note: second\n---\n\nFree markdown.\n- a list\n');
});

test('a file with a body and frontmatter keys after the entries keeps them', () => {
  const dir = tmpBoard();
  put(dir, '2026.10.16.0007.logbook.md', '---\nentries:\n  - at: "09:10"\n    by: "@human"\n    note: first\nmood: calm\n---\nbody\n');
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '08:00', note: 'zero' });
  assert.strictEqual(read(dir, '2026.10.16.0007.logbook.md'),
    '---\nentries:\n  - at: "08:00"\n    by: "@human"\n    note: zero\n  - at: "09:10"\n    by: "@human"\n    note: first\nmood: calm\n---\nbody\n');
});

test('a file with no frontmatter keeps its text as the body when a note is added', () => {
  const dir = tmpBoard();
  put(dir, '2026.10.16.0007.logbook.md', 'just some text\n');
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '08:00', note: 'zero' });
  assert.strictEqual(read(dir, '2026.10.16.0007.logbook.md'), '---\nentries:\n  - at: "08:00"\n    by: "@human"\n    note: zero\n---\njust some text\n');
});

test('CRLF files stay CRLF', () => {
  const dir = tmpBoard();
  put(dir, '2026.10.16.0007.logbook.md', '---\r\nentries:\r\n  - at: "09:10"\r\n    by: "@human"\r\n    note: first\r\n---\r\nbody\r\n');
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', note: 'second' });
  assert.strictEqual(read(dir, '2026.10.16.0007.logbook.md'),
    '---\r\nentries:\r\n  - at: "09:10"\r\n    by: "@human"\r\n    note: first\r\n  - at: "10:00"\r\n    by: "@human"\r\n    note: second\r\n---\r\nbody\r\n');
});

test('a note is added to the file that already holds that day and card, whatever its padding', () => {
  const dir = tmpBoard();
  put(dir, '2026.10.16.7.logbook.md', '---\nentries:\n  - at: "09:10"\n    note: old\n---\n');
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', note: 'new' });
  assert.deepStrictEqual(names(dir), ['2026.10.16.7.logbook.md']);
  assert.strictEqual(lb.listNotes(dir).length, 2);
});

test('edit changes the text and the time of one note and leaves the others', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', note: 'b' });
  const [a, b] = lb.listNotes(dir);
  lb.editNote(dir, { day: a.day, target: a.target, index: a.index, expect: a }, { at: '11:30', note: 'a, changed' });
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => [n.at, n.note]), [['10:00', 'b'], ['11:30', 'a, changed']]);
  const now = lb.listNotes(dir).find((n) => n.note === 'b');
  lb.editNote(dir, { day: now.day, target: now.target, index: now.index, expect: now }, { at: '' });
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => [n.at, n.note]), [['11:30', 'a, changed'], [null, 'b']]);
  assert.ok(b);
});

test('edit refuses an empty text and a time that is not HH:MM', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
  const n = lb.listNotes(dir)[0];
  const ref = { day: n.day, target: n.target, index: n.index, expect: n };
  assert.throws(() => lb.editNote(dir, ref, { note: '   ' }), (e) => e.status === 400);
  assert.throws(() => lb.editNote(dir, ref, { at: '9:7' }), (e) => e.status === 400);
  assert.throws(() => lb.editNote(dir, ref, { at: '24:00' }), (e) => e.status === 400);
});

test('edit and delete find a note that moved when the file changed, and refuse one that is gone', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', note: 'b' });
  const b = lb.listNotes(dir).find((n) => n.note === 'b');
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '08:00', note: 'earlier' });
  lb.deleteNote(dir, { day: b.day, target: b.target, index: b.index, expect: b });
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note), ['earlier', 'a']);
  assert.throws(() => lb.deleteNote(dir, { day: b.day, target: b.target, index: b.index, expect: b }), (e) => e.status === 409);
});

test('deleting the last note removes the file, but a file with a body stays', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
  let n = lb.listNotes(dir)[0];
  lb.deleteNote(dir, { day: n.day, target: n.target, index: n.index, expect: n });
  assert.deepStrictEqual(names(dir), []);
  put(dir, '2026.10.16.0008.logbook.md', '---\nentries:\n  - at: "09:10"\n    note: a\n---\nkeep me\n');
  n = lb.listNotes(dir)[0];
  lb.deleteNote(dir, { day: n.day, target: n.target, index: n.index, expect: n });
  assert.strictEqual(read(dir, '2026.10.16.0008.logbook.md'), '---\nentries:\n---\nkeep me\n');
  assert.deepStrictEqual(lb.listNotes(dir), []);
});

test('assign moves one note to the other target for the same day and removes a file left empty', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', by: '@afk', note: 'b' });
  const a = lb.listNotes(dir).find((n) => n.note === 'a');
  lb.assignNote(dir, { day: a.day, target: a.target, index: a.index, expect: a }, '22');
  assert.deepStrictEqual(names(dir), ['2026.10.16.0007.logbook.md', '2026.10.16.0022.logbook.md']);
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => [n.target, n.at, n.by, n.note]).sort(), [['22', '09:10', '@human', 'a'], ['7', '10:00', '@afk', 'b']]);
  const b = lb.listNotes(dir).find((n) => n.note === 'b');
  lb.assignNote(dir, { day: b.day, target: b.target, index: b.index, expect: b }, '');
  assert.deepStrictEqual(names(dir), ['2026.10.16.0022.logbook.md', '2026.10.16.logbook.md']);
});

test('assign to the target the note is already on is refused', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
  const a = lb.listNotes(dir)[0];
  assert.throws(() => lb.assignNote(dir, { day: a.day, target: a.target, index: a.index, expect: a }, '7'), (e) => e.status === 400);
  assert.strictEqual(lb.listNotes(dir).length, 1);
});

test('request text never builds a path: a bad day, id or time is refused and nothing is written', () => {
  const dir = tmpBoard();
  const bad = [
    { day: '2026-10-16/../x', target: '7', note: 'x' },
    { day: '2026-13-01', target: '7', note: 'x' },
    { day: '2026-02-30', target: '7', note: 'x' },
    { day: '2026-10-16', target: '../7', note: 'x' },
    { day: '2026-10-16', target: 'g7', note: 'x' },
    { day: '2026-10-16', target: '7', at: '9:10', note: 'x' },
    { day: '2026-10-16', target: '7', note: '' },
    { day: '2026-10-16', target: '7', note: 'x', by: ['@afk'] },
  ];
  for (const input of bad) assert.throws(() => lb.addNote(dir, input), (e) => e.status === 400, JSON.stringify(input));
  assert.deepStrictEqual(names(dir), []);
});

test('two writers on one day file both land: a change between read and write is re-read and reapplied once', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'first' });
  let raced = false;
  const hooks = {
    afterRead() {
      if (raced) return;
      raced = true;
      const file = path.join(folder(dir), '2026.10.16.0007.logbook.md');
      const text = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, text.replace(/---\n$/, '  - at: "09:30"\n    by: "@afk"\n    note: agent line\n---\n'));
    },
  };
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', note: 'web line' }, hooks);
  assert.deepStrictEqual(lb.listNotes(dir).map((n) => n.note), ['first', 'agent line', 'web line']);
});

test('a day file that keeps changing is a conflict after the one retry, and nothing of the web write lands', () => {
  const dir = tmpBoard();
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'first' });
  const file = path.join(folder(dir), '2026.10.16.0007.logbook.md');
  let n = 0;
  const hooks = {
    afterRead() {
      n += 1;
      fs.appendFileSync(file, `\nbody ${n}\n`);
    },
  };
  assert.throws(() => lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', note: 'web line' }, hooks), (e) => e.status === 409);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(lb.listNotes(dir).map((x) => x.note), ['first']);
  assert.deepStrictEqual(names(dir), ['2026.10.16.0007.logbook.md']);
});

test('a first write that races another creating the same file keeps both', () => {
  const dir = tmpBoard();
  const file = path.join(folder(dir), '2026.10.16.0007.logbook.md');
  let raced = false;
  const hooks = {
    afterRead() {
      if (raced) return;
      raced = true;
      fs.mkdirSync(folder(dir), { recursive: true });
      fs.writeFileSync(file, '---\nentries:\n  - at: "09:30"\n    by: "@afk"\n    note: agent line\n---\n');
    },
  };
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '10:00', note: 'web line' }, hooks);
  assert.deepStrictEqual(lb.listNotes(dir).map((x) => x.note), ['agent line', 'web line']);
});

test('a logbook folder written by hand outside the board is read and written', () => {
  const dir = tmpBoard(null);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-logbook-out-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), `name: t\nlogbook: ${JSON.stringify(out)}\n`);
  lb.addNote(dir, { day: '2026-10-16', target: '7', at: '09:10', note: 'outside' });
  assert.deepStrictEqual(fs.readdirSync(out), ['2026.10.16.0007.logbook.md']);
  assert.strictEqual(lb.listNotes(dir)[0].note, 'outside');
});
