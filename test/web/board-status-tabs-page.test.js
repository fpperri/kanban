const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadPage, harmless, control } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');
const { PHONE_WIDTH_QUERY } = require('../../plugin/skills/web/web/phone-width');

// The Board on a phone, in the real page (helpers/page-vm.js): under the phone width line the
// status tabs fill the tab strip and only the chosen status's column renders, expanded whatever
// the saved collapsed state. The browser runner drives the same in Chrome (phone-steps/board-tabs.js).

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
  active: [card(1, { status: 'doing' }), card(2), card(3, { status: 'backlog' }), card(4)],
  archived: [card(5, { archived: true })],
});

const PHONE = 'kanban.kanban.columns.phone';
const COLLAPSED = 'kanban.kanban.columns.collapsed';
const ALL = ['backlog', 'todo', 'doing', 'done', 'archive'];

function mediaStandIn(phone) {
  const listeners = [];
  const state = { phone };
  return {
    matchMedia: (q) => ({
      get matches() { return q === PHONE_WIDTH_QUERY && state.phone; },
      addEventListener: (type, fn) => { if (q === PHONE_WIDTH_QUERY && type === 'change') listeners.push(fn); },
    }),
    cross(to) { state.phone = to; listeners.forEach((fn) => fn({ matches: to })); },
  };
}

async function open({ phone = true, stored = {} } = {}) {
  const board = recordingElement('main');
  Object.defineProperty(board, 'innerHTML', { get: () => '', set: () => { board.children.length = 0; } });
  const innerStrip = recordingElement('nav');
  // A real strip goes back to the left when it is emptied: its content is gone, so there is nothing to scroll.
  const strip = new Proxy(innerStrip, { set(t, k, v) { if (k === 'textContent') t.scrollLeft = 0; t[k] = v; return true; } });
  const media = mediaStandIn(phone);
  const newBtn = control();
  const statusField = control();
  const all = { ...stored };
  const scrolled = [];
  const documentExtras = recordingDocument();
  const make = documentExtras.createElement;
  documentExtras.createElement = (tag) => {
    const el = make(tag);
    el.style = {};
    el.scrollIntoView = (o) => scrolled.push({ col: el.dataset.col, ...o });
    return el;
  };
  const page = loadPage({ board: makeBoard(), stored: all, elements: { '#board': board, '#board-tabs': strip, '#new-btn': newBtn, '#f-status': statusField }, documentExtras });
  page.ctx.matchMedia = media.matchMedia;
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const tabs = () => byClass(innerStrip, 'board-tab');
  return {
    page, board, strip, media, stored: all, tabs, scrolled,
    cards: () => byClass(board, 'card'),
    newCard() { statusField.value = '(unset)'; newBtn.fire('click', {}); return statusField.value; },
    touch(type, x, y, t, extra = {}) {
      const point = { clientX: x, clientY: y };
      const e = { timeStamp: t, touches: type === 'touchend' ? [] : [point], changedTouches: [point], ...extra };
      board.fire(type, e);
    },
    swipe(dx, dy, ms = 200) {
      this.touch('touchstart', 200, 300, 1000);
      this.touch('touchend', 200 + dx, 300 + dy, 1000 + ms);
    },
    columns: () => board.children.map((c) => c.dataset.col),
    counts: () => tabs().map((t) => byClass(t, 'board-tab-count')[0].textContent),
    selected: () => tabs().filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.col),
    tap(col) {
      const tab = tabs().find((t) => t.dataset.col === col);
      const target = new Proxy({}, { get: (t, k) => (k === 'closest' ? (sel) => (sel === '.board-tab' ? tab : null) : harmless(String(k))) });
      strip.fire('click', { target, stopPropagation() {}, preventDefault() {} });
    },
  };
}

