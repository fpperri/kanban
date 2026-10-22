const { test } = require('node:test');
const assert = require('node:assert');

const { graphBuild } = require('../web/graph-model');
const {
  GRAPH_FLOW_GEO, mergeGraphFlowDeps, graphFlowLink, graphFlowAddress, graphFlowPlace, graphFlowPath, graphFlowMarks,
} = require('../web/graph-flow');

// The Flow layout at its own seam: the columns of both Dependencies modes, the done and the loop
// column, the strip of the cards with no dependency, the order within a column, and that a loop or a
// long chain does not hang it. The layout reads the Graph model, so every test builds one from cards.

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra = {}) => ({
  id: String(id), title: `card ${id}`, status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, ...extra,
});
const waits = (id, ...on) => card(id, { waiting_for: on.map(String) });
const place = (cards, deps, visibleIds = null) => graphFlowPlace(graphBuild(cards, { ctx: CTX, visibleIds }), { deps });
const columnsOf = (flow) => flow.columns.map((c) => [c.label, c.ids.slice().sort((a, b) => a - b)]);
const colOf = (flow, id) => flow.columns.find((c) => c.ids.includes(String(id)));

// --- frontier ------------------------------------------------------------------------

test('frontier: done first, then ready now and a column for each step until a card is ready, counting only what is not done', () => {
  const flow = place([
    card(1, { status: 'done' }), waits(2, 1), waits(3, 2), waits(4, 3), waits(5, 2, 4),
  ], 'frontier');
  assert.deepStrictEqual(columnsOf(flow), [
    ['done', ['1']], ['ready now', ['2']], ['1 step', ['3']], ['2 steps', ['4']], ['3 steps', ['5']],
  ]);
  assert.deepStrictEqual(flow.columns.map((c) => c.faded), [true, false, false, false, false]);
  assert.strictEqual(flow.deps, 'frontier');
});

test('frontier: a dependency that is done is no step, so the card it held up is ready now', () => {
  const flow = place([card(1, { status: 'done' }), card(2), waits(3, 1, 2), waits(4, 1)], 'frontier');
  assert.deepStrictEqual(columnsOf(flow), [['done', ['1']], ['ready now', ['2', '4']], ['1 step', ['3']]]);
});

test('frontier: an archived card is done', () => {
  const flow = place([card(1, { archived: true, status: 'doing' }), waits(2, 1)], 'frontier');
  assert.deepStrictEqual(columnsOf(flow), [['done', ['1']], ['ready now', ['2']]]);
});

test('frontier: a card waited for that is not done holds its dependants back, whatever its status', () => {
  const flow = place([card(1, { status: 'doing' }), card(2, { status: 'backlog' }), waits(3, 1, 2)], 'frontier');
  assert.deepStrictEqual(columnsOf(flow), [['ready now', ['1', '2']], ['1 step', ['3']]]);
});

test('frontier: with nothing done there is no done column, and with everything done there is an empty ready now', () => {
  assert.deepStrictEqual(place([card(1), waits(2, 1)], 'frontier').columns.map((c) => c.label), ['ready now', '1 step']);
  const flow = place([card(1, { status: 'done' }), waits(2, 1, 1)].map((c) => (c.id === '2' ? { ...c, status: 'done' } : c)), 'frontier');
  assert.deepStrictEqual(columnsOf(flow), [['done', ['1', '2']], ['ready now', []]]);
});

test('frontier: a dependency loop and whatever waits behind it stand in the loop column, last', () => {
  const flow = place([waits(1, 2), waits(2, 1), waits(3, 2), card(4), waits(5, 4), waits(6, 3)], 'frontier');
  assert.deepStrictEqual(columnsOf(flow), [['ready now', ['4']], ['1 step', ['5']], ['loop', ['1', '2', '3', '6']]]);
  assert.strictEqual(flow.columns.at(-1).faded, false);
});

test('frontier: a loop that has a done card in it is not a loop, for the done card no longer counts', () => {
  const flow = place([card(1, { status: 'done', waiting_for: ['2'] }), waits(2, 1), waits(3, 2)], 'frontier');
  assert.deepStrictEqual(columnsOf(flow), [['done', ['1']], ['ready now', ['2']], ['1 step', ['3']]]);
});

