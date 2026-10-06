const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const { buildRelationsGraph, layerNodes, treeIds } = require('../web/dependency-graph');
const { MAP_OPTION_DEFAULTS, mapShapeRelations, mapOrderRow } = require('../web/map-relations');
const { rollupIndex } = require('../web/nesting');
const { card, familyChainingToOneEnd, treeWithArchivedAndBacklogChildren } = require('./map-fixtures');

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

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const STATUSES = ['backlog', 'todo', 'doing', 'done'];

// The real drawing functions with a stand-in for the few browser calls they make:
// what is under test is the markup a graph turns into.
function drawing(cards, { mode = 'collapsed' } = {}) {
  const priority = require('../web/priority-badge');
  const colors = require('../web/status-colors');
  const badges = require('../web/assignee-badge');
  const cardTitle = require('../web/card-title');
  const rollups = require('../web/rollup-bar');
  const typeBadge = require('../web/type-badge');
  const colState = require('../web/column-state');
  const created = [];
  const sandbox = {
    document: {
      createElementNS: () => {
        const el = { attrs: {}, dataset: {}, innerHTML: '', setAttribute(k, v) { el.attrs[k] = v; } };
        created.push(el);
        return el;
      },
    },
    escapeHtml: badges.escapeHtml,
    cardTitleDisplay: cardTitle.cardTitleDisplay,
    priorityBadge: priority.priorityBadge,
    statusColorClass: colors.statusColorClass,
    isHoverHighlighted: () => false,
    hoveredId: null,
    selectedIds: new Set(),
    state: { priorities: CTX.priorities, types: [] },
    typeBadge: typeBadge.typeBadge,
    altitudeBadge: rollups.altitudeBadge,
    rollupBar: rollups.rollupBar,
    ROLLUP_BAR_OPEN: colState.ROLLUP_BAR_OPEN,
    nestingIndex: rollupIndex(cards, CTX),
    loadRollupBarMode: () => mode,
    loadRollupCountArchived: () => true,
    boardStatuses: () => STATUSES,
    paintRollupBars: () => {},
    paintTypeColors: () => {},
    mapOrderRow,
  };
  vm.createContext(sandbox);
  vm.runInContext([
    'MAP_NODE_W', 'MAP_NODE_H', 'MAP_GAP_X', 'MAP_GAP_Y', 'MAP_PAD', 'MAP_RICH_TOP', 'MAP_RICH_META_H', 'MAP_RICH_BAR_OPEN_H', 'MAP_RICH_BAR_THIN_H',
  ].map(constant).concat(['truncateLabel', 'mapRichLayout', 'mapNodeSize', 'mapRichHtml', 'mapRowPositions', 'buildMapSvg', 'buildParentLinesSvg'].map(fn)).join('\n'), sandbox);
  return sandbox;
}

// Draws the graphs of a search such as tree:<id> under the options, as the Map does.
function draw(cards, options = {}, rootId = null, extra = {}) {
  const visible = rootId == null ? null : treeIds(cards, rootId, CTX);
  const merged = { ...MAP_OPTION_DEFAULTS, ...options };
  const view = mapShapeRelations(buildRelationsGraph(cards, visible, CTX), merged);
  const w = drawing(cards, extra);
  const look = {
    parentSits: merged.parent, align: merged.align, order: merged.order, statuses: STATUSES,
    rich: merged.cards === 'rich', byId: new Map(cards.map((c) => [c.id, c])),
  };
  const svgs = view.graphs.map((g) => w.buildMapSvg(g, layerNodes(g.ids, g.layoutEdges), look));
  return { view, svgs, html: svgs.map((s) => s.innerHTML).join('\n') };
}

const count = (html, needle) => html.split(needle).length - 1;
const nodeOf = (html, id) => html.match(new RegExp(`<g class="map-node[^"]*" transform="translate\\(([\\d.]+),([\\d.]+)\\)" data-id="${id}"[\\s\\S]*?\\n?</g>`));
const placed = (html, id) => {
  const m = html.match(new RegExp(`<g class="map-node[^"]*" transform="translate\\(([\\d.]+),([\\d.]+)\\)" data-id="${id}"`));
  return m && [Number(m[1]), Number(m[2])];
};

