const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../plugin/skills/web/scripts/server');

// A request body that is not JSON is the caller's mistake on a route that reads it, and says nothing about
// a path that is no route at all: that is still not found.

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-malformed-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: t\nnextId: 5\n');
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, dir); } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

const send = (base, method, url, body) => fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body });

test('an /api path that is no route answers 404 whether or not its body is JSON', async () => {
  await withServer(async (base) => {
    for (const body of ['{"a":1}', '{not json', '']) assert.strictEqual((await send(base, 'POST', '/api/nowhere', body)).status, 404, JSON.stringify(body));
    assert.strictEqual((await send(base, 'PATCH', '/api/cards', '{not json')).status, 404);
  });
});

test('a route that reads its body answers 500 with the parse error when the body is not JSON, and writes nothing', async () => {
  await withServer(async (base, dir) => {
    const res = await send(base, 'POST', '/api/cards', '{not json');
    assert.strictEqual(res.status, 500);
    assert.match((await res.json()).error, /JSON/i);
    assert.deepStrictEqual(fs.readdirSync(dir), ['config.yaml']);
  });
});

test('the probe for a route leaves no folder behind', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('kanban-route-probe-')).length;
  await withServer(async (base) => { await send(base, 'POST', '/api/nowhere', '{not json'); });
  assert.strictEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('kanban-route-probe-')).length, before);
});
