const { test } = require('node:test');
const assert = require('node:assert');
const n = require('../web/notes');

const KNOWN = { board: 'plan', isTarget: (id) => ['7', '22', 'G3'].includes(id) };
const IS = { today: '2026-10-16', isGroup: (id) => id === 'G3' };
const field = (value = '', untimed = false, day = '') => ({ value, untimed, day });
const plan = (raw, subject, f, ctx) => n.noteWritePlan(n.noteParseLine(raw, KNOWN), subject, f, ctx);
const at = (today, now) => ({ today, now, lastNoted: '7' });

test('a subject whose day came from the clock says so; one whose day the request gave does not', () => {
  assert.strictEqual(n.noteSubjectFrom({}, IS).clockDay, true);
  assert.strictEqual(n.noteSubjectFrom({ target: '22' }, IS).clockDay, true);
  assert.strictEqual(n.noteSubjectFrom({ kind: 'card-notes', id: '7' }, IS).clockDay, true);
  assert.strictEqual(n.noteSubjectFrom({ kind: 'group', gid: 'G3' }, IS).clockDay, true);
  assert.strictEqual(n.noteSubjectFrom({ targets: ['7', '22'] }, IS).clockDay, true);
  assert.strictEqual(n.noteSubjectFrom({ targets: ['7'] }, IS).clockDay, true);
  assert.strictEqual(n.noteSubjectFrom({ targets: [] }, IS).clockDay, true);
  assert.strictEqual(n.noteSubjectFrom({ at: '09:00' }, IS).clockDay, true, 'a time alone gives no day');
  assert.strictEqual(n.noteSubjectFrom({ target: '22', day: '2026-10-14' }, IS).clockDay, undefined);
  assert.strictEqual(n.noteSubjectFrom({ targets: ['7'], day: '2026-10-14' }, IS).clockDay, undefined);
  assert.strictEqual(n.noteSubjectFrom({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 }, IS).clockDay, undefined);
  assert.strictEqual(n.noteSubjectFrom({ kind: 'untimed', day: '2026-10-14' }, IS).clockDay, undefined);
});

test('an untouched clock subject writes the day and the time of the moment of Enter', () => {
  const sub = n.noteSubjectFrom({}, IS);
  const first = plan('x', sub, field(), at('2026-10-16', '16:40'));
  assert.deepStrictEqual([first.day, first.at], ['2026-10-16', '16:40']);
  assert.strictEqual(plan('x', sub, field(), at('2026-10-16', '16:41')).at, '16:41', 'the next minute');
  const later = plan('x', sub, field(), at('2026-10-17', '00:05'));
  assert.deepStrictEqual([later.day, later.at], ['2026-10-17', '00:05'], 'the next day');
  const card = plan('x', n.noteSubjectFrom({ target: '22' }, IS), field(), at('2026-10-17', '08:00'));
  assert.deepStrictEqual([card.day, card.target], ['2026-10-17', '22']);
  const each = n.noteSubjectFrom({ targets: ['7', '22'] }, IS);
  assert.strictEqual(plan('x', each, field(), at('2026-10-17', '08:00')).day, '2026-10-17');
});

test('a day or a time the request gave stays as it was given', () => {
  const later = at('2026-10-20', '23:59');
  const result = (req) => { const p = plan('x', n.noteSubjectFrom(req, IS), field(), later); return [p.day, p.at]; };
  assert.deepStrictEqual(result({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 }), ['2026-10-14', '09:00']);
  assert.deepStrictEqual(result({ kind: 'untimed', day: '2026-10-14' }), ['2026-10-14', null]);
  assert.deepStrictEqual(result({ target: '22', day: '2026-10-14' }), ['2026-10-14', '23:59']);
  assert.deepStrictEqual(result({ target: '22', at: '09:42' }), ['2026-10-20', '09:42'], 'the time given stays, the day follows the clock');
  assert.deepStrictEqual(result({ at: '10:00' }), ['2026-10-20', '10:00']);
});

