const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const { attachSessionHistory } = require('./helpers/session-history');
const { askElements, askDriver } = require('./helpers/ask-page');
const { paletteDocument, TEXT_AREA } = require('./helpers/palette-page');
const { buildMenu } = require('./helpers/menu-dom');
const { PHONE_WIDTH_QUERY } = require('../../plugin/skills/web/web/phone-width');
const { BACK_ENTRY_SETTLE_MS } = require('../../plugin/skills/web/web/back-steps');

// Android Back on the phone layout, run through the listeners the real page puts on the document and
// on the window, over a browser session history (helpers/session-history.js) the page pushes to and
// steps through the way the browser does, with the Back button's rule that entries a page made without
// a tap are skipped (helpers/session-history.js: s.back() is the button, not history.back()). While a
// menu, a light or a selection stands the page keeps one entry of its own, made by a tap; the Back that
// pops it runs one step of Esc and the page goes forward to the entry again while something is left,
// never pushing one. The rules are back-steps.test.js's; the browser scenarios run it with history.back()
// in a real browser.

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

// The popups that are a .modal-backdrop of their own besides the card details and the in-page question.
const BACKDROPS = ['#notif-modal', '#prefs-sheet', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#bulk-status', '#group-dialog', '#tray-sheet'];
const HIDDEN = [...BACKDROPS, '#detail-modal', '#search-panel', '#ctx-lit'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };

// `link` opens the page on a card's address, the document's first entry, as a link to a card does.
// `palette` gives the page the document the notes palette builds itself in (helpers/palette-page.js) and a
// logbook, so that openNotes draws the real palette.
// `menu` builds the card menu from app.html's own markup (helpers/menu-dom.js), groups and panels included.
async function open({ phone = true, link = null, palette = false, menu: withMenu = false } = {}) {
  const board = makeBoard();
  if (palette) board.logbook = { folder: 'logbook', notes: [] };
  const holder = { document: null };
  const clock = { at: 1000, timers: [] };
  const elements = { ...askElements() };
  for (const sel of HIDDEN) elements[sel] = hidden();
  const extras = palette || withMenu ? paletteDocument(holder) : {};
  const built = withMenu ? buildMenu(extras) : null;
  if (built) Object.assign(elements, { '#context-menu': built.root, ...built.byId });
  const page = loadPage({ board, elements, search: link === null ? '' : `?card=${link}`, documentExtras: extras });
  holder.document = page.ctx.document;
  if (palette) page.ctx.getComputedStyle = () => TEXT_AREA;
  const media = { phone };
  const crossings = [];
  page.ctx.matchMedia = (q) => ({ get matches() { return q === PHONE_WIDTH_QUERY && media.phone; }, addEventListener: (type, fn) => crossings.push(fn) });
  const session = attachSessionHistory(page, {
    detail: (id) => ({ id, title: board.active.find((c) => c.id === id).title, frontmatter: '', body: '', path: `/board/${id}.card.md`, archived: false }),
  });
  // The page the person came from, and the board's own entry above it; a link has the board's entry alone.
  if (link === null) page.ctx.history.pushState(null, '', '/');
  session.startDocument();
  const pushedBefore = session.pushes;
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  // The key guard's question, whether a popup but the card details is up (key-guard.js), answered from the
  // elements the test shows and hides; the older answer was always yes.
  const realQuery = page.ctx.document.querySelector;
  const otherBackdropUp = () => ['#ask', ...BACKDROPS].some((sel) => !elements[sel].classList.contains('hidden'));
  page.ctx.document.querySelector = (sel) => (sel === '.modal-backdrop:not(.hidden):not(#detail-modal)' ? (otherBackdropUp() ? control() : null) : realQuery(sel));
  page.ctx.performance = { now: () => clock.at };
  page.ctx.setTimeout = (fn, ms) => { const t = { fn, at: clock.at + ms }; clock.timers.push(t); return t; };
  page.ctx.clearTimeout = (t) => { clock.timers = clock.timers.filter((o) => o !== t); };
  const menu = page.ctx.document.querySelector('#context-menu');
  const s = {
    page, session, elements, menu, clock, board,
    ask: askDriver(page, elements),
    shown: (sel) => !elements[sel].classList.contains('hidden'),
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
    // A tap, a press or a key: the browser counts it as a user activation, and so does the page.
    activate() {
      session.activate();
      for (const fn of page.windowListeners.touchend || []) fn({ type: 'touchend' });
    },
    // The browser's Back button: the address and the entry step down, over the entries a page made
    // without a tap, then popstate reaches the page.
    async back() { session.uiBack(); await page.settle(); },
    // The browser's Forward button.
    async forward() { session.forward(); await page.settle(); },
    async openCard(id) { s.activate(); page.run(`openCard("${id}")`); await page.settle(); },
    detailMenu() { s.activate(); page.run('menuSubject = cardMenuFor(selectedIds, "3", { fromDetail: true }); showContextMenu(0, 0)'); },
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
const tap = (s, target, extra = {}) => {
  s.activate();
  return s.page.fireDocument('click', { target, detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });
};

// A press held on a card and lifted in place, as card-press-page.test.js drives it.
function tile(id) {
  const el = { dataset: { id: String(id) }, closest: () => null };
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
  s.activate();
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

// Chrome counts a double tap from the first finger's lift to the second finger's touch down, and the second
// click comes when that finger lifts, a press later: a wait counted from the first tap's click alone runs out
// under the second finger, and the entry made there would stand below the card's step. So a finger down stops
// the wait, and the lift starts it again, as the selection bar's wait does. A pointer event as the browser
// sends it: the window's listeners first, then the document's.
const finger = (s, type, pointerType = 'touch') => {
  const e = { type, pointerType, pointerId: 1, target: cardTarget(2) };
  for (const fn of s.page.windowListeners[type] || []) fn(e);
  s.page.fireDocument(type, e);
};

test('a double tap the way a hand makes it, the second finger lifted after the window has passed since the first tap, leaves no entry behind either: one step', async () => {
  const s = await open();
  finger(s, 'pointerdown');
  finger(s, 'pointerup');
  s.tap(2);
  s.wait(200);
  finger(s, 'pointerdown');
  s.wait(BACK_ENTRY_SETTLE_MS);
  assert.strictEqual(s.pushes(), 0, 'the window ran out with the finger down, and the page made no entry under it');
  finger(s, 'pointerup');
  tap(s, cardTarget(2), { detail: 2 });
  await s.page.settle();
  s.settle();
  assert.ok(s.detailUp(), 'the card opens');
  assert.deepStrictEqual(s.picked(), [], 'the selection is as it was before the first tap');
  assert.strictEqual(s.pushes(), 1, 'the card\'s step alone');
  assert.strictEqual(s.session.search, '?card=2');
});

test('a finger that comes down after a tap and lifts with no second tap (a scroll, a cancel, a press elsewhere) leaves the entry a window after the lift', async () => {
  for (const [name, lift] of [['a lift', 'pointerup'], ['a cancel', 'pointercancel']]) {
    const s = await open();
    s.tap(2);
    s.wait(200);
    finger(s, 'pointerdown');
    s.wait(5 * BACK_ENTRY_SETTLE_MS);
    assert.strictEqual(s.pushes(), 0, `${name}: the finger is down, so the wait is not running`);
    finger(s, lift);
    s.wait(BACK_ENTRY_SETTLE_MS - 1);
    assert.strictEqual(s.pushes(), 0, `${name}: one millisecond short of a window after the lift`);
    s.wait(1);
    assert.deepStrictEqual([s.pushes(), s.onEntry(), s.picked()], [1, true, ['2']], name);
  }
});

test('a menu that opens under a held finger, as a long press opens it, gets its entry with the finger still down: only a finger coming down stops the wait', async () => {
  const s = await open();
  s.activate();
  finger(s, 'pointerdown');
  s.page.run('menuSubject = cardMenuFor(selectedIds, "2"); showContextMenu(0, 0)');
  s.settle();
  assert.deepStrictEqual([s.pushes(), s.onEntry()], [1, true]);
});

test('Back steps the selection back as Esc does, one step per Back: the additions, then the anchor, and the page stays', async () => {
  const s = await open();
  s.tap(2); s.tap(3); s.tap(4);
  s.settle();
  assert.deepStrictEqual(s.picked(), ['2', '3', '4']);
  await s.back();
  assert.deepStrictEqual(s.picked(), ['2'], 'the additions went at once, the anchor stays');
  assert.ok(s.onEntry(), 'the page is on its entry again at once, with the anchor left');
  assert.strictEqual(s.session.index, 2, 'the page stays on its own entry');
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the anchor went');
  assert.strictEqual(s.session.index, 1, 'on the board\'s entry; nothing is left to keep');
  assert.ok(!s.onEntry());
  assert.strictEqual(s.above(), 0, 'and no entry stands above it');
  assert.strictEqual(s.pushes(), 1, 'the one entry a tap made: a Back goes forward to it, and pushes none');
});

test('three Backs in a row with no tap between each take their step, and the third leaves: the page makes no entry without a tap for the browser to skip', async () => {
  const s = await open();
  s.tap(2); s.tap(3); s.tap(4);
  s.settle();
  await s.back();
  assert.deepStrictEqual(s.picked(), ['2'], 'the first Back drops the additions');
  assert.ok(s.session.index > 1, 'and the page stays');
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the second Back drops the anchor, which the browser\'s Back button reaches only if the page made its entry with a tap');
  assert.strictEqual(s.session.index, 1, 'and the page stays');
  await s.back();
  assert.strictEqual(s.session.index, 0, 'the third leaves the page');
  assert.ok(s.session.skipped.every((skipped) => !skipped), 'no entry of the page was ever marked to be skipped');
});

test('a Forward is never a Back: a selection, a card, Back, Forward opens the card again and the selection stands', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  await s.openCard(3);
  assert.ok(s.detailUp());
  await s.back();
  assert.ok(!s.detailUp(), 'Back closes the card');
  assert.deepStrictEqual(s.picked(), ['2']);
  await s.forward();
  assert.ok(s.detailUp(), 'Forward opens the card again');
  assert.deepStrictEqual(s.picked(), ['2'], 'and the selection is as it was');
  assert.match(s.session.search, /card=3/, 'the address names the card');
  assert.strictEqual(s.page.run('currentDetailId'), '3');
  await s.back();
  assert.ok(!s.detailUp(), 'a Back closes it again');
  assert.deepStrictEqual(s.picked(), ['2'], 'the selection standing');
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'and the Back after it steps the selection');
});

test('a Forward to the card step over a page entry that stands with a light is not a Back either', async () => {
  const s = await open();
  longPress(s, 2);
  s.settle();
  await s.back();
  assert.strictEqual(s.menuOpen(), false);
  await s.openCard(3);
  await s.back();
  assert.ok(!s.detailUp());
  await s.forward();
  assert.ok(s.detailUp(), 'the card opens again');
  assert.strictEqual(s.litId(), '2', 'and the light stands');
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
  assert.strictEqual(s.pushes(), 1, 'on the one entry the long press made, which each of the first two Backs went forward to again');
  await s.back();
  assert.strictEqual(s.session.index, 0, 'the fourth Back leaves the page');
});

test('an open More menu is closed before anything else, as Esc closes it first, and the selection stands', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  s.activate();
  s.page.run('moreMenuOpen()');
  assert.strictEqual(s.page.run('moreMenuIsOpen()'), true);
  await s.back();
  assert.strictEqual(s.page.run('moreMenuIsOpen()'), false, 'the More menu closed');
  assert.deepStrictEqual(s.picked(), ['2'], 'the selection stands');
  assert.ok(s.onEntry(), 'and the entry is kept again');
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the next Back steps the selection');
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

test('the page asks for no entry without a tap since the last Back: the browser would skip every entry it made', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  await s.back();
  assert.deepStrictEqual(s.picked(), []);
  assert.strictEqual(s.pushes(), 1);
  s.page.run('setPinnedLight("3")');
  s.settle();
  assert.strictEqual(s.pushes(), 1, 'a light with no tap since the Back keeps no entry');
  s.activate();
  s.settle();
  assert.strictEqual(s.pushes(), 2, 'the next tap makes the entry, whatever it taps: the light is still there');
  assert.ok(s.onEntry());
  assert.ok(s.session.skipped.every((skipped) => !skipped), 'none of the page\'s entries is marked to be skipped');
  await s.back();
  assert.strictEqual(s.litId(), null, 'and a Back steps the light');
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
  await s.openCard(3);
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
  await s.openCard(3);
  assert.ok(s.detailUp());
  s.detailMenu();
  s.settle();
  assert.ok(s.menuOpen());
  assert.strictEqual(s.pushes(), 2, 'a menu over the details keeps an entry');
  s.activate();
  s.page.run('addCardToSelection()');
  s.settle();
  assert.deepStrictEqual([s.menuOpen(), s.picked()], [false, ['3']]);
  await s.back();
  assert.ok(!s.detailUp(), 'the Back closes the card, not the selection behind it');
  assert.deepStrictEqual(s.picked(), ['3'], 'the selection is as it was');
  assert.doesNotMatch(s.session.search, /card=/);
  assert.ok(s.onEntry(), 'the card\'s step is the page\'s entry now, made without a push, and it holds the selection');
  assert.strictEqual(s.pushes(), 2, 'the Back that closed the card pushed nothing');
  s.settle();
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the Back after steps it');
  assert.strictEqual(s.session.index, 1);
  await s.back();
  assert.strictEqual(s.session.index, 0, 'and the Back after that leaves the page');
});

test('a menu over the card details is closed by Back before the details are', async () => {
  const s = await open();
  await s.openCard(3);
  s.detailMenu();
  s.settle();
  await s.back();
  assert.deepStrictEqual([s.menuOpen(), s.detailUp()], [false, true]);
  await s.back();
  assert.ok(!s.detailUp());
});

test('a Back that closes the menu over the card details, with a selection behind, leaves the details as they are and keeps the entry for the Back after', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  await s.openCard(3);
  s.detailMenu();
  s.settle();
  const asked = [];
  const fetched = s.page.ctx.fetch;
  s.page.ctx.fetch = (url, init) => { asked.push(String(url)); return fetched(url, init); };
  await s.back();
  assert.deepStrictEqual([s.menuOpen(), s.detailUp()], [false, true], 'the menu closed and the details stand');
  assert.deepStrictEqual(asked, [], 'and the card was not read again to draw them');
  assert.ok(s.onEntry(), 'the selection behind them keeps the page\'s entry');
  await s.back();
  assert.ok(!s.detailUp(), 'the next Back closes the details');
  assert.deepStrictEqual(s.picked(), ['2'], 'and leaves the selection');
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the Back after steps it');
});

