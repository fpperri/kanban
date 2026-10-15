const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive, listArchived } = require('../scripts/card-store');
const { materialize } = require('./browser/boards');
const { parseSearchQuery, filterCards } = require('../web/search');
const { pillList } = require('../web/pills');
const scenarios = require('./browser/scenarios');
const panel = require('./browser/scenarios/search-panel');

// The browser runner's search-panel scenario only runs in a browser (in CI). What
// it expects of the plan board is held here to the search module and the pill list
// over the board's own cards, the in-page expressions it sends are all parsed, and
// the scenario is run once against a stand-in page so a typo in it fails here and
// not only in a slow browser run.

const roots = [];
const planBoard = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-search-panel-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('plan', dir);
  const live = listActive(dir);
  return { live, all: live.concat(listArchived(dir)), byId: new Map(live.map((c) => [c.id, c])) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const sorted = (list) => [...list].sort((a, b) => a - b);
const idsOf = (b, query) => sorted(filterCards(b.all, parseSearchQuery(query, 'plan'), { board: 'plan' }).map((c) => c.id).filter((id) => b.byId.has(id)));
const countsOver = (cards, all) => Object.fromEntries(pillList(cards, (q) => new Set(filterCards(all, parseSearchQuery(q, 'plan'), { board: 'plan' }).map((c) => c.id))).map((p) => [p.key, p.count]));
const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'search-panel.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('the scenario is in the runner, on the plan board, with time for its drives', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'search-panel'), panel);
  assert.strictEqual(panel.board, 'plan');
  assert.strictEqual(panel.alsoBoards, undefined);
  assert.ok(panel.timeoutMs >= 60000);
});

test('before the scenario gives a done card a sticker, the pills match the cards it says', () => {
  const b = planBoard();
  for (const [name, ids] of Object.entries(panel.CASES.before)) assert.deepStrictEqual(idsOf(b, `${name}:`), ids, name);
  const done = b.byId.get(panel.CASES.stickered);
  assert.strictEqual(done.status, 'done', 'the card it stickers is done');
  assert.ok(!done.review && !done.blocked && done.waiting_for.length === 0, 'and carries nothing yet');
});

test('with the sticker on the done card, each pill counts what the scenario says, and the cards of review and of both pills are the sets it says', () => {
  const b = planBoard();
  const after = b.all.map((c) => (c.id === panel.CASES.stickered ? { ...c, review: 'look once more' } : c));
  const live = after.filter((c) => !c.archived);
  assert.deepStrictEqual(countsOver(live, after), panel.CASES.counts);
  const ids = (q) => sorted(filterCards(after, parseSearchQuery(q, 'plan'), { board: 'plan' }).map((c) => c.id).filter((id) => live.some((c) => c.id === id)));
  assert.deepStrictEqual(ids('review:'), panel.CASES.review);
  assert.deepStrictEqual(ids('review: | blocked:'), panel.CASES.both);
  assert.deepStrictEqual(ids('waiting:'), panel.CASES.waiting);
  assert.deepStrictEqual(ids('blocked:'), panel.CASES.blocked);
  assert.deepStrictEqual(ids('waiting: | review:'), panel.CASES.waitingReview);
});

test('a second card, blocked through the API, and the Done status pill off, move the counts the way the scenario says', () => {
  const b = planBoard();
  const lone = b.byId.get(panel.CASES.lonePatched);
  assert.ok(lone && lone.status !== 'done' && lone.status !== 'doing' && !lone.blocked, 'a card that can be blocked, and is not done');
  const patched = b.all.map((c) => {
    if (c.id === panel.CASES.stickered) return { ...c, review: 'look once more' };
    if (c.id === panel.CASES.lonePatched) return { ...c, blocked: 'waiting on the vendor' };
    return c;
  });
  const live = patched.filter((c) => !c.archived);
  assert.deepStrictEqual(countsOver(live, patched), panel.CASES.patchedCounts);
  assert.deepStrictEqual(countsOver(live.filter((c) => c.status !== 'done'), patched), panel.CASES.doneOffCounts);
  assert.ok(panel.CASES.doneOffCounts.review < panel.CASES.patchedCounts.review, 'a done card was among the review cards');
});

