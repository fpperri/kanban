const { test } = require('node:test');
const assert = require('node:assert');
const { openPalette, note } = require('./helpers/palette-page');

// The notes palette and the page's other "today" on a page whose clock the test sets (days.js setClock):
// a palette left open writes the day and time of the moment of Enter, and an open page follows the clock.
// The rules are notes.js, tested apart (notes-clock.test.js); the browser runner drives the same in
// Chrome (scenarios/notes-clock.js).

const NOTES = [note('2026-10-16', '7', '09:10', '@human', 'thu seven'), note('2026-10-17', '7', '10:00', '@human', 'fri seven')];

async function open(clock = [2026, 9, 16, 23, 58]) {
  const p = await openPalette({ notes: NOTES.map((n) => ({ ...n })) });
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
  p.setClock = (...at) => p.page.run(`kanbanDays.setClock(() => new Date(${at.join(', ')}))`);
  p.page.run('var renders = 0; renderBoard = () => { renders++; };');
  p.setClock(...clock);
  p.page.run('clockDay = localTodayStr()');
  p.box = (text) => { p.ui().input.value = text; p.ui().input.fire('input', {}); p.ui().input.focus(); };
  p.enter = async () => { p.press(p.ui().input, 'Enter'); await p.page.settle(); };
  p.written = () => p.calls.map((c) => [c.body.day, c.body.at, c.body.target]);
  return p;
}

test('a palette left open past midnight writes the new day and the time of Enter', async () => {
  const p = await open();
  p.page.run('openNotes({})');
  assert.strictEqual(p.ui().date.value, '2026-10-16');
  assert.strictEqual(p.ui().time.value, '23:58');
  p.setClock(2026, 9, 17, 0, 5);
  p.box('#7 after midnight');
  assert.match(p.text(p.find('.np-prev-text')), /^Note at 00:05 on #7/);
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-17', '00:05', '7']]);
});

test('a palette left open on the same day writes the minute of Enter, not the minute it opened', async () => {
  const p = await open([2026, 9, 16, 10, 0]);
  p.page.run("openNotes({ target: '7' })");
  p.setClock(2026, 9, 16, 10, 41);
  p.box('later');
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-16', '10:41', '7']]);
});

test('the second note of a palette left open reads the clock again', async () => {
  const p = await open([2026, 9, 16, 10, 0]);
  p.page.run("openNotes({ target: '7' })");
  p.box('one');
  await p.enter();
  p.setClock(2026, 9, 17, 8, 30);
  p.box('two');
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-16', '10:00', '7'], ['2026-10-17', '08:30', '7']]);
  assert.strictEqual(p.ui().date.value, '2026-10-17');
  assert.strictEqual(p.ui().time.value, '08:30');
});

test('a day and a time the request gave stay as given', async () => {
  const p = await open([2026, 9, 16, 10, 0]);
  p.page.run("openNotes({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 })");
  p.setClock(2026, 9, 20, 18, 0);
  p.box('#7 in the slot');
  await p.enter();
  p.page.run("openNotes({ target: '22', day: '2026-10-15', at: '09:42' })");
  p.box('on a given moment');
  await p.enter();
  p.page.run("openNotes({ target: '3', at: '09:42' })");
  p.box('a time alone');
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-14', '09:00', '7'], ['2026-10-15', '09:42', '22'], ['2026-10-20', '09:42', '3']]);
});

test('a day and a time the person typed stay as typed, and so does an untimed tick', async () => {
  const p = await open([2026, 9, 16, 10, 0]);
  p.page.run("openNotes({ target: '7' })");
  p.ui().date.value = '2026-10-12';
  p.ui().date.fire('input', {});
  p.ui().time.value = '9:30';
  p.ui().time.fire('input', {});
  p.setClock(2026, 9, 17, 8, 30);
  p.box('typed');
  await p.enter();
  p.ui().time.value = '';
  p.ui().untimed.checked = true;
  p.ui().untimed.fire('change', {});
  p.box('ticked untimed');
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-12', '09:30', '7'], ['2026-10-12', '', '7']]);
});

test('the clock tick moves the untouched fields and the preview with the clock, and leaves typed ones', async () => {
  const p = await open([2026, 9, 16, 23, 58]);
  p.page.run('openNotes({})');
  p.box('#7 x');
  p.setClock(2026, 9, 16, 23, 59);
  p.page.run('clockTick()');
  assert.strictEqual(p.ui().time.value, '23:59');
  assert.match(p.text(p.find('.np-prev-text')), /^Note at 23:59 on #7/);
  p.setClock(2026, 9, 17, 0, 1);
  p.page.run('clockTick()');
  assert.deepStrictEqual([p.ui().date.value, p.ui().time.value], ['2026-10-17', '00:01']);
  assert.strictEqual(p.page.run('renders'), 1, 'the views are drawn again when the day turns');
  p.page.run('clockTick()');
  assert.strictEqual(p.page.run('renders'), 1, 'and not again while it holds');
  assert.match(p.text(p.find('.np-prev-text')), /^Note at 00:01 on #7/);
  p.ui().time.value = '7:15';
  p.ui().time.fire('input', {});
  p.setClock(2026, 9, 17, 0, 9);
  p.page.run('clockTick()');
  assert.strictEqual(p.ui().time.value, '7:15');
  assert.strictEqual(p.ui().date.value, '2026-10-17');
});

test('across midnight an open palette\'s Day range and today label move to the new today', async () => {
  const p = await open([2026, 9, 16, 23, 58]);
  p.page.run('openNotes({})');
  assert.strictEqual(p.page.run('notesUi.range.anchor'), '2026-10-16');
  assert.ok(p.rows().includes('thu seven'));
  p.setClock(2026, 9, 17, 0, 1);
  p.page.run('clockTick()');
  assert.strictEqual(p.page.run('notesUi.range.anchor'), '2026-10-17');
  assert.deepStrictEqual(p.rows(), ['fri seven']);
  assert.match(p.text(p.find('.np-range-label')), /Sat 17/);
});

test('a range the person stepped, and a day the request gave, do not follow the clock', async () => {
  const p = await open([2026, 9, 16, 23, 58]);
  p.page.run('openNotes({})');
  p.page.run('notesStepRange(-1)');
  p.setClock(2026, 9, 17, 0, 1);
  p.page.run('clockTick()');
  assert.strictEqual(p.page.run('notesUi.range.anchor'), '2026-10-15');
  p.page.run("openNotes({ kind: 'untimed', day: '2026-10-14' })");
  p.setClock(2026, 9, 18, 0, 1);
  p.page.run('clockTick()');
  assert.deepStrictEqual([p.ui().date.value, p.page.run('notesUi.range.anchor'), p.page.run('notesUi.sub.day')], ['2026-10-14', '2026-10-14', '2026-10-14']);
});

test('the Calendar and the Gantt open on today until a control moves them, and then stay put', async () => {
  const p = await open([2026, 9, 16, 23, 58]);
  assert.strictEqual(p.page.run('currentCalendarAnchor()'), '2026-10-16');
  assert.strictEqual(p.page.run('currentGanttAnchor()'), '2026-10-16');
  p.setClock(2026, 9, 17, 0, 1);
  assert.strictEqual(p.page.run('currentCalendarAnchor()'), '2026-10-17');
  assert.strictEqual(p.page.run('currentGanttAnchor()'), '2026-10-17');
  p.page.run("calendarAnchorTo('2026-09-01')");
  p.setClock(2026, 9, 18, 0, 1);
  assert.strictEqual(p.page.run('currentCalendarAnchor()'), '2026-09-01');
});
