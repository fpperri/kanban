const { test } = require('node:test');
const assert = require('node:assert');
const { reorderPlan, reorderWrites, dropNeighbours, dropSlot, outlineOrder } = require('../web/nesting');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra) => Object.assign({ id, parent: null, rank: null, priority: 'Normal', status: 'todo', archived: false }, extra);
const plan = (cards, id, prev, next) => reorderPlan(cards, id, { prev, next }, CTX);
const applied = (cards, id, got) => {
  const ranks = new Map(reorderWrites(id, got).map((w) => [w.id, w.rank]));
  return cards.map((c) => (ranks.has(c.id) ? Object.assign({}, c, { rank: ranks.get(c.id) }) : c));
};

// The cards of one parent (1), ranked 10, 20, 30 as ids 2, 3, 4, plus the card being dragged (5).
const family = (ranks, extra) => [card(1)].concat(ranks.map((r, i) => card(i + 2, { parent: 1, rank: r })), extra || []);

// --- a free gap: one write ---------------------------------------------

test('between ranks 10 and 20 the card gets 15 and nothing else is written', () => {
  const cards = family([10, 20, 30], [card(5, { parent: 1, rank: 40 })]);
  assert.deepStrictEqual(plan(cards, 5, 2, 3), { rank: 15, renumber: [] });
});

test('the whole number between two ranks is the middle, rounded down', () => {
  assert.strictEqual(plan(family([10, 13], [card(5, { parent: 1, rank: 40 })]), 5, 2, 3).rank, 11);
  assert.strictEqual(plan(family([10, 12], [card(5, { parent: 1, rank: 40 })]), 5, 2, 3).rank, 11);
  assert.strictEqual(plan(family([10, 14], [card(5, { parent: 1, rank: 40 })]), 5, 2, 3).rank, 12);
});

// --- a full gap: the parent's children are renumbered in tens -----------

test('between ranks 10 and 11 the parent\'s children are renumbered 10, 20, 30', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 11 }), card(4, { parent: 1, rank: 12 }), card(5, { parent: 1, rank: 13 })];
  const got = plan(cards, 5, 2, 3);
  assert.strictEqual(got.rank, 20);
  assert.deepStrictEqual(got.renumber, [{ id: 3, rank: 30 }, { id: 4, rank: 40 }]);
});

test('a full gap writes only the cards whose rank changes', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 11 }), card(4, { parent: 1, rank: 40 })];
  assert.deepStrictEqual(plan(cards, 4, 2, 3), { rank: 20, renumber: [{ id: 3, rank: 30 }] });
});

test('a full gap touches no card outside that parent', () => {
  const cards = [
    card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 11 }), card(4, { parent: 1, rank: 12 }),
    card(6), card(7, { parent: 6, rank: 10 }), card(8, { parent: 6, rank: 11 }), card(9, { rank: 11 }),
  ];
  const got = plan(cards, 4, 2, 3);
  const touched = reorderWrites(4, got).map((w) => w.id).sort();
  assert.deepStrictEqual(touched, [3, 4]);
});

test('two siblings with the same rank are a full gap too, never a tie', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 10 }), card(4, { parent: 1, rank: 50 })];
  assert.deepStrictEqual(plan(cards, 4, 2, 3), { rank: 20, renumber: [{ id: 3, rank: 30 }] });
});

test('a rank with a fraction is read as a number, and the gap after it is judged on whole numbers', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 10.5 }), card(4, { parent: 1, rank: 50 })];
  assert.deepStrictEqual(plan(cards, 4, 2, 3), { rank: 20, renumber: [{ id: 3, rank: 30 }] }, 'no whole number between 10 and 10.5');
  const roomy = [card(1), card(2, { parent: 1, rank: 10.5 }), card(3, { parent: 1, rank: 12 }), card(4, { parent: 1, rank: 50 })];
  assert.strictEqual(plan(roomy, 4, 2, 3).rank, 11, 'a whole number strictly between 10.5 and 12');
});

test('reorderWrites lists the dragged card first, then the renumbered siblings, and skips a no-op', () => {
  assert.deepStrictEqual(reorderWrites(4, { rank: 20, renumber: [{ id: 3, rank: 30 }] }), [{ id: 4, rank: 20 }, { id: 3, rank: 30 }]);
  assert.deepStrictEqual(reorderWrites(4, { rank: null, renumber: [{ id: 3, rank: 30 }] }), [{ id: 3, rank: 30 }]);
  assert.deepStrictEqual(reorderWrites(4, { rank: null, renumber: [] }), []);
});

