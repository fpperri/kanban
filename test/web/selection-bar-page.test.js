const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement } = require('./helpers/recording-dom');
const { askElements, askDriver } = require('./helpers/ask-page');
const { PHONE_WIDTH_QUERY } = require('../../plugin/skills/web/web/phone-width');

// The selection bar on the phone layout, run through the real page (helpers/page-vm.js): it shows
// the resolved count while anything is selected, and its Clear, Archive, Status and More act on the
// resolved selection through the menu subject the card menu's own bulk entries read. Set status… is
// the card menu's bulk entry the bar's Status shares. Where the bar is drawn, and the room the
// page keeps for it, are selection-bar-markup.test.js's.

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
    card(1, { status: 'doing' }),
    card(2, { status: 'todo' }),
    card(3, { status: 'backlog' }),
    card(4, { status: 'todo', waiting_for: [1] }),
    card(5, { status: 'done' }),
    card(6, { status: 'done' }),
  ],
  archived: [card(7, { status: 'done', archived: true })],
});

const BAR = ['#selection-bar', '#selection-bar-count', '#selection-bar-clear', '#selection-bar-archive', '#selection-bar-status', '#selection-bar-more'];
const MENU = ['#context-menu', '#ctx-peek', '#ctx-add', '#ctx-child', '#ctx-status', '#ctx-assign', '#ctx-priority', '#ctx-tags', '#ctx-schedule', '#ctx-archive', '#ctx-restore', '#ctx-delete',
  '#bulk-single', '#bulk-single-input', '#bulk-single-apply', '#bulk-single-title', '#bulk-archive', '#bulk-archive-title', '#bulk-archive-input', '#bulk-archive-apply', '#bulk-status', '#bulk-status-title', '#bulk-status-close'];

async function open({ phone = true, view = 'board', board = makeBoard() } = {}) {
  const elements = { ...Object.fromEntries([...BAR, ...MENU].map((sel) => [sel, control()])), ...askElements() };
  elements['#bulk-status-list'] = recordingElement('div');
  for (const sel of ['#selection-bar', '#context-menu', '#bulk-single', '#bulk-archive', '#bulk-status']) elements[sel].classList.add('hidden');
  elements['#graph-view'] = control();
  const state = { phone };
  const page = loadPage({ board, stored: { 'kanban.kanban.view.mode': view }, elements, documentExtras: recordingDocument() });
  page.ctx.matchMedia = (q) => ({ get matches() { return q === PHONE_WIDTH_QUERY && state.phone; }, addEventListener() {} });
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const requests = [];
  const realFetch = page.ctx.fetch;
  page.ctx.fetch = (url, opts = {}) => { requests.push([opts.method || 'GET', String(url)]); return realFetch(url, opts); };
  const toasts = [];
  page.ctx.toast = (message) => { toasts.push(message); };
  const ids = () => [...page.run('selectedIds')].map(Number).sort((a, b) => a - b);
  const bar = {
    shown: () => !elements['#selection-bar'].classList.contains('hidden'),
    count: () => elements['#selection-bar-count'].textContent,
    press: async (name) => { elements[`#selection-bar-${name}`].fire('click', { currentTarget: elements[`#selection-bar-${name}`], target: elements[`#selection-bar-${name}`] }); await page.settle(); },
  };
  return {
    page, elements, requests, toasts, bar, ids, ask: askDriver(page, elements),
    select: (...cardIds) => { page.run(`setSelection(${cardIds.reduce((s, id) => `addPart(${s}, cardPart('${id}'))`, 'NO_SELECTION')}); renderBoard()`); },
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    cardRequests: () => requests.filter(([method, url]) => method !== 'GET' && /\/api\/cards\/\d+(\/archive|\/restore)?$/.test(url)).map(([method, url]) => `${method} ${url}`),
    menuOpen: () => !elements['#context-menu'].classList.contains('hidden'),
    popupOpen: (sel) => !elements[sel].classList.contains('hidden'),
  };
}

test('the bar shows "N selected" with the resolved count while anything is selected, and hides when the selection is empty', async () => {
  const s = await open();
  assert.strictEqual(s.bar.shown(), false, 'nothing is selected');
  s.select(2);
  assert.strictEqual(s.bar.shown(), true);
  assert.strictEqual(s.bar.count(), '1 selected');
  s.select(2, 3, 5);
  assert.strictEqual(s.bar.count(), '3 selected');
  s.select();
  assert.strictEqual(s.bar.shown(), false);
});

