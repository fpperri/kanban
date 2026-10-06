const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nesting = require('../web/nesting');
const { columnForStatus } = require('../web/column-state');

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

// Values built inside the vm carry its own prototypes, which deepStrictEqual refuses.
const plain = (v) => JSON.parse(JSON.stringify(v));
const card = (id, extra) => Object.assign({ id, status: 'todo', priority: 'Normal', parent: null, rank: null, archived: false }, extra);

// The reorder functions of app.js with the page around them replaced by spies.
function load(overrides) {
  const calls = [];
  const sandbox = Object.assign({
    state: {
      projectName: 'kanban', priorities: ['High', 'Normal', 'Low'], statuses: [],
      active: [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 20 }), card(4, { parent: 1, rank: 30 })],
      archived: [],
    },
    columnSort: { backlog: { field: 'outline', direction: 'asc' }, todo: { field: 'outline', direction: 'asc' }, archive: { field: 'id', direction: 'asc' } },
    reorderPlan: nesting.reorderPlan,
    reorderWrites: nesting.reorderWrites,
    dropNeighbours: nesting.dropNeighbours,
    dropSlot: nesting.dropSlot,
    columnForStatus,
    calls,
    renderBoard() { calls.push(['render', JSON.stringify(sandbox.state.active.map((c) => c.rank))]); },
    async loadBoard() { calls.push(['load']); },
    toast(msg) { calls.push(['toast', msg]); },
    async api(method, url, body) { calls.push(['api', method, url, body, vm.runInContext('pendingDrops', sandbox)]); },
  }, overrides);
  vm.createContext(sandbox);
  const src = [
    'let pendingDrops = 0;',
    "let refusedDrop = { key: '', refused: false };",
    'function loadColumnSort() { return columnSort; }',
    fn('isReorderDrop'), fn('dropPoint'), fn('dropAmong'), fn('dropRefused'), fn('reorderDrop'), fn('reorderCard'),
  ].join('\n');
  vm.runInContext(src, sandbox);
  sandbox.pending = () => vm.runInContext('pendingDrops', sandbox);
  return sandbox;
}

const tile = (id, top, height) => ({ dataset: { id: String(id) }, getBoundingClientRect: () => ({ top, height }) });
const column = (col, tiles) => ({ dataset: { col }, querySelectorAll: () => tiles });

// --- which drops reorder ----------------------------------------------------

test('a single card dropped on its own column, sorted in outline order, reorders', () => {
  const s = load();
  assert.strictEqual(s.isReorderDrop([3], 'todo'), true);
});

test('a drop on another column is a move, never a reorder', () => {
  const s = load();
  assert.strictEqual(s.isReorderDrop([3], 'doing'), false);
});

test('a column sorted any other way does not reorder', () => {
  const s = load({ columnSort: { todo: { field: 'priority', direction: 'desc' }, archive: { field: 'id', direction: 'asc' } } });
  assert.strictEqual(s.isReorderDrop([3], 'todo'), false);
});

test('a bulk drag never reorders', () => {
  const s = load();
  assert.strictEqual(s.isReorderDrop([3, 4], 'todo'), false);
});

test('the Archive column and archived cards never reorder', () => {
  const s = load();
  assert.strictEqual(s.isReorderDrop([3], 'archive'), false);
  s.state.archived.push(card(9, { archived: true, status: 'done' }));
  s.state.active = s.state.active.filter((c) => c.id !== 3);
  assert.strictEqual(s.isReorderDrop([3], 'todo'), false, 'not an active card');
  assert.strictEqual(s.isReorderDrop([9], 'todo'), false);
});

test('a card parked in the first column by an unlisted status reorders in that column', () => {
  const s = load();
  s.state.active.find((c) => c.id === 3).status = 'parked';
  assert.strictEqual(s.isReorderDrop([3], 'backlog'), true, 'columnForStatus puts an unlisted status in the first column');
  assert.strictEqual(s.isReorderDrop([3], 'todo'), false);
});

// --- reading where the pointer is -------------------------------------------

test('dropPoint skips the dragged tile and counts the tiles whose middle lies above the pointer', () => {
  const s = load();
  const col = column('todo', [tile(2, 0, 40), tile(3, 50, 40), tile(4, 100, 40)]);
  const point = s.dropPoint(col, 3, 90);
  assert.deepStrictEqual(plain(point.tiles.map((t) => t.dataset.id)), ['2', '4']);
  assert.strictEqual(point.at, 1, 'only the first tile (middle 20) is above 90; 4 has its middle at 120');
});

