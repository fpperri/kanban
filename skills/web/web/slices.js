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

function sliceCards(cards, hierarchy, depths) {
  const tiers = sliceTiers(hierarchy);
  const byId = new Map();
  for (const c of cards) {
    const key = typeof c.type === 'string' ? c.type.trim().toLowerCase() : '';
    const tier = tiers.find((t) => t.key === key);
    if (tier) {
      byId.set(c.id, { kind: 'tier', name: tier.name, key: tier.key });
      continue;
    }
    const depth = depths.get(c.id);
    byId.set(c.id, { kind: 'depth', depth: Number.isInteger(depth) && depth > 0 ? depth : 0 });
  }
  return { byId };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sliceTiers, sliceCards };
} else {
  window.sliceTiers = sliceTiers;
  window.sliceCards = sliceCards;
}
