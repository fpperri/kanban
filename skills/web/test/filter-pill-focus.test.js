const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
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
  vm.runInNewContext(fn('pillSelector') + '\n' + fn('keepPillFocus'), sandbox);
  return sandbox;
}

test('keepPillFocus puts focus back on the same pill after the row re-renders', () => {
  const s = focusSandbox();
  const pill = { classList: ['gantt-filter-toggle'], dataset: { col: 'in-progress' } };
  s.wanted.set('.gantt-filter-toggle[data-col="in-progress"]', true);
  s.keepPillFocus(pill, () => s.log.push('rendered'));
  assert.deepStrictEqual(s.log, ['rendered']);
  assert.deepStrictEqual(s.focused, ['.gantt-filter-toggle[data-col="in-progress"]']);
});

test('keepPillFocus refocuses a section fold toggle by its section', () => {
  const s = focusSandbox();
  const btn = { classList: ['map-section-toggle'], dataset: { section: 'layered' } };
  s.wanted.set('.map-section-toggle[data-section="layered"]', true);
  s.keepPillFocus(btn, () => {});
  assert.deepStrictEqual(s.focused, ['.map-section-toggle[data-section="layered"]']);
});

test('keepPillFocus does nothing when the pill is gone after the render', () => {
  const s = focusSandbox();
  s.keepPillFocus({ classList: ['map-filter-toggle'], dataset: { col: 'gone' } }, () => {});
  assert.deepStrictEqual(s.focused, []);
});

test('every pill and fold handler runs through keepPillFocus', () => {
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
    assert.match(line, /keepPillFocus\(/, `${re} is not wrapped: ${line.trim()}`);
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

function pollSandbox(mutateGuard) {
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
    return c && c.attached && sel === `.${c.classList[0]}[data-${c.dataset.col !== undefined ? 'col' : 'section'}="${c.dataset.col !== undefined ? c.dataset.col : c.dataset.section}"]` ? c : null;
  };
  const sandbox = {
    document: doc, state: {}, selectedIds: new Set(), hoveredId: null,
    applyProjectName() {}, applyHomeUrl() {}, applyStatuses() {}, applyAssignees() {}, applyLists() {}, applyNotifications() {},
    pruneSelection: (s) => s, setHoveredId() {}, renderBoard() {},
    shouldSkipAutoRefresh: policy.shouldSkipAutoRefresh, isDragging: false, pendingDrops: 0,
    fetchBoard: async () => ({ active: [], archived: [] }), setStale() {},
  };
  vm.createContext(sandbox);
  const names = ['boardControlFocused', 'pillSelector', 'keepPillFocus', 'focusedPill', 'applyBoardData', 'anyModalOpen', 'autoRefreshSkipState', 'autoRefreshTick'];
  const pillConst = appSrc.match(/const PILL_SELECTOR = [^\n]*\n/);
  let code = (pillConst ? pillConst[0] : '') + names.map((n) => (appSrc.includes('function ' + n + '(') ? (appSrc.includes('async function ' + n + '(') ? 'async ' : '') + fn(n) : '')).join('\n');
  if (mutateGuard) code = code.replace("closest('.column-sort-field,", "closest('" + mutateGuard + ", .column-sort-field,");
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

test('real form controls and graph buttons still hold the poll', () => {
  const { sandbox, doc, makeEl } = pollSandbox();
  for (const cls of ['column-sort-field', 'cal-nav', 'column-add', 'map-zoom-btn', 'map-option-btn', 'graph-layout-btn graph-control']) {
    doc.activeElement = makeEl(cls, {});
    assert.strictEqual(sandbox.boardControlFocused(), true, cls);
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

test('pillSelector escapes a backslash before a quote', () => {
  const s = focusSandbox();
  assert.strictEqual(s.pillSelector({ classList: ['map-filter-toggle'], dataset: { col: 'a\\"b' } }), '.map-filter-toggle[data-col="a\\\\\\"b"]');
});

test('keepPillFocus refocuses without scrolling', () => {
  const opts = [];
  const sandbox = { document: { querySelector: () => ({ focus: (o) => opts.push(o) }) } };
  vm.runInNewContext(fn('pillSelector') + '\n' + fn('keepPillFocus'), sandbox);
  sandbox.keepPillFocus({ classList: ['map-filter-toggle'], dataset: { col: 'x' } }, () => {});
  assert.strictEqual(opts.length, 1);
  assert.strictEqual(opts[0] && opts[0].preventScroll, true);
});

test('an off pill shows a hollow dot: ring kept, fill gone', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.off > \.pill-dot \{ background: transparent; \}/);
  assert.match(css, /\.pill-dot \{[^}]*background: currentColor; border: 1px solid currentColor;/);
});

test('the matcher catches a pill re-added to the poll guard with an attribute selector', () => {
  const { sandbox, doc, makeEl } = pollSandbox('.gantt-filter-toggle[data-col]');
  doc.activeElement = makeEl('gantt-filter-toggle', { col: 'done' });
  assert.strictEqual(sandbox.boardControlFocused(), true);
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

// The Map's Options toggle, read back from the row the app builds, run through the same poll
// and refocus rules the other fold toggles live under.
function optionsToggleEl(makeEl) {
  const { optionsRowSandbox, optionsToggleOf } = require('./helpers/options-row');
  const html = optionsRowSandbox().buildMapOptionsRow().outerHTML;
  const toggle = optionsToggleOf(html);
  assert.ok(toggle, 'the Options toggle is in the row');
  return makeEl(toggle.classList.join(' '), { section: 'options' });
}

test('a focused Options toggle does not freeze the 5s poll', () => {
  const { sandbox, doc, makeEl, shouldSkip } = pollSandbox();
  doc.activeElement = optionsToggleEl(makeEl);
  assert.strictEqual(sandbox.boardControlFocused(), false);
  assert.strictEqual(shouldSkip({ modalOpen: false, dragging: false, hidden: false, boardControlFocused: sandbox.boardControlFocused() }), false);
});

test('a poll render hands focus back to the rebuilt Options toggle, without scrolling', () => {
  const { sandbox, doc, makeEl } = pollSandbox();
  const toggle = optionsToggleEl(makeEl);
  doc.current = toggle;
  doc.activeElement = toggle;
  let opts;
  sandbox.renderBoard = () => {
    toggle.attached = false;
    const next = optionsToggleEl(makeEl);
    next.focus = function (o) { opts = o; doc.activeElement = this; };
    doc.current = next;
    doc.activeElement = { closest: () => null };
  };
  sandbox.applyBoardData({ active: [], archived: [] });
  assert.strictEqual(doc.activeElement, doc.current, 'focus is on the rebuilt toggle');
  assert.strictEqual(opts && opts.preventScroll, true);
});

test('pressing the Options toggle refocuses it after the row rebuilds', () => {
  const s = focusSandbox();
  const { optionsRowSandbox, optionsToggleOf } = require('./helpers/options-row');
  const toggle = optionsToggleOf(optionsRowSandbox().buildMapOptionsRow().outerHTML);
  assert.ok(toggle, 'the Options toggle is in the row');
  s.wanted.set(`.${toggle.classList[0]}[data-section="options"]`, true);
  s.keepPillFocus({ classList: toggle.classList, dataset: toggle.dataset }, () => {});
  assert.deepStrictEqual(s.focused, ['.map-section-toggle[data-section="options"]']);
});
