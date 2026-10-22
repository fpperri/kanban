'use strict';
// Pure slicing: which slice each card is in, on one top-to-bottom axis. A slice
// is a tier of the board's hierarchy, or, for a card whose type is not in it, a
// depth. No DOM, no storage, and two other modules, the id and nesting modules:
// the snapshot embeds this file's source verbatim, ids.js and nesting.js ahead of
// it. Same dual-environment pattern as nesting.js.
//
// A card here is { id, type }. `hierarchy` is the names as the board wrote them,
// top first: compared without regard to case, the first of two duplicates wins,
// blank and non-text entries are skipped. `depths` is the board's slice depths
// (sliceDepths below), built once from every card of the board, so a view that
// shows only some cards never moves one to another slice.

const SLICES_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;
const SLICES_NEST = (typeof module !== 'undefined' && module.exports) ? require('./nesting') : window;

// A card's key in the depth map and in byId: its whole-id string. A value that is no id
// (the snapshot's queued cards are `n1`, `n2`) keys as its own text.
function sliceKey(id) {
  const key = SLICES_IDS.idKey(id);
  return key === null ? String(id) : key;
}

// The hierarchy's tiers top first: { name, key }, name as first written and key
// folded to lower case.
function sliceTiers(hierarchy) {
  const tiers = [];
  const seen = new Set();
  for (const entry of Array.isArray(hierarchy) ? hierarchy : []) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    tiers.push({ name, key });
  }
  return tiers;
}

// A card's slice depth, for every card of the board at once: Map id -> the number of
// parents without a tier between the card and its nearest parent with one, or its
// root when none has. A card right under a tier card is 0. Parents above a tier
// card do not count; a board with no hierarchy reads each card's plain depth
// (depthMap in nesting.js, whose rules for a missing parent, another board's parent
// and a loop hold). Built from every card of the board, live and archived, as depthMap is.
function sliceDepths(cards, hierarchy, ctx) {
  const tierKeys = new Set(sliceTiers(hierarchy).map((t) => t.key));
  const isTier = (c) => tierKeys.has(typeof c.type === 'string' ? c.type.trim().toLowerCase() : '');
  return SLICES_NEST.depthMap(cards, ctx, tierKeys.size ? isTier : undefined);
}

// { axis, byId } over the cards given.
//   axis: the slices in order, each { index, kind, count } with `name` and `key`
//     for a tier and `depth` for a depth: every tier of the hierarchy, used or
//     not, then depths 0 to the deepest card without a tier, a depth no card
//     has included. Each count is over the cards given, so the caller picks the
//     basis: the whole board, or what a view shows.
//   byId: Map card id (as sliceKey writes it) -> the axis entry the card is in. Every card given is in
//     exactly one, so the counts add up to the number of cards.
// A card whose type is in the hierarchy is in its tier, whatever its parent is.
// Any other card, with no type or a type outside the hierarchy, is in the slice
// of its depth; one missing from `depths` reads as a root.
function sliceCards(cards, hierarchy, depths) {
  const tiers = sliceTiers(hierarchy);
  const axis = tiers.map((t, index) => ({ index, kind: 'tier', name: t.name, key: t.key, count: 0 }));
  const tierAt = new Map(axis.map((s) => [s.key, s]));
  const placed = [];
  let deepest = -1;
  for (const c of cards) {
    const tier = tierAt.get(typeof c.type === 'string' ? c.type.trim().toLowerCase() : '');
    if (tier) {
      placed.push([c, tier]);
      continue;
    }
    const depth = depths.get(sliceKey(c.id));
    const at = Number.isInteger(depth) && depth > 0 ? depth : 0;
    placed.push([c, at]);
    if (at > deepest) deepest = at;
  }
  for (let depth = 0; depth <= deepest; depth++) axis.push({ index: axis.length, kind: 'depth', depth, count: 0 });
  const byId = new Map();
  for (const [c, where] of placed) {
    const slice = typeof where === 'number' ? axis[tiers.length + where] : where;
    slice.count++;
    byId.set(sliceKey(c.id), slice);
  }
  return { axis, byId };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sliceCards, sliceDepths };
} else {
  window.sliceCards = sliceCards;
  window.sliceDepths = sliceDepths;
}
