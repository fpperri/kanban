const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const codeLibs = require('../../plugin/skills/web/web/code-libs');
const { BOARD, buildScript, lf, withSnapshot, writeBoard } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

// The snapshot embeds code-libs.js and code-blocks.js, the loader kanban-web uses too, and hands it
// cdnjs for highlight.js (loaded into the page) and jsDelivr for mermaid, which is never loaded into the
// page: a diagram is drawn in a sandboxed frame the page makes from a srcdoc. Every address carries the
// integrity hash of the vendored file. The page runs in the harness with the libraries played by hand.

const webDir = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const source = (file) => lf(fs.readFileSync(path.join(webDir, file), 'utf8'));
const vendored = (...parts) => fs.readFileSync(path.join(webDir, 'vendor', ...parts));
const sri = (bytes) => `sha384-${crypto.createHash('sha384').update(bytes).digest('base64')}`;
const HL = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${codeLibs.HIGHLIGHT_VERSION}`;
const MERMAID = `https://cdn.jsdelivr.net/npm/mermaid@${codeLibs.MERMAID_VERSION}/dist/mermaid.min.js`;

const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function open(fn, opts) {
  withSnapshot(BOARD, (html) => fn(loadPage(html, opts), html));
}

const body = (page, text) => page.run(`document.body.appendChild(mdBodyNode(${JSON.stringify(text)}, "fixture"))`);
const inHead = (page, tag) => page.run('document.head').all().filter((n) => n.tagName === tag);
const scripts = (page) => inHead(page, 'SCRIPT');
const sheets = (page) => inHead(page, 'LINK');
const frames = (wrap) => wrap.all().filter((n) => n.tagName === 'IFRAME');

test('the built page carries both modules byte for byte, once each, ahead of the page script', () => {
  withSnapshot(BOARD, (html) => {
    for (const file of ['code-libs.js', 'code-blocks.js']) {
      const text = source(file);
      const at = html.indexOf(text);
      assert.ok(at !== -1 && html.indexOf(text, at + 1) === -1, `${file}: once, verbatim`);
      assert.ok(at < html.indexOf('const BASE='), `${file}: ahead of the page script`);
    }
  });
});

test('a card with no typed block makes no request for code', async () => {
  await new Promise((resolve) => open(async (page) => {
    body(page, '# Plain\n\n```\nuntyped\n```\n\n```klingon\nunknown\n```\n\n```text\nplain text\n```');
    await flush();
    assert.deepStrictEqual(scripts(page).concat(sheets(page)), []);
    resolve();
  }));
});

test('the page\'s own render asks for nothing', async () => {
  await new Promise((resolve) => open(async (page) => {
    await flush();
    assert.deepStrictEqual(scripts(page).concat(sheets(page)), []);
    resolve();
  }));
});

// --- highlight.js, from cdnjs, into the page ---------------------------------------------------

test('a typed block in a known language loads highlight.js and its themes from cdnjs once, each under its integrity hash, then is coloured', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '```c#\nvar x = 1;\n```\n\n```ts\nlet y;\n```');
    await flush();
    const [script] = scripts(page);
    assert.strictEqual(scripts(page).length, 1);
    assert.deepStrictEqual([script.src, script.integrity, script.crossOrigin], [`${HL}/highlight.min.js`, sri(vendored('highlight.js', 'highlight.min.js')), 'anonymous']);
    assert.deepStrictEqual(sheets(page).map((l) => [l.rel, l.href, l.integrity, l.crossOrigin]), [
      ['stylesheet', `${HL}/styles/github.min.css`, sri(vendored('highlight.js', 'github.min.css')), 'anonymous'],
      ['stylesheet', `${HL}/styles/github-dark.min.css`, sri(vendored('highlight.js', 'github-dark.min.css')), 'anonymous'],
    ]);
    page.run('window.hljs={done:[],highlightElement(el){this.done.push(el.className);el.className+=" hljs"}}');
    script.onload();
    await flush();
    assert.deepStrictEqual(page.plain(page.run('hljs.done')), ['language-csharp', 'language-typescript']);
    assert.strictEqual(wrap.all().filter((n) => n.tagName === 'CODE')[0].textContent, 'var x = 1;', 'the text is the code, as copied');
    resolve();
  }));
});

test('highlight.js is not asked for twice, however many cards use it', async () => {
  await new Promise((resolve) => open(async (page) => {
    body(page, '```json\n{}\n```');
    await flush();
    body(page, '```sql\nselect 1\n```');
    await flush();
    assert.strictEqual(scripts(page).length, 1);
    resolve();
  }));
});

