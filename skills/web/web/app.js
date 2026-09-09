'use strict';
const state = { active: [], archived: [], projectName: '', boardDir: '', notifications: [], priorities: [], tags: [], statuses: [], assignees: [], archivePackages: [] }; // assignees seeded empty — renderBoard's Assignee sort reads it before the first /api/board response lands. boardDir seeded empty — copyBoardPath toasts honestly on a pre-first-poll click.

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
  mapStatusFilter = null; // keyed by the same column set
  ganttStatusFilter = null; // keyed by the LIVE statuses (no archive), same invalidation rule
  calendarStatusFilter = null; // same LIVE-statuses key as the gantt's
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

function loadColumnSort() {
  if (columnSort) return columnSort;
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey(state.projectName, 'columns.sort'));
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to defaults
  columnSort = mergeSortState(saved, boardColumnIds()); // merge against the board's current column set
  return columnSort;
}

function saveColumnSort() {
  try { localStorage.setItem(storageKey(state.projectName, 'columns.sort'), JSON.stringify(columnSort)); }
  catch (e) { /* storage unavailable/full — sort choice just won't persist this session */ }
}

// Changing the field resets direction to that field's natural default
// (id/due -> asc, priority -> desc/High-first, modified -> desc/newest-first,
// assignee -> asc/registry-order) rather than keeping whatever
// direction the previous field happened to be on.
function setColumnSortField(col, field) {
  if (!SORT_FIELDS.includes(field)) return;
  const sort = loadColumnSort();
  sort[col] = { field, direction: DEFAULT_SORT_DIRECTION[field] };
  saveColumnSort();
  renderBoard();
}

function toggleColumnSortDirection(col) {
  const sort = loadColumnSort();
  const current = sort[col];
  sort[col] = { field: current.field, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  saveColumnSort();
  renderBoard();
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
// the "No dependencies" list). column-state.js's MAP_SECTIONS/mergeMapSectionsCollapsed
// own the fixed two-key shape (not a dynamic column set, unlike collapse/sort/
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
  } catch (e) { saved = null; } // corrupt/inaccessible storage — fall back to both expanded
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

// Registry mapping a modal type (matches modal-fullscreen.js's MODAL_TYPES)
// to its DOM handles. Following the .modal-backdrop convention here (rather
// than hardcoding two call sites) lets a future popup
// get fullscreen "mostly free": it only
// needs an entry here plus a toggle button of its own.
const FULLSCREEN_MODALS = {
  edit: { backdrop: '#modal', btn: '#modal-fullscreen-btn' },
  detail: { backdrop: '#detail-modal', btn: '#detail-fullscreen-btn' },
  bulkSingle: { backdrop: '#bulk-single', btn: '#bulk-single-fullscreen-btn' },
  bulkTags: { backdrop: '#bulk-tags', btn: '#bulk-tags-fullscreen-btn' },
  bulkSchedule: { backdrop: '#bulk-schedule', btn: '#bulk-schedule-fullscreen-btn' },
};

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
  const backdrop = $(cfg.backdrop);
  const btn = $(cfg.btn);
  const panel = backdrop && backdrop.querySelector('.modal');
  if (!panel || !btn) return;
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
  if (!(type in fs)) return;
  fs[type] = !fs[type];
  saveModalFullscreen();
  applyModalFullscreen(type);
}

