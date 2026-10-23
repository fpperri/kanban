'use strict';
// Isolate: show only the selection, in every view. The switch at the foot of the search panel
// (#isolate-switch, a button that is a switch for assistive technology) and the i key turn it
// on and off. It is no state of its own beyond a flag: turning it on writes the selection into
// the search box as a query that names each part by its criterion (`#12 | path:40 | tags:grill`,
// searchIsolateBox in search.js), so every view that filters by the box shows only the matches,
// the Calendar and the Gantt jump to the nearest one through the box writer's own listener, a
// card that comes to match a query part joins on the next poll, and the address carries the text.
// In the Graph the same query hides what it does not match instead of lighting it
// (graphQueryEffect in graph-model.js, told by isolateNow). The box's text from before is kept in
// the flag, `{ previous }`, and turning isolate off gives it back (searchIsolateRestore), with
// the run of slices as the box holds it now. Isolate is what hides: with it off the box hides
// nothing in any view but by a slice: cut, and its matches are lit (computeSearchMatch in app.js),
// so the box holds nothing the selection's cards, paths and trees would bring back.
//
// A query the person makes turns isolate on by itself where the view's Typing isolates setting
// is on (typing-isolates.js, the panel's checkboxes; on in every view but the Graph): typing, a pill, a
// cue on a card and a ?q= link (typingTurnsIsolateOn, selection.js, asked by writeSearch). The
// box then is the isolate text and holds the query as it is, so the flag is `{ previous, following }`
// with the previous text following the box: turning isolate off leaves the query in the box,
// lit, and the next Esc clears it. Leaving for a view whose setting is off ends such an isolate
// the same way (isolateEndFollowing), and entering a view whose setting is on starts it again while the
// box holds a query of the person's (isolateStartFollowing, called by setView in app.js), so a view's
// setting decides on every switch; an isolate the switch or the i key turned on is the person's and
// stays. The switch turns a lit query back into one that hides.
//
// While it is on, a click on a card moves the anchor only: nothing the selection does writes the
// box (with isolate off a click writes the selection into it, mirrorSelectionInBox in app.js), and a
// click or a double click on empty space leaves the selection. Esc steps back in three stages, and isolate off is the first (selectionAfterEscape,
// selection.js; escapeStep and stepSelectionBack in app.js, where escapeStep asks keyGuardEscape
// (key-guard.js) which Esc it is, and also stops the browser's own Esc, which clears a search
// field, so the box gets its text back and keeps it); with the search panel open the first Esc
// closes the panel and the second turns isolate off. A hand edit of the box, a pill or a slice is
// an edit of the query: isolate stays on while the box holds one, and ends when it holds none
// (isolateAfterWrite, selection.js). With nothing to write the switch says so and stays off, and
// Esc with focus in the box turns isolate off like Esc anywhere else.
//
// The menus turn it on too: the card menu offers Isolate inside the selection, and the small menu
// of the empty Graph or Map canvas offers it alone (cardMenuFor and canvasMenuFor, selection.js;
// openCanvasContextMenu and showContextMenu in app.js). The entry is the switch's twin, isolateFlip,
// and reads Turn isolate off while isolate is on.
//
// The link carries it. While isolate is on the address holds `isolate=1` beside `q` (the box's own
// address listener, followSearchInAddress in app.js, asks isolateNow), and a link that opens with
// the parameter and a query turns isolate on before the query reaches the box (isolateFromLink,
// called by consumeDeepLink), so the first repaint, the address and every listener see it on; a
// link with the parameter and no query opens with isolate off, and its address loses the parameter
// on load. The text the box held before isolating cannot ride in the link, so the browser keeps
// it per board beside the isolate text it goes with (isolateRecord, selection.js), and gives it
// back when that very isolate is turned off after a reload; where it is unknown (no record,
// blocked storage, a record for another isolate) turning isolate off leaves the box empty. Every
// storage read and write is guarded, and the page works without it.
//
// This script reads app.js's globals at the moment it runs, never when it loads: $, state,
// storageKey, prefsStorage, selectionState, currentSearchMatch,
// writeSearch, onSearchWrite, renderSearchPanel, toast and hideContextMenu; selection.js's
// partsOf, isolateRecord, isolatePreviousFrom and isolateAfterWrite; key-guard.js's keyGuardOff;
// and the search module's isolate functions (searchIsolateBox, searchIsolateRestore). The i key
// reads the shared key guard: off while a field has focus and while a menu, a dialog, the
// notifications panel or the preferences sheet is up; the search panel is no surface, so i works
// with it open.

// The text the box held when isolate went on, as { previous } (and `following` when the box's own
// query turned it on); null while it is off.
let isolateFlag = null;

