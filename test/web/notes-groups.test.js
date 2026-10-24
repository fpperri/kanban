const { test } = require('node:test');
const assert = require('node:assert');
const n = require('../web/notes');

// The notes palette's rules for a note on a group, and on several cards at once (the
// question the right-click Add note... asks of a selection). The cards are 3, 7 and 15,
// the group I2 lists 3 and 7, and the board is called plan.

const KNOWN = { board: 'plan', isTarget: (id) => ['3', '7', '15', 'I2'].includes(id) };
const CTX = { today: '2026-10-16', now: '16:40', lastNoted: '7' };
const field = (value, untimed = false) => ({ value, untimed });
const label = (id) => ({ 3: '#3 Write the cutover plan', 7: '#7 Port the zephyr schema', 15: '#15 Fix the invoice rounding', I2: '#I2 zephyr-2', '': 'no card' }[id]);
const prevOf = (plan) => n.notePreview(plan, { label, dayName: (d) => `Day ${d.slice(8)}`, today: CTX.today });

test('a group is a subject of its own, and a mention of it aims a note at it', () => {
  const is = { today: CTX.today, isGroup: (id) => id === 'I2' };
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'group', gid: 'I2' }, is), { kind: 'group', id: 'I2', day: CTX.today, clockDay: true });
  assert.deepStrictEqual(n.noteSubjectFrom({ target: 'I2' }, is), { kind: 'group', id: 'I2', day: CTX.today, clockDay: true });
  const parsed = n.noteParseLine('#I2 mid-iteration check', KNOWN);
  assert.deepStrictEqual([parsed.mention, parsed.text], ['I2', 'mid-iteration check']);
});

test('a scratchpad request aims the palette at a card or a group, and at nothing for a target that is no id', () => {
  const is = { today: CTX.today, isGroup: (id) => id === 'I2' };
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'scratchpad', target: '7' }, is), { kind: 'card', id: '7', day: CTX.today, clockDay: true });
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'scratchpad', target: 'I2' }, is), { kind: 'group', id: 'I2', day: CTX.today, clockDay: true });
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'scratchpad', target: 'nope' }, is), { kind: 'none', day: CTX.today, clockDay: true });
});

test('the tabs a subject has: Notes with a logbook, Group for a group, Scratchpad for a card or group with the scratchpad on', () => {
  const on = { notesOn: true, scratchpadOn: true };
  const card = { kind: 'card', id: '7' };
  const group = { kind: 'group', id: 'I2' };
  assert.deepStrictEqual(n.noteTabs(card, { notesOn: true, scratchpadOn: false }), ['notes']);
  assert.deepStrictEqual(n.noteTabs(card, on), ['notes', 'scratch']);
  assert.deepStrictEqual(n.noteTabs(group, on), ['notes', 'group', 'scratch']);
  assert.deepStrictEqual(n.noteTabs(group, { notesOn: false, scratchpadOn: false }), ['group']);
  assert.deepStrictEqual(n.noteTabs(group, { notesOn: false, scratchpadOn: true }), ['group', 'scratch']);
  assert.deepStrictEqual(n.noteTabs(card, { notesOn: false, scratchpadOn: true }), ['scratch'], 'a card with the logbook off still has its scratchpad');
  for (const kind of ['none', 'each', 'slot', 'untimed']) assert.deepStrictEqual(n.noteTabs({ kind }, on), ['notes'], `${kind} has no scratchpad`);
});

test('Todos is the last tab of a card or group on a board that keeps todo lists, and a card with nothing else opens on it alone (docs/adr/0021)', () => {
  const card = { kind: 'card', id: '7' };
  const group = { kind: 'group', id: 'I2' };
  const all = { notesOn: true, scratchpadOn: true, todosOn: true };
  assert.deepStrictEqual(n.noteTabs(card, all), ['notes', 'scratch', 'todos']);
  assert.deepStrictEqual(n.noteTabs(group, all), ['notes', 'group', 'scratch', 'todos']);
  assert.deepStrictEqual(n.noteTabs(card, { notesOn: true, scratchpadOn: false, todosOn: true }), ['notes', 'todos']);
  assert.deepStrictEqual(n.noteTabs(card, { notesOn: false, scratchpadOn: false, todosOn: true }), ['todos'], 'a card with the logbook off still has its todos');
  assert.deepStrictEqual(n.noteTabs(card, { notesOn: false, scratchpadOn: true, todosOn: true }), ['scratch', 'todos']);
  assert.deepStrictEqual(n.noteTabs(group, { notesOn: false, scratchpadOn: false, todosOn: true }), ['group', 'todos']);
  assert.deepStrictEqual(n.noteTabs(card, { notesOn: true, scratchpadOn: true }), ['notes', 'scratch'], 'todosOn absent = off');
  for (const kind of ['none', 'each', 'slot', 'untimed']) assert.deepStrictEqual(n.noteTabs({ kind }, all), ['notes'], `${kind} has no todos`);
});

