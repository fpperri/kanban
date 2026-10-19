'use strict';
// The rules of the notes palette (docs/adr/0016, GLOSSARY.md "Ids, groups and the
// logbook"), apart from the DOM: how the note box's line is read, what Enter will write
// and the preview line that says so, what the palette is about (its subject: a card, a
// group, a slot of a day, a day's untimed notes, or nothing), and how the notes list is
// narrowed, grouped and ordered. notes-palette.js draws it and talks to the server.
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
//   | { kind: 'untimed', day } | { target, day?, at? } | {}   (target '' or none: nothing)
// -> { kind: 'none' | 'card' | 'group' | 'slot' | 'untimed', id?, day, at?, ... }
function noteSubjectFrom(req, o) {
  const day = req.day || o.today;
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

// What Enter will write: { text, at, day, target, from, bad, scopeTo }. `parsed` is
// noteParseLine's, `field` the time field { value, untimed }, `o` { today, now, lastNoted }.
// `from` says where the target came from: 'line', 'chip' or 'last'.
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
  let from;
  if (parsed.mention !== null) { target = parsed.mention; from = 'line'; }
  else if (subject.kind === 'card' || subject.kind === 'group') { target = subject.id; from = 'chip'; }
  else { target = o.lastNoted || ''; from = 'last'; }
  return { text: parsed.text, at, day: subject.day || o.today, target, from, bad, scopeTo: parsed.bare ? parsed.mention : null };
}

// The preview line: exactly what Enter will do. `o` { label(id) -> the card or group as
// the chip reads it ('' -> no card), dayName(day), today }.
function notePreview(plan, o) {
  if (plan.bad) return plan.bad;
  if (plan.scopeTo !== null) return `Open ${o.label(plan.scopeTo)}, then type the note`;
  const when = plan.at ? `Note at ${plan.at}` : 'Untimed note';
  const dayBit = plan.day !== o.today ? `, ${o.dayName(plan.day)},` : '';
  const last = plan.from === 'last' && plan.target ? ' (last noted)' : '';
  return `${when}${dayBit} on ${o.label(plan.target)}${last}${plan.text ? '' : ' · type the note'}`;
}

// The notes, narrowed by the filter field: every word in the note's text or in the label
// of the card or group it is about.
function noteFilter(notes, text, label) {
  const words = String(text == null ? '' : text).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return notes;
  return notes.filter((n) => {
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

const NOTES_EXPORTS = {
  noteFieldTime, noteParseLine, noteSubjectFrom, noteSubjectAimed, noteSubjectCleared, noteSubjectNotes,
  noteWritePlan, notePreview, noteFilter, noteGroups, noteCounts, noteRef, noteClock, noteDayName, noteLastLoad, noteLastSave,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NOTES_EXPORTS;
} else {
  Object.assign(window, NOTES_EXPORTS);
}
