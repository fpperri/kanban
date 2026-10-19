const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scenario = require('./browser/scenarios/tier-fan-unnested');
const scenarios = require('./browser/scenarios');
const tierFan = require('./browser/scenarios/tier-fan');
const options = require('./browser/scenarios/tier-fan-options');
const {
  graphBuild, graphUnnestedIds, graphLayout, graphPlan, graphFit, graphZoomAt, GRAPH_FAN_OPTION_VALUES,
} = require('../web/graph-model');
const { loadBoard, cleanUp, captionRects } = require('./helpers/fan-boards');

// The tier-fan-unnested scenario only runs in a browser (in CI). Here its lists are held to the
// Graph model over each board's own cards, and its logic runs against a stand-in page that
// answers from the real model, layout and plan, with the page's behaviour varied so a scenario
// that could never fail is caught.

after(cleanUp);

const BOARDS = { plan: loadBoard('plan'), fixture: loadBoard('fixture'), malformed: loadBoard('malformed') };
const CASE = scenario.CASES;
const sorted = (ids) => ids.map(Number).sort((a, b) => a - b);

// What the page draws on `key` in `mode`, with the Archive pill on or off.
function drawn(key, mode, archiveOn = false, kind = 'tiers') {
  const board = BOARDS[key];
  const unnested = kind === 'tiers' ? mode : undefined;
  const visible = board.all.filter((c) => archiveOn || !c.archived).map((c) => c.id);
  const model = graphBuild(board.all, { ctx: board.ctx, hierarchy: board.config.hierarchy, types: board.config.types, visibleIds: new Set(visible), unnested });
  const layout = graphLayout(model, kind, { statuses: board.config.statuses, unnested });
  const plan = graphPlan(model, layout, { kind, statusClass: (s) => s, titleOf: (c) => c.title });
  return { model, layout, plan };
}

// --- the lists are the real boards' ---------------------------------------------------------------

test('the scenario is in the runner, on the plan board, with the fixture and malformed boards beside it', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'tier-fan-unnested'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['fixture', 'malformed']);
});

test('the modes the scenario names are the row\'s, and the default is the first', () => {
  assert.deepStrictEqual(sorted(CASE.plan.modes.map((m) => m.length)), sorted(GRAPH_FAN_OPTION_VALUES.unnested.map((m) => m.length)));
  assert.deepStrictEqual(CASE.plan.modes.slice().sort(), GRAPH_FAN_OPTION_VALUES.unnested.slice().sort());
  assert.strictEqual(GRAPH_FAN_OPTION_VALUES.unnested[0], 'outermost');
});

test('the unnested cards of each board are the model\'s: the plan board\'s thirteen live ones and the two archived, the fixture\'s ten, the malformed board\'s one', () => {
  for (const [key, want] of [['plan', CASE.plan.ring], ['fixture', CASE.fixture.ring], ['malformed', CASE.malformed.ring]]) {
    const board = BOARDS[key];
    const found = graphUnnestedIds(board.all, { ctx: board.ctx, hierarchy: board.config.hierarchy });
    const live = new Set(board.live.map((c) => c.id));
    assert.deepStrictEqual(sorted([...found].filter((id) => live.has(id))), sorted(want), key);
    assert.deepStrictEqual(sorted(board.live.map((c) => c.id)), sorted(CASE[key].live), `${key}'s live cards`);
  }
  const plan = BOARDS.plan;
  const archived = new Set(plan.all.filter((c) => c.archived).map((c) => c.id));
  assert.deepStrictEqual(sorted([...graphUnnestedIds(plan.all, { ctx: plan.ctx, hierarchy: plan.config.hierarchy })].filter((id) => archived.has(id))), CASE.plan.archived);
});

