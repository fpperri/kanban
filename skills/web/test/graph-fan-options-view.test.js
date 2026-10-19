const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');

// The tier fan's option row in the real page (helpers/page-vm.js runs every script the
// page loads in one vm, with elements a test can read back): shown in the option panel
// with no toggle of its own, with Tiers only, five options of segmented buttons, kept per board in
// the browser. The row never starts a pan, never clears the selection and never holds
// the poll. The browser runner drives the same row in Chrome (scenarios/tier-fan-options.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Card 1 is a goal with children 2 to 6 on one ring: 4 waits for 3, a chain whose end is
// 4, and 2, 5 and 6 are alone. Card 7 waits for card 1. Folded draws two parent lines (4,
// and one counted line for 2, 5 and 6), chain four (2, 4, 5, 6), all five, off none, and
// two arrows (3 to 4, 1 to 7).
const makeBoard = (name = 'kanban') => ({
  projectName: name,
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  hierarchy: ['goal', 'strategy'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { type: 'goal', status: 'doing' }),
    card(2, { parent: 1, status: 'done' }), card(3, { parent: 1 }), card(4, { parent: 1, waiting_for: ['3'], status: 'doing' }),
    card(5, { parent: 1, status: 'backlog' }), card(6, { parent: 1 }),
    card(7, { waiting_for: ['1'] }),
  ],
  archived: [],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };

// A document whose Graph stage answers the size a test gives it, as a laid-out page does:
// `size` is read each time the stage is asked, so a test can change it between two draws.
function sizedDocument(size) {
  const base = recordingDocument();
  return {
    ...base,
    createElement(tag) {
      const el = base.createElement(tag);
      const onStage = () => el.className === 'graph-stage';
      Object.defineProperty(el, 'clientWidth', { get: () => (onStage() ? size.w : 0) });
      Object.defineProperty(el, 'clientHeight', { get: () => (onStage() ? size.h : 0) });
      return el;
    },
  };
}

async function open({ stored = {}, name = 'kanban', layout = null, size = null } = {}) {
  const host = recordingElement('div');
  const elements = { '#graph-view': host };
  for (const sel of HIDDEN_SURFACES) elements[sel] = hiddenSurface();
  const all = { [`kanban.${name}.view.mode`]: 'graph', ...stored };
  if (layout) all[`kanban.${name}.graph.layout`] = layout;
  const page = await loadPage({
    board: makeBoard(name), stored: all, elements, documentExtras: size ? sizedDocument(size) : recordingDocument(),
  }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return {
    page, host, stored: all, name,
    run: (code) => page.run(code),
    drawn: (kind) => page.run('graphCur.lines').filter((l) => l.kind === kind),
    row: () => byClass(host, 'graph-options')[0] || null,
    // The event a click on `el` makes at the Graph's host, as the page's listeners see it.
    click(el) {
      const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (el.matches(sel) ? el : null) : harmless(String(key))) });
      host.fire('click', { target, stopPropagation() {}, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false });
    },
  };
}

// Whether a built element answers a selector of the few shapes the Graph's listeners use.
function matcher(el) {
  el.matches = (sel) => {
    const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    const attrs = [...sel.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), m[2]]);
    const own = el.classes || [];
    return classes.every((c) => own.includes(c)) && attrs.every(([k, v]) => (v === undefined ? el.dataset[k] !== undefined : el.dataset[k] === v));
  };
  return el;
}

const groups = (row) => byClass(row, 'graph-option').map((g) => ({
  label: byClass(g, 'graph-option-label')[0].textContent,
  title: g.title,
  buttons: byClass(g, 'graph-option-btn').map(matcher).map((b) => ({
    el: b, key: b.dataset.key, val: b.dataset.val, text: b.textContent, pressed: b.getAttribute('aria-pressed'), active: b.classes.includes('active'),
  })),
}));

const key = (name, feature) => `kanban.${name}.${feature}`;

// --- shown in the panel, with Tiers only -----------------------------------------------

test('the Graph opens in Tiers with the row shown: no toggle ahead of it, the five options under it', async () => {
  const s = await open();
  const row = s.row();
  assert.ok(row, 'the row is there');
  assert.strictEqual(groups(row).length, 5, 'every option is built, with nothing to unfold');
  assert.deepStrictEqual(row.children.map((c) => c.classes[0]), ['graph-option', 'graph-option', 'graph-option', 'graph-option', 'graph-option'], 'no section header leads the row');
  assert.strictEqual(byClass(row, 'map-section-toggle').length, 0);
});

