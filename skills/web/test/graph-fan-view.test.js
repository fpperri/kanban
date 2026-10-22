const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { graphLayout, graphPlan } = require('../web/graph-model');
const {
  STATUSES, loadBoard, cleanUp, drawnModel, buildOf, card,
} = require('./helpers/fan-boards');

// The view stamps the tier fan's marks from the plan as SVG, with DOM calls and
// classes only: guide arcs, dividers, captions, the loose caption and the Unnested
// block. Here graphDrawPlan runs against a stand-in document, so what is asserted
// is the elements it makes; the browser runner sees them on the real page.

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

function fakeDocument() {
  const make = (tag) => ({
    tag, attrs: {}, children: [], textContent: '', className: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
  });
  return { createElementNS: (ns, tag) => make(tag), createElement: (tag) => make(tag) };
}

function stamp(model, layout, kind) {
  const sandbox = { document: fakeDocument() };
  vm.createContext(sandbox);
  const helpers = ['graphEl', 'graphTspan', 'graphBuildTip', 'graphCaptionEl', 'graphDrawPlan'].map((n) => fn(n)).join('\n');
  vm.runInContext(`const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';\n${helpers}`, sandbox);
  const plan = graphPlan(model, layout, { kind, statusClass: (s) => s, titleOf: (c) => c.title });
  const out = vm.runInContext('graphDrawPlan', sandbox)(plan);
  const all = [];
  const walk = (el) => { all.push(el); el.children.forEach(walk); };
  walk(out.stage);
  const by = (cls) => all.filter((e) => (e.attrs.class || '').split(' ').includes(cls));
  const text = (el) => el.children.map((c) => c.textContent).join('') || el.textContent;
  return { plan, all, by, text, world: out.world };
}

const board = loadBoard('plan');
const fanOf = (kind) => {
  const model = drawnModel(board);
  return stamp(model, graphLayout(model, kind, { statuses: STATUSES, unnested: 'table' }), kind);
};

test('the fan is stamped from the plan: an arc for each guide, a line for each divider, both hairlines at any zoom', () => {
  const v = fanOf('tiers');
  const guides = v.by('graph-guide');
  assert.strictEqual(guides.length, v.plan.guides.length);
  assert.ok(guides.length >= 7);
  guides.forEach((g, i) => {
    assert.strictEqual(g.tag, 'path');
    assert.strictEqual(g.attrs.d, v.plan.guides[i].d);
    assert.strictEqual(g.attrs['vector-effect'], 'non-scaling-stroke');
  });
  assert.strictEqual(v.by('graph-guide-empty').length, v.plan.guides.filter((g) => g.cls.includes('graph-guide-empty')).length);
  const dividers = v.by('graph-divider');
  assert.strictEqual(dividers.length, v.plan.dividers.length);
  assert.ok(dividers.length >= 1);
  dividers.forEach((d, i) => {
    assert.strictEqual(d.tag, 'line');
    assert.deepStrictEqual([d.attrs.x1, d.attrs.y1, d.attrs.x2, d.attrs.y2], ['x1', 'y1', 'x2', 'y2'].map((k) => String(v.plan.dividers[i][k])));
    assert.strictEqual(d.attrs['vector-effect'], 'non-scaling-stroke');
  });
});

test('a caption is a text with its name in one tspan, at its place on the seam, its text running away from it', () => {
  const v = fanOf('tiers');
  const captions = v.by('graph-caption').filter((c) => !c.attrs.class.includes('graph-loose-caption'));
  assert.strictEqual(captions.length, v.plan.captions.length);
  captions.forEach((c, i) => {
    const want = v.plan.captions[i];
    assert.strictEqual(c.tag, 'text');
    assert.deepStrictEqual([c.attrs.x, c.attrs.y, c.attrs.dy, c.attrs['text-anchor']], [String(want.x), String(want.y), want.dy, want.anchor]);
    assert.deepStrictEqual(c.children.map((t) => [t.tag, t.textContent]), [['tspan', want.name]]);
    assert.strictEqual(c.children[0].attrs.class, 'graph-caption-name');
    assert.strictEqual(c.attrs['data-kind'], want.kind, 'a caption says whether it names a tier or a depth');
  });
  assert.deepStrictEqual(captions.slice(0, 4).map((c) => v.text(c)), ['goal', 'strategy', 'objective', 'epic']);
  assert.deepStrictEqual(captions.slice(0, 4).map((c) => c.attrs['text-anchor']), ['end', 'start', 'end', 'start'], 'neighbours take opposite sides of the seam');
});

