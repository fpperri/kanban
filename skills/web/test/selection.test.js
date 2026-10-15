const { test } = require('node:test');
const assert = require('node:assert');
const { toggleSelection, pruneSelection, cardMenuFor, NO_SELECTION, cardPart, pathPart, addPart, resolveSelection, partitionByMovable, dragPlan, archiveNeedsConfirm, rangeSelection } = require('../web/selection');

test('toggleSelection adds an unselected id and removes a selected one, without mutating input', () => {
  const s0 = new Set([1]);
  const s1 = toggleSelection(s0, 2);
  assert.deepStrictEqual([...s1].sort(), [1, 2]);
  const s2 = toggleSelection(s1, 1);
  assert.deepStrictEqual([...s2], [2]);
  assert.deepStrictEqual([...s0], [1]); // input untouched
});

test('pruneSelection drops ids no longer on the live board', () => {
  const pruned = pruneSelection(new Set([1, 2, 3]), [2, 3, 4]);
  assert.deepStrictEqual([...pruned].sort(), [2, 3]);
});

test('pruneSelection of an empty set stays empty', () => {
  assert.deepStrictEqual([...pruneSelection(new Set(), [1, 2])], []);
});

// --- shift+click adds a RANGE between the range start and the target,
// in the active view's rendered order. Additive (union), never replacing —
// the card's grammar is "shift to ADD a range".

test('rangeSelection adds every id between the range start and target inclusive, without mutating input', () => {
  const order = [10, 20, 30, 40, 50];
  const s0 = new Set([10]);
  const s1 = rangeSelection(s0, order, 10, 40);
  assert.deepStrictEqual([...s1].sort((a, b) => a - b), [10, 20, 30, 40]);
  assert.deepStrictEqual([...s0], [10]); // input untouched
});

test('rangeSelection works upward too (target before the range start in order)', () => {
  const s = rangeSelection(new Set(), [10, 20, 30, 40], 40, 20);
  assert.deepStrictEqual([...s].sort((a, b) => a - b), [20, 30, 40]);
});

test('rangeSelection is additive: existing selection outside the range survives', () => {
  const s = rangeSelection(new Set([99]), [10, 20, 30, 99], 10, 20);
  assert.deepStrictEqual([...s].sort((a, b) => a - b), [10, 20, 99]);
});

test('rangeSelection with the range start === target selects just that card', () => {
  const s = rangeSelection(new Set(), [10, 20, 30], 20, 20);
  assert.deepStrictEqual([...s], [20]);
});

test('rangeSelection with a missing/stale range start degrades to adding just the target — never a toggle, shift must not deselect', () => {
  const grown = rangeSelection(new Set([10]), [10, 20, 30], null, 30);
  assert.deepStrictEqual([...grown].sort((a, b) => a - b), [10, 30]);
  const kept = rangeSelection(new Set([10, 30]), [10, 20, 30], 99, 30);
  assert.deepStrictEqual([...kept].sort((a, b) => a - b), [10, 30]);
});

test('rangeSelection with a target not in the rendered order returns the input set unchanged (same reference)', () => {
  const s0 = new Set([10]);
  assert.strictEqual(rangeSelection(s0, [10, 20], 10, 99), s0);
});

// --- the card menu's subject, shared by every view.
// A right-click outside the selection opens the menu for that card alone and
// leaves the selection as it was; inside, the menu is for the whole resolved
// selection. The menu leads with Peek and Add to selection only outside the
// selection (the card details' own menu has no Peek), and offers Path and Tree
// only when its subject is one card.

const frozenSelection = (parts) => {
  const selection = parts.reduce((next, part) => addPart(next, part), NO_SELECTION);
  return Object.freeze({ anchor: Object.freeze(selection.anchor), additions: Object.freeze(selection.additions.map((p) => Object.freeze(p))) });
};
const pathOfFive = (text) => new Set(text === 'path:5' ? [4, 5, 6] : []);

