const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive, listArchived, toJSON } = require('../scripts/card-store');
const { parseConfig } = require('../scripts/config-store');
const { materialize } = require('./browser/boards');
const { idMap } = require('./helpers/id-map');
const { parseSearchQuery, filterCards, searchTermText } = require('../web/search');
const { pillList, pillRows } = require('../web/pills');
const scenarios = require('./browser/scenarios');
const scenario = require('./browser/scenarios/board-pills');

// The browser runner's board-pills scenario only runs in a browser (in CI). What it
// expects of the three boards is held here to the search module, the pill list and the
// board's own config and cards, the in-page expressions it sends are all parsed, and the
// scenario is run once against a stand-in page so a typo in it fails here and not only
// in a slow browser run.

const roots = [];
const boardOf = (key) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-board-pills-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const live = listActive(dir).map(toJSON);
  const all = live.concat(listArchived(dir).map(toJSON));
  const config = parseConfig(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'));
  const matchIds = (query) => new Set(filterCards(all, parseSearchQuery(query, key), { board: key }).map((c) => c.id));
  const list = pillList(live, matchIds, { pills: config.pills, cards: live, term: searchTermText });
  return { key, live, all, config, matchIds, list, byId: idMap(live) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const sorted = (list) => [...list].map(Number).sort((a, b) => a - b);
const describe = (rows) => rows.map((r) => (r.kind === 'more' ? `[${r.label}]` : r.label));
const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'board-pills.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { CASES } = scenario;

test('the scenario is in the runner, on the plan board with the malformed and fixture boards beside it, and has time for its drives', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'board-pills'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['malformed', 'fixture']);
  assert.ok(scenario.timeoutMs >= 60000);
});

test('the plan board\'s panel lists what the scenario says: the built-ins, the config\'s pills, eight tag pills and "+2 more"; opened, all ten and "fewer"', () => {
  const b = boardOf('plan');
  assert.deepStrictEqual(describe(pillRows(b.list, [])), CASES.closed);
  assert.deepStrictEqual(describe(pillRows(b.list, ['tags'])), CASES.open);
  assert.deepStrictEqual(CASES.closed.slice(0, 5), [...CASES.builtIns, ...CASES.own]);
  assert.deepStrictEqual([...CASES.shownTags, ...CASES.restTags], distinctTags(b.live));
});

const distinctTags = (cards) => [...new Set(cards.flatMap((c) => c.tags))].sort();

test('the plan board has ten distinct tags among its live cards, so eight show and two are behind the button', () => {
  const b = boardOf('plan');
  assert.strictEqual(distinctTags(b.live).length, 10);
  assert.strictEqual(CASES.shownTags.length, 8);
  assert.strictEqual(CASES.restTags.length, 2);
});

test('each pill on the plan board counts what the scenario says, and writes the query the scenario says', () => {
  const b = boardOf('plan');
  assert.deepStrictEqual(Object.fromEntries(b.list.map((p) => [p.label, p.count])), CASES.counts);
  for (const [label, query] of Object.entries(CASES.queries)) assert.strictEqual(b.list.find((p) => p.label === label).query, query, label);
});

test('the grill pill leaves the grill card and not the grilling card, which a substring term would have caught', () => {
  const b = boardOf('plan');
  const ids = (q) => sorted([...b.matchIds(q)].filter((id) => b.byId.has(id)));
  assert.deepStrictEqual(ids(CASES.queries.grill), CASES.grill);
  assert.deepStrictEqual(ids(CASES.queries.grilling), [CASES.grilling]);
  assert.deepStrictEqual(ids('tags:grill'), sorted([...CASES.grill, CASES.grilling]), 'the substring term catches both');
  assert.deepStrictEqual(ids(CASES.queries.next), CASES.next);
  assert.deepStrictEqual(ids(`${CASES.queries.grill} | ${CASES.queries.next}`), sorted([...CASES.grill, ...CASES.next]));
});

