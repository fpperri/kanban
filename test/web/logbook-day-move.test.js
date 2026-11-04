const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeRoute } = require('../../plugin/skills/web/scripts/route');

// PATCH /api/notes with a day: the note moves to the day file of that day for its target, the way
// assign moves one to another target. Over a real board folder.

const CARD = (id) => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# Card ${id}\n`;

function board(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-daymove-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: t\nlogbook: logbook\n');
  fs.writeFileSync(path.join(dir, '0007.seven.card.md'), CARD(7));
  fs.mkdirSync(path.join(dir, 'logbook'), { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'logbook', name), text);
  const route = makeRoute(dir);
  const file = (name) => fs.readFileSync(path.join(dir, 'logbook', name), 'utf8');
  const names = () => fs.readdirSync(path.join(dir, 'logbook')).sort();
  const notes = () => route('GET', '/api/board').body.logbook.notes;
  return { dir, route, file, names, notes };
}

const refOf = (n) => ({ day: n.day, target: n.target, index: n.index, file: n.file, expect: { at: n.at, duration: n.duration, by: n.by, note: n.note } });
const D3 = '2026.11.03.0007.logbook.md';
const D4 = '2026.11.04.0007.logbook.md';
const ONE = '---\nentries:\n  - at: "10:30"\n    duration: "45m"\n    colour: teal\n    by: "@afk"\n    note: review\n---\n';

test('a day moves the note to the day file of that day, with its author, text, duration and unknown keys', () => {
  const b = board({ [D3]: ONE });
  const r = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), day: '2026-11-04' });
  assert.deepStrictEqual([r.status, r.body.note.day, r.body.note.target, r.body.note.at, r.body.note.duration, r.body.note.by, r.body.note.file], [200, '2026-11-04', '7', '10:30', '45m', '@afk', D4]);
  assert.deepStrictEqual(b.names(), [D4]);
  assert.strictEqual(b.file(D4), ONE);
});

test('a day with a time and a duration applies them on the target day and holds the duration rules to the result', () => {
  const b = board({ [D3]: ONE });
  const r = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), day: '2026-11-04', at: '11:00', duration: '1h' });
  assert.deepStrictEqual([r.status, r.body.note.at, r.body.note.duration], [200, '11:00', '1h']);
  const bad = board({ [D3]: ONE });
  const before = bad.file(D3);
  const e = bad.route('PATCH', '/api/notes', { ref: refOf(bad.notes()[0]), day: '2026-11-04', at: '23:30', duration: '1h' });
  assert.strictEqual(e.status, 400);
  assert.deepStrictEqual(bad.names(), [D3]);
  assert.strictEqual(bad.file(D3), before);
});

test('a day alone moves a note whose stored time and duration already run past midnight, as an edit of its text would', () => {
  const OVER = '---\nentries:\n  - at: "23:30"\n    duration: "1h"\n    by: "@human"\n    note: late\n---\n';
  const b = board({ [D3]: OVER });
  const r = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), day: '2026-11-04' });
  assert.deepStrictEqual([r.status, r.body.note.day, r.body.note.at, r.body.note.duration], [200, '2026-11-04', '23:30', null]);
  assert.strictEqual(b.file(D4), OVER);
  assert.deepStrictEqual(b.names(), [D4]);
});

test('a day that already has a file joins it, the entries kept in time order, and the source keeps its other notes', () => {
  const b = board({
    [D3]: '---\nentries:\n  - at: "08:00"\n    by: "@human"\n    note: early\n  - at: "10:30"\n    by: "@human"\n    note: moving\n---\n',
    [D4]: '---\nentries:\n  - at: "09:00"\n    by: "@human"\n    note: there\n---\n',
  });
  const moving = b.notes().find((n) => n.note === 'moving');
  const r = b.route('PATCH', '/api/notes', { ref: refOf(moving), day: '2026-11-04' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(b.notes().map((n) => [n.day, n.at, n.note]).sort(), [['2026-11-03', '08:00', 'early'], ['2026-11-04', '09:00', 'there'], ['2026-11-04', '10:30', 'moving']]);
  assert.strictEqual(r.body.note.index, 1);
});

test('a day that is the note\'s own is a plain edit', () => {
  const b = board({ [D3]: ONE });
  const r = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), day: '2026-11-03', at: '11:00' });
  assert.deepStrictEqual([r.status, r.body.note.day, r.body.note.at], [200, '2026-11-03', '11:00']);
  assert.deepStrictEqual(b.names(), [D3]);
});

test('a day that is not a date is refused naming it, and nothing is written', () => {
  const b = board({ [D3]: ONE });
  for (const day of ['04/11/2026', '2026-13-01', 'tomorrow', 5]) {
    const r = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), day });
    assert.strictEqual(r.status, 400, String(day));
    assert.match(r.body.error, /day/, String(day));
  }
  assert.strictEqual(b.file(D3), ONE);
});

test('a note that changed since it was read is refused and no copy is left on the other day', () => {
  const b = board({ [D3]: ONE });
  const seen = refOf(b.notes()[0]);
  fs.writeFileSync(path.join(b.dir, 'logbook', D3), ONE.replace('"45m"', '"1h"'));
  const r = b.route('PATCH', '/api/notes', { ref: seen, day: '2026-11-04' });
  assert.strictEqual(r.status, 409);
  assert.deepStrictEqual(b.names(), [D3]);
});

test('the source file left with no entries is removed as assign removes it', () => {
  const b = board({ [D3]: ONE });
  b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), day: '2026-11-04' });
  assert.ok(!b.names().includes(D3));
});

test('the body api.md gives for moving a note to another day moves it', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'references', 'api.md'), 'utf8');
  const given = /`(\{[^`]*"day"[^`]*\})`/.exec(api);
  assert.ok(given, 'api.md shows the body of a move to another day');
  const body = JSON.parse(given[1]);
  const b = board({ [D3]: ONE });
  const r = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), ...body });
  assert.deepStrictEqual([r.status, r.body.note.day], [200, body.day]);
});
