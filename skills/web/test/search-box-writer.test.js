const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/page-vm');

// Every write to the search box goes through one writer that records why it
// wrote. The real page runs in a vm (helpers/page-vm.js); each test does what a
// person does, a listener registered with the writer is told, and the box is
// checked for what it holds.

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
    card(2, { title: 'Move the data layer', assignee: '@afk', tags: ['ui'], waiting_for: [1], blocked: 'vendor', review: 'copy' }),
  ],
  archived: [],
};

// A page with a listener already registered, started, and its first load done.
async function pageWithListener(opts = {}) {
  const page = loadPage({ board: BOARD, ...opts });
  const told = [];
  const renders = { count: 0 };
  const realRender = page.ctx.renderBoard;
  page.ctx.renderBoard = (...args) => { renders.count++; return realRender(...args); };
  page.ctx.onSearchWrite((text, reason) => told.push({ text, reason, boxThen: page.input.value, rendersThen: renders.count }));
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return { page, told, renders };
}

// A click on a card's cue, as the page's document listeners see it.
function clickCue(page, cueClass, cardId, text = '') {
  const tile = { dataset: { id: String(cardId) } };
  const cue = { classList: { contains: (c) => c === cueClass }, textContent: text };
  page.fireDocument('click', {
    shiftKey: false, ctrlKey: false, metaKey: false,
    target: {
      closest: (sel) => {
        const parts = sel.split(',').map((s) => s.trim());
        if (parts.includes('.card-el')) return tile;
        if (parts.includes(`.${cueClass}`)) return cue;
        return null;
      },
    },
  });
}

test('typing is a write with the reason typing, told once, with the box already holding the text and the board repainted', async () => {
  const { page, told, renders } = await pageWithListener();
  const before = renders.count;
  page.input.typed('zephyr');
  assert.strictEqual(told.length, 1);
  assert.strictEqual(told[0].text, 'zephyr');
  assert.strictEqual(told[0].reason, 'typing');
  assert.strictEqual(told[0].boxThen, 'zephyr', 'the box holds the text when the listener hears of it');
  assert.strictEqual(told[0].rendersThen, before + 1, 'the board was repainted before the listener was told');
  assert.deepStrictEqual(page.input.writes, [], 'a person typed it, so the page assigned nothing');
});

test('the leading # a Ctrl+F prefill left is stripped as the next character arrives, as one typing write that keeps the caret', async () => {
  const { page, told } = await pageWithListener();
  page.input.typed('#a', 2);
  assert.deepStrictEqual(told.map((t) => [t.text, t.reason]), [['a', 'typing']]);
  assert.strictEqual(page.input.value, 'a');
  assert.strictEqual(page.input.selectionStart, 1, 'the caret moves left with the stripped #');
  page.input.typed('#4', 2);
  assert.deepStrictEqual(told.map((t) => [t.text, t.reason]), [['a', 'typing'], ['#4', 'typing']], 'digits keep the #');
});

test('the clear button is a write with the reason clear, and does nothing on an empty box', async () => {
  const { page, told } = await pageWithListener();
  page.clear.fire('click');
  assert.deepStrictEqual(told, [], 'an empty box has nothing to clear');
  page.input.typed('zephyr');
  told.length = 0;
  page.clear.fire('click');
  assert.deepStrictEqual(told.map((t) => [t.text, t.reason]), [['', 'clear']]);
  assert.strictEqual(page.input.value, '');
});

test('each cue click is a write with the reason cue: the assignee, a tag, the blocked pill and the review pill', async () => {
  const cues = [
    ['card-assignee', 2, '', 'assignee:@afk'],
    ['tag', 2, 'ui', 'tags:ui'],
    ['blocked-pill', 2, '', 'blocked:'],
    ['review-pill', 2, '', 'review:'],
  ];
  for (const [cls, id, text, term] of cues) {
    const { page, told } = await pageWithListener();
    clickCue(page, cls, id, text);
    assert.deepStrictEqual(told.map((t) => [t.text, t.reason]), [[term, 'cue']], cls);
    assert.strictEqual(page.input.value, term, cls);
  }
});

test('a cue click adds to what the box holds, and a term already in the box is not a write', async () => {
  const { page, told } = await pageWithListener();
  clickCue(page, 'card-assignee', 2);
  clickCue(page, 'tag', 2, 'ui');
  assert.deepStrictEqual(told.map((t) => [t.text, t.reason]), [['assignee:@afk', 'cue'], ['assignee:@afk tags:ui', 'cue']]);
  clickCue(page, 'tag', 2, 'ui');
  assert.strictEqual(told.length, 2, 'the same cue again changes nothing and tells nobody');
});

