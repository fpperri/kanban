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
// option row in the option panel (lines, dependencies, order, names, unnested), kept per board:
// a press redraws the Graph and hands focus back to the control, and no control of the
// row holds the poll, starts a pan or clears the selection. Names says which cards carry their
// title (graphFanNames, graph-model.js) and graph-names.js where each sits: every card of the
// fan has one label and one leader, set from the placement with attributes and classes, so a
// selection paints names in place, and a zoom places them again once it settles; the
// l key steps the setting through the shared key guard while the Graph shows Tiers.

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
  names: {
    label: 'Names',
    hint: `Which cards carry their title, a parent beside its ring and the others in rows outside the rim. Relevant: the selection and the cards it lights, then parents from the highest altitude down, up to ${GRAPH_FAN_NAMES_CAP} names; every card on a fan of ${GRAPH_FAN_NAMES_SMALL} cards or fewer. All: every card. None: no card. Press n to step through them.`,
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
// Set when the option panel opened or closed: the next draw frames the cards again in the
// width it left, unless the person has moved the view.
let graphRefitNext = false;
const graphViews = new Map();
let graphCur = null;
let graphPan = null;
let graphClickSwallow = null;
let graphDrag = null;
const graphArrangements = new Map();
const GRAPH_ARRANGEMENTS_MAX = 6;
let graphFrame = 0;
let graphLastError = null;
// Where the fan's names sit (graphNamesPlace, graph-names.js) is worked out again only when
// what it reads changes: the last placement and its key, the placement a zoom has queued, and
// the widths of the texts measured so far, in the stage's font.
const GRAPH_NAMES_SETTLE_MS = 140;
const GRAPH_NAMES_MEASURED_MAX = 4000;
let graphNamesMemo = null;
let graphNamesTimer = 0;
const graphNamesMeasure = { family: null, ctx: null, seen: new Map() };

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

// The fan's options: one browser choice for the board,
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

// The Unnested option as it applies now: only the Tiers layout has it, so any other layout
// answers null. What the Graph draws (renderGraphView) and what a selection can reach
// (graphLeftOut) both read it here.
function graphUnnestedNow() {
  return graphLoadLayout() === 'tiers' ? graphLoadOptions().unnested : null;
}

// The cards the Tiers layout leaves out of the Graph under Unnested off, for the ones
// that decide what the Graph shows (graphVisibleIds); null when nothing is left out.
function graphLeftOut(pool) {
  if (graphUnnestedNow() !== 'off') return null;
  return graphUnnestedIds(pool, { ctx: nestingCtx(), hierarchy: state.hierarchy });
}

function resetGraphViewState() {
  graphLayoutKind = null;
  graphStatusFilter = null;
  graphFanOptions = null;
  graphRefitNext = false;
  graphViews.clear();
  graphStopDrag(false);
  graphArrangements.clear();
  graphCur = null;
  if (graphPan && graphPan.moved) isDragging = false;
  graphPan = null;
  clearTimeout(graphNamesTimer);
  graphNamesTimer = 0;
  graphNamesMemo = null;
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
// The `key` names the caption among the stage's (a band by its index, the loose caption, the
// block's title, a column by its place): every render rebuilds the captions, and the poll
// finds a focused one again by it (applyBoardData).
function graphCaptionEl(c, key) {
  const el = graphEl('text', { x: c.x, y: c.y, 'text-anchor': c.anchor }, c.cls);
  if (c.dy) el.setAttribute('dy', c.dy);
  if (c.kind) el.setAttribute('data-kind', c.kind);
  if (c.tip) {
    el.setAttribute('tabindex', '0');
    el.setAttribute('data-caption', key);
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

// The fan's option row: one segmented control for each option in the model's table, always
// shown, since the panel it stands in is what hides it. Every control keeps the
// selection and none holds the poll: a press rebuilds the row and hands focus back to the
// control (keepControlFocus), the way a status pill does. The row is only for Tiers.
function graphBuildOptionsRow(options) {
  const row = document.createElement('div');
  row.className = 'graph-options';
  row.dataset.keepsSelection = '';
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

// The option panel's contents (app.js builds the panel itself): the layouts, the zoom, and
// for Tiers the option row. These stood in the top row of the view before.
function graphBuildPanel(kind, fan) {
  const panel = buildViewPanel('graph', 'Graph options');
  const layouts = document.createElement('div');
  layouts.className = 'graph-layouts';
  for (const k of GRAPH_LAYOUTS) {
    const b = graphButton('graph-layout-btn', GRAPH_LAYOUT_LABELS[k], GRAPH_LAYOUT_TITLES[k], { layout: k });
    b.setAttribute('aria-pressed', String(k === kind));
    layouts.appendChild(b);
  }
  panel.appendChild(layouts);
  const zoom = document.createElement('div');
  zoom.className = 'graph-zoom';
  zoom.appendChild(graphButton('graph-zoom-btn', '−', 'Zoom out', { graphAction: 'out' }));
  zoom.appendChild(graphButton('graph-zoom-btn', '+', 'Zoom in', { graphAction: 'in' }));
  zoom.appendChild(graphButton('graph-zoom-btn', 'Fit', 'Fit every card in the panel', { graphAction: 'fit' }));
  panel.appendChild(zoom);
  if (fan) panel.appendChild(graphBuildOptionsRow(fan.options));
  return panel;
}

// The view's own top: the card count and the panel's button at the right, then the status pills and the key.
function graphBuildControls(filter, cardCount, relationCount, fan, panelOpen) {
  const frag = document.createDocumentFragment();
  const row = document.createElement('div');
  row.className = 'graph-controls';
  const count = document.createElement('span');
  count.className = 'graph-count';
  count.textContent = `${graphPlural(cardCount, 'card')}, ${graphPlural(relationCount, 'relation')}`;
  row.appendChild(count);
  row.appendChild(buildViewPanelToggle('graph', 'Show or hide the layouts, the zoom and the options', panelOpen));
  frag.appendChild(row);
  frag.appendChild(buildFilterPillRow(filter, boardColumnIds(), 'graph-filter-row', 'graph-filter-toggle graph-control',
    (col, on) => statusFilterTitle('graph', col, columnLabel(col), on)));
  const key = document.createElement('p');
  key.className = 'graph-key';
  key.textContent = fan ? `${GRAPH_KEY} · l steps the names: ${fan.options.names}` : GRAPH_KEY;
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
  svg.classList.toggle('graph-labels-all', graphLabelsAll(k));
  graphQueueNames();
}

// Whether every card's id label shows at the zoom k: zoomed in, or on a small graph.
function graphLabelsAll(k) {
  return k >= GRAPH_LABELS_ALL_K || graphCur.nodeCount <= GRAPH_LABELS_ALL_MAX_NODES;
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

// The width of a text on screen in px, at `size` px, as the stage's font draws it: read off a
// canvas, with a little slack for the text's own rendering, and kept by text. Where no canvas
// measures, the width of its characters, as graph-names.js reckons them.
function graphMeasureName(text, size = GRAPH_NAME_PX, bold = false) {
  const m = graphNamesMeasure;
  const t = String(text);
  const key = `${size} ${bold ? 'b' : 'r'} ${t}`;
  if (m.seen.has(key)) return m.seen.get(key);
  if (!m.ctx) {
    try { m.ctx = document.createElement('canvas').getContext('2d'); } catch (err) { m.ctx = null; }
  }
  let w = NaN;
  if (m.ctx) {
    m.ctx.font = `${bold ? 600 : 400} ${size}px ${m.family || 'sans-serif'}`;
    const got = m.ctx.measureText(t).width;
    if (typeof got === 'number' && Number.isFinite(got)) w = got * 1.03 + 1;
  }
  if (!Number.isFinite(w)) w = (Array.from(t).length * GRAPH_NAME_CHAR_PX * size) / GRAPH_NAME_PX;
  if (m.seen.size >= GRAPH_NAMES_MEASURED_MAX) m.seen.clear();
  m.seen.set(key, w);
  return w;
}

// The font the stage draws its names in, read once a placement; a new one forgets every width.
function graphNamesFont() {
  const family = String(getComputedStyle(graphCur.svg).fontFamily || '');
  if (family !== graphNamesMeasure.family) {
    graphNamesMeasure.family = family;
    graphNamesMeasure.seen.clear();
  }
  return family;
}

// The names of the fan follow the selection like the lighting does: the cards it lights are
// named (graphFanNames), and where each name sits is graphNamesPlace's, worked out again only
// when its key changes (a new zoom, named set, board or font), so a poll that brings nothing new
// places nothing. Painted on the nodes already drawn, with attributes and classes alone:
// graph-named is the named set, graph-placed a name that found room, graph-called one in a row
// or a list, joined to its dot by its leader. The layout never reads them.
function graphPaintNames() {
  clearTimeout(graphNamesTimer);
  graphNamesTimer = 0;
  if (!graphCur || graphCur.kind !== 'tiers' || !graphCur.nameEls.size) {
    if (graphCur) graphCur.names = null;
    return;
  }
  const loneCardId = graphLoneCardId();
  const named = graphFanNames(graphCur.model, graphLoadOptions().names, { selectedIds, loneCardId });
  const lit = graphRestLit(graphCur.model, { selectedIds, loneCardId }, graphCur.lines);
  const k = graphCur.view.k;
  const input = {
    plan: graphCur.plan, rim: graphNamesRim(graphCur.layout), named, keep: lit ? lit.nodes : [], k, labelsAll: graphLabelsAll(k),
    measure: graphMeasureName, font: graphNamesFont(),
  };
  const key = graphNamesKey(input);
  if (!graphNamesMemo || graphNamesMemo.key !== key) graphNamesMemo = { key, result: graphNamesPlace(input) };
  const names = graphNamesMemo.result;
  graphCur.names = names;
  for (const n of graphCur.plan.nodes) {
    const g = graphCur.nodeEls.get(n.id);
    const els = graphCur.nameEls.get(n.id);
    if (!g || !els) continue;
    const p = names.placed.get(n.id);
    g.classList.toggle('graph-named', named.has(n.id));
    g.classList.toggle('graph-placed', !!p);
    g.classList.toggle('graph-called', !!(p && p.leader));
    els.text.textContent = p ? p.text : n.name;
    els.text.setAttribute('x', p ? graphRound(p.x - n.x) : n.reach + 3);
    els.text.setAttribute('y', p ? graphRound(p.y - n.y) : 0);
    els.text.setAttribute('text-anchor', p ? p.anchor : 'start');
    els.leader.setAttribute('d', p && p.leader ? p.leader.d : '');
  }
}

// A zoom places the names again once it settles: each step of it puts the placement off, and
// a pan, which keeps the zoom, places nothing; nor does a zoom with nothing named, which no zoom
// moves. O(1), so the transform stays one write a frame.
function graphQueueNames() {
  const names = graphCur && graphCur.kind === 'tiers' ? graphCur.names : null;
  if (!names || names.k === graphCur.view.k || !(names.placed.size || names.unnamed.length)) return;
  clearTimeout(graphNamesTimer);
  graphNamesTimer = setTimeout(graphPaintNames, GRAPH_NAMES_SETTLE_MS);
}

function graphPaintSelection() {
  if (!graphCur) return;
  for (const [nid, el] of graphCur.nodeEls) el.classList.toggle('selected', selectedIds.has(nid));
  graphPaintNames();
  graphRestFocus();
}

// A click on a card in the Graph, whatever the modifier: the shared decision
// with the Graph's own answers (a plain click selects; Shift adds one card, as
// Ctrl does), written to the selection and painted in place, no rebuild. The search panel is
// repainted too (its chip, and its pills while it is open), since a click that drops a pill
// takes it off the chip as well as out of the box.
function graphClickNode(id, mods) {
  const action = cardClickAction({
    cue: false, shiftKey: mods.shiftKey, ctrlKey: mods.ctrlKey, metaKey: mods.metaKey,
    plainClick: plainClickBehaviour('graph'), ranges: shiftAddsRange('graph'),
  });
  const typedBefore = isTypedAnchor(selectionState.selection);
  selectByClick(action, id);
  // A plain click sets a new anchor and clears the box, but for its cut: the Graph
  // keeps drawing what the cut hides, so the painting in place stays true. Shift or Ctrl keeps
  // the query, unless it took out a card the query lit: the query is then its other
  // cards, and the box no longer names the anchor. While isolated the box holds the
  // isolate text and a click moves the anchor only (boxAfterGraphClick).
  const box = $('#search-input').value;
  const text = boxAfterGraphClick(action, { boxText: box, cut: searchCutOnly(box), typedBefore, typedAfter: isTypedAnchor(selectionState.selection), isolated: isolateNow() !== null });
  if (text !== box) writeSearch(text, 'selection', false);
  graphPaintSelection();
  renderSearchPanel();
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
  // The washes of the tier bands come first, so they lie behind every other mark. A type's
  // colour is open text, so it rides a data attribute and the page paints it once the Graph
  // is on the page (paintTypeColors), as it does a type chip's; the stylesheet does the rest.
  for (const t of plan.tints) {
    const wash = graphEl('path', { d: t.d, 'data-tier': t.tier }, t.cls);
    if (t.color) wash.setAttribute('data-type-color', t.color);
    world.appendChild(wash);
  }
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
  plan.captions.forEach((c, i) => world.appendChild(graphCaptionEl(c, `band-${i}`)));
  if (plan.looseCaption) world.appendChild(graphCaptionEl(plan.looseCaption, 'loose'));
  if (plan.block) {
    world.appendChild(graphCaptionEl(plan.block.title, 'block'));
    plan.block.columns.forEach((col, i) => world.appendChild(graphCaptionEl(col.caption, `column-${i}`)));
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
  const nameEls = new Map();
  for (const n of plan.nodes) {
    const g = graphEl('g', { transform: `translate(${n.x} ${n.y})`, tabindex: 0 }, n.cls);
    g.setAttribute('data-id', String(n.id));
    const title = graphEl('title');
    title.textContent = n.title;
    g.appendChild(title);
    // A named card's leader runs from its dot to its name once the names are placed
    // (graphPaintNames); drawn first, so the dot covers where it starts.
    const leader = n.name !== undefined ? g.appendChild(fixed(graphEl('path', { d: '' }, 'graph-node-leader'))) : null;
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
    if (n.name !== undefined) {
      const name = graphEl('text', { x: n.reach + 3 }, 'graph-node-name');
      name.textContent = n.name;
      g.appendChild(name);
      nameEls.set(n.id, { text: name, leader });
    }
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
  return { stage, svg, world, arrow, linkEls, nodeEls, nameEls, tip };
}

function renderGraphView() {
  const host = document.getElementById('graph-view');
  graphStopDrag(true);
  let kind, filter, fanOptions, model, layout, layoutOpts, plan, sig;
  const panelMoved = graphRefitNext;
  graphRefitNext = false;
  try {
    kind = graphLoadLayout();
    filter = graphLoadFilter();
    fanOptions = kind === 'tiers' ? graphLoadOptions() : null;
    const pool = state.active.concat(state.archived);
    const visibleIds = graphVisibleIds(pool, currentGraphQueryEffect().visibleIds, filter, boardStatuses());
    model = graphBuild(pool, {
      ctx: nestingCtx(), visibleIds, types: state.types, hierarchy: state.hierarchy, unnested: graphUnnestedNow(),
    });
    layoutOpts = { statuses: boardStatuses(), order: fanOptions && fanOptions.order, unnested: fanOptions && fanOptions.unnested };
    layout = graphLayout(model, kind, layoutOpts);
    sig = graphSignature(model, kind, layoutOpts);
    if (kind === 'force' && graphArrangements.has(sig)) layout = graphWithPositions(layout, model, graphArrangements.get(sig));
    plan = graphPlan(model, layout, {
      selectedIds, loneCardId: graphLoneCardId(), hoveredId, kind, statusClass: statusColorClass, titleOf: (c) => cardTitleDisplay(c).text, fan: fanOptions,
      types: state.types,
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

  const panelOpen = viewPanelIsOpen('graph');
  const fan = fanOptions && { options: fanOptions };
  const main = document.createElement('div');
  main.className = 'graph-main';
  host.appendChild(main);
  if (panelOpen) host.appendChild(graphBuildPanel(kind, fan));
  main.appendChild(graphBuildControls(filter, model.nodes.length, model.links.length, fan, panelOpen));
  if (!plan.nodes.length) {
    const p = document.createElement('p');
    p.className = 'graph-empty';
    p.textContent = 'No cards to show';
    main.appendChild(p);
    return;
  }

  const drawn = graphDrawPlan(plan);
  main.appendChild(drawn.stage);
  paintTypeColors(drawn.svg);
  const w = drawn.stage.clientWidth || 800;
  const h = drawn.stage.clientHeight || 600;
  drawn.svg.classList.add(`graph-kind-${kind}`);
  let view = graphViews.get(kind);
  const refit = !view || ((view.sig !== sig || panelMoved) && !view.touched);
  if (!view) {
    view = { x: 0, y: 0, k: 1, sig, touched: false };
    graphViews.set(kind, view);
  }
  view.sig = sig;
  graphCur = {
    kind, sig, model, layout, plan, view, w, h, nodeCount: plan.nodes.length, lines: plan.links,
    svg: drawn.svg, world: drawn.world, arrow: drawn.arrow, linkEls: drawn.linkEls, nodeEls: drawn.nodeEls, nameEls: drawn.nameEls, names: null, tip: drawn.tip, tipFor: null,
  };
  if (refit) Object.assign(view, graphFit(layout.bounds, w, h), { touched: false });
  graphPaintNames();
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
  if (node) graphSetFocus(node.dataset.id);
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

// The panel opened or closed: the stage has another width, so the cards are framed again.
function graphRedrawForPanel() {
  graphRefitNext = true;
  renderGraphView();
}

function wireGraphView(host) {
  host.addEventListener('click', (e) => {
    const panelBtn = e.target.closest('.view-panel-toggle[data-panel], .view-panel-close[data-panel]');
    if (panelBtn) { pressViewPanelButton(panelBtn, graphRedrawForPanel); return; }
    const pill = e.target.closest('.graph-filter-toggle[data-col]');
    if (pill) { keepControlFocus(pill, () => graphToggleFilter(pill.dataset.col)); return; }
    const option = e.target.closest('.graph-option-btn[data-key][data-val]');
    if (option) { keepControlFocus(option, () => graphSetOption(option.dataset.key, option.dataset.val)); return; }
    const layoutBtn = e.target.closest('.graph-layout-btn[data-layout]');
    if (layoutBtn) {
      if (mergeGraphLayout(layoutBtn.dataset.layout) === graphLoadLayout()) return;
      const was = graphLoadLayout();
      const next = mergeGraphLayout(layoutBtn.dataset.layout);
      graphLayoutKind = next;
      graphViews.delete(graphLayoutKind);
      graphSaveLayout();
      // Unnested off is the Tiers layout's alone, so a switch into or out of Tiers changes the cards the
      // Graph draws, and a selection and the pill counts only reach those: the board works them out again.
      if (graphLoadOptions().unnested === 'off' && (was === 'tiers' || next === 'tiers')) renderBoard();
      else renderGraphView();
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
    keepControlFocus(pill, () => graphSoloFilter(pill.dataset.col));
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
      const id = node.dataset.id;
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
    graphClickNode(node.dataset.id, e);
  }, true);
  host.addEventListener('dblclick', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    const node = e.target.closest('.graph-node');
    if (node) openCard(node.dataset.id);
  });
  host.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const node = e.target.closest('.graph-node');
    if (!node) return;
    if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) openCard(node.dataset.id); }
    else if (e.key === ' ') { e.preventDefault(); graphClickNode(node.dataset.id, {}); }
  });

  const enter = (e) => {
    const el = e.target.closest('.graph-node');
    if (el) graphSetFocus(el.dataset.id);
  };
  const leave = (e) => {
    const from = e.target.closest('.graph-node');
    if (!from) return;
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.graph-node');
    if (to === from) return;
    if (to) graphSetFocus(to.dataset.id);
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

// The l key steps the fan's names: relevant, all, none. A key that types nothing but reads a
// letter, so it reads the whole key guard unchanged, as p, m and i do: off while a field has
// focus and while a menu, a dialog, the notifications panel or the preferences sheet is up;
// the search panel is not one of those. It acts only while the Graph shows Tiers, the one
// layout with names. A chord (Ctrl, Cmd, Alt), Shift on the key and a held key are not it;
// Caps Lock gives a capital N with no Shift, and counts. An option that has focus is
// rebuilt by the redraw, so it gets focus back, as after a press.
function onGraphNamesKey(e) {
  if (!e.key || e.key.toLowerCase() !== 'l' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (keyGuardOff(document)) return;
  if (loadViewMode() !== 'graph' || graphLoadLayout() !== 'tiers') return;
  e.preventDefault();
  const step = () => graphSetOption('names', graphFanNextNames(graphLoadOptions().names));
  const control = focusedRebuiltControl();
  if (control) keepControlFocus(control, step);
  else step();
}

window.addEventListener('DOMContentLoaded', () => {
  $('#graph-toggle-btn').addEventListener('click', () => toggleView('graph'));
  wireGraphView($('#graph-view'));
  document.addEventListener('keydown', onGraphNamesKey);
});
