const { test } = require('node:test');
const assert = require('node:assert');
const { HOVER_SHOW_KINDS, hoverShowIds, hoverShowTerms } = require('../../plugin/skills/web/web/hover-show');
const { HIERARCHY_SIDES, DEPENDENCY_SIDES } = require('../../plugin/skills/web/web/explore-sets');
const { parseSearchQuery, filterCards } = require('../../plugin/skills/web/web/search');

// Roots: 1, 6 and 10. 2 and 3 are under 1; 4 under 2; 5 under 3; 7 under 6; 11 (archived) under 4; 12 under 7.
// Dependencies: 3 waits for 2, 5 waits for 4, 8 and 9 wait for 5, 13 waits for 8; 10 is a stranger.
const BOARD = [
  { id: '1', status: 'todo' },
  { id: '2', status: 'todo', parent: 1 },
  { id: '3', status: 'todo', parent: 1, waiting_for: ['2'] },
  { id: '4', status: 'todo', parent: 2 },
  { id: '5', status: 'todo', parent: 3, waiting_for: ['4'] },
  { id: '6', status: 'todo' },
  { id: '7', status: 'todo', parent: 6 },
  { id: '8', status: 'todo', waiting_for: ['5'] },
  { id: '9', status: 'todo', waiting_for: ['5'] },
  { id: '10', status: 'todo' },
  { id: '11', status: 'archive', parent: 4 },
  { id: '12', status: 'todo', parent: 7 },
  { id: '13', status: 'todo', waiting_for: ['8'] },
];
const CTX = { board: 'kanban' };
const sorted = (ids) => [...ids].sort();
const lit = (kinds, id, sides) => sorted(hoverShowIds(kinds, BOARD, id, CTX, sides));
const selected = (terms) => sorted(filterCards(BOARD, parseSearchQuery(terms, 'kanban'), CTX).map((c) => c.id));
const sidesOf = (hierarchy, dependencies) => ({ hierarchy, dependencies });

function everyMix(visit) {
  for (let mask = 0; mask < 64; mask++) {
    const kinds = HOVER_SHOW_KINDS.filter((_, i) => mask & (1 << i));
    for (const h of HIERARCHY_SIDES) for (const d of DEPENDENCY_SIDES) visit(kinds, sidesOf(h, d));
  }
}

test('for every mix of the six kinds and the two sides, the cards a hover lights are the cards the search selects from the terms Space writes', () => {
  let walked = 0;
  everyMix((kinds, sides) => {
    for (const card of BOARD) {
      const terms = hoverShowTerms(kinds, card.id, sides);
      const expected = lit(kinds, card.id, sides);
      if (terms === '') assert.deepStrictEqual(expected, []);
      else assert.deepStrictEqual(selected(terms), expected, `${terms} (${JSON.stringify(sides)})`);
      walked++;
    }
  });
  assert.strictEqual(walked, 64 * 9 * BOARD.length);
});

test('the terms carry a suffix only off the & side, in the order written today', () => {
  assert.strictEqual(hoverShowTerms(['dlinks', 'hlinks'], '12'), 'dlinks:12 | hlinks:12');
  assert.strictEqual(hoverShowTerms(['dlinks', 'hlinks'], '12', sidesOf('above&below', 'before&after')), 'dlinks:12 | hlinks:12');
  assert.strictEqual(hoverShowTerms(['dtree', 'htree', 'dpath', 'hpath', 'dlinks', 'hlinks'], '12', sidesOf('below', 'before')),
    'dtree:12:before | htree:12:below | dpath:12:before | hpath:12:below | dlinks:12:before | hlinks:12:below');
  assert.strictEqual(hoverShowTerms(['htree', 'dpath'], 'kanban#12', sidesOf('above', 'before&after')), 'htree:kanban#12:above | dpath:kanban#12');
});

