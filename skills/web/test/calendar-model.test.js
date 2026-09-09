const { test } = require('node:test');
const assert = require('node:assert');
const {
  VIEW_MODES, CALENDAR_MAX_CHIPS_PER_DAY,
  mergeViewMode, dayPart, timePart, addDays, diffDays, dayToUtc, shiftValue,
  monthGrid, monthTitle, shiftMonth,
  rangeFields, dueMarker, cardSchedule, chipPositionForDay,
  rescheduleChanges, rescheduleDueChanges, capChips,
  CALENDAR_SUBVIEWS, CALENDAR_DEFAULT_BLOCK_MIN,
  mergeCalendarSubview, weekStartOf, calendarSubviewDays, shiftAnchorDay,
  subviewTitle, timeToMinutes, assignLanes, timeGridLayout,
  monthChipLayout, CALENDAR_MAX_CHIP_ROWS_PER_WEEK,
  minutesToTime, CALENDAR_DRAG_SNAP_MIN,
  rescheduleRangeAtTime, rescheduleDueAtTime, resizeRangeAtTime,
  calendarCreateStart,
} = require('../web/calendar-model');

// --- view mode (board / map / calendar / gantt) ------

test('VIEW_MODES lists exactly board / map / calendar / gantt', () => {
  assert.deepStrictEqual(VIEW_MODES, ['board', 'map', 'calendar', 'gantt']);
});

test('mergeViewMode passes through every known mode', () => {
  for (const mode of ['board', 'map', 'calendar', 'gantt']) {
    assert.strictEqual(mergeViewMode(mode), mode);
  }
});

test('mergeViewMode falls back to board for unknown/missing/corrupt saved values', () => {
  assert.strictEqual(mergeViewMode('timeline'), 'board');
  assert.strictEqual(mergeViewMode(''), 'board');
  assert.strictEqual(mergeViewMode(null), 'board');
  assert.strictEqual(mergeViewMode(undefined), 'board');
  assert.strictEqual(mergeViewMode(42), 'board');
  assert.strictEqual(mergeViewMode({ mode: 'map' }), 'board');
});

// --- date value parsing (YYYY-MM-DD or YYYY-MM-DDTHH:MM) ---

test('dayPart extracts the calendar day from a date or datetime value', () => {
  assert.strictEqual(dayPart('2026-07-09'), '2026-07-09');
  assert.strictEqual(dayPart('2026-07-09T14:30'), '2026-07-09');
});

test('dayPart returns empty for missing or non-date values (tolerant: no validation)', () => {
  assert.strictEqual(dayPart(''), '');
  assert.strictEqual(dayPart(undefined), '');
  assert.strictEqual(dayPart(null), '');
  assert.strictEqual(dayPart('soon'), '');
  assert.strictEqual(dayPart('9/7/2026'), '');
});

test('timePart extracts the time-of-day from a datetime value, empty otherwise', () => {
  assert.strictEqual(timePart('2026-07-09T14:30'), '14:30');
  assert.strictEqual(timePart('2026-07-09'), '');
  assert.strictEqual(timePart(''), '');
  assert.strictEqual(timePart(undefined), '');
  assert.strictEqual(timePart('garbage'), '');
});

// --- day arithmetic ----------------------------------------------------------

test('addDays walks forward, across month and year boundaries', () => {
  assert.strictEqual(addDays('2026-07-09', 1), '2026-07-10');
  assert.strictEqual(addDays('2026-07-31', 1), '2026-08-01');
  assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01');
});

test('addDays walks backward and handles leap February', () => {
  assert.strictEqual(addDays('2026-07-01', -1), '2026-06-30');
  assert.strictEqual(addDays('2024-02-28', 1), '2024-02-29');
  assert.strictEqual(addDays('2024-03-01', -1), '2024-02-29');
  assert.strictEqual(addDays('2025-03-01', -1), '2025-02-28');
});

test('dayToUtc and shiftValue are exported for gantt-model.js to reuse', () => {
  assert.strictEqual(dayToUtc('2026-07-09'), Date.UTC(2026, 6, 9));
  assert.strictEqual(shiftValue('2026-07-09T14:30', '2026-07-15'), '2026-07-15T14:30');
  assert.strictEqual(shiftValue('2026-07-09', '2026-07-15'), '2026-07-15');
  assert.strictEqual(shiftValue(undefined, '2026-07-15'), '2026-07-15'); // creating a field yields a plain date
});

test('diffDays measures signed whole days from a to b', () => {
  assert.strictEqual(diffDays('2026-07-01', '2026-07-09'), 8);
  assert.strictEqual(diffDays('2026-07-09', '2026-07-01'), -8);
  assert.strictEqual(diffDays('2026-07-09', '2026-07-09'), 0);
  assert.strictEqual(diffDays('2026-06-30', '2026-07-02'), 2);
});

// --- monthGrid ---------------------------------------------------------------

const dowUTC = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

test('monthGrid July 2026: 35 cells starting on the Monday before the 1st', () => {
  const cells = monthGrid(2026, 6); // July 1 2026 is a Wednesday
  assert.strictEqual(cells.length, 35);
  assert.strictEqual(cells[0].date, '2026-06-29');
  assert.strictEqual(dowUTC(cells[0].date), 1); // Monday
  assert.strictEqual(cells[0].day, 29);
  assert.strictEqual(cells[0].inMonth, false);
});

test('monthGrid August 2026 needs 6 weeks: 42 cells', () => {
  const cells = monthGrid(2026, 7); // Aug 1 2026 is a Saturday: 5 lead days + 31
  assert.strictEqual(cells.length, 42);
  assert.strictEqual(dowUTC(cells[0].date), 1);
  assert.strictEqual(cells[41].inMonth, false);
});

test('monthGrid cell count is always 35 or 42 and always starts on a Monday', () => {
  for (let m = 0; m < 24; m++) {
    const cells = monthGrid(2025 + Math.floor(m / 12), m % 12);
    assert.ok(cells.length === 35 || cells.length === 42, `month ${m}: ${cells.length} cells`);
    assert.strictEqual(dowUTC(cells[0].date), 1, `month ${m} starts on a Monday`);
    assert.strictEqual(cells.length % 7, 0);
  }
});

test('monthGrid flags outside-month cells and covers every day of the month', () => {
  const cells = monthGrid(2026, 6);
  const inMonth = cells.filter((c) => c.inMonth);
  assert.strictEqual(inMonth.length, 31);
  assert.strictEqual(inMonth[0].date, '2026-07-01');
  assert.strictEqual(inMonth[30].date, '2026-07-31');
  assert.strictEqual(cells.filter((c) => !c.inMonth).length, 4); // 2 June lead + 2 August tail
});

test('monthGrid leap February 2024 includes Feb 29 in-month', () => {
  const cells = monthGrid(2024, 1); // Feb 1 2024 is a Thursday
  assert.strictEqual(cells.length, 35);
  const feb29 = cells.find((c) => c.date === '2024-02-29');
  assert.ok(feb29, 'Feb 29 present');
  assert.strictEqual(feb29.inMonth, true);
  assert.strictEqual(cells.filter((c) => c.inMonth).length, 29);
});

test('monthGrid pads a 28-day February starting on Monday to 5 rows (never a 4-row grid)', () => {
  const cells = monthGrid(2021, 1); // Feb 1 2021 is a Monday, 28 days = exactly 4 natural weeks
  assert.strictEqual(cells.length, 35);
  assert.strictEqual(cells[0].date, '2021-02-01');
  // the padding week is a trailing full week of March
  assert.ok(cells.slice(28).every((c) => !c.inMonth));
});

// --- month navigation ---------------------------------------------------------

test('monthTitle renders "July 2026" style titles', () => {
  assert.strictEqual(monthTitle(2026, 6), 'July 2026');
  assert.strictEqual(monthTitle(2024, 0), 'January 2024');
  assert.strictEqual(monthTitle(2025, 11), 'December 2025');
});

