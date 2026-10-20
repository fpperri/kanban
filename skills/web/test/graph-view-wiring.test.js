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

test('controls and the layout switch run through one delegated listener on #graph-view, and it has no status pill branch', () => {
  assert.match(src, /wireGraphView\(\$\('#graph-view'\)\)/);
  assert.match(fn('wireGraphView'), /host\.addEventListener\('click'/);
  assert.doesNotMatch(fn('wireGraphView'), /contextmenu|graph-filter-toggle|graphToggleFilter|graphSoloFilter/);
  assert.ok(!/\b(?:b|btn|pill|el)\.addEventListener/.test(src), 'no per-control listeners');
});

test('every focusable control carries graph-control', () => {
  assert.match(fn('graphButton'), /graph-control/);
  assert.ok(!src.includes('graph-filter-toggle'), 'the Graph builds no status pill');
});

test('the Graph top row is the count and the option button, with no status pill row', () => {
  const build = fn('graphBuildControls');
  assert.doesNotMatch(build, /buildFilterPillRow|graph-filter-row|filter/);
  assert.match(build, /graph-count/);
  assert.match(build, /buildViewPanelToggle\('graph'/);
  assert.match(build, /graph-key/);
  assert.ok(!/graph-filter-(row|toggle)/.test(css), 'app.css has no Graph pill rule');
  const app = read('app.js');
  assert.ok(!/function buildFilterPillRow\(/.test(app), 'the per-view pill builder is gone');
  assert.ok(!/REFOCUS_SELECTOR = [^\n]*graph-filter-toggle/.test(app));
  assert.match(css, /\.graph-layout-btn, \.graph-zoom-btn \{/);
});

test('app.css defines every .graph-* class the plan, the view and the key emit', () => {
  const cards = [
    { id: 1, title: 'a', status: 'doing', archived: false, parent: null, waiting_for: [], blocked: false, review: false },
    { id: 2, title: 'b', status: 'done', archived: true, parent: 1, waiting_for: [3], blocked: true, review: true },
    { id: 3, title: 'c', status: 'todo', archived: false, parent: 1, waiting_for: [], blocked: false, review: false },
    { id: 4, title: 'd', status: 'todo', archived: false, parent: 1, waiting_for: [3], blocked: false, review: false },
    { id: 5, title: 'e', status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false },
    { id: 6, title: 'f', status: 'todo', archived: false, parent: 5, waiting_for: [], blocked: false, review: false },
    { id: 7, title: 'g', status: 'done', archived: false, parent: null, waiting_for: [], blocked: false, review: false },
  ];
  const model = graphBuild(cards, { ctx: { board: 'kanban', priorities: [] } });
  const used = new Set();
  for (const kind of GRAPH_LAYOUTS) {
    const plan = graphPlan(model, graphLayout(model, kind, { statuses: ['todo', 'doing', 'done'] }), {
      selectedIds: new Set([1]), hoveredId: 3, kind, statusClass: (s) => s, titleOf: (c) => c.title,
    });
    // The fan's marks: guide arcs, captions, the loose caption, the block's frame, title and column captions.
    const fan = [...plan.guides, ...plan.captions, ...(plan.looseCaption ? [plan.looseCaption] : []),
      ...(plan.block ? [plan.block, plan.block.title, ...plan.block.columns.map((c) => c.caption)] : [])];
    assert.strictEqual(fan.length > 0, kind === 'tiers', `${kind} draws the fan's marks, and the others do not`);
    for (const x of [...plan.nodes, ...plan.links, ...plan.rings, ...fan]) {
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

test('a click on a node is caught in the capture phase whatever the modifier, written to the selection and painted in place', () => {
  const body = fn('wireGraphView');
  const m = body.match(/host\.addEventListener\('click', \(e\) => \{\n    if \(!graphCur\) return;[\s\S]*?\}, true\);/);
  assert.ok(m, 'capture-phase click listener on the host');
  assert.doesNotMatch(m[0], /ctrlKey|metaKey|shiftKey/, 'no modifier lets a click fall through to the shared grammar');
  assert.match(m[0], /closest\('\.graph-node'\)/);
  assert.match(m[0], /e\.stopPropagation\(\)/);
  assert.match(m[0], /graphClickNode\(node\.dataset\.id, e\)/);
  const click = fn('graphClickNode');
  assert.match(click, /plainClick: plainClickBehaviour\('graph'\), ranges: shiftAddsRange\('graph'\)/, 'the Graph asks the lookups for its own answers');
  assert.match(click, /selectByClick\(action, id\)/, 'the selection is written through the step the shared grammar uses');
  const paint = fn('graphPaintSelection');
  assert.match(paint, /classList\.toggle\('selected', selectedIds\.has\(nid\)\)/, 'every node is painted from the id set, so a card taken out loses its mark');
  assert.ok(!/renderBoard|renderGraphView/.test(click + paint), 'painted in place, no rebuild');
});

test('a double click opens the card, Enter opens and Space selects', () => {
  const body = fn('wireGraphView');
  assert.match(body, /host\.addEventListener\('dblclick'[\s\S]*?openCard\(node\.dataset\.id\)/);
  assert.match(body, /host\.addEventListener\('keydown'/);
  assert.match(body, /e\.key === 'Enter'\) \{ e\.preventDefault\(\); if \(!e\.repeat\) openCard\(/);
  assert.match(body, /e\.key === ' '\) \{ e\.preventDefault\(\); graphClickNode\(node\.dataset\.id, \{\}\); \}/, 'Space acts as a plain click');
});

test('a lone selected card keeps its relations lit and a selection lights its cards; hover is temporary and render re-applies the rest focus', () => {
  assert.match(fn('graphRestFocus'), /graphRestLit\(graphCur\.model, \{ selectedIds, loneCardId: graphLoneCardId\(\) \}, graphCur\.lines\)/, 'the lines it lights are the lines drawn');
  assert.match(fn('graphRestFocus'), /graphLightCards\(/);
  assert.match(fn('graphLoneCardId'), /loneCard\(selectionState\.selection\)/);
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

test('the key says the dashed arrow points at the card that waits', () => {
  assert.match(src, /const GRAPH_KEY = '[^']*dashed arrow: points at the card that waits[,']/);
  assert.ok(!src.includes('dashed arrow: waits for'));
});

// --- type icons: the dot is drawn in its type's outline ----------------------------------

const vm = require('node:vm');

function fakeDocument() {
  const make = (tag) => ({
    tag, attrs: {}, children: [], textContent: '', className: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
  });
  return { createElementNS: (ns, tag) => make(tag), createElement: (tag) => make(tag) };
}

function drawn(cards, types) {
  const sandbox = { document: fakeDocument() };
  vm.createContext(sandbox);
  vm.runInContext(`const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';\n${fn('graphEl')}\n${fn('graphTspan')}\n${fn('graphBuildTip')}\n${fn('graphCaptionEl')}\n${fn('graphDrawPlan')}`, sandbox);
  const model = graphBuild(cards, { ctx: { board: 'kanban', priorities: [] }, types });
  const plan = graphPlan(model, graphLayout(model, 'tiers'), { statusClass: (s) => s, titleOf: (c) => c.title });
  const out = vm.runInContext('graphDrawPlan', sandbox)(plan);
  const all = [];
  const walk = (el) => { all.push(el); el.children.forEach(walk); };
  walk(out.stage);
  const nodeOf = (id) => out.nodeEls.get(String(id));
  return { plan, all, nodeOf, node: (id) => plan.nodes.find((n) => n.id === String(id)) };
}

const iconCard = (id, extra = {}) => ({ id: String(id), title: `t${id}`, status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, ...extra });
const kids = (el, cls) => el.children.filter((c) => c.attrs.class === cls);

test('a node of a type with an icon draws its dot as a path in that outline, keeping the dot class', () => {
  const view = drawn([iconCard(1, { type: 'goal' })], [{ name: 'goal', color: '', icon: 'star' }]);
  const g = view.nodeOf(1);
  const dots = kids(g, 'graph-dot');
  assert.strictEqual(dots.length, 1);
  assert.strictEqual(dots[0].tag, 'path');
  assert.strictEqual(dots[0].attrs.d, view.node(1).d);
  assert.match(dots[0].attrs.d, /^M.*Z$/);
  assert.strictEqual(dots[0].attrs['vector-effect'], 'non-scaling-stroke');
  assert.strictEqual(dots[0].attrs.r, undefined);
});

test('a node with no icon, or an unknown one, still draws the round dot', () => {
  const view = drawn([iconCard(1, { type: 'bug' }), iconCard(2), iconCard(3, { type: 'story' })], [
    { name: 'bug', color: '', icon: 'blob' }, { name: 'story', color: '', icon: 'circle' },
  ]);
  for (const id of [1, 2, 3]) {
    const dots = kids(view.nodeOf(id), 'graph-dot');
    assert.strictEqual(dots.length, 1, `card ${id}`);
    assert.strictEqual(dots[0].tag, 'circle', `card ${id}`);
    assert.strictEqual(dots[0].attrs.r, String(view.node(id).r), `card ${id}`);
    assert.strictEqual(dots[0].attrs.d, undefined, `card ${id}`);
  }
});

test('the child and flag rings and the id label are placed from the plan, so they clear the shape', () => {
  const view = drawn([iconCard(1, { type: 'goal', blocked: true }), iconCard(2, { parent: 1 })], [{ name: 'goal', color: '', icon: 'star' }]);
  const g = view.nodeOf(1);
  const n = view.node(1);
  assert.strictEqual(kids(g, 'graph-kids-ring')[0].attrs.r, String(n.kidsRing));
  assert.strictEqual(kids(g, 'graph-flag-ring')[0].attrs.r, String(n.flagRing));
  assert.strictEqual(kids(g, 'graph-node-id')[0].attrs.x, String(n.reach + 3));
  assert.ok(n.kidsRing > n.r + 3, 'a star reaches past a round dot, so its rings sit further out');
});

test('a node with no icon draws the rings and the label where it always did', () => {
  const view = drawn([iconCard(1, { blocked: true }), iconCard(2, { parent: 1 })], []);
  const g = view.nodeOf(1);
  const n = view.node(1);
  assert.strictEqual(kids(g, 'graph-kids-ring')[0].attrs.r, String(n.r + 3));
  assert.strictEqual(kids(g, 'graph-flag-ring')[0].attrs.r, String(n.r + 6));
  assert.strictEqual(kids(g, 'graph-node-id')[0].attrs.x, String(n.r + 3));
});

test('drawing a typed board emits no style attribute and takes no colour from the icon', () => {
  const view = drawn([iconCard(1, { type: 'goal' })], [{ name: 'goal', color: '#a371f7', icon: 'hexagon' }]);
  for (const el of view.all) {
    assert.strictEqual(el.attrs.style, undefined, el.tag);
    assert.strictEqual(el.attrs.fill, undefined, el.tag);
    assert.strictEqual(el.attrs.stroke, undefined, el.tag);
  }
});

test('the render passes the board\'s types list to the model', () => {
  assert.match(fn('renderGraphView'), /graphBuild\(pool, \{[^}]*\btypes: state\.types[^}]*\}\)/);
});

test('the render passes the board\'s hierarchy to the model, so a card is in the band of its tier', () => {
  assert.match(fn('renderGraphView'), /graphBuild\(pool, \{[^}]*\bhierarchy: state\.hierarchy[^}]*\}\)/);
});

test('the Tiers button describes the fan: a band per tier, a ring per depth, a sector per tree and the Unnested block', () => {
  const title = src.match(/tiers: '(Tiers: [^']*)'/);
  assert.ok(title, 'the Tiers title is a plain string');
  assert.match(title[1], /a band for each tier/);
  assert.match(title[1], /tier 1 nearest the centre/);
  assert.match(title[1], /a ring for each depth of the cards without a tier/);
  assert.match(title[1], /a sector for each tree/);
  assert.match(title[1], /Unnested block/);
  assert.match(title[1], /its name \(hover or focus it for its count\)/);
});

test('the dot rule paints a path as well as a circle: filled in the status colour, round-cornered when stroked', () => {
  const rule = css.match(/\.graph-dot \{[^}]*\}/);
  assert.ok(rule, '.graph-dot rule');
  assert.match(rule[0], /fill: currentColor/);
  assert.match(rule[0], /stroke-linejoin: round/);
  assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,8}\b/);
});
