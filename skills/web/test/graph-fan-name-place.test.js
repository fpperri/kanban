const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { graphLayoutTiers, graphPlan, graphFanNames } = require('../web/graph-model');
const {
  GRAPH_NAME_PAD, GRAPH_NAME_ROW, GRAPH_NAME_POLE, GRAPH_NAME_RAIL, GRAPH_NAME_MARK_PAD, GRAPH_NAME_DETOUR,
  graphNamesPlace, graphNamesKey, graphNamesRim, graphNameAssign, graphNameFit, graphNameFlatten, graphNameSegHits, graphNameDiscHits, graphNameMeets,
} = require('../web/graph-names');
const {
  STATUSES, loadBoard, cleanUp, drawnModel, nameMeasure, placeOn, captionRects, pathPoints, drawnBox, within, leaderPieces, leaderCrossings,
} = require('./helpers/fan-boards');

// Where the tier fan's names sit. One pure function (graphNamesPlace) takes the plan the
// page draws, the named set (graphFanNames, unchanged), the zoom and a measure of text in
// screen pixels, and says where each named card's name goes: a parent's beside its ring,
// inside the rim; every other card's in a row outside the rim, joined to its dot by a
// leader; the Unnested block's in one list above the block. A card with no room is left
// unnamed. The widths here are the tests' own (6.2px a character at 11px), so nothing is
// measured in a browser. The plan board is the browser runner's own fixture board.

after(cleanUp);

const BOARD = loadBoard('plan');
const MODEL = drawnModel(BOARD);
const PLAN_PARENTS = ['1', '2', '7', '22', '23'];
// The plan board's other cards named in a row at Fit on 1600x800, the Unnested cards on the
// outermost ring: measured, and pinned so a change that loses one shows.
const ROWS_AT_FIT = 21;
// The plan board's block cards left unnamed under table at Fit on each stage: measured, and
// pinned so the loss shows. The backlog column's line runs up the block's left edge, which is
// inside the rim's reach at every row a name could take, so its four cards are never listed.
const BACKLOG = ['11', '14', '18', '28'];
const BLOCK_UNNAMED_AT_FIT = { '1600x800': BACKLOG, '1280x720': BACKLOG, '1000x700': BACKLOG };
const STAGES = [[1600, 800], [1280, 720], [1000, 700]];
const ZOOMS = [1, 2, 0.6];
const ids = (it) => [...it].sort((a, b) => a - b);

const fanOf = (model, { unnested = 'outermost', lines = 'folded', names = 'all' } = {}) => {
  const layout = graphLayoutTiers(model, { statuses: STATUSES, unnested });
  const fan = { lines, dependencies: 'on', order: 'status', names, unnested };
  const plan = graphPlan(model, layout, { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title, fan });
  return { layout, plan };
};
const nodeOf = (plan, id) => plan.nodes.find((n) => n.id === id);
const flaggedOf = (n) => / is-(blocked|waiting|review)/.test(n.cls);
const corners = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]];
// How far a box is from a point: 0 when the point is in it.
const reachOf = (b, x, y) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
const round = (v) => Math.round(v * 100) / 100;
// Every line the plan draws: its parent and dependency lines, and the dividers between sectors.
const linesOf = (plan) => [...plan.links, ...plan.dividers.map((v) => ({ d: `M${v.x1} ${v.y1}L${v.x2} ${v.y2}`, from: 'divider', to: '' }))];
const NUM = /-?\d+(?:\.\d+)?(?:e-?\d+)?/g;

// Every way the plan board is drawn here: the Unnested cards on the outermost ring or in the
// block, the lines given, Dependencies on, on three stages at Fit and zoomed in and out.
const matrix = (lineChoices = ['folded', 'all']) => {
  const out = [];
  for (const unnested of ['outermost', 'table']) {
    for (const lines of lineChoices) {
      const { layout, plan } = fanOf(MODEL, { unnested, lines });
      for (const [w, h] of STAGES) {
        for (const zoom of ZOOMS) {
          out.push({
            where: `${unnested}/${lines} ${w}x${h} zoom ${zoom}`, unnested, w, h, zoom, layout, plan, ...placeOn(MODEL, layout, plan, { w, h, zoom }),
          });
        }
      }
    }
  }
  return out;
};

// --- the primitives -----------------------------------------------------------------------

// How far a point is from a chain of segments.
const fromChain = (p, segs) => Math.min(...segs.map((s) => {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - s.x0) * dx + (p.y - s.y0) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (s.x0 + dx * t), p.y - (s.y0 + dy * t));
}));
const chained = (segs) => segs.every((s, i) => !i || (s.x0 === segs[i - 1].x1 && s.y0 === segs[i - 1].y1));

test('a quadratic line comes back as one chain of chords that never strays further from the curve than the tolerance', () => {
  for (const [d, tol] of [['M0 0Q100 200 300 -50', 0.25], ['M-281.33 -134.9Q-190.19 -229.55 -194.14 -438.99', 0.25], ['M0 0Q40 0 80 0', 0.25], ['M5 5Q600 -400 -300 900', 0.1]]) {
    const segs = graphNameFlatten(d, tol);
    const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.ok(segs.length >= 2, d);
    assert.ok(chained(segs), `${d}: the chords join end to end`);
    assert.deepStrictEqual([segs[0].x0, segs[0].y0], [n[0], n[1]], `${d}: from the line's start`);
    assert.deepStrictEqual([segs[segs.length - 1].x1, segs[segs.length - 1].y1], [n[4], n[5]], `${d}: to its end`);
    let worst = 0;
    for (let i = 0; i <= 2000; i++) {
      const t = i / 2000;
      const p = {
        x: (1 - t) * (1 - t) * n[0] + 2 * (1 - t) * t * n[2] + t * t * n[4],
        y: (1 - t) * (1 - t) * n[1] + 2 * (1 - t) * t * n[3] + t * t * n[5],
      };
      worst = Math.max(worst, fromChain(p, segs));
    }
    assert.ok(worst <= tol + 1e-9, `${d}: the curve is ${worst} from its chords, more than ${tol}`);
  }
});

