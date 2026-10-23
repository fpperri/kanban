const { test, describe } = require('node:test');
const assert = require('node:assert');
const { PLAN_QUERIES, planCards, search, webIds, withPlanPage } = require('./search-table');

// A query typed on the phone finds what it finds at the desk: one table of
// queries runs through the built snapshot page and through the web search
// module, over the plan board the browser runner drives.

describe('the shared table of queries on the plan board', () => {
  test('every row shows the same card ids on the snapshot page as through the web search module, and the ids written in the table', () => {
    withPlanPage((page, dir) => {
      const cards = planCards(dir);
      const rows = PLAN_QUERIES.map(({ q, ids }) => ({ q, ids, web: webIds(cards, q), page: search(page, q) }));
      assert.deepStrictEqual(rows.filter((r) => r.web.join() !== r.ids.join()).map((r) => r.q), [],
        'rows where the web search module disagrees with the table');
      assert.deepStrictEqual(rows.filter((r) => r.page.join() !== r.web.join())
        .map((r) => `${r.q}: page ${JSON.stringify(r.page)}, web ${JSON.stringify(r.web)}`), [],
      'rows where the snapshot page disagrees with the web search module');
    });
  });

  test('the table covers an id, the board name and an id, every field prefix, a:, tree:, path:, hpath:, htree:, dpath:, dtree:, dlinks:, hlinks:, review:, blocked:, an unknown prefix and bare text', () => {
    const typed = PLAN_QUERIES.map((r) => r.q);
    const has = (re) => assert.ok(typed.some((q) => re.test(q)), `no row for ${re}`);
    [/^#\d+$/, /^plan#\d+$/i, /^id:\d/, /^title:/, /^body:/, /^status:/, /^priority:/, /^tags:/, /^file:/, /^assignee:/,
      /^type:/, /^a:@/i, /^tree:\d/, /^path:\d/, /^hpath:\d/, /^htree:\d/, /^dpath:\d/, /^dtree:#?\d/, /^dlinks:#?\d/, /^hlinks:#?\d/, /^review:/, /^blocked:/, /^foo:/, /^zephyr$/].forEach(has);
  });

  test('a:@human and assignee:@human find the plan board\'s @human cards', () => {
    withPlanPage((page, dir) => {
      const human = planCards(dir).filter((c) => c.assignee === '@human').map((c) => Number(c.id)).sort((a, b) => a - b);
      assert.ok(human.length > 10, 'sanity: the plan board has many @human cards');
      assert.deepStrictEqual(search(page, 'a:@human'), human);
      assert.deepStrictEqual(search(page, 'assignee:@human'), human);
      assert.deepStrictEqual(search(page, 'A:@Human'), human);
    });
  });
});

describe('queued, unsent edits still show through a search', () => {
  const sheetControl = (page, pred) => page.byId('modalscroll').all().find(pred);

  // The card's tile on an unfiltered board, tapped open.
  function openSheet(page, id) {
    page.type(page.byId('q'), '');
    page.click(page.byId('board').all().find((n) => n.classList.contains('card') && n.dataset.card === String(id)));
  }

  // What a person does: open the card, tap its assignee pill, pick the handle.
  function assign(page, id, handle) {
    openSheet(page, id);
    page.click(sheetControl(page, (n) => n.dataset.act === 'pill' && n.dataset.pill === 'assignee'));
    const select = sheetControl(page, (n) => n.dataset.act === 'asg');
    select.value = handle;
    page.change(select);
  }

  // What a person does: open the card, open All fields, type the value, tap Save.
  function saveField(page, id, key, value) {
    openSheet(page, id);
    if (!sheetControl(page, (n) => n.id === `fm-${key}`)) page.click(sheetControl(page, (n) => n.dataset.act === 'fmtoggle'));
    sheetControl(page, (n) => n.id === `fm-${key}`).value = value;
    page.click(sheetControl(page, (n) => n.dataset.act === 'fmsave' && n.dataset.key === key));
  }

  test('a card whose assignee a queued edit changes shows under the new handle and leaves the old one', () => {
    withPlanPage((page) => {
      assert.ok(!search(page, 'a:@afk').includes(14), 'sanity: card 14 is not an @afk card');
      assign(page, 14, '@afk');
      assert.strictEqual(page.run('ops.length'), 1, 'the edit is queued, not sent');
      assert.ok(search(page, 'a:@afk').includes(14), 'now under a:@afk');
      assert.ok(search(page, 'assignee:@afk').includes(14), 'and under assignee:@afk');
      assert.ok(!search(page, 'a:@human').includes(14), 'and gone from a:@human');
    });
  });

  test('a card whose tags, review or type a queued edit changes shows under the new text', () => {
    withPlanPage((page) => {
      saveField(page, 8, 'tags', 'queued-tag');
      saveField(page, 14, 'review', 'queued look');
      saveField(page, 12, 'type', 'saga');
      assert.deepStrictEqual(search(page, 'tags:queued'), [8]);
      assert.deepStrictEqual(search(page, 'review:'), [10, 14]);
      assert.deepStrictEqual(search(page, 'review:queued'), [14]);
      assert.deepStrictEqual(search(page, 'type:saga'), [12]);
      assert.deepStrictEqual(search(page, 'queued'), [8], 'bare text reads the tags and not the review sticker');
    });
  });

  test('a queued edit leaves the answer for a card it does not touch as it was', () => {
    withPlanPage((page) => {
      const before = search(page, 'a:@afk');
      assign(page, 14, '@afk');
      assert.deepStrictEqual(search(page, 'a:@afk'), [...before, 14].sort((a, b) => a - b));
    });
  });
});
