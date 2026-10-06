const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createServer } = require('../scripts/server');

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-nest-srv-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), '---\nid: 1\nstatus: todo\npriority: Normal\n---\n\n# One\n');
  fs.writeFileSync(path.join(dir, '0002.two.card.md'), '---\nid: 2\nstatus: todo\npriority: Normal\nparent: "fpp#4"\nrank:   10\n---\n\n# Two\n');
  return dir;
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

async function req(base, method, p, body) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

// --- the API ---------------------------------------------------------

test('POST and PATCH take parent and rank, and the board lists them', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const created = await req(base, 'POST', '/api/cards', { title: 'Child', parent: '1', rank: '20' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.json.parent, 1);
    assert.strictEqual(created.json.rank, 20);

    const edited = await req(base, 'PATCH', '/api/cards/1', { parent: 'fpp#4', rank: 30 });
    assert.strictEqual(edited.status, 200);
    assert.strictEqual(edited.json.parent, 'fpp#4');
    assert.strictEqual(edited.json.rank, 30);

    const board = await req(base, 'GET', '/api/board');
    const byId = new Map(board.json.active.map((c) => [c.id, c]));
    assert.strictEqual(byId.get(1).parent, 'fpp#4');
    assert.strictEqual(byId.get(1).rank, 30);
    assert.strictEqual(byId.get(2).parent, 'fpp#4');
    assert.strictEqual(byId.get(2).rank, 10);
    assert.strictEqual(byId.get(created.json.id).parent, 1);

    const cleared = await req(base, 'PATCH', '/api/cards/1', { parent: '', rank: '' });
    assert.strictEqual(cleared.json.parent, null);
    assert.strictEqual(cleared.json.rank, null);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /^(parent|rank):/m);
  });
});

test('a cross-board parent survives every edit the form can make', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const body = { title: 'Two again', status: 'doing', priority: 'High', tags: ['x'], waiting_for: [], blocked: '', review: '', prompt: '', assignee: '', start_date: '', end_date: '', due_date: '', body: 'b', parent: 'fpp#4', rank: '10' };
    const saved = await req(base, 'PATCH', '/api/cards/2', body);
    assert.strictEqual(saved.status, 200);
    assert.strictEqual(saved.json.parent, 'fpp#4');
    assert.match(fs.readFileSync(path.join(dir, '0002.two.card.md'), 'utf8'), /^parent: "fpp#4"\nrank:   10$/m, 'the hand-written lines are not rewritten');
    await req(base, 'PATCH', '/api/cards/2', { status: 'done' });
    assert.strictEqual((await req(base, 'GET', '/api/board')).json.active.find((c) => c.id === 2).parent, 'fpp#4');
  });
});

// --- the page --------------------------------------------------------

test('GET /nesting.js is served, and the page loads it before app.js', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/nesting.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.indexOf('/nesting.js') > -1 && html.indexOf('/nesting.js') < html.indexOf('/app.js'));
  });
});

test('the form has Parent and Rank inputs in a "Show more fields" row; app.js seeds, tracks and sends them', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<input id="f-parent"/);
    assert.match(html, /<input id="f-rank"/);
    const extra = html.match(/<div class="row modal-extra">[\s\S]*?<\/div>/g) || [];
    assert.ok(extra.some((block) => block.includes('id="f-parent"') && block.includes('id="f-rank"')), 'both live in a .modal-extra row');
    const js = await (await fetch(`${base}/app.js`)).text();
    const open = js.match(/function openModal\([\s\S]*?\n\}/);
    assert.match(open[0], /\$\('#f-parent'\)\.value = card/, 'openModal seeds the parent');
    assert.match(open[0], /\$\('#f-rank'\)\.value = card/, 'openModal seeds the rank');
    const snap = js.match(/function snapshotFormFields\([\s\S]*?\n\}/);
    assert.match(snap[0], /#f-parent/, 'parent joins the dirty-check baseline');
    assert.match(snap[0], /#f-rank/, 'rank joins the dirty-check baseline');
    const submit = js.match(/async function submitModal\([\s\S]*?\n\}/);
    assert.match(submit[0], /parent: \$\('#f-parent'\)\.value\.trim\(\)/);
    assert.match(submit[0], /rank: \$\('#f-rank'\)\.value\.trim\(\)/);
  });
});

test('the board sorts every column against ONE outline index built over active and archived cards', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const render = js.match(/function renderBoardColumns\([\s\S]*?\n\}/);
    assert.match(render[0], /outlineOrder\(state\.active\.concat\(state\.archived\), \{ board: state\.projectName, priorities: state\.priorities \}\)\.index/);
    assert.match(render[0], /sortCards\(source, sortState, state\.priorities, [^\n]*, outlineIndex\)/);
    assert.ok(render[0].indexOf('outlineOrder(') < render[0].indexOf('for (const col of boardColumnIds())'), 'computed once, before the column loop');
  });
});

// --- the sort the user sees, and what is remembered --------------------

