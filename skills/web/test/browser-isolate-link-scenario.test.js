const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive, toJSON } = require('../scripts/card-store');
const { materialize } = require('./browser/boards');
const { idMap } = require('./helpers/id-map');
const { parseSearchQuery, filterCards, searchIsolateText } = require('../web/search');
const { cardPart } = require('../web/selection');
const scenarios = require('./browser/scenarios');
const scenario = require('./browser/scenarios/isolate-link');

// The browser runner's isolate-link scenario only runs in a browser (in CI). What it expects of the
// plan board is held here to the search module and the board's own cards, the in-page expressions it
// sends are all parsed, and the scenario is run once against a stand-in page so a typo in it fails
// here and not only in a slow browser run.

const roots = [];
const planBoard = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-isolate-link-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('plan', dir);
  const live = listActive(dir).map(toJSON);
  const matchIds = (query) => new Set(filterCards(live, parseSearchQuery(query, 'plan'), { board: 'plan' }).map((c) => c.id));
  return { live, matchIds, byId: idMap(live) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const sorted = (list) => [...new Set([...list].map(Number))].sort((a, b) => a - b);
const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'isolate-link.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { CASES } = scenario;

test('the scenario is in the runner, on the plan board, with time for its parts', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'isolate-link'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.ok(scenario.timeoutMs >= 60000 && scenario.timeoutMs <= 120000);
});

test('the cards it picks and the card it right-clicks outside them are live, loose and three different cards', () => {
  const b = planBoard();
  const ids = [...CASES.picked, CASES.outside];
  assert.strictEqual(new Set(ids).size, 3);
  for (const id of ids) {
    const c = b.byId.get(id);
    assert.ok(c, `card ${id} is live`);
    assert.strictEqual(c.parent, null, `card ${id} has a parent`);
    assert.deepStrictEqual(c.waiting_for || [], [], `card ${id} waits`);
    assert.ok(!b.live.some((o) => o.parent === String(id) || (o.waiting_for || []).includes(String(id))), `card ${id} has a child or a dependent`);
  }
});

test('the two cards it picks are written as #a | #b and that text matches exactly those two', () => {
  const b = planBoard();
  const text = searchIsolateText(CASES.picked.map(cardPart));
  assert.strictEqual(text, CASES.picked.map((id) => `#${id}`).join(' | '));
  assert.deepStrictEqual(sorted(b.matchIds(text)), sorted(CASES.picked));
});

test('the search it keeps narrows the Board to the cards it says, and the two it picks are among them and are written as the box will hold them', () => {
  const b = planBoard();
  assert.deepStrictEqual(sorted(b.matchIds(CASES.zephyr.query)), CASES.zephyr.cards);
  for (const id of CASES.zephyr.picked) assert.ok(CASES.zephyr.cards.includes(id), `card ${id} shows under the search`);
  const text = searchIsolateText(CASES.zephyr.picked.map(cardPart));
  assert.deepStrictEqual(sorted(b.matchIds(text)), sorted(CASES.zephyr.picked));
});

test('the scenario does not wait on a fixed sleep', () => {
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
});

