const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control } = require('./helpers/page-vm');
const { fakeDom } = require('./helpers/fake-dom');
const { HOTKEYS, hotkeyRows } = require('../web/hotkeys');

// The preferences sheet's Hotkeys section in the real page (helpers/page-vm.js runs every
// script the page loads in one vm): the gear and the ? key open the sheet, the ? key at the
// section, the list is drawn from hotkeys.js with the state of each key that has one, and the
// list follows the state while the sheet is up. The elements are not drawn in a vm, so the
// rows are built on a small stand-in for the DOM and read back; the browser runner looks at
// the page itself (scenarios/hotkeys.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Hierarchy goal, strategy, epic: no card is a strategy, so the slices are goal, epic and the
// depths. 5 is blocked, so the blocked pill has a card to select.
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], notifications: [], types: [],
  hierarchy: ['goal', 'strategy', 'epic'],
  active: [
    card(1, { type: 'goal' }),
    card(2, { type: 'goal', status: 'doing' }),
    card(3, { type: 'epic', parent: 1 }),
    card(4, { type: 'story', parent: 3 }),
    card(5, { type: 'story', blocked: 'vendor' }),
  ],
  archived: [],
});

const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
const spied = (el = control()) => {
  el.attrs = {};
  el.focused = 0;
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.focus = () => { el.focused++; };
  return el;
};
const listHost = () => {
  const el = control();
  el.children = [];
  el.ownerDocument = fakeDom();
  el.append = (...nodes) => { for (const n of nodes) { n.parent = el; el.children.push(n); } };
  el.insertBefore = (node, ref) => {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    node.parent = el;
    el.children.splice(ref ? el.children.indexOf(ref) : el.children.length, 0, node);
  };
  return el;
};

