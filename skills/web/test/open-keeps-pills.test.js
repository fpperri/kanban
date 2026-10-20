const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const { attachSessionHistory } = require('./helpers/session-history');

// Opening a card changes no filter. The real page runs in a vm (helpers/page-vm.js) over a
// browser session history (helpers/session-history.js), so a card really opens and closes.
// A click that opens a card (a plain click in the Board, Map, Gantt and Calendar, unless the
// preferences sheet says selects) leaves every pill that is on, the text in the search box and
// the cards the view shows exactly as they were; closing the details leaves them as they were
// too. A click that only changes the selection and opens nothing still takes the selection's
// pills out of the box. The pure rule is pinned in selection-anchor.test.js; the browser runner
// looks at the page itself (scenarios/open-keeps-pills.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// 4 is blocked, 5 awaits review, 2 waits for 1, and 3 is under 1. 6 is dated, for the Calendar and the Gantt.
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
    card(6, { title: 'Renew the domain', status: 'done', tags: ['ops'], start_date: '2031-06-02', end_date: '2031-06-20' }),
  ],
  archived: [],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
const spied = (el = control()) => {
  el.attrs = {};
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  return el;
};
const chipEl = () => {
  const el = spied(hidden());
  let text = '';
  Object.defineProperty(el, 'textContent', { configurable: true, get: () => text, set: (v) => { text = String(v); } });
  return el;
};

async function open({ view = 'board', stored = {}, board = makeBoard() } = {}) {
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  elements['#search-pills'] = control();
  elements['#graph-view'] = control();
  elements['#search-panel-toggle'] = spied();
  elements['#search-pills-fold'] = spied();
  elements['#search-chip'] = chipEl();
  const page = loadPage({ board, stored: { 'kanban.kanban.view.mode': view, ...stored }, elements });
  const session = attachSessionHistory(page);
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const sortedIds = (set) => [...set].map(Number).sort((a, b) => a - b);
  const chip = elements['#search-chip'];
  const s = {
    page, session, elements,
    box: () => page.input.value,
    type: (text) => page.input.typed(text),
    ids: () => sortedIds(page.run('selectedIds')),
    shown: () => sortedIds(page.run('shownCardIds()')),
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    on: () => JSON.parse(JSON.stringify(page.run('searchPanelPills()'))).filter((p) => page.run(`pillIsOn(selectionState.selection, searchPanelPills().find((p) => p.key === ${JSON.stringify(p.key)}))`)).map((p) => p.key),
    chip: () => ({ hidden: chip.classList.contains('hidden'), text: chip.textContent }),
    detail: () => { const v = page.run('currentDetailId'); return v === null ? null : Number(v); },
    address: () => session.search,
    pillClick: (key, init = {}) => {
      const button = { dataset: { pillKey: key }, closest: (sel) => (sel === '.query-pill' ? button : null) };
      elements['#search-pills'].fire('click', { target: button, shiftKey: false, preventDefault() {}, ...init });
    },
    ctrlClick: (id) => page.fireDocument('click', { target: cardTarget(id), detail: 1, shiftKey: false, ctrlKey: true, metaKey: false }),
    click: async (id, m = {}) => {
      page.fireDocument('click', { target: cardTarget(id), detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...m });
      await page.settle();
    },
    nodeClick: (id, m = {}) => elements['#graph-view'].fire('click', nodeEvent(id, m)),
    nodeDoubleClick: async (id) => { elements['#graph-view'].fire('dblclick', nodeEvent(id)); await page.settle(); },
    nodeEnter: async (id) => { elements['#graph-view'].fire('keydown', nodeEvent(id, { key: 'Enter' })); await page.settle(); },
    nodeSpace: async (id) => { elements['#graph-view'].fire('keydown', nodeEvent(id, { key: ' ' })); await page.settle(); },
    close: async () => { session.close.fire('click'); await page.settle(); },
  };
  return s;
}

function cardTarget(id) {
  const el = { dataset: { id: String(id) } };
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.card-el' ? el : null) : harmless(String(key))) });
}

function nodeEvent(id, m = {}) {
  const node = { dataset: { id: String(id) } };
  const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.graph-node' ? node : null) : harmless(String(key))) });
  return { target, stopPropagation() {}, preventDefault() {}, key: m.key, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...m };
}