test('the pills follow the status pills: a click and a Shift+click both toggle, a right-click solos, and each is driven on its own', () => {
  const at = (name) => code.indexOf(`check('${name}'`);
  const names = [
    'a click on blocked turns it on beside review: the box holds both and both pills are on',
    'Shift+click on blocked does what a click does: it turns blocked off and leaves review on',
    'a right-click on blocked solos it: the box holds blocked: alone and the other pills are off',
    'a right-click on the soloed pill turns every pill off and empties the box',
  ];
  for (const name of names) assert.ok(at(name) > 0, name);
  assert.ok(names.every((n, i) => !i || at(n) > at(names[i - 1])), 'in the order they are driven');
  const solo = code.slice(at(names[2]) - 400, at(names[3]));
  assert.strictEqual(solo.split("rightClick(pillSel('blocked'))").length - 1, 2, 'one right-click to solo, one on the soloed pill');
  assert.ok(/clickOn\(pillSel\('blocked'\)\);/.test(code), 'a plain click on a pill');
  assert.ok(/clickOn\(pillSel\('blocked'\), \{ modifiers: 8 \}\)/.test(code), 'a Shift+click on a pill');
});

test('the scenario does not wait on a fixed sleep, and presses its keys and its Shift and Ctrl clicks through the runner\'s own helpers', () => {
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
  assert.ok(/key\('Escape'\)/.test(code) && /key\('Tab'\)/.test(code) && /key\('Enter'\)/.test(code) && /key\(' '\)/.test(code));
  assert.ok(/modifiers: 8/.test(code), 'Shift');
  assert.ok(/modifiers: 2/.test(code), 'Ctrl');
  assert.ok(/rightClick\(pillSel\('review'\)\)/.test(code), 'a right-click on a pill');
});

test('the bulk popup\'s value box opens an assignee suggestion list on focus, so the scenario sends one Esc for the list and the next for the popup', () => {
  const web = path.join(__dirname, '..', 'web');
  const html = fs.readFileSync(path.join(web, 'app.html'), 'utf8');
  const app = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
  assert.ok(/<label>[^<]*<input id="bulk-single-input"><\/label>/.test(html), 'the combobox menu is appended after the input, inside its label');
  assert.ok(app.includes("attachCombobox($('#bulk-single-input')"), 'the value box is a combobox');
  assert.ok(/function openBulkSingle[\s\S]*?\$\('#bulk-single-input'\)\.focus\(\)/.test(app), 'the popup focuses it as it opens, which opens the list');
  const from = code.indexOf("check('the bulk popup counts the selected cards'");
  const to = code.indexOf("check('a click on review again clears the box'");
  const step = code.slice(from, to);
  assert.ok(from > 0 && to > from, 'the bulk popup step is found');
  assert.ok(code.includes('#bulk-single-input ~ .combobox-menu'), 'the list is the combobox menu after the value box');
  assert.strictEqual(step.split("key('Escape')").length - 1, 2, 'one Esc for the list, one for the popup');
  const [firstEsc, secondEsc] = [step.indexOf("key('Escape')"), step.lastIndexOf("key('Escape')")];
  const listOpen = step.indexOf('BULK_LIST_OPEN');
  assert.ok(listOpen > -1 && listOpen < firstEsc, 'the list is seen open before the first Esc');
  const afterFirst = step.slice(firstEsc, secondEsc);
  assert.ok(afterFirst.includes('!(${BULK_LIST_OPEN})') && afterFirst.includes('BULK_POPUP_OPEN') && afterFirst.includes('panelOpen'), 'after the first Esc the list is shut, the popup and the panel are open');
  const afterSecond = step.slice(secondEsc);
  assert.ok(afterSecond.includes('!(${BULK_POPUP_OPEN})') && afterSecond.includes('panelOpen'), 'after the second Esc the popup is shut and the panel is still open');
});

