const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { assertKeepsSelection } = require('./helpers/markers');
const { selectionGlobals } = require('./helpers/selection-globals');

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('app.js');
const html = read('app.html');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

const fakeBox = () => {
  const classes = new Set(['hidden']);
  return {
    innerHTML: '',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => { if (force === undefined ? !classes.has(c) : force) classes.add(c); else classes.delete(c); return classes.has(c); },
      contains: (c) => classes.has(c),
    },
    querySelectorAll: () => [],
  };
};

const cards = () => [
  { id: '1', parent: null, status: 'doing', archived: false },
  { id: '2', parent: 1, status: 'done', archived: false },
  { id: '3', parent: 1, status: 'todo', archived: false },
  { id: '4', parent: 1, status: 'todo', archived: false },
  { id: '9', parent: null, status: 'todo', archived: false },
];

// Every roll-up memo and pref loader/saver app.js defines, whatever it is
// called, so a sandbox runs what the page runs and nothing is stubbed by name.
const rollupState = () => appSrc.match(/^let rollup\w* = null;$/gm) || [];
const rollupPrefs = () => [...appSrc.matchAll(/^function ((?:load|save)Rollup\w*)\(/gm)].map((m) => fn(m[1]));

// The preferences entry the archived-leaves choice lives in: its memo, loader and the one reader a roll-up asks.
const prefsState = () => {
  const memo = appSrc.match(/^let prefsMemo = null;$/m);
  assert.ok(memo, 'the page keeps one memo for the preferences entry');
  return [memo[0], fn('prefsStorage'), fn('loadPrefsState'), fn('countArchivedLeaves')];
};

function detailSandbox({ mode, detailId = null, archivedKey, archivedDone, archivedLeaves = [] } = {}) {
  const colState = require('../web/column-state');
  const stored = {};
  const writes = {};
  if (mode) stored['kanban.kanban.rollup.bar'] = mode;
  if (archivedKey !== undefined) stored['kanban.kanban.rollup.archived'] = archivedKey;
  if (archivedDone !== undefined) stored['kanban.kanban.prefs'] = JSON.stringify({ archivedDone });
  const box = fakeBox();
  const calls = { renderBoard: 0, detail: [] };
  const sandbox = {
    state: { active: cards(), archived: archivedLeaves, projectName: 'kanban', priorities: [], statuses: [] },
    ...colState,
    localStorage: { getItem: (k) => (k in stored ? stored[k] : null), setItem: (k, v) => { writes[k] = v; } },
    $: (sel) => { assert.strictEqual(sel, '#detail-rollup'); return box; },
    renderBoard: () => { calls.renderBoard++; },
    box, calls, writes,
    ...require('../web/prefs'),
    ...require('../web/nesting'),
    ...require('../web/rollup-bar'),
  };
  vm.createContext(sandbox);
  vm.runInContext([...rollupState(), ...prefsState(), `let currentDetailId = ${detailId};`,
    fn('boardStatuses'), ...rollupPrefs(), fn('nestingCtx'), fn('buildNestingIndex'),
    fn('paintRollupBars'), fn('renderDetailRollup'), fn('repaintRollups'), fn('setRollupBarMode'), fn('toggleRollupBar')].join('\n'), sandbox);
  vm.runInContext('renderDetailRollup = ((orig) => (id) => { calls.detail.push(id); return orig(id); })(renderDetailRollup);', sandbox);
  return sandbox;
}

// --- the detail follows the shared bar mode -------------------------------------------

test('with the bar mode collapsed the detail shows the thin bar without numbers', () => {
  const s = detailSandbox({ mode: 'collapsed' });
  s.renderDetailRollup(1);
  assert.match(s.box.innerHTML, /rollup-bar thin/);
  assert.doesNotMatch(s.box.innerHTML, /rollup-counts|rollup-total/);
  assert.strictEqual(s.box.classList.contains('hidden'), false);
  assert.strictEqual(s.box.classList.contains('detail-rollup--collapsed'), true);
});

test('with the bar mode open the detail shows the bar and its numbers', () => {
  const s = detailSandbox({ mode: 'open' });
  s.renderDetailRollup(1);
  assert.match(s.box.innerHTML, /<div class="rollup-bar">/);
  assert.match(s.box.innerHTML, /<b class="rollup-total">3<\/b>/);
  assert.strictEqual(s.box.classList.contains('detail-rollup--collapsed'), false);
});

test('with nothing saved the detail is collapsed, the same default as a tile', () => {
  const s = detailSandbox();
  s.renderDetailRollup(1);
  assert.match(s.box.innerHTML, /rollup-bar thin/);
});

test('archived leaves count as done in the detail, and its scope line says so, whatever an older visit stored', () => {
  const archivedLeaves = [{ id: '5', parent: 1, status: 'done', archived: true }];
  for (const archivedKey of [undefined, 'false', 'true']) {
    const s = detailSandbox({ mode: 'open', archivedKey, archivedLeaves });
    s.renderDetailRollup(1);
    assert.match(s.box.innerHTML, /<b class="rollup-total">4<\/b>/, `stored ${archivedKey}`);
    assert.match(s.box.innerHTML, /<span class="rollup-count">2 done<\/span>/, `stored ${archivedKey}`);
    assert.match(s.box.innerHTML, /Archived leaves count as done\./, `stored ${archivedKey}`);
    assert.doesNotMatch(s.box.innerHTML, /left out/, `stored ${archivedKey}`);
  }
});

test('with archived leaves counted as done switched off in the preferences, the detail leaves them out, and its scope line says so', () => {
  const archivedLeaves = [{ id: '5', parent: 1, status: 'done', archived: true }];
  const s = detailSandbox({ mode: 'open', archivedDone: false, archivedLeaves });
  s.renderDetailRollup(1);
  assert.match(s.box.innerHTML, /<b class="rollup-total">3<\/b>/);
  assert.match(s.box.innerHTML, /<span class="rollup-count">1 done<\/span>/);
  assert.match(s.box.innerHTML, /Archived leaves are left out\./);
  assert.doesNotMatch(s.box.innerHTML, /Archived leaves count as done/);
});

test('switched back on, the detail counts archived leaves again and its scope line says so', () => {
  const archivedLeaves = [{ id: '5', parent: 1, status: 'done', archived: true }];
  const s = detailSandbox({ mode: 'open', archivedDone: true, archivedLeaves });
  s.renderDetailRollup(1);
  assert.match(s.box.innerHTML, /<b class="rollup-total">4<\/b>/);
  assert.match(s.box.innerHTML, /Archived leaves count as done\./);
});

test('a leaf has no roll-up block, whatever the setting', () => {
  const s = detailSandbox({ mode: 'open' });
  s.renderDetailRollup(9);
  assert.strictEqual(s.box.innerHTML, '');
  assert.strictEqual(s.box.classList.contains('hidden'), true);
});

// --- clicking a bar flips the one shared setting ----------------------------------

test('toggleRollupBar flips collapsed to open and back, saving each choice', () => {
  const s = detailSandbox({ mode: 'collapsed' });
  s.toggleRollupBar();
  assert.deepStrictEqual(s.writes, { 'kanban.kanban.rollup.bar': 'open' });
  assert.strictEqual(vm.runInContext('loadRollupBarMode()', s), 'open');
  s.toggleRollupBar();
  assert.deepStrictEqual(s.writes, { 'kanban.kanban.rollup.bar': 'collapsed' });
  assert.strictEqual(vm.runInContext('loadRollupBarMode()', s), 'collapsed');
});

test('toggleRollupBar repaints every bar on the board, and the open detail too', () => {
  const closed = detailSandbox({ mode: 'collapsed' });
  closed.toggleRollupBar();
  assert.strictEqual(closed.calls.renderBoard, 1);
  assert.deepStrictEqual(closed.calls.detail, [], 'no detail open, nothing to repaint');
  const open = detailSandbox({ mode: 'collapsed', detailId: 1 });
  open.toggleRollupBar();
  assert.strictEqual(open.calls.renderBoard, 1);
  assert.deepStrictEqual(open.calls.detail, [1]);
  assert.match(open.box.innerHTML, /<b class="rollup-total">3<\/b>/, 'the detail now shows the open bar');
});

test('a saved off flips to open on the first click, since it was reading as collapsed', () => {
  const s = detailSandbox({ mode: 'off' });
  s.toggleRollupBar();
  assert.deepStrictEqual(s.writes, { 'kanban.kanban.rollup.bar': 'open' });
});

// --- the click grammar ------------------------------------------------------------

function sharedClickHandler() {
  const m = appSrc.match(/document\.addEventListener\('click', \(e\) => \{\n    if \(e\.target\.closest\('\.rollup'\)[\s\S]*?\n  \}\);/);
  assert.ok(m, 'the shared card click handler opens with a roll-up check');
  return m[0];
}

// The selection the handler decides over and the steps that carry its decision
// out, exactly as the page defines them: the click handler is a thin caller.
const pageLine = (name) => {
  const m = appSrc.match(new RegExp(`^let ${name} = .*;$`, 'm'));
  assert.ok(m, `the page declares ${name}`);
  return m[0];
};
const selectionSteps = () => [pageLine('selectionState'), pageLine('selectedIds'), fn('setSelection'), fn('selectByClick'), fn('moveSelectionTo'), fn('applyCardClick'), fn('searchByCue')].join('\n');

function clickHarness() {
  const listeners = [];
  const calls = { toggle: 0, open: [] };
  const sandbox = {
    document: { addEventListener: (type, f) => listeners.push([type, f]) },
    ...selectionGlobals(),
    $: () => ({ value: '' }),
    writeSearch() {},
    visibleCardIds: () => [],
    loadViewMode: () => 'board',
    loadPrefsState: () => ({ click: {} }),
    state: { active: [], archived: [] },
    toggleRollupBar: () => { calls.toggle++; },
    openCard: (id) => { calls.open.push(id); },
    renderBoard: () => {},
    calls,
  };
  vm.createContext(sandbox);
  vm.runInContext(`${selectionSteps()}\nsetSelection(cardsSelection([5]), 5);\n${sharedClickHandler()}`, sandbox);
  assert.strictEqual(listeners.length, 1);
  return { click: listeners[0][1], sandbox };
}

const clickOn = (matches) => ({
  target: { closest: (sel) => matches[sel] || null },
  shiftKey: false, ctrlKey: false, metaKey: false,
});

test('clicking a roll-up bar on a card flips the setting and does not open the card', () => {
  const { click, sandbox } = clickHarness();
  const tile = { dataset: { id: '1' } };
  click(clickOn({ '.rollup': {}, '.card-el': tile }));
  assert.strictEqual(sandbox.calls.toggle, 1);
  assert.deepStrictEqual(sandbox.calls.open, []);
});

test('clicking a roll-up bar in the card detail flips the setting too', () => {
  const { click, sandbox } = clickHarness();
  click(clickOn({ '.rollup': {} }));
  assert.strictEqual(sandbox.calls.toggle, 1);
});

test('clicking the rest of the card still opens it', () => {
  const { click, sandbox } = clickHarness();
  click(clickOn({ '.card-el': { dataset: { id: '1' } } }));
  assert.strictEqual(sandbox.calls.toggle, 0);
  assert.deepStrictEqual(sandbox.calls.open, ['1']);
});

test('a click on a roll-up bar keeps a building multi-selection', () => {
  assert.match(fn('onClickAway'), /if \(e\.target\.closest\('\[data-keeps-selection\]'\)\) return;/, 'a marked control returns early');
  assert.match(appSrc, /document\.addEventListener\('click', onClickAway\);/, 'the click-away handler is registered');
  assertKeepsSelection(['.rollup', '#graph-toggle-btn', '.graph-control'], 'the bar itself is exempt, not only the header controls');
});

test('the bar looks clickable and its hit area is taller than the thin line', () => {
  const css = read('app.css');
  const rule = css.match(/\n\.rollup \{([^}]*)\}/);
  assert.ok(rule, '.rollup rule exists');
  assert.match(rule[1], /cursor:\s*pointer/);
  assert.match(rule[1], /padding:\s*3px 0/);
});

// --- layout -----------------------------------------------------------------------

test('the detail puts the roll-up under the thread and the children right under the roll-up, above the fields', () => {
  const at = (id) => html.indexOf(`id="${id}"`);
  const [header, thread, rollup, fields, body, children] = [
    html.indexOf('class="detail-header popup-header"'), at('detail-thread'), at('detail-rollup'), at('detail-frontmatter'), at('detail-body'), at('detail-children'),
  ];
  assert.ok([header, thread, rollup, fields, body, children].every((n) => n !== -1), 'every block exists');
  assert.ok(header < thread && thread < rollup && rollup < children && children < fields && fields < body);
});

test('the collapsed detail block drops the framed box so the bar costs a few pixels', () => {
  const css = read('app.css');
  const rule = css.match(/\n\.detail-rollup--collapsed \{([^}]*)\}/);
  assert.ok(rule, 'a collapsed variant exists');
  assert.match(rule[1], /padding:\s*0/);
  assert.match(rule[1], /border:\s*0|border:\s*none/);
  assert.doesNotMatch(rule[1], /#[0-9a-fA-F]{3,8}\b/);
});

test('a ctrl, cmd or shift click on a bar is left to multi-select, not the bar toggle', () => {
  for (const key of ['ctrlKey', 'metaKey', 'shiftKey']) {
    const { click, sandbox } = clickHarness();
    const e = clickOn({ '.rollup': {}, '.card-el': { dataset: { id: '1' } } });
    e[key] = true;
    try { click(e); } catch (_) { /* the selection grammar may reach globals this harness does not stub */ }
    assert.strictEqual(sandbox.calls.toggle, 0, key);
  }
});

// The shared click handler wired to the real toggle, repaint and storage, with
// only the drawing stubbed: the whole path from a click on a bar to the saved mode.
function flipSandbox({ mode, detailId = null } = {}) {
  const s = detailSandbox({ mode, detailId });
  const listeners = [];
  s.flip = { columns: 0, views: 0, opened: [] };
  Object.assign(s, {
    document: { addEventListener: (type, f) => listeners.push([type, f]) },
    ...selectionGlobals(),
    visibleCardIds: () => [],
    loadViewMode: () => 'board',
    openCard: (id) => { s.flip.opened.push(id); },
    renderBoardColumns: () => { s.flip.columns++; },
    applyViewMode: () => { s.flip.views++; },
    computeSearchMatch: () => ({ terms: [], ids: null }),
    renderSearchPanel: () => {},
  });
  vm.runInContext([selectionSteps(), fn('renderBoard'), sharedClickHandler()].join('\n'), s);
  assert.strictEqual(listeners.length, 1);
  s.click = listeners[0][1];
  return s;
}

const onBar = () => clickOn({ '.rollup': {}, '.card-el': { dataset: { id: '1' } } });

test('a click on a bar flips every bar, saves the mode per board and repaints the board and the open detail', () => {
  const s = flipSandbox({ mode: 'collapsed', detailId: 1 });
  s.click(onBar());
  assert.deepStrictEqual(s.writes, { 'kanban.kanban.rollup.bar': 'open' });
  assert.deepStrictEqual(s.flip, { columns: 1, views: 1, opened: [] });
  assert.deepStrictEqual(s.calls.detail, [1]);
  assert.match(s.box.innerHTML, /<b class="rollup-total">3<\/b>/, 'the detail now shows the open bar');
  s.click(onBar());
  assert.deepStrictEqual(s.writes, { 'kanban.kanban.rollup.bar': 'collapsed' });
  assert.deepStrictEqual(s.flip, { columns: 2, views: 2, opened: [] });
  assert.match(s.box.innerHTML, /rollup-bar thin/, 'and back to the thin bar');
});

test('a click on a bar with no detail open repaints only the board, and the flip survives a reload', () => {
  const s = flipSandbox({ mode: 'open' });
  s.click(onBar());
  assert.deepStrictEqual(s.writes, { 'kanban.kanban.rollup.bar': 'collapsed' });
  assert.deepStrictEqual(s.flip, { columns: 1, views: 1, opened: [] });
  assert.deepStrictEqual(s.calls.detail, []);
  const reloaded = detailSandbox({ mode: s.writes['kanban.kanban.rollup.bar'] });
  reloaded.renderDetailRollup(1);
  assert.match(reloaded.box.innerHTML, /rollup-bar thin/);
});

test('the bar mode has one setter, called only by the click toggle and by the preferences sheet', () => {
  const sets = [...appSrc.matchAll(/\brollupBarMode = ([^;]*);/g)].map((m) => m[1]);
  assert.deepStrictEqual(sets.sort(), ['mergeRollupBar(mode)', 'mergeRollupBar(saved)', 'null', 'null']);
  const callers = [...appSrc.matchAll(/function (\w+)\([^)]*\) \{[^]*?\n\}/g)]
    .filter((m) => m[1] !== 'setRollupBarMode' && /\bsetRollupBarMode\(/.test(m[0])).map((m) => m[1]);
  assert.deepStrictEqual(callers.sort(), ['onPrefsSheetClick', 'toggleRollupBar']);
});
