const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive } = require('../scripts/card-store');
const { parseConfig } = require('../scripts/config-store');
const { materialize } = require('./browser/boards');
const { parseSearchQuery, filterCards, searchTermText, searchIsolateText } = require('../web/search');
const { pillList, pillRows } = require('../web/pills');
const { NO_SELECTION, cardPart, pathPart, queryPart, addPart, resolveSelection } = require('../web/selection');
const scenarios = require('./browser/scenarios');
const scenario = require('./browser/scenarios/isolate');

// The browser runner's isolate scenario only runs in a browser (in CI). What it expects of the plan
// board is held here to the search module, the pill list and the board's own cards and config, the
// in-page expressions it sends are all parsed, and the scenario is run once against a stand-in page
// so a typo in it fails here and not only in a slow browser run.

const roots = [];
const planBoard = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-isolate-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('plan', dir);
  const live = listActive(dir);
  const config = parseConfig(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'));
  const matchIds = (query) => new Set(filterCards(live, parseSearchQuery(query, 'plan'), { board: 'plan' }).map((c) => c.id));
  const list = pillList(live, matchIds, { pills: config.pills, cards: live, term: searchTermText });
  return { live, config, matchIds, list, byId: new Map(live.map((c) => [c.id, c])) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const sorted = (list) => [...new Set([...list].map(Number))].sort((a, b) => a - b);
const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'isolate.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { CASES } = scenario;

test('the scenario is in the runner, on the plan board, with time for its four parts', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'isolate'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.ok(scenario.timeoutMs >= 90000);
});

test('the path of the card the scenario right-clicks is the cards it says', () => {
  const b = planBoard();
  assert.deepStrictEqual(sorted(b.matchIds(`path:${CASES.pathOf}`)), CASES.pathCards);
});

test('the grill pill is a value pill among the first eight, with the label, query and cards the scenario says, and the key it clicks by', () => {
  const b = planBoard();
  const rows = pillRows(b.list, []);
  const pill = rows.find((r) => r.kind !== 'more' && r.label === CASES.pill.label);
  assert.ok(pill, 'the pill is shown without the more button');
  assert.strictEqual(pill.query, CASES.pill.query);
  assert.strictEqual(pill.key, `value:tags:${CASES.pill.label}`);
  assert.deepStrictEqual(sorted(b.matchIds(CASES.pill.query)), CASES.pill.cards);
});

test('the loose cards the Graph part may click are live cards with no parent, child or wait, outside the path and the pill', () => {
  const b = planBoard();
  const used = new Set([...CASES.pathCards, ...CASES.pill.cards]);
  for (const id of CASES.loose) {
    const c = b.byId.get(id);
    assert.ok(c, `card ${id} is live`);
    assert.ok(!used.has(id), `card ${id} is in the path or the pill`);
    assert.strictEqual(c.parent, null, `card ${id} has a parent`);
    assert.deepStrictEqual(c.waiting_for || [], [], `card ${id} waits`);
    assert.ok(!b.live.some((o) => o.parent === id || (o.waiting_for || []).includes(id)), `card ${id} has a child or a dependent`);
  }
  assert.ok(CASES.loose.length >= 6, 'there are enough to find two with a clear dot');
});

test('every pair of loose cards, with the path and the pill, writes the text the scenario expects and matches exactly the cards it expects', () => {
  const b = planBoard();
  for (const x of CASES.loose) {
    for (const y of CASES.loose) {
      if (x === y) continue;
      const selection = [cardPart(x), cardPart(y), pathPart(CASES.pathOf), queryPart(CASES.pill.query)].reduce((s, p) => addPart(s, p), NO_SELECTION);
      const text = searchIsolateText([selection.anchor, ...selection.additions]);
      assert.strictEqual(text, `#${x} | #${y} | path:${CASES.pathOf} | ${CASES.pill.query}`);
      const expected = sorted([x, y, ...CASES.pathCards, ...CASES.pill.cards]);
      assert.deepStrictEqual(sorted(b.matchIds(text)), expected, text);
      assert.deepStrictEqual(sorted(resolveSelection(selection, b.matchIds, null)), expected, 'and that is what the selection resolves to');
    }
  }
});

test('the views part: the picked cards are live, the one dated card is in June 2031, and the views draw what the scenario says', () => {
  const b = planBoard();
  const { picked, gantt, calendar, month, card } = CASES.dated;
  for (const id of picked) assert.ok(b.byId.has(id), `card ${id} is live`);
  const dated = picked.filter((id) => b.byId.get(id).start_date || b.byId.get(id).end_date || b.byId.get(id).due_date);
  assert.deepStrictEqual(dated, gantt, 'the Gantt lists the dated ones');
  assert.deepStrictEqual(dated, calendar);
  assert.strictEqual(b.byId.get(card).start_date.slice(0, 7), '2031-06');
  assert.strictEqual(month, 'June 2031');
  const text = searchIsolateText(picked.map(cardPart));
  assert.strictEqual(text, picked.map((id) => `#${id}`).join(' | '));
  assert.deepStrictEqual(sorted(b.matchIds(text)), sorted(picked));
  for (const id of picked.filter((x) => x !== card)) assert.ok(!b.byId.get(id).start_date && !b.byId.get(id).due_date, `card ${id} is undated, so the Gantt and the Calendar draw none of it`);
});

test('the zephyr search narrows the Board to the cards the scenario says, and the two it picks are among them', () => {
  const b = planBoard();
  assert.deepStrictEqual(sorted(b.matchIds(CASES.zephyr.query)), CASES.zephyr.cards);
  for (const id of CASES.zephyr.picked) assert.ok(CASES.zephyr.cards.includes(id));
  const text = searchIsolateText(CASES.zephyr.picked.map(cardPart));
  assert.deepStrictEqual(sorted(b.matchIds(text)), sorted(CASES.zephyr.picked));
});

test('the card tagged through the API is live, carries no tag yet and joins the grill pill\'s cards when it is tagged', () => {
  const b = planBoard();
  const c = b.byId.get(CASES.tagged);
  assert.ok(c);
  assert.deepStrictEqual(c.tags, []);
  const tagged = b.live.map((x) => (x.id === CASES.tagged ? { ...x, tags: [CASES.pill.label] } : x));
  const after = filterCards(tagged, parseSearchQuery(CASES.pill.query, 'plan'), { board: 'plan' }).map((x) => x.id);
  assert.deepStrictEqual(sorted(after), sorted([...CASES.pill.cards, CASES.tagged]));
});

test('the card the scenario clicks for one isolated card and the loose one it picks are different cards, and none is a card the poll part tags', () => {
  assert.ok(!CASES.dated.picked.slice(0, -1).includes(CASES.dated.card));
  assert.ok(!CASES.zephyr.picked.includes(CASES.tagged));
  assert.ok(!CASES.pill.cards.includes(CASES.tagged));
});

test('the scenario does not wait on a fixed sleep', () => {
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
});

test('the ids and classes the scenario drives are in the page', () => {
  const web = path.join(__dirname, '..', 'web');
  const page = ['app.html', 'app.js', 'search-panel.js', 'isolate.js', 'graph-view.js', 'app.css'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  for (const name of ['isolate-switch', 'search-panel', 'search-chip', 'search-pills', 'query-pill', 'search-input', 'search-clear-btn', 'context-menu', 'ctx-path', 'graph-canvas', 'graph-node', 'graph-dot', 'cal-title']) {
    assert.ok(page.includes(name), `${name} is in the page`);
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
  for (const view of ['map', 'gantt', 'calendar', 'graph']) assert.ok(page.includes(`id="${view}-toggle-btn"`), `${view}-toggle-btn is in the page`);
  assert.ok(code.includes('-toggle-btn'), 'the view buttons are pressed');
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in one fails here, and the
// keys and clicks it makes are logged. Whether each check holds is for the browser.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], keys: [], clicks: [], rightClicks: [] };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 140)}`); }
  };
  const answer = (expr) => {
    if (/getBoundingClientRect\(\);return \{r:r\.right,b:r\.bottom\}/.test(expr)) return { r: 1500, b: 900 };
    if (/new Set\(\[\.\.\.document\.querySelectorAll\('\.graph-node'\)\]\.map\(\(n\)=>n\.dataset\.id\)\)\.size$/.test(expr)) return 26;
    if (/getFullYear\(\),d\.getMonth\(\)/.test(expr)) return [2026, 9];
    if (/graph-dot'\);if\(!dot\)return null/.test(expr)) return { x: 100, y: 100 };
    if (/id="\$\{id\}"\]'\);if\(!el\)return null|\.card-el\[data-id=/.test(expr) && /scrollIntoView/.test(expr)) return { x: 50, y: 50 };
    if (/getElementById\('search-chip'\)/.test(expr)) return { hidden: false, text: 'isolated', name: '1 on: isolated', title: '1 on: isolated' };
    if (/\.getAttribute\('role'\)$/.test(expr)) return 'switch';
    if (/document\.activeElement&&document\.activeElement\.id$/.test(expr)) return 'isolate-switch';
    if (/getElementById\('search-input'\)\.value$/.test(expr)) return '';
    if (/\.map\(\(p\)=>/.test(expr) && /selectionState/.test(expr)) return { anchor: null, additions: [] };
    if (/^\[\.\.\.selectedIds\]$/.test(expr)) return [];
    if (/cal-title/.test(expr) && /textContent\|\|''\)$/.test(expr)) return 'June 2031';
    if (/fetch\('\/api\/cards\//.test(expr)) return 200;
    return true;
  };
  return {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    send: async (method, params) => { log.exprs.push(`send ${method}`); return params; },
    open: async (p) => { log.opened.push(p); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async () => ({ x: 10, y: 10 }),
    mouse: async () => {},
    click: async (x, y, extra) => { log.clicks.push(extra || {}); },
    key: async (name, mods = {}) => { log.keys.push([name, mods]); },
    rightClick: async (sel) => { log.rightClicks.push(sel); return true; },
    check: (name, ok) => log.checks.push([name, ok]),
    shot: async () => {},
  };
}

test('run once against a stand-in page the scenario finishes, and every expression it sends to the page parses', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.bad, [], 'an expression the scenario sends does not parse');
  assert.ok(page.log.exprs.length > 150, 'it sends the page a lot of expressions');
  const names = page.log.checks.map(([n]) => n);
  assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a check name used twice');
  for (const n of names) assert.ok(n.length > 12 && /[a-z]/.test(n), n);
});

test('it loads the Graph and then the Board cold by its address, each part from its own page, so the view kept in the browser never decides', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.opened, ['/?view=graph', ...Array(5).fill('/?view=board')]);
});

test('it covers every behaviour listed here, each by a check of its own', async () => {
  const page = standIn();
  await scenario.run(page);
  const names = page.log.checks.map(([n]) => n);
  for (const part of [
    'only the cards of the selection are drawn in the Graph',
    'the switch reports on to assistive technology',
    'with the panel closed, the chip says isolated',
    'a click on a shown card makes it the anchor',
    'and leaves the box text and the shown cards as they were',
    'a click on the empty Graph leaves the selection, the box and the shown cards',
    'Esc with focus outside the box turns isolate off',
    'after isolate is off, a second Esc drops the additions',
    'the first Esc closes the panel and leaves isolate on',
    'the second Esc turns isolate off and gives the box back the text it held',
    'turning the switch off gives the box back its earlier text',
    'isolating the card dated in 2031, in the Calendar\'s month view, jumps to its month',
    'a keystroke typed at the end of the box keeps the text\'s leading #',
    'Tab from the last pill reaches the switch',
    'Enter on the switch turns isolate on',
    'Space on the switch turns it off',
    'never clears the selection',
    'the card appears on the Board after the next poll',
    'the i key turns isolate off',
  ]) assert.ok(names.some((n) => n.includes(part)), part);
  for (const view of ['map', 'gantt', 'calendar', 'graph']) {
    assert.ok(names.some((n) => n.startsWith(`${view}: only the isolated cards are drawn`)), view);
    assert.ok(names.some((n) => n.startsWith(`${view}: the selection's parts, the box and the switch are as they were`)), view);
    assert.ok(names.some((n) => n.startsWith(`${view}: the selection reaches the picked cards the view draws`)), view);
  }
});

test('it presses the real keys: i, Tab, Enter, Space and Esc, and i with Ctrl or Alt held', async () => {
  const page = standIn();
  await scenario.run(page);
  const names = page.log.keys.map(([k]) => k);
  for (const k of ['i', 'Tab', 'Enter', ' ', 'Escape', 'x']) assert.ok(names.includes(k), k);
  assert.strictEqual(page.log.keys.filter(([k, m]) => k === 'i' && (m.ctrl || m.alt)).length, 2);
});

test('it builds the Graph selection with a plain click, a Shift+click, a menu path and a Shift+click on the pill, and makes a double click on the switch and on the empty Graph', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.ok(page.log.rightClicks.includes(`#graph-view .card-el[data-id="${CASES.pathOf}"]`));
  assert.strictEqual(page.log.clicks.filter((e) => e.modifiers === 8).length, 2, 'Shift+click on the second card and on the pill');
  assert.ok(page.log.clicks.filter((e) => e.modifiers === 2).length >= 3, 'Ctrl+clicks on the Board');
  assert.strictEqual(page.log.clicks.filter((e) => e.clickCount === 2).length, 2, 'one double click on the empty Graph and one on the switch');
});
