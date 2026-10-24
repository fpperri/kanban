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
// The strip at the right of a day's column that holds them has a width a divider on its left edge sets
// for every day at once: at least 44px, at most the column less a 24px sliver for the card blocks, kept
// in this browser per board. With none set the stylesheet's own default stands.
//
// Pure: Node tests drive it with plain notes. Same dual-environment export pattern as notes.js.

const NCAL_COLUMN_STATE = (typeof module !== 'undefined' && module.exports) ? require('./column-state') : window;
const NCAL_NOTES = (typeof module !== 'undefined' && module.exports) ? require('./notes') : window;

const NCAL_SLOT_MIN = 30;
const NCAL_DAY_MIN = 24 * 60;
const NCAL_TIME = /^(\d{2}):(\d{2})$/;
const NCAL_STRIP_MIN = 44;
const NCAL_STRIP_SLIVER = 24;
const NCAL_STRIP_STEP = 8;
const NCAL_STRIP_MAX_SAVED = 4000;
const NCAL_STRIP_FEATURE = 'calendar.notesWidth';
const NCAL_WORDS = 12;
const NCAL_WORDS_WIDE = 60;

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

// The width in whole px a strip may have in a column `colWidth` wide.
function noteStripClamp(px, colWidth) {
  const most = Math.max(NCAL_STRIP_MIN, colWidth - NCAL_STRIP_SLIVER);
  const want = Number.isFinite(px) ? px : NCAL_STRIP_MIN;
  return Math.round(Math.min(most, Math.max(NCAL_STRIP_MIN, want)));
}

// A drag of the divider to `x`: the strip runs from there to the column's right edge.
function noteStripFromPointer(colRight, x, colWidth) {
  return noteStripClamp(colRight - x, colWidth);
}

// A key on the divider: Left widens the strip, Right narrows it; null for any other key.
function noteStripStep(current, key, colWidth) {
  if (key === 'ArrowLeft') return noteStripClamp(current + NCAL_STRIP_STEP, colWidth);
  if (key === 'ArrowRight') return noteStripClamp(current - NCAL_STRIP_STEP, colWidth);
  return null;
}

// What a divider reports as a separator: the strip as a percentage of its column, and the least and the
// most it can be. null for a column with no width.
function noteStripPercent(px, colWidth) {
  if (!(colWidth > 0)) return null;
  const pct = (v) => Math.round((100 * v) / colWidth);
  const most = Math.max(NCAL_STRIP_MIN, colWidth - NCAL_STRIP_SLIVER);
  return { now: pct(Math.min(most, Math.max(NCAL_STRIP_MIN, px))), min: pct(NCAL_STRIP_MIN), max: pct(most) };
}

// The CSS value of --cal-note-width for a set width, or null for none. The column's own width bounds
// it, so a narrower column or a narrower window still leaves the card blocks their sliver.
function noteStripCss(px) {
  return px === null || px === undefined ? null : `max(${NCAL_STRIP_MIN}px, min(${px}px, calc(100% - ${NCAL_STRIP_SLIVER}px)))`;
}

// A chip shows the first words of its note, as many as fit: 12 in the default strip, many more in one
// the person has widened (the text is cut by the chip's edge, not by the count).
function noteChipWords(stripPx) {
  return stripPx === null || stripPx === undefined ? NCAL_WORDS : NCAL_WORDS_WIDE;
}

function noteStripLoad(storage, projectName) {
  const saved = NCAL_COLUMN_STATE.boardPrefLoad(storage, projectName, NCAL_STRIP_FEATURE);
  if (saved === null || !/^\d+$/.test(saved)) return null;
  const px = Number(saved);
  return px >= NCAL_STRIP_MIN && px <= NCAL_STRIP_MAX_SAVED ? px : null;
}

// Null puts the default back: nothing is kept.
function noteStripSave(storage, projectName, px) {
  NCAL_COLUMN_STATE.boardPrefSave(storage, projectName, NCAL_STRIP_FEATURE, px);
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
  if (notes.some((note) => !note.target)) ids.push(NCAL_NOTES.NOTE_NO_CARD);
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
  return notes.map((note) => `${note.target ? `#${note.target}` : NCAL_NOTES.NOTE_NO_CARD}: ${note.note}`).join('\n');
}

// The palette requests (notes.js, noteSubjectFrom).
function noteSlotRequest(day, slot) {
  return { kind: 'slot', day, fromMin: slot.fromMin, toMin: slot.toMin };
}

// A chip is one note: the palette opens on that note's card or group, at the note's time. A
// note about nothing has no subject to open on, so it opens its half hour, as a bubble does.
function noteChipRequest(note, slot) {
  return note.target ? { target: note.target, day: note.day, at: note.at } : noteSlotRequest(note.day, slot);
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
  noteCalendarDay, noteFirstWords, noteSlotTargets, noteTip, noteSlotTip, noteUntimedTip, noteSlotRequest, noteChipRequest, noteUntimedRequest, noteHourRequest,
  noteStripClamp, noteStripFromPointer, noteStripStep, noteStripCss, noteStripPercent, noteChipWords, noteStripLoad, noteStripSave,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NOTES_CALENDAR_EXPORTS;
} else {
  Object.assign(window, NOTES_CALENDAR_EXPORTS);
}
