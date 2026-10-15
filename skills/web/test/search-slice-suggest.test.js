const { test, after } = require('node:test');
const assert = require('node:assert');

const { parseSearchQuery, filterCards, searchSuggestionItems } = require('../web/search');
const { graphLayoutTiers, graphPlan } = require('../web/graph-model');
const { STATUSES, loadBoard, cleanUp, drawnModel } = require('./helpers/fan-boards');

// The search box suggests what a slice: term can say. After `slice:` and after `..`
// it lists the board's slices: the tiers of its hierarchy in hierarchy order, then
// the depth numbers, 0 to the deepest card with no tier. Picking one completes the term. The seam is
// searchSuggestionItems(text, caret, cards, ctx): the text and caret as the box has
// them and the whole board and its context, the arguments filterCards takes, so the
// suggestions and the cut read one axis. Without the board there is nothing to
// suggest from, which is how the function was called before.

after(cleanUp);

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], file: `${String(id).padStart(4, '0')}.card.md`,
  assignee: null, type: null, waiting_for: [], blocked: null, review: null, parent: null, rank: null, archived: false, ...over,
});

const HIERARCHY = ['goal', 'strategy', 'objective', 'epic'];
const CTX = { board: 'kanban', hierarchy: HIERARCHY };

// The board of search-slice.test.js: goal 1, 7, 18; strategy 2; objective 3; epic 4, 8;
// depth 0 holds 9, 10, 14, 17; depth 1 holds 11, 12, 15; depth 2 holds 13, 16; depth 3
// holds nothing; depth 4 holds 5 and depth 5 holds 6. The axis is goal, strategy,
// objective, epic, 0, 1, 2, 3, 4, 5, and depth 3 has no card.
const fixture = () => [
  card(1, { type: 'goal' }),
  card(2, { type: 'strategy', parent: 1 }),
  card(3, { type: 'objective', parent: 2 }),
  card(4, { type: 'epic', parent: 3 }),
  card(5, { type: 'story', parent: 4 }),
  card(6, { type: 'task', parent: 5 }),
  card(7, { type: 'goal', parent: 4 }),
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

const SLICES = ['goal', 'strategy', 'objective', 'epic', '0', '1', '2', '3', '4', '5'];
const suggest = (text, caret, cards = fixture(), ctx = CTX) => searchSuggestionItems(text, caret, cards, ctx);
const labels = (items) => items.map((i) => i.label);
const idsOf = (query, cards = fixture(), ctx = CTX) => filterCards(cards, parseSearchQuery(query, ctx.board), ctx).map((c) => c.id).sort((a, b) => a - b);

test('after slice: the box lists the tiers in hierarchy order, then the depth numbers from 0 to the deepest card with no tier', () => {
  assert.deepStrictEqual(suggest('slice:').map((i) => [i.label, i.value]), SLICES.map((s) => [`slice:${s}`, `slice:${s}`]));
});

test('every tier the hierarchy names is suggested whether a card is in it or not, and so is every depth down to the deepest card with no tier', () => {
  const none = [card(1, { type: 'epic' }), card(2, { parent: 1 })];
  assert.deepStrictEqual(labels(suggest('slice:', undefined, none, { board: 'kanban', hierarchy: ['goal', 'epic'] })), ['slice:goal', 'slice:epic', 'slice:0', 'slice:1'], 'nobody is in goal, and nobody untiered is at depth 0');
  assert.ok(labels(suggest('slice:')).includes('slice:3'), 'depth 3 of the board holds no card, and is on the axis between depths 2 and 4');
  assert.ok(!labels(suggest('slice:')).includes('slice:6'), 'no card is deeper than depth 5');
});

test('after .. the box lists the same slices, each completing the second end and keeping the first', () => {
  assert.deepStrictEqual(suggest('slice:goal..').map((i) => [i.label, i.value]), SLICES.map((s) => [`slice:goal..${s}`, `slice:goal..${s}`]));
  assert.deepStrictEqual(labels(suggest('slice:..')), SLICES.map((s) => `slice:..${s}`), 'an open first end');
  assert.deepStrictEqual(labels(suggest('slice:2..')), SLICES.map((s) => `slice:2..${s}`), 'a depth for the first end');
});

test('what is typed after the colon or the dots narrows the list to the slices that start with it, in any letter case', () => {
  assert.deepStrictEqual(labels(suggest('slice:e')), ['slice:epic']);
  assert.deepStrictEqual(labels(suggest('slice:OB')), ['slice:objective']);
  assert.deepStrictEqual(labels(suggest('slice:goal..s')), ['slice:goal..strategy']);
  assert.deepStrictEqual(labels(suggest('SLICE:goal..EP')), ['slice:goal..epic'], 'the scope is case-blind, as the parser reads it');
  assert.deepStrictEqual(labels(suggest('slice:zzz')), [], 'a name the board does not have suggests nothing');
});

test('a slice already typed in full completes nothing more, but a longer name or number it begins is still offered', () => {
  assert.deepStrictEqual(suggest('slice:goal'), []);
  assert.deepStrictEqual(suggest('slice:goal..epic'), []);
  assert.deepStrictEqual(suggest('slice:GOAL'), [], 'letter case alone is not a completion');
  const deep = Array.from({ length: 12 }, (_, i) => card(i + 1, { parent: i ? i : null }));
  assert.deepStrictEqual(labels(suggest('slice:1', undefined, deep, { board: 'kanban', hierarchy: [] })), ['slice:10', 'slice:11']);
});

test('only the token under the caret is completed, whatever stands around it', () => {
  const dots = (text) => suggest(text).map((i) => i.value);
  assert.strictEqual(dots('tags:ui slice:e').length, 1);
  assert.deepStrictEqual(dots('tags:ui slice:e'), ['tags:ui slice:epic']);
  assert.deepStrictEqual(dots('(status:todo | slice:e'), ['(status:todo | slice:epic']);
  assert.deepStrictEqual(dots('(slice:e'), ['(slice:epic']);
  assert.deepStrictEqual(suggest('slice:e tags:ui', 7).map((i) => i.value), ['slice:epic tags:ui'], 'the text after the token is kept');
  assert.deepStrictEqual(suggest('slice:e tags:ui', 12), [], 'a caret in the next term is that term\'s business');
});

test('a caret in the first end of a cut completes the first end and keeps what follows the dots, a caret after the dots completes the second', () => {
  assert.deepStrictEqual(suggest('slice:g..epic', 7).map((i) => i.value), ['slice:goal..epic']);
  assert.deepStrictEqual(suggest('slice:g..e', 10).map((i) => i.value), ['slice:g..epic'], 'the first end is left as typed');
  assert.deepStrictEqual(suggest('slice:..e', 9).map((i) => i.value), ['slice:..epic']);
  assert.strictEqual(suggest('slice:..', 8).length, SLICES.length);
});

test('a board with no hierarchy suggests its depths alone, and a board with no cards suggests nothing', () => {
  assert.deepStrictEqual(labels(suggest('slice:', undefined, fixture(), { board: 'kanban' })), ['slice:0', 'slice:1', 'slice:2', 'slice:3', 'slice:4', 'slice:5'], 'with no tier to hold card 4, depth 3 has a card');
  assert.deepStrictEqual(labels(suggest('slice:', undefined, [], CTX)), ['slice:goal', 'slice:strategy', 'slice:objective', 'slice:epic']);
  assert.deepStrictEqual(suggest('slice:', undefined, [], { board: 'kanban' }), []);
});

test('called without the board, as before, a slice: token suggests nothing and every other token suggests as it always did', () => {
  assert.deepStrictEqual(searchSuggestionItems('slice:'), []);
  assert.deepStrictEqual(searchSuggestionItems('slice:e', 7), []);
  assert.deepStrictEqual(labels(searchSuggestionItems('slice:', 6, fixture())), ['slice:0', 'slice:1', 'slice:2', 'slice:3', 'slice:4', 'slice:5'], 'cards and no context: a board with no hierarchy');
  assert.strictEqual(searchSuggestionItems('sta')[0].label, 'sta');
  assert.deepStrictEqual(suggest('sta'), searchSuggestionItems('sta'), 'a token with no slice: in it is the same with the board');
});

test('every suggestion is a term that cuts to the slice or run it names, and the cut is the one the term would make typed by hand', () => {
  const byTerm = {
    'slice:goal': [1, 7, 18], 'slice:strategy': [2], 'slice:objective': [3], 'slice:epic': [4, 8],
    'slice:0': [9, 10, 14, 17], 'slice:1': [11, 12, 15], 'slice:2': [13, 16], 'slice:3': [], 'slice:4': [5], 'slice:5': [6],
  };
  assert.strictEqual(suggest('slice:').length, Object.keys(byTerm).length, 'a suggestion for every slice of the axis');
  for (const item of suggest('slice:')) assert.deepStrictEqual(idsOf(item.value), byTerm[item.value], item.value);
  assert.ok(suggest('slice:strategy..').length > 0);
  for (const item of suggest('slice:strategy..')) {
    const [, to] = item.value.slice('slice:'.length).split('..');
    assert.ok(idsOf(item.value).length > 0, `${item.value} cuts to something`);
    assert.ok(byTerm[`slice:${to}`].every((id) => idsOf(item.value).includes(id)), `${item.value} holds the cards of its second end`);
  }
});

test('a tier written with a space is offered as one quoted term, and in a cut the quote holds both ends, which is how the parser reads it', () => {
  const ctx = { board: 'kanban', hierarchy: ['big goal', 'epic'] };
  const cards = [card(1, { type: 'big goal' }), card(2, { type: 'epic', parent: 1 }), card(3, { parent: 2 })];
  assert.deepStrictEqual(labels(suggest('slice:', undefined, cards, ctx)), ['slice:"big goal"', 'slice:epic', 'slice:0', 'slice:1', 'slice:2']);
  assert.deepStrictEqual(labels(suggest('slice:epic..', undefined, cards, ctx)), ['slice:"epic..big goal"', 'slice:epic..epic', 'slice:epic..0', 'slice:epic..1', 'slice:epic..2']);
  assert.deepStrictEqual(labels(suggest('slice:"big go', undefined, cards, ctx)), ['slice:"big goal"'], 'a quote still open is completed and shut');
  assert.deepStrictEqual(labels(suggest('slice:"big goal..e', undefined, cards, ctx)), ['slice:"big goal..epic"']);
  assert.deepStrictEqual(idsOf('slice:"big goal"', cards, ctx), [1]);
  assert.deepStrictEqual(idsOf('slice:"epic..big goal"', cards, ctx), [1, 2], 'the reversed pair, quoted whole, cuts the run');
  assert.deepStrictEqual(idsOf('slice:"big goal..epic"', cards, ctx), [1, 2]);
});

test('a hierarchy with a tier written twice, a blank entry or no list at all gives a list and throws nothing', () => {
  const cards = [card(1, { type: 'Goal' }), card(2, { type: 'epic', parent: 1 })];
  assert.deepStrictEqual(labels(suggest('slice:', undefined, cards, { board: 'kanban', hierarchy: ['Goal', 'goal', '', null, 7, 'Epic', 'EPIC'] })), ['slice:Goal', 'slice:Epic'], 'each tier once, as first written');
  for (const hierarchy of [undefined, null, 'goal', 7, {}]) {
    assert.deepStrictEqual(labels(suggest('slice:', undefined, cards, { board: 'kanban', hierarchy })), ['slice:0', 'slice:1'], String(hierarchy));
  }
  for (const text of ['slice:"', 'slice:""', 'slice:..', 'slice:....', 'slice:"..', 'slice:)', '(slice:', 'slice:|', '|slice:']) {
    for (let at = 0; at <= text.length; at++) assert.doesNotThrow(() => suggest(text, at), `${text} at ${at}`);
  }
});

// A caption of the tier fan and the box say the same words. The tip of a caption shows the
// slice: term that cuts to its band, and the box offers that term after `slice:`, so a
// reader can type what a caption shows and a caption never shows what the box would not
// have offered. The plan board is the browser runner's own fixture.
test('the slice: term in the tip of each caption of the fan is one the box offers on that board', () => {
  const board = loadBoard('plan');
  const opts = { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title };
  const model = drawnModel(board);
  const plan = graphPlan(model, graphLayoutTiers(model, { statuses: STATUSES }), opts);
  const terms = plan.captions.map((c) => c.tip.term).filter((t) => t !== null);
  assert.deepStrictEqual(plan.captions.filter((c) => c.tip.term === null).map((c) => c.name), ['unnested'], 'the ring of unnested cards is no slice, so it names none');
  assert.ok(terms.length >= 6, 'the plan board draws its four tiers and some depth rings');
  assert.ok(terms.includes('slice:goal') && terms.includes('slice:1'));
  const offered = suggest('slice:', undefined, board.all, { ...board.ctx, hierarchy: board.config.hierarchy }).map((i) => i.value);
  for (const term of terms) assert.ok(offered.includes(term), `${term} is offered`);
});
