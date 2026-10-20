const { test } = require('node:test');
const assert = require('node:assert');
const c = require('../web/notes-calendar');
const n = require('../web/notes');

const note = (day, at, target, text, index = 0) => ({ day, at, target, note: text, by: '@human', index });

// --- what the Calendar draws for one day --------------------------------------------------------------

test('a day with one timed note has one slot, the half hour that holds the note', () => {
  const day = c.noteCalendarDay([note('2026-10-15', '10:10', '22', 'agreed')], '2026-10-15');
  assert.strictEqual(day.slots.length, 1);
  assert.deepStrictEqual([day.slots[0].fromMin, day.slots[0].toMin], [600, 630]);
  assert.strictEqual(day.slots[0].notes.length, 1);
  assert.deepStrictEqual(day.untimed, []);
});

test('notes in the same half hour share one slot, in time order', () => {
  const day = c.noteCalendarDay([
    note('2026-10-15', '10:20', '3', 'second', 1),
    note('2026-10-15', '10:00', '22', 'first', 0),
    note('2026-10-15', '10:29', '', 'third', 2),
  ], '2026-10-15');
  assert.strictEqual(day.slots.length, 1);
  assert.deepStrictEqual(day.slots[0].notes.map((x) => x.note), ['first', 'second', 'third']);
});

test('the half hour is a boundary: 10:29 and 10:30 are different slots, and slots run in time order', () => {
  const day = c.noteCalendarDay([note('2026-10-15', '10:30', '7', 'b'), note('2026-10-15', '10:29', '7', 'a'), note('2026-10-15', '08:00', '', 'early')], '2026-10-15');
  assert.deepStrictEqual(day.slots.map((s) => [s.fromMin, s.toMin]), [[480, 510], [600, 630], [630, 660]]);
});

test('the last half hour of the day ends at midnight', () => {
  const day = c.noteCalendarDay([note('2026-10-15', '23:45', '7', 'late')], '2026-10-15');
  assert.deepStrictEqual([day.slots[0].fromMin, day.slots[0].toMin], [1410, 1440]);
});

test('notes without a time are the day\'s untimed ones, and other days\' notes are left out', () => {
  const day = c.noteCalendarDay([
    note('2026-10-15', '', '7', 'no time'),
    note('2026-10-15', null, '3', 'none either'),
    note('2026-10-14', '', '7', 'another day'),
    note('2026-10-14', '09:00', '7', 'another day, timed'),
  ], '2026-10-15');
  assert.deepStrictEqual(day.untimed.map((x) => x.note), ['no time', 'none either']);
  assert.deepStrictEqual(day.slots, []);
});

test('a time that does not read as HH:MM counts as untimed rather than vanishing', () => {
  const day = c.noteCalendarDay([note('2026-10-15', 'noon', '7', 'odd')], '2026-10-15');
  assert.deepStrictEqual(day.untimed.map((x) => x.note), ['odd']);
});

// --- the words on a chip, a bubble and a box -----------------------------------------------------------

test('a chip reads the first words of the note and marks the cut', () => {
  assert.strictEqual(c.noteFirstWords('one two three', 5), 'one two three');
  assert.strictEqual(c.noteFirstWords('one two three four five six', 5), 'one two three four five…');
  assert.strictEqual(c.noteFirstWords('  spaced\n out  ', 5), 'spaced out');
});

test('a bubble lists the cards its notes are about once each, and "no card" last', () => {
  const slot = c.noteCalendarDay([
    note('2026-10-15', '10:00', '22', 'a'), note('2026-10-15', '10:05', '', 'b'), note('2026-10-15', '10:10', '22', 'c'), note('2026-10-15', '10:15', 'G3', 'd'),
  ], '2026-10-15').slots[0];
  assert.deepStrictEqual(c.noteSlotTargets(slot.notes), ['#22', '#G3', 'no card']);
});

test('a chip\'s tooltip carries the time, the card and the full text', () => {
  const label = (id) => (id === '22' ? '#22 Cut over the data layer' : 'no card');
  assert.strictEqual(c.noteTip(note('2026-10-15', '10:00', '22', 'cutover window agreed'), label), '10:00 · #22 Cut over the data layer\ncutover window agreed');
  assert.strictEqual(c.noteTip(note('2026-10-15', '10:00', '', 'loose'), label), '10:00 · no card\nloose');
});