test('the row holds Lines, Dependencies, Order, Names and Unnested, each with every value it takes, in words', async () => {
  const s = await open();
  const row = s.row();
  const g = groups(row);
  assert.deepStrictEqual(g.map((x) => x.label), ['Lines', 'Dependencies', 'Order', 'Names', 'Unnested']);
  assert.deepStrictEqual(g.map((x) => x.buttons.map((b) => b.text)), [['folded', 'chain', 'all', 'off'], ['on', 'off'], ['status', 'rank'], ['relevant', 'all', 'none'], ['outermost', 'off', 'depth 0', 'table']]);
  assert.deepStrictEqual(g.map((x) => x.buttons.map((b) => `${b.key}=${b.val}`)), [
    ['lines=folded', 'lines=chain', 'lines=all', 'lines=off'], ['dependencies=on', 'dependencies=off'], ['order=status', 'order=rank'], ['names=relevant', 'names=all', 'names=none'],
    ['unnested=outermost', 'unnested=off', 'unnested=depth 0', 'unnested=table'],
  ]);
  for (const x of g) assert.ok(x.title.length > 20, `${x.label} explains itself in a tooltip`);
});

test('exactly one button of each option is pressed: the default at first, the stored choice after', async () => {
  const fresh = await open();
  assert.deepStrictEqual(groups(fresh.row()).map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['folded'], ['on'], ['status'], ['relevant'], ['outermost']]);
  const chosen = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ lines: 'all', order: 'rank', names: 'none', unnested: 'depth 0' }) } });
  const g = groups(chosen.row());
  assert.deepStrictEqual(g.map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['all'], ['on'], ['rank'], ['none'], ['depth 0']]);
  for (const x of g) assert.deepStrictEqual(x.buttons.filter((b) => b.active).map((b) => b.val), x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val), 'the active class follows aria-pressed');
});

test('the row is there with Tiers and nowhere else', async () => {
  const tiers = await open();
  assert.ok(tiers.row());
  for (const layout of ['force', 'status']) {
    const s = await open({ layout });
    assert.strictEqual(s.row(), null, `${layout} has no option row`);
  }
});

test('every control of the row keeps the selection and holds no poll, and writes no style or handler', async () => {
  const s = await open();
  const row = s.row();
  const buttons = byClass(row, 'graph-option-btn');
  assert.strictEqual(buttons.length, 15);
  for (const b of buttons) {
    assert.strictEqual(b.dataset.keepsSelection, '', `${b.dataset.key}=${b.dataset.val} keeps the selection`);
    assert.strictEqual(b.dataset.holdsPoll, undefined, `${b.dataset.key}=${b.dataset.val} does not hold the poll`);
    assert.strictEqual(b.type, 'button');
    assert.strictEqual(b.getAttribute('style'), null);
  }
  assert.strictEqual(row.dataset.keepsSelection, '', 'the row\'s own space keeps the selection too');
});

// --- pressing ---------------------------------------------------------------------------------

test('a fold saved for the row before the panel existed is ignored: the row is shown, and nothing is written for it', async () => {
  for (const old of ['true', 'false', '"open"', '{not json']) {
    const s = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: old } });
    assert.strictEqual(groups(s.row()).length, 5, old);
    assert.deepStrictEqual(s.run('JSON.stringify(Object.keys(graphLoadOptions()))'), '["lines","dependencies","order","names","unnested"]');
    assert.strictEqual(s.stored[key('kanban', 'graph.optionsFolded')], old, 'the old value is left alone, and never read');
  }
});

