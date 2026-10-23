const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/page-vm');

// The real page, run in a vm (helpers/page-vm.js) as the search-box writer's
// tests do: what makes the Calendar and the Gantt jump. The jump is a listener
// of the search box's writer, plus one hook on the view switch. A person types,
// clicks a cue, follows a link or switches view; the view's anchor day
// (calendarAnchor, ganttAnchor) is read back. The pure decision is pinned in
// calendar-gantt-jump.test.js.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const BOARD = {
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', body: 'orbit', status: 'doing', assignee: '@human', start_date: '2026-07-14', end_date: '2026-07-16' }),
    card(2, { title: 'Centennial review', body: 'orbit beacon', status: 'backlog', assignee: '@afk', start_date: '2031-06-02', end_date: '2031-06-20', due_date: '2031-06-25' }),
    card(3, { title: 'Retrospective', status: 'done', assignee: '@human', start_date: '2020-02-03', end_date: '2020-02-14' }),
    card(4, { title: 'Undated chore', assignee: '@human' }),
    card(5, { title: 'Leading day', due_date: '2026-07-28' }),
  ],
  archived: [card(9, { title: 'Old archived notes', body: 'beacon', archived: true, due_date: '2026-07-20' })],
};

// The page is started with the Calendar's and the Gantt's anchor on a July day
// that card 1 occupies, and the given view showing, with the box empty.
async function pageIn(view) {
  const page = loadPage({ board: BOARD });
  await page.start();
  page.run(`calendarAnchor = '2026-07-15'; ganttAnchor = '2026-07-15'`);
  if (view) page.run(`toggleView('${view}')`);
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return page;
}

// Counts the calls the page makes to one of its own global functions.
function countCalls(page, name) {
  const calls = { n: 0 };
  const real = page.ctx[name];
  page.ctx[name] = (...args) => { calls.n++; return real(...args); };
  return calls;
}

const calendarAnchor = (page) => page.run('calendarAnchor');
const ganttAnchor = (page) => page.run('ganttAnchor');

// --- the writer's listener ---------------------------------------------------------------

test('typing a query with no match in the Calendar\'s month moves the Calendar to the nearest match\'s month', async () => {
  const page = await pageIn('calendar');
  page.input.typed('centennial');
  assert.strictEqual(calendarAnchor(page), '2031-06-02');
  assert.strictEqual(page.run('currentCalendarMonth().year'), 2031);
  assert.strictEqual(page.run('currentCalendarMonth().monthIndex'), 5);
});

test('a query with a match in the Calendar\'s month leaves the Calendar where it is', async () => {
  const page = await pageIn('calendar');
  page.input.typed('zephyr');
  assert.strictEqual(calendarAnchor(page), '2026-07-15');
});

test('the Calendar jumps in its week, 3-day and day spans too, and keeps a match that a drawn day holds', async () => {
  for (const span of ['week', '3day', 'day']) {
    const page = await pageIn('calendar');
    page.run(`setCalendarSubview('${span}')`);
    page.run(`calendarAnchor = '2026-07-14'`);
    page.input.typed('zephyr');
    assert.strictEqual(calendarAnchor(page), '2026-07-14', `${span}: card 1 is drawn on the 14th`);
    page.input.typed('centennial');
    assert.strictEqual(calendarAnchor(page), '2031-06-02', `${span}: jumps to the match`);
  }
});

test('the Calendar day span draws one day, so a match on another day is not on screen', async () => {
  const page = await pageIn('calendar');
  page.run(`setCalendarSubview('day')`);
  page.run(`calendarAnchor = '2026-07-20'`);
  page.input.typed('zephyr');
  assert.strictEqual(calendarAnchor(page), '2026-07-16', 'card 1 ends on the 16th, the nearest day of it');
});