test('a bubble\'s tooltip counts the notes, names the half hour and lists each note', () => {
  const slot = c.noteCalendarDay([note('2026-10-15', '10:00', '22', 'a'), note('2026-10-15', '10:05', '', 'b')], '2026-10-15').slots[0];
  assert.strictEqual(c.noteSlotTip(slot), '2 notes, 10:00–10:30: #22, no card\n10:00 #22 a\n10:05 b');
});

test('the untimed box says how many and lists them', () => {
  const day = c.noteCalendarDay([note('2026-10-15', '', '7', 'kickoff'), note('2026-10-15', '', '', 'loose')], '2026-10-15');
  assert.strictEqual(c.noteUntimedTip(day.untimed), '#7: kickoff\nno card: loose');
});

// --- opening the palette -------------------------------------------------------------------------------

test('a slot opens the palette on that half hour, and the palette lists its notes', () => {
  const all = [note('2026-10-15', '10:00', '22', 'a'), note('2026-10-15', '10:40', '3', 'b'), note('2026-10-14', '10:05', '3', 'c')];
  const slot = c.noteCalendarDay(all, '2026-10-15').slots[0];
  const req = c.noteSlotRequest('2026-10-15', slot);
  assert.deepStrictEqual(req, { kind: 'slot', day: '2026-10-15', fromMin: 600, toMin: 630 });
  const sub = n.noteSubjectFrom(req, { today: '2026-10-19', isGroup: () => false });
  assert.deepStrictEqual(n.noteSubjectNotes(all, sub).map((x) => x.note), ['a']);
});

test('a chip opens the palette on the card or group of its note at the time of the note; a note about nothing opens its half hour', () => {
  const is = { today: '2026-10-19', isGroup: (id) => id === 'I2' };
  const card = note('2026-10-15', '09:42', '7', 'a');
  const req = c.noteChipRequest(card, null);
  assert.deepStrictEqual(req, { target: '7', day: '2026-10-15', at: '09:42' });
  assert.deepStrictEqual(n.noteSubjectFrom(req, is), { kind: 'card', id: '7', day: '2026-10-15', at: '09:42' });
  const group = c.noteChipRequest(note('2026-10-15', '10:00', 'I2', 'b'), null);
  assert.deepStrictEqual(n.noteSubjectFrom(group, is), { kind: 'group', id: 'I2', day: '2026-10-15', at: '10:00' });
  const loose = note('2026-10-15', '09:42', '', 'c');
  const slot = c.noteCalendarDay([loose], '2026-10-15').slots[0];
  assert.deepStrictEqual(c.noteChipRequest(loose, slot), c.noteSlotRequest('2026-10-15', slot));
});

test('the untimed box opens the palette on the day\'s untimed notes', () => {
  assert.deepStrictEqual(c.noteUntimedRequest('2026-10-15'), { kind: 'untimed', day: '2026-10-15' });
});

test('an empty hour opens the palette on that hour, and the time field starts at its first minute', () => {
  assert.deepStrictEqual(c.noteHourRequest('2026-10-15', 613), { kind: 'slot', day: '2026-10-15', fromMin: 600, toMin: 660 });
  const sub = n.noteSubjectFrom(c.noteHourRequest('2026-10-15', 659), { today: '2026-10-19', isGroup: () => false });
  assert.strictEqual(sub.at, '10:00');
});

test('a click past the ends of the grid lands on the first and last hour', () => {
  assert.strictEqual(c.noteHourRequest('2026-10-15', -5).fromMin, 0);
  assert.strictEqual(c.noteHourRequest('2026-10-15', 99999).fromMin, 1380);
});

test('#22 then Enter from an hour keeps the hour\'s time: the card is aimed at and the write plan reads the slot\'s time', () => {
  const sub = n.noteSubjectFrom(c.noteHourRequest('2026-10-15', 601), { today: '2026-10-19', isGroup: () => false });
  const aimed = n.noteSubjectAimed(sub, '22');
  assert.strictEqual(aimed.at, '10:00');
  const plan = n.noteWritePlan(n.noteParseLine('checked the cutover', { board: 'plan', isTarget: () => true }), aimed, { value: '10:00', untimed: false }, { today: '2026-10-19', now: '16:40', lastNoted: '' });
  assert.deepStrictEqual([plan.at, plan.day, plan.target], ['10:00', '2026-10-15', '22']);
});