test('every count the scenario compares to the Board is the number of live cards its query matches, and the Board shows live cards only', () => {
  const b = boardOf('plan');
  for (const [label, count] of Object.entries(CASES.counts)) {
    const p = b.list.find((x) => x.label === label);
    assert.strictEqual([...b.matchIds(p.query)].filter((id) => b.byId.has(id)).length, count, label);
  }
});

test('the card the scenario tags through the API is live, carries no tag yet, and the tag it gets is the grill pill\'s', () => {
  const b = boardOf('plan');
  const card = b.byId.get(CASES.grillPatched);
  assert.ok(card && card.tags.length === 0 && card.status !== 'done');
  const after = b.live.map((c) => (c.id === card.id ? { ...c, tags: ['grill'] } : c));
  const count = (list) => list.filter((c) => c.tags.includes('grill')).length;
  assert.strictEqual(count(b.live), CASES.counts.grill);
  assert.strictEqual(count(after), CASES.grillPatchedCount);
});

test('the malformed board\'s panel is the built-ins and the two pills its reader keeps, with the counts the scenario says', () => {
  const b = boardOf('malformed');
  assert.deepStrictEqual(describe(pillRows(b.list, [])), CASES.malformed.labels);
  assert.deepStrictEqual(Object.fromEntries(b.list.map((p) => [p.label, p.count])), CASES.malformed.counts);
  assert.strictEqual(pillRows(b.list, []).filter((r) => r.kind === 'more').length, 0);
});

test('today\'s fixture board has no pills: the panel is the three built-ins, and nothing says next', () => {
  const b = boardOf('fixture');
  assert.deepStrictEqual(b.config.pills, []);
  assert.deepStrictEqual(describe(pillRows(b.list, [])), CASES.fixture.labels);
  assert.ok(!b.list.some((p) => /next/i.test(p.label)));
});

test('the scenario does not wait on a fixed sleep, and presses its Shift+click through the runner\'s own click', () => {
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
  assert.ok(/modifiers: 8/.test(code), 'Shift');
});

