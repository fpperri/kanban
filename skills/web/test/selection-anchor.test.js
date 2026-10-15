const { test } = require('node:test');
const assert = require('node:assert');
const {
  NO_SELECTION, cardPart, pathPart, treePart, queryPart, setAnchor, addPart, selectionFromParts, rangeStartOf, resolveSelection, removeCard, stepBack, pruneSelectionParts,
  cardClickAction, shiftAddsRange, selectionAfterClick,
} = require('../web/selection');
const { parseSearchQuery, filterCards } = require('../web/search');

// The selection grows from an anchor (one card or one query) by an ordered list
// of additions (cards, paths, trees, queries). These are the pure operations on
// it, and the id set it resolves to; the page's plumbing is pinned in
// selection-plumbing.test.js.

const parts = (selection) => [selection.anchor, ...selection.additions];

test('an empty selection has no anchor and no additions', () => {
  assert.strictEqual(NO_SELECTION.anchor, null);
  assert.deepStrictEqual(NO_SELECTION.additions, []);
});

test('setting the anchor drops every addition', () => {
  let s = setAnchor(NO_SELECTION, cardPart(1));
  s = addPart(s, cardPart(2));
  s = addPart(s, pathPart(3));
  assert.strictEqual(s.additions.length, 2);
  const next = setAnchor(s, cardPart(9));
  assert.deepStrictEqual(next, { anchor: cardPart(9), additions: [] });
  assert.strictEqual(s.additions.length, 2, 'the selection handed in is not changed');
});

test('additions keep the order they were added in', () => {
  let s = setAnchor(NO_SELECTION, cardPart(5));
  s = addPart(s, treePart(7));
  s = addPart(s, cardPart(2));
  s = addPart(s, queryPart('tags:ui'));
  s = addPart(s, pathPart(4));
  assert.deepStrictEqual(parts(s), [cardPart(5), treePart(7), cardPart(2), queryPart('tags:ui'), pathPart(4)]);
});

test('the first part added to an empty selection becomes its anchor', () => {
  const s = addPart(NO_SELECTION, cardPart(4));
  assert.deepStrictEqual(s, { anchor: cardPart(4), additions: [] });
  assert.deepStrictEqual(addPart(s, cardPart(6)), { anchor: cardPart(4), additions: [cardPart(6)] });
});

test('adding a part the selection already holds changes nothing', () => {
  let s = setAnchor(NO_SELECTION, cardPart(1));
  s = addPart(s, pathPart(2));
  assert.strictEqual(addPart(s, cardPart(1)), s, 'the anchor again');
  assert.strictEqual(addPart(s, pathPart(2)), s, 'an addition again');
  assert.notStrictEqual(addPart(s, treePart(2)), s, 'a tree is not the path of the same card');
});

test('a selection built from parts takes the first as the anchor and counts a repeated part once', () => {
  assert.strictEqual(selectionFromParts([]), NO_SELECTION);
  assert.deepStrictEqual(selectionFromParts([cardPart(3), pathPart(4), cardPart(3), queryPart('tags:ui')]), { anchor: cardPart(3), additions: [pathPart(4), queryPart('tags:ui')] });
});

test('the range start a selection implies is its anchor card, and none for any other anchor', () => {
  assert.strictEqual(rangeStartOf(setAnchor(NO_SELECTION, cardPart(7))), 7);
  assert.strictEqual(rangeStartOf(addPart(setAnchor(NO_SELECTION, cardPart(7)), cardPart(8))), 7, 'the additions do not move it');
  for (const part of [pathPart(7), treePart(7), queryPart('tags:ui')]) assert.strictEqual(rangeStartOf(setAnchor(NO_SELECTION, part)), null, part.kind);
  assert.strictEqual(rangeStartOf(NO_SELECTION), null);
});

test('the part builders keep ids as numbers, so a card read from a data attribute and one read from a card are the same part', () => {
  assert.deepStrictEqual(cardPart('12'), cardPart(12));
  assert.deepStrictEqual(pathPart('12'), { kind: 'path', id: 12 });
  assert.deepStrictEqual(treePart('12'), { kind: 'tree', id: 12 });
  assert.deepStrictEqual(queryPart('tags:ui'), { kind: 'query', text: 'tags:ui' });
});

