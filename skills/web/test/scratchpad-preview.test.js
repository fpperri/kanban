const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { recordingDocument, byClass } = require('./helpers/recording-dom');
const { mdToHtml } = require('../web/markdown');

// The Scratchpad tab's Edit | Preview switch: Edit is the box as it always was and the default;
// Preview draws the box's text, saved or not, as Markdown with the same renderer the card body
// uses. The panel runs here in a vm against a stand-in page (recording elements, a fake api), the
// way the other page scripts' panels are read back.

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8').replace(/\r\n/g, '\n');

function panel({ body = '', refs = [] } = {}) {
  const saved = [];
  const sandbox = {
    document: recordingDocument(),
    window: { addEventListener() {} },
    state: { projectName: 'webapp', scratchpad: { folder: '.scratchpad', targets: [] } },
    api: async (method, url, data) => {
      if (method === 'PUT') { saved.push(data.body); return { pad: { file: 'x.md', exists: true, body: data.body, refs } }; }
      return { pad: { file: 'x.md', exists: false, body, refs } };
    },
    toast() {},
    loadBoard: async () => {},
    notesLabel: (t) => `#${t}`,
    notesTextNodes: () => [],
    notesUi: { el: { contains: () => false } },
    settingsAddBoardPage() {},
    $: () => ({ addEventListener() {} }),
    mdToHtml,
    kanbanCodeLibs: { HIGHLIGHT_VERSION: '1.0.0' },
    enhanced: [],
    kanbanCodeBlocks: { createCodeBlocks: () => ({ enhance: (el) => sandbox.enhanced.push(el.hidden) }) },
    console,
    fallbackCopy: () => true,
    navigator: {},
    setTimeout: () => 0,
  };
  sandbox.document.addEventListener = () => {};
  sandbox.document.activeElement = null;
  sandbox.document.body = {};
  vm.createContext(sandbox);
  vm.runInContext(read('markdown-ui.js'), sandbox);
  vm.runInContext(read('scratchpad-ui.js'), sandbox);
  const wrap = vm.runInContext('scratchPanel("7")', sandbox);
  wrap.isConnected = false;
  const settled = () => new Promise((r) => setImmediate(r));
  const one = (cls) => byClass(wrap, cls)[0];
  return { wrap, one, saved, settled, enhanced: sandbox.enhanced };
}

test('the tab opens on Edit: the box shows, the preview is hidden, Edit is the pressed button', async () => {
  const p = panel({ body: '# Hello' });
  await p.settled();
  assert.strictEqual(p.one('sp-text').hidden, false, 'the box is not hidden');
  assert.strictEqual(p.one('sp-preview').hidden, true);
  const [edit, preview] = byClass(p.wrap, 'sp-mode');
  assert.strictEqual(edit.textContent, 'Edit');
  assert.strictEqual(preview.textContent, 'Preview');
  assert.strictEqual(edit.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(preview.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(p.one('sp-preview').innerHTML, '', 'nothing is drawn until Preview is asked for');
});

test('Preview draws the box\'s text as Markdown and hides the box; Edit brings it back', async () => {
  const p = panel({ body: '# Hello\n\n- one\n- two' });
  await p.settled();
  const [edit, preview] = byClass(p.wrap, 'sp-mode');
  preview.fire('click');
  assert.strictEqual(p.one('sp-preview').innerHTML, '<h1>Hello</h1><ul><li>one</li><li>two</li></ul>');
  assert.strictEqual(p.one('sp-preview').hidden, false);
  assert.strictEqual(p.one('sp-text').hidden, true);
  assert.strictEqual(preview.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(edit.getAttribute('aria-pressed'), 'false');
  edit.fire('click');
  assert.strictEqual(p.one('sp-preview').hidden, true);
  assert.strictEqual(p.one('sp-text').hidden, false);
  assert.strictEqual(edit.getAttribute('aria-pressed'), 'true');
});

test('the preview shows what is in the box, saved or not', async () => {
  const p = panel({ body: 'saved text' });
  await p.settled();
  const text = p.one('sp-text');
  text.value = '**typed** since';
  text.fire('input');
  byClass(p.wrap, 'sp-mode')[1].fire('click');
  assert.strictEqual(p.one('sp-preview').innerHTML, '<p><strong>typed</strong> since</p>');
});

test('the preview draws code blocks with their label and Copy button, and a mention of this board as a chip', async () => {
  const p = panel({ body: '```c#\nvar x;\n```\n\nsee `webapp#12 a card`' });
  await p.settled();
  byClass(p.wrap, 'sp-mode')[1].fire('click');
  const html = p.one('sp-preview').innerHTML;
  assert.ok(html.includes('<span class="md-code-lang">c#</span>') && html.includes('class="md-code-copy"'));
  assert.ok(html.includes('data-card-id="12"'));
});

test('hostile text in the box is drawn as text', async () => {
  const p = panel({ body: '<img src=x onerror=alert(1)> [a](javascript:alert(1))' });
  await p.settled();
  byClass(p.wrap, 'sp-mode')[1].fire('click');
  const html = p.one('sp-preview').innerHTML;
  assert.ok(!html.includes('<img') && html.includes('href="#"'));
});

test('Preview waits for the page to load: it cannot be pressed before the box can be typed in', () => {
  const p = panel({ body: 'x' });
  assert.strictEqual(byClass(p.wrap, 'sp-mode')[1].disabled, true);
});

test('Save works from Preview and leaves the preview showing', async () => {
  const p = panel({ body: 'first' });
  await p.settled();
  p.one('sp-text').value = 'second';
  p.one('sp-text').fire('input');
  byClass(p.wrap, 'sp-mode')[1].fire('click');
  p.one('sp-save').fire('click');
  await p.settled();
  assert.deepStrictEqual(p.saved, ['second']);
  assert.strictEqual(p.one('sp-preview').hidden, false, 'the mode is the one the person chose');
  assert.strictEqual(p.one('sp-preview').innerHTML, '<p>second</p>');
});

test('the preview is shown before its text is drawn, so a diagram in it is measured where it sits', async () => {
  const p = panel({ body: '```mermaid\ngraph TD; A-->B;\n```' });
  await p.settled();
  byClass(p.wrap, 'sp-mode')[1].fire('click');
  assert.deepStrictEqual(p.enhanced, [false], 'the preview was not hidden when the colour and diagram pass ran');
});
