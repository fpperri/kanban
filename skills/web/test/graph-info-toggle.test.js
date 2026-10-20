const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadPage, control, harmless } = require('./helpers/page-vm');
const { recordingDocument, recordingElement, byClass } = require('./helpers/recording-dom');

// The Graph's (i) toggle: the count line and the key stay in the view's DOM, hidden by a class
// while the toggle is off (the default), and the choice is kept per board. The Graph's and the
// Map's option buttons float in the drawing's top-right corner (source rules here; the browser
// runner measures them in Chrome: scenarios/view-panel.js and scenarios/phone-steps/graph-tops.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const makeBoard = (active) => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  hierarchy: ['goal', 'strategy'],
  assignees: [], tags: [], types: [], notifications: [],
  active: active || [card(1, { type: 'goal', status: 'doing' }), card(2, { parent: 1 })],
  archived: [],
});

const HIDDEN_SURFACES = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive'];
const KEY = 'kanban.kanban.graph.info';

async function open({ stored = {}, active } = {}) {
  const host = recordingElement('div');
  const elements = { '#graph-view': host };
  for (const sel of HIDDEN_SURFACES) { const el = control(); el.classList.add('hidden'); elements[sel] = el; }
  const all = { 'kanban.kanban.view.mode': 'graph', ...stored };
  const page = await loadPage({ board: makeBoard(active), stored: all, elements, documentExtras: recordingDocument() }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
  return {
    page, host, stored: all,
    info: () => byClass(host, 'graph-info-toggle')[0],
    box: () => byClass(host, 'graph-info')[0],
    press(el) {
      const target = new Proxy({}, {
        get: (t, k) => (k === 'closest' ? (sel) => (sel.split(',').some((s) => s.trim().split('.').slice(1).every((c) => el.classes.includes(c.replace(/\[.*/, '')))) ? el : null) : harmless(String(k))),
      });
      host.fire('click', { target, stopPropagation() {}, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false });
    },
  };
}

test('the (i) button has an accessible name, aria-pressed (off by default) and keeps the selection', async () => {
  const s = await open();
  const b = s.info();
  assert.ok(b, 'the (i) button is built');
  assert.strictEqual(b.tag, 'button');
  assert.ok(b.getAttribute('aria-label').length > 3);
  assert.strictEqual(b.getAttribute('aria-pressed'), 'false');
  assert.ok(b.dataset.keepsSelection !== undefined);
});

test('the top controls are the (i) and the option button; the count and the key stay in the DOM, hidden by a class while off', async () => {
  const s = await open();
  const row = byClass(s.host, 'graph-controls')[0];
  assert.deepStrictEqual(row.children.map((c) => c.classes[0]), ['graph-info-toggle', 'view-panel-toggle']);
  const box = s.box();
  assert.ok(box.classes.includes('graph-info-off'));
  assert.deepStrictEqual(box.children.map((c) => c.classes[0]), ['graph-count', 'graph-key']);
  assert.strictEqual(byClass(s.host, 'graph-count')[0].textContent, '2 cards, 1 relation');
  assert.match(byClass(s.host, 'graph-key')[0].textContent, /solid line: parent/);
});

test('a press on (i) shows the count and the key, is stored per board, and survives a re-render', async () => {
  const s = await open();
  s.press(s.info());
  assert.strictEqual(s.stored[KEY], 'true');
  assert.strictEqual(s.info().getAttribute('aria-pressed'), 'true');
  assert.ok(!s.box().classes.includes('graph-info-off'));
  s.host.children.length = 0;
  s.page.run('renderGraphView()');
  assert.strictEqual(s.info().getAttribute('aria-pressed'), 'true', 'a re-render keeps it');
  assert.ok(!s.box().classes.includes('graph-info-off'));
  s.press(s.info());
  assert.strictEqual(s.stored[KEY], 'false');
  assert.ok(s.box().classes.includes('graph-info-off'));
});

test('a kept choice is read back on the next page load', async () => {
  const s = await open({ stored: { [KEY]: 'true' } });
  assert.strictEqual(s.info().getAttribute('aria-pressed'), 'true');
  assert.ok(!s.box().classes.includes('graph-info-off'));
});

test('the empty state still shows the floating buttons', async () => {
  const s = await open({ active: [] });
  assert.strictEqual(byClass(s.host, 'graph-empty').length, 1);
  assert.strictEqual(byClass(s.host, 'graph-info-toggle').length, 1);
  assert.strictEqual(byClass(s.host, 'view-panel-toggle').length, 1);
});

test('the (i) is in REFOCUS_SELECTOR and refocusSelector finds it again', async () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  assert.match(app.match(/const REFOCUS_SELECTOR = [^\n]*/)[0], /\.graph-info-toggle/);
  const s = await open();
  assert.strictEqual(s.page.run('refocusSelector(document.querySelector ? {dataset:{graphInfo:""},classList:["graph-info-toggle"]} : null)'), '.graph-info-toggle');
});

test('app.css floats the Graph\'s controls and the Map\'s bar top-right on an opaque --paper ground, with top padding on .map-main', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');
  const rule = (sel) => { const m = css.match(new RegExp(`^${sel.replace(/[.]/g, '\\.')} \{([^}]*)\}`, 'm')); assert.ok(m, `${sel} has a rule`); return m[1]; };
  const controls = rule('.graph-controls');
  assert.match(controls, /position: absolute/);
  assert.match(controls, /top: \d+px/);
  assert.match(controls, /right: \d+px/);
  assert.match(controls, /z-index/);
  const bar = rule('.view-bar');
  assert.match(bar, /position: sticky/);
  assert.match(bar, /top: -?\d+px/);
  const pad = Number(/padding: (\d+)px 14px 14px/.exec(rule('.map-main'))[1]);
  assert.strictEqual(Number(/top: (-?\d+)px/.exec(bar)[1]), 10 - pad, 'a sticky offset counts from the padding edge in, so the bar sits 10px from the top of the scroll area');
  assert.match(css, /\.graph-info-toggle, \.view-panel-toggle \{[^}]*background: var\(--paper\)/);
  assert.match(rule('.graph-main'), /position: relative/);
  assert.match(rule('.map-main'), /padding: (3\d|4\d)px 14px 14px/);
  assert.match(css, /\.graph-info-off \{ display: none; \}/);
});

test('docs/web.md and SKILL.md say the count and the key sit behind (i)', () => {
  for (const f of [path.join(__dirname, '..', '..', '..', 'docs', 'web.md'), path.join(__dirname, '..', 'SKILL.md')]) {
    assert.match(fs.readFileSync(f, 'utf8'), /(count and (the )?key|key and (the )?(card )?count)[^.]*\(i\)|\(i\)[^.]*(count and (the )?key|card count and key)/i, f);
  }
});