test('a right-click on a card outside the selection makes that card alone the menu\'s subject and writes nothing to the selection', () => {
  const selection = frozenSelection([cardPart(1), cardPart(2)]);
  const resolved = resolveSelection(selection, pathOfFive, null);
  const menu = cardMenuFor(resolved, 3);
  assert.deepStrictEqual(menu.ids, [3]);
  assert.strictEqual(menu.inSelection, false);
  assert.deepStrictEqual([...resolved], [1, 2], 'the resolved set is untouched');
  assert.deepStrictEqual(selection, { anchor: { kind: 'card', id: 1 }, additions: [{ kind: 'card', id: 2 }] }, 'and so is the selection it came from');
});

test('a right-click on a card outside an empty selection also has that card alone as its subject', () => {
  assert.deepStrictEqual(cardMenuFor(new Set(), 7).ids, [7]);
});

test('a right-click on a card inside the selection makes the whole resolved selection the subject, a path\'s cards included, in the order they were picked', () => {
  const selection = frozenSelection([cardPart(1), pathPart(5), cardPart(9)]);
  const resolved = resolveSelection(selection, pathOfFive, null);
  const menu = cardMenuFor(resolved, 6);
  assert.deepStrictEqual(menu.ids, [1, 4, 5, 6, 9]);
  assert.strictEqual(menu.inSelection, true);
});

test('the subject of a menu inside the selection is a copy: changing it does not change the resolved set', () => {
  const resolved = new Set([1, 2]);
  cardMenuFor(resolved, 2).ids.push(99);
  assert.deepStrictEqual([...resolved], [1, 2]);
});

test('outside the selection the menu leads with Peek and Add to selection; inside it offers neither', () => {
  const outside = cardMenuFor(new Set([1, 2]), 3);
  assert.strictEqual(outside.peek, true);
  assert.strictEqual(outside.add, true);
  const inside = cardMenuFor(new Set([1, 2]), 2);
  assert.strictEqual(inside.peek, false);
  assert.strictEqual(inside.add, false);
});

test('the card details\' own menu has no Peek, and still offers Add to selection for a card outside the selection', () => {
  const fromDetail = cardMenuFor(new Set([1, 2]), 3, { fromDetail: true });
  assert.strictEqual(fromDetail.peek, false);
  assert.strictEqual(fromDetail.add, true);
  assert.strictEqual(cardMenuFor(new Set([1, 2]), 2, { fromDetail: true }).add, false, 'a card already picked has nothing to add');
});

test('Path and Tree are offered when the subject is one card, outside the selection or alone inside it, and not when it is several', () => {
  assert.strictEqual(cardMenuFor(new Set([1, 2]), 3).dependency, true, 'one card outside a selection');
  assert.strictEqual(cardMenuFor(new Set([4]), 4).dependency, true, 'a selection of one');
  assert.strictEqual(cardMenuFor(new Set([4, 5]), 5).dependency, false, 'a selection of two');
  assert.strictEqual(cardMenuFor(new Set(), 3).dependency, true, 'nothing selected');
});

test('partitionByMovable: gate-refused cards (waiting or blocked) are skipped only for doing; same-status cards are no-ops', () => {
  const byId = new Map([
    [1, { id: 1, status: 'todo' }],
    [2, { id: 2, status: 'todo' }],
    [3, { id: 3, status: 'doing' }],
  ]);
  const refusesDoingFn = (card) => card.id === 2; // #2 is waiting or blocked
  const toDoing = partitionByMovable([1, 2, 3], byId, 'doing', refusesDoingFn);
  assert.deepStrictEqual(toDoing.movable.map((c) => c.id), [1]);
  assert.deepStrictEqual(toDoing.refused.map((c) => c.id), [2]);
  assert.deepStrictEqual(toDoing.unchanged.map((c) => c.id), [3]);

  const toDone = partitionByMovable([1, 2], byId, 'done', refusesDoingFn);
  // the gate only guards entering doing — refused #2 may still move to done
  assert.deepStrictEqual(toDone.movable.map((c) => c.id).sort(), [1, 2]);
  assert.deepStrictEqual(toDone.refused, []);
});

test('partitionByMovable ignores ids with no matching card (deleted mid-selection)', () => {
  const byId = new Map([[1, { id: 1, status: 'todo' }]]);
  const r = partitionByMovable([1, 99], byId, 'done', () => false);
  assert.deepStrictEqual(r.movable.map((c) => c.id), [1]);
  assert.deepStrictEqual(r.refused, []);
  assert.deepStrictEqual(r.unchanged, []);
});

