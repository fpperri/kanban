const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards } = require('../../plugin/skills/web/web/search');

const card = (id, over = {}) => ({ id: String(id), title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], waiting_for: [], ...over });
// 1 is the root; 2 and 3 are under 1; 4 is under 3 and waits for 2; 5 waits for 4; 6 is an archived child of 2.
const CARDS = [card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 3, waiting_for: [2] }), card(5, { waiting_for: [4] }), card(6, { parent: 2, archived: true })];
const CTX = { board: 'kanban' };
const ids = (text) => filterCards(CARDS, parseSearchQuery(text, 'kanban'), CTX).map((c) => c.id);

test('a side after the id cuts the set: htree:4:below is the tree from the depth of 4 down', () => {
  assert.deepStrictEqual(ids('htree:4:below'), ['4', '6']);
  assert.deepStrictEqual(ids('htree:4:above'), ['1', '2', '3', '4', '6']);
  assert.deepStrictEqual(ids('dpath:4:before'), ['2', '4']);
  assert.deepStrictEqual(ids('dpath:4:after'), ['4', '5']);
});

test('the term keeps the id and the side apart', () => {
  assert.deepStrictEqual(parseSearchQuery('htree:#4:below', 'kanban'), [{ field: 'htree', value: '4', side: 'below' }]);
  assert.deepStrictEqual(parseSearchQuery('htree:4', 'kanban'), [{ field: 'htree', value: '4' }]);
  assert.deepStrictEqual(parseSearchQuery('htree:"4:below"', 'kanban'), [{ field: 'htree', value: '4', side: 'below' }]);
  assert.deepStrictEqual(parseSearchQuery('HTREE:4:BELOW', 'kanban'), [{ field: 'htree', value: '4', side: 'below' }]);
});

test('no suffix and the & side are the same set, for every one of the six', () => {
  for (const kind of ['hlinks', 'hpath', 'htree']) assert.deepStrictEqual(ids(`${kind}:4:above&below`), ids(`${kind}:4`), kind);
  for (const kind of ['dlinks', 'dpath', 'dtree']) assert.deepStrictEqual(ids(`${kind}:4:before&after`), ids(`${kind}:4`), kind);
});

test('a side of the other relation matches nothing, as an unknown id does, and never throws', () => {
  assert.deepStrictEqual(ids('htree:4:after'), []);
  assert.deepStrictEqual(ids('hlinks:4:before&after'), []);
  assert.deepStrictEqual(ids('dpath:4:above'), []);
  assert.deepStrictEqual(ids('dtree:4:above&below'), []);
});

test('a suffixed term joins alternatives and other terms like any other', () => {
  assert.deepStrictEqual(ids('htree:4:below | dpath:4:after'), ['4', '5', '6']);
  assert.deepStrictEqual(ids('htree:4:above status:todo'), ['1', '2', '3', '4', '6']);
});

test('a prefixed id keeps its colon-free form with a side: kanban#4 and the side are read apart', () => {
  assert.deepStrictEqual(parseSearchQuery('hlinks:kanban#4:below', 'kanban'), [{ field: 'hlinks', value: 'kanban#4', side: 'below' }]);
});

test('tree: and path: take no side', () => {
  assert.deepStrictEqual(ids('tree:4:below'), []);
});

test('the sided terms docs/web.md gives parse to the term they name', () => {
  const doc = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../docs/web.md'), 'utf8');
  for (const [text, field, value, side] of [['htree:467:below', 'htree', '467', 'below'], ['dpath:148:after', 'dpath', '148', 'after']]) {
    assert.ok(doc.includes('`' + text + '`'), text);
    assert.deepStrictEqual(parseSearchQuery(text, 'kanban'), [{ field, value, side }]);
  }
});
