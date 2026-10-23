const { test } = require('node:test');
const assert = require('node:assert');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');

// The Graph's Hierarchy | Flow choice and the Flow's Dependencies switch in the real page
// (helpers/page-vm.js runs every script the page loads in one vm): where the choice stands in the
// option panel, what a press draws, what the board keeps and what the address says, and which of the
// two wins on a load. The browser runner drives the same panel in Chrome (scenarios/graph-flow.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Card 1 is done and 2 waits for it; 3 waits for 2; 4 waits for 3 and 5 (5 is ready); 6 waits for nothing
// and nothing waits for it. Frontier: done 1, ready now 2 and 5, 1 step 3, 2 steps 4, strip 6. All: chain
// 0 is 1 and 5, 1 is 2, 2 is 3, 3 is 4.
const makeBoard = (name = 'kanban') => ({
  projectName: name,
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  hierarchy: ['goal', 'strategy'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { status: 'done' }), card(2, { waiting_for: [1], status: 'doing' }), card(3, { waiting_for: [2] }),
    card(4, { waiting_for: [3, 5] }), card(5), card(6),
  ],
  archived: [],
});

// Goal 10 and goal 20 each hold two cards: 12 waits for 11, and 22 for 21, which is done. Goal 30 holds
// 31 and 32 with no dependency. Frontier lanes: goal 10 and goal 20, each one card ready; the strip holds
// the goals and 31, 32.
const makeLaneBoard = (name = 'kanban') => ({
  ...makeBoard(name),
  types: [{ name: 'goal', icon: 'diamond', color: '#a33' }],
  hierarchy: ['goal'],
  active: [
    card(10, { type: 'goal' }), card(11, { parent: 10 }), card(12, { parent: 10, waiting_for: [11] }),
    card(20, { type: 'goal' }), card(21, { parent: 20, status: 'done' }), card(22, { parent: 20, waiting_for: [21], status: 'doing' }),
    card(30, { type: 'goal' }), card(31, { parent: 30 }), card(32, { parent: 30 }),
  ],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const hiddenSurface = () => { const el = control(); el.classList.add('hidden'); return el; };

async function open({ stored = {}, name = 'kanban', search = '', board = null } = {}) {
  const host = recordingElement('div');
  const elements = { '#graph-view': host };
  for (const sel of HIDDEN_SURFACES) elements[sel] = hiddenSurface();
  const all = { [`kanban.${name}.view.mode`]: 'graph', ...stored };
  const page = loadPage({
    board: board || makeBoard(name), stored: all, search, elements, documentExtras: recordingDocument(),
  });
  const address = [];
  page.ctx.history = {
    replaceState: (state, title, url) => { address.push(url); page.ctx.location.search = url.slice(url.indexOf('?') === -1 ? url.length : url.indexOf('?')); },
  };
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const onLoad = address.splice(0);
  return {
    page, host, stored: all, name, address, onLoad,
    run: (code) => page.run(code),
    panel: () => byClass(host, 'view-panel')[0] || null,
    kindButtons: () => byClass(host, 'graph-kind-btn'),
    click(el) {
      const target = new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (el.matches(sel) ? el : null) : harmless(String(key))) });
      host.fire('click', { target, stopPropagation() {}, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false });
    },
  };
}

function matcher(el) {
  el.matches = (sel) => {
    const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    const attrs = [...sel.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), m[2]]);
    const own = el.classes || [];
    return classes.every((c) => own.includes(c)) && attrs.every(([k, v]) => (v === undefined ? el.dataset[k] !== undefined : el.dataset[k] === v));
  };
  return el;
}