test('a request to open the todos of a card or group aims the palette at it', () => {
  const is = { today: CTX.today, isGroup: (id) => id === 'I2' };
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'todos', target: '7' }, is), { kind: 'card', id: '7', day: CTX.today, clockDay: true });
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'todos', target: 'I2' }, is), { kind: 'group', id: 'I2', day: CTX.today, clockDay: true });
});

test('a note typed on a group\'s chip is written to the group', () => {
  const plan = n.noteWritePlan(n.noteParseLine('on track except #7', KNOWN), { kind: 'group', id: 'I2', day: CTX.today }, field('10:30'), CTX);
  assert.deepStrictEqual([plan.target, plan.from, plan.at], ['I2', 'chip', '10:30']);
  assert.strictEqual(prevOf(plan), 'Note at 10:30 on #I2 zephyr-2');
});

test('a group lists its own notes and its members\'', () => {
  const note = (target, text) => ({ day: CTX.today, target, at: '09:00', by: '@human', note: text, index: 0, file: 'f' });
  const all = [note('I2', 'own'), note('7', 'seven'), note('3', 'three'), note('15', 'fifteen'), note('', 'none')];
  const texts = (subject, o) => n.noteSubjectNotes(all, subject, o).map((x) => x.note).sort();
  assert.deepStrictEqual(texts({ kind: 'group', id: 'I2', day: CTX.today }, { members: () => ['3', '7'] }), ['own', 'seven', 'three']);
  assert.deepStrictEqual(texts({ kind: 'group', id: 'I2', day: CTX.today }), ['own'], 'with no members given it lists its own');
});

test('several cards are one subject: "each", and a request naming targets opens it', () => {
  const is = { today: CTX.today, isGroup: () => false };
  assert.deepStrictEqual(n.noteSubjectFrom({ targets: ['7', '3'] }, is), { kind: 'each', ids: ['3', '7'], day: CTX.today, clockDay: true });
  assert.deepStrictEqual(n.noteSubjectFrom({ targets: ['7', '7', 'bad'] }, is), { kind: 'card', id: '7', day: CTX.today, clockDay: true }, 'one card left is just that card');
  assert.deepStrictEqual(n.noteSubjectFrom({ targets: [] }, is), { kind: 'none', day: CTX.today, clockDay: true });
});

test('the notes of "each" are the notes of any of the cards', () => {
  const note = (target, text) => ({ day: CTX.today, target, at: '09:00', by: '@human', note: text, index: 0, file: 'f' });
  const all = [note('7', 'seven'), note('3', 'three'), note('15', 'fifteen'), note('', 'none')];
  const got = n.noteSubjectNotes(all, { kind: 'each', ids: ['3', '7'], day: CTX.today }).map((x) => x.note).sort();
  assert.deepStrictEqual(got, ['seven', 'three']);
});

test('Enter on "each" writes one note on every card, at the one time', () => {
  const subject = { kind: 'each', ids: ['3', '7', '15'], day: CTX.today };
  const plan = n.noteWritePlan(n.noteParseLine('standup moved', KNOWN), subject, field('10:30'), CTX);
  assert.deepStrictEqual([plan.targets, plan.target, plan.from, plan.at, plan.text], [['3', '7', '15'], '', 'each', '10:30', 'standup moved']);
  assert.strictEqual(prevOf(plan), 'Note at 10:30 on each of 3 cards (#3, #7, #15)');
  const untimed = n.noteWritePlan(n.noteParseLine('- later', KNOWN), subject, field(''), CTX);
  assert.strictEqual(prevOf(untimed), 'Untimed note on each of 3 cards (#3, #7, #15)');
});

test('a mention at the start of the line beats "each": that one note goes on that card', () => {
  const subject = { kind: 'each', ids: ['3', '7'], day: CTX.today };
  const plan = n.noteWritePlan(n.noteParseLine('#15 only this one', KNOWN), subject, field('10:30'), CTX);
  assert.deepStrictEqual([plan.targets, plan.target, plan.from], [null, '15', 'line']);
  assert.strictEqual(prevOf(plan), 'Note at 10:30 on #15 Fix the invoice rounding');
});

test('a long run of cards is cut short in the preview', () => {
  const ids = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const plan = n.noteWritePlan(n.noteParseLine('x', KNOWN), { kind: 'each', ids, day: CTX.today }, field('10:30'), CTX);
  assert.strictEqual(prevOf(plan), 'Note at 10:30 on each of 8 cards (#1, #2, #3, #4, #5, #6, …)');
});

test('clearing the chip of "each" goes back to nothing', () => {
  assert.deepStrictEqual(n.noteSubjectCleared({ kind: 'each', ids: ['3', '7'], day: CTX.today }, CTX.today), { kind: 'none', day: CTX.today, clockDay: true });
});
