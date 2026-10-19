const { test } = require('node:test');
const assert = require('node:assert');
const g = require('../web/groups');

const ZEPHYR = { id: 'I2', name: 'zephyr-2', folder: 'iteration', start_date: '2026-10-12', end_date: '2026-10-23', auto_join: true, cards: ['3', '7', '15'], extra: {}, file: '.groups/iteration/I0002.zephyr-2.md' };
const CUTOVER = { id: 'W1', name: 'orders-cutover', folder: 'workflow', start_date: '', end_date: '', auto_join: false, cards: ['7', '15', 'G3'], extra: {}, file: '' };
const DEEP = { id: 'DW1', name: 'schema-diff-review', folder: 'workflow/dynamic', start_date: '', end_date: '', auto_join: false, cards: ['7'], extra: {}, file: '' };
const LOOSE = { id: '_1', name: 'offsite-prep', folder: '', start_date: '2026-10-19', end_date: '', auto_join: false, cards: ['7'], extra: {}, file: '' };
const ALL = [ZEPHYR, CUTOVER, DEEP, LOOSE];

test('a group is labelled with its id and its short name', () => {
  assert.strictEqual(g.groupLabel(ZEPHYR), '#I2 zephyr-2');
  assert.strictEqual(g.groupLabel({ id: '_4', name: '' }), '#_4');
});

test('the tooltip gives the dates, then the type path; a group with no folder is "(no type)"', () => {
  assert.strictEqual(g.groupTip(ZEPHYR), '2026-10-12 to 2026-10-23 · iteration');
  assert.strictEqual(g.groupTip(CUTOVER), 'workflow');
  assert.strictEqual(g.groupTip(DEEP), 'workflow/dynamic');
  assert.strictEqual(g.groupTip(LOOSE), 'from 2026-10-19 · (no type)');
  assert.strictEqual(g.groupTypePath(LOOSE), '(no type)');
});

test('a card\'s groups are the ones that list its whole id, in id order', () => {
  assert.deepStrictEqual(g.groupsOfCard(ALL, '7').map((x) => x.id), ['DW1', 'I2', 'W1', '_1']);
  assert.deepStrictEqual(g.groupsOfCard(ALL, 'G3').map((x) => x.id), ['W1']);
  assert.deepStrictEqual(g.groupsOfCard(ALL, '3').map((x) => x.id), ['I2'], 'G3 is not card 3');
  assert.deepStrictEqual(g.groupsOfCard(ALL, '99'), []);
  assert.deepStrictEqual(g.groupsOfCard(ALL, 'not an id'), []);
});

test('a card wears up to two badges, then the rest as a count with their names', () => {
  const three = g.groupBadgeModel(ALL, '7');
  assert.deepStrictEqual(three.shown.map((x) => x.id), ['DW1', 'I2']);
  assert.strictEqual(three.more, 2);
  assert.strictEqual(three.moreTip, '#W1 orders-cutover\n#_1 offsite-prep');
  const one = g.groupBadgeModel(ALL, 'G3');
  assert.deepStrictEqual([one.shown.length, one.more, one.moreTip], [1, 0, '']);
  assert.deepStrictEqual(g.groupBadgeModel(ALL, '99'), { shown: [], more: 0, moreTip: '' });
  assert.strictEqual(g.groupBadgeModel(ALL, '7', 4).more, 0);
});

test('the groups that hold a whole selection are the ones listing every card of it', () => {
  assert.deepStrictEqual(g.groupsHoldingAll(ALL, ['7', '15']).map((x) => x.id), ['I2', 'W1']);
  assert.deepStrictEqual(g.groupsHoldingAll(ALL, ['3', '15', '7']).map((x) => x.id), ['I2']);
  assert.deepStrictEqual(g.groupsHoldingAll(ALL, ['3', 'G3']), []);
  assert.deepStrictEqual(g.groupsHoldingAll(ALL, []), []);
});

test('a group is running from its start to its end, both days included', () => {
  assert.strictEqual(g.groupRunning(ZEPHYR, '2026-10-11'), false);
  assert.strictEqual(g.groupRunning(ZEPHYR, '2026-10-12'), true);
  assert.strictEqual(g.groupRunning(ZEPHYR, '2026-10-23'), true);
  assert.strictEqual(g.groupRunning(ZEPHYR, '2026-10-24'), false);
  assert.strictEqual(g.groupRunning(LOOSE, '2026-10-20'), false, 'one date is not a span');
  assert.strictEqual(g.groupRunning(CUTOVER, '2026-10-20'), false);
});

test('the form offers no type first, then the folders the board has, and says which prefix the folder gives', () => {
  const payload = { folders: ['', 'iteration', 'workflow', 'workflow/dynamic'], prefixes: { '': '_', iteration: 'I', workflow: 'W' } };
  assert.deepStrictEqual(g.groupFolderChoices(payload), [
    { value: '', label: '(no type)' }, { value: 'iteration', label: 'iteration' }, { value: 'workflow', label: 'workflow' }, { value: 'workflow/dynamic', label: 'workflow/dynamic' },
  ]);
  assert.deepStrictEqual(g.groupFolderChoices(null), [{ value: '', label: '(no type)' }]);
  assert.deepStrictEqual(g.groupFolderChoices({ folders: [''] }, 'iteration'), [{ value: '', label: '(no type)' }, { value: 'iteration', label: 'iteration' }], 'a folder the draft asks for is offered before it exists');
  assert.deepStrictEqual(g.groupFolderChoices(payload, 'iteration').map((c) => c.value), ['', 'iteration', 'workflow', 'workflow/dynamic'], 'and not twice');
  assert.strictEqual(g.groupPrefixFor(payload, 'iteration'), 'I');
  assert.strictEqual(g.groupPrefixFor(payload, ''), '_');
  assert.strictEqual(g.groupPrefixFor(payload, 'workflow/dynamic'), '_', 'a folder no prefix names takes _');
  assert.strictEqual(g.groupPrefixFor(null, 'iteration'), '_');
});

test('the form needs a name and no end before the start, and sends auto_join only with both dates', () => {
  assert.strictEqual(g.groupFormProblem({ name: '  ' }), 'A group needs a short name.');
  assert.strictEqual(g.groupFormProblem({ name: 'x', start_date: '2026-10-12', end_date: '2026-10-11' }), 'A group cannot end before it starts.');
  assert.strictEqual(g.groupFormProblem({ name: 'x', start_date: '2026-10-12' }), '');
  assert.deepStrictEqual(g.groupFormBody({ name: ' x ', folder: 'iteration', start_date: '2026-10-12', end_date: '2026-10-23', auto_join: true, cards: ['3'] }),
    { name: 'x', folder: 'iteration', start_date: '2026-10-12', end_date: '2026-10-23', auto_join: true, cards: ['3'] });
  assert.strictEqual(g.groupFormBody({ name: 'x', start_date: '2026-10-12', auto_join: true }).auto_join, false);
  assert.deepStrictEqual(g.groupFormBody({ name: 'x' }), { name: 'x', folder: '', start_date: '', end_date: '', auto_join: false, cards: [] });
});

test('groupById finds a group by its whole id', () => {
  assert.strictEqual(g.groupById(ALL, 'W1'), CUTOVER);
  assert.strictEqual(g.groupById(ALL, '_1'), LOOSE);
  assert.strictEqual(g.groupById(ALL, '1'), null);
  assert.strictEqual(g.groupById(ALL, 'bad'), null);
});
