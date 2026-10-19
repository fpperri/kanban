const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { selectionGlobals } = require('./helpers/selection-globals');
const { parseSearchQuery, filterCards } = require('../web/search');

// A bulk action takes its list of target cards once, when it starts, from the
// resolved selection. Writes, re-renders and polls during the action never
// change the list. The selection here holds a query part, which is the case that
// can move under an action: an assign on `assignee:@afk` takes its cards off the
// query one write at a time. The page's own functions run in a sandbox with the
// real search module behind the selection and a server that applies every write
// and then repaints, as a poll does, so the selection is worked out again after
// each one.

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

const declaration = (name, kind = 'let') => {
  const m = appSrc.match(new RegExp(`^${kind} ${name} = .*;$`, 'm'));
  assert.ok(m, `the page declares ${name}`);
  return m[0];
};

function fakeBox() {
  const classes = new Set(['hidden']);
  return {
    value: '', checked: false, disabled: false, textContent: '', innerHTML: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    focus() {}, querySelectorAll: () => [], replaceChildren() {}, append() {}, appendChild() {},
  };
}

const CARDS = [
  { id: 1, title: 'one', status: 'todo', archived: false, tags: ['a'], assignee: '@afk' },
  { id: 2, title: 'two', status: 'todo', archived: false, tags: ['a', 'b'], assignee: '@afk' },
  { id: 3, title: 'three', status: 'doing', archived: false, tags: ['a'], assignee: '@afk' },
  { id: 4, title: 'four', status: 'todo', archived: false, tags: [], assignee: '@human' },
  { id: 5, title: 'five', status: 'done', archived: true, tags: ['a'], assignee: '@afk' },
  { id: 6, title: 'six', status: 'done', archived: true, tags: ['b'], assignee: '@human' },
];