test('a family searched by its parent shows the parent below its children with exactly one dashed line', () => {
  const { html, svgs } = draw(familyChainingToOneEnd(), {}, 10);
  assert.strictEqual(svgs.length, 1);
  assert.strictEqual(count(html, 'map-parent-line'), 1);
  assert.strictEqual(count(html, 'marker-end="url(#map-parent-dot)"'), 1, 'the dot is on the parent');
  const lowest = Math.max(...[10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((id) => placed(html, id)[1]));
  assert.strictEqual(placed(html, 10)[1], lowest, '10 is in the last row');
  assert.ok([11, 12, 13, 14, 15, 16, 17, 18, 19].every((id) => placed(html, id)[1] < placed(html, 10)[1]));
});

test('with the parent above, two dashed lines, and the parent is in the first row', () => {
  const { html } = draw(familyChainingToOneEnd(), { parent: 'above' }, 10);
  assert.strictEqual(count(html, 'map-parent-line'), 2);
  assert.strictEqual(count(html, 'marker-start="url(#map-parent-dot)"'), 2);
  assert.strictEqual(placed(html, 10)[1], 24);
});

test('parent lines all draws one for each of the nine children, off draws none', () => {
  assert.strictEqual(count(draw(familyChainingToOneEnd(), { parentLines: 'all' }, 10).html, 'map-parent-line'), 9);
  assert.strictEqual(count(draw(familyChainingToOneEnd(), { parentLines: 'off' }, 10).html, 'map-parent-line'), 0);
});

test('dependency lines off leaves the solid arrows out and the dashed lines in', () => {
  const on = draw(familyChainingToOneEnd(), {}, 10).html;
  const off = draw(familyChainingToOneEnd(), { depLines: 'off' }, 10).html;
  assert.strictEqual(count(on, 'class="map-edge"'), 12);
  assert.strictEqual(count(off, 'class="map-edge"'), 0);
  assert.strictEqual(count(off, 'map-parent-line'), 1);
});

test('with layout keep, turning lines off moves no card on the page', () => {
  const cards = familyChainingToOneEnd();
  const reference = draw(cards, {}, 10).html;
  for (const options of [{ parentLines: 'off' }, { depLines: 'off' }, { parentLines: 'all', depLines: 'off' }]) {
    const html = draw(cards, options, 10).html;
    for (const id of [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
      assert.deepStrictEqual(placed(html, id), placed(reference, id), `#${id} under ${JSON.stringify(options)}`);
    }
  }
});

test('in the tree with archived and backlog children, the top row starts with the backlog ones', () => {
  const { html } = draw(treeWithArchivedAndBacklogChildren(), {}, 40);
  const top = [41, 47, 48, 49, 50, 51].map((id) => ({ id, x: placed(html, id)[0], y: placed(html, id)[1] }));
  assert.ok(top.every((n) => n.y === top[0].y), 'they share the first row');
  assert.deepStrictEqual(top.sort((a, b) => a.x - b.x).map((n) => n.id), [47, 48, 41, 49, 50, 51]);
});

test('with row order by layout the same row is in id order', () => {
  const { html } = draw(treeWithArchivedAndBacklogChildren(), { order: 'layout' }, 40);
  const top = [41, 47, 48, 49, 50, 51].map((id) => ({ id, x: placed(html, id)[0] }));
  assert.deepStrictEqual(top.sort((a, b) => a.x - b.x).map((n) => n.id), [41, 47, 48, 49, 50, 51]);
});

test('one per tree draws one canvas per tree; one graph draws a single canvas', () => {
  const cards = [...familyChainingToOneEnd(), ...treeWithArchivedAndBacklogChildren(), card(500, 'todo'), card(501, 'todo', { waiting_for: [500] })];
  assert.strictEqual(draw(cards).svgs.length, 3);
  assert.strictEqual(draw(cards, { group: 'one' }).svgs.length, 1);
});

test('align left starts the first column at the edge in every row; center moves the short rows in', () => {
  const left = draw(treeWithArchivedAndBacklogChildren(), { align: 'left' }, 40).html;
  const center = draw(treeWithArchivedAndBacklogChildren(), { align: 'center' }, 40).html;
  assert.strictEqual(placed(left, 40)[0], 24);
  assert.ok(placed(center, 40)[0] > 24, 'the one-card bottom row is centered under the wide top row');
});

test('rich nodes show the type chip, the altitude badge and the roll-up bar of a parent; plain nodes show none', () => {
  const cards = familyChainingToOneEnd().map((c) => (c.id === 10 ? { ...c, type: 'epic' } : c));
  const rich = draw(cards, { cards: 'rich' }, 10).html;
  assert.match(rich, /type-chip[^>]*>epic</);
  assert.match(rich, /alt-badge/);
  assert.match(rich, /<div class="rollup">/);
  const plain = draw(cards, { cards: 'plain' }, 10).html;
  assert.doesNotMatch(plain, /type-chip|alt-badge|class="rollup"/);
});

test('a rich node is as tall as its content: the parent with a bar is the tallest, and the rect says so', () => {
  const cards = familyChainingToOneEnd().map((c) => (c.id === 10 ? { ...c, type: 'epic' } : c));
  const { html } = draw(cards, {}, 10);
  const heightOf = (id) => Number(nodeOf(html, id)[0].match(/<rect width="176" height="(\d+)"/)[1]);
  assert.ok(heightOf(10) > heightOf(11));
  assert.ok(heightOf(11) < 58);
});

test('a parent on another board is a labelled stub, and its dashed line is dimmed', () => {
  const { html } = draw([card(2, 'todo', { parent: 'shop#7' })]);
  assert.match(html, /shop#7/);
  assert.match(html, /\(other board\)/);
  assert.match(html, /class="map-edge map-parent-line ghost-edge"/);
});

test('every card-derived string is escaped, a parent mention included', () => {
  const { html } = draw([card(2, 'todo', { title: '<b>x</b>', parent: 'sh<i>op#7' })]);
  assert.ok(!html.includes('<b>x'));
  assert.ok(!html.includes('<i>'));
});
