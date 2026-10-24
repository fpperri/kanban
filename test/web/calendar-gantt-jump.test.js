const { test } = require('node:test');
const assert = require('node:assert');
const {
  nearestMatchDay, viewShownCards, calendarVisibleRange, monthGrid,
} = require('../web/calendar-model');
const { ganttNearestMatchDay, ganttSubviewWindow, GANTT_SUBVIEWS } = require('../web/gantt-model');

// When a change to the search box leaves no shown match inside the Calendar's
// or the Gantt's visible range, the view moves to the match nearest that range.
// One pure function decides for both views: nearestMatchDay(view, range) in the
// Calendar model, which answers the day to move to or null. `view` is what the
// view composes before it draws: the cards, the ids the search box matches, the
// ids the status pills leave on, and whether the Archive pill is on.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, status: 'todo', start_date: null, end_date: null, due_date: null, archived: false, ...over,
});

const WEEK = { startDay: '2026-07-06', endDay: '2026-07-12' };

// Every card matches, no status pill hides anything, the Archive pill is off.
const view = (active, over = {}) => ({
  active, archived: [], searchIds: new Set(active.map((c) => c.id)), statusIds: null, archiveOn: false, ...over,
});

// --- nothing to do when a shown match is already on screen ----------------------------

test('nearestMatchDay: a shown match with a day of its span inside the range is on screen, so nothing moves', () => {
  assert.strictEqual(nearestMatchDay(view([card(1, { start_date: '2026-07-10', end_date: '2026-07-11' })]), WEEK), null);
});

test('nearestMatchDay: a due date inside the range is on screen, so nothing moves', () => {
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-07-08T09:30' })]), WEEK), null);
});

test('nearestMatchDay: a span that only crosses the range, starting before it and ending after it, is on screen', () => {
  assert.strictEqual(nearestMatchDay(view([card(1, { start_date: '2026-06-01', end_date: '2026-08-30' })]), WEEK), null);
});

test('nearestMatchDay: the first and the last day of the range count', () => {
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-07-06' })]), WEEK), null);
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-07-12' })]), WEEK), null);
});

test('nearestMatchDay: one match on screen is enough, however many lie outside', () => {
  const cards = [card(1, { due_date: '2026-01-01' }), card(2, { due_date: '2026-07-07' }), card(3, { due_date: '2027-01-01' })];
  assert.strictEqual(nearestMatchDay(view(cards), WEEK), null);
});

// --- the nearest match, before or after the range -------------------------------------

test('nearestMatchDay: with nothing on screen it answers the day of the match closest to the range, before it', () => {
  const cards = [card(1, { due_date: '2026-06-20' }), card(2, { due_date: '2026-05-01' }), card(3, { due_date: '2026-09-01' })];
  assert.strictEqual(nearestMatchDay(view(cards), WEEK), '2026-06-20');
});

test('nearestMatchDay: and after it', () => {
  const cards = [card(1, { due_date: '2026-07-14' }), card(2, { due_date: '2026-05-01' }), card(3, { due_date: '2026-09-01' })];
  assert.strictEqual(nearestMatchDay(view(cards), WEEK), '2026-07-14');
});

test('nearestMatchDay: a span before the range is reached at its last day, a span after it at its first', () => {
  assert.strictEqual(nearestMatchDay(view([card(1, { start_date: '2026-05-01', end_date: '2026-06-30' })]), WEEK), '2026-06-30');
  assert.strictEqual(nearestMatchDay(view([card(1, { start_date: '2026-07-20', end_date: '2026-08-30' })]), WEEK), '2026-07-20');
});

test('nearestMatchDay: a card counts by its span or by its due date, whichever lies closer', () => {
  const far = card(1, { start_date: '2026-05-01', end_date: '2026-05-05', due_date: '2026-07-14' });
  assert.strictEqual(nearestMatchDay(view([far]), WEEK), '2026-07-14');
  const near = card(2, { start_date: '2026-07-01', end_date: '2026-07-03', due_date: '2026-09-14' });
  assert.strictEqual(nearestMatchDay(view([near]), WEEK), '2026-07-03');
});

test('nearestMatchDay: a start-only, an end-only and a start-and-due card count by the days the Calendar draws', () => {
  assert.strictEqual(nearestMatchDay(view([card(1, { start_date: '2026-07-20' })]), WEEK), '2026-07-20');
  assert.strictEqual(nearestMatchDay(view([card(1, { end_date: '2026-06-25' })]), WEEK), '2026-06-25');
  assert.strictEqual(nearestMatchDay(view([card(1, { start_date: '2026-06-01', due_date: '2026-06-10' })]), WEEK), '2026-06-10');
  assert.strictEqual(nearestMatchDay(view([card(1, { start_date: '2026-06-10', end_date: '2026-06-01' })]), WEEK), '2026-06-01', 'a reversed range collapses to its end');
});

