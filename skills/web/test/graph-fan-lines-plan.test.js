const { test } = require('node:test');
const assert = require('node:assert');

const {
  graphLayout, graphPlan, graphLit, graphRestLit,
} = require('../web/graph-model');
const { card, buildOf } = require('./helpers/fan-boards');

// What the plan draws of the fan's lines: the lines graphFanLines lists, each with its
// path, and for the counted line of the folded mode a bus: a stem out from the parent,
// one arc through the children's angles, a tick to each child, and a label with the
// count. The page draws the plan; this holds what the plan says.

const STATUSES = ['backlog', 'todo', 'doing', 'done'];
const DEFAULTS = { lines: 'folded', dependencies: 'on', order: 'status' };

// 1 goal; 2 strategy; 3, 4 (waits for 3), 5, 6 untyped children of 1; 7, 8 untyped
// children of 2, card 8 waiting for card 5; 9 alone. Cards 5 and 6 share a ring, as do
// 7 and 8, so folded carries each pair on one counted line.
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

test('the plan draws as many lines as the options say: folded 4 parent lines, chain 6, all 7, off 0, and 2 arrows', () => {
  const model = tree();
  for (const [lines, parent] of [['folded', 4], ['chain', 6], ['all', 7], ['off', 0]]) {
    assert.deepStrictEqual(kinds(planOf(model, { lines }).plan), { parent, wait: 2 }, lines);
  }
});

test('dependencies off draws no arrow and keeps the parent lines', () => {
  const model = tree();
  assert.deepStrictEqual(kinds(planOf(model, { dependencies: 'off' }).plan), { parent: 4, wait: 0 });
  assert.deepStrictEqual(kinds(planOf(model, { lines: 'off', dependencies: 'off' }).plan), { parent: 0, wait: 0 });
});

test('a plan with no options draws every relation', () => {
  const model = tree();
  assert.deepStrictEqual(kinds(planOf(model, null).plan), { parent: 7, wait: 2 });
});

test('an arrow is a dashed line with a head; a parent line, counted or not, has none', () => {
  const { plan } = planOf(tree(), { lines: 'folded' });
  for (const l of plan.links) assert.strictEqual(l.arrow, l.kind === 'wait', `${l.from}>${l.to}`);
});

test('the counted line is one plan line with its count and a label, and its classes tell it from the others', () => {
  const { plan } = planOf(tree(), { lines: 'folded' });
  const counted = plan.links.filter((l) => l.count !== undefined);
  assert.deepStrictEqual(counted.map((l) => [l.from, l.to, l.count, l.label.text]), [['2', '2', 2, '2'], ['1', '1', 2, '2']]);
  for (const l of counted) {
    const cls = l.cls.split(' ');
    assert.ok(cls.includes('graph-link-counted') && cls.includes('graph-link-parent') && cls.includes('graph-link'));
    assert.ok(Number.isFinite(l.label.x) && Number.isFinite(l.label.y));
  }
  for (const l of plan.links.filter((x) => x.count === undefined)) assert.strictEqual(l.label, undefined, 'only a counted line has a label');
});

const NUM = '-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?';

test('the counted line runs from its parent along one arc to a tick on each child', () => {
  const { plan, layout } = planOf(tree(), { lines: 'folded' });
  const at = (id) => layout.pos.get(String(id));
  const round = (v) => Math.round(v * 100) / 100;
  const radiusOf = (id) => Math.hypot(at(id).x, at(id).y);
  const counted = plan.links.find((l) => l.count !== undefined && l.from === '1');
  const numbers = counted.d.match(new RegExp(NUM, 'g')).map(Number);
  assert.ok(numbers.every(Number.isFinite));
  assert.match(counted.d, /^M/);
  assert.deepStrictEqual(numbers.slice(0, 2), [round(at(1).x), round(at(1).y)], 'the line starts on its parent');
  const ticks = [...counted.d.matchAll(new RegExp(`L(${NUM}) (${NUM})`, 'g'))].map((m) => [Number(m[1]), Number(m[2])]);
  for (const kid of ['5', '6']) {
    assert.ok(ticks.some(([x, y]) => x === round(at(kid).x) && y === round(at(kid).y)), `a tick ends on card ${kid}`);
  }
  assert.strictEqual((counted.d.match(/A/g) || []).length, 1, 'one arc through the children');
  assert.ok(Math.abs(radiusOf(5) - radiusOf(6)) < 0.01, 'the children are on one ring');
  const arc = new RegExp(`M(${NUM}) (${NUM})A(${NUM}) (${NUM}) 0 (\\d) (\\d) (${NUM}) (${NUM})`).exec(counted.d);
  assert.ok(arc, 'the arc has the shape the SVG path takes');
  const radius = Number(arc[3]);
  assert.ok(radius < radiusOf(5) && radius > radiusOf(1), 'the arc lies between the parent\'s ring and the children\'s');
  assert.ok(Math.abs(Math.hypot(Number(arc[1]), Number(arc[2])) - radius) < 0.1, 'the arc starts on its circle');
  assert.ok(Math.abs(Math.hypot(Number(arc[7]), Number(arc[8])) - radius) < 0.1, 'and ends on it');
});

