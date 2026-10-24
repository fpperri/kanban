const { test, after } = require('node:test');
const assert = require('node:assert');

const { graphLayout, graphPlan, graphNeighbours } = require('../../plugin/skills/web/web/graph-model');
const { STATUSES, loadBoard, cleanUp, drawnModel } = require('./helpers/fan-boards');
const scenarios = require('./browser/scenarios');
const hover = require('./browser/scenarios/graph-line-hover');
const lights = require('./browser/scenarios/graph-lights');

// The browser runner's graph-line-hover scenario only runs in a browser (in CI). What it expects
// each line to light is held here to the Graph model over the plan board's own cards, so a wrong
// expectation fails in the unit suite and not only in a browser.

after(cleanUp);

const board = loadBoard('plan');
const model = drawnModel(board);
const plan = (kind) => {
  const opts = { kind, statusClass: (s) => s, titleOf: (c) => c.title };
  if (kind === 'hierarchy') opts.fan = { lines: 'all', group: 'brackets', dependencies: 'on', order: 'status', names: 'relevant', unnested: 'outermost' };
  return graphPlan(model, graphLayout(model, kind, { statuses: STATUSES, order: 'status', unnested: 'outermost', deps: 'frontier' }), opts);
};
const sorted = (ids) => [...ids].map(Number).sort((a, b) => a - b);

test('the scenario is in the runner, on the plan board', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'graph-line-hover'), hover);
  assert.strictEqual(hover.board, 'plan');
  assert.ok(hover.timeoutMs >= 60000);
});

test('each line the scenario hovers in the Hierarchy is drawn once, and lights the cards the scenario says', () => {
  const p = plan('hierarchy');
  const { parent, bracket, dependency } = hover.CASES.hierarchy;
  const lineOf = (from, to) => p.links.filter((l) => l.from === from && l.to === to && l.count === undefined);
  assert.strictEqual(lineOf(parent.from, parent.to).length, 1);
  assert.strictEqual(lineOf(parent.from, parent.to)[0].kind, 'parent');
  assert.deepStrictEqual(sorted([parent.from, parent.to]), parent.lit);
  const brackets = p.links.filter((l) => l.count !== undefined && l.from === bracket.from);
  assert.strictEqual(brackets.length, 1);
  assert.deepStrictEqual(sorted(brackets[0].kids), bracket.kids);
  assert.deepStrictEqual(sorted([bracket.from, ...brackets[0].kids]), bracket.lit);
  assert.strictEqual(lineOf(dependency.from, dependency.to).length, 1);
  assert.strictEqual(lineOf(dependency.from, dependency.to)[0].kind, 'wait');
  assert.deepStrictEqual(sorted([dependency.from, dependency.to]), dependency.lit);
});

test('the Flow draws the dependency line the scenario hovers', () => {
  const p = plan('flow');
  const { dependency } = hover.CASES.flow;
  assert.ok(p.links.every((l) => l.kind === 'wait'));
  assert.strictEqual(p.links.filter((l) => l.from === dependency.from && l.to === dependency.to).length, 1);
  assert.deepStrictEqual(sorted([dependency.from, dependency.to]), dependency.lit);
});

test('the card the scenario hovers over a line lights its relations, and the line runs into it', () => {
  const p = plan('hierarchy');
  const { id, lit, line } = hover.CASES.card;
  assert.deepStrictEqual(sorted(graphNeighbours(model, String(id))), lit);
  assert.deepStrictEqual(lit, lights.LONE[id], 'the lights scenario holds the same relations');
  assert.ok(p.links.some((l) => l.from === line.from && l.to === line.to && String(id) === line.to));
});

test('the lone card the scenario clicks before hovering a line lights the relations it says', () => {
  const { id, lit } = hover.CASES.lone;
  assert.deepStrictEqual(sorted(graphNeighbours(model, String(id))), lit);
  assert.deepStrictEqual(lit, lights.LONE[id]);
});
