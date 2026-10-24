const { test } = require('node:test');
const assert = require('node:assert');
const { pickDay, initialMonth, hasTime, withTime, withoutTime, DEFAULT_TIME } = require('../web/date-picker');

// --- pickDay: what the input's value becomes when a popover day is clicked ---

test('pickDay returns just the picked day for an empty current value', () => {
  assert.strictEqual(pickDay('', '2026-08-01'), '2026-08-01');
});

test('pickDay replaces a plain-date current value with the picked day', () => {
  assert.strictEqual(pickDay('2026-07-09', '2026-08-01'), '2026-08-01');
});

test('pickDay PRESERVES an existing HH:MM time tail (the picker never destroys a typed time)', () => {
  assert.strictEqual(pickDay('2026-07-09T14:30', '2026-08-01'), '2026-08-01T14:30');
});

test('pickDay preserves a THH:MM:SS tail verbatim', () => {
  assert.strictEqual(pickDay('2026-07-09T14:30:59', '2026-08-01'), '2026-08-01T14:30:59');
});

test('pickDay treats garbage/missing current values as empty — just the day (tolerant: no validation)', () => {
  assert.strictEqual(pickDay('soon', '2026-08-01'), '2026-08-01');
  assert.strictEqual(pickDay('9/7/2026', '2026-08-01'), '2026-08-01');
  assert.strictEqual(pickDay('soonT14:30', '2026-08-01'), '2026-08-01'); // a time tail only counts after a real date
  assert.strictEqual(pickDay(null, '2026-08-01'), '2026-08-01');
  assert.strictEqual(pickDay(undefined, '2026-08-01'), '2026-08-01');
});

test('pickDay re-picking the same day is a no-op value-wise (datetime keeps its tail)', () => {
  assert.strictEqual(pickDay('2026-07-09', '2026-07-09'), '2026-07-09');
  assert.strictEqual(pickDay('2026-07-09T08:00', '2026-07-09'), '2026-07-09T08:00');
});

// --- initialMonth: which month the popover opens on ---------------------------

test('initialMonth opens on the current value\'s month when it is a plain date', () => {
  assert.deepStrictEqual(initialMonth('2026-03-15', '2026-07-09'), { year: 2026, monthIndex: 2 });
});

test('initialMonth opens on the current value\'s month when it is a datetime', () => {
  assert.deepStrictEqual(initialMonth('2025-12-31T23:59', '2026-07-09'), { year: 2025, monthIndex: 11 });
});

test('initialMonth falls back to today\'s month for empty/garbage current values', () => {
  assert.deepStrictEqual(initialMonth('', '2026-07-09'), { year: 2026, monthIndex: 6 });
  assert.deepStrictEqual(initialMonth('soon', '2026-01-02'), { year: 2026, monthIndex: 0 });
  assert.deepStrictEqual(initialMonth(null, '2026-07-09'), { year: 2026, monthIndex: 6 });
  assert.deepStrictEqual(initialMonth(undefined, '2026-07-09'), { year: 2026, monthIndex: 6 });
});

// impossible months are legal on disk (never-validate) but must not render a
// broken grid — fall back to today
test('initialMonth falls back to today for impossible months', () => {
  assert.deepStrictEqual(initialMonth('2026-13-05', '2026-07-09'), { year: 2026, monthIndex: 6 });
  assert.deepStrictEqual(initialMonth('2026-00-15', '2026-07-09'), { year: 2026, monthIndex: 6 });
});

// --- clock toggle: hasTime/withTime/withoutTime ------------------

test('hasTime is false for a plain date, empty, or garbage value', () => {
  assert.strictEqual(hasTime('2026-07-09'), false);
  assert.strictEqual(hasTime(''), false);
  assert.strictEqual(hasTime('soon'), false);
  assert.strictEqual(hasTime(null), false);
  assert.strictEqual(hasTime(undefined), false);
});

test('hasTime is true whenever a T-tail is present, however garbage', () => {
  assert.strictEqual(hasTime('2026-07-09T14:30'), true);
  assert.strictEqual(hasTime('2026-07-09T14:30:59'), true);
  assert.strictEqual(hasTime('2026-07-09Tnonsense'), true); // never-validate
});

test('withTime attaches the given HH:MM to a plain date', () => {
  assert.strictEqual(withTime('2026-07-09', '09:00'), '2026-07-09T09:00');
});

test('withTime REPLACES an existing time tail rather than appending', () => {
  assert.strictEqual(withTime('2026-07-09T14:30', '09:00'), '2026-07-09T09:00');
  assert.strictEqual(withTime('2026-07-09T14:30:59', '09:00'), '2026-07-09T09:00');
});

test('withTime is a no-op on empty/garbage values with no parseable day', () => {
  assert.strictEqual(withTime('', '09:00'), '');
  assert.strictEqual(withTime('soon', '09:00'), 'soon');
  assert.strictEqual(withTime(null, '09:00'), null);
  assert.strictEqual(withTime(undefined, '09:00'), undefined);
});

test('withoutTime strips a time tail back to the bare day', () => {
  assert.strictEqual(withoutTime('2026-07-09T14:30'), '2026-07-09');
  assert.strictEqual(withoutTime('2026-07-09T14:30:59'), '2026-07-09');
});

test('withoutTime is idempotent on a value with no time tail', () => {
  assert.strictEqual(withoutTime('2026-07-09'), '2026-07-09');
});

test('withoutTime is a no-op on empty/garbage values with no parseable day', () => {
  assert.strictEqual(withoutTime('', ), '');
  assert.strictEqual(withoutTime('soon'), 'soon');
  assert.strictEqual(withoutTime(null), null);
  assert.strictEqual(withoutTime(undefined), undefined);
});

test('withTime then withoutTime round-trips back to the original bare day', () => {
  const day = '2026-07-09';
  assert.strictEqual(withoutTime(withTime(day, DEFAULT_TIME)), day);
});

test('DEFAULT_TIME is a fixed HH:MM constant (deterministic, not the wall clock)', () => {
  assert.strictEqual(DEFAULT_TIME, '09:00');
});
