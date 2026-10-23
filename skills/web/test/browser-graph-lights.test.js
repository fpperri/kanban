const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listActive, listArchived, toJSON } = require('../scripts/card-store');
const { readConfig } = require('../scripts/config-store');
const { parseSearchQuery, filterCards } = require('../web/search');
const { graphBuild, graphNeighbours, graphQueryEffect } = require('../web/graph-model');
const { materialize } = require('./browser/boards');
const { idMap } = require('./helpers/id-map');
const scenarios = require('./browser/scenarios');
const lights = require('./browser/scenarios/graph-lights');
const graph = require('./browser/scenarios/graph');

// The browser runner's graph-lights scenario, and the Graph scenario's rewritten
// search check, only run in a browser (in CI). What each expects to be lit is held
// here to the search module and the Graph model over the boards' own cards, and the
// scenario is run once against a stand-in page so a typo in it fails here and not
// only in a slow browser run.

const roots = [];
const board = (key) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lights-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const live = listActive(dir).map(toJSON);
  const all = live.concat(listArchived(dir).map(toJSON));
  const ctx = { board: key, hierarchy: readConfig(dir).hierarchy };
  const model = graphBuild(all, { ctx, visibleIds: new Set(live.map((c) => c.id)) });
  return { key, live, all, ctx, model, byId: idMap(all) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const sorted = (list) => [...list].map(Number).sort((a, b) => a - b);
const matches = (b, query) => sorted(filterCards(b.all, parseSearchQuery(query, b.key), b.ctx).map((c) => c.id));
const drawn = (b, ids) => ids.filter((id) => b.model.byId.has(String(id)));
const near = (b, id) => sorted(graphNeighbours(b.model, String(id)));

test('the scenarios are in the runner, the new one on the plan board', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'graph-lights'), lights);
  assert.strictEqual(lights.board, 'plan');
  assert.strictEqual(scenarios.find((s) => s.name === 'graph'), graph);
  assert.ok(lights.timeoutMs >= 60000, 'it makes a dozen drives, each waiting on the page');
});

test('each query the scenario types lights, among the cards the Graph draws, the cards the scenario says it does', () => {
  const b = board('plan');
  for (const [name, { query, lit }] of Object.entries(lights.CASES)) {
    assert.deepStrictEqual(drawn(b, matches(b, query)), lit, `${name}: ${query}`);
  }
});

test('the cut query draws the cards the scenario says and lights the one inside it, by the Graph model\'s own decision', () => {
  const b = board('plan');
  const { query, draws, lit } = lights.CASES.cut;
  const terms = parseSearchQuery(query, b.key);
  const match = { terms, ids: new Set(filterCards(b.all, terms, b.ctx).map((c) => String(c.id))) };
  const effect = graphQueryEffect(match, b.all, b.ctx);
  const live = new Set(b.live.map((c) => String(c.id)));
  assert.deepStrictEqual(sorted([...effect.visibleIds].filter((id) => live.has(id))), draws);
  assert.deepStrictEqual(sorted([...effect.litIds].filter((id) => live.has(id))), lit);
  assert.ok(draws.length < b.live.length, 'the cut hides dots');
  assert.ok(draws.length > lit.length, 'and the dots it keeps are more than the ones that light, so dimming is told from hiding');
  assert.ok(draws.includes(lit[0]));
  assert.deepStrictEqual(matches(b, 'slice:goal..objective'), draws, 'the cut on its own is the same five cards');
});

test('the first query\'s matches include a done card, and the second matches one card that has relations, so lighting it alone is a choice', () => {
  const b = board('plan');
  assert.strictEqual(b.byId.get(lights.CASES.docs.done).status, 'done');
  assert.ok(lights.CASES.docs.lit.includes(lights.CASES.docs.done));
  assert.ok(lights.CASES.docs.lit.length > 1, 'a query that lights two cards separates a selection from a lone card');
  const [one] = lights.CASES.one.lit;
  assert.strictEqual(lights.CASES.one.lit.length, 1);
  assert.deepStrictEqual(near(b, one), sorted([one, ...lights.CASES.one.relations]), 'card 7 has relations, and they must stay dim');
});

test('the cards the scenario clicks for a lone card light with the relations the scenario lists', () => {
  const b = board('plan');
  for (const [id, lit] of Object.entries(lights.LONE)) assert.deepStrictEqual(near(b, Number(id)), lit, `card ${id}`);
  for (const lit of Object.values(lights.LONE)) assert.ok(lit.length > 2, 'a card with relations, so a lone card is told from a query');
  for (const id of Object.keys(lights.LONE)) assert.ok(!lights.CASES.docs.lit.includes(Number(id)), `card ${id} is not one of the docs matches, so clicking it is a new anchor`);
});

test('the checks tell the new behaviour from the old: read the old way, a query would leave fewer dots', () => {
  const b = board('plan');
  for (const { query } of Object.values(lights.CASES)) assert.ok(matches(b, query).length < b.live.length, query);
  const f = board('fixture');
  assert.ok(matches(f, graph.LIGHT.query).length < f.live.length);
});

test('the Graph scenario\'s query lights, on the fixture board, the cards it says, a done one among them, and one match is not drawn', () => {
  const f = board('fixture');
  const all = matches(f, graph.LIGHT.query);
  assert.deepStrictEqual(drawn(f, all), graph.LIGHT.lit);
  assert.ok(graph.LIGHT.lit.includes(graph.LIGHT.done));
  assert.strictEqual(f.byId.get(graph.LIGHT.done).status, 'done');
  assert.ok(graph.LIGHT.lit.some((id) => f.byId.get(id).status !== 'done'), 'a match that is not done as well');
  assert.ok(all.length > graph.LIGHT.lit.length, 'an archived card matches and is not drawn, so it is not lit');
});

