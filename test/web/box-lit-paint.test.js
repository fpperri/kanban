const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control } = require('./helpers/page-vm');
const { recordingDocument } = require('./helpers/recording-dom');

// A card the box lights with isolate off wears the selected look beside the selected cards, through the
// page's one predicate (paintsSelected): the Board's tile, an archived tile, a Calendar chip and a
// Gantt bar here, run in the real page. The Map's node has its own test (map-render-svg.test.js), and
// the Graph's lane headers sit in graph-flow-view.test.js. No view paints the look from the selection
// alone.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const board = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', start_date: '2026-05-04', end_date: '2026-05-08', due_date: '2026-05-08' }),
    card(2, { title: 'Move the data layer', start_date: '2026-05-05', end_date: '2026-05-06', due_date: '2026-05-06' }),
  ],
  archived: [card(9, { title: 'Old news', status: 'done', archived: true })],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];

async function open() {
  const elements = {};
  for (const sel of HIDDEN) { const el = control(); el.classList.add('hidden'); elements[sel] = el; }
  const page = await loadPage({ board: board(), stored: { 'kanban.kanban.view.mode': 'board' }, elements, documentExtras: recordingDocument() }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return page;
}

const classes = (el) => String(el.className).split(/\s+/);

test('the Board tile and the archived tile wear the selected look for a card the box lights, and for a selected one, and not otherwise', async () => {
  const page = await open();
  const painted = (code) => classes(page.run(code)).includes('selected');
  page.run('boxLitIds = null; selectedIds.clear()');
  assert.strictEqual(painted('cardEl(state.active[0])'), false);
  assert.strictEqual(painted('archiveCardEl(state.archived[0])'), false);
  page.run("boxLitIds = new Set(['1', '9'])");
  assert.strictEqual(painted('cardEl(state.active[0])'), true, 'lit');
  assert.strictEqual(painted('cardEl(state.active[1])'), false, 'not lit');
  assert.strictEqual(painted('archiveCardEl(state.archived[0])'), true, 'an archived tile too');
  page.run("boxLitIds = null; selectedIds.add('2')");
  assert.strictEqual(painted('cardEl(state.active[1])'), true, 'selected');
  assert.strictEqual(painted('cardEl(state.active[0])'), false);
});

test('a Calendar chip wears it for a lit card', async () => {
  const page = await open();
  const chip = (id) => page.run(`calendarChipEl(state.active.find((c) => c.id === '${id}'), 'single', '', false)`);
  page.run("boxLitIds = new Set(['1'])");
  assert.ok(classes(chip(1)).includes('selected'));
  assert.ok(!classes(chip(2)).includes('selected'));
  page.run("boxLitIds = null");
  assert.ok(!classes(chip(1)).includes('selected'));
});

test('a Gantt bar wears it for a lit card', async () => {
  const page = await open();
  const bar = (id) => `ganttBarEl({ card: state.active.find((c) => c.id === '${id}'), startDay: '2026-05-05', endDay: '2026-05-07' }, { startDay: '2026-05-01', endDay: '2026-05-31' }, 20)`;
  page.run("boxLitIds = new Set(['1'])");
  assert.ok(classes(page.run(bar(1))).includes('selected'));
  assert.ok(!classes(page.run(bar(2))).includes('selected'));
});
