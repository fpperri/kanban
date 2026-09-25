const { test } = require('node:test');
const assert = require('node:assert');
const {
  MAP_ZOOM_MIN, MAP_ZOOM_MAX, MAP_ZOOM_DEFAULT, MAP_ZOOM_STEP, MAP_DRAG_THRESHOLD,
  clampMapZoom, stepMapZoom, mapZoomPanOffset, fitMapZoom, mapDragExceededThreshold,
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
  assert.strictEqual(stepMapZoom(0.3, -1), MAP_ZOOM_MIN);
});

test('stepMapZoom starts from an out-of-range/invalid current zoom by clamping it first', () => {
  assert.strictEqual(stepMapZoom(NaN, 1), clampMapZoom(MAP_ZOOM_DEFAULT * MAP_ZOOM_STEP));
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
