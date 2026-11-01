const { test } = require('node:test');
const assert = require('node:assert');
const { serverSource, call } = require('../../plugin/skills/web/web/board-source');

// api() asks a board source. The server source is fetch; a source answers { status, json, text, statusText }.

const response = (status, body, type = 'application/json; charset=utf-8') => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 404 ? 'Not Found' : '',
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test('the server source sends the method, path and JSON body through fetch', async () => {
  let seen;
  const src = serverSource(async (url, init) => { seen = { url, init }; return response(200, { ok: true }); });
  assert.deepStrictEqual(await call(src, 'POST', '/api/cards', { title: 'x' }), { ok: true });
  assert.strictEqual(seen.url, '/api/cards');
  assert.strictEqual(seen.init.method, 'POST');
  assert.deepStrictEqual(seen.init.headers, { 'content-type': 'application/json' });
  assert.strictEqual(seen.init.body, JSON.stringify({ title: 'x' }));
});

test('a read sends no body and no headers', async () => {
  let seen;
  const src = serverSource(async (url, init) => { seen = init; return response(200, { a: 1 }); });
  await call(src, 'GET', '/api/board');
  assert.strictEqual(seen.body, undefined);
  assert.strictEqual(seen.headers, undefined);
});

test('a refusal throws the answer\'s own message, with its status and body', async () => {
  const src = serverSource(async () => response(422, { error: 'Card #7 is waiting for #3.', waiting: ['3'] }));
  await assert.rejects(call(src, 'PATCH', '/api/cards/7', { status: 'doing' }), (e) => {
    assert.strictEqual(e.message, 'Card #7 is waiting for #3.');
    assert.strictEqual(e.status, 422);
    assert.deepStrictEqual(e.data, { error: 'Card #7 is waiting for #3.', waiting: ['3'] });
    return true;
  });
});

test('a failure with no JSON error says the status and the text', async () => {
  const src = serverSource(async () => response(404, 'not found', 'text/plain'));
  await assert.rejects(call(src, 'GET', '/api/x'), (e) => e.message === '404 — not found' && e.status === 404 && e.data === null);
});

test('a source of any kind is asked the same way: whatever answers { status, json } serves', async () => {
  const src = { request: async () => ({ status: 200, json: { n: 1 }, text: '' }) };
  assert.deepStrictEqual(await call(src, 'GET', '/api/board'), { n: 1 });
  const bad = { request: async () => ({ status: 403, json: { error: 'A desk job' }, text: '' }) };
  await assert.rejects(call(bad, 'POST', '/api/config', {}), /A desk job/);
});
