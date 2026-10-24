const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const { listActive, listArchived, toJSON } = require('../../plugin/skills/web/scripts/card-store');
const { readConfig } = require('../../plugin/skills/web/scripts/config-store');
const { parseSearchQuery, filterCards } = require('../../plugin/skills/web/web/search');
const { materialize } = require('./browser/boards');
const scenarios = require('./browser/scenarios');
const scenario = require('./browser/scenarios/box-mirror');

// The browser runner's box-mirror scenario only runs in a browser (in CI). What it expects of the plan
// board is held here to the search module over the board's own cards, the in-page expressions it sends are
// all parsed, and the scenario is run once against a stand-in page so a typo in it fails here and not only
// in a slow browser run.

const roots = [];
const planBoard = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-box-mirror-'));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize('plan', dir);
  const live = listActive(dir).map(toJSON);
  return { live, all: live.concat(listArchived(dir).map(toJSON)), ctx: { board: 'plan', hierarchy: readConfig(dir).hierarchy } };
};
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'box-mirror.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { CASES } = scenario;
const matches = (b, query) => filterCards(b.all, parseSearchQuery(query, 'plan'), b.ctx).map((c) => Number(c.id)).sort((a, b2) => a - b2);

test('the scenario is in the runner, on the plan board, with time for its parts', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'box-mirror'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.ok(scenario.timeoutMs >= 60000);
});

test('the cut it types keeps the cards it says among the plan board\'s live cards, and hides the rest', () => {
  const b = planBoard();
  const live = new Set(b.live.map((c) => Number(c.id)));
  const cut = matches(b, CASES.cut.query).filter((id) => live.has(id));
  assert.deepStrictEqual(cut, CASES.cut.cards);
  assert.ok(cut.length > 2 && cut.length < live.size, 'two cards to click inside it, and cards it hides');
});

test('the search it types in the Graph lights the cards it says, and the card it clicks beside it is not one of them', () => {
  const b = planBoard();
  const live = new Set(b.live.map((c) => Number(c.id)));
  assert.deepStrictEqual(matches(b, CASES.docs.query).filter((id) => live.has(id)), CASES.docs.lit);
  assert.ok(b.live.length > CASES.docs.lit.length + 3, 'dots remain that the search does not light');
});

test('the ids and controls the scenario drives are in the page', () => {
  const page = ['app.html', 'search-panel.js', 'graph-view.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', f), 'utf8')).join('\n');
  for (const name of ['search-input', 'search-clear-btn', 'search-panel-toggle', 'graph-toggle-btn', 'ctx-add', 'graph-dot', 'graph-near']) {
    assert.ok(page.includes(name) || fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'graph-model.js'), 'utf8').includes(name), `${name} is in the page`);
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
});

test('the scenario does not wait on a fixed sleep, presses Escape through the runner\'s key helper, and clicks with the real modifiers', () => {
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
  assert.ok(/key\('Escape'\)/.test(code));
  assert.ok(/modifiers: 2/.test(code) && /modifiers: 8/.test(code), 'Ctrl is 2 and Shift is 8');
  assert.ok(!/dispatchEvent|new KeyboardEvent/.test(code), 'no hand-made key event');
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in one fails here,
// and the pages it opens, the keys it presses and the text it types are logged. Whether each check holds
// is for the browser to say.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], keys: [], clicks: [], inserted: [], rightClicks: [], order: [] };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 140)}`); }
  };
  const answer = (expr) => {
    if (/^JSON\.stringify\(\[\.\.\.new Set\(/.test(expr)) return '[1,2,3,4]';
    if (/^\[\.\.\.new Set\(\[\.\.\.document\.querySelectorAll\('\.graph-node'\)\]/.test(expr)) return [3, 4, 5, 6, 7, 8];
    if (/^\(\(\)=>\{const s=selectionState\.selection/.test(expr)) return { anchor: 'card:', additions: [] };
    return true;
  };
  return {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    send: async (method, params) => { log.exprs.push(`send ${method}`); if (method === 'Input.insertText') { log.inserted.push(params.text); log.order.push('type'); } return params; },
    mouse: async (type) => { log.order.push(`mouse ${type}`); },
    open: async (p) => { log.opened.push(p); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    click: async (x, y, extra) => { log.clicks.push(extra || {}); },
    rightClick: async (sel) => { log.rightClicks.push(sel); },
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

test('it loads the Board and then the Graph cold, types the cut and the Graph search, and right-clicks one card', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.opened, ['/?view=board', '/?view=graph']);
  assert.deepStrictEqual(page.log.inserted, [CASES.cut.query, CASES.docs.query]);
  assert.strictEqual(page.log.rightClicks.length, 1);
  const ctrl = page.log.clicks.filter((c) => c.modifiers === 2).length;
  const shift = page.log.clicks.filter((c) => c.modifiers === 8).length;
  assert.ok(ctrl >= 8 && shift >= 2, `Ctrl+clicks ${ctrl}, Shift+clicks ${shift}`);
  assert.ok(page.log.keys.filter((k) => k === 'Escape').length === 4, 'the card, two Board steps, one Graph step');
});

test('the pointer leaves the dot it clicked before the Graph search is typed, so no hover lights over the search', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.order, ['type', 'mouse mouseMoved', 'type']);
  assert.ok(page.log.exprs.some((e) => /hoveredId===null/.test(e)), 'it waits for the hover to clear');
});

test('it covers every behaviour listed at its head, each by a check of its own', async () => {
  const page = standIn();
  await scenario.run(page);
  const names = page.log.checks.map(([n]) => n);
  for (const part of [
    'a Ctrl+click on the Board shows the card in the box, and isolate stays off',
    'the next Ctrl+click adds its card as an alternative',
    'the parts are the cards the clicks made, not a typed search',
    'a Ctrl+click on a picked card takes it out, and the box shows what is left',
    'and writes nothing to the box',
    'the last card taken out empties the box',
    'a slice: cut typed in the box hides the Board down to its cards',
    'and the next adds its card, the cut kept after both',
    'taking both out leaves the box its cut alone',
    'Add to selection from a card\'s menu shows the card in the box',
    'the first Esc drops the addition and the box follows',
    'the next Esc drops the anchor and the box is empty',
    'a plain click on a dot shows the card in the box, with isolate off',
    'Shift+click adds the next card as an alternative, and every part is a card',
    'Ctrl+click on a picked dot takes it out, and the box shows what is left',
    'Shift+click on it writes the card beside the query, which stays the typed anchor',
    'leaving the Graph writes the card picked beside the search alone, and the search stays behind',
  ]) assert.ok(names.some((n) => n.includes(part)), part);
});
