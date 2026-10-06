'use strict';
// Pure model + layouts for the graph view: which cards are drawn, how they
// relate (parent / wait relations), and where each one sits under three
// layouts (tiers, status, force). No DOM, no canvas, no clock, no randomness:
// the same cards always give the same positions, so the 5-second poll re-render
// can reuse them. Same dual-environment pattern as gantt-model.js: unit-testable
// from node --test AND loaded as a plain <script> in the browser (app.js calls
// these as bare globals).
//
// Sibling modules are reached through namespace objects rather than top-level
// destructured consts: every web/*.js shares ONE browser global scope, so a
// second top-level binding of a name another script owns kills the later file.
const GRAPH_NEST = (typeof module !== 'undefined' && module.exports)
  ? require('./nesting')
  : window;
const GRAPH_WB = (typeof module !== 'undefined' && module.exports)
  ? require('./waiting-blocked')
  : window;
const GRAPH_COLS = (typeof module !== 'undefined' && module.exports)
  ? require('./column-state')
  : window;

const GRAPH_LAYOUTS = ['tiers', 'force', 'status'];

function mergeGraphLayout(saved) {
  return GRAPH_LAYOUTS.includes(saved) ? saved : 'tiers';
}

// --- model ---------------------------------------------------------------------
// cards is the whole pool (active + archived). visibleIds narrows what is
// DRAWN; waits still resolve against the full pool so a card waiting on a
// hidden card still reads waiting. A parent link exists only when the parent is
// a drawn card on this board; otherwise the card is a root of the drawn trees.
// Nodes come back in outline order (parents before children, siblings by
// rank): that is the view's DOM order and defines shift-click range selection.

