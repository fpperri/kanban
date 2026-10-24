'use strict';
const state = { active: [], archived: [], projectName: '', boardDir: '', notifications: [], priorities: [], tags: [], statuses: [], assignees: [], types: [], hierarchy: [], typesOn: true, pills: [], archivePackages: [], logbook: null, todos: null, groups: null, scratchpad: null, iterations: false, settings: null }; // logbook seeded null (the board keeps none until a payload says so); hierarchy and pills seeded empty — slices, the tier fan and the pill row read them before the first /api/board response lands. assignees seeded empty — renderBoard's Assignee sort reads it before the first /api/board response lands. boardDir seeded empty — copyBoardPath toasts honestly on a pre-first-poll click.

const $ = (sel) => document.querySelector(sel);

// --- Dynamic columns: the live columns come from config.yaml's
// `statuses` list (via /api/board), the built-in four when unconfigured.
// column-state.js owns the pure rules (columnIdsFor/columnForStatus/
// columnLabel); status-colors.js owns the color rules (built-in four keep
// their exact palette, custom names hash into a fixed 8-color palette).
function boardStatuses() {
  return liveStatuses(state.statuses); // built-in four when unconfigured; a stray 'archive' entry is dropped
}

function boardColumnIds() {
  return columnIdsFor(state.statuses);
}

// Statuses arrive on every board payload. A changed list changes the COLUMN
// KEY SET, so the memoized collapse/sort states (merged against the old keys)
// must re-merge — same invalidation discipline as applyProjectName below.
function applyStatuses(list) {
  const next = Array.isArray(list) ? list : [];
  if (JSON.stringify(next) === JSON.stringify(state.statuses)) return;
  state.statuses = next;
  collapsedColumns = null;
  columnSort = null;
  columnSortPicks = null;
  mapStatusFilter = null; // keyed by the same column set
  ganttStatusFilter = null; // keyed by the LIVE statuses (no archive), same invalidation rule
  calendarStatusFilter = null; // same LIVE-statuses key as the gantt's
  resetGraphViewState(); // the graph's per-board memos too
}

// column-state.js provides DEFAULT_STATUSES / columnIdsFor / columnForStatus /
// columnLabel / storageKey / mergeCollapsedState as bare globals (same dual-environment
// pattern as refresh-policy.js). Collapse state loads once from localStorage
// per page load and is mutated in place, so every renderBoard() call — manual,
// drag-driven, or the 5s auto-refresh poll — reads the same in-memory object
// and the collapsed/expanded layout never resets itself mid-session.
let collapsedColumns = null;

function loadCollapsedColumns() {
  if (collapsedColumns) return collapsedColumns;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'columns.collapsed'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults
  collapsedColumns = mergeCollapsedState(saved, boardColumnIds()); // merge against the board's current column set
  return collapsedColumns;
}

function saveCollapsedColumns() {
  try { localStorage.setItem(storageKey(state.projectName, 'columns.collapsed'), JSON.stringify(collapsedColumns)); }
  catch (e) { /* storage unavailable/full — collapse state just won't persist this session */ }
}

// The phone Board's status tab: one status at a time, remembered per board (feature
// 'columns.phone', the same storageKey pattern as the collapse state). Loaded once and reset with
// the other per-board caches when the board's name arrives.
let phoneColumn = null;

function loadPhoneColumn() {
  if (phoneColumn !== null) return phoneColumn;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'columns.phone')); }
  catch (e) { saved = null; }
  phoneColumn = saved || '';
  return phoneColumn;
}

function setPhoneColumn(col) {
  phoneColumn = col;
  try { localStorage.setItem(storageKey(state.projectName, 'columns.phone'), col); }
  catch (e) { /* storage unavailable/full — the tab just won't persist this session */ }
}

// The one MediaQueryList for the width line, made on first use: a card asks per card, so a list per
// ask would be one per tile drawn.
let phoneWidthList = null;
function phoneWidthMedia() {
  if (!phoneWidthList && window.matchMedia) phoneWidthList = window.matchMedia(PHONE_WIDTH_QUERY);
  return phoneWidthList;
}

function onPhoneLayout() {
  const list = phoneWidthMedia();
  return !!(list && list.matches);
}

// A sideways swipe on the phone Board moves to the neighbouring status. The listeners are passive
// (the browser keeps scrolling and pinch-zooming); a second finger, a drag in progress or a layout
// above the width line leaves the gesture alone.
function wireBoardSwipe(board) {
  let start = null;
  board.addEventListener('touchstart', (e) => {
    const t = e.changedTouches && e.changedTouches[0];
    start = t && e.touches && e.touches.length === 1 && onPhoneLayout() && !isDragging ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
  }, { passive: true });
  board.addEventListener('touchend', (e) => {
    const from = start;
    start = null;
    const t = e.changedTouches && e.changedTouches[0];
    if (!from || !t || isDragging || !onPhoneLayout()) return;
    const direction = swipeDirection(t.clientX - from.x, t.clientY - from.y, e.timeStamp - from.at);
    if (!direction) return;
    const statuses = boardStatuses();
    const active = activePhoneColumn(loadPhoneColumn(), statuses);
    const next = neighbourPhoneColumn(statuses, active, direction);
    if (next === active) return;
    setPhoneColumn(next);
    renderBoard();
  }, { passive: true });
  board.addEventListener('touchcancel', () => { start = null; }, { passive: true });
}

function toggleColumn(col) {
  const collapsed = loadCollapsedColumns();
  collapsed[col] = !collapsed[col];
  saveCollapsedColumns();
  renderBoard();
}

// column-sort.js provides SORT_FIELDS / SORT_FIELD_LABELS / DEFAULT_SORT /
// DEFAULT_SORT_DIRECTION / mergeSortState / compareCards / sortCards as bare
// globals (same dual-environment pattern). Loaded once from
// localStorage per page load and mutated in place — same discipline as
// collapsedColumns above — so the chosen sort survives every renderBoard()
// call (manual, drag, poll, toggle, search) without re-reading storage.
let columnSort = null;
// Only what the user picked is stored: the default depends on the cards
// (outline order once any card has a rank or a parent), so it must not be
// written down as if chosen. columnSort is rebuilt when that flips.
let columnSortPicks = null;
let columnSortNested = false;

function boardIsNested() {
  return hasNesting(state.active.concat(state.archived));
}

function loadColumnSort() {
  const nested = boardIsNested();
  if (columnSort && nested === columnSortNested) return columnSort;
  if (!columnSortPicks) {
    let saved = null;
    try {
      const raw = localStorage.getItem(storageKey(state.projectName, 'columns.sort'));
      if (raw) saved = JSON.parse(raw);
    } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults
    columnSortPicks = readSortPicks(saved, boardColumnIds());
  }
  columnSortNested = nested;
  columnSort = mergeSortState(columnSortPicks, boardColumnIds(), { nested }); // merge against the board's current column set
  return columnSort;
}

function saveColumnSort() {
  try { localStorage.setItem(storageKey(state.projectName, 'columns.sort'), JSON.stringify({ picked: columnSortPicks })); }
  catch (e) { /* storage unavailable/full — sort choice just won't persist this session */ }
}

// Changing the field resets direction to that field's natural default
// (id/due -> asc, priority -> desc/High-first, modified -> desc/newest-first,
// assignee -> asc/registry-order) rather than keeping whatever
// direction the previous field happened to be on.
function pickSort(col, entry) {
  loadColumnSort()[col] = entry;
  columnSortPicks[col] = Object.assign({}, entry);
  saveColumnSort();
  renderBoard();
}

function setColumnSortField(col, field) {
  if (!SORT_FIELDS.includes(field)) return;
  pickSort(col, { field, direction: DEFAULT_SORT_DIRECTION[field] });
}

function toggleColumnSortDirection(col) {
  const current = loadColumnSort()[col];
  pickSort(col, { field: current.field, direction: current.direction === 'asc' ? 'desc' : 'asc' });
}

// Which columns' cards the MAP shows — one toggle per column
// (statuses in column order + archive, the location pseudo-column). Pure
// rules (defaults/merge/card→toggle mapping) live in column-state.js; same
// memoize-once-mutate-in-place discipline as collapsedColumns/columnSort
// above, own feature key, so the choice survives every renderBoard() call
// (manual, poll, drag, toggle, search) and page reloads, per board.
let mapStatusFilter = null;

function loadMapStatusFilter() {
  if (mapStatusFilter) return mapStatusFilter;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'map.statusFilter'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to all-ON
  mapStatusFilter = mergeMapStatusFilter(saved, boardColumnIds()); // merge against the board's current column set, same as collapse/sort
  return mapStatusFilter;
}

function saveMapStatusFilter() {
  try { localStorage.setItem(storageKey(state.projectName, 'map.statusFilter'), JSON.stringify(mapStatusFilter)); }
  catch (e) { /* storage unavailable/full — filter choice just won't persist this session */ }
}

function toggleMapStatusFilter(col) {
  const filter = loadMapStatusFilter();
  if (!(col in filter)) return; // stale data-col from a column set that just changed under the row — ignore
  filter[col] = !filter[col];
  saveMapStatusFilter();
  renderBoard();
}

// Right-click SOLO — that pill on, every other off; right-click
// again on an already-soloed pill restores all ON ("viceversa"). The pure
// rule (soloStatusFilter, column-state.js) is shared by all three views;
// this wrapper mirrors toggleMapStatusFilter's load/mutate-in-place/save/
// render shape exactly.
function soloMapStatusFilter(col) {
  const filter = loadMapStatusFilter();
  Object.assign(filter, soloStatusFilter(filter, boardColumnIds(), col));
  saveMapStatusFilter();
  renderBoard();
}

// Which statuses the GANTT shows — one toggle per board status in
// column order, all ON by default, plus
// an Archive pseudo-pill, same id list as the map's
// row (boardColumnIds(): statuses + archive) — but DEFAULT OFF, unlike every
// live status and unlike the map's own Archive pill (always ON — the
// map has always included archived cards): the base gantt view must stay
// exactly live-only until a human opts in. That one different default is why
// this reuses mergeGanttStatusFilter (its own archive-off-by-default merge
// helper, column-state.js) rather than the map's mergeMapStatusFilter, which
// would default the archive key to true. Same memoize-once-mutate-in-place
// discipline as mapStatusFilter above, so the choice survives every
// renderGanttView() call (manual, poll, drag, toggle, search) and page
// reloads, per board.
let ganttStatusFilter = null;

function loadGanttStatusFilter() {
  if (ganttStatusFilter) return ganttStatusFilter;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'gantt.statusFilter'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults (archive OFF)
  ganttStatusFilter = mergeGanttStatusFilter(saved, boardColumnIds()); // statuses + archive, archive-off-by-default merge — a stale saved value with no 'archive' key fills in OFF, never ON
  return ganttStatusFilter;
}

function saveGanttStatusFilter() {
  try { localStorage.setItem(storageKey(state.projectName, 'gantt.statusFilter'), JSON.stringify(ganttStatusFilter)); }
  catch (e) { /* storage unavailable/full — filter choice just won't persist this session */ }
}

function toggleGanttStatusFilter(col) {
  const filter = loadGanttStatusFilter();
  if (!(col in filter)) return; // stale data-col from a status list that just changed under the row — ignore
  filter[col] = !filter[col];
  saveGanttStatusFilter();
  renderBoard();
}

// Right-click SOLO, gantt-scoped — same rule/shape as
// soloMapStatusFilter above, own filter + id list. The id
// list includes Archive (boardColumnIds), so soloing a status turns
// Archive off too (every-other-off), soloing Archive shows archived cards
// only, and right-clicking the already-soloed Archive pill restores all —
// soloStatusFilter is fully generic over its id list.
function soloGanttStatusFilter(col) {
  const filter = loadGanttStatusFilter();
  Object.assign(filter, soloStatusFilter(filter, boardColumnIds(), col));
  saveGanttStatusFilter();
  renderBoard();
}

// Which LIVE statuses the CALENDAR shows — one toggle per board
// status in column order, all ON by default, plus an Archive
// pseudo-pill, same id list as the gantt's row (boardColumnIds(): statuses +
// archive) and the same DEFAULT OFF as the gantt (not the map's always-ON):
// the base calendar view must stay exactly live-only until a human opts in.
// That default is why this reuses mergeGanttStatusFilter (its own
// archive-off-by-default merge helper, column-state.js), not the map's
// mergeMapStatusFilter (which would default the archive key to true). The
// calendar doesn't bucket cards into board columns any more than the gantt
// does (a chip renders off cardSchedule/dueMarker, not a column lookup), so
// it reuses ganttFilterVisibleIds verbatim (see renderCalendarMonthGrid/
// renderCalendarTimeGrid below) rather than growing a third near-identical
// visible-ids helper. Same memoize-once-mutate-in-place discipline as
// mapStatusFilter/ganttStatusFilter above, own feature key, so the choice
// survives every renderCalendarView() call (manual, poll, drag, toggle,
// search, sub-view switch) and page reloads, per board.
let calendarStatusFilter = null;

function loadCalendarStatusFilter() {
  if (calendarStatusFilter) return calendarStatusFilter;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'calendar.statusFilter'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults (archive OFF)
  calendarStatusFilter = mergeGanttStatusFilter(saved, boardColumnIds()); // statuses + archive, archive-off-by-default merge — a stale saved value with no 'archive' key fills in OFF, never ON
  return calendarStatusFilter;
}

function saveCalendarStatusFilter() {
  try { localStorage.setItem(storageKey(state.projectName, 'calendar.statusFilter'), JSON.stringify(calendarStatusFilter)); }
  catch (e) { /* storage unavailable/full — filter choice just won't persist this session */ }
}

function toggleCalendarStatusFilter(col) {
  const filter = loadCalendarStatusFilter();
  if (!(col in filter)) return; // stale data-col from a status list that just changed under the row — ignore
  filter[col] = !filter[col];
  saveCalendarStatusFilter();
  renderBoard();
}

// Right-click SOLO, calendar-scoped — same rule/shape as
// soloGanttStatusFilter above. The id list is boardColumnIds()
// (statuses + Archive), so soloing a status turns Archive off too, soloing
// Archive shows archived cards only, and right-clicking the already-soloed
// Archive pill restores all — soloStatusFilter is fully generic over
// its id list.
function soloCalendarStatusFilter(col) {
  const filter = loadCalendarStatusFilter();
  Object.assign(filter, soloStatusFilter(filter, boardColumnIds(), col));
  saveCalendarStatusFilter();
  renderBoard();
}

// Map section collapse — one boolean per section (the layered graph,
// the "No relations" list, the options row). column-state.js's MAP_SECTIONS/mergeMapSectionsCollapsed
// own the fixed key set (not a dynamic column set, unlike collapse/sort/
// status-filter above); same memoize-once-mutate-in-place discipline and own
// feature key, so a collapsed/expanded section survives every renderMapView()
// call (manual, poll, drag, toggle, search) and page reloads, per board.
let mapSectionsCollapsed = null;

function loadMapSectionsCollapsed() {
  if (mapSectionsCollapsed) return mapSectionsCollapsed;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'map.sections.collapsed'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to the defaults (options folded, the rest expanded)
  mapSectionsCollapsed = mergeMapSectionsCollapsed(saved);
  return mapSectionsCollapsed;
}

function saveMapSectionsCollapsed() {
  try { localStorage.setItem(storageKey(state.projectName, 'map.sections.collapsed'), JSON.stringify(mapSectionsCollapsed)); }
  catch (e) { /* storage unavailable/full — collapse choice just won't persist this session */ }
}

function toggleMapSection(key) {
  const sections = loadMapSectionsCollapsed();
  if (!(key in sections)) return; // defensive: an unrecognized data-section never crashes
  sections[key] = !sections[key];
  saveMapSectionsCollapsed();
  renderBoard();
}

// Map zoom — a single number (map-zoom.js's clampMapZoom range), not a
// per-column object like the state above, so load/save carry the value
// directly rather than merging a saved shape. Same memoize-once-mutate-
// in-place discipline and own feature key ('map.zoom' via storageKey), so
// the chosen zoom survives every renderMapView() call (manual, poll, drag,
// toggle, search) and page reloads, per board — same contract the status
// filter and section-collapse state above already give their own slice of
// map UI state. null (not yet loaded) is distinct from any legal zoom value
// (the range excludes 0), so the memoize check below can't mistake "loaded
// and it happens to be falsy" for "never loaded".
let mapZoom = null;

function loadMapZoom() {
  if (mapZoom !== null) return mapZoom;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'map.zoom'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to 100%
  mapZoom = clampMapZoom(typeof saved === 'number' ? saved : MAP_ZOOM_DEFAULT);
  return mapZoom;
}

function saveMapZoom() {
  try { localStorage.setItem(storageKey(state.projectName, 'map.zoom'), JSON.stringify(mapZoom)); }
  catch (e) { /* storage unavailable/full — zoom choice just won't persist this session */ }
}

// One 'map.options' object per board; mergeMapOptions reads a stale or
// hand-edited value as its default.
let mapOptions = null;

function loadMapOptions() {
  if (mapOptions) return mapOptions;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'map.options'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to the defaults
  mapOptions = mergeMapOptions(saved);
  return mapOptions;
}

function saveMapOptions() {
  try { localStorage.setItem(storageKey(state.projectName, 'map.options'), JSON.stringify(mapOptions)); }
  catch (e) { /* storage unavailable/full — the choice just won't persist this session */ }
}

function setMapOption(key, value) {
  const values = MAP_OPTION_VALUES[key];
  if (!values || !values.includes(value)) return;
  loadMapOptions()[key] = value;
  saveMapOptions();
  renderBoard();
}

// Sets + persists the zoom, but does NOT render — callers own the render
// (they usually need to compute a scroll offset against the NEW zoom's
// rendered size first, e.g. zoomMapAt below), and a bare setter here would
// invite a render before that offset is ready, flashing the old scroll
// position for one frame.
function setMapZoom(zoom) {
  mapZoom = clampMapZoom(zoom);
  saveMapZoom();
}

const CHEVRON_LEFT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
const CHEVRON_RIGHT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
// Same sparkle glyph as #modal-ai-btn (app.html) — reused
// here (not re-fetched from the DOM) for the column header's AI quick-create
// button and the board tile's empty-title prompt-fallback, so both read as
// the same "AI prompt" cue the modal's own toggle already established.
const AI_PROMPT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z"></path><path d="M19 15l0.8 2.2L22 18l-2.2 0.8L19 21l-0.8-2.2L16 18l2.2-0.8L19 15z"></path></svg>';

// modal-fullscreen.js provides MODAL_TYPES / DEFAULT_FULLSCREEN /
// mergeFullscreenState as bare globals (same dual-environment
// pattern as column-state.js/column-sort.js). Loaded once from localStorage
// per page load and mutated in place — same discipline as collapsedColumns/
// columnSort above — so the chosen fullscreen state survives every popup
// close/reopen and page reload. Neither modal is ever rebuilt by
// renderBoard() (both live outside #board, static in the HTML), and any open
// modal already blocks the 5s auto-refresh poll entirely (see
// autoRefreshSkipState below), so there's no re-render to survive mid-session
// either — the class applied by applyModalFullscreen() just stays put.
const FULLSCREEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
const EXIT_FULLSCREEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>';

// Registry mapping a type (matches modal-fullscreen.js's MODAL_TYPES) to its
// DOM handles. An entry is a selector or a function for each of:
//   btn        the toggle button;
//   backdrop   a .modal-backdrop popup, whose .modal is the panel and whose
//              hidden class says whether it is open; or, for a panel that is
//              no backdrop popup,
//   panel      the element that takes the fullscreen class, with
//   isOpen()   whether the type is the popup that is up;
// and, both optional,
//   locked()   true or false where the type has no choice (it is always, or
//              never, fullscreen there): the saved choice is not applied, the
//              button is hidden and the toggle does nothing; null otherwise;
//   onChange() called after the button or Alt+Enter toggled it.
// The first open type in the order below is the one Alt+Enter toggles.
const FULLSCREEN_MODALS = {
  // The notes palette draws above the card details, so it answers first.
  notes: { btn: () => notesUi.fsBtn, panel: () => notesUi.el, isOpen: () => notesOnTop(), locked: () => notesFullscreenLocked(), onChange: () => notesFullscreenChanged() },
  edit: { backdrop: '#modal', btn: '#modal-fullscreen-btn' },
  detail: { backdrop: '#detail-modal', btn: '#detail-fullscreen-btn' },
  bulkSingle: { backdrop: '#bulk-single', btn: '#bulk-single-fullscreen-btn' },
  bulkTags: { backdrop: '#bulk-tags', btn: '#bulk-tags-fullscreen-btn' },
  bulkSchedule: { backdrop: '#bulk-schedule', btn: '#bulk-schedule-fullscreen-btn' },
};
const fullscreenEl = (ref) => (typeof ref === 'function' ? ref() : $(ref));

let modalFullscreen = null;

function loadModalFullscreen() {
  if (modalFullscreen) return modalFullscreen;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'modal.fullscreen'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults
  modalFullscreen = mergeFullscreenState(saved);
  return modalFullscreen;
}

function saveModalFullscreen() {
  try { localStorage.setItem(storageKey(state.projectName, 'modal.fullscreen'), JSON.stringify(modalFullscreen)); }
  catch (e) { /* storage unavailable/full — fullscreen choice just won't persist this session */ }
}

// Sets a modal's DOM (class + button icon/tooltip/aria) to an explicit on/off
// value WITHOUT touching the persisted preference. Esc is not part of the
// fullscreen picture (Esc closes the popup outright, first press, fullscreen
// or not — see the document keydown handler below), so the only two callers
// are applyModalFullscreen (reflect the saved preference on every open)
// and toggleModalFullscreen (the button, which persists first and then calls
// this to update the DOM to match).
function setModalFullscreenVisual(type, on) {
  const cfg = FULLSCREEN_MODALS[type];
  if (!cfg) return;
  const btn = fullscreenEl(cfg.btn);
  const backdrop = cfg.backdrop && fullscreenEl(cfg.backdrop);
  const panel = cfg.panel ? fullscreenEl(cfg.panel) : backdrop && backdrop.querySelector('.modal');
  if (!panel || !btn) return;
  const locked = cfg.locked ? cfg.locked() : null;
  if (cfg.locked) btn.hidden = locked !== null;
  if (locked !== null) on = locked;
  panel.classList.toggle('fullscreen', on);
  btn.innerHTML = on ? EXIT_FULLSCREEN_ICON : FULLSCREEN_ICON;
  const label = on ? 'Exit full screen' : 'Expand to full screen';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(on));
}

// Applies the persisted preference to a modal's DOM — called every time a
// modal opens, so a popup that follows a poll/reopen/reload always renders in
// the state the user last explicitly chose via the toggle button.
function applyModalFullscreen(type) {
  setModalFullscreenVisual(type, !!loadModalFullscreen()[type]);
}

function toggleModalFullscreen(type) {
  const fs = loadModalFullscreen();
  const cfg = FULLSCREEN_MODALS[type];
  if (!(type in fs) || !cfg || (cfg.locked && cfg.locked() !== null)) return;
  fs[type] = !fs[type];
  saveModalFullscreen();
  applyModalFullscreen(type);
  if (cfg.onChange) cfg.onChange();
}

// The fullscreen-capable popup currently open, if any (the Alt+Enter
// hotkey needs a target). At most one .modal-backdrop is ever visible at a
// time, so first match wins; the notifications popup isn't in the registry
// and correctly yields null.
function openFullscreenModalType() {
  for (const type of Object.keys(FULLSCREEN_MODALS)) {
    const cfg = FULLSCREEN_MODALS[type];
    if (cfg.isOpen) {
      if (cfg.isOpen()) return type;
      continue;
    }
    const backdrop = fullscreenEl(cfg.backdrop);
    if (backdrop && !backdrop.classList.contains('hidden')) return type;
  }
  return null;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  let json = null;
  if (isJson && text) {
    try { json = JSON.parse(text); } catch (e) { json = null; } // malformed JSON body falls back to status+text below
  }
  if (!res.ok) {
    const msg = (json && json.error) || `${res.status} — ${text || res.statusText}`;
    throw Object.assign(new Error(msg), { status: res.status, data: json });
  }
  return json;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3500);
}

// Waiting (derived from waiting_for) and blocked (the manual
// sticker) are distinct words with distinct predicates — both live in
// waiting-blocked.js (bare globals here); these are the board-state wrappers.
// Waiting is location-independent: deps resolve against active + archived.
function waitingOn(card) {
  if (!card.waiting_for.length) return [];
  const byId = new Map(state.active.concat(state.archived).map((c) => [c.id, c]));
  return unresolvedWaits(card.waiting_for, byId);
}

function isWaiting(card) {
  return waitingOn(card).length > 0;
}

// The doing entry gate's combined client-side pre-check (server also
// enforces): refused while waiting OR blocked.
function refusesDoing(card) {
  return isWaiting(card) || isBlockedValue(card.blocked);
}

// Names WHICH gate refused, for per-card skip toasts.
function refusalWord(card) {
  return isWaiting(card) ? 'waiting' : 'blocked';
}

// Turn a 422 payload (server gate refusal) into the human sentence fragment:
// "waiting on #3 (todo), #4 (backlog)" or "blocked: <reason>". The server's
// own error message already carries the right wording for both cases; the
// waiting branch is rebuilt here only so the shape stays pinned client-side.
function gate422Text(data) {
  if (data && data.waiting) return `waiting on ${data.waiting.map((w) => `#${w.id} (${w.status})`).join(', ')}`;
  return (data && data.error) || 'blocked';
}

// assigneeBadge() can't write a reserved custom color as an inline-style
// HTML attribute string — a strict `style-src 'self'` CSP (no unsafe-inline)
// blocks the browser from applying one at all, the same CSP trap
// status-colors.js's own dots guard against. It instead marks the
// `.card-assignee` span itself with `data-assignee-color`; this small CSSOM
// pass (never a string attribute, exactly the exception status-colors.js
// documents) paints the text color after the innerHTML above lands. The
// common case — no reserved colors configured — never touches this at all:
// the hashed handle already carries an `.assignee-text--palette-N` class
// with its color baked into app.css.
function paintAssigneeColors(root) {
  root.querySelectorAll('[data-assignee-color]').forEach((el) => {
    el.style.color = el.dataset.assigneeColor;
  });
}

// typeBadge() marks a configured chip color with `data-type-color` (free-form
// value, so no class and no style attribute under the CSP); paint it here once
// the HTML has landed. Colorless types never carry the attribute and stay neutral.
function paintTypeColors(root) {
  root.querySelectorAll('[data-type-color]').forEach((el) => {
    el.style.color = el.dataset.typeColor;
    el.style.borderColor = el.dataset.typeColor;
  });
}

// The tile's date stack (kanban.proj#260): one line per literal start/end/due
// field the card carries, via column-sort.js's scheduleRows — glyph/text/
// overdue per row, missing fields producing no row rather than a blank one.
// Shared by cardEl and archiveCardEl; the archived case just never lands an
// overdue row, since isOverdue() already retires archived cards on its own.
function scheduleBlockHtml(card) {
  const rows = scheduleRows(card, localTodayStr());
  if (!rows.length) return '';
  // The glyph rides its own fixed-width span: ⇤/⇥ and ⚑ come from different
  // fallback faces and measure ~1.6px apart, so without it the three dates
  // don't line up in the column they're stacked into.
  const rowsHtml = rows.map((r) =>
    `<div class="card-schedule-row${r.overdue ? ' overdue' : ''}"${r.overdue ? ' title="Past due"' : ''}>` +
      `<span class="card-schedule-glyph">${r.glyph}</span>${escapeHtml(r.text)}</div>`
  ).join('');
  return `<div class="card-schedule">${rowsHtml}</div>`;
}

// assigneeBadge/escapeHtml come from assignee-badge.js (bare globals, same
// dual-environment pattern as refresh-policy.js/column-state.js).
// Every card-representing element in every view carries `card-el` +
// data-id — the shared contract the document-level click/contextmenu grammar
// handlers key on (see the multi-select section).
function cardEl(card) {
  const el = document.createElement('div');
  const pb = priorityBadge(card, state.priorities); // emphasis by rank in the configured list, label pre-escaped
  // statusBadge() joins unconditionally (every card has a
  // status) — status is already implied
  // by column placement here, but the dot renders on every surface
  // regardless, so board tiles get it too, same helper as everywhere else.
  el.className = 'card card-el' + (pb.className ? ` ${pb.className}` : '') + (isWaiting(card) ? ' waiting' : '') + (paintsSelected(card.id) ? ' selected' : '') + (isHoverHighlighted(hoverLit, card.id) ? ' hover-highlight' : '');
  el.draggable = !onPhoneLayout(); // a phone swipes between statuses; a touch never starts a native drag
  el.tabIndex = 0; // reachable by Tab so the hover cue isn't pointer-only (kanban.proj#261)
  el.dataset.id = card.id;
  const tags = card.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  // The amber badge lists the UNRESOLVED ids only — it disappears
  // on its own when every dep lands, so a fully-satisfied card never reads
  // as waiting anywhere.
  const waits = waitingOn(card);
  const waiting = waits.length ? `<div class="waiting-badge">Waiting on: ${escapeHtml(waits.map((w) => `#${w.id}`).join(', '))}</div>` : '';
  // An on-disk status that isn't in the board's statuses list parks
  // the card in the FIRST column with a small raw-status chip — the file is
  // NEVER rewritten. Promotion = the human adds the status to config.yaml;
  // the next poll files the card under its real column and the chip vanishes.
  const unlisted = !boardStatuses().includes(card.status);
  const statusChip = unlisted
    ? `<span class="status-chip" title="Status not in the board's statuses list — shown in the first column until promoted in config.yaml">${escapeHtml(card.status)}</span>`
    : '';
  const scheduleHtml = scheduleBlockHtml(card); // start/end/due stack, see helper above
  const parent = parentTile(card);
  // A card with no title yet but a queued prompt (an
  // AI-queued card waiting for an agent to name it) shows the sparkle +
  // prompt text in the title's own spot — a temporary stand-in, never a
  // permanent glyph, gone the moment a real title lands. card-title.js's
  // cardTitleDisplay is the pure decision; the prompt text is user data like
  // any other card field, so it's escaped exactly like card.title would be.
  const titleDisplay = cardTitleDisplay(card);
  const titleHtml = titleDisplay.isPromptFallback
    ? `${AI_PROMPT_ICON}${escapeHtml(titleDisplay.text)}`
    : escapeHtml(card.title);
  // The tile is a two-column flex: everything that reads left-to-right in one
  // child, the date stack in the other so it sits top-right beside the title
  // rather than below it. Keeping the stack out of .card-head matters - the head
  // is a nowrap flex row and three stacked lines would stretch it.
  el.innerHTML =
    `<div class="card-main">` +
      `<div class="card-head"><span class="card-id">#${card.id}${pb.label ? ` ${pb.label}` : ''}</span>${statusBadge(card)}${statusChip}${assigneeBadge(card, state.assignees)}${typeBadge(card, state.types, state.typesOn)}${parent.badge}</div>` +
      `<div class="card-title${titleDisplay.isPromptFallback ? ' card-title--prompt-fallback' : ''}">${titleHtml}</div>` +
      (tags ? `<div class="card-tags">${tags}</div>` : '') + waiting + parent.bar +
    `</div>` +
    scheduleHtml;
  paintAssigneeColors(el); // reserved custom colors need a CSSOM pass, see helper
  paintTypeColors(el);
  paintRollupBars(el);
  // The red blocked pill — the sticker is a human stop sign, so
  // it reads as its own glyph, not a border (borders stay priority/status
  // territory). The reason is USER DATA: it goes in via textContent/title
  // property assignment only, never through innerHTML.
  if (isBlockedValue(card.blocked)) {
    const pill = document.createElement('span');
    pill.className = 'blocked-pill';
    pill.textContent = 'blocked';
    pill.title = blockedLabel(card.blocked);
    el.querySelector('.card-head').appendChild(pill);
  }
  // ADR 0009: the gold review pill — blocked's sibling sticker,
  // "finished, approve me" rather than a stop sign, so its own color family.
  // Same USER-DATA-in-tooltip discipline: textContent/title property only.
  if (isReviewValue(card.review)) {
    const pill = document.createElement('span');
    pill.className = 'review-pill';
    pill.textContent = 'review';
    pill.title = reviewLabel(card.review);
    el.querySelector('.card-head').appendChild(pill);
  }
  const noteCount = noteCountButton(card.id); // the small note count, only when the card has notes
  if (noteCount) el.querySelector('.card-head').appendChild(noteCount);
  const todoCount = todoCountButton(card.id); // open over all todo items, only when the card has a list with items
  if (todoCount) el.querySelector('.card-head').appendChild(todoCount);
  const badges = groupBadges(card.id); // up to two group badges, only when the board keeps groups and the card is in one
  if (badges) el.querySelector('.card-main').appendChild(badges);
  return el;
}

// Archived tiles, inline in the Archive column: no drag, no Edit/Archive actions (an
// already-archived card 404-ing on re-archive is exactly what the idempotency
// guard on the server exists for, but there's no reason to invite it from the
// UI) — Restore/Delete stay reachable as tile buttons.
// statusBadge(card) needs no opts gate here — it colors straight
// off the card's true status regardless of card.archived (status
// dots never mute), so the SAME call is correct whether this renders
// in the Archive column or the map's No relations row: "board tiles (live AND
// archived)" gets the dot always, true color always.
// archivedBadge() joins right after statusBadge(),
// same unconditional reasoning — archiveCardEl only ever
// renders an archived card (both call sites below pass one). Glyph
// order everywhere it appears: status, archived.
function archiveCardEl(card) {
  const el = document.createElement('div');
  el.className = 'card card-el archived-card' + (paintsSelected(card.id) ? ' selected' : '') + (isHoverHighlighted(hoverLit, card.id) ? ' hover-highlight' : '');
  el.draggable = !onPhoneLayout(); // drag out of Archive restores to the drop column; no native drag on a phone
  el.tabIndex = 0; // reachable by Tab so the hover cue isn't pointer-only (kanban.proj#261)
  el.dataset.id = card.id;
  const scheduleHtml = scheduleBlockHtml(card); // start/end/due stack, see helper above
  const parent = parentTile(card);
  // Same empty-title-shows-the-prompt fallback as the board
  // tile — reused verbatim via cardTitleDisplay
  // (card-title.js), never re-derived here.
  const titleDisplay = cardTitleDisplay(card);
  const titleHtml = titleDisplay.isPromptFallback
    ? `${AI_PROMPT_ICON}${escapeHtml(titleDisplay.text)}`
    : escapeHtml(card.title);
  el.innerHTML =
    `<div class="card-main">` +
      `<div class="card-head"><span class="card-id">#${card.id}</span>${statusBadge(card)}${archivedBadge()}${assigneeBadge(card, state.assignees)}${typeBadge(card, state.types, state.typesOn)}${parent.badge}</div>` +
      `<div class="card-title${titleDisplay.isPromptFallback ? ' card-title--prompt-fallback' : ''}">${titleHtml}</div>` +
      parent.bar +
    `</div>` +
    scheduleHtml +
    `<div class="card-menu">` +
      `<button type="button" data-act="restore" data-id="${card.id}">Restore</button>` +
      `<button type="button" data-act="delete-arch" data-id="${card.id}">Delete</button>` +
    `</div>`;
  paintAssigneeColors(el); // reserved custom colors need a CSSOM pass, see helper
  paintTypeColors(el);
  paintRollupBars(el);
  const noteCount = noteCountButton(card.id);
  if (noteCount) el.querySelector('.card-head').appendChild(noteCount);
  const todoCount = todoCountButton(card.id);
  if (todoCount) el.querySelector('.card-head').appendChild(todoCount);
  const badges = groupBadges(card.id);
  if (badges) el.querySelector('.card-main').appendChild(badges);
  return el;
}

// Fifth column, right of Done, populated from state.archived (the archived/
// folder — ADR 0002: archive is a LOCATION, not a status). Every column
// (including Archive) gets a collapse toggle; collapsed columns render as a
// narrow strip with just the toggle icon + card count, and skip building
// their .column-cards list entirely (nothing to wire drag/click on while
// hidden). Archive is excluded from drag/drop (see wireDrag): dropping a live
// card's status as "archive" would just 400 at the server, so that
// interaction is deliberately not offered.
// Search: the box lives in the header, outside #board, so it's never
// rebuilt by renderBoard() — reading its live .value here each call is how the
// query "survives" every re-render (manual, poll, drag, toggle) for free, with
// no separate state to keep in sync. Parsing/matching itself is search.js
// (pure, no DOM), loaded as a bare global same as refresh-policy.js.
function currentSearchTerms() {
  const input = $('#search-input');
  return parseSearchQuery(input ? input.value : '', state.projectName);
}

// What the box matches, parsed and matched once: `terms` is the parse, `matched` the
// Set of card ids the whole query matches, and null means no query. `ids` is the Set
// of cards the box leaves in view, null when it hides nothing: the whole query's matches
// where the box hides (the Graph, which works its own hiding out from them, and every
// view while isolate is on), and only the slice: cut's otherwise (boxHidingTerms,
// selection.js). `lit` is the Set the box lights with the selected look outside the Graph
// while isolate is off (boxLightsMatches), null where it lights nothing. Matching runs over
// the whole board, live and archived, because tree: and path: traverse both; each view
// intersects `ids` with the cards it shows. renderBoard makes the result once per render
// and every view reads it through currentSearchMatch(). A view repainted on its own
// (calendar paging, a status pill) makes its own.
let searchMatchMemo = null;
// What the last renderBoard matched, kept after it so the jump to the nearest
// match, which runs right after a repaint, reads it instead of matching again.
let lastSearchMatch = null;
// The cards the last renderBoard's box lit outside the Graph (`lit` of its match), which every
// view paints with the selected look beside the selection (paintsSelected), including a view
// repainted on its own. Null where the box lights nothing.
let boxLitIds = null;

// What a query resolves against: the nesting context, the board's hierarchy for slice: and its groups for group:.
function searchCtx() {
  return Object.assign(nestingCtx(), { hierarchy: state.hierarchy, groups: state.groups ? state.groups.list : [] });
}

function matchedIds(terms) {
  return new Set(filterCards(state.active.concat(state.archived), terms, searchCtx()).map((c) => c.id));
}

function computeSearchMatch() {
  const terms = currentSearchTerms();
  const matched = terms.length ? matchedIds(terms) : null;
  if (!matched) return { terms, ids: null, matched: null, lit: null };
  const where = { view: loadViewMode(), isolated: isolateNow() !== null };
  const hiding = boxHidingTerms(terms, where);
  const ids = hiding === terms ? matched : hiding.length ? matchedIds(hiding) : null;
  return { terms, ids, matched, lit: boxLightsMatches(terms, where) ? matched : null };
}

function currentSearchMatch() {
  return searchMatchMemo || computeSearchMatch();
}

// What the box does in the Graph: the cards it hides (a slice: term's cut, from the
// whole board and its hierarchy) and the cards it lights. The Graph's one decision
// about a query, read by what is drawn, what is lit and what a selection can reach.
// While isolate is on the whole query is a cut, as it is in every other view.
function currentGraphQueryEffect() {
  const effect = graphQueryEffect(currentSearchMatch(), state.active.concat(state.archived), searchCtx(), { isolated: isolateNow() !== null });
  return { visibleIds: withIterationCut(effect.visibleIds), litIds: effect.litIds }; // the picked iteration hides the cards outside it, on top of a slice: cut
}

// The cards one piece of search text matches, over the whole board like the box.
// It is the matcher a selection resolves its query, path and tree parts through,
// so a part and its search term cannot disagree. Text that is not a term yet
// (an empty box, `status:` mid-keystroke) matches nothing here, where the box
// shows everything for it: a part must never select the whole board.
function searchMatchIds(text) {
  const terms = parseSearchQuery(text, state.projectName);
  return terms.length ? matchedIds(terms) : new Set();
}

// The matcher the selection resolves its parts through: the search module's, except
// for the text the box holds while the Graph is shown. That text is the typed
// anchor (or a pill's query written to the box), and what it lights is the Graph's
// query decision, read off the one match this render made instead of matching the
// board again. A query that is no term yet lights nothing, never everything.
function selectionMatchIds(text) {
  if (loadViewMode() === 'graph' && text === $('#search-input').value) {
    const lit = currentGraphQueryEffect().litIds;
    return lit ? new Set(lit) : new Set();
  }
  return searchMatchIds(text);
}

// Whether the Gantt and the Calendar can draw the card: it has a working range or a due
// date. A card with neither has no bar, no chip and no marker in either view, and neither
// has a tray for it, so it is not shown there.
function cardIsScheduled(card) {
  return cardSchedule(card).kind !== 'none' || dueMarker(card) !== null;
}

// The cards the view being shown shows, which is all a selection can reach (the
// Board shows the cards of its expanded columns, the other views the cards their
// status pills, their Archive pill and the search box leave, and the Gantt and the Calendar
// only those with a date). It reads the same
// filters each view draws with, so the id set follows what is on screen.
// `withSearch` false leaves the search box and its cut out: the cards the status
// pills and Archive leave, which is what the pill counts are taken over.
function viewCardIds(withSearch) {
  const pool = state.active.concat(state.archived);
  const searchIds = withSearch ? currentSearchMatch().ids : null;
  const cut = iterationCutIds();
  const mode = loadViewMode();
  let visible;
  if (mode === 'graph') {
    visible = graphVisibleIds(pool, withSearch ? currentGraphQueryEffect().visibleIds : null, graphLoadFilter(), boardStatuses(), graphLeftOut(pool));
  } else if (mode === 'map') {
    visible = intersectVisibleIds(searchIds, mapFilterVisibleIds(pool, loadMapStatusFilter(), state.statuses));
  } else if (mode === 'gantt' || mode === 'calendar') {
    const shown = viewShownCards(timelineViewInput(mode === 'gantt' ? loadGanttStatusFilter() : loadCalendarStatusFilter(), searchIds));
    visible = new Set(shown.live.concat(shown.archived).filter(cardIsScheduled).map((c) => c.id));
  } else {
    const collapsed = onPhoneLayout() ? {} : loadCollapsedColumns(); // the phone Board draws a status collapsed on the desktop
    const open = pool.filter((c) => !collapsed[mapFilterColumn(c, boardStatuses())]);
    visible = intersectVisibleIds(searchIds, new Set(open.map((c) => c.id)));
  }
  const shownIds = visible || new Set(pool.map((c) => c.id));
  return cut ? intersectVisibleIds(shownIds, cut) : shownIds; // the iteration's cut counts with or without the box: it is not a search
}

function shownCardIds() {
  return viewCardIds(true);
}

// The cards the view shows before the search box and any cut: what the pill counts
// are taken over, so turning one pill on leaves the others' counts as they were.
function cardsBeforeSearch() {
  const ids = viewCardIds(false);
  return state.active.concat(state.archived).filter((c) => ids.has(c.id));
}

// --- View mode: board (columns) / dependency map / calendar
// / gantt. A closed set, with the same lazy-loaded,
// localStorage-persisted discipline as collapsedColumns/columnSort above
// (feature key 'view.mode', validated by calendar-model.js's mergeViewMode —
// an unknown/corrupt saved value falls back to 'board'). Every state-changing
// call site in this file still funnels through renderBoard(), so making
// renderBoard() the dispatcher means every one of those call sites — drag,
// sort, collapse, search, the auto-refresh poll — composes with whichever
// view is active, with zero changes to any of them.
let viewMode = null;

function loadViewMode() {
  if (viewMode) return viewMode;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'view.mode')); }
  catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to board
  viewMode = mergeViewMode(saved);
  return viewMode;
}

function saveViewMode() {
  try { localStorage.setItem(storageKey(state.projectName, 'view.mode'), viewMode); }
  catch (e) { /* storage unavailable/full — view choice just won't persist this session */ }
}

// applyProjectName resets the roll-up memo, as it does for every cache keyed
// by the board name.
let rollupBarMode = null;

function loadRollupBarMode() {
  if (rollupBarMode) return rollupBarMode;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'rollup.bar')); }
  catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to collapsed
  rollupBarMode = mergeRollupBar(saved);
  return rollupBarMode;
}

function saveRollupBarMode() {
  try { localStorage.setItem(storageKey(state.projectName, 'rollup.bar'), rollupBarMode); }
  catch (e) { /* storage unavailable/full — the choice just won't persist this session */ }
}

// Every roll-up repaints from its setting: the board's bars and tiles, and the
// open card detail.
function repaintRollups() {
  renderBoard();
  if (currentDetailId != null) renderDetailRollup(currentDetailId);
}

// One setting for every bar, with one setter: a click on any bar flips it
// (toggleRollupBar) and the preferences sheet sets it to a named mode. Both
// write the same stored choice, so they always agree.
function setRollupBarMode(mode) {
  rollupBarMode = mergeRollupBar(mode);
  saveRollupBarMode();
  repaintRollups();
}

function toggleRollupBar() {
  setRollupBarMode(nextRollupBar(loadRollupBarMode()));
}

// The preferences sheet's other settings (prefs.js): what a plain click on a
// card does in each view, whether archived leaves count as done, and the search
// panel's: whether its pill section and its slice section start folded and whether it
// opens when the search box is focused. One entry per board, memoized like the
// choices above and dropped by applyProjectName.
let prefsMemo = null;

function prefsStorage() {
  try { return localStorage; } catch (e) { return null; } // blocked storage throws on access
}

function loadPrefsState() {
  if (!prefsMemo) prefsMemo = loadPrefs(prefsStorage(), state.projectName);
  return prefsMemo;
}

function savePrefsState() {
  savePrefs(prefsStorage(), state.projectName, loadPrefsState());
}

// Every roll-up call passes this: the Board tile, the Map's rich row and the
// card detail with its scope line.
function countArchivedLeaves() {
  return loadPrefsState().archivedDone;
}

function setClickPref(view, value) {
  prefsMemo = prefsWith(loadPrefsState(), { click: { [view]: value } });
  savePrefsState();
}

function setArchivedDone(on) {
  prefsMemo = prefsWith(loadPrefsState(), { archivedDone: on });
  savePrefsState();
  repaintRollups();
}

// Whether a section of the search panel starts folded; the section takes the choice now (searchFoldSection,
// search-panel.js).
function setFoldPref(prefKey, on, fold) {
  prefsMemo = prefsWith(loadPrefsState(), { [prefKey]: on });
  savePrefsState();
  fold(on);
}

function setPillsFolded(on) { setFoldPref('pillsFolded', on, foldSearchPills); }
function setStatusesFolded(on) { setFoldPref('statusesFolded', on, foldSearchStatuses); }
function setSlicesFolded(on) { setFoldPref('slicesFolded', on, foldSearchSlices); }
function setTypingFolded(on) { setFoldPref('typingFolded', on, foldSearchTyping); }
function setHoverFolded(on) { setFoldPref('hoverFolded', on, foldSearchHover); }

// Whether the search panel opens when the search box is focused: the switch at the end
// of the box, flipped by a click on the arrow and by the p key (which open the panel at
// once when they turn it on), and shown and set in the preferences sheet (which does
// not, with the sheet up over the board). The panel follows now (search-panel.js).
function setPanelOnFocus(on, openNow = false) {
  prefsMemo = prefsWith(loadPrefsState(), { panelOnFocus: on });
  savePrefsState();
  applySearchPanelSwitch(on, openNow);
}

// Whether the Markdown boxes are coloured while they are edited (markdown-edit-ui.js): one choice for the
// whole browser, not per board (prefs.js); the boxes take it now.
function setMdColour(on) {
  saveMdColour(prefsStorage(), on);
  mdEditSetOn(on);
}

// --- The preferences sheet, opened by the gear in the header. It lists the
// settings above and the roll-up bar mode, and writes each to the browser the
// moment it is chosen. It sits on the modal backdrop (so the poll pauses and
// the Esc catch-all see it), Esc has its own line in the Esc handler, and the
// key guard names it. Focus goes to its close button on open and back to the
// gear on close; there is no Tab trap, like the other popups.
function prefOptionOn(opt) {
  if (opt.dataset.pref === 'bar') return loadRollupBarMode() === opt.dataset.value;
  return loadPrefsState().click[opt.dataset.view] === opt.dataset.value;
}

function syncPrefsSheet() {
  $('#prefs-sheet').querySelectorAll('.prefs-opt').forEach((opt) => { if (opt.dataset.pref) opt.setAttribute('aria-pressed', String(prefOptionOn(opt))); }); // the choices of This browser; the switches of This board are drawn by settings-ui.js
  $('#prefs-archived-done').checked = countArchivedLeaves();
  $('#prefs-slices-folded').checked = loadPrefsState().slicesFolded;
  $('#prefs-pills-folded').checked = loadPrefsState().pillsFolded;
  $('#prefs-statuses-folded').checked = loadPrefsState().statusesFolded;
  $('#prefs-typing-folded').checked = loadPrefsState().typingFolded;
  $('#prefs-hover-folded').checked = loadPrefsState().hoverFolded;
  $('#prefs-panel-on-focus').checked = loadPrefsState().panelOnFocus;
  $('#prefs-md-colour').checked = loadMdColour(prefsStorage());
}

function openPrefsSheet(page) {
  syncPrefsSheet();
  settingsShow(typeof page === 'string' ? page : null);
  $('#prefs-sheet').classList.remove('hidden');
  $('#prefs-btn').setAttribute('aria-expanded', 'true');
  $('#prefs-close').focus();
}

function closePrefsSheet() {
  $('#prefs-sheet').classList.add('hidden');
  $('#prefs-btn').setAttribute('aria-expanded', 'false');
  ($('#prefs-btn').offsetParent === null ? $('#more-btn') : $('#prefs-btn')).focus();
}

// A click on the backdrop outside the sheet closes it; one on a choice makes it, one on a menu item
// shows that page. The switches of This board's pages answer to settings-ui.js, not here.
function onPrefsSheetClick(e) {
  if (e.target.id === 'prefs-sheet') { closePrefsSheet(); return; }
  const opt = e.target.closest('.prefs-opt');
  if (opt) {
    if (opt.disabled || !opt.dataset.pref) return;
    if (opt.dataset.pref === 'bar') setRollupBarMode(opt.dataset.value);
    else setClickPref(opt.dataset.view, opt.dataset.value);
    syncPrefsSheet();
    return;
  }
  const item = e.target.closest('.prefs-menu-item');
  if (item) settingsGo(item.dataset.page);
}

// Cards are edited in place (optimistic drops), so the nesting index is rebuilt
// at the top of every renderBoard() rather than cached across renders; tiles
// and the map's No relations row both read it.
let nestingIndex = null;

function nestingCtx() {
  return { board: state.projectName, priorities: state.priorities };
}

function buildNestingIndex() {
  return rollupIndex(state.active.concat(state.archived), nestingCtx());
}

function parentTile(card) {
  const altitude = nestingIndex.altitudeOf(card.id);
  if (!altitude) return { badge: '', bar: '' };
  const rollup = nestingIndex.rollup(card.id, { countArchived: countArchivedLeaves() });
  return { badge: altitudeBadge(altitude), bar: rollupBar(rollup, loadRollupBarMode(), boardStatuses()) };
}

// rollupBar() carries each segment's weight as data-n; the CSP forbids a style
// attribute, so the proportion is set here once the HTML has landed.
function paintRollupBars(root) {
  root.querySelectorAll('.rollup-seg[data-n]').forEach((seg) => {
    seg.style.flexGrow = seg.dataset.n;
  });
}

// A soft warning, never a gate: parents newly done while leaves below are open.
// Only the literal status done counts. Called after the move has been saved.
function openLeavesNote(cards, status) {
  if (status !== 'done') return '';
  const index = buildNestingIndex();
  return openLeavesWarning(cards.map((c) => ({ id: c.id, open: index.openLeafCount(c.id) })));
}

// A view bar button assigns its view: unlike toggleView, a tap on the current view stays on it, and
// the Board is a place to go, never a toggle back. A tap on the view already showing changes nothing:
// no redraw, and no jump of the Calendar or the Gantt to another date range.
function setView(mode) {
  const from = loadViewMode();
  const to = VIEW_TABLE.some((v) => v.id === mode) ? mode : 'board';
  if (to === from) return;
  viewMode = to;
  saveViewMode();
  isolateEndFollowing(typingIsolatesIn(to)); // an isolate the box's own query started ends where the view lights what is typed
  const boxText = isolateNow() ? '' : $('#search-input').value; // while isolated the box holds the isolate text, never the anchor
  const kept = selectionOnViewSwitch(selectionState.selection, { from, to: viewMode, boxText }); // a Graph search is no anchor elsewhere
  const before = selectionState.selection;
  if (kept !== before) setSelection(kept);
  const picked = partsOf(kept).some((part) => part.kind !== 'query'); // cards, paths and trees: the box says them in every view
  const unsaid = !searchBoxMirrors($('#search-input').value, partsOf(kept));
  const mirrors = boxMirrorsSelection() && partsOf(kept).length && unsaid && (kept !== before || picked);
  if (mirrors) {
    mirrorSelectionInBox(before); // what is picked goes with the person to the next view, the box saying so
  } else {
    isolateStartFollowing(typingIsolatesIn(to)); // a typed query isolates where this view's Typing isolates is on
    renderBoard();
  }
  followSearchInAddress($('#search-input').value); // isolate=0 where this view's Typing isolates is on, nothing elsewhere
  moveViewToNearestMatch(); // entering the Calendar or the Gantt makes the check once; any other view does nothing
}

// Each header toggle flips between its own view and the board: map ⇄ board,
// calendar ⇄ board — and pressing one while the OTHER view is active jumps
// straight to the pressed view (no board stopover).
function toggleView(mode) {
  setView(loadViewMode() === mode ? 'board' : mode);
}

// One mode→container map for everything that needs "which element hosts
// this view" — applyViewMode's hide/show and visibleCardIds' range scope
// — so a sixth view is one entry here, not two edits.
const VIEW_CONTAINERS = { board: '#board', map: '#map-view', calendar: '#calendar-view', gantt: '#gantt-view', graph: '#graph-view' };

// The views, in the order the header and the phone's view bar list them: id, the
// button's word, the line icon (view-icons.js) it wears. The active view's button
// reads "Board view" and wears the Board icon instead, so a sixth view is one entry
// here and one in VIEW_CONTAINERS.
const VIEW_TABLE = [
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'gantt', label: 'Gantt', icon: 'gantt' },
  { id: 'map', label: 'Map view', icon: 'map' },
  { id: 'graph', label: 'Graph', icon: 'graph' },
];

// What each view's button shows in a mode: label, icon, pressed. The Board's own entry
// never reads "Board view"; an unknown mode is the Board.
function viewButtonsModel(mode) {
  const current = VIEW_TABLE.some((v) => v.id === mode) ? mode : 'board';
  return VIEW_TABLE.map((v) => {
    const active = v.id === current;
    const away = active && v.id !== 'board';
    return { id: v.id, label: away ? 'Board view' : v.label, icon: away ? 'board' : v.icon, pressed: active };
  });
}

// The date range the header shows beside the board's name on a phone: the view's own title for the
// Calendar and the Gantt, nothing for any other view.
function headerDateText(mode, title) {
  return (mode === 'calendar' || mode === 'gantt') && typeof title === 'string' ? title : '';
}

function paintHeaderDate(mode, title) {
  const slot = $('#header-date');
  const text = headerDateText(mode, title);
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList.toggle('hidden', text === '');
}

// Draw every icon slot to the shape its data-icon names, once per change.
function paintIconSlots() {
  for (const slot of document.querySelectorAll('.btn-icon')) {
    if (slot.dataset.drawn === slot.dataset.icon) continue;
    slot.innerHTML = viewIconSvg(slot.dataset.icon);
    slot.dataset.drawn = slot.dataset.icon;
  }
}

// Paint the view buttons for a mode, writing only what changed. Any element that
// names a view with data-view gets aria-pressed; only the header's toggle buttons
// (data-view-toggle) get a label and an icon, so a second set of view buttons is markup only.
function paintViewButtons(mode) {
  const rows = new Map(viewButtonsModel(mode).map((r) => [r.id, r]));
  for (const el of document.querySelectorAll('[data-view-toggle], #view-bar [data-view]')) {
    const row = rows.get(el.dataset.view);
    if (!row) continue;
    const pressed = String(row.pressed);
    if (el.getAttribute('aria-pressed') !== pressed) el.setAttribute('aria-pressed', pressed);
    if (el.dataset.viewToggle === undefined) continue;
    const label = el.querySelector('.btn-label');
    if (label && label.textContent !== row.label) label.textContent = row.label;
    const icon = el.querySelector('.btn-icon');
    if (icon && icon.dataset.icon !== row.icon) icon.dataset.icon = row.icon;
  }
  paintIconSlots();
}

// The view bar's words and icons, written once from VIEW_TABLE: the idle label of each view with its
// " view" tail dropped, and the table's icon. Pressed state is the painter's.
function fillViewBar() {
  for (const el of document.querySelectorAll('#view-bar [data-view]')) {
    const row = VIEW_TABLE.find((v) => v.id === el.dataset.view);
    if (!row) continue;
    const label = el.querySelector('.btn-label');
    if (label) label.textContent = row.label.replace(/ view$/, '');
    const icon = el.querySelector('.btn-icon');
    if (icon) icon.dataset.icon = row.icon;
  }
  paintIconSlots();
}

function applyViewMode() {
  const mode = loadViewMode();
  for (const [m, sel] of Object.entries(VIEW_CONTAINERS)) $(sel).classList.toggle('hidden', mode !== m);
  $('#board-tabs').classList.toggle('hidden', mode !== 'board');
  paintViewButtons(mode);
  if (mode !== 'calendar' && mode !== 'gantt') paintHeaderDate(mode, '');
  if (mode === 'map') renderMapView();
  if (mode === 'calendar') renderCalendarView();
  if (mode === 'gantt') renderGanttView();
  if (mode === 'graph') renderGraphView();
}

function renderBoard() {
  nestingIndex = buildNestingIndex();
  syncHoverLit(); // the cards the views draw read it
  renderIterations(); // the dropdown, before the views read the cut it makes
  searchMatchMemo = computeSearchMatch();
  lastSearchMatch = searchMatchMemo;
  boxLitIds = searchMatchMemo.lit;
  try {
    setSelection(selectionFollowingBox(selectionState.selection)); // what the view shows may have changed: a pill, the box, a view switch, a poll
    renderBoardColumns();
    applyViewMode();
    renderSearchPanel(); // the chip, and the pills' counts in place while the panel is open
  } finally {
    searchMatchMemo = null;
  }
}

// Publishes the sticky page header's real rendered height as
// a CSS var so each column-header's `top: var(--board-header-h)` (app.css)
// parks it directly under the page header instead of a guessed fixed px
// offset — the header wraps to a second row on a narrow viewport, a long
// project name, or the notif badge appearing, so a hardcoded value would
// drift out of sync with the header it's supposed to sit below. Wired at
// DOMContentLoaded (header markup is static HTML, already parsed — no need
// to wait on the board fetch) plus a ResizeObserver on the header itself, so
// a live wrap change (window resize, content change) keeps the var current.
function syncBoardHeaderHeight() {
  const header = document.querySelector('header');
  if (!header) return;
  document.documentElement.style.setProperty('--board-header-h', `${header.offsetHeight}px`);
}

function renderBoardColumns() {
  const board = $('#board');
  // Each column scrolls its own
  // card list independently (.column-cards, see app.css's comment on the
  // rule) instead of the whole board sharing one scroll — but every
  // renderBoard() call (poll, drag, search keystroke, ...; the auto-refresh
  // poll alone fires every 5s, AUTO_REFRESH_MS below) wipes and rebuilds
  // #board's children, and clearing a scrolled container's content resets
  // its scrollTop to 0. Without this, a column scrolled mid-read would jump
  // back to its top every few seconds during normal use. Same fix class as
  // renderMapView's keepLeft/keepTop above: read each column's position
  // before the wipe (keyed by column id — a column can be removed/reordered
  // by a config change between renders, so index position isn't safe to
  // reuse), restore it once that column's card list is rebuilt.
  // main#board itself keeps its own horizontal scroll
  // (overflow-x: auto) — scrollLeft is preserved
  // the same way for the same reason.
  const keepBoardLeft = board.scrollLeft;
  const keepColumnTops = new Map();
  board.querySelectorAll('.column-cards').forEach((el) => {
    const colEl = el.closest('.column');
    if (colEl && colEl.dataset.col) keepColumnTops.set(colEl.dataset.col, el.scrollTop);
  });
  board.innerHTML = '';
  const collapsed = loadCollapsedColumns();
  const colSort = loadColumnSort();
  const searchActive = currentSearchMatch().matched !== null; // the box holds a query, whether it hides, lights or both
  const searchIds = withIterationCut(currentSearchMatch().ids); // the picked iteration cuts the columns on top of the box, which it never writes
  const narrowed = searchIds !== null;
  const clearBtn = $('#search-clear-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !searchActive);
  // tree:/path: terms need the FULL active+archived graph to
  // resolve connectivity — resolving per column (a pre-sliced subset) would
  // see almost no edges. The shared match result is that full-board
  // resolution, so each column below intersects against it by id.
  // Columns render FROM the configured statuses list (+ archive at
  // the far right). A card whose status isn't listed renders in the FIRST
  // column via columnForStatus — the catch-all — with cardEl's raw-status chip.
  // A column cannot work out the outline from its own cards (a child's parent
  // may sit in another column), so the whole board is indexed once.
  const outlineIndex = outlineOrder(state.active.concat(state.archived), nestingCtx()).index;
  const statuses = boardStatuses();
  const phone = onPhoneLayout();
  const phoneActive = phone ? activePhoneColumn(loadPhoneColumn(), statuses) : null;
  const tabCounts = {};
  for (const col of boardColumnIds()) {
    const isArchive = col === 'archive';
    const source = isArchive ? state.archived : state.active.filter((c) => columnForStatus(c.status, statuses) === col);
    const sortState = colSort[col];
    // The Assignee sort ranks by registry order, so the comparator
    // gets the config.yaml handles — plumbed exactly like priorities above.
    if (phone && col !== phoneActive) { // the phone Board shows one status at a time: the others are only counted
      tabCounts[col] = { shown: narrowed ? source.filter((c) => searchIds.has(c.id)).length : source.length, total: source.length };
      continue;
    }
    const allCards = sortCards(source, sortState, state.priorities, state.assignees.map((a) => a.handle), outlineIndex);
    const cards = narrowed ? allCards.filter((c) => searchIds.has(c.id)) : allCards;
    if (phone) tabCounts[col] = { shown: cards.length, total: allCards.length };
    const isCollapsed = phone ? false : !!collapsed[col]; // a status collapsed on the desktop still shows its cards, and nothing is written
    const label = columnLabel(col);
    // Counts stay truthful whether or not the column is collapsed — column-count
    // renders in both states, so a collapsed column with hits signals them on its
    // strip with no extra branching.
    const countLabel = narrowed ? `${cards.length}/${allCards.length}` : `${allCards.length}`;
    const colEl = document.createElement('div');
    // col-<name> only for css-safe names (the built-in five have color rules;
    // a custom name's rule wouldn't exist anyway — its color is inline below).
    const colClass = /^[a-zA-Z0-9_-]+$/.test(col) ? ` col-${col}` : '';
    colEl.className = `column${colClass}` +
      (isCollapsed ? ' collapsed' : '') +
      (isArchive ? ' archive-column' : '') +
      (searchActive && (boxLitIds ? cards.some((c) => boxLitIds.has(c.id)) : cards.length > 0) ? ' search-match' : '');
    colEl.dataset.col = col;
    colEl.title = label; // native tooltip; matters most while collapsed
    // Sort controls share the header with the collapse toggle —
    // hidden entirely while collapsed (no card list visible to sort, and no
    // room in the narrow strip), so the two never fight for space. The
    // dropdown's selected option and the direction glyph both reflect the
    // persisted per-column state, so a re-render (poll/drag/toggle/search)
    // never visually resets the control out from under the user.
    const sortControls = isCollapsed ? '' :
      `<select class="column-sort-field" data-holds-poll data-col="${escapeHtml(col)}" ` +
        `aria-label="Sort ${escapeHtml(label)} column by" title="Sort by">` +
        SORT_FIELDS.map((f) =>
          `<option value="${f}"${sortState.field === f ? ' selected' : ''}>${escapeHtml(SORT_FIELD_LABELS[f])}</option>`
        ).join('') +
      `</select>` +
      `<button type="button" class="column-sort-dir" data-holds-poll data-col="${escapeHtml(col)}" ` +
        `aria-label="Toggle sort direction, currently ${sortState.direction === 'desc' ? 'descending' : 'ascending'}" ` +
        `title="Sort direction: ${sortState.direction === 'desc' ? 'descending' : 'ascending'} (click to toggle)">` +
        (sortState.direction === 'desc' ? '&#8595;' : '&#8593;') +
      `</button>`;
    colEl.innerHTML =
      `<div class="column-header">` +
        `<button type="button" class="column-toggle" data-col="${escapeHtml(col)}" ` +
          `aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escapeHtml(label)} column" aria-expanded="${!isCollapsed}">` +
          (isCollapsed ? CHEVRON_RIGHT_ICON : CHEVRON_LEFT_ICON) +
        `</button>` +
        (isCollapsed ? '' : `<span class="column-name">${escapeHtml(label)}</span>`) +
        sortControls +
        `<span class="column-count">${escapeHtml(countLabel)}</span>` +
        // + quick-create, pre-aimed at this column. Live expanded
        // headers only (showsColumnAdd: archive never — you can't create an
        // archived card — and a collapsed strip has no room). Wired through
        // the delegated #board click listener, same as every header control.
        // the sparkle twin sits right after it, same gate —
        // opens the same modal pre-aimed at this column, with the AI prompt
        // row already revealed (see enableAiPrompt(), wired in the delegated
        // click listener below).
        (showsColumnAdd(col, isCollapsed) ?
          `<button type="button" class="column-add" data-holds-poll data-col="${escapeHtml(col)}" ` +
            `aria-label="New card in ${escapeHtml(label)}" title="New card in ${escapeHtml(label)}">+</button>` +
          `<button type="button" class="column-add-ai" data-holds-poll data-col="${escapeHtml(col)}" ` +
            `aria-label="New AI-prompt card in ${escapeHtml(label)}" title="New card in ${escapeHtml(label)} with AI prompt enabled">${AI_PROMPT_ICON}</button>` : '') +
      `</div>`;
    // Custom columns get their deterministic hashed color inline
    // (there is no CSS rule for them); the built-in four keep their exact
    // .col-<name> CSS palette, archive keeps its neutral header.
    if (!isArchive && !isBuiltinStatus(col)) colEl.querySelector('.column-header').style.color = statusColorVar(col);
    if (!isCollapsed) {
      const list = document.createElement('div');
      list.className = 'column-cards';
      cards.forEach((c) => list.appendChild(isArchive ? archiveCardEl(c) : cardEl(c)));
      colEl.appendChild(list);
    }
    board.appendChild(colEl);
    // Restoring scrollTop only works once colEl is attached to the live
    // document — an unattached node has no layout, so scrollHeight/
    // clientHeight both read 0 and the browser silently clamps any assigned
    // scrollTop back to 0. Must happen after board.appendChild(colEl) above.
    if (!isCollapsed && keepColumnTops.has(col)) {
      colEl.querySelector('.column-cards').scrollTop = keepColumnTops.get(col);
    }
  }
  board.scrollLeft = keepBoardLeft;
  renderBoardTabs(phone ? phoneTabs(statuses, tabCounts, phoneActive, narrowed) : []);
  wireDrag();
}

// The status tabs of the phone Board, one button per status with its colour and count. The strip is
// emptied above the width line, where the stylesheet hides it anyway. A redraw keeps the strip where it
// was scrolled; the chosen tab is brought into view only when the choice has changed.
function renderBoardTabs(tabs) {
  const strip = $('#board-tabs');
  const keepLeft = strip.scrollLeft;
  const chosenBefore = strip.dataset.chosen;
  strip.textContent = '';
  let chosen = null;
  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'board-tab';
    btn.setAttribute('role', 'tab');
    btn.dataset.col = t.status;
    btn.setAttribute('aria-selected', String(t.selected));
    btn.style.color = statusColorVar(t.status);
    if (t.selected) chosen = btn;
    const name = document.createElement('span');
    name.className = 'board-tab-label';
    name.textContent = t.label;
    const count = document.createElement('span');
    count.className = 'board-tab-count';
    count.textContent = t.count;
    btn.appendChild(name);
    btn.appendChild(count);
    strip.appendChild(btn);
  }
  strip.scrollLeft = keepLeft;
  if (chosen && chosen.dataset.col !== chosenBefore) chosen.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  if (chosen) strip.dataset.chosen = chosen.dataset.col; else delete strip.dataset.chosen;
}

// --- Dependency map rendering ------------------------------------
// Graph-building (nodes/edges/ghost-stubs/isolated, filter-aware) lives in
// dependency-graph.js — pure, unit-tested, dual-environment like search.js.
// Everything below is presentation: laying the graph's nodes/edges out as an
// SVG and gluing it to the DOM. Nodes come from BOTH state.active and
// state.archived — waiting is location-independent (archive is a location,
// not a status; see isWaiting() above, same reasoning) — so the map shows the
// true dependency picture regardless of where a card currently lives.
const MAP_NODE_W = 176;
// 58 fits the right-edge dot column (status dot + archived ball) with room
// to spare — see buildMapSvg's statusDot/archivedDot. Shrinking the node
// would ripple into every other pinned map-layout measurement for no visual gain.
const MAP_NODE_H = 58;
const MAP_GAP_X = 24;
const MAP_GAP_Y = 60;
const MAP_PAD = 24;
const MAP_DIMS = { nodeW: MAP_NODE_W, nodeH: MAP_NODE_H, gapX: MAP_GAP_X, gapY: MAP_GAP_Y, pad: MAP_PAD };
const MAP_STATUSES = ['backlog', 'todo', 'doing', 'done'];

function mapStatusClass(status) {
  const s = (status || '').toLowerCase();
  return MAP_STATUSES.includes(s) ? s : 'unknown';
}

function truncateLabel(s, max) {
  const str = String(s || '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

// The Map's scrolling area, rebuilt by every renderMapView(): #map-view holds it and, beside
// it, the option panel, which does not scroll with the graphs. The pan, the zoom and Fit
// all read and move this element.
let mapMain = null;

function renderMapView() {
  const container = $('#map-view');
  // Selection toggles re-render — don't dump the user's scroll position
  // (same fix class as the gantt timeline's keepScrollLeft).
  const keepLeft = mapMain ? mapMain.scrollLeft : 0, keepTop = mapMain ? mapMain.scrollTop : 0;
  container.innerHTML = '';
  const main = document.createElement('div');
  main.className = 'map-main';
  mapMain = main;
  container.appendChild(main);
  const panelOpen = viewPanelIsOpen('map');
  if (panelOpen) container.appendChild(buildMapPanel());
  const allCards = state.active.concat(state.archived);
  const options = loadMapOptions();
  container.classList.toggle('map-align-center', options.align === 'center');
  // The status pills sit in the search panel's Statuses section, which keeps the
  // recover-from-empty guarantee: a board filtered down to nothing still has a control
  // to turn a status back on. The option panel with the zoom toolbar stands beside the
  // bar, same unconditional treatment (a zoomed-out board that then filters everything
  // away shouldn't strand the human with no way to zoom back).
  main.appendChild(buildMapBar(panelOpen));
  const searchIds = withIterationCut(currentSearchMatch().ids);
  // Status filter composes with search by INTERSECTION — a card is
  // visible only if BOTH say so, and buildRelationsGraph sees one combined
  // visibleIds so the ghost-stub semantics stay EXACTLY the search filter's,
  // for free. The rule (incl. either side's null "not filtering" pass-through)
  // is column-state.js's intersectVisibleIds — pure and unit-pinned, not glue.
  const statusIds = mapFilterVisibleIds(allCards, loadMapStatusFilter(), state.statuses);
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const rel = buildRelationsGraph(allCards, visibleIds, nestingCtx());

  if (!rel.nodes.length && !rel.ghosts.length) {
    const empty = document.createElement('div');
    empty.className = 'map-empty';
    empty.textContent = 'No cards match the current search/status filters.';
    main.appendChild(empty);
    return;
  }

  // Each section's collapse state persists per board (memoize-once-
  // mutate-in-place, same as loadMapStatusFilter above), so it survives every
  // renderMapView() call — manual, poll, drag, toggle, search.
  const sections = loadMapSectionsCollapsed();
  const view = mapShapeRelations(rel, options);
  const draw = Object.assign({}, options, { statuses: boardStatuses(), byId: new Map(allCards.map((c) => [c.id, c])) });
  if (view.graphs.length) main.appendChild(buildMapGraphSection(view.graphs, draw, sections.graph));
  if (view.noRelations.length) main.appendChild(buildIsolatedRow(view.noRelations, allCards, sections.isolated));
  main.scrollLeft = keepLeft;
  main.scrollTop = keepTop;
}

const REFOCUS_SELECTOR = '.map-section-toggle, .graph-option-btn, .graph-info-toggle, .view-panel-toggle, .view-panel-close';

// What finds a rebuilt control again after a render: its class and what names it, a fold
// toggle's section, a panel button its view, or for a button of the
// Graph's option row its option and its value.
function refocusSelector(el) {
  const quote = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const named = (key) => `[data-${key}="${quote(el.dataset[key])}"]`;
  if (el.dataset.graphInfo !== undefined) return '.graph-info-toggle';
  if (el.dataset.panel !== undefined) return `.${el.classList[0]}${named('panel')}`;
  if (el.dataset.key !== undefined) return `.${el.classList[0]}${named('key')}${named('val')}`;
  return `.${el.classList[0]}${named('section')}`;
}

function focusedRebuiltControl() {
  const el = document.activeElement;
  return el && el.closest ? el.closest(REFOCUS_SELECTOR) : null;
}

// A fold toggle or an option button is rebuilt by the render its own press
// triggers, so focus has to be handed back to the new element.
function keepControlFocus(el, action) {
  const selector = refocusSelector(el);
  action();
  const next = document.querySelector(selector);
  if (next) next.focus({ preventScroll: true });
}

// The option panel on the right of the Map and of the Graph (view-panel.js keeps whether it is
// open). One icon button at the top right of the view's area, the side the panel comes out of, opens and closes it. Open, the
// panel stands beside the view's area; under 760 px it lies over the view as a sheet, with a
// close button of its own that the stylesheet shows there. Closed, it is not built at all:
// the view has the width back and none of its controls can take focus. The panel and both
// buttons keep the selection, as the rows they replaced did.
const VIEW_PANEL_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="15" y1="4" x2="15" y2="20"></line></svg>';

function viewPanelIsOpen(view) {
  return viewPanelOpen(loadViewPanel(prefsStorage(), state.projectName), view, window.innerWidth);
}

function viewPanelSet(view, open) {
  const storage = prefsStorage();
  saveViewPanel(storage, state.projectName, viewPanelWith(loadViewPanel(storage, state.projectName), view, open));
}

function buildViewPanelToggle(view, title, open) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'view-panel-toggle';
  b.dataset.panel = view;
  b.dataset.keepsSelection = '';
  b.title = title;
  b.setAttribute('aria-label', 'Options panel');
  b.setAttribute('aria-expanded', String(open));
  b.innerHTML = VIEW_PANEL_ICON;
  return b;
}

function buildViewPanel(view, label) {
  const panel = document.createElement('aside');
  panel.className = 'view-panel';
  panel.dataset.panel = view;
  panel.dataset.keepsSelection = '';
  panel.setAttribute('aria-label', label);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'view-panel-close';
  close.dataset.panel = view;
  close.dataset.keepsSelection = '';
  close.title = 'Close the options panel';
  close.setAttribute('aria-label', 'Close the options panel');
  close.textContent = '×';
  panel.appendChild(close);
  return panel;
}

// A press on the icon button or on the sheet's close button: the choice flips and the view
// is drawn again. The close button is gone once the panel is, so the icon button takes focus.
function pressViewPanelButton(btn, redraw) {
  const view = btn.dataset.panel;
  viewPanelSet(view, !viewPanelIsOpen(view));
  redraw();
  const toggle = document.querySelector(`.view-panel-toggle[data-panel="${view}"]`);
  if (toggle) toggle.focus({ preventScroll: true });
}

// Until the person chooses, the panel follows the screen, so crossing the phone width line (phone-width.js) draws the view again.
window.addEventListener('DOMContentLoaded', () => {
  const list = phoneWidthMedia();
  if (!list) return;
  list.addEventListener('change', () => {
    if (loadViewMode() === 'graph') graphRefitNext = true; // the stage has another width, so the cards are framed again
    const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.card-el') : null;
    const focusedId = focused ? focused.dataset.id : null;
    const pointerId = hoveredId;
    renderBoard(); // the Board follows the line too: the phone's tabs and one status, or every column, and the Map or the Graph once
    const again = focusedId === null ? null : cardElInShownView(focusedId, focused);
    if (again) again.focus({ preventScroll: true });
    if (hoveredId !== pointerId) setHoveredId(pointerId);
  });
});

// The Map's top row: the panel button alone, on the right, the side the panel comes out of. The status pills sit in the search panel's Statuses section.
function buildMapBar(open) {
  const bar = document.createElement('div');
  bar.className = 'view-bar';
  bar.appendChild(buildViewPanelToggle('map', 'Show or hide the zoom and the options', open));
  return bar;
}

function buildMapPanel() {
  const panel = buildViewPanel('map', 'Map options');
  panel.appendChild(buildMapZoomControls());
  panel.appendChild(buildMapOptionsRow());
  return panel;
}

// Zoom toolbar — the first thing in the option panel (the pill row's own
// flex-wrap keeps growing the pill row for every board status; a wide status list
// would push these off-screen or wrap them awkwardly into the status pills
// if they shared one row). Rebuilt by every renderMapView() call like the
// rest of #map-view, so the percentage readout never drifts from
// loadMapZoom()'s actual persisted value. Buttons carry data-zoom-action
// (read by the delegated #map-view click listener, see the map wiring
// section) rather than three separate onclicks, same delegation shape as
// the status pills' data-col. In/out disable at the clamp's own edges —
// map-zoom.js's clampMapZoom is the single source of truth for the range,
// so a step past either edge is simply impossible, not just unreachable
// from these two buttons.
function buildMapZoomControls() {
  const zoom = loadMapZoom();
  const row = document.createElement('div');
  row.className = 'map-zoom-controls';
  const btn = (action, label, title, disabled) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-zoom-btn';
    b.dataset.keepsSelection = '';
    b.dataset.holdsPoll = '';
    b.dataset.zoomAction = action;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.disabled = !!disabled;
    b.textContent = label;
    return b;
  };
  row.appendChild(btn('out', '−', 'Zoom out', zoom <= MAP_ZOOM_MIN));
  const pct = document.createElement('span');
  pct.className = 'map-zoom-pct';
  pct.textContent = `${Math.round(zoom * 100)}%`;
  row.appendChild(pct);
  row.appendChild(btn('in', '+', 'Zoom in', zoom >= MAP_ZOOM_MAX));
  row.appendChild(btn('fit', 'Fit', 'Fit the whole graph in the panel', false));
  return row;
}

// Built from MAP_OPTION_VALUES so a value the options module offers cannot go
// unlabelled. Clicks ride #map-view's delegated listener (data-key / data-val).
const MAP_OPTION_LABELS = {
  parentLines: {
    label: 'Parent lines',
    hint: 'A dashed line joins a parent to its children. Chain ends: only the children where their dependency chain meets the parent (parent below: the children no sibling waits for; parent above: the children that wait for no sibling), plus every child with no dependency to a sibling. All: every child. Off: none.',
    values: { chain: 'chain ends', all: 'all', off: 'off' },
  },
  depLines: {
    label: 'Dependency lines',
    hint: 'The solid arrows for waiting_for.',
    values: { on: 'on', off: 'off' },
  },
  group: {
    label: 'Graphs',
    hint: 'One small graph per tree (cards joined by any dependency or parent, drawn or not), biggest first, each under its root titles; or everything in one graph.',
    values: { tree: 'one per tree', one: 'one graph' },
  },
  parent: {
    label: 'Parent sits',
    hint: 'Below its children, as the end of their work, or above them, as a tree reads.',
    values: { below: 'below', above: 'above' },
  },
  align: {
    label: 'Align',
    hint: 'Where each row of cards sits in its graph, and each graph on the page.',
    values: { center: 'center', left: 'left' },
  },
  order: {
    label: 'Row order',
    hint: 'Left to right within each row. By status: doing, todo, backlog, other live statuses in column order, done, archived, then stubs; ties keep the layout order. Layout: as the layout falls.',
    values: { status: 'by status', layout: 'layout' },
  },
  relayout: {
    label: 'Layout',
    hint: 'Keep: cards stay where every relation puts them, so a line toggle never moves one. Reflow: cards are placed by the lines drawn.',
    values: { keep: 'keep', reflow: 'reflow' },
  },
  cards: {
    label: 'Cards',
    hint: 'Rich: the type chip, the altitude badge and, on a parent, its roll-up bar (a click on the bar flips every bar). Plain: id and title only.',
    values: { rich: 'rich', plain: 'plain' },
  },
};

function mapOptionsRowHtml(options) {
  return Object.keys(MAP_OPTION_VALUES).map((key) => {
    const meta = MAP_OPTION_LABELS[key];
    const buttons = MAP_OPTION_VALUES[key].map((value) => {
      const on = options[key] === value;
      return `<button type="button" class="map-option-btn${on ? ' active' : ''}" data-key="${key}" data-val="${value}" aria-pressed="${on}" data-keeps-selection data-holds-poll>${escapeHtml(meta.values[value])}</button>`;
    }).join('');
    return `<span class="map-option" title="${escapeHtml(meta.hint)}"><span class="map-option-label">${escapeHtml(meta.label)}</span><span class="map-option-seg" role="group" aria-label="${escapeHtml(meta.label)}">${buttons}</span></span>`;
  }).join('');
}

// The row is always shown: the option panel it stands in is what hides it.
function buildMapOptionsRow() {
  const row = document.createElement('div');
  row.className = 'map-options';
  row.insertAdjacentHTML('beforeend', mapOptionsRowHtml(loadMapOptions()));
  return row;
}

// The map's fold toggles (the graphs, No relations) share
// this header shape — a chevron toggle (same CHEVRON_LEFT/RIGHT_ICON +
// .column-toggle look as the board's per-column collapse) plus a label.
// data-section names which entry of loadMapSectionsCollapsed() the click flips; the
// delegated #map-view listener (see the map wiring section) reads it.
function buildMapSectionHeader(section, label, collapsed) {
  const header = document.createElement('div');
  header.className = 'map-section-header';
  header.innerHTML =
    `<button type="button" class="map-section-toggle" data-section="${section}" ` +
      `aria-label="${collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(label)}" aria-expanded="${!collapsed}" data-keeps-selection>` +
      (collapsed ? CHEVRON_RIGHT_ICON : CHEVRON_LEFT_ICON) +
    `</button>` +
    `<span>${escapeHtml(label)}</span>`;
  return header;
}

// The layered SVG, wrapped in a collapse/expand toggle — state
// persists per board (loadMapSectionsCollapsed) and survives the 5s poll like
// every other memoized view preference. Collapsed skips layerNodes()/
// buildMapSvg() entirely (nothing to lay out while hidden), not just a CSS
// hide — the graph is the expensive part of this view.
function buildMapGraphSection(graphs, draw, collapsed) {
  const wrap = document.createElement('div');
  wrap.className = 'map-graph-section';
  wrap.appendChild(buildMapSectionHeader('graph', mapGraphSectionLabel(graphs, draw.group), collapsed));
  if (!collapsed) {
    const zoom = loadMapZoom();
    // One wrapper holds every tree, so a two-finger pinch scales them all at once (wireMapPanZoom).
    const trees = document.createElement('div');
    trees.className = 'map-trees';
    for (const graph of graphs) {
      if (draw.group === 'tree') {
        const heading = document.createElement('div');
        heading.className = 'map-graph-heading';
        heading.innerHTML = mapGraphHeadingHtml(graph);
        trees.appendChild(heading);
      }
      const layer = layerNodes(graph.ids, graph.layoutEdges);
      const svg = buildMapSvg(graph, layer, draw);
      applyMapZoomToSvg(svg, zoom);
      trees.appendChild(svg);
    }
    wrap.appendChild(trees);
  }
  return wrap;
}

function mapGraphSectionLabel(graphs, group) {
  return `${mapGraphsLabel(graphs, group)}:`;
}

function mapGraphHeadingHtml(graph) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const named = mapRootsText(graph, (id) => truncateLabel(cardTitleDisplay(byId.get(id)).text, 32));
  return `<strong>${escapeHtml(named)}</strong><span>${mapGraphCounts(graph)}</span>`;
}

// Scales the SVG's rendered width/height attributes by `zoom`, leaving the
// viewBox (already the logical size — see buildMapSvg) untouched: the same
// "zoom the attributes, not a CSS transform" mechanism the ticket asks for,
// so the .map-view panel's overflow:auto scroll area tracks the true
// on-screen box exactly (a transform would leave the box's LAYOUT size at
// 1x, decoupling the scrollbars from what's actually visible).
function applyMapZoomToSvg(svg, zoom) {
  const logicalWidth = Number(svg.dataset.logicalWidth) || 0;
  const logicalHeight = Number(svg.dataset.logicalHeight) || 0;
  svg.setAttribute('width', String(logicalWidth * zoom));
  svg.setAttribute('height', String(logicalHeight * zoom));
}

// Cards no relation touches (no dependency, no parent, no children) render as
// a detached row below the graphs, never hidden
// behind a "show" toggle: a toggle would be one more piece of UI
// state to persist/compose with view mode + search + sort + collapse, for a
// case that's common on most boards and cheap to
// just always show. Reuses cardEl's board tile look so a card reads the same
// wherever it appears.
// The section IS collapsible, though —
// loadMapSectionsCollapsed's own state (not a fresh toggle-per-view) is what
// makes it cheap: one more merged boolean, not new persisted UI state design.
function buildIsolatedRow(ids, allCards, collapsed) {
  const byId = new Map(allCards.map((c) => [c.id, c]));
  const wrap = document.createElement('div');
  wrap.className = 'map-isolated';
  wrap.appendChild(buildMapSectionHeader('isolated', `No relations (${ids.length}):`, collapsed));
  if (!collapsed) {
    const row = document.createElement('div');
    row.className = 'map-isolated-row';
    ids.forEach((id) => {
      const card = byId.get(id);
      if (!card) return;
      const tile = card.archived ? archiveCardEl(card) : cardEl(card);
      tile.draggable = false; // the map isn't a drag surface
      // cardEl/archiveCardEl already stamp card-el + data-id, so the
      // shared grammar handlers cover these tiles with no extra wiring.
      row.appendChild(tile);
    });
    wrap.appendChild(row);
  }
  return wrap;
}

// Rich rows are HTML in foreignObjects so typeBadge, altitudeBadge and rollupBar
// stay the board's own renderers, and a click on a bar reaches the board's own
// handler (every bar flips; the card does not open).
const MAP_RICH_TOP = 40;
const MAP_RICH_META_H = 16;
const MAP_RICH_BAR_OPEN_H = 30;
const MAP_RICH_BAR_THIN_H = 10;
// Id and title only: no row for a pill, so shorter than a plain node's 58.
const MAP_RICH_BARE_H = 46;
const MAP_RICH_DIMS = { top: MAP_RICH_TOP, metaH: MAP_RICH_META_H, barGap: 3, bottom: 8, bareH: MAP_RICH_BARE_H };

function mapRichLayout(n, draw) {
  if (draw.cards !== 'rich' || !n || n.ghost || n.missing || n.external) return null;
  const card = draw.byId && draw.byId.get(n.id);
  const type = state.typesOn !== false && card && card.type != null ? String(card.type).trim() : '';
  const alt = nestingIndex.altitudeOf(n.id);
  const mode = loadRollupBarMode();
  const rollup = alt ? nestingIndex.rollup(n.id, { countArchived: countArchivedLeaves() }) : null;
  const hasBar = !!(rollup && rollup.total);
  const hasMeta = !!type || alt >= 1 || !!n.blocked;
  const barH = mode === ROLLUP_BAR_OPEN ? MAP_RICH_BAR_OPEN_H : MAP_RICH_BAR_THIN_H;
  return Object.assign({ type, alt, rollup, mode, hasMeta, hasBar }, mapRichBox(hasMeta, hasBar, barH, MAP_RICH_DIMS));
}

function mapNodeSize(n, draw) {
  const rich = mapRichLayout(n, draw);
  return { h: rich ? rich.h : MAP_NODE_H, rich };
}

function mapRichHtml(n, rich, statuses) {
  let html = '';
  const x0 = n.blocked ? 56 : 8;
  if (rich.type || rich.alt >= 1) {
    html += `<foreignObject class="map-rich" x="${x0}" y="${rich.metaY}" width="${MAP_NODE_W - x0 - 8}" height="${MAP_RICH_META_H}">` +
      `<div class="map-rich-meta">${typeBadge({ type: rich.type }, state.types, state.typesOn)}${altitudeBadge(rich.alt)}</div></foreignObject>`;
  }
  if (rich.hasBar) {
    html += `<foreignObject class="map-rich" x="8" y="${rich.barY}" width="${MAP_NODE_W - 16}" height="${rich.barH}">` +
      `<div class="map-rich-bar">${rollupBar(rich.rollup, rich.mode, statuses)}</div></foreignObject>`;
  }
  return html;
}

// Builds the layered SVG: nodes positioned by layerNodes()'s layer assignment
// (top-down, one row per layer, left-to-right by draw.order within a row), edges as
// arrowed paths (dep -> waiter: an edge A -> B means "B waits for A"). A
// "back edge" (target layer <= source layer — only possible when layerNodes
// had to force-break a cycle) routes as a side-bowed curve instead of a
// straight line, so a cycle stays visually distinct rather than overlapping
// the normal downward flow.
function buildMapSvg(graph, layer, draw) {
  const allById = new Map();
  graph.nodes.forEach((n) => allById.set(n.id, Object.assign({ ghost: false }, n)));
  graph.ghosts.forEach((g) => allById.set(g.id, Object.assign({ ghost: true }, g)));

  const layers = new Map(); // layerIndex -> [ids] left to right
  for (const [id, l] of layer) {
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l).push(id);
  }
  for (const [l, ids] of layers) {
    ids.sort(kanbanIds.compareIds); // the layout's own order is the tie-break for the status order (a stub's id is no id and sorts last)
    layers.set(l, mapOrderRow(ids, graph, draw.order, draw.statuses));
  }
  const sizes = new Map();
  const heights = new Map();
  for (const id of layer.keys()) {
    const size = mapNodeSize(allById.get(id), draw);
    sizes.set(id, size);
    heights.set(id, size.h);
  }
  const { pos, bottom } = mapRowPositions(layers, heights, draw.align, MAP_DIMS);

  const BACK_EDGE_BOW = MAP_NODE_W * 0.9;
  // Canvas width is the true rightmost extent in play, not just the widest
  // row of nodes — a back-edge's sideways bow (see below) can reach past
  // every node's right edge when its row has only one member (e.g. an
  // isolated 2-cycle, filtered down to just itself), and a width that only
  // accounted for node columns would clip that curve at the edge.
  let maxX = MAP_PAD;
  for (const p of pos.values()) maxX = Math.max(maxX, p.x + MAP_NODE_W);

  let edgesSvg = '';
  graph.edges.forEach((e) => {
    // A dependency between two cards under one parent draws like any other.
    const from = pos.get(e.from);
    const to = pos.get(e.to);
    if (!from || !to) return; // defensive: every edge endpoint is always laid out, but never let a mismatch crash the render
    const dimmed = e.fromGhost || e.toGhost;
    const backEdge = (layer.get(e.to) || 0) <= (layer.get(e.from) || 0);
    const x1 = from.cx, y1 = from.y + from.h, x2 = to.cx, y2 = to.y;
    let d;
    if (backEdge) {
      maxX = Math.max(maxX, x1 + BACK_EDGE_BOW, x2 + BACK_EDGE_BOW);
      d = `M${x1},${y1} C${x1 + BACK_EDGE_BOW},${y1} ${x2 + BACK_EDGE_BOW},${y2} ${x2},${y2}`;
    } else {
      const midY = (y1 + y2) / 2;
      d = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
    }
    edgesSvg += `<path class="map-edge${backEdge ? ' back-edge' : ''}${dimmed ? ' ghost-edge' : ''}" d="${d}" marker-end="url(#map-arrow)"></path>`;
  });

  if (graph.lines.length) {
    const drawn = buildParentLinesSvg(graph, pos, layer, draw.parent);
    edgesSvg += drawn.svg;
    maxX = Math.max(maxX, drawn.maxX);
  }

  const width = maxX + MAP_PAD;
  const height = Math.max(MAP_NODE_H + MAP_PAD * 2, bottom + MAP_PAD);

  let nodesSvg = '';
  for (const [id, p] of pos) {
    const n = allById.get(id);
    if (!n) continue;
    const missing = !!n.missing;
    // Only REAL nodes join the shared card-el grammar (selection +
    // context menu). Ghost stubs stay click-through-to-detail only: a ghost
    // stands for a card the active search filter deliberately hid, and the
    // board never lets a filtered-out card join a selection (it isn't rendered
    // there at all) — so its stub must not smuggle hidden cards into a bulk
    // batch either. Archived cards that MATCH the filter render as real nodes
    // and are selectable. A `missing` stub has no card to act on.
    const selectable = !n.ghost && !missing;
    // The node border is one neutral weight for every node (see
    // .map-node rect in app.css) — status (its own dot) never fights over
    // that single stroke channel with archive.
    // `archived` still rides the group class: its neutral-grey
    // border mute is the one exception, same as selection glow
    // / ghost dashing / the back-edge amber all keeping their own treatments.
    // priority/waiting join that same channel — same board-tile
    // parity `priorityBadge`+`isWaiting` gives cardEl (app.js), reused
    // straight off the node's own `priority`/`waiting` fields (computed once
    // in dependency-graph.js, structural — no config needed there) instead of
    // re-deriving from a full card lookup. Mutually exclusive with `archived`,
    // same as the board: archiveCardEl never applies pb.className/waiting
    // either, so an archived node keeps ONLY its grey mute, never both cues
    // fighting over one stroke. The amber stroke
    // marks WAITING (unresolved waiting_for
    // deps); the manual blocked sticker is the separate red
    // pill below, not a border.
    const pb = (!missing && !n.archived) ? priorityBadge(n, state.priorities) : { className: '' };
    const cls = `map-node${n.ghost ? ' ghost' : ''}${missing ? ' missing' : ''}${n.archived ? ' archived' : ''}` +
      `${pb.className ? ` ${pb.className}` : ''}${(!missing && !n.archived && n.waiting) ? ' waiting' : ''}` +
      `${selectable ? ' card-el' : ''}${selectable && paintsSelected(id) ? ' selected' : ''}` +
      `${selectable && isHoverHighlighted(hoverLit, id) ? ' hover-highlight' : ''}`;
    const idLabel = n.external ? n.external : `#${id}`;
    // Same empty-title-shows-the-prompt fallback every
    // other view uses (cardTitleDisplay, card-title.js) — n already carries
    // `prompt` (dependency-graph.js's cardToNode). A missing stub has no
    // card behind it at all, so it keeps its own '(not found)' text instead.
    const titleDisplay = cardTitleDisplay(n);
    const titleLine = n.external ? '(other board)' : missing ? '(not found)' : truncateLabel(titleDisplay.text, 22);
    const tooltip = n.external
      ? `${n.external} — parent on another board, not drawn on this map`
      : missing
      ? `#${id} — referenced but not found on the board`
      : `#${id} ${titleDisplay.text}${n.archived ? ' (archived)' : ''}`;
    // Status lives on its own dot — a filled circle. A non-built-in
    // status (custom column or unlisted on-disk value) gets one of the 8
    // hashed `status-palette-N` classes (never the deterministic hash
    // written straight into an inline fill-style
    // attribute, which a strict `style-src 'self'` CSP silently
    // blocks — statusColorClass() is the one source both this dot and
    // statusBadge() key off).
    // STATUS DOTS NEVER MUTE: no archived gate here — a custom
    // status hashes its color on an archived node exactly like a live one; the
    // archived cue is carried by the rect border alone (the one exception).
    // The dot's OWN <title> — SVG-native tooltip — names the RAW on-disk
    // status for every node, not just custom ones.
    const statusDot = missing ? '' :
      `<circle class="map-status-dot status-${statusColorClass(n.status)}" cx="${MAP_NODE_W - 10}" cy="10" r="4"><title>${escapeHtml(n.status)}</title></circle>`;
    // The archived ball: the
    // second right-edge dot, only for a truly archived node — same x column
    // as status (MAP_NODE_W - 10, already proven clear of the truncated
    // title text). Never set for a `missing` stub (its `archived` is always
    // false — dependency-graph.js's own stub shape). Status and this ball
    // are the only right-edge dots.
    const archivedDot = n.archived ? `<circle class="map-archived-dot" cx="${MAP_NODE_W - 10}" cy="${MAP_NODE_H / 2}" r="4"><title>Archived</title></circle>` : '';
    // The red blocked pill — the map twin of the board tile's
    // sticker glyph, bottom-left under the title where no dot column lives.
    // The pill's own <title> carries the reason (SVG-native tooltip; the
    // reason is user data, escaped like every other user string in this
    // SVG). Skipped for missing stubs (no card behind them) but NOT gated
    // off archived — a stop sign is identity, not location, and unlike
    // the waiting stroke it doesn't share a channel with the archived grey mute.
    const rich = sizes.get(id).rich;
    const pillY = rich ? rich.metaY + 1 : MAP_NODE_H - 18;
    const blockedPill = (!missing && n.blocked)
      ? `<g class="map-blocked-pill"><title>${escapeHtml(n.blockedReason ? `blocked: ${n.blockedReason}` : 'blocked')}</title>` +
        `<rect x="8" y="${pillY}" width="46" height="13" rx="6.5"></rect>` +
        `<text x="31" y="${pillY + 10}" text-anchor="middle">blocked</text></g>`
      : '';
    nodesSvg +=
      `<g class="${cls}" transform="translate(${p.x},${p.y})"${missing ? '' : ` data-id="${id}"`}${selectable ? ' tabindex="0"' : ''}>` +
        `<title>${escapeHtml(tooltip)}</title>` +
        `<rect width="${MAP_NODE_W}" height="${p.h}" rx="6"></rect>` +
        `<text x="10" y="18" class="map-node-id">${escapeHtml(idLabel)}</text>` +
        `<text x="10" y="34" class="map-node-title${!missing && titleDisplay.isPromptFallback ? ' map-node-title--prompt-fallback' : ''}">${escapeHtml(titleLine)}</text>` +
        statusDot + archivedDot + blockedPill + (rich ? mapRichHtml(n, rich, draw.statuses) : '') +
      `</g>`;
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'map-canvas');
  // width/height are the graph's LOGICAL (1x/100%) pixel size — the caller
  // (buildMapGraphSection) scales these two attributes by the current zoom
  // right after this returns, while viewBox stays fixed at this same box, so
  // the browser rasterizes from one coordinate system at whatever display
  // size (crisp text/strokes at any zoom, no blur a CSS transform would add).
  // Stashed on the dataset too — the zoom controls' Fit button reads it back
  // to compute fitMapZoom() without re-running layerNodes()/buildMapSvg().
  svg.dataset.logicalWidth = String(width);
  svg.dataset.logicalHeight = String(height);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML =
    `<defs><marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z"></path></marker>` +
      `<marker id="map-parent-dot" class="map-parent-dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5">` +
      `<circle cx="5" cy="5" r="4"></circle></marker></defs>` +
    edgesSvg + nodesSvg;
  paintRollupBars(svg);
  paintTypeColors(svg);
  return svg;
}

// The dot is on the parent's end, which has no arrowhead: the start when the
// parent sits above its children, the end when below.
function buildParentLinesSvg(graph, pos, layer, parentSits) {
  const { paths, maxX } = mapParentLinePaths(graph, pos, layer, parentSits, MAP_DIMS);
  const dot = parentSits === 'above' ? 'marker-start' : 'marker-end';
  const svg = paths.map((p) => `<path class="map-edge map-parent-line${p.dimmed ? ' ghost-edge' : ''}" d="${p.d}" ${dot}="url(#map-parent-dot)"></path>`).join('');
  return { svg, maxX };
}

async function fetchBoard() {
  return api('GET', '/api/board');
}

// document.title is a plain-text property (never HTML-parsed), so the raw name goes
// there directly — running it through escapeHtml first would show literal "&amp;"
// entities in the tab instead of "&". The heading span IS DOM markup (innerHTML), so
// it gets escapeHtml like every other filesystem/card-derived string in this file.
// The BOARD NAME IS the tab title and the heading — no app label anywhere in either:
// the app is a kanban, and a "Kanban" label only buried the one token that tells
// boards apart, the field that gets truncated when several kanban tabs sit side by
// side. It arrives from /api/board already
// resolved: config.yaml's declared `name:`, else the parent-folder fallback. The
// state field keeps its projectName spelling — it is also the localStorage
// namespace for every per-board view preference.
function applyProjectName(name) {
  const next = name || '';
  if (next !== state.projectName) {
    // The persisted-state caches (collapse/sort/fullscreen/view mode) memoize
    // on first access, and their storage key is namespaced by projectName. A
    // render that fires before the first /api/board response (typing in search,
    // an early "+ New card" click) would seed them from kanban.default.* and
    // then clobber the real per-project values on the next save — so any
    // projectName change invalidates all of them, forcing a re-load under the
    // correct key on next access.
    collapsedColumns = null;
    phoneColumn = null;
    columnSort = null;
    columnSortPicks = null;
    modalFullscreen = null;
    viewMode = null; // view.mode joins the same discipline
    rollupBarMode = null; // rollup.bar too
    prefsMemo = null; // the preferences entry too
    typingIsolatesMemo = null; // typing.isolates too
    iterationUi.choice = undefined; // the iteration pick too
    mapStatusFilter = null; // map.statusFilter too
    calendarSubview = null; // calendar.subview too
    calendarNotes = null; // calendar.notes too
    calendarNotesWidth = CAL_NOTES_UNREAD; // calendar.notesWidth too
    ganttSubview = null; // gantt.subview too
    mapSectionsCollapsed = null; // map.sections.collapsed too
    mapZoom = null; // map.zoom too
    mapOptions = null; // map.options too
    hoverShowMemo = null; // hover.show too
    ganttStatusFilter = null; // gantt.statusFilter too — applyStatuses' own reset doesn't fire on a pure rename with an unchanged status list
    calendarStatusFilter = null; // calendar.statusFilter too, same reasoning
    resetGraphViewState(); // graph memos too
  }
  state.projectName = next;
  document.title = name || 'Kanban App';
  $('#project-name').innerHTML = name ? escapeHtml(name) : 'Kanban';
}

function applyHomeUrl(url) {
  const link = $('#home-link');
  if (!link) return;
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    link.href = url;
    link.classList.remove('hidden');
  } else {
    link.removeAttribute('href');
    link.classList.add('hidden');
  }
}

// The page keys every card on the id module's whole-id string (`7`, `G7`), whether the
// server sent the id as a number or as a string; a waiting_for entry and a plain parent
// are held the same way.
function pageId(id) {
  const key = kanbanIds.idKey(id);
  return key === null ? String(id) : key;
}

function pageCard(card) {
  card.id = pageId(card.id);
  if (Array.isArray(card.waiting_for)) card.waiting_for = card.waiting_for.map(pageId);
  if (typeof card.parent === 'number') card.parent = pageId(card.parent);
  return card;
}

function applyBoardData(data) {
  state.active = data.active.map(pageCard);
  state.archived = data.archived.map(pageCard);
  state.boardDir = data.boardDir || ''; // absolute board path for the header copy button (defensive ||: an old server without the field degrades to the honest empty-path toast)
  applyHomeUrl(data.homeUrl);
  applyProjectName(data.projectName); // must run before renderBoard: collapse state's storage key is namespaced by projectName
  applyStatuses(data.statuses || []); // must also run before renderBoard — the column set drives every render below
  // The registry feeds the form's assignee suggestions — and
  // it's a render input too (the Assignee sort ranks by registry
  // order), so it must ALSO run before renderBoard: a persisted Assignee sort
  // is live on the very first paint after reload, and rendering with the
  // seeded-empty registry degrades it to plain lexicographic until the next
  // poll silently reshuffles the column.
  applyAssignees(data.assignees || []);
  // Official lists feed the form's comboboxes — before renderBoard
  // for the same reason: the Priority sort/badges read state.priorities at
  // render time (masked pre-move only by priorityRank's built-in fallback).
  applyLists(data.priorities || [], data.tags || []);
  const view = boardTypeView(data); // the one gate for types off (ADR 0018): empty lists when the board says typesOn: false, the board's own otherwise; defensive for an old server without the fields
  state.typesOn = view.typesOn; // chips and the form's Type field read it
  state.types = view.types; // chips read it at render time
  state.hierarchy = view.hierarchy; // type names, top tier first, as the config wrote them (duplicates and case are the readers' to normalise)
  state.pills = data.pills || []; // [{label, query}] the board's own pills; same old-server fallback
  state.archivePackages = data.archivePackages || []; // archive popup's combobox reads it live; defensive || for an old server without the field
  state.groups = data.groups || null; // { folder, list, skipped, folders, prefixes } when config.yaml has a groups: line, else null and nothing of it shows (groups.js, groups-ui.js); read by the card tiles and the search, so before renderBoard
  state.settings = data.settings || null; // the config the gear's This board pages show (settings-ui.js); null until the first payload
  state.iterations = !!data.iterations; // iterations: true over a groups: line adds the header's dropdown (iterations-ui.js)
  state.scratchpad = data.scratchpad || null; // { folder, targets } when config.yaml has a scratchpad: line, else null and nothing of it shows (scratchpad-ui.js); targets are the ids that have a page
  state.todos = data.todos || null; // { folder, targets, counts } when config.yaml has a todos: line, else null and nothing of it shows (todos-ui.js); counts are { id: { open, total } }, read by the card tiles
  state.logbook = data.logbook || null; // { folder, notes } when config.yaml has a logbook: line, else null and nothing of it shows (notes.js, notes-palette.js); read by the card tiles, so before renderBoard
  dropGoneCards(); // before render, so a card a poll found gone is not an invisible part
  // Cards became focusable in #261 and renderBoard() rebuilds every one of
  // them, so an unattended poll would drop a Tab-navigating user's focus to
  // <body>. The header controls solve that by blocking the refresh
  // (boardControlFocused) — a card can't, since an ordinary click leaves one
  // focused indefinitely and blocking would freeze the board. Re-find it by
  // id instead. Refocusing fires focusin, which repoints the hover wash at
  // the focused card, so put the pointer's own card back after.
  const focusedCard = document.activeElement && document.activeElement.closest && document.activeElement.closest('.card-el');
  const focusedCardId = focusedCard ? focusedCard.dataset.id : null;
  const pointerId = hoveredId;
  const control = focusedRebuiltControl();
  const controlSel = control ? refocusSelector(control) : null;
  // A caption of the Graph's tier fan is a tab stop the render rebuilds, so it is found
  // again by its key (graphCaptionEl); focusing it shows its tip again.
  const caption = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-caption]') : null;
  const captionKey = caption ? caption.getAttribute('data-caption') : null;
  renderBoard();
  if (controlSel) {
    const again = document.querySelector(controlSel);
    if (again) again.focus({ preventScroll: true });
    if (hoveredId !== pointerId) setHoveredId(pointerId);
  }
  if (captionKey !== null) {
    const again = document.querySelector(`[data-caption="${captionKey}"]`);
    if (again) again.focus({ preventScroll: true });
  }
  if (focusedCard) {
    const again = cardElInShownView(focusedCardId, focusedCard);
    if (again) again.focus({ preventScroll: true });
    if (hoveredId !== pointerId) setHoveredId(pointerId);
  }
  notesOnBoard(); // the notes palette, when open, follows the payload
  applyNotifications(data.notifications || []); // the board poll carries them — no separate timer
}

// The card's element in the view that shows. The other views stay in the page, hidden, and the Board comes first,
// so a lookup over the whole document would find a hidden copy. `from` is the element that had the focus: the Graph
// has a second element for some cards, and finds again the kind `from` was (graphCardEl).
function cardElInShownView(id, from) {
  const mode = loadViewMode();
  const root = $(VIEW_CONTAINERS[mode]);
  if (!root) return null;
  return mode === 'graph' ? graphCardEl(root, id, from) : root.querySelector(`.card-el[data-id="${id}"]`);
}

async function loadBoard() {
  applyBoardData(await fetchBoard());
  refreshOpenDetail();
}

// --- Auto-refresh: poll loadBoard() every 5s via the same path as the manual
// Refresh button, but never while the user is mid-interaction. The skip predicate
// itself lives in refresh-policy.js (pure, no DOM) so it's unit-testable from Node;
// this just gathers the current DOM/drag/visibility state and asks it.
const AUTO_REFRESH_MS = 5000;
// Every render reads the clock, so "today" follows it on the poll; the clock tick below draws the
// views again when the day turned and the poll could not (the server is away, or a popup holds it).
// clockDay is the day the last tick saw.
let clockDay = '';
const CLOCK_TICK_MS = 15000;
let isDragging = false;
// Count of in-flight onDrop() calls: optimistic update applied, PATCH not yet
// settled. dragend already fires before the PATCH resolves, so isDragging alone
// leaves a window where a poll can land mid-flight and clobber the optimistic
// move; this closes it without being fooled by rapid back-to-back drops.
let pendingDrops = 0;
let autoRefreshStale = false;

// Any open modal — edit form, detail popup, or any future popup that follows the
// same .modal-backdrop + .hidden convention (e.g. an AI-assist popup) — blocks a poll.
function anyModalOpen() {
  return !!document.querySelector('.modal-backdrop:not(.hidden)');
}

// The sort controls live inside #board, which renderBoard() wipes
// (innerHTML = '') on every render, including unattended poll ticks. The
// search input was deliberately kept outside #board to dodge this exact
// class of bug (see currentSearchTerms() above); the sort controls can't be,
// since they're per-column. Losing focus mid-render is a paper cut, but a
// focused <select> is worse: removing it from the document while its native
// option popup is open silently closes that popup with no error, cancelling
// whatever the user was about to pick. Treat a focused sort control as
// blocking a refresh the same way an open modal does.
// Every member below is a control the user is MOMENTARILY inside. Cards are
// not, even though #261 made them focusable: a plain click leaves one focused
// and nothing takes that focus back, so listing .card-el here would freeze
// the poll for the rest of the session — no stale indicator, no error, just a
// board that quietly stops updating. applyBoardData re-finds the focused card
// and rebuilt control after its render instead.
// The controls that hold the poll carry data-holds-poll; a control built by a
// render path must wear it, and a status pill, fold toggle or option button must not.
function boardControlFocused() {
  const el = document.activeElement;
  // Status pills, fold toggles and option buttons are not here: they are rebuilt by every
  // render, so applyBoardData refocuses the focused one instead of freezing the poll.
  return !!(el && el.closest && el.closest('[data-holds-poll]'));
}

function setStale(stale) {
  if (stale === autoRefreshStale) return;
  autoRefreshStale = stale;
  $('#stale-indicator').classList.toggle('hidden', !stale);
}

function autoRefreshSkipState() {
  return {
    modalOpen: anyModalOpen(),
    dragging: isDragging || pendingDrops > 0,
    hidden: document.visibilityState !== 'visible',
    boardControlFocused: boardControlFocused(),
  };
}

async function autoRefreshTick() {
  if (shouldSkipAutoRefresh(autoRefreshSkipState())) return;
  try {
    const data = await fetchBoard();
    // Re-check: a drag/modal/hide can start while this request was in flight.
    // Drop the response rather than render over an interaction that started
    // mid-poll — the next tick (or the interaction's own completion) catches up.
    if (shouldSkipAutoRefresh(autoRefreshSkipState())) return;
    applyBoardData(data);
    setStale(false);
  } catch (e) {
    setStale(true); // quiet: no toast storm on repeated failures, just a subtle indicator; recovers silently above
  }
}

// The clock moved on: the views draw again when the day turned (unless a popup or a drag holds the
// board, as for the poll; the next tick tries again), and an open notes palette shows the day and
// time it would write now. Also run when the page becomes visible again.
function clockTick() {
  if (document.visibilityState !== 'visible') return;
  const today = localTodayStr();
  if (today !== clockDay && !shouldSkipAutoRefresh(autoRefreshSkipState())) {
    clockDay = today;
    renderBoard();
  }
  notesFollowClock();
}

// Archive column parity: every tile drags and every column —
// Archive included — accepts drops. A drop on Archive archives the batch; a
// drop of archived cards on a live column restores them there. Routing
// happens at drop time: anything touching archive goes through dragPlan's
// confirm matrix, pure live→live keeps the old paths untouched.
function wireDrag() {
  $('#board').querySelectorAll('.card').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.classList.add('dragging');
      isDragging = true;
      // Dragging a selected card while others are selected drags the
      // whole selection. Captured at dragstart — the flag, not the live set,
      // decides at drop time, so a poll pruning the set mid-drag can't flip
      // a bulk drag into a single-card one halfway through.
      const dragged = bulkTargets();
      bulkDragIds = (dragged.length > 1 && dragged.some((c) => c.id === el.dataset.id)) ? dragged.map((c) => c.id) : null;
      dragCardId = el.dataset.id;
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      isDragging = false;
      dragCardId = null;
      refusedDrop.key = '';
      clearDropMarks();
      bulkDragIds = null; // drop (if any) already consumed it — this catches cancelled drags, which would otherwise replay a stale bulk move
    });
  });
  document.querySelectorAll('.column').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
      if (dragCardId !== null && isReorderDrop(bulkDragIds || [dragCardId], col.dataset.col)) {
        const point = dropPoint(col, dragCardId, e.clientY);
        const { prev, next } = dropAmong(col, point);
        if (dropRefused(dragCardId, prev, next)) clearDropMarks();
        else markDropPoint(point.tiles, point.at);
      } else {
        clearDropMarks();
      }
    });
    col.addEventListener('dragleave', (e) => {
      if (col.contains(e.relatedTarget)) return;
      col.classList.remove('drag-over');
      clearDropMarks();
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      clearDropMarks();
      const id = e.dataTransfer.getData('text/plain');
      const ids = bulkDragIds || [id];
      bulkDragIds = null;
      const dest = col.dataset.col;
      if (isReorderDrop(ids, dest)) { reorderDrop(col, ids[0], e.clientY); return; }
      const touchesArchive = dest === 'archive' || ids.some((i) => state.archived.some((a) => a.id === i));
      if (touchesArchive) archiveAwareDrop(ids, dest);
      else if (ids.length > 1) onBulkDrop(ids, dest);
      else onDrop(ids[0], dest);
    });
  });
}

// Drops that touch archive in either direction. No optimistic
// render — a file move plus a status write isn't worth faking; the confirm
// already broke the gesture's flow, so the loadBoard round-trip is fine.
async function archiveAwareDrop(ids, dest) {
  const byId = new Map([...state.active, ...state.archived].map((c) => [c.id, c]));
  const plan = dragPlan(ids, byId, dest, refusesDoing);
  const actionable = plan.toArchive.length + plan.toRestore.length + plan.toMove.length;
  if (!actionable && !plan.refused.length) return;
  if (plan.confirmMessage && !confirm(plan.confirmMessage)) return;
  pendingDrops++;
  const failed = [];
  try {
    for (const c of plan.toArchive) {
      try { await api('POST', `/api/cards/${c.id}/archive`); }
      catch (e) { failed.push(`#${c.id} (${e.message})`); }
    }
    for (const c of plan.toRestore) {
      try {
        await api('POST', `/api/cards/${c.id}/restore`);
        if (c.status !== dest) await api('PATCH', `/api/cards/${c.id}`, { status: dest });
      } catch (e) { failed.push(`#${c.id} (${e.message})`); }
    }
    for (const c of plan.toMove) {
      try { await api('PATCH', `/api/cards/${c.id}`, { status: dest }); }
      catch (e) { failed.push(`#${c.id} (${e.message})`); }
    }
    await loadBoard();
  } finally {
    pendingDrops--;
  }
  const parts = [];
  if (plan.toArchive.length) parts.push(`Archived ${plan.toArchive.length - failed.filter((f) => plan.toArchive.some((c) => f.startsWith(`#${c.id} `))).length} card(s)`);
  const landed = plan.toRestore.length + plan.toMove.length;
  if (landed) parts.push(`moved ${landed - failed.filter((f) => !plan.toArchive.some((c) => f.startsWith(`#${c.id} `))).length} to ${dest}${plan.toRestore.length ? ` (${plan.toRestore.length} restored)` : ''}`);
  if (plan.refused.length) parts.push(`skipped ${plan.refused.map((c) => `#${c.id} (${refusalWord(c)})`).join(', ')}`);
  if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
  const note = openLeavesNote(plan.toRestore.concat(plan.toMove).filter((c) => !failed.some((f) => f.startsWith(`#${c.id} `))), dest);
  if (note) parts.push(note);
  if (parts.length) toast(parts.join('; ') + '.');
}

async function onDrop(id, status) {
  const card = state.active.find((c) => c.id === id);
  // A drop onto the column the card already RENDERS in is a no-op — for a
  // parked unlisted status that also means never silently rewriting the raw
  // value the catch-all promised to preserve.
  if (!card || columnForStatus(card.status, state.statuses) === status) return;
  if (status === 'doing' && refusesDoing(card)) { // client-side pre-check (server also enforces); names which gate
    toast(`#${id} is ${isWaiting(card)
      ? `waiting on ${waitingOn(card).map((w) => `#${w.id} (${w.status})`).join(', ')}`
      : blockedLabel(card.blocked)} — can't move to doing.`);
    return;
  }
  const prev = card.status;
  card.status = status;           // optimistic
  renderBoard();
  pendingDrops++;                 // keep auto-refresh skipping through the network round-trip too, not just the DOM gesture (dragend already fired by now)
  try {
    await api('PATCH', `/api/cards/${id}`, { status });
    await loadBoard();            // resync with disk immediately, in case a poll slipped through mid-flight and needs correcting
    const note = openLeavesNote([card], status);
    if (note) toast(`${note}.`);
  } catch (e) {
    card.status = prev;           // revert
    renderBoard();
    if (e.status === 422) {
      toast(`#${id} is ${gate422Text(e.data)} — can't move to doing.`);
    } else {
      toast('Move failed: ' + e.message);
    }
  } finally {
    pendingDrops--;
  }
}

// A single card dropped on the column it already renders in, while that column
// is sorted in outline order, writes a rank instead of moving. The Archive
// column, archived cards and bulk drags keep their own routes.
function isReorderDrop(ids, dest) {
  if (ids.length !== 1 || dest === 'archive') return false;
  const card = state.active.find((c) => c.id === ids[0]);
  return !!card && columnForStatus(card.status, state.statuses) === dest && loadColumnSort()[dest].field === 'outline';
}

function dropPoint(col, dragId, clientY) {
  const tiles = [...col.querySelectorAll('.column-cards > .card')].filter((el) => el.dataset.id !== dragId);
  const mids = tiles.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
  return { tiles, at: dropSlot(mids, clientY) };
}

function clearDropMarks() {
  document.querySelectorAll('.card.drop-before, .card.drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
}

function markDropPoint(tiles, at) {
  clearDropMarks();
  if (!tiles.length) return;
  if (at < tiles.length) tiles[at].classList.add('drop-before');
  else tiles[tiles.length - 1].classList.add('drop-after');
}

function dropAmong(col, point) {
  return dropNeighbours(point.tiles.map((el) => el.dataset.id), point.at, loadColumnSort()[col.dataset.col].direction);
}

// The drop line is drawn only where reorderCard would take the drop. dragover
// fires many times a second, so the plan is worked out again only when the
// pointer moves to another spot.
let refusedDrop = { key: '', refused: false };

function dropRefused(id, prev, next) {
  const key = `${id}:${prev}:${next}`;
  if (refusedDrop.key !== key) {
    const plan = reorderPlan(state.active.concat(state.archived), id, { prev, next }, nestingCtx());
    refusedDrop = { key, refused: !!plan.error };
  }
  return refusedDrop.refused;
}

function reorderDrop(col, id, clientY) {
  const { prev, next } = dropAmong(col, dropPoint(col, id, clientY));
  if (prev === null && next === null) return;
  reorderCard(id, prev, next);
}

// onDrop's lifecycle for a rank: the same pure answer the server will give is
// shown at once, and put back if the call fails.
async function reorderCard(id, prev, next) {
  const cards = state.active.concat(state.archived);
  const plan = reorderPlan(cards, id, { prev, next }, nestingCtx());
  if (plan.error) {
    toast(`#${id} can only be reordered among its siblings.`);
    return;
  }
  const writes = reorderWrites(id, plan);
  if (!writes.length) return;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const was = writes.map((w) => [byId.get(w.id), byId.get(w.id).rank]);
  writes.forEach((w) => { byId.get(w.id).rank = w.rank; });
  renderBoard();
  pendingDrops++;
  try {
    try {
      await api('POST', `/api/cards/${id}/reorder`, { prev, next });
    } catch (e) {
      was.forEach(([c, rank]) => { c.rank = rank; });
      renderBoard();
      toast('Reorder failed: ' + e.message);
    }
    await loadBoard(); // after a failure too: the server may have written some of the cards
  } catch (e) {
    toast('Load failed: ' + e.message);
  } finally {
    pendingDrops--;
  }
}

// ?card=<id>&q=<search>&view=<board|map|gantt|calendar|graph> deep links
// (deep-link.js owns the pure querystring parse) — consumed exactly ONCE,
// chained directly onto
// the very first loadBoard() below. Nothing re-checks location.search after
// this: the 5s poll goes through autoRefreshTick/applyBoardData, never
// loadBoard(), and every other loadBoard() call site (manual refresh,
// post-drag resync) is a separate call this function is never chained onto —
// so the deep link "wins" on load, then gets out of the way exactly as the
// poll and the persisted view mode expect. A bad/unknown id never touches
// viewMode at all: "loads normally" means the persisted view stands.
function consumeDeepLink() {
  const link = parseDeepLink(location.search);
  // A link with no query writes nothing into the box, so nothing would bring its address in
  // line with the empty box: an `isolate=1` it carries would stay until the next write.
  if (!link || !link.q) followSearchInAddress($('#search-input').value);
  if (!link) return;
  // `q` and `view` are applied BEFORE the card is resolved, so a link whose
  // card key is unusable still delivers everything else that parsed.
  if (link.view) {
    // Direct assignment, not toggleView/saveViewMode: this override is for
    // THIS load only (wins ONCE) — it must never overwrite the persisted
    // choice, so a later plain reload (no querystring) still resumes
    // wherever the user last left the view via the normal toggle.
    viewMode = link.view;
  }
  // Straight into the box through its writer, which repaints. There is no
  // query state anywhere: currentSearchTerms() re-reads #search-input on
  // every render, so putting the value there IS applying the filter, and
  // it lands somewhere visible that one gesture clears. The view is set
  // first, so that repaint and the listeners told after it see the link's view.
  if (link.q) {
    // isolate=1 beside the query opens it isolated: isolate is on before the write, so the repaint
    // and the listeners told of it (the address, the chip) see it on.
    if (link.isolate) isolateFromLink(link.q);
    // isolate=0 opens it lit; no parameter is an old link, isolated where the view isolates.
    writeSearch(link.q, linkWriteReason(link.isolateOff));
  } else if (link.view) renderBoard();
  if (!link.hasCard) return;
  if (link.id == null) { toast('Deep link card id is invalid — loaded normally.'); return; }
  const card = state.active.concat(state.archived).find((c) => c.id === link.id);
  if (!card) { toast(`Card #${link.id} not found — loaded normally.`); return; }
  // loadViewMode() rather than viewMode: it returns the memoized viewMode the
  // assignment above just set, and initializes it from storage when no view
  // key was present — so this reads the view actually on screen either way.
  const el = document.querySelector(`${VIEW_CONTAINERS[loadViewMode()]} .card-el[data-id="${card.id}"]`);
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  // On a phone the Board behind the card shows one status: the card's own, set before it opens.
  if (onPhoneLayout()) {
    setPhoneColumn(state.archived.some((c) => c.id === card.id) ? 'archive' : card.status);
    renderBoard();
  }
  openDetailModal(card.id);
}

window.addEventListener('DOMContentLoaded', () => {
  loadBoard().then(consumeDeepLink).catch((e) => toast('Load failed: ' + e.message));
  // click-to-dismiss — wired once since #toast is static markup.
  $('#toast').addEventListener('click', () => {
    clearTimeout(toast._t);
    $('#toast').classList.add('hidden');
  });
  $('#board-copy-btn').addEventListener('click', copyBoardPath);
  $('#refresh-btn').addEventListener('click', () =>
    loadBoard().then(() => setStale(false)).catch((e) => toast('Refresh failed: ' + e.message)));
  setInterval(autoRefreshTick, AUTO_REFRESH_MS);
  clockDay = localTodayStr();
  setInterval(clockTick, CLOCK_TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { clockTick(); autoRefreshTick(); }
  });
  // Sticky column headers park below the sticky page
  // header via --board-header-h — sync it now (static markup, already
  // parsed) and keep it current across wraps/resizes.
  syncBoardHeaderHeight();
  const headerEl = document.querySelector('header');
  if (headerEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncBoardHeaderHeight).observe(headerEl);
  } else {
    window.addEventListener('resize', syncBoardHeaderHeight);
  }
});

// The status <select>'s options come from the board's statuses
// list, rebuilt on every open. A card whose on-disk status isn't listed gets
// that raw value appended (marked "unlisted") and selected — so opening and
// saving the form never silently rewrites an unpromoted status.
function renderStatusOptions(current) {
  const statuses = boardStatuses();
  const opts = statuses.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`);
  if (current !== null && !statuses.includes(current)) {
    opts.push(`<option value="${escapeHtml(current)}">${escapeHtml(current)} (unlisted)</option>`);
  }
  $('#f-status').innerHTML = opts.join('');
}

// The blocked input wears a red border exactly while its value
// would gate (passes the shared predicate) — colorless otherwise, so
// `false` / whitespace / junk visibly read as "not a sticker" while typing.
function syncBlockedInputStyle() {
  $('#f-blocked').classList.toggle('blocked-active', isBlockedValue($('#f-blocked').value));
}

// ADR 0009: review's own live-feedback twin of syncBlockedInputStyle.
function syncReviewInputStyle() {
  $('#f-review').classList.toggle('review-active', isReviewValue($('#f-review').value));
}

// Shows/hides #row-prompt and keeps the header AI button's
// aria-pressed in sync — the toggle IS the reveal, so unlike the one-way
// "Show more fields" this can flip back off too (click again to collapse).
// Shown also means moved — the row becomes the form's
// very first field (ahead of Title), since reaching for the sparkle means
// the prompt IS the thing you're about to type. Hidden always means back in
// its permanent DOM slot, right before "Show more fields" (the
// Title -> Assignee tab order is untouched — this only ever displaces the
// row itself, never Assignee). CSS `order` can't give this a real tab order
// (Tab follows DOM order, not paint order), so this really
// moves the node, both directions, on every call — not just the first.
function setPromptRowVisible(show) {
  const row = $('#row-prompt');
  $('#card-form').insertBefore(row, show ? $('#f-title').closest('label') : $('#show-more-btn'));
  row.classList.toggle('hidden', !show);
  $('#modal-ai-btn').setAttribute('aria-pressed', String(show));
  updateTitleRequired(); // revealing/hiding the row can flip whether Title is required
}

// Title is required UNLESS the AI prompt row is visible
// AND actually carries text — an AI-prompt-only card (assignee @afk, no
// title of its own yet) can save empty; a shown-but-empty prompt row still
// requires a title, same as a hidden one. Re-run on every reveal/hide
// (setPromptRowVisible above) and on every keystroke in #f-prompt, so the
// native constraint the browser enforces at submit time is always current.
function updateTitleRequired() {
  const promptShown = !$('#row-prompt').classList.contains('hidden');
  $('#f-title').required = !(promptShown && $('#f-prompt').value.trim());
}

// Turning the AI prompt row ON — from the modal's own
// sparkle button or a column header's sparkle quick-create (below) — reveals
// it, focuses it (the same two-step gesture), and, for a NEW card only
// (an edit keeps whatever assignee the card already has), sets the assignee
// straight to @afk: turning the toggle on IS the queue-it-for-AI decision,
// so the assignee shouldn't need a second, separate edit to match.
function enableAiPrompt() {
  setPromptRowVisible(true);
  $('#f-prompt').focus();
  if (!$('#f-id').value) {
    $('#f-assignee').value = '@afk';
    syncAssigneeColor();
  }
}

// The
// modal's own live color cue for the field currently being typed — same
// handle-color contract the board tiles wear (assigneeBadge's text tint),
// kept in sync on open and on every keystroke, same "reflect the live
// value, not the saved one" pattern as syncBlockedInputStyle above. Tints
// the #f-assignee input's own text directly via CSSOM: it's a single known
// element, not the many-badges-per-board case app.css's palette classes
// exist to serve, so there's no need for the class-vs-CSSOM split here —
// always CSSOM, cleared entirely for an empty value.
function syncAssigneeColor() {
  const input = $('#f-assignee');
  const handle = input.value.trim();
  input.style.color = handle ? (assigneeColorVar(handle, state.assignees) || '') : '';
}

// presetStatus (a live column id — always a listed status, so
// renderStatusOptions already carries it) aims a new card at the column whose
// + was clicked. The hidden #f-status field submits it even while the form is
// minimal, and "Show more fields" reveals the dropdown with it selected.
// No preset (the global "+ New card" button) keeps the first-column default.
// presetStart (calendarCreateStart's output — a date or local
// datetime) aims a new card at the calendar cell/slot that was double-clicked,
// same hidden-field-submits-while-minimal trick, but for #f-start alone;
// status is deliberately left at its own default here (see the Calendar view
// dblclick glue below for why).
// The card whose details the open edit form was started from: Save, and leaving the form, return there.
let editFromCardId = null;

function openModal(card, presetStatus, presetStart, presetParent) {
  editFromCardId = null;
  $('#modal-title').textContent = card ? `Edit #${card.id}` : presetParent != null ? `New card under #${presetParent}` : 'New card';
  $('#f-id').value = card ? card.id : '';
  $('#f-title').value = card ? card.title : '';
  renderStatusOptions(card ? card.status : null);
  $('#f-status').value = card ? card.status : (presetStatus || boardStatuses()[0]);
  $('#f-priority').value = card ? card.priority : 'Normal';
  $('#f-parent').value = card && card.parent != null ? String(card.parent) : presetParent != null ? String(presetParent) : ''; // Add child… presets the parent of a new card
  $('#f-rank').value = card && card.rank != null ? String(card.rank) : '';
  syncNestingFieldValidity();
  $('#f-type').value = card && card.type ? card.type : '';
  $('#f-type').closest('label').classList.toggle('hidden', state.typesOn === false); // types off: no Type field, and submitModal sends no type, so the card keeps its line
  $('#f-tags').value = card ? card.tags.join(', ') : '';
  $('#f-waiting').value = card ? card.waiting_for.join(', ') : '';
  $('#f-blocked').value = card && card.blocked ? card.blocked : '';
  syncBlockedInputStyle(); // red border iff the value passes the predicate
  $('#f-review').value = card && card.review ? card.review : '';
  syncReviewInputStyle(); // ADR 0009: gold border iff the value passes the predicate
  $('#f-prompt').value = card && card.prompt ? card.prompt : '';
  // Auto-reveal on edit when the card already carries a
  // prompt (existing data is never hidden behind an unclicked toggle); a new
  // card, or an edit of a card with none, starts collapsed.
  setPromptRowVisible(Boolean(card && card.prompt));
  $('#f-assignee').value = card && card.assignee ? card.assignee : '';
  syncAssigneeColor(); // live color cue matches whatever the field now holds
  $('#f-start').value = card ? (card.start_date || '') : (presetStart || ''); // calendar click-create prefill
  $('#f-end').value = card && card.end_date ? card.end_date : ''; // the triad's "to"
  $('#f-due').value = card && card.due_date ? card.due_date : '';
  $('#f-body').value = card ? card.body : '';
  formSnapshot = snapshotFormFields(); // dirty baseline for backdrop-close
  // Create opens minimal (Title + "Show more fields"), edit always
  // full. expanded=false on EVERY open — the reveal is one-way per open and
  // never persisted. The hidden fields already hold the defaults set above,
  // so the snapshot and the save payload are the same as a full form's.
  const minimal = isMinimalCreate(Boolean(card), false);
  $('#card-form').classList.toggle('minimal', minimal);
  $('#modal').classList.remove('hidden');
  applyModalFullscreen('edit'); // re-apply the persisted per-modal-type preference on every open
  if (!card) $('#f-title').focus(); // quick capture — cursor lands ready to type (after unhide; focus is a no-op on display:none)
}

function closeModal() { $('#modal').classList.add('hidden'); }

// Back to the details the edit form came from. The address decides which card they show: Back or Forward
// may have moved it while the form was up (the popup was left alone then), and it names no card when they
// stepped back to the board. `seen` is detailRequestId when the form closed: if it moved, the person opened or
// closed a card since, and that choice stands. The card is read again, so the details show what was saved,
// and they take the focus. No history step is pushed. A card deleted on disk meanwhile is said gone and
// taken out of the address, replacing its step.
async function returnToDetails(seen) {
  if (detailRequestId !== seen) return;
  const id = cardIdFromSearch(location.search);
  if (id === null) return;
  const failed = (e) => {
    closeDetailModal();
    const search = nextCardHistorySearch(location.search, null);
    if (search !== null) history.replaceState(null, '', location.pathname + search);
    toast(e.status === 404 ? `Card #${id} is gone.` : 'Load failed: ' + e.message);
    if (e.status === 404) loadBoard();
  };
  if (await openDetailModal(id, { onFail: failed })) $('#detail-modal .modal').focus({ preventScroll: true });
}

// Backdrop-close for the edit/new-card form: silent when the form
// is untouched, one confirm when typed work would be lost. Cancel/Save keep
// their existing behavior — explicit buttons are deliberate, only the easy-to-
// fat-finger backdrop click gets the guard.
let formSnapshot = null;

function snapshotFormFields() {
  return {
    title: $('#f-title').value, status: $('#f-status').value, priority: $('#f-priority').value, type: $('#f-type').value,
    parent: $('#f-parent').value, rank: $('#f-rank').value,
    tags: $('#f-tags').value, waiting: $('#f-waiting').value, blocked: $('#f-blocked').value, review: $('#f-review').value, prompt: $('#f-prompt').value, assignee: $('#f-assignee').value,
    start: $('#f-start').value, end: $('#f-end').value, due: $('#f-due').value, body: $('#f-body').value, // the whole date triad joins the dirty baseline
  };
}

function requestCloseModal() {
  if (isDirty(formSnapshot, snapshotFormFields()) &&
      !confirm('Discard unsaved changes to this card?')) return;
  const backToCard = editFromCardId !== null;
  const seen = detailRequestId;
  closeModal();
  if (backToCard) returnToDetails(seen);
}

function parseIds(s) {
  return s.split(',').map((x) => kanbanIds.idKey(x.trim())).filter((id) => id !== null);
}
function parseTags(s) {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

// A blank Parent or Rank clears its line, so text that reads as nothing must
// stop the save instead of quietly deleting what the card had.
function parentFieldProblem(text) {
  const t = text.trim();
  return t && !parseParent(t, state.projectName) ? 'A card number such as 42, or board#42. Clear the field to remove the parent.' : '';
}

function rankFieldProblem(text) {
  const t = text.trim();
  return t && parseRank(t) === null ? 'A number such as 10 or 12.5. Clear the field to remove the rank.' : '';
}

function syncNestingFieldValidity() {
  $('#f-parent').setCustomValidity(parentFieldProblem($('#f-parent').value));
  $('#f-rank').setCustomValidity(rankFieldProblem($('#f-rank').value));
}

async function submitModal(e) {
  e.preventDefault();
  const id = $('#f-id').value;
  const before = id ? state.active.find((c) => String(c.id) === id) : null;
  const payload = {
    title: $('#f-title').value.trim(),
    status: $('#f-status').value,
    priority: $('#f-priority').value,
    parent: $('#f-parent').value.trim(), // blank clears; the store keeps a value that reads the same as the card's as written
    rank: $('#f-rank').value.trim(),
    tags: parseTags($('#f-tags').value),
    waiting_for: parseIds($('#f-waiting').value),
    // The sticker's raw text — the store's predicate-judged lean rule strips
    // an invalid/clear value (so a blank simply removes the line).
    blocked: $('#f-blocked').value.trim(),
    review: $('#f-review').value.trim(), // ADR 0009: same lean-rule contract as blocked
    prompt: $('#f-prompt').value.trim(), // same lean-rule contract, but not a sticker
    assignee: $('#f-assignee').value.trim(),
    start_date: $('#f-start').value.trim(), // empty string clears, same as due
    end_date: $('#f-end').value.trim(), // same clear contract
    due_date: $('#f-due').value.trim(),
    body: $('#f-body').value,
  };
  if (state.typesOn !== false) payload.type = $('#f-type').value.trim(); // blank clears: the line is removed; types off sends none, and a write with no type leaves the line alone
  try {
    let joined = '';
    if (id) await api('PATCH', `/api/cards/${id}`, payload);
    else joined = groupJoinedNote(((await api('POST', '/api/cards', payload)) || {}).joined);
    const backToCard = Boolean(id) && editFromCardId !== null && String(editFromCardId) === id;
    const seen = detailRequestId;
    closeModal();
    if (backToCard && onPhoneLayout()) setPhoneColumn(payload.status);
    await loadBoard();
    if (backToCard) await returnToDetails(seen);
    const note = before && before.status !== 'done' ? openLeavesNote([before], payload.status) : '';
    if (note) toast(`${note}.`);
    else if (joined) toast(joined);
  } catch (e2) {
    if (e2.status === 422) {
      toast(`Can't set doing — ${gate422Text(e2.data)}.`);
    } else {
      toast('Save failed: ' + e2.message);
    }
  }
}

// The status a new card starts in when the person did not pick one: on a phone the status tab being read,
// which only the Board shows; otherwise none, and the form takes the board's first. New card and the
// card menu's Add child… both start here.
function newCardStatus() {
  const active = onPhoneLayout() && loadViewMode() === 'board' ? activePhoneColumn(loadPhoneColumn(), boardStatuses()) : null;
  return active && active !== 'archive' ? active : undefined;
}

window.addEventListener('DOMContentLoaded', () => {
  textEditAttach($('#f-body')); // the description: Tab indents and the Markdown keys format (text-edit-ui.js)
  mdEditSetOn(loadMdColour(prefsStorage())); // the browser's choice, before any box is drawn
  mdEditAttach($('#f-body')); // and it is drawn in colour, as the Scratchpad's Edit box is (markdown-edit-ui.js)
  $('#new-btn').addEventListener('click', () => openModal(null, newCardStatus()));
  // X goes through the dirty guard (the retired Cancel button bypassed it —
  // backdrop-click and X now agree on the unsaved-changes speedbump)
  $('#modal-close').addEventListener('click', requestCloseModal);
  // revealing changes no field values, so the dirty baseline is untouched
  $('#show-more-btn').addEventListener('click', () => {
    const minimal = isMinimalCreate(false, true); // always false — expanding lifts minimal for the rest of the open
    $('#card-form').classList.toggle('minimal', minimal);
  });
  $('#card-form').addEventListener('submit', submitModal);
  $('#f-parent').addEventListener('input', syncNestingFieldValidity);
  $('#f-rank').addEventListener('input', syncNestingFieldValidity);
  $('#f-blocked').addEventListener('input', syncBlockedInputStyle); // live red-border feedback
  $('#f-review').addEventListener('input', syncReviewInputStyle); // ADR 0009: live gold-border feedback
  $('#f-prompt').addEventListener('input', updateTitleRequired); // typing/clearing the prompt live-toggles whether Title is required
  // Toggles #row-prompt; focuses the input on reveal so
  // clicking the sparkle and typing is a two-step gesture, not three.
  // Turning it ON goes through enableAiPrompt() (also sets
  // assignee to @afk for a new card); turning it back OFF is still a plain
  // hide — the assignee nudge is one-way, never undone by re-hiding the row.
  $('#modal-ai-btn').addEventListener('click', () => {
    const show = $('#row-prompt').classList.contains('hidden');
    if (show) enableAiPrompt();
    else setPromptRowVisible(false);
  });
  $('#f-assignee').addEventListener('input', syncAssigneeColor); // live color-text feedback
  $('#modal-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('edit'));
  // Single delegated listener on #board covers all five columns (renderBoard()
  // rebuilds the DOM every call — manual refresh, poll, drag, toggle — so
  // per-element listeners here would need constant rewiring; delegation on the
  // stable #board parent doesn't). Only board-specific controls live here
  // — tile clicks (detail / selection gestures) live in the document-level
  // shared card-el grammar in the multi-select section, one handler for all
  // four views. These button branches simply return; the shared handler
  // independently ignores clicks landing on buttons/selects, so a Restore
  // click inside a card-el tile never also opens its detail popup.
  $('#board-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.board-tab');
    if (!tab) return;
    setPhoneColumn(tab.dataset.col);
    renderBoard();
  });
  wireBoardSwipe($('#board'));
  $('#board').addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.column-toggle');
    if (toggleBtn) { toggleColumn(toggleBtn.dataset.col); return; }
    const sortDirBtn = e.target.closest('.column-sort-dir');
    if (sortDirBtn) { toggleColumnSortDirection(sortDirBtn.dataset.col); return; }
    const addBtn = e.target.closest('.column-add');
    if (addBtn) { openModal(null, addBtn.dataset.col); return; } // create pre-aimed at this column
    const addAiBtn = e.target.closest('.column-add-ai');
    // same pre-aimed create, with the AI prompt row already
    // revealed (and, per enableAiPrompt, the assignee already set to @afk).
    if (addAiBtn) { openModal(null, addAiBtn.dataset.col); enableAiPrompt(); return; }

    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      const id = actBtn.dataset.id;
      if (actBtn.dataset.act === 'restore') doRestore(id);
      if (actBtn.dataset.act === 'delete-arch') doDelete(id);
    }
  });
  // Delegated 'change' listener (mirrors the click delegation above): the
  // sort-field <select> is rebuilt by every renderBoard() call same as
  // everything else in #board, so a per-element listener would need constant
  // rewiring — delegation on the stable #board parent doesn't.
  $('#board').addEventListener('change', (e) => {
    const sel = e.target.closest('.column-sort-field');
    if (sel) setColumnSortField(sel.dataset.col, sel.value);
  });
});

// Names the object in a confirm (the speedbump policy): title when we
// know it, id otherwise. Falls back through
// cardTitleDisplay like every other title-rendering call site, so a
// titleless AI-prompt card's confirm() text names it by its queued prompt
// instead of a blank quoted title.
function cardLabel(id) {
  const card = state.active.concat(state.archived).find((c) => c.id === id);
  if (!card) return `#${id}`;
  const titleDisplay = cardTitleDisplay(card);
  return titleDisplay.text ? `#${id} "${titleDisplay.text}"` : `#${id}`;
}

// A done card archiving is completion, not a destructive act — skip
// the confirm when the card is already done (shared archiveNeedsConfirm rule,
// selection.js). A missing lookup (shouldn't happen — the button is only
// wired for live cards) falls back to confirming, the safe default.
async function doArchive(id, { onSuccess } = {}) {
  const card = state.active.find((c) => c.id === id);
  if ((!card || archiveNeedsConfirm([card])) && !confirm(`Archive ${cardLabel(id)}? (moves the file to archived/)`)) return;
  try { await api('POST', `/api/cards/${id}/archive`); if (onSuccess) onSuccess(); await loadBoard(); }
  catch (e) { toast('Archive failed: ' + e.message); }
}

// Restore is exempt from the speedbump policy: it's the reversible
// direction — archiving it back costs one click.
async function doRestore(id) {
  try { await api('POST', `/api/cards/${id}/restore`); await loadBoard(); }
  catch (e) { toast('Restore failed: ' + e.message); }
}

// Deleting opens the delete popup (delete-ui.js): what goes, and the extras to tick.
function doDelete(id, { onSuccess } = {}) {
  openDelete('card', [id], { onDone: onSuccess });
}

// --- Card detail popup: rendered markdown body, frontmatter table, copy-path. ---
// Fetches the card's current on-disk content on open (server-backed, no snapshot
// staleness). Renderer + escaping ported from skills/dashboard's popup, which
// carries the fixes from that skill's XSS review: escapeHtml covers & < > " ',
// every interpolated value is escaped, and markdown link hrefs are scheme-checked.

// The Markdown renderer is markdown.js: one module for card bodies and scratchpad
// previews (the notes list will), and markdown-ui.js (markdownInto) is the one place its output reaches innerHTML.

// Frontmatter is flat `key: value` per line; split on the FIRST colon only so
// values that contain colons (e.g. URLs) survive intact. Handles extension
// fields (e.g. `parent:`) the same as any other key — nothing is allowlisted.
function parseFrontmatter(text) {
  return (text || '').split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const i = line.indexOf(':');
      return i === -1 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    });
}

// The few fields the board itself understands wear the marks it already uses
// elsewhere: the status dot, the high-priority red, the assignee chip, the
// sticker grounds, tag chips, and a mention chip for the parent. Every
// other value prints as written.
function frontmatterValueHtml(k, v) {
  const plain = v.replace(/^"(.*)"$/, '$1').trim();
  if (k === 'status' && plain) {
    const cls = statusColorClass(plain);
    return `<span class="fm-status fm-status--${cls}"><span class="status-dot status-dot--${cls}"></span>${escapeHtml(plain)}</span>`;
  }
  if (k === 'priority' && plain === 'High') return '<span class="fm-high">High</span>';
  if (k === 'assignee' && plain) return assigneeBadge({ assignee: plain }, state.assignees);
  if (k === 'type' && plain && state.typesOn !== false) return typeBadge({ type: plain }, state.types); // types off: the line prints as written, plain
  if (k === 'parent') {
    const ref = parseParent(plain, state.projectName);
    // a card on this board opens on click; another board's is shown, not followed
    if (ref && ref.local) {
      const exists = state.active.concat(state.archived).some((c) => c.id === ref.id);
      if (!exists) return `<code class="mention">${escapeHtml(state.projectName)}#${escapeHtml(ref.id)}</code><span class="rel-mark">unresolved</span>`;
      return `<code class="mention same" data-card-id="${escapeHtml(ref.id)}" tabindex="0" role="link">${escapeHtml(state.projectName)}#${escapeHtml(ref.id)}</code>`;
    }
    if (ref) return `<code class="mention">${escapeHtml(ref.board)}#${escapeHtml(ref.id)}</code>`;
  }
  if (k === 'review' && isReviewValue(plain)) return `<span class="fm-sticker fm-sticker--review">${escapeHtml(reviewReason(plain) || 'review')}</span>`;
  if (k === 'blocked' && isBlockedValue(plain)) return `<span class="fm-sticker fm-sticker--blocked">${escapeHtml(blockedReason(plain) || 'blocked')}</span>`;
  if (k === 'tags' && /^\[.*\]$/.test(plain)) {
    return plain.slice(1, -1).split(',').map((t) => t.trim()).filter(Boolean).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  }
  return escapeHtml(formatFrontmatterValue(v));
}

function renderFrontmatterTable(pairs) {
  if (!pairs.length) return '';
  const rows = pairs.map(([k, v]) =>
    `<tr><td class="fm-key">${escapeHtml(k)}</td><td class="fm-value">${frontmatterValueHtml(k, v)}</td></tr>`
  ).join('');
  return `<table>${rows}</table>`;
}

// The thread above a card and the children under its roll-up bar are lists of
// mention chips, so the detail's one mention listener opens them.
function relativeMentionHtml(card, board) {
  const title = cardTitleDisplay(card).text;
  const label = `${board}#${card.id}${title ? ' ' + title : ''}`;
  return `<code class="mention same" data-card-id="${escapeHtml(card.id)}" tabindex="0" role="link">${escapeHtml(label)}</code>`;
}

function archivedMarkHtml(card) {
  return card.archived ? '<span class="rel-mark">archived</span>' : '';
}

function threadEntryHtml(entry, board) {
  if (entry.kind === 'card') return `<li class="thread-item${entry.card.archived ? ' thread-item--archived' : ''}">${relativeMentionHtml(entry.card, board)}${archivedMarkHtml(entry.card)}</li>`;
  if (entry.kind === 'loop') return `<li class="thread-item thread-item--loop">${relativeMentionHtml(entry.card, board)}<span class="rel-mark">loop</span></li>`;
  if (entry.kind === 'other-board') return `<li class="thread-item thread-item--other-board"><code class="mention">${escapeHtml(entry.ref)}</code><span class="rel-mark">not followed</span></li>`;
  return `<li class="thread-item thread-item--unresolved"><code class="mention">${escapeHtml(board)}#${escapeHtml(entry.id)}</code><span class="rel-mark">unresolved</span></li>`;
}

function childEntryHtml(card, board) {
  return `<li class="child-item${card.archived ? ' child-item--archived' : ''}">${relativeMentionHtml(card, board)}${archivedMarkHtml(card)}</li>`;
}

function detailRelativesHtml(cards, id, ctx) {
  const thread = threadOf(cards, id, ctx);
  const children = childrenOf(cards, id, ctx);
  return {
    threadHtml: thread.length
      ? `<span class="relatives-label">Thread</span><ol class="thread-list">${thread.map((e) => threadEntryHtml(e, ctx.board)).join('')}</ol>` : '',
    childrenHtml: children.length
      ? `<button type="button" class="relatives-toggle" aria-expanded="false" aria-controls="detail-children-list">` +
        `<span class="relatives-label">Children</span> <span class="relatives-count">${children.length}</span></button>` +
        `<ul class="children-list hidden" id="detail-children-list">${children.map((c) => childEntryHtml(c, ctx.board)).join('')}</ul>` : '',
  };
}

function toggleDetailChildren(btn) {
  const collapsed = $('#detail-children-list').classList.toggle('hidden');
  btn.setAttribute('aria-expanded', String(!collapsed));
}

function renderDetailRelatives(id) {
  const ctx = nestingCtx();
  const { threadHtml, childrenHtml } = detailRelativesHtml(state.active.concat(state.archived), id, ctx);
  for (const [sel, markup] of [['#detail-thread', threadHtml], ['#detail-children', childrenHtml]]) {
    const el = $(sel);
    el.innerHTML = markup;
    el.classList.toggle('hidden', !markup);
  }
}

// navigator.clipboard needs a secure context; http://localhost qualifies, but the
// execCommand fallback is kept so the button never silently no-ops.
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.left = '-1000px';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

let copyResetTimer = null;

function resetCopyState() {
  if (copyResetTimer) { clearTimeout(copyResetTimer); copyResetTimer = null; }
  const btn = $('#detail-copy-btn');
  btn.textContent = 'Copy path';
  btn.classList.remove('copy-success', 'copy-failed');
}

function showCopyFeedback(success) {
  if (copyResetTimer) clearTimeout(copyResetTimer);
  const btn = $('#detail-copy-btn');
  btn.textContent = success ? 'Copied!' : 'Copy failed';
  btn.classList.toggle('copy-success', success);
  btn.classList.toggle('copy-failed', !success);
  copyResetTimer = setTimeout(resetCopyState, 1500);
}

function copyDetailPath() {
  const text = $('#detail-copy-btn').dataset.path || '';
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showCopyFeedback(true),
      () => showCopyFeedback(fallbackCopy(text)),
    );
  } else {
    showCopyFeedback(fallbackCopy(text));
  }
}

// Copy the board directory's ABSOLUTE path from the header title.
// Same clipboard ladder as copyDetailPath above — navigator.clipboard first,
// textarea+execCommand fallback second (VSCode's Simple Browser doesn't grant
// the async API a secure context, so the fallback is load-bearing there) —
// but feedback is a toast on BOTH outcomes: the header button is glyph-sized,
// no room for the detail button's "Copied!" label swap.
function copyBoardPath() {
  const text = state.boardDir || '';
  if (!text) { toast('Board path not loaded yet — Refresh.'); return; } // pre-first-poll click, or an old server payload without boardDir
  const done = (ok) => toast(ok ? `Copied: ${text}` : 'Copy failed — copy the path from a card popup instead.');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    // Rejection (permissions, non-secure context) retries through the
    // fallback before reporting — same ladder as copyDetailPath above.
    navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
  } else done(fallbackCopy(text));
}

let detailRequestId = 0;
let currentDetailId = null;
let currentDetailArchived = false;

// "Last modified" line — the `updated` frontmatter field when the
// card has one (machine-maintained, bumped on every write), else the file's
// mtime labeled as such (older cards predating the field). Both timestamps
// render local-time "YYYY-MM-DD | HH:MM:SS"; `updated` has no
// timezone suffix so it's already local, and `new Date(isoUtcMtime)` converts
// to the browser's local time same as any other Date getter.
function formatLocalDateTime(s) {
  const d = new Date(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} | ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// A raw local-datetime frontmatter value (e.g. `updated:
// 2026-07-10T09:36:31`, or a `start_date`/`end_date`/`due_date` carrying a
// time component) reads badly with its literal "T" separator — reuse
// formatLocalDateTime so every surface shows the same "YYYY-MM-DD | HH:MM:SS"
// shape. Date-only values (no "T") pass through untouched.
const LOCAL_DATETIME_VALUE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
function formatFrontmatterValue(v) {
  return LOCAL_DATETIME_VALUE_RE.test(v) ? formatLocalDateTime(v) : v;
}

function formatDetailModified(data) {
  if (data.updated) return `Last modified: ${escapeHtml(formatLocalDateTime(data.updated))}`;
  if (data.mtime) return `Last modified: ${escapeHtml(formatLocalDateTime(data.mtime))} (file mtime)`;
  return '';
}

// `quiet` (popstate's use only — see below): on a failed fetch, close the
// popup instead of toasting. Returns true iff the card actually ended up
// showing, so callers that need to know (openCard, below) can tell a real
// open from a failed one instead of assuming success. `onFail(error)` (the edit form's return) takes over the
// failure from both the quiet close and the toast.
async function openDetailModal(id, { quiet, onFail } = {}) {
  const reqId = ++detailRequestId;
  let data;
  try { data = await api('GET', `/api/cards/${id}/detail`); }
  catch (e) {
    if (reqId !== detailRequestId) return false; // superseded — some other call already decided the popup's fate
    if (onFail) onFail(e); else if (quiet) closeDetailModal(); else toast('Load failed: ' + e.message);
    return false;
  }
  if (reqId !== detailRequestId) return false; // a newer openDetailModal call superseded this one
  data.id = pageId(data.id);
  currentDetailId = data.id;
  currentDetailArchived = !!data.archived;
  // Same empty-title-shows-the-prompt fallback every other
  // view uses (cardTitleDisplay, card-title.js) — cardDetail (card-store.js)
  // carries `prompt` alongside title for exactly this.
  const titleDisplay = cardTitleDisplay(data);
  $('#detail-title').textContent = `#${data.id} ${titleDisplay.text}`;
  $('#detail-title').classList.toggle('detail-title--prompt-fallback', titleDisplay.isPromptFallback);
  // Folders quiet, the file name in full ink: the part a reader looks for.
  const detailPath = data.path || '';
  const cut = Math.max(detailPath.lastIndexOf('/'), detailPath.lastIndexOf('\\')) + 1;
  const fileEl = document.createElement('span');
  fileEl.className = 'detail-path-file';
  fileEl.textContent = detailPath.slice(cut);
  $('#detail-path').replaceChildren(document.createTextNode(detailPath.slice(0, cut)), fileEl);
  $('#detail-copy-btn').dataset.path = data.path || '';
  resetCopyState();
  $('#detail-modified').innerHTML = formatDetailModified(data);
  $('#detail-frontmatter').innerHTML = renderFrontmatterTable(parseFrontmatter(data.frontmatter));
  paintAssigneeColors($('#detail-frontmatter')); // reserved custom colors need a CSSOM pass, see helper
  paintTypeColors($('#detail-frontmatter'));
  markdownInto($('#detail-body'), data.body || '');
  renderDetailRollup(data.id);
  renderDetailRelatives(data.id);
  // Archived cards: Edit only knows about state.active, and Archive on an already-archived
  // card would rename the file again (never clobbers, but pointless/confusing) — hide both.
  // visibility, not .hidden: with the icons leading the header
  // (order:-1) the title's x-position is the group's width, so display:none
  // here would hop the title ~72px left between an active card's popup and an
  // archived one's. visibility keeps the two slots (and still drops the
  // buttons from hit-testing and tab order).
  $('#detail-edit-btn').style.visibility = currentDetailArchived ? 'hidden' : '';
  $('#detail-archive-btn').style.visibility = currentDetailArchived ? 'hidden' : '';
  $('#detail-modal').classList.remove('hidden');
  applyModalFullscreen('detail'); // re-apply the persisted per-modal-type preference on every open
  return true;
}

// A card menu opened from the popup can change or remove the card it shows.
function refreshOpenDetail() {
  if (currentDetailId == null) return;
  const id = currentDetailId;
  if (!state.active.concat(state.archived).some((c) => c.id === id)) { closeCard(); return; }
  openDetailModal(id, { quiet: true });
}

function renderDetailRollup(id) {
  const box = $('#detail-rollup');
  const index = buildNestingIndex();
  const altitude = index.altitudeOf(id);
  if (!altitude) {
    box.innerHTML = '';
    box.classList.add('hidden');
    return;
  }
  const mode = loadRollupBarMode();
  const countArchived = countArchivedLeaves();
  box.innerHTML = rollupDetailHtml(index.rollup(id, { countArchived }), altitude, boardStatuses(), countArchived, mode);
  box.classList.toggle('detail-rollup--collapsed', mode === ROLLUP_BAR_COLLAPSED);
  paintRollupBars(box);
  box.classList.remove('hidden');
}

function closeDetailModal() {
  detailRequestId++; // invalidate any in-flight fetch so it can't reopen the modal after close
  currentDetailId = null;
  currentDetailArchived = false;
  $('#detail-modal').classList.add('hidden');
}

// Opening/closing the detail popup as real browser-history steps, so
// Alt+Left/Alt+Right, the mouse back/forward buttons,
// and the browser's own arrows all step between opened cards natively — no
// separate keyboard shortcut to fight them. card-history.js owns the pure
// "what URL, if any" decision; these two just apply it around the existing
// open/close. Every call site that opens or closes the popup from a live
// user gesture (tile, mention, tray, map ghost, close button, backdrop, Esc,
// archive/delete) goes through openCard/closeCard instead of
// openDetailModal/closeDetailModal directly. The popstate listener below is
// the one deliberate exception — it applies openDetailModal/closeDetailModal
// straight, so a Back/Forward-driven open or close never pushes a step of
// its own (no loop). consumeDeepLink (initial load) is the other exception:
// the URL already carries the id, so there is nothing to push.
function pushCardHistoryStep(targetId) {
  const search = nextCardHistorySearch(location.search, targetId);
  if (search == null) return; // already there — no duplicate entry
  history.pushState(null, '', location.pathname + search);
}

// The push happens AFTER the card actually loads, not before: pushing first
// would leave a phantom history step (and a URL naming a card the popup
// isn't showing) behind a chip for a deleted/nonexistent card or a failed
// fetch. The detailRequestId supersede check inside openDetailModal already
// stops a stale push if a popstate or close lands mid-fetch.
async function openCard(id) {
  if (await openDetailModal(id)) pushCardHistoryStep(id);
}

function closeCard() {
  pushCardHistoryStep(null);
  closeDetailModal();
}

// Back/Forward (mouse buttons, the browser's own arrows, and — because
// there's no competing keyboard handler — Alt+Left/Alt+Right) land here.
// location.search is already the DESTINATION url by the time this fires, so
// reading it off cardIdFromSearch is enough to know what to show; nothing
// here calls pushCardHistoryStep, or this would push a fresh step for every
// step the user just took. A card id that parses but no longer matches any
// active/archived card closes quietly — unlike consumeDeepLink's toast on
// first load, routine Back/Forward traffic over a stale ref must not spam a
// toast on every step (quiet: true routes a failed fetch to the same silent
// close rather than openDetailModal's normal toast — state.active/archived
// can still name a card whose file a poll hasn't caught up with yet, since
// the poll itself is paused for as long as this popup is open).
//
// Back and Forward never write the search box: the box keeps its text, and an
// entry that landed with another `q` is replaced to carry the box's text, so
// the address always says what the box says. This comes first, ahead of the
// bail-out below, because the address moved whether or not the popup does.
window.addEventListener('popstate', () => {
  followSearchInAddress($('#search-input').value);
  // An edit/new-card form, or any other popup, covers the same z-index slot
  // as the detail popup and may hold unsaved typing (formSnapshot) that
  // openDetailModal would silently overwrite if Edit were then clicked on
  // whatever this landed on. Leave it alone — the URL moves, the popup
  // underneath does not.
  if (document.querySelector('.modal-backdrop:not(#detail-modal):not(.hidden)')) return;
  const id = cardIdFromSearch(location.search);
  const card = id == null ? null : state.active.concat(state.archived).find((c) => c.id === id);
  if (card) openDetailModal(id, { quiet: true });
  else closeDetailModal();
});

// Edit layers the existing card-form modal over the (now closed) detail popup;
// closing first guarantees no stale detail view is left behind on return.
function editFromDetail() {
  if (currentDetailId == null || currentDetailArchived) return;
  const card = state.active.find((c) => c.id === currentDetailId);
  if (!card) { closeDetailModal(); toast('Card not found — Refresh.'); return; }
  closeDetailModal();
  openModal(card);
  editFromCardId = card.id;
}

// e on the open card details opens the edit form, as the Edit button does, with the focus in its title so
// the person can type at once (the keydown is cancelled, so no e lands there). A key that types nothing but
// reads a letter, so it reads the key guard as n does, through the details' own guard (key-guard.js): off
// while a field has focus, while any popup but the details (NOTES_DETAIL, notes-palette.js) is up and while
// the notes palette is, which keeps e for its notes.
function onDetailEditKey(e) {
  if (!e.key || e.key.toLowerCase() !== 'e' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (keyGuardDetailOff(document, NOTES_DETAIL) || notesDetailId() === null || currentDetailArchived) return;
  e.preventDefault();
  editFromDetail();
  $('#f-title').focus();
}

window.addEventListener('DOMContentLoaded', () => {
  $('#detail-close').addEventListener('click', closeCard);
  $('#detail-back-btn').addEventListener('click', closeCard);
  $('#detail-copy-btn').addEventListener('click', copyDetailPath);
  // A mention of a card on this board opens that card, in the body and in the
  // frontmatter's parent field alike.
  const openMentionedCard = async (e) => {
    const m = e.target.closest('code.mention.same');
    if (!m || (e.type === 'keydown' && e.key !== 'Enter')) return;
    e.preventDefault();
    await openCard(m.dataset.cardId);
    $('#detail-modal .modal').scrollTop = 0; // the new card opens at its top, not at the old card's scroll
  };
  $('#detail-modal').addEventListener('click', openMentionedCard);
  $('#detail-modal').addEventListener('keydown', openMentionedCard);
  $('#detail-modal .modal').addEventListener('contextmenu', onDetailContextMenu);
  $('#detail-modal').addEventListener('click', (e) => { const t = e.target.closest('.relatives-toggle'); if (t) toggleDetailChildren(t); });
  $('#detail-edit-btn').addEventListener('click', editFromDetail);
  document.addEventListener('keydown', onDetailEditKey);
  $('#detail-archive-btn').addEventListener('click', () => {
    // Belt-and-suspenders: the button is hidden for archived cards, but never
    // let this path reach doArchive on one even if that ever fails to apply.
    if (currentDetailId != null && !currentDetailArchived) doArchive(currentDetailId, { onSuccess: closeCard });
  });
  $('#detail-delete-btn').addEventListener('click', () => {
    if (currentDetailId != null) doDelete(currentDetailId, { onSuccess: closeCard });
  });
  $('#detail-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('detail'));
  $('#detail-modal').addEventListener('click', (e) => { if (e.target.id === 'detail-modal') closeCard(); });
  // Esc priority: fullscreen is out of the Esc picture entirely.
  // An open detail popup closes on the very first Esc regardless of its
  // fullscreen state. The edit/new-card modal closes on Esc too — through
  // requestCloseModal(), the exact same unsaved-changes guard the X button
  // uses, and it returns to the details the form was opened from. Esc
  // never calls setModalFullscreenVisual, so the persisted preference
  // and the toggle button's state are untouched by it either way — the toggle
  // button is the only thing that changes fullscreen. The
  // three bulk-edit popups (bulkSingle/Tags/Schedule) are ALSO fullscreen-
  // capable (see FULLSCREEN_MODALS) — closeAnyBulkPopup() closes
  // whichever one is open directly, matching the detail/edit popups above and
  // its own backdrop-click, so Esc is never a true no-op there. The Archive
  // popup rides the same closeAnyBulkPopup list (one field, no fullscreen
  // toggle — nothing to expand). The
  // combobox menu still gets first crack at Esc when open — attachCombobox's
  // own keydown listener stops propagation before this document-level
  // listener ever sees the key, so nothing here needs to special-case it.
  // key-guard: exempt (Esc closes the open popup from inside a field too; the selection step it ends in asks keyGuardEscape)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (moreMenuClose()) { e.preventDefault(); $('#more-btn').focus(); return; }
    if (!$('#context-menu').classList.contains('hidden')) { hideContextMenu(); return; }
    if (!$('#notif-modal').classList.contains('hidden')) { closeNotifModal(); return; }
    if (!$('#prefs-sheet').classList.contains('hidden')) { settingsStepBack(); return; }
    if (!$('#detail-modal').classList.contains('hidden')) { closeCard(); return; }
    if (!$('#modal').classList.contains('hidden')) { requestCloseModal(); return; }
    if (closeAnyBulkPopup()) return;
    if (anyModalOpen()) return; // defensive catch-all: any future .modal-backdrop popup not listed above
    if (closeSearchPanel()) { e.preventDefault(); return; } // the search panel closes on its own Esc, ahead of the selection step, and a search field's own Esc must not clear the box as well
    if (e.repeat) return; // a held Esc is one press: it runs one stage
    escapeStep(e);
  });
  // Alt+Enter: toggle fullscreen on whichever fullscreen-capable
  // popup is open — the keyboard twin of that popup's toggle button, going
  // through the same toggleModalFullscreen so the persisted per-modal-type
  // preference updates identically. Works with focus anywhere inside the
  // popup (form fields included — preventDefault keeps the chord away from
  // implicit form submission); attachCombobox's Enter handling exempts
  // alt-chorded Enter, so the hotkey wins even while a suggestion menu is
  // open. No popup open = plain no-op.
  // key-guard: exempt (acts only on an open fullscreen-capable popup, from a field inside it too)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const type = openFullscreenModalType();
    if (!type) return;
    e.preventDefault();
    toggleModalFullscreen(type);
  });
  // Ctrl+S / Cmd+S: save whichever save-capable popup is open —
  // the keyboard twin of its Save/Apply button, instead of the browser's
  // save-page dialog mid-edit. save-hotkey.js owns the chord + target
  // decision (strict chord — Shift/Alt chords never match; bulk-tags
  // deliberately excluded, it has two competing actions and no single
  // "save"). The edit/create modal goes through requestSubmit() so native
  // validation and submitModal run exactly as a Save click; the two bulk
  // popups click their Apply button, skipped while it's disabled. No
  // save-capable popup open = plain no-op, same shape as Alt+Enter above.
  const SAVE_APPLY_BUTTONS = { bulkSingle: '#bulk-single-apply', bulkSchedule: '#bulk-schedule-apply' };
  // key-guard: exempt (acts only on an open save-capable popup, from a field inside it too)
  document.addEventListener('keydown', (e) => {
    const target = saveHotkeyTarget(e, {
      edit: !$('#modal').classList.contains('hidden'),
      bulkSingle: !$('#bulk-single').classList.contains('hidden'),
      bulkSchedule: !$('#bulk-schedule').classList.contains('hidden'),
    });
    if (!target) return;
    e.preventDefault();
    if (target === 'edit') { $('#card-form').requestSubmit(); return; }
    const btn = $(SAVE_APPLY_BUTTONS[target]);
    if (btn && !btn.disabled) btn.click();
  });
});

// --- Search box wiring: live filter-as-you-type, clear button,
// `/` focuses the box. Both it and Ctrl+F/Cmd+F read the shared key guard
// (key-guard.js): `/` types a character, so it stays off while a field has
// focus and while a menu, a dialog, the notifications panel or the preferences
// sheet is open; Ctrl+F types nothing, so it reads only the surface check and
// still works from inside a text field. Ctrl+F has its own `#`-prefill/
// select-all logic — see onSearchChordKey.
//
// The one writer of the box: typing, the clear button, a cue click, a pill, a click or a key
// of the slice section, the Ctrl+F prefill, a ?q= link, the isolate switch (and its menu entries
// and key), a click on a card in the Graph, and the step down the selection (Esc, a double click
// on empty space) all come through writeSearch(text, reason). What each reason means, and every rule
// that reads one, is in selection.js ("Why the box was written": ISOLATING_REASONS, writeKeepsSelection,
// writeEditsPills, writeSkipsJump, ...). A write that carries a query the person made turns isolate on
// first where the view's Typing isolates is on (typingTurnsIsolateOn, selection.js; isolateFromTyping,
// isolate.js). It sets the box, repaints the board, then tells each listener (text, reason). Code that
// must react to a write registers with onSearchWrite rather than editing a
// writer. The poll repaints without writing the box, so it tells no one. A write
// whose caller paints in place passes repaint false (a click in the Graph that
// writes the selection into the box): it must not replace the card under the pointer, or a double
// click would never reach it.
const searchWriteListeners = [];

function onSearchWrite(listener) {
  searchWriteListeners.push(listener);
}

function writeSearch(text, reason, repaint = true) {
  const input = $('#search-input');
  if (!input) return;
  const turnsOn = typingTurnsIsolateOn({
    reason, text: searchSplitSlice(String(text)).rest, isolated: isolateNow() !== null, setting: typingIsolatesIn(loadViewMode()),
  });
  if (turnsOn) isolateFromTyping(text); // before the repaint, so it and every listener see isolate on
  isolateEndIfEmptied(text, reason); // and off, when the write leaves the box with no query
  if (input.value !== text) input.value = text; // typing already holds it, and an assignment would move the caret
  if (repaint) {
    pendingWriteReason = reason;
    renderBoard();
  } else {
    lastSearchMatch = null; // no repaint matched this text, and the listeners must not read the last one's match
  }
  searchWriteListeners.forEach((listener) => listener(text, reason));
}

function clearSearch() {
  const input = $('#search-input');
  if (!input || !input.value) return;
  writeSearch('', 'clear');
}

// The address follows the box: one more listener of the writer, so every write,
// whatever its reason, leaves the address's `q` equal to the box's text (an
// empty box drops it), and the poll, which never writes the box, never moves
// it. It REPLACES the history entry the page is on, never pushes one, so typing
// adds nothing to Back and Forward, and only when `q` would change. Replacing
// only on a change does not keep fast typing under the browser's limit on
// replacements (every keystroke changes `q`), and Safari throws a SecurityError
// past it, so a refused replacement is let go: the address lags the box, and the
// next write that changes `q` catches it up, while the listeners after this one
// still hear of the write. card-history.js decides what the address becomes;
// `card` and `view` ride along untouched, and `isolate=1` stands beside `q` while
// isolate is on (isolateNow, isolate.js). The popstate listener calls this too,
// after Back or Forward lands.
function followSearchInAddress(text) {
  const search = nextSearchAddress(location.search, text, isolateNow() !== null, typingIsolatesIn(loadViewMode()));
  if (search == null) return;
  try {
    history.replaceState(null, '', location.pathname + search);
  } catch (e) {
    /* the address lags the box until the next change */
  }
}

onSearchWrite(followSearchInAddress);

// The selection follows the box while the Graph is shown: a search typed there is
// the anchor of the selection (selectionAfterTyping, selection.js), so the Graph
// lights its matches instead of hiding the rest. The writer marks why it wrote (the
// reason it was given) and the repaint it makes takes the box into the selection,
// through setSelection like every other write, before the id set is worked out: the
// one repaint paints the new anchor, and parses and matches the box once. The other
// views keep filtering and select nothing.
//
// A run of slices written by the slice section (the reason 'slice') is a cut, not a search:
// it never makes the box the anchor, and a typed anchor keeps following the box, so the
// Graph still lights what the whole query, the cut included, matches.
//
// A write by hand, typing or the clear button, also takes a pill off when the box no
// longer holds its query (selectionAfterBoxEdit, selection.js), in every view. A
// pill's own write (the reason 'pill', or 'unpill' when it takes a pill out and turns none on) changes the selection and the box together
// first, so the box is not taken for a typed search: a pill's query is not the typed
// anchor, and stays the anchor when the Graph is left. Isolate's own write (the reason
// 'isolate') leaves the selection as it is, and while isolate is on the box holds the
// isolate text, which is never a typed search: it does not become the anchor. A click's write
// (the reason 'mirror', below) is the selection's own text and leaves it as it is the same way,
// so the next click still sees the card parts the click made.
let pendingWriteReason = null;

// Whether the box mirrors the selection: isolate is off. While it is on the box holds the isolate
// text, and a click moves the anchor only.
function boxMirrorsSelection() {
  return isolateNow() === null;
}

// Writes the selection into the box (searchMirrorBox, search.js: the isolate text of its parts, the
// box's run of slices kept, a part that is one query as it was typed) with the reason 'mirror',
// which turns isolate on for no one and never makes the box a typed search. `from` is the selection
// the click started from: a pill it took off takes the cut it held with it. A card click, Add to
// selection, Esc's step down and a view switch come here, so the box says what is picked.
// `repaint` false is the Graph's click, which paints in place.
function mirrorSelectionInBox(from, repaint = true) {
  const selection = selectionState.selection;
  const box = $('#search-input').value;
  const text = searchMirrorBox(box, partsOf(selection), pillQueriesDropped(from, selection));
  if (repaint || text !== box) writeSearch(text, 'mirror', repaint);
}

function selectionFollowingBox(selection) {
  const reason = pendingWriteReason;
  pendingWriteReason = null;
  if (writeKeepsSelection(reason)) return selection;
  const text = $('#search-input').value;
  const isolated = isolateNow() !== null;
  if (writeIsCut(reason)) return loadViewMode() === 'graph' && !isolated && isTypedAnchor(selection) ? selectionAfterTyping(selection, text) : selection;
  const followed = loadViewMode() === 'graph' && !isolated ? selectionAfterTyping(selection, text) : selection;
  if (!writeEditsPills(reason)) return followed;
  return selectionAfterBoxEdit({ selection: followed, rangeStart: selectionState.rangeStart }, text, searchHasAlt).selection;
}

// What Esc does when nothing is open for it to close, and the one place the end
// of the Esc chain lives. The key guard (key-guard.js) says which: with focus in
// the search box Esc ends where repeated Esc does (clearBoxAndSelection); with nothing open
// and nobody typing it steps the selection back, and once nothing is picked clears the box;
// anywhere else (another text field, a select, an open surface) it does nothing. While
// isolated the box holds the isolate text, and Esc in it gives back the text it held
// instead of clearing: the browser's own Esc, which clears a search field, is stopped (`e` is
// the key's event), or it would take that text away again.
function escapeStep(e) {
  const action = keyGuardEscape(document, $('#search-input'));
  if (action === 'clear-box') {
    if (isolateTurnOff()) e.preventDefault();
    else clearBoxAndSelection();
  } else if (action === 'step') stepSelectionBack();
}

// Esc with focus in the box, isolate off: the end of repeated Esc in one step, an empty box with the
// run of slices gone and nothing selected, so the next click starts from a clean page and the card Esc
// let go of does not come back beside it. The selection goes first, so the one repaint of the clear
// finds nothing to follow.
function clearBoxAndSelection() {
  const picked = partsOf(selectionState.selection).length > 0;
  if (picked) setSelection(NO_SELECTION, null);
  if ($('#search-input').value) clearSearch();
  else if (picked) renderBoard();
}

// One stage back, as selectionAfterEscape (selection.js) works it out: isolate goes off
// first and gives the box its text back; then every addition goes at once and the anchor
// stays; the next one drops the anchor. Nothing picked, nothing to repaint. A box that was
// the anchor (a search typed in the Graph) goes with it, as it does on a double click on
// the empty Graph. A pill the step drops goes out of the box too (the additions first, so
// the box is back to the anchor's query, and then the anchor's), while any other text in
// the box stays. Once nothing is picked and isolate is off, one more Esc clears what the box
// still holds, the run of slices included (escapeStage, selection.js): repeated Esc ends on an
// empty box.
function stepSelectionBack() {
  const now = { ...selectionState, isolate: isolateNow() };
  const stage = escapeStage(now, $('#search-input').value);
  if (stage === 'box') { clearSearch(); return; }
  if (stage === null) return;
  const next = selectionAfterEscape(now);
  if (now.isolate && !next.isolate) { isolateTurnOff(); return; }
  moveSelectionTo(next);
}

// Moves the selection down to `next` ({ selection, rangeStart }) and takes what the step dropped
// out of the box: Esc's step and a double click on empty space (onClickAway) come through here, so
// the box and the pills agree whichever way the selection was taken down. A box that mirrors the
// selection the step started from (isolate off, and the box is that selection's text) follows it
// down (mirrorSelectionInBox). Any other box keeps its text: a typed anchor takes it with it, but for
// the cut, and a pill the step drops goes out of it as an alternative. While isolated the box holds
// the isolate text, which a step never writes. `from` is the selection the step started from.
function moveSelectionTo(next, from = selectionState.selection) {
  const boxWasAnchor = isTypedAnchor(from) && !next.selection.anchor;
  const box = $('#search-input').value;
  const shrunk = pillQueriesDropped(from, next.selection).reduce((text, query) => searchRemoveGrownAlt(text, query), box);
  const follows = boxMirrorsSelection() && box === searchMirrorBox(box, partsOf(from), []);
  setSelection(next.selection, next.rangeStart);
  if (follows) mirrorSelectionInBox(from);
  else if (boxWasAnchor) {
    const cut = searchCutOnly(box);
    writeSearch(cut, cut ? 'slice' : 'selection'); // a cut is no search: it never becomes the anchor the step has just dropped
  }
  else if (shrunk !== box) writeSearch(shrunk, 'unpill'); // a pill taken out turns nothing on
  else renderBoard();
}

function onSearchSlashKey(e) {
  if (e.key !== '/' || keyGuardOff(document)) return;
  e.preventDefault();
  $('#search-input').focus();
}

// Ctrl+F / Cmd+F: focus the search box, preventDefault
// on the browser's own find bar. search-hotkey.js owns the chord + value
// decision — an empty box gets "#" prefilled with the caret right after it
// (typing digits immediately forms the #<id> exact-match term), a box that
// already holds a query gets select-all instead, so the chord never
// silently clobbers a query someone already typed (typing overwrites the
// selection, same as any focused input). Suppressed while a surface is open
// (keyGuardSurface — the poll's modal test plus the card menu, the
// notifications panel and the preferences sheet): a popup's .modal-backdrop
// covers the whole viewport, so the search bar sits hidden behind it; the
// browser's native find stands in that case instead — mirror of Ctrl+S, which
// only fires INSIDE a popup, this one only fires OUTSIDE one. Unlike the "/"
// hotkey, no typing check is needed: Ctrl+F never inserts a literal
// character into whatever's focused, so there's nothing for it to hijack.
function onSearchChordKey(e) {
  const input = $('#search-input');
  const result = searchHotkeyPrefill(e, { surfaceOpen: keyGuardSurface(document) !== null, currentValue: input.value });
  if (!result) return;
  e.preventDefault();
  if (result.value !== input.value) writeSearch(result.value, 'prefill');
  input.focus();
  input.setSelectionRange(result.selectionStart, result.selectionEnd);
}

// Add a scoped term to whatever's already in the search
// box (assignee cue / tag click on a card tile) and re-render: it writes through
// writeSearch(next, 'cue'), the box's one writer, with no synthetic 'input' event.
// The term goes through the search module's term interface, so it lands in every
// alternative of a query holding `|` and a value with spaces stays one quoted term.
// Idempotent rather than a toggle: clicking the same assignee/tag again while
// its term is already present is a no-op — simpler than tracking "did I add
// this" to support removing it again.
function addSearchTerm(term) {
  const input = $('#search-input');
  const next = searchAddTerm(input.value, term);
  if (next === input.value) return;
  writeSearch(next, 'cue');
}

window.addEventListener('DOMContentLoaded', () => {
  const input = $('#search-input');
  // The Ctrl+F "#" prefill only makes sense while an id is
  // still being typed (digits). searchHashStrip re-checks the box on every
  // keystroke and drops the leading "#" the moment a non-numeric char shows
  // up after it, so the query reads as a plain search term instead of a
  // broken #<id> one. Caret shifts left by the same 1 char the strip
  // removed from the front, so typing feels uninterrupted.
  input.addEventListener('input', () => {
    const stripped = isolateNow() ? null : searchHashStrip(input.value); // the isolate text's leading # is a card, not an id still being typed
    const caret = stripped === null ? null : Math.max(0, input.selectionStart - 1);
    writeSearch(stripped === null ? input.value : stripped, 'typing');
    if (caret !== null) input.setSelectionRange(caret, caret);
  });
  $('#search-clear-btn').addEventListener('click', clearSearch);
  document.addEventListener('keydown', onSearchSlashKey);
  document.addEventListener('keydown', onSearchChordKey);
  // Autocomplete dropdown, same hand-rolled combobox (native
  // <datalist> misrenders in VSCode's Simple Browser — see attachCombobox's
  // own header comment) the create/edit form uses for priority/assignee/tags.
  // getOptions reads input.value itself (searchSuggestionItems computes
  // fresh candidates from whatever's currently typed, at the caret, so a token
  // inside a bracket or a quote or after a `|` completes in place) rather than
  // a static list — preFiltered/selectOnFocus:false are the two opt-outs that
  // make that fit; see attachCombobox's comments at each for why. The whole
  // board and its context go with it, the arguments a query is resolved with,
  // so after `slice:` and after `..` the box suggests the slices a cut can name.
  attachCombobox(input, () => searchSuggestionItems(input.value, input.selectionStart, state.active.concat(state.archived), searchCtx()), { preFiltered: true, selectOnFocus: false });
  // Enter goes to the first match unless a row of the suggestion list is highlighted. The listener is on the
  // box's wrapper in the capture phase so it runs before the input's own (the list's), which would otherwise
  // take the first Enter after typing just to close the list.
  const searchBox = input.parentElement;
  searchBox.addEventListener('keydown', (e) => {
    if (e.target !== input) return;
    const highlighted = !!searchBox.querySelector('.combobox-item.active');
    if (searchEnterKeyGoes(e, { highlighted }) && goToSearchMatch()) { e.preventDefault(); e.stopPropagation(); }
  }, true);
});

// The cards the query matches among those the view shows, as a Set of ids; null with no query. The Graph
// shows every card and lights the matches, so there it is the lit ones that are shown; with isolate off
// the other views light them and hide nothing, so it is what the whole query matches.
function searchEnterMatchIds() {
  const match = currentSearchMatch();
  if (!match.matched) return null;
  const pool = loadViewMode() === 'graph' ? currentGraphQueryEffect().litIds : match.matched;
  if (!pool) return null;
  const shown = shownCardIds();
  return new Set([...pool].filter((id) => shown.has(id)));
}

// The view's cards in reading order. The Board's columns are worked out here rather than read off the page,
// because a phone draws one status at a time.
function searchEnterOrder(mode) {
  if (mode !== 'board') return visibleCardIds();
  const colSort = loadColumnSort();
  const statuses = boardStatuses();
  const outlineIndex = outlineOrder(state.active.concat(state.archived), nestingCtx()).index;
  const ids = [];
  for (const col of boardColumnIds()) {
    const source = col === 'archive' ? state.archived : state.active.filter((c) => columnForStatus(c.status, statuses) === col);
    sortCards(source, colSort[col], state.priorities, state.assignees.map((a) => a.handle), outlineIndex).forEach((c) => ids.push(c.id));
  }
  return ids;
}

// The card the last Enter in the search box focused in the Graph, as text: its focus does not light the card's
// relations, so the search's own lights stay. Any other pointer or focus move forgets it.
let searchEnterFocusedId = null;

// Enter in the search box: close the panel (and the phone's field), bring the first matching card to the middle
// of the view and give it focus. The query, the selection and the pills are not touched. False when nothing matches.
function goToSearchMatch() {
  const mode = loadViewMode();
  const ids = searchEnterMatchIds();
  if (!ids || !ids.size) return false;
  const id = searchEnterTarget(searchEnterOrder(mode), ids);
  if (id === null) return false;
  if (searchFieldOpen) setSearchFieldOpen(false);
  else setSearchPanelOpen(false);
  const box = $('#search-input');
  if (document.activeElement === box) box.blur();
  if (mode === 'board' && onPhoneLayout()) {
    const card = state.active.concat(state.archived).find((c) => String(c.id) === id);
    setPhoneColumn(state.archived.some((c) => String(c.id) === id) ? 'archive' : columnForStatus(card.status, boardStatuses()));
    renderBoard();
  }
  const inline = onPhoneLayout() ? 'nearest' : 'center'; // a phone's page never scrolls sideways
  const pointer = hoveredId;
  let el;
  if (mode === 'graph' && graphCur) {
    const nodeId = [...graphCur.nodeEls.keys()].find((k) => String(k) === id);
    const at = nodeId === undefined ? null : graphCur.layout.pos.get(nodeId);
    if (at) {
      const stage = graphCur.svg.getBoundingClientRect();
      Object.assign(graphCur.view, searchEnterPan(graphCur.view, at, stage.width || graphCur.w, stage.height || graphCur.h), { touched: true });
      graphApplyTransform();
    }
    el = nodeId === undefined ? null : graphCur.nodeEls.get(nodeId);
  } else {
    const root = $(VIEW_CONTAINERS[mode]);
    el = root.querySelector(`.card-el[data-id="${id}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline });
    const bar = mode === 'gantt' ? root.querySelector(`.gantt-scroll .card-el[data-id="${id}"]`) : null; // the label in the gutter has the focus; the bar is brought into the timeline's view
    if (bar && bar.scrollIntoView) bar.scrollIntoView({ block: 'nearest', inline });
  }
  searchEnterFocusedId = mode === 'graph' ? id : null; // the Graph keeps the search's lights when this focus lands (see wireGraphView)
  if (el) el.focus({ preventScroll: true, focusVisible: true });
  if (mode === 'graph' && hoveredId !== pointer) setHoveredId(pointer); // focus is not the pointer: a poll would light the card again
  return true;
}

// --- Map view wiring: top-bar toggle + the bits
// the shared card-el grammar does NOT cover. #map-view is rebuilt from
// scratch by every renderMapView() call (manual/poll/drag/toggle alike, same
// as #board's cards), so clicks use event delegation on the stable #map-view
// parent. Real nodes and the No relations row's tiles carry card-el + data-id
// (see buildMapSvg/buildIsolatedRow) and are handled by the document-level
// grammar handlers in the multi-select section — click-to-detail,
// ctrl/shift-click selection, right-click menu, all shared. What stays here:
// - an archived No relations tile's Restore/Delete buttons (data-act) — checked
//   FIRST, same ordering as #board's delegated listener, so a click on a
//   button nested inside a card-el tile triggers the action (the shared
//   handler independently ignores clicks landing on buttons);
// - ghost stubs with real card data behind them: click-through to detail
//   only, deliberately NOT card-el (see buildMapSvg's selectable note), so
//   "jump to a hidden dep's detail" still works straight from the stub.
//   A `missing` stub (a waiting_for id with no matching card at all) has
//   nothing to open and never gets data-id.
window.addEventListener('DOMContentLoaded', () => {
  $('#map-toggle-btn').addEventListener('click', () => toggleView('map'));
  fillViewBar();
  for (const btn of document.querySelectorAll('#view-bar [data-view]')) btn.addEventListener('click', () => setView(btn.dataset.view));
  $('#map-view').addEventListener('click', (e) => {
    const panelBtn = e.target.closest('.view-panel-toggle[data-panel], .view-panel-close[data-panel]');
    if (panelBtn) { pressViewPanelButton(panelBtn, renderMapView); return; }
    // Section collapse toggles — control-row buttons, checked first
    // for the same reason the status pills and data-act buttons are (never fall
    // through to card-el).
    const sectionBtn = e.target.closest('.map-section-toggle[data-section]');
    if (sectionBtn) {
      keepControlFocus(sectionBtn, () => toggleMapSection(sectionBtn.dataset.section));
      return;
    }
    const optionBtn = e.target.closest('.map-option-btn[data-key][data-val]');
    if (optionBtn) {
      setMapOption(optionBtn.dataset.key, optionBtn.dataset.val);
      return;
    }
    // Zoom toolbar — same control-row-buttons-checked-first reasoning; a
    // disabled button (already at the clamp's edge) still reaches this
    // handler (disabled buttons don't dispatch click at all, so the
    // in/out branches below are dead code on THOSE presses, never a
    // silent no-op the human can't tell from a bug) — the buttons that
    // do fire just call the same zoomMap* helpers 'fit' always uses.
    const zoomBtn = e.target.closest('.map-zoom-btn[data-zoom-action]');
    if (zoomBtn) {
      const action = zoomBtn.dataset.zoomAction;
      if (action === 'fit') zoomMapFit();
      else zoomMapStep(action === 'in' ? 1 : -1);
      return;
    }
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      const id = actBtn.dataset.id;
      if (actBtn.dataset.act === 'restore') doRestore(id);
      if (actBtn.dataset.act === 'delete-arch') doDelete(id);
      return;
    }
    const stub = e.target.closest('.map-node.ghost[data-id]');
    if (stub) openCard(stub.dataset.id);
  });
  wireMapPanZoom();
});

// --- Map pan + zoom ---------------------------------------------------------
// Drag-to-pan (pointer events + setPointerCapture, NOT HTML5 drag & drop —
// same reasoning as the gantt's wireGanttPointerDrag: a continuous two-axis
// scroll offset needs a live per-move delta, which HTML5 dragover only gives
// against a grid of drop targets) plus the zoom toolbar/Ctrl+wheel actions.
// One delegated pointerdown/move/up/cancel set on the stable #map-view
// parent (wired once, see wireMapPanZoom below) — per-render rewiring isn't
// needed, same as the click/contextmenu listeners above. Unlike the gantt's
// drag, capture is claimed on #map-view itself (a delegated parent, not the
// specific node pressed) and only once the gesture clears the drag
// threshold — see the pointerdown/pointermove handlers' own comments for why
// capturing any earlier breaks plain clicks.

// Scoped to `.map-canvas` (the graph SVG itself) so pan can start from
// EITHER empty background OR a node — "a drag that starts on a card node
// ALSO pans" — while leaving every other control alone by construction:
// the status pills and section-collapse chevron all sit outside
// `.map-canvas` (above it in the section header / control rows), and the
// "No relations" row is a sibling of `.map-graph-section` entirely, so
// its tiles keep native text selection untouched — no separate exclusion
// list to keep in sync with the markup.
let mapPan = null; // { pointerId, startX, startY, startScrollLeft, startScrollTop, moved }

// Same phantom-click problem the gantt solves (suppressGanttPhantomClick):
// a pointer-capture drag still dispatches a compatibility `click` on
// pointerup even after real movement (mousedown/up land on the same
// captured element regardless of distance moved), which would hit the
// shared card-el grammar and open the card the drag started on, or the
// click-away rule (onClickAway). One-shot: armed only by a MOVED pan's
// pointerup, consumed by the very next click, self-disarms on a 0-timeout
// in case no click follows. Own flag (not ganttClickSuppressed) — the two
// gestures never overlap (different views), but sharing one would let a
// drag in one view eat an unrelated click in the other if timing ever raced.
let mapPanClickSuppressed = false;

// A two-finger pinch on the Map: { ids, points, startDistance, startMid, startZoom, scale, trees }.
// The fingers' latest positions are kept for every pointer pressed inside a drawing, so the
// second finger to land can measure against the first.
let mapPinch = null;
const mapPointers = new Map();

function suppressMapPanPhantomClick() {
  mapPanClickSuppressed = true;
  setTimeout(() => { mapPanClickSuppressed = false; }, 0);
}

// Where the SVG's own top-left corner sits, in the SAME scroll-content
// coordinate space container.scrollLeft/scrollTop address — NOT (0,0).
// #map-view's own padding plus the filter row, zoom row and section header
// above the graph all sit between the panel's scroll origin and the SVG,
// and none of them scale with zoom. mapZoomPanOffset/fitMapZoom's callers
// need this as a fixed origin so only the SVG's own content scales
// (a zero origin would drift the zoom anchor by
// origin*(ratio-1) per step, and make Fit measure against the whole panel
// instead of the space actually left for the graph).
// Scroll-invariant by construction: subtracting the panel's own current
// scrollLeft/scrollTop out of the SVG's on-screen position cancels whatever
// the panel happens to be scrolled to right now, leaving just the fixed
// layout offset (padding + the rows above), which doesn't change with zoom
// OR scroll.
function mapSvgOrigin(container, svg) {
  const panelRect = container.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  return {
    originX: svgRect.left - panelRect.left - container.clientLeft + container.scrollLeft,
    originY: svgRect.top - panelRect.top - container.clientTop + container.scrollTop,
  };
}

// Applies a new zoom around one anchor point (in the panel's OWN viewport
// coordinates — see map-zoom.js's mapZoomPanOffset) and re-renders: computed
// BEFORE the zoom/render change (against the CURRENT zoom's content
// coordinates), then applied to the container's scroll AFTER renderMapView()
// rebuilds at the new size — renderMapView's own keepLeft/keepTop restores
// the OLD scroll position internally first, which this then overwrites with
// the real target, so the two never visibly fight (one synchronous JS turn,
// nothing paints in between).
function zoomMapAt(newZoom, anchorX, anchorY) {
  const container = $('#map-view');
  const svg = container.querySelector('.map-canvas');
  const oldZoom = loadMapZoom();
  const clamped = clampMapZoom(newZoom);
  if (clamped === oldZoom) return;
  const origin = svg ? mapSvgOrigin(mapMain, svg) : { originX: 0, originY: 0 };
  const offset = mapZoomPanOffset({
    scrollLeft: mapMain.scrollLeft,
    scrollTop: mapMain.scrollTop,
    pointerX: anchorX,
    pointerY: anchorY,
    oldZoom,
    newZoom: clamped,
    originX: origin.originX,
    originY: origin.originY,
  });
  setMapZoom(clamped);
  renderMapView();
  mapMain.scrollLeft = offset.scrollLeft;
  mapMain.scrollTop = offset.scrollTop;
}

// The +/- toolbar buttons: no pointer to anchor on, so they zoom around the
// panel's own center — the point that stays visually stillest for a button
// press, same convention most map apps use for their +/- controls.
function zoomMapStep(direction) {
  zoomMapAt(stepMapZoom(loadMapZoom(), direction), mapMain.clientWidth / 2, mapMain.clientHeight / 2);
}

// Fit: largest zoom (capped at 100%) that shows the whole graph, computed
// against the SAME logical size applyMapZoomToSvg stashed on the rendered
// svg's dataset (no re-run of layerNodes()/buildMapSvg() just to measure).
// No anchor math — once the whole graph fits, there's nothing to scroll to,
// so this sets the zoom directly and resets scroll to the top-left corner
// rather than reusing zoomMapAt's pointer-preserving offset.
//
// The scrolling area's clientWidth/clientHeight is its PADDING box — it
// includes its own 14px padding on every side, AND clientHeight
// includes the filter row/zoom row/section header space above the SVG,
// none of which the graph can actually draw into. Passing those raw to
// fitMapZoom measured against space the graph doesn't have, so Fit
// undershot and the graph's bottom edge (or right edge, width-bound) still
// needed scrolling to see. The available box:
// width is clientWidth minus the left+right padding (nothing else sits
// beside the SVG horizontally); height is clientHeight minus the SVG's own
// top offset in content space (mapSvgOrigin — padding-top plus every row
// above it) minus the bottom padding.
function zoomMapFit() {
  const container = $('#map-view');
  const svg = container.querySelector('.map-canvas');
  if (!svg) return; // collapsed section, or no graph at all — nothing to fit
  let fitW = 0;
  let fitH = 0;
  container.querySelectorAll('.map-canvas').forEach((s) => {
    fitW = Math.max(fitW, Number(s.dataset.logicalWidth));
    fitH = Math.max(fitH, Number(s.dataset.logicalHeight));
  });
  const style = getComputedStyle(mapMain);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padRight = parseFloat(style.paddingRight) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;
  const { originY } = mapSvgOrigin(mapMain, svg);
  const availableWidth = mapMain.clientWidth - padLeft - padRight;
  const availableHeight = mapMain.clientHeight - originY - padBottom;
  const fit = fitMapZoom(fitW, fitH, availableWidth, availableHeight);
  setMapZoom(fit);
  renderMapView();
  mapMain.scrollLeft = 0;
  mapMain.scrollTop = 0;
}

function wireMapPanZoom() {
  const container = $('#map-view');
  // Same one-shot-suppress-the-next-click shape as the gantt's own
  // document-level capture listener (wireGanttPointerDrag) — capture phase
  // at document so this runs BEFORE the shared card-el grammar's bubble-
  // phase click handler and can stopPropagation ahead of it.
  document.addEventListener('click', (e) => {
    if (!mapPanClickSuppressed) return;
    mapPanClickSuppressed = false;
    if (!e.target.closest || !e.target.closest('#map-view')) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // The pinch scales one wrapper of every tree while the fingers move (a CSS transform through
  // the style object) and zooms the Map once when they lift: the Map redraws on every zoom, which
  // would pull the touched drawing out of the page mid-gesture. isDragging is held the whole time
  // so the 5-second refresh waits, and every exit path (lift, cancel, lost capture) clears it.
  const startMapPinch = (e) => {
    const first = [...mapPointers.keys()].find((id) => id !== e.pointerId);
    const a = mapPointers.get(first);
    const b = { x: e.clientX, y: e.clientY };
    if (mapPan) { // the second finger ends a one-finger pan in progress
      mapPan = null;
      container.classList.remove('map-panning');
    }
    const trees = e.target.closest('.map-trees');
    const mid = pinchMidpoint(a, b);
    mapPinch = {
      ids: [first, e.pointerId],
      points: { [first]: a, [e.pointerId]: b },
      startDistance: pinchDistance(a, b),
      startMid: mid,
      startZoom: loadMapZoom(),
      scale: 1,
      trees,
    };
    if (trees) {
      const rect = trees.getBoundingClientRect();
      trees.style.transformOrigin = `${mid.x - rect.left}px ${mid.y - rect.top}px`;
    }
    isDragging = true;
  };
  const finishMapPinch = () => {
    if (!mapPinch) return;
    const pinch = mapPinch;
    mapPinch = null;
    isDragging = false;
    if (pinch.trees) {
      pinch.trees.style.transform = '';
      pinch.trees.style.transformOrigin = '';
    }
    suppressMapPanPhantomClick(); // a pinch never ends in a tap that opens or selects a card
    const factor = pinchFactor(pinch.startDistance, pinchDistance(pinch.points[pinch.ids[0]], pinch.points[pinch.ids[1]]));
    if (!pinchFactorIsChange(factor)) return;
    const rect = mapMain.getBoundingClientRect();
    zoomMapAt(pinchZoom(pinch.startZoom, factor), pinch.startMid.x - rect.left, pinch.startMid.y - rect.top);
  };
  container.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.map-canvas')) return; // pan only from inside the graph section — see the header comment above
    if (mapPinch) return; // a third finger starts nothing
    mapPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mapPan && e.pointerId !== mapPan.pointerId && mapPointers.size === 2) { startMapPinch(e); return; }
    if (e.button !== 0 || mapPan) return; // primary button only; a second pointer mid-pan is ignored
    mapPan = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: mapMain.scrollLeft,
      startScrollTop: mapMain.scrollTop,
      moved: false,
    };
    // No setPointerCapture here — deferred to pointermove, once the drag
    // clears the threshold (below). Unlike the gantt's own drag (which
    // captures on the specific barEl it started on, so a retargeted click
    // still lands on that same element), this capture target is the
    // DELEGATED #map-view container. Capturing immediately retargets the
    // compatibility `click` (and mouseup) that follows EVERY press —
    // including a plain, unmoved one — to the container itself, never the
    // node/stub actually pressed. The shared card-el grammar's
    // `e.target.closest('.card-el')` then finds nothing on #map-view, so a
    // plain click stopped opening cards and Ctrl/Shift-click stopped
    // selecting. Once the gesture IS a
    // real drag the resulting click is suppressed outright by
    // suppressMapPanPhantomClick below, so its target no longer matters.
    isDragging = true; // poll guard for the whole gesture, released in finish() — same flag/contract the board/calendar/gantt drags already share (autoRefreshSkipState, the contextmenu guards)
    e.preventDefault(); // no text selection mid-drag over node/edge SVG text
  });
  container.addEventListener('pointermove', (e) => {
    if (mapPointers.has(e.pointerId)) mapPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mapPinch) {
      if (!mapPinch.ids.includes(e.pointerId)) return;
      mapPinch.points[e.pointerId] = { x: e.clientX, y: e.clientY };
      const factor = pinchFactor(mapPinch.startDistance, pinchDistance(mapPinch.points[mapPinch.ids[0]], mapPinch.points[mapPinch.ids[1]]));
      mapPinch.scale = pinchZoom(mapPinch.startZoom, factor) / mapPinch.startZoom;
      if (mapPinch.trees) mapPinch.trees.style.transform = `scale(${mapPinch.scale})`;
      return;
    }
    if (!mapPan || e.pointerId !== mapPan.pointerId) return;
    const dx = e.clientX - mapPan.startX;
    const dy = e.clientY - mapPan.startY;
    if (!mapPan.moved && mapDragExceededThreshold(dx, dy, MAP_DRAG_THRESHOLD)) {
      mapPan.moved = true;
      // Capture now — the gesture is a confirmed drag, so retargeting the
      // eventual click (blocked below by suppressMapPanPhantomClick) no
      // longer breaks anything, and capture keeps the drag tracking the
      // pointer even past the panel's own edges.
      container.setPointerCapture(mapPan.pointerId);
      container.classList.add('map-panning'); // grabbing cursor — see .map-view.map-panning in app.css
    }
    if (!mapPan.moved) return; // under threshold: still a candidate click, don't scroll yet
    // Moving the pointer right/down should reveal content to the right/down
    // (the graph moves WITH the pointer, like a map app's drag-to-pan) —
    // the panel scrolls the OPPOSITE direction of the pointer delta.
    mapMain.scrollLeft = mapPan.startScrollLeft - dx;
    mapMain.scrollTop = mapPan.startScrollTop - dy;
  });
  const finish = () => {
    if (!mapPan) return;
    const drag = mapPan;
    mapPan = null;
    isDragging = false;
    container.classList.remove('map-panning');
    if (drag.moved) suppressMapPanPhantomClick(); // only a MOVED drag suppresses the click that follows — an unmoved press stays a plain click (card open / selection), same >threshold rule as the gantt's own drag-vs-click line
  };
  const pointerEnded = (e) => {
    mapPointers.delete(e.pointerId);
    if (mapPinch && mapPinch.ids.includes(e.pointerId)) finishMapPinch();
    else if (mapPan && e.pointerId === mapPan.pointerId) finish();
  };
  container.addEventListener('pointerup', pointerEnded);
  container.addEventListener('pointercancel', pointerEnded);
  // Capture can end without either event above — the browser drops it
  // implicitly (e.g. another element steals capture, or #map-view's own
  // innerHTML gets rebuilt out from under an active capture by some other
  // path). Treat that the same as a release, so the gesture can never end
  // in a state pointerup/pointercancel would have cleaned up.
  container.addEventListener('lostpointercapture', pointerEnded);
  // Deferred capture (above) means an UNMOVED press's release can land
  // outside #map-view — right at the panel's edge, or in the sliver before
  // the gesture crosses the threshold — where the container's own pointerup
  // listener above never sees it. Without this net, mapPan/isDragging would
  // stay set forever and freeze the 5s poll for the WHOLE app, not just the
  // map. Document-level so it always sees the
  // release regardless of target; finish() itself is idempotent (no-ops
  // once mapPan is already null), so this never double-fires against the
  // container listeners above.
  document.addEventListener('pointerup', pointerEnded);
  document.addEventListener('pointercancel', pointerEnded);
  // Ctrl+wheel (also what a trackpad pinch sends) zooms around the pointer;
  // a plain wheel keeps the panel's native scroll. Non-passive — the
  // preventDefault below is what stops the browser's own page-zoom/scroll on
  // the ctrlKey gesture, and a passive listener can't call it. Scoped to
  // `.map-canvas` like the drag above — Ctrl+wheel over the pills/isolated
  // row falls through to whatever the browser normally does there.
  container.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    if (!e.target.closest || !e.target.closest('.map-canvas')) return;
    e.preventDefault();
    const rect = mapMain.getBoundingClientRect();
    // Continuous (stepMapZoomByWheel), not the buttons' fixed-rung
    // stepMapZoom — a trackpad pinch fires a burst of these with small
    // deltaY each, and one full rung per event used to reach the zoom
    // clamp in about four events.
    zoomMapAt(stepMapZoomByWheel(loadMapZoom(), e.deltaY, e.deltaMode), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
}

// --- Calendar view ---------------------------
// Month grid + chips + drag-to-reschedule, plus the Outlook/Teams-style
// Month | Week | 3 days | Day switcher. All date math and layout construction
// live in calendar-model.js (pure, unit-tested, dual-environment); everything
// below is presentation and API glue. LIVE cards (state.active) by default —
// the calendar answers "when is work due", and archived cards aren't work —
// but dated ARCHIVED cards can join too, opt-in via the Archive
// pill, same "show it if the human asks" reasoning as the gantt's own
// Archive pill.
//
// The displayed window is ONE in-memory anchor day for all four sub-views
// (the month view derives
// y/m from it, so the window carries across sub-view switches): it is none, which
// reads as today, until a control moves it, so an untouched window follows the clock
// across midnight; it survives the 5s poll's re-render by construction
// (renderCalendarView reads it, nothing in the render path resets it — only
// the prev/next/Today controls write it).
let calendarAnchor = null;

function currentCalendarAnchor() {
  return calendarAnchor || localTodayStr(); // none until a control moves it, so the window follows the clock across midnight
}

// The Calendar opens on a day: the picked iteration's first one (iterations-ui.js).
function calendarAnchorTo(day) {
  calendarAnchor = day;
}

function currentCalendarMonth() {
  const [y, m] = currentCalendarAnchor().split('-').map(Number);
  return { year: y, monthIndex: m - 1 };
}

// The sub-view choice persists per board — same memoize-once
// localStorage discipline as viewMode above (feature key 'calendar.subview',
// validated by mergeCalendarSubview: unknown/corrupt saved values fall back
// to month).
let calendarSubview = null;

function loadCalendarSubview() {
  if (calendarSubview) return calendarSubview;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'calendar.subview')); }
  catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to month
  calendarSubview = mergeCalendarSubview(saved);
  return calendarSubview;
}

function saveCalendarSubview() {
  try { localStorage.setItem(storageKey(state.projectName, 'calendar.subview'), calendarSubview); }
  catch (e) { /* storage unavailable/full — sub-view choice just won't persist this session */ }
}

function setCalendarSubview(subview) {
  if (!CALENDAR_SUBVIEWS.includes(subview) || subview === loadCalendarSubview()) return;
  calendarSubview = subview;
  saveCalendarSubview();
  renderCalendarView();
}

// The Notes switch (feature key 'calendar.notes'): whether the week, 3-day and day views draw the
// logbook's notes beside the cards. On unless this browser saved off for the board; the switch
// and the layer exist only on a board that keeps a logbook.
let calendarNotes = null;

// The day cell or column the pointer is over in the Calendar, or null: n then opens the notes palette on
// that day (notes-palette.js notesCalendarOpening). Tracked from the pointer, kept nowhere.
let calendarHoverDay = null;

function calendarNotesOn() {
  if (!notesOn()) return false;
  if (calendarNotes === null) {
    let saved = null;
    try { saved = localStorage.getItem(storageKey(state.projectName, 'calendar.notes')); }
    catch (e) { saved = null; }
    calendarNotes = saved !== 'off';
  }
  return calendarNotes;
}

function setCalendarNotes(on) {
  calendarNotes = !!on;
  try { localStorage.setItem(storageKey(state.projectName, 'calendar.notes'), calendarNotes ? 'on' : 'off'); }
  catch (e) { /* storage unavailable/full: the choice just won't persist this session */ }
  renderCalendarView();
}

// The notes strip's width (feature key 'calendar.notesWidth'): the divider on a strip's left edge sets
// it for every day column at once. It is CAL_NOTES_UNREAD until the board's saved choice has been read,
// then CAL_NOTES_DEFAULT (the stylesheet's own width) or a number of px. Kept per board in this browser
// (notes-calendar.js), and drawn into the grid as the custom property --cal-note-width, which every
// column's --cal-note-strip reads.
const CAL_NOTES_UNREAD = 'unread';
const CAL_NOTES_DEFAULT = 'default';
let calendarNotesWidth = CAL_NOTES_UNREAD;

// The width in px, or null for the default.
function calendarNotesStrip() {
  if (calendarNotesWidth === CAL_NOTES_UNREAD) {
    const storage = prefsStorage();
    const saved = storage ? noteStripLoad(storage, state.projectName) : null;
    calendarNotesWidth = saved === null ? CAL_NOTES_DEFAULT : saved;
  }
  return calendarNotesWidth === CAL_NOTES_DEFAULT ? null : calendarNotesWidth;
}

// `px` into the time grid that is drawn, live: no re-render, so a drag and a key press keep their element.
function paintCalendarNotesStrip(px) {
  const grid = document.querySelector('#calendar-view .cal-timegrid');
  if (!grid) return;
  const css = noteStripCss(px);
  if (css === null) grid.style.removeProperty('--cal-note-width');
  else grid.style.setProperty('--cal-note-width', css);
  paintCalendarNotesAria();
}

// Each divider reports its strip as a percentage of its column (aria-valuenow, -min, -max), read from where
// it is drawn: the default width is the stylesheet's.
function paintCalendarNotesAria() {
  for (const d of document.querySelectorAll('#calendar-view .cal-note-divider')) {
    const r = d.closest('.cal-tg-col').getBoundingClientRect();
    const at = d.getBoundingClientRect();
    const v = noteStripPercent(r.right - (at.left + at.width / 2), r.width);
    if (!v) continue;
    d.setAttribute('aria-valuenow', String(v.now));
    d.setAttribute('aria-valuemin', String(v.min));
    d.setAttribute('aria-valuemax', String(v.max));
  }
}

function setCalendarNotesStrip(px) {
  calendarNotesWidth = px === null ? CAL_NOTES_DEFAULT : px;
  const storage = prefsStorage();
  if (storage) noteStripSave(storage, state.projectName, px);
  paintCalendarNotesStrip(px);
}

// Local time on purpose (matches the user's wall clock, same as
// formatLocalDateTime) — the grid itself is built with UTC math but its "is
// this cell today" check must agree with the calendar on the user's wall.
function localTodayStr() {
  return kanbanDays.localToday();
}

function calendarChipEl(card, pos, time, isDue) {
  const el = document.createElement('div');
  const pb = priorityBadge(card, state.priorities); // same emphasis rules as the board tiles
  // Chips join the shared card-el grammar. Selection is by id, so
  // every chip of a multi-day run paints .selected together — they all read
  // the same selectedIds entry on this render. The deadline chip keeps
  // its distinct class on top of the grammar.
  // Same for archived — priority/waiting keep applying regardless
  // (matching the gantt bar's precedent: colorStatus/mute is a SEPARATE
  // channel from the border accent, so an archived-and-high card still reads
  // high). archived rides the class list too, for the not-allowed cursor.
  // The amber accent marks WAITING; the manual blocked sticker's red pill
  // lives on tiles + map only.
  // The isDue guard is load-bearing: overdue is a property of the CARD, so a
  // compat range's own chips (start→due, same due_date) would go red too
  // without it. Only the deadline chip can miss a deadline — which is also
  // why ".overdue" only has to out-order ".cal-chip-due" in app.css.
  const overdue = isDue && isOverdue(card, localTodayStr());
  el.className = `cal-chip card-el ${pos}` + (isDue ? ' cal-chip-due' : '') +
    (pb.className ? ` ${pb.className}` : '') + (isWaiting(card) ? ' waiting' : '') +
    (card.archived ? ' archived' : '') +
    (overdue ? ' overdue' : '') +
    (paintsSelected(card.id) ? ' selected' : '') +
    (isHoverHighlighted(hoverLit, card.id) ? ' hover-highlight' : '');
  // An archived card is
  // read-only — native drag simply never starts (no fake-drag animation to
  // guard against, unlike the gantt's custom pointer-drag), so onCalendarDrop
  // never gets called for it in the first place.
  el.draggable = !card.archived;
  el.tabIndex = 0; // reachable by Tab so the hover cue isn't pointer-only (kanban.proj#261)
  el.dataset.id = card.id;
  // The due marker is a DIFFERENT chip from the range run — the drop
  // handler must know which one was picked up (range drag moves the range pair,
  // due drag moves due_date alone), so the deadline chip flags itself.
  if (isDue) el.dataset.due = '1';
  // Time-of-day only where the chip represents the moment itself (single /
  // range-end / the due marker) — a range's start/mid days repeating the end
  // time would misread.
  const timeLabel = time && (pos === 'single' || pos === 'range-end') ? `${escapeHtml(time)} ` : '';
  const glyph = isDue ? '<span class="cal-chip-due-glyph">⚑</span> ' : ''; // ⚑ deadline flag before the text
  // The status dot rides right after the id, before the title —
  // dense-chip width is handled the same way: nowrap+
  // ellipsis on .cal-chip only ever crops the TAIL (the title), never the
  // id/dot near the front.
  // archived joins status — same "status, archived" glyph order
  // every other surface uses (Archived ball), gated
  // on the chip's own card.archived flag.
  // Same empty-title-shows-the-prompt fallback every other
  // view uses (cardTitleDisplay, card-title.js) — reused as-is.
  const titleDisplay = cardTitleDisplay(card);
  el.innerHTML = `${glyph}${timeLabel}<span class="cal-chip-id">#${card.id}</span>${statusBadge(card)}${card.archived ? archivedBadge() : ''} ` +
    `<span class="cal-chip-title${titleDisplay.isPromptFallback ? ' cal-chip-title--prompt-fallback' : ''}">${escapeHtml(titleDisplay.text)}</span>`;
  const readOnlyHint = 'Archived — restore the card to reschedule';
  el.title = `#${card.id} ${titleDisplay.text}${isDue ? ' — due' : ''}${overdue ? ' — past due' : ''}${card.archived ? ` — ${readOnlyHint}` : ''}`; // plain-text property — full title/prompt survives the CSS truncation
  return el;
}

// The sub-view label set for the switcher + the nav buttons' spans.
const CAL_SUBVIEW_LABELS = { month: 'Month', week: 'Week', '3day': '3 days', day: 'Day' };

// The three inputs a timeline view (the Calendar or the Gantt) composes before it draws
// (see renderCalendarMonthGrid, renderCalendarTimeGrid and renderGanttView: the search
// result, the status filter's visible ids and the Archive pill), as the jump to the nearest
// match and the cards a selection can reach (viewCardIds) need them. `filter` is the view's
// status filter and `searchIds` the box's match, null for no query. viewShownCards
// (calendar-model.js) composes them the way the grids and rows do, and
// calendar-gantt-jump-page.test.js pins that what it answers is what they hand to their layout.
function timelineViewInput(filter, searchIds) {
  return {
    active: state.active,
    archived: state.archived,
    searchIds,
    statusIds: ganttFilterVisibleIds(state.active, filter, boardStatuses()),
    archiveOn: filter.archive === true,
  };
}

function calendarViewInput(match = currentSearchMatch()) {
  return timelineViewInput(loadCalendarStatusFilter(), withIterationCut(match.ids));
}

function renderCalendarView() {
  const container = $('#calendar-view');
  const subview = loadCalendarSubview();
  // Preserve the time grid's scroll across re-renders (poll included) — same
  // keepLeft/keepTop discipline as renderMapView. null = first paint.
  const prevScroll = container.querySelector('.cal-tg-scroll');
  const keepScroll = prevScroll ? prevScroll.scrollTop : null;
  container.innerHTML = '';

  const spanNoun = { month: 'month', week: 'week', '3day': '3 days', day: 'day' }[subview];
  const title = subviewTitle(subview, currentCalendarAnchor());
  paintHeaderDate('calendar', title);
  const controls = document.createElement('div');
  controls.className = 'cal-controls';
  controls.innerHTML =
    `<button type="button" id="cal-prev-btn" class="cal-nav" data-keeps-selection data-holds-poll title="Previous ${spanNoun}" aria-label="Previous ${spanNoun}">&#8249;</button>` +
    `<button type="button" id="cal-today-btn" class="cal-nav" data-keeps-selection data-holds-poll title="Jump back to today">Today</button>` +
    `<button type="button" id="cal-next-btn" class="cal-nav" data-keeps-selection data-holds-poll title="Next ${spanNoun}" aria-label="Next ${spanNoun}">&#8250;</button>` +
    `<span class="cal-title">${escapeHtml(title)}</span>` +
    // The sub-view switcher. Like prev/today/next (these buttons are rebuilt every
    // render too) it wears data-holds-poll, the focused-control poll guard, and
    // data-keeps-selection, so a click on it never reads as a click away.
    `<span class="cal-subview-switch" role="group" aria-label="Calendar span">` +
    CALENDAR_SUBVIEWS.map((sv) =>
      `<button type="button" class="cal-subview-btn cal-nav${sv === subview ? ' active' : ''}" data-keeps-selection data-holds-poll ` +
        `data-subview="${sv}" aria-pressed="${sv === subview}">${CAL_SUBVIEW_LABELS[sv]}</button>`).join('') +
    `</span>` +
    // The span cycle button: on a phone it stands in for the span switch (app.css hides one and shows the other).
    // It shows the current span and a cycle mark; a screen reader hears the span a tap moves to.
    `<button type="button" class="cal-span-cycle cal-nav" data-keeps-selection data-holds-poll aria-label="Span: ${CAL_SUBVIEW_LABELS[subview]}. Change to ${CAL_SUBVIEW_LABELS[nextSubview(CALENDAR_SUBVIEWS, subview)]}">${CAL_SUBVIEW_LABELS[subview]} &#8635;</button>` +
    // The Notes switch: only where notes are drawn (the time grids of a board with a logbook).
    (subview !== 'month' && notesOn()
      ? `<button type="button" id="cal-notes-btn" class="cal-nav cal-notes-switch${calendarNotesOn() ? ' active' : ''}" data-keeps-selection data-holds-poll aria-pressed="${calendarNotesOn()}" title="${calendarNotesOn() ? 'Hide' : 'Show'} the notes on the calendar">Notes</button>`
      : '');
  container.appendChild(controls);
  // No status pill row here: the search panel's Statuses section keeps the
  // recover-from-empty guarantee. Both branches below (month and every
  // sub-view) read the same loadCalendarStatusFilter().

  if (subview === 'month') renderCalendarMonthGrid(container);
  else renderCalendarTimeGrid(container, subview, keepScroll);
  wireCalendarDrag();
}

// The month grid, in its own
// function (the sub-view switcher branches between this and the time grid).
function renderCalendarMonthGrid(container) {
  const { year, monthIndex } = currentCalendarMonth();
  // Same search composition as the board and map: read the shared match
  // result (see currentSearchMatch).
  // A card appears via its RANGE (cardSchedule) and/or its DUE
  // marker (dueMarker) — a due-only card has no schedule but still chips.
  // The search pool spans live + archived unconditionally, same as
  // the gantt — harmless while the Archive pill is off, since no archived
  // card is ever added to `cards` below regardless of whether its id lands
  // in searchIds.
  const searchIds = withIterationCut(currentSearchMatch().ids);
  // Status filter composes with search by INTERSECTION — same rule
  // as the map's and the gantt's composition. ganttFilterVisibleIds
  // (not mapFilterVisibleIds) is the right helper here too: the calendar
  // doesn't bucket cards into board columns any more than the gantt's group
  // rows do — a card whose status has no pill just stays ungoverned by any
  // toggle, rather than folding into a first-column pill that isn't its own.
  const statusIds = ganttFilterVisibleIds(state.active, loadCalendarStatusFilter(), boardStatuses());
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const cards = visibleIds ? state.active.filter((c) => visibleIds.has(c.id)) : state.active;
  // The Archive pill's OWN boolean (=== true, not !== false) decides
  // whether archived cards join the grid at all — its default is OFF, so a
  // missing/stale/false value must never render archived chips. Archived
  // cards aren't governed by the live status pills (same as the gantt's
  // Archive group), only by search + this one pill.
  const archiveOn = loadCalendarStatusFilter().archive === true;
  const allCards = archiveOn
    ? cards.concat(searchIds ? state.archived.filter((c) => searchIds.has(c.id)) : state.archived)
    : cards;

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  const dowRow = document.createElement('div');
  dowRow.className = 'cal-dow-row';
  for (const dow of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    const h = document.createElement('div');
    h.className = 'cal-dow';
    h.textContent = dow;
    dowRow.appendChild(h);
  }
  grid.appendChild(dowRow);

  const today = localTodayStr();
  const shaded = iterationDayShader();
  const cells = monthGrid(year, monthIndex);
  // monthChipLayout packs runs PER WEEK ROW (a week is the most a single DOM
  // element can span — a run crossing into the next week is a squared-off
  // continuation piece there, not the same element); the day cells below
  // stay a flat per-day loop, they only ever needed their own date.
  const weekRows = monthChipLayout(allCards, cells.map((c) => c.date));

  weekRows.forEach((week, w) => {
    const weekEl = document.createElement('div');
    weekEl.className = 'cal-week';
    // Overflow is capped PER WEEK now, not per day (see
    // CALENDAR_MAX_CHIP_ROWS_PER_WEEK) — a card visible in one week can fold
    // into that week's own "+N more" while still showing plainly the next.
    const visibleRows = Math.min(week.rows, CALENDAR_MAX_CHIP_ROWS_PER_WEEK);
    const overflow = week.entries.filter((e) => e.row >= CALENDAR_MAX_CHIP_ROWS_PER_WEEK);
    // Row 1 is the day-number line every day cell already carries; chip rows
    // start at row 2, so the whole week's own grid-template-rows count is
    // the chip rows plus one more if this week overflows. Floored at 1: a
    // week with nothing scheduled would otherwise emit repeat(0, ...), which
    // is invalid CSS and silently drops the whole track template.
    weekEl.style.setProperty('--cal-week-rows', Math.max(1, visibleRows + (overflow.length ? 1 : 0)));

    cells.slice(w * 7, w * 7 + 7).forEach((cell, i) => {
      const dayEl = document.createElement('div');
      dayEl.className = 'cal-day' + (cell.inMonth ? '' : ' outside') + (cell.date === today ? ' today' : '') + (shaded(cell.date) ? ' in-iteration' : '');
      dayEl.dataset.day = cell.date;
      const num = document.createElement('div');
      num.className = 'cal-day-num';
      num.textContent = cell.day;
      dayEl.appendChild(num);
      // Background cell spans the week's FULL height (every chip row) so it
      // still reads as one bordered day box; chips lay over it as siblings,
      // same overlay-over-a-spanning-background shape as the all-day band's
      // .cal-tg-allday-cell — and, same reason as there, must stay UNDER the
      // chips in drop hit-testing, which the existing drag-live
      // pointer-events:none rule on every .cal-chip already covers (it isn't
      // scoped to the band).
      dayEl.style.gridColumn = `${i + 1}`;
      dayEl.style.gridRow = '1 / -1';
      weekEl.appendChild(dayEl);
    });

    for (const entry of week.entries) {
      if (entry.row >= CALENDAR_MAX_CHIP_ROWS_PER_WEEK) continue; // folds into the "+N more" line below
      // Time-of-day only labels the piece that actually holds the run's true
      // end day (clipEnd false) — a continuation piece showing the end time
      // it doesn't own would misread, same "only the moment itself" rule
      // chipPositionForDay used to enforce per day.
      const chip = calendarChipEl(entry.card, 'single', entry.clipEnd ? '' : entry.time, entry.due);
      chip.classList.add('cal-month-chip');
      // Cut by a week boundary or by the grid's own edge — either way,
      // square + dash the cut side, same continuation cue as the band's
      // clip-start/clip-end (monthChipLayout sets both from the same test).
      if (entry.clipStart) chip.classList.add('clip-start');
      if (entry.clipEnd) chip.classList.add('clip-end');
      chip.style.gridColumn = `${entry.startIdx + 1} / ${entry.endIdx + 2}`;
      chip.style.gridRow = `${entry.row + 2}`;
      weekEl.appendChild(chip);
    }
    if (overflow.length) {
      // Overflow is deliberately cheap: a
      // tooltip-titled line listing the hidden cards — hover reads them, and
      // every card stays reachable via search or the board view.
      const more = document.createElement('div');
      more.className = 'cal-more';
      more.textContent = `+${overflow.length} more`;
      // same fallback as every other title-bearing surface.
      more.title = overflow.map((c) => `#${c.card.id} ${cardTitleDisplay(c.card).text}`).join('\n');
      more.style.gridColumn = '1 / 8';
      more.style.gridRow = `${visibleRows + 2}`;
      weekEl.appendChild(more);
    }
    grid.appendChild(weekEl);
  });
  container.appendChild(grid);
}

// --- The sub-month time grid (week / 3 days / day) --------------------
// One column per day, an "all day" band on top, hour rows below. All the
// classification/packing math is calendar-model.js's timeGridLayout; this
// builds DOM from its output. Chips reuse calendarChipEl, so the shared
// card-el grammar (click/ctrl- or shift-click/right-click) and the month view's chip
// styling apply unchanged. The all-day band + month grid drag BETWEEN day
// columns via native HTML5 drag (onCalendarDrop: date moves, time preserved).
// The timed
// hour-grid blocks retime + edge-resize at minute granularity via a custom
// pointer-drag (wireCalendarTimeDrag) — so they're draggable:false here.

// Pixel height of one hour row. Must match app.css's .cal-tg-col background
// gradient (40px stripes) — the JS positions blocks, the CSS draws the lines.
const CAL_HOUR_PX = 40;
const CAL_DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // getUTCDay order

function renderCalendarTimeGrid(container, subview, keepScroll) {
  const days = calendarSubviewDays(subview, currentCalendarAnchor());
  // Same live search + status-filter composition as the month grid above —
  // filtered-out statuses must drop their chips from the all-day
  // band AND the timed hour grid alike, not just the month view. Same
  // live+archived search pool and Archive-pill composition as the month
  // grid too, so the toggle applies to both grids alike.
  const searchIds = withIterationCut(currentSearchMatch().ids);
  const statusIds = ganttFilterVisibleIds(state.active, loadCalendarStatusFilter(), boardStatuses());
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const cards = visibleIds ? state.active.filter((c) => visibleIds.has(c.id)) : state.active;
  const archiveOn = loadCalendarStatusFilter().archive === true;
  const allCards = archiveOn
    ? cards.concat(searchIds ? state.archived.filter((c) => searchIds.has(c.id)) : state.archived)
    : cards;
  const layout = timeGridLayout(allCards, days);
  const today = localTodayStr();
  const shaded = iterationDayShader();

  const grid = document.createElement('div');
  grid.className = 'cal-timegrid';
  grid.style.setProperty('--cal-day-cols', days.length);
  const stripCss = noteStripCss(calendarNotesStrip());
  if (stripCss !== null) grid.style.setProperty('--cal-note-width', stripCss);

  // Header row: weekday + day-of-month per column, today highlighted like the
  // month grid's cell.
  const head = document.createElement('div');
  head.className = 'cal-tg-head';
  head.appendChild(document.createElement('div')); // spacer over the hour gutter
  for (const day of days) {
    const h = document.createElement('div');
    h.className = 'cal-tg-dayhead' + (day === today ? ' today' : '') + (shaded(day) ? ' in-iteration' : '');
    const dt = new Date(dayToUtc(day));
    h.textContent = `${CAL_DOW_SHORT[dt.getUTCDay()]} ${dt.getUTCDate()}`;
    head.appendChild(h);
  }
  grid.appendChild(head);

  // All-day band: date-only cards + multi-day ranges. Background day cells
  // (spanning every packed row) are the drop targets; chips lay over them via
  // explicit grid placement — a span occupies its real columns.
  const band = document.createElement('div');
  band.className = 'cal-tg-allday';
  const bandLabel = document.createElement('div');
  bandLabel.className = 'cal-tg-gutterlabel';
  bandLabel.textContent = 'all day';
  band.appendChild(bandLabel);
  const bandGrid = document.createElement('div');
  bandGrid.className = 'cal-tg-allday-grid';
  const notesByDay = new Map(days.map((day) => [day, calendarNotesOn() ? noteCalendarDay(notesAll(), day) : null]));
  const untimedRow = layout.allDayRows + 1; // a day with untimed notes gets one more row in the band, under the cards
  const bandRows = Math.max(1, layout.allDayRows + ([...notesByDay.values()].some((d) => d && d.untimed.length) ? 1 : 0)); // at least one row of drop surface, even empty
  days.forEach((day, i) => {
    const cell = document.createElement('div');
    cell.className = 'cal-tg-allday-cell cal-drop' + (day === today ? ' today' : '') + (shaded(day) ? ' in-iteration' : '');
    cell.dataset.day = day;
    cell.style.gridColumn = `${i + 1}`;
    cell.style.gridRow = `1 / ${bandRows + 1}`;
    bandGrid.appendChild(cell);
  });
  for (const entry of layout.allDay) {
    const chip = calendarChipEl(entry.card, 'single', '', entry.due);
    chip.classList.add('cal-allday-chip');
    // A span cut by the window edge squares off + dashes on the cut side,
    // same continuation cue as the gantt's clipped bars.
    if (entry.clipStart) chip.classList.add('clip-start');
    if (entry.clipEnd) chip.classList.add('clip-end');
    chip.style.gridColumn = `${entry.startIdx + 1} / ${entry.endIdx + 2}`;
    chip.style.gridRow = `${entry.row + 1}`;
    bandGrid.appendChild(chip);
  }
  days.forEach((day, i) => {
    const dayNotes = notesByDay.get(day);
    if (!dayNotes || !dayNotes.untimed.length) return;
    const box = notesCalendarUntimed(day, dayNotes.untimed);
    box.style.gridColumn = `${i + 1}`;
    box.style.gridRow = `${untimedRow}`;
    bandGrid.appendChild(box);
  });
  band.appendChild(bandGrid);
  grid.appendChild(band);

  // The hour grid, in its own scroll container so the header + band stay put
  // (Outlook-style). 24 rows of CAL_HOUR_PX; blocks absolutely positioned by
  // minutes, side-by-side within their overlap cluster via lane/lanes.
  const scroll = document.createElement('div');
  scroll.className = 'cal-tg-scroll';
  const body = document.createElement('div');
  body.className = 'cal-tg-body';
  const gutter = document.createElement('div');
  gutter.className = 'cal-tg-gutter';
  gutter.style.height = `${24 * CAL_HOUR_PX}px`;
  for (let h = 0; h < 24; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'cal-tg-hour';
    lbl.style.top = `${h * CAL_HOUR_PX}px`;
    lbl.textContent = `${String(h).padStart(2, '0')}:00`;
    gutter.appendChild(lbl);
  }
  body.appendChild(gutter);
  for (const day of days) {
    const col = document.createElement('div');
    col.className = 'cal-tg-col cal-drop' + (day === today ? ' today' : '') + (shaded(day) ? ' in-iteration' : '');
    col.dataset.day = day;
    col.style.height = `${24 * CAL_HOUR_PX}px`;
    const dayNotes = notesByDay.get(day);
    const strip = dayNotes && dayNotes.slots.length; // a day with timed notes keeps a strip right of the card blocks for them
    if (strip) col.classList.add('has-notes');
    for (const block of layout.timed[day]) {
      const el = calendarChipEl(block.card, 'single', block.time, block.due);
      el.classList.add('cal-timeblock');
      if (block.point) el.classList.add('point'); // default-height marker, not a real duration
      // Timed blocks use a custom pointer-drag (wireCalendarTimeDrag)
      // for minute-granular retime/resize — native HTML5 drag can't give the
      // continuous pixel deltas that needs. draggable:false overrides
      // calendarChipEl's default so the two drag systems never both fire; the
      // all-day band + month chips keep native day-drag (they're day-granular).
      el.draggable = false;
      el.style.top = `${(block.startMin / 60) * CAL_HOUR_PX}px`;
      el.style.height = `${Math.max(18, ((block.endMin - block.startMin) / 60) * CAL_HOUR_PX - 2)}px`;
      el.style.left = strip ? `calc(${block.lane} * (100% - var(--cal-note-strip)) / ${block.lanes})` : `calc(${block.lane} * 100% / ${block.lanes})`;
      el.style.width = strip ? `calc((100% - var(--cal-note-strip)) / ${block.lanes} - 4px)` : `calc(100% / ${block.lanes} - 4px)`;
      // Only a REAL same-day duration (not a point/due placeholder,
      // whose height is a synthetic 60-min marker) gets resize handles — the
      // point/due block's own `point`/`due` flags answer "resizable?" with no
      // separate classifier. An archived block is read-only (guarded at
      // pointerdown), so it gets no handles either.
      if (!block.point && !block.due && !block.card.archived) {
        const top = document.createElement('span');
        top.className = 'cal-resize-handle top';
        const bottom = document.createElement('span');
        bottom.className = 'cal-resize-handle bottom';
        el.append(top, bottom);
      }
      col.appendChild(el);
    }
    if (strip) {
      col.appendChild(notesCalendarDivider(day));
      for (const slot of dayNotes.slots) col.appendChild(notesCalendarSlot(day, slot, (slot.fromMin / 60) * CAL_HOUR_PX + 1));
    }
    body.appendChild(col);
  }
  scroll.appendChild(body);
  grid.appendChild(scroll);
  container.appendChild(grid);
  paintCalendarNotesAria();
  // First paint opens at 08:00 (the working morning, Outlook's default);
  // re-renders — poll ticks included — keep the user's scroll.
  scroll.scrollTop = keepScroll != null ? keepScroll : 8 * CAL_HOUR_PX;
}

// Same per-render wiring discipline as the board's wireDrag(): #calendar-view
// is rebuilt from scratch by every renderCalendarView() call, so drag
// listeners attach fresh each time. isDragging / pendingDrops reuse the
// board's poll guards, so the 5s auto-refresh never re-renders mid-gesture or
// mid-PATCH here either.
// Whether the chip picked up was the DUE marker — captured at
// dragstart (same module-var discipline as bulkDragIds: the drop reads the
// flag, dragend clears it so a cancelled drag can't leak into the next one).
let calDragDue = false;

function wireCalendarDrag() {
  const container = $('#calendar-view');
  // Exclude timed blocks — they're draggable:false and handled
  // by the minute-granular pointer-drag (wireCalendarTimeDrag). The all-day
  // band + month chips keep native day-drag through this function.
  container.querySelectorAll('.cal-chip:not(.cal-timeblock)').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.classList.add('dragging');
      isDragging = true;
      calDragDue = el.dataset.due === '1';
      // While a drag is live, every chip yields hit-testing
      // (pointer-events:none via this class, see app.css). Every calendar
      // chip — the sub-month all-day band's AND the month grid's — is a
      // grid-overlay SIBLING of its drop-target cell (.cal-tg-allday-cell /
      // .cal-day), not a child: a drag released over one would never bubble
      // to any cell, preventDefault would never fire and the browser would
      // refuse the drop. Falling through to the cell underneath gives the
      // month view's drop-anywhere-in-the-day semantics in week/3-day/day too.
      container.classList.add('cal-dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      isDragging = false;
      calDragDue = false;
      container.classList.remove('cal-dragging');
    });
  });
  // The sub-month views' drop targets (time columns + all-day band
  // cells) carry .cal-drop and the same data-day contract as the month cells.
  container.querySelectorAll('.cal-day, .cal-drop').forEach((cell) => {
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drag-over'); });
    cell.addEventListener('dragleave', (e) => { if (!cell.contains(e.relatedTarget)) cell.classList.remove('drag-over'); });
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drag-over');
      // Clear the drag flag HERE too, not just at dragend: the drop's
      // loadBoard() re-render removes the source chip, and a removed node may
      // never get its dragend — a stuck cal-dragging would leave every chip
      // click-dead (pointer-events:none) until the next drag.
      container.classList.remove('cal-dragging');
      const id = e.dataTransfer.getData('text/plain');
      onCalendarDrop(id, cell.dataset.day, calDragDue);
    });
  });
}

// Drop = reschedule: dragging a RANGE
// chip moves the working range — the drop day becomes the range END day
// (time-of-day preserved) and the start shifts by the same delta so duration
// is preserved, writing the fields the range actually used (a compat range
// shifts start+due, never inventing an end_date); dragging the DUE chip moves
// due_date alone. The math is calendar-model.js's rescheduleChanges /
// rescheduleDueChanges — both return null for zero-delta drops, so a same-day
// drop never spends a PATCH (or an `updated` bump). No optimistic
// mutation on purpose: dates aren't positional like a drag between columns,
// so the loadBoard() round-trip re-render is cheap and honest; failures toast.
async function onCalendarDrop(id, day, isDue) {
  const card = state.active.find((c) => c.id === id);
  if (!card || !day) return;
  const changes = isDue ? rescheduleDueChanges(card, day) : rescheduleChanges(card, day);
  if (!changes) return; // no matching date to move, or a same-day drop — never let a stray drop 500
  pendingDrops++; // same poll guard as the board's onDrop
  try {
    await api('PATCH', `/api/cards/${id}`, changes); // `updated` bumps server-side
    await loadBoard();
  } catch (e) {
    toast('Reschedule failed: ' + e.message);
  } finally {
    pendingDrops--;
  }
}

// --- Minute-granular pointer-drag on the sub-month TIME GRID -----------
// Drag-to-retime within a day's hour grid,
// plus gantt-style edge-resize. Native HTML5 drag (wireCalendarDrag, still used
// by the all-day band + month grid) only gives discrete drop-target hits; the
// time grid needs a continuous 2-axis delta (day column × minute), so it uses
// pointer capture exactly like wireGanttPointerDrag. Timed blocks are
// draggable:false (renderCalendarTimeGrid); this owns them. Delegated ONCE on
// the stable #calendar-view (unlike wireCalendarDrag, which re-wires per render
// because it binds literal .cal-chip nodes torn down each render).
let calTimeDrag = null;

// A pointer-capture drag still fires a compatibility `click` on the block after
// pointerup — same phantom-click problem the gantt solves. This is its
// calendar-scoped twin (suppressGanttPhantomClick is hardcoded to #gantt-view):
// a one-shot capturing-phase document click swallower, armed only by a MOVED
// drag's pointerup and consumed by the very next click (self-disarms on a
// 0-timeout if none follows).
let calTimeClickSuppressed = false;
function suppressCalTimeClick() {
  calTimeClickSuppressed = true;
  setTimeout(() => { calTimeClickSuppressed = false; }, 0);
}

const CAL_PX_PER_MIN = CAL_HOUR_PX / 60;
const calTimeSnap = (min) => Math.round(min / CALENDAR_DRAG_SNAP_MIN) * CALENDAR_DRAG_SNAP_MIN;

// The day column under the pointer's x (clamped to the first/last column) and
// the raw (un-snapped) minute from its y. Rects are read FRESH every call — the
// grid scrolls vertically mid-gesture, so a rect cached at pointerdown would
// desync the y→minute math. Returns null when no time grid is mounted.
function calTimePointer(e) {
  const cols = Array.from($('#calendar-view').querySelectorAll('.cal-tg-col'));
  if (!cols.length) return null;
  let col = cols[0];
  for (const c of cols) { // rightmost column whose left edge is <= x (clamps past the last)
    if (e.clientX >= c.getBoundingClientRect().left) col = c; else break;
  }
  const r = col.getBoundingClientRect();
  return { day: col.dataset.day, col, rawMin: (e.clientY - r.top) / CAL_PX_PER_MIN };
}

function calTimeApplyPreview(drag) {
  const el = drag.blockEl;
  if (drag.mode === 'shift' || drag.mode === 'due') {
    // 2-axis translate: horizontal = target column's left minus the base
    // column's (equal-width cols, so this overlays the target slot), vertical =
    // the minute delta. Cosmetic only — onCalTimeDragEnd's PATCH is authoritative.
    const baseCol = el.closest('.cal-tg-col');
    const dxPx = drag.targetCol && baseCol ? drag.targetCol.getBoundingClientRect().left - baseCol.getBoundingClientRect().left : 0;
    const dyPx = (drag.targetMin - drag.baseStartMin) * CAL_PX_PER_MIN;
    el.style.transform = `translate(${dxPx}px, ${dyPx}px)`;
    return;
  }
  // resize: mutate top/height directly (mirrors the gantt's left/width split).
  if (drag.mode === 'resize-start') {
    const start = Math.max(0, Math.min(drag.targetMin, drag.baseEndMin - CALENDAR_DRAG_SNAP_MIN));
    el.style.top = `${start * CAL_PX_PER_MIN}px`;
    el.style.height = `${Math.max(4, (drag.baseEndMin - start) * CAL_PX_PER_MIN)}px`;
  } else { // resize-end
    const end = Math.min(1439, Math.max(drag.targetMin, drag.baseStartMin + CALENDAR_DRAG_SNAP_MIN));
    el.style.height = `${Math.max(4, (end - drag.baseStartMin) * CAL_PX_PER_MIN)}px`;
  }
}

async function onCalTimeDragEnd(drag) {
  const card = state.active.find((c) => c.id === drag.id);
  if (!card) return; // vanished mid-gesture (deleted elsewhere) — the next poll redraws
  const changes =
    drag.mode === 'due' ? rescheduleDueAtTime(card, drag.targetDay, drag.targetMin) :
    drag.mode === 'shift' ? rescheduleRangeAtTime(card, drag.targetDay, drag.targetMin) :
    resizeRangeAtTime(card, drag.mode === 'resize-start' ? 'start' : 'end', drag.targetMin);
  if (!changes) return; // zero-delta or not-applicable — finish() already restored the geometry
  pendingDrops++; // same poll guard as onCalendarDrop / the gantt
  try {
    await api('PATCH', `/api/cards/${drag.id}`, changes); // `updated` bumps server-side
    await loadBoard();
  } catch (e) {
    renderCalendarView(); // snap back to disk truth
    toast('Reschedule failed: ' + e.message);
  } finally {
    pendingDrops--;
  }
}

function wireCalendarTimeDrag() {
  const container = $('#calendar-view');
  // Phantom-click swallower (capturing phase at document, scoped to
  // #calendar-view targets), same shape as the gantt's.
  document.addEventListener('click', (e) => {
    if (!calTimeClickSuppressed) return;
    calTimeClickSuppressed = false;
    if (!e.target.closest || !e.target.closest('#calendar-view')) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || calTimeDrag) return;
    const blockEl = e.target.closest('.cal-timeblock');
    if (!blockEl) return;
    const handleEl = e.target.closest('.cal-resize-handle');
    const mode = handleEl
      ? (handleEl.classList.contains('top') ? 'resize-start' : 'resize-end')
      : (blockEl.dataset.due === '1' ? 'due' : 'shift');
    const id = blockEl.dataset.id;
    // Archived guard, BEFORE any capture/state (same as the gantt): an archived
    // card only lives in state.archived, so this find returns undefined.
    const card = state.active.find((c) => c.id === id);
    if (!card) { toast('Archived cards are read-only — restore the card to reschedule it.'); return; }
    const baseStartMin = (parseFloat(blockEl.style.top) || 0) / CAL_PX_PER_MIN;
    const drag = {
      id, mode, blockEl, pointerId: e.pointerId,
      originX: e.clientX, originY: e.clientY, moved: false,
      baseStartMin,
      baseDay: (blockEl.closest('.cal-tg-col') || {}).dataset ? blockEl.closest('.cal-tg-col').dataset.day : null,
      targetDay: null, targetMin: baseStartMin, targetCol: null,
    };
    if (mode === 'shift' || mode === 'due') {
      const p = calTimePointer(e); // grab-offset so the block doesn't jump to the cursor
      drag.grabOffsetMin = p ? baseStartMin - p.rawMin : 0;
      drag.targetDay = drag.baseDay;
    } else { // resize: derive the block's true start/end minutes from the card, not the DOM height
      const rf = rangeFields(card);
      drag.baseStartMin = timeToMinutes(timePart(card[rf.startField]));
      drag.baseEndMin = timeToMinutes(timePart(card[rf.endField]));
      drag.baseTop = parseFloat(blockEl.style.top) || 0;
      drag.baseHeight = parseFloat(blockEl.style.height) || 0;
      drag.targetMin = drag.mode === 'resize-start' ? drag.baseStartMin : drag.baseEndMin;
    }
    calTimeDrag = drag;
    blockEl.setPointerCapture(e.pointerId);
    blockEl.classList.add('dragging');
    isDragging = true; // poll guard for the whole gesture, cleared in finish()
    e.preventDefault();
  });

  container.addEventListener('pointermove', (e) => {
    if (!calTimeDrag || e.pointerId !== calTimeDrag.pointerId) return;
    const drag = calTimeDrag;
    const dx = e.clientX - drag.originX, dy = e.clientY - drag.originY;
    // resize is vertical-only, so x-jitter must not register as movement.
    if (drag.mode === 'resize-start' || drag.mode === 'resize-end') { if (Math.abs(dy) > 3) drag.moved = true; }
    else if (Math.hypot(dx, dy) > 3) drag.moved = true;
    const p = calTimePointer(e);
    if (!p) return;
    if (drag.mode === 'shift' || drag.mode === 'due') {
      drag.targetDay = p.day;
      drag.targetCol = p.col;
      drag.targetMin = calTimeSnap(p.rawMin + drag.grabOffsetMin);
    } else { // resize: day fixed, one edge tracks the pointer
      drag.targetMin = calTimeSnap(p.rawMin);
    }
    calTimeApplyPreview(drag);
  });

  // pointerup commits a MOVED drag; an unmoved press is a click (its native
  // click bubbles to the shared card-el grammar → detail popup, same as the
  // gantt). pointercancel never commits. Either way the block's inline preview
  // styles are cleared first — the authoritative move is the post-PATCH re-render.
  const finish = (commit) => {
    if (!calTimeDrag) return;
    const drag = calTimeDrag;
    calTimeDrag = null;
    isDragging = false;
    drag.blockEl.classList.remove('dragging');
    drag.blockEl.style.transform = '';
    if (drag.mode === 'resize-start' || drag.mode === 'resize-end') {
      drag.blockEl.style.top = `${drag.baseTop}px`;
      drag.blockEl.style.height = `${drag.baseHeight}px`;
    }
    if (!commit || !drag.moved) return;
    suppressCalTimeClick();
    onCalTimeDragEnd(drag);
  };
  container.addEventListener('pointerup', (e) => { if (calTimeDrag && e.pointerId === calTimeDrag.pointerId) finish(true); });
  container.addEventListener('pointercancel', (e) => { if (calTimeDrag && e.pointerId === calTimeDrag.pointerId) finish(false); });
}

// --- The divider on the notes strip's left edge ---------------------------------------------------
// A pointer drag sets the strip's width for every day column at once, live and without a re-render;
// the width is saved when the pointer lets go. isDragging is the same poll guard the other calendar
// drags hold, so the 5s refresh never redraws mid-drag. The arrow keys step it, a double click puts
// the default back. Nothing here starts a card drag (the pointerdown handler above reads only a
// .cal-timeblock), and the click and double click handlers below skip a target on the divider.
let calNotesDrag = null;

function onCalNotesDividerDown(e) {
  const divider = e.target.closest && e.target.closest('.cal-note-divider');
  if (!divider || e.button !== 0 || calNotesDrag) return;
  calNotesDrag = { pointerId: e.pointerId, divider, col: divider.closest('.cal-tg-col'), was: calendarNotesStrip(), px: null };
  divider.setPointerCapture(e.pointerId);
  divider.classList.add('dragging');
  isDragging = true;
  e.preventDefault();
}

function onCalNotesDividerMove(e) {
  if (!calNotesDrag || e.pointerId !== calNotesDrag.pointerId) return;
  const r = calNotesDrag.col.getBoundingClientRect();
  calNotesDrag.px = noteStripFromPointer(r.right, e.clientX, r.width);
  paintCalendarNotesStrip(calNotesDrag.px);
}

function endCalNotesDrag(e, keep) {
  if (!calNotesDrag || e.pointerId !== calNotesDrag.pointerId) return;
  const drag = calNotesDrag;
  calNotesDrag = null;
  isDragging = false;
  drag.divider.classList.remove('dragging');
  if (keep && drag.px !== null) setCalendarNotesStrip(drag.px);
  else paintCalendarNotesStrip(drag.was);
}

function onCalNotesDividerUp(e) {
  endCalNotesDrag(e, true);
}

function onCalNotesDividerCancel(e) {
  endCalNotesDrag(e, false);
}

// Left widens the strip and Right narrows it, a step from where it is drawn now.
function onCalNotesDividerKey(e) {
  const divider = e.target.closest && e.target.closest('.cal-note-divider');
  if (!divider || e.altKey || e.ctrlKey || e.metaKey) return;
  const r = divider.closest('.cal-tg-col').getBoundingClientRect();
  const d = divider.getBoundingClientRect();
  const px = noteStripStep(r.right - (d.left + d.width / 2), e.key, r.width);
  if (px === null) return;
  e.preventDefault();
  setCalendarNotesStrip(px);
}

function onCalNotesDividerDblClick(e) {
  if (!e.target.closest || !e.target.closest('.cal-note-divider')) return;
  e.preventDefault();
  setCalendarNotesStrip(null);
}

// The empty space a double click creates a card on: a day of the month grid, a cell
// of the all-day band, and a day column of the time grid. The click-away rule reads
// the same two lists, so the double click that opens the create modal never also
// clears the selection (DOUBLE_CLICK_OWNED).
const CALENDAR_CREATE_DAY_CELLS = '.cal-day, .cal-tg-allday-cell';
const CALENDAR_CREATE_COLUMNS = '.cal-tg-col';

// A single click on an empty hour opens the notes palette once the double click that would make
// a card there can no longer follow it.
const CAL_DOUBLE_CLICK_MS = 300;
let calHourClickTimer = 0;

// --- Calendar view wiring: header toggle + the
// prev/today/next nav. #calendar-view is rebuilt by every renderCalendarView()
// call, so clicks delegate to the stable parent — same pattern (and reason)
// as #map-view's delegated listener above. Chip clicks (detail/selection/
// context menu) are the shared card-el grammar's job now — nothing
// chip-specific left here. A double click on an empty day cell makes a card
// (CALENDAR_CREATE_DAY_CELLS), so the click-away rule (onClickAway) leaves the
// selection there; a single click on one clears nothing.
window.addEventListener('DOMContentLoaded', () => {
  $('#calendar-toggle-btn').addEventListener('click', () => toggleView('calendar'));
  wireCalendarTimeDrag(); // delegated once on the stable #calendar-view
  const calView = $('#calendar-view');
  calView.addEventListener('mouseover', (e) => {
    const day = e.target && e.target.closest ? e.target.closest('.cal-day, .cal-tg-allday-cell, .cal-tg-col') : null;
    calendarHoverDay = day && day.dataset.day ? day.dataset.day : null;
  });
  calView.addEventListener('mouseleave', () => { calendarHoverDay = null; });
  calView.addEventListener('pointerdown', onCalNotesDividerDown);
  calView.addEventListener('pointermove', onCalNotesDividerMove);
  calView.addEventListener('pointerup', onCalNotesDividerUp);
  calView.addEventListener('pointercancel', onCalNotesDividerCancel);
  calView.addEventListener('keydown', onCalNotesDividerKey);
  calView.addEventListener('dblclick', onCalNotesDividerDblClick);
  $('#calendar-view').addEventListener('click', (e) => {
    // The sub-view switcher rides the same delegated listener as
    // prev/today/next — all four button sets are rebuilt every render.
    const sv = e.target.closest('.cal-subview-btn');
    if (sv) { setCalendarSubview(sv.dataset.subview); return; }
    if (e.target.closest('.cal-span-cycle')) { setCalendarSubview(nextSubview(CALENDAR_SUBVIEWS, loadCalendarSubview())); return; }
    if (e.target.closest('#cal-prev-btn')) { shiftCalendarWindow(-1); return; }
    if (e.target.closest('#cal-next-btn')) { shiftCalendarWindow(1); return; }
    if (e.target.closest('#cal-today-btn')) { calendarAnchor = null; renderCalendarView(); return; }
    if (e.target.closest('#cal-notes-btn')) { setCalendarNotes(!calendarNotesOn()); return; }
    // A click on an empty part of a day's column opens the palette on that hour. A double click
    // there makes a card, so the palette waits out the double click's window.
    const col = e.target.closest(CALENDAR_CREATE_COLUMNS);
    if (!col || e.target.closest('.card-el, .cal-note, .cal-note-divider') || isDragging || ganttDrag || calTimeDrag || !calendarNotesOn()) return;
    const r = col.getBoundingClientRect();
    const req = noteHourRequest(col.dataset.day, (e.clientY - r.top) / CAL_PX_PER_MIN);
    clearTimeout(calHourClickTimer);
    calHourClickTimer = setTimeout(() => { if (calendarNotesOn()) openNotes(req); }, CAL_DOUBLE_CLICK_MS);
  });
  // Click-to-create rides double-click on the empty cells, the one empty space
  // where a double click already means something, so the click-away rule leaves
  // the selection there (DOUBLE_CLICK_OWNED). A click landing on a chip never
  // reaches here — see the .card-el guard below — so it can never fight the
  // shared grammar.
  // Month/all-day cells only carry a day; time-grid columns also carry the
  // pointer's y, converted to a snapped minute the same way the retime drag
  // math does (CAL_PX_PER_MIN). Status is left at the modal's own default —
  // unlike the column "+", a calendar cell doesn't imply a status.
  $('#calendar-view').addEventListener('dblclick', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // same guard as the contextmenu listener below: never fire out from under a live drag
    clearTimeout(calHourClickTimer); // the click that began this double click wanted the palette; the double click wants a card
    if (e.target.closest('.card-el')) return; // a chip's dblclick is its own affair, not a create gesture
    if (e.target.closest('.cal-note, .cal-note-divider')) return; // so is a note's, and the notes divider's
    const dayCell = e.target.closest(CALENDAR_CREATE_DAY_CELLS);
    if (dayCell) { openModal(null, null, calendarCreateStart(dayCell.dataset.day)); return; }
    const col = e.target.closest(CALENDAR_CREATE_COLUMNS);
    if (col) {
      const r = col.getBoundingClientRect();
      openModal(null, null, calendarCreateStart(col.dataset.day, (e.clientY - r.top) / CAL_PX_PER_MIN));
    }
  });
});

// prev/next step by the ACTIVE sub-view's span (month / 7 / 3 / 1
// days) — shiftAnchorDay owns the math, one anchor cursor drives all four.
function shiftCalendarWindow(delta) {
  calendarAnchor = shiftAnchorDay(loadCalendarSubview(), currentCalendarAnchor(), delta);
  renderCalendarView();
}

// --- Gantt view -------------------------------
// Dated LIVE cards on a day-granular timeline, rows grouped by status: the
// working range (start→end, or the compat pair start→due) renders as a
// bar, the due date as an independent draggable diamond on the same row —
// a due-only card shows only its diamond.
// All window/row/drag math lives in gantt-model.js (pure, unit-tested,
// dual-environment); everything below is presentation and API glue. The
// sub-view choice (All/Month/Week/3 days/Day) decides where
// the window comes from: 'all' (the DEFAULT) keeps deriving it from the
// rendered cards every render — no month cursor to preserve, exactly as
// before this ticket; a sized sub-view instead pages an anchor day
// (ganttSubviewWindow, gantt-model.js), same anchor-cursor shape as the
// calendar's own. The view mode itself persists via the shared 'view.mode'
// mechanism. No dependency arrows on purpose — the map view owns the
// waiting_for graph; here a waiting card just keeps the board's amber
// left-accent cue. Header controls (prev/today/next + the sub-view switch)
// reuse the calendar's own .cal-nav class, and wear data-keeps-selection and
// data-holds-poll as the calendar's do: the poll guard (boardControlFocused) and
// the click-away rule (onClickAway) read those markers, not the class, so a
// control built here must wear them.

// The sub-view choice — own feature key ('gantt.subview'), same
// memoize-once-mutate-in-place + defensive-merge discipline as
// calendarSubview above (mergeGanttSubview falls back to 'all', the
// fit-everything default, on anything unknown/missing/corrupt).
let ganttSubview = null;

function loadGanttSubview() {
  if (ganttSubview) return ganttSubview;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'gantt.subview')); }
  catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to 'all'
  ganttSubview = mergeGanttSubview(saved);
  return ganttSubview;
}

function saveGanttSubview() {
  try { localStorage.setItem(storageKey(state.projectName, 'gantt.subview'), ganttSubview); }
  catch (e) { /* storage unavailable/full — sub-view choice just won't persist this session */ }
}

function setGanttSubview(subview) {
  if (!GANTT_SUBVIEWS.includes(subview) || subview === loadGanttSubview()) return;
  ganttSubview = subview;
  saveGanttSubview();
  renderGanttView();
}

// The anchor day a SIZED sub-view pages around — same none-reads-as-today,
// survives-the-poll discipline as calendarAnchor (nothing in the render path
// resets it; only the prev/next/Today controls below write it). Unused
// while the sub-view is 'all'.
let ganttAnchor = null;

function currentGanttAnchor() {
  return ganttAnchor || localTodayStr(); // none until a control moves it, so the window follows the clock across midnight
}

// prev/next step by the ACTIVE sub-view's span. shiftAnchorDay is the
// calendar's own (calendar-model.js) reused verbatim — its month/week/3day/
// day math is anchor-day + span only, nothing calendar-specific. A no-op on
// 'all': there's no anchor day to page from (the nav buttons are disabled
// there too — see buildGanttControls — this guard is just defense in depth).
function shiftGanttWindow(delta) {
  if (loadGanttSubview() === 'all') return;
  ganttAnchor = shiftAnchorDay(loadGanttSubview(), currentGanttAnchor(), delta);
  renderGanttView();
}

// --- Jump to the nearest match -------------------------------------------------
// When a change to the search box leaves no shown match inside the visible
// range of the Calendar or the Gantt, the view moves to the match nearest it:
// nearestMatchDay (calendar-model.js) decides for both, the Gantt reaching it
// through ganttNearestMatchDay, whose all sub-view never jumps. Two triggers
// and no others. A write to the box: a listener of writeSearch, registered
// below without touching the writer, so Isolate and any later writer get the
// jump for free. Entering the view: toggleView makes the check once. The 5s
// poll, a plain re-render, paging with previous and next, Today and a sub-view
// switch never make it, which is why the poll keeps a paged month and paging
// after a jump works as usual. An empty box has no matches, so clearing it
// moves nothing. Both triggers run right after a renderBoard, so the check
// reads the match that repaint made (lastSearchMatch) and the box is matched
// once per write; a write that repaints nothing (writeSearch's repaint false)
// clears it, and the check matches the box itself. A view that moved repaints on its own.
// The jump looks for what the whole query matches, though with isolate off the box hides
// nothing there (only the cards it matches are lit).
function matchedOnly(match) {
  return { ...match, ids: match.matched };
}

function jumpCalendarToMatch() {
  const input = calendarViewInput(matchedOnly(lastSearchMatch || currentSearchMatch()));
  const day = nearestMatchDay(input, calendarVisibleRange(loadCalendarSubview(), currentCalendarAnchor()));
  if (!day) return false;
  calendarAnchor = day;
  return true;
}

function jumpGanttToMatch() {
  const input = ganttViewInput(matchedOnly(lastSearchMatch || currentSearchMatch()));
  const day = ganttNearestMatchDay(input, loadGanttSubview(), currentGanttAnchor());
  if (!day) return false;
  ganttAnchor = day;
  return true;
}

// Moves the day the view in sight is paged to, if it is the Calendar or the Gantt, to the
// nearest match, and repaints that view when it moved.
function moveViewToNearestMatch() {
  const mode = loadViewMode();
  if (mode === 'calendar' && jumpCalendarToMatch()) renderCalendarView();
  else if (mode === 'gantt' && jumpGanttToMatch()) renderGanttView();
}

// A click on a card moves the box, never the page the view is on.
onSearchWrite((text, reason) => { if (!writeSkipsJump(reason)) moveViewToNearestMatch(); });

const GANTT_SUBVIEW_LABELS = { all: 'All', month: 'Month', week: 'Week', '3day': '3 days', day: 'Day' };

// The controls row: same markup shape and CSS classes as the calendar's own
// .cal-controls (prev/today/next + title + the sub-view switch) — "built the
// same way and with the same look as the calendar's" per the ticket.
// prev/today/next are DISABLED on 'all': there's no anchor day to page
// from until a sized sub-view is chosen (title explains why, rather than
// the buttons silently doing nothing).
function buildGanttControls() {
  const subview = loadGanttSubview();
  const isAll = subview === 'all';
  const spanNoun = { month: 'month', week: 'week', '3day': '3 days', day: 'day' }[subview] || 'span';
  const disabledAttr = isAll ? ' disabled' : '';
  const noPagingHint = 'Choose a dated span (Month/Week/3 days/Day) to page it';
  const prevTitle = isAll ? noPagingHint : `Previous ${spanNoun}`;
  const todayTitle = isAll ? noPagingHint : 'Jump back to today';
  const nextTitle = isAll ? noPagingHint : `Next ${spanNoun}`;
  const title = isAll ? 'All dated cards' : subviewTitle(subview, currentGanttAnchor());
  paintHeaderDate('gantt', title);
  const controls = document.createElement('div');
  controls.className = 'cal-controls';
  controls.innerHTML =
    `<button type="button" id="gantt-prev-btn" class="cal-nav" data-keeps-selection data-holds-poll${disabledAttr} title="${prevTitle}" aria-label="Previous ${spanNoun}">&#8249;</button>` +
    `<button type="button" id="gantt-today-btn" class="cal-nav" data-keeps-selection data-holds-poll${disabledAttr} title="${todayTitle}">Today</button>` +
    `<button type="button" id="gantt-next-btn" class="cal-nav" data-keeps-selection data-holds-poll${disabledAttr} title="${nextTitle}" aria-label="Next ${spanNoun}">&#8250;</button>` +
    `<span class="cal-title">${escapeHtml(title)}</span>` +
    `<span class="cal-subview-switch" role="group" aria-label="Gantt span">` +
    GANTT_SUBVIEWS.map((sv) =>
      `<button type="button" class="cal-subview-btn cal-nav${sv === subview ? ' active' : ''}" data-keeps-selection data-holds-poll ` +
        `data-subview="${sv}" aria-pressed="${sv === subview}">${GANTT_SUBVIEW_LABELS[sv]}</button>`).join('') +
    `</span>` +
    `<button type="button" class="cal-span-cycle cal-nav" data-keeps-selection data-holds-poll aria-label="Span: ${GANTT_SUBVIEW_LABELS[subview]}. Change to ${GANTT_SUBVIEW_LABELS[nextSubview(GANTT_SUBVIEWS, subview)]}">${GANTT_SUBVIEW_LABELS[subview]} &#8635;</button>`;
  return controls;
}

// The day-px scale the LAST render used (gantt-model.js's ganttDayPx) —
// GANTT_DAY_PX while 'all' is active, width/days for a sized sub-view (see
// renderGanttView). The drag math below (wireGanttPointerDrag,
// applyGanttDragVisual) reads this SAME variable, never GANTT_DAY_PX
// directly, so a day of pointer movement is a whole day in every sub-view —
// the "layout and drag math in one place" property GANTT_DAY_PX's own
// comment (gantt-model.js) already claims, now extended to a variable scale.
let ganttDayPxLive = GANTT_DAY_PX;

function ganttBarEl(bar, win, dayPx) {
  // The window may be clamped (~180 days), so a bar can poke past either
  // edge: draw only the visible slice, squared off + dashed on the cut side;
  // a bar entirely outside draws nothing (its gutter label still lists it).
  const clip = ganttBarClip(bar, win); // gantt-model.js — the visible slice + which edges are cut
  if (!clip) return null;
  const { clipStart, clipEnd, from, to } = clip;
  const el = document.createElement('div');
  const pb = priorityBadge(bar.card, state.priorities); // same emphasis as tiles/chips
  // An archived bar mutes to the neutral archive grey
  // regardless of its parked on-disk status — the BAR keeps this mute
  // (it's a row-level archived cue,
  // not the status-dot channel locked to "never mutes"; the
  // gutter row's own dot, built lower down in renderGanttView, colors off
  // the card's true status instead). 'archive' is also the literal key
  // ganttArchiveGroup uses for the group itself (gantt-model.js), so
  // statusColor/isBuiltinStatus already know it with no extra
  // branching beyond this swap.
  const colorStatus = bar.card.archived ? 'archive' : bar.card.status;
  el.className = `gantt-bar card-el status-${mapStatusClass(colorStatus)}` + // bars join the shared card-el grammar
    (pb.className ? ` ${pb.className}` : '') + (isWaiting(bar.card) ? ' waiting' : '') +
    (paintsSelected(bar.card.id) ? ' selected' : '') +
    (isHoverHighlighted(hoverLit, bar.card.id) ? ' hover-highlight' : '') +
    (bar.card.archived ? ' archived' : '') + // an archived bar is drag-read-only — CSS swaps the grab cursor for not-allowed
    (clipStart ? ' clip-start' : '') + (clipEnd ? ' clip-end' : '');
  el.tabIndex = 0; // reachable by Tab so the hover cue isn't pointer-only (kanban.proj#261)
  el.dataset.id = bar.card.id;
  el.dataset.archived = bar.card.archived ? '1' : ''; // read by wireGanttPointerDrag's pointerdown guard, same signal used to swap the tooltips below
  // Non-built-in statuses (custom columns, unlisted values) color
  // inline from the deterministic hash — the .status-unknown class beneath
  // only supplies the shape defaults it overrides.
  // 'archive' isn't built-in either, so an archived bar rides
  // this same inline-override path straight to the archive grey.
  if (!isBuiltinStatus(colorStatus)) {
    el.style.borderColor = statusColorVar(colorStatus);
    el.style.background = statusColorSoft(colorStatus);
  }
  el.style.left = `${diffDays(win.startDay, from) * dayPx}px`;
  el.style.width = `${(diffDays(from, to) + 1) * dayPx}px`;
  // An archived card's bar must not keep the LIVE handle tooltips
  // ("Drag to change...") — the drag silently no-ops on release
  // (onGanttDragEnd's own state.active lookup can never find an archived
  // card), so the affordance would invite a gesture that can never do anything.
  const readOnlyHint = 'Archived — restore the card to reschedule';
  const startHint = bar.card.archived ? readOnlyHint : 'Drag to change the start date';
  const endHint = bar.card.archived ? readOnlyHint : 'Drag to change the range end';
  // Same empty-title-shows-the-prompt fallback every other
  // view uses (cardTitleDisplay, card-title.js) — reused as-is, never re-derived.
  const titleDisplay = cardTitleDisplay(bar.card);
  // plain-text property — full title/prompt + true dates survive the CSS truncation/clipping
  el.title = `#${bar.card.id} ${titleDisplay.text} (${bar.startDay}${bar.endDay !== bar.startDay ? ` → ${bar.endDay}` : ''})` +
    (bar.card.archived ? ` — ${readOnlyHint}` : '');
  // A handle on a CUT side sits on the WINDOW edge, not the card's true
  // date — barResizeChanges (gantt-model.js) always resizes from the true
  // edge, so a start-handle drag on a clip-start bar would preview one date
  // (relative to the visible edge) and PATCH a different one (relative to
  // the true, off-screen edge), landing outside the window with no visible
  // change. Omitting the handle there leaves a plain pointerdown on that end
  // of the bar to fall through to 'shift' (move the whole bar) — already the
  // correct, honest behaviour for a click anywhere else on a clipped bar.
  el.innerHTML =
    (clipStart ? '' : `<span class="gantt-handle start" title="${startHint}"></span>`) +
    `<span class="gantt-bar-text${titleDisplay.isPromptFallback ? ' gantt-bar-text--prompt-fallback' : ''}"><span class="gantt-bar-id">#${bar.card.id}</span> ${escapeHtml(titleDisplay.text)}</span>` +
    (clipEnd ? '' : `<span class="gantt-handle end" title="${endHint}"></span>`);
  return el;
}

// What renderGanttView composes before it draws, as the jump needs it: the same shape as
// calendarViewInput, over the Gantt's status filter (timelineViewInput).
function ganttViewInput(match = currentSearchMatch()) {
  return timelineViewInput(loadGanttStatusFilter(), withIterationCut(match.ids));
}

function renderGanttView() {
  const container = $('#gantt-view');
  // The timeline is thousands of px wide — losing scroll on every 5s poll
  // would make horizontal position unusable. Carry it across the rebuild.
  const prevScroll = container.querySelector('.gantt-scroll');
  const keepScrollLeft = prevScroll ? prevScroll.scrollLeft : null;
  // The width a sized sub-view fills, read from the OUTGOING scroller —
  // BEFORE the wipe below, while it's still the fully-rebuilt element the
  // previous render finished with. Reading it any later (after `innerHTML =
  // ''`, before the rows regrow the body) would force the browser to lay
  // out a MUCH SHORTER document — just the controls + filter rows, no body
  // — and that both clamps page scrollY to that shorter height (it doesn't
  // recover once the rows come back) and measures a width from before the
  // page's own vertical scrollbar reappears, so a sized timeline built from
  // it overflows once that scrollbar returns. The previous render's width
  // is the right answer almost every time — a poll, a drag commit, arrows,
  // or a subview switch all keep the same row count and so the same page
  // height/scrollbar state; it only lags one render behind something that
  // changes row COUNT (a status filter, search, the Archive pill), which
  // self-corrects on the very next render.
  const prevWidth = prevScroll ? prevScroll.clientWidth : null;
  container.innerHTML = '';
  // The sub-view controls row renders first and unconditionally; the status
  // pills are in the search panel's Statuses section. Everything from here on
  // APPENDS (never innerHTML=, which would wipe the controls straight back out).
  container.appendChild(buildGanttControls());
  // Same search composition as board/map/calendar: the shared match result.
  // Status filter composes with search by INTERSECTION — a card is visible
  // only if BOTH say so — same pure helper and same rule as the map's
  // composition (never a union, never one side dropped). The search pool
  // spans live + archived
  // unconditionally (same as the map's own search pool) — harmless while the
  // Archive pill is off, since no archived bar is ever added to groups below
  // regardless of whether its id lands in searchIds.
  const searchIds = withIterationCut(currentSearchMatch().ids);
  // NOT mapFilterVisibleIds — that folds an unlisted status
  // into the FIRST column's toggle, correct for the map/board but wrong here.
  // ganttGroups (below) buckets cards by their RAW status and gives an
  // unlisted one its own separate group row, unrelated to any board column;
  // ganttFilterVisibleIds is the gantt's own rule, matching that grouping — a
  // status with no pill is never governed by one.
  const statusIds = ganttFilterVisibleIds(state.active, loadGanttStatusFilter(), boardStatuses());
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const cards = visibleIds ? state.active.filter((c) => visibleIds.has(c.id)) : state.active;
  const groups = ganttGroups(cards, boardStatuses()); // group order follows the configured column list; a filtered-out status simply has no bucket, so its group row drops entirely (no ghost semantics — the gantt has no dependency edges)
  // The Archive pill's
  // OWN boolean (=== true, not !== false) decides whether archived cards
  // render at all — its default is OFF, unlike every live status pill, so a
  // missing/stale/false value must never render archived rows. When on, ONE
  // more group is appended AFTER the live status groups just computed above —
  // same "location after live columns" placement as the board's Archive
  // column — search-filtered the same way the live groups were.
  const archiveOn = loadGanttStatusFilter().archive === true;
  if (archiveOn) {
    const archivedCards = searchIds ? state.archived.filter((c) => searchIds.has(c.id)) : state.archived;
    const archiveGroup = ganttArchiveGroup(archivedCards);
    // A LIVE card's raw on-disk status can literally be
    // 'archive' (archive is a LOCATION, never validated per-card — same
    // tolerance liveStatuses/columnForStatus extend elsewhere), so
    // ganttGroups above may have already produced its own group keyed
    // 'archive'. Pushing this group unconditionally would then create two
    // adjacent rows sharing that exact label/color — appendArchiveGroup
    // (gantt-model.js) merges into the existing one instead of duplicating it.
    appendArchiveGroup(groups, archiveGroup);
  }
  if (!groups.length) {
    // Distinguish "nothing is dated at all" from "the current
    // search/status filter hid everything" — the former gets the
    // guidance message, the latter matches the map's wording.
    // "Nothing at all" also checks the archive group when the
    // pill is on, so an archive-only board doesn't misreport as fully empty.
    const noneAtAll = !ganttGroups(state.active, boardStatuses()).length && !(archiveOn && ganttArchiveGroup(state.archived));
    const empty = document.createElement('div');
    empty.className = 'gantt-empty';
    empty.textContent = noneAtAll
      ? 'No dated cards — give a card a start, end, or due date to chart it here.'
      : 'No cards match the current search/status filters.';
    container.appendChild(empty);
    return;
  }
  // The window: 'all' covers each row's bar AND its due diamond (a due-only
  // row has no bar at all), hence rowWindowSpans -> ganttWindow, and
  // re-derives from the rendered cards every render (unchanged from before
  // this ticket). A SIZED sub-view instead pages a fixed-span window around
  // the anchor day (ganttSubviewWindow), independent of what's rendered —
  // same "the switcher's own window, not the data's" shape as the calendar.
  const rows = groups.flatMap((g) => g.bars);
  const subview = loadGanttSubview();
  const win = subview === 'all'
    ? ganttWindow(rowWindowSpans(rows), localTodayStr())
    : ganttSubviewWindow(subview, currentGanttAnchor());

  const gutter = document.createElement('div');
  gutter.className = 'gantt-gutter';
  const scroll = document.createElement('div');
  scroll.className = 'gantt-scroll';
  const timeline = document.createElement('div');
  timeline.className = 'gantt-timeline';
  scroll.appendChild(timeline);
  // gutter+scroll ride their OWN flex row (.gantt-body) — the controls +
  // filter rows are siblings above them: #gantt-view itself is a plain block
  // so those rows stack on top instead of joining the side-by-side flex row
  // as extra items. Appended to the live document now so the rows below can
  // just .appendChild into it; NOT relied on to measure a width from (see
  // prevWidth above) except in the one-render fallback right below.
  const body = document.createElement('div');
  body.className = 'gantt-body';
  body.appendChild(gutter);
  body.appendChild(scroll);
  container.appendChild(body);

  // The day-px scale: GANTT_DAY_PX while 'all' is active (today's unchanged,
  // horizontally-scrollable behaviour); a sized sub-view instead fills the
  // available width so its whole window shows with no horizontal scroll —
  // prevWidth (captured above, before the wipe) almost always supplies it.
  // Only the very first gantt paint ever (no outgoing scroller to read) falls
  // back to measuring the just-attached, still-rows-empty scroller directly
  // — a one-time cost paid once per page load, not on every re-render.
  const dayPx = ganttDayPx(subview, win.days, prevWidth != null ? prevWidth : scroll.clientWidth);
  ganttDayPxLive = dayPx;
  timeline.style.width = `${win.days * dayPx}px`;

  // Axis row: Monday week marks up top, matching full-height grid lines
  // behind the rows; the gutter gets an empty spacer of the same height so
  // both columns' row sequences line up 1:1 from there on. A sized sub-view
  // wide enough for it names every day instead (dayMarkLabel), with a fainter
  // line between days.
  const head = document.createElement('div');
  head.className = 'gantt-axis';
  gutter.appendChild(head);
  const axis = document.createElement('div');
  axis.className = 'gantt-axis';
  timeline.appendChild(axis);
  const today = localTodayStr();
  for (let i = 0; i < win.days; i++) {
    const day = addDays(win.startDay, i);
    const dayLabel = subview === 'all' ? null : dayMarkLabel(day, dayPx);
    if (dayLabel == null && !isMonday(day)) continue;
    const mark = document.createElement('div');
    mark.className = 'gantt-week-mark';
    mark.style.left = `${i * dayPx}px`;
    mark.textContent = dayLabel == null ? weekMarkLabel(day) : dayLabel;
    axis.appendChild(mark);
    if (i === 0 && dayLabel != null) continue;
    const line = document.createElement('div');
    line.className = isMonday(day) ? 'gantt-week-line' : 'gantt-week-line gantt-day-line';
    line.style.left = `${i * dayPx}px`;
    timeline.appendChild(line);
  }
  if (today >= win.startDay && today <= win.endDay) {
    const line = document.createElement('div');
    line.className = 'gantt-today-line';
    line.style.left = `${diffDays(win.startDay, today) * dayPx + dayPx / 2}px`;
    line.title = `Today (${today})`;
    timeline.appendChild(line);
  }

  for (const group of groups) {
    const glabel = document.createElement('div');
    glabel.className = `gantt-row gantt-group-row status-${mapStatusClass(group.status)}`;
    if (!isBuiltinStatus(group.status)) glabel.style.color = statusColorVar(group.status); // hashed color for custom groups
    glabel.textContent = columnLabel(group.status);
    gutter.appendChild(glabel);
    const gstrip = document.createElement('div');
    gstrip.className = 'gantt-row gantt-group-row';
    timeline.appendChild(gstrip);
    for (const bar of group.bars) {
      const label = document.createElement('div');
      // Gutter labels are card-el too — click opens detail,
      // ctrl/shift-click select, right-click menus, exactly like the bar itself
      // (cheap parity, and the only way to reach
      // a bar that's entirely outside the clamped window).
      label.className = 'gantt-row gantt-label card-el' + (paintsSelected(bar.card.id) ? ' selected' : '') + (isHoverHighlighted(hoverLit, bar.card.id) ? ' hover-highlight' : '');
      label.tabIndex = 0; // reachable by Tab so the hover cue isn't pointer-only (kanban.proj#261)
      label.dataset.id = bar.card.id;
      // Same fallback every other view uses — reused via
      // cardTitleDisplay, never re-derived (card-title.js).
      const titleDisplay = cardTitleDisplay(bar.card);
      label.title = `#${bar.card.id} ${titleDisplay.text}`;
      // The gutter row carries the dots too — "all components" means
      // both surfaces.
      // The Archive group's rows share this
      // exact label builder — no separate branch — so the conditional
      // archivedBadge() covers those gutter rows too, gated on the row's own
      // card.archived flag. The bar itself keeps its row-level mute
      // instead of gaining a redundant second archived cue.
      label.innerHTML = `<span class="gantt-label-id">#${bar.card.id}</span>${statusBadge(bar.card)}${bar.card.archived ? archivedBadge() : ''} ` +
        `<span class="gantt-label-title${titleDisplay.isPromptFallback ? ' gantt-label-title--prompt-fallback' : ''}">${escapeHtml(titleDisplay.text)}</span>`;
      gutter.appendChild(label);
      const row = document.createElement('div');
      row.className = 'gantt-row gantt-bar-row';
      const el = bar.startDay ? ganttBarEl(bar, win, dayPx) : null; // due-only rows have no bar
      if (el) row.appendChild(el);
      // Due diamond: the independent deadline marker, rendered
      // whether or not a bar exists on the row; outside the window = omitted
      // (nothing clips a point marker meaningfully).
      if (bar.dueDay && bar.dueDay >= win.startDay && bar.dueDay <= win.endDay) {
        const overdue = isOverdue(bar.card, today);
        const d = document.createElement('div');
        d.className = 'gantt-due-marker card-el' + (bar.card.archived ? ' archived' : '') + (overdue ? ' overdue' : ''); // joins the shared grammar: still-click opens detail, shift/right-click select. archived flag, same reasoning as ganttBarEl — the diamond is an equally dead drag surface on an archived row
        d.dataset.id = bar.card.id;
        d.dataset.archived = bar.card.archived ? '1' : ''; // read by wireGanttPointerDrag's pointerdown guard
        d.style.left = `${diffDays(win.startDay, bar.dueDay) * dayPx + dayPx / 2}px`; // centered on its day column
        d.title = bar.card.archived
          ? `#${bar.card.id} ${titleDisplay.text} — due ${bar.dueDay} (archived — restore the card to reschedule)`
          : `#${bar.card.id} ${titleDisplay.text} — due ${bar.dueDay}${overdue ? ' — past due' : ''} (drag to move the due date)`;
        row.appendChild(d);
      }
      timeline.appendChild(row);
    }
  }
  if (keepScrollLeft !== null) scroll.scrollLeft = keepScrollLeft;
}

// Pointer-event drag (pointerdown/move/up + setPointerCapture), NOT HTML5
// drag & drop like the board/calendar: a continuous horizontal drag needs a
// live per-move delta and a free visual offset, which dragover only gives
// against a grid of drop targets. One delegated set of listeners on the
// stable #gantt-view parent (wired once at DOMContentLoaded) — capture
// retargets moves to the bar, and they bubble back through the container, so
// per-render rewiring isn't needed. isDragging blocks the 5s poll for the
// gesture and pendingDrops for the PATCH round-trip, exactly like the
// calendar drag.
let ganttDrag = null;

function applyGanttDragVisual(drag) {
  const px = ganttDayPxLive; // the LAST render's day-px scale — see its own comment above
  if (drag.mode === 'shift' || drag.mode === 'due') { // the due diamond translates like a body shift
    drag.barEl.style.transform = `translateX(${drag.dayDelta * px}px)`;
    return;
  }
  // Visual mirror of the model's 1-day-minimum clamp, in rendered-bar days
  // (for a window-clipped bar that differs from its true length — the PATCH
  // math below stays authoritative, this only keeps the preview honest).
  const barDays = Math.max(1, Math.round(drag.baseWidth / px));
  if (drag.mode === 'start') {
    const d = Math.min(drag.dayDelta, barDays - 1);
    drag.barEl.style.left = `${drag.baseLeft + d * px}px`;
    drag.barEl.style.width = `${drag.baseWidth - d * px}px`;
  } else if (drag.relocates) {
    // due-only / reversed 1-day bars: the model MOVES due on an end-drag, so
    // an honest preview translates — stretching would show a range that will
    // never exist after the commit.
    drag.barEl.style.transform = `translateX(${drag.dayDelta * px}px)`;
  } else {
    const d = Math.max(drag.dayDelta, -(barDays - 1));
    drag.barEl.style.width = `${drag.baseWidth + d * px}px`;
  }
}

async function onGanttDragEnd(drag) {
  // Same-position drop: no PATCH, no `updated` bump — the model's
  // null covers the clamped-away cases the delta alone can't see.
  if (!drag.dayDelta) return;
  const card = state.active.find((c) => c.id === drag.id);
  if (!card) return; // vanished mid-gesture (deleted elsewhere) — the next poll will redraw
  const changes = drag.mode === 'due'
    ? dueShiftChanges(card, drag.dayDelta) // diamond drag moves due_date alone
    : drag.mode === 'shift'
      ? barShiftChanges(card, drag.dayDelta)
      : barResizeChanges(card, drag.mode, drag.dayDelta);
  if (!changes) return; // finish() already restored the pre-drag geometry
  pendingDrops++; // same poll guard as the board's onDrop / calendar's drop
  try {
    await api('PATCH', `/api/cards/${drag.id}`, changes); // `updated` bumps server-side
    await loadBoard();
  } catch (e) {
    renderGanttView(); // snap back to disk truth
    toast('Reschedule failed: ' + e.message);
  } finally {
    pendingDrops--;
  }
}

// A pointer-capture drag still dispatches a compatibility `click` on the bar
// after pointerup (mousedown/up land on the captured element, so their common
// ancestor is the bar — distance moved doesn't suppress it). Without this
// guard that phantom click would hit the shared card-el grammar (opening the
// detail popup after every drag) and the click-away rule (onClickAway). One-shot:
// armed only by a MOVED drag's pointerup, consumed by the very next click,
// and self-disarms on a 0-timeout in case no click follows (the click, when
// it comes, dispatches before any timer fires). pointercancel never fires a
// click, so the cancel path never arms it. Scoped to #gantt-view targets so a
// stale flag could never eat a click elsewhere.
let ganttClickSuppressed = false;

// Timing assumption (untestable under node:test): the compatibility click
// dispatches synchronously after pointerup and before this 0-timeout disarm
// (Pointer Events spec; holds in Chromium incl. VSCode's webview). If a
// browser ever defers it, worst case is one phantom click acting as a
// real one — re-verify with a manual smoke if gantt clicks misbehave.
function suppressGanttPhantomClick() {
  ganttClickSuppressed = true;
  setTimeout(() => { ganttClickSuppressed = false; }, 0);
}

function wireGanttPointerDrag() {
  const container = $('#gantt-view');
  document.addEventListener('click', (e) => {
    if (!ganttClickSuppressed) return;
    ganttClickSuppressed = false;
    if (!e.target.closest || !e.target.closest('#gantt-view')) return;
    e.preventDefault();
    e.stopPropagation(); // capture phase at document — nothing else sees this click
  }, true);
  // Control-row buttons — the sub-view switcher and prev/today/next — checked first
  // (never fall through to the pointer-drag/card-el handling below).
  container.addEventListener('click', (e) => {
    const sv = e.target.closest('.cal-subview-btn');
    if (sv) { setGanttSubview(sv.dataset.subview); return; }
    if (e.target.closest('.cal-span-cycle')) { setGanttSubview(nextSubview(GANTT_SUBVIEWS, loadGanttSubview())); return; }
    if (e.target.closest('#gantt-prev-btn')) { shiftGanttWindow(-1); return; }
    if (e.target.closest('#gantt-next-btn')) { shiftGanttWindow(1); return; }
    if (e.target.closest('#gantt-today-btn')) { ganttAnchor = null; renderGanttView(); }
  });
  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || ganttDrag) return;
    // The due diamond is its own drag surface — mode 'due' moves
    // due_date alone; bars keep their shift/resize modes. Same >3px
    // click-vs-drag rule applies to both (finish() below), so a still press
    // on the diamond opens the detail popup too.
    const diamondEl = e.target.closest('.gantt-due-marker');
    const barEl = diamondEl || e.target.closest('.gantt-bar');
    if (!barEl) return;
    const handle = diamondEl ? null : e.target.closest('.gantt-handle');
    const mode = diamondEl ? 'due' : handle ? (handle.classList.contains('start') ? 'start' : 'end') : 'shift';
    const card = state.active.find((c) => c.id === barEl.dataset.id);
    // An archived bar/diamond's id only ever lives in
    // state.archived, so `card` is undefined here — without this guard the
    // gesture would start identically to a live drag (pointer capture claimed,
    // .dragging class, the full pointermove preview), then silently
    // no-op on release because onGanttDragEnd's OWN state.active lookup
    // (below) could never find the card either. Blocking here — with a
    // toast, since a fully-realized fake drag animation deserves an honest
    // reason it did nothing — gives an upfront, visible signal instead.
    if (!card) {
      toast('Archived cards are read-only — restore the card to reschedule it.');
      return;
    }
    const rf = rangeFields(card); // triad-aware shape
    ganttDrag = {
      id: barEl.dataset.id,
      mode,
      // end-drag on an end-only or reversed card relocates its 1-day bar
      // instead of stretching (see barResizeChanges) — the preview must match
      relocates: mode === 'end' && !!rf && !!rf.endDay && (!rf.startDay || rf.startDay > rf.endDay),
      pointerId: e.pointerId, // a second touch/pen contact must not commit this drag
      barEl,
      originX: e.clientX,
      dayDelta: 0,
      moved: false,
      baseLeft: parseFloat(barEl.style.left) || 0,
      baseWidth: parseFloat(barEl.style.width) || 0,
    };
    barEl.setPointerCapture(e.pointerId);
    barEl.classList.add('dragging');
    isDragging = true; // poll guard for the whole gesture, released in finish()
    e.preventDefault(); // no text selection mid-drag
  });
  container.addEventListener('pointermove', (e) => {
    if (!ganttDrag || e.pointerId !== ganttDrag.pointerId) return;
    const dx = e.clientX - ganttDrag.originX;
    if (Math.abs(dx) > 3) ganttDrag.moved = true; // sub-day wiggle is still a drag, not a click
    ganttDrag.dayDelta = Math.round(dx / ganttDayPxLive);
    applyGanttDragVisual(ganttDrag);
  });
  // pointerup commits; pointercancel (touch scroll steal, window loss) never
  // does. Either way the bar snaps back to its pre-drag geometry first — on
  // commit the PATCH + loadBoard() re-render is what actually moves it.
  // A press without movement is a click — that click is
  // NOT handled here: the native click event that follows the unmoved
  // pointerup bubbles to the shared card-el grammar handlers, so bars get
  // detail/selection/click-away semantics identical to every other view. Only a
  // MOVED drag suppresses that following click (the >3px rule: a drag is not
  // a click).
  const finish = (commit) => {
    if (!ganttDrag) return;
    const drag = ganttDrag;
    ganttDrag = null;
    isDragging = false;
    drag.barEl.classList.remove('dragging');
    drag.barEl.style.transform = '';
    drag.barEl.style.left = `${drag.baseLeft}px`;
    if (drag.mode !== 'due') drag.barEl.style.width = `${drag.baseWidth}px`; // the diamond sizes itself in CSS — writing 0px would collapse it
    if (!commit) return;
    if (!drag.moved) return;
    suppressGanttPhantomClick();
    onGanttDragEnd(drag);
  };
  container.addEventListener('pointerup', (e) => { if (ganttDrag && e.pointerId === ganttDrag.pointerId) finish(true); });
  container.addEventListener('pointercancel', (e) => { if (ganttDrag && e.pointerId === ganttDrag.pointerId) finish(false); });
}

window.addEventListener('DOMContentLoaded', () => {
  $('#gantt-toggle-btn').addEventListener('click', () => toggleView('gantt'));
  wireGanttPointerDrag();
});

// --- Notifications: agents append entries to the board's
// notifications.md; GET /api/board carries the parsed list on every load/poll.
// sortNotificationsDesc/unreadCount/unseenUnread come from notifications.js
// (bare globals, same dual-environment pattern as the other extracted modules).
const seenNotifIds = new Set(); // toast-once-per-session guard — NOT read state

function renderNotifBadge() {
  const unread = unreadCount(state.notifications || []);
  const badge = $('#notif-badge');
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
}

function applyNotifications(list) {
  state.notifications = list;
  renderNotifBadge();
  const fresh = unseenUnread(list, seenNotifIds);
  if (fresh.length) {
    fresh.forEach((n) => seenNotifIds.add(n.id));
    const first = sortNotificationsDesc(fresh)[0];
    // toast() sets textContent — agent-written text is safe here without escapeHtml
    toast(fresh.length === 1
      ? `\u{1F514} ${first.from ? first.from + ': ' : ''}${first.message}`
      : `\u{1F514} ${fresh.length} new notifications`);
  }
  if (!$('#notif-modal').classList.contains('hidden')) renderNotifList();
}

function renderNotifList() {
  const list = sortNotificationsDesc(state.notifications || []);
  const el = $('#notif-list');
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'notif-empty';
    empty.textContent = 'No notifications.';
    el.replaceChildren(empty);
    return;
  }
  // Built as DOM nodes with textContent — agent-written text never
  // rides string-built HTML. splitNotification (notifications.js) gives the
  // TLDR and the detail; the detail sits under a More label, broken into its
  // clauses when it runs on. Code spans, card mentions and **bold** render
  // through appendInline. level paints the row (debug muted with a dashed edge, warning amber,
  // error red; absent = info).
  el.replaceChildren(...list.map((n) => {
    const row = document.createElement('div');
    row.className = `notif-row level-${notificationLevel(n)}${n.read ? '' : ' unread'}`;
    const text = document.createElement('div');
    text.className = 'notif-text';
    const meta = document.createElement('div');
    meta.className = 'notif-meta';
    const level = notificationLevel(n);
    meta.textContent = `${n.from || 'unknown'}${n.at ? ' · ' + formatFrontmatterValue(String(n.at)) : ''}`;
    if (level !== 'info') {
      const tag = document.createElement('span');
      tag.className = `notif-level notif-level--${level}`;
      tag.textContent = level;
      meta.appendChild(tag);
    }
    const msg = document.createElement('div');
    msg.className = 'notif-message';
    const { tldr, more } = splitNotification(n.message);
    const head = document.createElement('div');
    head.className = 'notif-tldr';
    appendInline(head, tldr);
    msg.appendChild(head);
    if (more) {
      const label = document.createElement('div');
      label.className = 'notif-more-label';
      label.textContent = 'More';
      const detail = document.createElement('div');
      detail.className = 'notif-more';
      const clauses = splitClauses(more);
      if (clauses.length > 1) {
        const ul = document.createElement('ul');
        for (const c of clauses) ul.appendChild(appendInline(document.createElement('li'), c));
        detail.appendChild(ul);
      } else {
        detail.appendChild(appendInline(document.createElement('p'), more));
      }
      msg.append(label, detail);
    }
    text.append(meta, msg);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn danger notif-delete';
    del.dataset.id = String(n.id);
    del.title = 'Clear this notification (moves it to archived/notifications.md)';
    del.setAttribute('aria-label', del.title);
    del.textContent = '✕';
    row.append(text, del);
    return row;
  }));
}

// A mention of this board's card opens it from the tray. The tray closes only
// once the card is showing, so a failed load leaves the reader where they were.
async function openMentionFromTray(e) {
  const m = e.target.closest('code.mention.same');
  if (!m) return;
  e.preventDefault();
  await openCard(m.dataset.cardId);
  if (!$('#detail-modal').classList.contains('hidden')) closeNotifModal();
}

// Inline markdown for notification text, as DOM nodes: code spans (card
// mentions become chips, a mention of this board's card opens it) and bold.
function appendInline(parent, text) {
  for (const tok of inlineTokens(text)) {
    if (tok.t === 'text') { parent.appendChild(document.createTextNode(tok.v)); continue; }
    const node = document.createElement(tok.t === 'code' ? 'code' : 'strong');
    node.textContent = tok.v;
    const m = tok.t === 'code' && cardMention(tok.v);
    if (m) {
      const same = m.board === state.projectName;
      node.className = same ? 'mention same' : 'mention';
      if (same) {
        node.dataset.cardId = String(m.id);
        node.tabIndex = 0;
        node.setAttribute('role', 'link');
      }
    }
    parent.appendChild(node);
  }
  return parent;
}

async function openNotifModal() {
  renderNotifList(); // render BEFORE mark-read so this viewing keeps its unread styling
  $('#notif-modal').classList.remove('hidden');
  if (unreadCount(state.notifications || []) > 0) {
    // Opening the popup is the read acknowledgment — persisted to the file.
    try {
      const { notifications } = await api('POST', '/api/notifications/mark-read');
      state.notifications = notifications;
      renderNotifBadge(); // badge clears; row styling stays until the next render
    } catch (e) { toast('Mark-read failed: ' + e.message); }
  }
}

function closeNotifModal() {
  $('#notif-modal').classList.add('hidden');
}

// Clear = archive: both removal paths MOVE entries to
// archived/notifications.md server-side — nothing is deleted, so the copy
// says "clear", not "delete".
async function deleteNotification(id) {
  const n = (state.notifications || []).find((x) => x.id === id);
  const snippet = n ? `"${n.message.slice(0, 50)}${n.message.length > 50 ? '…' : ''}"` : `#${id}`;
  if (!confirm(`Clear notification ${snippet}? It moves to archived/notifications.md.`)) return;
  try {
    const { notifications } = await api('DELETE', `/api/notifications/${id}`);
    state.notifications = notifications;
    renderNotifBadge();
    renderNotifList();
  } catch (e) { toast('Clear failed: ' + e.message); }
}

async function clearAllNotifications() {
  const count = (state.notifications || []).length;
  if (count === 0) return;
  if (!confirm(`Clear all ${count} notification(s)? They move to archived/notifications.md.`)) return;
  try {
    const { notifications } = await api('DELETE', '/api/notifications');
    state.notifications = notifications;
    renderNotifBadge();
    renderNotifList();
  } catch (e) { toast('Clear failed: ' + e.message); }
}

window.addEventListener('DOMContentLoaded', () => {
  $('#notif-btn').addEventListener('click', openNotifModal);
  $('#notif-close').addEventListener('click', closeNotifModal);
  $('#notif-clear-btn').addEventListener('click', clearAllNotifications);
  $('#notif-modal').addEventListener('click', (e) => { if (e.target.id === 'notif-modal') closeNotifModal(); });
  $('#notif-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.notif-delete');
    if (btn) { deleteNotification(Number(btn.dataset.id)); return; }
    openMentionFromTray(e);
  });
  $('#notif-list').addEventListener('keydown', (e) => { if (e.key === 'Enter') openMentionFromTray(e); });
});

// --- Multi-select + bulk actions, with view parity. The selection
// is an anchor plus an ordered list of additions (cards, paths, trees, queries;
// selection.js — pure, unit-tested), kept as parts and resolved to an id set for the
// view being shown on every render; every view's renderer paints .selected from that
// set, so it survives polls AND view switches by construction.
// Board tiles, map nodes + No relations tiles, calendar
// chips, and gantt bars + gutter labels all carry the card-el contract and
// share one interaction grammar — click opens detail, ctrl/cmd+click toggles
// one card in the selection, shift+click adds the whole range between the
// range start and the target (the file-manager grammar), right-click
// opens the card menu (for the card alone outside the selection, for the whole
// selection inside it; its actions are view-agnostic: they act on the menu's
// subject, not on DOM). Only the map's ghost stubs opt out
// (see buildMapSvg).
// The selection: the anchor and the additions that make it up, and the range
// start — the last card a selection gesture landed on (ctrl+click or a
// range-starting shift+click; a right-click leaves it alone). The
// range start is not the selection's anchor: it only says where a Board range
// begins. Written only by setSelection. Never persisted, and the range start is
// never trusted blindly: shift+click re-validates it against the rendered order
// and re-plants it when the card vanished (poll/delete) or left the active view
// (filter/view switch).
let selectionState = { selection: NO_SELECTION, rangeStart: null };
// What every view paints from and every bulk edit reads: the ids the selection
// stands for in the view being shown, derived by setSelection.
let selectedIds = new Set();

// Whether a view paints a card with the selected look: it is selected, or the box lights it
// (boxLitIds: outside the Graph, with isolate off, the cards the box matches). The look is
// all the box's matches get; they are no selection, and no action reads them.
function paintsSelected(id) {
  return selectedIds.has(id) || (boxLitIds !== null && boxLitIds.has(id));
}

let bulkDragIds = null; // captured at dragstart; null = single-card drag
let dragCardId = null; // set at dragstart: dragover cannot read the data transfer

// A poll that finds a picked card gone drops the parts built on it (archived cards
// are in the domain too, so archiving a card is not leaving the board).
function dropGoneCards() {
  setSelection(pruneSelectionParts(selectionState.selection, [...state.active, ...state.archived].map((c) => c.id)));
}

// The one entry point for every write to the selection, and the one place the id
// set is worked out. A write that names no range start keeps the one the
// selection had. Writing the selection it already holds works the id set out
// again, which is what every render does: the parts persist and the set is what
// they reach among the cards the view shows.
function setSelection(selection, rangeStart = selectionState.rangeStart) {
  selectionState = { selection, rangeStart };
  selectedIds = resolveSelection(selection, selectionMatchIds, shownCardIds);
}

// Hover/focus highlight (kanban.proj#261): the pointer or keyboard focus
// resting on any ONE piece of a card lights every piece sharing its id —
// the only way to see a card's true extent once the calendar or gantt has
// cut it across several DOM elements. Borrows the selection mechanism: a
// single module-level id (never a Set — only one card is hovered/focused
// at a time) that every view's renderer reads the same way it already
// reads selectedIds (isHoverHighlighted, selection.js), so a poll's full
// DOM rebuild carries the highlight forward with no extra step. The
// mouseover/mouseout/focusin/focusout listeners below only need to keep
// this variable current and paint the CURRENT dom directly
// (applyHoverHighlight) — a full renderBoard() per mouse move would be
// needless work and would fight the drag/selection paths that already
// share that render.
let hoveredId = null;

// The cards that take the look are not that one card alone: the search panel's "On hover show"
// (hover-show.js, hover-show-ui.js) ticks which sets of the hovered card light with it, so
// `hoverLit` is the Set of ids the renderers read (null when nothing is hovered), kept in step with
// hoveredId by syncHoverLit. The Graph lights those sets by dimming the rest (graphSetFocus), and
// its hover ring stays on the hovered card, so there `hoverLit` holds that card alone.
let hoverLit = null;

function hoverLitNow() {
  if (hoveredId == null) return null;
  return loadViewMode() === 'graph' ? new Set([hoveredId]) : hoverShowTiles(hoverShowKindsNow(), state.active.concat(state.archived), hoveredId, searchCtx());
}

function syncHoverLit() {
  hoverLit = hoverLitNow();
}

// One pass over the cards on the page, so a big set costs the same as a small one.
function applyHoverHighlight() {
  document.querySelectorAll('.hover-highlight').forEach((el) => el.classList.remove('hover-highlight'));
  if (hoverLit == null) return;
  document.querySelectorAll('.card-el').forEach((el) => {
    if (hoverLit.has(el.dataset.id)) el.classList.add('hover-highlight');
  });
}

function setHoveredId(id) {
  if (id === hoveredId) return;
  hoveredId = id;
  syncHoverLit();
  applyHoverHighlight();
}

// A change to what the hover lights (a set ticked, the Hierarchy and the Flow swapped) paints again now.
function refreshHover() {
  syncHoverLit();
  applyHoverHighlight();
  if (loadViewMode() === 'graph') graphSettleFocus();
}

// The rendered order shift+click ranges over: every card-el in
// the ACTIVE view's container, document order, deduped to first occurrence
// (a multi-day calendar run repeats one id across chips; gantt rows pair a
// gutter label with a bar). Hidden views keep stale DOM — applyViewMode only
// toggles .hidden — so the query must scope to the active container, not the
// whole document.
function visibleCardIds() {
  const ids = [...$(VIEW_CONTAINERS[loadViewMode()]).querySelectorAll('.card-el')].map((el) => el.dataset.id);
  return [...new Set(ids)];
}

function hideContextMenu() {
  menuNestClose();
  menuNestRelease();
  $('#context-menu').classList.add('hidden');
}

// The menu's subject is decided by cardMenuFor (selection.js) and nothing is
// written to the selection: a card outside it gets a menu for that card alone, a
// card inside it a menu for the whole selection. `fromDetail` is the card details'
// own menu, which has no Peek.
function openCardContextMenu(e, id, { fromDetail = false } = {}) {
  menuSubject = cardMenuFor(selectedIds, id, { fromDetail });
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY);
}

// Selected text and anything that already handled the right-click itself (a
// mention with a menu of its own) keep the browser's behaviour.
function onDetailContextMenu(e) {
  if (currentDetailId == null || e.defaultPrevented) return;
  // Links and images keep the browser's own menu (open in new tab, copy link).
  if (e.target && e.target.closest && e.target.closest('a, img')) return;
  const picked = window.getSelection();
  if (picked && !picked.isCollapsed) return;
  openCardContextMenu(e, currentDetailId, { fromDetail: true });
}

// An assignee cue or a tag is a search shortcut, not a way to open/select the
// card underneath it. See addSearchTerm for the additive/no-op contract. ADR
// 0009: the blocked/review pills join the same shortcut — always the bare
// presence term, read from state, never the pill's own text (the reason itself
// isn't a search key).
function searchByCue(cue, id) {
  const card = state.active.concat(state.archived).find((c) => c.id === id);
  if (!card) return;
  if (cue.classList.contains('card-assignee') && card.assignee) addSearchTerm(searchTermText('assignee', card.assignee));
  else if (cue.classList.contains('tag')) addSearchTerm(searchTermText('tags', cue.textContent));
  else if (cue.classList.contains('blocked-pill')) addSearchTerm('blocked:');
  else if (cue.classList.contains('review-pill')) addSearchTerm('review:');
}

// Writes what a click on a card does to the selection, as selectionAfterClick
// (selection.js) works it out from the gesture cardClickAction named. No repaint:
// the caller paints, the Graph in place and the shared grammar through
// renderBoard(). A range reads the active view's rendered order; with no usable
// range start (never set, card gone, or filtered out of this view) this click
// starts the range.
function selectByClick(action, id) {
  const next = selectionAfterClick(action, id, {
    selection: selectionState.selection,
    resolved: selectedIds,
    rangeStart: selectionState.rangeStart,
    order: action === 'range' ? visibleCardIds() : [],
    matchQuery: selectionMatchIds,
  });
  setSelection(next.selection, next.rangeStart);
}

// Carries out what cardClickAction (selection.js) decided about a click on a
// card. File-manager selection grammar: Shift+click ADDS the whole range
// between the range start and the target, in the active view's rendered order;
// ctrl/cmd+click toggles one card and plants the range start; the first card
// picked is the anchor and later ones are additions; a plain click breaks any
// selection but for its pills, then opens the card (or, in a view whose plain click selects,
// makes it the anchor of a new selection); the second click of a double click in
// such a view is a peek, which opens the card and leaves the selection alone.
// renderBoard() repaints whichever view is active — board columns always, plus
// the active map/calendar/gantt. Opening a card changes no filter: a click that opens it
// leaves every pill on and the box as they were, so the view behind the card details shows
// the same cards, and drops only the other parts of the selection (selectionAfterClick). A
// click that selects a card writes the selection into the box (mirrorSelectionInBox) with isolate
// off: the pills it dropped leave the box with it, as they do on Esc and on a double click on
// empty space, so the panel and the box agree. A Ctrl-click that takes out a card a pill lit
// turns the pill into its other cards, which the box then names, so the view does not widen under
// the click. While isolated a click moves the anchor only: the box holds the isolate text, which
// it never writes.
function applyCardClick(action, id, cue) {
  if (action === 'cue') { searchByCue(cue, id); return; }
  if (action === 'peek') { openCard(id); return; }
  const before = selectionState.selection;
  selectByClick(action, id);
  if (action !== 'open' && boxMirrorsSelection()) mirrorSelectionInBox(before);
  else if (action !== 'open' || selectionState.selection !== before) renderBoard();
  if (action === 'open') openCard(id);
}

// Enter on a focused card opens it in a view whose plain click selects: the
// Graph always, any other view when the preferences sheet says so.
// cardOpenAction (selection.js) decides; the Graph keeps its own handler for the
// key. It counts only on the card itself, since on a control inside it the key
// belongs to the control. A double click is not here: it is the second click of
// the card handler below, which carries the click count. A double click on a
// card never reaches the Calendar's create gesture, which skips cards.
function onCardOpenKey(e) {
  if (e.key !== 'Enter' || e.repeat) return;
  if (keyGuardSurface(document) !== null) return;
  if (isDragging || ganttDrag || calTimeDrag) return;
  const el = e.target.closest('.card-el');
  if (!el || e.target.closest('.graph-node, button, select, input, a, .rollup')) return;
  if (el !== e.target) return;
  const action = cardOpenAction({
    shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
    plainClick: plainClickBehaviour(loadViewMode(), loadPrefsState().click),
  });
  const lone = !(e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) && searchEnterOpens(searchEnterMatchIds(), el.dataset.id); // the one card a search matched opens on Enter whatever the click preference says
  if (action !== 'open' && !lone) return;
  e.preventDefault();
  openCard(el.dataset.id);
}

// The click-away rule. A click on empty space can be an accident, so a single click
// there leaves the selection, its anchor, the pills and the box as they were. A
// double click clears it all: the additions, the anchor, and the anchor's text in the
// box (a pill's query, a search typed in the Graph), which turns the chip off. Esc is
// the step-by-step way back. A double click is the second click of a pair, told by
// the count the browser puts on the click (detail 2), as the card handler above
// tells a peek: the first click's repaint can replace the element under the pointer,
// and a double click event aimed at the replaced element never reaches the document,
// so the page listens for none there.
//
// Empty space is anywhere but on a card or a Graph dot, a caption of the tier fan (the ones
// with a tip, which are tab stops), a control or a text field, a popup or the card menu, or a
// control marked data-keeps-selection. Ctrl-, cmd- and
// shift-clicks build a selection and never clear one. The marked controls are the
// ones that must not wipe a building selection: the context menu and the bulk popups
// (so they don't kill their own target batch), the view toggle buttons (the selection
// must survive a view switch), the date-picker popover (it renders into document.body,
// outside #modal), and the curate-the-view controls: month paging, the status pills,
// the section collapse toggles, the map options and zoom toolbar, the roll-up bars and
// the Graph's controls. A control built by a render path must wear the marker.
// Where a double click on empty space already means something, that meaning stands
// and the selection is left (DOUBLE_CLICK_OWNED).
const NOT_EMPTY_SPACE = '.card-el, .graph-node, [data-tip], button, input, select, textarea, a, .modal-backdrop, .context-menu';
const DOUBLE_CLICK_OWNED = `${CALENDAR_CREATE_DAY_CELLS}, ${CALENDAR_CREATE_COLUMNS}`;

function onClickAway(e) {
  if (e.detail !== 2) return;
  if (e.shiftKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest('[data-keeps-selection]')) return;
  if (e.target.closest(NOT_EMPTY_SPACE) || e.target.closest(DOUBLE_CLICK_OWNED)) return;
  if (isolateNow()) return; // isolated, the empty canvas clears nothing: clicks move the anchor only
  if (!selectionState.selection.anchor) return;
  if (isTypedAnchor(selectionState.selection) && !e.target.closest('#graph-view')) return; // the box is the anchor: only the empty Graph drops it, not a double click on the header or the box
  moveSelectionTo({ selection: NO_SELECTION, rangeStart: null }); // a dead selection must not leave an invisible range start behind
}

// The canvas of the view on show, where a right-click on empty space opens the menu of Isolate
// alone: the Graph's and the Map's. Empty is what the click-away rule calls empty space, and no
// Map node either (a ghost stub opens a card), and no relation line: a link between two cards, the
// Graph's line and its count and the Map's edge, belongs to the cards it joins. Every other view,
// and a point of these views outside their canvas (a toolbar, a section header), keeps the
// browser's own menu.
const CANVAS_OF_VIEW = { graph: '#graph-view .graph-canvas', map: '#map-view .map-canvas' };
const NOT_CANVAS_SPACE = `${NOT_EMPTY_SPACE}, .map-node, .graph-link, .graph-link-hit, .graph-link-count, .map-edge`;

function openCanvasContextMenu(e) {
  const canvas = CANVAS_OF_VIEW[loadViewMode()];
  if (!canvas || !e.target.closest(canvas) || e.target.closest(NOT_CANVAS_SPACE)) return;
  menuSubject = canvasMenuFor();
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY);
}

function showContextMenu(x, y) {
  const menu = $('#context-menu');
  // The empty canvas of the Graph or the Map opens a menu of Isolate alone, which the
  // stylesheet makes of one entry; a card's menu has them all again.
  menu.classList.toggle('canvas-menu', !!menuSubject.canvas);
  $('#ctx-isolate').classList.toggle('hidden', !menuSubject.isolate);
  $('#ctx-isolate').textContent = isolateMenuLabel();
  // Peek and Add to selection lead a menu for a card outside the selection; the
  // card details' menu leaves Peek out. Path and Tree show on every card's menu, whatever
  // the subject; the empty canvas's menu hides them with the rest of its group. The caller has
  // already decided menuSubject.
  $('#ctx-peek').classList.toggle('hidden', !menuSubject.peek);
  $('#ctx-add').classList.toggle('hidden', !menuSubject.add);
  $('#ctx-note').classList.toggle('hidden', !notesOn() || !!menuSubject.canvas || menuSubject.ids.length < 1);
  $('#ctx-child').classList.toggle('hidden', !!menuSubject.canvas || menuSubject.ids.length !== 1 || !state.active.some((c) => String(c.id) === String(menuSubject.ids[0])));
  $('#ctx-scratch').classList.toggle('hidden', !scratchpadOn() || !!menuSubject.canvas || menuSubject.ids.length !== 1);
  $('#ctx-todos').classList.toggle('hidden', !todosOn() || !!menuSubject.canvas || menuSubject.ids.length !== 1);
  $('#ctx-group-add').classList.toggle('hidden', !groupsOn() || !!menuSubject.canvas || menuSubject.ids.length < 1);
  $('#ctx-group-make').classList.toggle('hidden', !groupsOn() || !!menuSubject.canvas || menuSubject.ids.length < 2);
  menuNestSync(!!menuSubject.canvas); // the groups follow their entries, the separators follow the groups
  menu.classList.remove('hidden');
  menuNestFocus();
  // Clamp to the viewport so the menu never opens half off-screen.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
}

// Peek opens the card's details through the same path a plain open takes (so card
// history takes its step) and leaves the selection and the range start alone.
function peekCard() {
  hideContextMenu();
  openCard(menuSubject.ids[0]);
}

// Add to selection: the card joins as an addition, or becomes the anchor of an
// empty selection. The range start stays where it was.
function addCardToSelection() {
  hideContextMenu();
  const before = selectionState.selection;
  setSelection(addPart(before, cardPart(menuSubject.ids[0])));
  if (boxMirrorsSelection()) mirrorSelectionInBox(before);
  else renderBoard();
}

// Explore's Path and Tree, each by Hierarchy or Dependency: the term of the card that was
// right-clicked (the open card, in the card details' menu), never of the whole subject, even
// when that card is inside the selection, is written to the box as if it were typed (writeSearch,
// reason 'typing'). It replaces what the box held but for its run of slices, so the Graph lights
// the set and the other views show only it; the selection follows as a typed search does, and
// isolate follows the view's Typing isolates as typing into the box does (on, it keeps the term as its
// text; off, the box lights the set). A Shift
// pick (a Shift-click, or Shift+Enter on the focused item, which the browser clicks with Shift
// held) adds the term to what the box holds as one more alternative (searchAddAlt), so an empty
// box takes it as a plain pick does.
function exploreIntoBox(kind, e) {
  hideContextMenu();
  if (menuSubject.clicked == null) return;
  const input = $('#search-input');
  const term = `${kind}:${window.kanbanIds.idKey(menuSubject.clicked) ?? menuSubject.clicked}`;
  writeSearch(searchWithTerms(input.value, term, !!(e && e.shiftKey)), 'typing');
}

// Bulk archive asks WHERE before it moves anything (ADR 0010): the
// confirm speedbump first (unchanged rule — skipped when every card being
// archived is already done), then the Archive popup, whose package box
// completes against the board's existing archived/<package>/ folders. Left
// empty it archives to the archived/ root, exactly as before packages existed
// — the drag-to-Archive and tile/detail Archive paths never ask at all.
async function bulkArchive() {
  hideContextMenu();
  captureBulkTargets();
  const targets = bulkTargets(bulkPopupIds);
  const skipped = targets.filter((c) => c.archived).length; // already archived (mixed selections)
  const toArchive = targets.filter((c) => !c.archived);
  const ids = toArchive.map((c) => c.id);
  if (!ids.length) { if (skipped) toast('Everything selected is already archived.'); return; }
  // one speedbump for the batch, not one per card — skipped entirely
  // when every card being archived is already done
  if (archiveNeedsConfirm(toArchive) && !confirm(`Archive ${ids.length} card(s)? (moves their files to archived/)`)) return;
  openBulkArchive(ids.length);
}

function openBulkArchive(count) {
  $('#bulk-archive-title').textContent = `Archive ${count} card(s)`;
  $('#bulk-archive-input').value = '';
  $('#bulk-archive').classList.remove('hidden');
  $('#bulk-archive-input').focus();
}

// The popup's Archive button. Archives the cards the popup captured when the
// action started, read again (the poll may have moved cards under the popup),
// and sends the package with every POST — a blank box sends none, so the
// request is byte-identical to the package-less archive paths.
async function applyBulkArchive() {
  const pkg = $('#bulk-archive-input').value.trim();
  $('#bulk-archive').classList.add('hidden');
  const targets = bulkTargets(bulkPopupIds);
  const skipped = targets.filter((c) => c.archived).length;
  const ids = targets.filter((c) => !c.archived).map((c) => c.id);
  if (!ids.length) { if (skipped) toast('Everything selected is already archived.'); return; }
  const failed = [];
  for (const id of ids) {
    try { await api('POST', `/api/cards/${id}/archive`, pkg ? { package: pkg } : undefined); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  if (bulkPopupInSelection) setSelection(NO_SELECTION); // a menu opened outside the selection leaves the hand-built selection as it was
  await loadBoard();
  const where = pkg ? ` into ${pkg}` : '';
  const skipNote = skipped ? `; skipped ${skipped} already archived` : '';
  toast(failed.length ? `Archived ${ids.length - failed.length}${where}${skipNote}; failed: ${failed.join(', ')}` : `Archived ${ids.length} card(s)${where}${skipNote}.`);
}

// Restore selected: the reversible direction — no confirm, same
// exemption as the tile button; status stays untouched (drag names a
// destination, the menu doesn't). Live cards in a mixed selection skip.
async function bulkRestore() {
  hideContextMenu();
  const targets = bulkTargets(menuSubject.ids);
  const skipped = targets.filter((c) => !c.archived).length;
  const ids = targets.filter((c) => c.archived).map((c) => c.id);
  if (!ids.length) { if (skipped) toast('Nothing selected is archived.'); return; }
  const failed = [];
  for (const id of ids) {
    try { await api('POST', `/api/cards/${id}/restore`); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  await loadBoard(); // selection survives — restored cards are still on the board
  const skipNote = skipped ? `; skipped ${skipped} not archived` : '';
  toast(failed.length ? `Restored ${ids.length - failed.length}${skipNote}; failed: ${failed.join(', ')}` : `Restored ${ids.length} card(s)${skipNote}.`);
}

// One popup for the whole selection (delete-ui.js): it asks once, whatever the count.
function bulkDelete() {
  hideContextMenu();
  const ids = bulkTargets(menuSubject.ids).map((c) => c.id);
  if (!ids.length) return;
  const wasSelection = menuSubject.inSelection;
  openDelete('card', ids, {
    onDone: () => { if (wasSelection) setSelection(NO_SELECTION); }, // a menu opened outside the selection leaves the hand-built selection as it was
  });
}

// Bulk move (drag): the doing entry gate (waiting + blocked)
// stays per card — refused cards are skipped with one honest summary toast
// naming which gate, the rest move (no all-or-nothing rule).
async function onBulkDrop(ids, status) {
  const byId = new Map(state.active.map((c) => [c.id, c]));
  // same in-place rule as onDrop: cards already rendering in the target
  // column (incl. parked unlisted statuses) drop out of the batch untouched
  ids = ids.filter((i) => { const c = byId.get(i); return c && columnForStatus(c.status, state.statuses) !== status; });
  const { movable, refused } = partitionByMovable(ids, byId, status, refusesDoing);
  if (!movable.length && !refused.length) return;
  const prev = new Map(movable.map((c) => [c.id, c.status]));
  movable.forEach((c) => { c.status = status; }); // optimistic
  setSelection(NO_SELECTION);
  renderBoard();
  pendingDrops++; // same poll guard as single onDrop
  const failed = [];
  try {
    for (const c of movable) {
      try { await api('PATCH', `/api/cards/${c.id}`, { status }); }
      catch (e) { c.status = prev.get(c.id); failed.push(`#${c.id} (${e.message})`); }
    }
    await loadBoard();
  } finally {
    pendingDrops--;
  }
  const parts = [];
  if (movable.length - failed.length) parts.push(`Moved ${movable.length - failed.length} to ${status}`);
  if (refused.length) parts.push(`skipped ${refused.map((c) => `#${c.id} (${refusalWord(c)})`).join(', ')}`);
  if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
  const note = openLeavesNote(movable.filter((c) => !failed.some((f) => f.startsWith(`#${c.id} `))), status);
  if (note) parts.push(note);
  if (parts.length) toast(parts.join('; ') + '.');
}

// --- Bulk edits: assign / set-priority share one single-choice
// popup, tags get a workbench. N per-card PATCHes, per-card failures don't
// abort (bulk-move semantics). No confirm — the popup's Apply IS the
// speedbump (edits are reversible, unlike archive/delete) — and the
// selection survives so bulk actions chain on the same batch.
let bulkSingleMode = null; // 'assignee' | 'priority'
let bulkPopupIds = []; // the ids an open bulk popup captured when it opened; the next popup replaces them
let bulkPopupInSelection = false; // whether the menu that opened that popup was for the selection; replaced with the ids
// What the card menu the last right-click opened is for (cardMenuFor, selection.js):
// the right-clicked card alone outside the selection, the resolved selection inside
// it. Fixed when the menu opens, so the menu's entries and the popups they open act
// on those cards whatever the selection and the poll do meanwhile.
let menuSubject = { ids: [], inSelection: false, peek: false, add: false, isolate: false, clicked: null, canvas: false };

// The one reader of the cards a bulk action acts on, live or archived, in the
// order they were selected; an id with no card (deleted mid-selection) is
// dropped. With no argument it reads the selection as it is now. A popup that
// stays open while the poll and the user move on passes the ids it captured.
function bulkTargets(ids = [...selectedIds]) {
  const byId = new Map([...state.active, ...state.archived].map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// A popup's copy of its targets, taken when it opens, so it acts on the cards it
// showed whatever happens to the selection while it is open. They are the menu's
// subject: the right-clicked card alone when it was outside the selection.
function captureBulkTargets() {
  bulkPopupIds = bulkTargets(menuSubject.ids).map((c) => c.id);
  bulkPopupInSelection = menuSubject.inSelection;
}

function openBulkSingle(mode) {
  hideContextMenu();
  captureBulkTargets();
  if (!bulkPopupIds.length) return;
  bulkSingleMode = mode;
  $('#bulk-single-title').textContent = mode === 'assignee'
    ? `Assign ${bulkPopupIds.length} card(s)` : `Set priority on ${bulkPopupIds.length} card(s)`;
  $('#bulk-single-hint').textContent = mode === 'assignee' ? 'Leave empty to unassign.' : '';
  $('#bulk-single-input').value = '';
  $('#bulk-single-apply').disabled = mode === 'priority'; // priority requires a value
  applyModalFullscreen('bulkSingle'); // re-apply the persisted preference on every open
  $('#bulk-single').classList.remove('hidden');
  $('#bulk-single-input').focus();
}

async function bulkPatch(ids, changesFor, summary) {
  const failed = [];
  for (const id of ids) {
    try { await api('PATCH', `/api/cards/${id}`, changesFor(id)); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  await loadBoard(); // selection survives — dropGoneCards only drops departed ids
  toast(failed.length ? `${summary(ids.length - failed.length)}; failed: ${failed.join(', ')}` : `${summary(ids.length)}.`);
}

async function applyBulkSingle() {
  const value = $('#bulk-single-input').value.trim();
  if (bulkSingleMode === 'priority' && !value) return;
  const mode = bulkSingleMode;
  $('#bulk-single').classList.add('hidden');
  const label = mode === 'assignee'
    ? (value ? `Assigned ${value} to` : 'Unassigned')
    : `Priority ${value} set on`;
  await bulkPatch(bulkTargets(bulkPopupIds).map((c) => c.id), () => (mode === 'assignee' ? { assignee: value } : { priority: value }), (n) => `${label} ${n} card(s)`);
}

function renderBulkTags() {
  const cards = bulkTargets(bulkPopupIds);
  $('#bulk-tags-title').textContent = `Edit tags on ${cards.length} card(s)`;
  const list = $('#bulk-tag-list');
  const union = tagUnion(cards);
  if (!union.length) { list.textContent = 'No tags on the selected cards yet.'; return; }
  list.replaceChildren(...union.map(({ tag, count }) => {
    const label = document.createElement('label');
    label.className = 'bulk-tag-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = tag;
    label.append(cb, ` ${tag} `);
    const badge = document.createElement('span');
    badge.className = 'bulk-tag-count';
    badge.textContent = `(${count})`;
    label.appendChild(badge);
    return label;
  }));
}

function openBulkTags() {
  hideContextMenu();
  captureBulkTargets();
  if (!bulkPopupIds.length) return;
  $('#bulk-tag-input').value = '';
  renderBulkTags();
  applyModalFullscreen('bulkTags'); // re-apply the persisted preference on every open
  $('#bulk-tags').classList.remove('hidden');
  // No autofocus: focusing would drop the suggestions open before the user
  // asked — the field opens its menu when deliberately clicked/tabbed into.
}

async function bulkAddTag() {
  const tag = $('#bulk-tag-input').value.trim();
  if (!tag) return;
  const changes = addTagChanges(bulkTargets(bulkPopupIds), tag);
  $('#bulk-tag-input').value = '';
  if (!changes.length) { toast(`All selected cards already have "${tag}".`); return; }
  const byId = new Map(changes.map((c) => [c.id, c.tags]));
  await bulkPatch([...byId.keys()], (id) => ({ tags: byId.get(id) }), (n) => `Added "${tag}" to ${n} card(s)`);
  renderBulkTags(); // workbench stays open for the next operation
}

async function bulkRemoveTags() {
  const chosen = [...$('#bulk-tag-list').querySelectorAll('input:checked')].map((cb) => cb.value);
  if (!chosen.length) { toast('Tick the tags to remove first.'); return; }
  const changes = removeTagsChanges(bulkTargets(bulkPopupIds), chosen);
  const byId = new Map(changes.map((c) => [c.id, c.tags]));
  await bulkPatch([...byId.keys()], (id) => ({ tags: byId.get(id) }), (n) => `Removed ${chosen.join(', ')} from ${n} card(s)`);
  renderBulkTags();
}

// --- Schedule… popup: bulk set/clear across the date triad, same
// contract as the other bulk edits — no confirm (Apply is the speedbump,
// dates are reversible), per-card failures don't abort, selection survives.
// The three rows reuse the date-picker through the shared .date-pick-btn
// loop below (the popup's buttons are static markup, so the loop wires them
// like the form's); the pure rules (scheduleChanges/scheduleSummary) live in
// bulk-edit.js.
const SCHEDULE_ROWS = [
  ['start', '#bs-start', '#bs-start-clear'],
  ['end', '#bs-end', '#bs-end-clear'],
  ['due', '#bs-due', '#bs-due-clear'],
];

function readScheduleFields() {
  const fields = {};
  for (const [key, inputSel, clearSel] of SCHEDULE_ROWS) {
    fields[key] = { value: $(inputSel).value, clear: $(clearSel).checked };
  }
  return fields;
}

// Clear wins over typing, so a field whose clear box is ticked has its input
// AND its 📅 button disabled — the popup never shows a value that won't
// apply. Apply stays disabled until something is touched (the priority
// popup's discipline): scheduleChanges() === null IS the untouched predicate,
// so the button and the PATCH can never disagree.
function refreshScheduleControls() {
  for (const [, inputSel, clearSel] of SCHEDULE_ROWS) {
    const off = $(clearSel).checked;
    $(inputSel).disabled = off;
    document.querySelector(`.date-pick-btn[data-date-input="${inputSel.slice(1)}"]`).disabled = off;
  }
  $('#bulk-schedule-apply').disabled = scheduleChanges(readScheduleFields()) === null;
}

function openBulkSchedule() {
  hideContextMenu();
  captureBulkTargets();
  if (!bulkPopupIds.length) return;
  $('#bulk-schedule-title').textContent = `Schedule ${bulkPopupIds.length} card(s)`;
  for (const [, inputSel, clearSel] of SCHEDULE_ROWS) { // fresh slate on every open
    $(inputSel).value = '';
    $(clearSel).checked = false;
  }
  refreshScheduleControls(); // re-enables the inputs, disables Apply
  applyModalFullscreen('bulkSchedule'); // re-apply the persisted preference on every open
  $('#bulk-schedule').classList.remove('hidden');
  $('#bs-start').focus(); // plain input, no combobox — safe to focus (contrast openBulkTags)
}

async function applyBulkSchedule() {
  const changes = scheduleChanges(readScheduleFields());
  $('#bulk-schedule').classList.add('hidden');
  if (!changes) return; // untouched — Apply is disabled then, but belt-and-braces: just close
  await bulkPatch(bulkTargets(bulkPopupIds).map((c) => c.id), () => changes, (n) => `Scheduled ${n} card(s): ${scheduleSummary(changes)}`);
}

// Esc must never be a true no-op on a fullscreen
// bulk popup. Esc closes whichever one is open, directly,
// same as its own backdrop-click — no confirm, since bulk edits are
// speedbump-exempt (Apply is the speedbump, same reasoning as backdrop-close).
function closeAnyBulkPopup() {
  for (const sel of ['#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive']) {
    const el = $(sel);
    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return true; }
  }
  return false;
}

window.addEventListener('DOMContentLoaded', () => {
  // --- Shared card-el grammar: ONE delegated click + contextmenu
  // pair on document covers every card-representing element in every view —
  // board tiles, map nodes/No relations tiles, calendar chips, gantt bars/gutter
  // labels — instead of per-view duplicates that would drift. Document is the
  // stable ancestor (the view containers are all rebuilt-into, never
  // replaced, but one listener beats four). View-specific controls keep their
  // own per-view delegated handlers, which run FIRST (they're deeper in the
  // bubble path) and are excluded here by the interactive-control guard: a
  // click landing on a button/select inside or around a card-el (archive
  // tile's Restore/Delete, column sort controls, calendar nav) belongs to
  // that control, never to the card grammar. Registration order matters:
  // a card is not empty space, so the click-away rule (onClickAway) leaves what
  // the click built.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.rollup') && !(e.ctrlKey || e.metaKey || e.shiftKey)) { toggleRollupBar(); return; } // a modified click still belongs to multi-select
    const el = e.target.closest('.card-el');
    if (!el) return;
    if (e.target.closest('button, select, input, a')) return;
    const cue = e.target.closest('.card-assignee, .tag, .blocked-pill, .review-pill');
    const view = loadViewMode();
    const action = cardClickAction({ cue: !!cue, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, plainClick: plainClickBehaviour(view, loadPrefsState().click), ranges: shiftAddsRange(view), detail: e.detail });
    applyCardClick(action, el.dataset.id, cue);
  });
  // Right-click on any card-el opens the card menu; anywhere else keeps the
  // browser's own context menu (don't hijack the whole page), except the empty
  // canvas of the Graph and the Map, which opens a menu of Isolate alone
  // (openCanvasContextMenu). A card outside the selection gets a menu for that
  // card alone and the selection stays; a selected one gets a menu for the whole
  // batch.
  document.addEventListener('contextmenu', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // a chorded right-click mid-drag must not re-render under the gesture
    const el = e.target.closest('.card-el');
    if (!el) { openCanvasContextMenu(e); return; }
    openCardContextMenu(e, el.dataset.id);
  });
  document.addEventListener('keydown', onCardOpenKey);
  // The preferences sheet: the gear opens it; its close button and a click on
  // the backdrop close it, and so does Esc (its own line in the Esc handler).
  $('#prefs-btn').addEventListener('click', () => openPrefsSheet());
  $('#prefs-close').addEventListener('click', closePrefsSheet);
  $('#prefs-sheet').addEventListener('click', onPrefsSheetClick);
  $('#prefs-archived-done').addEventListener('change', (e) => setArchivedDone(e.target.checked));
  $('#prefs-slices-folded').addEventListener('change', (e) => setSlicesFolded(e.target.checked));
  $('#prefs-pills-folded').addEventListener('change', (e) => setPillsFolded(e.target.checked));
  $('#prefs-statuses-folded').addEventListener('change', (e) => setStatusesFolded(e.target.checked));
  $('#prefs-typing-folded').addEventListener('change', (e) => setTypingFolded(e.target.checked));
  $('#prefs-hover-folded').addEventListener('change', (e) => setHoverFolded(e.target.checked));
  $('#prefs-panel-on-focus').addEventListener('change', (e) => setPanelOnFocus(e.target.checked));
  $('#prefs-md-colour').addEventListener('change', (e) => setMdColour(e.target.checked));
  // Hover/focus highlight: mouseover/mouseout (not mouseenter/mouseleave —
  // those don't bubble, and this wants one delegated pair like the click/
  // contextmenu grammar above) plus focusin/focusout so Tab reaches the
  // same cue. The leave side's "still inside the same card-el" guard stops
  // the highlight flickering off while the pointer/focus crosses an
  // INTERNAL boundary (title, tags, an archived tile's own Restore/Delete
  // buttons) — mouseout/focusout fire on every such boundary, not just the
  // card-el's own edge.
  const enterHover = (e) => {
    const el = e.target.closest('.card-el');
    setHoveredId(el ? el.dataset.id : null);
  };
  const leaveHover = (e) => {
    const from = e.target.closest('.card-el');
    if (!from) return;
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.card-el');
    if (to === from) return;
    setHoveredId(to ? to.dataset.id : null);
  };
  document.addEventListener('mouseover', enterHover);
  document.addEventListener('mouseout', leaveHover);
  document.addEventListener('focusin', enterHover);
  document.addEventListener('focusout', leaveHover);
  $('#ctx-child').addEventListener('click', () => {
    const parent = menuSubject.ids[0];
    hideContextMenu();
    openModal(null, newCardStatus(), undefined, parent);
  });
  $('#ctx-archive').addEventListener('click', bulkArchive);
  $('#ctx-restore').addEventListener('click', bulkRestore);
  $('#ctx-delete').addEventListener('click', bulkDelete);
  // Bulk edits
  $('#ctx-assign').addEventListener('click', () => openBulkSingle('assignee'));
  $('#ctx-priority').addEventListener('click', () => openBulkSingle('priority'));
  $('#ctx-tags').addEventListener('click', openBulkTags);
  // Schedule… popup
  $('#ctx-schedule').addEventListener('click', openBulkSchedule);
  // Peek and Add to selection, then Explore's four sets, which write the box
  $('#ctx-peek').addEventListener('click', peekCard);
  $('#ctx-add').addEventListener('click', addCardToSelection);
  for (const kind of EXPLORE_KINDS) $(`#ctx-${kind}`).addEventListener('click', (e) => exploreIntoBox(kind, e));
  $('#bulk-schedule-apply').addEventListener('click', applyBulkSchedule);
  $('#bulk-schedule-close').addEventListener('click', () => $('#bulk-schedule').classList.add('hidden'));
  $('#bulk-schedule-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('bulkSchedule'));
  // Touched-state recompute: typing, picker writes (the popover dispatches a
  // bubbling 'input' — see the date-picker glue), and clear-checkbox flips
  // all funnel through these two delegated listeners; refresh is idempotent,
  // so a checkbox firing both events is harmless.
  $('#bulk-schedule').addEventListener('input', refreshScheduleControls);
  $('#bulk-schedule').addEventListener('change', refreshScheduleControls);
  $('#bulk-single-apply').addEventListener('click', applyBulkSingle);
  $('#bulk-single-close').addEventListener('click', () => $('#bulk-single').classList.add('hidden'));
  $('#bulk-single-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('bulkSingle'));
  $('#bulk-tags-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('bulkTags'));
  $('#bulk-single-input').addEventListener('input', () => {
    $('#bulk-single-apply').disabled = bulkSingleMode === 'priority' && !$('#bulk-single-input').value.trim();
  });
  $('#bulk-archive-apply').addEventListener('click', applyBulkArchive);
  $('#bulk-archive-close').addEventListener('click', () => $('#bulk-archive').classList.add('hidden'));
  $('#bulk-tag-add').addEventListener('click', bulkAddTag);
  $('#bulk-tags-remove').addEventListener('click', bulkRemoveTags);
  $('#bulk-tags-close').addEventListener('click', () => $('#bulk-tags').classList.add('hidden'));
  // Backdrop click closes a bulk popup (speedbump-exempt: edits are the
  // reversible direction) and deliberately keeps the selection.
  $('#bulk-single').addEventListener('click', (e) => { if (e.target.id === 'bulk-single') $('#bulk-single').classList.add('hidden'); });
  $('#bulk-tags').addEventListener('click', (e) => { if (e.target.id === 'bulk-tags') $('#bulk-tags').classList.add('hidden'); });
  $('#bulk-schedule').addEventListener('click', (e) => { if (e.target.id === 'bulk-schedule') $('#bulk-schedule').classList.add('hidden'); });
  // Archive popup's backdrop click cancels the archive outright — the
  // move hasn't happened yet, so closing is the safe direction here too.
  $('#bulk-archive').addEventListener('click', (e) => { if (e.target.id === 'bulk-archive') $('#bulk-archive').classList.add('hidden'); });
  // Popup comboboxes: same suggest-never-validate lists as the edit form.
  attachCombobox($('#bulk-single-input'), () => (bulkSingleMode === 'assignee'
    ? state.assignees.map((a) => ({ value: a.handle, label: `${a.handle}${a.name ? ` — ${a.name}` : ''}${a.kind ? ` (${a.kind})` : ''}` }))
    : (state.priorities.length ? state.priorities : DEFAULT_PRIORITIES).map((v) => ({ value: v }))));
  attachCombobox($('#bulk-tag-input'), () => state.tags.map((v) => ({ value: v })));
  // The package box completes against the archived/ folders that already
  // exist — suggest-never-validate like every other combobox here, so a name
  // that matches nothing is a NEW package folder, not an error.
  attachCombobox($('#bulk-archive-input'), () => state.archivePackages.map((v) => ({ value: v })));
  // Any left-click outside the menu dismisses it (actions inside handle themselves).
  document.addEventListener('click', (e) => {
    if (!$('#context-menu').classList.contains('hidden') && !e.target.closest('#context-menu')) hideContextMenu();
  });
  document.addEventListener('click', onClickAway);
  window.addEventListener('resize', hideContextMenu);
  // Backdrop click on the edit/new-card form goes through the dirty guard.
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') requestCloseModal(); });
});

// --- Assignees registry: config.yaml's assignees feed the form's datalist.
// The registry suggests, it never validates — free text stays allowed, and an
// unregistered assignee on an existing card saves fine. A board
// with NO registry falls back to the canonical @human/@hitl/@afk role trio
// (resolveAssignees/DEFAULT_ASSIGNEES, assignee-badge.js) — a configured
// registry still wins untouched, and free text stays legal either way.
function applyAssignees(list) {
  state.assignees = resolveAssignees(list); // the combobox menus read state live — nothing to render here
}

// --- Official lists: config.yaml's priorities/tags feed the form's
// datalists — same suggest-never-validate contract as the assignee registry.
// Priorities fall back to the built-in High/Normal/Low so the combobox is
// never empty; tags suggest one full value at a time (a comma-separated field
// only completes its current single entry — good enough on purpose).
function applyLists(priorities, tags) {
  state.priorities = priorities; // the combobox menus read state live
  state.tags = tags;
}

// --- Hand-rolled comboboxes: native <datalist> misrenders inside
// VSCode's Simple Browser (popup at wrong screen coordinates) and its
// filter-by-current-value hides every option on a prefilled field. The rules
// (which options to show, how a pick lands in the text) live in combobox.js;
// this is only the menu DOM. Focus/typing opens, mousedown picks (fires
// before blur), blur/Esc closes — Esc is swallowed so the modal stays open.
//
// Keyboard grammar on top: Up/Down move a visible `highlightIndex`
// through the CURRENTLY RENDERED `items` (wrap math is nextHighlightIndex,
// combobox.js; the highlighted row is also scrolled into view — a menu longer
// than its 180px max-height must never leave the active row invisible). Enter
// falls through to the surrounding <form>'s native submit-on-Enter ONLY when
// the menu is CLOSED — an open menu always
// consumes Enter itself: picks the highlighted row, or (nothing highlighted)
// just closes the menu so the very next Enter is the one that reaches the
// form. The minimal-create flow is unaffected: a mouse pick already
// closes the menu before Enter is ever pressed, and the plain title-only
// flow never opens the assignee menu at all — a keyboard-driven pick
// (ArrowDown+Enter) takes a second Enter to submit. Esc closes the
// menu ONLY and stops propagation so the document-level popup-close handler
// never sees that keypress — the next Esc is the one that closes the popup.
function attachCombobox(input, getOptions, opts = {}) {
  const menu = document.createElement('div');
  menu.className = 'combobox-menu';
  menu.hidden = true;
  input.parentElement.style.position = 'relative';
  input.parentElement.appendChild(menu);
  let items = [];          // options currently rendered, in menu order — keydown reads this
  let highlightIndex = -1; // -1 = nothing highlighted
  const close = () => { menu.hidden = true; items = []; highlightIndex = -1; };
  const setHighlight = (idx) => {
    highlightIndex = idx;
    [...menu.children].forEach((el, i) => el.classList.toggle('active', i === idx));
    // .combobox-menu is max-height:180px/overflow-y:auto — a
    // classList toggle alone never scrolls an unfocused div into view, so a
    // menu with more rows than fit (8+ tags/assignees) would leave the
    // highlight invisible past the fold, wrap-around included.
    const active = menu.children[idx];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  };
  const pick = (choice) => {
    // browse-pick (nothing typed since focus) appends a tag; a pick while
    // typing completes the segment in progress
    input.value = applyChoice(input.value, choice.value, { ...opts, append: !typed });
    input.dispatchEvent(new Event('input', { bubbles: true })); // form-guard sees the change
    close();
    if (opts.onPick) opts.onPick(choice); // a field that acts on a choice (the notes palette's card picker) hears it here
  };
  // Focus always shows the FULL list (the text is pre-selected, so typing
  // replaces it) — filtering only applies while typing. A stale value that
  // matches nothing (e.g. an unregistered assignee on an old card) must not
  // leave the menu empty on click.
  //
  // opts.preFiltered opts a caller OUT of the comboboxSuggestions
  // re-filter pass — for the search box, getOptions() (searchSuggestionItems)
  // already IS the filter: it generates candidates fresh from the segment
  // being typed rather than filtering a static vocabulary, so re-filtering
  // its own output by substring-of-the-WHOLE-input would wrongly drop every
  // scoped candidate as soon as the box holds more than one term (their
  // `value` embeds the untouched earlier terms, which no longer appear
  // verbatim inside the newly-scoped tail). The form's own fields (priority/
  // assignee/tags/type) don't pass this.
  const open = (filtered) => {
    items = (filtered && !opts.preFiltered) ? comboboxSuggestions(getOptions(), input.value, opts) : getOptions();
    if (!items.length) return close();
    highlightIndex = -1; // every (re)open starts with nothing highlighted, including re-filters mid-typing
    menu.replaceChildren(...items.map((o) => {
      const el = document.createElement('div');
      el.className = 'combobox-item';
      el.textContent = o.label || o.value;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus in the input
        pick(o);
      });
      return el;
    }));
    menu.hidden = false;
  };
  let typed = false; // has the user typed since the menu opened?
  // opts.selectOnFocus (default true, the form
  // fields' behavior) — the search box holds a multi-term query, not one replaceable
  // value, so select-all-on-focus would arm every next keystroke to wipe the
  // whole thing. It also opens with nothing (open(false) → getOptions() → []
  // for an empty/untyped segment, see searchSuggestionItems), so skipping
  // the select is silent for the common empty-box case and only matters once
  // there's a query already in the box.
  input.addEventListener('focus', () => {
    typed = false;
    if (opts.selectOnFocus !== false) input.select();
    open(false);
  });
  input.addEventListener('input', (e) => { if (e.isTrusted) { typed = true; open(true); } });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { close(); e.preventDefault(); e.stopPropagation(); return; } // preventDefault: a search field's own Esc would clear it too
    if (menu.hidden) return; // closed menu: Enter/Arrows are the form's or the browser's business, not ours
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // don't let the browser hunt for another focusable element
      setHighlight(nextHighlightIndex(items.length, highlightIndex, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter') {
      if (e.altKey) return; // Alt+Enter belongs to the fullscreen hotkey, never a pick
      // Enter falls through to the form's
      // native submit ONLY when the menu is closed — an open menu must always
      // consume it, never just the highlighted case. Otherwise, typing to
      // re-filter after an Arrow-highlight (open() resets highlightIndex to
      // -1 on every re-filter) would let Enter silently reach the form instead
      // of picking. Minimal create is unaffected: a mouse pick already closes
      // the menu (mousedown fires before Enter), and the plain title-only
      // flow never opens the assignee menu at all.
      e.preventDefault();
      if (highlightIndex >= 0) pick(items[highlightIndex]);
      else close(); // nothing highlighted — accept the typed text and close; a second Enter then submits, menu now closed
    }
  });
}

attachCombobox($('#f-priority'), () => (state.priorities.length ? state.priorities : DEFAULT_PRIORITIES).map((v) => ({ value: v })));
attachCombobox($('#f-assignee'), () => state.assignees.map((a) => ({
  value: a.handle, // stored value stays the bare handle — no card migration
  label: `${a.handle}${a.name ? ` — ${a.name}` : ''}${a.kind ? ` (${a.kind})` : ''}`,
})));
attachCombobox($('#f-type'), () => state.types.map((t) => ({ value: t.name })));
attachCombobox($('#f-tags'), () => state.tags.map((v) => ({ value: v })), { tagMode: true });

// --- Date-picker popover: every date field (f-start/f-end/f-due)
// pairs its free-text input with a 📅 button that opens a hand-rolled month
// grid. Native <input type="date"> is off the table for the same reason as
// <datalist>: native widgets misrender inside VSCode's Simple
// Browser. Manual typing stays fully legal — the picker only ever writes
// values the free-text contract already allows (pickDay reuses shiftValue, so
// a typed time tail survives a pick). The pure rules (pickDay/initialMonth)
// live in date-picker.js; month math is calendar-model.js's. The popover
// carries a 🕒 clock toggle: ON reveals a hand-rolled HH:MM text
// control and writes a THH:MM tail (hasTime/withTime/withoutTime, also in
// date-picker.js); OFF strips it back to a bare day. Picking a day still
// preserves whatever tail is already there.
//
// ONE popover instance serves all fields (the combobox-menu discipline of one
// menu per anchor doesn't fit here — the grid is heavy, and only one can be
// open anyway), rendered into document.body with position:fixed computed from
// the button's getBoundingClientRect. NOT absolutely positioned inside the
// field's label like the combobox menus: the form modal is overflow:auto
// (.modal), so anything positioned inside it gets clipped at the modal edge
// and dragged along mid-scroll — fixed-in-body escapes every overflow context
// (nothing above body carries a transform/filter, the same reasoning that
// lets .modal.fullscreen position against the real viewport).

let datePickerFor = null;    // the <input> the popover is open for; null = closed
let datePickerAnchor = null; // the 📅 button that opened it (positioning anchor)
let datePickerMonth = null;  // { year, monthIndex } — per-opening nav state, lives in JS only

function datePickerPop() {
  let pop = document.querySelector('.date-picker-pop');
  if (pop) return pop;
  pop = document.createElement('div');
  pop.className = 'date-picker-pop';
  pop.dataset.keepsSelection = '';
  pop.hidden = true;
  // One delegated listener outlives every re-render (renderDatePicker swaps
  // the children on each nav click) — same discipline as #calendar-view's.
  pop.addEventListener('click', (e) => {
    // Everything inside the popover is popover business: stop here so the
    // document outside-closer and the click-away rule never see these clicks. Critically, a
    // nav click re-renders via replaceChildren, DETACHING the clicked button
    // mid-dispatch — a detached target makes closest('.date-picker-pop')
    // return null downstream, which closed the popover on every nav press.
    e.stopPropagation();
    const nav = e.target.closest('.dp-nav');
    if (nav) {
      // type=button AND outside the form (the popover lives in body), so a
      // nav click can never submit the card form.
      datePickerMonth = nav.dataset.dp === 'today'
        ? initialMonth('', localTodayStr())
        : shiftMonth(datePickerMonth.year, datePickerMonth.monthIndex, Number(nav.dataset.dp));
      renderDatePicker();
      return;
    }
    // The clock toggle. ON attaches DEFAULT_TIME (or whatever tail
    // is already there — can't happen since the button only shows "add" when
    // hasTime is false, but withTime's replace semantics make this safe
    // either way); OFF strips back to the bare day. Re-renders in place
    // (doesn't close the popover) so the day grid stays open for further
    // picking. Disabled buttons never dispatch click, but the flag is
    // checked anyway — defensive, matches the nav/day guards above.
    const clockBtn = e.target.closest('.dp-clock-toggle');
    if (clockBtn && datePickerFor && !clockBtn.disabled) {
      const input = datePickerFor;
      input.value = hasTime(input.value) ? withoutTime(input.value) : withTime(input.value, DEFAULT_TIME);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      renderDatePicker();
      const timeInput = pop.querySelector('.dp-time-input');
      if (timeInput) { timeInput.focus(); timeInput.select(); } // just revealed — let the user type straight over the default
      return;
    }
    const dayBtn = e.target.closest('.dp-day');
    if (dayBtn && datePickerFor) {
      const input = datePickerFor;
      input.value = pickDay(input.value, dayBtn.dataset.day);
      // bubbling like a real keystroke: the dirty guard's snapshot diff and
      // any other 'input' listeners must see the picker's write
      input.dispatchEvent(new Event('input', { bubbles: true }));
      closeDatePicker();
      input.focus();
    }
  });
  // Live-updates the field's time tail as the hand-rolled HH:MM text control
  // is typed into — separate from the click listener above because typing
  // fires 'input', not 'click'. Deliberately does NOT call renderDatePicker():
  // a mid-typing re-render would replaceChildren the very node being typed
  // into and drop focus/cursor position (the click handlers above don't have
  // this problem — they don't touch a control the user is still composing
  // text in).
  pop.addEventListener('input', (e) => {
    const timeInput = e.target.closest('.dp-time-input');
    if (!timeInput || !datePickerFor) return;
    const input = datePickerFor;
    input.value = withTime(input.value, timeInput.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.body.appendChild(pop);
  return pop;
}

function closeDatePicker() {
  if (!datePickerFor) return;
  datePickerFor = null;
  datePickerAnchor = null;
  datePickerPop().hidden = true;
}

function openDatePicker(input, btn) {
  datePickerFor = input;
  datePickerAnchor = btn;
  datePickerMonth = initialMonth(input.value, localTodayStr());
  renderDatePicker();
}

function renderDatePicker() {
  const pop = datePickerPop();
  const { year, monthIndex } = datePickerMonth;
  const controls = document.createElement('div');
  controls.className = 'date-picker-controls';
  controls.innerHTML =
    `<button type="button" class="dp-nav" data-dp="-1" title="Previous month" aria-label="Previous month">&#8249;</button>` +
    `<button type="button" class="dp-nav" data-dp="today" title="Jump back to the current month">Today</button>` +
    `<button type="button" class="dp-nav" data-dp="1" title="Next month" aria-label="Next month">&#8250;</button>` +
    `<span class="date-picker-title">${escapeHtml(monthTitle(year, monthIndex))}</span>`;
  const grid = document.createElement('div');
  grid.className = 'date-picker-grid';
  for (const dow of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) { // Monday-first, same as monthGrid/the calendar view
    const h = document.createElement('div');
    h.className = 'dp-dow';
    h.textContent = dow;
    grid.appendChild(h);
  }
  const today = localTodayStr();
  const currentDay = dayPart(datePickerFor.value); // '' when the field is empty/garbage — then nothing is marked selected
  for (const cell of monthGrid(year, monthIndex)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dp-day' + (cell.inMonth ? '' : ' outside') +
      (cell.date === today ? ' today' : '') + (currentDay && cell.date === currentDay ? ' selected' : '');
    b.dataset.day = cell.date;
    b.textContent = cell.day;
    b.title = cell.date;
    grid.appendChild(b);
  }
  // Clock toggle + HH:MM control. State is DERIVED from the
  // field's value on every render (same discipline as `currentDay`/selected
  // above) — no separate ON/OFF flag that could fall out of sync with what's
  // actually in the input. Disabled when there's no parseable day: "add a
  // time to the date" presupposes a date already exists (the button stays
  // greyed out until one does, same disabled-control idiom the bulk
  // schedule row uses for its 📅 button). No native <input type="time"> —
  // ADR 0003's rationale (native popups misplace themselves in Simple
  // Browser) applies just as much to time as to date, so this reuses the
  // exact plain-text-input style the date fields themselves already use:
  // free text, never validated, from the same free-text date contract.
  const timeRow = document.createElement('div');
  timeRow.className = 'date-picker-time';
  const timeOn = hasTime(datePickerFor.value);
  const clockBtn = document.createElement('button');
  clockBtn.type = 'button';
  clockBtn.className = 'dp-clock-toggle' + (timeOn ? ' on' : '');
  clockBtn.disabled = !currentDay;
  clockBtn.textContent = '🕒';
  clockBtn.title = timeOn ? 'Remove time' : 'Add a time';
  clockBtn.setAttribute('aria-label', clockBtn.title);
  clockBtn.setAttribute('aria-pressed', String(timeOn));
  timeRow.appendChild(clockBtn);
  if (timeOn) {
    const timeInput = document.createElement('input');
    timeInput.type = 'text';
    timeInput.className = 'dp-time-input';
    timeInput.placeholder = 'HH:MM';
    timeInput.setAttribute('aria-label', 'Time');
    timeInput.value = timePart(datePickerFor.value); // set via property, not an HTML string — no escaping needed
    timeRow.appendChild(timeInput);
  }
  if (datePickerFor.hasAttribute('data-date-only')) pop.replaceChildren(controls, grid);
  else pop.replaceChildren(controls, grid, timeRow);
  pop.hidden = false;
  positionDatePicker();
}

// Fixed positioning from the anchor button's viewport rect: below it by
// default, flipped above when the grid wouldn't fit under (the date row sits
// low in the form), clamped to the viewport's horizontal edges. Measured
// AFTER render/unhide so offsetWidth/Height are real (5- vs 6-week months
// differ in height).
function positionDatePicker() {
  const pop = datePickerPop();
  const r = datePickerAnchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8));
  const below = r.bottom + 4;
  const top = (below + pop.offsetHeight > window.innerHeight && r.top - pop.offsetHeight - 4 > 0)
    ? r.top - pop.offsetHeight - 4 : below;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

// Toggle: same button closes; a different field's button MOVES the one
// popover there (openDatePicker re-derives month + selection per opening).
// A field marked data-date-only (the group forms: a group's dates are days)
// gets the grid without the clock row. Forms built after load (groups-ui.js)
// wire their own buttons through here.
function wireDatePickButton(btn, input) {
  btn.addEventListener('click', () => {
    if (datePickerFor === input) closeDatePicker();
    else openDatePicker(input, btn);
  });
}

document.querySelectorAll('.date-pick-btn').forEach((btn) => {
  wireDatePickButton(btn, document.getElementById(btn.dataset.dateInput));
});

// Clicking anywhere outside closes it. The popover's own clicks and the 📅
// buttons are skipped — the buttons manage their own toggle/move above (this
// bubble listener also fires for the opening click; without the skip it
// would close what that click just opened).
document.addEventListener('click', (e) => {
  if (!datePickerFor) return;
  if (e.target.closest('.date-picker-pop, .date-pick-btn')) return;
  closeDatePicker();
});

// Esc closes the picker and ONLY the picker — the combobox Esc rule. Capture
// phase so this runs before the document-level bubble Esc handler (popup
// close / search clear) no matter where focus sits (input, 📅 button, or a popover
// button), and stopPropagation keeps that handler from also firing on the
// same press.
document.addEventListener('keydown', (e) => { // key-guard: exempt (acts only while the date picker is open, which Esc closes from its field)
  if (e.key !== 'Escape' || !datePickerFor) return;
  const input = datePickerFor;
  closeDatePicker();
  input.focus();
  e.stopPropagation();
}, true);

// position:fixed goes stale the moment the anchor moves under it: close on
// window resize (the context menu's rule) and on any scroll — capture phase
// because the form modal's overflow:auto scroll doesn't bubble to window.
window.addEventListener('resize', closeDatePicker);
document.addEventListener('scroll', closeDatePicker, true);

// Text-selection guard scoped to the gesture: tiles are only
// unselectable while shift is actually held, so their text stays copyable the
// rest of the time. blur clears the class in case keyup lands off-window.
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') document.body.classList.add('shift-held'); }); // key-guard: exempt (sets a class and acts on nothing)
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') document.body.classList.remove('shift-held'); }); // key-guard: exempt (clears a class and acts on nothing)
window.addEventListener('blur', () => document.body.classList.remove('shift-held'));
