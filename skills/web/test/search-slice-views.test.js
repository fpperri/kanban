const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage } = require('./helpers/page-vm');

// A slice: term in the real page's search box cuts every view to the same cards.
// The page runs in a vm (helpers/page-vm.js), the board answer carries a
// hierarchy, and each view hands its cards onward through a seam the test
// watches (a tile built, a layout asked for), as search-views.test.js does for
// the old forms. Which cards a cut keeps is the search module's, pinned in
// search-slice.test.js; what is pinned here is that the page hands the module
// the board's hierarchy and the whole board, so a view that hides cards (an
// archived parent, a status pill) never moves one to another slice.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// The slices, top first: goal 1, strategy 2, objective 3, epic 4, then the depths
// of the cards with no tier: depth 0 holds 6, depth 1 holds the archived 7,
// depth 2 holds 8 (under the archived 7), depth 4 holds 5 (under epic 4).
const BOARD = {
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  hierarchy: ['goal', 'Strategy', 'objective', 'epic'],
  pills: [],
  active: [
    card(1, { type: 'goal', status: 'doing' }),
    card(2, { type: 'strategy', parent: 1 }),
    card(3, { type: 'objective', parent: 2 }),
    card(4, { type: 'epic', parent: 3 }),
    card(5, { type: 'story', parent: 4 }),
    card(6, { type: 'task' }),
    card(8, { parent: 7 }),
  ],
  archived: [card(7, { parent: 1, archived: true, status: 'done' })],
};
const ACTIVE = BOARD.active.map((c) => c.id);
const ARCHIVED = BOARD.archived.map((c) => c.id);

// The cards each query matches over the whole board, live and archived, written out by hand.
// A third entry of false marks a query whose slice: term sits under |: the Graph does
// not cut for it, it lights the matches and draws every card.
const MATCHES = [
  ['slice:goal..objective', [1, 2, 3]],
  ['slice:..strategy', [1, 2]],
  ['slice:Epic', [4]],
  ['slice:epic..0', [4, 6]],
  ['slice:2', [8]],
  ['slice:1', [7]],
  ['slice:4..', [5]],
  ['slice:nowhere', [1, 2, 3, 4, 5, 6, 7, 8]],
  ['slice:goal..objective | #6', [1, 2, 3, 6], false],
];

const VIEWS = {
  board: { mode: 'board' },
  map: { mode: 'map' },
  calendarMonth: { mode: 'calendar', subview: 'month' },
  calendarGrid: { mode: 'calendar', subview: 'week' },
  gantt: { mode: 'gantt' },
  graph: { mode: 'graph' },
};

// The cards a view shows for a match, by the rules the views have always had: the
// Board lists every card in its columns, the live views take the live cards and
// add the archived ones only while their Archive pill is on, and the Map hands its
// filter the matching ids. The Graph cuts for a slice: term on its own and, for one
// under |, draws everything, since a query typed there lights and hides nothing else.
function expected(view, match, archive, cuts = true) {
  const sorted = (list) => list.slice().sort((a, b) => a - b);
  if (view === 'graph' && !cuts) return sorted(archive ? ACTIVE.concat(ARCHIVED) : ACTIVE);
  if (view === 'board') return sorted(match);
  if (view === 'map') return sorted(match);
  return sorted(match.filter((id) => archive || ACTIVE.includes(id)));
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
  const seen = { tiles: [], relations: undefined, month: undefined, grid: undefined, gantt: undefined, ganttArchive: undefined, graph: undefined };
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
    case 'graph': return seen.graph || sorted(ACTIVE.concat(ARCHIVED));
    default: throw new Error(name);
  }
}

for (const name of Object.keys(VIEWS)) {
  for (const archive of name === 'board' || name === 'map' ? [false] : [false, true]) {
    test(`${name}${archive ? ' with Archive on' : ''} shows, for each slice: query, the cards in the cut`, async () => {
      const { page, seen } = await openView(name, { archive });
      for (const [query, match, cuts] of MATCHES) {
        seen.tiles.length = 0;
        seen.relations = seen.month = seen.grid = seen.gantt = seen.ganttArchive = seen.graph = undefined;
        page.input.typed(query);
        assert.deepStrictEqual(shown(name, seen, archive), expected(name, match, archive, cuts), `${name}, query ${JSON.stringify(query)}`);
      }
    });
  }
}

test('a board answer with no hierarchy cuts by depth, and a hierarchy the page was never given names no tier', async () => {
  const bare = { ...BOARD, hierarchy: undefined };
  const stored = { 'kanban.kanban.view.mode': 'board', 'kanban.kanban.columns.collapsed': JSON.stringify({ archive: false }) };
  const page = await loadPage({ board: bare, stored }).start();
  const tiles = [];
  for (const fnName of ['cardEl', 'archiveCardEl']) {
    const real = page.ctx[fnName];
    page.ctx[fnName] = (c, ...rest) => { tiles.push(c.id); return real(c, ...rest); };
  }
  const shownFor = (query) => {
    tiles.length = 0;
    page.input.typed(query);
    return tiles.slice().sort((a, b) => a - b);
  };
  assert.deepStrictEqual(shownFor('slice:1'), [2, 7], 'depth 1 holds the strategy and the archived story');
  assert.deepStrictEqual(shownFor('slice:goal'), [1, 2, 3, 4, 5, 6, 7, 8], 'no hierarchy, so goal names no slice and cuts nothing');
});

test('the page hands the module the whole board, so an archived parent hidden by its Archive pill still sets the depth below it', async () => {
  const { page, seen } = await openView('gantt', { archive: false });
  page.input.typed('slice:2');
  assert.deepStrictEqual(shown('gantt', seen, false), [8], 'card 8 sits under the archived card 7 and is at depth 2');
  assert.deepStrictEqual(ARCHIVED, [7]);
});
