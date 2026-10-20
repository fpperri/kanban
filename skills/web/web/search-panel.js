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
// divider, and a foot (#search-foot, which holds the Isolate switch: isolate.js).
//
// The pills come from pills.js (the list, the counts, which are on) and are drawn
// here: the three built-ins, then the board's own pills (state.pills, the config's
// `pills:`), a `field:*` entry made into one pill per value of the board's active
// cards. The first eight values of a field show, and a "+N more" button, which is not
// a pill, opens the rest and folds them again for this visit. A pill is on while its
// query is the anchor of the selection or one of its additions, so nothing about "on"
// is kept here: it is read off the selection every time. The pills follow the status
// pills' rules: a click (Shift or not) turns one pill
// on or off, its query joining the selection and the box as one more alternative or
// leaving both, and a right-click solos it, or turns every pill off when it is the one
// soloed (selection.js decides both, and the search module's alternatives do the box).
// The first pill on is the anchor and later ones are additions. The m key steps through
// the pills, and Shift+m back through them: each press solos the next pill (pillStep in
// pills.js names it), then turns every pill off after the last, whatever the view and
// whether the panel is open. The buttons are built once and then updated in place by
// every render, the poll's included, so a pill that has focus keeps it and its count
// changes under it. The panel adds no `data-holds-poll`: a button left focused by a
// click would stop the poll for good.
//
// The chip is a button, so Tab reaches it, in the box's order, while it is shown, and a click with
// the mouse, or a press of Enter or Space, on it opens the panel (onSearchChipClick). A hidden chip
// is no tab stop. Enter held on it opens the panel once: the arrow ignores the repeats of the held
// key (onSearchSwitchKeyDown).
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
// searchMatchIds, cardsBeforeSearch, loadPrefsState, setPanelOnFocus. It also calls the
// page globals of selection.js (selectionAfterPill, pillQueriesDropped), pills.js, isolate.js
// (isolateNow, syncIsolateSwitch), search-slices.js (renderSearchSlices,
// searchSlicesChipNames), the search module (searchTermText and the alternatives and slice
// functions: searchSplitSlice, searchJoinSlice, searchWithoutCuts, searchAddAlt,
// searchRemoveGrownAlt),
// prefs.js (loadPrefs) and key-guard.js (keyGuardOff).

let searchPanelOpen = false;
// Whether the pill section is folded for this visit; null until it is read from the
// preferences, which have to wait for the board's name (they are kept per board).
let searchPillsFolded = null;
let searchPillsFoldedFor = '';
// The fields whose value pills are all shown rather than the first eight, for this visit.
const searchPillGroupsOpen = new Set();

const SEARCH_PILL_HINT = 'click: turn it on or off, right-click: only this pill (again: every pill off)';
const SEARCH_SWITCH_ON = 'Search panel: opens when the box is focused. Click, or press p, to switch it off.';
const SEARCH_SWITCH_OFF = 'Search panel: off. Click, or press p, to switch it on and open it.';

function searchPanelIsOpen() {
  return searchPanelOpen;
}

// What pills.js lists the board's own pills from: the config's entries, the active
// cards their values come from, and the search module's writer of an exact term.
function searchPanelBoard() {
  return { pills: state.pills, cards: state.active, term: searchTermText };
}

// The pills the panel lists now, with no counts: the chip and a click read these.
function searchPanelEntries() {
  return pillEntries(searchPanelBoard());
}

// The pills the panel lists now, each with how many of the cards the view shows
// (before the search box and any cut) its query matches. Every pill is here, the
// ones behind a "+N more" button too.
function searchPanelPills() {
  return pillList(cardsBeforeSearch(), searchMatchIds, searchPanelBoard());
}

// What the pill section draws: the pills and, where a field has more than eight
// values, its "+N more" button.
function searchPanelRows() {
  return pillRows(searchPanelPills(), [...searchPillGroupsOpen]);
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

// The button that opens the rest of a field's value pills, or folds them again. It is
// not a pill: no count, and a click on it changes neither the box nor the selection.
function buildMoreButton(doc, row) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'query-pill-more';
  button.dataset.pillKey = row.key;
  button.dataset.keepsSelection = '';
  return button;
}

function updateMoreButton(button, row) {
  if (button.textContent !== row.label) button.textContent = row.label;
  const expanded = String(row.expanded);
  if (button.getAttribute('aria-expanded') !== expanded) button.setAttribute('aria-expanded', expanded);
  const name = row.expanded ? `Show only the first ${PILLS_SHOWN} ${row.group} pills` : `Show the other ${row.hidden} ${row.group} pills`;
  if (button.title !== name) button.title = name;
  if (button.getAttribute('aria-label') !== name) button.setAttribute('aria-label', name);
}

