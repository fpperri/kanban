const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scenario = require('./browser/scenarios/fan-name-rows');
const scenarios = require('./browser/scenarios');
const tierFan = require('./browser/scenarios/tier-fan');
const options = require('./browser/scenarios/tier-fan-options');
const {
  graphBuild, graphLayout, graphPlan, graphFit, graphFanNames, graphZoomAt,
} = require('../web/graph-model');
const { graphNamesPlace, graphNamesKey, graphNamesRim } = require('../web/graph-names');
const { loadBoard, cleanUp, nameMeasure } = require('./helpers/fan-boards');

// The fan-name-rows scenario only runs in a browser (in CI). Here its lists are held to the real
// boards and the Graph model, and its logic runs against a stand-in page that places the names
// with the real placement (graphNamesPlace) over the real plan of each board, at the zoom a Fit
// of the browser's stage gives, and keeps a placement until its key changes, as the page does. Its
// drawing is varied so a scenario that could never fail is caught.

after(cleanUp);

const BOARDS = { plan: loadBoard('plan'), malformed: loadBoard('malformed') };
const CASE = scenario.CASES;
const sorted = (ids) => ids.map(Number).sort((a, b) => a - b);
const STAGE = { w: 1500, h: 780, l: 0, t: 120 };
const ZOOM_STEP = 1.25;

const modelOf = (key, extra = []) => {
  const board = BOARDS[key];
  const cards = board.all.concat(extra);
  return graphBuild(cards, {
    ctx: board.ctx, hierarchy: board.config.hierarchy, types: board.config.types, visibleIds: new Set(cards.filter((c) => !c.archived).map((c) => c.id)),
  });
};

// --- the lists are the real boards' ---------------------------------------------------------------

test('the scenario is in the runner, on the plan board, with the malformed board beside it', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'fan-name-rows'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['malformed']);
});

test('the cards each board draws are the scenario\'s lists, the parents are the plan board\'s, and the added card is its next', () => {
  for (const key of ['plan', 'malformed']) assert.deepStrictEqual(sorted(modelOf(key).nodes.map((n) => n.id)), sorted(CASE[key].live), key);
  const model = modelOf('plan');
  assert.deepStrictEqual(sorted(model.nodes.filter((n) => n.kids > 0).map((n) => n.id)), CASE.plan.parents);
  assert.strictEqual(BOARDS.plan.config.nextId, CASE.plan.addedId);
  for (const id of CASE.plan.picks) assert.ok(model.byId.has(String(id)), `card ${id} is drawn`);
});

// --- the stand-in page ---------------------------------------------------------------------------------

