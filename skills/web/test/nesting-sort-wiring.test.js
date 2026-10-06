const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

// --- the sort the user sees, and what is remembered --------------------

// The persistence functions run for real against a fake localStorage: the bug
// guarded is a default (outline on a nested board) being frozen into storage
// as if the user had picked it.
function loadSortWiring(storage, boardState) {
  const pick = (re) => { const m = appJs.match(re); assert.ok(m, `${re} found in app.js`); return m[0]; };
  const src = [
    'let columnSort = null;\nlet columnSortPicks = null;\nlet columnSortNested = false;',
    pick(/function boardIsNested\([\s\S]*?\n\}/),
    pick(/function loadColumnSort\([\s\S]*?\n\}/),
    pick(/function saveColumnSort\([\s\S]*?\n\}/),
    pick(/function pickSort\([\s\S]*?\n\}/),
    pick(/function setColumnSortField\([\s\S]*?\n\}/),
    pick(/function toggleColumnSortDirection\([\s\S]*?\n\}/),
  ].join('\n');
  const cs = require('../web/column-sort');
  const sandbox = {
    state: boardState,
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
    storageKey: require('../web/column-state').storageKey,
    boardColumnIds: () => ['todo', 'doing', 'archive'],
    renderBoard: () => {},
    SORT_FIELDS: cs.SORT_FIELDS,
    DEFAULT_SORT_DIRECTION: cs.DEFAULT_SORT_DIRECTION,
    mergeSortState: cs.mergeSortState,
    readSortPicks: cs.readSortPicks,
    hasNesting: require('../web/nesting').hasNesting,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox;
}

const OUTLINE = { field: 'outline', direction: 'asc' };
const PRIORITY = { field: 'priority', direction: 'desc' };
const KEY = 'kanban.demo.columns.sort';
const plain = (v) => JSON.parse(JSON.stringify(v));

test('a board without rank or parent opens on the sort it always had', () => {
  const w = loadSortWiring({}, { projectName: 'demo', active: [{ id: 1 }, { id: 2 }], archived: [] });
  assert.deepStrictEqual(plain(w.loadColumnSort()), { todo: PRIORITY, doing: PRIORITY, archive: { field: 'id', direction: 'asc' } });
});

test('a board where any card has a rank or a parent opens in outline order, and a pick still wins', () => {
  const storage = {};
  const boardState = { projectName: 'demo', active: [{ id: 1 }, { id: 2, parent: 1 }], archived: [] };
  const w = loadSortWiring(storage, boardState);
  assert.deepStrictEqual(plain(w.loadColumnSort()), { todo: OUTLINE, doing: OUTLINE, archive: { field: 'id', direction: 'asc' } });
  w.setColumnSortField('doing', 'due');
  assert.deepStrictEqual(plain(w.loadColumnSort()).doing, { field: 'due', direction: 'asc' });
  assert.deepStrictEqual(plain(w.loadColumnSort()).todo, OUTLINE);
});

test('changing one column stores that pick alone, so a default never freezes into the others', () => {
  const storage = {};
  const boardState = { projectName: 'demo', active: [{ id: 1 }, { id: 2 }], archived: [] };
  const w = loadSortWiring(storage, boardState);
  w.loadColumnSort();
  w.setColumnSortField('todo', 'due');
  assert.deepStrictEqual(JSON.parse(storage[KEY]), { picked: { todo: { field: 'due', direction: 'asc' } } });

  boardState.active.push({ id: 3, parent: 1 }); // the board gains a parent
  const after = loadSortWiring(storage, boardState);
  assert.deepStrictEqual(plain(after.loadColumnSort()), { todo: { field: 'due', direction: 'asc' }, doing: OUTLINE, archive: { field: 'id', direction: 'asc' } });
});

test('the sort follows the board when it gains or loses its first rank or parent, without a reload', () => {
  const boardState = { projectName: 'demo', active: [{ id: 1 }], archived: [] };
  const w = loadSortWiring({}, boardState);
  assert.deepStrictEqual(plain(w.loadColumnSort().todo), PRIORITY);
  boardState.active.push({ id: 2, rank: 10 });
  assert.deepStrictEqual(plain(w.loadColumnSort().todo), OUTLINE);
  boardState.active.pop();
  assert.deepStrictEqual(plain(w.loadColumnSort().todo), PRIORITY);
});

test('a deliberate priority pick on a nested board survives a reload', () => {
  const storage = {};
  const boardState = { projectName: 'demo', active: [{ id: 1 }, { id: 2, parent: 1 }], archived: [] };
  const w = loadSortWiring(storage, boardState);
  w.loadColumnSort();
  w.setColumnSortField('todo', 'priority');
  const reloaded = loadSortWiring(storage, boardState);
  assert.deepStrictEqual(plain(reloaded.loadColumnSort().todo), PRIORITY);
  assert.deepStrictEqual(plain(reloaded.loadColumnSort().doing), OUTLINE);
});

test('toggling the direction records a pick too', () => {
  const storage = {};
  const boardState = { projectName: 'demo', active: [{ id: 1, rank: 10 }], archived: [] };
  const w = loadSortWiring(storage, boardState);
  w.loadColumnSort();
  w.toggleColumnSortDirection('todo');
  assert.deepStrictEqual(JSON.parse(storage[KEY]), { picked: { todo: { field: 'outline', direction: 'desc' } } });
});

test('a sort saved before picks were tracked keeps its real picks and drops the frozen defaults', () => {
  const storage = { [KEY]: JSON.stringify({ todo: PRIORITY, doing: { field: 'due', direction: 'asc' }, archive: { field: 'id', direction: 'asc' } }) };
  const boardState = { projectName: 'demo', active: [{ id: 1 }, { id: 2, parent: 1 }], archived: [] };
  const w = loadSortWiring(storage, boardState);
  assert.deepStrictEqual(plain(w.loadColumnSort()), { todo: OUTLINE, doing: { field: 'due', direction: 'asc' }, archive: { field: 'id', direction: 'asc' } });
});

test('a changed board or status list re-reads the picks: app.js resets the memo for both', () => {
  for (const fn of ['applyStatuses', 'applyProjectName']) {
    const body = appJs.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`))[0];
    assert.match(body, /columnSort = null/);
    assert.match(body, /columnSortPicks = null/, `${fn} also drops the remembered picks`);
  }
});

test('both ways of changing a column\'s sort write the pick through one helper', () => {
  assert.match(appJs, /function pickSort\(/);
  for (const fn of ['setColumnSortField', 'toggleColumnSortDirection']) {
    const body = appJs.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`))[0];
    assert.match(body, /pickSort\(/, `${fn} goes through pickSort`);
    assert.doesNotMatch(body, /columnSortPicks/, `${fn} does not write the picks itself`);
  }
});
