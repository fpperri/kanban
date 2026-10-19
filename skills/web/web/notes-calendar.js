'use strict';
// What the Calendar draws of the logbook (docs/adr/0016, GLOSSARY.md "Ids, groups and the
// logbook"), apart from the DOM: a day's notes cut into half-hour slots and the day's untimed
// notes, the words on a chip, a bubble and the untimed box, and the palette request each of
// them, and an empty hour, opens. notes-palette.js draws them in the week, 3-day and day views.
//
// A slot is a half hour holding at least one timed note. One note shows as a chip, two or more
// as one count bubble. A note whose time does not read as HH:MM is shown with the untimed ones,
// so no note is ever hidden by a malformed time.
//
// Pure: Node tests drive it with plain notes. Same dual-environment export pattern as notes.js.

const NCAL_SLOT_MIN = 30;
const NCAL_DAY_MIN = 24 * 60;
const NCAL_TIME = /^(\d{2}):(\d{2})$/;

const nCalPad = (n) => String(n).padStart(2, '0');
const nCalHhmm = (min) => `${nCalPad(Math.floor(min / 60))}:${nCalPad(min % 60)}`;

function nCalMinutes(at) {
  const m = NCAL_TIME.exec(String(at == null ? '' : at));
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min < NCAL_DAY_MIN ? min : null;
}

const nCalByTime = (a, b) => (a.at || '') < (b.at || '') ? -1 : (a.at || '') > (b.at || '') ? 1 : a.index - b.index;

// One day's notes -> { slots: [{ fromMin, toMin, notes }] in time order, untimed: [notes] }.
function noteCalendarDay(notes, day) {
  const slots = new Map();
  const untimed = [];
  for (const note of notes) {
    if (note.day !== day) continue;
    const min = nCalMinutes(note.at);
    if (min === null) { untimed.push(note); continue; }
    const from = Math.floor(min / NCAL_SLOT_MIN) * NCAL_SLOT_MIN;
    if (!slots.has(from)) slots.set(from, { fromMin: from, toMin: from + NCAL_SLOT_MIN, notes: [] });
    slots.get(from).notes.push(note);
  }
  const list = [...slots.values()].sort((a, b) => a.fromMin - b.fromMin);
  for (const slot of list) slot.notes.sort(nCalByTime);
  return { slots: list, untimed };
}

// The first `count` words of a note, with an ellipsis when there are more.
function noteFirstWords(text, count) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  return words.slice(0, count).join(' ') + (words.length > count ? '…' : '');
}

// The cards and groups a slot's notes are about, once each in first-seen order, `no card` last.
function noteSlotTargets(notes) {
  const ids = [];
  for (const note of notes) if (note.target && !ids.includes(`#${note.target}`)) ids.push(`#${note.target}`);
  if (notes.some((note) => !note.target)) ids.push('no card');
  return ids;
}

// A chip's tooltip: the time and the card or group it is about, then the full text.
// `label(id)` reads a target the way the palette's chip does ('no card' for none).
function noteTip(note, label) {
  return `${note.at} · ${label(note.target)}\n${note.note}`;
}

const nCalCount = (n) => `${n} note${n === 1 ? '' : 's'}`;

// A bubble's tooltip: how many, which half hour, which cards, then each note.
function noteSlotTip(slot) {
  const lines = slot.notes.map((note) => `${note.at} ${note.target ? `#${note.target} ` : ''}${note.note}`);
  return [`${nCalCount(slot.notes.length)}, ${nCalHhmm(slot.fromMin)}–${nCalHhmm(slot.toMin)}: ${noteSlotTargets(slot.notes).join(', ')}`, ...lines].join('\n');
}

function noteUntimedTip(notes) {
  return notes.map((note) => `${note.target ? `#${note.target}` : 'no card'}: ${note.note}`).join('\n');
}

// The palette requests (notes.js, noteSubjectFrom).
function noteSlotRequest(day, slot) {
  return { kind: 'slot', day, fromMin: slot.fromMin, toMin: slot.toMin };
}

function noteUntimedRequest(day) {
  return { kind: 'untimed', day };
}

// A click on an empty part of a day's column, `rawMin` minutes from midnight: the hour it is in.
function noteHourRequest(day, rawMin) {
  const hour = Math.max(0, Math.min(23, Math.floor(rawMin / 60)));
  return { kind: 'slot', day, fromMin: hour * 60, toMin: hour * 60 + 60 };
}

const NOTES_CALENDAR_EXPORTS = {
  noteCalendarDay, noteFirstWords, noteSlotTargets, noteTip, noteSlotTip, noteUntimedTip, noteSlotRequest, noteUntimedRequest, noteHourRequest,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NOTES_CALENDAR_EXPORTS;
} else {
  Object.assign(window, NOTES_CALENDAR_EXPORTS);
}
