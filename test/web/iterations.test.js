const { test } = require('node:test');
const assert = require('node:assert');
const it = require('../web/iterations');

const mk = (id, name, folder, start, end, cards = []) => ({ id, name, folder, start_date: start, end_date: end, auto_join: true, cards, extra: {}, file: '' });
const I1 = mk('I1', 'zephyr-1', 'iteration', '2026-09-28', '2026-10-09', ['2', '5']);
const I2 = mk('I2', 'zephyr-2', 'iteration', '2026-10-12', '2026-10-23', ['3', '7', '15']);
const I3 = mk('I3', 'later', 'iteration', '2026-11-02', '2026-11-13', ['9']);
const UNDATED = mk('I4', 'someday', 'iteration', '', '', ['1']);
const WORKFLOW = mk('W1', 'orders-cutover', 'workflow', '2026-10-12', '2026-10-23', ['7']);
const SUB = mk('I9', 'deep', 'iteration/sprint', '2026-10-12', '2026-10-23', ['7']);
const ALL = [I1, WORKFLOW, I2, SUB, UNDATED, I3];

test('the iterations are the groups in the iteration folder itself, newest start first, undated last', () => {
  assert.deepStrictEqual(it.iterationList(ALL).map((g) => g.id), ['I3', 'I2', 'I1', 'I4']);
  assert.deepStrictEqual(it.iterationList([]), []);
  assert.deepStrictEqual(it.iterationList(null), []);
});

test('iterationGroups is the one filter: the groups in the iteration folder itself, in the order given', () => {
  assert.deepStrictEqual(it.iterationGroups(ALL).map((g) => g.id), ['I1', 'I2', 'I4', 'I3']);
  assert.deepStrictEqual(it.iterationGroups(null), []);
});

test('two iterations that start the same day come in id order, highest first', () => {
  const a = mk('I5', 'a', 'iteration', '2026-10-12', '2026-10-13');
  const b = mk('I10', 'b', 'iteration', '2026-10-12', '2026-10-13');
  assert.deepStrictEqual(it.iterationList([a, b]).map((g) => g.id), ['I10', 'I5']);
});

test('the running iteration is the newest one running on the day, both end days included', () => {
  assert.strictEqual(it.iterationRunning(ALL, '2026-10-12').id, 'I2');
  assert.strictEqual(it.iterationRunning(ALL, '2026-10-23').id, 'I2');
  assert.strictEqual(it.iterationRunning(ALL, '2026-10-24'), null);
  assert.strictEqual(it.iterationRunning([WORKFLOW], '2026-10-12'), null, 'a workflow is not an iteration');
  const overlap = mk('I6', 'overlap', 'iteration', '2026-10-20', '2026-10-30');
  assert.strictEqual(it.iterationRunning([I2, overlap], '2026-10-21').id, 'I6');
});

test('an option reads the id, the name, the dates and whether it runs', () => {
  assert.strictEqual(it.iterationLabel(I2, '2026-10-15'), '#I2 zephyr-2 · 2026-10-12 to 2026-10-23 · running');
  assert.strictEqual(it.iterationLabel(I1, '2026-10-15'), '#I1 zephyr-1 · 2026-09-28 to 2026-10-09');
  assert.strictEqual(it.iterationLabel(UNDATED, '2026-10-15'), '#I4 someday');
  assert.strictEqual(it.iterationLabel(mk('I7', 'half', 'iteration', '2026-10-12', ''), '2026-10-15'), '#I7 half · from 2026-10-12');
});

test('the dropdown opens on the running iteration, or All cards when none runs', () => {
  assert.strictEqual(it.iterationPick(null, ALL, '2026-10-15'), 'I2');
  assert.strictEqual(it.iterationPick(null, ALL, '2026-10-25'), '');
  assert.strictEqual(it.iterationPick(null, [], '2026-10-15'), '');
});

