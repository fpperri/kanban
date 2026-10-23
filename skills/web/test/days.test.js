const { test } = require('node:test');
const assert = require('node:assert');
const days = require('../web/days');

// The one reader of a day (YYYY-MM-DD): the group and logbook stores and the iterations rules all
// take it from here, so they agree on what a day is.

test('a real calendar day reads into its parts and its day number', () => {
  assert.deepStrictEqual(days.parseDay('2026-10-16'), { year: 2026, month: 10, day: 16, number: 20742 });
  assert.strictEqual(days.parseDay('1970-01-01').number, 0);
  assert.strictEqual(days.parseDay('2024-02-29').day, 29, 'a leap day');
});

test('localToday is the local date of a moment, written as a day that reads back', () => {
  assert.strictEqual(days.localToday(new Date(2026, 9, 6, 23, 59)), '2026-10-06');
  assert.strictEqual(days.localToday(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  assert.strictEqual(days.validDay(days.localToday()), true);
});

test('what is not a real day reads as none', () => {
  for (const bad of ['', ' ', '2026-02-30', '2026-13-01', '2026-00-10', '2026-10-00', '2023-02-29', '2026-1-1', '26-10-16', '2026-10-16T09:00', ' 2026-10-16', '2026/10/16', null, undefined, 20261016]) {
    assert.strictEqual(days.parseDay(bad), null, String(bad));
    assert.strictEqual(days.validDay(bad), false, String(bad));
  }
});

test('validDay says yes to the days parseDay reads', () => {
  assert.strictEqual(days.validDay('2026-10-16'), true);
});

test('the clock is one seam: now and localToday read it, and setClock() puts the real one back', () => {
  try {
    days.setClock(() => new Date(2026, 9, 6, 23, 59));
    assert.strictEqual(days.localToday(), '2026-10-06');
    assert.strictEqual(days.now().getHours(), 23);
    days.setClock(() => new Date(2026, 9, 7, 0, 1));
    assert.strictEqual(days.localToday(), '2026-10-07');
    assert.strictEqual(days.localToday(new Date(2026, 0, 1)), '2026-01-01', 'a moment passed in is not the clock');
  } finally {
    days.setClock();
  }
  assert.ok(Math.abs(days.now().getTime() - Date.now()) < 5000);
});
