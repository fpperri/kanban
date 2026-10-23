const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listActive, listArchived, toJSON } = require('../scripts/card-store');
const { readConfig } = require('../scripts/config-store');
const { hoverShowIds, hoverShowTiles, hoverShowDefaults, hoverShowTerms, HOVER_SHOW_KINDS, HOVER_SHOW_GRID } = require('../web/hover-show');
const { graphBuild, graphNeighbours } = require('../web/graph-model');
const { materialize } = require('./browser/boards');
const scenarios = require('./browser/scenarios');
const hover = require('./browser/scenarios/hover-show');
const lights = require('./browser/scenarios/graph-lights');

// The browser runner's hover-show scenario only runs in a browser (in CI). What each choice of sets lights is held
// here to the sets over the plan board's own cards, and the scenario is run once against a stand-in page so a typo
// in it fails here and not only in a slow browser run.

const roots = [];
const plan = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-hover-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('plan', dir);
  const live = listActive(dir).map(toJSON);
  const all = live.concat(listArchived(dir).map(toJSON));
  const ctx = { board: 'plan', hierarchy: readConfig(dir).hierarchy };
  return { live, all, ctx, liveIds: new Set(live.map((c) => String(c.id))) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const sorted = (ids) => [...ids].map(Number).sort((a, b) => a - b);
const lit = (b, kinds, id) => sorted([...hoverShowIds(kinds, b.all, id, b.ctx)].filter((x) => b.liveIds.has(x)));
const tiles = (b, kinds, id) => sorted([...hoverShowTiles(kinds, b.all, id, b.ctx)].filter((x) => b.liveIds.has(x)));

test('the scenario is in the runner, on the plan board, and its sets are the six in the panel\'s order with the two defaults', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'hover-show'), hover);
  assert.strictEqual(hover.board, 'plan');
  assert.ok(hover.timeoutMs >= 60000, 'it opens the page a dozen times, each waiting on the page');
  assert.deepStrictEqual(hover.CASES.kinds, HOVER_SHOW_KINDS);
  assert.deepStrictEqual(hover.CASES.grid, HOVER_SHOW_GRID, 'the grid the scenario expects in both places');
  assert.deepStrictEqual(hover.CASES.hierarchy, hoverShowDefaults().hierarchy);
  assert.deepStrictEqual(hover.CASES.flow.kinds, hoverShowDefaults().flow);
});

test('on the Board, each choice of the Hierarchy lights the cards the scenario says, among the cards the Board draws', () => {
  const b = plan();
  const { card, defaults, plusHpath, hpathAlone, none, hlinksAlone } = hover.CASES.board;
  assert.deepStrictEqual(tiles(b, hover.CASES.hierarchy, card), defaults);
  assert.deepStrictEqual(tiles(b, plusHpath.kinds, card), plusHpath.lit);
  assert.deepStrictEqual(tiles(b, hpathAlone.kinds, card), hpathAlone.lit);
  assert.deepStrictEqual(tiles(b, [], card), none);
  assert.deepStrictEqual(tiles(b, hlinksAlone.kinds, card), hlinksAlone.lit);
});

test('the choices the Board steps through light different cards, so each tick or untick changes what the checks read', () => {
  const { defaults, plusHpath, hpathAlone, none, hlinksAlone } = hover.CASES.board;
  const lists = [defaults, plusHpath.lit, hpathAlone.lit, none, hlinksAlone.lit].map((l) => JSON.stringify(l));
  assert.strictEqual(new Set(lists).size, lists.length);
  assert.ok(hlinksAlone.lit.length < defaults.length, 'the last choice is told from the first');
});

test('the Board draws every card the scenario expects lit: a live card, not an archived one', () => {
  const b = plan();
  const { board } = hover.CASES;
  for (const id of [board.defaults, board.plusHpath.lit, board.hpathAlone.lit, board.hlinksAlone.lit].flat()) assert.ok(b.liveIds.has(String(id)), `card ${id}`);
  const archivedNear = [...hoverShowIds(HOVER_SHOW_KINDS, b.all, 2, b.ctx)].filter((x) => !b.liveIds.has(x));
  assert.ok(archivedNear.length > 0, 'card 2 has an archived card in its sets, which the Graph does not draw and its lit list leaves out');
});

