const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control } = require('./helpers/page-vm');
const { attachSessionHistory } = require('./helpers/session-history');

// The edit form opened from a card's details (the Edit button, or e) gives the card back when it is left:
// Save writes it and shows the details again with what was saved, and Esc, the X and a click on the
// backdrop do the same through the unsaved-changes guard. A form opened anywhere else (New card, Add
// child...) keeps closing to the board. The real page runs in a vm over a browser session history
// (helpers/page-vm.js, helpers/session-history.js), so a card really opens, saves and steps Back.

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
  active: [card(1), card(2), card(3), card(4)],
  archived: [],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];
const FIELDS = ['id', 'title', 'status', 'priority', 'type', 'parent', 'rank', 'tags', 'waiting', 'blocked', 'review', 'prompt', 'assignee', 'start', 'end', 'due', 'body'];
const hidden = () => { const el = control(); el.classList.add('hidden'); return el; };
const textEl = () => {
  const el = control();
  let text = '';
  Object.defineProperty(el, 'textContent', { configurable: true, get: () => text, set: (v) => { text = String(v); } });
  return el;
};

const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });

async function open({ search = '?card=2', phone = false, confirms = true } = {}) {
  const board = makeBoard();
  const elements = {};
  for (const sel of HIDDEN) elements[sel] = hidden();
  for (const f of FIELDS) { elements[`#f-${f}`] = control(); elements[`#f-${f}`].value = ''; }
  const detailBox = control();
  const focused = [];
  detailBox.focus = (o) => focused.push(o);
  elements['#detail-modal .modal'] = detailBox;
  elements['#detail-title'] = textEl();
  elements['#toast'] = textEl();
  elements['#modal-close'] = control();
  elements['#card-form'] = control();
  elements['#card-form'].requestSubmit = () => elements['#card-form'].fire('submit', { preventDefault() {} });
  const page = loadPage({ board, search, elements });
  page.ctx.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), addEventListener() {} });
  const asked = [];
  page.ctx.confirm = (msg) => { asked.push(msg); return confirms; };
  const session = attachSessionHistory(page, {
    detail: (id) => ({ id, title: board.active.find((c) => c.id === id).title, frontmatter: '', body: '', path: `/board/${id}.card.md`, archived: false }),
  });
  const gone = new Set();
  const writes = [];
  const hold = { board: null };
  const attached = page.ctx.fetch;
  page.ctx.fetch = async (url, init = {}) => {
    const m = /^\/api\/cards\/(\d+)(\/detail)?$/.exec(String(url));
    if (m && gone.has(Number(m[1]))) return json(404, { error: `no card #${m[1]}` });
    if (m && !m[2] && init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      writes.push({ id: Number(m[1]), body });
      Object.assign(board.active.find((c) => c.id === Number(m[1])), { title: body.title, status: body.status });
      return json(200, {});
    }
    if (!m && (init.method || 'GET') === 'GET' && hold.board) await hold.board;
    return attached(url, init);
  };
  await page.start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  const s = {
    page, session, elements, board, gone, writes, hold, asked, focused,
    detail: () => page.run('currentDetailId'),
    detailTitle: () => elements['#detail-title'].textContent,
    formUp: () => !elements['#modal'].classList.contains('hidden'),
    detailUp: () => !elements['#detail-modal'].classList.contains('hidden'),
    toast: () => elements['#toast'].textContent,
    edit: async (title, status = 'todo') => {
      page.run('editFromDetail()');
      elements['#f-title'].value = title;
      elements['#f-status'].value = status;
      await page.settle();
    },
    save: async () => { elements['#card-form'].fire('submit', { preventDefault() {} }); await page.settle(); },
    leave: async () => { page.run('requestCloseModal()'); await page.settle(); },
    esc: async () => { page.fireDocument('keydown', { key: 'Escape', repeat: false }); await page.settle(); },
    ctrlS: async () => { page.fireDocument('keydown', { key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }); await page.settle(); },
  };
  await page.settle();
  if (search) assert.strictEqual(s.detail(), '2', 'the ?card= link opens card 2');
  return s;
}

