const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { loadPage, control } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');
const { graphBuild, graphLayout, graphPlan } = require('../web/graph-model');

// The tier fan's names as the page paints them (helpers/page-vm.js runs every script the page
// loads in one vm). Where a name goes is graph-names.js's (graph-fan-name-place.test.js); the
// page puts each named card's label and leader where the placement says, relative to the
// card's dot, with attributes and classes only, and places again only when what the placement
// reads changes: a zoom once it settles, the selection, the setting, a new board. A pan and a
// poll that brings nothing new place nothing. The vm page measures no stage, so its first view
// is a zoom far out (k 0.01) where nothing has room; a test that wants names placed sets the
// view a Fit of a real stage gives and paints again. The browser runner drives the same in
// Chrome (scenarios/fan-name-rows.js).

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const src = read('graph-view.js');
const css = read('app.css');

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Above the small size: 4 parents (1 to 4) with two children each (11 to 18), and 26 loose
// cards (100 to 125) on the outermost ring, 38 in all. Relevant names the four parents, beside
// their rings; all names every card, the loose ones in rows outside the rim. Card 1's title is
// markup, to show a placed name reaches the page as text.
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  hierarchy: ['goal', 'strategy'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Ship <b>the</b> beta' }), card(2, { title: 'Move the data layer' }), card(3), card(4, { status: 'doing' }),
    ...[1, 2, 3, 4].flatMap((p) => [card(9 + 2 * p, { parent: p }), card(10 + 2 * p, { parent: p, waiting_for: [9 + 2 * p] })]),
    ...Array.from({ length: 26 }, (_, k) => card(100 + k, { title: `Loose card number ${100 + k}`, status: ['backlog', 'todo', 'doing', 'done'][k % 4] })),
  ],
  archived: [],
});
const PARENTS = [1, 2, 3, 4];
const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };
const OPTIONS = 'kanban.kanban.graph.options';

async function open({ names = 'all', board = makeBoard() } = {}) {
  const host = recordingElement('div');
  const elements = { '#graph-view': host };
  for (const sel of HIDDEN_SURFACES) elements[sel] = hiddenSurface();
  const stored = { 'kanban.kanban.view.mode': 'graph', [OPTIONS]: JSON.stringify({ names }) };
  const page = await loadPage({ board, stored, elements, documentExtras: recordingDocument() }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const errors = [];
  page.ctx.console = { ...console, error: (...a) => errors.push(a.map(String).join(' ')) };
  const s = {
    page, host, errors,
    run: (code) => page.run(code),
    nodes: () => byClass(host, 'graph-node'),
    names: () => byClass(host, 'graph-node-name'),
    leaders: () => byClass(host, 'graph-node-leader'),
    nodeOf: (id) => byClass(host, 'graph-node').find((n) => n.attrs['data-id'] === String(id)),
    // The view a Fit of a 1600 by 800 stage gives, zoomed by `zoom`, and the names painted at it.
    fit(zoom = 1) {
      page.run(`Object.assign(graphCur.view, graphFit(graphCur.layout.bounds, 1600, 800)); graphCur.view.k *= ${zoom}; graphPaintNames()`);
      return page.run('graphCur.names');
    },
  };
  return s;
}

const own = (node, cls) => node.children.filter((c) => c.classes && c.classes.includes(cls));
const has = (node, cls) => node.classes.includes(cls);

// What a card's label and leader say, as the page wrote them.
const drawnOf = (node) => {
  const [name] = own(node, 'graph-node-name');
  const [leader] = own(node, 'graph-node-leader');
  return {
    text: name.textContent, x: name.attrs.x, y: name.attrs.y, anchor: name.attrs['text-anchor'], d: leader.attrs.d,
    named: has(node, 'graph-named'), placed: has(node, 'graph-placed'), called: has(node, 'graph-called'),
  };
};

// What the placement says the card's label and leader are, relative to its dot.
const wantedOf = (s, n, p) => {
  const round = s.run('graphRound');
  if (!p) return { text: n.name, x: String(n.reach + 3), y: '0', anchor: 'start', d: '', placed: false, called: false };
  return {
    text: p.text, x: String(round(p.x - n.x)), y: String(round(p.y - n.y)), anchor: p.anchor, d: p.leader ? p.leader.d : '', placed: true, called: !!p.leader,
  };
};

const paintedAsPlaced = (s) => {
  const names = s.run('graphCur.names');
  for (const n of s.run('graphCur.plan.nodes')) {
    const got = drawnOf(s.nodeOf(n.id));
    const { named, ...rest } = got;
    assert.deepStrictEqual(rest, wantedOf(s, n, names.placed.get(n.id)), `card ${n.id}`);
  }
};

// --- what is drawn ---------------------------------------------------------------------------------

function fakeDocument() {
  const make = (tag) => ({
    tag, attrs: {}, children: [], textContent: '', className: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
  });
  return { createElementNS: (ns, tag) => make(tag), createElement: (tag) => make(tag) };
}

function fn(name) {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in graph-view.js`);
  return m[0];
}

test('a drawn fan gives each named card one leader before its dot, with no style, fill or stroke attribute', () => {
  const sandbox = { document: fakeDocument() };
  vm.createContext(sandbox);
  vm.runInContext(`const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';\n${['graphEl', 'graphTspan', 'graphBuildTip', 'graphCaptionEl', 'graphDrawPlan'].map(fn).join('\n')}`, sandbox);
  const board = makeBoard();
  const model = graphBuild(board.active, { ctx: { board: 'kanban', priorities: [] }, hierarchy: board.hierarchy });
  const fan = { lines: 'folded', dependencies: 'on', order: 'status', names: 'all', unnested: 'outermost' };
  const plan = graphPlan(model, graphLayout(model, 'tiers', { statuses: board.statuses }), {
    kind: 'tiers', statusClass: (st) => st, titleOf: (c) => c.title, fan,
  });
  const out = vm.runInContext('graphDrawPlan', sandbox)(plan);
  assert.strictEqual(out.nameEls.size, plan.nodes.length, 'a label and a leader for every card');
  for (const n of plan.nodes) {
    const g = out.nodeEls.get(n.id);
    const leaders = g.children.filter((c) => c.attrs.class === 'graph-node-leader');
    assert.strictEqual(leaders.length, 1, `card ${n.id} has one leader`);
    const [leader] = leaders;
    assert.strictEqual(leader.tag, 'path');
    assert.strictEqual(leader.attrs.d, '', 'no leader shows until the names are placed');
    assert.strictEqual(leader.attrs['vector-effect'], 'non-scaling-stroke', 'a hairline at any zoom');
    const dot = g.children.findIndex((c) => c.attrs.class === 'graph-dot');
    assert.ok(g.children.indexOf(leader) < dot, `card ${n.id}: the dot is drawn over the leader's start`);
    assert.strictEqual(out.nameEls.get(n.id).leader, leader);
    assert.strictEqual(out.nameEls.get(n.id).text, g.children.find((c) => c.attrs.class === 'graph-node-name'));
  }
  const all = [];
  const walk = (el) => { all.push(el); el.children.forEach(walk); };
  walk(out.stage);
  for (const el of all) for (const k of ['style', 'fill', 'stroke']) assert.strictEqual(el.attrs[k], undefined, `${el.tag} ${k}`);
  const bare = graphPlan(model, graphLayout(model, 'force'), { kind: 'force', statusClass: (st) => st, titleOf: (c) => c.title });
  const plain = vm.runInContext('graphDrawPlan', sandbox)(bare);
  assert.strictEqual(plain.nameEls.size, 0, 'Force names no card, so it draws no leader');
});

