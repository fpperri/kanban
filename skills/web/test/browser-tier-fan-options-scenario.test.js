const { test, after } = require('node:test');
const assert = require('node:assert');

const scenario = require('./browser/scenarios/tier-fan-options');
const scenarios = require('./browser/scenarios');
const tierFan = require('./browser/scenarios/tier-fan');
const {
  graphBuild, graphFanLines, graphLayout, graphPlan, GRAPH_FAN_OPTION_VALUES, GRAPH_FAN_OPTION_DEFAULTS,
} = require('../web/graph-model');
const { mapOrderRow } = require('../web/map-relations');
const { loadBoard, cleanUp } = require('./helpers/fan-boards');

// The tier-fan-options scenario only runs in a browser (in CI). Here its lists are held to
// the real board reader and the Graph model over the plan board's own cards, and its logic
// runs against a stand-in page that answers from the real model, with the page's behaviour
// varied so a scenario that could never fail is caught.

after(cleanUp);

const BOARDS = { plan: loadBoard('plan'), fixture: loadBoard('fixture') };
const CASE = scenario.CASES.plan;

// What the page draws on `key` under `options`: the model of the cards it shows, the layout
// and the plan, the way the page's render builds them.
function drawn(key, options, extra = []) {
  const board = BOARDS[key];
  const cards = board.all.concat(extra);
  const visible = cards.filter((c) => !c.archived).map((c) => c.id);
  const model = graphBuild(cards, { ctx: board.ctx, hierarchy: board.config.hierarchy, types: board.config.types, visibleIds: new Set(visible) });
  const layout = graphLayout(model, 'tiers', { statuses: board.config.statuses, order: options.order });
  const plan = graphPlan(model, layout, { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title, fan: options });
  const lines = graphFanLines(model, layout.places, options);
  return { model, layout, plan, lines };
}
const added = () => CASE.added.map((c, i) => ({
  id: CASE.addedIds[i], title: c.title, status: c.status, archived: false, parent: c.parent, waiting_for: [], blocked: false, review: false,
}));
const counted = (lines) => ({
  all: lines.length,
  parent: lines.filter((l) => l.kind === 'parent').length,
  counted: lines.filter((l) => !!l.kids).length,
  wait: lines.filter((l) => l.kind === 'wait').length,
  labels: lines.filter((l) => !!l.kids).map((l) => String(l.count)),
});

// --- the lists are the real board's ---------------------------------------------------------------

test('the scenario is in the runner, on the plan board, with the fixture board beside it', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'tier-fan-options'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['fixture']);
});

test('the numbers of lines the scenario expects are the model\'s, over the plan board\'s own cards', () => {
  for (const mode of ['folded', 'chain', 'all', 'off']) {
    const { lines } = drawn('plan', { ...GRAPH_FAN_OPTION_DEFAULTS, lines: mode });
    assert.strictEqual(counted(lines).parent, CASE.parentLines[mode], mode);
    assert.strictEqual(counted(lines).wait, CASE.waits, mode);
  }
  assert.strictEqual(counted(drawn('plan', { ...GRAPH_FAN_OPTION_DEFAULTS, lines: 'folded' }).lines).counted, 0, 'no card of the board has two lone children on one ring');
  assert.strictEqual(counted(drawn('plan', { ...GRAPH_FAN_OPTION_DEFAULTS, dependencies: 'off' }).lines).wait, 0);
});

test('the numbers with the two added children are the model\'s, and folded carries them on one counted line', () => {
  for (const mode of ['folded', 'chain', 'all', 'off']) {
    assert.strictEqual(counted(drawn('plan', { ...GRAPH_FAN_OPTION_DEFAULTS, lines: mode }, added()).lines).parent, CASE.withAdded[mode], mode);
  }
  const lines = drawn('plan', GRAPH_FAN_OPTION_DEFAULTS, added()).lines;
  const [one] = lines.filter((l) => l.kids);
  assert.deepStrictEqual([one.from, one.kids, one.count], [7, CASE.addedIds, 2]);
  assert.strictEqual(BOARDS.plan.config.nextId, 30, 'the first card the scenario adds is card 30');
  assert.deepStrictEqual(CASE.addedIds, [30, 31]);
  assert.strictEqual(CASE.pollId, 32);
});

