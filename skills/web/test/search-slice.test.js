const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  parseSearchQuery, cardMatchesQuery, filterCards, searchTermText, searchAddTerm,
} = require('../web/search');

// The slice: term, driven through the search module's own seam: a query string
// and a board context in, the cards it matches out. The axis it cuts is the
// slices module's (tiers of the hierarchy top first, then the depths of the
// cards with no tier), over the whole board, so what a card matches never
// depends on which cards a view shows. The slices themselves are pinned in
// slices.test.js.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], file: `${String(id).padStart(4, '0')}.card.md`,
  assignee: null, type: null, waiting_for: [], blocked: null, review: null, parent: null, rank: null, archived: false, ...over,
});

const HIERARCHY = ['goal', 'strategy', 'objective', 'epic'];
const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'], hierarchy: HIERARCHY };

// One board with every case a cut has to settle, written out slice by slice:
//   goal       1, 7 (a goal nested under epic 4), 18 (type written Goal)
//   strategy   2
//   objective  3
//   epic       4, 8 (8 sits loose)
//   depth 0    5 (a story right under epic 4), 9, 10 (loose), 14 (parent 99 is not on the board),
//              15 (an archived story right under goal 1), 17 (parent on another board)
//   depth 1    6 (a task under 5), 11 and 12 (a parent loop), 16 (under archived 15)
//   depth 2    13 (under 11)
// So the axis is: goal, strategy, objective, epic, 0, 1, 2.
const fixture = () => [
  card(1, { type: 'goal', tags: ['ui'] }),
  card(2, { type: 'strategy', parent: 1 }),
  card(3, { type: 'objective', parent: 2, tags: ['ui'] }),
  card(4, { type: 'epic', parent: 3 }),
  card(5, { type: 'story', parent: 4 }),
  card(6, { type: 'task', parent: 5 }),
  card(7, { type: 'goal', parent: 4, tags: ['ui'] }),
  card(8, { type: 'epic' }),
  card(9, { type: 'story' }),
  card(10),
  card(11, { type: 'task', parent: 12 }),
  card(12, { type: 'story', parent: 11 }),
  card(13, { parent: 11 }),
  card(14, { parent: 99 }),
  card(15, { type: 'story', parent: 1, archived: true, status: 'done' }),
  card(16, { parent: 15 }),
  card(17, { parent: 'other#3' }),
  card(18, { type: 'Goal' }),
];
const ALL = fixture().map((c) => c.id);

const idsOf = (query, cards = fixture(), ctx = CTX) => filterCards(cards, parseSearchQuery(query, ctx.board), ctx).map((c) => c.id).sort((a, b) => a - b);

