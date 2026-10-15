const { test } = require('node:test');
const assert = require('node:assert');
const { planCards, search, webIds, withPlanPage } = require('./search-table');

// The snapshot runs the web's own search module, so the grammar beyond plain
// terms (or, brackets, quotes, waiting:) reaches the phone with it. These rows
// run through the built snapshot page and through the web search module over the
// plan board, and hold both to the card ids written out here from the board.

const GRAMMAR = [
  { q: 'blocked: | review:', ids: [9, 10] },
  { q: 'status:doing | #12', ids: [1, 2, 9, 12, 15, 22, 23] },
  { q: 'tags:ui (status:todo | status:backlog)', ids: [11, 17] },
  { q: 'tags:ui |', ids: [11, 17] },
  { q: 'tags:grill', ids: [8, 13] },
  { q: 'tags:"grill"', ids: [8] },
  { q: 'tags:"docs" | tags:"infra"', ids: [2, 5, 10] },
  { q: '"cutover plan"', ids: [3] },
  { q: 'title:"write the cutover plan"', ids: [3] },
  { q: '(zephyr)', ids: [1, 2, 7, 11, 19] },
  { q: 'waiting:', ids: [4, 6, 8] },
  { q: 'waiting:3', ids: [] },
  { q: 'fix(auth)', ids: [] },
];

test('every grammar row shows the same card ids on the snapshot page as through the web search module, and the ids written here', () => {
  withPlanPage((page, dir) => {
    const cards = planCards(dir);
    const rows = GRAMMAR.map(({ q, ids }) => ({ q, ids, web: webIds(cards, q), page: search(page, q) }));
    assert.deepStrictEqual(rows.filter((r) => r.web.join() !== r.ids.join()).map((r) => r.q), [],
      'rows where the web search module disagrees with the ids written here');
    assert.deepStrictEqual(rows.filter((r) => r.page.join() !== r.web.join())
      .map((r) => `${r.q}: page ${JSON.stringify(r.page)}, web ${JSON.stringify(r.web)}`), [],
    'rows where the snapshot page disagrees with the web search module');
  });
});
