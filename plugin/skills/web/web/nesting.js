'use strict';
// Pure nesting rules: which card sits under which, and in what order a board
// reads as an outline. No DOM, no storage, and one other module, the id module:
// the snapshot embeds this file's source verbatim, ids.js ahead of it.
// Same dual-environment pattern as search.js / column-sort.js.
//
// A card here is { id, parent, rank, priority, board? }. `parent` and `rank`
// may be the card store's parsed values or the raw frontmatter strings. ctx is
// { board: <this board's name>, priorities: [<highest first>] }. An id is the
// whole id (`7`, `G7`) as a string; a plain number names the same card, and
// every map here is keyed on the id module's string.

const NEST_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

// The map key of a card id: the id module's whole-id string.
function nestKey(id) {
  const key = NEST_IDS.idKey(id);
  return key === null ? String(id) : key;
}

function nestUnquote(raw) {
  return String(raw).trim().replace(/^(["'])(.*)\1$/, '$2').trim();
}

// null | { board: string|null, id, local }, the id a whole-id string. An id (or
// a plain number) names a card on this board; `board#id` names another board's
// card, except that this board's own name in that form is this board. Anything
// else is no parent.
function parseParent(raw, boardName) {
  if (typeof raw === 'number') {
    const key = NEST_IDS.idKey(raw);
    return key === null ? null : { board: null, id: key, local: true };
  }
  if (typeof raw !== 'string') return null;
  const text = nestUnquote(raw);
  const own = NEST_IDS.idKey(text);
  if (own !== null) return { board: null, id: own, local: true };
  const hash = text.lastIndexOf('#');
  if (hash < 1) return null;
  const id = NEST_IDS.idKey(text.slice(hash + 1));
  if (id === null) return null;
  const board = text.slice(0, hash).trim();
  if (!board || board.includes('#')) return null;
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
    return NEST_IDS.compareIds(a.id, b.id);
  }
  const pa = nestPriorityPosition(a, ctx);
  const pb = nestPriorityPosition(b, ctx);
  return pa !== pb ? pa - pb : NEST_IDS.compareIds(a.id, b.id);
}

function localParentId(card, ctx) {
  const p = parseParent(card.parent, ctx && ctx.board);
  return p && p.local ? p.id : null;
}

// Roots are cards with no parent on this board, or whose parent is not among
// the cards given.
function nestTree(cards, ctx) {
  const byId = new Map();
  for (const c of cards) if (!byId.has(nestKey(c.id))) byId.set(nestKey(c.id), c);
  const kids = new Map();
  const roots = [];
  for (const c of byId.values()) {
    const pid = localParentId(c, ctx);
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
  return nestTree(cards, ctx).kids.get(nestKey(id)) || [];
}

// Parents above a card; a root is 0. A chain that loops stops at the card it
// would repeat.
function depthOf(cards, id, ctx) {
  const { byId } = nestTree(cards, ctx);
  const seen = new Set([nestKey(id)]);
  let depth = 0;
  let cur = byId.get(nestKey(id));
  while (cur) {
    const pid = localParentId(cur, ctx);
    if (pid === null || !byId.has(pid) || seen.has(pid)) break;
    seen.add(pid);
    depth++;
    cur = byId.get(pid);
  }
  return depth;
}

// Parents above every card at once: Map id -> depth, a root is 0, by the rule
// depthOf follows (only parents on this board count; a parent on another board
// or missing from `cards` ends the count; a chain that loops stops at the card
// it would repeat). Built once per board from one pass over its cards, so a
// slice never costs a tree per card. Pass active and archived cards together: an
// archived parent is still a parent, and a view that hides cards must not move
// the cards it still shows to another depth. Iterative, so a very deep chain
// cannot overflow the stack.
// `stopsAt`, when given, tests a parent: a card whose parent satisfies it counts as a root,
// its link up cut. The slices use it to count from the nearest tier card down.
function depthMap(cards, ctx, stopsAt) {
  const byId = new Map();
  for (const c of cards) if (!byId.has(nestKey(c.id))) byId.set(nestKey(c.id), c);
  const parentOf = new Map();
  for (const [key, c] of byId) {
    const pid = localParentId(c, ctx);
    const onBoard = pid !== null && byId.has(pid);
    const stops = onBoard && typeof stopsAt === 'function' && stopsAt(byId.get(pid));
    parentOf.set(key, onBoard && !stops ? pid : null);
  }
  const depths = new Map();
  for (const start of byId.keys()) {
    if (depths.has(start)) continue;
    const path = [];
    const at = new Map();
    let cur = start;
    while (cur !== null && !depths.has(cur) && !at.has(cur)) {
      at.set(cur, path.length);
      path.push(cur);
      cur = parentOf.get(cur);
    }
    let end = path.length;
    let next = -1;
    if (cur !== null && depths.has(cur)) {
      next = depths.get(cur);
    } else if (cur !== null) {
      end = at.get(cur);
      next = path.length - end - 1;
      for (let k = end; k < path.length; k++) depths.set(path[k], next);
    }
    for (let k = end - 1; k >= 0; k--) {
      next++;
      depths.set(path[k], next);
    }
  }
  return depths;
}

// The chain of parents above a card, root first, the card itself left out.
// Entries: { kind: 'card', id, card } for a parent found on this board;
// terminal markers, always first: { kind: 'unresolved', id } for a parent id
// with no card here, { kind: 'other-board', board, id, ref } for a parent on
// another board (named, not followed), { kind: 'loop', id, card } for the
// card the walk would visit twice. A root's thread is [].
function threadOf(cards, id, ctx) {
  const { byId } = nestTree(cards, ctx);
  const board = ctx && ctx.board;
  const seen = new Set([nestKey(id)]);
  const chain = [];
  let cur = byId.get(nestKey(id));
  while (cur) {
    const p = parseParent(cur.parent, board);
    if (!p) break;
    if (!p.local) {
      chain.push({ kind: 'other-board', board: p.board, id: p.id, ref: `${p.board}#${p.id}` });
      break;
    }
    if (seen.has(p.id)) {
      chain.push({ kind: 'loop', id: p.id, card: byId.get(p.id) });
      break;
    }
    const parent = byId.get(p.id);
    if (!parent) {
      chain.push({ kind: 'unresolved', id: p.id });
      break;
    }
    seen.add(p.id);
    chain.push({ kind: 'card', id: p.id, card: parent });
    cur = parent;
  }
  return chain.reverse();
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
      const key = nestKey(c.id);
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(key);
      const list = kids.get(key);
      if (list) for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
    }
  };
  for (const root of roots) walk(root);
  const rest = [...byId.values()].filter((c) => !seen.has(nestKey(c.id))).sort((a, b) => NEST_IDS.compareIds(a.id, b.id));
  for (const c of rest) {
    if (seen.has(nestKey(c.id))) continue;
    const path = [];
    const at = new Map();
    let cur = c;
    while (!at.has(nestKey(cur.id))) {
      at.set(nestKey(cur.id), path.length);
      path.push(cur);
      cur = byId.get(localParentId(cur, ctx));
    }
    const loop = path.slice(at.get(nestKey(cur.id)));
    walk(loop.reduce((low, x) => (NEST_IDS.compareIds(x.id, low.id) < 0 ? x : low)));
  }
  const index = new Map();
  ids.forEach((id, i) => index.set(id, i));
  return { ids, index };
}

// --- Reordering ----------------------------------------------------------
// A drop among siblings answers with the rank to write and, when no whole
// number fits, the siblings to renumber in tens. Siblings are every card with
// the same parent, archived ones too, wherever they sit on the board and
// whether or not a search hides them: a drop names the visible tiles around it,
// so those are resolved against this full list, and the card goes into the
// first spot between them with room for a whole number.
//
// Ranks written are whole numbers. A card dropped first goes ten below the
// lowest rank, which may be 0 or negative; last goes ten above the highest.
// Ranked cards sort before unranked ones, so a rank cannot place a card among
// unranked siblings: that drop ranks every child of the parent in tens.
// A drag never changes the parent, so a drop among another parent's children
// is refused. A tile outside the siblings' stretch of the outline (their
// parent, or a card after their last subtree) only marks that end of it.

// Siblings share the exact parent: cards under a parent on another board, or
// one missing from this board, are roots in the outline but not siblings of the
// plain roots, so a drop among those never writes them.
function parentKey(card, ctx) {
  const p = parseParent(card.parent, ctx && ctx.board);
  if (!p) return '';
  return p.local ? `#${p.id}` : `${p.board}#${p.id}`;
}

function reorderGroup(tree, card, ctx) {
  const pid = localParentId(card, ctx);
  if (pid !== null && tree.byId.has(pid)) return tree.kids.get(pid);
  const key = parentKey(card, ctx);
  return tree.roots.filter((c) => parentKey(c, ctx) === key);
}

// The sibling a tile stands for: itself, or the sibling above it whose
// children it is shown among. null when it hangs under no sibling.
function reorderSibling(tree, group, tile, ctx) {
  const seen = new Set();
  let cur = tile;
  while (cur && !seen.has(nestKey(cur.id))) {
    if (group.includes(cur)) return cur;
    seen.add(nestKey(cur.id));
    const pid = localParentId(cur, ctx);
    cur = pid === null ? null : tree.byId.get(pid);
  }
  return null;
}

// The whole-number rank for a card inserted at index `at` of the other
// siblings, or null when one rank cannot put it there.
function reorderSlot(rest, at) {
  const left = rest[at - 1];
  const right = rest[at];
  const l = left ? parseRank(left.rank) : null;
  const r = right ? parseRank(right.rank) : null;
  if (l !== null && r !== null) {
    const lo = Math.floor(l) + 1;
    const hi = Math.ceil(r) - 1;
    return lo <= hi ? Math.floor((lo + hi) / 2) : null;
  }
  if (l !== null) return Math.ceil(l) + 10;
  if (!left && r !== null) return Math.floor(r) - 10;
  return null;
}

// { rank, renumber: [{ id, rank }] } or { error }. `rank` is the dragged
// card's new rank, null when it needs no write; `renumber` the other siblings
// that need one. `drop` names the tiles above and below the drop point as
// { prev, next } card ids, null where there is none, in outline order.
function reorderPlan(cards, id, drop, ctx) {
  const tree = nestTree(cards, ctx);
  const dragged = tree.byId.get(nestKey(id));
  if (!dragged) return { error: `no card ${id}` };
  const group = reorderGroup(tree, dragged, ctx);
  const rest = group.filter((c) => c !== dragged);
  const cur = group.indexOf(dragged);
  const outline = outlineOrder(cards, ctx).index;
  const side = (tileId, isAbove) => {
    if (tileId === null || tileId === undefined) return {};
    if (nestKey(tileId) === nestKey(id)) return { error: 'a card cannot be its own neighbour' };
    const tile = tree.byId.get(nestKey(tileId));
    if (!tile) return { error: `no card ${tileId}` };
    const sibling = reorderSibling(tree, group, tile, ctx);
    if (sibling) return { sibling };
    const at = outline.get(nestKey(tileId));
    if (at > outline.get(nestKey(group[0].id)) && at < outline.get(nestKey(group[group.length - 1].id))) {
      // Between two siblings but under neither: a card of another parent shown among them.
      const near = isAbove ? group.filter((c) => outline.get(nestKey(c.id)) < at).pop() : group.find((c) => outline.get(nestKey(c.id)) > at);
      return { sibling: near };
    }
    const before = at < outline.get(nestKey(group[0].id));
    return before === isAbove ? {} : { error: `card ${tileId} is not among the siblings of card ${id}` };
  };
  const above = side(drop.prev, true);
  const below = side(drop.next, false);
  if (above.error || below.error) return { error: above.error || below.error };
  if (above.sibling === dragged && below.sibling === dragged) return { error: 'a card cannot be dropped among its own children' };
  // A tile among the dragged card's own children bounds the drop at the spot it already holds.
  const first = !above.sibling ? 0 : above.sibling === dragged ? cur : rest.indexOf(above.sibling) + 1;
  const last = !below.sibling ? rest.length : below.sibling === dragged ? cur : rest.indexOf(below.sibling);
  if (first > last) return { error: 'the drop is not between two siblings in outline order' };
  if (cur >= first && cur <= last) return { rank: null, renumber: [] };
  const fromTop = !!above.sibling;
  for (let k = 0; k <= last - first; k++) {
    const at = fromTop ? first + k : last - k;
    const rank = reorderSlot(rest, at);
    if (rank !== null) return { rank, renumber: [] };
  }
  return reorderRenumber(rest, fromTop ? first : last, dragged);
}

// Every sibling in the order the drop leaves them, at 10, 20, 30...; only
// the cards whose rank actually changes are listed.
function reorderRenumber(rest, at, dragged) {
  const finalOrder = rest.slice(0, at).concat(dragged, rest.slice(at));
  let rank = null;
  const renumber = [];
  finalOrder.forEach((c, i) => {
    const want = (i + 1) * 10;
    if (parseRank(c.rank) === want) return;
    if (c === dragged) rank = want;
    else renumber.push({ id: c.id, rank: want });
  });
  return { rank, renumber };
}

function reorderWrites(id, plan) {
  return (plan.rank === null ? [] : [{ id, rank: plan.rank }]).concat(plan.renumber);
}

// The tiles around a drop point. `ids` are the tiles shown top to bottom with
// the dragged one left out, `at` how many of them lie above the point. A
// descending column shows the outline backwards, so what lies above the point
// comes later in the outline.
function dropNeighbours(ids, at, direction) {
  const above = at > 0 ? ids[at - 1] : null;
  const below = at < ids.length ? ids[at] : null;
  return direction === 'desc' ? { prev: below, next: above } : { prev: above, next: below };
}

function dropSlot(mids, y) {
  let n = 0;
  while (n < mids.length && mids[n] < y) n++;
  return n;
}

function hasNesting(cards) {
  return cards.some((c) => parseRank(c.rank) !== null || parseParent(c.parent) !== null);
}

// What sits below a card, answered from one tree built once per render. Altitude
// counts every layer, archived or not (structure); the roll-up counts only the
// leaves, because a parent's own status says little about the work under it.
// A loop of parents never revisits a card. Rebuild the index when a card changes.
function rollupIndex(cards, ctx) {
  const { byId, kids } = nestTree(cards, ctx);
  const board = (ctx && ctx.board) || '';

  const below = (id) => {
    const seen = new Set([nestKey(id)]);
    const out = [];
    const stack = [nestKey(id)];
    while (stack.length) {
      const list = kids.get(stack.pop());
      if (!list) continue;
      const fresh = list.filter((c) => !seen.has(nestKey(c.id)));
      fresh.forEach((c) => seen.add(nestKey(c.id)));
      for (let i = fresh.length - 1; i >= 0; i--) stack.push(nestKey(fresh[i].id));
      out.push(...fresh);
    }
    return out;
  };

  // The longest chain of children below a card that repeats none. Iterative, so a very deep
  // chain cannot overflow the stack. A subtree with no loop of parents has one height whatever
  // path reached it, so that height is kept and every card of it is walked once, however many
  // cards ask (the Graph asks for each of its cards).
  const heights = new Map();
  const climb = (start) => {
    const path = new Set([start]);
    const stack = [{ id: start, list: kids.get(start) || [], at: 0, best: 0, loop: false }];
    for (;;) {
      const top = stack[stack.length - 1];
      if (top.at < top.list.length) {
        const c = top.list[top.at++];
        const key = nestKey(c.id);
        if (path.has(key)) { top.loop = true; continue; }
        if (heights.has(key)) { top.best = Math.max(top.best, 1 + heights.get(key)); continue; }
        path.add(key);
        stack.push({ id: key, list: kids.get(key) || [], at: 0, best: 0, loop: false });
        continue;
      }
      stack.pop();
      if (!top.loop) heights.set(top.id, top.best);
      if (!stack.length) return top.best;
      path.delete(top.id);
      const up = stack[stack.length - 1];
      up.best = Math.max(up.best, 1 + top.best);
      up.loop = up.loop || top.loop;
    }
  };

  const leavesBelow = (id) => below(id).filter((c) => !kids.has(nestKey(c.id)));

  return {
    altitudeOf: (id) => (byId.has(nestKey(id)) ? climb(nestKey(id)) : 0),
    leavesBelow,
    // counts is keyed by the raw status string (free text, case-sensitive), so it
    // has no prototype: a status called "constructor" is just a key.
    rollup(id, opts) {
      const countArchived = !opts || opts.countArchived !== false;
      const counts = Object.create(null);
      const leaves = [];
      for (const c of leavesBelow(id)) {
        if (c.archived && !countArchived) continue;
        const status = c.archived ? 'done' : String(c.status == null ? '' : c.status);
        counts[status] = (counts[status] || 0) + 1;
        leaves.push(c.id);
      }
      return { total: leaves.length, counts, leaves, scope: { board } };
    },
    // Leaves below that are not finished: only the literal status done, or archived.
    openLeafCount: (id) => leavesBelow(id).filter((c) => !c.archived && c.status !== 'done').length,
    parents: () => [...kids.keys()],
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseParent, parseRank, localParentId, siblingsCompare, childrenOf, depthOf, depthMap, threadOf, outlineOrder, hasNesting, rollupIndex, reorderPlan, reorderWrites, dropNeighbours, dropSlot };
} else {
  window.parseParent = parseParent;
  window.parseRank = parseRank;
  window.localParentId = localParentId;
  window.siblingsCompare = siblingsCompare;
  window.childrenOf = childrenOf;
  window.depthOf = depthOf;
  window.depthMap = depthMap;
  window.threadOf = threadOf;
  window.outlineOrder = outlineOrder;
  window.hasNesting = hasNesting;
  window.rollupIndex = rollupIndex;
  window.reorderPlan = reorderPlan;
  window.reorderWrites = reorderWrites;
  window.dropNeighbours = dropNeighbours;
  window.dropSlot = dropSlot;
}