test('at phone width the tab strip is filled, Archive last, and only the first status renders when none is remembered', async () => {
  const s = await open();
  assert.deepStrictEqual(s.tabs().map((t) => t.dataset.col), ALL);
  assert.deepStrictEqual(s.counts(), ['1', '2', '1', '0', '1']);
  assert.deepStrictEqual(s.selected(), ['backlog']);
  assert.deepStrictEqual(s.columns(), ['backlog']);
});

test('the remembered status is the one that renders, expanded whatever the saved collapsed state, which is not written', async () => {
  const saved = JSON.stringify({ backlog: false, todo: false, doing: true, done: false, archive: true });
  const s = await open({ stored: { [PHONE]: 'doing', [COLLAPSED]: saved } });
  assert.deepStrictEqual(s.columns(), ['doing']);
  assert.ok(!s.board.children[0].classes.includes('collapsed'));
  assert.strictEqual(byClass(s.board.children[0], 'column-cards').length, 1, 'its cards render');
  assert.strictEqual(s.stored[COLLAPSED], saved, 'the collapsed state was not written');
});

test('a remembered status the board no longer has falls back to the first status', async () => {
  const s = await open({ stored: { [PHONE]: 'review' } });
  assert.deepStrictEqual(s.columns(), ['backlog']);
  assert.deepStrictEqual(s.selected(), ['backlog']);
});

test('a tap on a tab shows that status, remembers it for the board, and Archive can be chosen', async () => {
  const s = await open();
  s.tap('todo');
  assert.deepStrictEqual(s.columns(), ['todo']);
  assert.strictEqual(s.stored[PHONE], 'todo');
  assert.deepStrictEqual(s.selected(), ['todo']);
  s.tap('archive');
  assert.deepStrictEqual(s.columns(), ['archive']);
  assert.strictEqual(s.stored[PHONE], 'archive');
});

test('above the phone width the Board renders every column as before and the strip stays empty', async () => {
  const s = await open({ phone: false, stored: { [PHONE]: 'doing' } });
  assert.deepStrictEqual(s.columns(), ALL);
  assert.strictEqual(s.tabs().length, 0);
});

test('crossing the width line draws the Board again in both directions: narrow, wide, narrow', async () => {
  const s = await open({ stored: { [PHONE]: 'doing' } });
  assert.deepStrictEqual(s.columns(), ['doing']);
  s.media.cross(false);
  assert.deepStrictEqual(s.columns(), ALL);
  assert.strictEqual(s.tabs().length, 0);
  s.media.cross(true);
  assert.deepStrictEqual(s.columns(), ['doing']);
  assert.strictEqual(s.tabs().length, 5);
  assert.deepStrictEqual(s.selected(), ['doing']);
});

test('while a search narrows the board the tab counts read shown/total', async () => {
  const s = await open();
  s.page.input.typed('Card 2');
  await s.page.settle();
  assert.deepStrictEqual(s.counts(), ['0/1', '1/2', '0/1', '0/0', '0/1']);
});

test('the tab strip host is markup between the toast and main#board, with no style attribute', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8');
  const m = /<div id="toast"[^>]*><\/div>\s*(<nav id="board-tabs"[^>]*>)<\/nav>\s*<main id="board">/.exec(html);
  assert.ok(m, 'the strip host sits between the toast and main#board');
  assert.ok(!/style=/.test(m[1]));
});

