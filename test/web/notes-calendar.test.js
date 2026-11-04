const { test } = require('node:test');
const assert = require('node:assert');
const c = require('../../plugin/skills/web/web/notes-calendar');
const n = require('../../plugin/skills/web/web/notes');
const h = require('../../plugin/skills/web/web/hour-scale');

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

// --- a note with a time and a duration: a range --------------------------------------------------------

const ranged = (day, at, duration, text, index = 0) => ({ ...note(day, at, '7', text, index), duration });

test('a note with a time and a duration is a range from its start to its end, and is in no half-hour slot', () => {
  const day = c.noteCalendarDay([ranged('2026-10-15', '10:30', '1h30m', 'migration'), note('2026-10-15', '10:40', '22', 'a point', 1)], '2026-10-15');
  assert.deepStrictEqual(day.ranges.map((r) => [r.startMin, r.endMin, r.note.note]), [[630, 720, 'migration']]);
  assert.deepStrictEqual(day.slots.map((s) => [s.fromMin, s.notes.map((x) => x.note)]), [[630, ['a point']]]);
});

test('ranges run in time order, and each length the reader takes is read', () => {
  const day = c.noteCalendarDay([
    ranged('2026-10-15', '14:00', '90m', 'c', 2), ranged('2026-10-15', '09:00', '1h', 'a'), ranged('2026-10-15', '09:00', '1h30', 'b', 1), ranged('2026-10-15', '16:05', '5m', 'd', 3),
  ], '2026-10-15');
  assert.deepStrictEqual(day.ranges.map((r) => [r.note.note, r.startMin, r.endMin]), [['a', 540, 600], ['b', 540, 630], ['c', 840, 930], ['d', 965, 970]]);
  assert.deepStrictEqual(day.slots, []);
});

test('a duration with no time, or one that does not read, leaves the note where it was: untimed, or a point', () => {
  const day = c.noteCalendarDay([ranged('2026-10-15', null, '45m', 'a length'), ranged('2026-10-15', '10:00', null, 'a point', 1), ranged('2026-10-15', '11:00', 'a while', 'odd', 2)], '2026-10-15');
  assert.deepStrictEqual(day.untimed.map((x) => x.note), ['a length']);
  assert.deepStrictEqual(day.slots.map((s) => s.notes[0].note), ['a point', 'odd']);
  assert.deepStrictEqual(day.ranges, []);
});

test('a day with no range has an empty list of them', () => {
  assert.deepStrictEqual(c.noteCalendarDay([note('2026-10-15', '10:10', '22', 'agreed')], '2026-10-15').ranges, []);
});

// --- the strip laid out: blocks, chips and bubbles in lanes ---------------------------------------------

const PLAIN = h.hourScale(h.plainHeights());
const DAY = '2026-10-15';
const strip = (notes, each, scale = PLAIN) => c.noteStripLayout(c.noteCalendarDay(notes, DAY), each, scale);
const what = (item) => (item.kind === 'block' ? `block ${item.note.note}` : item.note ? `chip ${item.note.note}` : `slot ${item.slot.fromMin}`);
const placed = (items) => items.map((x) => [what(x), x.top, x.height, x.lane, x.lanes]);

// No two items that share any of the strip's height share a lane, and every lane is one of its item's lanes.
function coversNone(items) {
  for (const a of items) {
    assert.ok(a.lane >= 0 && a.lane < a.lanes, `${what(a)} in lane ${a.lane} of ${a.lanes}`);
    for (const b of items) {
      if (a === b || a.top >= b.top + b.height || b.top >= a.top + a.height) continue;
      assert.notStrictEqual(a.lane, b.lane, `${what(a)} covers ${what(b)}`);
      assert.strictEqual(a.lanes, b.lanes, `${what(a)} and ${what(b)} share the width alike`);
    }
  }
}

test('with no range the strip is laid out as it was drawn: a chip or bubble a half hour, or a chip a note, each the strip\'s whole width', () => {
  const notes = [note(DAY, '09:30', '7', 'a'), note(DAY, '10:00', '22', 'b', 1), note(DAY, '10:10', '3', 'c', 2)];
  assert.deepStrictEqual(placed(strip(notes, false)), [['slot 570', 380, 20, 0, 1], ['slot 600', 400, 20, 0, 1]]);
  assert.deepStrictEqual(placed(strip(notes, true)), [['chip a', 360, 20, 0, 1], ['chip b', 400, 20, 0, 1], ['chip c', 420, 20, 0, 1]]);
  for (const x of strip(notes, true)) assert.strictEqual(x.slot.fromMin, x.note.note === 'a' ? 570 : 600, 'a chip keeps the half hour it opens');
});