const kind = (s, name) => matcher(s.kindButtons().find((b) => b.dataset.graphKind === name));
const depsButton = (s, val) => matcher(byClass(s.host, 'graph-option-btn').find((b) => b.dataset.key === 'deps' && b.dataset.val === val));
const lanesButton = (s, val) => matcher(byClass(s.host, 'graph-option-btn').find((b) => b.dataset.key === 'lanes' && b.dataset.val === val));
const pressedLanes = (s) => byClass(s.host, 'graph-option-btn').filter((b) => b.dataset.key === 'lanes' && b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.val);
const laneHeads = (s) => byClass(s.host, 'graph-flow-lane-head');
const pressedKinds = (s) => s.kindButtons().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.graphKind);
const pressedDeps = (s) => byClass(s.host, 'graph-option-btn').filter((b) => b.dataset.key === 'deps' && b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.val);
const json = (s, code) => JSON.parse(s.run(`JSON.stringify(${code})`));
const heads = (s) => json(s, 'graphCur.plan.flow.texts').map((t) => t.text);
const key = (name, feature) => `kanban.${name}.${feature}`;
const search = (s) => s.page.ctx.location.search;

// --- the choice -----------------------------------------------------------------------

test('the toolbar has the Hierarchy | Flow choice, Hierarchy pressed, and Hierarchy is the tier fan with its options and no layout buttons', async () => {
  const s = await open();
  const panel = s.panel();
  assert.deepStrictEqual(s.kindButtons().map((b) => [b.dataset.graphKind, b.textContent]), [['hierarchy', 'Hierarchy'], ['flow', 'Flow']]);
  assert.strictEqual(byClass(panel, 'graph-kinds').length, 0, 'the choice is not in the panel');
  assert.strictEqual(byClass(byClass(s.host, 'graph-controls')[0], 'graph-kinds').length, 1, 'it stands in the toolbar, left of the (i) and the panel button');
  assert.ok(panel.children.some((c) => c.classes.includes('graph-zoom')), 'the zoom row leads the panel');
  assert.deepStrictEqual(pressedKinds(s), ['hierarchy']);
  assert.strictEqual(s.run('graphCur.kind'), 'hierarchy');
  assert.strictEqual(byClass(s.host, 'graph-layout-btn').length, 0, 'Force and Status are gone: the Hierarchy offers no layout to pick');
  assert.strictEqual(byClass(s.host, 'graph-options').length, 1);
  assert.strictEqual(byClass(s.host, 'graph-flow-options').length, 0, 'no Dependencies switch beside the Hierarchy');
  assert.strictEqual(s.run('graphCur.plan.flow.rects.length'), 0);
  for (const b of s.kindButtons()) {
    assert.strictEqual(b.dataset.keepsSelection, '');
    assert.strictEqual(b.type, 'button');
    assert.ok(b.title.length > 20, 'each choice explains itself');
  }
});

test('a press on Flow draws the board by its dependencies in frontier columns, keeps the choice for the board and writes the address', async () => {
  const s = await open();
  s.click(kind(s, 'flow'));
  assert.strictEqual(s.run('graphCur.kind'), 'flow');
  assert.deepStrictEqual(pressedKinds(s), ['flow']);
  assert.deepStrictEqual(heads(s), ['done · 1', 'ready now · 2', '1 step · 1', '2 steps · 1', 'no dependency either way · 1 card']);
  assert.strictEqual(s.stored[key('kanban', 'graph.layout')], 'flow');
  assert.deepStrictEqual(s.address, ['/?graph=flow&deps=frontier&lanes=0']);
  assert.strictEqual(byClass(s.host, 'graph-options').length, 1, 'the fan\'s option row is the Hierarchy\'s');
  assert.strictEqual(byClass(s.host, 'graph-flow-options').length, 1);
  assert.ok(s.run(`graphCur.svg.classes.includes('graph-flow-frontier')`), 'the drawing says which columns it has');
  assert.strictEqual(s.run('graphCur.plan.links.length'), 4, 'one arrow for each dependency');
  assert.ok(s.run('graphCur.plan.links.every((l) => l.kind === "wait" && l.arrow)'));
});