test('Ctrl+F on an empty box prefills # as a write with the reason prefill; on a box holding a query it selects and writes nothing', async () => {
  const { page, told } = await pageWithListener();
  page.fireDocument('keydown', { key: 'f', ctrlKey: true });
  assert.deepStrictEqual(told.map((t) => [t.text, t.reason]), [['#', 'prefill']]);
  assert.strictEqual(page.input.value, '#');
  page.input.typed('zephyr');
  told.length = 0;
  page.fireDocument('keydown', { key: 'f', ctrlKey: true });
  assert.deepStrictEqual(told, [], 'selecting an existing query is not a write');
  assert.strictEqual(page.input.value, 'zephyr');
});

test('Path and Tree from a card\'s menu are writes with the reason menu, replacing what the box held', async () => {
  const { page, told } = await pageWithListener();
  page.input.typed('zephyr');
  told.length = 0;
  page.run('setSelection(addPart(NO_SELECTION, cardPart(1)), 1)');
  page.menu.path.fire('click');
  page.menu.tree.fire('click');
  assert.deepStrictEqual(told.map((t) => [t.text, t.reason]), [['path:1', 'menu'], ['tree:1', 'menu']]);
  assert.strictEqual(page.input.value, 'tree:1');
});

test('a ?q= link is a write with the reason link, told once the link\'s view is showing', async () => {
  const page = loadPage({ board: BOARD, search: '?q=tags%3Aui&view=map' });
  const told = [];
  page.ctx.onSearchWrite((text, reason) => told.push({ text, reason, view: page.run('loadViewMode()') }));
  await page.start();
  assert.deepStrictEqual(told, [{ text: 'tags:ui', reason: 'link', view: 'map' }]);
  assert.strictEqual(page.input.value, 'tags:ui');
});

test('a link with a view and no query repaints once and writes nothing', async () => {
  const page = loadPage({ board: BOARD, search: '?view=graph' });
  const told = [];
  page.ctx.onSearchWrite((text, reason) => told.push([text, reason]));
  await page.start();
  assert.deepStrictEqual(told, []);
  assert.strictEqual(page.input.value, '');
  assert.strictEqual(page.run('loadViewMode()'), 'graph');
});

test('every listener is told of every write, in the order they registered', async () => {
  const { page, told } = await pageWithListener();
  const second = [];
  page.ctx.onSearchWrite((text, reason) => second.push(`${reason}:${text}`));
  page.input.typed('a');
  page.clear.fire('click');
  assert.deepStrictEqual(told.map((t) => `${t.reason}:${t.text}`), ['typing:a', 'clear:']);
  assert.deepStrictEqual(second, ['typing:a', 'clear:']);
});

test('the poll repaints the board without writing the box and tells no listener', async () => {
  const { page, told, renders } = await pageWithListener();
  page.input.typed('zephyr');
  told.length = 0;
  const writes = page.input.writes.length;
  const renderedBefore = renders.count;
  const fetchesBefore = page.fetchLog.length;
  await page.run('autoRefreshTick()');
  assert.strictEqual(page.fetchLog.length, fetchesBefore + 1, 'the poll fetched the board');
  assert.strictEqual(renders.count, renderedBefore + 1, 'and repainted it');
  assert.deepStrictEqual(told, []);
  assert.strictEqual(page.input.writes.length, writes);
  assert.strictEqual(page.input.value, 'zephyr', 'the query survives the poll');
});

const WEB = path.join(__dirname, '..', 'web');

test('no code outside the writer assigns the search box', () => {
  const read = (file) => fs.readFileSync(path.join(WEB, file), 'utf8').replace(/\r\n/g, '\n');
  for (const file of ['app.js', 'graph-view.js']) {
    const bad = read(file).split('\n').filter((l) => /search-input/.test(l) && /\.value\s*=[^=]/.test(l));
    assert.deepStrictEqual(bad, [], `${file} assigns the search box in place`);
  }
  const app = read('app.js');
  const from = app.indexOf('// --- Search box wiring');
  const to = app.indexOf('// --- Map view wiring');
  assert.ok(from > 0 && to > from, 'the search box wiring section is found');
  const section = app.slice(from, to);
  assert.match(section, /\nfunction writeSearch\(/, 'writeSearch sits in the search box wiring section');
  const rest = section.replace(/\nfunction writeSearch\([\s\S]*?\n\}/, '');
  assert.deepStrictEqual(rest.split('\n').filter((l) => /\binput\.value\s*=[^=]/.test(l)), [], 'the wiring section assigns the box only inside writeSearch');
});