test('the scenario waits on the page and never on a fixed sleep', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'graph-lights.js'), 'utf8');
  assert.ok(!/\bsleep\(/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
});

test('the scenario finds dots by their class, never by the shape of the element', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'graph-lights.js'), 'utf8');
  assert.ok(!/circle/.test(src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')));
});

// A stand-in for the page that answers what the scenario reads, as it would in a browser.
function standIn() {
  const log = { checks: [], typed: [], keys: [], shiftClicks: 0, plainClicks: 0, box: '' };
  const planIds = board('plan').live.map((c) => c.id);
  const answer = (expr) => {
    if (/search-clear-btn'\)\.click/.test(expr)) { log.box = ''; return true; }
    if (/getElementById\('search-input'\)\.value$/.test(expr)) return log.box;
    if (/getBoundingClientRect\(\);const x=r\.left/.test(expr)) return { x: 10, y: 10 };
    if (/graph-canvas'\)\.getBoundingClientRect/.test(expr)) return { r: 1500, b: 900 };
    if (/^\[\.\.\.document\.querySelectorAll\('\.graph-node'\)\]\.map\(\(n\)=>Number\(n\.dataset\.id\)\)$/.test(expr)) return planIds;
    if (/querySelectorAll\('\.graph-node'\)\.length$/.test(expr)) return planIds.length;
    if (/graph-node\.selected'\)\.length$/.test(expr)) return 1;
    if (/graph-link\.graph-near'\)\.length$/.test(expr)) return 0;
    if (/document\.querySelectorAll\('#board \.card-el\.selected'\)\.length$/.test(expr)) return 0;
    if (/menu/.test(expr) && /combobox-menu/.test(expr)) return false;
    return true;
  };
  const page = {
    ev: async (expr) => answer(expr),
    send: async (method, params) => { if (method === 'Input.insertText') { log.typed.push(params.text); log.box = params.text; } },
    open: async () => {},
    waitFor: async () => true,
    mouse: async () => {},
    click: async (x, y, extra = {}) => { if (extra.modifiers === 8) log.shiftClicks++; else log.plainClicks++; },
    key: async (name) => { log.keys.push(name); log.box = ''; },
    check: (name, ok) => log.checks.push([name, ok]),
  };
  return { page, log };
}

test('run against a stand-in page, the scenario types each query, clicks and presses Escape as its checks say, and makes them all without throwing', async () => {
  const { page, log } = standIn();
  await lights.run(page);
  const docs = lights.CASES.docs.query;
  assert.deepStrictEqual(log.typed, [docs, lights.CASES.one.query, lights.CASES.cut.query, docs, docs, docs, docs, docs, docs]);
  assert.deepStrictEqual(log.keys, ['Escape', 'Escape'], 'once with focus in the box and once with it outside');
  assert.strictEqual(log.shiftClicks, 3, 'two Shift+clicks build the selection of three, one adds a card to a query');
  assert.deepStrictEqual(log.checks.map(([name]) => name), [
    'the Graph draws the plan board',
    'the empty corner of the Graph is not a card',
    'three cards can be clicked without another dot in the way',
    'a selection of three cards built with Shift+click lights exactly those three and dims the rest',
    'a card with relations can be clicked without another dot in the way',
    'a click on one card lights it and its one-hop relations, and only that card is selected',
    'a query typed in the Graph keeps every dot and lights its matches, a done one included, and dims the rest',
    'clearing the box removes the dimming',
    'a typed query that matches one card lights that card alone, without its relations',
    'a slice: term typed in the Graph hides the dots outside its cut, and the rest of the query lights inside the cut and dims the rest',
    'after a typed query, a plain click on a card shows the card in the box and lights only that card and its relations',
    'after a typed query, Shift+click on an unlit card adds it: the box shows the query and the card, and the matches and the card light',
    'with a typed query as the only part, Esc clears the box and the dimming, with focus in the box',
    'with a typed query as the only part, Esc clears the box and the dimming, with focus outside it',
    'with a typed query lit, a double click on the empty canvas clears the box and the dimming',
    'hovering a dot lights its relations for a moment, and moving off brings back the lit selection',
    'after typing a query in the Graph and switching to the Board, the Board lights the matches with the selected look and hides no card',
    'and nothing is selected, so a bulk action has no cards to act on',
    'back in the Graph with the box unchanged and nothing selected, the matches light again',
  ]);
});

test('every acceptance check of the Graph\'s lighting has a check of its own in the scenario', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'graph-lights.js'), 'utf8');
  const named = [
    'built with Shift+click lights exactly those three and dims the rest',
    'a click on one card lights it and its one-hop relations, and only that card is selected',
    'lights that card alone, without its relations',
    'a slice: term typed in the Graph hides the dots outside its cut',
    'a plain click on a card shows the card in the box and lights only that card and its relations',
    'Shift+click on an unlit card adds it',
    'Esc clears the box and the dimming, with focus ${inBox ?',
    'a double click on the empty canvas clears the box and the dimming',
    'the Board lights the matches with the selected look and hides no card',
    'the matches light again',
    'hovering a dot lights its relations for a moment, and moving off brings back the lit selection',
    'clearing the box removes the dimming',
  ];
  for (const text of named) assert.ok(src.includes(text), text);
});
