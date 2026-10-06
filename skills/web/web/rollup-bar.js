'use strict';
// Pure HTML for a parent card's altitude badge and roll-up bar. No DOM access,
// same dual-environment pattern as type-badge.js.
//
// Segment weights are data (data-n), never a style string: the strict
// style-src 'self' CSP blocks style="..." and app.js sets each segment's
// flex-grow through the CSSOM after insertion. Colours are classes, one per
// statusColorClass() outcome, so a custom status colours like its column dot.

const ROLLUP_ASSIGNEE_BADGE = (typeof module !== 'undefined' && module.exports)
  ? require('./assignee-badge')
  : window;
const ROLLUP_STATUS_COLORS = (typeof module !== 'undefined' && module.exports)
  ? require('./status-colors')
  : window;

function altitudeBadge(altitude) {
  if (!(altitude >= 1)) return '';
  return `<span class="alt-badge" title="altitude: layers below">▲${altitude}</span>`;
}

// [{ status, n }]: the board's own status order first, then any other status by name.
function rollupSegments(counts, order) {
  const known = (order || []).filter((s) => counts[s]);
  const rest = Object.keys(counts).filter((s) => !known.includes(s)).sort();
  return known.concat(rest).map((status) => ({ status, n: counts[status] }));
}

// mode: 'open' (bar and numbers), 'collapsed' (thin bar), anything else draws nothing.
function rollupBar(rollup, mode, order) {
  if ((mode !== 'open' && mode !== 'collapsed') || !rollup.total) return '';
  const esc = ROLLUP_ASSIGNEE_BADGE.escapeHtml;
  const segments = rollupSegments(rollup.counts, order);
  const label = (status) => esc(status || '(none)');
  const segs = segments.map(({ status, n }) =>
    `<span class="rollup-seg rollup-seg--${ROLLUP_STATUS_COLORS.statusColorClass(status)}" data-n="${n}" title="${label(status)}: ${n}"></span>`
  ).join('');
  const bar = `<div class="rollup-bar${mode === 'collapsed' ? ' thin' : ''}">${segs}</div>`;
  if (mode === 'collapsed') return `<div class="rollup">${bar}</div>`;
  const done = segments.filter(({ status }) => status === 'done').map(({ n }) => `<span class="rollup-count">${n} done</span>`);
  const others = segments.filter(({ status }) => status !== 'done').map(({ status, n }) =>
    `<span class="rollup-count rollup-count--${ROLLUP_STATUS_COLORS.statusColorClass(status)}">${n} ${label(status)}</span>`);
  const items = done.concat(others);
  return `<div class="rollup">${bar}<div class="rollup-counts"><b class="rollup-total">${rollup.total}</b> ${items.join(' ')}</div></div>`;
}

// The roll-up counts only this board's cards: a parent cannot know about
// children on a board it never reads.
function rollupScopeLine(rollup, countArchived) {
  const board = rollup.scope && rollup.scope.board;
  const where = board ? `Counted on this board only (${ROLLUP_ASSIGNEE_BADGE.escapeHtml(board)}).` : 'Counted on this board only.';
  return `${where} ${countArchived ? 'Archived leaves count as done.' : 'Archived leaves are left out.'}`;
}

function rollupDetailHtml(rollup, altitude, order, countArchived) {
  const bar = rollupBar(rollup, 'open', order) || '<div class="rollup-empty">No leaves counted.</div>';
  return `<div class="rollup-title">Roll-up <span class="rollup-sub">leaves below</span> ${altitudeBadge(altitude)}</div>` +
    bar +
    `<div class="rollup-scope">${rollupScopeLine(rollup, countArchived)}</div>`;
}

// Marking a parent done with leaves still open warns and never blocks.
function openLeavesWarning(items) {
  const open = items.filter((i) => i.open > 0);
  if (!open.length) return '';
  return `Done with open leaves below: ${open.map((i) => `#${i.id} (${i.open} open)`).join(', ')}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { altitudeBadge, rollupSegments, rollupBar, rollupScopeLine, rollupDetailHtml, openLeavesWarning };
} else {
  window.altitudeBadge = altitudeBadge;
  window.rollupSegments = rollupSegments;
  window.rollupBar = rollupBar;
  window.rollupScopeLine = rollupScopeLine;
  window.rollupDetailHtml = rollupDetailHtml;
  window.openLeavesWarning = openLeavesWarning;
}
