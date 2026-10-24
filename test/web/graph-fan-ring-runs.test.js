const { test, after } = require('node:test');
const assert = require('node:assert');

const { graphLayoutHierarchy } = require('../web/graph-model');
const {
  STATUSES, card, buildOf, loadBoard, drawnModel, rootShapedCards, cleanUp,
} = require('./helpers/fan-boards');

// A parent's children on one ring of the tier fan sit side by side: for each ring, the
// children a parent has there form one unbroken run among its children on that ring or
// nearer the centre, standing where the first of them falls in sibling order; a run on a
// ring further out may sit inside a nearer ring's run, between two of its cards.

after(cleanUp);

const layoutOf = (model, order) => graphLayoutHierarchy(model, { statuses: STATUSES, order });
const seatsOf = (layout, ids) => ids.slice().sort((a, b) => layout.polar.get(b).a - layout.polar.get(a).a);
const childrenOf = (model, id) => model.nodes.filter((n) => n.parentId === id).map((n) => n.id);

// The rule, read off the finished layout: no mark that is not a child of the parent sits
// on a ring inside the span of the parent's children on that ring.
function marksInsideASpan(model, layout) {
  const found = [];
  const parents = new Set(model.nodes.filter((n) => n.parentId !== null).map((n) => n.parentId));
  for (const parent of parents) {
    const kids = childrenOf(model, parent).filter((id) => layout.polar.has(id));
    const rings = new Set(kids.map((id) => layout.polar.get(id).r));
    for (const r of rings) {
      const mine = kids.filter((id) => layout.polar.get(id).r === r);
      if (mine.length < 2) continue;
      const angles = mine.map((id) => layout.polar.get(id).a);
      const lo = Math.min(...angles);
      const hi = Math.max(...angles);
      for (const [id, p] of layout.polar) {
        if (mine.includes(id) || Math.abs(p.r - r) > 1e-6) continue;
        if (p.a > lo && p.a < hi) found.push(`${id} inside the span of ${parent}'s children on the ring at ${r.toFixed(0)}`);
      }
    }
  }
  return found;
}

// Goal 1 has four epics (2 to 5, each with children of its own on the outer ring) and
// four untyped children (10 to 13) that sit on that same outer ring. Rank puts 10 and 11
// between the first two epics and leaves 12 and 13 unranked, after every ranked sibling.
const interleaved = (extra = {}) => buildOf([
  card(1, { type: 'goal' }),
  card(2, { type: 'epic', parent: 1, rank: -50 }), card(3, { type: 'epic', parent: 1, rank: -40 }),
  card(4, { type: 'epic', parent: 1, rank: -30 }), card(5, { type: 'epic', parent: 1, rank: -20 }),
  card(10, { parent: 1, rank: -45 }), card(11, { parent: 1, rank: -44 }), card(12, { parent: 1, ...extra[12] }), card(13, { parent: 1, ...extra[13] }),
  card(20, { parent: 2 }), card(21, { parent: 2 }), card(22, { parent: 3 }), card(23, { parent: 3 }), card(24, { parent: 4 }),
]);

test('ring runs: the leaves of a parent whose epics hold the outer ring between them sit in one run, where the first of them falls', () => {
  const model = interleaved();
  const layout = layoutOf(model, 'rank');
  const kids = ['2', '3', '4', '5', '10', '11', '12', '13'];
  assert.deepStrictEqual(seatsOf(layout, kids), ['2', '10', '11', '12', '13', '3', '4', '5']);
  const leafRing = layout.polar.get('10').r;
  assert.ok(leafRing > layout.polar.get('2').r, 'the leaves are on a ring further out than the epics');
  for (const id of ['12', '13', '20', '24']) assert.strictEqual(layout.polar.get(id).r, leafRing, `card ${id} is on the leaves' ring`);
  assert.deepStrictEqual(marksInsideASpan(model, layout), []);
});

test('ring runs: the run keeps the order the option asks for, and under status it stands where the first of them falls', () => {
  const model = interleaved({ 12: { status: 'doing' }, 13: { status: 'backlog' } });
  const layout = layoutOf(model, 'status');
  const kids = ['2', '3', '4', '5', '10', '11', '12', '13'];
  assert.deepStrictEqual(seatsOf(layout, kids), ['12', '10', '11', '13', '2', '3', '4', '5'], 'the doing leaf comes first, so the run of leaves stands first');
  assert.deepStrictEqual(marksInsideASpan(model, layout), []);
  const rank = layoutOf(model, 'rank');
  assert.deepStrictEqual(seatsOf(rank, kids), ['2', '10', '11', '12', '13', '3', '4', '5'], 'under rank the same cards stand as the outline orders them');
  assert.deepStrictEqual(marksInsideASpan(model, rank), []);
});

test('ring runs: the parent still sits at the middle of its subtree\'s stretch', () => {
  const model = interleaved();
  const layout = layoutOf(model, 'rank');
  const [sector] = layout.sectors;
  assert.ok(Math.abs(layout.polar.get('1').a - (sector.from + sector.to) / 2) < 1e-9);
  const leaves = ['20', '21', '10', '11', '12', '13', '22', '23', '24'].map((id) => layout.polar.get(id).a);
  assert.deepStrictEqual(leaves.slice().sort((a, b) => b - a), leaves, 'seats run on from the left of the seam in the order of the outline');
});

