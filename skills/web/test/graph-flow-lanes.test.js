const { test } = require('node:test');
const assert = require('node:assert');

const { graphBuild } = require('../web/graph-model');
const {
  GRAPH_FLOW_GEO, graphFlowPlace, graphFlowMarks, graphFlowLink, graphFlowSetParams, graphFlowDropParams, graphFlowLanesFromText, graphFlowLanesText,
} = require('../web/graph-flow');

// The Flow's Lanes switch at its own seam: which lane a card is in, the header's facts, the order of
// the lanes in both Dependencies modes, the fold of a lane with no open dependency into the strip,
// and that the columns stand across the lanes. Columns and the strip without lanes are pinned in
// graph-flow.test.js.

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const HIERARCHY = ['goal', 'strategy'];
const card = (id, extra = {}) => ({
  id: String(id), title: `card ${id}`, status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, ...extra,
});
const waits = (id, on, extra = {}) => card(id, { waiting_for: [].concat(on).map(String), ...extra });
const build = (cards, visibleIds = null) => graphBuild(cards, { ctx: CTX, hierarchy: HIERARCHY, visibleIds });
const place = (cards, deps = 'frontier', lanes = true, visibleIds = null) => graphFlowPlace(build(cards, visibleIds), { deps, lanes });
const laneIds = (flow) => flow.lanes.map((l) => [l.key, l.ids.slice().sort((a, b) => a - b)]);
const laneOf = (flow, id) => flow.lanes.find((l) => l.ids.includes(String(id)));

// Goal 1 holds tasks 2 and 3 and strategy 4; 4 holds 5 and 6. 7 is a root with no tier and holds 8.
// 2 -> 3 -> 5 -> 6 and 7 -> 8 are the dependencies; 1, 4 and 9 are cards with none.
const forest = () => [
  card(1, { type: 'goal' }), card(2, { parent: 1 }), waits(3, 2, { parent: 1 }), card(4, { parent: 1, type: 'strategy' }),
  waits(5, 3, { parent: 4 }), waits(6, 5, { parent: 4 }), card(7), waits(8, 7, { parent: 7 }), card(9),
];

// --- which lane -----------------------------------------------------------------------

test('each card is in the lane of its nearest parent with a tier, else its root', () => {
  const flow = place(forest(), 'all');
  assert.deepStrictEqual(laneIds(flow), [['1', ['2', '3']], ['4', ['5', '6']], ['7', ['7', '8']]]);
  assert.strictEqual(laneOf(flow, 5).key, '4', 'a card under a strategy is in the strategy\'s lane, not the goal\'s');
  assert.strictEqual(laneOf(flow, 8).key, '7', 'no parent with a tier: the root\'s lane, which the root itself is in');
});

test('a card under a parent without a tier is in the lane of the tier above that', () => {
  const flow = place([
    card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 2 }), waits(4, 3, { parent: 2 }), waits(5, 4, { parent: 1, type: 'strategy' }),
  ], 'all');
  assert.deepStrictEqual(laneIds(flow), [['1', ['3', '4', '5']]]);
});

test('a lane is made of cards with a dependency: the others are in the strip, whatever their lane', () => {
  const flow = place(forest(), 'all');
  assert.deepStrictEqual(flow.strip.ids, ['1', '4', '9']);
  assert.strictEqual(flow.strip.label, 'no dependency either way');
  const placed = flow.lanes.flatMap((l) => l.ids).concat(flow.strip.ids);
  assert.deepStrictEqual(placed.slice().sort(), forest().map((c) => c.id).sort(), 'every card is placed once');
});

test('lanes off is the one lane without a header, whatever the cards\' parents', () => {
  const flow = place(forest(), 'all', false);
  assert.strictEqual(flow.lanes.length, 1);
  assert.deepStrictEqual([flow.lanes[0].key, flow.lanes[0].header], [null, null]);
  assert.deepStrictEqual(graphFlowPlace(build(forest()), { deps: 'all' }).lanes.map((l) => l.header), [null], 'no switch is off');
});