test('shiftMonth moves across year boundaries in both directions', () => {
  assert.deepStrictEqual(shiftMonth(2026, 6, 1), { year: 2026, monthIndex: 7 });
  assert.deepStrictEqual(shiftMonth(2026, 11, 1), { year: 2027, monthIndex: 0 });
  assert.deepStrictEqual(shiftMonth(2026, 0, -1), { year: 2025, monthIndex: 11 });
  assert.deepStrictEqual(shiftMonth(2026, 6, 0), { year: 2026, monthIndex: 6 });
  assert.deepStrictEqual(shiftMonth(2026, 6, -18), { year: 2025, monthIndex: 0 });
});

// --- rangeFields: which fields form the working range? --------------
// The single shape-decider under cardSchedule AND every drag-math function:
// the range is start_date -> end_date; when end_date is absent but start AND
// due are both present, the range falls back to start_date -> due_date
// (compat) — and whatever writes back must KEEP the pair it reports here.

test('rangeFields: real range reports start_date/end_date', () => {
  assert.deepStrictEqual(rangeFields({ start_date: '2026-07-03', end_date: '2026-07-06' }),
    { startDay: '2026-07-03', startField: 'start_date', endDay: '2026-07-06', endField: 'end_date' });
});

test('rangeFields: due never joins a range once end_date exists', () => {
  const rf = rangeFields({ start_date: '2026-07-03', end_date: '2026-07-06', due_date: '2026-07-20' });
  assert.strictEqual(rf.endField, 'end_date');
  assert.strictEqual(rf.endDay, '2026-07-06');
});

test('rangeFields: compat fallback — no end_date but start AND due present uses due as the range end', () => {
  assert.deepStrictEqual(rangeFields({ start_date: '2026-07-03', due_date: '2026-07-06' }),
    { startDay: '2026-07-03', startField: 'start_date', endDay: '2026-07-06', endField: 'due_date' });
});

test('rangeFields: an unparseable end_date is absent — compat fallback still applies', () => {
  const rf = rangeFields({ start_date: '2026-07-03', end_date: 'garbage', due_date: '2026-07-06' });
  assert.strictEqual(rf.endField, 'due_date');
  assert.strictEqual(rf.endDay, '2026-07-06');
});

test('rangeFields: start-only / end-only / nothing', () => {
  assert.deepStrictEqual(rangeFields({ start_date: '2026-07-03' }),
    { startDay: '2026-07-03', startField: 'start_date', endDay: null, endField: null });
  assert.deepStrictEqual(rangeFields({ end_date: '2026-07-06T18:00' }),
    { startDay: null, startField: null, endDay: '2026-07-06', endField: 'end_date' });
  assert.deepStrictEqual(rangeFields({ due_date: '2026-07-09' }), // due alone is a marker, never a range
    { startDay: null, startField: null, endDay: null, endField: null });
  assert.deepStrictEqual(rangeFields({}),
    { startDay: null, startField: null, endDay: null, endField: null });
});

// --- dueMarker: the independent deadline marker ----------------------

test('dueMarker: parseable due gives day + time', () => {
  assert.deepStrictEqual(dueMarker({ due_date: '2026-07-09' }), { day: '2026-07-09', time: '' });
  assert.deepStrictEqual(dueMarker({ due_date: '2026-07-09T14:30' }), { day: '2026-07-09', time: '14:30' });
});

test('dueMarker: absent or unparseable due is null — and it ignores the range fields entirely', () => {
  assert.strictEqual(dueMarker({}), null);
  assert.strictEqual(dueMarker({ due_date: 'whenever' }), null);
  assert.strictEqual(dueMarker({ start_date: '2026-07-01', end_date: '2026-07-05' }), null);
});

// --- cardSchedule: the RANGE shapes -------
// The schedule is the working range only — due participates solely via the
// compat fallback. A due-only card has NO schedule (its deadline renders as
// the separate due marker in both views).

test('cardSchedule: no range-forming dates means no run', () => {
  assert.deepStrictEqual(cardSchedule({}), { kind: 'none' });
  assert.deepStrictEqual(cardSchedule({ start_date: '', end_date: '', due_date: '' }), { kind: 'none' });
  assert.deepStrictEqual(cardSchedule({ end_date: 'whenever' }), { kind: 'none' }); // unparseable = absent, tolerant
});

test('cardSchedule: due-only is NOT a range any more — the marker owns it', () => {
  assert.deepStrictEqual(cardSchedule({ due_date: '2026-07-09' }), { kind: 'none' });
  assert.deepStrictEqual(cardSchedule({ due_date: '2026-07-09T14:30' }), { kind: 'none' });
});

test('cardSchedule: unparseable start with a good due has no range either (marker only)', () => {
  assert.deepStrictEqual(cardSchedule({ start_date: 'someday', due_date: '2026-07-05' }), { kind: 'none' });
});

test('cardSchedule: start + end gives the inclusive working range, time from the end datetime', () => {
  assert.deepStrictEqual(cardSchedule({ start_date: '2026-07-03', end_date: '2026-07-06T17:00' }),
    { kind: 'range', startDay: '2026-07-03', endDay: '2026-07-06', time: '17:00' });
});

test('cardSchedule: a due alongside a real range changes nothing about the range', () => {
  assert.deepStrictEqual(cardSchedule({ start_date: '2026-07-03', end_date: '2026-07-06', due_date: '2026-07-20T09:00' }),
    { kind: 'range', startDay: '2026-07-03', endDay: '2026-07-06', time: '' });
});

test('cardSchedule: COMPAT — start + due with no end_date still ranges start->due (pre-end_date cards keep rendering)', () => {
  assert.deepStrictEqual(cardSchedule({ start_date: '2026-07-03', due_date: '2026-07-06T17:00' }),
    { kind: 'range', startDay: '2026-07-03', endDay: '2026-07-06', time: '17:00' });
});

test('cardSchedule: start-only is a 1-day range at start', () => {
  assert.deepStrictEqual(cardSchedule({ start_date: '2026-07-03' }),
    { kind: 'single', day: '2026-07-03', time: '' });
  assert.deepStrictEqual(cardSchedule({ start_date: '2026-07-03T09:00' }),
    { kind: 'single', day: '2026-07-03', time: '09:00' });
});

test('cardSchedule: end-only (no start) is a 1-day range at the end', () => {
  assert.deepStrictEqual(cardSchedule({ end_date: '2026-07-06' }),
    { kind: 'single', day: '2026-07-06', time: '' });
  assert.deepStrictEqual(cardSchedule({ end_date: '2026-07-06T18:00', due_date: '2026-07-20' }),
    { kind: 'single', day: '2026-07-06', time: '18:00' });
});

test('cardSchedule: reversed range (start after end) collapses to 1 day at the range END', () => {
  assert.deepStrictEqual(cardSchedule({ start_date: '2026-07-10', end_date: '2026-07-05T11:00' }),
    { kind: 'single', day: '2026-07-05', time: '11:00' });
});

test('cardSchedule: reversed COMPAT range (start after due, no end) collapses at due — same as the reversed range rule', () => {
  assert.deepStrictEqual(cardSchedule({ start_date: '2026-07-10', due_date: '2026-07-05' }),
    { kind: 'single', day: '2026-07-05', time: '' });
});

// --- chipPositionForDay --------------------------------------------------------

test('chipPositionForDay: single chip matches only its own day', () => {
  const s = cardSchedule({ end_date: '2026-07-09' });
  assert.strictEqual(chipPositionForDay(s, '2026-07-09'), 'single');
  assert.strictEqual(chipPositionForDay(s, '2026-07-08'), null);
  assert.strictEqual(chipPositionForDay(s, '2026-07-10'), null);
});

