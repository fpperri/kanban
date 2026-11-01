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
  const graph = control();
  const boardEl = control();
  const fake = { tiles: [] };
  const documentExtras = {
    elementFromPoint: (x, y) => { const hit = fake.tiles.find((t) => y >= t.top && y < t.top + 90); return hit ? hit.target : null; },
    querySelectorAll: (sel) => (sel === '.card-el' ? fake.tiles.map((t) => t.el) : harmless('all')),
  };
  const page = loadPage({ board: makeBoard(), stored, documentExtras, elements: { '#board': boardEl, '#graph-view': graph, '#context-menu': menu, '#ctx-lit': lit, ...Object.fromEntries(closed.map((sel) => [sel, hidden()])) } });
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
    page, menu, lit, graph, boardEl, fake, opened, clock,
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
function tile(id, { el = { dataset: { id: String(id) }, closest: () => null } } = {}) {
  const listeners = {};
  const passive = {};
  const target = new Proxy({}, {
    get: (t, key) => {
      if (key === 'closest') return (sel) => (sel.split(',').some((p) => p.trim() === '.card-el') ? el : null);
      if (key === 'addEventListener') return (type, fn, options) => { (listeners[type] = listeners[type] || []).push(fn); passive[type] = !!(options && options.passive); };
      if (key === 'passiveOf') return (type) => passive[type];
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

test('a finger that comes down after the lift ends the echo: a tap on an entry of the menu within 800 ms is a tap and runs the entry', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.wait(300);
  const entry = insideMenu();
  down(s, entry);
  const click = clickOn(s, entry);
  assert.strictEqual(click.defaultPrevented, false, 'the click is not swallowed');
  s.lit.fire('click', {});
  assert.deepStrictEqual(s.picked(), ['1', '2', '3'], 'Select lit ran');
  assert.strictEqual(s.menuOpen(), false);
});

test('a tap on a card within 800 ms of the lift is a tap as well: with the menu open it only closes it', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.wait(300);
  const target = tile(4);
  down(s, target);
  lift(target);
  clickOn(s, target);
  assert.strictEqual(s.menuOpen(), false);
  assert.deepStrictEqual(s.picked(), []);
  assert.deepStrictEqual(s.litIds(), ['1', '2', '3'], 'the menu was closed and nothing else');
});

test('a finger that comes down after the lift ends the hold-back of the browser\'s contextmenu too: its own long press on the Graph\'s empty space opens the canvas menu', async () => {
  const s = await open({ view: 'graph' });
  longPress(s, 2).up();
  s.page.run('hideContextMenu()');
  s.wait(100);
  const empty = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '#graph-view .graph-canvas' ? {} : null) : harmless(String(key))) });
  down(s, empty);
  s.wait(400);
  contextmenuOn(s, empty);
  assert.strictEqual(s.menuOpen(), true, 'a contextmenu of the new finger is not the old one\'s echo');
  assert.strictEqual(s.subject().canvas, true);
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

// --- a tap before the press is not the first tap of a later double tap -------------------------------

test('the tap that only closes the menu is no first tap: a double tap on a card tapped before the press does not open it', async () => {
  const s = await open();
  clickOn(s, cardTarget(4));
  s.wait(1000);
  longPress(s, 2).up();
  s.wait(1000);
  assert.deepStrictEqual(s.picked(), ['4']);
  clickOn(s, cardTarget(4));
  assert.strictEqual(s.menuOpen(), false, 'the first tap of the pair closed the menu');
  assert.deepStrictEqual(s.picked(), ['4'], 'and selected nothing');
  clickOn(s, cardTarget(4), { detail: 2 });
  assert.deepStrictEqual(s.opened, [], 'the second tap is a first tap again: the old tap on 4 is gone');
  assert.deepStrictEqual(s.picked(), [], 'it toggled the selected card out, as a first tap does');
});

test('the tap that closes a right-click menu is no first tap either: the gate forgets it where no press came before', async () => {
  const s = await open();
  clickOn(s, cardTarget(4));
  s.wait(1000);
  contextmenuOn(s, cardTarget(2));
  assert.strictEqual(s.menuOpen(), true);
  clickOn(s, cardTarget(4));
  assert.strictEqual(s.menuOpen(), false);
  clickOn(s, cardTarget(4), { detail: 2 });
  assert.deepStrictEqual(s.opened, []);
  assert.deepStrictEqual(s.picked(), []);
});

