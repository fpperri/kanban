const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const src = read('graph-view.js');
const css = read('app.css');
const { graphBuild, graphLayout, graphPlan, GRAPH_LAYOUTS } = require('../web/graph-model');

function fn(name) {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in graph-view.js`);
  return m[0];
}

test('graph-view.js builds nodes with DOM calls only, never HTML strings or style attributes', () => {
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src));
  assert.ok(!/setAttribute\(\s*['"]style['"]/.test(src));
  assert.ok(!/style=/.test(src));
  assert.ok(/createElementNS/.test(src));
});

test('nodes are stamped from the plan with card-el and data-id and carry no click handler of their own', () => {
  assert.match(src, /graphEl\('g', [\s\S]*?n\.cls\)/);
  assert.match(src, /setAttribute\('data-id', String\(n\.id\)\)/);
  assert.match(src, /graphPlan\(model, layout/);
  assert.ok(!/nodeEls?\.[a-z]*\.?addEventListener|g\.addEventListener|\.graph-node'\)\.addEventListener/.test(src));
});

test('layout and status filter persist per board through storageKey with try/catch', () => {
  for (const key of ['graph.layout', 'graph.statusFilter']) {
    assert.ok(src.includes(`storageKey(state.projectName, '${key}')`), key);
  }
  assert.match(fn('graphLoadLayout'), /try \{[\s\S]*catch/);
  assert.match(fn('graphLoadFilter'), /try \{[\s\S]*catch/);
  assert.match(fn('graphSaveLayout'), /try \{[\s\S]*catch/);
  assert.match(fn('graphSaveFilter'), /try \{[\s\S]*catch/);
  assert.match(fn('graphLoadLayout'), /mergeGraphLayout/);
  assert.match(fn('graphLoadFilter'), /mergeGanttStatusFilter\(saved, boardColumnIds\(\)\)/);
});

test('resetGraphViewState drops the memos', () => {
  const body = fn('resetGraphViewState');
  for (const name of ['graphLayoutKind = null', 'graphStatusFilter = null', 'graphViews.clear()', 'graphCur = null', 'graphPan = null']) {
    assert.ok(body.includes(name), name);
  }
});

test('the wheel listener is non-passive and zooms at the pointer', () => {
  assert.match(src, /addEventListener\('wheel',[\s\S]*?\{ passive: false \}\)/);
  assert.match(src, /graphZoomBy\(/);
});

test('a pan sets isDragging past the threshold, clears it on release and swallows the phantom click', () => {
  assert.match(src, /isDragging = true/);
  assert.match(fn('graphFinishPan'), /isDragging = false/);
  assert.match(fn('graphFinishPan'), /graphSwallowNextClick\(\)/);
  assert.match(fn('graphSwallowNextClick'), /addEventListener\('click', swallow, true\)/);
  assert.ok(src.includes('GRAPH_PAN_THRESHOLD = 4'));
});

test('controls, layout switch and pills run through one delegated listener on #graph-view', () => {
  assert.match(src, /wireGraphView\(\$\('#graph-view'\)\)/);
  assert.match(fn('wireGraphView'), /host\.addEventListener\('click'/);
  assert.match(fn('wireGraphView'), /host\.addEventListener\('contextmenu'/);
  assert.ok(!/\b(?:b|btn|pill|el)\.addEventListener/.test(src), 'no per-control listeners');
});

test('every focusable control carries graph-control', () => {
  assert.match(fn('graphButton'), /graph-control/);
  assert.ok(src.includes("'graph-filter-toggle graph-control'"));
});

test('app.css defines every .graph-* class the plan, the view and the key emit', () => {
  const cards = [
    { id: 1, title: 'a', status: 'doing', archived: false, parent: null, waiting_for: [], blocked: false, review: false },
    { id: 2, title: 'b', status: 'done', archived: true, parent: 1, waiting_for: [3], blocked: true, review: true },
    { id: 3, title: 'c', status: 'todo', archived: false, parent: 1, waiting_for: [], blocked: false, review: false },
    { id: 4, title: 'd', status: 'todo', archived: false, parent: 1, waiting_for: [3], blocked: false, review: false },
  ];
  const model = graphBuild(cards, { ctx: { board: 'kanban', priorities: [] } });
  const used = new Set();
  for (const kind of GRAPH_LAYOUTS) {
    const plan = graphPlan(model, graphLayout(model, kind, { statuses: ['todo', 'doing', 'done'] }), {
      selectedIds: new Set([1]), hoveredId: 3, kind, statusClass: (s) => s, titleOf: (c) => c.title,
    });
    for (const x of [...plan.nodes, ...plan.links, ...plan.rings]) {
      for (const c of x.cls.split(' ')) if (c.startsWith('graph-')) used.add(c);
    }
  }
  for (const c of src.matchAll(/'(graph-[a-z-]+)'/g)) used.add(c[1]);
  for (const c of ['graph-near', 'graph-dim', 'graph-labels-all', 'graph-panning']) used.add(c);
  used.delete('graph-arrow-head');
  used.delete('graph-world');
  const missing = [...used].filter((c) =>!new RegExp(`\\.${c}(?![\\w-])`).test(css));
  assert.deepStrictEqual(missing, []);
  for (const c of ['is-done', 'is-blocked', 'is-waiting', 'is-review', 'has-kids']) {
    assert.ok(new RegExp(`\\.${c}(?![\\w-])`).test(css), c);
  }
});

test('the graph block keeps a CSP-safe, token-only palette', () => {
  const start = css.indexOf('/* Graph view */');
  const end = css.indexOf('/* --- Gantt view');
  assert.ok(start > 0 && end > start);
  const block = css.slice(start, end);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), 'no literal hex colours');
  const defined = new Set([...css.slice(0, css.indexOf('}')).matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
  for (const m of block.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(m[1] === '--graph-k' || defined.has(m[1]), m[1]);
});

test('the transform is O(1): one CSS custom property, no per-label sweeps, one write per frame', () => {
  const body = fn('graphApplyTransform');
  assert.ok(!/querySelectorAll|dataset/.test(body));
  assert.match(body, /style\.setProperty\('--graph-k', String\(k\)\)/);
  assert.match(fn('graphScheduleTransform'), /requestAnimationFrame/);
  assert.ok(!/graphApplyTransform\(\)/.test(fn('graphZoomBy')));
  for (const sel of ['.graph-node-id', '.graph-ring-label', '.graph-title']) {
    const m = css.match(new RegExp(`${sel.replace('.', '\.')} \{[^}]*\}`, 'g')) || [];
    assert.ok(m.some((r) => /font-size: calc\(\d+px \/ var\(--graph-k/.test(r)), sel);
    assert.ok(m.some((r) => /stroke-width: calc\(4px \/ var\(--graph-k/.test(r)), sel);
  }
});

test('resetGraphViewState clears isDragging for a moved pan; lostpointercapture finishes a pan', () => {
  assert.match(fn('resetGraphViewState'), /graphPan\.moved\) isDragging = false/);
  assert.match(fn('wireGraphView'), /addEventListener\('lostpointercapture'/);
});

test('render computes before touching the DOM and survives a throw', () => {
  const body = fn('renderGraphView');
  assert.ok(body.indexOf("host.textContent = ''") > body.indexOf('graphPlan('));
  assert.match(body, /catch \(err\)[\s\S]*console\.error/);
});

test('filter handlers guard with hasOwnProperty; layout re-click and zoom buttons are handled', () => {
  assert.match(fn('graphToggleFilter'), /Object\.prototype\.hasOwnProperty\.call\(filter, col\)/);
  assert.match(fn('graphSoloFilter'), /Object\.prototype\.hasOwnProperty\.call\(filter, col\)/);
  assert.match(fn('wireGraphView'), /=== graphLoadLayout\(\)\) return;/);
  assert.match(fn('wireGraphView'), /zoomBtn\.blur\(\)/);
});

test('a plain click on a node is caught in the capture phase, selects in place and skips modifier clicks', () => {
  const body = fn('wireGraphView');
  const m = body.match(/host\.addEventListener\('click', \(e\) => \{\n    if \(e\.ctrlKey[\s\S]*?\}, true\);/);
  assert.ok(m, 'capture-phase click listener on the host');
  assert.match(m[0], /e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey \|\| !graphCur\) return/);
  assert.match(m[0], /closest\('\.graph-node'\)/);
  assert.match(m[0], /e\.stopPropagation\(\)/);
  assert.match(m[0], /graphSelectOnly\(/);
  const sel = fn('graphSelectOnly');
  assert.match(sel, /selectedIds = new Set\(\[id\]\)/);
  assert.match(sel, /selectionAnchor = id/);
  assert.match(sel, /classList\.toggle\('selected'/);
  assert.ok(!/renderBoard|renderGraphView/.test(sel), 'painted in place, no rebuild');
});

test('a double click opens the card, Enter opens and Space selects', () => {
  const body = fn('wireGraphView');
  assert.match(body, /host\.addEventListener\('dblclick'[\s\S]*?openCard\(Number\(node\.dataset\.id\)\)/);
  assert.match(body, /host\.addEventListener\('keydown'/);
  assert.match(body, /e\.key === 'Enter'\) \{ e\.preventDefault\(\); if \(!e\.repeat\) openCard\(/);
  assert.match(body, /e\.key === ' '\) \{ e\.preventDefault\(\); graphSelectOnly\(/);
});

test('a single selected card keeps its relations lit; hover is temporary and render re-applies the rest focus', () => {
  assert.match(fn('graphRestFocus'), /selectedIds\.size === 1/);
  assert.match(fn('graphRestFocus'), /graphSetFocus\(/);
  assert.match(fn('wireGraphView'), /else graphRestFocus\(\)/);
  const render = fn('renderGraphView');
  assert.ok(render.trim().endsWith('graphSettleFocus();\n}'));
  assert.match(fn('graphSettleFocus'), /hoveredId/);
});

test('the node drag is force-only, left button, no modifier, and starts only past the threshold', () => {
  const body = fn('wireGraphView');
  assert.match(body, /graphCur\.kind !== 'force' \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey \|\| e\.altKey\) return/);
  assert.match(body, /e\.button !== 0/);
  assert.match(fn('graphDragMove'), /GRAPH_PAN_THRESHOLD\) return;\n    graphBeginDrag\(d\)/);
  const begin = fn('graphBeginDrag');
  assert.match(begin, /isDragging = true/);
  assert.match(begin, /graph-dragging/);
  assert.match(begin, /graphForceSim\(graphCur\.model, graphCur\.layout\.pos\)/);
  assert.match(fn('graphDragMove'), /graphWorldPoint\(e\)/);
  assert.match(fn('graphDragMove'), /Math\.max\(d\.alpha, GRAPH_DRAG_ALPHA\)/);
  assert.match(fn('graphDragFrame'), /graphForceStep\(d\.sim, d\.alpha, d\.pin\)/);
  assert.match(fn('graphPaintDrag'), /setAttribute\('transform'/);
  assert.match(fn('graphPaintDrag'), /graphLinkPaths\(/);
  assert.ok(!/renderGraphView/.test(fn('graphPaintDrag')), 'no full re-render per frame');
  assert.ok(src.includes('GRAPH_DRAG_STEPS = 2') && src.includes('GRAPH_COOL_FRAMES = 40'));
});

test('one rAF loop: renderGraphView and resetGraphViewState stop it; every exit clears isDragging', () => {
  assert.match(fn('renderGraphView'), /graphStopDrag\(true\)/);
  assert.ok(fn('renderGraphView').indexOf('graphStopDrag(true)') < fn('renderGraphView').indexOf('graphLoadLayout()'));
  assert.match(fn('resetGraphViewState'), /graphStopDrag\(false\)/);
  assert.match(fn('resetGraphViewState'), /graphArrangements\.clear\(\)/);
  const stop = fn('graphStopDrag');
  assert.match(stop, /cancelAnimationFrame\(d\.raf\)/);
  assert.match(stop, /isDragging = false/);
  assert.match(fn('graphDragKick'), /if \(!d\.raf\)/);
  const wire = fn('wireGraphView');
  assert.match(wire, /host\.addEventListener\('pointercancel', finish\)/);
  assert.match(wire, /host\.addEventListener\('lostpointercapture', finish\)/);
  assert.match(wire, /graphReleaseDrag\(e\)/);
  assert.match(fn('graphReleaseDrag'), /graphSwallowNextClick\(\)/);
  assert.match(fn('graphDragFrame'), /graphStopDrag\(true\)/);
});

test('dragged positions are committed with their signature and applied only when it still matches', () => {
  assert.match(fn('graphStopDrag'), /graphArrangements\.set\(d\.sig, positions\)/);
  const render = fn('renderGraphView');
    assert.match(render, /kind === 'force' && graphArrangements\.has\(sig\)\) layout = graphWithPositions\(layout, model, graphArrangements\.get\(sig\)\)/);
});

test('the force layout shows a grab cursor and a drag a grabbing one, from CSS alone', () => {
  assert.match(css, /\.graph-canvas\.graph-kind-force \.graph-node \{ cursor: grab; \}/);
  assert.match(css, /\.graph-canvas\.graph-dragging[^{]*\{ cursor: grabbing; \}/);
  assert.match(css, /\.graph-canvas \{[^}]*user-select: none/);
  assert.match(src, /classList\.add\(`graph-kind-\$\{kind\}`\)/);
});