test('pressing an option stores the options whole for the board and redraws the fan with the lines it asks for', async () => {
  const s = await open();
  const count = (kind) => s.drawn(kind).length;
  assert.deepStrictEqual([count('parent'), count('wait')], [2, 2], 'folded, on');
  const press = (k, v) => s.click(groups(s.row()).flatMap((x) => x.buttons).find((b) => b.key === k && b.val === v).el);
  press('lines', 'all');
  assert.deepStrictEqual(JSON.parse(s.stored[key('kanban', 'graph.options')]), { lines: 'all', dependencies: 'on', order: 'status', names: 'relevant', unnested: 'outermost' });
  assert.deepStrictEqual([count('parent'), count('wait')], [5, 2]);
  press('lines', 'chain');
  assert.deepStrictEqual([count('parent'), count('wait')], [4, 2], 'chain: 2, 4, 5 and 6; card 3 is not a chain end');
  press('lines', 'off');
  assert.deepStrictEqual([count('parent'), count('wait')], [0, 2]);
  press('dependencies', 'off');
  assert.deepStrictEqual([count('parent'), count('wait')], [0, 0]);
  press('dependencies', 'on');
  press('lines', 'folded');
  assert.deepStrictEqual([count('parent'), count('wait')], [2, 2]);
  assert.deepStrictEqual(groups(s.row()).map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['folded'], ['on'], ['status'], ['relevant'], ['outermost']], 'the row shows what is held');
});

test('pressing an order moves siblings in the layout, and the layout is not the same layout as before', async () => {
  const s = await open();
  const angle = (id) => s.run(`graphCur.layout.polar.get(${id}).a`);
  const seat = () => [2, 3, 4, 5, 6].sort((a, b) => angle(b) - angle(a));
  assert.deepStrictEqual(seat(), [4, 3, 6, 5, 2], 'by status, the default: doing, todo, todo, backlog, done');
  s.click(groups(s.row()).flatMap((x) => x.buttons).find((b) => b.key === 'order' && b.val === 'rank').el);
  assert.deepStrictEqual(seat(), [2, 3, 4, 5, 6], 'by rank: the outline\'s order');
});

test('a value or an option the row does not offer is ignored: nothing is stored and nothing redraws', async () => {
  const s = await open();
  const before = s.run('graphCur');
  s.run("graphSetOption('lines', 'every')");
  s.run("graphSetOption('names', 'everyone')");
  s.run("graphSetOption('speed', 'fast')");
  s.run("graphSetOption('toString', 'on')");
  assert.strictEqual(s.stored[key('kanban', 'graph.options')], undefined);
  assert.strictEqual(s.run('graphCur'), before);
});

// --- kept per board ---------------------------------------------------------------------------

test('a reload keeps the options, and another board keeps its own', async () => {
  const first = await open();
  first.click(groups(first.row()).flatMap((x) => x.buttons).find((b) => b.key === 'lines' && b.val === 'off').el);
  first.click(groups(first.row()).flatMap((x) => x.buttons).find((b) => b.key === 'order' && b.val === 'rank').el);
  const reloaded = await open({ stored: first.stored });
  assert.deepStrictEqual(groups(reloaded.row()).map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['off'], ['on'], ['rank'], ['relevant'], ['outermost']]);
  assert.deepStrictEqual(reloaded.drawn('parent').length, 0);
  const other = await open({ stored: { ...first.stored, [key('shop', 'graph.options')]: JSON.stringify({ lines: 'all' }) }, name: 'shop' });
  assert.strictEqual(other.run('graphLoadOptions().lines'), 'all');
  assert.strictEqual(other.run('graphLoadOptions().order'), 'status');
  assert.strictEqual(first.run('graphLoadOptions().lines'), 'off');
});

test('storage that refuses reads and writes leaves the defaults, and a press still shows this session', async () => {
  const s = await open();
  s.page.ctx.localStorage.getItem = () => { throw new Error('blocked'); };
  s.page.ctx.localStorage.setItem = () => { throw new Error('blocked'); };
  s.run('resetGraphViewState()');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.run('graphLoadOptions()'))), { lines: 'folded', dependencies: 'on', order: 'status', names: 'relevant', unnested: 'outermost' });
  assert.doesNotThrow(() => s.run("graphSetOption('lines', 'all')"));
  assert.strictEqual(s.run('graphLoadOptions().lines'), 'all');
});

test('a board rename or change clears the memos, so the next board reads its own', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ lines: 'chain' }) } });
  assert.strictEqual(s.run('graphLoadOptions().lines'), 'chain');
  s.run('resetGraphViewState()');
  s.page.ctx.localStorage.setItem(key('kanban', 'graph.options'), JSON.stringify({ lines: 'off' }));
  assert.strictEqual(s.run('graphLoadOptions().lines'), 'off');
});