test('a click the echo swallows forgets the last tap too', async () => {
  const s = await open();
  longPress(s, 2).up();
  s.page.run('hideContextMenu()');
  s.page.run("tapBefore = { id: '4', selection: NO_SELECTION, rangeStart: null, after: selectionState.selection }");
  clickOn(s, cardTarget(4));
  s.wait(1000);
  clickOn(s, cardTarget(4), { detail: 2 });
  assert.deepStrictEqual(s.opened, [], 'no tap on 4 is left to be the first of a pair');
});

test('a hold forgets the last tap: a double tap after a press, however its menu closed, does not open a card tapped before it', async () => {
  const s = await open();
  clickOn(s, cardTarget(4));
  s.wait(1000);
  longPress(s, 2).up();
  s.page.run('hideContextMenu()');
  s.wait(1000);
  clickOn(s, cardTarget(4), { detail: 2 });
  assert.deepStrictEqual(s.opened, []);
  assert.deepStrictEqual(s.picked(), []);
});

test('a double tap with nothing in between still opens the card and leaves the selection as it was', async () => {
  const s = await open();
  clickOn(s, cardTarget(1));
  s.wait(1000);
  clickOn(s, cardTarget(4));
  clickOn(s, cardTarget(4), { detail: 2 });
  assert.deepStrictEqual(s.opened, ['4']);
  assert.deepStrictEqual(s.picked(), ['1'], 'the selection from before the first tap');
});

// --- the Graph: the pinned light wins over the hover and the focus -------------------------------

const dot = (id) => {
  const el = { dataset: { id: String(id) } };
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.graph-node' ? el : null) : harmless(String(key))) });
};
const lineHit = (link) => {
  const el = { dataset: { link: String(link) } };
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (sel === '.graph-link-hit' ? el : null) : harmless(String(key))) });
};

// The Graph drawn is stood in for by what its handlers read: the ids it draws. `focused` and `lines` list what they asked to light.
async function openGraph() {
  const s = await open({ view: 'graph' });
  s.page.run("graphCur = { model: { byId: new Map([['1', {}], ['2', {}], ['4', {}]]) }, hoverLine: null }");
  s.focused = [];
  s.lines = [];
  s.page.ctx.graphSetFocus = (id) => { s.focused.push(String(id)); };
  s.page.ctx.graphSetLineFocus = (i) => { s.lines.push(i); };
  s.page.ctx.graphRestFocus = () => { s.focused.push('rest'); };
  return s;
}

test('on the Graph a dot the pointer or the focus reaches does not take the light from the card held', async () => {
  const s = await openGraph();
  longPress(s, 2).up();
  s.focused.length = 0;
  s.graph.fire('mouseover', { type: 'mouseover', target: dot(4) });
  s.graph.fire('focusin', { type: 'focusin', target: dot(4) });
  assert.deepStrictEqual(s.focused, ['2', '2'], 'the light is on 2 each time: it asked for the pinned card, never for 4');
});

test('on the Graph a line the pointer reaches does not take the light from the card held either', async () => {
  const s = await openGraph();
  longPress(s, 2).up();
  s.focused.length = 0;
  s.graph.fire('mouseover', { type: 'mouseover', target: lineHit(3) });
  assert.deepStrictEqual(s.lines, []);
  assert.deepStrictEqual(s.focused, ['2']);
});

test('on the Graph the pointer moving from one dot to another leaves the light on the card held', async () => {
  const s = await openGraph();
  longPress(s, 2).up();
  s.focused.length = 0;
  s.graph.fire('mouseout', { type: 'mouseout', target: dot(1), relatedTarget: dot(4) });
  assert.deepStrictEqual(s.focused, ['2']);
  s.focused.length = 0;
  s.graph.fire('mouseout', { type: 'mouseout', target: dot(1), relatedTarget: null });
  assert.deepStrictEqual(s.focused, ['2'], 'and so does the pointer leaving the dots');
});

test('on the Graph, with no card held, the hover and the focus light the dot they reach as they did', async () => {
  const s = await openGraph();
  s.graph.fire('mouseover', { type: 'mouseover', target: dot(4) });
  assert.deepStrictEqual(s.focused, ['4']);
  s.graph.fire('mouseover', { type: 'mouseover', target: lineHit(3) });
  assert.deepStrictEqual(s.lines, [3]);
  s.focused.length = 0;
  s.graph.fire('mouseout', { type: 'mouseout', target: dot(4), relatedTarget: dot(1) });
  assert.deepStrictEqual(s.focused, ['1']);
  s.focused.length = 0;
  s.graph.fire('mouseout', { type: 'mouseout', target: dot(1), relatedTarget: null });
  assert.deepStrictEqual(s.focused, ['rest']);
});

