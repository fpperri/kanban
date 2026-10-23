const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// Isolate in the real page (helpers/page-vm.js runs every script the page loads in one vm).
// The switch at the foot of the search panel, and the i key, write the selection into the
// search box as `part | part | ...` and remember the text the box held; turning it off, with
// the switch or with Esc, gives that text back. While it is on every view shows only the
// matches (the Graph included), clicks move the anchor and leave the box alone, and the closed
// box's chip says isolated. The pure parts are pinned in search-isolate.test.js,
// selection-isolate.test.js and graph-isolate.test.js; the browser runner looks at the page
// itself (scenarios/isolate.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Cards 1 to 6 are live. 2 waits for 1 and 3 is under it, so the path through 1 is 1, 2 and 3.
// 7 and 8 are archived and out of every view until a view's Archive pill is on.
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
  archived: [
    card(7, { title: 'Spike zephyr pooling', status: 'done', archived: true, waiting_for: [1] }),
    card(8, { title: 'Close out the audit', status: 'done', archived: true, tags: ['ui'] }),
  ],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
// A control that remembers the attributes the page sets on it and its text.
const spied = (el = control()) => {
  el.attrs = {};
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  let text = '';
  Object.defineProperty(el, 'textContent', { configurable: true, get: () => text, set: (v) => { text = String(v); } });
  return el;
};

// `typing` is whether the Board's Typing isolates is on, and `prefs` adds to the browser's preferences for the board. Most of what follows is about the switch
// and a box that does not isolate by itself, so it is off here; the tests of typing turning isolate
// on say `typing: true`.
async function open({ view = 'board', stored = {}, board = makeBoard(), typing = false, prefs = {}, search = '' } = {}) {
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  elements['#search-pills'] = control();
  elements['#graph-view'] = control();
  elements['#isolate-switch'] = spied();
  elements['#search-chip'] = spied(hidden());
  elements['#search-panel-toggle'] = spied();
  elements['#search-pills-fold'] = spied();
  elements['#toast'] = spied(hidden());
  const kept = { 'kanban.kanban.view.mode': view, 'kanban.kanban.prefs': JSON.stringify({ typingIsolates: { board: typing }, ...prefs }), ...stored };
  const page = await loadPage({ board, search, stored: kept, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const sortedIds = (set) => [...set].map(Number).sort((a, b) => a - b);
  const switchEl = elements['#isolate-switch'];
  const chipEl = elements['#search-chip'];
  const s = {
    page, board, elements, switchEl, chipEl, kept,
    box: () => page.input.value,
    type: (text) => page.input.typed(text),
    view: () => page.run('loadViewMode()'),
    ids: () => sortedIds(page.run('selectedIds')),
    shown: () => sortedIds(page.run('shownCardIds()')),
    drawn: () => sortedIds(page.run('graphCur.model.nodes.map((n) => n.id)')),
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    isolate: () => JSON.parse(JSON.stringify(page.run('isolateNow()'))),
    pick: (...parts) => page.run(`setSelection(${parts.reduce((sel, p) => `addPart(${sel}, ${p})`, 'NO_SELECTION')}, null)`),
    flip: () => switchEl.fire('click', { preventDefault() {} }),
    key: (key, mods = {}) => {
      let prevented = 0;
      page.fireDocument('keydown', { key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, preventDefault() { prevented++; }, ...mods });
      return prevented;
    },
    toast: () => elements['#toast'].textContent,
    focusOn: (el) => { page.ctx.document.activeElement = el; },
    // One Esc as a browser sends it: the box's own listeners first, the document's unless one stops
    // the key, and then the browser's own default, which clears a search field unless prevented.
    press: (inBox = false) => {
      const target = inBox ? page.input : null;
      page.ctx.document.activeElement = target;
      let stopped = false;
      const e = { key: 'Escape', target, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, stopPropagation() { stopped = true; } };
      if (inBox) page.input.fire('keydown', e);
      if (!stopped) (page.documentListeners.keydown || []).slice().forEach((fn) => fn(e));
      if (inBox && !e.defaultPrevented) page.input.typed('');
      return e;
    },
    pillClick: (key, init = {}) => {
      const button = { dataset: { pillKey: key }, closest: (sel) => (sel === '.query-pill' ? button : null) };
      elements['#search-pills'].fire('click', { target: button, shiftKey: false, preventDefault() {}, ...init });
    },
    ctrlClick: (id) => page.fireDocument('click', { target: cardTarget(id), detail: 1, shiftKey: false, ctrlKey: true, metaKey: false }),
    click: (id, m = {}) => page.fireDocument('click', { target: cardTarget(id), detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...m }),
    nodeClick: (id, m = {}) => elements['#graph-view'].fire('click', nodeEvent(id, m)),
    emptyClick: (detail = 1, inGraph = true) => {
      const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '#graph-view' && inGraph ? {} : null) : harmless(String(key))) });
      page.fireDocument('click', { target, detail, shiftKey: false, ctrlKey: false, metaKey: false });
    },
    poll: () => page.run('autoRefreshTick()'),
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

const a = (id) => ({ kind: 'card', id: String(id) });
const q = (text) => ({ kind: 'query', text });
const typed = (text) => ({ kind: 'query', text, source: 'typing' });

// --- turning it on and off -------------------------------------------------------------------

test('the switch writes the selection into the box as a query, and the Board shows only those cards', async () => {
  const s = await open();
  s.ctrlClick(2);
  s.ctrlClick(5);
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
  s.flip();
  assert.strictEqual(s.box(), '#2 | #5');
  assert.deepStrictEqual(s.shown(), [2, 5]);
  assert.deepStrictEqual(s.isolate(), { previous: '#2 | #5' }, 'the box already showed the selection, so that is the text it gives back');
});