test('Save from the details writes the card and shows its details again with what was saved, the card still open', async () => {
  for (const phone of [false, true]) {
    const s = await open({ phone });
    await s.edit('Renamed');
    assert.ok(s.formUp() && !s.detailUp(), 'the form stands where the details were');
    const pushes = s.session.pushes;
    await s.save();
    assert.deepStrictEqual(s.writes.map((w) => w.id), [2], `phone ${phone}`);
    assert.ok(!s.formUp());
    assert.ok(s.detailUp());
    assert.strictEqual(s.detailTitle(), '#2 Renamed');
    assert.strictEqual(s.session.search, '?card=2');
    assert.strictEqual(s.session.pushes, pushes, 'no history step is added');
  }
});

test('Save takes the focus to the details', async () => {
  const s = await open();
  await s.edit('Renamed');
  await s.save();
  assert.strictEqual(s.focused.length, 1);
  assert.strictEqual(JSON.stringify(s.focused[0]), JSON.stringify({ preventScroll: true }));
});

test('Ctrl+S in the form saves and returns the same way', async () => {
  const s = await open();
  await s.edit('Renamed by key');
  await s.ctrlS();
  assert.ok(s.detailUp() && !s.formUp());
  assert.strictEqual(s.detailTitle(), '#2 Renamed by key');
});

test('Esc in an untouched form returns to the details with no question and no write', async () => {
  const s = await open();
  await s.edit('Card 2');
  await s.esc();
  assert.ok(!s.formUp());
  assert.ok(s.detailUp());
  assert.strictEqual(s.detailTitle(), '#2 Card 2');
  assert.deepStrictEqual(s.asked, []);
  assert.deepStrictEqual(s.writes, []);
  assert.strictEqual(s.session.search, '?card=2');
  assert.strictEqual(s.focused.length, 1);
});

test('the X and a click on the backdrop leave the form the same way', async () => {
  for (const leave of [(s) => s.elements['#modal-close'].fire('click'), (s) => s.elements['#modal'].fire('click', { target: { id: 'modal' } })]) {
    const s = await open();
    await s.edit('Card 2');
    leave(s);
    await s.page.settle();
    assert.ok(s.detailUp() && !s.formUp());
    assert.strictEqual(s.detailTitle(), '#2 Card 2');
    assert.deepStrictEqual(s.writes, []);
  }
});

test('Esc in a form with unsaved changes asks first: yes returns to the details, cancel keeps the form and the details closed', async () => {
  const yes = await open({ confirms: true });
  await yes.edit('Typed but not saved');
  await yes.esc();
  assert.deepStrictEqual(yes.asked, ['Discard unsaved changes to this card?']);
  assert.ok(yes.detailUp() && !yes.formUp());
  assert.strictEqual(yes.detailTitle(), '#2 Card 2', 'the typing was dropped');
  assert.deepStrictEqual(yes.writes, []);
  const no = await open({ confirms: false });
  await no.edit('Typed but not saved');
  await no.esc();
  assert.strictEqual(no.asked.length, 1);
  assert.ok(no.formUp() && !no.detailUp(), 'cancel keeps you in the form');
  assert.strictEqual(no.session.search, '?card=2');
});

test('a form opened any other way saves and closes to the board, and so does leaving it', async () => {
  const s = await open();
  s.page.run('closeDetailModal()');
  s.page.run('openModal(null)');
  s.elements['#f-title'].value = 'Fresh';
  s.elements['#f-status'].value = 'todo';
  await s.esc();
  assert.ok(!s.formUp() && !s.detailUp());
  s.page.run('openModal(null)');
  s.elements['#f-title'].value = 'Fresh';
  await s.save();
  assert.ok(!s.formUp() && !s.detailUp());
  assert.strictEqual(s.detail(), null);
});

test('the edit form of one card then a new card\'s form: leaving the second shows no details', async () => {
  const s = await open();
  await s.edit('Card 2');
  await s.esc();
  s.page.run('closeDetailModal()');
  s.page.run('openModal(null)');
  await s.esc();
  assert.ok(!s.detailUp(), 'the card the last form came from is forgotten');
});

test('a refused save keeps the form open and returns nowhere', async () => {
  const s = await open();
  await s.edit('Renamed');
  const real = s.page.ctx.fetch;
  s.page.ctx.fetch = async (url, init = {}) => (init.method === 'PATCH' ? json(422, { error: 'no' }) : real(url, init));
  await s.save();
  assert.ok(s.formUp() && !s.detailUp());
});

