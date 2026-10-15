'use strict';
// The Graph view: every card as a dot, joined by its relations. renderGraphView()
// is a full idempotent rebuild (the 5s poll, every search keystroke and every
// selection change re-run it), so pan/zoom and the per-board choices live in the
// module variables below, never in the DOM. Plain <script> sharing one global
// scope with app.js, so every top-level name here is graph-prefixed. The context
// menu on a node is NOT wired here: ADR 0006's document-level delegated grammar
// drives any .card-el[data-id]. The Graph is the one deliberate exception for a
// click: a plain click makes the card the anchor of a new selection, Shift or
// Ctrl/Cmd adds one card or takes it out (the layout has no reading order to
// range over), all painted in place, and a double click opens, because
// dragging a card makes a bare click a selection gesture. What is selected is
// lit and the rest dims (graphLightCards); a search typed in the box hides
// nothing, it is the anchor of the selection and its matches light. A caption of
// the tier fan shows its name alone; the pointer or focus on it shows its tip, one
// tooltip the stage shares (graphShowTip), with the count of its cards. Tiers also has an
// option row (lines, dependencies, order, unnested), folded behind a toggle and kept per board:
// a press redraws the Graph and hands focus back to the control, and no control of the
// row holds the poll, starts a pan or clears the selection.

const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPH_PAN_THRESHOLD = 4;
const GRAPH_DRAG_ALPHA = 0.3;
const GRAPH_DRAG_STEPS = 2;
const GRAPH_COOL_FRAMES = 40;
const GRAPH_SETTLED_ALPHA = 0.004;
const GRAPH_ZOOM_STEP = 1.12;
const GRAPH_TIP_GAP = 6;
const GRAPH_BUTTON_ZOOM = 1.25;
const GRAPH_LABELS_ALL_K = 1.4;
const GRAPH_LABELS_ALL_MAX_NODES = 60;
const GRAPH_LAYOUT_TITLES = {
  tiers: 'Tiers: the tier fan, all the way round the centre, a band for each tier with its name (hover or focus it for its count), tier 1 nearest the centre, then a ring for each depth of the cards without a tier; a sector for each tree; cards with no parent, children or tier sit on one ring outside the rest (the Unnested option of the option row moves them: off, depth 0 or the Unnested block outside the rim, a column for each status)',
  force: 'Force: related cards pull together, loose cards sit around the edge',
  status: 'Status: one ring per status, done innermost; archive is its own group',
};
const GRAPH_LAYOUT_LABELS = { tiers: 'Tiers', force: 'Force', status: 'Status' };
// The tier fan's option row (GRAPH_FAN_OPTION_VALUES, graph-model.js): what each option is
// called and says. A value reads as itself on its button. A later option is one more
// entry here and in the model's table.
const GRAPH_FAN_OPTION_LABELS = {
  lines: {
    label: 'Lines',
    hint: 'Which parent lines the fan draws. Folded: a line to the end of each dependency chain, and one counted line for the other children of a parent that sit on one ring. Chain: a line to every chain end, as the Map draws them. All: a line to every child. Off: none.',
  },
  dependencies: {
    label: 'Dependencies',
    hint: 'The dashed arrows for waiting_for, from the card waited for to the card that waits.',
  },
  order: {
    label: 'Order',
    hint: 'How siblings are ordered within a sector, the way the Map orders its rows. Status: doing, todo, backlog, the other live statuses in column order, done, archived; ties keep the outline order. Rank: the outline order itself.',
  },
  unnested: {
    label: 'Unnested',
    hint: 'Where the cards with no parent, no children and no tier are drawn. Outermost: one ring outside every depth ring, grouped by status, under an unnested caption. Off: not drawn, and no relation to a drawn card is. Depth 0: on the depth 0 ring, in a sector of their own. Table: a block outside the fan, a column for each status.',
  },
};
const GRAPH_KEY = 'solid line: parent, dashed arrow: points at the card that waits, red ring: blocked, amber ring: waiting, gold ring: review';

