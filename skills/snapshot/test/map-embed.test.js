const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { BOARD, card, lf, mapRelationsPath, nestingPath, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

// The snapshot carries the map's graph rules as the same source kanban-web runs,
// so which parent lines, trees and row order the map draws is one copy of the rules.

const mapSource = lf(fs.readFileSync(mapRelationsPath, 'utf8'));
const nestingSource = lf(fs.readFileSync(nestingPath, 'utf8'));

test('the built page contains the map module source exactly, once, in its own script element ahead of the page script', () => {
  withSnapshot(BOARD, (html) => {
    const at = html.indexOf(mapSource);
    assert.ok(at !== -1, 'the module source is in the page verbatim');
    assert.strictEqual(html.indexOf(mapSource, at + 1), -1, 'and only once');
    assert.ok(at < html.indexOf('const BASE='), 'it loads before the page script that uses it');
    const open = html.lastIndexOf('<script>', at);
    assert.ok(open !== -1 && html.slice(open + '<script>'.length, at).trim() === '', 'it opens its own script element');
    assert.ok(html.slice(at + mapSource.length).startsWith('</script>'), 'and that element holds nothing else');
  });
});

test('a card that happens to contain the map module placeholder keeps its own text', () => {
  const board = { ...BOARD, cards: { ...BOARD.cards, '0012.odd.card.md': card(12, 'todo', 'Odd').replace('# Odd', '# Odd\nbody __MAP_RELATIONS_JS__ stays text') } };
  withSnapshot(board, (html) => {
    assert.ok(html.includes('body __MAP_RELATIONS_JS__ stays text'));
    assert.ok(html.includes(mapSource));
  });
});

test('the modules and the page script load together without a name clash, and the page can call the map rules', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    assert.strictEqual(page.scripts.length, 3, 'the nesting module, the map module, then the page');
    assert.ok(page.scripts[0].includes(nestingSource) && page.scripts[1].includes(mapSource));
    assert.strictEqual(page.run('typeof mapShapeRelations + typeof mapOrderRow + typeof mapParentLineEnds'), 'functionfunctionfunction');
    assert.strictEqual(page.run('MAP_OPTION_DEFAULTS.parentLines'), 'chain');
  });
});

test('every map-relations.js function the page calls is declared once by the embedded module, geometry and words included', () => {
  withSnapshot(BOARD, (html) => {
    const names = [
      'mapShapeRelations', 'mapOrderRow', 'mapParentLineEnds', 'mergeMapOptions',
      'mapRowPositions', 'mapParentLinePaths', 'mapRichBox', 'mapPlural', 'mapGraphCounts', 'mapGraphsLabel', 'mapRootsText',
    ];
    for (const name of names) {
      assert.strictEqual(html.split(`function ${name}(`).length - 1, 1, `${name} is declared once`);
    }
  });
});
