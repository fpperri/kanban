const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// A plain click and a double click on a card in a view the preferences set to
// selects, run through every listener the real page puts on the document (the
// shared card handler, then the click-away rule), the way the browser runs them.
// A double click is its second click: the first click's repaint replaces the
// card, and a double click event aimed at the replaced card never reaches the
// document, so the click carries its count (detail) and the page opens on that.

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
  active: [card(1, { status: 'doing' }), card(2), card(3, { status: 'backlog' })],
  archived: [],
});

const SELECTS = JSON.stringify({ click: { board: 'selects', map: 'selects', gantt: 'selects', calendar: 'selects' } });

async function open({ view = 'board', prefs = SELECTS } = {}) {
  const stored = { 'kanban.kanban.view.mode': view };
  if (prefs) stored['kanban.kanban.prefs'] = prefs;
  const page = await loadPage({ board: makeBoard(), stored, elements: { '#graph-view': control() } }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const opened = [];
  page.ctx.openCard = (id) => { opened.push(id); };
  const selection = () => JSON.parse(JSON.stringify(page.run('selectionState.selection')));
  return { page, opened, selection };
}

// A fresh element for every click, as the real page has after each repaint.
function cardTarget(id) {
  const el = { dataset: { id: String(id) } };
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.card-el' ? el : null) : harmless(String(key))) });
}
const empty = () => new Proxy({}, { get: (t, key) => (key === 'closest' ? () => null : harmless(String(key))) });
const click = (s, target, extra = {}) => s.page.fireDocument('click', { target, detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });

const a = (id) => ({ kind: 'card', id });

test('a plain click in a view set to selects leaves the card selected: the click-away rule does not drop what the click built', async () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const s = await open({ view });
    click(s, cardTarget(2));
    assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] }, view);
    assert.deepStrictEqual(s.opened, [], `${view}: a plain click only selects`);
  }
});

test('the second click of a double click opens the card and leaves the selection as the first click made it: a peek', async () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const s = await open({ view });
    click(s, cardTarget(2), { detail: 1 });
    click(s, cardTarget(2), { detail: 2 });
    assert.deepStrictEqual(s.opened, [2], view);
    assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] }, `${view}: opening it left the selection alone`);
  }
});

test('a double click opens the card even when the first click had a selection of other cards: the first click made this card the anchor', async () => {
  const s = await open();
  click(s, cardTarget(1), { ctrlKey: true });
  click(s, cardTarget(3), { ctrlKey: true });
  click(s, cardTarget(2), { detail: 1 });
  click(s, cardTarget(2), { detail: 2 });
  assert.deepStrictEqual(s.opened, [2]);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
});

test('a single click opens nothing, and a third click of a triple click selects again rather than opening a second time', async () => {
  const s = await open();
  click(s, cardTarget(2), { detail: 1 });
  click(s, cardTarget(2), { detail: 2 });
  click(s, cardTarget(2), { detail: 3 });
  assert.deepStrictEqual(s.opened, [2]);
});

test('a click on empty space keeps the card a plain click selected, and a double click on empty space drops it', async () => {
  const s = await open();
  click(s, cardTarget(2));
  click(s, empty(), { detail: 1 });
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
  click(s, empty(), { detail: 1 });
  click(s, empty(), { detail: 2 });
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('a plain click on another card moves the selection to it, and a click with a modifier still builds one', async () => {
  const s = await open();
  click(s, cardTarget(2));
  click(s, cardTarget(3), { ctrlKey: true });
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(3)] });
  click(s, cardTarget(1));
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [] });
});

test('a view whose plain click opens the card opens it on the first click and empties the selection, as it always did', async () => {
  const s = await open({ prefs: null });
  click(s, cardTarget(1), { ctrlKey: true });
  click(s, cardTarget(2), { detail: 1 });
  assert.deepStrictEqual(s.opened, [2]);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('a click on the second card of a double click that landed on a control inside it opens nothing', async () => {
  const s = await open();
  const el = { dataset: { id: '2' } };
  const onButton = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.card-el' ? el : sel === 'button, select, input, a' ? {} : null) : harmless(String(key))) });
  click(s, cardTarget(2), { detail: 1 });
  click(s, onButton, { detail: 2 });
  assert.deepStrictEqual(s.opened, []);
});

test('the page listens for no double click on the document: opening rides the click', async () => {
  const s = await open();
  assert.strictEqual(s.page.documentListeners.dblclick, undefined);
});

test('Enter on a focused card opens it in a view set to selects, and leaves the selection', async () => {
  const s = await open({ view: 'map' });
  click(s, cardTarget(2));
  const focused = { dataset: { id: '2' }, closest: (sel) => (sel === '.card-el' ? focused : null) };
  s.page.fireDocument('keydown', { key: 'Enter', repeat: false, target: focused, shiftKey: false, ctrlKey: false, metaKey: false });
  assert.deepStrictEqual(s.opened, [2]);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [] });
});