let graphLayoutKind = null;
let graphStatusFilter = null;
let graphFanOptions = null;
let graphOptionsFolded = null;
const graphViews = new Map();
let graphCur = null;
let graphPan = null;
let graphClickSwallow = null;
let graphDrag = null;
const graphArrangements = new Map();
const GRAPH_ARRANGEMENTS_MAX = 6;
let graphFrame = 0;
let graphLastError = null;

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
  if (!Object.prototype.hasOwnProperty.call(filter, col)) return;
  filter[col] = !filter[col];
  graphSaveFilter();
  renderBoard(); // a status pill changes the cards the selection can reach, as in the other views
}

function graphSoloFilter(col) {
  const filter = graphLoadFilter();
  if (!Object.prototype.hasOwnProperty.call(filter, col)) return;
  Object.assign(filter, soloStatusFilter(filter, boardColumnIds(), col));
  graphSaveFilter();
  renderBoard();
}

// The fan's options and whether its row is folded: one browser choice each for the board,
// merged with the defaults when read, so a value this version does not offer, or storage
// that refuses, reads as the default (graph-model.js).
function graphLoadOptions() {
  if (graphFanOptions) return graphFanOptions;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'graph.options'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; }
  graphFanOptions = mergeGraphFanOptions(saved);
  return graphFanOptions;
}

function graphSaveOptions() {
  try { localStorage.setItem(storageKey(state.projectName, 'graph.options'), JSON.stringify(graphFanOptions)); }
  catch (e) { /* storage unavailable — the choice just won't persist this session */ }
}

function graphLoadOptionsFolded() {
  if (graphOptionsFolded !== null) return graphOptionsFolded;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'graph.optionsFolded'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; }
  graphOptionsFolded = mergeGraphOptionsFolded(saved);
  return graphOptionsFolded;
}

function graphSaveOptionsFolded() {
  try { localStorage.setItem(storageKey(state.projectName, 'graph.optionsFolded'), JSON.stringify(graphOptionsFolded)); }
  catch (e) { /* storage unavailable — the fold just won't persist this session */ }
}

// A press on an option redraws the Graph and nothing else: the lines and the arrows only
// redraw, the order moves siblings within their stretch, the Unnested mode moves the cards
// with no relative and no tier (graph-model.js). Unnested off takes cards out of the Graph,
// and a selection only reaches the cards the view draws (viewCardIds), so a press of
// Unnested works the selection out again, as a status pill does.
function graphSetOption(key, value) {
  const values = Object.prototype.hasOwnProperty.call(GRAPH_FAN_OPTION_VALUES, key) ? GRAPH_FAN_OPTION_VALUES[key] : null;
  if (!values || !values.includes(value)) return;
  graphLoadOptions()[key] = value;
  graphSaveOptions();
  if (key === 'unnested') renderBoard();
  else renderGraphView();
}

// The cards the Tiers layout leaves out of the Graph under Unnested off, for the ones
// that decide what the Graph shows (graphVisibleIds); null when nothing is left out.
function graphLeftOut(pool) {
  if (graphLoadLayout() !== 'tiers' || graphLoadOptions().unnested !== 'off') return null;
  return graphUnnestedIds(pool, { ctx: nestingCtx(), hierarchy: state.hierarchy });
}

function graphToggleOptions() {
  graphOptionsFolded = !graphLoadOptionsFolded();
  graphSaveOptionsFolded();
  renderGraphView();
}

function resetGraphViewState() {
  graphLayoutKind = null;
  graphStatusFilter = null;
  graphFanOptions = null;
  graphOptionsFolded = null;
  graphViews.clear();
  graphStopDrag(false);
  graphArrangements.clear();
  graphCur = null;
  if (graphPan && graphPan.moved) isDragging = false;
  graphPan = null;
}

// --- DOM helpers ---------------------------------------------------------------

function graphEl(tag, attrs, cls) {
  const el = document.createElementNS(GRAPH_SVG_NS, tag);
  if (cls) el.setAttribute('class', cls);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  return el;
}