test('the Dependencies switch is two buttons, frontier pressed at first, and a press on all redraws the columns and is kept and written', async () => {
  const s = await open();
  s.click(kind(s, 'flow'));
  assert.deepStrictEqual(byClass(s.host, 'graph-flow-options')[0].children.map((g) => byClass(g, 'graph-option-label')[0].textContent), ['Dependencies', 'Lanes']);
  assert.deepStrictEqual(byClass(s.host, 'graph-option-btn').filter((b) => b.dataset.key === 'deps').map((b) => [b.dataset.val, b.textContent]), [['frontier', 'frontier'], ['all', 'all']]);
  assert.deepStrictEqual(pressedDeps(s), ['frontier']);
  assert.ok(byClass(s.host, 'graph-option-btn').filter((b) => b.dataset.key === 'deps').every((b) => b.dataset.keepsSelection === '' && b.dataset.holdsPoll === undefined));
  s.click(depsButton(s, 'all'));
  assert.deepStrictEqual(pressedDeps(s), ['all']);
  assert.deepStrictEqual(heads(s), ['waits for nothing · 2', 'chain 1 · 1', 'chain 2 · 1', 'chain 3 · 1', 'no dependency either way · 1 card']);
  assert.strictEqual(s.stored[key('kanban', 'graph.deps')], 'all');
  assert.strictEqual(search(s), '?graph=flow&deps=all&lanes=0');
  assert.ok(!s.run(`graphCur.svg.classes.includes('graph-flow-frontier')`));
  assert.ok(s.run(`graphCur.svg.classes.includes('graph-flow-all')`));
  s.click(depsButton(s, 'all'));
  assert.strictEqual(s.address.length, 2, 'a press on the pressed button changes nothing');
  s.click(depsButton(s, 'frontier'));
  assert.strictEqual(search(s), '?graph=flow&deps=frontier&lanes=0');
});

test('a press on Hierarchy goes back to the tier fan, keeps the choice and takes deps and lanes out of the address', async () => {
  const s = await open();
  s.click(kind(s, 'flow'));
  assert.strictEqual(s.run('graphCur.kind'), 'flow');
  s.click(kind(s, 'hierarchy'));
  assert.strictEqual(s.run('graphCur.kind'), 'hierarchy');
  assert.deepStrictEqual(pressedKinds(s), ['hierarchy']);
  assert.strictEqual(s.stored[key('kanban', 'graph.layout')], 'hierarchy');
  assert.strictEqual(search(s), '?graph=hierarchy');
});

test('a board that kept Force or Status opens on the Hierarchy, and a press on Flow and back keeps it there', async () => {
  for (const gone of ['force', 'status']) {
    const s = await open({ stored: { [key('kanban', 'graph.layout')]: gone } });
    assert.strictEqual(s.run('graphCur.kind'), 'hierarchy', gone);
    assert.deepStrictEqual(pressedKinds(s), ['hierarchy'], gone);
    assert.strictEqual(byClass(s.host, 'graph-layout-btn').length, 0, gone);
    s.click(kind(s, 'flow'));
    s.click(kind(s, 'hierarchy'));
    assert.strictEqual(s.run('graphCur.kind'), 'hierarchy', gone);
    assert.strictEqual(s.stored[key('kanban', 'graph.layout')], 'hierarchy', `${gone} is overwritten by the next choice`);
  }
});

test('a board that kept tiers, the old name of the Hierarchy, opens on the Hierarchy and is written back under its new name on the next choice', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.layout')]: 'tiers' } });
  assert.strictEqual(s.run('graphCur.kind'), 'hierarchy');
  assert.deepStrictEqual(pressedKinds(s), ['hierarchy']);
  assert.deepStrictEqual(s.onLoad, ['/?graph=hierarchy']);
  s.click(kind(s, 'flow'));
  s.click(kind(s, 'hierarchy'));
  assert.strictEqual(s.stored[key('kanban', 'graph.layout')], 'hierarchy');
});

