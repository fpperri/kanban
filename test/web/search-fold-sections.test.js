const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control } = require('./helpers/page-vm');

// The search panel's Typing isolates and On hover show sections in the real page (helpers/page-vm.js): each folds
// like the Slices, Pills and Statuses sections (one searchFoldSection each, search-panel.js), starts folded by
// default, starts as the preference says per board, and still unfolds for the visit by its fold control. The browser
// runner looks at the page itself (scenarios/search-panel.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const makeBoard = (name = 'kanban') => ({
  projectName: name,
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], notifications: [], hierarchy: [], types: [],
  active: [card(1), card(2, { status: 'doing' })],
  archived: [],
});

const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
const spied = (el) => {
  el.attrs = {};
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  return el;
};

async function open({ stored = {}, name = 'kanban' } = {}) {
  const elements = {};
  for (const sel of ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#search-panel']) elements[sel] = hidden();
  for (const n of ['typing', 'hover']) {
    elements[`#search-${n}`] = control();
    elements[`#search-${n}-fold`] = spied(control());
  }
  const host = control();
  host.querySelectorAll = () => [];
  elements['#search-hover'] = Object.assign(host, { classList: elements['#search-hover'].classList });
  elements['#search-hover-for'] = { textContent: '' };
  const store = { [`kanban.${name}.view.mode`]: 'board', ...stored };
  const page = await loadPage({ board: makeBoard(name), stored: store, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const s = {
    page, elements, stored: store,
    host: (n) => elements[`#search-${n}`],
    fold: (n) => elements[`#search-${n}-fold`],
    folded: (n) => elements[`#search-${n}`].classList.contains('hidden'),
    expanded: (n) => elements[`#search-${n}-fold`].attrs['aria-expanded'],
    press: (n) => elements[`#search-${n}-fold`].fire('click', {}),
  };
  return s;
}

for (const [n, prefKey, foldFn] of [['typing', 'typingFolded', 'foldSearchTyping'], ['hover', 'hoverFolded', 'foldSearchHover']]) {
  test(`the ${n} section starts folded by default, the fold control says so, and it unfolds and folds for the visit`, async () => {
    const s = await open();
    assert.strictEqual(s.folded(n), true);
    assert.strictEqual(s.expanded(n), 'false');
    s.press(n);
    assert.strictEqual(s.folded(n), false);
    assert.strictEqual(s.expanded(n), 'true');
    s.press(n);
    assert.strictEqual(s.folded(n), true);
    assert.strictEqual(s.expanded(n), 'false');
  });

  test(`the ${n} section starts unfolded when the preference says so for the board, and another board keeps the default`, async () => {
    const s = await open({ stored: { 'kanban.kanban.prefs': JSON.stringify({ [prefKey]: false }) } });
    assert.strictEqual(s.folded(n), false);
    assert.strictEqual(s.expanded(n), 'true');
    const other = await open({ name: 'other', stored: { 'kanban.kanban.prefs': JSON.stringify({ [prefKey]: false }) } });
    assert.strictEqual(other.folded(n), true, 'the preference is kept per board');
  });

  test(`the preference changing in the sheet folds and unfolds the ${n} section now`, async () => {
    const s = await open();
    s.page.run(`${foldFn}(false)`);
    assert.strictEqual(s.folded(n), false);
    s.page.run(`${foldFn}(true)`);
    assert.strictEqual(s.folded(n), true);
  });
}

test('the two sections fold apart: unfolding one leaves the other as it was', async () => {
  const s = await open();
  s.press('typing');
  assert.strictEqual(s.folded('typing'), false);
  assert.strictEqual(s.folded('hover'), true);
});

test('both sections use the one fold code of the Slices, Pills and Statuses sections', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const web = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
  const panel = fs.readFileSync(path.join(web, 'search-panel.js'), 'utf8');
  const hover = fs.readFileSync(path.join(web, 'hover-show-ui.js'), 'utf8');
  assert.match(panel, /searchFoldSection\('typingFolded', '#search-typing', '#search-typing-fold'\)/);
  assert.match(hover, /searchFoldSection\('hoverFolded', '#search-hover', '#search-hover-fold'\)/);
  assert.match(panel, /Slices, Statuses, Typing isolates and On hover show sections each hold one/);
});

