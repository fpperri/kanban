const { test } = require('node:test');
const assert = require('node:assert');
const { openPalette, note } = require('./helpers/palette-page');

// The notes palette and the page's other "today" on a page whose clock the test sets (days.js setClock):
// the date and time fields say Today and Now, which Enter works out when it is pressed, or a picked value,
// which it uses as it is; an open page follows the clock. The rules are notes.js, tested apart
// (notes-clock.test.js); the browser runner drives the same in Chrome (scenarios/notes-clock.js).

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
  p.pick = (field, value) => { p.ui()[field].value = value; p.ui()[field].fire('input', {}); };
  p.preview = () => p.text(p.find('.np-prev-text'));
  p.pressed = () => [p.find('.np-today-btn').attrs['aria-pressed'], p.find('.np-now-btn').attrs['aria-pressed']];
  return p;
}

test('the fields start on Today and Now', async () => {
  const p = await open();
  p.page.run('openNotes({})');
  assert.deepStrictEqual([p.ui().date.value, p.ui().time.value], ['Today', 'Now']);
  assert.deepStrictEqual(p.pressed(), ['true', 'true']);
});

test('a palette left open past midnight writes the new day and the time of Enter', async () => {
  const p = await open();
  p.page.run('openNotes({})');
  p.setClock(2026, 9, 17, 0, 5);
  p.box('#7 after midnight');
  assert.match(p.preview(), /^Note at 00:05 on #7/);
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

test('after a write a field on Today or Now stays on Today or Now', async () => {
  const p = await open([2026, 9, 16, 10, 0]);
  p.page.run("openNotes({ target: '7' })");
  p.box('one');
  await p.enter();
  assert.deepStrictEqual([p.ui().date.value, p.ui().time.value], ['Today', 'Now']);
  p.setClock(2026, 9, 17, 8, 30);
  p.box('two');
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-16', '10:00', '7'], ['2026-10-17', '08:30', '7']]);
});

test('a picked date and time are used as picked, even when they equal today and now, and stay after a write', async () => {
  const p = await open([2026, 9, 16, 10, 0]);
  p.page.run("openNotes({ target: '7' })");
  p.pick('date', '2026-10-16');
  p.pick('time', '10:00');
  p.setClock(2026, 9, 17, 8, 30);
  p.box('picked');
  assert.match(p.preview(), /^Note at 10:00, Fri 16, on #7/);
  await p.enter();
  p.box('picked again');
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-16', '10:00', '7'], ['2026-10-16', '10:00', '7']]);
  assert.deepStrictEqual([p.ui().date.value, p.ui().time.value], ['2026-10-16', '10:00']);
});

test('a day and a time the request gave open as picked values and stay, until Today and Now are chosen', async () => {
  const p = await open([2026, 9, 16, 10, 0]);
  p.page.run("openNotes({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 })");
  assert.deepStrictEqual([p.ui().date.value, p.ui().time.value], ['2026-10-14', '09:00']);
  p.setClock(2026, 9, 20, 18, 0);
  p.box('#7 in the slot');
  await p.enter();
  p.find('.np-today-btn').click();
  p.find('.np-now-btn').click();
  assert.deepStrictEqual([p.ui().date.value, p.ui().time.value], ['Today', 'Now']);
  p.box('#7 now');
  await p.enter();
  p.page.run("openNotes({ target: '22', at: '09:42' })");
  assert.deepStrictEqual([p.ui().date.value, p.ui().time.value], ['Today', '09:42']);
  p.box('a time alone');
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-14', '09:00', '7'], ['2026-10-20', '18:00', '7'], ['2026-10-20', '09:42', '22']]);
});

test('Today and Now are one press away from a picked value, and typing the word does the same', async () => {
  const p = await open([2026, 9, 16, 10, 0]);
  p.page.run("openNotes({ target: '7' })");
  p.pick('date', '2026-10-12');
  p.pick('time', '9:30');
  assert.deepStrictEqual(p.pressed(), ['false', 'false']);
  p.find('.np-today-btn').click();
  p.find('.np-now-btn').click();
  assert.deepStrictEqual([p.ui().date.value, p.ui().time.value], ['Today', 'Now']);
  assert.deepStrictEqual(p.pressed(), ['true', 'true']);
  p.pick('date', '2026-10-12');
  p.pick('date', 'today');
  p.pick('time', 'now');
  p.setClock(2026, 9, 17, 6, 6);
  p.box('typed words');
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-17', '06:06', '7']]);
});

test('the untimed tick drops the time and Now with it, and unticking brings it back', async () => {
  const p = await open([2026, 9, 16, 10, 0]);
  p.page.run("openNotes({ target: '7' })");
  p.ui().untimed.checked = true;
  p.ui().untimed.fire('change', {});
  assert.strictEqual(p.find('.np-now-btn').disabled, true);
  p.box('untimed note');
  await p.enter();
  p.ui().untimed.checked = false;
  p.ui().untimed.fire('change', {});
  assert.strictEqual(p.find('.np-now-btn').disabled, false);
  p.box('timed again');
  await p.enter();
  assert.deepStrictEqual(p.written(), [['2026-10-16', '', '7'], ['2026-10-16', '10:00', '7']]);
});

test('the time menu offers Now first, then every half hour', async () => {
  const p = await open();
  const options = p.page.run('notesTimeOptions().map((o) => o.value)');
  assert.deepStrictEqual([options[0], options[1], options[2], options[options.length - 1], options.length], ['Now', '00:00', '00:30', '23:30', 49]);
});

test('the clock tick draws the preview again and leaves the fields as they say', async () => {
  const p = await open([2026, 9, 16, 23, 58]);
  p.page.run('openNotes({})');
  p.box('#7 x');
  p.setClock(2026, 9, 16, 23, 59);
  p.page.run('clockTick()');
  assert.deepStrictEqual([p.ui().date.value, p.ui().time.value], ['Today', 'Now']);
  assert.match(p.preview(), /^Note at 23:59 on #7/);
  p.setClock(2026, 9, 17, 0, 1);
  p.page.run('clockTick()');
  assert.strictEqual(p.page.run('renders'), 1, 'the views are drawn again when the day turns');
  p.page.run('clockTick()');
  assert.strictEqual(p.page.run('renders'), 1, 'and not again while it holds');
  assert.match(p.preview(), /^Note at 00:01 on #7/);
  p.pick('time', '7:15');
  p.setClock(2026, 9, 17, 0, 9);
  p.page.run('clockTick()');
  assert.match(p.preview(), /^Note at 07:15 on #7/);
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
