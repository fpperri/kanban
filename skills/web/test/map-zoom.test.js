const { test } = require('node:test');
const assert = require('node:assert');
const {
  MAP_ZOOM_MIN, MAP_ZOOM_MAX, MAP_ZOOM_DEFAULT, MAP_ZOOM_STEP, MAP_DRAG_THRESHOLD,
  clampMapZoom, stepMapZoom, mapZoomPanOffset, fitMapZoom, mapDragExceededThreshold,
  normalizeWheelDeltaY, wheelZoomFactor, stepMapZoomByWheel,
} = require('../web/map-zoom');

// --- clampMapZoom ---------------------------------------------------------

test('clampMapZoom passes a value already inside range through unchanged', () => {
  assert.strictEqual(clampMapZoom(1), 1);
  assert.strictEqual(clampMapZoom(0.5), 0.5);
});

test('clampMapZoom clamps below MAP_ZOOM_MIN up to the floor', () => {
  assert.strictEqual(clampMapZoom(0.01), MAP_ZOOM_MIN);
  assert.strictEqual(clampMapZoom(-3), MAP_ZOOM_MIN);
});

test('clampMapZoom clamps above MAP_ZOOM_MAX down to the ceiling', () => {
  assert.strictEqual(clampMapZoom(50), MAP_ZOOM_MAX);
});

test('clampMapZoom falls back to the default for non-finite input — never leaves the map unrendered', () => {
  assert.strictEqual(clampMapZoom(NaN), MAP_ZOOM_DEFAULT);
  assert.strictEqual(clampMapZoom(Infinity), MAP_ZOOM_DEFAULT);
  assert.strictEqual(clampMapZoom(undefined), MAP_ZOOM_DEFAULT);
  assert.strictEqual(clampMapZoom('not a number'), MAP_ZOOM_DEFAULT);
});

// Number(null) is 0, not NaN — a real (if unusual) numeric value, so this
// takes the ordinary clamp path rather than the non-finite fallback above.
test('clampMapZoom treats null as the number 0 and clamps it to the floor', () => {
  assert.strictEqual(clampMapZoom(null), MAP_ZOOM_MIN);
});

// --- stepMapZoom -----------------------------------------------------------

test('stepMapZoom(zoom, 1) multiplies by MAP_ZOOM_STEP', () => {
  assert.strictEqual(stepMapZoom(1, 1), MAP_ZOOM_STEP);
});

test('stepMapZoom(zoom, -1) divides by MAP_ZOOM_STEP', () => {
  assert.strictEqual(stepMapZoom(1, -1), 1 / MAP_ZOOM_STEP);
});

test('stepMapZoom(zoom, 0) is a no-op (still clamps)', () => {
  assert.strictEqual(stepMapZoom(1, 0), 1);
  assert.strictEqual(stepMapZoom(50, 0), MAP_ZOOM_MAX);
});

test('stepMapZoom clamps at MAP_ZOOM_MAX rather than overshooting', () => {
  assert.strictEqual(stepMapZoom(MAP_ZOOM_MAX, 1), MAP_ZOOM_MAX);
  assert.strictEqual(stepMapZoom(1.9, 1), MAP_ZOOM_MAX);
});

test('stepMapZoom clamps at MAP_ZOOM_MIN rather than undershooting', () => {
  assert.strictEqual(stepMapZoom(MAP_ZOOM_MIN, -1), MAP_ZOOM_MIN);
});

// 0.3 isn't itself a rung of the 1.25^n ladder (from 1.0) — stepMapZoom
// rounds it to the NEAREST rung first (n=-5, 1.25^-5≈0.32768), then steps
// one more (n=-6), landing on 1.25^-6≈0.262144, not straight at the floor.
// Was MAP_ZOOM_MIN before the 2026-09-25 review (#280): the old
// current/MAP_ZOOM_STEP shape stepped from the raw 0.3 rather than its
// nearest rung, which happened to undershoot past the floor for this
// particular input — the very off-ladder drift the rung-rounding fix closes.
test('stepMapZoom starting from an off-ladder value rounds to its nearest rung before stepping', () => {
  assert.strictEqual(stepMapZoom(0.3, -1), Math.pow(MAP_ZOOM_STEP, -6));
});

test('stepMapZoom starts from an out-of-range/invalid current zoom by clamping it first', () => {
  assert.strictEqual(stepMapZoom(NaN, 1), clampMapZoom(MAP_ZOOM_DEFAULT * MAP_ZOOM_STEP));
});

