const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards, resolveTerms } = require('../web/search');

// Card 2 waits for card 1, so the default dependency graph puts 1 and 2 in one
// tree and in one path; card 3 stands alone.
const CARDS = [
  { id: 1, title: 'one', body: '', status: 'doing', priority: 'Normal', tags: [] },
  { id: 2, title: 'two', body: '', status: 'todo', priority: 'Normal', tags: [], waiting_for: [1] },
  { id: 3, title: 'three', body: '', status: 'todo', priority: 'Normal', tags: [] },
];
const ids = (q, ctx) => filterCards(CARDS, parseSearchQuery(q), ctx).map((c) => c.id);

test('tree: and path: read the default dependency graph when the context carries no graph functions', () => {
  assert.deepStrictEqual(ids('tree:1'), [1, 2]);
  assert.deepStrictEqual(ids('path:1', { board: 'kanban' }), [1, 2]);
});

test('a context that carries graph functions resolves tree: through them and not through the dependency graph', () => {
  const calls = [];
  const ctx = {
    board: 'kanban',
    graph: {
      treeIds: (cards, id, c) => { calls.push(['tree', cards, id, c]); return new Set([3]); },
      pathIds: () => { throw new Error('path: was not asked for'); },
    },
  };
  assert.deepStrictEqual(ids('tree:1', ctx), [3], 'the default graph would have said 1 and 2');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][1], CARDS, 'the functions get the whole board, as the default graph does');
  assert.strictEqual(calls[0][2], '1');
  assert.strictEqual(calls[0][3], ctx, 'and the context itself, so a function can read the board name');
});

test('a context that carries graph functions resolves path: through them and not through the dependency graph', () => {
  const ctx = {
    graph: {
      treeIds: () => { throw new Error('tree: was not asked for'); },
      pathIds: (cards, id) => new Set([3, Number(id)]),
    },
  };
  assert.deepStrictEqual(ids('path:2', ctx), [2, 3], 'the default graph would have said 1 and 2');
});

test('the graph functions of a context serve tree: and path: in one query, each term on its own function', () => {
  const ctx = {
    graph: {
      treeIds: () => new Set([1, 2, 3]),
      pathIds: () => new Set([2, 3]),
    },
  };
  assert.deepStrictEqual(ids('tree:1 path:1', ctx), [2, 3]);
});

test('the resolver turns tree: and path: into id terms and leaves every other term as it was', () => {
  const terms = parseSearchQuery('tree:1 status:todo path:3');
  const resolved = resolveTerms(CARDS, terms, {});
  assert.deepStrictEqual(resolved.map((t) => t.field), ['ids', 'status', 'ids']);
  assert.deepStrictEqual([...resolved[0].ids].sort(), [1, 2]);
  assert.deepStrictEqual([...resolved[2].ids], [3]);
  assert.strictEqual(resolved[1], terms[1]);
  assert.strictEqual(terms[0].field, 'tree', 'the parsed terms are not rewritten in place');
});

test('a query with no tree: or path: term comes back untouched', () => {
  const terms = parseSearchQuery('status:todo');
  assert.strictEqual(resolveTerms(CARDS, terms, {}), terms);
});

test('the one pass reaches terms inside a group, so a later or-group resolves where tree: and path: do', () => {
  const ctx = { graph: { treeIds: () => new Set([3]), pathIds: () => new Set([2]) } };
  const group = { field: 'or', alts: [[{ field: 'tree', value: '1' }], [{ field: 'status', value: 'doing' }, { field: 'path', value: '1' }]] };
  const [resolved] = resolveTerms(CARDS, [group], ctx);
  assert.strictEqual(resolved.field, 'or');
  assert.deepStrictEqual(resolved.alts[0].map((t) => t.field), ['ids']);
  assert.deepStrictEqual([...resolved.alts[0][0].ids], [3]);
  assert.deepStrictEqual(resolved.alts[1].map((t) => t.field), ['status', 'ids']);
  assert.deepStrictEqual([...resolved.alts[1][1].ids], [2]);
  assert.strictEqual(group.alts[0][0].field, 'tree', 'the group handed in is not rewritten in place');
});
