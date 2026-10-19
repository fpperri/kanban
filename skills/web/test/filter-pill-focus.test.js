const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { tagsOf, elementOf } = require('./helpers/markers');
const path = require('node:path');
const vm = require('node:vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const graphSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'graph-view.js'), 'utf8');

function fn(name) {
  const start = appSrc.indexOf('function ' + name + '(');
  const end = appSrc.indexOf('\n}', start);
  const m = start === -1 || end === -1 ? null : [appSrc.slice(start, end + 2)];
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

function fakeEl(tag) {
  const el = {
    tag, className: '', dataset: {}, attrs: {}, style: {}, children: [], title: '', textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    get classList() { return this.className.split(/\s+/).filter(Boolean); },
  };
  return el;
}

test('every pill carries an identity dot in its status colour and an off pill never uses a coloured border', () => {
  const sandbox = {
    document: { createElement: fakeEl },
    boardColumnIds: () => ['todo', 'doing'],
    columnLabel: (c) => c.toUpperCase(),
    statusColorVar: (c) => `var(--st-${c})`,
  };
  vm.runInNewContext(fn('buildFilterPillRow'), sandbox);
  const row = sandbox.buildFilterPillRow({ todo: true, doing: false }, ['todo', 'doing'], 'r', 'p', () => 'T');
  assert.strictEqual(row.children.length, 2);
  const [on, off] = row.children;
  for (const [btn, col] of [[on, 'todo'], [off, 'doing']]) {
    const dot = btn.children.find((c) => c.className === 'pill-dot');
    assert.ok(dot, `${col} pill has a dot`);
    assert.strictEqual(dot.style.color, `var(--st-${col})`);
    assert.ok(btn.children.includes(col.toUpperCase()), 'the label follows the dot');
    assert.ok(!('borderColor' in btn.style), 'no coloured edge');
  }
  assert.ok(/\boff\b/.test(off.className) && !/\boff\b/.test(on.className));
  assert.strictEqual(on.attrs['aria-pressed'], 'true');
  assert.strictEqual(off.attrs['aria-pressed'], 'false');
});

function focusSandbox() {
  const focused = [];
  const wanted = new Map();
  const log = [];
  const sandbox = {
    document: { querySelector: (sel) => (wanted.has(sel) ? { focus: () => focused.push(sel) } : null) },
    log, focused, wanted,
  };
  vm.runInNewContext(fn('refocusSelector') + '\n' + fn('keepControlFocus'), sandbox);
  return sandbox;
}

test('keepControlFocus puts focus back on the same pill after the row re-renders', () => {
  const s = focusSandbox();
  const pill = { classList: ['gantt-filter-toggle'], dataset: { col: 'in-progress' } };
  s.wanted.set('.gantt-filter-toggle[data-col="in-progress"]', true);
  s.keepControlFocus(pill, () => s.log.push('rendered'));
  assert.deepStrictEqual(s.log, ['rendered']);
  assert.deepStrictEqual(s.focused, ['.gantt-filter-toggle[data-col="in-progress"]']);
});

test('keepControlFocus refocuses a section fold toggle by its section', () => {
  const s = focusSandbox();
  const btn = { classList: ['map-section-toggle'], dataset: { section: 'layered' } };
  s.wanted.set('.map-section-toggle[data-section="layered"]', true);
  s.keepControlFocus(btn, () => {});
  assert.deepStrictEqual(s.focused, ['.map-section-toggle[data-section="layered"]']);
});

test('keepControlFocus does nothing when the pill is gone after the render', () => {
  const s = focusSandbox();
  s.keepControlFocus({ classList: ['map-filter-toggle'], dataset: { col: 'gone' } }, () => {});
  assert.deepStrictEqual(s.focused, []);
});

test('every pill and fold handler runs through keepControlFocus', () => {
  const calls = [
    [appSrc, /toggleMapSection\(sectionBtn\.dataset\.section\)/],
    [appSrc, /toggleMapStatusFilter\(filterBtn\.dataset\.col\)/],
    [appSrc, /soloMapStatusFilter\(filterBtn\.dataset\.col\)/],
    [appSrc, /toggleCalendarStatusFilter\(filterBtn\.dataset\.col\)/],
    [appSrc, /soloCalendarStatusFilter\(filterBtn\.dataset\.col\)/],
    [appSrc, /toggleGanttStatusFilter\(filterBtn\.dataset\.col\)/],
    [appSrc, /soloGanttStatusFilter\(filterBtn\.dataset\.col\)/],
    [graphSrc, /graphToggleFilter\(pill\.dataset\.col\)/],
    [graphSrc, /graphSoloFilter\(pill\.dataset\.col\)/],
  ];
  for (const [src, re] of calls) {
    const line = src.split('\n').find((l) => re.test(l));
    assert.ok(line, `${re} is called`);
    assert.match(line, /keepControlFocus\(/, `${re} is not wrapped: ${line.trim()}`);
  }
});

test('the pill and fold toggles are focusable controls the stylesheet rings', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  for (const cls of ['map-filter-toggle', 'gantt-filter-toggle', 'calendar-filter-toggle', 'graph-filter-toggle', 'map-section-toggle']) {
    const rule = css.split('\n').find((l) => l.includes('.' + cls + ':focus-visible'));
    assert.ok(rule && rule.includes('outline: 2px solid var(--accent)'), cls + ' has no focus ring');
  }
});

const PILL_CLASSES = ['map-filter-toggle', 'map-section-toggle', 'gantt-filter-toggle', 'calendar-filter-toggle', 'graph-filter-toggle graph-control'];

const NOT_A_CALL = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'await', 'async', 'do', 'else', 'throw', 'delete', 'void', 'with', 'in', 'of', 'instanceof', 'super', 'import', 'yield', 'class']);