// Regression (2026-09-25 review, #280): stepping multiplied the already-
// CLAMPED value once either edge was touched, walking it off the ladder —
// MAX (2) and MIN (0.25) are not themselves powers of MAP_ZOOM_STEP from
// 1.0, so true size became PERMANENTLY unreachable from the buttons/wheel
// afterward (the review's own trace: 200 200 | 160 128 102 82 66 — 100 never
// recurs). Rounding to the nearest rung before each step is lossy exactly
// AT the clamp (the clamped value's own nearest rung isn't necessarily the
// rung the step that produced it targeted) — a full n-out/n-back count does
// NOT land back on the exact same value in general, and that's expected,
// not itself a bug. What the fix actually restores is reachability: stepping
// back the other way passes through exactly MAP_ZOOM_DEFAULT partway, so a
// human tapping toward "true size" can always get there again, verified
// against the exact recovery step counts below (node --test, deterministic
// floating point).
test('stepMapZoom: after clamping at MAX, stepping back out passes through exactly true size again', () => {
  let z = MAP_ZOOM_DEFAULT;
  for (let i = 0; i < 4; i++) z = stepMapZoom(z, 1); // 1.25, 1.5625, 1.953125, clamps to MAX(2)
  assert.strictEqual(z, MAP_ZOOM_MAX);
  z = stepMapZoom(z, -1); // 1.5625
  z = stepMapZoom(z, -1); // 1.25
  z = stepMapZoom(z, -1); // back to exactly 1 — the review's own bug never recovered this
  assert.strictEqual(z, MAP_ZOOM_DEFAULT);
});

test('stepMapZoom: after clamping at MIN, stepping back in passes through exactly true size again', () => {
  let z = MAP_ZOOM_DEFAULT;
  for (let i = 0; i < 7; i++) z = stepMapZoom(z, -1); // ...clamps to MIN(0.25) by step 7
  assert.strictEqual(z, MAP_ZOOM_MIN);
  for (let i = 0; i < 6; i++) z = stepMapZoom(z, 1); // recovers rung by rung
  assert.strictEqual(z, MAP_ZOOM_DEFAULT);
});

// --- mapZoomPanOffset --------------------------------------------------------

test('mapZoomPanOffset is a no-op when the zoom does not change', () => {
  const r = mapZoomPanOffset({ scrollLeft: 120, scrollTop: 40, pointerX: 200, pointerY: 80, oldZoom: 1, newZoom: 1 });
  assert.deepStrictEqual(r, { scrollLeft: 120, scrollTop: 40 });
});

test('mapZoomPanOffset keeps the point under the pointer fixed when zooming in (doubling)', () => {
  // Content point under the pointer, at oldZoom=1: scrollLeft(100) + pointerX(50) = 150.
  // At newZoom=2 that same point sits at 300 in content pixels; the new
  // scrollLeft that puts it back under pointerX=50 is 300 - 50 = 250.
  const r = mapZoomPanOffset({ scrollLeft: 100, scrollTop: 20, pointerX: 50, pointerY: 10, oldZoom: 1, newZoom: 2 });
  assert.strictEqual(r.scrollLeft, 250);
  assert.strictEqual(r.scrollTop, 50); // (20 + 10) * 2 - 10
});

test('mapZoomPanOffset keeps the point under the pointer fixed when zooming out (halving)', () => {
  const r = mapZoomPanOffset({ scrollLeft: 300, scrollTop: 100, pointerX: 50, pointerY: 25, oldZoom: 2, newZoom: 1 });
  assert.strictEqual(r.scrollLeft, 125); // (300 + 50) * 0.5 - 50
  assert.strictEqual(r.scrollTop, 37.5); // (100 + 25) * 0.5 - 25
});

test('mapZoomPanOffset treats a pointer at the panel origin (0,0) the same as any other point', () => {
  const r = mapZoomPanOffset({ scrollLeft: 40, scrollTop: 40, pointerX: 0, pointerY: 0, oldZoom: 1, newZoom: 2 });
  assert.strictEqual(r.scrollLeft, 80);
  assert.strictEqual(r.scrollTop, 80);
});

test('mapZoomPanOffset never divides by zero when oldZoom is 0 (defensive — zoom is never actually 0 in practice)', () => {
  const r = mapZoomPanOffset({ scrollLeft: 10, scrollTop: 10, pointerX: 5, pointerY: 5, oldZoom: 0, newZoom: 2 });
  assert.strictEqual(r.scrollLeft, 10);
  assert.strictEqual(r.scrollTop, 10);
});

// originX/originY default to 0 — a panel whose scrollable content IS the
// thing that scales — so every test above (no origin passed) is unaffected.
test('mapZoomPanOffset origin defaults to 0, matching the no-origin calls above', () => {
  const r = mapZoomPanOffset({ scrollLeft: 100, scrollTop: 20, pointerX: 50, pointerY: 10, oldZoom: 1, newZoom: 2 });
  assert.strictEqual(r.scrollLeft, 250);
  assert.strictEqual(r.scrollTop, 50);
});