test('the label of a counted line sits on the line, on the circle of its arc', () => {
  const { plan } = planOf(tree(), { lines: 'folded' });
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
  const base = where({ lines: 'folded' });
  for (const lines of ['chain', 'all', 'off']) assert.strictEqual(where({ lines, dependencies: 'off' }), base, lines);
});

test('every path the plan draws has finite numbers, for every option', () => {
  const model = tree();
  for (const lines of ['folded', 'chain', 'all', 'off']) {
    for (const dependencies of ['on', 'off']) {
      for (const l of planOf(model, { lines, dependencies }).plan.links) assert.doesNotMatch(l.d, /NaN|Infinity|undefined/, `${lines} ${dependencies}`);
    }
  }
});

// --- lighting reads the lines that are drawn ---------------------------------------

test('lighting names the lines among the cards it lights, by their place in the list of drawn lines', () => {
  const model = tree();
  const { plan } = planOf(model, { lines: 'folded' });
  const all = graphLit(model, ['1', '2', '3', '4', '5', '6', '7', '8'], plan.links);
  assert.deepStrictEqual([...all.links].sort((a, b) => a - b), plan.links.map((_, i) => i), 'every card lit: every drawn line lit');
  assert.deepStrictEqual(ends(plan, graphLit(model, ['1', '5'], plan.links).links), ['1>1'], 'the counted line lights with its parent alone, though no child of it is lit');
});

test('a counted line lights whenever its parent does, a line to one child only when both ends do', () => {
  const model = tree();
  const { plan } = planOf(model, { lines: 'folded' });
  const lines = (ids) => ends(plan, graphLit(model, ids, plan.links).links);
  assert.deepStrictEqual(lines(['2']), ['2>2']);
  assert.deepStrictEqual(lines(['1', '2']), ['1>1', '1>2', '2>2']);
  assert.deepStrictEqual(lines(['4']), []);
  assert.deepStrictEqual(lines(['1', '4']), ['1>1', '1>4']);
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
  const { plan } = planOf(model, { lines: 'chain' });
  const rest = graphRestLit(model, { selectedIds: new Set(['4']), loneCardId: '4' }, plan.links);
  assert.deepStrictEqual(ends(plan, rest.links), ['1>4', '3>4']);
});

// --- the brackets mode -------------------------------------------------------------

const withLines = (model, lines, order = 'status') => {
  const layout = graphLayout(model, 'hierarchy', { statuses: STATUSES, order });
  const plan = graphPlan(model, layout, { kind: 'hierarchy', statusClass: (s) => s, titleOf: (c) => c.title, fan: { ...DEFAULTS, lines, order } });
  return { layout, plan };
};
const angleOf = (x, y) => Math.atan2(y, x);
const same = (a, b) => Math.abs(Math.sin((a - b) / 2)) < 0.005;

test('brackets draw 3 parent lines of the tree and its 2 arrows: one bracket over cards 3 to 6, one over 7 and 8, a plain line to card 2', () => {
  const { plan } = withLines(tree(), 'brackets');
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
  const { plan } = withLines(model, 'brackets');
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
    const { layout, plan } = withLines(seated(), 'brackets', order);
    const lines = plan.links.filter((l) => l.count !== undefined);
    assert.strictEqual(lines.length, 1, `${order}: one bracket for the four children`);
    const [line] = lines;
    assert.strictEqual(line.count, 4);
    const start = new RegExp(`M(${NUM}) (${NUM})A`).exec(line.d);
    const arc = new RegExp(`A${NUM} ${NUM} 0 \\d \\d (${NUM}) (${NUM})`).exec(line.d);
    const ends = [angleOf(Number(start[1]), Number(start[2])), angleOf(Number(arc[1]), Number(arc[2]))];
    const seats = ['2', '3', '4', '5'].sort((x, y) => layout.polar.get(y).a - layout.polar.get(x).a);
    assert.deepStrictEqual([seats[0], seats[3]], [first, last], `${order}: the first and last seats`);
    assert.ok(same(ends[1], layout.polar.get(first).a) && same(ends[0], layout.polar.get(last).a), `${order}: the arc's ends are the first and last child's angles`);
    assert.strictEqual((line.d.match(/A/g) || []).length, 1, `${order}: one arc`);
    const parentAt = layout.pos.get('1');
    const stems = [...line.d.matchAll(new RegExp(`M(${NUM}) (${NUM})L`, 'g'))].filter((m) => Math.abs(Number(m[1]) - parentAt.x) < 0.01 && Math.abs(Number(m[2]) - parentAt.y) < 0.01);
    assert.strictEqual(stems.length, 1, `${order}: one stem leaves the parent`);
    assert.strictEqual((line.d.match(/M/g) || []).length, 1 + 1 + 4, `${order}: the stem, the arc and a tick for each child`);
  }
});