// --- what a selection resolves to ---------------------------------------------------
// The cards of a small board, with one waiting chain (2 waits for 1, 3 waits for 2),
// one stranger (4), a done card (5) and an archived card (6) that waits for 1.
const CARDS = [
  { id: 1, title: 'one', body: '', status: 'doing', priority: 'Normal', tags: ['ui'], assignee: '@human' },
  { id: 2, title: 'two', body: '', status: 'todo', priority: 'Normal', tags: ['ui', 'grill'], waiting_for: [1] },
  { id: 3, title: 'three', body: '', status: 'todo', priority: 'Normal', tags: [], waiting_for: [2] },
  { id: 4, title: 'four', body: '', status: 'todo', priority: 'Normal', tags: ['grill'], blocked: 'vendor' },
  { id: 5, title: 'five', body: '', status: 'done', priority: 'Normal', tags: ['ui'] },
  { id: 6, title: 'six', body: '', status: 'done', priority: 'Normal', tags: [], archived: true, waiting_for: [1] },
];
const ALL = new Set(CARDS.map((c) => c.id));

// The matcher the page hands in: the search module over the whole board.
const match = (text) => new Set(filterCards(CARDS, parseSearchQuery(text), {}).map((c) => c.id));
const resolve = (selection, shown = ALL) => [...resolveSelection(selection, match, shown)];
const selectionOf = (...list) => list.reduce((s, part) => addPart(s, part), NO_SELECTION);

test('a card part resolves to that card', () => {
  assert.deepStrictEqual(resolve(selectionOf(cardPart(3))), [3]);
});

test('a path part resolves to the cards the path: term matches, and a tree part to those of tree:', () => {
  assert.deepStrictEqual([...match('path:2')], [1, 2, 3], 'the board: upstream 1, card 2, downstream 3, and not the sibling branch 6');
  assert.deepStrictEqual(resolve(selectionOf(pathPart(2))), [1, 2, 3]);
  assert.deepStrictEqual([...match('tree:2')], [1, 2, 3, 6]);
  assert.deepStrictEqual(resolve(selectionOf(treePart(2))), [1, 2, 3, 6]);
  assert.deepStrictEqual(resolve(selectionOf(treePart(4))), [4], 'a card with no relations is its own tree');
});

test('a query part resolves to the cards the search module matches for that text', () => {
  assert.deepStrictEqual(resolve(selectionOf(queryPart('tags:ui'))), [1, 2, 5]);
  assert.deepStrictEqual(resolve(selectionOf(queryPart('blocked:'))), [4]);
  assert.deepStrictEqual(resolve(selectionOf(queryPart('status:todo tags:grill'))), [2, 4]);
});

test('the selection is the union of its parts, each card once, in the order the parts were added', () => {
  const s = selectionOf(queryPart('tags:grill'), cardPart(5), pathPart(2), cardPart(4));
  assert.deepStrictEqual(resolve(s), [2, 4, 5, 1, 3], 'the query (2, 4), the card (5), the new cards of the path (1, 3); card 2 and 4 come back and count once');
});

test('a card the view hides never joins: a status pill, the Archive pill or the search box can take it out of the shown set', () => {
  const s = selectionOf(cardPart(1), queryPart('tags:ui'), pathPart(2), treePart(1));
  const withoutStatusPill = new Set([1, 2, 3, 4, 6]);
  assert.deepStrictEqual(resolve(s, withoutStatusPill), [1, 2, 3, 6], 'card 5 is a done card the Done pill hides');
  const withoutArchive = new Set([1, 2, 3, 4, 5]);
  assert.deepStrictEqual(resolve(selectionOf(treePart(1)), withoutArchive), [1, 2, 3], 'card 6 is archived and the Archive pill is off');
  const boxMatches = new Set([2, 3]);
  assert.deepStrictEqual(resolve(selectionOf(cardPart(1), cardPart(2), queryPart('status:todo')), boxMatches), [2, 3], 'the box matches 2 and 3 only');
});