const ISOLATE_SWITCH_ON = 'Isolate: only the selection is shown, in every view. Click, press i, or press Esc, to turn it off and get the box\'s text back.';
const ISOLATE_SWITCH_OFF = 'Isolate: show only the selection, in every view, by writing it into the search box. Click, or press i, to turn it on.';

function isolateNow() {
  return isolateFlag;
}

// Whether a query the person makes turns isolate on in a view: the panel's Typing isolates checkboxes,
// one flag per view kept per board under the feature key 'typing.isolates' (typing-isolates.js merges it
// with the defaults, on in every view but the Graph, so a value this version does not offer, or storage
// that refuses, reads as the default). Dropped with the other per-board memos when the board changes
// (applyProjectName).
let typingIsolatesMemo = null;

function typingIsolatesLoad() {
  if (typingIsolatesMemo) return typingIsolatesMemo;
  const store = prefsStorage();
  let saved = null;
  if (store) {
    try { saved = store.getItem(storageKey(state.projectName, 'typing.isolates')); }
    catch (e) { saved = null; }
  }
  typingIsolatesMemo = mergeTypingIsolates(saved);
  return typingIsolatesMemo;
}

function typingIsolatesIn(view) {
  return typingIsolatesLoad()[view] === true;
}

function setTypingIsolates(view, on) {
  typingIsolatesMemo = typingIsolatesWith(typingIsolatesLoad(), view, on);
  const store = prefsStorage();
  if (!store) return;
  try { store.setItem(storageKey(state.projectName, 'typing.isolates'), JSON.stringify(typingIsolatesMemo)); }
  catch (e) { /* storage unavailable or full: the choice just won't persist this session */ }
}

// The text the box held before isolating is kept in the browser, per board, beside the isolate
// text it goes with (isolateRecord, selection.js), so a reload that opens isolated can still give
// it back. Every read and write guards against storage that is blocked or full: the page works
// without it, and the text is then unknown, which gives back an empty box.
const ISOLATE_KEPT_FEATURE = 'isolate.kept';

function saveIsolateRecord(previous, text) {
  const store = prefsStorage();
  if (!store) return;
  try { store.setItem(storageKey(state.projectName, ISOLATE_KEPT_FEATURE), isolateRecord(previous, text)); }
  catch (e) { /* storage unavailable or full: the text will be unknown after a reload */ }
}

function forgetIsolateRecord() {
  const store = prefsStorage();
  if (!store) return;
  try { store.removeItem(storageKey(state.projectName, ISOLATE_KEPT_FEATURE)); }
  catch (e) { /* nothing to forget */ }
}

function readKeptPrevious(q) {
  const store = prefsStorage();
  let raw = null;
  if (store) {
    try { raw = store.getItem(storageKey(state.projectName, ISOLATE_KEPT_FEATURE)); }
    catch (e) { raw = null; }
  }
  return isolatePreviousFrom(raw, q);
}

// A link that opens isolated (consumeDeepLink): isolate is on before the link's query reaches the
// box, so the repaint, the address and every listener of the write see it on. What it gives back
// is the text kept for this very query, or nothing.
function isolateFromLink(q) {
  const previous = readKeptPrevious(q);
  isolateFlag = previous !== '' && previous === String(q).trim() ? { previous, following: true } : { previous }; // the text kept is the isolate text itself: the box's own query started it
}

// Isolate turned on by a query the person wrote: the box keeps being the isolate text, and
// turning isolate off leaves it as it is (isolateOnWrite keeps `previous` the box's text).
function isolateFromTyping(text) {
  isolateFlag = { previous: String(text), following: true };
}

// A write that leaves the box holding no query ends isolate before the repaint it makes (writeSearch),
// so that repaint draws the views and the panel as they are without it, and reads the box once.
function isolateEndIfEmptied(text, reason) {
  if (!isolateFlag || isolateAfterWrite(isolateFlag, text, reason) !== null) return;
  isolateFlag = null;
  forgetIsolateRecord();
}

// Entering a view whose Typing isolates is on with a query of the person's in the box and isolate off
// starts the isolate typing there would have: the box keeps its text (the picks a click mirrored into
// it are not a query, searchBoxHoldsTyped). An isolate the switch or the i key turned on is not touched.
function isolateStartFollowing(setting) {
  if (isolateFlag || setting !== true) return;
  const box = $('#search-input').value;
  if (!searchBoxHoldsTyped(box, partsOf(selectionState.selection))) return;
  isolateFromTyping(box);
  saveIsolateRecord(box, box);
}

