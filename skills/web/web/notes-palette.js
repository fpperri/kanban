'use strict';
// The notes palette on the page (docs/adr/0016): the one surface for a board's notes. n on
// the hovered or selected card, a card's note count and the right-click Add note... open it
// aimed at a card; with nothing aimed at it opens on the card last noted. Rows, top down:
// the subject row (the chip that says what it is about, the time field, the untimed tick),
// the note box, the preview line that says what Enter will write, the filter row (the
// filter field, and beside it the All, Human and AI switch on a note's author), then the
// notes list, grouped by day and card, newest day first. The filter field reads `by:@handle`
// too; a note written in this palette stays listed whatever the filter and the switch say.
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
// when it loads: $, state, api, toast, loadBoard, openCard, localTodayStr, hoveredId, selectedIds,
// prefsStorage, keyGuardOff, and notes.js's functions.

const notesUi = {
  el: null, input: null, time: null, untimed: null, chip: null, chipText: null, prev: null,
  filter: null, bySlot: null, byBtns: [], by: 'all', body: null, foot: null,
  sub: null, hi: -1, written: [], editing: 0, writing: false, opener: null, lastFor: null, last: '',
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

// A card as the chip and the list read it; '' is a note about nothing.
function notesLabel(id) {
  if (id === '') return 'no card';
  const card = notesCard(id);
  return card ? `#${id} ${card.title}` : `#${id}`;
}

const notesKnown = () => ({ board: state.projectName, isTarget: (id) => notesCard(id) !== null });

// The card last noted, kept in this browser; a card that is gone is no card.
function notesLastNoted() {
  if (notesUi.lastFor !== state.projectName) {
    const storage = prefsStorage();
    notesUi.last = storage ? noteLastLoad(storage, state.projectName) : '';
    notesUi.lastFor = state.projectName;
  }
  return notesUi.last && notesCard(notesUi.last) ? notesUi.last : '';
}

const notesCtx = () => ({ today: localTodayStr(), now: noteClock(new Date()), lastNoted: notesLastNoted() });
const notesField = () => ({ value: notesUi.time.value, untimed: notesUi.untimed.checked });
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
    chip.dataset.cardId = id;
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
  const req = noteSlotRequest(day, slot);
  let el;
  if (slot.notes.length === 1) {
    const note = slot.notes[0];
    el = notesCalendarButton('cal-note-chip', noteTip(note, notesLabel), req);
    if (note.target) el.append(notesEl('span', 'cal-note-id', `#${note.target}`));
    else el.append(notesGlyph());
    el.append(document.createTextNode(noteFirstWords(note.note, 12)));
  } else {
    el = notesCalendarButton('cal-note-bubble', noteSlotTip(slot), req);
    el.append(notesEl('b', 'cal-note-count', String(slot.notes.length)), notesEl('span', 'cal-note-ids', noteSlotTargets(slot.notes).join(' ')));
  }
  el.dataset.slot = `${day}|${slot.fromMin}`;
  el.style.top = `${top}px`;
  return el;
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
  u.time = notesEl('input', 'np-time');
  Object.assign(u.time, { type: 'text', maxLength: 5, placeholder: 'HH:MM', autocomplete: 'off', inputMode: 'numeric' });
  u.time.setAttribute('aria-label', 'Time of the note');
  u.untimed = notesEl('input', 'np-untimed');
  u.untimed.type = 'checkbox';
  const untimedLabel = notesEl('label', 'np-untimed-label');
  untimedLabel.append(u.untimed, document.createTextNode(' untimed'));
  const when = notesEl('span', 'np-when');
  when.append(notesEl('span', '', 'at'), u.time, untimedLabel);
  const subjectRow = notesEl('div', 'np-subject-row');
  subjectRow.append(u.chip, when);
  u.input = notesEl('textarea', 'np-input');
  u.input.rows = 2;
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
  const filterRow = notesEl('div', 'np-filter-row');
  filterRow.append(u.filter, u.bySlot);
  u.body = notesEl('div', 'np-body');
  u.foot = notesEl('div', 'np-foot');
  u.el = notesEl('section', 'notes-palette hidden');
  u.el.id = 'notes-palette';
  u.el.setAttribute('role', 'dialog');
  u.el.setAttribute('aria-label', 'Notes');
  u.el.dataset.keepsSelection = '';
  u.el.append(bar, u.prev, filterRow, u.body, u.foot);
  document.body.append(u.el);

  u.input.addEventListener('input', () => { notesGrow(); notesPaintPreview(); });
  u.filter.addEventListener('input', () => { u.hi = -1; notesPaintBody(); });
  u.time.addEventListener('input', notesPaintPreview);
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
    if (chip) { notesClose(); openCard(chip.dataset.cardId); }
  });
  u.el.addEventListener('keydown', notesOnPaletteKey);
}

