const { test } = require('node:test');
const assert = require('node:assert');
const { mdToHtml, parseInline } = require('../../plugin/skills/web/web/markdown.js');

const route = (card) => (path) => `/api/cards/${card}/image?path=${encodeURIComponent(path)}`;
const draw = (text, card) => mdToHtml(text, { board: 'webapp', imageSrc: card === undefined ? undefined : route(card) });
const BODY = '![Screenshot](../work/item%2012/.scratchpad/3f2a9c1e.png)';
const SRC = '/api/cards/7/image?path=..%2Fwork%2Fitem%252012%2F.scratchpad%2F3f2a9c1e.png';

test('an image in a body parses to an image token holding its alt text and the path as written', () => {
  assert.deepStrictEqual(parseInline(BODY), [{ t: 'img', alt: 'Screenshot', path: '../work/item%2012/.scratchpad/3f2a9c1e.png' }]);
});

test('on a card the picture sits inside a link to the same route, which opens it full size', () => {
  assert.strictEqual(draw(BODY, '7'),
    `<p><a class="md-img" href="${SRC}" target="_blank" rel="noopener noreferrer"><img class="md-img-pic" src="${SRC}" alt="Screenshot" loading="lazy"></a></p>`);
});

test('the src is whatever the route function of the caller answers for the path, so the body cannot name another address', () => {
  const html = draw('![x](/etc/shot.png) ![y](..\a\b.png)', '7');
  assert.ok(!html.includes('src="/etc/'), 'the raw path is not the src');
  for (const src of html.matchAll(/src="([^"]*)"/g)) assert.ok(src[1].startsWith('/api/cards/7/image?path='), src[1]);
});

test('with no route to ask the server for, the alt text draws as the plain label', () => {
  assert.strictEqual(draw(BODY), '<p><span class="md-img-alt">Screenshot</span></p>');
  assert.strictEqual(draw('![](a/b.png)'), '<p><span class="md-img-alt">a/b.png</span></p>');
});

test('alt text, path and card are escaped wherever they land', () => {
  const html = draw('![a"><script>x</script>](p"q.png)', '7"><b>');
  assert.ok(!html.includes('<script') && !html.includes('<b>'));
  assert.ok(html.includes('alt="a&quot;&gt;&lt;script&gt;'));
  assert.ok(draw('![a"><i>](p.png)').includes('&lt;i&gt;'));
});

test('an image whose address has a scheme stays a link, as links render today', () => {
  assert.strictEqual(draw('![x](https://e.test/a.png)', '7'), '<p>!<a href="https://e.test/a.png" target="_blank" rel="noopener noreferrer">x</a></p>');
  assert.strictEqual(draw('![x](javascript:alert)', '7'), '<p>!<a href="#" target="_blank" rel="noopener noreferrer">x</a></p>');
  assert.strictEqual(draw('![x](data:image/png;base64,AAAA)', '7'), '<p>!<a href="#" target="_blank" rel="noopener noreferrer">x</a></p>');
  assert.strictEqual(draw('![x](//e.test/a.png)', '7'), '<p>!<a href="//e.test/a.png" target="_blank" rel="noopener noreferrer">x</a></p>');
});

test('an image in link text, an unclosed one and a lone bang keep their old drawing', () => {
  assert.strictEqual(draw('wow! [a](https://e.test)', '7'), '<p>wow! <a href="https://e.test" target="_blank" rel="noopener noreferrer">a</a></p>');
  assert.strictEqual(draw('![x](a.png', '7'), '<p>![x](a.png</p>');
  assert.strictEqual(draw('![x]', '7'), '<p>![x]</p>');
  assert.ok(!draw('[![x](a.png)](https://e.test)', '7').includes('<img'));
});

test('an image sits among other marks and in lists and tables', () => {
  assert.ok(draw('**bold** ![s](a.png) *it*', '7').includes('<strong>bold</strong> <a class="md-img"'));
  assert.ok(draw('- ![s](a.png)', '7').includes('<li><a class="md-img"'));
  assert.ok(draw('| a |\n|---|\n| ![s](a.png) |', '7').includes('<td><a class="md-img"'));
});