test('an arc comes back as chords on its own circle, round the way its flags say, each within the tolerance of the circle', () => {
  const cases = [
    // [path, centre, radius, the angle it turns through]
    ['M100 0A100 100 0 0 1 0 100', [0, 0], 100, Math.PI / 2],
    ['M100 0A100 100 0 1 0 0 100', [0, 0], 100, -1.5 * Math.PI],
    ['M100 0A100 100 0 1 1 0 -100', [0, 0], 100, 1.5 * Math.PI],
    ['M100 0A100 100 0 0 0 0 100', [100, 100], 100, -Math.PI / 2],
    ['M-300 0A300 300 0 0 1 300 0', [0, 0], 300, Math.PI],
    ['M210 10A50 50 0 0 1 160 60', [160, 10], 50, Math.PI / 2],
  ];
  for (const [d, [cx, cy], r, turn] of cases) {
    const tol = 0.25;
    const segs = graphNameFlatten(d, tol);
    assert.ok(chained(segs), d);
    const ends = [{ x: segs[0].x0, y: segs[0].y0 }, ...segs.map((s) => ({ x: s.x1, y: s.y1 }))];
    for (const p of ends) assert.ok(Math.abs(Math.hypot(p.x - cx, p.y - cy) - r) < 1e-6, `${d}: a chord ends on the circle`);
    for (const s of segs) {
      const mid = Math.hypot((s.x0 + s.x1) / 2 - cx, (s.y0 + s.y1) / 2 - cy);
      assert.ok(r - mid <= tol + 1e-9, `${d}: a chord is ${r - mid} inside the circle`);
    }
    let swept = 0;
    for (const s of segs) {
      let step = Math.atan2(s.y1 - cy, s.x1 - cx) - Math.atan2(s.y0 - cy, s.x0 - cx);
      if (step > Math.PI) step -= 2 * Math.PI;
      if (step < -Math.PI) step += 2 * Math.PI;
      swept += step;
    }
    assert.ok(Math.abs(swept - turn) < 1e-6, `${d}: turns ${swept}, not ${turn}`);
  }
});

test('a path of apart pieces flattens to the pieces alone, and a straight line to itself', () => {
  assert.deepStrictEqual(graphNameFlatten('M0 0L10 0M20 0L30 5', 0.25), [{ x0: 0, y0: 0, x1: 10, y1: 0 }, { x0: 20, y0: 0, x1: 30, y1: 5 }]);
  assert.deepStrictEqual(graphNameFlatten('M1 2L3 4L5 6', 0.25), [{ x0: 1, y0: 2, x1: 3, y1: 4 }, { x0: 3, y0: 4, x1: 5, y1: 6 }]);
  assert.deepStrictEqual(graphNameFlatten('', 0.25), []);
  assert.deepStrictEqual(graphNameFlatten('M3 4', 0.25), []);
});

test('a segment hits a box only through its inside: one along an edge or through a corner does not, until the box grows', () => {
  const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
  const seg = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
  assert.strictEqual(graphNameSegHits(box, seg(-5, 5, 15, 5)), true, 'straight through');
  assert.strictEqual(graphNameSegHits(box, seg(2, 2, 3, 3)), true, 'wholly inside');
  assert.strictEqual(graphNameSegHits(box, seg(5, -5, 5, 2)), true, 'in from above');
  assert.strictEqual(graphNameSegHits(box, seg(-5, 0, 15, 0)), false, 'along the top edge');
  assert.strictEqual(graphNameSegHits(box, seg(10, -5, 10, 15)), false, 'along the right edge');
  assert.strictEqual(graphNameSegHits(box, seg(-5, 5, 5, -5)), false, 'through the corner');
  assert.strictEqual(graphNameSegHits(box, seg(11, 0, 11, 10)), false, 'beside it');
  assert.strictEqual(graphNameSegHits(box, seg(-5, 0, 15, 0), 1), true, 'the box grown by 1 takes in its own edge');
  assert.strictEqual(graphNameSegHits(box, seg(10.5, -5, 10.5, 15), 1), true);
});

test('two boxes meet only by overlapping, and a disc meets a box only by reaching inside it', () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
  assert.strictEqual(graphNameMeets(a, { x0: 5, y0: 5, x1: 15, y1: 15 }), true);
  assert.strictEqual(graphNameMeets(a, { x0: 10, y0: 0, x1: 20, y1: 10 }), false, 'touching edges');
  assert.strictEqual(graphNameDiscHits(a, { x: 15, y: 5, r: 5.01 }), true);
  assert.strictEqual(graphNameDiscHits(a, { x: 15, y: 5, r: 5 }), false, 'touching the side');
  assert.strictEqual(graphNameDiscHits(a, { x: 13, y: 14, r: 5 }), false, 'off the corner by its radius');
  assert.strictEqual(graphNameDiscHits(a, { x: 13, y: 14, r: 5.01 }), true);
});

