'use strict';
// The preferences sheet's settings, kept in the browser per board and never
// written to the board: what a plain click on a card does in each view (opens
// the card, or selects it), whether archived leaves count as done in the
// roll-ups, whether the search panel's pill section starts folded, and whether the
// panel opens when the search box is focused (the arrow's switch and the p key
// flip the same choice). One
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

function prefsDefaults() {
  const click = {};
  for (const view of PREFS_CLICK_VIEWS) click[view] = 'opens';
  click.graph = PREFS_GRAPH_CLICK;
  return { click, archivedDone: true, pillsFolded: false, panelOnFocus: true };
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
  if (typeof value.archivedDone === 'boolean') prefs.archivedDone = value.archivedDone;
  if (typeof value.pillsFolded === 'boolean') prefs.pillsFolded = value.pillsFolded;
  if (typeof value.panelOnFocus === 'boolean') prefs.panelOnFocus = value.panelOnFocus;
  return prefs;
}

// The set with one change from the sheet applied: { click: { board: 'selects' } }
// { archivedDone: false }, { pillsFolded: true } or { panelOnFocus: false }. The change goes through the same validation as a
// stored value, so one the sheet cannot make (a bad choice, the Graph set to
// opens) leaves the set as it was. The set passed in is not touched.
function prefsWith(prefs, change) {
  const next = mergePrefs(prefs);
  const click = prefsIsObject(change && change.click) ? change.click : {};
  for (const view of PREFS_CLICK_VIEWS) {
    if (Object.prototype.hasOwnProperty.call(click, view) && PREFS_CLICK_CHOICES.includes(click[view])) next.click[view] = click[view];
  }
  if (change && typeof change.archivedDone === 'boolean') next.archivedDone = change.archivedDone;
  if (change && typeof change.pillsFolded === 'boolean') next.pillsFolded = change.pillsFolded;
  if (change && typeof change.panelOnFocus === 'boolean') next.panelOnFocus = change.panelOnFocus;
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PREFS_FEATURE, PREFS_CLICK_VIEWS, PREFS_CLICK_CHOICES, PREFS_GRAPH_CLICK, prefsDefaults, mergePrefs, prefsWith, loadPrefs, savePrefs };
} else {
  window.PREFS_FEATURE = PREFS_FEATURE;
  window.PREFS_CLICK_VIEWS = PREFS_CLICK_VIEWS;
  window.PREFS_CLICK_CHOICES = PREFS_CLICK_CHOICES;
  window.PREFS_GRAPH_CLICK = PREFS_GRAPH_CLICK;
  window.prefsDefaults = prefsDefaults;
  window.mergePrefs = mergePrefs;
  window.prefsWith = prefsWith;
  window.loadPrefs = loadPrefs;
  window.savePrefs = savePrefs;
}
