const { test } = require('node:test');
const assert = require('node:assert');

const {
  GRAPH_FAN_OPTION_VALUES, GRAPH_FAN_OPTION_DEFAULTS, mergeGraphFanOptions, mergeGraphOptionsFolded,
} = require('../web/graph-model');

// The tier fan's option row holds four settings: how the parent lines are drawn
// (lines), whether the dependency arrows are (dependencies), how siblings are
// ordered within a sector (order), and which cards carry their title (names). What a
// browser stored for a board is merged with the defaults the way the Map's options
// are: a stale or hand-edited value is read as its default.

const plain = (v) => JSON.parse(JSON.stringify(v));
const DEFAULTS = { lines: 'folded', dependencies: 'on', order: 'status', names: 'relevant' };

test('the options offer lines: folded, chain, all, off; dependencies: on, off; order: status, rank; names: relevant, all, none, the first of each the default', () => {
  assert.deepStrictEqual(plain(GRAPH_FAN_OPTION_VALUES), {
    lines: ['folded', 'chain', 'all', 'off'],
    dependencies: ['on', 'off'],
    order: ['status', 'rank'],
    names: ['relevant', 'all', 'none'],
  });
  assert.deepStrictEqual(plain(GRAPH_FAN_OPTION_DEFAULTS), DEFAULTS);
});

test('nothing stored gives the defaults: folded, on, status, relevant', () => {
  for (const nothing of [undefined, null, {}, [], 'folded', 7, true]) {
    assert.deepStrictEqual(plain(mergeGraphFanOptions(nothing)), DEFAULTS, JSON.stringify(nothing));
  }
});

test('a stored choice is kept and the rest stays at its default', () => {
  assert.deepStrictEqual(plain(mergeGraphFanOptions({ lines: 'all' })), { ...DEFAULTS, lines: 'all' });
  assert.deepStrictEqual(plain(mergeGraphFanOptions({ dependencies: 'off', order: 'rank' })), { ...DEFAULTS, dependencies: 'off', order: 'rank' });
  assert.deepStrictEqual(
    plain(mergeGraphFanOptions({ lines: 'off', dependencies: 'off', order: 'rank', names: 'none' })),
    { lines: 'off', dependencies: 'off', order: 'rank', names: 'none' },
  );
});

test('a stored Names value merges with the defaults: all and none are kept, and the other options stay at theirs', () => {
  assert.deepStrictEqual(plain(mergeGraphFanOptions({ names: 'all' })), { ...DEFAULTS, names: 'all' });
  assert.deepStrictEqual(plain(mergeGraphFanOptions({ names: 'none' })), { ...DEFAULTS, names: 'none' });
  assert.deepStrictEqual(plain(mergeGraphFanOptions({ names: 'relevant', lines: 'all' })), { ...DEFAULTS, lines: 'all' });
  assert.deepStrictEqual(plain(mergeGraphFanOptions({ lines: 'off' })).names, 'relevant', 'a board stored before Names existed reads relevant');
});

test('an unknown stored Names value falls back to relevant, whatever its neighbours hold', () => {
  for (const unknown of ['everything', 'ALL', '', null, 0, true, ['all'], { all: true }, 'toString']) {
    assert.strictEqual(mergeGraphFanOptions({ names: unknown, lines: 'chain' }).names, 'relevant', JSON.stringify(unknown));
    assert.strictEqual(mergeGraphFanOptions({ names: unknown, lines: 'chain' }).lines, 'chain', 'the neighbour is kept');
  }
});

test('a value the row does not offer falls back to its own default, whatever its neighbours hold', () => {
  assert.deepStrictEqual(plain(mergeGraphFanOptions({ lines: 'every', dependencies: 'off', order: 'layout' })), { ...DEFAULTS, dependencies: 'off' });
  assert.deepStrictEqual(plain(mergeGraphFanOptions({ lines: ['all'], dependencies: 1, order: null })), DEFAULTS);
  assert.deepStrictEqual(plain(mergeGraphFanOptions({ lines: 'ALL' })), DEFAULTS, 'a value is compared as written');
});

