const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { openPalette, note } = require('./helpers/palette-page');
const { control } = require('./helpers/page-vm');

// The notes palette's subject row and range in the real page (helpers/palette-page.js): the date beside
// the time, the card picker beside the untimed tick, and the range control over the list. The rules are
// notes.js, tested apart (notes-range.test.js); the browser runner drives the same in Chrome
// (scenarios/notes.js).

const WEB = path.join(__dirname, '..', 'web');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8').replace(/\r\n/g, '\n');

const TODAY = (p) => p.page.run('localTodayStr()');
const NOTES = [
  note('2026-10-14', '7', '09:10', '@human', 'wed seven'),
  note('2026-10-19', '7', '10:00', '@afk', 'mon seven'),
  note('2026-10-21', '22', '09:40', '@human', 'wed twenty-two'),
  note('2026-10-21', '', null, '@human', 'wed free'),
  note('2026-10-22', '7', '10:20', '@human', 'thu seven'),
  note('2026-10-30', '7', '08:00', '@human', 'fri seven'),
];

// A page whose network is the test's: notes written come back as the server would answer them, and
// the board is the board. `calls` lists what was written.
async function open(extra = {}) {
  const p = await openPalette({ notes: NOTES.map((n) => ({ ...n })), ...extra });
  p.calls = [];
  const realFetch = p.page.ctx.fetch;
  p.page.ctx.fetch = async (url, opts = {}) => {
    if (opts.method && opts.method !== 'GET') {
      const body = JSON.parse(opts.body);
      p.calls.push({ method: opts.method, url, body });
      const made = { day: body.day, target: body.target, at: body.at || null, by: '@human', note: body.note, index: 0, file: 'f' };
      p.board.logbook.notes.push(made);
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ note: made }) };
    }
    return realFetch(url, opts);
  };
  p.settle = () => p.page.settle();
  return p;
}
const setBox = (p, text) => { p.ui().input.value = text; p.ui().input.fire('input', {}); p.ui().input.focus(); };

// --- the date beside the time ------------------------------------------------------------------

test('the subject row holds a date, a time, the untimed tick and the card picker, in that order', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  const names = p.find('.np-when').children.map((c) => c.classes.find((k) => /^np-(date-wrap|time|untimed-label|pick)$/.test(k)) || c.classes.join(' ') || c.tag);
  assert.deepStrictEqual(names.filter((n) => n !== 'span'), ['np-date-wrap', 'np-time', 'np-untimed-label', 'np-pick']);
});

test('the date starts at today and the time at now, as the time did', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  assert.strictEqual(p.ui().date.value, TODAY(p));
  assert.match(p.ui().time.value, /^\d\d:\d\d$/);
});

test('opened on an hour or the untimed box of another day, the date starts at that day', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 })");
  assert.strictEqual(p.ui().date.value, '2026-10-14');
  assert.strictEqual(p.ui().time.value, '09:00');
  p.page.run("openNotes({ kind: 'untimed', day: '2026-10-15' })");
  assert.strictEqual(p.ui().date.value, '2026-10-15');
  assert.strictEqual(p.ui().untimed.checked, true);
});

test('the date field is the date picker\'s: a button that opens it, a day only', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  const btn = p.find('.np-date-btn');
  assert.ok(btn.classes.includes('date-pick-btn'), 'the click-away rule of the picker knows it');
  assert.strictEqual(btn.type, 'button');
  assert.ok(p.ui().date.hasAttribute('data-date-only'), 'no clock row: a note\'s time is its own field');
  const wired = [];
  p.page.ctx.openDatePicker = (input, button) => wired.push([input.uid, button.uid]);
  btn.click();
  assert.deepStrictEqual(wired, [[p.ui().date.uid, btn.uid]]);
});

test('Enter writes the note to the day in the date field, and says the day in the preview when it is not today', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.ui().date.value = '2026-10-19';
  p.ui().date.fire('input', {});
  setBox(p, 'wrote on monday');
  assert.match(p.text(p.find('.np-prev-text')), /^Note at \d\d:\d\d, Mon 19, on #7/);
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.deepStrictEqual(p.calls.map((c) => [c.method, c.body.day, c.body.target, c.body.note]), [['POST', '2026-10-19', '7', 'wrote on monday']]);
});

test('a day that is not a date is said in the preview and Enter writes nothing', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.ui().date.value = '19/10';
  p.ui().date.fire('input', {});
  setBox(p, 'x');
  assert.match(p.text(p.find('.np-prev-text')), /19\/10 is not a date; a date reads YYYY-MM-DD\./);
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.deepStrictEqual(p.calls, []);
});

test('the untimed tick drops the time and keeps the day the date field holds', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.ui().date.value = '2026-10-19';
  p.ui().date.fire('input', {});
  p.ui().untimed.checked = true;
  p.ui().untimed.fire('change', {});
  setBox(p, 'untimed on monday');
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.deepStrictEqual(p.calls.map((c) => [c.body.day, c.body.at]), [['2026-10-19', '']]);
});

test('a leading time in the note still sets the time, on the day of the date field', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.ui().date.value = '2026-10-19';
  p.ui().date.fire('input', {});
  setBox(p, '10:30 early start');
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.deepStrictEqual(p.calls.map((c) => [c.body.day, c.body.at]), [['2026-10-19', '10:30']]);
});

test('a blank date field writes to the subject\'s day', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 })");
  p.ui().date.value = '';
  setBox(p, '#7 slot day');
  p.press(p.ui().input, 'Enter');
  p.ui().input.value = '';
  setBox(p, '#7 slot day');
  await p.settle();
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.ok(p.calls.length >= 1);
  assert.ok(p.calls.every((c) => c.body.day === '2026-10-14'));
});

test('a date picked stays for the next note, and one never picked follows the subject', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.ui().date.value = '2026-10-19';
  p.ui().date.fire('input', {});
  setBox(p, 'first');
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.strictEqual(p.ui().date.value, '2026-10-19', 'the next note is for the same day');
  p.page.run("openNotes({ kind: 'card-notes', id: '22' })");
  assert.strictEqual(p.ui().date.value, TODAY(p), 'a palette opened again starts on its own day');
});

test('the date field in the card is not narrowed by the list: a note written to another day stays listed', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.ui().date.value = '2026-11-02';
  p.ui().date.fire('input', {});
  setBox(p, 'next month');
  p.press(p.ui().input, 'Enter');
  await p.settle();
  assert.ok(p.rows().includes('next month'));
});

test('Enter or the down arrow in the date field moves to the note box', async () => {
  const p = await open();
  p.page.run("openNotes({ kind: 'card-notes', id: '7' })");
  p.ui().date.focus();
  p.press(p.ui().date, 'Enter');
  assert.strictEqual(p.doc.activeElement.uid, p.ui().input.uid);
});

test('the stylesheet gives the date a field of its own', () => {
  assert.match(css, /^\.np-date \{/m);
  assert.match(css, /^\.np-date-btn \{/m);
});