test('a choice kept in this browser wins, All cards included, while the iteration still exists', () => {
  assert.strictEqual(it.iterationPick({ pick: 'I1' }, ALL, '2026-10-15'), 'I1');
  assert.strictEqual(it.iterationPick({ pick: '' }, ALL, '2026-10-15'), '');
  assert.strictEqual(it.iterationPick({ pick: 'I77' }, ALL, '2026-10-15'), 'I2', 'a gone iteration falls back to the default');
  assert.strictEqual(it.iterationPick({ pick: 'W1' }, ALL, '2026-10-15'), 'I2', 'a workflow is not an iteration');
});

test('a kept choice yields to the running iteration once the iteration it was kept under has ended', () => {
  assert.strictEqual(it.iterationPick({ pick: 'I1', under: 'I2' }, ALL, '2026-10-15'), 'I1', 'kept under I2, which still runs');
  assert.strictEqual(it.iterationPick({ pick: 'I1', under: 'I2' }, ALL, '2026-10-23'), 'I1', 'the last day of I2 still counts');
  assert.strictEqual(it.iterationPick({ pick: 'I1', under: 'I2' }, ALL, '2026-10-25'), '', 'I2 ended and none runs: the default is All cards');
  assert.strictEqual(it.iterationPick({ pick: 'I1', under: 'I2' }, ALL, '2026-11-03'), 'I3', 'I2 ended and I3 runs: the running one');
  assert.strictEqual(it.iterationPick({ pick: '', under: 'I2' }, ALL, '2026-10-15'), '', 'All cards kept under I2 holds while I2 runs');
  assert.strictEqual(it.iterationPick({ pick: '', under: 'I2' }, ALL, '2026-11-03'), 'I3', 'a kept All cards yields the same way');
  assert.strictEqual(it.iterationPick({ pick: 'I1', under: 'I77' }, ALL, '2026-10-15'), 'I2', 'an iteration it was kept under that is gone has ended');
});

test('a choice kept while no iteration ran has nothing to end and holds; one kept before this rule has no under and holds', () => {
  assert.strictEqual(it.iterationPick({ pick: 'I1', under: '' }, ALL, '2026-11-03'), 'I1');
  assert.strictEqual(it.iterationPick({ pick: '', under: '' }, ALL, '2026-11-03'), '');
  assert.strictEqual(it.iterationPick({ pick: 'I1' }, ALL, '2026-11-03'), 'I1');
});

test('the saved choice is read tolerantly and written as one small JSON entry', () => {
  assert.deepStrictEqual(it.iterationChoiceRead('{"pick":"I2"}'), { pick: 'I2', under: '' });
  assert.deepStrictEqual(it.iterationChoiceRead('{"pick":""}'), { pick: '', under: '' });
  assert.deepStrictEqual(it.iterationChoiceRead('{"pick":"I1","under":"I2"}'), { pick: 'I1', under: 'I2' });
  assert.deepStrictEqual(it.iterationChoiceRead('{"pick":"I1","under":7}'), { pick: 'I1', under: '' }, 'an under that is not an id reads as none');
  assert.deepStrictEqual(it.iterationChoiceRead('{"pick":"I1","under":"x y"}'), { pick: 'I1', under: '' });
  for (const bad of [null, undefined, '', 'nope', '{"pick":3}', '{}', '[]', 'null', '{"pick":"x y"}']) assert.strictEqual(it.iterationChoiceRead(bad), null, String(bad));
  assert.strictEqual(it.iterationChoiceWrite('I2', 'I2'), '{"pick":"I2","under":"I2"}');
  assert.strictEqual(it.iterationChoiceWrite('', 'I2'), '{"pick":"","under":"I2"}');
  assert.strictEqual(it.iterationChoiceWrite('I2'), '{"pick":"I2","under":""}');
});