test('the loose caption is stamped where the plan puts it, outside the rim, anchored as the plan says', () => {
  const v = fanOf('tiers');
  const [c] = v.by('graph-loose-caption');
  assert.ok(c);
  assert.deepStrictEqual([c.attrs.x, c.attrs.y, c.attrs.dy, c.attrs['text-anchor']], ['x', 'y', 'dy', 'anchor'].map((k) => String(v.plan.looseCaption[k])));
  const lone = buildOf([card(1, { type: 'goal' }), card(2, { type: 'epic' })]);
  const bottom = stamp(lone, graphLayout(lone, 'tiers', { statuses: STATUSES, unnested: 'table' }), 'tiers').by('graph-loose-caption')[0];
  assert.strictEqual(bottom.attrs['text-anchor'], 'middle', 'a caption under the fan is centred on its point');
  assert.deepStrictEqual(c.children.map((t) => t.textContent), ['Unnested, with a tier']);
});

test('the Unnested block is a frame, a title and a caption for each column, and its dots are the nodes', () => {
  const v = fanOf('tiers');
  const [frame] = v.by('graph-block-frame');
  assert.strictEqual(frame.tag, 'rect');
  assert.deepStrictEqual([frame.attrs.x, frame.attrs.y, frame.attrs.width, frame.attrs.height], [v.plan.block.x, v.plan.block.y, v.plan.block.w, v.plan.block.h].map(String));
  assert.strictEqual(frame.attrs['vector-effect'], 'non-scaling-stroke');
  const [title] = v.by('graph-block-title');
  assert.deepStrictEqual(title.children.map((t) => t.textContent), ['Unnested']);
  assert.strictEqual(title.attrs.dy, '-1.5em');
  assert.strictEqual(title.attrs['text-anchor'], 'start');
  const captions = v.by('graph-block-caption');
  assert.deepStrictEqual(captions.map((c) => c.children.map((t) => t.textContent)), v.plan.block.columns.map((c) => [c.label]));
  assert.deepStrictEqual(captions.map((c) => c.attrs.x), v.plan.block.columns.map((c) => String(c.caption.x)));
  assert.strictEqual(v.all.filter((e) => (e.attrs.class || '').split(' ').includes('graph-node')).length, v.plan.nodes.length);
});

test('the force and status layouts stamp none of it, and the status layout keeps its rings and labels', () => {
  for (const kind of ['force', 'status']) {
    const v = fanOf(kind);
    for (const cls of ['graph-guide', 'graph-divider', 'graph-caption', 'graph-block-frame', 'graph-block-title', 'graph-block-caption', 'graph-loose-caption']) {
      assert.strictEqual(v.by(cls).length, 0, `${kind}: ${cls}`);
    }
  }
  const status = fanOf('status');
  assert.ok(status.by('graph-ring').length >= 4);
  assert.ok(status.by('graph-ring-label').length >= 4);
});

test('the view makes the marks with DOM calls and classes only: no style attribute, no fill or stroke attribute, no markup string', () => {
  const v = fanOf('tiers');
  for (const el of v.all) {
    for (const k of ['style', 'fill', 'stroke']) assert.strictEqual(el.attrs[k], undefined, `${el.tag} ${k}`);
  }
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src));
  assert.ok(!/style=/.test(src));
});

test('app.css has a rule for each class the fan\'s marks use, drawn in tokens and sized for the screen', () => {
  const v = fanOf('tiers');
  const used = new Set();
  for (const el of v.all) for (const c of (el.attrs.class || el.className || '').split(' ')) if (c.startsWith('graph-')) used.add(c);
  for (const c of ['graph-guide', 'graph-divider', 'graph-caption', 'graph-caption-name', 'graph-loose-caption', 'graph-block-frame', 'graph-block-title', 'graph-block-caption', 'graph-tip']) {
    assert.ok(used.has(c), `${c} is stamped`);
  }
  for (const c of ['graph-guide', 'graph-guide-empty', 'graph-guide-sub', 'graph-divider', 'graph-caption', 'graph-caption-muted', 'graph-caption-name',
    'graph-loose-caption', 'graph-block-frame', 'graph-block-title', 'graph-block-caption', 'graph-tip', 'graph-tip-line', 'graph-tip-term']) {
    assert.ok(new RegExp(`\\.${c}(?![\\w-])`).test(css), `${c} has a rule`);
  }
  for (const sel of ['.graph-caption', '.graph-block-title', '.graph-block-caption']) {
    const rules = css.match(new RegExp(`${sel.replace('.', '\\.')}[^{]*\\{[^}]*\\}`, 'g')) || [];
    assert.ok(rules.some((r) => /font-size: calc\(\d+px \/ var\(--graph-k/.test(r)), `${sel} keeps a size on screen at any zoom`);
  }
});
