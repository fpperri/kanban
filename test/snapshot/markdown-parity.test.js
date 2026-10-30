const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mdToHtml } = require('../../plugin/skills/web/web/markdown');
const { BOARD, lf, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');
const { FIXTURE } = require('./markdown-fixture');
const { nodesToHtml, webToHtml } = require('./markdown-html');

// The snapshot embeds kanban-web's markdown.js and draws its parse as DOM nodes; kanban-web draws
// the same parse as an HTML string. Two drawing steps over one parse can still drift, so one body
// with every construct goes through both and the results must be the same markup.

const source = lf(fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'markdown.js'), 'utf8'));

test('the built page carries the Markdown module byte for byte, once, ahead of the page script', () => {
  withSnapshot(BOARD, (html) => {
    const at = html.indexOf(source);
    assert.ok(at !== -1, 'the module source is in the page verbatim');
    assert.strictEqual(html.indexOf(source, at + 1), -1, 'and only once');
    assert.ok(at < html.indexOf('const BASE='), 'it loads before the page script that uses it');
    const open = html.lastIndexOf('<script>', at);
    assert.ok(open !== -1 && html.slice(open + '<script>'.length, at).trim() === '', 'it opens its own script element');
    assert.ok(html.slice(at + source.length).startsWith('</script>'), 'and that element holds nothing else');
  });
});

test('the snapshot draws every construct of the fixture as the web does', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const body = page.run(`mdBodyNode(${JSON.stringify(FIXTURE)}, "fixture")`);
    const drawn = body.children.map(nodesToHtml).join('');
    const web = webToHtml(mdToHtml(FIXTURE, { board: 'fixture' }));
    assert.strictEqual(drawn, web);
  });
});

test('the fixture reaches every block kind the parse has', () => {
  const html = mdToHtml(FIXTURE, { board: 'fixture' });
  for (const marker of ['<h1>', '<h6>', '<ol>', '<ol start="3">', '<ul>', 'class="task done"', '<blockquote>', '<pre><code>', 'data-lang="c#"',
    'data-lang="mermaid"', 'class="md-table"', 'class="ta-center"', '<hr>', '<br>', '<del>', '<u>', '<em><strong>', 'class="mention"', '<details><summary>', '<details open>', '<li><p>loose a</p></li>', 'quoted <strong>bold</strong> and lazily continued']) {
    assert.ok(html.includes(marker), `${marker} is in the fixture's HTML`);
  }
  assert.ok(!html.includes('<script') && !html.includes('<u onclick'), 'and nothing from it is live markup');
});

test('an address with a hostile scheme or tag draws as text in the snapshot', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const body = page.run('mdBodyNode("[a](javascript:alert(1)) <u onclick=x>y</u> <img src=x>", "fixture")');
    const drawn = body.children.map(nodesToHtml).join('');
    assert.ok(drawn.includes('href="#"'));
    assert.ok(!drawn.includes('<img') && !drawn.includes('<u onclick'));
  });
});

test('a typed block\'s Copy button copies its code and says so, without touching the tray\'s payload', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const written = [];
    page.run('navigator').clipboard.writeText = (t) => { written.push(t); return Promise.resolve(); };
    const body = page.run('mdBodyNode("```c#\\nvar x = 1;\\n```", "fixture")');
    const button = body.all().find((n) => n.classList.contains('md-code-copy'));
    assert.ok(button, 'a typed block has a Copy button');
    assert.strictEqual(button.textContent, 'Copy');
    for (const fn of button.listeners.click) fn({ target: button, stopPropagation() {} });
    assert.deepStrictEqual(written, ['var x = 1;']);
    assert.strictEqual(page.run('copied'), false, 'the tray\'s copied hint is not set by a code copy');
  });
});

test('an untyped block has no label and no button', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const body = page.run('mdBodyNode("```\\nx\\n```", "fixture")');
    assert.strictEqual(body.all().filter((n) => n.classList.contains('md-code-copy')).length, 0);
    assert.strictEqual(body.children[0].tagName, 'PRE');
  });
});

test('a tree node of a kind the page does not know is drawn as its text, as a text node', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const blocks = page.run('mdBlockNodes([{ t: "mystery", text: "<img src=x>" }, { t: "p", inline: [{ t: "mystery", v: "<b>" }, { t: "text", v: "ok" }] }], "fixture")');
    assert.strictEqual(blocks[0].nodeType, 3);
    assert.strictEqual(blocks[0].data, '<img src=x>');
    assert.strictEqual(nodesToHtml(blocks[1]), '<p>&lt;b&gt;ok</p>');
  });
});

test('with no clipboard API a code block\'s Copy button copies through a box of its own and leaves nothing behind', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    page.run('navigator.clipboard = undefined; window.__cmds = []; document.execCommand = (c) => { window.__cmds.push(c); return true; }');
    const body = page.run(`mdBodyNode(${JSON.stringify('```c#\nvar x = 1;\n```')}, "fixture")`);
    const button = body.all().find((n) => n.classList.contains('md-code-copy'));
    for (const fn of button.listeners.click) fn({ target: button, stopPropagation() {} });
    assert.deepStrictEqual(page.plain(page.run('__cmds')), ['copy']);
    assert.strictEqual(button.textContent, 'Copied');
    assert.strictEqual(page.run('document.body').all().filter((n) => n.tagName === 'TEXTAREA').length, 0, 'the box it made is gone');
    assert.strictEqual(page.run('copied'), false);
  });
});

test('a refused copy says so on the button', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    page.run('navigator.clipboard = undefined; document.execCommand = () => false;');
    const body = page.run(`mdBodyNode(${JSON.stringify('```c#\nx\n```')}, "fixture")`);
    const button = body.all().find((n) => n.classList.contains('md-code-copy'));
    for (const fn of button.listeners.click) fn({ target: button, stopPropagation() {} });
    assert.strictEqual(button.textContent, 'Copy failed');
  });
});

test('an image in a body draws in the snapshot as the plain label the web draws with no card, and nothing is fetched', () => {
  const body = 'before ![Screenshot](../work/item%2012/3f2a.png) and ![](x/y.png) after [a](https://e.test) ![r](https://e.test/r.png)';
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const node = page.run(`mdBodyNode(${JSON.stringify(body)}, "fixture")`);
    const drawn = node.children.map(nodesToHtml).join('');
    assert.strictEqual(drawn, webToHtml(mdToHtml(body, { board: 'fixture' })));
    assert.ok(drawn.includes('<span class="md-img-alt">Screenshot</span>') && drawn.includes('<span class="md-img-alt">x/y.png</span>'));
    assert.ok(!drawn.includes('<img'));
  });
});
