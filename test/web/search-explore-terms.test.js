const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards, resolveTerms, cardMatchesQuery, searchIsolateText, searchIsolateBox } = require('../../plugin/skills/web/web/search');
const { NO_SELECTION, cardPart, pathPart, typedQueryPart, addPart, resolveSelection, partsOf } = require('../../plugin/skills/web/web/selection');

// 1 is the root; 2 and 3 are under 1; 4 is under 3 and waits for 2; 5 waits for 4; 6 is an archived child of 2;
// 7 is a stranger; 8 has a parent on another board; 9 and 10 are each other's parent.
const card = (id, over = {}) => ({ id: String(id), title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], waiting_for: [], ...over });
const CARDS = [
  card(1),
  card(2, { parent: 1 }),
  card(3, { parent: 1 }),
  card(4, { parent: 3, waiting_for: [2] }),
  card(5, { waiting_for: [4] }),
  card(6, { parent: 2, archived: true }),
  card(7),
  card(8, { parent: 'fpp#1' }),
  card(9, { parent: 10 }),
  card(10, { parent: 9 }),
];
const CTX = { board: 'kanban' };
const ids = (text) => filterCards(CARDS, parseSearchQuery(text, 'kanban'), CTX).map((c) => c.id);

test('each term matches its set: hpath: the parents up and the cards under, htree: the whole parent tree, dpath: and dtree: over waiting_for', () => {
  assert.deepStrictEqual(ids('hpath:3'), ['1', '3', '4']);
  assert.deepStrictEqual(ids('htree:4'), ['1', '2', '3', '4', '6']);
  assert.deepStrictEqual(ids('dpath:4'), ['2', '4', '5']);
  assert.deepStrictEqual(ids('dtree:5'), ['2', '4', '5']);
});

test('the hash is optional, the id is read whole, and the scope is read in any letter case', () => {
  for (const kind of ['hpath', 'htree', 'dpath', 'dtree']) {
    assert.deepStrictEqual(ids(`${kind}:#4`), ids(`${kind}:4`));
    assert.deepStrictEqual(ids(`${kind.toUpperCase()}:4`), ids(`${kind}:4`));
    assert.deepStrictEqual(ids(`${kind}:"#4"`), ids(`${kind}:4`));
    assert.deepStrictEqual(parseSearchQuery(`${kind}:#4`), [{ field: kind, value: '4' }]);
  }
});

test('an unknown id matches nothing, and a bare scope is a term still being typed and is dropped', () => {
  for (const kind of ['hpath', 'htree', 'dpath', 'dtree']) {
    assert.deepStrictEqual(ids(`${kind}:999`), []);
    assert.deepStrictEqual(parseSearchQuery(`${kind}:`), []);
    assert.strictEqual(ids(`${kind}:`).length, CARDS.length, 'a dropped term cuts nothing');
  }
});

test('a missing parent, a parent on another board and a parent loop are handled as the hierarchy sets define them', () => {
  assert.deepStrictEqual(ids('hpath:8'), ['8'], 'fpp#1 is another board\'s card');
  assert.deepStrictEqual(ids('htree:8'), ['8']);
  assert.deepStrictEqual(ids('hpath:9'), ['9', '10']);
  assert.deepStrictEqual(ids('htree:10'), ['9', '10']);
  const orphan = [card(1, { parent: 40 }), card(2, { parent: 1 })];
  assert.deepStrictEqual(filterCards(orphan, parseSearchQuery('htree:2')).map((c) => c.id), ['1', '2']);
});

test('archived cards are in the sets, as tree: treats them', () => {
  assert.ok(ids('hpath:2').includes('6'));
  assert.ok(ids('htree:6').includes('6'));
  assert.ok(ids('tree:6').includes('6'));
});

test('the four combine with other terms like tree: and path: do, and tree: and path: are as they were', () => {
  assert.deepStrictEqual(ids('htree:1 status:todo'), ['1', '2', '3', '4', '6']);
  assert.deepStrictEqual(ids('hpath:3 | dpath:5'), ['1', '2', '3', '4', '5']);
  assert.deepStrictEqual(ids('tree:4'), ['1', '2', '3', '4', '5', '6']);
  assert.deepStrictEqual(ids('path:4'), ['1', '2', '3', '4', '5', '6']);
});

test('the resolver turns the four into id terms through the context\'s graph functions, and the default graph when it has none of them', () => {
  const asked = [];
  const graph = {
    treeIds: () => new Set(),
    pathIds: () => new Set(),
    hpathIds: (cards, id) => { asked.push(['hpath', id]); return new Set(['7']); },
    htreeIds: () => new Set(['8']),
    dpathIds: () => new Set(['9']),
    dtreeIds: () => new Set(['10']),
  };
  const resolved = resolveTerms(CARDS, parseSearchQuery('hpath:1 htree:1 dpath:1 dtree:1'), { graph });
  assert.deepStrictEqual(resolved.map((t) => t.field), ['ids', 'ids', 'ids', 'ids']);
  assert.deepStrictEqual(resolved.map((t) => [...t.ids][0]), ['7', '8', '9', '10']);
  assert.deepStrictEqual(asked, [['hpath', '1']]);
  const fallback = resolveTerms(CARDS, parseSearchQuery('dpath:4'), { graph: { treeIds: () => new Set(), pathIds: () => new Set() } });
  assert.deepStrictEqual([...fallback[0].ids].sort(), ['2', '4', '5']);
});