test('reorderDrop names the tiles above and below the pointer', () => {
  const s = load();
  vm.runInContext('reorderCard = (...args) => calls.push(["reorderCard", ...args]);', s);
  const col = column('todo', [tile(2, 0, 40), tile(3, 50, 40), tile(4, 100, 40)]);
  s.reorderDrop(col, 3, 90);
  assert.deepStrictEqual(plain(s.calls), [['reorderCard', 3, 2, 4]]);
});

test('in a descending column the tile above the pointer comes later in the outline', () => {
  const s = load({ columnSort: { todo: { field: 'outline', direction: 'desc' }, archive: { field: 'id', direction: 'asc' } } });
  vm.runInContext('reorderCard = (...args) => calls.push(["reorderCard", ...args]);', s);
  const col = column('todo', [tile(4, 0, 40), tile(3, 50, 40), tile(2, 100, 40)]);
  s.reorderDrop(col, 3, 90);
  assert.deepStrictEqual(plain(s.calls), [['reorderCard', 3, 2, 4]], 'the tile above (4) is the later one, so it is next');
});

test('a drop with no other tile on the column sends nothing', () => {
  const s = load();
  vm.runInContext('reorderCard = (...args) => calls.push(["reorderCard", ...args]);', s);
  s.reorderDrop(column('todo', [tile(3, 0, 40)]), 3, 20);
  assert.deepStrictEqual(s.calls, []);
});

// --- the drop itself ---------------------------------------------------------

test('reorderCard shows the new order at once, posts the neighbours, then reloads the board', async () => {
  const s = load();
  await s.reorderCard(4, 2, 3);
  assert.deepStrictEqual(s.calls.map((c) => c[0]), ['render', 'api', 'load']);
  assert.deepStrictEqual(plain(s.calls[0]), ['render', JSON.stringify([null, 10, 20, 15])], 'rendered with the card at 15 before the call returns');
  assert.deepStrictEqual(plain(s.calls[1].slice(1, 4)), ['POST', '/api/cards/4/reorder', { prev: 2, next: 3 }]);
});

test('reorderCard holds the poll off for the whole round trip', async () => {
  const s = load();
  await s.reorderCard(4, 2, 3);
  assert.strictEqual(s.calls.find((c) => c[0] === 'api')[4], 1, 'one drop in flight while the call runs');
  assert.strictEqual(s.pending(), 0, 'and none afterwards');
});

test('a full gap shows every renumbered sibling at once', async () => {
  const s = load();
  s.state.active.find((c) => c.id === 3).rank = 11;
  await s.reorderCard(4, 2, 3);
  assert.deepStrictEqual(plain(s.calls[0]), ['render', JSON.stringify([null, 10, 30, 20])]);
});

test('when the call fails the ranks go back, the failure is shown and the board is reloaded from the server', async () => {
  const s = load({ async api() { throw new Error('disk full'); } });
  await s.reorderCard(4, 2, 3);
  assert.deepStrictEqual(plain(s.state.active.map((c) => c.rank)), [null, 10, 20, 30]);
  assert.deepStrictEqual(s.calls.map((c) => c[0]), ['render', 'render', 'toast', 'load']);
  assert.match(s.calls[2][1], /Reorder failed: disk full/);
  assert.strictEqual(s.pending(), 0);
});

test('a failed reload after a call that went through is not a failed reorder', async () => {
  const s = load({ async loadBoard() { throw new Error('offline'); } });
  await s.reorderCard(4, 2, 3);
  assert.deepStrictEqual(plain(s.state.active.map((c) => c.rank)), [null, 10, 20, 15], 'the new order stays on screen');
  const toasts = s.calls.filter((c) => c[0] === 'toast').map((c) => c[1]);
  assert.strictEqual(toasts.length, 1);
  assert.doesNotMatch(toasts[0], /Reorder failed/);
  assert.match(toasts[0], /offline/);
  assert.strictEqual(s.pending(), 0);
});

test('a drop where the card already stands sends nothing and draws nothing', async () => {
  const s = load();
  await s.reorderCard(3, 2, 4);
  assert.deepStrictEqual(s.calls, []);
});

test('a drop among another parent\'s children is refused with a message and sends nothing', async () => {
  const s = load();
  s.state.active.push(card(6), card(7, { parent: 6, rank: 10 }), card(8, { parent: 6, rank: 20 }));
  await s.reorderCard(4, 7, 8);
  assert.deepStrictEqual(s.calls.map((c) => c[0]), ['toast']);
  assert.match(s.calls[0][1], /siblings/);
  assert.deepStrictEqual(plain(s.state.active.slice(0, 4).map((c) => c.rank)), [null, 10, 20, 30]);
});