test('in the Hierarchy with nothing chosen, the Graph lights card 2 with its one-hop relations, as the Graph model\'s own neighbours and the lights scenario say', () => {
  const b = plan();
  const { card, defaults } = hover.CASES.graph;
  assert.deepStrictEqual(lit(b, hoverShowDefaults().hierarchy, card), defaults);
  const model = graphBuild(b.all, { ctx: b.ctx, visibleIds: b.liveIds });
  assert.deepStrictEqual(sorted(graphNeighbours(model, String(card))), defaults, 'what it lit before the choice existed');
  assert.deepStrictEqual(lights.LONE[card], defaults, 'and what the lights scenario expects of a lone card');
});

test('in the Flow, card 3 lights the dependencies alone; ticking hlinks adds the parent; the Hierarchy\'s own hlinks lights the parent and the card', () => {
  const b = plan();
  const { card, defaults, plusHlinks, hierarchy, kinds } = hover.CASES.flow;
  assert.deepStrictEqual(lit(b, kinds, card), defaults);
  const model = graphBuild(b.all, { ctx: b.ctx, visibleIds: b.liveIds });
  assert.deepStrictEqual(sorted(graphNeighbours(model, String(card), 'wait')), defaults, 'what the Flow lit before the choice existed');
  assert.deepStrictEqual(lit(b, plusHlinks.kinds, card), plusHlinks.lit);
  assert.ok(plusHlinks.lit.includes(1), 'card 1 is the parent, which the dependencies do not reach');
  assert.deepStrictEqual(lit(b, hover.CASES.board.hlinksAlone.kinds, card), hierarchy);
});

test('in the Graph\'s side panel, the choice kept before is the Board\'s last, three presses make the union the scenario lights, and Space writes its terms in the panel\'s order', () => {
  const b = plan();
  const { card, before, press, after, text } = hover.CASES.sidebar;
  assert.deepStrictEqual(before.kinds, hover.CASES.board.hlinksAlone.kinds, 'what the steps before leave kept for the Hierarchy');
  assert.deepStrictEqual(lit(b, before.kinds, card), before.lit);
  assert.deepStrictEqual(lit(b, after.kinds, card), after.lit);
  assert.deepStrictEqual(after.kinds, HOVER_SHOW_KINDS.filter((k) => after.kinds.includes(k)), 'the toggles list them in the panel\'s order');
  assert.deepStrictEqual([...press].sort(), [...new Set([...before.kinds, ...after.kinds])].sort(), 'the presses untick the one and tick the two');
  assert.notDeepStrictEqual(after.lit, lit(b, ['hpath'], card), 'dtree adds cards hpath alone does not light');
  assert.notDeepStrictEqual(after.lit, before.lit);
  assert.strictEqual(text, hoverShowTerms(after.kinds, card));
  assert.strictEqual(text, 'dtree:7 | hpath:7');
  for (const id of after.lit) assert.ok(b.liveIds.has(String(id)), `card ${id} is drawn`);
});

test('the scenario waits on the page and never on a fixed sleep, and presses nothing by position', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'hover-show.js'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/\bmouse\(|\bclick\(/.test(code.replace(/\.click\(\)/g, '')), 'a checkbox is pressed with the element\'s own click, a card hovered with the events the page listens to');
});

function standIn() {
  const log = { checks: [], opened: [], evs: [] };
  const page = {
    ev: async (expr) => { log.evs.push(expr); return true; },
    open: async (url) => { log.opened.push(url); },
    waitFor: async () => true,
    key: async () => { log.keys = (log.keys || []).concat('key'); },
    check: (name, ok) => log.checks.push([name, ok]),
  };
  return { page, log };
}

