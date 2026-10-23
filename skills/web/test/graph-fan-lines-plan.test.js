const { test } = require('node:test');
const assert = require('node:assert');

const {
  graphLayout, graphPlan, graphLit, graphRestLit, graphFanLines, graphFanBus, graphFanMarks, graphRadius,
  GRAPH_FAN_REACH, GRAPH_FAN_BUS_BESIDE, GRAPH_FAN_STEM_MARGIN,
} = require('../web/graph-model');
const { card, buildOf } = require('./helpers/fan-boards');

// What the plan draws of the fan's lines: the lines graphFanLines lists, each with its
// path, and for the counted line of the brackets group a bracket: a stem out from the parent,
// one arc through the children's angles, a tick to each child, and a label with the
// count. The page draws the plan; this holds what the plan says.

const STATUSES = ['backlog', 'todo', 'doing', 'done'];
const DEFAULTS = { lines: 'chain', group: 'brackets', dependencies: 'on', order: 'status' };

// 1 goal; 2 strategy; 3, 4 (waits for 3), 5, 6 untyped children of 1; 7, 8 untyped
// children of 2, card 8 waiting for card 5; 9 alone. Cards 5 and 6 share a ring, as do
// 7 and 8, so brackets carry the chain ends of each ring on one counted line.
const tree = () => buildOf([
  card(1, { type: 'goal' }), card(2, { type: 'strategy', parent: 1 }), card(3, { parent: 1 }),
  card(4, { parent: 1, waiting_for: ['3'] }), card(5, { parent: 1 }), card(6, { parent: 1 }),
  card(7, { parent: 2 }), card(8, { parent: 2, waiting_for: ['5'] }), card(9),
]);

const planOf = (model, fan, kind = 'hierarchy') => {
  const layout = graphLayout(model, kind, { statuses: STATUSES });
  const opts = { kind, statusClass: (s) => s, titleOf: (c) => c.title };
  if (fan) opts.fan = { ...DEFAULTS, ...fan };
  return { layout, plan: graphPlan(model, layout, opts) };
};
const kinds = (plan) => ({
  parent: plan.links.filter((l) => l.kind === 'parent').length,
  wait: plan.links.filter((l) => l.kind === 'wait').length,
});
const ends = (plan, indexes) => [...indexes].map((i) => `${plan.links[i].from}>${plan.links[i].to}`).sort();

test('the plan draws as many lines as the options say: chain 3 with brackets and 6 with lines, all 3 with brackets and 7 with lines, off 0, and 2 arrows', () => {
  const model = tree();
  for (const [lines, group, parent] of [['chain', 'brackets', 3], ['chain', 'lines', 6], ['all', 'brackets', 3], ['all', 'lines', 7], ['off', 'brackets', 0], ['off', 'lines', 0]]) {
    assert.deepStrictEqual(kinds(planOf(model, { lines, group }).plan), { parent, wait: 2 }, `${lines} ${group}`);
  }
});

test('dependencies off draws no arrow and keeps the parent lines', () => {
  const model = tree();
  assert.deepStrictEqual(kinds(planOf(model, { dependencies: 'off' }).plan), { parent: 3, wait: 0 });
  assert.deepStrictEqual(kinds(planOf(model, { lines: 'off', dependencies: 'off' }).plan), { parent: 0, wait: 0 });
});

test('a plan with no options draws every relation', () => {
  const model = tree();
  assert.deepStrictEqual(kinds(planOf(model, null).plan), { parent: 7, wait: 2 });
});

test('an arrow is a dashed line with a head; a parent line, counted or not, has none', () => {
  const { plan } = planOf(tree(), {});
  for (const l of plan.links) assert.strictEqual(l.arrow, l.kind === 'wait', `${l.from}>${l.to}`);
});

test('the counted line is one plan line with its count and a label, and its classes tell it from the others', () => {
  const { plan } = planOf(tree(), {});
  const counted = plan.links.filter((l) => l.count !== undefined);
  assert.deepStrictEqual(counted.map((l) => [l.from, l.to, l.count, l.label.text]), [['2', '2', 2, '2'], ['1', '1', 3, '3']]);
  for (const l of counted) {
    const cls = l.cls.split(' ');
    assert.ok(cls.includes('graph-link-counted') && cls.includes('graph-link-parent') && cls.includes('graph-link'));
    assert.ok(Number.isFinite(l.label.x) && Number.isFinite(l.label.y));
  }
  for (const l of plan.links.filter((x) => x.count === undefined)) assert.strictEqual(l.label, undefined, 'only a counted line has a label');
});