test('a range at 10:30 of 1h30m is one block from the 10:30 line to the 12:00 line, in both states', () => {
  for (const each of [false, true]) {
    const items = strip([ranged(DAY, '10:30', '1h30m', 'migration')], each);
    assert.deepStrictEqual(placed(items), [['block migration', 420, 60, 0, 1]], each ? 'Notes' : 'Grouped Notes');
    assert.deepStrictEqual([items[0].startMin, items[0].endMin], [630, 720]);
  }
});

test('a block opens the half hour its range starts in, as the note\'s chip did', () => {
  const [block] = strip([ranged(DAY, '10:40', '45m', 'x')], false);
  assert.deepStrictEqual([block.slot.fromMin, block.slot.toMin], [630, 660]);
  assert.deepStrictEqual(c.noteChipRequest({ ...block.note, target: '' }, block.slot), { kind: 'slot', day: DAY, fromMin: 630, toMin: 660 });
});

test('a short range at the end of the day is a chip tall and ends at midnight, not below the grid', () => {
  assert.deepStrictEqual(placed(strip([ranged(DAY, '23:50', '10m', 'last')], false)), [['block last', 940, 20, 0, 1]]);
  const late = strip([ranged(DAY, '23:00', '1h', 'the last hour')], true);
  assert.deepStrictEqual([late[0].top, late[0].height], [920, 40], 'a block that reaches midnight on its own keeps its start');
});

test('a very short range is still a chip tall', () => {
  assert.deepStrictEqual(placed(strip([ranged(DAY, '16:05', '5m', 'quick')], false)), [['block quick', 643.3333333333333, 20, 0, 1]]);
  assert.strictEqual(strip([ranged(DAY, '16:05', '1m', 'quicker')], true)[0].height, 20);
});

test('in Notes a block follows the hours its point notes stretched, and no hour grows for it', () => {
  const notes = [note(DAY, '10:00', '22', 'a'), note(DAY, '10:20', '22', 'b', 1), note(DAY, '10:40', '22', 'c', 2), ranged(DAY, '09:30', '2h', 'long', 3)];
  const dayNotes = c.noteCalendarDay(notes, DAY);
  const heights = h.eachHeights([c.noteHourCounts(dayNotes)]);
  assert.deepStrictEqual([heights[9], heights[10], heights[11]], [40, 60, 40], 'three point notes grow hour 10 by one row; the range adds none');
  const scale = h.hourScale(heights);
  const block = c.noteStripLayout(dayNotes, true, scale).find((x) => x.kind === 'block');
  assert.deepStrictEqual([block.top, block.height], [380, 20 + 60 + 20], '09:30 to 11:30 over the 60px hour');
});

test('two overlapping ranges are side by side, and a range clear of them has the strip\'s whole width', () => {
  for (const each of [false, true]) {
    const items = strip([ranged(DAY, '10:00', '1h', 'a'), ranged(DAY, '10:30', '1h', 'b', 1), ranged(DAY, '13:00', '30m', 'c', 2)], each);
    assert.deepStrictEqual(items.map((x) => [what(x), x.lane, x.lanes]), [['block a', 0, 2], ['block b', 1, 2], ['block c', 0, 1]]);
    coversNone(items);
  }
});

test('a point note inside a range sits beside it, as a chip in Notes and as its half hour in Grouped Notes', () => {
  const notes = [ranged(DAY, '10:00', '1h30m', 'work'), note(DAY, '10:40', '22', 'inside', 1), note(DAY, '10:45', '3', 'also inside', 2), note(DAY, '14:00', '3', 'clear', 3)];
  assert.deepStrictEqual(placed(strip(notes, false)), [['block work', 400, 60, 0, 2], ['slot 630', 420, 20, 1, 2], ['slot 840', 560, 20, 0, 1]]);
  assert.deepStrictEqual(placed(strip(notes, true)), [['block work', 400, 60, 0, 2], ['chip inside', 400, 20, 1, 2], ['chip also inside', 420, 20, 1, 2], ['chip clear', 560, 20, 0, 1]]);
});