// The Archive question over the card details (its Archive button): a Back answers it no and leaves the
// details, as Android's Back answered the native confirm() before the question moved into the page.
function askOverDetails(s, answers) {
  s.activate();
  s.page.run('askInPage("Archive card 3?", { yes: "Archive" })').then((value) => answers.push(value));
}

test('a question asked over the card details is answered no by Back, and the details stand for the Back after, then the page is left', async () => {
  const s = await open();
  await s.openCard(3);
  const answers = [];
  askOverDetails(s, answers);
  s.settle();
  assert.ok(s.onEntry(), 'the page keeps an entry above the card\'s step for the question');
  await s.back();
  assert.deepStrictEqual([s.ask.open(), answers, s.detailUp()], [false, [false], true], 'the question said no and the details stand');
  assert.match(s.session.search, /card=3/, 'at the card\'s address');
  await s.back();
  assert.ok(!s.detailUp(), 'the next Back closes the details');
  await s.back();
  assert.strictEqual(s.session.index, 0, 'and the one after leaves the page');
});

test('a question asked over the card details with a selection behind them: Back answers it, closes the details, steps the selection, then leaves', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  await s.openCard(3);
  const answers = [];
  askOverDetails(s, answers);
  s.settle();
  await s.back();
  assert.deepStrictEqual([s.ask.open(), answers, s.detailUp(), s.picked()], [false, [false], true, ['2']]);
  await s.back();
  assert.deepStrictEqual([s.detailUp(), s.picked()], [false, ['2']], 'the next Back closes the details and leaves the selection');
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the Back after steps the selection');
  await s.back();
  assert.strictEqual(s.session.index, 0, 'and the one after leaves the page');
});