test('the ids and classes the scenario drives are in the page the panel is drawn on', () => {
  const web = path.join(__dirname, '..', 'web');
  const page = ['app.html', 'search-panel.js', 'app.css'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  for (const name of ['search-panel', 'search-panel-toggle', 'search-pills', 'query-pill', 'query-pill-label', 'query-pill-count', 'query-pill-more', 'project-name']) {
    assert.ok(page.includes(name) || fs.readFileSync(path.join(web, 'app.js'), 'utf8').includes(name), `${name} is in the page`);
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
  assert.ok(page.includes('data-pill-key') || page.includes('dataset.pillKey'));
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in
// one fails here, and what it reads back is answered the way a browser would for the
// scenario's own reads. Whether each check holds is for the browser to say.
function standIn({ panelStartsShut = false, switchOff = false } = {}) {
  const log = { exprs: [], bad: [], checks: [], opened: [], clicks: 0, modifiers: [], centred: [], focused: 0 };
  let panelUp = !panelStartsShut;
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 120)}`); }
  };
  const plan = boardOf('plan');
  const liveIds = plan.live.map((c) => c.id);
  const answer = (expr) => {
    if (panelStartsShut && /^!document\.getElementById\('search-panel'\)\.classList/.test(expr)) return panelUp;
    if (panelStartsShut && /getElementById\('search-panel-toggle'\)\.getAttribute\('aria-pressed'\)==='false'$/.test(expr)) return switchOff;
    if (panelStartsShut && /getElementById\('search-input'\)\.focus\(\)$/.test(expr)) { log.focused++; panelUp = !switchOff; return true; }
    if (/^\[\.\.\.new Set\(\[\.\.\.document\.querySelectorAll\('#board \.card-el'\)\]/.test(expr)) return liveIds;
    if (/^JSON\.stringify\(Object\.fromEntries/.test(expr)) return JSON.stringify(CASES.counts);
    if (/^\[\.\.\.document\.querySelectorAll\('#search-pills > \*'\)\]\.map\(\(b\)=>b\.dataset\.pillKey\)$/.test(expr)) return ['blocked', 'review', 'waiting', 'value:tags:grill', 'more:tags'];
    if (/querySelectorAll\('#search-pills > \*'\)\]\.map/.test(expr)) return CASES.closed;
    if (/^\(\(\)=>\{const b=/.test(expr) && /getBoundingClientRect/.test(expr)) return { x: 10, y: 10 };
    if (/getBoundingClientRect/.test(expr)) return true;
    if (/fetch\('\/api\/cards\//.test(expr)) return 200;
    if (/getElementById\('search-input'\)\.value$/.test(expr)) return '';
    return true;
  };
  return {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    open: async (p, key) => { log.opened.push([key || 'plan', p]); panelUp = !panelStartsShut; },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async (selector) => { log.centred.push(selector); return { x: 10, y: 10 }; },
    click: async (x, y, extra = {}) => { log.clicks++; log.modifiers.push(extra.modifiers || 0); if (panelStartsShut && switchOff) panelUp = true; },
    check: (name, ok) => log.checks.push([name, ok]),
  };
}

test('run once against a stand-in page the scenario finishes, and every expression it sends to the page parses', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.bad, [], 'an expression the scenario sends does not parse');
  assert.ok(page.log.exprs.length > 100, 'it sends the page a lot of expressions');
  assert.ok(page.log.checks.length >= 50, `only ${page.log.checks.length} checks`);
  const names = page.log.checks.map(([n]) => n);
  assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a check name used twice');
});

test('it loads the plan board cold, and then the malformed board and the fixture board, each from its own address', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.opened, [['plan', '/'], ['malformed', '/'], ['fixture', '/']]);
});

test('it clicks every board pill in turn, the revealed ones too, and a Shift+click once', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.ok(page.log.clicks >= 2 * 12 + 3 + 4, `${page.log.clicks} clicks: two for each of the twelve pills, three for the more button, four for the grill and next pills`);
  assert.strictEqual(page.log.modifiers.filter((m) => m === 8).length, 1);
  assert.ok(code.includes('[...CASES.own, ...SHOWN_TAGS, ...REST_TAGS]'), 'the loop names the own pills of the board and every tag');
  for (const label of [...CASES.own, ...CASES.shownTags, ...CASES.restTags]) assert.ok(CASES.queries[label] && CASES.counts[label] !== undefined, `${label} has its query and its count`);
});

test('with the switch on, the scenario opens the panel by focusing the box and never clicks the arrow, which would switch the panel off', async () => {
  const page = standIn({ panelStartsShut: true });
  await scenario.run(page);
  assert.deepStrictEqual(page.log.centred.filter((s) => s === '#search-panel-toggle'), []);
  assert.strictEqual(page.log.focused, 3, 'the box is focused once on each of the three boards');
});

test('with the switch off, the scenario clicks the arrow to open the panel, which turns the switch on', async () => {
  const page = standIn({ panelStartsShut: true, switchOff: true });
  await scenario.run(page);
  assert.strictEqual(page.log.centred.filter((s) => s === '#search-panel-toggle').length, 3);
  assert.strictEqual(page.log.focused, 0);
});

test('every check the scenario makes has a name that says what it holds', async () => {
  const page = standIn();
  await scenario.run(page);
  for (const [name] of page.log.checks) assert.ok(name.length > 12 && /[a-z]/.test(name), name);
});

test('the three boards\' checks are all made: the more button, the grill pill, the counts, the poll, the malformed board and the fixture board', async () => {
  const page = standIn();
  await scenario.run(page);
  const names = page.log.checks.map(([n]) => n);
  for (const part of ['"+2 more" reveals', '"fewer" folds them back', 'tags:"grill"', 'hides the grilling card', 'a Shift+click on the next pill', 'poll updates the grill count', 'malformed board\'s panel lists', 'fixture board\'s panel lists only']) {
    assert.ok(names.some((n) => n.includes(part)), part);
  }
});
