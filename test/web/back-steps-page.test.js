const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const { attachSessionHistory } = require('./helpers/session-history');
const { PHONE_WIDTH_QUERY } = require('../../plugin/skills/web/web/phone-width');
const { BACK_ENTRY_SETTLE_MS } = require('../../plugin/skills/web/web/back-steps');

// Android Back on the phone layout, run through the listeners the real page puts on the document and
// on the window, over a browser session history (helpers/session-history.js) the page pushes to and
// steps through the way the browser does. While a menu, a light or a selection stands the page keeps
// one entry of its own; the Back that pops it runs one step of Esc and the page keeps the entry again
// while something is left. The rules are back-steps.test.js's; the browser scenarios run it with
// history.back() in a real browser.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// 2 waits for 1 and is the parent of 3; 4 stands alone.
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [card(1, { status: 'doing' }), card(2, { waiting_for: ['1'] }), card(3, { status: 'backlog', parent: '2' }), card(4, { status: 'done' })],
  archived: [],
});

const HIDDEN = ['#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel', '#ctx-lit'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };

async function open({ phone = true } = {}) {
  const board = makeBoard();
  const clock = { at: 1000, timers: [] };
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  const page = loadPage({ board, elements });
  const media = { phone };
  const crossings = [];
  page.ctx.matchMedia = (q) => ({ get matches() { return q === PHONE_WIDTH_QUERY && media.phone; }, addEventListener: (type, fn) => crossings.push(fn) });
  const session = attachSessionHistory(page, {
    detail: (id) => ({ id, title: board.active.find((c) => c.id === id).title, frontmatter: '', body: '', path: `/board/${id}.card.md`, archived: false }),
  });
  // The page the person came from, and the board's own entry above it.
  page.ctx.history.pushState(null, '', '/');
  const pushedBefore = session.pushes;
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  page.ctx.performance = { now: () => clock.at };
  page.ctx.setTimeout = (fn, ms) => { const t = { fn, at: clock.at + ms }; clock.timers.push(t); return t; };
  page.ctx.clearTimeout = (t) => { clock.timers = clock.timers.filter((o) => o !== t); };
  const menu = page.ctx.document.querySelector('#context-menu');
  const s = {
    page, session, elements, menu, clock, board,
    cross(to) { media.phone = to; crossings.forEach((fn) => fn({})); },
    wait(ms) {
      clock.at += ms;
      for (const t of clock.timers.filter((o) => o.at <= clock.at)) { clock.timers = clock.timers.filter((o) => o !== t); t.fn(); }
    },
    settle() { s.wait(BACK_ENTRY_SETTLE_MS); },
    // How many entries stand above the board's own, up to the one the person is on.
    above: () => session.index - 1,
    pushes: () => session.pushes - pushedBefore,
    onEntry: () => !!(session.states[session.index] && session.states[session.index].kanbanBack),
    // The browser's Back: the address and the entry step down, then popstate reaches the page.
    async back() { session.back(); await page.settle(); },
    picked: () => [...page.run('selectedIds')].map(String).sort(),
    litId: () => page.run('pinnedLitId'),
    menuOpen: () => !menu.classList.contains('hidden'),
    detailUp: () => !elements['#detail-modal'].classList.contains('hidden'),
    tap(id) { return tap(s, cardTarget(id)); },
    doubleTap(id) { tap(s, cardTarget(id)); return tap(s, cardTarget(id), { detail: 2 }); },
  };
  return s;
}

const CUES = '.card-assignee, .tag, .blocked-pill, .review-pill';
function cardTarget(id) {
  const el = { dataset: { id: String(id) } };
  const inCard = (sel) => sel.split(',').some((part) => part.trim() === '.card-el');
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (inCard(sel) ? el : (sel === CUES ? null : null)) : harmless(String(key))) });
}
const tap = (s, target, extra = {}) => s.page.fireDocument('click', { target, detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });

// A press held on a card and lifted in place, as card-press-page.test.js drives it.
function tile(id) {
  const el = { dataset: { id: String(id) } };
  const listeners = {};
  return new Proxy({}, {
    get: (t, key) => {
      if (key === 'closest') return (sel) => (sel.split(',').some((p) => p.trim() === '.card-el') ? el : null);
      if (key === 'addEventListener') return (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
      if (key === 'removeEventListener') return (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); };
      if (key === 'fire') return (type, event = {}) => { const e = { cancelable: true, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...event }; (listeners[type] || []).slice().forEach((fn) => fn(e)); return e; };
      return harmless(String(key));
    },
  });
}
function longPress(s, id) {
  const target = tile(id);
  const at = { clientX: 100, clientY: 200 };
  s.page.fireDocument('touchstart', { target, touches: [at], changedTouches: [at] });
  s.wait(600);
  target.fire('touchend', { touches: [], changedTouches: [at] });
}