// --- the row and the page ---------------------------------------------------------------------

test('a press does not start a pan: the row is not on the canvas, and a press on it is not a pan', async () => {
  const s = await open();
  const button = groups(s.row()).flatMap((x) => x.buttons)[0].el;
  const target = new Proxy({}, { get: (t, k) => (k === 'closest' ? (sel) => (sel === '.graph-canvas' || sel === '.card-el' || sel === '.graph-node' ? null : (button.matches(sel) ? button : null)) : harmless(String(k))) });
  s.host.fire('pointerdown', { button: 0, pointerId: 1, clientX: 5, clientY: 5, target });
  assert.strictEqual(s.run('graphPan'), null);
  assert.strictEqual(s.run('isDragging'), false);
  const canvas = new Proxy({}, { get: (t, k) => (k === 'closest' ? (sel) => (sel === '.graph-canvas' ? {} : null) : harmless(String(k))) });
  s.host.fire('pointerdown', { button: 0, pointerId: 2, clientX: 5, clientY: 5, target: canvas });
  assert.notStrictEqual(s.run('graphPan'), null, 'the same press on the canvas does start a pan, so the check above can fail');
});

const viewOf = (s) => s.run('({ x: graphCur.view.x, y: graphCur.view.y, k: graphCur.view.k, touched: graphCur.view.touched })');

// The order is in the layout's cache key, not in what the view compares to decide a
// re-fit: pressing it moves siblings along their own stretch of a sector, so it is the
// same cards on the same rings, and an untouched view that the toggle left framed for
// another stage height must not be framed again by it.
const pressOption = (s, optionKey, val) => {
  const button = groups(s.row()).flatMap((g) => g.buttons).find((b) => b.key === optionKey && b.val === val);
  assert.ok(button, `${optionKey}=${val} is in the row`);
  s.click(button.el);
  assert.strictEqual(s.run('graphLoadOptions()')[optionKey], val, `${optionKey}=${val} is pressed`);
};

test('an untouched view stays where it is when Order, Lines or Dependencies is pressed: the fan is not re-fitted or rescaled', async () => {
  const size = { w: 900, h: 600 };
  const s = await open({ size });
  const first = viewOf(s);
  assert.ok([first.x, first.y, first.k].every(Number.isFinite) && first.k > 0, 'the first draw fitted the fan to the stage');
  assert.strictEqual(first.touched, false);

  pressOption(s, 'order', 'rank');
  assert.deepStrictEqual(viewOf(s), first, 'Order rank: x, y and k as the first fit left them');
  pressOption(s, 'order', 'status');
  assert.deepStrictEqual(viewOf(s), first, 'Order status: and as they were');
  pressOption(s, 'lines', 'all');
  pressOption(s, 'dependencies', 'off');
  assert.deepStrictEqual(viewOf(s), first, 'nor do Lines and Dependencies move it');
});

test('a view the person zoomed keeps its pan and zoom when Order is pressed', async () => {
  const size = { w: 900, h: 600 };
  const s = await open({ size });
  s.run('graphZoomBy(1.5, 100, 100)');
  const zoomed = viewOf(s);
  assert.strictEqual(zoomed.touched, true);
  pressOption(s, 'order', 'rank');
  assert.deepStrictEqual(viewOf(s), zoomed);
});

test('a press leaves the selection as it is', async () => {
  const s = await open();
  s.run('setSelection(addPart(addPart(NO_SELECTION, cardPart(2)), cardPart(5)), 5)');
  const before = JSON.stringify(s.run('selectionState.selection'));
  for (const b of groups(s.row()).flatMap((x) => x.buttons)) s.click(b.el);
  assert.strictEqual(JSON.stringify(s.run('selectionState.selection')), before);
  assert.deepStrictEqual([...s.run('selectedIds')].sort(), [2, 5]);
});

test('a focused option does not hold the poll, and a poll tick that finds it focused refreshes the board', async () => {
  const s = await open();
  const button = groups(s.row()).flatMap((x) => x.buttons)[0].el;
  s.page.ctx.document.activeElement = button;
  assert.strictEqual(s.run('boardControlFocused()'), false);
  const fetched = s.page.fetchLog.length;
  await s.run('autoRefreshTick()');
  await s.page.settle();
  assert.ok(s.page.fetchLog.length > fetched, 'the tick fetched the board');
  const zoom = byClass(s.host, 'graph-zoom-btn')[0];
  s.page.ctx.document.activeElement = zoom;
  assert.strictEqual(s.run('boardControlFocused()'), true, 'a zoom button holds the poll, as it did');
});

