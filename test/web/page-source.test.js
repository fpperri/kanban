const { test } = require('node:test');
const assert = require('node:assert');
const { makeMemoryRoute } = require('../../plugin/skills/web/scripts/memory-route');
const { makePageSource, makeTrayStore, boot } = require('../../plugin/skills/web/scripts/page-source');
const bufferShim = require('../../plugin/skills/web/scripts/buffer-shim');
const { routeSources } = require('./helpers/route-sources');

// The board source of a page that carries its board: it answers the page's api calls through route over
// the board held in memory, and records every save that worked as a queued change in browser storage.

const SOURCES = routeSources();
const card = (id, title, extra = '') => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: [${extra}]\ntags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;
const FILES = {
  '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\ntodos: .todos\n',
  '/p/.kanban/0003.three.card.md': card(3, 'Three'),
  '/p/.kanban/0007.seven.card.md': card(7, 'Seven', '3'),
  '/p/.kanban/.todos/0007.todo.md': '- [ ] a\n- [x] b\n',
  '/p/.kanban/notifications.md': '- id: 1\n  at: 2026-07-08T23:40:00\n  from: "x"\n  message: "hi"\n  read: false\n',
};
const BOARD = { name: 'alpha', id: 'abc123', base: '2026-10-31T01:00:00.000Z' };

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, map };
}

function open(storage, { board = BOARD, device = 'dev', files = FILES } = {}) {
  const { route } = makeMemoryRoute(SOURCES, { files, dir: '/p/.kanban' });
  return makePageSource({ route, tray: makeTrayStore(storage, `kanban-tray:${board.id}`, device), board });
}

const ids = (board) => board.active.map((c) => `${c.id}:${c.status}`).sort();

test('the board load is the embedded board, with its source named and no build-machine path', async () => {
  const src = open(memoryStorage());
  const res = await src.request('GET', '/api/board');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.json.source, { kind: 'page', queued: 0, pictures: false, base: BOARD.base });
  assert.strictEqual(res.json.projectName, 'alpha');
  assert.strictEqual(res.json.boardDir, '');
  assert.deepStrictEqual(ids(res.json), ['3:todo', '7:todo']);
});

test('a save that works shows at once and is queued as the server save it was', async () => {
  const src = open(memoryStorage());
  const res = await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  assert.strictEqual(res.status, 200);
  const board = (await src.request('GET', '/api/board')).json;
  assert.deepStrictEqual(ids(board), ['3:doing', '7:todo']);
  assert.deepStrictEqual(board.source, { kind: 'page', queued: 1, pictures: false, base: BOARD.base });
  const [rec] = src.records();
  assert.deepStrictEqual(rec.change, { method: 'PATCH', path: '/api/cards/3', body: { status: 'doing' } });
  assert.strictEqual(rec.id, 'dev-1');
  assert.strictEqual(rec.device, 'dev');
  assert.match(rec.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('a save the board refuses is refused as the desk refuses it, and queues nothing', async () => {
  const src = open(memoryStorage());
  const { route } = makeMemoryRoute(SOURCES, { files: FILES, dir: '/p/.kanban' });
  const desk = route('PATCH', '/api/cards/7', { status: 'doing' });
  assert.strictEqual(desk.status, 422);
  const res = await src.request('PATCH', '/api/cards/7', { status: 'doing' });
  assert.strictEqual(res.status, 422);
  assert.deepStrictEqual(res.json, desk.body);
  assert.deepStrictEqual(src.records(), []);
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.queued, 0);
});

test('a reload shows the queued changes applied, and the next change takes the next number', async () => {
  const storage = memoryStorage();
  const first = open(storage);
  await first.request('PATCH', '/api/cards/3', { status: 'doing' });
  const again = open(storage);
  const board = (await again.request('GET', '/api/board')).json;
  assert.deepStrictEqual(ids(board), ['3:doing', '7:todo']);
  assert.strictEqual(board.source.queued, 1);
  await again.request('PATCH', '/api/cards/3', { status: 'done' });
  assert.deepStrictEqual(again.records().map((r) => r.id), ['dev-1', 'dev-2']);
  assert.deepStrictEqual(ids((await open(storage).request('GET', '/api/board')).json), ['3:done', '7:todo']);
});

test('two boards in one browser keep their own queued changes', async () => {
  const storage = memoryStorage();
  await open(storage, { board: { ...BOARD, id: 'one' } }).request('PATCH', '/api/cards/3', { status: 'doing' });
  const other = open(storage, { board: { ...BOARD, id: 'two' } });
  assert.strictEqual((await other.request('GET', '/api/board')).json.source.queued, 0);
  assert.deepStrictEqual(ids((await other.request('GET', '/api/board')).json), ['3:todo', '7:todo']);
});

test('two tabs of one board both keep what they queued', async () => {
  const storage = memoryStorage();
  const a = open(storage, { device: 'a' });
  const b = open(storage, { device: 'b' });
  await a.request('PATCH', '/api/cards/3', { status: 'doing' });
  await b.request('PATCH', '/api/cards/7', { priority: 'High' });
  assert.deepStrictEqual(open(storage).records().map((r) => r.change.path), ['/api/cards/3', '/api/cards/7']);
});

test('with no usable storage the page still saves and shows, and keeps the queue for as long as it is open', async () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const src = open(broken);
  assert.strictEqual((await src.request('PATCH', '/api/cards/3', { status: 'doing' })).status, 200);
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.queued, 1);
});

