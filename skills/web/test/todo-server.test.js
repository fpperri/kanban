const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');

// The todo lists through the server's HTTP API on a temporary board (docs/adr/0021): the board payload
// names the folder, the targets that have a list and their counts; GET reads a list; POST adds, PATCH
// ticks or edits, DELETE removes and POST .../move reorders an item, each naming the version it read;
// and the delete flow takes a card's or a group's list only when asked.

const CONFIG = ['name: t', 'nextId: 30', 'groups: .groups', 'scratchpad: .both', 'todos: .both', 'prefixes:', '  I: .groups/iteration', ''].join('\n');
const card = (id, title) => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# ${title}\n`;

function tmpBoard({ config = CONFIG, files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-todos-srv-'));
  for (const [id, title] of [[3, 'Three'], [7, 'Seven']]) fs.writeFileSync(path.join(dir, `${String(id).padStart(4, '0')}.${title.toLowerCase()}.card.md`), card(id, title));
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

async function req(base, method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* an unmatched route answers plain text */ }
  return { status: res.status, json };
}

const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const I1 = '---\nid: I1\nname: zephyr-1\ncards: [3, 7]\n---\n';
const texts = (r) => r.json.todos.lines.map((l) => (l.item ? `${l.done ? 'x' : 'o'}${l.depth} ${l.text}` : `= ${l.text}`));

test('the board payload names the folder, the targets that have a list and the open and total of each; none without the line', async () => {
  const dir = tmpBoard({ files: { '.both/0007.todo.md': '- [ ] a\n- [x] b\n', '.both/I0001.todo.md': 'just text\n', '.both/0007.scratchpad.md': '- [ ] not a todo\n' } });
  await withServer(dir, async (base) => {
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.todos, { folder: '.both', targets: ['7', 'I1'], counts: { 7: { open: 1, total: 2 } } });
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.scratchpad.targets, ['7'], 'the scratchpad lists only its own kind');
  });
  await withServer(tmpBoard({ config: 'name: t\n' }), async (base) => {
    assert.strictEqual((await req(base, 'GET', '/api/board')).json.todos, null);
  });
});

test('the counts follow a hand edit at the next board read: worked out each time, never written', async () => {
  const dir = tmpBoard({ files: { '.both/0007.todo.md': '- [ ] a\n' } });
  await withServer(dir, async (base) => {
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.todos.counts, { 7: { open: 1, total: 1 } });
    fs.writeFileSync(path.join(dir, '.both/0007.todo.md'), '- [x] a\n- [ ] b\n- [ ] c\n');
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.todos.counts, { 7: { open: 2, total: 3 } });
  });
});

test('GET reads a list, an empty one for a target that has none, and writes nothing', async () => {
  const dir = tmpBoard({ files: { '.both/0007.todo.md': '# plan\n- [ ] a\n  - [x] a1\n' } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'GET', '/api/todos/7');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(texts(r), ['= # plan', 'o0 a', 'x1 a1']);
    assert.strictEqual(r.json.todos.file, '0007.todo.md');
    assert.match(r.json.todos.version, /^[0-9a-f]{16}$/);
    const none = await req(base, 'GET', '/api/todos/3');
    assert.deepStrictEqual([none.status, none.json.todos.exists, none.json.todos.lines], [200, false, []]);
    assert.ok(!exists(dir, '.both/0003.todo.md'));
  });
});

test('POST adds an item, at the end or under an item, for a card and for a group; the next board lists the list', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/0001.zephyr-1.md': I1 } });
  await withServer(dir, async (base) => {
    let v = (await req(base, 'GET', '/api/todos/7')).json.todos.version;
    const made = await req(base, 'POST', '/api/todos/7', { text: 'first', version: v });
    assert.strictEqual(made.status, 201);
    assert.deepStrictEqual(texts(made), ['o0 first']);
    const child = await req(base, 'POST', '/api/todos/7', { text: 'child', parent: 0, version: made.json.todos.version });
    assert.deepStrictEqual(texts(child), ['o0 first', 'o1 child']);
    assert.strictEqual(read(dir, '.both/0007.todo.md'), '- [ ] first\n  - [ ] child\n');
    v = (await req(base, 'GET', '/api/todos/I1')).json.todos.version;
    assert.strictEqual((await req(base, 'POST', '/api/todos/I1', { text: 'g', version: v })).status, 201);
    assert.ok(exists(dir, '.both/I0001.todo.md'));
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.todos.targets, ['7', 'I1']);
  });
});

