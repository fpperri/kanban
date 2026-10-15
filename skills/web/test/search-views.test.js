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
// its filter the matching ids, and a view with no query shows everything.
function expected(view, match, archive) {
  const everything = ACTIVE.concat(BOARD.archived.map((c) => c.id));
  const all = match === null ? everything : match;
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
    test(`${name}${archive ? ' with Archive on' : ''} shows, for each query, the cards it showed before`, async () => {
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