test('with both sides on &, or no sides given, every set is today\'s', () => {
  const both = sidesOf('above&below', 'before&after');
  for (const kind of HOVER_SHOW_KINDS) for (const card of BOARD) {
    assert.deepStrictEqual(lit([kind], card.id, both), lit([kind], card.id), kind);
  }
  assert.deepStrictEqual(lit(['htree'], '4'), ['1', '11', '2', '3', '4', '5']);
  assert.deepStrictEqual(lit(['dpath'], '5'), ['13', '4', '5', '8', '9']);
});

test('htree: below keeps the hovered card\'s depth and deeper, above its depth and shallower, across the whole tree', () => {
  assert.deepStrictEqual(lit(['htree'], '2', sidesOf('below')), ['11', '2', '3', '4', '5']);
  assert.deepStrictEqual(lit(['htree'], '2', sidesOf('above')), ['1', '2', '3']);
  assert.deepStrictEqual(lit(['htree'], '4', sidesOf('above')), ['1', '2', '3', '4', '5']);
  assert.deepStrictEqual(lit(['htree'], '1', sidesOf('below')), ['1', '11', '2', '3', '4', '5']);
  assert.deepStrictEqual(lit(['htree'], '1', sidesOf('above')), ['1']);
});

test('a parent\'s sibling counts as above and a sibling\'s child as below: level is depth and nothing else', () => {
  assert.ok(lit(['htree'], '5', sidesOf('above')).includes('2'));
  assert.ok(!lit(['htree'], '5', sidesOf('below')).includes('2'));
  assert.ok(lit(['htree'], '2', sidesOf('below')).includes('5'));
  assert.ok(!lit(['htree'], '2', sidesOf('above')).includes('5'));
});

test('hlinks and hpath: below is the card and its children or all nested under it, above the card and its parent or its line to the root', () => {
  assert.deepStrictEqual(lit(['hlinks'], '2', sidesOf('below')), ['2', '4']);
  assert.deepStrictEqual(lit(['hlinks'], '2', sidesOf('above')), ['1', '2']);
  assert.deepStrictEqual(lit(['hpath'], '2', sidesOf('below')), ['11', '2', '4']);
  assert.deepStrictEqual(lit(['hpath'], '4', sidesOf('above')), ['1', '2', '4']);
  assert.deepStrictEqual(lit(['hpath'], '1', sidesOf('above')), ['1']);
});

test('dlinks and dpath: before is the card and what it waits for, after the card and what waits on it', () => {
  assert.deepStrictEqual(lit(['dlinks'], '5', sidesOf(undefined, 'before')), ['4', '5']);
  assert.deepStrictEqual(lit(['dlinks'], '5', sidesOf(undefined, 'after')), ['5', '8', '9']);
  assert.deepStrictEqual(lit(['dpath'], '13', sidesOf(undefined, 'before')), ['13', '4', '5', '8']);
  assert.deepStrictEqual(lit(['dpath'], '4', sidesOf(undefined, 'after')), ['13', '4', '5', '8', '9']);
});

test('dtree: a card neither before nor after the hovered card stays lit, the other side goes', () => {
  assert.deepStrictEqual(lit(['dtree'], '5', sidesOf(undefined, 'before')), ['4', '5']);
  assert.deepStrictEqual(lit(['dtree'], '5', sidesOf(undefined, 'after')), ['13', '5', '8', '9']);
  assert.deepStrictEqual(lit(['dtree'], '8', sidesOf(undefined, 'after')), ['13', '8', '9']);
  assert.deepStrictEqual(lit(['dtree'], '8', sidesOf(undefined, 'before')), ['4', '5', '8', '9']);
});

test('the hovered card is in every cut it has a set for, and an unknown card lights nothing', () => {
  everyMix((kinds, sides) => {
    if (!kinds.length) return;
    for (const card of BOARD) assert.ok(hoverShowIds(kinds, BOARD, card.id, CTX, sides).has(card.id));
    assert.strictEqual(hoverShowIds(kinds, BOARD, '99', CTX, sides).size, 0);
  });
});
