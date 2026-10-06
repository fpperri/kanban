const { test } = require('node:test');
const assert = require('node:assert');
const cardStore = require('../../web/scripts/card-store');
const { buildRelationsGraph } = require('../../web/web/dependency-graph');
const { MAP_OPTION_DEFAULTS, mapShapeRelations } = require('../../web/web/map-relations');
const { card, withSnapshot } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');

// The snapshot builds the relations the map draws from its own card shape, then hands
// them to the same shaping rules kanban-web uses. The builder is written twice, so
// these pin the two copies to the same graphs on a board that has every kind of
// relation: chains under a parent, a loose card, a parent on another board (twice), a
// missing parent, a missing dependency, a self-parent and archived children.

const rows = [
  [1, 'doing', 'Ship', { type: 'objective' }],
  [2, 'done', 'Spec', { parent: 1 }],
  [3, 'done', 'Build', { parent: 1, waiting_for: '[2]' }],
  [4, 'todo', 'Test', { parent: 1, waiting_for: '[3]' }],
  [5, 'backlog', 'Docs', { parent: 1 }],
  [7, 'todo', 'Examples', { parent: 5 }],
  [20, 'todo', 'Loose'],
  [30, 'todo', 'Other root'],
  [31, 'doing', 'Other first', { parent: 30 }],
  [32, 'todo', 'Other second', { parent: 30, waiting_for: '[31]' }],
  [40, 'todo', 'Abroad', { parent: '"fpp#4"' }],
  [41, 'todo', 'Abroad too', { parent: '"fpp#4"' }],
  [42, 'todo', 'Orphan', { parent: 99 }],
  [43, 'todo', 'Stale wait', { waiting_for: '[98]' }],
  [44, 'todo', 'Waits for loose', { waiting_for: '[20]' }],
  [46, 'todo', 'Own parent', { parent: 46 }],
];
const archived = [
  [6, 'done', 'Old child', { parent: 1 }],
  [8, 'done', 'Older child', { parent: 1, waiting_for: '[6]' }],
  [9, 'done', 'Old loose'],
  [33, 'done', 'Old other child', { parent: 30 }],
];

const board = {
  config: 'name: map\nstatuses: [backlog, todo, doing, done]\n',
  cards: Object.fromEntries(rows.map(([id, status, title, extra]) => [`${String(id).padStart(4, '0')}.c.card.md`, card(id, status, title, extra)])),
  archived: Object.fromEntries(archived.map(([id, status, title, extra]) => [`${String(id).padStart(4, '0')}.c.card.md`, card(id, status, title, extra)])),
};

const CTX = { board: 'map', priorities: ['High', 'Normal', 'Low'] };

const stubName = (n) => (n.external ? `${n.id}:${n.external}` : String(n.id));
const lineName = (l) => `${l.child}>${l.parent}${l.ends ? `:${Number(l.ends.below)}${Number(l.ends.above)}` : ''}`;

function summarize(view) {
  return {
    graphs: view.graphs.map((g) => ({
      ids: g.ids,
      nodes: g.nodes.map((n) => n.id),
      stubs: g.ghosts.map(stubName),
      roots: g.roots,
      edges: g.edges.map((e) => `${e.from}>${e.to}`),
      lines: g.lines.map(lineName),
      layout: g.layoutEdges.map((e) => `${e.from}>${e.to}:${e.kind}`),
    })),
    noRelations: view.noRelations,
  };
}

function bothSides(fn) {
  withSnapshot(board, (html, dir) => {
    const page = loadPage(html);
    const cards = cardStore.listActive(dir).concat(cardStore.listArchived(dir)).map(cardStore.toJSON);
    fn(page, cards);
  });
}

function compare(page, cards, visible) {
  const ids = visible ? `new Set(${JSON.stringify(visible)})` : 'new Set(DATA.map(c=>Number(c.id)))';
  const mine = summarize(page.plain(page.run(`mapShape(${ids})`)));
  const set = visible ? new Set(visible) : null;
  const web = summarize(mapShapeRelations(buildRelationsGraph(cards, set, CTX), MAP_OPTION_DEFAULTS));
  assert.deepStrictEqual(mine, web);
  return mine;
}

test('the map shows the same graphs as kanban-web when every card is visible', () => {
  bothSides((page, cards) => {
    const shape = compare(page, cards, null);
    assert.ok(shape.graphs.length >= 4, 'the board has several trees');
    assert.ok(shape.graphs.some((g) => g.stubs.some((s) => s.endsWith(':fpp#4'))), 'a parent on another board is a stub');
    assert.ok(shape.noRelations.includes(46) && shape.noRelations.includes(9), 'a self-parent and a loose card are in No relations');
  });
});

test('the map shows the same graphs when the archive is hidden, as the snapshot opens', () => {
  bothSides((page, cards) => {
    const live = cards.filter((c) => !c.archived).map((c) => c.id);
    const shape = compare(page, cards, live);
    assert.ok(shape.graphs.some((g) => g.stubs.includes('6')), 'a hidden archived child is a dimmed stub on its visible parent');
  });
});

test('the map shows the same graphs for a search that keeps a few cards', () => {
  bothSides((page, cards) => {
    compare(page, cards, [1, 3, 4, 20, 31]);
    compare(page, cards, [44, 32]);
    compare(page, cards, [99]);
    compare(page, cards, []);
  });
});