// A popup that stands over the card details (the delete popup, which the Delete button of the details opens in the
// group dialog; the notes palette, from the details' icons) is closed by a Back, which then leaves the details for
// the Back after.
test('the delete popup over the card details is closed by Back, and the details stand for the Back after', async () => {
  const s = await open();
  await s.openCard(3);
  s.activate();
  s.page.run('openGroupDialog("Delete card", { querySelector: () => null })');
  s.settle();
  assert.ok(s.shown('#group-dialog') && s.onEntry(), 'the page keeps an entry above the card\'s step for the popup');
  await s.back();
  assert.deepStrictEqual([s.shown('#group-dialog'), s.detailUp()], [false, true], 'the popup closed and the details stand');
  assert.match(s.session.search, /card=3/);
  await s.back();
  assert.ok(!s.detailUp(), 'the next Back closes the details');
  await s.back();
  assert.strictEqual(s.session.index, 0, 'and the one after leaves the page');
});

test('the notes palette over the card details is closed by Back, then the details', async () => {
  const s = await open({ palette: true });
  await s.openCard(3);
  s.activate();
  s.page.run("openNotes({})");
  s.settle();
  assert.ok(s.page.run('notesIsOpen()') && s.onEntry(), 'the page keeps an entry above the card\'s step for the palette');
  await s.back();
  assert.deepStrictEqual([s.page.run('notesIsOpen()'), s.detailUp()], [false, true]);
  await s.back();
  assert.ok(!s.detailUp());
  await s.back();
  assert.strictEqual(s.session.index, 0);
});