test('the Calendar month counts the leading and trailing days of its grid as drawn; the Gantt month does not', async () => {
  const calendar = await pageIn('calendar');
  calendar.run(`calendarAnchor = '2026-08-15'`);
  calendar.input.typed('leading');
  assert.strictEqual(calendarAnchor(calendar), '2026-08-15', 'August\'s grid starts on Monday 27 July, so the 28th is drawn');

  const gantt = await pageIn('gantt');
  gantt.run(`setGanttSubview('month')`);
  gantt.run(`ganttAnchor = '2026-08-15'`);
  gantt.input.typed('leading');
  assert.strictEqual(ganttAnchor(gantt), '2026-07-28', 'the Gantt\'s August window is the month\'s own days');
});

test('typing, a cue click and a ?q= link each make the check, and Dependency path from the card menu, which writes no query, moves nothing', async () => {
  const typing = await pageIn('calendar');
  typing.input.typed('centennial');
  assert.strictEqual(calendarAnchor(typing), '2031-06-02', 'typing');

  const cue = await pageIn('calendar');
  const tile = { dataset: { id: '2' } };
  const assigneeCue = { classList: { contains: (c) => c === 'card-assignee' }, textContent: '' };
  cue.fireDocument('click', {
    shiftKey: false, ctrlKey: false, metaKey: false,
    target: { closest: (sel) => (sel.split(',').map((x) => x.trim()).includes('.card-el') ? tile : sel.includes('.card-assignee') ? assigneeCue : null) },
  });
  assert.strictEqual(cue.input.value, 'assignee:@afk');
  assert.strictEqual(calendarAnchor(cue), '2031-06-02', 'a cue click');

  const menu = await pageIn('calendar');
  menu.rightClickCard(2);
  menu.menu.dpath.fire('click');
  assert.strictEqual(menu.input.value, '', 'Path adds to the selection and leaves the box alone');
  assert.strictEqual(calendarAnchor(menu), '2026-07-15', 'so the Calendar stays where it was');

  const link = loadPage({ board: BOARD, search: '?q=centennial&view=calendar' });
  await link.start();
  assert.strictEqual(link.run('loadViewMode()'), 'calendar');
  assert.strictEqual(calendarAnchor(link), '2031-06-02', 'a link');
});

test('clearing the box moves nothing: no query means no match to go to', async () => {
  const page = await pageIn('calendar');
  page.input.typed('centennial');
  page.clear.fire('click');
  assert.strictEqual(page.input.value, '');
  assert.strictEqual(calendarAnchor(page), '2031-06-02');
});

test('the Gantt\'s month, week, 3-day and day sub-views jump on a write; the all sub-view does not', async () => {
  for (const span of ['month', 'week', '3day', 'day']) {
    const page = await pageIn('gantt');
    page.run(`setGanttSubview('${span}')`);
    page.input.typed('centennial');
    assert.strictEqual(ganttAnchor(page), '2031-06-02', span);
  }
  const all = await pageIn('gantt');
  all.input.typed('centennial');
  assert.strictEqual(all.run('loadGanttSubview()'), 'all');
  assert.strictEqual(ganttAnchor(all), '2026-07-15');
});

test('a write made while another view shows moves neither the Calendar nor the Gantt', async () => {
  for (const view of [null, 'map', 'graph']) {
    const page = await pageIn(view);
    page.run(`setGanttSubview('month')`);
    page.input.typed('centennial');
    assert.strictEqual(calendarAnchor(page), '2026-07-15', String(view));
    assert.strictEqual(ganttAnchor(page), '2026-07-15', String(view));
  }
});

test('a write that repaints nothing jumps by the text it wrote, not by the match the last repaint made', async () => {
  const calendar = await pageIn('calendar');
  calendar.run(`writeSearch('centennial', 'selection', false)`);
  assert.strictEqual(calendar.input.value, 'centennial');
  assert.strictEqual(calendarAnchor(calendar), '2031-06-02');

  const gantt = await pageIn('gantt');
  gantt.run(`setGanttSubview('month')`);
  gantt.run(`writeSearch('centennial', 'selection', false)`);
  assert.strictEqual(ganttAnchor(gantt), '2031-06-02');
});