// Goal 1 has three kinds of child on three rings: strategies (nearest), epics, then untyped
// leaves (outermost), ranked s1 l1 e1 s2 l2 e2 s3 l3 e3.
const threeRings = () => {
  const kinds = [['s', { type: 'strategy' }], ['l', {}], ['e', { type: 'epic' }]];
  const cards = [card(1, { type: 'goal' })];
  let id = 10;
  for (let round = 0; round < 3; round++) {
    for (const [, extra] of kinds) cards.push(card(id, { parent: 1, rank: id, ...extra })), id++;
  }
  return { model: buildOf(cards), s: ['10', '13', '16'], l: ['11', '14', '17'], e: ['12', '15', '18'] };
};

test('ring runs: children on three rings make three runs, an outer one inside a nearer one', () => {
  const { model, s, l, e } = threeRings();
  const layout = layoutOf(model, 'rank');
  const rings = [s, e, l].map((ids) => layout.polar.get(ids[0]).r);
  assert.ok(rings[0] < rings[1] && rings[1] < rings[2], 'strategies, epics and leaves lie on rings further and further out');
  assert.deepStrictEqual(seatsOf(layout, [...s, ...l, ...e]), ['10', '11', '14', '17', '12', '15', '18', '13', '16']);
  assert.deepStrictEqual(marksInsideASpan(model, layout), []);
});

test('ring runs: a parent whose children all lie on one ring lays out as the option orders them', () => {
  const epics = buildOf([
    card(1, { type: 'goal' }), card(2, { type: 'epic', parent: 1, rank: 30 }), card(3, { type: 'epic', parent: 1, rank: 10 }),
    card(4, { type: 'epic', parent: 1, rank: 20, status: 'doing' }), card(5, { type: 'epic', parent: 1, status: 'done' }),
    card(6, { parent: 3 }), card(7, { parent: 2 }), card(8, { parent: 3, status: 'doing' }),
  ]);
  assert.deepStrictEqual(seatsOf(layoutOf(epics, 'rank'), ['2', '3', '4', '5']), ['3', '4', '2', '5']);
  assert.deepStrictEqual(seatsOf(layoutOf(epics, 'status'), ['2', '3', '4', '5']), ['4', '3', '2', '5']);
  assert.deepStrictEqual(seatsOf(layoutOf(epics, 'rank'), ['6', '7', '8']), ['6', '8', '7'], 'the grandchildren are seated by the stretches of their parents');
  assert.deepStrictEqual(marksInsideASpan(epics, layoutOf(epics, 'rank')), []);
});

test('ring runs: a child that a nearer ring\'s card does not part from its neighbours stays where it was', () => {
  const model = buildOf([
    card(1, { type: 'goal' }),
    card(2, { type: 'epic', parent: 1, rank: 10 }), card(3, { parent: 1, rank: 20 }), card(4, { parent: 1, rank: 30 }),
  ]);
  assert.deepStrictEqual(seatsOf(layoutOf(model, 'rank'), ['2', '3', '4']), ['2', '3', '4']);
  const lead = buildOf([
    card(1, { type: 'goal' }),
    card(2, { parent: 1, rank: 10 }), card(3, { parent: 1, rank: 20 }), card(4, { type: 'epic', parent: 1, rank: 30 }),
  ]);
  assert.deepStrictEqual(seatsOf(layoutOf(lead, 'rank'), ['2', '3', '4']), ['2', '3', '4']);
});

test('ring runs: two parents side by side each keep their children together, and neither\'s marks fall inside the other\'s span', () => {
  const kids = (root, first) => [
    card(first, { type: 'epic', parent: root, rank: 1 }), card(first + 1, { parent: root, rank: 2 }),
    card(first + 2, { type: 'epic', parent: root, rank: 3 }), card(first + 3, { parent: root, rank: 4 }),
    card(first + 4, { parent: first }), card(first + 5, { parent: first + 2 }),
  ];
  const model = buildOf([card(1, { type: 'goal' }), card(2, { type: 'goal' }), ...kids(1, 10), ...kids(2, 30)]);
  for (const order of ['rank', 'status']) {
    const layout = layoutOf(model, order);
    assert.deepStrictEqual(seatsOf(layout, ['10', '11', '12', '13']), ['10', '11', '13', '12'], `${order}: the leaves 11 and 13 stand together`);
    assert.deepStrictEqual(marksInsideASpan(model, layout), [], order);
  }
});

test('ring runs: no mark of another parent sits inside the span of a parent\'s children on a ring, on a board the size of a real shop board', () => {
  const model = buildOf(rootShapedCards());
  for (const order of ['rank', 'status']) assert.deepStrictEqual(marksInsideASpan(model, layoutOf(model, order)), [], order);
});

test('ring runs: the same holds on the plan fixture board, under both orders', () => {
  const board = loadBoard('plan');
  const model = drawnModel(board);
  for (const order of ['rank', 'status']) assert.deepStrictEqual(marksInsideASpan(model, layoutOf(model, order)), [], order);
});
