const { test } = require('node:test');
const assert = require('node:assert');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');
const { PHONE_WIDTH_QUERY } = require('../web/phone-width');

// Enter in the search box, in the real page (helpers/page-vm.js runs every script app.html loads in one
// vm): the first Enter goes to the first match, whether or not the suggestion list is open, unless a row
// of the list is highlighted. The Board's cards are the page's own, drawn into recording elements.

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
    card(1, { title: 'Zephyr one', status: 'todo' }),
    card(2, { title: 'Plain two', status: 'todo' }),
    card(3, { title: 'Zephyr three', status: 'doing' }),
    card(4, { title: 'Other four', status: 'done' }),
  ],
  archived: [],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };

const mediaStandIn = (phone) => {
  const listeners = [];
  return {
    listeners,
    matchMedia: (q) => ({
      get matches() { return q === PHONE_WIDTH_QUERY && phone; },
      addEventListener: (type, fn) => { if (q === PHONE_WIDTH_QUERY && type === 'change') listeners.push(fn); },
    }),
  };
};

async function open({ view = 'board', phone = false, stored = {}, board = makeBoard(), containers = {} } = {}) {
  const boardEl = recordingElement('main');
  Object.defineProperty(boardEl, 'innerHTML', { get: () => '', set: () => { boardEl.children.length = 0; } });
  const focused = [];
  const scrolled = [];
  const documentExtras = recordingDocument();
  const make = documentExtras.createElement;
  let page;
  documentExtras.createElement = (tag) => {
    const el = make(tag);
    el.style = { setProperty() {}, removeProperty() {} };
    el.scrollIntoView = (o) => scrolled.push({ id: el.dataset.id, ...o });
    el.closest = (sel) => (sel === '.card-el' && el.classes.includes('card-el') ? el : null);
    el.focus = () => {
      page.ctx.document.activeElement = el;
      focused.push(el.dataset.id);
      page.fireDocument('focusin', { target: { closest: (sel) => (sel === '.card-el' && el.classes.includes('card-el') ? el : null) } });
    };
    return el;
  };
  boardEl.querySelector = (sel) => {
    const m = /^\.card-el\[data-id="([^"]+)"\]$/.exec(sel);
    return m ? byClass(boardEl, 'card-el').find((e) => e.dataset.id === m[1]) || null : null;
  };
  boardEl.querySelectorAll = (sel) => (sel === '.card-el' ? byClass(boardEl, 'card-el') : []);

  const panel = control();
  panel.classList.add('hidden');
  const media = mediaStandIn(phone);
  const elements = { '#board': boardEl, '#search-panel': panel, ...containers };
  for (const sel of HIDDEN_SURFACES) elements[sel] = hiddenSurface();

  const wrap = {
    listeners: {},
    style: {},
    active: null,
    appendChild() {},
    addEventListener(type, fn, capture) { (wrap.listeners[`${type}${capture ? ':capture' : ''}`] = wrap.listeners[`${type}${capture ? ':capture' : ''}`] || []).push(fn); },
    querySelector(sel) { return sel === '.combobox-item.active' ? wrap.active : null; },
  };

  page = loadPage({ board, stored: { 'kanban.kanban.view.mode': view, ...stored }, elements, documentExtras });
  page.ctx.matchMedia = media.matchMedia;
  page.input.parentElement = wrap;
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  page.ctx.document.activeElement = page.input;

  const enter = (extra = {}) => {
    const e = {
      key: 'Enter', isTrusted: true, target: page.input, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, repeat: false,
      defaultPrevented: false, stopped: false,
      preventDefault() { e.defaultPrevented = true; }, stopPropagation() { e.stopped = true; }, ...extra,
    };
    for (const fn of wrap.listeners['keydown:capture'] || []) fn(e);
    if (!e.stopped) page.input.fire('keydown', e);
    return e;
  };
  return {
    page, boardEl, panel, wrap, focused, scrolled, media, enter,
    panelOpen: () => !panel.classList.contains('hidden'),
    selection: () => JSON.stringify(page.run('[selectionState, [...selectedIds]]')),
    openPanel: () => page.run('setSearchPanelOpen(true)'),
  };
}

test('Enter with a match closes the panel, writes nothing to the box, leaves the selection alone and focuses the first match', async () => {
  const s = await open();
  s.page.input.typed('zephyr');
  s.openPanel();
  const before = s.selection();
  const e = s.enter();
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(s.panelOpen(), false);
  assert.deepStrictEqual(s.page.input.writes, []);
  assert.strictEqual(s.page.input.value, 'zephyr');
  assert.strictEqual(s.selection(), before);
  assert.deepStrictEqual(s.focused, ['1']);
  assert.deepStrictEqual(s.scrolled.filter((o) => o.id === '1').map((o) => o.block), ['center']);
});

