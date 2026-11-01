const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const { PHONE_WIDTH_QUERY } = require('../../plugin/skills/web/web/phone-width');

// The long press on a card at the phone layout, run through the listeners the real page puts on the
// document and on the card under the finger, the way the browser calls them: the hold lights the card
// and the sets On hover show ticks, the lift opens the card menu once, and the browser's own contextmenu
// and click are held back. The rule is card-press.test.js's; the browser scenarios run it with a finger.

const card = (id, over = {}) => ({
  id: String(id), title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
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

async function open({ phone = true, view = 'board' } = {}) {
  const clock = { at: 1000, timers: [] };
  const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
  const menu = hidden();
  const lit = hidden();
  const closed = ['#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
  const stored = { 'kanban.kanban.view.mode': view };
  const page = loadPage({ board: makeBoard(), stored, elements: { '#graph-view': control(), '#context-menu': menu, '#ctx-lit': lit, ...Object.fromEntries(closed.map((sel) => [sel, hidden()])) } });
  const crossings = [];
  page.ctx.matchMedia = (q) => ({ get matches() { return q === PHONE_WIDTH_QUERY && phone; }, addEventListener: (type, fn) => crossings.push(fn) });
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  page.ctx.performance = { now: () => clock.at };
  page.ctx.setTimeout = (fn, ms) => { const t = { fn, at: clock.at + ms }; clock.timers.push(t); return t; };
  page.ctx.clearTimeout = (t) => { clock.timers = clock.timers.filter((o) => o !== t); };
  const opened = [];
  page.ctx.openCard = (id) => { opened.push(String(id)); };
  const s = {
    page, menu, lit, opened, clock,
    cross(to) { phone = to; crossings.forEach((fn) => fn({})); },
    wait(ms) {
      clock.at += ms;
      for (const t of clock.timers.filter((o) => o.at <= clock.at)) { clock.timers = clock.timers.filter((o) => o !== t); t.fn(); }
    },
    litIds: () => { const l = page.run('hoverLit'); return l ? [...l].map(String).sort() : null; },
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    picked: () => [...page.run('selectedIds')].map(String).sort(),
    menuOpen: () => !menu.classList.contains('hidden'),
    subject: () => JSON.parse(JSON.stringify(page.run('menuSubject'))),
  };
  return s;
}

// What a finger lands on: the card's tile, with the listeners the page binds to it for the length of the
// touch. `fire` calls them as the browser does, an event at a time.
function tile(id) {
  const el = { dataset: { id: String(id) } };
  const listeners = {};
  const target = new Proxy({}, {
    get: (t, key) => {
      if (key === 'closest') return (sel) => (sel.split(',').some((p) => p.trim() === '.card-el') ? el : null);
      if (key === 'addEventListener') return (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
      if (key === 'removeEventListener') return (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); };
      if (key === 'fire') return (type, event = {}) => { const e = { cancelable: true, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; }, ...event }; (listeners[type] || []).slice().forEach((fn) => fn(e)); return e; };
      if (key === 'listening') return (type) => (listeners[type] || []).length;
      return harmless(String(key));
    },
  });
  return target;
}

const touchAt = (x, y) => ({ clientX: x, clientY: y });
function down(s, target, x = 100, y = 200, extra = {}) {
  return s.page.fireDocument('touchstart', { target, touches: [touchAt(x, y)], changedTouches: [touchAt(x, y)], ...extra });
}
const moveTo = (target, x, y) => target.fire('touchmove', { touches: [touchAt(x, y)] });
const lift = (target) => target.fire('touchend', { touches: [], changedTouches: [touchAt(0, 0)] });

// A press that is held and lifted in place: the finger down for 600 ms, then up.
function longPress(s, id, x = 100, y = 200) {
  const target = tile(id);
  down(s, target, x, y);
  s.wait(600);
  return { target, up: () => lift(target) };
}

const clickOn = (s, target, extra = {}) => s.page.fireDocument('click', { target, detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });
const cardTarget = (id) => tile(id);
const outside = () => new Proxy({}, { get: (t, key) => (key === 'closest' ? () => null : harmless(String(key))) });
const insideMenu = () => new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '#context-menu' ? {} : null) : harmless(String(key))) });
const contextmenuOn = (s, target) => s.page.fireDocument('contextmenu', { target, clientX: 100, clientY: 200 });
const a = (id) => ({ kind: 'card', id: String(id) });