// --- the ends of the list --------------------------------------------------

test('dropped last, the card goes ten above the highest rank', () => {
  assert.deepStrictEqual(plan(family([10, 20], [card(5, { parent: 1, rank: 5 })]), 5, 3, null), { rank: 30, renumber: [] });
});

test('dropped first, the card goes ten below the lowest rank, which may reach 0 and below', () => {
  assert.deepStrictEqual(plan(family([30, 40], [card(5, { parent: 1, rank: 90 })]), 5, null, 2), { rank: 20, renumber: [] });
  assert.strictEqual(plan(family([10, 20], [card(5, { parent: 1, rank: 90 })]), 5, null, 2).rank, 0);
  assert.strictEqual(plan(family([0, 20], [card(5, { parent: 1, rank: 90 })]), 5, null, 2).rank, -10);
});

test('the ends stay whole numbers when the neighbour carries a fraction', () => {
  assert.strictEqual(plan(family([10.5, 20], [card(5, { parent: 1, rank: 90 })]), 5, null, 2).rank, 0);
  assert.strictEqual(plan(family([10, 20.5], [card(5, { parent: 1, rank: 5 })]), 5, 3, null).rank, 31);
});

test('a card that is the only child of its parent needs no write', () => {
  assert.deepStrictEqual(plan([card(1), card(2, { parent: 1, rank: 40 })], 2, null, null), { rank: null, renumber: [] });
  assert.deepStrictEqual(plan([card(1), card(2, { parent: 1 })], 2, null, null), { rank: null, renumber: [] });
});

// --- unranked siblings --------------------------------------------------------

test('after the last ranked sibling and before the first unranked one is just the end of the ranked', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 20 }), card(4, { parent: 1 }), card(5, { parent: 1, rank: 5 })];
  assert.deepStrictEqual(plan(cards, 5, 3, 4), { rank: 30, renumber: [] });
});

test('dropped among unranked siblings, the parent\'s children are ranked in tens in the order shown', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1 }), card(4, { parent: 1 }), card(5, { parent: 1, rank: 90 })];
  assert.deepStrictEqual(plan(cards, 5, 3, 4), { rank: 30, renumber: [{ id: 3, rank: 20 }, { id: 4, rank: 40 }] });
});

test('dropped first among siblings none of which is ranked, every child gets a rank', () => {
  const cards = [card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 1, priority: 'Low' })];
  assert.deepStrictEqual(plan(cards, 4, null, 2), { rank: 10, renumber: [{ id: 2, rank: 20 }, { id: 3, rank: 30 }] });
});

test('unranked siblings show in priority then id order, and the renumbering follows what is shown', () => {
  const cards = [card(1), card(2, { parent: 1, priority: 'Low' }), card(3, { parent: 1, priority: 'High' }), card(4, { parent: 1 })];
  assert.deepStrictEqual(plan(cards, 2, 3, 4), { rank: 20, renumber: [{ id: 3, rank: 10 }, { id: 4, rank: 30 }] }, 'shown High, Normal, Low; the Low card goes between the two above it');
});

// --- siblings the screen does not show ---------------------------------------

test('a hidden sibling between the two tiles is stepped around: the card goes where the room is', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 11, status: 'done' }), card(4, { parent: 1, rank: 20 }), card(5, { parent: 1, rank: 90 })];
  assert.deepStrictEqual(plan(cards, 5, 2, 4), { rank: 15, renumber: [] }, 'no room after 10, but plenty between the hidden 11 and 20');
});

test('a hidden sibling never ends up with the same rank as the dropped card', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 11, status: 'done' }), card(4, { parent: 1, rank: 12 }), card(5, { parent: 1, rank: 90 })];
  const ranks = applied(cards, 5, plan(cards, 5, 2, 4)).filter((c) => c.parent === 1).map((c) => c.rank);
  assert.strictEqual(new Set(ranks).size, ranks.length, `ranks ${ranks}`);
});

test('a hidden sibling at the end of the list does not stop a card being dropped last', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 11, status: 'done' }), card(5, { parent: 1, rank: 5 })];
  assert.deepStrictEqual(plan(cards, 5, 2, null), { rank: 21, renumber: [] }, 'after the visible 10 and past the hidden 11');
});