function updatePillButton(button, pill, on) {
  const label = button.children[0];
  if (label.textContent !== pill.label) label.textContent = pill.label;
  const count = button.children[1];
  const text = String(pill.count);
  if (count.textContent !== text) count.textContent = text;
  const pressed = String(on);
  if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  button.classList.toggle('on', on);
  const title = `${pill.query}  (${SEARCH_PILL_HINT})`;
  if (button.title !== title) button.title = title;
}

// Makes the children of `host` the list, one per item in order, each found again by its key
// (`keyOf(item)`, kept in the dataset field `dataKey`): the panel's pills and the slice
// section's entries are both kept this way. A child that is there is updated where it stands
// (`update`), so focus on it is never lost; one is added (`build`) or taken out only when the
// list changes, and the ones to go are taken out first, so that a child that stays is never
// moved by the others leaving: moving an element that is in the page blurs it.
function syncKeyedChildren(host, dataKey, list, keyOf, build, update) {
  const keys = new Set(list.map(keyOf));
  for (const el of [...host.children]) if (!keys.has(el.dataset[dataKey])) el.remove();
  const byKey = new Map([...host.children].map((el) => [el.dataset[dataKey], el]));
  list.forEach((item, at) => {
    const child = byKey.get(keyOf(item)) || build(item);
    update(child, item, at);
    if (host.children[at] !== child) host.insertBefore(child, host.children[at] || null);
  });
}

// Makes the buttons in `host` the rows: one per pill, in order, each showing its
// count and whether it is on, and a "+N more" button where a row says so.
function syncPillButtons(host, rows, selection) {
  const doc = host.ownerDocument || document;
  syncKeyedChildren(host, 'pillKey', rows, (row) => row.key,
    (row) => (row.kind === 'more' ? buildMoreButton(doc, row) : buildPillButton(doc, row)),
    (button, row) => (row.kind === 'more' ? updateMoreButton(button, row) : updatePillButton(button, row, pillIsOn(selection, row))));
}

// The chip a closed panel shows: how many things are on (the pills, a run of slices that cuts,
// and isolate), and a name that says which, for a screen reader (its accessible name) and as its
// hover text. While isolate is on the chip reads "isolated", not a number, so a box that hides
// cards says why; the pills and the cut that are on are still in its name.
function syncSearchChip(selection) {
  const chip = $('#search-chip');
  if (!chip) return;
  const isolated = isolateNow() !== null;
  const names = pillsOn(selection, searchPanelEntries()).map((pill) => pill.label).concat(searchSlicesChipNames(), isolated ? ['isolated'] : []);
  const { count, name } = panelChip(names);
  chip.classList.toggle('hidden', !count || searchPanelOpen);
  chip.textContent = isolated ? 'isolated' : count ? String(count) : '';
  chip.setAttribute('aria-label', name);
  if (chip.title !== name) chip.title = name;
}

// Every repaint of the board comes here (renderBoard): the chip always, the pills
// only while the panel is open, since a closed panel shows no count.
function renderSearchPanel() {
  applyPillsFold();
  renderSearchStatuses();
  renderSearchSlices();
  syncSearchSwitch();
  syncIsolateSwitch();
  const selection = selectionState.selection;
  const host = $('#search-pills');
  if (searchPanelOpen && host) syncPillButtons(host, searchPanelRows(), selection);
  syncSearchChip(selection);
}

// --- open, close ------------------------------------------------------------------------------

function setSearchPanelOpen(open) {
  searchPanelOpen = !!open;
  $('#search-panel').classList.toggle('hidden', !searchPanelOpen);
  $('#search-panel-toggle').setAttribute('aria-expanded', String(searchPanelOpen));
  renderSearchPanel();
}

