const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('app.js');
const html = read('app.html');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

// A sandbox with just what the pref helpers touch: a state, a storage that can
// be made to throw, and the real merge/key functions.
function prefSandbox({ stored = {}, throws = false } = {}) {
  const colState = require('../web/column-state');
  const writes = {};
  const sandbox = {
    state: { projectName: 'shop' },
    storageKey: colState.storageKey,
    mergeRollupBar: colState.mergeRollupBar,
    mergeRollupCountArchived: colState.mergeRollupCountArchived,
    localStorage: {
      getItem(k) { if (throws) throw new Error('blocked'); return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
      setItem(k, v) { if (throws) throw new Error('blocked'); writes[k] = v; },
    },
    writes,
  };
  vm.createContext(sandbox);
  vm.runInContext(['let rollupBarMode = null;', 'let rollupCountArchived = null;',
    fn('loadRollupBarMode'), fn('saveRollupBarMode'), fn('loadRollupCountArchived'), fn('saveRollupCountArchived')].join('\n'), sandbox);
  return sandbox;
}

// --- the two per-browser choices ---------------------------------------------

test('the bar mode defaults to collapsed, reads the saved choice, and is namespaced by board', () => {
  assert.strictEqual(prefSandbox().loadRollupBarMode(), 'collapsed');
  assert.strictEqual(prefSandbox({ stored: { 'kanban.shop.rollup.bar': 'open' } }).loadRollupBarMode(), 'open');
  assert.strictEqual(prefSandbox({ stored: { 'kanban.other.rollup.bar': 'open' } }).loadRollupBarMode(), 'collapsed');
  assert.strictEqual(prefSandbox({ stored: { 'kanban.shop.rollup.bar': 'garbage' } }).loadRollupBarMode(), 'collapsed');
});

test('the bar mode survives a reload: what is saved is what the next page load reads', () => {
  const first = prefSandbox();
  vm.runInContext("rollupBarMode = 'off'; saveRollupBarMode();", first);
  assert.deepStrictEqual(first.writes, { 'kanban.shop.rollup.bar': 'off' });
  const reloaded = prefSandbox({ stored: first.writes });
  assert.strictEqual(reloaded.loadRollupBarMode(), 'off');
});

test('archived leaves count by default, and the choice to leave them out survives a reload', () => {
  assert.strictEqual(prefSandbox().loadRollupCountArchived(), true);
  const first = prefSandbox();
  vm.runInContext('rollupCountArchived = false; saveRollupCountArchived();', first);
  assert.deepStrictEqual(first.writes, { 'kanban.shop.rollup.archived': 'false' });
  assert.strictEqual(prefSandbox({ stored: first.writes }).loadRollupCountArchived(), false);
});

test('blocked storage falls back to the defaults and a failed save never throws', () => {
  const blocked = prefSandbox({ throws: true });
  assert.strictEqual(blocked.loadRollupBarMode(), 'collapsed');
  assert.strictEqual(blocked.loadRollupCountArchived(), true);
  assert.doesNotThrow(() => vm.runInContext('saveRollupBarMode(); saveRollupCountArchived();', blocked));
});

test('a project rename drops both remembered choices so the next read uses the right board key', () => {
  const body = fn('applyProjectName');
  assert.match(body, /rollupBarMode = null;/);
  assert.match(body, /rollupCountArchived = null;/);
  assert.ok(body.indexOf('rollupBarMode = null;') < body.indexOf('state.projectName = next;'), 'reset before the new name lands');
});

// --- painting the bar ---------------------------------------------------------

test('paintRollupBars gives each segment its weight through the CSSOM, never an attribute', () => {
  const segs = [{ dataset: { n: '9' }, style: {}, setAttribute() { throw new Error('no attributes'); } }, { dataset: { n: '2' }, style: {} }];
  const asked = [];
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fn('paintRollupBars'), sandbox);
  sandbox.paintRollupBars({ querySelectorAll(sel) { asked.push(sel); return segs; } });
  assert.deepStrictEqual(asked, ['.rollup-seg[data-n]']);
  assert.strictEqual(segs[0].style.flexGrow, '9');
  assert.strictEqual(segs[1].style.flexGrow, '2');
});

// --- tiles ---------------------------------------------------------------------

