const { test } = require('node:test');
const assert = require('node:assert');
const { parseConfig } = require('../../web/scripts/config-store');
const cardStore = require('../../web/scripts/card-store');
const { typeColor } = require('../../web/web/type-badge');
const { rollupSegments, rollupBar, rollupScopeLine } = require('../../web/web/rollup-bar');
const { rollupIndex } = require('../../web/web/nesting');
const { BOARD } = require('./nesting-fixture');
const { byClass } = require('./page-harness');
const { open, sheet } = require('./nesting-view');

// The page embeds nesting.js as is, but draws with its own code, and three small
// helpers are written twice: the type color match, the order of a roll-up bar's
// segments and the roll-up's scope and count lines. These pin the two copies to
// the same answers, so a change to one that forgets the other fails here.

const STATUSES = ['backlog', 'todo', 'doing', 'done'];

test('the type color match gives the same color as kanban-web for every spelling of a type', () => {
  const types = parseConfig(BOARD.config).types;
  open(BOARD, (page) => {
    for (const type of ['objective', 'Objective', '  OBJECTIVE ', 'epic', 'story', 'saga', '', null, undefined]) {
      const mine = page.run(`typeColor(${JSON.stringify(type === undefined ? null : type)})`);
      assert.strictEqual(mine, typeColor(type, types), `type ${JSON.stringify(type)}`);
    }
  });
});

test('the roll-up bar orders its segments as kanban-web does: the board\'s statuses first, then the rest by name', () => {
  open(BOARD, (page) => {
    for (const counts of [
      { done: 2, zeta: 1, doing: 1, alpha: 4, backlog: 3 },
      { Done: 1, done: 1, todo: 2 },
      { only: 5 },
      {},
    ]) {
      const mine = page.plain(page.run(`rollupSegs(${JSON.stringify(counts)})`));
      assert.deepStrictEqual(mine, rollupSegments(counts, STATUSES), JSON.stringify(counts));
    }
  });
});

test('a parent\'s sheet says the same about its counts and where they were counted as kanban-web does', () => {
  open(BOARD, (page, dir) => {
    const cards = cardStore.listActive(dir).concat(cardStore.listArchived(dir)).map(cardStore.toJSON);
    const index = rollupIndex(cards, { board: 'fixture', priorities: [] });
    for (const id of index.parents()) {
      const rollup = index.rollup(id);
      const web = rollupBar(rollup, 'open', STATUSES);
      const webCounts = [...web.matchAll(/<span class="rollup-count[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
      const box = byClass(sheet(page, id), 'detail-rollup')[0];
      assert.deepStrictEqual(byClass(box, 'rollup-count').map((n) => n.textContent), webCounts, `card ${id}: counts`);
      assert.strictEqual(byClass(box, 'rollup-scope')[0].textContent, rollupScopeLine(rollup, true), `card ${id}: scope`);
    }
  });
});
