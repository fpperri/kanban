const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage } = require('./helpers/page-vm');

// Page wiring for the search box: the real page runs in a vm (helpers/page-vm.js)
// and a query is typed into its box. Each view hands its cards onward through a
// seam the test watches (a tile built, a layout asked for), so what is compared
// is what the view shows.

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
    card(1, { title: 'Zephyr migration', status: 'doing', assignee: '@human', tags: ['infra'] }),
    card(2, { title: 'Move the data layer', status: 'todo', assignee: '@afk', tags: ['ui'], waiting_for: [1] }),
    card(3, { title: 'Write the cutover plan', status: 'backlog', assignee: '@human', parent: 1 }),
    card(4, { title: 'Port the schema', status: 'todo', blocked: 'vendor has not shipped' }),
    card(5, { title: 'Draft the release notes', status: 'doing', review: 'copy needs eyes', tags: ['ui'] }),
    card(6, { title: 'Renew the domain', status: 'done', tags: ['ops'] }),
  ],
  archived: [
    card(7, { title: 'Spike zephyr pooling', status: 'done', archived: true, waiting_for: [1] }),
    card(8, { title: 'Close out the audit', status: 'done', archived: true, tags: ['ui'] }),
  ],
};
const ACTIVE = BOARD.active.map((c) => c.id);

// The cards each query matches over the whole board, live and archived. null is
// no query at all. Written out by hand: tree:1 reaches the archived card 7
// through its wait, and a bare `status:` is a term still being typed.
const MATCHES = [
  ['', null],
  ['   ', null],
  ['status:', null],
  ['zephyr', [1, 7]],
  ['status:doing', [1, 5]],
  ['assignee:@afk', [2]],
  ['a:@human', [1, 3]],
  ['tags:ui', [2, 5, 8]],
  ['tags:ui status:todo', [2]],
  ['blocked:', [4]],
  ['review:', [5]],
  ['#3', [3]],
  ['kanban#3', [3]],
  ['tree:1', [1, 2, 3, 7]],
  ['path:2', [1, 2, 3]],
  ['foo:bar', []],
  ['zephyr status:todo', []],
];

const VIEWS = {
  board: { mode: 'board' },
  map: { mode: 'map' },
  calendarMonth: { mode: 'calendar', subview: 'month' },
  calendarGrid: { mode: 'calendar', subview: 'week' },
  gantt: { mode: 'gantt' },
  graph: { mode: 'graph' },
};

// The cards a view shows for a match, by the rules the views have always had:
// the Board lists every card in its columns, the live views take the live cards
// and add the archived ones only while their Archive pill is on, the Map hands
// its filter the matching ids, and a view with no query shows everything. The
// Graph is the exception: a query typed there lights its matches and hides
// nothing, so it draws every card whatever the query, bar a slice: term on its own,
// which cuts and is pinned in search-slice-views.test.js (graph-lights-wiring.test.js
// looks at what is lit).
function expected(view, match, archive) {
  const everything = ACTIVE.concat(BOARD.archived.map((c) => c.id));
  const all = match === null ? everything : match;
  if (view === 'graph') return (archive ? everything : ACTIVE).slice().sort((a, b) => a - b);
  if (view === 'board') return all.slice().sort((a, b) => a - b);
  if (view === 'map') return match === null ? null : match.slice().sort((a, b) => a - b);
  if (archive) return all.slice().sort((a, b) => a - b);
  return all.filter((id) => ACTIVE.includes(id)).sort((a, b) => a - b);
}

