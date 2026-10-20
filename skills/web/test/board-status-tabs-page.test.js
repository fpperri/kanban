const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadPage, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');
const { PHONE_WIDTH_QUERY } = require('../web/phone-width');

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
  const strip = recordingElement('nav');
  const media = mediaStandIn(phone);
  const all = { ...stored };
  const page = loadPage({ board: makeBoard(), stored: all, elements: { '#board': board, '#board-tabs': strip }, documentExtras: recordingDocument() });
  page.ctx.matchMedia = media.matchMedia;
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const tabs = () => byClass(strip, 'board-tab');
  return {
    page, board, strip, media, stored: all, tabs,
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
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.html'), 'utf8');
  const m = /<div id="toast"[^>]*><\/div>\s*(<nav id="board-tabs"[^>]*>)<\/nav>\s*<main id="board">/.exec(html);
  assert.ok(m, 'the strip host sits between the toast and main#board');
  assert.ok(!/style=/.test(m[1]));
});

test('the strip, the hidden column header row and the Board phone height sit in one phone block after the column rules, coloured with the status tokens', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  const start = css.indexOf('.column-cards {');
  const block = /@media \(max-width: 759\.98px\) \{\n([^@]*?)\n\}/.exec(css.slice(start, css.indexOf('\n.card {', start)));
  assert.ok(block, 'one phone block between the column rules and .card');
  const rules = block[1];
  assert.match(rules, /\.board-tabs\s*\{[^}]*display: flex/);
  assert.match(rules, /\.board-tab-backlog\s*\{[^}]*var\(--st-backlog\)/);
  assert.match(rules, /\.board-tab-archive\s*\{[^}]*var\(--st-archive\)/);
  assert.match(rules, /\.column-header\s*\{[^}]*display: none/);
  assert.match(rules, /main#board\s*\{[^}]*height:/);
  assert.match(css, /\.board-tabs\s*\{\s*display: none/, 'the strip is hidden above the line');
});