test('the parts persist: a card the view stops hiding joins again without being picked again', () => {
  const s = selectionOf(cardPart(5), queryPart('tags:grill'));
  assert.deepStrictEqual(resolve(s, new Set([2, 4])), [2, 4]);
  assert.deepStrictEqual(resolve(s), [5, 2, 4]);
});

test('a limit of null shows everything, and the limit may be given as a function', () => {
  const s = selectionOf(cardPart(6));
  assert.deepStrictEqual(resolve(s, null), [6]);
  assert.deepStrictEqual(resolve(s, () => new Set([6])), [6]);
  assert.deepStrictEqual(resolve(s, () => new Set([1])), []);
});

test('the shown ids are asked for once, and not at all when there is nothing to resolve', () => {
  let asked = 0;
  const shown = () => { asked++; return ALL; };
  assert.strictEqual(resolveSelection(NO_SELECTION, match, shown).size, 0);
  assert.strictEqual(asked, 0);
  resolveSelection(selectionOf(cardPart(1), queryPart('tags:ui'), pathPart(2)), match, shown);
  assert.strictEqual(asked, 1);
});

test('a part whose card is gone resolves to nothing, without error', () => {
  assert.deepStrictEqual(resolve(selectionOf(cardPart(99))), []);
  assert.deepStrictEqual(resolve(selectionOf(pathPart(99))), []);
  assert.deepStrictEqual(resolve(selectionOf(treePart(99))), []);
  assert.deepStrictEqual(resolve(selectionOf(cardPart(99), cardPart(3))), [3], 'and it does not take the other parts with it');
});

test('a query that matches nothing resolves to nothing, without error', () => {
  assert.deepStrictEqual(resolve(selectionOf(queryPart('tags:nothing-has-this'))), []);
  assert.deepStrictEqual(resolve(selectionOf(queryPart('tags:nothing-has-this'), cardPart(1))), [1]);
});

test('a query with no text resolves to nothing, never to every card, and never asks the matcher', () => {
  let asked = 0;
  const counting = (text) => { asked++; return match(text); };
  for (const text of ['', '   ']) {
    assert.deepStrictEqual([...resolveSelection(selectionOf(queryPart(text)), counting, ALL)], [], JSON.stringify(text));
  }
  assert.strictEqual(asked, 0);
});

test('the selection handed in is not changed by resolving it', () => {
  const s = selectionOf(cardPart(1), queryPart('tags:ui'));
  const before = JSON.stringify(s);
  resolve(s, new Set([1]));
  assert.strictEqual(JSON.stringify(s), before);
});

// --- taking a card out --------------------------------------------------------------

const without = (selection, id) => removeCard(selection, id, match);

test('taking out a card part removes only that part', () => {
  const s = selectionOf(cardPart(1), cardPart(2), queryPart('blocked:'));
  const next = without(s, 2);
  assert.deepStrictEqual(parts(next), [cardPart(1), queryPart('blocked:')], 'a part that does not reach card 2 is left whole');
});

test('taking one card out of a query part turns that part into its other cards', () => {
  const s = selectionOf(cardPart(5), queryPart('tags:ui'));
  const next = without(s, 2);
  assert.deepStrictEqual(parts(next), [cardPart(5), cardPart(1)], 'tags:ui is 1, 2 and 5; 5 is already a part, so it is not added twice');
  assert.deepStrictEqual(resolve(next), [5, 1]);
});

test('taking one card out of a path part or a tree part turns that part into its other cards, in the matcher\'s order', () => {
  assert.deepStrictEqual(parts(without(selectionOf(pathPart(2)), 2)), [cardPart(1), cardPart(3)]);
  assert.deepStrictEqual(parts(without(selectionOf(cardPart(4), treePart(2)), 2)), [cardPart(4), cardPart(1), cardPart(3), cardPart(6)]);
});

test('the other cards of a part are the ones it reaches on the whole board, not only the ones the view shows', () => {
  const next = without(selectionOf(queryPart('tags:ui')), 1);
  assert.deepStrictEqual(parts(next), [cardPart(2), cardPart(5)]);
  assert.deepStrictEqual(resolve(next, new Set([2])), [2], 'card 5 stays a part and stays hidden');
  assert.deepStrictEqual(resolve(next), [2, 5], 'and it joins when the view shows it again');
});

