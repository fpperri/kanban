const { test } = require('node:test');
const assert = require('node:assert');
const { makeMemoryRoute } = require('../../plugin/skills/web/scripts/memory-route');
const { makePageSource, makeTrayStore } = require('../../plugin/skills/web/scripts/page-source');
const { routeSources } = require('./helpers/route-sources');

// An edit queues only the fields it changed, each with the value the page had. The edit form sends the whole
// card, so the page source compares before it records.

const SOURCES = routeSources();
const card = (id, title, extra = '') => `---\nid: ${id}\nstatus: todo\npriority: Normal\n${extra}tags: [a, b]\n---\n\n# ${title}\n\nbody of ${id}\n`;
const FILES = {
  '/p/.kanban/0005.five.card.md': card(5, 'Five').replace('status: todo', 'status: backlog').replace('tags: [a, b]', 'tags: []'),
  '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\n',
  '/p/.kanban/0003.three.card.md': card(3, 'Three'),
  '/p/.kanban/0007.seven.card.md': card(7, 'Seven', 'assignee: "@alex"\nparent: 3\nrank: 5\n'),
};
const BOARD = { name: 'alpha', id: 'abc123', base: '2026-10-31T01:00:00.000Z' };

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); } };
}

function open(storage, { device = 'dev' } = {}) {
  const fresh = () => makeMemoryRoute(SOURCES, { files: FILES, dir: '/p/.kanban' }).route;
  return makePageSource({ route: fresh(), fresh, tray: makeTrayStore(storage, `kanban-tray:${BOARD.id}`, device), board: BOARD });
}

// What the edit form sends: every field of the card as the form shows it.
const form = (over = {}) => ({
  title: 'Three', status: 'todo', priority: 'Normal', parent: '', rank: '', tags: ['a', 'b'], waiting_for: [], blocked: '', review: '',
  prompt: '', assignee: '', start_date: '', end_date: '', due_date: '', body: 'body of 3\n', type: '', ...over,
});

