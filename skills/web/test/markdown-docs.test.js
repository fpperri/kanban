const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mdToHtml } = require('../web/markdown');

// docs/web.md says what the renderer draws and the web skill says how; the examples the docs give
// are held to the renderer, so a doc cannot promise what the page does not draw.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const docs = read('docs', 'web.md');
const skill = read('skills', 'web', 'SKILL.md');
const para = flat(docs.slice(docs.indexOf('**Markdown** —'), docs.indexOf('**Notes** —')));
const bullet = flat(skill.slice(skill.indexOf('- **Markdown body** —'), skill.indexOf('- **Frontmatter marks** —')));

test('docs/web.md names what a body, a scratchpad preview and the snapshot draw', () => {
  assert.ok(para.length > 900, 'the Markdown paragraph is found');
  for (const part of ['card popup', 'scratchpad\'s Preview', 'snapshot', '`#` to `######`', 'numbered', '`>` quotes', '`~~strike~~`', '`<u>underline</u>`', 'bare `https://`',
    'two trailing spaces', 'closes on a run of the same mark at least as long', '**Copy**', '`data-lang`', '`_+#.-`', '`<details>`', '`<details open>`', '`[...]`', 'escaped']) {
    assert.ok(para.includes(part), part);
  }
});

test('the web skill names the module, the one writer and the safety rules', () => {
  for (const part of ['markdownInto()', 'markdown-ui.js', 'markdown.js', 'parseMarkdown', 'escaping every piece of text', '`<u>…</u>`', '`<details open>`', 'swallows the rest of the body', '`data-lang`', '[A-Za-z0-9_+#.-]']) {
    assert.ok(bullet.includes(part), part);
  }
});

test('what the docs promise is what the renderer draws', () => {
  assert.strictEqual(mdToHtml('###### six'), '<h6>six</h6>');
  assert.strictEqual(mdToHtml('* a\n+ b'), '<ul><li>a</li><li>b</li></ul>');
  assert.strictEqual(mdToHtml('<details>\nx\n</details>'), '<details><summary>[...]</summary><p>x</p></details>');
  assert.ok(mdToHtml('<details open>\nx\n</details>').startsWith('<details open>'));
  assert.ok(mdToHtml('<details onclick=x>\nx\n</details>').startsWith('<p>&lt;details onclick=x&gt;'));
  assert.ok(mdToHtml('```c#\nx\n```').includes('data-lang="c#"'));
});

// --- the vendored libraries --------------------------------------------------------------

const libs = require('../web/code-libs');
const docsMd = flat(para + ' ' + docs.slice(docs.indexOf('Mermaid writes inline styles'), docs.indexOf('**Notes** —')));

test('the docs name both libraries, their licences, the pinned versions and the sandboxed frame', () => {
  for (const part of ['highlight.js', 'BSD-3', 'Mermaid', 'MIT', `mermaid ${libs.MERMAID_VERSION}`, `highlight.js ${libs.HIGHLIGHT_VERSION}`, 'skills/web/web/vendor', 'cdnjs.cloudflare.com',
    'only when a rendered body holds a block', 'sandbox allow-scripts', 'opaque origin', "securityLevel: 'strict'", 'postMessage', '`null`']) {
    assert.ok(docsMd.includes(part), part);
  }
});

test('package.json no longer says there are no dependencies at all: it names the two vendored libraries', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.description, /mermaid \(MIT\)/);
  assert.match(pkg.description, /highlight\.js \(BSD-3\)/);
  assert.doesNotMatch(pkg.description, /has no dependencies\./);
  assert.strictEqual(pkg.dependencies, undefined, 'and nothing is installed');
});

test('the README, SECURITY.md and the web skill describe the libraries and the frame', () => {
  assert.match(read('README.md'), /highlight\.js \(BSD-3\)[\s\S]*mermaid \(MIT\)/);
  assert.match(flat(read('SECURITY.md')), /Mermaid runs in a sandbox of its own[\s\S]*sandbox allow-scripts/);
  const wb = flat(skill);
  for (const part of ['enhanceCodeBlocks()', 'code-libs.js', 'mermaid-frame.html', 'sandbox="allow-scripts"', 'VENDORED', 'Diagram error:', 'cdnjs']) assert.ok(wb.includes(part), part);
  const snap = flat(read('skills', 'snapshot', 'SKILL.md'));
  assert.ok(snap.includes('cdnjs.cloudflare.com') && snap.includes(libs.MERMAID_VERSION) && snap.includes(libs.HIGHLIGHT_VERSION));
});
