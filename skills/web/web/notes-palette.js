'use strict';
// The notes palette on the page (docs/adr/0016): the one surface for a board's notes. n on the
// card whose details are open, else the hovered or selected card, a card's note count and the
// right-click Add note... open it aimed at a card; with nothing aimed at it opens on the card last
// noted. Over the card details it draws above them and Esc closes it before them. Rows, top down:
// the subject row (the chip that says what it is about, the date and time fields, the untimed
// tick and the card picker), the note box, the preview line that says what Enter will write, the
// filter row (the filter field, and beside it the Grouped or Timeline switch and the All, Human and
// AI switch on a note's author), the range row (All, Month, Week, 3 days or Day, with previous and
// next buttons and the range's label), then the notes list, newest day first: Grouped by day and
// card, or Timeline, one flat list per day by time with each row naming its card. The range is
// set each time the palette opens (notes.js noteRangeFor) and is no memory: a card, a group or
// several cards open on All, nothing aimed at on Day today or on what the Calendar asked for. The filter field reads `by:@handle`
// too; a note written in this palette stays listed whatever the filter and the switches say.
//
// A group is a subject too (docs/adr/0015): a badge on a card, a mention of a group's id and the
// right-click Add note... on a selection aim the palette at it. A group's palette has a tab row, Notes
// and Group; the Group tab (groups-ui.js groupPanel) edits the group and lists its members and,
// like the notes list, belongs to the same surface. With the logbook off a group still opens, on its
// Group tab alone. A card or group of a board that keeps scratchpads has a third tab, Scratchpad
// (scratchpad-ui.js scratchPanel), and a Todos tab after it on a board that keeps todo lists (todos-ui.js
// todosPanel); a card opens on those alone when the logbook is off. Several
// cards at once are the subject "each": one note is written on every card.
//
// Keys. In the box: Enter writes the note and keeps the palette open for the next, Shift+Enter
// starts a new line, a bare mention (#22) then Enter aims the palette at that card, Backspace
// on an empty box clears the chip, the down arrow moves into the list. On a listed note:
// the arrows move, e edits, a assigns, d twice deletes. Esc closes. Every key typed in
// the palette stays in it: none reaches the board's own single-key shortcuts.
//
// The palette is no modal: it takes no backdrop, so the board keeps refreshing behind it, and
// each refresh repaints the list from the new board payload (notesOnBoard) unless a note is
// being edited. It reads the board payload's logbook (state.logbook); with none, nothing of it
// shows. The rules (reading the line, planning the write, ordering the list) are notes.js.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never
// when it loads: $, state, api, toast, loadBoard, openCard, localTodayStr, hoveredId, selectedIds, currentDetailId,
// prefsStorage, keyGuardOff, scratchpadOn, scratchPanel, todosOn, todosPanel, todosHints, todosOnBoard, wireDatePickButton, attachCombobox, loadViewMode,
// loadCalendarSubview, currentCalendarAnchor, calendarHoverDay, and notes.js's and groups.js's functions.

const notesUi = {
  el: null, input: null, time: null, untimed: null, chip: null, chipText: null, prev: null,
  date: null, dateBtn: null, dateWrap: null, dateTyped: false, pick: null, pickWrap: null,
  range: { mode: 'day', anchor: '' }, rangeTouched: false, rangeRow: null, rangeBtns: [], rangeStepBtns: [], rangeLabel: null, rangeLive: null,
  filter: null, filterRow: null, when: null, tabsEl: null, bySlot: null, byBtns: [], by: 'all', layoutSlot: null, layoutBtns: [], layout: 'grouped', layoutFor: null, body: null, foot: null, timeTyped: false,
  head: null, fsBtn: null,
  sub: null, tab: 'notes', groupSig: '', hi: -1, written: [], editing: 0, writing: false, opener: null, lastFor: null, last: '',
};

let notesCountsOf = null;
let notesCountsMap = new Map();

function notesOn() {
  return !!state.logbook;
}

function notesAll() {
  return state.logbook ? state.logbook.notes : [];
}

function notesCard(id) {
  return state.active.find((c) => c.id === id) || state.archived.find((c) => c.id === id) || null;
}

function notesGroup(id) {
  return state.groups ? groupById(state.groups.list, id) : null;
}

// A card or a group as the chip and the list read it; '' is a note about nothing.
function notesLabel(id) {
  if (id === '') return NOTE_NO_CARD;
  const card = notesCard(id);
  if (card) return `#${id} ${card.title}`;
  const group = notesGroup(id);
  return group ? groupLabel(group) : `#${id}`;
}

const notesKnown = () => ({ board: state.projectName, isTarget: (id) => notesCard(id) !== null || notesGroup(id) !== null });

// The card last noted, kept in this browser; a card that is gone is no card.
function notesLastNoted() {
  if (notesUi.lastFor !== state.projectName) {
    const storage = prefsStorage();
    notesUi.last = storage ? noteLastLoad(storage, state.projectName) : '';
    notesUi.lastFor = state.projectName;
  }
  return notesUi.last && notesCard(notesUi.last) ? notesUi.last : '';
}

// The list's layout, kept in this browser per board.
function notesLayout() {
  const u = notesUi;
  if (u.layoutFor !== state.projectName) {
    const storage = prefsStorage();
    u.layout = storage ? noteLayoutLoad(storage, state.projectName) : 'grouped';
    u.layoutFor = state.projectName;
  }
  return u.layout;
}

const notesCtx = () => ({ today: localTodayStr(), now: noteClock(new Date()), lastNoted: notesLastNoted() });
const notesField = () => ({ value: notesUi.time.value, untimed: notesUi.untimed.checked, day: notesUi.date.value });
const NOTES_LAYOUTS = [['grouped', 'Grouped', 'The notes grouped by day and card'], ['timeline', 'Timeline', 'One list of the notes by day and time, each naming its card']];
const NOTES_RANGES = [['all', 'All', 'Every day'], ['month', 'Month', 'A month at a time'], ['week', 'Week', 'A week at a time, from Monday'], ['3day', '3 days', 'Three days at a time'], ['day', 'Day', 'A day at a time']];
const NOTES_BY = [['all', 'All', 'Every note'], ['human', 'Human', 'Notes by a human'], ['ai', 'AI', 'Notes by an AI, or by a handle the board does not list']];
const notesKey = (n) => `${n.day}|${n.target}|${n.at || ''}|${n.note}|${n.by}`;

function notesEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function notesButton(className, text, title, onclick) {
  const b = notesEl('button', className, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onclick(b, e); });
  return b;
}

// The note's text with a mention of a card of this board as a chip that opens it.
function notesTextNodes(text) {
  const nodes = [];
  let at = 0;
  for (const m of kanbanIds.findMentions(text)) {
    const id = kanbanIds.idKey(`${m.prefix}${m.number}`);
    if (id === null || (m.board !== null && m.board !== state.projectName)) continue;
    if (m.start > at) nodes.push(document.createTextNode(text.slice(at, m.start)));
    const chip = notesEl('code', 'mention same', m.match);
    if (notesCard(id) === null && notesGroup(id) !== null) chip.dataset.groupId = id;
    else chip.dataset.cardId = id;
    chip.tabIndex = 0;
    chip.setAttribute('role', 'link');
    nodes.push(chip);
    at = m.end;
  }
  if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));
  return nodes;
}

