const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createServer, VENDORED, FRAME_FILES } = require('../../plugin/skills/web/scripts/server');

// The two vendored libraries and the diagram frame are served by name, from web/vendor and web/, and
// nothing else under them is. The page's own CSP never gains an unsafe-inline; only the diagram
// frame, a sandboxed page of its own, may style inline (docs/web.md, Markdown).

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-vendor-'));
  fs.writeFileSync(path.join(dir, '1.card.md'), `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# One\n`);
  return dir;
}

async function serve(fn) {
  const srv = createServer(tmpBoard());
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, srv.address().port); } finally { srv.close(); }
}

// fetch cannot set Origin, so a request with one is made by hand.
function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

test('each vendored file is served with its own content type', async () => {
  await serve(async (base) => {
    const want = {
      '/vendor/mermaid/mermaid.min.js': /text\/javascript/,
      '/vendor/highlight.js/highlight.min.js': /text\/javascript/,
      '/vendor/highlight.js/github.min.css': /text\/css/,
      '/vendor/highlight.js/github-dark.min.css': /text\/css/,
    };
    for (const [url, type] of Object.entries(want)) {
      const res = await fetch(`${base}${url}`);
      assert.strictEqual(res.status, 200, url);
      assert.match(res.headers.get('content-type'), type, url);
      assert.ok((await res.arrayBuffer()).byteLength > 1000, `${url} has its content`);
    }
  });
});

test('the licence files, other files in vendor and a way out of it are not served', async () => {
  await serve(async (base) => {
    for (const url of ['/vendor/mermaid/LICENSE', '/vendor/highlight.js/LICENSE', '/vendor/nothing.js', '/vendor/', '/vendor',
      '/vendor/mermaid/../../app.html', '/vendor/..%2Fapp.js', '/vendor/mermaid/mermaid.min.js.map']) {
      const res = await fetch(`${base}${url}`);
      assert.strictEqual(res.status, 404, url);
      await res.text();
    }
  });
});

test('the diagram frame is served, and it is the only page whose CSP lets styles be inline', async () => {
  await serve(async (base) => {
    const frame = await fetch(`${base}/mermaid-frame.html`);
    assert.strictEqual(frame.status, 200);
    assert.match(frame.headers.get('content-type'), /text\/html/);
    const csp = frame.headers.get('content-security-policy');
    assert.match(csp, /(^|; )sandbox allow-scripts(;|$)/, 'the frame is sandboxed whatever embeds it, and may run scripts and nothing more');
    assert.doesNotMatch(csp, /allow-same-origin/, 'no same-origin: its origin is opaque');
    assert.match(csp, /(^|; )style-src 'unsafe-inline'(;|$)/, 'the one place mermaid\'s inline styles are allowed');
    assert.match(csp, /(^|; )script-src 'self'(;|$)/, 'and scripts stay own-file only');
    assert.match(csp, /(^|; )default-src 'none'(;|$)/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-(inline|eval)/);
    await frame.text();

    const js = await fetch(`${base}/mermaid-frame.js`);
    assert.strictEqual(js.status, 200);
    assert.match(js.headers.get('content-type'), /text\/javascript/);
    await js.text();

    const page = await fetch(`${base}/`);
    const pageCsp = page.headers.get('content-security-policy');
    assert.doesNotMatch(pageCsp, /unsafe-inline|unsafe-eval/, 'the app page\'s CSP is as strict as it was');
    assert.match(pageCsp, /style-src 'self'(;|$)/);
    await page.text();
  });
});

test('a sandboxed frame\'s request, whose origin is the string null, may read the frame\'s own files and nothing else', async () => {
  await serve(async (base, port) => {
    for (const url of ['/mermaid-frame.js', '/vendor/mermaid/mermaid.min.js', '/vendor/highlight.js/github.min.css']) {
      const res = await get(port, url, { origin: 'null' });
      assert.strictEqual(res.status, 200, url);
    }
    for (const url of ['/api/board', '/app.js', '/']) {
      const res = await get(port, url, { origin: 'null' });
      assert.strictEqual(res.status, 403, url);
    }
    const other = await get(port, '/mermaid-frame.js', { origin: 'http://evil.test' });
    assert.strictEqual(other.status, 403, 'another origin is refused as it always was');
    const rebound = await get(port, '/mermaid-frame.js', { origin: 'null', host: 'evil.test' });
    assert.strictEqual(rebound.status, 403, 'and a host that is not localhost is still refused');
  });
});

test('a stray file beside the frame is still not served', async () => {
  await serve(async (base) => {
    const res = await fetch(`${base}/mermaid-frame.css`);
    assert.strictEqual(res.status, 404);
    await res.text();
  });
});

test('the served list is the vendor folder, less its licences, and the frame files exist', () => {
  const web = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
  const found = [];
  for (const lib of fs.readdirSync(path.join(web, 'vendor'))) {
    for (const f of fs.readdirSync(path.join(web, 'vendor', lib))) if (f !== 'LICENSE') found.push(`${lib}/${f}`);
    assert.ok(fs.existsSync(path.join(web, 'vendor', lib, 'LICENSE')), `${lib} has its LICENSE beside it`);
  }
  assert.deepStrictEqual(found.sort(), [...VENDORED].sort());
  for (const f of FRAME_FILES) assert.ok(fs.existsSync(path.join(web, f)), f);
});

test('the vendored files are cached for good, since a version is a file and a new version is a new query; everything else stays no-store', async () => {
  await serve(async (base) => {
    for (const url of ['/vendor/mermaid/mermaid.min.js?v=12.2.0', '/vendor/highlight.js/highlight.min.js?v=1', '/vendor/highlight.js/github.min.css']) {
      const res = await fetch(`${base}${url}`);
      assert.strictEqual(res.status, 200, url);
      assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=31536000, immutable', url);
      await res.arrayBuffer();
    }
    for (const url of ['/', '/app.js', '/mermaid-frame.html', '/mermaid-frame.js', '/api/board']) {
      const res = await fetch(`${base}${url}`);
      assert.strictEqual(res.headers.get('cache-control'), 'no-store', url);
      await res.arrayBuffer();
    }
  });
});

test('one function says which file a path names, for the check and the route alike', () => {
  const { frameAssetFile } = require('../../plugin/skills/web/scripts/server');
  const web = path.join('/w');
  assert.deepStrictEqual(frameAssetFile(web, '/vendor/mermaid/mermaid.min.js'), { file: path.join(web, 'vendor', 'mermaid', 'mermaid.min.js'), immutable: true });
  assert.deepStrictEqual(frameAssetFile(web, '/mermaid-frame.js'), { file: path.join(web, 'mermaid-frame.js'), immutable: false });
  for (const p of ['/vendor/mermaid/LICENSE', '/vendor/', '/vendor', '/app.js', '/mermaid-frame.css', '/vendor/../app.html']) assert.strictEqual(frameAssetFile(web, p), null, p);
});
