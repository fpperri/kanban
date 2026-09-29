'use strict';
// Pure layout math for the epic-clusters map. No DOM here — same
// dual-environment pattern as dependency-graph.js/map-zoom.js: unit-testable
// from node --test AND loaded as a plain <script> in the browser (app.js
// calls layoutMap as a bare global).
//
// Input shape: { ids, edges, frames, sizes, maxWidth }
// - ids: every laid-out participant id (graph.participants) — plain cards
//   AND epic ids that became frames (mapFrames, dependency-graph.js) alike.
// - edges: graph.edges (both kinds) — only 'dep' edges matter here;
//   membership ('epic') edges carry no layout meaning any more, since
//   containment (frames) now says what they used to say.
// - frames: mapFrames(cards, graph)'s output — epicId, memberIds,
//   ghost/missing, parentFrameId (cycle-broken).
// - sizes: { nodeW, nodeH, gapX, gapY, pad, titleH } — the caller's pixel
//   constants (kept in app.js, passed in rather than duplicated here, same
//   "one source of truth" reasoning as everywhere else in this file pair).
// - maxWidth: the logical width a shelf may fill before wrapping (top level
//   and, minus 2*pad, every frame's own internal packing) — a fixed
//   constant the caller chooses, never a DOM measurement (see app.js's
//   MAP_LAYOUT_MAX_WIDTH comment for why: an earlier gantt bug came from
//   reading clientWidth mid-rebuild).
//
// Output: { width, height, nodes, frames, edges } — absolute positions for
// every plain-card unit and every frame's outer box, plus every drawn
// dependency edge's endpoints and back-edge flag. app.js turns this into SVG;
// no drawing decision (colors, dashing, arrowheads) lives here.
// Not named DG — search.js already claims that top-level name, and this
// script shares its page scope with every other web/*.js (global-scope.test.js
// guards every such collision).
const DEP_GRAPH = (typeof module !== 'undefined' && module.exports) ? require('./dependency-graph') : window;

// Walks `id` up the containment chain until it reaches the unit that sits
// DIRECTLY inside `levelContainer` (null = top level) — the id this edge
// endpoint "lifts to" at that level. Returns null when `id` isn't inside
// `levelContainer` at all (a different subtree entirely), so the caller can
// drop an edge that has nothing to say about this level's layering.
function liftToLevel(id, levelContainer, containerOf) {
  let cur = id;
  for (;;) {
    const c = containerOf.has(cur) ? containerOf.get(cur) : null;
    if (c === levelContainer) return cur;
    if (c === null) return null;
    cur = c;
  }
}

// Minimal union-find for the "connected component" half of requirement 5 —
// grouping units an edge, lifted to this level, actually connects.
function unionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  function find(x) {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  }
  function union(a, b) {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return { find, union };
}

