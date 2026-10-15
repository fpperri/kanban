const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { graphLayout, graphPlan, graphTipAt } = require('../web/graph-model');
const {
  STATUSES, loadBoard, cleanUp, drawnModel,
} = require('./helpers/fan-boards');

// The tier fan's captions show a name and nothing more; hovering or focusing one shows
// its tip (graph-fan-tips.test.js has what the tip says). Here graph-view.js is run
// against a stand-in document: the elements it stamps for a caption, the one tooltip
// they share, what showing and hiding it does, and which events the host listens to.
// The browser runner sees the same on the real page.

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

function make(tag) {
  return {
    tag, attrs: {}, children: [], textContent: '', className: '', hidden: false, style: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    replaceChildren(...els) { this.children = els; },
  };
}
const fakeDocument = () => ({ createElementNS: (ns, tag) => make(tag), createElement: (tag) => make(tag) });

const board = loadBoard('plan');

function stamp() {
  const model = drawnModel(board);
  const plan = graphPlan(model, graphLayout(model, 'tiers', { statuses: STATUSES, unnested: 'table' }), { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title });
  const sandbox = { document: fakeDocument() };
  vm.createContext(sandbox);
  const helpers = ['graphEl', 'graphTspan', 'graphBuildTip', 'graphCaptionEl', 'graphDrawPlan'].map((n) => fn(n)).join('\n');
  vm.runInContext(`const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';\n${helpers}`, sandbox);
  const out = vm.runInContext('graphDrawPlan', sandbox)(plan);
  const all = [];
  const walk = (el) => { all.push(el); el.children.forEach(walk); };
  walk(out.stage);
  const by = (cls) => all.filter((e) => (e.attrs.class || e.className || '').split(' ').includes(cls));
  return { plan, out, all, by };
}

// --- what is stamped --------------------------------------------------------------------------

test('every caption of the fan can be reached by keyboard and carries its tip: the lines and, for a slice, the term', () => {
  const v = stamp();
  const tipped = (els, marks) => {
    assert.strictEqual(els.length, marks.length);
    els.forEach((el, i) => {
      const { tip } = marks[i];
      assert.strictEqual(el.attrs.tabindex, '0', `${marks[i].name} is a tab stop`);
      assert.strictEqual(el.attrs['data-tip'], tip.lines.join('\n'), `${marks[i].name}'s lines`);
      assert.strictEqual(el.attrs['data-term'], tip.term === null ? undefined : tip.term, `${marks[i].name}'s term`);
    });
  };
  tipped(v.by('graph-caption').filter((c) => !c.attrs.class.includes('graph-loose-caption')), v.plan.captions);
  tipped(v.by('graph-loose-caption'), [v.plan.looseCaption]);
  tipped(v.by('graph-block-title'), [v.plan.block.title]);
  tipped(v.by('graph-block-caption'), v.plan.block.columns.map((c) => c.caption));
  assert.strictEqual(v.by('graph-caption')[0].attrs['data-term'], 'slice:goal');
});

test('a caption is its name alone: no count in the text, and no element made for one', () => {
  const v = stamp();
  const texts = v.all.filter((e) => /(^| )graph-(caption|block-title|block-caption)( |$)/.test(e.attrs.class || ''));
  assert.ok(texts.length >= 14, 'the tier and depth captions, the loose caption, the title and the columns');
  for (const t of texts) {
    assert.strictEqual(t.children.length, 1, `${t.attrs.class}: one tspan, the name`);
    assert.strictEqual(t.children[0].attrs.class, 'graph-caption-name');
  }
  assert.strictEqual(v.by('graph-caption-count').length, 0);
  assert.deepStrictEqual(v.by('graph-caption').slice(0, 4).map((c) => c.children[0].textContent), ['goal', 'strategy', 'objective', 'epic']);
  assert.ok(!/graph-caption-count/.test(css), 'and the style sheet has no rule for one');
});

test('the stage holds one tooltip, hidden to begin with, for the captions to share', () => {
  const v = stamp();
  const tips = v.by('graph-tip');
  assert.strictEqual(tips.length, 1);
  assert.strictEqual(v.out.tip, tips[0]);
  assert.strictEqual(tips[0].tag, 'div');
  assert.strictEqual(tips[0].attrs.role, 'tooltip');
  assert.strictEqual(tips[0].id, 'graph-tip', 'a caption names it by this id');
  assert.strictEqual(tips[0].hidden, true);
  assert.ok(v.out.stage.children.includes(tips[0]), 'it is in the stage, which it is placed on');
});