async function open({ stored = {}, board = makeBoard() } = {}) {
  const elements = {};
  for (const sel of ['#context-menu', '#notif-modal', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel']) elements[sel] = hidden();
  elements['#prefs-sheet'] = hidden();
  elements['#prefs-btn'] = spied();
  elements['#prefs-close'] = spied();
  elements['#prefs-panel-on-focus'] = spied();
  const section = control();
  elements['#prefs-hotkeys'] = section;
  elements['#hotkeys-list'] = listHost();
  elements['#search-pills'] = listHost();
  elements['#search-slices'] = listHost();
  elements['#search-chip'] = spied(hidden());
  elements['#graph-view'] = control();
  const storage = { 'kanban.kanban.view.mode': 'board', ...stored };
  const page = await loadPage({ board, stored: storage, elements, documentExtras: { createElement: () => control() } }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const list = elements['#hotkeys-list'];
  const sheet = elements['#prefs-sheet'];
  const s = {
    page, elements, stored: storage, list, sheet, section,
    gear: elements['#prefs-btn'],
    rows: () => list.children,
    ids: () => list.children.map((row) => row.dataset.hotkey),
    keysOf: (row) => row.children[0].children.map((k) => k.textContent),
    whatOf: (row) => row.children[1].textContent,
    stateOf: (id) => {
      const row = list.children.find((r) => r.dataset.hotkey === id);
      assert.ok(row, `a row for ${id}`);
      return row.children[2] ? row.children[2].textContent : null;
    },
    isOpen: () => !sheet.classList.contains('hidden'),
    clickGear: () => elements['#prefs-btn'].fire('click', {}),
    key: (key, init = {}) => {
      let prevented = 0;
      page.fireDocument('keydown', { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: key === '?', repeat: false, preventDefault() { prevented++; }, ...init });
      return prevented;
    },
    type: (text) => page.input.typed(text),
    focusOn: (el) => { page.ctx.document.activeElement = el; },
  };
  return s;
}

const SURFACES = { menu: '#context-menu:not(.hidden)', dialog: '.modal-backdrop:not(.hidden)', notifications: '#notif-modal:not(.hidden)', preferences: '#prefs-sheet:not(.hidden)' };
const withSurface = (s, name) => {
  const orig = s.page.ctx.document.querySelector;
  s.page.ctx.document.querySelector = (sel) => (sel === SURFACES[name] ? control() : orig(sel));
};
const button = () => ({ tagName: 'BUTTON', isContentEditable: false, focus() {} });
const DEFAULT_STATES = {
  names: 'names: relevant', slice: 'slice: all', pill: 'pill: off', isolate: 'isolate: off', panel: 'panel on focus: on',
};

// --- the list ---------------------------------------------------------------------------------------

test('the gear opens the sheet with one row per hotkey, in the list\'s order, each with its keys and what it does', async () => {
  const s = await open();
  assert.strictEqual(s.rows().length, 0, 'nothing is drawn before the sheet is opened');
  s.clickGear();
  assert.strictEqual(s.isOpen(), true);
  assert.deepStrictEqual(s.ids(), HOTKEYS.map((h) => h.id));
  const expected = hotkeyRows({});
  s.rows().forEach((row, at) => {
    assert.deepStrictEqual(s.keysOf(row), expected[at].keys, expected[at].id);
    assert.strictEqual(s.whatOf(row), expected[at].what, expected[at].id);
  });
});

test('every key the page answers has a row on the page, so the list on the page is the list in hotkeys.js', async () => {
  const s = await open();
  s.clickGear();
  const shown = s.rows().flatMap((row) => s.keysOf(row));
  for (const key of ['/', 'Ctrl/Cmd+F', 'Esc', 'Enter', 'Space', 'Ctrl/Cmd+S', 'Alt+Enter', 'n', 'e', 'a', 'd d', 'l', '[', ']', '{', '}', 'm', 'i', 'p', '?']) {
    assert.ok(shown.includes(key), key);
  }
});

test('opening the sheet again draws no second list: the rows are the same rows', async () => {
  const s = await open();
  s.clickGear();
  const first = [...s.rows()];
  assert.strictEqual(first.length, HOTKEYS.length);
  s.sheet.classList.add('hidden');
  s.clickGear();
  assert.strictEqual(s.rows().length, first.length);
  s.rows().forEach((row, at) => assert.strictEqual(row, first[at]));
});

// --- the ? key --------------------------------------------------------------------------------------

test('? opens the sheet on its Hotkeys page, stops the browser\'s own response, and marks the gear expanded', async () => {
  const s = await open();
  assert.strictEqual(s.key('?'), 1);
  assert.strictEqual(s.isOpen(), true);
  assert.strictEqual(s.gear.attrs['aria-expanded'], 'true');
  assert.strictEqual(s.page.run('settingsUi.page'), 'browser:hotkeys', 'the sheet shows its Hotkeys page');
  assert.deepStrictEqual(s.ids(), HOTKEYS.map((h) => h.id), 'the list is there when the sheet shows');
});

test('? works with nothing focused and with focus on a button, and with the search panel open, which is no popup for the key', async () => {
  for (const el of [null, button()]) {
    const s = await open();
    s.focusOn(el);
    assert.strictEqual(s.key('?'), 1);
    assert.strictEqual(s.isOpen(), true);
  }
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  assert.strictEqual(s.key('?'), 1);
  assert.strictEqual(s.isOpen(), true);
});

test('? does nothing while typing in a field: an input, a text area, a select, an editable element or the search box', async () => {
  const s = await open();
  for (const el of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }, s.page.input]) {
    s.focusOn(el);
    assert.strictEqual(s.key('?'), 0, el.tagName);
    assert.strictEqual(s.isOpen(), false, el.tagName);
  }
  assert.strictEqual(s.page.run('settingsUi.page'), null);
});

test('? does nothing while a card menu, a dialog, the notifications panel or the preferences sheet itself is up', async () => {
  for (const name of Object.keys(SURFACES)) {
    const s = await open();
    withSurface(s, name);
    s.focusOn(button());
    assert.strictEqual(s.key('?'), 0, name);
    assert.strictEqual(s.isOpen(), false, name);
    assert.strictEqual(s.page.run('settingsUi.page'), null, name);
  }
});

test('? with Ctrl, Cmd or Alt held, or held down, does nothing, and neither does another key', async () => {
  const s = await open();
  s.focusOn(button());
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) {
    assert.strictEqual(s.key('?', init), 0, JSON.stringify(init));
  }
  for (const key of ['h', '??', '¿']) assert.strictEqual(s.key(key), 0, key);
  assert.strictEqual(s.isOpen(), false);
});

test('/ still focuses the search box: the ? handler does not take the key a US keyboard types it with', async () => {
  const s = await open();
  let focused = 0;
  s.page.input.focus = () => { focused++; };
  assert.strictEqual(s.key('/'), 1);
  assert.strictEqual(focused, 1);
  assert.strictEqual(s.isOpen(), false);
});

// --- the state of the keys that have one ---------------------------------------------------------

test('with nothing changed, each key that has a state shows its default', async () => {
  const s = await open();
  s.clickGear();
  for (const [id, text] of Object.entries(DEFAULT_STATES)) assert.strictEqual(s.stateOf(id), text, id);
  for (const id of s.ids().filter((id) => !(id in DEFAULT_STATES))) assert.strictEqual(s.stateOf(id), null, `${id} has no state`);
});

