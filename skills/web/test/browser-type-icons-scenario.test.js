const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const scenario = require('./browser/scenarios/type-icons');
const scenarios = require('./browser/scenarios');
const { materialize } = require('./browser/boards');
const { listActive, listArchived } = require('../scripts/card-store');
const { readConfig } = require('../scripts/config-store');
const { graphBuild, graphLayout, graphPlan } = require('../web/graph-model');
const { typeBadge } = require('../web/type-badge');
const { typeIconOutline, TYPE_ICON_NAMES } = require('../web/type-icons');

// The type-icons scenario only runs in a browser (in CI). Here its logic runs
// against a stand-in page: each expression the scenario evaluates is answered
// from what the page would draw for that board, worked out with the real board
// readers, the real Graph model and the real type chip. What is varied is what
// the page draws, so a scenario that could never fail is caught.

const tmpRoots = [];
after(() => { for (const r of tmpRoots) fs.rmSync(r, { recursive: true, force: true }); });

function loadBoard(key) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-icons-scenario-${key}-`));
  tmpRoots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const config = readConfig(dir);
  const cards = [...listActive(dir), ...listArchived(dir)];
  return { config, cards, byId: new Map(cards.map((c) => [String(c.id), c])) };
}
const BOARDS = { plan: loadBoard('plan'), malformed: loadBoard('malformed') };

const shapeOf = vm.runInNewContext(scenario.SHAPE_OF);
const RGB = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const NEUTRAL = 'rgb(139, 148, 158)';

// Where the page draws each card's dot: the Graph's own plan, read the way the
// scenario reads a dot.
function dotsOf(board, { types }) {
  const live = board.cards.filter((c) => !c.archived);
  const model = graphBuild(live, { ctx: { board: board.config.name, priorities: board.config.priorities }, types });
  const plan = graphPlan(model, graphLayout(model, 'tiers'), { statusClass: (s) => s, titleOf: (c) => c.title });
  return plan;
}

// What the page's chip for `card` is: the real chip's markup, read back.
function chipFor(card, types) {
  const html = typeBadge({ type: card.type }, types);
  if (!html) return null;
  const glyph = (html.match(/<span class="type-icon" aria-hidden="true">(.)<\/span>/) || [])[1] || '';
  const hex = (html.match(/data-type-color="(#[0-9a-fA-F]{6})"/) || [])[1];
  const colour = hex ? RGB(hex) : NEUTRAL;
  return { text: html.replace(/<[^>]*>/g, ''), glyph, iconColor: glyph ? colour : '', chipColor: colour };
}

// `drawn` varies what the page draws; the defaults are the page as it should be.
function standIn(over = {}) {
  const checks = [];
  let key = null;
  let openedCard = null;
  const opened = [];
  const page = {
    checks,
    opened,
    check: (name, ok) => checks.push([name, !!ok]),
    open: async (p, k) => { key = k; opened.push(`${k}${p}`); openedCard = (p.match(/card=(\d+)/) || [])[1] || null; },
    waitFor: async () => true,
    ev: async (expr) => {
      const board = BOARDS[key];
      const types = over.types ? over.types(board.config.types) : board.config.types;
      if (expr === scenario.DOT_SHAPES) {
        const out = {};
        for (const n of dotsOf(board, { types }).nodes) out[n.id] = over.dots ? over.dots(n, shapeOf) : (n.d ? shapeOf(n.d) : 'circle');
        return out;
      }
      if (expr === scenario.RINGS_CLEAR) {
        const nodes = dotsOf(board, { types }).nodes.filter((n) => n.d);
        const farthest = (n) => Math.max(...[...n.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Math.hypot(Number(m[1]), Number(m[2]))));
        const bad = nodes.find((n) => (over.ringsInside ? n.kidsRing - 3 : n.kidsRing) <= farthest(n));
        return bad ? { ok: false, id: bad.id } : { ok: nodes.length > 0, checked: nodes.length };
      }
      if (expr === scenario.TILES_CLEAR) return { ok: !over.tilesOverlap, checked: 1 };
      if (expr.includes('.graph-node path.graph-dot')) return true;
      if (expr === scenario.detailChip) return over.chip ? over.chip(chipFor(board.byId.get(openedCard), types)) : chipFor(board.byId.get(openedCard), types);
      for (const container of ['#board', '#map-view']) {
        const hit = [...board.byId.keys()].find((id) => expr === scenario.chipOf(container, id));
        if (hit) {
          const chip = chipFor(board.byId.get(hit), types);
          return over.chip ? over.chip(chip) : chip;
        }
      }
      throw new Error(`the stand-in page was asked something it does not know: ${expr.slice(0, 80)}`);
    },
  };
  return page;
}
const failed = (page) => page.checks.filter(([, ok]) => !ok).map(([n]) => n);

test('the scenario is registered, on the plan board with the malformed board beside it', () => {
  assert.ok(scenarios.includes(scenario));
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['malformed']);
});

test('what the scenario expects is what the real readers, the real model and the real chip make of each fixture board', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(failed(page), []);
  assert.ok(page.checks.length > 60, `only ${page.checks.length} checks ran`);
  assert.deepStrictEqual(page.opened.filter((o) => o.startsWith('plan')), ['plan/?view=graph', 'plan/', 'plan/?view=map', 'plan/?card=1', 'plan/?card=14']);
  assert.deepStrictEqual(page.opened.filter((o) => o.startsWith('malformed')), ['malformed/?view=graph', 'malformed/', 'malformed/?view=map', 'malformed/?card=1', 'malformed/?card=2']);
});

test('the scenario\'s way of reading a dot tells the five polygons apart, as the real outlines draw them', () => {
  const seen = {};
  for (const name of TYPE_ICON_NAMES.filter((n) => n !== 'circle')) seen[name] = shapeOf(typeIconOutline(name, 9));
  assert.deepStrictEqual(seen, { square: 'square', diamond: 'diamond', triangle: 'triangle', hexagon: 'hexagon', star: 'star' });
  for (const r of [4, 7.5, 12.6, 30]) {
    for (const name of Object.keys(seen)) assert.strictEqual(shapeOf(typeIconOutline(name, r)), name, `${name} at ${r}`);
  }
});

test('the plan board expects each of the six icons, and a round dot for the unknown icon, no icon and no type', () => {
  const dots = scenario.EXPECTED.plan.dots;
  assert.deepStrictEqual([...new Set(Object.values(dots))].sort(), ['circle', 'diamond', 'hexagon', 'square', 'star', 'triangle']);
  const types = BOARDS.plan.config.types;
  assert.strictEqual(types.find((t) => t.name === 'bug').icon, 'blob');
  assert.strictEqual(dots[14], 'circle');
  assert.strictEqual(dots[3], 'circle');
});

test('a page that draws every dot round fails each shape check and no other dot check', async () => {
  const page = standIn({ dots: () => 'circle' });
  await scenario.run(page);
  const names = failed(page);
  assert.ok(names.includes("plan: card 1's Graph dot is a star"));
  assert.ok(names.includes("plan: card 22's Graph dot is a square"));
  assert.ok(names.includes("malformed: card 2's Graph dot is a star"));
  assert.ok(!names.includes("plan: card 14's Graph dot is round"));
  assert.ok(!names.includes("malformed: card 1's Graph dot is round"));
});

test('a page that draws the unknown-icon type\'s dot as a shape fails that card\'s round-dot check', async () => {
  const page = standIn({ dots: (n, read) => (n.id === 14 ? 'hexagon' : (n.d ? read(n.d) : 'circle')) });
  await scenario.run(page);
  assert.deepStrictEqual(failed(page), ["plan: card 14's Graph dot is round"]);
});

test('a page that draws no glyph on any chip fails every glyph check and the unknown icon\'s no-glyph check passes', async () => {
  const page = standIn({ types: (types) => types.map(({ name, color }) => ({ name, color })) });
  await scenario.run(page);
  const names = failed(page);
  assert.ok(names.includes('plan: the Board tile of card 1 starts its chip with \u2605'));
  assert.ok(names.includes('plan: the Map row of card 24 starts its chip with \u25b2'));
  assert.ok(names.includes('plan: the details of card 1 start the chip with \u2605'));
  assert.ok(names.includes('malformed: the Board tile of card 2 starts its chip with \u2605'));
  assert.ok(!names.some((n) => /card 14 has a chip with no glyph|card 1 has a chip with no glyph/.test(n)));
});

test('a page that gives a type with an unknown icon a glyph fails that chip\'s no-glyph check, in every view', async () => {
  const page = standIn({ types: (types) => types.map((t) => (t.icon === 'blob' ? { ...t, icon: 'circle' } : t)) });
  await scenario.run(page);
  const names = failed(page);
  assert.ok(names.includes('plan: the Board tile of card 14 has a chip with no glyph'));
  assert.ok(names.includes('plan: the details of card 14 show a chip with no glyph'));
  assert.ok(names.includes("plan: card 14's Graph dot is round") === false, 'a circle icon is a round dot');
});

test('a glyph that does not wear the chip\'s colour fails the colour checks', async () => {
  const page = standIn({ chip: (chip) => (chip && chip.glyph ? { ...chip, iconColor: 'rgb(0, 0, 0)' } : chip) });
  await scenario.run(page);
  const names = failed(page);
  assert.ok(names.includes("plan: the glyph on card 1 wears the chip's colour"));
  assert.ok(names.includes("plan: the glyph on the Map row of card 2 wears the chip's colour"));
  assert.ok(names.includes("plan: the glyph in the details of card 1 wears the chip's colour"));
});

test('a chip painted in the wrong colour fails the configured-colour check', async () => {
  const page = standIn({ chip: (chip) => (chip && chip.glyph ? { ...chip, iconColor: NEUTRAL, chipColor: NEUTRAL } : chip) });
  await scenario.run(page);
  assert.ok(failed(page).includes("plan: and that colour is the type's configured one"));
});

test('rings drawn inside a shape, and a chip over the date stack, fail their checks', async () => {
  const rings = standIn({ ringsInside: true });
  await scenario.run(rings);
  assert.deepStrictEqual(failed(rings), [
    'plan: the child and flag rings sit outside every shaped dot',
    'malformed: the child and flag rings sit outside every shaped dot',
  ]);
  const tiles = standIn({ tilesOverlap: true });
  await scenario.run(tiles);
  assert.deepStrictEqual(failed(tiles), [
    "plan: a tile's chip with a glyph stays in its text column and off the date stack",
    "malformed: a tile's chip with a glyph stays in its text column and off the date stack",
  ]);
});

test('the scenario never waits on a fixed sleep, and writes no style attribute or inline handler into the page', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'type-icons.js'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src));
  assert.ok(!/setAttribute\(\s*['"]style|\.style\./.test(src));
});

// The expressions the scenario sends to the page, run here against a stand-in
// Graph built from the real plan, so a typo in one fails before the browser run.
function graphDocument(plan, { ringsInside = false } = {}) {
  const el = (attrs, extra = {}) => ({ getAttribute: (name) => (name in attrs ? String(attrs[name]) : null), tagName: attrs.tag, ...extra });
  const nodes = plan.nodes.map((n) => {
    const dot = n.d ? el({ tag: 'PATH', d: n.d }) : el({ tag: 'CIRCLE', r: n.r });
    const ring = (r) => el({ tag: 'CIRCLE', r: ringsInside ? r - 3 : r });
    return {
      dataset: { id: String(n.id) },
      querySelector(sel) {
        if (sel === '.graph-dot') return dot;
        if (sel === 'path.graph-dot') return n.d ? dot : null;
        if (sel === '.graph-kids-ring') return / has-kids/.test(n.cls) ? ring(n.kidsRing) : null;
        if (sel === '.graph-flag-ring') return / is-(blocked|waiting|review)/.test(n.cls) ? ring(n.flagRing) : null;
        throw new Error(`unexpected selector ${sel}`);
      },
    };
  });
  return { querySelectorAll: (sel) => { assert.strictEqual(sel, '#graph-view .graph-node'); return nodes; } };
}
const planOf = (key) => {
  const board = BOARDS[key];
  return dotsOf(board, { types: board.config.types });
};
const inPage = (expr, document) => vm.runInNewContext(expr, { document });

test('the dot-shape expression reads every Graph dot of both boards as the shape the model drew', () => {
  const plan = planOf('plan');
  const shapes = inPage(scenario.DOT_SHAPES, graphDocument(plan));
  for (const [id, shape] of Object.entries(scenario.EXPECTED.plan.dots)) assert.strictEqual(shapes[id], shape, `plan card ${id}`);
  assert.strictEqual(Object.keys(shapes).length, plan.nodes.length);
  const malformed = inPage(scenario.DOT_SHAPES, graphDocument(planOf('malformed')));
  for (const [id, shape] of Object.entries(scenario.EXPECTED.malformed.dots)) assert.strictEqual(malformed[id], shape, `malformed card ${id}`);
});

test('the ring expression passes when every ring clears its shape and names the node when one does not', () => {
  for (const key of ['plan', 'malformed']) {
    const ok = inPage(scenario.RINGS_CLEAR, graphDocument(planOf(key)));
    assert.strictEqual(ok.ok, true, key);
    assert.ok(ok.checked >= 1, `${key}: at least one ring was checked`);
    const bad = inPage(scenario.RINGS_CLEAR, graphDocument(planOf(key), { ringsInside: true }));
    assert.strictEqual(bad.ok, false, key);
    assert.ok(bad.id, key);
  }
});

test('every expression the scenario sends compiles as one page expression', () => {
  for (const expr of [scenario.SHAPE_OF, scenario.DOT_SHAPES, scenario.RINGS_CLEAR, scenario.TILES_CLEAR, scenario.detailChip, scenario.chipOf('#board', 1), scenario.chipOf('#map-view', 24)]) {
    assert.doesNotThrow(() => new vm.Script(expr), expr.slice(0, 60));
  }
});
