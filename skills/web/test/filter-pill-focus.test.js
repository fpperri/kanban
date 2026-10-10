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
