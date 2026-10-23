const { test } = require('node:test');
const assert = require('node:assert');
const { parseSearchQuery, filterCards, resolveTerms, cardMatchesQuery, searchIsolateText, searchIsolateBox } = require('../web/search');
const { NO_SELECTION, cardPart, pathPart, graphPart, addPart, resolveSelection, partsOf, pruneSelectionParts } = require('../web/selection');

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

test('the isolate text writes a part of each kind as its term, in the order added', () => {
  const selection = [cardPart(1), graphPart('hpath', 3), graphPart('htree', 4), graphPart('dpath', 5), graphPart('dtree', 5), pathPart(2)].reduce(addPart, NO_SELECTION);
  assert.strictEqual(searchIsolateText(partsOf(selection)), '#1 | hpath:3 | htree:4 | dpath:5 | dtree:5 | path:2');
});

test('the isolate text of a part matches what the selection resolves it to over the whole board', () => {
  const matchQuery = (text) => new Set(ids(text));
  for (const part of [graphPart('hpath', 3), graphPart('htree', 4), graphPart('dpath', 4), graphPart('dtree', 5)]) {
    const selection = addPart(NO_SELECTION, part);
    assert.deepStrictEqual([...resolveSelection(selection, matchQuery, null)].sort(), ids(searchIsolateText(partsOf(selection))).sort());
  }
});

test('where the box hides what it does not match, the rest stays ANDed on when one of the four is among the parts, as for a path or a tree', () => {
  const selection = [graphPart('hpath', 3), cardPart(7)].reduce(addPart, NO_SELECTION);
  assert.strictEqual(searchIsolateBox('tags:ui', partsOf(selection), { limits: true }), '(hpath:3 | #7) tags:ui');
  assert.strictEqual(searchIsolateBox('tags:ui', partsOf(selection), { limits: false }), 'hpath:3 | #7');
  assert.strictEqual(searchIsolateBox('tags:ui', partsOf([graphPart('dtree', 5)].reduce(addPart, NO_SELECTION)), { limits: true }), 'dtree:5 tags:ui');
});

test('a part of the four goes when its card is gone from the board, and stays while the card is there', () => {
  const selection = [graphPart('hpath', 3), graphPart('dtree', 5)].reduce(addPart, NO_SELECTION);
  assert.deepStrictEqual(partsOf(pruneSelectionParts(selection, ['3', '4'])), [{ kind: 'hpath', id: '3' }]);
});

test('the part constructors key the id whole, a string whether it came as a number or not', () => {
  assert.deepStrictEqual(graphPart('hpath', 3), { kind: 'hpath', id: '3' });
  assert.deepStrictEqual(graphPart('htree', 'G4'), { kind: 'htree', id: 'G4' });
  assert.deepStrictEqual(graphPart('dpath', 5), { kind: 'dpath', id: '5' });
  assert.deepStrictEqual(graphPart('dtree', 5), { kind: 'dtree', id: '5' });
  assert.strictEqual(addPart(addPart(NO_SELECTION, graphPart('hpath', 3)), graphPart('hpath', '3')).additions.length, 0, 'the same part twice is one part');
  assert.strictEqual(addPart(addPart(NO_SELECTION, graphPart('hpath', 3)), graphPart('htree', 3)).additions.length, 1, 'a different kind of the same card is a part of its own');
});
