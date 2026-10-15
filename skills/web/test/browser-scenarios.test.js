const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const scenarios = require('./browser/scenarios');
const smoke = require('./browser/scenarios/smoke');
const { BOARDS } = require('./browser/boards');
const { runScenarios } = require('./browser/harness');

// What the browser runner runs. The scenarios themselves only run in a browser
// (in CI); these tests pin how they are declared, what the Graph scenario
// carries over from the runner before it had scenarios, and what the smoke
// scenario does, driven through a stand-in page.

const dir = path.join(__dirname, 'browser', 'scenarios');
const source = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
const code = (text) => text.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const byName = (name) => scenarios.find((s) => s.name === name);

// The checks the Graph drive made before it was a scenario. The console-error
// check that closed it is now the harness's, for every scenario.
const GRAPH_CHECKS = [
  'graph renders after deep link ?view=graph', 'default layout is tiers', 'no NaN/Infinity in drawn geometry',
  'every node is card-el with data-id', 'graph container visible and board hidden', 'toggle button reads Board view and is pressed',
  'force layout renders', 'status layout renders', 'status rings run done, doing, todo, backlog from the centre out',
  'archive pill adds archived cards as a second clump', 'hover dims the graph and marks neighbours', 'mouseout clears the focus',
  'background pixel is not a node', 'isDragging is set mid-pan', 'drag pans the world', 'isDragging cleared after the pan',
  'a pan does not clear the selection (phantom click swallowed)', 'wheel zooms in', 'zoom out button zooms out', 'Fit restores the fitted view',
  'clicking a zoom button keeps a multi-selection', 'clicking the active layout keeps the zoomed view',
  'a zoom-button click does not leave focus on a poll-blocking control', 'plain click selects and does NOT open the card',
  'a selected card keeps its relations lit', 'the selection focus survives the pointer leaving', 'double click opens the card (URL gains card=)',
  'clicking empty canvas clears the selection', 'search narrows the graph', 'clearing search restores the graph',
  'isDragging is true during a node drag', 'the dragged card sits under the pointer', 'the svg is marked as dragging',
  'related cards are pulled along with the dragged card', 'unrelated cards move far less than related ones',
  'the drag ended cleanly (isDragging false, no dragging class)', 'a drag does not leave a selection behind (phantom click swallowed)',
  'the dragged arrangement survives the 5s poll', 'in Tiers a card does not drag and the view does not pan from it',
  'the 5s poll keeps the user pan', 'layout choice survives a reload (view.mode + graph.layout)', 'toggle returns to the board',
];

// The checks of the single-key shortcuts' browser drive, which ran after the
// Graph's and now run on their own.
const KEY_GUARD_CHECKS = [
  'with nothing open, / focuses the search box', 'in a text field outside any dialog, / is left to the field',
  'Ctrl+F in a text field outside any dialog still focuses the search box', 'with a dialog open, / leaves focus in the dialog',
  'with a dialog open, Ctrl+F leaves the browser find bar alone', 'Escape closes the dialog', 'a right-click on a card opens its menu',
  'with a card menu open, / does nothing', 'with a card menu open, Ctrl+F leaves the browser find bar alone', 'Escape closes the card menu',
];

// The checks of the search box's browser drive, which ran before the Graph's and
// now run on their own, on the fixture board: each way of writing the box
// changes the box and the cards the Board shows.
const SEARCH_BOX_CHECKS = [
  'the board shows every live card before any search', 'typing writes the box and narrows the columns',
  'the clear button empties the box and brings every card back', 'an assignee cue click writes assignee:@human',
  'the same cue clicked again leaves the box as it was', 'a blocked pill click writes blocked: and keeps the blocked cards',
  'a second cue adds to the box', 'a review pill click writes review: and keeps the cards awaiting review',
  'a right-click on a card opens its menu', 'Path from the menu writes path:4 and keeps that card\\\'s dependency path',
  'and the menu closes', 'a ?q= link writes the box and narrows the columns',
];

test('the runner knows a search-box, a search-grammar, a graph, a key-guard and a smoke scenario, with unique names', () => {
  const names = scenarios.map((s) => s.name);
  assert.deepStrictEqual(names, ['search-box', 'search-grammar', 'graph', 'key-guard', 'smoke']);
  assert.strictEqual(new Set(names).size, names.length);
});

test('every scenario names a known board and has a run function and a sane timeout', () => {
  for (const s of scenarios) {
    assert.ok(BOARDS[s.board], `${s.name}: board ${s.board}`);
    for (const b of s.alsoBoards || []) assert.ok(BOARDS[b], `${s.name}: also board ${b}`);
    assert.strictEqual(typeof s.run, 'function', s.name);
    if (s.timeoutMs !== undefined) assert.ok(s.timeoutMs >= 1000 && s.timeoutMs <= 120000, `${s.name}: timeout ${s.timeoutMs}`);
  }
});

test('the graph scenario runs on today\'s fixture board, the one with no hierarchy', () => {
  assert.strictEqual(byName('graph').board, 'fixture');
  assert.strictEqual(byName('graph').alsoBoards, undefined);
});

