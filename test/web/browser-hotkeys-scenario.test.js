const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { HOTKEYS, hotkeyRows } = require('../../plugin/skills/web/web/hotkeys');
const scenarios = require('./browser/scenarios');
const scenario = require('./browser/scenarios/hotkeys');

// The browser runner's hotkeys scenario only runs in a browser (in CI). What it expects of the
// page is held here to hotkeys.js, the in-page expressions it sends are all parsed, and the
// scenario is run once against a stand-in page so a typo in it fails here and not only in a slow
// browser run.

const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'hotkeys.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const { CASES } = scenario;
const stateOf = (rows, id) => rows.find((r) => r.id === id).state;

test('the scenario is in the runner, on the plan board, with time for its steps', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'hotkeys'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.ok(scenario.timeoutMs >= 60000);
});

test('the states it expects after the keys are what the list reads for those states, and names all is the l key\'s first step', () => {
  const rows = hotkeyRows({ pills: ['blocked'], isolate: true, panelOnFocus: false });
  for (const [id, text] of Object.entries(CASES.afterKeys)) assert.strictEqual(stateOf(rows, id), text, id);
  assert.strictEqual(stateOf(hotkeyRows({ names: 'all' }), 'names'), CASES.names);
  const { GRAPH_FAN_OPTION_VALUES } = require('../../plugin/skills/web/web/graph-model');
  const values = GRAPH_FAN_OPTION_VALUES.names;
  assert.strictEqual(values[1], 'all', 'relevant, then all');
});

test('the scenario does not wait on a fixed sleep', () => {
  assert.ok(!/\bsleep\(/.test(code));
  assert.ok(!/setTimeout/.test(code));
});

test('the ids the scenario drives are in the page', () => {
  const web = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
  const page = ['app.html', 'hotkeys-sheet.js', 'app.css', 'app.js', 'search-panel.js', 'isolate.js'].map((f) => fs.readFileSync(path.join(web, f), 'utf8')).join('\n');
  for (const name of ['prefs-sheet', 'prefs-btn', 'hotkeys-list', 'hotkey-row', 'hotkey-key', 'hotkey-what', 'hotkey-state', 'prefs-hotkeys-title', 'prefs-panel-on-focus', 'search-panel-toggle', 'isolate-switch', 'graph-toggle-btn', 'notif-btn', 'search-input', 'search-clear-btn', 'detail-modal', 'context-menu', 'notif-modal']) {
    assert.ok(page.includes(name), `${name} is in the page`);
    assert.ok(code.includes(name), `${name} is driven by the scenario`);
  }
});

// A stand-in for the page: every expression the scenario sends is parsed, so a typo in one
// fails here, and the keys it presses are logged. Whether each check holds is for the browser.
function standIn() {
  const log = { exprs: [], bad: [], checks: [], opened: [], keys: [], clicks: 0 };
  const parse = (expr) => {
    try { new vm.Script(`(${expr})`); } catch (e) { log.bad.push(`${e.message}: ${String(expr).slice(0, 120)}`); }
  };
  const answer = (expr) => {
    if (/\.map\(\(r\)=>r\.dataset\.hotkey\)$/.test(expr)) return HOTKEYS.map((h) => h.id);
    if (/\.map\(\(r\)=>\{const w=r\.querySelector\('\.hotkey-what'\)/.test(expr)) return HOTKEYS.map((h) => h.what);
    if (/^\(\(\)=>\{const o=\{\};for\(const r of/.test(expr)) return { ...CASES.defaults };
    if (/window\.__keyLog\|\|\[\]/.test(expr) && /return l\.length/.test(expr)) return { key: '?', prevented: false };
    if (/match\(\/\(\?:\^\|\\s\)slice:/.test(expr)) return '..4';
    return true;
  };
  return {
    log,
    ev: async (expr) => { log.exprs.push(expr); parse(expr); return answer(expr); },
    open: async (p) => { log.opened.push(p); },
    waitFor: async (expr) => { log.exprs.push(expr); parse(expr); return true; },
    centre: async () => ({ x: 10, y: 10 }),
    click: async () => { log.clicks++; },
    key: async (name, mods = {}) => { log.keys.push([name, mods]); },
    rightClick: async () => true,
    check: (name, ok) => log.checks.push([name, ok]),
  };
}

test('run once against a stand-in page the scenario finishes, and every expression it sends to the page parses', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.bad, [], 'an expression the scenario sends does not parse');
  assert.ok(page.log.exprs.length > 60, 'it sends the page a lot of expressions');
  const names = page.log.checks.map(([n]) => n);
  assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'a check name used twice');
  for (const n of names) assert.ok(n.length > 12 && /[a-z]/.test(n), n);
});

test('it presses ? as Shift with the slash key, as a US keyboard does, and never as a bare ?', async () => {
  const page = standIn();
  await scenario.run(page);
  const questions = page.log.keys.filter(([k]) => k === '?');
  assert.ok(questions.length >= 8, 'the sheet is opened by it, then it is tried where it does nothing');
  for (const [, mods] of questions) assert.deepStrictEqual(mods, { shift: true });
});

test('it makes these checks: the sheet opens on its Hotkeys page, the list, the states, and the places ? does nothing', async () => {
  const page = standIn();
  await scenario.run(page);
  const names = page.log.checks.map(([n]) => n);
  for (const part of [
    'opens the preferences sheet', 'heading inside the sheet',
    'one row for each entry of the list', 'shows its default', 'with the sheet up, ? does nothing', 'with focus in the search box, ? is typed',
    'with a dialog up, ? does nothing', 'with a card menu up, ? does nothing', 'with the notifications panel up, ? does nothing',
    'the sheet shows the names the Graph now draws', 'still shows the names the board kept',
    'shows the panel switched off, the pill on, the cut and isolate off', 'the sheet shows isolate on',
    'changes its row at once', 'changes the row back',
  ]) assert.ok(names.some((n) => n.includes(part)), part);
});

test('it loads the plan board cold, then by a card\'s address, then twice more', async () => {
  const page = standIn();
  await scenario.run(page);
  assert.deepStrictEqual(page.log.opened, ['/', '/?card=5', '/', '/', '/']);
});