test('a popup closed before the double-tap window has passed, or one with no card details under it, leaves no entry behind', async () => {
  const s = await open();
  await s.openCard(3);
  s.activate();
  s.page.run('openGroupDialog("Delete card", { querySelector: () => null })');
  s.page.run('closeGroupDialog()');
  s.settle();
  assert.deepStrictEqual([s.onEntry(), s.pushes()], [false, 1], 'the card\'s step alone');
  const bare = await open();
  bare.activate();
  bare.page.run('openGroupDialog("Delete card", { querySelector: () => null })');
  bare.settle();
  assert.deepStrictEqual([bare.onEntry(), bare.pushes()], [false, 0], 'a popup on the board alone keeps none: Back is the browser\'s there');
});

test('a question answered before the double-tap window has passed leaves no entry behind', async () => {
  const s = await open();
  await s.openCard(3);
  const answers = [];
  askOverDetails(s, answers);
  await s.ask.no();
  s.settle();
  assert.deepStrictEqual(answers, [false]);
  assert.ok(!s.onEntry(), 'no entry was made');
  assert.strictEqual(s.pushes(), 1, 'the card\'s step alone');
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

test('a popup Back has no closer for keeps its place over a selection: Back moves nothing and the entry comes back', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  s.session.popupOpen = true;
  await s.back();
  assert.deepStrictEqual(s.picked(), ['2'], 'the selection is untouched');
  assert.ok(s.onEntry(), 'the page is on its entry again');
  await s.back();
  assert.deepStrictEqual(s.picked(), ['2'], 'however often the Back is pressed');
  assert.strictEqual(s.pushes(), 1, 'and the page pushed none to come back to');
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

test('a press on a Graph option writes the address without taking the page\'s mark off its entry, so a Back from a card above the entry still lands on it', async () => {
  const s = await open();
  s.tap(2); s.tap(3);
  s.settle();
  assert.ok(s.onEntry());
  const written = s.session.replaces;
  s.activate();
  s.page.run('graphSetLayoutKind("flow")');
  assert.ok(s.session.replaces > written, 'the Graph wrote its choice into the address');
  assert.match(s.session.search, /graph=flow/);
  assert.ok(s.onEntry(), "and the entry still carries the page's mark");
  await s.openCard(4);
  await s.back();
  assert.ok(!s.detailUp(), 'a Back closes the card');
  assert.deepStrictEqual(s.picked(), ['2', '3'], 'and lands on the entry, the selection standing');
  await s.back();
  assert.deepStrictEqual(s.picked(), ['2'], 'so the next Back steps it, and the page stays');
  assert.ok(s.session.index > 1);
});

test('a card that is gone when the edit form returns to the details is taken out of the address without taking the page\'s mark off its entry', async () => {
  const s = await open();
  await s.openCard(3);
  s.detailMenu();
  s.settle();
  assert.ok(s.onEntry(), "the menu over the details has the page's entry");
  const seen = s.page.run('detailRequestId');
  s.page.run(`(() => { const real = api; api = (m, p, b) => (/\\/detail$/.test(p) ? Promise.reject(Object.assign(new Error('gone'), { status: 404 })) : real(m, p, b)); })()`);
  s.page.run(`returnToDetails(${seen})`);
  await s.page.settle();
  assert.doesNotMatch(s.session.search, /card=/, 'the card is out of the address');
  assert.ok(s.onEntry(), "and the entry still carries the page's mark");
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

// An entry nothing wants any more is taken off by the page itself, once the double-tap window has passed: it goes
// back one entry, onto the one the person was on before. That traversal touches no entry but the page's own, which
// a sandboxed frame (the Board artifact in its viewer) may make, where it refuses a Back that leaves the page's first
// entry; so the person's next Back leaves in one press. history.back() is counted: the page calls it to drop
// the entry and never to leave.
function countBacks(s) {
  const counts = { back: 0 };
  const real = s.page.ctx.history.back;
  s.page.ctx.history.back = () => { counts.back++; return real(); };
  return counts;
}

test('an entry nothing wants any more, the selection emptied by a tap, is taken off by the page once the double-tap window has passed, and the next Back leaves in one press', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  assert.strictEqual(s.session.index, 2, 'the entry stands above the board\'s own');
  const backs = countBacks(s);
  s.tap(2);
  assert.deepStrictEqual(s.picked(), []);
  s.wait(BACK_ENTRY_SETTLE_MS - 1);
  assert.strictEqual(s.session.index, 2, 'the window has not passed: the entry stays');
  s.wait(1);
  assert.deepStrictEqual([s.session.index, s.onEntry(), backs.back, s.session.left], [1, false, 1, false], 'the page went back onto the board\'s own entry, once, and did not leave');
  assert.strictEqual(s.session.search, '', 'at the address it had');
  await s.back();
  assert.strictEqual(s.session.index, 0, 'one Back leaves the page');
  assert.strictEqual(backs.back, 1, 'and the page called history.back() for the drop alone');
});

test('the entry stays when something wants it again inside the window: a tap that selects after the tap that emptied the selection', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  s.tap(2);
  s.wait(BACK_ENTRY_SETTLE_MS - 1);
  s.tap(3);
  s.settle();
  assert.deepStrictEqual([s.session.index, s.onEntry(), s.picked()], [2, true, ['3']]);
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'and the Back steps it');
});

test('the drop is the page\'s own pop: it answers no question, opens or closes no card and leaves the next entry as it was', async () => {
  const s = await open();
  await s.openCard(3);
  s.detailMenu();
  s.settle();
  assert.strictEqual(s.session.index, 3, 'the card\'s step and the entry the menu kept above it');
  s.activate();
  s.page.run('hideContextMenu()');
  s.settle();
  assert.deepStrictEqual([s.session.index, s.onEntry(), s.detailUp()], [2, false, true], 'the entry went and the card stands, on its own step');
  assert.match(s.session.search, /card=3/);
  await s.back();
  assert.ok(!s.detailUp(), 'the Back after closes the card');
  await s.back();
  assert.strictEqual(s.session.index, 0, 'and the one after leaves the page');
});

test('a card menu closed with nothing lit or selected leaves an entry that is taken off, as a question answered does', async () => {
  const s = await open();
  s.activate();
  s.page.run('menuSubject = cardMenuFor(selectedIds, "2"); showContextMenu(0, 0)');
  s.settle();
  assert.strictEqual(s.session.index, 2);
  s.page.run('hideContextMenu()');
  s.settle();
  assert.deepStrictEqual([s.session.index, s.onEntry()], [1, false]);
  const asked = [];
  s.activate();
  s.page.run('askInPage("Archive card 3?", { yes: "Archive" })').then((value) => asked.push(value));
  s.settle();
  assert.strictEqual(s.session.index, 2, 'the question keeps an entry');
  await s.ask.no();
  s.settle();
  assert.deepStrictEqual([asked, s.session.index, s.onEntry()], [[false], 1, false], 'and loses it with its answer');
});

test('the entry of a window widened to the desk is taken off too, and a Back that comes before the window has passed is let through as before', async () => {
  const s = await open();
  s.tap(2);
  s.settle();
  s.cross(false);
  s.settle();
  assert.deepStrictEqual([s.session.index, s.onEntry(), s.picked()], [1, false, ['2']], 'the desk layout keeps no entry');
  const early = await open();
  early.tap(2);
  early.settle();
  early.cross(false);
  await early.back();
  assert.strictEqual(early.session.index, 0, 'a Back inside the window passes through, as it did');
});

// --- Back closes what Esc closes, in Esc's order ------------------------------------------------------

// A popup the person opened with a tap, over a selection that keeps the page's entry.
async function selectedWithEntry(options) {
  const s = await open(options);
  s.tap(2);
  s.settle();
  assert.ok(s.onEntry());
  return s;
}

// After a Back that closed a popup: the selection stands, the page is on its entry again with nothing
// pushed, and the Back after it steps the selection as before.
async function afterPopup(s) {
  assert.deepStrictEqual(s.picked(), ['2'], 'the selection stands');
  assert.ok(s.onEntry(), 'and the page is on its entry again');
  assert.strictEqual(s.pushes(), 1, 'the entry the tap made: no other was pushed');
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'the Back after steps the selection');
  assert.strictEqual(s.session.index, 1, 'and the page stays');
}

test('the notifications popup is closed by Back first, as Esc closes it, and the selection stands', async () => {
  const s = await selectedWithEntry();
  s.elements['#notif-modal'].classList.remove('hidden');
  await s.back();
  assert.ok(!s.shown('#notif-modal'), 'the popup closed');
  await afterPopup(s);
});

test('the preferences sheet takes its own step back, as Esc does: a narrow sheet on a page goes back to its menu, then closes', async () => {
  const s = await selectedWithEntry();
  s.page.ctx.innerWidth = 390;
  s.elements['#prefs-sheet'].classList.remove('hidden');
  s.page.run('settingsUi.page = "board:prefixes"');
  await s.back();
  assert.ok(s.shown('#prefs-sheet'), 'the sheet stays: its page went back to the menu');
  assert.strictEqual(s.page.run('settingsUi.page'), null);
  assert.deepStrictEqual(s.picked(), ['2']);
  await s.back();
  assert.ok(!s.shown('#prefs-sheet'), 'the next Back closes it');
  await afterPopup(s);
});

test('a wide preferences sheet closes on the first Back', async () => {
  const s = await selectedWithEntry();
  s.elements['#prefs-sheet'].classList.remove('hidden');
  await s.back();
  assert.ok(!s.shown('#prefs-sheet'));
  await afterPopup(s);
});

test('the edit form is closed by Back through its guard: untouched it closes, and the selection stands', async () => {
  const s = await selectedWithEntry();
  s.elements['#modal'].classList.remove('hidden');
  await s.back();
  assert.ok(!s.shown('#modal'), 'the form closed');
  assert.ok(!s.ask.open(), 'with no question: nothing was typed');
  await afterPopup(s);
});

test('the edit form with unsaved changes asks in the page when Back closes it, and the question decides', async () => {
  const s = await selectedWithEntry();
  s.elements['#modal'].classList.remove('hidden');
  s.page.run('formSnapshot = { title: "was" }');
  await s.back();
  assert.ok(s.shown('#modal'), 'the form stays while the question is up');
  assert.ok(s.ask.open(), 'the question is asked in the page');
  assert.match(s.ask.text(), /Discard unsaved changes/);
  assert.deepStrictEqual(s.picked(), ['2']);
  assert.ok(s.onEntry(), 'and the page kept its entry, for the Back that answers it');
  await s.back();
  assert.ok(!s.ask.open(), 'a Back answers the question no');
  assert.ok(s.shown('#modal'), 'so the form stays');
  assert.deepStrictEqual(s.picked(), ['2'], 'and so does the selection');
  await s.back();
  assert.ok(s.ask.open(), 'the next Back asks again');
  await s.ask.yes();
  assert.ok(!s.shown('#modal'), 'and a yes closes the form');
  assert.deepStrictEqual(s.picked(), ['2']);
  assert.ok(s.onEntry());
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'then the Back after steps the selection');
});

