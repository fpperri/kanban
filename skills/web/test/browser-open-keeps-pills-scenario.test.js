const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive, listArchived } = require('../scripts/card-store');
const { parseSearchQuery, filterCards } = require('../web/search');
const { materialize } = require('./browser/boards');
const scenarios = require('./browser/scenarios');
const scenario = require('./browser/scenarios/open-keeps-pills');

// The browser runner's open-keeps-pills scenario only runs in a browser (in CI). What it
// expects of the plan board is held here to the cards' own files and the search module, the
// in-page expressions it sends are all parsed, and it is run once against a stand-in page so a
// typo in it fails here and not only in a slow browser run.

const roots = [];
const planBoard = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-open-keeps-pills-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('plan', dir);
  const live = listActive(dir);
  return { live, all: live.concat(listArchived(dir)), byId: new Map(live.map((c) => [c.id, c])) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const WEB = path.join(__dirname, '..', 'web');
const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'open-keeps-pills.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const shownBy = (b, query) => filterCards(b.all, parseSearchQuery(query, 'plan'), { board: 'plan' }).map((c) => c.id).filter((id) => b.byId.has(id)).sort((a, c) => a - c);

test('the scenario is in the runner, on the plan board, with time for its drives', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'open-keeps-pills'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.strictEqual(scenario.alsoBoards, undefined);
  assert.ok(scenario.timeoutMs >= 60000);
});

test('it covers a plain click that opens a card in the Board, the Map, the Gantt and the Calendar, each with a check on the box, the pill and the cards shown', () => {
  assert.deepStrictEqual(scenario.VIEWS, ['board', 'map', 'gantt', 'calendar']);
  for (const name of [
    'a plain click on the card opens it', 'the box still holds review:', 'the review pill is still on, and still the anchor',
    'the view behind the card shows the same card', 'closing the card leaves the box as it was',
    'closing the card leaves the pill on, still the anchor', 'closing the card leaves the view showing the same card',
  ]) {
    assert.ok(source.includes('check(`${view}: ' + name + '`'), name);
  }
});

test('it also covers two pills on, a click that only selects, and the Graph\'s Enter and plain click', () => {
  for (const name of [
    'both pills stay on, the first the anchor and the second an addition', 'the box still holds both queries',
    'a plain click in a Board set to selects selects the card and opens nothing', 'and it takes the pill\\\'s query out of the box',
    'in the Graph, Enter on a focused dot opens the card', 'and leaves the box, the pill and the anchor as they were',
    'a plain click on the dot selects the card and opens nothing', 'and takes the pill\\\'s query out of the box',
  ]) {
    assert.ok(source.includes(`'${name}'`) || source.includes(`check('${name}'`), name);
  }
});

test('nothing waits on a fixed sleep, no hand-made event stands in for a click, and the keys and modifiers are the runner\'s own', () => {
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
  assert.ok(!/dispatchEvent/.test(code));
  assert.ok(/modifiers: 8/.test(code), 'Shift+click on the second pill');
  assert.ok(/key\('Enter'\)/.test(code) && /key\('Escape'\)/.test(code));
});

test('the ids and classes the scenario drives are in the page it is run on', () => {
  const page = ['app.html', 'app.js', 'graph-view.js', 'search-panel.js', 'pills.js'].map((f) => fs.readFileSync(path.join(WEB, f), 'utf8')).join('\n');
  for (const name of ['search-chip', 'search-panel-toggle', 'search-pills', 'query-pill', 'graph-node', 'graph-dot', 'search-input']) {
    assert.ok(page.includes(name), `${name} is in the page`);
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
});

test('the pills are found by the key the page puts on them', () => {
  assert.ok(fs.readFileSync(path.join(WEB, 'search-panel.js'), 'utf8').includes('dataset.pillKey'));
  assert.ok(code.includes('data-pill-key'));
});

test('the prefs entry the scenario sets for the Board is the one the page reads, per board', () => {
  const prefs = fs.readFileSync(path.join(WEB, 'prefs.js'), 'utf8');
  assert.match(prefs, /const PREFS_FEATURE = 'prefs';/);
  assert.ok(code.includes("kanban.plan.prefs"), 'the board is named plan');
  assert.ok(code.includes('{click:{board:\'selects\'}}'));
});

test('on the plan board, cards 9 and 10 are live and undated, 10 awaits review and 9 is blocked, and they are the only cards the pills leave', () => {
  const b = planBoard();
  for (const id of scenario.DATED) {
    const c = b.byId.get(id);
    assert.ok(c, `card ${id} is live`);
    assert.ok(!c.start_date && !c.end_date && !c.due_date, `card ${id} has no date yet`);
  }
  assert.deepStrictEqual(scenario.DATED, [scenario.BLOCKED_CARD, scenario.REVIEW_CARD]);
  assert.deepStrictEqual(shownBy(b, 'review:'), [scenario.REVIEW_CARD]);
  assert.deepStrictEqual(shownBy(b, 'blocked:'), [scenario.BLOCKED_CARD]);
  assert.deepStrictEqual(shownBy(b, 'review: | blocked:'), [scenario.BLOCKED_CARD, scenario.REVIEW_CARD]);
  assert.ok(b.live.length > 20, 'the Board has more cards than the pills leave');
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in one
// fails here, and what it reads back is answered the way a browser would for the scenario's
// own reads. Whether each check holds is for the browser to say.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], keys: [], clicks: [] };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 120)}`); }
  };
  const answer = (expr) => {
    if (/new Date\(\)/.test(expr)) return '2026-10-15';
    if (/fetch\('\/api\/cards\//.test(expr)) return 200;
    if (/^\[\.\.\.new Set\(\[\.\.\.document\.querySelectorAll\(/.test(expr)) return [scenario.REVIEW_CARD];
    if (/elementFromPoint/.test(expr)) return { x: 5, y: 5 };
    if (/selectionState\.selection\.anchor;return a\?/.test(expr)) return { kind: 'query', text: 'review:', source: null, id: null };
    if (/selectionState\.selection\.additions\.map/.test(expr)) return ['blocked:'];
    if (/getElementById\('search-chip'\);return/.test(expr)) return { hidden: false, text: '1' };
    if (/getElementById\('search-input'\)\.value$/.test(expr)) return 'review:';
    return true;
  };
  return {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    open: async (p) => { log.opened.push(p); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async () => ({ x: 10, y: 10 }),
    click: async (x, y, extra = {}) => { log.clicks.push(extra); },
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
  assert.ok(names.length >= 50, `only ${names.length} checks`);
  assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a check name used twice');
});

test('it loads each view cold, then the Board for two pills, the Board set to selects and the Graph', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.opened, ['/', '/?view=board', '/?view=map', '/?view=gantt', '/?view=calendar', '/?view=board', '/?view=board', '/?view=graph']);
});

test('it presses Escape to close the card after each open and Enter once in the Graph, and Shift+clicks once', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.keys.filter((k) => k === 'Enter'), ['Enter']);
  assert.strictEqual(page.log.keys.filter((k) => k === 'Escape').length, scenario.VIEWS.length + 2, 'a card closed in each view, after the two pills, and after the Graph\'s Enter');
  assert.strictEqual(page.log.clicks.filter((c) => c.modifiers === 8).length, 1);
});