const NUM = '-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?';

test('the counted line runs from its parent along one arc to a tick on each child', () => {
  const { plan, layout } = planOf(tree(), {});
  const at = (id) => layout.pos.get(String(id));
  const round = (v) => Math.round(v * 100) / 100;
  const radiusOf = (id) => Math.hypot(at(id).x, at(id).y);
  const counted = plan.links.find((l) => l.count !== undefined && l.from === '1');
  const numbers = counted.d.match(new RegExp(NUM, 'g')).map(Number);
  assert.ok(numbers.every(Number.isFinite));
  assert.match(counted.d, /^M/);
  assert.deepStrictEqual(numbers.slice(0, 2), [round(at(1).x), round(at(1).y)], 'the line starts on its parent');
  const ticks = [...counted.d.matchAll(new RegExp(`[ML](${NUM}) (${NUM})`, 'g'))].map((m) => [Number(m[1]), Number(m[2])]);
  for (const kid of ['4', '5', '6']) {
    assert.ok(ticks.some(([x, y]) => x === round(at(kid).x) && y === round(at(kid).y)), `a tick ends on card ${kid}`);
  }
  assert.strictEqual((counted.d.match(/A/g) || []).length, 1, 'one arc through the children');
  for (const kid of ['4', '6']) assert.ok(Math.abs(radiusOf(5) - radiusOf(kid)) < 0.01, 'the children are on one ring');
  const arc = new RegExp(`L(${NUM}) (${NUM})A(${NUM}) (${NUM}) 0 (\\d) (\\d) (${NUM}) (${NUM})`).exec(counted.d);
  assert.ok(arc, 'the arc has the shape the SVG path takes');
  const radius = Number(arc[3]);
  assert.ok(radius < radiusOf(5) && radius > radiusOf(1), 'the arc lies between the parent\'s ring and the children\'s');
  assert.ok(Math.abs(Math.hypot(Number(arc[1]), Number(arc[2])) - radius) < 0.1, 'the arc starts on its circle');
  assert.ok(Math.abs(Math.hypot(Number(arc[7]), Number(arc[8])) - radius) < 0.1, 'and ends on it');
});

test('the label of a counted line sits on the line, on the circle of its arc', () => {
  const { plan } = planOf(tree(), {});
  const counted = plan.links.filter((x) => x.count !== undefined);
  assert.strictEqual(counted.length, 2);
  for (const l of counted) {
    const radius = Number(new RegExp(`A(${NUM}) `).exec(l.d)[1]);
    assert.ok(Math.abs(Math.hypot(l.label.x, l.label.y) - radius) < 0.1, `card ${l.from}`);
  }
});

test('a line toggle moves no card: the dots are where they were whatever the lines', () => {
  const model = tree();
  const where = (fan) => JSON.stringify(planOf(model, fan).plan.nodes.map((n) => [n.id, n.x, n.y]));
  const base = where({});
  for (const lines of ['chain', 'all', 'off']) for (const group of ['brackets', 'lines']) assert.strictEqual(where({ lines, group, dependencies: 'off' }), base, `${lines} ${group}`);
});

test('every path the plan draws has finite numbers, for every option', () => {
  const model = tree();
  for (const lines of ['chain', 'all', 'off']) {
    for (const group of ['brackets', 'lines']) {
      for (const dependencies of ['on', 'off']) {
        for (const l of planOf(model, { lines, group, dependencies }).plan.links) assert.doesNotMatch(l.d, /NaN|Infinity|undefined/, `${lines} ${group} ${dependencies}`);
      }
    }
  }
});

// --- lighting reads the lines that are drawn ---------------------------------------

test('lighting names the lines among the cards it lights, by their place in the list of drawn lines', () => {
  const model = tree();
  const { plan } = planOf(model, {});
  const all = graphLit(model, ['1', '2', '3', '4', '5', '6', '7', '8'], plan.links);
  assert.deepStrictEqual([...all.links].sort((a, b) => a - b), plan.links.map((_, i) => i), 'every card lit: every drawn line lit');
  assert.deepStrictEqual(ends(plan, graphLit(model, ['1', '5'], plan.links).links), ['1>1'], 'the counted line lights with its parent alone, though no child of it is lit');
});

