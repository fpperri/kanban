const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage } = require('./helpers/page-vm');
const { attachSessionHistory } = require('./helpers/session-history');

// The address follows the search box. The real page runs in a vm
// (helpers/page-vm.js) over a browser session history (helpers/session-history.js);
// each test does what a person does, then reads the address and the history
// the page left behind.

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
    card(1, { title: 'Zephyr migration', status: 'doing', assignee: '@human' }),
    card(2, { title: 'Move the data layer', assignee: '@afk', tags: ['ui'] }),
  ],
  archived: [],
};

async function openAt(search = '') {
  const page = loadPage({ board: BOARD, search });
  const session = attachSessionHistory(page);
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return { page, session };
}

const qOf = (search) => new URLSearchParams(search).get('q');
const paramsOf = (search) => Object.fromEntries(new URLSearchParams(search));

// A click on a card's tile, or on a cue inside it, as the page's document
// listeners see it.
function clickTile(page, id, cueClass = null) {
  const tile = { dataset: { id: String(id) } };
  const cue = cueClass && { classList: { contains: (c) => c === cueClass }, textContent: '' };
  page.fireDocument('click', {
    shiftKey: false, ctrlKey: false, metaKey: false,
    target: {
      closest: (sel) => {
        const parts = sel.split(',').map((s) => s.trim());
        if (parts.includes('.card-el')) return tile;
        return cue && parts.includes(`.${cueClass}`) ? cue : null;
      },
    },
  });
}

test('typing puts the box\'s text in the address as q, one keystroke at a time, and adds no history entry', async () => {
  const { page, session } = await openAt();
  const lengthBefore = session.entries.length;
  for (const text of ['z', 'ze', 'zep', 'zeph', 'zephy', 'zephyr']) {
    page.input.typed(text);
    assert.strictEqual(qOf(session.search), text, `after "${text}" the address's q equals the box`);
  }
  assert.strictEqual(session.search, '?q=zephyr');
  assert.strictEqual(session.pushes, 0, 'typing pushed no history entry');
  assert.strictEqual(session.entries.length, lengthBefore, 'and the history is no longer');
  assert.strictEqual(session.replaces, 6, 'each keystroke replaced the entry it is on');
});

test('a write that leaves q as it is replaces nothing', async () => {
  const { page, session } = await openAt();
  page.input.typed('zephyr');
  const replaces = session.replaces;
  page.run("writeSearch('zephyr', 'typing')");
  page.run("writeSearch('zephyr', 'cue')");
  assert.strictEqual(session.replaces, replaces);
});

test('emptying the box drops q and keeps view, and the clear button does the same', async () => {
  const { page, session } = await openAt('?view=map');
  page.input.typed('zephyr');
  assert.deepStrictEqual(paramsOf(session.search), { view: 'map', q: 'zephyr' });
  page.input.typed('');
  assert.strictEqual(session.search, '?view=map', 'an emptied box drops q');
  page.input.typed('zephyr');
  page.clear.fire('click');
  assert.strictEqual(page.input.value, '');
  assert.strictEqual(session.search, '?view=map', 'the clear button drops q');
  assert.strictEqual(session.pushes, 0);
});

test('a blank box drops q like an empty one', async () => {
  const { page, session } = await openAt();
  page.input.typed('zephyr');
  page.input.typed('   ');
  assert.strictEqual(session.search, '');
});

test('every other way of writing the box moves the address too: a cue, the Ctrl+F prefill, Path from a card\'s menu', async () => {
  const { page, session } = await openAt();
  clickTile(page, 2, 'card-assignee');
  assert.strictEqual(page.input.value, 'assignee:@afk');
  assert.strictEqual(qOf(session.search), 'assignee:@afk', 'a cue click');
  page.clear.fire('click');
  page.fireDocument('keydown', { key: 'f', ctrlKey: true });
  assert.strictEqual(page.input.value, '#');
  assert.strictEqual(qOf(session.search), '#', 'the Ctrl+F prefill');
  page.run('selectedIds = new Set([2])');
  page.menu.path.fire('click');
  assert.strictEqual(page.input.value, 'path:2');
  assert.strictEqual(qOf(session.search), 'path:2', 'Path from the menu');
  assert.strictEqual(session.pushes, 0);
});

test('a link opened with q and view keeps view, writes nothing to the address on load, and the next keystroke makes q equal the box', async () => {
  const { page, session } = await openAt('?q=zephyr&view=graph');
  assert.strictEqual(page.input.value, 'zephyr');
  assert.strictEqual(session.replaces, 0, 'the link\'s own write finds the address already matching');
  assert.strictEqual(session.search, '?q=zephyr&view=graph');
  page.input.typed('zephyr s');
  assert.strictEqual(page.input.value, 'zephyr s');
  assert.deepStrictEqual(paramsOf(session.search), { q: 'zephyr s', view: 'graph' });
});

test('a link with only a view is left as it is on load', async () => {
  const { session } = await openAt('?view=graph');
  assert.strictEqual(session.replaces, 0);
  assert.strictEqual(session.search, '?view=graph');
});

test('a link whose q the deep-link reader trims is brought in line with the box on load', async () => {
  const { page, session } = await openAt('?q=%20zephyr%20&view=map');
  assert.strictEqual(page.input.value, 'zephyr');
  assert.deepStrictEqual(paramsOf(session.search), { q: 'zephyr', view: 'map' });
  assert.strictEqual(session.pushes, 0);
});

// The text goes in through the writer: typing a leading # and then anything but
// digits strips the # (searchHashStrip), so a person cannot type this query in
// one go, but a write that is not typing (the isolate switch, a menu item) can
// put it in the box.
test('a reload opens with the same search: the address carries what the box held, # | quotes and spaces included', async () => {
  for (const text of ['zephyr', '#12 | (tags:"next-up" status:doing)', 'path:2 tags:"a b"', 'a&b=c+d%20e']) {
    const first = await openAt('?view=board');
    first.page.run(`writeSearch(${JSON.stringify(text)}, 'menu')`);
    const address = first.session.search;
    assert.doesNotMatch(address, /#/, 'no fragment');
    const reloaded = await openAt(address);
    assert.strictEqual(reloaded.page.input.value, text, `the box comes back as ${text}`);
    assert.strictEqual(reloaded.session.search, address, 'and the address is left alone');
    assert.strictEqual(reloaded.session.replaces, 0);
  }
});

test('the poll repaints without writing the address', async () => {
  const { page, session } = await openAt();
  page.input.typed('zephyr');
  const replaces = session.replaces;
  await page.run('autoRefreshTick()');
  assert.strictEqual(session.replaces, replaces);
  assert.strictEqual(session.pushes, 0);
  assert.strictEqual(session.search, '?q=zephyr');
});

test('the address replaces the entry on which the box changed: earlier entries are untouched', async () => {
  const { page, session } = await openAt();
  page.input.typed('one');
  clickTile(page, 1);
  await page.settle();
  assert.strictEqual(session.entries.length, 2);
  page.input.typed('two');
  assert.deepStrictEqual(session.entries.map(qOf), ['one', 'two'], 'the first entry keeps what the box held then');
});