// --- archive column parity — one plan for any drag batch.
// Cards carry `archived: true|false`; dest is 'archive' or a live column.

const REFUSES_NONE = () => false;

function byIdOf(cards) { return new Map(cards.map((c) => [c.id, c])); }

test('dragPlan to archive: a non-done live card archives with a confirm, an already-archived one skips', () => {
  const cards = [
    { id: 1, status: 'todo', archived: false },
    { id: 2, status: 'done', archived: true },
  ];
  const p = dragPlan([1, 2], byIdOf(cards), 'archive', REFUSES_NONE);
  assert.deepStrictEqual(p.toArchive.map((c) => c.id), [1]);
  assert.deepStrictEqual(p.toRestore, []);
  assert.deepStrictEqual(p.toMove, []);
  assert.match(p.confirmMessage, /Archive 1 card/);
});

// --- a fully-done batch is the natural completion flow, not a
// destructive act — the confirm is skipped when EVERY card being archived
// has status 'done'. One non-done card in the batch keeps the confirm.

test('dragPlan to archive skips the confirm when the whole batch being archived is already done', () => {
  const p = dragPlan([1], byIdOf([{ id: 1, status: 'done', archived: false }]), 'archive', REFUSES_NONE);
  assert.deepStrictEqual(p.toArchive.map((c) => c.id), [1]);
  assert.strictEqual(p.confirmMessage, null);
});

test('dragPlan to archive keeps the confirm when even one card in the batch is not done', () => {
  const cards = [
    { id: 1, status: 'done', archived: false },
    { id: 2, status: 'todo', archived: false },
  ];
  const p = dragPlan([1, 2], byIdOf(cards), 'archive', REFUSES_NONE);
  assert.deepStrictEqual(p.toArchive.map((c) => c.id).sort(), [1, 2]);
  assert.match(p.confirmMessage, /Archive 2 card/);
});

test('dragPlan to archive with nothing to do returns a null confirm (no-op drag)', () => {
  const p = dragPlan([2], byIdOf([{ id: 2, status: 'done', archived: true }]), 'archive', REFUSES_NONE);
  assert.strictEqual(p.confirmMessage, null);
});

test('dragPlan to a live column: archived cards restore-with-status, live ones move, confirm names the archived count', () => {
  const cards = [
    { id: 1, status: 'todo', archived: false },
    { id: 2, status: 'done', archived: true },
  ];
  const p = dragPlan([1, 2], byIdOf(cards), 'doing', REFUSES_NONE);
  assert.deepStrictEqual(p.toMove.map((c) => c.id), [1]);
  assert.deepStrictEqual(p.toRestore.map((c) => c.id), [2]);
  assert.match(p.confirmMessage, /Move 2 card\(s\) to doing/);
  assert.match(p.confirmMessage, /1 of them (is|are) archived and will be restored/);
});

test('dragPlan pure live batch to a live column needs no confirm (unchanged today)', () => {
  const cards = [{ id: 1, status: 'todo', archived: false }];
  const p = dragPlan([1], byIdOf(cards), 'done', REFUSES_NONE);
  assert.deepStrictEqual(p.toMove.map((c) => c.id), [1]);
  assert.strictEqual(p.confirmMessage, null);
});

test('dragPlan doing entry gate (waiting + blocked) applies per card entering doing — to archived cards too', () => {
  const cards = [
    { id: 1, status: 'todo', archived: false },
    { id: 2, status: 'done', archived: true },
  ];
  const p = dragPlan([1, 2], byIdOf(cards), 'doing', () => true);
  assert.deepStrictEqual(p.toMove, []);
  assert.deepStrictEqual(p.toRestore, []);
  assert.deepStrictEqual(p.refused.map((c) => c.id), [1, 2]);
  assert.strictEqual(p.confirmMessage, null); // nothing left to confirm
});

test('dragPlan drops unknown ids and same-status live cards stay unchanged', () => {
  const cards = [{ id: 1, status: 'done', archived: false }];
  const p = dragPlan([1, 99], byIdOf(cards), 'done', REFUSES_NONE);
  assert.deepStrictEqual(p.toMove, []);
  assert.deepStrictEqual(p.unchanged.map((c) => c.id), [1]);
  assert.strictEqual(p.confirmMessage, null);
});

