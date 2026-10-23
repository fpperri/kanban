const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { graphLayout, graphPlan } = require('../web/graph-model');
const { miniDocument } = require('./helpers/mini-dom');
const {
  STATUSES, loadBoard, cleanUp, drawnModel,
} = require('./helpers/fan-boards');

// A line the pointer is on lights with the cards at its ends, the rest dimmed as a card's hover dims
// it. Here graph-view.js is run against a small tree of elements: the wide invisible stroke each line
// has to take the pointer, what a hovered line lights, and the line drawn above the others while it is
// lit. graph-lights-wiring.test.js has the events; the browser runner drives the real page
// (scenarios/graph-line-hover.js).

after(cleanUp);

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const src = read('graph-view.js');
const css = read('app.css');

function fn(name) {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in graph-view.js`);
  return m[0];
}

const board = loadBoard('plan');

function stamp(kind = 'hierarchy') {
  const model = drawnModel(board);
  const opts = { kind, statusClass: (s) => s, titleOf: (c) => c.title };
  if (kind === 'hierarchy') opts.fan = { lines: 'all', group: 'brackets', dependencies: 'on', order: 'status', names: 'relevant', unnested: 'outermost' };
  const layout = graphLayout(model, kind, { statuses: STATUSES, order: 'status', unnested: 'outermost', deps: 'frontier' });
  const plan = graphPlan(model, layout, opts);
  const doc = miniDocument();
  doc.createElementNS = (ns, tag) => doc.createElement(tag);
  const sandbox = { document: doc };
  vm.createContext(sandbox);
  const names = ['graphEl', 'graphTspan', 'graphBuildTip', 'graphCaptionEl', 'graphDrawPlan', 'graphClearFocus', 'graphRaiseLine', 'graphLowerLine', 'graphLightCards', 'graphSetLineFocus'];
  vm.runInContext(`const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';\nlet graphCur = null;\n${names.map(fn).join('\n')}`, sandbox);
  const out = vm.runInContext('graphDrawPlan', sandbox)(plan);
  sandbox.out = out;
  sandbox.model = model;
  sandbox.plan = plan;
  vm.runInContext('graphCur = { svg: out.svg, world: out.world, model, plan, linkEls: out.linkEls, countEls: out.countEls, hitEls: out.hitEls, nodeEls: out.nodeEls, headEls: out.headEls, raised: null };', sandbox);
  const index = (from, to, kindOf) => plan.links.findIndex((l) => l.from === from && l.to === to && (!kindOf || l.kind === kindOf));
  const near = (cls) => out.svg.querySelectorAll(`.${cls}`);
  return {
    plan, out, sandbox, index,
    focus: (i) => vm.runInContext(`graphSetLineFocus(${i})`, sandbox),
    clear: () => vm.runInContext('graphClearFocus()', sandbox),
    litNodes: () => [...out.nodeEls].filter(([, el]) => el.classes.includes('graph-near')).map(([id]) => id).sort(),
    litLinks: () => out.linkEls.map((el, i) => (el.classes.includes('graph-near') ? i : -1)).filter((i) => i >= 0),
    dimmed: () => out.svg.classes.includes('graph-dim'),
    order: () => out.world.children.slice(),
    near,
  };
}

test('every line has a wide invisible stroke of its own that takes the pointer, drawn after the lines and before the dots', () => {
  for (const kind of ['hierarchy', 'flow']) {
    const v = stamp(kind);
    assert.ok(v.plan.links.length > 5, `${kind} draws lines`);
    assert.strictEqual(v.out.hitEls.length, v.plan.links.length);
    v.out.hitEls.forEach((hit, i) => {
      assert.ok(hit.classes.includes('graph-link-hit'));
      assert.strictEqual(hit.getAttribute('data-link'), String(i));
      assert.strictEqual(hit.getAttribute('d'), v.plan.links[i].d, 'on the line\'s own path');
      assert.strictEqual(hit.getAttribute('vector-effect'), 'non-scaling-stroke', 'the same width at any zoom');
      assert.strictEqual(hit.getAttribute('tabindex'), null, 'a line has no keyboard focus');
      assert.ok(!hit.classes.includes('graph-link'), 'and none of a line\'s looks');
    });
    const world = v.order();
    const at = (el) => world.indexOf(el);
    const lastLine = Math.max(...v.out.linkEls.map(at), ...v.out.countEls.filter(Boolean).map(at));
    assert.ok(lastLine < Math.min(...v.out.hitEls.map(at)), `${kind}: every hit stroke after the last line and its count`);
    assert.ok(Math.max(...v.out.hitEls.map(at)) < Math.min(...[...v.out.nodeEls.values()].map(at)), `${kind}: and before the first dot, so a dot over a line keeps the pointer`);
  }
});

