const { test } = require('node:test');
const assert = require('node:assert');
const { performance } = require('node:perf_hooks');

const { graphLayoutTiers, graphPlan, graphFanNames } = require('../web/graph-model');
const { graphNamesPlace, graphNameMeets, graphNameDiscHits } = require('../web/graph-names');
const {
  STATUSES, buildOf, rootShapedCards, placeOn, pathPoints, drawnBox, within, leaderPieces, leaderCrossings,
} = require('./helpers/fan-boards');

// A fan of 150 cards with names on all: the size of a real shop board's fan. Every card is
// either placed clear of every other name, every dot and every line, or left unnamed, and the
// work the placement does is bounded: the counts of its work at each zoom are pinned from a
// measurement, and its time is held under a frame's on top.
// The cards: the first 110 of the tree of rootShapedCards (its goals, strategies, objectives,
// epics and their children) and its 40 loose cards; every seventh tree card waits for the
// card three before it, and five loose cards wait for a tree card, so dependency lines run out
// to the outermost ring or the Unnested block.

const crowd = () => {
  const all = rootShapedCards();
  const cards = all.filter((c) => c.id <= 110 || (c.id >= 186 && c.id <= 225)).map((c) => ({ ...c, waiting_for: [] }));
  for (const c of cards) if (c.id <= 110 && c.id % 7 === 0) c.waiting_for = [c.id - 3];
  [186, 194, 202, 210, 218].forEach((id, i) => { cards.find((c) => c.id === String(id)).waiting_for = [10 + 20 * i]; });
  return cards;
};
const MODEL = buildOf(crowd());
const STAGES = [[1600, 800], [1280, 720], [1000, 700]];
const ZOOMS = [1, 2, 0.5];
// Measured over every case below, and pinned at each zoom: the fewest cards placed, and twice
// the most work one placement did, in exact tests of a place, marks looked at for the leaders'
// runs and cells of the tables that give the rows out.
const PLACED_AT_LEAST = { 1: 124, 2: 139, 0.5: 56 };
const WORK_AT_MOST = {
  1: { tests: 2 * 24538, rays: 2 * 14453, cells: 2 * 6111 },
  2: { tests: 2 * 4374, rays: 2 * 14453, cells: 2 * 11349 },
  0.5: { tests: 2 * 43016, rays: 2 * 10430, cells: 2 * 2450 },
};
// A frame at 60 a second.
const FRAME_MS = 16;

const cases = () => {
  const out = [];
  for (const unnested of ['outermost', 'table']) {
    for (const lines of ['folded', 'all']) {
      const layout = graphLayoutTiers(MODEL, { statuses: STATUSES, unnested });
      const fan = { lines, dependencies: 'on', order: 'status', names: 'all', unnested };
      const plan = graphPlan(MODEL, layout, { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title, fan });
      // Every point of every line and divider, by x, so a box finds the points under it at once.
      const drawn = [...plan.links, ...plan.dividers.map((v) => ({ d: `M${v.x1} ${v.y1}L${v.x2} ${v.y2}`, from: 'divider', to: '' }))];
      const points = drawn.flatMap((l) => pathPoints(l.d).map((q) => ({ ...q, l }))).sort((p, q) => p.x - q.x);
      for (const [w, h] of STAGES) {
        for (const zoom of ZOOMS) out.push({ where: `${unnested}/${lines} ${w}x${h} zoom ${zoom}`, zoom, layout, plan, points, ...placeOn(MODEL, layout, plan, { w, h, zoom }) });
      }
    }
  }
  return out;
};
const firstAt = (points, x) => {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

test('a 150-card fan with names on all places every card without overlap or leaves it unnamed, within a bounded amount of work', () => {
  assert.strictEqual(MODEL.nodes.length, 150);
  assert.ok(MODEL.links.filter((l) => l.kind === 'wait').length >= 20, 'dependency lines to cross');
  const named = [...graphFanNames(MODEL, 'all')].sort((a, b) => a - b);
  assert.strictEqual(named.length, 150);
  let lists = 0;
  for (const c of cases()) {
    const { result } = c;
    const placed = [...result.placed];
    assert.deepStrictEqual([...result.placed.keys(), ...result.unnamed].sort((a, b) => a - b), named, `${c.where}: every card placed or unnamed`);
    assert.ok(result.unnamed.every((id) => !result.placed.has(id)), `${c.where}: never both`);
    assert.ok(result.placed.size >= PLACED_AT_LEAST[c.zoom], `${c.where}: ${result.placed.size} placed, fewer than ${PLACED_AT_LEAST[c.zoom]}`);
    for (const [what, most] of Object.entries(WORK_AT_MOST[c.zoom])) assert.ok(result.stats[what] <= most, `${c.where}: ${result.stats[what]} ${what}, more than ${most}`);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) assert.ok(!graphNameMeets(placed[i][1].box, placed[j][1].box), `${c.where}: cards ${placed[i][0]} and ${placed[j][0]} overlap`);
    }
    for (const [id, p] of placed) {
      if (p.kind === 'list') lists++;
      assert.ok(within(drawnBox(p, c.k), p.box), `${c.where}: card ${id}'s text runs out of the room it takes`);
      for (const n of c.plan.nodes) {
        if (n.id !== id) assert.ok(!graphNameDiscHits(p.box, { x: n.x, y: n.y, r: n.reach }), `${c.where}: card ${id}'s name covers card ${n.id}`);
      }
      const b = { x0: p.box.x0 + 1e-6, x1: p.box.x1 - 1e-6, y0: p.box.y0 + 1e-6, y1: p.box.y1 - 1e-6 };
      for (let i = firstAt(c.points, b.x0); i < c.points.length && c.points[i].x < b.x1; i++) {
        const q = c.points[i];
        assert.ok(!(q.y > b.y0 && q.y < b.y1), `${c.where}: card ${id}'s name lies over the line ${q.l.from}>${q.l.to}`);
      }
    }
  }
  assert.ok(lists > 0, 'the Unnested block lists names too');
});

test('on a 150-card fan no two leaders cross, though many share the rail and the rows over and under it', () => {
  for (const c of cases()) {
    for (const side of ['L', 'R']) {
      const leaders = [...c.result.placed].filter(([, p]) => p.kind === 'row' && p.side === side).map(([id, p]) => [id, leaderPieces(p.leader.d, c.plan.nodes.find((n) => n.id === id)).pieces]);
      assert.deepStrictEqual(leaderCrossings(leaders), [], `${c.where} ${side}`);
    }
  }
});

test('a 150-card fan is placed within the time of a frame, at every zoom', () => {
  for (const c of cases()) {
    graphNamesPlace(c.input);
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      graphNamesPlace(c.input);
      best = Math.min(best, performance.now() - t0);
    }
    assert.ok(best < FRAME_MS, `${c.where}: ${best.toFixed(1)} ms`);
  }
});