test('a path, a tree and a query are written as their criterion, not as a list of the cards they reach', async () => {
  const s = await open();
  s.pick('cardPart(4)', 'pathPart(1)', "queryPart('tags:ui')");
  s.flip();
  assert.strictEqual(s.box(), '#4 | path:1 | tags:ui');
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5], 'the card, the path through 1, and the tag; card 8 is archived');
});

test('a card that comes to match a query part joins on the next poll', async () => {
  const s = await open();
  s.pick('cardPart(4)', "queryPart('tags:ui')");
  s.flip();
  assert.deepStrictEqual(s.shown(), [2, 4, 5]);
  s.board.active.find((c) => c.id === 6).tags.push('ui');
  await s.poll();
  assert.deepStrictEqual(s.shown(), [2, 4, 5, 6]);
  assert.strictEqual(s.box(), '#4 | tags:ui', 'the box was not rewritten: its criterion did the work');
});

test('turning it off gives the box back the text it held before', async () => {
  const s = await open();
  s.ctrlClick(1);
  s.type('zephyr');
  s.flip();
  assert.strictEqual(s.box(), '#1');
  assert.deepStrictEqual(s.isolate(), { previous: 'zephyr' });
  s.flip();
  assert.strictEqual(s.box(), 'zephyr');
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [] }, 'the selection is as it was');
});

test('the switch reports its state to assistive technology, and is a switch', async () => {
  const s = await open();
  s.ctrlClick(1);
  assert.strictEqual(s.switchEl.attrs['aria-checked'], 'false');
  s.flip();
  assert.strictEqual(s.switchEl.attrs['aria-checked'], 'true');
  s.flip();
  assert.strictEqual(s.switchEl.attrs['aria-checked'], 'false');
});

test('with nothing selected and nothing in the box the switch does nothing but say so: isolate is a query in the box, and there is none to write', async () => {
  const s = await open();
  s.flip();
  assert.strictEqual(s.box(), '');
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.switchEl.attrs['aria-checked'], 'false');
  assert.match(s.toast(), /nothing is selected/i);
});

test('with nothing selected, a query the box only lights is isolated as it stands: the box starts to hide what it does not match, and turning isolate off keeps it', async () => {
  const s = await open();
  s.type('tags:ui');
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6], 'the box lights its matches and hides nothing');
  s.flip();
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.isolate(), { previous: 'tags:ui', following: true });
  assert.strictEqual(s.switchEl.attrs['aria-checked'], 'true');
  assert.deepStrictEqual(s.shown(), [2, 5]);
  s.flip();
  assert.strictEqual(s.box(), 'tags:ui');
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
});

test('a box that holds only a cut has no query to isolate, and the switch says so', async () => {
  const s = await open();
  s.type('slice:0');
  s.flip();
  assert.strictEqual(s.isolate(), null);
  assert.match(s.toast(), /nothing is selected/i);
});

test('a selection of a query that is not a term yet has nothing to write either', async () => {
  const s = await open();
  s.pick("queryPart('status:')");
  s.flip();
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), '');
});

test('the run of slices the box held stays, and a cut moved while isolated is kept when isolate goes off', async () => {
  const s = await open();
  s.type('tags:ui slice:0');
  s.pick('cardPart(2)', 'cardPart(5)');
  s.flip();
  assert.strictEqual(s.box(), '(#2 | #5) slice:0');
  s.page.run("writeSearch(searchSetSlice($('#search-input').value, '0..1'), 'slice')");
  assert.strictEqual(s.box(), '(#2 | #5) slice:0..1');
  s.flip();
  assert.strictEqual(s.box(), 'tags:ui slice:0..1');
});

// --- the i key -------------------------------------------------------------------------------

test('the i key turns isolate on and off', async () => {
  const s = await open();
  s.ctrlClick(2);
  assert.strictEqual(s.key('i'), 1, 'the key is taken');
  assert.strictEqual(s.box(), '#2');
  assert.notStrictEqual(s.isolate(), null);
  s.key('I');
  assert.strictEqual(s.box(), '#2', 'Caps Lock gives a capital I, which counts, and the box gets back the card the Ctrl-click showed in it');
  assert.strictEqual(s.isolate(), null);
});

test('the i key does nothing while a field has focus, a menu, a dialog, the notifications panel or the preferences sheet is up, or a chord or Shift is held', async () => {
  const s = await open();
  s.ctrlClick(2);
  s.focusOn({ tagName: 'INPUT' });
  s.key('i');
  s.focusOn({ tagName: 'TEXTAREA' });
  s.key('i');
  s.focusOn({ tagName: 'SELECT' });
  s.key('i');
  s.focusOn(null);
  assert.strictEqual(s.isolate(), null, 'a field keeps its i');
  const doc = s.page.ctx.document;
  const probe = doc.querySelector;
  for (const surface of ['#context-menu:not(.hidden)', '.modal-backdrop:not(.hidden)', '#notif-modal:not(.hidden)', '#prefs-sheet:not(.hidden)']) {
    doc.querySelector = (sel) => (sel === surface ? control() : probe(sel));
    s.key('i');
    doc.querySelector = probe;
    assert.strictEqual(s.isolate(), null, surface);
  }
  for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
    assert.strictEqual(s.key('i', mods), 0, JSON.stringify(mods));
    assert.strictEqual(s.isolate(), null, JSON.stringify(mods));
  }
  assert.strictEqual(s.box(), '#2', 'the box shows the card the Ctrl-click picked, and nothing wrote it again');
});

test('the i key works with the search panel open, as p and m do', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  s.ctrlClick(2);
  s.key('i');
  assert.notStrictEqual(s.isolate(), null);
});

// --- Esc: isolate off, then the additions, then the anchor ---------------------------------

test('Esc away from the box turns isolate off and gives the box its text back; the next Esc drops the additions; the next the anchor', async () => {
  const s = await open();
  s.type('zephyr');
  s.pick('cardPart(1)', 'cardPart(2)', 'cardPart(3)');
  s.flip();
  assert.strictEqual(s.box(), '#1 | #2 | #3', 'the box hid nothing, so the selection holds all three and the text of the box is not kept');
  s.press();
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), 'zephyr');
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2), a(3)] }, 'only isolate went');
  s.press();
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [] });
  assert.strictEqual(s.box(), 'zephyr');
  s.press();
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), 'zephyr');
});

