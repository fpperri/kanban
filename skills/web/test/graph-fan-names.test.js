const { test, after } = require('node:test');
const assert = require('node:assert');

const {
  graphFanNames, graphFanNextNames, GRAPH_FAN_NAMES_CAP, GRAPH_FAN_NAMES_SMALL, GRAPH_FAN_OPTION_VALUES,
  graphLayout, graphSignature, graphPlan,
} = require('../web/graph-model');
const { loadBoard, cleanUp, drawnModel, card, buildOf } = require('./helpers/fan-boards');

// The tier fan's Names option: which cards carry their title. One pure
// function of the model gives the named set (graphFanNames). Relevant names the selection
// and the cards it lights (a lone card's one-hop relations among them, a pill's matches
// being the selection), then the parents from the highest altitude down while the named
// set is under the cap; on a small fan every card is named. All names every card and none
// names no card. The plan board is the browser runner's own fixture board, read the way
// the page reads it.

after(cleanUp);

const BOARDS = { plan: loadBoard('plan') };
const ids = (set) => [...set].map(Number).sort((a, b) => a - b);

// The plan board's drawn cards are 1 to 18 and 22 to 29, 26 of them: above the small size.
// Its parents, and what is under each: 1 holds 2 to 6 and, through 2 and 7, 7, 8, 22 to 25
// (altitude 5); 2 holds 7, 8 and what 7 holds (4); 7 holds 22 and its children (3); 22
// holds 23 and 25 and 24 below 23 (2); 23 holds 24 (1). Cards 2 to 6 are waited for or wait
// as written in the board's own files; card 5 has the relations 1 (its parent), 6 and 27.
const PLAN_PARENTS = [1, 2, 7, 22, 23];

// 26 parents with one child each (parent 2k-1, child 2k, altitude 1 every one), and one
// tall chain 101 > 102 > 103 > 104 (altitudes 3, 2, 1). 56 cards, 29 parents: more than the
// cap, so the order the parents are named in shows. Independent of the module under test:
// the altitudes are the board's own shape.
const staircase = () => {
  const cards = [];
  for (let k = 1; k <= 26; k++) {
    cards.push(card(2 * k - 1), card(2 * k, { parent: 2 * k - 1 }));
  }
  cards.push(card(101), card(102, { parent: 101 }), card(103, { parent: 102 }), card(104, { parent: 103 }));
  return buildOf(cards);
};
const ODD_UNDER_THE_CAP = Array.from({ length: GRAPH_FAN_NAMES_CAP - 2 }, (_, k) => 2 * k + 1);

test('the cap on names and the size of a fan that names every card are both 24 cards', () => {
  assert.strictEqual(GRAPH_FAN_NAMES_CAP, 24);
  assert.strictEqual(GRAPH_FAN_NAMES_SMALL, 24);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(GRAPH_FAN_OPTION_VALUES.names)), ['relevant', 'all', 'none']);
});

// --- relevant, nothing selected ----------------------------------------------------------------

test('plan fixture, nothing selected, on a fan above the small size: relevant names the parents, and no leaf', () => {
  const model = drawnModel(BOARDS.plan);
  assert.ok(model.nodes.length > GRAPH_FAN_NAMES_SMALL, `${model.nodes.length} cards on the plan board`);
  assert.deepStrictEqual(ids(graphFanNames(model, 'relevant')), PLAN_PARENTS);
  assert.deepStrictEqual(ids(graphFanNames(model, 'relevant', { selectedIds: new Set() })), PLAN_PARENTS);
});

test('plan fixture: the parents are named from the highest altitude down, 1 (5 layers below), 2 (4), 7 (3), 22 (2), 23 (1)', () => {
  const model = drawnModel(BOARDS.plan);
  assert.deepStrictEqual([...graphFanNames(model, 'relevant')], ['1', '2', '7', '22', '23'], 'in the order they are named, which the cap cuts from the end');
});

test('relevant names the parents from the highest altitude down and stops at the cap', () => {
  const model = staircase();
  const named = graphFanNames(model, 'relevant');
  assert.strictEqual(named.size, GRAPH_FAN_NAMES_CAP);
  assert.deepStrictEqual(ids(named), ids([101, 102, ...ODD_UNDER_THE_CAP]), 'altitude 3 and 2 first, then altitude 1 by id');
  for (const leaf of ['2', '4', '104']) assert.ok(!named.has(leaf), `leaf ${leaf} is not named`);
  assert.ok(!named.has('103'), 'card 103 is a parent of altitude 1 with a higher id than the cap reaches');
  assert.ok(!named.has('51'), 'and so is card 51');
});

