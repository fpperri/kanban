const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { assertKeepsSelection } = require('./helpers/markers');

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('app.js');
const html = read('app.html');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

// Every roll-up memo and pref loader/saver app.js defines, whatever it is
// called, so a sandbox runs what the page runs and nothing is stubbed by name.
const rollupState = () => appSrc.match(/^let rollup\w* = null;$/gm) || [];
const rollupPrefs = () => [...appSrc.matchAll(/^function ((?:load|save)Rollup\w*)\(/gm)].map((m) => fn(m[1]));
// The preferences entry the archived-leaves choice lives in: its memo, loader and the one reader a roll-up asks.
const prefsState = () => {
  const memo = appSrc.match(/^let prefsMemo = null;$/m);
  assert.ok(memo, 'the page keeps one memo for the preferences entry');
  return [memo[0], fn('prefsStorage'), fn('loadPrefsState'), fn('countArchivedLeaves')];
};

// A sandbox with just what the pref helpers touch: a state, a storage that can
// be made to throw, and the real merge/key functions.
function prefSandbox({ stored = {}, throws = false } = {}) {
  const colState = require('../web/column-state');
  const writes = {};
  const sandbox = {
    state: { projectName: 'shop' },
    ...colState,
    localStorage: {
      getItem(k) { if (throws) throw new Error('blocked'); return Object.prototype.hasOwnProperty.call(stored, k) ? stored[k] : null; },
      setItem(k, v) { if (throws) throw new Error('blocked'); writes[k] = v; },
    },
    writes,
  };
  vm.createContext(sandbox);
  vm.runInContext([...rollupState(), ...rollupPrefs()].join('\n'), sandbox);
  return sandbox;
}

// --- the one per-browser choice ------------------------------------------------

test('the bar mode defaults to collapsed, reads the saved choice, and is namespaced by board', () => {
  assert.strictEqual(prefSandbox().loadRollupBarMode(), 'collapsed');
  assert.strictEqual(prefSandbox({ stored: { 'kanban.shop.rollup.bar': 'open' } }).loadRollupBarMode(), 'open');
  assert.strictEqual(prefSandbox({ stored: { 'kanban.other.rollup.bar': 'open' } }).loadRollupBarMode(), 'collapsed');
  assert.strictEqual(prefSandbox({ stored: { 'kanban.shop.rollup.bar': 'garbage' } }).loadRollupBarMode(), 'collapsed');
});

test('a browser that saved off before it was retired reads as collapsed', () => {
  assert.strictEqual(prefSandbox({ stored: { 'kanban.shop.rollup.bar': 'off' } }).loadRollupBarMode(), 'collapsed');
});

test('the bar mode survives a reload: what is saved is what the next page load reads', () => {
  const first = prefSandbox();
  vm.runInContext("rollupBarMode = 'open'; saveRollupBarMode();", first);
  assert.deepStrictEqual(first.writes, { 'kanban.shop.rollup.bar': 'open' });
  const reloaded = prefSandbox({ stored: first.writes });
  assert.strictEqual(reloaded.loadRollupBarMode(), 'open');
});

test('the archived-leaves choice lives in the preferences entry: the roll-up memo and loaders stay the bar mode\'s, and the old key is never read or written', () => {
  assert.deepStrictEqual(rollupState(), ['let rollupBarMode = null;']);
  assert.deepStrictEqual([...appSrc.matchAll(/^function ((?:load|save)Rollup\w*)\(/gm)].map((m) => m[1]), ['loadRollupBarMode', 'saveRollupBarMode']);
  assert.doesNotMatch(appSrc, /rollup\.archived/);
  assert.match(fn('loadPrefsState'), /loadPrefs\(/, 'the choice comes from the preferences module');
  assert.match(fn('countArchivedLeaves'), /loadPrefsState\(\)\.archivedDone/);
});

test('blocked storage falls back to the default and a failed save never throws', () => {
  const blocked = prefSandbox({ throws: true });
  assert.strictEqual(blocked.loadRollupBarMode(), 'collapsed');
  assert.doesNotThrow(() => vm.runInContext('saveRollupBarMode();', blocked));
});

test('a project rename drops the remembered choice so the next read uses the right board key', () => {
  const body = fn('applyProjectName');
  assert.match(body, /rollupBarMode = null;/);
  assert.match(body, /prefsMemo = null;/, 'the preferences entry is dropped with it');
  assert.doesNotMatch(body, /rollupCountArchived/);
  assert.ok(body.indexOf('rollupBarMode = null;') < body.indexOf('state.projectName = next;'), 'reset before the new name lands');
  assert.ok(body.indexOf('prefsMemo = null;') < body.indexOf('state.projectName = next;'), 'reset before the new name lands');
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

test('renderBoard only paints the board: it reaches for no header control', () => {
  assert.doesNotMatch(fn('renderBoard'), /Rollup|rollup/);
  assert.doesNotMatch(appSrc, /syncRollupControls/);
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

test('the tile reads the remembered mode and asks the index with the count-archived choice', () => {
  const body = fn('parentTile');
  assert.match(body, /loadRollupBarMode\(\)/);
  assert.match(body, /nestingIndex\.rollup\(card\.id, \{ countArchived: countArchivedLeaves\(\) \}\)/);
  assert.match(body, /nestingIndex\.altitudeOf\(card\.id\)/);
});

// --- header, detail block ------------------------------------------------------

test('the header carries no roll-up control: no Bar select, no Archived box, no wrapper, and nothing wired to them', () => {
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.ok(header.includes('id="graph-toggle-btn"') && header.includes('id="refresh-btn"'), 'the slice is the page header');
  assert.doesNotMatch(header, /rollup/);
  assert.match(header, /id="graph-toggle-btn"[^>]*>(?:<span[^>]*><\/span>)?<span class="btn-label">Graph<\/span><\/button>\s*<button id="refresh-btn"/, 'the controls around the gap did not move');
  assert.doesNotMatch(appSrc, /#rollup-/);
  assert.doesNotMatch(read('app.css'), /rollup-ctl/);
});

test('a click on a roll-up bar keeps a building multi-selection, and no control that is gone is marked to', () => {
  assertKeepsSelection(['.rollup'], 'the roll-up bar');
  assert.doesNotMatch(appSrc + html, /rollup-ctl/, 'nothing is left of the retired controls, marker included');
});

test('the card detail has a roll-up block under the thread and above the fields, filled from state', () => {
  assert.match(html, /<div id="detail-rollup" class="detail-rollup hidden"><\/div>/);
  assert.ok(html.indexOf('id="detail-rollup"') > html.indexOf('id="detail-thread"'), 'below the thread');
  assert.ok(html.indexOf('id="detail-rollup"') < html.indexOf('id="detail-frontmatter"'), 'above the fields');
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
  for (const name of ['parentTile', 'paintRollupBars', 'renderDetailRollup']) {
    assert.doesNotMatch(fn(name), /style="|setAttribute\('style'/, `${name} stays CSP-clean`);
  }
});

// --- a tile, end to end through the real helpers ---------------------------------

function tileSandbox(cards, { mode, archivedKey, archivedDone } = {}) {
  const colState = require('../web/column-state');
  const stored = {};
  if (mode) stored['kanban.kanban.rollup.bar'] = mode;
  if (archivedKey !== undefined) stored['kanban.kanban.rollup.archived'] = archivedKey;
  if (archivedDone !== undefined) stored['kanban.kanban.prefs'] = JSON.stringify({ archivedDone });
  const sandbox = {
    state: { active: cards.filter((c) => !c.archived), archived: cards.filter((c) => c.archived), projectName: 'kanban', priorities: [], statuses: [] },
    ...colState,
    localStorage: { getItem: (k) => (k in stored ? stored[k] : null), setItem() {} },
    ...require('../web/prefs'),
    ...require('../web/nesting'),
    ...require('../web/rollup-bar'),
  };
  vm.createContext(sandbox);
  vm.runInContext([...rollupState(), ...prefsState(), 'let nestingIndex = null;',
    fn('boardStatuses'), ...rollupPrefs(), fn('nestingCtx'), fn('buildNestingIndex'), fn('parentTile'),
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

test('the remembered open mode puts numbers on the tile, and a saved off still draws the thin bar', () => {
  const open = tileSandbox(tileCards(), { mode: 'open' }).parentTile({ id: 1 });
  assert.match(open.bar, /<b class="rollup-total">3<\/b>/);
  const off = tileSandbox(tileCards(), { mode: 'off' }).parentTile({ id: 1 });
  assert.match(off.badge, /▲2/);
  assert.match(off.bar, /rollup-bar thin/);
  assert.doesNotMatch(off.bar, /rollup-total/);
});

test('archiving a done story leaves the tile\'s done weight unchanged', () => {
  const cards = tileCards();
  cards.find((c) => c.id === 10).archived = true;
  assert.strictEqual(segCount(tileSandbox(cards).parentTile({ id: 2 }).bar), 2);
});

test('with archived leaves counted as done switched off in the preferences, the tile leaves them out', () => {
  const cards = tileCards();
  cards.find((c) => c.id === 10).archived = true;
  assert.strictEqual(segCount(tileSandbox(cards, { archivedDone: false }).parentTile({ id: 2 }).bar), 1);
  assert.strictEqual(segCount(tileSandbox(cards, { archivedDone: true }).parentTile({ id: 2 }).bar), 2);
  assert.strictEqual(segCount(tileSandbox(cards).parentTile({ id: 2 }).bar), 2, 'nothing saved counts them');
});

test('one board\'s preferences never reach another board\'s tile', () => {
  const cards = tileCards();
  cards.find((c) => c.id === 10).archived = true;
  const s = tileSandbox(cards, { archivedDone: false });
  assert.strictEqual(segCount(s.parentTile({ id: 2 }).bar), 1);
  vm.runInContext("state.projectName = 'other'; prefsMemo = null;", s);
  assert.strictEqual(segCount(s.parentTile({ id: 2 }).bar), 2);
});

test('a "false" an older visit stored under the retired archived key changes nothing: archived leaves still count as done', () => {
  const cards = tileCards();
  cards.find((c) => c.id === 10).archived = true;
  for (const archivedKey of ['false', 'true', 'garbage']) {
    const s = tileSandbox(cards, { mode: 'open', archivedKey });
    const tile = s.parentTile({ id: 2 });
    assert.strictEqual(segCount(tile.bar), 2, `stored ${archivedKey}`);
    assert.match(tile.bar, /<span class="rollup-count">1 done<\/span>/, `stored ${archivedKey}`);
  }
});
