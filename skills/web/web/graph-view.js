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
// range over), all painted in place, and a double click opens; a card is never dragged, so a
// bare click is a selection gesture. What is selected is
// lit and the rest dims (graphLightCards); a search typed in the box hides
// nothing, it is the anchor of the selection and its matches light. A caption of
// the tier fan shows its name alone; the pointer or focus on it shows its tip, one
// tooltip the stage shares (graphShowTip), with the count of its cards. The Hierarchy also has an
// option row in the option panel (lines, dependencies, order, names, unnested), kept per board:
// a press redraws the Graph and hands focus back to the control, and no control of the
// row holds the poll, starts a pan or clears the selection. Names says which cards carry their
// title (graphFanNames, graph-model.js) and graph-names.js where each sits: every card of the
// fan has one label and one leader, set from the placement with attributes and classes, so a
// selection paints names in place, and a zoom places them again once it settles; the
// l key steps the setting through the shared key guard while the Graph shows the Hierarchy.
// The Graph draws one of two graphs, chosen at the top of the option panel: Hierarchy (the tier
// fan above) and Flow (graph-flow.js: the cards in columns by their dependencies, with the Dependencies
// switch, frontier or all). Flow draws no parent line and keeps every other gesture of the dots: its
// column headings and strip are marks behind the dots that take no pointer. Its second switch, Lanes,
// puts the cards in a lane for each tier card, each lane under a header that leads with that card's
// type mark. A header is that card's node (a .graph-node, graphDrawPlan): the dot's handlers act on it,
// and it is lit and selected with the dot. The choice and the switches are kept per
// board and in the address (graph=, deps=, lanes=), the address winning on a load.

const GRAPH_SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPH_PAN_THRESHOLD = 4;
const GRAPH_ZOOM_STEP = 1.12;
const GRAPH_TIP_GAP = 6;
const GRAPH_BUTTON_ZOOM = 1.25;
const GRAPH_LABELS_ALL_K = 1.4;
const GRAPH_LABELS_ALL_MAX_NODES = 60;
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
const GRAPH_KIND_TITLES = {
  hierarchy: 'Hierarchy: the cards by their parent tree, as the tier fan, all the way round the centre, a band for each tier with its name (hover or focus it for its count), tier 1 nearest the centre, then a ring for each depth of the cards without a tier; a sector for each tree; cards with no parent, children or tier sit on one ring outside the rest (the Unnested option of the option row moves them: off, depth 0 or the Unnested block outside the rim, a column for each status)',
  flow: 'Flow: the cards in columns by their dependencies, left to right; an arrow runs from the card waited for to the card that waits',
};
const GRAPH_FLOW_DEPS_LABEL = {
  label: 'Dependencies',
  hint: 'Frontier: columns by the steps until a card is ready, counting only the dependencies not done; done cards stand faded in the first column and a dependency loop in the last. All: columns by the longest chain of dependencies behind a card, done ones included.',
};
const GRAPH_FLOW_LANES_LABEL = {
  label: 'Lanes',
  hint: 'Off: the cards in columns alone. On: each card in the lane of its nearest parent with a tier, else its root, under a header with the type mark of that card, its tier, title, cards and ready cards. Frontier puts the lanes with ready cards first, the most ready first, and folds a lane into the strip when none of its cards with a dependency is open; all keeps the outline order and folds none. A card with no dependency stays in the strip.',
};
const GRAPH_HOVER_LABEL = {
  label: 'On hover',
  hint: 'Which sets a hover or a keyboard focus on a card lights, any mix: dtree and htree the whole tree down or across, dpath and hpath the path to the roots, dlinks the cards one wait away, hlinks the parent and the children. The same choice as On hover show in the search panel, kept for each kind of Graph; Space writes the ticked terms into the box.',
};
const GRAPH_KEY = 'solid line: parent, dashed arrow: points at the card that waits, red ring: blocked, amber ring: waiting, gold ring: review';

