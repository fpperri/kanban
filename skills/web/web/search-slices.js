'use strict';
// The search panel's slice section: the slices of the board, top to bottom, each a
// button with its type's icon, its name and its count, and the keys [ ] { } that move the
// ends of the run. The slices come from the slices module (slices.js) and the arithmetic
// of the run from slice-run.js; this script draws them and carries out what they decide.
//
// The run is the slice: term the search box holds at the top level of its query, so
// nothing about it is kept here: every render reads it off the box, and every gesture
// writes it back through the search module's searchSetSlice. A run that covers every
// slice writes no term. A term typed by hand shows at once, and a single unknown name
// cuts nothing, so every entry shows as pressed. The section lists the tiers some card
// of the board is in (live or archived) and every depth; the counts are over the cards
// the view shows after its status pills and Archive, and before the box and the run, so
// a run never zeroes the entries needed to grow it again.
//
// A click on an entry outside the run grows the run to it; on an end it drops that end;
// on a run of one it brings every slice back; inside the run and not on an end it does
// nothing. A right-click keeps only that slice, and so do the context-menu key and
// Shift+F10 on a focused entry, which the page handles itself (it stops the browser's
// menu), since a key and a right-click do not always raise the same event. The keys
// [ and ] move the bottom of the run up and down and { and } move its top, in every view,
// whether the panel is open or not. They read the shared key guard (key-guard.js)
// unchanged: off while a field has focus and while a menu, a dialog, the notifications
// panel or the preferences sheet is up; the search panel is no surface, so they work
// with it open.
//
// The buttons are built once and then updated in place by every render, the poll's
// included, so an entry that has focus keeps it and its count changes under it. They
// wear no `data-holds-poll` (a button left focused by a click would stop the poll for
// good) and their own class, never a pill's. The section folds with its fold control for
// the visit, and the preferences sheet says how it starts (folded, by default).
//
// This script reads app.js's and search-panel.js's globals at the moment it runs, never
// when it loads: $, state, searchCtx, currentSearchMatch, viewCardIds, writeSearch,
// loadPrefsState, searchPanelIsOpen, keyGuardOff.

// Whether the section is folded for this visit; null until it is read from the preferences,
// which have to wait for the board's name (they are kept per board).
let searchSlicesFolded = null;
let searchSlicesFoldedFor = '';

const SEARCH_SLICES_HINT = 'click: grow the run to this slice, or drop it from an end (a run of one: every slice again), right-click: only this slice';

// --- what the section shows now ------------------------------------------------------------------

// Every slice of the board, live and archived, as slice: cuts by them.
function searchSlicesSliced() {
  const cards = state.active.concat(state.archived);
  return sliceCards(cards, state.hierarchy, depthMap(cards, searchCtx()));
}

// The values of the box's slice: terms at the top level of its query, which is where the
// parse puts the terms the views cut by. They come from the parse the render made (the box is
// parsed once per repaint), or from one made now when a gesture asks outside a render.
function searchSlicesValues() {
  return currentSearchMatch().terms.filter((t) => t.field === 'slice').map((t) => t.value);
}

// The entries the section lists, the values of the box's slice: terms, and the run those
// leave. The counts are over the cards the view shows before the box and the run.
function searchSlicesNow() {
  const sliced = searchSlicesSliced();
  const list = sliceListOf(sliced, viewCardIds(false));
  const values = searchSlicesValues();
  return { list, values, run: sliceRunOf(sliced, list, values) };
}

// --- the buttons ---------------------------------------------------------------------------------

function buildSliceButton(doc, entry) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'slice-entry';
  button.dataset.sliceKey = sliceEntryKey(entry);
  button.dataset.keepsSelection = '';
  const icon = doc.createElement('span');
  icon.className = 'slice-entry-icon';
  icon.setAttribute('aria-hidden', 'true');
  const label = doc.createElement('span');
  label.className = 'slice-entry-label';
  const count = doc.createElement('span');
  count.className = 'slice-entry-count';
  button.append(icon, label, count);
  return button;
}

function setSliceText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function setSliceAttr(el, name, value) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

// The glyph a tier's type wears (type-icons.js), none for a depth, a type with no icon or an
// icon the table does not know.
function sliceEntryGlyph(entry) {
  return entry.kind === 'tier' ? typeIconGlyph(typeIconOf(entry.name, state.types)) : '';
}

function updateSliceButton(button, entry, inRun) {
  setSliceText(button.children[0], sliceEntryGlyph(entry));
  setSliceText(button.children[1], entry.label);
  setSliceText(button.children[2], String(entry.count));
  setSliceAttr(button, 'aria-pressed', String(inRun));
  setSliceAttr(button, 'aria-label', sliceEntryName(entry, inRun));
  button.classList.toggle('on', inRun);
  const title = `${entry.label}  (${SEARCH_SLICES_HINT})`;
  if (button.title !== title) button.title = title;
}

// Makes the buttons in `host` the list: one per entry, in order, each showing its count and
// whether it is in the run. A button that is there is updated where it stands, so focus on
// it is never lost; one is added or taken out only when the list changes.
function syncSliceButtons(host, list, run) {
  const doc = host.ownerDocument || document;
  const byKey = new Map([...host.children].map((el) => [el.dataset.sliceKey, el]));
  list.forEach((entry, at) => {
    const button = byKey.get(sliceEntryKey(entry)) || buildSliceButton(doc, entry);
    updateSliceButton(button, entry, !!run && at >= run.from && at <= run.to);
    if (host.children[at] !== button) host.insertBefore(button, host.children[at] || null);
  });
  const keys = new Set(list.map(sliceEntryKey));
  for (const el of [...host.children]) if (!keys.has(el.dataset.sliceKey)) el.remove();
}