function graphTspan(text, cls, attrs) {
  const el = graphEl('tspan', attrs, cls);
  el.textContent = text;
  return el;
}

// A caption of the fan: its name from the plan, in a text that keeps its size on screen
// (app.css). The plan's `anchor` says which end of the text sits at x. A caption with a
// tip is a tab stop and carries what the tip shows, the lines one to a line and the
// slice: term when it names a slice, for the pointer or focus to fill the tooltip with.
function graphCaptionEl(c) {
  const el = graphEl('text', { x: c.x, y: c.y, 'text-anchor': c.anchor }, c.cls);
  if (c.dy) el.setAttribute('dy', c.dy);
  if (c.kind) el.setAttribute('data-kind', c.kind);
  if (c.tip) {
    el.setAttribute('tabindex', '0');
    el.setAttribute('data-tip', c.tip.lines.join('\n'));
    if (c.tip.term) el.setAttribute('data-term', c.tip.term);
  }
  el.appendChild(graphTspan(c.name, 'graph-caption-name'));
  return el;
}

// The one tooltip of the stage, shared by every caption: hidden until a caption shows it.
function graphBuildTip() {
  const tip = document.createElement('div');
  tip.className = 'graph-tip';
  tip.id = 'graph-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  return tip;
}

function graphButton(cls, text, title, data) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${cls} graph-control`;
  b.dataset.keepsSelection = '';
  b.dataset.holdsPoll = '';
  b.textContent = text;
  b.title = title;
  for (const [k, v] of Object.entries(data || {})) b.dataset[k] = v;
  return b;
}

function graphPlural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// The fan's option row: a fold toggle (the Map's, from app.js) and, while it is open, one
// segmented control for each option in the model's table. Every control keeps the
// selection and none holds the poll: a press rebuilds the row and hands focus back to the
// control (keepPillFocus), the way a status pill does. The row is only for Tiers.
function graphBuildOptionsRow(options, folded) {
  const row = document.createElement('div');
  row.className = 'graph-options';
  row.dataset.keepsSelection = '';
  row.appendChild(buildMapSectionHeader('graph-options', 'Options', folded));
  if (folded) return row;
  for (const key of Object.keys(GRAPH_FAN_OPTION_VALUES)) {
    const meta = GRAPH_FAN_OPTION_LABELS[key];
    const group = document.createElement('span');
    group.className = 'graph-option';
    group.title = meta.hint;
    const label = document.createElement('span');
    label.className = 'graph-option-label';
    label.textContent = meta.label;
    group.appendChild(label);
    const seg = document.createElement('span');
    seg.className = 'graph-option-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', meta.label);
    for (const value of GRAPH_FAN_OPTION_VALUES[key]) {
      const on = options[key] === value;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `graph-option-btn${on ? ' active' : ''}`;
      b.dataset.key = key;
      b.dataset.val = value;
      b.dataset.keepsSelection = '';
      b.setAttribute('aria-pressed', String(on));
      b.textContent = value;
      seg.appendChild(b);
    }
    group.appendChild(seg);
    row.appendChild(group);
  }
  return row;
}

function graphBuildControls(kind, filter, cardCount, relationCount, fan) {
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
  if (fan) frag.appendChild(graphBuildOptionsRow(fan.options, fan.folded));
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
  graphHideTip();
  const { svg, world, view, arrow } = graphCur;
  const k = view.k;
  world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${k})`);
  svg.style.setProperty('--graph-k', String(k));
  arrow.setAttribute('markerWidth', 9 / k);
  arrow.setAttribute('markerHeight', 9 / k);
  svg.classList.toggle('graph-labels-all', k >= GRAPH_LABELS_ALL_K || graphCur.nodeCount <= GRAPH_LABELS_ALL_MAX_NODES);
}

function graphScheduleTransform() {
  if (graphFrame) return;
  graphFrame = requestAnimationFrame(() => {
    graphFrame = 0;
    graphApplyTransform();
  });
}

function graphFitNow() {
  if (!graphCur) return;
  Object.assign(graphCur.view, graphFit(graphCur.layout.bounds, graphCur.w, graphCur.h), { touched: false });
  graphApplyTransform();
}

