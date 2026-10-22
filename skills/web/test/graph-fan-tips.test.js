const { test, after } = require('node:test');
const assert = require('node:assert');

const {
  graphBuild, graphLayoutHierarchy, graphPlan, graphFanPlace, graphVisibleIds, graphTipAt,
} = require('../web/graph-model');
const { parseSearchQuery, filterCards } = require('../web/search');
const { sliceListOf } = require('../web/slice-run');
const {
  STATUSES, loadBoard, cleanUp, card, drawnModel, buildOf,
} = require('./helpers/fan-boards');

// A caption of the tier fan names its band and nothing more. What the band holds
// shows in a tip: the number of cards, how they split by status, and the term a
// reader types to cut to the slice. graphPlan is the one pure function that
// decides what a tip says (graph-view.js only shows it), and graphTipAt where it
// stands. The plan board is the browser runner's own fixture.

after(cleanUp);

const planBoard = loadBoard('plan');
const OPTS = { kind: 'hierarchy', statusClass: (s) => s, titleOf: (c) => c.title };
const planOf = (m) => graphPlan(m, graphLayoutHierarchy(m, { statuses: STATUSES, unnested: 'table' }), OPTS);
const tips = (plan) => Object.fromEntries(plan.captions.map((c) => [c.name, c.tip]));
const sorted = (ids) => ids.slice().sort((a, b) => a - b);

// --- the tier and depth captions ------------------------------------------------------------

test('tips: a tier or depth caption carries the number of cards, the split by status and the slice: term', () => {
  const t = tips(planOf(drawnModel(planBoard)));
  assert.deepStrictEqual(t.goal, { lines: ['2 cards', 'backlog 1 · doing 1'], term: 'slice:goal' });
  assert.deepStrictEqual(t.strategy, { lines: ['2 cards', 'todo 1 · doing 1'], term: 'slice:strategy' });
  assert.deepStrictEqual(t.objective, { lines: ['1 card', 'todo 1'], term: 'slice:objective' });
  assert.deepStrictEqual(t.epic, { lines: ['1 card', 'doing 1'], term: 'slice:epic' });
  assert.deepStrictEqual(t['depth 0'], { lines: ['6 cards', 'backlog 2 · todo 2 · doing 1 · done 1'], term: 'slice:0' });
  assert.deepStrictEqual(t['depth 1'], { lines: ['1 card', 'todo 1'], term: 'slice:1' });
});

test('tips: the split follows the board\'s status order, not the order cards come in', () => {
  const cards = [card(1, { type: 'goal', status: 'done' }), card(2, { type: 'goal', status: 'backlog' }), card(3, { type: 'goal', status: 'doing' }), card(4, { type: 'goal', status: 'todo' })];
  const plan = planOf(buildOf(cards, ['goal']));
  assert.deepStrictEqual(plan.captions[0].tip.lines, ['4 cards', 'backlog 1 · todo 1 · doing 1 · done 1']);
  const reversed = graphPlan(buildOf(cards, ['goal']), graphLayoutHierarchy(buildOf(cards, ['goal']), { statuses: ['done', 'doing', 'todo', 'backlog'], unnested: 'table' }), OPTS);
  assert.deepStrictEqual(reversed.captions[0].tip.lines, ['4 cards', 'done 1 · doing 1 · todo 1 · backlog 1']);
});

test('tips: a status the board does not list counts under its first column, as it is filed, and an archived card under archived, last', () => {
  const cards = [card(1, { type: 'goal', status: 'someday' }), card(2, { type: 'goal', status: 'doing' }), card(3, { type: 'goal', status: 'done', archived: true })];
  const plan = planOf(buildOf(cards, ['goal']));
  assert.deepStrictEqual(plan.captions[0].tip.lines, ['3 cards', 'backlog 1 · doing 1 · archived 1']);
});

test('tips: a tier nobody is in says 0 cards and has no split to show, and still names the term', () => {
  const plan = planOf(buildOf([card(1, { type: 'epic' }), card(2, { parent: 1 })], ['goal', 'epic']));
  assert.deepStrictEqual(plan.captions[0].tip, { lines: ['0 cards'], term: 'slice:goal' });
});

