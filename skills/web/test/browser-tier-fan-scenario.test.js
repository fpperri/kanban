const { test, after } = require('node:test');
const assert = require('node:assert');

const scenario = require('./browser/scenarios/tier-fan');
const scenarios = require('./browser/scenarios');
const { graphFanPlace, graphLayoutTiers, graphPlan } = require('./../web/graph-model');
const { loadBoard, cleanUp, drawnModel } = require('./helpers/fan-boards');

// The tier-fan scenario only runs in a browser (in CI). Here its lists are held
// to the real board readers and the Graph model over each fixture board's own
// cards, and its logic runs against a stand-in page that answers from the real
// layout, with the drawing varied so a scenario that could never fail is caught.

after(cleanUp);

const BOARDS = { plan: loadBoard('plan'), fixture: loadBoard('fixture'), malformed: loadBoard('malformed') };
const sorted = (ids) => ids.slice().sort((a, b) => a - b);

// What the page draws on `key`: the model of the cards it shows, the layout and the plan.
function drawn(key, archiveOn) {
  const board = BOARDS[key];
  const visible = board.all.filter((c) => archiveOn || !c.archived).map((c) => c.id);
  const model = drawnModel(board, { visible });
  const layout = graphLayoutTiers(model, { statuses: board.config.statuses });
  const plan = graphPlan(model, layout, { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title });
  return { model, layout, plan, place: graphFanPlace(model, { statuses: board.config.statuses }) };
}

test('the scenario is in the runner, on the plan board, with the fixture and malformed boards beside it', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'tier-fan'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['fixture', 'malformed']);
});

test('the plan board\'s lists are the tiers, depth rings, Unnested cards and archived cards of the real board', () => {
  const { model, place } = drawn('plan', false);
  const want = scenario.CASES.plan;
  const byTier = new Map();
  const byDepth = new Map();
  const block = [];
  for (const n of model.nodes) {
    const p = place.places.get(n.id);
    const slice = model.axis[p.band];
    if (p.block) block.push(n.id);
    else if (slice.kind === 'tier') byTier.set(slice.index, [...(byTier.get(slice.index) || []), n.id]);
    else byDepth.set(slice.depth, [...(byDepth.get(slice.depth) || []), n.id]);
  }
  assert.deepStrictEqual([...byTier.keys()].sort(), [0, 1, 2, 3]);
  assert.deepStrictEqual([0, 1, 2, 3].map((t) => sorted(byTier.get(t))), want.tiers.map(sorted));
  assert.deepStrictEqual([...byDepth.keys()].sort((a, b) => a - b), [1, 2, 4, 5]);
  assert.deepStrictEqual([1, 2, 4, 5].map((d) => sorted(byDepth.get(d))), want.depths.map(sorted));
  assert.deepStrictEqual(sorted(block), sorted(want.block));
  assert.deepStrictEqual(sorted(BOARDS.plan.all.filter((c) => c.archived).map((c) => c.id)), want.archived);
  assert.deepStrictEqual(sorted(model.nodes.map((n) => n.id)), sorted(want.tiers.flat().concat(want.depths.flat(), want.block)));
  const types = new Map(BOARDS.plan.live.map((c) => [c.id, c.type]));
  assert.deepStrictEqual(want.tiers.map((ids) => [...new Set(ids.map((id) => types.get(id)))]), [['goal'], ['strategy'], ['objective'], ['epic']]);
});

test('the fixture board has no hierarchy, so its lists are depths and loose cards', () => {
  const { model, place } = drawn('fixture', false);
  const want = scenario.CASES.fixture;
  assert.deepStrictEqual(BOARDS.fixture.config.hierarchy, []);
  const byDepth = new Map();
  const block = [];
  for (const n of model.nodes) {
    const p = place.places.get(n.id);
    if (p.block) block.push(n.id);
    else byDepth.set(model.axis[p.band].depth, [...(byDepth.get(model.axis[p.band].depth) || []), n.id]);
  }
  assert.deepStrictEqual([0, 1, 2].map((d) => sorted(byDepth.get(d))), want.depths.map(sorted));
  assert.deepStrictEqual(sorted(block), want.block);
});

test('the malformed board names two tiers, each twice, a depth ring and a loose card', () => {
  const { model, place, layout } = drawn('malformed', false);
  const want = scenario.CASES.malformed;
  assert.deepStrictEqual(BOARDS.malformed.config.hierarchy, ['Goal', 'goal', 'Epic', 'EPIC']);
  assert.deepStrictEqual(layout.bands.filter((b) => b.slice.kind === 'tier').map((b) => b.count), [1, 1]);
  assert.deepStrictEqual(want.tiers.map((ids) => ids.map((id) => model.axis[place.places.get(id).band].kind)), [['tier'], ['tier']]);
  assert.strictEqual(model.axis[place.places.get(3).band].depth, 2);
  assert.strictEqual(place.places.get(4).block, 'done');
});