test('the pills a step drops go out of the box on the later stages, as they did without isolate', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  s.pillClick('review');
  s.page.run('setSearchPanelOpen(false)');
  s.pick("queryPart('review:')", 'cardPart(3)');
  s.flip();
  assert.strictEqual(s.box(), 'review: | #3', 'the pill hid nothing, so the card joins the pill and the text of the box is not kept');
  s.press();
  assert.strictEqual(s.box(), 'review:', 'isolate off: the box is what it was');
  s.press();
  assert.strictEqual(s.box(), 'review:', 'the additions go; the pill is the anchor');
  s.press();
  assert.strictEqual(s.box(), '', 'the anchor goes, and its query with it');
});

test('with the panel open and isolate on, the first Esc closes the panel and the second turns isolate off', async () => {
  const s = await open();
  s.ctrlClick(1);
  s.type('zephyr');
  s.flip();
  s.page.run('setSearchPanelOpen(true)');
  s.page.ctx.document.activeElement = s.page.input;
  s.press(true);
  assert.strictEqual(s.page.run('searchPanelIsOpen()'), false, 'the first Esc closed the panel');
  assert.notStrictEqual(s.isolate(), null, 'and left isolate on');
  assert.strictEqual(s.box(), '#1', 'and left the box as it was, which the browser\'s own Esc would have cleared');
  s.press(true);
  assert.strictEqual(s.isolate(), null, 'the second turned it off');
  assert.strictEqual(s.box(), 'zephyr', 'and gave the box its text back, which a clear would not');
});

test('Esc in the box while isolated turns isolate off, like Esc elsewhere, instead of clearing the box', async () => {
  const s = await open();
  s.ctrlClick(1);
  s.type('zephyr');
  s.flip();
  s.press(true);
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), 'zephyr');
  s.press(true);
  assert.strictEqual(s.box(), '', 'with isolate off, Esc in the box clears it as it always did');
});

test('with nothing selected, Esc turns isolate off all the same', async () => {
  const s = await open();
  s.ctrlClick(1);
  s.flip();
  s.click(2);
  s.page.ctx.openCard = () => {};
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, 'a plain click on the Board opens a card and empties the selection');
  assert.strictEqual(s.box(), '#1', 'and leaves the box alone');
  s.press();
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), '#1', 'isolate off gives back the text the box held before, which showed the card the Ctrl-click picked');
  s.press();
  assert.strictEqual(s.box(), '', 'and with nothing picked the next Esc clears it');
});

// --- clicks and edits while isolated ----------------------------------------------------------

test('in the Graph only the matches are drawn, with the selection lit', async () => {
  const s = await open({ view: 'graph' });
  const before = s.drawn();
  assert.deepStrictEqual(before, [1, 2, 3, 4, 5, 6]);
  s.nodeClick(2);
  s.nodeClick(5, { shiftKey: true });
  s.pick('cardPart(2)', 'cardPart(5)', 'pathPart(4)');
  s.flip();
  assert.strictEqual(s.box(), '#2 | #5 | path:4');
  assert.deepStrictEqual(s.drawn(), [2, 4, 5]);
  s.flip();
  assert.deepStrictEqual(s.drawn(), before, 'the Graph draws all of them again');
});

test('in the Graph a plain click on a shown card moves the anchor and leaves the box and the shown cards', async () => {
  const s = await open({ view: 'graph' });
  s.pick('cardPart(2)', 'cardPart(5)');
  s.flip();
  s.nodeClick(5);
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [] });
  assert.strictEqual(s.box(), '#2 | #5', 'a plain click clears the box when nothing is isolated, and not now');
  assert.deepStrictEqual(s.drawn(), [2, 5]);
  assert.notStrictEqual(s.isolate(), null);
});

test('in the Graph a click on the empty canvas, and a double click, leave the selection and the shown cards', async () => {
  const s = await open({ view: 'graph' });
  s.pick('cardPart(2)', 'cardPart(5)');
  s.flip();
  s.emptyClick(1);
  s.emptyClick(1);
  s.emptyClick(2);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(5)] });
  assert.strictEqual(s.box(), '#2 | #5');
  assert.deepStrictEqual(s.drawn(), [2, 5]);
});

test('on the Board a double click on empty space leaves the selection while isolated, and clears it when it is not', async () => {
  const s = await open();
  s.pick('cardPart(2)', 'cardPart(5)');
  s.flip();
  s.emptyClick(2, false);
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(5)] });
  s.flip();
  s.emptyClick(2, false);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

test('a click on the switch never clears the selection, even the second click of a double click that turns isolate off', async () => {
  const s = await open();
  s.pick('cardPart(2)', 'cardPart(5)');
  const marked = { dataset: {} };
  const onSwitch = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '[data-keeps-selection]' ? marked : null) : harmless(String(key))) });
  s.flip();
  s.page.fireDocument('click', { target: onSwitch, detail: 1, shiftKey: false, ctrlKey: false, metaKey: false });
  s.flip();
  s.page.fireDocument('click', { target: onSwitch, detail: 2, shiftKey: false, ctrlKey: false, metaKey: false });
  assert.strictEqual(s.isolate(), null, 'the second click turned isolate off, so the selection was the only thing the marker had to keep');
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(5)] });
});

test('isolating a search typed in the Graph makes it a bracketed query part, and turning isolate off gives the box and the typed anchor back', async () => {
  const s = await open({ view: 'graph' });
  s.type('move the');
  assert.deepStrictEqual(s.selection(), { anchor: typed('move the'), additions: [] });
  s.nodeClick(5, { shiftKey: true });
  s.flip();
  assert.strictEqual(s.box(), '(move the) | #5');
  assert.deepStrictEqual(s.drawn(), [2, 5]);
  s.flip();
  assert.strictEqual(s.box(), '(move the) | #5', 'the box held the query and the card the Shift-click added, as the click wrote them');
  assert.deepStrictEqual(s.selection(), { anchor: typed('move the'), additions: [a(5)] });
});