test('the Graph reads graph= of an address itself, and writes it with the switches of the Flow from graph-flow.js', async () => {
  const s = await open();
  const kindOf = (search) => s.run(`graphAddressKind(${JSON.stringify(search)})`);
  assert.strictEqual(kindOf('?view=graph&graph=flow&deps=all'), 'flow');
  assert.strictEqual(kindOf('?graph=hierarchy'), 'hierarchy');
  for (const bad of ['?graph=tiers', '?graph=force', '?graph=', '', '?deps=all']) assert.strictEqual(kindOf(bad), null, bad);
  const addressFor = (search, k, deps, laned) => s.run(`graphAddressFor(${JSON.stringify(search)}, ${JSON.stringify(k)}, ${JSON.stringify(deps)}, ${laned})`);
  assert.strictEqual(addressFor('', 'flow', 'frontier', false), '?graph=flow&deps=frontier&lanes=0');
  assert.strictEqual(addressFor('?view=graph&q=a+b&card=7', 'flow', 'all', true), '?view=graph&q=a+b&card=7&graph=flow&deps=all&lanes=1');
  assert.strictEqual(addressFor('?graph=flow&deps=all&lanes=0&q=x', 'hierarchy', 'all', false), '?graph=hierarchy&q=x');
  assert.strictEqual(addressFor('?graph=flow&deps=frontier&lanes=0', 'flow', 'all', false), '?graph=flow&deps=all&lanes=0');
  assert.strictEqual(addressFor('?graph=hierarchy', 'hierarchy', 'frontier', false), null, 'an address that already says it is left alone');
  assert.strictEqual(addressFor('?graph=flow&deps=all&lanes=0', 'flow', 'all', false), null);
  assert.strictEqual(addressFor('?graph=flow&deps=all', 'radial', 'all', false), '?graph=hierarchy');
});

test('an element of a card is found again as the kind it was: a lane header as a header, a dot as a dot', async () => {
  const s = await open();
  const root = { querySelector: (sel) => sel };
  const head = { classList: { contains: (c) => c === 'graph-flow-lane-head' } };
  const dot = { classList: { contains: () => false } };
  s.page.ctx.root = root;
  s.page.ctx.head = head;
  s.page.ctx.dot = dot;
  assert.strictEqual(s.run('graphCardEl(root, 12, head)'), '.card-el[data-id="12"].graph-flow-lane-head');
  assert.strictEqual(s.run('graphCardEl(root, 12, dot)'), '.card-el[data-id="12"]:not(.graph-flow-lane-head)');
  assert.strictEqual(s.run('graphCardEl(root, 12, null)'), '.card-el[data-id="12"]:not(.graph-flow-lane-head)');
});

test('an address that names a layout this version does not draw is junk, and leaves the board\'s choice, which reads as the Hierarchy if it was Force or Status', async () => {
  const kept = await open({ search: '?view=graph&graph=force', stored: { [key('kanban', 'graph.layout')]: 'status' } });
  assert.strictEqual(kept.run('graphCur.kind'), 'hierarchy');
  assert.deepStrictEqual(pressedKinds(kept), ['hierarchy']);
  const flow = await open({ search: '?view=graph&graph=status', stored: { [key('kanban', 'graph.layout')]: 'flow' } });
  assert.strictEqual(flow.run('graphCur.kind'), 'flow', 'junk leaves the Flow the board kept');
});

// --- remembered, and the address --------------------------------------------------------------

test('a board that kept Flow and all opens on them, and another board keeps its own', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.layout')]: 'flow', [key('kanban', 'graph.deps')]: 'all' } });
  assert.strictEqual(s.run('graphCur.kind'), 'flow');
  assert.deepStrictEqual(pressedDeps(s), ['all']);
  const other = await open({ name: 'other', stored: { [key('kanban', 'graph.layout')]: 'flow', [key('other', 'graph.deps')]: 'all' } });
  assert.strictEqual(other.run('graphCur.kind'), 'hierarchy', 'the other board kept nothing under its own name');
  assert.strictEqual(other.run('graphLoadDeps()'), 'all');
});

