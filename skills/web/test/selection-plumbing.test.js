const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { selectionGlobals } = require('./helpers/selection-globals');
const { installDelete } = require('./helpers/delete-popup');

// The selection's plumbing in the page: one entry point every write goes
// through, one reader every bulk action takes its target cards from, a
// marker on the controls that must not clear the selection, and one Esc step.
// Behaviour is what it was before; this file pins where it now lives.

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const appSrc = read('app.js');
const SCRIPTS = fs.readdirSync(WEB).filter((f) => f.endsWith('.js'));

function fn(name, src = appSrc) {
  const m = src.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found`);
  return m[0];
}

const declaration = (name, kind = 'let') => {
  const m = appSrc.match(new RegExp(`^${kind} ${name} = .*;$`, 'm'));
  assert.ok(m, `the page declares ${name}`);
  return m[0];
};

const ids = (set) => [...set].map(Number).sort((a, b) => a - b);
const asNumber = (value) => (value === null ? null : Number(value));
const asData = (value) => JSON.parse(JSON.stringify(value));
const card = (id) => ({ kind: 'card', id: String(id) });

// --- every write to the selection goes through one entry point ---------------------

function entrySandbox() {
  const sandbox = selectionGlobals();
  vm.createContext(sandbox);
  vm.runInContext([declaration('selectionState'), declaration('selectedIds'), fn('setSelection')].join('\n'), sandbox);
  return sandbox;
}

test('the entry point sets the selection and the range start together', () => {
  const s = entrySandbox();
  vm.runInContext('setSelection(cardsSelection([1, 2]), 2)', s);
  assert.deepStrictEqual(asData(vm.runInContext('selectionState.selection', s)), { anchor: card(1), additions: [card(2)] });
  assert.strictEqual(vm.runInContext('selectionState.rangeStart', s), 2);
});

test('a write with no range start leaves the range start where it was', () => {
  const s = entrySandbox();
  vm.runInContext('setSelection(cardsSelection([1]), 1); setSelection(cardsSelection([5, 6]))', s);
  assert.deepStrictEqual(asData(vm.runInContext('selectionState.selection', s)), { anchor: card(5), additions: [card(6)] });
  assert.strictEqual(vm.runInContext('selectionState.rangeStart', s), 1);
});

test('a write can drop the range start by naming null', () => {
  const s = entrySandbox();
  vm.runInContext('setSelection(cardsSelection([1]), 1); setSelection(NO_SELECTION, null)', s);
  assert.strictEqual(vm.runInContext('selectionState.rangeStart', s), null);
  assert.strictEqual(vm.runInContext('selectedIds.size', s), 0);
});

test('the id set the views paint and the bulk edits read is derived from the selection at every write', () => {
  const s = entrySandbox();
  assert.strictEqual(vm.runInContext('selectedIds.size', s), 0, 'nothing is selected before the first write');
  vm.runInContext('setSelection(cardsSelection([3, 4]), 4)', s);
  assert.deepStrictEqual(ids(vm.runInContext('selectedIds', s)), [3, 4]);
  vm.runInContext('setSelection(cardsSelection([9]))', s);
  assert.deepStrictEqual(ids(vm.runInContext('selectedIds', s)), [9], 'the old ids are gone, not merged');
  assert.strictEqual(vm.runInContext("selectedIds.has('3')", s), false);
});

test('the derived set keeps the interface the renderers and the bulk edits use: has, size and spread', () => {
  const s = entrySandbox();
  vm.runInContext('setSelection(cardsSelection([7, 8]), 8)', s);
  assert.strictEqual(vm.runInContext("selectedIds.has('7')", s), true);
  assert.strictEqual(vm.runInContext('selectedIds.size', s), 2);
  assert.deepStrictEqual(ids(vm.runInContext('selectedIds', s)), [7, 8]);
});

const WRITE = /(?<![\w$.])(selectedIds|selectionState)\s*=(?![=>])/g;
const MUTATE = /(?<![\w$.])(selectedIds|selectionState\.ids)\.(add|delete|clear)\(/g;

function stripped(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
}

test('no script writes the selection or its derived id set anywhere but the entry point', () => {
  for (const file of SCRIPTS) {
    let src = stripped(read(file));
    if (file === 'app.js') src = src.replace(fn('setSelection', src), '').replace(declaration('selectionState'), '').replace(declaration('selectedIds'), '');
    const writes = [...src.matchAll(WRITE)].map((m) => m[0]);
    assert.deepStrictEqual(writes, [], `${file} writes the selection directly`);
    const mutations = [...src.matchAll(MUTATE)].map((m) => m[0]);
    assert.deepStrictEqual(mutations, [], `${file} changes the selection in place`);
  }
});

test('the entry point is the one place that assigns the derived id set', () => {
  const body = fn('setSelection');
  assert.match(body, /selectionState = \{ selection, rangeStart \}/);
  assert.match(body, /selectedIds = resolveSelection\(selection, selectionMatchIds, shownCardIds\)/);
});

test('the pieces that wrote the selection before now call the entry point', () => {
  const calls = {
    applyBoardData: /dropGoneCards\(\)/,
    dropGoneCards: /setSelection\(pruneSelectionParts\(selectionState\.selection,/,
    renderBoard: /setSelection\(selectionFollowingBox\(selectionState\.selection\)\)/,
    addCardToSelection: /setSelection\(addPart\(selectionState\.selection, cardPart\(menuSubject\.ids\[0\]\)\)\)/,
    addDependencyToSelection: /setSelection\(addPart\(selectionState\.selection, part\(menuSubject\.ids\[0\]\)\)\)/,
    selectByClick: /setSelection\(next\.selection, next\.rangeStart\)/,
    onClickAway: /moveSelectionTo\(\{ selection: NO_SELECTION, rangeStart: null \}\)/,
    moveSelectionTo: /setSelection\(next\.selection, next\.rangeStart\)/,
    applyBulkArchive: /setSelection\(NO_SELECTION\)/,
    bulkDelete: /setSelection\(NO_SELECTION\)/,
    onBulkDrop: /setSelection\(NO_SELECTION\)/,
  };
  for (const [name, re] of Object.entries(calls)) assert.match(fn(name), re, name);
  assert.match(fn('graphClickNode', read('graph-view.js')), /selectByClick\(action, id\)/, 'the Graph writes through the same step the shared grammar does');
});

// --- the click handler is a thin caller of the pure decision -----------------------

function clickHandler() {
  const m = appSrc.match(/document\.addEventListener\('click', \(e\) => \{\n    if \(e\.target\.closest\('\.rollup'\)[\s\S]*?\n  \}\);/);
  assert.ok(m, 'the shared card click handler is found');
  return m[0];
}

const CARDS = [
  { id: '1', assignee: '@afk', status: 'todo' },
  { id: '2', assignee: '', status: 'todo' },
  { id: '3', assignee: '@human', status: 'doing' },
];

function clickSandbox({ view = 'board', selected = [], rangeStart = null, order = [1, 2, 3], click = {} } = {}) {
  const calls = { open: [], render: 0, terms: [] };
  const listeners = [];
  const sandbox = {
    document: { addEventListener: (type, f) => listeners.push([type, f]) },
    ...selectionGlobals(),
    $: () => ({ value: '' }),
    writeSearch() {},
    state: { active: CARDS, archived: [] },
    loadViewMode: () => view,
    loadPrefsState: () => ({ click }),
    visibleCardIds: () => order.map(String),
    openCard: (id) => { calls.open.push(Number(id)); },
    renderBoard: () => { calls.render++; },
    addSearchTerm: (term) => { calls.terms.push(term); },
    searchTermText: require('../web/search').searchTermText,
    toggleRollupBar() {},
    calls,
  };
  vm.createContext(sandbox);
  vm.runInContext([declaration('selectionState'), declaration('selectedIds'), fn('setSelection'), fn('selectByClick'), fn('moveSelectionTo'), fn('applyCardClick'), fn('searchByCue'), clickHandler()].join('\n'), sandbox);
  vm.runInContext(`setSelection(cardsSelection(${JSON.stringify(selected)}), ${JSON.stringify(rangeStart === null ? null : String(rangeStart))})`, sandbox);
  assert.strictEqual(listeners.length, 1);
  const state = () => ({ ids: ids(vm.runInContext('selectedIds', sandbox)), rangeStart: asNumber(vm.runInContext('selectionState.rangeStart', sandbox)) });
  return { click: listeners[0][1], state, calls };
}

const cardEvent = (id, { cue = null, ...mods } = {}) => ({
  target: {
    closest: (sel) => {
      if (sel === '.card-el') return { dataset: { id: String(id) } };
      if (sel.includes('.card-assignee')) return cue;
      return null;
    },
  },
  shiftKey: false, ctrlKey: false, metaKey: false, detail: 1, ...mods,
});

const cueEl = (cls, text = '') => ({ classList: { contains: (c) => c === cls }, textContent: text });

test('a plain click in the Board, Map, Gantt and Calendar opens the card and drops the selection and its range start', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const s = clickSandbox({ view, selected: [1, 2], rangeStart: 1 });
    s.click(cardEvent(3));
    assert.deepStrictEqual(s.calls.open, [3], view);
    assert.deepStrictEqual(s.state(), { ids: [], rangeStart: null }, view);
    assert.strictEqual(s.calls.render, 1, `${view}: the board repaints without the old selection`);
  }
});

test('a plain click with nothing selected opens the card and repaints nothing', () => {
  const s = clickSandbox();
  s.click(cardEvent(2));
  assert.deepStrictEqual(s.calls.open, [2]);
  assert.strictEqual(s.calls.render, 0);
});

test('a plain click in a view whose plain click selects selects that card alone, and opens nothing', () => {
  const s = clickSandbox({ view: 'graph', selected: [1], rangeStart: 1 });
  s.click(cardEvent(3));
  assert.deepStrictEqual(s.calls.open, []);
  assert.deepStrictEqual(s.state(), { ids: [3], rangeStart: 3 });
});

test('a view the preferences set to selects selects the card alone on a plain click, and opens nothing', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const s = clickSandbox({ view, selected: [1], rangeStart: 1, click: { [view]: 'selects' } });
    s.click(cardEvent(3));
    assert.deepStrictEqual(s.calls.open, [], view);
    assert.deepStrictEqual(s.state(), { ids: [3], rangeStart: 3 }, view);
    assert.strictEqual(s.calls.render, 1, `${view}: the view repaints with the card selected`);
  }
});

test('the second click of a double click, in a view set to selects, opens the card and leaves the selection and the view as the first click made them', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const s = clickSandbox({ view, selected: [1, 2], rangeStart: 1, click: { [view]: 'selects' } });
    s.click(cardEvent(3, { detail: 1 }));
    assert.deepStrictEqual(s.state(), { ids: [3], rangeStart: 3 }, `${view}: the first click selects`);
    assert.deepStrictEqual(s.calls.open, [], view);
    const renders = s.calls.render;
    s.click(cardEvent(3, { detail: 2 }));
    assert.deepStrictEqual(s.calls.open, [3], `${view}: the second click opens it`);
    assert.deepStrictEqual(s.state(), { ids: [3], rangeStart: 3 }, `${view}: and leaves the selection alone`);
    assert.strictEqual(s.calls.render, renders, `${view}: with no repaint, so the card the pointer is on is not replaced again`);
  }
});

test('the second click of a double click opens the card it landed on, whichever card the first click selected', () => {
  const s = clickSandbox({ selected: [1], rangeStart: 1, click: { board: 'selects' } });
  s.click(cardEvent(2, { detail: 2 }));
  assert.deepStrictEqual(s.calls.open, [2]);
  assert.deepStrictEqual(s.state(), { ids: [1], rangeStart: 1 });
});

test('a view whose plain click opens the card opens it on every click of a double click and carries out nothing else', () => {
  const s = clickSandbox({ view: 'board' });
  s.click(cardEvent(2, { detail: 1 }));
  s.click(cardEvent(2, { detail: 2 }));
  assert.deepStrictEqual(s.calls.open, [2, 2]);
  assert.deepStrictEqual(s.state(), { ids: [], rangeStart: null });
});

test('a choice made for one view leaves a plain click in the others opening the card', () => {
  const s = clickSandbox({ view: 'map', click: { board: 'selects', gantt: 'selects', calendar: 'selects' } });
  s.click(cardEvent(2));
  assert.deepStrictEqual(s.calls.open, [2]);
});

test('in a view set to selects, Ctrl, Cmd and Shift click still build the selection as they do everywhere', () => {
  const s = clickSandbox({ view: 'board', selected: [1], rangeStart: 1, order: [1, 2, 3], click: { board: 'selects' } });
  s.click(cardEvent(2, { ctrlKey: true }));
  assert.deepStrictEqual(s.state(), { ids: [1, 2], rangeStart: 2 });
  s.click(cardEvent(3, { shiftKey: true }));
  assert.deepStrictEqual(s.state(), { ids: [1, 2, 3], rangeStart: 2 });
  assert.deepStrictEqual(s.calls.open, []);
});

test('Ctrl and Cmd click toggle one card and plant the range start on it', () => {
  for (const key of ['ctrlKey', 'metaKey']) {
    const s = clickSandbox({ selected: [1], rangeStart: 1 });
    s.click(cardEvent(2, { [key]: true }));
    assert.deepStrictEqual(s.state(), { ids: [1, 2], rangeStart: 2 }, key);
    s.click(cardEvent(1, { [key]: true }));
    assert.deepStrictEqual(s.state(), { ids: [2], rangeStart: 1 }, `${key} again toggles it off`);
    assert.deepStrictEqual(s.calls.open, []);
  }
});

test('Shift click adds the range from the range start to the card, in the view\'s order', () => {
  const s = clickSandbox({ selected: [1], rangeStart: 1, order: [1, 2, 3] });
  s.click(cardEvent(3, { shiftKey: true }));
  assert.deepStrictEqual(s.state(), { ids: [1, 2, 3], rangeStart: 1 });
  assert.deepStrictEqual(s.calls.open, []);
});

test('Shift click with a range start that left the view starts the range at the card', () => {
  for (const rangeStart of [null, 99]) {
    const s = clickSandbox({ selected: [], rangeStart, order: [1, 2, 3] });
    s.click(cardEvent(2, { shiftKey: true }));
    assert.deepStrictEqual(s.state(), { ids: [2], rangeStart: 2 }, String(rangeStart));
  }
});

test('a click on a cue adds its search term and leaves the selection and the card alone, whatever the modifier', () => {
  const cues = [
    [cueEl('card-assignee'), 'assignee:@afk', 1],
    [cueEl('tag', 'next-up'), 'tags:next-up', 1],
    [cueEl('blocked-pill'), 'blocked:', 1],
    [cueEl('review-pill'), 'review:', 1],
  ];
  for (const [cue, term, id] of cues) {
    for (const mods of [{}, { ctrlKey: true }, { shiftKey: true }]) {
      const s = clickSandbox({ selected: [2], rangeStart: 2 });
      s.click(cardEvent(id, { cue, ...mods }));
      assert.deepStrictEqual(s.calls.terms, [term], `${term} ${JSON.stringify(mods)}`);
      assert.deepStrictEqual(s.calls.open, []);
      assert.deepStrictEqual(s.state(), { ids: [2], rangeStart: 2 });
    }
  }
});

test('the assignee cue of a card with no assignee adds nothing', () => {
  const s = clickSandbox();
  s.click(cardEvent(2, { cue: cueEl('card-assignee') }));
  assert.deepStrictEqual(s.calls.terms, []);
});

test('the handler reads the view\'s plain-click behaviour from the lookup and the decision from the pure function, deciding nothing itself', () => {
  const body = clickHandler();
  assert.match(body, /const view = loadViewMode\(\);/);
  assert.match(body, /plainClick: plainClickBehaviour\(view, loadPrefsState\(\)\.click\), ranges: shiftAddsRange\(view\), detail: e\.detail/);
  assert.match(body, /cardClickAction\(/);
  assert.match(body, /applyCardClick\(/);
  assert.doesNotMatch(body, /selectedIds|rangeSelection|toggleSelection|setSelection|openCard\(/, 'the handler carries the decision out through applyCardClick and touches no selection state');
});

// --- controls that must not clear the selection carry one marker --------------------

const { KEEPS, HOLDS, tagsOf, assertKeepsSelection, assertHoldsPoll, assertLetsPollRun } = require('./helpers/markers');

// Everything the click-away handler's selector list named before the marker.
const FORMER_CLICK_AWAY = ['#context-menu', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '.date-picker-pop',
  '#map-toggle-btn', '#calendar-toggle-btn', '#gantt-toggle-btn', '#graph-toggle-btn', '.cal-nav',
  '.map-filter-toggle', '.gantt-filter-toggle', '.calendar-filter-toggle', '.graph-filter-toggle', '.map-section-toggle',
  '.map-zoom-btn', '.map-option-btn', '.rollup', '.graph-control'];

test('every element that the click-away list exempted before the marker carries the marker', () => {
  assertKeepsSelection(FORMER_CLICK_AWAY, 'a former click-away exemption');
});

test('the page builds the controls the marker tests look at in the numbers the render code writes them', () => {
  const counts = { '.cal-nav': 9, '.map-section-toggle': 4, '.map-zoom-btn': 3, '.rollup': 2, '.column-sort-field': 1, '.column-sort-dir': 1, '.column-add': 1, '.column-add-ai': 1 };
  for (const [selector, n] of Object.entries(counts)) assert.strictEqual(tagsOf(selector).length, n, selector);
});

function clickAwaySandbox({ selected = [1, 2], rangeStart = 1, isolated = false } = {}) {
  const calls = { render: 0 };
  const input = { value: '' };
  const sandbox = { ...selectionGlobals(), $: () => input, searchRemoveAlt: (text) => text, renderBoard: () => { calls.render++; }, isolateNow: () => (isolated ? { previous: '' } : null), calls };
  vm.createContext(sandbox);
  vm.runInContext([
    declaration('selectionState'), declaration('selectedIds'), declaration('searchWriteListeners', 'const'),
    declaration('CALENDAR_CREATE_DAY_CELLS', 'const'), declaration('CALENDAR_CREATE_COLUMNS', 'const'), declaration('NOT_EMPTY_SPACE', 'const'), declaration('DOUBLE_CLICK_OWNED', 'const'),
    fn('setSelection'), fn('writeSearch'), fn('moveSelectionTo'), fn('onClickAway'),
  ].join('\n'), sandbox);
  vm.runInContext(`setSelection(cardsSelection(${JSON.stringify(selected)}), ${JSON.stringify(rangeStart === null ? null : String(rangeStart))})`, sandbox);
  const state = () => ({ ids: ids(vm.runInContext('selectedIds', sandbox)), rangeStart: asNumber(vm.runInContext('selectionState.rangeStart', sandbox)) });
  return { onClickAway: sandbox.onClickAway, state, calls };
}

// An element and its ancestors, the way closest() reads them.
const within = (...chain) => ({ closest: (sel) => (sel === `[${KEEPS}]` ? chain.find((n) => KEEPS.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()) in n.dataset) || null : null) });
const plain = { dataset: {} };
const marked = { dataset: { keepsSelection: '' } };
const noMods = { shiftKey: false, ctrlKey: false, metaKey: false, detail: 2 };

test('a double click on empty space clears the selection and its range start', () => {
  const s = clickAwaySandbox();
  s.onClickAway({ target: within(plain), ...noMods });
  assert.deepStrictEqual(s.state(), { ids: [], rangeStart: null });
  assert.strictEqual(s.calls.render, 1);
});

test('while isolated a double click on empty space leaves the selection in every view, not the Graph alone', () => {
  const graph = { closest: (sel) => (sel === '#graph-view' ? {} : null) };
  const board = { closest: () => null };
  for (const [view, target] of [['graph', graph], ['board', board]]) {
    const s = clickAwaySandbox({ isolated: true });
    s.onClickAway({ target, ...noMods });
    assert.deepStrictEqual(s.state(), { ids: [1, 2], rangeStart: 1 }, view);
    assert.strictEqual(s.calls.render, 0, view);
  }
  const off = clickAwaySandbox({ isolated: false });
  off.onClickAway({ target: board, ...noMods });
  assert.deepStrictEqual(off.state(), { ids: [], rangeStart: null }, 'with isolate off the same click clears');
});

test('a single click on empty space, and the clicks of a triple click past the second, leave the selection and its range start', () => {
  for (const detail of [0, 1, 3]) {
    const s = clickAwaySandbox();
    s.onClickAway({ target: within(plain), ...noMods, detail });
    assert.deepStrictEqual(s.state(), { ids: [1, 2], rangeStart: 1 }, `detail ${detail}`);
    assert.strictEqual(s.calls.render, 0, `detail ${detail}`);
  }
});

test('a double click on an element carrying the marker, or inside one, never clears the selection', () => {
  for (const chain of [[marked], [plain, marked]]) {
    const s = clickAwaySandbox();
    s.onClickAway({ target: within(...chain), ...noMods });
    assert.deepStrictEqual(s.state(), { ids: [1, 2], rangeStart: 1 });
    assert.strictEqual(s.calls.render, 0);
  }
});

test('a double click while Shift, Ctrl or Cmd is held builds the selection, so it never clears it', () => {
  for (const mod of ['shiftKey', 'ctrlKey', 'metaKey']) {
    const s = clickAwaySandbox();
    s.onClickAway({ target: within(plain), ...noMods, [mod]: true });
    assert.deepStrictEqual(s.state(), { ids: [1, 2], rangeStart: 1 }, mod);
  }
});

test('a double click with nothing selected repaints nothing', () => {
  const s = clickAwaySandbox({ selected: [], rangeStart: 'null' });
  s.onClickAway({ target: within(plain), ...noMods });
  assert.strictEqual(s.calls.render, 0);
});

test('the click-away handler asks the marker and carries no list of selectors', () => {
  const body = fn('onClickAway');
  assert.match(body, /e\.target\.closest\('\[data-keeps-selection\]'\)/);
  assert.doesNotMatch(body, /#bulk-single|\.cal-nav|\.rollup|\.graph-control|#context-menu/);
  assert.match(appSrc, /document\.addEventListener\('click', onClickAway\);/);
});

// --- the poll's focus guard reads a marker too ------------------------------------

test('every control the poll guard listed before the marker carries the poll marker, and the pills do not', () => {
  assertHoldsPoll(['.column-sort-field', '.column-sort-dir', '.cal-nav', '.column-add', '.column-add-ai', '.map-zoom-btn', '.map-option-btn', '.graph-button'], 'a former poll-guard control');
  assertLetsPollRun(['.map-filter-toggle', '.gantt-filter-toggle', '.calendar-filter-toggle', '.graph-filter-toggle', '.map-section-toggle', '.rollup'], 'a pill or fold toggle');
});

test('the poll guard asks the marker and carries no list of selectors', () => {
  const body = fn('boardControlFocused');
  assert.match(body, /closest\('\[data-holds-poll\]'\)/);
  assert.doesNotMatch(body, /column-sort|cal-nav|column-add|map-zoom|map-option|graph-control/);
  assert.strictEqual(HOLDS, 'data-holds-poll');
});

// --- Esc with nothing open takes one step -------------------------------------------

test('Esc with no popup open runs the one step function', () => {
  const handler = appSrc.match(/document\.addEventListener\('keydown', \(e\) => \{\n    if \(e\.key !== 'Escape'\) return;[\s\S]*?\n  \}\);/);
  assert.ok(handler, 'the document Esc handler is found');
  const lines = handler[0].trimEnd().split('\n');
  assert.strictEqual(lines[lines.length - 2].trim(), 'escapeStep(e);', 'the end of the chain is the one step');
  assert.doesNotMatch(handler[0], /clearSearch\(\)/, 'the handler itself no longer clears the box');
});

// Esc's order is the page's: a menu, the notifications panel, the preferences
// sheet, the detail popup, the edit form, the bulk popups and any other popup take
// it first, and the step is the tail of the chain. The combobox stops Esc itself
// while its menu is open, before this document listener ever sees the key.
test('the Esc chain keeps its order and ends in the one step, behind a single document listener', () => {
  const handler = appSrc.match(/document\.addEventListener\('keydown', \(e\) => \{\n    if \(e\.key !== 'Escape'\) return;[\s\S]*?\n  \}\);/)[0];
  const order = ['hideContextMenu()', 'closeNotifModal()', 'closePrefsSheet()', 'closeCard()', 'requestCloseModal()', 'closeAnyBulkPopup()', 'anyModalOpen()', 'escapeStep(e)'].map((s) => handler.indexOf(s));
  assert.ok(order.every((at) => at !== -1), 'every link of the chain is there');
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, 'popups take Esc before the step');
  assert.strictEqual(appSrc.split("if (e.key !== 'Escape') return;").length - 1, 1, 'one document listener reads Esc: the step adds no second keydown listener');
  assert.strictEqual(appSrc.split('escapeStep(e)').length - 1, 2, 'the step is called from the handler alone (and defined once)');
  assert.strictEqual(appSrc.split('stepSelectionBack()').length - 1, 2, 'the selection step is called from the Esc step alone (and defined once)');
});

// The step reads the shared key guard (key-guard.js) through its Esc question, and
// a fake document stands for the page: what has focus, which surfaces are open.
function escapeSandbox({ value = '', selected = [], active = 'body', open = [], rangeStart = null } = {}) {
  const calls = { render: 0 };
  const input = { value, tagName: 'INPUT', id: 'search-input' };
  const focus = { body: { tagName: 'BODY' }, box: input, button: { tagName: 'BUTTON' }, field: { tagName: 'INPUT', id: 'some-other-field' }, select: { tagName: 'SELECT' } };
  const sandbox = {
    $: (sel) => { assert.strictEqual(sel, '#search-input'); return input; },
    renderBoard: () => { calls.render++; },
    document: { activeElement: focus[active], querySelector: (sel) => (open.includes(sel) ? { id: 'open' } : null) },
    calls, input, focus,
    ...selectionGlobals(), ...require('../web/key-guard'),
  };
  vm.createContext(sandbox);
  vm.runInContext([
    declaration('searchWriteListeners', 'const'), declaration('selectionState'), declaration('selectedIds'),
    fn('setSelection'), fn('writeSearch'), fn('clearSearch'), fn('moveSelectionTo'), fn('stepSelectionBack'), fn('escapeStep'),
  ].join('\n'), sandbox);
  vm.runInContext(`setSelection(cardsSelection(${JSON.stringify(selected)}), ${JSON.stringify(rangeStart === null ? null : String(rangeStart))})`, sandbox);
  sandbox.state = () => asData({ ids: ids(vm.runInContext('selectedIds', sandbox)), anchor: vm.runInContext('selectionState.selection.anchor', sandbox), additions: vm.runInContext('selectionState.selection.additions.length', sandbox), rangeStart: asNumber(vm.runInContext('selectionState.rangeStart', sandbox)) });
  return sandbox;
}

test('with focus in the search box, the Esc step clears the box and repaints, and leaves the selection', () => {
  const s = escapeSandbox({ value: 'tags:next-up', selected: [1, 2, 3], active: 'box', rangeStart: 3 });
  s.escapeStep();
  assert.strictEqual(s.input.value, '');
  assert.strictEqual(s.calls.render, 1);
  assert.deepStrictEqual(s.state(), { ids: [1, 2, 3], anchor: { kind: 'card', id: '1' }, additions: 2, rangeStart: 3 });
});

test('with focus in an empty search box, the Esc step does nothing', () => {
  const s = escapeSandbox({ value: '', selected: [1, 2], active: 'box' });
  s.escapeStep();
  assert.strictEqual(s.calls.render, 0);
  assert.deepStrictEqual(s.state().ids, [1, 2]);
});

test('with focus outside the search box, the Esc step leaves the box text as it was and steps the selection back', () => {
  const s = escapeSandbox({ value: 'tags:next-up', selected: [1, 2, 3], active: 'button', rangeStart: 3 });
  s.escapeStep();
  assert.strictEqual(s.input.value, 'tags:next-up', 'Esc away from the box no longer clears it');
  assert.deepStrictEqual(s.state(), { ids: [1], anchor: { kind: 'card', id: '1' }, additions: 0, rangeStart: 1 }, 'the additions drop all at once and the anchor stays; the range start is the anchor card');
  assert.strictEqual(s.calls.render, 1);
});

test('the next Esc drops the anchor, and the one after has nothing to step back from and repaints nothing', () => {
  const s = escapeSandbox({ value: 'tags:next-up', selected: [1, 2, 3], active: 'body', rangeStart: 3 });
  s.escapeStep();
  s.escapeStep();
  assert.deepStrictEqual(s.state(), { ids: [], anchor: null, additions: 0, rangeStart: null });
  assert.strictEqual(s.calls.render, 2);
  s.escapeStep();
  assert.strictEqual(s.calls.render, 2, 'nothing picked: no repaint');
  assert.strictEqual(s.input.value, 'tags:next-up');
});

test('while focus is in a text field other than the search box, or a select, the Esc step touches neither the selection nor the box', () => {
  for (const active of ['field', 'select']) {
    const s = escapeSandbox({ value: 'tags:next-up', selected: [1, 2], active });
    s.escapeStep();
    assert.strictEqual(s.input.value, 'tags:next-up', active);
    assert.deepStrictEqual(s.state().ids, [1, 2], active);
    assert.strictEqual(s.calls.render, 0, active);
  }
});

test('with a surface open (the preferences sheet, say), the Esc step does nothing, even with focus in the box', () => {
  for (const active of ['body', 'box']) {
    const s = escapeSandbox({ value: 'tags:next-up', selected: [1, 2], active, open: ['#prefs-sheet:not(.hidden)'] });
    s.escapeStep();
    assert.strictEqual(s.input.value, 'tags:next-up', active);
    assert.deepStrictEqual(s.state().ids, [1, 2], active);
    assert.strictEqual(s.calls.render, 0, active);
  }
});

test('a selection built from a query part steps back like any other: the additions go, the query stays the anchor', () => {
  const s = escapeSandbox({ selected: [], active: 'body' });
  vm.runInContext(`setSelection(addPart(setAnchor(NO_SELECTION, queryPart('assignee:@afk')), cardPart(4)))`, s);
  s.escapeStep();
  assert.deepStrictEqual(s.state().anchor, { kind: 'query', text: 'assignee:@afk' });
  assert.strictEqual(s.state().additions, 0);
  assert.strictEqual(s.state().rangeStart, null, 'a query anchor leaves no range start');
});

// --- every bulk action reads its target cards through one reader --------------------

const BULK_CARDS = [
  { id: '1', title: 'one', status: 'todo', archived: false, tags: ['a'], assignee: '@afk' },
  { id: '2', title: 'two', status: 'done', archived: false, tags: ['a', 'b'], assignee: '' },
  { id: '3', title: 'three', status: 'todo', archived: false, tags: [], assignee: '' },
  { id: '4', title: 'four', status: 'done', archived: true, tags: ['b'], assignee: '' },
];

function fakeBox() {
  const classes = new Set(['hidden']);
  return {
    value: '', checked: false, disabled: false, textContent: '', innerHTML: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    focus() {}, querySelectorAll: () => [], replaceChildren() {}, append() {}, appendChild() {},
  };
}

function bulkSandbox({ selected = [1, 2], rangeStart = null } = {}) {
  const calls = { api: [], confirms: [], toasts: [], loads: 0 };
  const boxes = new Map();
  const $ = (sel) => { if (!boxes.has(sel)) boxes.set(sel, fakeBox()); return boxes.get(sel); };
  const sandbox = {
    $, boxes, calls,
    state: { active: BULK_CARDS.filter((c) => !c.archived).map((c) => ({ ...c })), archived: BULK_CARDS.filter((c) => c.archived).map((c) => ({ ...c })) },
    api: async (method, url, body) => { calls.api.push(JSON.parse(JSON.stringify([method, url, body === undefined ? null : body]))); return {}; },
    confirm: (message) => { calls.confirms.push(message); return true; },
    toast: (message) => { calls.toasts.push(message); },
    loadBoard: async () => { calls.loads++; },
    hideContextMenu() {}, applyModalFullscreen() {}, renderBoard() {},
    document: { querySelector: () => ({}), querySelectorAll: () => [], createElement: fakeBox },
    ...selectionGlobals(), ...require('../web/bulk-edit'),
  };
  vm.createContext(sandbox);
  installDelete(sandbox, calls);
  const scheduleRows = appSrc.match(/const SCHEDULE_ROWS = \[[\s\S]*?\n\];/);
  assert.ok(scheduleRows, 'SCHEDULE_ROWS found in app.js');
  vm.runInContext([
    declaration('selectionState'), declaration('selectedIds'), fn('setSelection'),
    'let bulkSingleMode = null; let bulkPopupIds = [];',
    declaration('menuSubject'),
    scheduleRows[0],
    ...['bulkTargets', 'captureBulkTargets', 'bulkPatch', 'openBulkSingle', 'applyBulkSingle', 'renderBulkTags', 'openBulkTags', 'bulkAddTag', 'bulkRemoveTags',
      'readScheduleFields', 'refreshScheduleControls', 'openBulkSchedule', 'applyBulkSchedule', 'bulkArchive', 'openBulkArchive', 'applyBulkArchive', 'bulkRestore', 'bulkDelete'].map((n) => fn(n)),
  ].join('\n'), sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  run(`setSelection(cardsSelection(${JSON.stringify(selected)}), ${rangeStart})`);
  run(`menuSubject = cardMenuFor(selectedIds, ${JSON.stringify(selected[0] === undefined ? '0' : String(selected[0]))})`); // a right-click on a selected card: the menu is for the whole selection
  return {
    boxes, calls, run,
    set: (name, value) => { sandbox[name] = value; },
    select: (...next) => run(`setSelection(cardsSelection(${JSON.stringify(next)}))`),
    patched: () => calls.api.filter(([m]) => m === 'PATCH').map(([, url, body]) => [url, body]),
  };
}

test('the reader returns the selection\'s cards in the order they were selected, live and archived, and drops an id with no card', () => {
  const s = bulkSandbox({ selected: [4, 1, 99, 2] });
  assert.deepStrictEqual([...s.run('bulkTargets().map((c) => c.id)')], ['4', '1', '2']);
});

test('given the ids a popup captured, the reader returns those cards whatever the selection is now', () => {
  const s = bulkSandbox({ selected: [1] });
  assert.deepStrictEqual([...s.run("bulkTargets(['3', '2']).map((c) => c.id)")], ['3', '2']);
});

test('assign: the popup applies to the cards it captured when it opened, even if the selection changes while it is open', async () => {
  const s = bulkSandbox({ selected: [1, 2] });
  s.run("openBulkSingle('assignee')");
  assert.match(s.boxes.get('#bulk-single-title').textContent, /Assign 2 card/);
  s.select(3);
  s.boxes.get('#bulk-single-input').value = '@human';
  await s.run('applyBulkSingle()');
  assert.deepStrictEqual(s.patched(), [['/api/cards/1', { assignee: '@human' }], ['/api/cards/2', { assignee: '@human' }]]);
});

test('priority: the popup applies to the cards it captured when it opened', async () => {
  const s = bulkSandbox({ selected: [2, 3] });
  s.run("openBulkSingle('priority')");
  assert.match(s.boxes.get('#bulk-single-title').textContent, /Set priority on 2 card/);
  s.select(1);
  s.boxes.get('#bulk-single-input').value = 'High';
  await s.run('applyBulkSingle()');
  assert.deepStrictEqual(s.patched(), [['/api/cards/2', { priority: 'High' }], ['/api/cards/3', { priority: 'High' }]]);
});

test('tags: the workbench adds to, lists and removes from the cards it captured when it opened', async () => {
  const s = bulkSandbox({ selected: [1, 3] });
  s.run('openBulkTags()');
  assert.match(s.boxes.get('#bulk-tags-title').textContent, /Edit tags on 2 card/);
  s.select(2);
  s.boxes.get('#bulk-tag-input').value = 'new';
  await s.run('bulkAddTag()');
  assert.deepStrictEqual(s.patched(), [['/api/cards/1', { tags: ['a', 'new'] }], ['/api/cards/3', { tags: ['new'] }]]);
  assert.match(s.boxes.get('#bulk-tags-title').textContent, /Edit tags on 2 card/, 'the workbench still shows the captured cards');
  s.calls.api.length = 0;
  s.boxes.get('#bulk-tag-list').querySelectorAll = () => [{ value: 'a' }];
  await s.run('bulkRemoveTags()');
  assert.deepStrictEqual(s.patched(), [['/api/cards/1', { tags: [] }]]);
});

test('schedule: the popup applies to the cards it captured when it opened', async () => {
  const s = bulkSandbox({ selected: [1, 2] });
  s.run('openBulkSchedule()');
  assert.match(s.boxes.get('#bulk-schedule-title').textContent, /Schedule 2 card/);
  s.select(3);
  s.boxes.get('#bs-due').value = '2026-12-01';
  await s.run('applyBulkSchedule()');
  assert.deepStrictEqual(s.patched().map(([url]) => url), ['/api/cards/1', '/api/cards/2']);
  assert.deepStrictEqual(s.patched()[0][1], { due_date: '2026-12-01' });
});

test('archive: the confirmation names the count, and the popup archives the cards it captured when the action started', async () => {
  const s = bulkSandbox({ selected: [1, 2, 4] });
  await s.run('bulkArchive()');
  assert.deepStrictEqual(s.calls.confirms, ['Archive 2 card(s)? (moves their files to archived/)']);
  assert.match(s.boxes.get('#bulk-archive-title').textContent, /Archive 2 card/);
  s.select(3);
  await s.run('applyBulkArchive()');
  assert.deepStrictEqual(s.calls.api.filter(([m]) => m === 'POST').map(([, url]) => url), ['/api/cards/1/archive', '/api/cards/2/archive']);
  assert.match(s.calls.toasts[0], /Archived 2 card\(s\); skipped 1 already archived/);
});

test('restore: restores the archived cards of the selection and skips the live ones', async () => {
  const s = bulkSandbox({ selected: [1, 4] });
  await s.run('bulkRestore()');
  assert.deepStrictEqual(s.calls.api.map(([m, url]) => [m, url]), [['POST', '/api/cards/4/restore']]);
  assert.match(s.calls.toasts[0], /Restored 1 card\(s\); skipped 1 not archived/);
});

test('delete: one popup asks for the whole selection, and the cards it names are deleted', async () => {
  const s = bulkSandbox({ selected: [3, 1] });
  await s.run('bulkDelete()');
  await s.calls.pending;
  assert.deepStrictEqual(s.calls.deletes, [{ kind: 'card', targets: ['3', '1'] }]);
  assert.deepStrictEqual(s.calls.confirms, []);
  assert.deepStrictEqual(s.calls.api.map(([m, url]) => [m, url]), [['DELETE', '/api/cards/3'], ['DELETE', '/api/cards/1']]);
  assert.strictEqual(s.run('selectedIds.size'), 0);
});

test('drag: dragging a selected card carries the whole selection, and an unselected card or a lone one carries itself only', () => {
  const handlers = {};
  let tiles = [];
  const tile = (id) => ({ dataset: { id: String(id) }, classList: { add() {}, remove() {} }, addEventListener(type, f) { handlers[type] = f; } });
  const s = bulkSandbox({ selected: [1, 2] });
  s.run('let isDragging = false, dragCardId = null, bulkDragIds = null;');
  s.set('$', (sel) => (sel === '#board' ? { querySelectorAll: () => tiles } : fakeBox()));
  s.run(fn('wireDrag'));
  const dragstart = (id) => {
    tiles = [tile(id)];
    s.run('wireDrag()');
    handlers.dragstart({ dataTransfer: { setData() {} } });
    return s.run('bulkDragIds');
  };
  assert.deepStrictEqual([...dragstart(2)], ['1', '2']);
  assert.strictEqual(dragstart(3), null, 'a card outside the selection drags alone');
  s.select(1);
  assert.strictEqual(dragstart(1), null, 'a selection of one is a single-card drag');
});

const BULK_ACTIONS = ['openBulkSingle', 'applyBulkSingle', 'renderBulkTags', 'openBulkTags', 'bulkAddTag', 'bulkRemoveTags', 'openBulkSchedule', 'applyBulkSchedule',
  'bulkArchive', 'applyBulkArchive', 'bulkRestore', 'bulkDelete', 'wireDrag'];

test('assign, priority, tags, schedule, archive, restore, delete and drag take their targets from the one reader, and none touches the selection directly', () => {
  for (const name of BULK_ACTIONS) {
    const body = fn(name);
    assert.doesNotMatch(body, /selectedIds|selectedCards\(/, `${name} reads the selection through the reader`);
    assert.match(body, /bulkTargets\(|captureBulkTargets\(/, `${name} calls the reader`);
  }
  assert.doesNotMatch(appSrc, /function selectedCards\(/, 'the old reader is gone');
});

test('a popup applies to the targets it captured: the apply steps read the captured ids, never the live selection', () => {
  for (const name of ['applyBulkSingle', 'renderBulkTags', 'bulkAddTag', 'bulkRemoveTags', 'applyBulkSchedule', 'applyBulkArchive']) {
    assert.match(fn(name), /bulkTargets\(bulkPopupIds\)/, name);
  }
  for (const name of ['openBulkSingle', 'openBulkTags', 'openBulkSchedule', 'bulkArchive']) {
    assert.match(fn(name), /captureBulkTargets\(\)/, `${name} captures when it starts`);
  }
});

test('the menu subject before any menu has opened carries every key a menu subject has, the card menu\'s and the canvas menu\'s', () => {
  const { cardMenuFor, canvasMenuFor } = require('../web/selection');
  const sandbox = vm.createContext({});
  const initial = vm.runInContext(`${declaration('menuSubject')}; menuSubject`, sandbox);
  const keys = new Set([...Object.keys(cardMenuFor(new Set(), 1)), ...Object.keys(canvasMenuFor())]);
  assert.deepStrictEqual(Object.keys(initial).sort(), [...keys].sort());
  for (const key of keys) if (key !== 'ids') assert.strictEqual(initial[key], false, key);
});
