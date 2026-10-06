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

// Where rows and lines fall is tested on the pure module (map-geometry.test.js);
// this file pins the markup the page makes from it.
const { mapParentLinePaths } = require('../web/map-relations');

const GEOMETRY = ['MAP_NODE_W', 'MAP_NODE_H', 'MAP_GAP_X', 'MAP_GAP_Y', 'MAP_PAD', 'MAP_DIMS'];
const W = 176;

function geometrySandbox(extra = {}) {
  const sandbox = { mapParentLinePaths, ...extra };
  vm.createContext(sandbox);
  vm.runInContext([...GEOMETRY.map(constant), fn('buildParentLinesSvg')].join('\n'), sandbox);
  return sandbox;
}

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
