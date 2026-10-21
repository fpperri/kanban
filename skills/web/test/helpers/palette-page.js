'use strict';
// The notes palette in the real page (helpers/page-vm.js), on elements a test can read back and
// drive (helpers/recording-dom.js, given the few members the palette reaches for: replaceChildren,
// querySelectorAll, contains, focus and text nodes). `notes` and `cards` are the board's; `stored`
// is localStorage. Not a test file (the suite runs *.test.js only).
const { loadPage, control } = require('./page-vm');
const { recordingElement } = require('./recording-dom');

const card = (id, title, over = {}) => ({
  id, title, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: null, end_date: null, due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const note = (day, target, at, by, text, index = 0) => ({ day, target, at, by, note: text, index, file: `/logbook/${day}.md` });

// A selector of the shapes the palette uses: compounds of a tag, classes and [data-x="v"], joined by
// spaces (a descendant) and commas (any of).
function compound(part) {
  const tag = /^[a-z][a-z0-9]*/.exec(part);
  const rest = part.slice(tag ? tag[0].length : 0);
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const attrs = [...rest.matchAll(/\[data-([a-z-]+)="([^"]*)"\]/g)].map((m) => [m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), m[2]]);
  if (rest.replace(/\.[\w-]+|\[data-[a-z-]+="[^"]*"\]/g, '') !== '') throw new Error(`palette-page.js cannot match ${part}`);
  return (el) => (!tag || el.tag === tag[0]) && classes.every((c) => el.classes.includes(c)) && attrs.every(([k, v]) => el.dataset && el.dataset[k] === v);
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
  const make = (tag) => {
    const el = recordingElement(tag);
    el.uid = ++uid;
    el.style = {};
    el.value = '';
    el.hidden = false;
    el.isConnected = true;
    // A text area needs 20px a line and 12px of padding; a line wraps at 40 characters.
    Object.defineProperty(el, 'scrollHeight', {
      get: () => (tag === 'textarea' ? 12 + 20 * String(el.value).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 40)), 0) : 0),
    });
    el.replaceChildren = (...kids) => { el.children.length = 0; el.append(...kids); };
    el.descendants = () => el.walk().slice(1);
    el.querySelectorAll = (sel) => { const is = matcher(sel); return el.descendants().filter((e) => e.classes && is(e)); };
    el.querySelector = (sel) => el.querySelectorAll(sel)[0] || null;
    el.contains = (other) => !!other && other.uid !== undefined && el.walk().some((e) => e.uid === other.uid);
    el.focus = () => { holder.document.activeElement = el; };
    el.blur = () => { if (holder.document.activeElement === el) holder.document.activeElement = null; };
    el.click = () => el.fire('click', { stopPropagation() {}, preventDefault() {}, target: el });
    return el;
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

async function openPalette({ cards, notes, stored = {}, viewport = {}, elements: more = {}, scratchpad = null } = {}) {
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
  };
  const elements = { '#detail-modal': control(), '#ctx-note': control(), ...more };
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
  return { page, doc, ui, pal, find, all, text, rows, press, stored, board };
}

module.exports = { openPalette, card, note, paletteDocument, matcher };