// ---------- the count on a card ----------

function notesCounts() {
  const notes = notesAll();
  if (notesCountsOf !== notes) {
    notesCountsMap = noteCounts(notes);
    notesCountsOf = notes;
  }
  return notesCountsMap;
}

// The small count on a card's tile, or null when the board keeps no logbook or the card has no
// note. A button: it opens the card's notes.
function noteCountButton(id) {
  if (!notesOn()) return null;
  const count = notesCounts().get(id);
  if (!count) return null;
  const b = notesEl('button', 'card-notes np-trigger');
  b.type = 'button';
  b.dataset.noteTarget = id;
  b.title = `${count} note${count === 1 ? '' : 's'}; open them`;
  b.setAttribute('aria-label', b.title);
  b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h7l3 3v8H3z M5.5 7h5 M5.5 9.5h5 M5.5 12h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  b.append(document.createTextNode(String(count)));
  return b;
}

// ---------- the Calendar's notes ----------

const NOTES_SVG_NS = 'http://www.w3.org/2000/svg';

function notesGlyph() {
  const svg = document.createElementNS(NOTES_SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NOTES_SVG_NS, 'path');
  path.setAttribute('d', 'M3 2.5h7l3 3v8H3z M5.5 7h5 M5.5 9.5h5 M5.5 12h3');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

// A button the Calendar draws for notes: it opens the palette on `req` and, like the count on a
// card, is no click away from the palette (np-trigger) and none from the board's selection.
function notesCalendarButton(className, title, req) {
  const b = notesButton(`cal-note np-trigger ${className}`, undefined, title, () => openNotes(req));
  b.setAttribute('aria-label', title.replace(/\n/g, '; '));
  b.setAttribute('data-keeps-selection', '');
  return b;
}

// One half hour's notes in a day's column: a chip for one note (the card's id and the first
// words), a count bubble for two or more. `top` is the half hour's offset in pixels.
function notesCalendarSlot(day, slot, top) {
  let el;
  if (slot.notes.length === 1) {
    const note = slot.notes[0];
    el = notesCalendarButton('cal-note-chip', noteTip(note, notesLabel), noteChipRequest(note, slot));
    if (note.target) el.append(notesEl('span', 'cal-note-id', `#${note.target}`));
    else el.append(notesGlyph());
    el.append(document.createTextNode(noteFirstWords(note.note, noteChipWords(calendarNotesStrip()))));
  } else {
    el = notesCalendarButton('cal-note-bubble', noteSlotTip(slot), noteSlotRequest(day, slot));
    el.append(notesEl('b', 'cal-note-count', String(slot.notes.length)), notesEl('span', 'cal-note-ids', noteSlotTargets(slot.notes).join(' ')));
  }
  el.dataset.slot = `${day}|${slot.fromMin}`;
  el.style.top = `${top}px`;
  return el;
}

// The handle on the left edge of a day's notes strip (app.js sets the width it drags): a focusable
// separator, so the arrow keys step it as well as a pointer.
function notesCalendarDivider(day) {
  const d = notesEl('div', 'cal-note-divider');
  d.tabIndex = 0;
  d.setAttribute('role', 'separator');
  d.setAttribute('aria-orientation', 'vertical');
  d.setAttribute('aria-label', `Width of the notes on ${noteDayName(day)}`); // aria-valuenow/min/max: app.js paintCalendarNotesAria
  d.title = 'Drag to change the width of the notes, for every day. Double-click for the default width. Left and Right arrows step it.';
  d.setAttribute('data-holds-poll', '');
  d.setAttribute('data-keeps-selection', '');
  return d;
}

// The "N untimed" box in a day's all-day cell.
function notesCalendarUntimed(day, untimed) {
  const el = notesCalendarButton('cal-note-untimed', noteUntimedTip(untimed), noteUntimedRequest(day));
  el.append(notesEl('b', 'cal-note-count', String(untimed.length)), document.createTextNode(' untimed'));
  el.dataset.untimed = day;
  return el;
}

// ---------- building ----------

function notesBuild() {
  if (notesUi.el) return;
  const u = notesUi;
  u.chipText = notesEl('span', 'np-chip-text');
  const clear = notesButton('np-chip-x', '✕', 'Clear (Backspace on an empty box)', () => notesClearChip());
  clear.tabIndex = -1;
  clear.setAttribute('aria-label', 'Clear the subject');
  u.chip = notesEl('span', 'np-chip');
  u.chip.hidden = true;
  u.chip.append(u.chipText, clear);
  u.date = notesEl('input', 'np-date');
  Object.assign(u.date, { type: 'text', maxLength: 10, placeholder: 'YYYY-MM-DD', autocomplete: 'off', inputMode: 'numeric' });
  u.date.setAttribute('aria-label', 'Day of the note');
  u.date.setAttribute('data-date-only', ''); // the picker's grid without its clock row: the time is the next field
  u.dateBtn = notesButton('np-date-btn date-pick-btn', '📅', 'Pick the day', () => {});
  u.dateBtn.setAttribute('aria-label', 'Pick the day of the note');
  wireDatePickButton(u.dateBtn, u.date); // app.js: the one date picker serves this field as it does the card form's
  u.dateWrap = notesEl('span', 'np-date-wrap');
  u.dateWrap.append(u.date, u.dateBtn);
  u.time = notesEl('input', 'np-time');
  Object.assign(u.time, { type: 'text', maxLength: 5, placeholder: 'HH:MM', autocomplete: 'off', inputMode: 'numeric' });
  u.time.setAttribute('aria-label', 'Time of the note');
  u.untimed = notesEl('input', 'np-untimed');
  u.untimed.type = 'checkbox';
  const untimedLabel = notesEl('label', 'np-untimed-label');
  untimedLabel.append(u.untimed, document.createTextNode(' untimed'));
  const when = notesEl('span', 'np-when');
  u.pick = notesEl('input', 'np-pick-input');
  Object.assign(u.pick, { type: 'text', autocomplete: 'off', placeholder: 'Card' });
  u.pick.setAttribute('aria-label', 'Card the note is about');
  u.pickWrap = notesEl('span', 'np-pick');
  u.pickWrap.append(u.pick);
  when.append(u.dateWrap, notesEl('span', '', 'at'), u.time, untimedLabel, u.pickWrap);
  attachCombobox(u.pick, notesPickOptions, { onPick: notesPicked }); // app.js: the form's suggest-never-validate menu
  // The menu hangs off the page, fixed under the field: the palette clips what overflows it.
  u.pickMenu = u.pickWrap.querySelector('.combobox-menu');
  u.pickMenu.classList.add('np-pick-menu');
  document.body.append(u.pickMenu);
  u.when = when;
  const subjectRow = notesEl('div', 'np-subject-row');
  subjectRow.append(u.chip, when);
  u.tabsEl = notesEl('div', 'np-tabs');
  u.tabsEl.setAttribute('role', 'tablist');
  u.tabsEl.hidden = true;
  u.input = notesEl('textarea', 'np-input');
  u.input.rows = 1;
  textEditAttach(u.input);
  u.input.spellcheck = true;
  u.input.setAttribute('aria-label', 'Note');
  const bar = notesEl('div', 'np-bar');
  bar.append(subjectRow, u.input);
  u.prev = notesEl('div', 'np-prev');
  u.prev.setAttribute('aria-live', 'polite');
  u.filter = notesEl('input', 'np-filter');
  Object.assign(u.filter, { type: 'search', autocomplete: 'off', placeholder: 'Filter these notes; by:@handle' });
  u.filter.setAttribute('aria-label', 'Filter the notes below');
  u.bySlot = notesEl('span', 'np-by-slot');
  u.bySlot.setAttribute('role', 'group');
  u.bySlot.setAttribute('aria-label', 'Notes by');
  u.byBtns = NOTES_BY.map(([by, text, title]) => {
    const b = notesButton('np-by-btn', text, title, () => notesSetBy(by));
    b.dataset.by = by;
    return b;
  });
  u.bySlot.append(...u.byBtns);
  u.layoutSlot = notesEl('span', 'np-by-slot np-layout-slot');
  u.layoutSlot.setAttribute('role', 'group');
  u.layoutSlot.setAttribute('aria-label', 'List layout');
  u.layoutBtns = NOTES_LAYOUTS.map(([layout, text, title]) => {
    const b = notesButton('np-by-btn', text, title, () => notesSetLayout(layout));
    b.dataset.layout = layout;
    return b;
  });
  u.layoutSlot.append(...u.layoutBtns);
  const filterRow = notesEl('div', 'np-filter-row');
  filterRow.append(u.filter, u.layoutSlot, u.bySlot);
  u.filterRow = filterRow;
  u.rangeRow = notesEl('div', 'np-range-row');
  const rangeSlot = notesEl('span', 'np-by-slot np-range-slot');
  rangeSlot.setAttribute('role', 'group');
  rangeSlot.setAttribute('aria-label', 'Dates shown');
  u.rangeBtns = NOTES_RANGES.map(([mode, text, title]) => {
    const b = notesButton('np-by-btn', text, title, () => notesSetRangeMode(mode));
    b.dataset.range = mode;
    return b;
  });
  rangeSlot.append(...u.rangeBtns);
  u.rangeStepBtns = [-1, 1].map((dir) => {
    const b = notesButton('np-range-step', dir < 0 ? '‹' : '›', dir < 0 ? 'Previous' : 'Next', () => notesStepRange(dir));
    b.setAttribute('aria-label', dir < 0 ? 'Previous range' : 'Next range');
    b.dataset.step = String(dir);
    return b;
  });
  u.rangeLabel = notesButton('np-range-label', '', 'Back to today', () => notesRangeToday());
  u.rangeLabel.setAttribute('aria-label', 'Back to today');
  u.rangeLive = notesEl('span', 'np-range-live'); // what a change of range lists, for a screen reader
  u.rangeLive.setAttribute('role', 'status');
  u.rangeLive.setAttribute('aria-live', 'polite');
  u.rangeRow.append(rangeSlot, u.rangeStepBtns[0], u.rangeLabel, u.rangeStepBtns[1], u.rangeLive);
  u.body = notesEl('div', 'np-body');
  u.foot = notesEl('div', 'np-foot');
  u.fsBtn = notesButton('icon-btn np-fs-btn', '', '', () => toggleModalFullscreen('notes')); // app.js applyModalFullscreen gives it its icon, label and pressed state
  u.fsBtn.id = 'notes-fullscreen-btn';
  u.head = notesEl('div', 'np-head');
  u.head.append(u.tabsEl, u.fsBtn);
  u.el = notesEl('section', 'notes-palette hidden');
  u.el.id = 'notes-palette';
  u.el.setAttribute('role', 'dialog');
  u.el.setAttribute('aria-label', 'Notes');
  u.el.dataset.keepsSelection = '';
  u.el.append(u.head, bar, u.prev, filterRow, u.rangeRow, u.body, u.foot);
  document.body.append(u.el);

  u.input.addEventListener('input', () => { notesGrow(); notesPaintPreview(); });
  u.filter.addEventListener('input', () => { u.hi = -1; notesPaintBody(); });
  u.time.addEventListener('input', () => { u.timeTyped = true; notesPaintPreview(); });
  u.date.addEventListener('input', () => { u.dateTyped = true; notesPaintPreview(); });
  u.date.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); u.input.focus(); } });
  u.pick.addEventListener('focus', notesPlacePickMenu);
  u.pick.addEventListener('input', notesPlacePickMenu);
  u.pick.addEventListener('blur', notesCommitPick);
  u.pick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); notesCommitPick(); } });
  u.untimed.addEventListener('change', () => { u.time.disabled = u.untimed.checked; notesPaintPreview(); u.input.focus(); });
  u.time.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); u.input.focus(); } });
  u.filter.addEventListener('keydown', notesOnFilterKey);
  u.input.addEventListener('keydown', notesOnInputKey);
  u.body.addEventListener('keydown', notesOnBodyKey);
  u.body.addEventListener('focusin', (e) => {
    const row = e.target.closest && e.target.closest('.np-note');
    if (row) u.hi = notesRows().indexOf(row);
  });
  u.body.addEventListener('click', (e) => {
    const chip = e.target.closest && e.target.closest('code.mention.same');
    if (chip && chip.dataset.groupId) openNotes({ kind: 'group', gid: chip.dataset.groupId });
    else if (chip) { notesClose(); openCard(chip.dataset.cardId); }
  });
  u.el.addEventListener('keydown', notesOnFullscreenKey, true); // ahead of the boxes' own Enter
  u.el.addEventListener('keydown', notesOnPaletteKey);
}

