const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listActive, listArchived, toJSON } = require('../../plugin/skills/web/scripts/card-store');
const { readConfig } = require('../../plugin/skills/web/scripts/config-store');
const { parseSearchQuery, filterCards, searchSuggestionItems } = require('../../plugin/skills/web/web/search');
const { buildRelationsGraph } = require('../../plugin/skills/web/web/dependency-graph');
const { mapShapeRelations } = require('../../plugin/skills/web/web/map-relations');
const { ganttGroups, rowWindowSpans, ganttWindow, ganttBarClip, GANTT_MAX_DAYS } = require('../../plugin/skills/web/web/gantt-model');
const { materialize } = require('./browser/boards');
const scenarios = require('./browser/scenarios');
const sliceTerm = require('./browser/scenarios/slice-term');

// The browser runner's slice-term scenario only runs in a browser (in CI). What
// it expects each cut to show is held here to the search module over each
// board's own cards and the hierarchy the board's own reader gives the page, and
// the scenario is run once against a stand-in page so a typo in it fails here
// and not only in a slow browser run.

const roots = [];
const load = (key) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-slice-${key}-`));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const live = listActive(dir).map(toJSON);
  return { live, all: live.concat(listArchived(dir).map(toJSON)), config: readConfig(dir) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const found = (board, name, query) => {
  const ctx = { board: name, hierarchy: board.config.hierarchy };
  return new Set(filterCards(board.all, parseSearchQuery(query, name), ctx).map((c) => c.id));
};
const shownBy = (board, name, query) => {
  const hit = found(board, name, query);
  return board.live.filter((c) => hit.has(c.id)).map((c) => Number(c.id)).sort((a, b) => a - b);
};
const datedShownBy = (board, name, query) => {
  const hit = found(board, name, query);
  return board.live.filter((c) => hit.has(c.id) && (c.start_date || c.end_date || c.due_date)).map((c) => Number(c.id)).sort((a, b) => a - b);
};

test('the scenario is in the runner, on the plan board, and also drives the fixture and malformed boards', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'slice-term'), sliceTerm);
  assert.strictEqual(sliceTerm.board, 'plan');
  assert.deepStrictEqual(sliceTerm.alsoBoards, ['fixture', 'malformed']);
});

test('on the plan board, slice:goal..objective keeps the goal, strategy and objective cards, and slice:0 keeps both dated cards', () => {
  const board = load('plan');
  const { cut, depthZero } = sliceTerm.CASES.plan;
  assert.deepStrictEqual(shownBy(board, 'plan', cut.query), cut.shows);
  assert.deepStrictEqual(datedShownBy(board, 'plan', cut.query), [], 'no dated card is in the cut, so the Gantt and the Calendar have nothing to draw');
  assert.deepStrictEqual(datedShownBy(board, 'plan', depthZero.query), depthZero.datedShows);
  const types = new Map(board.live.map((c) => [Number(c.id), c.type]));
  assert.deepStrictEqual(cut.shows.map((id) => types.get(id)), ['goal', 'strategy', 'objective', 'goal', 'strategy']);
  assert.deepStrictEqual(depthZero.datedShows.map((id) => types.get(id)), ['task', 'task']);
});

test('the lists the scenario waits for are the ones the search module offers on the plan board, and what pressing a row keeps is what the term cuts to', () => {
  const board = load('plan');
  const ctx = { board: 'plan', hierarchy: board.config.hierarchy };
  const { typed, labels, first, second } = sliceTerm.CASES.plan.suggest;
  const offered = (text) => searchSuggestionItems(text, text.length, board.all, ctx);
  assert.deepStrictEqual(offered(typed).map((i) => i.label), labels, 'after slice:');
  assert.strictEqual(offered(typed).find((i) => i.label === first.pick).value, first.pick, 'the row pressed first writes its label whole');
  assert.deepStrictEqual(shownBy(board, 'plan', first.pick), first.shows);
  const afterDots = `${first.pick}${second.typed}`;
  assert.deepStrictEqual(offered(afterDots).map((i) => i.label), second.labels, 'after the dots');
  assert.ok(offered(afterDots).some((i) => i.value === second.pick), 'the row pressed second writes the whole cut');
  assert.deepStrictEqual(shownBy(board, 'plan', second.pick), second.shows);
  assert.ok(first.shows.length < sliceTerm.CASES.plan.live.length && second.shows.length > first.shows.length, 'each cut shows some cards and the second more than the first');
});

test('the live cards each case starts from are the boards\' live cards, and the cuts hide some of them', () => {
  const ids = (board) => board.live.map((c) => Number(c.id)).sort((a, b) => a - b);
  const plan = load('plan');
  assert.deepStrictEqual(ids(plan), sliceTerm.CASES.plan.live);
  assert.deepStrictEqual(ids(load('fixture')), sliceTerm.CASES.fixture.live);
  assert.deepStrictEqual(ids(load('malformed')), sliceTerm.CASES.malformed.live);
  assert.ok(sliceTerm.CASES.plan.cut.shows.length < sliceTerm.CASES.plan.live.length);
  assert.ok(sliceTerm.CASES.fixture.shows.length < sliceTerm.CASES.fixture.live.length);
  const noHierarchy = { ...plan, config: { hierarchy: [] } };
  assert.deepStrictEqual(shownBy(noHierarchy, 'plan', sliceTerm.CASES.plan.cut.query), sliceTerm.CASES.plan.live, 'without the hierarchy the same term cuts nothing');
});

test('on today\'s fixture board, which has no hierarchy, slice:1 keeps exactly the depth-1 cards', () => {
  const board = load('fixture');
  assert.deepStrictEqual(board.config.hierarchy, []);
  const { query, shows } = sliceTerm.CASES.fixture;
  assert.deepStrictEqual(shownBy(board, 'fixture', query), shows);
  const root = board.live.find((c) => c.id === '1');
  assert.strictEqual(root.parent, null, 'card 1 is a root');
  assert.deepStrictEqual(shows, board.live.filter((c) => c.parent === '1').map((c) => Number(c.id)).sort((a, b) => a - b), 'the cards directly under it');
});

test('on the malformed board a cut naming a tier written twice in mixed case keeps that tier\'s cards', () => {
  const board = load('malformed');
  const { tier, other, run } = sliceTerm.CASES.malformed;
  for (const { query, shows } of [tier, other, run]) {
    assert.deepStrictEqual(shownBy(board, 'malformed', query), shows, query);
  }
  assert.deepStrictEqual(board.config.hierarchy, ['Goal', 'goal', 'Epic', 'EPIC'], 'each tier is listed twice in mixed case');
  const types = new Map(board.live.map((c) => [Number(c.id), c.type]));
  assert.strictEqual(types.get(tier.shows[0]), 'Goal');
  assert.strictEqual(types.get(other.shows[0]), 'epic', 'the card writes the tier in a third case than the board\'s first listing');
});

test('the selectors the scenario reads name classes and containers the page really draws', () => {
  const web = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
  const pageSource = ['app.js', 'app.html', 'graph-view.js'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  assert.deepStrictEqual(Object.keys(sliceTerm.SELECTORS), ['board', 'map', 'gantt', 'calendar', 'graph']);
  for (const [view, selector] of Object.entries(sliceTerm.SELECTORS)) {
    for (const m of selector.matchAll(/(?:^|[ .#])([a-z][\w-]*)(?=[ .[]|$)/g)) {
      assert.ok(pageSource.includes(m[1]), `${view}: ${m[1]} is not in the page code`);
    }
  }
});

// The Map draws a card in one of three ways: a node in a tree when some relation
// touches it, a tile in the No relations row when none does, and, for a card the cut
// hid that a shown card still relates to, a stub. Only the first two are cards the
// cut keeps. The Gantt lists every dated card as a row in its gutter, and draws a bar
// for it only when the bar falls in the window, which for the All sub-view is
// clamped to 180 days. The classes each is drawn with come from the page code, which
// the first test below holds them to, so each selector is held to the page's own
// relation and window code over the plan board and not to a guess at what is drawn.
const ELEMENTS = {
  mapNode: { within: '#map-view', classes: ['map-node', 'card-el'], attrs: ['data-id'] },
  mapTile: { within: '#map-view', classes: ['card', 'card-el'], attrs: ['data-id'] },
  mapStub: { within: '#map-view', classes: ['map-node', 'ghost'], attrs: ['data-id'] },
  ganttLabel: { within: '#gantt-view', classes: ['gantt-row', 'gantt-label', 'card-el'], attrs: ['data-id'] },
  ganttBar: { within: '#gantt-view', classes: ['gantt-bar', 'card-el'], attrs: ['data-id'] },
};

const selectorMatches = (selector, element) => {
  const [container, compound, ...rest] = selector.split(' ');
  assert.strictEqual(rest.length, 0, 'one compound selector below the view');
  const parts = compound.match(/\.[\w-]+|\[[\w-]+\]/g) || [];
  assert.strictEqual(parts.join(''), compound, 'the compound names classes and attributes only');
  return container === element.within
    && parts.every((p) => (p[0] === '.' ? element.classes.includes(p.slice(1)) : element.attrs.includes(p.slice(1, -1))));
};

const readBy = (selector, drawn) => [...new Set(drawn.filter(({ element }) => selectorMatches(selector, element)).map(({ id }) => Number(id)))].sort((a, b) => a - b);

test('the classes the Map and the Gantt draw their elements with come from the page code', () => {
  const web = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
  const app = fs.readFileSync(path.join(web, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(app.includes('const selectable = !n.ghost && !missing;'), 'a stub is not selectable');
  assert.ok(app.includes("map-node${n.ghost ? ' ghost' : ''}"), 'a node and a stub are both map-node, and a stub is also a ghost');
  assert.ok(app.includes("${selectable ? ' card-el' : ''}"), 'only a node that is not a stub is a card-el');
  assert.ok(app.includes('graph.ghosts.forEach((g) => allById.set(g.id, Object.assign({ ghost: true }, g)));'), 'the ghosts of a graph are the stubs');
  assert.ok(app.includes("el.className = 'card card-el'"), 'a tile is a card and a card-el');
  const row = app.slice(app.indexOf('function buildIsolatedRow('), app.indexOf('// Rich rows are HTML'));
  assert.ok(row.includes('cardEl(card)'), 'the No relations row draws each card as a tile');
  assert.ok(app.includes("label.className = 'gantt-row gantt-label card-el'"), 'a Gantt row has a label in the gutter');
  assert.ok(app.includes('label.dataset.id = bar.card.id;'), 'and the label carries the card id');
  assert.ok(app.includes('for (const bar of group.bars) {'), 'a label is drawn for every row of every group');
  assert.ok(app.includes('if (!clip) return null;'), 'a bar outside the window is not drawn');
  assert.ok(app.includes('el.className = `gantt-bar card-el status-'), 'a bar is a gantt-bar and a card-el');
});