// --- entering a view ---------------------------------------------------------------------

test('entering the Calendar with the query already in the box makes the check once and shows the match\'s month, from any other view', async () => {
  for (const from of [null, 'map', 'gantt', 'graph']) {
    const page = await pageIn(from);
    page.input.typed('centennial');
    const calls = countCalls(page, 'nearestMatchDay');
    page.run(`toggleView('calendar')`);
    assert.strictEqual(calendarAnchor(page), '2031-06-02', `from ${from || 'the board'}`);
    assert.strictEqual(calls.n, 1, `from ${from || 'the board'}: one check`);
  }
});

test('entering the Calendar with a match already on screen, or with an empty box, moves nothing', async () => {
  const onScreen = await pageIn(null);
  onScreen.input.typed('zephyr');
  onScreen.run(`toggleView('calendar')`);
  assert.strictEqual(calendarAnchor(onScreen), '2026-07-15');
  const empty = await pageIn(null);
  empty.run(`toggleView('calendar')`);
  assert.strictEqual(calendarAnchor(empty), '2026-07-15');
});

test('entering the Gantt in a sized sub-view makes the check once; the all sub-view makes none', async () => {
  const sized = await pageIn(null);
  sized.run(`setGanttSubview('month')`);
  sized.input.typed('centennial');
  const calls = countCalls(sized, 'nearestMatchDay');
  sized.run(`toggleView('gantt')`);
  assert.strictEqual(ganttAnchor(sized), '2031-06-02');
  assert.strictEqual(calls.n, 1);

  const all = await pageIn(null);
  all.input.typed('centennial');
  const allCalls = countCalls(all, 'nearestMatchDay');
  all.run(`toggleView('gantt')`);
  assert.strictEqual(all.run('loadGanttSubview()'), 'all');
  assert.strictEqual(ganttAnchor(all), '2026-07-15', 'the all sub-view does not move');
  assert.strictEqual(allCalls.n, 0, 'and asks nothing of the function');
});

test('leaving a view makes no check', async () => {
  const page = await pageIn('calendar');
  page.input.typed('centennial');
  const calls = countCalls(page, 'nearestMatchDay');
  page.run(`toggleView('board')`);
  assert.strictEqual(calls.n, 0);
});

// --- what never jumps -----------------------------------------------------------------------

test('a poll, a re-render and paging with previous and next never make the check', async () => {
  const page = await pageIn('calendar');
  page.input.typed('centennial');
  page.run(`calendarAnchor = '2026-07-15'`);
  const calls = countCalls(page, 'nearestMatchDay');
  const ganttCalls = countCalls(page, 'ganttNearestMatchDay');
  await page.run('autoRefreshTick()');
  assert.strictEqual(calendarAnchor(page), '2026-07-15', 'the poll keeps the paged month');
  page.run('renderBoard()');
  page.run('renderCalendarView()');
  assert.strictEqual(calendarAnchor(page), '2026-07-15');
  page.run('shiftCalendarWindow(1)');
  assert.strictEqual(calendarAnchor(page), '2026-08-01');
  page.run('shiftCalendarWindow(-1)');
  assert.strictEqual(calendarAnchor(page), '2026-07-01');
  assert.strictEqual(calls.n, 0);
  assert.strictEqual(ganttCalls.n, 0);
  assert.strictEqual(page.input.value, 'centennial');
});

test('after a jump, previous and next page as usual and a poll keeps the paged month', async () => {
  const page = await pageIn('calendar');
  page.input.typed('centennial');
  assert.strictEqual(calendarAnchor(page), '2031-06-02');
  page.run('shiftCalendarWindow(1)');
  assert.strictEqual(calendarAnchor(page), '2031-07-01');
  page.run('shiftCalendarWindow(-1)');
  page.run('shiftCalendarWindow(-1)');
  assert.strictEqual(calendarAnchor(page), '2031-05-01');
  await page.run('autoRefreshTick()');
  assert.strictEqual(calendarAnchor(page), '2031-05-01');
});