test('tips: the count is the number of cards drawn on the band, whatever the caption says', () => {
  const plan = planOf(drawnModel(planBoard));
  for (const c of plan.captions) assert.strictEqual(c.tip.lines[0], `${c.count} card${c.count === 1 ? '' : 's'}`, c.name);
});

test('tips: with the Archive status pill on, an archived card counts in its band and under archived in the split', () => {
  const filter = { backlog: true, todo: true, doing: true, done: true, archive: true };
  const m = graphBuild(planBoard.all, {
    ctx: planBoard.ctx, hierarchy: planBoard.config.hierarchy, visibleIds: graphVisibleIds(planBoard.all, null, filter, STATUSES),
  });
  const plan = planOf(m);
  const place = graphFanPlace(m, { statuses: STATUSES });
  const archivedIn = m.nodes.filter((n) => n.archived && place.places.get(n.id).block === null);
  assert.ok(archivedIn.length >= 1, 'the fixture has an archived card that sits in a band');
  const band = place.places.get(archivedIn[0].id).band;
  const caption = plan.captions.find((c) => c.band === band);
  assert.match(caption.tip.lines[1], /archived 1$/);
  assert.strictEqual(caption.tip.lines[0], `${caption.count} cards`);
});

test('tips: a tier named with a space is typed in quotes, and a hierarchy name keeps the letters it was written in', () => {
  const m = buildOf([card(1, { type: 'big goal' }), card(2, { type: 'Epic' })], ['big goal', 'Epic']);
  const plan = planOf(m);
  assert.deepStrictEqual(plan.captions.map((c) => c.tip.term), ['slice:"big goal"', 'slice:Epic']);
});

test('tips: a board without a hierarchy tips its depths by number, root as 0', () => {
  const board = loadBoard('fixture');
  const plan = planOf(drawnModel(board));
  assert.deepStrictEqual(plan.captions.map((c) => [c.name, c.tip.term]), [['depth 0', 'slice:0'], ['depth 1', 'slice:1'], ['depth 2', 'slice:2']]);
});

test('tips: a caption names its slice as the slice section does, the depth that holds the roots included', () => {
  for (const board of [loadBoard('plan'), loadBoard('fixture')]) {
    const m = drawnModel(board);
    const section = sliceListOf({ axis: m.axis, byId: new Map(m.nodes.map((n) => [n.id, { index: n.sliceIndex }])) }, m.nodes.map((n) => n.id));
    const captioned = planOf(m).captions.filter((c) => c.tip.term);
    assert.ok(captioned.length >= 3, board.name);
    for (const c of captioned) assert.strictEqual(c.name, section.find((e) => e.index === c.band).label, `${board.name}: ${c.tip.term}`);
  }
});

// What a reader types is what the caption stands for: the term in a tip cuts to the
// cards of the band it is on (the Unnested cards of depth 0 are in that slice too).
test('tips: the term in a tip cuts to exactly the cards of its band', () => {
  const ctx = { ...planBoard.ctx, hierarchy: planBoard.config.hierarchy };
  const cut = (term) => sorted(filterCards(planBoard.live, parseSearchQuery(term, planBoard.name), ctx).map((c) => c.id));
  const m = drawnModel(planBoard);
  const place = graphFanPlace(m, { statuses: STATUSES });
  const plan = planOf(m);
  for (const c of plan.captions) {
    const band = sorted(m.nodes.filter((n) => place.places.get(n.id).band === c.band && place.places.get(n.id).block === null).map((n) => n.id));
    const loose = c.name === 'depth 0' ? m.nodes.filter((n) => place.places.get(n.id).block !== null).map((n) => n.id) : [];
    assert.deepStrictEqual(cut(c.tip.term), sorted(band.concat(loose)), `${c.name}: ${c.tip.term}`);
  }
  const fixture = loadBoard('fixture');
  const fm = drawnModel(fixture);
  const fplace = graphFanPlace(fm, { statuses: STATUSES });
  const roots = planOf(fm).captions.find((c) => c.name === 'depth 0');
  const ring = fm.nodes.filter((n) => fplace.places.get(n.id).band === roots.band && fplace.places.get(n.id).block === null).map((n) => n.id);
  const whole = sorted(filterCards(fixture.live, parseSearchQuery(roots.tip.term, fixture.name), { ...fixture.ctx, hierarchy: [] }).map((c) => c.id));
  const block = fm.nodes.filter((n) => fplace.places.get(n.id).block !== null).map((n) => n.id);
  assert.deepStrictEqual(whole, sorted(ring.concat(block)), 'slice:0 is the depth 0 ring and the Unnested cards, which are depth 0 too');
});

