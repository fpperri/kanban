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
// the run of slices as the box holds it now.
//
// While it is on, a click on a card moves the anchor only: nothing the selection does writes the
// box (boxAfterGraphClick, selection.js), and a click or a double click on empty space leaves the
// selection. Esc steps back in three stages, and isolate off is the first (selectionAfterEscape,
// selection.js; escapeStep and stepSelectionBack in app.js); with the search panel open the first
// Esc closes the panel and the second turns isolate off. A hand edit of the box, a pill or a slice
// is an edit of the query: isolate stays on while the box holds one, and ends when it holds none
// (isolateAfterWrite, selection.js). The edges the grill left open are read the simplest way:
// the switch with nothing to write says so and stays off, and Esc with focus in the box turns
// isolate off like Esc anywhere else.
//
// This script reads app.js's globals at the moment it runs, never when it loads: $, selectionState,
// writeSearch, onSearchWrite, renderSearchPanel, toast, keyGuardOff, partsOf (selection.js) and
// the search module's isolate functions. The i key reads the shared key guard (key-guard.js): off
// while a field has focus and while a menu, a dialog, the notifications panel or the preferences
// sheet is up; the search panel is no surface, so i works with it open.

// The text the box held when isolate went on, as { previous }; null while it is off.
let isolateFrom = null;

const ISOLATE_SWITCH_ON = 'Isolate: only the selection is shown, in every view. Click, press i, or press Esc, to turn it off and get the box\'s text back.';
const ISOLATE_SWITCH_OFF = 'Isolate: show only the selection, in every view, by writing it into the search box. Click, or press i, to turn it on.';

function isolateNow() {
  return isolateFrom;
}

// The text the box held before isolating is kept in the browser, per board, beside the isolate
// text it goes with (isolateRecord, selection.js), so a reload that opens isolated can still give
// it back. Every read and write guards against storage that is blocked or full: the page works
// without it, and the text is then unknown, which gives back an empty box.
const ISOLATE_KEPT_FEATURE = 'isolate.kept';

function isolateKeep(previous, text) {
  const store = prefsStorage();
  if (!store) return;
  try { store.setItem(storageKey(state.projectName, ISOLATE_KEPT_FEATURE), isolateRecord(previous, text)); }
  catch (e) { /* storage unavailable or full: the text will be unknown after a reload */ }
}

function isolateForget() {
  const store = prefsStorage();
  if (!store) return;
  try { store.removeItem(storageKey(state.projectName, ISOLATE_KEPT_FEATURE)); }
  catch (e) { /* nothing to forget */ }
}

function isolateKept(q) {
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
  isolateFrom = { previous: isolateKept(q) };
}

// The switch says whether isolate is on (aria-checked) and what a click does. Every repaint of
// the board comes here (renderSearchPanel), so the poll keeps it right.
function syncIsolateSwitch() {
  const el = $('#isolate-switch');
  if (!el) return;
  const on = isolateFrom !== null;
  const checked = String(on);
  if (el.getAttribute('aria-checked') !== checked) el.setAttribute('aria-checked', checked);
  const title = on ? ISOLATE_SWITCH_ON : ISOLATE_SWITCH_OFF;
  if (el.title !== title) el.title = title;
}

// Writes the selection into the box and remembers what it held. Nothing selected, or nothing
// the selection names that the box can say, leaves the box and the switch as they were and
// says why.
function isolateTurnOn() {
  if (isolateFrom) return false;
  const box = $('#search-input').value;
  const text = searchIsolateBox(box, partsOf(selectionState.selection));
  if (!text) { toast('Nothing is selected to isolate. Pick a card, a pill, or add a path or a tree first.'); return false; }
  isolateFrom = { previous: box };
  isolateKeep(box, text);
  writeSearch(text, 'isolate');
  return true;
}

// Gives the box its text back. The flag goes first, so the repaint the write makes shows the
// views and the chip as they are without isolate.
function isolateTurnOff() {
  if (!isolateFrom) return false;
  const text = searchIsolateRestore($('#search-input').value, isolateFrom.previous);
  isolateFrom = null;
  isolateForget();
  writeSearch(text, 'isolate');
  return true;
}

function isolateFlip() {
  return isolateFrom ? isolateTurnOff() : isolateTurnOn();
}

// The entry in the card menu and in the menu of the empty canvas mirrors the switch: Isolate turns
// it on and, while it is on, the entry offers to turn it off. It acts on the selection as it is
// when it is chosen, and with nothing selected it says so, as the switch does.
function isolateMenuLabel() {
  return isolateFrom ? 'Turn isolate off' : 'Isolate';
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

// Esc with focus in the box while isolated: escapeStep turns isolate off and gives the box its
// text back, so the browser's own Esc, which clears a search field, is stopped, as it is when the
// panel closes (search-panel.js), or it would take the text away again.
function isolateEscapeKeepsBox(e) {
  if (isolateFrom === null || keyGuardEscape(document, $('#search-input')) !== 'clear-box') return;
  e.preventDefault();
}

// A write to the box that leaves it holding no query ends isolate: its text is gone, and so is
// the text it would give back.
function isolateOnWrite(text, reason) {
  const next = isolateAfterWrite(isolateFrom, text, reason);
  if (next && reason !== 'isolate') isolateKeep(next.previous, text); // the kept text goes with the isolate text the box holds now
  if (next === isolateFrom) return;
  isolateFrom = next;
  if (!next) isolateForget();
  renderSearchPanel();
}

window.addEventListener('DOMContentLoaded', () => {
  $('#isolate-switch').addEventListener('click', isolateFlip);
  $('#ctx-isolate').addEventListener('click', isolateFromMenu);
  document.addEventListener('keydown', onIsolateKey);
  onSearchWrite(isolateOnWrite);
});