test('chipPositionForDay: range marks start / mid / end and nothing outside', () => {
  const s = cardSchedule({ start_date: '2026-07-03', end_date: '2026-07-06' });
  assert.strictEqual(chipPositionForDay(s, '2026-07-02'), null);
  assert.strictEqual(chipPositionForDay(s, '2026-07-03'), 'range-start');
  assert.strictEqual(chipPositionForDay(s, '2026-07-04'), 'range-mid');
  assert.strictEqual(chipPositionForDay(s, '2026-07-05'), 'range-mid');
  assert.strictEqual(chipPositionForDay(s, '2026-07-06'), 'range-end');
  assert.strictEqual(chipPositionForDay(s, '2026-07-07'), null);
});

test('chipPositionForDay: a range spanning a month boundary still matches every day (compat pair)', () => {
  const s = cardSchedule({ start_date: '2026-06-30', due_date: '2026-07-02' });
  assert.strictEqual(chipPositionForDay(s, '2026-06-30'), 'range-start');
  assert.strictEqual(chipPositionForDay(s, '2026-07-01'), 'range-mid');
  assert.strictEqual(chipPositionForDay(s, '2026-07-02'), 'range-end');
});

test('chipPositionForDay: same-day start and end is a one-day range = single', () => {
  const s = cardSchedule({ start_date: '2026-07-09', end_date: '2026-07-09' });
  assert.strictEqual(chipPositionForDay(s, '2026-07-09'), 'single');
  assert.strictEqual(chipPositionForDay(s, '2026-07-10'), null);
});

test('chipPositionForDay: none schedule never matches', () => {
  assert.strictEqual(chipPositionForDay(cardSchedule({}), '2026-07-09'), null);
});

// --- rescheduleChanges: RANGE chip drag -----
// Moves the working range: the drop day becomes the range END day and the
// range start shifts by the same delta. Writes go to THE FIELDS THE RANGE
// ACTUALLY USED (rangeFields): a real range shifts start+end, a compat range
// shifts start+due — never inventing an end_date. Zero-delta drops are null.

test('reschedule real range: end lands on the drop day, start shifts by the same delta, due untouched', () => {
  const changes = rescheduleChanges(
    { start_date: '2026-07-01', end_date: '2026-07-04', due_date: '2026-07-20' }, '2026-07-10');
  assert.deepStrictEqual(changes, { end_date: '2026-07-10', start_date: '2026-07-07' });
  assert.ok(!('due_date' in changes), 'due is an independent marker — a range drag never writes it');
});

test('reschedule COMPAT range (start+due, no end): shifts start and due, never invents an end_date', () => {
  const changes = rescheduleChanges({ start_date: '2026-07-01', due_date: '2026-07-04' }, '2026-07-10');
  assert.deepStrictEqual(changes, { due_date: '2026-07-10', start_date: '2026-07-07' });
  assert.ok(!('end_date' in changes), 'the compat pair is KEPT — no end_date materializes');
});

test('reschedule range with datetimes: both times-of-day preserved through the shift', () => {
  assert.deepStrictEqual(
    rescheduleChanges({ start_date: '2026-07-01T09:00', end_date: '2026-07-04T17:30' }, '2026-07-10'),
    { end_date: '2026-07-10T17:30', start_date: '2026-07-07T09:00' });
  assert.deepStrictEqual(
    rescheduleChanges({ start_date: '2026-07-01T09:00', due_date: '2026-07-04T17:30' }, '2026-07-10'),
    { due_date: '2026-07-10T17:30', start_date: '2026-07-07T09:00' });
});

test('reschedule range backward across a month boundary', () => {
  assert.deepStrictEqual(
    rescheduleChanges({ start_date: '2026-07-02', end_date: '2026-07-03' }, '2026-06-30'),
    { end_date: '2026-06-30', start_date: '2026-06-29' });
});

test('reschedule start-only: the drop day becomes the start date, time preserved', () => {
  assert.deepStrictEqual(rescheduleChanges({ start_date: '2026-07-03' }, '2026-07-08'),
    { start_date: '2026-07-08' });
  assert.deepStrictEqual(rescheduleChanges({ start_date: '2026-07-03T08:15' }, '2026-07-08'),
    { start_date: '2026-07-08T08:15' });
});

test('reschedule end-only: the drop day becomes the end date, time preserved', () => {
  assert.deepStrictEqual(rescheduleChanges({ end_date: '2026-07-06T18:00' }, '2026-07-08'),
    { end_date: '2026-07-08T18:00' });
});

test('reschedule reversed range: the chip sits at the range end — that field alone moves, start untouched', () => {
  const real = rescheduleChanges({ start_date: '2026-07-10', end_date: '2026-07-05T11:00' }, '2026-07-20');
  assert.deepStrictEqual(real, { end_date: '2026-07-20T11:00' });
  assert.ok(!('start_date' in real), 'nonsensical start left out of the PATCH entirely');
  const compat = rescheduleChanges({ start_date: '2026-07-10', due_date: '2026-07-05T11:00' }, '2026-07-20');
  assert.deepStrictEqual(compat, { due_date: '2026-07-20T11:00' });
  assert.ok(!('start_date' in compat));
});

test('reschedule a card with no range is a no-op (null) — due-only included (the marker drags separately)', () => {
  assert.strictEqual(rescheduleChanges({}, '2026-07-09'), null);
  assert.strictEqual(rescheduleChanges({ end_date: 'someday' }, '2026-07-09'), null);
  assert.strictEqual(rescheduleChanges({ due_date: '2026-07-05' }, '2026-07-09'), null);
});

test('reschedule zero-delta: dropping a chip on its own day is null (no PATCH, no updated bump)', () => {
  assert.strictEqual(rescheduleChanges({ start_date: '2026-07-01', end_date: '2026-07-04' }, '2026-07-04'), null);
  assert.strictEqual(rescheduleChanges({ start_date: '2026-07-01T09:00', due_date: '2026-07-04T17:30' }, '2026-07-04'), null);
  assert.strictEqual(rescheduleChanges({ start_date: '2026-07-03' }, '2026-07-03'), null);
});

// --- rescheduleDueChanges: DUE marker drag ----------------------------
// Moves due_date alone, time preserved; zero-delta and no-parseable-due are null.

test('rescheduleDueChanges moves due_date alone, time-of-day preserved', () => {
  assert.deepStrictEqual(rescheduleDueChanges({ due_date: '2026-07-09' }, '2026-07-15'),
    { due_date: '2026-07-15' });
  assert.deepStrictEqual(rescheduleDueChanges({ due_date: '2026-07-09T14:30' }, '2026-07-15'),
    { due_date: '2026-07-15T14:30' });
});

test('rescheduleDueChanges never touches the range fields', () => {
  const changes = rescheduleDueChanges(
    { start_date: '2026-07-01', end_date: '2026-07-04', due_date: '2026-07-09' }, '2026-07-15');
  assert.deepStrictEqual(changes, { due_date: '2026-07-15' });
});

test('rescheduleDueChanges: zero-delta and unparseable/absent due are null', () => {
  assert.strictEqual(rescheduleDueChanges({ due_date: '2026-07-09T14:30' }, '2026-07-09'), null);
  assert.strictEqual(rescheduleDueChanges({ due_date: 'someday' }, '2026-07-15'), null);
  assert.strictEqual(rescheduleDueChanges({}, '2026-07-15'), null);
});

// --- chips-per-day capping ("+N more") ---------------------------------

test('CALENDAR_MAX_CHIPS_PER_DAY is 4', () => {
  assert.strictEqual(CALENDAR_MAX_CHIPS_PER_DAY, 4);
});

test('capChips: at or under the cap everything is visible, no overflow', () => {
  assert.deepStrictEqual(capChips([], 4), { visible: [], overflow: [] });
  assert.deepStrictEqual(capChips([1, 2, 3], 4), { visible: [1, 2, 3], overflow: [] });
  assert.deepStrictEqual(capChips([1, 2, 3, 4], 4), { visible: [1, 2, 3, 4], overflow: [] });
});

test('capChips: over the cap keeps the first N visible and overflows the rest in order', () => {
  assert.deepStrictEqual(capChips([1, 2, 3, 4, 5, 6], 4), { visible: [1, 2, 3, 4], overflow: [5, 6] });
});

// === calendar sub-views (month / week / 3-day / day) =================

