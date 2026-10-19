const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// A click on empty space can be an accident, so a single click there leaves the
// selection, its anchor, the pills and the search box as they were. A double
// click clears the selection and its anchor: the additions go, the anchor goes,
// a pill's query or a search typed in the Graph leaves the box, and the chip
// goes off. A double click that already means something on that space (the
// Calendar's day cells and time-grid columns create a card) keeps that meaning
// and leaves the selection. Esc stays the step-by-step way back (the selection
// tests hold that order).
//
// The real page runs in a vm (helpers/page-vm.js). The page cannot wait for a
// double click event after its first click's repaint, so a double click is two
// click events, the second carrying a count (detail) of 2, as in the browser.

// Every card has a date, so the Gantt and the Calendar draw it: a card with no range and no due
// date is shown by neither, and so is out of what a selection can reach there.
const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: '2031-06-02', end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing' }),
    card(2, { title: 'Move the data layer', waiting_for: [1], tags: ['ui'] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema', blocked: 'vendor has not shipped' }),
    card(5, { title: 'Draft the release notes', status: 'doing', review: 'copy needs eyes', tags: ['ui'] }),
  ],
  archived: [],
});

const withoutStickers = () => {
  const board = makeBoard();
  board.active = board.active.map((c) => ({ ...c, blocked: null, review: null, waiting_for: [] }));
  return board;
};

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
const chipEl = () => {
  const el = hidden();
  let text = '';
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => { text = String(v); } });
  return el;
};

const CONTAINERS = { board: 'board', map: 'map-view', gantt: 'gantt-view', calendar: 'calendar-view', graph: 'graph-view' };

async function open({ view = 'board', board = makeBoard() } = {}) {
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  elements['#graph-view'] = control();
  elements['#calendar-view'] = control();
  elements['#search-chip'] = chipEl();
  elements['#search-pills'] = control();
  const page = await loadPage({ board, stored: { 'kanban.kanban.view.mode': view }, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  let renders = 0;
  const real = page.ctx.renderBoard;
  page.ctx.renderBoard = (...args) => { renders++; return real(...args); };
  const created = [];
  page.ctx.openModal = (...args) => { created.push(args); };
  const sortedIds = (set) => [...set].map(Number).sort((a, b) => a - b);
  return {
    page, view, created, calendarHost: elements['#calendar-view'], chip: elements['#search-chip'],
    renders: () => renders,
    ids: () => sortedIds(page.run('selectedIds')),
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    rangeStart: () => page.run('selectionState.rangeStart'),
    box: () => page.input.value,
    pick: (...ids) => page.run(`setSelection(${ids.reduce((s, id) => `addPart(${s}, cardPart(${id}))`, 'NO_SELECTION')}, ${ids[ids.length - 1]})`),
    pill: (key) => { page.run(`applyPillGesture('toggle', ${JSON.stringify(key)})`); },
    addPill: (key) => { page.run(`applyPillGesture('toggle', ${JSON.stringify(key)})`); },
    typeBox: (text) => page.input.typed(text),
    chipOn: () => !elements['#search-chip'].classList.contains('hidden'),
    mark: () => { renders = 0; },
  };
}

// A stand-in for an element: its tag, id, classes and attributes, and the ancestors
// closest() walks. It answers the simple selectors the page asks about, listed with
// commas (a tag, .class, #id, [attribute]) and refuses any other.
function el(tag, { id = null, classes = [], attrs = [], dataset = {} } = {}, parent = null) {
  const node = { tag, id, classes, attrs, dataset, parent, classList: { contains: (name) => classes.includes(name) } };
  const matches = (n, selector) => {
    if (/^[a-z][a-z0-9]*$/.test(selector)) return n.tag === selector;
    if (/^\.[\w-]+$/.test(selector)) return n.classes.includes(selector.slice(1));
    if (/^#[\w-]+$/.test(selector)) return n.id === selector.slice(1);
    if (/^\[[\w-]+\]$/.test(selector)) return n.attrs.includes(selector.slice(1, -1));
    throw new Error(`the page asked about a selector this stand-in does not read: ${selector}`);
  };
  node.closest = (selectors) => {
    const list = selectors.split(',').map((s) => s.trim());
    for (let n = node; n; n = n.parent) if (list.some((s) => matches(n, s))) return n;
    return null;
  };
  return new Proxy(node, { get: (t, key) => (key in t ? t[key] : harmless(String(key))) });
}

const inView = (view) => el('div', { id: CONTAINERS[view] });
const emptyIn = (view) => el('div', { classes: ['empty'] }, inView(view));
const cardIn = (view) => el('div', { classes: ['card-el'], dataset: { id: '3' } }, inView(view));

const click = (s, target, detail = 1, extra = {}) => s.page.fireDocument('click', { target, detail, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });
const doubleClick = (s, target, extra = {}) => { click(s, target, 1, extra); click(s, target, 2, extra); };

const a = (id) => ({ kind: 'card', id: String(id) });
const pillQuery = (text) => ({ kind: 'query', text });
const typedQuery = (text) => ({ kind: 'query', text, source: 'typing' });
const NOTHING = { anchor: null, additions: [] };

// --- cards picked by hand -------------------------------------------------------------

for (const view of Object.keys(CONTAINERS)) {
  test(`${view}: a single click on empty space leaves the selection, its range start and the box as they were, and repaints nothing`, async () => {
    const s = await open({ view });
    s.pick(1, 2);
    s.mark();
    click(s, emptyIn(view), 1);
    assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] });
    assert.deepStrictEqual(s.ids(), [1, 2]);
    assert.strictEqual(s.rangeStart(), 2);
    assert.strictEqual(s.box(), '');
    assert.strictEqual(s.renders(), 0);
  });

  test(`${view}: a double click on empty space clears the selection and its range start, and repaints once`, async () => {
    const s = await open({ view });
    s.pick(1, 2);
    click(s, emptyIn(view), 1);
    assert.deepStrictEqual(s.ids(), [1, 2], 'the first click of the pair changed nothing');
    s.mark();
    click(s, emptyIn(view), 2);
    assert.deepStrictEqual(s.selection(), NOTHING);
    assert.deepStrictEqual(s.ids(), []);
    assert.strictEqual(s.rangeStart(), null);
    assert.strictEqual(s.renders(), 1);
  });
}

