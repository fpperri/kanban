'use strict';
// The search panel's "On hover show" section: six checkboxes, one per set (dtree, htree, dpath, hpath,
// dlinks, hlinks), that choose which sets a hover or a keyboard focus on a card lights. The choice is kept
// per board in this browser, under the feature key 'hover.show' (storageKey), as one list of sets per graph
// kind, the Hierarchy's and the Flow's (hover-show.js merges it with the defaults, so a value this version
// does not offer, or storage that refuses, reads as the default). The panel shows the choice of the view
// that is on: the Flow's in the Graph's Flow, the Hierarchy's everywhere else.
//
// This script reads app.js's globals at the moment it runs, never when it loads, the way search-panel.js
// does: state, storageKey, loadViewMode, searchCtx, refreshHover, $. It also calls graphLoadLayout
// (graph-view.js) and hover-show.js.

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

// Every repaint of the board comes here (renderSearchPanel): the boxes show the choice that applies, and
// the note says whose it is.
function syncHoverShowPanel() {
  const host = $('#search-hover');
  if (!host) return;
  const kinds = hoverShowKindsNow();
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
  refreshHover();
}

window.addEventListener('DOMContentLoaded', () => {
  $('#search-hover').addEventListener('change', (e) => {
    const box = e.target.closest('[data-hover-kind]');
    if (box) hoverShowPick(box.dataset.hoverKind, box.checked);
  });
});
