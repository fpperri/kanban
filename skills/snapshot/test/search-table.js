// What the search parity tests share: the plan board from the browser runner,
// the table of queries both searches must answer alike, and the helpers that
// read the answer off the built page and off the web search module. Not a test
// file (the suite runs *.test.js only).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cardStore = require('../../web/scripts/card-store');
const { readConfig } = require('../../web/scripts/config-store');
const { parseSearchQuery, filterCards } = require('../../web/web/search');
const { materialize } = require('../../web/test/browser/boards');
const { buildScript } = require('./nesting-fixture');
const { byClass, loadPage } = require('./page-harness');

const BOARD_NAME = 'plan';
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const ALL = range(1, 29);

// Every row: the query as typed, and the card ids both searches must show,
// written out from the plan board's cards (not computed by either search).
// Bodies on that board are one short line, so the snapshot's body cap cannot
// make the two differ.
const PLAN_QUERIES = [
  { q: '#7', ids: [7] },
  { q: 'plan#7', ids: [7] },
  { q: 'PLAN#7', ids: [7] },
  { q: 'other#7', ids: [] },
  { q: 'id:12', ids: [12] },
  { q: 'id:', ids: ALL },
  { q: 'title:zephyr', ids: [1, 2, 7, 11, 19] },
  { q: 'body:plan', ids: range(22, 29) },
  { q: 'status:doing', ids: [1, 2, 9, 15, 22, 23] },
  { q: 'status:DO', ids: ALL.filter((id) => ![4, 8, 11, 14, 18, 25, 28].includes(id)) },
  { q: 'status:', ids: ALL },
  { q: 'priority:high', ids: [] },
  { q: 'priority:normal', ids: ALL },
  { q: 'tags:next-up', ids: [3, 17] },
  { q: 'tags:grill', ids: [8, 13] },
  { q: 'file:0011', ids: [11] },
  { q: 'file:cutover', ids: [3] },
  { q: 'assignee:@afk', ids: [4, 11, 13, 15, 22] },
  { q: 'a:@afk', ids: [4, 11, 13, 15, 22] },
  { q: 'A:@AFK', ids: [4, 11, 13, 15, 22] },
  { q: 'assignee:@human', ids: ALL.filter((id) => ![4, 11, 13, 15, 22].includes(id)) },
  { q: 'a:@human', ids: ALL.filter((id) => ![4, 11, 13, 15, 22].includes(id)) },
  { q: 'a:', ids: ALL },
  { q: 'type:task', ids: [15, 17, 24, 27, 28, 29] },
  { q: 'type:Epic', ids: [22] },
  { q: 'review:', ids: [10] },
  { q: 'review:eyes', ids: [10] },
  { q: 'review:nope', ids: [] },
  { q: 'blocked:', ids: [9] },
  { q: 'blocked:vendor', ids: [9] },
  { q: 'blocked:nope', ids: [] },
  { q: 'tree:3', ids: [1, 2, 3, 4, 5, 6, 7, 8, 19, 22, 23, 24, 25, 27] },
  { q: 'tree:#3', ids: [1, 2, 3, 4, 5, 6, 7, 8, 19, 22, 23, 24, 25, 27] },
  { q: 'tree:99', ids: [] },
  { q: 'tree:', ids: ALL },
  { q: 'path:7', ids: [1, 2, 6, 7, 8, 22, 23, 24, 25] },
  { q: 'path:#22', ids: [1, 2, 6, 7, 8, 22, 23, 24, 25] },
  { q: 'foo:bar', ids: [] },
  { q: 'spike: zephyr', ids: [19] },
  { q: 'zephyr', ids: [1, 2, 7, 11, 19] },
  { q: 'Zephyr Data', ids: [2] },
  { q: 'data', ids: [2, 4, 22] },
  { q: 'status:todo a:@afk', ids: [13] },
  { q: 'a:@human type:task status:todo', ids: [17, 24, 27] },
  { q: 'tree:22 a:@afk', ids: [4, 22] },
  { q: 'path:3 status:backlog', ids: [4] },
];

// The plan board's cards as kanban-web reads them, live and archived.
function planCards(dir) {
  return cardStore.listActive(dir).concat(cardStore.listArchived(dir)).map(cardStore.toJSON);
}

// What kanban-web hands its search module besides the cards: the board's name
// and the hierarchy its own config reader gives, for the slice: term.
function webContext(dir) {
  const { name, hierarchy } = readConfig(dir);
  return { board: name, hierarchy };
}

// The ids the web search module finds for a query typed on a board: the plan
// board unless the board's own context (webContext) is given.
function webIds(cards, q, ctx = { board: BOARD_NAME }) {
  return webMatchIds(cards, q, ctx).map(Number).sort((a, b) => a - b);
}

// The same cards as the ids the web card JSON holds them under, to hand back to the web's
// own helpers (the pill list, the slice list) that match them against those cards.
function webMatchIds(cards, q, ctx = { board: BOARD_NAME }) {
  return filterCards(cards, parseSearchQuery(q, ctx.board), ctx).map((c) => c.id);
}

// The card ids drawn on the board, archived ones included once shown.
function shownIds(page) {
  return page.byId('board').all().filter((n) => n.classList.contains('card'))
    .map((n) => Number(n.dataset.card)).sort((a, b) => a - b);
}

// What a person does to see archived cards: turn the Archive pill on, open its section.
function showArchive(page) {
  const pill = byClass(page.byId('boardpills'), 'pillrow')[0].children.find((b) => b.dataset.st === 'archive');
  page.click(pill);
  page.click(page.byId('board').all().find((n) => n.dataset.coltoggle === 'archive'));
}

const search = (page, q) => { page.type(page.byId('q'), q); return shownIds(page); };

// Builds the snapshot of one of the browser runner's boards (plan, fixture or
// malformed) and hands fn the page as built (Archive off), the board folder and the
// page text. `load` is passed to the page harness beside the wide screen.
function withBuiltBoard(key, fn, load = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-snapshot-${key}-`));
  try {
    const dir = materialize(key, path.join(root, 'board'));
    const out = path.join(root, 'out.html');
    execFileSync('python', [buildScript, dir, '--out', out], { encoding: 'utf8' });
    const html = fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n');
    const page = loadPage(html, { matchMedia: (q) => q.includes('min-width:900px'), ...load });
    return fn(page, dir, html);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// The same page with the Archive pill on and its section open.
function withBoardPage(key, fn, load = {}) {
  return withBuiltBoard(key, (page, dir, html) => {
    showArchive(page);
    return fn(page, dir, html);
  }, load);
}

// The plan board's page. The plan board's name is `plan`.
const withPlanPage = (fn) => withBoardPage('plan', fn);

module.exports = {
  BOARD_NAME, PLAN_QUERIES, planCards, search, shownIds, showArchive, webContext, webIds, webMatchIds, withBoardPage, withBuiltBoard, withPlanPage,
};