test('holding a card 500 ms lights it and the sets On hover show ticks, before the finger lifts', async () => {
  const s = await open();
  const target = tile(2);
  down(s, target);
  s.wait(499);
  assert.strictEqual(s.litIds(), null, 'not lit before 500 ms');
  s.wait(1);
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3'], 'the card, what it waits for and its child: the default sets');
  assert.strictEqual(s.menuOpen(), false, 'the menu waits for the lift');
});

test('the light is its own state: it holds while the hover clears, as it does when the menu takes the focus', async () => {
  const s = await open();
  const { up } = longPress(s, 2);
  up();
  assert.strictEqual(s.page.run('hoveredId'), null);
  s.page.fireDocument('focusin', { target: outside() });
  assert.strictEqual(s.page.run('hoveredId'), null, 'the menu focus moved the hover off every card');
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
});

test('lifting without moving opens the card menu for that card, once', async () => {
  const s = await open();
  const { up } = longPress(s, 2);
  assert.strictEqual(s.menuOpen(), false);
  up();
  assert.strictEqual(s.menuOpen(), true);
  const subject = s.subject();
  assert.deepStrictEqual([subject.ids, subject.clicked, subject.inSelection], [['2'], '2', false]);
});

test('lifting on a selected card opens the menu for the whole selection', async () => {
  const s = await open();
  for (const id of ['3', '4', '2']) { clickOn(s, cardTarget(id)); s.wait(1000); }
  assert.deepStrictEqual(s.picked(), ['2', '3', '4']);
  const { up } = longPress(s, 4);
  up();
  const subject = s.subject();
  assert.deepStrictEqual([subject.ids.slice().sort(), subject.inSelection], [['2', '3', '4'], true]);
});

test('the lift is cancelled by the browser\'s touchcancel, and a touch that lifts before 500 ms is a tap: neither lights nor opens', async () => {
  const s = await open();
  const early = tile(2);
  down(s, early);
  s.wait(300);
  lift(early);
  s.wait(1000);
  assert.strictEqual(s.litIds(), null);
  assert.strictEqual(s.menuOpen(), false);
  const taken = tile(2);
  down(s, taken);
  s.wait(600);
  taken.fire('touchcancel', {});
  assert.strictEqual(s.menuOpen(), false, 'a cancelled touch is no lift');
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3'], 'but the hold had lit the card');
});

test('a touch that moves more than 10 px before 500 ms is a scroll: no light, no menu', async () => {
  const s = await open();
  const target = tile(2);
  down(s, target);
  s.wait(200);
  moveTo(target, 100, 230);
  s.wait(1000);
  lift(target);
  assert.strictEqual(s.litIds(), null);
  assert.strictEqual(s.menuOpen(), false);
});

test('a finger that moves after the hold keeps the light and opens no menu when it lifts', async () => {
  const s = await open();
  const { target } = longPress(s, 2);
  moveTo(target, 100, 260);
  const end = lift(target);
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
  assert.strictEqual(s.menuOpen(), false);
  assert.strictEqual(end.defaultPrevented, false, 'the touch is left to whatever moved with it');
});

test('a second finger ends the press: a pinch is not a long press', async () => {
  const s = await open();
  const target = tile(2);
  down(s, target);
  s.wait(300);
  down(s, tile(3), 200, 200, { touches: [touchAt(100, 200), touchAt(200, 200)] });
  s.wait(1000);
  assert.strictEqual(s.litIds(), null);
});

test('a hold on a button or a link inside a card, or on nothing, is not a press', async () => {
  const s = await open();
  const el = { dataset: { id: '2' } };
  const button = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel.includes('.card-el') || sel.includes('button') ? el : null) : harmless(String(key))) });
  down(s, button);
  s.wait(1000);
  assert.strictEqual(s.litIds(), null);
  down(s, outside());
  s.wait(1000);
  assert.strictEqual(s.litIds(), null);
});

test('the touch listeners are bound to the card under the finger for the length of the touch and no longer', async () => {
  const s = await open();
  const target = tile(2);
  down(s, target);
  assert.deepStrictEqual(['touchmove', 'touchend', 'touchcancel'].map((t) => target.listening(t)), [1, 1, 1]);
  s.wait(600);
  lift(target);
  assert.deepStrictEqual(['touchmove', 'touchend', 'touchcancel'].map((t) => target.listening(t)), [0, 0, 0]);
});