test('a search typed in the Graph while isolated edits the isolate text; it does not become the anchor over the selection', async () => {
  const s = await open({ view: 'graph' });
  s.pick('cardPart(2)', 'cardPart(5)');
  s.flip();
  s.type('#2 | #5 | #4');
  assert.deepStrictEqual(s.selection(), { anchor: a(2), additions: [a(5)] });
  assert.deepStrictEqual(s.drawn(), [2, 4, 5], 'the edited query is what is shown');
  assert.notStrictEqual(s.isolate(), null, 'isolate stays on while the box holds a query');
});

test('a keystroke typed at the end of the box after isolating keeps the text\'s leading #', async () => {
  const s = await open();
  s.ctrlClick(3);
  s.flip();
  assert.strictEqual(s.box(), '#3');
  s.type('#3x');
  assert.strictEqual(s.box(), '#3x', 'a lone card as the isolate text is not an id still being typed');
});

test('typed by hand with nothing isolated, a # followed by a letter still loses the #', async () => {
  const s = await open();
  s.type('#3x');
  assert.strictEqual(s.box(), '3x');
});

test('isolate ends when the box is cleared: there is no query left to be an isolate', async () => {
  const s = await open();
  s.ctrlClick(2);
  s.flip();
  s.page.clear.fire('click', {});
  assert.strictEqual(s.box(), '');
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.switchEl.attrs['aria-checked'], 'false');
  assert.strictEqual(s.chipEl.classList.contains('hidden'), true);
});

test('isolate stays on across a view switch, and the box and the shown cards stay with it', async () => {
  const s = await open();
  s.pick('cardPart(2)', 'cardPart(5)');
  s.flip();
  for (const view of ['map', 'graph', 'board']) {
    s.page.run(`toggleView('${view === 'board' ? s.view() : view}')`);
    assert.strictEqual(s.box(), '#2 | #5', view);
    assert.notStrictEqual(s.isolate(), null, view);
  }
  assert.deepStrictEqual(s.shown(), [2, 5]);
});

test('entering the Graph while isolated with nothing selected does not make the isolate text the anchor', async () => {
  const s = await open();
  s.pick('cardPart(2)', 'cardPart(5)');
  s.flip();
  s.page.run('setSelection(NO_SELECTION, null)');
  s.page.run("toggleView('graph')");
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
});

// --- the chip -----------------------------------------------------------------------------------

test('with the panel closed and isolate on, the chip says isolated, in its text and its name', async () => {
  const s = await open();
  assert.strictEqual(s.chipEl.classList.contains('hidden'), true, 'no chip with nothing on');
  s.ctrlClick(2);
  s.flip();
  assert.strictEqual(s.chipEl.classList.contains('hidden'), false);
  assert.strictEqual(s.chipEl.textContent, 'isolated');
  assert.match(s.chipEl.attrs['aria-label'], /isolated/);
  assert.match(s.chipEl.title, /isolated/);
  s.flip();
  assert.strictEqual(s.chipEl.classList.contains('hidden'), true);
});

test('the chip names the pills and the cut that are on beside isolate', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  s.pillClick('review');
  s.page.run('setSearchPanelOpen(false)');
  s.flip();
  assert.strictEqual(s.chipEl.textContent, 'isolated');
  assert.strictEqual(s.chipEl.attrs['aria-label'], '2 on: review, isolated');
});

// --- the other views ---------------------------------------------------------------------------

test('the Calendar jumps to the isolated card\'s month when none of the isolated cards is on screen', async () => {
  const s = await open();
  s.page.run(`calendarAnchor = '2026-07-15'`);
  s.page.run("toggleView('calendar')");
  s.pick('cardPart(6)');
  assert.strictEqual(s.page.run('calendarAnchor'), '2026-07-15');
  s.flip();
  assert.strictEqual(s.page.run('calendarAnchor'), '2031-06-02');
});

test('the Gantt jumps the same way in a sized sub-view', async () => {
  const s = await open();
  s.page.run(`ganttAnchor = '2026-07-15'`);
  s.page.run(`setGanttSubview('month')`);
  s.page.run("toggleView('gantt')");
  s.pick('cardPart(6)');
  s.flip();
  assert.strictEqual(s.page.run('ganttAnchor'), '2031-06-02');
});

test('the poll never makes the jump: a paged month stays where it was put', async () => {
  const s = await open();
  s.page.run("toggleView('calendar')");
  s.pick('cardPart(6)');
  s.flip();
  s.page.run(`calendarAnchor = '2026-07-15'`);
  await s.poll();
  assert.strictEqual(s.page.run('calendarAnchor'), '2026-07-15');
});

// --- what the box hid stays hidden -------------------------------------------------------

test('outside the Graph the box hides nothing while isolate is off: a path picked beside tags:ui is isolated whole, and the text the box held is given back when isolate goes off', async () => {
  const s = await open();
  s.type('tags:ui');
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6], 'the box lights its matches and hides none');
  s.pick('pathPart(1)');
  assert.deepStrictEqual(s.ids(), [1, 2, 3], 'the path through 1 holds 1, 2 and 3: the box hid none of them');
  s.flip();
  assert.strictEqual(s.box(), 'path:1', 'the text the box held is not kept: it hides nothing for the selection to be held to');
  assert.deepStrictEqual(s.shown(), [1, 2, 3]);
  assert.deepStrictEqual(s.ids(), [1, 2, 3]);
  s.flip();
  assert.strictEqual(s.box(), 'tags:ui', 'turned off, the box has the text it held');
});