test('the Map selector reaches each card the Map draws under the cut, the ones with a relation and the one with none, and no stub', () => {
  const board = load('plan');
  const { cut } = sliceTerm.CASES.plan;
  const rel = buildRelationsGraph(board.all, found(board, 'plan', cut.query), { board: 'plan', priorities: board.config.priorities });
  const view = mapShapeRelations(rel);
  const drawn = [
    ...view.graphs.flatMap((g) => g.nodes.map((n) => ({ id: n.id, element: ELEMENTS.mapNode }))),
    ...view.graphs.flatMap((g) => g.ghosts.map((n) => ({ id: n.id, element: ELEMENTS.mapStub }))),
    ...view.noRelations.map((id) => ({ id, element: ELEMENTS.mapTile })),
  ];
  assert.ok(view.noRelations.length > 0, 'a card in the cut has no relation, so the Map draws it as a tile and not as a node');
  assert.ok(drawn.some(({ element }) => element === ELEMENTS.mapStub), 'a card the cut hid is still drawn as a stub beside the cards it relates to');
  assert.deepStrictEqual(readBy(sliceTerm.SELECTORS.map, drawn), cut.shows, 'what the scenario reads off the Map is the cards the cut keeps');
});

test('the Gantt selector reaches the rows of both dated cards under slice:0, though the clamped All window draws neither bar', () => {
  const board = load('plan');
  const { depthZero } = sliceTerm.CASES.plan;
  const hit = found(board, 'plan', depthZero.query);
  const rows = ganttGroups(board.live.filter((c) => hit.has(c.id)), board.config.statuses).flatMap((g) => g.bars);
  assert.deepStrictEqual(rows.map((r) => Number(r.card.id)).sort((a, b) => a - b), depthZero.datedShows, 'the Gantt lists both dated cards');
  const win = ganttWindow(rowWindowSpans(rows), '2026-10-15');
  assert.strictEqual(win.clamped, true, 'the two cards are years apart, so the window is cut to its cap');
  assert.ok(win.days <= GANTT_MAX_DAYS);
  const bars = rows.filter((r) => r.startDay && ganttBarClip(r, win));
  assert.deepStrictEqual(bars, [], 'one card is dated in 2020 and the other in 2031, so the window holds neither bar');
  const drawn = rows.flatMap((r) => [{ id: r.card.id, element: ELEMENTS.ganttLabel }].concat(bars.includes(r) ? [{ id: r.card.id, element: ELEMENTS.ganttBar }] : []));
  assert.deepStrictEqual(readBy(sliceTerm.SELECTORS.gantt, drawn), depthZero.datedShows, 'what the scenario reads off the Gantt is the dated cards in the cut');
});

