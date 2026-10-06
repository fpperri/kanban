const { test } = require('node:test');
const assert = require('node:assert');
const { rollupIndex } = require('../web/nesting');

const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };
const card = (id, extra) => Object.assign({ id, parent: null, rank: null, priority: 'Normal', status: 'todo', archived: false }, extra);
const plain = (counts) => Object.assign({}, counts);

// An objective over two epics over stories, plus a loose story on the side.
function roadmap() {
  return [
    card(1),
    card(2, { parent: 1 }),
    card(3, { parent: 1 }),
    card(10, { parent: 2, status: 'done' }),
    card(11, { parent: 2, status: 'doing' }),
    card(12, { parent: 3, status: 'backlog' }),
    card(13, { parent: 3, status: 'todo' }),
    card(14, { parent: 3, status: 'done' }),
    card(99, { status: 'todo' }),
  ];
}

// --- altitude ---------------------------------------------------------

test('altitude: an objective over two epics with stories stands at 2, an epic at 1, a story at 0', () => {
  const idx = rollupIndex(roadmap(), CTX);
  assert.strictEqual(idx.altitudeOf(1), 2);
  assert.strictEqual(idx.altitudeOf(2), 1);
  assert.strictEqual(idx.altitudeOf(10), 0);
  assert.strictEqual(idx.altitudeOf(99), 0);
});

test('altitude is blind to type: a story with sub-steps stands at 1, like an epic', () => {
  const cards = [card(1, { type: 'story' }), card(2, { parent: 1, type: 'story' }), card(3, { parent: 1 })];
  assert.strictEqual(rollupIndex(cards, CTX).altitudeOf(1), 1);
});

test('altitude follows the longest chain below, not the first one', () => {
  const cards = [card(1), card(2, { parent: 1 }), card(3, { parent: 1 }), card(4, { parent: 3 }), card(5, { parent: 4 })];
  assert.strictEqual(rollupIndex(cards, CTX).altitudeOf(1), 3);
});

test('altitude counts archived cards below: it is structure, not progress', () => {
  const cards = [card(1), card(2, { parent: 1, archived: true, status: 'done' })];
  assert.strictEqual(rollupIndex(cards, CTX).altitudeOf(1), 1);
});

test('altitude of a card the board does not hold is 0', () => {
  assert.strictEqual(rollupIndex(roadmap(), CTX).altitudeOf(404), 0);
});

test('a parent named on another board adds no altitude to this board', () => {
  const cards = [card(1), card(2, { parent: 'fpp#1' })];
  assert.strictEqual(rollupIndex(cards, CTX).altitudeOf(1), 0);
});

test('a loop of parents terminates: altitude stops at the card it would repeat', () => {
  const cards = [card(1, { parent: 2 }), card(2, { parent: 1 })];
  const idx = rollupIndex(cards, CTX);
  assert.strictEqual(idx.altitudeOf(1), 1);
  assert.strictEqual(idx.altitudeOf(2), 1);
  const self = [card(5, { parent: 5 })];
  assert.strictEqual(rollupIndex(self, CTX).altitudeOf(5), 0);
});

// --- leaves and roll-up -----------------------------------------------

test('leavesBelow lists the cards with no children under a card, never the intermediate parents', () => {
  const idx = rollupIndex(roadmap(), CTX);
  assert.deepStrictEqual(idx.leavesBelow(1).map((c) => c.id).sort((a, b) => a - b), [10, 11, 12, 13, 14]);
  assert.deepStrictEqual(idx.leavesBelow(2).map((c) => c.id).sort((a, b) => a - b), [10, 11]);
  assert.deepStrictEqual(idx.leavesBelow(10), []);
});

test('an objective over two epics with stories counts only the stories', () => {
  const r = rollupIndex(roadmap(), CTX).rollup(1);
  assert.strictEqual(r.total, 5);
  assert.deepStrictEqual(plain(r.counts), { done: 2, doing: 1, backlog: 1, todo: 1 });
  assert.deepStrictEqual(r.leaves.slice().sort((a, b) => a - b), [10, 11, 12, 13, 14]);
});

test('a card with no children rolls up to nothing', () => {
  const r = rollupIndex(roadmap(), CTX).rollup(10);
  assert.strictEqual(r.total, 0);
  assert.deepStrictEqual(plain(r.counts), {});
  assert.deepStrictEqual(r.leaves, []);
});

test('archiving a done story leaves the parent\'s done count unchanged', () => {
  const before = rollupIndex(roadmap(), CTX).rollup(2);
  const cards = roadmap();
  cards.find((c) => c.id === 10).archived = true;
  const after = rollupIndex(cards, CTX).rollup(2);
  assert.strictEqual(before.counts.done, 1);
  assert.strictEqual(after.counts.done, 1);
  assert.strictEqual(after.total, before.total);
});

