const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control } = require('./helpers/page-vm');

// Space, Shift+Space and Ctrl+Space in the real page (helpers/page-vm.js runs every script the page loads in one
// vm): Space on a hovered, else focused, card writes the sets On hover show ticks into the search box as the write
// 'hover', which never turns isolate on; Shift+Space adds them to what the box holds; Space keeps its own job with
// no card, in a field, on a control and behind a surface; Ctrl+Space is not its key. The
// browser runner presses the real keys (scenarios/hover-space.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Card 1 is the parent of 3, 2 waits for it. Card 4 is on its own.
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing' }),
    card(2, { title: 'Move the data layer', waiting_for: ['1'] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema' }),
  ],
  archived: [],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const KEY = 'kanban.kanban.hover.show';

function tile(id) {
  const names = new Set();
  return { dataset: { id: String(id) }, names, classList: { add: (c) => names.add(c), remove: (c) => names.delete(c), contains: (c) => names.has(c) } };
}

const onCard = (id) => ({ closest: (sel) => (sel === '.card-el' ? tile(id) : null) });
const onControl = { closest: (sel) => (sel.includes('button') ? {} : null) };
const onPlain = { closest: () => null };

async function open({ view = 'board', stored = {}, surfaces = [] } = {}) {
  const elements = {};
  for (const sel of HIDDEN_SURFACES) { const el = control(); el.classList.add('hidden'); elements[sel] = el; }
  for (const sel of surfaces) elements[sel] = control();
  elements['#graph-view'] = control();
  const tiles = ['1', '2', '3', '4'].map(tile);
  const documentExtras = {
    querySelectorAll: (sel) => (sel === '.card-el' ? tiles : sel === '.hover-highlight' ? tiles.filter((t) => t.names.has('hover-highlight')) : []),
  };
  const store = { 'kanban.kanban.view.mode': view, ...stored };
  const page = await loadPage({ board: makeBoard(), stored: store, elements, documentExtras }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const told = [];
  page.ctx.onSearchWrite((text, reason) => told.push([text, reason]));
  const s = {
    page, told, stored: store,
    box: () => page.input.value,
    isolated: () => page.run('isolateNow()') !== null,
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    over(id) { page.fireDocument('mouseover', { target: onCard(id) }); },
    out(id) { page.fireDocument('mouseout', { target: onCard(id), relatedTarget: null }); },
    focusOn(el) { page.ctx.document.activeElement = el; },
    type(text) { page.input.typed(text); },
    space(over = {}) {
      let prevented = 0;
      page.fireDocument('keydown', { key: ' ', target: onPlain, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, preventDefault() { prevented++; }, ...over });
      return prevented;
    },
  };
  return s;
}

// --- Space ------------------------------------------------------------------------------------------------------------

test('Space on a hovered card writes the sets ticked into the box as alternatives, and prevents the scroll', async () => {
  const s = await open();
  s.over(1);
  assert.strictEqual(s.space(), 1);
  assert.strictEqual(s.box(), 'dlinks:1 | hlinks:1');
  assert.deepStrictEqual(s.told, [['dlinks:1 | hlinks:1', 'hover']], 'the write has its own reason');
});

test('the sets written are the ones ticked for the view: the Hierarchy\'s on the Board, and the Flow\'s own in the Graph\'s Flow', async () => {
  const stored = { [KEY]: JSON.stringify({ hierarchy: ['hpath', 'dtree'], flow: ['dpath'] }) };
  const board = await open({ stored: { ...stored } });
  board.over(3);
  board.space();
  assert.strictEqual(board.box(), 'dtree:3 | hpath:3');
  const flow = await open({ view: 'graph', stored: { ...stored, 'kanban.kanban.graph.layout': 'flow' } });
  flow.over(3);
  flow.space();
  assert.strictEqual(flow.box(), 'dpath:3');
});

test('Space keeps the run of slices the box holds, and writes the card\'s terms beside it', async () => {
  const s = await open();
  s.type('zephyr slice:goal');
  s.over(2);
  s.space();
  assert.strictEqual(s.box(), '(dlinks:2 | hlinks:2) slice:goal');
});

test('Space replaces what the box held, and writes nothing when the box already says it', async () => {
  const s = await open();
  s.type('tags:ui');
  s.over(1);
  s.space();
  assert.strictEqual(s.box(), 'dlinks:1 | hlinks:1');
  s.told.length = 0;
  assert.strictEqual(s.space(), 1, 'it still takes the key');
  assert.deepStrictEqual(s.told, [], 'but the box is not written again');
});

test('with the pointer on no card, Space acts on the card with the focus', async () => {
  const s = await open();
  s.focusOn({ tagName: 'DIV', closest: (sel) => (sel === '.card-el' ? tile(3) : null) });
  assert.strictEqual(s.space(), 1);
  assert.strictEqual(s.box(), 'dlinks:3 | hlinks:3');
});

test('the card under the pointer wins over the one with the focus', async () => {
  const s = await open();
  s.focusOn({ tagName: 'DIV', closest: (sel) => (sel === '.card-el' ? tile(3) : null) });
  s.over(2);
  s.space();
  assert.strictEqual(s.box(), 'dlinks:2 | hlinks:2');
});

test('the Graph takes the written terms as the typed anchor, so it lights what they name', async () => {
  const s = await open({ view: 'graph' });
  s.over(1);
  s.space();
  assert.deepStrictEqual(s.selection(), { anchor: { kind: 'query', text: 'dlinks:1 | hlinks:1', source: 'typing' }, additions: [] });
});

// --- isolate as it was -----------------------------------------------------------------------------------------------

test('Space never turns isolate on, though typing the same text does on the Board', async () => {
  const typed = await open();
  typed.type('dlinks:1 | hlinks:1');
  assert.strictEqual(typed.isolated(), true, 'Typing isolates is on in the Board');
  const s = await open();
  s.over(1);
  s.space();
  assert.strictEqual(s.box(), 'dlinks:1 | hlinks:1');
  assert.strictEqual(s.isolated(), false, 'isolate stays off, so the Board lights the sets and hides nothing');
  assert.strictEqual(s.selection().anchor, null, 'a Board box is no anchor');
});

test('Shift+Space never turns isolate on either, and a box that held a query isolated by typing keeps its isolate', async () => {
  const s = await open();
  s.type('tags:ui');
  assert.strictEqual(s.isolated(), true);
  s.over(1);
  s.space({ shiftKey: true });
  assert.strictEqual(s.box(), 'tags:ui | dlinks:1 | hlinks:1');
  assert.strictEqual(s.isolated(), true, 'isolate as it was');
  const off = await open();
  off.page.run("setTypingIsolates('board', false)");
  off.over(1);
  off.space({ shiftKey: true });
  assert.strictEqual(off.isolated(), false);
});

// --- Shift+Space -------------------------------------------------------------------------------------------------------

test('Shift+Space adds the card\'s terms to what the box holds as more alternatives, from several cards', async () => {
  const s = await open();
  s.over(1);
  s.space();
  s.out(1);
  s.over(4);
  s.space({ shiftKey: true });
  assert.strictEqual(s.box(), 'dlinks:1 | hlinks:1 | dlinks:4 | hlinks:4');
  assert.deepStrictEqual(s.told.map((t) => t[1]), ['hover', 'hover']);
});

test('Shift+Space on an empty box is a plain Space, and keeps the box\'s cut', async () => {
  const s = await open();
  s.over(2);
  s.space({ shiftKey: true });
  assert.strictEqual(s.box(), 'dlinks:2 | hlinks:2');
  const cut = await open();
  cut.type('slice:goal');
  cut.over(2);
  cut.space({ shiftKey: true });
  assert.strictEqual(cut.box(), '(dlinks:2 | hlinks:2) slice:goal');
});

test('Shift+Space on a card whose terms the box holds already changes nothing', async () => {
  const s = await open();
  s.over(1);
  s.space();
  s.told.length = 0;
  s.space({ shiftKey: true });
  assert.strictEqual(s.box(), 'dlinks:1 | hlinks:1');
  assert.deepStrictEqual(s.told, []);
});

// --- Space keeps its job ---------------------------------------------------------------------------------------------

test('with no card hovered or focused Space does nothing and is not prevented, so the page scrolls', async () => {
  const s = await open();
  assert.strictEqual(s.space(), 0);
  assert.strictEqual(s.box(), '');
  s.over(1);
  s.out(1);
  assert.strictEqual(s.space(), 0, 'the pointer left the card');
  assert.strictEqual(s.box(), '');
});

test('in a text field Space is a space: a hovered card does not take it', async () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    const s = await open();
    s.over(1);
    s.focusOn({ tagName, closest: () => null });
    assert.strictEqual(s.space(), 0, tagName);
    assert.strictEqual(s.box(), '', tagName);
  }
  const editable = await open();
  editable.over(1);
  editable.focusOn({ tagName: 'DIV', isContentEditable: true, closest: () => null });
  assert.strictEqual(editable.space(), 0, 'a contenteditable box');
});

