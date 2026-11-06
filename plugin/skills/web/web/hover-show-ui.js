'use strict';
// The search panel's "On hover show" section: six checkboxes, one per set (dtree, htree, dpath, hpath, dlinks,
// hlinks), that choose which sets a hover or a keyboard focus on a card lights, and under them the Hierarchy
// and Dependencies toggles (above&below, above, below; before&after, before, after) that cut the h sets and
// the d sets to one side of the card. The Graph's side panel has the same eight controls in its On hover
// section (graph-view.js), and the two edit the one choice, each showing a change made in the other at once
// (syncHoverShowPanel). The choice is kept per board in this browser, under the feature key 'hover.show'
// (storageKey), as one record, the same in every view, the Flow included (hover-show.js merges it with the
// defaults, so a value this version does not offer, or storage that refuses, reads as the default).
//
// Space takes the hover: on a hovered card, else the focused one, it writes the terms of the ticked sets into
// the search box (`dlinks:12 | hlinks:12`), and Shift+Space adds them to what the box holds as more
// alternatives (searchWithTerms, search.js). With no card under the pointer or focused, a line the pointer is on
// in the Graph writes the cards it lights as card terms (`#176 | #50`: a parent line its parent and child, a
// dependency the card waited for and the card that waits, a bracket its parent and its children as drawn),
// whatever sets are ticked; a card under the pointer or focused wins over it. The write has its own reason, 'hover', which is not among the ones
// that turn isolate on, so the box lights the sets or hides by the isolate switch as it stood.
//
// This script reads app.js's globals at the moment it runs, never when it loads, the way search-panel.js
// does: state, storageKey, loadViewMode, hoveredId, searchCtx, refreshHover, writeSearch, $. It also calls
// graphHoverLineTerms (graph-view.js), hover-show.js (mergeHoverShow, hoverShowWith, hoverShowStep, hoverShowSides, hoverShowIds,
// hoverShowTerms), hotkeys.js (hotkeySpace), search.js (searchWithTerms) and key-guard.js (keyGuardDetailOff).

let hoverShowMemo = null;

function hoverShowLoad() {
  if (hoverShowMemo) return hoverShowMemo;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(state.projectName, 'hover.show')); }
  catch (e) { saved = null; }
  hoverShowMemo = mergeHoverShow(saved);
  return hoverShowMemo;
}

function hoverShowSave() {
  try { localStorage.setItem(storageKey(state.projectName, 'hover.show'), JSON.stringify(hoverShowMemo)); }
  catch (e) { /* storage unavailable — the choice just won't persist this session */ }
}

function hoverShowKindsNow() {
  return hoverShowLoad().kinds;
}

function hoverShowSidesNow() {
  return hoverShowSides(hoverShowLoad());
}

// The cards that light with `id` under the choice now, `id` among them when any set is ticked.
function hoverSetOf(id) {
  return hoverShowIds(hoverShowKindsNow(), state.active.concat(state.archived), id, searchCtx(), hoverShowSidesNow());
}

const hoverFold = searchFoldSection('hoverFolded', '#search-hover', '#search-hover-fold');
const applyHoverFold = hoverFold.apply;
const toggleSearchHoverFold = hoverFold.toggle;
const foldSearchHover = hoverFold.set;

// How a toggle names itself: its state is its label, and the name a screen reader hears says which relation it cuts.
const HOVER_SIDE_NAMES = { hierarchy: 'Hierarchy', dependencies: 'Dependencies' };

function paintHoverSide(btn, toggle, side) {
  if (btn.textContent !== side) btn.textContent = side;
  btn.setAttribute('aria-label', `${HOVER_SIDE_NAMES[toggle]}: ${side}`);
  btn.title = `${HOVER_SIDE_NAMES[toggle]}: ${side}. Click for the next side.`;
}