test('a double click with nothing selected repaints nothing', async () => {
  const s = await open();
  s.mark();
  doubleClick(s, emptyIn('board'));
  assert.strictEqual(s.renders(), 0);
});

test('a click on empty space after the selection is gone leaves the box and the board as they were', async () => {
  const s = await open();
  s.typeBox('tags:ui');
  s.mark();
  doubleClick(s, emptyIn('board'));
  assert.strictEqual(s.box(), 'tags:ui', 'a hand-typed filter is not an anchor, so a double click does not clear it outside the Graph');
  assert.strictEqual(s.renders(), 0);
});

test('the third click of a triple click, and a click with a count that is not two, change nothing more', async () => {
  const s = await open();
  s.pick(1);
  click(s, emptyIn('board'), 1);
  click(s, emptyIn('board'), 3);
  click(s, emptyIn('board'), 0);
  assert.deepStrictEqual(s.ids(), [1]);
});

// --- a pill's query is an anchor ------------------------------------------------------------

test('a pill anchor stays with its query in the box and its chip on through a single click on empty space', async () => {
  const s = await open();
  s.pill('review');
  assert.strictEqual(s.box(), 'review:');
  s.mark();
  click(s, emptyIn('board'), 1);
  assert.deepStrictEqual(s.selection(), { anchor: pillQuery('review:'), additions: [] });
  assert.strictEqual(s.box(), 'review:');
  assert.ok(s.chipOn());
  assert.strictEqual(s.renders(), 0);
});

test('a double click on empty space takes a pill anchor out of the selection and its query out of the box, and the chip goes off', async () => {
  const s = await open();
  s.pill('review');
  assert.ok(s.chipOn());
  doubleClick(s, emptyIn('board'));
  assert.deepStrictEqual(s.selection(), NOTHING);
  assert.strictEqual(s.box(), '');
  assert.ok(!s.chipOn());
  assert.strictEqual(s.chip.textContent, '');
  assert.deepStrictEqual(s.ids(), []);
});

test('a double click takes every pill out at once, the added ones and the anchor, and leaves the other text the box holds', async () => {
  const s = await open();
  s.pill('review');
  s.addPill('blocked');
  assert.strictEqual(s.box(), 'review: | blocked:');
  s.typeBox('review: | blocked: | tags:ui');
  assert.deepStrictEqual(s.selection(), { anchor: pillQuery('review:'), additions: [pillQuery('blocked:')] });
  doubleClick(s, emptyIn('board'));
  assert.deepStrictEqual(s.selection(), NOTHING);
  assert.strictEqual(s.box(), 'tags:ui');
  assert.ok(!s.chipOn());
});

