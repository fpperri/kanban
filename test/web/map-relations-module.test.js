const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const lf = (text) => text.replace(/\r\n/g, '\n');
const source = lf(fs.readFileSync(path.join(WEB, 'map-relations.js'), 'utf8'));

// The snapshot embeds this file as is, into a page where no other module is
// loaded and a build step rewrites __NAME__ tokens.

test('the module needs no module but the id module, so a page with only that loaded can run it', () => {
  assert.doesNotMatch(source, /\brequire\((?!'\.\/ids'\))/);
  assert.doesNotMatch(source, /\bimport\b/);
});

test('the module cannot close the script element it is embedded in, or hold a build placeholder', () => {
  assert.doesNotMatch(source, /<\/script/i);
  assert.doesNotMatch(source, /__[A-Z_]+__/);
});

test('loaded as a plain script, with no module object, it puts its functions on window', () => {
  const window = {};
  vm.runInNewContext(source, { window });
  const names = [
    'MAP_OPTION_VALUES', 'MAP_OPTION_DEFAULTS', 'mergeMapOptions', 'mapParentLineEnds', 'mapShapeRelations', 'mapOrderRow',
    'mapRowPositions', 'mapParentLinePaths', 'mapRichBox', 'mapPlural', 'mapGraphCounts', 'mapGraphsLabel', 'mapRootsText',
  ];
  for (const name of names) {
    assert.ok(name in window, `${name} reaches window`);
  }
  assert.strictEqual(window.mergeMapOptions(null).parentLines, 'chain');
});

test('app.html loads it before app.js, and the server serves it', async () => {
  const html = lf(fs.readFileSync(path.join(WEB, 'app.html'), 'utf8'));
  const tag = '<script src="/map-relations.js"></script>';
  assert.ok(html.includes(tag), 'app.html carries the script tag');
  assert.ok(html.indexOf(tag) < html.indexOf('<script src="/app.js"></script>'), 'ahead of app.js');
  const { pageFiles } = require('../scripts/server');
  assert.ok(pageFiles(html).includes('map-relations.js'), 'the page names it, and the server serves what the page names');
});