test('every bulk popup is closed by Back, as Esc closes it, and the selection stands', async () => {
  for (const sel of ['#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#bulk-status']) {
    const s = await selectedWithEntry();
    s.elements[sel].classList.remove('hidden');
    await s.back();
    assert.ok(!s.shown(sel), `${sel} closed`);
    await afterPopup(s);
  }
});

test('an open in-page question is answered no by Back, with the popup it was asked over left as it was', async () => {
  const s = await selectedWithEntry();
  s.elements['#bulk-archive'].classList.remove('hidden');
  const answers = [];
  s.page.run('askInPage("Archive 1 card?", { yes: "Archive" })').then((value) => answers.push(value));
  assert.ok(s.ask.open());
  await s.back();
  assert.ok(!s.ask.open(), 'the question closed');
  assert.deepStrictEqual(answers, [false], 'and said no');
  assert.ok(s.shown('#bulk-archive'), 'the popup behind it stays');
  assert.deepStrictEqual(s.picked(), ['2']);
  await s.back();
  assert.ok(!s.shown('#bulk-archive'), 'the next Back closes the popup');
  await afterPopup(s);
});

test('an open search panel is closed by Back before the light or the selection, as Esc closes it', async () => {
  const s = await open();
  s.tap(2);
  longPress(s, 3);
  s.settle();
  await s.back();
  assert.strictEqual(s.menuOpen(), false);
  s.activate();
  s.page.run('setSearchPanelOpen(true)');
  assert.strictEqual(s.page.run('searchPanelOpen'), true);
  await s.back();
  assert.strictEqual(s.page.run('searchPanelOpen'), false, 'the panel closed');
  assert.deepStrictEqual([s.litId(), s.picked()], ['3', ['2']], 'the light and the selection stand');
  assert.ok(s.onEntry());
  await s.back();
  assert.deepStrictEqual([s.litId(), s.picked()], [null, ['2']], 'then the light');
  await s.back();
  assert.deepStrictEqual(s.picked(), [], 'then the selection');
});