test('a card picked by hand stays in the selection when the box is typed into, since the box hides nothing, and isolate writes the cards alone', async () => {
  const s = await open();
  s.ctrlClick(4);
  s.ctrlClick(5);
  assert.deepStrictEqual(s.ids(), [4, 5]);
  s.type('tags:ui');
  assert.deepStrictEqual(s.ids(), [4, 5], 'card 4 is not ui, and the box only lights');
  s.flip();
  assert.strictEqual(s.box(), '#4 | #5');
  assert.deepStrictEqual(s.shown(), [4, 5]);
});

test('a pill is an alternative of the box and the text isolate writes is just the pill', async () => {
  const s = await open();
  s.pillClick('review');
  s.flip();
  assert.strictEqual(s.box(), 'review:');
});

test('in the Graph the typed text only lights, so it does not join the isolate text beside a card', async () => {
  const s = await open({ view: 'graph' });
  s.type('tags:ui');
  s.nodeClick(4, { shiftKey: true });
  s.flip();
  assert.strictEqual(s.box(), 'tags:ui | #4');
});

// --- a click on a card and the pills' queries in the box ---------------------------------
// A pill is on while its query is the anchor or an addition, so a click that drops it from the
// selection (a plain click that selects another card) takes its query out of the box too, as Esc
// and a double click on empty space do. A plain click that opens a card drops no pill: opening a
// card changes no filter (open-keeps-pills.test.js). While isolated a click moves the anchor only,
// and the box holds the isolate text, which it never touches.

const opens = () => {
  const s = [];
  return { calls: s, wrap: (page) => { page.ctx.openCard = (id) => { s.push(Number(id)); }; } };
};

test('a plain click that opens a card keeps the pill on and its query in the box, with the text typed beside it', async () => {
  const s = await open();
  const spy = opens();
  spy.wrap(s.page);
  s.type('zephyr');
  s.pillClick('review');
  assert.strictEqual(s.box(), 'zephyr | review:');
  s.click(1);
  assert.deepStrictEqual(spy.calls, [1], 'the card opens');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.strictEqual(s.box(), 'zephyr | review:', 'the pill is still on and its query is still in the box');
});

test('a pill that is the only text in the box stays with the selection, so the view behind the card is filtered by a pill that shows on', async () => {
  const s = await open({ typing: true });
  const spy = opens();
  spy.wrap(s.page);
  s.pillClick('review');
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.shown(), [5]);
  s.click(5);
  assert.strictEqual(s.box(), 'review:');
  assert.deepStrictEqual(s.shown(), [5]);
  assert.deepStrictEqual(spy.calls, [5]);
});

test('a plain click in a view that selects drops a pill from the box too', async () => {
  const s = await open({ prefs: { click: { board: 'selects' } } });
  s.pillClick('review');
  s.click(3);
  assert.deepStrictEqual(s.selection(), { anchor: a(3), additions: [] });
  assert.strictEqual(s.box(), '#3');
});

test('a Ctrl-click that takes out a card the pill lit turns the pill into its other cards, which the box names: the view does not widen under the click', async () => {
  const board = makeBoard();
  board.active[5].review = 'second';
  const s = await open({ board });
  s.pillClick('review');
  assert.deepStrictEqual(s.ids(), [5, 6]);
  s.ctrlClick(5);
  assert.deepStrictEqual(s.selection(), { anchor: a(6), additions: [] }, 'the pill is its other card now');
  assert.strictEqual(s.box(), '#6');
});

test('a click that keeps the pill and adds to the selection writes the card beside the pill\'s query', async () => {
  const s = await open();
  s.pillClick('review');
  s.ctrlClick(3);
  assert.strictEqual(s.box(), 'review: | #3', 'Ctrl on a card the box hides adds it, and the pill stays');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [a(3)] });
  s.click(5, { shiftKey: true });
  assert.strictEqual(s.box(), 'review: | #3', 'a range that adds nothing (card 5 is the pill\'s already) leaves the text as it was');
});

test('while isolated a click that opens a card leaves the isolate text and the pills in the selection', async () => {
  const s = await open();
  const spy = opens();
  spy.wrap(s.page);
  s.pillClick('review');
  s.flip();
  assert.strictEqual(s.box(), 'review:');
  s.click(2);
  assert.deepStrictEqual(spy.calls, [2], 'the card opens');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] });
  assert.strictEqual(s.box(), 'review:', 'the pill query is the isolate text now, and the shown set does not shrink');
  assert.notStrictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.shown(), [5]);
});

test('while isolated a click that selects another card moves the anchor and leaves the isolate text', async () => {
  const s = await open({ prefs: { click: { board: 'selects' } } });
  s.pillClick('review');
  s.flip();
  assert.strictEqual(s.box(), 'review:');
  s.click(5);
  assert.deepStrictEqual(s.selection(), { anchor: a(5), additions: [] });
  assert.strictEqual(s.box(), 'review:', 'the box is the isolate text and a click never writes it');
});

test('a plain click that opens a card repaints when it drops a part that matched nothing, and not when it drops nothing', async () => {
  const s = await open();
  const spy = opens();
  spy.wrap(s.page);
  s.pick('pathPart(99)');
  assert.deepStrictEqual(s.ids(), []);
  let renders = 0;
  const real = s.page.ctx.renderBoard;
  s.page.ctx.renderBoard = (...args) => { renders++; return real(...args); };
  s.click(3);
  assert.strictEqual(renders, 1);
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  renders = 0;
  s.click(3);
  assert.strictEqual(renders, 0, 'nothing was selected and nothing changes');
  s.pick("queryPart('nothing-matches-this')");
  s.click(3);
  assert.strictEqual(renders, 0, 'a pill that matches nothing stays on, so there is nothing to repaint');
  assert.deepStrictEqual(s.selection(), { anchor: q('nothing-matches-this'), additions: [] });
});

