const { test, after } = require('node:test');
const { isPanelProbe } = require('./browser/panel');
const assert = require('node:assert');
const vm = require('node:vm');

const scenario = require('./browser/scenarios/tier-fan');
const scenarios = require('./browser/scenarios');
const { DOT_SHAPES } = require('./browser/scenarios/type-icons');
const {
  graphBuild, graphFanPlace, graphLayout, graphPlan, graphFit, graphZoomAt, graphTipAt,
} = require('./../web/graph-model');
const { parseSearchQuery, filterCards } = require('./../web/search');
const { loadBoard, cleanUp, captionRects } = require('./helpers/fan-boards');

// The tier-fan scenario only runs in a browser (in CI). Here its lists are held
// to the real board readers and the Graph model over each fixture board's own
// cards, and its logic runs against a stand-in page that answers from the real
// layout and plan, with the drawing varied so a scenario that could never fail is
// caught.

after(cleanUp);

const BOARDS = { plan: loadBoard('plan'), fixture: loadBoard('fixture'), malformed: loadBoard('malformed') };
const sorted = (ids) => ids.map(Number).sort((a, b) => a - b);

// What the page draws on `key`: the model of the cards it shows, the layout and the plan.
// `unnested` is the board's Unnested option (the page opens with the outermost ring; the
// scenario sets table, which draws the block it checks).
function drawn(key, archiveOn, extra = [], kind = 'tiers', query = '', unnested = undefined) {
  const board = BOARDS[key];
  const cards = board.all.concat(extra);
  const cut = query ? new Set(filterCards(cards, parseSearchQuery(query, board.name), { ...board.ctx, hierarchy: board.config.hierarchy }).map((c) => c.id)) : null;
  const visible = cards.filter((c) => (archiveOn || !c.archived) && (!cut || cut.has(c.id))).map((c) => c.id);
  const model = graphBuild(cards, { ctx: board.ctx, hierarchy: board.config.hierarchy, types: board.config.types, visibleIds: new Set(visible) });
  const shown = kind === 'tiers' ? 'hierarchy' : kind;
  const layout = graphLayout(model, shown, { statuses: board.config.statuses, unnested });
  const plan = graphPlan(model, layout, { kind: shown, statusClass: (s) => s, titleOf: (c) => c.title });
  return { model, layout, plan, place: kind === 'tiers' ? graphFanPlace(model, { statuses: board.config.statuses, unnested }) : null };
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
  assert.deepStrictEqual([...byDepth.keys()].sort((a, b) => a - b), [0, 1]);
  assert.deepStrictEqual([0, 1].map((d) => sorted(byDepth.get(d))), want.depths.map(sorted));
  assert.deepStrictEqual(sorted(block), sorted(want.block));
  assert.deepStrictEqual(sorted(BOARDS.plan.all.filter((c) => c.archived).map((c) => c.id)), want.archived);
  assert.deepStrictEqual(sorted(model.nodes.map((n) => n.id)), sorted(want.tiers.flat().concat(want.depths.flat(), want.block)));
  const types = new Map(BOARDS.plan.live.map((c) => [c.id, c.type]));
  assert.deepStrictEqual(want.tiers.map((ids) => [...new Set(ids.map((id) => types.get(String(id))))]), [['goal'], ['strategy'], ['objective'], ['epic']]);
});

test('the plan board\'s names, columns, loose card and icon cards are the real board\'s', () => {
  const want = scenario.CASES.plan;
  const { model, place } = drawn('plan', false);
  assert.deepStrictEqual(want.tierNames, BOARDS.plan.config.hierarchy);
  assert.deepStrictEqual(want.depthNames, [0, 1].map((d) => `depth ${d}`));
  const columns = Object.fromEntries(place.columns.map((c) => [c.label, sorted(c.ids)]));
  assert.deepStrictEqual(columns, Object.fromEntries(Object.entries(want.blockColumns).map(([s, ids]) => [s, sorted(ids)])));
  assert.deepStrictEqual(Object.keys(want.blockColumns), BOARDS.plan.config.statuses);
  const loose = place.sectors.find((s) => s.kind === 'loose');
  assert.deepStrictEqual(sorted(loose.tops), want.looseTier);
  const archived = drawn('plan', true);
  assert.deepStrictEqual(sorted(archived.place.columns.find((c) => c.label === 'archived').ids), want.archivedBlock);
  const types = new Map(BOARDS.plan.all.map((c) => [c.id, c.type]));
  assert.strictEqual(types.get(String(want.starCard)), 'goal');
  assert.strictEqual(BOARDS.plan.config.types.find((t) => t.name === 'goal').icon, 'star');
  assert.strictEqual(types.get(String(want.unknownIconCard)), 'bug');
  assert.strictEqual(BOARDS.plan.config.types.find((t) => t.name === 'bug').icon, 'blob');
  assert.ok(model.byId.has(String(want.starCard)) && model.byId.has(String(want.unknownIconCard)));
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
  assert.deepStrictEqual(want.depthNames, ['depth 0', 'depth 1', 'depth 2']);
});

