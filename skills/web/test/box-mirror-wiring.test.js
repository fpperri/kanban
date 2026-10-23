const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// A click that selects writes the selection into the search box in the real page
// (helpers/page-vm.js runs every script the page loads in one vm): the Board's Ctrl and Shift
// clicks, the Graph's clicks, the card menu's Add to selection, the step down the selection and a
// view switch. The write is the selection's own text, so it turns isolate on for no one and
// never makes the box a typed search. The text itself is pinned in search-mirror.test.js.

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
  archived: [],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };

async function open({ view = 'board', typing = false, prefs = {} } = {}) {
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  elements['#search-pills'] = control();
  elements['#graph-view'] = control();
  const stored = { 'kanban.kanban.view.mode': view, 'kanban.kanban.prefs': JSON.stringify({ typingIsolates: { board: typing, graph: typing }, ...prefs }) };
  const page = await loadPage({ board: makeBoard(), stored, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const cardTarget = (id) => {
    const el = { dataset: { id: String(id) } };
    return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.card-el' ? el : null) : harmless(String(key))) });
  };
  const nodeEvent = (id, m = {}) => {
    const node = { dataset: { id: String(id) } };
    const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.graph-node' ? node : null) : harmless(String(key))) });
    return { target, stopPropagation() {}, preventDefault() {}, key: m.key, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...m };
  };
  const mods = { detail: 1, shiftKey: false, ctrlKey: false, metaKey: false };
  const s = {
    page,
    box: () => page.input.value,
    type: (text) => page.input.typed(text),
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    isolate: () => JSON.parse(JSON.stringify(page.run('isolateNow()'))),
    ids: () => [...page.run('selectedIds')].map(Number).sort((a, b) => a - b),
    click: (id, m = {}) => page.fireDocument('click', { target: cardTarget(id), ...mods, ...m }),
    ctrlClick: (id) => page.fireDocument('click', { target: cardTarget(id), ...mods, ctrlKey: true }),
    shiftClick: (id) => page.fireDocument('click', { target: cardTarget(id), ...mods, shiftKey: true }),
    nodeClick: (id, m = {}) => elements['#graph-view'].fire('click', nodeEvent(id, m)),
    pillClick: (key) => {
      const button = { dataset: { pillKey: key }, closest: (sel) => (sel === '.query-pill' ? button : null) };
      elements['#search-pills'].fire('click', { target: button, shiftKey: false, preventDefault() {} });
    },
    addToSelection: (id) => { page.run(`menuSubject = { ids: ['${id}'] }`); page.run('addCardToSelection()'); },
    flip: () => page.run('isolateFlip()'),
    view: (mode) => page.run(`setView('${mode}')`),
    press: () => {
      page.ctx.document.activeElement = null;
      const e = { key: 'Escape', target: null, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() {} };
      (page.documentListeners.keydown || []).slice().forEach((fn) => fn(e));
    },
    told: [],
  };
  page.ctx.onSearchWrite((text, reason) => s.told.push([text, reason]));
  page.ctx.openCard = () => {};
  return s;
}

const a = (id) => ({ kind: 'card', id: String(id) });
const q = (text) => ({ kind: 'query', text });
const typed = (text) => ({ kind: 'query', text, source: 'typing' });

test('a Ctrl-click on the Board shows the card in the box, the next adds it as an alternative, and isolate stays off', async () => {
  const s = await open();
  s.ctrlClick(2);
  assert.strictEqual(s.box(), '#2');
  s.ctrlClick(5);
  assert.strictEqual(s.box(), '#2 | #5');
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(5)] }, 'the parts are what the clicks made them, not a typed query');
  assert.deepStrictEqual(s.told, [['#2', 'mirror'], ['#2 | #5', 'mirror']]);
});

test('a write of the click turns isolate on for no one, in a view where typing isolates', async () => {
  const s = await open({ typing: true });
  s.ctrlClick(2);
  s.ctrlClick(5);
  assert.strictEqual(s.box(), '#2 | #5');
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.page.run('shownCardIds().size'), 6, 'and the Board still shows every card');
});

test('a Ctrl-click on a picked card takes it out and the box shows what is left; an empty selection empties the box but its cut', async () => {
  const s = await open();
  s.type('slice:0..1');
  s.ctrlClick(2);
  s.ctrlClick(5);
  assert.strictEqual(s.box(), '(#2 | #5) slice:0..1');
  s.ctrlClick(2);
  assert.strictEqual(s.box(), '#5 slice:0..1');
  s.ctrlClick(5);
  assert.strictEqual(s.box(), 'slice:0..1');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('the next click still sees card parts: the box the click wrote is not read back as a typed search', async () => {
  const s = await open();
  s.ctrlClick(2);
  s.ctrlClick(5);
  s.page.run('renderBoard()');
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(5)] });
  s.ctrlClick(4);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(5), a(4)] });
  assert.strictEqual(s.box(), '#2 | #5 | #4');
});

test('a pill stays a query part: a lone one is written as it was typed, and a card beside it is an alternative', async () => {
  const s = await open();
  s.pillClick('review');
  assert.strictEqual(s.box(), 'review:');
  s.ctrlClick(3);
  assert.strictEqual(s.box(), 'review: | #3');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [a(3)] });
  s.ctrlClick(3);
  assert.strictEqual(s.box(), 'review:', 'taking the card out leaves the lone query as typed');
});

