const { test } = require('node:test');
const assert = require('node:assert');

const { loadPage } = require('./helpers/page-vm');

// The Archive pill and the Archive column count the archived cards the page holds now, not only the
// ones it was built with: a card archived in the page makes a "not in this page" pill a working one, and
// the total grows and shrinks with the page's own archives.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const board = (archivedIds, archiveHeld) => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [card(1), card(2)],
  archived: archivedIds.map((id) => card(id, { archived: true })),
  snapshot: { query: '', archive: false, label: 'live cards only', ...(archiveHeld ? { archiveHeld } : {}) },
});

async function words(archivedIds, archiveHeld) {
  const page = await loadPage({ board: board(archivedIds, archiveHeld) }).start();
  const read = () => page.run('JSON.stringify([archiveHeldWords(), archiveAbsent(), archiveCountLabel(archived0())])'.replace('archived0()', 'state.archived.length'));
  return { page, read: () => JSON.parse(read()) };
}

test('a page built without the archive and holding none says it is not in this page', async () => {
  const { read } = await words([], { carried: 0, total: 3 });
  assert.deepStrictEqual(read(), ['not in this page', true, 'not in this page']);
});

test('a card archived in a page built without the archive makes the pill a working one', async () => {
  const { read } = await words([9], { carried: 0, total: 3 });
  assert.deepStrictEqual(read(), ['1 of 4', false, '1 of 4']);
});

test('the total follows the page: two archives of its own over a part build', async () => {
  const { read } = await words([19, 20, 8, 9], { carried: 2, total: 3 });
  assert.deepStrictEqual(read(), ['4 of 5', false, '4 of 5']);
});

test('a restored card takes the count back down', async () => {
  const { read } = await words([19], { carried: 2, total: 3 });
  assert.deepStrictEqual(read(), ['1 of 2', false, '1 of 2']);
});

test('a page built with the whole archive says nothing, whatever it archives', async () => {
  const { read } = await words([1, 2, 3, 9]);
  assert.deepStrictEqual(read(), [null, false, 4]);
});
