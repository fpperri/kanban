const { test, describe } = require('node:test');
const assert = require('node:assert');
const { withBoardPage, withBuiltBoard } = require('./search-table');
const { openPanel, pill } = require('./panel-table');

// A query on the snapshot page sees the cards as the page holds them: an edit still queued counts,
// and so does a card queued with + New card, which has no number yet (its id is n1, n2, ...). The
// slice axis stays the board as it was built (slice-page.test.js), plus the queued cards, which
// sit where a new card does: a root of depth 0, or the tier its type names. A term that cuts
// nothing cuts them nothing, and waiting: reads the dependencies as the page holds them.

const shownRaw = (page) => page.byId('board').all().filter((n) => n.classList.contains('card')).map((n) => String(n.dataset.card));
const typeQuery = (page, q) => { page.type(page.byId('q'), q); return shownRaw(page); };
const queueNew = (page, extra = '') => page.run(`queue({ op: 'create', title: 'fresh', status: 'todo'${extra} })`);

describe('a card queued with + New card and a slice: term', () => {
  test('is shown when the term cuts nothing: a single unknown name, an open pair, or a run that holds depth 0', () => {
    withBoardPage('plan', (page) => {
      queueNew(page);
      assert.ok(typeQuery(page, 'fresh').includes('n1'), 'sanity: the card shows under a bare word');
      for (const q of ['slice:nowhere', 'slice:..', 'slice:0', 'slice:goal..', 'slice:strategy..', 'slice:0..2']) {
        assert.ok(typeQuery(page, `${q} fresh`).includes('n1'), q);
      }
    });
  });

  test('is cut by a run that does not hold depth 0, as any card at depth 0 is', () => {
    withBoardPage('plan', (page) => {
      queueNew(page);
      for (const q of ['slice:goal', 'slice:strategy..epic', 'slice:1', 'slice:1..2']) {
        assert.ok(!typeQuery(page, `${q} fresh`).includes('n1'), q);
      }
      assert.ok(typeQuery(page, 'slice:0 fresh').includes('n1'));
    });
  });

  test('with a tier for its type it is in that tier, and only there', () => {
    withBoardPage('plan', (page) => {
      queueNew(page, ", fm: { type: 'goal' }");
      assert.ok(typeQuery(page, 'slice:goal fresh').includes('n1'));
      assert.ok(!typeQuery(page, 'slice:strategy fresh').includes('n1'));
      assert.ok(!typeQuery(page, 'slice:0 fresh').includes('n1'));
    });
  });

  test('two queued cards are cut one at a time: a card in the run does not take another out of it with it', () => {
    withBoardPage('plan', (page) => {
      queueNew(page, ", fm: { type: 'goal' }");
      page.run("queue({ op: 'create', title: 'fresh two', status: 'todo' })");
      const goal = typeQuery(page, 'slice:goal fresh');
      assert.ok(goal.includes('n1'), 'the goal');
      assert.ok(!goal.includes('n2'), 'the card with no type is at depth 0');
      const root = typeQuery(page, 'slice:0 fresh');
      assert.ok(root.includes('n2') && !root.includes('n1'));
    });
  });

  test('the cards of the board are cut as before: a queued card changes no slice but its own', () => {
    withBoardPage('plan', (page) => {
      const before = typeQuery(page, 'slice:goal');
      queueNew(page);
      assert.deepStrictEqual(typeQuery(page, 'slice:goal'), before);
    });
  });
});

describe('waiting: and a queued edit', () => {
  test('a card a queued waiting_for edit makes wait shows under waiting:, and the card that waited no more does not', () => {
    withBoardPage('plan', (page) => {
      const before = typeQuery(page, 'waiting:');
      assert.ok(!before.includes('5'), 'sanity: card 5 waits for nothing');
      page.run("queue({ op: 'edit', id: 5, fm: { waiting_for: '[3]' } })");
      const after = typeQuery(page, 'waiting:');
      assert.ok(after.includes('5'), 'card 5 now waits for card 3, which is not done');
      assert.deepStrictEqual(after.filter((id) => id !== '5'), before, 'and nothing else moved');
      const gone = before[0];
      page.run(`queue({ op: 'edit', id: ${gone}, fm: { waiting_for: '' } })`);
      assert.ok(!typeQuery(page, 'waiting:').includes(gone), 'a card whose waits were taken off is no longer waiting');
    });
  });

  test('a card made done by a queued move no longer holds the cards waiting for it', () => {
    withBoardPage('plan', (page) => {
      const waiting = typeQuery(page, 'waiting:');
      page.run("queue({ op: 'edit', id: 5, fm: { waiting_for: '[3]' } })");
      assert.ok(typeQuery(page, 'waiting:').includes('5'));
      page.run("queue({ op: 'move', id: 3, to: 'done' })");
      assert.ok(!typeQuery(page, 'waiting:').includes('5'), 'card 3 is done now, so card 5 waits for nothing');
      assert.deepStrictEqual(typeQuery(page, 'waiting:').filter((id) => !waiting.includes(id)), [], 'and nothing else changed');
    });
  });

  test('the waiting pill counts the same cards as waiting: shows, a queued edit included', () => {
    withBuiltBoard('plan', (page) => {
      openPanel(page);
      const before = pill(page, 'waiting').count;
      page.run("queue({ op: 'edit', id: 5, fm: { waiting_for: '[3]' } }); render();");
      assert.strictEqual(pill(page, 'waiting').count, before + 1);
    });
  });
});
