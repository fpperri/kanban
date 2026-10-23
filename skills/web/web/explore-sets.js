'use strict';
// The four sets Explore adds for one card, each by one relation alone (the tree: and path: terms
// walk both at once, over the edges the map is built from; dependency-graph.js). Pure, no DOM, the
// dual-environment pattern of search.js: loaded as a plain <script> in the browser and embedded in
// the snapshot, and required directly by node --test.
//
// - hpathIds: the card, its parents up to the root, and every card nested under it.
// - htreeIds: the whole parent tree from the card's root down.
// - dpathIds: everything it waits for and everything waiting on it, transitively.
// - dtreeIds: its connected set over waiting_for, either direction.
//
// The hierarchy follows `parent` only: a parent on another board, a missing parent and a self-parent
// are no link. The dependency follows `waiting_for` only: a missing card and a self-wait are no link.
// Every card of the board counts, archived ones too; an unknown id is an empty Set, and a loop ends
// the walk. EXPLORE_KINDS is the one list of the four, which the search terms (`hpath:<id>` and the
// rest), the selection parts and the menu all read.
const EXP_NEST = (typeof module !== 'undefined' && module.exports) ? require('./nesting') : window;
const EXP_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

const EXPLORE_KINDS = ['hpath', 'htree', 'dpath', 'dtree'];

function exploreKey(id) {
  const key = EXP_IDS.idKey(id);
  return key === null ? String(id) : key;
}

// -> { up, down }: for each card, the cards it follows from and the cards that follow from it.
function exploreLinks(cards, ctx, hierarchy) {
  const have = new Set(cards.map((c) => exploreKey(c.id)));
  const up = new Map();
  const down = new Map();
  const link = (from, to) => {
    if (from === to || !have.has(from) || !have.has(to)) return;
    if (!up.has(to)) up.set(to, []);
    up.get(to).push(from);
    if (!down.has(from)) down.set(from, []);
    down.get(from).push(to);
  };
  for (const c of cards) {
    const id = exploreKey(c.id);
    if (hierarchy) {
      const parent = EXP_NEST.localParentId(c, ctx);
      if (parent !== null) link(parent, id);
    } else {
      for (const w of c.waiting_for || []) link(exploreKey(w), id);
    }
  }
  return { up, down };
}

function exploreReach(start, ...steps) {
  const seen = new Set([start]);
  const todo = [start];
  while (todo.length) {
    const at = todo.pop();
    for (const step of steps) for (const next of step.get(at) || []) if (!seen.has(next)) { seen.add(next); todo.push(next); }
  }
  return seen;
}

// The root a hierarchy tree starts from: the climb ends at a card with no parent, or at the
// card where a parent loop closes.
function exploreRoot(id, up) {
  const seen = new Set([id]);
  let root = id;
  while ((up.get(root) || []).length && !seen.has(up.get(root)[0])) { root = up.get(root)[0]; seen.add(root); }
  return root;
}

// `kind` is one of EXPLORE_KINDS; the cards are the board as the search module is handed it.
function exploreIds(kind, cards, rawId, ctx) {
  const id = exploreKey(rawId);
  if (!cards.some((c) => exploreKey(c.id) === id)) return new Set();
  const hierarchy = kind === 'hpath' || kind === 'htree';
  const { up, down } = exploreLinks(cards, ctx, hierarchy);
  if (kind.endsWith('path')) return new Set([...exploreReach(id, up), ...exploreReach(id, down)]);
  return hierarchy ? exploreReach(exploreRoot(id, up), down) : exploreReach(id, up, down);
}

const hpathIds = (cards, rawId, ctx) => exploreIds('hpath', cards, rawId, ctx);
const htreeIds = (cards, rawId, ctx) => exploreIds('htree', cards, rawId, ctx);
const dpathIds = (cards, rawId, ctx) => exploreIds('dpath', cards, rawId, ctx);
const dtreeIds = (cards, rawId, ctx) => exploreIds('dtree', cards, rawId, ctx);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EXPLORE_KINDS, hpathIds, htreeIds, dpathIds, dtreeIds };
} else {
  window.EXPLORE_KINDS = EXPLORE_KINDS;
  window.hpathIds = hpathIds;
  window.htreeIds = htreeIds;
  window.dpathIds = dpathIds;
  window.dtreeIds = dtreeIds;
}