test('the Esc chain is three presses, each asserted on its own: the box keeps its text after the list step and after the panel step, and no loop of presses stands in for them', () => {
  const from = code.indexOf("check('focus in the box holding text opens its suggestion list");
  const third = code.indexOf("check('the third Esc, with focus in the box, clears it'");
  const to = code.indexOf('await openPanel();', third);
  const span = code.slice(from, to);
  assert.ok(from > 0 && third > from && to > third, 'the Esc chain is found');
  assert.strictEqual(span.split("key('Escape')").length - 1, 3, 'one Esc for the list, one for the panel, one for the box');
  assert.ok(!/\bfor\s*\(|\bwhile\s*\(/.test(span), 'no loop of presses');
  const presses = [...span.matchAll(/key\('Escape'\)/g)].map((m) => m.index);
  const afterList = span.slice(presses[0], presses[1]);
  assert.ok(/MENU_OPEN/.test(afterList) && /boxText\(\)\) === 'zephyr'/.test(afterList) && /panelOpen/.test(afterList), 'after the first Esc: the list is shut, the panel open, the text still there');
  const afterPanel = span.slice(presses[1], presses[2]);
  assert.ok(/panelShut/.test(afterPanel) && /boxText\(\)\) === 'zephyr'/.test(afterPanel), 'after the second Esc: the panel is shut and the text still there');
  assert.ok(/activeElement===document\.getElementById\('search-input'\)/.test(afterPanel), 'and focus is still in the box');
  assert.ok(!/TOGGLE/.test(afterPanel), 'focus is not on the toggle');
  assert.ok(/boxIs\(''\)/.test(span.slice(presses[2])), 'after the third Esc the box is empty');
});

test('Esc with focus on a pill closes the panel and puts focus back on the toggle, where Esc from the box leaves focus in the box', () => {
  const at = code.indexOf("check('Esc with focus on a pill closes the panel and puts focus back on the toggle'");
  assert.ok(at > 0, 'the check is made');
  const before = code.slice(code.lastIndexOf('await openPanel();', at), at);
  assert.ok(/pillSel\('review'\)[^\n]*\.focus\(\)/.test(before) && before.includes("key('Escape')"), 'focus goes on a pill, then Esc');
  assert.ok(/waitFor\(panelShut\)/.test(code.slice(at, at + 300)) && /activeElement===\$\{TOGGLE\}/.test(code.slice(at, at + 300)), 'the panel is shut and focus is on the toggle');
});