// The persistence functions run for real against a fake localStorage: the bug
// guarded is a default (outline on a nested board) being frozen into storage
// as if the user had picked it.
async function loadSortWiring(storage, boardState) {
  const base = await (async () => {
    const dir = tmpBoard();
    return withServer(dir, async (b) => (await fetch(`${b}/app.js`)).text());
  })();
  const pick = (re) => { const m = base.match(re); assert.ok(m, `${re} found in app.js`); return m[0]; };
  const src = [
    'let columnSort = null;\nlet columnSortPicks = null;\nlet columnSortNested = false;',
    pick(/function boardIsNested\([\s\S]*?\n\}/),
    pick(/function loadColumnSort\([\s\S]*?\n\}/),
    pick(/function saveColumnSort\([\s\S]*?\n\}/),
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

test('a board without rank or parent opens on the sort it always had', async () => {
  const w = await loadSortWiring({}, { projectName: 'demo', active: [{ id: 1 }, { id: 2 }], archived: [] });
  assert.deepStrictEqual(plain(w.loadColumnSort()), { todo: PRIORITY, doing: PRIORITY, archive: { field: 'id', direction: 'asc' } });
});

test('a board where any card has a rank or a parent opens in outline order, and a pick still wins', async () => {
  const storage = {};
  const boardState = { projectName: 'demo', active: [{ id: 1 }, { id: 2, parent: 1 }], archived: [] };
  const w = await loadSortWiring(storage, boardState);
  assert.deepStrictEqual(plain(w.loadColumnSort()), { todo: OUTLINE, doing: OUTLINE, archive: { field: 'id', direction: 'asc' } });
  w.setColumnSortField('doing', 'due');
  assert.deepStrictEqual(plain(w.loadColumnSort()).doing, { field: 'due', direction: 'asc' });
  assert.deepStrictEqual(plain(w.loadColumnSort()).todo, OUTLINE);
});

test('changing one column stores that pick alone, so a default never freezes into the others', async () => {
  const storage = {};
  const boardState = { projectName: 'demo', active: [{ id: 1 }, { id: 2 }], archived: [] };
  const w = await loadSortWiring(storage, boardState);
  w.loadColumnSort();
  w.setColumnSortField('todo', 'due');
  assert.deepStrictEqual(JSON.parse(storage[KEY]), { picked: { todo: { field: 'due', direction: 'asc' } } });

  boardState.active.push({ id: 3, parent: 1 }); // the board gains a parent
  const after = await loadSortWiring(storage, boardState);
  assert.deepStrictEqual(plain(after.loadColumnSort()), { todo: { field: 'due', direction: 'asc' }, doing: OUTLINE, archive: { field: 'id', direction: 'asc' } });
});

test('the sort follows the board when it gains or loses its first rank or parent, without a reload', async () => {
  const boardState = { projectName: 'demo', active: [{ id: 1 }], archived: [] };
  const w = await loadSortWiring({}, boardState);
  assert.deepStrictEqual(plain(w.loadColumnSort().todo), PRIORITY);
  boardState.active.push({ id: 2, rank: 10 });
  assert.deepStrictEqual(plain(w.loadColumnSort().todo), OUTLINE);
  boardState.active.pop();
  assert.deepStrictEqual(plain(w.loadColumnSort().todo), PRIORITY);
});

test('a deliberate priority pick on a nested board survives a reload', async () => {
  const storage = {};
  const boardState = { projectName: 'demo', active: [{ id: 1 }, { id: 2, parent: 1 }], archived: [] };
  const w = await loadSortWiring(storage, boardState);
  w.loadColumnSort();
  w.setColumnSortField('todo', 'priority');
  const reloaded = await loadSortWiring(storage, boardState);
  assert.deepStrictEqual(plain(reloaded.loadColumnSort().todo), PRIORITY);
  assert.deepStrictEqual(plain(reloaded.loadColumnSort().doing), OUTLINE);
});

test('toggling the direction records a pick too', async () => {
  const storage = {};
  const boardState = { projectName: 'demo', active: [{ id: 1, rank: 10 }], archived: [] };
  const w = await loadSortWiring(storage, boardState);
  w.loadColumnSort();
  w.toggleColumnSortDirection('todo');
  assert.deepStrictEqual(JSON.parse(storage[KEY]), { picked: { todo: { field: 'outline', direction: 'desc' } } });
});

test('a sort saved before picks were tracked keeps its real picks and drops the frozen defaults', async () => {
  const storage = { [KEY]: JSON.stringify({ todo: PRIORITY, doing: { field: 'due', direction: 'asc' }, archive: { field: 'id', direction: 'asc' } }) };
  const boardState = { projectName: 'demo', active: [{ id: 1 }, { id: 2, parent: 1 }], archived: [] };
  const w = await loadSortWiring(storage, boardState);
  assert.deepStrictEqual(plain(w.loadColumnSort()), { todo: OUTLINE, doing: { field: 'due', direction: 'asc' }, archive: { field: 'id', direction: 'asc' } });
});

test('a changed board or status list re-reads the picks: app.js resets the memo for both', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    for (const fn of ['applyStatuses', 'applyProjectName']) {
      const body = js.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`))[0];
      assert.match(body, /columnSort = null/);
      assert.match(body, /columnSortPicks = null/, `${fn} also drops the remembered picks`);
    }
  });
});