// A note box is as high as its text, up to a cap (notes.js noteBoxSize); the box is measured at its
// own width, so wrapped lines count. A box that is not shown has no height to measure: it keeps
// auto and is sized when it is next painted.
function notesGrowBox(box) {
  box.style.height = 'auto';
  if (!box.scrollHeight) return;
  const css = getComputedStyle(box);
  const px = (v) => parseFloat(v) || 0;
  const border = px(css.borderTopWidth) + px(css.borderBottomWidth);
  const size = noteBoxSize({
    content: box.scrollHeight + border,
    line: px(css.lineHeight) || px(css.fontSize) * 1.4,
    chrome: px(css.paddingTop) + px(css.paddingBottom) + border,
    windowHeight: window.innerHeight,
    ...(notesUi.el && notesUi.el.classList.contains('fullscreen') && notesFullscreenLocked() === null ? NOTES_FULLSCREEN_BOX : {}),
  });
  box.style.height = `${size.height}px`;
  box.style.overflowY = size.scroll ? 'auto' : 'hidden';
}

const notesGrow = () => notesGrowBox(notesUi.input);

// Fullscreen is room: a note box may grow to this many lines, and to this share of the window, before it
// scrolls inside (notes.js noteBoxSize).
const NOTES_FULLSCREEN_BOX = { lines: 30, share: 0.7 };

// The one place that decides where the palette has a choice: from this window width up. Under it (a
// phone) the palette is always full screen, as the card details are: whatever was saved, the button is
// hidden, Alt+Enter does nothing and the note boxes keep their ordinary cap.
const NOTES_FULLSCREEN_MIN_WIDTH = 760;
const notesFullscreenLocked = () => (window.innerWidth < NOTES_FULLSCREEN_MIN_WIDTH ? true : null);

