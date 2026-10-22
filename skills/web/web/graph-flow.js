'use strict';
// Pure layout of the Graph's Flow: the drawn cards laid out by their dependencies (waiting_for), left
// to right, one column for each step of a plan. No DOM, no clock, no randomness: the same model and
// switch always give the same places. Same dual-environment pattern as graph-model.js: required by
// node --test and loaded as a plain <script> in the browser, where it shares one global scope with
// every other web/*.js, so every top-level name here is GRAPH_FLOW- or graphFlow-prefixed. It reads
// the Graph model (graph-model.js, graphBuild) and returns places; graph-model.js finishes the layout
// (bounds) and draws the plan, so nothing here needs graph-model.js and the two load in either order.
//
// The Dependencies switch decides the columns:
//   frontier  the steps until a card is ready, counting only the dependencies that are not done:
//             `done` (faded, first), `ready now`, `1 step`, `2 steps` ..., and `loop` for a card in
//             or behind a dependency loop. A dependency that is done is no step, so the cards it
//             was holding up are ready now.
//   all       the longest chain of dependencies behind a card, done ones included: `waits for
//             nothing`, `chain 1`, `chain 2` ... A loop shares one column.
// A card with no dependency either way (it waits for none and none waits for it, among the drawn
// cards) is in no column: the cards that are sit in a strip below the columns, with a count. Within a
// column the cards are ordered to cut the arrows that cross, ties by id. The arrows run from the
// card waited for to the card that waits; there are no parent lines. A dependency loop is cut into
// its strongly connected parts first (Tarjan, iterative, so a long chain costs no stack), so it
// never hangs the drawing.
//
// The cards are placed in lanes. Today there is one lane without a header, which holds every card
// with a dependency; a lane is { key, header, ids, y, h } and each lane has its own rows, while the
// columns stand across all of them.

const GRAPH_FLOW_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

const GRAPH_FLOW_GRAPHS = ['hierarchy', 'flow'];
const GRAPH_FLOW_DEPS = ['frontier', 'all'];
const GRAPH_FLOW_GEO = Object.freeze({
  PITCH: 32, SUBW: 40, COLGAP: 90, ROWS: 14, HEAD: 54, LANE_PAD: 14, STRIP_GAP: 56, STRIP_HEAD: 30, STRIP_PITCH: 34, STRIP_MIN: 600, ARC: 48,
});

// --- the choices and the address ---------------------------------------------------

function mergeGraphFlowDeps(saved) {
  return GRAPH_FLOW_DEPS.includes(saved) ? saved : 'frontier';
}

// What a link's query string says of the Graph: `graph=hierarchy|flow` and `deps=frontier|all`,
// each null when absent or not one of those.
function graphFlowLink(search) {
  let params;
  try { params = new URLSearchParams(search || ''); } catch (e) { params = new URLSearchParams(''); }
  const graph = params.get('graph');
  const deps = params.get('deps');
  return {
    graph: GRAPH_FLOW_GRAPHS.includes(graph) ? graph : null,
    deps: GRAPH_FLOW_DEPS.includes(deps) ? deps : null,
  };
}

// What the address should become once the Graph shows `graph` (with `deps` while it is the Flow):
// every other parameter stays as it was, and `deps` goes with the Flow. The search string to
// replace the entry with (leading "?", or "" when nothing is left), or null when the address
// already says it.
function graphFlowAddress(search, graph, deps) {
  const params = new URLSearchParams(search || '');
  const want = GRAPH_FLOW_GRAPHS.includes(graph) ? graph : 'hierarchy';
  let changed = false;
  if (params.get('graph') !== want) { params.set('graph', want); changed = true; }
  if (want === 'flow') {
    const d = mergeGraphFlowDeps(deps);
    if (params.get('deps') !== d) { params.set('deps', d); changed = true; }
  } else if (params.has('deps')) {
    params.delete('deps');
    changed = true;
  }
  if (!changed) return null;
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// --- the dependency graph of the drawn cards -----------------------------------------

function graphFlowGraph(model) {
  const ids = model.nodes.map((n) => n.id);
  const preds = new Map(ids.map((id) => [id, []]));
  const succs = new Map(ids.map((id) => [id, []]));
  for (const l of model.links) {
    if (l.kind !== 'wait' || l.from === l.to || !preds.has(l.to) || !succs.has(l.from)) continue;
    preds.get(l.to).push(l.from);
    succs.get(l.from).push(l.to);
  }
  const linked = new Set(ids.filter((id) => preds.get(id).length || succs.get(id).length));
  return { ids, preds, succs, linked };
}

// The strongly connected parts of the graph `succs` describes over `ids`. They come out
// successors first: a part is listed after every part it leads to. A part of one card is not a loop.
function graphFlowComponents(ids, succs) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const comp = new Map();
  const comps = [];
  const open = (v) => { index.set(v, counter); low.set(v, counter); counter++; stack.push(v); onStack.add(v); };
  for (const root of ids) {
    if (index.has(root)) continue;
    open(root);
    const work = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const v = frame[0];
      const out = succs.get(v);
      if (frame[1] < out.length) {
        const w = out[frame[1]++];
        if (!index.has(w)) { open(w); work.push([w, 0]); } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(v)));
        }
        if (low.get(v) === index.get(v)) {
          const members = [];
          let w;
          do { w = stack.pop(); onStack.delete(w); comp.set(w, comps.length); members.push(w); } while (w !== v);
          comps.push(members);
        }
      }
    }
  }
  return { comp, comps };
}

