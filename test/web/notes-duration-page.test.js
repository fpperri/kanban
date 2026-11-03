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

// ---------- the edit row ----------

// The page of `open()`, whose saves of an edit (PATCH) are recorded and answered, and whose toasts are kept.
async function openEdit() {
  const p = await open();
  const wrapped = p.page.ctx.fetch;
  p.patches = [];
  p.page.ctx.fetch = async (url, opts = {}) => {
    if (opts.method !== 'PATCH') return wrapped(url, opts);
    p.patches.push(JSON.parse(opts.body));
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ note: {} }) };
  };
  p.toasts = [];
  p.page.ctx.toasted = p.toasts;
  p.page.run('toast = (m) => { toasted.push(m); }');
  // The rows in list order: the plain note (09:10), the range (10:30, 45m), the length with no time (1h30m).
  p.edit = (i) => {
    p.press(p.ui().body, 'e', { target: p.all('.np-note')[i] });
    return { time: p.find('.np-edit-time'), duration: p.find('.np-edit-duration'), text: p.find('.np-edit-text') };
  };
  p.type = (el, value) => { el.value = value; el.fire('input', {}); };
  p.save = async () => { p.find('.np-edit-save').click(); await p.page.settle(); };
  return p;
}

test('e on a note shows its duration beside its time, and an empty field for a note with none', async () => {
  const p = await openEdit();
  const row = p.edit(1);
  assert.deepStrictEqual([row.time.value, row.duration.value, row.text.value], ['10:30', '45m', 'schema review']);
  assert.strictEqual(row.duration.attrs['aria-label'], 'Duration, blank for none');
  p.find('.np-edit-cancel').click();
  const length = p.edit(2);
  assert.deepStrictEqual([length.time.value, length.duration.value], ['', '1h30m']);
  p.find('.np-edit-cancel').click();
  const plain = p.edit(0);
  assert.deepStrictEqual([plain.time.value, plain.duration.value], ['09:10', '']);
});

test('saving a changed duration sends it, in the written form, with a ref that names the duration the page read', async () => {
  const p = await openEdit();
  const row = p.edit(1);
  p.type(row.duration, '1h40');
  await p.save();
  assert.strictEqual(p.patches.length, 1);
  const [sent] = p.patches;
  assert.deepStrictEqual([sent.at, sent.duration, sent.note], ['10:30', '1h40m', 'schema review']);
  assert.deepStrictEqual(sent.ref.expect, { at: '10:30', duration: '45m', by: '@human', note: 'schema review' });
});

test('clearing the duration and saving sends null; leaving it as it was sends no duration', async () => {
  const p = await openEdit();
  const cleared = p.edit(1);
  p.type(cleared.duration, '');
  await p.save();
  assert.strictEqual(p.patches[0].duration, null);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(p.patches[0], 'duration'), true);
  const same = p.edit(1);
  p.type(same.text, 'schema review, again');
  await p.save();
  assert.strictEqual(Object.prototype.hasOwnProperty.call(p.patches[1], 'duration'), false);
  p.edit(0);
  await p.save();
  assert.strictEqual(Object.prototype.hasOwnProperty.call(p.patches[2], 'duration'), false);
});

test('a note with no duration is given one in the row, and clearing the time of a timed note sends the untimed time and leaves its duration alone', async () => {
  const p = await openEdit();
  const plain = p.edit(0);
  p.type(plain.duration, '30m');
  await p.save();
  assert.deepStrictEqual([p.patches[0].at, p.patches[0].duration], ['09:10', '30m']);
  const range = p.edit(1);
  p.type(range.time, '');
  await p.save();
  assert.deepStrictEqual([p.patches[1].at, 'duration' in p.patches[1]], ['', false]);
});

test('a duration that is no length, or that would end past 24:00 from the row\'s time, is said and nothing is sent', async () => {
  const p = await openEdit();
  const row = p.edit(1);
  p.type(row.duration, 'soon');
  await p.save();
  p.type(row.duration, '1h');
  p.type(row.time, '23:30');
  await p.save();
  p.type(row.duration, '0m');
  await p.save();
  assert.deepStrictEqual(p.toasts, [
    'soon is not a duration; a duration reads like 45m, 1h or 1h30m.',
    'A note with a time ends by 24:00; 23:30 plus 1h does not.',
    'A duration is at least 1 minute.',
  ]);
  assert.deepStrictEqual(p.patches, []);
});

test('the row\'s duration menu lists 15m to 4h, trimmed to what ends by midnight from the time in the row', async () => {
  const p = await openEdit();
  const row = p.edit(1);
  const menu = () => p.doc.body.querySelectorAll('.np-edit-duration-menu')[0];
  row.duration.fire('focus', {});
  const rows = menu().children.map((c) => c.textContent);
  assert.deepStrictEqual([rows[0], rows[3], rows[rows.length - 1], rows.length], ['15m', '1h', '4h', 16]);
  row.duration.fire('blur', {});
  p.type(row.time, '23:00');
  row.duration.fire('focus', {});
  assert.deepStrictEqual(menu().children.map((c) => c.textContent), ['15m', '30m', '45m', '1h']);
});

// A key pressed in a field of the edit row, as the browser delivers it: to the field, then up to the row's form.
const rowKey = (p, field, key) => {
  const e = p.press(field, key);
  p.find('.np-edit').fire('keydown', e);
  return e;
};

test('one Enter in the row\'s duration field saves it with its menu open: the length typed, or the one highlighted', async () => {
  const p = await openEdit();
  const menu = () => p.doc.body.querySelectorAll('.np-edit-duration-menu')[0];
  const typed = p.edit(1);
  typed.duration.fire('focus', {});
  p.type(typed.duration, '2h');
  assert.strictEqual(menu().hidden, false);
  rowKey(p, typed.duration, 'Enter');
  await p.page.settle();
  assert.deepStrictEqual(p.patches.map((b) => b.duration), ['2h']);
  const picked = p.edit(1);
  picked.duration.fire('focus', {});
  rowKey(p, picked.duration, 'ArrowDown');
  rowKey(p, picked.duration, 'Enter');
  await p.page.settle();
  assert.deepStrictEqual(p.patches.map((b) => b.duration), ['2h', '15m']);
});

test('Enter in the row\'s other fields saves it as before, and Shift+Enter in the text saves nothing', async () => {
  const p = await openEdit();
  const row = p.edit(1);
  p.type(row.text, 'schema review, changed');
  rowKey(p, row.text, 'Enter');
  await p.page.settle();
  assert.deepStrictEqual(p.patches.map((b) => b.note), ['schema review, changed']);
  const again = p.edit(1);
  const e = p.press(again.text, 'Enter', { shiftKey: true });
  p.find('.np-edit').fire('keydown', e);
  await p.page.settle();
  assert.strictEqual(p.patches.length, 1);
});

test('the stylesheet gives the edit row\'s duration a field of its own', () => {
  assert.match(css, /^\.np-edit-duration-wrap \{[^}]*position: relative/m);
  assert.match(css, /^\.np-edit-duration \{[^}]*width: [\d.]+em/m);
});
