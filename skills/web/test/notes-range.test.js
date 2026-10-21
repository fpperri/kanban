const { test } = require('node:test');
const assert = require('node:assert');
const n = require('../web/notes');

// The rules of the palette's date, card picker and date range (notes.js), apart from the DOM. Week
// starts are the Calendar's (calendar-model.js: Monday). 2026-10-21 is a Wednesday.

const KNOWN = { board: 'plan', isTarget: (id) => ['7', '22', '3', 'G3'].includes(id) };
const CTX = { today: '2026-10-21', now: '16:40', lastNoted: '7' };
const field = (value, untimed = false, day = '') => ({ value, untimed, day });
const plan = (raw, subject, f = field('09:00')) => n.noteWritePlan(n.noteParseLine(raw, KNOWN), subject, f, CTX);
const none = { kind: 'none', day: CTX.today };

// --- the date field ---------------------------------------------------------------------------

test('the date field reads YYYY-MM-DD and nothing else, and a day the calendar lacks is no day', () => {
  assert.strictEqual(n.noteFieldDay('2026-10-21'), '2026-10-21');
  assert.strictEqual(n.noteFieldDay(' 2026-10-21 '), '2026-10-21');
  assert.strictEqual(n.noteFieldDay('2026-02-29'), null);
  assert.strictEqual(n.noteFieldDay('2024-02-29'), '2024-02-29');
  for (const bad of ['', '21/10/2026', '2026-1-5', '2026-13-01', '2026-10-32', 'today', '2026-10-21T10:00']) assert.strictEqual(n.noteFieldDay(bad), null, JSON.stringify(bad));
});

test('the note is written to the day in the date field, else to the subject\'s own day', () => {
  assert.strictEqual(plan('x', none, field('09:00', false, '2026-10-19')).day, '2026-10-19');
  assert.strictEqual(plan('x', none, field('09:00', false, '')).day, '2026-10-21');
  assert.strictEqual(plan('x', { kind: 'slot', day: '2026-10-14', at: '08:00' }, field('08:00', false, '')).day, '2026-10-14', 'an hour slot\'s day when the field is blank');
  assert.strictEqual(plan('x', { kind: 'slot', day: '2026-10-14', at: '08:00' }, field('08:00', false, '2026-10-15')).day, '2026-10-15', 'and the field wins when it says otherwise');
  assert.strictEqual(plan('x', none, { value: '09:00', untimed: false }).day, '2026-10-21', 'a field with no date at all is the subject\'s day');
});

test('the untimed tick drops the time and keeps the day', () => {
  const p = plan('x', none, field('09:00', true, '2026-10-19'));
  assert.deepStrictEqual([p.at, p.day], [null, '2026-10-19']);
  const q = plan('- x', none, field('09:00', false, '2026-10-19'));
  assert.deepStrictEqual([q.at, q.day], [null, '2026-10-19']);
});

test('a leading time in the line still sets the time, and the day stays the field\'s', () => {
  const p = plan('10:30 x', none, field('09:00', false, '2026-10-19'));
  assert.deepStrictEqual([p.at, p.day], ['10:30', '2026-10-19']);
});

test('a date that is not a date is said and not written', () => {
  const p = plan('x', none, field('09:00', false, '19/10'));
  assert.match(p.bad, /19\/10 is not a date; a date reads YYYY-MM-DD\./);
  assert.strictEqual(n.notePreview(p, { label: () => 'x', dayName: (d) => d, today: CTX.today }), p.bad);
});

test('the preview names the day when it is not today', () => {
  const o = { label: (id) => (id ? `#${id} Port` : 'no card'), dayName: n.noteDayName, today: CTX.today };
  const card = { kind: 'card', id: '7', day: CTX.today };
  assert.strictEqual(n.notePreview(plan('x', card, field('09:00', false, '2026-10-19')), o), 'Note at 09:00, Mon 19, on #7 Port');
  assert.strictEqual(n.notePreview(plan('x', card, field('09:00', false, '2026-10-21')), o), 'Note at 09:00 on #7 Port');
});

// --- the card picker -------------------------------------------------------------------------------