test('rows go to names in order, one name to a row, at the least total cost: the same as trying every way on a small case', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 25; round++) {
    const table = Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => (rand() < 0.15 ? Infinity : Math.round(rand() * 20))));
    const labels = [0, 1, 2, 3];
    const rows = [0, 1, 2, 3, 4, 5];
    const cost = (l, r) => table[l][r];
    let best = Infinity;
    const tryFrom = (l, from, sum) => {
      if (l === labels.length) { best = Math.min(best, sum); return; }
      for (let r = from; r < rows.length; r++) tryFrom(l + 1, r + 1, sum + cost(l, r));
    };
    tryFrom(0, 0, 0);
    const got = graphNameAssign(labels, rows, cost);
    if (!Number.isFinite(best)) { assert.strictEqual(got, null, `round ${round}: no way at all`); continue; }
    assert.ok(got, `round ${round}`);
    assert.strictEqual(got.length, labels.length);
    for (let i = 1; i < got.length; i++) assert.ok(got[i] > got[i - 1], `round ${round}: in order, never two in one row`);
    assert.strictEqual(got.reduce((s, r, l) => s + cost(l, r), 0), best, `round ${round}: the least cost`);
  }
  assert.strictEqual(graphNameAssign([1, 2, 3], [1, 2], () => 0), null, 'more names than rows');
  assert.strictEqual(graphNameAssign([1, 2], [1, 2, 3], () => Infinity), null, 'no row a name fits');
  assert.deepStrictEqual(graphNameAssign([], [1, 2], () => 0), []);
});

test('a name is fitted to its room: whole when it fits, else its longest start with an ellipsis, else nothing', () => {
  const m = (t) => Array.from(t).length * 10;
  assert.strictEqual(graphNameFit('Write the plan', 140, m), 'Write the plan');
  assert.strictEqual(graphNameFit('Write the plan', 139, m), 'Write the pl…');
  assert.strictEqual(graphNameFit('Write the plan', 70, m), 'Write…', 'the space before the cut goes');
  assert.strictEqual(graphNameFit('Write the plan', 20, m), 'W…');
  assert.strictEqual(graphNameFit('Write the plan', 19, m), '');
  const emoji = graphNameFit('\u{1F600}\u{1F600}\u{1F600}\u{1F600}', 30, m);
  assert.strictEqual(emoji, '\u{1F600}\u{1F600}…', 'cut between characters, never inside one');
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(emoji));
});

test('a name that leads with its id keeps the id whole: the title is cut after it, and when no title fits the bare id stays', () => {
  const m = (t) => Array.from(t).length * 10;
  const name = '#379 ids: one module parses';
  assert.strictEqual(graphNameFit(name, 270, m, 5), name);
  assert.strictEqual(graphNameFit(name, 100, m, 5), '#379 ids:…');
  assert.strictEqual(graphNameFit(name, 60, m, 5), '#379', 'no title fits: the id alone');
  assert.strictEqual(graphNameFit(name, 40, m, 5), '#379');
  assert.strictEqual(graphNameFit(name, 39, m, 5), '', 'not even the id fits: no name');
  assert.strictEqual(graphNameFit('#7', 20, m, 2), '#7');
});

// --- one pure module ----------------------------------------------------------------------

test('graph-names.js is pure: no page, no measuring in a browser, no clock, no chance', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'graph-names.js'), 'utf8');
  const tail = src.indexOf("if (typeof module !== 'undefined' && module.exports)");
  assert.ok(tail > 0, 'the module ends in the dual-environment tail');
  const body = src.slice(0, tail);
  for (const banned of [/\bdocument\b/, /\bwindow\.(?!kanbanIds\b)/, /getBBox/, /getTotalLength/, /getComputedStyle/, /\bDate\b/, /Math\.random/, /\bperformance\b/, /innerHTML/, /style=/]) {
    assert.ok(!banned.test(body), `graph-names.js reads ${banned}`);
  }
  assert.ok(!/style=/.test(src));
});

// --- the key ------------------------------------------------------------------------------

test('the key holds everything the placement reads: the same input gives the same key, and a change to any part a new one', () => {
  const { layout, plan } = fanOf(MODEL);
  const base = () => ({
    plan: JSON.parse(JSON.stringify(plan)), rim: graphNamesRim(layout), named: graphFanNames(MODEL, 'all'), keep: new Set(), k: 0.5, labelsAll: true, measure: nameMeasure, font: 'serif',
  });
  const key = graphNamesKey(base());
  assert.strictEqual(graphNamesKey(base()), key, 'the same input, the same key');
  const changed = {
    k: (o) => { o.k = 0.51; },
    'a title': (o) => { o.plan.nodes[3].name = 'Another title'; },
    'a sticker': (o) => { o.plan.nodes[3].cls += ' is-blocked'; },
    'a line': (o) => { o.plan.links[0].d = 'M0 0L1 1'; },
    'the named set': (o) => { o.named = new Set([1, 2]); },
    'the cards kept': (o) => { o.keep = new Set([5]); },
    'the id labels': (o) => { o.labelsAll = false; },
    'the font': (o) => { o.font = 'sans-serif'; },
    'a caption': (o) => { o.plan.captions[0].name = 'goals'; },
    'the rim': (o) => { o.rim += 1; },
    'a dot': (o) => { o.plan.nodes[0].x += 1; },
    'a divider': (o) => { o.plan.dividers[0].x1 += 1; },
  };
  for (const [what, change] of Object.entries(changed)) {
    const o = base();
    change(o);
    assert.notStrictEqual(graphNamesKey(o), key, `${what} changes the key`);
  }
  for (const cls of ['selected', 'hover-highlight']) {
    const o = base();
    o.plan.nodes[3].cls += ` ${cls}`;
    assert.strictEqual(graphNamesKey(o), key, `${cls} does not move a name`);
  }
});

