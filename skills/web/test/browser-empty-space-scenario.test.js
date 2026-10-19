const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive, listArchived, toJSON } = require('../scripts/card-store');
const { parseSearchQuery, filterCards } = require('../web/search');
const { materialize } = require('./browser/boards');
const scenarios = require('./browser/scenarios');
const empty = require('./browser/scenarios/empty-space');

// The browser runner's empty-space scenario only runs in a browser (in CI). What it
// expects of the fixture board is held here to the cards' own files and the search
// module, the list of what is not empty space is held to the page's own, the in-page
// expressions it sends are all parsed, and it is run once against a stand-in page so
// a typo in it fails here and not only in a slow browser run.

const roots = [];
const fixtureBoard = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-empty-space-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('fixture', dir);
  const live = listActive(dir).map(toJSON);
  return { live, all: live.concat(listArchived(dir).map(toJSON)), byId: new Map(live.map((c) => [c.id, c])) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const WEB = path.join(__dirname, '..', 'web');
const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'empty-space.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('the scenario is in the runner, on the fixture board, with time for its drives', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'empty-space'), empty);
  assert.strictEqual(empty.board, 'fixture');
  assert.strictEqual(empty.alsoBoards, undefined);
  assert.ok(empty.timeoutMs >= 60000);
});

test('it covers a click and a double click on empty space in the Board, the Map, the Gantt, the Calendar and the Graph', () => {
  assert.deepStrictEqual(empty.VIEWS, ['board', 'map', 'gantt', 'calendar', 'graph']);
  for (const view of empty.VIEWS) {
    for (const name of ['a click on empty space leaves the selection', 'a double click on empty space clears the selection']) {
      assert.ok(source.includes('check(`${view}: ' + name + '`'), `${view}: ${name}`);
    }
  }
  assert.ok(source.includes("check('calendar: a double click on a day cell opens the new-card form and leaves the selection'"));
  assert.ok(source.includes("check('a click on empty space leaves the pill\\'s query in the box, its chip on and the anchor'"));
  assert.ok(source.includes("check('a double click on empty space takes the pill\\'s query out of the box and the anchor with it'"));
  assert.ok(source.includes("check('and the chip goes off'"));
  assert.ok(source.includes("check('a click on the empty Graph leaves the typed search, its anchor and the cards it selects'"));
  assert.ok(source.includes("check('a double click on the empty Graph clears the typed search and the anchor'"));
});

test('a double click is two real clicks, the second with a click count of 2, and cards are picked with Ctrl+click; nothing waits on a fixed sleep', () => {
  assert.ok(/click\(x, y, \{ clickCount: 1 \}\);\s*await click\(x, y, \{ clickCount: 2 \}\)/.test(code));
  assert.ok(/modifiers: 2/.test(code), 'Ctrl');
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
  assert.ok(!/dispatchEvent/.test(code), 'no hand-made event stands in for a click');
  assert.ok(!/contextmenu/.test(code));
});

test('what the scenario counts as not empty space is what the page does: the same list, and the marker', () => {
  const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const page = app.match(/^const NOT_EMPTY_SPACE = '([^']+)';$/m);
  assert.ok(page, 'the page keeps the list');
  const scenario = source.match(/^const NOT_EMPTY = '([^']+)';$/m);
  assert.ok(scenario, 'the scenario keeps the list');
  const parts = (text) => text.split(',').map((s) => s.trim()).sort();
  assert.deepStrictEqual(parts(scenario[1]), parts(`${page[1]}, [data-keeps-selection]`));
});

