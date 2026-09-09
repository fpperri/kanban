const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { isOverdue } = require('../web/column-sort');

// kanban.proj#258 — a card is overdue when due_date's day part (before any
// 'T') is strictly earlier than today, the card isn't done, and it isn't
// archived. Day-granular on purpose: every other date treatment in this app
// (localTodayStr, chipPositionForDay, the gantt's day columns) works in whole
// days, so a 09:00 deadline today reads the same as one due at 23:59 — not
// overdue until tomorrow's date rolls over.

// --- isOverdue (column-sort.js) --------------------------------------

test('a due_date strictly before today is overdue', () => {
  assert.strictEqual(isOverdue({ due_date: '2026-07-09', status: 'todo' }, '2026-07-10'), true);
});

test('a due_date of today is NOT overdue — strictly earlier only', () => {
  assert.strictEqual(isOverdue({ due_date: '2026-07-10', status: 'todo' }, '2026-07-10'), false);
});

test('a due_date after today is not overdue', () => {
  assert.strictEqual(isOverdue({ due_date: '2026-07-11', status: 'todo' }, '2026-07-10'), false);
});

test('a due datetime earlier TODAY is not overdue — day-granular, not clock-granular', () => {
  // 09:00 due today, checked at any wall-clock time today: still today's day.
  assert.strictEqual(isOverdue({ due_date: '2026-07-10T09:00', status: 'todo' }, '2026-07-10'), false);
});

test('a due datetime on a past day IS overdue regardless of its time-of-day', () => {
  assert.strictEqual(isOverdue({ due_date: '2026-07-09T23:59', status: 'todo' }, '2026-07-10'), true);
});

test('a done card is never overdue — the deadline stopped being actionable', () => {
  assert.strictEqual(isOverdue({ due_date: '2026-01-01', status: 'done' }, '2026-07-10'), false);
});

test('an archived card is never overdue, even with a past due_date and a live status', () => {
  assert.strictEqual(isOverdue({ due_date: '2026-01-01', status: 'todo', archived: true }, '2026-07-10'), false);
});

test('a card with no due_date is never overdue, whatever start/end say', () => {
  assert.strictEqual(isOverdue({ status: 'todo' }, '2026-07-10'), false);
  assert.strictEqual(isOverdue({ start_date: '2020-01-01', end_date: '2020-01-02', status: 'todo' }, '2026-07-10'), false);
});

test('a card with only start/end dates (no due_date) is never overdue — overdue tracks the deadline, not the range', () => {
  // A range sliding past today is a schedule slip, not a missed deadline —
  // scheduleKey's triad (due, else end, else start) is deliberately NOT
  // reused here.
  assert.strictEqual(isOverdue({ start_date: '2026-01-01', end_date: '2026-01-02', status: 'todo' }, '2026-07-10'), false);
});

test('an unparseable due_date never flags overdue — fails safe rather than misreading garbage as a date', () => {
  assert.strictEqual(isOverdue({ due_date: 'not-a-date', status: 'todo' }, '2026-07-10'), false);
  assert.strictEqual(isOverdue({ due_date: '', status: 'todo' }, '2026-07-10'), false);
});

// --- surface wiring — each place that already renders the deadline chip
// applies the overdue cue on top of it (structure tests against the source,
// same convention as assignee-badge.test.js's applyAssignees pin: app.js DOM
// glue isn't require-able, jsdom isn't wired into this suite). ------------

const appJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');

test('board tile: cardEl adds .overdue to the schedule chip and a "Past due" tooltip', () => {
  assert.match(appJs, /const overdue = isOverdue\(card, localTodayStr\(\)\);/);
  assert.match(appJs, /card-schedule\$\{overdue \? ' overdue' : ''\}/);
  assert.match(appJs, /overdue \? ' title="Past due"' : ''/);
});

test('board tile: app.css styles .card-schedule.overdue in the danger red, not a border (priority/waiting own the left accent)', () => {
  assert.match(appCss, /\.card-schedule\.overdue\s*\{[^}]*color:\s*#f85149/);
  assert.doesNotMatch(appCss, /\.card-schedule\.overdue\s*\{[^}]*border/);
});

test('calendar: calendarChipEl flags the due chip overdue and only the due chip', () => {
  assert.match(appJs, /const overdue = isDue && isOverdue\(card, localTodayStr\(\)\);/);
  assert.match(appJs, /\(overdue \? ' overdue' : ''\)/);
});

test('calendar: app.css overdue rule is declared after cal-chip-due so red wins over the amber due border', () => {
  const dueIdx = appCss.indexOf('.cal-chip.cal-chip-due');
  const overdueIdx = appCss.indexOf('.cal-chip.overdue');
  assert.ok(dueIdx > -1 && overdueIdx > -1 && overdueIdx > dueIdx);
  assert.match(appCss, /\.cal-chip\.overdue\s*\{[^}]*#f85149/);
});

test('gantt: the due diamond gets .overdue and a "past due" tooltip fragment', () => {
  assert.match(appJs, /const overdue = isOverdue\(bar\.card, today\);/);
  assert.match(appJs, /'gantt-due-marker card-el' \+ \(bar\.card\.archived \? ' archived' : ''\) \+ \(overdue \? ' overdue' : ''\)/);
  assert.match(appJs, /overdue \? ' — past due' : ''/);
});

test('gantt: app.css styles .gantt-due-marker.overdue in the same danger red', () => {
  assert.match(appCss, /\.gantt-due-marker\.overdue::before\s*\{[^}]*#f85149/);
});

// --- doc pin: SKILL.md documents the overdue cue ---

test('SKILL.md documents the overdue cue on all three surfaces that draw a deadline', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  const start = skill.indexOf('- **Overdue cue**');
  assert.ok(start > -1, 'the Overdue cue bullet exists');
  const bullet = skill.slice(start, skill.indexOf('- **Assignee text color**', start));
  assert.match(bullet, /isOverdue\(\)/, 'names the predicate');
  assert.match(bullet, /due_date/, 'states the field it keys on');
  assert.match(bullet, /schedule chip/, 'covers the board tile');
  assert.match(bullet, /due chip/, 'covers the calendar');
  assert.match(bullet, /diamond/, 'covers the gantt');
  assert.match(bullet, /archiveCardEl/, 'states the Archive column opts out');
});

test('SKILL.md no longer calls the calendar/gantt deadline cue unconditionally amber', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  assert.match(skill, /deadline chip \(amber border \+ ⚑ flag, red once \*\*overdue\*\*\)/);
  assert.match(skill, /amber diamond marker \(red once \*\*overdue\*\*;/);
});