test('the malformed board names two tiers, each twice, a depth ring and a loose card', () => {
  const { model, place, layout } = drawn('malformed', false, [], 'tiers', '', 'table');
  const want = scenario.CASES.malformed;
  assert.deepStrictEqual(BOARDS.malformed.config.hierarchy, ['Goal', 'goal', 'Epic', 'EPIC']);
  assert.deepStrictEqual(layout.bands.filter((b) => b.slice.kind === 'tier').map((b) => b.count), [1, 1]);
  assert.deepStrictEqual(want.tiers.map((ids) => ids.map((id) => model.axis[place.places.get(String(id)).band].kind)), [['tier'], ['tier']]);
  assert.strictEqual(model.axis[place.places.get('3').band].depth, 0);
  assert.strictEqual(place.places.get('4').block, 'done');
});

// A stand-in for the page: each expression the scenario evaluates is answered
// from what the page would draw, on a stage of STAGE. `over` changes what it
// answers: dots, edges, marks, sectors, shapes, rects, zoomFactor, tipLines, tip and
// the flags below.
const STAGE = { l: 0, t: 120, r: 1500, b: 900 };

// Where the stage frames the fan: Fit on STAGE, zoomed in once if the page was, and
// the zoom factor the test asks for on top.
function frameOf(v, zoomed, factor) {
  const w = STAGE.r - STAGE.l;
  const h = STAGE.b - STAGE.t;
  let fit = graphFit(v.layout.bounds, w, h);
  if (zoomed) fit = graphZoomAt(fit, w / 2, h / 2, 1.5);
  if (factor !== 1) fit = { ...fit, k: fit.k * factor };
  return fit;
}

// What the page measures on screen at `fit`: the stage, each dot, each caption (the
// text boxes the helpers measure) and the block's frame.
function screenRects(v, fit) {
  const sx = (x) => STAGE.l + fit.x + x * fit.k;
  const sy = (y) => STAGE.t + fit.y + y * fit.k;
  const plan = v.plan;
  const captions = captionRects(plan, fit).map((r) => ({ text: r.name, l: STAGE.l + r.l, t: STAGE.t + r.t, r: STAGE.l + r.r, b: STAGE.t + r.b }));
  const b = plan.block;
  return {
    stage: STAGE,
    dots: plan.nodes.map((n) => ({ id: String(n.id), l: sx(n.x) - n.reach * fit.k, t: sy(n.y) - n.reach * fit.k, r: sx(n.x) + n.reach * fit.k, b: sy(n.y) + n.reach * fit.k })),
    captions,
    block: b ? { l: sx(b.x), t: sy(b.y), r: sx(b.x + b.w), b: sy(b.y + b.h) } : null,
  };
}

// The four ends of the outermost ring on screen, with the stage.
function screenCircle(v, fit) {
  const R = Math.max(0, ...v.layout.rings.map((r) => r.r));
  const at = (x, y) => ({ x: STAGE.l + fit.x + x * fit.k, y: STAGE.t + fit.y + y * fit.k });
  return { stage: STAGE, points: [at(-R, 0), at(R, 0), at(0, -R), at(0, R)] };
}

