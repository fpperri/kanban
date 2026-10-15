'use strict';
// Pure slicing: which slice each card is in, on one top-to-bottom axis. A slice
// is a tier of the board's hierarchy, or, for a card whose type is not in it, a
// depth. No DOM, no storage, and no other module on purpose: the snapshot embeds
// this file's source verbatim, where nothing else is loaded. Same
// dual-environment pattern as nesting.js.
//
// A card here is { id, type }. `hierarchy` is the names as the board wrote them,
// top first: compared without regard to case, the first of two duplicates wins,
// blank and non-text entries are skipped. `depths` is the board's depth map
// (depthMap in nesting.js), built once from every card of the board, so a view
// that shows only some cards never moves one to another slice.

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

// { axis, byId } over the cards given.
//   axis: the slices in order, each { index, kind, count } with `name` and `key`
//     for a tier and `depth` for a depth: every tier of the hierarchy, used or
//     not, then depths 0 to the deepest card without a tier, a depth no card
//     has included. Each count is over the cards given, so the caller picks the
//     basis: the whole board, or what a view shows.
//   byId: Map card id -> the axis entry the card is in. Every card given is in
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
    const depth = depths.get(c.id);
    const at = Number.isInteger(depth) && depth > 0 ? depth : 0;
    placed.push([c, at]);
    if (at > deepest) deepest = at;
  }
  for (let depth = 0; depth <= deepest; depth++) axis.push({ index: axis.length, kind: 'depth', depth, count: 0 });
  const byId = new Map();
  for (const [c, where] of placed) {
    const slice = typeof where === 'number' ? axis[tiers.length + where] : where;
    slice.count++;
    byId.set(c.id, slice);
  }
  return { axis, byId };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sliceTiers, sliceCards };
} else {
  window.sliceTiers = sliceTiers;
  window.sliceCards = sliceCards;
}