test('a stored switch or layout this version does not offer reads as the defaults', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.layout')]: 'flow', [key('kanban', 'graph.deps')]: 'sideways' } });
  assert.deepStrictEqual(pressedDeps(s), ['frontier']);
  const t = await open({ stored: { [key('kanban', 'graph.layout')]: 'hierarchy' } });
  assert.strictEqual(t.run('graphCur.kind'), 'hierarchy');
});

test('the address wins on a load: graph=flow and deps=all open the Flow on all whatever the board kept, graph=hierarchy leaves the Flow', async () => {
  const link = await open({ search: '?view=graph&graph=flow&deps=all', stored: { [key('kanban', 'graph.layout')]: 'hierarchy', [key('kanban', 'graph.deps')]: 'frontier' } });
  assert.strictEqual(link.run('graphCur.kind'), 'flow');
  assert.deepStrictEqual(pressedDeps(link), ['all']);
  const away = await open({ search: '?graph=hierarchy', stored: { [key('kanban', 'graph.layout')]: 'flow' } });
  assert.strictEqual(away.run('graphCur.kind'), 'hierarchy');
  assert.deepStrictEqual(pressedKinds(away), ['hierarchy']);
  const bare = await open({ search: '?graph=flow', stored: { [key('kanban', 'graph.deps')]: 'all' } });
  assert.strictEqual(bare.run('graphCur.kind'), 'flow');
  assert.deepStrictEqual(pressedDeps(bare), ['all'], 'a link without deps is the board\'s own');
  const junk = await open({ search: '?graph=radial&deps=never', stored: { [key('kanban', 'graph.layout')]: 'flow' } });
  assert.strictEqual(junk.run('graphCur.kind'), 'flow', 'an address that says nothing usable leaves the board\'s choice');
  assert.deepStrictEqual(pressedDeps(junk), ['frontier']);
});

test('the address says the shown Graph on a load too, replacing the entry and keeping every other parameter, so a link copied after a reload opens the same picture', async () => {
  const plain = await open({ search: '?view=graph&q=wait' });
  assert.deepStrictEqual(plain.onLoad, ['/?view=graph&q=wait&graph=hierarchy'], 'the Hierarchy from memory is written');
  const flow = await open({ stored: { [key('kanban', 'graph.layout')]: 'flow', [key('kanban', 'graph.deps')]: 'all', [key('kanban', 'graph.lanes')]: '1' } });
  assert.deepStrictEqual(flow.onLoad, ['/?graph=flow&deps=all&lanes=1'], 'the Flow with its switches from memory is written');
  const said = await open({ search: '?view=graph&graph=flow&deps=all&lanes=0' });
  assert.deepStrictEqual(said.onLoad, [], 'an address that already says it is left alone');
  const partial = await open({ search: '?graph=flow', stored: { [key('kanban', 'graph.deps')]: 'all' } });
  assert.deepStrictEqual(partial.onLoad, ['/?graph=flow&deps=all&lanes=0'], 'what the link left out is filled from memory');
  flow.run('renderGraphView()');
  assert.deepStrictEqual(flow.address, [], 'a redraw, as the poll makes, writes nothing more');
});

test('the address is left alone while another view shows', async () => {
  const s = await open({ search: '?view=board', stored: { [key('kanban', 'view.mode')]: 'board' } });
  assert.deepStrictEqual(s.onLoad, []);
});

test('a press writes the address with the parameters it already has kept, and replaces the entry rather than adding one', async () => {
  const s = await open({ search: '?view=graph&q=wait&card=2' });
  s.click(kind(s, 'flow'));
  assert.strictEqual(search(s), '?view=graph&q=wait&card=2&graph=flow&deps=frontier&lanes=0');
  assert.ok(s.page.ctx.history.replaceState, 'it is replaceState');
  assert.strictEqual(s.page.run('typeof history.pushState'), 'undefined', 'the test history has no pushState to be called');
});