test('slice:objective..2 matches the objective and the tiers below it and the untiered cards at depths 0 to 2, and nothing else', () => {
  assert.deepStrictEqual(idsOf('slice:objective..2'), [3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

test('slice:goal is that one slice, whatever its parent is or how its type is written', () => {
  assert.deepStrictEqual(idsOf('slice:goal'), [1, 7, 18]);
  assert.deepStrictEqual(idsOf('slice:GOAL'), [1, 7, 18]);
  assert.deepStrictEqual(idsOf('slice:goal..goal'), [1, 7, 18]);
});

test('slice:goal.. runs from that slice to the end of the axis', () => {
  assert.deepStrictEqual(idsOf('slice:goal..'), ALL);
  assert.deepStrictEqual(idsOf('slice:epic..'), [4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepStrictEqual(idsOf('slice:2..'), [13]);
});

test('slice:..objective runs from the start of the axis to that slice', () => {
  assert.deepStrictEqual(idsOf('slice:..objective'), [1, 2, 3, 7, 18]);
  assert.deepStrictEqual(idsOf('slice:..1'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18]);
});

test('a depth number names the slice of the cards with no tier at that depth', () => {
  assert.deepStrictEqual(idsOf('slice:0'), [5, 9, 10, 14, 15, 17]);
  assert.deepStrictEqual(idsOf('slice:1..2'), [6, 11, 12, 13, 16]);
  assert.deepStrictEqual(idsOf('slice:2'), [13]);
});

test('a tier that holds no card is still a slice, and cuts to nothing', () => {
  const noEpics = [card(1, { type: 'goal' }), card(2, { type: 'story', parent: 1 }), card(3)];
  assert.deepStrictEqual(idsOf('slice:epic', noEpics), []);
  assert.deepStrictEqual(idsOf('slice:epic..0', noEpics), [2, 3], 'card 2 is right under a goal, so it is depth 0');
});

test('slice:2..objective matches exactly what slice:objective..2 matches: a reversed pair is swapped', () => {
  assert.deepStrictEqual(idsOf('slice:2..objective'), idsOf('slice:objective..2'));
  assert.deepStrictEqual(idsOf('slice:2..objective'), [3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepStrictEqual(idsOf('slice:epic..goal'), idsOf('slice:goal..epic'));
  assert.deepStrictEqual(idsOf('slice:goal..epic'), [1, 2, 3, 4, 7, 8, 18]);
});

// --- ends the board does not have (R7) -----------------------------------------

test('an unknown end leaves that end open', () => {
  assert.deepStrictEqual(idsOf('slice:nowhere..objective'), idsOf('slice:..objective'));
  assert.deepStrictEqual(idsOf('slice:objective..nowhere'), idsOf('slice:objective..'));
  assert.deepStrictEqual(idsOf('slice:objective..nowhere'), [3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepStrictEqual(idsOf('slice:nowhere..objective'), [1, 2, 3, 7, 18]);
});

test('a depth the axis does not reach is an unknown end', () => {
  assert.deepStrictEqual(idsOf('slice:objective..9'), idsOf('slice:objective..'));
  assert.deepStrictEqual(idsOf('slice:objective..9'), [3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepStrictEqual(idsOf('slice:9..objective'), idsOf('slice:..objective'));
  assert.deepStrictEqual(idsOf('slice:9..objective'), [1, 2, 3, 7, 18]);
});

test('a single unknown name cuts nothing, and so do a bare slice: and slice:..', () => {
  for (const query of ['slice:nowhere', 'slice:99', 'slice:nowhere..', 'slice:..nowhere', 'slice:nowhere..alsonowhere', 'slice:..', 'slice:']) {
    assert.deepStrictEqual(idsOf(query), ALL, query);
  }
});

test('a name half typed is an unknown end, so the cut never hides every card on the way to the name', () => {
  assert.deepStrictEqual(idsOf('slice:ob'), ALL);
  assert.deepStrictEqual(idsOf('slice:objective.'), ALL, 'one dot is part of an unknown name');
  assert.deepStrictEqual(idsOf('slice:objective..e'), idsOf('slice:objective..'));
  assert.deepStrictEqual(idsOf('slice:objective..ep'), idsOf('slice:objective..'));
  assert.deepStrictEqual(idsOf('slice:objective..epic'), [3, 4, 8]);
});

test('a hierarchy listing a tier twice in mixed case, with blanks, cuts to that tier\'s cards, once', () => {
  const ctx = { ...CTX, hierarchy: ['Goal', 'goal', '', '  ', 5, null, 'Strategy', 'GOAL', 'objective', 'epic'] };
  assert.deepStrictEqual(idsOf('slice:goal', fixture(), ctx), [1, 7, 18]);
  assert.deepStrictEqual(idsOf('slice:GOAL..strategy', fixture(), ctx), [1, 2, 7, 18]);
  assert.deepStrictEqual(idsOf('slice:strategy..objective', fixture(), ctx), [2, 3]);
});

test('a hierarchy that is not a list is no hierarchy, and a context with none cuts by depth', () => {
  for (const none of [undefined, null, 'goal', {}, 7]) {
    assert.deepStrictEqual(idsOf('slice:goal', fixture(), { ...CTX, hierarchy: none }), ALL, `hierarchy ${JSON.stringify(none)} names no goal`);
  }
  const noContext = filterCards(fixture(), parseSearchQuery('slice:0'), undefined).map((c) => c.id);
  assert.deepStrictEqual(noContext, [1, 8, 9, 10, 14, 17, 18], 'the roots');
});

// --- what a card's slice does not depend on ------------------------------------

test('a goal nested under an epic is in the goal slice, and nothing warns about it', () => {
  const warned = [];
  const real = { warn: console.warn, error: console.error };
  console.warn = (...args) => warned.push(args);
  console.error = (...args) => warned.push(args);
  let goals;
  let epics;
  try {
    goals = idsOf('slice:goal');
    epics = idsOf('slice:epic');
  } finally {
    console.warn = real.warn;
    console.error = real.error;
  }
  assert.deepStrictEqual(goals, [1, 7, 18], 'card 7 is a goal under epic 4');
  assert.deepStrictEqual(epics, [4, 8]);
  assert.deepStrictEqual(warned, []);
});

test('a card is in the same slice whether its parent is in the result or filtered out of it', () => {
  const cards = fixture().map((c) => (c.id === 6 ? { ...c, tags: ['leaf'] } : c));
  assert.deepStrictEqual(idsOf('slice:1', cards), [6, 11, 12, 16], 'card 6 sits at depth 1 under card 5, with its parents on the board');
  assert.deepStrictEqual(idsOf('tags:leaf slice:1', cards), [6], 'its parents all fail tags:leaf, and the depth is the same');
  assert.deepStrictEqual(idsOf('tags:leaf slice:0', cards), [], 'it does not fall to depth 0 for want of parents in the result');
  assert.deepStrictEqual(idsOf('tags:leaf slice:goal..epic', cards), []);
  assert.deepStrictEqual(idsOf('tags:leaf slice:1..', cards), [6]);
});

test('an archived card still counts as a parent, so the cards below it keep their depth', () => {
  assert.deepStrictEqual(idsOf('slice:1'), [6, 11, 12, 16]);
  const withoutArchived = fixture().filter((c) => !c.archived);
  assert.deepStrictEqual(idsOf('slice:1', withoutArchived), [6, 11, 12], 'the subset is what a caller must never pass: card 16 would fall to depth 0');
});

test('on a board without a hierarchy every slice is a depth, and slice:1 is exactly the depth-1 cards', () => {
  const none = { board: 'kanban', priorities: CTX.priorities };
  assert.deepStrictEqual(idsOf('slice:1', fixture(), none), [2, 11, 12, 15]);
  assert.deepStrictEqual(idsOf('slice:1', fixture(), { ...none, hierarchy: [] }), [2, 11, 12, 15]);
  assert.deepStrictEqual(idsOf('slice:goal', fixture(), none), ALL, 'no tier is named goal, so no cut');
  assert.deepStrictEqual(idsOf('slice:1..2', fixture(), none), [2, 3, 11, 12, 13, 15, 16]);
});

// --- with other terms -----------------------------------------------------------

test('tags:ui (slice:goal | #12) matches the ui cards that are in the goal slice or are card 12', () => {
  const cards = fixture().map((c) => (c.id === 12 ? { ...c, tags: ['ui'] } : c));
  assert.deepStrictEqual(idsOf('tags:ui (slice:goal | #12)', cards), [1, 7, 12]);
  assert.deepStrictEqual(idsOf('tags:ui (slice:strategy..objective | #12)', cards), [3, 12]);
  assert.deepStrictEqual(idsOf('tags:ui slice:goal | #12', cards), [1, 7, 12], 'without the brackets the or binds looser than the space');
});

test('a slice: term inside an or is one alternative like any other', () => {
  assert.deepStrictEqual(idsOf('slice:strategy | slice:objective'), [2, 3]);
  assert.deepStrictEqual(idsOf('slice:strategy | #1'), [1, 2]);
  assert.deepStrictEqual(idsOf('slice:goal slice:strategy'), [], 'two terms are both asked for, and no card is in two slices');
  assert.deepStrictEqual(idsOf('slice:goal..objective slice:strategy..epic'), [2, 3]);
});

test('a quoted slice: value is read whole, so a tier named with a space can be cut to', () => {
  const ctx = { ...CTX, hierarchy: ['big goal', 'strategy'] };
  const cards = [card(1, { type: 'big goal' }), card(2, { type: 'Strategy' }), card(3, { type: 'task', parent: 2 })];
  assert.deepStrictEqual(idsOf('slice:"big goal"', cards, ctx), [1]);
  assert.deepStrictEqual(idsOf('slice:"big goal..strategy"', cards, ctx), [1, 2]);
  assert.deepStrictEqual(idsOf('slice:"strategy..big goal"', cards, ctx), [1, 2]);
});

test('the term interface writes a slice: term the parser reads back', () => {
  assert.strictEqual(searchTermText('slice', 'objective..2'), 'slice:objective..2');
  assert.strictEqual(searchTermText('slice', 'big goal..2'), 'slice:"big goal..2"');
  for (const value of ['objective..2', 'big goal..2']) {
    assert.deepStrictEqual(parseSearchQuery(searchTermText('slice', value)), [{ field: 'slice', value }], value);
  }
  assert.strictEqual(searchAddTerm('tags:ui | #12', { field: 'slice', value: 'goal..objective' }), 'tags:ui slice:goal..objective | #12 slice:goal..objective');
});

test('the parse keeps the cut as one term, and a bare slice: is not yet a term', () => {
  assert.deepStrictEqual(parseSearchQuery('slice:Objective..2'), [{ field: 'slice', value: 'Objective..2' }]);
  assert.deepStrictEqual(parseSearchQuery('slice:'), []);
  assert.deepStrictEqual(parseSearchQuery('tags:ui |  slice:'), parseSearchQuery('tags:ui'));
  assert.deepStrictEqual(parseSearchQuery('slice: tags:ui'), parseSearchQuery('tags:ui'));
});

test('an unresolved slice: term matches nothing, like tree: and path:, and is never read as text', () => {
  const first = fixture()[0];
  assert.strictEqual(first.title, 'Card 1');
  assert.strictEqual(cardMatchesQuery(first, parseSearchQuery('slice:goal')), false);
  assert.strictEqual(cardMatchesQuery(first, parseSearchQuery('slice:card')), false, 'the value card is in the title, and still the term is not text');
  assert.strictEqual(cardMatchesQuery(first, parseSearchQuery('slice:ui')), false, 'and the value ui is a tag');
});

test('a page that has not loaded the slices module cuts nothing and does not throw', () => {
  const page = vm.createContext({});
  page.window = page;
  for (const file of ['ids.js', 'dependency-graph.js', 'waiting-blocked.js', 'nesting.js', 'explore-sets.js', 'search.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', file), 'utf8'), page, { filename: file });
  }
  assert.strictEqual(typeof page.sliceCards, 'undefined', 'the stand-in page has no slices module');
  const found = page.filterCards(fixture(), page.parseSearchQuery('slice:goal'), CTX).map((c) => c.id);
  assert.strictEqual(JSON.stringify(found), JSON.stringify(ALL));
});
