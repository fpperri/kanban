'use strict';
// The search panel's Statuses section: the current view's own status pills (the Map, the Gantt,
// the Calendar, the Graph), first in the panel, open to start, folding like the other sections.
// The Board has no status pills, so the section is out of the panel there.
//
// Which pills and what they say come from the status-filter registry (status-filters.js), read on
// every render, the panel open or closed, so the section is current the moment the panel opens. A
// tap switches that status in the view and a right-click solos it, the registry's own toggle and
// solo, so the view and the section never disagree. Every pill is always drawn: with every status
// off the view shows no card, and the pills are how the cards come back.
//
// The buttons are built once and then updated in place by every render, the poll's included, keyed
// by status (syncKeyedChildren, search-panel.js), so a pill that has focus keeps it. They keep the
// selection and wear no `data-holds-poll` (a button left focused by a click would stop the poll for
// good). The section never reads or writes the selection.
//
// This script reads app.js's globals at the moment it runs, never when it loads: $,
// loadViewMode, boardColumnIds, columnLabel, statusColorVar. It also calls the page globals of
// status-filters.js (STATUS_FILTERS, statusFilterTitle) and search-panel.js (syncKeyedChildren).

const STATUS_PILL_SOLO_HINT = 'Right-click to solo (right-click the soloed pill again to restore all).';

// Whether the section is folded for this visit, and the board that choice was made for; null until
// the preference has been read (the fold preference starts it, off by default: open).
let searchStatusesFolded = null;
let searchStatusesFoldedFor = null;

function statusPillTitle(view, col, on) {
  return `${statusFilterTitle(view, col, columnLabel(col), on)} ${STATUS_PILL_SOLO_HINT}`;
}

// One status pill for `view`: its identity dot in the status colour, then the label.
function buildStatusPill(doc, view, col, on) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'status-pill';
  button.dataset.col = col;
  button.dataset.keepsSelection = '';
  const dot = doc.createElement('span');
  dot.className = 'pill-dot';
  dot.style.color = statusColorVar(col);
  const label = doc.createElement('span');
  label.textContent = columnLabel(col);
  button.append(dot, label);
  updateStatusPill(button, view, col, on);
  return button;
}

function updateStatusPill(button, view, col, on) {
  const pressed = String(on);
  if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  button.classList.toggle('off', !on);
  const title = statusPillTitle(view, col, on);
  if (button.title !== title) button.title = title;
}

// Draws the section for the view showing now: hidden on the Board, otherwise one pill per board
// status and Archive, in column order, in the view's own state.
function renderSearchStatuses() {
  const section = $('#search-statuses-section');
  const host = $('#search-statuses');
  if (!section || !host) return;
  const view = loadViewMode();
  const entry = STATUS_FILTERS[view];
  section.classList.toggle('hidden', !entry);
  applyStatusesFold();
  if (!entry) return;
  const filter = entry.load();
  const doc = host.ownerDocument || document;
  syncKeyedChildren(host, 'col', boardColumnIds(), (col) => col,
    (col) => buildStatusPill(doc, view, col, filter[col] !== false),
    (button, col) => updateStatusPill(button, view, col, filter[col] !== false));
}

// Whether the section is folded: the choice made at the fold control for this visit, or the
// preference until there is one.
function currentStatusesFolded() {
  if (searchStatusesFolded === null || searchStatusesFoldedFor !== state.projectName) {
    searchStatusesFolded = loadPrefsState().statusesFolded;
    searchStatusesFoldedFor = state.projectName;
  }
  return searchStatusesFolded;
}

function applyStatusesFold() {
  const folded = currentStatusesFolded();
  const host = $('#search-statuses');
  const fold = $('#search-statuses-fold');
  if (host) host.classList.toggle('hidden', folded);
  if (fold) fold.setAttribute('aria-expanded', String(!folded));
}

// The fold control: folds or unfolds the section for this visit only.
function toggleSearchStatusesFold() {
  searchStatusesFolded = !currentStatusesFolded();
  applyStatusesFold();
}

// The preference changed in the sheet: the section takes it now.
function foldSearchStatuses(folded) {
  searchStatusesFolded = !!folded;
  searchStatusesFoldedFor = state.projectName;
  applyStatusesFold();
}

// What the search chip adds for the view showing now: one name per status switched off, read through
// the registry; none on the Board. Archive counts only when it is off against the view's default (the
// Map shows it to start, the others hide it), so a view at its defaults adds nothing.
function searchStatusesChipNames() {
  const entry = STATUS_FILTERS[loadViewMode()];
  if (!entry) return [];
  const filter = entry.load();
  return boardColumnIds()
    .filter((col) => filter[col] === false && (col !== 'archive' || entry.archiveDefault))
    .map((col) => `${columnLabel(col).toLowerCase()} hidden`);
}

// What a tap ('toggle') or a right-click ('solo') on a pill does: the registry's own call for the
// view showing now.
function applyStatusGesture(gesture, button) {
  const entry = STATUS_FILTERS[loadViewMode()];
  if (entry) entry[gesture](button.dataset.col);
}

function onStatusPillClick(e) {
  const button = e.target.closest('.status-pill');
  if (button) applyStatusGesture('toggle', button);
}

function onStatusPillContextMenu(e) {
  const button = e.target.closest('.status-pill');
  if (!button) return;
  e.preventDefault();
  applyStatusGesture('solo', button);
}

window.addEventListener('DOMContentLoaded', () => {
  const pills = $('#search-statuses');
  pills.addEventListener('click', onStatusPillClick);
  pills.addEventListener('contextmenu', onStatusPillContextMenu);
  $('#search-statuses-fold').addEventListener('click', toggleSearchStatusesFold);
});
