const { test, after } = require('node:test');
const assert = require('node:assert');

const { graphLayoutTiers, graphLayout, graphPlan } = require('../web/graph-model');
const {
  STATUSES, loadBoard, cleanUp, card, drawnModel, buildOf,
} = require('./helpers/fan-boards');
const scenario = require('./browser/scenarios/tier-fan');

// The tier fan washes each tier's band in its type's colour, so the hierarchy reads as
// coloured areas: the ladder is the picture. graphPlan lists one wash for each tier
// band that holds a card (`tints`); graph-fan-tint-view.test.js has the view stamp them.
// The plan board is the browser runner's own fixture: its hierarchy is goal, strategy,
// objective, epic; goal and epic have a colour in its config and strategy and objective
// have none.

after(cleanUp);

const planBoard = loadBoard('plan');
const TYPES = planBoard.config.types;
const OPTS = { kind: 'tiers', statusClass: (s) => s, titleOf: (c) => c.title, types: TYPES };
const layoutOf = (m, unnested = 'table') => graphLayoutTiers(m, { statuses: STATUSES, unnested });
const planOf = (m, opts = OPTS, unnested = 'table') => graphPlan(m, layoutOf(m, unnested), opts);
const planModel = (opts) => drawnModel(planBoard, opts);

// --- one wash for each tier band that holds a card, in its type's colour ---------------------

test('tint: the plan board washes its four tier bands in tier order, goal and epic in their configured colour and strategy and objective in none', () => {
  const plan = planOf(planModel());
  assert.deepStrictEqual(plan.tints.map((t) => [t.tier, t.color]), [
    ['goal', '#a371f7'], ['strategy', ''], ['objective', ''], ['epic', '#d29922'],
  ]);
});

// --- a wash is the whole ring of its band -------------------------------------------------------

// The two circles of a wash's path, outer first: each a closed pair of half arcs through
// (r, 0) and (-r, 0), the way a full circle is drawn in SVG. The radius of each is read back.
function circlesOf(d) {
  const parts = d.split('M').filter(Boolean);
  return parts.map((part) => {
    const m = /^(-?[\d.]+) 0A([\d.]+) ([\d.]+) 0 1 0 (-?[\d.]+) 0A([\d.]+) ([\d.]+) 0 1 0 (-?[\d.]+) 0Z$/.exec(part);
    assert.ok(m, `a closed circle: M${part}`);
    const [x0, rx, ry, x1, rx2, ry2, x2] = m.slice(1).map(Number);
    assert.ok(x0 === rx && rx === ry && ry === rx2 && rx2 === ry2 && x2 === x0 && x1 === -x0, `a round circle: M${part}`);
    return x0;
  });
}

test('tint: a wash is a whole ring from the inner edge of its band to the outer edge, with no seam, and holds every dot of its tier', () => {
  const m = planModel();
  const l = layoutOf(m);
  const plan = graphPlan(m, l, OPTS);
  const tiers = scenario.CASES.plan.tiers;
  plan.tints.forEach((t, i) => {
    const band = l.bands[t.band];
    assert.strictEqual(band.slice.name, t.tier);
    const [outer, inner] = circlesOf(t.d);
    assert.ok(Math.abs(outer - band.r1) < 0.01 && Math.abs(inner - band.r0) < 0.01, `${t.tier}: ${inner} to ${outer}, the band is ${band.r0} to ${band.r1}`);
    assert.ok(inner < outer);
    for (const id of tiers[i]) {
      const at = Math.hypot(l.pos.get(String(id)).x, l.pos.get(String(id)).y);
      assert.ok(at > inner && at < outer, `card ${id} of ${t.tier} is in its wash`);
    }
    assert.strictEqual(t.cls, 'graph-tint');
  });
  plan.tints.slice(1).forEach((t, i) => assert.strictEqual(circlesOf(t.d)[1], circlesOf(plan.tints[i].d)[0], `${t.tier} starts where ${plan.tints[i].tier} ends`));
});

// --- only a tier band that holds a card is washed ------------------------------------------------

test('tint: a tier nobody is in has no wash, though its thin band and its muted caption are drawn', () => {
  const m = buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })], ['goal', 'epic']);
  const plan = planOf(m, { ...OPTS, types: [{ name: 'goal', color: 'red' }, { name: 'epic', color: 'blue' }] });
  assert.deepStrictEqual(plan.captions.map((c) => [c.name, c.muted]), [['goal', true], ['epic', false], ['depth 1', false]]);
  assert.deepStrictEqual(plan.tints.map((t) => [t.tier, t.color]), [['epic', 'blue']]);
});

// --- nothing else is washed -------------------------------------------------------------------------

