const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cs = require('../scripts/card-store');
const cfg = require('../scripts/config-store');
const ids = require('../web/ids');
const nesting = require('../web/nesting');
const { parseSearchQuery, filterCards } = require('../web/search');
const { buildDependencyGraph, treeIds, pathIds } = require('../web/dependency-graph');
const { sortCards } = require('../web/column-sort');
const { graphBuild } = require('../web/graph-model');
const { unresolvedWaits } = require('../web/waiting-blocked');
const { materialize } = require('./browser/boards');
const scenario = require('./browser/scenarios/ids');

// The ids board of the browser runner holds the four kinds of id side by side: plain cards
// (3, 7, 9, 10), goals (G3, G4, G10; G2 archived), a two-letter prefix (DW845) and the loose
// prefix (_12). Card 3 and goal G3 share a number, and 7, G10 and _12 sit under G3. Every
// reader that turns an id into a number drops or scrambles one of these silently, so each
// reader of the web is held to the board here: the store, the search, the nesting, the
// dependency graph, the Graph's model, the column sort and the waiting rule.

const roots = [];
const load = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ids-board-'));
  roots.push(root);
  const dir = materialize('ids', path.join(root, 'board'));
  const config = cfg.readConfig(dir);
  const live = cs.listActive(dir).map(cs.toJSON);
  const archived = cs.listArchived(dir).map(cs.toJSON);
  return { dir, config, live, archived, all: live.concat(archived), ctx: { board: config.name, hierarchy: config.hierarchy, priorities: config.priorities } };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const idsOf = (cards) => cards.map((c) => c.id);
const LIVE = scenario.CASES.live;

test('every card of the board parses, under the whole id its id line holds, and the archived goal is found too', () => {
  const b = load();
  assert.ok(cs.listActive(b.dir).concat(cs.listArchived(b.dir)).every((c) => !c.unparseable));
  assert.deepStrictEqual(ids.sortIds(idsOf(b.live)), LIVE);
  assert.deepStrictEqual(idsOf(b.archived), ['G2']);
  assert.deepStrictEqual(b.live.map((c) => c.file).sort(), [
    '0003.plain-three.card.md', '0007.plain-seven.card.md', '0009.plain-nine.card.md', '0010.plain-ten.card.md',
    'DW0845.deep-work.card.md', 'G0003.goal-three.card.md', 'G0004.goal-four.card.md', 'G0010.goal-ten.card.md', '_0012.loose-twelve.card.md',
  ]);
});

test('the board config declares the prefixes, the counters past the last id of each, and the width of the file names', () => {
  const b = load();
  assert.deepStrictEqual(b.config.prefixes, { G: 'goal', DW: 'deep-work' });
  assert.strictEqual(b.config.idDigits, 4);
  assert.deepStrictEqual(b.config.counters, { G: 11, DW: 846 });
  assert.strictEqual(b.config.nextId, 13);
  const number = (id) => ids.parseId(id).number;
  const highest = (prefix) => Math.max(...b.all.filter((c) => ids.parseId(c.id).prefix === prefix).map((c) => number(c.id)));
  assert.strictEqual(b.config.counters.G, highest('G') + 1);
  assert.strictEqual(b.config.counters.DW, highest('DW') + 1);
  assert.strictEqual(b.config.nextId, highest('') + 3, 'the plain counter is past the highest plain id');
});

test('parents and dependencies are whole ids: card 3 and goal G3 are two cards with their own links', () => {
  const b = load();
  const by = new Map(b.live.map((c) => [c.id, c]));
  assert.deepStrictEqual(['7', 'G10', '_12'].map((id) => by.get(id).parent), ['G3', 'G3', 'G3']);
  assert.deepStrictEqual(by.get('G4').waiting_for, ['G3']);
  assert.deepStrictEqual(by.get('DW845').waiting_for, ['G3', '3']);
  assert.strictEqual(by.get('3').parent, null);
});

test('searching a whole id finds that card and no other: #3 is not #G3, a mention and id: do the same', () => {
  const b = load();
  for (const { query, shows } of scenario.CASES.search) {
    const found = filterCards(b.all, parseSearchQuery(query, b.config.name), b.ctx).filter((c) => !c.archived);
    assert.deepStrictEqual(ids.sortIds(idsOf(found)), shows, query);
  }
  const archivedGoal = filterCards(b.all, parseSearchQuery('#G2', b.config.name), b.ctx);
  assert.deepStrictEqual(idsOf(archivedGoal), ['G2'], 'the archived goal is searchable too');
  assert.deepStrictEqual(idsOf(filterCards(b.all, parseSearchQuery('#a371f7', b.config.name), b.ctx)), ['G3'], '#a371f7 is a colour, not an id: it is text, found only where a body holds it');
});

