const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cs = require('../../plugin/skills/web/scripts/card-store');
const { createServer } = require('../../plugin/skills/web/scripts/server');

// An id is the whole string (`3` and `G3` are two cards). The store keeps ids as
// strings, the routes take them whole and the card JSON sends them as strings.

function put(dir, id, extra, title, sub) {
  const folder = sub ? path.join(dir, sub) : dir;
  fs.mkdirSync(folder, { recursive: true });
  const name = `${id}`.replace(/^([_A-Z]*)(\d+)$/, (m, p, n) => `${p}${n.padStart(4, '0')}`);
  fs.writeFileSync(path.join(folder, `${name}.card.md`), `---\nid: ${id}\nstatus: todo\npriority: Normal\n${extra || ''}---\n\n# ${title || `Card ${id}`}\n`);
}

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ids-'));
  put(dir, '3', 'status_note: x\n', 'Plain three');
  put(dir, 'G3', '', 'Group three');
  put(dir, '7', '');
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
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = text; }
  return { status: res.status, json };
}

test('readCardFile keeps the id as the whole string and drops zero padding', () => {
  const dir = tmpBoard();
  put(dir, '0012', '');
  put(dir, '_12', '');
  const ids = cs.listActive(dir).map((c) => c.id).sort();
  assert.deepStrictEqual(ids, ['12', '3', '7', 'G3', '_12']);
});

test('a card with no usable id is unparseable and has no id', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'bad.card.md'), '---\nid: g3\nstatus: todo\n---\n\n# lower\n');
  fs.writeFileSync(path.join(dir, 'worse.card.md'), '---\nstatus: todo\n---\n\n# none\n');
  const bad = cs.listActive(dir).filter((c) => c.unparseable);
  assert.strictEqual(bad.length, 2);
  assert.ok(bad.every((c) => c.id === null));
});

test('waiting_for and parent keep prefixed ids as strings, and a foreign board id whole', () => {
  const dir = tmpBoard();
  put(dir, '9', 'waiting_for: [G3, 3, 0007]\nparent: G3\n');
  put(dir, '10', 'parent: "fpp#G4"\n');
  put(dir, '11', 'parent: 7\n');
  const by = Object.fromEntries(cs.listActive(dir).map((c) => [c.id, c]));
  assert.deepStrictEqual(by['9'].waiting_for, ['G3', '3', '7']);
  assert.strictEqual(by['9'].parent, 'G3');
  assert.strictEqual(by['10'].parent, 'fpp#G4');
  assert.strictEqual(by['11'].parent, '7');
});

test('findCardFile matches the whole id: G3 does not reach card 3, and 3 does not reach G3', () => {
  const dir = tmpBoard();
  assert.strictEqual(path.basename(cs.findCardFile(dir, 'G3')), 'G0003.card.md');
  assert.strictEqual(path.basename(cs.findCardFile(dir, '3')), '0003.card.md');
  assert.strictEqual(path.basename(cs.findCardFile(dir, 3)), '0003.card.md');
  assert.strictEqual(cs.findCardFile(dir, 'G7'), null);
  assert.strictEqual(cs.findCardFile(dir, 'nope'), null);
});

test('nextId counts plain ids only unless a prefix is asked for', () => {
  const dir = tmpBoard();
  put(dir, 'G40', '');
  put(dir, '_99', '');
  assert.strictEqual(cs.nextId(dir), 8);
  assert.strictEqual(cs.nextId(dir, 'G'), 41);
  assert.strictEqual(cs.nextId(dir, 'W'), 1);
});

test('the doing gate resolves a waiting_for G3 to card G3 and not to card 3', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, '0003.card.md'), '---\nid: 3\nstatus: done\npriority: Normal\n---\n\n# Plain three\n');
  assert.throws(() => cs.updateCard(dir, '7', { status: 'doing', waiting_for: ['G3'] }), (e) => {
    assert.strictEqual(e.name, 'WaitingError');
    assert.deepStrictEqual(e.waiting.map((w) => w.id), ['G3']);
    return true;
  });
  assert.strictEqual(cs.updateCard(dir, '7', { status: 'doing', waiting_for: ['3'] }).status, 'doing');
});