test('altitude is blind to type: a story with sub-steps and an epic with stories both stand at 1, and one more layer stands higher', () => {
  const model = buildOf([
    card(1, { type: 'epic' }), card(2, { type: 'story', parent: 1 }), card(3, { parent: 2 }),
    card(4, { type: 'epic' }), card(5, { type: 'story', parent: 4 }),
    ...Array.from({ length: 30 }, (_, k) => card(10 + k)),
  ]);
  assert.ok(model.nodes.length > GRAPH_FAN_NAMES_SMALL);
  assert.deepStrictEqual(ids(graphFanNames(model, 'relevant')), [1, 2, 4], 'parents: 1 at 2, 2 at 1, 4 at 1');
});

test('a parent whose children are not drawn still stands as high as the board makes it: altitude is the layers of cards below, drawn or not', () => {
  const cards = [card(1), card(2, { parent: 1 }), card(3, { parent: 2 }), ...Array.from({ length: 30 }, (_, k) => card(10 + k))];
  const hidden = buildOf(cards, undefined, cards.map((c) => c.id).filter((id) => id !== '2' && id !== '3'));
  assert.ok(hidden.nodes.length > GRAPH_FAN_NAMES_SMALL);
  assert.ok(!hidden.byId.has('2') && !hidden.byId.has('3'), 'the children are not drawn');
  assert.deepStrictEqual(ids(graphFanNames(hidden, 'relevant')), [1], 'card 1 has two layers below it on the board, as its badge says');
  assert.strictEqual(hidden.altitude.get('1'), 2);
  assert.strictEqual(hidden.altitude.get('10'), 0);
});

test('the altitude the Names option reads is the nesting module\'s, the one the tiles\' badge shows, whatever is drawn', () => {
  const { rollupIndex } = require('../web/nesting');
  const cards = [card(1), card(2, { parent: 1 }), card(3, { parent: 2 }), card(4, { parent: 1 }), card(5), card(6, { parent: 5 })];
  const index = rollupIndex(cards, undefined);
  for (const drawn of [cards.map((c) => c.id), [1, 3, 5], [1, 4, 6]]) {
    const model = buildOf(cards, undefined, drawn);
    for (const n of model.nodes) assert.strictEqual(model.altitude.get(n.id), index.altitudeOf(n.id), `card ${n.id} with ${drawn.join(',')} drawn`);
  }
});

// --- relevant, with a selection ------------------------------------------------------------------

test('relevant names the selected cards, and the cards a lone card lights: its one-hop relations', () => {
  const model = staircase();
  const named = graphFanNames(model, 'relevant', { selectedIds: new Set(['52']), loneCardId: '52' });
  assert.ok(named.has('52'), 'the selected leaf');
  assert.ok(named.has('51'), 'its parent, a relation of the lone card that the cap would not have reached');
  assert.strictEqual(named.size, GRAPH_FAN_NAMES_CAP, 'the cap counts the lit cards, and the parents fill what is left of it');
  assert.ok(named.has('101') && named.has('102'), 'the tallest parents come next');
});

test('a lone card on the plan board lights card 1, 6 and 27 with it, and they are named with the parents', () => {
  const model = drawnModel(BOARDS.plan);
  const named = graphFanNames(model, 'relevant', { selectedIds: new Set(['5']), loneCardId: '5' });
  assert.deepStrictEqual(ids(named), ids(new Set([5, 1, 6, 27, ...PLAN_PARENTS])));
});

test('a selection of several cards lights exactly its cards, so it names those and not their relations', () => {
  const model = staircase();
  const named = graphFanNames(model, 'relevant', { selectedIds: new Set(['52', '50']), loneCardId: null });
  assert.ok(named.has('52') && named.has('50'));
  assert.ok(!named.has('51') && !named.has('49'), 'the parents of the two are not lit, and are past the cap');
  assert.strictEqual(named.size, GRAPH_FAN_NAMES_CAP);
});

test('a selection or a pill\'s matches are always named, past the cap', () => {
  const model = staircase();
  const many = new Set(model.nodes.filter((n) => n.id % 2 === 0 && n.id < 100).map((n) => n.id));
  assert.strictEqual(many.size, 26);
  const named = graphFanNames(model, 'relevant', { selectedIds: many, loneCardId: null });
  for (const id of many) assert.ok(named.has(id), `card ${id} is selected`);
  assert.strictEqual(named.size, 26, 'the set is full of what is lit, so no parent is added');
});

test('a selected card the fan does not draw names nothing, and a card that is not on the board is no name', () => {
  const model = drawnModel(BOARDS.plan);
  const named = graphFanNames(model, 'relevant', { selectedIds: new Set(['999', '5000']), loneCardId: '999' });
  assert.deepStrictEqual(ids(named), PLAN_PARENTS);
});

// --- a small fan ------------------------------------------------------------------------------------

