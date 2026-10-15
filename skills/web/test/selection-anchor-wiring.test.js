const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// The selection in the real page (helpers/page-vm.js runs every script the page
// loads in one vm): the parts are kept, the id set the views paint is worked out
// from them in the view being shown, and each gesture writes them through the
// shared click handler or the Graph's own.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing', tags: ['infra'] }),
    card(2, { title: 'Move the data layer', status: 'todo', tags: ['ui'], waiting_for: [1] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema', status: 'todo', blocked: 'vendor has not shipped' }),
    card(5, { title: 'Draft the release notes', status: 'doing', review: 'copy needs eyes', tags: ['ui'] }),
    card(6, { title: 'Renew the domain', status: 'done', tags: ['ops'] }),
  ],
  archived: [
    card(7, { title: 'Spike zephyr pooling', status: 'done', archived: true, waiting_for: [1] }),
    card(8, { title: 'Close out the audit', status: 'done', archived: true, tags: ['ui'] }),
  ],
});

async function open({ view = 'board', stored = {}, board = makeBoard() } = {}) {
  const graphHost = control();
  const page = await loadPage({
    board,
    stored: { 'kanban.kanban.view.mode': view, ...stored },
    elements: { '#graph-view': graphHost },
  }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const ids = () => [...page.run('selectedIds')].sort((a, b) => a - b);
  const selection = () => JSON.parse(JSON.stringify(page.run('selectionState.selection')));
  const rangeStart = () => page.run('selectionState.rangeStart');
  const select = (...parts) => page.run(`setSelection(${parts.reduce((s, p) => `addPart(${s}, ${p})`, 'NO_SELECTION')}, null)`);
  return { page, board, graphHost, ids, selection, rangeStart, select };
}

const a = (id) => ({ kind: 'card', id });
const parts = (sel) => [sel.anchor, ...sel.additions];

// --- the id set is the parts, resolved in the view being shown ----------------------

test('the id set is what the parts stand for: a card part is that card, a query part is the cards the search module matches', async () => {
  const s = await open();
  s.select('cardPart(1)', "queryPart('tags:ui')");
  assert.deepStrictEqual(s.ids(), [1, 2, 5], 'card 8 also has tags:ui, but it is archived and the Archive column is collapsed');
});

test('a part with no cards behind it leaves the id set empty without an error', async () => {
  const s = await open();
  s.select('cardPart(99)', "queryPart('tags:nothing-has-this')", "queryPart('status:')", "queryPart('  ')", 'pathPart(99)');
  assert.deepStrictEqual(s.ids(), []);
});

test('the Board shows the cards in its expanded columns: the Archive column when open, and not a collapsed one', async () => {
  const open1 = await open({ stored: { 'kanban.kanban.columns.collapsed': JSON.stringify({ archive: false }) } });
  open1.select("queryPart('tags:ui')");
  assert.deepStrictEqual(open1.ids(), [2, 5, 8]);
  const closed = await open({ stored: { 'kanban.kanban.columns.collapsed': JSON.stringify({ archive: false, doing: true }) } });
  closed.select("queryPart('tags:ui')");
  assert.deepStrictEqual(closed.ids(), [2, 8], 'card 5 is in the collapsed Doing column');
});

test('a view switch keeps the parts and the id set follows the view: the Map shows archived cards, the Board with its Archive column closed does not', async () => {
  const s = await open();
  s.select('cardPart(1)', "queryPart('tags:ui')");
  assert.deepStrictEqual(s.ids(), [1, 2, 5]);
  s.page.run("toggleView('map')");
  assert.deepStrictEqual(s.ids(), [1, 2, 5, 8]);
  s.page.run("toggleView('map')");
  assert.deepStrictEqual(s.ids(), [1, 2, 5]);
  assert.deepStrictEqual(parts(s.selection()), [a(1), { kind: 'query', text: 'tags:ui' }], 'the parts were never touched');
});

test('a view switch keeps the same cards picked in the Graph on the Board', async () => {
  const s = await open({ view: 'graph' });
  s.select('cardPart(2)', 'cardPart(5)');
  s.page.run("toggleView('graph')");
  assert.strictEqual(s.page.run('loadViewMode()'), 'board');
  assert.deepStrictEqual(s.ids(), [2, 5]);
});

// --- a status pill, the Archive pill or the search box takes a card out of the id set

const FILTERS = {
  map: { toggle: (col) => `toggleMapStatusFilter('${col}')`, archiveOnByDefault: true },
  gantt: { toggle: (col) => `toggleGanttStatusFilter('${col}')`, archiveOnByDefault: false },
  calendar: { toggle: (col) => `toggleCalendarStatusFilter('${col}')`, archiveOnByDefault: false },
  graph: { toggle: (col) => `graphToggleFilter('${col}')`, archiveOnByDefault: false },
};

for (const [view, f] of Object.entries(FILTERS)) {
  test(`${view}: a status pill that hides a card takes it out of the id set, and turning the pill back on brings it back`, async () => {
    const s = await open({ view });
    s.select('cardPart(1)', 'cardPart(2)', 'cardPart(5)');
    assert.deepStrictEqual(s.ids(), [1, 2, 5]);
    s.page.run(f.toggle('doing'));
    assert.deepStrictEqual(s.ids(), [2], 'cards 1 and 5 are Doing');
    s.page.run(f.toggle('doing'));
    assert.deepStrictEqual(s.ids(), [1, 2, 5]);
  });

  test(`${view}: the Archive pill decides whether an archived card can be in the id set`, async () => {
    const s = await open({ view });
    s.select('cardPart(1)', 'cardPart(8)');
    assert.deepStrictEqual(s.ids(), f.archiveOnByDefault ? [1, 8] : [1]);
    s.page.run(f.toggle('archive'));
    assert.deepStrictEqual(s.ids(), f.archiveOnByDefault ? [1] : [1, 8]);
  });
}

// The Graph is not among them: a search typed there hides nothing and is the anchor
// of the selection, which graph-lights-wiring.test.js pins.
for (const view of ['board', 'map', 'calendar', 'gantt']) {
  test(`${view}: a search that hides a card takes it out of the id set, and clearing the box brings it back`, async () => {
    const s = await open({ view });
    s.select('cardPart(1)', "queryPart('tags:ui')");
    assert.deepStrictEqual(s.ids().slice(0, 3), [1, 2, 5]);
    s.page.input.typed('status:todo');
    assert.deepStrictEqual(s.ids(), [2], 'the box leaves cards 2 and 4; the selection reaches 1, 2, 5 (and 8 where archived cards show)');
    s.page.input.typed('');
    assert.deepStrictEqual(s.ids().slice(0, 3), [1, 2, 5]);
  });
}

// --- a part and its search term cannot disagree -------------------------------------

test('the matcher a query, path or tree part resolves through is the one the search box matches with', async () => {
  const s = await open();
  for (const text of ['tags:ui', 'zephyr', 'status:doing', 'blocked:', 'review:', 'tree:1', 'path:2', '#3', 'foo:bar']) {
    s.page.input.typed(text);
    const fromBox = [...s.page.run('currentSearchMatch().ids')].sort((x, y) => x - y);
    const fromPart = [...s.page.run(`searchMatchIds(${JSON.stringify(text)})`)].sort((x, y) => x - y);
    assert.deepStrictEqual(fromPart, fromBox, text);
  }
});

test('text that is not a term yet matches nothing as a part, where the box shows everything for it', async () => {
  const s = await open();
  s.page.input.typed('status:');
  assert.strictEqual(s.page.run('currentSearchMatch().ids'), null, 'the box: not a term yet, no query');
  assert.strictEqual(s.page.run("searchMatchIds('status:')").size, 0);
  assert.strictEqual(s.page.run("searchMatchIds('')").size, 0);
});

// --- the poll -----------------------------------------------------------------------

test('a poll that finds a picked card gone drops its part, and the next card becomes the anchor', async () => {
  const s = await open();
  s.select('cardPart(2)', 'cardPart(5)', "queryPart('tags:ui')");
  s.board.active = s.board.active.filter((c) => c.id !== 2);
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(parts(s.selection()), [a(5), { kind: 'query', text: 'tags:ui' }]);
  assert.deepStrictEqual(s.ids(), [5]);
});

test('a poll keeps the selection and works the id set out again', async () => {
  const s = await open();
  s.select('cardPart(1)', "queryPart('tags:ui')");
  s.board.active.push(card(9, { title: 'New', tags: ['ui'] }));
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(s.ids(), [1, 2, 5, 9], 'a card that comes to match the query joins on the poll');
});

// --- gestures through the shared click handler --------------------------------------

function cardTarget(id) {
  const el = { dataset: { id: String(id) } };
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.card-el' ? el : null) : harmless(String(key))) });
}
const mods = (m = {}) => ({ shiftKey: false, ctrlKey: false, metaKey: false, ...m });

test('Board: Ctrl click picks the first card as the anchor and later cards as additions, and Ctrl click again takes one out', async () => {
  const s = await open();
  s.page.fireDocument('click', { target: cardTarget(2), ...mods({ ctrlKey: true }) });
  s.page.fireDocument('click', { target: cardTarget(5), ...mods({ metaKey: true }) });
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(5)] });
  assert.strictEqual(s.rangeStart(), 5);
  assert.deepStrictEqual(s.ids(), [2, 5]);
  s.page.fireDocument('click', { target: cardTarget(2), ...mods({ ctrlKey: true }) });
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [] }, 'the anchor card went out, so the first addition is the anchor');
});

