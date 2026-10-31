const { test } = require('node:test');
const assert = require('node:assert');
const { boot } = require('../../plugin/skills/web/scripts/page-source');
const { routeSources } = require('./helpers/route-sources');
const { makeFakeDb, claudeWith } = require('./helpers/fake-db');

// A Board artifact keeps its tray in the artifact's database: one document per queued change in the
// collection `tray`, written the moment the change is made. These tests drive the page source that boot
// makes over a stand-in `claude.use("db")`, and read what the stand-in holds.

const card = (id, title, extra = '') => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: [${extra}]\ntags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;
const FILES = {
  '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\n',
  '/p/.kanban/0003.three.card.md': card(3, 'Three'),
  '/p/.kanban/0007.seven.card.md': card(7, 'Seven', '3'),
};
const DATA = { board: { name: 'alpha', id: 'abc123', base: '2026-10-31T01:00:00.000Z' }, sources: routeSources(), files: FILES, dir: '/p/.kanban' };

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, map };
}

const states = (board) => board.active.map((c) => `${c.id}:${c.status}`).sort();
const settle = () => new Promise((r) => setTimeout(r, 0));

test('a move writes one document in the collection tray holding the server save, and the count reads 1 queued from the artifact', async () => {
  const fake = makeFakeDb();
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.queued, 0);
  assert.strictEqual((await src.request('PATCH', '/api/cards/3', { status: 'doing' })).status, 200);
  assert.deepStrictEqual([...fake.docs.keys()], ['phone-1']);
  const doc = fake.docs.get('phone-1');
  assert.deepStrictEqual(doc.change, { method: 'PATCH', path: '/api/cards/3', body: { status: 'doing' } });
  assert.strictEqual(doc.id, 'phone-1');
  assert.strictEqual(doc.device, 'phone');
  assert.match(doc.at, /^\d{4}-\d{2}-\d{2}T/);
  const load = (await src.request('GET', '/api/board')).json;
  assert.deepStrictEqual(load.source, { kind: 'artifact', queued: 1, base: DATA.board.base });
  assert.deepStrictEqual(states(load), ['3:doing', '7:todo']);
});

test('a reload reads the tray back from the database and shows the board with it applied', async () => {
  const fake = makeFakeDb();
  const storage = memoryStorage();
  await boot(DATA, { storage, device: 'phone', claude: claudeWith(fake.db) }).request('PATCH', '/api/cards/3', { status: 'doing' });
  const again = boot(DATA, { storage, device: 'phone', claude: claudeWith(fake.db) });
  const load = (await again.request('GET', '/api/board')).json;
  assert.deepStrictEqual(states(load), ['3:doing', '7:todo']);
  assert.deepStrictEqual(load.source, { kind: 'artifact', queued: 1, base: DATA.board.base });
  assert.strictEqual(fake.docs.size, 1);
});

test('a database that resolves null falls back to browser storage, the file\'s behaviour, and writes nothing to a database', async () => {
  const storage = memoryStorage();
  const src = boot(DATA, { storage, device: 'phone', claude: { use: async () => null } });
  assert.strictEqual((await src.request('PATCH', '/api/cards/3', { status: 'doing' })).status, 200);
  const load = (await src.request('GET', '/api/board')).json;
  assert.deepStrictEqual(load.source, { kind: 'page', queued: 1, base: DATA.board.base });
  assert.ok([...storage.map.keys()].includes(`kanban-tray:${DATA.board.id}:${DATA.board.base}`));
  const again = boot(DATA, { storage, device: 'phone', claude: { use: async () => null } });
  assert.strictEqual((await again.request('GET', '/api/board')).json.source.queued, 1);
});

test('a page with no window.claude at all uses browser storage', async () => {
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: undefined });
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.kind, 'page');
});

test('a viewer who is not the owner cannot reach the owner-only tray, so the page keeps its queue in browser storage', async () => {
  const fake = makeFakeDb();
  const src = boot(DATA, { storage: memoryStorage(), device: 'guest', claude: claudeWith(fake.db, { owner: false }) });
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.kind, 'page');
  assert.strictEqual(fake.docs.size, 0);
});

