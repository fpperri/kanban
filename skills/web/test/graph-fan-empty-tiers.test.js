const { test } = require('node:test');
const assert = require('node:assert');

const { graphLayoutHierarchy, graphPlan } = require('../web/graph-model');
const { STATUSES, HIERARCHY, card, buildOf } = require('./helpers/fan-boards');

// A ring and a name belong to a slice only when a drawn card sits on it: a tier nobody
// is in is not drawn, any more than a depth nobody is on, and the rings left close up.

const OPTS = { kind: 'hierarchy', statusClass: (s) => s, titleOf: (c) => c.title };
const layoutOf = (m, unnested = 'table') => graphLayoutHierarchy(m, { statuses: STATUSES, unnested });
const planOf = (m, unnested) => graphPlan(m, layoutOf(m, unnested), OPTS);
const radius = (l, id) => Math.hypot(l.pos.get(String(id)).x, l.pos.get(String(id)).y);
const labels = (l) => l.rings.map((r) => r.label);

const outline = () => [card(1, { type: 'goal' }), card(2, { type: 'strategy', parent: 1 }), card(3, { type: 'objective', parent: 2 }), card(4, { type: 'epic', parent: 3 }), card(5, { parent: 4 })];

test('empty tiers: the four-tier hierarchy draws rings only for the tiers and depths that hold a drawn card', () => {
  const l = layoutOf(buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })]));
  assert.deepStrictEqual(labels(l), ['epic', 'depth 0']);
  assert.deepStrictEqual(l.bands.map((b) => b.slice.name || `depth ${b.slice.depth}`), ['epic', 'depth 0']);
  const plan = planOf(buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })]));
  assert.deepStrictEqual(plan.captions.map((c) => c.name), ['epic', 'depth 0']);
  assert.strictEqual(plan.guides.length, 2);
});

test('empty tiers: a search cut to one depth draws that depth\'s ring and no tier\'s', () => {
  const m = buildOf(outline(), HIERARCHY, [5]);
  const l = layoutOf(m);
  assert.deepStrictEqual(labels(l), ['depth 0']);
  assert.deepStrictEqual(planOf(m).captions.map((c) => [c.name, c.count]), [['depth 0', 1]]);
});

test('empty tiers: the rings left sit as if the empty tier were not there, no gap where it was', () => {
  const full = layoutOf(buildOf([card(1, { type: 'goal' }), card(2, { type: 'epic' }), card(3, { type: 'objective' })], ['goal', 'strategy', 'objective', 'epic']));
  assert.deepStrictEqual(labels(full), ['goal', 'objective', 'epic']);
  const packed = layoutOf(buildOf([card(1, { type: 'goal' }), card(2, { type: 'objective' }), card(3, { type: 'epic' })], ['goal', 'objective', 'epic']));
  assert.deepStrictEqual(full.rings.map((r) => r.r), packed.rings.map((r) => r.r));
  for (let i = 1; i < full.bands.length; i++) assert.strictEqual(full.bands[i].r0, full.bands[i - 1].r1);
  assert.strictEqual(full.bands[0].r0, layoutOf(buildOf([card(1, { type: 'epic' })])).bands[0].r0, 'the first ring starts where it always did');
});

test('empty tiers: no card, or none drawn, draws no ring, no band, no guide and no caption', () => {
  for (const m of [buildOf([]), buildOf(outline(), HIERARCHY, [])]) {
    const l = layoutOf(m);
    assert.deepStrictEqual([l.rings, l.bands, l.captions, l.spokes], [[], [], [], []]);
    const plan = planOf(m);
    assert.deepStrictEqual([plan.guides, plan.captions, plan.tints], [[], [], []]);
  }
});

test('empty tiers: a card hidden by the cut leaves its tier without a ring, though the board still has the tier', () => {
  const only = buildOf(outline(), HIERARCHY, [1, 4]);
  assert.deepStrictEqual(labels(layoutOf(only)), ['goal', 'epic']);
});

test('empty tiers: with Types off the board has no hierarchy, and the rings are the depths that hold a card', () => {
  const typed = outline().map((c) => ({ ...c }));
  const m = buildOf(typed, []);
  assert.deepStrictEqual(labels(layoutOf(m)), ['depth 0', 'depth 1', 'depth 2', 'depth 3', 'depth 4']);
  assert.deepStrictEqual(labels(layoutOf(buildOf(typed, [], [4]))), ['depth 3']);
  assert.deepStrictEqual(layoutOf(buildOf([], [])).rings, []);
});

test('empty tiers: the Unnested options keep their rings, and a board of loose cards alone has the Unnested ring or block only', () => {
  const cards = outline().concat([card(6), card(7, { type: 'epic' })]);
  const m = buildOf(cards);
  for (const unnested of ['outermost', 'table', 'depth 0']) {
    const l = layoutOf(m, unnested);
    assert.ok(l.bands.every((b) => b.count > 0), unnested);
  }
  assert.deepStrictEqual(labels(layoutOf(m, 'outermost')), ['goal', 'strategy', 'objective', 'epic', 'depth 0', 'unnested']);
  assert.deepStrictEqual(labels(layoutOf(buildOf([card(5)]), 'outermost')), ['unnested']);
  assert.deepStrictEqual(labels(layoutOf(buildOf([card(5)]), 'table')), []);
  assert.ok(layoutOf(buildOf([card(5)]), 'table').block);
});

test('empty tiers: the rings keep their order, tier 1 nearest the centre and the depth rings after, and a card keeps its ring', () => {
  const m = buildOf(outline());
  const l = layoutOf(m);
  assert.deepStrictEqual(labels(l), ['goal', 'strategy', 'objective', 'epic', 'depth 0']);
  const radii = l.rings.map((r) => r.r);
  assert.deepStrictEqual(radii, [...radii].sort((a, b) => a - b));
  [1, 2, 3, 4, 5].forEach((id, i) => assert.ok(Math.abs(radius(l, id) - radii[i]) < 1e-6));
});

test('empty tiers: the Hierarchy hint, the web skill and the web doc say a tier with no drawn card has no ring', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\s+/g, ' ');
  assert.match(/hierarchy: '(Hierarchy: [^']*)'/.exec(read('web', 'graph-view.js'))[1], /a tier or a depth with no drawn card has no ring/);
  assert.match(read('SKILL.md'), /neither has a tier with no drawn card: its band, arc and caption are not drawn and the rings left close up, with Types on or off/);
  assert.match(read('..', '..', 'docs', 'web.md'), /a tier or a depth with no drawn card has no ring, no arc and no name, and the rings left close up/);
});