test('the captions are drawn under the dots and the links, so a dot under one keeps the pointer', () => {
  const v = stamp();
  const world = v.out.world.children;
  const first = (pred) => world.findIndex(pred);
  const classOf = (e) => (e.attrs.class || '').split(' ');
  const lastCaption = world.map((e, i) => (/graph-(caption|block-title|block-caption)/.test(e.attrs.class || '') ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(lastCaption >= 0);
  assert.ok(lastCaption < first((e) => classOf(e).includes('graph-link')), 'every caption comes before the first link');
  assert.ok(lastCaption < first((e) => classOf(e).includes('graph-node')), 'and before the first dot');
});

// --- showing and hiding the tip -----------------------------------------------------------------

function tipPage() {
  const doc = fakeDocument();
  const stage = make('div');
  stage.getBoundingClientRect = () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 });
  const tip = doc.createElement('div');
  tip.id = 'graph-tip';
  tip.hidden = true;
  tip.offsetWidth = 160;
  tip.offsetHeight = 60;
  stage.appendChild(tip);
  const sandbox = { document: doc, graphCur: { tip, tipFor: null }, graphTipAt, graphRound: (n) => n };
  vm.createContext(sandbox);
  const gap = src.match(/const GRAPH_TIP_GAP = \d+;/);
  assert.ok(gap, 'the gap under a caption is a named constant');
  vm.runInContext(`${gap[0]}\n${['graphTipLine', 'graphShowTip', 'graphHideTip'].map((n) => fn(n)).join('\n')}`, sandbox);
  const caption = (data, term, rect) => {
    const el = doc.createElement('text');
    el.setAttribute('data-tip', data);
    if (term) el.setAttribute('data-term', term);
    el.getBoundingClientRect = () => rect;
    return el;
  };
  return {
    tip,
    caption,
    show: vm.runInContext('graphShowTip', sandbox),
    hide: vm.runInContext('graphHideTip', sandbox),
    page: sandbox,
  };
}
const lines = (tip) => tip.children.map((c) => [c.className, c.textContent]);

test('showing a caption fills the tip with its lines and its term, under the caption on the stage, and names it for assistive technology', () => {
  const t = tipPage();
  const goal = t.caption('2 cards\nbacklog 1 · doing 1', 'slice:goal', { left: 300, top: 250, right: 360, bottom: 264 });
  t.show(goal);
  assert.strictEqual(t.tip.hidden, false);
  assert.deepStrictEqual(lines(t.tip), [['graph-tip-line', '2 cards'], ['graph-tip-line', 'backlog 1 · doing 1'], ['graph-tip-term', 'slice:goal']]);
  assert.deepStrictEqual([t.tip.style.left, t.tip.style.top], ['200px', '220px'], 'in the stage\'s own pixels, under the caption');
  assert.strictEqual(goal.attrs['aria-describedby'], 'graph-tip');
});

test('a caption with no term shows its lines only', () => {
  const t = tipPage();
  t.show(t.caption('13 cards\nbacklog 4', '', { left: 300, top: 250, right: 360, bottom: 264 }));
  assert.deepStrictEqual(lines(t.tip), [['graph-tip-line', '13 cards'], ['graph-tip-line', 'backlog 4']]);
});

test('the tip is kept on the stage: pushed in from the edge, and above a caption that has no room under it', () => {
  const t = tipPage();
  t.show(t.caption('1 card', '', { left: 880, top: 620, right: 900, bottom: 634 }));
  assert.deepStrictEqual([t.tip.style.left, t.tip.style.top], ['640px', '504px'], 'right edge and bottom of the stage');
});

test('the tip is measured before it is placed, from a corner it cannot be squeezed against', () => {
  const t = tipPage();
  const sizes = [];
  Object.defineProperty(t.tip, 'offsetWidth', { get() { sizes.push([this.style.left, this.style.top]); return 160; } });
  t.show(t.caption('1 card', '', { left: 880, top: 100, right: 900, bottom: 114 }));
  assert.deepStrictEqual(sizes, [['0px', '0px']]);
});

test('showing another caption names that one, and hiding takes the name off and hides the tip', () => {
  const t = tipPage();
  const a = t.caption('1 card', '', { left: 300, top: 250, right: 360, bottom: 264 });
  const b = t.caption('2 cards', '', { left: 300, top: 300, right: 360, bottom: 314 });
  t.show(a);
  t.show(b);
  assert.strictEqual(a.attrs['aria-describedby'], undefined);
  assert.strictEqual(b.attrs['aria-describedby'], 'graph-tip');
  assert.deepStrictEqual(lines(t.tip), [['graph-tip-line', '2 cards']]);
  t.hide();
  assert.strictEqual(t.tip.hidden, true);
  assert.strictEqual(b.attrs['aria-describedby'], undefined);
  assert.strictEqual(t.page.graphCur.tipFor, null);
  t.hide();
  assert.strictEqual(t.tip.hidden, true, 'hiding a hidden tip is nothing');
});

test('with no Graph on the page, showing and hiding do nothing and do not throw', () => {
  const t = tipPage();
  t.page.graphCur = null;
  assert.doesNotThrow(() => { t.show(t.caption('1 card', '', { left: 0, top: 0, right: 1, bottom: 1 })); t.hide(); });
  t.page.graphCur = { tip: null };
  assert.doesNotThrow(() => { t.show(t.caption('1 card', '', { left: 0, top: 0, right: 1, bottom: 1 })); t.hide(); });
});