test('a key the row does not have is dropped, and an inherited name such as toString is no value', () => {
  const merged = mergeGraphFanOptions({ lines: 'chain', speed: 'fast', toString: 'on', __proto__: { order: 'rank', names: 'all' } });
  assert.deepStrictEqual(plain(merged), { ...DEFAULTS, lines: 'chain' });
  assert.deepStrictEqual(Object.keys(merged), ['lines', 'dependencies', 'order', 'names']);
});

test('merging gives a new object: the stored one is not changed and the defaults are not shared', () => {
  const stored = { lines: 'all' };
  const merged = mergeGraphFanOptions(stored);
  merged.order = 'rank';
  assert.deepStrictEqual(stored, { lines: 'all' });
  assert.deepStrictEqual(plain(mergeGraphFanOptions(undefined)), DEFAULTS);
  assert.ok(Object.isFrozen(GRAPH_FAN_OPTION_DEFAULTS));
});

test('the row starts folded: only a stored true or false changes that', () => {
  assert.strictEqual(mergeGraphOptionsFolded(undefined), true);
  assert.strictEqual(mergeGraphOptionsFolded(null), true);
  assert.strictEqual(mergeGraphOptionsFolded('false'), true);
  assert.strictEqual(mergeGraphOptionsFolded(0), true);
  assert.strictEqual(mergeGraphOptionsFolded({}), true);
  assert.strictEqual(mergeGraphOptionsFolded(true), true);
  assert.strictEqual(mergeGraphOptionsFolded(false), false);
});

// --- which lines the fan draws ------------------------------------------------------

const { graphFanPlace, graphFanLines } = require('../web/graph-model');
const { card, buildOf } = require('./helpers/fan-boards');

// One tree on a board whose hierarchy is goal, strategy, objective, epic:
//   1 goal
//     2 strategy             (a band of its own)
//       7, 8                 (depth 2, one ring; 8 waits for card 5, on another tree)
//     3, 4, 5, 6             (depth 1, one ring; 4 waits for 3, a chain whose end is 4)
//   9                        (no parent and no children: no line at all)
// Cards 5 and 6 have no dependency to a sibling, and nor do 7 and 8, so they are
// chains of one, ends both, and share a ring with their sibling.
const tree = () => buildOf([
  card(1, { type: 'goal' }),
  card(2, { type: 'strategy', parent: 1 }),
  card(3, { parent: 1 }),
  card(4, { parent: 1, waiting_for: [3] }),
  card(5, { parent: 1 }),
  card(6, { parent: 1 }),
  card(7, { parent: 2 }),
  card(8, { parent: 2, waiting_for: [5] }),
  card(9),
]);

const linesOf = (model, fan) => graphFanLines(model, graphFanPlace(model).places, { ...DEFAULTS, ...fan });
const parentLines = (lines) => lines.filter((l) => l.kind === 'parent')
  .map((l) => (l.kids ? `${l.from}*[${l.kids.join(',')}]` : `${l.from}>${l.to}`)).sort();
const waitLines = (lines) => lines.filter((l) => l.kind === 'wait').map((l) => `${l.from}>${l.to}`).sort();

test('all gives a line to every child, one each, and off gives none', () => {
  const model = tree();
  assert.deepStrictEqual(parentLines(linesOf(model, { lines: 'all' })), ['1>2', '1>3', '1>4', '1>5', '1>6', '2>7', '2>8']);
  assert.deepStrictEqual(parentLines(linesOf(model, { lines: 'off' })), []);
});

test('chain gives a line to every chain end and none to the other children', () => {
  const model = tree();
  assert.deepStrictEqual(parentLines(linesOf(model, { lines: 'chain' })), ['1>2', '1>4', '1>5', '1>6', '2>7', '2>8']);
  assert.ok(!parentLines(linesOf(model, { lines: 'chain' })).includes('1>3'), 'card 3 is waited for by its sibling 4, so it is not the end of its chain');
});