test('nearestMatchDay: a match before the range and one after it at the same distance resolve to the earlier day, whatever the order', () => {
  const before = card(1, { due_date: '2026-07-01' });
  const after = card(2, { due_date: '2026-07-17' });
  assert.strictEqual(nearestMatchDay(view([before, after]), WEEK), '2026-07-01');
  assert.strictEqual(nearestMatchDay(view([after, before]), WEEK), '2026-07-01');
  assert.strictEqual(nearestMatchDay(view([after, before]), WEEK), '2026-07-01', 'the same input gives the same answer');
});

test('nearestMatchDay: one day nearer on either side wins over the tie rule', () => {
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-07-02' }), card(2, { due_date: '2026-07-17' })]), WEEK), '2026-07-02');
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-06-30' }), card(2, { due_date: '2026-07-17' })]), WEEK), '2026-07-17');
});

// --- what is not a target -------------------------------------------------------------

test('nearestMatchDay: a card that matches the search but is not dated is never a target', () => {
  assert.strictEqual(nearestMatchDay(view([card(1), card(2, { start_date: 'soon' })]), WEEK), null);
  assert.strictEqual(nearestMatchDay(view([card(1), card(2, { due_date: '2026-06-20' })]), WEEK), '2026-06-20');
});

test('nearestMatchDay: with no dated match it answers nothing, and so does an empty board', () => {
  assert.strictEqual(nearestMatchDay(view([]), WEEK), null);
  assert.strictEqual(nearestMatchDay(view([card(1)]), WEEK), null);
});

test('nearestMatchDay: a card the search does not match is not a target, however near', () => {
  const cards = [card(1, { due_date: '2026-07-14' }), card(2, { due_date: '2026-06-01' })];
  assert.strictEqual(nearestMatchDay(view(cards, { searchIds: new Set([2]) }), WEEK), '2026-06-01');
});

test('nearestMatchDay: with no search there are no matches, so nothing moves', () => {
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-06-01' })], { searchIds: null }), WEEK), null);
});

// --- shown means drawn: the status pills and the Archive pill ---------------------------

test('nearestMatchDay: a match a status pill hides does not count as on screen', () => {
  const hidden = card(1, { status: 'done', due_date: '2026-07-08' });
  const far = card(2, { due_date: '2026-09-01' });
  assert.strictEqual(nearestMatchDay(view([hidden, far], { statusIds: new Set([2]) }), WEEK), '2026-09-01');
});

test('nearestMatchDay: and a match a status pill hides is not a target either', () => {
  const hidden = card(1, { status: 'done', due_date: '2026-07-14' });
  const far = card(2, { due_date: '2026-09-01' });
  assert.strictEqual(nearestMatchDay(view([hidden, far], { statusIds: new Set([2]) }), WEEK), '2026-09-01');
  assert.strictEqual(nearestMatchDay(view([hidden], { statusIds: new Set() }), WEEK), null);
});

test('nearestMatchDay: an archived match does not count while the Archive pill is off', () => {
  const archived = [card(9, { archived: true, due_date: '2026-07-08' })];
  const live = [card(2, { due_date: '2026-09-01' })];
  const off = { archived, searchIds: new Set([2, 9]), archiveOn: false };
  assert.strictEqual(nearestMatchDay(view(live, off), WEEK), '2026-09-01');
  assert.strictEqual(nearestMatchDay(view([], off), WEEK), null, 'and it is no target');
});

test('nearestMatchDay: an archived match counts once the Archive pill is on, and the status pills do not govern it', () => {
  const archived = [card(9, { archived: true, status: 'done', due_date: '2026-07-08' })];
  const on = { archived, searchIds: new Set([2, 9]), archiveOn: true, statusIds: new Set([2]) };
  assert.strictEqual(nearestMatchDay(view([card(2, { due_date: '2026-09-01' })], on), WEEK), null);
  const farArchived = [card(9, { archived: true, due_date: '2026-06-20' })];
  assert.strictEqual(nearestMatchDay(view([card(2, { due_date: '2026-09-01' })], { ...on, archived: farArchived }), WEEK), '2026-06-20');
});

test('nearestMatchDay: an archived card the search does not match never counts, with the Archive pill on', () => {
  const archived = [card(9, { archived: true, due_date: '2026-07-08' })];
  assert.strictEqual(nearestMatchDay(view([card(2, { due_date: '2026-09-01' })], { archived, searchIds: new Set([2]), archiveOn: true }), WEEK), '2026-09-01');
});

test('viewShownCards: live cards the search and the status pills both keep, then archived cards the search keeps when the Archive pill is on', () => {
  const active = [card(1), card(2), card(3)];
  const archived = [card(8, { archived: true }), card(9, { archived: true })];
  const shown = viewShownCards({ active, archived, searchIds: new Set([1, 2, 9]), statusIds: new Set([2, 3]), archiveOn: true });
  assert.deepStrictEqual(shown.live.map((c) => c.id), [2]);
  assert.deepStrictEqual(shown.archived.map((c) => c.id), [9]);
  const off = viewShownCards({ active, archived, searchIds: new Set([1, 2, 9]), statusIds: new Set([2, 3]), archiveOn: false });
  assert.deepStrictEqual(off.archived, []);
});