const q = (text) => ({ kind: 'query', text });
const a = (id) => ({ kind: 'card', id: String(id) });
const VIEWS = ['board', 'map', 'gantt', 'calendar'];

// --- a click that opens a card ----------------------------------------------------------------

test('a plain click that opens a card leaves the pill on, the box as it was and the cards the view shows, in the Board, Map, Gantt and Calendar', async () => {
  for (const view of VIEWS) {
    const s = await open({ view });
    s.pillClick('review');
    assert.strictEqual(s.box(), 'review:', view);
    const shown = s.shown();
    const chip = s.chip();
    await s.click(5);
    assert.strictEqual(s.detail(), 5, `${view}: the card opens`);
    assert.strictEqual(s.box(), 'review:', `${view}: the pill's query stays in the box`);
    assert.deepStrictEqual(s.on(), ['review'], `${view}: the pill is still on`);
    assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] }, `${view}: and still the anchor`);
    assert.deepStrictEqual(s.shown(), shown, `${view}: the view behind the card shows the same cards`);
    assert.deepStrictEqual(s.chip(), chip, `${view}: and the chip counts the same`);
  }
});

test('on the Board the cards behind the open card are the ones the pill left, not every card', async () => {
  const s = await open();
  s.pillClick('review');
  assert.deepStrictEqual(s.shown(), [5]);
  await s.click(5);
  assert.deepStrictEqual(s.shown(), [5]);
});

test('every pill that is on stays on, and the text typed beside them stays in the box', async () => {
  const s = await open();
  s.type('zephyr');
  s.pillClick('review');
  s.pillClick('blocked');
  assert.strictEqual(s.box(), 'zephyr | review: | blocked:');
  const shown = s.shown();
  await s.click(1);
  assert.strictEqual(s.detail(), 1);
  assert.strictEqual(s.box(), 'zephyr | review: | blocked:');
  assert.deepStrictEqual(s.on(), ['blocked', 'review']);
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [q('blocked:')] });
  assert.deepStrictEqual(s.shown(), shown);
});

test('a card picked by hand beside the pills still leaves the selection when a click opens another card, and the pills stay', async () => {
  const s = await open();
  s.pillClick('review');
  s.ctrlClick(3);
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [a(3)] });
  await s.click(5);
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.on(), ['review']);
});

test('the pill stays on when it is not the first part: the anchor was a hand-picked card', async () => {
  const s = await open();
  s.ctrlClick(5);
  s.pillClick('review');
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [q('review:')] });
  await s.click(1);
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] }, 'the pill is the anchor now');
  assert.strictEqual(s.box(), '', 'the box was empty and stays empty: an empty box hides nothing');
  assert.deepStrictEqual(s.on(), ['review']);
});

test('a click that opens a card with no pill on writes nothing to the box and leaves the typed text', async () => {
  const s = await open();
  s.type('zephyr');
  const writes = s.page.input.writes.length;
  await s.click(1);
  assert.strictEqual(s.detail(), 1);
  assert.strictEqual(s.box(), 'zephyr');
  assert.strictEqual(s.page.input.writes.length, writes, 'the page did not write the box');
});

test('a click that opens a card writes the box not at all while a pill is on', async () => {
  const s = await open();
  s.pillClick('review');
  const writes = s.page.input.writes.length;
  await s.click(5);
  assert.strictEqual(s.page.input.writes.length, writes);
});

test('while isolated a click that opens a card leaves the isolate text, the pill and the shown cards', async () => {
  const s = await open();
  s.pillClick('review');
  s.page.run('isolateTurnOn()');
  assert.strictEqual(s.box(), 'review:');
  await s.click(5);
  assert.strictEqual(s.detail(), 5);
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.deepStrictEqual(s.shown(), [5]);
});

// --- closing the card -------------------------------------------------------------------------

test('closing the card details leaves the pill on, the box and the shown cards as they were before the card opened', async () => {
  const s = await open();
  s.type('zephyr');
  s.pillClick('review');
  const before = { box: s.box(), on: s.on(), selection: s.selection(), shown: s.shown(), chip: s.chip() };
  await s.click(5);
  assert.strictEqual(s.detail(), 5);
  await s.close();
  assert.strictEqual(s.detail(), null, 'the card is closed');
  assert.deepStrictEqual({ box: s.box(), on: s.on(), selection: s.selection(), shown: s.shown(), chip: s.chip() }, before);
});