test('the chain ends are read on the whole board: hiding a card never moves a line', () => {
  const cards = [
    card(1, { type: 'goal' }), card(2, { parent: 1 }), card(3, { parent: 1, waiting_for: [2] }), card(4, { parent: 1, waiting_for: [3] }),
  ];
  const all = buildOf(cards);
  const hidden = buildOf(cards, undefined, [1, 2, 3]);
  assert.deepStrictEqual(parentLines(linesOf(all, { lines: 'chain' })), ['1>4']);
  assert.deepStrictEqual(parentLines(linesOf(hidden, { lines: 'chain' })), [], 'card 4 is hidden and no other child of card 1 is the end of the chain');
});

test('a chain that loops has no end, so all of it takes a line', () => {
  const model = buildOf([card(1, { type: 'goal' }), card(2, { parent: 1, waiting_for: [3] }), card(3, { parent: 1, waiting_for: [2] })]);
  assert.deepStrictEqual(parentLines(linesOf(model, { lines: 'chain' })), ['1>2', '1>3']);
});

test('folded gives an end in a real chain its own line, and the other children on one ring one counted line', () => {
  const model = tree();
  const lines = linesOf(model, { lines: 'folded' });
  assert.deepStrictEqual(parentLines(lines), ['1*[5,6]', '1>2', '1>4', '2*[7,8]']);
  const counted = lines.filter((l) => l.kids);
  assert.deepStrictEqual(counted.map((l) => [l.from, l.to, l.count, l.link]), [[2, 2, 2, null], [1, 1, 2, null]], 'both ends the parent, and the number of children it carries');
});

test('folded keeps a card that is alone on its ring on its own line: only children on one ring share', () => {
  const lines = linesOf(tree(), { lines: 'folded' });
  assert.ok(parentLines(lines).includes('1>2'), 'card 2 is a strategy, on a band of its own, so it does not share a line with cards 5 and 6');
  assert.ok(!parentLines(lines).includes('1>3'), 'card 3 is no chain end');
  assert.ok(!parentLines(lines).includes('1>5') && !parentLines(lines).includes('1>6'), 'cards 5 and 6 are on the counted line');
});

test('folded gives each parent its own counted line, and counts the children it carries in outline order', () => {
  const model = buildOf([
    card(1, { type: 'goal' }), card(2, { type: 'goal' }),
    card(3, { parent: 1 }), card(4, { parent: 1 }), card(5, { parent: 1 }), card(6, { parent: 2 }), card(7, { parent: 2 }),
  ]);
  const counted = linesOf(model, { lines: 'folded' }).filter((l) => l.kids);
  assert.deepStrictEqual(counted.map((l) => [l.from, l.kids, l.count]), [[1, [3, 4, 5], 3], [2, [6, 7], 2]]);
});

test('folded never gives a line to a child that is not a chain end, and the lines of chain are the most it ever draws', () => {
  const model = tree();
  const chain = new Set(linesOf(model, { lines: 'chain' }).filter((l) => l.kind === 'parent').map((l) => l.to));
  const folded = linesOf(model, { lines: 'folded' }).filter((l) => l.kind === 'parent');
  for (const l of folded) for (const id of l.kids || [l.to]) assert.ok(chain.has(id), `card ${id}`);
});

test('dependencies on draws a line for each wait, from the card waited for, and off draws none, whatever the lines', () => {
  const model = tree();
  for (const lines of ['folded', 'chain', 'all', 'off']) {
    assert.deepStrictEqual(waitLines(linesOf(model, { lines, dependencies: 'on' })), ['3>4', '5>8'], lines);
    assert.deepStrictEqual(waitLines(linesOf(model, { lines, dependencies: 'off' })), [], lines);
  }
  assert.deepStrictEqual(parentLines(linesOf(model, { lines: 'all', dependencies: 'off' })).length, 7, 'turning the arrows off leaves the parent lines');
});