test('Back takes the layers down in the order Esc does, one at a time, whatever stands at once', async () => {
  const names = ['more-menu', 'menu', 'notifications', 'settings', 'edit-form', 'bulk-popup', 'search-panel', 'light', 'selection'];
  const stand = (s) => {
    s.activate();
    s.page.run('setPinnedLight("3")');
    s.page.run('menuSubject = cardMenuFor(selectedIds, "3"); showContextMenu(0, 0)');
    s.page.run('moreMenuOpen()');
    s.page.run('setSearchPanelOpen(true)');
    for (const sel of ['#notif-modal', '#prefs-sheet', '#modal', '#bulk-status']) s.elements[sel].classList.remove('hidden');
  };
  const up = (s) => names.filter((name) => ({
    'more-menu': s.page.run('moreMenuIsOpen()'), menu: s.menuOpen(), notifications: s.shown('#notif-modal'), settings: s.shown('#prefs-sheet'),
    'edit-form': s.shown('#modal'), 'bulk-popup': s.shown('#bulk-status'), 'search-panel': s.page.run('searchPanelOpen'), light: s.litId() !== null, selection: s.picked().length > 0,
  })[name]);
  const trace = async (press) => {
    const s = await selectedWithEntry();
    stand(s);
    const seen = [up(s).join()];
    for (let i = 0; i < 20 && up(s).length; i++) { await press(s); seen.push(up(s).join()); }
    return seen;
  };
  const esc = async (s) => {
    s.page.fireDocument('keydown', { key: 'Escape', repeat: false, preventDefault() {} });
    await s.page.settle();
  };
  const byBack = await trace((s) => s.back());
  assert.deepStrictEqual(byBack, names.map((_, i) => names.slice(i).join()).concat(['']), 'each Back takes the first of what stands, in Esc\'s order');
  assert.deepStrictEqual(await trace(esc), byBack, 'and Esc takes the same, one at a time');
});

test('a card opened from a link is the first entry of the page: with nothing standing the first Back leaves the page', async () => {
  const s = await open({ link: 3 });
  assert.ok(s.detailUp(), 'the card opens from the link');
  assert.strictEqual(s.session.index, 0);
  await s.back();
  assert.ok(s.session.left, 'Back is the browser\'s: the page is left');
});

test('a card opened from a link keeps no entry of the page below it: with a selection made over the details, the Back that pops the page\'s entry closes the details and the next leaves the page, the selection never stepped', async () => {
  const s = await open({ link: 3 });
  s.detailMenu();
  s.settle();
  assert.ok(s.menuOpen());
  s.activate();
  s.page.run('addCardToSelection()');
  s.settle();
  assert.deepStrictEqual(s.picked(), ['3']);
  assert.strictEqual(s.session.index, 1, 'the page made its entry above the link\'s');
  await s.back();
  assert.ok(!s.detailUp(), 'the first Back closes the details');
  assert.deepStrictEqual(s.picked(), ['3'], 'the selection stands');
  assert.strictEqual(s.session.left, false);
  await s.back();
  assert.ok(s.session.left, 'and the next leaves the page');
  assert.deepStrictEqual(s.picked(), ['3'], 'the selection was never stepped');
});

// --- the popups that take Esc in a listener of their own ----------------------------------------------