test('the count is the resolved selection: a path part counts the cards it reaches, not its parts', async () => {
  const s = await open();
  s.page.run("setSelection(addPart(addPart(NO_SELECTION, cardPart('5')), pathPart('4'))); renderBoard()");
  assert.deepStrictEqual(s.ids(), [1, 4, 5], 'card 4 waits for card 1: the path reaches both');
  assert.strictEqual(s.bar.count(), '3 selected');
});

// A tap on a card, through the listeners the page puts on the document.
function cardTarget(id) {
  const el = { dataset: { id: String(id) } };
  const inCard = (sel) => sel.split(',').some((part) => part.trim() === '.card-el');
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (inCard(sel) ? el : null) : harmless(String(key))) });
}
const tap = (s, id) => s.page.fireDocument('click', { target: cardTarget(id), detail: 1, shiftKey: false, ctrlKey: false, metaKey: false });

test('Clear empties the selection, the search box that mirrored it, and the bar', async () => {
  const s = await open();
  tap(s, 2);
  tap(s, 3);
  assert.strictEqual(s.page.input.value, '#2 | #3');
  assert.strictEqual(s.bar.count(), '2 selected');
  await s.bar.press('clear');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] });
  assert.deepStrictEqual(s.ids(), []);
  assert.strictEqual(s.page.input.value, '', 'the box that said the selection is empty again');
  assert.strictEqual(s.bar.shown(), false);
  assert.strictEqual(s.page.run('selectionState.rangeStart'), null, 'no invisible range start is left behind');
});

// --- Archive ---------------------------------------------------------------------------------------

test('Archive asks the confirmation bulk Archive asks, then the package popup, and archives the resolved selection card by card', async () => {
  const s = await open();
  s.select(1, 2, 3);
  await s.bar.press('archive');
  assert.strictEqual(s.ask.text(), 'Archive 3 card(s)? (moves their files to archived/)');
  assert.strictEqual(s.popupOpen('#bulk-archive'), false, 'the package popup waits for the answer');
  await s.ask.yes();
  assert.strictEqual(s.popupOpen('#bulk-archive'), true);
  assert.strictEqual(s.elements['#bulk-archive-title'].textContent, 'Archive 3 card(s)');
  s.elements['#bulk-archive-apply'].fire('click', {});
  await s.page.settle();
  assert.deepStrictEqual(s.cardRequests(), ['POST /api/cards/1/archive', 'POST /api/cards/2/archive', 'POST /api/cards/3/archive']);
});

test('after Archive the selection is empty and the bar is gone, as after bulk Archive today', async () => {
  const s = await open();
  s.select(1, 2);
  await s.bar.press('archive');
  await s.ask.yes();
  s.elements['#bulk-archive-apply'].fire('click', {});
  await s.page.settle();
  assert.deepStrictEqual(s.ids(), []);
  assert.strictEqual(s.bar.shown(), false);
});

test('a no to the confirmation archives nothing and leaves the selection and the bar as they were', async () => {
  const s = await open();
  s.select(1, 2);
  await s.bar.press('archive');
  await s.ask.no();
  assert.strictEqual(s.popupOpen('#bulk-archive'), false);
  assert.deepStrictEqual(s.cardRequests(), []);
  assert.deepStrictEqual(s.ids(), [1, 2]);
  assert.strictEqual(s.bar.count(), '2 selected');
});

test('a batch of done cards skips the confirmation and goes straight to the package popup', async () => {
  const s = await open();
  s.select(5, 6);
  await s.bar.press('archive');
  assert.strictEqual(s.ask.open(), false);
  assert.strictEqual(s.popupOpen('#bulk-archive'), true);
});

// --- Set status… -----------------------------------------------------------------------------------

