'use strict';
// The search panel: the panel that hangs under the search box. Focusing the box opens
// it while the switch is on, which is the default. The switch is the arrow at the box's
// right end (#search-panel-toggle, announced with aria-pressed): switched off, the panel
// closes now and focusing the box no longer opens it; switched on again, the panel opens
// now and opens on focus again. The p key flips the same switch, through the key guard
// (key-guard.js); the panel is no surface there, so p works with the panel open. The
// choice is kept per board in the preferences (prefs.js, panelOnFocus) and the
// preferences sheet shows and sets it too (app.js, setPanelOnFocus). The panel has four
// regions, each drawn on its own so that what joins the panel later extends one
// without editing another: the slice section (#search-slices, with its fold control,
// drawn by search-slices.js), the pill section (#search-pills, with its fold control), a
// divider, and a foot (#search-foot, empty for now).
//
// The pills come from pills.js (the list, the counts, which are on) and are drawn
// here. A pill is on while its query is the anchor of the selection or one of its
// additions, so nothing about "on" is kept here: it is read off the selection every
// time. The pills follow the status pills' rules: a click (Shift or not) turns one pill
// on or off, its query joining the selection and the box as one more alternative or
// leaving both, and a right-click solos it, or turns every pill off when it is the one
// soloed (selection.js decides both, and the search module's alternatives do the box).
// The first pill on is the anchor and later ones are additions. The buttons are built once
// and then updated in place by every render, the poll's included, so a pill that has
// focus keeps it and its count changes under it. The panel adds no `data-holds-poll`:
// a button left focused by a click would stop the poll for good.
//
// Esc: the panel is one link of the Esc chain (closeSearchPanel, called from the
// document's Esc handler in app.js after the popups and before the selection step).
// The combobox's suggestion list takes Esc before the panel, and the panel before
// the step back. Closing the panel hands focus back to the toggle, except when the Esc
// was pressed in the box, where focus stays so that the next Esc clears the box. Both
// steps stop the browser's own Esc, which clears a search field, so the box keeps its
// text until that last Esc. Esc leaves the switch as it was: the box, still focused,
// opens the panel again the next time it is focused.
//
// This script reads app.js's globals at the moment it runs, never when it loads, the
// way graph-view.js does: $, state, selectionState, setSelection, writeSearch,
// searchMatchIds, cardsBeforeSearch, loadPrefsState, setPanelOnFocus, keyGuardOff.

let searchPanelOpen = false;
// Whether the pill section is folded for this visit; null until it is read from the
// preferences, which have to wait for the board's name (they are kept per board).
let searchPillsFolded = null;
let searchPillsFoldedFor = '';

const SEARCH_PILL_HINT = 'click: turn it on or off, right-click: only this pill (again: every pill off)';
const SEARCH_SWITCH_ON = 'Search panel: opens when the box is focused. Click, or press p, to switch it off.';
const SEARCH_SWITCH_OFF = 'Search panel: off. Click, or press p, to switch it on and open it.';

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

// The chip a closed panel shows: how many pills are on, and a run of slices that cuts, and
// a name that says which.
function syncSearchChip(selection) {
  const chip = $('#search-chip');
  if (!chip) return;
  const { count, name } = panelChip(pillsOn(selection, BUILT_IN_PILLS).map((pill) => pill.label).concat(searchSlicesChipNames()));
  chip.classList.toggle('hidden', !count || searchPanelOpen);
  chip.textContent = count ? String(count) : '';
  chip.setAttribute('aria-label', name);
}

