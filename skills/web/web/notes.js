'use strict';
// The rules of the notes palette (docs/adr/0016, GLOSSARY.md "Ids, groups and the
// logbook"), apart from the DOM: how the note box's line is read, what Enter will write
// and the preview line that says so, what the palette is about (its subject: a card, a
// group, a slot of a day, a day's untimed notes, or nothing), how the notes list is
// narrowed, grouped and ordered, how high a note box grows, and which tab Alt+1 to Alt+3 pick. notes-palette.js draws it and talks to the server.
//
// The line. Its first line may begin with a time (`10:30 renamed it`) or with `-` or the
// word `untimed`, then with a mention of a card or group the board has (`#22 mid check`,
// `plan#G3 ...`); each is cut from the text and sets that one note's time or target. A
// mention anywhere else is text: `blocked by #22` is a note about this card. A line that
// is only a mention is bare: Enter aims the palette at it and writes nothing.
//
// What Enter writes (noteWritePlan). The time is the line's, else none when the untimed
// tick or a `-` says so, else the time field's, else now (or none in a day's untimed box).
// The target is the line's mention, else the chip's card or group, else the card last
// noted, else nothing. The day is the subject's.
//
// Pure: the caller passes what it knows of the board (which ids are cards or groups), the
// clock and the storage, so Node tests drive it with plain values. Same dual-environment
// export pattern as view-panel.js.

const NOTE_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;
const NOTE_COLUMN_STATE = (typeof module !== 'undefined' && module.exports) ? require('./column-state') : window;

const NOTE_LAST_FEATURE = 'lastnoted';
const NOTE_LAYOUT_FEATURE = 'notes.layout';
const NOTE_LAYOUTS = ['grouped', 'timeline'];
const NOTE_LINE_TIME = /^(\d{1,2})[:.](\d{2})(?=\s|$)\s*/;
const NOTE_FIELD_TIME = /^(\d{1,2})[:.]?(\d{2})$/;

const notePad = (n) => String(n).padStart(2, '0');

function noteHhmm(min) {
  return `${notePad(Math.floor(min / 60))}:${notePad(min % 60)}`;
}