test('on the Graph the light goes back to the pointer when the next tap ends the card held', async () => {
  const s = await openGraph();
  longPress(s, 2).up();
  s.wait(1000);
  s.page.run('hideContextMenu()');
  clickOn(s, outside());
  assert.strictEqual(s.page.run('pinnedLitId'), null);
  s.focused.length = 0;
  s.graph.fire('mouseover', { type: 'mouseover', target: dot(4) });
  assert.deepStrictEqual(s.focused, ['4']);
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

// --- hold and drag on the Board -----------------------------------------------------------------------

// The Board drawn as a column of tiles under the finger: tile i (from 0) spans y 100 * i to 100 * i + 90, at
// every x. Each tile is the one element the page asks about, whether the finger went down on it or
// document.elementFromPoint finds it, and carries a class list the page paints in place. `board` false
// draws the tiles of another view (a Calendar chip), outside #board.
function drawBoard(s, ids, { board = true } = {}) {
  s.fake.tiles = ids.map((id, i) => {
    const names = new Set();
    const el = {
      dataset: { id: String(id) },
      classList: { add: (c) => names.add(c), remove: (c) => names.delete(c), contains: (c) => names.has(c), toggle: (c, on) => { if (on === undefined ? !names.has(c) : on) names.add(c); else names.delete(c); } },
      closest: (sel) => (sel === '#board' && board ? {} : null),
    };
    return { id: String(id), top: 100 * i, el, target: tile(id, { el }) };
  });
  const find = (id) => s.fake.tiles.find((t) => t.id === String(id));
  return {
    target: (id) => find(id).target,
    y: (id) => find(id).top + 40,
    painted: (id) => find(id).el.classList.contains('selected'),
  };
}

// The page's renders counted from here on.
function countRenders(s) {
  s.renders = 0;
  const real = s.page.ctx.renderBoard;
  s.page.ctx.renderBoard = (...a) => { s.renders++; return real(...a); };
}

// A finger down on a tile, held past the hold: the board drawn, the page's renders counted.
async function holdOn(id, { ids = [1, 2, 3, 4], board = true } = {}) {
  const s = await open();
  const b = drawBoard(s, ids, { board });
  countRenders(s);
  const target = b.target(id);
  down(s, target, 50, b.y(id));
  s.wait(600);
  return { s, b, target, to: (over) => moveTo(target, 50, b.y(over)) };
}

test('after the hold, a finger that moves over the Board\'s tiles selects every tile it passes over, the tile held first', async () => {
  const { s, to } = await holdOn(1);
  to(2);
  to(3);
  assert.deepStrictEqual(s.picked(), ['1', '2', '3']);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2), a(3)] }, 'in the order the finger passed them');
});

test('a quick drag that jumps over tiles between two touch samples still selects them: every tile on the way counts', async () => {
  const { s, target, to } = await holdOn(1);
  to(4);
  assert.deepStrictEqual(s.picked(), ['1', '2', '3', '4']);
  assert.deepStrictEqual(s.selection(), { anchor: a(1), additions: [a(2), a(3), a(4)] }, 'in the order the finger crossed them');
  lift(target);
});

test('the first move after the hold counts from the point the finger was held at', async () => {
  const s = await open();
  const b = drawBoard(s, [1, 2, 3, 4]);
  const target = b.target(1);
  down(s, target, 50, b.y(1));
  s.wait(600);
  moveTo(target, 50, b.y(3) + 2);
  assert.deepStrictEqual(s.picked(), ['1', '2', '3']);
});

test('a finger that moves a little over the tile it holds selects that tile alone', async () => {
  const { s, target } = await holdOn(2);
  moveTo(target, 50, 125);
  assert.deepStrictEqual(s.picked(), ['2']);
});