test('frontier: a card that waits for itself is a card with no dependency', () => {
  const flow = place([waits(1, 1), card(2)], 'frontier');
  assert.deepStrictEqual(flow.columns, []);
  assert.deepStrictEqual(flow.strip.ids.slice().sort(), ['1', '2']);
});

// --- all -----------------------------------------------------------------------------

test('all: waits for nothing, then a column for the longest chain of dependencies behind a card, done ones counted', () => {
  const flow = place([
    card(1, { status: 'done' }), waits(2, 1), waits(3, 2), card(4), waits(5, 4, 3),
  ], 'all');
  assert.deepStrictEqual(columnsOf(flow), [
    ['waits for nothing', ['1', '4']], ['chain 1', ['2']], ['chain 2', ['3']], ['chain 3', ['5']],
  ]);
  assert.ok(flow.columns.every((c) => c.faded === false), 'nothing is faded in all');
  assert.strictEqual(flow.deps, 'all');
});

test('all: the members of a loop share one column and what waits behind it comes after', () => {
  const flow = place([card(1), waits(2, 1, 3), waits(3, 2), waits(4, 3)], 'all');
  assert.deepStrictEqual(columnsOf(flow), [['waits for nothing', ['1']], ['chain 1', ['2', '3']], ['chain 2', ['4']]]);
});

test('all and frontier agree on a board with nothing done and no loop, but for the names of the columns', () => {
  const cards = [card(1), waits(2, 1), waits(3, 1), waits(4, 2, 3)];
  const ids = (flow) => flow.columns.map((c) => c.ids.slice().sort());
  assert.deepStrictEqual(ids(place(cards, 'all')), ids(place(cards, 'frontier')));
});

test('a switch that is not one of the two reads as frontier', () => {
  assert.strictEqual(mergeGraphFlowDeps(undefined), 'frontier');
  assert.strictEqual(mergeGraphFlowDeps('open'), 'frontier');
  assert.strictEqual(mergeGraphFlowDeps('all'), 'all');
  assert.strictEqual(place([card(1), waits(2, 1)], 'sideways').deps, 'frontier');
});

// --- the strip -----------------------------------------------------------------------

test('the cards with no dependency either way sit in a strip below the columns, with a count, in either mode', () => {
  const cards = [card(1), waits(2, 1), card(3), card(4, { status: 'done' }), card(5)];
  for (const deps of ['frontier', 'all']) {
    const flow = place(cards, deps);
    assert.deepStrictEqual(flow.strip.ids, ['3', '4', '5'], deps);
    assert.strictEqual(flow.strip.count, 3);
    assert.strictEqual(flow.strip.label, 'no dependency either way');
    const bottom = Math.max(...flow.columns.map((c) => c.y + c.h));
    assert.ok(flow.strip.y > bottom, `${deps}: the strip starts below every column`);
    for (const id of flow.strip.ids) {
      const p = flow.pos.get(id);
      assert.ok(p.y > flow.strip.y && p.y < flow.strip.y + flow.strip.h && p.x > flow.strip.x && p.x < flow.strip.x + flow.strip.w, `${deps}: card ${id} is inside the strip`);
    }
    for (const col of flow.columns) assert.ok(!col.ids.some((id) => flow.strip.ids.includes(id)), 'a card is in a column or in the strip');
  }
});

