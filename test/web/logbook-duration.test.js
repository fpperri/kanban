const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeRoute } = require('../../plugin/skills/web/scripts/route');

// A note's duration through the notes routes, over a real board folder: what the day file says, what
// the route answers and what it refuses. The same routes over the in-memory board are held to these by
// route-memory.test.js.

const CARD = (id) => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# Card ${id}\n`;

function board(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-duration-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: t\nlogbook: logbook\n');
  fs.writeFileSync(path.join(dir, '0007.seven.card.md'), CARD(7));
  fs.writeFileSync(path.join(dir, '0022.twenty-two.card.md'), CARD(22));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, 'logbook'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'logbook', name), text);
  }
  const route = makeRoute(dir);
  const file = (name) => fs.readFileSync(path.join(dir, 'logbook', name), 'utf8');
  const names = () => (fs.existsSync(path.join(dir, 'logbook')) ? fs.readdirSync(path.join(dir, 'logbook')).sort() : []);
  const notes = () => route('GET', '/api/board').body.logbook.notes;
  return { dir, route, file, names, notes };
}

const DAY7 = '2026.11.03.0007.logbook.md';

test('a note with a time and a duration is written with its duration after its time, and answered with it', () => {
  const b = board();
  const r = b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '10:30', duration: '45m', note: 'schema review' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.note.duration, '45m');
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - at: "10:30"\n    duration: "45m"\n    by: "@human"\n    note: schema review\n---\n');
  assert.deepStrictEqual(b.notes().map((n) => [n.at, n.duration, n.note]), [['10:30', '45m', 'schema review']]);
});

test('a note with a duration and no time is a length of work on that day', () => {
  const b = board();
  const r = b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '', duration: '1h30', note: 'reviews' });
  assert.deepStrictEqual([r.status, r.body.note.at, r.body.note.duration], [201, null, '1h30m']);
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - duration: "1h30m"\n    by: "@human"\n    note: reviews\n---\n');
});

test('POST refuses a duration of nothing, one past 24:00 from its time, one over 24h with no time, and one that is no length', () => {
  const b = board();
  for (const [body, error] of [
    [{ at: '10:00', duration: '0m' }, 'A duration is at least 1 minute.'],
    [{ duration: '0h' }, 'A duration is at least 1 minute.'],
    [{ at: '23:30', duration: '1h' }, 'A note with a time ends by 24:00; 23:30 plus 1h does not.'],
    [{ duration: '24h1m' }, 'A duration with no time is at most 24h.'],
    [{ at: '10:00', duration: 'an hour' }, 'A duration reads like 45m, 1h or 1h30m.'],
    [{ at: '10:00', duration: 45 }, 'A duration reads like 45m, 1h or 1h30m.'],
  ]) {
    const r = b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', note: 'x', ...body });
    assert.deepStrictEqual([r.status, r.body.error], [400, error], JSON.stringify(body));
  }
  assert.deepStrictEqual(b.names(), []);
  assert.strictEqual(b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '23:00', duration: '1h', note: 'to midnight' }).status, 201);
  assert.strictEqual(b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', duration: '24h', note: 'a whole day' }).status, 201);
});

const refOf = (n) => ({ day: n.day, target: n.target, index: n.index, file: n.file, expect: { at: n.at, by: n.by, note: n.note } });

test('assigning a note to another card or to no card keeps its duration', () => {
  const b = board();
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '10:30', duration: '45m', note: 'timed' });
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', duration: '2h', note: 'untimed' });
  const [timed, untimed] = b.notes();
  const to22 = b.route('POST', '/api/notes/assign', { ref: refOf(timed), to: '22' });
  assert.deepStrictEqual([to22.status, to22.body.note.target, to22.body.note.duration], [200, '22', '45m']);
  assert.strictEqual(b.file('2026.11.03.0022.logbook.md'), '---\nentries:\n  - at: "10:30"\n    duration: "45m"\n    by: "@human"\n    note: timed\n---\n');
  const toNone = b.route('POST', '/api/notes/assign', { ref: refOf(b.notes().find((n) => n.note === 'untimed')), to: '' });
  assert.deepStrictEqual([toNone.status, toNone.body.note.duration], [200, '2h']);
  assert.deepStrictEqual(b.notes().map((n) => [n.target, n.at, n.duration, n.note]).sort(), [['', null, '2h', 'untimed'], ['22', '10:30', '45m', 'timed']]);
  assert.deepStrictEqual(b.names(), ['2026.11.03.0022.logbook.md', '2026.11.03.logbook.md']);
  assert.ok(untimed);
});