test('the tiles are painted selected as the finger passes, in place: no render until the finger lifts, and one then', async () => {
  const { s, b, target, to } = await holdOn(1);
  assert.deepStrictEqual([1, 2, 3].map(b.painted), [false, false, false], 'the hold paints nothing');
  to(2);
  assert.deepStrictEqual([1, 2, 3].map(b.painted), [true, true, false]);
  to(3);
  assert.deepStrictEqual([1, 2, 3, 4].map(b.painted), [true, true, true, false]);
  assert.strictEqual(s.renders, 0, 'nothing was drawn again while the finger moved');
  lift(target);
  assert.strictEqual(s.renders, 1, 'the lift draws the board once');
  assert.deepStrictEqual(s.picked(), ['1', '2', '3']);
});

test('the lift writes the cards into the search box, once, as a tap on them would: the box says what is picked', async () => {
  const { s, target, to } = await holdOn(1);
  to(2);
  to(3);
  assert.strictEqual(s.page.input.value, '', 'the box waits for the lift');
  lift(target);
  assert.strictEqual(s.page.input.value, '#1 | #2 | #3');
});

test('lifting ends it: no menu opens, the tiles stay selected, and the touch is cancelled so the browser makes no click', async () => {
  const { s, target, to } = await holdOn(1);
  to(2);
  const end = lift(target);
  assert.strictEqual(s.menuOpen(), false);
  assert.deepStrictEqual(s.picked(), ['1', '2']);
  assert.strictEqual(end.defaultPrevented, true);
  clickOn(s, target);
  assert.deepStrictEqual(s.picked(), ['1', '2'], 'a click the browser still makes under the lifted finger selects nothing');
  assert.deepStrictEqual(s.opened, []);
});

test('the list does not scroll during that touch: every move from the hold on is cancelled, the small ones too', async () => {
  const { target, b } = await holdOn(1);
  assert.strictEqual(target.passiveOf('touchmove'), false, 'a passive listener could not stop the scroll');
  const small = moveTo(target, 50, b.y(1) + 3);
  const big = moveTo(target, 50, b.y(3));
  assert.deepStrictEqual([small.defaultPrevented, big.defaultPrevented], [true, true]);
  const late = target.fire('touchmove', { touches: [touchAt(50, b.y(4))], cancelable: false });
  assert.strictEqual(late.defaultPrevented, false, 'a move the browser no longer lets the page cancel is left alone');
});

test('a touch without a hold scrolls as it did: nothing is cancelled, nothing is selected', async () => {
  const s = await open();
  const b = drawBoard(s, [1, 2, 3, 4]);
  const target = b.target(1);
  down(s, target, 50, b.y(1));
  s.wait(200);
  const before = moveTo(target, 50, b.y(1) + 4);
  const scroll = moveTo(target, 50, b.y(3));
  s.wait(1000);
  const more = moveTo(target, 50, b.y(4));
  assert.deepStrictEqual([before, scroll, more].map((e) => e.defaultPrevented), [false, false, false]);
  const end = lift(target);
  assert.strictEqual(end.defaultPrevented, false);
  assert.deepStrictEqual(s.picked(), []);
});

test('a hold that lifts in place still opens the menu on the Board, a wobble inside the slop included', async () => {
  const { s, target, b } = await holdOn(2);
  moveTo(target, 50, b.y(2) + 4);
  lift(target);
  assert.strictEqual(s.menuOpen(), true);
  assert.deepStrictEqual(s.picked(), []);
});

test('a tile the finger passes again is not added twice, and one the selection already holds stays where it was', async () => {
  const s = await open();
  const b = drawBoard(s, [1, 2, 3, 4]);
  clickOn(s, b.target(3));
  s.wait(1000);
  down(s, b.target(1), 50, b.y(1));
  s.wait(600);
  for (const id of [2, 3, 2, 1, 4]) moveTo(b.target(1), 50, b.y(id));
  lift(b.target(1));
  assert.deepStrictEqual(s.picked(), ['1', '2', '3', '4']);
  assert.deepStrictEqual(s.selection(), { anchor: a(3), additions: [a(1), a(2), a(4)] }, 'the card tapped before is the anchor, the rest follow in the order passed');
});

test('a finger over no tile adds nothing: the gap between tiles, and the page beyond the Board', async () => {
  const { s, target } = await holdOn(1);
  moveTo(target, 50, 95);
  assert.deepStrictEqual(s.picked(), ['1'], 'the gap under the held tile');
  const alone = await holdOn(1, { ids: [1] });
  moveTo(alone.target, 50, 5000);
  assert.deepStrictEqual(alone.s.picked(), ['1'], 'nothing below the only tile');
});