test('the graph scenario keeps every check the runner made before it had scenarios', () => {
  const src = source('graph.js');
  const missing = GRAPH_CHECKS.filter((n) => !src.includes(`check('${n}'`));
  assert.deepStrictEqual(missing, []);
  const made = [...src.matchAll(/\bcheck\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(made.filter((n) => !GRAPH_CHECKS.includes(n)), [], 'a check the old runner did not make');
});

test('Graph checks find dots by their class, never by the shape of the element', () => {
  const src = code(source('graph.js'));
  assert.ok(!/circle/.test(src), 'a selector still names a circle');
  assert.ok(src.includes('.graph-dot'));
});

test('no scenario waits on a fixed sleep for a new check: the smoke scenario waits on the page', () => {
  assert.ok(!/\bsleep\(/.test(code(source('smoke.js'))));
});

test('the smoke scenario renders every view on the plan board and on the malformed board', () => {
  assert.strictEqual(smoke.board, 'plan');
  assert.deepStrictEqual(smoke.alsoBoards, ['malformed']);
  assert.deepStrictEqual(smoke.VIEWS.map((v) => v.view), ['board', 'map', 'calendar', 'gantt', 'graph']);
});

function smokePage({ draws = () => true, project = (key) => key } = {}) {
  const opened = [];
  const checks = [];
  let current = null;
  return {
    opened, checks,
    check: (...a) => checks.push(a),
    open: async (p, key) => { opened.push([key, p]); current = key; },
    waitFor: async (expr) => draws(current, expr),
    ev: async (expr) => (/project-name/.test(expr) ? project(current) : 'http://x/'),
  };
}

test('the smoke scenario loads each view cold from its deep link, on each board in turn', async () => {
  const page = smokePage();
  await smoke.run(page);
  assert.deepStrictEqual(page.opened.map(([k, p]) => `${k}${p}`), [
    ...['board', 'map', 'calendar', 'gantt', 'graph'].map((v) => `plan/?view=${v}`),
    ...['board', 'map', 'calendar', 'gantt', 'graph'].map((v) => `malformed/?view=${v}`),
  ]);
  assert.ok(page.checks.every(([, ok]) => ok));
  assert.strictEqual(page.checks.filter(([n]) => /renders$/.test(n)).length, 10);
});

test('the smoke scenario fails a view that draws nothing, naming the board and the view', async () => {
  const page = smokePage({ draws: (key, expr) => !(key === 'malformed' && /gantt-view/.test(expr)) });
  await smoke.run(page);
  const failed = page.checks.filter(([, ok]) => !ok).map(([n]) => n);
  assert.deepStrictEqual(failed, ['malformed: the gantt view renders']);
});

test('the smoke scenario fails when the page is serving some other board', async () => {
  const page = smokePage({ project: () => 'fixture' });
  await smoke.run(page);
  assert.deepStrictEqual(page.checks.filter(([, ok]) => !ok).map(([n]) => n), ['plan: the page is serving the plan board', 'malformed: the page is serving the malformed board']);
});

test('the selectors the smoke scenario waits on name classes the page really draws', () => {
  const web = path.join(__dirname, '..', 'web');
  const pageSource = ['app.js', 'app.html', 'graph-view.js'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  for (const { view, ready } of smoke.VIEWS) {
    for (const m of ready.matchAll(/[ '](?:\.|#)([a-z][\w-]*)/g)) {
      assert.ok(pageSource.includes(m[1]), `${view}: ${m[1]} is not in the page code`);
    }
  }
});

test('a smoke scenario that throws is FAIL under its name while the other scenario still runs', async () => {
  let release;
  const env = {
    gone: new Promise((r) => { release = r; }),
    async begin(sc, ctx) { return { check: ctx.check }; },
    async end() {},
    async consoleErrors() { return []; },
  };
  const broken = { ...smoke, run: async () => { throw new Error('page.open is not a function'); } };
  const fine = { name: 'graph', board: 'fixture', run: async (p) => { p.check('ok', true); } };
  const results = await runScenarios([broken, fine], env, { timeoutMs: 1000, log: () => {} });
  assert.deepStrictEqual(results.map((r) => [r.name, r.status]), [['smoke', 'FAIL'], ['graph', 'PASS']]);
  release('done');
});

test('the key-guard scenario runs on the fixture board and keeps every check the single-key drive made', () => {
  assert.strictEqual(byName('key-guard').board, 'fixture');
  const src = source('key-guard.js');
  assert.deepStrictEqual(KEY_GUARD_CHECKS.filter((n) => !src.includes(`check('${n}'`)), []);
  const made = [...src.matchAll(/\bcheck\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(made.filter((n) => !KEY_GUARD_CHECKS.includes(n)), []);
});

test('the key-guard scenario opens the card menu with the right-click helper', () => {
  assert.ok(/page\.rightClick\('#board \.card-el'\)/.test(source('key-guard.js')));
});

test('the search-box scenario runs on the fixture board and keeps every check the search drive made', () => {
  assert.strictEqual(byName('search-box').board, 'fixture');
  assert.strictEqual(byName('search-box').alsoBoards, undefined);
  const src = source('search-box.js');
  assert.deepStrictEqual(SEARCH_BOX_CHECKS.filter((n) => !src.includes(`check('${n}'`)), []);
  const made = [...src.matchAll(/\bcheck\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(made.filter((n) => !SEARCH_BOX_CHECKS.includes(n)), [], 'a check the old runner did not make');
});

test('the search-box scenario opens the card menu with the right-click helper, from the Board and from a ?q= link', () => {
  const src = code(source('search-box.js'));
  assert.ok(/page\.rightClick\('#board \.card-el\[data-id="4"\]'\)/.test(src));
  assert.ok(!/contextmenu/.test(src), 'a hand-made contextmenu event');
  assert.ok(src.includes(`open('/')`) && src.includes(`open('/?q=status%3Adoing')`));
});

test('the search-box scenario waits on the page, never on a fixed sleep', () => {
  assert.ok(!/\bsleep\(/.test(code(source('search-box.js'))));
});
