const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards, searchSuggestionItems } = require('../web/search');

const CARDS = [
  { id: 1, title: 'Ship it', body: '', status: 'todo', priority: 'Normal', tags: [], type: 'objective' },
  { id: 2, title: 'Write it', body: '', status: 'todo', priority: 'Normal', tags: [], type: 'story' },
  { id: 3, title: 'Plain', body: '', status: 'todo', priority: 'Normal', tags: [], type: null },
  { id: 4, title: 'No field', body: '', status: 'todo', priority: 'Normal', tags: [] },
  { id: 5, title: 'Mentions objective', body: 'an objective in the body', status: 'todo', priority: 'Normal', tags: ['objective'] },
];

const idsFor = (q) => filterCards(CARDS, parseSearchQuery(q)).map((c) => c.id);

test('type: parses as its own scoped term, value lowercased', () => {
  assert.deepStrictEqual(parseSearchQuery('type:Objective'), [{ field: 'type', value: 'objective' }]);
});

test('a bare type: (value not typed yet) is dropped as mid-typing, not a match-everything term', () => {
  assert.deepStrictEqual(parseSearchQuery('type:'), []);
  assert.deepStrictEqual(idsFor('type:'), [1, 2, 3, 4, 5]);
});

test('type:objective shows only cards of that type', () => {
  assert.deepStrictEqual(idsFor('type:objective'), [1]);
});

test('type: matches case-insensitively and never hits the title, body or tags', () => {
  assert.deepStrictEqual(idsFor('type:OBJECTIVE'), [1]);
  assert.deepStrictEqual(idsFor('type:story'), [2]);
});

test('type: composes with the rest of the query by intersection', () => {
  assert.deepStrictEqual(idsFor('type:objective title:ship'), [1]);
  assert.deepStrictEqual(idsFor('type:objective title:write'), []);
});

test('the autocomplete offers type:<segment> as the last scoped suggestion', () => {
  const labels = searchSuggestionItems('obj').map((i) => i.label);
  assert.strictEqual(labels[labels.length - 1], 'type:obj');
  assert.deepStrictEqual(labels.slice(-2), ['assignee:obj', 'type:obj']);
});
