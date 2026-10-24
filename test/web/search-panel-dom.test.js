const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control } = require('./helpers/page-vm');

// The search panel's pill buttons, drawn by the page's own code onto a small stand-in
// for the DOM (children, attributes, classes, insertBefore, remove): what is built,
// that a repaint and a poll update the buttons where they stand, and that a pill
// that has focus is still the same element afterwards. The real page is looked at in
// the browser runner (scenarios/search-panel.js).

function fakeDom() {
  const create = (tag) => {
    const el = {
      tag, isFake: true, children: [], dataset: {}, attrs: {}, parent: null, title: '', type: '', className: '', text: '',
      classes() { return new Set(this.className.split(/\s+/).filter(Boolean)); },
      classList: {
        toggle(name, force) {
          const set = el.classes();
          const on = force === undefined ? !set.has(name) : !!force;
          if (on) set.add(name); else set.delete(name);
          el.className = [...set].join(' ');
          return on;
        },
        contains: (name) => el.classes().has(name),
      },
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
      append(...nodes) { for (const n of nodes) { n.parent = el; el.children.push(n); } },
      insertBefore(node, ref) {
        if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
        node.parent = el;
        const at = ref ? el.children.indexOf(ref) : el.children.length;
        el.children.splice(at, 0, node);
      },
      remove() { if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el); el.parent = null; },
      closest(sel) {
        const cls = sel.replace(/^\./, '');
        for (let n = el; n && n.isFake === true; n = n.parent) if (n.classes().has(cls)) return n;
        return null;
      },
    };
    Object.defineProperty(el, 'textContent', { configurable: true, get: () => el.text, set: (v) => { el.text = String(v); } });
    return el;
  };
  return { createElement: create };
}

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});
const makeBoard = () => ({
  projectName: 'kanban', statuses: ['backlog', 'todo', 'doing', 'done'], priorities: ['High', 'Normal', 'Low'],
  assignees: [], tags: [], types: [], notifications: [],
  active: [
    card(1, { title: 'Zephyr migration', status: 'doing' }),
    card(2, { waiting_for: [1] }),
    card(4, { blocked: 'vendor' }),
    card(5, { status: 'doing', review: 'copy needs eyes' }),
  ],
  archived: [],
});

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];

async function open() {
  const dom = fakeDom();
  const elements = {};
  for (const sel of HIDDEN) { const el = control(); el.classList.add('hidden'); elements[sel] = el; }
  const host = control();
  host.children = [];
  host.ownerDocument = dom;
  host.insertBefore = (node, ref) => {
    if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
    node.parent = host;
    host.children.splice(ref ? host.children.indexOf(ref) : host.children.length, 0, node);
  };
  host.classList.toggle = ((orig) => (name, force) => orig(name, force))(host.classList.toggle);
  elements['#search-pills'] = host;
  const fold = control();
  fold.attrs = {};
  fold.setAttribute = (k, v) => { fold.attrs[k] = String(v); };
  elements['#search-pills-fold'] = fold;
  const board = makeBoard();
  const page = await loadPage({ board, stored: { 'kanban.kanban.view.mode': 'board' }, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
  return { page, board, host, fold, dom, elements };
}

const labels = (host) => host.children.map((b) => b.children[0].textContent);
const counts = (host) => host.children.map((b) => b.children[1].textContent);

test('opening the panel draws one button per pill, in order, each with its label and count, none pressed', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  assert.deepStrictEqual(labels(s.host), ['blocked', 'review', 'waiting']);
  assert.deepStrictEqual(counts(s.host), ['1', '1', '1']);
  assert.deepStrictEqual(s.host.children.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false']);
  assert.deepStrictEqual(s.host.children.map((b) => b.dataset.pillKey), ['blocked', 'review', 'waiting']);
});

test('each is a button that does not submit, and keeps a selection when clicked, and none holds the poll', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  for (const b of s.host.children) {
    assert.strictEqual(b.tag, 'button');
    assert.strictEqual(b.type, 'button');
    assert.strictEqual(b.className.split(' ')[0], 'query-pill', 'a class of its own, not a status pill\'s');
    assert.strictEqual('keepsSelection' in b.dataset, true);
    assert.strictEqual('holdsPoll' in b.dataset, false, 'a button left focused by a click would stop the poll for good');
  }
});

test('a pill shows as pressed, with the class that draws it on, while its query is the anchor, and as not pressed again when it is not', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  s.host.fire('click', { target: s.host.children[1], shiftKey: false, preventDefault() {} });
  assert.deepStrictEqual(s.host.children.map((b) => b.attrs['aria-pressed']), ['false', 'true', 'false']);
  assert.deepStrictEqual(s.host.children.map((b) => b.classList.contains('on')), [false, true, false]);
  s.host.fire('click', { target: s.host.children[1], shiftKey: false, preventDefault() {} });
  assert.deepStrictEqual(s.host.children.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false']);
  assert.deepStrictEqual(s.host.children.map((b) => b.classList.contains('on')), [false, false, false]);
});

test('a click on a label inside a pill, not the button, is a click on the pill', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  s.host.fire('click', { target: s.host.children[0].children[0], shiftKey: false, preventDefault() {} });
  assert.strictEqual(s.page.input.value, 'blocked:');
});