test('the outline puts the High goal G3 first, nests its children by rank, then reads the other roots plain ids first', () => {
  const b = load();
  const outline = nesting.outlineOrder(b.live, b.ctx).ids;
  assert.deepStrictEqual(outline, ['G3', '7', 'G10', '_12', '3', '9', '10', 'DW845', 'G4']);
  assert.deepStrictEqual(nesting.childrenOf(b.live, 'G3', b.ctx).map((c) => c.id), scenario.CASES.children);
  assert.deepStrictEqual(nesting.childrenOf(b.live, '3', b.ctx), [], 'card 3 has no children: they are G3\'s');
  assert.strictEqual(nesting.depthMap(b.live, b.ctx).get('G10'), 1);
  assert.strictEqual(nesting.depthMap(b.live, b.ctx).get('3'), 0);
});

test('the reorder plan moves _12 between 7 and G10 under G3 without touching a card of the plain 3', () => {
  const b = load();
  const plan = nesting.reorderPlan(b.live, '_12', { prev: '7', next: 'G10' }, b.ctx);
  assert.deepStrictEqual(plan, { rank: 15, renumber: [] });
  assert.deepStrictEqual(nesting.reorderPlan(b.live, '7', { prev: '3', next: null }, b.ctx).error, 'card 3 is not among the siblings of card 7', 'card 3 lies after the children of G3, so it cannot be the tile above the drop');
  assert.deepStrictEqual(nesting.reorderPlan(b.live, '7', { prev: '_12', next: '3' }, b.ctx), { rank: 40, renumber: [] }, 'but as the tile below it only marks the end of the stretch');
});

test('a waiting_for entry names its card by the whole id: DW845 waits for G3 and 3, G4 for G3 alone', () => {
  const b = load();
  const byId = new Map(b.all.map((c) => [c.id, c]));
  const waits = (id) => idsOf(unresolvedWaits(byId.get(id).waiting_for, byId));
  assert.deepStrictEqual(waits('DW845'), ['G3', '3']);
  assert.deepStrictEqual(waits('G4'), ['G3']);
  byId.set('G3', { ...byId.get('G3'), status: 'done' });
  assert.deepStrictEqual(waits('DW845'), ['3'], 'finishing G3 leaves the plain card 3');
  assert.deepStrictEqual(waits('G4'), []);
});

test('the dependency graph draws the edges between whole ids, and the path of G4 does not run through card 3', () => {
  const b = load();
  const graph = buildDependencyGraph(b.live, null, b.ctx);
  const edges = graph.edges.filter((e) => e.kind === 'dep').map((e) => `${e.from}>${e.to}`).sort();
  assert.deepStrictEqual(edges, ['3>DW845', 'G3>DW845', 'G3>G4']);
  assert.deepStrictEqual([...treeIds(b.live, 'G3', b.ctx)].sort(), ['3', '7', 'DW845', 'G10', 'G3', 'G4', '_12'], 'card 3 comes in through DW845, which waits for both');
  assert.deepStrictEqual([...pathIds(b.live, 'G4', b.ctx)].sort(), ['7', 'G10', 'G3', 'G4', '_12'], 'but the path of G4 runs through G3 and its children, and card 3 is not on it');
  assert.deepStrictEqual([...pathIds(b.live, '3', b.ctx)].sort(), ['3', 'DW845'], 'the path of card 3 does not reach the goal G3 that shares its number');
  assert.deepStrictEqual([...pathIds(b.live, 'DW845', b.ctx)].sort(), ['3', '7', 'DW845', 'G10', 'G3', '_12']);
});

test('the Graph model has a node per card, G3 its three children, and card 3 none', () => {
  const b = load();
  const model = graphBuild(b.live, { ctx: b.ctx });
  assert.deepStrictEqual(ids.sortIds(model.nodes.map((n) => n.id)), LIVE);
  assert.strictEqual(model.byId.get('G3').kids, 3);
  assert.strictEqual(model.byId.get('3').kids, 0);
  assert.deepStrictEqual(['7', 'G10', '_12'].map((id) => model.byId.get(id).parentId), ['G3', 'G3', 'G3']);
});

test('a column sorted by id reads plain numbers first, then each prefix by its number', () => {
  const b = load();
  const todo = b.live.filter((c) => c.status === 'todo');
  assert.deepStrictEqual(idsOf(sortCards(todo, { field: 'id', direction: 'asc' }, [], [])), scenario.CASES.todoById);
  assert.deepStrictEqual(idsOf(sortCards(b.live, { field: 'id', direction: 'asc' }, [], [])), LIVE);
});

test('the columns of the scenario are what the default sort lays out on a nested board: the outline, so the children of G3 come first', () => {
  const b = load();
  const { columns } = scenario.CASES;
  for (const [status, expected] of Object.entries(columns)) {
    const cards = b.live.filter((c) => c.status === status);
    const outline = nesting.outlineOrder(b.live, b.ctx).index;
    const sorted = sortCards(cards, { field: 'outline', direction: 'asc' }, b.config.priorities, [], outline);
    assert.deepStrictEqual(idsOf(sorted), expected, status);
  }
});