// Every repaint of the board comes here (renderBoard): the chip always, the pills
// only while the panel is open, since a closed panel shows no count.
function renderSearchPanel() {
  applyPillsFold();
  renderSearchSlices();
  syncSearchSwitch();
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

// --- the switch --------------------------------------------------------------------------------

// Whether the panel opens when the box is focused: the choice kept in the preferences.
function searchPanelSwitchOn() {
  return loadPrefsState().panelOnFocus;
}

// The arrow says whether the switch is on (aria-pressed) and what a click does.
function syncSearchSwitch() {
  const toggle = $('#search-panel-toggle');
  if (!toggle) return;
  const on = searchPanelSwitchOn();
  const pressed = String(on);
  if (toggle.getAttribute('aria-pressed') !== pressed) toggle.setAttribute('aria-pressed', pressed);
  const title = on ? SEARCH_SWITCH_ON : SEARCH_SWITCH_OFF;
  if (toggle.title !== title) toggle.title = title;
}

// What a change of the switch does to the panel, after setPanelOnFocus (app.js) has kept
// the choice. Off closes the panel now, by the Esc rule: focus goes to the arrow unless
// the box has it, because a pill that had it is hidden with the panel. On opens the
// panel now when `openNow` says so; the arrow and p do, the preferences sheet, which is
// up over the board, does not.
function applySearchPanelSwitch(on, openNow) {
  if (!on) closeSearchPanel();
  else if (openNow) setSearchPanelOpen(true);
  syncSearchSwitch();
}

// The arrow's click and the p key.
function flipSearchPanelSwitch() {
  setPanelOnFocus(!searchPanelSwitchOn(), true);
}

// The box was focused: with the switch on, the panel opens.
function onSearchBoxFocus() {
  if (searchPanelSwitchOn() && !searchPanelOpen) setSearchPanelOpen(true);
}

// p: the same switch as the arrow. A key that types nothing but reads a letter, so it reads
// the whole key guard: off while a field has focus and while a menu, a dialog, the
// notifications panel or the preferences sheet is up. A chord (Ctrl, Cmd, Alt), Shift on
// the key and a held key are not it; Caps Lock gives a capital P with no Shift, and counts.
function onSearchPanelKey(e) {
  if (!e.key || e.key.toLowerCase() !== 'p' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (keyGuardOff(document)) return;
  e.preventDefault();
  flipSearchPanelSwitch();
}

// Esc's link in the chain: an open panel closes and answers true so the Esc stops
// there, a closed one answers false. Focus goes back to the toggle, unless it is in
// the box: the box keeps it, and the next Esc clears the box.
function closeSearchPanel() {
  if (!searchPanelOpen) return false;
  const box = $('#search-input');
  const fromBox = !!box && document.activeElement === box;
  setSearchPanelOpen(false);
  if (!fromBox) $('#search-panel-toggle').focus();
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

// Carries out what selection.js decides for a click ('toggle') or a right-click
// ('solo') on the pill with this key: the selection and the text of the box change
// together, and the box is written with the reason 'pill', so the repaint does not
// take it for a typed search. A run of slices in the box is not the pills' to change: it
// is set apart for the gesture and put back after it.
function applyPillGesture(gesture, key) {
  const pill = BUILT_IN_PILLS.find((p) => p.key === key);
  if (!pill) return;
  const { rest, slices } = searchSplitSlice($('#search-input').value);
  const next = selectionAfterPill(gesture, pill.query, {
    selection: selectionState.selection,
    boxText: rest,
    alts: { add: searchAddAlt, remove: searchRemoveAlt },
  });
  setSelection(next.selection, next.rangeStart);
  writeSearch(searchJoinSlice(next.boxText, slices), 'pill');
}

// A click toggles the pill, whatever modifier is held: Shift+click is a plain click.
function onPillClick(e) {
  const button = e.target.closest('.query-pill');
  if (button) applyPillGesture('toggle', button.dataset.pillKey);
}

// The other mouse button solos the pill, and the browser's own menu stays shut.
function onPillContextMenu(e) {
  const button = e.target.closest('.query-pill');
  if (!button) return;
  e.preventDefault();
  applyPillGesture('solo', button.dataset.pillKey);
}

window.addEventListener('DOMContentLoaded', () => {
  const pills = $('#search-pills');
  pills.addEventListener('click', onPillClick);
  pills.addEventListener('contextmenu', onPillContextMenu);
  $('#search-panel-toggle').addEventListener('click', flipSearchPanelSwitch);
  $('#search-input').addEventListener('focus', onSearchBoxFocus);
  document.addEventListener('keydown', onSearchPanelKey);
  $('#search-pills-fold').addEventListener('click', toggleSearchPillsFold);
  document.addEventListener('mousedown', onSearchPanelOutside);
});