test('the stylesheet shows a name only when it is placed, its leader only when it is called, with tokens and no hex colour', () => {
  const rule = (sel) => {
    const at = css.indexOf(`${sel} {`);
    assert.ok(at !== -1, `a rule for ${sel}`);
    return css.slice(at, css.indexOf('}', at) + 1);
  };
  assert.match(rule('.graph-node-name'), /display: none/);
  assert.match(rule('.graph-node.graph-named.graph-placed .graph-node-name'), /display: inline/);
  assert.match(rule('.graph-node.graph-named.graph-placed .graph-node-id'), /display: none/, 'a placed name stands in for the id label');
  assert.ok(!/\.graph-node\.graph-named \.graph-node-name \{/.test(css), 'a named card with no room shows no name');
  assert.ok(!/\.graph-node\.graph-named \.graph-node-id \{/.test(css), 'and keeps its id label');
  const leader = rule('.graph-node-leader');
  assert.match(leader, /display: none/);
  assert.match(leader, /fill: none/);
  assert.match(leader, /stroke: var\(--mut\)/);
  assert.match(leader, /pointer-events: none/, 'a leader never takes the pointer from a dot');
  assert.match(rule('.graph-node.graph-named.graph-called .graph-node-leader'), /display: inline/);
  const lit = css.match(/[^}]*\.graph-node\.graph-called\.hover-highlight \.graph-node-leader[^{]*\{[^}]*\}/);
  assert.ok(lit && /\.graph-node\.graph-called\.selected \.graph-node-leader/.test(lit[0]) && /stroke: var\(--ink\)/.test(lit[0]), 'a hovered or selected card\'s leader is drawn in ink');
  for (const sel of ['.graph-node-leader', '.graph-node.graph-named.graph-placed .graph-node-name', '.graph-node.graph-named.graph-called .graph-node-leader']) {
    assert.doesNotMatch(rule(sel), /#[0-9a-fA-F]{3,8}\b|style=/, sel);
  }
  for (const cls of ['graph-node-leader', 'graph-placed', 'graph-called']) {
    assert.ok(src.includes(`'${cls}'`), `${cls} is a literal the class guard (graph-view-wiring.test.js) reads`);
  }
});

// --- where the page puts each name -------------------------------------------------------------------

test('at a real fit every name and leader is drawn where the placement puts it, relative to its dot, and a title as text', async () => {
  const s = await open();
  const names = s.fit();
  assert.ok(names && names.placed.size > 0, 'names are placed at a real fit');
  const kinds = [...names.placed.values()].map((p) => p.kind);
  assert.ok(kinds.includes('beside') && kinds.includes('row'), `parents beside their rings and other cards in rows: ${[...new Set(kinds)]}`);
  paintedAsPlaced(s);
  for (const node of s.nodes()) {
    const got = drawnOf(node);
    assert.strictEqual(got.named, true, `card ${node.attrs['data-id']} is named under all`);
  }
  const one = own(s.nodeOf(1), 'graph-node-name')[0];
  assert.ok(names.placed.has(1), 'card 1 is placed');
  assert.ok('Ship <b>the</b> beta'.startsWith(one.textContent.replace(/…$/, '')), one.textContent);
  assert.strictEqual(one.innerHTML, '', 'no markup set');
  assert.strictEqual(s.leaders().length, s.nodes().length, 'one leader for each card');
  assert.deepStrictEqual(s.errors, []);
});

test('a named card with no room keeps its id label: no graph-placed, no leader, its label beside its dot', async () => {
  const s = await open();
  const names = s.run('graphCur.names');
  assert.strictEqual(s.run('graphCur.view.k') < 0.05, true, 'the vm page opens far out');
  assert.ok(names.unnamed.length > 0, 'far out, cards are left unnamed');
  for (const id of names.unnamed) {
    const node = s.nodeOf(id);
    const got = drawnOf(node);
    assert.ok(got.named && !got.placed && !got.called, `card ${id}`);
    assert.strictEqual(got.d, '', `card ${id} has no leader`);
    assert.strictEqual(got.x, String(s.run(`graphCur.plan.nodes.find((n) => n.id === ${id}).reach`) + 3), `card ${id}: beside its dot`);
  }
  s.fit(0.3);
  const thin = s.run('graphCur.names');
  assert.ok(thin.unnamed.length > 0 && thin.placed.size > 0, `zoomed out from a fit, some are placed and some not: ${thin.placed.size} placed, ${thin.unnamed.length} unnamed`);
  paintedAsPlaced(s);
});

test('with names on none no card is named, placed or called, and no leader is drawn', async () => {
  const s = await open({ names: 'none' });
  s.fit();
  assert.strictEqual(s.run('graphCur.names.placed.size'), 0);
  for (const node of s.nodes()) {
    const got = drawnOf(node);
    assert.ok(!got.named && !got.placed && !got.called, node.attrs['data-id']);
    assert.strictEqual(got.d, '');
  }
  s.run('setSelection(addPart(NO_SELECTION, cardPart(100)), 100)');
  s.run('graphPaintSelection()');
  assert.ok(s.leaders().every((l) => l.attrs.d === ''), 'a selection under none draws no leader');
});

test('relevant names the parents beside their rings, with no leader', async () => {
  const s = await open({ names: 'relevant' });
  const names = s.fit();
  assert.deepStrictEqual([...names.placed.keys()].sort((a, b) => a - b), PARENTS);
  for (const p of names.placed.values()) assert.strictEqual(p.kind, 'beside');
  assert.ok(s.leaders().every((l) => l.attrs.d === ''));
  paintedAsPlaced(s);
});

// --- when the page places again ---------------------------------------------------------------------------

test('a poll with nothing new places nothing: the placement is the one the page had, painted on the new elements', async () => {
  const s = await open();
  const before = s.fit();
  const drawn = s.nodes()[0];
  await s.run('autoRefreshTick()');
  await s.page.settle();
  assert.notStrictEqual(s.nodes()[0], drawn, 'the poll drew the fan again');
  assert.strictEqual(s.run('graphCur.names'), before, 'the same placement');
  paintedAsPlaced(s);
  assert.deepStrictEqual(s.errors, []);
});

test('a zoom places the names again once it settles, and only then; a pan places none', async () => {
  const s = await open();
  const before = s.fit();
  const timers = [];
  let cleared = 0;
  s.page.ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  s.page.ctx.clearTimeout = () => { cleared++; };
  s.run('graphCur.view.x += 40; graphCur.view.y -= 25; graphCur.view.touched = true; graphApplyTransform()');
  assert.strictEqual(timers.length, 0, 'a pan queues no placement');
  assert.strictEqual(s.run('graphCur.names'), before);
  s.run('graphCur.view.k *= 1.25; graphApplyTransform()');
  assert.strictEqual(timers.length, 1, 'a zoom queues one placement');
  assert.strictEqual(timers[0].ms, s.run('GRAPH_NAMES_SETTLE_MS'));
  assert.strictEqual(timers[0].ms, 140);
  assert.strictEqual(s.run('graphCur.names'), before, 'nothing is placed while the zoom goes on');
  s.run('graphCur.view.k *= 1.25; graphApplyTransform()');
  assert.strictEqual(timers.length, 2);
  assert.ok(cleared >= 1, 'the next zoom step puts the placement off again');
  timers[1].fn();
  const after = s.run('graphCur.names');
  assert.notStrictEqual(after, before);
  assert.strictEqual(after.k, s.run('graphCur.view.k'), 'placed at the zoom it settled on');
  paintedAsPlaced(s);
  s.run('graphApplyTransform()');
  assert.strictEqual(timers.length, 2, 'once placed at this zoom, a transform queues nothing');
});

test('with nothing named a zoom queues no placement, and names asked for after it are placed at the zoom shown', async () => {
  const s = await open({ names: 'none' });
  const before = s.fit();
  assert.strictEqual(before.placed.size + before.unnamed.length, 0, 'nothing named');
  const timers = [];
  s.page.ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  s.run('graphCur.view.k *= 1.25; graphApplyTransform()');
  assert.strictEqual(timers.length, 0, 'a zoom under none queues nothing');
  assert.strictEqual(s.run('graphCur.names'), before);
  s.run("graphSetOption('names', 'all')");
  const names = s.run('graphCur.names');
  assert.strictEqual(names.k, s.run('graphCur.view.k'), 'placed at the zoom shown');
  assert.ok(names.placed.size > 0);
  paintedAsPlaced(s);
  assert.deepStrictEqual(s.errors, []);
});

test('a click names and places in place: no rebuild, and the card it names has its row and leader', async () => {
  const s = await open({ names: 'relevant' });
  s.fit();
  const fan = s.run('graphCur');
  s.run('setSelection(addPart(NO_SELECTION, cardPart(100)), 100)');
  s.run('graphPaintSelection()');
  assert.strictEqual(s.run('graphCur'), fan, 'painted in place');
  const p = s.run('graphCur.names.placed.get(100)');
  assert.ok(p && p.kind === 'row' && p.leader, 'the card clicked is named in a row, with a leader');
  const got = drawnOf(s.nodeOf(100));
  assert.ok(got.named && got.placed && got.called);
  paintedAsPlaced(s);
  s.run('setSelection(NO_SELECTION, null)');
  s.run('graphPaintSelection()');
  assert.strictEqual(drawnOf(s.nodeOf(100)).d, '', 'once it is no longer named, its leader goes');
});

test('the measure the page passes in gives a width even where no canvas measures text', async () => {
  const s = await open();
  const w = s.run("graphMeasureName('abcd')");
  assert.ok(Number.isFinite(w) && w > 0, String(w));
  assert.ok(s.run("graphMeasureName('abcdefgh')") > w, 'a longer text is wider');
  assert.ok(s.run("graphMeasureName('abcd', 13, true)") > w, 'a larger size is wider');
});

test('resetGraphViewState forgets the placement and any placement queued', () => {
  const body = fn('resetGraphViewState');
  assert.match(body, /graphNamesMemo = null/);
  assert.match(body, /clearTimeout\(graphNamesTimer\)/);
  const transform = fn('graphApplyTransform');
  assert.match(transform, /graphQueueNames\(\);\n\}$/, 'the transform only queues the names, last');
  const queue = fn('graphQueueNames');
  assert.doesNotMatch(queue, /querySelectorAll|graphNamesPlace/, 'queueing is O(1)');
  assert.match(fn('renderGraphView'), /graphPaintNames\(\);\n {2}graphApplyTransform\(\);/, 'a render places at the view it fits, before the transform');
});

test('a board with a card whose parent is missing, a loop of parents and a title that is not text places its names with no error', async () => {
  const board = makeBoard();
  board.active.push(
    card(200, { parent: 999 }), card(201, { parent: 202 }), card(202, { parent: 201 }),
    card(203, { title: null }), card(204, { title: 42 }), card(205, { title: '' }),
  );
  const s = await open({ board });
  s.run('renderGraphView()');
  s.fit();
  assert.ok(s.run('graphCur.names.placed.size') > 0);
  assert.strictEqual(s.names().length, s.nodes().length);
  assert.strictEqual(s.leaders().length, s.nodes().length);
  paintedAsPlaced(s);
  s.run("graphSetOption('unnested', 'table')");
  s.fit();
  paintedAsPlaced(s);
  assert.deepStrictEqual(s.errors, []);
  assert.deepStrictEqual(s.page.failures.map((e) => e.message), []);
});