// Lays out ONE level's units (either the top-level graph, or one frame's
// direct members) — Kahn layers (reusing layerNodes' own semantics/cycle
// break verbatim), barycenter-ordered rows, rows centered on their
// component's width, components shelf-packed left to right into maxWidth.
// `boxSizeOf(id)` gives each unit's own {w,h} — a plain card's fixed size, or
// a nested frame's already-computed outer size (the caller sizes frames
// bottom-up before calling this for an ENCLOSING level).
function layoutLevel(unitIds, levelEdges, boxSizeOf, sizes, maxWidth) {
  if (!unitIds.length) return { width: 0, height: 0, placements: new Map() };

  const layer = DEP_GRAPH.layerNodes(unitIds, levelEdges);
  const uf = unionFind(unitIds);
  levelEdges.forEach((e) => uf.union(e.from, e.to));
  const compMembers = new Map();
  unitIds.forEach((id) => {
    const rep = uf.find(id);
    if (!compMembers.has(rep)) compMembers.set(rep, []);
    compMembers.get(rep).push(id);
  });

  const components = [];
  for (const memberIds of compMembers.values()) {
    const byLayer = new Map();
    memberIds.forEach((id) => {
      const l = layer.get(id) || 0;
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l).push(id);
    });
    const layerIdxs = [...byLayer.keys()].sort((a, b) => a - b);

    const xCenter = new Map();
    const localPos = new Map(); // id -> {x, y} (top-left, relative to this component's own origin)
    const rows = []; // { width, boxes: [{id}] } — for the post-pass centering step
    let curY = 0;
    let compWidth = 0;

    layerIdxs.forEach((l, li) => {
      const idsHere = byLayer.get(l);
      let ordered;
      if (li === 0) {
        ordered = [...idsHere].sort((a, b) => a - b);
      } else {
        // Barycenter of the PREVIOUS layer only (not every earlier layer —
        // a cycle-broken edge can skip layers, and such a predecessor isn't
        // positioned yet when this layer is ordered); no such predecessor
        // at all falls back to id order, sorted after every scored id so a
        // deterministic order always exists.
        const prevLayer = layerIdxs[li - 1];
        const scored = idsHere.map((id) => {
          const preds = levelEdges
            .filter((e) => e.to === id && layer.get(e.from) === prevLayer)
            .map((e) => xCenter.get(e.from));
          return { id, score: preds.length ? preds.reduce((s, v) => s + v, 0) / preds.length : null };
        });
        scored.sort((a, b) => {
          if (a.score === null && b.score === null) return a.id - b.id;
          if (a.score === null) return 1;
          if (b.score === null) return -1;
          return a.score - b.score || a.id - b.id;
        });
        ordered = scored.map((s) => s.id);
      }
      const rowHeight = Math.max(...ordered.map((id) => boxSizeOf(id).h));
      let x = 0;
      const boxes = [];
      ordered.forEach((id, i) => {
        const box = boxSizeOf(id);
        if (i > 0) x += sizes.gapX;
        localPos.set(id, { x, y: curY });
        xCenter.set(id, x + box.w / 2);
        boxes.push(id);
        x += box.w;
      });
      rows.push({ width: x, boxes });
      compWidth = Math.max(compWidth, x);
      curY += rowHeight + sizes.gapY;
    });
    curY -= sizes.gapY; // no trailing gap after the last row

    // Center every row within the component's own (widest-row) width.
    rows.forEach((row) => {
      const offset = (compWidth - row.width) / 2;
      row.boxes.forEach((id) => { localPos.get(id).x += offset; });
    });

    components.push({ width: compWidth, height: curY, minId: Math.min(...memberIds), memberIds, localPos });
  }

  // Shelf-pack: largest (by area) first, lowest id as the tiebreak — a
  // stable, deterministic order independent of Map/component enumeration
  // order. The very first component on an empty shelf always fits (nothing
  // to overflow yet), even wider than maxWidth alone.
  components.sort((a, b) => (b.width * b.height - a.width * a.height) || (a.minId - b.minId));
  let shelfX = 0; let shelfY = 0; let shelfH = 0; let usedWidth = 0;
  components.forEach((comp, i) => {
    if (i > 0 && shelfX + sizes.gapX + comp.width > maxWidth) {
      shelfY += shelfH + sizes.gapY;
      shelfX = 0;
      shelfH = 0;
    } else if (i > 0) {
      shelfX += sizes.gapX;
    }
    comp.offsetX = shelfX;
    comp.offsetY = shelfY;
    shelfX += comp.width;
    shelfH = Math.max(shelfH, comp.height);
    usedWidth = Math.max(usedWidth, shelfX);
  });

  const placements = new Map();
  components.forEach((comp) => {
    comp.memberIds.forEach((id) => {
      const p = comp.localPos.get(id);
      placements.set(id, { x: p.x + comp.offsetX, y: p.y + comp.offsetY });
    });
  });

  return { width: usedWidth, height: shelfY + shelfH, placements };
}

