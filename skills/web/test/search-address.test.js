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

// Safari throws a SecurityError from history.replaceState after 100 calls in 30
// seconds. The address then lags the box, the listeners registered after it
// still hear of the write, and the next write that the browser allows catches
// the address up.
test('a replaceState the browser refuses leaves the later listeners told and the address to catch up on the next change', async () => {
  const { page, session } = await openAt();
  const told = [];
  page.ctx.onSearchWrite((text) => told.push(text));
  const allowed = page.ctx.history.replaceState;
  let refusing = true;
  page.ctx.history.replaceState = (...args) => {
    if (refusing) throw new Error('SecurityError: too many calls to history.replaceState');
    return allowed.apply(page.ctx.history, args);
  };
  page.input.typed('z');
  page.input.typed('ze');
  assert.deepStrictEqual(told, ['z', 'ze'], 'a listener after the address follower was told of both writes');
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'and no error reached the input handler');
  assert.strictEqual(session.search, '', 'the address lags while the browser refuses');
  assert.strictEqual(page.input.value, 'ze');
  refusing = false;
  page.input.typed('zep');
  assert.strictEqual(qOf(session.search), 'zep', 'the next change catches the address up');
  assert.deepStrictEqual(told, ['z', 'ze', 'zep']);
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

test('every other way of writing the box moves the address too: a cue and the Ctrl+F prefill; Path from a card\'s menu writes nothing, so the address stays', async () => {
  const { page, session } = await openAt();
  clickTile(page, 2, 'card-assignee');
  assert.strictEqual(page.input.value, 'assignee:@afk');
  assert.strictEqual(qOf(session.search), 'assignee:@afk', 'a cue click');
  page.clear.fire('click');
  page.fireDocument('keydown', { key: 'f', ctrlKey: true });
  assert.strictEqual(page.input.value, '#');
  assert.strictEqual(qOf(session.search), '#', 'the Ctrl+F prefill');
  page.rightClickCard(2);
  page.menu.path.fire('click');
  assert.strictEqual(page.input.value, '#', 'Path from the menu leaves the box alone');
  assert.strictEqual(qOf(session.search), '#', 'and the address with it');
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

test('a link with isolate=1 and no usable query loses the parameter on load: the box is empty and nothing is isolated', async () => {
  const cases = [
    ['?isolate=1', ''],
    ['?isolate=1&view=graph', '?view=graph'],
    ['?q=&isolate=1&view=map', '?view=map'],
    ['?q=%20%20&isolate=1&view=map', '?view=map'],
    ['?card=1&isolate=1', '?card=1'],
  ];
  for (const [link, address] of cases) {
    const { page, session } = await openAt(link);
    assert.strictEqual(page.input.value, '', link);
    assert.strictEqual(session.search, address, link);
    assert.strictEqual(session.pushes, 0, link);
  }
});

test('a plain load, or a link whose parameters are all in line with the box, replaces nothing', async () => {
  for (const link of ['', '?view=board', '?card=1', '?q=zephyr&isolate=1']) {
    const { session } = await openAt(link);
    assert.strictEqual(session.pushes, 0, link);
    assert.strictEqual(session.replaces, 0, link);
  }
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

// --- card history: opening and closing a card still push one step each, and
// the query rides in them; Back and Forward never write the box ------------

const closeCard = (session) => session.close.fire('click');
const shownCard = (page) => page.run('currentDetailId');

test('with a query in the box, opening a card adds one history step carrying both card and q; Back closes the card, Forward reopens it, and the box keeps the query throughout', async () => {
  const { page, session } = await openAt();
  page.input.typed('zephyr');
  const entries = session.entries.length;
  clickTile(page, 1);
  await page.settle();
  assert.strictEqual(session.entries.length, entries + 1, 'one step for the open');
  assert.strictEqual(session.pushes, 1);
  assert.deepStrictEqual(paramsOf(session.search), { q: 'zephyr', card: '1' });
  assert.strictEqual(shownCard(page), 1);

  session.back();
  await page.settle();
  assert.strictEqual(shownCard(page), null, 'Back closes the card');
  assert.strictEqual(page.input.value, 'zephyr');
  assert.strictEqual(session.search, '?q=zephyr');

  session.forward();
  await page.settle();
  assert.strictEqual(shownCard(page), 1, 'Forward reopens it');
  assert.strictEqual(page.input.value, 'zephyr');
  assert.deepStrictEqual(paramsOf(session.search), { q: 'zephyr', card: '1' });
  assert.strictEqual(session.pushes, 1, 'stepping between the entries pushed nothing');
  assert.strictEqual(session.replaces, 1, 'and replaced nothing: q already equalled the box on every entry it landed on');
});

test('after opening a card, closing it and typing a new query, Back reopens the card, the box keeps the new query, and the entry it landed on has q equal to the box', async () => {
  const { page, session } = await openAt();
  page.input.typed('old');
  clickTile(page, 1);
  await page.settle();
  closeCard(session);
  assert.strictEqual(session.search, '?q=old', 'closing pushed a step without the card');
  page.input.typed('new');
  assert.deepStrictEqual(session.entries.map(qOf), ['old', 'old', 'new']);
  const pushes = session.pushes;

  session.back();
  await page.settle();
  assert.strictEqual(shownCard(page), 1, 'Back reopens the card');
  assert.strictEqual(page.input.value, 'new', 'the box keeps the new query');
  assert.deepStrictEqual(paramsOf(session.search), { q: 'new', card: '1' }, 'the address is brought back in line with the box');
  assert.strictEqual(session.pushes, pushes, 'by replacing the entry it landed on, not pushing one');
  assert.strictEqual(session.entries.length, 3);
  assert.deepStrictEqual(session.entries.map(qOf), ['old', 'new', 'new']);

  session.forward();
  await page.settle();
  assert.strictEqual(shownCard(page), null, 'Forward closes it again');
  assert.strictEqual(page.input.value, 'new');
  assert.strictEqual(session.search, '?q=new');
});

test('Back onto an entry from before the box had text keeps the box and gives that entry the query', async () => {
  const { page, session } = await openAt();
  clickTile(page, 1);
  await page.settle();
  page.input.typed('abc');
  assert.deepStrictEqual(paramsOf(session.search), { card: '1', q: 'abc' });
  session.back();
  await page.settle();
  assert.strictEqual(shownCard(page), null);
  assert.strictEqual(page.input.value, 'abc');
  assert.strictEqual(session.search, '?q=abc');
  assert.strictEqual(session.entries.length, 2);
});

test('Back onto an entry that has q while the box is empty drops q from that entry and leaves the box empty', async () => {
  const { page, session } = await openAt();
  page.input.typed('abc');
  clickTile(page, 1);
  await page.settle();
  page.clear.fire('click');
  assert.deepStrictEqual(paramsOf(session.search), { card: '1' });
  session.back();
  await page.settle();
  assert.strictEqual(page.input.value, '');
  assert.strictEqual(session.search, '');
});

test('Back is brought in line with the box even while another popup is open, which still keeps the detail popup from moving', async () => {
  const { page, session } = await openAt();
  page.input.typed('old');
  clickTile(page, 1);
  await page.settle();
  closeCard(session);
  page.input.typed('new');
  session.popupOpen = true;
  session.back();
  await page.settle();
  assert.strictEqual(shownCard(page), null, 'the card does not open under the other popup');
  assert.strictEqual(page.input.value, 'new');
  assert.deepStrictEqual(paramsOf(session.search), { q: 'new', card: '1' });
});

test('landing never writes the box: a Back onto a step with another q tells no search listener', async () => {
  const { page, session } = await openAt();
  page.input.typed('old');
  clickTile(page, 1);
  await page.settle();
  closeCard(session);
  page.input.typed('new');
  const told = [];
  page.ctx.onSearchWrite((text, reason) => told.push([text, reason]));
  const writes = page.input.writes.length;
  session.back();
  await page.settle();
  assert.deepStrictEqual(told, []);
  assert.strictEqual(page.input.writes.length, writes);
});
