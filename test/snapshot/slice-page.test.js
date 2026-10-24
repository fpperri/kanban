const { test, describe } = require('node:test');
const assert = require('node:assert');
const { sliceCards, sliceDepths } = require('../../plugin/skills/web/web/slices');
const { readConfig } = require('../../plugin/skills/web/scripts/config-store');
const { listActive, listArchived, toJSON } = require('../../plugin/skills/web/scripts/card-store');
const { board: smallBoard } = require('./nesting-view');
const { withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');
const { planCards, search, showArchive, webContext, webIds, withBoardPage } = require('./search-table');

// A cut typed in the snapshot's search box means what it means at the desk: the page
// cuts by the slices of the whole board, archived cards included, from the hierarchy
// the builder read, through the web's own slices module. Each test builds the board,
// types a slice: term into the page's search box and holds the cards the page shows to
// the cards the web gives the same term and to the slices written out here.

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// The plan board's axis (goal, strategy, objective, epic, then depths) with the
// cards of each slice, written out from the board's cards (not computed by either
// side). Cards 19, 20 and 21 are archived; card 19 sits under strategy card 2. A depth counts
// from the nearest tier card down, so card 23 (right under the epic 22) is depth 0 and its
// child 24 is depth 1.
const PLAN_AXIS = [
  { term: 'goal', ids: [1, 25] },
  { term: 'strategy', ids: [2, 26] },
  { term: 'objective', ids: [7] },
  { term: 'epic', ids: [22] },
  { term: '0', ids: [3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 27, 28, 29] },
  { term: '1', ids: [24] },
];

describe('every card of the plan board is in the same slice on the page as in the web\'s slices module', () => {
  test('one slice: term per slice of the axis shows the cards the slices module puts there, archived cards included, and the ids written here', () => {
    withBoardPage('plan', (page, dir) => {
      const cards = planCards(dir);
      const ctx = webContext(dir);
      const { axis, byId } = sliceCards(cards, ctx.hierarchy, sliceDepths(cards, ctx.hierarchy, ctx));
      const named = (s) => (s.kind === 'tier' ? s.key : String(s.depth));
      assert.deepStrictEqual(axis.map(named), PLAN_AXIS.map((s) => s.term), 'the axis the web builds from the board');
      for (const s of axis) {
        const web = cards.filter((c) => byId.get(String(c.id)) === s).map((c) => Number(c.id)).sort((a, b) => a - b);
        assert.deepStrictEqual(web, PLAN_AXIS[s.index].ids, `the web's slice ${named(s)} against the board`);
        assert.deepStrictEqual(search(page, `slice:${named(s)}`), web, `slice:${named(s)} on the page`);
      }
      const archived = cards.filter((c) => c.archived).map((c) => Number(c.id));
      assert.deepStrictEqual(archived, [19, 20, 21], 'sanity: the board has three archived cards');
      assert.deepStrictEqual(PLAN_AXIS.flatMap((s) => s.ids).sort((a, b) => a - b), range(1, 29), 'every card is in exactly one slice');
    });
  });

  test('the page holds the hierarchy the builder read, and the page\'s own slice of each card is the module\'s', () => {
    withBoardPage('plan', (page, dir) => {
      const cards = planCards(dir);
      const ctx = webContext(dir);
      const { byId } = sliceCards(cards, ctx.hierarchy, sliceDepths(cards, ctx.hierarchy, ctx));
      assert.deepStrictEqual(page.plain(page.run('HIERARCHY')), ctx.hierarchy);
      const onPage = page.plain(page.run('(() => { const cards = DATA.map(searchCard); const { byId } = sliceCards(cards, HIERARCHY, sliceDepths(cards, HIERARCHY, { board: BOARD })); return cards.map((c) => [String(c.id), byId.get(String(c.id)).index]); })()'));
      assert.deepStrictEqual(onPage.sort((a, b) => a[0] - b[0]), cards.map((c) => [String(c.id), byId.get(String(c.id)).index]).sort((a, b) => a[0] - b[0]));
    });
  });
});

describe('a board that declares no hierarchy', () => {
  test('slice:1 keeps only the depth-1 cards, as it does on the web', () => {
    withBoardPage('fixture', (page, dir) => {
      const cards = planCards(dir);
      const ctx = webContext(dir);
      assert.deepStrictEqual(ctx.hierarchy, [], 'sanity: the board has no hierarchy');
      assert.deepStrictEqual(page.plain(page.run('HIERARCHY')), []);
      assert.deepStrictEqual(webIds(cards, 'slice:1', ctx), [2, 3, 4, 5, 6], 'the web, against the board: the cards under card 1');
      assert.deepStrictEqual(search(page, 'slice:1'), [2, 3, 4, 5, 6]);
      assert.deepStrictEqual(search(page, 'slice:0'), webIds(cards, 'slice:0', ctx));
      assert.deepStrictEqual(search(page, 'slice:goal'), range(1, 21), 'a tier name the board does not have cuts nothing');
    });
  });
});

describe('a malformed board', () => {
  // The hierarchy lists Goal and goal, a blank entry, then Epic and EPIC. Card 1 is
  // typed Goal, card 2 epic (under card 1), card 3 story (under 2), card 4 loose,
  // card 5 archived.
  test('the page builds, a slice: term naming a tier listed twice in mixed case cuts as on the web, and the page logs no error', () => {
    const logged = [];
    const record = (level) => (...args) => logged.push([level, ...args.map(String)]);
    const spy = { log: () => {}, info: () => {}, debug: () => {}, warn: record('warn'), error: record('error') };
    withBoardPage('malformed', (page, dir) => {
      const cards = planCards(dir);
      const ctx = webContext(dir);
      assert.deepStrictEqual(page.plain(page.run('HIERARCHY')), ['Goal', 'goal', 'Epic', 'EPIC'], 'the blank entry is skipped, the rest kept as written');
      for (const [q, ids] of [['slice:goal', [1]], ['slice:GOAL', [1]], ['slice:Goal', [1]], ['slice:EPIC', [2]], ['slice:epic', [2]], ['slice:goal..epic', [1, 2]], ['slice:epic..goal', [1, 2]], ['slice:0', [3, 4, 5]]]) {
        assert.deepStrictEqual(webIds(cards, q, ctx), ids, `the web, against the board: ${q}`);
        assert.deepStrictEqual(search(page, q), ids, q);
      }
    }, { console: spy });
    assert.deepStrictEqual(logged, [], 'nothing logged as an error or a warning');
  });
});

describe('the depths are built over archived cards too', () => {
  // Card 1 is a goal, card 2 (archived, no type) sits right under it (depth 0), card 3 (live, no
  // type) sits under the archived card 2. Without the archived card, card 3 would read as a root.
  const board = smallBoard('hierarchy: [goal]\n', [[1, 'todo', 'Top', { type: 'goal' }], [3, 'todo', 'Under the archived card', { parent: 2 }]],
    [[2, 'done', 'Archived middle', { parent: 1 }]]);

  test('a live card under an archived parent lands in the slice the web puts it in', () => {
    withSnapshot(board, (html, dir) => {
      const page = loadPage(html, { matchMedia: (q) => q.includes('min-width:900px') });
      showArchive(page);
      const cards = listActive(dir).concat(listArchived(dir)).map(toJSON);
      const ctx = { board: 'order', hierarchy: readConfig(dir).hierarchy };
      assert.deepStrictEqual(webIds(cards, 'slice:1', ctx), [3], 'the web, against the board: card 3 is one untiered parent below the goal');
      assert.deepStrictEqual(search(page, 'slice:1'), [3]);
      assert.deepStrictEqual(search(page, 'slice:0'), [2]);
      assert.deepStrictEqual(search(page, 'slice:goal'), [1]);
    });
  });
});

describe('a queued edit and a slice', () => {
  test('a type a queued edit sets shows under type: at once, but the card stays in the slice the board gave it until the edit is applied', () => {
    withBoardPage('plan', (page) => {
      assert.ok(!search(page, 'type:goal').includes(3), 'sanity: card 3 has no type');
      page.run("queue({ op: 'edit', id: 3, fm: { type: 'goal' } })");
      assert.ok(search(page, 'type:goal').includes(3), 'the queued type shows under type:');
      assert.deepStrictEqual(search(page, 'slice:goal'), [1, 25], 'but not under slice:goal');
      assert.ok(search(page, 'slice:0').includes(3), 'card 3 is still a depth-0 card');
    });
  });
});