// The fullscreen-capable popup currently open, if any (the Alt+Enter
// hotkey needs a target). At most one .modal-backdrop is ever visible at a
// time, so first match wins; the notifications popup isn't in the registry
// and correctly yields null.
function openFullscreenModalType() {
  for (const type of Object.keys(FULLSCREEN_MODALS)) {
    const backdrop = $(FULLSCREEN_MODALS[type].backdrop);
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

// assigneeBadge/escapeHtml come from assignee-badge.js (bare globals, same
// dual-environment pattern as refresh-policy.js/column-state.js).
// Every card-representing element in every view carries `card-el` +
// data-id — the shared contract the document-level click/contextmenu grammar
// handlers key on (see the multi-select section).
function cardEl(card) {
  const el = document.createElement('div');
  const pb = priorityBadge(card, state.priorities); // emphasis by rank in the configured list, label pre-escaped
  // epic is a class (`.card.epic`, app.css), not a dot glyph
  // — circles are reserved for status alone, so
  // priority/blocked/column membership need no gating around it.
  // Archived tiles never call cardEl at all (archiveCardEl is a
  // separate function without this class), so an archived epic
  // shows no epic cue on the board.
  // statusBadge() joins it unconditionally (every card has a
  // status; unlike epic there's no absent case) — status is already implied
  // by column placement here, but the dot renders on every surface
  // regardless, so board tiles get it too, same helper as everywhere else.
  el.className = 'card card-el' + (pb.className ? ` ${pb.className}` : '') + (isWaiting(card) ? ' waiting' : '') + (card.epic ? ' epic' : '') + (selectedIds.has(card.id) ? ' selected' : '');
  el.draggable = true;
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
  // The schedule key (same precedence the Due date sort uses) top-right —
  // escaped: date fields are free text by contract, never trust them in HTML.
  const sched = scheduleLabel(card, localTodayStr());
  // isOverdue (column-sort.js) already gates on due_date/status/archived —
  // an overdue card is by construction a due-date card, so this only ever
  // adds to the ⚑ chip sched already produced, never fires on its own.
  const overdue = isOverdue(card, localTodayStr());
  // A card with no title yet but a queued prompt (an
  // AI-dispatched card waiting on kanban-afk to name it) shows the sparkle +
  // prompt text in the title's own spot — a temporary stand-in, never a
  // permanent glyph, gone the moment a real title lands. card-title.js's
  // cardTitleDisplay is the pure decision; the prompt text is user data like
  // any other card field, so it's escaped exactly like card.title would be.
  const titleDisplay = cardTitleDisplay(card);
  const titleHtml = titleDisplay.isPromptFallback
    ? `${AI_PROMPT_ICON}${escapeHtml(titleDisplay.text)}`
    : escapeHtml(card.title);
  el.innerHTML =
    `<div class="card-head"><span class="card-id">#${card.id}${pb.label ? ` ${pb.label}` : ''}</span>${statusBadge(card)}${statusChip}${assigneeBadge(card, state.assignees)}${sched ? `<span class="card-schedule${overdue ? ' overdue' : ''}"${overdue ? ' title="Past due"' : ''}>${escapeHtml(sched)}</span>` : ''}</div>` +
    `<div class="card-title${titleDisplay.isPromptFallback ? ' card-title--prompt-fallback' : ''}">${titleHtml}</div>` +
    (tags ? `<div class="card-tags">${tags}</div>` : '') + waiting;
  paintAssigneeColors(el); // reserved custom colors need a CSSOM pass, see helper
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
  return el;
}

// Archived tiles, inline in the Archive column: no drag, no Edit/Archive actions (an
// already-archived card 404-ing on re-archive is exactly what the idempotency
// guard on the server exists for, but there's no reason to invite it from the
// UI) — Restore/Delete stay reachable as tile buttons.
// The board's Archive column never carries the epic cue — its
// call site below passes no second argument. But this same function also
// renders archived tiles in the map's isolated row (buildIsolatedRow), and
// there epic is a durable identity that must keep showing even off the
// layered graph (same as the SVG node's own epic wash) — so `opts.epicDot`
// is an explicit opt-in for that one caller, rather than a blanket change
// that would put the cue back on the Archive column too.
// statusBadge(card) needs no opts gate here — it colors straight
// off the card's true status regardless of card.archived (status
// dots never mute), so the SAME call is correct whether this renders
// in the Archive column or the map's isolated row: "board tiles (live AND
// archived)" gets the dot always, true color always.
// archivedBadge() joins right after statusBadge(),
// same unconditional-no-opts-gate reasoning — archiveCardEl only ever
// renders an archived card (both call sites below pass one), so unlike the
// epic class's opt-in flag, the archived ball needs no gate either. Glyph
// order everywhere it appears: epic (a background wash),
// status, archived.
function archiveCardEl(card, opts) {
  const showEpic = !!(opts && opts.epicDot);
  const el = document.createElement('div');
  el.className = 'card card-el archived-card' + (showEpic && card.epic ? ' epic' : '') + (selectedIds.has(card.id) ? ' selected' : '');
  el.draggable = true; // drag out of Archive restores to the drop column
  el.dataset.id = card.id;
  const sched = scheduleLabel(card, localTodayStr());
  // Same empty-title-shows-the-prompt fallback as the board
  // tile — reused verbatim via cardTitleDisplay
  // (card-title.js), never re-derived here.
  const titleDisplay = cardTitleDisplay(card);
  const titleHtml = titleDisplay.isPromptFallback
    ? `${AI_PROMPT_ICON}${escapeHtml(titleDisplay.text)}`
    : escapeHtml(card.title);
  el.innerHTML =
    `<div class="card-head"><span class="card-id">#${card.id}</span>${statusBadge(card)}${archivedBadge()}${assigneeBadge(card, state.assignees)}${sched ? `<span class="card-schedule">${escapeHtml(sched)}</span>` : ''}</div>` +
    `<div class="card-title${titleDisplay.isPromptFallback ? ' card-title--prompt-fallback' : ''}">${titleHtml}</div>` +
    `<div class="card-menu">` +
      `<button type="button" data-act="restore" data-id="${card.id}">Restore</button>` +
      `<button type="button" data-act="delete-arch" data-id="${card.id}">Delete</button>` +
    `</div>`;
  paintAssigneeColors(el); // reserved custom colors need a CSSOM pass, see helper
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
  return parseSearchQuery(input ? input.value : '');
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

// Each header toggle flips between its own view and the board: map ⇄ board,
// calendar ⇄ board — and pressing one while the OTHER view is active jumps
// straight to the pressed view (no board stopover).
function toggleView(mode) {
  viewMode = loadViewMode() === mode ? 'board' : mode;
  saveViewMode();
  renderBoard();
}

// One mode→container map for everything that needs "which element hosts
// this view" — applyViewMode's hide/show and visibleCardIds' range scope
// — so a fifth view is one entry here, not two edits.
const VIEW_CONTAINERS = { board: '#board', map: '#map-view', calendar: '#calendar-view', gantt: '#gantt-view' };

function applyViewMode() {
  const mode = loadViewMode();
  for (const [m, sel] of Object.entries(VIEW_CONTAINERS)) $(sel).classList.toggle('hidden', mode !== m);
  const mapBtn = $('#map-toggle-btn');
  mapBtn.textContent = mode === 'map' ? '☰ Board view' : '🕸 Map view';
  mapBtn.setAttribute('aria-pressed', String(mode === 'map'));
  const calBtn = $('#calendar-toggle-btn');
  calBtn.textContent = mode === 'calendar' ? '☰ Board view' : '📅 Calendar';
  calBtn.setAttribute('aria-pressed', String(mode === 'calendar'));
  const ganttBtn = $('#gantt-toggle-btn');
  ganttBtn.textContent = mode === 'gantt' ? '☰ Board view' : '📊 Gantt';
  ganttBtn.setAttribute('aria-pressed', String(mode === 'gantt'));
  if (mode === 'map') renderMapView();
  if (mode === 'calendar') renderCalendarView();
  if (mode === 'gantt') renderGanttView();
}

function renderBoard() {
  renderBoardColumns();
  applyViewMode();
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
  const searchTerms = currentSearchTerms();
  const searchActive = searchTerms.length > 0;
  const clearBtn = $('#search-clear-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !searchActive);
  // tree:/path: terms need the FULL active+archived graph to
  // resolve connectivity — resolving per column (a pre-sliced subset) would
  // see almost no edges. Mirrors renderMapView/renderCalendar*/renderGantt's
  // own "resolve searchIds once against the full board" pattern: compute the
  // matching id set ONCE here, then each column below intersects against it
  // by id rather than re-calling filterCards on its own slice.
  const searchIds = searchActive
    ? new Set(filterCards(state.active.concat(state.archived), searchTerms).map((c) => c.id)) : null;
  // Columns render FROM the configured statuses list (+ archive at
  // the far right). A card whose status isn't listed renders in the FIRST
  // column via columnForStatus — the catch-all — with cardEl's raw-status chip.
  const statuses = boardStatuses();
  for (const col of boardColumnIds()) {
    const isArchive = col === 'archive';
    const source = isArchive ? state.archived : state.active.filter((c) => columnForStatus(c.status, statuses) === col);
    const sortState = colSort[col];
    // The Assignee sort ranks by registry order, so the comparator
    // gets the config.yaml handles — plumbed exactly like priorities above.
    const allCards = sortCards(source, sortState, state.priorities, state.assignees.map((a) => a.handle));
    const cards = searchActive ? allCards.filter((c) => searchIds.has(c.id)) : allCards;
    const isCollapsed = !!collapsed[col];
    const label = columnLabel(col);
    // Counts stay truthful whether or not the column is collapsed — column-count
    // renders in both states, so a collapsed column with hits signals them on its
    // strip with no extra branching.
    const countLabel = searchActive ? `${cards.length}/${allCards.length}` : `${allCards.length}`;
    const colEl = document.createElement('div');
    // col-<name> only for css-safe names (the built-in five have color rules;
    // a custom name's rule wouldn't exist anyway — its color is inline below).
    const colClass = /^[a-zA-Z0-9_-]+$/.test(col) ? ` col-${col}` : '';
    colEl.className = `column${colClass}` +
      (isCollapsed ? ' collapsed' : '') +
      (isArchive ? ' archive-column' : '') +
      (searchActive && cards.length > 0 ? ' search-match' : '');
    colEl.dataset.col = col;
    colEl.title = label; // native tooltip; matters most while collapsed
    // Sort controls share the header with the collapse toggle —
    // hidden entirely while collapsed (no card list visible to sort, and no
    // room in the narrow strip), so the two never fight for space. The
    // dropdown's selected option and the direction glyph both reflect the
    // persisted per-column state, so a re-render (poll/drag/toggle/search)
    // never visually resets the control out from under the user.
    const sortControls = isCollapsed ? '' :
      `<select class="column-sort-field" data-col="${escapeHtml(col)}" ` +
        `aria-label="Sort ${escapeHtml(label)} column by" title="Sort by">` +
        SORT_FIELDS.map((f) =>
          `<option value="${f}"${sortState.field === f ? ' selected' : ''}>${escapeHtml(SORT_FIELD_LABELS[f])}</option>`
        ).join('') +
      `</select>` +
      `<button type="button" class="column-sort-dir" data-col="${escapeHtml(col)}" ` +
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
          `<button type="button" class="column-add" data-col="${escapeHtml(col)}" ` +
            `aria-label="New card in ${escapeHtml(label)}" title="New card in ${escapeHtml(label)}">+</button>` +
          `<button type="button" class="column-add-ai" data-col="${escapeHtml(col)}" ` +
            `aria-label="New AI-prompt card in ${escapeHtml(label)}" title="New card in ${escapeHtml(label)} with AI prompt enabled">${AI_PROMPT_ICON}</button>` : '') +
      `</div>`;
    // Custom columns get their deterministic hashed color inline
    // (there is no CSS rule for them); the built-in four keep their exact
    // .col-<name> CSS palette, archive keeps its neutral header.
    if (!isArchive && !isBuiltinStatus(col)) colEl.querySelector('.column-header').style.color = statusColor(col);
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
  wireDrag();
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
// to spare — see buildMapSvg's statusDot/archivedDot. The epic cue is a
// background wash, not a third dot, so status+archived alone don't strictly
// need the extra room, but there's no harm in the node staying this size,
// and shrinking it would ripple
// into every other pinned map-layout measurement for no visual gain.
const MAP_NODE_H = 58;
const MAP_GAP_X = 24;
const MAP_GAP_Y = 60;
const MAP_PAD = 24;
const MAP_STATUSES = ['backlog', 'todo', 'doing', 'done'];

function mapStatusClass(status) {
  const s = (status || '').toLowerCase();
  return MAP_STATUSES.includes(s) ? s : 'unknown';
}

function truncateLabel(s, max) {
  const str = String(s || '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function renderMapView() {
  const container = $('#map-view');
  // Selection toggles re-render — don't dump the user's scroll position
  // (same fix class as the gantt timeline's keepScrollLeft).
  const keepLeft = container.scrollLeft, keepTop = container.scrollTop;
  container.innerHTML = '';
  const allCards = state.active.concat(state.archived);
  // The status-filter row renders first and UNCONDITIONALLY — if it
  // vanished with the graph on the everything-filtered-out state, there'd be
  // no control left to toggle a status back ON.
  container.appendChild(buildMapFilterRow());
  const searchTerms = currentSearchTerms();
  const searchIds = searchTerms.length ? new Set(filterCards(allCards, searchTerms).map((c) => c.id)) : null;
  // Status filter composes with search by INTERSECTION — a card is
  // visible only if BOTH say so, and buildDependencyGraph sees one combined
  // visibleIds so the ghost-stub semantics stay EXACTLY the search filter's,
  // for free. The rule (incl. either side's null "not filtering" pass-through)
  // is column-state.js's intersectVisibleIds — pure and unit-pinned, not glue.
  const statusIds = mapFilterVisibleIds(allCards, loadMapStatusFilter(), state.statuses);
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const graph = buildDependencyGraph(allCards, visibleIds);

  if (!graph.nodes.length && !graph.ghosts.length) {
    const empty = document.createElement('div');
    empty.className = 'map-empty';
    empty.textContent = 'No cards match the current search/status filters.';
    container.appendChild(empty);
    return;
  }

  // Each section's collapse state persists per board (memoize-once-
  // mutate-in-place, same as loadMapStatusFilter above), so it survives every
  // renderMapView() call — manual, poll, drag, toggle, search.
  const sections = loadMapSectionsCollapsed();
  // The graph lays out every node touched by ANY edge — dep or
  // epic membership — while graph.isolated stays dep-keyed; an epic whose only
  // edges are membership sits in BOTH: laid out in the graph AND listed
  // in the no-dependencies row. The two derivations (and
  // their different kind-keying) are buildDependencyGraph's own, unit-pinned.
  const participantIds = graph.participants;
  if (participantIds.length) container.appendChild(buildMapGraphSection(graph, participantIds, sections.graph));
  if (graph.isolated.length) container.appendChild(buildIsolatedRow(graph, allCards, sections.isolated));
  container.scrollLeft = keepLeft;
  container.scrollTop = keepTop;
}

// The status-filter pill row MECHANISM — one toggle per column,
// shared verbatim between the map and the gantt rather than each
// view duplicating the markup/build-loop. Only the filter state, the id list,
// the row/pill class (so each view's own delegated listener and its own
// poll-guard/Q0-exemption selector keep targeting just their own pills), and
// the tooltip wording differ per caller. The look itself is ALSO shared, not
// duplicated — app.css comma-joins the two views' pill classes onto one
// declaration each. Border color comes from statusColor() for EVERY pill —
// built-in, custom (their hashed hue; no CSS rule exists, same reasoning as
// the column headers), and archive's neutral grey where the map's
// row includes it.
//
// The right-click SOLO/viceversa grammar rides here too — one
// line appended to every caller's tooltip (rather than repeating it in each
// titleFor closure) since the gesture is otherwise invisible; the per-view
// contextmenu wiring lives with each view's own click delegate.
function buildFilterPillRow(filter, columnIds, rowClass, pillClass, titleFor) {
  const row = document.createElement('div');
  row.className = rowClass;
  for (const col of columnIds) {
    const on = filter[col] !== false;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = pillClass + (on ? '' : ' off');
    btn.dataset.col = col;
    btn.setAttribute('aria-pressed', String(on));
    btn.title = titleFor(col, on) + ' Right-click to solo (right-click the soloed pill again to restore all).';
    btn.style.borderColor = statusColor(col);
    btn.textContent = columnLabel(col);
    row.appendChild(btn);
  }
  return row;
}

// One pill per board column in column order (statuses + Archive:
// the map always includes archived cards, so the location pseudo-column is
// always offered). Rebuilt by every renderMapView() call like the rest of
// #map-view; state lives in the memoized mapStatusFilter, so the row never
// visually resets across the 5s poll. Clicks ride #map-view's delegated
// listener (see the map wiring section).
function buildMapFilterRow() {
  const row = buildFilterPillRow(loadMapStatusFilter(), boardColumnIds(), 'map-filter-row', 'map-filter-toggle',
    (col, on) => `${on ? 'Hide' : 'Show'} ${columnLabel(col)} cards on the map (hidden cards ghost when a visible card references them)`);
  // The "Epics" tap-chip rides in the same control row,
  // map-view only (buildGanttFilterRow/buildCalendarFilterRow below never
  // call this) — see buildEpicFilterChip.
  row.appendChild(buildEpicFilterChip());
  return row;
}

// Mobile-first shortcut for the map's `epic:` search term
// — same "write straight into #search-input, then renderBoard()"
// pattern as focusOn()'s tree:/path: buttons and addSearchTerm's
// assignee/tag click, but a TOGGLE (tap sets `epic:`, tap again clears
// it) rather than focusOn's always-replace or addSearchTerm's idempotent-add,
// since this chip only ever manages the one term and composes with whatever
// else (status pills, other search terms) is already in the box.
function isEpicSearchActive() {
  const input = $('#search-input');
  const raw = input ? input.value : '';
  return raw.trim().split(/\s+/).some((tok) => /^epic:/i.test(tok));
}

function toggleEpicSearchTerm() {
  const input = $('#search-input');
  if (!input) return;
  const tokens = input.value.trim().split(/\s+/).filter(Boolean);
  const on = tokens.some((tok) => /^epic:/i.test(tok));
  const next = on ? tokens.filter((tok) => !/^epic:/i.test(tok)) : tokens.concat('epic:');
  input.value = next.join(' ');
  renderBoard();
}

// Rebuilt by every renderMapView() call, same as the status-filter row
// (buildFilterPillRow) — reads the search box fresh each time so its
// pressed/unpressed look never drifts from whatever's actually in the box
// (typed by hand, cleared, or toggled by this same chip).
function buildEpicFilterChip() {
  const on = isEpicSearchActive();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'map-epic-chip';
  btn.className = 'map-epic-chip' + (on ? ' on' : '');
  btn.setAttribute('aria-pressed', String(on));
  btn.title = on ? 'Clear the epic: search term' : 'Filter the map to epic-marked cards (writes epic: into the search box)';
  btn.textContent = 'Epics';
  return btn;
}

// Same mechanism, gantt-scoped — statuses + Archive (boardColumnIds(),
// same id list as the map's row; the Archive
// pseudo-pill defaults OFF — see loadGanttStatusFilter). No ghost
// wording either — the gantt has no dependency edges, so a filtered-out
// status just drops its group rows outright, and the rendered timeline
// window re-derives from whatever bars remain (may narrow). Archive gets its
// own tooltip: flipping it ON adds one more group, after the live status
// groups, for dated ARCHIVED cards (muted grey, same mute as everywhere
// else archive shows up). Rebuilt by every renderGanttView() call; clicks
// ride #gantt-view's own delegated listener (see wireGanttPointerDrag).
function buildGanttFilterRow() {
  return buildFilterPillRow(loadGanttStatusFilter(), boardColumnIds(), 'gantt-filter-row', 'gantt-filter-toggle',
    (col, on) => col === 'archive'
      ? `${on ? 'Hide' : 'Show'} archived cards on the timeline (dated archived cards render in their own Archive group, muted grey)`
      : `${on ? 'Hide' : 'Show'} ${columnLabel(col)} cards on the timeline (the visible window re-derives from what's left)`);
}

// Same mechanism again, calendar-scoped: statuses +
// Archive (boardColumnIds(), same id list as the gantt's row) — the calendar
// can show dated ARCHIVED cards too, opt-in, default OFF, same shape as
// the gantt's own Archive pill. Rebuilt by every renderCalendarView() call
// (month AND every sub-view share this one row); clicks ride
// #calendar-view's own delegated listener (see the calendar wiring section).
function buildCalendarFilterRow() {
  return buildFilterPillRow(loadCalendarStatusFilter(), boardColumnIds(), 'calendar-filter-row', 'calendar-filter-toggle',
    (col, on) => col === 'archive'
      ? `${on ? 'Hide' : 'Show'} archived cards on the calendar (dated archived cards render read-only, with the archived ball)`
      : `${on ? 'Hide' : 'Show'} ${columnLabel(col)} cards on the calendar`);
}

// The two collapsible map sections share this header shape — a
// chevron toggle (same CHEVRON_LEFT/RIGHT_ICON + .column-toggle look as the
// board's per-column collapse) plus a count label. data-section
// names which half of loadMapSectionsCollapsed() the click flips; the
// delegated #map-view listener (see the map wiring section) reads it.
function buildMapSectionHeader(section, label, collapsed) {
  const header = document.createElement('div');
  header.className = 'map-section-header';
  header.innerHTML =
    `<button type="button" class="map-section-toggle" data-section="${section}" ` +
      `aria-label="${collapsed ? 'Expand' : 'Collapse'} ${escapeHtml(label)}" aria-expanded="${!collapsed}">` +
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
function buildMapGraphSection(graph, participantIds, collapsed) {
  const wrap = document.createElement('div');
  wrap.className = 'map-graph-section';
  wrap.appendChild(buildMapSectionHeader('graph', `Dependency graph (${participantIds.length}):`, collapsed));
  if (!collapsed) {
    const layer = layerNodes(participantIds, graph.edges);
    wrap.appendChild(buildMapSvg(graph, layer));
  }
  return wrap;
}

// Isolated cards (no waiting_for edge in either direction) render as a
// detached row below the layered graph, never hidden behind a "show
// isolated" toggle: a toggle would be one more piece of UI
// state to persist/compose with view mode + search + sort + collapse, for a
// case (no dependencies at all) that's common on most boards and cheap to
// just always show. Reuses cardEl's board tile look so a card reads the same
// wherever it appears.
// The section IS collapsible, though —
// loadMapSectionsCollapsed's own state (not a fresh toggle-per-view) is what
// makes it cheap: one more merged boolean, not new persisted UI state design.
function buildIsolatedRow(graph, allCards, collapsed) {
  const byId = new Map(allCards.map((c) => [c.id, c]));
  const wrap = document.createElement('div');
  wrap.className = 'map-isolated';
  wrap.appendChild(buildMapSectionHeader('isolated', `No dependencies (${graph.isolated.length}):`, collapsed));
  if (!collapsed) {
    const row = document.createElement('div');
    row.className = 'map-isolated-row';
    graph.isolated.forEach((id) => {
      const card = byId.get(id);
      if (!card) return;
      // Opt in to the epic cue here — the map is the one place an
      // archived card appears outside the graph proper, and epic (unlike status)
      // isn't supposed to mute or disappear just because a card has no edges.
      // The cue is a background wash, not a dot; the
      // opt-in flag name carries it (internal option key only, no user-facing
      // meaning).
      const tile = card.archived ? archiveCardEl(card, { epicDot: true }) : cardEl(card);
      tile.draggable = false; // the map isn't a drag surface
      // cardEl/archiveCardEl already stamp card-el + data-id, so the
      // shared grammar handlers cover these tiles with no extra wiring.
      row.appendChild(tile);
    });
    wrap.appendChild(row);
  }
  return wrap;
}

// Builds the layered SVG: nodes positioned by layerNodes()'s layer assignment
// (top-down, one row per layer, left-to-right by id within a row), edges as
// arrowed paths (dep -> waiter — same direction as the
// kanban-cli skill's Mermaid `n<depId> --> n<id>` output, so
// the two views read the same graph the same way). A "back edge" (target
// layer <= source layer — only possible when layerNodes had to force-break a
// cycle) routes as a side-bowed curve instead of a straight line, so a cycle
// stays visually distinct rather than overlapping the normal downward flow.
function buildMapSvg(graph, layer) {
  const allById = new Map();
  graph.nodes.forEach((n) => allById.set(n.id, Object.assign({ ghost: false }, n)));
  graph.ghosts.forEach((g) => allById.set(g.id, Object.assign({ ghost: true }, g)));

  const layers = new Map(); // layerIndex -> [ids] sorted ascending
  for (const [id, l] of layer) {
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l).push(id);
  }
  for (const ids of layers.values()) ids.sort((a, b) => a - b);
  const numLayers = layers.size ? Math.max(...layers.keys()) + 1 : 0;

  const pos = new Map(); // id -> {x, y, cx}
  for (const [l, ids] of layers) {
    ids.forEach((id, i) => {
      const x = MAP_PAD + i * (MAP_NODE_W + MAP_GAP_X);
      const y = MAP_PAD + l * (MAP_NODE_H + MAP_GAP_Y);
      pos.set(id, { x, y, cx: x + MAP_NODE_W / 2 });
    });
  }

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
    const from = pos.get(e.from);
    const to = pos.get(e.to);
    if (!from || !to) return; // defensive: every edge endpoint is always laid out, but never let a mismatch crash the render
    const dimmed = e.fromGhost || e.toGhost;
    const backEdge = (layer.get(e.to) || 0) <= (layer.get(e.from) || 0);
    const x1 = from.cx, y1 = from.y + MAP_NODE_H, x2 = to.cx, y2 = to.y;
    let d;
    if (backEdge) {
      maxX = Math.max(maxX, x1 + BACK_EDGE_BOW, x2 + BACK_EDGE_BOW);
      d = `M${x1},${y1} C${x1 + BACK_EDGE_BOW},${y1} ${x2 + BACK_EDGE_BOW},${y2} ${x2},${y2}`;
    } else {
      const midY = (y1 + y2) / 2;
      d = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
    }
    // Membership edges (epic -> child) draw in the epic's own
    // channel — orange, dashed, its own arrowhead — so sequencing and
    // membership never read as the same relation. A cycle through a
    // membership edge still bows (backEdge is layout-derived), keeping the
    // epic dash over the back-edge amber: the KIND stays visible.
    const epicEdge = e.kind === 'epic';
    // v3: an intra-epic dep edge (epicChain) draws SOLID orange — a real,
    // gate-enforced dependency tinted to show whose work it carries; the
    // dashed orange stays reserved for the terminal's membership hop. Both
    // take the orange arrowhead (a grey head on an orange line reads broken).
    const chainEdge = !!e.epicChain;
    edgesSvg += `<path class="map-edge${epicEdge ? ' epic-edge' : ''}${chainEdge ? ' epic-chain' : ''}${backEdge ? ' back-edge' : ''}${dimmed ? ' ghost-edge' : ''}" d="${d}" marker-end="url(#${(epicEdge || chainEdge) ? 'map-arrow-epic' : 'map-arrow'})"></path>`;
  });

  const width = maxX + MAP_PAD;
  const height = Math.max(MAP_NODE_H + MAP_PAD * 2, numLayers * (MAP_NODE_H + MAP_GAP_Y) - MAP_GAP_Y + MAP_PAD * 2);

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
    // .map-node rect in app.css) — status (its own dot) and epic (its own
    // background wash) never fight over that single stroke
    // channel with each other or with archive.
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
    // epic rides the group class too — .map-node.epic rect (app.css)
    // tints the node's fill; no separate <circle>. Gated
    // on n.epic alone (never true for a missing stub — dependency-
    // graph.js's stub shape has no epic field), it keeps showing on an
    // archived node (a durable identity, not a location).
    const cls = `map-node${n.ghost ? ' ghost' : ''}${missing ? ' missing' : ''}${n.archived ? ' archived' : ''}` +
      `${pb.className ? ` ${pb.className}` : ''}${(!missing && !n.archived && n.waiting) ? ' waiting' : ''}${n.epic ? ' epic' : ''}` +
      `${selectable ? ' card-el' : ''}${selectable && selectedIds.has(id) ? ' selected' : ''}`;
    const idLabel = `#${id}`;
    // Same empty-title-shows-the-prompt fallback every
    // other view uses (cardTitleDisplay, card-title.js) — n already carries
    // `prompt` (dependency-graph.js's cardToNode). A missing stub has no
    // card behind it at all, so it keeps its own '(not found)' text instead.
    const titleDisplay = cardTitleDisplay(n);
    const titleLine = missing ? '(not found)' : truncateLabel(titleDisplay.text, 22);
    const tooltip = missing
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
    // false — dependency-graph.js's own stub shape). Epic is a background
    // wash, not a dot (.map-node.epic rect above), so status and this ball
    // are the only right-edge dots.
    const archivedDot = n.archived ? `<circle class="map-archived-dot" cx="${MAP_NODE_W - 10}" cy="${MAP_NODE_H / 2}" r="4"><title>Archived</title></circle>` : '';
    // The red blocked pill — the map twin of the board tile's
    // sticker glyph, bottom-left under the title where no dot column lives.
    // The pill's own <title> carries the reason (SVG-native tooltip; the
    // reason is user data, escaped like every other user string in this
    // SVG). Skipped for missing stubs (no card behind them) but NOT gated
    // off archived — a stop sign is identity, not location, and unlike
    // the waiting stroke it doesn't share a channel with the archived grey mute.
    const blockedPill = (!missing && n.blocked)
      ? `<g class="map-blocked-pill"><title>${escapeHtml(n.blockedReason ? `blocked: ${n.blockedReason}` : 'blocked')}</title>` +
        `<rect x="8" y="${MAP_NODE_H - 18}" width="46" height="13" rx="6.5"></rect>` +
        `<text x="31" y="${MAP_NODE_H - 8}" text-anchor="middle">blocked</text></g>`
      : '';
    nodesSvg +=
      `<g class="${cls}" transform="translate(${p.x},${p.y})"${missing ? '' : ` data-id="${id}"`}>` +
        `<title>${escapeHtml(tooltip)}</title>` +
        `<rect width="${MAP_NODE_W}" height="${MAP_NODE_H}" rx="6"></rect>` +
        `<text x="10" y="18" class="map-node-id">${escapeHtml(idLabel)}</text>` +
        `<text x="10" y="34" class="map-node-title${!missing && titleDisplay.isPromptFallback ? ' map-node-title--prompt-fallback' : ''}">${escapeHtml(titleLine)}</text>` +
        statusDot + archivedDot + blockedPill +
      `</g>`;
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'map-canvas');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML =
    `<defs><marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z"></path></marker>` +
    // the membership arrowhead — same shape, epic orange (a marker
    // never inherits the path's stroke, so it needs its own def).
    `<marker id="map-arrow-epic" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path class="map-arrow-epic-head" d="M0,0 L10,5 L0,10 z"></path></marker></defs>` +
    edgesSvg + nodesSvg;
  return svg;
}

async function fetchBoard() {
  return api('GET', '/api/board');
}

// document.title is a plain-text property (never HTML-parsed), so the raw name goes
// there directly — running it through escapeHtml first would show literal "&amp;"
// entities in the tab instead of "&". The heading span IS DOM markup (innerHTML), so
// it gets escapeHtml like every other filesystem/card-derived string in this file.
// The BOARD NAME IS the heading — no app label in front of it: the app is a kanban,
// and a "Kanban —" prefix only buried the one token that tells boards apart. It also
// leads the tab title, the field that gets truncated when several kanban tabs sit
// side by side (the app is named once there, after the name). It arrives from
// /api/board already
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
    columnSort = null;
    modalFullscreen = null;
    viewMode = null; // view.mode joins the same discipline
    mapStatusFilter = null; // map.statusFilter too
    calendarSubview = null; // calendar.subview too
    mapSectionsCollapsed = null; // map.sections.collapsed too
    ganttStatusFilter = null; // gantt.statusFilter too — applyStatuses' own reset doesn't fire on a pure rename with an unchanged status list
    calendarStatusFilter = null; // calendar.statusFilter too, same reasoning
  }
  state.projectName = next;
  document.title = name ? `${name} — Kanban` : 'Kanban App';
  $('#project-name').innerHTML = name ? escapeHtml(name) : 'Kanban';
}

function applyBoardData(data) {
  state.active = data.active;
  state.archived = data.archived;
  state.boardDir = data.boardDir || ''; // absolute board path for the header copy button (defensive ||: an old server without the field degrades to the honest empty-path toast)
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
  state.archivePackages = data.archivePackages || []; // archive popup's combobox reads it live; defensive || for an old server without the field
  selectedIds = pruneSelection(selectedIds, [...state.active, ...state.archived].map((c) => c.id)); // drop ghosts before render (archived cards are in the domain too)
  renderBoard();
  applyNotifications(data.notifications || []); // the board poll carries them — no separate timer
}

async function loadBoard() {
  applyBoardData(await fetchBoard());
}

// --- Auto-refresh: poll loadBoard() every 5s via the same path as the manual
// Refresh button, but never while the user is mid-interaction. The skip predicate
// itself lives in refresh-policy.js (pure, no DOM) so it's unit-testable from Node;
// this just gathers the current DOM/drag/visibility state and asks it.
const AUTO_REFRESH_MS = 5000;
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
function boardControlFocused() {
  const el = document.activeElement;
  // .cal-nav: calendar nav; .column-add: the header +;
  // .column-add-ai: its sparkle twin; .map-filter-toggle/
  // .map-section-toggle: the map pills; .gantt-filter-toggle: the
  // gantt pills; .calendar-filter-toggle: the
  // calendar pills (their views are wiped by every render). All focusable,
  // all rebuilt per render — a poll landing while one is focused would
  // silently dump keyboard focus to <body>.
  return !!(el && el.closest && el.closest('.column-sort-field, .column-sort-dir, .cal-nav, .column-add, .column-add-ai, .map-filter-toggle, .map-section-toggle, .gantt-filter-toggle, .calendar-filter-toggle'));
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
      bulkDragIds = (selectedIds.has(Number(el.dataset.id)) && selectedIds.size > 1) ? [...selectedIds] : null;
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      isDragging = false;
      bulkDragIds = null; // drop (if any) already consumed it — this catches cancelled drags, which would otherwise replay a stale bulk move
    });
  });
  document.querySelectorAll('.column').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const ids = bulkDragIds || [id];
      bulkDragIds = null;
      const dest = col.dataset.col;
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