// `query` is the text of the one query part the selection holds. `onApi` runs
// after the server applied a write and before the page is told, to move the board
// under the action the way a poll would.
function bulkSandbox({ query, extraParts = [], cards = CARDS } = {}) {
  const calls = { api: [], confirms: [], toasts: [], polls: 0 };
  const { searchMatchIds, selectionMatchIds, ...pageless } = selectionGlobals(); // the page's own matchers run here, over the real search module
  const boxes = new Map();
  const $ = (sel) => { if (!boxes.has(sel)) boxes.set(sel, fakeBox()); return boxes.get(sel); };
  const live = cards.map((c) => ({ ...c, id: String(c.id), tags: [...c.tags] }));
  const sandbox = {
    $, boxes, calls,
    state: { projectName: 'board', active: live.filter((c) => !c.archived), archived: live.filter((c) => c.archived) },
    nestingCtx: () => ({}), loadViewMode: () => 'board',
    parseSearchQuery, filterCards,
    confirm: (message) => { calls.confirms.push(message); return true; },
    toast: (message) => { calls.toasts.push(message); },
    hideContextMenu() {}, applyModalFullscreen() {}, renderBoard() {},
    document: { querySelector: () => ({}), querySelectorAll: () => [], createElement: fakeBox },
    ...pageless,
    ...require('../web/bulk-edit'),
  };
  const run = (code) => vm.runInContext(code, sandbox);
  const find = (id) => sandbox.state.active.concat(sandbox.state.archived).find((c) => c.id === String(id));
  // A poll: the page paints again, and every paint works the selection out again.
  const poll = () => { calls.polls++; run('setSelection(selectionState.selection)'); };
  sandbox.afterWrite = () => {};
  sandbox.serve = (method, url, body) => {
    const id = url.split('/')[3];
    const card = find(id);
    if (method === 'PATCH') Object.assign(card, body);
    else if (method === 'POST' && url.endsWith('/archive')) { card.archived = true; sandbox.state.active = sandbox.state.active.filter((c) => c !== card); sandbox.state.archived.push(card); }
    else if (method === 'POST' && url.endsWith('/restore')) { card.archived = false; sandbox.state.archived = sandbox.state.archived.filter((c) => c !== card); sandbox.state.active.push(card); }
    else if (method === 'DELETE') { sandbox.state.active = sandbox.state.active.filter((c) => c !== card); sandbox.state.archived = sandbox.state.archived.filter((c) => c !== card); }
  };
  sandbox.api = async (method, url, body) => {
    calls.api.push(JSON.parse(JSON.stringify([method, url, body === undefined ? null : body])));
    sandbox.serve(method, url, body);
    sandbox.afterWrite();
    poll();
    return {};
  };
  sandbox.loadBoard = async () => { poll(); };
  vm.createContext(sandbox);
  const scheduleRows = appSrc.match(/const SCHEDULE_ROWS = \[[\s\S]*?\n\];/);
  assert.ok(scheduleRows, 'SCHEDULE_ROWS found in app.js');
  run([
    declaration('selectionState'), declaration('selectedIds'), fn('setSelection'),
    fn('searchCtx'), fn('matchedIds'), fn('searchMatchIds'), fn('selectionMatchIds'),
    'let bulkSingleMode = null; let bulkPopupIds = []; let bulkPopupInSelection = false; let isDragging = false, dragCardId = null, bulkDragIds = null;',
    declaration('menuSubject'),
    scheduleRows[0],
    ...['bulkTargets', 'captureBulkTargets', 'bulkPatch', 'openBulkSingle', 'applyBulkSingle', 'renderBulkTags', 'openBulkTags', 'bulkAddTag', 'bulkRemoveTags',
      'readScheduleFields', 'refreshScheduleControls', 'openBulkSchedule', 'applyBulkSchedule', 'bulkArchive', 'openBulkArchive', 'applyBulkArchive', 'bulkRestore', 'bulkDelete', 'wireDrag'].map(fn),
  ].join('\n'));
  run(`setSelection(${JSON.stringify(extraParts)}.reduce((next, part) => addPart(next, part), setAnchor(NO_SELECTION, queryPart(${JSON.stringify(query)}))))`);
  run('menuSubject = cardMenuFor(selectedIds, [...selectedIds][0])'); // a right-click on a selected card: the menu is for the whole selection
  return {
    boxes, calls, run, find, poll, sandbox,
    picked: () => [...run('selectedIds')].map(Number).sort((a, b) => a - b),
    patched: () => calls.api.filter(([m]) => m === 'PATCH').map(([, url, body]) => [url, body]),
    posted: (suffix) => calls.api.filter(([m, url]) => m === 'POST' && url.endsWith(suffix)).map(([, url]) => Number(url.split('/')[3])),
    deleted: () => calls.api.filter(([m]) => m === 'DELETE').map(([, url]) => Number(url.split('/')[3])),
  };
}

test('the query part reaches the live and the archived cards it matches, and a poll works it out again', () => {
  const s = bulkSandbox({ query: 'assignee:@afk' });
  assert.deepStrictEqual(s.picked(), [1, 2, 3, 5]);
  s.find(4).assignee = '@afk';
  s.poll();
  assert.deepStrictEqual(s.picked(), [1, 2, 3, 4, 5], 'the selection follows the board');
});

test('assign on a selection holding an assignee:@afk query part reassigns every card that matched when the action started, though each write takes a card off the query', async () => {
  const s = bulkSandbox({ query: 'assignee:@afk' });
  s.run("openBulkSingle('assignee')");
  assert.match(s.boxes.get('#bulk-single-title').textContent, /Assign 4 card/);
  s.boxes.get('#bulk-single-input').value = '@human';
  await s.run('applyBulkSingle()');
  assert.deepStrictEqual(s.patched().map(([url]) => url), ['/api/cards/1', '/api/cards/2', '/api/cards/3', '/api/cards/5']);
  assert.ok(s.patched().every(([, body]) => body.assignee === '@human'));
  assert.deepStrictEqual([1, 2, 3, 5].map((id) => s.find(id).assignee), ['@human', '@human', '@human', '@human']);
  assert.deepStrictEqual(s.picked(), [], 'the query lost every card while the action ran, and the list it was working from did not change');
  assert.ok(s.calls.polls >= 4, 'a poll followed each write');
  assert.match(s.calls.toasts[0], /Assigned @human to 4 card/);
});