test('a click on a second pill, with Shift or without, draws both as pressed, and the box holds both', async () => {
  for (const shiftKey of [false, true]) {
    const s = await open();
    s.page.run('setSearchPanelOpen(true)');
    s.host.fire('click', { target: s.host.children[1], shiftKey: false, preventDefault() {} });
    s.host.fire('click', { target: s.host.children[0], shiftKey, preventDefault() {} });
    assert.deepStrictEqual(s.host.children.map((b) => b.attrs['aria-pressed']), ['true', 'true', 'false'], `shift ${shiftKey}`);
    assert.strictEqual(s.page.input.value, 'review: | blocked:');
    s.host.fire('click', { target: s.host.children[1], shiftKey, preventDefault() {} });
    assert.deepStrictEqual(s.host.children.map((b) => b.attrs['aria-pressed']), ['true', 'false', 'false'], 'a click on an on pill turns that one off');
  }
});

test('a right-click solos a pill, so only its button is pressed, and a right-click on it again leaves none pressed', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  const press = (at, type) => s.host.fire(type, { target: s.host.children[at], shiftKey: false, preventDefault() {} });
  press(0, 'click');
  press(1, 'click');
  assert.deepStrictEqual(s.host.children.map((b) => b.attrs['aria-pressed']), ['true', 'true', 'false']);
  press(2, 'contextmenu');
  assert.deepStrictEqual(s.host.children.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'true']);
  assert.deepStrictEqual(s.host.children.map((b) => b.classList.contains('on')), [false, false, true]);
  assert.strictEqual(s.page.input.value, 'waiting:');
  press(2, 'contextmenu');
  assert.deepStrictEqual(s.host.children.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'false']);
  assert.strictEqual(s.page.input.value, '');
});

test('a pill\'s tooltip says what a click and a right-click do', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  for (const b of s.host.children) {
    assert.match(b.title, /click: turn it on or off/);
    assert.match(b.title, /right-click: only this pill/);
    assert.doesNotMatch(b.title, /shift/i, 'Shift+click is a plain click, so the tooltip does not offer it');
  }
});

test('a poll updates the buttons where they stand: the same elements, the new count, and the one with focus is still the one with focus', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  const before = [...s.host.children];
  s.host.fire('click', { target: before[1], shiftKey: false, preventDefault() {} });
  s.page.ctx.document.activeElement = before[1];
  s.board.active.push(card(9, { review: 'look at this' }));
  await s.page.run('autoRefreshTick()');
  assert.deepStrictEqual(counts(s.host), ['1', '2', '1'], 'the count changed under the pill');
  assert.ok(s.host.children.every((b, i) => b === before[i]), 'no button was rebuilt');
  assert.strictEqual(s.page.ctx.document.activeElement, before[1], 'the focused pill is the element it was');
  assert.strictEqual(s.host.children[1].attrs['aria-pressed'], 'true');
});