test('a counted line lights whenever its parent does, a line to one child only when both ends do', () => {
  const model = tree();
  const { plan } = planOf(model, {});
  const lines = (ids) => ends(plan, graphLit(model, ids, plan.links).links);
  assert.deepStrictEqual(lines(['2']), ['2>2']);
  assert.deepStrictEqual(lines(['1', '2']), ['1>1', '1>2', '2>2']);
  assert.deepStrictEqual(lines(['4']), []);
  assert.deepStrictEqual(lines(['1', '4']), ['1>1'], 'a child on a bracket has no line of its own');
  assert.deepStrictEqual(lines(['3', '4']), ['3>4']);
});

test('lighting with no list of lines reads the model\'s relations, as before', () => {
  const model = tree();
  assert.deepStrictEqual([...graphLit(model, ['1', '2']).links].map((i) => model.links[i].kind), ['parent']);
  const rest = graphRestLit(model, { selectedIds: new Set(['1', '2']), loneCardId: null });
  assert.deepStrictEqual([...rest.links].map((i) => model.links[i].kind), ['parent']);
});

test('a lone card lights the lines drawn to its neighbours: card 4 with chain lines lights its two', () => {
  const model = tree();
  const { plan } = planOf(model, { lines: 'chain', group: 'lines' });
  const rest = graphRestLit(model, { selectedIds: new Set(['4']), loneCardId: '4' }, plan.links);
  assert.deepStrictEqual(ends(plan, rest.links), ['1>4', '3>4']);
});

// --- the brackets group -------------------------------------------------------------

const withLines = (model, fan = {}, order = 'status') => {
  const layout = graphLayout(model, 'hierarchy', { statuses: STATUSES, order });
  const plan = graphPlan(model, layout, { kind: 'hierarchy', statusClass: (s) => s, titleOf: (c) => c.title, fan: { ...DEFAULTS, ...fan, order } });
  return { layout, plan };
};
const angleOf = (x, y) => Math.atan2(y, x);
const same = (a, b) => Math.abs(Math.sin((a - b) / 2)) < 0.005;

test('all with brackets draws 3 parent lines of the tree and its 2 arrows: one bracket over cards 3 to 6, one over 7 and 8, a plain line to card 2', () => {
  const { plan } = withLines(tree(), { lines: 'all' });
  assert.deepStrictEqual(kinds(plan), { parent: 3, wait: 2 });
  const counted = plan.links.filter((l) => l.count !== undefined);
  assert.deepStrictEqual(counted.map((l) => [l.from, l.to, l.count, l.label.text]), [['2', '2', 2, '2'], ['1', '1', 4, '4']]);
  for (const l of counted) {
    const cls = l.cls.split(' ');
    assert.ok(cls.includes('graph-link-counted') && cls.includes('graph-link-parent') && cls.includes('graph-link'));
    assert.strictEqual(l.arrow, false);
  }
});

test('a bracket lights with its parent alone, and a child on it lights nothing of its own', () => {
  const model = tree();
  const { plan } = withLines(model, {});
  const lines = (ids) => ends(plan, graphLit(model, ids, plan.links).links);
  assert.deepStrictEqual(lines(['1']), ['1>1']);
  assert.deepStrictEqual(lines(['1', '4']), ['1>1']);
  assert.deepStrictEqual(lines(['3', '4']), ['3>4'], 'the arrow between two children still needs both');
  assert.deepStrictEqual(lines(['4']), []);
});

// Card 1's children 2 to 5 share a ring and a bracket; their statuses seat them one way by
// status and another by rank.
const seated = () => buildOf([
  card(1, { type: 'goal' }), card(2, { parent: 1, status: 'done' }), card(3, { parent: 1, status: 'todo' }),
  card(4, { parent: 1, status: 'doing' }), card(5, { parent: 1, status: 'backlog' }),
]);

