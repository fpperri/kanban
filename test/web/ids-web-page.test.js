const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');
const { parseSearchQuery, filterCards, searchIsolateText } = require('../../plugin/skills/web/web/search');
const { cardPart, pathPart, treePart } = require('../../plugin/skills/web/web/selection');
const { buildDependencyGraph, treeIds, pathIds } = require('../../plugin/skills/web/web/dependency-graph');
const { sortCards } = require('../../plugin/skills/web/web/column-sort');
const { graphBuild } = require('../../plugin/skills/web/web/graph-model');
const { unresolvedWaits } = require('../../plugin/skills/web/web/waiting-blocked');

// A board holding #7 and #G7: two cards, not one. The server may still send a plain id as a
// number, so the board here does (7), and the group card as its string (G7). Selecting,
// isolating, opening, searching `#G7` and following a dependency treat them as two cards, and
// a list sorts plain ids first and #9 before #10 (ADR 0014).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const wireBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(7),
    card('G7', { title: 'The group' }),
    card(8, { waiting_for: ['G7'] }),
    card(9, { waiting_for: [7] }),
    card(10),
    card('G10', { parent: 'G7' }),
    card('G9', { parent: '7' }),
  ],
  archived: [],
});

async function open({ view = 'board', prefs = null } = {}) {
  const stored = { 'kanban.kanban.view.mode': view };
  if (prefs) stored['kanban.kanban.prefs'] = JSON.stringify(prefs);
  const page = await loadPage({ board: wireBoard(), stored, elements: { '#graph-view': control() } }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const opened = [];
  page.ctx.openCard = (id) => { opened.push(id); };
  return { page, opened, ids: () => [...page.run('selectedIds')].sort(), selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))) };
}

function cardTarget(id) {
  const el = { dataset: { id: String(id) } };
  const inCard = (sel) => sel.split(',').some((part) => part.trim() === '.card-el');
  return new Proxy({}, { get: (t, key) => (key === 'closest' ? (sel) => (inCard(sel) ? el : null) : harmless(String(key))) });
}
const click = (s, id, extra = {}) => s.page.fireDocument('click', { target: cardTarget(id), detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });

const SELECTS = { click: { board: 'selects', map: 'selects', gantt: 'selects', calendar: 'selects' } };

test('the page holds every card on its whole id, whether the server sent it as a number or a string', async () => {
  const s = await open();
  const read = (code) => JSON.parse(JSON.stringify(s.page.run(code)));
  assert.deepStrictEqual(read('state.active.map((c) => c.id)'), ['7', 'G7', '8', '9', '10', 'G10', 'G9']);
  assert.deepStrictEqual(read('state.active.find((c) => c.id === "8").waiting_for'), ['G7']);
  assert.deepStrictEqual(read('state.active.find((c) => c.id === "9").waiting_for'), ['7']);
});

test('selecting #G7 selects that card alone, and #7 beside it is another card', async () => {
  const s = await open({ prefs: SELECTS });
  click(s, 'G7');
  assert.deepStrictEqual(s.ids(), ['G7']);
  assert.deepStrictEqual(s.selection(), { anchor: { kind: 'card', id: 'G7' }, additions: [] });
  click(s, '7', { ctrlKey: true });
  assert.deepStrictEqual(s.ids(), ['7', 'G7']);
  click(s, 'G7', { ctrlKey: true });
  assert.deepStrictEqual(s.ids(), ['7'], 'taking #G7 out leaves #7');
});

test('opening #G7 opens that card, and #7 opens its own', async () => {
  const s = await open();
  click(s, 'G7');
  click(s, '7');
  assert.deepStrictEqual(s.opened, ['G7', '7']);
});

test('isolating the selection writes each card by its whole id', () => {
  assert.strictEqual(searchIsolateText([cardPart('G7')]), '#G7');
  assert.strictEqual(searchIsolateText([cardPart(7), cardPart('G7')]), '#7 | #G7');
  assert.strictEqual(searchIsolateText([pathPart('G7'), treePart('G7')]), 'path:G7 | tree:G7');
});

const pool = () => wireBoard().active.map((c) => ({ ...c, id: String(c.id), waiting_for: c.waiting_for.map(String), parent: c.parent === null ? null : String(c.parent) }));
const idsOf = (cards) => cards.map((c) => c.id);