test('viewShownCards: with no search and no status pill off everything is shown, and archived cards only with the Archive pill', () => {
  const active = [card(1), card(2)];
  const archived = [card(9, { archived: true })];
  const base = { active, archived, searchIds: null, statusIds: null };
  assert.deepStrictEqual(viewShownCards({ ...base, archiveOn: false }).live, active);
  assert.deepStrictEqual(viewShownCards({ ...base, archiveOn: false }).archived, []);
  assert.deepStrictEqual(viewShownCards({ ...base, archiveOn: true }).archived, archived);
});

// --- the Calendar's visible range ----------------------------------------------------------

test('calendarVisibleRange: a month is every cell of its grid, the leading and the trailing days included', () => {
  assert.deepStrictEqual(calendarVisibleRange('month', '2026-07-15'), { startDay: '2026-06-29', endDay: '2026-08-02' });
  const cells = monthGrid(2026, 6);
  assert.strictEqual(cells[0].date, '2026-06-29');
  assert.strictEqual(cells[cells.length - 1].date, '2026-08-02');
  assert.deepStrictEqual(calendarVisibleRange('month', '2026-02-01'), { startDay: '2026-01-26', endDay: '2026-03-01' });
});

test('calendarVisibleRange: a week runs Monday to Sunday, three days run from the anchor, a day is the anchor', () => {
  assert.deepStrictEqual(calendarVisibleRange('week', '2026-07-08'), { startDay: '2026-07-06', endDay: '2026-07-12' });
  assert.deepStrictEqual(calendarVisibleRange('3day', '2026-07-08'), { startDay: '2026-07-08', endDay: '2026-07-10' });
  assert.deepStrictEqual(calendarVisibleRange('day', '2026-07-08'), { startDay: '2026-07-08', endDay: '2026-07-08' });
});

test('the Calendar month counts the leading and trailing days of its grid as on screen', () => {
  const range = calendarVisibleRange('month', '2026-07-15');
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-06-30' })]), range), null, 'a leading day of the grid');
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-08-02' })]), range), null, 'a trailing day of the grid');
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-06-28' })]), range), '2026-06-28', 'one day before the grid is not');
  assert.strictEqual(nearestMatchDay(view([card(1, { due_date: '2026-08-03' })]), range), '2026-08-03', 'one day after the grid is not');
});

test('every Calendar span decides with the same function: month, week, 3 days and day', () => {
  const due = view([card(1, { due_date: '2026-09-15' })]);
  for (const sv of ['month', 'week', '3day', 'day']) {
    assert.strictEqual(nearestMatchDay(due, calendarVisibleRange(sv, '2026-07-08')), '2026-09-15', sv);
    assert.strictEqual(nearestMatchDay(due, calendarVisibleRange(sv, '2026-09-15')), null, sv);
  }
});

// --- the Gantt serves its sized sub-views with the same function --------------------------------

test('ganttNearestMatchDay: month, week, 3 days and day each decide on their own window with the same function', () => {
  const far = view([card(1, { due_date: '2031-06-25' })]);
  for (const sv of ['month', 'week', '3day', 'day']) {
    const win = ganttSubviewWindow(sv, '2026-07-08');
    assert.strictEqual(ganttNearestMatchDay(far, sv, '2026-07-08'), nearestMatchDay(far, win), sv);
    assert.strictEqual(ganttNearestMatchDay(far, sv, '2026-07-08'), '2031-06-25', sv);
    assert.strictEqual(ganttNearestMatchDay(far, sv, '2031-06-25'), null, `${sv}: on screen`);
  }
});

test('ganttNearestMatchDay: the Gantt month is the month\'s own days, with no leading or trailing days', () => {
  assert.strictEqual(ganttNearestMatchDay(view([card(1, { due_date: '2026-06-30' })]), 'month', '2026-07-15'), '2026-06-30');
  assert.strictEqual(ganttNearestMatchDay(view([card(1, { due_date: '2026-07-01' })]), 'month', '2026-07-15'), null);
  assert.strictEqual(ganttNearestMatchDay(view([card(1, { due_date: '2026-08-01' })]), 'month', '2026-07-15'), '2026-08-01');
});

test('ganttNearestMatchDay: the all sub-view never jumps, whatever is on screen', () => {
  assert.ok(GANTT_SUBVIEWS.includes('all'));
  assert.strictEqual(ganttNearestMatchDay(view([card(1, { due_date: '2031-06-25' })]), 'all', '2026-07-08'), null);
  assert.strictEqual(ganttNearestMatchDay(view([]), 'all', '2026-07-08'), null);
});

test('ganttNearestMatchDay: a match the Gantt\'s pills hide does not count there either', () => {
  const hidden = card(1, { status: 'done', due_date: '2026-07-08' });
  const far = card(2, { due_date: '2026-09-01' });
  assert.strictEqual(ganttNearestMatchDay(view([hidden, far], { statusIds: new Set([2]) }), 'month', '2026-07-15'), '2026-09-01');
});
