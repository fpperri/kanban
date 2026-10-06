'use strict';
// The Graph view: every card as a dot, joined by its relations. renderGraphView()
// is a full idempotent rebuild (the 5s poll, every search keystroke and every
// selection change re-run it), so pan/zoom and the per-board choices live in the
// module variables below, never in the DOM. Plain <script> sharing one global
// scope with app.js, so every top-level name here is graph-prefixed. Clicks,
// selection and the context menu on a node are NOT wired here: ADR 0006's
// document-level delegated grammar drives any .card-el[data-id].

const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPH_PAN_THRESHOLD = 4;
const GRAPH_ZOOM_STEP = 1.12;
const GRAPH_BUTTON_ZOOM = 1.25;
const GRAPH_LABELS_ALL_K = 1.4;
const GRAPH_LABELS_ALL_MAX_NODES = 60;
const GRAPH_LAYOUT_TITLES = {
  tiers: 'Tiers: roots at the centre, each depth on its own ring',
  force: 'Force: related cards pull together, loose cards sit around the edge',
  status: 'Status: one ring per status, done innermost; archive is its own group',
};
const GRAPH_LAYOUT_LABELS = { tiers: 'Tiers', force: 'Force', status: 'Status' };
const GRAPH_KEY = 'solid line: parent, dashed arrow: waits for, red ring: blocked, amber ring: waiting, gold ring: review';

let graphLayoutKind = null;
let graphStatusFilter = null;
const graphViews = new Map();
let graphCur = null;
let graphPan = null;
let graphClickSwallow = null;

function graphLoadLayout() {
  if (graphLayoutKind) return graphLayoutKind;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'graph.layout')); }
  catch (e) { saved = null; }
  graphLayoutKind = mergeGraphLayout(saved);
  return graphLayoutKind;
}

function graphSaveLayout() {
  try { localStorage.setItem(storageKey(state.projectName, 'graph.layout'), graphLayoutKind); }
  catch (e) { /* storage unavailable — the layout choice just won't persist this session */ }
}

function graphLoadFilter() {
  if (graphStatusFilter) return graphStatusFilter;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'graph.statusFilter'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; }
  graphStatusFilter = mergeGanttStatusFilter(saved, boardColumnIds());
  return graphStatusFilter;
}

function graphSaveFilter() {
  try { localStorage.setItem(storageKey(state.projectName, 'graph.statusFilter'), JSON.stringify(graphStatusFilter)); }
  catch (e) { /* storage unavailable — the filter just won't persist this session */ }
}

function graphToggleFilter(col) {
  const filter = graphLoadFilter();
  if (!(col in filter)) return;
  filter[col] = !filter[col];
  graphSaveFilter();
  renderGraphView();
}

function graphSoloFilter(col) {
  const filter = graphLoadFilter();
  Object.assign(filter, soloStatusFilter(filter, boardColumnIds(), col));
  graphSaveFilter();
  renderGraphView();
}

function resetGraphViewState() {
  graphLayoutKind = null;
  graphStatusFilter = null;
  graphViews.clear();
  graphCur = null;
  graphPan = null;
}

// --- DOM helpers ---------------------------------------------------------------

function graphEl(tag, attrs, cls) {
  const el = document.createElementNS(GRAPH_SVG_NS, tag);
  if (cls) el.setAttribute('class', cls);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  return el;
}

