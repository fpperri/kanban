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

const GEOMETRY = ['MAP_NODE_W', 'MAP_NODE_H', 'MAP_GAP_X', 'MAP_GAP_Y', 'MAP_PAD'];
const W = 176;
const H = 58;
const GAP_X = 24;
const GAP_Y = 60;
const PAD = 24;

function geometrySandbox(extra = {}) {
  const sandbox = { ...extra };
  vm.createContext(sandbox);
  vm.runInContext([...GEOMETRY.map(constant), fn('mapRowPositions'), fn('buildParentLinesSvg')].join('\n'), sandbox);
  return sandbox;
}

const sizes = (entries) => new Map(Object.entries(entries).map(([id, h]) => [Number(id), { h }]));
const rows = (entries) => new Map(Object.entries(entries).map(([layer, ids]) => [Number(layer), ids]));
const at = (pos, id) => ({ x: pos.get(id).x, y: pos.get(id).y, h: pos.get(id).h });

// --- rows of cards ---------------------------------------------------------------

test('rows go down the page, each as tall as its tallest card, with the gap between', () => {
  const w = geometrySandbox();
  const { pos, bottom } = w.mapRowPositions(rows({ 0: [1, 2], 1: [3] }), sizes({ 1: 46, 2: 97, 3: 46 }), 'left');
  assert.strictEqual(pos.get(1).y, PAD);
  assert.strictEqual(pos.get(2).y, PAD);
  assert.strictEqual(pos.get(3).y, PAD + 97 + GAP_Y);
  assert.strictEqual(bottom, PAD + 97 + GAP_Y + 46);
});

test('left align starts every row at the left edge, cards a gap apart', () => {
  const w = geometrySandbox();
  const { pos } = w.mapRowPositions(rows({ 0: [1, 2, 3], 1: [4] }), sizes({ 1: H, 2: H, 3: H, 4: H }), 'left');
  assert.deepStrictEqual([1, 2, 3].map((id) => pos.get(id).x), [PAD, PAD + W + GAP_X, PAD + 2 * (W + GAP_X)]);
  assert.strictEqual(pos.get(4).x, PAD);
});

test('center align centers each row against the widest one', () => {
  const w = geometrySandbox();
  const { pos } = w.mapRowPositions(rows({ 0: [1, 2, 3], 1: [4], 2: [5, 6] }), sizes({ 1: H, 2: H, 3: H, 4: H, 5: H, 6: H }), 'center');
  const widest = 3 * W + 2 * GAP_X;
  assert.strictEqual(pos.get(1).x, PAD, 'the widest row stays put');
  assert.strictEqual(pos.get(4).x, PAD + (widest - W) / 2);
  assert.strictEqual(pos.get(5).x, PAD + (widest - (2 * W + GAP_X)) / 2);
  assert.strictEqual(pos.get(4).cx, pos.get(4).x + W / 2);
});

test('a position carries its card\'s height, so a line can leave from its bottom', () => {
  const w = geometrySandbox();
  const { pos } = w.mapRowPositions(rows({ 0: [1] }), sizes({ 1: 77 }), 'left');
  assert.strictEqual(pos.get(1).h, 77);
});

// --- parent lines -----------------------------------------------------------------

const place = (entries) => new Map(Object.entries(entries).map(([id, [x, y, h = 46]]) => [Number(id), { x, y, h, cx: x + W / 2 }]));
const lineClass = 'class="map-edge map-parent-line"';

test('a parent below its child: the line runs from the child\'s foot to the parent\'s head, a dot on the parent', () => {
  const w = geometrySandbox();
  const pos = place({ 1: [24, 24], 2: [24, 130] });
  const { svg } = w.buildParentLinesSvg({ lines: [{ child: 1, parent: 2 }], ghosts: [], edges: [] }, pos, new Map([[1, 0], [2, 1]]), 'below');
  assert.strictEqual(svg, `<path ${lineClass} d="M112,70 C112,100 112,100 112,130" marker-end="url(#map-parent-dot)"></path>`);
});

test('a parent above its child: the line runs from the parent\'s foot to the child\'s head, a dot at its start', () => {
  const w = geometrySandbox();
  const pos = place({ 1: [24, 24], 2: [24, 130] });
  const { svg } = w.buildParentLinesSvg({ lines: [{ child: 2, parent: 1 }], ghosts: [], edges: [] }, pos, new Map([[1, 0], [2, 1]]), 'above');
  assert.strictEqual(svg, `<path ${lineClass} d="M112,70 C112,100 112,100 112,130" marker-start="url(#map-parent-dot)"></path>`);
});

test('a line that would lie on a dependency arrow is nudged aside, so both stay visible', () => {
  const w = geometrySandbox();
  const pos = place({ 1: [24, 24], 2: [24, 130] });
  const graph = { lines: [{ child: 1, parent: 2 }], ghosts: [], edges: [{ from: 1, to: 2 }] };
  const { svg } = w.buildParentLinesSvg(graph, pos, new Map([[1, 0], [2, 1]]), 'below');
  assert.match(svg, /d="M121,70 C121,100 121,100 121,130"/, 'both ends move 9px right of the arrow');
});

test('a parent with three or more lines spreads where they meet it, left to right in the order of the children', () => {
  const w = geometrySandbox();
  const pos = place({ 1: [24, 24], 2: [224, 24], 3: [424, 24], 9: [224, 130] });
  const lines = [3, 1, 2].map((child) => ({ child, parent: 9 }));
  const { svg } = w.buildParentLinesSvg({ lines, ghosts: [], edges: [] }, pos, new Map([[1, 0], [2, 0], [3, 0], [9, 1]]), 'below');
  const ends = [...svg.matchAll(/ (\d+(?:\.\d+)?),130"/g)].map((m) => Number(m[1]));
  const near = (actual, expected) => actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) < 0.01);
  assert.ok(near(ends, [375.36, 248.64, 312]), `the line from the right-most child meets the parent furthest right: ${ends}`);
  const starts = [...svg.matchAll(/d="M(\d+(?:\.\d+)?),70/g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(starts, [512, 112, 312], 'each line still leaves from its own child');
});

test('a line that runs against the layout bows out to the side and widens the canvas, like a back edge', () => {
  const w = geometrySandbox();
  const pos = place({ 1: [24, 130], 2: [24, 24] });
  const { svg, maxX } = w.buildParentLinesSvg({ lines: [{ child: 1, parent: 2 }], ghosts: [], edges: [] }, pos, new Map([[1, 1], [2, 0]]), 'below');
  assert.match(svg, /d="M112,176 C\d+(?:\.\d+)?,176 \d+(?:\.\d+)?,24 112,24"/);
  assert.ok(maxX > 112 + W / 2, 'the bow reaches past the cards');
});

test('a line to or from a stub is dimmed like the stub', () => {
  const w = geometrySandbox();
  const pos = place({ 1: [24, 24], 2: [24, 130] });
  const { svg } = w.buildParentLinesSvg({ lines: [{ child: 1, parent: 2 }], ghosts: [{ id: 2 }], edges: [] }, pos, new Map([[1, 0], [2, 1]]), 'below');
  assert.match(svg, /class="map-edge map-parent-line ghost-edge"/);
});

test('a line whose end was not placed is skipped rather than breaking the draw', () => {
  const w = geometrySandbox();
  const { svg } = w.buildParentLinesSvg({ lines: [{ child: 1, parent: 2 }], ghosts: [], edges: [] }, place({ 1: [24, 24] }), new Map(), 'below');
  assert.strictEqual(svg, '');
});