test('an archived sibling counts: it is renumbered with the rest', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 11, archived: true }), card(4, { parent: 1, rank: 90 })];
  assert.deepStrictEqual(plan(cards, 4, 2, 3), { rank: 20, renumber: [{ id: 3, rank: 30 }] });
});

test('after the drop the outline shows the card where it was dropped, free gap or full', () => {
  const free = family([10, 20, 30], [card(5, { parent: 1, rank: 40 })]);
  const full = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 11 }), card(4, { parent: 1, rank: 12 })];
  for (const [cards, id, prev, next, expected] of [[free, 5, 2, 3, [1, 2, 5, 3, 4]], [full, 4, 2, 3, [1, 2, 4, 3]]]) {
    assert.deepStrictEqual(outlineOrder(applied(cards, id, plan(cards, id, prev, next)), CTX).ids, expected);
  }
});

// --- dropping where it already is -------------------------------------------

test('dropping a card where it already stands writes nothing', () => {
  const cards = family([10, 20, 30]);
  assert.deepStrictEqual(plan(cards, 3, 2, 4), { rank: null, renumber: [] });
  assert.deepStrictEqual(plan(cards, 4, 3, null), { rank: null, renumber: [] }, 'last stays last');
  assert.deepStrictEqual(plan(cards, 2, null, 3), { rank: null, renumber: [] }, 'first stays first');
});

test('an unranked card dropped where it already sits among unranked siblings is not ranked', () => {
  const cards = [card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 1 })];
  assert.deepStrictEqual(plan(cards, 3, 2, 4), { rank: null, renumber: [] });
});

test('a card with a rank off the tens, dropped where it stands, keeps it', () => {
  assert.deepStrictEqual(plan(family([10, 17, 30]), 3, 2, 4), { rank: null, renumber: [] });
});

test('a card dropped between tiles with a hidden sibling in the same spot it already holds writes nothing', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 15 }), card(4, { parent: 1, rank: 20, status: 'done' }), card(5, { parent: 1, rank: 30 })];
  assert.deepStrictEqual(plan(cards, 3, 2, 5), { rank: null, renumber: [] });
});

// --- a drop that cannot be placed -----------------------------------------------

test('a card or a neighbour that does not exist is refused', () => {
  const cards = family([10, 20]);
  assert.ok(plan(cards, 99, 2, 3).error);
  assert.ok(plan(cards, 3, 99, null).error);
  assert.ok(plan(cards, 3, null, 99).error);
});

test('a card cannot be its own neighbour', () => {
  assert.ok(plan(family([10, 20]), 2, 2, 3).error);
  assert.ok(plan(family([10, 20]), 2, 3, 2).error);
});

test('a drop that names no neighbour writes nothing', () => {
  assert.deepStrictEqual(plan(family([10, 20]), 2, null, null), { rank: null, renumber: [] });
});

test('a drop among another parent\'s children is refused: a drag changes rank, never the parent', () => {
  const cards = [card(1), card(2, { parent: 1, rank: 10 }), card(6), card(7, { parent: 6, rank: 10 }), card(8, { parent: 6, rank: 20 })];
  assert.ok(plan(cards, 2, 7, 8).error);
  assert.ok(plan(cards, 2, 8, null).error);
});

test('neighbours named in the wrong order are refused', () => {
  assert.ok(plan(family([10, 20, 30]), 4, 3, 2).error);
});

// --- a tile among a sibling's own children --------------------------------------

test('a tile that is a sibling\'s child stands for that sibling: after its subtree is after the sibling', () => {
  // roots 1, 6 and 9; 6 has children 7 and 8; the outline shows 1, 6, 7, 8, 9
  const cards = [card(1, { rank: 10 }), card(6, { rank: 20 }), card(7, { parent: 6, rank: 10 }), card(8, { parent: 6, rank: 20 }), card(9, { rank: 30 }), card(12, { rank: 90 })];
  assert.deepStrictEqual(plan(cards, 12, 8, 9), { rank: 25, renumber: [] }, 'between the last child of 6 and 9 is between 6 and 9');
  assert.deepStrictEqual(plan(cards, 12, 1, 6), { rank: 15, renumber: [] });
});