test('the plan board\'s ring is seated by status as the scenario lists it, and its relations are the ones it names', () => {
  const { layout, model } = drawn('plan', 'outermost');
  const turnOf = (id) => {
    const a = Math.atan2(layout.pos.get(String(id)).y, layout.pos.get(String(id)).x);
    return a < layout.fan.to - 1e-9 ? a + 2 * Math.PI : a;
  };
  assert.deepStrictEqual(CASE.plan.ring.slice().sort((a, b) => turnOf(b) - turnOf(a)), CASE.plan.ring);
  const statusOf = (id) => model.byId.get(String(id)).status;
  const groups = [];
  for (const id of CASE.plan.ring) if (!groups.length || groups[groups.length - 1][0] !== statusOf(id)) groups.push([statusOf(id), 1]); else groups[groups.length - 1][1]++;
  assert.deepStrictEqual(groups.map(([s, n]) => `${s} ${n}`), CASE.plan.split);
  const ringKeys = CASE.plan.ring.map(String);
  const touching = model.links.filter((l) => ringKeys.includes(l.from) || ringKeys.includes(l.to));
  assert.deepStrictEqual(touching.map((l) => [l.from, l.to, l.kind]), [[String(CASE.plan.wait.from), String(CASE.plan.wait.to), 'wait']]);
  assert.deepStrictEqual(CASE.plan.depthOne.map((id) => model.byId.get(String(id)).depth), [1, 1, 1, 1]);
  const withArchive = drawn('plan', 'outermost', true);
  const seats = CASE.plan.ring.concat(CASE.plan.archived);
  const turned = (id) => { const a = Math.atan2(withArchive.layout.pos.get(String(id)).y, withArchive.layout.pos.get(String(id)).x); return a < withArchive.layout.fan.to - 1e-9 ? a + 2 * Math.PI : a; };
  assert.deepStrictEqual(seats.slice().sort((a, b) => turned(b) - turned(a)), seats, 'archived cards last');
  assert.strictEqual(CASE.plan.picked, 27);
  assert.ok(CASE.plan.ring.includes(CASE.plan.picked));
});

test('the page globals and the helpers the scenario takes from the others are the scenarios\' own', () => {
  for (const name of ['DOTS', 'FAN_MARKS', 'SECTORS', 'SWEEP', 'RECTS', 'CIRCLE', 'BAND_EDGES', 'dotsAre', 'hasDot', 'turned', 'overlapping', 'outsideStage', 'circleOutside', 'layoutIs', 'pickLayout']) {
    assert.ok(tierFan[name] !== undefined, `tier-fan exports ${name}`);
  }
  for (const name of ['optionButton', 'ROW_STATE', 'ROW_SHOWN', 'pressedIs', 'SELECTED', 'dotPoint']) {
    assert.ok(options[name] !== undefined, `tier-fan-options exports ${name}`);
  }
});

// --- the stand-in page ------------------------------------------------------------------------------

const STAGE = { l: 0, t: 120, r: 1500, b: 900 };

function frameOf(v, zoomed, factor) {
  const w = STAGE.r - STAGE.l;
  const h = STAGE.b - STAGE.t;
  let fit = graphFit(v.layout.bounds, w, h);
  if (zoomed) fit = graphZoomAt(fit, w / 2, h / 2, 1.5);
  if (factor !== 1) fit = { ...fit, k: fit.k * factor };
  return fit;
}

function screenRects(v, fit) {
  const sx = (x) => STAGE.l + fit.x + x * fit.k;
  const sy = (y) => STAGE.t + fit.y + y * fit.k;
  const captions = captionRects(v.plan, fit).map((r) => ({ text: r.name, l: STAGE.l + r.l, t: STAGE.t + r.t, r: STAGE.l + r.r, b: STAGE.t + r.b }));
  const b = v.plan.block;
  return {
    stage: STAGE,
    dots: v.plan.nodes.map((n) => ({ id: String(n.id), l: sx(n.x) - n.reach * fit.k, t: sy(n.y) - n.reach * fit.k, r: sx(n.x) + n.reach * fit.k, b: sy(n.y) + n.reach * fit.k })),
    captions,
    block: b ? { l: sx(b.x), t: sy(b.y), r: sx(b.x + b.w), b: sy(b.y + b.h) } : null,
  };
}