test('Enter with nothing matching leaves the panel open, the box focused and the key to the box', async () => {
  const s = await open();
  s.page.input.typed('zzzz-no-such-card');
  s.openPanel();
  const e = s.enter();
  assert.strictEqual(e.stopped, false, 'the key reaches the list');
  assert.strictEqual(s.panelOpen(), true);
  assert.deepStrictEqual(s.focused, []);
  assert.strictEqual(s.page.ctx.document.activeElement, s.page.input);
});

test('with the suggestion list open and a row highlighted, Enter is the list\'s: no match is gone to', async () => {
  const s = await open();
  s.page.input.typed('zephyr');
  s.openPanel();
  s.wrap.active = { classList: { contains: () => true } };
  const e = s.enter();
  assert.strictEqual(e.stopped, false);
  assert.strictEqual(s.panelOpen(), true);
  assert.deepStrictEqual(s.focused, []);
});

test('with the suggestion list open and nothing highlighted, the first Enter goes to the match', async () => {
  const s = await open();
  s.page.input.typed('zephyr');
  s.openPanel();
  s.wrap.active = null;
  const e = s.enter();
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(e.stopped, true, 'the box\'s own listener, the list\'s, does not also take the key');
  assert.deepStrictEqual(s.focused, ['1']);
  assert.strictEqual(s.panelOpen(), false);
});

test('a key from another control inside the search box is not the Enter that goes', async () => {
  const s = await open();
  s.page.input.typed('zephyr');
  const e = s.enter({ target: control() });
  assert.strictEqual(e.stopped, false);
  assert.deepStrictEqual(s.focused, []);
});

test('on a phone, a status collapsed on the desktop does not hide its match from Enter', async () => {
  const s = await open({ phone: true, stored: { 'kanban.kanban.columns.collapsed': JSON.stringify({ done: true }) } });
  s.page.input.typed('#4');
  const e = s.enter();
  assert.strictEqual(e.defaultPrevented, true);
  assert.deepStrictEqual(s.focused, ['4']);
});

test('on the desktop, a collapsed status still hides its match from Enter', async () => {
  const s = await open({ stored: { 'kanban.kanban.columns.collapsed': JSON.stringify({ done: true }) } });
  s.page.input.typed('#4');
  const e = s.enter();
  assert.strictEqual(e.stopped, false);
  assert.deepStrictEqual(s.focused, []);
});

// The card the first Enter focused in a view other than the Board: the Board is drawn too (hidden), so a
// document-wide lookup finds its copy first. A poll, or crossing the phone width line, draws again, and
// the focus goes back to the card in the view that shows.
function viewWithCard(id) {
  const log = [];
  const mk = () => {
    const el = {
      dataset: { id },
      classList: { contains: (c) => c === 'card-el' },
      closest: (sel) => (sel === '.card-el' ? el : null),
      focus: () => log.push(el.name),
      scrollIntoView() {},
    };
    return el;
  };
  const shown = Object.assign(mk(), { name: 'shown' });
  const hiddenCopy = Object.assign(mk(), { name: 'hidden copy' });
  const container = (card) => {
    const own = { querySelector: (sel) => (sel === `.card-el[data-id="${id}"]` ? card : null), querySelectorAll: () => [card] };
    return new Proxy(own, { get: (t, k) => (k in t ? t[k] : harmless(String(k))) });
  };
  return { log, shown, hiddenCopy, containers: { '#board': container(hiddenCopy), '#map-view': container(shown) } };
}

test('a poll in the Map puts focus back on the card in the Map, not on its hidden Board copy', async () => {
  const v = viewWithCard('1');
  const s = await open({ view: 'map', containers: v.containers });
  s.page.ctx.renderBoard = () => {};
  s.page.ctx.document.activeElement = v.shown;
  s.page.run(`applyBoardData(${JSON.stringify(makeBoard())})`);
  assert.deepStrictEqual(v.log, ['shown']);
});

test('crossing the phone width line puts focus back on the focused card in the view that shows', async () => {
  const v = viewWithCard('1');
  const s = await open({ view: 'map', containers: v.containers });
  s.page.ctx.renderBoard = () => {};
  s.page.ctx.document.activeElement = v.shown;
  assert.ok(s.media.listeners.length > 0, 'the page listens for the width line');
  s.media.listeners.forEach((fn) => fn({ matches: true }));
  assert.deepStrictEqual(v.log, ['shown']);
});