function graphZoomBy(factor, px, py) {
  if (!graphCur) return;
  Object.assign(graphCur.view, graphZoomAt(graphCur.view, px, py, factor), { touched: true });
  graphScheduleTransform();
}

// --- a caption's tip -----------------------------------------------------------

function graphTipLine(text, cls) {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  return p;
}

// Fills the tooltip from the caption's lines and term and stands it under the caption
// on the stage (graphTipAt keeps it whole). It is measured from the stage's corner, where
// it cannot be squeezed against an edge, then placed. The caption names it as its
// description for as long as it shows.
function graphShowTip(caption) {
  if (!graphCur || !graphCur.tip) return;
  const tip = graphCur.tip;
  const lines = String(caption.getAttribute('data-tip')).split('\n').map((t) => graphTipLine(t, 'graph-tip-line'));
  const term = caption.getAttribute('data-term');
  if (term) lines.push(graphTipLine(term, 'graph-tip-term'));
  tip.replaceChildren(...lines);
  tip.hidden = false;
  tip.style.left = '0px';
  tip.style.top = '0px';
  const stage = tip.parentNode.getBoundingClientRect();
  const at = caption.getBoundingClientRect();
  const spot = graphTipAt(
    { x0: at.left - stage.left, y0: at.top - stage.top, x1: at.right - stage.left, y1: at.bottom - stage.top },
    { w: stage.width, h: stage.height },
    { w: tip.offsetWidth, h: tip.offsetHeight },
    GRAPH_TIP_GAP,
  );
  tip.style.left = `${graphRound(spot.x)}px`;
  tip.style.top = `${graphRound(spot.y)}px`;
  if (graphCur.tipFor && graphCur.tipFor !== caption) graphCur.tipFor.removeAttribute('aria-describedby');
  caption.setAttribute('aria-describedby', tip.id);
  graphCur.tipFor = caption;
}

function graphHideTip() {
  if (!graphCur || !graphCur.tip || graphCur.tip.hidden) return;
  graphCur.tip.hidden = true;
  if (graphCur.tipFor) graphCur.tipFor.removeAttribute('aria-describedby');
  graphCur.tipFor = null;
}

// --- hover focus ---------------------------------------------------------------

function graphClearFocus() {
  if (!graphCur) return;
  graphCur.svg.classList.remove('graph-dim');
  for (const el of graphCur.svg.querySelectorAll('.graph-near')) el.classList.remove('graph-near');
}

// The one dimming: everything but the lighting (graphLit, graph-model.js) dims, and
// its cards and the lines between them stay lit. The pointer, a lone card, a
// selection and a typed search all light through here; null lights nothing.
function graphLightCards(lit) {
  graphClearFocus();
  if (!graphCur || !lit) return;
  graphCur.svg.classList.add('graph-dim');
  for (const id of lit.nodes) graphCur.nodeEls.get(id).classList.add('graph-near');
  for (const i of lit.links) graphCur.linkEls[i].classList.add('graph-near');
}

// The pointer or keyboard focus on a card: that card and its one-hop relations.
function graphSetFocus(id) {
  if (!graphCur || id == null || !graphCur.model.byId.has(id)) { graphClearFocus(); return; }
  graphLightCards(graphLit(graphCur.model, graphNeighbours(graphCur.model, id), graphCur.lines));
}

// The lone card the selection holds, or null: only a card picked on its own,
// shown in this view, lights with its relations.
function graphLoneCardId() {
  const id = loneCard(selectionState.selection);
  return id !== null && selectedIds.has(id) ? id : null;
}

// What lights when the pointer is on no card: the selection, a typed search's
// matches included (graphRestLit).
function graphRestFocus() {
  if (!graphCur) return;
  graphLightCards(graphRestLit(graphCur.model, { selectedIds, loneCardId: graphLoneCardId() }, graphCur.lines));
}

function graphSettleFocus() {
  if (graphCur && hoveredId != null && graphCur.model.byId.has(hoveredId)) graphSetFocus(hoveredId);
  else graphRestFocus();
}