// A board-load step the sandbox has never seen, a new apply* call in
// applyBoardData, must not turn this file red. A called name that the code
// under test does not define, that no explicit stub covers and that is not a
// builtin becomes a no-op. Explicit stubs stay as they are, and nothing here
// catches: known code that throws still throws.
function stubUnseenSteps(sandbox, code) {
  const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const declared = new Set([...bare.matchAll(/\b(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const m of bare.matchAll(/(?<![\w$.:])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (NOT_A_CALL.has(name) || declared.has(name)) continue;
    if (vm.runInContext(`typeof ${name}`, sandbox) !== 'undefined') continue;
    sandbox[name] = () => {};
  }
}

function pollSandbox(unseenStep) {
  const policy = require('../web/refresh-policy.js');
  const doc = { activeElement: null, current: null, visibilityState: 'visible' };
  const camel = (a) => a.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const matches = (el, sel) => sel.split(',').map((x) => x.trim()).some((x) => {
    const notM = /:not\(\.([\w-]+)\)/.exec(x);
    const attrs = [...x.matchAll(/\[([\w-]+)\]/g)].map((m) => camel(m[1]));
    const base = x.replace(/:not\(.*$/, '').replace(/\[[^\]]*\]/g, '').split('.').filter(Boolean);
    return base.every((c) => el.classList.includes(c)) && attrs.every((a) => a in el.dataset) && !(notM && el.classList.includes(notM[1]));
  });
  const makeEl = (cls, data) => ({
    classList: cls.split(' '), dataset: data, attached: true,
    closest(sel) { return matches(this, sel) ? this : null; },
    focus() { if (this.attached) doc.activeElement = this; },
  });
  doc.querySelector = (sel) => {
    const c = doc.current;
    const key = c && (c.dataset.col !== undefined ? 'col' : c.dataset.panel !== undefined ? 'panel' : 'section');
    return c && c.attached && sel === `.${c.classList[0]}[data-${key}="${c.dataset[key]}"]` ? c : null;
  };
  const sandbox = {
    document: doc, kanbanIds: require('../web/ids'), state: {}, selectedIds: new Set(), hoveredId: null,
    applyProjectName() {}, applyHomeUrl() {}, applyStatuses() {}, applyAssignees() {}, applyLists() {}, applyNotifications() {},
    setHoveredId: (id) => id, renderBoard() {},
    shouldSkipAutoRefresh: policy.shouldSkipAutoRefresh, isDragging: false, pendingDrops: 0,
    fetchBoard: async () => ({ active: [], archived: [] }), setStale() {},
  };
  vm.createContext(sandbox);
  const names = ['pageId', 'pageCard', 'boardControlFocused', 'refocusSelector', 'keepControlFocus', 'focusedRebuiltControl', 'applyBoardData', 'anyModalOpen', 'autoRefreshSkipState', 'autoRefreshTick'];
  const pillConst = appSrc.match(/const REFOCUS_SELECTOR = [^\n]*\n/);
  let code = (pillConst ? pillConst[0] : '') + names.map((n) => (appSrc.includes('function ' + n + '(') ? (appSrc.includes('async function ' + n + '(') ? 'async ' : '') + fn(n) : '')).join('\n');
  if (unseenStep) {
    const hooked = code.replace('applyNotifications(data.notifications', unseenStep + '(data); applyNotifications(data.notifications');
    assert.notStrictEqual(hooked, code, 'applyBoardData still ends by applying the notifications');
    code = hooked;
  }
  stubUnseenSteps(sandbox, code);
  vm.runInContext(code, sandbox);
  doc.querySelector = ((orig) => (sel) => (sel === '.modal-backdrop:not(.hidden)' ? null : orig(sel)))(doc.querySelector);
  return { sandbox, doc, makeEl, shouldSkip: policy.shouldSkipAutoRefresh };
}

test('a focused pill does not freeze the 5s poll, for every view', () => {
  for (const cls of PILL_CLASSES) {
    const { sandbox, doc, makeEl, shouldSkip } = pollSandbox();
    doc.activeElement = makeEl(cls, { col: 'done' });
    assert.strictEqual(sandbox.boardControlFocused(), false, cls);
    assert.strictEqual(shouldSkip({ modalOpen: false, dragging: false, hidden: false, boardControlFocused: sandbox.boardControlFocused() }), false, cls);
  }
});

test('a board load that runs a step the sandbox has never seen does not throw', () => {
  const { sandbox } = pollSandbox('applyBrandNewStep');
  assert.doesNotThrow(() => sandbox.applyBoardData({ active: [], archived: [] }));
});

test('the sandbox only stubs what it has never seen: an explicit stub is kept and known code still throws', () => {
  const { sandbox } = pollSandbox('applyBrandNewStep');
  assert.strictEqual(sandbox.setHoveredId('kept'), 'kept', 'the identity stub the tests rely on is not replaced by a no-op');
  sandbox.renderBoard = () => { throw new Error('render broke'); };
  assert.throws(() => sandbox.applyBoardData({ active: [], archived: [] }), /render broke/);
});

test('real form controls and graph buttons still hold the poll', () => {
  const { sandbox, doc, makeEl } = pollSandbox();
  for (const selector of ['.column-sort-field', '.column-sort-dir', '.cal-nav', '.column-add', '.column-add-ai', '.map-zoom-btn', '.map-option-btn', '.graph-button']) {
    for (const tag of tagsOf(selector)) {
      const built = elementOf(tag);
      doc.activeElement = makeEl(built.classList.join(' '), built.dataset);
      assert.strictEqual(sandbox.boardControlFocused(), true, `${selector}: ${tag.trim()}`);
    }
  }
});

test('the pills and fold toggles the page builds do not hold the poll, for every view', () => {
  const { sandbox, doc, makeEl } = pollSandbox();
  for (const selector of ['.map-filter-toggle', '.gantt-filter-toggle', '.calendar-filter-toggle', '.graph-filter-toggle', '.map-section-toggle']) {
    for (const tag of tagsOf(selector)) {
      const built = elementOf(tag);
      doc.activeElement = makeEl(built.classList.join(' '), built.dataset);
      assert.strictEqual(sandbox.boardControlFocused(), false, `${selector}: ${tag.trim()}`);
    }
  }
});

test('a poll render hands focus back to the rebuilt pill, without scrolling', () => {
  for (const cls of PILL_CLASSES) {
    const { sandbox, doc, makeEl } = pollSandbox();
    const data = cls.startsWith('map-section') ? { section: 'layered' } : { col: 'done' };
    const pill = makeEl(cls, data);
    doc.current = pill;
    doc.activeElement = pill;
    let opts;
    sandbox.renderBoard = () => {
      pill.attached = false;
      const next = makeEl(cls, data);
      next.focus = function (o) { opts = o; doc.activeElement = this; };
      doc.current = next;
      doc.activeElement = { closest: () => null };
    };
    sandbox.applyBoardData({ active: [], archived: [] });
    assert.strictEqual(doc.activeElement, doc.current, `${cls}: focus is on the rebuilt pill`);
    assert.strictEqual(opts && opts.preventScroll, true);
  }
});

test('refocusSelector escapes a backslash before a quote', () => {
  const s = focusSandbox();
  assert.strictEqual(s.refocusSelector({ classList: ['map-filter-toggle'], dataset: { col: 'a\\"b' } }), '.map-filter-toggle[data-col="a\\\\\\"b"]');
});

test('keepControlFocus refocuses without scrolling', () => {
  const opts = [];
  const sandbox = { document: { querySelector: () => ({ focus: (o) => opts.push(o) }) } };
  vm.runInNewContext(fn('refocusSelector') + '\n' + fn('keepControlFocus'), sandbox);
  sandbox.keepControlFocus({ classList: ['map-filter-toggle'], dataset: { col: 'x' } }, () => {});
  assert.strictEqual(opts.length, 1);
  assert.strictEqual(opts[0] && opts[0].preventScroll, true);
});

test('an off pill shows a hollow dot: ring kept, fill gone', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.off > \.pill-dot \{ background: transparent; \}/);
  assert.match(css, /\.pill-dot \{[^}]*background: currentColor; border: 1px solid currentColor;/);
});

test('the guard reads the marker: a pill that wears the poll marker holds the poll', () => {
  const { sandbox, doc, makeEl } = pollSandbox();
  doc.activeElement = makeEl('gantt-filter-toggle', { col: 'done', holdsPoll: '' });
  assert.strictEqual(sandbox.boardControlFocused(), true);
  doc.activeElement = makeEl('gantt-filter-toggle', { col: 'done' });
  assert.strictEqual(sandbox.boardControlFocused(), false, 'the same pill without the marker does not');
});

test('a real poll tick with the pointer resting on a card and a pill focused keeps the hover wash', async () => {
  const { sandbox, doc, makeEl } = pollSandbox();
  const pill = makeEl('gantt-filter-toggle', { col: 'done' });
  doc.current = pill;
  doc.activeElement = pill;
  sandbox.hoveredId = 7;
  sandbox.setHoveredId = (id) => { sandbox.hoveredId = id; };
  let rendered = 0;
  sandbox.renderBoard = () => {
    rendered++;
    pill.attached = false;
    const next = makeEl('gantt-filter-toggle', { col: 'done' });
    next.focus = function () { doc.activeElement = this; sandbox.hoveredId = null; };
    doc.current = next;
    doc.activeElement = { closest: () => null };
  };
  await sandbox.autoRefreshTick();
  assert.strictEqual(rendered, 1, 'the tick was not skipped');
  assert.strictEqual(sandbox.hoveredId, 7);
});

// The panel's icon button and the sheet's close button, run through the same poll and refocus
// rules the other rebuilt controls live under.
const panelButtonEl = (makeEl, cls = 'view-panel-toggle') => makeEl(cls, { panel: 'map', keepsSelection: '' });

for (const cls of ['view-panel-toggle', 'view-panel-close']) {
  test(`a focused ${cls} does not freeze the 5s poll`, () => {
    const { sandbox, doc, makeEl, shouldSkip } = pollSandbox();
    doc.activeElement = panelButtonEl(makeEl, cls);
    assert.strictEqual(sandbox.boardControlFocused(), false);
    assert.strictEqual(shouldSkip({ modalOpen: false, dragging: false, hidden: false, boardControlFocused: sandbox.boardControlFocused() }), false);
  });

  test(`a poll render hands focus back to the rebuilt ${cls}, without scrolling`, () => {
    const { sandbox, doc, makeEl } = pollSandbox();
    const button = panelButtonEl(makeEl, cls);
    doc.current = button;
    doc.activeElement = button;
    let opts;
    sandbox.renderBoard = () => {
      button.attached = false;
      const next = panelButtonEl(makeEl, cls);
      next.focus = function (o) { opts = o; doc.activeElement = this; };
      doc.current = next;
      doc.activeElement = { closest: () => null };
    };
    sandbox.applyBoardData({ active: [], archived: [] });
    assert.strictEqual(doc.activeElement, doc.current, 'focus is on the rebuilt button');
    assert.strictEqual(opts && opts.preventScroll, true);
  });

  test(`the ${cls} maps to a refocus selector that names its view`, () => {
    const s = focusSandbox();
    s.wanted.set(`.${cls}[data-panel="map"]`, true);
    s.keepControlFocus({ classList: [cls], dataset: { panel: 'map' } }, () => {});
    assert.deepStrictEqual(s.focused, [`.${cls}[data-panel="map"]`]);
  });
}

// A caption of the tier fan is a tab stop the Graph's render rebuilds, and it sits in no poll
// guard: the poll finds a focused one again by its key and focuses it, which shows its tip.
test('a focused caption of the tier fan does not hold the poll, and a poll render hands focus back to the rebuilt caption', () => {
  const { sandbox, doc, makeEl } = pollSandbox();
  const caption = () => {
    const el = makeEl('graph-caption', { caption: 'band-2' });
    el.getAttribute = (k) => (k === 'data-caption' ? 'band-2' : null);
    return el;
  };
  const old = caption();
  doc.activeElement = old;
  assert.strictEqual(sandbox.boardControlFocused(), false, 'the poll is not held');
  let next = null;
  let opts;
  const orig = doc.querySelector;
  doc.querySelector = (sel) => (sel === '[data-caption="band-2"]' ? next : orig(sel));
  sandbox.renderBoard = () => {
    old.attached = false;
    next = caption();
    next.focus = function (o) { opts = o; doc.activeElement = this; };
    doc.activeElement = { closest: () => null };
  };
  sandbox.applyBoardData({ active: [], archived: [] });
  assert.ok(next, 'the render rebuilt the caption');
  assert.strictEqual(doc.activeElement, next, 'focus is on the rebuilt caption');
  assert.strictEqual(opts && opts.preventScroll, true);
});

test('a poll render with no caption focused looks for none', () => {
  const { sandbox, doc, makeEl } = pollSandbox();
  doc.activeElement = makeEl('card-el', { id: '3' });
  const asked = [];
  const orig = doc.querySelector;
  doc.querySelector = (sel) => { asked.push(sel); return orig(sel); };
  sandbox.applyBoardData({ active: [], archived: [] });
  assert.ok(!asked.some((s) => s.includes('data-caption')), asked.join(' | '));
});
