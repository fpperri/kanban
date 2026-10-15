'use strict';
// The search panel: the panel that hangs under the search box, opened by the
// toggle at the box's right end. Focusing the box never opens it. It has four
// regions, each drawn on its own so that what joins the panel later extends one
// without editing another: the slices (#search-slices, empty for now), the pill
// section (#search-pills, with its fold control), a divider, and a foot
// (#search-foot, empty for now).
//
// The pills come from pills.js (the list, the counts, which are on) and are drawn
// here. A pill is on while its query is the anchor of the selection or one of its
// additions, so nothing about "on" is kept here: it is read off the selection every
// time. A click, with either button, makes the pill's query the anchor and writes it
// to the box; Shift adds it to the selection and grows the box (selection.js decides
// both, and the search module's alternatives do the box). The buttons are built once
// and then updated in place by every render, the poll's included, so a pill that has
// focus keeps it and its count changes under it. The panel adds no `data-holds-poll`:
// a button left focused by a click would stop the poll for good.
//
// Esc: the panel is one link of the Esc chain (closeSearchPanel, called from the
// document's Esc handler in app.js after the popups and before the selection step).
// The combobox's suggestion list takes Esc before the panel, and the panel before
// the step back; closing the panel hands focus back to the toggle.
//
// This script reads app.js's globals at the moment it runs, never when it loads, the
// way graph-view.js does: $, state, selectionState, setSelection, writeSearch,
// searchMatchIds, cardsBeforeSearch, loadPrefsState.

let searchPanelOpen = false;
// Whether the pill section is folded for this visit; null until it is read from the
// preferences, which have to wait for the board's name (they are kept per board).
let searchPillsFolded = null;
let searchPillsFoldedFor = '';

const SEARCH_PILL_HINT = 'click: only this pill, shift+click: add it or take it out';

function searchPanelIsOpen() {
  return searchPanelOpen;
}

// The pills the panel lists now, each with how many of the cards the view shows
// (before the search box and any cut) its query matches.
function searchPanelPills() {
  return pillList(cardsBeforeSearch(), searchMatchIds);
}

// --- the pill buttons --------------------------------------------------------------------

function buildPillButton(doc, pill) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'query-pill';
  button.dataset.pillKey = pill.key;
  button.dataset.keepsSelection = '';
  const label = doc.createElement('span');
  label.className = 'query-pill-label';
  label.textContent = pill.label;
  const count = doc.createElement('span');
  count.className = 'query-pill-count';
  button.append(label, count);
  return button;
}

function updatePillButton(button, pill, on) {
  const count = button.children[1];
  const text = String(pill.count);
  if (count.textContent !== text) count.textContent = text;
  const pressed = String(on);
  if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  button.classList.toggle('on', on);
  const title = `${pill.query}  (${SEARCH_PILL_HINT})`;
  if (button.title !== title) button.title = title;
}

// Makes the buttons in `host` the list: one per pill, in order, each showing its
// count and whether it is on. A button that is there is updated where it stands, so
// focus on it is never lost; one is added or taken out only when the list changes.
function syncPillButtons(host, list, selection) {
  const doc = host.ownerDocument || document;
  const byKey = new Map([...host.children].map((el) => [el.dataset.pillKey, el]));
  list.forEach((pill, at) => {
    const button = byKey.get(pill.key) || buildPillButton(doc, pill);
    updatePillButton(button, pill, pillIsOn(selection, pill));
    if (host.children[at] !== button) host.insertBefore(button, host.children[at] || null);
  });
  const keys = new Set(list.map((pill) => pill.key));
  for (const el of [...host.children]) if (!keys.has(el.dataset.pillKey)) el.remove();
}

// The chip a closed panel shows: how many pills are on, and a name that says which.
function syncSearchChip(selection) {
  const chip = $('#search-chip');
  if (!chip) return;
  const { count, name } = panelChip(pillsOn(selection, BUILT_IN_PILLS).map((pill) => pill.label));
  chip.classList.toggle('hidden', !count || searchPanelOpen);
  chip.textContent = count ? String(count) : '';
  chip.setAttribute('aria-label', name);
}