test('settings and notifications are a desk job: refused, and not queued', async () => {
  const src = open(memoryStorage());
  for (const [method, path, body] of [['POST', '/api/config', { key: 'name', value: 'x' }], ['POST', '/api/notifications/mark-read', {}], ['DELETE', '/api/notifications/1', {}]]) {
    const res = await src.request(method, path, body);
    assert.strictEqual(res.status, 403, path);
    assert.match(res.json.error, /desk job/);
  }
  assert.deepStrictEqual(src.records(), []);
});

test('the board load says the page holds no pictures: a binary file of the board is not in the page', async () => {
  assert.strictEqual((await open(memoryStorage()).request('GET', '/api/board')).json.source.pictures, false);
});

test('a path that is no route answers 404', async () => {
  const res = await open(memoryStorage()).request('GET', '/api/nothing-here');
  assert.strictEqual(res.status, 404);
});

test('the change payload names the board, the Base and the count, then holds the records as JSON', async () => {
  const src = open(memoryStorage());
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  await src.request('POST', '/api/todos/7', { text: 'c', version: (await src.request('GET', '/api/todos/7')).json.todos.version });
  const [head, ...rest] = src.payload().split('\n');
  assert.strictEqual(head, 'Apply kanban changes (board "alpha", base 2026-10-31T01:00:00.000Z, 2 changes):');
  const records = JSON.parse(rest.join('\n'));
  assert.deepStrictEqual(records.map((r) => r.change.method), ['PATCH', 'PUT']);
  assert.ok(records.every((r) => r.change.path && 'body' in r.change));
});

test('one change reads "1 change" in the payload header', async () => {
  const src = open(memoryStorage());
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  assert.match(src.payload().split('\n')[0], /, 1 change\):$/);
});

test('the Buffer shim gives the page the same board load as Node does, todo counts included', async () => {
  const withShim = makeMemoryRoute(SOURCES, { files: FILES, dir: '/p/.kanban', Buffer: bufferShim }).route('GET', '/api/board').body;
  const withNode = makeMemoryRoute(SOURCES, { files: FILES, dir: '/p/.kanban' }).route('GET', '/api/board').body;
  assert.deepStrictEqual(withShim.todos.counts, { 7: { open: 1, total: 2 } });
  assert.deepStrictEqual(withShim, withNode);
});

test('boot makes a page source from the data a built page embeds, over the browser storage it is given', async () => {
  const storage = memoryStorage();
  const data = { board: BOARD, sources: SOURCES, files: FILES, dir: '/p/.kanban' };
  const src = boot(data, { storage, device: 'phone' });
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  assert.ok([...storage.map.keys()].includes(`kanban-tray:${BOARD.id}:${BOARD.base}`));
  assert.strictEqual(boot(data, { storage, device: 'phone' }).records().length, 1);
});