// The time field's text as HH:MM (`9:30`, `09.30`, `0930`, `930`), null when it is none.
function noteFieldTime(text) {
  const m = NOTE_FIELD_TIME.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${notePad(h)}:${m[2]}` : null;
}

const noteBadTime = (text) => `${text} is not a time; a time reads HH:MM.`;

// The note box's text -> { text, at, untimed, mention, bare, bad }. `known` is
// { board, isTarget(id) }: the board's name and whether an id is a card or group of it.
function noteParseLine(raw, known) {
  const whole = String(raw == null ? '' : raw).trim();
  const nl = whole.indexOf('\n');
  let line = nl === -1 ? whole : whole.slice(0, nl);
  const more = nl === -1 ? '' : whole.slice(nl);
  let at = null;
  let untimed = false;
  let bad = '';
  const time = NOTE_LINE_TIME.exec(line);
  if (time) {
    const h = Number(time[1]);
    const min = Number(time[2]);
    if (h > 23 || min > 59) bad = noteBadTime(`${time[1]}:${time[2]}`);
    else at = `${notePad(h)}:${time[2]}`;
    line = line.slice(time[0].length);
  } else if (/^-(\s|$)/.test(line)) {
    untimed = true;
    line = line.replace(/^-\s*/, '');
  } else if (/^untimed(\s|$)/i.test(line)) {
    untimed = true;
    line = line.replace(/^untimed\s*/i, '');
  }
  let mention = null;
  const first = NOTE_IDS.findMentions(line).find((m) => m.start === 0);
  if (first && (first.board === null || first.board === known.board)) {
    const id = NOTE_IDS.idKey(`${first.prefix}${first.number}`);
    if (id !== null && known.isTarget(id)) {
      mention = id;
      line = line.slice(first.end).replace(/^[:,;]?\s*/, '');
    }
  }
  const text = (line + more).trim();
  return { text, at, untimed, mention, bare: mention !== null && text === '' && at === null && !untimed && bad === '', bad };
}

// What the palette is about. `req` is what opened it:
//   { kind: 'card-notes', id } | { kind: 'group', gid } | { kind: 'slot', day, fromMin, toMin }
//   | { kind: 'untimed', day } | { kind: 'scratchpad', target } | { target, day?, at? } | { targets: [id, ...] } | {}
//   (target '' or none: nothing; targets: several cards, one note on each)
// -> { kind: 'none' | 'card' | 'group' | 'each' | 'slot' | 'untimed', id?, ids?, day, at?, ... }
function noteSubjectFrom(req, o) {
  const day = req.day || o.today;
  if (Array.isArray(req.targets)) {
    const many = [];
    for (const t of req.targets) {
      const id = NOTE_IDS.idKey(t);
      if (id !== null && !many.includes(id)) many.push(id);
    }
    if (many.length > 1) return { kind: 'each', ids: NOTE_IDS.sortIds(many), day };
    return noteSubjectFrom(many.length ? { target: many[0], day } : { day }, o);
  }
  if (req.kind === 'card-notes') return { kind: 'card', id: NOTE_IDS.idKey(req.id), day };
  if (req.kind === 'group') return { kind: 'group', id: NOTE_IDS.idKey(req.gid), day };
  if (req.kind === 'slot') return { kind: 'slot', day, fromMin: req.fromMin, toMin: req.toMin, at: noteHhmm(Math.max(0, req.fromMin)) };
  if (req.kind === 'untimed') return { kind: 'untimed', day };
  const id = req.target === undefined || req.target === null || req.target === '' ? null : NOTE_IDS.idKey(req.target);
  if (id !== null) {
    const subject = { kind: o.isGroup(id) ? 'group' : 'card', id, day };
    if (req.at) subject.at = req.at;
    return subject;
  }
  if (req.at) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(req.at);
    const from = m ? Number(m[1]) * 60 : 0;
    return { kind: 'slot', day, fromMin: from, toMin: from + 60, at: req.at };
  }
  return { kind: 'none', day };
}

// The tabs the palette shows for a subject, in order: Notes (when the board keeps a logbook), a
// group's own Group tab, and the Scratchpad of a card or group (when the board keeps scratchpads).
// A card with the logbook off still has its Scratchpad, so it opens on that alone.
function noteTabs(sub, o) {
  const target = !!sub && (sub.kind === 'card' || sub.kind === 'group');
  if (!target) return ['notes'];
  const tabs = [];
  if (o.notesOn || (sub.kind === 'card' && !o.scratchpadOn)) tabs.push('notes');
  if (sub.kind === 'group') tabs.push('group');
  if (o.scratchpadOn) tabs.push('scratch');
  return tabs;
}

// A bare mention re-aims the palette at a card or group. From a slot or a day's untimed
// box it keeps that moment (`when`), so clearing the chip steps back to it.
function noteSubjectAimed(was, id, kind = 'card') {
  const moment = was.kind === 'slot' || was.kind === 'untimed' ? was : was.when || null;
  if (!moment) return { kind, id, day: was.day };
  const aimed = { kind, id, day: was.day, when: moment };
  if (was.at) aimed.at = was.at;
  if (moment.kind === 'untimed') aimed.untimed = true;
  return aimed;
}

function noteSubjectCleared(subject, today) {
  return subject.when ? subject.when : { kind: 'none', day: today };
}

// The notes a subject lists. `members(id)` gives the ids of a group's cards (a group's
// list holds its members' notes too); none for a card.
function noteSubjectNotes(notes, subject, o = {}) {
  if (subject.kind === 'card') return notes.filter((n) => n.target === subject.id);
  if (subject.kind === 'each') return notes.filter((n) => subject.ids.includes(n.target));
  if (subject.kind === 'group') {
    const own = new Set([subject.id, ...((o.members && o.members(subject.id)) || [])]);
    return notes.filter((n) => own.has(n.target));
  }
  const today = notes.filter((n) => n.day === subject.day);
  if (subject.kind === 'slot') {
    return today.filter((n) => {
      const m = n.at && /^(\d{2}):(\d{2})$/.exec(n.at);
      if (!m) return false;
      const min = Number(m[1]) * 60 + Number(m[2]);
      return min >= subject.fromMin && min < subject.toMin;
    });
  }
  if (subject.kind === 'untimed') return today.filter((n) => !n.at);
  return today;
}

// What Enter will write: { text, at, day, target, targets, from, bad, scopeTo }. `parsed` is
// noteParseLine's, `field` the time field { value, untimed }, `o` { today, now, lastNoted }.
// `from` says where the target came from: 'line', 'chip', 'each' or 'last'. On several cards
// (the subject 'each') `targets` lists them, one note is written on each and `target` is
// empty, unless the line names one card, which takes that one note alone.
function noteWritePlan(parsed, subject, field, o) {
  let at = null;
  let bad = parsed.bad;
  const value = String(field.value == null ? '' : field.value).trim();
  if (parsed.at) at = parsed.at;
  else if (parsed.untimed || field.untimed) at = null;
  else if (value === '') at = subject.kind === 'untimed' || subject.untimed ? null : subject.at || o.now;
  else {
    at = noteFieldTime(value);
    if (at === null) bad = bad || noteBadTime(value);
  }
  let target;
  let targets = null;
  let from;
  if (parsed.mention !== null) { target = parsed.mention; from = 'line'; }
  else if (subject.kind === 'card' || subject.kind === 'group') { target = subject.id; from = 'chip'; }
  else if (subject.kind === 'each') { target = ''; targets = subject.ids; from = 'each'; }
  else { target = o.lastNoted || ''; from = 'last'; }
  return { text: parsed.text, at, day: subject.day || o.today, target, targets, from, bad, scopeTo: parsed.bare ? parsed.mention : null };
}

// Several cards as the preview names them: how many, then the first six.
function noteEachLabel(ids) {
  const shown = ids.slice(0, 6).map((id) => `#${id}`).join(', ');
  return `each of ${ids.length} cards (${shown}${ids.length > 6 ? ', …' : ''})`;
}

