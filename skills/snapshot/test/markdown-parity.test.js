const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mdToHtml } = require('../../web/web/markdown');
const { BOARD, lf, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');
const { FIXTURE } = require('./markdown-fixture');
const { nodesToHtml, webToHtml } = require('./markdown-html');

// The snapshot embeds kanban-web's markdown.js and draws its parse as DOM nodes; kanban-web draws
// the same parse as an HTML string. Two drawing steps over one parse can still drift, so one body
// with every construct goes through both and the results must be the same markup.

const source = lf(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'web', 'markdown.js'), 'utf8'));

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
    'data-lang="mermaid"', 'class="md-table"', 'class="ta-center"', '<hr>', '<br>', '<del>', '<u>', '<em><strong>', 'class="mention"', '<details><summary>', '<details open>']) {
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