// The palette is the popup Alt+Enter and the fullscreen button answer for when it is open and nothing but the
// card details is up besides it (the key guard names that one popup, as for the other notes keys).
function notesOnTop() {
  return !!notesUi.el && !!notesUi.sub && keyGuardSurface(document, NOTES_DETAIL) === null;
}

// The boxes are measured at the width fullscreen changed, and the room they may take has changed too.
function notesFullscreenChanged() {
  const u = notesUi;
  if (!u.sub) return;
  notesGrow();
  u.body.querySelectorAll('.np-edit-text').forEach(notesGrowBox);
}

// Alt+Enter inside the palette toggles its fullscreen, from any box of it, and never reaches the box's own
// Enter (which writes a note). Read in the capture phase, ahead of the target's handlers.
function notesOnFullscreenKey(e) {
  if (e.key !== 'Enter' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !notesUi.sub) return;
  e.preventDefault();
  e.stopPropagation();
  if (notesOnTop()) toggleModalFullscreen('notes');
}

// ---------- opening and closing ----------

// Open the palette. `req` is what asks for it (notes.js, noteSubjectFrom): a card's notes
// ({ kind: 'card-notes', id }), a day's slot or untimed box, a card or group to write on
// ({ target }), or nothing ({}) to start on the card last noted.
function openNotes(req) {
  if (!notesOn() && !state.groups && !scratchpadOn() && !todosOn()) return;
  notesBuild();
  const u = notesUi;
  const ctx = notesCtx();
  const sub = noteSubjectFrom(req || {}, { today: ctx.today, isGroup: (id) => notesGroup(id) !== null });
  if (sub.kind === 'card' && !notesCard(sub.id)) return;
  if (sub.kind === 'group' && !notesGroup(sub.id)) return;
  if (!notesOn() && sub.kind !== 'group' && !(sub.kind === 'card' && (scratchpadOn() || todosOn()))) return;
  const same = u.sub && JSON.stringify(u.sub) === JSON.stringify(sub);
  if (!u.sub && document.activeElement && !u.el.contains(document.activeElement)) u.opener = document.activeElement;
  u.sub = sub;
  u.tab = req && req.kind === 'group' ? 'group' : req && req.kind === 'scratchpad' ? 'scratch' : req && req.kind === 'todos' ? 'todos' : same ? u.tab : 'notes';
  if (!notesTabs().includes(u.tab)) u.tab = notesTabs()[0];
  if (!same) {
    u.written = [];
    u.input.value = '';
    u.filter.value = '';
    u.by = 'all';
    u.dateTyped = false;
    notesGrow();
    notesResetTime();
  }
  u.range = noteRangeFor(sub, req, ctx.today);
  u.rangeTouched = false;
  u.hi = -1;
  u.el.classList.toggle('np-over-detail', notesDetailId() !== null);
  applyModalFullscreen('notes'); // the board's saved choice, on every open
  u.el.classList.remove('hidden');
  notesPaint();
  if (u.tab !== 'notes') notesFocusGroupPanel(); else u.input.focus();
}

// The tabs a subject has (notes.js noteTabs): Notes (when the board keeps a logbook), a group's
// Group tab, the Scratchpad of a card or group (when the board keeps scratchpads) and its Todos (when
// the board keeps todo lists).
function notesTabs() {
  return noteTabs(notesUi.sub, { notesOn: notesOn(), scratchpadOn: scratchpadOn(), todosOn: todosOn() });
}

function notesSetTab(tab) {
  const u = notesUi;
  if (!u.sub || !notesTabs().includes(tab)) return;
  u.tab = tab;
  u.hi = -1;
  u.groupSig = '';
  notesPaint();
  if (tab !== 'notes') notesFocusGroupPanel(); else u.input.focus();
}

function notesFocusGroupPanel() {
  const first = notesUi.body.querySelector('input, button');
  if (first) first.focus({ preventScroll: true });
}

function notesClose() {
  const u = notesUi;
  if (!u.sub) return false;
  u.sub = null;
  u.tab = 'notes';
  u.groupSig = '';
  u.written = [];
  u.hi = -1;
  u.editing = 0;
  u.el.classList.add('hidden');
  u.body.replaceChildren();
  u.input.value = '';
  u.filter.value = '';
  u.by = 'all';
  u.dateTyped = false;
  u.pickMenu.hidden = true;
  const back = u.opener;
  u.opener = null;
  if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  if (u.el.contains(document.activeElement)) document.activeElement.blur(); // never leave the focus in the hidden palette
  return true;
}

// After a write the field goes back to what it starts as (the slot's time, else now), unless the
// person typed a time into it, or ticked untimed, which stay as they were.
function notesRefreshTime() {
  const u = notesUi;
  if (!u.sub) return;
  if (!u.dateTyped) u.date.value = u.sub.day;
  if (u.timeTyped || u.untimed.checked) return;
  u.time.value = u.sub.at || noteClock(new Date());
}

function notesResetTime() {
  const u = notesUi;
  const sub = u.sub || {};
  u.timeTyped = false;
  const untimed = sub.kind === 'untimed' || !!sub.untimed;
  u.untimed.checked = untimed;
  u.time.disabled = untimed;
  u.time.value = untimed ? '' : sub.at || noteClock(new Date());
  if (!u.dateTyped) u.date.value = sub.day || localTodayStr();
}

// The palette has a new subject: back to its Notes tab with nothing written yet, nothing highlighted
// and the range the opening rule gives that subject (on the Calendar, for a subject aimed at nothing,
// the Calendar's own range).
function notesRetargeted() {
  const u = notesUi;
  u.tab = 'notes';
  u.written = [];
  u.hi = -1;
  u.range = noteRangeFor(u.sub, notesCalendarOpening(), localTodayStr());
  u.rangeTouched = false;
}

function notesClearChip() {
  const u = notesUi;
  if (!u.sub || u.sub.kind === 'none') return;
  if (!notesOn()) { notesClose(); return; }
  u.sub = noteSubjectCleared(u.sub, localTodayStr());
  notesRetargeted();
  notesResetTime();
  notesPaint();
  u.input.focus();
}

// ---------- painting ----------

function notesChipText() {
  const sub = notesUi.sub;
  const day = noteDayName(sub.day);
  if (noteIsTarget(sub)) {
    return notesLabel(sub.id) + (sub.at ? ` · ${day} ${sub.at}` : sub.untimed ? ` · ${day} untimed` : '');
  }
  if (sub.kind === 'each') return `each of ${sub.ids.length} cards`;
  if (sub.kind === 'slot') return `${day} ${sub.at}`;
  if (sub.kind === 'untimed') return `${day} untimed`;
  return '';
}

function notesPlan() {
  return noteWritePlan(noteParseLine(notesUi.input.value, notesKnown()), notesUi.sub, notesField(), notesCtx());
}

function notesPaintPreview() {
  const u = notesUi;
  if (!u.sub) return;
  const plan = notesPlan();
  const text = notePreview(plan, { label: notesLabel, dayName: noteDayName, today: localTodayStr() });
  u.prev.className = `np-prev${plan.bad ? ' bad' : !plan.text && plan.scopeTo === null ? ' idle' : ''}`;
  u.prev.replaceChildren(notesEl('span', 'np-prev-key', '↵'), notesEl('span', 'np-prev-text', text), notesEl('span', 'np-prev-hint', 'Shift+↵ new line'));
}

