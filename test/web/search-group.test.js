const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards } = require('../../plugin/skills/web/web/search');

// group: in the search box (docs/adr/0015). `group:<id or name>` is the cards a group lists,
// a bare `group:` every card that is in any group, `-group:` and `-group:<id or name>` the
// cards that are not. The groups come in with the query's context, and a page that gives
// none (the snapshot) finds no group, so every card is ungrouped there.

const CARDS = ['1', '2', '3', '4', '5', 'G3'].map((id) => ({ id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], type: null }));
const GROUPS = [
  { id: 'I2', name: 'zephyr-2', cards: ['1', '2'] },
  { id: 'W1', name: 'orders cutover', cards: ['2', 'G3'] },
  { id: '_1', name: 'offsite', cards: [] },
];
const ids = (q, ctx = { groups: GROUPS }) => filterCards(CARDS, parseSearchQuery(q), ctx).map((c) => c.id);

test('group:<id> parses as a group term and a bare group: or -group: is a complete term', () => {
  assert.deepStrictEqual(parseSearchQuery('group:I2'), [{ field: 'group', value: 'I2' }]);
  assert.deepStrictEqual(parseSearchQuery('group:#I2'), [{ field: 'group', value: 'I2' }]);
  assert.deepStrictEqual(parseSearchQuery('group:'), [{ field: 'group', value: '' }]);
  assert.deepStrictEqual(parseSearchQuery('-group:'), [{ field: 'group', value: '', not: true }]);
  assert.deepStrictEqual(parseSearchQuery('-group:I2'), [{ field: 'group', value: 'I2', not: true }]);
  assert.deepStrictEqual(parseSearchQuery('GROUP:i2'), [{ field: 'group', value: 'i2' }], 'the scope reads in any letter case');
});

test('group:<id> finds the cards the group lists, the id read in any letter case', () => {
  assert.deepStrictEqual(ids('group:I2'), ['1', '2']);
  assert.deepStrictEqual(ids('group:i2'), ['1', '2']);
  assert.deepStrictEqual(ids('group:#W1'), ['2', 'G3']);
});

test('group:<name> finds them by the group\'s name, ignoring case; a quoted name may hold a space', () => {
  assert.deepStrictEqual(ids('group:zephyr-2'), ['1', '2']);
  assert.deepStrictEqual(ids('group:ZEPHYR-2'), ['1', '2']);
  assert.deepStrictEqual(ids('group:"orders cutover"'), ['2', 'G3']);
  assert.deepStrictEqual(ids('-group:"orders cutover"'), ['1', '3', '4', '5']);
});

test('the whole id decides: a group listing G3 does not list card 3', () => {
  assert.deepStrictEqual(ids('group:W1'), ['2', 'G3']);
  assert.deepStrictEqual(ids('-group:W1'), ['1', '3', '4', '5']);
});

test('a bare group: finds every grouped card and -group: every card in no group', () => {
  assert.deepStrictEqual(ids('group:'), ['1', '2', 'G3']);
  assert.deepStrictEqual(ids('-group:'), ['3', '4', '5']);
});

test('-group:<id or name> finds the cards that group does not list', () => {
  assert.deepStrictEqual(ids('-group:I2'), ['3', '4', '5', 'G3']);
  assert.deepStrictEqual(ids('-group:zephyr-2'), ['3', '4', '5', 'G3']);
});

test('a group that is not there, or an empty one, finds nothing, and its negation finds every card', () => {
  assert.deepStrictEqual(ids('group:I99'), []);
  assert.deepStrictEqual(ids('group:_1'), []);
  assert.deepStrictEqual(ids('-group:I99'), ['1', '2', '3', '4', '5', 'G3']);
});

test('group terms compose with the rest of the query, or, and brackets', () => {
  assert.deepStrictEqual(ids('group:I2 title:"card 2"'), ['2']);
  assert.deepStrictEqual(ids('group:I2 group:W1'), ['2'], 'two group terms are both asked');
  assert.deepStrictEqual(ids('group:I2 | #5'), ['1', '2', '5']);
  assert.deepStrictEqual(ids('(group:I2 | group:W1) -group:zephyr-2'), ['G3']);
});

test('with no groups in the context every card is ungrouped', () => {
  assert.deepStrictEqual(ids('group:I2', {}), []);
  assert.deepStrictEqual(ids('group:', null), []);
  assert.deepStrictEqual(ids('-group:', { groups: [] }), ['1', '2', '3', '4', '5', 'G3']);
});

test('a hyphen or the word group elsewhere stays text', () => {
  assert.deepStrictEqual(parseSearchQuery('-groups'), [{ field: null, value: '-groups' }]);
  assert.deepStrictEqual(parseSearchQuery('groups:x'), [{ field: null, value: 'groups:x' }]);
});
