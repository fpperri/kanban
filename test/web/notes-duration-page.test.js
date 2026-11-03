const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { openPalette, note } = require('./helpers/palette-page');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');

// A note's duration in the notes palette of the real page (helpers/palette-page.js): the duration field
// after the time field, its menu, what Enter sends, the preview line and the labels in the list. The rules
// are notes.js and durations.js, tested apart (notes.test.js, durations.test.js); the browser runner
// drives the same in Chrome (scenarios/notes.js).

const NOTES = [
  { ...note('2026-11-03', '7', '10:30', '@human', 'schema review'), duration: '45m' },
  { ...note('2026-11-03', '7', null, '@human', 'reviews, some time today', 1), duration: '1h30m' },
  { ...note('2026-11-03', '7', '09:10', '@human', 'a plain note', 2), duration: null },
];

// A page whose clock is 2026-11-03 16:40 and whose network is the test's: a note written comes back as the
// server would answer it. `calls` lists the bodies sent.
async function open() {
  const p = await openPalette({ notes: NOTES.map((n) => ({ ...n })) });
  p.calls = [];
  const realFetch = p.page.ctx.fetch;
  p.page.ctx.fetch = async (url, opts = {}) => {
    if (opts.method && opts.method !== 'GET') {
      const body = JSON.parse(opts.body);
      p.calls.push(body);
      const made = { day: body.day, target: body.target, at: body.at || null, duration: body.duration || null, by: '@human', note: body.note, index: 9, file: 'f' };
      p.board.logbook.notes.push(made);
      return { ok: true, status: 201, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ note: made }) };
    }
    return realFetch(url, opts);
  };
  p.page.run('kanbanDays.setClock(() => new Date(2026, 10, 3, 16, 40))');
  p.page.run('renderBoard = () => {};'); // the board behind the palette is not under test, and this page draws no columns
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.set = (field, value) => { p.ui()[field].value = value; p.ui()[field].fire('input', {}); };
  p.box = (text) => { p.set('input', text); p.ui().input.focus(); };
  p.enter = async () => { p.press(p.ui().input, 'Enter'); await p.page.settle(); };
  p.preview = () => p.text(p.find('.np-prev-text'));
  p.sent = () => p.calls.map((b) => [b.at, b.duration]);
  p.reload = async () => { p.page.run('loadBoard().then(() => notesPaintBody())'); await p.page.settle(); };
  return p;
}

test('the duration field starts empty, named for a screen reader', async () => {
  const p = await open();
  assert.strictEqual(p.ui().duration.value, '');
  assert.strictEqual(p.ui().duration.attrs['aria-label'], 'Duration of the note');
});

test('Enter writes the field\'s length with the note\'s time, in the written form, and an empty field writes none', async () => {
  const p = await open();
  p.set('time', '10:30');
  p.set('duration', '45m');
  p.box('timed range');
  await p.enter();
  p.set('duration', '1h40');
  p.box('a typed length');
  await p.enter();
  p.set('duration', '');
  p.box('a plain note');
  await p.enter();
  assert.deepStrictEqual(p.sent(), [['10:30', '45m'], ['10:30', '1h40m'], ['10:30', undefined]]);
});

// The rows a combobox menu shows when its field takes the focus, as a person sees them.
const menuRows = (p, field, menu) => {
  p.ui()[field].fire('focus', {});
  return p.ui()[menu].children.map((c) => c.textContent);
};

test('the duration menu lists 15m to 4h, and leaves out what would pass midnight from the time field\'s time', async () => {
  const p = await open();
  p.set('time', '10:30');
  const rows = menuRows(p, 'duration', 'durationMenu');
  assert.deepStrictEqual([rows[0], rows[1], rows[3], rows[rows.length - 1], rows.length], ['15m', '30m', '1h', '4h', 16]);
  p.ui().duration.fire('blur', {});
  p.set('time', '23:00');
  assert.deepStrictEqual(menuRows(p, 'duration', 'durationMenu'), ['15m', '30m', '45m', '1h']);
  p.ui().duration.fire('blur', {});
  p.page.run('kanbanDays.setClock(() => new Date(2026, 10, 3, 23, 20))');
  p.set('time', 'Now');
  assert.deepStrictEqual(menuRows(p, 'duration', 'durationMenu'), ['15m', '30m']);
});