test('the ids and classes the scenario drives are in the page the panel is drawn on', () => {
  const web = path.join(__dirname, '..', 'web');
  const page = ['app.html', 'search-panel.js', 'app.css'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  for (const name of ['search-panel', 'search-panel-toggle', 'search-pills', 'search-pills-fold', 'search-chip', 'search-clear-btn', 'prefs-pills-folded', 'prefs-panel-on-focus', 'query-pill', 'query-pill-count']) {
    assert.ok(page.includes(name), `${name} is in the page`);
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in
// one fails here, and what it reads back is answered the way a browser would for the
// scenario's own reads. Whether each check holds is for the browser to say.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], keys: [], clicks: 0 };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 120)}`); }
  };
  const planIds = planBoard().live.map((c) => c.id);
  const answer = (expr) => {
    if (/^\[\.\.\.new Set\(\[\.\.\.document\.querySelectorAll\('#board \.card-el'\)\]/.test(expr)) return planIds;
    if (/^JSON\.stringify\(Object\.fromEntries/.test(expr)) return JSON.stringify(panel.CASES.counts);
    if (/getElementById\('search-chip'\);return/.test(expr)) return { hidden: false, text: '1', name: '1 on: review' };
    if (/#search-pills \.query-pill'\)\]\.map\(\(b\)=>b\.dataset\.pillKey\)$/.test(expr)) return ['blocked', 'review', 'waiting'];
    if (/^document\.activeElement&&\(document\.activeElement\.id/.test(expr)) return 'search-panel-toggle';
    if (/offsetHeight/.test(expr)) return 40;
    if (/fetch\('\/api\/cards\//.test(expr)) return 200;
    if (/elementFromPoint/.test(expr)) return { x: 5, y: 5 };
    if (/querySelectorAll\('\.graph-node'\)\.length$/.test(expr)) return 30;
    if (/graph-node\.graph-near/.test(expr)) return panel.CASES.review;
    if (/\[\.\.\.selectedIds\]/.test(expr) && !/JSON\.stringify/.test(expr)) return [];
    if (/getElementById\('search-input'\)\.value$/.test(expr)) return '';
    return true;
  };
  const page = {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    send: async () => {},
    open: async (p) => { log.opened.push(p); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async () => ({ x: 10, y: 10 }),
    click: async () => { log.clicks++; },
    key: async (name) => { log.keys.push(name); },
    rightClick: async () => {},
    check: (name, ok) => log.checks.push([name, ok]),
  };
  return page;
}

test('run once against a stand-in page the scenario finishes, and every expression it sends to the page parses', async () => {
  const page = standIn();
  await panel.run(page);
  assert.deepStrictEqual(page.log.bad, [], 'an expression the scenario sends does not parse');
  assert.ok(page.log.exprs.length > 100, 'it sends the page a lot of expressions');
  assert.ok(page.log.checks.length >= 60, `only ${page.log.checks.length} checks`);
  const names = page.log.checks.map(([n]) => n);
  assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a check name used twice');
});

test('the scenario loads the plan board cold, in the Board and in the Graph, once for the switch kept across a reload, and once more for the fold preference', async () => {
  const page = standIn();
  await panel.run(page);
  assert.deepStrictEqual(page.log.opened, ['/', '/', '/', '/?view=graph', '/', '/']);
});

test('it presses Escape through the three links of the chain, and Tab, Enter and Space for the keyboard', async () => {
  const page = standIn();
  await panel.run(page);
  const count = (k) => page.log.keys.filter((x) => x === k).length;
  assert.ok(count('Escape') >= 6, 'the bulk popup, the two steps with the panel closed, the list, the panel and the sheet, and the box as many times as it takes');
  assert.ok(count('Tab') >= 8);
  assert.ok(count('Enter') >= 3);
  assert.strictEqual(count(' '), 3, 'Space on the arrow, on a pill and on the fold control');
  assert.strictEqual(count('p'), 7, 'p off, on, in the box, under a card menu, under the sheet, off again before the reload, on after it');
});

test('the scenario drives the switch in order: focus opens the panel, a click switches it off, focus and a click open nothing, a second click opens it, then the p key in each place the ticket names, the reload, and the preferences sheet last', () => {
  const at = (name) => code.indexOf(`check('${name}'`);
  const names = [
    'the arrow starts pressed, the switch on, and says the panel is collapsed',
    'focusing the search box opens the panel and the arrow says it is expanded',
    'a click on the arrow switches it off: the panel closes and the arrow says it is not pressed',
    'the arrow is struck through while the switch is off',
    'with the switch off, focusing the box opens nothing',
    'with the switch off, a click into the box opens nothing either',
    'a second click switches it on and opens the panel now, with no focus in the box',
    'p switches it off: the panel closes and the arrow says it is not pressed',
    'p again switches it on and opens the panel now',
    'p typed in the search box is a letter, and leaves the switch and the panel alone',
    'with a card menu up, p does nothing',
    'with the preferences sheet open, p does nothing',
    'the choice survives a reload: with the switch off the arrow comes back not pressed and the panel shut',
    'after the reload, focusing the box still opens nothing',
    'after the reload, p switches it on and opens the panel',
    'the panel lists blocked, review and waiting, in that order',
    'Shift+Tab from the toggle reaches the box and opens the panel that Esc had closed',
    'Enter on the toggle switches it off and closes the panel',
    'Space on the toggle switches it on and opens the panel',
    'Esc left the switch on: focusing the box opens the panel again',
    'a click into the box opens the panel',
    'the sheet shows "Panel opens when the search box is focused" on',
    'with the checkbox off, the arrow is not pressed and the panel is shut',
    'with the checkbox off, focusing the box opens nothing',
    'with the checkbox on again, the arrow is pressed and the panel stays shut until the box is focused',
    'and then focusing the box opens the panel',
    'the sheet shows what the arrow did: the checkbox is off',
    'a click on the arrow switches it on again, and opens the panel now',
  ];
  for (const name of names) assert.ok(at(name) > 0, name);
  assert.ok(names.every((n, i) => !i || at(n) > at(names[i - 1])), 'in the order they are driven');
  assert.ok(at('focusing the search box does not open the panel') < 0, 'the rule that focusing the box opens nothing is gone');
  assert.ok(!/check\('the toggle opens the panel and says it is expanded'/.test(code), 'a click on the arrow no longer opens a panel that is already switched on');
  const sheet = code.slice(at('the sheet shows "Panel opens when the search box is focused" on'));
  assert.strictEqual(sheet.split("clickOn('#prefs-panel-on-focus')").length - 1, 2, 'the checkbox is clicked off and on again');
});

test('every check the scenario makes has a name that says what it holds', async () => {
  const page = standIn();
  await panel.run(page);
  for (const [name] of page.log.checks) assert.ok(name.length > 12 && /[a-z]/.test(name), name);
});