test('the board load names the Snapshot query the page was built with, when the board carries one', async () => {
  const snapshot = { query: 'tags:ui', archive: false, label: 'tags:ui · live cards only' };
  assert.deepStrictEqual((await open(memoryStorage(), { board: { ...BOARD, snapshot } }).request('GET', '/api/board')).json.snapshot, snapshot);
  assert.strictEqual('snapshot' in (await open(memoryStorage()).request('GET', '/api/board')).json, false);
});

test('the settings of the board load show locked with the reason "a desk job", and nothing else about them changes', async () => {
  const files = { ...FILES, '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\ntodos: .todos\nlogbook: logbook\n' };
  const { route } = makeMemoryRoute(SOURCES, { files, dir: '/p/.kanban' });
  const desk = route('GET', '/api/board').body.settings;
  const page = (await open(memoryStorage(), { files }).request('GET', '/api/board')).json.settings;
  assert.strictEqual(page.lock, 'a desk job');
  for (const key of ['logbook', 'scratchpad', 'todos', 'groups']) {
    assert.strictEqual(page[key].locked, true, key);
    assert.strictEqual(page[key].reason, 'a desk job', key);
    assert.strictEqual(page[key].on, desk[key].on, key);
    assert.strictEqual(page[key].folder, desk[key].folder, key);
  }
  assert.deepStrictEqual({ ...page, lock: undefined, logbook: 0, scratchpad: 0, todos: 0, groups: 0 }, { ...desk, lock: undefined, logbook: 0, scratchpad: 0, todos: 0, groups: 0 });
  assert.strictEqual(desk.logbook.locked, false);
});

test('marking a notification read is refused and queues nothing, and the notification stays unread', async () => {
  const src = open(memoryStorage());
  const res = await src.request('POST', '/api/notifications/mark-read', {});
  assert.strictEqual(res.status, 403);
  assert.deepStrictEqual(src.records(), []);
  assert.strictEqual((await src.request('GET', '/api/board')).json.notifications[0].read, false);
});

const todos = (src, target) => src.request('GET', `/api/todos/${target}`).then((r) => r.json.todos);

test('three edits to one todo list leave one queued change, the whole list carrying the version read at build time', async () => {
  const src = open(memoryStorage());
  const built = await todos(src, 7);
  assert.strictEqual((await src.request('POST', '/api/todos/7', { text: 'c', version: built.version })).status, 201);
  assert.strictEqual((await src.request('PATCH', '/api/todos/7', { index: 0, done: true, version: (await todos(src, 7)).version })).status, 200);
  assert.strictEqual((await src.request('POST', '/api/todos/7/move', { index: 2, by: -1, version: (await todos(src, 7)).version })).status, 200);
  const shown = await todos(src, 7);
  assert.strictEqual(shown.text, '- [x] a\n- [ ] c\n- [x] b\n');
  assert.strictEqual(src.records().length, 1);
  assert.deepStrictEqual(src.records()[0].change, { method: 'PUT', path: '/api/todos/7', body: { text: shown.text, version: built.version } });
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.queued, 1);
});

test('the list\'s queued change keeps its place and its id as the list changes again', async () => {
  const src = open(memoryStorage());
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  const built = await todos(src, 7);
  await src.request('POST', '/api/todos/7', { text: 'c', version: built.version });
  await src.request('PATCH', '/api/cards/3', { priority: 'High' });
  const first = src.records().map((r) => r.id);
  await src.request('DELETE', '/api/todos/7', { index: 0, version: (await todos(src, 7)).version });
  const after = src.records();
  assert.deepStrictEqual(after.map((r) => r.id), first);
  assert.deepStrictEqual(after.map((r) => r.change.path), ['/api/cards/3', '/api/todos/7', '/api/cards/3']);
  assert.strictEqual(after[1].change.body.version, built.version);
  assert.strictEqual(after[1].change.body.text, '- [x] b\n- [ ] c\n');
});