test('a poll that arrives while the assign popup is open, and brings a card onto the query, leaves the targets as they were when it opened', async () => {
  const s = bulkSandbox({ query: 'assignee:@afk' });
  s.run("openBulkSingle('assignee')");
  s.find(4).assignee = '@afk';
  s.find(1).assignee = '@human';
  s.poll();
  assert.deepStrictEqual(s.picked(), [2, 3, 4, 5], 'the selection moved under the popup');
  s.boxes.get('#bulk-single-input').value = '@carol';
  await s.run('applyBulkSingle()');
  assert.deepStrictEqual(s.patched().map(([url]) => url), ['/api/cards/1', '/api/cards/2', '/api/cards/3', '/api/cards/5'], 'card 1 was a target when the action started; card 4 was not');
});

test('priority: the targets are the cards the query matched when the popup opened, whatever the writes and polls do', async () => {
  const s = bulkSandbox({ query: 'tags:a' });
  s.run("openBulkSingle('priority')");
  s.boxes.get('#bulk-single-input').value = 'High';
  s.sandbox.afterWrite = () => { s.find(3).tags = []; s.find(4).tags = ['a']; };
  await s.run('applyBulkSingle()');
  assert.deepStrictEqual(s.patched().map(([url]) => url), ['/api/cards/1', '/api/cards/2', '/api/cards/3', '/api/cards/5']);
});

test('tags: removing a tag the query selects on reaches every card that carried it when the workbench opened', async () => {
  const s = bulkSandbox({ query: 'tags:a' });
  s.run('openBulkTags()');
  assert.match(s.boxes.get('#bulk-tags-title').textContent, /Edit tags on 4 card/);
  s.boxes.get('#bulk-tag-list').querySelectorAll = () => [{ value: 'a' }];
  await s.run('bulkRemoveTags()');
  assert.deepStrictEqual(s.patched().map(([url]) => url), ['/api/cards/1', '/api/cards/2', '/api/cards/3', '/api/cards/5']);
  assert.deepStrictEqual(s.patched().map(([, body]) => body.tags.includes('a')), [false, false, false, false]);
  assert.deepStrictEqual(s.picked(), [], 'no card is on the query any more');
  assert.match(s.boxes.get('#bulk-tags-title').textContent, /Edit tags on 4 card/, 'the workbench still shows the cards it opened on');
});

test('schedule: the targets are the cards the query matched when the popup opened', async () => {
  const s = bulkSandbox({ query: 'assignee:@afk' });
  s.run('openBulkSchedule()');
  s.boxes.get('#bs-due').value = '2026-12-01';
  s.sandbox.afterWrite = () => { s.find(2).assignee = '@human'; };
  await s.run('applyBulkSchedule()');
  assert.deepStrictEqual(s.patched().map(([url]) => url), ['/api/cards/1', '/api/cards/2', '/api/cards/3', '/api/cards/5']);
});

test('archive on a selection holding a query part confirms the count taken at the start and archives exactly those cards', async () => {
  const s = bulkSandbox({ query: 'assignee:@afk' });
  await s.run('bulkArchive()');
  assert.deepStrictEqual(s.calls.confirms, ['Archive 3 card(s)? (moves their files to archived/)'], 'the three live cards; card 5 is archived already');
  assert.match(s.boxes.get('#bulk-archive-title').textContent, /Archive 3 card/);
  s.find(4).assignee = '@afk';
  s.find(2).assignee = '@human';
  s.poll();
  await s.run('applyBulkArchive()');
  assert.deepStrictEqual(s.posted('/archive'), [1, 2, 3], 'card 4 joined the query after the count, card 2 left it; the three counted are the three archived');
  assert.match(s.calls.toasts[0], /Archived 3 card\(s\); skipped 1 already archived/);
});

test('archive clears the selection when the menu that opened the popup was inside it, whatever menu the page holds by the time the popup is applied', async () => {
  const s = bulkSandbox({ query: 'tags:a' });
  await s.run('bulkArchive()');
  s.run("menuSubject = cardMenuFor(selectedIds, '4')"); // another right-click, outside the selection, while the popup is open
  await s.run('applyBulkArchive()');
  assert.deepStrictEqual(s.posted('/archive'), [1, 2, 3], 'the popup archived the cards it opened on');
  assert.deepStrictEqual(s.picked(), [], 'the menu it opened from was for the selection, so the selection is cleared');
});