// --- parents beside their rings ------------------------------------------------------------

test('a parent\'s name sits beside its ring, inside the rim, with no leader, and keeps off its own ring and every other parent\'s name', () => {
  let seen = 0;
  for (const unnested of ['outermost', 'table']) {
    for (const lines of ['folded', 'all']) {
      const { layout, plan } = fanOf(MODEL, { unnested, lines });
      const rim = graphNamesRim(layout);
      for (const [w, h] of STAGES) {
        for (const zoom of ZOOMS) {
          const { result, k } = placeOn(MODEL, layout, plan, { w, h, zoom });
          const beside = [...result.placed].filter(([, p]) => p.kind === 'beside');
          for (const [id, p] of beside) {
            const where = `${unnested}/${lines} ${w}x${h} zoom ${zoom}: card ${id}`;
            const n = nodeOf(plan, id);
            assert.ok(n.cls.includes(' has-kids'), `${where} is a parent`);
            assert.strictEqual(p.leader, null, `${where} has no leader`);
            assert.strictEqual(p.side, null);
            const ring = flaggedOf(n) ? n.flagRing : n.kidsRing;
            const text = { x0: p.box.x0 + GRAPH_NAME_PAD / k, x1: p.box.x1 - GRAPH_NAME_PAD / k, y0: p.box.y0, y1: p.box.y1 };
            assert.ok(reachOf(text, n.x, n.y) >= ring + 1.5, `${where}: its text clears its ring (${reachOf(text, n.x, n.y)} from the centre, ring ${ring})`);
            const far = Math.hypot(ring + 5 + 44 / k, 1.5 * GRAPH_NAME_ROW / k);
            assert.ok(reachOf(p.box, n.x, n.y) <= far + 0.01, `${where}: beside the ring, at most 44px out and two lines up or down`);
            for (const [x, y] of corners(p.box)) assert.ok(Math.hypot(x, y) <= rim + 1e-9, `${where}: inside the rim`);
            assert.ok(Math.abs(p.box.y1 - p.box.y0 - GRAPH_NAME_ROW / k) < 1e-9, `${where}: one line high`);
            assert.ok(Math.abs((p.box.y0 + p.box.y1) / 2 - p.y) < 1e-9, `${where}: its text centred in its box`);
            seen++;
          }
          for (let i = 0; i < beside.length; i++) {
            for (let j = i + 1; j < beside.length; j++) assert.ok(!graphNameMeets(beside[i][1].box, beside[j][1].box), `${beside[i][0]} and ${beside[j][0]} overlap`);
          }
        }
      }
    }
  }
  assert.ok(seen > 0);
  for (const unnested of ['outermost', 'table']) {
    const { layout, plan } = fanOf(MODEL, { unnested });
    const { result } = placeOn(MODEL, layout, plan, { w: 1600, h: 800 });
    const beside = ids([...result.placed].filter(([, p]) => p.kind === 'beside').map(([id]) => id));
    assert.deepStrictEqual(beside, PLAN_PARENTS, `${unnested}: at Fit on 1600x800, every parent of the plan board finds a place`);
  }
});

// --- every other card in a row outside the rim --------------------------------------------

test('every other named card\'s name sits outside the rim, its leader running from its dot out to its name', () => {
  for (const c of matrix()) {
    const rim = graphNamesRim(c.layout);
    for (const [id, p] of c.result.placed) {
      if (p.kind === 'beside') continue;
      const where = `${c.where}: card ${id}`;
      const n = nodeOf(c.plan, id);
      assert.ok(!n.cls.includes(' has-kids'), `${where} is not a parent`);
      for (const [x, y] of corners(p.box)) assert.ok(Math.hypot(x, y) > rim, `${where}: outside the rim`);
      const { from, to, d } = p.leader;
      const out = Math.hypot(from.x - n.x, from.y - n.y);
      if (p.kind === 'row') {
        assert.ok(out >= n.reach && out <= n.reach + 2.5 + 0.01, `${where}: the leader starts at its dot's edge (${out} from its centre)`);
        assert.strictEqual(p.side, n.x < 0 ? 'L' : 'R', `${where}: on its own side`);
        assert.strictEqual(p.anchor, p.side === 'L' ? 'end' : 'start');
        const near = p.side === 'L' ? p.box.x1 : p.box.x0;
        assert.strictEqual(p.x, near, `${where}: the text starts at the near edge of its box`);
        assert.ok(Math.abs((p.side === 'L' ? to.x - near : near - to.x) - 3 / c.k) < 0.01, `${where}: the leader stops 3px short of its name`);
      } else {
        assert.ok(out < 1e-9, `${where}: a listed card's leader starts at its centre`);
      }
      assert.ok(Math.abs(to.y - (p.box.y0 + p.box.y1) / 2) < 0.01 && Math.abs(to.y - p.y) < 0.01, `${where}: level with its name`);
      assert.match(d, /^M/);
      assert.ok(!/NaN|Infinity/.test(d), where);
      const nums = d.match(NUM).map(Number);
      assert.deepStrictEqual(nums.slice(0, 2), [round(from.x - n.x), round(from.y - n.y)], `${where}: drawn from its dot`);
      assert.deepStrictEqual(nums.slice(-2), [round(to.x - n.x), round(to.y - n.y)], `${where}: to its name`);
    }
  }
  const { layout, plan } = fanOf(MODEL);
  const { result } = placeOn(MODEL, layout, plan, { w: 1600, h: 800 });
  const rows = [...result.placed.values()].filter((p) => p.kind === 'row').length;
  assert.strictEqual(rows, ROWS_AT_FIT, 'at Fit on 1600x800 the plan board names its other cards in rows');
});