test('the lift is cancelled so the browser makes no click, and a tap that did not hold is left alone', async () => {
  const s = await open();
  const held = longPress(s, 2);
  assert.strictEqual(held.up().defaultPrevented, true);
  const tapTarget = tile(3);
  down(s, tapTarget);
  s.wait(100);
  assert.strictEqual(lift(tapTarget).defaultPrevented, false);
});

// --- Android: the browser's own contextmenu -------------------------------------------------------

test('Android\'s contextmenu during the hold opens nothing and is held back, and the lift opens the menu once', async () => {
  const s = await open();
  const target = tile(2);
  down(s, target);
  s.wait(400);
  const early = contextmenuOn(s, target);
  assert.strictEqual(early.defaultPrevented, true, 'the browser\'s own menu is held back');
  assert.strictEqual(s.menuOpen(), false);
  s.wait(200);
  const mid = contextmenuOn(s, target);
  assert.strictEqual(mid.defaultPrevented, true);
  assert.strictEqual(s.menuOpen(), false, 'the menu waits for the lift');
  lift(target);
  assert.strictEqual(s.menuOpen(), true);
  const late = contextmenuOn(s, target);
  assert.strictEqual(late.defaultPrevented, true, 'and the echo after the lift is held back as well');
  assert.deepStrictEqual(s.subject().ids, ['2'], 'it did not reopen the menu for another subject');
});

test('a contextmenu with no touch down, a mouse right-click on a narrow window, opens the menu as it always did', async () => {
  const s = await open();
  const e = contextmenuOn(s, cardTarget(2));
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(s.menuOpen(), true);
  assert.deepStrictEqual(s.subject().ids, ['2']);
  assert.strictEqual(s.page.run('hoverLit'), null, 'a right-click lights nothing of its own');
});

test('800 ms after the lift the browser\'s contextmenu is a right-click again', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.page.run('hideContextMenu()');
  s.wait(801);
  contextmenuOn(s, cardTarget(3));
  assert.strictEqual(s.menuOpen(), true);
  assert.deepStrictEqual(s.subject().ids, ['3']);
});

// --- the click the lift would make ----------------------------------------------------------------

test('the click under the lifted finger does nothing else: it opens no card, selects none and leaves the menu and the light', async () => {
  const s = await open();
  const held = longPress(s, 2);
  held.up();
  clickOn(s, held.target);
  assert.deepStrictEqual(s.opened, []);
  assert.deepStrictEqual(s.picked(), []);
  assert.strictEqual(s.menuOpen(), true);
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
  s.wait(801);
  clickOn(s, outside());
  assert.strictEqual(s.menuOpen(), false, 'a click 800 ms later is a tap');
});

// --- the light stays, and the next tap ends it -------------------------------------------------------

test('closing the menu leaves the light on, whichever way it closes', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.page.run('hideContextMenu()');
  assert.strictEqual(s.menuOpen(), false);
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
});

test('with the menu open at phone width a tap outside it only closes the menu: no selecting, no light lost', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.wait(1000);
  clickOn(s, cardTarget(4));
  assert.strictEqual(s.menuOpen(), false);
  assert.deepStrictEqual(s.picked(), [], 'the tap on card 4 did not select it');
  assert.deepStrictEqual(s.opened, []);
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3'], 'and the light stays');
});

test('a tap on the menu itself is not outside it', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.wait(1000);
  clickOn(s, insideMenu());
  assert.strictEqual(s.menuOpen(), true);
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
});

test('the next tap, the menu being shut, ends the light, and a tap on a card then does its normal job', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.wait(1000);
  clickOn(s, outside());
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3'], 'that tap closed the menu');
  clickOn(s, cardTarget(4));
  assert.deepStrictEqual(s.picked(), ['4'], 'the tap selected the card: a phone tap toggles');
  assert.strictEqual(s.litIds(), null, 'and ended the light');
});

test('a tap on empty space drops the light and nothing else: the selection stays', async () => {
  const s = await open();
  clickOn(s, cardTarget(4));
  s.wait(1000);
  longPress(s, 2).up();
  s.wait(1000);
  s.page.run('hideContextMenu()');
  clickOn(s, outside());
  assert.strictEqual(s.litIds(), null);
  assert.deepStrictEqual(s.picked(), ['4']);
  assert.deepStrictEqual(s.opened, []);
});