test('panning or zooming moves the caption from under the tip, so the transform hides it', () => {
  assert.match(fn('graphApplyTransform'), /graphHideTip\(\)/);
});

test('a new render keeps the tip in the Graph it draws, hidden, and with nothing named', () => {
  assert.match(fn('renderGraphView'), /tip: drawn\.tip, tipFor: null/);
});

// --- the events the host listens to --------------------------------------------------------------------

function wired() {
  const handlers = {};
  const calls = [];
  const host = { addEventListener(type, handler) { (handlers[type] = handlers[type] || []).push(handler); } };
  const sandbox = {
    graphCur: null, hoveredId: null, isDragging: false,
    graphShowTip: (el) => calls.push(['show', el]), graphHideTip: () => calls.push(['hide']),
    graphSetFocus() {}, graphRestFocus() {}, graphDragMove() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fn('wireGraphView'), sandbox);
  vm.runInContext('wireGraphView', sandbox)(host);
  const dispatch = (type, event) => (handlers[type] || []).forEach((h) => h(event));
  return { calls, dispatch };
}
// A target the way the page's elements answer closest(): the caption for its selector, nothing for the rest.
const inside = (caption) => ({ closest: (sel) => (sel === '[data-tip]' ? caption : null) });
const elsewhere = { closest: () => null };

test('hovering a caption, or moving focus onto it, shows its tip', () => {
  for (const type of ['mouseover', 'focusin']) {
    const w = wired();
    const caption = { id: 'a caption' };
    w.dispatch(type, { target: inside(caption), relatedTarget: null });
    assert.deepStrictEqual(w.calls, [['show', caption]], type);
  }
});

test('leaving a caption, or moving focus off it, hides its tip, unless the pointer only passes between the parts of the same caption', () => {
  for (const type of ['mouseout', 'focusout']) {
    const w = wired();
    const caption = { id: 'a caption' };
    w.dispatch(type, { target: inside(caption), relatedTarget: elsewhere });
    w.dispatch(type, { target: inside(caption), relatedTarget: null });
    assert.deepStrictEqual(w.calls, [['hide'], ['hide']], type);
    const same = wired();
    same.dispatch(type, { target: inside(caption), relatedTarget: inside(caption) });
    assert.deepStrictEqual(same.calls, [], `${type} within one caption`);
    const other = wired();
    other.dispatch(type, { target: inside(caption), relatedTarget: inside({ id: 'next' }) });
    assert.deepStrictEqual(other.calls, [['hide']], `${type} to another caption`);
  }
});

test('the pointer or focus on anything that is not a caption leaves the tip alone', () => {
  const w = wired();
  for (const type of ['mouseover', 'mouseout', 'focusin', 'focusout']) w.dispatch(type, { target: elsewhere, relatedTarget: elsewhere });
  assert.deepStrictEqual(w.calls, []);
});

// --- the style sheet ------------------------------------------------------------------------------------

const escaped = (sel) => sel.replace(/[.[\]]/g, (c) => `\\${c}`);
const rule = (sel) => {
  const m = css.match(new RegExp(`(?:^|\n)${escaped(sel)}\\s*\\{[^}]*\\}`));
  assert.ok(m, `a rule for ${sel}`);
  return m[0];
};

test('a caption takes the pointer, and a tip is a small token-coloured panel on the stage that never takes it', () => {
  for (const sel of ['.graph-caption', '.graph-block-caption', '.graph-block-title']) {
    const rules = css.match(new RegExp(`${escaped(sel)}[^{]*\\{[^}]*\\}`, 'g')) || [];
    assert.ok(rules.some((r) => /pointer-events: all/.test(r)), `${sel} takes the pointer`);
    assert.ok(!rules.some((r) => /pointer-events: none/.test(r)), `${sel} is no longer left out of hit testing`);
  }
  const tip = rule('.graph-tip');
  assert.match(tip, /position: absolute/);
  assert.match(tip, /pointer-events: none/);
  assert.match(tip, /background: var\(--surface\)/);
  assert.match(tip, /box-shadow: var\(--shadow-pop\)/);
  assert.doesNotMatch(tip, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(css, /\.graph-tip\[hidden\] \{ display: none; \}/);
  assert.match(rule('.graph-tip-term'), /font-family: ui-monospace/);
  assert.match(rule('.graph-tip-line:first-child'), /font-weight: 600/, 'the count leads');
});

test('a focused caption shows it: its name in the accent on an accent-soft halo, with no underline', () => {
  assert.match(css, /\.graph-caption:focus-visible[^{]*\{ outline: none; stroke: var\(--accent-soft\); \}/);
  assert.match(css, /\.graph-caption:focus-visible \.graph-caption-name[^{]*\{ fill: var\(--accent\); \}/);
  assert.match(css, /\.graph-block-title:focus-visible \.graph-caption-name/);
  assert.match(css, /\.graph-block-caption:focus-visible \.graph-caption-name/);
});
