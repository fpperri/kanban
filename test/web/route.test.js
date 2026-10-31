const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeRoute } = require('../../plugin/skills/web/scripts/route');
const { createServer } = require('../../plugin/skills/web/scripts/server');

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-route-'));
  const card = (id, status, waiting) => fs.writeFileSync(path.join(dir, `${id}.card.md`),
    `---\nid: ${id}\nstatus: ${status}\npriority: Normal\nwaiting_for: [${waiting}]\ntags: []\n---\n\n# Card ${id}\n\nbody\n`);
  card(1, 'todo', '');
  card(2, 'todo', '1');
  return dir;
}

async function overHttp(dir, method, url, body, homeUrl = null) {
  const srv = createServer(dir, undefined, homeUrl);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}${url}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally { srv.close(); }
}

test('route answers the board load with no port, as the server does', async () => {
  const dir = tmpBoard();
  const homeUrl = 'http://example.test/';
  const viaRoute = makeRoute(dir, { homeUrl })('GET', '/api/board');
  assert.strictEqual(viaRoute.status, 200);
  assert.deepStrictEqual(viaRoute.body.active.map((c) => c.id).sort(), ['1', '2']);
  assert.strictEqual(viaRoute.body.homeUrl, homeUrl);
  const viaServer = await overHttp(dir, 'GET', '/api/board', undefined, homeUrl);
  assert.deepStrictEqual({ status: viaRoute.status, body: viaRoute.body }, viaServer);
});

test('route creates a card and moves it, answering what the server answers', async () => {
  const viaRoute = tmpBoard();
  const viaServer = tmpBoard();
  const create = { title: 'Made', status: 'todo' };
  const r = makeRoute(viaRoute)('POST', '/api/cards', create);
  const s = await overHttp(viaServer, 'POST', '/api/cards', create);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.status, s.status);
  const strip = (c) => ({ ...c, updated: undefined, file: undefined });
  assert.deepStrictEqual(strip(r.body), strip(s.body));

  const move = makeRoute(viaRoute)('PATCH', '/api/cards/1', { status: 'doing' });
  const moved = await overHttp(viaServer, 'PATCH', '/api/cards/1', { status: 'doing' });
  assert.strictEqual(move.status, 200);
  assert.strictEqual(move.body.status, 'doing');
  assert.strictEqual(move.status, moved.status);
  assert.deepStrictEqual(strip(move.body), strip(moved.body));
});

test('route refuses a doing-gate move with the 422 and the waiting ids the server gives', async () => {
  const viaRoute = tmpBoard();
  const viaServer = tmpBoard();
  const r = makeRoute(viaRoute)('PATCH', '/api/cards/2', { status: 'doing' });
  const s = await overHttp(viaServer, 'PATCH', '/api/cards/2', { status: 'doing' });
  assert.strictEqual(r.status, 422);
  assert.deepStrictEqual(r.body.waiting, [{ id: '1', status: 'todo' }]);
  assert.deepStrictEqual(r, s);
});

test('route keeps a store refusal status and message, a missing card a 404, an unknown path null', async () => {
  const dir = tmpBoard();
  const route = makeRoute(dir);
  const missing = route('GET', '/api/cards/99/detail');
  assert.deepStrictEqual(missing, { status: 404, body: { error: 'no card #99' } });
  assert.deepStrictEqual(missing, await overHttp(dir, 'GET', '/api/cards/99/detail'));
  assert.strictEqual(route('GET', '/api/nothing-here'), null);
  const bad = route('POST', '/api/cards/1/archive', { package: '../x' });
  assert.strictEqual(bad.status, 400);
  assert.deepStrictEqual(bad, await overHttp(dir, 'POST', '/api/cards/1/archive', { package: '../x' }));
});

test('route answers an image as bytes with its type, and holds no origin or binding', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-route-img-')), '.kanban');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '1.card.md'), '---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# One\n');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  fs.writeFileSync(path.join(path.dirname(dir), 'pic.png'), png);
  const r = makeRoute(dir)('GET', '/api/cards/1/image?path=' + encodeURIComponent('../pic.png'));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.type, 'image/png');
  assert.deepStrictEqual(r.body, png);
  assert.deepStrictEqual(Object.keys(require('../../plugin/skills/web/scripts/route')), ['makeRoute']);
});