// --- sub-view set + persistence merge -------------------------------------------

test('CALENDAR_SUBVIEWS lists exactly month / week / 3day / day', () => {
  assert.deepStrictEqual(CALENDAR_SUBVIEWS, ['month', 'week', '3day', 'day']);
});

test('mergeCalendarSubview passes through every known sub-view', () => {
  for (const sv of ['month', 'week', '3day', 'day']) {
    assert.strictEqual(mergeCalendarSubview(sv), sv);
  }
});

test('mergeCalendarSubview falls back to month for unknown/missing/corrupt saved values', () => {
  assert.strictEqual(mergeCalendarSubview('fortnight'), 'month');
  assert.strictEqual(mergeCalendarSubview(''), 'month');
  assert.strictEqual(mergeCalendarSubview(null), 'month');
  assert.strictEqual(mergeCalendarSubview(undefined), 'month');
  assert.strictEqual(mergeCalendarSubview(3), 'month');
});

// --- weekStartOf: Monday, same convention as monthGrid ---------------------------

test('weekStartOf finds the Monday of the containing week', () => {
  assert.strictEqual(weekStartOf('2026-07-06'), '2026-07-06'); // Monday is itself
  assert.strictEqual(weekStartOf('2026-07-09'), '2026-07-06'); // Thursday
  assert.strictEqual(weekStartOf('2026-07-12'), '2026-07-06'); // Sunday belongs to the PRECEDING Monday
  assert.strictEqual(weekStartOf('2027-01-03'), '2026-12-28'); // across a year boundary
});

// --- calendarSubviewDays: the day columns each sub-view shows ----------------------

test('calendarSubviewDays week: Monday-to-Sunday of the anchor week', () => {
  assert.deepStrictEqual(calendarSubviewDays('week', '2026-07-09'), [
    '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
    '2026-07-10', '2026-07-11', '2026-07-12',
  ]);
  // a Sunday anchor stays in its own (preceding-Monday) week
  assert.deepStrictEqual(calendarSubviewDays('week', '2026-07-12')[0], '2026-07-06');
});

test('calendarSubviewDays 3day: the anchor and the next two days, across month ends', () => {
  assert.deepStrictEqual(calendarSubviewDays('3day', '2026-07-30'),
    ['2026-07-30', '2026-07-31', '2026-08-01']);
});

test('calendarSubviewDays day: just the anchor; month: null (monthGrid owns that layout)', () => {
  assert.deepStrictEqual(calendarSubviewDays('day', '2026-07-09'), ['2026-07-09']);
  assert.strictEqual(calendarSubviewDays('month', '2026-07-09'), null);
});

// --- shiftAnchorDay: prev/next step by the active view's span ---------------------

test('shiftAnchorDay week steps 7 days either way', () => {
  assert.strictEqual(shiftAnchorDay('week', '2026-07-09', 1), '2026-07-16');
  assert.strictEqual(shiftAnchorDay('week', '2026-07-09', -1), '2026-07-02');
});

test('shiftAnchorDay 3day steps 3 days, day steps 1 — across month/year boundaries', () => {
  assert.strictEqual(shiftAnchorDay('3day', '2026-07-30', 1), '2026-08-02');
  assert.strictEqual(shiftAnchorDay('day', '2026-12-31', 1), '2027-01-01');
  assert.strictEqual(shiftAnchorDay('day', '2027-01-01', -1), '2026-12-31');
});

test('shiftAnchorDay month lands on the FIRST of the shifted month (the grid only needs y/m)', () => {
  assert.strictEqual(shiftAnchorDay('month', '2026-07-15', 1), '2026-08-01');
  assert.strictEqual(shiftAnchorDay('month', '2026-01-15', -1), '2025-12-01');
  assert.strictEqual(shiftAnchorDay('month', '2026-12-31', 1), '2027-01-01');
  assert.strictEqual(shiftAnchorDay('month', '2026-07-15', 0), '2026-07-01'); // normalizes even at delta 0
});

test('shiftAnchorDay zero delta is the anchor itself for sub-month views', () => {
  assert.strictEqual(shiftAnchorDay('week', '2026-07-09', 0), '2026-07-09');
  assert.strictEqual(shiftAnchorDay('day', '2026-07-09', 0), '2026-07-09');
});

// --- subviewTitle -----------------------------------------------------------------

test('subviewTitle month delegates to the month title', () => {
  assert.strictEqual(subviewTitle('month', '2026-07-15'), 'July 2026');
});

test('subviewTitle day: weekday-qualified single date', () => {
  assert.strictEqual(subviewTitle('day', '2026-07-09'), 'Thursday 9 July 2026');
  assert.strictEqual(subviewTitle('day', '2026-07-12'), 'Sunday 12 July 2026');
});

test('subviewTitle week/3day same month: compact day-to-day range', () => {
  assert.strictEqual(subviewTitle('week', '2026-07-09'), '6–12 July 2026');
  assert.strictEqual(subviewTitle('3day', '2026-07-09'), '9–11 July 2026');
});

test('subviewTitle across a month boundary spells both months', () => {
  assert.strictEqual(subviewTitle('3day', '2026-07-30'), '30 July – 1 August 2026');
});

test('subviewTitle across a year boundary spells both years', () => {
  assert.strictEqual(subviewTitle('week', '2026-12-30'), '28 December 2026 – 3 January 2027');
});

// --- timeToMinutes: tolerant HH:MM -> minutes-since-midnight ------------------------

test('timeToMinutes parses HH:MM into minutes since midnight', () => {
  assert.strictEqual(timeToMinutes('09:30'), 570);
  assert.strictEqual(timeToMinutes('00:00'), 0);
  assert.strictEqual(timeToMinutes('23:59'), 1439);
});

test('timeToMinutes is tolerant: 1-digit hours and trailing seconds parse, junk is null', () => {
  assert.strictEqual(timeToMinutes('9:05'), 545);
  assert.strictEqual(timeToMinutes('14:30:15'), 870); // seconds ignored, prefix wins
  assert.strictEqual(timeToMinutes(''), null);
  assert.strictEqual(timeToMinutes(undefined), null);
  assert.strictEqual(timeToMinutes(null), null);
  assert.strictEqual(timeToMinutes('noon'), null);
  assert.strictEqual(timeToMinutes('24:00'), null); // out of range = no time, all-day
  assert.strictEqual(timeToMinutes('12:60'), null);
});

test('CALENDAR_DEFAULT_BLOCK_MIN is 60 (default block height for a time-point without duration)', () => {
  assert.strictEqual(CALENDAR_DEFAULT_BLOCK_MIN, 60);
});

// --- assignLanes: Outlook-style side-by-side overlap layout -------------------------

test('assignLanes: non-overlapping blocks all take lane 0 of a 1-lane cluster', () => {
  const out = assignLanes([
    { card: { id: 1 }, startMin: 540, endMin: 600 },
    { card: { id: 2 }, startMin: 660, endMin: 720 },
  ]);
  assert.deepStrictEqual(out.map((b) => [b.card.id, b.lane, b.lanes]), [[1, 0, 1], [2, 0, 1]]);
});

test('assignLanes: two overlapping blocks split into lanes 0 and 1 of a 2-lane cluster', () => {
  const out = assignLanes([
    { card: { id: 2 }, startMin: 570, endMin: 690 },
    { card: { id: 1 }, startMin: 540, endMin: 660 },
  ]);
  assert.deepStrictEqual(out.map((b) => [b.card.id, b.lane, b.lanes]), [[1, 0, 2], [2, 1, 2]]);
});

test('assignLanes: a chain overlap forms ONE cluster and reuses freed lanes', () => {
  // A 09:00-11:00, B 10:00-12:00, C 11:20-13:00 — C overlaps only B but the
  // cluster is transitive, so all three report 2 lanes and C reuses lane 0.
  const out = assignLanes([
    { card: { id: 1 }, startMin: 540, endMin: 660 },
    { card: { id: 2 }, startMin: 600, endMin: 720 },
    { card: { id: 3 }, startMin: 680, endMin: 780 },
  ]);
  assert.deepStrictEqual(out.map((b) => [b.card.id, b.lane, b.lanes]),
    [[1, 0, 2], [2, 1, 2], [3, 0, 2]]);
});