test('a bracket is one arc from the first child to the last, a tick to each child and one stem to the parent, under either order', () => {
  for (const [order, first, last] of [['rank', '2', '5'], ['status', '4', '2']]) {
    const { layout, plan } = withLines(seated(), {}, order);
    const lines = plan.links.filter((l) => l.count !== undefined);
    assert.strictEqual(lines.length, 1, `${order}: one bracket for the four children`);
    const [line] = lines;
    assert.strictEqual(line.count, 4);
    const start = new RegExp(`L(${NUM}) (${NUM})A`).exec(line.d);
    const arc = new RegExp(`A${NUM} ${NUM} 0 \\d \\d (${NUM}) (${NUM})`).exec(line.d);
    const ends = [angleOf(Number(start[1]), Number(start[2])), angleOf(Number(arc[1]), Number(arc[2]))];
    const seats = ['2', '3', '4', '5'].sort((x, y) => layout.polar.get(y).a - layout.polar.get(x).a);
    assert.deepStrictEqual([seats[0], seats[3]], [first, last], `${order}: the first and last seats`);
    assert.ok(same(ends[1], layout.polar.get(first).a) && same(ends[0], layout.polar.get(last).a), `${order}: the arc's ends are the first and last child's angles`);
    assert.strictEqual((line.d.match(/A/g) || []).length, 1, `${order}: one arc`);
    const parentAt = layout.pos.get('1');
    const stems = [...line.d.matchAll(new RegExp(`M(${NUM}) (${NUM})L`, 'g'))].filter((m) => Math.abs(Number(m[1]) - parentAt.x) < 0.01 && Math.abs(Number(m[2]) - parentAt.y) < 0.01);
    assert.strictEqual(stems.length, 1, `${order}: one stem leaves the parent`);
    assert.strictEqual((line.d.match(/M/g) || []).length, 2 + 4 - 2, `${order}: the stem, the hooked arc that carries the first and last child's ticks, and a tick for each child between`);
  }
});