test('a poll hands focus back to the option that had it, found again by its option and value', async () => {
  const s = await open();
  const button = groups(s.row()).flatMap((x) => x.buttons).find((b) => b.key === 'lines' && b.val === 'all').el;
  s.page.ctx.__button = button;
  assert.ok(s.run('REFOCUS_SELECTOR').split(', ').includes('.graph-option-btn'), 'it is one of the controls that get focus back after a render');
  assert.strictEqual(s.run('refocusSelector(__button)'), '.graph-option-btn[data-key="lines"][data-val="all"]');
  assert.ok(s.run('REFOCUS_SELECTOR').split(', ').includes('.view-panel-toggle'), 'and so is the panel\'s button, which the row no longer has a toggle beside');
});

test('the Graph lights the lines it draws: a counted line lights with its parent', async () => {
  const s = await open();
  const lines = s.run('graphCur.lines');
  const counted = lines.findIndex((l) => l.count !== undefined);
  assert.ok(counted >= 0);
  s.page.ctx.__calls = [];
  s.page.ctx.graphLightCards = (lit) => s.page.ctx.__calls.push(lit);
  s.run('hoveredId = null; setSelection(addPart(NO_SELECTION, cardPart(1)), 1)');
  s.run('graphRestFocus()');
  const lit = s.page.ctx.__calls[s.page.ctx.__calls.length - 1];
  assert.ok(lit, 'a lone card lights');
  assert.ok(lit.links.has(counted), 'the counted line of card 1 is lit with it');
  assert.strictEqual(lit.links.size, lines.length, 'card 1 and every card it has a relation with are lit, so every drawn line between them is');
});

// --- the counted line, stamped ----------------------------------------------------------------

const vm = require('node:vm');
const { graphBuild, graphLayout, graphPlan } = require('../web/graph-model');

function stamp(plan) {
  const sandbox = { document: recordingDocument() };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'graph-view.js'), 'utf8').replace(/\r\n/g, '\n');
  const fn = (name) => src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0];
  vm.runInContext(`const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';\n${['graphEl', 'graphTspan', 'graphBuildTip', 'graphCaptionEl', 'graphDrawPlan'].map(fn).join('\n')}`, sandbox);
  return vm.runInContext('graphDrawPlan', sandbox)(plan);
}

test('the view stamps a counted line as a path with its count beside it, and every other line as the path alone', () => {
  const board = makeBoard();
  const model = graphBuild(board.active, { ctx: { board: 'kanban', priorities: [] }, hierarchy: board.hierarchy });
  const layout = graphLayout(model, 'tiers', { statuses: board.statuses });
  const plan = graphPlan(model, layout, { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title, fan: { lines: 'folded', dependencies: 'on', order: 'status' } });
  const out = stamp(plan);
  const kids = out.world.children;
  const paths = kids.filter((e) => e.classes && e.classes.includes('graph-link'));
  assert.strictEqual(paths.length, plan.links.length, 'a path for each line');
  assert.strictEqual(out.linkEls.length, plan.links.length, 'the elements the lighting reaches are the lines drawn, in order');
  out.linkEls.forEach((el, i) => assert.strictEqual(el.getAttribute('d'), plan.links[i].d));
  const counted = plan.links.findIndex((l) => l.count !== undefined);
  assert.ok(counted >= 0);
  const at = kids.indexOf(out.linkEls[counted]);
  const label = kids[at + 1];
  assert.deepStrictEqual([label.tag, label.className, label.textContent], ['text', 'graph-link-count', String(plan.links[counted].count)], 'the label follows its line, so the sibling rule dims them together');
  assert.deepStrictEqual([label.getAttribute('x'), label.getAttribute('y'), label.getAttribute('text-anchor')], [String(plan.links[counted].label.x), String(plan.links[counted].label.y), 'middle']);
  assert.strictEqual(kids.filter((e) => e.className === 'graph-link-count').length, plan.links.filter((l) => l.count !== undefined).length);
  assert.strictEqual(out.linkEls[counted].getAttribute('marker-end'), null, 'a parent line has no head');
});