test('assignLanes: back-to-back blocks (end == next start) do not overlap — separate 1-lane clusters', () => {
  const out = assignLanes([
    { card: { id: 1 }, startMin: 540, endMin: 600 },
    { card: { id: 2 }, startMin: 600, endMin: 660 },
  ]);
  assert.deepStrictEqual(out.map((b) => [b.card.id, b.lane, b.lanes]), [[1, 0, 1], [2, 0, 1]]);
});

test('assignLanes sorts by start time and never mutates its input', () => {
  const input = [
    { card: { id: 9 }, startMin: 700, endMin: 760 },
    { card: { id: 3 }, startMin: 540, endMin: 600 },
  ];
  const out = assignLanes(input);
  assert.deepStrictEqual(out.map((b) => b.card.id), [3, 9]);
  assert.ok(!('lane' in input[0]) && !('lane' in input[1]), 'input objects untouched');
});

// --- timeGridLayout: all-day band vs timed blocks -----------------------------------
// The window below is the 3-day view 2026-07-06..08 unless stated otherwise.

const W3 = ['2026-07-06', '2026-07-07', '2026-07-08'];

test('timeGridLayout: a date-only single-day card lands in the all-day band on its column', () => {
  const card = { id: 1, title: 'a', start_date: '2026-07-07' };
  const { allDay, allDayRows, timed } = timeGridLayout([card], W3);
  assert.deepStrictEqual(allDay, [
    { card, startIdx: 1, endIdx: 1, clipStart: false, clipEnd: false, due: false, row: 0 },
  ]);
  assert.strictEqual(allDayRows, 1);
  assert.deepStrictEqual(Object.values(timed).flat(), []);
});

test('timeGridLayout: a multi-day range spans its columns, clamped + clip-flagged at the window edges', () => {
  const card = { id: 2, title: 'r', start_date: '2026-07-05', end_date: '2026-07-07' };
  const { allDay } = timeGridLayout([card], W3);
  assert.deepStrictEqual(allDay, [
    { card, startIdx: 0, endIdx: 1, clipStart: true, clipEnd: false, due: false, row: 0 },
  ]);
});

test('timeGridLayout: a range poking past the RIGHT edge clips there; fully-outside ranges vanish', () => {
  const inRange = { id: 3, title: 'r', start_date: '2026-07-08', end_date: '2026-07-12' };
  const before = { id: 4, title: 'b', start_date: '2026-07-01', end_date: '2026-07-05' };
  const after = { id: 5, title: 'a', start_date: '2026-07-09', end_date: '2026-07-10' };
  const { allDay } = timeGridLayout([inRange, before, after], W3);
  assert.deepStrictEqual(allDay, [
    { card: inRange, startIdx: 2, endIdx: 2, clipStart: false, clipEnd: true, due: false, row: 0 },
  ]);
});

test('timeGridLayout: a MULTI-day range stays in the all-day band even when its endpoints carry times', () => {
  const card = { id: 6, title: 'm', start_date: '2026-07-06T09:00', end_date: '2026-07-07T17:00' };
  const { allDay, timed } = timeGridLayout([card], W3);
  assert.strictEqual(allDay.length, 1);
  assert.strictEqual(allDay[0].startIdx, 0);
  assert.strictEqual(allDay[0].endIdx, 1);
  assert.deepStrictEqual(Object.values(timed).flat(), []);
});

test('timeGridLayout: a same-day datetime start->end renders as a timed block with its REAL duration', () => {
  const card = { id: 7, title: 't', start_date: '2026-07-07T09:00', end_date: '2026-07-07T17:00' };
  const { allDay, timed } = timeGridLayout([card], W3);
  assert.deepStrictEqual(allDay, []);
  assert.deepStrictEqual(timed['2026-07-07'], [
    { card, startMin: 540, endMin: 1020, point: false, due: false, time: '09:00', lane: 0, lanes: 1 },
  ]);
});

test('timeGridLayout: a time-point without duration gets the default block height', () => {
  const card = { id: 8, title: 'p', start_date: '2026-07-07T13:15' };
  const { timed } = timeGridLayout([card], W3);
  assert.deepStrictEqual(timed['2026-07-07'], [
    { card, startMin: 795, endMin: 795 + CALENDAR_DEFAULT_BLOCK_MIN, point: true, due: false, time: '13:15', lane: 0, lanes: 1 },
  ]);
});

test('timeGridLayout: a same-day range with only ONE parseable time is a point at that time', () => {
  const endOnly = { id: 9, title: 'e', start_date: '2026-07-07', end_date: '2026-07-07T17:00' };
  const startOnly = { id: 10, title: 's', start_date: '2026-07-06T09:00', end_date: '2026-07-06' };
  const { timed } = timeGridLayout([endOnly, startOnly], W3);
  assert.strictEqual(timed['2026-07-07'][0].startMin, 1020);
  assert.strictEqual(timed['2026-07-07'][0].point, true);
  assert.strictEqual(timed['2026-07-06'][0].startMin, 540);
  assert.strictEqual(timed['2026-07-06'][0].point, true);
});

test('timeGridLayout: a REVERSED same-day time pair collapses to a point at the END time (same rule as reversed date ranges)', () => {
  const card = { id: 11, title: 'x', start_date: '2026-07-07T17:00', end_date: '2026-07-07T09:00' };
  const { timed } = timeGridLayout([card], W3);
  assert.deepStrictEqual(timed['2026-07-07'], [
    { card, startMin: 540, endMin: 540 + CALENDAR_DEFAULT_BLOCK_MIN, point: true, due: false, time: '09:00', lane: 0, lanes: 1 },
  ]);
});

test('timeGridLayout: a same-day range with NO parseable times is an all-day single', () => {
  const card = { id: 12, title: 'd', start_date: '2026-07-07', end_date: '2026-07-07' };
  const { allDay, timed } = timeGridLayout([card], W3);
  assert.strictEqual(allDay.length, 1);
  assert.strictEqual(allDay[0].startIdx, 1);
  assert.deepStrictEqual(Object.values(timed).flat(), []);
});

test('timeGridLayout: blocks clamp at midnight — a 23:30 point never leaks into the next day', () => {
  const card = { id: 13, title: 'l', end_date: '2026-07-07T23:30' };
  const { timed } = timeGridLayout([card], W3);
  assert.deepStrictEqual(timed['2026-07-07'], [
    { card, startMin: 1410, endMin: 1440, point: true, due: false, time: '23:30', lane: 0, lanes: 1 },
  ]);
});

test('timeGridLayout: a datetime due is a timed due point; a date-only due is an all-day due chip', () => {
  const timedDue = { id: 14, title: 'td', due_date: '2026-07-07T12:00' };
  const bandDue = { id: 15, title: 'bd', due_date: '2026-07-08' };
  const { allDay, timed } = timeGridLayout([timedDue, bandDue], W3);
  assert.deepStrictEqual(timed['2026-07-07'], [
    { card: timedDue, startMin: 720, endMin: 720 + CALENDAR_DEFAULT_BLOCK_MIN, point: true, due: true, time: '12:00', lane: 0, lanes: 1 },
  ]);
  assert.deepStrictEqual(allDay, [
    { card: bandDue, startIdx: 2, endIdx: 2, clipStart: false, clipEnd: false, due: true, row: 0 },
  ]);
});

test('timeGridLayout: a card renders BOTH its range and its due marker, like the month view', () => {
  const card = { id: 16, title: 'both', start_date: '2026-07-06', end_date: '2026-07-08', due_date: '2026-07-07T10:00' };
  const { allDay, timed } = timeGridLayout([card], W3);
  assert.strictEqual(allDay.length, 1);
  assert.strictEqual(allDay[0].due, false);
  assert.strictEqual(timed['2026-07-07'].length, 1);
  assert.strictEqual(timed['2026-07-07'][0].due, true);
});

