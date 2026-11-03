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

const refOf = (n) => ({ day: n.day, target: n.target, index: n.index, file: n.file, expect: { at: n.at, duration: n.duration, by: n.by, note: n.note } });

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

test('a hand-written duration that would end past 24:00 from its note\'s time is a key the web does not know: no duration, its line kept', () => {
  const text = '---\nentries:\n  - at: "23:00"\n    duration: 1h\n    note: to midnight\n  - at: "23:30"\n    duration: 1h\n    note: past midnight\n---\n';
  const b = board({ [DAY7]: text });
  assert.deepStrictEqual(b.notes().map((n) => [n.at, n.duration]), [['23:00', '1h'], ['23:30', null]]);
  const late = b.notes().find((n) => n.note === 'past midnight');
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: refOf(late), at: '23:30', note: 'past midnight, changed' }).status, 200);
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - at: "23:00"\n    duration: 1h\n    note: to midnight\n  - at: "23:30"\n    duration: 1h\n    note: past midnight, changed\n---\n');
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
  const ref = refOf(n);
  b.route('PATCH', '/api/notes', { ref, note: 'first, changed' });
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - at: "09:10"\n    duration: "1h30m"\n    by: "@afk"\n    note: first, changed\n---\n');
});

test('PATCH sets a duration on a note, replaces it, and null (or an empty text) removes it', () => {
  const b = board();
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '10:30', note: 'a' });
  const set = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), duration: '1h30' });
  assert.deepStrictEqual([set.status, set.body.note.at, set.body.note.duration], [200, '10:30', '1h30m']);
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - at: "10:30"\n    duration: "1h30m"\n    by: "@human"\n    note: a\n---\n');
  const again = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), duration: '45m', note: 'a, changed' });
  assert.deepStrictEqual([again.status, again.body.note.duration, again.body.note.note], [200, '45m', 'a, changed']);
  const none = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), duration: null });
  assert.deepStrictEqual([none.status, none.body.note.at, none.body.note.duration], [200, '10:30', null]);
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - at: "10:30"\n    by: "@human"\n    note: a, changed\n---\n');
  b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), duration: '2h' });
  const empty = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), duration: '' });
  assert.deepStrictEqual([empty.status, empty.body.note.duration], [200, null]);
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - at: "10:30"\n    by: "@human"\n    note: a, changed\n---\n');
});

test('PATCH leaves the duration alone when the body has no duration key', () => {
  const b = board();
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '10:30', duration: '45m', note: 'a' });
  const r = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), note: 'a, changed' });
  assert.deepStrictEqual([r.status, r.body.note.duration], [200, '45m']);
});

test('PATCH refuses a duration that is no length, under a minute, past 24:00 from the note\'s time or the time sent with it, or over 24h with no time', () => {
  const b = board();
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '23:30', note: 'late' });
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', note: 'untimed' });
  const [late, untimed] = [b.notes().find((n) => n.note === 'late'), b.notes().find((n) => n.note === 'untimed')];
  const before = b.file(DAY7);
  for (const [ref, body, error] of [
    [late, { duration: 'an hour' }, 'A duration reads like 45m, 1h or 1h30m.'],
    [late, { duration: '0m' }, 'A duration is at least 1 minute.'],
    [late, { duration: '1h' }, 'A note with a time ends by 24:00; 23:30 plus 1h does not.'],
    [late, { at: '23:45', duration: '30m' }, 'A note with a time ends by 24:00; 23:45 plus 30m does not.'],
    [untimed, { duration: '25h' }, 'A duration with no time is at most 24h.'],
  ]) {
    const r = b.route('PATCH', '/api/notes', { ref: refOf(ref), ...body });
    assert.deepStrictEqual([r.status, r.body.error], [400, error], JSON.stringify(body));
  }
  assert.strictEqual(b.file(DAY7), before);
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: refOf(late), at: '22:30', duration: '1h30m' }).status, 200);
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: refOf(untimed), duration: '24h' }).status, 200);
});

test('a note\'s text is edited with its time sent as it was, whatever its hand-written duration says', () => {
  const b = board({ [DAY7]: '---\nentries:\n  - at: "23:30"\n    duration: 1h\n    by: "@afk"\n    note: late\n---\n' });
  const r = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), at: '23:30', note: 'late, changed' });
  assert.deepStrictEqual([r.status, r.body.note && r.body.note.note], [200, 'late, changed']);
});

test('PATCH takes a time and a duration together, and untimed with a duration, in one save', () => {
  const b = board();
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '10:30', duration: '45m', note: 'a' });
  const r = b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), at: '', duration: '2h' });
  assert.deepStrictEqual([r.status, r.body.note.at, r.body.note.duration], [200, null, '2h']);
  assert.strictEqual(b.file(DAY7), '---\nentries:\n  - duration: "2h"\n    by: "@human"\n    note: a\n---\n');
});

test('a note whose duration changed at the desk since it was read is refused as a changed time is, by edit, delete and assign', () => {
  const b = board();
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '10:30', duration: '45m', note: 'a' });
  const seen = refOf(b.notes()[0]);
  fs.writeFileSync(path.join(b.dir, 'logbook', DAY7), b.file(DAY7).replace('"45m"', '"1h"'));
  const before = b.file(DAY7);
  for (const [method, p, body] of [
    ['PATCH', '/api/notes', { ref: seen, note: 'edited' }],
    ['PATCH', '/api/notes', { ref: seen, duration: null }],
    ['DELETE', '/api/notes', { ref: seen }],
    ['POST', '/api/notes/assign', { ref: seen, to: '22' }],
  ]) {
    const r = b.route(method, p, body);
    assert.deepStrictEqual([r.status, r.body.error], [409, 'That note has changed or is gone; reload and try again.'], `${method} ${p}`);
  }
  assert.strictEqual(b.file(DAY7), before);
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: refOf(b.notes()[0]), duration: '2h' }).status, 200);
});

test('a ref that says a note has no duration is refused once it has one, and a ref with no duration key says none', () => {
  const b = board();
  b.route('POST', '/api/notes', { day: '2026-11-03', target: '7', at: '10:30', note: 'a' });
  const plain = refOf(b.notes()[0]);
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: { ...plain, expect: { at: '10:30', by: '@human', note: 'a' } }, note: 'a2' }).status, 200);
  fs.writeFileSync(path.join(b.dir, 'logbook', DAY7), b.file(DAY7).replace('    by:', '    duration: "30m"\n    by:'));
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: { ...plain, expect: { at: '10:30', by: '@human', note: 'a2' } }, note: 'a3' }).status, 409);
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: { ...plain, expect: { at: '10:30', duration: '1h', by: '@human', note: 'a2' } }, note: 'a3' }).status, 409);
  assert.strictEqual(b.route('PATCH', '/api/notes', { ref: { ...plain, expect: { at: '10:30', duration: '30m', by: '@human', note: 'a2' } }, note: 'a3' }).status, 200);
});