test('there is no strip when every card has a dependency, and no column when none has', () => {
  assert.strictEqual(place([card(1), waits(2, 1)], 'frontier').strip, null);
  const flow = place([card(1), card(2)], 'frontier');
  assert.deepStrictEqual(flow.columns, []);
  assert.deepStrictEqual(flow.lanes, []);
  assert.strictEqual(flow.strip.count, 2);
  assert.ok([...flow.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('a card whose only dependency is not drawn has no dependency among the drawn cards: it is in the strip', () => {
  const flow = place([card(1), waits(2, 1), waits(3, 1), card(4)], 'frontier', new Set(['2', '4']));
  assert.deepStrictEqual(flow.columns, []);
  assert.deepStrictEqual(flow.strip.ids, ['2', '4']);
});

test('an empty board has no column and no strip', () => {
  const flow = place([], 'frontier');
  assert.deepStrictEqual([flow.columns, flow.lanes, flow.strip, flow.pos.size], [[], [], null, 0]);
});

// --- places --------------------------------------------------------------------------

test('every column is a frame left of the next, every card stands in the frame of its column, and the columns hold their cards', () => {
  const flow = place([card(1), card(2), waits(3, 1), waits(4, 2), waits(5, 3, 4), waits(6, 5)], 'all');
  const { COLGAP } = GRAPH_FLOW_GEO;
  flow.columns.forEach((c, i) => {
    assert.strictEqual(c.index, i);
    if (i) assert.ok(c.x > flow.columns[i - 1].x + flow.columns[i - 1].w, `column ${i} starts after column ${i - 1}`);
    assert.strictEqual(c.count, c.ids.length);
    for (const id of c.ids) {
      const p = flow.pos.get(id);
      assert.ok(p.x > c.x && p.x < c.x + c.w, `card ${id} is in the frame of its column`);
    }
    assert.ok(c.w > 0 && c.h > 0 && c.x + c.w < (flow.columns[i + 1] ? flow.columns[i + 1].x : Infinity) + COLGAP);
  });
});

test('within a column the cards stand in one stack, a row apart, and a tall column wraps into side-by-side stacks', () => {
  const small = place([card(1), waits(2, 1), waits(3, 1), waits(4, 1)], 'all');
  const col = small.columns[1];
  const ys = col.ids.map((id) => small.pos.get(id).y);
  assert.strictEqual(new Set(col.ids.map((id) => small.pos.get(id).x)).size, 1);
  assert.deepStrictEqual(ys.slice().sort((a, b) => a - b), ys, 'the order of the column is the order down the page');
  assert.ok(ys.every((y, i) => !i || y - ys[i - 1] === GRAPH_FLOW_GEO.PITCH));

  const kids = Array.from({ length: GRAPH_FLOW_GEO.ROWS * 2 + 1 }, (_, i) => waits(i + 2, 1));
  const tall = place([card(1), ...kids], 'all');
  const wide = tall.columns[1];
  assert.strictEqual(new Set(wide.ids.map((id) => tall.pos.get(id).x)).size, 3, 'three stacks');
  assert.ok(Math.max(...wide.ids.map((id) => tall.pos.get(id).y)) - Math.min(...wide.ids.map((id) => tall.pos.get(id).y)) < GRAPH_FLOW_GEO.ROWS * GRAPH_FLOW_GEO.PITCH);
  assert.ok(wide.w > tall.columns[0].w, 'the frame of the wrapped column is wider');
  for (const id of wide.ids) assert.ok(tall.pos.get(id).x > wide.x && tall.pos.get(id).x < wide.x + wide.w);
});

test('the cards of a column are ordered to cut the arrows that cross, and ties go by id', () => {
  const crossing = [card(1), card(2), waits(3, 2), waits(4, 1)];
  const flow = place(crossing, 'all');
  assert.deepStrictEqual(colOf(flow, 3).ids, ['4', '3'], 'the card that waits for the upper source is the upper');
  assert.deepStrictEqual(flow.columns[0].ids, ['1', '2']);
  const ties = place([card(10), card(2), waits(11, 10), waits(3, 2), card(7), waits(8, 7)], 'all');
  assert.deepStrictEqual(ties.columns[0].ids, ['2', '7', '10'], 'sources with nothing to lean on keep id order');
  const flat = place([card(5), card(3), card(4), waits(6, 3), waits(7, 4), waits(8, 5)], 'all');
  assert.deepStrictEqual(flat.columns[0].ids, ['3', '4', '5']);
});

test('the same cards always give the same places', () => {
  const cards = [card(1), card(2), waits(3, 1), waits(4, 2), waits(5, 3, 4), card(6), waits(7, 5, 2)];
  const plain = (f) => JSON.stringify({ ...f, pos: [...f.pos], radius: [...f.radius] });
  for (const deps of ['frontier', 'all']) assert.strictEqual(plain(place(cards, deps)), plain(place(cards, deps)), deps);
  assert.notStrictEqual(plain(place(cards, 'all')), plain(place(cards, 'frontier')));
});

test('a dot is as large as the waits it is in, and a parent does not enlarge it', () => {
  const flow = place([card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), waits(4, 2, 3), waits(5, 4)], 'all');
  const r = (id) => flow.radius.get(String(id));
  assert.ok(r(4) > r(2), 'card 4 is in three waits, card 2 in one');
  assert.strictEqual(r(2), r(3));
  assert.strictEqual(r(2), r(5));
  assert.strictEqual(r(1), 5, 'a card in no wait has the smallest dot, though it has two children');
});

test('the bounds boxes frame every column and the strip', () => {
  const flow = place([card(1), waits(2, 1), card(3)], 'frontier');
  assert.strictEqual(flow.boxes.length, flow.columns.length + 1);
  for (const b of flow.boxes) assert.ok(b.x1 > b.x0 && b.y1 > b.y0);
});

test('lanes: the cards with a dependency are in one lane without a header, and the columns stand across it', () => {
  const flow = place([card(1), waits(2, 1), card(3)], 'all');
  assert.strictEqual(flow.lanes.length, 1);
  const lane = flow.lanes[0];
  assert.deepStrictEqual([lane.key, lane.header], [null, null]);
  assert.deepStrictEqual(lane.ids, ['1', '2']);
  assert.ok(lane.h > 0 && lane.y === GRAPH_FLOW_GEO.HEAD);
  for (const c of flow.columns) assert.ok(c.y + c.h >= lane.y + lane.h, 'a column frames the lane');
});

// --- loops and long chains never hang it ------------------------------------------------

test('a long chain and a long loop are laid out without a deep recursion', () => {
  const n = 6000;
  const chain = [card(1)];
  for (let i = 2; i <= n; i++) chain.push(waits(i, i - 1));
  const long = place(chain, 'all');
  assert.strictEqual(long.columns.length, n);
  assert.strictEqual(place(chain, 'frontier').columns.length, n);

  const ring = Array.from({ length: n }, (_, i) => waits(i + 1, ((i + 1) % n) + 1));
  const looped = place(ring, 'all');
  assert.deepStrictEqual(looped.columns.map((c) => c.ids.length), [n], 'all: the whole ring is one column');
  const stuck = place(ring, 'frontier');
  assert.deepStrictEqual(stuck.columns.map((c) => [c.label, c.ids.length]), [['ready now', 0], ['loop', n]], 'frontier: nothing is ready, the whole ring is the loop');
});

test('loops of every shape finish: two loops joined, a loop inside a loop, a card waiting for a loop and a loop waiting for a card', () => {
  const cards = [waits(1, 2), waits(2, 3), waits(3, 1, 4), waits(4, 3), waits(5, 4), card(6), waits(7, 6, 5), waits(8, 8)];
  for (const deps of ['frontier', 'all']) {
    const flow = place(cards, deps);
    const placed = flow.columns.flatMap((c) => c.ids).concat(flow.strip ? flow.strip.ids : []);
    assert.deepStrictEqual(placed.slice().sort(), cards.map((c) => c.id).sort(), `${deps}: every card is placed once`);
    assert.ok([...flow.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
});

// --- arrows and marks ----------------------------------------------------------------------

test('an arrow leaves the card waited for to the right and arrives at the rim of the card that waits, from the left', () => {
  const flow = place([card(1), waits(2, 1)], 'all');
  const a = flow.pos.get('1');
  const b = flow.pos.get('2');
  const d = graphFlowPath(flow, '1', '2');
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  assert.deepStrictEqual(nums.slice(0, 2), [a.x, a.y]);
  assert.ok(nums[2] > a.x, 'the first control point lies to the right of the card waited for');
  assert.ok(nums[4] < b.x, 'the second lies to the left of the card that waits');
  assert.strictEqual(nums[7], b.y);
  assert.ok(Math.abs(nums[6] - (b.x - flow.radius.get('2') - 3)) < 0.01, 'the arrow stops at the rim, with room for its head');
});

test('an arrow between two cards of one column, and one that runs back, still draw', () => {
  const flow = place([waits(1, 2), waits(2, 1)], 'frontier');
  for (const [from, to] of [['1', '2'], ['2', '1']]) assert.match(graphFlowPath(flow, from, to), /^M[\d. -]+C[\d. -]+$/);
  const back = place([card(1, { status: 'done', waiting_for: ['2'] }), card(2)], 'frontier');
  assert.match(graphFlowPath(back, '2', '1'), /^M[\d. -]+C[\d. -]+$/);
});

test('the marks are a frame and a heading with the count for each column, and the strip with its count', () => {
  const flow = place([card(1, { status: 'done' }), waits(2, 1), waits(3, 2), card(4), card(5)], 'frontier');
  const marks = graphFlowMarks(flow);
  assert.deepStrictEqual(marks.texts.map((t) => t.text), ['done · 1', 'ready now · 1', '1 step · 1', 'no dependency either way · 2 cards']);
  assert.strictEqual(marks.rects.length, 4);
  assert.ok(marks.rects[0].cls.includes('graph-flow-faded') && marks.texts[0].cls.includes('graph-flow-faded'), 'the done column is faded');
  assert.ok(!marks.rects[1].cls.includes('graph-flow-faded'));
  assert.ok(marks.rects[1].cls.includes('graph-flow-col-alt') && !marks.rects[0].cls.includes('graph-flow-col-alt') && !marks.rects[2].cls.includes('graph-flow-col-alt'), 'the frames alternate');
  const one = graphFlowMarks(place([card(1), card(2)], 'all'));
  assert.deepStrictEqual(one.texts.map((t) => t.text), ['no dependency either way · 2 cards']);
  assert.deepStrictEqual(graphFlowMarks(place([card(1)], 'all')).texts.map((t) => t.text), ['no dependency either way · 1 card']);
});

// --- the address -----------------------------------------------------------------------------

test('the address names the graph and the switch, and anything else reads as nothing', () => {
  assert.deepStrictEqual(graphFlowLink('?view=graph&graph=flow&deps=all'), { graph: 'flow', deps: 'all', lanes: null });
  assert.deepStrictEqual(graphFlowLink('?graph=hierarchy'), { graph: 'hierarchy', deps: null, lanes: null });
  assert.deepStrictEqual(graphFlowLink('?graph=force&deps=open'), { graph: null, deps: null, lanes: null });
  assert.deepStrictEqual(graphFlowLink(''), { graph: null, deps: null, lanes: null });
  assert.deepStrictEqual(graphFlowLink(undefined), { graph: null, deps: null, lanes: null });
});

test('the address becomes graph=flow with the switch, or graph=hierarchy without it, and every other parameter stays', () => {
  assert.strictEqual(graphFlowAddress('', 'flow', 'frontier'), '?graph=flow&deps=frontier&lanes=0');
  assert.strictEqual(graphFlowAddress('?view=graph&q=a+b&card=7', 'flow', 'all'), '?view=graph&q=a+b&card=7&graph=flow&deps=all&lanes=0');
  assert.strictEqual(graphFlowAddress('?graph=flow&deps=all&lanes=0&q=x', 'hierarchy', 'all'), '?graph=hierarchy&q=x');
  assert.strictEqual(graphFlowAddress('?graph=flow&deps=frontier&lanes=0', 'flow', 'all'), '?graph=flow&deps=all&lanes=0');
  assert.strictEqual(graphFlowAddress('?graph=hierarchy', 'hierarchy', 'frontier'), null, 'an address that already says it is left alone');
  assert.strictEqual(graphFlowAddress('?graph=flow&deps=all&lanes=0', 'flow', 'all'), null);
  assert.strictEqual(graphFlowAddress('?graph=flow&deps=all&lanes=0', 'flow', 'sideways'), '?graph=flow&deps=frontier&lanes=0');
  assert.strictEqual(graphFlowAddress('?graph=flow&deps=all', 'radial'), '?graph=hierarchy');
});
