const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}
function constant(name) {
  const m = appSrc.match(new RegExp(`^const ${name} = [^;]+;`, 'm'));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

// --- the section header and each graph's heading ------------------------------------

function headingSandbox() {
  const { escapeHtml } = require('../web/assignee-badge');
  const { cardTitleDisplay } = require('../web/card-title');
  const sandbox = { escapeHtml, cardTitleDisplay };
  vm.createContext(sandbox);
  vm.runInContext([fn('truncateLabel'), fn('mapGraphSectionLabel'), fn('mapGraphHeadingHtml')].join('\n'), sandbox);
  return sandbox;
}
const node = (id, title) => ({ id, title });
const treeOf = (nodes, roots, ghosts = []) => ({ nodes, ghosts, roots });

test('the graph section counts trees and cards when it holds one graph per tree', () => {
  const w = headingSandbox();
  const graphs = [treeOf([node(1), node(2), node(3)], [1]), treeOf([node(4), node(5)], [4]), treeOf([node(6)], [6])];
  assert.strictEqual(w.mapGraphSectionLabel(graphs, 'tree'), 'Relation trees (3 trees, 6 cards):');
  assert.strictEqual(w.mapGraphSectionLabel([graphs[2]], 'tree'), 'Relation trees (1 tree, 1 card):');
});

test('the graph section counts cards only when it holds one graph', () => {
  const w = headingSandbox();
  assert.strictEqual(w.mapGraphSectionLabel([treeOf([node(1), node(2)], [1])], 'one'), 'Relations graph (2 cards):');
});

test('a tree\'s heading names its roots and counts its cards and stubs', () => {
  const w = headingSandbox();
  const html = w.mapGraphHeadingHtml(treeOf([node(10, 'Spec: cards nest'), node(11, 'Chip'), node(12, 'Nest')], [10], [node(9, 'Hidden')]));
  assert.strictEqual(html, '<strong>#10 Spec: cards nest</strong><span>3 cards + 1 stub</span>');
});

test('a heading names three roots at most and counts the rest', () => {
  const w = headingSandbox();
  const roots = [1, 2, 3, 4, 5];
  const html = w.mapGraphHeadingHtml(treeOf(roots.map((id) => node(id, `T${id}`)), roots));
  assert.match(html, /<strong>#1 T1 · #2 T2 · #3 T3 \+2 more<\/strong>/);
  assert.match(html, /<span>5 cards<\/span>/);
});

test('a heading shortens a long title and escapes whatever a title holds', () => {
  const w = headingSandbox();
  const html = w.mapGraphHeadingHtml(treeOf([node(1, '<img src=x onerror=alert(1)> and a very long title that goes on and on')], [1]));
  assert.ok(!html.includes('<img'), 'no live tag');
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /…<\/strong>/);
});

// --- rich cards ---------------------------------------------------------------------

function richSandbox({ index, mode = 'collapsed', types = [] } = {}) {
  const { typeBadge } = require('../web/type-badge');
  const { altitudeBadge, rollupBar } = require('../web/rollup-bar');
  const { ROLLUP_BAR_OPEN, ROLLUP_BAR_COLLAPSED } = require('../web/column-state');
  const sandbox = {
    typeBadge, altitudeBadge, rollupBar, ROLLUP_BAR_OPEN, ROLLUP_BAR_COLLAPSED,
    state: { types },
    nestingIndex: index || { altitudeOf: () => 0, rollup: () => ({ total: 0, counts: {} }) },
    loadRollupBarMode: () => mode,
    loadRollupCountArchived: () => true,
    boardStatuses: () => ['backlog', 'todo', 'doing', 'done'],
  };
  vm.createContext(sandbox);
  vm.runInContext(['MAP_NODE_W', 'MAP_NODE_H', 'MAP_RICH_TOP', 'MAP_RICH_META_H', 'MAP_RICH_BAR_OPEN_H', 'MAP_RICH_BAR_THIN_H'].map(constant)
    .concat([fn('mapRichLayout'), fn('mapNodeSize'), fn('mapRichHtml')]).join('\n'), sandbox);
  return sandbox;
}

const parentIndex = (total) => ({
  altitudeOf: (id) => (id === 1 ? 2 : 0),
  rollup: (id) => (id === 1 ? { total, counts: { done: 1, todo: total - 1 } } : { total: 0, counts: {} }),
});
const byId = (...cards) => new Map(cards.map((c) => [c.id, c]));
const RICH = (cards) => ({ rich: true, byId: byId(...cards) });
const heightOf = (w, node, opts) => w.mapNodeSize(node, opts).h;

test('plain cards, stubs and cards from another board draw as they always did, at the fixed height', () => {
  const w = richSandbox({ index: parentIndex(3) });
  const card = { id: 1, type: 'epic' };
  assert.strictEqual(w.mapNodeSize({ id: 1 }, { rich: false, byId: byId(card) }).rich, null);
  assert.strictEqual(heightOf(w, { id: 1 }, { rich: false, byId: byId(card) }), 58);
  for (const stub of [{ id: 1, ghost: true }, { id: 1, missing: true }, { id: -1, external: 'shop#7' }]) {
    assert.strictEqual(w.mapNodeSize(stub, RICH([card])).rich, null);
    assert.strictEqual(heightOf(w, stub, RICH([card])), 58);
  }
});

test('a rich card with nothing extra to show is no taller than it needs to be', () => {
  const w = richSandbox();
  assert.ok(heightOf(w, { id: 5 }, RICH([{ id: 5 }])) < 58);
});

test('a type, an altitude or a blocked sticker earns the card a row of its own', () => {
  const bare = heightOf(richSandbox(), { id: 5 }, RICH([{ id: 5 }]));
  assert.ok(heightOf(richSandbox(), { id: 5 }, RICH([{ id: 5, type: 'story' }])) > bare, 'a type');
  assert.ok(heightOf(richSandbox({ index: { altitudeOf: () => 1, rollup: () => ({ total: 0, counts: {} }) } }), { id: 5 }, RICH([{ id: 5 }])) > bare, 'an altitude');
  assert.ok(heightOf(richSandbox(), { id: 5, blocked: true }, RICH([{ id: 5 }])) > bare, 'a sticker');
});

test('a parent\'s roll-up bar adds a row, thin while the Bar setting is collapsed and taller when it is open', () => {
  const card = { id: 1, type: 'epic' };
  const thin = heightOf(richSandbox({ index: parentIndex(3), mode: 'collapsed' }), { id: 1 }, RICH([card]));
  const open = heightOf(richSandbox({ index: parentIndex(3), mode: 'open' }), { id: 1 }, RICH([card]));
  const noBar = heightOf(richSandbox(), { id: 1 }, RICH([card]));
  assert.ok(thin > noBar, 'a bar adds height');
  assert.ok(open > thin, 'the open bar is taller than the thin one');
});

test('a parent with no leaf counted draws no bar', () => {
  const w = richSandbox({ index: parentIndex(0) });
  const html = w.mapRichHtml({ id: 1 }, w.mapRichLayout({ id: 1 }, RICH([{ id: 1, type: 'epic' }])));
  assert.doesNotMatch(html, /class="rollup"/);
});

test('rich markup holds the type chip, the altitude badge and the roll-up bar, as the board draws them', () => {
  const w = richSandbox({ index: parentIndex(3), mode: 'open', types: [{ name: 'epic', color: 'tomato' }] });
  const n = { id: 1 };
  const html = w.mapRichHtml(n, w.mapRichLayout(n, RICH([{ id: 1, type: 'epic' }])));
  assert.match(html, /<span class="type-chip"[^>]*data-type-color="tomato"[^>]*>epic<\/span>/);
  assert.match(html, /<span class="alt-badge"[^>]*>▲2<\/span>/);
  assert.match(html, /<div class="rollup">/);
  assert.match(html, /<foreignObject class="map-rich"/);
  assert.doesNotMatch(html, /\sstyle=/, 'the strict CSP blocks style attributes');
});

test('a card\'s type is escaped, however it is written', () => {
  const w = richSandbox();
  const n = { id: 5 };
  const html = w.mapRichHtml(n, w.mapRichLayout(n, RICH([{ id: 5, type: '<script>x</script>' }])));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('the type chip steps aside for the blocked pill that shares its row', () => {
  const w = richSandbox();
  const clear = w.mapRichHtml({ id: 5 }, w.mapRichLayout({ id: 5 }, RICH([{ id: 5, type: 'story' }])));
  const blocked = w.mapRichHtml({ id: 5, blocked: true }, w.mapRichLayout({ id: 5, blocked: true }, RICH([{ id: 5, type: 'story' }])));
  const x = (html) => Number(html.match(/<foreignObject class="map-rich" x="(\d+)"/)[1]);
  assert.ok(x(blocked) > x(clear));
});

// --- what renderMapView and buildMapSvg call ----------------------------------------

test('the Map reads every relation, shapes it by the options, and draws what that returns', () => {
  const body = fn('renderMapView');
  assert.match(body, /buildRelationsGraph\(allCards, visibleIds, nestingCtx\(\)\)/);
  assert.match(body, /mapShapeRelations\(rel, options\)/);
  assert.doesNotMatch(body, /buildDependencyGraph\(/, 'the old graph no longer feeds the view');
  assert.match(body, /classList\.toggle\('map-align-center', options\.align === 'center'\)/);
  assert.match(body, /view\.graphs\.length/);
  assert.match(body, /buildIsolatedRow\(view\.noRelations, allCards, sections\.isolated\)/);
  assert.match(body, /No cards match the current search\/status filters\./, 'an everything-filtered-out board still says so');
});

test('the bottom row is called No relations, and still collapses under its old saved key', () => {
  const body = fn('buildIsolatedRow');
  assert.match(body, /No relations \(\$\{ids\.length\}\):/);
  assert.match(body, /buildMapSectionHeader\('isolated'/);
  assert.doesNotMatch(body, /No dependencies/);
});

test('each tree is laid out on its own, by the layout edges, and zoomed with the rest', () => {
  const body = fn('buildMapGraphSection');
  assert.match(body, /layerNodes\(graph\.ids, graph\.layoutEdges\)/);
  assert.match(body, /buildMapSvg\(graph, layer, draw\)/);
  assert.match(body, /applyMapZoomToSvg\(svg, zoom\)/);
  assert.match(body, /if \(!collapsed\)/, 'a collapsed section builds nothing');
  assert.match(body, /options\.group === 'tree'/, 'headings only when each tree has its own graph');
});

test('a row is ordered by status before cards are placed, and parent lines are drawn after the arrows', () => {
  const body = fn('buildMapSvg');
  assert.match(body, /mapOrderRow\(ids, graph, draw\.order, draw\.statuses\)/);
  assert.match(body, /mapRowPositions\(layers, sizes, draw\.align\)/);
  assert.match(body, /buildParentLinesSvg\(graph, pos, layer, draw\.parentSits\)/);
  assert.ok(body.indexOf('map-arrow') < body.indexOf('buildParentLinesSvg('), 'lines after arrows');
});

test('the SVG\'s rich rows and roll-up segments are painted after the markup lands, which the CSP needs', () => {
  const body = fn('buildMapSvg');
  const painted = body.indexOf('svg.innerHTML');
  assert.ok(painted !== -1);
  assert.ok(body.indexOf('paintRollupBars(svg)') > painted, 'segment weights are set through the CSSOM');
  assert.ok(body.indexOf('paintTypeColors(svg)') > painted, 'type colors too');
});

test('a card from another board is named by its mention, with the label of a stub', () => {
  const body = fn('buildMapSvg');
  assert.match(body, /n\.external \? n\.external : `#\$\{id\}`/);
  assert.match(body, /\(other board\)/);
});

test('a click on a roll-up bar flips the Bar setting ahead of any card handling, so the card never opens', () => {
  const handler = appSrc.match(/document\.addEventListener\('click', \(e\) => \{\n    if \(e\.target\.closest\('\.rollup'\)[\s\S]*?\n    const el = e\.target\.closest\('\.card-el'\);/);
  assert.ok(handler, 'the shared click grammar checks .rollup before it looks for a card');
  assert.match(handler[0], /toggleRollupBar\(\); return;/);
  assert.match(fn('mapRichHtml'), /rollupBar\(rich\.rollup, rich\.mode, boardStatuses\(\)\)/, 'the map\'s bar is the board\'s own markup, so the same handler catches it');
});

test('Fit takes in the widest and tallest of the stacked graphs', () => {
  const body = fn('zoomMapFit');
  assert.match(body, /querySelectorAll\('\.map-canvas'\)/);
  assert.match(body, /Math\.max\(fitW/);
  assert.match(body, /fitMapZoom\(fitW, fitH, availableWidth, availableHeight\)/);
});