test('making a note untimed keeps its duration, and a time it would then pass 24:00 from is refused', () => {
  const b = board();
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '10:30', duration: '1h', note: 'a' });
  const untimed = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), at: '' });
  assert.deepStrictEqual([untimed.status, untimed.body.note.at, untimed.body.note.duration], [200, null, '1h']);
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - duration: "1h"\n    by: "@human"\n    note: a\n---\n');
  const late = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), at: '23:30' });
  assert.deepStrictEqual([late.status, late.body.error], [400, 'A note with a time ends by 24:00; 23:30 plus 1h does not.']);
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - duration: "1h"\n    by: "@human"\n    note: a\n---\n');
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), at: '23:00' }).status, 200);
  assert.deepStrictEqual(b.notes().map((n) => [n.at, n.duration]), [['23:00', '1h']]);
});

test('a hand-written duration reads in every form, quoted or not, and is answered in the written form', () => {
  const entries = [['08:00', '45m'], ['09:00', '"1h"'], ['10:00', '1h30m'], ['12:00', "'1h30'"], ['14:00', '90m # a comment']];
  const text = `---\nentries:\n${entries.map(([at, d], i) => `  - at: "${at}"\n    duration: ${d}\n    by: "@afk"\n    note: n${i}\n`).join('')}  - duration: 2h5m\n    note: untimed\n---\n`;
  const b = board({ [DAY7]: text });
  assert.deepStrictEqual(b.notes().map((n) => [n.at, n.duration]), [['08:00', '45m'], ['09:00', '1h'], ['10:00', '1h30m'], ['12:00', '1h30m'], ['14:00', '1h30m'], [null, '2h5m']]);
});

test('a duration that is no length the rules allow is a key the web does not know: no duration, its line kept', () => {
  const text = '---\nentries:\n  - at: "09:00"\n    duration: about an hour\n    note: a\n  - at: "10:00"\n    duration: 0m\n    note: b\n  - duration: "25h"\n    note: c\n---\n';
  const b = board({ [DAY7]: text });
  assert.deepStrictEqual(b.notes().map((n) => n.duration), [null, null, null]);
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '09:30', note: 'between' });
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - at: "09:00"\n    duration: about an hour\n    note: a\n  - at: "09:30"\n    by: "@human"\n    note: between\n  - at: "10:00"\n    duration: 0m\n    note: b\n  - duration: "25h"\n    note: c\n---\n');
});

test('an entry written before durations reads and rewrites byte for byte, its record saying no duration', () => {
  const before = '---\nentries:\n  - at: "09:10"\n    by: "@human"\n    note: first\n  - note: untimed, by hand\n    mood: calm\n---\nbody\n';
  const b = board({ [DAY7]: before });
  assert.deepStrictEqual(b.notes().map((n) => n.duration), [null, null]);
  const [first] = b.notes();
  const ref = { day: first.day, target: first.target, index: first.index, file: first.file, expect: { at: first.at, by: first.by, note: first.note } };
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref, note: 'first, changed' }).status, 200);
  assert.strictEqual(b.file(DAY7), before.replace('note: first\n', 'note: first, changed\n'));
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: { ...ref, expect: { ...ref.expect, note: 'first, changed' } }, note: 'first' }).status, 200);
  assert.strictEqual(b.file(DAY7), before);
});

test('an edited entry writes its hand-written duration afresh after its time, in the written form', () => {
  const b = board({ [DAY7]: '---\nentries:\n  - by: "@afk"\n    note: first\n    duration: 90m\n    at: 9:10\n---\n' });
  const [n] = b.notes();
  const ref = { day: n.day, target: n.target, index: n.index, file: n.file, expect: { at: n.at, by: n.by, note: n.note } };
  b.route('PATCH', '/api/notes', { ref, note: 'first, changed' });
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - at: "09:10"\n    duration: "1h30m"\n    by: "@afk"\n    note: first, changed\n---\n');
});
