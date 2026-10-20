const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive, listArchived, toJSON } = require('../scripts/card-store');
const { readConfig } = require('../scripts/config-store');
const { parseSearchQuery, filterCards, searchSetSlice } = require('../web/search');
const { sliceCards } = require('../web/slices');
const { depthMap } = require('../web/nesting');
const { typeIconGlyph, typeIconOf } = require('../web/type-icons');
const { panelChip } = require('../web/pills');
const { sliceListOf, sliceRunOf, sliceRunClick, sliceRunKeep, sliceRunStep, sliceRunValue, sliceEntryKey, sliceEntryName } = require('../web/slice-run');
const { materialize } = require('./browser/boards');
const scenarios = require('./browser/scenarios');
const section = require('./browser/scenarios/slice-section');

// The browser runner's slice-section scenario only runs in a browser (in CI). What it
// expects of each board is held here to the slices module, the run arithmetic and the
// search module over the board's own cards and the config the board's own reader gives the
// page, the in-page expressions it sends are all parsed, and the scenario is run once
// against a stand-in page so a typo in it fails here and not only in a slow browser run.

const roots = [];
const load = (key) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-slice-section-${key}-`));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const live = listActive(dir).map(toJSON);
  const config = readConfig(dir);
  const all = live.concat(listArchived(dir).map(toJSON));
  const ctx = { board: config.name || key, hierarchy: config.hierarchy, priorities: config.priorities };
  const sliced = sliceCards(all, config.hierarchy, depthMap(all, ctx));
  return { live, all, config, ctx, sliced, list: sliceListOf(sliced, live.map((c) => c.id)) };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const sorted = (list) => [...list].map(Number).sort((a, b) => a - b);
const idsOf = (b, query) => sorted(filterCards(b.all, parseSearchQuery(query, b.ctx.board), b.ctx).map((c) => c.id).filter((id) => b.live.some((c) => c.id === id)));
const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'slice-section.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('the scenario is in the runner, on the plan board, with the fixture and malformed boards beside it, and time for its drives', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'slice-section'), section);
  assert.strictEqual(section.board, 'plan');
  assert.deepStrictEqual(section.alsoBoards, ['fixture', 'malformed']);
  assert.ok(section.timeoutMs >= 60000 && section.timeoutMs <= 120000);
});

// --- the plan board's list -----------------------------------------------------------------------

test('on the plan board the section lists the four tiers in hierarchy order, then the depths, with the counts, icons and cards the scenario says', () => {
  const b = load('plan');
  const { plan } = section.CASES;
  assert.deepStrictEqual(b.config.hierarchy, ['goal', 'strategy', 'objective', 'epic']);
  assert.deepStrictEqual(sorted(b.live.map((c) => c.id)), plan.live);
  assert.deepStrictEqual(b.list.map((e) => e.label), plan.labels);
  assert.deepStrictEqual(b.list.map((e) => e.count), plan.counts);
  assert.deepStrictEqual(b.list.map(sliceEntryKey), plan.keys);
  assert.deepStrictEqual(b.list.map((e) => (e.kind === 'tier' ? typeIconGlyph(typeIconOf(e.name, b.config.types)) : '')), plan.icons);
  for (const entry of b.list) {
    assert.deepStrictEqual(sorted(b.live.filter((c) => b.sliced.byId.get(String(c.id)).index === entry.index).map((c) => c.id)), plan.cards[entry.label], entry.label);
    assert.strictEqual(plan.cards[entry.label].length, entry.count, `${entry.label}: the count is the number of cards the Board shows for it`);
  }
});

test('every entry\'s card list is the cards the search module finds for the term that keeps only that slice', () => {
  const b = load('plan');
  const { plan } = section.CASES;
  for (const [at, entry] of b.list.entries()) {
    const term = `slice:${sliceRunValue(b.list, sliceRunKeep(at))}`;
    assert.deepStrictEqual(idsOf(b, term), plan.cards[entry.label], `${entry.label} as ${term}`);
  }
});

test('each step of clicks and right-clicks writes the term and shows the cards the scenario says, and presses as many entries', () => {
  const b = load('plan');
  const { plan } = section.CASES;
  let run = { from: 0, to: b.list.length - 1 };
  for (const step of plan.steps) {
    const at = b.list.findIndex((e) => sliceEntryKey(e) === step.key);
    assert.ok(at >= 0, step.name);
    run = step.gesture === 'click' ? sliceRunClick(b.list, run, at) : sliceRunKeep(at);
    const value = sliceRunValue(b.list, run);
    assert.strictEqual(value ? `slice:${value}` : '', step.term, step.name);
    assert.deepStrictEqual(idsOf(b, step.term), step.shows, `${step.name}: ${step.term}`);
    assert.strictEqual(run.to - run.from + 1, step.pressed, `${step.name}: entries pressed`);
    assert.deepStrictEqual(sliceRunOf(b.sliced, b.list, step.term ? [value] : []), run, `${step.name}: the term reads back`);
  }
  assert.ok(plan.steps.some((s) => s.gesture === 'right-click') && plan.steps.some((s) => s.term === ''));
  assert.ok(plan.steps.every((s) => s.shows.length < plan.live.length || s.term === '' || s.shows.length === plan.live.length));
});

test('the step that clicks inside the run changes neither the term nor the cards', () => {
  const { plan } = section.CASES;
  const at = plan.steps.findIndex((s) => s.key === 't:objective');
  assert.ok(at > 0);
  assert.strictEqual(plan.steps[at].term, plan.steps[at - 1].term);
  assert.deepStrictEqual(plan.steps[at].shows, plan.steps[at - 1].shows);
});

test('a term typed by hand presses the entries the scenario says, and each entry\'s name says whether it is in the run', () => {
  const b = load('plan');
  const { typed, labels, counts } = section.CASES.plan;
  const run = sliceRunOf(b.sliced, b.list, [typed.query.replace(/^slice:/, '')]);
  const pressed = b.list.filter((e, i) => i >= run.from && i <= run.to).map((e) => e.label);
  assert.deepStrictEqual(pressed, typed.pressed);
  const named = b.list.map((e, i) => sliceEntryName(e, i >= run.from && i <= run.to));
  assert.ok(named.includes(typed.inName) && named.includes(typed.outName));
  assert.deepStrictEqual(sliceRunOf(b.sliced, b.list, [typed.unknown.replace(/^slice:/, '')]), { from: 0, to: b.list.length - 1 }, 'an unknown name is every entry');
  assert.deepStrictEqual(idsOf(b, typed.unknown), section.CASES.plan.live, 'and cuts nothing');
  assert.strictEqual(labels.length, counts.length);
});

test('the context-menu key and Shift+F10 keep only the entry they are on', () => {
  const b = load('plan');
  const { menuKey, shiftF10 } = section.CASES.plan;
  for (const k of [menuKey, shiftF10]) {
    const at = b.list.findIndex((e) => sliceEntryKey(e) === k.key);
    const term = `slice:${sliceRunValue(b.list, sliceRunKeep(at))}`;
    assert.strictEqual(term, k.term);
    assert.deepStrictEqual(idsOf(b, term), k.shows);
  }
});

test('Enter and Space on the top entry drop it from a run of every slice and grow it back', () => {
  const b = load('plan');
  const { keyboard } = section.CASES.plan;
  const at = b.list.findIndex((e) => sliceEntryKey(e) === keyboard.enterKey);
  const full = { from: 0, to: b.list.length - 1 };
  const dropped = sliceRunClick(b.list, full, at);
  assert.strictEqual(`slice:${sliceRunValue(b.list, dropped)}`, keyboard.afterEnter);
  assert.strictEqual(sliceRunValue(b.list, sliceRunClick(b.list, dropped, at)), keyboard.afterSpace);
});

test('the keys move the ends of the run objective..epic as the scenario says, on the cards it says, and the dated cards come in with depth 0', () => {
  const b = load('plan');
  const { sweep } = section.CASES.plan;
  const start = sweep.start.replace(/^slice:/, '');
  let run = sliceRunOf(b.sliced, b.list, [start]);
  assert.deepStrictEqual(idsOf(b, sweep.start), sweep.before);
  run = sliceRunStep(b.list, run, ']');
  assert.strictEqual(`slice:${sliceRunValue(b.list, run)}`, sweep.afterClose.term);
  assert.deepStrictEqual(idsOf(b, sweep.afterClose.term), sweep.afterClose.shows);
  run = sliceRunStep(b.list, run, '{');
  assert.strictEqual(`slice:${sliceRunValue(b.list, run)}`, sweep.afterOpen.term);
  assert.deepStrictEqual(idsOf(b, sweep.afterOpen.term), sweep.afterOpen.shows);
  const dated = (id) => { const c = b.live.find((x) => x.id === String(id)); return !!(c.start_date || c.end_date || c.due_date); };
  assert.deepStrictEqual(b.live.filter((c) => dated(c.id)).map((c) => Number(c.id)).sort((x, y) => x - y), sweep.dated, 'two dated cards on the board');
  assert.ok(sweep.dated.every((id) => idsOf(b, sweep.afterClose.term).includes(id)), 'both are in the run after ]');
  assert.ok(sweep.dated.every((id) => !idsOf(b, sweep.start).includes(id)), 'neither is in it before');
  assert.strictEqual(run.to - run.from + 1, 4, 'four entries are pressed after both keys, as the scenario counts');
});

test('the Graph step: the query lights its matches, the run set from the section is written around it, and only the run\'s cards are drawn', () => {
  const b = load('plan');
  const { graph } = section.CASES.plan;
  assert.deepStrictEqual(idsOf(b, graph.query), graph.lit);
  assert.strictEqual(searchSetSlice(graph.query, '0'), graph.term);
  assert.deepStrictEqual(idsOf(b, 'slice:0'), graph.draws);
  assert.deepStrictEqual(idsOf(b, graph.term), graph.lit, 'what the whole query matches is the lit cards');
  assert.ok(graph.draws.length > graph.lit.length && graph.lit.every((id) => graph.draws.includes(id)), 'cards are drawn that do not light');
  assert.ok(graph.draws.length < section.CASES.plan.live.length, 'and cards are left out');
});

test('the chip step: a run on the panel shut is counted and named as the scenario says', () => {
  const { chip } = section.CASES.plan;
  assert.strictEqual(panelChip([`slice ${chip.term.replace(/^slice:/, '')}`]).name, chip.name);
  assert.strictEqual(chip.term, 'slice:goal..epic');
});

// --- the other two boards ------------------------------------------------------------------------

test('today\'s fixture board lists depths only, with the counts the scenario says', () => {
  const b = load('fixture');
  const { fixture } = section.CASES;
  assert.deepStrictEqual(b.config.hierarchy, []);
  assert.deepStrictEqual(b.list.map((e) => e.label), fixture.labels);
  assert.deepStrictEqual(b.list.map((e) => e.count), fixture.counts);
  assert.ok(b.list.every((e) => e.kind === 'depth'));
});

test('the malformed board lists each tier once, then the depths, with the counts and icons the scenario says', () => {
  const b = load('malformed');
  const { malformed } = section.CASES;
  assert.deepStrictEqual(b.config.hierarchy, ['Goal', 'goal', 'Epic', 'EPIC'], 'each tier listed twice, in mixed case');
  assert.deepStrictEqual(b.list.map((e) => e.label), malformed.labels);
  assert.deepStrictEqual(b.list.map((e) => e.count), malformed.counts);
  assert.deepStrictEqual(b.list.map((e) => (e.kind === 'tier' ? typeIconGlyph(typeIconOf(e.name, b.config.types)) : '')), malformed.icons, 'an icon the table does not know draws nothing');
});

// --- the page the scenario drives ---------------------------------------------------------------------

test('the ids, classes and keys the scenario drives are in the page the section is drawn on', () => {
  const web = path.join(__dirname, '..', 'web');
  const page = ['app.html', 'search-slices.js', 'app.css', 'slice-run.js', 'search-panel.js'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  for (const name of ['search-slices', 'search-slices-fold', 'search-panel', 'search-panel-toggle', 'search-pills-fold', 'search-chip', 'prefs-slices-folded', 'slice-entry', 'slice-entry-label', 'slice-entry-count', 'slice-entry-icon', 'notif-btn', 'prefs-btn', 'notif-modal', 'detail-modal', 'context-menu', 'prefs-sheet']) {
    assert.ok(page.includes(name), `${name} is in the page`);
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
  assert.ok(page.includes('dataset.sliceKey') && code.includes('data-slice-key'), 'the entries carry the key the scenario finds them by (dataset.sliceKey is the attribute data-slice-key)');
  for (const entryKey of section.CASES.plan.keys) assert.match(entryKey, /^(t:[a-z]+|d:\d+)$/);
});

test('the scenario drives the real keys: a mouse click and a right-click on the entries, Tab, Enter and Space, the context-menu key, Shift+F10, and each of [ ] { }', () => {
  assert.ok(/clickOn\(entrySel\(entryKey\)\)/.test(code) && /rightClick\(entrySel\(entryKey\)\)/.test(code));
  for (const k of ["key('Tab')", "key('Enter')", "key(' ')", "key('ContextMenu')", "key('F10', { shift: true })", "key(']')", "key('{', { shift: true })", "key('Escape')"]) assert.ok(code.includes(k), k);
});

test('the scenario waits on the page and never on a fixed sleep', () => {
  assert.ok(!/\bsleep\(/.test(code));
});

test('the scenario reads no page global, so a rename in the page cannot break it with an eval error', () => {
  assert.ok(!/\b(selectedIds|selectionState|autoRefreshTick|renderGraphView|graphCur|hoveredId|writeSearch)\b/.test(code));
  assert.ok(!/Page globals this scenario reads/.test(source));
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in one
// fails here, and the reads it uses to branch are answered the way a browser would. Whether
// each check holds is for the browser to say.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], keys: [], clicks: [], rightClicks: [], texts: [] };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 140)}`); }
  };
  const answer = (expr) => {
    if (/dataset\.sliceKey\|\|a\.tagName/.test(expr)) return 'search-slices-fold';
    if (/getElementById\('search-chip'\);return/.test(expr)) return { hidden: false, text: '1', name: '1 on: slice goal..epic' };
    if (/getElementById\('search-input'\)\.value$/.test(expr)) return '';
    return true;
  };
  return {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    send: async (method, params) => { log.texts.push([method, params && params.text]); },
    open: async (p, board) => { log.opened.push([p, board]); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async (sel) => { log.clicks.push(sel); return { x: 10, y: 10 }; },
    click: async () => {},
    key: async (name, mods) => { log.keys.push(mods && mods.shift ? `Shift+${name}` : name); },
    rightClick: async (sel) => { log.rightClicks.push(sel); },
    check: (name, ok) => log.checks.push([name, ok]),
  };
}

