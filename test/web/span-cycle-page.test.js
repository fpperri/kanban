const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control } = require('./helpers/page-vm');
const { tagsOf, assertKeepsSelection, assertHoldsPoll } = require('./helpers/markers');

// The span cycle button of the Calendar and the Gantt: on a phone it stands in for the span switch,
// and each tap moves to the next span, wrapping. The real page runs in a vm; a tap is a click on
// the view's delegated listener whose target is the cycle button.

const BOARD = {
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [{
    id: 1, title: 'Card 1', body: '', status: 'doing', priority: 'Normal', waiting_for: [], blocked: null,
    review: null, tags: [], assignee: null, type: null, start_date: '2026-07-14', end_date: '2026-07-16', due_date: null,
    parent: null, rank: null, file: '/board/1.card.md', archived: false,
  }],
  archived: [],
};

async function pageIn(view) {
  const elements = { '#calendar-view': control(), '#gantt-view': control() };
  const stored = {};
  const page = loadPage({ board: BOARD, stored, elements });
  await page.start();
  page.run(`toggleView('${view}')`);
  return { page, stored, view: elements[`#${view}-view`] };
}

const tap = (view) => view.fire('click', {
  target: { closest: (sel) => (sel === '.cal-span-cycle' ? { dataset: {} } : null) },
  preventDefault() {}, stopPropagation() {},
});

test('four taps on the Calendar cycle button go Week, 3 days, Day, Month and save calendar.subview each time', async () => {
  const { page, stored, view } = await pageIn('calendar');
  const key = 'kanban.calendar.subview';
  const saved = () => Object.entries(stored).find(([k]) => k.endsWith('calendar.subview'));
  assert.strictEqual(page.run('loadCalendarSubview()'), 'month');
  const walked = [];
  for (let i = 0; i < 4; i++) { tap(view); walked.push(page.run('loadCalendarSubview()')); assert.strictEqual(saved()[1], walked[i], key); }
  assert.deepStrictEqual(walked, ['week', '3day', 'day', 'month']);
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
});

test('five taps on the Gantt cycle button go Month, Week, 3 days, Day, All and save gantt.subview each time', async () => {
  const { page, stored, view } = await pageIn('gantt');
  const saved = () => Object.entries(stored).find(([k]) => k.endsWith('gantt.subview'));
  assert.strictEqual(page.run('loadGanttSubview()'), 'all');
  const walked = [];
  for (let i = 0; i < 5; i++) { tap(view); walked.push(page.run('loadGanttSubview()')); assert.strictEqual(saved()[1], walked[i]); }
  assert.deepStrictEqual(walked, ['month', 'week', '3day', 'day', 'all']);
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
});

test('both cycle buttons keep the selection and hold the poll', () => {
  assert.strictEqual(tagsOf('.cal-span-cycle').length, 2, 'one in the Calendar\'s controls and one in the Gantt\'s');
  assertKeepsSelection(['.cal-span-cycle'], 'the span cycle button');
  assertHoldsPoll(['.cal-span-cycle'], 'the span cycle button');
});

test('each cycle button has its own class, shows the current span and names the next span to a screen reader, and the span buttons stay', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.js'), 'utf8');
  const sites = src.split('\n').filter((l) => l.includes('cal-span-cycle cal-nav'));
  assert.strictEqual(sites.length, 2);
  for (const l of sites) {
    assert.ok(!l.includes('cal-subview-btn'));
    assert.match(l, /aria-label="Span: \$\{(CAL|GANTT)_SUBVIEW_LABELS\[subview\]\}\. Change to \$\{(CAL|GANTT)_SUBVIEW_LABELS\[nextSubview\(/);
    assert.match(l, />\$\{(CAL|GANTT)_SUBVIEW_LABELS\[subview\]\} &#8635;<\/button>/);
  }
  assert.strictEqual(src.split('\n').filter((l) => l.includes('class="cal-subview-btn cal-nav')).length, 2);
});

test('one phone block hides the span switch and shows the cycle button, and the reverse applies from 760 px', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.cal-span-cycle \{ display: none;/);
  const block = css.match(/@media \(max-width: 759\.98px\) \{\s*\.cal-subview-switch \{ display: none; \}\s*\.cal-span-cycle \{ display: inline-block; \}\s*\}/);
  assert.ok(block, 'the 760 px block');
  assert.match(css, /\.cal-subview-switch \{ display: flex;/);
});