test('after a jump the Gantt pages as usual and a poll keeps its window', async () => {
  const page = await pageIn('gantt');
  page.run(`setGanttSubview('month')`);
  page.input.typed('centennial');
  assert.strictEqual(ganttAnchor(page), '2031-06-02');
  page.run('shiftGanttWindow(1)');
  assert.strictEqual(ganttAnchor(page), '2031-07-01');
  await page.run('autoRefreshTick()');
  assert.strictEqual(ganttAnchor(page), '2031-07-01');
});

// --- shown means drawn ------------------------------------------------------------------------

test('a match a status pill hides does not count as on screen, in the Calendar and in the Gantt', async () => {
  const calendar = await pageIn('calendar');
  calendar.input.typed('orbit');
  assert.strictEqual(calendarAnchor(calendar), '2026-07-15', 'card 1 is on screen');
  calendar.run(`toggleCalendarStatusFilter('doing')`);
  calendar.clear.fire('click');
  calendar.input.typed('orbit');
  assert.strictEqual(calendarAnchor(calendar), '2031-06-02', 'the Doing pill hides card 1, so the nearest drawn match is card 2');

  const gantt = await pageIn('gantt');
  gantt.run(`setGanttSubview('month')`);
  gantt.input.typed('orbit');
  assert.strictEqual(ganttAnchor(gantt), '2026-07-15');
  gantt.run(`toggleGanttStatusFilter('doing')`);
  gantt.clear.fire('click');
  gantt.input.typed('orbit');
  assert.strictEqual(ganttAnchor(gantt), '2031-06-02');
});

test('a match the Archive pill hides does not count as on screen; with the pill on it does', async () => {
  const off = await pageIn('calendar');
  off.input.typed('beacon');
  assert.strictEqual(calendarAnchor(off), '2031-06-02', 'archived card 9 sits in July but is not drawn');
  const on = await pageIn('calendar');
  on.run('loadCalendarStatusFilter().archive = true');
  on.input.typed('beacon');
  assert.strictEqual(calendarAnchor(on), '2026-07-15', 'drawn, so on screen');
});

// The jump counts the cards viewShownCards names, and the views compose their own
// cards before they draw. This pins that the two agree: for each view, each query
// and each setting of the status pills and the Archive pill, the cards the view
// hands to its layout are the ones the jump counts as shown. The seams watched are
// the layout functions (monthChipLayout, timeGridLayout, ganttGroups and
// ganttArchiveGroup), the way search-views.test.js watches them.

const sortedIds = (cards) => Array.from(cards, (c) => c.id).sort((a, b) => a - b);

function recordCalls(page, name) {
  const calls = [];
  const real = page.ctx[name];
  page.ctx[name] = (...args) => { calls.push(args); return real(...args); };
  return calls;
}

const DRAWN_VIEWS = [
  { name: 'calendar month', mode: 'calendar', subview: 'month', input: 'calendarViewInput', layout: 'monthChipLayout' },
  { name: 'calendar week', mode: 'calendar', subview: 'week', input: 'calendarViewInput', layout: 'timeGridLayout' },
  { name: 'gantt', mode: 'gantt', input: 'ganttViewInput', layout: 'ganttGroups', archiveLayout: 'ganttArchiveGroup' },
];

const PILL_SETTINGS = [
  ['every pill on', {}],
  ['Doing off', { doing: false }],
  ['Archive on', { archive: true }],
  ['Doing off and Archive on', { doing: false, archive: true }],
];

const QUERIES = [null, 'orbit', 'beacon', 'assignee:@human', 'zephyr'];