// All: a card's column is the length of the longest chain of waits behind it, the members of a loop
// sharing one column.
function graphFlowChains(g) {
  const { comp, comps } = graphFlowComponents(g.ids, g.succs);
  const colOfComp = new Array(comps.length).fill(0);
  for (let c = comps.length - 1; c >= 0; c--) {
    for (const id of comps[c]) {
      for (const p of g.preds.get(id)) {
        const pc = comp.get(p);
        if (pc !== c) colOfComp[c] = Math.max(colOfComp[c], colOfComp[pc] + 1);
      }
    }
  }
  const chain = new Map();
  for (const id of g.ids) chain.set(id, colOfComp[comp.get(id)]);
  return chain;
}

// Frontier: only the dependencies of a card that are not done count, so the graph is cut to the
// cards not done before anything is read from it. The steps are the longest chain of those; a
// loop, and whatever waits behind one, never gets a step and is `loop`.
function graphFlowFrontier(g, doneOf) {
  const open = g.ids.filter((id) => g.linked.has(id) && !doneOf(id));
  const openSet = new Set(open);
  const succs = new Map(open.map((id) => [id, g.succs.get(id).filter((s) => openSet.has(s))]));
  const preds = new Map(open.map((id) => [id, g.preds.get(id).filter((p) => openSet.has(p))]));
  const { comps } = graphFlowComponents(open, succs);
  const step = new Map();
  const loop = new Set();
  for (let c = comps.length - 1; c >= 0; c--) {
    const members = comps[c];
    if (members.length > 1) { members.forEach((id) => loop.add(id)); continue; }
    const id = members[0];
    let s = 0;
    let stuck = false;
    for (const p of preds.get(id)) {
      if (loop.has(p)) stuck = true;
      else s = Math.max(s, step.get(p) + 1);
    }
    if (stuck) loop.add(id);
    else step.set(id, s);
  }
  return { step, loop };
}

// --- the order within a column ---------------------------------------------------------

// Each cell (one column of one lane) is ordered by the mean place of the cards it waits for and the
// cards that wait for it, two sweeps each way, so the arrows cross less. A card's place is its lane
// plus its rank in its cell, as a fraction of the cell; a card with nothing outside its cell to
// lean on keeps its place; ties go by id.
function graphFlowOrder(cells, g) {
  const place = new Map();
  const seat = () => {
    for (const cell of cells) cell.ids.forEach((id, i) => place.set(id, cell.lane + (i + 0.5) / cell.ids.length));
  };
  const sweep = (list, near) => {
    for (const cell of list) {
      const key = new Map(cell.ids.map((id) => {
        const there = near.get(id).filter((o) => !cell.set.has(o) && place.has(o)).map((o) => place.get(o));
        return [id, there.length ? there.reduce((a, b) => a + b, 0) / there.length : place.get(id)];
      }));
      cell.ids.sort((a, b) => key.get(a) - key.get(b) || GRAPH_FLOW_IDS.compareIds(a, b));
    }
    seat();
  };
  for (const cell of cells) { cell.ids.sort(GRAPH_FLOW_IDS.compareIds); cell.set = new Set(cell.ids); }
  seat();
  const byCol = [...cells].sort((a, b) => a.col - b.col);
  for (let pass = 0; pass < 2; pass++) {
    sweep(byCol, g.preds);
    sweep([...byCol].reverse(), g.succs);
  }
}

// --- the layout ------------------------------------------------------------------------

