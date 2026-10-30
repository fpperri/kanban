const { test } = require('node:test');
const assert = require('node:assert');
const h = require('../../plugin/skills/web/web/hour-scale');
const c = require('../../plugin/skills/web/web/notes-calendar');

const note = (day, at, text, index = 0) => ({ day, at, target: '7', note: text, by: '@human', index });

test('the plain scale is 40px an hour in a straight line, 960px a day', () => {
  const s = h.hourScale(h.plainHeights());
  assert.strictEqual(s.total, 960);
  assert.strictEqual(s.yOf(0), 0);
  assert.strictEqual(s.yOf(60), 40);
  assert.strictEqual(s.yOf(90), 60);
  assert.strictEqual(s.yOf(1440), 960);
  assert.strictEqual(s.minOf(60), 90);
  assert.strictEqual(s.minOf(40), 60);
});

test('a taller hour pushes every later hour down and keeps time linear inside it', () => {
  const heights = h.plainHeights();
  heights[9] = 100;
  const s = h.hourScale(heights);
  assert.strictEqual(s.top(9), 360);
  assert.strictEqual(s.top(10), 460);
  assert.strictEqual(s.total, 1020);
  assert.strictEqual(s.yOf(9 * 60 + 30), 410);
  assert.strictEqual(s.yOf(10 * 60), 460);
  assert.strictEqual(s.height(9), 100);
});

test('y to time is the inverse of time to y, on every minute, plain or stretched', () => {
  const stretched = h.plainHeights();
  stretched[3] = 80; stretched[9] = 100; stretched[23] = 140;
  for (const hs of [h.plainHeights(), stretched]) {
    const s = h.hourScale(hs);
    for (let m = 0; m <= 1440; m += 7) assert.ok(Math.abs(s.minOf(s.yOf(m)) - m) < 1e-9, `minute ${m}`);
  }
});

test('a y above the grid is minute 0 and a y below it is the end of the day', () => {
  const s = h.hourScale(h.plainHeights());
  assert.strictEqual(s.minOf(-20), 0);
  assert.strictEqual(s.minOf(5000), 1440);
});

test('the lines gradient puts a 1px line at the foot of each hour, at its own height', () => {
  const heights = h.plainHeights();
  heights[0] = 60;
  const g = h.hourLinesCss(h.hourScale(heights), 'var(--l)');
  assert.ok(g.startsWith('linear-gradient(to bottom, '));
  assert.ok(g.includes('transparent 0px 59px, var(--l) 59px 60px'));
  assert.ok(g.includes('transparent 60px 99px, var(--l) 99px 100px'));
});

test('an hour is as tall as the most notes any shown day has in it, never under 40px', () => {
  const a = c.noteCalendarDay([note('2026-10-15', '10:00', 'a'), note('2026-10-15', '10:20', 'b', 1), note('2026-10-15', '10:40', 'c', 2), note('2026-10-15', '11:05', 'd', 3)], '2026-10-15');
  const b = c.noteCalendarDay([note('2026-10-16', '10:10', 'e'), note('2026-10-16', '10:50', 'f', 1)], '2026-10-16');
  const heights = h.eachHeights([c.noteHourCounts(a), c.noteHourCounts(b)]);
  assert.strictEqual(heights.length, 24);
  assert.strictEqual(heights[10], 60);
  assert.strictEqual(heights[11], 40);
  assert.strictEqual(heights[0], 40);
  assert.strictEqual(heights[8], 40);
});

test('two notes in an hour fit the 40px hour; the third grows it by a chip row', () => {
  assert.strictEqual(h.eachHeights([[0, 0, 2, ...Array(21).fill(0)]])[2], 40);
  assert.strictEqual(h.eachHeights([[0, 0, 3, ...Array(21).fill(0)]])[2], 60);
});

test('with no days or no notes the heights are the plain ones', () => {
  assert.deepStrictEqual(h.eachHeights([]), h.plainHeights());
  assert.deepStrictEqual(h.eachHeights([c.noteHourCounts(null)]), h.plainHeights());
});

test('each note is its own chip, stacked in time order from its hour line down', () => {
  const d = c.noteCalendarDay([
    note('2026-10-15', '10:40', 'c', 2), note('2026-10-15', '10:00', 'a'), note('2026-10-15', '10:20', 'b', 1), note('2026-10-15', '09:30', 'z', 3),
  ], '2026-10-15');
  const chips = c.noteEachChips(d);
  assert.deepStrictEqual(chips.map((x) => [x.hour, x.row, x.note.note]), [[9, 0, 'z'], [10, 0, 'a'], [10, 1, 'b'], [10, 2, 'c']]);
  assert.strictEqual(chips[1].slot.fromMin, 600);
  assert.strictEqual(chips[2].slot.fromMin, 600);
});

test('the notes mode is kept per board, Grouped by default', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.strictEqual(c.noteModeLoad(storage, 'b'), 'grouped');
  c.noteModeSave(storage, 'b', 'each');
  assert.strictEqual(c.noteModeLoad(storage, 'b'), 'each');
  assert.strictEqual(c.noteModeLoad(storage, 'other'), 'grouped');
  c.noteModeSave(storage, 'b', 'grouped');
  assert.strictEqual(c.noteModeLoad(storage, 'b'), 'grouped');
  for (const k of [...mem.keys()]) mem.set(k, 'junk');
  c.noteModeSave(storage, 'b', 'each');
  for (const k of [...mem.keys()]) mem.set(k, 'junk');
  assert.strictEqual(c.noteModeLoad(storage, 'b'), 'grouped');
});

test('the flat scale gives a span exactly as the straight 40px line always did, to the last digit', () => {
  const s = h.hourScale(h.plainHeights());
  for (const [a, b] of [[300, 335], [0, 1], [545, 610], [1, 1439], [600, 725]]) {
    assert.strictEqual(s.span(a, b), ((b - a) / 60) * 40, `${a}-${b}`);
    assert.strictEqual(s.yOf(a), (a / 60) * 40);
  }
  assert.strictEqual(s.span(300, 330) - 2, 18);
});

test('a stretched scale spans the difference of its two ys', () => {
  const heights = h.plainHeights();
  heights[9] = 100;
  const s = h.hourScale(heights);
  assert.strictEqual(s.span(540, 660), 100 + 40);
});
