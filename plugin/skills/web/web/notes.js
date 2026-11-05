'use strict';
// The rules of the notes palette (docs/adr/0016, GLOSSARY.md "Ids, groups and the
// logbook"), apart from the DOM: how the note box's line is read, what Enter will write
// and the preview line that says so, what the palette is about (its subject: a card, a
// group, a slot of a day, a day's untimed notes, or nothing), how the notes list is
// narrowed, grouped and ordered, how high a note box grows, and which tab Alt+1 to Alt+4 pick. notes-palette.js draws it and talks to the server.
//
// The line. Its first line may begin with a time (`10:30 renamed it`) or with `-` or the
// word `untimed`, then with a length (`45m`, `1h30m`, `1h30`; alone it counts too), or in place of
// both with a range (`10:30-12:00`, a hyphen or an en dash, no spaces: the time and the length
// between the two), then with a mention of a card or group the board has (`#22 mid check`,
// `plan#G3 ...`); each is cut from the text and sets that one note's time, duration or target. A
// mention anywhere else is text: `blocked by #22` is a note about this card. A line that
// is only a mention is bare: Enter aims the palette at it and writes nothing.
//
// What Enter writes (noteWritePlan). The time is the line's, else none when the untimed
// tick or a `-` says so, else the time field's, else now (or none in a day's untimed box).
// The duration is the line's, else the duration field's, none when it is empty (durations.js reads
// it); with a time it makes the note a range from that time, the moment of Enter for Now.
// The target is the line's mention, else the chip's card or group, else the card last
// noted, else nothing. The day is the date field's, else the subject's.
//
// The date and time fields say Today and Now, or a picked or typed value. Today and Now are
// worked out when Enter is pressed, from the clock the caller passes, so a palette left open
// writes the day and time of that moment; a value is used as it is, even when it equals today
// or now. They start as Today and Now unless the request gave a day or a time.
//
// Pure: the caller passes what it knows of the board (which ids are cards or groups), the
// clock and the storage, so Node tests drive it with plain values. Same dual-environment
// export pattern as view-panel.js.

const NOTE_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;
const NOTE_COLUMN_STATE = (typeof module !== 'undefined' && module.exports) ? require('./column-state') : window;
const NOTE_CALENDAR_MODEL = (typeof module !== 'undefined' && module.exports) ? require('./calendar-model') : window;
const NOTE_DURATIONS = (typeof module !== 'undefined' && module.exports) ? require('./durations') : window.kanbanDurations;

// How the palette and the Calendar name a note about nothing.
const NOTE_NO_CARD = 'no card';
const NOTE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_LAST_FEATURE = 'lastnoted';
const NOTE_LAYOUT_FEATURE = 'notes.layout';
const NOTE_LAYOUTS = ['grouped', 'timeline'];
const NOTE_LINE_TIME = /^(\d{1,2})[:.](\d{2})(?=\s|$)\s*/;
const NOTE_LINE_RANGE = /^(\d{1,2})[:.](\d{2})[-–](\d{1,2})[:.](\d{2})(?=\s|$)\s*/;
const NOTE_FIELD_TIME = /^(\d{1,2})[:.]?(\d{2})$/;
const NOTE_TODAY = 'Today';
const NOTE_NOW = 'Now';

// A subject that is a card or a group (the palette writes on it and lists its notes), and one that is
// about cards: those or several cards at once.
const noteIsTarget = (sub) => sub.kind === 'card' || sub.kind === 'group';
const noteIsAboutCards = (sub) => noteIsTarget(sub) || sub.kind === 'each';

const notePad = (n) => String(n).padStart(2, '0');