test('the scenario waits on the page and never on a fixed sleep', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'slice-term.js'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
});

test('the scenario reads no page global, so a rename in the page cannot break it with an eval error', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'slice-term.js'), 'utf8');
  assert.ok(!/Page globals this scenario reads/.test(src));
  assert.ok(!/\b(state|selectedIds|autoRefreshTick|renderGraphView)\b/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
});

test('run against a stand-in page, the scenario writes each query to the box and makes its checks without throwing', async () => {
  const written = [];
  const opened = [];
  const checks = [];
  const inserted = [];
  const clicks = [];
  const page = {
    ev: async (expr) => {
      const m = /i\.value=("(?:[^"\\]|\\.)*")/.exec(expr);
      if (m) written.push(JSON.parse(m[1]));
      return '';
    },
    send: async (method, params) => { if (method === 'Input.insertText') inserted.push(params.text); },
    click: async (x, y) => { clicks.push([x, y]); },
    open: async (url, key) => { opened.push([url, key]); },
    waitFor: async () => true,
    shot: async () => {},
    check: (name, ok) => checks.push([name, ok]),
  };
  await sliceTerm.run(page);
  const { plan, fixture, malformed } = sliceTerm.CASES;
  assert.deepStrictEqual(opened.map(([, key]) => key).filter((k, i, all) => all.indexOf(k) === i), ['plan', 'fixture', 'malformed']);
  assert.ok(opened.some(([url]) => url.startsWith('/?view=map')));
  assert.ok(opened.some(([url]) => url.startsWith('/?view=gantt')));
  assert.ok(opened.some(([url]) => url.startsWith('/?view=calendar')));
  assert.ok(opened.some(([url]) => url.startsWith('/?view=graph')));
  for (const query of [plan.cut.query, plan.depthZero.query, fixture.query, malformed.tier.query, malformed.other.query, malformed.run.query]) {
    assert.ok(written.includes(query), `the scenario writes ${query}`);
  }
  assert.deepStrictEqual(inserted, [plan.suggest.typed, plan.suggest.second.typed], 'the box is typed in with the browser\'s own text input, which is what opens the list');
  assert.strictEqual(clicks.length, 2, 'a row is pressed twice, with the browser\'s own mouse');
  assert.deepStrictEqual(checks.filter(([, ok]) => !ok), [], 'every check passes against a page that answers yes');
  assert.deepStrictEqual(checks.map(([name]) => name), [
    'plan: the Board shows every live card before any cut',
    'plan: slice:goal..objective on the Board shows only the goal, strategy and objective cards',
    'plan: the Map draws cards before any cut',
    'plan: the Map shows the same cards under the cut',
    'plan: slice:0 lists both dated cards on the Gantt',
    'plan: the cut lists none of them on the Gantt',
    'plan: slice:0 draws a dated card on the Calendar',
    'plan: the cut draws none of them on the Calendar',
    'plan: the Graph draws dots before any cut',
    'plan: the Graph draws no dot outside the cut',
    'plan: the Board shows every live card before the box is typed in',
    'plan: typing slice: lists the slices of the board, the tiers in hierarchy order and then the depths',
    'plan: pressing slice:strategy writes it in the box and shuts the list',
    'plan: the Board then keeps only the strategy cards',
    'plan: typing the dots after it lists the slices as the second end of the cut',
    'plan: pressing slice:strategy..objective writes the whole cut in the box',
    'plan: the Board then keeps the strategy and objective cards',
    'fixture: the Board shows every live card before any cut',
    'fixture: slice:1 keeps only the depth-1 cards',
    'malformed: the Board shows every live card before any cut',
    'malformed: slice:goal keeps the card of the tier the board lists as Goal and goal',
    'malformed: slice:EPIC keeps the card of the tier the board lists as Epic and EPIC',
    'malformed: slice:goal..epic keeps the cards of both tiers',
  ]);
});
