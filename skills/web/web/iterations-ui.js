'use strict';
// The iteration dropdown on the page (docs/adr/0015): "All cards", the iterations newest first with
// their dates, and "New iteration...", in the header. It shows only with `iterations: true` in
// config.yaml over a groups: line (state.iterations). The rules (which groups are iterations, which
// one it opens on, the draft for a new one, what the Calendar shades) are iterations.js.
//
// It opens on the running iteration, or on All cards when none runs. A pick narrows Board, Calendar,
// Gantt, Map and Graph to the iteration's cards on top of the search box, through the same
// intersection the status pills use (withIterationCut); it never writes the box and never changes a
// group. The pick is kept in this browser only (localStorage), not in the board. The Calendar
// shades the picked iteration's days and moves to its first day when the pick changes.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads: $, state, storageKey, localTodayStr, renderBoard, calendarAnchorTo, intersectVisibleIds,
// openGroupForm, groupsList, and iterations.js's functions.

// choice: undefined = not read yet (app.js drops it on a board rename), null = none kept, else { pick }.
// shown: the pick the last render drew, to tell when the pick changed.
const iterationUi = { choice: undefined, shown: null, signature: '' };

function iterationsOn() {
  return !!(state.iterations && state.groups);
}

function iterationChoiceKey() {
  return storageKey(state.projectName, 'iteration');
}

function iterationSavedChoice() {
  if (iterationUi.choice === undefined) {
    let raw = null;
    try { raw = localStorage.getItem(iterationChoiceKey()); } catch (e) { raw = null; }
    iterationUi.choice = iterationChoiceRead(raw);
  }
  return iterationUi.choice;
}

function iterationSaveChoice(pick) {
  iterationUi.choice = { pick };
  try { localStorage.setItem(iterationChoiceKey(), iterationChoiceWrite(pick)); }
  catch (e) { /* storage unavailable/full: the choice just won't persist this session */ }
}

// The id the dropdown shows now ('' = All cards). Worked out at each render, so a tab left open
// across midnight moves to the iteration that is running then, until a pick is made.
function iterationPickNow() {
  return iterationsOn() ? iterationPick(iterationSavedChoice(), groupsList(), localTodayStr()) : '';
}

// The ids the views are cut to, or null for no cut.
function iterationCutIds() {
  return iterationsOn() ? iterationCut(groupsList(), iterationPickNow()) : null;
}

function withIterationCut(ids) {
  const cut = iterationCutIds();
  return cut ? intersectVisibleIds(ids, cut) : ids;
}

// Whether the Calendar shades a day: a function made once per Calendar draw, true for the picked
// iteration's days and false for every day when none is picked or it has no two dates.
function iterationDayShader() {
  const pick = iterationPickNow();
  const group = pick ? iterationList(groupsList()).find((g) => g.id === pick) : null;
  const span = iterationSpan(group);
  return (day) => iterationShades(span, day);
}

function iterationSelectTip(group) {
  return group
    ? `Every view shows only ${groupLabel(group)}'s cards, on top of the search box. Picking never changes a group.`
    : 'Every card. Pick an iteration to narrow every view to its cards.';
}

// Draws the dropdown from the payload. The options are rebuilt only when they change, so an open
// native list is not closed by a refresh.
function renderIterations() {
  const sel = $('#iter-select');
  if (!sel) return;
  if (!iterationsOn()) {
    sel.hidden = true;
    if (iterationUi.signature) sel.replaceChildren();
    iterationUi.signature = '';
    iterationUi.shown = null;
    return;
  }
  const today = localTodayStr();
  const list = iterationList(groupsList());
  const pick = iterationPickNow();
  const options = [['', 'All cards']].concat(list.map((g) => [g.id, iterationLabel(g, today)]), [['__new', 'New iteration…']]);
  const signature = JSON.stringify(options);
  if (signature !== iterationUi.signature) {
    iterationUi.signature = signature;
    sel.replaceChildren(...options.map(([value, text]) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      return o;
    }));
  }
  sel.value = pick;
  sel.hidden = false;
  const group = pick ? list.find((g) => g.id === pick) || null : null;
  sel.title = iterationSelectTip(group);
  sel.classList.toggle('narrowed', !!group);
  if (pick !== iterationUi.shown) {
    iterationUi.shown = pick;
    const span = iterationSpan(group);
    if (span) calendarAnchorTo(span.start);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const sel = $('#iter-select');
  sel.addEventListener('change', () => {
    const value = sel.value;
    if (value === '__new') {
      sel.value = iterationPickNow();
      openGroupForm(iterationNextDraft(groupsList(), localTodayStr()));
      return;
    }
    iterationSaveChoice(value);
    renderBoard();
  });
});