test('the picker shows the subject\'s target: a card or group, several cards by count, no card, else the card last noted', () => {
  assert.deepStrictEqual(n.noteSubjectTarget({ kind: 'card', id: '7', day: CTX.today }, '22'), { id: '7' });
  assert.deepStrictEqual(n.noteSubjectTarget({ kind: 'group', id: 'G3', day: CTX.today }, '22'), { id: 'G3' });
  assert.deepStrictEqual(n.noteSubjectTarget({ kind: 'each', ids: ['3', '7'], day: CTX.today }, '22'), { each: 2 });
  assert.deepStrictEqual(n.noteSubjectTarget(none, '22'), { id: '22' }, 'what Enter would write on');
  assert.deepStrictEqual(n.noteSubjectTarget(none, ''), { id: '' });
  assert.deepStrictEqual(n.noteSubjectTarget({ kind: 'none', day: CTX.today, noCard: true }, '22'), { id: '' });
});

test('choosing no card makes a note about nothing, whatever card was last noted', () => {
  const chosen = n.noteSubjectNoCard({ kind: 'card', id: '7', day: '2026-10-16' });
  assert.deepStrictEqual(chosen, { kind: 'none', day: '2026-10-16', noCard: true });
  const p = plan('x', chosen);
  assert.deepStrictEqual([p.target, p.from], ['', 'nocard']);
  assert.strictEqual(plan('x', none).target, '7', 'without the choice it is the card last noted');
});

test('choosing no card keeps the hour or the untimed box the palette was opened on', () => {
  const slot = { kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600, at: '09:00' };
  assert.deepStrictEqual(n.noteSubjectNoCard(slot), { ...slot, noCard: true });
  const aimed = n.noteSubjectAimed(slot, '22');
  assert.deepStrictEqual(n.noteSubjectNoCard(aimed), { ...slot, noCard: true }, 'from a card aimed at from a slot, back to the slot with no card');
  assert.strictEqual(n.noteSubjectNoCard({ kind: 'untimed', day: '2026-10-14' }).kind, 'untimed');
  assert.strictEqual(n.noteSubjectNoCard({ kind: 'each', ids: ['3', '7'], day: CTX.today }).kind, 'none');
});

test('a mention typed at the start of the note wins over the picker', () => {
  const p = plan('#22 from the line', { kind: 'none', day: CTX.today, noCard: true });
  assert.deepStrictEqual([p.target, p.from], ['22', 'line']);
  const q = plan('#22 x', { kind: 'card', id: '7', day: CTX.today });
  assert.deepStrictEqual([q.target, q.from], ['22', 'line']);
});

test('the preview says no card when the note is about nothing', () => {
  const o = { label: (id) => (id ? `#${id}` : 'no card'), dayName: n.noteDayName, today: CTX.today };
  assert.strictEqual(n.notePreview(plan('x', { kind: 'none', day: CTX.today, noCard: true }), o), 'Note at 09:00 on no card');
});

test('on several cards, choosing one makes it a single target, as a bare mention does', () => {
  const each = { kind: 'each', ids: ['3', '7'], day: CTX.today };
  assert.deepStrictEqual(n.noteSubjectAimed(each, '22'), { kind: 'card', id: '22', day: CTX.today });
  assert.deepStrictEqual(plan('x', each).targets, ['3', '7']);
  assert.strictEqual(plan('x', n.noteSubjectAimed(each, '22')).targets, null);
});

// --- the range --------------------------------------------------------------------------------------

test('the range modes are the Calendar\'s, with All first', () => {
  assert.deepStrictEqual(n.NOTE_RANGE_MODES, ['all', 'month', 'week', '3day', 'day']);
});

