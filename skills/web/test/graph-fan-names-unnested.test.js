const { test, after } = require('node:test');
const assert = require('node:assert');

const {
  graphBuild, graphUnnestedIds, graphFanNames, graphLayout, graphPlan, mergeGraphFanOptions, GRAPH_FAN_NAMES_SMALL,
} = require('../web/graph-model');
const { loadBoard, cleanUp } = require('./helpers/fan-boards');

// The tier fan's Names option and its Unnested option read the same fan. Names is about the
// cards the Graph draws: the small size counts them, so the cards Unnested off leaves out
// are not named and can tip a fan under the small size, where every card is named. In
// every Unnested mode a card on the outermost ring, on the depth 0 ring or in the block
// takes its name when Names is all, and in none it takes no name.

after(cleanUp);

const board = loadBoard('plan');
const unnestedIds = [...graphUnnestedIds(board.all, { ctx: board.ctx, hierarchy: board.config.hierarchy })].sort((a, b) => a - b);

function fanOf(options) {
  const fan = mergeGraphFanOptions(options);
  const model = graphBuild(board.all, {
    ctx: board.ctx, hierarchy: board.config.hierarchy, visibleIds: new Set(board.live.map((c) => c.id)), unnested: fan.unnested,
  });
  const layout = graphLayout(model, 'tiers', { statuses: board.config.statuses, order: fan.order, unnested: fan.unnested });
  const plan = graphPlan(model, layout, { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title, fan });
  return { model, plan, fan };
}

const named = (plan) => plan.nodes.filter((n) => /\bgraph-named\b/.test(n.cls)).map((n) => n.id).sort((a, b) => a - b);

test('the plan board has thirteen loose cards with no tier among its twenty-six drawn cards, over the small size', () => {
  const { model } = fanOf({});
  assert.strictEqual(model.nodes.length, 26);
  assert.ok(model.nodes.length > GRAPH_FAN_NAMES_SMALL);
  assert.deepStrictEqual(unnestedIds.filter((id) => model.byId.has(id)).length, 13);
});

test('relevant, with Unnested off: the thirteen cards left out are not drawn, so the fan is under the small size and every drawn card is named', () => {
  const { model, plan } = fanOf({ names: 'relevant', unnested: 'off' });
  assert.strictEqual(model.nodes.length, 13);
  assert.ok(model.nodes.length <= GRAPH_FAN_NAMES_SMALL);
  const drawn = model.nodes.map((n) => n.id).sort((a, b) => a - b);
  assert.deepStrictEqual(named(plan), drawn, 'every drawn card is named');
  for (const id of unnestedIds) {
    assert.ok(!model.byId.has(id), `card ${id} is not in the model`);
    assert.ok(!graphFanNames(model, 'relevant').has(id), `card ${id} is not named`);
  }
});

test('relevant, with Unnested on the outermost ring, depth 0 or the table: the fan is over the small size, so only the parents are named and no loose card is', () => {
  for (const unnested of ['outermost', 'depth 0', 'table']) {
    const { model, plan } = fanOf({ names: 'relevant', unnested });
    assert.strictEqual(model.nodes.length, 26, unnested);
    assert.deepStrictEqual(named(plan), ['1', '2', '7', '22', '23'], unnested);
  }
});

test('all names every loose card in every Unnested mode that draws it, and none names no card', () => {
  for (const unnested of ['outermost', 'depth 0', 'table']) {
    const all = fanOf({ names: 'all', unnested });
    assert.deepStrictEqual(named(all.plan), all.model.nodes.map((n) => n.id).sort((a, b) => a - b), unnested);
    for (const id of unnestedIds.filter((i) => all.model.byId.has(i))) assert.ok(all.plan.nodes.find((n) => n.id === id).name, `${unnested}: card ${id} carries a name`);
    assert.deepStrictEqual(named(fanOf({ names: 'none', unnested }).plan), [], unnested);
  }
  const off = fanOf({ names: 'all', unnested: 'off' });
  assert.deepStrictEqual(off.plan.nodes.map((n) => n.id).filter((id) => unnestedIds.includes(id)), [], 'off draws none of them');
});
