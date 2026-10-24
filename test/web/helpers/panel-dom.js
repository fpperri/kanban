'use strict';
// The search panel's pill section on a small stand-in for the DOM (children,
// attributes, classes, insertBefore, remove), with the real page's scripts run
// against it by helpers/page-vm.js: what the page draws onto the pills' host, and
// what a click on one of the buttons it drew does. Not a test file (the suite runs
// *.test.js only).
const { loadPage, control } = require('./page-vm');

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

const HIDDEN = ['#context-menu', '#notif-modal', '#prefs-sheet', '#detail-modal', '#modal', '#bulk-single', '#bulk-tags', '#bulk-schedule', '#bulk-archive', '#search-panel'];

// The page with the board's answer, the panel's pill host drawn on the stand-in, and
// the chip as an element that remembers its text and its accessible name.
// `typing` is whether the Board's Typing isolates is on: off unless a test says so, since a pill that
// turns isolate on adds "isolated" to the chip and a test of the pills alone does not want it.
async function openPanelPage({ board, view = 'board', open = true, typing = false } = {}) {
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
  elements['#search-pills'] = host;
  const fold = control();
  fold.attrs = {};
  fold.setAttribute = (k, v) => { fold.attrs[k] = String(v); };
  elements['#search-pills-fold'] = fold;
  const chip = control();
  chip.attrs = {};
  chip.setAttribute = (k, v) => { chip.attrs[k] = String(v); };
  chip.classList.add('hidden');
  let chipText = '';
  Object.defineProperty(chip, 'textContent', { configurable: true, get: () => chipText, set: (v) => { chipText = String(v); } });
  elements['#search-chip'] = chip;
  const page = await loadPage({ board, stored: { 'kanban.kanban.view.mode': view, 'kanban.kanban.typing.isolates': JSON.stringify({ board: typing }) }, elements }).start();
  if (page.failures.length) throw new Error(`the page starts without an error: ${page.failures.map((e) => e.message)}`);
  if (open) page.run('setSearchPanelOpen(true)');
  const sorted = (set) => [...set].sort((a, b) => a - b);
  const press = (type, target, init = {}) => {
    let prevented = 0;
    host.fire(type, { target, shiftKey: false, preventDefault() { prevented++; }, ...init });
    return prevented;
  };
  return {
    page, board, host, fold, chip, elements,
    buttons: () => host.children,
    pills: () => host.children.filter((b) => b.classList.contains('query-pill')),
    more: () => host.children.filter((b) => b.classList.contains('query-pill-more')),
    labels: () => host.children.map((b) => (b.classList.contains('query-pill-more') ? b.textContent : b.children[0].textContent)),
    counts: () => host.children.filter((b) => b.classList.contains('query-pill')).map((b) => b.children[1].textContent),
    byKey: (key) => host.children.find((b) => b.dataset.pillKey === key),
    byLabel: (label) => host.children.find((b) => b.classList.contains('query-pill') && b.children[0].textContent === label),
    click: (button, init) => press('click', button, init),
    rightClick: (button, init) => press('contextmenu', button, init),
    box: () => page.input.value,
    selection: () => JSON.parse(JSON.stringify(page.run('selectionState.selection'))),
    ids: () => sorted(page.run('selectedIds')),
    shown: () => sorted(page.run('shownCardIds()')),
    pressed: () => host.children.filter((b) => b.classList.contains('query-pill') && b.attrs['aria-pressed'] === 'true').map((b) => b.children[0].textContent),
    poll: () => page.run('autoRefreshTick()'),
  };
}

module.exports = { openPanelPage, card, fakeDom };