test('Esc closes the menu first and then drops the light, before it steps the selection back', async () => {
  const s = await open();
  clickOn(s, cardTarget(4));
  s.wait(1000);
  longPress(s, 2).up();
  const esc = () => s.page.fireDocument('keydown', { key: 'Escape', target: outside(), repeat: false });
  esc();
  assert.strictEqual(s.menuOpen(), false);
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3'], 'the first Esc shut the menu');
  esc();
  assert.strictEqual(s.litIds(), null, 'the second Esc dropped the light');
  assert.deepStrictEqual(s.picked(), ['4'], 'and left the selection alone');
  esc();
  assert.deepStrictEqual(s.picked(), [], 'the third stepped the selection back');
});

test('a hold on another card moves the light to it', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.wait(1000);
  s.page.run('hideContextMenu()');
  longPress(s, 4).up();
  assert.deepStrictEqual(s.litIds(), ['4']);
  assert.deepStrictEqual(s.subject().ids, ['4']);
});

test('a poll that repaints the board carries the light with it', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.page.run('renderBoard()');
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
});

// --- Select lit -----------------------------------------------------------------------------------

test('the menu opened by a long press shows Select lit (N) when the light holds more than the card, N the lit cards the view shows', async () => {
  const s = await open();
  longPress(s, 2).up();
  assert.strictEqual(s.lit.classList.contains('hidden'), false);
  assert.strictEqual(String(s.lit.textContent), 'Select lit (3)');
  assert.deepStrictEqual(s.subject().lit, ['2', '1', '3']);
});

test('a card the light holds alone has no Select lit, and neither has a right-click menu', async () => {
  const s = await open();
  longPress(s, 4).up();
  assert.strictEqual(s.lit.classList.contains('hidden'), true, 'card 4 has no relations');
  s.page.run('hideContextMenu()');
  contextmenuOn(s, cardTarget(2));
  assert.strictEqual(s.lit.classList.contains('hidden'), true, 'the right-click menu is the desk\'s');
});

test('N counts only the lit cards the view shows: a search that hides one leaves it out', async () => {
  const s = await open();
  s.page.input.typed('#2 | #3');
  assert.deepStrictEqual([...s.page.run('shownCardIds()')].map(String).sort(), ['2', '3'], 'the box shows two of the three');
  longPress(s, 2).up();
  assert.strictEqual(String(s.lit.textContent), 'Select lit (2)');
  assert.deepStrictEqual(s.subject().lit, ['2', '3']);
});

test('Select lit adds the lit cards to the selection and shuts the menu, and the light stays', async () => {
  const s = await open();
  clickOn(s, cardTarget(4));
  s.wait(1000);
  longPress(s, 2).up();
  s.lit.fire('click', {});
  assert.deepStrictEqual(s.picked(), ['1', '2', '3', '4']);
  assert.deepStrictEqual(s.selection(), { anchor: a(4), additions: [a(2), a(1), a(3)] }, 'added after what was selected, the pressed card first');
  assert.strictEqual(s.menuOpen(), false);
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
});

// --- the desk ---------------------------------------------------------------------------------------

test('the light belongs to the phone layout: widening the window to the desk drops it, and narrowing it again lets a hold light a card once more', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.page.run('hideContextMenu()');
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
  s.cross(false);
  assert.strictEqual(s.litIds(), null, 'no light lingers at the desk');
  const target = tile(2);
  down(s, target);
  s.wait(1000);
  assert.strictEqual(s.litIds(), null, 'and a hold at the desk width starts no press');
  s.cross(true);
  longPress(s, 2).up();
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
  assert.strictEqual(s.menuOpen(), true);
});

test('at the desk width a touch on a card starts no press', async () => {
  const s = await open({ phone: false });
  const target = tile(2);
  down(s, target);
  s.wait(1000);
  assert.strictEqual(target.listening('touchend'), 0);
  assert.strictEqual(s.litIds(), null);
  lift(target);
  assert.strictEqual(s.menuOpen(), false);
});

test('at the desk width a click outside an open menu does what it does today: the click works and the menu closes', async () => {
  const s = await open({ phone: false });
  contextmenuOn(s, cardTarget(2));
  assert.strictEqual(s.menuOpen(), true);
  clickOn(s, cardTarget(3));
  assert.strictEqual(s.menuOpen(), false);
  assert.deepStrictEqual(s.opened, ['3'], 'the desk click opened the card, as it does with the menu shut');
});

test('hover does what it did: the pointer lights a card and moves off it', async () => {
  const s = await open({ phone: false });
  s.page.fireDocument('mouseover', { target: cardTarget(2) });
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3']);
  s.page.fireDocument('mouseout', { target: cardTarget(2), relatedTarget: null });
  assert.strictEqual(s.litIds(), null);
});
