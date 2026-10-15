const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pageScopeCollisions } = require('../../web/test/helpers/global-scope');
const { BOARD, lf, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

// The web's pill-list module is written to be embedded in a page where no other
// module of the web is loaded: no require, no other module's names. The snapshot
// does not embed it yet, so this puts its source into a built page as one more
// script, ahead of the page's own, and holds the page to the same scan the web
// holds its own modules to, then runs the module there.

const source = lf(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'web', 'pills.js'), 'utf8'));

function withPills(html) {
  const pageScript = html.lastIndexOf('<script>');
  assert.ok(pageScript !== -1, 'the built page has its scripts');
  return html.slice(0, pageScript) + `<script>${source}</script>\n` + html.slice(pageScript);
}

test('the pill-list module added to a built page shares no top-level name with any script of it', () => {
  withSnapshot(BOARD, (html) => {
    assert.deepStrictEqual(pageScopeCollisions(withPills(html)), []);
  });
});

test('added to a built page the module loads with the page and lists the pills', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(withPills(html));
    assert.strictEqual(page.run('typeof pillList + typeof pillIsOn + typeof pillsOn + typeof panelChip + typeof BUILT_IN_PILLS'), 'functionfunctionfunctionfunctionobject');
    assert.strictEqual(page.run("JSON.stringify(pillList([{ id: 1 }, { id: 2 }], (q) => (q === 'review:' ? [2, 3] : [])).map((p) => [p.label, p.count]))"),
      '[["blocked",0],["review",1],["waiting",0]]');
  });
});

test('the modules the page already had are all still there once it is added', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(withPills(html));
    assert.strictEqual(page.run('typeof parseSearchQuery + typeof sliceCards + typeof depthMap'), 'functionfunctionfunction');
  });
});