// Every repaint of the board comes here (renderBoard): the chip always, the pills
// only while the panel is open, since a closed panel shows no count.
function renderSearchPanel() {
  applyPillsFold();
  const selection = selectionState.selection;
  const host = $('#search-pills');
  if (searchPanelOpen && host) syncPillButtons(host, searchPanelPills(), selection);
  syncSearchChip(selection);
}

// --- open, close ------------------------------------------------------------------------------

function setSearchPanelOpen(open) {
  searchPanelOpen = !!open;
  $('#search-panel').classList.toggle('hidden', !searchPanelOpen);
  $('#search-panel-toggle').setAttribute('aria-expanded', String(searchPanelOpen));
  renderSearchPanel();
}

function toggleSearchPanel() {
  setSearchPanelOpen(!searchPanelOpen);
}

// Esc's link in the chain: an open panel closes and focus goes back to the toggle,
// and answers true so the Esc stops there; a closed one answers false.
function closeSearchPanel() {
  if (!searchPanelOpen) return false;
  setSearchPanelOpen(false);
  $('#search-panel-toggle').focus();
  return true;
}

// A press anywhere outside the search bar closes the panel, as it closes any popup.
function onSearchPanelOutside(e) {
  if (!searchPanelOpen || e.target.closest('.search-bar')) return;
  setSearchPanelOpen(false);
}

// --- the fold --------------------------------------------------------------------------------------

// Whether the pill section is folded: the choice made at the fold control for this
// visit, or the preference until there is one.
function currentPillsFolded() {
  if (searchPillsFolded === null || searchPillsFoldedFor !== state.projectName) {
    searchPillsFolded = loadPrefsState().pillsFolded;
    searchPillsFoldedFor = state.projectName;
  }
  return searchPillsFolded;
}

function applyPillsFold() {
  const folded = currentPillsFolded();
  const host = $('#search-pills');
  const fold = $('#search-pills-fold');
  if (host) host.classList.toggle('hidden', folded);
  if (fold) fold.setAttribute('aria-expanded', String(!folded));
}

// The fold control: folds or unfolds the section for this visit only.
function toggleSearchPillsFold() {
  searchPillsFolded = !currentPillsFolded();
  applyPillsFold();
}

// The preference changed in the sheet: the section takes it now.
function foldSearchPills(folded) {
  searchPillsFolded = !!folded;
  searchPillsFoldedFor = state.projectName;
  applyPillsFold();
}

// --- a click on a pill ---------------------------------------------------------------------------

// Carries out what selection.js decides for a click ('click') or a Shift+click
// ('add') on the pill with this key: the selection and the text of the box change
// together, and the box is written with the reason 'pill', so the repaint does not
// take it for a typed search.
function applyPillGesture(gesture, key) {
  const pill = BUILT_IN_PILLS.find((p) => p.key === key);
  if (!pill) return;
  const next = selectionAfterPill(gesture, pill.query, {
    selection: selectionState.selection,
    boxText: $('#search-input').value,
    alts: { add: searchAddAlt, remove: searchRemoveAlt },
  });
  setSelection(next.selection, next.rangeStart);
  writeSearch(next.boxText, 'pill');
}

function onPillClick(e) {
  const button = e.target.closest('.query-pill');
  if (button) applyPillGesture(e.shiftKey ? 'add' : 'click', button.dataset.pillKey);
}

// The other mouse button does what a click does, and the browser's own menu stays shut.
function onPillContextMenu(e) {
  const button = e.target.closest('.query-pill');
  if (!button) return;
  e.preventDefault();
  applyPillGesture(e.shiftKey ? 'add' : 'click', button.dataset.pillKey);
}

window.addEventListener('DOMContentLoaded', () => {
  const pills = $('#search-pills');
  pills.addEventListener('click', onPillClick);
  pills.addEventListener('contextmenu', onPillContextMenu);
  $('#search-panel-toggle').addEventListener('click', toggleSearchPanel);
  $('#search-pills-fold').addEventListener('click', toggleSearchPillsFold);
  document.addEventListener('mousedown', onSearchPanelOutside);
});