test('searching #G7 finds that card and not #7, and #7 finds only #7', () => {
  const cards = pool();
  assert.deepStrictEqual(idsOf(filterCards(cards, parseSearchQuery('#G7', 'kanban'), { board: 'kanban' })), ['G7']);
  assert.deepStrictEqual(idsOf(filterCards(cards, parseSearchQuery('#7', 'kanban'), { board: 'kanban' })), ['7']);
  assert.deepStrictEqual(idsOf(filterCards(cards, parseSearchQuery('kanban#G7', 'kanban'), { board: 'kanban' })), ['G7']);
  assert.deepStrictEqual(idsOf(filterCards(cards, parseSearchQuery('id:G7', 'kanban'), { board: 'kanban' })), ['G7']);
  assert.deepStrictEqual(idsOf(filterCards(cards, parseSearchQuery('#G7 | #7', 'kanban'), { board: 'kanban' })), ['7', 'G7']);
});

test('a dependency on #G7 is a dependency on #G7 alone: card 8 waits for it, card 9 waits for #7', () => {
  const cards = pool();
  const graph = buildDependencyGraph(cards, null, { board: 'kanban' });
  const edges = graph.edges.filter((e) => e.kind === 'dep').map((e) => `${e.from}>${e.to}`).sort();
  assert.deepStrictEqual(edges, ['7>9', 'G7>8']);
  assert.deepStrictEqual([...treeIds(cards, 'G7', { board: 'kanban' })].sort(), ['8', 'G10', 'G7']);
  assert.ok(!treeIds(cards, '7', { board: 'kanban' }).has('8'), 'the tree of #7 does not reach #8');
  assert.deepStrictEqual([...pathIds(cards, 'G7', { board: 'kanban' })].sort(), ['8', 'G10', 'G7']);
  const byId = new Map(cards.map((c) => [c.id, c]));
  assert.deepStrictEqual(unresolvedWaits(cards.find((c) => c.id === '8').waiting_for, byId).map((c) => c.id), ['G7']);
  assert.ok(graph.nodes.find((n) => n.id === '8').waiting);
  assert.ok(graph.nodes.find((n) => n.id === '9').waiting);
  const g7 = { ...cards.find((c) => c.id === 'G7'), status: 'done' };
  const done = buildDependencyGraph(cards.map((c) => (c.id === 'G7' ? g7 : c)), null, { board: 'kanban' });
  assert.ok(!done.nodes.find((n) => n.id === '8').waiting, 'finishing #G7 frees #8');
  assert.ok(done.nodes.find((n) => n.id === '9').waiting, 'and leaves #9 waiting for #7');
});

test('the Graph draws #7 and #G7 as two nodes, each with its own children', () => {
  const model = graphBuild(wireBoard().active, { ctx: { board: 'kanban', priorities: ['High', 'Normal', 'Low'] } });
  assert.deepStrictEqual(model.nodes.map((n) => n.id).sort(), ['10', '7', '8', '9', 'G10', 'G7', 'G9']);
  assert.strictEqual(model.byId.get('G10').parentId, 'G7');
  assert.strictEqual(model.byId.get('G9').parentId, '7');
  assert.strictEqual(model.byId.get('G7').kids, 1);
  assert.strictEqual(model.byId.get('7').kids, 1);
});

test('a list sorts plain ids first, then by prefix, and #9 before #10', () => {
  const cards = pool();
  const byId = { field: 'id', direction: 'asc' };
  assert.deepStrictEqual(idsOf(sortCards(cards, byId, [], [])), ['7', '8', '9', '10', 'G7', 'G9', 'G10']);
  assert.deepStrictEqual(idsOf(sortCards(cards, { field: 'id', direction: 'desc' }, [], [])), ['G10', 'G9', 'G7', '10', '9', '8', '7']);
});

test('bars and lanes that tie sort plain ids first, and #9 before #10', () => {
  const { ganttGroups } = require('../../plugin/skills/web/web/gantt-model');
  const { assignLanes } = require('../../plugin/skills/web/web/calendar-model');
  const dated = ['G10', '10', 'G7', '9', '7'].map((id) => ({ id, status: 'todo', title: `c${id}`, due_date: '2026-07-09', start_date: '2026-07-03', end_date: '2026-07-06' }));
  assert.deepStrictEqual(ganttGroups(dated)[0].bars.map((b) => b.card.id), ['7', '9', '10', 'G7', 'G10']);
  const blocks = ['G7', '10', '7', '9'].map((id) => ({ card: { id }, startMin: 540, endMin: 600 }));
  assert.deepStrictEqual(assignLanes(blocks).map((b) => b.card.id), ['7', '9', '10', 'G7']);
});