function graphPaintSelection() {
  if (!graphCur) return;
  for (const [nid, el] of graphCur.nodeEls) el.classList.toggle('selected', selectedIds.has(nid));
  graphRestFocus();
}

// A click on a card in the Graph, whatever the modifier: the shared decision
// with the Graph's own answers (a plain click selects; Shift adds one card, as
// Ctrl does), written to the selection and painted in place, no rebuild.
function graphClickNode(id, mods) {
  const action = cardClickAction({
    cue: false, shiftKey: mods.shiftKey, ctrlKey: mods.ctrlKey, metaKey: mods.metaKey,
    plainClick: plainClickBehaviour('graph'), ranges: shiftAddsRange('graph'),
  });
  const typedBefore = isTypedAnchor(selectionState.selection);
  selectByClick(action, id);
  // A plain click sets a new anchor and clears the box. Shift or Ctrl keeps
  // the query, unless it took out a card the query lit: the query is then its other
  // cards, and the box no longer names the anchor. While isolated the box holds the
  // isolate text and a click moves the anchor only (boxAfterGraphClick).
  const box = $('#search-input').value;
  const text = boxAfterGraphClick(action, { boxText: box, typedBefore, typedAfter: isTypedAnchor(selectionState.selection), isolated: isolateNow() !== null });
  if (text !== box) writeSearch(text, 'selection', false);
  graphPaintSelection();
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
  for (const g of plan.guides) world.appendChild(fixed(graphEl('path', { d: g.d }, g.cls)));
  for (const d of plan.dividers) {
    world.appendChild(fixed(graphEl('line', { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }, 'graph-divider')));
  }
  if (plan.block) {
    const b = plan.block;
    world.appendChild(fixed(graphEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4 }, b.cls)));
  }
  // Captions take the pointer, so they are drawn under the links and the dots: a dot a
  // caption lies over is still the one the pointer finds.
  for (const c of plan.captions) world.appendChild(graphCaptionEl(c));
  if (plan.looseCaption) world.appendChild(graphCaptionEl(plan.looseCaption));
  if (plan.block) {
    world.appendChild(graphCaptionEl(plan.block.title));
    for (const col of plan.block.columns) world.appendChild(graphCaptionEl(col.caption));
  }
  const linkEls = plan.links.map((l) => {
    const p = fixed(graphEl('path', { d: l.d }, l.cls));
    if (l.arrow) p.setAttribute('marker-end', 'url(#graph-arrow-head)');
    world.appendChild(p);
    if (l.label) {
      const count = graphEl('text', { x: l.label.x, y: l.label.y, dy: '0.35em', 'text-anchor': 'middle' }, 'graph-link-count');
      count.textContent = l.label.text;
      world.appendChild(count);
    }
    return p;
  });
  const nodeEls = new Map();
  for (const n of plan.nodes) {
    const g = graphEl('g', { transform: `translate(${n.x} ${n.y})`, tabindex: 0 }, n.cls);
    g.setAttribute('data-id', String(n.id));
    const title = graphEl('title');
    title.textContent = n.title;
    g.appendChild(title);
    // A type with an icon draws its dot as that outline (the plan holds it as `d`, from
    // a closed table), still the one graph-dot in the status colour; every other card is round.
    g.appendChild(fixed(n.d ? graphEl('path', { d: n.d }, 'graph-dot') : graphEl('circle', { r: n.r }, 'graph-dot')));
    const kids = n.cls.includes(' has-kids');
    const flagged = / is-(blocked|waiting|review)/.test(n.cls);
    if (kids) g.appendChild(fixed(graphEl('circle', { r: n.kidsRing }, 'graph-kids-ring')));
    if (flagged) g.appendChild(fixed(graphEl('circle', { r: n.flagRing }, 'graph-flag-ring')));
    const label = graphEl('text', { x: n.reach + 3 }, 'graph-node-id');
    label.textContent = String(n.id);
    g.appendChild(label);
    world.appendChild(g);
    nodeEls.set(n.id, g);
  }
  for (const r of plan.rings) {
    const t = graphEl('text', { x: r.cx + 4, y: -r.r - 3 }, 'graph-ring-label');
    t.textContent = r.label;
    world.appendChild(t);
  }
  for (const t of plan.titles) {
    const el = graphEl('text', { x: t.x, y: t.y }, 'graph-title');
    el.textContent = t.text;
    world.appendChild(el);
  }
  stage.appendChild(svg);
  const tip = graphBuildTip();
  stage.appendChild(tip);
  return { stage, svg, world, arrow, linkEls, nodeEls, tip };
}

