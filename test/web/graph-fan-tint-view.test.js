const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { graphLayout, graphPlan } = require('../../plugin/skills/web/web/graph-model');
const { loadPage, control } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');
const {
  STATUSES, loadBoard, cleanUp, drawnModel,
} = require('./helpers/fan-boards');

// The view stamps the tier fan's washes (graph-fan-tint.test.js has the plan's) as SVG,
// with DOM calls and classes only: a path for each, before every other mark, so it lies
// behind the lines, the dots and the captions. A type's colour is open text (a hex, a
// name), so it rides a data attribute and the page paints it after the Graph is drawn, as it
// does a type chip's; the stylesheet gives the wash its opacity and takes no click.

after(cleanUp);

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
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

const board = loadBoard('plan');
const cls = (el) => (el.attrs.class || '').split(' ');

function stamp() {
  const model = drawnModel(board);
  const layout = graphLayout(model, 'hierarchy', { statuses: STATUSES, unnested: 'table' });
  const sandbox = { document: fakeDocument() };
  vm.createContext(sandbox);
  const helpers = ['graphEl', 'graphTspan', 'graphBuildTip', 'graphCaptionEl', 'graphDrawPlan'].map((n) => fn(n)).join('\n');
  vm.runInContext(`const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';\n${helpers}`, sandbox);
  const plan = graphPlan(model, layout, { kind: 'hierarchy', statusClass: (s) => s, titleOf: (c) => c.title, types: board.config.types });
  const out = vm.runInContext('graphDrawPlan', sandbox)(plan);
  const all = [];
  const walk = (el) => { all.push(el); el.children.forEach(walk); };
  walk(out.stage);
  return { plan, all, world: out.world };
}

// --- the marks --------------------------------------------------------------------------------------

test('the view stamps a path for each wash of the plan, with the plan\'s outline, and no more', () => {
  const v = stamp();
  const washes = v.all.filter((e) => cls(e).includes('graph-tint'));
  assert.strictEqual(washes.length, v.plan.tints.length);
  assert.strictEqual(washes.length, 4);
  washes.forEach((el, i) => {
    assert.strictEqual(el.tag, 'path');
    assert.strictEqual(el.attrs.d, v.plan.tints[i].d);
    assert.strictEqual(el.attrs.class, 'graph-tint');
    assert.strictEqual(el.attrs['data-tier'], v.plan.tints[i].tier, 'it says which tier it washes');
  });
});

test('a wash carries its type\'s colour as data-type-color, the attribute a type chip carries, and a tier with no colour carries none', () => {
  const v = stamp();
  const washes = v.world.children.filter((e) => cls(e).includes('graph-tint'));
  assert.deepStrictEqual(washes.map((e) => [e.attrs['data-tier'], e.attrs['data-type-color']]), [
    ['goal', '#a371f7'], ['strategy', undefined], ['objective', undefined], ['epic', '#d29922'],
  ]);
});

test('the washes are the first marks of the world: under the rings, the guide arcs, the dividers, the captions, the lines and the dots', () => {
  const v = stamp();
  const kinds = v.world.children.map((e) => (cls(e).includes('graph-tint') ? 'tint' : 'other'));
  assert.deepStrictEqual(kinds.slice(0, 4), ['tint', 'tint', 'tint', 'tint']);
  assert.ok(kinds.slice(4).every((k) => k === 'other'), 'and nothing washed after them');
  assert.ok(v.world.children.length > 30, 'with the rest of the fan after');
  assert.ok(cls(v.world.children[4]).includes('graph-guide'), 'the first guide arc follows the last wash');
});

test('the washes are made with DOM calls and classes only: no style attribute, no fill or stroke attribute, not even for a coloured one', () => {
  const v = stamp();
  const coloured = v.all.filter((e) => e.attrs['data-type-color']);
  assert.strictEqual(coloured.length, 2);
  for (const el of v.all) {
    for (const k of ['style', 'fill', 'stroke', 'fill-opacity', 'opacity']) assert.strictEqual(el.attrs[k], undefined, `${el.tag} ${k}`);
  }
  assert.ok(!/style=/.test(src));
});