test('the ids and classes the scenario drives are in the page', () => {
  const web = path.join(__dirname, '..', 'web');
  const page = ['app.html', 'app.js', 'isolate.js', 'graph-view.js', 'search-panel.js', 'app.css'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  for (const name of ['ctx-isolate', 'canvas-menu', 'isolate-switch', 'search-chip', 'search-input', 'context-menu', 'graph-canvas', 'map-canvas', 'graph-node', 'graph-dim', 'map-node', 'graph-toggle-btn', 'map-toggle-btn']) {
    assert.ok(page.includes(name), `${name} is in the page`);
  }
  for (const name of ['ctx-isolate', 'isolate-switch', 'search-chip', 'graph-canvas', 'map-canvas', 'graph-node', 'graph-toggle-btn', 'map-toggle-btn']) {
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in one fails here,
// and the clicks, keys and links it makes are logged. Whether each check holds is for the browser.
// It also keeps the one thing of the page that decides what can be right-clicked: whether isolate is on. The entry of the
// menus and the switch flip it, a page opened cold starts with it off unless the link carries it, and a reload keeps it.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], sent: [], keys: [], clicks: [], rightClicks: [], rightClicksWhileIsolated: [], hidden: [] };
  const drawnWhileIsolated = [...CASES.picked, ...CASES.zephyr.picked];
  let isolated = false;
  let centred = null;
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 140)}`); }
  };
  const answer = (expr) => {
    if (/elementFromPoint/.test(expr) && /innerWidth/.test(expr)) return { x: 10, y: 10 };
    if (/scrollIntoView/.test(expr)) return { x: 50, y: 50 };
    if (/new Set\(\[\.\.\.document\.querySelectorAll\('#graph-view \.graph-node'\)\]\.map\(\(n\)=>n\.dataset\.id\)\)\.size$/.test(expr)) return 26;
    if (/getElementById\('search-chip'\)/.test(expr)) return { hidden: false, text: 'isolated' };
    if (/^history\.length$/.test(expr)) return 4;
    if (/location\.origin$/.test(expr)) return 'http://127.0.0.1:1';
    if (/getElementById\('search-input'\)\.value$/.test(expr)) return '';
    if (/textContent\.trim\(\)$/.test(expr)) return 'Isolate';
    if (/querySelectorAll\('button'\)\]\.filter/.test(expr) && /\.slice\(0,2\)/.test(expr)) return ['Peek', 'Add to selection'];
    if (/querySelectorAll\('button'\)\]\.filter/.test(expr)) return ['ctx-isolate'];
    if (/Object\.fromEntries\(new URLSearchParams/.test(expr)) return {};
    return true;
  };
  return {
    log,
    ev: async (expr) => {
      log.exprs.push(expr); parse(expr);
      if (/getElementById\("isolate-switch"\)\.click\(\)/.test(expr)) isolated = !isolated;
      return answer(expr);
    },
    send: async (method, params) => { log.exprs.push(`send ${method}`); log.sent.push([method, params]); return params; },
    open: async (p) => { log.opened.push(p); isolated = /[?&]isolate=1/.test(p) && /[?&]q=/.test(p); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async (selector) => { centred = selector; return { x: 10, y: 10 }; },
    click: async (x, y, extra) => {
      log.clicks.push(extra || {});
      if (!(extra && extra.modifiers) && centred === '#ctx-isolate') isolated = !isolated;
    },
    key: async (name, mods = {}) => { log.keys.push([name, mods]); },
    rightClick: async (sel) => {
      log.rightClicks.push(sel);
      const card = /\.card-el\[data-id="(\d+)"\]/.exec(sel);
      if (isolated && card) {
        log.rightClicksWhileIsolated.push(sel);
        if (!drawnWhileIsolated.includes(Number(card[1]))) log.hidden.push(sel);
      }
      return true;
    },
    check: (name, ok) => log.checks.push([name, ok]),
    shot: async () => {},
  };
}

test('run once against a stand-in page the scenario finishes, and every expression it sends to the page parses', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.bad, [], 'an expression the scenario sends does not parse');
  assert.ok(page.log.exprs.length > 100, 'it sends the page a lot of expressions');
  const names = page.log.checks.map(([n]) => n);
  assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a check name used twice');
  for (const n of names) assert.ok(n.length > 12 && /[a-z]/.test(n), n);
});

test('it covers every behaviour listed here, each by a check of its own', async () => {
  const page = standIn();
  await scenario.run(page);
  const names = page.log.checks.map(([n]) => n);
  for (const part of [
    'a right-click on a card inside the selection of two opens the menu',
    'and that menu offers Isolate, as Isolate',
    'choosing it writes the selection into the box, as the switch does',
    'and that menu does not offer Isolate',
    'Graph: a right-click on a card inside the selection of two offers Isolate',
    'Graph: choosing it turns isolate on',
    'Graph: a right-click on a card outside the selection opens its menu with no Isolate',
    'a right-click on the empty Graph canvas is kept from opening the browser\'s own menu',
    'a right-click on the empty Map canvas is kept from opening the browser\'s own menu',
    'the address carries the isolate parameter beside q',
    'the address has neither q nor isolate again',
    'turning isolate on added no browser-history entry',
    'after a reload the switch is on and the box holds the isolate text',
    'and the address is as it was',
    'and the chip says isolated, and the Board shows only the two',
    'after the reload, turning isolate off gives back the search from before isolating',
    'the Graph draws only the isolated set',
    'with no dimmed card',
    'the Board shows only the isolated set',
    'in that fresh browser turning isolate off leaves the box empty',
    'isolate is off, the box is empty and the chip is quiet',
    'and the address has lost the isolate parameter, with nothing typed',
    'opening a card while isolated adds one history step carrying card, q and isolate',
    'Back closes the card and keeps q and isolate',
  ]) assert.ok(names.some((n) => n.includes(part)), part);
});

test('it opens the isolated link cold in a browser it has emptied, for the Graph and then the Board, and the link with no query on its own', async () => {
  const page = standIn();
  await scenario.run(page);
  const text = encodeURIComponent(CASES.zephyr.picked.map((id) => `#${id}`).join(' | '));
  assert.ok(page.log.opened.includes(`/?q=${text}&isolate=1&view=graph`), page.log.opened.join(' '));
  assert.ok(page.log.opened.includes(`/?q=${text}&isolate=1&view=board`), page.log.opened.join(' '));
  assert.ok(page.log.opened.includes('/?isolate=1&view=board'), page.log.opened.join(' '));
  const cleared = page.log.sent.filter(([m]) => m === 'Storage.clearDataForOrigin');
  assert.strictEqual(cleared.length, 2, 'storage is cleared before each of the two isolated links');
  for (const [, params] of cleared) assert.strictEqual(params.storageTypes, 'all');
  const methods = page.log.sent.map(([m]) => m);
  assert.ok(methods.indexOf('Page.navigate') < methods.indexOf('Storage.clearDataForOrigin'), 'the page is left before its storage is cleared');
  assert.ok(methods.includes('Page.reload'), 'it reloads');
});