// The time field's text as HH:MM (`9:30`, `09.30`, `0930`, `930`), null when it is none.
function noteFieldTime(text) {
  const m = NOTE_FIELD_TIME.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${notePad(h)}:${m[2]}` : null;
}

// Whether a field's text is the word Today or Now, in any case.
const noteIsToday = (text) => String(text == null ? '' : text).trim().toLowerCase() === NOTE_TODAY.toLowerCase();
const noteIsNow = (text) => String(text == null ? '' : text).trim().toLowerCase() === NOTE_NOW.toLowerCase();

const noteBadTime = (text) => `${text} is not a time; a time reads HH:MM.`;
const noteBadDay = (text) => `${text} is not a date; a date reads YYYY-MM-DD.`;
const noteBadDuration = (text) => `${text} is not a duration; a duration reads like 45m, 1h or 1h30m.`;
const noteBadRange = (text) => `${text}: the end is not after the start.`;

// The date field's text as YYYY-MM-DD, null when it is none or names a day the calendar lacks.
function noteFieldDay(text) {
  const day = String(text == null ? '' : text).trim();
  if (!NOTE_DAY.test(day)) return null;
  const d = new Date(Date.parse(`${day}T00:00:00Z`));
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day ? null : day;
}

// A range's end as minutes: a time, or 24:00 for the end of the day. NaN is no time.
function noteRangeEnd(h, min) {
  if (h === 24 && min === 0) return 24 * 60;
  return h > 23 || min > 59 ? NaN : h * 60 + min;
}

// The time the note box's line starts with -> { at, duration, untimed, bad, rest, range }: a range's
// start and the length between its ends, a time, or untimed for a leading `-` or `untimed`; `rest` is
// the line after it, and `range` says it was a range.
function noteLineTime(text) {
  let line = text;
  let at = null;
  let duration = null;
  let untimed = false;
  let bad = '';
  const range = NOTE_LINE_RANGE.exec(line);
  const time = range ? null : NOTE_LINE_TIME.exec(line);
  if (range) {
    const start = Number(range[1]) * 60 + Number(range[2]);
    const end = noteRangeEnd(Number(range[3]), Number(range[4]));
    if (Number(range[1]) > 23 || Number(range[2]) > 59) bad = noteBadTime(`${range[1]}:${range[2]}`);
    else if (Number.isNaN(end)) bad = noteBadTime(`${range[3]}:${range[4]}`);
    else if (end <= start) bad = noteBadRange(range[0].trim());
    else {
      at = `${notePad(Number(range[1]))}:${range[2]}`;
      duration = NOTE_DURATIONS.formatDuration(end - start);
    }
    line = line.slice(range[0].length);
  } else if (time) {
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
  return { at, duration, untimed, bad, rest: line, range: !!range };
}

// The note box's text -> { text, at, duration, untimed, mention, bare, bad }. `duration` is a leading
// length or range's, in the written form, or null. `known` is
// { board, isTarget(id) }: the board's name and whether an id is a card or group of it.
function noteParseLine(raw, known) {
  const whole = String(raw == null ? '' : raw).trim();
  const nl = whole.indexOf('\n');
  const more = nl === -1 ? '' : whole.slice(nl);
  const lead = noteLineTime(nl === -1 ? whole : whole.slice(0, nl));
  const { at, untimed } = lead;
  let { duration, bad, rest: line } = lead;
  const length = lead.range ? null : NOTE_DURATIONS.leadingDuration(line);
  if (length) {
    if (length.minutes === null) bad = bad || noteBadDuration(length.text);
    else duration = NOTE_DURATIONS.formatDuration(length.minutes);
    line = length.rest;
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
  return { text, at, duration, untimed, mention, bare: mention !== null && text === '' && at === null && duration === null && !untimed && bad === '', bad };
}

// What the palette is about. `req` is what opened it:
//   { kind: 'card-notes', id } | { kind: 'group', gid } | { kind: 'slot', day, fromMin, toMin }
//   | { kind: 'untimed', day } | { kind: 'scratchpad', target } | { target, day?, at? } | { targets: [id, ...] } | {}
//   (target '' or none: nothing; targets: several cards, one note on each)
// -> { kind: 'none' | 'card' | 'group' | 'each' | 'slot' | 'untimed', id?, ids?, day, at?, ... }
function noteSubjectFrom(req, o) {
  const day = req.day || o.today;
  const clock = req.day ? {} : { clockDay: true };
  if (Array.isArray(req.targets)) {
    const many = [];
    for (const t of req.targets) {
      const id = NOTE_IDS.idKey(t);
      if (id !== null && !many.includes(id)) many.push(id);
    }
    if (many.length > 1) return { kind: 'each', ids: NOTE_IDS.sortIds(many), day, ...clock };
    return noteSubjectFrom(many.length ? { target: many[0], ...(req.day ? { day } : {}) } : req.day ? { day } : {}, o);
  }
  if (req.kind === 'card-notes') return { kind: 'card', id: NOTE_IDS.idKey(req.id), day, ...clock };
  if (req.kind === 'group') return { kind: 'group', id: NOTE_IDS.idKey(req.gid), day, ...clock };
  if (req.kind === 'slot') return { kind: 'slot', day, fromMin: req.fromMin, toMin: req.toMin, at: NOTE_DURATIONS.hhmm(Math.max(0, req.fromMin)), ...clock };
  if (req.kind === 'untimed') return { kind: 'untimed', day, ...clock };
  const id = req.target === undefined || req.target === null || req.target === '' ? null : NOTE_IDS.idKey(req.target);
  if (id !== null) {
    const subject = { kind: o.isGroup(id) ? 'group' : 'card', id, day, ...clock };
    if (req.at) subject.at = req.at;
    return subject;
  }
  if (req.at) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(req.at);
    const from = m ? Number(m[1]) * 60 : 0;
    return { kind: 'slot', day, fromMin: from, toMin: from + 60, at: req.at, ...clock };
  }
  return { kind: 'none', day, ...clock };
}

// What the date and time fields say when a subject opens: Today unless the request gave the day, Now
// unless it gave a time (an hour of the Calendar, a card's `at`), and nothing in a day's untimed box.
const noteDayField = (sub) => (sub.clockDay ? NOTE_TODAY : sub.day);
const noteTimeField = (sub) => (sub.kind === 'untimed' || sub.untimed ? '' : sub.at || NOTE_NOW);

// The tabs the palette shows for a subject, in order: Notes (when the board keeps a logbook), a
// group's own Group tab, the Scratchpad of a card or group (when the board keeps scratchpads) and its
// Todos (when the board keeps todo lists). A card with the logbook off still has those, so it opens on
// them alone.
function noteTabs(sub, o) {
  const target = !!sub && noteIsTarget(sub);
  if (!target) return ['notes'];
  const tabs = [];
  if (o.notesOn || (sub.kind === 'card' && !o.scratchpadOn && !o.todosOn)) tabs.push('notes');
  if (sub.kind === 'group') tabs.push('group');
  if (o.scratchpadOn) tabs.push('scratch');
  if (o.todosOn) tabs.push('todos');
  return tabs;
}

// A bare mention re-aims the palette at a card or group. From a slot or a day's untimed
// box it keeps that moment (`when`), so clearing the chip steps back to it.
function noteSubjectAimed(was, id, kind = 'card') {
  const moment = was.kind === 'slot' || was.kind === 'untimed' ? was : was.when || null;
  if (!moment) return { kind, id, day: was.day, ...noteClockDay(was) };
  const aimed = { kind, id, day: was.day, ...noteClockDay(was), when: moment };
  if (was.at) aimed.at = was.at;
  if (moment.kind === 'untimed') aimed.untimed = true;
  return aimed;
}

// A note about nothing, chosen from the card picker: a note's target is empty, whatever card was last
// noted. From an hour or the untimed box (or a card aimed at from one) it keeps that moment.
function noteSubjectNoCard(was) {
  const moment = was.kind === 'slot' || was.kind === 'untimed' ? was : was.when || null;
  const base = moment || { kind: 'none', day: was.day, ...noteClockDay(was) };
  const { when, ...rest } = base;
  return { ...rest, noCard: true };
}

// What the picker shows as the note's target: { id } (a card or group; '' is no card) or { each: how
// many cards }. For a palette aimed at nothing it is the card Enter would write on, the last noted.
function noteSubjectTarget(sub, lastNoted) {
  if (sub.kind === 'each') return { each: sub.ids.length };
  if (noteIsTarget(sub)) return { id: sub.id };
  if (sub.noCard) return { id: '' };
  return { id: lastNoted || '' };
}

// Clearing the chip ends where choosing no card ends: the moment stays, the card goes, and a note is
// about nothing, not the card last noted.
function noteSubjectCleared(subject, today) {
  if (!subject.when) return { kind: 'none', day: today, clockDay: true, noCard: true };
  const { noCard, ...moment } = subject.when;
  return { ...moment, noCard: true };
}

// A subject whose day came from the clock and not from the request carries clockDay: its day is
// whatever day it is when the palette writes or repaints, never the day it was opened on.
const noteClockDay = (sub) => (sub.clockDay ? { clockDay: true } : {});

// The subject on a new today: a clock day moves to it (and so does the moment a card was aimed at
// from), a day the request gave stays. The same subject back when nothing moves.
function noteSubjectOnDay(sub, today) {
  const when = sub.when && sub.when.clockDay && sub.when.day !== today ? { ...sub.when, day: today } : sub.when;
  if (!(sub.clockDay && sub.day !== today) && when === sub.when) return sub;
  return { ...sub, ...(sub.clockDay ? { day: today } : {}), ...(when ? { when } : {}) };
}

// The notes a subject lists. `members(id)` gives the ids of a group's cards (a group's
// list holds its members' notes too); none for a card. A slot lists the notes that start in it and
// the ranges that run across any of it.
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
      if (!n.at || !/^\d{2}:\d{2}$/.test(n.at)) return false;
      const min = NOTE_DURATIONS.minutesOf(n.at);
      const length = n.duration ? NOTE_DURATIONS.parseDuration(n.duration) : null;
      return min < subject.toMin && (length === null ? min >= subject.fromMin : min + length > subject.fromMin);
    });
  }
  if (subject.kind === 'untimed') return today.filter((n) => !n.at);
  return today;
}

// What Enter will write: { text, at, duration, day, target, targets, from, bad, scopeTo }. `parsed` is
// noteParseLine's, `field` the date, time and duration fields { value, untimed, day, duration }, `o`
// { today, now, lastNoted }. The duration is in the written form (`1h30m`), or null. The day is the
// date field's, else the subject's. `from` says where the target came
// from: 'line', 'chip', 'each', 'nocard' (chosen in the picker) or 'last'. On several cards
// (the subject 'each') `targets` lists them, one note is written on each and `target` is
// empty, unless the line names one card, which takes that one note alone.
function noteWritePlan(parsed, subject, field, o) {
  const time = noteWriteTime(parsed, subject, field, o);
  const at = time.at;
  let bad = parsed.bad || time.bad;
  const { duration, bad: lengthBad } = noteCheckLength(parsed.duration || field.duration, at);
  bad = bad || lengthBad;
  let day = subject.clockDay ? o.today : subject.day || o.today;
  const dayText = String(field.day == null ? '' : field.day).trim();
  if (noteIsToday(dayText)) day = o.today;
  else if (dayText !== '') {
    const picked = noteFieldDay(dayText);
    if (picked === null) bad = bad || noteBadDay(dayText);
    else day = picked;
  }
  let target;
  let targets = null;
  let from;
  if (parsed.mention !== null) { target = parsed.mention; from = 'line'; }
  else if (noteIsTarget(subject)) { target = subject.id; from = 'chip'; }
  else if (subject.kind === 'each') { target = ''; targets = subject.ids; from = 'each'; }
  else if (subject.noCard) { target = ''; from = 'nocard'; }
  else { target = o.lastNoted || ''; from = 'last'; }
  return { text: parsed.text, at, duration, day, target, targets, from, bad, scopeTo: parsed.bare ? parsed.mention : null };
}

// The time Enter will write (HH:MM, null for none) -> { at, bad }: the line's (`lead`, noteLineTime's
// or noteParseLine's { at, untimed }), else none when the untimed tick or a `-` says so, else the time
// field's (`field` { value, untimed }), else now (`o.now`), or none in a day's untimed box.
function noteWriteTime(lead, subject, field, o) {
  const value = String(field.value == null ? '' : field.value).trim();
  if (lead.at) return { at: lead.at, bad: '' };
  if (lead.untimed || field.untimed) return { at: null, bad: '' };
  if (noteIsNow(value)) return { at: o.now, bad: '' };
  if (value === '') return { at: subject.kind === 'untimed' || subject.untimed ? null : subject.at || o.now, bad: '' };
  const at = noteFieldTime(value);
  return { at, bad: at === null ? noteBadTime(value) : '' };
}

// The duration field's menu: 15m to 4h in 15-minute steps, and from a time (HH:MM; null for none)
// only the lengths that end by midnight, so it never offers a range the board would refuse.
function noteDurationOptions(at) {
  const out = [];
  for (let min = 15; min <= 4 * 60; min += 15) if (!NOTE_DURATIONS.durationProblem(min, at)) out.push(NOTE_DURATIONS.formatDuration(min));
  return out;
}

// A note's time where a list shows it: its range (`10:30–11:15`), its length when it has a duration
// and no time (`45m`), its time, or untimed.
function noteTimeLabel(note) {
  const length = note.duration ? NOTE_DURATIONS.parseDuration(note.duration) : null;
  if (length === null) return note.at || 'untimed';
  return note.at ? NOTE_DURATIONS.durationRange(note.at, length) : note.duration;
}

// A length typed in a field or the line, held to the rules with the time it goes with (HH:MM, null for
// none): { duration, bad }, `duration` in the written form or null for nothing typed, `bad` what it
// breaks ('' for nothing).
function noteCheckLength(text, at) {
  const typed = String(text == null ? '' : text).trim();
  if (typed === '') return { duration: null, bad: '' };
  const minutes = NOTE_DURATIONS.parseDuration(typed);
  const bad = minutes === null ? noteBadDuration(typed) : NOTE_DURATIONS.durationProblem(minutes, at);
  return bad ? { duration: null, bad } : { duration: NOTE_DURATIONS.formatDuration(minutes), bad: '' };
}

// The edit row's duration field read against the time the row will save (HH:MM, null for none) and
// the duration the note has (written form, null for none): { duration, change, bad }. `change` says
// the save sends it: an empty field sends none for a note without one, and null (removed) for a note with one.
function noteEditDuration(text, at, was) {
  const { duration, bad } = noteCheckLength(text, at);
  if (bad) return { duration: null, change: false, bad };
  return { duration, change: duration !== (was || null), bad: '' };
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
  const length = plan.duration ? NOTE_DURATIONS.parseDuration(plan.duration) : null;
  const timed = plan.at && length !== null ? `Note ${NOTE_DURATIONS.durationRange(plan.at, length)}` : plan.at ? `Note at ${plan.at}` : null;
  const when = timed || (length !== null ? `Note ${plan.duration} untimed` : 'Untimed note');
  const dayBit = plan.day !== o.today ? `, ${o.dayName(plan.day)},` : '';
  const last = plan.from === 'last' && plan.target ? ' (last noted)' : '';
  const on = plan.targets ? noteEachLabel(plan.targets) : `${o.label(plan.target)}${last}`;
  return `${when}${dayBit} on ${on}${plan.text ? '' : ' · type the note'}`;
}

// ---------- the range ----------
// The list shows the notes of a date range: All, a Month, a Week (from Monday, as the Calendar's), 3 days
// (the anchor and the next two) or a Day, around an anchor day. The names are the Calendar's own
// sub-views (calendar-model.js), so a range and a Calendar view are one thing to step and to read.

const NOTE_RANGE_MODES = ['all', 'month', 'week', '3day', 'day'];
const NOTE_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The first and last day of a range, both in it; null for All.
function noteRangeBounds(mode, anchor) {
  if (mode === 'month') {
    const next = NOTE_CALENDAR_MODEL.shiftAnchorDay('month', anchor, 1);
    return { from: `${anchor.slice(0, 7)}-01`, to: NOTE_CALENDAR_MODEL.addDays(next, -1) };
  }
  const days = NOTE_CALENDAR_MODEL.calendarSubviewDays(mode, anchor);
  return days ? { from: days[0], to: days[days.length - 1] } : null;
}

// The anchor one unit on (dir 1) or back (dir -1); All has nowhere to step.
function noteRangeStep(mode, anchor, dir) {
  return mode === 'all' ? anchor : NOTE_CALENDAR_MODEL.shiftAnchorDay(mode, anchor, dir);
}

function noteRangeLabel(mode, anchor) {
  if (mode === 'all') return 'All dates';
  if (mode === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    return NOTE_CALENDAR_MODEL.monthTitle(y, m - 1);
  }
  const { from, to } = noteRangeBounds(mode, anchor);
  const part = (day) => { const [y, m, d] = day.split('-').map(Number); return { y, m: NOTE_MONTHS_SHORT[m - 1], d }; };
  const a = part(from);
  const b = part(to);
  if (mode === 'day') return `${noteDayName(from)} ${a.m}`;
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
  return a.m === b.m ? `${a.d}–${b.d} ${a.m}` : `${a.d} ${a.m} – ${b.d} ${b.m}`;
}

// What the range opens on each time the palette opens (nothing is remembered): a card, a group or
// several cards open on All, so their history stays; an hour or the untimed box on that Day; nothing
// aimed at on what `req.range` asks for (the Calendar's own mode and range, or a day under the
// pointer), else Day, today. `sub` is the subject (noteSubjectFrom), `req` what opened the palette.
function noteRangeFor(sub, req, today) {
  const clock = sub.clockDay ? { clock: true } : {};
  if (noteIsAboutCards(sub)) return { mode: 'all', anchor: sub.day || today, ...clock };
  if (sub.kind === 'slot' || sub.kind === 'untimed') return { mode: 'day', anchor: sub.day, ...clock };
  const asked = req && req.range;
  if (asked && NOTE_RANGE_MODES.includes(asked.mode) && NOTE_DAY.test(asked.anchor || '')) return { mode: asked.mode, anchor: asked.anchor };
  return { mode: 'day', anchor: sub.day || today, ...clock };
}

// A range that opened on the clock (`clock`) moves to the new today; one the request gave, or the
// person stepped, stays.
function noteRangeOnDay(range, today) {
  return range.clock && range.anchor !== today ? { ...range, anchor: today } : range;
}

// The notes in a range (those of any day for no bounds).
function noteInRange(notes, bounds) {
  return bounds ? notes.filter((n) => n.day >= bounds.from && n.day <= bounds.to) : notes;
}

// The notes the list shows before the filter: the subject's, in the range. A card's, a group's and
// several cards' notes are theirs whatever the range; nothing aimed at lists the board's. An hour or the
// untimed box lists only itself while the range is as it opened, `range.touched` false, and the rest
// of the range once it has been changed. `range` is { mode, anchor, touched }.
function noteListNotes(notes, subject, range, o = {}) {
  const own = noteIsAboutCards(subject) || ((subject.kind === 'slot' || subject.kind === 'untimed') && !range.touched)
    ? noteSubjectNotes(notes, subject, o)
    : notes;
  return noteInRange(own, noteRangeBounds(range.mode, range.anchor));
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

// Whether every listed note is about the one card (or group, or nothing): the Timeline then leaves its card column out.
function noteOneTarget(notes) {
  return notes.length > 0 && notes.every((n) => n.target === notes[0].target);
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

// Alt+1 to Alt+4 pick the palette's first to fourth tab. The digit is read by its key, else by its
// place on the keyboard (Alt changes the character some layouts type). -> 0, 1, 2, 3 or -1.
const NOTE_TAB_KEYS = ['1', '2', '3', '4'];
const NOTE_TAB_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

function noteTabKey(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return -1;
  const byKey = NOTE_TAB_KEYS.indexOf(e.key);
  return byKey !== -1 ? byKey : NOTE_TAB_CODES.indexOf(e.code);
}

const NOTE_BOX_LINES = 12;

// The size of a note box that grows with its text (the palette's note box and the one a listed note
// is edited in). `m` is { content: the height all the text needs, line, chrome: the box's padding and
// border, windowHeight, lines?, share? }. -> { height, scroll }: as high as the text, from one line up to 12 lines
// or 40% of the window, whichever is less (`lines` and `share`, when the palette has more room); past that it
// scrolls inside.
function noteBoxSize(m) {
  const cap = Math.min((m.lines || NOTE_BOX_LINES) * m.line + m.chrome, m.windowHeight * (m.share || 0.4));
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
  return { day: note.day, target: note.target, index: note.index, file: note.file, expect: { at: note.at, duration: note.duration || null, by: note.by, note: note.note } };
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
  const saved = NOTE_COLUMN_STATE.boardPrefLoad(storage, projectName, NOTE_LAST_FEATURE);
  return saved !== null && NOTE_IDS.idKey(saved) !== null ? NOTE_IDS.idKey(saved) : '';
}

function noteLastSave(storage, projectName, id) {
  if (NOTE_IDS.idKey(id) !== null) NOTE_COLUMN_STATE.boardPrefSave(storage, projectName, NOTE_LAST_FEATURE, NOTE_IDS.idKey(id));
}

// The list's layout, Grouped or Timeline, kept in this browser per board; anything else is Grouped.
function noteLayoutLoad(storage, projectName) {
  const saved = NOTE_COLUMN_STATE.boardPrefLoad(storage, projectName, NOTE_LAYOUT_FEATURE);
  return NOTE_LAYOUTS.includes(saved) ? saved : 'grouped';
}

function noteLayoutSave(storage, projectName, layout) {
  if (NOTE_LAYOUTS.includes(layout)) NOTE_COLUMN_STATE.boardPrefSave(storage, projectName, NOTE_LAYOUT_FEATURE, layout);
}

const NOTES_EXPORTS = {
  NOTE_NO_CARD, noteIsTarget, noteIsAboutCards,
  NOTE_TODAY, NOTE_NOW, noteIsToday, noteIsNow, noteDayField, noteTimeField,
  noteFieldTime, noteFieldDay, noteParseLine, noteSubjectFrom, noteTabs, noteSubjectAimed, noteSubjectNoCard, noteSubjectTarget, noteSubjectCleared, noteSubjectOnDay, noteSubjectNotes,
  NOTE_RANGE_MODES, noteRangeBounds, noteRangeStep, noteRangeLabel, noteRangeFor, noteRangeOnDay, noteInRange, noteListNotes,
  noteLineTime, noteWriteTime, noteWritePlan, notePreview, noteDurationOptions, noteEditDuration, noteTimeLabel, noteAuthorKind, noteParseFilter, noteFilter, noteGroups, noteTimeline, noteOneTarget, noteBoxSize, noteTabKey, noteCounts, noteRef, noteClock, noteDayName, noteLastLoad, noteLastSave, noteLayoutLoad, noteLayoutSave,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NOTES_EXPORTS;
} else {
  Object.assign(window, NOTES_EXPORTS);
}