function graphButton(cls, text, title, data) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${cls} graph-control`;
  b.textContent = text;
  b.title = title;
  for (const [k, v] of Object.entries(data || {})) b.dataset[k] = v;
  return b;
}

function graphPlural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function graphBuildControls(kind, filter, cardCount, relationCount) {
  const frag = document.createDocumentFragment();
  const row = document.createElement('div');
  row.className = 'graph-controls';
  const layouts = document.createElement('div');
  layouts.className = 'graph-layouts';
  for (const k of GRAPH_LAYOUTS) {
    const b = graphButton('graph-layout-btn', GRAPH_LAYOUT_LABELS[k], GRAPH_LAYOUT_TITLES[k], { layout: k });
    b.setAttribute('aria-pressed', String(k === kind));
    layouts.appendChild(b);
  }
  row.appendChild(layouts);
  const zoom = document.createElement('div');
  zoom.className = 'graph-zoom';
  zoom.appendChild(graphButton('graph-zoom-btn', '−', 'Zoom out', { graphAction: 'out' }));
  zoom.appendChild(graphButton('graph-zoom-btn', '+', 'Zoom in', { graphAction: 'in' }));
  zoom.appendChild(graphButton('graph-zoom-btn', 'Fit', 'Fit every card in the panel', { graphAction: 'fit' }));
  row.appendChild(zoom);
  const count = document.createElement('span');
  count.className = 'graph-count';
  count.textContent = `${graphPlural(cardCount, 'card')}, ${graphPlural(relationCount, 'relation')}`;
  row.appendChild(count);
  frag.appendChild(row);
  frag.appendChild(buildFilterPillRow(filter, boardColumnIds(), 'graph-filter-row', 'graph-filter-toggle graph-control',
    (col, on) => col === 'archive'
      ? `${on ? 'Hide' : 'Show'} archived cards on the graph`
      : `${on ? 'Hide' : 'Show'} ${columnLabel(col)} cards on the graph`));
  const key = document.createElement('p');
  key.className = 'graph-key';
  key.textContent = GRAPH_KEY;
  frag.appendChild(key);
  return frag;
}

// --- transform -----------------------------------------------------------------

function graphApplyTransform() {
  if (!graphCur) return;
  const { svg, world, view, arrow } = graphCur;
  const k = view.k;
  world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${k})`);
  for (const t of svg.querySelectorAll('.graph-node-id')) {
    t.setAttribute('font-size', 11 / k);
    t.setAttribute('stroke-width', 4 / k);
    t.setAttribute('x', Number(t.dataset.r) + 3 / k);
    t.setAttribute('y', 4 / k);
  }
  for (const t of svg.querySelectorAll('.graph-ring-label')) {
    t.setAttribute('font-size', 11 / k);
    t.setAttribute('stroke-width', 4 / k);
    t.setAttribute('x', Number(t.dataset.cx) + 4 / k);
    t.setAttribute('y', -Number(t.dataset.r) - 3 / k);
  }
  for (const t of svg.querySelectorAll('.graph-title')) {
    t.setAttribute('font-size', 15 / k);
    t.setAttribute('stroke-width', 4 / k);
  }
  arrow.setAttribute('markerWidth', 9 / k);
  arrow.setAttribute('markerHeight', 9 / k);
  svg.classList.toggle('graph-labels-all', k >= GRAPH_LABELS_ALL_K || graphCur.nodeCount <= GRAPH_LABELS_ALL_MAX_NODES);
}

function graphFitNow() {
  if (!graphCur) return;
  Object.assign(graphCur.view, graphFit(graphCur.layout.bounds, graphCur.w, graphCur.h), { touched: false });
  graphApplyTransform();
}

function graphZoomBy(factor, px, py) {
  if (!graphCur) return;
  Object.assign(graphCur.view, graphZoomAt(graphCur.view, px, py, factor), { touched: true });
  graphApplyTransform();
}

// --- hover focus ---------------------------------------------------------------

function graphClearFocus() {
  if (!graphCur) return;
  graphCur.svg.classList.remove('graph-dim');
  for (const el of graphCur.svg.querySelectorAll('.graph-near')) el.classList.remove('graph-near');
}

function graphSetFocus(id) {
  graphClearFocus();
  if (!graphCur || id == null || !graphCur.model.byId.has(id)) return;
  const near = graphNeighbours(graphCur.model, id);
  graphCur.svg.classList.add('graph-dim');
  for (const n of near) graphCur.nodeEls.get(n).classList.add('graph-near');
  graphCur.model.links.forEach((l, i) => {
    if (near.has(l.from) && near.has(l.to)) graphCur.linkEls[i].classList.add('graph-near');
  });
}

// --- render --------------------------------------------------------------------