// Every repaint of the board comes here (renderSearchPanel, from renderBoard): the fold, and
// the entries only while the panel is open, since a closed panel shows none. A board with no
// card has no slice to list, so the section is out of the panel.
function renderSearchSlices() {
  applySlicesFold();
  const host = $('#search-slices');
  if (!searchPanelIsOpen() || !host) return;
  const now = searchSlicesNow();
  syncSliceButtons(host, now.list, now.run);
  const section = $('#search-slices-section');
  if (section) section.classList.toggle('hidden', !now.list.length);
}

// What the closed panel's chip counts for the run: one thing, named for a screen reader, when
// the box holds a slice: term that cuts (one that leaves no slice cuts every card), none when
// it holds none or one that cuts nothing.
function searchSlicesChipNames() {
  if (!searchSlicesValues().length) return [];
  const now = searchSlicesNow();
  return sliceRunCuts(now.list, now.run) ? [`slice ${now.values.join(' ')}`] : [];
}

// --- the gestures --------------------------------------------------------------------------------

function sameSliceRun(a, b) {
  return a === b || (!!a && !!b && a.from === b.from && a.to === b.to);
}

// Writes `run` to the box as the slice: term it is, with the reason 'slice' so the repaint
// takes it for a cut and not a typed search. A run the box already shows is left as it is
// typed.
function setSliceRun(now, run) {
  if (sameSliceRun(run, now.run)) return;
  const box = $('#search-input').value;
  const next = searchSetSlice(box, sliceRunValue(now.list, run));
  if (next !== box) writeSearch(next, 'slice');
}

// What a click ('click') or a right-click ('keep') on this entry's button does. The entry is
// found again by its key, so a list that changed since the button was drawn never moves the
// click to another slice.
function applySliceGesture(gesture, button) {
  const now = searchSlicesNow();
  const at = now.list.findIndex((entry) => sliceEntryKey(entry) === button.dataset.sliceKey);
  if (at < 0) return;
  setSliceRun(now, gesture === 'keep' ? sliceRunKeep(at) : sliceRunClick(now.list, now.run, at));
}

// A click is a click whatever modifier is held.
function onSliceClick(e) {
  const button = e.target.closest('.slice-entry');
  if (button) applySliceGesture('click', button);
}

// The other mouse button keeps only that slice, and the browser's own menu stays shut.
function onSliceContextMenu(e) {
  const button = e.target.closest('.slice-entry');
  if (!button) return;
  e.preventDefault();
  applySliceGesture('keep', button);
}

// The context-menu key and Shift+F10 do what the right-click does, on the entry with focus.
function onSliceEntryKey(e) {
  const menu = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
  if (!menu || e.ctrlKey || e.metaKey || e.altKey) return;
  const button = e.target.closest('.slice-entry');
  if (!button) return;
  e.preventDefault();
  applySliceGesture('keep', button);
}

// A chord (Ctrl, Cmd, Alt held with a key). AltGr is not one: on a layout with no brackets of its
// own it is how they are typed, and the browser reports it as Ctrl and Alt together, with the
// AltGraph modifier on.
function sliceKeyIsChord(e) {
  const altGraph = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
  return !!e.metaKey || ((!!e.ctrlKey || !!e.altKey) && !altGraph);
}

// [ ] { }: a key that types nothing but reads a character, so it reads the whole key guard.
// Shift is not checked: { and } are Shift with [ and ].
function onSliceKey(e) {
  if (!SLICE_RUN_KEYS.includes(e.key) || sliceKeyIsChord(e)) return;
  if (keyGuardOff(document)) return;
  const now = searchSlicesNow();
  if (!now.list.length) return;
  e.preventDefault();
  setSliceRun(now, sliceRunStep(now.list, now.run, e.key));
}

// --- the fold ------------------------------------------------------------------------------------

// Whether the section is folded: the choice made at the fold control for this visit, or the
// preference until there is one.
function currentSlicesFolded() {
  if (searchSlicesFolded === null || searchSlicesFoldedFor !== state.projectName) {
    searchSlicesFolded = loadPrefsState().slicesFolded;
    searchSlicesFoldedFor = state.projectName;
  }
  return searchSlicesFolded;
}

function applySlicesFold() {
  const folded = currentSlicesFolded();
  const host = $('#search-slices');
  const fold = $('#search-slices-fold');
  if (host) host.classList.toggle('hidden', folded);
  if (fold) fold.setAttribute('aria-expanded', String(!folded));
}

// The fold control: folds or unfolds the section for this visit only.
function toggleSearchSlicesFold() {
  searchSlicesFolded = !currentSlicesFolded();
  applySlicesFold();
}

// The preference changed in the sheet: the section takes it now.
function foldSearchSlices(folded) {
  searchSlicesFolded = !!folded;
  searchSlicesFoldedFor = state.projectName;
  applySlicesFold();
}

window.addEventListener('DOMContentLoaded', () => {
  const slices = $('#search-slices');
  slices.addEventListener('click', onSliceClick);
  slices.addEventListener('contextmenu', onSliceContextMenu);
  slices.addEventListener('keydown', onSliceEntryKey);
  $('#search-slices-fold').addEventListener('click', toggleSearchSlicesFold);
  document.addEventListener('keydown', onSliceKey);
});