// The Graph: the dots are drawn in a browser, not here, so the node elements, the layout and the lights
// are stand-ins; what is read is what the page asks of them.
async function graphOpen() {
  const host = control();
  const made = {};
  const order = [];
  const calls = [];
  const node = (id) => {
    const el = {
      dataset: { id },
      classList: { contains: (c) => c === 'card-el' || c === 'graph-node' },
      closest: (sel) => (sel === '.card-el' || sel === '.graph-node' ? el : null),
      scrollIntoView() {},
      focus: () => {
        s.page.ctx.document.activeElement = el;
        s.page.fireDocument('focusin', { target: el });
        host.fire('focusin', { type: 'focusin', target: el });
      },
    };
    made[id] = el;
    order.push(el);
    return el;
  };
  node('1');
  node('3');
  host.querySelectorAll = () => order;
  host.querySelector = () => null;
  const s = await open({ view: 'graph', containers: { '#graph-view': host } });
  s.page.ctx.renderBoard = () => {};
  s.page.ctx.graphApplyTransform = () => {};
  s.page.ctx.graphSetFocus = (id) => calls.push(`focus ${id}`);
  s.page.ctx.graphRestFocus = () => calls.push('rest');
  s.page.run(`graphCur = {
    nodeEls: new Map([['1', null], ['3', null]]),
    plan: { nodes: [{ id: '1', x: 0, y: 0 }, { id: '3', x: 0, y: 0 }] },
    layout: { pos: new Map([['1', { x: 100, y: 50 }], ['3', { x: 10, y: 20 }]]) },
    svg: { getBoundingClientRect: () => ({ width: 800, height: 600 }) },
    view: { x: 0, y: 0, k: 2, touched: false }, w: 800, h: 600,
    model: { byId: new Map([['1', {}], ['3', {}]]) },
  }`);
  s.page.ctx.__els = made;
  s.page.run(`graphCur.nodeEls = new Map([['1', __els['1']], ['3', __els['3']]])`);
  return { ...s, host, calls, made, view: () => JSON.parse(JSON.stringify(s.page.run('graphCur.view'))) };
}

test('in the Graph, Enter centres the card on the layout\'s current position, not the plan\'s', async () => {
  const g = await graphOpen();
  g.page.input.typed('zephyr');
  g.enter();
  assert.deepStrictEqual(g.focused.length, 0, 'the stand-in node records no focus here');
  assert.strictEqual(g.page.ctx.document.activeElement, g.made['1']);
  assert.deepStrictEqual(g.view(), { x: 200, y: 200, k: 2, touched: true });
});

test('in the Graph, the focus the first Enter gives a card does not light it and its neighbours over the search\'s lights', async () => {
  const g = await graphOpen();
  g.page.input.typed('zephyr');
  g.enter();
  assert.strictEqual(g.page.ctx.document.activeElement, g.made['1']);
  assert.deepStrictEqual(g.calls, [], 'the search\'s lit set is left as it was');
  assert.strictEqual(g.page.run('hoveredId'), null, 'a poll would not light the card as if the pointer were on it');
});

test('in the Graph, the pointer coming onto a card after the Enter lights it as always', async () => {
  const g = await graphOpen();
  g.page.input.typed('zephyr');
  g.enter();
  g.host.fire('mouseover', { type: 'mouseover', target: g.made['3'] });
  assert.deepStrictEqual(g.calls, ['focus 3']);
});

test('on a phone the page is never scrolled sideways: the card is brought in with inline nearest', async () => {
  const s = await open({ phone: true });
  s.page.input.typed('#1');
  s.enter();
  assert.deepStrictEqual(s.scrolled.filter((o) => o.id === '1').map((o) => o.inline), ['nearest']);
});

test('above the phone width the card is centred sideways too', async () => {
  const s = await open();
  s.page.input.typed('#1');
  s.enter();
  assert.deepStrictEqual(s.scrolled.filter((o) => o.id === '1').map((o) => o.inline), ['center']);
});

test('in the Gantt the label in the gutter takes the focus and the card\'s bar is brought into the timeline\'s view sideways', async () => {
  const log = [];
  const mk = (name) => {
    const el = {
      name, dataset: { id: '1' }, classList: { contains: (c) => c === 'card-el' },
      closest: (sel) => (sel === '.card-el' ? el : null),
      scrollIntoView: (o) => log.push(`${name} ${o.block} ${o.inline}`),
      focus: () => log.push(`focus ${name}`),
    };
    return el;
  };
  const label = mk('label');
  const bar = mk('bar');
  const root = new Proxy({
    querySelector: (sel) => (sel === '.card-el[data-id="1"]' ? label : sel === '.gantt-scroll .card-el[data-id="1"]' ? bar : null),
    querySelectorAll: () => [label, bar],
  }, { get: (t, k) => (k in t ? t[k] : harmless(String(k))) });
  const board = makeBoard();
  board.active[0].start_date = '2026-10-01';
  board.active[0].end_date = '2026-10-05';
  const s = await open({ view: 'gantt', board, containers: { '#gantt-view': root } });
  s.page.ctx.renderBoard = () => {};
  s.page.input.typed('#1');
  s.enter();
  assert.deepStrictEqual(log, ['label center center', 'bar nearest center', 'focus label']);
});