const rightClick = (s, id) => {
  const el = { dataset: { id: String(id) } };
  s.page.fireDocument('contextmenu', { target: { closest: (sel) => (sel === '.card-el' ? el : null) }, clientX: 30, clientY: 40 });
};
const statusList = (s) => s.elements['#bulk-status-list'];
const statusChoices = (s) => statusList(s).children.map((b) => b.dataset.status);
// A tap on one of the popup's statuses: the list takes it by delegation.
const chooseStatus = async (s, status) => {
  const button = statusList(s).children.find((b) => b.dataset.status === status);
  assert.ok(button, `the popup offers ${status}`);
  statusList(s).fire('click', { target: { closest: (sel) => (sel === 'button[data-status]' ? button : null) } });
  await s.page.settle();
};

test('Status opens Set status… for the resolved selection, listing the board\'s statuses and not Archive', async () => {
  const s = await open();
  s.select(2, 3, 5);
  await s.bar.press('status');
  assert.strictEqual(s.popupOpen('#bulk-status'), true);
  assert.strictEqual(s.elements['#bulk-status-title'].textContent, 'Set status on 3 card(s)');
  assert.deepStrictEqual(statusChoices(s), ['backlog', 'todo', 'doing', 'done']);
  assert.deepStrictEqual(statusList(s).children.map((b) => b.textContent), ['Backlog', 'Todo', 'Doing', 'Done']);
});

test('a status picked moves each selected card through the PATCH a drop sends, closes the popup and keeps the selection', async () => {
  const s = await open();
  s.select(2, 3);
  await s.bar.press('status');
  await chooseStatus(s, 'done');
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/2', 'PATCH /api/cards/3']);
  assert.strictEqual(s.popupOpen('#bulk-status'), false);
  assert.deepStrictEqual(s.ids(), [2, 3], 'a drop of a batch clears the selection; Set status keeps it, so a next action chains on it');
  assert.strictEqual(s.bar.count(), '2 selected');
  assert.deepStrictEqual(s.toasts, ['Moved 2 to done.']);
});

test('one card goes the route a single drop takes, and a card already in the status is left alone', async () => {
  const s = await open();
  s.select(2);
  await s.bar.press('status');
  await chooseStatus(s, 'todo');
  assert.deepStrictEqual(s.cardRequests(), [], 'card 2 is in todo already');
  s.select(2);
  await s.bar.press('status');
  await chooseStatus(s, 'doing');
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/2']);
  assert.deepStrictEqual(s.ids(), [2]);
});

test('the doing gate refuses a card that waits, by name, moves the rest, and the selection stays', async () => {
  const s = await open();
  s.select(2, 4);
  await s.bar.press('status');
  await chooseStatus(s, 'doing');
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/2'], 'card 4 waits for card 1, which is in doing: it is the gate\'s to refuse, not the server\'s');
  assert.deepStrictEqual(s.toasts, ['Moved 1 to doing; skipped #4 (waiting).']);
  assert.deepStrictEqual(s.ids(), [2, 4]);
});

test('the doing gate on one card refuses with the toast a drop gives, and the selection stays', async () => {
  const s = await open();
  s.select(4);
  await s.bar.press('status');
  await chooseStatus(s, 'doing');
  assert.deepStrictEqual(s.cardRequests(), []);
  assert.deepStrictEqual(s.toasts, ['#4 is waiting on #1 (doing) — can\'t move to doing.']);
  assert.deepStrictEqual(s.ids(), [4]);
});

test('Set status… is in the card menu: a right-click outside the selection moves that card alone and leaves the selection as it was', async () => {
  const s = await open({ phone: false });
  s.select(2, 3);
  rightClick(s, 5);
  s.elements['#ctx-status'].fire('click', {});
  assert.strictEqual(s.elements['#bulk-status-title'].textContent, 'Set status on 1 card(s)');
  await chooseStatus(s, 'doing');
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/5']);
  assert.deepStrictEqual(s.ids(), [2, 3]);
  assert.strictEqual(s.menuOpen(), false, 'the menu closed when the entry opened the popup');
});

test('a right-click inside the selection offers Set status… for the whole selection, at the desk width too', async () => {
  const s = await open({ phone: false });
  s.select(2, 3);
  rightClick(s, 3);
  s.elements['#ctx-status'].fire('click', {});
  await chooseStatus(s, 'backlog');
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/2'], 'card 3 is in backlog already');
  assert.strictEqual(s.elements['#bulk-status-title'].textContent, 'Set status on 2 card(s)');
});