function graphFlowColumns(g, model, deps) {
  const doneOf = (id) => { const n = model.byId.get(id); return n.status === 'done' || n.archived; };
  const mainIds = g.ids.filter((id) => g.linked.has(id));
  const colOf = new Map();
  const specs = [];
  if (deps === 'all') {
    const chain = graphFlowChains(g);
    let max = 0;
    for (const id of mainIds) { colOf.set(id, chain.get(id)); max = Math.max(max, chain.get(id)); }
    if (mainIds.length) for (let c = 0; c <= max; c++) specs.push({ key: c, label: c === 0 ? 'waits for nothing' : `chain ${c}`, faded: false });
  } else {
    const { step, loop } = graphFlowFrontier(g, doneOf);
    const live = mainIds.filter((id) => !doneOf(id));
    const maxStep = Math.max(0, ...live.filter((id) => step.has(id)).map((id) => step.get(id)));
    const keyOf = (id) => (doneOf(id) ? 'done' : loop.has(id) ? 'loop' : step.get(id));
    if (mainIds.some(doneOf)) specs.push({ key: 'done', label: 'done', faded: true });
    if (mainIds.length) {
      specs.push({ key: 0, label: 'ready now', faded: false });
      for (let s = 1; s <= maxStep; s++) specs.push({ key: s, label: s === 1 ? '1 step' : `${s} steps`, faded: false });
    }
    if (live.some((id) => loop.has(id))) specs.push({ key: 'loop', label: 'loop', faded: false });
    const at = new Map(specs.map((s, i) => [s.key, i]));
    for (const id of mainIds) colOf.set(id, at.get(keyOf(id)));
  }
  return { specs, colOf, mainIds };
}

// A cell of `n` cards stands in `sub` side-by-side stacks of at most GRAPH_FLOW_GEO.ROWS rows.
function graphFlowCellShape(n) {
  const sub = Math.max(1, Math.ceil(n / GRAPH_FLOW_GEO.ROWS));
  return { sub, rows: Math.ceil(n / sub) };
}

// The Flow layout of the Graph model: what graph-model.js draws.
//   columns  { index, key, label, faded, count, ids, x, w, y, h } left to right; x and w frame the
//            column, which every lane shares
//   lanes    { key, header, ids, y, h }, top to bottom
//   strip    null, or { ids, count, label, x, y, w, h }: the cards with no dependency either way
//   pos      each card's centre; radius each card's dot, which counts the waits it is in
//   boxes    what the bounds must hold besides the dots
function graphFlowPlace(model, opts) {
  const deps = mergeGraphFlowDeps(opts && opts.deps);
  const F = GRAPH_FLOW_GEO;
  const g = graphFlowGraph(model);
  const { specs, colOf, mainIds } = graphFlowColumns(g, model, deps);
  const looseIds = g.ids.filter((id) => !g.linked.has(id));
  const ncols = specs.length;

  const lanes = mainIds.length ? [{ key: null, header: null, ids: mainIds }] : [];
  const cells = [];
  lanes.forEach((lane, li) => {
    const byCol = new Map();
    for (const id of lane.ids) {
      const c = colOf.get(id);
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c).push(id);
    }
    lane.cells = [...byCol.entries()].map(([col, ids]) => ({ col, lane: li, ids }));
    cells.push(...lane.cells);
  });
  graphFlowOrder(cells, g);

  const colSub = new Array(ncols).fill(1);
  for (const cell of cells) {
    cell.shape = graphFlowCellShape(cell.ids.length);
    colSub[cell.col] = Math.max(colSub[cell.col], cell.shape.sub);
  }
  const colX = [];
  const colW = colSub.map((s) => s * F.SUBW);
  let x = 0;
  for (let c = 0; c < ncols; c++) { colX.push(x); x += colW[c] + F.COLGAP; }
  const mainW = ncols ? x - F.COLGAP : 0;

  const pos = new Map();
  let y = F.HEAD;
  for (const lane of lanes) {
    const rows = Math.max(1, ...lane.cells.map((c) => c.shape.rows));
    lane.y = y;
    lane.h = rows * F.PITCH + F.LANE_PAD;
    for (const cell of lane.cells) {
      const top = y + (rows - cell.shape.rows) * F.PITCH / 2;
      cell.ids.forEach((id, i) => {
        const stack = Math.floor(i / cell.shape.rows);
        const row = i % cell.shape.rows;
        pos.set(id, { x: colX[cell.col] + stack * F.SUBW + F.SUBW / 2, y: top + row * F.PITCH + F.PITCH / 2 });
      });
    }
    y += lane.h;
  }
  const mainBottom = lanes.length ? y : F.HEAD;

  const boxes = [];
  const columns = specs.map((spec, c) => {
    const ids = cells.filter((cell) => cell.col === c).flatMap((cell) => cell.ids);
    const pad = F.COLGAP / 2;
    const col = {
      index: c, ...spec, count: ids.length, ids, x: colX[c] - pad + 6, w: colW[c] + pad * 2 - 12, y: F.HEAD - 14, h: mainBottom - F.HEAD + 14,
    };
    boxes.push({ x0: col.x, y0: col.y - 20, x1: col.x + col.w, y1: col.y + col.h });
    return col;
  });

  let strip = null;
  if (looseIds.length) {
    const top = mainBottom + (lanes.length ? F.STRIP_GAP : 0);
    const left = -F.COLGAP / 2 + 6;
    const span = Math.max(mainW + F.COLGAP - 12, lanes.length ? 0 : F.STRIP_MIN);
    const perRow = Math.max(6, Math.floor((span + F.COLGAP) / F.STRIP_PITCH));
    const rows = Math.ceil(looseIds.length / perRow);
    const w = Math.max(span, Math.min(perRow, looseIds.length) * F.STRIP_PITCH + 20);
    strip = {
      ids: looseIds, count: looseIds.length, label: 'no dependency either way', x: left, y: top, w, h: F.STRIP_HEAD + rows * F.STRIP_PITCH + 8,
    };
    looseIds.forEach((id, i) => {
      pos.set(id, { x: left + 24 + (i % perRow) * F.STRIP_PITCH, y: top + F.STRIP_HEAD + Math.floor(i / perRow) * F.STRIP_PITCH + F.STRIP_PITCH / 2 });
    });
    boxes.push({ x0: strip.x, y0: strip.y, x1: strip.x + strip.w, y1: strip.y + strip.h });
  }

  const waits = new Map();
  for (const l of model.links) if (l.kind === 'wait') { waits.set(l.from, (waits.get(l.from) || 0) + 1); waits.set(l.to, (waits.get(l.to) || 0) + 1); }
  const radius = new Map(g.ids.map((id) => [id, 5 + Math.sqrt(waits.get(id) || 0) * 2.5]));

  return { deps, columns, lanes, strip, pos, radius, boxes };
}

