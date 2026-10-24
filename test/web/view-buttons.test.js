const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/page-vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8');
const MODES = ['board', 'calendar', 'gantt', 'map', 'graph'];
const IDLE = { calendar: 'Calendar', gantt: 'Gantt', map: 'Map view', graph: 'Graph' };
const BOARD = { projectName: 'k', statuses: ['todo'], priorities: [], assignees: [], tags: [], types: [], active: [], archived: [] };

const model = (page, mode) => JSON.parse(page.run(`JSON.stringify(viewButtonsModel(${JSON.stringify(mode)}))`));

test('the views table sits beside VIEW_CONTAINERS and names each view once as id, label, icon', () => {
  const page = loadPage({ board: BOARD });
  const table = JSON.parse(page.run('JSON.stringify(VIEW_TABLE)'));
  assert.deepStrictEqual(table.map((v) => v.id), MODES);
  assert.deepStrictEqual(table.map((v) => v.id).sort(), JSON.parse(page.run('JSON.stringify(Object.keys(VIEW_CONTAINERS))')).sort());
  for (const v of table.filter((x) => x.id !== 'board')) assert.deepStrictEqual([v.label, v.icon], [IDLE[v.id], v.id]);
});

test('the model gives each header button its label, icon and pressed state in every view mode', () => {
  const page = loadPage({ board: BOARD });
  for (const mode of MODES.filter((m) => m !== 'board')) {
    const buttons = model(page, mode).filter((r) => r.id !== 'board');
    assert.strictEqual(buttons.filter((r) => r.label === 'Board view').length, 1, mode);
    for (const r of buttons) {
      const got = { label: r.label, icon: r.icon, pressed: r.pressed };
      if (r.id === mode) assert.deepStrictEqual(got, { label: 'Board view', icon: 'board', pressed: true });
      else assert.deepStrictEqual(got, { label: IDLE[r.id], icon: r.id, pressed: false });
    }
  }
  const onBoard = model(page, 'board');
  assert.ok(onBoard.every((r) => r.label !== 'Board view'));
  assert.ok(onBoard.every((r) => r.pressed === (r.id === 'board')));
});

test('an unknown view mode falls back to the Board', () => {
  const page = loadPage({ board: BOARD });
  assert.deepStrictEqual(model(page, 'sixth'), model(page, 'board'));
  assert.deepStrictEqual(model(page, undefined), model(page, 'board'));
});

// A bare element that logs every write to textContent, aria-pressed and dataset.icon.
function fake(view) {
  const log = { text: [], pressed: [] };
  let text = '';
  const attrs = {};
  const el = {
    log,
    dataset: view ? { view } : {},
    get textContent() { return text; },
    set textContent(v) { text = String(v); log.text.push(text); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); if (k === 'aria-pressed') log.pressed.push(String(v)); },
    querySelector: () => null,
  };
  return el;
}

function toggle(view) {
  const el = fake(view);
  el.dataset.viewToggle = '';
  el.slot = fake();
  el.slot.dataset.icon = view;
  el.label = fake();
  el.label.textContent = IDLE[view];
  el.label.log.text.length = 0;
  el.querySelector = (sel) => (sel === '.btn-icon' ? el.slot : sel === '.btn-label' ? el.label : null);
  return el;
}

test('the painter writes a label and aria-pressed only when they change, and label text only on the header toggles', async () => {
  const toggles = ['calendar', 'gantt', 'map', 'graph'].map(toggle);
  const second = fake('map');
  const all = [...toggles, second];
  const page = await loadPage({
    board: BOARD,
    documentExtras: { querySelectorAll: (sel) => (sel === '[data-view-toggle], #view-bar [data-view]' ? all : sel === '.btn-icon' ? toggles.map((t) => t.slot) : []) },
  }).start();
  const [, , mapToggle, graphToggle] = toggles;
  const counts = () => JSON.stringify([...toggles.map((t) => [t.label.log.text.length, t.log.pressed.length]), second.log.pressed.length]);
  const before = counts();
  page.run('paintViewButtons("map")');
  assert.strictEqual(mapToggle.label.textContent, 'Board view');
  assert.strictEqual(mapToggle.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(second.getAttribute('aria-pressed'), 'true', 'a second set of view buttons gets aria-pressed');
  assert.strictEqual(second.log.text.length, 0, 'and no label text');
  assert.notStrictEqual(counts(), before);
  const after = counts();
  page.run('paintViewButtons("map")');
  assert.strictEqual(counts(), after, 'a second render with the same mode writes no label and no aria-pressed');
  page.run('paintViewButtons("graph")');
  assert.strictEqual(mapToggle.label.textContent, 'Map view');
  assert.strictEqual(graphToggle.label.textContent, 'Board view');
  assert.strictEqual(second.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(graphToggle.slot.dataset.icon, 'board');
  assert.strictEqual(mapToggle.slot.dataset.icon, 'map');
  assert.match(graphToggle.slot.innerHTML, /^<svg /, 'the slot is drawn from view-icons.js');
});

const header = html.slice(html.indexOf('<div class="actions">'), html.indexOf('</header>'));
const WORDS = { 'new-btn': 'New card', 'calendar-toggle-btn': 'Calendar', 'gantt-toggle-btn': 'Gantt', 'map-toggle-btn': 'Map view', 'graph-toggle-btn': 'Graph', 'refresh-btn': 'Refresh' };

test('each header button holds an icon slot and a label span with the words unchanged, and no emoji, style or inline handler', () => {
  for (const [id, words] of Object.entries(WORDS)) {
    const tag = header.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`));
    assert.ok(tag, id);
    assert.match(tag[0], /<span class="btn-icon"[^>]*aria-hidden="true"><\/span>/, `${id} icon slot`);
    assert.match(tag[0], new RegExp(`<span class="btn-label">${words}</span>`), `${id} label`);
    assert.doesNotMatch(tag[0], /[\u{1F000}-\u{1FFFF}☀-➿◉⟳]|\sstyle=|\son[a-z]+=/u, id);
  }
  for (const v of ['calendar', 'gantt', 'map', 'graph']) assert.match(header, new RegExp(`id="${v}-toggle-btn"[^>]*data-view="${v}" data-view-toggle`));
});
