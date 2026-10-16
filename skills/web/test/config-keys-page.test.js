const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage } = require('./helpers/page-vm');

// The page holds the board's hierarchy, pills and type icons after every load
// and every poll, in `state`, where every view that draws them reads them. This
// file checks the delivery, whichever view draws them. The real page runs in a vm
// (helpers/page-vm.js) and is handed a board answer.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const answer = () => ({
  projectName: 'plan',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], notifications: [],
  types: [{ name: 'goal', color: '#a371f7', icon: 'star' }, { name: 'epic', color: '' }],
  hierarchy: ['goal', 'epic'],
  pills: [{ label: 'next', query: 'tags:"next-up"' }, { label: 'tags:*', query: 'tags:*' }],
  active: [card(1, { type: 'goal' }), card(2, { type: 'epic', parent: 1 })],
  archived: [],
});

const held = (page, expr) => JSON.parse(page.run(`JSON.stringify(${expr})`));

test('after the load the page holds the hierarchy, the pills and each type\'s icon', async () => {
  const page = await loadPage({ board: answer() }).start();
  assert.deepStrictEqual(page.failures, []);
  assert.deepStrictEqual(held(page, 'state.hierarchy'), ['goal', 'epic']);
  assert.deepStrictEqual(held(page, 'state.pills'), [{ label: 'next', query: 'tags:"next-up"' }, { label: 'tags:*', query: 'tags:*' }]);
  assert.deepStrictEqual(held(page, 'state.types'), [{ name: 'goal', color: '#a371f7', icon: 'star' }, { name: 'epic', color: '' }]);
});

test('after a poll the page holds what the board answered then', async () => {
  const board = answer();
  const page = await loadPage({ board }).start();
  board.hierarchy = ['objective'];
  board.pills = [];
  board.types = [{ name: 'objective', color: '', icon: 'diamond' }];
  await page.run('autoRefreshTick()');
  await page.settle();
  assert.deepStrictEqual(held(page, 'state.hierarchy'), ['objective']);
  assert.deepStrictEqual(held(page, 'state.pills'), []);
  assert.deepStrictEqual(held(page, 'state.types'), [{ name: 'objective', color: '', icon: 'diamond' }]);
});

test('an older server that does not answer the new keys leaves an empty hierarchy and no pills', async () => {
  const board = answer();
  delete board.hierarchy;
  delete board.pills;
  const page = await loadPage({ board }).start();
  assert.deepStrictEqual(page.failures, []);
  assert.deepStrictEqual(held(page, 'state.hierarchy'), []);
  assert.deepStrictEqual(held(page, 'state.pills'), []);
});

test('the page holds an empty hierarchy and no pills before the first answer lands', () => {
  const page = loadPage({ board: answer() });
  assert.deepStrictEqual(held(page, 'state.hierarchy'), []);
  assert.deepStrictEqual(held(page, 'state.pills'), []);
});