function notesPaint() {
  const u = notesUi;
  if (!u.sub) return;
  const text = notesChipText();
  u.chip.hidden = !text;
  u.chipText.textContent = text;
  u.chipText.title = text;
  u.input.placeholder = noteIsTarget(u.sub) ? 'Write a note' : 'Write a note; #7 picks the card';
  notesPaintTabs();
  const panel = u.tab !== 'notes';
  for (const el of [u.when, u.input, u.prev, u.filterRow, u.rangeRow]) el.hidden = panel;
  if (!panel) { notesGrow(); notesPaintPick(); notesPaintRange(); }
  const hint = (key, what) => { const s = notesEl('span'); s.append(notesEl('kbd', '', key), document.createTextNode(` ${what}`)); return s; };
  if (panel) {
    notesPaintBody();
    const hints = u.tab === 'scratch' ? [hint('Ctrl+↵', 'save'), hint('Esc', 'close')] : u.tab === 'todos' ? todosHints().map(([key, what]) => hint(key, what)) : [hint('Esc', 'close')];
    u.foot.replaceChildren(...hints);
    return;
  }
  notesPaintPreview();
  notesPaintBody();
  u.foot.replaceChildren(hint('↵', 'write'), hint('↓', 'notes'), hint('e', 'edit'), hint('a', 'assign'), hint('d d', 'delete'), ...(text ? [hint('⌫', 'clear the chip')] : []), hint('Esc', notesChipClearable() ? 'clear the chip' : 'close'));
}

// The tab row: shown only when the subject has more than one tab.
function notesPaintTabs() {
  const u = notesUi;
  const tabs = notesTabs();
  u.tabsEl.hidden = tabs.length < 2;
  const names = { notes: 'Notes', group: 'Group', scratch: 'Scratchpad', todos: 'Todos' };
  u.tabsEl.replaceChildren(...tabs.map((t) => {
    const key = `Alt+${tabs.indexOf(t) + 1}`;
    const b = notesButton(`np-tab${t === u.tab ? ' on' : ''}`, names[t], `${names[t]} (${key})`, () => notesSetTab(t));
    b.dataset.key = key; // drawn after the name by the stylesheet, with an empty alternative text: the button's name stays its text
    b.setAttribute('aria-keyshortcuts', key);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === u.tab));
    b.dataset.tab = t;
    return b;
  }));
}

function notesSetBy(by) {
  const u = notesUi;
  u.by = by;
  u.hi = -1;
  notesPaintBody();
}

function notesSetLayout(layout) {
  const u = notesUi;
  u.layout = layout;
  u.layoutFor = state.projectName;
  const storage = prefsStorage();
  if (storage) noteLayoutSave(storage, state.projectName, layout);
  u.hi = -1;
  notesPaintBody();
}

function notesPaintBody() {
  const u = notesUi;
  if (!u.sub) return;
  for (const b of u.byBtns) b.setAttribute('aria-pressed', String(b.dataset.by === u.by));
  for (const b of u.layoutBtns) b.setAttribute('aria-pressed', String(b.dataset.layout === notesLayout()));
  const scroll = u.body.scrollTop;
  u.editing = 0; // the rows are built anew: none is being edited
  if (u.tab === 'group') {
    u.groupSig = groupSignature(notesGroup(u.sub.id));
    u.body.replaceChildren(groupPanel(u.sub.id));
  } else if (u.tab === 'scratch') {
    u.body.replaceChildren(scratchPanel(u.sub.id));
  } else if (u.tab === 'todos') {
    u.body.replaceChildren(todosPanel(u.sub.id));
  } else {
    u.body.replaceChildren(notesList());
  }
  u.body.scrollTop = scroll;
}

function notesList() {
  const u = notesUi;
  const sub = u.sub;
  const fresh = new Set(u.written);
  const all = notesAll();
  const group = sub.kind === 'group' ? notesGroup(sub.id) : null;
  const mine = noteListNotes(all, sub, { ...u.range, touched: u.rangeTouched }, { members: () => (group ? group.cards : []) });
  const shown = new Set(noteFilter(mine, u.filter.value, notesLabel, { by: u.by, assignees: state.assignees }));
  const notes = mine.filter((n) => shown.has(n) || fresh.has(notesKey(n)));
  for (const n of all) if (fresh.has(notesKey(n)) && !notes.includes(n)) notes.push(n);
  if (!notes.length) {
    const typed = u.filter.value.trim();
    const ranged = u.range.mode !== 'all' && !(sub.kind === 'none' && u.range.mode === 'day' && u.range.anchor === localTodayStr());
    const none = sub.kind === 'none' ? 'No notes today yet.' : 'No notes here yet. Enter writes the first one.';
    const text = mine.length ? (typed ? `No note here matches “${typed}”${u.by === 'all' ? '' : ` by ${u.by === 'human' ? 'a human' : 'an AI'}`}.` : `No note here is by ${u.by === 'human' ? 'a human' : 'an AI'}.`) : ranged ? `No notes in ${noteRangeLabel(u.range.mode, u.range.anchor)} yet.` : none;
    return notesEl('p', 'np-empty', text);
  }
  const today = localTodayStr();
  const multiDay = new Set(notes.map((n) => n.day)).size > 1;
  const wrap = notesEl('div', 'np-notes');
  const first = noteIsTarget(sub) ? sub.id : null;
  if (notesLayout() === 'timeline') {
    for (const day of noteTimeline(notes, { first })) {
      const block = notesEl('section', 'np-ngroup np-tgroup');
      block.dataset.day = day.day;
      if (multiDay || day.day !== today) {
        const head = notesEl('div', 'np-nhead');
        head.append(notesEl('span', 'np-nday', notesDayText(day.day, today)), notesEl('span', 'np-nhead-count', String(day.notes.length)));
        block.append(head);
      }
      for (const n of day.notes) {
        const row = notesRow(n, true);
        if (fresh.has(notesKey(n))) row.classList.add('np-new');
        block.append(row);
      }
      wrap.append(block);
    }
    return wrap;
  }
  for (const section of noteGroups(notes, { first })) {
    const head = notesEl('div', 'np-nhead');
    head.append(notesTargetLabel(section.target, 'np-nhead-label'));
    if (multiDay || section.day !== today) head.append(notesEl('span', 'np-nday', notesDayText(section.day, today)));
    head.append(notesEl('span', 'np-nhead-count', String(section.notes.length)));
    const block = notesEl('section', 'np-ngroup');
    block.dataset.day = section.day;
    block.dataset.target = section.target;
    block.append(head);
    for (const n of section.notes) {
      const row = notesRow(n);
      if (fresh.has(notesKey(n))) row.classList.add('np-new');
      block.append(row);
    }
    wrap.append(block);
  }
  return wrap;
}

const notesDayText = (day, today) => `${noteDayName(day)}${day === today ? ' · today' : ''}`;

// A card or group as a heading or a row names it: a link that opens the card (or the group's notes),
// plain text for a note about nothing or about an id the board no longer has.
function notesTargetLabel(target, className) {
  if (!notesCard(target) && !notesGroup(target)) return notesEl('span', className, notesLabel(target));
  return notesButton(className, notesLabel(target), notesLabel(target), () => {
    if (notesCard(target)) { notesClose(); openCard(target); } else openNotes({ kind: 'group', gid: target });
  });
}