test('the lines come in the order of the model\'s relations, and the same options give the same lines', () => {
  const model = tree();
  const lines = linesOf(model, { lines: 'folded' });
  assert.deepStrictEqual(lines, linesOf(model, { lines: 'folded' }));
  assert.deepStrictEqual(lines.map((l) => [l.kind, l.from, l.to]), [
    ['parent', 1, 2], ['parent', 2, 2], ['wait', 5, 8], ['parent', 1, 4], ['wait', 3, 4], ['parent', 1, 1],
  ]);
  const own = lines.filter((l) => l.link !== null);
  assert.ok(own.every((l, i) => i === 0 || l.link > own[i - 1].link));
  for (const l of own) assert.deepStrictEqual([model.links[l.link].from, model.links[l.link].to, model.links[l.link].kind], [l.from, l.to, l.kind]);
});

test('no option reaches the layout: the same cards give the same places whatever the lines and dependencies', () => {
  const model = tree();
  const before = JSON.stringify([...graphFanPlace(model).places]);
  for (const lines of ['folded', 'chain', 'all', 'off']) linesOf(model, { lines, dependencies: 'off' });
  assert.strictEqual(JSON.stringify([...graphFanPlace(model).places]), before);
});

// --- the order of siblings within a sector -------------------------------------------

const { graphLayout, graphLayoutCacheClear, graphSignature } = require('../web/graph-model');
const { mapOrderRow } = require('../web/map-relations');

const STATUSES = ['backlog', 'todo', 'doing', 'done'];

// Card 1 is a goal with five untyped children (2 to 6) in rank order, and card 4 two
// children of its own (7 and 8). Three goals nobody is nested in (20 to 22) share the
// sector of the loose cards with a tier. A card's seat is read off its angle: the fan
// seats a sector's cards one after another from the left of the seam, the angle falling.
const siblings = () => buildOf([
  card(1, { type: 'goal' }),
  card(2, { parent: 1, status: 'done' }), card(3, { parent: 1, status: 'backlog' }), card(4, { parent: 1, status: 'doing' }),
  card(5, { parent: 1, status: 'todo' }), card(6, { parent: 1, status: 'doing' }),
  card(7, { parent: 4, status: 'done' }), card(8, { parent: 4, status: 'doing' }),
  card(20, { type: 'goal', status: 'done' }), card(21, { type: 'goal', status: 'doing' }), card(22, { type: 'goal', status: 'todo' }),
]);

const seats = (model, order, ids) => {
  const layout = graphLayout(model, 'tiers', { statuses: STATUSES, order });
  return ids.slice().sort((a, b) => layout.polar.get(b).a - layout.polar.get(a).a);
};

// The Map's own row order for the same cards, as the Map asks for it.
const mapRow = (model, ids, order) => mapOrderRow(ids, { nodes: model.nodes }, order, STATUSES);

test('order status seats siblings doing, todo, backlog, done, the way the Map orders its rows; ties keep the outline\'s order', () => {
  const model = siblings();
  assert.deepStrictEqual(seats(model, 'status', [2, 3, 4, 5, 6]), [4, 6, 5, 3, 2]);
  assert.deepStrictEqual(seats(model, 'status', [7, 8]), [8, 7], 'the children of a card are ordered as well');
  assert.deepStrictEqual(seats(model, 'status', [20, 21, 22]), [21, 22, 20], 'and so are the loose cards with a tier, which share a sector');
});

test('order rank seats siblings in the outline\'s own order, by rank', () => {
  const model = siblings();
  assert.deepStrictEqual(seats(model, 'rank', [2, 3, 4, 5, 6]), [2, 3, 4, 5, 6]);
  assert.deepStrictEqual(seats(model, 'rank', [7, 8]), [7, 8]);
  assert.deepStrictEqual(seats(model, 'rank', [20, 21, 22]), [20, 21, 22]);
  const ranked = buildOf([
    card(1, { type: 'goal' }), card(2, { parent: 1, rank: 30 }), card(3, { parent: 1, rank: 10 }), card(4, { parent: 1, rank: 20 }),
  ]);
  assert.deepStrictEqual(seats(ranked, 'rank', [2, 3, 4]), [3, 4, 2]);
});