test('a dark page picks the dark theme and an explicit light choice on the root wins over the system\'s', async () => {
  await new Promise((resolve) => withSnapshot(BOARD, async (html) => {
    const dark = loadPage(html, { matchMedia: (q) => q.includes('dark') });
    body(dark, '```ts\nlet a;\n```');
    await flush();
    assert.deepStrictEqual(sheets(dark).map((l) => l.disabled), [true, false]);

    const light = loadPage(html, { matchMedia: (q) => q.includes('dark') });
    light.run('document.documentElement.setAttribute("data-theme","light")');
    body(light, '```ts\nlet a;\n```');
    await flush();
    assert.deepStrictEqual(sheets(light).map((l) => l.disabled), [false, true]);
    resolve();
  }));
});

// --- mermaid: a sandboxed frame, and never the page ---------------------------------------------------

test('a mermaid block makes a sandboxed frame from a srcdoc, and loads no library into the page', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '```mermaid\ngraph TD; A-->B;\n```');
    await flush();
    assert.deepStrictEqual(scripts(page).concat(sheets(page)), [], 'neither mermaid nor highlight.js is a script of the page');
    const [frame] = frames(wrap);
    assert.strictEqual(frames(wrap).length, 1);
    assert.strictEqual(frame.getAttribute('sandbox'), 'allow-scripts', 'scripts only: no same-origin');
    assert.strictEqual(frame.src, undefined, 'the frame has no address of its own');
    assert.strictEqual(typeof frame.srcdoc, 'string');
    resolve();
  }));
});

test('the frame loads mermaid from jsDelivr under the vendored file\'s integrity hash, and runs the same script kanban-web\'s frame does', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '```mermaid\ngraph TD; A-->B;\n```');
    await flush();
    const { srcdoc } = frames(wrap)[0];
    assert.ok(srcdoc.includes(`<script src="${MERMAID}" integrity="${sri(vendored('mermaid', 'mermaid.min.js'))}" crossorigin="anonymous"></script>`));
    assert.ok(srcdoc.includes(`<script>${source('mermaid-frame.js')}</script>`), 'one frame script, inlined');
    assert.ok(srcdoc.indexOf(MERMAID) < srcdoc.indexOf("securityLevel: 'strict'"), 'the library is read before the script that uses it');
    assert.ok(!srcdoc.includes('/vendor/') && !srcdoc.includes('/mermaid-frame.js'), 'and nothing is read from the board\'s server');
    assert.ok(srcdoc.includes("securityLevel: 'strict'"));
    resolve();
  }));
});

test('the page script never touches mermaid itself', () => {
  const py = fs.readFileSync(buildScript, 'utf8');
  assert.doesNotMatch(py, /mermaid\.(run|render|initialize|parse)|window\.mermaid|startOnLoad/);
});

test('the frame is asked to draw when it says it is ready, and a drawn diagram replaces the block at the height it reports', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '```mermaid\ngraph TD; A-->B;\n```');
    await flush();
    const [frame] = frames(wrap);
    const posted = [];
    frame.contentWindow = { postMessage: (m, target) => posted.push([m, target]) };
    const box = wrap.all().find((n) => n.classList.contains('md-code'));
    page.message({ source: frame.contentWindow, data: { type: 'ready' } });
    assert.strictEqual(posted.length, 1);
    assert.deepStrictEqual({ ...posted[0][0] }, { type: 'render', id: posted[0][0].id, source: 'graph TD; A-->B;', theme: 'light' });
    assert.strictEqual(posted[0][1], '*');
    page.message({ source: frame.contentWindow, data: { type: 'rendered', id: posted[0][0].id, height: 180 } });
    assert.strictEqual(box.hidden, true);
    assert.strictEqual(frame.style.height, '180px');
    resolve();
  }));
});

test('a diagram that does not parse leaves the labelled block with a one-line error under it', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '```mermaid\nnot a diagram\n```\n\nafter');
    await flush();
    const [frame] = frames(wrap);
    frame.contentWindow = { postMessage() {} };
    page.message({ source: frame.contentWindow, data: { type: 'ready' } });
    page.message({ source: frame.contentWindow, data: { type: 'error', id: 1, message: 'Parse error on line 1' } });
    const box = wrap.all().find((n) => n.classList.contains('md-code'));
    assert.ok(!box.hidden, 'the block stays');
    const note = wrap.all().find((n) => n.classList.contains('md-diagram-error'));
    assert.strictEqual(note.textContent, 'Diagram error: Parse error on line 1');
    assert.strictEqual(frames(wrap).length, 0, 'and the frame is gone');
    assert.ok(wrap.all().some((n) => n.tagName === 'P' && n.textContent === 'after'), 'the rest of the body is drawn');
    resolve();
  }));
});

