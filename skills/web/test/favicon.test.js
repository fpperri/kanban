const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createServer } = require('../scripts/server');

const WEB = path.join(__dirname, '..', 'web');
const svg = fs.readFileSync(path.join(WEB, 'favicon.svg'), 'utf8');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');

// The token blocks in app.css: bare :root (light), then the dark media block.
function accent(block) {
  const m = block.match(/--accent:\s*(#[0-9a-fA-F]{6})\s*;/);
  assert.ok(m, 'an --accent token in the block');
  return m[1].toLowerCase();
}
const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const darkStart = css.indexOf(':root:not([data-theme="light"])');
const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart));

test('the icon is well-formed XML: no double hyphen inside a comment, which makes browsers reject the whole image', () => {
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  for (const [, body] of svg.matchAll(/<!--([\s\S]*?)-->/g)) {
    assert.ok(!body.includes('--'), `an SVG comment may not contain "--": ${body.trim().slice(0, 60)}`);
  }
});

test('the page links the tab icon as an SVG served from the board server', () => {
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
});

test('the icon tile is the theme accent in each browser theme, so the two cannot drift apart', () => {
  const tiles = [...svg.matchAll(/\.tile\s*\{\s*fill:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => m[1].toLowerCase());
  assert.strictEqual(tiles.length, 2, 'one tile colour outside the dark media rule, one inside');
  assert.strictEqual(tiles[0], accent(lightBlock), 'light tile = light --accent');
  assert.strictEqual(tiles[1], accent(darkBlock), 'dark tile = dark --accent');
  assert.ok(svg.indexOf('@media (prefers-color-scheme: dark)') < svg.lastIndexOf('.tile'), 'the second tile colour sits inside the dark rule');
});

test('the icon draws three columns of cards, fuller on the left: three, two, one', () => {
  const xs = [...svg.matchAll(/<rect class="card" x="([\d.]+)"/g)].map((m) => m[1]);
  const perColumn = new Map();
  for (const x of xs) perColumn.set(x, (perColumn.get(x) || 0) + 1);
  assert.deepStrictEqual([...perColumn.values()], [3, 2, 1]);
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
