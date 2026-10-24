const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control } = require('./helpers/page-vm');
const { PHONE_WIDTH_QUERY } = require('../web/phone-width');

// On a phone the Calendar's and the Gantt's date range sits in the header beside the board's name, and the
// view bar's own title (.cal-title) steps aside. The Web keeps .cal-title at every width; the header slot
// is shown under the width line only, and only while it holds text.

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
const BOARD = {
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [{
    id: 1, title: 'Card 1', body: '', status: 'doing', priority: 'Normal', waiting_for: [], blocked: null,
    review: null, tags: [], assignee: null, type: null, start_date: '2026-07-14', end_date: '2026-07-16', due_date: null,
    parent: null, rank: null, file: '/board/1.card.md', archived: false,
  }],
  archived: [],
};

test('the header date text is the given title for the Calendar and the Gantt and empty for every other view', () => {
  const page = loadPage({ board: BOARD });
  const text = (mode, title) => page.run(`headerDateText(${JSON.stringify(mode)}, ${JSON.stringify(title)})`);
  assert.strictEqual(text('calendar', 'July 2026'), 'July 2026');
  assert.strictEqual(text('gantt', 'All dated cards'), 'All dated cards');
  for (const mode of ['board', 'map', 'graph', 'sixth']) assert.strictEqual(text(mode, 'July 2026'), '', mode);
});

test('the markup has a header date slot right after the h1, hidden while empty, with no style attribute', () => {
  const slot = html.match(/<h1>[\s\S]*?<\/h1>\s*(?:<!--[\s\S]*?-->\s*)*(<[^>]*id="header-date"[^>]*>)/);
  assert.ok(slot, 'the slot follows the h1');
  assert.match(slot[1], /class="[^"]*\bhidden\b/);
  assert.doesNotMatch(slot[1], /style=/);
});

async function pageWith() {
  const slot = control();
  slot.classList.add('hidden');
  const elements = { '#header-date': slot, '#calendar-view': control(), '#gantt-view': control() };
  const page = loadPage({ board: BOARD, elements });
  await page.start();
  return { page, slot };
}

test('after the Calendar renders the slot holds its title and shows; after a switch to the Board it is empty and hidden', async () => {
  const { page, slot } = await pageWith();
  page.run(`toggleView('calendar')`);
  const title = page.run(`subviewTitle(loadCalendarSubview(), currentCalendarAnchor())`);
  assert.ok(title.length > 0);
  assert.strictEqual(slot.textContent, title);
  assert.strictEqual(slot.classList.contains('hidden'), false);
  page.run(`toggleView('calendar')`);
  assert.strictEqual(slot.textContent, '');
  assert.strictEqual(slot.classList.contains('hidden'), true);
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
});

test('the Gantt writes its title into the slot, All dated cards on All, and a switch to the Map clears it', async () => {
  const { page, slot } = await pageWith();
  page.run(`toggleView('gantt')`);
  assert.strictEqual(page.run(`loadGanttSubview()`), 'all');
  assert.strictEqual(slot.textContent, 'All dated cards');
  page.run(`setGanttSubview('week')`);
  assert.strictEqual(slot.textContent, page.run(`subviewTitle('week', currentGanttAnchor())`));
  page.run(`toggleView('map')`);
  assert.strictEqual(slot.textContent, '');
  assert.strictEqual(slot.classList.contains('hidden'), true);
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
});

test('the stylesheet shows the slot and hides .cal-title in one phone block, and the slot is not displayed from the width line up', () => {
  assert.match(css, /\.header-date \{ display: none;/);
  const at = css.indexOf(`@media ${PHONE_WIDTH_QUERY} {\n  .header-date`);
  assert.ok(at >= 0, 'a phone block opens with the slot rule');
  const block = css.slice(at, css.indexOf('\n}', at));
  assert.match(block, /\.header-date:not\(\.hidden\) \{[^}]*display: block[^}]*flex: 1 1 auto[^}]*min-width: 0[^}]*text-overflow: ellipsis/);
  assert.match(block, /\.cal-title \{ display: none/);
  assert.strictEqual(css.split('.cal-title { display: none').length, 2, 'only the phone block hides it');
});