test('archive leaves a hand-built selection as it was when the menu that opened the popup was outside it, whatever menu the page holds by the time the popup is applied', async () => {
  const s = bulkSandbox({ query: 'tags:a' });
  s.run("menuSubject = cardMenuFor(selectedIds, '4')"); // a right-click on a card outside the selection
  await s.run('bulkArchive()');
  s.run('menuSubject = cardMenuFor(selectedIds, [...selectedIds][0])'); // another right-click, inside it, while the popup is open
  await s.run('applyBulkArchive()');
  assert.deepStrictEqual(s.posted('/archive'), [4]);
  assert.deepStrictEqual(s.picked(), [1, 2, 3, 5], 'the selection was not what the popup opened on, so it stays');
});

test('delete on a selection holding a query part confirms the count taken at the start and deletes exactly those cards, though each delete takes a card off the query', async () => {
  const s = bulkSandbox({ query: 'tags:a' });
  await s.run('bulkDelete()');
  assert.deepStrictEqual(s.calls.confirms, ['Permanently delete 4 card(s)? This cannot be undone.']);
  assert.deepStrictEqual(s.deleted(), [1, 2, 3, 5]);
  assert.match(s.calls.toasts[0], /Deleted 4 card/);
});

test('restore on a selection holding a query part restores every archived card it matched when the action started', async () => {
  const s = bulkSandbox({ query: 'status:done' });
  assert.deepStrictEqual(s.picked(), [5, 6]);
  s.sandbox.afterWrite = () => { s.find(5).status = 'todo'; };
  await s.run('bulkRestore()');
  assert.deepStrictEqual(s.posted('/restore'), [5, 6]);
});

test('drag: a drag of a card in the selection carries the cards the query matched at dragstart, whatever a poll does after', () => {
  const handlers = {};
  const s = bulkSandbox({ query: 'assignee:@afk' });
  const tile = { dataset: { id: '2' }, classList: { add() {}, remove() {} }, addEventListener(type, f) { handlers[type] = f; } };
  s.sandbox.$ = (sel) => (sel === '#board' ? { querySelectorAll: () => [tile] } : fakeBox());
  s.run('wireDrag()');
  handlers.dragstart({ dataTransfer: { setData() {} } });
  assert.deepStrictEqual([...s.run('bulkDragIds')].map(Number), [1, 2, 3, 5]);
  s.find(1).assignee = '@human';
  s.find(4).assignee = '@afk';
  s.poll();
  assert.deepStrictEqual(s.picked(), [2, 3, 4, 5]);
  assert.deepStrictEqual([...s.run('bulkDragIds')].map(Number), [1, 2, 3, 5], 'the poll did not change the cards the drag carries');
});

// What the tests above prove can fail: a mutation that makes an apply step read the
// live selection again breaks them. The pins below name the one reader each step
// takes its cards from, so such a change shows up as a source diff as well.
test('every apply step reads the cards its popup captured, and the actions with no popup read the selection once, through the reader', () => {
  for (const name of ['applyBulkSingle', 'bulkAddTag', 'bulkRemoveTags', 'applyBulkSchedule', 'applyBulkArchive']) {
    assert.match(fn(name), /bulkTargets\(bulkPopupIds\)/, name);
    assert.doesNotMatch(fn(name), /bulkTargets\(\)|selectedIds/, `${name} does not read the live selection`);
  }
  assert.doesNotMatch(fn('applyBulkArchive'), /menuSubject/, 'the archive popup reads the copy of the menu subject it took when it opened');
  for (const name of ['bulkRestore', 'bulkDelete']) {
    assert.strictEqual((fn(name).match(/bulkTargets\(/g) || []).length, 1, `${name} reads its targets once, at the start`);
  }
  assert.strictEqual((fn('wireDrag').match(/bulkTargets\(/g) || []).length, 1, 'a drag reads its cards once, at dragstart');
});