test('a repaint with nothing changed writes nothing to the buttons', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  const writes = [];
  for (const b of s.host.children) {
    const set = b.setAttribute;
    b.setAttribute = (k, v) => { writes.push(k); set(k, v); };
    const count = b.children[1];
    Object.defineProperty(count, 'textContent', { configurable: true, get: () => count.text, set: (v) => { writes.push('count'); count.text = String(v); } });
  }
  s.page.run('renderBoard()');
  s.page.run('renderBoard()');
  assert.deepStrictEqual(writes, []);
});

test('a pill that leaves the list is taken out and one that joins is built, and the others stay as they are', async () => {
  const s = await open();
  s.page.run('setSearchPanelOpen(true)');
  const [blocked, review, waiting] = s.host.children;
  s.page.run('syncPillButtons(document.querySelector("#search-pills"), [{ key: "review", label: "review", query: "review:", count: 4 }, { key: "next", label: "next", query: "tags:next", count: 2 }], selectionState.selection)');
  assert.deepStrictEqual(s.host.children.map((b) => b.dataset.pillKey), ['review', 'next']);
  assert.strictEqual(s.host.children[0], review, 'the one that stayed is the element it was');
  assert.strictEqual(s.host.children[0].children[1].textContent, '4');
  assert.ok(![blocked, waiting].some((b) => s.host.children.includes(b)));
});

test('a closed panel draws no buttons and counts nothing: opening it does', async () => {
  const s = await open();
  assert.strictEqual(s.host.children.length, 0);
  s.page.run('renderBoard()');
  assert.strictEqual(s.host.children.length, 0);
  s.page.run('setSearchPanelOpen(true)');
  assert.strictEqual(s.host.children.length, 3);
  s.page.run('setSearchPanelOpen(false)');
  assert.strictEqual(s.host.children.length, 3, 'closing hides the panel and leaves its buttons where they are');
});

test('the fold control folds the section and says so, and unfolds it again', async () => {
  const s = await open();
  assert.strictEqual(s.host.classList.contains('hidden'), false);
  s.page.run('toggleSearchPillsFold()');
  assert.strictEqual(s.host.classList.contains('hidden'), true);
  assert.strictEqual(s.fold.attrs['aria-expanded'], 'false');
  s.page.run('toggleSearchPillsFold()');
  assert.strictEqual(s.host.classList.contains('hidden'), false);
  assert.strictEqual(s.fold.attrs['aria-expanded'], 'true');
});

test('the fold control and the toggle are wired, and so is the press outside the bar that closes the panel', async () => {
  const s = await open();
  const press = (inside) => s.page.fireDocument('mousedown', { target: { closest: (sel) => (inside && sel === '.search-bar' ? {} : null) } });
  s.page.run('setSearchPanelOpen(true)');
  press(true);
  assert.strictEqual(s.page.run('searchPanelIsOpen()'), true, 'a press inside the bar leaves the panel open');
  press(false);
  assert.strictEqual(s.page.run('searchPanelIsOpen()'), false, 'a press anywhere else closes it');
  press(false);
  assert.strictEqual(s.page.run('searchPanelIsOpen()'), false);
});

test('a press outside the bar closes the panel without moving focus: the press has put it where the person pointed', async () => {
  const s = await open();
  const toggle = control();
  let focused = 0;
  toggle.focus = () => { focused++; };
  s.elements['#search-panel-toggle'] = toggle;
  s.page.ctx.document.querySelector = ((orig) => (sel) => (sel === '#search-panel-toggle' ? toggle : orig(sel)))(s.page.ctx.document.querySelector);
  s.page.run('setSearchPanelOpen(true)');
  s.page.fireDocument('mousedown', { target: { closest: () => null } });
  assert.strictEqual(focused, 0);
});