function graphDrawPlan(plan) {
  const stage = document.createElement('div');
  stage.className = 'graph-stage';
  const svg = graphEl('svg', { role: 'group', 'aria-label': 'Card graph' }, 'graph-canvas');
  const defs = graphEl('defs');
  const arrow = graphEl('marker', {
    id: 'graph-arrow-head', viewBox: '0 0 10 10', refX: 10, refY: 5, orient: 'auto', markerUnits: 'userSpaceOnUse',
    markerWidth: 9, markerHeight: 9,
  });
  arrow.appendChild(graphEl('path', { d: 'M0 0L10 5L0 10z' }, 'graph-arrow'));
  defs.appendChild(arrow);
  svg.appendChild(defs);
  const world = graphEl('g', {}, 'graph-world');
  svg.appendChild(world);

  const fixed = (el) => { el.setAttribute('vector-effect', 'non-scaling-stroke'); return el; };
  for (const r of plan.rings) {
    world.appendChild(fixed(graphEl('circle', { cx: r.cx, cy: 0, r: r.r }, r.cls)));
  }
  for (const s of plan.spokes) {
    world.appendChild(fixed(graphEl('line', { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }, 'graph-spoke')));
  }
  const linkEls = plan.links.map((l) => {
    const p = fixed(graphEl('path', { d: l.d }, l.cls));
    if (l.arrow) p.setAttribute('marker-end', 'url(#graph-arrow-head)');
    world.appendChild(p);
    return p;
  });
  const nodeEls = new Map();
  for (const n of plan.nodes) {
    const g = graphEl('g', { transform: `translate(${n.x} ${n.y})`, tabindex: 0 }, n.cls);
    g.setAttribute('data-id', String(n.id));
    const title = graphEl('title');
    title.textContent = n.title;
    g.appendChild(title);
    g.appendChild(fixed(graphEl('circle', { r: n.r }, 'graph-dot')));
    const kids = n.cls.includes(' has-kids');
    const flagged = / is-(blocked|waiting|review)/.test(n.cls);
    if (kids) g.appendChild(fixed(graphEl('circle', { r: n.r + 3 }, 'graph-kids-ring')));
    if (flagged) g.appendChild(fixed(graphEl('circle', { r: n.r + (kids ? 6 : 3) }, 'graph-flag-ring')));
    const label = graphEl('text', {}, 'graph-node-id');
    label.dataset.r = String(n.r);
    label.textContent = String(n.id);
    g.appendChild(label);
    world.appendChild(g);
    nodeEls.set(n.id, g);
  }
  for (const r of plan.rings) {
    const t = graphEl('text', {}, 'graph-ring-label');
    t.dataset.cx = String(r.cx);
    t.dataset.r = String(r.r);
    t.textContent = r.label;
    world.appendChild(t);
  }
  for (const t of plan.titles) {
    const el = graphEl('text', { x: t.x, y: t.y }, 'graph-title');
    el.textContent = t.text;
    world.appendChild(el);
  }
  stage.appendChild(svg);
  return { stage, svg, world, arrow, linkEls, nodeEls };
}

function renderGraphView() {
  const host = document.getElementById('graph-view');
  host.textContent = '';
  graphCur = null;
  const kind = graphLoadLayout();
  const filter = graphLoadFilter();

  const pool = state.active.concat(state.archived);
  const terms = currentSearchTerms();
  const searchIds = terms.length ? new Set(filterCards(pool, terms, nestingCtx()).map((c) => c.id)) : null;
  const visibleIds = graphVisibleIds(pool, searchIds, filter, boardStatuses());
  const model = graphBuild(pool, { ctx: nestingCtx(), visibleIds });
  const layoutOpts = { statuses: boardStatuses() };
  const layout = graphLayout(model, kind, layoutOpts);
  const plan = graphPlan(model, layout, {
    selectedIds, hoveredId, kind, statusClass: statusColorClass, titleOf: (c) => cardTitleDisplay(c).text,
  });

  host.appendChild(graphBuildControls(kind, filter, model.nodes.length, model.links.length));
  if (!plan.nodes.length) {
    const p = document.createElement('p');
    p.className = 'graph-empty';
    p.textContent = 'No cards to show';
    host.appendChild(p);
    return;
  }

  const drawn = graphDrawPlan(plan);
  host.appendChild(drawn.stage);
  const w = drawn.stage.clientWidth || 800;
  const h = drawn.stage.clientHeight || 600;
  const sig = graphSignature(model, kind, layoutOpts);
  let view = graphViews.get(kind);
  const refit = !view || (view.sig !== sig && !view.touched);
  if (!view) {
    view = { x: 0, y: 0, k: 1, sig, touched: false };
    graphViews.set(kind, view);
  }
  view.sig = sig;
  graphCur = {
    model, layout, view, w, h, nodeCount: plan.nodes.length,
    svg: drawn.svg, world: drawn.world, arrow: drawn.arrow, linkEls: drawn.linkEls, nodeEls: drawn.nodeEls,
  };
  if (refit) Object.assign(view, graphFit(layout.bounds, w, h), { touched: false });
  graphApplyTransform();
  if (hoveredId != null) graphSetFocus(hoveredId);
}

