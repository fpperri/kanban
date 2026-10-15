const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');

// The tier fan's option row in the real page (helpers/page-vm.js runs every script the
// page loads in one vm, with elements a test can read back): folded by default behind
// a toggle, shown with Tiers only, three options of segmented buttons, kept per board in
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
    card(2, { parent: 1, status: 'done' }), card(3, { parent: 1 }), card(4, { parent: 1, waiting_for: [3], status: 'doing' }),
    card(5, { parent: 1, status: 'backlog' }), card(6, { parent: 1 }),
    card(7, { waiting_for: [1] }),
  ],
  archived: [],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };

async function open({ stored = {}, name = 'kanban', layout = null } = {}) {
  const host = recordingElement('div');
  const elements = { '#graph-view': host };
  for (const sel of HIDDEN_SURFACES) elements[sel] = hiddenSurface();
  const all = { [`kanban.${name}.view.mode`]: 'graph', ...stored };
  if (layout) all[`kanban.${name}.graph.layout`] = layout;
  const page = await loadPage({
    board: makeBoard(name), stored: all, elements, documentExtras: recordingDocument(),
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
const toggleOf = (row) => row.children.find((c) => c.classes.includes('map-section-header'));

const key = (name, feature) => `kanban.${name}.${feature}`;

// The fold toggle as a click on it reaches the Graph's listeners.
function toggleButton() {
  const toggle = recordingElement('button');
  toggle.className = 'map-section-toggle';
  toggle.dataset.section = 'graph-options';
  return matcher(toggle);
}

// --- folded behind a toggle, with Tiers only -----------------------------------------------

test('the Graph opens in Tiers with the row folded: a toggle and no option', async () => {
  const s = await open();
  const row = s.row();
  assert.ok(row, 'the row is there');
  assert.deepStrictEqual(groups(row), [], 'no option is built while the row is folded');
  const header = toggleOf(row);
  assert.match(header.innerHTML, /data-section="graph-options"/);
  assert.match(header.innerHTML, /aria-expanded="false"/);
  assert.match(header.innerHTML, /aria-label="Expand Options"/);
  assert.match(header.innerHTML, /Options/);
});

test('unfolded, the row holds Lines, Dependencies and Order, each with every value it takes, in words', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
  const row = s.row();
  assert.match(toggleOf(row).innerHTML, /aria-expanded="true"/);
  assert.match(toggleOf(row).innerHTML, /aria-label="Collapse Options"/);
  const g = groups(row);
  assert.deepStrictEqual(g.map((x) => x.label), ['Lines', 'Dependencies', 'Order']);
  assert.deepStrictEqual(g.map((x) => x.buttons.map((b) => b.text)), [['folded', 'chain', 'all', 'off'], ['on', 'off'], ['status', 'rank']]);
  assert.deepStrictEqual(g.map((x) => x.buttons.map((b) => `${b.key}=${b.val}`)), [
    ['lines=folded', 'lines=chain', 'lines=all', 'lines=off'], ['dependencies=on', 'dependencies=off'], ['order=status', 'order=rank'],
  ]);
  for (const x of g) assert.ok(x.title.length > 20, `${x.label} explains itself in a tooltip`);
});

test('exactly one button of each option is pressed: the default at first, the stored choice after', async () => {
  const fresh = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
  assert.deepStrictEqual(groups(fresh.row()).map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['folded'], ['on'], ['status']]);
  const chosen = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false', [key('kanban', 'graph.options')]: JSON.stringify({ lines: 'all', order: 'rank' }) } });
  const g = groups(chosen.row());
  assert.deepStrictEqual(g.map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['all'], ['on'], ['rank']]);
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
  const s = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
  const row = s.row();
  const buttons = byClass(row, 'graph-option-btn');
  assert.strictEqual(buttons.length, 8);
  for (const b of buttons) {
    assert.strictEqual(b.dataset.keepsSelection, '', `${b.dataset.key}=${b.dataset.val} keeps the selection`);
    assert.strictEqual(b.dataset.holdsPoll, undefined, `${b.dataset.key}=${b.dataset.val} does not hold the poll`);
    assert.strictEqual(b.type, 'button');
    assert.strictEqual(b.getAttribute('style'), null);
  }
  assert.strictEqual(row.dataset.keepsSelection, '', 'the row\'s own space keeps the selection too');
  assert.match(toggleOf(row).innerHTML, /data-keeps-selection/);
  assert.doesNotMatch(toggleOf(row).innerHTML, /data-holds-poll|style=|onclick/);
});