// Regression (2026-09-25 review, #280): #map-view's padding + the filter/
// zoom/header rows sit between the panel's scroll origin and the SVG, and
// none of that scales with zoom — a zero origin scaled that FIXED offset
// right along with the graph, drifting the anchor point by origin*(ratio-1)
// per step (~26px measured on a real layout). With a non-zero origin
// matching that fixed offset, only the space past it scales.
test('mapZoomPanOffset with a non-zero origin scales only the space past the origin, not the fixed offset before it', () => {
  // Origin 100 (content starts scrolling into the SVG only past pixel 100).
  // Point under the pointer at oldZoom=1: scrollLeft(300)+pointerX(0)=300,
  // which is 200px INTO the SVG past the origin. At newZoom=1.25 that
  // in-SVG distance becomes 250, so the point sits at origin+250=350; the
  // scrollLeft that puts it back under pointerX=0 is 350.
  const r = mapZoomPanOffset({ scrollLeft: 300, scrollTop: 300, pointerX: 0, pointerY: 0, oldZoom: 1, newZoom: 1.25, originX: 100, originY: 100 });
  assert.strictEqual(r.scrollLeft, 350);
  assert.strictEqual(r.scrollTop, 350);
});

test('mapZoomPanOffset with a non-zero origin is a no-op at the origin itself scrolled to exactly 0', () => {
  // scrollLeft+pointerX-originX = 0 — the pointer sits exactly at the SVG's
  // own top-left corner — so scaling "0 content px" stays 0 regardless of
  // ratio, and the result is just originX-pointerX (unaffected by zoom).
  const r = mapZoomPanOffset({ scrollLeft: 0, scrollTop: 0, pointerX: 40, pointerY: 60, oldZoom: 1, newZoom: 2, originX: 40, originY: 60 });
  assert.strictEqual(r.scrollLeft, 0);
  assert.strictEqual(r.scrollTop, 0);
});

// --- fitMapZoom --------------------------------------------------------------

test('fitMapZoom returns 100% when the graph already fits the panel with room to spare', () => {
  assert.strictEqual(fitMapZoom(400, 300, 1000, 1000), MAP_ZOOM_DEFAULT);
});

test('fitMapZoom shrinks to the narrower of the two axis ratios (width-bound)', () => {
  // width ratio 500/1000=0.5, height ratio 500/600=0.833 — width is the binding constraint
  assert.strictEqual(fitMapZoom(1000, 600, 500, 500), 0.5);
});

test('fitMapZoom shrinks to the narrower of the two axis ratios (height-bound)', () => {
  // width ratio 500/600=0.833, height ratio 500/1000=0.5 — height is the binding constraint
  assert.strictEqual(fitMapZoom(600, 1000, 500, 500), 0.5);
});

test('fitMapZoom clamps its result to MAP_ZOOM_MIN on a graph far bigger than the panel', () => {
  assert.strictEqual(fitMapZoom(20000, 20000, 500, 500), MAP_ZOOM_MIN);
});

test('fitMapZoom falls back to the default for a zero/negative/non-finite graph or panel size', () => {
  assert.strictEqual(fitMapZoom(0, 300, 1000, 1000), MAP_ZOOM_DEFAULT);
  assert.strictEqual(fitMapZoom(400, 300, 0, 1000), MAP_ZOOM_DEFAULT);
  assert.strictEqual(fitMapZoom(-1, 300, 1000, 1000), MAP_ZOOM_DEFAULT);
  assert.strictEqual(fitMapZoom(NaN, 300, 1000, 1000), MAP_ZOOM_DEFAULT);
});

// --- mapDragExceededThreshold ------------------------------------------------

test('mapDragExceededThreshold is false for no movement at all', () => {
  assert.strictEqual(mapDragExceededThreshold(0, 0, MAP_DRAG_THRESHOLD), false);
});

test('mapDragExceededThreshold is false for a wiggle under the threshold on one axis', () => {
  assert.strictEqual(mapDragExceededThreshold(MAP_DRAG_THRESHOLD - 1, 0, MAP_DRAG_THRESHOLD), false);
});

test('mapDragExceededThreshold is true once past the threshold on one axis', () => {
  assert.strictEqual(mapDragExceededThreshold(MAP_DRAG_THRESHOLD + 1, 0, MAP_DRAG_THRESHOLD), true);
});

