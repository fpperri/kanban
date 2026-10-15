const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage } = require('./helpers/page-vm');

// The search box of the real page, run in a vm, is handed the board's slices when it
// asks what to suggest: the cards of the whole board, archived ones included, and the
// context a query resolves against, with the hierarchy the board answered with. The
// menu itself is drawn by the combobox, which the vm does not draw, so what the page
// asked for and what the search module answered is read off the call.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

// Goal 1, epic 2 under it, a story 3 under that (depth 2), and an archived card 4
// under the story (depth 3, a depth only the archived card is at).
const BOARD = {
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  hierarchy: ['goal', 'epic'],
  active: [card(1, { type: 'goal' }), card(2, { type: 'epic', parent: 1 }), card(3, { type: 'story', parent: 2 })],
  archived: [card(4, { parent: 3, archived: true, status: 'done' })],
};

async function pageWatchingSuggestions(board = BOARD) {
  const page = loadPage({ board });
  const real = page.ctx.searchSuggestionItems;
  const asked = [];
  page.ctx.searchSuggestionItems = (...args) => {
    const items = real(...args);
    asked.push({ args, items });
    return items;
  };
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return { page, asked };
}

test('the box asks for the suggestions with the whole board and its hierarchy, so slice: offers the tiers and the depths the cards are at, archived cards included', async () => {
  const { page, asked } = await pageWatchingSuggestions();
  page.input.typed('slice:');
  page.input.fire('focus');
  const { args, items } = asked.pop();
  assert.deepStrictEqual(args.slice(0, 2), ['slice:', 6]);
  assert.deepStrictEqual(Array.from(args[2], (c) => c.id).sort(), [1, 2, 3, 4], 'the live cards and the archived card');
  assert.deepStrictEqual(Array.from(args[3].hierarchy), ['goal', 'epic']);
  assert.deepStrictEqual(Array.from(items, (i) => i.label), ['slice:goal', 'slice:epic', 'slice:2', 'slice:3']);
});

test('typing after the dots offers the slices as the second end, at the caret', async () => {
  const { page, asked } = await pageWatchingSuggestions();
  page.input.typed('tags:ui slice:goal..e');
  asked.length = 0;
  page.input.fire('focus');
  assert.deepStrictEqual(Array.from(asked.pop().items, (i) => i.value), ['tags:ui slice:goal..epic']);
});

test('a board answer with no hierarchy key, as an older server writes it, suggests the depths', async () => {
  const old = { ...BOARD };
  delete old.hierarchy;
  const { page, asked } = await pageWatchingSuggestions(old);
  page.input.typed('slice:');
  page.input.fire('focus');
  assert.deepStrictEqual(Array.from(asked.pop().items, (i) => i.label), ['slice:0', 'slice:1', 'slice:2', 'slice:3']);
});