function screenCircle(v, fit) {
  const R = Math.max(0, ...v.layout.rings.map((r) => r.r));
  const at = (x, y) => ({ x: STAGE.l + fit.x + x * fit.k, y: STAGE.t + fit.y + y * fit.k });
  return { stage: STAGE, points: [at(-R, 0), at(R, 0), at(0, -R), at(0, R)] };
}

const MODE_HANDLES = Object.fromEntries(GRAPH_FAN_OPTION_VALUES.unnested.map((m, i) => [m, { x: 300 + i, y: 1 }]));
const dotHandle = (id) => ({ x: 10000 + id, y: 1 });

// `over` changes what the page does: ringSpread (a function that moves dots), ungrouped, offKeepsLines,
// offKeepsSelection, forgets, forceHides, noCaption, captionOverDots, zoomFactor, rects, ignoresMode.
function standIn(over = {}) {
  const checks = [];
  let key = null;
  let kind = 'tiers';
  let archiveOn = false;
  let zoomed = false;
  let parts = [];
  const modes = {};
  const mode = () => (over.ignoresMode ? 'outermost' : modes[key] || 'outermost');
  const view = () => drawn(key, mode(), archiveOn, kind);
  const drawnIds = () => view().plan.nodes.map((n) => Number(n.id));
  const selected = () => {
    const shown = new Set(over.offKeepsSelection ? view().model.nodes.map((n) => Number(n.id)).concat(BOARDS[key].all.map((c) => Number(c.id))) : drawnIds());
    return parts.filter((id) => shown.has(id));
  };
  const rowOf = () => {
    if (kind !== 'tiers') return null;
    const values = GRAPH_FAN_OPTION_VALUES.unnested;
    return {
      label: 'Unnested',
      title: 'Where the cards with no parent, no children and no tier are drawn.',
      buttons: values.map((v) => ({ key: 'unnested', val: v, text: v, pressed: mode() === v, active: mode() === v, keeps: true, holds: false })),
    };
  };
  const marksOf = () => {
    const { plan } = view();
    const cap = (c) => ({
      name: c.name, text: c.name, count: parseInt(c.tip.lines[0], 10), kind: c.kind || '', tabindex: '0', x: c.x, y: c.y,
    });
    const b = plan.block;
    const m = {
      captions: plan.captions.map(cap),
      guides: plan.guides.map((g) => g.d),
      dividers: plan.dividers.map((d) => [d.x1, d.y1, d.x2, d.y2]),
      loose: plan.looseCaption ? cap(plan.looseCaption) : null,
      block: b ? { x: b.x, y: b.y, w: b.w, h: b.h, title: cap(b.title), captions: b.columns.map((c) => cap(c.caption)) } : null,
    };
    if (over.noCaption) m.captions = m.captions.filter((c) => c.name !== 'unnested');
    return m;
  };
  const dotsOf = () => {
    const out = {};
    for (const n of view().plan.nodes) out[n.id] = { x: n.x, y: n.y };
    if (key === 'plan' && over.ringSpread && mode() === 'outermost') over.ringSpread(out);
    if (key === 'plan' && over.ungrouped && mode() === 'outermost') { const t = out[11]; out[11] = out[12]; out[12] = t; }
    return out;
  };
  const touching = (ids) => {
    const keeps = over.offKeepsLines && mode() === 'off' && ids.includes(CASE.plan.wait.to);
    const v = view();
    return v.plan.links.filter((l) => ids.some((id) => String(id) === l.from || String(id) === l.to)).length + (keeps ? 1 : 0);
  };
  const press = (point) => {
    const m = Object.entries(MODE_HANDLES).find(([, h]) => h.x === point.x);
    if (m) { modes[key] = m[1] && m[0]; return; }
    if (point.x >= 10000) parts = [point.x - 10000];
  };
  return {
    checks,
    check: (name, ok) => checks.push([name, !!ok]),
    shot: async () => {},
    open: async (p, k) => {
      if (k !== key) { kind = 'tiers'; archiveOn = false; parts = []; }
      key = k;
      zoomed = false;
      if (over.forgets) delete modes[k];
    },
    centre: async (sel) => {
      for (const v of GRAPH_FAN_OPTION_VALUES.unnested) if (sel === options.optionButton('unnested', v)) return MODE_HANDLES[v];
      throw new Error(`the stand-in page was asked for the centre of something it does not know: ${sel}`);
    },
    click: async (x, y) => press({ x, y }),
    waitFor: async (expr) => {
      if (expr === '!window.__stale') return true;
      if (expr === `${tierFan.DRAWN}&&${tierFan.TIERS_PRESSED}`) return kind === 'tiers';
      for (const name of ['tiers', 'force', 'status']) if (expr === tierFan.layoutIs(name)) return kind === name;
      if (expr === options.ROW_SHOWN) return kind === 'tiers';
      for (const v of GRAPH_FAN_OPTION_VALUES.unnested) if (expr === options.pressedIs('unnested', v)) return mode() === v;
      if (expr === tierFan.ZOOMED) return zoomed;
      if (expr === tierFan.FITTED) return !zoomed;
      const dotted = /\.sort\(\(a,b\)=>a-b\)\)===("\[[\d,]*\]")$/.exec(expr);
      if (dotted) return JSON.stringify(sorted([...new Set(drawnIds())])) === JSON.parse(dotted[1]);
      const picked = /^\[\.\.\.selectedIds\]\.map\(Number\)\.sort\(\(a,b\)=>a-b\)\.length===(\d+)(?:&&\[\.\.\.selectedIds\]\.map\(Number\)\.sort\(\(a,b\)=>a-b\)\[0\]===(\d+))?$/.exec(expr);
      if (picked) {
        const now = selected();
        return now.length === Number(picked[1]) && (picked[2] === undefined || now[0] === Number(picked[2]));
      }
      const ids = [...expr.matchAll(/data-id="(\d+)"/g)].map((m) => Number(m[1]));
      if (ids.length) return ids.every((id) => drawnIds().includes(id));
      throw new Error(`the stand-in page was asked to wait on something it does not know: ${expr.slice(0, 100)}`);
    },
    ev: async (expr) => {
      if (expr === 'window.__stale=true') return true;
      if (expr === scenario.UNNESTED_ROW) return rowOf();
      if (expr === tierFan.DOTS) return dotsOf();
      if (expr === tierFan.SWEEP) { const { fan } = view().layout; return { from: fan.from, to: fan.to }; }
      if (expr === tierFan.FAN_MARKS) return marksOf();
      if (expr === tierFan.SECTORS) return view().layout.sectors.map((s) => ({ kind: s.kind, tops: s.tops.map(Number), from: s.from, to: s.to }));
      if (expr === tierFan.BAND_EDGES) {
        const bands = view().layout.bands;
        return { tiers: bands.filter((b) => !!b.slice && b.slice.kind === 'tier').map((b) => b.r1), outer: bands.length ? bands[bands.length - 1].r1 : 0 };
      }
      if (expr === tierFan.RECTS) {
        const v = view();
        const r = screenRects(v, frameOf(v, zoomed, over.zoomFactor ? over.zoomFactor(zoomed ? 'zoomed' : 'fitted', key) : 1));
        if (over.captionOverDots && mode() === 'outermost') {
          const c = r.captions.find((x) => x.text === 'unnested');
          const d = r.dots.find((x) => Number(x.id) === CASE.plan.ring[0]);
          if (c && d && key === 'plan') Object.assign(c, { l: d.l - 2, r: d.r + 2, t: d.t - 2, b: d.b + 2 });
        }
        return r;
      }
      if (expr === tierFan.CIRCLE) {
        const v = view();
        return screenCircle(v, frameOf(v, zoomed, over.zoomFactor ? over.zoomFactor(zoomed ? 'zoomed' : 'fitted', key) : 1));
      }
      if (expr === 'graphCur.layout.rings.length') return view().layout.rings.length;
      if (expr === 'graphCur.lines.length===document.querySelectorAll(\'#graph-view .graph-link\').length') return true;
      if (expr === scenario.linesTouching(CASE.plan.ring)) return touching(CASE.plan.ring);
      if (expr === options.SELECTED) return selected();
      if (expr === tierFan.ARCHIVE_PILL) { archiveOn = !archiveOn; return true; }
      if (expr === tierFan.ZOOM_IN) { zoomed = true; return true; }
      if (expr === tierFan.FIT) { zoomed = false; return true; }
      for (const name of ['tiers', 'force', 'status']) if (expr === tierFan.pickLayout(name)) { kind = name; return true; }
      const dot = /^\(\(\)=>\{const dot=document\.querySelector\('\.graph-node\[data-id="(\d+)"\] \.graph-dot'\)/.exec(expr);
      if (dot) return drawnIds().includes(Number(dot[1])) ? dotHandle(Number(dot[1])) : null;
      throw new Error(`the stand-in page was asked something it does not know: ${expr.slice(0, 100)}`);
    },
  };
}
const failed = (page) => page.checks.filter(([, ok]) => !ok).map(([n]) => n);
const run = async (over) => {
  const page = standIn(over);
  await scenario.run(page);
  return page;
};
const failsWith = async (over, re, why) => {
  const names = failed(await run(over));
  assert.ok(names.some((n) => re.test(n)), `${why}: ${names.join('; ') || 'no check failed'}`);
};

test('against the real model every check passes', async () => {
  const page = await run();
  assert.deepStrictEqual(failed(page), []);
  assert.ok(page.checks.length >= 60, `only ${page.checks.length} checks ran`);
});

test('each check listed here is in the scenario', async () => {
  const names = (await run()).checks.map(([n]) => n);
  const has = (re) => assert.ok(names.some((n) => re.test(n)), `no check matches ${re}`);
  has(/the option row offers Unnested with off, outermost, depth 0 and table, outermost marked at first/);
  has(/plan outermost: the unnested cards sit on one ring/);
  has(/plan outermost: and it is outside every other dot/);
  has(/plan outermost: grouped by status in the board's order/);
  has(/plan outermost: one caption, unnested, counts the cards/);
  has(/plan outermost: there is no Unnested block/);
  has(/plan outermost: the view frames every dot, every caption and the Unnested block/);
  has(/plan outermost: the view frames the whole circle/);
  has(/plan outermost: no two captions overlap/);
  has(/plan outermost: after Fit every dot, every caption and the Unnested block lie inside the canvas/);
  has(/plan outermost: the caption's text is clear of every dot of the ring/);
  has(/plan outermost: with the Archive pill on, the archived unnested cards are on the ring, after the others/);
  has(/plan off: the unnested cards are not drawn/);
  has(/plan off: no relation to a card that is drawn is drawn/);
  has(/plan off: the view frames every dot, every caption and the Unnested block/);
  has(/plan depth 0: the unnested cards sit on one ring, outside the tier bands and inside depth 1/);
  has(/plan depth 0: they share a sector of their own/);
  has(/plan depth 0: the ring is the depth 0 band, its caption depth 0 counts them/);
  has(/plan depth 0: no two captions overlap/);
  has(/plan table: the Unnested block is back, titled Unnested and counting the cards/);
  has(/plan table: after Fit every dot, every caption and the Unnested block lie inside the canvas/);
  has(/plan off: the card is out of the Graph, so out of the selection/);
  has(/plan outermost: it comes back with the card, selected as it was/);
  has(/plan: a reload keeps the mode: off is pressed/);
  has(/plan: Force, which has no such option, draws every live card whatever the mode/);
  has(/fixture: another board has chosen nothing/);
  has(/fixture: the unnested cards sit on one ring outside every other dot/);
  has(/malformed: the one unnested card is on a ring of its own/);
});

test('every mode is pressed through the row and every board is read with its own page', async () => {
  const page = await run();
  assert.ok(page.checks.length > 0);
});

// --- the page varied: each check can fail -------------------------------------------------------------

test('a ring that is not one ring, or one that is not outside every other dot, fails', async () => {
  await failsWith({ ringSpread: (all) => { all[9] = { x: all[9].x * 1.4, y: all[9].y * 1.4 }; } }, /plan outermost: the unnested cards sit on one ring/, 'a dot is further out');
  await failsWith({ ringSpread: (all) => { all[9] = { x: all[9].x * 0.2, y: all[9].y * 0.2 }; } }, /plan outermost: and it is outside every other dot/, 'a dot is inside');
});

test('cards that are not grouped by status fail', async () => {
  await failsWith({ ungrouped: true }, /plan outermost: grouped by status in the board's order/, 'two statuses swap seats');
});

test('a missing caption, or a caption text over a dot of the ring, fails', async () => {
  await failsWith({ noCaption: true }, /plan outermost: one caption, unnested, counts the cards/, 'no caption');
  await failsWith({ captionOverDots: true }, /plan outermost: the caption's text is clear of every dot of the ring/, 'the text is on a dot');
});

test('a fit that leaves the ring or its caption outside the canvas fails, at the first draw and after Fit', async () => {
  const zoomed = await run({ zoomFactor: (phase) => (phase === 'fitted' ? 1.4 : 1.4) });
  assert.ok(failed(zoomed).some((n) => /plan outermost: the view frames every dot, every caption and the Unnested block/.test(n)), failed(zoomed).join('; '));
  assert.ok(failed(zoomed).some((n) => /plan outermost: after Fit every dot, every caption and the Unnested block lie inside the canvas/.test(n)));
  assert.ok(failed(zoomed).some((n) => /plan outermost: the view frames the whole circle/.test(n)));
});

test('an off that leaves a relation to the cards, or a selection that keeps a card that is off, fails', async () => {
  await failsWith({ offKeepsLines: true }, /plan off: no relation to a card that is drawn is drawn/, 'the arrow stays');
  await failsWith({ offKeepsSelection: true }, /plan off: the card is out of the Graph, so out of the selection/, 'the selection keeps the card');
});

test('a mode that is forgotten on reload, or that the page does not draw, fails', async () => {
  await failsWith({ forgets: true }, /plan: a reload keeps the mode: off is pressed/, 'the mode is lost');
  await failsWith({ ignoresMode: true }, /plan off: the unnested cards are not drawn/, 'the page draws the ring whatever is pressed');
  await failsWith({ ignoresMode: true }, /plan depth 0: the unnested cards sit on one ring, outside the tier bands and inside depth 1/, 'and the depth 0 ring');
  await failsWith({ ignoresMode: true }, /plan table: the Unnested block is back/, 'and the block');
});

test('the scenario reads page globals the globals list declares, and waits on the page and never on a fixed sleep', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'tier-fan-unnested.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bsleep\(|setTimeout\(/.test(code), 'no fixed sleep');
  assert.ok(/waitFor\(/.test(code));
  assert.match(src, /Page globals this scenario reads/);
});

test('every scenario expression parses, so a typo does not wait for CI', () => {
  const exprs = [scenario.linesTouching([9, 10]), scenario.UNNESTED_ROW];
  for (const e of exprs) assert.doesNotThrow(() => new vm.Script(e), e.slice(0, 60));
});