// --- pressing ---------------------------------------------------------------------------------

test('the toggle unfolds the row, and the next press folds it; the fold is kept for the board', async () => {
  const s = await open();
  const toggle = toggleButton();
  s.click(toggle);
  assert.deepStrictEqual(groups(s.row()).map((x) => x.label), ['Lines', 'Dependencies', 'Order'], 'unfolded');
  assert.strictEqual(s.stored[key('kanban', 'graph.optionsFolded')], 'false');
  s.click(toggle);
  assert.deepStrictEqual(groups(s.row()), [], 'folded again');
  assert.strictEqual(s.stored[key('kanban', 'graph.optionsFolded')], 'true');
});

test('pressing an option stores the options whole for the board and redraws the fan with the lines it asks for', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
  const count = (kind) => s.drawn(kind).length;
  assert.deepStrictEqual([count('parent'), count('wait')], [2, 2], 'folded, on');
  const press = (k, v) => s.click(groups(s.row()).flatMap((x) => x.buttons).find((b) => b.key === k && b.val === v).el);
  press('lines', 'all');
  assert.deepStrictEqual(JSON.parse(s.stored[key('kanban', 'graph.options')]), { lines: 'all', dependencies: 'on', order: 'status' });
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
  assert.deepStrictEqual(groups(s.row()).map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['folded'], ['on'], ['status']], 'the row shows what is held');
});

test('pressing an order moves siblings in the layout, and the layout is not the same layout as before', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
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
  s.run("graphSetOption('names', 'all')");
  s.run("graphSetOption('toString', 'on')");
  assert.strictEqual(s.stored[key('kanban', 'graph.options')], undefined);
  assert.strictEqual(s.run('graphCur'), before);
});

// --- kept per board ---------------------------------------------------------------------------

test('a reload keeps the options and the fold, and another board keeps its own', async () => {
  const first = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
  first.click(groups(first.row()).flatMap((x) => x.buttons).find((b) => b.key === 'lines' && b.val === 'off').el);
  first.click(groups(first.row()).flatMap((x) => x.buttons).find((b) => b.key === 'order' && b.val === 'rank').el);
  const reloaded = await open({ stored: first.stored });
  assert.deepStrictEqual(groups(reloaded.row()).map((x) => x.buttons.filter((b) => b.pressed === 'true').map((b) => b.val)), [['off'], ['on'], ['rank']]);
  assert.deepStrictEqual(reloaded.drawn('parent').length, 0);
  assert.match(toggleOf(reloaded.row()).innerHTML, /aria-expanded="true"/, 'unfolded, as it was left');
  const other = await open({ stored: { ...first.stored, [key('shop', 'graph.options')]: JSON.stringify({ lines: 'all' }) }, name: 'shop' });
  assert.match(toggleOf(other.row()).innerHTML, /aria-expanded="false"/, 'the other board starts folded');
  assert.strictEqual(other.run('graphLoadOptions().lines'), 'all');
  assert.strictEqual(other.run('graphLoadOptions().order'), 'status');
  assert.strictEqual(first.run('graphLoadOptions().lines'), 'off');
});