// The chip's activation: a click with the mouse, or Enter or Space, which a button turns into a
// click that has no pointer behind it (the way assistive technology activates one too). All of them
// do the same. The panel opens whatever the arrow's switch says, since this is a press on purpose
// and leaves the switch as it was. The chip leaves with the open panel, so focus goes to the arrow,
// the control Esc hands focus back to, and not into the box, whose focus would open its suggestion
// list over the panel.
function onSearchChipClick() {
  setSearchPanelOpen(true);
  $('#search-panel-toggle').focus();
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
// the choice. Off closes the panel now: focus goes to the arrow when a pill or a fold control
// in the panel had it, since that goes with the panel, and stays wherever else it was (the box,
// the arrow, the preferences sheet that set the switch, the board). On opens the
// panel now when `openNow` says so; the arrow and p do, the preferences sheet, which is
// up over the board, does not.
function applySearchPanelSwitch(on, openNow) {
  if (!on) closeSearchPanel(true);
  else if (openNow) setSearchPanelOpen(true);
  syncSearchSwitch();
}

// The arrow's click and the p key.
function flipSearchPanelSwitch() {
  setPanelOnFocus(!searchPanelSwitchOn(), true);
}

// A key held down repeats its keydown, and a browser clicks a button for every Enter keydown, the
// repeats included. Enter held on the chip opens the panel and hands focus to the arrow with the key
// still down, so the repeats land on the arrow and would flip its switch over and over. The arrow
// ignores them: only the keydown that starts a press switches, and stopping a repeat is what stops
// its click. Other keys, held or not, are left to the browser (a held Tab keeps moving focus).
function onSearchSwitchKeyDown(e) {
  if (e.repeat && e.key === 'Enter') e.preventDefault();
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
// Switching the panel off (`strandedOnly`) moves focus only when it was inside the panel, which
// goes with it: a focus anywhere else, in the preferences sheet that set the switch or on the
// board behind it, stays where it is.
function closeSearchPanel(strandedOnly = false) {
  if (!searchPanelOpen) return false;
  const box = $('#search-input');
  const active = document.activeElement;
  const fromBox = !!box && active === box;
  const panel = $('#search-panel');
  const stranded = !!panel && !!active && panel.contains(active);
  setSearchPanelOpen(false);
  if (strandedOnly ? stranded : !fromBox) $('#search-panel-toggle').focus();
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
// is set apart for the gesture and put back after it, but for the cut a pill held in its
// own query (a board pill `slice:goal`), which goes with the pill when the gesture
// turns it off: its copy of it, so a cut the box held before, if it is the same cut, stays.
function applyPillGesture(gesture, key) {
  const pill = searchPanelEntries().find((p) => p.key === key);
  if (!pill) return;
  const { rest, slices: held } = searchSplitSlice($('#search-input').value);
  const before = selectionState.selection;
  const next = selectionAfterPill(gesture, pill.query, {
    selection: before,
    boxText: rest,
    alts: { add: searchAddAlt, remove: searchRemoveGrownAlt },
  });
  const cut = pillQueriesDropped(before, next.selection).flatMap((query) => searchSplitSlice(query).slices);
  const slices = searchWithoutCuts(held, cut);
  setSelection(next.selection, next.rangeStart);
  writeSearch(searchJoinSlice(next.boxText, slices), 'pill');
}

// The m key: one step through the pills, forward (1) or back (-1). The step is a solo, as a
// right-click on the pill the step lands on would be; after the last pill that solo is on a
// pill that is on alone, so it turns every pill off. A value pill the "+N more" button hides
// is shown first, so that its button is on the panel when the step lands on it.
function stepSearchPill(direction) {
  const pill = pillStep(searchPanelEntries(), selectionState.selection, direction);
  if (!pill) return;
  if (pill.group) searchPillGroupsOpen.add(pill.group);
  applyPillGesture('solo', pill.key);
}

// m and Shift+m: a key that types nothing but reads a letter, so it reads the whole key guard,
// as p does: off while a field has focus and while a menu, a dialog, the notifications panel or
// the preferences sheet is up. A chord (Ctrl, Cmd, Alt) and a held key are not it. Shift on
// the key says backwards, whatever the letter's case: Caps Lock gives a capital M with no
// Shift, which is forward.
function onPillStepKey(e) {
  if (!e.key || e.key.toLowerCase() !== 'm' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (keyGuardOff(document)) return;
  e.preventDefault();
  stepSearchPill(e.shiftKey ? -1 : 1);
}

// A click on a "+N more" button opens that field's other pills, or folds them again.
function toggleSearchPillGroup(group) {
  if (searchPillGroupsOpen.has(group)) searchPillGroupsOpen.delete(group);
  else searchPillGroupsOpen.add(group);
  renderSearchPanel();
}

// A click toggles the pill, whatever modifier is held: Shift+click is a plain click.
function onPillClick(e) {
  const more = e.target.closest('.query-pill-more');
  if (more) { toggleSearchPillGroup(more.dataset.pillKey.replace(/^more:/, '')); return; }
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
  $('#search-panel-toggle').addEventListener('keydown', onSearchSwitchKeyDown);
  $('#search-chip').addEventListener('click', onSearchChipClick);
  $('#search-input').addEventListener('focus', onSearchBoxFocus);
  document.addEventListener('keydown', onSearchPanelKey);
  document.addEventListener('keydown', onPillStepKey);
  $('#search-pills-fold').addEventListener('click', toggleSearchPillsFold);
  document.addEventListener('mousedown', onSearchPanelOutside);
});