// ---------- one note ----------

// `named`: the timeline's row, which says which card or group it is about.
function notesRow(note, named = false) {
  const row = notesEl('div', `np-note${named ? ' np-tl' : ''}`);
  row.tabIndex = -1;
  row.dataset.day = note.day;
  row.dataset.target = note.target;
  let sureTimer = 0;
  const view = () => {
    if (row.classList.contains('editing')) { notesUi.editing -= 1; row.classList.remove('editing'); }
    const time = notesEl('span', `np-note-time${note.at ? '' : ' untimed'}`, note.at || 'untimed');
    const by = notesEl('span', 'np-note-by', note.by || '');
    by.title = note.by || '';
    const text = notesEl('span', 'np-note-text');
    text.append(...notesTextNodes(note.note));
    const acts = notesEl('span', 'np-note-acts');
    acts.append(
      notesAct('edit', 'Edit', 'Edit the text and the time', edit),
      notesAct('assign', 'Assign', 'Move it to another card, or to no card (same day)', assign),
      notesAct('delete', 'Delete', 'Delete this note', (b) => {
        if (!b.classList.contains('sure')) {
          b.classList.add('sure');
          b.textContent = 'Sure?';
          clearTimeout(sureTimer);
          sureTimer = setTimeout(() => { b.classList.remove('sure'); b.textContent = 'Delete'; }, 3500);
          return;
        }
        notesDo('DELETE', '/api/notes', { ref: noteRef(note) }, row);
      }),
    );
    row.replaceChildren(...(named ? [time, by, notesTargetLabel(note.target, 'np-note-card'), text, acts] : [time, by, text, acts]));
  };
  const enter = () => {
    if (!row.classList.contains('editing')) { row.classList.add('editing'); notesUi.editing += 1; }
  };
  const edit = () => {
    enter();
    const t = notesEl('input', 'np-edit-time');
    Object.assign(t, { type: 'text', value: note.at || '', placeholder: 'untimed', maxLength: 5 });
    t.setAttribute('aria-label', 'Time, blank for untimed');
    const x = notesEl('textarea', 'np-edit-text');
    x.value = note.note;
    x.rows = 1;
    textEditAttach(x);
    x.addEventListener('input', () => notesGrowBox(x));
    x.setAttribute('aria-label', 'Note');
    const save = notesButton('np-edit-save', 'Save', '', () => submit());
    const cancel = notesButton('np-edit-cancel', 'Cancel', '', () => { view(); row.focus(); });
    const form = notesEl('div', 'np-edit');
    form.append(t, x, save, cancel);
    const submit = () => {
      const at = t.value.trim() === '' ? '' : noteFieldTime(t.value);
      if (at === null) { toast(`${t.value.trim()} is not a time; a time reads HH:MM.`); return; }
      notesDo('PATCH', '/api/notes', { ref: noteRef(note), at, note: x.value }, row);
    };
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); view(); row.focus(); }
      else if (e.key === 'Enter' && !e.shiftKey && e.target !== cancel && e.target !== save) { e.preventDefault(); submit(); }
    });
    row.replaceChildren(form);
    x.focus();
    notesGrowBox(x);
  };
  const assign = () => {
    enter();
    const input = notesEl('input', 'np-assign-input');
    Object.assign(input, { type: 'text', placeholder: '#id, a title, or no card', autocomplete: 'off' });
    input.setAttribute('aria-label', 'Move the note to');
    const list = notesEl('div', 'np-assign-list');
    let options = [];
    let at = 0;
    const choose = (id) => {
      if (id === note.target) { view(); row.focus(); return; }
      notesDo('POST', '/api/notes/assign', { ref: noteRef(note), to: id }, row);
    };
    const paintOptions = () => {
      const q = input.value.trim().toLowerCase().replace(/^#/, '');
      options = [{ id: '', label: 'No card' }]
        .concat(state.active.concat(state.archived).map((c) => ({ id: c.id, label: `#${c.id} ${c.title}` })))
        .concat(state.groups ? state.groups.list.map((g) => ({ id: g.id, label: groupLabel(g) })) : [])
        .filter((o) => o.id !== note.target && (q === '' || o.label.toLowerCase().replace(/^#/, '').includes(q)))
        .slice(0, 8);
      at = Math.min(at, Math.max(0, options.length - 1));
      list.replaceChildren(...options.map((o, i) => {
        const item = notesEl('div', `np-assign-item${i === at ? ' on' : ''}`, o.label);
        item.addEventListener('mousedown', (e) => { e.preventDefault(); choose(o.id); });
        return item;
      }));
    };
    input.addEventListener('input', () => { at = 0; paintOptions(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); view(); row.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(at + 1, options.length - 1); paintOptions(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(at - 1, 0); paintOptions(); }
      else if (e.key === 'Enter' && options[at]) { e.preventDefault(); choose(options[at].id); }
    });
    const cancel = notesButton('np-edit-cancel', 'Cancel', '', () => { view(); row.focus(); });
    const form = notesEl('div', 'np-edit np-assign');
    form.append(notesEl('span', 'np-muted', 'Move to'), input, cancel, list);
    row.replaceChildren(form);
    paintOptions();
    input.focus();
  };
  view();
  return row;
}

function notesAct(name, label, title, onclick) {
  const b = notesButton('np-act', label, title, onclick);
  b.dataset.act = name;
  b.tabIndex = -1;
  return b;
}

// One write on a note, then the board is read again so the list shows what the file now holds;
// a note that changed under us (409) reads again too, and says so.
async function notesDo(method, path, body, row) {
  const keep = notesRows().indexOf(row);
  try {
    await api(method, path, body);
  } catch (e) {
    toast(e.message);
    if (e.status !== 409) return;
  }
  notesUi.editing = 0;
  await loadBoard();
  notesPaintBody();
  const rows = notesRows();
  if (rows.length && notesUi.sub) notesFocusRow(Math.min(Math.max(keep, 0), rows.length - 1));
  else if (notesUi.sub) notesUi.input.focus();
}

// ---------- writing ----------

async function notesWrite() {
  const u = notesUi;
  if (u.writing || !u.sub) return; // a second Enter while the first is on its way would write the note twice
  const plan = notesPlan();
  if (plan.bad) { toast(plan.bad); return; }
  if (!plan.text) { toast('Write the note first.'); return; }
  const targets = plan.targets || [plan.target];
  const made = [];
  u.writing = true;
  try {
    for (const target of targets) made.push(await api('POST', '/api/notes', { day: plan.day, target, at: plan.at || '', note: plan.text }));
  } catch (e) {
    toast(made.length ? `${e.message} (${made.length} of ${targets.length} notes written)` : e.message);
    if (!made.length) return;
  } finally {
    u.writing = false;
  }
  if (!plan.targets && plan.target && notesCard(plan.target)) {
    u.last = plan.target;
    u.lastFor = state.projectName;
    const storage = prefsStorage();
    if (storage) noteLastSave(storage, state.projectName, plan.target);
  }
  for (const m of made) u.written.push(notesKey(m.note));
  u.input.value = '';
  notesGrow();
  try { await loadBoard(); } catch (e) { toast(e.message); }
  if (u.sub) { notesRefreshTime(); notesPaint(); u.input.focus(); }
}

// Enter on a line that is only a mention: the palette moves to that card or group.
// `keepText`: the card picker aims the palette without losing what was typed; a bare mention is the line.
function notesAim(id, keepText = false) {
  const u = notesUi;
  u.sub = noteSubjectAimed(u.sub, id, notesCard(id) === null && notesGroup(id) !== null ? 'group' : 'card');
  notesRetargeted();
  if (!keepText) u.input.value = '';
  notesGrow();
  if (!u.sub.when) notesResetTime();
  else { u.untimed.checked = !!u.sub.untimed; u.time.disabled = u.untimed.checked; }
  notesPaint();
  notesPaintPick(true);
  u.input.focus();
}

// ---------- the card picker ----------

// The picker's options: no card, then every live card. The value of a card is its id, which the
// menu writes into the field and notesOnPickInput reads back.
function notesPickOptions() {
  const cards = state.active.slice().sort((a, b) => kanbanIds.compareIds(String(a.id), String(b.id)));
  return [{ value: NOTE_NO_CARD, label: NOTE_NO_CARD }].concat(cards.map((c) => ({ value: String(c.id), label: `#${c.id} ${c.title}` })));
}

// What the picker shows: the note's target as the chip would name it. A field being typed in is not
// painted over (the board refresh repaints the palette) unless `force`.
function notesPaintPick(force = false) {
  const u = notesUi;
  if (!u.sub || !u.pick) return;
  if (!force && document.activeElement === u.pick) return;
  const target = noteSubjectTarget(u.sub, notesLastNoted());
  u.pick.value = target.each ? `${target.each} cards` : notesLabel(target.id);
  u.pick.title = u.pick.value;
}

// The menu is fixed under the field, or above it when there is no room below.
function notesPlacePickMenu() {
  const u = notesUi;
  const r = u.pick.getBoundingClientRect();
  const height = u.pickMenu.getBoundingClientRect().height || 180;
  const below = r.bottom + 2;
  u.pickMenu.style.left = `${Math.round(r.left)}px`;
  u.pickMenu.style.top = `${Math.round(below + height > window.innerHeight && r.top - height - 2 > 0 ? r.top - height - 2 : below)}px`;
  u.pickMenu.style.minWidth = `${Math.max(Math.round(r.width), 320)}px`;
}

// Free text stays legal: a card id typed in the field (`22`, `#22`) that names a card aims the palette
// when Enter or leaving the field commits it, as a choice from the menu does; anything else puts the
// card the palette is on back.
function notesCommitPick() {
  const u = notesUi;
  if (!u.sub) return;
  const target = noteSubjectTarget(u.sub, notesLastNoted());
  const shown = target.each ? `${target.each} cards` : notesLabel(target.id);
  const typed = u.pick.value.trim();
  const id = typed === shown ? null : kanbanIds.idKey(typed.replace(/^#/, ''));
  if (id !== null && notesCard(id) !== null) notesAim(id, true);
  else notesPaintPick(true);
}

// A choice from the menu (the combobox's onPick): a card aims the palette at it, as a bare mention and
// Enter does, and "no card" makes the note about nothing.
function notesPicked(choice) {
  const u = notesUi;
  if (!u.sub) return;
  const value = choice.value;
  if (value === NOTE_NO_CARD) {
    u.sub = noteSubjectNoCard(u.sub);
    notesRetargeted();
    notesResetTime();
    notesPaint();
    notesPaintPick(true);
    u.input.focus();
    return;
  }
  const id = kanbanIds.idKey(value);
  if (id !== null && notesCard(id) !== null) notesAim(id, true);
  else notesPaintPick(true);
}

// ---------- the range ----------

function notesPaintRange() {
  const u = notesUi;
  if (!u.sub) return;
  for (const b of u.rangeBtns) b.setAttribute('aria-pressed', String(b.dataset.range === u.range.mode));
  const all = u.range.mode === 'all';
  for (const b of u.rangeStepBtns) b.disabled = all;
  u.rangeLabel.disabled = all;
  u.rangeLabel.textContent = noteRangeLabel(u.range.mode, u.range.anchor);
}

// Any change of the range, by the buttons, lists the range's notes and no longer only the hour or
// the untimed box the palette was opened on.
function notesRangeChanged() {
  const u = notesUi;
  u.rangeTouched = true;
  u.hi = -1;
  notesPaintRange();
  notesPaintBody();
  const count = u.body.querySelectorAll('.np-note').length;
  u.rangeLive.textContent = `${noteRangeLabel(u.range.mode, u.range.anchor)}: ${count === 0 ? 'no notes' : count === 1 ? '1 note' : `${count} notes`}`;
}

function notesSetRangeMode(mode) {
  notesUi.range = { mode, anchor: notesUi.range.anchor };
  notesRangeChanged();
}

function notesStepRange(dir) {
  const u = notesUi;
  if (u.range.mode === 'all') return;
  u.range = { mode: u.range.mode, anchor: noteRangeStep(u.range.mode, u.range.anchor, dir) };
  notesRangeChanged();
}

function notesRangeToday() {
  const u = notesUi;
  if (u.range.mode === 'all') return;
  u.range = { mode: u.range.mode, anchor: localTodayStr() };
  notesRangeChanged();
}

// ---------- keys ----------

function notesRows() {
  return notesUi.body ? [...notesUi.body.querySelectorAll('.np-note')] : [];
}

function notesFocusRow(i) {
  const rows = notesRows();
  if (!rows.length || i < 0) { notesUi.hi = -1; notesUi.input.focus(); return; }
  const row = rows[Math.min(i, rows.length - 1)];
  notesUi.hi = rows.indexOf(row);
  row.focus();
  if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}

function notesOnInputKey(e) {
  const u = notesUi;
  if (e.isComposing) return;
  if (e.key === 'Enter' && e.shiftKey) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!u.sub) return;
    const plan = notesPlan();
    if (plan.scopeTo !== null) notesAim(plan.scopeTo);
    else notesWrite();
    return;
  }
  if (e.key === 'Backspace' && u.input.value === '' && u.input.selectionStart === 0 && u.sub && u.sub.kind !== 'none') {
    e.preventDefault();
    notesClearChip();
    return;
  }
  if (e.key === 'ArrowDown' && !u.input.value.slice(u.input.selectionEnd).includes('\n')) {
    e.preventDefault();
    notesFocusRow(0);
  }
}

function notesOnFilterKey(e) {
  if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); notesFocusRow(0); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); notesUi.input.focus(); }
}

