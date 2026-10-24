const { test } = require('node:test');
const assert = require('node:assert');
const { topLevelDeclarations, pageScopeCollisions } = require('../../web/test/helpers/global-scope');
const { BOARD, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

// All of the built page's scripts share one scope, so a second declaration of a
// name silently replaces the first (a function) or kills the later script (a
// const). The web suite runs the same scan over the web's own modules.

test('two scripts that declare the same top-level name fail the scan, and the scan names the name and both scripts', () => {
  const page = '<script>function dup() { return 1; }</script><script>const dup = 2;</script>';
  assert.deepStrictEqual(pageScopeCollisions(page), ['dup: script 0, script 1']);
});

test('a name declared in only one script passes, and so does a name that only a string, a comment or a nested scope holds', () => {
  const page = [
    '<script>const a = 1; function b() { const inner = 1; return inner; }</script>',
    '<script>const c = "const a = 2;"; // function b() {}',
    'const d = inner;</script>',
  ].join('\n');
  assert.deepStrictEqual(pageScopeCollisions(page), []);
});

test('the built page passes the scan, and the scan reads every script of it', () => {
  withSnapshot(BOARD, (html) => {
    assert.deepStrictEqual(pageScopeCollisions(html), []);
    const scripts = loadPage(html).scripts;
    assert.ok(scripts.length >= 3, 'sanity: the page holds the modules and its own script');
    scripts.forEach((src, i) => {
      assert.ok(topLevelDeclarations(src).length > 0, `script ${i}: no top-level declarations found, so the scan would pass it blind`);
    });
    const own = topLevelDeclarations(scripts[scripts.length - 1]);
    assert.ok(own.includes('render') && own.includes('queue') && own.includes('cardNode'), 'the scan finds the page script\'s own declarations');
  });
});