function renderGraphView() {
  const host = document.getElementById('graph-view');
  graphStopDrag(true);
  let kind, filter, fanOptions, model, layout, layoutOpts, plan, sig;
  try {
    kind = graphLoadLayout();
    filter = graphLoadFilter();
    fanOptions = kind === 'tiers' ? graphLoadOptions() : null;
    const pool = state.active.concat(state.archived);
    const visibleIds = graphVisibleIds(pool, currentGraphQueryEffect().visibleIds, filter, boardStatuses());
    model = graphBuild(pool, {
      ctx: nestingCtx(), visibleIds, types: state.types, hierarchy: state.hierarchy, unnested: fanOptions && fanOptions.unnested,
    });
    layoutOpts = { statuses: boardStatuses(), order: fanOptions && fanOptions.order, unnested: fanOptions && fanOptions.unnested };
    layout = graphLayout(model, kind, layoutOpts);
    sig = graphSignature(model, kind, layoutOpts);
    if (kind === 'force' && graphArrangements.has(sig)) layout = graphWithPositions(layout, model, graphArrangements.get(sig));
    plan = graphPlan(model, layout, {
      selectedIds, hoveredId, kind, statusClass: statusColorClass, titleOf: (c) => cardTitleDisplay(c).text, fan: fanOptions,
    });
  } catch (err) {
    const msg = String(err && err.message || err);
    if (msg !== graphLastError) console.error('graph view: render failed', err);
    graphLastError = msg;
    return;
  }
  graphLastError = null;
  host.textContent = '';
  graphCur = null;

  host.appendChild(graphBuildControls(kind, filter, model.nodes.length, model.links.length, fanOptions && { options: fanOptions, folded: graphLoadOptionsFolded() }));
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
  drawn.svg.classList.add(`graph-kind-${kind}`);
  let view = graphViews.get(kind);
  const refit = !view || (view.sig !== sig && !view.touched);
  if (!view) {
    view = { x: 0, y: 0, k: 1, sig, touched: false };
    graphViews.set(kind, view);
  }
  view.sig = sig;
  graphCur = {
    kind, sig, model, layout, view, w, h, nodeCount: plan.nodes.length, lines: plan.links,
    svg: drawn.svg, world: drawn.world, arrow: drawn.arrow, linkEls: drawn.linkEls, nodeEls: drawn.nodeEls, tip: drawn.tip, tipFor: null,
  };
  if (refit) Object.assign(view, graphFit(layout.bounds, w, h), { touched: false });
  graphApplyTransform();
  graphSettleFocus();
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

// --- node drag (force layout) --------------------------------------------------
// Dragging a card pins it to the pointer and lets the cards related to it
// follow: the same force step as the layout, continued from what is on screen.
// One rAF loop at most; every exit path goes through graphStopDrag.

function graphWorldPoint(e) {
  const rect = graphCur.svg.getBoundingClientRect();
  const v = graphCur.view;
  return { x: (e.clientX - rect.left - v.x) / v.k, y: (e.clientY - rect.top - v.y) / v.k };
}

function graphPaintDrag(d) {
  for (const [id, p] of graphForcePositions(d.sim)) {
    d.pos.set(id, p);
    graphCur.nodeEls.get(id).setAttribute('transform', `translate(${graphRound(p.x)} ${graphRound(p.y)})`);
  }
  const paths = graphLinkPaths(graphCur.model, d.layout, 'force');
  for (let i = 0; i < paths.length; i++) graphCur.linkEls[i].setAttribute('d', paths[i]);
}

function graphDragKick(d) {
  if (!d.raf) d.raf = requestAnimationFrame(graphDragFrame);
}

function graphDragFrame() {
  const d = graphDrag;
  if (!d || !d.sim || !graphCur) return;
  d.raf = 0;
  for (let i = 0; i < GRAPH_DRAG_STEPS; i++) {
    graphForceStep(d.sim, d.alpha, d.pin);
    d.alpha *= 0.985;
  }
  graphPaintDrag(d);
  if (d.released) {
    d.frames--;
    if (d.frames <= 0) { graphStopDrag(true); return; }
  } else if (d.alpha < GRAPH_SETTLED_ALPHA) {
    return;
  }
  d.raf = requestAnimationFrame(graphDragFrame);
}

function graphBeginDrag(d) {
  d.moved = true;
  isDragging = true;
  try { document.getElementById('graph-view').setPointerCapture(d.pointerId); } catch (err) { /* synthetic pointers can't be captured */ }
  graphCur.svg.classList.add('graph-dragging');
  graphSetFocus(d.id);
  d.sim = graphForceSim(graphCur.model, graphCur.layout.pos);
  d.pos = new Map(graphCur.layout.pos);
  d.layout = { pos: d.pos, rings: [], spokes: [], titles: [] };
  d.sig = graphCur.sig;
  d.alpha = GRAPH_DRAG_ALPHA;
}

function graphDragMove(e) {
  const d = graphDrag;
  if (!d || e.pointerId !== d.pointerId || d.released || !graphCur) return;
  if (d.moved && e.pointerType === 'mouse' && e.buttons === 0) { graphReleaseDrag(e); return; }
  const w = graphWorldPoint(e);
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= GRAPH_PAN_THRESHOLD) return;
    graphBeginDrag(d);
    const at = d.pos.get(d.id);
    const down = graphWorldPoint({ clientX: d.sx, clientY: d.sy });
    d.grab = { x: at.x - down.x, y: at.y - down.y };
  }
  d.pin = { id: d.id, x: w.x + d.grab.x, y: w.y + d.grab.y };
  d.alpha = Math.max(d.alpha, GRAPH_DRAG_ALPHA);
  graphDragKick(d);
}

