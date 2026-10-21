const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const codeLibs = require('../../web/web/code-libs');
const { BOARD, lf, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

// The snapshot embeds code-libs.js, which says which library a typed block needs, and loads the two
// libraries from cdnjs, at the versions kanban-web vendors, the first time a block needs one and never
// otherwise. The page runs in the harness with the libraries played by hand.

const source = lf(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'web', 'code-libs.js'), 'utf8'));
const CDN = codeLibs.cdnUrls();

const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function open(fn) {
  withSnapshot(BOARD, (html) => fn(loadPage(html), html));
}

const body = (page, text) => page.run(`document.body.appendChild(mdBodyNode(${JSON.stringify(text)}, "fixture"))`);
const inHead = (page, tag) => page.run('document.head').all().filter((n) => n.tagName === tag);
const scripts = (page) => inHead(page, 'SCRIPT');
const sheets = (page) => inHead(page, 'LINK');

test('the built page carries the module byte for byte, once, and pins the versions kanban-web vendors', () => {
  withSnapshot(BOARD, (html) => {
    const at = html.indexOf(source);
    assert.ok(at !== -1 && html.indexOf(source, at + 1) === -1, 'once, verbatim');
    assert.ok(at < html.indexOf('const BASE='), 'ahead of the page script');
    const web = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'web', 'vendor', 'mermaid', 'mermaid.min.js'), 'utf8');
    assert.ok(web.includes(`"${codeLibs.MERMAID_VERSION}"`));
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

test('a typed block in a known language loads highlight.js and its themes from cdnjs once, then is coloured', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '```c#\nvar x = 1;\n```\n\n```ts\nlet y;\n```');
    await flush();
    assert.deepStrictEqual(scripts(page).map((s) => s.src), [CDN.highlight]);
    assert.deepStrictEqual(sheets(page).map((l) => [l.rel, l.href]), [['stylesheet', CDN.light], ['stylesheet', CDN.dark]]);
    page.run('window.hljs={done:[],highlightElement(el){this.done.push(el.className);el.className+=" hljs"}}');
    scripts(page)[0].onload();
    await flush();
    assert.deepStrictEqual(page.plain(page.run('hljs.done')), ['language-csharp', 'language-typescript']);
    const code = wrap.all().filter((n) => n.tagName === 'CODE');
    assert.strictEqual(code[0].textContent, 'var x = 1;', 'the text is the code, as copied');
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

test('a mermaid block loads mermaid from cdnjs, and not highlight.js', async () => {
  await new Promise((resolve) => open(async (page) => {
    body(page, '```mermaid\ngraph TD; A-->B;\n```');
    await flush();
    assert.deepStrictEqual(scripts(page).map((s) => s.src), [CDN.mermaid]);
    assert.deepStrictEqual(sheets(page), []);
    resolve();
  }));
});

test('mermaid runs with its strict security level on the block\'s text, and the diagram replaces the block', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '```mermaid\ngraph TD; A-->B;\n```');
    await flush();
    page.run('window.mermaid={calls:[],initialize(o){this.calls.push(["init",o.securityLevel,o.theme,o.startOnLoad])},run(o){this.calls.push(["run",o.nodes[0].textContent,o.nodes[0].className]);return Promise.resolve()}}');
    scripts(page)[0].onload();
    await flush();
    assert.deepStrictEqual(page.plain(page.run('mermaid.calls')), [['init', 'strict', 'default', false], ['run', 'graph TD; A-->B;', 'mermaid md-diagram']]);
    const box = wrap.all().find((n) => n.classList.contains('md-code'));
    assert.strictEqual(box.hidden, true, 'the block is replaced by the diagram');
    resolve();
  }));
});

test('a diagram that does not parse leaves the labelled block with a one-line error under it', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '```mermaid\nnot a diagram\n```\n\nafter');
    await flush();
    page.run('window.mermaid={initialize(){},run(){return Promise.reject(new Error("Parse error on line 1\\nmore detail"))}}');
    scripts(page)[0].onload();
    await flush();
    const box = wrap.all().find((n) => n.classList.contains('md-code'));
    assert.ok(!box.hidden, 'the block stays');
    const note = wrap.all().find((n) => n.classList.contains('md-diagram-error'));
    assert.strictEqual(note.textContent, 'Diagram error: Parse error on line 1');
    assert.strictEqual(wrap.all().filter((n) => n.classList.contains('md-diagram')).length, 0, 'and no empty diagram is left behind');
    assert.ok(wrap.all().some((n) => n.tagName === 'P' && n.textContent === 'after'), 'the rest of the body is drawn');
    resolve();
  }));
});

test('when a library cannot be loaded the blocks stay plain', async () => {
  await new Promise((resolve) => open(async (page) => {
    const wrap = body(page, '```ts\nlet a;\n```\n\n```mermaid\ngraph TD; A-->B;\n```');
    await flush();
    for (const s of scripts(page)) s.onerror();
    await flush();
    assert.ok(wrap.all().some((n) => n.classList.contains('md-code-copy')));
    assert.ok(wrap.all().some((n) => n.classList.contains('md-diagram-error')));
    resolve();
  }));
});

test('the markup names no address to load: the libraries are asked for by the script, when needed', () => {
  withSnapshot(BOARD, (html) => {
    assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no script element in the markup names an address');
    assert.ok(!/<link[^>]*\shref="https?:/i.test(html), 'and no link does');
  });
});

test('a dark page draws the diagram with the dark theme, and an explicit light choice on the root wins over the system\'s', async () => {
  await new Promise((resolve) => withSnapshot(BOARD, async (html) => {
    const page = loadPage(html, { matchMedia: (q) => q.includes('dark') });
    body(page, '```mermaid\ngraph TD; A-->B;\n```');
    await flush();
    page.run('window.mermaid={themes:[],initialize(o){this.themes.push(o.theme)},run(){return Promise.resolve()}}');
    scripts(page)[0].onload();
    await flush();
    assert.deepStrictEqual(page.plain(page.run('mermaid.themes')), ['dark']);

    const light = loadPage(html, { matchMedia: (q) => q.includes('dark') });
    light.run('document.documentElement.setAttribute("data-theme","light")');
    body(light, '```ts\nlet a;\n```');
    await flush();
    assert.deepStrictEqual(sheets(light).map((l) => l.disabled), [false, true]);
    resolve();
  }));
});

test('a diagram in a closed section waits for the section to open', async () => {
  await new Promise((resolve) => open(async (page) => {
    body(page, '<details>\n<summary>s</summary>\n```mermaid\ngraph TD; A-->B;\n```\n</details>');
    await flush();
    assert.deepStrictEqual(scripts(page), [], 'closed: mermaid is not asked for');
    const details = page.run('document.body').all().find((n) => n.tagName === 'DETAILS');
    details.open = true;
    for (const fn of details.listeners.toggle || []) fn({ target: details });
    await flush();
    assert.deepStrictEqual(scripts(page).map((s) => s.src), [CDN.mermaid]);
    resolve();
  }));
});
