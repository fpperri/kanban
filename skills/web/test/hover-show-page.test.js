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
  const host = control();
  host.querySelectorAll = () => boxes;
  elements['#search-hover'] = host;
  const note = { textContent: '' };
  elements['#search-hover-for'] = note;
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
    page, boxes, host, note, tiles, calls, stored: store,
    over(id) { page.fireDocument('mouseover', { target: { closest: (sel) => (sel === '.card-el' ? tile(id) : null) } }); },
    out(id) { page.fireDocument('mouseout', { target: { closest: (sel) => (sel === '.card-el' ? tile(id) : null) }, relatedTarget: null }); },
    lit: () => tiles.filter((t) => t.names.has('hover-highlight')).map((t) => Number(t.dataset.id)),
    ticked: () => boxes.filter((b) => b.checked).map((b) => b.dataset.hoverKind),
    tick(kind, on) {
      const box = boxes.find((b) => b.dataset.hoverKind === kind);
      box.checked = on;
      host.fire('change', { target: { closest: (sel) => (sel === '[data-hover-kind]' ? box : null) } });
    },
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

test('the Hierarchy\'s choice is the one the Board reads, even when the Graph last showed the Flow', async () => {
  const s = await open({ stored: { 'kanban.kanban.graph.layout': 'flow', [KEY]: JSON.stringify({ hierarchy: ['hlinks'], flow: ['dtree'] }) } });
  s.over(1);
  assert.deepStrictEqual(s.lit(), [1, 3], 'hlinks alone');
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

test('the Graph lights the union of the sets ticked for its kind: the Flow\'s choice and the Hierarchy\'s are two', async () => {
  const stored = { [KEY]: JSON.stringify({ hierarchy: ['hlinks'], flow: ['dpath', 'hlinks'] }) };
  const hierarchy = await open({ view: 'graph', stored: { ...stored } });
  hierarchy.fakeGraph();
  assert.deepStrictEqual(hierarchy.focusDot(1), [1, 3], 'hlinks alone');
  const flow = await open({ view: 'graph', stored: { ...stored, 'kanban.kanban.graph.layout': 'flow' } });
  flow.fakeGraph();
  assert.deepStrictEqual(flow.focusDot(2), [1, 2, 5], 'dpath through card 2, both ways, and hlinks beside it');
  assert.deepStrictEqual(flow.focusDot(3), [1, 3], 'dpath is itself, hlinks adds the parent');
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

test('the boxes show the Hierarchy\'s defaults, and the note says it is the Hierarchy\'s and the other views\'', async () => {
  const s = await open();
  s.sync();
  assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks']);
  assert.strictEqual(s.note.textContent, 'Hierarchy and the other views');
});

test('in the Graph\'s Flow the boxes show the Flow\'s defaults and the note says Flow', async () => {
  const s = await open({ view: 'graph', stored: { 'kanban.kanban.graph.layout': 'flow' } });
  s.sync();
  assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks']);
  assert.strictEqual(s.note.textContent, 'Flow');
});

test('a tick is kept for the board under hover.show, for the kind of Graph that is on, and the other kind is left alone', async () => {
  const s = await open();
  s.tick('dtree', true);
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { hierarchy: ['dtree', 'dlinks', 'hlinks'], flow: ['dlinks', 'hlinks'] });
  s.tick('dlinks', false);
  assert.deepStrictEqual(JSON.parse(s.stored[KEY]), { hierarchy: ['dtree', 'hlinks'], flow: ['dlinks', 'hlinks'] });
  const flow = await open({ view: 'graph', stored: { 'kanban.kanban.graph.layout': 'flow' } });
  flow.tick('hlinks', false);
  assert.deepStrictEqual(JSON.parse(flow.stored[KEY]), { hierarchy: ['dlinks', 'hlinks'], flow: ['dlinks'] });
});

test('a reload reads the kept choice, and a corrupt or unreadable one reads as the defaults', async () => {
  const kept = await open({ stored: { [KEY]: JSON.stringify({ hierarchy: ['hpath'], flow: [] }) } });
  kept.sync();
  assert.deepStrictEqual(kept.ticked(), ['hpath']);
  for (const bad of ['not json', '[]', '{"hierarchy": "dtree"}', 'null']) {
    const s = await open({ stored: { [KEY]: bad } });
    s.sync();
    assert.deepStrictEqual(s.ticked(), ['dlinks', 'hlinks'], bad);
  }
});

test('the choice of one board is not another board\'s: a rename of the board reads the new board\'s key', async () => {
  const s = await open({ stored: { [KEY]: JSON.stringify({ hierarchy: ['hpath'], flow: [] }), 'kanban.other.hover.show': JSON.stringify({ hierarchy: ['dtree'], flow: [] }) } });
  s.sync();
  assert.deepStrictEqual(s.ticked(), ['hpath']);
  s.page.run("applyProjectName('other')");
  s.sync();
  assert.deepStrictEqual(s.ticked(), ['dtree']);
});
