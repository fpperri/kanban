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
// page keeps for it, are selection-bar-markup.test.js's. The page's timers run on a clock the test
// moves (fakeClock), so the wait a tap puts on the bar is read to the millisecond.

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

// The page's setTimeout and clearTimeout on a clock the test moves: tick(ms) runs what has come due.
function fakeClock(page) {
  const timers = [];
  let now = 0;
  page.ctx.setTimeout = (fn, ms) => { timers.push({ fn, at: now + ms, id: timers.length + 1 }); return timers.length; };
  page.ctx.clearTimeout = (id) => { const t = timers.find((x) => x.id === id); if (t) t.cancelled = true; };
  return {
    tick(ms) {
      now += ms;
      for (const t of timers.filter((x) => !x.done && !x.cancelled && x.at <= now).sort((a, b) => a.at - b.at)) { t.done = true; t.fn(); }
    },
  };
}

const BAR = ['#selection-bar', '#selection-bar-count', '#selection-bar-clear', '#selection-bar-archive', '#selection-bar-status', '#selection-bar-more'];
const PATH_TREE = ['#ctx-hpath', '#ctx-dpath', '#ctx-htree', '#ctx-dtree'];
const MENU = ['#context-menu', '#ctx-peek', '#ctx-add', '#ctx-isolate', ...PATH_TREE, '#ctx-child', '#ctx-status', '#ctx-assign', '#ctx-priority', '#ctx-tags', '#ctx-schedule', '#ctx-archive', '#ctx-restore', '#ctx-delete',
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
  const clock = fakeClock(page);
  const barChanges = []; // every time the bar goes up or away: the layout moves with each
  const barClasses = elements['#selection-bar'].classList;
  for (const name of ['add', 'remove', 'toggle']) {
    const original = barClasses[name];
    barClasses[name] = (...args) => {
      const was = barClasses.contains('hidden');
      const result = original(...args);
      if (barClasses.contains('hidden') !== was) barChanges.push(was ? 'up' : 'away');
      return result;
    };
  }
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
    page, elements, requests, toasts, bar, ids, ask: askDriver(page, elements), clock, barChanges,
    window: () => page.run('DOUBLE_CLICK_MS'),
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
  s.clock.tick(s.window());
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

// The click on a bar button as the browser delivers it: the document's capture listeners first (on the
// phone layout, with the card menu open, a tap outside it only closes it and goes no further), then the
// button's own handler, then the document's other listeners, which close a menu a click lands outside of.
const clickBar = async (s, name) => {
  const button = s.elements[`#selection-bar-${name}`];
  const hit = { closest: (sel) => (sel.split(',').some((part) => part.trim() === `#selection-bar-${name}`) ? button : null) };
  s.page.fireDocument('click', { target: hit, detail: 1 }, { atTarget: (e) => button.fire('click', { ...e, currentTarget: button }) });
  await s.page.settle();
};
const pressMore = (s) => clickBar(s, 'more');

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

test('More opens the menu without Path and Tree, which act on one named card and the bar names none; Isolate and every bulk entry stay', async () => {
  const s = await open();
  const hidden = (sel) => s.elements[sel].classList.contains('hidden');
  s.select(1, 2, 3);
  await pressMore(s);
  assert.deepStrictEqual(PATH_TREE.map(hidden), [true, true, true, true], 'no Hierarchy or Dependency path or tree');
  assert.strictEqual(hidden('#ctx-isolate'), false, 'Isolate shows the selection');
  for (const entry of ['#ctx-status', '#ctx-assign', '#ctx-priority', '#ctx-tags', '#ctx-schedule', '#ctx-archive', '#ctx-restore', '#ctx-delete']) assert.strictEqual(hidden(entry), false, entry);
  s.page.run('hideContextMenu()');
  rightClick(s, 2);
  assert.deepStrictEqual(PATH_TREE.map(hidden), [false, false, false, false], 'a right-click on a card of the selection names the card, and they are back');
  assert.strictEqual(hidden('#ctx-isolate'), false);
  s.page.run('hideContextMenu()');
  await pressMore(s);
  assert.deepStrictEqual(PATH_TREE.map(hidden), [true, true, true, true], 'and More takes them out again');
});

test('More on an open menu closes it', async () => {
  const s = await open();
  s.select(1, 2);
  await pressMore(s);
  assert.strictEqual(s.menuOpen(), true);
  await pressMore(s);
  assert.strictEqual(s.menuOpen(), false);
});

test('a tap on Clear, Archive or Status with the menu open only closes the menu, as a tap outside it does at phone width', async () => {
  for (const name of ['clear', 'archive', 'status']) {
    const s = await open();
    s.select(1, 2);
    await pressMore(s);
    assert.strictEqual(s.menuOpen(), true, name);
    await clickBar(s, name);
    assert.strictEqual(s.menuOpen(), false, `${name}: the menu is shut`);
    assert.deepStrictEqual(s.ids(), [1, 2], `${name}: and the tap did nothing else`);
    assert.strictEqual(s.ask.open() || s.popupOpen('#bulk-status') || s.popupOpen('#bulk-archive'), false, name);
    assert.strictEqual(s.bar.shown(), true, name);
  }
});

test('a tap on Clear, Archive or Status with the menu shut acts, through the same click path', async () => {
  const s = await open();
  s.select(1, 2);
  await clickBar(s, 'status');
  assert.strictEqual(s.popupOpen('#bulk-status'), true);
  s.page.run("document.getElementById('bulk-status').classList.add('hidden')");
  await clickBar(s, 'clear');
  assert.deepStrictEqual(s.ids(), []);
  assert.strictEqual(s.bar.shown(), false);
});

// --- the Graph paints a tap in place, and the bar still follows it ------------------------------------

const graphTap = (s, id) => s.page.run(`graphClickNode('${id}', { detail: 1, shiftKey: false, ctrlKey: false, metaKey: false })`);

test('in the Graph the bar follows each tap on a dot, though the Graph paints it in place and never renders the board', async () => {
  const s = await open({ view: 'graph' });
  assert.strictEqual(s.bar.shown(), false);
  graphTap(s, 2);
  s.clock.tick(s.window());
  assert.strictEqual(s.bar.shown(), true, 'the first tap raises the bar');
  assert.strictEqual(s.bar.count(), '1 selected');
  graphTap(s, 3);
  s.clock.tick(s.window());
  assert.strictEqual(s.bar.count(), '2 selected');
  graphTap(s, 3);
  s.clock.tick(s.window());
  assert.strictEqual(s.bar.count(), '1 selected', 'a tap that takes a dot out lowers the count');
  graphTap(s, 2);
  s.clock.tick(s.window());
  assert.deepStrictEqual(s.ids(), []);
  assert.strictEqual(s.bar.shown(), false, 'and the last one out takes the bar away');
});

// --- the count is a live region: it is written when it changes, not on every render -------------------

test('a render that leaves the selection as it was does not write the count again, so a screen reader does not announce it again', async () => {
  const s = await open();
  const count = s.elements['#selection-bar-count'];
  let writes = 0;
  let text = '';
  Object.defineProperty(count, 'textContent', { get: () => text, set: (v) => { writes++; text = String(v); }, configurable: true });
  s.select(2, 3);
  assert.strictEqual(text, '2 selected');
  const afterSelect = writes;
  s.page.run('renderBoard()');
  s.page.run('renderBoard()');
  assert.strictEqual(writes, afterSelect, 'two renders of the same selection write nothing');
  s.select(2);
  assert.strictEqual(text, '1 selected');
  assert.ok(writes > afterSelect, 'a changed count is written');
});

// --- nothing the bar does moves the layout inside the double-tap window ------------------------------------

// The bar takes the page's room (--selection-bar-h), so each time it goes up or away the lists change
// height: one scrolled near its end shifts under the finger, and a card near the foot has the bar rise
// over it. A tap that changes the selection therefore leaves the bar as it was until the double-tap
// window has passed with no second tap on that card; a second tap (a click with detail 2) puts the
// selection back, and the bar is decided once, after it.
const secondTap = (s, id) => s.page.fireDocument('click', { target: cardTarget(id), detail: 2, shiftKey: false, ctrlKey: false, metaKey: false });
const tapTwice = (s, id) => {
  tap(s, id);
  secondTap(s, id);
};
const opening = (s) => {
  const opened = [];
  s.page.ctx.openCard = (id) => { opened.push(Number(id)); };
  return opened;
};

test('a first tap on a card with nothing selected does not raise the bar until the double-tap window has passed', async () => {
  const s = await open();
  tap(s, 2);
  assert.deepStrictEqual(s.ids(), [2], 'the selection is made at once');
  assert.strictEqual(s.bar.shown(), false, 'the bar is not');
  s.clock.tick(s.window() - 1);
  assert.strictEqual(s.bar.shown(), false, 'one millisecond short of the window');
  s.clock.tick(1);
  assert.strictEqual(s.bar.shown(), true);
  assert.strictEqual(s.bar.count(), '1 selected');
  assert.deepStrictEqual(s.barChanges, ['up'], 'it went up once');
});

test('a double tap on a card with nothing selected, one near the foot of the list, never raises the bar: the second tap lands on the card', async () => {
  const s = await open();
  const opened = opening(s);
  tapTwice(s, 5);
  assert.deepStrictEqual(opened, [5], 'the second tap opened the card it landed on');
  assert.deepStrictEqual(s.selection(), { anchor: null, additions: [] }, 'with the selection as it was before the first tap');
  assert.strictEqual(s.bar.shown(), false);
  s.clock.tick(10 * s.window());
  assert.deepStrictEqual(s.barChanges, [], 'the bar did not go up, not even for a moment, and nothing comes later');
  assert.strictEqual(s.bar.shown(), false);
});

test('a first tap that takes the only selected card out does not lower the bar until the window has passed, so a list scrolled near its end does not shift', async () => {
  const s = await open();
  s.select(2);
  assert.strictEqual(s.bar.shown(), true);
  s.barChanges.length = 0;
  tap(s, 2);
  assert.deepStrictEqual(s.ids(), [], 'the card is out of the selection at once');
  assert.strictEqual(s.bar.shown(), true, 'the bar stays');
  assert.strictEqual(s.bar.count(), '1 selected', 'with its count');
  s.clock.tick(s.window() - 1);
  assert.strictEqual(s.bar.shown(), true);
  s.clock.tick(1);
  assert.strictEqual(s.bar.shown(), false);
  assert.deepStrictEqual(s.barChanges, ['away'], 'it came down once');
});

test('a double tap on the only selected card opens it and leaves the selection and the bar as they were: the bar neither goes nor flickers', async () => {
  const s = await open();
  const opened = opening(s);
  s.select(2);
  s.barChanges.length = 0;
  tapTwice(s, 2);
  assert.deepStrictEqual(opened, [2]);
  assert.deepStrictEqual(s.ids(), [2], 'the first tap took the card out and the second put it back');
  s.clock.tick(10 * s.window());
  assert.deepStrictEqual(s.barChanges, [], 'the bar never moved, so no list changed height under the second tap');
  assert.strictEqual(s.bar.shown(), true);
  assert.strictEqual(s.bar.count(), '1 selected');
});

test('a tap that changes the count leaves the bar\'s count as it was inside the window, and a second tap on the card leaves it that way', async () => {
  const s = await open();
  const opened = opening(s);
  s.select(2);
  tap(s, 3);
  assert.deepStrictEqual(s.ids(), [2, 3]);
  assert.strictEqual(s.bar.count(), '1 selected', 'the live region does not announce a count the second tap may undo');
  secondTap(s, 3);
  assert.deepStrictEqual(opened, [3]);
  assert.deepStrictEqual(s.ids(), [2]);
  assert.strictEqual(s.bar.count(), '1 selected');
  s.clock.tick(10 * s.window());
  assert.strictEqual(s.bar.count(), '1 selected');
});

test('each tap puts the wait off again: the bar follows the last tap, one window after it', async () => {
  const s = await open();
  tap(s, 2);
  s.clock.tick(s.window() - 10);
  tap(s, 3);
  s.clock.tick(s.window() - 10);
  assert.strictEqual(s.bar.shown(), false, 'a window after the first tap, but not after the second');
  s.clock.tick(10);
  assert.strictEqual(s.bar.count(), '2 selected');
  assert.deepStrictEqual(s.barChanges, ['up']);
});

test('a render that finds the selection as the tap made it, a poll, does not end the wait', async () => {
  const s = await open();
  tap(s, 2);
  s.page.run('renderBoard()');
  s.page.run('renderBoard()');
  assert.strictEqual(s.bar.shown(), false, 'a poll inside the window leaves the bar down');
  s.clock.tick(s.window());
  assert.strictEqual(s.bar.shown(), true);
});

test('every other write to the selection moves the bar at once, and the wait it ends does nothing later', async () => {
  const writes = {
    'Clear on the bar': (s) => s.bar.press('clear'),
    'Esc': (s) => s.page.run('stepSelectionBack(); stepSelectionBack()'),
    'Select lit': (s) => s.page.run("menuSubject = { ...cardMenuFor(selectedIds, '2'), lit: ['2', '5', '6'] }; selectLitCards()"),
    'a card added from the menu': (s) => s.page.run("setSelection(addPart(selectionState.selection, cardPart('5'))); renderBoard()"),
    'a poll that finds a card of the selection gone': (s) => s.page.run("setSelection(pruneSelectionParts(selectionState.selection, ['1'])); renderBoard()"),
  };
  for (const [name, write] of Object.entries(writes)) {
    const s = await open();
    s.select(1);
    tap(s, 2);
    assert.strictEqual(s.bar.count(), '1 selected', `${name}: the tap is waiting`);
    await write(s);
    await s.page.settle();
    const read = () => [s.bar.count(), s.bar.shown()];
    assert.deepStrictEqual(read(), [`${s.ids().length} selected`, s.ids().length > 0], `${name}: the bar reads the selection as it is, at once`);
    const now = read();
    s.clock.tick(10 * s.window());
    assert.deepStrictEqual(read(), now, `${name}: and the wait it ended changes nothing`);
  }
});

test('a write that changes what the selection resolves to ends the wait: the bar follows at once', async () => {
  const s = await open();
  tap(s, 2);
  assert.strictEqual(s.bar.shown(), false);
  s.page.run("setSelection(addPart(selectionState.selection, cardPart('3'))); renderBoard()");
  assert.strictEqual(s.bar.count(), '2 selected');
  assert.strictEqual(s.bar.shown(), true);
});

test('a view switch ends the wait, though it leaves the selection as it was: the bar follows at once', async () => {
  const s = await open();
  tap(s, 2);
  assert.strictEqual(s.bar.shown(), false);
  s.page.run("setView('map')");
  assert.deepStrictEqual(s.ids(), [2]);
  assert.strictEqual(s.bar.shown(), true);
  assert.strictEqual(s.bar.count(), '1 selected');
  s.clock.tick(10 * s.window());
  assert.deepStrictEqual(s.barChanges, ['up'], 'and the wait it ended changes nothing');
});

test('in the Graph the wait is the same: a tap on a dot leaves the bar as it was for a window, and a double tap on it never raises it', async () => {
  const s = await open({ view: 'graph' });
  const opened = opening(s);
  graphTap(s, 2);
  assert.deepStrictEqual(s.ids(), [2]);
  assert.strictEqual(s.bar.shown(), false);
  s.page.run("graphClickNode('2', { detail: 2, shiftKey: false, ctrlKey: false, metaKey: false })");
  assert.deepStrictEqual(opened, [2]);
  assert.deepStrictEqual(s.ids(), []);
  s.clock.tick(10 * s.window());
  assert.deepStrictEqual(s.barChanges, [], 'the bar never went up');
});

test('at the desk width a Ctrl-click moves the bar at once: there is no wait, and the stylesheet does not draw the bar there anyway', async () => {
  const s = await open({ phone: false });
  s.page.fireDocument('click', { target: cardTarget(2), detail: 1, shiftKey: false, ctrlKey: true, metaKey: false });
  assert.strictEqual(s.bar.shown(), true);
  assert.strictEqual(s.bar.count(), '1 selected');
});