function standIn(over = {}) {
  const checks = [];
  let key = null;
  let archiveOn = false;
  let kind = 'tiers';
  let extra = [];
  let zoomed = false;
  let switched = 0;
  let query = '';
  let shownFor = null;
  let framePending = false;
  const points = new Map();
  const opened = [];
  const tables = new Set();
  const view = () => drawn(key, archiveOn, extra, kind, query, tables.has(key) ? 'table' : undefined);
  const captionsOf = () => {
    const { plan } = view();
    return plan.captions.concat(plan.looseCaption ? [plan.looseCaption] : [], plan.block ? [plan.block.title].concat(plan.block.columns.map((c) => c.caption)) : []);
  };
  // The tooltip the page shows for the caption the pointer or focus is on: its lines, and
  // where it stands on the stage beside the caption, 160 by 60 pixels.
  const tipNow = () => {
    const c = shownFor === null ? null : captionsOf().find((x) => x.name === shownFor);
    if (!c) return null;
    const v = view();
    const rect = screenRects(v, frameOf(v, zoomed, 1)).captions.find((r) => r.text === c.name);
    const at = graphTipAt({ x0: rect.l - STAGE.l, y0: rect.t - STAGE.t, x1: rect.r - STAGE.l, y1: rect.b - STAGE.t }, { w: STAGE.r - STAGE.l, h: STAGE.b - STAGE.t }, { w: 160, h: 60 }, 6);
    const lines = c.tip.lines.concat(c.tip.term ? [c.tip.term] : []);
    const t = {
      lines: over.tipLines ? over.tipLines(c.name, lines) : lines,
      tip: { l: STAGE.l + at.x, t: STAGE.t + at.y, r: STAGE.l + at.x + 160, b: STAGE.t + at.y + 60 },
      stage: STAGE,
      described: c.name,
      caption: { l: rect.l, t: rect.t, r: rect.r, b: rect.b },
    };
    return over.tip ? over.tip(c.name, t) : t;
  };
  const marksOf = () => {
    const { plan } = over.fanStays ? drawn(key, archiveOn, extra, 'tiers', query, tables.has(key) ? 'table' : undefined) : view();
    const cap = (c) => ({
      name: c.name, text: over.countInText ? `${c.name}${c.count}` : c.name, count: parseInt(c.tip.lines[0], 10), kind: c.kind || '',
      tabindex: over.noTabStop ? null : '0', x: c.x, y: c.y,
    });
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
      framePending = false;
      query = '';
      shownFor = null;
      points.clear();
      opened.push(`${k}${p}`);
    },
    mouse: async (type, x, y) => {
      if (type !== 'mouseMoved') return true;
      const name = points.get(`${x},${y}`) || null;
      if (name === null && over.tipStuck) return true;
      shownFor = over.tipNever ? null : name;
      if (framePending) { framePending = false; shownFor = null; }
      return true;
    },
    waitFor: async (expr) => {
      if (isPanelProbe(expr)) return true;
      if (expr === '!window.__stale') return true;
      if (expr === `${scenario.DRAWN}&&${scenario.TIERS_PRESSED}`) return true;
      const more = /^.*&&document\.querySelectorAll\('#graph-view \.graph-node'\)\.length>(\d+)$/.exec(expr);
      if (more) return view().plan.nodes.length > Number(more[1]);
      if (expr === scenario.TABLE_DRAWN) return tables.has(key);
      if (expr === scenario.ZOOMED) return zoomed;
      if (expr === scenario.FITTED) return !zoomed;
      for (const name of ['tiers', 'flow']) if (expr === scenario.layoutIs(name)) return kind === name;
      if (expr === scenario.TIP_HIDDEN) return tipNow() === null;
      const lined = /JSON\.stringify\(\[\.\.\.t\.children\]\.map\(\(p\)=>p\.textContent\)\)===("(?:[^"\\]|\\.)*")\}\)\(\)$/.exec(expr);
      if (lined) {
        const t = tipNow();
        return !!t && JSON.stringify(t.lines) === JSON.parse(lined[1]);
      }
      const dotted = /\.sort\(\(a,b\)=>a-b\)\)===("\[[\d,]*\]")$/.exec(expr);
      if (dotted) return JSON.stringify([...new Set(view().plan.nodes.map((n) => Number(n.id)))].sort((a, b) => a - b)) === JSON.parse(dotted[1]);
      const counted = /^document\.querySelectorAll\('#graph-view \.graph-node'\)\.length===(\d+)$/.exec(expr);
      if (counted) return view().plan.nodes.length === Number(counted[1]);
      const ids = [...expr.matchAll(/data-id="(\d+)"/g)].map((m) => Number(m[1]));
      if (ids.length) return over.archiveDraws === false ? false : archiveOn && ids.every((id) => view().model.byId.has(String(id)));
      throw new Error(`the stand-in page was asked to wait on something it does not know: ${expr.slice(0, 80)}`);
    },
    ev: async (expr) => {
      if (isPanelProbe(expr)) return true;
      if (expr === 'window.__stale=true') return true;
      if (expr === scenario.DOTS) return dotsOf();
      if (expr === scenario.BAND_EDGES) {
        const bands = view().layout.bands;
        const edges = { tiers: bands.filter((b) => !!b.slice && b.slice.kind === 'tier').map((b) => b.r1), outer: bands.length ? bands[bands.length - 1].r1 : 0 };
        return over.edges ? over.edges(key, edges) : edges;
      }
      if (expr === scenario.USE_TABLE) { if (!over.ignoreTable) tables.add(key); return true; }
      if (expr === scenario.FAN_MARKS) return marksOf();
      if (expr === scenario.NO_COUNT) return over.countElements ? 1 : 0;
      if (expr === scenario.EMPTY_POINT) return over.noEmptyPoint ? null : { x: 5, y: 5 };
      if (expr === scenario.TIP) return tipNow();
      if (expr === scenario.BLUR) { if (!over.tipStuck) shownFor = null; return true; }
      if (expr === scenario.POLL) { if (over.pollDropsFocus) shownFor = null; return true; }
      for (const name of Object.keys(scenario.CASES.plan.tips)) {
        if (expr === scenario.focusedCaption(name)) return shownFor === name;
        if (expr === scenario.captionCentre(name)) {
          if (!captionsOf().some((c) => c.name === name)) return null;
          const p = { x: 100 + points.size, y: 300 };
          points.set(`${p.x},${p.y}`, name);
          return p;
        }
        if (expr === scenario.focusCaption(name)) {
          const present = captionsOf().some((c) => c.name === name);
          if (present && !over.focusNoTip) shownFor = name;
          return present;
        }
      }
      const typed = /^\(\(\)=>\{const i=document\.getElementById\('search-input'\);i\.value=("(?:[^"\\]|\\.)*");/.exec(expr);
      if (typed) { query = over.ignoreQuery ? '' : JSON.parse(typed[1]); return true; }
      if (expr === scenario.SECTORS) {
        const sectors = view().layout.sectors.map((s) => ({ kind: s.kind, tops: s.tops.map(Number), from: s.from, to: s.to }));
        return over.sectors ? over.sectors(key, sectors, { extra }) : sectors;
      }
      if (expr === scenario.RECTS) {
        const phase = zoomed ? 'zoomed' : 'fitted';
        const v = view();
        const r = screenRects(v, frameOf(v, zoomed, over.zoomFactor ? over.zoomFactor(phase, key) : 1));
        return over.rects ? over.rects(key, r, phase) : r;
      }
      if (expr === scenario.CIRCLE) {
        const phase = zoomed ? 'zoomed' : 'fitted';
        const v = view();
        const c = screenCircle(v, frameOf(v, zoomed, over.zoomFactor ? over.zoomFactor(phase, key) : 1));
        return over.circle ? over.circle(key, c, phase) : c;
      }
      if (expr === scenario.SWEEP) {
        const { fan } = view().layout;
        return over.sweep ? over.sweep(key, { from: fan.from, to: fan.to }) : { from: fan.from, to: fan.to };
      }
      if (expr === DOT_SHAPES) {
        const shapes = {};
        for (const n of view().plan.nodes) shapes[n.id] = n.shape;
        return over.shapes ? over.shapes(key, shapes) : shapes;
      }
      if (expr === scenario.ARCHIVE_PILL) { archiveOn = true; return true; }
      if (expr === scenario.ZOOM_IN) { zoomed = true; framePending = true; return true; }
      if (expr === scenario.FRAMES) { if (!over.framesDoNothing) framePending = false; return true; }
      if (expr === scenario.FIT) { zoomed = !!over.fitDoesNothing; return true; }
      for (const name of ['tiers', 'flow']) if (expr === scenario.pickLayout(name)) { kind = name; switched += name === 'tiers' ? 1 : 0; return true; }
      if (expr === scenario.addLoose(scenario.CASES.plan.extraLoose)) {
        extra = extra.concat([{
          id: '30', title: 'new', status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, type: 'objective',
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

test('each check listed here is in the scenario', async () => {
  const page = await run();
  const names = page.checks.map(([n]) => n);
  const has = (re) => assert.ok(names.some((n) => re.test(n)), `no check matches ${re}`);
  has(/plan: each tier that has a card shows one caption with its name, in hierarchy order from the centre, and its tip counts the cards/);
  has(/plan: one caption per non-empty depth follows/);
  has(/plan: every guide arc, divider and caption has finite coordinates/);
  has(/plan: the loose cards with a tier share one sector, under a caption whose tip counts them/);
  has(/plan: every caption of the fan shows its name alone, with no count in its text, and is a tab stop/);
  has(/plan: hovering a caption shows its count, its split by status and the slice: term to type in a tooltip, whole on the stage and clear of the caption/);
  has(/plan: moving the pointer off a caption hides the tooltip/);
  has(/plan: keyboard focus on a caption shows the same tooltip, and moving focus off it hides the tooltip/);
  has(/plan: typing the term a tooltip names cuts the Graph to the cards of that band/);
  has(/plan: every loose card without a tier is in the block under the caption for its status/);
  has(/plan: and none of them is on a ring/);
  has(/plan: every live card is drawn, and no archived one/);
  has(/plan: with the Archive pill on, an archived loose card without a tier shows in the block's archived column/);
  has(/plan: after Fit every dot, every caption and the Unnested block lie inside the canvas/);
  has(/plan: the first draw frames every dot, every caption and the Unnested block/);
  has(/plan: the first draw frames the whole circle/);
  has(/plan: after Fit the whole circle lies inside the canvas/);
  has(/plan: no two captions overlap at the first draw/);
  has(/plan: no two captions overlap after Fit/);
  has(/fixture: the first draw frames the whole circle, and no two captions overlap/);
  has(/plan: the fan sweeps all but a narrow seam of the circle, and its dots are in every quarter of it/);
  has(/plan: no dot stands on the seam/);
  has(/plan: the captions stand up the seam at the top, neighbours on opposite sides of it/);
  has(/plan: in the fan a star-typed card's dot is a star/);
  has(/plan: and a card of the unknown-icon type has a round dot/);
  has(/plan: the flow draws no arc, caption, divider or block/);
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
  assert.ok(failed(swapped).includes('plan: each tier that has a card shows one caption with its name, in hierarchy order from the centre, and its tip counts the cards'), failed(swapped).join('; '));
  const missing = await run({ marks: (key, m) => { if (key === 'plan') m.captions = m.captions.filter((c) => c.name !== 'objective'); return m; } });
  assert.ok(failed(missing).includes('plan: each tier that has a card shows one caption with its name, in hierarchy order from the centre, and its tip counts the cards'));
  const wrong = await run({ marks: (key, m) => { if (key === 'plan') m.captions[3].count = 9; return m; } });
  assert.ok(failed(wrong).includes('plan: each tier that has a card shows one caption with its name, in hierarchy order from the centre, and its tip counts the cards'));
});

test('a depth caption for an empty depth, or one missing, fails', async () => {
  const extra = await run({ marks: (key, m) => { if (key === 'plan') m.captions.push({ name: 'depth 3', count: 0, kind: 'depth', x: -900, y: 0 }); return m; } });
  assert.ok(failed(extra).includes('plan: one caption per non-empty depth follows, in depth order'), failed(extra).join('; '));
  const short = await run({ marks: (key, m) => { if (key === 'plan') m.captions = m.captions.filter((c) => c.name !== 'depth 1'); return m; } });
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
  assert.ok(failed(split).includes('plan: the loose cards with a tier share one sector, under a caption whose tip counts them'), failed(split).join('; '));
  const count = await run({ marks: (key, m) => { if (key === 'plan' && m.loose) m.loose.count = 3; return m; } });
  assert.ok(failed(count).includes('plan: the loose cards with a tier share one sector, under a caption whose tip counts them'));
  const twoApart = await run({ sectors: (key, sectors, { extra }) => {
    if (key === 'plan' && extra.length) sectors.find((s) => s.kind === 'loose').to = sectors.find((s) => s.kind === 'loose').from - 1e-9;
    return sectors;
  } });
  assert.ok(failed(twoApart).includes('plan: the loose cards with a tier, two now, still share one sector, and its tip counts both'), failed(twoApart).join('; '));
});

test('the second loose card with a tier is created, and the caption must count both', async () => {
  const page = await run();
  assert.ok(page.checks.some(([n, ok]) => ok && n === 'plan: a second loose card with a tier is created'));
  const one = await run({ marks: (key, m, { extra }) => { if (key === 'plan' && extra.length && m.loose) m.loose.count = 1; return m; } });
  assert.ok(failed(one).includes('plan: the loose cards with a tier, two now, still share one sector, and its tip counts both'), failed(one).join('; '));
});

test('a block column captioned for the wrong status, or a loose card under the wrong caption, fails', async () => {
  const swapped = await run({ marks: (key, m) => {
    if (key === 'plan' && m.block) [m.block.captions[0].name, m.block.captions[1].name] = [m.block.captions[1].name, m.block.captions[0].name];
    return m;
  } });
  assert.ok(failed(swapped).includes('plan: every loose card without a tier is in the block under the caption for its status'), failed(swapped).join('; '));
  assert.ok(failed(swapped).includes('plan: the Unnested block is titled Unnested and has a column caption for each status, in the board\'s order, their tips counting the cards'));
  const title = await run({ marks: (key, m) => { if (key === 'plan' && m.block) m.block.title.count = 5; return m; } });
  assert.ok(failed(title).includes('plan: the Unnested block is titled Unnested and has a column caption for each status, in the board\'s order, their tips counting the cards'));
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

test('a fan over half the circle, or a dot on the seam, fails', async () => {
  const half = await run({ dots: (key, all) => {
    if (key === 'plan') for (const id of Object.keys(all)) if (all[id] && all[id].y < 0) all[id] = { x: all[id].x, y: -all[id].y };
    return all;
  } });
  assert.ok(failed(half).includes('plan: the fan sweeps all but a narrow seam of the circle, and its dots are in every quarter of it'), failed(half).join('; '));
  const short = await run({ sweep: (key, s) => (key === 'plan' ? { from: s.from, to: 0.3 } : s) });
  assert.ok(failed(short).includes('plan: the fan sweeps all but a narrow seam of the circle, and its dots are in every quarter of it'));
  const seam = await run({ dots: (key, all) => { if (key === 'plan') all[3] = { x: 0, y: -300 }; return all; } });
  assert.ok(failed(seam).includes('plan: no dot stands on the seam'), failed(seam).join('; '));
});

test('captions that do not stand up the seam, on opposite sides, fail', async () => {
  const oneSide = await run({ marks: (key, m) => { if (key === 'plan') for (const c of m.captions) c.x = -Math.abs(c.x); return m; } });
  assert.ok(failed(oneSide).includes('plan: the captions stand up the seam at the top, neighbours on opposite sides of it'), failed(oneSide).join('; '));
  const flat = await run({ marks: (key, m) => { if (key === 'plan') for (const c of m.captions) c.y = 0; return m; } });
  assert.ok(failed(flat).includes('plan: the captions stand up the seam at the top, neighbours on opposite sides of it'));
});

test('two captions on top of one another fail, at the first draw and after Fit, on the plan board and the fixture board', async () => {
  let reads = 0;
  const first = await run({ rects: (key, r) => {
    if (key === 'plan' && reads++ === 0) r.captions[1] = { ...r.captions[0], text: 'on top' };
    return r;
  } });
  assert.ok(failed(first).includes('plan: no two captions overlap at the first draw'), failed(first).join('; '));
  assert.ok(!failed(first).includes('plan: no two captions overlap after Fit'));
  const fit = await run({ rects: (key, r, phase) => {
    if (key === 'plan' && phase === 'fitted' && reads++ > 0) r.captions[1] = { ...r.captions[0], text: 'on top' };
    return r;
  } });
  assert.ok(failed(fit).includes('plan: no two captions overlap after Fit'), failed(fit).join('; '));
  const fixture = await run({ rects: (key, r) => { if (key === 'fixture') r.captions[1] = { ...r.captions[0], text: 'on top' }; return r; } });
  assert.ok(failed(fixture).includes('fixture: the first draw frames the whole circle, and no two captions overlap'), failed(fixture).join('; '));
});

test('a first draw or a Fit that leaves the circle outside the canvas fails', async () => {
  const first = await run({ zoomFactor: (phase, key) => (key === 'plan' && phase === 'fitted' ? 2 : 1) });
  assert.ok(failed(first).includes('plan: the first draw frames the whole circle'), failed(first).join('; '));
  const fit = await run({ fitDoesNothing: true });
  assert.ok(failed(fit).includes('plan: after Fit the whole circle lies inside the canvas'), failed(fit).join('; '));
  const top = await run({ circle: (key, c) => { if (key === 'plan') c.points[2].y = c.stage.t - 10; return c; } });
  assert.ok(failed(top).includes('plan: the first draw frames the whole circle'), failed(top).join('; '));
});

test('a star-typed card drawn round, or an unknown icon drawn as a shape, fails', async () => {
  const round = await run({ shapes: (key, s) => { if (key === 'plan') s[1] = 'circle'; return s; } });
  assert.ok(failed(round).includes('plan: in the fan a star-typed card\'s dot is a star'), failed(round).join('; '));
  const shaped = await run({ shapes: (key, s) => { if (key === 'plan') s[14] = 'square'; return s; } });
  assert.ok(failed(shaped).includes('plan: and a card of the unknown-icon type has a round dot'));
});

test('The Flow that keeps the fan, or Tiers that does not bring it back, fail', async () => {
  const stays = await run({ fanStays: true });
  assert.ok(failed(stays).includes('plan: the flow draws no arc, caption, divider or block'), failed(stays).join('; '));
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

// --- the tooltips ------------------------------------------------------------------------------------------

const NAME_ALONE = 'plan: every caption of the fan shows its name alone, with no count in its text, and is a tab stop';
const HOVER = 'plan: hovering a caption shows its count, its split by status and the slice: term to type in a tooltip, whole on the stage and clear of the caption';
const MOVE_OFF = 'plan: moving the pointer off a caption hides the tooltip';
const FOCUS = 'plan: keyboard focus on a caption shows the same tooltip, and moving focus off it hides the tooltip';
const POLLED = 'plan: a poll leaves keyboard focus on the caption that had it, with its tooltip showing';
const TERM = 'plan: typing the term a tooltip names cuts the Graph to the cards of that band';

test('the tooltip lines the scenario expects are the real plan\'s tips, caption by caption, the term last', () => {
  const { plan } = drawn('plan', false, [], 'tiers', '', 'table');
  const real = {};
  for (const c of plan.captions.concat([plan.looseCaption, plan.block.title], plan.block.columns.map((col) => col.caption))) {
    real[c.name] = c.tip.lines.concat(c.tip.term ? [c.tip.term] : []);
  }
  assert.deepStrictEqual(scenario.CASES.plan.tips, real);
});

test('a caption that draws its count in its text, with a count element, or that is not a tab stop, fails', async () => {
  const text = await run({ countInText: true });
  assert.ok(failed(text).includes(NAME_ALONE), failed(text).join('; '));
  const element = await run({ countElements: true });
  assert.ok(failed(element).includes(NAME_ALONE), failed(element).join('; '));
  const stop = await run({ noTabStop: true });
  assert.ok(failed(stop).includes(NAME_ALONE), failed(stop).join('; '));
  const alone = await run();
  assert.ok(alone.checks.some(([n, ok]) => ok && n === NAME_ALONE));
});

test('a tooltip with the wrong count, the wrong split or the wrong term fails the hover check, and so does one that never shows', async () => {
  for (const [what, edit, byKeyboard] of [
    ['count', (name, lines) => (name === 'goal' ? ['3 cards', ...lines.slice(1)] : lines), false],
    ['split', (name, lines) => (name === 'depth 1' ? [lines[0], 'backlog 4', lines[2]] : lines), true],
    ['term', (name, lines) => (name === 'epic' ? [lines[0], lines[1], 'slice:goal'] : lines), true],
    ['block title', (name, lines) => (name === 'Unnested' ? lines.slice(0, 1) : lines), true],
  ]) {
    const page = await run({ tipLines: edit });
    assert.ok(failed(page).includes(HOVER), `${what}: ${failed(page).join('; ')}`);
    assert.strictEqual(failed(page).includes(FOCUS), byKeyboard, `${what}: the keyboard check reads epic, depth 1, Unnested and done`);
  }
  const never = await run({ tipNever: true });
  assert.ok(failed(never).includes(HOVER), failed(never).join('; '));
  assert.ok(!failed(never).includes(FOCUS), 'the keyboard still shows it');
  const good = await run();
  assert.ok(good.checks.some(([n, ok]) => ok && n === HOVER));
});

// A zoom press leaves the page a frame to draw, and a Fit draws at once without calling it
// off, so the frame is still to come while the scenario measures and moves the pointer. The
// pointer's input is handled first in the frame the page draws it in and the frame's own
// transform, which takes a tooltip down, after: the tooltip of the first caption was lost.
test('a frame the zoom presses left to draw takes down a tooltip shown before it, so the scenario lets the page draw it before the pointer moves', async () => {
  const early = await run({ framesDoNothing: true });
  assert.ok(failed(early).includes(HOVER), failed(early).join('; '));
  const settled = await run();
  assert.deepStrictEqual(failed(settled), []);
  assert.ok(settled.checks.some(([n, ok]) => ok && n === HOVER));
});

test('a tooltip off the stage, or on top of the caption it describes, fails', async () => {
  const off = await run({ tip: (name, t) => (name === 'goal' ? { ...t, tip: { ...t.tip, r: t.stage.r + 40 } } : t) });
  assert.ok(failed(off).includes(HOVER), failed(off).join('; '));
  const over = await run({ tip: (name, t) => (name === 'depth 1' ? { ...t, tip: { l: t.caption.l, t: t.caption.t, r: t.caption.r + 100, b: t.caption.b + 4 } } : t) });
  assert.ok(failed(over).includes(HOVER), failed(over).join('; '));
  const other = await run({ tip: (name, t) => (name === 'done' ? { ...t, described: 'todo' } : t) });
  assert.ok(failed(other).includes(HOVER), 'the tooltip has to describe the caption the pointer is on');
});

test('a tooltip that stays when the pointer moves off, or when focus moves off, fails', async () => {
  const stuck = await run({ tipStuck: true });
  assert.ok(failed(stuck).includes(MOVE_OFF), failed(stuck).join('; '));
  assert.ok(failed(stuck).includes(FOCUS), failed(stuck).join('; '));
  const none = await run({ noEmptyPoint: true });
  assert.ok(failed(none).includes(MOVE_OFF), 'no empty corner to move to is a failure, not a pass');
  const fine = await run();
  assert.ok(fine.checks.some(([n, ok]) => ok && n === MOVE_OFF));
  assert.ok(fine.checks.some(([n, ok]) => ok && n === FOCUS));
});

test('a poll that drops the focus on a caption, and the tooltip with it, fails', async () => {
  const dropped = await run({ pollDropsFocus: true });
  assert.ok(failed(dropped).includes(POLLED), failed(dropped).join('; '));
  assert.ok(!failed(dropped).includes(FOCUS), 'focus alone is fine without a poll');
  const fine = await run();
  assert.ok(fine.checks.some(([n, ok]) => ok && n === POLLED));
});

test('keyboard focus that shows no tooltip, or the wrong one, fails', async () => {
  const none = await run({ focusNoTip: true });
  assert.ok(failed(none).includes(FOCUS), failed(none).join('; '));
  assert.ok(!failed(none).includes(HOVER), 'the pointer still shows it');
  const wrong = await run({ tipLines: (name, lines) => (name === 'Unnested' ? ['9 cards'] : lines) });
  assert.ok(failed(wrong).includes(FOCUS), failed(wrong).join('; '));
});

test('a term that does not cut the Graph to its band fails, and the box is emptied again after each cut', async () => {
  const ignored = await run({ ignoreQuery: true });
  assert.ok(failed(ignored).includes(TERM), failed(ignored).join('; '));
  const wrong = await run({ tipLines: (name, lines) => (name === 'epic' ? [...lines.slice(0, -1), 'slice:objective'] : lines) });
  assert.ok(failed(wrong).includes(TERM), failed(wrong).join('; '));
  const fine = await run();
  assert.ok(fine.checks.some(([n, ok]) => ok && n === TERM));
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

test('overlapping names the captions whose boxes share more than a pixel, and circleOutside the ends of the circle off the stage', () => {
  const box = (text, l, t, r, b) => ({ text, l, t, r, b });
  assert.deepStrictEqual(scenario.overlapping([box('a', 0, 0, 50, 10), box('b', 40, 5, 90, 15), box('c', 49.5, 0, 80, 10), box('d', 0, 20, 50, 30)]), ['a and b', 'b and c'], 'a and c share half a pixel, which is slack');
  assert.deepStrictEqual(scenario.overlapping([box('a', 0, 0, 50, 10), box('b', 0, 10, 50, 20)]), [], 'boxes that touch do not overlap');
  const stage = { l: 0, t: 0, r: 100, b: 100 };
  assert.deepStrictEqual(scenario.circleOutside({ stage, points: [{ x: 10, y: 50 }, { x: 90, y: 50 }, { x: 50, y: 10 }, { x: 50, y: 90 }] }), []);
  assert.strictEqual(scenario.circleOutside({ stage, points: [{ x: -1, y: 50 }, { x: 90, y: 50 }, { x: 50, y: 10 }, { x: 50, y: 101 }] }).length, 2);
  assert.strictEqual(scenario.circleOutside(null).length, 1, 'no circle is a failure');
});

test('turned reads an angle round the sweep, so a dot left of the seam is turned past the start of the sweep', () => {
  const sweep = { from: 1.5 * Math.PI - 0.1, to: -Math.PI / 2 + 0.1 };
  assert.ok(Math.abs(scenario.turned({ x: -1, y: 0 }, sweep) - Math.PI) < 1e-9);
  assert.ok(scenario.turned({ x: -0.5, y: -1 }, sweep) <= sweep.from, 'a dot beside the seam but outside it');
  assert.ok(scenario.turned({ x: 0, y: -1 }, sweep) > sweep.from, 'a dot straight up is in the seam');
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

test('the scenario sets the Unnested option to table on every board before it reads the block, and fails on a page that draws the ring instead', async () => {
  const page = await run();
  assert.deepStrictEqual(page.opened, ['plan/?view=graph', 'plan/?view=graph', 'fixture/?view=graph', 'malformed/?view=graph']);
  const ring = await run({ ignoreTable: true });
  assert.ok(failed(ring).includes('plan: the Unnested block is titled Unnested and has a column caption for each status, in the board\'s order, their tips counting the cards'), failed(ring).join('; '));
  assert.ok(failed(ring).includes('plan: every loose card without a tier is in the block under the caption for its status'), failed(ring).join('; '));
});

test('the scenario waits on the page, never on a fixed sleep', () => {
  const src = require('node:fs').readFileSync(require.resolve('./browser/scenarios/tier-fan'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
  assert.ok(!/page\.sleep|setTimeout/.test(src));
});

test('every scenario expression parses, so a typo does not wait for CI', () => {
  const exprs = [scenario.DOTS, scenario.BAND_EDGES, scenario.FAN_MARKS, scenario.SECTORS, scenario.SWEEP, scenario.CIRCLE, scenario.RECTS, scenario.TIERS_PRESSED, scenario.DRAWN,
    scenario.ARCHIVE_PILL, scenario.FIT, scenario.ZOOM_IN, scenario.FITTED, scenario.ZOOMED, scenario.FRAMES, scenario.layoutIs('flow'), scenario.pickLayout('tiers'),
    scenario.addLoose(scenario.CASES.plan.extraLoose), scenario.hasDot(19), DOT_SHAPES,
    scenario.NO_COUNT, scenario.BLUR, scenario.TIP, scenario.TIP_HIDDEN, scenario.EMPTY_POINT, scenario.captionCentre('goal'), scenario.focusCaption('Unnested, with a tier'),
    scenario.tipHas(['2 cards', 'backlog 1 · doing 1', 'slice:goal']), scenario.writeBox('slice:epic'), scenario.dotsAre([22, 3]), scenario.dotCountIs(26),
    scenario.USE_TABLE, scenario.TABLE_DRAWN, scenario.POLL, scenario.focusedCaption('epic')];
  for (const e of exprs) assert.doesNotThrow(() => new vm.Script(e), e.slice(0, 60));
});