function notesGrow() {
  const input = notesUi.input;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight + 2, 160)}px`;
}

// ---------- opening and closing ----------

// Open the palette. `req` is what asks for it (notes.js, noteSubjectFrom): a card's notes
// ({ kind: 'card-notes', id }), a day's slot or untimed box, a card or group to write on
// ({ target }), or nothing ({}) to start on the card last noted.
function openNotes(req) {
  if (!notesOn()) return;
  notesBuild();
  const u = notesUi;
  const ctx = notesCtx();
  const sub = noteSubjectFrom(req || {}, { today: ctx.today, isGroup: () => false });
  if ((sub.kind === 'card' || sub.kind === 'group') && !notesCard(sub.id)) return;
  const same = u.sub && JSON.stringify(u.sub) === JSON.stringify(sub);
  if (!u.sub && document.activeElement && !u.el.contains(document.activeElement)) u.opener = document.activeElement;
  u.sub = sub;
  if (!same) {
    u.written = [];
    u.input.value = '';
    u.filter.value = '';
    u.by = 'all';
    notesGrow();
    notesResetTime();
  }
  u.hi = -1;
  u.el.classList.remove('hidden');
  notesPaint();
  u.input.focus();
}

function notesClose() {
  const u = notesUi;
  if (!u.sub) return false;
  u.sub = null;
  u.written = [];
  u.hi = -1;
  u.editing = 0;
  u.el.classList.add('hidden');
  u.body.replaceChildren();
  u.input.value = '';
  u.filter.value = '';
  u.by = 'all';
  const back = u.opener;
  u.opener = null;
  if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  return true;
}

function notesResetTime() {
  const u = notesUi;
  const sub = u.sub || {};
  const untimed = sub.kind === 'untimed' || !!sub.untimed;
  u.untimed.checked = untimed;
  u.time.disabled = untimed;
  u.time.value = untimed ? '' : sub.at || noteClock(new Date());
}

function notesClearChip() {
  const u = notesUi;
  if (!u.sub || u.sub.kind === 'none') return;
  u.sub = noteSubjectCleared(u.sub, localTodayStr());
  u.written = [];
  u.hi = -1;
  notesResetTime();
  notesPaint();
  u.input.focus();
}

// ---------- painting ----------

function notesChipText() {
  const sub = notesUi.sub;
  const day = noteDayName(sub.day);
  if (sub.kind === 'card' || sub.kind === 'group') {
    return notesLabel(sub.id) + (sub.at ? ` · ${day} ${sub.at}` : sub.untimed ? ` · ${day} untimed` : '');
  }
  if (sub.kind === 'slot') return `${day} ${sub.at}`;
  if (sub.kind === 'untimed') return `${day} untimed`;
  return '';
}

function notesPlan() {
  return noteWritePlan(noteParseLine(notesUi.input.value, notesKnown()), notesUi.sub, notesField(), notesCtx());
}

function notesPaintPreview() {
  const u = notesUi;
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
  u.input.placeholder = u.sub.kind === 'card' || u.sub.kind === 'group' ? 'Write a note' : 'Write a note; #7 picks the card';
  notesPaintPreview();
  notesPaintBody();
  const hint = (key, what) => { const s = notesEl('span'); s.append(notesEl('kbd', '', key), document.createTextNode(` ${what}`)); return s; };
  u.foot.replaceChildren(hint('↵', 'write'), hint('↓', 'notes'), hint('e', 'edit'), hint('a', 'assign'), hint('d d', 'delete'), ...(text ? [hint('⌫', 'clear the chip')] : []), hint('Esc', 'close'));
}

function notesSetBy(by) {
  const u = notesUi;
  u.by = by;
  u.hi = -1;
  notesPaintBody();
}

function notesPaintBody() {
  const u = notesUi;
  if (!u.sub) return;
  for (const b of u.byBtns) b.setAttribute('aria-pressed', String(b.dataset.by === u.by));
  const scroll = u.body.scrollTop;
  u.editing = 0; // the rows are built anew: none is being edited
  u.body.replaceChildren(notesList());
  u.body.scrollTop = scroll;
}

function notesList() {
  const u = notesUi;
  const sub = u.sub;
  const fresh = new Set(u.written);
  const all = notesAll();
  const mine = noteSubjectNotes(all, sub);
  const shown = new Set(noteFilter(mine, u.filter.value, notesLabel, { by: u.by, assignees: state.assignees }));
  const notes = mine.filter((n) => shown.has(n) || fresh.has(notesKey(n)));
  for (const n of all) if (fresh.has(notesKey(n)) && !notes.includes(n)) notes.push(n);
  if (!notes.length) {
    const typed = u.filter.value.trim();
    const text = mine.length ? (typed ? `No note here matches “${typed}”${u.by === 'all' ? '' : ` by ${u.by === 'human' ? 'a human' : 'an AI'}`}.` : `No note here is by ${u.by === 'human' ? 'a human' : 'an AI'}.`) : sub.kind === 'none' ? 'No notes today yet.' : 'No notes here yet. Enter writes the first one.';
    return notesEl('p', 'np-empty', text);
  }
  const today = localTodayStr();
  const multiDay = new Set(notes.map((n) => n.day)).size > 1;
  const wrap = notesEl('div', 'np-notes');
  for (const section of noteGroups(notes, { first: sub.kind === 'card' || sub.kind === 'group' ? sub.id : null })) {
    const head = notesEl('div', 'np-nhead');
    head.append(section.target === '' || !notesCard(section.target)
      ? notesEl('span', 'np-nhead-label', notesLabel(section.target))
      : notesButton('np-nhead-label', notesLabel(section.target), notesLabel(section.target), () => { notesClose(); openCard(section.target); }));
    if (multiDay || section.day !== today) head.append(notesEl('span', 'np-nday', `${noteDayName(section.day)}${section.day === today ? ' · today' : ''}`));
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

// ---------- one note ----------

function notesRow(note) {
  const row = notesEl('div', 'np-note');
  row.tabIndex = -1;
  row.dataset.day = note.day;
  row.dataset.target = note.target;
  let sureTimer = 0;
  const view = () => {
    if (row.classList.contains('editing')) { notesUi.editing -= 1; row.classList.remove('editing'); }
    const time = notesEl('span', `np-note-time${note.at ? '' : ' untimed'}`, note.at || 'untimed');
    const by = notesEl('span', 'np-note-by', note.by && note.by !== '@human' ? note.by : '');
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
    row.replaceChildren(time, by, text, acts);
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
    x.rows = Math.min(6, Math.max(2, note.note.split('\n').length));
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
  if (u.writing) return; // a second Enter while the first is on its way would write the note twice
  const plan = notesPlan();
  if (plan.bad) { toast(plan.bad); return; }
  if (!plan.text) { toast('Write the note first.'); return; }
  const body = { day: plan.day, target: plan.target, at: plan.at || '', note: plan.text };
  let made;
  u.writing = true;
  try {
    made = await api('POST', '/api/notes', body);
  } catch (e) {
    toast(e.message);
    return;
  } finally {
    u.writing = false;
  }
  if (plan.target && notesCard(plan.target)) {
    u.last = plan.target;
    u.lastFor = state.projectName;
    const storage = prefsStorage();
    if (storage) noteLastSave(storage, state.projectName, plan.target);
  }
  u.written.push(notesKey(made.note));
  u.input.value = '';
  notesGrow();
  try { await loadBoard(); } catch (e) { toast(e.message); }
  if (u.sub) { notesPaint(); u.input.focus(); }
}

// Enter on a line that is only a mention: the palette moves to that card.
function notesAim(id) {
  const u = notesUi;
  u.sub = noteSubjectAimed(u.sub, id);
  u.written = [];
  u.hi = -1;
  u.input.value = '';
  notesGrow();
  if (!u.sub.when) notesResetTime();
  else { u.untimed.checked = !!u.sub.untimed; u.time.disabled = u.untimed.checked; }
  notesPaint();
  u.input.focus();
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
  else if (e.key === 'Escape' && notesUi.filter.value) { e.preventDefault(); e.stopPropagation(); notesUi.filter.value = ''; notesPaintBody(); }
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

function notesOnPaletteKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    notesClose();
    return;
  }
  e.stopPropagation();
}

// n opens the palette on the hovered card, else the one selected card, else on the card last
// noted. A key that types nothing but reads a letter, so it reads the whole key guard
// unchanged: off while a field has focus and while a menu, a dialog, the notifications panel or
// the preferences sheet is up.
function onNotesKey(e) {
  if (!e.key || e.key.toLowerCase() !== 'n' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (keyGuardOff(document)) return;
  e.preventDefault();
  if (!notesOn()) { toast('The logbook is off: config.yaml has no logbook: line.'); return; }
  const aimed = hoveredId !== null && notesCard(hoveredId) ? hoveredId : selectedIds.size === 1 ? [...selectedIds][0] : null;
  openNotes(aimed === null ? {} : { kind: 'card-notes', id: aimed });
}

// Esc with focus outside the palette (a click on its empty space took it) closes it, unless a menu or a
// popup is up: those take the Esc first. In the palette Esc is read by the palette itself.
function onNotesEscape(e) {
  if (e.key !== 'Escape' || !notesUi.sub || notesUi.el.contains(e.target)) return;
  if (document.querySelector('#context-menu:not(.hidden), .modal-backdrop:not(.hidden)')) return;
  e.preventDefault();
  e.stopPropagation();
  notesClose();
}

// A mouse press outside the palette closes it, but not on what opens it.
function onNotesPointer(e) {
  const u = notesUi;
  if (!u.sub || u.el.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.np-trigger, #context-menu, .modal-backdrop, #toast')) return;
  notesClose();
}

// ---------- the board payload ----------

// Called after every board payload has been applied: the palette's list, chip and preview
// follow the file, unless a note is being edited, and a palette on a card that is gone closes.
function notesOnBoard() {
  const u = notesUi;
  if (!u.sub) return;
  if (!notesOn() || ((u.sub.kind === 'card' || u.sub.kind === 'group') && !notesCard(u.sub.id))) { notesClose(); return; }
  if (u.editing > 0) return;
  const row = document.activeElement && document.activeElement.closest && document.activeElement.closest('.np-note');
  const at = row ? notesRows().indexOf(row) : -1;
  notesPaint();
  if (at >= 0) notesFocusRow(at);
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', onNotesKey);
  document.addEventListener('keydown', onNotesEscape, true);
  document.addEventListener('mousedown', onNotesPointer, true);
  document.addEventListener('click', (e) => {
    const count = e.target.closest && e.target.closest('.card-notes');
    if (!count) return;
    e.preventDefault();
    openNotes({ kind: 'card-notes', id: count.dataset.noteTarget });
  });
  $('#ctx-note').addEventListener('click', () => {
    hideContextMenu();
    openNotes({ kind: 'card-notes', id: menuSubject.ids[0] });
  });
});