test('only the Board\'s tiles select by hold and drag: a hold on a tile of another view, and a drag over it, selects nothing and cancels nothing', async () => {
  const { s, target, b } = await holdOn(1, { board: false });
  assert.strictEqual(target.passiveOf('touchmove'), true, 'the Calendar\'s and the Gantt\'s own drags are left to their handlers');
  const move = moveTo(target, 50, b.y(3));
  assert.strictEqual(move.defaultPrevented, false);
  const end = lift(target);
  assert.deepStrictEqual(s.picked(), []);
  assert.strictEqual(s.menuOpen(), false);
  assert.strictEqual(end.defaultPrevented, false);
  assert.strictEqual(s.renders, 0);
});

test('while the finger drags the poll keeps away from the board, and after the lift it does not', async () => {
  const { s, target, to } = await holdOn(1);
  assert.strictEqual(s.page.run('isDragging'), false, 'a hold is no drag');
  to(2);
  assert.strictEqual(s.page.run('isDragging'), true);
  lift(target);
  assert.strictEqual(s.page.run('isDragging'), false);
});

test('the Board\'s swipe does not read the lift of a hold and drag as a swipe to the next status', async () => {
  const { s, target, b } = await holdOn(1);
  const swiped = [];
  const real = s.page.ctx.setPhoneColumn;
  s.page.ctx.setPhoneColumn = (col) => { swiped.push(col); return real(col); };
  s.boardEl.fire('touchstart', { touches: [touchAt(450, b.y(1))], changedTouches: [touchAt(450, b.y(1))], timeStamp: 1000 });
  moveTo(target, 150, b.y(2));
  moveTo(target, 50, b.y(3));
  lift(target);
  s.boardEl.fire('touchend', { changedTouches: [touchAt(50, b.y(3))], timeStamp: 1600 });
  assert.deepStrictEqual(swiped, []);
});

test('the Board\'s swipe still reads a touch that held no drag: a quick sideways swipe changes the status', async () => {
  const s = await open();
  const b = drawBoard(s, [1, 2, 3, 4]);
  const swiped = [];
  const real = s.page.ctx.setPhoneColumn;
  s.page.ctx.setPhoneColumn = (col) => { swiped.push(col); return real(col); };
  const target = b.target(1);
  down(s, target, 300, b.y(1));
  s.boardEl.fire('touchstart', { touches: [touchAt(300, b.y(1))], changedTouches: [touchAt(300, b.y(1))], timeStamp: 1000 });
  s.wait(100);
  lift(target);
  s.boardEl.fire('touchend', { changedTouches: [touchAt(100, b.y(1))], timeStamp: 1150 });
  assert.strictEqual(swiped.length, 1);
});

test('the browser taking the touch ends the drag: what the finger had passed stays selected, drawn once', async () => {
  const { s, target, to } = await holdOn(1);
  to(2);
  target.fire('touchcancel', {});
  assert.deepStrictEqual(s.picked(), ['1', '2']);
  assert.strictEqual(s.renders, 1);
  assert.strictEqual(s.page.run('isDragging'), false);
  assert.strictEqual(s.menuOpen(), false);
});

test('a second finger ends the drag the same way', async () => {
  const { s, b, to } = await holdOn(1);
  to(2);
  down(s, b.target(3), 200, b.y(3), { touches: [touchAt(50, b.y(2)), touchAt(200, b.y(3))] });
  assert.deepStrictEqual(s.picked(), ['1', '2']);
  assert.strictEqual(s.renders, 1);
  assert.strictEqual(s.page.run('isDragging'), false);
});

test('a window that crosses the width line in the middle of the drag selects no more', async () => {
  const { s, target, to } = await holdOn(1);
  to(2);
  s.cross(false);
  to(3);
  lift(target);
  assert.deepStrictEqual(s.picked(), ['1', '2']);
  assert.strictEqual(s.page.run('isDragging'), false);
});

test('a hold and drag leaves the light on the card held, and a second one adds to the first', async () => {
  const { s, target, to } = await holdOn(1);
  to(2);
  lift(target);
  assert.strictEqual(s.page.run('pinnedLitId'), '1');
  s.wait(1000);
  const b = drawBoard(s, [1, 2, 3, 4]);
  down(s, b.target(4), 50, b.y(4));
  s.wait(600);
  moveTo(b.target(4), 50, b.y(3));
  lift(b.target(4));
  assert.deepStrictEqual(s.picked(), ['1', '2', '3', '4']);
});