// The preview line: exactly what Enter will do. `o` { label(id) -> the card or group as
// the chip reads it ('' -> no card), dayName(day), today }.
function notePreview(plan, o) {
  if (plan.bad) return plan.bad;
  if (plan.scopeTo !== null) return `Open ${o.label(plan.scopeTo)}, then type the note`;
  const when = plan.at ? `Note at ${plan.at}` : 'Untimed note';
  const dayBit = plan.day !== o.today ? `, ${o.dayName(plan.day)},` : '';
  const last = plan.from === 'last' && plan.target ? ' (last noted)' : '';
  const on = plan.targets ? noteEachLabel(plan.targets) : `${o.label(plan.target)}${last}`;
  return `${when}${dayBit} on ${on}${plan.text ? '' : ' · type the note'}`;
}

const noteHandleKey = (by) => String(by == null ? '' : by).trim().replace(/^@/, '').toLowerCase();

// Whether a note's author is 'human' or 'ai': a note with no author (written by hand in a day
// file) and a handle the registry marks kind human are human; any other kind, and a handle
// the registry does not list, is AI. `assignees` is the board's registry ([{ handle, kind }]).
function noteAuthorKind(by, assignees) {
  const key = noteHandleKey(by);
  if (key === '') return 'human';
  const entry = (assignees || []).find((a) => noteHandleKey(a.handle) === key);
  return entry && entry.kind === 'human' ? 'human' : 'ai';
}

// The filter field's text -> { words, by }: `by:@handle` words name an author (several: any
// of them), the rest are search words. A `by:` with no handle yet is nothing.
function noteParseFilter(text) {
  const words = [];
  const by = [];
  for (const w of String(text == null ? '' : text).toLowerCase().split(/\s+/).filter(Boolean)) {
    if (!w.startsWith('by:')) { words.push(w); continue; }
    const handle = noteHandleKey(w.slice(3));
    if (handle) by.push(handle);
  }
  return { words, by };
}

