const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mdInlineToHtml: inline } = require('../web/markdown.js');

// One line as inline HTML with no block around it (a todo item's row): the inline marks of the one
// renderer, and text where a block would start.

const WEB = path.join(__dirname, '..', 'web');

test('the inline marks render, with no paragraph around them', () => {
  assert.strictEqual(inline('a **b** and *c* and `d`', { board: 'webapp' }), 'a <strong>b</strong> and <em>c</em> and <code>d</code>');
  assert.strictEqual(inline('[x](https://e.test/a?b=1&c=2)'), '<a href="https://e.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">x</a>');
  assert.strictEqual(inline('~~gone~~'), '<del>gone</del>');
});

test('a mention of a card on this board is a chip that carries its id; one of another board is plain', () => {
  const html = inline('see `webapp#12 the cutover` and `other#3`', { board: 'webapp' });
  assert.ok(html.includes('data-card-id="12"'));
  assert.ok(!html.includes('data-card-id="3"'));
});

test('text that would start a block stays text: a heading, a list, a quote, a fence', () => {
  assert.strictEqual(inline('# not a heading'), '# not a heading');
  assert.strictEqual(inline('- not a list'), '- not a list');
  assert.strictEqual(inline('> not a quote'), '&gt; not a quote');
  assert.strictEqual(inline('```js'), '```js');
});

test('a line break is a space, and nothing is unescaped', () => {
  assert.strictEqual(inline('one\ntwo'), 'one two');
  assert.strictEqual(inline('<img src=x onerror=alert(1)> [a](javascript:alert(1))'), '&lt;img src=x onerror=alert(1)&gt; <a href="#" target="_blank" rel="noopener noreferrer">a</a>)');
  assert.strictEqual(inline(null), '');
  assert.strictEqual(inline(''), '');
});

test('markdownInto draws inline when asked, and as blocks otherwise; both are the one renderer', () => {
  const ui = fs.readFileSync(path.join(WEB, 'markdown-ui.js'), 'utf8');
  assert.match(ui, /function markdownInto\(el, text, opts\)/);
  assert.match(ui, /opts && opts\.inline \? mdInlineToHtml\(text \|\| '', board\) : mdToHtml\(text \|\| '', board\)/);
  const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');
  assert.ok(html.includes('<script src="/markdown.js">') || /markdown\.js/.test(html));
});
