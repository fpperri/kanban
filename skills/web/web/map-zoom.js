'use strict';
// Pure math for the map view's pan/zoom gesture. No DOM/localStorage here on
// purpose — same dual-environment pattern as refresh-policy.js/column-state.js:
// unit-testable from node --test AND loaded as a plain <script> in the browser
// (app.js calls these as bare globals).

// Multiplicative zoom, same shape a map app's +/- buttons and pinch/Ctrl+wheel
// use: each step scales by MAP_ZOOM_STEP rather than adding a fixed percentage,
// so a step feels the same size whether you're zoomed way in or way out.
// Range chosen so 25% still shows readable node ids on a big board and 200%
// never needs to render past crisp glyph size (buildMapSvg scales the SVG's
// width/height attribute, not a CSS transform, so text stays vector-crisp at
// any zoom in range — see applyMapZoomToSvg in app.js).
const MAP_ZOOM_MIN = 0.25;
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

// One multiplicative step in/out (direction > 0 zooms in, < 0 zooms out, 0 is
// a no-op), clamped to range. Shared by the +/- toolbar buttons and Ctrl+wheel
// — a wheel "tick" and a button press move the zoom by the same amount, so
// the two controls feel interchangeable rather than one being finer-grained.
function stepMapZoom(zoom, direction) {
  const current = clampMapZoom(zoom);
  if (direction > 0) return clampMapZoom(current * MAP_ZOOM_STEP);
  if (direction < 0) return clampMapZoom(current / MAP_ZOOM_STEP);
  return current;
}

// The scroll offset that keeps the content point under the pointer visually
// fixed when the zoom changes — the same math a map app's "zoom to cursor"
// uses. pointerX/pointerY are the pointer's position relative to the
// scrollable panel's own viewport (e.g. clientX - panel.getBoundingClientRect().left),
// NOT page coordinates — the panel can be scrolled anywhere on the page, but
// this offset only cares about where the pointer sits within the panel's
// visible window. scrollLeft/scrollTop are the panel's CURRENT scroll
// position, at oldZoom. Derivation: `scrollLeft + pointerX` is the point's
// position in content pixels at oldZoom; scaling that by newZoom/oldZoom
// gives its position at the new zoom; subtracting pointerX back out gives the
// scrollLeft that puts it back under the same on-screen pointer position.
function mapZoomPanOffset({ scrollLeft, scrollTop, pointerX, pointerY, oldZoom, newZoom }) {
  const ratio = oldZoom > 0 ? newZoom / oldZoom : 1;
  return {
    scrollLeft: (scrollLeft + pointerX) * ratio - pointerX,
    scrollTop: (scrollTop + pointerY) * ratio - pointerY,
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
}
