const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { STATUS_FILTERS, statusFilterTitle } = require('../web/status-filters');
const { loadPage } = require('./helpers/page-vm');

// The status-filter registry: one entry per view that has status pills (the Map, the Gantt, the
// Calendar, the Graph; the Board has none). It holds each view's load, toggle and solo, its pill
// titles and its Archive default. The titles are pinned here as literal strings.

test('the registry has the Map, the Gantt, the Calendar and the Graph, and no entry for the Board', () => {
  assert.deepStrictEqual(Object.keys(STATUS_FILTERS).sort(), ['calendar', 'gantt', 'graph', 'map']);
  assert.strictEqual(STATUS_FILTERS.board, undefined);
});

test('Map pill titles: a status and Archive both carry the ghost-card sentence', () => {
  assert.strictEqual(statusFilterTitle('map', 'todo', 'Todo', true),
    'Hide Todo cards on the map (hidden cards ghost when a visible card references them)');
  assert.strictEqual(statusFilterTitle('map', 'todo', 'Todo', false),
    'Show Todo cards on the map (hidden cards ghost when a visible card references them)');
  assert.strictEqual(statusFilterTitle('map', 'archive', 'Archive', true),
    'Hide Archive cards on the map (hidden cards ghost when a visible card references them)');
  assert.strictEqual(statusFilterTitle('map', 'archive', 'Archive', false),
    'Show Archive cards on the map (hidden cards ghost when a visible card references them)');
});

test('Gantt pill titles', () => {
  assert.strictEqual(statusFilterTitle('gantt', 'doing', 'Doing', true),
    "Hide Doing cards on the timeline (the visible window re-derives from what's left)");
  assert.strictEqual(statusFilterTitle('gantt', 'doing', 'Doing', false),
    "Show Doing cards on the timeline (the visible window re-derives from what's left)");
  assert.strictEqual(statusFilterTitle('gantt', 'archive', 'Archive', true),
    'Hide archived cards on the timeline (dated archived cards render in their own Archive group, muted grey)');
  assert.strictEqual(statusFilterTitle('gantt', 'archive', 'Archive', false),
    'Show archived cards on the timeline (dated archived cards render in their own Archive group, muted grey)');
});

test('Calendar pill titles', () => {
  assert.strictEqual(statusFilterTitle('calendar', 'doing', 'Doing', true), 'Hide Doing cards on the calendar');
  assert.strictEqual(statusFilterTitle('calendar', 'doing', 'Doing', false), 'Show Doing cards on the calendar');
  assert.strictEqual(statusFilterTitle('calendar', 'archive', 'Archive', true),
    'Hide archived cards on the calendar (dated archived cards render read-only, with the archived ball)');
  assert.strictEqual(statusFilterTitle('calendar', 'archive', 'Archive', false),
    'Show archived cards on the calendar (dated archived cards render read-only, with the archived ball)');
});

test('Graph pill titles', () => {
  assert.strictEqual(statusFilterTitle('graph', 'doing', 'Doing', true), 'Hide Doing cards on the graph');
  assert.strictEqual(statusFilterTitle('graph', 'doing', 'Doing', false), 'Show Doing cards on the graph');
  assert.strictEqual(statusFilterTitle('graph', 'archive', 'Archive', true), 'Hide archived cards on the graph');
  assert.strictEqual(statusFilterTitle('graph', 'archive', 'Archive', false), 'Show archived cards on the graph');
});

test('Archive defaults on for the Map, off for the Gantt, the Calendar and the Graph', () => {
  assert.strictEqual(STATUS_FILTERS.map.archiveDefault, true);
  assert.strictEqual(STATUS_FILTERS.gantt.archiveDefault, false);
  assert.strictEqual(STATUS_FILTERS.calendar.archiveDefault, false);
  assert.strictEqual(STATUS_FILTERS.graph.archiveDefault, false);
});

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});
const board = () => ({
  projectName: 'kanban', statuses: ['backlog', 'todo', 'doing', 'done'], priorities: ['High', 'Normal', 'Low'],
  hierarchy: [], assignees: [], tags: [], types: [], notifications: [], active: [card(1), card(2)], archived: [],
});

for (const [view, load] of [
  ['map', 'loadMapStatusFilter'],
  ['gantt', 'loadGanttStatusFilter'],
  ['calendar', 'loadCalendarStatusFilter'],
  ['graph', 'graphLoadFilter'],
]) {
  test(`${view}: the entry's load, toggle and solo reach the page's own functions and its ${view}.statusFilter key`, async () => {
    const key = `kanban.kanban.${view}.statusFilter`;
    const stored = {};
    const page = await loadPage({ board: board(), stored }).start();
    assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
    assert.strictEqual(page.run(`STATUS_FILTERS.${view}.load() === ${load}()`), true, 'load returns the page filter');
    assert.strictEqual(page.run(`STATUS_FILTERS.${view}.load().todo`), true);
    assert.strictEqual(page.run(`STATUS_FILTERS.${view}.load().archive`), view === 'map');
    page.run(`STATUS_FILTERS.${view}.toggle('todo')`);
    assert.strictEqual(JSON.parse(stored[key]).todo, false, 'toggle writes the existing key');
    page.run(`STATUS_FILTERS.${view}.solo('doing')`);
    const after = JSON.parse(stored[key]);
    assert.strictEqual(after.doing, true);
    assert.strictEqual(after.todo, false);
  });
}

test('status-filters.js loads from one script tag right after search-panel.js', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.html'), 'utf8');
  const tags = [...html.matchAll(/<script src="\/([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(tags.filter((t) => t === 'status-filters.js').length, 1);
  assert.strictEqual(tags[tags.indexOf('search-panel.js') + 1], 'status-filters.js');
});

test('the four pill rows take their titles from the registry', () => {
  const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8');
  const app = web('app.js');
  for (const [fnName, view] of [['buildMapFilterRow', 'map'], ['buildGanttFilterRow', 'gantt'], ['buildCalendarFilterRow', 'calendar']]) {
    const m = app.match(new RegExp(`function ${fnName}\\([\\s\\S]*?\\n\\}`));
    assert.ok(m, fnName);
    assert.ok(m[0].includes(`statusFilterTitle('${view}'`), `${fnName} asks the registry`);
  }
  assert.ok(web('graph-view.js').includes("statusFilterTitle('graph'"));
});