// --- the stylesheet ---------------------------------------------------------------------------------

const rule = (selector) => {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `${selector} has a rule in app.css`);
  return m[1];
};

test('app.css gives a wash its opacity, fills it even-odd so the middle is bare, and lets every click through', () => {
  const r = rule('.graph-tint');
  assert.match(r, /fill-opacity: 0\.13;/);
  assert.match(r, /fill-rule: evenodd;/);
  assert.match(r, /stroke: none;/);
  assert.match(r, /pointer-events: none;/, 'a click on a washed band is a click on empty space');
});

test('a wash with no colour is filled in the muted token, and one with a colour in the colour the page paints, current colour', () => {
  assert.match(rule('.graph-tint'), /fill: var\(--mut\);/);
  assert.match(rule('.graph-tint[data-type-color]'), /fill: currentColor;/);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(rule('.graph-tint')), 'no colour of its own, so the theme and the board decide it');
});

// --- the page ---------------------------------------------------------------------------------------

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const pageBoard = (types) => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  hierarchy: ['goal', 'strategy', 'objective'],
  assignees: [], tags: [], types, notifications: [],
  active: [card(1, { type: 'goal' }), card(2, { type: 'strategy', parent: 1 }), card(3, { parent: 2 }), card(4)],
  archived: [],
});

// Elements that keep a style object and the data-* attributes as a dataset, and answer a
// selector for a data attribute, which is all paintTypeColors asks of them.
function paintableDocument() {
  const plain = recordingDocument();
  const make = (tag) => {
    const el = plain.createElement(tag);
    el.style = {};
    const set = el.setAttribute;
    el.setAttribute = (k, v) => {
      set(k, v);
      const m = /^data-(.+)$/.exec(k);
      if (m) el.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    };
    el.querySelectorAll = (sel) => {
      const m = /^\[(data-[\w-]+)\]$/.exec(sel);
      return m ? el.walk().filter((e) => e.attrs && m[1] in e.attrs) : [];
    };
    return el;
  };
  return { createElement: make, createElementNS: (ns, tag) => make(tag), createDocumentFragment: () => make('#fragment') };
}

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };

async function openGraph(types) {
  const host = recordingElement('div');
  const elements = { '#graph-view': host };
  for (const sel of HIDDEN_SURFACES) elements[sel] = hiddenSurface();
  const stored = { 'kanban.kanban.view.mode': 'graph' };
  const page = await loadPage({ board: pageBoard(types), stored, elements, documentExtras: paintableDocument() }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return { page, host, washes: () => byClass(host, 'graph-tint') };
}

test('the page washes the goal and strategy bands of a board with a hierarchy, and leaves the objective tier, which holds no card, and the depth rings bare', async () => {
  const s = await openGraph([{ name: 'goal', color: '#a371f7' }, { name: 'strategy' }]);
  assert.deepStrictEqual(s.washes().map((e) => e.attrs['data-tier']), ['goal', 'strategy']);
  assert.deepStrictEqual(s.washes().map((e) => e.attrs['data-type-color']), ['#a371f7', undefined]);
});

test('the page paints a wash\'s colour after the Graph is drawn, as it paints a type chip\'s, and paints a tier with no colour nothing', async () => {
  const s = await openGraph([{ name: 'goal', color: '#a371f7' }, { name: 'strategy' }]);
  const [goal, strategy] = s.washes();
  assert.strictEqual(goal.style.color, '#a371f7');
  assert.strictEqual(strategy.style.color, undefined);
});

test('a board whose types the page does not know washes every band neutral, and the draw does not fail', async () => {
  const s = await openGraph([]);
  assert.strictEqual(s.washes().length, 2);
  assert.deepStrictEqual(s.washes().map((e) => e.attrs['data-type-color']), [undefined, undefined]);
});
