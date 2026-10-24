const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pageScopeCollisions, topLevelDeclarations } = require('../../web/test/helpers/global-scope');
const { BOARD, lf, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

// The run of slices the search panel's slice section is made of is a pure module of
// the web, written to be embedded: no require, no other module's names. The snapshot
// carries it as the same source, after the slices module it works on and ahead of
// the page's own script. (search-embed.test.js holds the placement, the placeholder
// and the build's refusals; this file holds what the page does with the module.)

const source = lf(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'web', 'slice-run.js'), 'utf8'));

test('the built page carries the slice-run module byte for byte, and its scripts share no top-level name', () => {
  withSnapshot(BOARD, (html) => {
    assert.ok(html.includes(source), 'the module source is in the page verbatim');
    assert.deepStrictEqual(pageScopeCollisions(html), []);
    const page = loadPage(html);
    const own = topLevelDeclarations(page.scripts[page.scripts.length - 1]);
    const mine = topLevelDeclarations(source);
    assert.ok(mine.includes('sliceRunClick') && mine.includes('SLICE_RUN_KEYS'), 'the scan reads the module\'s declarations');
    assert.deepStrictEqual(own.filter((n) => mine.includes(n)), [], 'the page script re-declares none of them');
  });
});

test('the module loads after the slices module it works on, and the page can call it', () => {
  withSnapshot(BOARD, (html) => {
    const slices = html.indexOf(lf(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'web', 'slices.js'), 'utf8')));
    const run = html.indexOf(source);
    assert.ok(slices !== -1 && slices < run && run < html.indexOf('const BASE='));
    const page = loadPage(html);
    assert.strictEqual(page.run('typeof sliceListOf + typeof sliceRunOf + typeof sliceRunClick + typeof sliceRunKeep + typeof sliceRunStep + typeof sliceRunValue + typeof sliceRunCuts'),
      'functionfunctionfunctionfunctionfunctionfunctionfunction');
    assert.deepStrictEqual(page.plain(page.run('SLICE_RUN_KEYS')), ['[', ']', '{', '}']);
    for (const name of ['sliceListOf', 'sliceRunOf', 'sliceRunClick', 'sliceRunStep', 'sliceRunValue', 'sliceEntryName']) {
      assert.ok(source.includes(page.run(`${name}.toString()`)), `${name} on the page is the module's`);
    }
  });
});