function layoutMap({ ids, edges, frames, sizes, maxWidth }) {
  const frameList = frames || [];
  const frameByEpicId = new Map(frameList.map((f) => [f.epicId, f]));
  const depEdges = (edges || []).filter((e) => e.kind === 'dep');

  // containerOf is the SINGLE source of truth for "who draws me" — for a
  // plain-card member this is just its listed frame, but for a member that
  // is ITSELF a frame, only mapFrames' own cycle-broken parentFrameId wins:
  // raw memberIds still name both sides of a broken cycle (mapFrames reports
  // structure, not draw order), and trusting memberIds here instead would
  // recreate the very cycle mapFrames just cut — computeFrame() would ask
  // for a member frame's size while that frame is still busy asking for
  // this one's, and neither call would ever return.
  const containerOf = new Map();
  frameList.forEach((f) => {
    f.memberIds.forEach((m) => {
      const memberFrame = frameByEpicId.get(m);
      if (memberFrame && memberFrame.parentFrameId !== f.epicId) return; // escaped elsewhere by the cycle break
      containerOf.set(m, f.epicId);
    });
  });
  const effectiveMembers = (epicId) => frameByEpicId.get(epicId).memberIds.filter((m) => containerOf.get(m) === epicId);

  function liftEdgesToLevel(levelContainer) {
    const out = [];
    const seen = new Set();
    depEdges.forEach((e) => {
      const lf = liftToLevel(e.from, levelContainer, containerOf);
      const lt = liftToLevel(e.to, levelContainer, containerOf);
      if (lf == null || lt == null || lf === lt) return; // outside this subtree, or internal to one unit
      const key = `${lf}->${lt}`;
      if (seen.has(key)) return; // several original edges can collapse onto the same lifted pair
      seen.add(key);
      out.push({ from: lf, to: lt });
    });
    return out;
  }

  const frameBoxCache = new Map();
  function boxSizeOf(id) {
    return frameByEpicId.has(id) ? computeFrame(id).outer : { w: sizes.nodeW, h: sizes.nodeH };
  }
  function computeFrame(epicId) {
    if (frameBoxCache.has(epicId)) return frameBoxCache.get(epicId);
    const members = effectiveMembers(epicId);
    const innerMaxWidth = Math.max(sizes.nodeW, maxWidth - sizes.pad * 2);
    const level = layoutLevel(members, liftEdgesToLevel(epicId), boxSizeOf, sizes, innerMaxWidth);
    const outer = { w: level.width + sizes.pad * 2, h: sizes.titleH + level.height + sizes.pad * 2 };
    const result = { outer, contentOffsetX: sizes.pad, contentOffsetY: sizes.titleH + sizes.pad, placements: level.placements };
    frameBoxCache.set(epicId, result);
    return result;
  }

  const topUnitIds = ids.filter((id) => !containerOf.has(id));
  const top = layoutLevel(topUnitIds, liftEdgesToLevel(null), boxSizeOf, sizes, maxWidth);

  const abs = new Map(); // id -> {x, y} top-left, absolute
  function place(id, originX, originY) {
    abs.set(id, { x: originX, y: originY });
    if (frameByEpicId.has(id)) {
      const box = computeFrame(id);
      effectiveMembers(id).forEach((m) => {
        const p = box.placements.get(m);
        place(m, originX + box.contentOffsetX + p.x, originY + box.contentOffsetY + p.y);
      });
    }
  }
  topUnitIds.forEach((id) => {
    const p = top.placements.get(id);
    place(id, sizes.pad + p.x, sizes.pad + p.y);
  });

  const nodes = [];
  const frameOut = [];
  ids.forEach((id) => {
    const pos = abs.get(id);
    if (!pos) return; // defensive: every participant is either top-level or nested somewhere
    if (frameByEpicId.has(id)) {
      const box = computeFrame(id).outer;
      frameOut.push({ epicId: id, x: pos.x, y: pos.y, w: box.w, h: box.h, titleH: sizes.titleH });
    } else {
      nodes.push({ id, x: pos.x, y: pos.y, w: sizes.nodeW, h: sizes.nodeH });
    }
  });

  const boxOf = (id) => {
    const pos = abs.get(id);
    if (!pos) return null;
    const size = frameByEpicId.has(id) ? computeFrame(id).outer : { w: sizes.nodeW, h: sizes.nodeH };
    return { x: pos.x, y: pos.y, w: size.w, h: size.h };
  };
  // Endpoint resolution needs no frame/card branch at the anchor itself — a
  // frame's box IS its title-bar-to-bottom rect, so "bottom-center leaving,
  // top-center arriving" is the exact same formula buildMapSvg already uses
  // per plain node; only WHICH box (card vs frame) differs, via boxOf above.
  const drawnEdges = [];
  depEdges.forEach((e) => {
    const fromBox = boxOf(e.from);
    const toBox = boxOf(e.to);
    if (!fromBox || !toBox) return; // defensive: never let a lookup miss crash the render
    drawnEdges.push(Object.assign({}, e, {
      x1: fromBox.x + fromBox.w / 2, y1: fromBox.y + fromBox.h,
      x2: toBox.x + toBox.w / 2, y2: toBox.y,
      back: toBox.y <= fromBox.y,
    }));
  });

  return {
    width: sizes.pad * 2 + top.width,
    height: sizes.pad * 2 + top.height,
    nodes, frames: frameOut, edges: drawnEdges,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { layoutMap };
} else {
  window.layoutMap = layoutMap;
}