test('the ids and classes the scenario drives are in the page it is run on', () => {
  const page = ['app.html', 'app.js', 'graph-view.js', 'search-panel.js', 'pills.js'].map((f) => fs.readFileSync(path.join(WEB, f), 'utf8')).join('\n');
  for (const name of ['cal-dow', 'cal-day', 'search-chip', 'search-panel-toggle', 'search-pills', 'query-pill', 'graph-canvas', 'graph-dot', 'graph-node', 'id="modal"']) {
    assert.ok(page.includes(name), `${name} is in the page`);
  }
  for (const name of ['.cal-dow', '#calendar-view .cal-day', 'search-chip', '#search-panel-toggle', '.query-pill', '.graph-canvas', '.graph-dot', "getElementById('modal')"]) {
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
});

test('on the fixture board, the cards it dates are live and undated, card 10 awaits review, and the review pill leaves cards out', () => {
  const b = fixtureBoard();
  for (const id of empty.DATED) {
    const c = b.byId.get(id);
    assert.ok(c, `card ${id} is live`);
    assert.ok(!c.start_date && !c.end_date && !c.due_date, `card ${id} has no date yet`);
  }
  const review = filterCards(b.all, parseSearchQuery('review:', 'fixture'), { board: 'fixture' }).map((c) => c.id).filter((id) => b.byId.has(id));
  assert.deepStrictEqual(review, [10]);
  assert.ok(review.length < b.live.length);
});

test('the search it types in the Graph matches live cards, and fewer than the board has, so a selection is something to clear', () => {
  const b = fixtureBoard();
  const ids = filterCards(b.all, parseSearchQuery(empty.TYPED, 'fixture'), { board: 'fixture' }).map((c) => c.id).filter((id) => b.byId.has(id));
  assert.ok(ids.length > 0 && ids.length < b.live.length, `${empty.TYPED} matches ${ids.length} of ${b.live.length}`);
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in
// one fails here, and what it reads back is answered the way a browser would for the
// scenario's own reads. Whether each check holds is for the browser to say.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], keys: [], clicks: [], inserted: [] };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 120)}`); }
  };
  const answer = (expr) => {
    if (/new Date\(\)/.test(expr)) return '2026-10-15';
    if (/fetch\('\/api\/cards\//.test(expr)) return 200;
    if (/^\[\.\.\.new Set\(\[\.\.\.document\.querySelectorAll\(/.test(expr)) return [1, 2, 3, 4, 5];
    if (/elementFromPoint/.test(expr)) return { x: 5, y: 5 };
    if (/^\[\.\.\.selectedIds\]/.test(expr)) return [1, 2];
    if (/selectionState\.selection\.anchor;return a\?/.test(expr)) return { kind: 'query', text: 'review:', source: null, id: null };
    if (/getElementById\('search-chip'\);return/.test(expr)) return { hidden: false, text: '1' };
    if (/getElementById\('search-input'\)\.value$/.test(expr)) return 'review:';
    return true;
  };
  const page = {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    send: async (method, params) => { if (method === 'Input.insertText') log.inserted.push(params.text); },
    open: async (p) => { log.opened.push(p); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async () => ({ x: 10, y: 10 }),
    click: async (x, y, extra = {}) => { log.clicks.push(extra); },
    key: async (name) => { log.keys.push(name); },
    check: (name, ok) => log.checks.push([name, ok]),
  };
  return page;
}

test('run once against a stand-in page the scenario finishes, and every expression it sends to the page parses', async () => {
  const page = standIn();
  await empty.run(page);
  assert.deepStrictEqual(page.log.bad, [], 'an expression the scenario sends does not parse');
  assert.ok(page.log.exprs.length > 100, 'it sends the page a lot of expressions');
  const names = page.log.checks.map(([n]) => n);
  assert.ok(names.length >= 40, `only ${names.length} checks`);
  assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a check name used twice');
});

test('it loads each view cold, then the Board for the pill, then the Graph for the typed search', async () => {
  const page = standIn();
  await empty.run(page);
  assert.deepStrictEqual(page.log.opened, ['/', '/?view=board', '/?view=map', '/?view=gantt', '/?view=calendar', '/?view=graph', '/?view=board', '/?view=graph']);
});

test('it types the search the unit test holds to the board, presses Escape once to close the new-card form, and double-clicks as two clicks of count 1 and 2', async () => {
  const page = standIn();
  await empty.run(page);
  assert.deepStrictEqual(page.log.inserted, [empty.TYPED]);
  assert.deepStrictEqual(page.log.keys, ['Escape']);
  const counts = page.log.clicks.map((c) => c.clickCount).filter((n) => n !== undefined);
  assert.deepStrictEqual(counts.filter((n) => n === 2).length, empty.VIEWS.length + 3, 'a double click in each view, in the Calendar\'s day cell, on the pill and in the Graph');
  for (let i = 0; i < counts.length; i++) if (counts[i] === 2) assert.strictEqual(counts[i - 1], 1, 'the second click of a pair follows a first');
});
