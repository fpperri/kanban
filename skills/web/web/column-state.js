'use strict';
// Pure helpers for per-column collapse state. No DOM/localStorage
// access here on purpose — same dual-environment pattern as refresh-policy.js,
// so this is unit-testable from node --test AND loaded as a plain <script> in
// the browser (app.js calls these as bare globals).
//
// localStorage discipline (established here; sort choices and
// fullscreen prefs follow the same scheme): one key per board+feature,
// `kanban.<projectName>.<feature>`, via storageKey() below — so unrelated UI
// state never collides even though it all lives under one localStorage origin.

// The live columns are the board's configured `statuses` list
// (config.yaml, ordered = column order); the built-in four are only the
// DEFAULT when no list is configured. Archive stays a location-column pinned
// at the far right, never part of the list. The constants below are
// kept as the default shape (and for back-compat with existing callers).
const DEFAULT_STATUSES = ['backlog', 'todo', 'doing', 'done'];
const COLUMN_IDS = ['backlog', 'todo', 'doing', 'done', 'archive'];
const COLUMN_LABELS = { backlog: 'Backlog', todo: 'Todo', doing: 'Doing', done: 'Done', archive: 'Archive' };
// Defaults: four live columns expanded, Archive collapsed.
const DEFAULT_COLLAPSED = { backlog: false, todo: false, doing: false, done: false, archive: true };

// The live status list a configured value resolves to. Tolerance (same
// never-fatal discipline as config-store): a mistaken 'archive' entry is
// dropped — archive is a location-column, never a status — and an
// empty/absent list falls back to the built-in four.
function liveStatuses(statuses) {
  const list = [...new Set((statuses || []).filter((s) => s !== 'archive'))]; // dedupe: repeated config entries would render duplicate columns + duplicate cards
  return list.length ? list : DEFAULT_STATUSES;
}

// Column ids for a board: the configured statuses (or the built-in four when
// the list is empty/absent) + archive at the far right.
function columnIdsFor(statuses) {
  return liveStatuses(statuses).concat('archive');
}

// Which column a card's on-disk status renders in: itself when listed, else
// the list's FIRST column — the catch-all ("unknown status lands
// in backlog": backlog IS the first column of the default list). The file is
// never rewritten; promotion = the human adds the status to config.yaml.
function columnForStatus(status, statuses) {
  const live = liveStatuses(statuses);
  return live.includes(status) ? status : live[0];
}