test('timeGridLayout: due markers outside the window are skipped; dateless/unparseable cards yield nothing', () => {
  const outDue = { id: 17, title: 'o', due_date: '2026-07-20' };
  const none = { id: 18, title: 'n' };
  const junk = { id: 19, title: 'j', start_date: 'someday', end_date: 'whenever' };
  const { allDay, timed } = timeGridLayout([outDue, none, junk], W3);
  assert.deepStrictEqual(allDay, []);
  assert.deepStrictEqual(Object.values(timed).flat(), []);
});

test('timeGridLayout: overlapping timed blocks in one day column get side-by-side lanes', () => {
  const a = { id: 20, title: 'a', start_date: '2026-07-07T09:00', end_date: '2026-07-07T11:00' };
  const b = { id: 21, title: 'b', start_date: '2026-07-07T10:00', end_date: '2026-07-07T12:00' };
  const { timed } = timeGridLayout([b, a], W3);
  assert.deepStrictEqual(timed['2026-07-07'].map((x) => [x.card.id, x.lane, x.lanes]),
    [[20, 0, 2], [21, 1, 2]]);
});

test('timeGridLayout: the all-day band packs rows greedily — disjoint spans share a row, overlaps stack', () => {
  const wide = { id: 22, title: 'w', start_date: '2026-07-06', end_date: '2026-07-08' };
  const midA = { id: 23, title: 'ma', start_date: '2026-07-06' };
  const midB = { id: 24, title: 'mb', start_date: '2026-07-08' };
  const { allDay, allDayRows } = timeGridLayout([midA, wide, midB], W3);
  const byId = Object.fromEntries(allDay.map((e) => [e.card.id, e.row]));
  assert.strictEqual(byId[22], 0); // the wide span sorts first (longest at equal start)
  assert.strictEqual(byId[23], 1); // overlaps the wide span -> stacked
  assert.strictEqual(byId[24], 1); // disjoint from 23 -> reuses its row, not a third
  assert.strictEqual(allDayRows, 2);
});

test('timeGridLayout: an empty window day still gets an (empty) timed list — the glue iterates days blindly', () => {
  const { timed, allDayRows } = timeGridLayout([], ['2026-07-09']);
  assert.deepStrictEqual(timed, { '2026-07-09': [] });
  assert.strictEqual(allDayRows, 0);
});

// --- monthChipLayout: per-week packed month-grid chips -------------------------------
// A 3-week Monday-first grid, same shape monthGrid() would hand the glue:
//   week 0: 2026-06-29 .. 2026-07-05 (idx 0..6)
//   week 1: 2026-07-06 .. 2026-07-12 (idx 0..6)
//   week 2: 2026-07-13 .. 2026-07-19 (idx 0..6)
const M3 = [
  '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05',
  '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12',
  '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19',
];

test('monthChipLayout: a run inside one week is a single unclipped entry, other weeks empty', () => {
  const card = { id: 1, title: 'r', start_date: '2026-07-01', end_date: '2026-07-03' };
  const weeks = monthChipLayout([card], M3);
  assert.strictEqual(weeks.length, 3);
  assert.deepStrictEqual(weeks[0].entries, [
    { card, time: '', due: false, startIdx: 2, endIdx: 4, clipStart: false, clipEnd: false, row: 0 },
  ]);
  assert.deepStrictEqual(weeks[1].entries, []);
  assert.deepStrictEqual(weeks[2].entries, []);
});

test('monthChipLayout: a run crossing ONE week boundary splits into two clipped pieces, squared at the cut', () => {
  const card = { id: 2, title: 'x', start_date: '2026-07-04', end_date: '2026-07-07' };
  const weeks = monthChipLayout([card], M3);
  assert.deepStrictEqual(weeks[0].entries, [
    { card, time: '', due: false, startIdx: 5, endIdx: 6, clipStart: false, clipEnd: true, row: 0 },
  ]);
  assert.deepStrictEqual(weeks[1].entries, [
    { card, time: '', due: false, startIdx: 0, endIdx: 1, clipStart: true, clipEnd: false, row: 0 },
  ]);
  assert.deepStrictEqual(weeks[2].entries, []);
});

test('monthChipLayout: a run crossing TWO week boundaries gets a clipped piece in every week it touches — the middle piece clipped on both sides', () => {
  const card = { id: 3, title: 'y', start_date: '2026-07-03', end_date: '2026-07-15' };
  const weeks = monthChipLayout([card], M3);
  assert.deepStrictEqual(weeks[0].entries[0],
    { card, time: '', due: false, startIdx: 4, endIdx: 6, clipStart: false, clipEnd: true, row: 0 });
  assert.deepStrictEqual(weeks[1].entries[0],
    { card, time: '', due: false, startIdx: 0, endIdx: 6, clipStart: true, clipEnd: true, row: 0 });
  assert.deepStrictEqual(weeks[2].entries[0],
    { card, time: '', due: false, startIdx: 0, endIdx: 2, clipStart: true, clipEnd: false, row: 0 });
});

test('monthChipLayout: a run clipped by the GRID\'s own start and end (not just a week boundary) — same clipStart/clipEnd test covers both causes', () => {
  // Starts before the grid's first cell and ends after its last — every
  // week's piece clamps to that week's own bounds, and since week 0's start
  // IS the grid's first day, the clip flag falls out of the very same
  // run.startDay/pieceStart comparison a plain week-boundary cut uses.
  const card = { id: 4, title: 'z', start_date: '2026-06-20', end_date: '2026-08-01' };
  const weeks = monthChipLayout([card], M3);
  assert.strictEqual(weeks[0].entries[0].startIdx, 0);
  assert.strictEqual(weeks[0].entries[0].clipStart, true); // 06-29 (grid edge) !== 06-20 (true start)
  assert.strictEqual(weeks[2].entries[0].endIdx, 6);
  assert.strictEqual(weeks[2].entries[0].clipEnd, true); // 07-19 (grid edge) !== 08-01 (true end)
  assert.strictEqual(weeks[1].entries[0].clipStart, true); // the whole middle week is a continuation on both sides
  assert.strictEqual(weeks[1].entries[0].clipEnd, true);
});

test('monthChipLayout: a run entirely outside the grid produces no entries anywhere', () => {
  const before = { id: 5, title: 'b', start_date: '2026-05-01', end_date: '2026-05-05' };
  const after = { id: 6, title: 'a', start_date: '2026-08-01', end_date: '2026-08-05' };
  const weeks = monthChipLayout([before, after], M3);
  for (const week of weeks) assert.deepStrictEqual(week.entries, []);
});

test('monthChipLayout: two disjoint runs in the same week share row 0', () => {
  const a = { id: 7, title: 'a', start_date: '2026-06-29' }; // idx 0
  const b = { id: 8, title: 'b', start_date: '2026-07-01' }; // idx 2, no overlap with a
  const weeks = monthChipLayout([a, b], M3);
  assert.deepStrictEqual(weeks[0].entries.map((e) => [e.card.id, e.row]), [[7, 0], [8, 0]]);
  assert.strictEqual(weeks[0].rows, 1);
});

test('monthChipLayout: two overlapping runs in the same week are forced onto different rows', () => {
  const a = { id: 9, title: 'a', start_date: '2026-06-29', end_date: '2026-07-01' }; // idx 0-2
  const b = { id: 10, title: 'b', start_date: '2026-06-30', end_date: '2026-07-02' }; // idx 1-3, overlaps a
  const weeks = monthChipLayout([a, b], M3);
  assert.deepStrictEqual(weeks[0].entries.map((e) => [e.card.id, e.row]), [[9, 0], [10, 1]]);
  assert.strictEqual(weeks[0].rows, 2);
});

