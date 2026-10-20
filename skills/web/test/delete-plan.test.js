const { test } = require('node:test');
const assert = require('node:assert');
const { deletePlan, deleteBody, DELETE_EXTRAS } = require('../web/delete-plan');

// What the delete popup says and offers, apart from the DOM: the cards are 3, 7 and 15 (2 is
// archived), the groups I1 lists 3 and 7, I2 lists 7 and 15, and the board keeps a logbook with
// two notes on card 7 and one on group I1.

const CARDS = [{ id: '3', title: 'Three' }, { id: '7', title: 'Seven' }, { id: '15', title: 'Fifteen' }, { id: '2', title: 'Two', archived: true }];
const GROUPS = [
  { id: 'I1', name: 'zephyr-1', cards: ['3', '7'], file: '.groups/iteration/0001.zephyr-1.md' },
  { id: 'I2', name: 'zephyr-2', cards: ['7', '15', '99'], file: '.groups/iteration/0002.zephyr-2.md' },
];
const note = (target) => ({ day: '2026-10-16', target, at: '09:00', by: '@human', note: 'n', index: 0, file: 'f' });
const NOTES = [note('7'), note('7'), note('I1'), note('')];
const board = { cards: CARDS, groups: GROUPS, notes: NOTES, logbookOn: true };
const keys = (plan) => plan.options.map((o) => o.key);

test('one card: names it, says which groups lose it, offers its logbook with the count', () => {
  const plan = deletePlan({ ...board, kind: 'card', targets: ['7'] });
  assert.strictEqual(plan.title, 'Delete #7 Seven?');
  assert.deepStrictEqual(plan.lines, ['Deletes #7 Seven.', 'It comes out of every group\'s list: #I1 zephyr-1, #I2 zephyr-2.']);
  assert.deepStrictEqual(plan.options, [{ key: 'logbook', label: 'Its logbook (2 notes)' }]);
  assert.strictEqual(plan.members, null);
  assert.strictEqual(plan.hint, 'Unticked, they stay on disk.');
});

test('a card no group lists and no note names offers no logbook and says no group lists it', () => {
  const plan = deletePlan({ ...board, kind: 'card', targets: ['2'] });
  assert.deepStrictEqual(plan.lines, ['Deletes #2 Two.', 'No group lists it.']);
  assert.deepStrictEqual(plan.options, []);
});

test('several cards ask once: the count, their ids, one logbook box over all their notes', () => {
  const plan = deletePlan({ ...board, kind: 'card', targets: ['3', '7', '15'] });
  assert.strictEqual(plan.title, 'Delete 3 cards?');
  assert.deepStrictEqual(plan.chips, ['#3 Three', '#7 Seven', '#15 Fifteen']);
  assert.deepStrictEqual(plan.lines, ['They come out of every group\'s list: #I1 zephyr-1, #I2 zephyr-2.']);
  assert.deepStrictEqual(plan.options, [{ key: 'logbook', label: 'Their logbooks (2 notes)' }]);
});

test('one note reads as a note, not notes', () => {
  const plan = deletePlan({ ...board, kind: 'card', targets: ['3'], notes: [note('3')] });
  assert.strictEqual(plan.options[0].label, 'Its logbook (1 note)');
});

test('with the logbook off there is no logbook box', () => {
  assert.deepStrictEqual(deletePlan({ ...board, kind: 'card', targets: ['7'], logbookOn: false }).options, []);
});

test('a card the board no longer has is named by its id', () => {
  const plan = deletePlan({ ...board, kind: 'card', targets: ['40'] });
  assert.strictEqual(plan.title, 'Delete #40?');
});

test('a group: its file, its logbook, and its member cards listed with the ones another group holds skipped', () => {
  const plan = deletePlan({ ...board, kind: 'group', targets: ['I2'] });
  assert.strictEqual(plan.title, 'Delete group #I2 zephyr-2?');
  assert.deepStrictEqual(plan.lines, ['Deletes .groups/iteration/0002.zephyr-2.md. Its cards stay unless you tick them below.']);
  assert.deepStrictEqual(plan.options, []);
  assert.deepStrictEqual(plan.members, {
    key: 'members',
    label: 'Its member cards (2)',
    rows: [
      { id: '7', skip: true, text: 'Skips #7 Seven: also in #I1 zephyr-1' },
      { id: '15', skip: false, text: 'Deletes #15 Fifteen' },
    ],
  });
});

test('a group with notes offers its logbook; a group with no cards offers no member box', () => {
  const plan = deletePlan({ ...board, kind: 'group', targets: ['I1'], groups: [GROUPS[0], { id: 'I3', name: 'empty', cards: [], file: 'f' }] });
  assert.deepStrictEqual(plan.options, [{ key: 'logbook', label: 'Its logbook (1 note)' }]);
  assert.strictEqual(deletePlan({ ...board, kind: 'group', targets: ['I3'], groups: [GROUPS[0], { id: 'I3', name: 'empty', cards: [], file: 'f' }] }).members, null);
});

test('the request carries only the boxes ticked', () => {
  assert.deepStrictEqual(deleteBody({ logbook: true, members: false }), { logbook: true });
  assert.deepStrictEqual(deleteBody({}), {});
});

test('an extra another ticket adds joins the popup: it is one entry in the registry', () => {
  const extra = { key: 'scratchpad', count: () => 1, label: () => 'Its scratchpad' };
  DELETE_EXTRAS.push(extra);
  try {
    assert.deepStrictEqual(keys(deletePlan({ ...board, kind: 'card', targets: ['7'] })), ['logbook', 'scratchpad']);
  } finally {
    DELETE_EXTRAS.pop();
  }
});

test('the toast says what went: the card, the groups it left, the logbook files', () => {
  const { deleteSummary } = require('../web/delete-plan');
  assert.strictEqual(deleteSummary('card', ['7'], [{ groups: ['I1', 'I2'], swept: { logbook: 2 } }], []), 'Deleted #7; out of #I1, #I2; deleted 2 logbook files.');
  assert.strictEqual(deleteSummary('card', ['3'], [{ groups: [], swept: {} }], []), 'Deleted #3.');
  assert.strictEqual(deleteSummary('card', ['3', '7', '15'], [{ groups: ['I1'], swept: {} }, { groups: ['I1', 'I2'], swept: {} }], ['#15 (boom)']), 'Deleted 2 cards; out of #I1, #I2; failed: #15 (boom)');
});

test('the toast for a group names the members it deleted and the ones it kept', () => {
  const { deleteSummary } = require('../web/delete-plan');
  const r = { deleted: ['3', '15'], kept: [{ id: '7', groups: ['I1'] }], swept: { logbook: 1 } };
  assert.strictEqual(deleteSummary('group', ['I2'], [r], []), 'Deleted group #I2; deleted 2 member cards (#3, #15); kept #7 (also in #I1); deleted its 1 logbook file.');
  assert.strictEqual(deleteSummary('group', ['I2'], [{ deleted: [], kept: [], swept: {} }], []), 'Deleted group #I2.');
});