test('the strip, the hidden column header row and the Board phone height sit in one phone block after the column rules, coloured with the status tokens', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8');
  const start = css.indexOf('.column-cards {');
  const block = /@media \(max-width: 759\.98px\) \{\n([^@]*?)\n\}/.exec(css.slice(start, css.indexOf('\n.card {', start)));
  assert.ok(block, 'one phone block between the column rules and .card');
  const rules = block[1];
  assert.match(rules, /\.board-tabs\s*\{[^}]*display: flex/);
  assert.doesNotMatch(css, /\.board-tab-(backlog|todo|doing|done|archive)\s*\{/, 'a tab takes its colour from statusColorVar, not from a rule per status');
  assert.match(rules, /\.column-header\s*\{[^}]*display: none/);
  assert.match(rules, /main#board\s*\{[^}]*height:/);
  assert.match(css, /\.board-tabs\s*\{\s*display: none/, 'the strip is hidden above the line');
});

test('a sideways swipe moves to the neighbouring status and remembers it, and the ends do not wrap', async () => {
  const s = await open({ stored: { [PHONE]: 'todo' } });
  s.swipe(-100, 0);
  assert.deepStrictEqual(s.columns(), ['doing']);
  assert.strictEqual(s.stored[PHONE], 'doing');
  assert.deepStrictEqual(s.selected(), ['doing']);
  s.swipe(100, 0);
  s.swipe(100, 0);
  assert.deepStrictEqual(s.columns(), ['backlog']);
  s.swipe(100, 0);
  assert.deepStrictEqual(s.columns(), ['backlog'], 'no wrap before the first status');
  for (let i = 0; i < 6; i++) s.swipe(-100, 0);
  assert.deepStrictEqual(s.columns(), ['archive'], 'no wrap past Archive');
});

test('a vertical scroll, a short drag or a slow drag on the Board does not change the status', async () => {
  const s = await open({ stored: { [PHONE]: 'todo' } });
  s.swipe(-10, 200);
  s.swipe(-40, 0);
  s.swipe(-100, 0, 900);
  assert.deepStrictEqual(s.columns(), ['todo']);
});

test('a second finger cancels the swipe', async () => {
  const s = await open({ stored: { [PHONE]: 'todo' } });
  s.touch('touchstart', 200, 300, 1000);
  s.touch('touchstart', 220, 300, 1050, { touches: [{ clientX: 200, clientY: 300 }, { clientX: 220, clientY: 300 }] });
  s.touch('touchend', 60, 300, 1200);
  assert.deepStrictEqual(s.columns(), ['todo']);
});

test('a swipe is ignored while a drag is in progress', async () => {
  const s = await open({ stored: { [PHONE]: 'todo' } });
  s.page.run('isDragging = true');
  s.swipe(-100, 0);
  assert.deepStrictEqual(s.columns(), ['todo']);
  s.page.run('isDragging = false');
  s.swipe(-100, 0);
  assert.deepStrictEqual(s.columns(), ['doing']);
});

test('above the phone width a swipe on the Board changes nothing', async () => {
  const s = await open({ phone: false });
  s.swipe(-100, 0);
  assert.deepStrictEqual(s.columns(), ALL);
  assert.strictEqual(s.stored[PHONE], undefined);
});

test('cards are not draggable at phone width, are above it, and follow the width line both ways', async () => {
  const s = await open({ stored: { [PHONE]: 'todo' } });
  assert.ok(s.cards().length > 0);
  assert.ok(s.cards().every((c) => c.draggable === false));
  s.media.cross(false);
  assert.ok(s.cards().length > 0);
  assert.ok(s.cards().every((c) => c.draggable === true));
  s.media.cross(true);
  s.tap('archive');
  assert.ok(s.cards().length > 0);
  assert.ok(s.cards().every((c) => c.draggable === false), 'the Archive tiles too');
});

test('New card at phone width presets the active status; on the desktop it presets none', async () => {
  const s = await open({ stored: { [PHONE]: 'doing' } });
  assert.strictEqual(s.newCard(), 'doing');
  s.tap('archive');
  assert.strictEqual(s.newCard(), 'backlog', 'Archive is not a status a card can be made in');
  const wide = await open({ phone: false, stored: { [PHONE]: 'doing' } });
  assert.strictEqual(wide.newCard(), 'backlog');
});

test('the Board swipe listeners are passive, and the cards take pan-y pinch-zoom in a rule after .card.archived-card', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.js'), 'utf8');
  const body = app.slice(app.indexOf('function wireBoardSwipe'), app.indexOf('function toggleColumn'));
  for (const type of ['touchstart', 'touchend', 'touchcancel']) assert.ok(body.includes(`addEventListener('${type}'`), `${type} is listened for`);
  assert.strictEqual((body.match(/\{ passive: true \}\)/g) || []).length, 3, 'each listener is passive');
  assert.ok(!/preventDefault/.test(body));
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.css'), 'utf8');
  const after = css.slice(css.indexOf('.card.archived-card {'));
  assert.match(after, /\.card\s*\{[^}]*touch-action: pan-y pinch-zoom/);
  assert.ok(!/touch-action: pan-y;/.test(css.slice(css.indexOf('.card.archived-card {'), css.indexOf('.card.archived-card {') + 600)), "never 'pan-y' alone");
});

