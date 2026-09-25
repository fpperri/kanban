'use strict';
// Pure math for the map view's pan/zoom gesture. No DOM/localStorage here on
// purpose — same dual-environment pattern as refresh-policy.js/column-state.js:
// unit-testable from node --test AND loaded as a plain <script> in the browser
// (app.js calls these as bare globals).

// Multiplicative zoom, same shape a map app's +/- buttons and pinch/Ctrl+wheel
// use: each step scales by MAP_ZOOM_STEP rather than adding a fixed percentage,
// so a step feels the same size whether you're zoomed way in or way out.
// Range chosen so Fit can take in a wide board (a long dependency chain runs
// thousands of px across) and 200%
// never needs to render past crisp glyph size (buildMapSvg scales the SVG's
// width/height attribute, not a CSS transform, so text stays vector-crisp at
// any zoom in range — see applyMapZoomToSvg in app.js).
const MAP_ZOOM_MIN = 0.1;
const MAP_ZOOM_MAX = 2;
const MAP_ZOOM_DEFAULT = 1;
const MAP_ZOOM_STEP = 1.25;
// Squared-distance threshold (see mapDragExceededThreshold below) for
// "did this press become a drag" — matches the gantt's own >3px rule
// (wireGanttPointerDrag) closely enough that both surfaces feel the same
// under the pointer, with one extra px of slack since panning starts from
// ANY point in the graph (including directly on a node's clickable rect),
// where a too-twitchy threshold would turn ordinary clicks into pans.
const MAP_DRAG_THRESHOLD = 4;

// Clamp to the legal zoom range, falling back to the default for anything
// that isn't a finite number (corrupt/absent localStorage value, a stray
// NaN from a divide-by-zero elsewhere) — the map should always end up at
// SOME valid zoom, never stuck unrendered.
function clampMapZoom(zoom) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return MAP_ZOOM_DEFAULT;
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, z));
}

// One rung of the 1.25^n ladder in/out (direction > 0 zooms in, < 0 zooms
// out, 0 is a no-op — still clamps), clamped to range. Shared by the +/-
// toolbar buttons only — Ctrl+wheel/pinch scales continuously instead (see
// wheelZoomFactor below), since a whole rung per wheel tick made a trackpad
// pinch's burst of small-delta events reach the clamp in about four events.
//
// Rounds the CURRENT zoom to its nearest rung on the ladder before moving by
// one, rather than multiplying the current value directly: repeatedly
// multiplying a value that's already been clamped at MIN/MAX walks it off
// the ladder (neither MIN=0.1 nor MAX=2 is itself a power of 1.25 from
// 1.0), so once either edge was touched, true size (100%) became
// permanently unreachable from the buttons or Ctrl+wheel again — rounding first makes every step self-heal back onto the
// ladder, including the very first step from a fresh/persisted/Fit zoom
// that was never itself a rung.
function stepMapZoom(zoom, direction) {
  const current = clampMapZoom(zoom);
  if (!(direction > 0) && !(direction < 0)) return current;
  const rung = Math.round(Math.log(current) / Math.log(MAP_ZOOM_STEP)) + (direction > 0 ? 1 : -1);
  return clampMapZoom(Math.pow(MAP_ZOOM_STEP, rung));
}

// Continuous zoom for one Ctrl+wheel/pinch event, in place of stepMapZoom's
// fixed rung: a trackpad pinch arrives as a burst of wheel events with small
// deltaY values (a handful of px each), and treating every event as one full
// MAP_ZOOM_STEP tick (the original shape) made a moderate pinch hit the
// clamp in about four events — effectively a binary in/out toggle rather
// than a smooth gesture. deltaMode normalizes
// Firefox's occasional line/page-mode deltas to the same rough px scale
// Chrome/Safari always report, so the same physical wheel/pinch motion
// zooms by about the same amount regardless of browser.
const WHEEL_DELTA_PX_PER_LINE = 16; // a typical browser line-scroll height
const WHEEL_DELTA_PX_PER_PAGE = 800; // a typical viewport-ish page-scroll height

function normalizeWheelDeltaY(deltaY, deltaMode) {
  const dy = Number(deltaY) || 0;
  if (deltaMode === 1) return dy * WHEEL_DELTA_PX_PER_LINE; // DOM_DELTA_LINE
  if (deltaMode === 2) return dy * WHEEL_DELTA_PX_PER_PAGE; // DOM_DELTA_PAGE
  return dy; // DOM_DELTA_PIXEL (0) — the common case
}

// exp() rather than a linear scale so the SAME |deltaY| always produces the
// SAME ratio whichever direction it zooms — a linear "1 - deltaY*k" factor
// would over-correct on the way back (zoom out then the same deltaY back in
// would not land on the original zoom). Calibrated so a mouse's one-notch
// deltaY (~100) lands on exactly one MAP_ZOOM_STEP tick, the same size step
// the +/- buttons take: exp(-100k) = 1/MAP_ZOOM_STEP => k = ln(MAP_ZOOM_STEP)/100.
function wheelZoomFactor(deltaY, deltaMode) {
  const px = normalizeWheelDeltaY(deltaY, deltaMode);
  const k = Math.log(MAP_ZOOM_STEP) / 100;
  return Math.exp(-px * k);
}