test('renderBoard indexes the board once, before any tile is drawn, and tiles only read that index', () => {
  const body = fn('renderBoard');
  assert.ok(body.indexOf('nestingIndex = buildNestingIndex()') > -1, 'renderBoard rebuilds the index every paint');
  assert.ok(body.indexOf('nestingIndex = buildNestingIndex()') < body.indexOf('renderBoardColumns()'), 'index exists before columns draw');
  for (const name of ['cardEl', 'archiveCardEl', 'parentTile']) {
    assert.doesNotMatch(fn(name), /rollupIndex\(/, `${name} does not rebuild the tree per tile`);
  }
});

test('board tiles and archived tiles carry the altitude badge in the head row and the bar as the last line of the main column', () => {
  for (const name of ['cardEl', 'archiveCardEl']) {
    const body = fn(name);
    assert.match(body, /const parent = parentTile\(card\);/, `${name} asks for the parent bits once`);
    const head = body.match(/<div class="card-head">[^\n]*<\/div>/);
    assert.ok(head, `${name} has a card-head row`);
    assert.match(head[0], /\$\{parent\.badge\}/, `${name} puts the badge in the head`);
    assert.match(body, /\$\{parent\.bar\}|parent\.bar/, `${name} puts the bar in the tile`);
    assert.match(body, /paintRollupBars\(el\)/, `${name} paints the weights after innerHTML lands`);
    assert.ok(body.indexOf('paintRollupBars(el)') > body.indexOf('el.innerHTML ='), `${name} paints after insertion`);
  }
});

test('the tile reads the remembered mode and the archived choice', () => {
  const body = fn('parentTile');
  assert.match(body, /loadRollupBarMode\(\)/);
  assert.match(body, /countArchived: loadRollupCountArchived\(\)/);
  assert.match(body, /nestingIndex\.altitudeOf\(card\.id\)/);
});

// --- header controls, detail block ---------------------------------------------

test('the header carries the bar mode select and the archived checkbox, wired to save and repaint', () => {
  assert.match(html, /<span id="rollup-ctls" class="rollup-ctls hidden">/);
  assert.match(html, /<select id="rollup-bar-mode"/);
  for (const v of ['open', 'collapsed', 'off']) assert.match(html, new RegExp(`<option value="${v}">`));
  assert.match(html, /<input type="checkbox" id="rollup-archived"/);
  assert.match(appSrc, /\$\('#rollup-bar-mode'\)\.addEventListener\('change'/);
  assert.match(appSrc, /\$\('#rollup-archived'\)\.addEventListener\('change'/);
  const sync = fn('syncRollupControls');
  assert.match(sync, /nestingIndex\.parents\(\)\.length/, 'controls show only on a board that has parents');
});

test('a click on the roll-up controls keeps a building multi-selection', () => {
  const line = appSrc.split('\n').find((l) => l.includes("e.target.closest('#context-menu, #bulk-single"));
  assert.ok(line, 'the Q0 exemption selector is there');
  assert.match(line, /\.rollup-ctl\b/);
});

test('the card detail has a roll-up block between the body and whatever follows, filled from state', () => {
  assert.match(html, /<div id="detail-rollup" class="detail-rollup hidden"><\/div>/);
  assert.ok(html.indexOf('id="detail-rollup"') > html.indexOf('id="detail-body"'), 'below the body');
  const body = fn('openDetailModal');
  assert.match(body, /renderDetailRollup\(data\.id\)/);
  const render = fn('renderDetailRollup');
  assert.match(render, /rollupDetailHtml\(/);
  assert.match(render, /paintRollupBars\(box\)/);
  assert.match(render, /classList\.add\('hidden'\)/, 'a card with nothing below hides the block');
});

test('rollup-bar.js is a page script loaded before app.js', () => {
  const at = (s) => html.indexOf(`<script src="/${s}"></script>`);
  assert.ok(at('rollup-bar.js') > -1);
  assert.ok(at('rollup-bar.js') < at('app.js'));
});

// --- the done warning ------------------------------------------------------------

test('every place a status can change to done asks for the open-leaves warning', () => {
  for (const name of ['onDrop', 'archiveAwareDrop', 'onBulkDrop', 'submitModal']) {
    assert.match(fn(name), /openLeavesNote\(/, `${name} warns`);
  }
});

test('the warning never blocks: each caller moves first and only then toasts', () => {
  assert.ok(fn('onDrop').indexOf("api('PATCH'") < fn('onDrop').indexOf('openLeavesNote('));
  assert.ok(fn('onBulkDrop').indexOf("api('PATCH'") < fn('onBulkDrop').indexOf('openLeavesNote('));
  assert.ok(fn('submitModal').indexOf("api('PATCH'") < fn('submitModal').indexOf('openLeavesNote('));
  assert.doesNotMatch(fn('openLeavesNote'), /return false|confirm\(/, 'a warning, not a gate');
});

function noteSandbox(cards) {
  const { rollupIndex } = require('../web/nesting');
  const { openLeavesWarning } = require('../web/rollup-bar');
  const sandbox = {
    state: { active: cards, archived: [], projectName: 'kanban', priorities: [] },
    rollupIndex, openLeavesWarning,
  };
  vm.createContext(sandbox);
  vm.runInContext([fn('nestingCtx'), fn('buildNestingIndex'), fn('openLeavesNote')].join('\n'), sandbox);
  return sandbox;
}

test('openLeavesNote names the parents moved to done that still have open leaves', () => {
  const cards = [
    { id: 1, parent: null, status: 'done', archived: false },
    { id: 2, parent: 1, status: 'doing', archived: false },
    { id: 3, parent: 1, status: 'done', archived: false },
    { id: 4, parent: null, status: 'done', archived: false },
    { id: 5, parent: 4, status: 'done', archived: false },
  ];
  const s = noteSandbox(cards);
  assert.strictEqual(s.openLeavesNote([cards[0], cards[3]], 'done'), 'Done with open leaves below: #1 (1 open)');
});

test('openLeavesNote says nothing for any other status, or for a leaf, or when every leaf is finished', () => {
  const cards = [
    { id: 1, parent: null, status: 'todo', archived: false },
    { id: 2, parent: 1, status: 'doing', archived: false },
    { id: 3, parent: null, status: 'doing', archived: false },
  ];
  const s = noteSandbox(cards);
  assert.strictEqual(s.openLeavesNote([cards[0]], 'doing'), '');
  assert.strictEqual(s.openLeavesNote([cards[0]], 'Done'), '');
  assert.strictEqual(s.openLeavesNote([cards[2]], 'done'), '');
  cards[1].status = 'done';
  assert.strictEqual(s.openLeavesNote([cards[0]], 'done'), '');
});

test('the bar and badge builders never write a style attribute in app.js', () => {
  for (const name of ['parentTile', 'paintRollupBars', 'renderDetailRollup', 'syncRollupControls']) {
    assert.doesNotMatch(fn(name), /style="|setAttribute\('style'/, `${name} stays CSP-clean`);
  }
});

// --- a tile, end to end through the real helpers ---------------------------------

function tileSandbox(cards, { mode, countArchived } = {}) {
  const colState = require('../web/column-state');
  const stored = {};
  if (mode) stored['kanban.kanban.rollup.bar'] = mode;
  if (countArchived === false) stored['kanban.kanban.rollup.archived'] = 'false';
  const sandbox = {
    state: { active: cards.filter((c) => !c.archived), archived: cards.filter((c) => c.archived), projectName: 'kanban', priorities: [], statuses: [] },
    storageKey: colState.storageKey,
    mergeRollupBar: colState.mergeRollupBar,
    mergeRollupCountArchived: colState.mergeRollupCountArchived,
    liveStatuses: colState.liveStatuses,
    localStorage: { getItem: (k) => (k in stored ? stored[k] : null), setItem() {} },
    ...require('../web/nesting'),
    ...require('../web/rollup-bar'),
  };
  vm.createContext(sandbox);
  vm.runInContext(['let rollupBarMode = null;', 'let rollupCountArchived = null;', 'let nestingIndex = null;',
    fn('boardStatuses'), fn('loadRollupBarMode'), fn('loadRollupCountArchived'), fn('nestingCtx'), fn('buildNestingIndex'), fn('parentTile'),
    'nestingIndex = buildNestingIndex();'].join('\n'), sandbox);
  return sandbox;
}

const tileCards = () => [
  { id: 1, parent: null, status: 'doing', archived: false },
  { id: 2, parent: 1, status: 'doing', archived: false },
  { id: 3, parent: 1, status: 'todo', archived: false },
  { id: 10, parent: 2, status: 'done', archived: false },
  { id: 11, parent: 2, status: 'doing', archived: false },
  { id: 12, parent: 3, status: 'backlog', archived: false },
];
const segCount = (html) => [...html.matchAll(/data-n="(\d+)"/g)].reduce((sum, m) => sum + Number(m[1]), 0);

test('an objective over two epics with stories shows ▲2 and a bar counting only the stories', () => {
  const s = tileSandbox(tileCards());
  const tile = s.parentTile({ id: 1 });
  assert.match(tile.badge, />▲2</);
  assert.match(tile.bar, /rollup-bar thin/, 'collapsed by default on a board tile');
  assert.strictEqual(segCount(tile.bar), 3, 'three stories, the two epics are not counted beside them');
  assert.strictEqual(s.parentTile({ id: 2 }).badge.includes('▲1'), true);
  const leaf = s.parentTile({ id: 10 });
  assert.strictEqual(leaf.badge, '');
  assert.strictEqual(leaf.bar, '');
});

test('the remembered open mode puts numbers on the tile, off keeps the badge and drops the bar', () => {
  const open = tileSandbox(tileCards(), { mode: 'open' }).parentTile({ id: 1 });
  assert.match(open.bar, /<b class="rollup-total">3<\/b>/);
  const off = tileSandbox(tileCards(), { mode: 'off' }).parentTile({ id: 1 });
  assert.match(off.badge, /▲2/);
  assert.strictEqual(off.bar, '');
});

test('archiving a done story leaves the tile\'s done weight unchanged; leaving archived out drops it', () => {
  const cards = tileCards();
  cards.find((c) => c.id === 10).archived = true;
  assert.strictEqual(segCount(tileSandbox(cards).parentTile({ id: 2 }).bar), 2);
  assert.strictEqual(segCount(tileSandbox(cards, { countArchived: false }).parentTile({ id: 2 }).bar), 1);
});

test('the roll-up controls are wired in a block of their own, ahead of the map view wiring', () => {
  const wiring = appSrc.indexOf('// --- Map view wiring');
  const bar = appSrc.indexOf("$('#rollup-bar-mode').addEventListener('change'");
  const archived = appSrc.indexOf("$('#rollup-archived').addEventListener('change'");
  assert.ok(wiring > 0 && bar > 0 && archived > 0);
  assert.ok(bar < wiring && archived < wiring, 'neither listener sits in the map block');
  assert.ok(bar > appSrc.indexOf('function syncRollupControls('), 'the block follows syncRollupControls');
});
