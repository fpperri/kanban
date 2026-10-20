const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control } = require('./helpers/page-vm');
const { fakeDom } = require('./helpers/fake-dom');

// The search panel's Statuses section in the real page (helpers/page-vm.js): the status pills of the
// current view (the Map, the Gantt, the Calendar, the Graph), drawn from the status-filter registry
// on every render, panel open or closed, and updated in place so a pill with focus keeps it. The
// elements are drawn on a small stand-in for the DOM; the browser runner looks at the page itself
// (scenarios/phone-flip-steps/statuses.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: '2026-10-01', end_date: '2026-10-05', due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], notifications: [],
  hierarchy: [], types: [],
  active: [card(1), card(2, { status: 'doing' }), card(3, { status: 'done' })],
  archived: [card(4, { archived: true, status: 'done' })],
});

const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
const withStyle = () => {
  const dom = fakeDom();
  return { createElement: (tag) => Object.assign(dom.createElement(tag), { style: {} }) };
};
const host = () => {
  const el = control();
  el.children = [];
  el.ownerDocument = withStyle();
  el.insertBefore = (node, ref) => {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    node.parent = el;
    el.children.splice(ref ? el.children.indexOf(ref) : el.children.length, 0, node);
  };
  return el;
};

async function open({ view = 'gantt', stored = {} } = {}) {
  const elements = {};
  for (const sel of ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#search-panel']) elements[sel] = hidden();
  elements['#search-statuses'] = host();
  elements['#search-statuses-section'] = control();
  elements['#search-statuses-fold'] = control();
  elements['#search-slices'] = host();
  elements['#search-slices-section'] = hidden();
  elements['#search-pills'] = host();
  elements['#search-chip'] = hidden();
  const storage = { 'kanban.kanban.view.mode': view, ...stored };
  const page = await loadPage({ board: makeBoard(), stored: storage, elements, documentExtras: { createElement: () => control() } }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const section = elements['#search-statuses-section'];
  const pills = elements['#search-statuses'];
  const s = {
    page, elements, stored: storage, pills, section,
    cols: () => pills.children.map((b) => b.dataset.col),
    pressed: () => pills.children.filter((b) => b.attrs['aria-pressed'] === 'true').map((b) => b.dataset.col),
    pill: (col) => pills.children.find((b) => b.dataset.col === col),
    tap: (col) => pills.fire('click', { target: s.pill(col), preventDefault() {} }),
    rightClick: (col) => {
      let prevented = 0;
      pills.fire('contextmenu', { target: s.pill(col), preventDefault() { prevented++; } });
      return prevented;
    },
    render: () => page.run('renderBoard()'),
    saved: (name) => JSON.parse(storage[`kanban.kanban.${name}.statusFilter`] || 'null'),
  };
  return s;
}

test('the builder makes a button.status-pill with its column, the keeps-selection marker, its state and a dot coloured through the style object', async () => {
  const s = await open();
  s.page.ctx.__doc = withStyle();
  const on = s.page.run("buildStatusPill(__doc, 'gantt', 'done', true)");
  const off = s.page.run("buildStatusPill(__doc, 'gantt', 'doing', false)");
  assert.strictEqual(on.tag, 'button');
  assert.strictEqual(on.type, 'button');
  assert.strictEqual(on.className.split(' ')[0], 'status-pill');
  assert.strictEqual(on.dataset.col, 'done');
  assert.strictEqual('keepsSelection' in on.dataset, true);
  assert.strictEqual('holdsPoll' in on.dataset, false, 'a button left focused by a click would stop the poll for good');
  assert.strictEqual(on.attrs['aria-pressed'], 'true');
  assert.ok(!on.classes().has('off'));
  assert.strictEqual(off.attrs['aria-pressed'], 'false');
  assert.ok(off.classes().has('off'));
  const dot = on.children.find((c) => c.className === 'pill-dot');
  assert.strictEqual(dot.style.color, s.page.run("statusColorVar('done')"));
  assert.ok(on.children.some((c) => c.textContent === s.page.run("columnLabel('done')")), 'the label follows the dot');
});

test("the title is the registry's own wording for the view plus the right-click-solo sentence", async () => {
  const s = await open();
  s.page.ctx.__doc = withStyle();
  for (const view of ['map', 'gantt', 'calendar', 'graph']) {
    for (const on of [true, false]) {
      const b = s.page.run(`buildStatusPill(__doc, '${view}', 'archive', ${on})`);
      const own = s.page.run(`statusFilterTitle('${view}', 'archive', columnLabel('archive'), ${on})`);
      assert.strictEqual(b.title, `${own} Right-click to solo (right-click the soloed pill again to restore all).`);
    }
  }
});

test('the section draws a pill per board status and Archive, in column order, with the view\'s state, panel closed', async () => {
  const s = await open({ view: 'gantt' });
  assert.deepStrictEqual(s.cols(), ['backlog', 'todo', 'doing', 'done', 'archive']);
  assert.deepStrictEqual(s.pressed(), ['backlog', 'todo', 'doing', 'done']);
  assert.strictEqual(s.section.classList.contains('hidden'), false);
});

test('the Map, the Calendar and the Graph each show their own state, Archive on for the Map', async () => {
  const map = await open({ view: 'map' });
  assert.deepStrictEqual(map.pressed(), ['backlog', 'todo', 'doing', 'done', 'archive']);
  const cal = await open({ view: 'calendar' });
  assert.deepStrictEqual(cal.pressed(), ['backlog', 'todo', 'doing', 'done']);
  const graph = await open({ view: 'graph' });
  assert.deepStrictEqual(graph.pressed(), ['backlog', 'todo', 'doing', 'done']);
  const own = await open({ view: 'gantt', stored: { 'kanban.kanban.gantt.statusFilter': JSON.stringify({ backlog: false, todo: true, doing: true, done: true, archive: true }) } });
  assert.deepStrictEqual(own.pressed(), ['todo', 'doing', 'done', 'archive']);
});

test("a tap switches that status in the view, as the view's own pill does", async () => {
  const s = await open({ view: 'gantt' });
  s.tap('done');
  assert.strictEqual(s.saved('gantt').done, false);
  assert.deepStrictEqual(s.pressed(), ['backlog', 'todo', 'doing']);
  s.tap('done');
  assert.deepStrictEqual(s.pressed(), ['backlog', 'todo', 'doing', 'done']);
});

test("a right-click solos the status and stops the browser's menu; again on the soloed one restores every status", async () => {
  const s = await open({ view: 'calendar' });
  assert.strictEqual(s.rightClick('doing'), 1);
  assert.deepStrictEqual(s.pressed(), ['doing']);
  s.rightClick('doing');
  assert.deepStrictEqual(s.pressed(), ['backlog', 'todo', 'doing', 'done', 'archive']);
});

test("a tap in the Graph and in the Map reaches that view's own filter", async () => {
  const graph = await open({ view: 'graph' });
  graph.tap('todo');
  assert.deepStrictEqual(graph.pressed(), ['backlog', 'doing', 'done']);
  const map = await open({ view: 'map' });
  map.tap('archive');
  assert.strictEqual(map.saved('map').archive, false);
});

test('with every status off in the Gantt the section still holds every pill, and a tap brings cards back', async () => {
  const s = await open({ view: 'gantt' });
  for (const col of ['backlog', 'todo', 'doing', 'done']) s.tap(col);
  assert.deepStrictEqual(s.pressed(), []);
  assert.strictEqual(s.page.run('[...shownCardIds()].length'), 0);
  assert.deepStrictEqual(s.cols(), ['backlog', 'todo', 'doing', 'done', 'archive']);
  assert.strictEqual(s.section.classList.contains('hidden'), false);
  s.tap('todo');
  assert.deepStrictEqual(s.pressed(), ['todo']);
});

test('a second render keeps the same button nodes, so a pill with focus keeps it through the refresh', async () => {
  const s = await open({ view: 'gantt' });
  const before = [...s.pills.children];
  s.render();
  s.tap('done');
  s.render();
  assert.strictEqual(s.pills.children.length, before.length);
  s.pills.children.forEach((b, i) => assert.strictEqual(b, before[i]));
  assert.strictEqual(s.pill('done').attrs['aria-pressed'], 'false');
  assert.ok(s.pill('done').classes().has('off'));
});

test('the section follows the view: hidden on the Board, shown again in a view, redrawn for it', async () => {
  const s = await open({ view: 'board' });
  assert.strictEqual(s.section.classList.contains('hidden'), true);
  s.page.run("viewMode = 'map'; renderBoard()");
  assert.strictEqual(s.section.classList.contains('hidden'), false);
  assert.deepStrictEqual(s.pressed(), ['backlog', 'todo', 'doing', 'done', 'archive']);
  s.page.run("viewMode = 'gantt'; renderBoard()");
  assert.deepStrictEqual(s.pressed(), ['backlog', 'todo', 'doing', 'done']);
  s.page.run("viewMode = 'board'; renderBoard()");
  assert.strictEqual(s.section.classList.contains('hidden'), true);
});

test('a tap and a right-click leave a selection as it was', async () => {
  const s = await open({ view: 'gantt' });
  s.page.run('setSelection({ anchor: cardPart(3), additions: [] }, 3)');
  const before = JSON.stringify(s.page.run('selectionState.selection'));
  assert.match(before, /3/);
  s.tap('backlog');
  s.rightClick('doing');
  s.tap('doing');
  assert.strictEqual(JSON.stringify(s.page.run('selectionState.selection')), before);
});

test('the fold control folds and unfolds the pill host for the visit, open to start', async () => {
  const s = await open();
  assert.strictEqual(s.pills.classList.contains('hidden'), false);
  s.elements['#search-statuses-fold'].fire('click', {});
  assert.strictEqual(s.pills.classList.contains('hidden'), true);
  s.elements['#search-statuses-fold'].fire('click', {});
  assert.strictEqual(s.pills.classList.contains('hidden'), false);
});

// --- the source ------------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');
const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('a status pill keeps the selection and lets the poll run', () => {
  const { assertKeepsSelection, assertLetsPollRun } = require('./helpers/markers');
  assertKeepsSelection(['.status-pill'], 'a status pill in the search panel');
  assertLetsPollRun(['.status-pill'], 'a status pill in the search panel');
});

test('the renderer is a page script after status-filters.js, ahead of app.js, and the server serves it', () => {
  const html = read('app.html');
  const tag = (s) => html.indexOf(`<script src="/${s}"></script>`);
  assert.ok(tag('status-filters.js') > -1 && tag('search-statuses.js') > tag('status-filters.js'));
  assert.ok(tag('search-statuses.js') < tag('app.js'));
  const { pageFiles } = require('../scripts/server');
  assert.ok(pageFiles(html).includes('search-statuses.js'));
});

test('the panel repaints the section on every render, panel open or closed', () => {
  const body = read('search-panel.js').match(/function renderSearchPanel\([\s\S]*?\n\}/)[0];
  assert.match(body, /renderSearchStatuses\(\);/);
  assert.ok(body.indexOf('renderSearchStatuses()') < body.indexOf('searchPanelOpen &&'), 'not behind the open check');
});

test('the section is drawn in place by status, through the registry, with one click and one contextmenu listener on the host', () => {
  const code = stripComments(read('search-statuses.js'));
  assert.match(code, /syncKeyedChildren\(host, 'col'/);
  assert.match(code, /STATUS_FILTERS\[loadViewMode\(\)\]/);
  assert.strictEqual(code.split("addEventListener('click', onStatusPillClick)").length - 1, 1);
  assert.strictEqual(code.split("addEventListener('contextmenu', onStatusPillContextMenu)").length - 1, 1);
  assert.match(code.match(/function onStatusPillContextMenu\([\s\S]*?\n\}/)[0], /e\.preventDefault\(\)/);
  assert.doesNotMatch(code, /map-filter-toggle|gantt-filter-toggle|calendar-filter-toggle|graph-filter-toggle|map-section-toggle/, 'it never names the per-view pill classes');
  assert.doesNotMatch(code, /setSelection|selectionState|selectedIds/, 'it never touches the selection');
  assert.doesNotMatch(code, /setAttribute\('style'|style=|innerHTML|onclick/);
});