test('toJSON: every id and its references are whole-id strings, plain ones too', () => {
  const dir = tmpBoard();
  put(dir, '9', 'waiting_for: [G3, 3]\nparent: G3\n');
  put(dir, '10', 'parent: 7\n');
  const json = Object.fromEntries(cs.listActive(dir).map((c) => [String(c.id), cs.toJSON(c)]));
  assert.strictEqual(json.G3.id, 'G3');
  assert.strictEqual(json['3'].id, '3');
  assert.deepStrictEqual(json['9'].waiting_for, ['G3', '3']);
  assert.strictEqual(json['9'].parent, 'G3');
  assert.strictEqual(json['10'].parent, '7');
});

test('GET /api/board lists a card whose id is G3', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await req(base, 'GET', '/api/board');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.json.active.map((c) => c.id).sort((a, b) => String(a).localeCompare(String(b))), ['3', '7', 'G3']);
  });
});

test('detail, edit, archive, restore and delete reach card G3 by its route', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const detail = await req(base, 'GET', '/api/cards/G3/detail');
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.json.id, 'G3');
    assert.strictEqual(detail.json.title, 'Group three');

    const patched = await req(base, 'PATCH', '/api/cards/G3', { priority: 'High', waiting_for: ['G4', 7] });
    assert.strictEqual(patched.status, 200);
    assert.strictEqual(patched.json.id, 'G3');
    assert.strictEqual(patched.json.priority, 'High');
    assert.deepStrictEqual(patched.json.waiting_for, ['G4', '7']);
    assert.match(fs.readFileSync(path.join(dir, 'G0003.card.md'), 'utf8'), /^waiting_for: \[G4, 7\]$/m);
    assert.match(fs.readFileSync(path.join(dir, '0003.card.md'), 'utf8'), /^status_note: x$/m, 'card 3 untouched');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '0003.card.md'), 'utf8'), /High/);

    const archived = await req(base, 'POST', '/api/cards/G3/archive', {});
    assert.strictEqual(archived.status, 200);
    assert.strictEqual(archived.json.archived, true);
    assert.ok(fs.existsSync(path.join(dir, 'archived', 'G0003.card.md')));
    assert.ok(fs.existsSync(path.join(dir, '0003.card.md')), 'card 3 stays on the board');
    assert.strictEqual((await req(base, 'GET', '/api/cards/G3/detail')).json.archived, true);

    const restored = await req(base, 'POST', '/api/cards/G3/restore');
    assert.strictEqual(restored.status, 200);
    assert.strictEqual(restored.json.archived, false);
    assert.ok(fs.existsSync(path.join(dir, 'G0003.card.md')));

    const gone = await req(base, 'DELETE', '/api/cards/G3');
    assert.deepStrictEqual(gone.json, { ok: true, groups: [], swept: {} });
    assert.ok(!fs.existsSync(path.join(dir, 'G0003.card.md')));
    assert.ok(fs.existsSync(path.join(dir, '0003.card.md')));
    const missing = await req(base, 'GET', '/api/cards/G3/detail');
    assert.strictEqual(missing.status, 404);
    assert.strictEqual(missing.json.error, 'no card #G3');
  });
});

test('a route id that is not an id never reaches a card', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'GET', '/api/cards/g3/detail')).status, 404);
    assert.strictEqual((await req(base, 'GET', '/api/cards/G/detail')).status, 404);
    assert.strictEqual((await req(base, 'GET', '/api/cards/G9/detail')).status, 404);
  });
});