// Moving to a view whose Typing isolates is off ends an isolate the box's own query started:
// the query stays in the box and lights there, as it does when typed into that view.
function isolateEndFollowing(view, setting) {
  if (!isolateFlag || !isolateFlag.following || setting === true) return;
  isolateFlag = null;
  forgetIsolateRecord();
}

// The switch says whether isolate is on (aria-checked) and what a click does. Every repaint of
// the board comes here (renderSearchPanel), so the poll keeps it right.
function syncIsolateSwitch() {
  const el = $('#isolate-switch');
  if (!el) return;
  const on = isolateFlag !== null;
  const checked = String(on);
  if (el.getAttribute('aria-checked') !== checked) el.setAttribute('aria-checked', checked);
  const title = on ? ISOLATE_SWITCH_ON : ISOLATE_SWITCH_OFF;
  if (el.title !== title) el.title = title;
}

// Writes the selection into the box and remembers what it held. Nothing selected, or nothing
// the selection names that the box can say, leaves the box and the switch as they were and
// says why.
function isolateTurnOn() {
  if (isolateFlag) return false;
  const box = $('#search-input').value;
  const parts = partsOf(selectionState.selection);
  const text = searchIsolateBox(box, parts);
  if (!text && currentSearchMatch().lit) { // a query lit outside the Graph is no selection, and isolating it makes the box hide again
    isolateFromTyping(box);
    saveIsolateRecord(box, box);
    writeSearch(box, 'isolate');
    return true;
  }
  if (!text) { toast('Nothing is selected to isolate. Pick a card, a pill, or add a path or a tree first.'); return false; }
  isolateFlag = { previous: box };
  saveIsolateRecord(box, text);
  writeSearch(text, 'isolate');
  return true;
}

// Gives the box its text back. The flag goes first, so the repaint the write makes shows the
// views and the chip as they are without isolate.
function isolateTurnOff() {
  if (!isolateFlag) return false;
  const text = searchIsolateRestore($('#search-input').value, isolateFlag.previous);
  isolateFlag = null;
  forgetIsolateRecord();
  writeSearch(text, 'isolate');
  return true;
}

function isolateFlip() {
  return isolateFlag ? isolateTurnOff() : isolateTurnOn();
}

// The entry in the card menu and in the menu of the empty canvas mirrors the switch: Isolate turns
// it on and, while it is on, the entry offers to turn it off. It acts on the selection as it is
// when it is chosen, and with nothing selected it says so, as the switch does.
function isolateMenuLabel() {
  return isolateFlag ? 'Turn isolate off' : 'Isolate';
}

function isolateFromMenu() {
  hideContextMenu();
  isolateFlip();
}

// The i key: a key that types nothing but reads a letter, so it reads the whole key guard, as p
// and m do. A chord (Ctrl, Cmd, Alt), Shift on the key and a held key are not it; Caps Lock gives
// a capital I with no Shift, and counts.
function onIsolateKey(e) {
  if (!e.key || e.key.toLowerCase() !== 'i' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (keyGuardOff(document)) return;
  e.preventDefault();
  isolateFlip();
}

// A write to the box that leaves it holding no query ends isolate: its text is gone, and so is
// the text it would give back.
function isolateOnWrite(text, reason) {
  const next = isolateAfterWrite(isolateFlag, text, reason);
  if (next && next.following && !writeIsIsolateSwitch(reason)) next.previous = text; // the box's query is what isolate off gives back
  if (next && !writeIsIsolateSwitch(reason)) saveIsolateRecord(next.previous, text); // the kept text goes with the isolate text the box holds now
  if (next === isolateFlag) return;
  isolateFlag = next;
  if (!next) forgetIsolateRecord();
  renderSearchPanel();
}

// The Typing isolates checkboxes in the panel's foot, one per view (typingIsolatesIn): each
// shows the view's setting and sets it. Every repaint of the board comes here (renderSearchPanel).
function syncTypingIsolates() {
  document.querySelectorAll('#search-typing [data-typing-view]').forEach((box) => {
    const on = typingIsolatesIn(box.dataset.typingView);
    if (box.checked !== on) box.checked = on;
  });
}

function onTypingIsolatesChange(e) {
  const box = e.target && e.target.closest ? e.target.closest('[data-typing-view]') : null;
  if (box) setTypingIsolates(box.dataset.typingView, box.checked);
}

window.addEventListener('DOMContentLoaded', () => {
  $('#search-typing').addEventListener('change', onTypingIsolatesChange);
  $('#isolate-switch').addEventListener('click', isolateFlip);
  $('#ctx-isolate').addEventListener('click', isolateFromMenu);
  document.addEventListener('keydown', onIsolateKey);
  onSearchWrite(isolateOnWrite);
});
