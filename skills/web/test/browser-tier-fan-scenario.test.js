const { test, after } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');

const scenario = require('./browser/scenarios/tier-fan');
const scenarios = require('./browser/scenarios');
const { DOT_SHAPES } = require('./browser/scenarios/type-icons');
const {
  graphBuild, graphFanPlace, graphLayout, graphPlan, graphFit, graphZoomAt,
} = require('./../web/graph-model');
const { loadBoard, cleanUp } = require('./helpers/fan-boards');

// The tier-fan scenario only runs in a browser (in CI). Here its lists are held
// to the real board readers and the Graph model over each fixture board's own
// cards, and its logic runs against a stand-in page that answers from the real
// layout and plan, with the drawing varied so a scenario that could never fail is
// caught.

after(cleanUp);

const BOARDS = { plan: loadBoard('plan'), fixture: loadBoard('fixture'), malformed: loadBoard('malformed') };
const sorted = (ids) => ids.slice().sort((a, b) => a - b);

// What the page draws on `key`: the model of the cards it shows, the layout and the plan.
function drawn(key, archiveOn, extra = [], kind = 'tiers') {
  const board = BOARDS[key];
  const cards = board.all.concat(extra);
  const visible = cards.filter((c) => archiveOn || !c.archived).map((c) => c.id);
  const model = graphBuild(cards, { ctx: board.ctx, hierarchy: board.config.hierarchy, types: board.config.types, visibleIds: new Set(visible) });
  const layout = graphLayout(model, kind, { statuses: board.config.statuses });
  const plan = graphPlan(model, layout, { kind, statusClass: (s) => s, titleOf: (c) => c.title });
  return { model, layout, plan, place: kind === 'tiers' ? graphFanPlace(model, { statuses: board.config.statuses }) : null };
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

test('the plan board\'s names, columns, loose card and icon cards are the real board\'s', () => {
  const want = scenario.CASES.plan;
  const { model, place } = drawn('plan', false);
  assert.deepStrictEqual(want.tierNames, BOARDS.plan.config.hierarchy);
  assert.deepStrictEqual(want.depthNames, [1, 2, 4, 5].map((d) => `depth ${d}`));
  const columns = Object.fromEntries(place.columns.map((c) => [c.label, sorted(c.ids)]));
  assert.deepStrictEqual(columns, Object.fromEntries(Object.entries(want.blockColumns).map(([s, ids]) => [s, sorted(ids)])));
  assert.deepStrictEqual(Object.keys(want.blockColumns), BOARDS.plan.config.statuses);
  const loose = place.sectors.find((s) => s.kind === 'loose');
  assert.deepStrictEqual(sorted(loose.tops), want.looseTier);
  const archived = drawn('plan', true);
  assert.deepStrictEqual(sorted(archived.place.columns.find((c) => c.label === 'archived').ids), want.archivedBlock);
  const types = new Map(BOARDS.plan.all.map((c) => [c.id, c.type]));
  assert.strictEqual(types.get(want.starCard), 'goal');
  assert.strictEqual(BOARDS.plan.config.types.find((t) => t.name === 'goal').icon, 'star');
  assert.strictEqual(types.get(want.unknownIconCard), 'bug');
  assert.strictEqual(BOARDS.plan.config.types.find((t) => t.name === 'bug').icon, 'blob');
  assert.ok(model.byId.has(want.starCard) && model.byId.has(want.unknownIconCard));
  assert.strictEqual(BOARDS.plan.config.nextId, 30, 'the card the scenario adds is card 30');
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
  assert.deepStrictEqual(want.depthNames, ['roots', 'depth 1', 'depth 2']);
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
// from what the page would draw, on a stage of STAGE. `over` changes what it
// answers: dots, edges, marks, sectors, shapes, rects, zoomFactor and the flags
// below.
const STAGE = { l: 0, t: 120, r: 1500, b: 900 };
const textW = (text) => text.length * 6.2;

function screenRects(v, zoomed, factor) {
  const w = STAGE.r - STAGE.l;
  const h = STAGE.b - STAGE.t;
  let fit = graphFit(v.layout.bounds, w, h);
  if (zoomed) fit = graphZoomAt(fit, w / 2, h / 2, 1.5);
  if (factor !== 1) fit = { ...fit, k: fit.k * factor };
  const sx = (x) => STAGE.l + fit.x + x * fit.k;
  const sy = (y) => STAGE.t + fit.y + y * fit.k;
  const text = (t, x, y, em, size, anchor) => {
    const width = textW(`${t.name} ${t.count}`);
    const base = sy(y) + parseFloat(em || '0') * size;
    const left = anchor === 'middle' ? sx(x) - width / 2 : sx(x);
    return { text: `${t.name}${t.count}`, l: left, t: base - size, r: left + width, b: base + 3 };
  };
  const plan = v.plan;
  const captions = plan.captions.map((c) => text(c, c.x, c.y, c.dy, 11, 'middle'));
  if (plan.looseCaption) captions.push(text(plan.looseCaption, plan.looseCaption.x, plan.looseCaption.y, plan.looseCaption.dy, 11, 'start'));
  if (plan.block) {
    captions.push(text(plan.block.title, plan.block.title.x, plan.block.title.y, plan.block.title.dy, 13, 'start'));
    for (const c of plan.block.columns) captions.push(text(c.caption, c.caption.x, c.caption.y, '0', 11, 'start'));
  }
  const b = plan.block;
  return {
    stage: STAGE,
    dots: plan.nodes.map((n) => ({ id: String(n.id), l: sx(n.x) - n.reach * fit.k, t: sy(n.y) - n.reach * fit.k, r: sx(n.x) + n.reach * fit.k, b: sy(n.y) + n.reach * fit.k })),
    captions,
    block: b ? { l: sx(b.x), t: sy(b.y), r: sx(b.x + b.w), b: sy(b.y + b.h) } : null,
  };
}

function standIn(over = {}) {
  const checks = [];
  let key = null;
  let archiveOn = false;
  let kind = 'tiers';
  let extra = [];
  let zoomed = false;
  let switched = 0;
  const opened = [];
  const view = () => drawn(key, archiveOn, extra, kind);
  const marksOf = () => {
    const { plan } = over.fanStays ? drawn(key, archiveOn, extra, 'tiers') : view();
    const cap = (c) => ({ name: c.name, count: c.count, kind: c.kind || '', x: c.x, y: c.y });
    const b = plan.block;
    const m = {
      captions: plan.captions.map(cap),
      guides: plan.guides.map((g) => g.d),
      dividers: plan.dividers.map((d) => [d.x1, d.y1, d.x2, d.y2]),
      loose: plan.looseCaption ? cap(plan.looseCaption) : null,
      block: b ? { x: b.x, y: b.y, w: b.w, h: b.h, title: cap(b.title), captions: b.columns.map((c) => cap(c.caption)) } : null,
    };
    return over.marks && kind === 'tiers' ? over.marks(key, m, { archiveOn, extra, switched }) : m;
  };
  const dotsOf = () => {
    const out = {};
    for (const n of view().plan.nodes) out[n.id] = { x: n.x, y: n.y };
    return over.dots ? over.dots(key, out) : out;
  };
  return {
    checks,
    opened,
    check: (name, ok) => checks.push([name, !!ok]),
    shot: async () => {},
    open: async (p, k) => {
      if (k !== key) { archiveOn = false; extra = []; kind = 'tiers'; }
      key = k;
      zoomed = false;
      opened.push(`${k}${p}`);
    },
    waitFor: async (expr) => {
      if (expr === '!window.__stale') return true;
      if (expr === `${scenario.DRAWN}&&${scenario.TIERS_PRESSED}`) return true;
      const more = /^.*&&document\.querySelectorAll\('#graph-view \.graph-node'\)\.length>(\d+)$/.exec(expr);
      if (more) return view().plan.nodes.length > Number(more[1]);
      if (expr === scenario.ZOOMED) return zoomed;
      if (expr === scenario.FITTED) return !zoomed;
      for (const name of ['tiers', 'force', 'status']) if (expr === scenario.layoutIs(name)) return kind === name;
      const ids = [...expr.matchAll(/data-id="(\d+)"/g)].map((m) => Number(m[1]));
      if (ids.length) return over.archiveDraws === false ? false : archiveOn && ids.every((id) => view().model.byId.has(id));
      throw new Error(`the stand-in page was asked to wait on something it does not know: ${expr.slice(0, 80)}`);
    },
    ev: async (expr) => {
      if (expr === 'window.__stale=true') return true;
      if (expr === scenario.DOTS) return dotsOf();
      if (expr === scenario.BAND_EDGES) {
        const bands = view().layout.bands;
        const edges = { tiers: bands.filter((b) => b.slice.kind === 'tier').map((b) => b.r1), outer: bands.length ? bands[bands.length - 1].r1 : 0 };
        return over.edges ? over.edges(key, edges) : edges;
      }
      if (expr === scenario.FAN_MARKS) return marksOf();
      if (expr === scenario.SECTORS) {
        const sectors = view().layout.sectors.map((s) => ({ kind: s.kind, tops: s.tops.slice(), from: s.from, to: s.to }));
        return over.sectors ? over.sectors(key, sectors, { extra }) : sectors;
      }
      if (expr === scenario.RECTS) {
        const phase = zoomed ? 'zoomed' : 'fitted';
        const r = screenRects(view(), zoomed, over.zoomFactor ? over.zoomFactor(phase, key) : 1);
        return over.rects ? over.rects(key, r, phase) : r;
      }
      if (expr === DOT_SHAPES) {
        const shapes = {};
        for (const n of view().plan.nodes) shapes[n.id] = n.shape;
        return over.shapes ? over.shapes(key, shapes) : shapes;
      }
      if (expr === scenario.ARCHIVE_PILL) { archiveOn = true; return true; }
      if (expr === scenario.ZOOM_IN) { zoomed = true; return true; }
      if (expr === scenario.FIT) { zoomed = !!over.fitDoesNothing; return true; }
      for (const name of ['tiers', 'force', 'status']) if (expr === scenario.pickLayout(name)) { kind = name; switched += name === 'tiers' ? 1 : 0; return true; }
      if (expr === scenario.addLoose(scenario.CASES.plan.extraLoose)) {
        extra = extra.concat([{
          id: 30, title: 'new', status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, type: 'objective',
        }]);
        return 201;
      }
      throw new Error(`the stand-in page was asked something it does not know: ${expr.slice(0, 80)}`);
    },
  };
}
const failed = (page) => page.checks.filter(([, ok]) => !ok).map(([n]) => n);
const radius = (p) => Math.hypot(p.x, p.y);
const run = async (over) => {
  const page = standIn(over);
  await scenario.run(page);
  return page;
};

test('against the real layout every check passes, on each board in turn', async () => {
  const page = await run();
  assert.deepStrictEqual(failed(page), []);
  assert.ok(page.checks.length >= 40, `only ${page.checks.length} checks ran`);
  assert.deepStrictEqual(page.opened, ['plan/?view=graph', 'plan/?view=graph', 'fixture/?view=graph', 'malformed/?view=graph']);
});

test('the checks the card asks for are each in the scenario', async () => {
  const page = await run();
  const names = page.checks.map(([n]) => n);
  const has = (re) => assert.ok(names.some((n) => re.test(n)), `no check matches ${re}`);
  has(/plan: each tier that has a card shows one caption with its name and count, in hierarchy order from the centre/);
  has(/plan: one caption per non-empty depth follows/);
  has(/plan: every guide arc, divider and caption has finite coordinates/);
  has(/plan: the loose cards with a tier share one sector, under a caption that counts them/);
  has(/plan: every loose card without a tier is in the block under the caption for its status/);
  has(/plan: and none of them is on a ring/);
  has(/plan: every live card is drawn, and no archived one/);
  has(/plan: with the Archive pill on, an archived loose card without a tier shows in the block's archived column/);
  has(/plan: after Fit every dot, every caption and the Unnested block lie inside the canvas/);
  has(/plan: the first draw frames every dot, every caption and the Unnested block/);
  has(/plan: in the fan a star-typed card's dot is a star/);
  has(/plan: and a card of the unknown-icon type has a round dot/);
  has(/plan: force draws no arc, caption, divider or block/);
  has(/plan: status draws no arc, caption, divider or block/);
  has(/plan: back in Tiers the arcs, captions, dividers and block are back/);
  has(/fixture: the fan shows depth captions and no tier caption/);
  has(/malformed: the fan captions each tier once/);
});

test('a tier drawn outside the next tier fails the tier-order check', async () => {
  const page = await run({
    dots: (key, all) => {
      if (key !== 'plan') return all;
      const swap = (from, to) => { const r = radius(all[to]) / radius(all[from]); all[from] = { x: all[from].x * r, y: all[from].y * r }; };
      swap(1, 7);
      return all;
    },
  });
  assert.ok(failed(page).includes('plan: every dot of a tier sits closer to the centre than every dot of the next tier'), failed(page).join('; '));
});

test('a card with no tier drawn inside the tier bands fails, and so does an Unnested card inside the fan', async () => {
  const inside = await run({ dots: (key, all) => { if (key === 'plan') all[3] = { x: 40, y: 40 }; return all; } });
  assert.ok(failed(inside).includes('plan: the cards with no tier sit outside every tier band'), failed(inside).join('; '));
  const unnested = await run({ dots: (key, all) => { if (key === 'plan') all[9] = { x: 200, y: 200 }; return all; } });
  assert.ok(failed(unnested).includes('plan: the Unnested cards sit outside the fan'), failed(unnested).join('; '));
});

test('a NaN position fails, on the plan board and on the others', async () => {
  for (const key of ['plan', 'fixture', 'malformed']) {
    const page = await run({ dots: (k, all) => { if (k === key) all[1] = null; return all; } });
    assert.ok(failed(page).includes(`${key}: no dot position is NaN`), `${key}: ${failed(page).join('; ')}`);
  }
});

test('an archived card drawn before the Archive pill is on fails, and so does one the pill does not bring', async () => {
  const early = await run({ dots: (key, all) => { if (key === 'plan') all[19] = { x: 300, y: 300 }; return all; } });
  assert.ok(failed(early).includes('plan: every live card is drawn, and no archived one'), failed(early).join('; '));
  const never = await run({ archiveDraws: false });
  assert.ok(failed(never).includes('plan: the Archive pill draws the archived cards'), failed(never).join('; '));
});

test('fixture rings that do not follow depth fail', async () => {
  const page = await run({
    dots: (key, all) => {
      if (key === 'fixture') all[7] = { x: all[2].x, y: all[2].y };
      return all;
    },
  });
  assert.ok(failed(page).includes('fixture: the rings follow depth, one ring for each depth'), failed(page).join('; '));
});

test('a malformed board whose tiers are not bands fails', async () => {
  const page = await run({ edges: (key, edges) => (key === 'malformed' ? { ...edges, tiers: [edges.tiers[0]] } : edges) });
  assert.ok(failed(page).includes('malformed: the two tiers are bands, the first nearer the centre'), failed(page).join('; '));
});

// --- the captions, arcs, dividers and the block -------------------------------------------------

test('captions out of hierarchy order, a missing tier caption or a wrong count fail', async () => {
  const swapped = await run({ marks: (key, m) => { if (key === 'plan') [m.captions[0], m.captions[1]] = [m.captions[1], m.captions[0]]; return m; } });
  assert.ok(failed(swapped).includes('plan: each tier that has a card shows one caption with its name and count, in hierarchy order from the centre'), failed(swapped).join('; '));
  const missing = await run({ marks: (key, m) => { if (key === 'plan') m.captions = m.captions.filter((c) => c.name !== 'objective'); return m; } });
  assert.ok(failed(missing).includes('plan: each tier that has a card shows one caption with its name and count, in hierarchy order from the centre'));
  const wrong = await run({ marks: (key, m) => { if (key === 'plan') m.captions[3].count = 9; return m; } });
  assert.ok(failed(wrong).includes('plan: each tier that has a card shows one caption with its name and count, in hierarchy order from the centre'));
});

test('a depth caption for an empty depth, or one missing, fails', async () => {
  const extra = await run({ marks: (key, m) => { if (key === 'plan') m.captions.push({ name: 'depth 3', count: 0, kind: 'depth', x: -900, y: 0 }); return m; } });
  assert.ok(failed(extra).includes('plan: one caption per non-empty depth follows, in depth order'), failed(extra).join('; '));
  const short = await run({ marks: (key, m) => { if (key === 'plan') m.captions = m.captions.filter((c) => c.name !== 'depth 4'); return m; } });
  assert.ok(failed(short).includes('plan: one caption per non-empty depth follows, in depth order'));
});

test('a NaN in an arc, a divider or a caption fails the finite check, on each board', async () => {
  for (const [what, tamper] of [
    ['an arc', (m) => { m.guides[0] = 'MNaN 0A10 10 0 0 0 5 5'; }],
    ['a divider', (m) => { m.dividers[0][2] = NaN; }],
    ['a caption', (m) => { m.captions[0].x = NaN; }],
    ['a block caption', (m) => { m.block.captions[0].y = Infinity; }],
  ]) {
    const page = await run({ marks: (key, m) => { if (key === 'plan') tamper(m); return m; } });
    assert.ok(failed(page).includes('plan: every guide arc, divider and caption has finite coordinates'), `${what}: ${failed(page).join('; ')}`);
  }
  for (const key of ['fixture', 'malformed']) {
    const page = await run({ marks: (k, m) => { if (k === key) m.guides[0] = 'MNaN 0A10 10 0 0 0 5 5'; return m; } });
    assert.ok(failed(page).includes(`${key}: every guide arc, divider and caption has finite coordinates`), `${key}: ${failed(page).join('; ')}`);
  }
});

test('loose cards with a tier in two sectors, or a caption that counts them wrong, fail', async () => {
  const split = await run({ sectors: (key, sectors) => { if (key === 'plan') sectors.push({ kind: 'loose', tops: [99], from: 0.2, to: 0.1 }); return sectors; } });
  assert.ok(failed(split).includes('plan: the loose cards with a tier share one sector, under a caption that counts them'), failed(split).join('; '));
  const count = await run({ marks: (key, m) => { if (key === 'plan' && m.loose) m.loose.count = 3; return m; } });
  assert.ok(failed(count).includes('plan: the loose cards with a tier share one sector, under a caption that counts them'));
  const twoApart = await run({ sectors: (key, sectors, { extra }) => {
    if (key === 'plan' && extra.length) sectors.find((s) => s.kind === 'loose').to = sectors.find((s) => s.kind === 'loose').from - 1e-9;
    return sectors;
  } });
  assert.ok(failed(twoApart).includes('plan: the loose cards with a tier, two now, still share one sector, and its caption counts both'), failed(twoApart).join('; '));
});

test('the second loose card with a tier is created, and the caption must count both', async () => {
  const page = await run();
  assert.ok(page.checks.some(([n, ok]) => ok && n === 'plan: a second loose card with a tier is created'));
  const one = await run({ marks: (key, m, { extra }) => { if (key === 'plan' && extra.length && m.loose) m.loose.count = 1; return m; } });
  assert.ok(failed(one).includes('plan: the loose cards with a tier, two now, still share one sector, and its caption counts both'), failed(one).join('; '));
});

test('a block column captioned for the wrong status, or a loose card under the wrong caption, fails', async () => {
  const swapped = await run({ marks: (key, m) => {
    if (key === 'plan' && m.block) [m.block.captions[0].name, m.block.captions[1].name] = [m.block.captions[1].name, m.block.captions[0].name];
    return m;
  } });
  assert.ok(failed(swapped).includes('plan: every loose card without a tier is in the block under the caption for its status'), failed(swapped).join('; '));
  assert.ok(failed(swapped).includes('plan: the Unnested block is titled with its count and has a column caption for each status, in the board\'s order'));
  const title = await run({ marks: (key, m) => { if (key === 'plan' && m.block) m.block.title.count = 5; return m; } });
  assert.ok(failed(title).includes('plan: the Unnested block is titled with its count and has a column caption for each status, in the board\'s order'));
  const noBlock = await run({ marks: (key, m) => { if (key === 'plan') m.block = null; return m; } });
  assert.ok(failed(noBlock).includes('plan: every loose card without a tier is in the block under the caption for its status'));
});

test('an Unnested card standing on a ring fails', async () => {
  const ring = drawn('plan', false).layout.bands[1].rings[0];
  const page = await run({
    dots: (key, all) => {
      if (key === 'plan') all[9] = { x: -ring, y: 0 };
      return all;
    },
  });
  assert.ok(failed(page).includes('plan: and none of them is on a ring'), failed(page).join('; '));
  assert.ok(failed(page).includes('plan: there is a guide arc for each band, and none is drawn through the cards of the Unnested block'));
});

test('an archived loose card without a tier missing from the archived column fails', async () => {
  const page = await run({ marks: (key, m, { archiveOn }) => {
    if (key === 'plan' && archiveOn && m.block) m.block.captions = m.block.captions.filter((c) => c.name !== 'archived');
    return m;
  } });
  assert.ok(failed(page).includes('plan: with the Archive pill on, an archived loose card without a tier shows in the block\'s archived column'), failed(page).join('; '));
});

test('a first draw or a Fit that leaves a dot, a caption or the block outside the canvas fails', async () => {
  const first = await run({ zoomFactor: (phase, key) => (key === 'plan' && phase === 'fitted' ? 2 : 1) });
  assert.ok(failed(first).includes('plan: the first draw frames every dot, every caption and the Unnested block'), failed(first).join('; '));
  const fit = await run({ fitDoesNothing: true });
  assert.ok(failed(fit).includes('plan: after Fit every dot, every caption and the Unnested block lie inside the canvas'), failed(fit).join('; '));
  const caption = await run({ rects: (key, r, phase) => {
    if (key === 'plan' && phase === 'fitted') r.captions[0] = { ...r.captions[0], t: r.stage.t - 30 };
    return r;
  } });
  assert.ok(failed(caption).includes('plan: the first draw frames every dot, every caption and the Unnested block'));
  const block = await run({ rects: (key, r) => { if (key === 'fixture' && r.block) r.block.r = r.stage.r + 50; return r; } });
  assert.ok(failed(block).includes('fixture: the first draw frames every dot, every caption and the Unnested block'));
});

test('a star-typed card drawn round, or an unknown icon drawn as a shape, fails', async () => {
  const round = await run({ shapes: (key, s) => { if (key === 'plan') s[1] = 'circle'; return s; } });
  assert.ok(failed(round).includes('plan: in the fan a star-typed card\'s dot is a star'), failed(round).join('; '));
  const shaped = await run({ shapes: (key, s) => { if (key === 'plan') s[14] = 'square'; return s; } });
  assert.ok(failed(shaped).includes('plan: and a card of the unknown-icon type has a round dot'));
});

test('Force or Status that keep the fan, or Tiers that does not bring it back, fail', async () => {
  const stays = await run({ fanStays: true });
  assert.ok(failed(stays).includes('plan: force draws no arc, caption, divider or block'), failed(stays).join('; '));
  assert.ok(failed(stays).includes('plan: status draws no arc, caption, divider or block'));
  const gone = await run({ marks: (key, m, { switched }) => {
    if (key === 'plan' && switched) m.block = null;
    return m;
  } });
  assert.ok(failed(gone).includes('plan: back in Tiers the arcs, captions, dividers and block are back'), failed(gone).join('; '));
});

test('the fixture board with a tier caption, and the malformed board with a tier twice, fail', async () => {
  const tier = await run({ marks: (key, m) => { if (key === 'fixture') m.captions[1].kind = 'tier'; return m; } });
  assert.ok(failed(tier).includes('fixture: the fan shows depth captions and no tier caption'), failed(tier).join('; '));
  const twice = await run({ marks: (key, m) => { if (key === 'malformed') m.captions.splice(1, 0, { ...m.captions[0] }); return m; } });
  assert.ok(failed(twice).includes('malformed: the fan captions each tier once'), failed(twice).join('; '));
});

// --- the scenario's own helpers --------------------------------------------------------------------------

test('outsideStage names what lies outside the stage, with a pixel of slack', () => {
  const stage = { l: 0, t: 0, r: 100, b: 50 };
  const r = {
    stage,
    dots: [{ id: '1', l: 10, t: 10, r: 20, b: 20 }, { id: '2', l: -0.5, t: 10, r: 20, b: 20 }, { id: '3', l: 90, t: 10, r: 102, b: 20 }],
    captions: [{ text: 'goal2', l: 10, t: -5, r: 30, b: 5 }],
    block: { l: 80, t: 40, r: 99, b: 60 },
  };
  assert.deepStrictEqual(scenario.outsideStage(r), ['dot 3', 'caption goal2', 'the Unnested block']);
  assert.deepStrictEqual(scenario.outsideStage({ stage, dots: [], captions: [], block: null }), []);
});

test('finiteMarks wants arcs, captions and finite numbers everywhere', () => {
  const cap = { name: 'goal', count: 2, kind: 'tier', x: -10, y: 0 };
  const ok = { guides: ['M-88 0A88 88 0 0 0 87.14 12.25'], dividers: [[0, 0, 5, 5]], captions: [cap], loose: null, block: null };
  assert.strictEqual(scenario.finiteMarks(ok), true);
  assert.strictEqual(scenario.finiteMarks({ ...ok, guides: [] }), false);
  assert.strictEqual(scenario.finiteMarks({ ...ok, captions: [] }), false);
  assert.strictEqual(scenario.finiteMarks({ ...ok, guides: ['M-88 0A88 88 0 0 0 NaN 12.25'] }), false);
  assert.strictEqual(scenario.finiteMarks({ ...ok, dividers: [[0, 0, NaN, 5]] }), false);
  assert.strictEqual(scenario.finiteMarks({ ...ok, captions: [{ ...cap, y: null }] }), false);
  assert.strictEqual(scenario.finiteMarks({ ...ok, loose: { ...cap, name: '' } }), false);
  assert.strictEqual(scenario.finiteMarks(null), false);
});

test('the scenario waits on the page, never on a fixed sleep', () => {
  const src = require('node:fs').readFileSync(require.resolve('./browser/scenarios/tier-fan'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
  assert.ok(!/page\.sleep|setTimeout/.test(src));
});

test('every scenario expression parses, so a typo does not wait for CI', () => {
  const exprs = [scenario.DOTS, scenario.BAND_EDGES, scenario.FAN_MARKS, scenario.SECTORS, scenario.RECTS, scenario.TIERS_PRESSED, scenario.DRAWN,
    scenario.ARCHIVE_PILL, scenario.FIT, scenario.ZOOM_IN, scenario.FITTED, scenario.ZOOMED, scenario.layoutIs('force'), scenario.pickLayout('status'),
    scenario.addLoose(scenario.CASES.plan.extraLoose), scenario.hasDot(19), DOT_SHAPES];
  for (const e of exprs) assert.doesNotThrow(() => new vm.Script(e), e.slice(0, 60));
});
