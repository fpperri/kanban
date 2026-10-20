'use strict';
// The preferences sheet's Hotkeys section on the page: the list hotkeys.js holds, drawn
// as one row per key (#hotkeys-list in #prefs-hotkeys), each with its keys, what it does
// and, for the keys that have one, the state it is in now. The ? key opens the sheet and
// brings the section to its top.
//
// The rows are built once and then updated in place, so the list is the same list however
// often the sheet opens. They are drawn, from the page's state as it is then, when the gear
// opens the sheet and when ? does, so a key pressed since the last time the sheet was up shows
// its new state. While the sheet is up the board behind it cannot change (its backdrop covers
// the page, the refresh waits and the keys are off), so the one state that can move is the
// panel's switch, which the sheet itself holds: a change in the sheet repaints the rows. The
// change is heard on the sheet, where it arrives after the checkbox's own listener has saved
// the choice, so the repaint reads the new one.
//
// The state is read from the page, the way each key's own handler reads it: the names option
// the Graph keeps (graphLoadOptions), the pills on (pillsOn over the panel's entries), the
// cut the box holds (the slice section's run, as a click on it would write it), isolate
// (isolateNow) and the panel's switch (loadPrefsState).
//
// The ? key reads the shared key guard (key-guard.js) unchanged: off while a field has focus
// and while a menu, a dialog, the notifications panel or the preferences sheet is up, which
// is also why it does nothing with the sheet already open. The search panel is no surface, so
// ? works with it open.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never
// when it loads: $, selectionState, openPrefsSheet, loadPrefsState, graphLoadOptions, pillsOn,
// searchPanelEntries, searchSlicesNow, sliceRunCuts, sliceRunValue, isolateNow, keyGuardOff.

// What the rows show now, as hotkeyRows (hotkeys.js) takes it.
function hotkeysNow() {
  const slices = searchSlicesNow();
  return {
    names: graphLoadOptions().names,
    pills: pillsOn(selectionState.selection, searchPanelEntries()).map((pill) => pill.label),
    slice: sliceRunCuts(slices.list, slices.run) ? sliceRunValue(slices.list, slices.run) : '',
    isolate: isolateNow() !== null,
    panelOnFocus: loadPrefsState().panelOnFocus,
  };
}

function buildHotkeyRow(doc, row) {
  const item = doc.createElement('li');
  item.className = 'hotkey-row';
  item.dataset.hotkey = row.id;
  const keys = doc.createElement('span');
  keys.className = 'hotkey-keys';
  for (const label of row.keys) {
    const key = doc.createElement('kbd');
    key.className = 'hotkey-key';
    key.textContent = label;
    keys.append(key);
  }
  const what = doc.createElement('span');
  what.className = 'hotkey-what';
  what.textContent = row.what;
  item.append(keys, what);
  if (row.state !== null) {
    const state = doc.createElement('span');
    state.className = 'hotkey-state';
    item.append(state);
  }
  return item;
}

// Makes the rows in the host the list, in order, each showing its state. A row that is there
// is updated where it stands; one is added only when the list has one more.
function syncHotkeys() {
  const host = $('#hotkeys-list');
  if (!host) return;
  const doc = host.ownerDocument || document;
  const byId = new Map([...host.children].map((el) => [el.dataset.hotkey, el]));
  hotkeyRows(hotkeysNow()).forEach((row, at) => {
    const item = byId.get(row.id) || buildHotkeyRow(doc, row);
    if (row.state !== null) {
      const state = item.children[2];
      if (state.textContent !== row.state) state.textContent = row.state;
    }
    if (host.children[at] !== item) host.insertBefore(item, host.children[at] || null);
  });
}

// ?: the sheet opens as the gear opens it, with the list drawn, on its Hotkeys page. Focus stays
// where the sheet puts it, on its close button.
function openHotkeys() {
  syncHotkeys();
  openPrefsSheet('browser:hotkeys');
}

function onHotkeysKey(e) {
  if (!hotkeyIsHelp(e) || keyGuardOff(document)) return;
  e.preventDefault();
  openHotkeys();
}

window.addEventListener('DOMContentLoaded', () => {
  $('#prefs-btn').addEventListener('click', syncHotkeys);
  $('#prefs-sheet').addEventListener('change', syncHotkeys);
  document.addEventListener('keydown', onHotkeysKey);
});
