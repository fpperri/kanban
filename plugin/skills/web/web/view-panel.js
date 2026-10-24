'use strict';
// Whether the option panel on the right of the Map and of the Graph is open. A person's choice
// is kept in the browser per board, one entry under the app's per-board key, validated on every
// read like the preferences (prefs.js), so a hand-edited or stale value counts as no choice. With
// no choice the panel starts closed at every width; from 760 px wide it opens beside the view, below
// it over the view as a sheet.
//
// Pure: the caller passes the storage and the screen's width, so Node tests drive it with a fake.
// Same dual-environment export pattern as prefs.js.

const VIEW_PANEL_COLUMN_STATE = (typeof module !== 'undefined' && module.exports)
  ? require('./column-state')
  : window;

const VIEW_PANEL_FEATURE = 'viewpanel';
const VIEW_PANEL_VIEWS = ['map', 'graph'];
const VIEW_PANEL_WIDE_PX = 760;

const viewPanelIsObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Closed at every width until the person opens it; only a kept choice opens it on a load.
function viewPanelDefault() {
  return false;
}

// The choices in `saved` (the stored text, or the value parsed from it): true or false for a view
// the person has chosen for, null for one they have not. Anything that is not an object, and
// any value that is not a boolean, is no choice.
function mergeViewPanel(saved) {
  let value = saved;
  if (typeof saved === 'string' && saved) {
    try { value = JSON.parse(saved); } catch (e) { value = null; }
  }
  const choices = {};
  for (const view of VIEW_PANEL_VIEWS) {
    const own = viewPanelIsObject(value) && Object.prototype.hasOwnProperty.call(value, view);
    choices[view] = own && typeof value[view] === 'boolean' ? value[view] : null;
  }
  return choices;
}

// Whether the view's panel is open: the person's choice when there is one, else the screen's.
function viewPanelOpen(choices, view, width) {
  const own = mergeViewPanel(choices)[view];
  return typeof own === 'boolean' ? own : viewPanelDefault(width);
}

// The choices with one view's changed; a view the panel does not belong to leaves them as they were.
function viewPanelWith(choices, view, open) {
  const next = mergeViewPanel(choices);
  if (VIEW_PANEL_VIEWS.includes(view) && typeof open === 'boolean') next[view] = open;
  return next;
}

function loadViewPanel(storage, projectName) {
  let saved = null;
  try { saved = storage.getItem(VIEW_PANEL_COLUMN_STATE.storageKey(projectName, VIEW_PANEL_FEATURE)); }
  catch (e) { saved = null; } // corrupt/inaccessible storage: no choice
  return mergeViewPanel(saved);
}

function saveViewPanel(storage, projectName, choices) {
  try { storage.setItem(VIEW_PANEL_COLUMN_STATE.storageKey(projectName, VIEW_PANEL_FEATURE), JSON.stringify(mergeViewPanel(choices))); }
  catch (e) { /* storage unavailable/full: the choice just won't persist this session */ }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VIEW_PANEL_FEATURE, VIEW_PANEL_VIEWS, VIEW_PANEL_WIDE_PX, viewPanelDefault, mergeViewPanel, viewPanelOpen, viewPanelWith, loadViewPanel, saveViewPanel };
} else {
  window.VIEW_PANEL_FEATURE = VIEW_PANEL_FEATURE;
  window.VIEW_PANEL_VIEWS = VIEW_PANEL_VIEWS;
  window.VIEW_PANEL_WIDE_PX = VIEW_PANEL_WIDE_PX;
  window.viewPanelDefault = viewPanelDefault;
  window.mergeViewPanel = mergeViewPanel;
  window.viewPanelOpen = viewPanelOpen;
  window.viewPanelWith = viewPanelWith;
  window.loadViewPanel = loadViewPanel;
  window.saveViewPanel = saveViewPanel;
}