test('Board: Shift click adds the range from the range start as additions, in the order the view shows', async () => {
  const s = await open();
  s.page.ctx.visibleCardIds = () => [6, 5, 4, 3, 2, 1];
  s.page.fireDocument('click', { target: cardTarget(4), ...mods({ ctrlKey: true }) });
  s.page.fireDocument('click', { target: cardTarget(2), ...mods({ shiftKey: true }) });
  assert.deepStrictEqual(s.selection(), { anchor: a(4), additions: [a(3), a(2)] });
  assert.strictEqual(s.rangeStart(), 4);
});

test('a click on a card while the Graph is showing never ranges, even through the shared grammar: Shift adds one card', async () => {
  const s = await open({ view: 'graph' });
  s.page.ctx.visibleCardIds = () => { throw new Error('the Graph has no reading order to range over'); };
  s.page.fireDocument('click', { target: cardTarget(1), ...mods({ ctrlKey: true }) });
  s.page.fireDocument('click', { target: cardTarget(5), ...mods({ shiftKey: true }) });
  assert.deepStrictEqual(s.ids(), [1, 5]);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(5)] });
});

test('Board: a plain click opens the card and empties the selection', async () => {
  const s = await open();
  s.select('cardPart(1)', 'cardPart(2)');
  const opened = [];
  s.page.ctx.openCard = (id) => { opened.push(id); };
  s.page.fireDocument('click', { target: cardTarget(4), ...mods() });
  assert.deepStrictEqual(opened, [4]);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.rangeStart(), null);
});