// --- a pill whose alternative a cue click has grown ----------------------------------------
// A click on a cue chip (an assignee, a tag, blocked, review) adds its term to every alternative of the
// box, so a pill's `review:` becomes `review: assignee:@human`. The pill is on still, since the selection
// holds its query, and turning it off, or stepping the selection back, takes its alternative out of the
// box as it has grown, not just the bare query, or the view would stay filtered by a pill that shows off.

const withAssignee = () => {
  const board = makeBoard();
  board.active[4].assignee = '@human';
  return board;
};

const cueClick = (s, id, cls, text) => s.page.fireDocument('click', {
  target: { closest: (sel) => (sel === '.card-el' ? { dataset: { id: String(id) } } : sel.includes('.card-assignee') ? { classList: { contains: (c) => c === cls }, textContent: text } : null) },
  detail: 1, shiftKey: false, ctrlKey: false, metaKey: false,
});

test('a cue click grows the pill\'s alternative, the pill stays on, and a click on it takes the whole grown alternative out', async () => {
  const s = await open({ board: withAssignee() });
  s.pillClick('review');
  cueClick(s, 5, 'card-assignee', '@human');
  assert.strictEqual(s.box(), 'review: assignee:@human');
  assert.deepStrictEqual(s.selection(), { anchor: q('review:'), additions: [] }, 'the pill is on still');
  s.pillClick('review');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), '', 'the cue term went with the alternative it grew in');
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
});

test('text typed beside the pill stays when its grown alternative goes, grown by the cue as every alternative is', async () => {
  const s = await open({ board: withAssignee() });
  s.type('zephyr');
  s.pillClick('review');
  cueClick(s, 5, 'card-assignee', '@human');
  assert.strictEqual(s.box(), 'zephyr assignee:@human | review: assignee:@human');
  s.pillClick('review');
  assert.strictEqual(s.box(), 'zephyr assignee:@human');
});

test('Esc steps the selection back and takes the grown alternative of a pill out of the box', async () => {
  const s = await open({ board: withAssignee() });
  s.pillClick('review');
  cueClick(s, 5, 'card-assignee', '@human');
  s.press();
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), '');
});

test('an alternative that only has the pill\'s term in it is not the pill\'s: it stays when another pill goes off', async () => {
  const s = await open({ board: withAssignee() });
  s.pillClick('review');
  s.pillClick('blocked');
  assert.strictEqual(s.box(), 'review: | blocked:');
  s.pillClick('blocked');
  assert.strictEqual(s.box(), 'review:');
});

// --- a board pill whose query is a slice: term ---------------------------------------------
// A cut stands at the top level of the box and ANDs over all of it, so a pill whose own query is a
// slice: term writes a cut, and turning the pill off takes that cut out again, with the pill, the
// way it takes out any other query of its own.

const withSlicePill = () => {
  const board = makeBoard();
  board.hierarchy = ['goal', 'strategy', 'epic'];
  board.types = [{ name: 'epic' }];
  board.active[0].type = 'epic';
  board.active[1].type = 'epic';
  board.pills = [{ label: 'epics', query: 'slice:epic' }];
  return board;
};

test('a pill whose query is a slice: term cuts the views to it, and turning the pill off takes the cut out of the box', async () => {
  const s = await open({ board: withSlicePill() });
  s.page.run('setSearchPanelOpen(true)');
  s.pillClick('pill:slice:epic');
  assert.strictEqual(s.box(), 'slice:epic');
  assert.deepStrictEqual(s.shown(), [1, 2], 'the epics');
  assert.deepStrictEqual(s.selection(), { anchor: q('slice:epic'), additions: [] });
  s.pillClick('pill:slice:epic');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), '', 'the pill is off and so is its cut');
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
});

test('turning such a pill off leaves a cut of the slice section, and the text typed beside it, where they were', async () => {
  const s = await open({ board: withSlicePill() });
  s.page.run('setSearchPanelOpen(true)');
  s.type('zephyr slice:0..');
  s.pillClick('pill:slice:epic');
  s.pillClick('pill:slice:epic');
  assert.strictEqual(s.box(), 'zephyr slice:0..', 'the cut the box held before the pill is not the pill\'s');
});

test('a cut the box held before such a pill goes on stays when the pill goes off, when it is the very cut the pill holds too', async () => {
  const s = await open({ board: withSlicePill() });
  s.page.run('setSearchPanelOpen(true)');
  s.type('slice:epic');
  s.pillClick('pill:slice:epic');
  assert.strictEqual(s.box(), 'slice:epic slice:epic', 'the box holds the cut twice while the pill is on: the one it held and the one the pill wrote');
  assert.deepStrictEqual(s.shown(), [1, 2], 'the pill is on over the cut the box held');
  s.pillClick('pill:slice:epic');
  assert.strictEqual(s.box(), 'slice:epic', 'only the copy of the cut that came with the pill went with it');
  assert.deepStrictEqual(s.shown(), [1, 2], 'the cut the box held still cuts the views');
});

test('Esc takes the cut of such a pill out of the box with the pill', async () => {
  const s = await open({ board: withSlicePill() });
  s.page.run('setSearchPanelOpen(true)');
  s.pillClick('pill:slice:epic');
  s.page.run('setSearchPanelOpen(false)');
  s.press();
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), '');
});

test('Esc leaves a cut the box held before such a pill went on, when it is the very cut the pill holds too', async () => {
  const s = await open({ board: withSlicePill() });
  s.page.run('setSearchPanelOpen(true)');
  s.type('slice:epic');
  s.pillClick('pill:slice:epic');
  s.page.run('setSearchPanelOpen(false)');
  s.press();
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.strictEqual(s.box(), 'slice:epic');
});

// --- typing, a pill, a cue and a link turn isolate on where the view's Typing isolates is on ----
// Outside the Graph the box hides what it does not match only while isolate is on, and a query the
// person makes turns isolate on by itself in a view whose setting is on (on by default in every
// view but the Graph). The pure decisions are pinned in selection-box-hiding.test.js.

