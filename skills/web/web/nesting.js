'use strict';
// Pure nesting rules: which card sits under which, and in what order a board
// reads as an outline. No DOM, no storage, and no other module on purpose: the
// snapshot embeds this file's source verbatim, where nothing else is loaded.
// Same dual-environment pattern as search.js / column-sort.js.
//
// A card here is { id, parent, rank, priority, board? }. `parent` and `rank`
// may be the card store's parsed values or the raw frontmatter strings. ctx is
// { board: <this board's name>, priorities: [<highest first>] }.

function nestUnquote(raw) {
  return String(raw).trim().replace(/^(["'])(.*)\1$/, '$2').trim();
}

// null | { board: string|null, id, local }. A number or digit string names a
// card on this board; `board#id` names another board's card, except that this
// board's own name in that form is this board. Anything else is no parent.
function parseParent(raw, boardName) {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 ? { board: null, id: raw, local: true } : null;
  }
  if (typeof raw !== 'string') return null;
  const text = nestUnquote(raw);
  if (/^\d+$/.test(text)) return { board: null, id: parseInt(text, 10), local: true };
  const m = /^([^#]+)#(\d+)$/.exec(text);
  if (!m) return null;
  const board = m[1].trim();
  if (!board) return null;
  const id = parseInt(m[2], 10);
  return board === boardName ? { board: null, id, local: true } : { board, id, local: false };
}

// A finite number, else null. Blank must not read as 0.
function parseRank(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const text = nestUnquote(raw);
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
}

const NEST_DEFAULT_PRIORITIES = ['High', 'Normal', 'Low'];

// Position in the board's priority list, earlier = higher; unknown after known.
function nestPriorityPosition(card, ctx) {
  const list = ctx && ctx.priorities && ctx.priorities.length ? ctx.priorities : NEST_DEFAULT_PRIORITIES;
  const i = list.indexOf(card.priority);
  return i === -1 ? list.length : i;
}

// Siblings: ranked by rank (equal ranks by board name, then id), then the
// unranked by priority, then id.
function siblingsCompare(a, b, ctx) {
  const ra = parseRank(a.rank);
  const rb = parseRank(b.rank);
  if (ra !== null || rb !== null) {
    if (ra === null) return 1;
    if (rb === null) return -1;
    if (ra !== rb) return ra - rb;
    const ba = String(a.board || '');
    const bb = String(b.board || '');
    if (ba !== bb) return ba < bb ? -1 : 1;
    return a.id - b.id;
  }
  const pa = nestPriorityPosition(a, ctx);
  const pb = nestPriorityPosition(b, ctx);
  return pa !== pb ? pa - pb : a.id - b.id;
}

function nestParentId(card, ctx) {
  const p = parseParent(card.parent, ctx && ctx.board);
  return p && p.local ? p.id : null;
}

// Roots are cards with no parent on this board, or whose parent is not among
// the cards given.
function nestTree(cards, ctx) {
  const byId = new Map();
  for (const c of cards) if (!byId.has(c.id)) byId.set(c.id, c);
  const kids = new Map();
  const roots = [];
  for (const c of byId.values()) {
    const pid = nestParentId(c, ctx);
    if (pid === null || !byId.has(pid)) { roots.push(c); continue; }
    if (!kids.has(pid)) kids.set(pid, []);
    kids.get(pid).push(c);
  }
  const bySiblings = (a, b) => siblingsCompare(a, b, ctx);
  roots.sort(bySiblings);
  for (const list of kids.values()) list.sort(bySiblings);
  return { byId, kids, roots };
}

function childrenOf(cards, id, ctx) {
  return nestTree(cards, ctx).kids.get(id) || [];
}

// Parents above a card; a root is 0. A chain that loops stops at the card it
// would repeat.
function depthOf(cards, id, ctx) {
  const { byId } = nestTree(cards, ctx);
  const seen = new Set([id]);
  let depth = 0;
  let cur = byId.get(id);
  while (cur) {
    const pid = nestParentId(cur, ctx);
    if (pid === null || !byId.has(pid) || seen.has(pid)) break;
    seen.add(pid);
    depth++;
    cur = byId.get(pid);
  }
  return depth;
}

// Parents before their children, siblings in sibling order, over every card
// given (pass active and archived together: an archived parent is still a
// parent). Cards on a parent loop have no root to reach; the lowest id of the
// loop becomes their entry, so no card is ever lost or visited twice.
// Returns { ids: ordered ids, index: Map id -> position }.
function outlineOrder(cards, ctx) {
  const { byId, kids, roots } = nestTree(cards, ctx);
  const ids = [];
  const seen = new Set();
  const walk = (start) => {
    const stack = [start];
    while (stack.length) {
      const c = stack.pop();
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      ids.push(c.id);
      const list = kids.get(c.id);
      if (list) for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
    }
  };
  for (const root of roots) walk(root);
  const rest = [...byId.values()].filter((c) => !seen.has(c.id)).sort((a, b) => a.id - b.id);
  for (const c of rest) {
    if (seen.has(c.id)) continue;
    const path = [];
    const at = new Map();
    let cur = c;
    while (!at.has(cur.id)) {
      at.set(cur.id, path.length);
      path.push(cur);
      cur = byId.get(nestParentId(cur, ctx));
    }
    const loop = path.slice(at.get(cur.id));
    walk(loop.reduce((low, x) => (x.id < low.id ? x : low)));
  }
  const index = new Map();
  ids.forEach((id, i) => index.set(id, i));
  return { ids, index };
}

// True when any card has a rank or a parent, however written.
function hasNesting(cards) {
  return cards.some((c) => parseRank(c.rank) !== null || parseParent(c.parent) !== null);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseParent, parseRank, siblingsCompare, childrenOf, depthOf, outlineOrder, hasNesting };
} else {
  window.parseParent = parseParent;
  window.parseRank = parseRank;
  window.siblingsCompare = siblingsCompare;
  window.childrenOf = childrenOf;
  window.depthOf = depthOf;
  window.outlineOrder = outlineOrder;
  window.hasNesting = hasNesting;
}