test('a card that sits in several parts comes out of all of them', () => {
  const s = selectionOf(cardPart(2), queryPart('tags:grill'), pathPart(1));
  assert.deepStrictEqual(parts(without(s, 2)), [cardPart(4), cardPart(1), cardPart(3), cardPart(6)]);
});

test('taking out a card no part reaches changes nothing', () => {
  const s = selectionOf(cardPart(1), queryPart('tags:grill'));
  assert.strictEqual(without(s, 3), s);
  assert.strictEqual(without(NO_SELECTION, 3), NO_SELECTION);
});

test('when the anchor card is taken out, the first addition becomes the anchor and the rest stay additions', () => {
  const s = selectionOf(cardPart(1), cardPart(2), cardPart(3));
  assert.deepStrictEqual(without(s, 1), { anchor: cardPart(2), additions: [cardPart(3)] });
});

test('when the anchor is a query and one of its cards is taken out, its other cards come first and the first of them is the anchor', () => {
  const s = selectionOf(queryPart('tags:ui'), cardPart(4));
  assert.deepStrictEqual(without(s, 1), { anchor: cardPart(2), additions: [cardPart(5), cardPart(4)] });
});

test('taking out the only card empties the selection, and the empty selection then takes the next card as its anchor', () => {
  const s = selectionOf(cardPart(4));
  assert.deepStrictEqual(without(s, 4), NO_SELECTION);
  assert.deepStrictEqual(addPart(without(s, 4), cardPart(2)), { anchor: cardPart(2), additions: [] });
});

test('taking out the last card of a query part empties the selection', () => {
  assert.deepStrictEqual(without(selectionOf(queryPart('blocked:')), 4), NO_SELECTION);
});

test('taking a card out does not change the selection handed in', () => {
  const s = selectionOf(cardPart(1), queryPart('tags:ui'));
  const before = JSON.stringify(s);
  without(s, 2);
  assert.strictEqual(JSON.stringify(s), before);
});

// --- stepping back ------------------------------------------------------------------

test('step back drops all the additions in one step, then the anchor', () => {
  const s = selectionOf(cardPart(1), cardPart(2), pathPart(3), queryPart('tags:ui'));
  const first = stepBack(s);
  assert.deepStrictEqual(first, { anchor: cardPart(1), additions: [] }, 'every addition goes at once, not one at a time');
  assert.deepStrictEqual(stepBack(first), NO_SELECTION, 'then the anchor');
});

test('step back with nothing picked changes nothing', () => {
  assert.strictEqual(stepBack(NO_SELECTION), NO_SELECTION);
});

test('step back from an anchor that is a query drops the query', () => {
  assert.deepStrictEqual(stepBack(selectionOf(queryPart('blocked:'))), NO_SELECTION);
});

test('step back does not change the selection handed in', () => {
  const s = selectionOf(cardPart(1), cardPart(2));
  stepBack(s);
  assert.strictEqual(s.additions.length, 1);
});

// --- cards that left the board ------------------------------------------------------

test('a poll that finds a card gone drops the card, path and tree parts built on it, and keeps the queries', () => {
  const s = selectionOf(cardPart(1), cardPart(2), pathPart(3), treePart(4), queryPart('tags:ui'));
  const next = pruneSelectionParts(s, [1, 3, 4, 5]);
  assert.deepStrictEqual(parts(next), [cardPart(1), pathPart(3), treePart(4), queryPart('tags:ui')]);
  assert.deepStrictEqual(parts(pruneSelectionParts(s, [2])), [cardPart(2), queryPart('tags:ui')]);
});

test('when the anchor card is gone the first part that is left becomes the anchor', () => {
  const s = selectionOf(cardPart(1), cardPart(2), cardPart(3));
  assert.deepStrictEqual(pruneSelectionParts(s, [2, 3]), { anchor: cardPart(2), additions: [cardPart(3)] });
  assert.deepStrictEqual(pruneSelectionParts(s, []), NO_SELECTION);
});