test('the stem runs along its parent\'s own ray when the parent stands among its children', () => {
  const { layout, plan } = withLines(seated(), 'brackets', 'rank');
  const line = plan.links.find((l) => l.count !== undefined);
  const kids = ['2', '3', '4', '5'].map((id) => layout.polar.get(id).a);
  const parent = layout.polar.get('1').a;
  assert.ok(parent >= Math.min(...kids) - 1e-6 && parent <= Math.max(...kids) + 1e-6, 'a parent stands among its children here');
  const stem = new RegExp(`^M${NUM} ${NUM}L(${NUM}) (${NUM})`).exec(line.d);
  assert.ok(same(angleOf(Number(stem[1]), Number(stem[2])), parent));
});

test('the arc does not run on to the parent when the parent stands outside its children: the stem reaches the nearer end of the arc', () => {
  const model = buildOf([
    card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { type: 'strategy', parent: 1 }),
    card(5, { parent: 4 }), card(6, { parent: 4 }), card(7, { parent: 4 }), card(8, { parent: 4 }),
  ]);
  const { layout, plan } = withLines(model, 'brackets');
  const line = plan.links.find((l) => l.count !== undefined && l.from === '1');
  assert.strictEqual(line && line.count, 2, 'cards 2 and 3 share a ring');
  const kids = [layout.polar.get('2').a, layout.polar.get('3').a];
  const parent = layout.polar.get('1').a;
  assert.ok(parent < Math.min(...kids) - 0.01 || parent > Math.max(...kids) + 0.01, 'card 4 and its children push the parent off the span of cards 2 and 3');
  const stem = new RegExp(`^M${NUM} ${NUM}L(${NUM}) (${NUM})`).exec(line.d);
  const near = parent < Math.min(...kids) ? Math.min(...kids) : Math.max(...kids);
  assert.ok(same(angleOf(Number(stem[1]), Number(stem[2])), near), 'the stem ends on the arc at its nearer end');
  const arc = new RegExp(`A${NUM} ${NUM} 0 \\d \\d (${NUM}) (${NUM})`).exec(line.d);
  const start = new RegExp(`M(${NUM}) (${NUM})A`).exec(line.d);
  assert.ok(same(angleOf(Number(start[1]), Number(start[2])), Math.min(...kids)) && same(angleOf(Number(arc[1]), Number(arc[2])), Math.max(...kids)), 'and the arc spans the children alone');
});

test('a child alone on its ring keeps a plain line to the parent, with no label', () => {
  const model = buildOf([card(1, { type: 'goal' }), card(2, { parent: 1 })]);
  const { plan } = withLines(model, 'brackets');
  assert.deepStrictEqual(plan.links.map((l) => [l.from, l.to, l.count, l.label]), [['1', '2', undefined, undefined]]);
});

test('the label of a bracket sits on the circle of its arc, and every path has finite numbers', () => {
  const { plan } = withLines(tree(), 'brackets');
  for (const l of plan.links) assert.doesNotMatch(l.d, /NaN|Infinity|undefined/);
  for (const l of plan.links.filter((x) => x.count !== undefined)) {
    const radius = Number(new RegExp(`A(${NUM}) `).exec(l.d)[1]);
    assert.ok(Math.abs(Math.hypot(l.label.x, l.label.y) - radius) < 0.1, `card ${l.from}`);
  }
});

test('folded keeps its bus, whose arc runs through the parent: the brackets mode changed nothing of it', () => {
  const { plan } = planOf(tree(), { lines: 'folded' });
  assert.deepStrictEqual(kinds(plan), { parent: 4, wait: 2 });
  const bus = plan.links.find((l) => l.count !== undefined && l.from === '1');
  assert.strictEqual(bus.count, 2);
  assert.strictEqual((bus.d.match(/M/g) || []).length, 1 + 1 + 2, 'the bus is one stem, one arc and two ticks as before');
});