test('storage that refuses reads and writes leaves the defaults, and a press still shows this session', async () => {
  const s = await open();
  s.page.ctx.localStorage.getItem = () => { throw new Error('blocked'); };
  s.page.ctx.localStorage.setItem = () => { throw new Error('blocked'); };
  s.run('resetGraphViewState()');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s.run('graphLoadOptions()'))), { lines: 'folded', dependencies: 'on', order: 'status' });
  assert.strictEqual(s.run('graphLoadOptionsFolded()'), true);
  assert.doesNotThrow(() => s.run("graphSetOption('lines', 'all')"));
  assert.strictEqual(s.run('graphLoadOptions().lines'), 'all');
  assert.doesNotThrow(() => s.run('graphToggleOptions()'));
  assert.strictEqual(s.run('graphLoadOptionsFolded()'), false);
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
  const s = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
  const button = groups(s.row()).flatMap((x) => x.buttons)[0].el;
  const target = new Proxy({}, { get: (t, k) => (k === 'closest' ? (sel) => (sel === '.graph-canvas' || sel === '.card-el' || sel === '.graph-node' ? null : (button.matches(sel) ? button : null)) : harmless(String(k))) });
  s.host.fire('pointerdown', { button: 0, pointerId: 1, clientX: 5, clientY: 5, target });
  assert.strictEqual(s.run('graphPan'), null);
  assert.strictEqual(s.run('isDragging'), false);
  const canvas = new Proxy({}, { get: (t, k) => (k === 'closest' ? (sel) => (sel === '.graph-canvas' ? {} : null) : harmless(String(k))) });
  s.host.fire('pointerdown', { button: 0, pointerId: 2, clientX: 5, clientY: 5, target: canvas });
  assert.notStrictEqual(s.run('graphPan'), null, 'the same press on the canvas does start a pan, so the check above can fail');
});

test('a press leaves the selection as it is', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
  s.run('setSelection(addPart(addPart(NO_SELECTION, cardPart(2)), cardPart(5)), 5)');
  const before = JSON.stringify(s.run('selectionState.selection'));
  for (const b of groups(s.row()).flatMap((x) => x.buttons)) s.click(b.el);
  s.click(toggleButton());
  assert.strictEqual(JSON.stringify(s.run('selectionState.selection')), before);
  assert.deepStrictEqual([...s.run('selectedIds')].sort(), [2, 5]);
});

test('a focused option does not hold the poll, and a poll tick that finds it focused refreshes the board', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
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
  const s = await open({ stored: { [key('kanban', 'graph.optionsFolded')]: 'false' } });
  const button = groups(s.row()).flatMap((x) => x.buttons).find((b) => b.key === 'lines' && b.val === 'all').el;
  s.page.ctx.__button = button;
  assert.ok(s.run('PILL_SELECTOR').split(', ').includes('.graph-option-btn'), 'it counts as a pill: focus is handed back after a render');
  assert.strictEqual(s.run('pillSelector(__button)'), '.graph-option-btn[data-key="lines"][data-val="all"]');
  s.page.ctx.__toggle = toggleButton();
  assert.strictEqual(s.run('pillSelector(__toggle)'), '.map-section-toggle[data-section="graph-options"]', 'the toggle has a selector of its own, not the Map\'s');
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
  vm.runInContext(`const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';\n${['graphEl', 'graphTspan', 'graphCaptionEl', 'graphDrawPlan'].map(fn).join('\n')}`, sandbox);
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
  const s = require('./helpers/page-vm');
  assert.ok(s.loadPage);
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'graph-view.js'), 'utf8').replace(/\r\n/g, '\n');
  const labels = src.match(/const GRAPH_FAN_OPTION_LABELS = \{[\s\S]*?\n\};/)[0];
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${labels}\nthis.labels = GRAPH_FAN_OPTION_LABELS;`, sandbox);
  const { GRAPH_FAN_OPTION_VALUES } = require('../web/graph-model');
  assert.deepStrictEqual(Object.keys(sandbox.labels), Object.keys(GRAPH_FAN_OPTION_VALUES));
  for (const meta of Object.values(sandbox.labels)) assert.ok(meta.label && meta.hint.length > 20);
});
