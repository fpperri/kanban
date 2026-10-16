const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { graphLayoutTiers, graphPlan, graphFanNames } = require('../web/graph-model');
const {
  GRAPH_NAME_PAD, GRAPH_NAME_ROW,
  graphNamesPlace, graphNamesKey, graphNamesRim, graphNameAssign, graphNameFit, graphNameFlatten, graphNameSegHits, graphNameDiscHits, graphNameMeets,
} = require('../web/graph-names');
const {
  STATUSES, loadBoard, cleanUp, drawnModel, nameMeasure, placeOn,
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
const PLAN_PARENTS = [1, 2, 7, 22, 23];
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

// --- one pure module ----------------------------------------------------------------------

test('graph-names.js is pure: no page, no measuring in a browser, no clock, no chance', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'graph-names.js'), 'utf8');
  const tail = src.indexOf("if (typeof module !== 'undefined' && module.exports)");
  assert.ok(tail > 0, 'the module ends in the dual-environment tail');
  const body = src.slice(0, tail);
  for (const banned of [/\bdocument\b/, /\bwindow\./, /getBBox/, /getTotalLength/, /getComputedStyle/, /\bDate\b/, /Math\.random/, /\bperformance\b/, /innerHTML/, /style=/]) {
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
  }
  for (const k of [NaN, 0, -1, Infinity, undefined]) {
    const none = graphNamesPlace(input(k));
    assert.strictEqual(none.placed.size, 0, `k ${k}`);
    assert.deepStrictEqual(none.unnamed, ids(named), `k ${k}`);
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
