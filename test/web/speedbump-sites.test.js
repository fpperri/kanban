const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control } = require('./helpers/page-vm');
const { askElements, askDriver } = require('./helpers/ask-page');

// Where the page's own speedbumps ask: each asks in the page (ask-ui.js) with the message it always had, at
// the moment it always did, under the rule it always had. The real page runs in a vm (helpers/page-vm.js);
// a "no" changes nothing, and a "yes" sends the write. The settings prompts are held by settings-page.test.js
// and the edit form's by edit-returns-to-details.test.js.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [],
  notifications: [
    { id: 1, message: 'The nightly run finished and left a long report that goes on past fifty characters of text', created: '2026-11-01T10:00:00', read: false },
    { id: 2, message: 'Short one', created: '2026-11-01T10:01:00', read: false },
  ],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing' }),
    card(2, { title: 'Move the data layer', status: 'todo' }),
    card(3, { title: 'Ship it', status: 'done' }),
    card(4, { title: 'Ship it too', status: 'done' }),
  ],
  archived: [card(7, { title: 'Spike zephyr pooling', status: 'done', archived: true })],
});

async function open() {
  const elements = { ...askElements(), '#bulk-archive': control(), '#bulk-archive-title': control(), '#bulk-archive-input': control() };
  elements['#bulk-archive'].classList.add('hidden');
  const page = loadPage({ board: makeBoard(), elements });
  const requests = [];
  const real = page.ctx.fetch;
  page.ctx.fetch = (url, opts = {}) => { requests.push(`${opts.method || 'GET'} ${url}`); return real(url, opts); };
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  requests.length = 0;
  const writes = () => requests.filter((r) => !r.startsWith('GET '));
  return { page, elements, ask: askDriver(page, elements), writes, run: (code) => page.run(code), settle: () => page.settle() };
}

// --- Archive, from the card's details ----------------------------------------------------------

test('Archive on a card that is not done asks with its label; no changes nothing, yes archives it and runs onSuccess', async () => {
  const s = await open();
  let closed = 0;
  s.page.ctx.__done = () => { closed++; };
  s.run('doArchive("1", { onSuccess: __done })');
  assert.strictEqual(s.ask.open(), true);
  assert.strictEqual(s.ask.text(), 'Archive #1 "Zephyr migration"? (moves the file to archived/)');
  await s.ask.no();
  assert.deepStrictEqual(s.writes(), []);
  assert.strictEqual(closed, 0);
  s.run('doArchive("1", { onSuccess: __done })');
  await s.ask.yes();
  assert.deepStrictEqual(s.writes(), ['POST /api/cards/1/archive']);
  assert.strictEqual(closed, 1);
});

test('Archive on a card that is done asks nothing and archives it at once', async () => {
  const s = await open();
  s.run('doArchive("3")');
  await s.settle();
  assert.strictEqual(s.ask.open(), false);
  assert.deepStrictEqual(s.writes(), ['POST /api/cards/3/archive']);
});

const select = (s, ...ids) => s.run(`setSelection(${ids.reduce((sel, id) => `addPart(${sel}, cardPart("${id}"))`, 'NO_SELECTION')}, null); menuSubject = cardMenuFor(selectedIds, "${ids[0]}")`);

// --- Archive, from the card menu -----------------------------------------------------------------

test('bulk Archive asks the count first and opens the Archive popup only on a yes; a batch that is all done skips the question', async () => {
  const s = await open();
  select(s, '1', '2');
  s.run('bulkArchive()');
  assert.strictEqual(s.ask.text(), 'Archive 2 card(s)? (moves their files to archived/)');
  await s.ask.no();
  assert.strictEqual(s.elements['#bulk-archive'].classList.contains('hidden'), true, 'no: the popup never opens');
  s.run('bulkArchive()');
  await s.ask.yes();
  assert.strictEqual(s.elements['#bulk-archive'].classList.contains('hidden'), false, 'yes: the popup asks where');
  s.elements['#bulk-archive'].classList.add('hidden');
  select(s, '3', '4');
  s.run('bulkArchive()');
  await s.settle();
  assert.strictEqual(s.ask.open(), false, 'every card is done: no question');
  assert.strictEqual(s.elements['#bulk-archive'].classList.contains('hidden'), false);
  assert.deepStrictEqual(s.writes(), []);
});

// --- The drop that asks ----------------------------------------------------------------------------

test('a drop on Archive asks as dragPlan says: a batch with a card that is not done asks the count, a batch that is all done does not', async () => {
  const s = await open();
  s.run('archiveAwareDrop(["1", "2"], "archive")');
  assert.strictEqual(s.ask.text(), 'Archive 2 card(s)? (moves their files to archived/)');
  await s.ask.no();
  assert.deepStrictEqual(s.writes(), []);
  s.run('archiveAwareDrop(["1", "2"], "archive")');
  await s.ask.yes();
  assert.deepStrictEqual(s.writes(), ['POST /api/cards/1/archive', 'POST /api/cards/2/archive']);
  s.writes().length = 0;
  const quiet = await open();
  quiet.run('archiveAwareDrop(["3", "4"], "archive")');
  await quiet.settle();
  assert.strictEqual(quiet.ask.open(), false, 'every card is done: no question');
  assert.deepStrictEqual(quiet.writes(), ['POST /api/cards/3/archive', 'POST /api/cards/4/archive']);
});

test('a drop of an archived card on a live column asks how many will be restored; yes restores it with that status, no sends nothing', async () => {
  const s = await open();
  s.run('archiveAwareDrop(["7", "2"], "doing")');
  assert.strictEqual(s.ask.text(), 'Move 2 card(s) to doing — 1 of them is archived and will be restored. Proceed?');
  await s.ask.no();
  assert.deepStrictEqual(s.writes(), []);
  s.run('archiveAwareDrop(["7", "2"], "doing")');
  await s.ask.yes();
  assert.deepStrictEqual(s.writes(), ['POST /api/cards/7/restore', 'PATCH /api/cards/7', 'PATCH /api/cards/2']);
});

test('a drop that moves live cards between live columns asks nothing', async () => {
  const s = await open();
  s.run('archiveAwareDrop(["2"], "backlog")');
  await s.settle();
  assert.strictEqual(s.ask.open(), false);
  assert.deepStrictEqual(s.writes(), ['PATCH /api/cards/2']);
});

// --- Clearing notifications -------------------------------------------------------------------------

test('clearing one notification asks with the first 50 characters of its message; no keeps it, yes sends the delete', async () => {
  const s = await open();
  s.run('deleteNotification(1)');
  assert.strictEqual(s.ask.text(), 'Clear notification "The nightly run finished and left a long report th…"? It moves to archived/notifications.md.');
  await s.ask.no();
  assert.deepStrictEqual(s.writes(), []);
  s.run('deleteNotification(2)');
  assert.strictEqual(s.ask.text(), 'Clear notification "Short one"? It moves to archived/notifications.md.');
  await s.ask.yes();
  assert.deepStrictEqual(s.writes(), ['DELETE /api/notifications/2']);
});

test('clearing all notifications asks with the count; no keeps them, yes sends the delete', async () => {
  const s = await open();
  s.run('clearAllNotifications()');
  assert.strictEqual(s.ask.text(), 'Clear all 2 notification(s)? They move to archived/notifications.md.');
  await s.ask.no();
  assert.deepStrictEqual(s.writes(), []);
  s.run('clearAllNotifications()');
  await s.ask.yes();
  assert.deepStrictEqual(s.writes(), ['DELETE /api/notifications']);
});