test('an archived leaf counts as done whatever its status says', () => {
  const cards = roadmap();
  Object.assign(cards.find((c) => c.id === 11), { archived: true, status: 'doing' });
  const r = rollupIndex(cards, CTX).rollup(2);
  assert.deepStrictEqual(plain(r.counts), { done: 2 });
});

test('with archived leaves left out, the archived done story drops from the bar', () => {
  const cards = roadmap();
  cards.find((c) => c.id === 10).archived = true;
  const r = rollupIndex(cards, CTX).rollup(2, { countArchived: false });
  assert.strictEqual(r.total, 1);
  assert.deepStrictEqual(plain(r.counts), { doing: 1 });
  assert.deepStrictEqual(r.leaves, [11]);
});

test('a parent whose only children are archived rolls up to 0 when archived leaves are left out', () => {
  const cards = [card(1), card(2, { parent: 1, archived: true, status: 'done' })];
  const idx = rollupIndex(cards, CTX);
  assert.strictEqual(idx.rollup(1, { countArchived: false }).total, 0);
  assert.strictEqual(idx.rollup(1).total, 1);
  assert.strictEqual(idx.altitudeOf(1), 1);
});

test('statuses are free text and bucket by their raw string', () => {
  const cards = [card(1), card(2, { parent: 1, status: 'in-review' }), card(3, { parent: 1, status: 'In-Review' }), card(4, { parent: 1, status: 'in-review' })];
  const r = rollupIndex(cards, CTX).rollup(1);
  assert.deepStrictEqual(plain(r.counts), { 'in-review': 2, 'In-Review': 1 });
});

test('a status named like an object property still counts', () => {
  const cards = [card(1), card(2, { parent: 1, status: 'constructor' }), card(3, { parent: 1, status: '__proto__' })];
  const r = rollupIndex(cards, CTX).rollup(1);
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.counts.constructor, 1);
  assert.strictEqual(r.counts.__proto__, 1);
});

test('the roll-up names the board it counted', () => {
  assert.deepStrictEqual(rollupIndex(roadmap(), CTX).rollup(1).scope, { board: 'kanban' });
  assert.deepStrictEqual(rollupIndex(roadmap(), { priorities: [] }).rollup(1).scope, { board: '' });
});

test('a child that names a card on another board is not counted under any card here', () => {
  const cards = [card(1), card(2, { parent: 1, status: 'done' }), card(3, { parent: 'fpp#1', status: 'done' })];
  const r = rollupIndex(cards, CTX).rollup(1);
  assert.strictEqual(r.total, 1);
  assert.deepStrictEqual(r.leaves, [2]);
});

test('a loop of parents terminates and has no leaves to count', () => {
  const cards = [card(1, { parent: 2 }), card(2, { parent: 1 }), card(3, { parent: 2, status: 'done' })];
  const idx = rollupIndex(cards, CTX);
  assert.strictEqual(idx.rollup(1).total, 1);
  assert.deepStrictEqual(idx.rollup(1).leaves, [3]);
  assert.doesNotThrow(() => idx.rollup(2));
});

// --- open leaves (the done warning) -----------------------------------

test('openLeafCount counts leaves below that are neither done nor archived', () => {
  const idx = rollupIndex(roadmap(), CTX);
  assert.strictEqual(idx.openLeafCount(1), 3);
  assert.strictEqual(idx.openLeafCount(2), 1);
  assert.strictEqual(idx.openLeafCount(10), 0);
});

test('openLeafCount treats an archived leaf as finished, and only the literal status done as done', () => {
  const cards = [
    card(1),
    card(2, { parent: 1, status: 'doing', archived: true }),
    card(3, { parent: 1, status: 'Done' }),
    card(4, { parent: 1, status: 'done' }),
  ];
  assert.strictEqual(rollupIndex(cards, CTX).openLeafCount(1), 1);
});

test('the parent\'s own status never counts toward its open leaves', () => {
  const cards = [card(1, { status: 'todo' }), card(2, { parent: 1, status: 'done' })];
  assert.strictEqual(rollupIndex(cards, CTX).openLeafCount(1), 0);
});

// --- the index ----------------------------------------------------------

test('parents lists the cards that have children, so a board with none can hide its roll-up controls', () => {
  assert.deepStrictEqual(rollupIndex(roadmap(), CTX).parents().sort((a, b) => a - b), [1, 2, 3]);
  assert.deepStrictEqual(rollupIndex([card(1), card(2)], CTX).parents(), []);
});