// --- the loose caption and the Unnested block -------------------------------------------------

test('tips: the loose caption and the Unnested block count their cards in a tip, and name no slice', () => {
  const plan = planOf(drawnModel(planBoard));
  assert.deepStrictEqual(plan.looseCaption.tip, { lines: ['1 card', 'todo 1'], term: null });
  assert.deepStrictEqual(plan.block.title.tip, { lines: ['13 cards', 'backlog 4 · todo 4 · doing 2 · done 3'], term: null });
  assert.deepStrictEqual(plan.block.columns.map((c) => [c.label, c.caption.tip]), [
    ['backlog', { lines: ['4 cards'], term: null }],
    ['todo', { lines: ['4 cards'], term: null }],
    ['doing', { lines: ['2 cards'], term: null }],
    ['done', { lines: ['3 cards'], term: null }],
  ]);
});

test('tips: the block\'s archived column tips its own count, and the title splits it last', () => {
  const filter = { backlog: true, todo: true, doing: true, done: true, archive: true };
  const m = graphBuild(planBoard.all, {
    ctx: planBoard.ctx, hierarchy: planBoard.config.hierarchy, visibleIds: graphVisibleIds(planBoard.all, null, filter, STATUSES),
  });
  const { block } = planOf(m);
  const last = block.columns[block.columns.length - 1];
  assert.strictEqual(last.label, 'archived');
  assert.deepStrictEqual(last.caption.tip, { lines: ['2 cards'], term: null });
  assert.deepStrictEqual(block.title.tip, { lines: ['15 cards', 'backlog 4 · todo 4 · doing 2 · done 3 · archived 2'], term: null });
});

test('tips: a caption with one card says card, not cards', () => {
  const plan = planOf(buildOf([card(1), card(2, { type: 'epic' })]));
  assert.deepStrictEqual(plan.block.columns[0].caption.tip.lines, ['1 card']);
  assert.deepStrictEqual(plan.looseCaption.tip.lines[0], '1 card');
});

// --- where the tip stands ------------------------------------------------------------------------

const STAGE = { w: 800, h: 600 };
const TIP = { w: 160, h: 60 };

test('tip place: under the caption, its left edge on the caption\'s, a gap apart', () => {
  assert.deepStrictEqual(graphTipAt({ x0: 100, y0: 200, x1: 150, y1: 214 }, STAGE, TIP, 6), { x: 100, y: 220 });
});

test('tip place: pushed in from the right edge so the whole tip is on the stage', () => {
  assert.deepStrictEqual(graphTipAt({ x0: 760, y0: 200, x1: 790, y1: 214 }, STAGE, TIP, 6), { x: 640, y: 220 });
});

test('tip place: pushed in from the left edge', () => {
  assert.deepStrictEqual(graphTipAt({ x0: -30, y0: 200, x1: 10, y1: 214 }, STAGE, TIP, 6), { x: 0, y: 220 });
});

test('tip place: above the caption when there is no room under it', () => {
  assert.deepStrictEqual(graphTipAt({ x0: 100, y0: 560, x1: 150, y1: 574 }, STAGE, TIP, 6), { x: 100, y: 494 });
});

test('tip place: a tip bigger than the stage sits at its corner rather than off it', () => {
  assert.deepStrictEqual(graphTipAt({ x0: 100, y0: 20, x1: 150, y1: 34 }, { w: 100, h: 40 }, TIP, 6), { x: 0, y: 0 });
});
