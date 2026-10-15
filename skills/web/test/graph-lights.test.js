const { test } = require('node:test');
const assert = require('node:assert');
const {
  graphBuild, graphNeighbours, graphVisibleIds, graphLayout, graphSignature, graphLayoutCacheClear,
  graphQueryEffect, graphLit, graphRestLit,
} = require('../web/graph-model');
const { parseSearchQuery, filterCards } = require('../web/search');

// What the Graph lights. A query typed in the Graph hides nothing: it is the
// anchor of the selection, and its matches light while the rest dims. One pure
// decision says which cards a Graph query hides and which it lights, one lighting
// drives the dimming whether it comes from the pointer, a lone card or a
// selection, and the layout never hears of the query.

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const STATUSES = ['backlog', 'todo', 'doing', 'done'];
const FILTER = { backlog: true, todo: true, doing: true, done: true, archive: false };
const card = (id, extra = {}) => ({
  id, title: `card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], archived: false, parent: null, waiting_for: [], blocked: false, review: false, ...extra,
});

// 1 is a parent of 2 and 3, 3 waits for 2, 4 waits for 1; 5 is done and so is 6, which is archived.
const POOL = [
  card(1, { title: 'Zephyr migration', status: 'doing' }),
  card(2, { title: 'Move the data layer', parent: 1 }),
  card(3, { title: 'Zephyr cutover plan', parent: 1, waiting_for: [2] }),
  card(4, { title: 'Retire the scheduler', waiting_for: [1] }),
  card(5, { title: 'Zephyr release notes', status: 'done' }),
  card(6, { title: 'Zephyr spike', status: 'done', archived: true }),
  card(7, { title: 'Book the venue' }),
];

// What the page's shared match holds for the box: the parse, and the ids it
// matches over the whole board, or null for no query.
const matchOf = (query) => {
  const terms = parseSearchQuery(query, 'kanban');
  return { terms, ids: terms.length ? new Set(filterCards(POOL, terms, CTX).map((c) => c.id)) : null };
};
const drawn = (match) => graphVisibleIds(POOL, graphQueryEffect(match).visibleIds, FILTER, STATUSES);
const sorted = (set) => [...set].sort((a, b) => a - b);

// --- the decision ---------------------------------------------------------------------

test('a typed query with no slice term keeps every card visible and lights exactly its matches, a done card included', () => {
  const match = matchOf('zephyr');
  const effect = graphQueryEffect(match);
  assert.strictEqual(effect.visibleIds, null, 'nothing is hidden by the query');
  assert.deepStrictEqual(sorted(effect.litIds), [1, 3, 5, 6], 'the done card 5 and the archived done card 6 match like any other');
  assert.deepStrictEqual(sorted(effect.litIds), sorted(match.ids), 'exactly the matches, no more and no fewer');
});

test('the cards the Graph draws are the same with and without a query', () => {
  const without = [...graphVisibleIds(POOL, null, FILTER, STATUSES)].sort((a, b) => a - b);
  for (const query of ['zephyr', 'status:done', 'zephyr | venue', 'nothing-matches-this', 'blocked:']) {
    assert.deepStrictEqual(sorted(drawn(matchOf(query))), without, query);
  }
  assert.deepStrictEqual(without, [1, 2, 3, 4, 5, 7], 'the archived card is out until the Archive pill is on');
});

test('no query hides nothing and lights nothing: the empty box and a term not finished yet', () => {
  for (const query of ['', '   ', 'status:']) {
    assert.deepStrictEqual(graphQueryEffect(matchOf(query)), { visibleIds: null, litIds: null }, JSON.stringify(query));
  }
  assert.deepStrictEqual(graphQueryEffect(null), { visibleIds: null, litIds: null });
});

test('a query that matches nothing lights nothing and still hides nothing', () => {
  const effect = graphQueryEffect(matchOf('nothing-matches-this'));
  assert.strictEqual(effect.visibleIds, null);
  assert.deepStrictEqual([...effect.litIds], []);
});

test('the decision hands back what the search module matched, without changing it', () => {
  const match = matchOf('zephyr');
  const before = sorted(match.ids);
  const effect = graphQueryEffect(match);
  assert.deepStrictEqual(sorted(match.ids), before);
  assert.deepStrictEqual(sorted(effect.litIds), before);
});

// --- typing does not run the layout again ---------------------------------------------

test('the layout\'s input and its cache key are the same with and without a typed query, so typing does not run the layout again', () => {
  graphLayoutCacheClear();
  const build = (match) => graphBuild(POOL, { ctx: CTX, visibleIds: drawn(match) });
  const without = build(matchOf(''));
  const opts = { statuses: STATUSES };
  const layout = graphLayout(without, 'tiers', opts);
  for (const query of ['zephyr', 'status:done', 'zephyr | venue', 'nothing-matches-this']) {
    const typed = build(matchOf(query));
    assert.deepStrictEqual(typed.nodes.map((n) => n.id), without.nodes.map((n) => n.id), `${query}: the same cards`);
    assert.deepStrictEqual(typed.links, without.links, `${query}: the same relations`);
    assert.strictEqual(graphSignature(typed, 'tiers', opts), graphSignature(without, 'tiers', opts), `${query}: the same cache key`);
    assert.strictEqual(graphLayout(typed, 'tiers', opts), layout, `${query}: the layout is the one already made`);
  }
});

test('the check is a real one: hiding the non-matches, as the Graph did before, gives another cache key', () => {
  const match = matchOf('zephyr');
  const hidden = graphBuild(POOL, { ctx: CTX, visibleIds: graphVisibleIds(POOL, match.ids, FILTER, STATUSES) });
  const kept = graphBuild(POOL, { ctx: CTX, visibleIds: drawn(match) });
  assert.notStrictEqual(graphSignature(hidden, 'tiers', { statuses: STATUSES }), graphSignature(kept, 'tiers', { statuses: STATUSES }));
});

// --- a lighting -----------------------------------------------------------------------

const model = () => graphBuild(POOL, { ctx: CTX, visibleIds: drawn(matchOf('')) });

test('a lighting is the cards asked for that the Graph draws, and the relations that run between two of them', () => {
  const m = model();
  const lit = graphLit(m, new Set([1, 3, 5, 6, 99]));
  assert.deepStrictEqual(sorted(lit.nodes), [1, 3, 5], 'card 6 is archived and not drawn, card 99 is not on the board');
  assert.deepStrictEqual([...lit.links].map((i) => `${m.links[i].from}>${m.links[i].to}`), ['1>3']);
});

test('a lighting of nothing is none at all, so nothing dims', () => {
  const m = model();
  assert.strictEqual(graphLit(m, new Set()), null);
  assert.strictEqual(graphLit(m, new Set([99])), null);
  assert.strictEqual(graphLit(m, null), null);
});

test('hovering a card lights it with its one-hop relations and the lines among them, as it does on main', () => {
  const m = model();
  const lit = graphLit(m, graphNeighbours(m, 1));
  assert.deepStrictEqual(sorted(lit.nodes), [1, 2, 3, 4]);
  assert.deepStrictEqual([...lit.links].map((i) => `${m.links[i].from}>${m.links[i].to}`).sort(), ['1>2', '1>3', '1>4', '2>3']);
});

// --- what rests lit -------------------------------------------------------------------

test('a lone card picked by a click lights with its one-hop relations (R2)', () => {
  const m = model();
  const lit = graphRestLit(m, { selectedIds: new Set([1]), loneCardId: 1 });
  assert.deepStrictEqual(sorted(lit.nodes), [1, 2, 3, 4]);
  assert.deepStrictEqual(sorted(graphRestLit(m, { selectedIds: new Set([7]), loneCardId: 7 }).nodes), [7], 'a card with no relations lights alone');
});

test('a query that matches one card lights that card alone, without its relations', () => {
  const m = model();
  const lit = graphRestLit(m, { selectedIds: new Set([1]), loneCardId: null });
  assert.deepStrictEqual(sorted(lit.nodes), [1]);
  assert.strictEqual(lit.links.size, 0);
});

test('a selection of several cards lights exactly those cards and the lines between them, not their relations', () => {
  const m = model();
  const lit = graphRestLit(m, { selectedIds: new Set([1, 3, 7]), loneCardId: null });
  assert.deepStrictEqual(sorted(lit.nodes), [1, 3, 7]);
  assert.deepStrictEqual([...lit.links].map((i) => `${m.links[i].from}>${m.links[i].to}`), ['1>3']);
});

test('a typed query\'s matches light, a done card included, and nothing else does', () => {
  const m = model();
  const match = matchOf('zephyr');
  const lit = graphRestLit(m, { selectedIds: graphQueryEffect(match).litIds, loneCardId: null });
  assert.deepStrictEqual(sorted(lit.nodes), [1, 3, 5]);
});

test('with nothing selected nothing rests lit', () => {
  const m = model();
  assert.strictEqual(graphRestLit(m, { selectedIds: new Set(), loneCardId: null }), null);
});

test('a lone card the Graph does not draw lights nothing', () => {
  const m = model();
  assert.strictEqual(graphRestLit(m, { selectedIds: new Set([6]), loneCardId: 6 }), null);
});
