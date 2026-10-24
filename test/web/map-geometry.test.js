const { test } = require('node:test');
const assert = require('node:assert');
const {
  mapRowPositions, mapParentLinePaths, mapRichBox, mapPlural, mapGraphCounts, mapGraphsLabel, mapRootsText,
} = require('../web/map-relations');

const W = 176;
const H = 58;
const GAP_X = 24;
const GAP_Y = 60;
const PAD = 24;
const DIMS = { nodeW: W, nodeH: H, gapX: GAP_X, gapY: GAP_Y, pad: PAD };

const heights = (entries) => new Map(Object.entries(entries).map(([id, h]) => [Number(id), h]));
const rows = (entries) => new Map(Object.entries(entries).map(([layer, ids]) => [Number(layer), ids]));

// --- rows of cards ---------------------------------------------------------------

test('rows go down the page, each as tall as its tallest card, with the gap between', () => {
  const { pos, bottom } = mapRowPositions(rows({ 0: [1, 2], 1: [3] }), heights({ 1: 46, 2: 97, 3: 46 }), 'left', DIMS);
  assert.strictEqual(pos.get(1).y, PAD);
  assert.strictEqual(pos.get(2).y, PAD);
  assert.strictEqual(pos.get(3).y, PAD + 97 + GAP_Y);
  assert.strictEqual(bottom, PAD + 97 + GAP_Y + 46);
});

test('left align starts every row at the left edge, cards a gap apart', () => {
  const { pos } = mapRowPositions(rows({ 0: [1, 2, 3], 1: [4] }), heights({ 1: H, 2: H, 3: H, 4: H }), 'left', DIMS);
  assert.deepStrictEqual([1, 2, 3].map((id) => pos.get(id).x), [PAD, PAD + W + GAP_X, PAD + 2 * (W + GAP_X)]);
  assert.strictEqual(pos.get(4).x, PAD);
});

test('center align centers each row against the widest one', () => {
  const { pos } = mapRowPositions(rows({ 0: [1, 2, 3], 1: [4], 2: [5, 6] }), heights({ 1: H, 2: H, 3: H, 4: H, 5: H, 6: H }), 'center', DIMS);
  const widest = 3 * W + 2 * GAP_X;
  assert.strictEqual(pos.get(1).x, PAD, 'the widest row stays put');
  assert.strictEqual(pos.get(4).x, PAD + (widest - W) / 2);
  assert.strictEqual(pos.get(5).x, PAD + (widest - (2 * W + GAP_X)) / 2);
  assert.strictEqual(pos.get(4).cx, pos.get(4).x + W / 2);
});

test('a position carries its card\'s height, so a line can leave from its bottom', () => {
  const { pos } = mapRowPositions(rows({ 0: [1] }), heights({ 1: 77 }), 'left', DIMS);
  assert.strictEqual(pos.get(1).h, 77);
});

test('each surface places cards by its own card size and gaps', () => {
  const snapshot = { nodeW: 150, nodeH: 54, gapX: 14, gapY: 36, pad: 14 };
  const { pos, bottom } = mapRowPositions(rows({ 0: [1, 2], 1: [3] }), heights({ 1: 54, 2: 54, 3: 54 }), 'left', snapshot);
  assert.deepStrictEqual([pos.get(1).x, pos.get(2).x, pos.get(3).y], [14, 14 + 150 + 14, 14 + 54 + 36]);
  assert.strictEqual(pos.get(2).cx, pos.get(2).x + 75);
  assert.strictEqual(bottom, 14 + 54 + 36 + 54);
});

// --- parent lines -----------------------------------------------------------------

const place = (entries) => new Map(Object.entries(entries).map(([id, [x, y, h = 46]]) => [Number(id), { x, y, h, cx: x + W / 2 }]));
const layers = (entries) => new Map(Object.entries(entries).map(([id, l]) => [Number(id), l]));
const lines = (graph, pos, layer, parentSits = 'below') => mapParentLinePaths({ ghosts: [], edges: [], ...graph }, pos, layer, parentSits, DIMS);

test('a parent below its child: the line runs from the child\'s foot to the parent\'s head', () => {
  const { paths } = lines({ lines: [{ child: 1, parent: 2 }] }, place({ 1: [24, 24], 2: [24, 130] }), layers({ 1: 0, 2: 1 }));
  assert.deepStrictEqual(paths, [{ d: 'M112,70 C112,100 112,100 112,130', dimmed: false }]);
});

test('a parent above its child: the line runs from the parent\'s foot to the child\'s head', () => {
  const { paths } = lines({ lines: [{ child: 2, parent: 1 }] }, place({ 1: [24, 24], 2: [24, 130] }), layers({ 1: 0, 2: 1 }), 'above');
  assert.deepStrictEqual(paths, [{ d: 'M112,70 C112,100 112,100 112,130', dimmed: false }]);
});

test('a line that would lie on a dependency arrow is nudged aside, so both stay visible', () => {
  const { paths } = lines({ lines: [{ child: 1, parent: 2 }], edges: [{ from: 1, to: 2 }] }, place({ 1: [24, 24], 2: [24, 130] }), layers({ 1: 0, 2: 1 }));
  assert.strictEqual(paths[0].d, 'M121,70 C121,100 121,100 121,130', 'both ends move 9px right of the arrow');
});