function columnLabel(id) {
  if (Object.prototype.hasOwnProperty.call(COLUMN_LABELS, id)) return COLUMN_LABELS[id];
  const s = String(id);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Whether a column header shows the + quick-create button. Live
// columns only — you can't create an archived card (ADR 0002: archive is a
// LOCATION, not a status) — and never on a collapsed strip (no room next to
// the stacked toggle + count, and expanding is one click away anyway).
function showsColumnAdd(col, isCollapsed) {
  return col !== 'archive' && !isCollapsed;
}

function storageKey(projectName, feature) {
  return `kanban.${projectName || 'default'}.${feature}`;
}

// --- map view status-filter ----------------------------------------
// One show/hide toggle per column (the configured statuses in column order +
// archive, the location pseudo-column — the map always includes archived
// cards, see renderMapView). Same shape and merge discipline as the collapse
// state above, persisted under its own feature key ('map.statusFilter' via
// storageKey), default all ON: filtering is opt-in, a fresh board hides
// nothing.

function defaultMapStatusFilter(columnIds) {
  const out = {};
  for (const id of columnIds || COLUMN_IDS) out[id] = true;
  return out;
}

function mergeMapStatusFilter(saved, ids) {
  const columnIds = ids || COLUMN_IDS;
  const result = defaultMapStatusFilter(columnIds);
  if (saved && typeof saved === 'object') {
    for (const id of columnIds) {
      if (typeof saved[id] === 'boolean') result[id] = saved[id];
    }
  }
  return result;
}

// Which toggle governs a card: archive for archived cards (a LOCATION beats
// the parked pre-archive status, same precedence as the board's fifth column
// and the map's grey .archived stroke), else the card's board
// column via columnForStatus — so an unlisted on-disk status follows its
// catch-all FIRST column's toggle, exactly where the board files the card.
function mapFilterColumn(card, statuses) {
  return card.archived ? 'archive' : columnForStatus(card.status, statuses);
}

// The ids the status-filter leaves visible, or null when every toggle is ON —
// mirroring search.js's "empty query matches everything" null, so the map can
// hand buildDependencyGraph the same no-filter signal for both features. A
// missing filter key counts as ON (defensive: never hide a card because a
// merge was skipped somewhere).
function mapFilterVisibleIds(cards, filter, statuses) {
  const f = filter && typeof filter === 'object' ? filter : {};
  if (!columnIdsFor(statuses).some((id) => f[id] === false)) return null;
  return new Set((cards || []).filter((c) => f[mapFilterColumn(c, statuses)] !== false).map((c) => c.id));
}

// --- the gantt's own default-filter shape ----------------------------------------------------------
// Same merge discipline as defaultMapStatusFilter/mergeMapStatusFilter above,
// but the Archive id defaults OFF instead of ON: every live status pill
// defaults ON, while the Archive pill starts OFF so an unconfigured/fresh
// board's gantt shows live work only until a human opts in. This is the one
// thing that differs from the map's Archive pill (always ON by default — the
// map has always included archived cards); reusing mergeMapStatusFilter
// directly would default the archive key to true and flip the gantt's
// default view.

function defaultGanttStatusFilter(ids) {
  const out = {};
  for (const id of ids || COLUMN_IDS) out[id] = id !== 'archive';
  return out;
}

function mergeGanttStatusFilter(saved, ids) {
  const columnIds = ids || COLUMN_IDS;
  const result = defaultGanttStatusFilter(columnIds);
  if (saved && typeof saved === 'object') {
    for (const id of columnIds) {
      if (typeof saved[id] === 'boolean') result[id] = saved[id];
    }
  }
  return result;
}

// --- the gantt's own visibility rule -----------------
// mapFilterVisibleIds (above) folds an unlisted on-disk status into the FIRST
// column's toggle — correct for the map/board, where that catch-all column is
// literally where the card renders. The gantt does NOT share that semantics:
// gantt-model.js's ganttGroups buckets by the RAW status and gives an unlisted
// one its own separate, labeled group row, entirely unrelated to any board
// column. Reusing mapFilterVisibleIds there would let an unrelated pill (e.g. the
// first column's) silently hide a group it doesn't represent, with no pill of
// its own to control it directly. Here, a status absent from `statuses` (no
// pill exists for it — buildGanttFilterRow only emits one per board status)
// is simply never governed by the filter: it stays visible no matter which
// pills are on/off, matching ganttGroups' own "always its own group" rule.
function ganttFilterVisibleIds(cards, filter, statuses) {
  const f = filter && typeof filter === 'object' ? filter : {};
  const live = liveStatuses(statuses);
  if (!live.some((id) => f[id] === false)) return null;
  return new Set((cards || [])
    .filter((c) => !live.includes(c.status) || f[c.status] !== false)
    .map((c) => c.id));
}

// --- pill interaction grammar — left toggle (flips one
// pill), right SOLO. Right-click a pill: that status on, every
// other off. Right-click again on an already-soloed pill (the only one ON):
// restore ALL on ("viceversa"). One pure rule shared by all three
// status-filter rows (map, gantt, calendar) — app.js's
// solo*StatusFilter wrappers each feed it their own loaded filter + id list,
// same as the existing toggle*StatusFilter wrappers do for the left-click
// rule. A missing filter key counts as ON, same defensive convention as
// mapFilterVisibleIds above.
function soloStatusFilter(filter, ids, col) {
  const columnIds = ids || COLUMN_IDS;
  if (!columnIds.includes(col)) return filter; // stale data-col from a column set that changed under the row — no-op, same guard as the toggle functions
  const f = filter && typeof filter === 'object' ? filter : {};
  const alreadySoloed = f[col] !== false && columnIds.every((id) => id === col || f[id] === false);
  const result = {};
  for (const id of columnIds) result[id] = alreadySoloed ? true : id === col;
  return result;
}

// How the map composes search with the status filter: INTERSECTION — a card is
// visible only when BOTH say so. Either feature's "not filtering" is null
// (search: empty query; filter: all toggles ON), so a lone active feature
// passes its set through untouched and both-null stays null — one combined
// visibleIds for buildDependencyGraph, ghost semantics exactly the search
// filter's. Pure and here (not inline in renderMapView) so the rule is
// unit-pinned: a combiner drifting to union passed the whole suite as glue.
function intersectVisibleIds(searchIds, statusIds) {
  if (!searchIds || !statusIds) return searchIds || statusIds;
  return new Set([...searchIds].filter((id) => statusIds.has(id)));
}

// Per-column collapse default, derived for whatever column set is in play:
// live columns expanded, archive collapsed — the same rule the static
// DEFAULT_COLLAPSED encodes for the built-in set.
function defaultCollapsed(columnIds) {
  const out = {};
  for (const id of columnIds || COLUMN_IDS) out[id] = id === 'archive';
  return out;
}

// Merge a value decoded from localStorage (which may be missing, null, not an
// object, or carry stale/unknown keys from a prior column set) with the
// defaults, so a partial/corrupt saved value never crashes the board or
// silently drops a column's state — unknown keys are dropped, missing keys
// fall back to the default, and only real booleans are trusted. Pass
// the board's current column ids to merge against a dynamic column set;
// omitting them keeps the built-in five.
function mergeCollapsedState(saved, ids) {
  const columnIds = ids || COLUMN_IDS;
  const result = defaultCollapsed(columnIds);
  if (saved && typeof saved === 'object') {
    for (const id of columnIds) {
      if (typeof saved[id] === 'boolean') result[id] = saved[id];
    }
  }
  return result;
}

// --- map view section collapse (the graph + the "No dependencies"
// list) --------------------------------------------------------------------
// A fixed small key set — not a dynamic column set like the collapse/
// status-filter state above — so the merge needs no `ids` param. Same
// defensive shape as modal-fullscreen.js's mergeFullscreenState: unknown keys
// dropped, missing keys fall back to the default, only real booleans trusted.
// Default both expanded — collapsing is opt-in, a fresh board hides nothing.

const MAP_SECTIONS = ['graph', 'isolated'];
const DEFAULT_MAP_SECTIONS_COLLAPSED = { graph: false, isolated: false };

function mergeMapSectionsCollapsed(saved) {
  const result = Object.assign({}, DEFAULT_MAP_SECTIONS_COLLAPSED);
  if (saved && typeof saved === 'object') {
    for (const key of MAP_SECTIONS) {
      if (typeof saved[key] === 'boolean') result[key] = saved[key];
    }
  }
  return result;
}

// --- roll-up bar on a parent card -----------------------------------------
// Two per-browser choices, each its own storageKey feature: how the bar shows on
// board cards (a closed set) and whether archived leaves count toward it. Same
// tolerant stance as mergeViewMode: anything unrecognised is the default.
const ROLLUP_BAR_MODES = ['open', 'collapsed', 'off'];

function mergeRollupBar(saved) {
  return ROLLUP_BAR_MODES.includes(saved) ? saved : 'collapsed';
}

// Stored as the strings 'true' / 'false' (localStorage keeps nothing else).
function mergeRollupCountArchived(saved) {
  return saved !== 'false';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COLUMN_IDS, COLUMN_LABELS, DEFAULT_COLLAPSED, DEFAULT_STATUSES,
    liveStatuses, columnIdsFor, columnForStatus, columnLabel, defaultCollapsed,
    showsColumnAdd, storageKey, mergeCollapsedState,
    defaultMapStatusFilter, mergeMapStatusFilter, mapFilterColumn, mapFilterVisibleIds, ganttFilterVisibleIds, intersectVisibleIds,
    defaultGanttStatusFilter, mergeGanttStatusFilter,
    soloStatusFilter,
    MAP_SECTIONS, DEFAULT_MAP_SECTIONS_COLLAPSED, mergeMapSectionsCollapsed,
    ROLLUP_BAR_MODES, mergeRollupBar, mergeRollupCountArchived,
  };
} else {
  window.COLUMN_IDS = COLUMN_IDS;
  window.COLUMN_LABELS = COLUMN_LABELS;
  window.DEFAULT_COLLAPSED = DEFAULT_COLLAPSED;
  window.DEFAULT_STATUSES = DEFAULT_STATUSES;
  window.liveStatuses = liveStatuses;
  window.columnIdsFor = columnIdsFor;
  window.columnForStatus = columnForStatus;
  window.columnLabel = columnLabel;
  window.defaultCollapsed = defaultCollapsed;
  window.showsColumnAdd = showsColumnAdd;
  window.storageKey = storageKey;
  window.mergeCollapsedState = mergeCollapsedState;
  window.defaultMapStatusFilter = defaultMapStatusFilter;
  window.mergeMapStatusFilter = mergeMapStatusFilter;
  window.mapFilterColumn = mapFilterColumn;
  window.mapFilterVisibleIds = mapFilterVisibleIds;
  window.ganttFilterVisibleIds = ganttFilterVisibleIds;
  window.intersectVisibleIds = intersectVisibleIds;
  window.defaultGanttStatusFilter = defaultGanttStatusFilter;
  window.mergeGanttStatusFilter = mergeGanttStatusFilter;
  window.soloStatusFilter = soloStatusFilter;
  window.MAP_SECTIONS = MAP_SECTIONS;
  window.DEFAULT_MAP_SECTIONS_COLLAPSED = DEFAULT_MAP_SECTIONS_COLLAPSED;
  window.mergeMapSectionsCollapsed = mergeMapSectionsCollapsed;
  window.ROLLUP_BAR_MODES = ROLLUP_BAR_MODES;
  window.mergeRollupBar = mergeRollupBar;
  window.mergeRollupCountArchived = mergeRollupCountArchived;
}
