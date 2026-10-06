const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  { id: 1, parent: null, status: 'doing', archived: false },
  { id: 2, parent: 1, status: 'done', archived: false },
  { id: 3, parent: 1, status: 'todo', archived: false },
  { id: 4, parent: 1, status: 'todo', archived: false },
  { id: 9, parent: null, status: 'todo', archived: false },
];

function detailSandbox({ mode, detailId = null } = {}) {
  const colState = require('../web/column-state');
  const stored = {};
  const writes = {};
  if (mode) stored['kanban.kanban.rollup.bar'] = mode;
  const box = fakeBox();
  const calls = { renderBoard: 0, detail: [] };
  const sandbox = {
    state: { active: cards(), archived: [], projectName: 'kanban', priorities: [], statuses: [] },
    storageKey: colState.storageKey,
    mergeRollupBar: colState.mergeRollupBar,
    nextRollupBar: colState.nextRollupBar,
    ROLLUP_BAR_COLLAPSED: colState.ROLLUP_BAR_COLLAPSED,
    mergeRollupCountArchived: colState.mergeRollupCountArchived,
    liveStatuses: colState.liveStatuses,
    localStorage: { getItem: (k) => (k in stored ? stored[k] : null), setItem: (k, v) => { writes[k] = v; } },
    $: (sel) => { assert.strictEqual(sel, '#detail-rollup'); return box; },
    renderBoard: () => { calls.renderBoard++; },
    box, calls, writes,
    ...require('../web/nesting'),
    ...require('../web/rollup-bar'),
  };
  vm.createContext(sandbox);
  vm.runInContext(['let rollupBarMode = null;', 'let rollupCountArchived = null;', `let currentDetailId = ${detailId};`,
    fn('boardStatuses'), fn('loadRollupBarMode'), fn('saveRollupBarMode'), fn('loadRollupCountArchived'), fn('nestingCtx'), fn('buildNestingIndex'),
    fn('paintRollupBars'), fn('renderDetailRollup'), fn('toggleRollupBar')].join('\n'), sandbox);
  vm.runInContext('renderDetailRollup = ((orig) => (id) => { calls.detail.push(id); return orig(id); })(renderDetailRollup);', sandbox);
  return sandbox;
}

// --- the detail follows the Bar setting -------------------------------------------

test('with Bar collapsed the detail shows the thin bar without numbers', () => {
  const s = detailSandbox({ mode: 'collapsed' });
  s.renderDetailRollup(1);
  assert.match(s.box.innerHTML, /rollup-bar thin/);
  assert.doesNotMatch(s.box.innerHTML, /rollup-counts|rollup-total/);
  assert.strictEqual(s.box.classList.contains('hidden'), false);
  assert.strictEqual(s.box.classList.contains('detail-rollup--collapsed'), true);
});

test('with Bar open the detail shows the bar and its numbers', () => {
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

function clickHarness() {
  const listeners = [];
  const calls = { toggle: 0, open: [] };
  const sandbox = {
    document: { addEventListener: (type, f) => listeners.push([type, f]) },
    selectedIds: new Set([5]),
    selectionAnchor: 5,
    state: { active: [], archived: [] },
    toggleRollupBar: () => { calls.toggle++; },
    openCard: (id) => { calls.open.push(id); },
    renderBoard: () => {},
    calls,
  };
  vm.createContext(sandbox);
  vm.runInContext(sharedClickHandler(), sandbox);
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
  assert.deepStrictEqual(sandbox.calls.open, [1]);
});

test('a click on a roll-up bar keeps a building multi-selection', () => {
  const line = appSrc.split('\n').find((l) => l.includes("e.target.closest('#context-menu, #bulk-single"));
  assert.ok(line, 'the Q0 exemption selector is there');
  assert.match(line, /, \.rollup, #graph-toggle-btn, \.graph-control'\)\) return;/, 'the bar itself is exempt, not only the header controls');
});

test('the bar looks clickable and its hit area is taller than the thin line', () => {
  const css = read('app.css');
  const rule = css.match(/\n\.rollup \{([^}]*)\}/);
  assert.ok(rule, '.rollup rule exists');
  assert.match(rule[1], /cursor:\s*pointer/);
  assert.match(rule[1], /padding:\s*3px 0/);
});

// --- layout -----------------------------------------------------------------------

test('the detail puts the roll-up under the thread and above the fields', () => {
  const at = (id) => html.indexOf(`id="${id}"`);
  const [header, thread, rollup, fields, body, children] = [
    html.indexOf('class="detail-header popup-header"'), at('detail-thread'), at('detail-rollup'), at('detail-frontmatter'), at('detail-body'), at('detail-children'),
  ];
  assert.ok([header, thread, rollup, fields, body, children].every((n) => n !== -1), 'every block exists');
  assert.ok(header < thread && thread < rollup && rollup < fields && fields < body && body < children);
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

test('changing the Bar select or the Archived box repaints an open detail too', () => {
  const src = read('app.js');
  for (const id of ['#rollup-bar-mode', '#rollup-archived']) {
    const at = src.indexOf(`$('${id}').addEventListener('change'`);
    assert.ok(at > 0, id);
    const body = src.slice(at, src.indexOf('});', at));
    assert.match(body, /if \(currentDetailId != null\) renderDetailRollup\(currentDetailId\);/, id);
  }
});