test('when every part is still on the board the same selection comes back', () => {
  const s = selectionOf(cardPart(1), queryPart('tags:ui'));
  assert.strictEqual(pruneSelectionParts(s, [1, 2]), s);
  assert.strictEqual(pruneSelectionParts(NO_SELECTION, []), NO_SELECTION);
});

// --- clicks: what each gesture does to the selection --------------------------------
// A click is decided in two steps, both pure: cardClickAction names the gesture
// (select, toggle, range, open), selectionAfterClick says what the selection
// becomes. `view` is where the click landed; the Board, Map, Gantt and Calendar
// have a reading order to range over and the Graph has not.

const ORDER = [1, 2, 3, 4, 5, 6];
const gesture = (view, mods = {}) => cardClickAction({
  cue: false, shiftKey: false, ctrlKey: false, metaKey: false, plainClick: view === 'graph' ? 'selects' : 'opens', ranges: shiftAddsRange(view), ...mods,
});
// A state is { selection, rangeStart }; clicking returns the next one.
const start = (selection = NO_SELECTION, rangeStart = null) => ({ selection, rangeStart });
function clickOn(state, view, id, mods) {
  const action = gesture(view, mods);
  return selectionAfterClick(action, id, {
    selection: state.selection,
    resolved: resolveSelection(state.selection, match, ALL),
    rangeStart: state.rangeStart,
    order: ORDER,
    matchQuery: match,
  });
}
const plainViews = ['board', 'map', 'gantt', 'calendar'];

test('in the Board, Map, Gantt and Calendar Ctrl and Cmd click toggle a card, and the first card picked is the anchor', () => {
  for (const view of plainViews) {
    for (const mods of [{ ctrlKey: true }, { metaKey: true }]) {
      const first = clickOn(start(), view, 2, mods);
      assert.deepStrictEqual(first, { selection: { anchor: cardPart(2), additions: [] }, rangeStart: 2 }, `${view} ${JSON.stringify(mods)}`);
      const second = clickOn(first, view, 5, mods);
      assert.deepStrictEqual(second, { selection: { anchor: cardPart(2), additions: [cardPart(5)] }, rangeStart: 5 }, 'later cards are additions');
    }
  }
});

test('Ctrl click on a card that is selected takes it out, and plants the range start on it as before', () => {
  const picked = clickOn(clickOn(start(), 'board', 2, { ctrlKey: true }), 'board', 5, { ctrlKey: true });
  const out = clickOn(picked, 'board', 5, { ctrlKey: true });
  assert.deepStrictEqual(out, { selection: { anchor: cardPart(2), additions: [] }, rangeStart: 5 });
});

test('Ctrl click on the anchor card takes it out and the first addition becomes the anchor', () => {
  let state = start();
  for (const id of [2, 5, 3]) state = clickOn(state, 'board', id, { ctrlKey: true });
  const out = clickOn(state, 'board', 2, { ctrlKey: true });
  assert.deepStrictEqual(out.selection, { anchor: cardPart(5), additions: [cardPart(3)] });
});

test('Ctrl click on a card a query part reaches takes it out of that part', () => {
  const state = start(selectionOf(queryPart('tags:ui')), 1);
  const out = clickOn(state, 'board', 2, { ctrlKey: true });
  assert.deepStrictEqual(parts(out.selection), [cardPart(1), cardPart(5)]);
});

test('Shift click adds the range from the range start in the view\'s order, each card an addition, the first card picked the anchor', () => {
  const first = clickOn(start(), 'board', 2, { ctrlKey: true });
  const ranged = clickOn(first, 'board', 5, { shiftKey: true });
  assert.deepStrictEqual(ranged, { selection: { anchor: cardPart(2), additions: [cardPart(3), cardPart(4), cardPart(5)] }, rangeStart: 2 });
});

test('Shift click with no selection and no usable range start picks the card as the anchor and starts the range there', () => {
  for (const rangeStart of [null, 99]) {
    const out = clickOn(start(NO_SELECTION, rangeStart), 'gantt', 4, { shiftKey: true });
    assert.deepStrictEqual(out, { selection: { anchor: cardPart(4), additions: [] }, rangeStart: 4 }, String(rangeStart));
  }
});