// ?card=<id>&view=<board|map|gantt|calendar> deep links (deep-link.js owns
// the pure querystring parse) — consumed exactly ONCE, chained directly onto
// the very first loadBoard() below. Nothing re-checks location.search after
// this: the 5s poll goes through autoRefreshTick/applyBoardData, never
// loadBoard(), and every other loadBoard() call site (manual refresh,
// post-drag resync) is a separate call this function is never chained onto —
// so the deep link "wins" on load, then gets out of the way exactly as the
// poll and the persisted view mode expect. A bad/unknown id never touches
// viewMode at all: "loads normally" means the persisted view stands.
function consumeDeepLink() {
  const link = parseDeepLink(location.search);
  if (!link) return;
  if (link.id == null) { toast('Deep link card id is invalid — loaded normally.'); return; }
  const card = state.active.concat(state.archived).find((c) => c.id === link.id);
  if (!card) { toast(`Card #${link.id} not found — loaded normally.`); return; }
  if (link.view) {
    // Direct assignment, not toggleView/saveViewMode: this override is for
    // THIS load only (wins ONCE) — it must never overwrite the persisted
    // choice, so a later plain reload (no querystring) still resumes
    // wherever the user last left the view via the normal toggle.
    viewMode = link.view;
    renderBoard();
  }
  const el = document.querySelector(`${VIEW_CONTAINERS[loadViewMode()]} .card-el[data-id="${card.id}"]`);
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') autoRefreshTick();
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
  input.style.color = handle ? (assigneeColor(handle, state.assignees) || '') : '';
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
function openModal(card, presetStatus, presetStart) {
  $('#modal-title').textContent = card ? `Edit #${card.id}` : 'New card';
  $('#f-id').value = card ? card.id : '';
  $('#f-title').value = card ? card.title : '';
  renderStatusOptions(card ? card.status : null);
  $('#f-status').value = card ? card.status : (presetStatus || boardStatuses()[0]);
  $('#f-priority').value = card ? card.priority : 'Normal';
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
  $('#f-epic').checked = card ? !!card.epic : false; // edit preserves the flag; create starts unchecked
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

// Backdrop-close for the edit/new-card form: silent when the form
// is untouched, one confirm when typed work would be lost. Cancel/Save keep
// their existing behavior — explicit buttons are deliberate, only the easy-to-
// fat-finger backdrop click gets the guard.
let formSnapshot = null;

function snapshotFormFields() {
  return {
    title: $('#f-title').value, status: $('#f-status').value, priority: $('#f-priority').value,
    tags: $('#f-tags').value, waiting: $('#f-waiting').value, blocked: $('#f-blocked').value, review: $('#f-review').value, prompt: $('#f-prompt').value, assignee: $('#f-assignee').value,
    start: $('#f-start').value, end: $('#f-end').value, due: $('#f-due').value, body: $('#f-body').value, // the whole date triad joins the dirty baseline
    epic: $('#f-epic').checked, // a toggled checkbox is typed work too (isDirty compares booleans fine)
  };
}

function requestCloseModal() {
  if (isDirty(formSnapshot, snapshotFormFields()) &&
      !confirm('Discard unsaved changes to this card?')) return;
  closeModal();
}

function parseIds(s) {
  return s.split(',').map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isInteger(n));
}
function parseTags(s) {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

async function submitModal(e) {
  e.preventDefault();
  const id = $('#f-id').value;
  const payload = {
    title: $('#f-title').value.trim(),
    status: $('#f-status').value,
    priority: $('#f-priority').value,
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
    epic: $('#f-epic').checked, // false clears — the line is removed, never written as `epic: false`
    body: $('#f-body').value,
  };
  try {
    if (id) await api('PATCH', `/api/cards/${id}`, payload);
    else await api('POST', '/api/cards', payload);
    closeModal();
    await loadBoard();
  } catch (e2) {
    if (e2.status === 422) {
      toast(`Can't set doing — ${gate422Text(e2.data)}.`);
    } else {
      toast('Save failed: ' + e2.message);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  $('#new-btn').addEventListener('click', () => openModal(null));
  // X goes through the dirty guard (the retired Cancel button bypassed it —
  // backdrop-click and X now agree on the unsaved-changes speedbump)
  $('#modal-close').addEventListener('click', requestCloseModal);
  // revealing changes no field values, so the dirty baseline is untouched
  $('#show-more-btn').addEventListener('click', () => {
    const minimal = isMinimalCreate(false, true); // always false — expanding lifts minimal for the rest of the open
    $('#card-form').classList.toggle('minimal', minimal);
  });
  $('#card-form').addEventListener('submit', submitModal);
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
      const id = Number(actBtn.dataset.id);
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

async function doDelete(id, { onSuccess } = {}) {
  if (!confirm(`Permanently delete ${cardLabel(id)}? This cannot be undone.`)) return;
  try { await api('DELETE', `/api/cards/${id}`); if (onSuccess) onSuccess(); await loadBoard(); }
  catch (e) { toast('Delete failed: ' + e.message); }
}

// --- Card detail popup: rendered markdown body, frontmatter table, copy-path. ---
// Fetches the card's current on-disk content on open (server-backed, no snapshot
// staleness). Renderer + escaping ported from skills/dashboard's popup, which
// carries the fixes from that skill's XSS review: escapeHtml covers & < > " ',
// every interpolated value is escaped, and markdown link hrefs are scheme-checked.

// Minimal, dependency-free markdown -> HTML: headings, bold/italic, inline code,
// fenced code blocks, links, unordered lists (incl. `- [x]` task items, indent-depth-aware
// nesting, and lazy continuation lines), hr, tables, paragraphs.
// A delimiter row is pipe-separated cells of dashes, each optionally colon-anchored
// on either end for alignment. This is the whole test for "is the line above a
// table header" (kanban.proj #256).
const TABLE_DELIM_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$|^\s*\|\s*:?-{3,}:?\s*\|\s*$/;

// Split one pipe row into trimmed cells: drop the optional outer pipes, split on
// pipes the author did not escape, then unescape the ones they did.
function splitRow(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

function mdToHtml(md) {
  const lines = escapeHtml(md).split('\n');
  let html = '';
  let inCode = false, codeBuf = [];
  // listStack tracks open <ul> levels by the indent width that opened them, deepest
  // last; liOpen is whether that deepest level's last <li> is still unclosed (kept
  // open so a nested sub-list or a continuation line can land inside it).
  let listStack = [];
  let liOpen = false;
  let para = [];

  const flushPara = () => {
    if (para.length) { html += `<p>${para.join(' ')}</p>`; para = []; }
  };
  const closeLi = () => {
    if (liOpen) { html += '</li>'; liOpen = false; }
  };
  const closeList = () => {
    closeLi();
    while (listStack.length) {
      html += '</ul>';
      listStack.pop();
      if (listStack.length) html += '</li>'; // closes the ancestor <li> the popped <ul> was nested inside
    }
  };
  const inline = (s) => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (m, text, url) => {
      const safe = /^(https?:|mailto:|#|\/)/i.test(url.trim()) ? url : '#';
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCode) { html += `<pre><code>${codeBuf.join('\n')}</code></pre>`; codeBuf = []; inCode = false; }
      else { flushPara(); closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (/^\s*---\s*$/.test(line)) { flushPara(); closeList(); html += '<hr>'; continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }

    // A table is a header row, a delimiter row, then body rows, all pipe-delimited
    // (kanban.proj #256). The delimiter row is what makes it a table: without one
    // underneath, a line of pipes stays ordinary prose, so a sentence that happens
    // to contain a `|` is never swallowed. Cells are already-escaped text by the
    // time they get here (escapeHtml ran over the whole body up front), so this
    // branch synthesises tags around text that can no longer carry markup.
    if (line.trim().startsWith('|') && TABLE_DELIM_RE.test(lines[i + 1] || '')) {
      flushPara();
      closeList();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':'), r = c.endsWith(':');
        return r && l ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      // Alignment rides a class, never an inline style attribute: the app's CSP
      // carries no unsafe-inline for styles, so such an attribute would be dropped
      // by the browser and the column would silently ignore its colons.
      const cell = (tag, text, n) => {
        const a = aligns[n] ? ` class="ta-${aligns[n]}"` : '';
        return `<${tag}${a}>${inline(text)}</${tag}>`;
      };
      let body = '';
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i]);
        // GFM: a ragged row is padded or truncated to the header's width rather
        // than skewing every column after it.
        while (cells.length < head.length) cells.push('');
        cells.length = head.length;
        body += `<tr>${cells.map((c, n) => cell('td', c, n)).join('')}</tr>`;
        i++;
      }
      i--; // the loop's own i++ consumes the line that ended the table
      const header = `<tr>${head.map((c, n) => cell('th', c, n)).join('')}</tr>`;
      // Wrapped in its own scroller: a wide table scrolls inside the popup
      // instead of making the whole popup scroll sideways.
      html += `<div class="md-table"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
      continue;
    }

    const task = line.match(/^(\s*)-\s+\[( |x|X)\]\s+(.*)$/);
    const item = !task && line.match(/^(\s*)-\s+(.*)$/);
    if (task || item) {
      flushPara();
      const m = task || item;
      const indent = m[1].length;
      // Deeper->shallower: unwind every level this line's indent has dropped below,
      // closing each level's own <li> (restored "open" for the ancestor left behind).
      while (listStack.length && indent < listStack[listStack.length - 1].indent) {
        closeLi();
        html += '</ul>';
        listStack.pop();
        liOpen = listStack.length > 0;
      }
      if (listStack.length && indent === listStack[listStack.length - 1].indent) {
        closeLi(); // same-depth sibling: close the previous <li> at this level
      } else if (!listStack.length || indent > listStack[listStack.length - 1].indent) {
        listStack.push({ indent }); // deeper indent (or the very first list): open a nested/new <ul>
        html += '<ul>';
      }
      if (task) {
        const checked = task[2].toLowerCase() === 'x';
        html += `<li class="task">${checked ? '&#9745;' : '&#9744;'} ${inline(task[3])}`;
      } else {
        html += `<li>${inline(item[2])}`;
      }
      liOpen = true; // left open: a nested list or a continuation line may still extend it
      continue;
    }

    if (line.trim() === '') { flushPara(); closeList(); continue; }

    if (listStack.length) {
      // A wrapped non-`-` line while a list is open is a continuation of the last
      // <li>, not a new paragraph — joins in place rather than closing the list.
      html += ' ' + inline(line.trim());
      continue;
    }
    para.push(inline(line));
  }
  flushPara();
  closeList();
  if (inCode && codeBuf.length) html += `<pre><code>${codeBuf.join('\n')}</code></pre>`;
  return html;
}

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

function renderFrontmatterTable(pairs) {
  if (!pairs.length) return '';
  const rows = pairs.map(([k, v]) =>
    `<tr><td class="fm-key">${escapeHtml(k)}</td><td class="fm-value">${escapeHtml(formatFrontmatterValue(v))}</td></tr>`
  ).join('');
  return `<table>${rows}</table>`;
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

async function openDetailModal(id) {
  const reqId = ++detailRequestId;
  let data;
  try { data = await api('GET', `/api/cards/${id}/detail`); }
  catch (e) { if (reqId === detailRequestId) toast('Load failed: ' + e.message); return; }
  if (reqId !== detailRequestId) return; // a newer openDetailModal call superseded this one
  currentDetailId = data.id;
  currentDetailArchived = !!data.archived;
  // Same empty-title-shows-the-prompt fallback every other
  // view uses (cardTitleDisplay, card-title.js) — cardDetail (card-store.js)
  // carries `prompt` alongside title for exactly this.
  const titleDisplay = cardTitleDisplay(data);
  $('#detail-title').textContent = `#${data.id} ${titleDisplay.text}`;
  $('#detail-title').classList.toggle('detail-title--prompt-fallback', titleDisplay.isPromptFallback);
  $('#detail-path').textContent = data.path || '';
  $('#detail-copy-btn').dataset.path = data.path || '';
  resetCopyState();
  $('#detail-modified').innerHTML = formatDetailModified(data);
  $('#detail-frontmatter').innerHTML = renderFrontmatterTable(parseFrontmatter(data.frontmatter));
  $('#detail-body').innerHTML = mdToHtml(data.body || '');
  // The tile wash (`.card.epic`), same class on the popup's own panel —
  // cardDetail (card-store.js) carries the tolerant any-case read tiles use.
  $('#detail-modal').querySelector('.modal').classList.toggle('epic', !!data.epic);
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
}

function closeDetailModal() {
  detailRequestId++; // invalidate any in-flight fetch so it can't reopen the modal after close
  currentDetailId = null;
  currentDetailArchived = false;
  $('#detail-modal').classList.add('hidden');
}

// Edit layers the existing card-form modal over the (now closed) detail popup;
// closing first guarantees no stale detail view is left behind on return.
function editFromDetail() {
  if (currentDetailId == null || currentDetailArchived) return;
  const card = state.active.find((c) => c.id === currentDetailId);
  if (!card) { closeDetailModal(); toast('Card not found — Refresh.'); return; }
  closeDetailModal();
  openModal(card);
}

window.addEventListener('DOMContentLoaded', () => {
  $('#detail-close').addEventListener('click', closeDetailModal);
  $('#detail-copy-btn').addEventListener('click', copyDetailPath);
  $('#detail-edit-btn').addEventListener('click', editFromDetail);
  $('#detail-archive-btn').addEventListener('click', () => {
    // Belt-and-suspenders: the button is hidden for archived cards, but never
    // let this path reach doArchive on one even if that ever fails to apply.
    if (currentDetailId != null && !currentDetailArchived) doArchive(currentDetailId, { onSuccess: closeDetailModal });
  });
  $('#detail-delete-btn').addEventListener('click', () => {
    if (currentDetailId != null) doDelete(currentDetailId, { onSuccess: closeDetailModal });
  });
  $('#detail-fullscreen-btn').addEventListener('click', () => toggleModalFullscreen('detail'));
  $('#detail-modal').addEventListener('click', (e) => { if (e.target.id === 'detail-modal') closeDetailModal(); });
  // Esc priority: fullscreen is out of the Esc picture entirely.
  // An open detail popup closes on the very first Esc regardless of its
  // fullscreen state. The edit/new-card modal closes on Esc too — through
  // requestCloseModal(), the exact same unsaved-changes guard the X button
  // uses. Esc
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
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#context-menu').classList.contains('hidden')) { hideContextMenu(); return; }
    if (!$('#notif-modal').classList.contains('hidden')) { closeNotifModal(); return; }
    if (!$('#detail-modal').classList.contains('hidden')) { closeDetailModal(); return; }
    if (!$('#modal').classList.contains('hidden')) { requestCloseModal(); return; }
    if (closeAnyBulkPopup()) return;
    if (anyModalOpen()) return; // defensive catch-all: any future .modal-backdrop popup not listed above
    clearSearch();
  });
  // Alt+Enter: toggle fullscreen on whichever fullscreen-capable
  // popup is open — the keyboard twin of that popup's toggle button, going
  // through the same toggleModalFullscreen so the persisted per-modal-type
  // preference updates identically. Works with focus anywhere inside the
  // popup (form fields included — preventDefault keeps the chord away from
  // implicit form submission); attachCombobox's Enter handling exempts
  // alt-chorded Enter, so the hotkey wins even while a suggestion menu is
  // open. No popup open = plain no-op.
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
// `/` focuses the box (skipped while any input/textarea/select/contentEditable
// already has focus, so it doesn't hijack typing elsewhere — including inside
// either modal, whose fields are all one of those tag names). Ctrl+F/Cmd+F
// also focuses it, with its own `#`-prefill/select-all
// logic — see the keydown listener below.
function clearSearch() {
  const input = $('#search-input');
  if (!input || !input.value) return;
  input.value = '';
  renderBoard();
}

// Append a scoped term to whatever's already in the search
// box (assignee cue / tag click on a card tile) and re-render — same direct-
// call convention as focusOn() (further down): set the box, call
// renderBoard() straight, no synthetic 'input' event needed. Idempotent
// rather than a toggle: clicking the same assignee/tag again while its term
// is already present is a no-op — simpler than tracking "did I add this" to
// support removing it again.
function addSearchTerm(term) {
  const input = $('#search-input');
  const terms = input.value.trim() ? input.value.trim().split(/\s+/) : [];
  if (terms.includes(term)) return;
  input.value = terms.concat(term).join(' ');
  renderBoard();
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
    const stripped = searchHashStrip(input.value);
    if (stripped !== null) {
      const caret = Math.max(0, input.selectionStart - 1);
      input.value = stripped;
      input.setSelectionRange(caret, caret);
    }
    renderBoard();
  });
  $('#search-clear-btn').addEventListener('click', clearSearch);
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/') return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;
    e.preventDefault();
    input.focus();
  });
  // Ctrl+F / Cmd+F: focus the search box, preventDefault
  // on the browser's own find bar. search-hotkey.js owns the chord + value
  // decision — an empty box gets "#" prefilled with the caret right after it
  // (typing digits immediately forms the #<id> exact-match term), a box that
  // already holds a query gets select-all instead, so the chord never
  // silently clobbers a query someone already typed (typing overwrites the
  // selection, same as any focused input). Suppressed while any modal/popup
  // is open (anyModalOpen(), the same guard the 5s poll uses) — every
  // popup's .modal-backdrop covers the whole viewport, so the search bar
  // sits hidden behind it; browser's native find stands in that case
  // instead — mirror of Ctrl+S, which only fires INSIDE a popup,
  // this one only fires OUTSIDE one. Unlike the "/" hotkey above, no
  // active-element check is needed: Ctrl+F never inserts a literal
  // character into whatever's focused, so there's nothing for it to hijack.
  document.addEventListener('keydown', (e) => {
    const result = searchHotkeyPrefill(e, { modalOpen: anyModalOpen(), currentValue: input.value });
    if (!result) return;
    e.preventDefault();
    const changed = result.value !== input.value;
    input.value = result.value;
    if (changed) renderBoard();
    input.focus();
    input.setSelectionRange(result.selectionStart, result.selectionEnd);
  });
  // Autocomplete dropdown, same hand-rolled combobox (native
  // <datalist> misrenders in VSCode's Simple Browser — see attachCombobox's
  // own header comment) the create/edit form uses for priority/assignee/tags.
  // getOptions reads input.value itself (searchSuggestionItems computes
  // fresh candidates from whatever's currently typed) rather than a static
  // list — preFiltered/selectOnFocus:false are the two opt-outs that make
  // that fit; see attachCombobox's comments at each for why.
  attachCombobox(input, () => searchSuggestionItems(input.value), { preFiltered: true, selectOnFocus: false });
});