// The stem of a counted line: its two ends, the parent's and the arc's.
const stemOf = (line) => {
  const m = new RegExp(`^M(${NUM}) (${NUM})L(${NUM}) (${NUM})`).exec(line.d);
  return { px: Number(m[1]), py: Number(m[2]), ex: Number(m[3]), ey: Number(m[4]) };
};
const toSegment = (s, x, y) => {
  const dx = s.ex - s.px;
  const dy = s.ey - s.py;
  const t = Math.max(0, Math.min(1, ((x - s.px) * dx + (y - s.py) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(s.px + dx * t - x, s.py + dy * t - y);
};
const midsOf = (layout, ids) => {
  const a = ids.map((id) => layout.polar.get(id).a).sort((x, y) => x - y);
  return a.slice(1).map((v, i) => (v + a[i]) / 2);
};

test('the stem of a parent among its children meets the arc in the gap nearest its angle, never on a child', () => {
  const { layout, plan } = withLines(seated(), {}, 'rank');
  const line = plan.links.find((l) => l.count !== undefined);
  const kids = ['2', '3', '4', '5'].map((id) => layout.polar.get(id).a).sort((x, y) => x - y);
  const parent = layout.polar.get('1').a;
  assert.ok(parent >= kids[0] - 1e-6 && parent <= kids[3] + 1e-6, 'a parent stands among its children here');
  const s = stemOf(line);
  const end = angleOf(s.ex, s.ey);
  const nearest = midsOf(layout, ['2', '3', '4', '5']).sort((x, y) => Math.abs(x - parent) - Math.abs(y - parent))[0];
  assert.ok(same(end, nearest), 'the stem ends at the middle of the gap nearest the parent');
  for (const a of kids) assert.ok(!same(end, a), 'and not at a child\'s angle');
});

// Card 1 stands at the angle of its strategy 4, itself at the middle of its three children 5 to 7,
// and the goal's four untyped children 2, 3, 8 and 9 are on the ring those three share: a goal's
// stem along its own ray would run through card 4's mark and end beside card 6.
const crossed = () => buildOf([
  card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { type: 'strategy', parent: 1 }),
  card(5, { parent: 4 }), card(6, { parent: 4 }), card(7, { parent: 4 }), card(8, { parent: 1 }), card(9, { parent: 1 }),
]);
const reachOf = (model, id) => graphRadius(model.byId.get(id)) * GRAPH_FAN_REACH;
const countedOf = (model, layout, from) => graphFanLines(model, layout.places, { ...DEFAULTS, lines: 'all' }).find((l) => l.kids && l.from === from);

test('no stem ends within a child\'s reach of a child, and every stem keeps its margin clear of every mark but its parent\'s', () => {
  const model = crossed();
  const { layout, plan } = withLines(model, {});
  const brackets = plan.links.filter((l) => l.count !== undefined);
  assert.deepStrictEqual(brackets.map((l) => [l.from, l.count]).sort(), [['1', 4], ['4', 3]]);
  assert.ok(same(layout.polar.get('1').a, layout.polar.get('4').a) && same(layout.polar.get('4').a, layout.polar.get('6').a), 'cards 1, 4 and 6 stand on one ray');
  for (const l of brackets) {
    const s = stemOf(l);
    for (const k of countedOf(model, layout, l.from).kids) {
      const at = layout.pos.get(k);
      assert.ok(Math.hypot(s.ex - at.x, s.ey - at.y) >= reachOf(model, k), `card ${l.from}'s stem ends within card ${k}'s reach`);
      assert.ok(!same(angleOf(s.ex, s.ey), layout.polar.get(k).a), `card ${l.from}'s stem ends at card ${k}'s angle`);
    }
    for (const n of model.nodes) {
      if (n.id === l.from) continue;
      const at = layout.pos.get(n.id);
      assert.ok(toSegment(s, at.x, at.y) >= reachOf(model, n.id) + GRAPH_FAN_STEM_MARGIN - 1e-6, `card ${l.from}'s stem passes too close to card ${n.id}`);
    }
  }
});

test('a stem takes the nearest gap whose line is clear, and the next nearest when a mark is in the way', () => {
  const model = crossed();
  const { layout } = withLines(model, {});
  const line = countedOf(model, layout, '1');
  const parent = layout.polar.get('1').a;
  const free = stemOf(graphFanBus(layout, line, false, []));
  assert.ok(same(angleOf(free.ex, free.ey), parent), 'with nothing in the way the nearest gap is the one on the parent\'s own ray');
  const around = stemOf(graphFanBus(layout, line, false, graphFanMarks(model, layout)));
  const second = midsOf(layout, line.kids).sort((x, y) => Math.abs(x - parent) - Math.abs(y - parent))[1];
  assert.ok(same(angleOf(around.ex, around.ey), second), 'card 4\'s mark blocks that gap, so the stem takes the second nearest');
});

test('a bracket with no clear gap takes the nearest gap', () => {
  const model = crossed();
  const { layout } = withLines(model, {});
  const wall = [{ id: 'wall', x: 0, y: 0, clear: 1e6 }];
  const s = stemOf(graphFanBus(layout, countedOf(model, layout, '1'), false, wall));
  assert.ok(same(angleOf(s.ex, s.ey), layout.polar.get('1').a));
});

test('the arc does not run on to the parent when the parent stands outside its children: the stem reaches the gap nearer to it', () => {
  const model = buildOf([
    card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 1 }), card(5, { type: 'strategy', parent: 1 }),
    card(6, { parent: 5 }), card(7, { parent: 5 }), card(8, { parent: 5 }), card(9, { parent: 5 }),
  ]);
  const { layout, plan } = withLines(model, {});
  const line = plan.links.find((l) => l.count !== undefined && l.from === '1');
  assert.strictEqual(line && line.count, 3, 'cards 2 to 4 share a ring');
  const kids = ['2', '3', '4'].map((id) => layout.polar.get(id).a).sort((x, y) => x - y);
  const parent = layout.polar.get('1').a;
  assert.ok(parent < kids[0] - 0.01 || parent > kids[2] + 0.01, 'card 5 and its children push the parent off the span of cards 2 to 4');
  const near = midsOf(layout, ['2', '3', '4']).sort((x, y) => Math.abs(x - parent) - Math.abs(y - parent))[0];
  const s = stemOf(line);
  assert.ok(same(angleOf(s.ex, s.ey), near), 'the stem ends in the gap nearer the parent');
  const arc = new RegExp(`A${NUM} ${NUM} 0 \\d \\d (${NUM}) (${NUM})`).exec(line.d);
  const start = new RegExp(`L(${NUM}) (${NUM})A`).exec(line.d);
  assert.ok(same(angleOf(Number(start[1]), Number(start[2])), kids[0]) && same(angleOf(Number(arc[1]), Number(arc[2])), kids[2]), 'and the arc spans the children alone');
});

test('children all at one angle keep the stem on the parent\'s ray to the arc', () => {
  const polar = new Map([['p', { r: 100, a: 1 }], ['a', { r: 200, a: 1.4 }], ['b', { r: 200, a: 1.4 }]]);
  const bus = graphFanBus({ polar }, { from: 'p', kids: ['a', 'b'], count: 2 }, false, []);
  const turn = 200 - 27;
  const r = (v) => Math.round(v * 100) / 100;
  assert.ok(bus.d.startsWith(`M${r(Math.cos(1) * 100)} ${r(Math.sin(1) * 100)}L${r(Math.cos(1.4) * turn)} ${r(Math.sin(1.4) * turn)}`));
  assert.ok(Number.isFinite(bus.label.x) && Number.isFinite(bus.label.y));
});