function graphReleaseDrag(e) {
  const d = graphDrag;
  if (!d || d.released) return;
  if (!d.moved) { graphDrag = null; return; }
  d.released = true;
  d.pin = null;
  d.alpha = Math.max(d.alpha, GRAPH_DRAG_ALPHA);
  d.frames = GRAPH_COOL_FRAMES;
  graphSwallowNextClick();
  const under = e && e.type === 'pointerup' && document.elementFromPoint(e.clientX, e.clientY);
  const node = under && under.closest && under.closest('.graph-node');
  if (node) graphSetFocus(Number(node.dataset.id));
  else graphRestFocus();
  graphDragKick(d);
}

// commit keeps the simulated arrangement for the signature it was made under.
function graphStopDrag(commit) {
  const d = graphDrag;
  if (!d) return;
  graphDrag = null;
  if (d.raf) cancelAnimationFrame(d.raf);
  if (!d.moved) return;
  isDragging = false;
  if (commit && d.sim) {
    const positions = graphForcePositions(d.sim);
    graphArrangements.delete(d.sig);
    graphArrangements.set(d.sig, positions);
    while (graphArrangements.size > GRAPH_ARRANGEMENTS_MAX) graphArrangements.delete(graphArrangements.keys().next().value);
    if (graphCur) graphCur.layout = graphWithPositions(graphCur.layout, graphCur.model, positions);
  }
  if (graphCur) graphCur.svg.classList.remove('graph-dragging');
}