// --- Map view wiring: top-bar toggle + the bits
// the shared card-el grammar does NOT cover. #map-view is rebuilt from
// scratch by every renderMapView() call (manual/poll/drag/toggle alike, same
// as #board's cards), so clicks use event delegation on the stable #map-view
// parent. Real nodes and the isolated row's tiles carry card-el + data-id
// (see buildMapSvg/buildIsolatedRow) and are handled by the document-level
// grammar handlers in the multi-select section — click-to-detail,
// ctrl/shift-click selection, right-click menu, all shared. What stays here:
// - an archived isolated tile's Restore/Delete buttons (data-act) — checked
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
  $('#map-view').addEventListener('click', (e) => {
    // Section collapse toggles — control-row buttons, checked first
    // for the same reason the status pills and data-act buttons are (never fall
    // through to card-el).
    const sectionBtn = e.target.closest('.map-section-toggle[data-section]');
    if (sectionBtn) {
      toggleMapSection(sectionBtn.dataset.section);
      return;
    }
    // Status-filter pills — control-row buttons, checked first for
    // the same reason data-act buttons are (never fall through to card-el).
    const filterBtn = e.target.closest('.map-filter-toggle[data-col]');
    if (filterBtn) {
      toggleMapStatusFilter(filterBtn.dataset.col);
      return;
    }
    // The "Epics" chip — same control-row-buttons-checked-
    // first reasoning as the status pills above.
    const epicChip = e.target.closest('#map-epic-chip');
    if (epicChip) {
      toggleEpicSearchTerm();
      return;
    }
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      const id = Number(actBtn.dataset.id);
      if (actBtn.dataset.act === 'restore') doRestore(id);
      if (actBtn.dataset.act === 'delete-arch') doDelete(id);
      return;
    }
    const stub = e.target.closest('.map-node.ghost[data-id]');
    if (stub) openDetailModal(Number(stub.dataset.id));
  });
  // Right-click a status-filter pill SOLOs it (every other pill
  // off); right-click the already-soloed pill again restores all ON. Own
  // listener (not folded into the click one above) so it can preventDefault
  // WITHOUT touching the browser's context menu anywhere else in #map-view —
  // a right-click that misses a pill falls through untouched to the
  // shared card-el contextmenu handler on document (map nodes/isolated tiles
  // keep their bulk-menu right-click exactly as before).
  $('#map-view').addEventListener('contextmenu', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // same guard as the gantt's contextmenu — a chorded right-click mid-drag must not re-render under the gesture
    const filterBtn = e.target.closest('.map-filter-toggle[data-col]');
    if (!filterBtn) return;
    e.preventDefault();
    soloMapStatusFilter(filterBtn.dataset.col);
  });
});

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
// y/m from it, so the window carries across sub-view switches): it resets to
// today on page load and survives the 5s poll's re-render by construction
// (renderCalendarView reads it, nothing in the render path resets it — only
// the prev/next/Today controls write it).
let calendarAnchor = null;

