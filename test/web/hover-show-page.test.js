const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control } = require('./helpers/page-vm');

// On hover show, in the real page (helpers/page-vm.js runs every script the page loads in one vm): the cards that
// take the hover look outside the Graph, what the Graph lights for a hovered dot, the panel's boxes and where the
// choice is kept. The dots and tiles are stand-ins that remember their classes; the browser runner looks at the real
// ones (scenarios/hover-show.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Card 1 is the parent of 3, 2 waits for it, and the archived 7 waits for it too. Card 3 has the parent 1.
// Card 4 is on its own.
const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing' }),
    card(2, { title: 'Move the data layer', waiting_for: ['1'] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', parent: 1 }),
    card(4, { title: 'Port the schema' }),
    card(5, { title: 'Draft the release notes', status: 'doing', waiting_for: ['2'] }),
  ],
  archived: [card(7, { title: 'Spike zephyr pooling', status: 'done', archived: true, waiting_for: ['1'] })],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const KINDS = ['dtree', 'htree', 'dpath', 'hpath', 'dlinks', 'hlinks'];
const KEY = 'kanban.kanban.hover.show';

// A stand-in for a tile or a dot: it remembers its classes.
function tile(id) {
  const names = new Set();
  return { dataset: { id: String(id) }, names, classList: { add: (c) => names.add(c), remove: (c) => names.delete(c), contains: (c) => names.has(c) } };
}

async function open({ view = 'board', stored = {}, board = makeBoard() } = {}) {
  const elements = {};
  for (const sel of HIDDEN_SURFACES) { const el = control(); el.classList.add('hidden'); elements[sel] = el; }
  elements['#graph-view'] = control();
  const tiles = ['1', '2', '3', '4', '5'].map(tile);
  const boxes = KINDS.map((kind) => ({ dataset: { hoverKind: kind }, checked: false }));
  const sideBtns = ['hierarchy', 'dependencies'].map((toggle) => ({
    dataset: { hoverSide: toggle }, textContent: '', attrs: {}, title: '', setAttribute(k, v) { this.attrs[k] = v; },
  }));
  const host = control();
  host.querySelectorAll = (sel) => (sel === '[data-hover-side]' ? sideBtns : boxes);
  elements['#search-hover'] = host;
  const documentExtras = {
    querySelectorAll: (sel) => (sel === '.card-el' ? tiles : sel === '.hover-highlight' ? tiles.filter((t) => t.names.has('hover-highlight')) : []),
  };
  const store = { 'kanban.kanban.view.mode': view, ...stored };
  const page = await loadPage({ board, stored: store, elements, documentExtras }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const calls = [];
  const ids = (set) => [...set].map(Number).sort((a, b) => a - b);
  page.ctx.graphLightCards = (lit) => { calls.push(lit ? ids(lit.nodes) : null); };
  const s = {
    page, boxes, host, sideBtns, tiles, calls, stored: store,
    over(id) { page.fireDocument('mouseover', { target: { closest: (sel) => (sel === '.card-el' ? tile(id) : null) } }); },
    out(id) { page.fireDocument('mouseout', { target: { closest: (sel) => (sel === '.card-el' ? tile(id) : null) }, relatedTarget: null }); },
    lit: () => tiles.filter((t) => t.names.has('hover-highlight')).map((t) => Number(t.dataset.id)),
    ticked: () => boxes.filter((b) => b.checked).map((b) => b.dataset.hoverKind),
    tick(kind, on) {
      const box = boxes.find((b) => b.dataset.hoverKind === kind);
      box.checked = on;
      host.fire('change', { target: { closest: (sel) => (sel === '[data-hover-kind]' ? box : null) } });
    },
    step(toggle) {
      const btn = sideBtns.find((b) => b.dataset.hoverSide === toggle);
      host.fire('click', { target: { closest: (sel) => (sel === '[data-hover-side]' ? btn : null) } });
    },
    sides: () => sideBtns.map((b) => b.textContent),
    sync: () => page.run('syncHoverShowPanel()'),
    plain: (code) => JSON.parse(JSON.stringify(page.run(code))),
    fakeGraph() {
      const el = () => {
        const names = new Set();
        return { names, classList: { add: (c) => names.add(c), remove: (c) => names.delete(c), contains: (c) => names.has(c) } };
      };
      const model = page.run('graphBuild(state.active, { ctx: nestingCtx() })');
      page.ctx.__fake = { svg: { ...el(), querySelectorAll: () => [] }, nodeEls: new Map(model.nodes.map((n) => [n.id, el()])), headEls: new Map(), linkEls: model.links.map(() => el()), model, kind: 'hierarchy' };
      page.run('graphCur = __fake');
    },
    focusDot(id) { calls.length = 0; page.run(`graphSetFocus('${id}')`); return calls[calls.length - 1]; },
  };
  return s;
}

// --- the Board, the Map, the Calendar and the Gantt ------------------------------------------------------------------

test('with nothing chosen a hover gives the card, what it waits for and what waits for it, and its parent and children the hover look', async () => {
  const s = await open();
  s.over(1);
  assert.deepStrictEqual(s.lit(), [1, 2, 3], 'card 7 waits for it too, but it is archived and no tile of it is drawn');
  assert.strictEqual(s.page.run('hoveredId'), '1');
  s.out(1);
  assert.deepStrictEqual(s.lit(), [], 'leaving clears it');
  assert.strictEqual(s.page.run('hoveredId'), null);
});

test('a hovered card with no relations is the only one to take the look', async () => {
  const s = await open();
  s.over(4);
  assert.deepStrictEqual(s.lit(), [4]);
});

test('ticking a set while a card is hovered paints again at once, and unticking all leaves the card alone', async () => {
  const s = await open();
  s.over(3);
  assert.deepStrictEqual(s.lit(), [1, 3], 'its parent and itself');
  s.tick('dpath', true);
  assert.deepStrictEqual(s.plain('hoverShowKindsNow()'), ['dpath', 'dlinks', 'hlinks']);
  assert.deepStrictEqual(s.lit(), [1, 3], 'nothing waits for card 3 and it waits for nothing');
  s.tick('hlinks', false);
  s.tick('dlinks', false);
  s.tick('dpath', false);
  assert.deepStrictEqual(s.lit(), [3], 'with nothing ticked the hovered card still takes the look');
  s.tick('htree', true);
  assert.deepStrictEqual(s.lit(), [1, 3], 'the whole parent tree from the root down');
});

test('an old record, a list for the Hierarchy and one for the Flow, is read as the Hierarchy\'s list with both sides on &', async () => {
  const s = await open({ stored: { 'kanban.kanban.graph.layout': 'flow', [KEY]: JSON.stringify({ hierarchy: ['hlinks'], flow: ['dtree'] }) } });
  s.over(1);
  assert.deepStrictEqual(s.lit(), [1, 3], 'hlinks alone, whatever layout the Graph last showed');
});

test('a side on a toggle cuts the hover: below on the Hierarchy lights the card and its children, above its parent, and the wait stays whole', async () => {
  const s = await open({ stored: { [KEY]: JSON.stringify({ kinds: ['dlinks', 'hlinks'], hierarchy: 'below', dependencies: 'before&after' }) } });
  s.over(3);
  assert.deepStrictEqual(s.lit(), [3], 'no child, and the parent is above');
  s.over(1);
  assert.deepStrictEqual(s.lit(), [1, 2, 3], 'the child 3, and card 2 waits for it');
  const above = await open({ stored: { [KEY]: JSON.stringify({ kinds: ['hlinks'], hierarchy: 'above', dependencies: 'before&after' }) } });
  above.over(3);
  assert.deepStrictEqual(above.lit(), [1, 3]);
  above.over(1);
  assert.deepStrictEqual(above.lit(), [1]);
});

test('a side on the Dependencies toggle cuts the d sets: after lights what waits for the card, before what the card waits for', async () => {
  const after = await open({ stored: { [KEY]: JSON.stringify({ kinds: ['dlinks'], hierarchy: 'above&below', dependencies: 'after' }) } });
  after.over(2);
  assert.deepStrictEqual(after.lit(), [2, 5]);
  const before = await open({ stored: { [KEY]: JSON.stringify({ kinds: ['dlinks'], hierarchy: 'above&below', dependencies: 'before' }) } });
  before.over(2);
  assert.deepStrictEqual(before.lit(), [1, 2]);
});

test('a poll\'s rebuild keeps the lit set: the renderers read it for the card they draw', async () => {
  const s = await open();
  s.over(1);
  s.page.run('renderBoard()');
  assert.deepStrictEqual(s.plain('[...hoverLit].sort()'), ['1', '2', '3', '7'], 'the archived card 7 is in the set, though no tile of it is drawn');
  assert.strictEqual(s.page.run("isHoverHighlighted(hoverLit, '2')"), true);
  assert.strictEqual(s.page.run("isHoverHighlighted(hoverLit, '4')"), false);
});

// --- the Graph --------------------------------------------------------------------------------------------------------

test('in the Hierarchy a hovered dot lights what it lit before the choice existed: itself and its one-hop relations', async () => {
  const s = await open({ view: 'graph' });
  s.fakeGraph();
  assert.deepStrictEqual(s.focusDot(1), [1, 2, 3]);
  assert.deepStrictEqual(s.focusDot(2), [1, 2, 5]);
  assert.deepStrictEqual(s.focusDot(4), [4]);
});

test('in the Flow a hovered dot lights itself, the cards its dependencies join to it, and its parent and children, as the Hierarchy default does', async () => {
  const s = await open({ view: 'graph', stored: { 'kanban.kanban.graph.layout': 'flow' } });
  s.fakeGraph();
  assert.deepStrictEqual(s.focusDot(1), [1, 2, 3]);
  assert.deepStrictEqual(s.focusDot(3), [1, 3], 'its parent');
});

test('the Graph lights the union of the sets ticked, cut by the sides, and the Hierarchy and the Flow light the same', async () => {
  const stored = { [KEY]: JSON.stringify({ kinds: ['dpath', 'hlinks'], hierarchy: 'above&below', dependencies: 'before&after' }) };
  for (const layout of ['hierarchy', 'flow']) {
    const s = await open({ view: 'graph', stored: { ...stored, 'kanban.kanban.graph.layout': layout } });
    s.fakeGraph();
    assert.deepStrictEqual(s.focusDot(2), [1, 2, 5], `${layout}: dpath through card 2, both ways, and hlinks beside it`);
    assert.deepStrictEqual(s.focusDot(3), [1, 3], `${layout}: dpath is itself, hlinks adds the parent`);
  }
  const cut = await open({ view: 'graph', stored: { [KEY]: JSON.stringify({ kinds: ['dpath'], hierarchy: 'above&below', dependencies: 'after' }) } });
  cut.fakeGraph();
  assert.deepStrictEqual(cut.focusDot(2), [2, 5], 'after: what waits on card 2');
});

test('the hover ring stays on the hovered dot alone: in the Graph the tiles that take the look are that card', async () => {
  const s = await open({ view: 'graph' });
  s.fakeGraph();
  s.over(1);
  assert.deepStrictEqual(s.plain('[...hoverLit]'), ['1']);
  assert.deepStrictEqual(s.lit(), [1]);
});

test('with nothing ticked a hover lights nothing in the Graph and the lighting of the selection stays', async () => {
  const s = await open({ view: 'graph', stored: { [KEY]: JSON.stringify({ hierarchy: [], flow: [] }) } });
  s.fakeGraph();
  assert.strictEqual(s.focusDot(1), null, 'nothing is selected, so nothing is lit');
  s.page.run('setSelection(addPart(NO_SELECTION, cardPart(4)), 4)');
  assert.deepStrictEqual(s.focusDot(1), [4], 'the selection stays lit while the pointer is on a dot');
});

test('a card the Graph does not draw lights nothing', async () => {
  const s = await open({ view: 'graph' });
  s.fakeGraph();
  assert.strictEqual(s.focusDot(7), undefined, 'the focus is cleared and no lighting is made');
});

// --- the panel and the storage ----------------------------------------------------------------------------------------

test('the boxes show the defaults, dlinks and hlinks, and both toggles read their & state', async () => {
  const s = await open();
  s.sync();
  assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks']);
  assert.deepStrictEqual(s.sides(), ['above&below', 'before&after']);
  assert.deepStrictEqual(s.sideBtns.map((b) => b.attrs['aria-label']), ['Hierarchy: above&below', 'Dependencies: before&after'], 'announced with their state');
});

test('in the Graph\'s Flow the panel shows the same choice as everywhere', async () => {
  const s = await open({ view: 'graph', stored: { 'kanban.kanban.graph.layout': 'flow' } });
  s.sync();
  assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks']);
});

test('a click on a toggle steps it above&below, above, below and round, keeps the record, and the other toggle stays', async () => {
  const s = await open();
  s.step('hierarchy');
  assert.deepStrictEqual(s.sides(), ['above', 'before&after']);
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { kinds: ['dlinks', 'hlinks'], hierarchy: 'above', dependencies: 'before&after' });
  s.step('hierarchy');
  assert.deepStrictEqual(s.sides(), ['below', 'before&after']);
  s.step('hierarchy');
  assert.deepStrictEqual(s.sides(), ['above&below', 'before&after']);
  s.step('dependencies');
  s.step('dependencies');
  assert.deepStrictEqual(s.sides(), ['above&below', 'after']);
  assert.strictEqual(JSON.parse(s.stored[KEY]).dependencies, 'after');
});

test('a click on a toggle while a card is hovered lights the cut set at once', async () => {
  const s = await open();
  s.over(1);
  assert.deepStrictEqual(s.lit(), [1, 2, 3]);
  s.step('hierarchy');
  s.step('hierarchy');
  assert.deepStrictEqual(s.sides()[0], 'below');
  assert.deepStrictEqual(s.lit(), [1, 2, 3], 'below the parent: the child, and the wait');
  s.step('dependencies');
  assert.deepStrictEqual(s.sides()[1], 'before');
  assert.deepStrictEqual(s.lit(), [1, 3], 'before: card 1 waits for nothing, so card 2 goes');
});

test('a tick is kept for the board under hover.show as one record', async () => {
  const s = await open();
  s.tick('dtree', true);
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { kinds: ['dtree', 'dlinks', 'hlinks'], hierarchy: 'above&below', dependencies: 'before&after' });
  s.tick('dlinks', false);
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]).kinds, ['dtree', 'hlinks']);
});