test('names shows the tier fan\'s names option the board keeps', async () => {
  for (const names of ['all', 'none']) {
    const s = await open({ stored: { 'kanban.kanban.graph.options': JSON.stringify({ names }) } });
    s.clickGear();
    assert.strictEqual(s.stateOf('names'), `names: ${names}`, names);
  }
});

test('pill shows the pill that is on: the m key turns the first one on, and Shift+m back off', async () => {
  const s = await open();
  s.key('m');
  s.clickGear();
  assert.strictEqual(s.stateOf('pill'), 'pill: blocked');
  s.sheet.classList.add('hidden');
  s.key('m');
  s.clickGear();
  assert.strictEqual(s.stateOf('pill'), 'pill: review');
  s.sheet.classList.add('hidden');
  s.key('M', { shiftKey: true });
  s.key('M', { shiftKey: true });
  s.clickGear();
  assert.strictEqual(s.stateOf('pill'), 'pill: off');
});

test('slice shows the cut the box holds, as a click on the slice section would write it', async () => {
  const s = await open();
  s.type('slice:goal');
  s.clickGear();
  assert.strictEqual(s.stateOf('slice'), 'slice: goal');
  s.sheet.classList.add('hidden');
  s.type('slice:goal..epic');
  s.clickGear();
  assert.strictEqual(s.stateOf('slice'), 'slice: ..epic', 'a run that reaches the top of the list leaves that end open, as the section writes it');
  s.sheet.classList.add('hidden');
  s.type('slice:epic..');
  s.clickGear();
  assert.strictEqual(s.stateOf('slice'), 'slice: epic..');
  s.sheet.classList.add('hidden');
  s.type('');
  s.clickGear();
  assert.strictEqual(s.stateOf('slice'), 'slice: all');
});

test('isolate shows on while isolate is on: the i key turns it on for a selection, and off again', async () => {
  const s = await open();
  s.key('m');
  assert.strictEqual(s.key('i'), 1);
  s.clickGear();
  assert.strictEqual(s.stateOf('isolate'), 'isolate: on');
  s.sheet.classList.add('hidden');
  assert.strictEqual(s.key('i'), 1);
  s.clickGear();
  assert.strictEqual(s.stateOf('isolate'), 'isolate: off');
});

test('panel on focus shows the switch the arrow and the p key flip, which is the stored choice', async () => {
  const s = await open();
  assert.strictEqual(s.key('p'), 1);
  s.clickGear();
  assert.strictEqual(s.stateOf('panel'), 'panel on focus: off');
  s.sheet.classList.add('hidden');
  assert.strictEqual(s.key('p'), 1);
  s.clickGear();
  assert.strictEqual(s.stateOf('panel'), 'panel on focus: on');
  const off = await open({ stored: { 'kanban.kanban.prefs': JSON.stringify({ panelOnFocus: false }) } });
  off.clickGear();
  assert.strictEqual(off.stateOf('panel'), 'panel on focus: off', 'a choice kept from an earlier visit');
});

// --- the list follows the state while the sheet is up ------------------------------------------------

test('with the sheet up, choosing that the panel opens on focus changes its row, and the rows stay the same rows', async () => {
  const s = await open();
  s.clickGear();
  const before = [...s.rows()];
  const box = s.elements['#prefs-panel-on-focus'];
  const change = { target: { checked: false } };
  box.fire('change', change);
  s.sheet.fire('change', change); // the change event bubbles from the checkbox to the sheet
  assert.strictEqual(s.stateOf('panel'), 'panel on focus: off');
  s.rows().forEach((row, at) => assert.strictEqual(row, before[at]));
  const back = { target: { checked: true } };
  box.fire('change', back);
  s.sheet.fire('change', back);
  assert.strictEqual(s.stateOf('panel'), 'panel on focus: on');
});

test('a state changed while the sheet was down shows at the next opening, by the gear and by ?, in the same rows', async () => {
  const s = await open();
  s.clickGear();
  const rows = [...s.rows()];
  s.sheet.classList.add('hidden');
  s.key('p');
  s.type('slice:epic');
  s.key('?');
  assert.strictEqual(s.stateOf('panel'), 'panel on focus: off');
  assert.strictEqual(s.stateOf('slice'), 'slice: epic');
  s.rows().forEach((row, at) => assert.strictEqual(row, rows[at]));
});
