'use strict';
// The four sets Explore writes into the search box for one card, each by one relation alone (the tree: and
// path: terms walk both at once, over the edges the map is built from; dependency-graph.js), and the two
// links sets beside them. Pure, no DOM, the dual-environment pattern of search.js: loaded as a plain
// <script> in the browser and embedded in the built page, and required directly by node --test.
//
// - hpathIds: the card, its parents up to the root, and every card nested under it.
// - htreeIds: the whole parent tree from the card's root down.
// - dpathIds: everything it waits for and everything waiting on it, transitively.
// - dtreeIds: its connected set over waiting_for, either direction.
// - dlinksIds: the card and one hop over waiting_for both ways; hlinksIds: the card, its parent and its children.
//
// The hierarchy follows `parent` only: a parent on another board, a missing parent and a self-parent
// are no link. The dependency follows `waiting_for` only: a missing card and a self-wait are no link.
// Every card of the board counts, archived ones too; an unknown id is an empty Set, and a loop ends
// the walk. EXPLORE_KINDS is the one list of the four, which the search terms (`hpath:<id>` and the
// rest), the selection parts and the menu all read; LINK_KINDS is the list of the two links sets, which are
// search terms only (`dlinks:<id>`, `hlinks:<id>`), so the menu keeps its four.
const EXP_NEST = (typeof module !== 'undefined' && module.exports) ? require('./nesting') : window;
const EXP_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

const EXPLORE_KINDS = ['hpath', 'htree', 'dpath', 'dtree'];
const LINK_KINDS = ['dlinks', 'hlinks'];

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

// The sides a set can be cut to. The h sets cut by depth (above, below), the d sets by waiting_for
// (before, after); the & side is both, and no side is the same. A side of the other relation holds
// nothing, as an unknown id does.
const HIERARCHY_SIDES = ['above&below', 'above', 'below'];
const DEPENDENCY_SIDES = ['before&after', 'before', 'after'];
const SIDE_WORDS = HIERARCHY_SIDES.concat(DEPENDENCY_SIDES);
const SIDE_ENDS = { above: 'up', before: 'up', below: 'down', after: 'down' };

// -> 'both', 'up', 'down', or 'none' for a side the kind has no use for.
function exploreSideEnd(kind, side) {
  const word = side === undefined || side === null || side === '' ? '' : String(side).toLowerCase();
  if (word === '') return 'both';
  if (!(kind.startsWith('h') ? HIERARCHY_SIDES : DEPENDENCY_SIDES).includes(word)) return 'none';
  return word.includes('&') ? 'both' : SIDE_ENDS[word];
}

// The steps from a card up to its root, a parent loop ending the climb.
function exploreDepth(id, up) {
  const seen = new Set([id]);
  let at = id;
  while ((up.get(at) || []).length && !seen.has(up.get(at)[0])) { at = up.get(at)[0]; seen.add(at); }
  return seen.size - 1;
}

// `kind` is one of EXPLORE_KINDS or LINK_KINDS; the cards are the board as the search module is handed it.
// `side` cuts the set to one side of the card, and the card is in every cut. htree keeps the cards of its
// tree at the card's depth and on the side's depths; dtree keeps the cards that are neither before nor
// after the card, and the side asked for.
function exploreIds(kind, cards, rawId, ctx, side) {
  const id = exploreKey(rawId);
  if (!cards.some((c) => exploreKey(c.id) === id)) return new Set();
  const end = exploreSideEnd(kind, side);
  if (end === 'none') return new Set();
  const hierarchy = kind === 'hpath' || kind === 'htree' || kind === 'hlinks';
  const { up, down } = exploreLinks(cards, ctx, hierarchy);
  const toward = end === 'up' ? [up] : end === 'down' ? [down] : [up, down];
  if (LINK_KINDS.includes(kind)) return new Set([id, ...toward.flatMap((m) => m.get(id) || [])]);
  if (kind.endsWith('path')) return new Set(toward.flatMap((m) => [...exploreReach(id, m)]));
  if (!hierarchy) {
    const whole = exploreReach(id, up, down);
    if (end === 'both') return whole;
    const drop = exploreReach(id, end === 'up' ? down : up);
    return new Set([...whole].filter((c) => c === id || !drop.has(c)));
  }
  const tree = exploreReach(exploreRoot(id, up), down);
  if (end === 'both') return tree;
  const own = exploreDepth(id, up);
  return new Set([...tree].filter((c) => (end === 'up' ? exploreDepth(c, up) <= own : exploreDepth(c, up) >= own)));
}

const hpathIds = (cards, rawId, ctx, side) => exploreIds('hpath', cards, rawId, ctx, side);
const htreeIds = (cards, rawId, ctx, side) => exploreIds('htree', cards, rawId, ctx, side);
const dpathIds = (cards, rawId, ctx, side) => exploreIds('dpath', cards, rawId, ctx, side);
const dtreeIds = (cards, rawId, ctx, side) => exploreIds('dtree', cards, rawId, ctx, side);
const dlinksIds = (cards, rawId, ctx, side) => exploreIds('dlinks', cards, rawId, ctx, side);
const hlinksIds = (cards, rawId, ctx, side) => exploreIds('hlinks', cards, rawId, ctx, side);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EXPLORE_KINDS, LINK_KINDS, HIERARCHY_SIDES, DEPENDENCY_SIDES, SIDE_WORDS, hpathIds, htreeIds, dpathIds, dtreeIds, dlinksIds, hlinksIds };
} else {
  window.EXPLORE_KINDS = EXPLORE_KINDS;
  window.LINK_KINDS = LINK_KINDS;
  window.HIERARCHY_SIDES = HIERARCHY_SIDES;
  window.DEPENDENCY_SIDES = DEPENDENCY_SIDES;
  window.SIDE_WORDS = SIDE_WORDS;
  window.hpathIds = hpathIds;
  window.htreeIds = htreeIds;
  window.dpathIds = dpathIds;
  window.dtreeIds = dtreeIds;
  window.dlinksIds = dlinksIds;
  window.hlinksIds = hlinksIds;
}
