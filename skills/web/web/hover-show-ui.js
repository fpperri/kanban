'use strict';
// The search panel's "On hover show" section: six checkboxes, one per set (dtree, htree, dpath, hpath, dlinks,
// hlinks), that choose which sets a hover or a keyboard focus on a card lights. The Graph's side panel has the
// same six as toggles in its On hover section (graph-view.js), and the two edit the one choice, each showing a
// change made in the other at once (syncHoverShowPanel). The choice is kept
// per board in this browser, under the feature key 'hover.show' (storageKey), as one list of sets per graph
// kind, the Hierarchy's and the Flow's (hover-show.js merges it with the defaults, so a value this version
// does not offer, or storage that refuses, reads as the default). The panel shows the choice of the view
// that is on: the Flow's in the Graph's Flow, the Hierarchy's everywhere else.
//
// Space takes the hover: on a hovered card, else the focused one, it writes the terms of the ticked sets into
// the search box (`dlinks:12 | hlinks:12`), and Shift+Space adds them to what the box holds as more
// alternatives (searchWithTerms, search.js). The write has its own reason, 'hover', which is not among the ones
// that turn isolate on, so the box lights the sets or hides by the isolate switch as it stood.
//
// This script reads app.js's globals at the moment it runs, never when it loads, the way search-panel.js
// does: state, storageKey, loadViewMode, hoveredId, searchCtx, refreshHover, writeSearch, $. It also calls
// graphLoadLayout (graph-view.js), hover-show.js (mergeHoverShow, hoverShowWith, hoverShowGraph, hoverShowIds,
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

// The graph kind whose choice the view on screen reads.
function hoverShowGraphNow() {
  const view = loadViewMode();
  return hoverShowGraph(view, view === 'graph' ? graphLoadLayout() : null);
}

function hoverShowKindsNow() {
  return hoverShowLoad()[hoverShowGraphNow()];
}

// The cards that light with `id` under the choice now, `id` among them when any set is ticked.
function hoverSetOf(id) {
  return hoverShowIds(hoverShowKindsNow(), state.active.concat(state.archived), id, searchCtx());
}

// Every repaint of the board comes here (renderSearchPanel), and so does a pick: the search panel's boxes
// and the Graph's side panel's toggles (graph-view.js, key hover) show the choice that applies, and the note
// says whose it is.
function syncHoverShowPanel() {
  const kinds = hoverShowKindsNow();
  document.querySelectorAll('#graph-view .graph-option-btn[data-key="hover"]').forEach((btn) => {
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
  const note = $('#search-hover-for');
  const text = hoverShowGraphNow() === 'flow' ? 'Flow' : 'Hierarchy and the other views';
  if (note && note.textContent !== text) note.textContent = text;
}

function hoverShowPick(kind, on) {
  hoverShowMemo = hoverShowWith(hoverShowLoad(), hoverShowGraphNow(), kind, on);
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
  if (id == null) return;
  const terms = hoverShowTerms(hoverShowKindsNow(), window.kanbanIds.idKey(id) ?? id);
  if (!terms) return;
  e.preventDefault();
  const box = $('#search-input');
  const text = searchWithTerms(box.value, terms, kind === 'add');
  if (text !== box.value) writeSearch(text, 'hover');
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', onHoverSpaceKey);
  $('#search-hover').addEventListener('change', (e) => {
    const box = e.target.closest('[data-hover-kind]');
    if (box) hoverShowPick(box.dataset.hoverKind, box.checked);
  });
});