test('the cards the jump counts as shown are the cards the Calendar and the Gantt hand to their layout', async () => {
  for (const view of DRAWN_VIEWS) {
    for (const [pillName, filter] of PILL_SETTINGS) {
      for (const query of QUERIES) {
        const label = `${view.name}, ${pillName}, ${query === null ? 'no query' : query}`;
        const stored = {
          'kanban.kanban.view.mode': view.mode,
          [`kanban.kanban.${view.mode}.statusFilter`]: JSON.stringify(filter),
        };
        if (view.subview) stored['kanban.kanban.calendar.subview'] = view.subview;
        const page = loadPage({ board: BOARD, stored });
        const layout = recordCalls(page, view.layout);
        const archiveLayout = view.archiveLayout ? recordCalls(page, view.archiveLayout) : [];
        await page.start();
        if (query !== null) {
          layout.length = 0;
          archiveLayout.length = 0;
          page.input.typed(query);
        }
        const [live, archived] = JSON.parse(page.run(
          `(() => { const s = viewShownCards(${view.input}()); return JSON.stringify([s.live.map((c) => c.id), s.archived.map((c) => c.id)]); })()`));
        assert.ok(layout.length > 0, `${label}: the view was laid out`);
        const handed = sortedIds(layout[0][0]);
        if (view.archiveLayout) {
          assert.deepStrictEqual(handed, live.slice().sort((a, b) => a - b), `${label}: live rows`);
          const handedArchived = archiveLayout.length ? sortedIds(archiveLayout[0][0]) : [];
          assert.deepStrictEqual(handedArchived, archived.slice().sort((a, b) => a - b), `${label}: archived rows`);
        } else {
          assert.deepStrictEqual(handed, live.concat(archived).sort((a, b) => a - b), label);
        }
      }
    }
  }
});

// A selection reaches the cards the view shows, and those are the dated ones among the cards
// the jump counts as shown. viewCardIds composes them on its own; this pins it to the same
// answer as the views' input, with the search box in (what a selection reaches) and out (what
// the pills' counts are taken over).
test('the cards a selection can reach in the Calendar and the Gantt are the dated cards the jump counts as shown', async () => {
  for (const view of DRAWN_VIEWS) {
    for (const [pillName, filter] of PILL_SETTINGS) {
      for (const query of QUERIES) {
        const label = `${view.name}, ${pillName}, ${query === null ? 'no query' : query}`;
        const stored = {
          'kanban.kanban.view.mode': view.mode,
          [`kanban.kanban.${view.mode}.statusFilter`]: JSON.stringify(filter),
        };
        if (view.subview) stored['kanban.kanban.calendar.subview'] = view.subview;
        const page = loadPage({ board: BOARD, stored });
        await page.start();
        if (query !== null) page.input.typed(query);
        for (const withSearch of [true, false]) {
          const counted = JSON.parse(page.run(
            `(() => { const s = viewShownCards(Object.assign(${view.input}(), ${withSearch ? '{}' : '{ searchIds: null }'})); return JSON.stringify(s.live.concat(s.archived).filter(cardIsScheduled).map((c) => c.id)); })()`));
          const reached = JSON.parse(page.run(`JSON.stringify([...viewCardIds(${withSearch})])`));
          assert.deepStrictEqual(reached.sort((a, b) => a - b), counted.sort((a, b) => a - b), `${label}, ${withSearch ? 'with' : 'without'} the search`);
        }
      }
    }
  }
});

// --- the web skill mentions the jump ---------------------------------------------------------------

test('SKILL.md describes the jump in the Calendar section and in the Gantt section', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const calendar = skill.match(/- \*\*Calendar view\*\*[\s\S]*?\n- \*\*Gantt view\*\*/);
  assert.ok(calendar, 'the Calendar view bullet is present');
  assert.match(calendar[0], /nearest match/);
  assert.match(calendar[0], /jumps/);
  const gantt = skill.match(/- \*\*Gantt view\*\*[\s\S]*?(?=\n- \*\*|\n## )/);
  assert.ok(gantt, 'the Gantt view bullet is present');
  assert.match(gantt[0], /nearest match/);
  assert.match(gantt[0], /\*\*All\*\* never jumps/);
});
