const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../plugin/skills/web/scripts/server');

// The scratchpad through the server's HTTP API on a temporary board (docs/adr/0016): the board
// payload names the targets that have a page, GET and PUT read and write one page, and the delete
// flow takes a card's or a group's page only when asked.

const CONFIG = ['name: t', 'nextId: 30', 'groups: .groups', 'scratchpad: .scratchpad', 'prefixes:', '  I: .groups/iteration', ''].join('\n');
const card = (id, title) => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# ${title}\n`;

function tmpBoard({ config = CONFIG, files = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-scratchpad-srv-'));
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

test('the board payload names the folder and the targets that have a page; none without the line', async () => {
  const dir = tmpBoard({ files: { '.scratchpad/0007.scratchpad.md': 'seven', '.scratchpad/I0001.scratchpad.md': 'group' } });
  await withServer(dir, async (base) => {
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.scratchpad, { folder: '.scratchpad', targets: ['7', 'I1'] });
  });
  await withServer(tmpBoard({ config: 'name: t\n' }), async (base) => {
    assert.strictEqual((await req(base, 'GET', '/api/board')).json.scratchpad, null);
  });
});

test('GET reads a page, an empty one for a target that has none', async () => {
  const dir = tmpBoard({ files: { '.scratchpad/0007.scratchpad.md': '---\nrefs:\n  - a.md\n---\n\ntext\n' } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'GET', '/api/scratchpad/7');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.pad, { target: '7', exists: true, file: '0007.scratchpad.md', refs: ['a.md'], body: 'text\n' });
    const none = await req(base, 'GET', '/api/scratchpad/3');
    assert.strictEqual(none.status, 200);
    assert.deepStrictEqual(none.json.pad, { target: '3', exists: false, file: '0003.scratchpad.md', refs: [], body: '' });
    assert.ok(!exists(dir, '.scratchpad/0003.scratchpad.md'), 'a read writes nothing');
  });
});

test('PUT writes the body to the page, for a card and for a group, and the next board lists it', async () => {
  const dir = tmpBoard({ files: { '.groups/iteration/0001.zephyr-1.md': I1 } });
  await withServer(dir, async (base) => {
    const card = await req(base, 'PUT', '/api/scratchpad/7', { body: 'first\nsecond' });
    assert.strictEqual(card.status, 200);
    assert.deepStrictEqual(card.json.pad, { target: '7', exists: true, file: '0007.scratchpad.md', refs: [], body: 'first\nsecond' });
    assert.strictEqual(read(dir, '.scratchpad/0007.scratchpad.md'), 'first\nsecond');
    assert.strictEqual((await req(base, 'PUT', '/api/scratchpad/I1', { body: 'g' })).status, 200);
    assert.ok(exists(dir, '.scratchpad/I0001.scratchpad.md'));
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.scratchpad.targets, ['7', 'I1']);
  });
});

test('a request that is wrong answers its status and writes nothing', async () => {
  await withServer(tmpBoard({ config: 'name: t\n' }), async (base) => {
    assert.strictEqual((await req(base, 'GET', '/api/scratchpad/7')).status, 404);
    assert.strictEqual((await req(base, 'PUT', '/api/scratchpad/7', { body: 'x' })).status, 404);
  });
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'GET', '/api/scratchpad/abc')).status, 404, 'a path that is no id is no route');
    assert.strictEqual((await req(base, 'PUT', '/api/scratchpad/7', { body: 5 })).status, 400);
    assert.strictEqual((await req(base, 'PUT', '/api/scratchpad/7', {})).status, 400);
    assert.strictEqual((await req(base, 'DELETE', '/api/scratchpad/7')).status, 404, 'the page has no delete route: only the delete flow removes one');
  });
  assert.ok(!exists(dir, '.scratchpad'));
});

test('deleting a card keeps its scratchpad unless asked, and the unasked delete says nothing of it', async () => {
  const dir = tmpBoard({ files: { '.scratchpad/0007.scratchpad.md': 'keep', '.scratchpad/0003.scratchpad.md': 'other' } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/cards/7');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.swept, {});
  });
  assert.ok(exists(dir, '.scratchpad/0007.scratchpad.md'));
});

test('deleting a card with scratchpad: true takes its page and no other', async () => {
  const dir = tmpBoard({ files: { '.scratchpad/0007.scratchpad.md': 'gone', '.scratchpad/0003.scratchpad.md': 'other' } });
  await withServer(dir, async (base) => {
    const r = await req(base, 'DELETE', '/api/cards/7', { scratchpad: true });
    assert.deepStrictEqual(r.json.swept, { scratchpad: 1 });
  });
  assert.ok(!exists(dir, '.scratchpad/0007.scratchpad.md'));
  assert.ok(exists(dir, '.scratchpad/0003.scratchpad.md'));
});

test('deleting a group takes its page only when ticked, and its member cards\' pages stay either way', async () => {
  const files = { '.groups/iteration/0001.zephyr-1.md': I1, '.scratchpad/I0001.scratchpad.md': 'group', '.scratchpad/0007.scratchpad.md': 'member' };
  const kept = tmpBoard({ files });
  await withServer(kept, async (base) => {
    assert.deepStrictEqual((await req(base, 'DELETE', '/api/groups/I1', {})).json.swept, {});
  });
  assert.ok(exists(kept, '.scratchpad/I0001.scratchpad.md'));
  const taken = tmpBoard({ files });
  await withServer(taken, async (base) => {
    const r = await req(base, 'DELETE', '/api/groups/I1', { scratchpad: true, members: true });
    assert.deepStrictEqual(r.json.swept, { scratchpad: 1 });
    assert.deepStrictEqual(r.json.deleted, ['3', '7']);
  });
  assert.ok(!exists(taken, '.scratchpad/I0001.scratchpad.md'));
  assert.ok(exists(taken, '.scratchpad/0007.scratchpad.md'), 'a deleted member card keeps its page unless it is ticked on its own');
});

test('the targets that have a page come out of a per-card folder (<card>) as out of a shared one', async () => {
  const perCard = tmpBoard({
    config: CONFIG.replace('scratchpad: .scratchpad', 'scratchpad: pads/<card>'),
    files: { 'pads/0007.seven/0007.scratchpad.md': '', 'pads/0003.three/notes.md': 'not a page' },
  });
  await withServer(perCard, async (base) => {
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.scratchpad.targets, ['7']);
  });
  const shared = tmpBoard({ files: { '.scratchpad/0003.scratchpad.md': '', '.scratchpad/0007.scratchpad.md': '   \n' } });
  await withServer(shared, async (base) => {
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.scratchpad.targets, ['3', '7'], 'a page with no text still counts');
  });
});