const litIds = (s, ids) => ids.filter((id) => s.page.run(`paintsSelected('${id}')`));

test('typing on the Board turns isolate on: the box is the isolate text, the Board shows only its matches, and what isolate off gives back follows the box', async () => {
  const s = await open({ typing: true });
  s.type('tags:ui');
  assert.deepStrictEqual(s.isolate(), { previous: 'tags:ui', following: true });
  assert.strictEqual(s.switchEl.attrs['aria-checked'], 'true');
  assert.deepStrictEqual(s.shown(), [2, 5]);
  s.type('tags:ui status:todo');
  assert.deepStrictEqual(s.shown(), [2]);
  assert.strictEqual(s.isolate().previous, 'tags:ui status:todo');
});

test('turning that isolate off leaves the typed query in the box, lit, and Esc in the box then clears it', async () => {
  const s = await open({ typing: true });
  s.type('tags:ui');
  s.flip();
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(litIds(s, ['1', '2', '3']), ['2']);
  s.press(true);
  assert.strictEqual(s.box(), '');
  assert.deepStrictEqual(litIds(s, ['1', '2', '3']), []);
});

test('Esc in the box while such an isolate is on turns it off and leaves the query, as it does elsewhere; the next Esc clears it', async () => {
  const s = await open({ typing: true });
  s.type('tags:ui');
  s.press(true);
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), 'tags:ui');
  s.press(true);
  assert.strictEqual(s.box(), '');
});

test('emptying the box ends the isolate that typing started, and typing again starts it again', async () => {
  const s = await open({ typing: true });
  s.type('tags:ui');
  s.type('');
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
  s.type('ops');
  assert.deepStrictEqual(s.isolate(), { previous: 'ops', following: true });
  assert.deepStrictEqual(s.shown(), [6]);
});

test('with Typing isolates off the Board lights what is typed and hides nothing: the matches wear the selected look and no card is selected', async () => {
  const s = await open({ typing: false });
  s.type('tags:ui');
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(litIds(s, ['1', '2', '3', '4', '5', '6']), ['2', '5']);
  assert.deepStrictEqual(s.ids(), [], 'a lit card is no selected card: no action reads it');
  s.type('tags:ui status:todo');
  assert.deepStrictEqual(litIds(s, ['2', '5']), ['2']);
});

test('a card that comes to match the lit query is lit on the next poll', async () => {
  const s = await open({ typing: false });
  s.type('tags:ui');
  s.board.active.find((c) => c.id === 6).tags.push('ui');
  await s.poll();
  assert.deepStrictEqual(litIds(s, ['6']), ['6']);
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
});

test('a slice: cut hides whatever isolate is, and the rest of the query lights inside the cut', async () => {
  const s = await open({ typing: false });
  s.type('slice:0');
  assert.strictEqual(s.isolate(), null);
  const cut = s.shown();
  assert.ok(!cut.includes(3), 'card 3 is under card 1, so the cut at the top level leaves it out');
  assert.ok(cut.length < 6, 'and the cut hides with isolate off');
  assert.deepStrictEqual(litIds(s, cut.map(String)), [], 'a cut alone lights nothing');
  s.type('slice:0 tags:ui');
  assert.deepStrictEqual(s.shown(), cut);
  assert.deepStrictEqual(litIds(s, cut.map(String)), ['2', '5']);
});

test('with isolate on the whole query hides in every view that reads the box', async () => {
  const s = await open({ typing: true });
  s.type('tags:ui');
  for (const view of ['map', 'calendar', 'gantt']) {
    s.page.run(`viewMode = '${view}'`);
    assert.deepStrictEqual([...s.page.run('currentSearchMatch().ids')].map(Number).sort((x, y) => x - y), [2, 5, 8], `${view}: the whole board's matches, the archived card 8 among them`);
  }
  s.flip();
  for (const view of ['map', 'calendar', 'gantt']) {
    s.page.run(`viewMode = '${view}'`);
    assert.strictEqual(s.page.run('currentSearchMatch().ids'), null, `${view}: isolate off, the box hides nothing`);
    assert.deepStrictEqual([...s.page.run('currentSearchMatch().matched')].map(Number).sort((x, y) => x - y), [2, 5, 8], `${view}: and still matches`);
  }
});

test('a pill turns isolate on, and so does a cue on a card', async () => {
  const s = await open({ typing: true });
  s.pillClick('review');
  assert.deepStrictEqual(s.isolate(), { previous: 'review:', following: true });
  assert.deepStrictEqual(s.shown(), [5]);
  const t = await open({ typing: true });
  t.page.run("addSearchTerm('tags:ops')");
  assert.deepStrictEqual(t.isolate(), { previous: 'tags:ops', following: true });
  assert.deepStrictEqual(t.shown(), [6]);
});

test('a pill and a cue only light where the view has Typing isolates off', async () => {
  const s = await open({ typing: false });
  s.pillClick('review');
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(litIds(s, ['4', '5']), ['5']);
});

test('a write that is no query of the person turns nothing on: a cut, the Ctrl+F prefill and a menu item', async () => {
  const s = await open({ typing: true });
  s.page.run("writeSearch('slice:0', 'slice')");
  assert.strictEqual(s.isolate(), null);
  s.page.run("writeSearch('tags:ui', 'prefill')");
  assert.strictEqual(s.isolate(), null);
  s.page.run("writeSearch('tags:ui', 'menu')");
  assert.strictEqual(s.isolate(), null);
});

test('a ?q= link turns isolate on in the Board, so it filters as it did', async () => {
  const s = await open({ typing: true, search: '?q=tags%3Aui' });
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.isolate(), { previous: 'tags:ui', following: true });
  assert.deepStrictEqual(s.shown(), [2, 5]);
});

test('a ?q= link into the Graph lights, as it did', async () => {
  const s = await open({ search: '?q=tags%3Aui&view=graph' });
  assert.strictEqual(s.view(), 'graph');
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.drawn(), [1, 2, 3, 4, 5, 6]);
});