test('a parent with three or more lines spreads where they meet it, left to right in the order of the children', () => {
  const pos = place({ 1: [24, 24], 2: [224, 24], 3: [424, 24], 9: [224, 130] });
  const group = [3, 1, 2].map((child) => ({ child, parent: 9 }));
  const { paths } = lines({ lines: group }, pos, layers({ 1: 0, 2: 0, 3: 0, 9: 1 }));
  const ends = paths.map((p) => Number(p.d.match(/ (\d+(?:\.\d+)?),130$/)[1]));
  const near = (actual, expected) => actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) < 0.01);
  assert.ok(near(ends, [375.36, 248.64, 312]), `the line from the right-most child meets the parent furthest right: ${ends}`);
  const starts = paths.map((p) => Number(p.d.match(/^M(\d+(?:\.\d+)?),70/)[1]));
  assert.deepStrictEqual(starts, [512, 112, 312], 'each line still leaves from its own child');
});

test('a line that runs against the layout bows out to the side and widens the canvas, like a back edge', () => {
  const { paths, maxX } = lines({ lines: [{ child: 1, parent: 2 }] }, place({ 1: [24, 130], 2: [24, 24] }), layers({ 1: 1, 2: 0 }));
  assert.match(paths[0].d, /^M112,176 C\d+(?:\.\d+)?,176 \d+(?:\.\d+)?,24 112,24$/);
  assert.ok(maxX > 112 + W / 2, 'the bow reaches past the cards');
});

test('a line to or from a stub is dimmed like the stub', () => {
  const { paths } = lines({ lines: [{ child: 1, parent: 2 }], ghosts: [{ id: 2 }] }, place({ 1: [24, 24], 2: [24, 130] }), layers({ 1: 0, 2: 1 }));
  assert.strictEqual(paths[0].dimmed, true);
});

test('a line whose end was not placed is skipped rather than breaking the draw', () => {
  const { paths } = lines({ lines: [{ child: 1, parent: 2 }] }, place({ 1: [24, 24] }), new Map());
  assert.deepStrictEqual(paths, []);
});

test('the bow follows the card width of the surface', () => {
  const narrow = { ...DIMS, nodeW: 100 };
  const pos = new Map([[1, { x: 14, y: 100, h: 46, cx: 64 }], [2, { x: 14, y: 14, h: 46, cx: 64 }]]);
  const { maxX } = mapParentLinePaths({ lines: [{ child: 1, parent: 2 }], ghosts: [], edges: [] }, pos, layers({ 1: 1, 2: 0 }), 'below', narrow);
  assert.strictEqual(maxX, 64 + 100 * 0.65);
});

// --- the rows a rich card holds --------------------------------------------------

const RICH = { top: 40, metaH: 16, barGap: 3, bottom: 8, bareH: 46 };

test('a rich card with nothing under its title is the bare height', () => {
  assert.deepStrictEqual(mapRichBox(false, false, 10, RICH), { metaY: 40, barY: 0, barH: 0, h: 46 });
});

test('a meta row adds its height and the bottom margin', () => {
  assert.deepStrictEqual(mapRichBox(true, false, 10, RICH), { metaY: 40, barY: 0, barH: 0, h: 40 + 16 + 8 });
});

test('a bar alone starts where the title ends; under a meta row it keeps a small gap', () => {
  assert.deepStrictEqual(mapRichBox(false, true, 30, RICH), { metaY: 40, barY: 40, barH: 30, h: 40 + 30 + 8 });
  assert.deepStrictEqual(mapRichBox(true, true, 10, RICH), { metaY: 40, barY: 40 + 16 + 3, barH: 10, h: 40 + 16 + 3 + 10 + 8 });
});

// --- the words over a graph ------------------------------------------------------

test('a count reads singular at one and plural otherwise', () => {
  assert.strictEqual(mapPlural(1, 'card'), '1 card');
  assert.strictEqual(mapPlural(0, 'card'), '0 cards');
  assert.strictEqual(mapPlural(3, 'tree'), '3 trees');
});

test('a graph counts its cards, and its stubs when it has any', () => {
  assert.strictEqual(mapGraphCounts({ nodes: [{}, {}, {}], ghosts: [{}] }), '3 cards + 1 stub');
  assert.strictEqual(mapGraphCounts({ nodes: [{}], ghosts: [] }), '1 card');
});

test('the section label counts trees and cards for one graph per tree, cards alone for one graph', () => {
  const graphs = [{ nodes: [{}, {}, {}] }, { nodes: [{}, {}] }, { nodes: [{}] }];
  assert.strictEqual(mapGraphsLabel(graphs, 'tree'), 'Relation trees (3 trees, 6 cards)');
  assert.strictEqual(mapGraphsLabel([graphs[2]], 'tree'), 'Relation trees (1 tree, 1 card)');
  assert.strictEqual(mapGraphsLabel([graphs[1]], 'one'), 'Relations graph (2 cards)');
});

test('a graph names three roots at most and counts the rest', () => {
  const titleOf = (id) => `T${id}`;
  assert.strictEqual(mapRootsText({ roots: [10] }, titleOf), '#10 T10');
  assert.strictEqual(mapRootsText({ roots: [1, 2, 3] }, titleOf), '#1 T1 · #2 T2 · #3 T3');
  assert.strictEqual(mapRootsText({ roots: [1, 2, 3, 4, 5] }, titleOf), '#1 T1 · #2 T2 · #3 T3 +2 more');
});