test('an unresolved one matches nothing instead of throwing', () => {
  for (const field of ['hpath', 'htree', 'dpath', 'dtree']) assert.strictEqual(cardMatchesQuery(CARDS[0], [{ field, value: '1' }]), false);
});

test('isolating a search typed or picked from the menu writes it as it is: one term, or its alternatives in brackets', () => {
  const typed = (text) => typedQueryPart(text);
  assert.strictEqual(searchIsolateText([typed('dpath:3')]), 'dpath:3');
  assert.strictEqual(searchIsolateText([typed('htree:1 | dpath:2')]), '(htree:1 | dpath:2)');
  assert.strictEqual(searchIsolateText([cardPart(1), typed('hpath:3'), pathPart(2)]), '#1 | hpath:3 | path:2');
});

test('what the isolate text of a typed search matches is what the search matched', () => {
  const matchQuery = (text) => new Set(ids(text));
  for (const text of ['hpath:3', 'htree:4', 'dpath:4', 'dtree:5', 'htree:1 | dpath:5']) {
    const selection = addPart(NO_SELECTION, typedQueryPart(text));
    assert.deepStrictEqual([...resolveSelection(selection, matchQuery, null)].sort(), ids(searchIsolateText(partsOf(selection))).sort(), text);
  }
});

test('a Shift pick joins alternatives with the search module own join: one term as it is, a longer one in brackets, a slice run after', () => {
  const { searchAddAlt } = require('../../plugin/skills/web/web/search');
  assert.strictEqual(searchAddAlt('', 'dpath:2'), 'dpath:2');
  assert.strictEqual(searchAddAlt('htree:40', 'dpath:185'), 'htree:40 | dpath:185');
  assert.strictEqual(searchAddAlt('htree:40 | dpath:185', 'dpath:185'), 'htree:40 | dpath:185');
  assert.strictEqual(searchAddAlt('tags:ui status:doing slice:goal..epic', 'dtree:2'), '((tags:ui status:doing) | dtree:2) slice:goal..epic');
});

test('dlinks: and hlinks: match the card and its direct neighbours, the hash optional and the scope in any letter case', () => {
  assert.deepStrictEqual(ids('dlinks:4'), ['2', '4', '5']);
  assert.deepStrictEqual(ids('dlinks:2'), ['2', '4']);
  assert.deepStrictEqual(ids('hlinks:1'), ['1', '2', '3']);
  assert.deepStrictEqual(ids('hlinks:2'), ['1', '2', '6']);
  assert.deepStrictEqual(ids('hlinks:8'), ['8'], 'fpp#1 is another board\'s card');
  assert.deepStrictEqual(ids('hlinks:9'), ['9', '10']);
  for (const kind of ['dlinks', 'hlinks']) {
    assert.deepStrictEqual(ids(`${kind}:#4`), ids(`${kind}:4`));
    assert.deepStrictEqual(ids(`${kind.toUpperCase()}:4`), ids(`${kind}:4`));
    assert.deepStrictEqual(ids(`${kind}:"#4"`), ids(`${kind}:4`));
    assert.deepStrictEqual(parseSearchQuery(`${kind}:#4`), [{ field: kind, value: '4' }]);
    assert.deepStrictEqual(ids(`${kind}:999`), []);
    assert.deepStrictEqual(parseSearchQuery(`${kind}:`), []);
    assert.strictEqual(ids(`${kind}:`).length, CARDS.length, 'a dropped term cuts nothing');
    assert.strictEqual(cardMatchesQuery(CARDS[0], [{ field: kind, value: '1' }]), false, 'an unresolved one matches nothing');
  }
  assert.ok(ids('hlinks:2').includes('6'), 'archived cards are in the set');
  assert.deepStrictEqual(ids('hlinks:3 | dlinks:5'), ['1', '3', '4', '5']);
});

test('the resolver hands dlinks: and hlinks: to the context\'s graph functions, and to the explore sets when it has none', () => {
  const graph = {
    treeIds: () => new Set(),
    pathIds: () => new Set(),
    dlinksIds: () => new Set(['7']),
    hlinksIds: () => new Set(['8']),
  };
  const resolved = resolveTerms(CARDS, parseSearchQuery('dlinks:1 hlinks:1'), { graph });
  assert.deepStrictEqual(resolved.map((t) => [...t.ids][0]), ['7', '8']);
  const fallback = resolveTerms(CARDS, parseSearchQuery('dlinks:4'), { graph: { treeIds: () => new Set(), pathIds: () => new Set() } });
  assert.deepStrictEqual([...fallback[0].ids].sort(), ['2', '4', '5']);
});

test('a Shift pick and an isolate keep dlinks: and hlinks: as typed', () => {
  const { searchAddAlt } = require('../../plugin/skills/web/web/search');
  assert.strictEqual(searchAddAlt('hlinks:40', 'dlinks:185'), 'hlinks:40 | dlinks:185');
  assert.strictEqual(searchIsolateText([typedQueryPart('hlinks:3 | dlinks:5')]), '(hlinks:3 | dlinks:5)');
});