test('the time menu lists Now, then every 15 minutes', async () => {
  const p = await open();
  const rows = menuRows(p, 'time', 'timeMenu');
  assert.deepStrictEqual([rows[0], rows[1], rows[2], rows[3], rows[rows.length - 1], rows.length], ['Now', '00:00', '00:15', '00:30', '23:45', 97]);
});

test('the preview names the range or the length Enter will write', async () => {
  const p = await open();
  p.box('x');
  p.set('time', '10:30');
  p.set('duration', '45m');
  assert.strictEqual(p.preview(), 'Note 10:30–11:15 on #7 Port the zephyr schema');
  p.ui().untimed.checked = true;
  p.ui().untimed.fire('change', {});
  assert.strictEqual(p.preview(), 'Note 45m untimed on #7 Port the zephyr schema');
  p.set('duration', '25h');
  assert.strictEqual(p.preview(), 'A duration with no time is at most 24h.');
  await p.enter();
  assert.deepStrictEqual(p.calls, []);
});

test('the untimed tick keeps the duration, which stays usable under it', async () => {
  const p = await open();
  p.set('duration', '45m');
  p.ui().untimed.checked = true;
  p.ui().untimed.fire('change', {});
  assert.notStrictEqual(p.ui().duration.disabled, true);
  assert.strictEqual(p.ui().time.disabled, true);
  assert.strictEqual(p.ui().duration.value, '45m');
  p.box('logged, no start');
  await p.enter();
  assert.deepStrictEqual(p.sent(), [['', '45m']]);
});

test('Now and a duration make a range that starts at the moment Enter is pressed', async () => {
  const p = await open();
  p.set('duration', '30m');
  p.box('starting now');
  p.page.run('kanbanDays.setClock(() => new Date(2026, 10, 3, 17, 5))');
  await p.enter();
  assert.deepStrictEqual(p.sent(), [['17:05', '30m']]);
});

test('a duration picked stays for the next note, as a picked time does, and a new subject starts it empty', async () => {
  const p = await open();
  p.set('time', '10:30');
  p.set('duration', '45m');
  p.box('one');
  await p.enter();
  assert.deepStrictEqual([p.ui().time.value, p.ui().duration.value], ['10:30', '45m']);
  p.page.run("openNotes({ kind: 'card-notes', id: '22' })");
  assert.strictEqual(p.ui().duration.value, '');
});

const times = (p) => p.all('.np-note').map((r) => {
  const t = r.querySelector('.np-note-time');
  return [p.text(t), t.classes.includes('untimed')];
});

test('the list shows a range as 10:30–11:15 and a length with no time as 45m, in Grouped and in Timeline', async () => {
  const p = await open();
  const want = [['09:10', false], ['10:30–11:15', false], ['1h30m', false]];
  assert.deepStrictEqual(times(p), want);
  p.find('.np-by-btn[data-layout="timeline"]').click();
  assert.deepStrictEqual(times(p), want);
  p.board.logbook.notes.push(note('2026-11-03', '7', null, '@human', 'no time, no length', 3));
  await p.reload();
  assert.deepStrictEqual(times(p).pop(), ['untimed', true]);
});

test('a list with a range in it widens its time column for every row, and one without keeps it', async () => {
  const p = await open();
  assert.strictEqual(p.find('.np-notes').classes.includes('np-ranges'), true);
  p.board.logbook.notes.push(note('2026-11-03', '22', '09:00', '@human', 'a point'));
  await p.reload();
  p.page.run("openNotes({ kind: 'card-notes', id: '22' })");
  assert.deepStrictEqual(times(p), [['09:00', false]]);
  assert.strictEqual(p.find('.np-notes').classes.includes('np-ranges'), false);
});