test('mapDragExceededThreshold is true for a diagonal move whose per-axis components are each under threshold but whose true distance is over it', () => {
  // 3-4-5 triangle: dx=3, dy=4 individually stay under a 4.5 threshold, but the
  // true distance (5) exceeds it — the axis-separate check the gantt uses would
  // wrongly call this a click.
  assert.strictEqual(mapDragExceededThreshold(3, 4, 4.5), true);
});

test('mapDragExceededThreshold works with negative deltas (dragging up/left)', () => {
  assert.strictEqual(mapDragExceededThreshold(-(MAP_DRAG_THRESHOLD + 1), 0, MAP_DRAG_THRESHOLD), true);
  assert.strictEqual(mapDragExceededThreshold(0, -(MAP_DRAG_THRESHOLD - 1), MAP_DRAG_THRESHOLD), false);
});

test('mapDragExceededThreshold defaults to MAP_DRAG_THRESHOLD when no threshold is passed', () => {
  assert.strictEqual(mapDragExceededThreshold(MAP_DRAG_THRESHOLD + 1, 0), true);
  assert.strictEqual(mapDragExceededThreshold(MAP_DRAG_THRESHOLD - 1, 0), false);
});

// --- normalizeWheelDeltaY / wheelZoomFactor / stepMapZoomByWheel -------------
// Regression (2026-09-25 review, #280): the original Ctrl+wheel handler took
// one full MAP_ZOOM_STEP tick per wheel EVENT regardless of its deltaY, so a
// trackpad pinch's burst of small-delta events reached the zoom clamp in
// about four events — a smooth gesture read as an effectively binary
// in/out toggle. These scale continuously from the delta instead.

test('normalizeWheelDeltaY passes pixel-mode (0) deltas through unchanged', () => {
  assert.strictEqual(normalizeWheelDeltaY(37, 0), 37);
  assert.strictEqual(normalizeWheelDeltaY(-37, 0), -37);
});

test('normalizeWheelDeltaY scales line-mode (1) deltas up to a rough pixel size', () => {
  assert.ok(Math.abs(normalizeWheelDeltaY(1, 1)) > 1, 'one line should normalize to more than one pixel');
});

test('normalizeWheelDeltaY scales page-mode (2) deltas up further than line-mode', () => {
  assert.ok(normalizeWheelDeltaY(1, 2) > normalizeWheelDeltaY(1, 1));
});

test('wheelZoomFactor is 1 (no-op) for a zero delta', () => {
  assert.strictEqual(wheelZoomFactor(0, 0), 1);
});

test('wheelZoomFactor is greater than 1 (zooms in) for a negative deltaY — scrolling up', () => {
  assert.ok(wheelZoomFactor(-50, 0) > 1);
});

test('wheelZoomFactor is less than 1 (zooms out) for a positive deltaY — scrolling down', () => {
  assert.ok(wheelZoomFactor(50, 0) < 1);
});

// Calibrated so a mouse's one-notch deltaY (100) matches exactly one
// stepMapZoom tick — a mouse wheel should feel the same through either path.
test('wheelZoomFactor matches one full MAP_ZOOM_STEP tick at a mouse-notch deltaY of 100', () => {
  assert.ok(Math.abs(wheelZoomFactor(-100, 0) - MAP_ZOOM_STEP) < 1e-9);
  assert.ok(Math.abs(wheelZoomFactor(100, 0) - 1 / MAP_ZOOM_STEP) < 1e-9);
});

test('wheelZoomFactor: zooming in then back out by the same |deltaY| returns to ~1 (float rounding only)', () => {
  assert.ok(Math.abs(wheelZoomFactor(-42, 0) * wheelZoomFactor(42, 0) - 1) < 1e-12);
});

test('stepMapZoomByWheel: a small pinch delta moves the zoom by a small amount, not a full clamp-to-clamp jump', () => {
  const z = stepMapZoomByWheel(MAP_ZOOM_DEFAULT, -3, 0);
  assert.ok(z > MAP_ZOOM_DEFAULT && z < MAP_ZOOM_DEFAULT * MAP_ZOOM_STEP,
    `expected a small step past ${MAP_ZOOM_DEFAULT}, got ${z}`);
});

test('stepMapZoomByWheel starts from an out-of-range/invalid current zoom by clamping it first', () => {
  assert.strictEqual(stepMapZoomByWheel(NaN, -100, 0), clampMapZoom(MAP_ZOOM_DEFAULT * MAP_ZOOM_STEP));
});

test('stepMapZoomByWheel clamps at MAP_ZOOM_MAX/MIN rather than overshooting', () => {
  assert.strictEqual(stepMapZoomByWheel(MAP_ZOOM_MAX, -1000, 0), MAP_ZOOM_MAX);
  assert.strictEqual(stepMapZoomByWheel(MAP_ZOOM_MIN, 1000, 0), MAP_ZOOM_MIN);
});
