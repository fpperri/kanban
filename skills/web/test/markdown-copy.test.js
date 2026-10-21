const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The Copy button of a typed code block copies the block's text, not its label, through one
// delegated listener, so it works wherever the renderer is used. This runs the real function
// from app.js against a stand-in button and clipboard.
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const fn = appSrc.match(/function copyCodeBlock\([\s\S]*?\n\}/);

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
  const sandbox = {
    navigator: { clipboard },
    fallbackCopy: (t) => { copied.push(['fallback', t]); return true; },
    setTimeout: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(fn[0], sandbox);
  return { copyCodeBlock: sandbox.copyCodeBlock, copied };
}

test('the Copy button copies the code of its own block and says so', async () => {
  assert.ok(fn, 'copyCodeBlock is defined in app.js');
  const written = [];
  const { copyCodeBlock } = run({ writeText: (t) => { written.push(t); return Promise.resolve(); } });
  const btn = buttonFor('var x = 1;\nvar y = 2;');
  copyCodeBlock(btn);
  await Promise.resolve();
  assert.deepStrictEqual(written, ['var x = 1;\nvar y = 2;']);
  assert.strictEqual(btn.textContent, 'Copied');
  assert.ok(btn.classList.has('copy-success'));
});

test('when the clipboard refuses, the textarea fallback copies it and the button still answers', async () => {
  const { copyCodeBlock, copied } = run({ writeText: () => Promise.reject(new Error('denied')) });
  const btn = buttonFor('code');
  copyCodeBlock(btn);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(copied, [['fallback', 'code']]);
  assert.strictEqual(btn.textContent, 'Copied');
});

test('with no clipboard API at all the fallback copies', () => {
  const { copyCodeBlock, copied } = run(undefined);
  copyCodeBlock(buttonFor('code'));
  assert.deepStrictEqual(copied, [['fallback', 'code']]);
});

test('one document listener serves every Copy button', () => {
  assert.match(appSrc, /document\.addEventListener\('click', \(e\) => \{\s*const btn = e\.target\.closest\('\.md-code-copy'\);\s*if \(btn\) copyCodeBlock\(btn\);/);
});