test('monthChipLayout: a single-day card (start-only) is a one-column entry, both clip flags false', () => {
  const card = { id: 11, title: 's', start_date: '2026-07-08' };
  const weeks = monthChipLayout([card], M3);
  assert.deepStrictEqual(weeks[1].entries, [
    { card, time: '', due: false, startIdx: 2, endIdx: 2, clipStart: false, clipEnd: false, row: 0 },
  ]);
});

test('monthChipLayout: a due-only card (no working range) still produces a due entry', () => {
  const card = { id: 12, title: 'd', due_date: '2026-07-09' };
  const weeks = monthChipLayout([card], M3);
  assert.deepStrictEqual(weeks[1].entries, [
    { card, time: '', due: true, startIdx: 3, endIdx: 3, clipStart: false, clipEnd: false, row: 0 },
  ]);
});

test('monthChipLayout: a card\'s range AND its due marker both render, as separate entries — the due chip never gets swallowed by its own card\'s range', () => {
  const card = { id: 13, title: 'both', start_date: '2026-07-06', end_date: '2026-07-08', due_date: '2026-07-07' };
  const weeks = monthChipLayout([card], M3);
  assert.strictEqual(weeks[1].entries.length, 2);
  assert.strictEqual(weeks[1].entries.filter((e) => e.due).length, 1);
  assert.strictEqual(weeks[1].entries.filter((e) => !e.due).length, 1);
});

test('monthChipLayout: ordering rule at equal starts — the LONGER run anchors row 0, a same-start shorter run that overlaps it is pushed to row 1', () => {
  const long = { id: 14, title: 'long', start_date: '2026-06-29', end_date: '2026-07-02' }; // idx 0-3
  const short = { id: 15, title: 'short', start_date: '2026-06-29' }; // idx 0 only, overlaps long at idx 0
  // Pass the shorter one FIRST — the sort, not input order, must decide.
  const weeks = monthChipLayout([short, long], M3);
  assert.deepStrictEqual(weeks[0].entries.map((e) => [e.card.id, e.row]), [[14, 0], [15, 1]]);
});

test('monthChipLayout: end time labels only the piece holding the run\'s true end day', () => {
  const card = { id: 16, title: 't', start_date: '2026-07-04T09:00', end_date: '2026-07-07T17:00' };
  const weeks = monthChipLayout([card], M3);
  assert.strictEqual(weeks[0].entries[0].time, '17:00'); // week 0's piece is clipped at the end — glue decides whether to show it, but the entry always carries the schedule's own time
  assert.strictEqual(weeks[1].entries[0].time, '17:00');
  assert.strictEqual(weeks[0].entries[0].clipEnd, true); // glue: clipEnd true -> suppress the label
  assert.strictEqual(weeks[1].entries[0].clipEnd, false); // glue: clipEnd false -> show '17:00'
});

test('CALENDAR_MAX_CHIP_ROWS_PER_WEEK is 4', () => {
  assert.strictEqual(CALENDAR_MAX_CHIP_ROWS_PER_WEEK, 4);
});

// === time-grid drag-to-retime + edge-resize math ========================
// The sub-month time grid deferred "drag-to-retime within a day's
// hour grid" — these are the pure functions that supersede that deferral: body
// -drag a timed block to a new day+time, and edge-resize a duration block's
// start/end. All reuse rangeFields/shiftValue/timeToMinutes/pruneNoopChanges,
// so the triad + compat contract (ADR 0007) holds by construction. Null = no
// PATCH, no `updated` bump, same convention as rescheduleChanges.

test('minutesToTime: converts minutes to HH:MM', () => {
  assert.strictEqual(minutesToTime(90), '01:30');
  assert.strictEqual(minutesToTime(0), '00:00');
  assert.strictEqual(minutesToTime(540), '09:00');
  assert.strictEqual(minutesToTime(1439), '23:59');
});

test('minutesToTime: clamps above 1439 to 23:59', () => {
  assert.strictEqual(minutesToTime(1440), '23:59');
  assert.strictEqual(minutesToTime(1500), '23:59');
});

test('minutesToTime: clamps below 0 to 00:00', () => {
  assert.strictEqual(minutesToTime(-10), '00:00');
});

test('minutesToTime: rounds fractional minutes', () => {
  assert.strictEqual(minutesToTime(90.4), '01:30');
  assert.strictEqual(minutesToTime(90.6), '01:31');
});

test('CALENDAR_DRAG_SNAP_MIN is the 15-minute snap/min-duration constant', () => {
  assert.strictEqual(CALENDAR_DRAG_SNAP_MIN, 15);
});

// --- rescheduleRangeAtTime (body-drag of the range block) --------------------------

