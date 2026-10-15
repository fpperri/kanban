const { test } = require('node:test');
const assert = require('node:assert');
const { graphQueryEffect, graphVisibleIds } = require('../web/graph-model');
const { parseSearchQuery, filterCards, searchIsolateText } = require('../web/search');

// While isolated the Graph hides what the box does not match, where a typed query only lights
// its matches. That is the one change to the Graph's pure hide-or-light decision
// (graphQueryEffect); the renderer, the layout and the lighting are as they were.

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
const matchOf = (query) => {
  const terms = parseSearchQuery(query, 'kanban');
  return { terms, ids: terms.length ? new Set(filterCards(POOL, terms, CTX).map((c) => c.id)) : null };
};
const sorted = (set) => [...set].sort((a, b) => a - b);
const isolated = { isolated: true };

test('isolated, the Graph hides every card the box does not match, and lights the matches', () => {
  const effect = graphQueryEffect(matchOf('zephyr'), POOL, CTX, isolated);
  assert.deepStrictEqual(sorted(effect.visibleIds), [1, 3, 5, 6]);
  assert.deepStrictEqual(sorted(effect.litIds), [1, 3, 5, 6]);
});

test('not isolated, the same query hides nothing, as it did before', () => {
  const effect = graphQueryEffect(matchOf('zephyr'), POOL, CTX);
  assert.strictEqual(effect.visibleIds, null);
  assert.deepStrictEqual(sorted(effect.litIds), [1, 3, 5, 6]);
  assert.strictEqual(graphQueryEffect(matchOf('zephyr'), POOL, CTX, { isolated: false }).visibleIds, null);
});

test('isolated, the cards drawn are the matches among the cards the status pills and Archive leave, a done card included', () => {
  const effect = graphQueryEffect(matchOf('zephyr'), POOL, CTX, isolated);
  assert.deepStrictEqual(sorted(graphVisibleIds(POOL, effect.visibleIds, FILTER, STATUSES)), [1, 3, 5], 'card 6 matches but is archived and the Archive pill is off');
  const done = graphQueryEffect(matchOf('status:done'), POOL, CTX, isolated);
  assert.deepStrictEqual(sorted(graphVisibleIds(POOL, done.visibleIds, FILTER, STATUSES)), [5]);
});

test('isolated, a query that matches nothing draws nothing, where a typed one dims nothing', () => {
  const effect = graphQueryEffect(matchOf('nothing-matches-this'), POOL, CTX, isolated);
  assert.deepStrictEqual(sorted(effect.visibleIds), []);
  assert.deepStrictEqual(sorted(graphVisibleIds(POOL, effect.visibleIds, FILTER, STATUSES)), []);
});

test('isolated with no query, nothing is hidden and nothing is lit: the empty box and a term not finished yet', () => {
  for (const query of ['', 'status:', '   ']) {
    assert.deepStrictEqual(graphQueryEffect(matchOf(query), POOL, CTX, isolated), { visibleIds: null, litIds: null }, JSON.stringify(query));
  }
  assert.deepStrictEqual(graphQueryEffect(null, POOL, CTX, isolated), { visibleIds: null, litIds: null });
});

test('isolated, a slice: term and the rest of the query are one query: only the cards both leave are drawn', () => {
  const tiers = [
    card(1, { title: 'Goal', type: 'goal' }),
    card(2, { title: 'Epic one', type: 'epic', parent: 1 }),
    card(3, { title: 'Epic two', type: 'epic', parent: 1, tags: ['ui'] }),
    card(4, { title: 'Plain', tags: ['ui'] }),
  ];
  const ctx = { ...CTX, hierarchy: ['goal', 'epic'] };
  const terms = parseSearchQuery('tags:ui slice:epic', 'kanban');
  const match = { terms, ids: new Set(filterCards(tiers, terms, ctx).map((c) => c.id)) };
  assert.deepStrictEqual(sorted(match.ids), [3]);
  const effect = graphQueryEffect(match, tiers, ctx, isolated);
  assert.deepStrictEqual(sorted(effect.visibleIds), [3]);
  assert.deepStrictEqual(sorted(effect.litIds), [3]);
});

test('isolated, no board is needed to hide: the whole decision is the match', () => {
  assert.doesNotThrow(() => graphQueryEffect(matchOf('zephyr slice:1'), null, CTX, isolated));
});

test('the isolate text of a selection drawn through the decision is exactly the selection', () => {
  const text = searchIsolateText([{ kind: 'card', id: 2 }, { kind: 'path', id: 1 }, { kind: 'query', text: 'title:venue' }]);
  assert.strictEqual(text, '#2 | path:1 | title:venue');
  const effect = graphQueryEffect(matchOf(text), POOL, CTX, isolated);
  assert.deepStrictEqual(sorted(effect.visibleIds), [1, 2, 3, 4, 7], 'card 2, the path through card 1 (cards 1 to 4), and the venue');
});