test('the hit stroke is eight pixels wide, invisible, and takes the pointer by its stroke alone', () => {
  const rule = /\.graph-link-hit \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the style sheet has a rule for it');
  assert.match(rule[1], /stroke-width: 8px/);
  assert.match(rule[1], /stroke: transparent/);
  assert.match(rule[1], /fill: none/);
  assert.match(rule[1], /pointer-events: stroke/);
});

test('a parent line lights itself, its parent and its child, and nothing else, the rest dimmed', () => {
  const v = stamp();
  const i = v.index('1', '2', 'parent');
  assert.ok(i >= 0);
  v.focus(i);
  assert.deepStrictEqual(v.litNodes(), ['1', '2']);
  assert.deepStrictEqual(v.litLinks(), [i]);
  assert.ok(v.dimmed());
});

test('a dependency line lights itself and its two cards, not the parent line that joins other cards to them', () => {
  const v = stamp();
  const i = v.index('7', '8', 'wait');
  assert.ok(i >= 0);
  assert.ok(v.index('2', '8', 'parent') >= 0, 'card 8 also has a parent line');
  v.focus(i);
  assert.deepStrictEqual(v.litNodes(), ['7', '8']);
  assert.deepStrictEqual(v.litLinks(), [i]);
});

test('a bracket lights itself, its parent and every child it holds', () => {
  const v = stamp();
  const i = v.plan.links.findIndex((l) => l.count !== undefined);
  assert.ok(i >= 0);
  const line = v.plan.links[i];
  assert.deepStrictEqual(line.kids, ['3', '4', '5', '6']);
  v.focus(i);
  assert.deepStrictEqual(v.litNodes(), [line.from, ...line.kids].sort());
  assert.deepStrictEqual(v.litLinks(), [i], 'the dependencies between the children stay dim');
  assert.ok(v.dimmed());
});

test('a line in the Flow lights itself and its two cards', () => {
  const v = stamp('flow');
  const i = v.index('7', '8', 'wait');
  assert.ok(i >= 0);
  v.focus(i);
  assert.deepStrictEqual(v.litNodes(), ['7', '8']);
  assert.deepStrictEqual(v.litLinks(), [i]);
  assert.ok(v.dimmed());
});

test('the lit line is drawn above the others while it is lit, and back in its place when the lighting clears', () => {
  const v = stamp();
  const before = v.order();
  const i = v.index('1', '2', 'parent');
  v.focus(i);
  const world = v.order();
  const at = (el) => world.indexOf(el);
  for (const [j, other] of v.out.linkEls.entries()) if (j !== i) assert.ok(at(v.out.linkEls[i]) > at(other), `above line ${j}`);
  assert.ok(at(v.out.linkEls[i]) < at(v.out.hitEls[0]), 'but under the hit strokes and the dots');
  v.clear();
  assert.deepStrictEqual(v.order(), before);
  assert.ok(!v.dimmed());
  assert.deepStrictEqual(v.litNodes(), []);
});

test('a bracket\'s count travels with its line, so the label stays beside the path that the dimming rule reads', () => {
  const v = stamp();
  const before = v.order();
  const i = v.plan.links.findIndex((l) => l.count !== undefined);
  v.focus(i);
  const world = v.order();
  assert.strictEqual(world[world.indexOf(v.out.linkEls[i]) + 1], v.out.countEls[i]);
  assert.ok(world.indexOf(v.out.countEls[i]) < world.indexOf(v.out.hitEls[0]));
  const other = v.out.linkEls[v.index('1', '2', 'parent')];
  v.focus(v.index('1', '2', 'parent'));
  assert.deepStrictEqual(v.order().filter((el) => el !== other), before.filter((el) => el !== other), 'moving to another line puts the bracket and its count back');
  v.clear();
  assert.deepStrictEqual(v.order(), before);
});

test('lines have no click and no tab stop: the host reads a click on a card alone', () => {
  assert.doesNotMatch(src, /graph-link-hit[^\n]*(click|tabindex)/i);
  assert.match(src, /host\.addEventListener\('click', \(e\) => \{\s*if \(!graphCur\) return;\s*const node = e\.target\.closest\('\.graph-node'\);\s*if \(!node\) return;/);
});