test('PATCH ticks and edits, DELETE removes an item with its children, POST .../move reorders', async () => {
  const dir = tmpBoard({ files: { '.both/0007.todo.md': '- [ ] a\n  - [ ] a1\n- [ ] b\n- [ ] c\n' } });
  const version = async (base) => (await req(base, 'GET', '/api/todos/7')).json.todos.version;
  await withServer(dir, async (base) => {
    let r = await req(base, 'PATCH', '/api/todos/7', { index: 2, done: true, version: await version(base) });
    assert.deepStrictEqual([r.status, texts(r)], [200, ['o0 a', 'o1 a1', 'x0 b', 'o0 c']]);
    r = await req(base, 'PATCH', '/api/todos/7', { index: 3, text: 'see #7', version: await version(base) });
    assert.strictEqual(read(dir, '.both/0007.todo.md'), '- [ ] a\n  - [ ] a1\n- [x] b\n- [ ] see #7\n');
    r = await req(base, 'POST', '/api/todos/7/move', { index: 3, by: -1, version: await version(base) });
    assert.deepStrictEqual([r.status, texts(r)], [200, ['o0 a', 'o1 a1', 'o0 see #7', 'x0 b']]);
    r = await req(base, 'DELETE', '/api/todos/7', { index: 0, version: await version(base) });
    assert.deepStrictEqual([r.status, texts(r)], [200, ['o0 see #7', 'x0 b']]);
  });
});

test('POST .../indent and .../outdent change an item\'s level, naming the version, and answer where it went', async () => {
  const dir = tmpBoard({ files: { '.both/0007.todo.md': '- [ ] a\n- [ ] b\n  - [ ] b1\n' } });
  const version = async (base) => (await req(base, 'GET', '/api/todos/7')).json.todos.version;
  await withServer(dir, async (base) => {
    let r = await req(base, 'POST', '/api/todos/7/indent', { index: 1, version: await version(base) });
    assert.deepStrictEqual([r.status, texts(r), r.json.todos.at], [200, ['o0 a', 'o1 b', 'o2 b1'], 1]);
    assert.strictEqual(read(dir, '.both/0007.todo.md'), '- [ ] a\n  - [ ] b\n    - [ ] b1\n');
    r = await req(base, 'POST', '/api/todos/7/outdent', { index: 1, version: await version(base) });
    assert.deepStrictEqual([r.status, texts(r)], [200, ['o0 a', 'o0 b', 'o1 b1']]);
    const stale = await version(base);
    fs.writeFileSync(path.join(dir, '.both/0007.todo.md'), '- [ ] a\n- [ ] b\n  - [ ] b1\n- [ ] by hand\n');
    for (const op of ['indent', 'outdent']) {
      assert.strictEqual((await req(base, 'POST', `/api/todos/7/${op}`, { index: 1, version: stale })).status, 409, op);
      assert.strictEqual((await req(base, 'POST', `/api/todos/7/${op}`, { index: 1 })).status, 400, op);
      assert.strictEqual((await req(base, 'GET', `/api/todos/7/${op}`)).status, 404, op);
    }
  });
});

test('a write that names an old version answers 409 and writes nothing; a missing version answers 400', async () => {
  const dir = tmpBoard({ files: { '.both/0007.todo.md': '- [ ] a\n' } });
  await withServer(dir, async (base) => {
    const stale = (await req(base, 'GET', '/api/todos/7')).json.todos.version;
    fs.writeFileSync(path.join(dir, '.both/0007.todo.md'), '- [ ] a\n- [ ] by hand\n');
    for (const [method, url, body] of [
      ['POST', '/api/todos/7', { text: 'x' }], ['PATCH', '/api/todos/7', { index: 0, done: true }],
      ['DELETE', '/api/todos/7', { index: 0 }], ['POST', '/api/todos/7/move', { index: 0, by: 1 }],
    ]) {
      const old = await req(base, method, url, { ...body, version: stale });
      assert.strictEqual(old.status, 409, `${method} ${url}`);
      assert.match(old.json.error, /changed on disk/);
      assert.strictEqual((await req(base, method, url, body)).status, 400, `${method} ${url} without a version`);
    }
    assert.strictEqual(read(dir, '.both/0007.todo.md'), '- [ ] a\n- [ ] by hand\n');
  });
});