test('a day, 3 days, a week and a month are the days they span, the week starting on a Monday', () => {
  assert.deepStrictEqual(n.noteRangeBounds('day', '2026-10-21'), { from: '2026-10-21', to: '2026-10-21' });
  assert.deepStrictEqual(n.noteRangeBounds('3day', '2026-10-21'), { from: '2026-10-21', to: '2026-10-23' }, 'the anchor and the next two, as the Calendar\'s');
  assert.deepStrictEqual(n.noteRangeBounds('week', '2026-10-21'), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepStrictEqual(n.noteRangeBounds('week', '2026-10-25'), { from: '2026-10-19', to: '2026-10-25' }, 'Sunday ends the week');
  assert.deepStrictEqual(n.noteRangeBounds('week', '2026-10-19'), { from: '2026-10-19', to: '2026-10-25' }, 'Monday starts it');
  assert.deepStrictEqual(n.noteRangeBounds('month', '2026-10-21'), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepStrictEqual(n.noteRangeBounds('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepStrictEqual(n.noteRangeBounds('month', '2028-02-10'), { from: '2028-02-01', to: '2028-02-29' });
});

test('All has no bounds', () => {
  assert.strictEqual(n.noteRangeBounds('all', '2026-10-21'), null);
});

test('the previous and next buttons step one unit, and All has nowhere to step', () => {
  assert.strictEqual(n.noteRangeStep('day', '2026-10-21', 1), '2026-10-22');
  assert.strictEqual(n.noteRangeStep('day', '2026-10-21', -1), '2026-10-20');
  assert.strictEqual(n.noteRangeStep('3day', '2026-10-21', 1), '2026-10-24');
  assert.strictEqual(n.noteRangeStep('week', '2026-10-21', 1), '2026-10-28');
  assert.strictEqual(n.noteRangeStep('week', '2026-10-21', -1), '2026-10-14');
  assert.strictEqual(n.noteRangeStep('month', '2026-10-21', 1), '2026-11-01');
  assert.strictEqual(n.noteRangeStep('month', '2026-01-31', 1), '2026-02-01', 'a 31st does not skip a short month');
  assert.strictEqual(n.noteRangeStep('month', '2026-01-15', -1), '2025-12-01');
  assert.strictEqual(n.noteRangeStep('all', '2026-10-21', 1), '2026-10-21');
});

test('the label names the range: a day, a span of days, a month, or all', () => {
  assert.strictEqual(n.noteRangeLabel('day', '2026-10-21'), 'Wed 21 Oct');
  assert.strictEqual(n.noteRangeLabel('week', '2026-10-21'), '19–25 Oct');
  assert.strictEqual(n.noteRangeLabel('3day', '2026-10-21'), '21–23 Oct');
  assert.strictEqual(n.noteRangeLabel('month', '2026-10-21'), 'October 2026');
  assert.strictEqual(n.noteRangeLabel('all', '2026-10-21'), 'All dates');
});

test('the label of a span over a month or a year end names both', () => {
  assert.strictEqual(n.noteRangeLabel('week', '2026-10-29'), '26 Oct – 1 Nov');
  assert.strictEqual(n.noteRangeLabel('3day', '2026-12-30'), '30 Dec 2026 – 1 Jan 2027');
  assert.strictEqual(n.noteRangeLabel('week', '2026-12-31'), '28 Dec 2026 – 3 Jan 2027');
});

test('notes in a range are those whose day is in it, the ends included', () => {
  const note = (day) => ({ day, target: '7', at: '09:00', by: '@human', note: day, index: 0 });
  const all = ['2026-10-18', '2026-10-19', '2026-10-22', '2026-10-25', '2026-10-26'].map(note);
  const days = (bounds) => n.noteInRange(all, bounds).map((x) => x.day);
  assert.deepStrictEqual(days({ from: '2026-10-19', to: '2026-10-25' }), ['2026-10-19', '2026-10-22', '2026-10-25']);
  assert.deepStrictEqual(days(null), all.map((x) => x.day), 'no bounds is every note');
});

// --- what the range opens on ---------------------------------------------------------------------------

test('a card, a group or several cards open on All, so a card\'s history stays', () => {
  for (const sub of [{ kind: 'card', id: '7', day: CTX.today }, { kind: 'group', id: 'G3', day: CTX.today }, { kind: 'each', ids: ['3', '7'], day: CTX.today }]) {
    assert.deepStrictEqual(n.noteRangeFor(sub, null, CTX.today), { mode: 'all', anchor: CTX.today }, sub.kind);
  }
});

test('a card opened from another day\'s hour keeps that day as the place Day, Week and Month start from', () => {
  assert.deepStrictEqual(n.noteRangeFor({ kind: 'card', id: '7', day: '2026-10-15', at: '09:30' }, null, CTX.today), { mode: 'all', anchor: '2026-10-15' });
});

test('n with no card opens on Day, today', () => {
  assert.deepStrictEqual(n.noteRangeFor(none, null, CTX.today), { mode: 'day', anchor: CTX.today });
  assert.deepStrictEqual(n.noteRangeFor(none, {}, CTX.today), { mode: 'day', anchor: CTX.today });
});

test('n on the Calendar opens on the Calendar\'s own mode and range', () => {
  for (const mode of ['month', 'week', '3day', 'day']) {
    assert.deepStrictEqual(n.noteRangeFor(none, { range: { mode, anchor: '2026-10-14' } }, CTX.today), { mode, anchor: '2026-10-14' }, mode);
  }
});

test('an hour slot or the untimed box opens on Day, that day', () => {
  assert.deepStrictEqual(n.noteRangeFor({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600, at: '09:00' }, null, CTX.today), { mode: 'day', anchor: '2026-10-14' });
  assert.deepStrictEqual(n.noteRangeFor({ kind: 'untimed', day: '2026-10-14' }, null, CTX.today), { mode: 'day', anchor: '2026-10-14' });
});

test('a range request that is not one is ignored', () => {
  for (const range of [{ mode: 'year', anchor: '2026-10-14' }, { mode: 'week', anchor: 'soon' }, { mode: 'week' }, null, 'week']) {
    assert.deepStrictEqual(n.noteRangeFor(none, { range }, CTX.today), { mode: 'day', anchor: CTX.today }, JSON.stringify(range));
  }
});

// --- what the list shows -------------------------------------------------------------------------------

const note = (day, target, at, text) => ({ day, target, at, by: '@human', note: text, index: 0, file: 'f' });
const ALL = [
  note('2026-10-14', '7', '09:10', 'a'), note('2026-10-19', '7', '10:00', 'b'), note('2026-10-21', '22', '09:40', 'c'),
  note('2026-10-21', '', null, 'd'), note('2026-10-22', '7', '10:20', 'e'), note('2026-10-30', '7', '08:00', 'f'),
];
const listed = (sub, range) => n.noteListNotes(ALL, sub, range, {}).map((x) => x.note);
const card7 = { kind: 'card', id: '7', day: CTX.today };

test('a card on All lists every one of its notes from every day, as it always did', () => {
  assert.deepStrictEqual(listed(card7, { mode: 'all', anchor: CTX.today, touched: false }), ['a', 'b', 'e', 'f']);
});

test('a card on Week lists that card\'s notes from that week only', () => {
  assert.deepStrictEqual(listed(card7, { mode: 'week', anchor: CTX.today, touched: true }), ['b', 'e']);
  assert.deepStrictEqual(listed(card7, { mode: 'day', anchor: '2026-10-22', touched: true }), ['e']);
  assert.deepStrictEqual(listed(card7, { mode: 'month', anchor: '2026-10-01', touched: true }), ['a', 'b', 'e', 'f']);
  assert.deepStrictEqual(listed(card7, { mode: 'month', anchor: '2026-11-01', touched: true }), []);
});

test('with no card, All is every note on the board and a range is every note in it', () => {
  assert.deepStrictEqual(listed(none, { mode: 'all', anchor: CTX.today, touched: true }), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepStrictEqual(listed(none, { mode: 'week', anchor: CTX.today, touched: false }), ['b', 'c', 'd', 'e'], 'the week n opened on the Calendar lists the week, whatever cards they are on');
  assert.deepStrictEqual(listed(none, { mode: 'day', anchor: CTX.today, touched: false }), ['c', 'd'], 'Day, today is what n lists today');
});

test('an hour slot lists that slot until the range is changed, then the rest of the range', () => {
  const slot = { kind: 'slot', day: CTX.today, fromMin: 540, toMin: 600, at: '09:00' };
  assert.deepStrictEqual(listed(slot, { mode: 'day', anchor: CTX.today, touched: false }), ['c']);
  assert.deepStrictEqual(listed(slot, { mode: 'day', anchor: CTX.today, touched: true }), ['c', 'd'], 'the day\'s other notes');
  assert.deepStrictEqual(listed(slot, { mode: 'week', anchor: CTX.today, touched: true }), ['b', 'c', 'd', 'e']);
  assert.deepStrictEqual(listed(slot, { mode: 'all', anchor: CTX.today, touched: true }), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('the untimed box lists that day\'s untimed notes until the range is changed, then the rest', () => {
  const untimed = { kind: 'untimed', day: CTX.today };
  assert.deepStrictEqual(listed(untimed, { mode: 'day', anchor: CTX.today, touched: false }), ['d']);
  assert.deepStrictEqual(listed(untimed, { mode: 'day', anchor: CTX.today, touched: true }), ['c', 'd']);
});

test('a group lists its own and its members\' notes in the range', () => {
  const group = { kind: 'group', id: 'G3', day: CTX.today };
  const out = n.noteListNotes(ALL, group, { mode: 'week', anchor: CTX.today, touched: true }, { members: () => ['22'] }).map((x) => x.note);
  assert.deepStrictEqual(out, ['c']);
});
