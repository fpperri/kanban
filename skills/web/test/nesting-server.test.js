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