test('ranges that only touch end to start are not side by side', () => {
  const items = strip([ranged(DAY, '10:00', '1h', 'a'), ranged(DAY, '11:00', '1h', 'b', 1), note(DAY, '12:00', '3', 'c', 2)], false);
  assert.deepStrictEqual(items.map((x) => [what(x), x.lane, x.lanes]), [['block a', 0, 1], ['block b', 0, 1], ['slot 720', 0, 1]]);
});

test('lanes are shared through an overlap: a lane its first item has left is taken again, and every item of the run shares the width alike', () => {
  const notes = [ranged(DAY, '09:00', '2h', 'a'), ranged(DAY, '10:00', '2h', 'b', 1), note(DAY, '11:30', '3', 'c', 2), ranged(DAY, '11:15', '15m', 'd', 3)];
  assert.deepStrictEqual(strip(notes, false).map((x) => [what(x), x.lane, x.lanes]), [['block a', 0, 3], ['block b', 1, 3], ['block d', 0, 3], ['slot 690', 2, 3]]);
  assert.deepStrictEqual(strip(notes, true).map((x) => [what(x), x.lane, x.lanes]), [['block a', 0, 3], ['block b', 1, 3], ['chip c', 0, 3], ['block d', 2, 3]], 'in Notes the chip sits on its hour line, above the block at 11:15');
  for (const each of [false, true]) coversNone(strip(notes, each));
});