test('tint: the depth rings, the Unnested ring and the Unnested block get no wash, whichever way the Unnested option puts the loose cards', () => {
  for (const unnested of ['outermost', 'table', 'depth 0', 'off']) {
    const m = drawnModel(planBoard);
    const l = layoutOf(m, unnested);
    const plan = graphPlan(m, l, OPTS);
    assert.deepStrictEqual(plan.tints.map((t) => t.tier), ['goal', 'strategy', 'objective', 'epic'], unnested);
    assert.ok(l.bands.length > 4, `${unnested}: there are depth rings to leave bare`);
    assert.ok(plan.captions.some((c) => c.kind === 'depth'), `${unnested}: and they are drawn`);
  }
  const ring = layoutOf(drawnModel(planBoard), 'outermost');
  assert.strictEqual(ring.bands[ring.bands.length - 1].slice, null, 'the outermost option draws the ring of unnested cards');
  const table = graphPlan(drawnModel(planBoard), layoutOf(drawnModel(planBoard)), OPTS);
  assert.ok(table.block, 'and the table option draws the block');
});

test('tint: a board without a hierarchy draws no wash, and so does a hierarchy no card is in', () => {
  const fixture = loadBoard('fixture');
  assert.deepStrictEqual(planOf(drawnModel(fixture), { ...OPTS, types: fixture.config.types }).tints, []);
  assert.deepStrictEqual(planOf(planModel({ hierarchy: [] })).tints, []);
  assert.deepStrictEqual(planOf(buildOf([card(1), card(2, { parent: 1 })], ['goal', 'epic'])).tints, []);
});

test('tint: the Force and Status layouts draw no wash', () => {
  const m = planModel();
  for (const kind of ['force', 'status']) {
    const plan = graphPlan(m, graphLayout(m, kind, { statuses: STATUSES }), { ...OPTS, kind });
    assert.deepStrictEqual(plan.tints, [], kind);
  }
});

// --- the colour is the tier's type's ----------------------------------------------------------------

test('tint: a tier whose type is not in the board config, or is listed without a colour, gets the neutral wash, and a plan given no types washes every band neutral', () => {
  const cards = [card(1, { type: 'goal' }), card(2, { type: 'epic', parent: 1 })];
  const m = buildOf(cards, ['goal', 'epic']);
  assert.deepStrictEqual(planOf(m, { ...OPTS, types: [{ name: 'goal', color: '#112233' }] }).tints.map((t) => [t.tier, t.color]), [['goal', '#112233'], ['epic', '']]);
  assert.deepStrictEqual(planOf(m, { ...OPTS, types: [{ name: 'epic' }] }).tints.map((t) => [t.tier, t.color]), [['goal', ''], ['epic', '']]);
  const { types, ...bare } = OPTS;
  assert.deepStrictEqual(planOf(m, bare).tints.map((t) => [t.tier, t.color]), [['goal', ''], ['epic', '']]);
});

test('tint: a tier is matched to its type without regard to case, as a card\'s tier is', () => {
  const m = buildOf([card(1, { type: 'GOAL' }), card(2, { type: 'Epic', parent: 1 })], ['Goal', 'EPIC']);
  const plan = planOf(m, { ...OPTS, types: [{ name: 'goal', color: 'teal' }, { name: ' epic ', color: 'olive' }] });
  assert.deepStrictEqual(plan.tints.map((t) => [t.tier, t.color]), [['Goal', 'teal'], ['EPIC', 'olive']]);
});

// --- a cut, a status pill and isolate -----------------------------------------------------------------

const live = (pick) => planBoard.live.filter(pick).map((c) => c.id);
const typeOf = (c) => String(c.type || '').toLowerCase();

test('tint: a slice cut, a status pill and isolate keep the washes of the bands still drawn and drop those of the bands they empty, each wash on its band\'s new edges', () => {
  const cases = [
    ['slice:goal cuts to the goal band', live((c) => typeOf(c) === 'goal'), ['goal']],
    ['a pill that takes doing off', live((c) => c.status !== 'doing'), ['goal', 'strategy', 'objective']],
    ['isolate on the objective and the epic', [7, 22], ['objective', 'epic']],
    ['a cut to the cards of no tier', live((c) => !['goal', 'strategy', 'objective', 'epic'].includes(typeOf(c))), []],
  ];
  const whole = planOf(planModel());
  for (const [what, visible, tiers] of cases) {
    const m = planModel({ visible });
    const l = layoutOf(m);
    const plan = graphPlan(m, l, OPTS);
    assert.deepStrictEqual(plan.tints.map((t) => t.tier), tiers, what);
    for (const t of plan.tints) {
      const band = l.bands[t.band];
      assert.deepStrictEqual(circlesOf(t.d), [band.r1, band.r0].map((r) => Math.round(r * 100) / 100), `${what}: ${t.tier} follows its band`);
      assert.strictEqual(t.color, whole.tints.find((w) => w.tier === t.tier).color, `${what}: ${t.tier} keeps its colour`);
    }
  }
});
