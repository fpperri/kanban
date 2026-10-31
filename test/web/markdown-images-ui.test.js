const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mdToHtml } = require('../../plugin/skills/web/web/markdown.js');

// How the page draws a card's Markdown images: markdownInto asks markdown-images.js for the address of
// each picture when it is given a card, and one capturing document listener swaps a picture that
// failed (a refused path, a missing file) for the plain alt label, since the CSP has no unsafe-inline
// and an onerror attribute would be dropped.
const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (name) => fs.readFileSync(path.join(WEB, name), 'utf8').replace(/\r\n/g, '\n');

function load(source = null) {
  const listeners = [];
  const sandbox = {
    document: { addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) },
    mdToHtml,
    mdInlineToHtml: () => '',
    console,
    kanbanCodeLibs: {},
    kanbanCodeBlocks: { createCodeBlocks: () => ({ enhance() {} }) },
    state: { projectName: 'webapp', source },
    encodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(read('markdown-ui.js'), sandbox);
  vm.runInContext(read('markdown-images.js'), sandbox);
  return { sandbox, listeners };
}

test('given a card, markdownInto draws an image as a picture from that card\'s route, the path riding the query encoded', () => {
  const { sandbox } = load();
  const el = { innerHTML: '' };
  sandbox.markdownInto(el, '![shot](../a b/c%20d.png)', { card: 'G3' });
  const src = '/api/cards/G3/image?path=..%2Fa%20b%2Fc%2520d.png';
  assert.ok(el.innerHTML.includes(`<img class="md-img-pic" src="${src}" alt="shot"`), el.innerHTML);
  assert.ok(el.innerHTML.includes(`<a class="md-img" href="${src}"`));
});

test('a board load that says it holds no pictures (a page that carries its board) draws every card image as its alt label, with no address to load', () => {
  const { sandbox } = load({ kind: 'page', queued: 0, pictures: false });
  const el = { innerHTML: '' };
  sandbox.markdownInto(el, '![shot](a.png)', { card: '25' });
  assert.strictEqual(el.innerHTML, '<p><span class="md-img-alt">shot</span></p>');
});

test('a board load that says nothing of pictures, as the server does not, still draws them', () => {
  const { sandbox } = load({ kind: 'server', queued: 0 });
  const el = { innerHTML: '' };
  sandbox.markdownInto(el, '![shot](a.png)', { card: '25' });
  assert.ok(el.innerHTML.includes('<img class="md-img-pic" src="/api/cards/25/image?path=a.png"'), el.innerHTML);
});

test('given no card, markdownInto draws the plain label', () => {
  const { sandbox } = load();
  const el = { innerHTML: '' };
  sandbox.markdownInto(el, '![shot](a.png)');
  assert.strictEqual(el.innerHTML, '<p><span class="md-img-alt">shot</span></p>');
});

function failure(onError, picture) {
  const label = { className: '', textContent: '' };
  const link = { replaceWith: (n) => { link.replacedWith = n; } };
  const img = {
    alt: 'shot',
    matches: (sel) => picture && sel === 'img.md-img-pic',
    closest: (sel) => (sel === 'a.md-img' ? link : null),
    ownerDocument: { createElement: (tag) => { label.tag = tag; return label; } },
  };
  onError({ target: img });
  return { link, label };
}

test('one capturing error listener swaps a failed picture for its alt label, and leaves every other failure alone', () => {
  const { listeners } = load();
  const errors = listeners.filter((l) => l.type === 'error');
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].capture, true, 'an error does not bubble, so the listener captures');
  const swapped = failure(errors[0].fn, true);
  assert.strictEqual(swapped.link.replacedWith, swapped.label);
  assert.strictEqual(swapped.label.tag, 'span');
  assert.strictEqual(swapped.label.className, 'md-img-alt');
  assert.strictEqual(swapped.label.textContent, 'shot');
  assert.strictEqual(failure(errors[0].fn, false).link.replacedWith, undefined, 'a failing image that is not a body picture stays');
  assert.doesNotThrow(() => errors[0].fn({ target: {} }), 'an error on a window or a script is not ours');
});

test('the script is loaded by the page, after the file that draws into an element', () => {
  const html = read('app.html');
  assert.ok(html.indexOf('<script src="/markdown-images.js"></script>') > html.indexOf('<script src="/markdown-ui.js"></script>'));
});

test('the same listener swaps a failed picture of the folder browser (img.spf-img) for its name as a plain label', () => {
  const { listeners } = load();
  const onError = listeners.find((l) => l.type === 'error').fn;
  const label = { className: '', textContent: '' };
  const img = {
    alt: 'shot.png',
    matches: (sel) => sel === 'img.spf-img',
    closest: () => null,
    replaceWith: (n) => { img.replacedWith = n; },
    ownerDocument: { createElement: (tag) => { label.tag = tag; return label; } },
  };
  onError({ target: img });
  assert.strictEqual(img.replacedWith, label);
  assert.strictEqual(label.tag, 'span');
  assert.strictEqual(label.className, 'md-img-alt');
  assert.strictEqual(label.textContent, 'shot.png');
  assert.strictEqual(listeners.filter((l) => l.type === 'error').length, 1, 'one handler, not two');
});