const HANDLES = { canvas: 5 };
function standIn(over = {}) {
  const checks = [];
  const shots = [];
  let key = null;
  const store = {};
  const pendingOf = {};
  const extraOf = {};
  let nextId = CASE.plan.addedId;
  let view = null;
  let k0 = null;
  let names = null;
  let memoKey = null;
  let stale = false;
  let drawnGen = 0;
  let markedGen = null;
  let kept = null;
  let selected = [];
  let pressing = null;
  let doubled = false;
  const opts = () => {
    if (!store[key]) store[key] = { names: 'relevant', unnested: 'outermost' };
    return store[key];
  };
  const build = () => {
    const board = BOARDS[key];
    const model = modelOf(key, (extraOf[key] || []).map((c) => ({ ...c })));
    const o = opts();
    const layout = graphLayout(model, 'tiers', { statuses: board.config.statuses, order: 'status', unnested: o.unnested });
    const fan = { lines: 'folded', dependencies: 'on', order: 'status', names: o.names, unnested: o.unnested };
    const plan = graphPlan(model, layout, { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title, fan });
    return { model, layout, plan };
  };
  let cur = null;
  // The page's placement: the memo is kept while the key holds.
  const place = (fresh = false) => {
    const o = opts();
    const named = graphFanNames(cur.model, o.names, { selectedIds: new Set(selected), loneCardId: selected.length === 1 ? selected[0] : null });
    const input = {
      plan: cur.plan, rim: graphNamesRim(cur.layout), named, keep: selected, k: view.k, labelsAll: view.k >= 1.4 || cur.plan.nodes.length <= 60, measure: nameMeasure, font: '',
    };
    const inputKey = graphNamesKey(input);
    if (fresh || over.guardMiss || inputKey !== memoKey) {
      names = graphNamesPlace(input);
      memoKey = inputKey;
    }
    stale = false;
  };
  const fit = () => ({ ...graphFit(cur.layout.bounds, STAGE.w, STAGE.h), touched: false });
  // A view nobody has moved is framed again on every draw, as the page does when the fan changes.
  const draw = (refit) => {
    cur = build();
    if (refit || !view || !view.touched) view = fit();
    drawnGen++;
    place();
  };
  const reveal = () => { extraOf[key] = (extraOf[key] || []).concat(pendingOf[key] || []); pendingOf[key] = []; };
  const zoomBy = (factor) => {
    view = { ...view, ...graphZoomAt(view, STAGE.w / 2, STAGE.h / 2, factor), touched: true };
    stale = true;
  };
  // A queued placement runs once the page is asked after the zoom settled; under `stale` it never does.
  const settle = () => { if (stale && !over.stale) place(); };
  const screen = (x, y) => ({ x: STAGE.l + view.x + x * view.k, y: STAGE.t + view.y + y * view.k });
  const placedIds = () => sorted([...names.placed.keys()]);
  const shownIds = () => {
    if (over.shownNotPlaced) return sorted([...graphFanNames(cur.model, opts().names, { selectedIds: new Set(selected.map(String)) })]);
    return placedIds();
  };
  const rects = () => {
    const out = shownIds().filter((id) => names.placed.has(String(id))).map((id) => {
      const p = names.placed.get(String(id));
      const a = screen(p.box.x0, p.box.y0);
      const b = screen(p.box.x1, p.box.y1);
      const mid = (a.y + b.y) / 2;
      return { id, l: a.x, t: mid - 5.5, r: b.x, b: mid + 5.5, h: 15 };
    });
    if (over.overlap && out.length > 1) Object.assign(out[1], { l: out[0].l, t: out[0].t, r: out[0].r, b: out[0].b });
    return out;
  };
  const overlaps = () => {
    const r = rects();
    const out = [];
    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i];
        const b = r[j];
        if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) out.push([a.id, b.id]);
      }
    }
    return out;
  };
  const heights = () => {
    const grow = over.grows ? view.k / k0 : 1;
    return Object.fromEntries(shownIds().map((id) => [String(id), { h: 15 * grow, px: 11 * grow }]));
  };
  const leadersDrawn = () => {
    if (over.leaderUnderNone) return Math.max(1, [...names.placed.values()].filter((p) => p.leader).length);
    return [...names.placed.values()].filter((p) => p.leader).length;
  };
  const kinds = () => {
    const out = {};
    for (const p of names.placed.values()) out[p.kind] = (out[p.kind] || 0) + 1;
    return out;
  };
  const blockAbove = () => {
    const block = cur.plan.block;
    if (!block) return false;
    const ids = new Set(block.columns.flatMap((c) => c.ids));
    const own = [...names.placed].filter(([id]) => ids.has(id));
    const top = screen(0, block.y).y;
    return own.length > 0 && own.every(([, p]) => (over.blockBelow ? screen(0, p.box.y1).y + 20 : screen(0, p.box.y1).y) <= top + 0.5);
  };
  const page = {
    checks,
    shots,
    check: (name, ok) => checks.push([name, !!ok]),
    shot: async (name) => { shots.push(name); },
    open: async (url, k) => {
      key = k;
      view = null;
      selected = [];
      doubled = false;
      reveal();
      draw(true);
    },
    mouse: async (type, x, y) => {
      if (type === 'mousePressed') pressing = x === HANDLES.canvas ? { x, y, vx: view.x, vy: view.y } : null;
      if (type === 'mouseMoved' && pressing) {
        view = { ...view, x: pressing.vx + (x - pressing.x), y: pressing.vy + (y - pressing.y), touched: true };
        if (over.guardMiss) place(true);
      }
      if (type === 'mouseReleased') pressing = null;
    },
    click: async (x) => { if (x >= 10000) selected = [x - 10000]; place(); },
    waitFor: async (expr) => {
      const known = query(expr);
      if (known !== undefined) return !!known;
      return !!(await page.ev(expr));
    },
    ev: async (expr) => {
      const known = query(expr);
      if (known !== undefined) return known;
      return act(expr);
    },
  };
  function query(expr) {
    if (expr === '!window.__stale') return true;
    if (expr === `${tierFan.DRAWN}&&${tierFan.TIERS_PRESSED}`) return !!cur && cur.plan.nodes.length > 0;
    for (const v of ['relevant', 'all', 'none']) if (expr === scenario.namesAre(v)) return opts().names === v;
    if (expr === scenario.SETTLED) { settle(); return !!names && names.k === view.k; }
    if (expr === scenario.VIEW_AT) return { x: view.x, y: view.y, k: view.k };
    if (expr === scenario.ZOOM) return view.k;
    const grew = /^graphCur\.view\.k>([\d.e-]+)\*1\.4$/.exec(expr);
    if (grew) return view.k > Number(grew[1]) * 1.4;
    if (expr === scenario.KINDS) return kinds();
    if (expr === scenario.PLACED) return placedIds();
    if (expr === scenario.SHOWN) return shownIds();
    if (expr === scenario.SHOWN_IS_PLACED) return JSON.stringify(shownIds()) === JSON.stringify(placedIds());
    if (expr === scenario.ONE_EACH) return cur.plan.nodes.length > 0 && !doubled && !over.noLeaders;
    if (expr === scenario.LEADERS_ARE_CALLED) return !over.noLeaders;
    if (expr === scenario.RECTS) return rects();
    if (expr === scenario.OVERLAPS) return overlaps();
    if (expr === scenario.HEIGHTS) return heights();
    if (expr === scenario.UPRIGHT) return !over.tilted;
    if (expr === scenario.LEADERS_DRAWN) return opts().names === 'none' && !over.leaderUnderNone ? 0 : leadersDrawn();
    if (expr === scenario.BLOCK_ABOVE) return blockAbove();
    if (expr === scenario.KEPT) return names === kept;
    if (expr === scenario.REDRAWN) return drawnGen !== markedGen;
    if (expr === tierFan.TABLE_DRAWN) return opts().unnested === 'table' && cur.plan.nodes.length > 0;
    if (expr === tierFan.FITTED) return view.touched === false;
    if (expr === tierFan.hasDot(CASE.plan.addedId)) return cur.model.byId.has(String(CASE.plan.addedId));
    if (expr === scenario.PLACED_OR_UNNAMED(CASE.plan.addedId)) return names.placed.has(String(CASE.plan.addedId)) || names.unnamed.includes(String(CASE.plan.addedId));
    if (expr === `${scenario.PLACED}.length+graphCur.names.unnamed.length`) return names.placed.size + names.unnamed.length;
    if (expr === options.SELECTED) return sorted(selected);
    const one = /^\[\.\.\.selectedIds\]\.map\(Number\)\.sort\(\(a,b\)=>a-b\)\.length===1&&\[\.\.\.selectedIds\]\.map\(Number\)\.sort\(\(a,b\)=>a-b\)\[0\]===(\d+)$/.exec(expr);
    if (one) return selected.length === 1 && selected[0] === Number(one[1]);
    return undefined;
  }
  async function act(expr) {
    if (expr === 'window.__stale=true') return true;
    for (const v of ['relevant', 'all', 'none']) if (expr === scenario.useNames(v)) { opts().names = v; draw(false); return true; }
    if (expr === scenario.USE_TABLE) { opts().unnested = 'table'; draw(false); return true; }
    if (expr === tierFan.ZOOM_IN) { if (k0 === null) k0 = view.k; zoomBy(ZOOM_STEP); return true; }
    if (expr === tierFan.FIT) { const was = view.k; view = fit(); if (view.k !== was) stale = true; return true; }
    if (expr === scenario.KEEP) { kept = names; return true; }
    if (expr === scenario.MARK_DRAWN) { markedGen = drawnGen; return true; }
    if (expr === options.CANVAS_SPACE) return { x: HANDLES.canvas, y: 1 };
    if (/requestAnimationFrame/.test(expr)) return true;
    if (expr === options.TICK) { reveal(); draw(false); if (over.dupAfterPoll) doubled = true; return true; }
    const created = /^fetch\('\/api\/cards',\{method:'POST',headers:\{'content-type':'application\/json'\},body:JSON\.stringify\((.*)\)\}\)\.then\(\(r\)=>r\.status\)$/.exec(expr);
    if (created) {
      const c = JSON.parse(created[1]);
      (pendingOf[key] = pendingOf[key] || []).push({
        id: String(nextId++), title: c.title, status: c.status || 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false,
      });
      return 201;
    }
    const dotAt = /^\(\(\)=>\{const dot=document\.querySelector\('\.graph-node\[data-id="(\d+)"\] \.graph-dot'\)/.exec(expr);
    if (dotAt) return cur.model.byId.has(dotAt[1]) ? { x: 10000 + Number(dotAt[1]), y: 1 } : null;
    throw new Error(`the stand-in page was asked something it does not know: ${expr.slice(0, 160)}`);
  }
  return page;
}

const failed = (page) => page.checks.filter(([, ok]) => !ok).map(([n]) => n);
const run = async (over) => {
  const page = standIn(over);
  await scenario.run(page);
  return page;
};

test('against the real placement every check passes, and the two shots are taken', async () => {
  const page = await run();
  assert.deepStrictEqual(failed(page), []);
  assert.ok(page.checks.length >= 25, `only ${page.checks.length} checks ran`);
  assert.deepStrictEqual(page.shots, ['names-all', 'names-table']);
});

test('each check the card asks for is in the scenario', async () => {
  const names = (await run()).checks.map(([n]) => n);
  const has = (re) => assert.ok(names.some((n) => re.test(n)), `no check matches ${re}`);
  has(/names keep their on-screen height at two zoom levels/);
  has(/no name is rotated/);
  has(/after the zoom, one name and one leader for each card/);
  has(/after the pan, one name and one leader for each card/);
  has(/after the poll, one name and one leader for each card/);
  has(/with names on none, no name shows and no leader is drawn/);
  has(/under none still no leader is drawn/);
  has(/malformed: one name and one leader for each card/);
  has(/malformed: with the block, one name and one leader for each card/);
  has(/the block's names sit in a list above it/);
  has(/a pan places nothing/);
  has(/a poll with nothing new draws the fan again and places nothing/);
});

const failsWith = async (over, re, why) => {
  const page = await run(over);
  assert.ok(failed(page).some((n) => re.test(n)), `${why}: ${failed(page).join('; ') || 'nothing failed'}`);
};

test('names that overlap, tilt or grow with the zoom fail', async () => {
  await failsWith({ overlap: true }, /none overlaps another|none over another/, 'two names on one another');
  await failsWith({ tilted: true }, /no name is rotated/, 'a name turned');
  await failsWith({ grows: true }, /names keep their on-screen height at two zoom levels/, 'names grow with the zoom');
  await failsWith({ grows: true }, /drawn at 11px on screen/, 'their text grows with the zoom');
});

test('a placement left stale by a zoom, or made again by a pan or an empty poll, fails', async () => {
  await failsWith({ stale: true }, /once the zoom settles the names are placed again at it/, 'the zoom never places');
  await failsWith({ guardMiss: true }, /a pan places nothing/, 'a pan places again');
  await failsWith({ guardMiss: true }, /a poll with nothing new draws the fan again and places nothing/, 'an empty poll places again');
});

test('a second label after a poll, leaders under none, names shown that were not placed, or block names below it, fail', async () => {
  await failsWith({ dupAfterPoll: true }, /after the poll, one name and one leader for each card/, 'a label drawn twice');
  await failsWith({ leaderUnderNone: true }, /with names on none, no name shows and no leader is drawn/, 'a leader under none');
  await failsWith({ leaderUnderNone: true }, /under none still no leader is drawn/, 'a leader after a click under none');
  await failsWith({ shownNotPlaced: true }, /the names shown are the names placed/, 'a name shown with no room');
  await failsWith({ blockBelow: true }, /the block's names sit in a list above it/, 'the block\'s names below it');
  await failsWith({ noLeaders: true }, /one name and one leader for each card/, 'no leader drawn');
});

test('the scenario reads page globals the globals list declares, and waits on the page and never on a fixed sleep', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'fan-name-rows.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bsleep\(|setTimeout\(/.test(code), 'no fixed sleep');
  assert.ok(/waitFor\(/.test(code));
  assert.match(src, /Page globals this scenario reads/);
});

test('every expression the scenario exports compiles as page code', () => {
  const exprs = [];
  for (const [k, v] of Object.entries(scenario)) {
    if (typeof v === 'string' && !['name', 'board'].includes(k)) exprs.push(v);
  }
  exprs.push(scenario.namesAre('all'), scenario.useNames('none'), scenario.PLACED_OR_UNNAMED(30));
  assert.ok(exprs.length >= 20, `${exprs.length} expressions`);
  for (const e of exprs) assert.doesNotThrow(() => new vm.Script(e), e.slice(0, 80));
});