test('down each side, the rows keep their cards\' order', () => {
  for (const c of matrix()) {
    for (const side of ['L', 'R']) {
      const rows = [...c.result.placed].filter(([, p]) => p.kind === 'row' && p.side === side).map(([id, p]) => {
        const n = nodeOf(c.plan, id);
        return { id, y: p.y, down: n.y / Math.hypot(n.x, n.y) };
      }).sort((p, q) => p.down - q.down || p.id - q.id);
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i].y > rows[i - 1].y, `${c.where} ${side}: card ${rows[i].id} is named below card ${rows[i - 1].id}`);
    }
  }
});

// A mark as the placement keeps off it: its sticker ring, its children's ring or its dot.
const markOf = (n) => (flaggedOf(n) ? n.flagRing : n.cls.includes(' has-kids') ? n.kidsRing : n.reach) + GRAPH_NAME_MARK_PAD;
// How far a point is off the ray from the apex at angle `a`, and how far along it.
const offRay = (q, a) => Math.abs(q.x * Math.sin(a) - q.y * Math.cos(a));
const alongRay = (q, a) => q.x * Math.cos(a) + q.y * Math.sin(a);
const radius = (q) => Math.hypot(q.x, q.y);
const turnBetween = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// Points every unit or closer along a piece of a leader, its ends included.
const along = (p) => {
  if (!p.r) {
    const n = Math.max(1, Math.ceil(Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y)));
    return Array.from({ length: n + 1 }, (_, s) => ({ x: p.a.x + ((p.b.x - p.a.x) * s) / n, y: p.a.y + ((p.b.y - p.a.y) * s) / n }));
  }
  const a0 = Math.atan2(p.a.y, p.a.x);
  let turn = Math.atan2(p.b.y, p.b.x) - a0;
  if (p.sweep) while (turn <= 0) turn += 2 * Math.PI;
  else while (turn >= 0) turn -= 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(turn) * p.r));
  return Array.from({ length: n + 1 }, (_, s) => ({ x: Math.cos(a0 + (turn * s) / n) * p.r, y: Math.sin(a0 + (turn * s) / n) * p.r }));
};
// A row's leader as its three stretches: the run out from the dot to the rail, the arc along the
// rail (none when the leader leaves the rail just where it meets it) and the piece out to the name.
const stretches = (p, n, rail) => {
  const { start, pieces } = leaderPieces(p.leader.d, n);
  const exit = pieces[pieces.length - 1];
  const before = pieces[pieces.length - 2];
  const onRail = before && before.r && Math.abs(before.r - rail) < 0.01 ? before : null;
  return { start, run: pieces.slice(0, pieces.length - (onRail ? 2 : 1)), onRail, exit };
};

test('a row\'s leader runs out along its card\'s ray, round any dot in the way, along the rail just outside the rim, then straight out to its name', () => {
  let detours = 0;
  for (const c of matrix()) {
    const rail = graphNamesRim(c.layout) + GRAPH_NAME_RAIL / c.k;
    for (const [id, p] of c.result.placed) {
      if (p.kind !== 'row') continue;
      const where = `${c.where}: card ${id}`;
      const n = nodeOf(c.plan, id);
      const ray = Math.atan2(n.y, n.x);
      const { start, run, onRail, exit } = stretches(p, n, rail);
      assert.ok(Math.hypot(start.x - p.leader.from.x, start.y - p.leader.from.y) < 0.01, `${where}: from its dot`);
      assert.ok(run.length && !exit.r, `${where}: a run out to the rail and a piece out to the name`);
      for (const q of run) {
        if (q.r) assert.ok(q.r < rail, `${where}: goes round a dot inside the rail`);
        else {
          assert.ok(offRay(q.a, Math.atan2(q.b.y, q.b.x)) < 0.02, `${where}: each straight piece of its run lies along a ray of the apex`);
          assert.ok(radius(q.b) >= radius(q.a) - 0.02, `${where}: and runs outward`);
        }
        for (const v of along(q)) {
          if (offRay(v, ray) > 0.02) {
            const rounds = c.plan.nodes.some((m) => m.id !== id
              && Math.abs(radius(v) - radius(m)) <= markOf(m) + GRAPH_NAME_DETOUR + 0.05
              && Math.abs(turnBetween(Math.atan2(v.y, v.x), Math.atan2(m.y, m.x))) * radius(m) <= markOf(m) + GRAPH_NAME_DETOUR + 0.05);
            assert.ok(rounds, `${where}: off its ray only to go round a dot on it`);
          }
          for (const m of c.plan.nodes) {
            if (m.id !== id) assert.ok(Math.hypot(v.x - m.x, v.y - m.y) >= m.reach, `${where}: its leader runs over card ${m.id}`);
          }
        }
      }
      if (run.some((q) => q.r)) detours++;
      const reached = run[run.length - 1].b;
      assert.ok(Math.abs(radius(reached) - rail) < 0.02 && offRay(reached, ray) < 0.02 && alongRay(reached, ray) > 0, `${where}: back on its own ray at the rail`);
      if (onRail) assert.ok(Math.abs(radius(onRail.b) - rail) < 0.02, where);
      assert.ok(Math.abs(radius(exit.a) - rail) < 0.02, `${where}: leaves from the rail`);
      assert.ok(offRay(exit.a, Math.atan2(exit.b.y, exit.b.x)) < 0.02 && radius(exit.b) > radius(exit.a), `${where}: straight out from the rail along a ray of the apex`);
      assert.ok(Math.hypot(exit.b.x - p.leader.to.x, exit.b.y - p.leader.to.y) < 0.01, `${where}: to its name`);
    }
  }
  assert.ok(detours > 0, 'some leader goes round a dot');
});