test('a reload reads the kept choice, the old record as its Hierarchy list, and a corrupt or unreadable one as the defaults', async () => {
  const kept = await open({ stored: { [KEY]: JSON.stringify({ kinds: ['hpath'], hierarchy: 'below', dependencies: 'after' }) } });
  kept.sync();
  assert.deepStrictEqual(kept.ticked(), ['hpath']);
  assert.deepStrictEqual(kept.sides(), ['below', 'after']);
  const old = await open({ stored: { [KEY]: JSON.stringify({ hierarchy: ['hpath'], flow: [] }) } });
  old.sync();
  assert.deepStrictEqual(old.ticked(), ['hpath']);
  assert.deepStrictEqual(old.sides(), ['above&below', 'before&after']);
  for (const bad of ['not json', '[]', '{"hierarchy": "dtree"}', 'null']) {
    const s = await open({ stored: { [KEY]: bad } });
    s.sync();
    assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks'], bad);
    assert.deepStrictEqual(s.sides(), ['above&below', 'before&after'], bad);
  }
});

test('the choice of one board is not another board\'s: a rename of the board reads the new board\'s key', async () => {
  const s = await open({ stored: { [KEY]: JSON.stringify({ kinds: ['hpath'] }), 'kanban.other.hover.show': JSON.stringify({ kinds: ['dtree'] }) } });
  s.sync();
  assert.deepStrictEqual(s.ticked(), ['hpath']);
  s.page.run("applyProjectName('other')");
  s.sync();
  assert.deepStrictEqual(s.ticked(), ['dtree']);
});