test('the two orders differ, each is deterministic, and each matches the Map\'s row order for the same cards', () => {
  const model = siblings();
  const groups = [[2, 3, 4, 5, 6], [7, 8], [20, 21, 22]];
  for (const ids of groups) {
    const status = seats(model, 'status', ids);
    const rank = seats(model, 'rank', ids);
    assert.notDeepStrictEqual(status, rank, ids.join());
    assert.deepStrictEqual(status, seats(model, 'status', ids), 'the same cards seat the same way');
    assert.deepStrictEqual(status, mapRow(model, ids, 'status'), `${ids.join()}: the Map's status order`);
    assert.deepStrictEqual(rank, mapRow(model, ids, 'layout'), `${ids.join()}: the Map's layout order, which is the outline's`);
  }
});

test('order status is the default, and an unknown order reads as it', () => {
  const model = siblings();
  const ids = [2, 3, 4, 5, 6];
  const by = (opts) => {
    const layout = graphLayout(model, 'tiers', opts);
    return ids.slice().sort((a, b) => layout.polar.get(b).a - layout.polar.get(a).a);
  };
  assert.deepStrictEqual(by({ statuses: STATUSES }), [4, 6, 5, 3, 2]);
  assert.deepStrictEqual(by({ statuses: STATUSES, order: 'layout' }), [4, 6, 5, 3, 2]);
});

test('the order moves siblings within their own stretch and nothing else: every card keeps its band, ring and sector', () => {
  const model = siblings();
  const status = graphLayout(model, 'tiers', { statuses: STATUSES, order: 'status' });
  const rank = graphLayout(model, 'tiers', { statuses: STATUSES, order: 'rank' });
  assert.deepStrictEqual([...status.places], [...rank.places]);
  assert.deepStrictEqual(status.sectors.map((s) => [s.kind, s.rootId, s.from, s.to]), rank.sectors.map((s) => [s.kind, s.rootId, s.from, s.to]));
  for (const n of model.nodes) assert.strictEqual(status.polar.get(n.id).r, rank.polar.get(n.id).r, `card ${n.id} stays on its ring`);
  assert.ok(Math.abs(status.polar.get(1).a - rank.polar.get(1).a) < 1e-9, 'a root with no sibling stays in the middle of its sector');
  const [kid7, kid8] = [7, 8].map((id) => status.polar.get(id).a);
  assert.ok(Math.abs((kid7 + kid8) / 2 - status.polar.get(4).a) < 1e-9, 'a parent stays between its two children, whichever way they are ordered');
});

test('the order is in the layout\'s cache key: another order is another layout, the same order the same one', () => {
  const model = siblings();
  graphLayoutCacheClear();
  const a = graphLayout(model, 'tiers', { statuses: STATUSES, order: 'status' });
  const b = graphLayout(model, 'tiers', { statuses: STATUSES, order: 'rank' });
  assert.notStrictEqual(a, b);
  assert.strictEqual(graphLayout(model, 'tiers', { statuses: STATUSES, order: 'status' }), a);
  assert.strictEqual(graphLayout(model, 'tiers', { statuses: STATUSES, order: 'rank' }), b);
});

test('the order is not in the signature the view compares to re-fit an untouched view: it seats siblings and frames the same cards', () => {
  const model = siblings();
  assert.strictEqual(graphSignature(model, 'tiers', { statuses: STATUSES, order: 'status' }), graphSignature(model, 'tiers', { statuses: STATUSES, order: 'rank' }));
  assert.strictEqual(graphSignature(model, 'tiers', { statuses: STATUSES }), graphSignature(model, 'tiers', { statuses: STATUSES, order: 'status' }));
  graphLayoutCacheClear();
  const status = graphLayout(model, 'tiers', { statuses: STATUSES, order: 'status' });
  const rank = graphLayout(model, 'tiers', { statuses: STATUSES, order: 'rank' });
  assert.notStrictEqual(status, rank, 'while the layout is still not shared between the two orders');
});

test('the lines and dependencies are not in the cache key: they only redraw', () => {
  const model = siblings();
  const base = graphSignature(model, 'tiers', { statuses: STATUSES, order: 'status' });
  assert.strictEqual(graphSignature(model, 'tiers', { statuses: STATUSES, order: 'status', lines: 'all', dependencies: 'off' }), base);
});