test('many notes and ranges in one day: none ever covers another, in either state', () => {
  const notes = [];
  const times = ['08:00', '08:10', '08:40', '09:05', '09:15', '09:20', '10:00', '10:30', '11:45', '12:00', '12:10', '15:55'];
  const lengths = ['30m', null, '2h', null, '5m', '1h', null, '45m', null, '15m', '3h', null];
  times.forEach((at, i) => notes.push(lengths[i] ? ranged(DAY, at, lengths[i], `n${i}`, i) : note(DAY, at, '7', `n${i}`, i)));
  for (const each of [false, true]) {
    const dayNotes = c.noteCalendarDay(notes, DAY);
    const scale = each ? h.hourScale(h.eachHeights([c.noteHourCounts(dayNotes)])) : PLAIN;
    const items = c.noteStripLayout(dayNotes, each, scale);
    assert.strictEqual(items.filter((x) => x.kind === 'block').length, 7);
    coversNone(items);
  }
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

test('a block\'s tooltip reads its range, the card and the full text', () => {
  const label = (id) => (id === '7' ? '#7 Port the zephyr schema' : 'no card');
  assert.strictEqual(c.noteTip(ranged('2026-10-15', '10:30', '1h30m', 'migration rehearsal'), label), '10:30–12:00 · #7 Port the zephyr schema\nmigration rehearsal');
});

test('the untimed box lists a note with a duration and no time with its length before its text', () => {
  const day = c.noteCalendarDay([ranged('2026-10-15', null, '45m', 'reviews'), { ...ranged('2026-10-15', null, '1h30', 'odd form', 1), target: '' }, note('2026-10-15', '', '7', 'kickoff', 2)], '2026-10-15');
  assert.strictEqual(c.noteUntimedTip(day.untimed), '#7: 45m reviews\nno card: 1h30m odd form\n#7: kickoff');
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

// --- the notes strip's width -------------------------------------------------------------------------

test('a strip is at least 44px wide and leaves the card blocks a 24px sliver of the column', () => {
  assert.strictEqual(c.noteStripClamp(100, 300), 100);
  assert.strictEqual(c.noteStripClamp(10, 300), 44);
  assert.strictEqual(c.noteStripClamp(-50, 300), 44);
  assert.strictEqual(c.noteStripClamp(299, 300), 276);
  assert.strictEqual(c.noteStripClamp(5000, 300), 276);
  assert.strictEqual(c.noteStripClamp(5000, 1400), 1376, 'a wide day column goes nearly all the way');
});

test('a column too narrow for both keeps the 44px minimum', () => {
  assert.strictEqual(c.noteStripClamp(200, 60), 44);
  assert.strictEqual(c.noteStripClamp(200, 0), 44);
});

test('a width is whole pixels', () => {
  assert.strictEqual(c.noteStripClamp(100.6, 300), 101);
  assert.strictEqual(c.noteStripClamp(Number.NaN, 300), 44);
});

test('dragging the divider sets the strip to the distance from the pointer to the column\'s right edge', () => {
  assert.strictEqual(c.noteStripFromPointer(500, 380, 220), 120);
  assert.strictEqual(c.noteStripFromPointer(500, 495, 220), 44, 'past the minimum');
  assert.strictEqual(c.noteStripFromPointer(500, 100, 220), 196, 'past the sliver');
  assert.strictEqual(c.noteStripFromPointer(500, 520, 220), 44, 'beyond the right edge');
});

test('Left widens the strip and Right narrows it, a step at a time, within the same bounds', () => {
  assert.strictEqual(c.noteStripStep(100, 'ArrowLeft', 300), 108);
  assert.strictEqual(c.noteStripStep(100, 'ArrowRight', 300), 92);
  assert.strictEqual(c.noteStripStep(46, 'ArrowRight', 300), 44);
  assert.strictEqual(c.noteStripStep(270, 'ArrowLeft', 300), 276);
  assert.strictEqual(c.noteStripStep(100, 'ArrowUp', 300), null, 'any other key is no step');
});

test('a set width is the CSS for the strip: its px, held between the minimum and the column less the sliver', () => {
  assert.strictEqual(c.noteStripCss(120), 'max(44px, min(120px, calc(100% - 24px)))');
  assert.strictEqual(c.noteStripCss(null), null, 'no width set is the stylesheet\'s own default');
});

test('chips show 12 words by default and many more once the strip has a width set', () => {
  assert.strictEqual(c.noteChipWords(null), 12);
  assert.ok(c.noteChipWords(120) > 40);
});

test('the divider reports the strip as a percentage of its column, between the least and the most it can be', () => {
  assert.deepStrictEqual(c.noteStripPercent(100, 400), { now: 25, min: 11, max: 94 });
  assert.deepStrictEqual(c.noteStripPercent(44, 400), { now: 11, min: 11, max: 94 });
  assert.deepStrictEqual(c.noteStripPercent(376, 400), { now: 94, min: 11, max: 94 });
  assert.deepStrictEqual(c.noteStripPercent(500, 400), { now: 94, min: 11, max: 94 }, 'never past the most');
  assert.deepStrictEqual(c.noteStripPercent(20, 400), { now: 11, min: 11, max: 94 }, 'never under the least');
  assert.strictEqual(c.noteStripPercent(100, 0), null, 'a column with no width reports nothing');
  assert.deepStrictEqual(c.noteStripPercent(44, 60), { now: 73, min: 73, max: 73 }, 'a column too narrow for both is the least strip');
});

test('the strip\'s width is kept in the browser per board, and a bad value is no width', () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.strictEqual(c.noteStripLoad(storage, 'plan'), null);
  c.noteStripSave(storage, 'plan', 150);
  assert.strictEqual(store.get('kanban.plan.calendar.notesWidth'), '150');
  assert.strictEqual(c.noteStripLoad(storage, 'plan'), 150);
  assert.strictEqual(c.noteStripLoad(storage, 'other'), null);
  for (const bad of ['', 'wide', '-5', '12', '0', '99999', 'NaN', '1e3', '50px']) {
    store.set('kanban.plan.calendar.notesWidth', bad);
    assert.strictEqual(c.noteStripLoad(storage, 'plan'), null, JSON.stringify(bad));
  }
  c.noteStripSave(storage, 'plan', 150);
  c.noteStripSave(storage, 'plan', null);
  assert.strictEqual(store.has('kanban.plan.calendar.notesWidth'), false, 'the default is no saved width');
  assert.strictEqual(c.noteStripLoad({ getItem() { throw new Error('blocked'); } }, 'plan'), null);
  c.noteStripSave({ setItem() { throw new Error('full'); }, removeItem() { throw new Error('full'); } }, 'plan', 150);
  c.noteStripSave({ setItem() { throw new Error('full'); }, removeItem() { throw new Error('full'); } }, 'plan', null);
});
