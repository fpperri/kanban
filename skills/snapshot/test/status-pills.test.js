const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { board, open } = require('./nesting-view');
const { withSnapshot } = require('./nesting-fixture');
const { byClass, loadPage } = require('./page-harness');

const withMouse = (b, fn) => withSnapshot(b, (html) => fn(loadPage(html, { matchMedia: (q) => q.includes('min-width:900px') || q.includes('pointer: fine') })));

const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build_editor.py'), 'utf8');
const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

function decls(selector) {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector));
  assert.ok(found.length, `no rule for ${selector}`);
  const out = {};
  for (const m of found) for (const d of m[2].matchAll(/([a-z-]+):([^;]+)/g)) out[d[1]] = d[2].trim();
  return out;
}

test('an off status pill is muted, struck through and hollow, with no opacity and a button hover', () => {
  const off = decls('.pillrow button.off');
  assert.ok(!('opacity' in off), 'dims with opacity');
  assert.strictEqual(off.color, 'var(--mut)');
  assert.match(off['text-decoration'] || '', /line-through/);
  assert.strictEqual(decls('.pillrow button:hover').background, 'var(--btn-bg)');
  assert.strictEqual(decls('.pillrow button.off .dot').background, 'transparent');
});

test('the open card sits on the surface ground and code blocks on the raised one', () => {
  assert.strictEqual(decls('#modalscroll').background, 'var(--surface)');
  assert.strictEqual(decls('.bodymd pre').background, 'var(--raised)');
});

const BOARD = board('', [[1, 'todo', 'One'], [2, 'done', 'Two']]);
const pills = (page) => byClass(page.byId('boardpills'), 'pillrow')[0].children;
const state = (page) => pills(page).map((b) => b.getAttribute('aria-pressed'));
const labels = (page) => pills(page).map((b) => b.textContent);

test('every status pill is a button carrying aria-pressed, Archive off by default', () => {
  open(BOARD, (page) => {
    assert.deepStrictEqual(labels(page), ['Todo', 'Done', 'Archive']);
    assert.deepStrictEqual(state(page), ['true', 'true', 'false']);
    for (const b of pills(page)) assert.ok(b.title, 'the tooltip states the grammar');
  });
});

test('a pill leads with a dot in its status colour; off, the dot is the ring and the fill is gone', () => {
  open(BOARD, (page) => {
    const [todo, , archive] = pills(page);
    assert.ok(byClass(todo, 'dot')[0].style.color, 'identity colour on the dot');
    assert.strictEqual(byClass(todo, 'dot')[0].style.background, undefined);
    assert.ok(/\boff\b/.test(archive.className));
  });
});

test('right-click solos a pill, again restores all, and the browser menu is kept away only on a pill', () => {
  withMouse(BOARD, (page) => {
    assert.strictEqual(page.contextmenu(pills(page)[1]), true);
    assert.deepStrictEqual(state(page), ['false', 'true', 'false']);
    assert.strictEqual(page.contextmenu(pills(page)[1]), true);
    assert.deepStrictEqual(state(page), ['true', 'true', 'true']);
    assert.strictEqual(page.contextmenu(page.byId('board')), false);
  });
});

test('a left click still toggles one pill', () => {
  open(BOARD, (page) => {
    page.click(pills(page)[0]);
    assert.deepStrictEqual(state(page), ['false', 'true', 'false']);
  });
});

test('a coarse pointer keeps its own long-press menu on a pill', () => {
  open(BOARD, (page) => {
    assert.strictEqual(page.contextmenu(pills(page)[1]), false);
    assert.deepStrictEqual(state(page), ['true', 'true', 'false']);
  });
});