test('every tab takes its colour from statusColorVar', async () => {
  const s = await open();
  for (const t of s.tabs()) {
    assert.strictEqual(t.style.color, s.page.run(`statusColorVar(${JSON.stringify(t.dataset.col)})`), t.dataset.col);
    assert.ok(!t.classes.some((c) => c.startsWith('board-tab-') && c !== 'board-tab-label' && c !== 'board-tab-count'), 'no per-status class');
  }
});

test('a redraw keeps the strip where it was scrolled, and a changed status brings its tab into view', async () => {
  const s = await open();
  assert.deepStrictEqual(s.scrolled.map((x) => x.col), ['backlog'], 'the first draw shows the chosen tab');
  s.strip.scrollLeft = 120;
  s.page.run('renderBoard()');
  assert.strictEqual(s.strip.scrollLeft, 120, 'a poll or a keystroke does not snap the strip back');
  assert.strictEqual(s.scrolled.length, 1, 'the same status is not scrolled to again');
  s.tap('archive');
  assert.strictEqual(s.strip.scrollLeft, 120);
  assert.deepStrictEqual(s.scrolled[s.scrolled.length - 1], { col: 'archive', inline: 'nearest', block: 'nearest' });
});

test('the status tabs are a tablist of tabs, so a screen reader says which status is shown', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8');
  assert.match(html, /<nav id="board-tabs"[^>]*role="tablist"/);
  const s = await open();
  assert.ok(s.tabs().every((t) => t.getAttribute('role') === 'tab'));
  assert.deepStrictEqual(s.selected(), ['backlog']);
});

test('crossing the width line draws the Map once and the Graph once, the Graph framed again', async () => {
  for (const view of ['map', 'graph']) {
    const s = await open({ stored: { 'kanban.kanban.view.mode': view } });
    s.page.run('globalThis.__d = []; renderMapView = () => { __d.push("map"); }; renderGraphView = () => { __d.push(graphRefitNext ? "graph refit" : "graph"); };');
    s.media.cross(false);
    assert.deepStrictEqual(JSON.parse(s.page.run('JSON.stringify(__d)')), [view === 'map' ? 'map' : 'graph refit'], view);
  }
});

test('the phone-width query is read through one MediaQueryList, and a hidden status is counted without sorting its cards', async () => {
  const s = await open();
  s.page.run('globalThis.__m = 0; globalThis.__s = 0; const __mm = window.matchMedia; window.matchMedia = (q) => { __m++; return __mm(q); }; const __sc = sortCards; sortCards = (...a) => { __s++; return __sc(...a); };');
  s.page.run('renderBoard(); renderBoard()');
  assert.strictEqual(s.page.run('__m'), 0, 'the list made at the start is the one read');
  assert.strictEqual(s.page.run('__s'), 2, 'one column sorted per draw: the status shown');
  assert.deepStrictEqual(s.counts(), ['1', '2', '1', '0', '1']);
  s.page.input.typed('Card 2');
  await s.page.settle();
  assert.deepStrictEqual(s.counts(), ['0/1', '1/2', '0/1', '0/0', '0/1']);
});