test('run against a stand-in page, the scenario opens the Graph, the Board and the Flow, ticks and hovers as its checks say, and makes them all without throwing', async () => {
  const { page, log } = standIn();
  await hover.run(page);
  assert.deepStrictEqual(log.opened, [
    '/?view=graph', '/?view=board', '/?view=board', '/?view=graph&graph=flow', '/?view=graph&graph=hierarchy', '/?view=graph&graph=flow', '/?view=board',
    '/?view=graph&graph=hierarchy', '/?view=graph&graph=flow',
  ]);
  assert.ok(log.checks.every(([, ok]) => ok === true), 'every check is made on a boolean the page answers');
  assert.deepStrictEqual(log.checks.map(([name]) => name), [
    'the Graph draws the plan board',
    'in the Hierarchy, with nothing chosen, hovering a dot lights it and its one-hop relations and dims the rest',
    'and the hover ring stays on the hovered dot alone',
    'moving off clears the dimming',
    'the Board draws the plan board',
    'the panel opens with the box focused',
    'the panel has the six sets, dlinks and hlinks ticked, and says the choice is the Hierarchy\'s and the other views\'',
    'the six boxes stand in two columns by three rows, the h sets left and the d sets right, links then path then tree',
    'on the Board, with nothing chosen, hovering a card gives it and its one-hop relations the hover look',
    'leaving the card clears the hover look',
    'ticking another set while a card is hovered lights the union of the three at once',
    'unticking the other two leaves the set that is still ticked',
    'with nothing ticked the hovered card still takes the hover look, and no other',
    'one set ticked alone lights just that set',
    'keyboard focus on a card lights the same set',
    'and leaving it clears the set',
    'the Board draws the plan board again after a reload',
    'the choice is still there after a reload',
    'and it lights what it did',
    'the Flow draws the plan board',
    'the Flow has its own choice, dlinks alone, whatever the Hierarchy ticks, and the panel says so',
    'in the Flow, hovering a dot lights it and the cards its dependencies join to it, and not its parent',
    'ticking hlinks in the Flow lights the parent as well, with the dot still hovered',
    'the Hierarchy draws again',
    'the Hierarchy still holds its own choice, and the panel says so',
    'and its hover lights the parent and the card, not the dependencies',
    'the Flow draws once more after a reload',
    'the Flow keeps the choice made there',
    'the Board draws after the Graph last showed the Flow',
    'and still reads the Hierarchy\'s choice, not the Flow\'s',
    'the Hierarchy draws the plan board',
    'its side panel has the six sets under On hover, and shows the choice kept for the Hierarchy',
    'the side panel toggles stand in the same grid: two columns by three rows, the h sets left and the d sets right',
    'with the dot hovered the choice lights what it did',
    'three presses in the side panel make the choice dtree and hpath, and light their union with the dot still hovered, no reload and no new hover',
    'the search panel shows the same two sets ticked',
    'a new hover lights the union',
    'Space writes the ticked terms in the panel\'s order',
    'the Flow draws the plan board once more',
    'its side panel shows the Flow\'s own choice',
  ]);
  const ticks = log.evs.filter((e) => /data-hover-kind="[a-z]+"\]'\)\.click\(\)/.test(e)).map((e) => /data-hover-kind="([a-z]+)"/.exec(e)[1]);
  assert.deepStrictEqual(ticks, ['hpath', 'dlinks', 'hlinks', 'hpath', 'hlinks', 'hlinks']);
  const sidePresses = log.evs.filter((e) => /data-key="hover"/.test(e) && /\.click\(\)/.test(e)).map((e) => /dataset\.val==='([a-z]+)'/.exec(e)[1]);
  assert.deepStrictEqual(sidePresses, hover.CASES.sidebar.press, 'the side panel toggles are pressed with the element own click');
  assert.strictEqual(log.keys.length, 1, 'one real key press: Space');
});

test('every acceptance line of the ticket has a check of its own in the scenario', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'hover-show.js'), 'utf8');
  for (const text of [
    'the Flow has its own choice, dlinks alone',
    'hovering a card gives it and its one-hop relations the hover look',
    'hovering a dot lights it and its one-hop relations and dims the rest',
    'the hover ring stays on the hovered dot alone',
    'the choice is still there after a reload',
    'and still reads the Hierarchy\\\'s choice, not the Flow\\\'s',
    'leaving the card clears the hover look',
  ]) assert.ok(src.includes(text), text);
});