test('run once against a stand-in page the scenario finishes, and every expression it sends to the page parses', async () => {
  const page = standIn();
  await section.run(page);
  assert.deepStrictEqual(page.log.bad, [], 'an expression the scenario sends does not parse');
  assert.ok(page.log.exprs.length > 150, 'it sends the page a lot of expressions');
  assert.ok(page.log.checks.length >= 70, `only ${page.log.checks.length} checks`);
  const names = page.log.checks.map(([n]) => n);
  assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a check name used twice');
  for (const n of names) assert.ok(n.length > 12 && /[a-z]/.test(n), n);
});

test('it loads the plan board cold for each view and drive, then the fixture and the malformed board', async () => {
  const page = standIn();
  await section.run(page);
  const boards = page.log.opened.map(([, board]) => board || 'plan');
  assert.deepStrictEqual(boards.filter((b, i) => boards.indexOf(b) === i), ['plan', 'fixture', 'malformed']);
  assert.ok(page.log.opened.some(([url]) => url.startsWith('/?view=calendar')));
  assert.ok(page.log.opened.some(([url]) => url.startsWith('/?view=graph')));
  assert.deepStrictEqual(page.log.opened.filter(([, b]) => b).map(([, b]) => b), ['fixture', 'malformed']);
});

test('it right-clicks every non-empty entry for its count, and each entry of the steps, and clicks the rest with the mouse', async () => {
  const page = standIn();
  await section.run(page);
  const { plan } = section.CASES;
  const sel = (k) => `#search-slices .slice-entry[data-slice-key="${k}"]`;
  for (const [at, k] of plan.keys.entries()) if (plan.cards[plan.labels[at]].length) assert.ok(page.log.rightClicks.includes(sel(k)), k);
  assert.ok(!page.log.rightClicks.includes(sel('d:3')), 'the empty depth has no cards to show');
  for (const step of plan.steps.filter((s) => s.gesture === 'click')) assert.ok(page.log.clicks.includes(sel(step.key)), step.key);
});

test('it presses the keys the criteria name, in the panel open and shut, in both views', async () => {
  const page = standIn();
  await section.run(page);
  const count = (k) => page.log.keys.filter((x) => x === k).length;
  assert.strictEqual(count(']'), 10, 'one ] in each of the four sweeps, the one typed in the box, one under each of the four popups, and the last with everything shut');
  assert.strictEqual(count('Shift+{'), 4 + 1, 'one { in each sweep, and one under the card menu');
  assert.ok(count('Tab') === section.CASES.plan.keys.length + 2);
  assert.strictEqual(count('ContextMenu'), 1);
  assert.strictEqual(count('Shift+F10'), 1);
  assert.strictEqual(count('Enter'), 1);
  assert.strictEqual(count(' '), 1);
  assert.ok(count('Escape') >= 5);
});

test('the Graph step types the query into the box with the runner\'s text input, a real input event', async () => {
  const page = standIn();
  await section.run(page);
  assert.deepStrictEqual(page.log.texts, [['Input.insertText', section.CASES.plan.graph.query]]);
});