// --- the shared "does this archive batch need a confirm" rule,
// reused by the tile Archive button, drag-to-Archive, and bulk Archive
// selected — one place decides, all three callers agree.

test('archiveNeedsConfirm is false when every card in the batch is done', () => {
  assert.strictEqual(archiveNeedsConfirm([{ id: 1, status: 'done' }, { id: 2, status: 'done' }]), false);
});

test('archiveNeedsConfirm is true when any card in the batch is not done', () => {
  assert.strictEqual(archiveNeedsConfirm([{ id: 1, status: 'done' }, { id: 2, status: 'todo' }]), true);
  assert.strictEqual(archiveNeedsConfirm([{ id: 1, status: 'backlog' }]), true);
});

test('archiveNeedsConfirm on a single done card is false (tile Archive button, one card)', () => {
  assert.strictEqual(archiveNeedsConfirm([{ id: 1, status: 'done' }]), false);
});

// --- what a click on a card does: one pure decision beside the selection
// helpers, with each view's plain-click behaviour passed in from a lookup.

const { plainClickBehaviour, cardClickAction } = require('../web/selection');

test('the plain-click lookup answers "selects" for the Graph and "opens" for the Board, Map, Gantt and Calendar', () => {
  assert.strictEqual(plainClickBehaviour('graph'), 'selects');
  for (const view of ['board', 'map', 'gantt', 'calendar']) assert.strictEqual(plainClickBehaviour(view), 'opens', view);
});

test('the plain-click lookup answers "opens" for a view it does not know, never a prototype key', () => {
  for (const view of ['', 'nope', 'constructor', '__proto__', undefined, null]) assert.strictEqual(plainClickBehaviour(view), 'opens', String(view));
});

const PLAIN_CLICKS = ['opens', 'selects'];
const click = (extra, plainClick) => cardClickAction({ cue: false, shiftKey: false, ctrlKey: false, metaKey: false, plainClick, ...extra });

test('a plain click opens the card in a view whose plain click opens, and selects it in one whose plain click selects', () => {
  assert.strictEqual(click({}, 'opens'), 'open');
  assert.strictEqual(click({}, 'selects'), 'select');
});

test('Ctrl and Cmd click toggle one card and Shift click adds a range, whatever the view\'s plain click does', () => {
  for (const plainClick of PLAIN_CLICKS) {
    assert.strictEqual(click({ ctrlKey: true }, plainClick), 'toggle', `ctrl, ${plainClick}`);
    assert.strictEqual(click({ metaKey: true }, plainClick), 'toggle', `cmd, ${plainClick}`);
    assert.strictEqual(click({ shiftKey: true }, plainClick), 'range', `shift, ${plainClick}`);
  }
});

test('Shift wins over Ctrl and Cmd when both are held', () => {
  for (const plainClick of PLAIN_CLICKS) {
    assert.strictEqual(click({ shiftKey: true, ctrlKey: true }, plainClick), 'range');
    assert.strictEqual(click({ shiftKey: true, metaKey: true }, plainClick), 'range');
  }
});

test('a click on a cue (assignee, tag, blocked or review pill) is a search shortcut, with or without a modifier, in any view', () => {
  const modifiers = [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }];
  for (const cue of ['assignee', 'tag', 'blocked', 'review']) {
    for (const plainClick of PLAIN_CLICKS) {
      for (const mod of modifiers) assert.strictEqual(click({ cue, ...mod }, plainClick), 'cue', `${cue} ${JSON.stringify(mod)} ${plainClick}`);
    }
  }
});

test('the decision reads the lookup, so a view\'s answer drives a plain click end to end', () => {
  for (const [view, expected] of [['board', 'open'], ['map', 'open'], ['gantt', 'open'], ['calendar', 'open'], ['graph', 'select']]) {
    assert.strictEqual(click({}, plainClickBehaviour(view)), expected, view);
  }
});

// --- the preferences sheet sets each view's plain click; the Graph's stays fixed.

