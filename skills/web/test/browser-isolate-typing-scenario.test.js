const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive, toJSON } = require('../scripts/card-store');
const { materialize } = require('./browser/boards');
const { parseSearchQuery, filterCards } = require('../web/search');
const { PREFS_TYPING_VIEWS, prefsDefaults } = require('../web/prefs');
const scenarios = require('./browser/scenarios');
const scenario = require('./browser/scenarios/isolate-typing');

// The browser runner's isolate-typing scenario only runs in a browser (in CI). What it expects of the
// fixture board is held here to the search module over the board's own cards, the checkboxes it expects
// to the panel's markup and the preferences, the in-page expressions it sends are all parsed, and the
// scenario is run once against a stand-in page so a typo in it fails here and not only in a slow browser run.

const roots = [];
const fixtureBoard = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-isolate-typing-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('fixture', dir);
  return listActive(dir).map(toJSON);
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const WEB = path.join(__dirname, '..', 'web');
const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'isolate-typing.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { CASES } = scenario;

test('the scenario is in the runner, on the fixture board, with time for its parts', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'isolate-typing'), scenario);
  assert.strictEqual(scenario.board, 'fixture');
  assert.ok(scenario.timeoutMs >= 60000);
});

test('the query it types matches the cards it says among the fixture board\'s live cards, and the board has 18 of them', () => {
  const live = fixtureBoard();
  assert.strictEqual(live.length, 18);
  const matched = filterCards(live, parseSearchQuery(CASES.query, 'fixture'), { board: 'fixture' }).map((c) => Number(c.id)).sort((a, b) => a - b);
  assert.deepStrictEqual(matched, CASES.cards);
});

test('the checkboxes it expects are the panel\'s, in the order the panel lists the views, each at the choice the preferences start it at', () => {
  const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');
  const listed = [...html.matchAll(/<input type="checkbox" data-typing-view="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(CASES.checkboxes.map(([view]) => view), listed);
  assert.deepStrictEqual([...listed].sort(), [...PREFS_TYPING_VIEWS].sort(), 'one for each view the preferences keep');
  const defaults = prefsDefaults().typingIsolates;
  for (const [view, on] of CASES.checkboxes) assert.strictEqual(defaults[view], on, view);
});

test('the ids and classes the scenario drives are in the page', () => {
  const page = ['app.html', 'search-panel.js', 'isolate.js', 'app.css'].map((f) => fs.readFileSync(path.join(WEB, f), 'utf8')).join('\n');
  for (const name of ['search-typing', 'data-typing-view', 'isolate-switch', 'search-panel-toggle', 'search-clear-btn', 'graph-near']) {
    assert.ok(page.includes(name) || fs.readFileSync(path.join(WEB, 'graph-view.js'), 'utf8').includes(name) || fs.readFileSync(path.join(WEB, 'graph-model.js'), 'utf8').includes(name), `${name} is in the page`);
    assert.ok(code.includes(name) || code.includes(name.replace('data-typing-view', 'typing-view')), `${name} is driven by the scenario`);
  }
});

test('the scenario does not wait on a fixed sleep, and presses its keys through the runner\'s key helper', () => {
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
  assert.ok(/key\('Escape'\)/.test(code) && /key\('i'\)/.test(code));
  assert.ok(!/dispatchEvent|new KeyboardEvent/.test(code), 'no hand-made key event');
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in one fails here,
// and the pages it opens, the keys it presses and the text it types are logged. Whether each check holds
// is for the browser to say.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], keys: [], clicks: 0, inserted: [], reloads: 0 };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 140)}`); }
  };
  const answer = (expr) => {
    if (/^JSON\.stringify\(\[\.\.\.new Set\(/.test(expr)) return '[1,2,3]';
    return true;
  };
  return {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    send: async (method, params) => { log.exprs.push(`send ${method}`); if (method === 'Input.insertText') log.inserted.push(params.text); if (method === 'Page.reload') log.reloads++; return params; },
    open: async (p) => { log.opened.push(p); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async () => ({ x: 10, y: 10 }),
    click: async () => { log.clicks++; },
    key: async (name) => { log.keys.push(name); },
    check: (name, ok) => log.checks.push([name, ok]),
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

test('it loads the Board, the links, the Graph and the Board again cold by their addresses, and reloads once', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.opened, [
    '/?view=board', `/?view=board&q=${CASES.query}`, `/?view=graph&q=${CASES.query}`, '/?view=graph', '/?view=board',
  ]);
  assert.strictEqual(page.log.reloads, 1);
});

test('it types the query the unit test holds to the board, and presses Escape twice and the i key once', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.ok(page.log.inserted.length > 0 && page.log.inserted.every((t) => t === CASES.query));
  assert.deepStrictEqual(page.log.keys.filter((k) => k === 'i'), ['i']);
  assert.strictEqual(page.log.keys.filter((k) => k === 'Escape').length, 2, 'one closes the panel and one turns isolate off');
});

test('it covers every behaviour listed at its head, each by a check of its own', async () => {
  const page = standIn();
  await scenario.run(page);
  const names = page.log.checks.map(([n]) => n);
  for (const part of [
    'typing on the Board turns isolate on',
    'Esc with focus outside the box turns isolate off, and the text stays in the box',
    'the zephyr cards wear the selected look',
    'a lit card is no selected card',
    'the i key isolates that lit query as it stands',
    'the clear button empties the box and ends isolate',
    'a ?q= link into the Board opens it',
    'and opens isolated',
    'and opens lighting',
    'typing in the Graph lights the matches and draws every dot, with isolate off',
    'ticking the Graph\'s checkbox is kept for the view',
    'typing in the Graph now isolates',
    'unticking the Board\'s checkbox shows it unticked',
    'after a reload the Board\'s checkbox is still unticked',
    'typing on the Board then lights',
  ]) assert.ok(names.some((n) => n.includes(part)), part);
});