function wireGraphView(host) {
  host.addEventListener('click', (e) => {
    const pill = e.target.closest('.graph-filter-toggle[data-col]');
    if (pill) { keepPillFocus(pill, () => graphToggleFilter(pill.dataset.col)); return; }
    const fold = e.target.closest('.map-section-toggle[data-section="graph-options"]');
    if (fold) { keepPillFocus(fold, graphToggleOptions); return; }
    const option = e.target.closest('.graph-option-btn[data-key][data-val]');
    if (option) { keepPillFocus(option, () => graphSetOption(option.dataset.key, option.dataset.val)); return; }
    const layoutBtn = e.target.closest('.graph-layout-btn[data-layout]');
    if (layoutBtn) {
      if (mergeGraphLayout(layoutBtn.dataset.layout) === graphLoadLayout()) return;
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
    zoomBtn.blur();
  });
  host.addEventListener('contextmenu', (e) => {
    if (isDragging) return;
    const pill = e.target.closest('.graph-filter-toggle[data-col]');
    if (!pill) return;
    e.preventDefault();
    keepPillFocus(pill, () => graphSoloFilter(pill.dataset.col));
  });
  host.addEventListener('wheel', (e) => {
    if (!graphCur || !e.target.closest('.graph-stage')) return;
    e.preventDefault();
    const rect = graphCur.svg.getBoundingClientRect();
    graphZoomBy(e.deltaY < 0 ? GRAPH_ZOOM_STEP : 1 / GRAPH_ZOOM_STEP, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !graphCur) return;
    if (graphDrag) graphStopDrag(true);
    const node = e.target.closest('.graph-node');
    if (node) {
      if (graphCur.kind !== 'force' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const id = Number(node.dataset.id);
      const model = graphCur.model.byId.get(id);
      if (!model || model.deg === 0) return;
      graphDrag = { pointerId: e.pointerId, id, sx: e.clientX, sy: e.clientY, moved: false, released: false, raf: 0, sim: null, pin: null };
      return;
    }
    if (graphPan) return;
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
    graphScheduleTransform();
  });
  host.addEventListener('pointermove', graphDragMove);
  const finish = (e) => {
    if (graphPan && e.pointerId === graphPan.pointerId) graphFinishPan();
    if (graphDrag && e.pointerId === graphDrag.pointerId) graphReleaseDrag(e);
  };
  host.addEventListener('pointerup', finish);
  host.addEventListener('pointercancel', finish);
  host.addEventListener('lostpointercapture', finish);

  host.addEventListener('click', (e) => {
    if (!graphCur) return;
    const node = e.target.closest('.graph-node');
    if (!node) return;
    e.stopPropagation();
    hideContextMenu();
    graphClickNode(Number(node.dataset.id), e);
  }, true);
  host.addEventListener('dblclick', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    const node = e.target.closest('.graph-node');
    if (node) openCard(Number(node.dataset.id));
  });
  host.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const node = e.target.closest('.graph-node');
    if (!node) return;
    if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) openCard(Number(node.dataset.id)); }
    else if (e.key === ' ') { e.preventDefault(); graphClickNode(Number(node.dataset.id), {}); }
  });

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
    else graphRestFocus();
  };
  host.addEventListener('mouseover', enter);
  host.addEventListener('mouseout', leave);
  host.addEventListener('focusin', enter);
  host.addEventListener('focusout', leave);

  // A caption of the fan shows its tip while the pointer or focus is on it, and not
  // while the pointer only passes from one part of the caption to another.
  const tipOf = (el) => (el && el.closest ? el.closest('[data-tip]') : null);
  const tipOn = (e) => {
    const caption = tipOf(e.target);
    if (caption) graphShowTip(caption);
  };
  const tipOff = (e) => {
    const from = tipOf(e.target);
    if (from && tipOf(e.relatedTarget) !== from) graphHideTip();
  };
  host.addEventListener('mouseover', tipOn);
  host.addEventListener('mouseout', tipOff);
  host.addEventListener('focusin', tipOn);
  host.addEventListener('focusout', tipOff);
}

window.addEventListener('DOMContentLoaded', () => {
  $('#graph-toggle-btn').addEventListener('click', () => toggleView('graph'));
  wireGraphView($('#graph-view'));
});