test('the board\'s parents, waits and order are what the scenario says they are', () => {
  const { model } = drawn('plan', GRAPH_FAN_OPTION_DEFAULTS);
  const parents = model.links.filter((l) => l.kind === 'parent').map((l) => `${l.from}>${l.to}`).sort();
  assert.deepStrictEqual(parents, ['1>2', '1>3', '1>4', '1>5', '1>6', '2>7', '2>8', '22>23', '22>25', '23>24', '7>22'].sort());
  assert.deepStrictEqual(model.links.filter((l) => l.kind === 'wait').map((l) => `${l.from}>${l.to}`).sort(), ['2>6', '3>4', '3>6', '5>27', '5>6', '7>8']);
  const kids = CASE.siblings;
  assert.deepStrictEqual(kids, model.links.filter((l) => l.from === 1 && l.kind === 'parent').map((l) => l.to));
  const status = mapOrderRow(kids, { nodes: model.nodes }, 'status', BOARDS.plan.config.statuses);
  assert.deepStrictEqual(status, CASE.seats.status);
  assert.deepStrictEqual(kids, CASE.seats.rank);
  assert.deepStrictEqual(kids.map((id) => BOARDS.plan.live.find((c) => c.id === id).status), ['doing', 'todo', 'backlog', 'done', 'todo']);
  for (const id of CASE.candidates) assert.ok(model.byId.has(id), `card ${id} is drawn`);
});

test('the option values and defaults the scenario names are the model\'s', () => {
  assert.deepStrictEqual(CASE.values, JSON.parse(JSON.stringify(GRAPH_FAN_OPTION_VALUES)));
  assert.deepStrictEqual(CASE.defaults, JSON.parse(JSON.stringify(GRAPH_FAN_OPTION_DEFAULTS)));
  assert.deepStrictEqual(CASE.labels, ['Lines', 'Dependencies', 'Order']);
});

test('the order really seats the children of card 1 as the scenario says, on the real layout', () => {
  const { layout } = drawn('plan', { ...GRAPH_FAN_OPTION_DEFAULTS, order: 'status' });
  const rank = drawn('plan', { ...GRAPH_FAN_OPTION_DEFAULTS, order: 'rank' }).layout;
  const seats = (l) => CASE.siblings.slice().sort((a, b) => l.polar.get(b).a - l.polar.get(a).a);
  assert.deepStrictEqual(seats(layout), CASE.seats.status);
  assert.deepStrictEqual(seats(rank), CASE.seats.rank);
});

// --- the stand-in page --------------------------------------------------------------------------------