function stepMapZoomByWheel(zoom, deltaY, deltaMode) {
  return clampMapZoom(clampMapZoom(zoom) * wheelZoomFactor(deltaY, deltaMode));
}

// The scroll offset that keeps the content point under the pointer visually
// fixed when the zoom changes — the same math a map app's "zoom to cursor"
// uses. pointerX/pointerY are the pointer's position relative to the
// scrollable panel's own viewport (e.g. clientX - panel.getBoundingClientRect().left),
// NOT page coordinates — the panel can be scrolled anywhere on the page, but
// this offset only cares about where the pointer sits within the panel's
// visible window. scrollLeft/scrollTop are the panel's CURRENT scroll
// position, at oldZoom.
//
// originX/originY are where the SCALING content (the SVG) starts, in that
// same scroll-content coordinate space — default 0 for a panel whose
// scrollable content IS the thing that scales. #map-view is NOT that simple:
// its own padding plus the filter row, zoom row and section header all sit
// between the panel's scroll origin and the SVG, and NONE of that scales
// with zoom (a zero origin would drift the anchor point by origin*(ratio-1)
// per step, ~26px on a typical layout). Only the space from the origin onward scales; everything before
// it is a fixed offset carried through unchanged.
//
// Derivation: `scrollLeft + pointerX - originX` is the point's position in
// SVG-content pixels at oldZoom (origin subtracted out first); scaling that
// by newZoom/oldZoom gives its position at the new zoom; adding the origin
// back and subtracting pointerX gives the scrollLeft that puts it back under
// the same on-screen pointer position.
function mapZoomPanOffset({ scrollLeft, scrollTop, pointerX, pointerY, oldZoom, newZoom, originX = 0, originY = 0 }) {
  const ratio = oldZoom > 0 ? newZoom / oldZoom : 1;
  return {
    scrollLeft: (scrollLeft + pointerX - originX) * ratio + originX - pointerX,
    scrollTop: (scrollTop + pointerY - originY) * ratio + originY - pointerY,
  };
}

// The largest zoom (capped at 100% — MAP_ZOOM_DEFAULT, never magnify past
// true size just because the panel is huge and the graph is tiny) at which a
// graphWidth x graphHeight box fits inside a panelWidth x panelHeight box.
// Guards non-positive/non-finite inputs (a not-yet-laid-out panel measuring
// 0, a graph with no nodes) by returning the default rather than dividing by
// zero or clamping Infinity down to MAP_ZOOM_MAX.
function fitMapZoom(graphWidth, graphHeight, panelWidth, panelHeight) {
  if (!(graphWidth > 0) || !(graphHeight > 0) || !(panelWidth > 0) || !(panelHeight > 0)) return MAP_ZOOM_DEFAULT;
  return clampMapZoom(Math.min(MAP_ZOOM_DEFAULT, panelWidth / graphWidth, panelHeight / graphHeight));
}

// Whether a pointer has moved far enough from its press origin to count as a
// drag rather than a click — squared-distance compare (no sqrt needed) against
// MAP_DRAG_THRESHOLD by default. Euclidean, not axis-separate like the
// gantt's `Math.abs(dx) > 3` — the map pans on BOTH axes at once (the gantt
// only ever drags horizontally), so a diagonal nudge under the per-axis limit
// but over the true distance would wrongly stay "click".
function mapDragExceededThreshold(dx, dy, threshold) {
  const t = typeof threshold === 'number' ? threshold : MAP_DRAG_THRESHOLD;
  return (dx * dx + dy * dy) > (t * t);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAP_ZOOM_MIN, MAP_ZOOM_MAX, MAP_ZOOM_DEFAULT, MAP_ZOOM_STEP, MAP_DRAG_THRESHOLD,
    clampMapZoom, stepMapZoom, mapZoomPanOffset, fitMapZoom, mapDragExceededThreshold,
    normalizeWheelDeltaY, wheelZoomFactor, stepMapZoomByWheel,
  };
} else {
  window.MAP_ZOOM_MIN = MAP_ZOOM_MIN;
  window.MAP_ZOOM_MAX = MAP_ZOOM_MAX;
  window.MAP_ZOOM_DEFAULT = MAP_ZOOM_DEFAULT;
  window.MAP_ZOOM_STEP = MAP_ZOOM_STEP;
  window.MAP_DRAG_THRESHOLD = MAP_DRAG_THRESHOLD;
  window.clampMapZoom = clampMapZoom;
  window.stepMapZoom = stepMapZoom;
  window.mapZoomPanOffset = mapZoomPanOffset;
  window.fitMapZoom = fitMapZoom;
  window.mapDragExceededThreshold = mapDragExceededThreshold;
  window.normalizeWheelDeltaY = normalizeWheelDeltaY;
  window.wheelZoomFactor = wheelZoomFactor;
  window.stepMapZoomByWheel = stepMapZoomByWheel;
}
