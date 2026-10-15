const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseSearchQuery, filterCards, searchIsolateText, searchIsolateBox, searchIsolateRestore,
} = require('../web/search');
const {
  NO_SELECTION, cardPart, pathPart, treePart, queryPart, typedQueryPart, addPart, removeCard, resolveSelection,
} = require('../web/selection');

// Isolate writes the selection into the search box as `part | part | ...`: each part by
// its criterion, so a card that comes to match a query part joins on the next poll. These
// are the search module's half: the text a selection becomes, what that text matches
// against what the selection resolves to, and how the box's own text and its cut come
// and go. Where the page switches it on and off is pinned in isolate.test.js.

// 10 and 11 and 12 carry the grill tag. 40 waits for 41, which waits for 42; 43 waits for 41
// too, so the tree of 40 is 40 to 43 and its path (the cone through it) is 40, 41 and 42.
const card = (id, over = {}) => ({ id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], waiting_for: [], ...over });
const CARDS = [
  card(10, { tags: ['grill'] }),
  card(11, { tags: ['grill', 'ui'], status: 'doing' }),
  card(12, { tags: ['grill'] }),
  card(13, { tags: ['ui'], status: 'doing' }),
  card(40, { waiting_for: [41] }),
  card(41, { waiting_for: [42] }),
  card(42),
  card(43, { waiting_for: [41] }),
  card(99, { title: 'Alone' }),
];
const CTX = { board: 'kanban' };
const matchQuery = (text) => new Set(filterCards(CARDS, parseSearchQuery(text, 'kanban'), CTX).map((c) => c.id));
const grown = (...parts) => parts.reduce((next, part) => addPart(next, part), NO_SELECTION);
const partsOf = (selection) => (selection.anchor ? [selection.anchor].concat(selection.additions) : []);
const idsOf = (set) => [...set].sort((a, b) => a - b);

// What the isolate text matches, over the whole board, against what the selection resolves to.
const matched = (selection) => idsOf(matchQuery(searchIsolateText(partsOf(selection))));
const resolved = (selection) => idsOf(resolveSelection(selection, matchQuery, null));

test('a card is #id, a path is path:id, a tree is tree:id, a query is its text, joined by |', () => {
  assert.strictEqual(searchIsolateText([cardPart(12)]), '#12');
  assert.strictEqual(searchIsolateText([pathPart(40)]), 'path:40');
  assert.strictEqual(searchIsolateText([treePart(40)]), 'tree:40');
  assert.strictEqual(searchIsolateText([queryPart('tags:grill')]), 'tags:grill');
});

test('card 12, path 40 and tags:grill build #12 | path:40 | tags:grill, in the order the parts were added', () => {
  const selection = grown(cardPart(12), pathPart(40), queryPart('tags:grill'));
  assert.strictEqual(searchIsolateText(partsOf(selection)), '#12 | path:40 | tags:grill');
  assert.strictEqual(searchIsolateText(partsOf(grown(queryPart('tags:grill'), cardPart(12), pathPart(40)))), 'tags:grill | #12 | path:40');
});

test('a query that holds a | or spaces goes in brackets, so it stays one part when the parts are joined', () => {
  assert.strictEqual(searchIsolateText([queryPart('status:doing | status:todo'), cardPart(12)]), '(status:doing | status:todo) | #12');
  assert.strictEqual(searchIsolateText([queryPart('tags:ui status:doing'), cardPart(12)]), '(tags:ui status:doing) | #12');
});

test('a query that is one term stays as it is: a quoted value with spaces is one term, and a bracket is already one', () => {
  assert.strictEqual(searchIsolateText([queryPart('tags:"two words"'), cardPart(12)]), 'tags:"two words" | #12');
  assert.strictEqual(searchIsolateText([queryPart('(tags:ui status:doing)'), cardPart(12)]), '(tags:ui status:doing) | #12');
});

test('a search typed in the Graph is a query part like any other: bracketed when it holds spaces', () => {
  assert.strictEqual(searchIsolateText([typedQueryPart('fix auth'), cardPart(12)]), '(fix auth) | #12');
});

test('a query that is not a term yet adds nothing, as it selects nothing, and a selection of nothing writes nothing', () => {
  assert.strictEqual(searchIsolateText([queryPart('status:'), cardPart(12)]), '#12');
  assert.strictEqual(searchIsolateText([queryPart('status:')]), '', 'a lone half-typed term would otherwise isolate every card');
  assert.strictEqual(searchIsolateText([queryPart('   ')]), '');
  assert.strictEqual(searchIsolateText([]), '');
});

test('the text a card, a path, a tree and each kind of query make matches exactly the cards the selection resolves to', () => {
  const selections = {
    card: grown(cardPart(12)),
    cards: grown(cardPart(12), cardPart(99)),
    path: grown(pathPart(40)),
    tree: grown(treePart(40)),
    'a query with no | and no spaces': grown(queryPart('tags:grill')),
    'a query with spaces': grown(queryPart('tags:grill status:doing')),
    'a query with a |': grown(queryPart('status:doing | #99')),
    'a query beside cards': grown(cardPart(13), queryPart('tags:grill status:todo'), pathPart(41)),
    'everything at once': grown(cardPart(99), pathPart(43), treePart(10), queryPart('tags:ui | tags:grill')),
  };
  for (const [name, selection] of Object.entries(selections)) {
    assert.deepStrictEqual(matched(selection), resolved(selection), name);
    assert.ok(resolved(selection).length > 0, `${name} selects something`);
  }
  assert.deepStrictEqual(resolved(selections.path), [40, 41, 42]);
  assert.deepStrictEqual(resolved(selections.tree), [40, 41, 42, 43]);
});