test('the address keeps the box\'s text through opening and closing the card', async () => {
  const s = await open();
  s.pillClick('review');
  assert.strictEqual(s.address(), '?q=review%3A');
  await s.click(5);
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(s.address())), { q: 'review:', card: '5' });
  await s.close();
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(s.address())), { q: 'review:' });
});

test('a poll while the card is closed again keeps the pill, which the selection still holds', async () => {
  const s = await open();
  s.pillClick('review');
  await s.click(5);
  await s.close();
  s.page.run('autoRefreshTick()');
  await s.page.settle();
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.on(), ['review']);
  assert.deepStrictEqual(s.shown(), [5]);
});

// --- a click that only selects ----------------------------------------------------------------

test('a click that selects a card without opening it still takes the pill out of the box, in a view the preferences sheet sets to selects', async () => {
  const s = await open({ stored: { 'kanban.kanban.prefs': JSON.stringify({ click: { board: 'selects' } }) } });
  s.pillClick('review');
  assert.strictEqual(s.box(), 'review:');
  await s.click(5);
  assert.strictEqual(s.detail(), null, 'nothing opened');
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [] });
  assert.strictEqual(s.box(), '', 'the pill is off and its query is gone from the box');
  assert.deepStrictEqual(s.on(), []);
});

test('a plain click on a card in the Graph, which selects it, still takes the pill out of the box', async () => {
  const s = await open({ view: 'graph' });
  s.pillClick('review');
  assert.strictEqual(s.box(), 'review:');
  s.nodeClick(5);
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [] });
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.on(), []);
});

test('a plain click on a card in the Graph, which paints in place, takes the pill off the chip too', async () => {
  const s = await open({ view: 'graph' });
  s.pillClick('review');
  assert.deepStrictEqual(s.chip(), { hidden: false, text: '1' }, 'the chip counts the pill');
  s.nodeClick(5);
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.on(), []);
  assert.deepStrictEqual(s.chip(), { hidden: true, text: '' }, 'the chip counts nothing, as the box and the selection say');
});

test('Space on a focused card in the Graph, which acts as a plain click, takes the pill off the chip too', async () => {
  const s = await open({ view: 'graph' });
  s.pillClick('review');
  assert.deepStrictEqual(s.chip(), { hidden: false, text: '1' });
  await s.nodeSpace(5);
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [] });
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.chip(), { hidden: true, text: '' });
});

test('a Shift+click in the Graph that adds a card to a pill keeps the pill and its chip', async () => {
  const s = await open({ view: 'graph' });
  s.pillClick('review');
  s.nodeClick(2, { shiftKey: true });
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [a(2)] });
  assert.deepStrictEqual(s.chip(), { hidden: false, text: '1' });
});

test('Esc still takes the pill out of the box and off the selection', async () => {
  const s = await open();
  s.pillClick('review');
  s.page.run('stepSelectionBack()');
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(s.on(), []);
});

// --- the Graph's open gestures ----------------------------------------------------------------

test('in the Graph, Enter on a focused card opens it and leaves the pill, the box and the selection as they were', async () => {
  const s = await open({ view: 'graph' });
  s.pillClick('review');
  const before = { box: s.box(), selection: s.selection(), on: s.on() };
  await s.nodeEnter(2);
  assert.strictEqual(s.detail(), 2);
  assert.deepStrictEqual({ box: s.box(), selection: s.selection(), on: s.on() }, before);
});

test('in the Graph, the double click event that opens a card changes nothing itself', async () => {
  const s = await open({ view: 'graph' });
  s.pillClick('review');
  const before = { box: s.box(), selection: s.selection(), on: s.on() };
  await s.nodeDoubleClick(2);
  assert.strictEqual(s.detail(), 2);
  assert.deepStrictEqual({ box: s.box(), selection: s.selection(), on: s.on() }, before);
});

test('a peek from the card menu opens the card and leaves the pill on', async () => {
  const s = await open();
  s.pillClick('review');
  s.page.rightClickCard(2);
  s.page.run('peekCard()');
  await s.page.settle();
  assert.strictEqual(s.detail(), 2);
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.on(), ['review']);
});
