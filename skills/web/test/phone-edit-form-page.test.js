const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control } = require('./helpers/page-vm');
const { PHONE_WIDTH_QUERY } = require('../web/phone-width');

// Editing on a phone, in the real page (helpers/page-vm.js): Save on an edit opened from a card
// reopens that card, on the status tab of its new status; above the phone width Save does the
// same without the status tab. A ?card= link sets the status tab before it opens the card. The form's
// look (full screen, 16 px fields) is CSS-first and pinned below against app.css; the browser
// runner measures it in Chrome (phone-steps/card-edit.js).

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const makeBoard = () => ({
  projectName: 'kanban',
  statuses: ['backlog', 'todo', 'doing', 'done'],
  priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [card(1, { status: 'doing' }), card(2), card(3, { status: 'backlog' }), card(4)],
  archived: [card(5, { archived: true })],
});

const PHONE = 'kanban.kanban.columns.phone';

async function open({ phone = true, search = '', stored = {} } = {}) {
  const board = makeBoard();
  const els = { '#f-id': control(), '#f-status': control(), '#card-form': control(), '#modal': control(), '#detail-modal': control() };
  els['#modal'].classList.add('hidden');
  els['#detail-modal'].classList.add('hidden');
  const page = loadPage({ board, search, stored, elements: els });
  page.ctx.matchMedia = (q) => ({ matches: phone && q === PHONE_WIDTH_QUERY, addEventListener() {} });
  const calls = [];
  page.ctx.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url: String(url), column: stored[PHONE] });
    const m = String(url).match(/\/api\/cards\/(\d+)\/detail/);
    const body = m ? { ...board.active.concat(board.archived).find((c) => String(c.id) === m[1]), path: 'x', html: '' } : board;
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) };
  };
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
  return { page, els, calls, stored };
}

const openCardAt = async (s, id) => {
  s.page.ctx.location.search = `?card=${id}`; // the address a card opened by a click or a link carries
  await s.page.run(`openDetailModal(${id})`);
};

async function editFromCard(s, id, status) {
  await openCardAt(s, id);
  s.page.run('editFromDetail()');
  s.els['#f-status'].value = status;
  s.calls.length = 0;
  s.els['#card-form'].fire('submit', { preventDefault() {} });
  await s.page.settle();
}

const detailFetches = (s) => s.calls.filter((c) => /\/detail$/.test(c.url));

test('on a phone Save on an edit opened from a card reopens that card, on the tab of its new status', async () => {
  const s = await open();
  await editFromCard(s, 2, 'done');
  assert.ok(s.calls.some((c) => c.method === 'PATCH' && c.url === '/api/cards/2'));
  assert.strictEqual(s.stored[PHONE], 'done');
  const reopened = detailFetches(s);
  assert.strictEqual(reopened.length, 1);
  assert.match(reopened[0].url, /\/api\/cards\/2\/detail$/);
  assert.strictEqual(reopened[0].column, 'done', 'the tab was already the new status when the card opened');
  assert.ok(!s.els['#detail-modal'].classList.contains('hidden'));
  assert.ok(s.els['#modal'].classList.contains('hidden'));
});

test('above the phone width Save brings the card back too, and leaves the phone tab alone', async () => {
  const s = await open({ phone: false });
  await editFromCard(s, 2, 'done');
  assert.ok(s.els['#modal'].classList.contains('hidden'));
  assert.strictEqual(detailFetches(s).length, 1);
  assert.match(detailFetches(s)[0].url, /\/api\/cards\/2\/detail$/);
  assert.ok(!s.els['#detail-modal'].classList.contains('hidden'));
  assert.strictEqual(s.stored[PHONE], undefined);
});

test('leaving an edit opened from a card, on any width, brings the card back; the form of a new card just closes', async () => {
  for (const phone of [false, true]) {
    const s = await open({ phone });
    s.page.ctx.confirm = () => true; // the stand-in controls read as changed; the question itself is pinned in edit-returns-to-details.test.js
    await openCardAt(s, 2);
    s.page.run('editFromDetail()');
    assert.ok(s.els['#detail-modal'].classList.contains('hidden'));
    s.calls.length = 0;
    s.page.run('requestCloseModal()');
    await s.page.settle();
    assert.ok(s.els['#modal'].classList.contains('hidden'), `phone ${phone}`);
    assert.ok(!s.els['#detail-modal'].classList.contains('hidden'), `phone ${phone}`);
    assert.strictEqual(detailFetches(s).length, 1);
    assert.strictEqual(s.calls.filter((c) => c.method !== 'GET').length, 0, 'nothing is written');
    s.page.run('openModal(null)');
    s.calls.length = 0;
    s.page.run('requestCloseModal()');
    await s.page.settle();
    assert.strictEqual(detailFetches(s).length, 0, 'the form of a new card does not reopen the card the last form came from');
  }
});

test('a new card saved on a phone is not reopened, nor is an edit that did not start from a card', async () => {
  const s = await open();
  s.page.run('openModal(null)');
  s.els['#f-status'].value = 'todo';
  s.calls.length = 0;
  s.els['#card-form'].fire('submit', { preventDefault() {} });
  await s.page.settle();
  assert.strictEqual(detailFetches(s).length, 0);
});

test('a ?card= link at phone width sets the card\'s status tab before the card opens', async () => {
  const s = await open({ search: '?card=4' });
  const first = s.calls.filter((c) => /\/detail$/.test(c.url))[0];
  assert.ok(first, 'the card opens');
  assert.strictEqual(first.column, 'todo');
  assert.strictEqual(s.stored[PHONE], 'todo');
});

test('a ?card= link to an archived card lands on the Archive tab', async () => {
  const s = await open({ search: '?card=5' });
  assert.strictEqual(detailFetches(s)[0].column, 'archive');
});

test('above the phone width a ?card= link leaves the remembered tab alone', async () => {
  const s = await open({ phone: false, search: '?card=4' });
  assert.strictEqual(s.stored[PHONE], undefined);
  assert.strictEqual(detailFetches(s).length, 1);
});

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8').replace(/\r\n/g, '\n');

test('the edit form phone block fills the viewport and sets every field to 16 px, beside the existing .modal input rule', () => {
  const block = css.match(/\/\* The edit form on a phone[\s\S]*?\*\/\s*@media \(max-width: 759\.98px\) \{[\s\S]*?\n\}/);
  assert.ok(block, 'one 759.98px block with its comment');
  assert.match(block[0], /#card-form\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/);
  assert.match(block[0], /#card-form\s*\{[^}]*width:\s*100vw/);
  assert.match(block[0], /#card-form\s*\{[^}]*border-radius:\s*0/);
  assert.match(block[0], /#card-form input,\s*#card-form select,\s*#card-form textarea\s*\{[^}]*font-size:\s*16px/);
  assert.doesNotMatch(block[0], /!important/);
  assert.match(css, /\.modal input, \.modal select, \.modal textarea \{[^}]*padding: 6px 8px/, 'the desktop rule stays');
});