test('rescheduleRangeAtTime: real duration preserves length across day+time change', () => {
  const card = { id: 1, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  assert.deepStrictEqual(rescheduleRangeAtTime(card, '2026-07-11', 480),
    { start_date: '2026-07-11T08:00', end_date: '2026-07-11T09:30' }); // 90-min duration preserved
});

test('rescheduleRangeAtTime: real duration clamps start so it never crosses midnight', () => {
  const card = { id: 2, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T11:00' }; // 120 min
  // target 23:30 (1410) would put the end at 25:30 — clamp start to 1440-120=1320 (22:00).
  // end lands at 1440, which minutesToTime caps at 23:59 (the accepted 1-min
  // boundary loss — cross-midnight is out of scope, hard-clamped to the day).
  assert.deepStrictEqual(rescheduleRangeAtTime(card, '2026-07-10', 1410),
    { start_date: '2026-07-10T22:00', end_date: '2026-07-10T23:59' });
});

test('rescheduleRangeAtTime: compat duration (start_date+due_date) moves both, never invents end_date', () => {
  const card = { id: 3, title: 'c', start_date: '2026-07-10T09:00', due_date: '2026-07-10T10:00' };
  const changes = rescheduleRangeAtTime(card, '2026-07-12', 600); // 10:00, 60-min duration
  assert.deepStrictEqual(changes, { start_date: '2026-07-12T10:00', due_date: '2026-07-12T11:00' });
  assert.ok(!('end_date' in changes), 'a compat drag never invents an end_date');
});

test('rescheduleRangeAtTime: same-day end-time-only point shifts the date-only start sibling to the target day', () => {
  const card = { id: 4, title: 'e', start_date: '2026-07-10', due_date: '2026-07-10T17:00' }; // compat, end-time-only
  const changes = rescheduleRangeAtTime(card, '2026-07-16', 555); // 09:15
  assert.deepStrictEqual(changes, { due_date: '2026-07-16T09:15', start_date: '2026-07-16' });
  assert.ok(!/T/.test(changes.start_date), 'the date-only sibling follows the day but never gains a time');
});

test('rescheduleRangeAtTime: same-day start-time-only point shifts the date-only end sibling to the target day', () => {
  const card = { id: 5, title: 's', start_date: '2026-07-06T09:00', end_date: '2026-07-06' };
  const changes = rescheduleRangeAtTime(card, '2026-07-08', 600); // 10:00
  assert.deepStrictEqual(changes, { start_date: '2026-07-08T10:00', end_date: '2026-07-08' });
});

test('rescheduleRangeAtTime: start-only card moves start_date only', () => {
  const card = { id: 6, title: 'so', start_date: '2026-07-14T08:00' };
  assert.deepStrictEqual(rescheduleRangeAtTime(card, '2026-07-20', 480), { start_date: '2026-07-20T08:00' });
});

test('rescheduleRangeAtTime: end-only card moves its end field only', () => {
  const card = { id: 7, title: 'eo', end_date: '2026-07-14T08:00' };
  assert.deepStrictEqual(rescheduleRangeAtTime(card, '2026-07-20', 480), { end_date: '2026-07-20T08:00' });
});

test('rescheduleRangeAtTime: reversed range moves only the end field, start untouched', () => {
  const card = { id: 8, title: 'rev', start_date: '2026-07-20', end_date: '2026-07-10T14:00' };
  const changes = rescheduleRangeAtTime(card, '2026-07-11', 900); // 15:00
  assert.deepStrictEqual(changes, { end_date: '2026-07-11T15:00' });
  assert.ok(!('start_date' in changes), 'the nonsensical reversed start is left untouched');
});

test('rescheduleRangeAtTime: returns null for a card with no range fields', () => {
  assert.strictEqual(rescheduleRangeAtTime({ id: 9, title: 'x' }, '2026-07-10', 540), null);
  assert.strictEqual(rescheduleRangeAtTime({ id: 10, title: 'due only', due_date: '2026-07-10T09:00' }, '2026-07-10', 540), null);
});

test('rescheduleRangeAtTime: returns null for a genuine forward multi-day range (it is an all-day-band card, never a timed block — the glue never calls this for one)', () => {
  const card = { id: 31, title: 'multi', start_date: '2026-07-10T09:00', end_date: '2026-07-12T09:00' };
  assert.strictEqual(rescheduleRangeAtTime(card, '2026-07-15', 600), null);
});

test('rescheduleRangeAtTime: returns null on a zero-delta drop (same day + same time)', () => {
  const card = { id: 11, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  assert.strictEqual(rescheduleRangeAtTime(card, '2026-07-10', 540), null);
});

test('rescheduleRangeAtTime: omits unrelated fields (priority/status) from the changes object', () => {
  const card = { id: 12, title: 'd', priority: 'High', status: 'todo', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:00' };
  const changes = rescheduleRangeAtTime(card, '2026-07-11', 540);
  assert.deepStrictEqual(Object.keys(changes).sort(), ['end_date', 'start_date']);
});

// --- rescheduleDueAtTime (body-drag of the due block) ------------------------------

test('rescheduleDueAtTime: moves due_date to the new day+time', () => {
  const card = { id: 13, title: 'due', due_date: '2026-07-14T09:00' };
  assert.deepStrictEqual(rescheduleDueAtTime(card, '2026-07-16', 555), { due_date: '2026-07-16T09:15' });
});

test('rescheduleDueAtTime: returns null when the card has no due_date', () => {
  assert.strictEqual(rescheduleDueAtTime({ id: 14, title: 'x', start_date: '2026-07-10T09:00' }, '2026-07-11', 540), null);
});

test('rescheduleDueAtTime: returns null on a zero-delta drop', () => {
  const card = { id: 15, title: 'due', due_date: '2026-07-14T09:00' };
  assert.strictEqual(rescheduleDueAtTime(card, '2026-07-14', 540), null);
});

// --- resizeRangeAtTime (edge-resize of a duration block) --------------------------

test('resizeRangeAtTime: end-handle moves end_date, start untouched', () => {
  const card = { id: 16, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  const changes = resizeRangeAtTime(card, 'end', 675); // 11:15
  assert.deepStrictEqual(changes, { end_date: '2026-07-10T11:15' });
  assert.ok(!('start_date' in changes));
});

test('resizeRangeAtTime: end-handle clamps to the min-duration (sMin+15) on overshoot toward start', () => {
  const card = { id: 17, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  assert.deepStrictEqual(resizeRangeAtTime(card, 'end', 545), { end_date: '2026-07-10T09:15' }); // 540+15
});

test('resizeRangeAtTime: end-handle clamps at the day boundary (23:59) past midnight', () => {
  const card = { id: 18, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  assert.deepStrictEqual(resizeRangeAtTime(card, 'end', 1450), { end_date: '2026-07-10T23:59' });
});

test('resizeRangeAtTime: start-handle moves start_date, end untouched', () => {
  const card = { id: 19, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  const changes = resizeRangeAtTime(card, 'start', 480); // 08:00
  assert.deepStrictEqual(changes, { start_date: '2026-07-10T08:00' });
  assert.ok(!('end_date' in changes));
});

test('resizeRangeAtTime: start-handle clamps to the min-duration (eMin-15) on overshoot toward end', () => {
  const card = { id: 20, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  assert.deepStrictEqual(resizeRangeAtTime(card, 'start', 620), { start_date: '2026-07-10T10:15' }); // 630-15
});

test('resizeRangeAtTime: start-handle clamps at the day boundary (00:00)', () => {
  const card = { id: 21, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  assert.deepStrictEqual(resizeRangeAtTime(card, 'start', -30), { start_date: '2026-07-10T00:00' });
});

test('resizeRangeAtTime: compat duration end-handle writes due_date, never invents end_date', () => {
  const card = { id: 22, title: 'c', start_date: '2026-07-10T09:00', due_date: '2026-07-10T10:00' };
  const changes = resizeRangeAtTime(card, 'end', 690); // 11:30
  assert.deepStrictEqual(changes, { due_date: '2026-07-10T11:30' });
  assert.ok(!('end_date' in changes), 'a compat resize never invents an end_date');
});

test('resizeRangeAtTime: returns null for a point block (only one time set)', () => {
  const startOnly = { id: 23, title: 'p', start_date: '2026-07-10T09:00' };
  const oneTime = { id: 24, title: 'p2', start_date: '2026-07-10', end_date: '2026-07-10T17:00' };
  assert.strictEqual(resizeRangeAtTime(startOnly, 'end', 700), null);
  assert.strictEqual(resizeRangeAtTime(oneTime, 'start', 300), null);
});

test('resizeRangeAtTime: returns null for a reversed or multi-day range', () => {
  const reversed = { id: 25, title: 'r', start_date: '2026-07-10T17:00', end_date: '2026-07-10T09:00' }; // eMin<=sMin
  const multiday = { id: 26, title: 'm', start_date: '2026-07-10T09:00', end_date: '2026-07-12T10:00' };
  assert.strictEqual(resizeRangeAtTime(reversed, 'end', 700), null);
  assert.strictEqual(resizeRangeAtTime(multiday, 'end', 700), null);
});

test('resizeRangeAtTime: returns null for a card with no range at all', () => {
  assert.strictEqual(resizeRangeAtTime({ id: 27, title: 'x' }, 'end', 700), null);
  assert.strictEqual(resizeRangeAtTime({ id: 28, title: 'due', due_date: '2026-07-10T09:00' }, 'end', 700), null);
});

test('resizeRangeAtTime: returns null on a zero-delta resize', () => {
  const card = { id: 29, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  assert.strictEqual(resizeRangeAtTime(card, 'end', 630), null); // already 10:30
  assert.strictEqual(resizeRangeAtTime(card, 'start', 540), null); // already 09:00
});

test('resizeRangeAtTime: an unknown edge value returns null', () => {
  const card = { id: 30, title: 'd', start_date: '2026-07-10T09:00', end_date: '2026-07-10T10:30' };
  assert.strictEqual(resizeRangeAtTime(card, 'middle', 600), null);
});

// --- calendarCreateStart (click-to-create prefill) ---------------------

test('calendarCreateStart: no rawMin (month/all-day double-click) prefills a date-only day', () => {
  assert.strictEqual(calendarCreateStart('2026-07-20'), '2026-07-20');
  assert.strictEqual(calendarCreateStart('2026-07-20', null), '2026-07-20');
});

test('calendarCreateStart: a time-grid rawMin snaps to the CALENDAR_DRAG_SNAP_MIN grid', () => {
  assert.strictEqual(calendarCreateStart('2026-07-20', 0), '2026-07-20T00:00');
  assert.strictEqual(calendarCreateStart('2026-07-20', 600), '2026-07-20T10:00'); // already on-grid
  assert.strictEqual(calendarCreateStart('2026-07-20', 37), '2026-07-20T00:30'); // 37 -> nearest 15 (30)
  assert.strictEqual(calendarCreateStart('2026-07-20', 53), '2026-07-20T01:00'); // 53 -> nearest 15 (60)
});

test('calendarCreateStart: clamps a rawMin from a click above/below the grid', () => {
  assert.strictEqual(calendarCreateStart('2026-07-20', -20), '2026-07-20T00:00');
  assert.strictEqual(calendarCreateStart('2026-07-20', 1439), '2026-07-20T23:59'); // snaps past 1439, then clamps
  assert.strictEqual(calendarCreateStart('2026-07-20', 1500), '2026-07-20T23:59');
});