test('a query part with one card taken out is its other cards, and its text matches exactly them', () => {
  const selection = grown(queryPart('tags:grill'), pathPart(40));
  const without = removeCard(selection, 11, matchQuery);
  assert.deepStrictEqual(partsOf(without), [cardPart(10), cardPart(12), pathPart(40)], 'the grill query became its other cards; the path never reached card 11');
  assert.strictEqual(searchIsolateText(partsOf(without)), '#10 | #12 | path:40');
  assert.deepStrictEqual(matched(without), resolved(without));
  assert.ok(!matched(without).includes(11), 'the card taken out is not shown');
});

test('a card taken out of a path leaves the path as its other cards, not as the path', () => {
  const selection = grown(pathPart(40));
  const without = removeCard(selection, 42, matchQuery);
  assert.strictEqual(searchIsolateText(partsOf(without)), '#40 | #41');
  assert.deepStrictEqual(matched(without), [40, 41]);
});

test('a query part keeps its criterion: a card that comes to match joins the shown set', () => {
  const selection = grown(cardPart(99), queryPart('tags:grill'));
  const text = searchIsolateText(partsOf(selection));
  const shown = () => idsOf(new Set(filterCards(CARDS, parseSearchQuery(text, 'kanban'), CTX).map((c) => c.id)));
  assert.deepStrictEqual(shown(), [10, 11, 12, 99]);
  CARDS.find((c) => c.id === 13).tags.push('grill');
  try {
    assert.deepStrictEqual(shown(), [10, 11, 12, 13, 99], 'card 13 was tagged after the text was written');
  } finally {
    CARDS.find((c) => c.id === 13).tags.pop();
  }
});

test('writing the text does not change the parts it was given', () => {
  const parts = partsOf(grown(cardPart(12), queryPart('tags:ui status:doing')));
  const before = JSON.stringify(parts);
  searchIsolateText(parts);
  assert.strictEqual(JSON.stringify(parts), before);
});

// --- the box: the text and the cut ----------------------------------------------------

test('on a box with no cut the box becomes the isolate text alone', () => {
  assert.strictEqual(searchIsolateBox('review:', [cardPart(12), pathPart(40)]), '#12 | path:40');
  assert.strictEqual(searchIsolateBox('', [cardPart(12)]), '#12');
});

test('the run of slices the box held stays in it, applied to all of the isolated cards, so isolate shows what the selection resolved to', () => {
  assert.strictEqual(searchIsolateBox('tags:ui slice:epic..2', [cardPart(12), pathPart(40)]), '(#12 | path:40) slice:epic..2');
  assert.strictEqual(searchIsolateBox('slice:1', [cardPart(12)]), '#12 slice:1');
  assert.strictEqual(searchIsolateBox('review: slice:1', [cardPart(12)]), '#12 slice:1', 'the previous text goes, its cut stays');
});

test('no part to write means no box text at all', () => {
  assert.strictEqual(searchIsolateBox('review:', []), '');
  assert.strictEqual(searchIsolateBox('review: slice:1', [queryPart('status:')]), '');
});

test('turning it off gives the box back the text it held, exactly as it was typed', () => {
  assert.strictEqual(searchIsolateRestore('#12 | path:40', 'review: | blocked:'), 'review: | blocked:');
  assert.strictEqual(searchIsolateRestore('#12 | path:40', ''), '');
  assert.strictEqual(searchIsolateRestore('(#12 | path:40) slice:epic..2', 'slice:epic..2 tags:ui'), 'slice:epic..2 tags:ui', 'a cut that did not move leaves the text untouched');
});

test('a cut changed while isolated is kept: the run of slices is not part of what isolate takes away', () => {
  assert.strictEqual(searchIsolateRestore('#12 slice:1..2', 'tags:ui'), 'tags:ui slice:1..2');
  assert.strictEqual(searchIsolateRestore('#12 slice:1..2', 'tags:ui slice:epic'), 'tags:ui slice:1..2');
  assert.strictEqual(searchIsolateRestore('#12', 'tags:ui slice:epic'), 'tags:ui', 'a cut taken off while isolated stays off');
  assert.strictEqual(searchIsolateRestore('(#12 | #13) slice:1', 'tags:ui | tags:grill'), '(tags:ui | tags:grill) slice:1');
});

// --- the box's own text, outside the Graph ---------------------------------------------
// Outside the Graph the box hides what it does not match, and a selection only covers the cards the
// view shows, so a path, a tree or a card picked by hand reaches only those of them the box
// leaves. Isolate writes the selection into the box, so the text the box held goes on hiding what
// it hid, or the cards it hid would come back (`limits`). In the Graph the box only lights and
// the previous text is not kept.

