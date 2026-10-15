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

test('the runner knows a search-box, a search-address, a search-grammar, a graph, a key-guard, a card-click, a selection, an esc-steps, a config-keys, a type-icons, a smoke and a calendar-jump scenario, with unique names', () => {
  const names = scenarios.map((s) => s.name);
  assert.deepStrictEqual(names, ['search-box', 'search-address', 'search-grammar', 'graph', 'key-guard', 'card-click', 'selection', 'esc-steps', 'config-keys', 'type-icons', 'smoke', 'calendar-jump']);
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

// What the address-follows-the-box drive checks: typing, the history, clearing,
// a reload, a compound query, a link that carries a view, and card history with
// a query in the box.
const SEARCH_ADDRESS_CHECKS = [
  'typing zephyr puts it in the address as q and keeps view', 'the browser history does not grow while typing',
  'and the board shows the matches', 'after a reload the box holds zephyr and the board shows only its matches',
  'clearing the box drops q from the address and keeps view',
  'a box holding #12 | (tags:"next-up" status:doing) comes back unchanged after a reload',
  'one more keystroke makes q equal the box and keeps view',
  'opening a card with a query in the box adds one history step carrying card and q',
  'going Back closes the card and the box keeps the query', 'going Forward reopens it and the box keeps the query',
  'Back reopens the card, the box keeps the new query, and q in the address equals the box',
];

test('the search-address scenario runs on the fixture board and makes every check the address-follows-the-box drive owes', () => {
  assert.strictEqual(byName('search-address').board, 'fixture');
  assert.strictEqual(byName('search-address').alsoBoards, undefined);
  const src = source('search-address.js');
  assert.deepStrictEqual(SEARCH_ADDRESS_CHECKS.filter((n) => !src.includes(`check('${n}'`)), []);
});

test('the search-address scenario steps through history with history.back and history.forward and waits on the page, never on a fixed sleep', () => {
  const src = code(source('search-address.js'));
  assert.ok(src.includes('history.back()') && src.includes('history.forward()'));
  assert.ok(!/\bsleep\(/.test(src));
});

// Page.reload answers as soon as the reload starts and the old document stays
// alive until the new one commits, so a wait taken right after it can be
// answered by the page being left. The scenario marks the old document first and
// waits for the mark to be gone, and no reload goes around that.
test('the search-address scenario reloads only through a helper that waits for the old document to be gone', () => {
  const src = code(source('search-address.js'));
  assert.strictEqual(src.split("send('Page.reload')").length - 1, 1, 'one raw reload, inside the helper');
  assert.ok(/window\.__beforeReload = true[\s\S]*send\('Page\.reload'\)[\s\S]*window\.__beforeReload === undefined/.test(src), 'the helper marks the page, reloads, then waits for the mark to be gone');
  assert.strictEqual(src.split('await reload();').length - 1, 2, 'both reload checks go through the helper');
});

// The click grammar's browser drive, on the fixture board: what a click on a
// card does in each view, and what the bulk confirmations say.
const CARD_CLICK_CHECKS = [
  'card 3 is dated today for the Calendar and Gantt clicks',
  'a plain click opens the card in the ${view}',
  'Ctrl+click toggles one card in', 'Ctrl+click on a selected card toggles it out', 'Cmd+click toggles one card in',
  'Shift+click adds the range from the last toggled card', 'none of those clicks opened a card',
  'a right-click on a card outside the selection replaces the selection', 'Escape closes that menu and keeps the selection',
  'a click on empty space clears the selection', 'two cards are selected for the bulk confirmations',
  'the archive confirmation names the count', 'the delete confirmation names the count',
  'in the Graph, Enter on a focused card opens it',
];

test('the card-click scenario runs on the fixture board and makes every check of the click grammar', () => {
  assert.strictEqual(byName('card-click').board, 'fixture');
  assert.strictEqual(byName('card-click').alsoBoards, undefined);
  const src = source('card-click.js');
  const named = (n) => src.includes(`check('${n}'`) || src.includes(`check(\`${n}\``);
  const missing = CARD_CLICK_CHECKS.filter((n) => !named(n));
  assert.deepStrictEqual(missing, [], 'checks the click grammar needs and the scenario does not make');
});

test('the card-click scenario clicks the Board, the Map, the Calendar and the Gantt, and presses Enter in the Graph', () => {
  const src = code(source('card-click.js'));
  for (const view of ['board', 'map', 'calendar', 'gantt']) assert.ok(src.includes(`['${view}', `), `${view} is clicked`);
  assert.ok(/showView\('graph'/.test(src) && /key\('Enter'\)/.test(src));
});

test('the card-click scenario holds both clicks of a range, a Cmd click and a Ctrl click, and answers the confirmations with no', () => {
  const src = code(source('card-click.js'));
  assert.ok(src.includes('modifiers: 2') && src.includes('modifiers: 4') && src.includes('modifiers: 8'), 'Ctrl, Cmd and Shift');
  assert.ok(/window\.confirm=\(m\)=>\{window\.__asked\.push\(m\);return false\}/.test(src), 'a confirmation that refuses, so nothing is archived or deleted');
});

test('the card-click scenario opens the card menu with the right-click helper and waits on the page, never on a fixed sleep', () => {
  const src = code(source('card-click.js'));
  assert.ok(/page\.rightClick|rightClick\(cardIn/.test(src));
  assert.ok(!/contextmenu/.test(src), 'a hand-made contextmenu event');
  assert.ok(!/\bsleep\(/.test(src));
});

// The selection's browser drive, on the plan board: how a selection grows from an
// anchor in the Graph, and that the Board shows the same cards after a view
// switch and a poll.
const SELECTION_CHECKS = [
  'the Graph draws the plan board', 'three cards can be clicked without another dot in the way',
  'a click on a card selects that card alone and makes it the anchor', 'Shift+click on a second card adds exactly that card',
  'the first card picked is the anchor and the second is an addition', 'Shift+click on the added card takes it out and leaves the anchor',
  'Ctrl+click does the same as Shift+click: it adds one card and takes it out',
  'a click on another card starts a new selection holding that card alone', 'the empty corner of the Graph is not a card',
  'a pan keeps the selection', 'a click on the empty Graph clears the selection', 'the Board shows after the view switch',
  'two cards picked in the Graph with Shift show as selected on the Board after a view switch', 'the poll repainted the Board',
  'and the two cards are still selected after the poll', 'none of those clicks opened a card',
];

test('the selection scenario runs on the plan board and makes every check of how a selection grows in the Graph', () => {
  assert.strictEqual(byName('selection').board, 'plan');
  assert.strictEqual(byName('selection').alsoBoards, undefined);
  const src = source('selection.js');
  assert.deepStrictEqual(SELECTION_CHECKS.filter((n) => !src.includes(`check('${n}'`)), []);
  const made = [...src.matchAll(/\bcheck\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(made.filter((n) => !SELECTION_CHECKS.includes(n)), [], 'a check this list does not name');
});

test('the selection scenario holds Shift and Ctrl on a click, and waits on the page, never on a fixed sleep', () => {
  const src = code(source('selection.js'));
  assert.ok(src.includes('modifiers: 8') && src.includes('modifiers: 2'), 'Shift and Ctrl');
  assert.ok(!/\bsleep\(/.test(src));
});

test('the selection scenario finds a card\'s dot by its class and clicks it only where it is the topmost thing', () => {
  const src = code(source('selection.js'));
  assert.ok(src.includes('.graph-dot') && !/circle/.test(src));
  assert.ok(/elementFromPoint/.test(src));
});

// Esc steps the selection back one stage at a time, on the plan board: in the
// Graph after a click and two Shift+clicks, on the Board after three Ctrl+clicks,
// and with text in the search box, where focus in the box opens its suggestion
// menu, the first Esc closes that menu, the next clears the box, and Esc away
// from the box steps the selection.
const ESC_STEPS_CHECKS = [
  'the Graph draws the plan board', 'three cards can be clicked without another dot in the way',
  'a click and two Shift+clicks select three cards, the clicked card the anchor',
  'the first Esc in the Graph leaves only the anchor selected', 'the second Esc in the Graph clears the selection',
  'the Board draws the plan board', 'Ctrl+clicks on three cards select them, the first the anchor',
  'the first Esc on the Board leaves the first card selected', 'the second Esc on the Board clears the selection',
  'a search narrows the Board and three of its cards are selected', 'focus in the box holding text opens its suggestion menu',
  'the first Esc in the search box closes the suggestion menu and keeps the selection',
  'the next Esc in the search box clears the box and keeps the selection',
  'the box has text again and focus has left it',
  'Esc with focus outside the search box steps the selection back and leaves the box text as it was',
  'none of those clicks opened a card',
];

test('the esc-steps scenario runs on the plan board and makes every check of the Esc steps', () => {
  assert.strictEqual(byName('esc-steps').board, 'plan');
  assert.strictEqual(byName('esc-steps').alsoBoards, undefined);
  const src = source('esc-steps.js');
  assert.deepStrictEqual(ESC_STEPS_CHECKS.filter((n) => !src.includes(`check('${n}'`)), []);
  const made = [...src.matchAll(/\bcheck\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(made.filter((n) => !ESC_STEPS_CHECKS.includes(n)), [], 'a check this list does not name');
});

test('the esc-steps scenario presses Escape through the runner\'s key helper, holds Shift and Ctrl on a click, and waits on the page, never on a fixed sleep', () => {
  const src = code(source('esc-steps.js'));
  assert.ok(src.includes("key('Escape')"), 'a real key press, not a synthetic event');
  assert.ok(src.includes('modifiers: 8') && src.includes('modifiers: 2'), 'Shift and Ctrl');
  assert.ok(!/\bsleep\(/.test(src));
  assert.ok(!/dispatchEvent|new KeyboardEvent/.test(src), 'no hand-made key event');
});

test('the esc-steps scenario checks the box both ways: Esc with focus in the box, and Esc with focus outside it', () => {
  const src = code(source('esc-steps.js'));
  assert.ok(/i\.focus\(\)/.test(src), 'focus goes into the box');
  assert.ok(/activeElement\.blur\(\)/.test(src), 'and out of it');
});

test('the esc-steps scenario lets the suggestion menu take the first Esc in the box, then clears the box with the next', () => {
  const src = code(source('esc-steps.js'));
  assert.ok(/setSelectionRange\(i\.value\.length,i\.value\.length\)/.test(src), 'the caret goes after the text before focus, so the menu opens every time');
  assert.ok(src.includes('#search-input ~ .combobox-menu'), 'the menu is the one beside the box');
  const at = (text) => src.indexOf(text);
  const opened = at("check('focus in the box holding text opens its suggestion menu'");
  const closed = at("check('the first Esc in the search box closes the suggestion menu and keeps the selection'");
  const cleared = at("check('the next Esc in the search box clears the box and keeps the selection'");
  assert.ok(opened > 0 && opened < closed && closed < cleared, 'open, then the first Esc closes it, then the next clears the box');
  const word = /insertText', \{ text: '([^']+)'/.exec(src)[1];
  assert.ok(require('../web/search.js').searchSuggestionItems(word, word.length).length > 0, 'a caret after the typed word is where the box offers suggestions, so the menu is open on focus');
  const presses = (from, to) => src.slice(from, to).split('escape()').length - 1;
  assert.strictEqual(presses(opened, closed), 1, 'one Esc between the menu opening and its closing');
  assert.strictEqual(presses(closed, cleared), 1, 'one more Esc before the box is checked clear');
});