test('moving a card to doing is refused while its waiting_for G3 is not done', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const refused = await req(base, 'PATCH', '/api/cards/7', { status: 'doing', waiting_for: ['G3'] });
    assert.strictEqual(refused.status, 422);
    assert.deepStrictEqual(refused.json.waiting.map((w) => w.id), ['G3']);
    const okay = await req(base, 'PATCH', '/api/cards/G3', { status: 'done' });
    assert.strictEqual(okay.status, 200);
    assert.strictEqual((await req(base, 'PATCH', '/api/cards/7', { status: 'doing', waiting_for: ['G3'] })).status, 200);
  });
});

test('reorder moves a prefixed card among prefixed neighbours', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ids-'));
  put(dir, 'G1', 'rank: 10\n');
  put(dir, 'G2', 'rank: 20\n');
  put(dir, 'G3', 'rank: 30\n');
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards/G3/reorder', { prev: 'G1', next: 'G2' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.card.id, 'G3');
    assert.strictEqual(res.json.card.rank, 15);
    assert.deepStrictEqual(res.json.renumbered, []);
    const bad = await req(base, 'POST', '/api/cards/G3/reorder', { prev: 'nope', next: null });
    assert.strictEqual(bad.status, 400);
  });
  assert.match(fs.readFileSync(path.join(dir, 'G0003.card.md'), 'utf8'), /^rank: 15$/m);
});

test('a parent naming G3 reaches the page as G3 and is not read as card 3', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ids-'));
  put(dir, '3', '');
  put(dir, 'G3', '');
  put(dir, '20', 'parent: G3\nrank: 10\n');
  put(dir, '21', 'parent: G3\nrank: 20\n');
  put(dir, '22', 'parent: G3\nrank: 30\n');
  put(dir, '23', 'parent: 3\nrank: 10\n');
  await withServer(dir, async (base) => {
    const board = await req(base, 'GET', '/api/board');
    const parents = Object.fromEntries(board.json.active.map((c) => [c.id, c.parent]));
    assert.strictEqual(parents[20], 'G3');
    assert.strictEqual(parents[23], '3');
  });
});

// The reorder plan runs on the store's cards through the nesting module, whole ids and all.
// A tile outside the siblings' stretch of the outline only marks that end of it, so card 23
// above the children of G3 is the start of their stretch and not an error; what the module
// refuses is a tile named on the wrong side of the stretch.
test('a reorder among the children of G3 stays under G3', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ids-'));
  put(dir, '3', '');
  put(dir, 'G3', '');
  put(dir, '20', 'parent: G3\nrank: 10\n');
  put(dir, '21', 'parent: G3\nrank: 20\n');
  put(dir, '22', 'parent: G3\nrank: 30\n');
  put(dir, '23', 'parent: 3\nrank: 10\n');
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards/22/reorder', { prev: '20', next: '21' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    assert.strictEqual(res.json.card.rank, 15);
    assert.strictEqual(res.json.card.parent, 'G3');
    const first = await req(base, 'POST', '/api/cards/21/reorder', { prev: '23', next: '20' });
    assert.strictEqual(first.status, 200, JSON.stringify(first.json));
    assert.strictEqual(first.json.card.rank, 0, 'card 23 lies above the children of G3, so it marks the top of their stretch');
    assert.strictEqual(first.json.card.parent, 'G3');
    const wrongSide = await req(base, 'POST', '/api/cards/22/reorder', { prev: null, next: '23' });
    assert.strictEqual(wrongSide.status, 400, 'card 23 is above the stretch, so it cannot be the tile below the drop');
  });
  assert.match(fs.readFileSync(path.join(dir, '0023.card.md'), 'utf8'), /^parent: 3$/m, 'the child of card 3 is untouched');
});

test('creating a card still gives the next plain number, whatever prefixed cards exist', async () => {
  const dir = tmpBoard();
  put(dir, 'G40', '');
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards', { title: 'New', parent: 'G3', waiting_for: ['G40'] });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.json.id, '8');
    assert.strictEqual(res.json.parent, 'G3');
    assert.deepStrictEqual(res.json.waiting_for, ['G40']);
    assert.ok(fs.existsSync(path.join(dir, '0008.new.card.md')));
  });
});