test('an edit that changed only the title queues the title alone, with the value the page had', async () => {
  const src = open(memoryStorage());
  const res = await src.request('PATCH', '/api/cards/3', form({ title: 'Three, renamed' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.title, 'Three, renamed');
  const [rec] = src.records();
  assert.deepStrictEqual(rec.change, { method: 'PATCH', path: '/api/cards/3', body: { title: 'Three, renamed' } });
  assert.deepStrictEqual(rec.before, { title: 'Three' });
});

test('every field that differs is queued with its own before value, and the ones that read the same are not', async () => {
  const src = open(memoryStorage());
  await src.request('PATCH', '/api/cards/3', form({ priority: 'High', tags: ['a', 'c'], assignee: '@alex', due_date: '2026-11-02' }));
  const [rec] = src.records();
  assert.deepStrictEqual(rec.change.body, { priority: 'High', tags: ['a', 'c'], assignee: '@alex', due_date: '2026-11-02' });
  assert.deepStrictEqual(rec.before, { priority: 'Normal', tags: ['a', 'b'], assignee: null, due_date: null });
});

test('a parent or rank the form sends the way the card holds it is not a change', async () => {
  const src = open(memoryStorage());
  await src.request('PATCH', '/api/cards/7', { title: 'Seven', parent: '3', rank: '5', assignee: '@alex', status: 'doing' });
  const [rec] = src.records();
  assert.deepStrictEqual(rec.change.body, { status: 'doing' });
  assert.deepStrictEqual(rec.before, { status: 'todo' });
});

test('a field the store changes as a side effect is not queued: a backlog card moved to todo queues the status alone', async () => {
  const src = open(memoryStorage());
  const res = await src.request('PATCH', '/api/cards/5', form({ title: 'Five', body: 'body of 5\n', tags: [], status: 'todo' }));
  assert.strictEqual(res.status, 200);
  assert.ok(res.json.start_date, 'the move into todo stamped start_date');
  const [rec] = src.records();
  assert.deepStrictEqual(rec.change.body, { status: 'todo' });
  assert.deepStrictEqual(rec.before, { status: 'backlog' });
});

test('a start_date the person sets in the same edit is queued with the status', async () => {
  const src = open(memoryStorage());
  await src.request('PATCH', '/api/cards/5', form({ title: 'Five', body: 'body of 5\n', tags: [], status: 'todo', start_date: '2026-11-02' }));
  const [rec] = src.records();
  assert.deepStrictEqual(rec.change.body, { status: 'todo', start_date: '2026-11-02' });
  assert.deepStrictEqual(rec.before, { status: 'backlog', start_date: null });
});

test('an edit that changed nothing queues nothing', async () => {
  const src = open(memoryStorage());
  const res = await src.request('PATCH', '/api/cards/3', form());
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(src.records(), []);
  assert.strictEqual((await src.request('GET', '/api/board')).json.source.queued, 0);
});

test('a second edit of the same field takes the value the first queued as its before value', async () => {
  const src = open(memoryStorage());
  await src.request('PATCH', '/api/cards/3', form({ title: 'B' }));
  await src.request('PATCH', '/api/cards/3', form({ title: 'C' }));
  assert.deepStrictEqual(src.records().map((r) => [r.change.body, r.before]), [[{ title: 'B' }, { title: 'Three' }], [{ title: 'C' }, { title: 'B' }]]);
});

test('a save that is not a card edit carries no before value', async () => {
  const src = open(memoryStorage());
  await src.request('POST', '/api/cards/3/archive', {});
  assert.strictEqual(src.records()[0].before, undefined);
});

test('a reload shows the edit applied, and the next edit still compares against the card as it then is', async () => {
  const storage = memoryStorage();
  await open(storage).request('PATCH', '/api/cards/3', form({ title: 'B' }));
  const again = open(storage);
  assert.strictEqual((await again.request('GET', '/api/board')).json.active.find((c) => c.id === '3').title, 'B');
  await again.request('PATCH', '/api/cards/3', form({ title: 'B', priority: 'High' }));
  assert.deepStrictEqual(again.records()[1].change.body, { priority: 'High' });
});

test('a record the apply refused is kept with its reason, is not shown as applied, and is counted apart from the rest', async () => {
  const storage = memoryStorage();
  const first = open(storage);
  await first.request('PATCH', '/api/cards/3', form({ title: 'B' }));
  await first.request('PATCH', '/api/cards/7', { status: 'doing' });
  const held = JSON.parse(storage.getItem(`kanban-tray:${BOARD.id}`));
  held.records[0].refused = 'title changed at the desk since';
  storage.setItem(`kanban-tray:${BOARD.id}`, JSON.stringify(held));

  const again = open(storage);
  const board = (await again.request('GET', '/api/board')).json;
  assert.strictEqual(board.active.find((c) => c.id === '3').title, 'Three', 'a refused change is not what the board shows');
  assert.strictEqual(board.active.find((c) => c.id === '7').status, 'doing');
  assert.deepStrictEqual(board.source, { kind: 'page', queued: 2, refused: [{ id: 'dev-1', reason: 'title changed at the desk since' }], pictures: false, base: BOARD.base });
  assert.strictEqual(again.records()[0].refused, 'title changed at the desk since');
});

test('a tray with no refused record names none', async () => {
  const src = open(memoryStorage());
  await src.request('PATCH', '/api/cards/3', form({ title: 'B' }));
  assert.deepStrictEqual((await src.request('GET', '/api/board')).json.source, { kind: 'page', queued: 1, pictures: false, base: BOARD.base });
});

function openWatched(storage) {
  let calls = 0;
  let echo = null;
  const fresh = () => { calls += 1; return makeMemoryRoute(SOURCES, { files: FILES, dir: '/p/.kanban' }).route; };
  const inner = makeTrayStore(storage, `kanban-tray:${BOARD.id}`, 'dev');
  const tray = Object.assign(Object.create(Object.getPrototypeOf(inner)), inner, { ready: Promise.resolve(), records: () => inner.latest(), subscribe: (fn) => { echo = fn; } });
  const src = makePageSource({ route: fresh(), fresh, tray, board: BOARD });
  return { src, echo: () => echo(), rebuilds: () => calls - 1 };
}

test('a tray change that refuses nothing leaves the board as it is, after a save made on this page', async () => {
  const w = openWatched(memoryStorage());
  await w.src.request('GET', '/api/board');
  await w.src.request('PATCH', '/api/cards/3', form({ title: 'B' }));
  w.echo();
  w.echo();
  assert.strictEqual(w.rebuilds(), 0);
  assert.strictEqual((await w.src.request('GET', '/api/board')).json.active.find((c) => c.id === '3').title, 'B');
});

test('a record marked refused after this page saved it rebuilds the board once, without it', async () => {
  const storage = memoryStorage();
  const w = openWatched(storage);
  await w.src.request('GET', '/api/board');
  await w.src.request('PATCH', '/api/cards/3', form({ title: 'B' }));
  const held = JSON.parse(storage.getItem(`kanban-tray:${BOARD.id}`));
  held.records[0].refused = 'title changed at the desk since';
  storage.setItem(`kanban-tray:${BOARD.id}`, JSON.stringify(held));
  w.echo();
  w.echo();
  assert.strictEqual(w.rebuilds(), 1);
  assert.strictEqual((await w.src.request('GET', '/api/board')).json.active.find((c) => c.id === '3').title, 'Three');
});
