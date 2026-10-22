const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scenario = require('./browser/scenarios/band-tint');
const scenarios = require('./browser/scenarios');
const tierFan = require('./browser/scenarios/tier-fan');
const {
  graphLayout, graphPlan, graphFit,
} = require('../web/graph-model');
const {
  STATUSES, loadBoard, cleanUp, drawnModel,
} = require('./helpers/fan-boards');

// The band-tint scenario only runs in a browser (in CI). Here its logic runs against a
// stand-in page: the Graph's own layout and plan are worked out for the state the scenario
// has put the page in (the board, the Unnested option, a cut, a status pill, the layout, the
// theme), and the expressions the scenario evaluates run in a vm against a small DOM built
// from them, so a regular expression or a selector that is wrong fails here and not in the
// slow browser run. The stylesheet's own rule for a wash gives its opacity and pointer events.
// What is varied is what the page draws, so a scenario that could never fail is caught.

after(cleanUp);

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');
const RULE = /\n\.graph-tint \{([^}]*)\}/.exec(css)[1];
const OPACITY = Number(/fill-opacity: ([\d.]+);/.exec(RULE)[1]);
const EVENTS = /pointer-events: (\w+);/.exec(RULE)[1];
const [MUT_LIGHT, MUT_DARK] = [...css.matchAll(/--mut: (#[0-9a-f]{6});/g)].map((m) => m[1]);

const BOARDS = { plan: loadBoard('plan'), fixture: loadBoard('fixture') };
const STAGE = { left: 0, top: 0, right: 1000, bottom: 800 };
const typeOf = (c) => String(c.type || '').toLowerCase();

// The world the page has for a state: its model, layout, plan and the view Fit gives it.
function worldOf(st, over) {
  const board = BOARDS[st.key];
  let visible = board.live.map((c) => c.id);
  if (st.cut) visible = board.live.filter((c) => typeOf(c) === 'goal').map((c) => c.id);
  if (st.pill) visible = visible.filter((id) => board.live.find((c) => c.id === id).status !== 'doing');
  const model = drawnModel(board, { visible });
  const layout = graphLayout(model, 'hierarchy', { statuses: STATUSES, unnested: st.unnested });
  const plan = graphPlan(model, layout, { kind: 'hierarchy', statusClass: (s) => s, titleOf: (c) => c.title, types: board.config.types });
  const tints = st.kind === 'tiers' ? (over.tints ? over.tints(plan.tints, plan, layout) : plan.tints) : [];
  return { model, layout, plan, tints, view: graphFit(layout.bounds, STAGE.right, STAGE.bottom) };
}

// The elements the expressions ask for, and the globals they read.
function sandboxOf(st, over) {
  const w = worldOf(st, over);
  const rgb = (hex) => scenario.rgbOf(hex);
  const mut = st.theme === 'dark' ? MUT_DARK : MUT_LIGHT;
  const tintEls = w.tints.map((t) => {
    const fill = over.fill ? over.fill(t, mut) : (t.color ? rgb(t.color) : rgb(mut));
    const attrs = { 'data-tier': t.tier, d: t.d, class: t.cls, ...(t.color ? { 'data-type-color': t.color } : {}) };
    return {
      attrs,
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      classList: { contains: (c) => attrs.class.split(' ').includes(c) },
      computed: { fill, fillOpacity: String(over.opacity === undefined ? OPACITY : over.opacity), pointerEvents: over.events || EVENTS },
    };
  });
  const nodeEls = w.plan.nodes.map((n) => {
    const at = { x: n.x * w.view.k + w.view.x, y: n.y * w.view.k + w.view.y, r: n.r * w.view.k + 1 };
    const el = {
      dataset: { id: String(n.id) },
      at,
      getAttribute: (k) => (k === 'transform' ? `translate(${n.x} ${n.y})` : null),
      classList: { contains: (c) => c === 'graph-node' },
      closest: (sel) => (sel === '.graph-node' ? el : null),
    };
    el.dot = {
      getBoundingClientRect: () => ({ left: at.x - 3, right: at.x + 3, top: at.y - 3, bottom: at.y + 3, width: 6, height: 6 }),
      closest: (sel) => (sel === '.graph-node' ? el : null),
    };
    return el;
  });
  const others = [...w.plan.guides.map((g) => g.cls), ...w.plan.nodes.map(() => 'graph-node')].map((c) => ({ classList: { contains: (x) => c.split(' ').includes(x) } }));
  const worldKids = over.washLast ? others.concat(tintEls) : tintEls.concat(others);
  const canvas = { getBoundingClientRect: () => STAGE, isCanvas: true };
  const documentElement = {};
  const document = {
    documentElement,
    querySelectorAll(sel) {
      if (sel === '#graph-view .graph-tint') return tintEls;
      if (sel === '#graph-view .graph-node') return nodeEls;
      if (sel === '#graph-view .graph-block-frame') return w.plan.block ? [{}] : [];
      return [];
    },
    querySelector(sel) {
      if (sel === '#graph-view .graph-world') return { children: worldKids };
      if (sel === '#graph-view .graph-canvas') return canvas;
      const m = /^\.graph-node\[data-id="(\d+)"\] \.graph-dot$/.exec(sel);
      if (m) { const n = nodeEls.find((e) => e.dataset.id === m[1]); return n ? n.dot : null; }
      throw new Error(`the stand-in page was asked for ${sel}`);
    },
    elementFromPoint(x, y) {
      const on = nodeEls.find((n) => Math.hypot(n.at.x - x, n.at.y - y) <= n.at.r);
      if (on) return on.dot;
      if (over.washCatches) {
        const wx = (x - w.view.x) / w.view.k;
        const wy = (y - w.view.y) / w.view.k;
        const r = Math.hypot(wx, wy);
        const hit = w.tints.findIndex((t) => {
          const [outer, inner] = [...t.d.matchAll(/M(-?[\d.]+) 0A/g)].map((m) => Number(m[1]));
          return r > inner && r < outer;
        });
        if (hit >= 0) return tintEls[hit];
      }
      return canvas;
    },
  };
  return {
    document,
    getComputedStyle: (el) => (el === documentElement
      ? { getPropertyValue: (k) => (k === '--mut' ? ` ${mut}` : '') }
      : { fill: el.computed.fill, fillOpacity: el.computed.fillOpacity, pointerEvents: el.computed.pointerEvents }),
    graphCur: { layout: w.layout, view: w.view },
    selectedIds: st.picked,
    requestAnimationFrame: (fn) => fn(),
    Promise,
    world: w,
  };
}

// A page in its starting state, and the scenario's way of driving it.
function standIn(over = {}) {
  const st = { key: null, theme: 'light', unnested: 'outermost', cut: false, pill: false, kind: 'tiers', picked: new Set() };
  const checks = [];
  const opened = [];
  const run = (expr) => vm.runInNewContext(expr, sandboxOf(st, over));
  const asksPage = (expr) => /graph-tint|selectedIds/.test(expr);
  return {
    st,
    checks,
    opened,
    check: (name, ok) => checks.push([name, !!ok]),
    open: async (p, key) => {
      opened.push(`${key}${p}`);
      Object.assign(st, { key, theme: 'light', unnested: 'outermost', cut: false, pill: false, kind: 'tiers' });
      st.picked.clear();
    },
    send: async (method, params) => {
      assert.strictEqual(method, 'Emulation.setEmulatedMedia');
      st.theme = params.features[0].value;
    },
    waitFor: async (expr) => (asksPage(expr) ? !!run(expr) : true),
    ev: async (expr) => {
      if (expr === 'window.__stale=true') return true;
      if (expr === tierFan.USE_TABLE) { st.unnested = 'table'; return true; }
      if (expr === scenario.STATUS_PILL) { st.pill = !st.pill; return true; }
      if (expr === tierFan.writeBox('slice:goal')) { st.cut = true; return true; }
      if (expr === tierFan.writeBox('')) { st.cut = false; return true; }
      for (const kind of ['flow', 'tiers']) if (expr === tierFan.pickLayout(kind)) { st.kind = kind; return true; }
      return run(expr);
    },
    // A press and a release at a point: Ctrl on a dot picks it; a double click on empty space clears the picks.
    click: async (x, y, extra = {}) => {
      const hit = sandboxOf(st, over).document.elementFromPoint(x, y);
      const node = hit && hit.closest ? hit.closest('.graph-node') : null;
      if (node) { if (extra.modifiers === 2) st.picked.add(Number(node.dataset.id)); return; }
      if (extra.clickCount === 2 && !over.noClear && !(hit && hit.attrs)) st.picked.clear();
      else if (extra.clickCount === undefined && over.singleClears) st.picked.clear();
    },
  };
}
const failed = (page) => page.checks.filter(([, ok]) => !ok).map(([n]) => n);
const play = async (over) => { const page = standIn(over); await scenario.run(page); return page; };

// --- the scenario ------------------------------------------------------------------------------------

test('the scenario is registered, on the plan board with the fixture board beside it', () => {
  assert.ok(scenarios.includes(scenario));
  assert.strictEqual(scenario.name, 'band-tint');
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['fixture']);
});

test('what the scenario expects of the plan board is what its config says: goal and epic have a colour, strategy and objective have none', () => {
  const { types, hierarchy } = BOARDS.plan.config;
  assert.deepStrictEqual(scenario.TIERS.map((t) => t.name), hierarchy);
  for (const t of scenario.TIERS) {
    const type = types.find((x) => x.name === t.name);
    assert.strictEqual(type.color || null, t.color, t.name);
    assert.strictEqual(t.fill, t.color ? scenario.rgbOf(t.color) : null, `${t.name}: the fill is the colour as the browser writes it`);
  }
  assert.deepStrictEqual(scenario.TIERS.map((t) => t.name), tierFan.CASES.plan.tierNames);
  assert.strictEqual(scenario.OPACITY, OPACITY, 'and the opacity is the stylesheet\'s');
  assert.strictEqual(EVENTS, 'none');
});

test('the status pill the scenario turns off takes every epic and no card of another tier out of the plan board', () => {
  assert.strictEqual(scenario.PILL, 'doing');
  const inTier = (tier) => BOARDS.plan.live.filter((c) => typeOf(c) === tier);
  const doing = (tier) => inTier(tier).filter((c) => c.status === scenario.PILL);
  assert.ok(inTier('epic').length > 0 && doing('epic').length === inTier('epic').length, 'every epic is doing');
  for (const tier of ['goal', 'strategy', 'objective']) assert.ok(doing(tier).length < inTier(tier).length, `${tier} keeps a card`);
});

test('the scenario passes against the page as it should be, in both boards and both themes', async () => {
  const page = await play();
  assert.deepStrictEqual(failed(page), []);
  assert.ok(page.checks.length >= 25, `only ${page.checks.length} checks ran`);
  assert.deepStrictEqual(page.opened, ['plan/?view=graph', 'fixture/?view=graph']);
  assert.strictEqual(page.st.theme, 'light', 'and it leaves the page in the light theme');
});

test('a page that draws no wash fails every wash check on the plan board, and the fixture board\'s check passes', async () => {
  const page = await play({ tints: () => [] });
  const names = failed(page);
  assert.ok(names.includes('plan: one wash for each tier band that holds a card, in tier order, none for a depth ring or the ring of unnested cards'));
  assert.ok(names.includes('plan: each wash is the whole ring of its band, between the band\'s inner and outer edge'));
  assert.ok(names.includes('plan: the goal and epic washes carry their type\'s configured colour, and strategy and objective carry none'));
  assert.ok(names.includes('plan: the washes are drawn first, before every guide arc, line, dot and caption'));
  assert.ok(names.includes('plan: each wash holds every dot of its tier'));
  assert.ok(!names.some((n) => n.startsWith('fixture')));
});

test('a page that paints every wash in the neutral colour fails the colour check of goal and epic', async () => {
  const page = await play({ fill: (t, mut) => scenario.rgbOf(mut) });
  const names = failed(page);
  assert.deepStrictEqual(names.filter((n) => /paints the goal and epic/.test(n)).length, 1);
  assert.ok(names.some((n) => /in the dark theme the washes are faint/.test(n)));
  assert.ok(names.some((n) => /in the light theme the washes are faint/.test(n)));
});

test('a page that colours the strategy wash fails the neutral check', async () => {
  const page = await play({ fill: (t, mut) => (t.tier === 'strategy' ? 'rgb(1, 2, 3)' : (t.color ? scenario.rgbOf(t.color) : scenario.rgbOf(mut))) });
  assert.ok(failed(page).includes('plan: the strategy and objective washes are the neutral wash, in the muted token, and not in another tier\'s colour'));
});

test('a page whose washes are opaque, or take the pointer, fails the faint check, and in each theme', async () => {
  const opaque = await play({ opacity: 0.6 });
  assert.ok(failed(opaque).includes('plan: every wash is faint, and takes no pointer'));
  assert.ok(failed(opaque).some((n) => /in the dark theme/.test(n)));
  const takes = await play({ events: 'auto' });
  assert.ok(failed(takes).includes('plan: every wash is faint, and takes no pointer'));
});

test('a page whose washes catch the pointer fails the click checks: the pointer is on a wash, and there is no empty spot in a band to click', async () => {
  const page = await play({ washCatches: true });
  const names = failed(page);
  assert.ok(names.includes('plan: the pointer is never on a wash, anywhere in any of the four bands'));
  assert.ok(names.includes('plan: there is a washed spot with nothing on it to click'));
  assert.ok(names.includes('plan: and each band has spots where the pointer is on the canvas, a click there is on empty space'));
});

test('a page where a double click on a washed band does not clear the selection fails that check alone of the click checks', async () => {
  const page = await play({ noClear: true });
  assert.deepStrictEqual(failed(page), ['plan: a double click on a washed band clears the selection']);
});

test('a page where a single click on a washed band clears the selection fails that check', async () => {
  const page = await play({ singleClears: true });
  assert.deepStrictEqual(failed(page), ['plan: a click on a washed band leaves the selection as it was']);
});

test('a page that draws the washes after the dots fails the order check', async () => {
  const page = await play({ washLast: true });
  assert.ok(failed(page).includes('plan: the washes are drawn first, before every guide arc, line, dot and caption'));
});

test('a page that also washes a depth ring fails the one-wash-for-each-tier-band check', async () => {
  const page = await play({
    tints: (tints, plan, layout) => (tints.length ? tints.concat([{ ...tints[0], tier: 'depth 1', band: layout.bands.length - 1 }]) : tints),
  });
  assert.ok(failed(page).includes('plan: one wash for each tier band that holds a card, in tier order, none for a depth ring or the ring of unnested cards'));
});

test('a page whose washes are off their bands fails the whole-ring check', async () => {
  const page = await play({
    tints: (tints) => tints.map((t) => ({ ...t, d: t.d.replace(/M([\d.]+) 0A/, (all, r) => `M${Number(r) + 5} 0A`) })),
  });
  assert.ok(failed(page).includes('plan: each wash is the whole ring of its band, between the band\'s inner and outer edge'));
});

test('a page that keeps the four washes whatever is cut or switched off, and draws them on the fixture board too, fails the cut, the pill and the fixture checks', async () => {
  const whole = worldOf({ key: 'plan', theme: 'light', unnested: 'outermost', cut: false, pill: false, kind: 'tiers' }, {}).tints;
  const page = await play({ tints: () => whole });
  const names = failed(page);
  assert.ok(names.includes('plan: slice:goal leaves the goal wash and no other'));
  assert.ok(names.includes('plan: the doing status pill off drops the epic wash, the epic being the one card doing, and keeps the others'));
  assert.ok(names.includes('fixture: a board without a hierarchy draws no wash'));
});

test('a page that draws a wash in the Flow fails its check', async () => {
  const page = standIn();
  const original = page.ev;
  let calls = 0;
  page.ev = async (expr) => {
    if (expr === scenario.WASH_TIERS && page.st.kind !== 'tiers') { calls++; return ['goal']; }
    return original(expr);
  };
  await scenario.run(page);
  assert.ok(calls >= 1);
  assert.deepStrictEqual(failed(page), ['plan: the flow draws no wash']);
});

test('the scenario never waits on a fixed sleep, and writes no style attribute or inline handler into the page', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'band-tint.js'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src));
  assert.ok(!/setAttribute\(\s*['"]style|\.style\./.test(src));
});

test('every expression the scenario sends compiles as one page expression', () => {
  const exprs = [scenario.WASHES, scenario.WASH_TIERS, scenario.BANDS, scenario.ORDER, scenario.MUTED, scenario.STATUS_PILL, scenario.probe('goal'), scenario.washesAre(['goal', 'epic']), scenario.dotPoint(3)];
  for (const expr of exprs) assert.doesNotThrow(() => new vm.Script(expr), expr.slice(0, 60));
});

test('the wash reader takes the two radii out of a real wash path, the outer circle first, and an empty path out as none', () => {
  const st = { key: 'plan', theme: 'light', unnested: 'table', cut: false, pill: false, kind: 'tiers', picked: new Set() };
  const box = sandboxOf(st, {});
  const washes = JSON.parse(JSON.stringify(vm.runInNewContext(scenario.WASHES, box)));
  assert.deepStrictEqual(washes.map((w) => w.tier), ['goal', 'strategy', 'objective', 'epic']);
  washes.forEach((w, i) => {
    const band = box.world.layout.bands[i];
    assert.deepStrictEqual(w.radii, [band.r1, band.r0].map((r) => Math.round(r * 100) / 100));
  });
  assert.deepStrictEqual(washes.map((w) => w.typed), ['#a371f7', null, null, '#d29922']);
});