test('every option the model offers has a label and a hint in the row, so the row cannot lose one', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'graph-view.js'), 'utf8').replace(/\r\n/g, '\n');
  const labels = src.match(/const GRAPH_FAN_OPTION_LABELS = \{[\s\S]*?\n\};/)[0];
  const { GRAPH_FAN_OPTION_VALUES, GRAPH_FAN_NAMES_CAP, GRAPH_FAN_NAMES_SMALL } = require('../web/graph-model');
  const sandbox = { GRAPH_FAN_NAMES_CAP, GRAPH_FAN_NAMES_SMALL };
  vm.createContext(sandbox);
  vm.runInContext(`${labels}\nthis.labels = GRAPH_FAN_OPTION_LABELS;`, sandbox);
  assert.deepStrictEqual(Object.keys(sandbox.labels), Object.keys(GRAPH_FAN_OPTION_VALUES));
  for (const meta of Object.values(sandbox.labels)) assert.ok(meta.label && meta.hint.length > 20);
  assert.ok(sandbox.labels.names.hint.includes(`up to ${GRAPH_FAN_NAMES_CAP} names`), 'the hint says the cap the model holds');
  assert.ok(sandbox.labels.names.hint.includes(`a fan of ${GRAPH_FAN_NAMES_SMALL} cards or fewer`), 'and the size of a fan that names every card');
});

// --- the Unnested option --------------------------------------------------------------------------------
// Card 7 of the board above has no parent, no children and no tier (it waits for card 1): the
// card the option is about. Its mode is one browser choice for the board, like the others.

const ringRadius = (s) => s.run("(()=>{const p=graphCur.layout.pos.get('7');return Math.hypot(p.x,p.y)})()");
const lastRing = (s) => s.run('(()=>{const b=graphCur.layout.bands;return b[b.length-1].rings[0]})()');
const drawnIds = (s) => JSON.parse(s.run('JSON.stringify(graphCur.model.nodes.map((n)=>n.id).sort((a,b)=>a-b))'));
const shownIds = (s) => JSON.parse(s.run('JSON.stringify([...shownCardIds()].sort((a,b)=>a-b))'));
const UNFOLDED = {};

test('unnested outermost is what the Graph opens with: card 7 is on a ring outside the other bands, and there is no block', async () => {
  const s = await open();
  assert.strictEqual(s.run('graphCur.layout.block'), null);
  assert.ok(Math.abs(ringRadius(s) - lastRing(s)) < 1e-6, 'card 7 is on the last band\'s ring');
  assert.strictEqual(s.run('graphCur.layout.bands.length'), 4, 'the two tiers, the depth 1 ring and the ring of unnested cards');
});

test('pressing table draws the block, depth 0 the ring and sector, and each press stores the whole row for the board', async () => {
  const s = await open({ stored: UNFOLDED });
  pressOption(s, 'unnested', 'table');
  assert.notStrictEqual(s.run('graphCur.layout.block'), null, 'the block is back');
  assert.strictEqual(s.run('graphCur.layout.bands.slice(-1)[0].slice === null'), false, 'and the ring is gone');
  assert.deepStrictEqual(JSON.parse(s.stored[key('kanban', 'graph.options')]), { lines: 'folded', dependencies: 'on', order: 'status', names: 'relevant', unnested: 'table' });
  pressOption(s, 'unnested', 'depth 0');
  assert.strictEqual(s.run('graphCur.layout.block'), null);
  assert.strictEqual(s.run("graphCur.layout.sectors.map((x)=>x.kind).join()"), 'tree,unnested');
  assert.strictEqual(s.run("graphCur.layout.places.get('7').block"), null, 'card 7 is on a ring of the depth 0 band');
  assert.strictEqual(JSON.parse(s.stored[key('kanban', 'graph.options')]).unnested, 'depth 0');
  pressOption(s, 'unnested', 'outermost');
  assert.ok(Math.abs(ringRadius(s) - lastRing(s)) < 1e-6);
  assert.deepStrictEqual(groups(s.row()).map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['folded'], ['on'], ['status'], ['relevant'], ['outermost']], 'the row shows what is held');
});

