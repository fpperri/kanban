const { test } = require('node:test');
const assert = require('node:assert');
const { planCards, search, webContext, webIds, withPlanPage } = require('./search-table');

// The snapshot runs the web's own search module, so the grammar beyond plain
// terms (or, brackets, quotes, waiting:) and the slice: term reach the phone
// with it. These rows run through the built snapshot page and through the web
// search module over the plan board (whose hierarchy is goal, strategy,
// objective, epic), and hold both to the card ids written out here from the board.
//
// The plan board's cards are 1 to 29; 19, 20 and 21 are archived. The slice
// axis, top to bottom, holds these cards:
//   goal 1, 25 · strategy 2, 26 · objective 7 · epic 22
//   depth 0: 3 to 6, 8 to 21, 23, 27, 28, 29 · depth 1: 24
// A depth counts from the nearest tier card down, so 23 (right under the epic 22) is depth 0.
// A card of a type outside the hierarchy (11 story, 14 bug, 15 and 17 task) is in
// the slice of its depth.

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const ALL = range(1, 29);
const except = (...gone) => ALL.filter((id) => !gone.includes(id));

const GRAMMAR = [
  { q: 'blocked: | review:', ids: [9, 10] },
  { q: 'status:doing | #12', ids: [1, 2, 9, 12, 15, 22, 23] },
  { q: 'tags:ui (status:todo | status:backlog)', ids: [11, 17] },
  { q: '((status:doing | status:todo) tags:ui) | #12', ids: [12, 17] },
  { q: 'tags:ui |', ids: [11, 17] },
  { q: 'tags:grill', ids: [8, 13] },
  { q: 'tags:"grill"', ids: [8] },
  { q: 'tags:"docs" | tags:"infra"', ids: [2, 5, 10] },
  { q: '"cutover plan"', ids: [3] },
  { q: '("cutover plan" | "flaky vendor")', ids: [3, 9] },
  { q: 'title:"write the cutover plan"', ids: [3] },
  { q: 'title:"Renew the domain"', ids: [12] },
  { q: 'title:"renew"', ids: [] },
  { q: 'body:"fixture card 1."', ids: [1] },
  { q: 'body:"fixture card"', ids: [] },
  { q: '"cutover plan', ids: [3] },
  { q: '(status:doing', ids: [1, 2, 9, 15, 22, 23] },
  { q: '(zephyr)', ids: [1, 2, 7, 11, 19] },
  { q: 'waiting:', ids: [4, 6, 8] },
  { q: 'waiting: | review:', ids: [4, 6, 8, 10] },
  { q: 'waiting: a:@afk', ids: [4] },
  { q: 'waiting:3', ids: [] },
  { q: 'fix(auth)', ids: [] },
  { q: 'a|b', ids: [] },

  { q: 'slice:objective', ids: [7] },
  { q: 'slice:GOAL..Strategy', ids: [1, 2, 25, 26] },
  { q: 'slice:objective..0', ids: except(1, 2, 24, 25, 26) },
  { q: 'slice:0..objective', ids: except(1, 2, 24, 25, 26) },
  { q: 'slice:objective..', ids: except(1, 2, 25, 26) },
  { q: 'slice:..objective', ids: [1, 2, 7, 25, 26] },
  { q: 'slice:..0', ids: except(24) },
  { q: 'slice:0..1', ids: except(1, 2, 7, 22, 25, 26) },
  { q: 'slice:1', ids: [24] },
  { q: 'slice:objective..nowhere', ids: except(1, 2, 25, 26) },
  { q: 'slice:nowhere..objective', ids: [1, 2, 7, 25, 26] },
  { q: 'slice:nowhere', ids: ALL },
  { q: 'slice:9', ids: ALL },
  { q: 'slice:..', ids: ALL },
  { q: 'slice:', ids: ALL },
  { q: 'slice:0 type:task', ids: [15, 17, 27, 28, 29] },
  { q: 'slice:goal | slice:epic', ids: [1, 22, 25] },
  { q: '(slice:goal | slice:epic) status:todo', ids: [] },
  { q: 'slice:goal..epic tags:ui | #12', ids: [12] },

  { q: 'group:', ids: [] },
  { q: 'group:I2', ids: [] },
  { q: '-group:', ids: ALL },
  { q: '-group:zephyr-2', ids: ALL },
  { q: 'group:I2 | #12', ids: [12] },
];

test('every grammar and slice row shows the same card ids on the snapshot page as through the web search module, and the ids written here', () => {
  withPlanPage((page, dir) => {
    const cards = planCards(dir);
    const ctx = webContext(dir);
    const rows = GRAMMAR.map(({ q, ids }) => ({ q, ids, web: webIds(cards, q, ctx), page: search(page, q) }));
    assert.deepStrictEqual(rows.filter((r) => r.web.join() !== r.ids.join()).map((r) => r.q), [],
      'rows where the web search module disagrees with the ids written here');
    assert.deepStrictEqual(rows.filter((r) => r.page.join() !== r.web.join())
      .map((r) => `${r.q}: page ${JSON.stringify(r.page)}, web ${JSON.stringify(r.web)}`), [],
    'rows where the snapshot page disagrees with the web search module');
  });
});

test('the table covers every form the web search module takes: or, brackets, nested brackets, quoted values, a quoted title:, phrases, waiting: and the literal cases', () => {
  const typed = GRAMMAR.map((r) => r.q);
  const has = (re) => assert.ok(typed.some((q) => re.test(q)), `no row for ${re}`);
  [/ \| /, /^\(/, /^\(\(/, /tags:"/, /^title:"/, /^body:"/, /^"[^"]+"$/, /^"[^"]+$/, /^waiting:$/, /^waiting:3$/, /^a\|b$/, /^fix\(auth\)$/]
    .forEach(has);
});

test('the table covers every slice: form: one tier, a tier to a depth, both open ends, a reversed pair, an unknown end, a single unknown name, a depth range, and slice: beside other terms', () => {
  const typed = GRAMMAR.map((r) => r.q);
  const has = (re) => assert.ok(typed.some((q) => re.test(q)), `no row for ${re}`);
  [/^slice:[a-z]+$/, /^slice:[a-z]+\.\.\d$/i, /^slice:[a-z]+\.\.$/, /^slice:\.\.[a-z]+$/, /^slice:\.\.\d$/, /^slice:\d\.\.[a-z]+$/,
    /^slice:[a-z]+\.\.nowhere$/, /^slice:nowhere$/, /^slice:\d\.\.\d$/, /^slice:\d$/, /^slice:\.\.$/, /^slice:$/,
    /slice:0 type:task/, /slice:goal \| slice:epic/].forEach(has);
});

test('the table covers the group: forms the snapshot reads without drawing groups: bare, an id, a name, negated, and beside an or', () => {
  const typed = GRAMMAR.map((r) => r.q);
  const has = (re) => assert.ok(typed.some((q) => re.test(q)), `no row for ${re}`);
  [/^group:$/, /^group:I2$/, /^-group:$/, /^-group:[a-z]/, /^group:I2 \| /].forEach(has);
});