test('Back while the form is open: leaving it shows the card the address names, so the two agree', async () => {
  const s = await open();
  await s.page.run('openCard(3)');
  await s.page.settle();
  assert.strictEqual(s.session.search, '?card=3');
  await s.edit('Card 3');
  s.session.popupOpen = true; // the page sees the form as a popup over the board
  s.session.back();
  await s.page.settle();
  assert.strictEqual(s.session.search, '?card=2');
  assert.ok(s.formUp(), 'Back leaves the open form alone');
  await s.esc();
  assert.ok(!s.formUp() && s.detailUp());
  assert.strictEqual(s.detail(), '2');
  assert.strictEqual(s.detailTitle(), '#2 Card 2');
  assert.strictEqual(s.session.search, '?card=2');
});

test('Back to an address with no card while the form is open: Save writes the card and leaves the board showing, the address agreeing', async () => {
  const s = await open({ search: '' });
  await s.page.run('openCard(2)');
  await s.page.settle();
  await s.edit('Renamed');
  s.session.popupOpen = true;
  s.session.back();
  await s.page.settle();
  assert.strictEqual(s.session.search, '');
  await s.save();
  s.session.popupOpen = false;
  assert.deepStrictEqual(s.writes.map((w) => w.id), [2]);
  assert.ok(!s.formUp() && !s.detailUp());
  assert.strictEqual(s.detail(), null);
  assert.strictEqual(s.session.search, '');
  s.session.forward();
  await s.page.settle();
  assert.ok(s.detailUp(), 'Forward still opens the card');
  assert.strictEqual(s.detailTitle(), '#2 Renamed');
});

test('Back after returning steps through the history as it did before the edit', async () => {
  const s = await open({ search: '' });
  await s.page.run('openCard(2)');
  await s.page.settle();
  await s.edit('Renamed');
  await s.save();
  assert.strictEqual(s.session.index, 1);
  s.session.back();
  await s.page.settle();
  assert.ok(!s.detailUp(), 'Back closes the card');
  assert.strictEqual(s.session.search, '');
});

test('a card deleted on disk while its form was open: leaving the form closes to the board, says the card is gone and clears the address', async () => {
  const s = await open();
  await s.edit('Card 2');
  s.gone.add(2);
  const pushes = s.session.pushes;
  await s.esc();
  assert.ok(!s.formUp() && !s.detailUp());
  assert.strictEqual(s.detail(), null);
  assert.match(s.toast(), /#2/);
  assert.match(s.toast(), /gone/);
  assert.doesNotMatch(s.toast(), /Load failed/);
  assert.strictEqual(s.session.search, '', 'the stale ?card=2 is gone');
  assert.strictEqual(s.session.pushes, pushes, 'the dead card\'s step is replaced, not stacked on');
});

test('another card opened while Save waits on the board is not pulled back to the one edited', async () => {
  const s = await open();
  await s.edit('Renamed');
  let release;
  s.hold.board = new Promise((r) => { release = r; });
  const saving = s.save();
  await s.page.settle();
  await s.page.run('openCard(3)');
  await s.page.settle();
  assert.strictEqual(s.detail(), '3');
  release();
  await saving;
  await s.page.settle();
  assert.strictEqual(s.detail(), '3', 'the details still show the card the person opened');
  assert.strictEqual(s.detailTitle(), '#3 Card 3');
  assert.strictEqual(s.session.search, '?card=3');
  assert.deepStrictEqual(s.writes.map((w) => w.id), [2], 'the edit itself was saved');
});

test('a card closed while Save waits on the board stays closed', async () => {
  const s = await open();
  await s.edit('Renamed');
  let release;
  s.hold.board = new Promise((r) => { release = r; });
  const saving = s.save();
  await s.page.settle();
  s.page.run('closeCard()');
  release();
  await saving;
  await s.page.settle();
  assert.ok(!s.detailUp());
  assert.strictEqual(s.session.search, '');
});

test('the details can take the focus the form hands back, and no rule hides its focus ring from the keyboard', () => {
  const web = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
  const html = fs.readFileSync(path.join(web, 'app.html'), 'utf8');
  const css = fs.readFileSync(path.join(web, 'app.css'), 'utf8');
  assert.match(html, /<div class="modal detail-modal" tabindex="-1">/);
  assert.doesNotMatch(css, /\.detail-modal:focus\s*\{\s*outline:\s*none/);
});
