const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The Copy button of a typed code block copies the block's text, not its label, through one
// delegated listener, so it works wherever the renderer is used. This runs the real functions
// from markdown-ui.js against a stand-in button, clipboard and document.
const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'markdown-ui.js'), 'utf8').replace(/\r\n/g, '\n');
const { mdToHtml } = require('../web/markdown.js');

function buttonFor(codeText) {
  const classes = new Set();
  return {
    textContent: 'Copy',
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), remove: (...c) => c.forEach((x) => classes.delete(x)), has: (c) => classes.has(c) },
    closest: () => ({ querySelector: () => ({ textContent: codeText }) }),
  };
}

function run(clipboard) {
  const copied = [];
  const listeners = [];
  const sandbox = {
    navigator: { clipboard },
    document: { addEventListener: (type, fn) => listeners.push([type, fn]) },
    fallbackCopy: (t) => { copied.push(['fallback', t]); return true; },
    setTimeout: () => 0,
    mdToHtml,
    state: { projectName: 'webapp' },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { sandbox, copied, listeners };
}

test('the Copy button copies the code of its own block and says so', async () => {
  const written = [];
  const { sandbox } = run({ writeText: (t) => { written.push(t); return Promise.resolve(); } });
  const btn = buttonFor('var x = 1;\nvar y = 2;');
  sandbox.copyCodeBlock(btn);
  await Promise.resolve();
  assert.deepStrictEqual(written, ['var x = 1;\nvar y = 2;']);
  assert.strictEqual(btn.textContent, 'Copied');
  assert.ok(btn.classList.has('copy-success'));
});

test('when the clipboard refuses, the textarea fallback copies it and the button still answers', async () => {
  const { sandbox, copied } = run({ writeText: () => Promise.reject(new Error('denied')) });
  const btn = buttonFor('code');
  sandbox.copyCodeBlock(btn);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(copied, [['fallback', 'code']]);
  assert.strictEqual(btn.textContent, 'Copied');
});

test('with no clipboard API at all the fallback copies', () => {
  const { sandbox, copied } = run(undefined);
  sandbox.copyCodeBlock(buttonFor('code'));
  assert.deepStrictEqual(copied, [['fallback', 'code']]);
});

test('one document listener serves every Copy button, and ignores a click anywhere else', () => {
  const written = [];
  const { listeners } = run({ writeText: (t) => { written.push(t); return Promise.resolve(); } });
  assert.deepStrictEqual(listeners.map(([type]) => type), ['click']);
  const [, onClick] = listeners[0];
  onClick({ target: { closest: (sel) => (sel === '.md-code-copy' ? buttonFor('the code') : null) } });
  assert.deepStrictEqual(written, ['the code'], 'a click on a Copy button starts a copy');
  onClick({ target: { closest: () => null } });
  assert.strictEqual(written.length, 1, 'a click elsewhere copies nothing');
});

test('markdownInto writes the rendered text into the element, with this board as the one whose mentions open', () => {
  const { sandbox } = run(undefined);
  const el = { innerHTML: '' };
  sandbox.markdownInto(el, 'see `webapp#4 t` and `other#4 t`');
  assert.ok(el.innerHTML.includes('class="mention same" data-card-id="4"'));
  assert.ok(el.innerHTML.includes('<code class="mention">other#4 t</code>'));
  sandbox.markdownInto(el, undefined);
  assert.strictEqual(el.innerHTML, '', 'no text is no markup');
});