test('the count sits in the free gap nearest the stem, never the stem\'s own gap', () => {
  const { layout, plan } = withLines(seated(), {}, 'rank');
  const line = plan.links.find((l) => l.count !== undefined);
  const s = stemOf(line);
  const mids = midsOf(layout, ['2', '3', '4', '5']);
  const label = angleOf(line.label.x, line.label.y);
  const stem = angleOf(s.ex, s.ey);
  assert.ok(!same(label, stem), 'not where the stem meets the arc');
  const others = mids.filter((m) => !same(m, stem)).sort((x, y) => Math.abs(x - stem) - Math.abs(y - stem));
  assert.ok(same(label, others[0]), 'the middle of the gap nearest the stem');
});

test('with no other gap wide enough the count sits on the arc beside the junction, not on it', () => {
  const { layout, plan } = withLines(buildOf([card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 1 })]), {});
  const line = plan.links.find((l) => l.count !== undefined);
  const s = stemOf(line);
  assert.ok(Math.abs(Math.hypot(line.label.x, line.label.y) - Math.hypot(s.ex, s.ey)) < 0.1, 'on the arc');
  const apart = Math.hypot(line.label.x - s.ex, line.label.y - s.ey);
  assert.ok(Math.abs(apart - GRAPH_FAN_BUS_BESIDE) < 0.5, `${apart} from the junction`);
  const kids = ['2', '3'].map((id) => layout.polar.get(id).a).sort((x, y) => x - y);
  const label = angleOf(line.label.x, line.label.y);
  assert.ok(label > kids[0] && label < kids[1], 'still between the two children');
});

test('a child alone on its ring keeps a plain line to the parent, with no label', () => {
  const model = buildOf([card(1, { type: 'goal' }), card(2, { parent: 1 })]);
  const { plan } = withLines(model, {});
  assert.deepStrictEqual(plan.links.map((l) => [l.from, l.to, l.count, l.label]), [['1', '2', undefined, undefined]]);
});

test('the label of a bracket sits on the circle of its arc, and every path has finite numbers', () => {
  const { plan } = withLines(tree(), {});
  for (const l of plan.links) assert.doesNotMatch(l.d, /NaN|Infinity|undefined/);
  for (const l of plan.links.filter((x) => x.count !== undefined)) {
    const radius = Number(new RegExp(`A(${NUM}) `).exec(l.d)[1]);
    assert.ok(Math.abs(Math.hypot(l.label.x, l.label.y) - radius) < 0.1, `card ${l.from}`);
  }
});

test('group lines draws each child its own plain line: no bracket, no label, no counted class', () => {
  const { plan } = withLines(tree(), { group: 'lines' });
  assert.deepStrictEqual(kinds(plan), { parent: 6, wait: 2 });
  for (const l of plan.links) {
    assert.strictEqual(l.count, undefined);
    assert.strictEqual(l.label, undefined);
    assert.ok(!l.cls.includes('graph-link-counted'));
    assert.strictEqual((l.d.match(/M/g) || []).length, 1, 'a plain line is one piece');
  }
});

// --- brackets side by side, and their hooked ends ----------------------------------------

const arcRadius = (l) => Number(new RegExp(`A(${NUM}) `).exec(l.d)[1]);

// Three goals, each with two untyped children: the six children share one ring and the three
// brackets stand side by side along it.
const sideBySide = () => buildOf([
  card(1, { type: 'goal' }), card(2, { type: 'goal' }), card(3, { type: 'goal' }),
  card(4, { parent: 1 }), card(5, { parent: 1 }), card(6, { parent: 2 }), card(7, { parent: 2 }), card(8, { parent: 3 }), card(9, { parent: 3 }),
]);