test('the plain-click lookup reads the view\'s choice from the preferences\' click map', () => {
  const click = { board: 'selects', map: 'opens', gantt: 'selects', calendar: 'opens', graph: 'selects' };
  assert.strictEqual(plainClickBehaviour('board', click), 'selects');
  assert.strictEqual(plainClickBehaviour('map', click), 'opens');
  assert.strictEqual(plainClickBehaviour('gantt', click), 'selects');
  assert.strictEqual(plainClickBehaviour('calendar', click), 'opens');
});

test('the Graph selects whatever the click map says', () => {
  assert.strictEqual(plainClickBehaviour('graph', { graph: 'opens' }), 'selects');
  assert.strictEqual(plainClickBehaviour('graph', {}), 'selects');
});

test('a view the click map leaves out, or fills with something else, opens', () => {
  assert.strictEqual(plainClickBehaviour('board', {}), 'opens');
  assert.strictEqual(plainClickBehaviour('board', { board: 'maybe' }), 'opens');
  assert.strictEqual(plainClickBehaviour('board', null), 'opens');
  for (const view of ['constructor', '__proto__', 'toString']) assert.strictEqual(plainClickBehaviour(view, {}), 'opens', view);
});

test('a choice made for one view changes only that view\'s plain click', () => {
  const click = { board: 'selects' };
  for (const view of ['map', 'gantt', 'calendar']) assert.strictEqual(plainClickBehaviour(view, click), 'opens', view);
});

// --- a double click is the second click of a plain click that selects: it peeks.

test('the second click of a double click, in a view whose plain click selects, is a peek: it opens the card and leaves the selection', () => {
  assert.strictEqual(click({ detail: 2 }, 'selects'), 'peek');
  assert.strictEqual(click({ detail: 1 }, 'selects'), 'select', 'the first click selects');
});

test('a click that names no count is a first click', () => {
  assert.strictEqual(click({}, 'selects'), 'select');
  assert.strictEqual(click({ detail: 0 }, 'selects'), 'select', 'a click from the keyboard carries a count of 0');
});

test('a third click of a triple click selects again; only the second opens', () => {
  assert.strictEqual(click({ detail: 3 }, 'selects'), 'select');
});

test('in a view whose plain click opens the card, the count changes nothing', () => {
  for (const detail of [0, 1, 2, 3]) assert.strictEqual(click({ detail }, 'opens'), 'open', String(detail));
});

test('a cue, Shift, Ctrl or Cmd wins over the second click of a double click', () => {
  for (const plainClick of PLAIN_CLICKS) {
    assert.strictEqual(click({ detail: 2, cue: 'tag' }, plainClick), 'cue');
    assert.strictEqual(click({ detail: 2, shiftKey: true }, plainClick), 'range');
    assert.strictEqual(click({ detail: 2, ctrlKey: true }, plainClick), 'toggle');
    assert.strictEqual(click({ detail: 2, metaKey: true }, plainClick), 'toggle');
  }
});

// --- the click-away rule leaves alone what a card click built or kept.

const { clickKeepsSelection } = require('../web/selection');

test('a selection the card click built or kept survives the click-away rule: a select and a peek', () => {
  assert.strictEqual(clickKeepsSelection('select'), true);
  assert.strictEqual(clickKeepsSelection('peek'), true);
});

test('every other card click leaves the click-away rule as it was', () => {
  for (const action of ['open', 'cue', 'toggle', 'range', 'none', undefined]) assert.strictEqual(clickKeepsSelection(action), false, String(action));
});

// --- Enter on a focused card opens it where a plain click only selects.

const { cardOpenAction } = require('../web/selection');
const open = (extra, plainClick) => cardOpenAction({ shiftKey: false, ctrlKey: false, metaKey: false, plainClick, ...extra });

test('Enter opens the card in a view whose plain click selects', () => {
  assert.strictEqual(open({}, 'selects'), 'open');
});

test('in a view whose plain click already opens the card, Enter adds nothing', () => {
  assert.strictEqual(open({}, 'opens'), 'none');
});

test('Enter with Shift, Ctrl or Cmd held is part of building a selection and opens nothing', () => {
  for (const mod of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }]) assert.strictEqual(open(mod, 'selects'), 'none', JSON.stringify(mod));
});