test('on a fan at or below the small size, relevant names every card', () => {
  const at = buildOf(Array.from({ length: GRAPH_FAN_NAMES_SMALL }, (_, k) => card(k + 1, k % 4 ? { parent: 1 } : {})));
  assert.strictEqual(at.nodes.length, GRAPH_FAN_NAMES_SMALL);
  assert.deepStrictEqual(ids(graphFanNames(at, 'relevant')), at.nodes.map((n) => Number(n.id)).sort((a, b) => a - b));
  const one = buildOf([card(1)]);
  assert.deepStrictEqual(ids(graphFanNames(one, 'relevant')), [1]);
  const over = buildOf(Array.from({ length: GRAPH_FAN_NAMES_SMALL + 1 }, (_, k) => card(k + 1)));
  assert.deepStrictEqual(ids(graphFanNames(over, 'relevant')), [], 'one more card and relevant is back to the parents: here there are none');
});

test('the small size counts the cards drawn, not the cards on the board', () => {
  const cards = Array.from({ length: 30 }, (_, k) => card(k + 1));
  const shown = buildOf(cards, undefined, cards.slice(0, 5).map((c) => c.id));
  assert.deepStrictEqual(ids(graphFanNames(shown, 'relevant')), [1, 2, 3, 4, 5]);
});

test('an empty fan names nothing, whatever the setting', () => {
  const empty = buildOf([]);
  for (const mode of ['relevant', 'all', 'none']) assert.strictEqual(graphFanNames(empty, mode).size, 0, mode);
});

// --- all and none --------------------------------------------------------------------------------------

test('all names every card, and none names no card, on a fan of any size and whatever is selected', () => {
  for (const model of [staircase(), drawnModel(BOARDS.plan), buildOf([card(1), card(2, { parent: 1 })])]) {
    const every = model.nodes.map((n) => Number(n.id)).sort((a, b) => a - b);
    const pick = { selectedIds: new Set([String(every[0])]), loneCardId: String(every[0]) };
    assert.deepStrictEqual(ids(graphFanNames(model, 'all')), every);
    assert.deepStrictEqual(ids(graphFanNames(model, 'all', pick)), every);
    assert.strictEqual(graphFanNames(model, 'none').size, 0);
    assert.strictEqual(graphFanNames(model, 'none', pick).size, 0);
  }
});

test('a setting the row does not offer reads as relevant', () => {
  const model = staircase();
  const relevant = ids(graphFanNames(model, 'relevant'));
  for (const unknown of [undefined, null, '', 'ALL', 'every', 7, {}, 'toString']) {
    assert.deepStrictEqual(ids(graphFanNames(model, unknown)), relevant, JSON.stringify(unknown));
  }
});

test('the named set is a new Set each time, the same for the same input, and the inputs are left as they were', () => {
  const model = staircase();
  const picked = new Set(['52']);
  const a = graphFanNames(model, 'relevant', { selectedIds: picked, loneCardId: '52' });
  const b = graphFanNames(model, 'relevant', { selectedIds: picked, loneCardId: '52' });
  assert.notStrictEqual(a, b);
  assert.deepStrictEqual(ids(a), ids(b));
  assert.deepStrictEqual([...picked], ['52']);
  a.add('7777');
  assert.ok(!graphFanNames(model, 'relevant', { selectedIds: picked, loneCardId: '52' }).has('7777'));
});

// --- the l key steps through the values --------------------------------------------------------------------

test('n steps relevant, all, none and back to relevant', () => {
  assert.strictEqual(graphFanNextNames('relevant'), 'all');
  assert.strictEqual(graphFanNextNames('all'), 'none');
  assert.strictEqual(graphFanNextNames('none'), 'relevant');
});

test('n from a value the row does not offer steps from relevant, the default', () => {
  for (const unknown of [undefined, null, 'every', 3]) assert.strictEqual(graphFanNextNames(unknown), 'all', JSON.stringify(unknown));
});

// --- the layout does not know the setting --------------------------------------------------------------------

test('changing Names does not run the layout again: the same cards under every setting give one cached layout and one signature', () => {
  const model = drawnModel(BOARDS.plan);
  const statuses = BOARDS.plan.config.statuses;
  const first = graphLayout(model, 'tiers', { statuses, order: 'status', names: 'relevant' });
  for (const names of ['all', 'none', 'relevant', undefined, 'every']) {
    assert.strictEqual(graphLayout(model, 'tiers', { statuses, order: 'status', names }), first, `names ${names}`);
    assert.strictEqual(graphSignature(model, 'tiers', { statuses, names }), graphSignature(model, 'tiers', { statuses }), `names ${names}`);
  }
  assert.notStrictEqual(graphLayout(model, 'tiers', { statuses, order: 'rank', names: 'relevant' }), first, 'the order is still in the key, so the check above can fail');
});

// --- the plan carries the names ------------------------------------------------------------------------------------