test('a picked iteration cuts the views to the cards it lists; All cards cuts nothing', () => {
  assert.deepStrictEqual([...it.iterationCut(ALL, 'I2')].sort(), ['15', '3', '7']);
  assert.strictEqual(it.iterationCut(ALL, ''), null);
  assert.strictEqual(it.iterationCut(ALL, 'I77'), null, 'a gone iteration cuts nothing');
  assert.strictEqual(it.iterationCut(ALL, 'W1'), null, 'a workflow is not an iteration');
  assert.deepStrictEqual([...it.iterationCut([mk('I8', 'x', 'iteration', '', '', ['G3'])], 'I8')], ['G3']);
});

test('a new iteration bumps the name, continues the dates at the same length and joins on its own', () => {
  assert.deepStrictEqual(it.iterationNextDraft(ALL, '2026-10-15'), {
    folder: 'iteration', name: '', start_date: '2026-11-14', end_date: '2026-11-25', auto_join: true,
  }, 'continues the newest iteration, whose name has no number');
  assert.deepStrictEqual(it.iterationNextDraft([I1, I2], '2026-10-15'), {
    folder: 'iteration', name: 'zephyr-3', start_date: '2026-10-24', end_date: '2026-11-04', auto_join: true,
  });
});

test('the bumped name keeps the width of a zero-padded number and carries over 9', () => {
  const draft = (name) => it.iterationNextDraft([mk('I1', name, 'iteration', '2026-10-01', '2026-10-07')], '2026-10-01').name;
  assert.strictEqual(draft('zephyr-9'), 'zephyr-10');
  assert.strictEqual(draft('zephyr-007'), 'zephyr-008');
  assert.strictEqual(draft('zephyr-099'), 'zephyr-100');
  assert.strictEqual(draft('sprint'), '');
});

test('the dates continue over a month end and a leap day, keeping the length', () => {
  const next = (s, e) => it.iterationNextDraft([mk('I1', 'x-1', 'iteration', s, e)], '2026-01-01');
  assert.deepStrictEqual([next('2028-02-20', '2028-02-28').start_date, next('2028-02-20', '2028-02-28').end_date], ['2028-02-29', '2028-03-08']);
  assert.deepStrictEqual([next('2026-12-28', '2026-12-31').start_date, next('2026-12-28', '2026-12-31').end_date], ['2027-01-01', '2027-01-04']);
  assert.deepStrictEqual([next('2026-10-12', '2026-10-12').start_date, next('2026-10-12', '2026-10-12').end_date], ['2026-10-13', '2026-10-13']);
});

test('with no iteration before it, or an undated one, the draft starts today with no end', () => {
  assert.deepStrictEqual(it.iterationNextDraft([], '2026-10-15'), { folder: 'iteration', name: '', start_date: '2026-10-15', end_date: '', auto_join: true });
  const undated = it.iterationNextDraft([mk('I1', 'zephyr-1', 'iteration', '', '')], '2026-10-15');
  assert.deepStrictEqual(undated, { folder: 'iteration', name: 'zephyr-2', start_date: '2026-10-15', end_date: '', auto_join: true });
});

test('the Calendar shades the iteration\'s days and opens on its first day', () => {
  assert.deepStrictEqual(it.iterationSpan(I2), { start: '2026-10-12', end: '2026-10-23' });
  assert.strictEqual(it.iterationSpan(UNDATED), null);
  assert.strictEqual(it.iterationSpan(mk('I7', 'half', 'iteration', '2026-10-12', '')), null, 'one date is not a span');
  assert.strictEqual(it.iterationSpan(null), null);
  assert.strictEqual(it.iterationShades({ start: '2026-10-12', end: '2026-10-23' }, '2026-10-12'), true);
  assert.strictEqual(it.iterationShades({ start: '2026-10-12', end: '2026-10-23' }, '2026-10-23'), true);
  assert.strictEqual(it.iterationShades({ start: '2026-10-12', end: '2026-10-23' }, '2026-10-24'), false);
  assert.strictEqual(it.iterationShades(null, '2026-10-24'), false);
});