test('a double click clears a pill anchor that matches no card: it is an anchor with an empty id set', async () => {
  const s = await open({ board: withoutStickers() });
  s.pill('blocked');
  assert.deepStrictEqual(s.ids(), []);
  assert.strictEqual(s.box(), 'blocked:');
  click(s, emptyIn('board'), 1);
  assert.strictEqual(s.box(), 'blocked:', 'a single click leaves it');
  doubleClick(s, emptyIn('board'));
  assert.deepStrictEqual(s.selection(), NOTHING);
  assert.strictEqual(s.box(), '');
  assert.ok(!s.chipOn());
});

test('a pill anchor under hand-picked additions: the double click drops the cards and the pill together', async () => {
  const s = await open();
  s.pill('review');
  s.page.run('setSelection(addPart(selectionState.selection, cardPart(1)), 1)');
  assert.deepStrictEqual(s.selection(), { anchor: pillQuery('review:'), additions: [a(1)] });
  doubleClick(s, emptyIn('board'));
  assert.deepStrictEqual(s.selection(), NOTHING);
  assert.strictEqual(s.box(), '');
  assert.strictEqual(s.rangeStart(), null);
});

// --- a search typed in the Graph is an anchor ---------------------------------------------------

test('Graph: a single click on the empty canvas leaves a typed search, its matches and the anchor where they are', async () => {
  const s = await open({ view: 'graph' });
  s.typeBox('tags:ui');
  assert.deepStrictEqual(s.ids(), [2, 5]);
  click(s, emptyIn('graph'), 1);
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.selection(), { anchor: typedQuery('tags:ui'), additions: [] });
  assert.deepStrictEqual(s.ids(), [2, 5]);
});

test('Graph: a double click on the empty canvas clears the typed search, the anchor and its additions', async () => {
  const s = await open({ view: 'graph' });
  s.typeBox('tags:ui');
  s.page.run('setSelection(addPart(selectionState.selection, cardPart(4)), null)');
  assert.deepStrictEqual(s.ids(), [2, 4, 5]);
  doubleClick(s, emptyIn('graph'));
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), NOTHING);
  assert.deepStrictEqual(s.ids(), []);
});

test('Graph: a double click clears a typed search that matches nothing too', async () => {
  const s = await open({ view: 'graph' });
  s.typeBox('nothing-matches-this');
  doubleClick(s, emptyIn('graph'));
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.selection(), NOTHING);
});

test('a double click outside the Graph canvas leaves a typed search, so a double click in the box or on the header does not wipe it', async () => {
  const s = await open({ view: 'graph' });
  s.typeBox('tags:ui');
  doubleClick(s, el('div', { classes: ['header-space'] }, el('header', {})));
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.selection().anchor, typedQuery('tags:ui'));
});

test('Graph: a double click on the empty canvas drops a card selection carried in and leaves the box, which was not its anchor, alone', async () => {
  const s = await open({ view: 'board' });
  s.typeBox('tags:ui');
  s.pick(5);
  s.page.run("toggleView('graph')");
  doubleClick(s, emptyIn('graph'));
  assert.deepStrictEqual(s.selection(), NOTHING);
  assert.strictEqual(s.box(), 'tags:ui');
});

// --- what is not empty space ------------------------------------------------------------------

const NOT_EMPTY = {
  'a Graph dot': (view) => el('g', { classes: ['graph-node'] }, inView(view)),
  'a caption of the tier fan, a tab stop with a tip': (view) => el('text', { attrs: ['data-tip'] }, inView(view)),
  'a button': (view) => el('button', {}, inView(view)),
  'a link': (view) => el('a', {}, inView(view)),
  'a text field': (view) => el('input', {}, inView(view)),
  'a text area': (view) => el('textarea', {}, inView(view)),
  'a select': (view) => el('select', {}, inView(view)),
  'a control that keeps the selection': (view) => el('span', { attrs: ['data-keeps-selection'] }, inView(view)),
  'something inside a control that keeps the selection': (view) => el('i', {}, el('div', { attrs: ['data-keeps-selection'] }, inView(view))),
  'a popup': (view) => el('p', {}, el('div', { classes: ['modal-backdrop'] }, inView(view))),
  'the card menu': (view) => el('li', {}, el('div', { classes: ['context-menu'] }, inView(view))),
};