test('a request that is wrong answers its status and writes nothing', async () => {
  await withServer(tmpBoard({ config: 'name: t\n' }), async (base) => {
    assert.strictEqual((await req(base, 'GET', '/api/todos/7')).status, 404);
    assert.strictEqual((await req(base, 'POST', '/api/todos/7', { text: 'x', version: '' })).status, 404);
  });
  const dir = tmpBoard({ files: { '.both/0007.todo.md': '- [ ] a\n' } });
  await withServer(dir, async (base) => {
    const v = (await req(base, 'GET', '/api/todos/7')).json.todos.version;
    assert.strictEqual((await req(base, 'GET', '/api/todos/abc')).status, 404, 'a path that is no id is no route');
    assert.strictEqual((await req(base, 'POST', '/api/todos/7', { text: '', version: v })).status, 400);
    assert.strictEqual((await req(base, 'POST', '/api/todos/7', { text: 'a\nb', version: v })).status, 400);
    assert.strictEqual((await req(base, 'PATCH', '/api/todos/7', { index: 4, done: true, version: v })).status, 404);
    assert.strictEqual((await req(base, 'POST', '/api/todos/7/move', { index: 0, by: 3, version: v })).status, 400);
    assert.strictEqual((await req(base, 'PUT', '/api/todos/7', { version: v })).status, 404, 'the list has no whole-file write: a hand edit is the whole-file write');
  });
  assert.strictEqual(read(dir, '.both/0007.todo.md'), '- [ ] a\n');
});

test('request text never builds a path: an id with dots or slashes is no route and nothing is written outside the folder', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    for (const bad of ['..%2F..%2Fx', '7.todo.md', '..']) {
      const r = await req(base, 'POST', `/api/todos/${bad}`, { text: 'x', version: '' });
      assert.ok([400, 404].includes(r.status), bad);
    }
  });
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => !/card\.md$|config\.yaml/.test(f)), []);
});

test('deleting a card keeps its todo list unless asked, and the unasked delete says nothing of it', async () => {
  const dir = tmpBoard({ files: { '.both/0007.todo.md': '- [ ] keep\n', '.both/0007.scratchpad.md': 'pad', '.both/0003.todo.md': '- [ ] other\n' } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/cards/7');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.swept, {});
  });
  assert.ok(exists(dir, '.both/0007.todo.md'));
});

test('deleting a card with todos: true takes its list and no other, nor its scratchpad', async () => {
  const dir = tmpBoard({ files: { '.both/0007.todo.md': '- [ ] gone\n', '.both/0007.scratchpad.md': 'pad', '.both/0003.todo.md': '- [ ] other\n' } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/cards/7', { todos: true });
    assert.deepStrictEqual(r.json.swept, { todos: 1 });
  });
  assert.ok(!exists(dir, '.both/0007.todo.md'));
  assert.ok(exists(dir, '.both/0007.scratchpad.md'));
  assert.ok(exists(dir, '.both/0003.todo.md'));
});

test('deleting a group takes its list only when ticked, and the member cards\' lists with memberTodos', async () => {
  const files = { '.groups/iteration/0001.zephyr-1.md': I1, '.both/I0001.todo.md': '- [ ] g\n', '.both/0007.todo.md': '- [ ] member\n' };
  const kept = tmpBoard({ files });
  await withServer(kept, async (base) => {
    assert.deepStrictEqual((await req(base, 'DELETE', '/api/groups/I1', {})).json.swept, {});
  });
  assert.ok(exists(kept, '.both/I0001.todo.md'));
  const taken = tmpBoard({ files });
  await withServer(taken, async (base) => {
    const r = await req(base, 'DELETE', '/api/groups/I1', { todos: true, members: true, memberTodos: true });
    assert.deepStrictEqual(r.json.swept, { todos: 1 });
    assert.deepStrictEqual(r.json.membersSwept, { todos: 1 });
  });
  assert.ok(!exists(taken, '.both/I0001.todo.md'));
  assert.ok(!exists(taken, '.both/0007.todo.md'));
});
