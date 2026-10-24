const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control } = require('./helpers/page-vm');

// The phone's search button (search-panel.js): under 760 px the search bar folds into a button in the
// header's top row, so the header is one row. A tap opens the search bar, full width in the header,
// and focuses the input; closing keeps the query. The button is lit while the box has text or the
// search chip counts any filter (a pill, a status switched off in the view, a slice cut, isolate).
// The stylesheet shows the button and hides the bar only under the line; the view bar hides while the
// input has focus. The real layout is looked at in the browser runner (phone-steps/search.js).

const WEB = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');
const css = read('app.css');

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});
const makeBoard = () => ({
  projectName: 'kanban', statuses: ['backlog', 'todo', 'doing', 'done'], priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [], hierarchy: [],
  active: [card(1), card(2, { status: 'doing' }), card(3, { status: 'done' })],
  archived: [],
});

const spied = (el) => {
  el.attrs = {};
  el.setAttribute = (k, v) => { el.attrs[k] = String(v); };
  el.getAttribute = (k) => (k in el.attrs ? el.attrs[k] : null);
  return el;
};

async function open({ view = 'board', stored = {} } = {}) {
  const elements = {};
  for (const sel of ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#search-panel']) {
    const el = control();
    el.classList.add('hidden');
    elements[sel] = el;
  }
  elements['#search-btn'] = spied(control());
  elements['.search-bar'] = control();
  const storage = { 'kanban.kanban.view.mode': view, ...stored };
  const page = await loadPage({ board: makeBoard(), stored: storage, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return { page, button: elements['#search-btn'], bar: elements['.search-bar'], elements };
}
const lit = (s) => s.button.classList.contains('lit');

// --- the lit state ------------------------------------------------------------------------------------

test('the button is not lit with an empty box and no filter', async () => {
  const s = await open();
  assert.strictEqual(lit(s), false);
});

test('the button lights up when the box holds a query and goes out when the query is cleared', async () => {
  const s = await open();
  s.page.input.typed('card 1');
  assert.strictEqual(lit(s), true);
  s.page.input.typed('');
  assert.strictEqual(lit(s), false);
});

test('the button is lit by a status switched off in the view, with an empty box', async () => {
  const off = JSON.stringify({ backlog: true, todo: true, doing: true, done: false, archive: false });
  const s = await open({ view: 'gantt', stored: { 'kanban.kanban.gantt.statusFilter': off } });
  assert.strictEqual(s.page.input.value, '');
  assert.strictEqual(lit(s), true, 'done is off in the Gantt, and the search chip counts it');
});

test('the button is lit by a pill that is on, and goes out when the pill goes off', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  s.page.run("applyPillGesture('toggle', 'review')");
  assert.strictEqual(lit(s), true);
  s.page.run("applyPillGesture('toggle', 'review')");
  assert.strictEqual(lit(s), false);
});

// --- opening and closing ---------------------------------------------------------------------------------

test('a tap on the button opens the search bar and focuses the input, and the button says it is expanded', async () => {
  const s = await open();
  let focused = 0;
  s.page.input.focus = () => { focused++; };
  s.button.fire('click', {});
  assert.strictEqual(s.bar.classList.contains('search-open'), true);
  assert.strictEqual(s.button.attrs['aria-expanded'], 'true');
  assert.strictEqual(focused, 1);
});

test('a second tap closes it and keeps the query and the lit button', async () => {
  const s = await open();
  s.button.fire('click', {});
  s.page.input.typed('card 2');
  s.button.fire('click', {});
  assert.strictEqual(s.bar.classList.contains('search-open'), false);
  assert.strictEqual(s.button.attrs['aria-expanded'], 'false');
  assert.strictEqual(s.page.input.value, 'card 2');
  assert.strictEqual(lit(s), true);
});

test('a press outside the search bar and the button closes the open field and keeps the query; a press inside, or on the button, does not', async () => {
  const s = await open();
  s.button.fire('click', {});
  s.page.input.typed('card 2');
  const press = (inside, onButton) => s.page.fireDocument('mousedown', { target: { closest: (sel) => (inside && sel === '.search-bar' ? {} : onButton && sel === '#search-btn' ? {} : null) } });
  press(true, false);
  assert.strictEqual(s.bar.classList.contains('search-open'), true);
  press(false, true);
  assert.strictEqual(s.bar.classList.contains('search-open'), true, 'the button\'s own click toggles it');
  press(false, false);
  assert.strictEqual(s.bar.classList.contains('search-open'), false);
  assert.strictEqual(s.page.input.value, 'card 2');
});

// --- the markup and the stylesheet ---------------------------------------------------------------------

const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));

test('markup: the search button is a button in .actions, right before #new-btn, with a name and no node moved', () => {
  const actions = header.slice(header.indexOf('<div class="actions">'));
  const at = actions.indexOf('id="search-btn"');
  assert.ok(at > -1, 'the button is in .actions');
  assert.ok(at < actions.indexOf('id="new-btn"'));
  const between = actions.slice(actions.indexOf('</button>', at), actions.indexOf('<button id="new-btn"')).replace(/\s|<!--[\s\S]*?-->/g, '');
  assert.strictEqual(between, '</button>', 'nothing between them');
  const tag = actions.match(/<button[^>]*id="search-btn"[^>]*>/)[0];
  assert.match(tag, /type="button"/);
  assert.match(tag, /aria-label="Search"/);
  assert.match(tag, /aria-expanded="false"/);
  assert.match(tag, /data-keeps-selection/);
  assert.doesNotMatch(header, /\sstyle=/);
  assert.ok(header.indexOf('<div class="search-bar">') < header.indexOf('<div class="actions">'), 'the bar stays where it was');
});

function mediaBlocks(source) {
  const out = [];
  const re = /@media \(max-width: 759\.98px\) \{/g;
  let m;
  while ((m = re.exec(source))) {
    let depth = 0;
    for (let i = source.indexOf('{', m.index); i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}' && --depth === 0) { out.push(source.slice(m.index, i + 1)); break; }
    }
  }
  return out;
}
const searchBlock = css.slice(css.indexOf('/* Search box and search panel'), css.indexOf('/* End search box and search panel */'));
const phoneRules = mediaBlocks(searchBlock).join('\n');

test('source: the button is not displayed from 760 px, and shown under it', () => {
  assert.match(css, /\.search-btn\s*\{[^}]*display:\s*none/);
  assert.match(phoneRules, /\.search-btn\s*\{[^}]*display:\s*inline-flex/);
});

test('source: under 760 px the search bar is hidden until opened, then spans the header on a row of its own, in the search block', () => {
  assert.match(phoneRules, /\.search-bar\s*\{[^}]*display:\s*none/);
  assert.match(phoneRules, /\.search-bar\.search-open\s*\{[^}]*display:\s*flex[^}]*flex:\s*1 1 100%/);
  const headerBlock = css.slice(css.indexOf('/* Phone header'), css.indexOf('.search-bar { position: relative'));
  assert.doesNotMatch(headerBlock, /\.search-bar\s*\{/, 'the header block no longer gives the bar its own row');
});

test('source: the lit button has a rule in the accent, and the view bar is not displayed while the search input has focus', () => {
  assert.match(css, /\.search-btn\.lit\s*\{[^}]*var\(--accent/);
  assert.match(phoneRules, /:has\(\.search-input:focus\)[^{]*#view-bar[^{]*\{[^}]*display:\s*none/);
});

test('source: no new width number is written for the button', () => {
  assert.doesNotMatch(searchBlock, /@media[^{]*\(\s*(?:min|max)-width: (?!759\.98px|760px)/);
});
