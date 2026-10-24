const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pageScopeCollisions, topLevelDeclarations } = require('../web/helpers/global-scope');
const { BOARD, lf, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

// The web's pill-list module is written to be embedded in a page where no other
// module of the web is loaded: no require, no other module's names. The snapshot
// carries it as the same source, in a script element of its own ahead of the page's
// own, and holds the built page to the same top-level-name scan the web holds its own
// modules to. (search-embed.test.js holds the placement, the placeholder and the
// build's refusals; this file holds what the page does with the module.)

const source = lf(fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'pills.js'), 'utf8'));

test('the built page carries the pill-list module byte for byte, and its scripts share no top-level name', () => {
  withSnapshot(BOARD, (html) => {
    assert.ok(html.includes(source), 'the module source is in the page verbatim');
    assert.deepStrictEqual(pageScopeCollisions(html), []);
    const page = loadPage(html);
    const own = topLevelDeclarations(page.scripts[page.scripts.length - 1]);
    const mine = topLevelDeclarations(source);
    assert.ok(mine.includes('pillList') && mine.includes('BUILT_IN_PILLS'), 'the scan reads the module\'s declarations');
    assert.deepStrictEqual(own.filter((n) => mine.includes(n)), [], 'the page script re-declares none of them');
  });
});

test('the page runs the module as shipped: it lists the pills, and its functions are the module\'s, to the character', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    assert.strictEqual(page.run('typeof pillList + typeof pillIsOn + typeof pillsOn + typeof panelChip + typeof BUILT_IN_PILLS'), 'functionfunctionfunctionfunctionobject');
    assert.strictEqual(page.run("JSON.stringify(pillList([{ id: 1 }, { id: 2 }], (q) => (q === 'review:' ? [2, 3] : [])).map((p) => [p.label, p.count]))"),
      '[["blocked",0],["review",1],["waiting",0]]');
    for (const name of ['pillEntries', 'pillCounts', 'pillList', 'pillRows', 'pillIsOn', 'panelChip']) {
      assert.ok(source.includes(page.run(`${name}.toString()`)), `${name} on the page is the module's`);
    }
  });
});

test('the modules the page already had are all still there', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    assert.strictEqual(page.run('typeof parseSearchQuery + typeof sliceCards + typeof depthMap'), 'functionfunctionfunction');
  });
});
