'use strict';
// The notes palette in the real page (helpers/page-vm.js), on elements a test can read back and
// drive (helpers/recording-dom.js, given the few members the palette reaches for: replaceChildren,
// querySelectorAll, contains, focus and text nodes). `notes` and `cards` are the board's; `stored`
// is localStorage. Not a test file (the suite runs *.test.js only).
const { loadPage, control } = require('./page-vm');
const { recordingElement } = require('./recording-dom');
const { buildMenu } = require('./menu-dom');

const card = (id, title, over = {}) => ({
  id, title, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const note = (day, target, at, by, text, index = 0) => ({ day, target, at, by, note: text, index, file: `/logbook/${day}.md` });

// A selector of the shapes the page uses: compounds of a tag, an #id, classes and [data-x="v"], joined by
// spaces (a descendant) and commas (any of).
function compound(part) {
  const tag = /^[a-z][a-z0-9]*/.exec(part);
  const rest = part.slice(tag ? tag[0].length : 0);
  const id = /#([\w-]+)/.exec(rest);
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...rest.matchAll(/\[data-([a-z-]+)="([^"]*)"\]/g)].map((m) => [m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), m[2]]);
  if (rest.replace(/#[\w-]+|\.[\w-]+|\[data-[a-z-]+="[^"]*"\]/g, '') !== '') throw new Error(`palette-page.js cannot match ${part}`);
  return (el) => (!tag || el.tag === tag[0]) && (!id || el.id === id[1]) && classes.every((c) => el.classes.includes(c)) && attrs.every(([k, v]) => el.dataset && el.dataset[k] === v);
}

function matcher(selector) {
  const chains = selector.split(',').map((chain) => chain.trim().split(/\s+/).map(compound));
  return (el) => chains.some((chain) => {
    const last = chain[chain.length - 1];
    if (!last(el)) return false;
    let up = el.parent;
    for (let i = chain.length - 2; i >= 0; i--) {
      while (up && !chain[i](up)) up = up.parent;
      if (!up) return false;
      up = up.parent;
    }
    return true;
  });
}

function paletteDocument(holder) {
  const doc = { activeElement: null };
  let uid = 0;
  const known = new Map(); // uid -> the element as the page holds it, so a lookup answers what was appended, not its raw twin
  const same = (e) => (e.uid !== undefined && known.has(e.uid) ? known.get(e.uid) : e);
  const make = (tag) => {
    const el = recordingElement(tag);
    el.uid = ++uid;
    known.set(el.uid, el);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    el.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    el.value = '';
    el.hidden = false;
    el.isConnected = true;
    // A text area needs 20px a line and 12px of padding; a line wraps at 40 characters.
    Object.defineProperty(el, 'scrollHeight', {
      get: () => (tag === 'textarea' ? 12 + 20 * String(el.value).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 40)), 0) : 0),
    });
    // A text field keeps a selection, which setRangeText and the editing command move.
    el.selectionStart = 0;
    el.selectionEnd = 0;
    el.setSelectionRange = (a, b) => { el.selectionStart = a; el.selectionEnd = b; };
    el.setRangeText = (text, from, to, mode) => {
      el.value = el.value.slice(0, from) + text + el.value.slice(to);
      if (mode === 'end') { el.selectionStart = from + text.length; el.selectionEnd = from + text.length; }
    };
    Object.defineProperty(el, 'parentElement', { get: () => (el.parent ? same(el.parent) : null) });
    el.select = () => { el.selectionStart = 0; el.selectionEnd = String(el.value).length; };
    el.dispatchEvent = (event) => el.fire(event.type || 'event', event);
    el.replaceChildren = (...kids) => { el.children.length = 0; el.append(...kids); };
    el.descendants = () => el.walk().slice(1).map(same);
    el.querySelectorAll = (sel) => { const is = matcher(sel); return el.descendants().filter((e) => e.classes && is(e)); };
    el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null;
    el.contains = (other) => !!other && other.uid !== undefined && el.walk().some((e) => e.uid === other.uid);
    el.focus = () => { holder.document.activeElement = el; };
    el.blur = () => { if (holder.document.activeElement === el) holder.document.activeElement = null; };
    el.closest = (sel) => {
      const is = matcher(sel);
      for (let n = el; n; n = n.parent) if (n.classes && is(n)) return same(n);
      return null;
    };
    el.click = () => el.fire('click', { stopPropagation() {}, preventDefault() {}, target: el });
    return el;
  };
  // The editing command acts on the field that has focus, and fires its input event as the browser does;
  // `refuse` makes it say no, as a browser that lacks it would.
  doc.refuseExecCommand = false;
  doc.execCommand = (cmd, ui, text) => {
    const at = holder.document.activeElement;
    if (doc.refuseExecCommand || !at || at.tag !== 'textarea') return false;
    const from = at.selectionStart;
    const to = at.selectionEnd;
    const insert = cmd === 'delete' ? '' : String(text);
    at.value = at.value.slice(0, from) + insert + at.value.slice(to);
    at.selectionStart = from + insert.length;
    at.selectionEnd = from + insert.length;
    at.fire('input', { type: 'input' });
    return true;
  };
  doc.createElement = make;
  doc.createElementNS = (ns, tag) => make(tag);
  doc.createDocumentFragment = () => make('#fragment');
  doc.createTextNode = (text) => ({ tag: '#text', textContent: String(text), children: [], classes: [], walk() { return [this]; } });
  doc.body = make('body');
  return doc;
}

// What the stylesheet gives a note box: a 20px line, 6px of padding and a 1px border all round.
const TEXT_AREA = { lineHeight: '20px', fontSize: '15px', paddingTop: '6px', paddingBottom: '6px', borderTopWidth: '1px', borderBottomWidth: '1px' };

async function openPalette({ cards, notes, stored = {}, viewport = {}, elements: more = {}, scratchpad = null, groups = null, menu = false } = {}) {
  const holder = { document: null };
  const documentExtras = paletteDocument(holder);
  const board = {
    projectName: 'kanban',
    statuses: ['backlog', 'todo', 'doing', 'done'],
    priorities: ['High', 'Normal', 'Low'],
    assignees: [{ handle: '@human', kind: 'human' }, { handle: '@afk', kind: 'ai' }], tags: [], types: [], notifications: [],
    active: cards || [card(7, 'Port the zephyr schema'), card(22, 'Cut over the data layer'), card(3, 'Write the cutover plan')],
    archived: [],
    logbook: { folder: 'logbook', notes: notes || [] },
    scratchpad,
    groups,
  };
  const built = menu ? buildMenu(documentExtras) : null;
  const elements = { '#detail-modal': control(), '#ctx-note': control(), ...(built ? { '#context-menu': built.root, ...built.byId } : {}), ...more };
  const page = await loadPage({ board, stored, documentExtras, elements }).start();
  Object.assign(page.ctx, { getComputedStyle: () => TEXT_AREA, ...viewport });
  const doc = page.ctx.document;
  holder.document = doc;
  const ui = () => page.run('notesUi');
  const pal = () => ui().el;
  const find = (sel) => pal().querySelector(sel);
  const all = (sel) => pal().querySelectorAll(sel);
  const text = (el) => el.textContent + el.children.map(text).join('');
  const rows = () => all('.np-note').map((r) => text(r.querySelector('.np-note-text')));
  const press = (target, key, over = {}) => {
    const e = { key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...over };
    target.fire('keydown', e);
    return e;
  };
  return { page, doc, ui, pal, find, all, text, rows, press, stored, board, menu: built, extras: documentExtras };
}

module.exports = { openPalette, card, note, paletteDocument, matcher };