function graphBuild(cards, opts) {
  const ctx = (opts && opts.ctx) || null;
  const visibleIds = (opts && opts.visibleIds) || null;
  const pool = new Map();
  for (const c of cards || []) if (!pool.has(c.id)) pool.set(c.id, c);
  const drawn = new Map();
  for (const c of pool.values()) if (!visibleIds || visibleIds.has(c.id)) drawn.set(c.id, c);

  const parentOf = new Map();
  for (const c of drawn.values()) {
    const pid = GRAPH_NEST.localParentId(c, ctx);
    if (pid !== null && drawn.has(pid)) parentOf.set(c.id, pid);
  }

  // Each card has at most one parent, so a loop is a cycle of a functional
  // graph: the member with the smallest id becomes the root.
  const state = new Map();
  for (const id of [...drawn.keys()].sort((a, b) => a - b)) {
    if (state.has(id)) continue;
    const path = [];
    let cur = id;
    while (cur !== undefined && !state.has(cur)) {
      state.set(cur, 1);
      path.push(cur);
      cur = parentOf.get(cur);
    }
    if (cur !== undefined && state.get(cur) === 1) {
      const loop = path.slice(path.indexOf(cur));
      parentOf.delete(Math.min(...loop));
    }
    for (const p of path) state.set(p, 2);
  }

  const shaped = [...drawn.values()].map((c) => ({
    ...c, parent: parentOf.has(c.id) ? parentOf.get(c.id) : null,
  }));
  const order = GRAPH_NEST.outlineOrder(shaped, ctx).ids;

  const links = [];
  const seen = new Set();
  const addLink = (from, to, kind) => {
    const key = `${from}>${to}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ from, to, kind });
  };
  const nodes = [];
  const byId = new Map();
  for (const id of order) {
    const card = drawn.get(id);
    const parentId = parentOf.has(id) ? parentOf.get(id) : null;
    const parent = parentId === null ? null : byId.get(parentId);
    const waits = (card.waiting_for || []).map(Number);
    const node = {
      id,
      card,
      status: card.status,
      archived: !!card.archived,
      blocked: GRAPH_WB.isBlockedValue(card.blocked),
      review: GRAPH_WB.isReviewValue(card.review),
      waiting: GRAPH_WB.unresolvedWaits(card.waiting_for, pool).length > 0,
      deg: 0,
      kids: 0,
      depth: parent ? parent.depth + 1 : 0,
      rootId: parent ? parent.rootId : id,
      parentId,
    };
    nodes.push(node);
    byId.set(id, node);
    if (parentId !== null) addLink(parentId, id, 'parent');
    for (const w of waits) if (w !== id && drawn.has(w)) addLink(id, w, 'wait');
  }
  for (const l of links) {
    byId.get(l.from).deg++;
    byId.get(l.to).deg++;
    if (l.kind === 'parent') byId.get(l.from).kids++;
  }
  return { nodes, links, byId };
}

function graphRadius(node) {
  return 4 + Math.sqrt(node.deg + (node.kids ? 2 : 0)) * 3;
}

function graphNeighbours(model, id) {
  const out = new Set([id]);
  for (const l of model.links) {
    if (l.from === id) out.add(l.to);
    if (l.to === id) out.add(l.from);
  }
  return out;
}

// --- layout plumbing -----------------------------------------------------------

function graphFinish(model, pos, rings, spokes, titles) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (ax, ay, bx, by) => {
    x0 = Math.min(x0, ax); y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx); y1 = Math.max(y1, by);
  };
  for (const n of model.nodes) {
    const p = pos.get(n.id);
    const r = graphRadius(n);
    grow(p.x - r, p.y - r, p.x + r, p.y + r);
  }
  for (const r of rings) grow(r.cx - r.r, -r.r, r.cx + r.r, r.r);
  for (const t of titles) grow(t.x, t.y - 16, t.x + 80, t.y + 4);
  const bounds = Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
  return { pos, rings, spokes, titles, bounds };
}

// --- layout: tiers -------------------------------------------------------------

const GRAPH_TIER_BASE = 90;
const GRAPH_TIER_STEP = 85;
const GRAPH_TIER_LEAF_ARC = 18;
const GRAPH_TIER_LOOSE_ARC = 9;

function graphLayoutTiers(model) {
  const { nodes } = model;
  const kidsOf = new Map();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    if (!kidsOf.has(n.parentId)) kidsOf.set(n.parentId, []);
    kidsOf.get(n.parentId).push(n.id);
  }
  const leaves = new Map();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const list = kidsOf.get(nodes[i].id);
    leaves.set(nodes[i].id, list ? list.reduce((s, k) => s + leaves.get(k), 0) : 1);
  }
  const roots = nodes.filter((n) => n.parentId === null);
  const trees = roots.filter((n) => n.kids > 0);
  const unnested = roots.filter((n) => n.kids === 0);
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const totalLeaves = trees.reduce((s, t) => s + leaves.get(t.id), 0) || 1;

  let share = 0;
  if (!trees.length) share = 1;
  else if (unnested.length) share = Math.max(0.15, Math.min(0.5, unnested.length / nodes.length));

  // A ring holding a leaf must be wide enough that the angle one leaf gets
  // still spaces neighbouring dots apart; inner rings only keep the fixed step.
  const leafAngle = Math.PI * 2 * (1 - share) / totalLeaves;
  const leafDepth = new Array(maxDepth + 1).fill(false);
  for (const n of nodes) if (!kidsOf.has(n.id) && (n.parentId !== null || n.kids > 0)) leafDepth[n.depth] = true;
  const ringR = [GRAPH_TIER_BASE];
  for (let d = 1; d <= maxDepth; d++) {
    ringR.push(Math.max(ringR[d - 1] + GRAPH_TIER_STEP, leafDepth[d] && leafAngle > 0 ? GRAPH_TIER_LEAF_ARC / leafAngle : 0));
  }
  if (leafDepth[0] && leafAngle > 0) ringR[0] = Math.max(ringR[0], GRAPH_TIER_LEAF_ARC / leafAngle);

  const pos = new Map();
  const spokes = [];
  const stack = [];
  const place = (rootId, rootA0, rootA1) => {
    stack.push([rootId, rootA0, rootA1]);
    while (stack.length) {
      const [id, a0, a1] = stack.pop();
      const n = model.byId.get(id);
      const ang = (a0 + a1) / 2;
      const rad = ringR[n.depth];
      pos.set(id, { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
      const list = kidsOf.get(id);
      if (!list) continue;
      let s = a0;
      for (const k of list) {
        const w = (a1 - a0) * leaves.get(k) / leaves.get(id);
        stack.push([k, s, s + w]);
        s += w;
      }
    }
  };
  let a = -Math.PI / 2;
  for (const t of trees) {
    const w = Math.PI * 2 * (1 - share) * leaves.get(t.id) / totalLeaves;
    spokes.push({ angle: a, r1: 0 });
    place(t.id, a, a + w);
    a += w;
  }
  const sector = Math.PI * 2 * share;
  const outer = Math.max(
    ringR[maxDepth] + GRAPH_TIER_STEP,
    unnested.length ? unnested.length * GRAPH_TIER_LOOSE_ARC / sector : 0,
  );
  unnested.forEach((n, i) => {
    const ang = a + sector * (i + 0.5) / unnested.length;
    const rad = outer + (i % 2 ? 24 : 0);
    pos.set(n.id, { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
  });

  const rings = [];
  if (trees.length) {
    for (let d = 0; d <= maxDepth; d++) {
      rings.push({ cx: 0, r: ringR[d], label: d === 0 ? 'roots' : `depth ${d}` });
    }
  }
  if (unnested.length) rings.push({ cx: 0, r: outer, label: 'unnested' });
  const reach = rings.length ? rings[rings.length - 1].r + 30 : 0;
  for (const s of spokes) s.r1 = reach;
  return graphFinish(model, pos, rings, spokes.length > 1 ? spokes : [], []);
}

// --- layout: status ------------------------------------------------------------
// Rings run inside out in REVERSE column order (done innermost, backlog
// outermost). A ring is a set of tracks: when its cards fit the first track
// with room to spare they spread around the full circle, otherwise a full track
// spills to the next one out.

const GRAPH_STATUS_START = 48;
const GRAPH_STATUS_GAP = 34;
const GRAPH_CLUMP_SEP = 90;
const GRAPH_TRACK_TWIST = 0.35;

function graphLayoutStatus(model, opts) {
  const statuses = GRAPH_COLS.liveStatuses(opts && opts.statuses);
  const order = statuses.slice().reverse();
  const ringOf = (n) => GRAPH_COLS.columnForStatus(n.status, statuses);
  const live = model.nodes.filter((n) => !n.archived);
  const archived = model.nodes.filter((n) => n.archived);
  const groups = [{ title: 'live', nodes: live }];
  if (archived.length) groups.push({ title: 'archive', nodes: archived });

  for (const g of groups) {
    g.rings = [];
    g.local = new Map();
    let r = GRAPH_STATUS_START;
    for (const s of order) {
      const ns = g.nodes.filter((n) => ringOf(n) === s)
        .sort((p, q) => p.rootId - q.rootId || p.id - q.id);
      const th = ns.length ? Math.max(...ns.map((n) => 2 * graphRadius(n))) + 6 : 0;
      const circ = Math.PI * 2 * r;
      const widths = ns.map((n) => 2 * graphRadius(n) + 4);
      const sum = widths.reduce((x, y) => x + y, 0);
      const spread = ns.length && sum <= circ * 0.98 ? (circ - sum) / ns.length : 0;
      let track = r;
      let used = 0;
      let ti = 0;
      ns.forEach((n, i) => {
        const w = widths[i];
        if (!spread && used > 0 && used + w > Math.PI * 2 * track) {
          track += th;
          used = 0;
          ti++;
        }
        const ang = -Math.PI / 2 + (used + w / 2 + spread * (i + 0.5)) / track + ti * GRAPH_TRACK_TWIST;
        used += w;
        g.local.set(n.id, { x: Math.cos(ang) * track, y: Math.sin(ang) * track });
      });
      g.rings.push({ r, status: s, count: ns.length });
      r = (ns.length ? track + th / 2 : r) + GRAPH_STATUS_GAP;
    }
    g.R = r;
  }

  const total = groups.reduce((s, g) => s + 2 * g.R, 0) + GRAPH_CLUMP_SEP * (groups.length - 1);
  let x = -total / 2;
  const pos = new Map();
  const rings = [];
  const titles = [];
  for (const g of groups) {
    const cx = x + g.R;
    x += 2 * g.R + GRAPH_CLUMP_SEP;
    for (const [id, p] of g.local) pos.set(id, { x: cx + p.x, y: p.y });
    for (const rg of g.rings) {
      rings.push({ cx, r: rg.r, label: `${rg.status} (${rg.count})`, status: rg.status, count: rg.count });
    }
    if (groups.length > 1) titles.push({ x: cx - 24, y: -g.R - 14, text: g.title });
  }
  return graphFinish(model, pos, rings, [], titles);
}

// --- layout: force -------------------------------------------------------------

const GRAPH_GOLDEN = 2.399963229728653;

function graphLayoutForce(model) {
  const sim = model.nodes.filter((n) => n.deg > 0).sort((a, b) => a.id - b.id);
  const loose = model.nodes.filter((n) => n.deg === 0).sort((a, b) => a.id - b.id);
  const n = sim.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const at = new Map();
  sim.forEach((node, i) => {
    at.set(node.id, i);
    px[i] = Math.cos(i * GRAPH_GOLDEN) * 12 * Math.sqrt(i);
    py[i] = Math.sin(i * GRAPH_GOLDEN) * 12 * Math.sqrt(i);
  });
  const springs = model.links.map((l) => ({ a: at.get(l.from), b: at.get(l.to), want: l.kind === 'parent' ? 55 : 90 }));
  const iterations = n <= 150 ? 300 : n <= 400 ? 150 : n <= 1000 ? 80 : n <= 2000 ? 40 : 20;
  let alpha = 1;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = px[j] - px[i];
        let dy = py[j] - py[i];
        const d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 90000) continue;
        const f = 1800 / d2 * alpha;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        vx[i] -= dx * f; vy[i] -= dy * f;
        vx[j] += dx * f; vy[j] += dy * f;
      }
    }
    for (const s of springs) {
      const dx = px[s.b] - px[s.a];
      const dy = py[s.b] - py[s.a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - s.want) * 0.04 * alpha;
      vx[s.a] += dx / d * f; vy[s.a] += dy / d * f;
      vx[s.b] -= dx / d * f; vy[s.b] -= dy / d * f;
    }
    for (let i = 0; i < n; i++) {
      vx[i] -= px[i] * 0.004 * alpha;
      vy[i] -= py[i] * 0.004 * alpha;
      vx[i] *= 0.6; vy[i] *= 0.6;
      px[i] += vx[i]; py[i] += vy[i];
    }
    alpha *= 0.985;
  }
  const pos = new Map();
  let far = 0;
  sim.forEach((node, i) => {
    pos.set(node.id, { x: px[i], y: py[i] });
    far = Math.max(far, Math.hypot(px[i], py[i]) + graphRadius(node));
  });
  const many = loose.length > 16;
  let base = far + 60;
  if (many) base = Math.max(base, loose.length * 1.6);
  loose.forEach((node, i) => {
    const ang = -Math.PI / 2 + Math.PI * 2 * (i + 0.5) / loose.length;
    const rad = base + (many && i % 2 ? 24 : 0);
    pos.set(node.id, { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
  });
  return graphFinish(model, pos, [], [], []);
}

// --- dispatcher + memo ---------------------------------------------------------
// Keyed by what decides positions: node ids, statuses, archived flags, links,
// kind and the statuses list. Not blocked/review, which only change colour.

const GRAPH_CACHE_MAX = 8;
const graphCache = new Map();

function graphSignature(model, kind, opts) {
  const nodes = model.nodes.map((n) => `${n.id}:${n.status}:${n.archived ? 1 : 0}`).join(',');
  const links = model.links.map((l) => `${l.from}>${l.to}${l.kind === 'wait' ? 'w' : 'p'}`).join(',');
  const statuses = ((opts && opts.statuses) || []).join(',');
  return [kind, statuses, nodes, links].join('|');
}

function graphLayoutCacheClear() {
  graphCache.clear();
}

function graphLayout(model, kind, opts) {
  const which = mergeGraphLayout(kind);
  const key = graphSignature(model, which, opts);
  if (graphCache.has(key)) return graphCache.get(key);
  const layout = which === 'status' ? graphLayoutStatus(model, opts)
    : which === 'force' ? graphLayoutForce(model)
      : graphLayoutTiers(model);
  graphCache.set(key, layout);
  if (graphCache.size > GRAPH_CACHE_MAX) graphCache.delete(graphCache.keys().next().value);
  return layout;
}

// --- view fit ------------------------------------------------------------------
// screen = world * k + {x, y}; bounds centred, scale capped at maxK.

function graphFit(bounds, width, height, pad = 60, maxK = 2.5) {
  const w = Math.max(1, bounds.x1 - bounds.x0);
  const h = Math.max(1, bounds.y1 - bounds.y0);
  let k = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h, maxK);
  if (!Number.isFinite(k) || k <= 0) k = 0.01;
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  return { x: width / 2 - cx * k, y: height / 2 - cy * k, k };
}

// --- visible ids + zoom --------------------------------------------------------
// The status pills and the search compose by intersection, like every other
// view. null means "draw everything".

function graphVisibleIds(pool, searchIds, filter, statuses) {
  const statusIds = GRAPH_COLS.mapFilterVisibleIds(pool, filter, statuses);
  return GRAPH_COLS.intersectVisibleIds(searchIds || null, statusIds);
}

function graphZoomAt(view, px, py, factor, min = 0.1, max = 8) {
  const k = Math.min(max, Math.max(min, view.k * factor));
  const s = k / view.k;
  return { x: px - (px - view.x) * s, y: py - (py - view.y) * s, k };
}

// --- render plan ---------------------------------------------------------------
// Plain data the view turns into SVG: no DOM here. Nodes keep model order
// (outline order), which is the DOM order and so the shift-click range order.

const graphRound = (v) => Math.round(v * 100) / 100;

function graphPlan(model, layout, opts) {
  const o = opts || {};
  const selected = o.selectedIds || new Set();
  const statusClass = o.statusClass || ((s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const titleOf = o.titleOf || ((c) => c.title || '');
  const curved = layout.rings.length > 0 || layout.spokes.length > 0;
  const kind = o.kind || (layout.rings.some((r) => r.status !== undefined) ? 'status' : curved ? 'tiers' : 'force');
  const centres = [];
  if (kind === 'status') for (const r of layout.rings) if (!centres.includes(r.cx)) centres.push(r.cx);
  if (!centres.length) centres.push(0);
  // Status layout: live cards sit in the first clump, archived ones in the second.
  const clumpOf = (n) => (kind === 'status' && n.archived && centres.length > 1 ? 1 : 0);

  const nodes = model.nodes.map((n) => {
    const p = layout.pos.get(n.id);
    const cls = ['graph-node', 'card-el', `status-${statusClass(n.status)}`];
    if (selected.has(n.id)) cls.push('selected');
    if (o.hoveredId != null && o.hoveredId === n.id) cls.push('hover-highlight');
    if (n.archived) cls.push('archived');
    if (n.status === 'done') cls.push('is-done');
    if (n.kids > 0) cls.push('has-kids');
    if (n.blocked) cls.push('is-blocked');
    if (n.waiting) cls.push('is-waiting');
    if (n.review) cls.push('is-review');
    if (n.deg >= 3) cls.push('graph-hub');
    return {
      id: n.id,
      x: graphRound(p.x),
      y: graphRound(p.y),
      r: graphRadius(n),
      cls: cls.join(' '),
      title: `#${n.id} ${titleOf(n.card)} (${n.status}${n.archived ? ', archived' : ''})`,
    };
  });

  const links = model.links.map((l) => {
    const a = model.byId.get(l.from);
    const b = model.byId.get(l.to);
    const pa = layout.pos.get(l.from);
    const pb = layout.pos.get(l.to);
    const cross = kind === 'status' && clumpOf(a) !== clumpOf(b);
    const cls = `graph-link graph-link-${l.kind}${cross ? ' graph-link-cross' : ''}`;
    const head = `M${graphRound(pa.x)} ${graphRound(pa.y)}`;
    if (l.kind === 'wait') {
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy) || 1;
      const trim = graphRadius(b) + 2;
      const ex = graphRound(pb.x - (dx / dist) * trim);
      const ey = graphRound(pb.y - (dy / dist) * trim);
      return { from: l.from, to: l.to, kind: l.kind, d: `${head}L${ex} ${ey}`, cls, arrow: true };
    }
    let d = `${head}L${graphRound(pb.x)} ${graphRound(pb.y)}`;
    if (curved) {
      const qx = graphRound((pa.x + pb.x) / 2 * 0.8 + centres[clumpOf(b)] * 0.2);
      const qy = graphRound((pa.y + pb.y) / 2 * 0.8);
      d = `${head}Q${qx} ${qy} ${graphRound(pb.x)} ${graphRound(pb.y)}`;
    }
    return { from: l.from, to: l.to, kind: l.kind, d, cls, arrow: false };
  });

  const rings = layout.rings.map((r) => ({ cx: graphRound(r.cx), r: graphRound(r.r), label: r.label, cls: 'graph-ring' }));
  const spokes = layout.spokes.map((s) => ({
    x1: 0,
    y1: 0,
    x2: graphRound(Math.cos(s.angle - 0.02) * s.r1),
    y2: graphRound(Math.sin(s.angle - 0.02) * s.r1),
  }));
  const titles = layout.titles.map((t) => ({ x: graphRound(t.x), y: graphRound(t.y), text: t.text }));
  return { nodes, links, rings, spokes, titles };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GRAPH_LAYOUTS, mergeGraphLayout,
    graphBuild, graphRadius, graphNeighbours,
    graphLayoutTiers, graphLayoutStatus, graphLayoutForce,
    graphLayout, graphSignature, graphLayoutCacheClear, graphFit,
    graphVisibleIds, graphZoomAt, graphPlan,
  };
} else {
  window.GRAPH_LAYOUTS = GRAPH_LAYOUTS;
  window.mergeGraphLayout = mergeGraphLayout;
  window.graphBuild = graphBuild;
  window.graphRadius = graphRadius;
  window.graphNeighbours = graphNeighbours;
  window.graphLayoutTiers = graphLayoutTiers;
  window.graphLayoutStatus = graphLayoutStatus;
  window.graphLayoutForce = graphLayoutForce;
  window.graphLayout = graphLayout;
  window.graphSignature = graphSignature;
  window.graphLayoutCacheClear = graphLayoutCacheClear;
  window.graphFit = graphFit;
  window.graphVisibleIds = graphVisibleIds;
  window.graphZoomAt = graphZoomAt;
  window.graphPlan = graphPlan;
}