test('a selection at the phone layout keeps one entry of the page\'s own once the double-tap window has passed, and none before', async () => {
  const s = await open();
  s.tap(2);
  assert.strictEqual(s.pushes(), 0, 'the tap has not settled');
  s.wait(BACK_ENTRY_SETTLE_MS - 1);
  assert.strictEqual(s.pushes(), 0);
  s.wait(1);
  assert.strictEqual(s.pushes(), 1);
  assert.ok(s.onEntry(), 'the entry carries the page\'s mark');
  assert.strictEqual(s.session.search, s.session.entries[s.session.index - 1], 'at the same address: the page shows no change');
  assert.strictEqual(s.above(), 1);
  s.tap(3);
  s.settle();
  assert.strictEqual(s.pushes(), 1, 'a second card adds no second entry');
});

test('no entry is added at the desk layout for a selection, a light or a menu', async () => {
  const s = await open({ phone: false });
  tap(s, cardTarget(2), { ctrlKey: true });
  s.page.run('setPinnedLight("3")');
  s.page.run('menuSubject = cardMenuFor(selectedIds, "3"); showContextMenu(0, 0)');
  s.settle();
  assert.deepStrictEqual([s.picked(), s.litId(), s.menuOpen()], [['2'], '3', true], 'the three stand');
  assert.strictEqual(s.pushes(), 0);
});

test('a double tap that undoes its first tap leaves no entry behind, and opens the card as it did: one step', async () => {
  const s = await open();
  s.doubleTap(2);
  await s.page.settle();
  s.settle();
  assert.ok(s.detailUp(), 'the card opens');
  assert.deepStrictEqual(s.picked(), [], 'the selection is as it was before the first tap');
  assert.strictEqual(s.pushes(), 1, 'the card\'s step alone');
  assert.strictEqual(s.session.search, '?card=2');
});

test('Back steps the selection back as Esc does, one step per Back: the additions, then the anchor, and the page stays', async () => {
  const s = await open();
  s.tap(2); s.tap(3); s.tap(4);
  s.settle();
  assert.deepStrictEqual(s.picked(), ['2', '3', '4']);
  await s.back();
  assert.deepStrictEqual(s.picked(), ['2'], 'the additions went at once, the anchor stays');
  assert.ok(s.onEntry(), 'the entry is back at once, with the anchor left');
  assert.strictEqual(s.session.index, 2, 'the page stays on its own entry');
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the anchor went');
  assert.strictEqual(s.session.index, 1, 'on the board\'s entry; nothing is left to keep');
  assert.ok(!s.onEntry());
  assert.strictEqual(s.above(), 0, 'and no entry stands above it');
});

test('with nothing lit or selected Back is the browser\'s: it leaves the page', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  await s.back();
  assert.deepStrictEqual(s.picked(), []);
  await s.back();
  assert.strictEqual(s.session.index, 0, 'the page the person came from');
});

test('Back closes an open menu, then drops the light, then steps the selection, one step per Back', async () => {
  const s = await open();
  s.tap(3);
  longPress(s, 2);
  assert.ok(s.menuOpen(), 'the long press opened the menu');
  s.settle();
  assert.strictEqual(s.pushes(), 1);
  await s.back();
  assert.deepStrictEqual([s.menuOpen(), s.litId(), s.picked()], [false, '2', ['3']], 'the menu first');
  assert.ok(s.onEntry());
  await s.back();
  assert.deepStrictEqual([s.menuOpen(), s.litId(), s.picked()], [false, null, ['3']], 'then the light');
  assert.ok(s.onEntry());
  await s.back();
  assert.deepStrictEqual([s.menuOpen(), s.litId(), s.picked()], [false, null, []], 'then the selection');
  assert.ok(!s.onEntry());
  assert.strictEqual(s.session.index, 1, 'the page stayed through all three');
  assert.strictEqual(s.pushes(), 3, 'one entry kept again after each of the first two');
});

test('a light alone keeps an entry: Back drops it and the page stays', async () => {
  const s = await open();
  longPress(s, 2);
  s.settle();
  await s.back();
  assert.strictEqual(s.menuOpen(), false);
  assert.strictEqual(s.litId(), '2');
  await s.back();
  assert.strictEqual(s.litId(), null);
  assert.strictEqual(s.session.index, 1);
});