test('the stylesheet gives the duration a field of its own, and every row of a list with a range the wider time column', () => {
  assert.match(css, /^\.np-time, \.np-duration \{/m);
  assert.match(css, /^\.np-duration-wrap \{[^}]*position: relative/m);
  assert.match(css, /^\.np-notes\.np-ranges \{ --np-time-col: [\d.]+em; \}/m);
  const grids = [...css.matchAll(/grid-template-columns: ([^;]+);/g)].map((m) => m[1]).filter((g) => /auto minmax\(0, (?:5em\) minmax\(0, )?1fr\)$/.test(g));
  assert.ok(grids.length >= 4, `the note rows' grids: ${grids.length}`);
  for (const g of grids) assert.match(g, /^var\(--np-time-col, 4\.2em\) /, g);
});

test('a leading length, time and length, or range in the note box is cut from the text and written as the note\'s time and duration', async () => {
  const p = await open();
  p.set('time', '12:00');
  for (const line of ['45m schema review', '10:30 45m schema review', '10:30-11:15 schema review', '10:30–11:15 schema review', '- 45m schema review', 'untimed 45m schema review']) {
    p.box(line);
    await p.enter();
  }
  assert.deepStrictEqual(p.calls.map((b) => [b.at, b.duration, b.note]), [
    ['12:00', '45m', 'schema review'],
    ['10:30', '45m', 'schema review'],
    ['10:30', '45m', 'schema review'],
    ['10:30', '45m', 'schema review'],
    ['', '45m', 'schema review'],
    ['', '45m', 'schema review'],
  ]);
});

test('the line\'s length beats the duration field\'s, and the field stays for the next note', async () => {
  const p = await open();
  p.set('time', '10:30');
  p.set('duration', '2h');
  p.box('1h30 a typed length');
  await p.enter();
  p.box('no length typed');
  await p.enter();
  assert.deepStrictEqual(p.sent(), [['10:30', '1h30m'], ['10:30', '2h']]);
  assert.strictEqual(p.ui().duration.value, '2h');
});

test('the preview says what each leading form will write, and a range that ends too soon is refused and written nowhere', async () => {
  const p = await open();
  p.set('time', '10:30');
  p.box('45m x');
  assert.strictEqual(p.preview(), 'Note 10:30–11:15 on #7 Port the zephyr schema');
  p.box('9:00 45m x');
  assert.strictEqual(p.preview(), 'Note 09:00–09:45 on #7 Port the zephyr schema');
  p.box('10:30-12:00 x');
  assert.strictEqual(p.preview(), 'Note 10:30–12:00 on #7 Port the zephyr schema');
  p.box('- 45m x');
  assert.strictEqual(p.preview(), 'Note 45m untimed on #7 Port the zephyr schema');
  p.box('untimed 45m x');
  assert.strictEqual(p.preview(), 'Note 45m untimed on #7 Port the zephyr schema');
  for (const line of ['12:00-11:00 x', '23:30-00:30 x']) {
    p.box(line);
    assert.strictEqual(p.preview(), `${line.split(' ')[0]}: the end is not after the start.`);
    assert.strictEqual(p.find('.np-prev').classes.includes('bad'), true);
    await p.enter();
  }
  assert.deepStrictEqual(p.calls, []);
});

test('the duration menu trims from the time the line gives, a leading range\'s start included', async () => {
  const p = await open();
  p.box('23:00-24:00 x');
  assert.deepStrictEqual(menuRows(p, 'duration', 'durationMenu'), ['15m', '30m', '45m', '1h']);
  p.ui().duration.fire('blur', {});
  p.box('23:30 x');
  assert.deepStrictEqual(menuRows(p, 'duration', 'durationMenu'), ['15m', '30m']);
});