test('a right-click on a card, outside the selection or inside it, leaves the selection and its range start as they were', async () => {
  const s = await open();
  s.select('cardPart(1)', 'cardPart(2)');
  s.page.run('setSelection(selectionState.selection, 2)');
  const event = (id) => ({ target: cardTarget(id), clientX: 0, clientY: 0 });
  s.page.fireDocument('contextmenu', event(2));
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] });
  s.page.fireDocument('contextmenu', event(4));
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] });
  assert.strictEqual(s.rangeStart(), 2);
});

test('a click on empty space clears the selection and its range start', async () => {
  const s = await open();
  s.select('cardPart(1)', 'cardPart(2)');
  const empty = new Proxy({}, { get: (t, key) => (key === 'closest' ? () => null : harmless(String(key))) });
  s.page.fireDocument('click', { target: empty, ...mods() });
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('bulk edits read the cards of the id set: cards added by a query are targets as the cards picked by hand are', async () => {
  const s = await open();
  s.select('cardPart(1)', "queryPart('tags:ui')");
  assert.deepStrictEqual([...s.page.run('bulkTargets().map((c) => c.id)')], [1, 2, 5]);
});

// --- gestures through the Graph's own listener --------------------------------------

function nodeEvent(id, m = {}) {
  const node = { dataset: { id: String(id) } };
  const log = { stopped: 0, prevented: 0 };
  const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.graph-node' ? node : null) : harmless(String(key))) });
  return { target, log, stopPropagation() { log.stopped++; }, preventDefault() { log.prevented++; }, key: m.key, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...m };
}

async function inGraph() {
  const s = await open({ view: 'graph' });
  assert.ok(s.page.run('graphCur'), 'the Graph drew, so its listeners have something to act on');
  let renders = 0;
  const real = s.page.ctx.renderBoard;
  s.page.ctx.renderBoard = (...args) => { renders++; return real(...args); };
  const click = (id, m) => { const e = nodeEvent(id, m); s.graphHost.fire('click', e); return e; };
  return { ...s, click, renders: () => renders };
}

test('Graph: a click makes the card a new anchor, a click on another card starts a new selection with that card alone', async () => {
  const g = await inGraph();
  g.click(2);
  assert.deepStrictEqual(g.selection(), { anchor: a(2), additions: [] });
  g.click(5, { shiftKey: true });
  assert.deepStrictEqual(g.selection(), { anchor: a(2), additions: [a(5)] });
  g.click(4);
  assert.deepStrictEqual(g.selection(), { anchor: a(4), additions: [] });
  assert.deepStrictEqual(g.ids(), [4]);
});

test('Graph: Shift click on a second card adds exactly that card, and Shift click on it again takes it out', async () => {
  const g = await inGraph();
  g.page.ctx.visibleCardIds = () => { throw new Error('the Graph has no reading order to range over'); };
  g.click(1);
  g.click(5, { shiftKey: true });
  assert.deepStrictEqual(g.ids(), [1, 5], 'not 2, 3 and 4 between them');
  g.click(5, { shiftKey: true });
  assert.deepStrictEqual(g.ids(), [1]);
  assert.deepStrictEqual(g.selection(), { anchor: a(1), additions: [] });
});

test('Graph: Ctrl click and Cmd click do the same as Shift click', async () => {
  for (const key of ['ctrlKey', 'metaKey']) {
    const g = await inGraph();
    g.click(1);
    g.click(5, { [key]: true });
    assert.deepStrictEqual(g.ids(), [1, 5], key);
    g.click(5, { [key]: true });
    assert.deepStrictEqual(g.ids(), [1], `${key} again`);
  }
});

test('Graph: every click on a node stops there, so the shared grammar never sees it, and nothing rebuilds the board', async () => {
  const g = await inGraph();
  for (const m of [{}, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    const e = g.click(3, m);
    assert.strictEqual(e.log.stopped, 1, JSON.stringify(m));
  }
  assert.strictEqual(g.renders(), 0, 'the selection is painted in place');
});

test('Graph: a click that is not on a node is left alone', async () => {
  const g = await inGraph();
  g.select('cardPart(1)');
  const e = nodeEvent(1);
  e.target = new Proxy({}, { get: (t, key) => (key === 'closest' ? () => null : harmless(String(key))) });
  g.graphHost.fire('click', e);
  assert.strictEqual(e.log.stopped, 0);
  assert.deepStrictEqual(g.ids(), [1]);
});

test('Graph: Space on a focused card acts as a plain click, and Enter opens the card without touching the selection', async () => {
  const g = await inGraph();
  g.click(1);
  g.click(5, { shiftKey: true });
  g.graphHost.fire('keydown', nodeEvent(4, { key: ' ' }));
  assert.deepStrictEqual(g.selection(), { anchor: a(4), additions: [] });
  const opened = [];
  g.page.ctx.openCard = (id) => { opened.push(id); };
  g.graphHost.fire('keydown', nodeEvent(2, { key: 'Enter' }));
  assert.deepStrictEqual(opened, [2]);
  assert.deepStrictEqual(g.selection(), { anchor: a(4), additions: [] });
});

test('Graph: a double click opens the card', async () => {
  const g = await inGraph();
  const opened = [];
  g.page.ctx.openCard = (id) => { opened.push(id); };
  g.graphHost.fire('dblclick', nodeEvent(3));
  assert.deepStrictEqual(opened, [3]);
});