let graphLayoutKind = null;
// The Flow's Dependencies and Lanes switches as the Graph holds them: 'frontier' or 'all', and a
// boolean (graph-flow.js spells the boolean as text only in storage and the address).
let graphDepsSwitch = null;
let graphLanesSwitch = null;
let graphStatusFilter = null;
let graphFanOptions = null;
// Set when the option panel opened or closed: the next draw frames the cards again in the
// width it left, unless the person has moved the view.
let graphRefitNext = false;
const graphViews = new Map();
let graphCur = null;
let graphPan = null;
let graphClickSwallow = null;
let graphPinch = null;
let graphLastPoint = null;
// The first finger of a touch that landed on a card, so a second finger can still start a pinch.
let graphTouch = null;
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

// The graph the Graph draws: the address's graph= when it says one (a link, or the page as it was
// left), else the one kept for the board. What the board kept that is not Hierarchy or Flow, `tiers`
// and a layout this version no longer draws included, reads as the Hierarchy (mergeGraphLayout).
function graphLoadLayout() {
  if (graphLayoutKind) return graphLayoutKind;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'graph.layout')); }
  catch (e) { saved = null; }
  graphLayoutKind = mergeGraphLayout(graphAddressKind(location.search) || saved);
  return graphLayoutKind;
}

function graphSaveLayout() {
  try { localStorage.setItem(storageKey(state.projectName, 'graph.layout'), graphLayoutKind); }
  catch (e) { /* storage unavailable — the layout choice just won't persist this session */ }
}

// The Flow's Dependencies switch: the address's deps= when it says one, else the one kept for the board.
function graphLoadDeps() {
  if (graphDepsSwitch) return graphDepsSwitch;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'graph.deps')); }
  catch (e) { saved = null; }
  graphDepsSwitch = graphFlowMergeDeps(graphFlowLink(location.search).deps || saved);
  return graphDepsSwitch;
}

function graphSaveDeps() {
  try { localStorage.setItem(storageKey(state.projectName, 'graph.deps'), graphDepsSwitch); }
  catch (e) { /* storage unavailable — the switch just won't persist this session */ }
}

// The Flow's Lanes switch: the address's lanes= when it says one, else the one kept for the board.
function graphLoadLanes() {
  if (graphLanesSwitch !== null) return graphLanesSwitch;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'graph.lanes')); }
  catch (e) { saved = null; }
  const link = graphFlowLink(location.search).lanes;
  graphLanesSwitch = link === null ? graphFlowLanesFromText(saved) === true : link;
  return graphLanesSwitch;
}

function graphSaveLanes() {
  try { localStorage.setItem(storageKey(state.projectName, 'graph.lanes'), graphFlowLanesText(graphLanesSwitch)); }
  catch (e) { /* storage unavailable — the switch just won't persist this session */ }
}

// What an address says of the Graph: graph=hierarchy|flow, null when absent or not one of those.
// The Flow's own parameters, deps and lanes, are read by graphFlowLink (graph-flow.js).
function graphAddressKind(search) {
  let params;
  try { params = new URLSearchParams(search || ''); } catch (e) { return null; }
  const kind = params.get('graph');
  return GRAPH_KINDS.includes(kind) ? kind : null;
}