// A stand-in for the page: each expression the scenario evaluates is answered from what the
// page would draw, and each click, press and drag does what the page does with it. `over`
// changes what the page does, to see which check notices.
function standIn(over = {}) {
  const checks = [];
  let key = null;
  let kind = 'tiers';
  const saved = {};
  let extra = [];
  let pending = [];
  let selected = [];
  let focus = null;
  let view = { x: 10, y: 20, k: 1, touched: false };
  let panning = false;
  let pressing = null;
  let nextId = 30;
  const state = (k) => {
    const id = over.sharedStore ? 'one' : k;
    if (!saved[id]) saved[id] = { options: { ...GRAPH_FAN_OPTION_DEFAULTS }, folded: over.startsOpen ? false : true };
    return saved[id];
  };
  const st = () => state(key);
  const now = () => drawn(key, over.ignoreOrder ? { ...st().options, order: 'status' } : st().options, extra);
  const handles = {
    label: { x: 1, y: 1 }, toggle: { x: 2, y: 1 }, rowSpace: { x: 3, y: 1 }, canvas: { x: 4, y: 1 },
  };
  const optionKeys = Object.entries(GRAPH_FAN_OPTION_VALUES).flatMap(([k, vs]) => vs.map((v) => [k, v]));
  const handleOf = (k, v) => ({ x: 100 + optionKeys.findIndex(([a, b]) => a === k && b === v), y: 1 });
  const what = (x) => {
    if (x === 1) return { kind: 'label' };
    if (x === 2) return { kind: 'toggle' };
    if (x === 3) return { kind: 'rowSpace' };
    if (x === 4) return { kind: 'canvas' };
    if (x >= 100 && x < 200) { const [k, v] = optionKeys[x - 100]; return { kind: 'option', k, v }; }
    if (x >= 10000) return { kind: 'dot', id: x - 10000 };
    return { kind: 'none' };
  };
  const reveal = () => { extra = extra.concat(pending); pending = []; };
  const rows = () => {
    if (kind !== 'tiers') return null;
    const s = st();
    const text = { lines: 'Lines', dependencies: 'Dependencies', order: 'Order' };
    return {
      expanded: !s.folded,
      label: s.folded ? 'Expand Options' : 'Collapse Options',
      keeps: over.rowLosesSelection ? false : true,
      toggleKeeps: true,
      toggleHolds: !!over.toggleHoldsPoll,
      groups: s.folded ? [] : Object.entries(GRAPH_FAN_OPTION_VALUES).map(([k, vs]) => ({
        label: text[k],
        title: `${text[k]} explains itself in a tooltip`,
        buttons: vs.map((v) => ({
          key: k, val: v, text: v, pressed: s.options[k] === v, active: s.options[k] === v, keeps: !over.optionLosesSelection, holds: !!over.holdsPoll,
        })),
      })),
    };
  };
  const lineCounts = () => {
    const c = counted(now().plan.links.map((l) => ({ kind: l.kind, kids: l.count !== undefined ? [] : undefined, count: l.count })));
    const labels = now().plan.links.filter((l) => l.label).map((l) => l.label.text);
    const base = { all: c.all, parent: c.parent, counted: c.counted, wait: c.wait, labels };
    return over.counts ? over.counts(base, st().options) : base;
  };
  const dotsOf = () => {
    const out = {};
    for (const n of now().plan.nodes) out[n.id] = { x: n.x, y: n.y };
    return out;
  };
  const select = (ids) => { selected = ids.slice(); };
  const press = (target) => {
    if (target.kind === 'toggle') {
      st().folded = !st().folded; focus = over.focusLost ? null : 'toggle'; if (over.pressClears) select([]);
      if (over.toggleRefits && !view.touched) view = { ...view, y: view.y - 14, k: view.k * 0.95 };
    }
    if (target.kind === 'option') {
      st().options[target.k] = target.v;
      if (over.orderRefits && target.k === 'order' && !view.touched) view = { ...view, y: view.y - 9, k: view.k * 0.97 };
      focus = over.focusLost ? null : `${target.k}=${target.v}`;
      if (over.pressClears) select([]);
    }
    if (target.kind === 'dot') select([target.id]);
  };
  const page = {
    checks,
    check: (name, ok) => checks.push([name, !!ok]),
    shot: async () => {},
    open: async (p, k) => {
      if (k !== key) { kind = 'tiers'; extra = []; pending = []; selected = []; focus = null; }
      key = k;
      if (over.forgets) state(k).options = { ...GRAPH_FAN_OPTION_DEFAULTS };
      reveal();
      view = { x: 10, y: 20, k: 1, touched: false };
    },
    centre: async (sel) => {
      if (sel === scenario.FOLD_TOGGLE) return handles.toggle;
      if (sel === scenario.OPTION_LABEL) return handles.label;
      for (const [k, v] of optionKeys) if (sel === scenario.optionButton(k, v)) return handleOf(k, v);
      throw new Error(`the stand-in page was asked for the centre of something it does not know: ${sel}`);
    },
    click: async (x, y, extraArgs = {}) => {
      const target = what(x);
      if (target.kind === 'rowSpace' && extraArgs.clickCount === 2 && over.rowClears) { select([]); return; }
      if (target.kind === 'canvas' && extraArgs.clickCount === 2) { select([]); return; }
      if (target.kind === 'rowSpace' || target.kind === 'canvas') return;
      press(target);
    },
    mouse: async (type, x) => {
      if (type === 'mousePressed') { pressing = what(x); return; }
      if (type === 'mouseMoved') {
        const pans = pressing && (pressing.kind === 'canvas' ? !over.canvasNeverPans : pressing.kind === 'label' && over.rowPans);
        if (pans) { panning = true; view = { ...view, x: view.x + 40, touched: true }; }
        return;
      }
      if (type === 'mouseReleased') { panning = false; pressing = null; }
    },
    waitFor: async (expr) => {
      if (expr === '!window.__stale') return true;
      if (expr === `${tierFan.DRAWN}&&${tierFan.TIERS_PRESSED}`) return kind === 'tiers';
      for (const name of ['tiers', 'force', 'status']) if (expr === tierFan.layoutIs(name)) return kind === name;
      if (expr === scenario.ROW_PRESENT) return kind === 'tiers';
      if (expr === scenario.ROW_ABSENT) return over.rowEverywhere ? false : kind !== 'tiers';
      if (expr === scenario.ROW_FOLDED) return kind === 'tiers' && st().folded;
      if (expr === scenario.ROW_EXPANDED) return kind === 'tiers' && !st().folded;
      const pressed = [...GRAPH_FAN_OPTION_VALUES.lines.map((v) => ['lines', v]), ...optionKeys].find(([k, v]) => expr === scenario.pressedIs(k, v));
      if (pressed) return !st().folded && st().options[pressed[0]] === pressed[1];
      const settled = /^\(\(\)=>\{const q=.*return q\('\.graph-link-parent'\)===(\d+)&&q\('\.graph-link-wait'\)===(\d+)\}\)\(\)$/.exec(expr);
      if (settled) { const c = lineCounts(); return c.parent === Number(settled[1]) && c.wait === Number(settled[2]); }
      const one = /^\[\.\.\.selectedIds\]\.sort\(\(a,b\)=>a-b\)\.length===1&&\[\.\.\.selectedIds\]\.sort\(\(a,b\)=>a-b\)\[0\]===(\d+)$/.exec(expr);
      if (one) return selected.length === 1 && selected[0] === Number(one[1]);
      if (expr === scenario.FOCUSED_TOGGLE) return focus === 'toggle';
      const focused = /^\(\(\)=>\{const e=document\.activeElement.*\}\)\(\)==='(\w+=\w+)'$/.exec(expr);
      if (focused) return focus === focused[1];
      const ids = [...expr.matchAll(/data-id="(\d+)"/g)].map((m) => Number(m[1]));
      if (ids.length) return ids.every((id) => now().model.byId.has(id));
      throw new Error(`the stand-in page was asked to wait on something it does not know: ${expr.slice(0, 100)}`);
    },
    ev: async (expr) => {
      if (expr === 'window.__stale=true') return true;
      for (const name of ['tiers', 'force', 'status']) if (expr === tierFan.pickLayout(name)) { kind = name; return true; }
      if (expr === scenario.ROW_STATE) {
        const r = rows();
        return over.rows ? over.rows(r) : r;
      }
      if (expr === scenario.ROW_FOLDED) return kind === 'tiers' && st().folded;
      if (expr === scenario.LINE_COUNTS) return lineCounts();
      if (expr === scenario.PREDICTED) return counted(now().lines);
      if (expr === scenario.DRAWN_LINES) return true;
      if (expr === scenario.VIEW) return { ...view, panning, dragging: false };
      if (expr === scenario.SELECTED) return selected.slice().sort((a, b) => a - b);
      if (expr === tierFan.DOTS) { const d = dotsOf(); return over.dots ? over.dots(d, st().options) : d; }
      if (expr === tierFan.SWEEP) return { from: now().layout.fan.from, to: now().layout.fan.to };
      if (expr === scenario.ROW_SPACE) return { ...handles.rowSpace };
      if (expr === scenario.CANVAS_SPACE) return { ...handles.canvas };
      if (expr === scenario.FOCUSED_OPTION) return focus && focus !== 'toggle' ? focus : null;
      if (expr === scenario.HOLDS_POLL) return !!over.holdsPoll && focus !== null && focus !== 'toggle';
      if (expr === scenario.TICK) { if (!over.pollDead) reveal(); return true; }
      if (/requestAnimationFrame/.test(expr)) return true;
      const dot = /^\(\(\)=>\{const dot=document\.querySelector\('\.graph-node\[data-id="(\d+)"\] \.graph-dot'\)/.exec(expr);
      if (dot) { const id = Number(dot[1]); return now().model.byId.has(id) ? { x: 10000 + id, y: 1 } : null; }
      const created = /^fetch\('\/api\/cards',\{method:'POST',headers:\{'content-type':'application\/json'\},body:JSON\.stringify\((.*)\)\}\)\.then\(\(r\)=>r\.status\)$/.exec(expr);
      if (created) {
        const card = JSON.parse(created[1]);
        pending.push({
          id: nextId++, title: card.title, status: card.status || 'todo', archived: false, parent: card.parent === undefined ? null : card.parent, waiting_for: [], blocked: false, review: false,
        });
        return 201;
      }
      throw new Error(`the stand-in page was asked something it does not know: ${expr.slice(0, 100)}`);
    },
  };
  return page;
}
const failed = (page) => page.checks.filter(([, ok]) => !ok).map(([n]) => n);
const run = async (over) => {
  const page = standIn(over);
  await scenario.run(page);
  return page;
};

test('against the real model every check passes', async () => {
  const page = await run();
  assert.deepStrictEqual(failed(page), []);
  assert.ok(page.checks.length >= 50, `only ${page.checks.length} checks ran`);
});

test('the checks the card asks for are each in the scenario', async () => {
  const names = (await run()).checks.map(([n]) => n);
  const has = (re) => assert.ok(names.some((n) => re.test(n)), `no check matches ${re}`);
  has(/the row is folded on the first open/);
  has(/force has no option row/);
  has(/status has no option row/);
  has(/the toggle unfolds the row/);
  has(/lines all draws 11 parent lines, the number the model predicts/);
  has(/lines chain draws 7 parent lines/);
  has(/lines off draws 0 parent lines/);
  has(/lines folded draws 7 parent lines/);
  has(/dependencies off draws no arrow/);
  has(/order status, the default, seats the children of card 1/);
  has(/order rank seats them in the outline's own order/);
  has(/folded draws the two children on one counted line, whose label reads 2/);
  has(/a reload keeps the options and the fold/);
  has(/fixture: another board starts folded with the defaults/);
  has(/pressing options and the toggle leaves the selection as it was/);
  has(/one press of the toggle, which changes the height of the stage, leaves an untouched view where it was/);
  has(/and does not pan or zoom the canvas/);
  has(/a drag that starts on the row does not pan the canvas/);
  has(/a double click on the space of the row leaves the selection/);
  has(/the same drag from the empty canvas does pan it/);
  has(/a focused option does not hold the poll/);
  has(/the next poll draws it, with no reload and nothing pressed since/);
  has(/and the option is still focused after the poll/);
  has(/and the poll after it refreshes the board/);
});

const failsWith = async (over, re, why) => {
  const page = await run(over);
  assert.ok(failed(page).some((n) => re.test(n)), `${why}: ${failed(page).join('; ') || 'nothing failed'}`);
};

test('a row that starts open, in every layout, or shared by every board fails', async () => {
  await failsWith({ startsOpen: true }, /the row is folded on the first open/, 'open on the first draw');
  await failsWith({ rowEverywhere: true }, /force has no option row/, 'a row in Force');
  await failsWith({ sharedStore: true }, /fixture: another board starts folded with the defaults/, 'one store for all boards');
});

test('a line count that is off by one fails the mode it is off in, and the model\'s own count', async () => {
  await failsWith({ counts: (c, o) => (o.lines === 'chain' ? { ...c, parent: c.parent + 1 } : c) }, /lines chain draws 7 parent lines/, 'chain draws one too many');
  await failsWith({ counts: (c, o) => (o.dependencies === 'off' ? { ...c, wait: 1 } : c) }, /dependencies off draws no arrow/, 'an arrow stays when dependencies are off');
  await failsWith({ counts: (c) => ({ ...c, labels: [] }) }, /folded draws the two children on one counted line, whose label reads 2/, 'no label');
});

test('an order that moves no sibling, or a row that changes the rings, fails', async () => {
  await failsWith({ ignoreOrder: true }, /order rank seats them in the outline's own order/, 'rank seats like status');
  await failsWith({ dots: (d, o) => (o.order === 'rank' ? { ...d, 4: { x: d[4].x * 1.5, y: d[4].y * 1.5 } } : d) }, /the order moves siblings and nothing else/, 'a card moves to another ring');
});

test('options that are lost on a reload fail', async () => {
  await failsWith({ forgets: true }, /a reload keeps the options and the fold/, 'forgotten');
});

test('a press that clears the selection, a row that does not keep it, or a double click on the row that clears it fail', async () => {
  await failsWith({ pressClears: true }, /pressing options and the toggle leaves the selection as it was/, 'a press clears');
  await failsWith({ rowClears: true }, /a double click on the space of the row leaves the selection/, 'a double click clears');
  await failsWith({ rowLosesSelection: true }, /the row and its toggle keep the selection/, 'the row does not keep the selection');
  await failsWith({ optionLosesSelection: true }, /every button of the row keeps the selection/, 'a button does not keep the selection');
});

test('a toggle that re-fits or rescales an untouched view when the stage changes height fails, folding or unfolding', async () => {
  await failsWith({ toggleRefits: true }, /one press of the toggle, which changes the height of the stage, leaves an untouched view where it was/, 'the first press re-fits');
  await failsWith({ toggleRefits: true }, /and does not pan or zoom the canvas/, 'the round trip still ends elsewhere');
});

test('an Order press that re-fits or rescales an untouched view fails, in the press loop and on a view framed with the row folded', async () => {
  await failsWith({ orderRefits: true }, /and does not pan or zoom the canvas/, 'the loop presses Order');
  await failsWith({ orderRefits: true }, /pressing Order status leaves the view where the fit put it/, 'the view framed folded moves');
  await failsWith({ orderRefits: true }, /pressing Order rank leaves the view where the fit put it/, 'and again');
});

test('a drag that starts on the row and pans the canvas fails, and so does a canvas that never pans', async () => {
  await failsWith({ rowPans: true }, /a drag that starts on the row does not pan the canvas/, 'the row pans');
  await failsWith({ canvasNeverPans: true }, /the same drag from the empty canvas does pan it/, 'the contrast fails');
});

test('a focused option that holds the poll, a dead poll, and a focus lost to the poll fail', async () => {
  await failsWith({ holdsPoll: true }, /a focused option does not hold the poll/, 'an option holds the poll');
  await failsWith({ holdsPoll: true }, /every button of the row keeps the selection and none holds the poll/, 'the buttons wear the hold');
  await failsWith({ pollDead: true }, /the next poll draws it/, 'the poll is dead');
  await failsWith({ focusLost: true }, /after a press the option keeps focus/, 'focus is lost');
  await failsWith({ toggleHoldsPoll: true }, /the row and its toggle keep the selection and the toggle holds no poll/, 'the toggle holds the poll');
});

test('the scenario reads page globals the globals list declares, and waits on the page and never on a fixed sleep', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'tier-fan-options.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bsleep\(|setTimeout\(/.test(code), 'no fixed sleep');
  assert.ok(/waitFor\(/.test(code));
  assert.match(src, /Page globals this scenario reads/);
});