const DEFAULTS = { lines: 'folded', dependencies: 'on', order: 'status', names: 'relevant' };
const planOf = (model, fan, extra = {}) => {
  const layout = graphLayout(model, 'tiers', { statuses: ['backlog', 'todo', 'doing', 'done'] });
  return graphPlan(model, layout, { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title, ...(fan ? { fan: { ...DEFAULTS, ...fan } } : {}), ...extra });
};
const namedIn = (plan) => ids(plan.nodes.filter((n) => n.cls.split(' ').includes('graph-named')).map((n) => n.id));

test('the plan marks the named cards: relevant, all and none each name the number the model says', () => {
  const model = drawnModel(BOARDS.plan);
  assert.deepStrictEqual(namedIn(planOf(model, { names: 'relevant' })), PLAN_PARENTS);
  assert.strictEqual(namedIn(planOf(model, { names: 'all' })).length, model.nodes.length);
  assert.deepStrictEqual(namedIn(planOf(model, { names: 'none' })), []);
  assert.notDeepStrictEqual(namedIn(planOf(model, { names: 'relevant' })).length, namedIn(planOf(model, { names: 'all' })).length, 'each choice changes how many names are drawn');
});

test('the plan names what the selection lights: the cards it is given and a lone card\'s relations', () => {
  const model = drawnModel(BOARDS.plan);
  const lone = planOf(model, { names: 'relevant' }, { selectedIds: new Set(['5']), loneCardId: '5' });
  assert.deepStrictEqual(namedIn(lone), ids(new Set([5, 1, 6, 27, ...PLAN_PARENTS])));
  const several = planOf(model, { names: 'relevant' }, { selectedIds: new Set(['5', '6']), loneCardId: null });
  assert.deepStrictEqual(namedIn(several), ids(new Set([5, 6, ...PLAN_PARENTS])));
});

test('a named node carries its id then its title as the name, text only, and an unnamed one carries it too so a press of l can name it in place', () => {
  const model = buildOf([card(1, { title: 'Ship <b>the</b> beta' }), card(2, { title: '  spaced \n  out  ', parent: 1 })]);
  const plan = planOf(model, { names: 'all' });
  assert.deepStrictEqual(plan.nodes.map((n) => n.name), ['#1 Ship <b>the</b> beta', '#2 spaced out']);
});

test('a title longer than the name\'s room is cut with an ellipsis, and an empty one reads as the card\'s number', () => {
  const long = 'Port the whole of the order tables to the new cluster, one at a time';
  const model = buildOf([card(1, { title: long }), card(2, { title: '' }), card(3, { title: '   ' })]);
  const plan = planOf(model, { names: 'all' });
  assert.ok(plan.nodes[0].name.length <= 38 && plan.nodes[0].name.endsWith('…'), plan.nodes[0].name);
  assert.ok(plan.nodes[0].name.startsWith('#1 Port'), plan.nodes[0].name);
  assert.ok(long.startsWith(plan.nodes[0].name.slice('#1 '.length, -1)));
  assert.deepStrictEqual(plan.nodes.slice(1).map((n) => n.name), ['#2', '#3']);
});

test('a prefixed id leads its name whole, and a long title is cut after it', () => {
  const long = 'Port the whole of the order tables to the new cluster, one at a time';
  const model = buildOf([card('G3', { title: 'Plan the week' }), card('G12', { title: long }), card('_4', { title: '' })]);
  const names = planOf(model, { names: 'all' }).nodes.map((n) => n.name);
  assert.strictEqual(names[0], '#G3 Plan the week');
  assert.ok(names[1].startsWith('#G12 Port') && names[1].endsWith('…') && names[1].length <= 38, names[1]);
  assert.strictEqual(names[2], '#_4');
});

test('only the tier fan has names: a plan with no options, and Force and Status, name no card and carry no name', () => {
  const model = drawnModel(BOARDS.plan);
  const none = planOf(model, null);
  assert.deepStrictEqual(namedIn(none), []);
  assert.ok(none.nodes.every((n) => n.name === undefined));
  for (const kind of ['force', 'status']) {
    const layout = graphLayout(model, kind, { statuses: BOARDS.plan.config.statuses });
    const plan = graphPlan(model, layout, { kind, statusClass: (s) => s, titleOf: (c) => c.title, fan: { ...DEFAULTS, names: 'all' } });
    assert.deepStrictEqual(namedIn(plan), [], kind);
    assert.ok(plan.nodes.every((n) => n.name === undefined), kind);
  }
});

test('the other node classes are unchanged by the names', () => {
  const model = drawnModel(BOARDS.plan);
  const without = planOf(model, { names: 'none' });
  const withAll = planOf(model, { names: 'all' });
  withAll.nodes.forEach((n, i) => assert.strictEqual(n.cls.replace(' graph-named', ''), without.nodes[i].cls, `card ${n.id}`));
});
