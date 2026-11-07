const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards, searchTermText } = require('../../plugin/skills/web/web/search');

// archived: in the search box. `archived:no` is the live cards only, `archived:yes` or a bare
// `archived:` the archived cards only, and a query without it matches both, as ever.

const mk = (id, status, archived, extra = {}) => Object.assign({ id, title: `Card ${id}`, body: '', status, priority: 'Normal', tags: [], type: null, archived }, extra);
const CARDS = [mk(1, 'done', false), mk(2, 'done', true), mk(3, 'doing', false), mk(4, 'done', true), mk(5, 'todo', false, { waiting_for: [3] })];
const ids = (q, ctx) => filterCards(CARDS, parseSearchQuery(q), ctx).map((c) => c.id);

test('archived: parses as a complete term, bare included, in any letter case', () => {
  assert.deepStrictEqual(parseSearchQuery('archived:no'), [{ field: 'archived', value: 'no' }]);
  assert.deepStrictEqual(parseSearchQuery('ARCHIVED:Yes'), [{ field: 'archived', value: 'yes' }]);
  assert.deepStrictEqual(parseSearchQuery('archived:'), [{ field: 'archived', value: '' }]);
});

test('archived:no is the live cards only; yes and bare archived: the archived cards only', () => {
  assert.deepStrictEqual(ids('archived:no'), [1, 3, 5]);
  assert.deepStrictEqual(ids('archived:yes'), [2, 4]);
  assert.deepStrictEqual(ids('archived:'), [2, 4]);
});

test('without the term search matches live and archived together', () => {
  assert.deepStrictEqual(ids('status:done'), [1, 2, 4]);
  assert.deepStrictEqual(ids('status:done archived:no'), [1]);
  assert.deepStrictEqual(ids('status:done archived:yes'), [2, 4]);
});

test('the term works inside or and brackets, and a value that is neither yes nor no is text', () => {
  assert.deepStrictEqual(ids('archived:no | #2'), [1, 2, 3, 5]);
  assert.deepStrictEqual(ids('status:done (archived:yes | #1)'), [1, 2, 4]);
  assert.deepStrictEqual(parseSearchQuery('archived:maybe'), [{ field: null, value: 'archived:maybe' }]);
});

test('tree: traversal still walks the whole board whatever archived: says', () => {
  assert.deepStrictEqual(ids('tree:3 archived:no'), [3, 5]);
  assert.deepStrictEqual(ids('tree:3'), [3, 5]);
  const linked = [mk(1, 'todo', true, { waiting_for: [2] }), mk(2, 'todo', false, { waiting_for: [3] }), mk(3, 'todo', false)];
  assert.deepStrictEqual(filterCards(linked, parseSearchQuery('tree:3 archived:no')).map((c) => c.id), [2, 3]);
  assert.deepStrictEqual(filterCards(linked, parseSearchQuery('tree:3 archived:yes')).map((c) => c.id), [1]);
});

test('searchTermText writes the term back as typed', () => {
  assert.strictEqual(searchTermText('archived', 'no'), 'archived:no');
});