test('a plain click that opens a card writes nothing to the box', async () => {
  const s = await open();
  s.ctrlClick(2);
  s.told.length = 0;
  s.click(4);
  assert.strictEqual(s.box(), '#2');
  assert.deepStrictEqual(s.told, []);
});

test('a plain click in a view that selects shows that card alone in the box', async () => {
  const s = await open({ prefs: { click: { board: 'selects' } } });
  s.click(3);
  assert.strictEqual(s.box(), '#3');
  s.click(4);
  assert.strictEqual(s.box(), '#4');
  assert.deepStrictEqual(s.selection(), { anchor: a(4), additions: [] });
});

test('while isolate is on a click keeps today\'s rule: it moves the anchor and the box keeps the isolate text', async () => {
  const s = await open();
  s.ctrlClick(2);
  s.ctrlClick(5);
  s.flip();
  assert.notStrictEqual(s.isolate(), null);
  s.told.length = 0;
  s.ctrlClick(4);
  s.nodeClick(1);
  assert.strictEqual(s.box(), '#2 | #5');
  assert.deepStrictEqual(s.told, []);
});

test('the card menu\'s Add to selection shows the card in the box, the first as the anchor', async () => {
  const s = await open();
  s.addToSelection(3);
  assert.strictEqual(s.box(), '#3');
  assert.deepStrictEqual(s.selection(), { anchor: a(3), additions: [] });
  s.addToSelection(4);
  assert.strictEqual(s.box(), '#3 | #4');
  assert.strictEqual(s.isolate(), null);
});

test('in the Graph a plain click shows the card, Shift adds it, Ctrl on a picked card takes it out', async () => {
  const s = await open({ view: 'graph' });
  s.nodeClick(2);
  assert.strictEqual(s.box(), '#2');
  s.nodeClick(5, { shiftKey: true });
  assert.strictEqual(s.box(), '#2 | #5');
  s.nodeClick(2, { ctrlKey: true });
  assert.strictEqual(s.box(), '#5');
  s.nodeClick(4);
  assert.strictEqual(s.box(), '#4');
  assert.deepStrictEqual(s.selection(), { anchor: a(4), additions: [] });
  assert.strictEqual(s.isolate(), null);
});

test('a search typed in the Graph stays its typed anchor beside the cards a click adds, and a plain click replaces it', async () => {
  const s = await open({ view: 'graph' });
  s.type('move the');
  s.nodeClick(5, { shiftKey: true });
  assert.strictEqual(s.box(), '(move the) | #5');
  assert.deepStrictEqual(s.selection(), { anchor: typed('move the'), additions: [a(5)] });
  s.nodeClick(4);
  assert.strictEqual(s.box(), '#4');
  assert.deepStrictEqual(s.selection(), { anchor: a(4), additions: [] });
});

test('a view switch shows what is picked: leaving the Graph with a card picked beside the typed search writes the card alone', async () => {
  const s = await open({ view: 'graph' });
  s.type('move the');
  s.nodeClick(5, { shiftKey: true });
  s.view('board');
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [] }, 'the typed anchor stays behind in the Graph');
  assert.strictEqual(s.box(), '#5');
  assert.strictEqual(s.isolate(), null);
});

test('a view switch leaves a typed search with nothing picked in the box, as it filtered the other views before', async () => {
  const s = await open({ view: 'graph' });
  s.type('move the');
  s.told.length = 0;
  s.view('board');
  assert.strictEqual(s.box(), 'move the');
  assert.deepStrictEqual(s.told, []);
});

test('a view switch with a selection that did not change writes nothing', async () => {
  const s = await open();
  s.ctrlClick(2);
  s.told.length = 0;
  s.view('map');
  s.view('graph');
  s.view('board');
  assert.strictEqual(s.box(), '#2');
  assert.deepStrictEqual(s.told, []);
});

test('Esc steps the box down with the selection it mirrors: the additions, then the anchor, then the last Esc has nothing to clear', async () => {
  const s = await open();
  s.ctrlClick(2);
  s.ctrlClick(5);
  s.press();
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
  assert.strictEqual(s.box(), '#2');
  s.press();
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), '');
});

test('Esc leaves a box that is not the selection\'s text as it was, as it did before', async () => {
  const s = await open();
  s.ctrlClick(2);
  s.ctrlClick(5);
  s.type('zephyr');
  s.press();
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
  assert.strictEqual(s.box(), 'zephyr');
});

test('the Graph does not take the box the click wrote for a typed search, on a repaint or on entering it from the Board', async () => {
  const s = await open({ view: 'graph' });
  s.type('move the');
  s.nodeClick(5, { shiftKey: true });
  s.page.run('renderBoard()');
  assert.deepStrictEqual(s.selection(), { anchor: typed('move the'), additions: [a(5)] });
  const b = await open();
  b.ctrlClick(2);
  b.ctrlClick(5);
  b.view('graph');
  b.page.run('renderBoard()');
  assert.deepStrictEqual(b.selection(), { anchor: a(2), additions: [a(5)] });
  assert.strictEqual(b.box(), '#2 | #5');
});

test('a click moves no Calendar or Gantt: the nearest-match jump listens to every write but the click\'s', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(src, /onSearchWrite\(\(text, reason\) => \{ if \(reason !== 'mirror'\) moveViewToNearestMatch\(\); \}\);/);
});
