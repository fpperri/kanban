const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');

function tmpBoard({ config = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-type-srv-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    '---\nid: 1\nstatus: todo\npriority: Normal\ntype: objective\n---\n\n# One\n\nbody\n');
  fs.writeFileSync(path.join(dir, '0002.two.card.md'),
    '---\nid: 2\nstatus: todo\npriority: Normal\n---\n\n# Two\n\nbody\n');
  if (config) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

async function json(base, method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('GET /api/board carries the types list from config.yaml, order and colors kept', async () => {
  const dir = tmpBoard({ config: 'types:\n  - name: objective\n    color: "#a371f7"\n  - story\n' });
  await withServer(dir, async (base) => {
    const data = (await json(base, 'GET', '/api/board')).json;
    assert.deepStrictEqual(data.types, [
      { name: 'objective', color: '#a371f7' },
      { name: 'story', color: '' },
    ]);
  });
});

test('GET /api/board returns types: [] with no config.yaml or no types key', async () => {
  for (const config of ['', 'nextId: 5\n']) {
    await withServer(tmpBoard({ config }), async (base) => {
      assert.deepStrictEqual((await json(base, 'GET', '/api/board')).json.types, []);
    });
  }
});

test('the board payload carries each card\'s type, null when it has none', async () => {
  await withServer(tmpBoard(), async (base) => {
    const { active } = (await json(base, 'GET', '/api/board')).json;
    assert.strictEqual(active.find((c) => c.id === 1).type, 'objective');
    assert.strictEqual(active.find((c) => c.id === 2).type, null);
  });
});

test('type round-trip over the API: POST writes the line, PATCH replaces it, a blank PATCH clears it', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const created = await json(base, 'POST', '/api/cards', { title: 'Typed', status: 'todo', type: 'milestone' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.json.type, 'milestone');
    const file = fs.readdirSync(dir).find((f) => f.includes('typed'));
    assert.match(fs.readFileSync(path.join(dir, file), 'utf8'), /^type: milestone$/m);
    assert.strictEqual((await json(base, 'PATCH', `/api/cards/${created.json.id}`, { type: 'story' })).json.type, 'story');
    assert.strictEqual((await json(base, 'PATCH', `/api/cards/${created.json.id}`, { type: '' })).json.type, null);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /^type:/m);
  });
});

test('PATCHing other fields of a typed card (a form-style save) leaves its `type:` line alone', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await json(base, 'PATCH', '/api/cards/1', {
      title: 'One, renamed', priority: 'High', assignee: '@alex', tags: ['a'], epic: false, status: 'todo',
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.type, 'objective');
    assert.match(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /^type: objective$/m);
  });
});

test('/type-badge.js is served, and app.html loads it before app.js', async () => {
  await withServer(tmpBoard(), async (base) => {
    const res = await fetch(`${base}/type-badge.js`);
    assert.strictEqual(res.status, 200);
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes('<script src="/type-badge.js"></script>'));
    assert.ok(html.indexOf('/type-badge.js') < html.indexOf('/app.js'));
  });
});
