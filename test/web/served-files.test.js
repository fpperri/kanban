const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer, pageFiles, FRAME_FILES } = require('../scripts/server');

const WEB = path.join(__dirname, '..', 'web');
const lf = (text) => text.replace(/\r\n/g, '\n');

// The page names every file it loads; the server serves those files and no
// others. One list, so a module is added with one entry: its tag in app.html.

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-files-'));
  fs.writeFileSync(path.join(dir, '1.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# One\n`);
  return dir;
}

async function serve(webDir, fn) {
  const srv = createServer(tmpBoard(), undefined, null, webDir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

function webCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-webcopy-'));
  fs.cpSync(WEB, dir, { recursive: true });
  return dir;
}

test('a module the page names is served, with no other entry anywhere', async () => {
  const dir = webCopy();
  fs.writeFileSync(path.join(dir, 'fresh-module.js'), 'window.freshModule = 1;\n');
  const html = lf(fs.readFileSync(path.join(dir, 'app.html'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'app.html'), html.replace('<script src="/app.js"></script>', '<script src="/fresh-module.js"></script>\n<script src="/app.js"></script>'));
  await serve(dir, async (base) => {
    const res = await fetch(`${base}/fresh-module.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    assert.match(await res.text(), /freshModule/);
    const page = await (await fetch(`${base}/`)).text();
    assert.ok(page.indexOf('/fresh-module.js') > -1 && page.indexOf('/fresh-module.js') < page.indexOf('/app.js'));
  });
});

test('a file the page does not name is not served, even when it sits in the web directory', async () => {
  const dir = webCopy();
  fs.writeFileSync(path.join(dir, 'stray-module.js'), 'window.stray = 1;\n');
  await serve(dir, async (base) => {
    for (const p of ['/stray-module.js', '/app.html', '/missing.js']) {
      const res = await fetch(`${base}${p}`);
      assert.strictEqual(res.status, 404, p);
      await res.text();
    }
    assert.strictEqual((await fetch(`${base}/`)).status, 200);
  });
});

test('a path that climbs out of the web directory is not served', async () => {
  await serve(WEB, async (base) => {
    for (const p of ['/../scripts/server.js', '/%2e%2e/scripts/server.js', '/..%2fscripts%2fserver.js', '/scripts/server.js', '/server.js']) {
      const res = await fetch(`${base}${p}`);
      assert.strictEqual(res.status, 404, p);
      await res.text();
    }
  });
});

test('the stylesheet and the tab icon are on the page, so they are served', async () => {
  await serve(WEB, async (base) => {
    const css = await fetch(`${base}/app.css`);
    assert.strictEqual(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    await css.text();
    const icon = await fetch(`${base}/favicon.svg`);
    assert.strictEqual(icon.status, 200);
    assert.match(icon.headers.get('content-type'), /image\/svg\+xml/);
    await icon.text();
  });
});

test('pageFiles lists the local files a page loads, in page order, once each', () => {
  const html = [
    '<link rel="stylesheet" href="/a.css">',
    '<link rel="icon" type="image/svg+xml" href="/i.svg">',
    '<script src="/one.js"></script>',
    '<script src="/two.js"></script>',
    '<script src="/one.js"></script>',
  ].join('\n');
  assert.deepStrictEqual(pageFiles(html), ['a.css', 'i.svg', 'one.js', 'two.js']);
});

test('pageFiles ignores commented tags, other origins, nested paths and anchors', () => {
  const html = [
    '<!-- <script src="/commented.js"></script> -->',
    '<script src="https://example.com/remote.js"></script>',
    '<script src="//cdn.example.com/proto.js"></script>',
    '<script src="/sub/dir.js"></script>',
    '<script src="/../up.js"></script>',
    '<a href="/page.html">x</a>',
    '<script src="/real.js"></script>',
  ].join('\n');
  assert.deepStrictEqual(pageFiles(html), ['real.js']);
});

// Either side naming a file the other lacks is a bug: a tag whose file is not
// there 404s in every browser, a module nobody loads is dead code that still
// counts against the shared page scope.
test('every file the page names exists in the web directory', () => {
  const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');
  const named = pageFiles(html);
  assert.ok(named.length > 30, 'sanity: the page names its scripts, stylesheet and icon');
  const missing = named.filter((f) => !fs.existsSync(path.join(WEB, f)));
  assert.deepStrictEqual(missing, [], `app.html names files that are not in web/: ${missing.join(', ')}`);
});

// The diagram frame's script is loaded by the frame's own page, which the server names (FRAME_FILES), not by app.html.
test('every script in the web directory is loaded by the page', () => {
  const named = new Set([...pageFiles(fs.readFileSync(path.join(WEB, 'app.html'), 'utf8')), ...FRAME_FILES]);
  const idle = fs.readdirSync(WEB).filter((f) => f.endsWith('.js') && !named.has(f));
  assert.deepStrictEqual(idle, [], `web/ holds scripts the page never loads (add a tag to app.html, or delete the file): ${idle.join(', ')}`);
});

test('every file the page names answers 200 over HTTP', async () => {
  await serve(WEB, async (base) => {
    for (const f of pageFiles(fs.readFileSync(path.join(WEB, 'app.html'), 'utf8'))) {
      const res = await fetch(`${base}/${f}`);
      assert.strictEqual(res.status, 200, f);
      await res.text();
    }
  });
});

test('the page loads the slice module ahead of the scripts that read it, and the server serves it', async () => {
  await serve(WEB, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const scripts = [...html.matchAll(/<script src="\/([\w.-]+\.js)"><\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.includes('slices.js'), 'app.html loads slices.js');
    for (const reader of ['graph-model.js', 'graph-view.js', 'app.js']) {
      assert.ok(scripts.indexOf('slices.js') < scripts.indexOf(reader), `slices.js loads before ${reader}`);
    }
    const res = await fetch(`${base}/slices.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    assert.strictEqual(lf(await res.text()), lf(fs.readFileSync(path.join(WEB, 'slices.js'), 'utf8')));
  });
});

test('the page keeps its script order: app.js last, graph-view.js right before it, model files ahead of their views', async () => {
  await serve(WEB, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const scripts = [...html.matchAll(/<script src="\/([\w.-]+\.js)"><\/script>/g)].map((m) => m[1]);
    assert.strictEqual(scripts[scripts.length - 1], 'app.js');
    assert.strictEqual(scripts[scripts.length - 2], 'graph-view.js');
    const before = (a, b) => assert.ok(scripts.indexOf(a) > -1 && scripts.indexOf(a) < scripts.indexOf(b), `${a} loads before ${b}`);
    before('waiting-blocked.js', 'dependency-graph.js');
    before('calendar-model.js', 'gantt-model.js');
    before('gantt-model.js', 'graph-model.js');
    before('graph-flow.js', 'graph-model.js');
    before('graph-model.js', 'graph-view.js');
    before('graph-model.js', 'graph-names.js');
    before('graph-names.js', 'graph-view.js');
    before('map-relations.js', 'graph-model.js');
    assert.strictEqual(new Set(scripts).size, scripts.length, 'no script loads twice');
  });
});

test('the page loads the type icons module ahead of the type chip and the Graph, and the server serves it', async () => {
  await serve(WEB, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const scripts = [...html.matchAll(/<script src="\/([\w.-]+\.js)"><\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.includes('type-icons.js'), 'app.html loads type-icons.js');
    for (const reader of ['type-badge.js', 'graph-model.js', 'graph-view.js', 'app.js']) {
      assert.ok(scripts.indexOf('type-icons.js') < scripts.indexOf(reader), `type-icons.js loads before ${reader}`);
    }
    const res = await fetch(`${base}/type-icons.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    assert.strictEqual(lf(await res.text()), lf(fs.readFileSync(path.join(WEB, 'type-icons.js'), 'utf8')));
  });
});