// Four popups take Esc in capture listeners on the document that run before the chain and keep the key
// from it: the date picker, the group dialog, the tray and the notes palette. Back closes each as Esc does.
const OWN_ESC = {
  'date-picker': { stand: (s) => s.page.run('datePickerFor = { value: "", focus() {} }'), up: (s) => s.page.run('datePickerFor') !== null },
  'group-dialog': { stand: (s) => s.page.run('openGroupDialog("Group", { querySelector: () => null })'), up: (s) => s.shown('#group-dialog') && s.page.run('groupDialogOpenNow()') },
  tray: { stand: (s) => s.elements['#tray-sheet'].classList.remove('hidden'), up: (s) => s.shown('#tray-sheet') },
  'notes-palette': { stand: (s) => s.page.run('openNotes({})'), up: (s) => s.page.run('notesUi.sub') !== null },
};

async function esc(s) {
  s.page.fireDocument('keydown', { key: 'Escape', repeat: false }, { honorStop: true });
  await s.page.settle();
}

test('the date picker is closed by Back before the popup it stands over, and not left drawn over the board', async () => {
  for (const under of ['#modal', '#bulk-schedule']) {
    const s = await selectedWithEntry();
    s.elements[under].classList.remove('hidden');
    s.page.run('datePickerFor = { value: "", focus() {} }');
    await s.back();
    assert.strictEqual(s.page.run('datePickerFor'), null, `the picker closed over ${under}`);
    assert.ok(s.shown(under), 'and the popup it stood over stays');
    assert.deepStrictEqual(s.picked(), ['2']);
    assert.ok(s.onEntry());
    await s.back();
    assert.ok(!s.shown(under), 'the next Back closes the popup');
    await afterPopup(s);
  }
});

test('the date picker alone over a selection is closed by Back, and the selection stands', async () => {
  const s = await selectedWithEntry();
  s.page.run('datePickerFor = { value: "", focus() {} }');
  await s.back();
  assert.strictEqual(s.page.run('datePickerFor'), null);
  await afterPopup(s);
});

test('the group dialog is closed by Back, as Esc closes it, and the selection stands', async () => {
  const s = await selectedWithEntry();
  s.page.run('openGroupDialog("Group", { querySelector: () => null })');
  assert.ok(s.shown('#group-dialog'));
  await s.back();
  assert.ok(!s.shown('#group-dialog'), 'the dialog closed');
  assert.strictEqual(s.page.run('groupDialogOpenNow()'), false);
  await afterPopup(s);
});

test('the tray steps back from its question to its list, then closes, as Esc does, and the selection stands', async () => {
  const s = await selectedWithEntry();
  s.elements['#tray-sheet'].classList.remove('hidden');
  s.page.run('trayAsk = { kind: "discard", count: 2 }');
  await s.back();
  assert.ok(s.shown('#tray-sheet'), 'the sheet stays: its question went back to the list');
  assert.strictEqual(s.page.run('trayAsk'), null);
  assert.deepStrictEqual(s.picked(), ['2']);
  assert.ok(s.onEntry());
  await s.back();
  assert.ok(!s.shown('#tray-sheet'), 'the next Back closes it');
  await afterPopup(s);
});

test('the notes palette is closed by Back before the light or the selection, its chip first as Esc clears it, and the selection stands', async () => {
  const s = await selectedWithEntry({ palette: true });
  s.activate();
  s.page.run("openNotes({ kind: 'card-notes', id: '3' })");
  assert.strictEqual(s.page.run('notesUi.sub.kind'), 'card');
  await s.back();
  assert.ok(s.page.run('notesUi.sub') !== null, 'the palette stays: its chip went');
  assert.strictEqual(s.page.run('notesUi.sub.kind'), 'none');
  assert.deepStrictEqual(s.picked(), ['2'], 'and the selection stands');
  assert.ok(s.onEntry());
  await s.back();
  assert.strictEqual(s.page.run('notesUi.sub'), null, 'the next Back closes the palette');
  await afterPopup(s);
});

test('the notes palette opened from the card menu over the details is closed by Back before the details', async () => {
  const s = await open({ palette: true });
  await s.openCard(3);
  s.detailMenu();
  s.settle();
  assert.ok(s.menuOpen());
  s.activate();
  s.page.run('hideContextMenu(); openNotes({})');
  assert.ok(s.page.run('notesUi.sub') !== null && !s.menuOpen());
  await s.back();
  assert.strictEqual(s.page.run('notesUi.sub'), null, 'the palette closed');
  assert.ok(s.detailUp(), 'and the details stand under it');
  await s.back();
  assert.ok(!s.detailUp(), 'the next Back closes the details');
});

test('Back closes each of the four as Esc closes it, press for press, with a selection standing', async () => {
  for (const [name, popup] of Object.entries(OWN_ESC)) {
    const traces = [];
    for (const press of [esc, (s) => s.back()]) {
      const s = await selectedWithEntry({ palette: name === 'notes-palette' });
      s.activate();
      popup.stand(s);
      assert.ok(popup.up(s), `${name} stands`);
      const seen = [[popup.up(s), s.picked().join()]];
      for (let i = 0; i < 3; i++) { await press(s); seen.push([popup.up(s), s.picked().join()]); }
      traces.push(seen);
    }
    assert.deepStrictEqual(traces[1], traces[0], `${name}: Back takes the steps Esc takes`);
    assert.deepStrictEqual(traces[1].map(([up]) => up), [true, false, false, false], `${name}: one Back closes it, the next ones step the selection`);
  }
});

// The inner layers a Back closes alone, as Esc does, each before the layer around it. Stand-ins for what the
// page draws where the test has no DOM for it: a note's own menu (notesUi.menu), and the scratchpad's narrow
// file list (the element .spf.open, which the page asks the document for).
function noteMenuStandIn(s) {
  const seen = { removed: 0 };
  s.page.ctx.__noteMenu = { el: { contains: () => false, remove() { seen.removed++; } }, row: { isConnected: false, classList: { contains: () => false }, focus() {} }, items: [], acts: {} };
  s.page.run('notesUi.menu = __noteMenu');
  return seen;
}
function fileListStandIn(s) {
  const seen = { open: true, bar: [] };
  const bar = { setAttribute: (name, value) => seen.bar.push([name, value]), focus() { seen.focused = true; } };
  const list = { classList: { remove: () => { seen.open = false; }, contains: () => seen.open }, querySelector: () => bar };
  const realQuery = s.page.ctx.document.querySelector;
  s.page.ctx.document.querySelector = (sel) => (sel === '.spf.open' ? (seen.open ? list : null) : realQuery(sel));
  return seen;
}
const atPhoneWidth = (s) => Object.assign(s.page.ctx, { innerWidth: 390, innerHeight: 844 });