function notesOnBodyKey(e) {
  const row = e.target.classList && e.target.classList.contains('np-note') ? e.target : null;
  if (!row || row.classList.contains('editing') || e.altKey || e.ctrlKey || e.metaKey) return;
  const rows = notesRows();
  const i = rows.indexOf(row);
  const act = (name) => { const b = row.querySelector(`[data-act="${name}"]`); if (b) b.click(); };
  const own = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'ArrowDown') { own(); notesFocusRow(Math.min(i + 1, rows.length - 1)); }
  else if (e.key === 'ArrowUp') { own(); if (i <= 0) { notesUi.hi = -1; notesUi.input.focus(); } else notesFocusRow(i - 1); }
  else if (e.key === 'e' || e.key === 'Enter') { own(); act('edit'); }
  else if (e.key === 'a') { own(); act('assign'); }
  else if (e.key === 'd') { own(); act('delete'); }
  else if (e.key === 'Backspace') { own(); notesUi.input.focus(); }
  else if (e.key.length === 1 && e.key !== ' ') { notesUi.hi = -1; notesUi.input.focus(); }
}

// Alt+1 to Alt+4 switch to the palette's first to fourth tab, as the tab row shows
// them; a number past the last tab does nothing. The keys type nothing, so they work from the note
// box too, and they are the palette's own while it is open.
function notesTabKey(e) {
  const at = noteTabKey(e);
  if (at === -1 || !notesUi.sub) return false;
  const tab = notesTabs()[at];
  if (at === 3 && !tab) return false; // Alt+4 is the palette's only when there is a fourth tab; before it existed it was never caught
  e.preventDefault();
  e.stopPropagation();
  if (tab) notesSetTab(tab);
  return true;
}