test('no two leaders cross: they share the rail and the rays, and each leaves the rail along a ray of its own', () => {
  for (const c of matrix()) {
    for (const side of ['L', 'R']) {
      const leaders = [...c.result.placed].filter(([, p]) => p.kind === 'row' && p.side === side).map(([id, p]) => [id, leaderPieces(p.leader.d, nodeOf(c.plan, id)).pieces]);
      assert.deepStrictEqual(leaderCrossings(leaders), [], `${c.where} ${side}`);
    }
  }
});

test('a leader goes round a dot on its ray, clear of its mark by GRAPH_NAME_DETOUR as it passes, on the side its ray lies, and back onto its ray beyond', () => {
  const node = (id, x, y) => ({ id, x, y, reach: 4, kidsRing: 8, flagRing: 9, cls: 'graph-node', name: `Card ${id}` });
  const n = node(1, 50, 0);
  const m = node(2, 80, 2);
  const rail = 100 + GRAPH_NAME_RAIL;
  const leaderOf = (nodes) => {
    const result = graphNamesPlace({
      plan: { nodes, links: [], captions: [], looseCaption: null, block: null }, rim: 100, named: new Set([1]), keep: new Set(), k: 1, labelsAll: false, measure: nameMeasure, font: '',
    });
    return stretches(result.placed.get(1), n, rail);
  };
  const plain = leaderOf([n]);
  assert.ok(plain.run.every((q) => !q.r && along(q).every((v) => Math.abs(v.y) < 0.01)), 'with nothing in the way, straight out along its ray');
  const { run } = leaderOf([n, m]);
  const points = run.flatMap(along);
  const off = points.filter((v) => Math.abs(v.y) > 0.02);
  assert.ok(off.length > 0, 'off its ray to go round card 2');
  assert.ok(off.every((v) => v.y < 0), 'on the side of card 2 its ray lies');
  const mark = m.reach + GRAPH_NAME_MARK_PAD;
  const mr = radius(m);
  const ma = Math.atan2(m.y, m.x);
  for (const v of points) assert.ok(Math.hypot(v.x - m.x, v.y - m.y) > mark, 'never over card 2\'s mark');
  // Where it passes card 2, at card 2's distance from the apex, it is as far round from card 2
  // as card 2's mark and GRAPH_NAME_DETOUR.
  const passing = run.filter((q) => !q.r && radius(q.a) < mr && radius(q.b) > mr);
  assert.strictEqual(passing.length, 1);
  assert.ok(Math.abs(turnBetween(Math.atan2(passing[0].a.y, passing[0].a.x), ma)) * mr >= mark + GRAPH_NAME_DETOUR - 0.02);
  const last = run[run.length - 1].b;
  assert.ok(Math.abs(last.y) < 0.01 && Math.abs(last.x - rail) < 0.01, 'back on its ray at the rail');
});

// --- the Unnested block's list -----------------------------------------------------------

test('the Unnested block\'s named cards sit in one list above the block, the column furthest right nearest it', () => {
  const { layout, plan } = fanOf(MODEL, { unnested: 'table' });
  const b = plan.block;
  assert.strictEqual(b.pitch, 22, 'the plan gives the pitch of the block\'s dots');
  const blockIds = b.columns.flatMap((col) => col.ids);
  for (const [w, h] of STAGES) {
    for (const zoom of ZOOMS) {
      const where = `${w}x${h} zoom ${zoom}`;
      const { result, k } = placeOn(MODEL, layout, plan, { w, h, zoom });
      const rowH = GRAPH_NAME_ROW / k;
      const listed = [];
      b.columns.forEach((col, ci) => col.ids.forEach((id, order) => {
        const p = result.placed.get(id);
        if (!p) return;
        const n = nodeOf(plan, id);
        assert.strictEqual(p.kind, 'list', `${where}: card ${id}`);
        assert.ok(p.box.y1 <= b.y, `${where}: card ${id} is named above the block`);
        const j = (b.y - p.y) / rowH - 0.9;
        assert.ok(Math.abs(j - Math.round(j)) < 1e-6 && Math.round(j) >= 0, `${where}: card ${id} is in a row of the list`);
        const pole = col.x + GRAPH_NAME_POLE;
        assert.ok(Math.abs(p.x - (pole + 4 / k)) < 1e-9 && p.anchor === 'start', `${where}: card ${id}'s name starts just right of its column's line`);
        assert.ok(p.leader.d.startsWith(`M0 0L${round(-b.pitch / 2)} ${round(-b.pitch / 2)}H${round(pole - n.x)}V${round(p.y - n.y)}`), `${where}: card ${id}'s leader runs out between the rows of dots and up its column's line to its row`);
        listed.push({ id, ci, order, j: Math.round(j) });
      }));
      assert.strictEqual(new Set(listed.map((l) => l.j)).size, listed.length, `${where}: one name to a row`);
      listed.sort((p, q) => p.j - q.j);
      for (let i = 1; i < listed.length; i++) {
        const [lower, upper] = [listed[i - 1], listed[i]];
        assert.ok(upper.ci < lower.ci || (upper.ci === lower.ci && upper.order < lower.order), `${where}: card ${upper.id} is listed above card ${lower.id}`);
      }
      if (zoom === 1) {
        assert.deepStrictEqual(result.unnamed.filter((id) => blockIds.includes(id)), BLOCK_UNNAMED_AT_FIT[`${w}x${h}`], `${where}: the block cards left unnamed`);
        assert.ok(listed.length > 0, where);
      }
    }
  }
});