test('the owner, told by the user capability, uses the database', async () => {
  const fake = makeFakeDb();
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db, { owner: true }) });
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  assert.strictEqual(fake.docs.size, 1);
});

test('a database that cannot be read, or that does not answer in time, falls back to browser storage', async () => {
  for (const how of [new Error('boom'), 'hang']) {
    const fake = makeFakeDb();
    fake.fail.get = how;
    const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db), timeoutMs: 20 });
    const load = (await src.request('GET', '/api/board')).json;
    assert.strictEqual(load.source.kind, 'page');
  }
});

test('a change made on another device shows in the tray and on the board without a reload, and the page is told', async () => {
  const fake = makeFakeDb();
  const desktop = boot(DATA, { storage: memoryStorage(), device: 'desk', claude: claudeWith(fake.db) });
  assert.strictEqual((await desktop.request('GET', '/api/board')).json.source.queued, 0);
  let told = 0;
  desktop.onChange(() => { told += 1; });
  const phone = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  await phone.request('PATCH', '/api/cards/3', { status: 'doing' });
  await settle();
  const load = (await desktop.request('GET', '/api/board')).json;
  assert.deepStrictEqual(load.source, { kind: 'artifact', queued: 1, base: DATA.board.base });
  assert.deepStrictEqual(states(load), ['3:doing', '7:todo']);
  assert.ok(told >= 1);
});

test('the page\'s own write does not tell the page or apply twice', async () => {
  const fake = makeFakeDb();
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  await src.request('GET', '/api/board');
  let told = 0;
  src.onChange(() => { told += 1; });
  await src.request('POST', '/api/cards', { title: 'New one' });
  await settle();
  const load = (await src.request('GET', '/api/board')).json;
  assert.strictEqual(load.active.filter((c) => c.title === 'New one').length, 1);
  assert.strictEqual(load.source.queued, 1);
  assert.strictEqual(told, 0);
});

test('when Claude deletes the applied documents the count falls to 0', async () => {
  const fake = makeFakeDb();
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  fake.change((docs) => docs.clear());
  await settle();
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.queued, 0);
});

test('a change number is never used twice by a device, even after the applied documents are deleted', async () => {
  const fake = makeFakeDb();
  const storage = memoryStorage();
  const a = boot(DATA, { storage, device: 'phone', claude: claudeWith(fake.db) });
  await a.request('PATCH', '/api/cards/3', { status: 'doing' });
  fake.change((docs) => docs.clear());
  const b = boot(DATA, { storage, device: 'phone', claude: claudeWith(fake.db) });
  await b.request('PATCH', '/api/cards/3', { status: 'done' });
  assert.deepStrictEqual([...fake.docs.keys()], ['phone-2']);
});

test('a number already in the database for the device is skipped too, when browser storage was cleared', async () => {
  const fake = makeFakeDb();
  await boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) }).request('PATCH', '/api/cards/3', { status: 'doing' });
  await boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) }).request('PATCH', '/api/cards/7', { priority: 'High' });
  assert.deepStrictEqual([...fake.docs.keys()].sort(), ['phone-1', 'phone-2']);
});

test('the records come back in time order whichever device wrote them, and the payload lists them so', async () => {
  const at = (n) => `2026-10-31T02:00:0${n}.000Z`;
  const rec = (id, n, path, body) => ({ id, at: at(n), device: id.split('-')[0], change: { method: 'PATCH', path, body } });
  const fake = makeFakeDb({
    'b-1': rec('b-1', 2, '/api/cards/7', { priority: 'High' }),
    'a-1': rec('a-1', 1, '/api/cards/3', { status: 'doing' }),
  });
  const src = boot(DATA, { storage: memoryStorage(), device: 'c', claude: claudeWith(fake.db) });
  await src.request('GET', '/api/board');
  assert.deepStrictEqual(src.records().map((r) => r.id), ['a-1', 'b-1']);
  const [head, ...rest] = src.payload().split('\n');
  assert.strictEqual(head, 'Apply kanban changes (board "alpha", base 2026-10-31T01:00:00.000Z, 2 changes):');
  assert.deepStrictEqual(JSON.parse(rest.join('\n')).map((r) => r.id), ['a-1', 'b-1']);
});