// What the address should become once the Graph shows `kind` (with `deps` and `laned` while it is the
// Flow): every other parameter stays as it was, and deps and lanes go with the Flow. The search string
// to replace the entry with (leading "?", or "" when nothing is left), or null when the address
// already says it.
function graphAddressFor(search, kind, deps, laned) {
  const params = new URLSearchParams(search || '');
  const want = mergeGraphLayout(kind);
  let changed = false;
  if (params.get('graph') !== want) { params.set('graph', want); changed = true; }
  if (want === 'flow') changed = graphFlowSetParams(params, deps, laned) || changed;
  else changed = graphFlowDropParams(params) || changed;
  if (!changed) return null;
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// The address says which graph the Graph draws, and the Dependencies and Lanes switches while it is the
// Flow, so a reload or a link opens the same picture. It is written on a press and on every draw, so a
// Graph that opened from the board's memory says so too; it REPLACES the entry the page is on, adds
// nothing to Back, and does nothing once the address says it.
function graphWriteAddress() {
  const search = graphAddressFor(location.search, graphLoadLayout(), graphLoadDeps(), graphLoadLanes());
  if (search == null) return;
  try { history.replaceState(null, '', location.pathname + search); } catch (e) { /* the address lags until the next press */ }
}

// A press on the Hierarchy | Flow choice. Unnested off is the Hierarchy's
// alone, so a switch into or out of it changes the cards the Graph draws, and a selection
// and the pill counts only reach those: the board works them out again.
function graphSetLayoutKind(to) {
  const next = mergeGraphLayout(to);
  const was = graphLoadLayout();
  if (next === was) return;
  graphLayoutKind = next;
  graphViews.delete(graphLayoutKind);
  graphSaveLayout();
  graphWriteAddress();
  if (graphLoadOptions().unnested === 'off' && (was === 'hierarchy' || next === 'hierarchy')) renderBoard();
  else renderGraphView();
}

function graphSetDeps(to) {
  const next = graphFlowMergeDeps(to);
  if (next === graphLoadDeps()) return;
  graphDepsSwitch = next;
  graphSaveDeps();
  graphWriteAddress();
  renderGraphView();
}

function graphSetLanes(to) {
  const next = to === 'on';
  if (next === graphLoadLanes()) return;
  graphLanesSwitch = next;
  graphSaveLanes();
  graphWriteAddress();
  renderGraphView();
}

// Whether the count line and the key show: off until the (i) button is pressed, kept per board.
function graphInfoOn() {
  try { return localStorage.getItem(storageKey(state.projectName, 'graph.info')) === 'true'; }
  catch (e) { return false; }
}

function graphInfoSet(on) {
  try { localStorage.setItem(storageKey(state.projectName, 'graph.info'), String(on)); }
  catch (e) { /* storage unavailable: the choice just won't persist this session */ }
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

// The Unnested option as it applies now: only the Hierarchy has it, so the Flow
// answers null. What the Graph draws (renderGraphView) and what a selection can reach
// (graphLeftOut) both read it here.
function graphUnnestedNow() {
  return graphLoadLayout() === 'hierarchy' ? graphLoadOptions().unnested : null;
}

// The cards the Hierarchy leaves out of the Graph under Unnested off, for the ones
// that decide what the Graph shows (graphVisibleIds); null when nothing is left out.
function graphLeftOut(pool) {
  if (graphUnnestedNow() !== 'off') return null;
  return graphUnnestedIds(pool, { ctx: nestingCtx(), hierarchy: state.hierarchy });
}

function resetGraphViewState() {
  graphLayoutKind = null;
  graphDepsSwitch = null;
  graphLanesSwitch = null;
  graphStatusFilter = null;
  graphFanOptions = null;
  graphRefitNext = false;
  graphViews.clear();
  graphCur = null;
  if (graphPan && graphPan.moved) isDragging = false;
  graphPan = null;
  graphEndPinch(false);
  graphLastPoint = null;
  graphTouch = null;
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

// One segmented control: an option's label, then a button for each of its values, in the markup the
// fan's options and the Flow's switches share. A button names its option (`key`) and value as the
// fan's do, so a press hands focus back to the button the redraw builds (keepControlFocus); the
// click handler tells the options apart by the key (deps, lanes, or one of the fan's).
function graphBuildSwitch(def, key, values, current) {
  const group = document.createElement('span');
  group.className = 'graph-option';
  group.title = def.hint;
  const label = document.createElement('span');
  label.className = 'graph-option-label';
  label.textContent = def.label;
  group.appendChild(label);
  const seg = document.createElement('span');
  seg.className = 'graph-option-seg';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', def.label);
  for (const value of values) {
    const on = Array.isArray(current) ? current.includes(value) : current === value;
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
  return group;
}

// The fan's option row: one segmented control for each option in the model's table, always
// shown, since the panel it stands in is what hides it. Every control keeps the
// selection and none holds the poll: a press rebuilds the row and hands focus back to the
// control (keepControlFocus), the way a status pill does. The row is only for the Hierarchy.
function graphBuildOptionsRow(options) {
  const row = document.createElement('div');
  row.className = 'graph-options';
  row.dataset.keepsSelection = '';
  for (const key of Object.keys(GRAPH_FAN_OPTION_VALUES)) {
    row.appendChild(graphBuildSwitch(GRAPH_FAN_OPTION_LABELS[key], key, GRAPH_FAN_OPTION_VALUES[key], options[key]));
  }
  return row;
}

// The Flow's option row: the Dependencies and Lanes switches, kept per board.
function graphBuildFlowRow(deps, lanes) {
  const row = document.createElement('div');
  row.className = 'graph-options graph-flow-options';
  row.dataset.keepsSelection = '';
  row.appendChild(graphBuildSwitch(GRAPH_FLOW_DEPS_LABEL, 'deps', GRAPH_FLOW_DEPS, deps));
  row.appendChild(graphBuildSwitch(GRAPH_FLOW_LANES_LABEL, 'lanes', ['off', 'on'], lanes ? 'on' : 'off'));
  return row;
}

// The On hover section: the six sets as toggles in two columns, any mix, the choice of this kind of Graph
// (hover-show.js; HOVER_SHOW_GRID is the order they stand in).
// A press edits the one choice the search panel's boxes edit (hoverShowPick, hover-show-ui.js), which
// hands the buttons their new state without a redraw.
function graphBuildHoverRow(kind) {
  const row = document.createElement('div');
  row.className = 'graph-hover-options';
  row.dataset.keepsSelection = '';
  row.appendChild(graphBuildSwitch(GRAPH_HOVER_LABEL, 'hover', HOVER_SHOW_GRID, hoverShowLoad()[hoverShowGraph('graph', kind)]));
  return row;
}

// The option panel's contents (app.js builds the panel itself): the Hierarchy | Flow choice, the zoom,
// then for Hierarchy the option row of the tier fan and for Flow the Flow's switches, then On hover for
// both. These stood in the top row of the view before.
function graphBuildPanel(kind, fan, deps, lanes) {
  const panel = buildViewPanel('graph', 'Graph options');
  const kinds = document.createElement('div');
  kinds.className = 'graph-kinds';
  for (const k of GRAPH_KINDS) {
    const b = graphButton('graph-kind-btn', k === 'flow' ? 'Flow' : 'Hierarchy', GRAPH_KIND_TITLES[k], { graphKind: k });
    b.setAttribute('aria-pressed', String(k === kind));
    kinds.appendChild(b);
  }
  panel.appendChild(kinds);
  const zoom = document.createElement('div');
  zoom.className = 'graph-zoom';
  zoom.appendChild(graphButton('graph-zoom-btn', '−', 'Zoom out', { graphAction: 'out' }));
  zoom.appendChild(graphButton('graph-zoom-btn', '+', 'Zoom in', { graphAction: 'in' }));
  zoom.appendChild(graphButton('graph-zoom-btn', 'Fit', 'Fit every card in the panel', { graphAction: 'fit' }));
  panel.appendChild(zoom);
  if (fan) panel.appendChild(graphBuildOptionsRow(fan.options));
  if (kind === 'flow') panel.appendChild(graphBuildFlowRow(deps, lanes));
  panel.appendChild(graphBuildHoverRow(kind));
  return panel;
}

// The view's own top: the (i) button and the panel's button float in the drawing's top-right corner;
// the card count and the key stay in the DOM, hidden by a class until the (i) is pressed.
function graphBuildControls(cardCount, relationCount, fan, panelOpen) {
  const frag = document.createDocumentFragment();
  const infoOn = graphInfoOn();
  const row = document.createElement('div');
  row.className = 'graph-controls';
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 'graph-info-toggle graph-control';
  info.dataset.keepsSelection = '';
  info.dataset.graphInfo = '';
  info.textContent = 'i';
  info.title = 'Show or hide the card count and the key';
  info.setAttribute('aria-label', 'Card count and key');
  info.setAttribute('aria-pressed', String(infoOn));
  row.appendChild(info);
  row.appendChild(buildViewPanelToggle('graph', 'Show or hide the graph choice, the zoom and the options', panelOpen));
  frag.appendChild(row);
  const box = document.createElement('div');
  box.className = infoOn ? 'graph-info' : 'graph-info graph-info-off';
  const count = document.createElement('span');
  count.className = 'graph-count';
  count.textContent = `${graphPlural(cardCount, 'card')}, ${graphPlural(relationCount, 'relation')}`;
  box.appendChild(count);
  const key = document.createElement('p');
  key.className = 'graph-key';
  key.textContent = fan ? `${GRAPH_KEY} · l steps the names: ${fan.options.names}` : GRAPH_KEY;
  box.appendChild(key);
  frag.appendChild(box);
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

// Fit frames the cards' bounds with a margin of GRAPH_FIT_PAD. A name outside the fan's rim keeps its
// size on screen and has no room of its own on the stage, so on a fan with names the margin grows
// by what the furthest name stands out of the stage: the names are placed once at the fit's zoom, how
// far each is past the stage's edge (less GRAPH_FIT_NAMES_MARGIN) is measured, and only when one is
// out is the fit worked out again with that much more margin. A fit whose names all stand inside is
// the plain fit, and a refit places the names once more than the plain one did, never again.
const GRAPH_FIT_PAD = 60;
const GRAPH_FIT_NAMES_MARGIN = 6;

function graphFrameFit(c) {
  const b = c.layout.bounds;
  const fit = graphFit(b, c.w, c.h, GRAPH_FIT_PAD);
  if (c.kind !== 'hierarchy') return fit;
  const kept = { x: c.view.x, y: c.view.y, k: c.view.k };
  Object.assign(c.view, fit);
  graphPaintNames();
  Object.assign(c.view, kept);
  if (!c.names || !c.names.placed.size) return fit;
  const m = GRAPH_FIT_NAMES_MARGIN;
  let over = 0;
  for (const p of c.names.placed.values()) {
    over = Math.max(over, m - (fit.x + p.box.x0 * fit.k), fit.x + p.box.x1 * fit.k - (c.w - m), m - (fit.y + p.box.y0 * fit.k), fit.y + p.box.y1 * fit.k - (c.h - m));
  }
  if (over <= 0) return fit;
  return graphFit(b, c.w, c.h, Math.min(GRAPH_FIT_PAD + over, Math.min(c.w, c.h) / 4));
}

function graphFitNow() {
  if (!graphCur) return;
  Object.assign(graphCur.view, graphFrameFit(graphCur), { touched: false });
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
  for (const id of lit.nodes) {
    for (const el of [graphCur.nodeEls.get(id), ...(graphCur.headEls.get(id) || [])]) el.classList.add('graph-near');
  }
  for (const i of lit.links) graphCur.linkEls[i].classList.add('graph-near');
}

// The pointer or keyboard focus on a card: the sets the search panel's "On hover show" ticks for this
// kind of Graph (hoverSetOf, hover-show-ui.js), lit with the rest dimmed. With none ticked the hover
// lights nothing and the lighting of the selection stays.
function graphSetFocus(id) {
  if (!graphCur || id == null || !graphCur.model.byId.has(id)) { graphClearFocus(); return; }
  const lit = graphLit(graphCur.model, hoverSetOf(id), graphCur.lines);
  if (lit) graphLightCards(lit);
  else graphRestFocus();
}

// The Flow draws the dependencies alone, so a lone card picked there lights with the cards those join to it.
function graphLinkKind() {
  return graphCur && graphCur.kind === 'flow' ? 'wait' : undefined;
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
  graphLightCards(graphRestLit(graphCur.model, { selectedIds, loneCardId: graphLoneCardId(), linkKind: graphLinkKind() }, graphCur.lines));
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
  if (!graphCur || graphCur.kind !== 'hierarchy' || !graphCur.nameEls.size) {
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
  const names = graphCur && graphCur.kind === 'hierarchy' ? graphCur.names : null;
  if (!names || names.k === graphCur.view.k || !(names.placed.size || names.unnamed.length)) return;
  clearTimeout(graphNamesTimer);
  graphNamesTimer = setTimeout(graphPaintNames, GRAPH_NAMES_SETTLE_MS);
}

function graphPaintSelection() {
  if (!graphCur) return;
  for (const [nid, el] of graphCur.nodeEls) el.classList.toggle('selected', selectedIds.has(nid));
  for (const [nid, els] of graphCur.headEls) for (const h of els) h.classList.toggle('selected', paintsSelected(nid));
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
  const before = selectionState.selection;
  selectByClick(action, id);
  // With isolate off the box shows the selection the click made (mirrorSelectionInBox), its cut
  // kept: the Graph keeps drawing what the cut hides, so the painting in place stays true. While
  // isolated the box holds the isolate text, which a click never writes: it moves the anchor only.
  if (boxMirrorsSelection()) mirrorSelectionInBox(before, false);
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
  for (const g of plan.guides) world.appendChild(fixed(graphEl('path', { d: g.d }, g.cls)));
  for (const r of plan.flow.rects) world.appendChild(fixed(graphEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 4 }, r.cls)));
  for (const t of plan.flow.texts) {
    const el = graphEl('text', { x: t.x, y: t.y, 'text-anchor': t.anchor }, t.cls);
    el.textContent = t.text;
    world.appendChild(el);
  }
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
  // A lane's header is its card's node: it wears the dot's classes (graph-node, card-el) and its data-id,
  // so every handler that finds a `.graph-node` (click, double click, Enter, Space, hover, focus) and the
  // card menu take it for that card. Drawn after the links and before the dots, so a dot wins where the two
  // meet. Its text stays one size at any zoom (graphView sets --graph-k), and the type's mark takes its
  // colour once the Graph is on the page (paintTypeColors). graphCur.headEls holds them by card, to light
  // and select them with the dots.
  const headEls = new Map();
  for (const h of plan.flow.heads) {
    const cls = `graph-node card-el graph-flow-lane-head${paintsSelected(h.id) ? ' selected' : ''}${isHoverHighlighted(hoverLit, h.id) ? ' hover-highlight' : ''}`;
    const g = graphEl('g', { transform: `translate(${h.x} ${h.y})`, tabindex: 0 }, cls);
    g.setAttribute('data-id', String(h.id));
    const tip = graphEl('title');
    tip.textContent = h.title;
    g.appendChild(tip);
    const inner = graphEl('g', {}, 'graph-flow-lanehead-in');
    if (h.icon) {
      const mark = graphEl('path', { d: h.icon.d, transform: 'translate(7 -4)' }, 'graph-flow-icon');
      if (h.icon.color) mark.setAttribute('data-type-color', h.icon.color);
      inner.appendChild(mark);
    }
    const text = graphEl('text', { x: h.icon ? 20 : 0, y: 0 }, 'graph-flow-lanehead-text');
    text.textContent = h.text;
    inner.appendChild(text);
    g.appendChild(inner);
    world.appendChild(g);
    if (!headEls.has(h.id)) headEls.set(h.id, []);
    headEls.get(h.id).push(g);
  }
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
  stage.appendChild(svg);
  const tip = graphBuildTip();
  stage.appendChild(tip);
  return { stage, svg, world, arrow, linkEls, nodeEls, headEls, nameEls, tip };
}

function renderGraphView() {
  const host = document.getElementById('graph-view');
  let kind, filter, fanOptions, deps, lanes, model, layout, layoutOpts, plan, sig;
  const panelMoved = graphRefitNext;
  graphRefitNext = false;
  try {
    kind = graphLoadLayout();
    filter = graphLoadFilter();
    fanOptions = kind === 'hierarchy' ? graphLoadOptions() : null;
    const pool = state.active.concat(state.archived);
    const visibleIds = graphVisibleIds(pool, currentGraphQueryEffect().visibleIds, filter, boardStatuses());
    model = graphBuild(pool, {
      ctx: nestingCtx(), visibleIds, types: state.types, hierarchy: state.hierarchy, unnested: graphUnnestedNow(),
    });
    deps = kind === 'flow' ? graphLoadDeps() : null;
    lanes = kind === 'flow' ? graphLoadLanes() : null;
    layoutOpts = { statuses: boardStatuses(), order: fanOptions && fanOptions.order, unnested: fanOptions && fanOptions.unnested, deps, lanes };
    layout = graphLayout(model, kind, layoutOpts);
    sig = graphSignature(model, kind, layoutOpts);
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
  graphWriteAddress();
  host.textContent = '';
  graphCur = null;

  const panelOpen = viewPanelIsOpen('graph');
  const fan = fanOptions && { options: fanOptions };
  const main = document.createElement('div');
  main.className = 'graph-main';
  host.appendChild(main);
  if (panelOpen) host.appendChild(graphBuildPanel(kind, fan, deps, lanes));
  main.appendChild(graphBuildControls(model.nodes.length, model.links.length, fan, panelOpen));
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
  if (kind === 'flow') drawn.svg.classList.add(`graph-flow-${deps}`);
  let view = graphViews.get(kind);
  const refit = !view || ((view.sig !== sig || panelMoved) && !view.touched);
  if (!view) {
    view = { x: 0, y: 0, k: 1, sig, touched: false };
    graphViews.set(kind, view);
  }
  view.sig = sig;
  graphCur = {
    kind, sig, model, layout, plan, view, w, h, nodeCount: plan.nodes.length, lines: plan.links,
    svg: drawn.svg, world: drawn.world, arrow: drawn.arrow, linkEls: drawn.linkEls, nodeEls: drawn.nodeEls, headEls: drawn.headEls, nameEls: drawn.nameEls, names: null, tip: drawn.tip, tipFor: null,
  };
  if (refit) Object.assign(view, graphFrameFit(graphCur), { touched: false });
  graphPaintNames();
  graphApplyTransform();
  graphSettleFocus();
}

// --- wiring --------------------------------------------------------------------

// The element of card `id` in the Graph's `root` that is the kind `from`, the element that had the
// focus, was. A Flow lane's header is a second element of its card beside the dot, so a header is found
// again as a header and a dot as a dot.
function graphCardEl(root, id, from) {
  const head = !!(from && from.classList && from.classList.contains('graph-flow-lane-head'));
  return root.querySelector(`.card-el[data-id="${id}"]${head ? '.graph-flow-lane-head' : ':not(.graph-flow-lane-head)'}`);
}

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

// --- two-finger pinch ----------------------------------------------------------
// A second finger on the Graph ends the one-finger pan and starts a pinch. Each move zooms by
// the running factor (the fingers' distance against the distance when the second one landed,
// map-zoom.js) around their midpoint. isDragging holds the refresh for the whole gesture and
// every exit (a lift, pointercancel, lostpointercapture) goes through graphEndPinch.

function graphPinchPoints() {
  const rect = graphCur.svg.getBoundingClientRect();
  const [a, b] = graphPinch.ids.map((id) => graphPinch.points.get(id));
  return [{ x: a.x - rect.left, y: a.y - rect.top }, { x: b.x - rect.left, y: b.y - rect.top }];
}

function graphStartPinch(e, host, touch) {
  const first = touch ? touch.id : graphPan.pointerId;
  const firstPoint = touch || (graphLastPoint && graphLastPoint.id === first ? graphLastPoint : { x: graphPan.sx, y: graphPan.sy });
  graphFinishPan();
  graphPinch = {
    ids: [first, e.pointerId],
    points: new Map([[first, { x: firstPoint.x, y: firstPoint.y }], [e.pointerId, { x: e.clientX, y: e.clientY }]]),
    startDistance: 0, startK: graphCur.view.k,
  };
  const [a, b] = graphPinchPoints();
  graphPinch.startDistance = pinchDistance(a, b);
  isDragging = true;
  graphCur.svg.classList.add('graph-panning');
  try { host.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers can't be captured */ }
}

function graphPinchMove(e) {
  if (!graphPinch || !graphCur || !graphPinch.points.has(e.pointerId)) return;
  graphPinch.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const [a, b] = graphPinchPoints();
  const want = pinchFactor(graphPinch.startDistance, pinchDistance(a, b)) * graphPinch.startK;
  const step = want / graphCur.view.k;
  if (!pinchFactorIsChange(step)) return;
  const mid = pinchMidpoint(a, b);
  graphZoomBy(step, mid.x, mid.y);
}

function graphEndPinch(swallow) {
  if (!graphPinch) return;
  graphPinch = null;
  isDragging = false;
  if (graphCur) graphCur.svg.classList.remove('graph-panning');
  if (swallow) graphSwallowNextClick();
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
    const infoBtn = e.target.closest('.graph-info-toggle');
    if (infoBtn) { keepControlFocus(infoBtn, () => { graphInfoSet(!graphInfoOn()); renderGraphView(); }); return; }
    const option = e.target.closest('.graph-option-btn[data-key][data-val]');
    if (option && option.dataset.key === 'hover') {
      hoverShowPick(option.dataset.val, !hoverShowKindsNow().includes(option.dataset.val));
      return;
    }
    if (option) {
      keepControlFocus(option, () => (option.dataset.key === 'deps' ? graphSetDeps(option.dataset.val) : option.dataset.key === 'lanes' ? graphSetLanes(option.dataset.val) : graphSetOption(option.dataset.key, option.dataset.val)));
      return;
    }
    const kindBtn = e.target.closest('.graph-kind-btn[data-graph-kind]');
    if (kindBtn) { graphSetLayoutKind(kindBtn.dataset.graphKind); return; }
    const zoomBtn = e.target.closest('.graph-zoom-btn[data-graph-action]');
    if (!zoomBtn || !graphCur) return;
    const action = zoomBtn.dataset.graphAction;
    if (action === 'fit') graphFitNow();
    else graphZoomBy(action === 'in' ? GRAPH_BUTTON_ZOOM : 1 / GRAPH_BUTTON_ZOOM, graphCur.w / 2, graphCur.h / 2);
    zoomBtn.blur();
  });
  host.addEventListener('wheel', (e) => {
    if (!graphCur || !e.target.closest('.graph-stage')) return;
    e.preventDefault();
    const rect = graphCur.svg.getBoundingClientRect();
    graphZoomBy(e.deltaY < 0 ? GRAPH_ZOOM_STEP : 1 / GRAPH_ZOOM_STEP, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !graphCur) return;
    if (graphPinch) return;
    if (graphPan && e.pointerId !== graphPan.pointerId && e.target.closest('.graph-canvas')) { graphStartPinch(e, host); return; }
    if (!graphPan && graphTouch && e.isPrimary === false && e.pointerId !== graphTouch.id && e.target.closest('.graph-canvas')) { graphStartPinch(e, host, graphTouch); return; }
    if (e.isPrimary !== false) graphTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (e.target.closest('.graph-node')) return;
    if (graphPan) return;
    if (!e.target.closest('.graph-canvas') || e.target.closest('.card-el')) return;
    const v = graphCur.view;
    graphPan = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false };
    try { host.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers can't be captured */ }
  });
  host.addEventListener('pointermove', (e) => {
    if (graphTouch && e.pointerId === graphTouch.id) { graphTouch.x = e.clientX; graphTouch.y = e.clientY; }
    if (graphPan && e.pointerId === graphPan.pointerId) graphLastPoint = { id: e.pointerId, x: e.clientX, y: e.clientY };
    if (graphPinch) { graphPinchMove(e); return; }
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
  const finish = (e) => {
    if (graphTouch && graphTouch.id === e.pointerId) graphTouch = null;
    if (graphPinch && graphPinch.points.has(e.pointerId)) graphEndPinch(true);
    if (graphPan && e.pointerId === graphPan.pointerId) graphFinishPan();
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
    const node = e.target.closest('.graph-node');
    if (!node) return;
    if (hotkeySpace(e) === 'select') { e.preventDefault(); graphClickNode(node.dataset.id, {}); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) openCard(node.dataset.id); }
  });

  const enter = (e) => {
    const el = e.target.closest('.graph-node');
    if (!el) return;
    if (e.type === 'focusin' && searchEnterFocusedId === el.dataset.id) return; // the focus Enter in the search box gave: the search's lights stay
    searchEnterFocusedId = null;
    graphSetFocus(el.dataset.id);
  };
  const leave = (e) => {
    if (e.type === 'focusout' && e.relatedTarget) searchEnterFocusedId = null; // focus moved on to something else
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
// the search panel is not one of those. It acts only while the Graph shows the Hierarchy, the one
// graph with names. A chord (Ctrl, Cmd, Alt), Shift on the key and a held key are not it;
// Caps Lock gives a capital N with no Shift, and counts. An option that has focus is
// rebuilt by the redraw, so it gets focus back, as after a press.
function onGraphNamesKey(e) {
  if (!e.key || e.key.toLowerCase() !== 'l' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (keyGuardOff(document)) return;
  if (loadViewMode() !== 'graph' || graphLoadLayout() !== 'hierarchy') return;
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