test('a Back that finds an entry the selection no longer wants is a Back through: Esc left it behind', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  s.page.fireDocument('keydown', { key: 'Escape', repeat: false });
  assert.deepStrictEqual(s.picked(), []);
  await s.back();
  assert.strictEqual(s.session.index, 0, 'one Back leaves the page, not two');
});

test('the card details\' steps work as today with a selection, in both orders', async () => {
  // A selection, then a card: Back closes the card and leaves the selection, the next Back steps it.
  const s = await open();
  s.tap(2);
  s.settle();
  s.page.run('openCard("3")');
  await s.page.settle();
  assert.ok(s.detailUp());
  assert.match(s.session.search, /card=3/);
  s.settle();
  assert.strictEqual(s.pushes(), 2, 'the entry and the card\'s step; the details keep no second entry');
  await s.back();
  assert.ok(!s.detailUp(), 'Back closes the card');
  assert.deepStrictEqual(s.picked(), ['2'], 'and leaves the selection');
  assert.doesNotMatch(s.session.search, /card=/);
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the next Back steps the selection');
  assert.strictEqual(s.session.index, 1);
});

test('a card first, then a selection made while it is open: Back closes the card, and the selection is stepped by the Back after', async () => {
  const s = await open();
  s.page.run('openCard("3")');
  await s.page.settle();
  assert.ok(s.detailUp());
  s.page.run('menuSubject = cardMenuFor(selectedIds, "3", { fromDetail: true }); showContextMenu(0, 0)');
  s.settle();
  assert.ok(s.menuOpen());
  assert.strictEqual(s.pushes(), 2, 'a menu over the details keeps an entry');
  s.page.run('addCardToSelection()');
  s.settle();
  assert.deepStrictEqual([s.menuOpen(), s.picked()], [false, ['3']]);
  await s.back();
  assert.ok(!s.detailUp(), 'the Back closes the card, not the selection behind it');
  assert.deepStrictEqual(s.picked(), ['3'], 'the selection is as it was');
  assert.doesNotMatch(s.session.search, /card=/);
  s.settle();
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the Back after steps it');
  assert.strictEqual(s.session.index, 1);
});

test('a menu over the card details is closed by Back before the details are', async () => {
  const s = await open();
  s.page.run('openCard("3")');
  await s.page.settle();
  s.page.run('menuSubject = cardMenuFor(selectedIds, "3", { fromDetail: true }); showContextMenu(0, 0)');
  s.settle();
  await s.back();
  assert.deepStrictEqual([s.menuOpen(), s.detailUp()], [false, true]);
  await s.back();
  assert.ok(!s.detailUp());
});

test('with nothing lit or selected the card\'s steps are the browser\'s, as today: Back closes the details, then leaves', async () => {
  const s = await open();
  s.page.run('openCard("3")');
  await s.page.settle();
  s.settle();
  assert.strictEqual(s.pushes(), 1);
  await s.back();
  assert.ok(!s.detailUp());
  await s.back();
  assert.strictEqual(s.session.index, 0);
});

test('a popup over the page keeps its place: Back moves nothing and the entry comes back', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  s.session.popupOpen = true;
  await s.back();
  assert.deepStrictEqual(s.picked(), ['2'], 'the selection is untouched');
  assert.ok(s.onEntry(), 'the entry is kept again');
  s.session.popupOpen = false;
  await s.back();
  assert.deepStrictEqual(s.picked(), []);
});

test('the search box writes the address without taking the entry\'s mark off it', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  assert.ok(s.onEntry());
  s.tap(3);
  assert.notStrictEqual(s.session.search, '', 'the box mirrors the selection into the address');
  assert.ok(s.onEntry(), 'and the entry is still the page\'s own');
  await s.back();
  assert.deepStrictEqual(s.picked(), ['2'], 'so Back still steps');
});

test('crossing the width line to the desk layout keeps the entry stale and lets the Back through', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  s.cross(false);
  await s.back();
  assert.deepStrictEqual(s.picked(), ['2'], 'the desk layout steps nothing');
  assert.strictEqual(s.session.index, 0);
});

test('a selection taken down by a tap that clears it keeps an entry that the next Back passes through', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  s.tap(2);
  assert.deepStrictEqual(s.picked(), []);
  s.settle();
  await s.back();
  assert.strictEqual(s.session.index, 0);
});