test('a refused record in the database rides into the page with its reason', async () => {
  const fake = makeFakeDb({ 'a-1': { id: 'a-1', at: '2026-10-31T02:00:00.000Z', device: 'a', change: { method: 'PATCH', path: '/api/cards/3', body: { status: 'doing' } }, refused: 'changed at the desk since' } });
  const src = boot(DATA, { storage: memoryStorage(), device: 'c', claude: claudeWith(fake.db) });
  await src.request('GET', '/api/board');
  assert.strictEqual(src.records()[0].refused, 'changed at the desk since');
});

test('a write the database refuses is answered as an error that says so, and the change stays in this page', async () => {
  const fake = makeFakeDb();
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  await src.request('GET', '/api/board');
  fake.fail.set = Object.assign(new Error('over the cap'), { code: 'quota_exceeded' });
  const res = await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  assert.strictEqual(res.status, 500);
  assert.match(res.json.error, /not queued in the artifact's database/);
  assert.match(res.json.error, /quota_exceeded/);
  const load = (await src.request('GET', '/api/board')).json;
  assert.deepStrictEqual(states(load), ['3:doing', '7:todo']);
  assert.strictEqual(load.source.queued, 1);
});

test('a save the board refuses queues nothing in the database', async () => {
  const fake = makeFakeDb();
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  assert.strictEqual((await src.request('PATCH', '/api/cards/7', { status: 'doing' })).status, 422);
  assert.strictEqual(fake.docs.size, 0);
});

test('settings and notifications are still a desk job and write nothing to the database', async () => {
  const fake = makeFakeDb();
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  assert.strictEqual((await src.request('POST', '/api/config', { key: 'name', value: 'x' })).status, 403);
  assert.strictEqual(fake.docs.size, 0);
});

test('edits to one todo list leave one document in the database, rewritten in place as the list changes', async () => {
  const fake = makeFakeDb();
  const data = { ...DATA, files: { ...FILES, '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\ntodos: .todos\n', '/p/.kanban/.todos/0007.todo.md': '- [ ] a\n- [x] b\n' } };
  const src = boot(data, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  const read = async () => (await src.request('GET', '/api/todos/7')).json.todos;
  const built = await read();
  assert.strictEqual((await src.request('POST', '/api/todos/7', { text: 'c', version: built.version })).status, 201);
  assert.strictEqual((await src.request('PATCH', '/api/todos/7', { index: 0, done: true, version: (await read()).version })).status, 200);
  const shown = await read();
  assert.deepStrictEqual([...fake.docs.keys()], ['phone-1']);
  assert.deepStrictEqual(fake.docs.get('phone-1').change, { method: 'PUT', path: '/api/todos/7', body: { text: shown.text, version: built.version } });
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.queued, 1);
});

const TODO_DATA = { ...DATA, files: { ...FILES, '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\ntodos: .todos\n', '/p/.kanban/.todos/0007.todo.md': '- [ ] a\n' } };
const listOf = async (src) => (await src.request('GET', '/api/todos/7')).json.todos;
const addTodo = async (src, text) => assert.strictEqual((await src.request('POST', '/api/todos/7', { text, version: (await listOf(src)).version })).status, 201);

test("a todo list edited on two devices keeps every edit: another device's rewrite of the list is replayed, and the next edit builds on it", async () => {
  const fake = makeFakeDb();
  const desk = boot(TODO_DATA, { storage: memoryStorage(), device: 'desk', claude: claudeWith(fake.db) });
  const phone = boot(TODO_DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  await desk.request('GET', '/api/board');
  await addTodo(phone, 'B');
  await settle();
  await addTodo(phone, 'C');
  await settle();
  assert.strictEqual((await listOf(desk)).text, (await listOf(phone)).text, "the desk shows the phone's second edit");
  await addTodo(desk, 'D');
  await settle();
  const texts = [...fake.docs.values()].map((d) => d.change.body.text);
  assert.strictEqual(texts.length, 1, 'one document for the list');
  for (const edit of ['B', 'C', 'D']) assert.ok(texts[0].includes(edit), `the document keeps ${edit}: ${JSON.stringify(texts[0])}`);
  assert.strictEqual((await listOf(phone)).text, texts[0], 'the phone shows all three too');
});

test('after the database raises an error on the listener the page subscribes again, and a document written meanwhile shows', async () => {
  const fake = makeFakeDb();
  const desk = boot(DATA, { storage: memoryStorage(), device: 'desk', claude: claudeWith(fake.db), retryMs: 1 });
  assert.strictEqual((await desk.request('GET', '/api/board')).json.source.queued, 0);
  let told = 0;
  desk.onChange(() => { told += 1; });
  fake.breakListeners(new Error('the listener died'));
  assert.strictEqual(fake.listeners.size, 0);
  fake.change((docs) => docs.set('phone-1', { id: 'phone-1', at: '2026-10-31T02:00:00.000Z', device: 'phone', change: { method: 'PATCH', path: '/api/cards/3', body: { status: 'doing' } } }));
  await new Promise((r) => setTimeout(r, 30));
  assert.strictEqual(fake.listeners.size, 1, 'the page listens again');
  const load = (await desk.request('GET', '/api/board')).json;
  assert.deepStrictEqual(states(load), ['3:doing', '7:todo']);
  assert.strictEqual(load.source.queued, 1);
  assert.ok(told >= 1);
  fake.change((docs) => docs.set('phone-2', { id: 'phone-2', at: '2026-10-31T02:01:00.000Z', device: 'phone', change: { method: 'PATCH', path: '/api/cards/3', body: { priority: 'High' } } }));
  await settle();
  const later = (await desk.request('GET', '/api/board')).json;
  assert.strictEqual(later.source.queued, 2);
  assert.strictEqual(later.active.find((c) => String(c.id) === '3').priority, 'High');
});

test('a listener that errors again is subscribed again, with a longer wait each time', async () => {
  const fake = makeFakeDb();
  const desk = boot(DATA, { storage: memoryStorage(), device: 'desk', claude: claudeWith(fake.db), retryMs: 1 });
  await desk.request('GET', '/api/board');
  for (let i = 0; i < 3; i += 1) {
    fake.breakListeners(new Error('again'));
    await new Promise((r) => setTimeout(r, 40));
    assert.strictEqual(fake.listeners.size, 1, `listening again after error ${i + 1}`);
  }
});

test('removing a card made in the page from the queue deletes its documents and the ones that name it, and the board shows without them', async () => {
  const fake = makeFakeDb();
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude: claudeWith(fake.db) });
  const made = (await src.request('POST', '/api/cards', { title: 'New one' })).json.id;
  assert.strictEqual(made, 'n1');
  await src.request('PATCH', '/api/cards/n1', { priority: 'High' });
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  const record = src.recordMaking('n1');
  assert.deepStrictEqual(src.remove(record), ['phone-1', 'phone-2']);
  await settle();
  assert.deepStrictEqual([...fake.docs.keys()], ['phone-3']);
  const load = (await src.request('GET', '/api/board')).json;
  assert.deepStrictEqual(states(load), ['3:doing', '7:todo']);
  assert.strictEqual(load.source.queued, 1);
});

test('a database whose use("db") or use("user") never settles falls back to browser storage, and the board load answers', async () => {
  for (const hangs of ['db', 'user']) {
    const fake = makeFakeDb();
    const real = claudeWith(fake.db);
    const claude = { use: (name) => (name === hangs ? new Promise(() => {}) : real.use(name)) };
    const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude, timeoutMs: 20 });
    const load = (await src.request('GET', '/api/board')).json;
    assert.strictEqual(load.source.kind, 'page', hangs);
  }
});

test('a user whose isOwner() never settles falls back to browser storage, and the board load answers', async () => {
  const fake = makeFakeDb();
  const real = claudeWith(fake.db);
  const claude = { use: (name) => (name === 'user' ? Promise.resolve({ isOwner: () => new Promise(() => {}) }) : real.use(name)) };
  const src = boot(DATA, { storage: memoryStorage(), device: 'phone', claude, timeoutMs: 20 });
  const load = (await src.request('GET', '/api/board')).json;
  assert.strictEqual(load.source.kind, 'page');
});
