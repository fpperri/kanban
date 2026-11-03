const { test } = require('node:test');
const assert = require('node:assert');
const d = require('../../plugin/skills/web/web/durations');

// A note's duration (docs/adr/0016, the logbook): the one reader and writer of a length of work that
// the logbook store, the notes palette and the tray share.

test('a length reads in every form an agent or a person writes it', () => {
  for (const [text, minutes] of [
    ['45m', 45], ['1h', 60], ['1h30m', 90], ['1h30', 90], ['90m', 90],
    ['100m', 100], ['1h40', 100], ['1h40m', 100], ['2h5m', 125], ['4h', 240], ['24h', 1440],
    [' 45m ', 45], ['1H30M', 90], ['0m', 0],
  ]) assert.strictEqual(d.parseDuration(text), minutes, text);
});

test('anything else is not a length', () => {
  for (const text of ['', '45', 'm', 'h', '1h60', '1h60m', '1h 30m', '1.5h', '-45m', '45 m', 'an hour', '10:30', '1d', null, undefined, 45]) {
    assert.strictEqual(d.parseDuration(text), null, String(text));
  }
});

test('a line that starts with a length gives it, its minutes and the rest of the line; one shaped like a length that is none gives no minutes', () => {
  assert.deepStrictEqual(d.leadingDuration('45m schema review'), { text: '45m', minutes: 45, rest: 'schema review' });
  assert.deepStrictEqual(d.leadingDuration('1H30  x'), { text: '1H30', minutes: 90, rest: 'x' });
  assert.deepStrictEqual(d.leadingDuration('2h'), { text: '2h', minutes: 120, rest: '' });
  assert.deepStrictEqual(d.leadingDuration('1h60 x'), { text: '1h60', minutes: null, rest: 'x' });
  for (const line of ['45mins x', 'schema 45m', '45 m', '', '10:30 x']) assert.strictEqual(d.leadingDuration(line), null, line);
});

test('a length is written in one form: hours then minutes, unpadded, a part that is nothing left out', () => {
  for (const [minutes, text] of [[1, '1m'], [45, '45m'], [60, '1h'], [90, '1h30m'], [125, '2h5m'], [240, '4h'], [1440, '24h']]) {
    assert.strictEqual(d.formatDuration(minutes), text, String(minutes));
  }
  for (const text of ['90m', '1h30', '1H30M']) assert.strictEqual(d.formatDuration(d.parseDuration(text)), '1h30m', text);
});

test('a duration is at least a minute; with a time it ends by 24:00, without one it is at most 24h', () => {
  for (const [minutes, at] of [[1, null], [45, '10:30'], [60, '23:00'], [1, '23:59'], [1440, '00:00'], [1440, null]]) {
    assert.strictEqual(d.durationProblem(minutes, at), '', `${minutes} at ${at}`);
  }
  assert.strictEqual(d.durationProblem(0, null), 'A duration is at least 1 minute.');
  assert.strictEqual(d.durationProblem(0, '10:30'), 'A duration is at least 1 minute.');
  assert.strictEqual(d.durationProblem(60, '23:30'), 'A note with a time ends by 24:00; 23:30 plus 1h does not.');
  assert.strictEqual(d.durationProblem(1441, null), 'A duration with no time is at most 24h.');
});

test('a range reads from its start to its end with an en dash, midnight as 24:00', () => {
  assert.strictEqual(d.durationRange('10:30', 45), '10:30–11:15');
  assert.strictEqual(d.durationRange('09:05', 125), '09:05–11:10');
  assert.strictEqual(d.durationRange('23:00', 60), '23:00–24:00');
});

test('a range\'s end is its start plus its duration, never wrapped round to the morning', () => {
  assert.strictEqual(d.durationRange('23:30', 60), '23:30–24:30');
  assert.strictEqual(d.durationRange('00:00', 1440), '00:00–24:00');
});
