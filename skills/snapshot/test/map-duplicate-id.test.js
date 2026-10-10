const { test } = require('node:test');
const assert = require('node:assert');
const cardStore = require('../../web/scripts/card-store');
const { buildRelationsGraph } = require('../../web/web/dependency-graph');
const { MAP_OPTION_DEFAULTS, mapShapeRelations } = require('../../web/web/map-relations');
const { card, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

const board = {
  config: 'name: dup\nstatuses: [backlog, todo, doing, done]\n',
  cards: {
    '0005.a.card.md': card(5, 'todo', 'Twice'),
    '0006.b.card.md': card(6, 'todo', 'Dep'),
    '0007.c.card.md': card(7, 'todo', 'Waits', { waiting_for: '[6]' }),
  },
  archived: { '0005.a.card.md': card(5, 'done', 'Twice') },
};

test('a card id present twice is one node and one No relations entry, in the snapshot and in kanban-web', () => {
  withSnapshot(board, (html, dir) => {
    const page = loadPage(html);
    const cards = cardStore.listActive(dir).concat(cardStore.listArchived(dir)).map(cardStore.toJSON);
    const ctx = { board: 'dup', priorities: ['High', 'Normal', 'Low'] };
    const web = mapShapeRelations(buildRelationsGraph(cards, null, ctx), MAP_OPTION_DEFAULTS);
    const mine = page.plain(page.run('mapShape(new Set(DATA.map(c=>Number(c.id))))'));
    assert.deepStrictEqual(web.noRelations, [5]);
    assert.deepStrictEqual(mine.noRelations, [5]);
  });
});