test('a listed name with something in its row is cut to the room left, and its text stays inside the room it takes', () => {
  // One block card under a block well outside a small fan, and a caption to the right of the
  // list's first row: the name, far longer than the room, is cut short of the caption.
  const name = 'A title far too long for the room its row has';
  const row = 300 - 0.9 * GRAPH_NAME_ROW;
  const caption = { name: 'XXXX', x: 600, y: row, dy: '0.35em', anchor: 'start' };
  const plan = {
    nodes: [{ id: 9, x: 510, y: 320, reach: 4, kidsRing: 8, flagRing: 9, cls: 'graph-node', name }],
    links: [],
    captions: [caption],
    looseCaption: null,
    block: { x: 500, y: 300, w: 60, h: 40, pitch: 22, title: null, columns: [{ x: 500, w: 60, ids: [9], caption: null }] },
  };
  const result = graphNamesPlace({
    plan, rim: 100, named: new Set([9]), keep: new Set(), k: 1, labelsAll: false, measure: nameMeasure, font: '',
  });
  const p = result.placed.get(9);
  assert.ok(p, 'the card is listed');
  assert.strictEqual(p.kind, 'list');
  assert.ok(p.text.endsWith('…') && name.startsWith(p.text.slice(0, -1)) && p.text.length < name.length, p.text);
  assert.ok(within(drawnBox(p, 1), p.box), 'its text inside the room it takes');
  const c = captionRects({ captions: [caption] }, { x: 0, y: 0, k: 1 })[0];
  assert.ok(!graphNameMeets(p.box, { x0: c.l, x1: c.r, y0: c.t, y1: c.b }), 'clear of the caption');
});

// --- no name over another, a mark, a caption or a line ---------------------------------------

test('plan board: no two placed names overlap, and none covers a dot, a caption or the block, at every fit and zoom', () => {
  let rows = 0;
  for (const c of matrix()) {
    const placed = [...c.result.placed];
    for (const [id, p] of placed) assert.ok(within(drawnBox(p, c.k), p.box), `${c.where}: card ${id}'s text runs out of the room it takes`);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) assert.ok(!graphNameMeets(placed[i][1].box, placed[j][1].box), `${c.where}: cards ${placed[i][0]} and ${placed[j][0]}`);
    }
    const captions = captionRects(c.plan, { x: 0, y: 0, k: c.k }).map((r) => ({
      name: r.name, x0: r.l / c.k, x1: r.r / c.k, y0: r.t / c.k, y1: r.b / c.k,
    }));
    const b = c.plan.block;
    for (const [id, p] of placed) {
      if (p.kind !== 'beside') rows++;
      for (const n of c.plan.nodes) {
        if (n.id !== id) assert.ok(!graphNameDiscHits(p.box, { x: n.x, y: n.y, r: n.reach }), `${c.where}: card ${id}'s name covers card ${n.id}`);
      }
      for (const r of captions) assert.ok(!graphNameMeets(p.box, r), `${c.where}: card ${id}'s name covers the caption ${r.name}`);
      if (b) assert.ok(!graphNameMeets(p.box, { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }), `${c.where}: card ${id}'s name covers the block`);
    }
  }
  assert.ok(rows > 0);
});

test('no placed name crosses a parent line, a dependency line or a divider the plan draws', () => {
  for (const c of matrix(['folded', 'all', 'chain'])) {
    assert.ok(c.plan.dividers.length, 'a divider to cross');
    const points = linesOf(c.plan).flatMap((l) => pathPoints(l.d).map((q) => ({ ...q, l })));
    for (const [id, p] of c.result.placed) {
      assert.ok(within(drawnBox(p, c.k), p.box), `${c.where}: card ${id}'s text runs out of the room it takes`);
      const b = { x0: p.box.x0 + 1e-6, x1: p.box.x1 - 1e-6, y0: p.box.y0 + 1e-6, y1: p.box.y1 - 1e-6 };
      const on = points.find((q) => q.x > b.x0 && q.x < b.x1 && q.y > b.y0 && q.y < b.y1);
      assert.ok(!on, `${c.where}: card ${id}'s name lies over the line ${on && `${on.l.from}>${on.l.to}`}`);
    }
  }
});