function currentCalendarAnchor() {
  if (!calendarAnchor) calendarAnchor = localTodayStr();
  return calendarAnchor;
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

// Local time on purpose (matches the user's wall clock, same as
// formatLocalDateTime) — the grid itself is built with UTC math but its "is
// this cell today" check must agree with the calendar on the user's wall.
function localTodayStr() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function calendarChipEl(card, pos, time, isDue) {
  const el = document.createElement('div');
  const pb = priorityBadge(card, state.priorities); // same emphasis rules as the board tiles
  // Chips join the shared card-el grammar. Selection is by id, so
  // every chip of a multi-day run paints .selected together — they all read
  // the same selectedIds entry on this render. The deadline chip keeps
  // its distinct class on top of the grammar.
  // epic is a background-wash class (`.cal-chip.epic`,
  // app.css), not a dot glyph — the priority/
  // waiting/due rules below need no gating, nothing to win over.
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
    (card.epic ? ' epic' : '') +
    (card.archived ? ' archived' : '') +
    (overdue ? ' overdue' : '') +
    (selectedIds.has(card.id) ? ' selected' : '');
  // An archived card is
  // read-only — native drag simply never starts (no fake-drag animation to
  // guard against, unlike the gantt's custom pointer-drag), so onCalendarDrop
  // never gets called for it in the first place.
  el.draggable = !card.archived;
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
  // on the chip's own card.archived flag. Epic doesn't ride this glyph
  // sequence at all (it's the chip's own background wash instead).
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

function renderCalendarView() {
  const container = $('#calendar-view');
  const subview = loadCalendarSubview();
  // Preserve the time grid's scroll across re-renders (poll included) — same
  // keepLeft/keepTop discipline as renderMapView. null = first paint.
  const prevScroll = container.querySelector('.cal-tg-scroll');
  const keepScroll = prevScroll ? prevScroll.scrollTop : null;
  container.innerHTML = '';

  const spanNoun = { month: 'month', week: 'week', '3day': '3 days', day: 'day' }[subview];
  const controls = document.createElement('div');
  controls.className = 'cal-controls';
  controls.innerHTML =
    `<button type="button" id="cal-prev-btn" class="cal-nav" title="Previous ${spanNoun}" aria-label="Previous ${spanNoun}">&#8249;</button>` +
    `<button type="button" id="cal-today-btn" class="cal-nav" title="Jump back to today">Today</button>` +
    `<button type="button" id="cal-next-btn" class="cal-nav" title="Next ${spanNoun}" aria-label="Next ${spanNoun}">&#8250;</button>` +
    `<span class="cal-title">${escapeHtml(subviewTitle(subview, currentCalendarAnchor()))}</span>` +
    // The sub-view switcher. cal-nav class on purpose: it joins the
    // focused-control poll guard AND the Q0 clear-selection exemption, same
    // as prev/today/next (these buttons are rebuilt every render too).
    `<span class="cal-subview-switch" role="group" aria-label="Calendar span">` +
    CALENDAR_SUBVIEWS.map((sv) =>
      `<button type="button" class="cal-subview-btn cal-nav${sv === subview ? ' active' : ''}" ` +
        `data-subview="${sv}" aria-pressed="${sv === subview}">${CAL_SUBVIEW_LABELS[sv]}</button>`).join('') +
    `</span>`;
  container.appendChild(controls);
  // The status-filter row renders first and UNCONDITIONALLY — same
  // reasoning as the map's row and the gantt's row: if it vanished on
  // an everything-filtered-out empty grid, there'd be no control left to
  // toggle a status back ON. Shared by BOTH branches below (month and every
  // sub-view read the same loadCalendarStatusFilter()).
  container.appendChild(buildCalendarFilterRow());

  if (subview === 'month') renderCalendarMonthGrid(container);
  else renderCalendarTimeGrid(container, subview, keepScroll);
  wireCalendarDrag();
}

// The month grid, in its own
// function (the sub-view switcher branches between this and the time grid).
function renderCalendarMonthGrid(container) {
  const { year, monthIndex } = currentCalendarMonth();
  // Same search composition as the board and map: read the live input value
  // each render (see currentSearchTerms), filter with the shared filterCards.
  // A card appears via its RANGE (cardSchedule) and/or its DUE
  // marker (dueMarker) — a due-only card has no schedule but still chips.
  // The search pool spans live + archived unconditionally, same as
  // the gantt — harmless while the Archive pill is off, since no archived
  // card is ever added to `cards` below regardless of whether its id lands
  // in searchIds.
  const searchTerms = currentSearchTerms();
  const searchIds = searchTerms.length ? new Set(filterCards(state.active.concat(state.archived), searchTerms).map((c) => c.id)) : null;
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
  const scheduled = allCards
    .map((card) => ({ card, schedule: cardSchedule(card), due: dueMarker(card) }))
    .filter((s) => s.schedule.kind !== 'none' || s.due);

  const grid = document.createElement('div');
  grid.className = 'cal-grid';
  for (const dow of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    const h = document.createElement('div');
    h.className = 'cal-dow';
    h.textContent = dow;
    grid.appendChild(h);
  }
  const today = localTodayStr();
  for (const cell of monthGrid(year, monthIndex)) {
    const dayEl = document.createElement('div');
    dayEl.className = 'cal-day' + (cell.inMonth ? '' : ' outside') + (cell.date === today ? ' today' : '');
    dayEl.dataset.day = cell.date;
    const num = document.createElement('div');
    num.className = 'cal-day-num';
    num.textContent = cell.day;
    dayEl.appendChild(num);

    const chips = [];
    for (const { card, schedule, due } of scheduled) {
      const pos = chipPositionForDay(schedule, cell.date);
      if (pos) chips.push({ card, pos, time: schedule.time });
      // The due chip renders even when the range already covers the
      // day — the deadline is a different thing from the working range.
      if (due && due.day === cell.date) chips.push({ card, pos: 'single', time: due.time, due: true });
    }
    const { visible, overflow } = capChips(chips, CALENDAR_MAX_CHIPS_PER_DAY);
    visible.forEach((c) => dayEl.appendChild(calendarChipEl(c.card, c.pos, c.time, c.due)));
    if (overflow.length) {
      // Overflow is deliberately cheap: a
      // tooltip-titled line listing the hidden cards — hover reads them, and
      // every card stays reachable via search or the board view.
      const more = document.createElement('div');
      more.className = 'cal-more';
      more.textContent = `+${overflow.length} more`;
      // same fallback as every other title-bearing surface.
      more.title = overflow.map((c) => `#${c.card.id} ${cardTitleDisplay(c.card).text}`).join('\n');
      dayEl.appendChild(more);
    }
    grid.appendChild(dayEl);
  }
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
  const searchTerms = currentSearchTerms();
  const searchIds = searchTerms.length ? new Set(filterCards(state.active.concat(state.archived), searchTerms).map((c) => c.id)) : null;
  const statusIds = ganttFilterVisibleIds(state.active, loadCalendarStatusFilter(), boardStatuses());
  const visibleIds = intersectVisibleIds(searchIds, statusIds);
  const cards = visibleIds ? state.active.filter((c) => visibleIds.has(c.id)) : state.active;
  const archiveOn = loadCalendarStatusFilter().archive === true;
  const allCards = archiveOn
    ? cards.concat(searchIds ? state.archived.filter((c) => searchIds.has(c.id)) : state.archived)
    : cards;
  const layout = timeGridLayout(allCards, days);
  const today = localTodayStr();

  const grid = document.createElement('div');
  grid.className = 'cal-timegrid';
  grid.style.setProperty('--cal-day-cols', days.length);

  // Header row: weekday + day-of-month per column, today highlighted like the
  // month grid's cell.
  const head = document.createElement('div');
  head.className = 'cal-tg-head';
  head.appendChild(document.createElement('div')); // spacer over the hour gutter
  for (const day of days) {
    const h = document.createElement('div');
    h.className = 'cal-tg-dayhead' + (day === today ? ' today' : '');
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
  const bandRows = Math.max(1, layout.allDayRows); // at least one row of drop surface, even empty
  days.forEach((day, i) => {
    const cell = document.createElement('div');
    cell.className = 'cal-tg-allday-cell cal-drop' + (day === today ? ' today' : '');
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
    col.className = 'cal-tg-col cal-drop' + (day === today ? ' today' : '');
    col.dataset.day = day;
    col.style.height = `${24 * CAL_HOUR_PX}px`;
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
      el.style.left = `calc(${block.lane} * 100% / ${block.lanes})`;
      el.style.width = `calc(100% / ${block.lanes} - 4px)`;
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
    body.appendChild(col);
  }
  scroll.appendChild(body);
  grid.appendChild(scroll);
  container.appendChild(grid);
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
      // (pointer-events:none via this class, see app.css). The sub-month
      // all-day chips are grid-overlay SIBLINGS of their .cal-tg-allday-cell
      // drop targets — a drag released over one would never bubble to any cell,
      // preventDefault would never fire and the browser would refuse the drop
      // (month chips are CHILDREN of .cal-day, which is why the same gesture
      // needs no help there). Falling through to the cell underneath gives the
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
      const id = Number(e.dataTransfer.getData('text/plain'));
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
    const id = Number(blockEl.dataset.id);
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

// --- Calendar view wiring: header toggle + the
// prev/today/next nav. #calendar-view is rebuilt by every renderCalendarView()
// call, so clicks delegate to the stable parent — same pattern (and reason)
// as #map-view's delegated listener above. Chip clicks (detail/selection/
// context menu) are the shared card-el grammar's job now — nothing
// chip-specific left here. Clicking an empty day cell matches no card-el, so
// the document-level Q0 handler clears any selection, exactly like the
// board's background.
window.addEventListener('DOMContentLoaded', () => {
  $('#calendar-toggle-btn').addEventListener('click', () => toggleView('calendar'));
  wireCalendarTimeDrag(); // delegated once on the stable #calendar-view
  $('#calendar-view').addEventListener('click', (e) => {
    // Status-filter pills — control-row buttons, checked first for
    // the same reason the map's and the gantt's pills are (never fall
    // through to the sub-view switcher/nav/card-el handling below).
    const filterBtn = e.target.closest('.calendar-filter-toggle[data-col]');
    if (filterBtn) { toggleCalendarStatusFilter(filterBtn.dataset.col); return; }
    // The sub-view switcher rides the same delegated listener as
    // prev/today/next — all four button sets are rebuilt every render.
    const sv = e.target.closest('.cal-subview-btn');
    if (sv) { setCalendarSubview(sv.dataset.subview); return; }
    if (e.target.closest('#cal-prev-btn')) { shiftCalendarWindow(-1); return; }
    if (e.target.closest('#cal-next-btn')) { shiftCalendarWindow(1); return; }
    if (e.target.closest('#cal-today-btn')) { calendarAnchor = null; renderCalendarView(); }
  });
  // Click-to-create. ADR 0006 pins plain-click-on-empty-cell to
  // clearing the selection, so create rides double-click instead — a gesture
  // no existing calendar interaction uses, on the SAME empty-cell-space
  // Q0 relies on (a click landing on a chip never reaches here — see the
  // .card-el guard below — so it can never fight the shared grammar).
  // Month/all-day cells only carry a day; time-grid columns also carry the
  // pointer's y, converted to a snapped minute the same way the retime drag
  // math does (CAL_PX_PER_MIN). Status is left at the modal's own default —
  // unlike the column "+", a calendar cell doesn't imply a status.
  $('#calendar-view').addEventListener('dblclick', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // same guard as the contextmenu listener below: never fire out from under a live drag
    if (e.target.closest('.card-el')) return; // a chip's dblclick is its own affair, not a create gesture
    const dayCell = e.target.closest('.cal-day, .cal-tg-allday-cell');
    if (dayCell) { openModal(null, null, calendarCreateStart(dayCell.dataset.day)); return; }
    const col = e.target.closest('.cal-tg-col');
    if (col) {
      const r = col.getBoundingClientRect();
      openModal(null, null, calendarCreateStart(col.dataset.day, (e.clientY - r.top) / CAL_PX_PER_MIN));
    }
  });
  // Right-click SOLO on the calendar's own pills — same reasoning
  // as the map's contextmenu listener above (own listener so a miss falls
  // through untouched to the shared chip contextmenu on document).
  $('#calendar-view').addEventListener('contextmenu', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // same guard as the gantt's contextmenu — a chorded right-click mid-.cal-chip-drag must not re-render out from under the gesture
    const filterBtn = e.target.closest('.calendar-filter-toggle[data-col]');
    if (!filterBtn) return;
    e.preventDefault();
    soloCalendarStatusFilter(filterBtn.dataset.col);
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
// window derives from the rendered cards each render, so a poll that changes
// cards may legitimately move it — deliberate: there's no month cursor to
// preserve (unlike the calendar), and the view mode itself persists via the
// shared 'view.mode' mechanism. No dependency arrows on purpose — the map
// view owns the waiting_for graph; here a waiting card just keeps the board's
// amber left-accent cue. No focusable controls in here either (bars are divs,
// there's no prev/next nav), so boardControlFocused needs no new entry.

function ganttBarEl(bar, win) {
  // The window may be clamped (~180 days), so a bar can poke past either
  // edge: draw only the visible slice, squared off + dashed on the cut side;
  // a bar entirely outside draws nothing (its gutter label still lists it).
  if (bar.endDay < win.startDay || bar.startDay > win.endDay) return null;
  const from = bar.startDay < win.startDay ? win.startDay : bar.startDay;
  const to = bar.endDay > win.endDay ? win.endDay : bar.endDay;
  const el = document.createElement('div');
  const pb = priorityBadge(bar.card, state.priorities); // same emphasis as tiles/chips
  // epic is a background-wash class (`.gantt-bar.epic`,
  // app.css — layered via box-shadow since the status fill below already
  // owns `background`), not a dot glyph. The status
  // border/fill stays untouched either way.
  // An archived bar mutes to the neutral archive grey
  // regardless of its parked on-disk status — the BAR keeps this mute
  // (it's a row-level archived cue, like a board tile dimming,
  // not the status-dot channel locked to "never mutes"; the
  // gutter row's own dot, built lower down in renderGanttView, colors off
  // the card's true status instead). 'archive' is also the literal key
  // ganttArchiveGroup uses for the group itself (gantt-model.js), so
  // statusColor/isBuiltinStatus already know it with no extra
  // branching beyond this swap.
  const colorStatus = bar.card.archived ? 'archive' : bar.card.status;
  el.className = `gantt-bar card-el status-${mapStatusClass(colorStatus)}` + // bars join the shared card-el grammar
    (pb.className ? ` ${pb.className}` : '') + (isWaiting(bar.card) ? ' waiting' : '') +
    (bar.card.epic ? ' epic' : '') +
    (selectedIds.has(bar.card.id) ? ' selected' : '') +
    (bar.card.archived ? ' archived' : '') + // an archived bar is drag-read-only — CSS swaps the grab cursor for not-allowed
    (bar.startDay < win.startDay ? ' clip-start' : '') + (bar.endDay > win.endDay ? ' clip-end' : '');
  el.dataset.id = bar.card.id;
  el.dataset.archived = bar.card.archived ? '1' : ''; // read by wireGanttPointerDrag's pointerdown guard, same signal used to swap the tooltips below
  // Non-built-in statuses (custom columns, unlisted values) color
  // inline from the deterministic hash — the .status-unknown class beneath
  // only supplies the shape defaults it overrides. This write is
  // unconditional: no `.epic` rule ever competes for `background` here
  // (the `.gantt-bar.epic` wash is a `box-shadow`, layered on top of
  // whatever `background` resolves to, inline or class-based alike).
  // 'archive' isn't built-in either, so an archived bar rides
  // this same inline-override path straight to ARCHIVE_COLOR.
  if (!isBuiltinStatus(colorStatus)) {
    el.style.borderColor = statusColor(colorStatus);
    el.style.background = statusColorSoft(colorStatus);
  }
  el.style.left = `${diffDays(win.startDay, from) * GANTT_DAY_PX}px`;
  el.style.width = `${(diffDays(from, to) + 1) * GANTT_DAY_PX}px`;
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
  el.innerHTML =
    `<span class="gantt-handle start" title="${startHint}"></span>` +
    `<span class="gantt-bar-text${titleDisplay.isPromptFallback ? ' gantt-bar-text--prompt-fallback' : ''}"><span class="gantt-bar-id">#${bar.card.id}</span> ${escapeHtml(titleDisplay.text)}</span>` +
    `<span class="gantt-handle end" title="${endHint}"></span>`;
  return el;
}

function renderGanttView() {
  const container = $('#gantt-view');
  // The timeline is thousands of px wide — losing scroll on every 5s poll
  // would make horizontal position unusable. Carry it across the rebuild.
  const prevScroll = container.querySelector('.gantt-scroll');
  const keepScrollLeft = prevScroll ? prevScroll.scrollLeft : null;
  container.innerHTML = '';
  // The status-filter row renders first and UNCONDITIONALLY — same
  // reasoning as the map's row: if it vanished on the everything-
  // filtered-out empty state, there'd be no control left to toggle a status
  // back ON. Everything from here on APPENDS (never innerHTML=, which would
  // wipe this row straight back out).
  container.appendChild(buildGanttFilterRow());
  // Same search composition as board/map/calendar: live input value each
  // render, shared filterCards. Status filter composes with search
  // by INTERSECTION — a card is visible only if BOTH say so — same pure
  // helper and same rule as the map's composition (never a union, never
  // one side dropped). The search pool spans live + archived
  // unconditionally (same as the map's own search pool) — harmless while the
  // Archive pill is off, since no archived bar is ever added to groups below
  // regardless of whether its id lands in searchIds.
  const searchTerms = currentSearchTerms();
  const searchIds = searchTerms.length
    ? new Set(filterCards(state.active.concat(state.archived), searchTerms).map((c) => c.id))
    : null;
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
  // The window covers each row's bar AND its due diamond (a
  // due-only row has no bar at all), hence rowWindowSpans between the rows
  // and ganttWindow.
  const rows = groups.flatMap((g) => g.bars);
  const win = ganttWindow(rowWindowSpans(rows), localTodayStr());

  const gutter = document.createElement('div');
  gutter.className = 'gantt-gutter';
  const scroll = document.createElement('div');
  scroll.className = 'gantt-scroll';
  const timeline = document.createElement('div');
  timeline.className = 'gantt-timeline';
  timeline.style.width = `${win.days * GANTT_DAY_PX}px`;
  scroll.appendChild(timeline);

  // Axis row: Monday week marks up top, matching full-height grid lines
  // behind the rows; the gutter gets an empty spacer of the same height so
  // both columns' row sequences line up 1:1 from there on.
  const head = document.createElement('div');
  head.className = 'gantt-axis';
  gutter.appendChild(head);
  const axis = document.createElement('div');
  axis.className = 'gantt-axis';
  timeline.appendChild(axis);
  const today = localTodayStr();
  for (let i = 0; i < win.days; i++) {
    const day = addDays(win.startDay, i);
    if (isMonday(day)) {
      const mark = document.createElement('div');
      mark.className = 'gantt-week-mark';
      mark.style.left = `${i * GANTT_DAY_PX}px`;
      mark.textContent = weekMarkLabel(day);
      axis.appendChild(mark);
      const line = document.createElement('div');
      line.className = 'gantt-week-line';
      line.style.left = `${i * GANTT_DAY_PX}px`;
      timeline.appendChild(line);
    }
  }
  if (today >= win.startDay && today <= win.endDay) {
    const line = document.createElement('div');
    line.className = 'gantt-today-line';
    line.style.left = `${diffDays(win.startDay, today) * GANTT_DAY_PX + GANTT_DAY_PX / 2}px`;
    line.title = `Today (${today})`;
    timeline.appendChild(line);
  }

  for (const group of groups) {
    const glabel = document.createElement('div');
    glabel.className = `gantt-row gantt-group-row status-${mapStatusClass(group.status)}`;
    if (!isBuiltinStatus(group.status)) glabel.style.color = statusColor(group.status); // hashed color for custom groups
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
      label.className = 'gantt-row gantt-label card-el' + (bar.card.epic ? ' epic' : '') + (selectedIds.has(bar.card.id) ? ' selected' : '');
      label.dataset.id = bar.card.id;
      // Same fallback every other view uses — reused via
      // cardTitleDisplay, never re-derived (card-title.js).
      const titleDisplay = cardTitleDisplay(bar.card);
      label.title = `#${bar.card.id} ${titleDisplay.text}`;
      // The gutter row carries the dots too — "all components" means
      // both surfaces.
      // epic's cue is the row's own background wash (.gantt-
      // label.epic, app.css) rather than a second dot — a due-only row (no
      // bar at all) would otherwise lose the epic cue entirely, since the
      // label is the only element it has.
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
      const el = bar.startDay ? ganttBarEl(bar, win) : null; // due-only rows have no bar
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
        d.style.left = `${diffDays(win.startDay, bar.dueDay) * GANTT_DAY_PX + GANTT_DAY_PX / 2}px`; // centered on its day column
        d.title = bar.card.archived
          ? `#${bar.card.id} ${titleDisplay.text} — due ${bar.dueDay} (archived — restore the card to reschedule)`
          : `#${bar.card.id} ${titleDisplay.text} — due ${bar.dueDay}${overdue ? ' — past due' : ''} (drag to move the due date)`;
        row.appendChild(d);
      }
      timeline.appendChild(row);
    }
  }
  // gutter+scroll ride their OWN flex row (.gantt-body) — the
  // filter row is a sibling above them: #gantt-view itself is a
  // plain block so the filter row stacks on top instead of joining the
  // side-by-side flex row as a third item.
  const body = document.createElement('div');
  body.className = 'gantt-body';
  body.appendChild(gutter);
  body.appendChild(scroll);
  container.appendChild(body);
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
  const px = GANTT_DAY_PX;
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
// detail popup after every drag) and the Q0 clear-selection handler. One-shot:
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
  // Status-filter pills — control-row buttons, checked first for
  // the same reason the map's pills are (never fall through to the
  // pointer-drag/card-el handling below).
  container.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('.gantt-filter-toggle[data-col]');
    if (filterBtn) toggleGanttStatusFilter(filterBtn.dataset.col);
  });
  // Right-click SOLO on the gantt's own pills — same reasoning as
  // the map's contextmenu listener (own listener so a miss falls through
  // untouched to the shared bar/gutter-label contextmenu on document).
  container.addEventListener('contextmenu', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // a chorded right-click mid-bar-drag must not detach ganttDrag.barEl via re-render
    const filterBtn = e.target.closest('.gantt-filter-toggle[data-col]');
    if (!filterBtn) return;
    e.preventDefault();
    soloGanttStatusFilter(filterBtn.dataset.col);
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
    const card = state.active.find((c) => c.id === Number(barEl.dataset.id));
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
      id: Number(barEl.dataset.id),
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
    ganttDrag.dayDelta = Math.round(dx / GANTT_DAY_PX);
    applyGanttDragVisual(ganttDrag);
  });
  // pointerup commits; pointercancel (touch scroll steal, window loss) never
  // does. Either way the bar snaps back to its pre-drag geometry first — on
  // commit the PATCH + loadBoard() re-render is what actually moves it.
  // A press without movement is a click — that click is
  // NOT handled here: the native click event that follows the unmoved
  // pointerup bubbles to the shared card-el grammar handlers, so bars get
  // detail/selection/Q0 semantics identical to every other view. Only a
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
  // rides string-built HTML. The TLDR (text before the first "; more: ", splitTldr
  // from notifications.js) renders bold; the rest of the message — separator
  // included, so the entry stays verbatim — renders normally. level paints
  // the row (debug dimmed, warning amber, error red; absent = info).
  el.replaceChildren(...list.map((n) => {
    const row = document.createElement('div');
    row.className = `notif-row level-${notificationLevel(n)}${n.read ? '' : ' unread'}`;
    const text = document.createElement('div');
    text.className = 'notif-text';
    const meta = document.createElement('div');
    meta.className = 'notif-meta';
    meta.textContent = `${n.from || 'unknown'}${n.at ? ' · ' + n.at : ''}`;
    const msg = document.createElement('div');
    msg.className = 'notif-message';
    const strong = document.createElement('strong');
    strong.textContent = splitTldr(n.message).tldr;
    msg.appendChild(strong);
    const rest = String(n.message).slice(strong.textContent.length);
    if (rest) msg.appendChild(document.createTextNode(rest));
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
    if (btn) deleteNotification(Number(btn.dataset.id));
  });
});

// --- Multi-select + bulk actions, with view parity. Selection
// lives as a Set of ids (toggleSelection/pruneSelection/contextSelection/
// partitionByMovable/rangeSelection from selection.js — pure, unit-tested);
// every view's renderer paints .selected from it on every render, so it
// survives polls AND view switches by construction.
// Board tiles, map nodes + isolated-row tiles, calendar
// chips, and gantt bars + gutter labels all carry the card-el contract and
// share one interaction grammar — click opens detail, ctrl/cmd+click toggles
// one card in the selection, shift+click adds the whole range between the
// anchor and the target (the file-manager grammar), right-click
// selects + opens the context menu (whose actions were already view-agnostic:
// they act on selectedIds, not on DOM). Only the map's ghost stubs opt out
// (see buildMapSvg).
let selectedIds = new Set();
// The range anchor — the last card a selection gesture landed on
// (ctrl+click, a range-starting shift+click, or a right-click that replaced
// the selection). Never persisted, and never trusted blindly: shift+click
// re-validates it against the rendered order and re-plants it when the card
// vanished (poll/delete) or left the active view (filter/view switch).
let selectionAnchor = null;
let bulkDragIds = null; // captured at dragstart; null = single-card drag

// The rendered order shift+click ranges over: every card-el in
// the ACTIVE view's container, document order, deduped to first occurrence
// (a multi-day calendar run repeats one id across chips; gantt rows pair a
// gutter label with a bar). Hidden views keep stale DOM — applyViewMode only
// toggles .hidden — so the query must scope to the active container, not the
// whole document.
function visibleCardIds() {
  const ids = [...$(VIEW_CONTAINERS[loadViewMode()]).querySelectorAll('.card-el')].map((el) => Number(el.dataset.id));
  return [...new Set(ids)];
}

function hideContextMenu() {
  $('#context-menu').classList.add('hidden');
}

function showContextMenu(x, y) {
  const menu = $('#context-menu');
  // "Dependency tree"/"Dependency path" only make sense against a
  // single card — hidden whenever the effective selection is more than one.
  // The caller (the document contextmenu handler) has already resolved
  // selectedIds via contextSelection() and reassigned it before calling here,
  // so selectedIds.size is the "effective selection" at this point. First
  // conditionally-hidden menu items — the other seven always render; mixed-
  // selection handling for them lives inside each click handler instead.
  const singleSelected = selectedIds.size <= 1;
  $('#ctx-tree').classList.toggle('hidden', !singleSelected);
  $('#ctx-path').classList.toggle('hidden', !singleSelected);
  menu.classList.remove('hidden');
  // Clamp to the viewport so the menu never opens half off-screen.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
}

// Writes "tree:<id>"/"path:<id>" into the search box (REPLACING its
// content — not appended), closes the menu, and runs the normal search flow
// via renderBoard() — same direct-call convention as clearSearch(), no
// synthetic 'input' event, and no view switch. Single-card only; showContextMenu
// already hides these items for a multi-card selection, but this guards the
// no-selection edge case too (e.g. a stale/empty selectedIds).
function focusOn(kind) {
  hideContextMenu();
  const id = [...selectedIds][0];
  if (id == null) return;
  $('#search-input').value = `${kind}:${id}`;
  renderBoard();
}

// Bulk archive asks WHERE before it moves anything (ADR 0010): the
// confirm speedbump first (unchanged rule — skipped when every card being
// archived is already done), then the Archive popup, whose package box
// completes against the board's existing archived/<package>/ folders. Left
// empty it archives to the archived/ root, exactly as before packages existed
// — the drag-to-Archive and tile/detail Archive paths never ask at all.
async function bulkArchive() {
  hideContextMenu();
  const skipped = selectedCards().filter((c) => c.archived).length; // already archived (mixed selections)
  const toArchive = selectedCards().filter((c) => !c.archived);
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

// The popup's Archive button. Re-derives the batch from the live selection
// (the poll may have moved cards under the popup) and sends the package with
// every POST — a blank box sends none, so the request is byte-identical to
// the package-less archive paths.
async function applyBulkArchive() {
  const pkg = $('#bulk-archive-input').value.trim();
  $('#bulk-archive').classList.add('hidden');
  const skipped = selectedCards().filter((c) => c.archived).length;
  const ids = selectedCards().filter((c) => !c.archived).map((c) => c.id);
  if (!ids.length) { if (skipped) toast('Everything selected is already archived.'); return; }
  const failed = [];
  for (const id of ids) {
    try { await api('POST', `/api/cards/${id}/archive`, pkg ? { package: pkg } : undefined); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  selectedIds = new Set();
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
  const skipped = selectedCards().filter((c) => !c.archived).length;
  const ids = selectedCards().filter((c) => c.archived).map((c) => c.id);
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

async function bulkDelete() {
  hideContextMenu();
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!confirm(`Permanently delete ${ids.length} card(s)? This cannot be undone.`)) return;
  const failed = [];
  for (const id of ids) {
    try { await api('DELETE', `/api/cards/${id}`); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  selectedIds = new Set();
  await loadBoard();
  toast(failed.length ? `Deleted ${ids.length - failed.length}; failed: ${failed.join(', ')}` : `Deleted ${ids.length} card(s).`);
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
  selectedIds = new Set();
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
  if (parts.length) toast(parts.join('; ') + '.');
}

// --- Bulk edits: assign / set-priority share one single-choice
// popup, tags get a workbench. N per-card PATCHes, per-card failures don't
// abort (bulk-move semantics). No confirm — the popup's Apply IS the
// speedbump (edits are reversible, unlike archive/delete) — and the
// selection survives so bulk actions chain on the same batch.
let bulkSingleMode = null; // 'assignee' | 'priority'

function selectedCards() {
  return [...state.active, ...state.archived].filter((c) => selectedIds.has(c.id));
}

function openBulkSingle(mode) {
  hideContextMenu();
  if (!selectedIds.size) return;
  bulkSingleMode = mode;
  $('#bulk-single-title').textContent = mode === 'assignee'
    ? `Assign ${selectedIds.size} card(s)` : `Set priority on ${selectedIds.size} card(s)`;
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
  await loadBoard(); // selection survives — pruneSelection only drops departed ids
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
  await bulkPatch([...selectedIds], () => (mode === 'assignee' ? { assignee: value } : { priority: value }), (n) => `${label} ${n} card(s)`);
}

function renderBulkTags() {
  const cards = selectedCards();
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
  if (!selectedIds.size) return;
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
  const changes = addTagChanges(selectedCards(), tag);
  $('#bulk-tag-input').value = '';
  if (!changes.length) { toast(`All selected cards already have "${tag}".`); return; }
  const byId = new Map(changes.map((c) => [c.id, c.tags]));
  await bulkPatch([...byId.keys()], (id) => ({ tags: byId.get(id) }), (n) => `Added "${tag}" to ${n} card(s)`);
  renderBulkTags(); // workbench stays open for the next operation
}

async function bulkRemoveTags() {
  const chosen = [...$('#bulk-tag-list').querySelectorAll('input:checked')].map((cb) => cb.value);
  if (!chosen.length) { toast('Tick the tags to remove first.'); return; }
  const changes = removeTagsChanges(selectedCards(), chosen);
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
  if (!selectedIds.size) return;
  $('#bulk-schedule-title').textContent = `Schedule ${selectedIds.size} card(s)`;
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
  await bulkPatch([...selectedIds], () => changes, (n) => `Scheduled ${n} card(s): ${scheduleSummary(changes)}`);
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
  // board tiles, map nodes/isolated tiles, calendar chips, gantt bars/gutter
  // labels — instead of per-view duplicates that would drift. Document is the
  // stable ancestor (the view containers are all rebuilt-into, never
  // replaced, but one listener beats four). View-specific controls keep their
  // own per-view delegated handlers, which run FIRST (they're deeper in the
  // bubble path) and are excluded here by the interactive-control guard: a
  // click landing on a button/select inside or around a card-el (archive
  // tile's Restore/Delete, column sort controls, calendar nav) belongs to
  // that control, never to the card grammar. Registration order matters:
  // this runs before the Q0 clear-selection handler below, so a plain click
  // on a card empties the selection here and Q0 then no-ops.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.card-el');
    if (!el) return;
    if (e.target.closest('button, select, input, a')) return;
    const id = Number(el.dataset.id);
    // An assignee cue or a tag is a search shortcut, not a
    // way to open/select the card underneath it — handled here, ahead of the
    // select/open logic below, an additive guard
    // only. See addSearchTerm for the additive/no-op
    // contract. ADR 0009: the blocked/review pills join the same
    // shortcut — always the bare presence term, read from state, never the
    // pill's own text (the reason itself isn't a search key).
    const cue = e.target.closest('.card-assignee, .tag, .blocked-pill, .review-pill');
    if (cue) {
      const card = state.active.concat(state.archived).find((c) => c.id === id);
      if (card) {
        if (cue.classList.contains('card-assignee') && card.assignee) addSearchTerm(`assignee:${card.assignee}`);
        else if (cue.classList.contains('tag')) addSearchTerm(`tags:${cue.textContent}`);
        else if (cue.classList.contains('blocked-pill')) addSearchTerm('blocked:');
        else if (cue.classList.contains('review-pill')) addSearchTerm('review:');
      }
      return;
    }
    // File-manager selection grammar:
    // Shift+click ADDS the whole range between the anchor and the target, in
    // the active view's rendered order; ctrl/cmd+click toggles one card and
    // plants the anchor. renderBoard() repaints whichever view is active —
    // board columns always, plus the active map/calendar/gantt.
    if (e.shiftKey) {
      const order = visibleCardIds();
      // no usable anchor (never set, card gone, or filtered out of this
      // view) — this click starts the range: select the target, anchor here
      if (!order.includes(selectionAnchor)) selectionAnchor = id;
      selectedIds = rangeSelection(selectedIds, order, selectionAnchor, id);
      renderBoard();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      selectedIds = toggleSelection(selectedIds, id);
      selectionAnchor = id;
      renderBoard();
      return;
    }
    // Plain click breaks any selection, then just opens the card as always.
    selectionAnchor = null;
    if (selectedIds.size) { selectedIds = new Set(); renderBoard(); }
    openDetailModal(id);
  });
  // Right-click on any card-el opens the bulk menu; anywhere else keeps the
  // browser's own context menu (don't hijack the whole page).
  // contextSelection semantics: an unselected card becomes THE
  // selection in the same gesture; a selected one keeps the whole batch.
  document.addEventListener('contextmenu', (e) => {
    if (isDragging || ganttDrag || calTimeDrag) return; // a chorded right-click mid-drag must not re-render under the gesture
    const el = e.target.closest('.card-el');
    if (!el) return;
    const next = contextSelection(selectedIds, Number(el.dataset.id));
    if (next !== selectedIds) {
      selectedIds = next;
      selectionAnchor = Number(el.dataset.id); // the gesture restarted the selection — ranges extend from here
      renderBoard();
    }
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
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
  // Dependency tree / path search sugar
  $('#ctx-tree').addEventListener('click', () => focusOn('tree'));
  $('#ctx-path').addEventListener('click', () => focusOn('path'));
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
  // Q0: any plain click that isn't inside the context menu or a
  // bulk popup drops the multi-selection. Ctrl-, cmd- and shift-clicks build
  // it; the menu and popups are exempt so they don't kill their
  // own target batch. The view toggle buttons are exempt too: the
  // selection must survive a view switch. The date-picker popover
  // renders into document.body (outside #modal), so it and the schedule
  // popup are exempt as well.
  document.addEventListener('click', (e) => {
    if (!selectedIds.size || e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest('#context-menu, #bulk-single, #bulk-tags, #bulk-schedule, #bulk-archive, .date-picker-pop, #map-toggle-btn, #calendar-toggle-btn, #gantt-toggle-btn, .cal-nav, .map-filter-toggle, .map-section-toggle, .gantt-filter-toggle, .calendar-filter-toggle')) return; // curate-the-view controls: month paging (.cal-nav), the map pills, the section collapse toggles, the gantt pills, and the calendar pills must not wipe a building selection
    selectedIds = new Set();
    selectionAnchor = null; // a dead selection must not leave an invisible range anchor behind
    renderBoard();
  });
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
  // verbatim inside the newly-scoped tail). The three form fields (priority/
  // assignee/tags) don't pass this.
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
    if (e.key === 'Escape' && !menu.hidden) { close(); e.stopPropagation(); return; }
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
  pop.hidden = true;
  // One delegated listener outlives every re-render (renderDatePicker swaps
  // the children on each nav click) — same discipline as #calendar-view's.
  pop.addEventListener('click', (e) => {
    // Everything inside the popover is popover business: stop here so the
    // document outside-closer and Q0 never see these clicks. Critically, a
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
  pop.replaceChildren(controls, grid, timeRow);
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

document.querySelectorAll('.date-pick-btn').forEach((btn) => {
  const input = document.getElementById(btn.dataset.dateInput);
  // Toggle: same button closes; a different field's button MOVES the one
  // popover there (openDatePicker re-derives month + selection per opening).
  btn.addEventListener('click', () => {
    if (datePickerFor === input) closeDatePicker();
    else openDatePicker(input, btn);
  });
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
document.addEventListener('keydown', (e) => {
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
window.addEventListener('keydown', (e) => { if (e.key === 'Shift') document.body.classList.add('shift-held'); });
window.addEventListener('keyup', (e) => { if (e.key === 'Shift') document.body.classList.remove('shift-held'); });
window.addEventListener('blur', () => document.body.classList.remove('shift-held'));
