'use strict';
// The preferences sheet's settings, kept in the browser per board and never
// written to the board: what a plain click on a card does in each view (opens
// the card, or selects it), whether archived leaves count as done in the
// roll-ups, whether the search panel's pill section starts folded, whether its slice
// section starts folded (it does, by default), and whether the panel opens when the
// search box is focused (the arrow's switch and the p key flip the same choice). One
// entry per board under the app's per-board key, validated on every read, so a
// hand-edited or stale value falls back to its default.
//
// The roll-up bar's open or collapsed choice is not here: a click on a bar
// already stores it (column-state.js), and the sheet reads and writes that one.
// The old per-board rollup.archived key is never read (a value saved there
// before the sheet came back means nothing): the toggle lives in this entry.
//
// Pure: the caller passes the storage, so Node tests drive it with a fake. Same
// dual-environment export pattern as rollup-bar.js.

const PREFS_COLUMN_STATE = (typeof module !== 'undefined' && module.exports)
  ? require('./column-state')
  : window;

const PREFS_FEATURE = 'prefs';
const PREFS_CLICK_VIEWS = ['board', 'map', 'gantt', 'calendar'];
const PREFS_CLICK_CHOICES = ['opens', 'selects'];
// The Graph's plain click is always a selection; the sheet shows it fixed.
const PREFS_GRAPH_CLICK = 'selects';
// The sheet's on/off settings, which mergePrefs and prefsWith both validate by this list.
const PREFS_BOOLEANS = ['archivedDone', 'pillsFolded', 'statusesFolded', 'slicesFolded', 'typingFolded', 'hoverFolded', 'panelOnFocus'];

function prefsDefaults() {
  const click = {};
  for (const view of PREFS_CLICK_VIEWS) click[view] = 'opens';
  click.graph = PREFS_GRAPH_CLICK;
  return { click, archivedDone: true, pillsFolded: false, statusesFolded: false, slicesFolded: true, typingFolded: true, hoverFolded: true, panelOnFocus: true };
}

function prefsParse(saved) {
  if (saved && typeof saved === 'object') return saved;
  if (typeof saved !== 'string' || !saved) return null;
  try { return JSON.parse(saved); } catch (e) { return null; }
}

const prefsIsObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// `saved` is the stored text (or the value parsed from it). Anything that is
// not an object gives the defaults; inside an object, only the keys the sheet
// knows are read and a value that is not one of that key's choices is ignored.
function mergePrefs(saved) {
  const prefs = prefsDefaults();
  const value = prefsParse(saved);
  if (!prefsIsObject(value)) return prefs;
  if (prefsIsObject(value.click)) {
    for (const view of PREFS_CLICK_VIEWS) {
      const choice = Object.prototype.hasOwnProperty.call(value.click, view) ? value.click[view] : undefined;
      if (PREFS_CLICK_CHOICES.includes(choice)) prefs.click[view] = choice;
    }
  }
  for (const key of PREFS_BOOLEANS) if (typeof value[key] === 'boolean') prefs[key] = value[key];
  return prefs;
}

// The set with one change from the sheet applied: { click: { board: 'selects' } } or one
// of the on/off settings, { archivedDone: false } and the like. The change goes through the same validation as a
// stored value, so one the sheet cannot make (a bad choice, the Graph set to
// opens) leaves the set as it was. The set passed in is not touched.
function prefsWith(prefs, change) {
  const next = mergePrefs(prefs);
  const click = prefsIsObject(change && change.click) ? change.click : {};
  for (const view of PREFS_CLICK_VIEWS) {
    if (Object.prototype.hasOwnProperty.call(click, view) && PREFS_CLICK_CHOICES.includes(click[view])) next.click[view] = click[view];
  }
  for (const key of PREFS_BOOLEANS) if (change && typeof change[key] === 'boolean') next[key] = change[key];
  return next;
}

function loadPrefs(storage, projectName) {
  let saved = null;
  try { saved = storage.getItem(PREFS_COLUMN_STATE.storageKey(projectName, PREFS_FEATURE)); }
  catch (e) { saved = null; } // corrupt/inaccessible storage: the defaults
  return mergePrefs(saved);
}

function savePrefs(storage, projectName, prefs) {
  try { storage.setItem(PREFS_COLUMN_STATE.storageKey(projectName, PREFS_FEATURE), JSON.stringify(mergePrefs(prefs))); }
  catch (e) { /* storage unavailable/full: the choice just won't persist this session */ }
}

// Whether the Markdown boxes are coloured while they are edited (markdown-edit-ui.js) is one choice for the
// whole browser, whatever the board: one key with no board in it, 'false' or 'true', on when it is missing
// or is anything else. Storage that cannot be read or written leaves it on and the choice unsaved.
const MD_COLOUR_KEY = 'kanban.md-colour';

function loadMdColour(storage) {
  try { return JSON.parse(storage.getItem(MD_COLOUR_KEY)) !== false; }
  catch (e) { return true; }
}

function saveMdColour(storage, on) {
  try { storage.setItem(MD_COLOUR_KEY, JSON.stringify(on !== false)); }
  catch (e) { /* storage unavailable/full: the choice just won't persist this session */ }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PREFS_FEATURE, MD_COLOUR_KEY, loadMdColour, saveMdColour, PREFS_CLICK_VIEWS, PREFS_CLICK_CHOICES, PREFS_GRAPH_CLICK, prefsDefaults, mergePrefs, prefsWith, loadPrefs, savePrefs };
} else {
  window.PREFS_FEATURE = PREFS_FEATURE;
  window.MD_COLOUR_KEY = MD_COLOUR_KEY;
  window.loadMdColour = loadMdColour;
  window.saveMdColour = saveMdColour;
  window.PREFS_CLICK_VIEWS = PREFS_CLICK_VIEWS;
  window.PREFS_CLICK_CHOICES = PREFS_CLICK_CHOICES;
  window.PREFS_GRAPH_CLICK = PREFS_GRAPH_CLICK;
  window.prefsDefaults = prefsDefaults;
  window.mergePrefs = mergePrefs;
  window.prefsWith = prefsWith;
  window.loadPrefs = loadPrefs;
  window.savePrefs = savePrefs;
}