// With focus outside the palette the keys are the page's: they act only when a field is not being typed
// in and no surface but the card details is up. Inside the palette the palette's own handler has them.
function onNotesTabKey(e) {
  if (!notesUi.el || notesUi.el.contains(e.target) || keyGuardOff(document, NOTES_DETAIL)) return;
  notesTabKey(e);
}

// Esc: while the palette is aimed at a card, a group or several cards, on its Notes tab, it clears the chip
// as the backspace does and the palette stays up; with no chip to clear it closes. The filter field is
// the exception: Esc there closes at once.
function notesChipClearable() {
  return !!notesUi.sub && notesUi.tab === 'notes' && noteIsAboutCards(notesUi.sub);
}

function notesEscape(fromFilter = false) {
  if (notesChipClearable() && !fromFilter) notesClearChip();
  else notesClose();
}

function notesOnPaletteKey(e) {
  if (!notesUi.sub) return; // a palette that has closed keeps no keys: a box that still holds the focus must not swallow the page's Esc
  if (notesTabKey(e) || scratchPreviewKey(e)) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    notesEscape(e.target === notesUi.filter);
    return;
  }
  e.stopPropagation();
}

// The one popup the notes keys work over, through the key guard's `except`: n, t and Alt+1 to Alt+4 act with
// the card details up and no other surface, and Esc closes the palette ahead of the details.
const NOTES_DETAIL = '#detail-modal';

// The card whose details are open, else null.
function notesDetailId() {
  return currentDetailId != null && !$(NOTES_DETAIL).classList.contains('hidden') ? currentDetailId : null;
}

// The card a key means: the one whose details are open, else the hovered card, else the one selected card;
// null when there is none. `n` and `t` both read it.
function notesAimedCard() {
  const detail = notesDetailId();
  return detail !== null && notesCard(detail) ? detail : hoveredId !== null && notesCard(hoveredId) ? hoveredId : selectedIds.size === 1 ? [...selectedIds][0] : null;
}

// n opens the palette on the aimed card (notesAimedCard), else on the card last noted. `t` (todos-ui.js) opens
// the Todos tab of the same card. Keys that type nothing but read a letter, so they
// read the key guard: off while a field has focus and while a menu, a dialog, the notifications
// panel or the preferences sheet is up. The card details are the one popup they work over.
function onNotesKey(e) {
  if (!e.key || e.key.toLowerCase() !== 'n' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (keyGuardOff(document, NOTES_DETAIL)) return;
  e.preventDefault();
  if (!notesOn()) { toast('The logbook is off: config.yaml has no logbook: line.'); return; }
  const aimed = notesAimedCard();
  openNotes(aimed === null ? notesCalendarOpening() : { kind: 'card-notes', id: aimed });
}

// n with no card on the Calendar: the Calendar's own mode and range, or, with the pointer on a day,
// that one day as the range. The range only chooses what is listed: the note still goes to today.
// Elsewhere nothing: Day, today.
function notesCalendarOpening() {
  if (loadViewMode() !== 'calendar') return {};
  if (calendarHoverDay) return { range: { mode: 'day', anchor: calendarHoverDay } };
  return { range: { mode: loadCalendarSubview(), anchor: currentCalendarAnchor() } };
}

// Esc with focus outside the palette (a click on its empty space took it) closes it, unless a menu or a
// popup is up: those take the Esc first. The card details are no exception to the palette: it draws
// above them, so it closes first and a second Esc closes the details. In the palette Esc is read by
// the palette itself.
function onNotesEscape(e) {
  if (e.key !== 'Escape' || !notesUi.sub || notesUi.el.contains(e.target)) return;
  if (keyGuardSurface(document, NOTES_DETAIL) !== null) return;
  e.preventDefault();
  e.stopPropagation();
  notesEscape();
}

// A mouse press outside the palette closes it, but not on what opens it.
function onNotesPointer(e) {
  const u = notesUi;
  if (!u.sub || u.el.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.np-trigger, .np-pick-menu, #context-menu, .modal-backdrop, #toast, .date-picker-pop')) return;
  notesClose();
}

// ---------- the board payload ----------

// Called after every board payload has been applied: the palette's list, chip and preview
// follow the file, unless a note is being edited, and a palette on a card that is gone closes.
function notesOnBoard() {
  const u = notesUi;
  if (!u.sub) return;
  const sub = u.sub;
  const missing = (sub.kind === 'card' && !notesCard(sub.id)) || (sub.kind === 'group' && !notesGroup(sub.id));
  if (missing || (!notesOn() && sub.kind !== 'group' && !(sub.kind === 'card' && (scratchpadOn() || todosOn())))) { notesClose(); return; }
  if (!notesTabs().includes(u.tab)) u.tab = notesTabs()[0];
  if (u.tab === 'scratch') return; // the page being written is not redrawn under the person's hands
  if (u.tab === 'todos') { todosOnBoard(); return; } // the list is read again, and redrawn only when it changed
  if (u.tab === 'group') {
    if (groupSignature(notesGroup(sub.id)) === u.groupSig) return;
    const typing = document.activeElement && u.body.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!typing) notesPaint(); // a field being typed in keeps its text until the poll finds it free
    return;
  }
  if (u.editing > 0) return;
  const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('.np-note');
  const at = row ? notesRows().indexOf(row) : -1;
  notesPaint();
  if (at >= 0) notesFocusRow(at);
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', onNotesKey);
  document.addEventListener('keydown', onNotesEscape, true);
  document.addEventListener('keydown', onNotesTabKey);
  window.addEventListener('resize', () => {
    if (!notesUi.sub || !notesUi.input) return;
    applyModalFullscreen('notes'); // a window that crosses the width goes between the saved choice and always full screen
    notesFullscreenChanged();
  });
  document.addEventListener('mousedown', onNotesPointer, true);
  document.addEventListener('click', (e) => {
    const count = e.target.closest && e.target.closest('.card-notes');
    if (!count) return;
    e.preventDefault();
    openNotes({ kind: 'card-notes', id: count.dataset.noteTarget });
  });
  $('#ctx-note').addEventListener('click', () => {
    hideContextMenu();
    const ids = menuSubject.ids.slice();
    if (ids.length === 1) openNotes({ kind: 'card-notes', id: ids[0] });
    else groupsAskNote(ids);
  });
});