// --- the header -----------------------------------------------------------------------

test('a lane\'s header names its card, the tier of that card, how many cards the lane holds and how many are ready', () => {
  const flow = place(forest(), 'frontier');
  const byKey = Object.fromEntries(flow.lanes.map((l) => [l.key, l.header]));
  assert.deepStrictEqual(byKey['1'], { id: '1', tier: 'goal', count: 2, ready: 1 });
  assert.deepStrictEqual(byKey['4'], { id: '4', tier: 'strategy', count: 2, ready: 0 });
  assert.deepStrictEqual(byKey['7'], { id: '7', tier: '', count: 2, ready: 1 }, 'no tier, no tier name');
});

test('a card is ready when it is open, in no loop and waits for nothing that is not done', () => {
  const flow = place([
    card(1, { type: 'goal' }), card(2, { parent: 1, status: 'done' }), waits(3, 2, { parent: 1 }), waits(4, 3, { parent: 1 }),
    waits(5, 6, { parent: 1 }), waits(6, 5, { parent: 1 }),
  ], 'frontier');
  assert.deepStrictEqual(flow.lanes[0].header, { id: '1', tier: 'goal', count: 5, ready: 1 });
});

test('the ready count is the same in all, which counts the done dependencies for its columns only', () => {
  const cards = [card(1, { type: 'goal' }), card(2, { parent: 1, status: 'done' }), waits(3, 2, { parent: 1 }), waits(4, 3, { parent: 1 })];
  assert.strictEqual(place(cards, 'all').lanes[0].header.ready, 1);
  assert.strictEqual(place(cards, 'frontier').lanes[0].header.ready, 1);
});

// --- the order of the lanes -------------------------------------------------------------

test('frontier: the lanes with ready cards come first, most ready first, then the others in outline order', () => {
  const flow = place([
    card(1, { type: 'goal' }), card(2, { parent: 1 }), waits(3, 2, { parent: 1 }),
    card(10, { type: 'goal' }), card(11, { parent: 10 }), card(12, { parent: 10 }), waits(13, [11, 12], { parent: 10 }),
    card(20, { type: 'goal' }), card(21, { parent: 20, status: 'doing' }), waits(22, 21, { parent: 20 }), waits(23, 22, { parent: 20 }),
    card(30, { type: 'goal' }), card(31, { parent: 30, status: 'done' }), waits(32, 31, { parent: 30, status: 'doing' }),
    card(40, { type: 'goal' }), waits(41, 42, { parent: 40 }), waits(42, 41, { parent: 40 }),
  ], 'frontier');
  assert.deepStrictEqual(flow.lanes.map((l) => [l.key, l.header.ready]), [['10', 2], ['1', 1], ['20', 1], ['30', 1], ['40', 0]]);
});

test('all: the lanes are in outline order, whatever is ready', () => {
  const flow = place([
    card(40, { type: 'goal' }), waits(41, 42, { parent: 40 }), waits(42, 41, { parent: 40 }),
    card(10, { type: 'goal' }), card(11, { parent: 10 }), card(12, { parent: 10 }), waits(13, [11, 12], { parent: 10 }),
    card(1, { type: 'goal' }), card(2, { parent: 1 }), waits(3, 2, { parent: 1 }),
  ], 'all');
  assert.deepStrictEqual(flow.lanes.map((l) => l.key), ['1', '10', '40']);
});

// --- the fold ---------------------------------------------------------------------------

test('frontier: a lane with no open dependency folds into the strip, which says so and counts its cards', () => {
  const flow = place([
    card(1, { type: 'goal' }), card(2, { parent: 1, status: 'done' }), waits(3, 2, { parent: 1, status: 'done' }),
    card(10, { type: 'goal' }), card(11, { parent: 10 }), waits(12, 11, { parent: 10 }),
    card(20, { parent: 10 }),
  ], 'frontier');
  assert.deepStrictEqual(flow.lanes.map((l) => l.key), ['10']);
  assert.deepStrictEqual(flow.strip.ids, ['1', '2', '3', '10', '20']);
  assert.strictEqual(flow.strip.count, 5);
  assert.strictEqual(flow.strip.label, 'no open dependency');
  assert.strictEqual(graphFlowMarks(flow).texts.at(-1).text, 'no open dependency · 5 cards');
  assert.ok(!flow.columns.some((c) => c.label === 'done'), 'the folded done cards are no column');
});

