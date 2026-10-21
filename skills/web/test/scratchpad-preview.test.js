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

function panel({ body = '', refs = [], navigator = {} } = {}) {
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
    notesUi: { el: { contains: () => false }, tab: 'scratch' },
    settingsAddBoardPage() {},
    textEditAttach: (box) => { sandbox.attached = box; }, // text-edit-ui.js: the Edit box takes Tab and the Markdown keys; kept so a test can say it has the focus
    $: () => ({ addEventListener() {} }),
    mdToHtml,
    kanbanCodeLibs: { HIGHLIGHT_VERSION: '1.0.0' },
    enhanced: [],
    kanbanCodeBlocks: { createCodeBlocks: () => ({ enhance: (el) => sandbox.enhanced.push(el.hidden) }) },
    console,
    fallbackCopy: () => true,
    navigator,
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
  return { wrap, one, saved, settled, enhanced: sandbox.enhanced, sandbox };
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

// --- Ctrl+Shift+V -------------------------------------------------------------------------------

const chord = (over = {}) => ({ key: 'V', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, repeat: false, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...over });
const press = (p, over) => {
  p.wrap.isConnected = !p.detached; // the page's panel sits in the palette; a test detaches it to say the palette dropped it
  const e = chord(over);
  const took = p.sandbox.scratchPreviewKey(e);
  return { e, took };
};
const spyFocus = (el) => { const log = []; el.focus = (o) => log.push(o); return log; };

test('Ctrl+Shift+V switches Edit to Preview and back, and takes the key from the browser', async () => {
  const p = panel({ body: '# Hello' });
  await p.settled();
  const first = press(p);
  assert.strictEqual(first.took, true);
  assert.strictEqual(first.e.defaultPrevented, true);
  assert.strictEqual(first.e.stopped, true, 'the key stays in the palette');
  assert.strictEqual(p.one('sp-preview').hidden, false);
  assert.strictEqual(p.one('sp-text').hidden, true);
  assert.strictEqual(p.one('sp-preview').innerHTML, '<h1>Hello</h1>');
  press(p);
  assert.strictEqual(p.one('sp-preview').hidden, true);
  assert.strictEqual(p.one('sp-text').hidden, false);
  const [edit, preview] = byClass(p.wrap, 'sp-mode');
  assert.strictEqual(edit.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(preview.getAttribute('aria-pressed'), 'false');
});

test('the key follows the switch when it was pressed with the mouse', async () => {
  const p = panel({ body: 'x' });
  await p.settled();
  byClass(p.wrap, 'sp-mode')[1].fire('click');
  press(p);
  assert.strictEqual(p.one('sp-text').hidden, false, 'Preview was showing, so the key goes back to Edit');
});

test('Cmd+Shift+V is the same key', async () => {
  const p = panel({ body: 'x' });
  await p.settled();
  assert.strictEqual(press(p, { ctrlKey: false, metaKey: true }).took, true);
  assert.strictEqual(p.one('sp-preview').hidden, false);
});

test('Edit by the key puts the focus in the box with the cursor at the end of its text', async () => {
  const p = panel({ body: 'one two' });
  await p.settled();
  const text = p.one('sp-text');
  const focus = spyFocus(text);
  let selection = null;
  text.setSelectionRange = (a, b) => { selection = [a, b]; };
  press(p);
  press(p);
  assert.strictEqual(focus.length, 1);
  assert.deepStrictEqual(selection, [7, 7]);
});

test('Preview by the key from the box moves the focus to the preview, so the palette keys keep working', async () => {
  const p = panel({ body: 'x' });
  await p.settled();
  const focus = spyFocus(p.one('sp-preview'));
  p.sandbox.document.activeElement = p.sandbox.attached;
  press(p);
  assert.strictEqual(focus.length, 1);
});

test('the key is not taken on another tab, with a key besides, or before the page has loaded', async () => {
  const p = panel({ body: 'x' });
  const early = press(p);
  assert.strictEqual(early.took, false, 'the box is still disabled');
  assert.strictEqual(early.e.defaultPrevented, false);
  await p.settled();
  p.sandbox.notesUi.tab = 'notes';
  assert.strictEqual(press(p).took, false);
  p.sandbox.notesUi.tab = 'scratch';
  for (const over of [{ shiftKey: false }, { ctrlKey: false }, { altKey: true }, { repeat: true }, { key: 'C' }]) {
    const r = press(p, over);
    assert.strictEqual(r.took, false, JSON.stringify(over));
    assert.strictEqual(r.e.defaultPrevented, false);
  }
  assert.strictEqual(p.one('sp-preview').hidden, true, 'nothing switched');
});

test('both buttons show the key as a hint outside their name, and name it for assistive technology', async () => {
  const p = panel({ body: 'x' });
  for (const b of byClass(p.wrap, 'sp-mode')) {
    assert.strictEqual(b.dataset.key, 'Ctrl+Shift+V');
    assert.strictEqual(b.getAttribute('aria-keyshortcuts'), 'Control+Shift+V Meta+Shift+V');
  }
  assert.deepStrictEqual(byClass(p.wrap, 'sp-mode').map((b) => b.textContent), ['Edit', 'Preview'], 'the name stays the word');
  assert.deepStrictEqual(byClass(p.wrap, 'sp-mode').map((b) => b.title), ['Edit (Ctrl+Shift+V)', 'Preview (Ctrl+Shift+V)']);
});

test('the stylesheet draws the hint after the name with an empty alternative text, as the tab hints are', () => {
  const css = read('app.css');
  assert.match(css, /\.sp-mode::after \{[^}]*content: attr\(data-key\) \/ "";/);
});

test('a panel the palette has dropped, as when the gear turns the scratchpad off, gives the key back to the browser', async () => {
  const p = panel({ body: 'x' });
  await p.settled();
  press(p);
  press(p);
  p.detached = true;
  const r = press(p);
  assert.strictEqual(r.took, false);
  assert.strictEqual(r.e.defaultPrevented, false);
  assert.strictEqual(p.one('sp-preview').hidden, true, 'nothing switched');
  assert.strictEqual(vm.runInContext('scratchUi.toggle', p.sandbox), null, 'and the stale switch is forgotten');
});

test('the buttons list both modifiers for assistive technology, whatever the platform', () => {
  for (const navigator of [{}, { platform: 'MacIntel' }]) {
    const p = panel({ navigator });
    for (const b of byClass(p.wrap, 'sp-mode')) assert.strictEqual(b.getAttribute('aria-keyshortcuts'), 'Control+Shift+V Meta+Shift+V');
  }
});

test('on a Mac the hints and titles read Cmd+Shift+V, from the platform or the user agent data; elsewhere Ctrl+Shift+V', () => {
  const MAC = [{ platform: 'MacIntel' }, { platform: '', userAgentData: { platform: 'macOS' } }];
  for (const navigator of MAC) {
    const p = panel({ navigator });
    assert.deepStrictEqual(byClass(p.wrap, 'sp-mode').map((b) => b.dataset.key), ['Cmd+Shift+V', 'Cmd+Shift+V']);
    assert.deepStrictEqual(byClass(p.wrap, 'sp-mode').map((b) => b.title), ['Edit (Cmd+Shift+V)', 'Preview (Cmd+Shift+V)']);
  }
  for (const navigator of [{}, { platform: 'Win32' }, { platform: 'Linux x86_64', userAgentData: { platform: 'Linux' } }]) {
    const p = panel({ navigator });
    assert.deepStrictEqual(byClass(p.wrap, 'sp-mode').map((b) => b.dataset.key), ['Ctrl+Shift+V', 'Ctrl+Shift+V']);
  }
});