const SHOWN_BY = [
  card(40, { tags: ['ui'], waiting_for: [41] }),
  card(41, { waiting_for: [42] }),
  card(42, { tags: ['ui'] }),
  card(43, { waiting_for: [41] }),
  card(50, { tags: ['ui'] }),
  card(51),
];
const shownMatch = (text) => new Set(filterCards(SHOWN_BY, parseSearchQuery(text, 'kanban'), CTX).map((c) => c.id));
const shownBy = (box) => (box.trim() ? shownMatch(box) : new Set(SHOWN_BY.map((c) => c.id)));
// What the selection resolves to over the cards the view shows (the box's), and what the isolate text matches.
const resolvedBy = (selection, box) => idsOf(resolveSelection(selection, shownMatch, shownBy(box)));
const isolatedBy = (box, selection, limits) => idsOf(shownMatch(searchIsolateBox(box, partsOf(selection), { limits })));

test('a path picked under tags:ui reaches the ui cards of the path, and isolate writes the box\'s text on, so card 41 stays hidden', () => {
  const selection = grown(pathPart(40));
  assert.deepStrictEqual(resolvedBy(selection, 'tags:ui'), [40, 42]);
  assert.strictEqual(searchIsolateBox('tags:ui', partsOf(selection), { limits: true }), 'path:40 tags:ui');
  assert.deepStrictEqual(isolatedBy('tags:ui', selection, true), [40, 42]);
  assert.deepStrictEqual(isolatedBy('tags:ui', selection, false), [40, 41, 42], 'without it the text brings card 41 back');
});

test('a tree and a card picked by hand are held to the box the same way, and several parts are bracketed once', () => {
  const tree = grown(treePart(40));
  assert.deepStrictEqual(resolvedBy(tree, 'tags:ui'), [40, 42]);
  assert.deepStrictEqual(isolatedBy('tags:ui', tree, true), [40, 42]);
  const mixed = grown(cardPart(50), pathPart(40), cardPart(51));
  assert.deepStrictEqual(resolvedBy(mixed, 'tags:ui'), [40, 42, 50], 'card 51 is not ui, so the box hides it and the selection never held it');
  assert.strictEqual(searchIsolateBox('tags:ui', partsOf(mixed), { limits: true }), '(#50 | path:40 | #51) tags:ui');
  assert.deepStrictEqual(isolatedBy('tags:ui', mixed, true), [40, 42, 50]);
});

test('a box that holds | alternatives is bracketed, and its cut stays at the top level', () => {
  const selection = grown(pathPart(40));
  assert.strictEqual(searchIsolateBox('tags:ui | #43', partsOf(selection), { limits: true }), 'path:40 (tags:ui | #43)');
  assert.deepStrictEqual(isolatedBy('tags:ui | #43', selection, true), resolvedBy(selection, 'tags:ui | #43'));
  assert.strictEqual(searchIsolateBox('tags:ui slice:epic..2', partsOf(selection), { limits: true }), 'path:40 tags:ui slice:epic..2');
  assert.strictEqual(searchIsolateBox('slice:epic..2', partsOf(selection), { limits: true }), 'path:40 slice:epic..2', 'the cut alone is the cut: no text to keep');
});

test('an empty box, a box with no term yet, and a selection of queries alone add nothing to the isolate text', () => {
  const selection = grown(pathPart(40));
  assert.strictEqual(searchIsolateBox('', partsOf(selection), { limits: true }), 'path:40');
  assert.strictEqual(searchIsolateBox('status:', partsOf(selection), { limits: true }), 'path:40', 'a half-typed term shows everything');
  const pills = grown(queryPart('tags:ui'), queryPart('review:'));
  assert.strictEqual(searchIsolateBox('tags:ui | review:', partsOf(pills), { limits: true }), 'tags:ui | review:', 'a pill\'s query is in the box already and is the box\'s alternative');
});

test('the box does not limit the isolate text in the Graph, where it only lights', () => {
  const selection = grown(typedQueryPart('tags:ui'), cardPart(51));
  assert.strictEqual(searchIsolateBox('tags:ui', partsOf(selection)), 'tags:ui | #51');
  assert.strictEqual(searchIsolateBox('tags:ui', partsOf(selection), { limits: false }), 'tags:ui | #51');
});

test('with a path, a tree or a card in the selection the isolate text matches what the selection resolves to over the box\'s cards, whatever the box', () => {
  const boxes = ['tags:ui', 'tags:ui | #43', '41 | #40', 'status:todo', '(tags:ui | #51) #50'];
  const selections = [grown(pathPart(40)), grown(treePart(41)), grown(cardPart(50), cardPart(51)), grown(queryPart('tags:ui'), pathPart(41))];
  for (const box of boxes) {
    for (const selection of selections) {
      const text = searchIsolateBox(box, partsOf(selection), { limits: true });
      const want = resolvedBy(selection, box);
      assert.deepStrictEqual(idsOf(shownMatch(text)), want, `${JSON.stringify(partsOf(selection))} under ${box}`);
    }
  }
});