// --- wiring --------------------------------------------------------------------

function graphSwallowNextClick() {
  if (graphClickSwallow) document.removeEventListener('click', graphClickSwallow, true);
  const swallow = (e) => {
    document.removeEventListener('click', swallow, true);
    graphClickSwallow = null;
    e.preventDefault();
    e.stopPropagation();
  };
  graphClickSwallow = swallow;
  document.addEventListener('click', swallow, true);
  setTimeout(() => {
    if (graphClickSwallow !== swallow) return;
    document.removeEventListener('click', swallow, true);
    graphClickSwallow = null;
  }, 0);
}

function graphFinishPan() {
  if (!graphPan) return;
  const moved = graphPan.moved;
  if (graphCur) graphCur.svg.classList.remove('graph-panning');
  if (moved) isDragging = false;
  graphPan = null;
  if (moved) graphSwallowNextClick();
}

function wireGraphView(host) {
  host.addEventListener('click', (e) => {
    const pill = e.target.closest('.graph-filter-toggle[data-col]');
    if (pill) { graphToggleFilter(pill.dataset.col); return; }
    const layoutBtn = e.target.closest('.graph-layout-btn[data-layout]');
    if (layoutBtn) {
      graphLayoutKind = mergeGraphLayout(layoutBtn.dataset.layout);
      graphViews.delete(graphLayoutKind);
      graphSaveLayout();
      renderGraphView();
      return;
    }
    const zoomBtn = e.target.closest('.graph-zoom-btn[data-graph-action]');
    if (!zoomBtn || !graphCur) return;
    const action = zoomBtn.dataset.graphAction;
    if (action === 'fit') graphFitNow();
    else graphZoomBy(action === 'in' ? GRAPH_BUTTON_ZOOM : 1 / GRAPH_BUTTON_ZOOM, graphCur.w / 2, graphCur.h / 2);
  });
  host.addEventListener('contextmenu', (e) => {
    if (isDragging) return;
    const pill = e.target.closest('.graph-filter-toggle[data-col]');
    if (!pill) return;
    e.preventDefault();
    graphSoloFilter(pill.dataset.col);
  });
  host.addEventListener('wheel', (e) => {
    if (!graphCur || !e.target.closest('.graph-stage')) return;
    e.preventDefault();
    const rect = graphCur.svg.getBoundingClientRect();
    graphZoomBy(e.deltaY < 0 ? GRAPH_ZOOM_STEP : 1 / GRAPH_ZOOM_STEP, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || graphPan || !graphCur) return;
    if (!e.target.closest('.graph-canvas') || e.target.closest('.card-el')) return;
    const v = graphCur.view;
    graphPan = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false };
    try { host.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers can't be captured */ }
  });
  host.addEventListener('pointermove', (e) => {
    if (!graphPan || e.pointerId !== graphPan.pointerId || !graphCur) return;
    const dx = e.clientX - graphPan.sx;
    const dy = e.clientY - graphPan.sy;
    if (!graphPan.moved) {
      if (Math.hypot(dx, dy) <= GRAPH_PAN_THRESHOLD) return;
      graphPan.moved = true;
      isDragging = true;
      graphCur.svg.classList.add('graph-panning');
    }
    graphCur.view.x = graphPan.vx + dx;
    graphCur.view.y = graphPan.vy + dy;
    graphCur.view.touched = true;
    graphApplyTransform();
  });
  host.addEventListener('pointerup', (e) => { if (graphPan && e.pointerId === graphPan.pointerId) graphFinishPan(); });
  host.addEventListener('pointercancel', (e) => { if (graphPan && e.pointerId === graphPan.pointerId) graphFinishPan(); });

  const enter = (e) => {
    const el = e.target.closest('.graph-node');
    if (el) graphSetFocus(Number(el.dataset.id));
  };
  const leave = (e) => {
    const from = e.target.closest('.graph-node');
    if (!from) return;
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.graph-node');
    if (to === from) return;
    if (to) graphSetFocus(Number(to.dataset.id));
    else graphClearFocus();
  };
  host.addEventListener('mouseover', enter);
  host.addEventListener('mouseout', leave);
  host.addEventListener('focusin', enter);
  host.addEventListener('focusout', leave);
}

window.addEventListener('DOMContentLoaded', () => {
  $('#graph-toggle-btn').addEventListener('click', () => toggleView('graph'));
  wireGraphView($('#graph-view'));
});