for (const [name, make] of Object.entries(NOT_EMPTY)) {
  test(`a double click on ${name} leaves the selection and the box`, async () => {
    for (const view of ['board', 'graph']) {
      const s = await open({ view });
      s.pick(1, 2);
      s.mark();
      doubleClick(s, make(view));
      assert.deepStrictEqual(s.ids(), [1, 2], view);
      assert.strictEqual(s.renders(), 0, view);
    }
  });
}

test('a double click on the cue of a card leaves the selection: a card is not empty space, though the cue is no selection gesture', async () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const s = await open({ view });
    s.pick(1, 2);
    const cue = el('span', { classes: ['blocked-pill'] }, cardIn(view));
    doubleClick(s, cue);
    assert.strictEqual(s.box(), 'blocked:', `${view}: the cue wrote the box, once`);
    assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] }, view);
    assert.strictEqual(s.rangeStart(), 2, view);
  }
});

test('a single click on a cue, a control that does not mark itself or a text field no longer clears the selection either', async () => {
  for (const make of [(view) => el('span', { classes: ['blocked-pill'] }, cardIn(view)), (view) => el('button', { classes: ['column-add'] }, inView(view)), (view) => el('input', {}, inView(view))]) {
    const s = await open();
    s.pick(1, 2);
    click(s, make('board'), 1);
    assert.deepStrictEqual(s.selection().anchor, a(1));
  }
});

test('a double click with Shift, Ctrl or Cmd held builds a selection, so it never clears one', async () => {
  for (const mod of ['shiftKey', 'ctrlKey', 'metaKey']) {
    const s = await open();
    s.pick(1, 2);
    doubleClick(s, emptyIn('board'), { [mod]: true });
    assert.deepStrictEqual(s.ids(), [1, 2], mod);
  }
});

test('the page listens for no double click event on the document: the second click carries the count', async () => {
  const s = await open();
  assert.strictEqual(s.page.documentListeners.dblclick, undefined);
});

// --- a double click that already means something ----------------------------------------------

const CALENDAR_CREATES = [
  ['a day of the month grid', { classes: ['cal-day'], dataset: { day: '2026-10-15' } }, '2026-10-15'],
  ['a cell of the all-day band', { classes: ['cal-tg-allday-cell'], dataset: { day: '2026-10-16' } }, '2026-10-16'],
];

for (const [name, spec, start] of CALENDAR_CREATES) {
  test(`Calendar: a double click on ${name} opens a new card aimed at it and leaves the selection`, async () => {
    const s = await open({ view: 'calendar' });
    s.pick(1, 2);
    s.mark();
    const target = el('div', spec, inView('calendar'));
    doubleClick(s, target);
    s.calendarHost.fire('dblclick', { target, clientY: 0, detail: 2 });
    assert.deepStrictEqual(s.created, [[null, null, start]]);
    assert.deepStrictEqual(s.ids(), [1, 2]);
    assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2)] });
    assert.strictEqual(s.rangeStart(), 2);
    assert.strictEqual(s.renders(), 0);
  });
}

test('Calendar: a double click on a time-grid column opens a new card aimed at that slot and leaves the selection', async () => {
  const s = await open({ view: 'calendar' });
  s.pick(1, 2);
  const target = el('div', { classes: ['cal-tg-col'], dataset: { day: '2026-10-15' } }, inView('calendar'));
  target.getBoundingClientRect = () => ({ top: 100 });
  doubleClick(s, target);
  s.calendarHost.fire('dblclick', { target, clientY: 100 + 60 * 9, detail: 2 });
  assert.strictEqual(s.created.length, 1);
  assert.match(s.created[0][2], /^2026-10-15T\d\d:\d\d$/);
  assert.deepStrictEqual(s.ids(), [1, 2]);
});

test('Calendar: a double click on the rest of the Calendar clears the selection, since it creates nothing there', async () => {
  const s = await open({ view: 'calendar' });
  s.pick(1, 2);
  const target = el('div', { classes: ['cal-head'] }, inView('calendar'));
  doubleClick(s, target);
  s.calendarHost.fire('dblclick', { target, clientY: 0, detail: 2 });
  assert.deepStrictEqual(s.created, []);
  assert.deepStrictEqual(s.selection(), NOTHING);
});

test('the other views have no double click on empty space to keep: the Board, the Map, the Gantt and the Graph clear on it', async () => {
  for (const view of ['board', 'map', 'gantt', 'graph']) {
    const s = await open({ view });
    s.pick(3);
    doubleClick(s, emptyIn(view));
    assert.deepStrictEqual(s.selection(), NOTHING, view);
  }
});
