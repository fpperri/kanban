const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive, listArchived, toJSON } = require('../scripts/card-store');
const { readConfig } = require('../scripts/config-store');
const { hoverShowIds, hoverShowTiles, hoverShowTerms, hoverShowDefaults } = require('../web/hover-show');
const { searchWithTerms } = require('../web/search');
const { materialize } = require('./browser/boards');
const scenarios = require('./browser/scenarios');
const space = require('./browser/scenarios/hover-space');

// The browser runner's hover-space scenario only runs in a browser (in CI). What Space writes and what the written text
// lights is held here to the sets and the search module over the plan board's own cards, and the scenario is run once
// against a stand-in page so a typo in it, in an expression it sends to the page too, fails here and not only in a
// slow browser run.

const roots = [];
const plan = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-space-'));
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
const kinds = hoverShowDefaults().hierarchy;
const tiles = (b, ks, id) => sorted([...hoverShowTiles(ks, b.all, id, b.ctx)].filter((x) => b.liveIds.has(x)));
const lit = (b, ks, id) => sorted([...hoverShowIds(ks, b.all, id, b.ctx)].filter((x) => b.liveIds.has(x)));
const union = (...lists) => sorted(new Set(lists.flat()));

test('the scenario is in the runner, on the plan board, with time for its page loads', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'hover-space'), space);
  assert.strictEqual(space.board, 'plan');
  assert.ok(space.timeoutMs >= 60000);
});

test('the text each Space writes is what the Hierarchy\'s defaults give, and what Shift+Space and a typed query make of it', () => {
  const { board, graph, flow } = space.CASES;
  assert.strictEqual(hoverShowTerms(kinds, board.first), board.firstText);
  assert.strictEqual(hoverShowTerms(kinds, board.second), board.secondText);
  assert.strictEqual(searchWithTerms(board.firstText, board.secondText, true), board.addedText);
  assert.strictEqual(searchWithTerms('', board.secondText, true), board.secondText, 'an empty box takes it as a plain Space does');
  assert.strictEqual(searchWithTerms(board.addedText, board.secondText, false), board.secondText, 'a plain Space replaces what the box held');
  assert.strictEqual(searchWithTerms(board.typed, hoverShowTerms(kinds, board.first), true), board.typedAdded);
  assert.strictEqual(hoverShowTerms(['hpath'].concat(kinds), board.first), board.tickedText, 'a set ticked in the panel is written in the panel\'s order');
  assert.strictEqual(hoverShowTerms(kinds, graph.dot), graph.text);
  assert.strictEqual(hoverShowTerms(kinds, graph.focused), graph.focusedText);
  assert.strictEqual(hoverShowTerms(hoverShowDefaults().flow, flow.dot), flow.text);
});

test('on the Board the cards each text names are the cards the scenario expects lit, among the cards the Board draws', () => {
  const b = plan();
  const { board } = space.CASES;
  assert.deepStrictEqual(tiles(b, kinds, board.first), board.firstLit);
  assert.deepStrictEqual(tiles(b, kinds, board.second), board.secondLit);
  assert.deepStrictEqual(union(board.firstLit, board.secondLit), board.addedLit);
  for (const id of [board.firstLit, board.secondLit, board.addedLit].flat()) assert.ok(b.liveIds.has(String(id)), `card ${id} is drawn`);
  assert.notDeepStrictEqual(board.firstLit, board.secondLit, 'the two cards light different sets, so a replace is told from an add');
  assert.ok(board.addedLit.length > board.firstLit.length && board.addedLit.length > board.secondLit.length, 'and the union is told from either');
});

test('in the Graph the dot\'s text lights its card and its one-hop relations, and the focused dot is a card the Graph draws', () => {
  const b = plan();
  const { graph } = space.CASES;
  assert.deepStrictEqual(lit(b, kinds, graph.dot), graph.lit);
  assert.ok(b.liveIds.has(String(graph.focused)) && b.liveIds.has(String(graph.dot)));
  assert.ok(!graph.lit.every((id) => id === graph.focused) && graph.lit.includes(graph.focused), 'the focused card is one of the lit, so Ctrl+Space narrows the selection to it alone');
});

test('in the Flow the dot is a card the plan board has, and its text is the Flow\'s own choice, not the Hierarchy\'s', () => {
  const b = plan();
  const { flow, board } = space.CASES;
  assert.ok(b.liveIds.has(String(flow.dot)));
  assert.notStrictEqual(flow.text, hoverShowTerms(kinds, flow.dot));
  assert.strictEqual(flow.dot, board.second);
});

test('the scenario waits on the page and never on a fixed sleep, and presses no position', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'hover-space.js'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
  assert.ok(!/\bmouse\(|\bclick\(/.test(code.replace(/\.click\(\)/g, '')), 'a card is hovered with the events the page listens to, a box and a checkbox pressed with the element\'s own click');
});

function standIn() {
  const log = { checks: [], opened: [], evs: [], keys: [], bad: [], sent: [] };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 120)}`); }
  };
  const page = {
    ev: async (expr) => { log.evs.push(expr); parse(expr); return true; },
    send: async (method, params) => { log.sent.push([method, params]); },
    open: async (url) => { log.opened.push(url); },
    waitFor: async (expr) => { log.evs.push(expr); parse(expr); return true; },
    key: async (name, mods = {}) => { log.keys.push([name, mods]); },
    check: (name, ok) => log.checks.push([name, ok]),
  };
  return { page, log };
}

test('run against a stand-in page, the scenario opens the Board, the Graph and the Flow, presses the keys its checks say, and sends only expressions that parse', async () => {
  const { page, log } = standIn();
  await space.run(page);
  assert.deepStrictEqual(log.bad, []);
  assert.deepStrictEqual(log.opened, ['/?view=board', '/?view=graph', '/?view=graph&graph=flow']);
  assert.ok(log.checks.every(([, ok]) => ok === true), 'every check is made on a boolean the page answers');
  assert.deepStrictEqual(log.keys, [
    [' ', {}], [' ', { shift: true }], [' ', {}], [' ', { shift: true }], [' ', {}], ['a', {}], [' ', {}], [' ', { shift: true }], [' ', {}],
    [' ', {}], [' ', { ctrl: true }], [' ', {}], [' ', {}],
  ]);
  assert.deepStrictEqual(log.sent, [['Input.insertText', { text: space.CASES.board.typed }]]);
});

test('every line of the ticket has a check of its own in the scenario', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'hover-space.js'), 'utf8');
  for (const text of [
    'Space writes the hovered card',
    'and isolate stays off, though typing the same text would turn it on in the Board',
    'Shift+Space on another card adds its terms to what the box holds as more alternatives',
    'Shift+Space on an empty box writes what Space does',
    'with no card hovered or focused Space leaves the box as it was',
    'in the search box Space types a space, and the hovered card writes nothing',
    'and isolate stays on',
    'Ctrl+Space on a focused dot selects its card alone',
    'and Space on it is the write again, with the focused card standing for the hover',
    'in the Flow Space writes its own choice, dlinks alone',
  ]) assert.ok(src.includes(text), text);
});