// Every repaint of the board comes here (renderSearchPanel), and so does a pick: the search panel's boxes
// and toggles and the Graph's side panel's (graph-view.js, keys hover and hover-side) show the one choice.
function syncHoverShowPanel() {
  applyHoverFold();
  const kinds = hoverShowKindsNow();
  const sides = hoverShowSidesNow();
  document.querySelectorAll('#graph-view .graph-option-btn[data-key="hover"], #graph-view .graph-option-btn[data-key="hover-side"]').forEach((btn) => {
    if (btn.dataset.key === 'hover-side') { paintHoverSide(btn, btn.dataset.val, sides[btn.dataset.val]); return; }
    const on = kinds.includes(btn.dataset.val);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const host = $('#search-hover');
  if (!host) return;
  host.querySelectorAll('[data-hover-kind]').forEach((box) => {
    const on = kinds.includes(box.dataset.hoverKind);
    if (box.checked !== on) box.checked = on;
  });
  host.querySelectorAll('[data-hover-side]').forEach((btn) => paintHoverSide(btn, btn.dataset.hoverSide, sides[btn.dataset.hoverSide]));
}

function hoverShowPick(kind, on) {
  hoverShowMemo = hoverShowWith(hoverShowLoad(), kind, on);
  hoverShowSave();
  syncHoverShowPanel();
  refreshHover();
}

// A press on a toggle: its next state, the one choice kept and shown in both panels.
function hoverShowStepSide(toggle) {
  hoverShowMemo = hoverShowStep(hoverShowLoad(), toggle);
  hoverShowSave();
  syncHoverShowPanel();
  refreshHover();
}

// The controls that answer Space themselves: it presses a button, flips a switch or a tab, opens a summary.
const HOVER_SPACE_OWN = 'input, textarea, select, button, a, summary, [contenteditable="true"], [role="button"], [role="checkbox"], [role="switch"], [role="tab"]';

// The card Space acts on: the one under the pointer, else the one with the focus.
function hoverSpaceSubject() {
  if (hoveredId != null) return hoveredId;
  const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.card-el') : null;
  return focused ? focused.dataset.id : null;
}

// With no card to act on, the line the pointer is on in the Graph: its cards as card terms, the ones it lights
// (graphHoverLineTerms, graph-view.js). A line always writes its cards, whatever the sets ticked.
function hoverSpaceLineTerms() {
  return loadViewMode() === 'graph' ? graphHoverLineTerms() : '';
}

// Space, a key that would scroll the page, so it reads the whole key guard (off while a field has focus and
// while a menu, a dialog, the notifications panel, the preferences sheet or the notes palette is up) and
// leaves a control that answers it alone, a todo item's tick included. With no card to act on, or no set
// ticked, it keeps its job. A held key acts once.
function onHoverSpaceKey(e) {
  const kind = hotkeySpace(e);
  if (kind !== 'write' && kind !== 'add') return;
  if (e.defaultPrevented) return;
  if (keyGuardDetailOff(document)) return;
  if (e.target && e.target.closest && e.target.closest(HOVER_SPACE_OWN)) return;
  const id = hoverSpaceSubject();
  const terms = id == null ? hoverSpaceLineTerms() : hoverShowTerms(hoverShowKindsNow(), window.kanbanIds.idKey(id) ?? id, hoverShowSidesNow());
  if (!terms) return;
  e.preventDefault();
  const box = $('#search-input');
  const text = searchWithTerms(box.value, terms, kind === 'add');
  if (text !== box.value) writeSearch(text, 'hover');
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', onHoverSpaceKey);
  $('#search-hover-fold').addEventListener('click', toggleSearchHoverFold);
  $('#search-hover').addEventListener('change', (e) => {
    const box = e.target.closest('[data-hover-kind]');
    if (box) hoverShowPick(box.dataset.hoverKind, box.checked);
  });
  $('#search-hover').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-hover-side]');
    if (btn) hoverShowStepSide(btn.dataset.hoverSide);
  });
});