test('on a button, a link, a switch or a tab Space presses it: a hovered card does not take it', async () => {
  const s = await open();
  s.over(1);
  assert.strictEqual(s.space({ target: onControl }), 0);
  assert.strictEqual(s.box(), '');
  const selectors = s.page.run('HOVER_SPACE_OWN');
  for (const own of ['button', 'a', 'summary', '[role="button"]', '[role="checkbox"]', '[role="switch"]', '[role="tab"]', 'input']) assert.ok(selectors.includes(own), own);
});

test('behind a menu, a dialog, the notifications panel, the preferences sheet or the notes palette Space keeps its job: a todo item ticks', async () => {
  for (const surface of ['#context-menu:not(.hidden)', '.modal-backdrop:not(.hidden)', '#notif-modal:not(.hidden)', '#prefs-sheet:not(.hidden)', '#notes-palette:not(.hidden)']) {
    const s = await open({ surfaces: [surface] });
    s.over(1);
    assert.strictEqual(s.space(), 0, surface);
    assert.strictEqual(s.box(), '', surface);
  }
});

test('a key a handler took already (a todo item\'s tick prevents it) is not Space\'s again', async () => {
  const s = await open();
  s.over(1);
  assert.strictEqual(s.space({ defaultPrevented: true }), 0);
  assert.strictEqual(s.box(), '');
});

test('a held Space, Alt+Space and Ctrl+Space are not the write: Ctrl+Space is the Graph\'s select', async () => {
  const s = await open();
  s.over(1);
  for (const over of [{ repeat: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { ctrlKey: true, shiftKey: true }, { key: 'Enter' }]) {
    assert.strictEqual(s.space(over), 0, JSON.stringify(over));
    assert.strictEqual(s.box(), '', JSON.stringify(over));
  }
});

test('with no set ticked Space has nothing to write and keeps its job', async () => {
  const s = await open({ stored: { [KEY]: JSON.stringify({ hierarchy: [], flow: [] }) } });
  s.over(1);
  assert.strictEqual(s.space(), 0);
  assert.strictEqual(s.box(), '');
});