test('frontier: a lane with one open dependency stays whole, its done cards in the done column', () => {
  const flow = place([card(1, { type: 'goal' }), card(2, { parent: 1, status: 'done' }), waits(3, 2, { parent: 1 })], 'frontier');
  assert.deepStrictEqual(flow.lanes.map((l) => l.key), ['1']);
  assert.deepStrictEqual(flow.columns.map((c) => [c.label, c.ids]), [['done', ['2']], ['ready now', ['3']]]);
});

test('all: a lane of done cards that wait for each other stays, for done dependencies count', () => {
  const flow = place([card(1, { type: 'goal' }), card(2, { parent: 1, status: 'done' }), waits(3, 2, { parent: 1, status: 'done' })], 'all');
  assert.deepStrictEqual(flow.lanes.map((l) => l.key), ['1']);
  assert.deepStrictEqual(flow.strip.ids, ['1']);
});

test('everything folded: no lane and no column, the strip holds the board', () => {
  const flow = place([card(1, { type: 'goal' }), card(2, { parent: 1, status: 'done' }), waits(3, 2, { parent: 1, status: 'done' })], 'frontier');
  assert.deepStrictEqual([flow.lanes, flow.columns], [[], []]);
  assert.strictEqual(flow.strip.count, 3);
  assert.ok([...flow.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('the columns come from the cards in the lanes: a done column with only folded cards is not there', () => {
  const flow = place([
    card(1, { type: 'goal' }), card(2, { parent: 1, status: 'done' }), waits(3, 2, { parent: 1, status: 'done' }),
    card(10, { type: 'goal' }), card(11, { parent: 10 }), waits(12, 11, { parent: 10 }),
  ], 'frontier');
  assert.deepStrictEqual(flow.columns.map((c) => c.label), ['ready now', '1 step']);
});

// --- the places ---------------------------------------------------------------------------

test('the columns stand across the lanes: a card is in the frame of its column whichever lane it is in', () => {
  const flow = place(forest(), 'all');
  for (const col of flow.columns) {
    for (const id of col.ids) {
      const p = flow.pos.get(id);
      assert.ok(p.x > col.x && p.x < col.x + col.w, `card ${id} is in the frame of its column`);
    }
  }
  assert.ok(flow.columns.some((c) => new Set(c.ids.map((id) => laneOf(flow, id).key)).size > 1), 'a column holds cards of more than one lane');
});

test('the lanes run top to bottom without overlap, each card under its header, and the columns frame all of them', () => {
  const flow = place(forest(), 'all');
  const { LANE_HEAD } = GRAPH_FLOW_GEO;
  flow.lanes.forEach((lane, i) => {
    if (i) assert.ok(lane.y >= flow.lanes[i - 1].y + flow.lanes[i - 1].h, `lane ${i} starts below lane ${i - 1}`);
    for (const id of lane.ids) {
      const p = flow.pos.get(id);
      assert.ok(p.y > lane.y + LANE_HEAD && p.y < lane.y + lane.h, `card ${id} is under the header, inside its lane`);
    }
  });
  const last = flow.lanes.at(-1);
  for (const c of flow.columns) assert.ok(c.y + c.h >= last.y + last.h, 'a column frames the last lane');
  assert.ok(flow.strip.y > last.y + last.h, 'the strip is below the last lane');
});

test('a lane is as wide as the columns, and the bounds hold every lane', () => {
  const flow = place(forest(), 'frontier');
  const first = flow.columns[0];
  const lastCol = flow.columns.at(-1);
  for (const lane of flow.lanes) {
    assert.strictEqual(lane.x, first.x);
    assert.strictEqual(lane.x + lane.w, lastCol.x + lastCol.w);
    assert.ok(flow.boxes.some((b) => b.x0 <= lane.x && b.x1 >= lane.x + lane.w && b.y0 <= lane.y && b.y1 >= lane.y + lane.h));
  }
});

test('the same cards and switches always give the same places', () => {
  const plain = (f) => JSON.stringify({ ...f, pos: [...f.pos], radius: [...f.radius] });
  for (const deps of ['frontier', 'all']) assert.strictEqual(plain(place(forest(), deps)), plain(place(forest(), deps)), deps);
  assert.notStrictEqual(plain(place(forest(), 'all', true)), plain(place(forest(), 'all', false)));
});

test('a hidden card leaves its lane, and a card left with no dependency goes to the strip', () => {
  const flow = place(forest(), 'all', true, new Set(['1', '2', '3', '4', '5', '6', '7']));
  assert.deepStrictEqual(laneIds(flow), [['1', ['2', '3']], ['4', ['5', '6']]]);
  assert.deepStrictEqual(flow.strip.ids, ['1', '4', '7']);
});

test('loops across lanes finish: every card is placed once', () => {
  const cards = [
    card(1, { type: 'goal' }), waits(2, 3, { parent: 1 }), card(10, { type: 'goal' }), waits(3, 2, { parent: 10 }), waits(4, 3, { parent: 10 }), waits(5, 5, { parent: 10 }),
  ];
  for (const deps of ['frontier', 'all']) {
    const flow = place(cards, deps);
    const placed = flow.lanes.flatMap((l) => l.ids).concat(flow.strip ? flow.strip.ids : []);
    assert.deepStrictEqual(placed.slice().sort(), cards.map((c) => c.id).sort(), deps);
    assert.ok([...flow.pos.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
});

test('a long chain in a lane costs no deep recursion', () => {
  const n = 4000;
  const cards = [card(1, { type: 'goal' }), card(2, { parent: 1 })];
  for (let i = 3; i <= n; i++) cards.push(waits(i, i - 1, { parent: 1 }));
  assert.strictEqual(place(cards, 'all').columns.length, n - 1);
});

// --- the marks ------------------------------------------------------------------------------

test('with lanes the marks are a frame for each lane with its header, a heading for each column, and no column frames', () => {
  const flow = place(forest(), 'frontier');
  const marks = graphFlowMarks(flow);
  assert.deepStrictEqual(marks.rects.map((r) => r.cls), ['graph-flow-lane', 'graph-flow-lane', 'graph-flow-lane', 'graph-flow-strip']);
  assert.deepStrictEqual(marks.texts.map((t) => t.text), ['ready now · 2', '1 step · 2', '2 steps · 1', '3 steps · 1', 'no open dependency · 3 cards']);
  assert.deepStrictEqual(marks.heads.map((h) => h.id), flow.lanes.map((l) => l.key));
  marks.heads.forEach((h, i) => {
    assert.strictEqual(h.x, flow.lanes[i].x + 10);
    assert.ok(h.y > flow.lanes[i].y && h.y < flow.lanes[i].y + GRAPH_FLOW_GEO.LANE_HEAD);
  });
});

test('a header reads its tier, #id title, the cards and the ready ones; the type\'s mark and the tip come from the caller', () => {
  const flow = place(forest(), 'frontier');
  const look = {
    titleOf: (id) => `Title of ${id}`,
    tipOf: (id) => `#${id} Title of ${id} (todo)`,
    markOf: (id) => (id === '1' ? { d: 'M0 0', color: 'red' } : null),
  };
  const byId = Object.fromEntries(graphFlowMarks(flow, look).heads.map((h) => [h.id, h]));
  assert.strictEqual(byId['1'].text, 'goal · #1 Title of 1 · 2 cards · 1 ready');
  assert.strictEqual(byId['4'].text, 'strategy · #4 Title of 4 · 2 cards · 0 ready');
  assert.strictEqual(byId['7'].text, '#7 Title of 7 · 2 cards · 1 ready', 'no tier, no tier name');
  assert.deepStrictEqual(byId['1'].icon, { d: 'M0 0', color: 'red' });
  assert.strictEqual(byId['4'].icon, null);
  assert.strictEqual(byId['1'].title, '#1 Title of 1 (todo)');
  assert.strictEqual(graphFlowMarks(flow).heads.find((h) => h.id === '1').text, 'goal · #1 · 2 cards · 1 ready');
});

test('a long title is cut in the header, and a lane of one card says card', () => {
  const flow = place([card(1, { type: 'goal' }), card(2, { parent: 1 }), card(10, { type: 'goal' }), waits(3, 2, { parent: 10 })], 'all');
  const text = graphFlowMarks(flow, { titleOf: () => 'x'.repeat(200) }).heads[0].text;
  assert.ok(text.length < 100 && text.includes('…') && text.includes('1 card ·'), text);
});

test('without lanes the marks are as before, and carry no header', () => {
  const marks = graphFlowMarks(place(forest(), 'frontier', false));
  assert.deepStrictEqual(marks.heads, []);
  assert.ok(marks.rects.some((r) => r.cls.startsWith('graph-flow-col')));
  assert.ok(!marks.rects.some((r) => r.cls === 'graph-flow-lane'));
});

// --- the address ------------------------------------------------------------------------------

test('the switch is read from lanes=0|1 and anything else reads as nothing', () => {
  assert.strictEqual(graphFlowLink('?graph=flow&lanes=1').lanes, true);
  assert.strictEqual(graphFlowLink('?graph=flow&lanes=0').lanes, false);
  for (const bad of ['?lanes=2', '?lanes=on', '?lanes=', '', undefined]) assert.strictEqual(graphFlowLink(bad).lanes, null, String(bad));
});

test('the switch is a boolean in the code and the text 1 or 0 at the edges, in storage and in the address alike', () => {
  assert.strictEqual(graphFlowLanesFromText('1'), true);
  assert.strictEqual(graphFlowLanesFromText('0'), false);
  for (const bad of [undefined, null, 'yes', true, 2, '']) assert.strictEqual(graphFlowLanesFromText(bad), null, String(bad));
  assert.strictEqual(graphFlowLanesText(true), '1');
  for (const off of [false, undefined, null, '1', 1]) assert.strictEqual(graphFlowLanesText(off), '0', String(off));
});

test('the Flow\'s switches go into the parameters of an address and come out of them, and nothing else is touched', () => {
  const set = (search, deps, laned) => {
    const params = new URLSearchParams(search);
    const changed = graphFlowSetParams(params, deps, laned);
    return [changed, params.toString()];
  };
  assert.deepStrictEqual(set('', 'frontier', false), [true, 'deps=frontier&lanes=0']);
  assert.deepStrictEqual(set('view=graph&graph=flow&deps=all', 'all', true), [true, 'view=graph&graph=flow&deps=all&lanes=1']);
  assert.deepStrictEqual(set('graph=flow&deps=all&lanes=1', 'all', false), [true, 'graph=flow&deps=all&lanes=0']);
  assert.deepStrictEqual(set('graph=flow&deps=all&lanes=1', 'all', true), [false, 'graph=flow&deps=all&lanes=1']);
  assert.deepStrictEqual(set('graph=flow&deps=all', 'all'), [true, 'graph=flow&deps=all&lanes=0'], 'no lanes given is off');
  assert.deepStrictEqual(set('deps=all&lanes=1', 'sideways', true), [true, 'deps=frontier&lanes=1']);
  const drop = (search) => {
    const params = new URLSearchParams(search);
    return [graphFlowDropParams(params), params.toString()];
  };
  assert.deepStrictEqual(drop('graph=flow&deps=all&lanes=1&q=x'), [true, 'graph=flow&q=x']);
  assert.deepStrictEqual(drop('graph=hierarchy&q=x'), [false, 'graph=hierarchy&q=x']);
});