// The notes, narrowed by the filter field: every word in the note's text or in the label
// of the card or group it is about, and its `by:@handle` words and the author switch
// `o.by` ('all', 'human' or 'ai'; read against the registry `o.assignees`).
function noteFilter(notes, text, label, o = {}) {
  const { words, by } = noteParseFilter(text);
  const kind = o.by === 'human' || o.by === 'ai' ? o.by : null;
  if (!words.length && !by.length && !kind) return notes;
  return notes.filter((n) => {
    if (kind && noteAuthorKind(n.by, o.assignees) !== kind) return false;
    if (by.length && !by.includes(noteHandleKey(n.by))) return false;
    const hay = `${n.note} ${label(n.target)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// The list's sections: one per day and target, newest day first; within a day the target
// the palette is on first, then by id, nothing last; within a section by time, untimed last.
function noteGroups(notes, o = {}) {
  const sections = new Map();
  for (const n of notes) {
    const key = `${n.day}|${n.target}`;
    if (!sections.has(key)) sections.set(key, { day: n.day, target: n.target, notes: [] });
    sections.get(key).notes.push(n);
  }
  const rank = (t) => (t === o.first ? 0 : t === '' ? 2 : 1);
  const list = [...sections.values()].sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? 1 : -1)
    || rank(a.target) - rank(b.target)
    || (a.target === b.target ? 0 : NOTE_IDS.compareIds(a.target, b.target)));
  for (const s of list) {
    s.notes.sort((a, b) => (a.at || '99:99') < (b.at || '99:99') ? -1 : (a.at || '99:99') > (b.at || '99:99') ? 1 : a.index - b.index);
  }
  return list;
}

// The same notes as one flat list per day, for the palette's Timeline switch: newest day first, and
// within a day the timed notes in time order, then the untimed ones. Two notes at one time go the way
// noteGroups orders their targets: the one the palette is on first, then by id, nothing last.
function noteTimeline(notes, o = {}) {
  const days = new Map();
  for (const n of notes) {
    if (!days.has(n.day)) days.set(n.day, { day: n.day, notes: [] });
    days.get(n.day).notes.push(n);
  }
  const rank = (t) => (t === o.first ? 0 : t === '' ? 2 : 1);
  const when = (n) => n.at || '99:99';
  const list = [...days.values()].sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? 1 : -1));
  for (const d of list) {
    d.notes.sort((a, b) => (when(a) < when(b) ? -1 : when(a) > when(b) ? 1 : 0)
      || rank(a.target) - rank(b.target)
      || (a.target === b.target ? 0 : NOTE_IDS.compareIds(a.target, b.target))
      || a.index - b.index);
  }
  return list;
}

// Alt+1, Alt+2 and Alt+3 pick the palette's first, second and third tab. The digit is read by its key,
// else by its place on the keyboard (Alt changes the character some layouts type). -> 0, 1, 2 or -1.
const NOTE_TAB_KEYS = ['1', '2', '3'];
const NOTE_TAB_CODES = ['Digit1', 'Digit2', 'Digit3'];

function noteTabKey(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return -1;
  const byKey = NOTE_TAB_KEYS.indexOf(e.key);
  return byKey !== -1 ? byKey : NOTE_TAB_CODES.indexOf(e.code);
}

const NOTE_BOX_LINES = 12;

// The size of a note box that grows with its text (the palette's note box and the one a listed note
// is edited in). `m` is { content: the height all the text needs, line, chrome: the box's padding and
// border, windowHeight }. -> { height, scroll }: as high as the text, from one line up to 12 lines or
// 40% of the window, whichever is less; past that it scrolls inside.
function noteBoxSize(m) {
  const cap = Math.min(NOTE_BOX_LINES * m.line + m.chrome, m.windowHeight * 0.4);
  const want = Math.ceil(Math.max(m.content, m.line + m.chrome));
  return { height: Math.min(want, Math.floor(cap)), scroll: want > cap };
}

function noteCounts(notes) {
  const counts = new Map();
  for (const n of notes) counts.set(n.target, (counts.get(n.target) || 0) + 1);
  return counts;
}

// What the server needs to find a note again: where it was and what it read, so a note
// that moved because the file changed is still the one meant.
function noteRef(note) {
  return { day: note.day, target: note.target, index: note.index, file: note.file, expect: { at: note.at, by: note.by, note: note.note } };
}

function noteClock(date) {
  return `${notePad(date.getHours())}:${notePad(date.getMinutes())}`;
}

function noteDayName(day) {
  const d = new Date(Date.parse(`${day}T00:00:00Z`));
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()}`;
}

// The card last noted, kept in this browser per board: only what reads as an id.
function noteLastLoad(storage, projectName) {
  let saved = null;
  try { saved = storage.getItem(NOTE_COLUMN_STATE.storageKey(projectName, NOTE_LAST_FEATURE)); }
  catch (e) { saved = null; }
  return typeof saved === 'string' && NOTE_IDS.idKey(saved) !== null ? NOTE_IDS.idKey(saved) : '';
}

function noteLastSave(storage, projectName, id) {
  if (NOTE_IDS.idKey(id) === null) return;
  try { storage.setItem(NOTE_COLUMN_STATE.storageKey(projectName, NOTE_LAST_FEATURE), NOTE_IDS.idKey(id)); }
  catch (e) { /* storage unavailable/full: it just won't persist this session */ }
}

// The list's layout, Grouped or Timeline, kept in this browser per board; anything else is Grouped.
function noteLayoutLoad(storage, projectName) {
  let saved = null;
  try { saved = storage.getItem(NOTE_COLUMN_STATE.storageKey(projectName, NOTE_LAYOUT_FEATURE)); }
  catch (e) { saved = null; }
  return NOTE_LAYOUTS.includes(saved) ? saved : 'grouped';
}

function noteLayoutSave(storage, projectName, layout) {
  if (!NOTE_LAYOUTS.includes(layout)) return;
  try { storage.setItem(NOTE_COLUMN_STATE.storageKey(projectName, NOTE_LAYOUT_FEATURE), layout); }
  catch (e) { /* storage unavailable/full: it just won't persist this session */ }
}

const NOTES_EXPORTS = {
  noteFieldTime, noteParseLine, noteSubjectFrom, noteTabs, noteSubjectAimed, noteSubjectCleared, noteSubjectNotes,
  noteWritePlan, notePreview, noteAuthorKind, noteParseFilter, noteFilter, noteGroups, noteTimeline, noteBoxSize, noteTabKey, noteCounts, noteRef, noteClock, noteDayName, noteLastLoad, noteLastSave, noteLayoutLoad, noteLayoutSave,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NOTES_EXPORTS;
} else {
  Object.assign(window, NOTES_EXPORTS);
}