test('a diagram in a closed section waits for the section to open', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '<details>\n<summary>s</summary>\n```mermaid\ngraph TD; A-->B;\n```\n</details>');
    await flush();
    assert.strictEqual(frames(wrap).length, 0, 'closed: no frame');
    const details = wrap.all().find((n) => n.tagName === 'DETAILS');
    details.open = true;
    page.layout();
    assert.strictEqual(frames(wrap).length, 1);
    resolve();
  }));
});

// --- the integrity pins -----------------------------------------------------------------------------------

test('the page carries the sha384 of each vendored file, so a CDN copy that differs is refused by the browser', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const config = page.plain(page.run('CODE_CONFIG'));
    assert.strictEqual(config.highlight.integrity, sri(vendored('highlight.js', 'highlight.min.js')));
    assert.strictEqual(config.sheets.light.integrity, sri(vendored('highlight.js', 'github.min.css')));
    assert.strictEqual(config.sheets.dark.integrity, sri(vendored('highlight.js', 'github-dark.min.css')));
    assert.ok(config.frame.srcdoc.includes(sri(vendored('mermaid', 'mermaid.min.js'))));
    // Pinned in the test too, so re-vendoring a library is a visible change here and not only in the build.
    assert.strictEqual(sri(vendored('mermaid', 'mermaid.min.js')), 'sha384-8xUhuLNMjW/cI2Dacg3DR4WliYznvIg0LVG1stctThKD/YVrJFI9TNCFxft5NYgp');
    assert.strictEqual(sri(vendored('highlight.js', 'highlight.min.js')), 'sha384-wjfDDhOPPdjtva8vWBhWeVprSpmxisEu5aYT3q1JyACqXpdKpo3PWZTMVq24MBix');
    assert.strictEqual(sri(vendored('highlight.js', 'github.min.css')), 'sha384-eFTL69TLRZTkNfYZOLM+G04821K1qZao/4QLJbet1pP4tcF+fdXq/9CdqAbWRl/L');
    assert.strictEqual(sri(vendored('highlight.js', 'github-dark.min.css')), 'sha384-wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH');
  });
});

test('every address is on cdnjs or jsDelivr, at the versions kanban-web vendors', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const config = page.plain(page.run('CODE_CONFIG'));
    const urls = [config.highlight.src, config.sheets.light.href, config.sheets.dark.href];
    for (const u of urls) assert.ok(u.startsWith(`https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${codeLibs.HIGHLIGHT_VERSION}/`), u);
    assert.ok(config.frame.srcdoc.includes(MERMAID));
  });
});

test('the markup names no address to load: the libraries are asked for by the script, when needed', () => {
  withSnapshot(BOARD, (html) => {
    const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '');
    assert.ok(!/<script/i.test(markup), 'every script element of the page is inline');
    assert.ok(!/<link[^>]*\shref="https?:/i.test(markup), 'and no link names an address');
  });
});

// --- the build refuses what it cannot pin ---------------------------------------------------------------------------

// The build runs from a copy of the scripts folder beside a copy of the web modules, one of them altered.
function buildWithAltered(file, alter) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-code-'));
  try {
    const script = path.join(root, 'snapshot', 'scripts', 'build_editor.py');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(buildScript, script);
    fs.copyFileSync(path.join(path.dirname(buildScript), 'ids.py'), path.join(path.dirname(script), 'ids.py'));
    fs.cpSync(webDir, path.join(root, 'web', 'web'), { recursive: true });
    const target = path.join(root, 'web', 'web', ...file);
    const altered = alter(fs.readFileSync(target, 'utf8'));
    if (altered === null) fs.rmSync(target); else fs.writeFileSync(target, altered);
    const board = path.join(root, 'board');
    fs.mkdirSync(board);
    writeBoard(board, BOARD);
    try {
      execFileSync('python', ['-B', script, board, '--out', path.join(root, 'out.html')], { encoding: 'utf8', stdio: 'pipe' });
      return { built: true, stderr: '' };
    } catch (e) {
      return { built: false, stderr: String(e.stderr) };
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the build stops when a vendored library is missing, and when the frame page does not name its scripts as expected', () => {
  const missing = buildWithAltered(['vendor', 'mermaid', 'mermaid.min.js'], () => null);
  assert.strictEqual(missing.built, false);
  assert.match(missing.stderr, /cannot read the vendored library/);
  const odd = buildWithAltered(['mermaid-frame.html'], (text) => text.replace('<script src="/mermaid-frame.js"></script>', ''));
  assert.strictEqual(odd.built, false);
  assert.match(odd.stderr, /does not name its two scripts/);
});

test('a script tag in the code modules or the frame cannot end the page\'s script', () => {
  const result = buildWithAltered(['code-blocks.js'], (text) => `${text}\nconst odd = "</script>";\n`);
  assert.strictEqual(result.built, false);
  assert.match(result.stderr, /code blocks module contains a closing script tag/);
});
