const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', f), 'utf8');
const html = read('app.html');
const js = read('app.js');
const css = read('app.css');

const anchor = html.match(/<a\b[^>]*id="home-link"[^>]*>[\s\S]*?<\/a>/);

function loadApply() {
  const fn = js.match(/function applyHomeUrl\([\s\S]*?\n\}/);
  assert.ok(fn, 'applyHomeUrl exists');
  const classes = new Set(['hidden']);
  const attrs = {};
  const link = {
    href: undefined,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    removeAttribute: (n) => { delete attrs[n]; if (n === 'href') link.href = undefined; },
  };
  const ctx = vm.createContext({ $: () => link });
  vm.runInContext(fn[0], ctx);
  return { apply: ctx.applyHomeUrl, link, classes };
}

test('the header holds one real link before the board title, with an accessible name and an inline svg', () => {
  assert.ok(anchor, 'anchor with id home-link');
  const tag = anchor[0].match(/^<a\b[^>]*>/)[0];
  assert.match(tag, /aria-label="Up to the home page"/);
  assert.match(tag, /rel="noopener noreferrer"/);
  assert.match(tag, /class="[^"]*\bhidden\b/, 'starts hidden');
  assert.doesNotMatch(tag, /href=/, 'no empty link until a home url arrives');
  assert.doesNotMatch(tag, /style=/);
  assert.match(anchor[0], /<svg\b/);
  assert.doesNotMatch(anchor[0], /[\u{1F000}-\u{1FFFF}\u2600-\u27BF]/u, 'no emoji');
  assert.ok(html.indexOf('id="home-link"') < html.indexOf('<h1>'), 'before the title');
  assert.ok(html.indexOf('<header>') < html.indexOf('id="home-link"'));
});

test('the h1 keeps its pinned shape', () => {
  assert.match(html, /<h1><span id="project-name"[^>]*><\/span>/);
});

test('a home url shows the link and sets the href through the property', () => {
  const { apply, link, classes } = loadApply();
  apply('http://127.0.0.1:7791/');
  assert.strictEqual(link.href, 'http://127.0.0.1:7791/');
  assert.ok(!classes.has('hidden'));
});

test('no home url hides the link again and drops the href', () => {
  const { apply, link, classes } = loadApply();
  apply('https://shop.example.test/');
  apply(null);
  assert.ok(classes.has('hidden'));
  assert.strictEqual(link.href, undefined);
});

test('a value that is not http or https never becomes an href', () => {
  const { apply, link, classes } = loadApply();
  apply('javascript:alert(1)');
  assert.strictEqual(link.href, undefined);
  assert.ok(classes.has('hidden'));
});

test('the link is built through the DOM, not string-built HTML', () => {
  const fn = js.match(/function applyHomeUrl\([\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fn, /innerHTML|insertAdjacentHTML|setAttribute\(\s*'href'/);
});

test('every board load applies the home url', () => {
  const fn = js.match(/function applyBoardData\([\s\S]*?\n\}/)[0];
  assert.match(fn, /applyHomeUrl\(data\.homeUrl\)/);
});

test('the stylesheet styles the link with tokens only', () => {
  const rule = css.match(/\.home-link\s*\{[^}]*\}/);
  assert.ok(rule, '.home-link rule');
  assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,8}\b/);
});