test('it right-clicks real cards, picks with Ctrl+clicks and chooses the entry with a real mouse click, and closes menus with Esc', async () => {
  const page = standIn();
  await scenario.run(page);
  const [a] = CASES.picked;
  assert.ok(page.log.rightClicks.includes(`#board .card-el[data-id="${a}"]`));
  assert.ok(page.log.rightClicks.includes(`#board .card-el[data-id="${CASES.outside}"]`));
  assert.ok(page.log.rightClicks.includes(`#graph-view .card-el[data-id="${a}"]`));
  assert.ok(page.log.rightClicks.includes(`#graph-view .card-el[data-id="${CASES.outside}"]`));
  assert.ok(page.log.clicks.filter((e) => e.modifiers === 2).length >= 8, 'Ctrl+clicks on the Board, each time the cards are picked');
  assert.ok(page.log.clicks.filter((e) => !e.modifiers).length >= 7, 'a real click on the entry each time it is chosen');
  assert.ok(page.log.keys.some(([k]) => k === 'Escape'));
});

test('it right-clicks no card that isolate is hiding, which the view does not draw and a right-click cannot reach', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.hidden, [], 'a right-click on a card while isolate hides it');
  assert.ok(page.log.rightClicksWhileIsolated.length >= 2, 'the scenario right-clicks cards while isolated, on the Board and in the Graph');
  assert.ok(page.log.rightClicksWhileIsolated.some((s) => s.startsWith('#graph-view ')), 'one of them in the Graph');
});