async function openView(name, { archive = false } = {}) {
  const v = VIEWS[name];
  const stored = { 'kanban.kanban.view.mode': v.mode, 'kanban.kanban.columns.collapsed': JSON.stringify({ archive: false }) };
  if (v.subview) stored['kanban.kanban.calendar.subview'] = v.subview;
  if (archive) {
    stored['kanban.kanban.gantt.statusFilter'] = JSON.stringify({ archive: true });
    stored['kanban.kanban.calendar.statusFilter'] = JSON.stringify({ archive: true });
    stored['kanban.kanban.graph.statusFilter'] = JSON.stringify({ archive: true });
  }
  const page = await loadPage({ board: BOARD, stored }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const seen = { tiles: [], relations: undefined, month: undefined, grid: undefined, gantt: undefined, ganttArchive: undefined, graph: undefined, parsed: 0, matched: 0 };
  const wrap = (fnName, record) => {
    const real = page.ctx[fnName];
    assert.strictEqual(typeof real, 'function', `${fnName} is a function in the page`);
    page.ctx[fnName] = (...args) => { record(...args); return real(...args); };
  };
  const ids = (cards) => Array.from(cards, (c) => c.id).sort((a, b) => a - b);
  wrap('cardEl', (c) => seen.tiles.push(c.id));
  wrap('archiveCardEl', (c) => seen.tiles.push(c.id));
  wrap('buildRelationsGraph', (cards, visibleIds) => { seen.relations = visibleIds ? [...visibleIds].sort((a, b) => a - b) : null; });
  wrap('monthChipLayout', (cards) => { seen.month = ids(cards); });
  wrap('timeGridLayout', (cards) => { seen.grid = ids(cards); });
  wrap('ganttGroups', (cards) => { if (seen.gantt === undefined) seen.gantt = ids(cards); });
  wrap('ganttArchiveGroup', (cards) => { if (seen.ganttArchive === undefined) seen.ganttArchive = ids(cards); });
  wrap('graphBuild', (cards, opts) => { seen.graph = opts.visibleIds ? [...opts.visibleIds].sort((a, b) => a - b) : null; });
  wrap('parseSearchQuery', () => { seen.parsed++; });
  wrap('filterCards', () => { seen.matched++; });
  return { page, seen };
}

function shown(name, seen, archive) {
  const sorted = (list) => list.slice().sort((a, b) => a - b);
  switch (name) {
    case 'board': return sorted(seen.tiles);
    case 'map': return seen.relations;
    case 'calendarMonth': return seen.month;
    case 'calendarGrid': return seen.grid;
    case 'gantt': return sorted(seen.gantt.concat(archive ? seen.ganttArchive : []));
    case 'graph': return seen.graph === null ? expectedGraphAll(archive) : seen.graph;
    default: throw new Error(name);
  }
}
// The Graph draws everything when nothing narrows it; its pills leave archived cards out until Archive is on.
const expectedGraphAll = (archive) => (archive ? ACTIVE.concat(BOARD.archived.map((c) => c.id)) : ACTIVE).sort((a, b) => a - b);

for (const name of Object.keys(VIEWS)) {
  for (const archive of name === 'board' || name === 'map' ? [false] : [false, true]) {
    const what = name === 'graph' ? 'keeps drawing every card, for a query with no slice: term' : 'shows, for each query, the cards it showed before';
    test(`${name}${archive ? ' with Archive on' : ''} ${what}`, async () => {
      const { page, seen } = await openView(name, { archive });
      for (const [query, match] of MATCHES) {
        seen.tiles.length = 0;
        seen.relations = seen.month = seen.grid = seen.gantt = seen.ganttArchive = seen.graph = undefined;
        page.input.typed(query);
        assert.deepStrictEqual(shown(name, seen, archive), expected(name, match, archive), `${name}, query ${JSON.stringify(query)}`);
      }
    });
  }
}

// One render parses the box and matches it once, whichever view is showing; the
// board always repaints with the active view, so before this the Map, Calendar,
// Gantt and Graph each did it a second time.
const REPAINT = {
  board: null,
  map: 'renderMapView()',
  calendarMonth: 'renderCalendarView()',
  calendarGrid: 'renderCalendarView()',
  gantt: 'renderGanttView()',
  graph: 'renderGraphView()',
};

for (const name of Object.keys(VIEWS)) {
  test(`${name}: one render parses and matches the query once`, async () => {
    const { page, seen } = await openView(name);
    page.input.typed('tree:1');
    assert.strictEqual(seen.parsed, 1, 'parsed once');
    assert.strictEqual(seen.matched, 1, 'matched once');
    seen.parsed = seen.matched = 0;
    page.input.typed('');
    assert.strictEqual(seen.parsed, 1, 'an empty box is still read once');
    assert.strictEqual(seen.matched, 0, 'and there is nothing to match');
    seen.parsed = seen.matched = 0;
    page.input.typed('zephyr');
    seen.parsed = seen.matched = 0;
    page.run('renderBoard()');
    assert.strictEqual(seen.parsed, 1, 'a repaint with no write parses once');
    assert.strictEqual(seen.matched, 1, 'a repaint with no write matches once');
  });

  if (REPAINT[name]) {
    test(`${name}: a view repainted on its own reads the box once for that repaint`, async () => {
      const { page, seen } = await openView(name);
      page.input.typed('zephyr');
      seen.parsed = seen.matched = 0;
      page.run(REPAINT[name]);
      assert.strictEqual(seen.parsed, 1);
      assert.strictEqual(seen.matched, 1);
    });
  }
}

test('a poll parses and matches the query once for its repaint', async () => {
  const { page, seen } = await openView('gantt');
  page.input.typed('zephyr');
  seen.parsed = seen.matched = 0;
  await page.run('autoRefreshTick()');
  assert.strictEqual(seen.parsed, 1);
  assert.strictEqual(seen.matched, 1);
});