test('the popup acts on the cards it opened for, whatever the selection becomes while it is open', async () => {
  const s = await open();
  s.select(2, 3);
  await s.bar.press('status');
  s.select(5, 6);
  await chooseStatus(s, 'doing');
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/2', 'PATCH /api/cards/3']);
});

test('an archived card in the batch goes the route a drop takes: the question that names the restore comes first, and a no changes nothing', async () => {
  const s = await open();
  s.page.run("menuSubject = cardMenuFor(new Set(['7', '2']), '7')");
  s.page.run("openBulkStatus()");
  await chooseStatus(s, 'todo');
  assert.strictEqual(s.ask.text(), 'Move 1 card(s) to todo — 1 of them is archived and will be restored. Proceed?');
  await s.ask.no();
  assert.deepStrictEqual(s.cardRequests(), []);
  s.page.run("openBulkStatus()");
  await chooseStatus(s, 'todo');
  await s.ask.yes();
  assert.deepStrictEqual(s.cardRequests(), ['POST /api/cards/7/restore', 'PATCH /api/cards/7']);
});

test('the popup closes on its close button and on a tap on the backdrop, and moves nothing', async () => {
  const s = await open();
  s.select(2);
  await s.bar.press('status');
  assert.strictEqual(s.popupOpen('#bulk-status'), true);
  s.elements['#bulk-status-close'].fire('click', {});
  assert.strictEqual(s.popupOpen('#bulk-status'), false);
  await s.bar.press('status');
  assert.strictEqual(s.popupOpen('#bulk-status'), true);
  s.elements['#bulk-status'].fire('click', { target: { id: 'bulk-status' } });
  assert.strictEqual(s.popupOpen('#bulk-status'), false);
  assert.deepStrictEqual(s.cardRequests(), []);
  assert.deepStrictEqual(s.ids(), [2]);
});

// --- More ------------------------------------------------------------------------------------------

// The click on More as the browser delivers it: the button's own handler first, then the page's
// document listeners, which close a menu a click lands outside of.
const pressMore = async (s) => {
  const more = s.elements['#selection-bar-more'];
  const hit = { closest: (sel) => (sel.split(',').some((part) => part.trim() === '#selection-bar-more') ? more : null) };
  more.fire('click', { currentTarget: more, target: hit });
  s.page.fireDocument('click', { target: hit, detail: 1 });
  await s.page.settle();
};

test('More opens the card menu for the whole selection: no Peek, no Add to selection, and the bulk entries act on every selected card', async () => {
  const s = await open();
  s.select(1, 2, 3);
  await pressMore(s);
  assert.strictEqual(s.menuOpen(), true, 'the click that opened the menu is not the click that closes it');
  assert.deepStrictEqual(Array.from(s.page.run('menuSubject.ids'), Number), [1, 2, 3]);
  assert.strictEqual(s.page.run('menuSubject.inSelection'), true);
  assert.strictEqual(s.elements['#ctx-peek'].classList.contains('hidden'), true);
  assert.strictEqual(s.elements['#ctx-add'].classList.contains('hidden'), true);
  s.elements['#ctx-priority'].fire('click', {});
  s.elements['#bulk-single-input'].value = 'High';
  s.elements['#bulk-single-apply'].fire('click', {});
  await s.page.settle();
  assert.deepStrictEqual(s.cardRequests(), ['PATCH /api/cards/1', 'PATCH /api/cards/2', 'PATCH /api/cards/3']);
  assert.deepStrictEqual(s.ids(), [1, 2, 3], 'a bulk edit keeps the selection');
});

test('More on an open menu closes it', async () => {
  const s = await open();
  s.select(1, 2);
  await pressMore(s);
  assert.strictEqual(s.menuOpen(), true);
  await pressMore(s);
  assert.strictEqual(s.menuOpen(), false);
});

test('a tap on Clear, Archive or Status with the menu open closes the menu', async () => {
  const s = await open();
  s.select(1, 2);
  await pressMore(s);
  assert.strictEqual(s.menuOpen(), true);
  const clear = s.elements['#selection-bar-clear'];
  clear.fire('click', {});
  s.page.fireDocument('click', { target: { closest: () => null }, detail: 1 });
  assert.strictEqual(s.menuOpen(), false);
});