test('every kind of edit to a list folds: add, edit text, indent, outdent, delete, and the Edit tab\'s whole text', async () => {
  const src = open(memoryStorage());
  const built = await todos(src, 7);
  const v = async () => (await todos(src, 7)).version;
  await src.request('POST', '/api/todos/7', { text: 'c', version: await v() });
  await src.request('PATCH', '/api/todos/7', { index: 0, text: 'a2', version: await v() });
  await src.request('POST', '/api/todos/7/indent', { index: 1, version: await v() });
  await src.request('POST', '/api/todos/7/outdent', { index: 1, version: await v() });
  await src.request('DELETE', '/api/todos/7', { index: 2, version: await v() });
  assert.strictEqual(src.records().length, 1);
  await src.request('PUT', '/api/todos/7', { text: '- [ ] whole\n', version: await v() });
  assert.strictEqual(src.records().length, 1);
  assert.deepStrictEqual(src.records()[0].change.body, { text: '- [ ] whole\n', version: built.version });
});

test('two lists each keep their own queued change', async () => {
  const src = open(memoryStorage());
  const seven = await todos(src, 7);
  const three = await todos(src, 3);
  assert.strictEqual(three.exists, false);
  await src.request('POST', '/api/todos/7', { text: 'c', version: seven.version });
  await src.request('POST', '/api/todos/3', { text: 'first', version: three.version });
  await src.request('POST', '/api/todos/7', { text: 'd', version: (await todos(src, 7)).version });
  assert.deepStrictEqual(src.records().map((r) => [r.change.path, r.change.body.version]), [['/api/todos/7', seven.version], ['/api/todos/3', three.version]]);
  assert.strictEqual(src.records()[1].change.body.text, '- [ ] first\n');
});

test('a reload shows the list as the page showed it, and the next edit still folds into the one change', async () => {
  const storage = memoryStorage();
  const first = open(storage);
  const built = await todos(first, 7);
  await first.request('POST', '/api/todos/7', { text: 'c', version: built.version });
  const shown = await todos(first, 7);
  const again = open(storage);
  assert.strictEqual((await todos(again, 7)).text, shown.text);
  await again.request('PATCH', '/api/todos/7', { index: 2, done: true, version: (await todos(again, 7)).version });
  assert.strictEqual(again.records().length, 1);
  assert.strictEqual(again.records()[0].change.body.version, built.version);
  assert.strictEqual(open(storage).records()[0].change.body.text, '- [ ] a\n- [x] b\n- [x] c\n');
});

test('a todo save the list refuses is refused as the desk refuses it, and leaves the queued change as it was', async () => {
  const src = open(memoryStorage());
  const built = await todos(src, 7);
  await src.request('POST', '/api/todos/7', { text: 'c', version: built.version });
  const before = JSON.stringify(src.records());
  const res = await src.request('POST', '/api/todos/7', { text: 'd', version: built.version });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(JSON.stringify(src.records()), before);
});

test('the fingerprint of the tray is empty with nothing queued and changes with every edit, including one folded into a record already there', async () => {
  const src = open(memoryStorage());
  assert.strictEqual(src.fingerprint(), '');
  const built = await todos(src, 7);
  await src.request('POST', '/api/todos/7', { text: 'c', version: built.version });
  const afterFirst = src.fingerprint();
  assert.notStrictEqual(afterFirst, '');
  assert.strictEqual(afterFirst, src.fingerprint());
  await src.request('POST', '/api/todos/7', { text: 'd', version: (await todos(src, 7)).version });
  assert.strictEqual(src.records().length, 1);
  assert.notStrictEqual(src.fingerprint(), afterFirst);
});

test('a copy of one todo list edit, then another edit to the same list, leaves the guard asking', async () => {
  const { makeSaveGuard } = require('../../plugin/skills/web/web/save-guard');
  const src = open(memoryStorage());
  const guard = makeSaveGuard();
  await src.request('POST', '/api/todos/7', { text: 'c', version: (await todos(src, 7)).version });
  const source = (await src.request('GET', '/api/board')).json.source;
  assert.strictEqual(guard.leaving(source, src.fingerprint()), 'unsent');
  guard.sent(src.fingerprint());
  assert.strictEqual(guard.leaving(source, src.fingerprint()), null);
  await src.request('POST', '/api/todos/7', { text: 'd', version: (await todos(src, 7)).version });
  const after = (await src.request('GET', '/api/board')).json.source;
  assert.strictEqual(after.queued, 1);
  assert.strictEqual(guard.leaving(after, src.fingerprint()), 'unsent');
});