test('a Shift range adds only the cards that are not selected yet, and never takes one out', () => {
  let state = clickOn(start(), 'board', 3, { ctrlKey: true });
  state = clickOn(state, 'board', 1, { shiftKey: true });
  assert.deepStrictEqual(parts(state.selection), [cardPart(3), cardPart(1), cardPart(2)]);
  const again = clickOn(state, 'board', 1, { shiftKey: true });
  assert.deepStrictEqual(again, { selection: state.selection, rangeStart: 3 }, 'the same range again changes nothing');
});

test('a Shift range counts the cards a query part already reaches as selected', () => {
  const state = start(selectionOf(queryPart('tags:ui')), 1);
  const out = clickOn(state, 'board', 3, { shiftKey: true });
  assert.deepStrictEqual(parts(out.selection), [queryPart('tags:ui'), cardPart(3)], 'the range 1..3 adds only card 3; 1 and 2 are the query\'s');
});

test('a Shift click on a card that is not in the view\'s order changes nothing', () => {
  const state = start(selectionOf(cardPart(1)), 1);
  const out = selectionAfterClick('range', 42, { selection: state.selection, resolved: new Set([1]), rangeStart: 1, order: ORDER, matchQuery: match });
  assert.strictEqual(out.selection, state.selection);
});

test('a plain click that opens a card empties the selection and its range start', () => {
  const state = start(selectionOf(cardPart(1), cardPart(2)), 2);
  for (const view of plainViews) assert.deepStrictEqual(clickOn(state, view, 4), { selection: NO_SELECTION, rangeStart: null }, view);
});

test('in the Graph a click makes the card a new anchor and drops the additions, whatever the selection was', () => {
  const state = start(selectionOf(cardPart(1), pathPart(2), queryPart('tags:ui')), 1);
  assert.deepStrictEqual(clickOn(state, 'graph', 4), { selection: { anchor: cardPart(4), additions: [] }, rangeStart: 4 });
});

test('in the Graph Shift click adds exactly one card, where the other views add a range', () => {
  const first = clickOn(start(), 'graph', 2);
  const added = clickOn(first, 'graph', 5, { shiftKey: true });
  assert.deepStrictEqual(added.selection, { anchor: cardPart(2), additions: [cardPart(5)] }, 'card 5 alone, not 3 and 4 between');
  assert.deepStrictEqual(clickOn(first, 'board', 5, { shiftKey: true }).selection.additions, [cardPart(3), cardPart(4), cardPart(5)], 'the Board still adds the range');
});

test('in the Graph Shift click on a selected card takes it out, and Ctrl and Cmd click do the same as Shift', () => {
  let state = clickOn(start(), 'graph', 2);
  state = clickOn(state, 'graph', 5, { shiftKey: true });
  const out = clickOn(state, 'graph', 5, { shiftKey: true });
  assert.deepStrictEqual(out.selection, { anchor: cardPart(2), additions: [] });
  for (const mods of [{ ctrlKey: true }, { metaKey: true }]) {
    assert.deepStrictEqual(clickOn(state, 'graph', 5, mods).selection, out.selection, `out, ${JSON.stringify(mods)}`);
    assert.deepStrictEqual(clickOn(clickOn(start(), 'graph', 2), 'graph', 5, mods).selection, state.selection, `in, ${JSON.stringify(mods)}`);
  }
});

test('the lookup says which views range: every view but the Graph, and a view it does not know ranges', () => {
  for (const view of plainViews) assert.strictEqual(shiftAddsRange(view), true, view);
  assert.strictEqual(shiftAddsRange('graph'), false);
  for (const view of ['', 'nope', 'constructor', '__proto__', undefined, null]) assert.strictEqual(shiftAddsRange(view), true, String(view));
});

test('a click on a cue is the caller\'s search shortcut and leaves the selection as it is', () => {
  const state = start(selectionOf(cardPart(1)), 1);
  const out = selectionAfterClick('cue', 2, { selection: state.selection, resolved: new Set([1]), rangeStart: 1, order: ORDER, matchQuery: match });
  assert.deepStrictEqual(out, { selection: state.selection, rangeStart: 1 });
});