test('pressing off takes card 7 and its arrow out of the Graph: no dot, no line, the count says one card and one relation fewer', async () => {
  const s = await open({ stored: UNFOLDED });
  assert.deepStrictEqual(drawnIds(s), [1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(s.drawn('wait').length, 2);
  assert.strictEqual(byClass(s.host, 'graph-count')[0].textContent, '7 cards, 7 relations');
  pressOption(s, 'unnested', 'off');
  assert.deepStrictEqual(drawnIds(s), [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(s.run("graphCur.nodeEls.has('7')"), false, 'no dot');
  assert.strictEqual(s.drawn('wait').length, 1, 'the arrow of card 3 to card 4 stays; card 1 to card 7 is gone');
  assert.strictEqual(byClass(s.host, 'graph-count')[0].textContent, '6 cards, 6 relations');
  pressOption(s, 'unnested', 'table');
  assert.deepStrictEqual(drawnIds(s), [1, 2, 3, 4, 5, 6, 7], 'any other mode draws it again');
  assert.strictEqual(s.drawn('wait').length, 2);
});

test('off is only the Tiers layout\'s: Force and Status draw every card, whatever is stored', async () => {
  const stored = { ...UNFOLDED, [key('kanban', 'graph.options')]: JSON.stringify({ unnested: 'off' }) };
  assert.deepStrictEqual(drawnIds(await open({ stored })), [1, 2, 3, 4, 5, 6]);
  for (const layout of ['force', 'status']) assert.deepStrictEqual(drawnIds(await open({ stored, layout })), [1, 2, 3, 4, 5, 6, 7], layout);
});

test('a card off leaves the selection too: a selection reaches only cards the Graph draws', async () => {
  const s = await open({ stored: UNFOLDED });
  s.run('setSelection(addPart(addPart(NO_SELECTION, cardPart(3)), cardPart(7)), 3)');
  assert.deepStrictEqual([...s.run('selectedIds')].sort(), [3, 7]);
  assert.deepStrictEqual(shownIds(s), [1, 2, 3, 4, 5, 6, 7]);
  pressOption(s, 'unnested', 'off');
  assert.deepStrictEqual(shownIds(s), [1, 2, 3, 4, 5, 6], 'the view shows six cards');
  assert.deepStrictEqual([...s.run('selectedIds')].sort(), [3], 'and the selection no longer holds the seventh, so no bulk edit can reach it');
  pressOption(s, 'unnested', 'depth 0');
  assert.deepStrictEqual([...s.run('selectedIds')].sort(), [3, 7], 'it comes back with the card');
});

test('what a selection can reach is what the Graph draws, with a status pill hiding a status under off too', async () => {
  const s = await open({ stored: UNFOLDED });
  pressOption(s, 'unnested', 'off');
  s.run("graphToggleFilter('done')");
  assert.deepStrictEqual(drawnIds(s), [1, 3, 4, 5, 6], 'card 2 is done, card 7 is off');
  assert.deepStrictEqual(shownIds(s), drawnIds(s));
  s.run("graphToggleFilter('done')");
  assert.deepStrictEqual(shownIds(s), drawnIds(s));
  assert.deepStrictEqual(drawnIds(s), [1, 2, 3, 4, 5, 6]);
});

test('off leaves the selection of Force alone: the layouts without the option show every card', async () => {
  const stored = { ...UNFOLDED, [key('kanban', 'graph.options')]: JSON.stringify({ unnested: 'off' }) };
  assert.deepStrictEqual(shownIds(await open({ stored })), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(shownIds(await open({ stored, layout: 'force' })), [1, 2, 3, 4, 5, 6, 7]);
});

test('the mode is kept for the board: a reload draws it, and another board has its own', async () => {
  const first = await open({ stored: UNFOLDED });
  pressOption(first, 'unnested', 'off');
  const reloaded = await open({ stored: first.stored });
  assert.deepStrictEqual(drawnIds(reloaded), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(groups(reloaded.row()).map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['folded'], ['on'], ['status'], ['relevant'], ['off']]);
  const other = await open({ stored: { ...first.stored }, name: 'shop' });
  assert.deepStrictEqual(drawnIds(other), [1, 2, 3, 4, 5, 6, 7], 'the shop board has chosen nothing');
  assert.strictEqual(other.run('graphLoadOptions().unnested'), 'outermost');
  const stale = await open({ stored: { [key('kanban', 'graph.options')]: JSON.stringify({ unnested: 'ring' }) } });
  assert.strictEqual(stale.run('graphLoadOptions().unnested'), 'outermost', 'a stored mode this version does not offer reads as the default');
});

test('a mode frames the view again when the person has not moved it, and leaves one the person moved alone', async () => {
  const size = { w: 900, h: 600 };
  const s = await open({ size, stored: UNFOLDED });
  const fitted = () => JSON.parse(s.run('JSON.stringify(graphFit(graphCur.layout.bounds, graphCur.w, graphCur.h))'));
  const view = () => { const v = viewOf(s); return { x: v.x, y: v.y, k: v.k }; };
  assert.deepStrictEqual(view(), fitted(), 'the first draw is the fit of the ring\'s bounds');
  const ringBounds = JSON.stringify(s.run('graphCur.layout.bounds'));
  pressOption(s, 'unnested', 'table');
  assert.notStrictEqual(JSON.stringify(s.run('graphCur.layout.bounds')), ringBounds, 'the block changes what is framed');
  assert.deepStrictEqual(view(), fitted(), 'an untouched view is fitted to the new bounds');
  s.run('graphZoomBy(1.5, 100, 100)');
  const zoomed = viewOf(s);
  assert.strictEqual(zoomed.touched, true);
  pressOption(s, 'unnested', 'depth 0');
  assert.deepStrictEqual(viewOf(s), zoomed, 'a view the person zoomed stays as it is');
});

// Switching the layout changes the cards the Graph draws when Unnested is off (it is the Tiers layout's
// alone), and a selection and the pill and slice counts only reach the cards the view draws.
const layoutButton = (s, layout) => {
  const button = byClass(s.host, 'graph-layout-btn').map(matcher).find((b) => b.dataset.layout === layout);
  assert.ok(button, `the ${layout} button is there`);
  return button;
};

test('switching from Force to Tiers with Unnested off takes the unnested card out of the selection, and switching back brings it again', async () => {
  const stored = { ...UNFOLDED, [key('kanban', 'graph.options')]: JSON.stringify({ unnested: 'off' }) };
  const s = await open({ stored, layout: 'force' });
  s.run('setSelection(addPart(addPart(NO_SELECTION, cardPart(3)), cardPart(7)), 3)');
  assert.deepStrictEqual([...s.run('selectedIds')].sort(), [3, 7], 'Force draws every card');
  assert.deepStrictEqual(shownIds(s), [1, 2, 3, 4, 5, 6, 7]);
  s.click(layoutButton(s, 'tiers'));
  assert.deepStrictEqual(shownIds(s), [1, 2, 3, 4, 5, 6], 'Tiers with Unnested off leaves card 7 out');
  assert.deepStrictEqual([...s.run('selectedIds')].sort(), [3], 'so the selection does not hold it: no bulk edit can reach a card the view does not draw');
  s.click(layoutButton(s, 'force'));
  assert.deepStrictEqual([...s.run('selectedIds')].sort(), [3, 7], 'Force draws it again');
});

test('the pill counts follow the layout switch the same way', async () => {
  const stored = { ...UNFOLDED, [key('kanban', 'graph.options')]: JSON.stringify({ unnested: 'off' }) };
  const s = await open({ stored, layout: 'force' });
  const counted = () => JSON.parse(s.run('JSON.stringify(cardsBeforeSearch().map((c) => c.id).sort((a, b) => a - b))'));
  assert.deepStrictEqual(counted(), [1, 2, 3, 4, 5, 6, 7]);
  s.click(layoutButton(s, 'tiers'));
  assert.deepStrictEqual(counted(), [1, 2, 3, 4, 5, 6]);
});

test('a layout switch with Unnested on is a redraw alone: it works the selection out no more than it did', async () => {
  const s = await open({ stored: UNFOLDED, layout: 'force' });
  let repaints = 0;
  const real = s.page.ctx.renderBoard;
  s.page.ctx.renderBoard = (...args) => { repaints++; return real(...args); };
  s.click(layoutButton(s, 'tiers'));
  assert.strictEqual(repaints, 0);
  assert.strictEqual(s.run('graphLoadLayout()'), 'tiers');
});