test('the same input places the same names, twice over', () => {
  for (const unnested of ['outermost', 'table']) {
    const { layout, plan } = fanOf(MODEL, { unnested, lines: 'all' });
    const a = placeOn(MODEL, layout, plan, { w: 1280, h: 720 }).result;
    const b = placeOn(MODEL, layout, plan, { w: 1280, h: 720 }).result;
    assert.deepStrictEqual(a, b, unnested);
  }
});

test('relevant on the plan board names its five parents, each beside its ring with no leader', () => {
  for (const unnested of ['outermost', 'table']) {
    const { layout, plan } = fanOf(MODEL, { unnested, names: 'relevant' });
    const { result } = placeOn(MODEL, layout, plan, { names: 'relevant', w: 1600, h: 800 });
    assert.deepStrictEqual(ids(result.placed.keys()), PLAN_PARENTS, unnested);
    assert.deepStrictEqual(result.unnamed, [], unnested);
    for (const p of result.placed.values()) {
      assert.strictEqual(p.kind, 'beside');
      assert.strictEqual(p.leader, null);
    }
  }
});

test('with names on none nothing is placed and nothing is left unnamed', () => {
  const { layout, plan } = fanOf(MODEL, { names: 'none' });
  const { result } = placeOn(MODEL, layout, plan, { names: 'none' });
  assert.strictEqual(result.placed.size, 0);
  assert.deepStrictEqual(result.unnamed, []);
});

test('every named card is placed or unnamed, never both, and a text placed is the card\'s name or a start of it', () => {
  const { layout, plan } = fanOf(MODEL);
  const { result } = placeOn(MODEL, layout, plan);
  const named = ids(graphFanNames(MODEL, 'all'));
  assert.deepStrictEqual(ids([...result.placed.keys(), ...result.unnamed]), named);
  assert.strictEqual(new Set([...result.placed.keys(), ...result.unnamed]).size, named.length);
  for (const [id, p] of result.placed) {
    const name = nodeOf(plan, id).name;
    assert.ok(p.text === name || (p.text.endsWith('…') && name.startsWith(p.text.slice(0, -1))), `card ${id}: ${p.text}`);
  }
});

test('a zoom far out (k 0.01) places without a throw or a number that is not one, and a zoom that is not a number places nothing', () => {
  const { layout, plan } = fanOf(MODEL, { unnested: 'table' });
  const named = graphFanNames(MODEL, 'all');
  const input = (k) => ({
    plan, rim: graphNamesRim(layout), named, keep: new Set(), k, labelsAll: true, measure: nameMeasure, font: '',
  });
  const far = graphNamesPlace(input(0.01));
  assert.deepStrictEqual(ids([...far.placed.keys(), ...far.unnamed]), ids(named));
  for (const p of far.placed.values()) {
    for (const v of [p.x, p.y, p.box.x0, p.box.x1, p.box.y0, p.box.y1]) assert.ok(Number.isFinite(v));
    if (p.leader) assert.ok(!/NaN|Infinity/.test(p.leader.d));
  }
  for (const k of [NaN, 0, -1, Infinity, undefined]) {
    const none = graphNamesPlace(input(k));
    assert.strictEqual(none.placed.size, 0, `k ${k}`);
    assert.deepStrictEqual(none.unnamed, ids(named), `k ${k}`);
  }
});

test('a card whose place or size is not a number is left unnamed, and every other card is named as if it were not there', () => {
  const node = (id, a, r) => ({
    id, x: Math.cos(a) * r, y: Math.sin(a) * r, reach: 7, kidsRing: 10, flagRing: 10, cls: 'graph-node', name: `Card ${id} title`,
  });
  const cards = [node(1, 0.2, 80), node(2, Math.PI - 0.2, 80), node(3, Math.PI / 2, 80), node(4, -Math.PI / 2 + 0.2, 80), node(5, 1, 60), node(6, 2.2, 60)];
  const place = (nodes, named) => graphNamesPlace({
    plan: { nodes, links: [], captions: [] }, rim: 100, named: new Set(named), keep: new Set(), k: 1, labelsAll: true, measure: nameMeasure, font: '',
  });
  const sound = place(cards, [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(sound.placed.size, 6);
  const odd = { ...node(7, 1.5, 70) };
  for (const [what, bad] of [['x', { x: NaN }], ['y', { y: Infinity }], ['reach', { reach: NaN }], ['ring', { cls: 'graph-node has-kids', kidsRing: undefined }]]) {
    const got = place([...cards, { ...odd, ...bad }], [1, 2, 3, 4, 5, 6, 7]);
    assert.deepStrictEqual(got.unnamed, [7], what);
    assert.deepStrictEqual([...got.placed.entries()], [...sound.placed.entries()], `${what}: the others are named as before`);
  }
});

test('a measure that answers no number falls back to the width of the text\'s characters', () => {
  const { layout, plan } = fanOf(MODEL);
  const named = graphFanNames(MODEL, 'relevant');
  const input = (measure) => ({
    plan, rim: graphNamesRim(layout), named, keep: new Set(), k: 0.56, labelsAll: true, measure, font: '',
  });
  const plain = graphNamesPlace(input((t) => Array.from(t).length * 6.4));
  for (const odd of [() => NaN, () => -3, () => undefined, () => ({}), null]) {
    const got = graphNamesPlace(input(odd));
    assert.deepStrictEqual([...got.placed.entries()], [...plain.placed.entries()]);
  }
});