// --- the lights ------------------------------------------------------------------------------

test('the Flow lights a card with its dependencies alone, and the Hierarchy with all its relations', async () => {
  const s = await open();
  s.click(kind(s, 'flow'));
  assert.strictEqual(s.run('graphLinkKind()'), 'wait');
  s.click(kind(s, 'hierarchy'));
  assert.strictEqual(s.run('graphLinkKind()'), undefined);
});

test('Flow draws no card twice and every card the board shows, whatever the switch', async () => {
  const s = await open({ stored: { [key('kanban', 'graph.layout')]: 'flow' } });
  for (const deps of ['frontier', 'all']) {
    s.click(depsButton(s, deps));
    assert.deepStrictEqual(json(s, 'graphCur.plan.nodes.map((n) => n.id).sort()'), ['1', '2', '3', '4', '5', '6'], deps);
  }
});

test('the archive pill brings archived cards into the Flow, in the done column, faded as done and with the dependency they hold up', async () => {
  const base = makeBoard();
  const board = { ...base, active: [...base.active, card(8, { waiting_for: [7] })], archived: [card(7, { status: 'done', archived: true })] };
  const s = await open({ board, stored: { [key('kanban', 'graph.layout')]: 'flow' } });
  const ids = () => json(s, 'graphCur.plan.nodes.map((n) => n.id).sort()');
  assert.deepStrictEqual(ids(), ['1', '2', '3', '4', '5', '6', '8'], 'archived cards are out until the pill brings them in');
  assert.deepStrictEqual(heads(s), ['done · 1', 'ready now · 2', '1 step · 1', '2 steps · 1', 'no dependency either way · 2 cards'], 'and 8, whose dependency is out, has none drawn');
  s.run(`graphToggleFilter('archive')`);
  assert.deepStrictEqual(ids(), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepStrictEqual(heads(s), ['done · 2', 'ready now · 3', '1 step · 1', '2 steps · 1', 'no dependency either way · 1 card']);
  assert.deepStrictEqual(json(s, 'graphCur.layout.flow.columns[0].ids'), ['1', '7'], 'the archived card stands in the done column');
  assert.strictEqual(json(s, 'graphCur.layout.flow.columns[0].faded'), true);
  assert.ok(json(s, 'graphCur.plan.nodes.find((n) => n.id === "7").cls').split(' ').includes('archived'), 'its dot carries archived, which the frontier columns fade');
  assert.ok(s.run(`graphCur.svg.classes.includes('graph-flow-frontier')`), 'the drawing that fades archived dots is the frontier one');
  assert.deepStrictEqual(json(s, 'graphCur.layout.flow.columns[1].ids.includes("8")'), true, 'the card it held up is ready now');
});

// --- the lanes ------------------------------------------------------------------------------

test('the Lanes switch is off and on, off pressed at first, and no lane is drawn while it is off', async () => {
  const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.layout')]: 'flow' } });
  assert.deepStrictEqual(byClass(s.host, 'graph-option-btn').filter((b) => b.dataset.key === 'lanes').map((b) => [b.dataset.val, b.textContent]), [['off', 'off'], ['on', 'on']]);
  assert.deepStrictEqual(pressedLanes(s), ['off']);
  assert.ok(byClass(s.host, 'graph-option-btn').filter((b) => b.dataset.key === 'lanes').every((b) => b.dataset.keepsSelection === '' && b.dataset.holdsPoll === undefined));
  assert.strictEqual(laneHeads(s).length, 0);
  assert.strictEqual(s.run('graphCur.plan.flow.heads.length'), 0);
});

test('a press on on draws a lane for each tier card with its header, and the press is kept for the board and written to the address', async () => {
  const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.layout')]: 'flow' } });
  s.click(lanesButton(s, 'on'));
  assert.deepStrictEqual(pressedLanes(s), ['on']);
  assert.deepStrictEqual(json(s, 'graphCur.plan.flow.heads.map((h) => h.text)'), [
    'goal \u00b7 #10 Card 10 \u00b7 2 cards \u00b7 1 ready', 'goal \u00b7 #20 Card 20 \u00b7 2 cards \u00b7 1 ready',
  ]);
  assert.deepStrictEqual(heads(s), ['done \u00b7 1', 'ready now \u00b7 2', '1 step \u00b7 1', 'no open dependency \u00b7 5 cards']);
  assert.strictEqual(s.stored[key('kanban', 'graph.lanes')], '1');
  assert.strictEqual(search(s), '?graph=flow&deps=frontier&lanes=1');
  s.click(lanesButton(s, 'on'));
  assert.strictEqual(s.address.length, 1, 'a press on the pressed button changes nothing');
  s.click(lanesButton(s, 'off'));
  assert.strictEqual(s.stored[key('kanban', 'graph.lanes')], '0');
  assert.strictEqual(search(s), '?graph=flow&deps=frontier&lanes=0');
  assert.strictEqual(laneHeads(s).length, 0);
});

test('a lane header is drawn with its card id and type mark, and is its card\'s node: a graph-node and card-el with a tab stop, and the card keeps its one dot', async () => {
  const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.layout')]: 'flow', [key('kanban', 'graph.lanes')]: '1' } });
  const found = laneHeads(s);
  assert.deepStrictEqual(found.map((h) => h.attrs['data-id']), ['10', '20']);
  for (const h of found) {
    assert.ok(h.classes.includes('graph-node') && h.classes.includes('card-el'), 'every handler of the dots finds it');
    assert.strictEqual(String(h.attrs.tabindex), '0', 'it is a tab stop');
    assert.ok(byClass(h, 'graph-flow-lanehead-text')[0].textContent.includes(`#${h.attrs['data-id']} Card`));
    const mark = byClass(h, 'graph-flow-icon')[0];
    assert.ok(mark && /^M/.test(mark.attrs.d) && mark.attrs['data-type-color'] === '#a33', 'the mark of the goal type, in its colour');
    const dots = byClass(s.host, 'graph-node').filter((n) => n.attrs['data-id'] === h.attrs['data-id'] && !n.classes.includes('graph-flow-lane-head'));
    assert.strictEqual(dots.length, 1, `card ${h.attrs['data-id']} still has its one dot`);
    assert.strictEqual(byClass(h, 'graph-flow-lanehead-in').length, 1);
  }
  assert.deepStrictEqual(json(s, '[...graphCur.headEls.keys()]'), ['10', '20']);
});

test('a header is selected with the dot of its card, painted in place and on a redraw', async () => {
  const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.layout')]: 'flow', [key('kanban', 'graph.lanes')]: '1' } });
  const selectedHeads = () => laneHeads(s).filter((h) => h.classes.includes('selected')).map((h) => h.attrs['data-id']);
  assert.deepStrictEqual(selectedHeads(), []);
  s.run('selectedIds.add("20"); graphPaintSelection();');
  assert.deepStrictEqual(selectedHeads(), ['20'], 'a card selected elsewhere paints its header');
  s.run('selectedIds.clear(); selectedIds.add("10"); graphPaintSelection();');
  assert.deepStrictEqual(selectedHeads(), ['10'], 'and takes it off the header of another');
  s.run('selectedIds.clear(); renderGraphView();');
  assert.deepStrictEqual(selectedHeads(), []);
  s.run('selectedIds.clear(); selectedIds.add("20"); renderGraphView();');
  assert.deepStrictEqual(selectedHeads(), ['20'], 'a redraw draws the header of a selected card selected');
  const dot = byClass(s.host, 'graph-node').find((n) => n.attrs['data-id'] === '20' && !n.classes.includes('graph-flow-lane-head'));
  assert.ok(dot.classes.includes('selected'), 'the dot of the card is selected with it');
});

test('a header wears the selected look through the one predicate of the page, so a card the box lights is painted like the other surfaces paint it', async () => {
  const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.layout')]: 'flow', [key('kanban', 'graph.lanes')]: '1' } });
  const selectedHeads = () => laneHeads(s).filter((h) => h.classes.includes('selected')).map((h) => h.attrs['data-id']);
  s.run('boxLitIds = new Set(["20"]); renderGraphView();');
  assert.deepStrictEqual(selectedHeads(), ['20'], 'drawn');
  s.run('boxLitIds = new Set(["10"]); graphPaintSelection();');
  assert.deepStrictEqual(selectedHeads(), ['10'], 'and painted in place');
  s.run('boxLitIds = null; graphPaintSelection();');
  assert.deepStrictEqual(selectedHeads(), []);
});

test('lanes are drawn in Flow alone: the Hierarchy has none whatever the board kept', async () => {
  const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.lanes')]: '1' } });
  assert.strictEqual(s.run('graphCur.kind'), 'hierarchy');
  assert.strictEqual(laneHeads(s).length, 0);
  assert.strictEqual(byClass(s.host, 'graph-flow-options').length, 0);
});

test('lanes on in all keeps the outline order and folds only the lanes with no dependency', async () => {
  const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.layout')]: 'flow', [key('kanban', 'graph.lanes')]: '1', [key('kanban', 'graph.deps')]: 'all' } });
  assert.deepStrictEqual(json(s, 'graphCur.plan.flow.heads.map((h) => h.id)'), ['10', '20']);
  assert.deepStrictEqual(heads(s), ['waits for nothing \u00b7 2', 'chain 1 \u00b7 2', 'no dependency either way \u00b7 5 cards']);
});

test('a board that kept lanes opens on them, and another board keeps its own', async () => {
  const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.layout')]: 'flow', [key('kanban', 'graph.lanes')]: '1' } });
  assert.deepStrictEqual(pressedLanes(s), ['on']);
  const other = await open({ name: 'other', board: makeLaneBoard('other'), stored: { [key('kanban', 'graph.lanes')]: '1', [key('other', 'graph.layout')]: 'flow' } });
  assert.deepStrictEqual(pressedLanes(other), ['off']);
});

test('a stored lanes this version does not offer reads as off', async () => {
  for (const junk of ['yes', '2', 'on', '']) {
    const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.layout')]: 'flow', [key('kanban', 'graph.lanes')]: junk } });
    assert.deepStrictEqual(pressedLanes(s), ['off'], junk);
  }
});

test('the address wins on a load: lanes=1 opens the lanes whatever the board kept, lanes=0 closes them, and junk leaves the board its own', async () => {
  const kept = { [key('kanban', 'graph.layout')]: 'flow' };
  const on = await open({ board: makeLaneBoard(), search: '?graph=flow&lanes=1', stored: { ...kept, [key('kanban', 'graph.lanes')]: '0' } });
  assert.deepStrictEqual(pressedLanes(on), ['on']);
  const off = await open({ board: makeLaneBoard(), search: '?graph=flow&lanes=0', stored: { ...kept, [key('kanban', 'graph.lanes')]: '1' } });
  assert.deepStrictEqual(pressedLanes(off), ['off']);
  const junk = await open({ board: makeLaneBoard(), search: '?graph=flow&lanes=maybe', stored: { ...kept, [key('kanban', 'graph.lanes')]: '1' } });
  assert.deepStrictEqual(pressedLanes(junk), ['on']);
});

test('a press on Hierarchy takes lanes out of the address, and the Flow brings it back as it was', async () => {
  const s = await open({ board: makeLaneBoard(), stored: { [key('kanban', 'graph.layout')]: 'flow' } });
  s.click(lanesButton(s, 'on'));
  s.click(kind(s, 'hierarchy'));
  assert.strictEqual(search(s), '?graph=hierarchy');
  s.click(kind(s, 'flow'));
  assert.strictEqual(search(s), '?graph=flow&deps=frontier&lanes=1');
  assert.strictEqual(laneHeads(s).length, 2);
});