test('an open panel of the card menu is closed by Back alone, the nested panel before the group\'s, then the menu, then the selection steps', async () => {
  const s = await selectedWithEntry({ menu: true });
  atPhoneWidth(s);
  const el = (id) => s.page.ctx.document.querySelector('#' + id);
  const open = (id) => el(id).parent.classList.contains('open');
  const click = (id) => s.menu.fire('click', { target: el(id), detail: 1 });
  s.activate();
  s.page.run('menuSubject = cardMenuFor(selectedIds, "2"); showContextMenu(10, 10)');
  click('ctx-explore');
  click('ctx-path');
  assert.deepStrictEqual([s.menuOpen(), open('ctx-explore'), open('ctx-path')], [true, true, true], 'the Explore panel and the Path panel in it stand');
  await s.back();
  assert.deepStrictEqual([s.menuOpen(), open('ctx-explore'), open('ctx-path')], [true, true, false], 'the first Back closes the nested panel and leaves the one around it');
  await s.back();
  assert.deepStrictEqual([s.menuOpen(), open('ctx-explore'), open('ctx-path')], [true, false, false], 'the next closes the group\'s own panel and leaves the menu');
  assert.deepStrictEqual(s.picked(), ['2'], 'the selection stands');
  assert.ok(s.onEntry(), 'and the page is on its entry again');
  await s.back();
  assert.strictEqual(s.menuOpen(), false, 'then the menu closes');
  await afterPopup(s);
});

test('a note\'s own menu in the notes palette is closed by Back alone, before the palette', async () => {
  const s = await selectedWithEntry({ palette: true });
  s.activate();
  s.page.run('openNotes({})');
  const menu = noteMenuStandIn(s);
  await s.back();
  assert.deepStrictEqual([menu.removed, s.page.run('notesUi.menu'), s.page.run('notesIsOpen()')], [1, null, true], 'the menu went and the palette stays');
  await s.back();
  assert.strictEqual(s.page.run('notesIsOpen()'), false, 'the next Back closes the palette');
  await afterPopup(s);
});

test('the scratchpad\'s narrow file list is closed by Back alone, before the palette it stands in, and a row menu in it before the list', async () => {
  const s = await selectedWithEntry({ palette: true });
  s.activate();
  s.page.run('openNotes({})');
  const list = fileListStandIn(s);
  const menu = noteMenuStandIn(s);
  await s.back();
  assert.deepStrictEqual([menu.removed, list.open], [1, true], 'a row menu in the list closes first');
  await s.back();
  assert.deepStrictEqual([list.open, list.bar, list.focused, s.page.run('notesIsOpen()')], [false, [['aria-expanded', 'false']], true, true], 'then the list, which goes back to its bar, and the palette stays');
  await s.back();
  assert.strictEqual(s.page.run('notesIsOpen()'), false, 'then the palette');
  await afterPopup(s);
});

test('Back takes all sixteen layers down in the order Esc keeps, one per Back, with the four popups and the three inner layers among them', async () => {
  const names = ['date-picker', 'group-dialog', 'tray', 'more-menu', 'menu-panel', 'menu', 'notifications', 'settings', 'edit-form', 'bulk-popup', 'note-menu', 'scratch-list', 'notes-palette', 'search-panel', 'light', 'selection'];
  const s = await selectedWithEntry({ palette: true, menu: true });
  atPhoneWidth(s);
  s.activate();
  s.page.run('setPinnedLight("3")');
  s.page.run('menuSubject = cardMenuFor(selectedIds, "3"); showContextMenu(0, 0)');
  s.menu.fire('click', { target: s.page.ctx.document.querySelector('#ctx-explore'), detail: 1 });
  s.page.run('moreMenuOpen()');
  s.page.run('setSearchPanelOpen(true)');
  s.page.run('openNotes({})');
  const note = noteMenuStandIn(s);
  const list = fileListStandIn(s);
  for (const sel of ['#notif-modal', '#prefs-sheet', '#modal', '#bulk-status', '#tray-sheet']) s.elements[sel].classList.remove('hidden');
  s.page.run('openGroupDialog("Group", { querySelector: () => null })');
  s.page.run('datePickerFor = { value: "", focus() {} }');
  const up = () => names.filter((name) => ({
    'date-picker': s.page.run('datePickerFor') !== null, 'group-dialog': s.shown('#group-dialog'), tray: s.shown('#tray-sheet'),
    'more-menu': s.page.run('moreMenuIsOpen()'), 'menu-panel': s.page.run('menuNestOpenTopGroup() !== null'), menu: s.menuOpen(), notifications: s.shown('#notif-modal'), settings: s.shown('#prefs-sheet'),
    'edit-form': s.shown('#modal'), 'bulk-popup': s.shown('#bulk-status'), 'note-menu': note.removed === 0, 'scratch-list': list.open, 'notes-palette': s.page.run('notesUi.sub') !== null,
    'search-panel': s.page.run('searchPanelOpen'), light: s.litId() !== null, selection: s.picked().length > 0,
  })[name]);
  const seen = [up().join()];
  for (let i = 0; i < 20 && up().length; i++) { await s.back(); seen.push(up().join()); }
  assert.deepStrictEqual(seen, names.map((_, i) => names.slice(i).join()).concat(['']), "each Back takes the first of what stands, in Esc's order");
});