test('in the Graph typing lights and leaves isolate off; with the Graph\'s Typing isolates on it isolates, and only the matches are drawn', async () => {
  const s = await open({ view: 'graph' });
  s.type('tags:ui');
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.drawn(), [1, 2, 3, 4, 5, 6]);
  const t = await open({ view: 'graph', prefs: { typingIsolates: { graph: true } } });
  t.type('tags:ui');
  assert.deepStrictEqual(t.isolate(), { previous: 'tags:ui', following: true });
  assert.deepStrictEqual(t.drawn(), [2, 5]);
});

test('going to the Graph ends an isolate the box\'s own query started, and the query is the anchor there; an isolate of the selection stays', async () => {
  const s = await open({ typing: true });
  s.type('tags:ui');
  s.page.run("setView('graph')");
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), 'tags:ui');
  assert.deepStrictEqual(s.selection().anchor, typed('tags:ui'));
  const t = await open({ typing: true });
  t.ctrlClick(2);
  t.flip();
  t.page.run("setView('graph')");
  assert.notStrictEqual(t.isolate(), null);
});

test('a typed query follows the Typing isolates setting of the view on every switch: the Board filters, the Graph lights, and back on the Board it filters again', async () => {
  const s = await open({ typing: true });
  s.type('tags:ui');
  assert.deepStrictEqual(s.shown(), [2, 5]);
  s.page.run("setView('graph')");
  assert.strictEqual(s.isolate(), null);
  s.page.run("setView('board')");
  assert.deepStrictEqual(s.isolate(), { previous: 'tags:ui', following: true });
  assert.deepStrictEqual(s.shown(), [2, 5], 'the Board filters again');
  assert.strictEqual(s.box(), 'tags:ui');
  s.page.run("setView('calendar')");
  assert.deepStrictEqual(s.isolate(), { previous: 'tags:ui', following: true }, 'a view whose setting is on keeps it on');
});

test('a query typed in the Graph filters the Board it is carried to, and ends where the Graph lights again', async () => {
  const s = await open({ view: 'graph', typing: true });
  s.type('tags:ui');
  assert.strictEqual(s.isolate(), null);
  s.page.run("setView('board')");
  assert.deepStrictEqual(s.isolate(), { previous: 'tags:ui', following: true });
  assert.deepStrictEqual(s.shown(), [2, 5]);
  s.page.run("setView('graph')");
  assert.strictEqual(s.isolate(), null);
  assert.deepStrictEqual(s.drawn(), [1, 2, 3, 4, 5, 6]);
});

test('a view whose Typing isolates is off keeps lighting the typed query when it is entered', async () => {
  const s = await open({ typing: true, prefs: { typingIsolates: { board: true, map: false } } });
  s.type('tags:ui');
  s.page.run("setView('map')");
  assert.strictEqual(s.isolate(), null);
  s.page.run("setView('board')");
  assert.notStrictEqual(s.isolate(), null);
  s.page.run("setView('map')");
  assert.strictEqual(s.isolate(), null);
});

test('the picks a click mirrored into the box are not a typed query, so a switch never isolates them', async () => {
  const s = await open({ typing: true });
  s.ctrlClick(2);
  s.ctrlClick(5);
  assert.strictEqual(s.box(), '#2 | #5');
  s.page.run("setView('calendar')");
  s.page.run("setView('graph')");
  s.page.run("setView('board')");
  assert.strictEqual(s.isolate(), null);
  assert.strictEqual(s.box(), '#2 | #5');
  assert.deepStrictEqual(s.shown(), [1, 2, 3, 4, 5, 6]);
});

test('an isolate the switch or the i key turned on stays through every switch, and an empty box or a cut alone isolates nothing', async () => {
  const s = await open({ typing: true });
  s.ctrlClick(2);
  s.flip();
  const on = s.isolate();
  assert.notStrictEqual(on, null);
  s.page.run("setView('graph')");
  s.page.run("setView('board')");
  assert.deepStrictEqual(s.isolate(), on);
  const t = await open({ typing: true });
  t.page.run("setView('graph')");
  t.page.run("setView('board')");
  assert.strictEqual(t.isolate(), null);
  t.type('slice:0..2');
  assert.strictEqual(t.isolate(), null, 'a cut is no query to isolate');
  t.page.run("setView('graph')");
  t.page.run("setView('board')");
  assert.strictEqual(t.isolate(), null);
});

test('a pill typing started on the Board filters it again after a trip to the Graph', async () => {
  const s = await open({ typing: true });
  s.pillClick('review');
  assert.notStrictEqual(s.isolate(), null);
  s.page.run("setView('graph')");
  assert.strictEqual(s.isolate(), null);
  s.page.run("setView('board')");
  assert.deepStrictEqual(s.isolate(), { previous: 'review:', following: true });
});

test('the Typing isolates choice of a view is set by its checkbox, kept per board, and read back', async () => {
  const s = await open({ typing: true });
  const change = (view, checked) => s.page.run(`onTypingIsolatesChange({ target: { closest: () => ({ dataset: { typingView: '${view}' }, checked: ${checked} }) } })`);
  assert.strictEqual(s.page.run("typingIsolatesIn('board')"), true);
  assert.strictEqual(s.page.run("typingIsolatesIn('graph')"), false);
  change('board', false);
  change('graph', true);
  assert.strictEqual(s.page.run("typingIsolatesIn('board')"), false);
  assert.strictEqual(s.page.run("typingIsolatesIn('graph')"), true);
  const kept = JSON.parse(s.kept['kanban.kanban.prefs']);
  assert.deepStrictEqual(kept.typingIsolates, { board: false, map: true, gantt: true, calendar: true, graph: true });
  s.type('tags:ui');
  assert.strictEqual(s.isolate(), null, 'the Board now lights what is typed');
});