test('a day or a time the person typed stays as typed, and an untimed tick stays', () => {
  const sub = n.noteSubjectFrom({}, IS);
  const later = at('2026-10-17', '00:05');
  const typed = plan('x', sub, field('9:30', false, '2026-10-12'), later);
  assert.deepStrictEqual([typed.day, typed.at], ['2026-10-12', '09:30']);
  assert.strictEqual(plan('x', sub, field('', true), later).at, null);
  assert.strictEqual(plan('x', sub, field('9:30'), later).day, '2026-10-17', 'a time typed leaves the day on the clock');
  assert.strictEqual(plan('x', sub, field('', false, '2026-10-12'), later).at, '00:05', 'a day typed leaves the time on the clock');
  assert.strictEqual(plan('10:30 x', sub, field(), later).at, '10:30');
});

test('the clock subject stays on the clock through aiming, no-card and clearing', () => {
  const none = n.noteSubjectFrom({}, IS);
  assert.strictEqual(n.noteSubjectAimed(none, '22').clockDay, true);
  assert.strictEqual(n.noteSubjectNoCard(none).clockDay, true);
  assert.strictEqual(n.noteSubjectNoCard(n.noteSubjectAimed(none, '22')).clockDay, true);
  const cleared = n.noteSubjectCleared(n.noteSubjectFrom({ target: '22' }, IS), '2026-10-16');
  assert.deepStrictEqual(cleared, { kind: 'none', day: '2026-10-16', clockDay: true });
  const slot = n.noteSubjectFrom({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 }, IS);
  assert.strictEqual(n.noteSubjectAimed(slot, '22').clockDay, undefined);
  assert.strictEqual(n.noteSubjectNoCard(slot).clockDay, undefined);
  assert.strictEqual(n.noteSubjectCleared(n.noteSubjectAimed(slot, '22'), '2026-10-16').clockDay, undefined);
  const plus = n.noteSubjectAimed(n.noteSubjectFrom({ at: '10:00' }, IS), '22');
  assert.deepStrictEqual([plus.clockDay, plus.when.clockDay], [true, true]);
});

test('a clock subject moves to the new day, whatever the request gave stays', () => {
  const none = n.noteSubjectFrom({}, IS);
  assert.deepStrictEqual(n.noteSubjectOnDay(none, '2026-10-17'), { kind: 'none', day: '2026-10-17', clockDay: true });
  assert.strictEqual(n.noteSubjectOnDay(none, '2026-10-16'), none, 'the same day is the same subject');
  const slot = n.noteSubjectFrom({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 }, IS);
  assert.strictEqual(n.noteSubjectOnDay(slot, '2026-10-17'), slot);
  const aimed = n.noteSubjectAimed(n.noteSubjectFrom({ at: '10:00' }, IS), '22');
  const moved = n.noteSubjectOnDay(aimed, '2026-10-17');
  assert.deepStrictEqual([moved.day, moved.when.day], ['2026-10-17', '2026-10-17']);
});

test('a range opened on the clock follows it; one the request or the person set does not', () => {
  const none = n.noteSubjectFrom({}, IS);
  const range = n.noteRangeFor(none, null, '2026-10-16');
  assert.deepStrictEqual(range, { mode: 'day', anchor: '2026-10-16', clock: true });
  assert.deepStrictEqual(n.noteRangeOnDay(range, '2026-10-17'), { mode: 'day', anchor: '2026-10-17', clock: true });
  const cards = n.noteRangeFor(n.noteSubjectFrom({ target: '22' }, IS), null, '2026-10-16');
  assert.deepStrictEqual([cards.mode, cards.clock], ['all', true]);
  const asked = n.noteRangeFor(none, { range: { mode: 'week', anchor: '2026-10-12' } }, '2026-10-16');
  assert.strictEqual(asked.clock, undefined);
  assert.strictEqual(n.noteRangeOnDay(asked, '2026-10-17'), asked);
  const slot = n.noteRangeFor(n.noteSubjectFrom({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 }, IS), null, '2026-10-16');
  assert.strictEqual(slot.clock, undefined);
});