test('brackets side by side on one ring alternate between two insets from the ring, so neighbours never share a radius', () => {
  const { layout, plan } = withLines(sideBySide(), {});
  const brackets = plan.links.filter((l) => l.count !== undefined);
  assert.strictEqual(brackets.length, 3);
  const ring = Math.hypot(layout.pos.get('4').x, layout.pos.get('4').y);
  const kidOf = { 1: '4', 2: '6', 3: '8' };
  const ordered = brackets.slice().sort((x, y) => layout.polar.get(kidOf[x.from]).a - layout.polar.get(kidOf[y.from]).a);
  const insets = ordered.map((l) => Math.round((ring - arcRadius(l)) * 100) / 100);
  assert.deepStrictEqual(insets.map((i) => i === 27 || i === 14), [true, true, true], 'two insets only');
  assert.notStrictEqual(insets[0], insets[1]);
  assert.notStrictEqual(insets[1], insets[2]);
  assert.strictEqual(insets[0], insets[2], 'odd and even along the ring');
  assert.strictEqual(insets[0], 27, 'the first bracket of a ring takes the far inset');
});

test('a bracket alone on its ring takes the far inset, and each ring starts its own alternation', () => {
  const model = buildOf([
    card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 2 }), card(5, { parent: 2 }),
  ]);
  const { layout, plan } = withLines(model, {});
  const brackets = plan.links.filter((l) => l.count !== undefined);
  assert.strictEqual(brackets.length, 2);
  for (const l of brackets) {
    const kid = l.from === '1' ? '2' : '4';
    const ring = Math.hypot(layout.pos.get(kid).x, layout.pos.get(kid).y);
    assert.ok(Math.abs(ring - arcRadius(l) - 27) < 0.1, `card ${l.from}`);
  }
  assert.notStrictEqual(Math.round(Math.hypot(layout.pos.get('2').x, layout.pos.get('2').y)), Math.round(Math.hypot(layout.pos.get('4').x, layout.pos.get('4').y)), 'two rings');
});

test('a bracket ends in a hook toward each end child: one stroke from the first child in to the arc, round it and out to the last', () => {
  const { layout, plan } = withLines(seated(), {}, 'rank');
  const line = plan.links.find((l) => l.count !== undefined);
  const hooked = new RegExp(`M(${NUM}) (${NUM})L(${NUM}) (${NUM})A${NUM} ${NUM} 0 \\d 1 (${NUM}) (${NUM})L(${NUM}) (${NUM})`).exec(line.d);
  assert.ok(hooked, 'first child, in to the arc, along it, out to the last child, in one stroke');
  const point = (id) => layout.pos.get(id);
  const ends = ['2', '3', '4', '5'].sort((x, y) => layout.polar.get(x).a - layout.polar.get(y).a);
  const near = (x, y, id) => Math.abs(Number(x) - point(id).x) < 0.01 && Math.abs(Number(y) - point(id).y) < 0.01;
  assert.ok(near(hooked[1], hooked[2], ends[0]), 'the stroke starts on the child with the smallest angle');
  assert.ok(near(hooked[7], hooked[8], ends[3]), 'and ends on the child with the largest');
  const ring = Math.hypot(point(ends[0]).x, point(ends[0]).y);
  assert.ok(Math.hypot(Number(hooked[3]), Number(hooked[4])) < ring - 1, 'the hook turns inside the ring');
  assert.strictEqual((line.d.match(/M/g) || []).length, 2 + 2, 'the stem, the hooked arc, and a tick for each of the two children between');
});

test('a bracket of two children is the hooked stroke and the stem, with no tick between', () => {
  const { plan } = withLines(buildOf([card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 1 })]), {});
  const line = plan.links.find((l) => l.count !== undefined);
  assert.strictEqual((line.d.match(/M/g) || []).length, 2);
  assert.strictEqual((line.d.match(/A/g) || []).length, 1);
});

test('the counted line is styled apart from the ring guides: a token in both themes, a thicker and brighter stroke', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.strictEqual(css.split('--graph-bracket:').length - 1, 3, 'light, dark by preference and dark by choice');
  const rule = /\.graph-link-counted \{([^}]*)\}/.exec(css)[1];
  const guide = /\.graph-guide \{([^}]*)\}/.exec(css)[1];
  const num = (text, prop) => Number(new RegExp(`${prop}: ([0-9.]+)`).exec(text)[1]);
  assert.match(rule, /stroke: var\(--graph-bracket\)/);
  assert.ok(num(rule, 'stroke-width') > num(guide, 'stroke-width'), 'thicker than a guide');
  assert.ok(num(rule, 'opacity') > num(guide, 'opacity'), 'brighter than a guide');
  assert.ok(num(rule, 'opacity') < 0.85, 'calmer than a lit line (.graph-near is .85)');
});