// The arrow from the card waited for to the card that waits: it leaves to the right and arrives from the
// left, to the rim of the dot it points at.
function graphFlowPath(flow, from, to) {
  const a = flow.pos.get(from);
  const b = flow.pos.get(to);
  const stop = flow.radius.get(to) + 3;
  const dx = Math.max(Math.abs(b.x - a.x) * 0.5, GRAPH_FLOW_GEO.ARC);
  const rd = (v) => Math.round(v * 100) / 100;
  return `M${rd(a.x)} ${rd(a.y)}C${rd(a.x + dx)} ${rd(a.y)} ${rd(b.x - dx)} ${rd(b.y)} ${rd(b.x - stop)} ${rd(b.y)}`;
}

// What the view draws behind the dots: a shaded frame and a heading for each column, the strip's frame
// and heading. Plain data, in the Graph's world.
function graphFlowMarks(flow) {
  const rects = [];
  const texts = [];
  flow.columns.forEach((c) => {
    rects.push({ x: c.x, y: c.y, w: c.w, h: c.h, cls: `graph-flow-col${c.index % 2 ? ' graph-flow-col-alt' : ''}${c.faded ? ' graph-flow-faded' : ''}` });
    texts.push({ x: c.x + c.w / 2, y: c.y - 12, anchor: 'middle', text: `${c.label} · ${c.count}`, cls: `graph-flow-colhead${c.faded ? ' graph-flow-faded' : ''}` });
  });
  if (flow.strip) {
    const s = flow.strip;
    rects.push({ x: s.x, y: s.y, w: s.w, h: s.h, cls: 'graph-flow-strip' });
    texts.push({ x: s.x + 10, y: s.y + 19, anchor: 'start', text: `${s.label} · ${s.count} card${s.count === 1 ? '' : 's'}`, cls: 'graph-flow-striphead' });
  }
  return { rects, texts };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GRAPH_FLOW_GRAPHS, GRAPH_FLOW_DEPS, GRAPH_FLOW_GEO,
    mergeGraphFlowDeps, graphFlowLink, graphFlowAddress, graphFlowPlace, graphFlowPath, graphFlowMarks,
  };
} else {
  window.GRAPH_FLOW_GRAPHS = GRAPH_FLOW_GRAPHS;
  window.GRAPH_FLOW_DEPS = GRAPH_FLOW_DEPS;
  window.GRAPH_FLOW_GEO = GRAPH_FLOW_GEO;
  window.mergeGraphFlowDeps = mergeGraphFlowDeps;
  window.graphFlowLink = graphFlowLink;
  window.graphFlowAddress = graphFlowAddress;
  window.graphFlowPlace = graphFlowPlace;
  window.graphFlowPath = graphFlowPath;
  window.graphFlowMarks = graphFlowMarks;
}
