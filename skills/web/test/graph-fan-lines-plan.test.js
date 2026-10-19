const { test } = require('node:test');
const assert = require('node:assert');

const {
  graphLayout, graphPlan, graphLit, graphRestLit, GRAPH_LAYOUTS,
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

const planOf = (model, fan, kind = 'tiers') => {
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

test('a plan with no options draws every relation, as the Force and Status layouts always do', () => {
  const model = tree();
  assert.deepStrictEqual(kinds(planOf(model, null).plan), { parent: 7, wait: 2 });
  for (const kind of GRAPH_LAYOUTS.filter((k) => k !== 'tiers')) {
    assert.deepStrictEqual(kinds(planOf(model, { lines: 'off', dependencies: 'off' }, kind).plan), { parent: 7, wait: 2 }, `${kind} reads no option`);
  }
});

test('an arrow is a dashed line with a head; a parent line, counted or not, has none', () => {
  const { plan } = planOf(tree(), { lines: 'folded' });
  for (const l of plan.links) assert.strictEqual(l.arrow, l.kind === 'wait', `${l.from}>${l.to}`);
});

test('the counted line is one plan line with its count and a label, and its classes tell it from the others', () => {
  const { plan } = planOf(tree(), { lines: 'folded' });
  const counted = plan.links.filter((l) => l.count !== undefined);
  assert.deepStrictEqual(counted.map((l) => [l.from, l.to, l.count, l.label.text]), [[2, 2, 2, '2'], [1, 1, 2, '2']]);
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
  const at = (id) => layout.pos.get(id);
  const round = (v) => Math.round(v * 100) / 100;
  const radiusOf = (id) => Math.hypot(at(id).x, at(id).y);
  const counted = plan.links.find((l) => l.count !== undefined && l.from === '1');
  const numbers = counted.d.match(new RegExp(NUM, 'g')).map(Number);
  assert.ok(numbers.every(Number.isFinite));
  assert.match(counted.d, /^M/);
  assert.deepStrictEqual(numbers.slice(0, 2), [round(at(1).x), round(at(1).y)], 'the line starts on its parent');
  const ticks = [...counted.d.matchAll(new RegExp(`L(${NUM}) (${NUM})`, 'g'))].map((m) => [Number(m[1]), Number(m[2])]);
  for (const kid of [5, 6]) {
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
  const all = graphLit(model, [1, 2, 3, 4, 5, 6, 7, 8], plan.links);
  assert.deepStrictEqual([...all.links].sort((a, b) => a - b), plan.links.map((_, i) => i), 'every card lit: every drawn line lit');
  assert.deepStrictEqual(ends(plan, graphLit(model, [1, 5], plan.links).links), ['1>1'], 'the counted line lights with its parent alone, though no child of it is lit');
});

test('a counted line lights whenever its parent does, a line to one child only when both ends do', () => {
  const model = tree();
  const { plan } = planOf(model, { lines: 'folded' });
  const lines = (ids) => ends(plan, graphLit(model, ids, plan.links).links);
  assert.deepStrictEqual(lines(['2']), ['2>2']);
  assert.deepStrictEqual(lines(['1', '2']), ['1>1', '1>2', '2>2']);
  assert.deepStrictEqual(lines(['4']), []);
  assert.deepStrictEqual(lines(['1', '4']), ['1>1', '1>4']);
  assert.deepStrictEqual(lines([3, 4]), ['3>4']);
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
  const rest = graphRestLit(model, { selectedIds: new Set(['4']), loneCardId: 4 }, plan.links);
  assert.deepStrictEqual(ends(plan, rest.links), ['1>4', '3>4']);
});