// A stand-in for the page: each expression the scenario evaluates is answered
// from what the page would draw. `over.dots(key, all)` changes the dots it reports.
function standIn(over = {}) {
  const checks = [];
  let key = null;
  let archiveOn = false;
  const opened = [];
  const dotsOf = () => {
    const out = {};
    for (const n of drawn(key, archiveOn).plan.nodes) out[n.id] = { x: n.x, y: n.y };
    return over.dots ? over.dots(key, out) : out;
  };
  return {
    checks,
    opened,
    check: (name, ok) => checks.push([name, !!ok]),
    shot: async () => {},
    open: async (p, k) => { key = k; archiveOn = false; opened.push(`${k}${p}`); },
    waitFor: async (expr) => {
      if (expr === '!window.__stale') return true;
      if (expr === `${scenario.DRAWN}&&${scenario.TIERS_PRESSED}`) return true;
      if (/data-id="19"/.test(expr)) return over.archiveDraws === false ? false : archiveOn;
      throw new Error(`the stand-in page was asked to wait on something it does not know: ${expr.slice(0, 80)}`);
    },
    ev: async (expr) => {
      if (expr === 'window.__stale=true') return true;
      if (expr === scenario.DOTS) return dotsOf();
      if (expr === scenario.BAND_EDGES) {
        const { layout } = drawn(key, archiveOn);
        const bands = layout.bands;
        const edges = { tiers: bands.filter((b) => b.slice.kind === 'tier').map((b) => b.r1), outer: bands.length ? bands[bands.length - 1].r1 : 0 };
        return over.edges ? over.edges(key, edges) : edges;
      }
      if (expr === scenario.ARCHIVE_PILL) { archiveOn = true; return true; }
      throw new Error(`the stand-in page was asked something it does not know: ${expr.slice(0, 80)}`);
    },
  };
}
const failed = (page) => page.checks.filter(([, ok]) => !ok).map(([n]) => n);
const radius = (p) => Math.hypot(p.x, p.y);

test('against the real layout every check passes, on each board in turn', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(failed(page), []);
  assert.ok(page.checks.length >= 13, `only ${page.checks.length} checks ran`);
  assert.deepStrictEqual(page.opened, ['plan/?view=graph', 'fixture/?view=graph', 'malformed/?view=graph']);
});

test('a tier drawn outside the next tier fails the tier-order check', async () => {
  const page = standIn({
    dots: (key, all) => {
      if (key !== 'plan') return all;
      const swap = (from, to) => { const r = radius(all[to]) / radius(all[from]); all[from] = { x: all[from].x * r, y: all[from].y * r }; };
      swap(1, 7);
      return all;
    },
  });
  await scenario.run(page);
  assert.ok(failed(page).includes('plan: every dot of a tier sits closer to the centre than every dot of the next tier'), failed(page).join('; '));
});

test('a card with no tier drawn inside the tier bands fails, and so does an Unnested card inside the fan', async () => {
  const inside = standIn({ dots: (key, all) => { if (key === 'plan') all[3] = { x: 40, y: 40 }; return all; } });
  await scenario.run(inside);
  assert.ok(failed(inside).includes('plan: the cards with no tier sit outside every tier band'), failed(inside).join('; '));
  const unnested = standIn({ dots: (key, all) => { if (key === 'plan') all[9] = { x: 200, y: 200 }; return all; } });
  await scenario.run(unnested);
  assert.ok(failed(unnested).includes('plan: the Unnested cards sit outside the fan'), failed(unnested).join('; '));
});

test('a NaN position fails, on the plan board and on the others', async () => {
  for (const key of ['plan', 'fixture', 'malformed']) {
    const page = standIn({ dots: (k, all) => { if (k === key) all[1] = null; return all; } });
    await scenario.run(page);
    assert.ok(failed(page).includes(`${key}: no dot position is NaN`), `${key}: ${failed(page).join('; ')}`);
  }
});

test('an archived card drawn before the Archive pill is on fails, and so does one the pill does not bring', async () => {
  const early = standIn({ dots: (key, all) => { if (key === 'plan') all[19] = { x: 300, y: 300 }; return all; } });
  await scenario.run(early);
  assert.ok(failed(early).includes('plan: every live card is drawn, and no archived one'), failed(early).join('; '));
  const never = standIn({ archiveDraws: false });
  await scenario.run(never);
  assert.ok(failed(never).includes('plan: the Archive pill draws the archived cards'), failed(never).join('; '));
});

test('fixture rings that do not follow depth fail', async () => {
  const page = standIn({
    dots: (key, all) => {
      if (key === 'fixture') all[7] = { x: all[2].x, y: all[2].y };
      return all;
    },
  });
  await scenario.run(page);
  assert.ok(failed(page).includes('fixture: the rings follow depth, one ring for each depth'), failed(page).join('; '));
});

test('a malformed board whose tiers are not bands fails', async () => {
  const page = standIn({ edges: (key, edges) => (key === 'malformed' ? { ...edges, tiers: [edges.tiers[0]] } : edges) });
  await scenario.run(page);
  assert.ok(failed(page).includes('malformed: the two tiers are bands, the first nearer the centre'), failed(page).join('; '));
});

test('the scenario waits on the page, never on a fixed sleep', () => {
  const src = require('node:fs').readFileSync(require.resolve('./browser/scenarios/tier-fan'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
});
