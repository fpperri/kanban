const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- the month grid renders spanning chips, not one-per-day --------------
// Card #259: a multi-day card used to render as one chip PER DAY CELL,
// independently positioned inside each day's own bordered box — same bug
// class board-header-layout.test.js's header note warns about (a
// regex-only check against source text that never proved the DOM shape).
// These pin the actual renderer structure: monthChipLayout does the
// packing (calendar-model.test.js covers its behaviour exhaustively), this
// only pins that renderCalendarMonthGrid actually CONSUMES that packed
// output — one chip per week-row entry, placed by an explicit column span —
// rather than quietly falling back to a per-day loop.

const appJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
const renderFn = appJs.match(/function renderCalendarMonthGrid\([\s\S]*?\n\}/)[0];

test('renderCalendarMonthGrid drives its chips from monthChipLayout, not a per-day chipPositionForDay loop', () => {
  assert.match(renderFn, /monthChipLayout\(allCards, cells\.map/,
    'the packed per-week layout function replaces the old per-day scan');
  assert.doesNotMatch(renderFn, /chipPositionForDay\(/,
    'the per-day position lookup that produced one chip per day cell must not still be CALLED by the render (a historical comment mentioning it by name is fine)');
});

test('renderCalendarMonthGrid places each chip by an explicit column span (one element, several days wide)', () => {
  assert.match(renderFn, /chip\.style\.gridColumn = `\$\{entry\.startIdx \+ 1\} \/ \$\{entry\.endIdx \+ 2\}`/,
    'a multi-day entry becomes ONE chip spanning startIdx..endIdx, mirroring the all-day band\'s gridColumn placement');
  assert.match(renderFn, /chip\.style\.gridRow = `\$\{entry\.row \+ 2\}`/,
    'the chip lands on its packed row, not a per-day flex position');
});

test('renderCalendarMonthGrid builds one .cal-week per week row, iterating monthChipLayout\'s weeks — not one flat pass over every day cell', () => {
  assert.match(renderFn, /weekRows\.forEach\(\(week, w\) => \{/, 'iterates the packed per-week result');
  assert.match(renderFn, /weekEl\.className = 'cal-week'/, 'each week row is its own nested grid container');
});

test('renderCalendarMonthGrid keeps the background day cell as the drop target, spanning UNDER the overlaid chips', () => {
  assert.match(renderFn, /dayEl\.dataset\.day = cell\.date/, 'the day cell still carries the day-drop contract wireCalendarDrag reads');
  assert.match(renderFn, /dayEl\.style\.gridRow = '1 \/ -1'/, 'the day cell spans the full week height so it stays a box behind the chip overlay, same shape as .cal-tg-allday-cell');
});

test('renderCalendarMonthGrid caps overflow per WEEK (CALENDAR_MAX_CHIP_ROWS_PER_WEEK), not per day cell', () => {
  assert.match(renderFn, /CALENDAR_MAX_CHIP_ROWS_PER_WEEK/, 'the new per-week cap constant gates visibility');
  assert.doesNotMatch(renderFn, /capChips\(/, 'the old per-day slice-based cap must not still run here');
});

test('app.css gives .cal-week a nested per-week grid keyed off --cal-week-rows, set per render', () => {
  assert.match(appCss, /\.cal-week\s*\{[^}]*grid-template-rows:\s*minmax\(16px, auto\) repeat\(var\(--cal-week-rows\), minmax\(20px, auto\)\)/,
    'chip rows are explicit grid tracks the JS sizes via a custom property, same --cal-day-cols precedent as the time grid');
});

test('app.css reuses .clip-start/.clip-end for month chips cut at a week boundary or the grid edge, same visual as the all-day band', () => {
  assert.match(appCss, /\.cal-allday-chip\.clip-start,\s*\.cal-month-chip\.clip-start/,
    'the month grid does not reinvent its own clipped-edge styling');
  assert.match(appCss, /\.cal-allday-chip\.clip-end,\s*\.cal-month-chip\.clip-end/);
});
