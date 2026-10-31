const { test } = require('node:test');
const assert = require('node:assert');
const { boot } = require('../../plugin/skills/web/scripts/page-source');
const { routeSources } = require('./helpers/route-sources');

// A card or group made in a page that carries its board gets a temporary id (n1, n2, ...), not the real one
// the board would allocate. Later saves may name it, the queue records which save made it, and a reload
// gives the same card the same id. Removing a queued save removes the saves that name the id it made.

const SOURCES = routeSources();
const card = (id, title) => `---\nid: ${id}\nstatus: todo\npriority: Normal\ntags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;
const FILES = {
  '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\ngroups: .groups\nlogbook: logbook\ntodos: .todos\n',
  '/p/.kanban/0003.three.card.md': card(3, 'Three'),
  '/p/.kanban/.groups/.keep': '',
};
const BOARD = { name: 'alpha', id: 'abc123', base: '2026-10-31T01:00:00.000Z' };

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); } };
}

const open = (storage, device = 'dev') => boot({ board: BOARD, sources: SOURCES, files: { ...FILES }, dir: '/p/.kanban' }, { storage, device });
const load = async (src) => (await src.request('GET', '/api/board')).json;
const ids = (board) => board.active.map((c) => c.id).sort();
const note = (target, text) => ({ target, day: '2026-10-31', at: '09:00', by: '@human', note: text });

async function makeFamily(src) {
  const parent = await src.request('POST', '/api/cards', { title: 'Made in the page' });
  const child = await src.request('POST', '/api/cards', { title: 'Its child', parent: 'n1' });
  const filed = await src.request('POST', '/api/notes', note('n1', 'a note'));
  return { parent, child, filed };
}

test('a card made in the page takes a temporary id and the board counter is left alone', async () => {
  const src = open(memoryStorage());
  const made = await src.request('POST', '/api/cards', { title: 'Made in the page' });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.json.id, 'n1');
  assert.deepStrictEqual(ids(await load(src)), ['3', 'n1']);
  const [rec] = src.records();
  assert.strictEqual(rec.temp, 'n1');
  assert.deepStrictEqual(rec.change, { method: 'POST', path: '/api/cards', body: { title: 'Made in the page' } });
});

test('the next card, group and so on take the next temporary id, and a save that is not a create records none', async () => {
  const src = open(memoryStorage());
  await src.request('POST', '/api/cards', { title: 'one' });
  const two = await src.request('POST', '/api/cards', { title: 'two' });
  const group = await src.request('POST', '/api/groups', { name: 'Trip', cards: ['3', 'n1'] });
  await src.request('PATCH', '/api/cards/n1', { priority: 'High' });
  assert.strictEqual(two.json.id, 'n2');
  assert.strictEqual(group.json.group.id, 'n3');
  assert.deepStrictEqual(src.records().map((r) => r.temp), ['n1', 'n2', 'n3', undefined]);
});

test('a child of n1 and a note on it both queue, and the page shows them', async () => {
  const src = open(memoryStorage());
  const { child, filed } = await makeFamily(src);
  assert.strictEqual(child.status, 201);
  assert.strictEqual(child.json.parent, 'n1');
  assert.strictEqual(filed.status, 201);
  const board = await load(src);
  assert.deepStrictEqual(board.source, { kind: 'page', queued: 3, base: BOARD.base });
  assert.strictEqual(board.logbook.notes.filter((n) => n.target === 'n1').length, 1);
});

test('a reload shows the same cards under the same temporary ids, and the next one takes the next', async () => {
  const storage = memoryStorage();
  await makeFamily(open(storage));
  const again = open(storage);
  const board = await load(again);
  assert.deepStrictEqual(ids(board), ['3', 'n1', 'n2']);
  assert.strictEqual(board.active.find((c) => c.id === 'n2').parent, 'n1');
  assert.strictEqual((await again.request('POST', '/api/cards', { title: 'later' })).json.id, 'n3');
});

test('two tabs of one board do not hand out the same temporary id', async () => {
  const storage = memoryStorage();
  const a = open(storage, 'a');
  const b = open(storage, 'b');
  assert.strictEqual((await a.request('POST', '/api/cards', { title: 'from a' })).json.id, 'n1');
  assert.strictEqual((await b.request('POST', '/api/cards', { title: 'from b' })).json.id, 'n2');
});

test('removal names the saves that go with a record: the ones that name the id it made, and what those made', async () => {
  const src = open(memoryStorage());
  await makeFamily(src);
  await src.request('POST', '/api/notes', note('n2', 'a note on the child'));
  await src.request('PATCH', '/api/cards/3', { priority: 'High' });
  const [parent, child, filed, grand, other] = src.records();
  assert.deepStrictEqual(src.removal(parent.id), { ids: [parent.id, child.id, filed.id, grand.id], more: 3 });
  assert.deepStrictEqual(src.removal(child.id), { ids: [child.id, grand.id], more: 1 });
  assert.deepStrictEqual(src.removal(other.id), { ids: [other.id], more: 0 });
  assert.strictEqual(src.removal('dev-99'), null);
});

test('removing the record that made n1 removes the child and the note too, and the page forgets all three', async () => {
  const storage = memoryStorage();
  const src = open(storage);
  await makeFamily(src);
  await src.request('PATCH', '/api/cards/3', { priority: 'High' });
  const [parent] = src.records();
  const gone = src.remove(parent.id);
  assert.strictEqual(gone.length, 3);
  assert.deepStrictEqual(src.records().map((r) => r.change.path), ['/api/cards/3']);
  const board = await load(src);
  assert.deepStrictEqual(ids(board), ['3']);
  assert.strictEqual(board.logbook.notes.filter((n) => n.target === 'n1').length, 0);
  assert.strictEqual(board.active[0].priority, 'High');
  assert.strictEqual(board.source.queued, 1);
  assert.deepStrictEqual(ids(await load(open(storage))), ['3']);
});

test('after a removal the page can make a card again, and it takes the lowest id no record holds', async () => {
  const src = open(memoryStorage());
  await src.request('POST', '/api/cards', { title: 'keep' });
  await src.request('POST', '/api/cards', { title: 'drop' });
  src.remove(src.records()[1].id);
  assert.strictEqual((await src.request('POST', '/api/cards', { title: 'again' })).json.id, 'n2');
  assert.deepStrictEqual(ids(await load(src)), ['3', 'n1', 'n2']);
});

test('removing a record that made nothing removes that record only, and the board shows the save undone', async () => {
  const src = open(memoryStorage());
  await src.request('PATCH', '/api/cards/3', { status: 'doing' });
  await src.request('PATCH', '/api/cards/3', { priority: 'High' });
  src.remove(src.records()[0].id);
  const [only] = (await load(src)).active;
  assert.strictEqual(only.status, 'todo');
  assert.strictEqual(only.priority, 'High');
});

test('recordMaking finds the record that made a temporary id', async () => {
  const src = open(memoryStorage());
  await makeFamily(src);
  assert.strictEqual(src.recordMaking('n2'), src.records()[1].id);
  assert.strictEqual(src.recordMaking('n9'), null);
  assert.strictEqual(src.recordMaking('3'), null);
});

test('clear discards every record at once, shows the board as it was built and starts the temporary ids over', async () => {
  const storage = memoryStorage();
  const src = open(storage);
  await makeFamily(src);
  await src.request('PATCH', '/api/cards/3', { priority: 'High' });
  assert.strictEqual(src.records().length, 4);
  const gone = src.clear();
  assert.strictEqual(gone.length, 4);
  assert.deepStrictEqual(src.records(), []);
  const board = await load(src);
  assert.deepStrictEqual(ids(board), ['3']);
  assert.strictEqual(board.active[0].priority, 'Normal');
  assert.strictEqual(board.source.queued, 0);
  assert.deepStrictEqual(src.records(), []);
  assert.deepStrictEqual(ids(await load(open(storage))), ['3']);
  assert.strictEqual((await src.request('POST', '/api/cards', { title: 'again' })).json.id, 'n1');
});

test('clear of an empty tray removes nothing', async () => {
  const src = open(memoryStorage());
  assert.deepStrictEqual(src.clear(), []);
});
