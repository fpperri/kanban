'use strict';
// The status-filter registry: one entry per view that has status pills (the Map, the Gantt, the
// Calendar, the Graph; the Board has none). Each entry holds the view's load, toggle and solo, its
// Archive default, and its pill titles, so the wording has one copy and the Statuses section reads
// one seam. load, toggle and solo reach the page's own functions when called, not when this file
// loads, because app.js and graph-view.js come after it. Same dual-environment export pattern as
// prefs.js.

const STATUS_FILTERS = {
  map: {
    archiveDefault: true,
    load: () => loadMapStatusFilter(),
    toggle: (col) => toggleMapStatusFilter(col),
    solo: (col) => soloMapStatusFilter(col),
    title: (col, label, on) => `${on ? 'Hide' : 'Show'} ${label} cards on the map (hidden cards ghost when a visible card references them)`,
  },
  gantt: {
    archiveDefault: false,
    load: () => loadGanttStatusFilter(),
    toggle: (col) => toggleGanttStatusFilter(col),
    solo: (col) => soloGanttStatusFilter(col),
    title: (col, label, on) => col === 'archive'
      ? `${on ? 'Hide' : 'Show'} archived cards on the timeline (dated archived cards render in their own Archive group, muted grey)`
      : `${on ? 'Hide' : 'Show'} ${label} cards on the timeline (the visible window re-derives from what's left)`,
  },
  calendar: {
    archiveDefault: false,
    load: () => loadCalendarStatusFilter(),
    toggle: (col) => toggleCalendarStatusFilter(col),
    solo: (col) => soloCalendarStatusFilter(col),
    title: (col, label, on) => col === 'archive'
      ? `${on ? 'Hide' : 'Show'} archived cards on the calendar (dated archived cards render read-only, with the archived ball)`
      : `${on ? 'Hide' : 'Show'} ${label} cards on the calendar`,
  },
  graph: {
    archiveDefault: false,
    load: () => graphLoadFilter(),
    toggle: (col) => graphToggleFilter(col),
    solo: (col) => graphSoloFilter(col),
    title: (col, label, on) => col === 'archive'
      ? `${on ? 'Hide' : 'Show'} archived cards on the graph`
      : `${on ? 'Hide' : 'Show'} ${label} cards on the graph`,
  },
};

function statusFilterTitle(view, col, label, on) {
  return STATUS_FILTERS[view].title(col, label, on);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STATUS_FILTERS, statusFilterTitle };
}
