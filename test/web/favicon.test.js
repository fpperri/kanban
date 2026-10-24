const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer } = require('../scripts/server');

const WEB = path.join(__dirname, '..', 'web');
const svg = fs.readFileSync(path.join(WEB, 'favicon.svg'), 'utf8');
const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');

test('the tab icon is the plugin\'s official icon, assets/icon.svg, byte for byte (line endings aside)', () => {
  const canonical = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'icon.svg'), 'utf8');
  assert.strictEqual(svg.replace(/\r\n/g, '\n'), canonical.replace(/\r\n/g, '\n'));
});

test('the icon is well-formed XML: no double hyphen inside a comment, which makes browsers reject the whole image', () => {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  for (const [, body] of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
    assert.ok(!body.includes('--'), `an SVG comment may not contain "--": ${body.trim().slice(0, 60)}`);
  }
});

test('the page links the tab icon as an SVG served from the board server', () => {
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
});

test('the four streams fade into the board\'s status colors, backlog to done, left to right', () => {
  const { BUILTIN_STATUS_COLORS } = require('../web/status-colors.js');
  const streams = [...svg.matchAll(/<rect class="stream" x="([\d.]+)"[^>]*fill="url\(#(\w+)\)"/g)];
  assert.deepStrictEqual(streams.map((m) => m[2]), ['backlog', 'todo', 'doing', 'done']);
  const xs = streams.map((m) => Number(m[1]));
  assert.deepStrictEqual([...xs].sort((p, q) => p - q), xs);
  for (const status of Object.keys(BUILTIN_STATUS_COLORS)) {
    const grad = new RegExp(`<linearGradient id="${status}"[^>]*>.*?<stop offset="[\\d.]+" stop-color="(#[0-9a-fA-F]{6})"/></linearGradient>`).exec(svg);
    assert.ok(grad, `a gradient for ${status}`);
    assert.strictEqual(grad[1].toLowerCase(), BUILTIN_STATUS_COLORS[status].toLowerCase(), status);
  }
});

test('the streams fall out of the brain: each starts under it and ends below its lowest lobe', () => {
  const lobes = [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)" r="([\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[2]));
  const bottom = Math.max(...lobes);
  for (const [, y, h] of svg.matchAll(/<rect class="stream" x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)) {
    assert.ok(Number(y) < bottom && Number(y) + Number(h) > bottom + 2);
  }
});

test('GET /favicon.svg serves the icon as image/svg+xml', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-favicon-'));
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.address().port, path: '/favicon.svg' }, (r) => {
        let body = ''; r.on('data', (c) => { body += c; }); r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'], body }));
      }).on('error', reject);
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.type, 'image/svg+xml');
    assert.strictEqual(res.body, svg);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