test('an archived sibling is renumbered on screen with the rest', async () => {
  const s = load();
  s.state.active.find((c) => c.id === 3).rank = 11;
  s.state.archived.push(card(5, { parent: 1, rank: 12, archived: true, status: 'done' }));
  await s.reorderCard(4, 2, 3);
  assert.strictEqual(s.state.archived[0].rank, 40);
});

// --- the wiring in wireDrag ----------------------------------------------------

const wire = fn('wireDrag');

test('the column drop handler tries the reorder before the archive and bulk routes', () => {
  const drop = wire.slice(wire.indexOf("addEventListener('drop'"));
  const reorder = drop.indexOf('isReorderDrop(ids, dest)');
  assert.ok(reorder > 0, 'drop asks isReorderDrop');
  assert.ok(reorder < drop.indexOf('archiveAwareDrop(ids, dest)'), 'before the archive route');
  assert.ok(reorder < drop.indexOf('onBulkDrop(ids, dest)'), 'before the bulk route');
  assert.match(drop, /reorderDrop\(col, ids\[0\], e\.clientY\)/);
  assert.match(drop, /onDrop\(ids\[0\], dest\)/, 'a drop on another column is still a move');
});

test('the drop line is drawn on dragover and cleared on dragleave, drop and dragend', () => {
  const over = wire.slice(wire.indexOf("addEventListener('dragover'"), wire.indexOf("addEventListener('dragleave'"));
  assert.match(over, /markDropPoint\(/);
  assert.match(over, /isReorderDrop\(/);
  const leave = wire.slice(wire.indexOf("addEventListener('dragleave'"), wire.indexOf("addEventListener('drop'"));
  assert.match(leave, /clearDropMarks\(\)/);
  const drop = wire.slice(wire.indexOf("addEventListener('drop'"));
  assert.match(drop, /clearDropMarks\(\)/);
  const end = wire.slice(wire.indexOf("addEventListener('dragend'"), wire.indexOf("document.querySelectorAll('.column')"));
  assert.match(end, /clearDropMarks\(\)/);
});

test('dragstart remembers the card for dragover, which cannot read the data transfer', () => {
  const start = wire.slice(wire.indexOf("addEventListener('dragstart'"), wire.indexOf("addEventListener('dragend'"));
  assert.match(start, /dragCardId = Number\(el\.dataset\.id\)/);
  const end = wire.slice(wire.indexOf("addEventListener('dragend'"), wire.indexOf("document.querySelectorAll('.column')"));
  assert.match(end, /dragCardId = null/);
});

test('the drop line is drawn in the accent token above or below the tile', () => {
  assert.match(css, /\.card\.drop-before \{[^}]*var\(--accent\)/);
  assert.match(css, /\.card\.drop-after \{[^}]*var\(--accent\)/);
});

// --- the drop line only shows where a drop would be taken -----------------------

// wireDrag run against one fake column, to see what the dragover handler draws.
function dragoverOn(tiles, dragId, clientY, extra) {
  const s = load(extra);
  s.state.active.push(card(6), card(7, { parent: 6, rank: 10 }), card(8, { parent: 6, rank: 20 }));
  const handlers = {};
  const col = {
    dataset: { col: 'todo' },
    classList: { add() {}, remove() {} },
    contains: () => false,
    querySelectorAll: () => tiles,
    addEventListener(type, fn2) { handlers[type] = fn2; },
  };
  s.document = { querySelectorAll: (sel) => (sel === '.column' ? [col] : []) };
  const board = { querySelectorAll: () => [] };
  s.$ = () => board;
  s.markDropPoint = (shown, at) => s.calls.push(['mark', shown.map((t) => t.dataset.id).join(','), at]);
  s.clearDropMarks = () => s.calls.push(['clear']);
  vm.runInContext('let dragCardId = null, bulkDragIds = null, isDragging = false; const selectedIds = new Set();', s);
  vm.runInContext(`${wire}\nwireDrag();\ndragCardId = ${dragId};`, s);
  handlers.dragover({ preventDefault() {}, clientY });
  return s.calls;
}

const OUTLINE_TILES = [1, 2, 3, 6, 7, 8].map((id, i) => tile(id, i * 50, 40));

test('dragging over a spot between two siblings draws the drop line', () => {
  const calls = dragoverOn(OUTLINE_TILES, 4, 100);
  assert.deepStrictEqual(plain(calls), [['mark', '1,2,3,6,7,8', 2]]);
});

test('dragging over another parent\'s children draws no line, since the drop would be refused', () => {
  const calls = dragoverOn(OUTLINE_TILES, 4, 250);
  assert.deepStrictEqual(plain(calls), [['clear']]);
});