test('between a sibling and its first child, or among its children, is not a place for a card of another parent', () => {
  const cards = [card(1, { rank: 10 }), card(6, { rank: 20 }), card(7, { parent: 6, rank: 10 }), card(8, { parent: 6, rank: 20 }), card(12, { rank: 90 })];
  assert.ok(plan(cards, 12, 6, 7).error);
  assert.ok(plan(cards, 12, 7, 8).error);
});

test('a parent dragged to where its own children are shown is placed by the neighbour that is not its child', () => {
  const cards = [card(1, { rank: 10 }), card(6, { rank: 20 }), card(7, { parent: 6, rank: 10 }), card(8, { parent: 6, rank: 20 }), card(9, { rank: 30 })];
  assert.deepStrictEqual(plan(cards, 6, 1, 7), { rank: null, renumber: [] });
  assert.deepStrictEqual(plan(cards, 6, 8, 9), { rank: null, renumber: [] });
  assert.ok(plan(cards, 6, 7, 8).error, 'inside its own children');
});

test('roots whose parent is on another board or missing from this one are siblings of the plain roots', () => {
  const cards = [card(1, { rank: 10 }), card(2, { rank: 20, parent: 'fpp#4' }), card(3, { rank: 30, parent: 99 }), card(4, { rank: 90 })];
  assert.deepStrictEqual(plan(cards, 4, 1, 2), { rank: 15, renumber: [] });
  assert.deepStrictEqual(plan(cards, 4, 2, 3), { rank: 25, renumber: [] });
});

// --- reading the screen ----------------------------------------------------------

test('dropNeighbours: the tiles above and below the drop point, in outline order', () => {
  assert.deepStrictEqual(dropNeighbours([4, 5, 6], 1, 'asc'), { prev: 4, next: 5 });
  assert.deepStrictEqual(dropNeighbours([4, 5, 6], 0, 'asc'), { prev: null, next: 4 });
  assert.deepStrictEqual(dropNeighbours([4, 5, 6], 3, 'asc'), { prev: 6, next: null });
  assert.deepStrictEqual(dropNeighbours([], 0, 'asc'), { prev: null, next: null });
});

test('dropNeighbours: a descending column shows the outline backwards, so above is later', () => {
  assert.deepStrictEqual(dropNeighbours([6, 5, 4], 1, 'desc'), { prev: 5, next: 6 });
  assert.deepStrictEqual(dropNeighbours([6, 5, 4], 0, 'desc'), { prev: 6, next: null });
  assert.deepStrictEqual(dropNeighbours([6, 5, 4], 3, 'desc'), { prev: null, next: 4 });
});

test('dropSlot: how many tiles have their middle above the pointer', () => {
  assert.strictEqual(dropSlot([10, 30, 50], 5), 0);
  assert.strictEqual(dropSlot([10, 30, 50], 20), 1);
  assert.strictEqual(dropSlot([10, 30, 50], 31), 2);
  assert.strictEqual(dropSlot([10, 30, 50], 80), 3);
  assert.strictEqual(dropSlot([], 80), 0);
});

// --- tiles around the siblings' region ----------------------------------------

test('the parent shown just above its first child marks the start of its children', () => {
  const cards = family([10, 20, 30]);
  assert.deepStrictEqual(plan(cards, 4, 1, 2), { rank: 0, renumber: [] });
});

test('the tile after the last child, whatever it is, marks the end of the children', () => {
  const cards = family([10, 20, 30], [card(9)]);
  assert.deepStrictEqual(plan(cards, 2, 4, 9), { rank: 40, renumber: [] });
});

test('a root shown above children whose parent is in another column marks their start', () => {
  const cards = [card(8, { rank: 5 })].concat(family([10, 20, 30]).map((c) => (c.id === 1 ? Object.assign({}, c, { rank: 10 }) : c)));
  assert.deepStrictEqual(plan(cards, 4, 8, 2), { rank: 0, renumber: [] });
});

test('a tile that lies the wrong side of the siblings is refused', () => {
  const cards = [card(1, { rank: 10 }), card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 20 }), card(6, { rank: 20 }), card(7, { parent: 6, rank: 10 }), card(8, { parent: 6, rank: 20 })];
  assert.ok(plan(cards, 2, 7, 8).error, 'both tiles are another parent\'s children');
  assert.ok(plan(cards, 2, 8, null).error, 'a tile after the children cannot be above the drop');
  assert.ok(plan(cards, 7, null, 3).error, 'a tile before the children cannot be below the drop');
});
