'use strict';
// "On hover show": which of the six sets (dtree, htree, dpath, hpath, dlinks, hlinks; explore-sets.js)
// a hover or a keyboard focus on a card lights. The choice is one list of sets per graph kind, the
// Hierarchy's and the Flow's, kept per board in the browser; the Hierarchy's applies in every view that
// is not the Flow. Pure, no DOM, the dual-environment pattern of explore-sets.js, which this reads the
// sets from: loaded as a plain <script> in the browser and required directly by node --test.
//
// The defaults are what each view lit before the choice existed: the Hierarchy lit a card with the cards
// one line away over parent and waiting_for (hlinks and dlinks), the Flow draws no parent line and lit
// the waits alone (dlinks). The card is in every set of it, so a union with any set ticked holds it;
// nothing ticked holds nothing, which dims nothing in the Graph.
const HS_SETS = (typeof module !== 'undefined' && module.exports) ? require('./explore-sets') : window;

const HOVER_SHOW_KINDS = ['dtree', 'htree', 'dpath', 'hpath', 'dlinks', 'hlinks'];
const HOVER_SHOW_GRAPHS = ['hierarchy', 'flow'];
const HOVER_SHOW_DEFAULTS = { hierarchy: ['dlinks', 'hlinks'], flow: ['dlinks'] };

function hoverShowDefaults() {
  return { hierarchy: HOVER_SHOW_DEFAULTS.hierarchy.slice(), flow: HOVER_SHOW_DEFAULTS.flow.slice() };
}

// A list of sets as the panel keeps it: only the six, each once, in the panel's order.
function hoverShowList(value) {
  return HOVER_SHOW_KINDS.filter((kind) => Array.isArray(value) && value.includes(kind));
}

// What a browser stored for a board (the text, or the value parsed from it): a graph kind with a list keeps
// that list, an empty one included, and any other reads as its default.
function mergeHoverShow(saved) {
  let own = saved;
  if (typeof own === 'string') {
    try { own = JSON.parse(own); } catch (e) { own = null; }
  }
  if (own === null || typeof own !== 'object' || Array.isArray(own)) own = {};
  const merged = hoverShowDefaults();
  for (const graph of HOVER_SHOW_GRAPHS) {
    if (Object.prototype.hasOwnProperty.call(own, graph) && Array.isArray(own[graph])) merged[graph] = hoverShowList(own[graph]);
  }
  return merged;
}

// The choice with one set of one graph kind ticked or unticked; the argument is not touched.
function hoverShowWith(shown, graph, kind, on) {
  const next = mergeHoverShow(shown);
  if (!HOVER_SHOW_GRAPHS.includes(graph) || !HOVER_SHOW_KINDS.includes(kind)) return next;
  const kept = next[graph].filter((k) => k !== kind);
  next[graph] = hoverShowList(on ? kept.concat(kind) : kept);
  return next;
}

// The graph kind whose choice a hover reads: the Flow's in the Graph's Flow, the Hierarchy's everywhere else.
function hoverShowGraph(view, layout) {
  return view === 'graph' && layout === 'flow' ? 'flow' : 'hierarchy';
}

// The union of the ticked sets for the card, as the ids the sets give. `cards` is the whole board, archived
// cards included, and `ctx` is what the sets read the board's name from, as the search module is handed them.
function hoverShowIds(kinds, cards, id, ctx) {
  const union = new Set();
  for (const kind of hoverShowList(kinds)) for (const found of HS_SETS[`${kind}Ids`](cards, id, ctx)) union.add(found);
  return union;
}

// The cards that take the hover look outside the Graph (the Graph lights its set by dimming the rest, and
// its hover ring stays on the hovered card): the hovered card, which always takes it, and the ticked sets.
// null when nothing is hovered.
function hoverShowTiles(kinds, cards, id, ctx) {
  if (id === null || id === undefined) return null;
  const tiles = hoverShowIds(kinds, cards, id, ctx);
  tiles.add(String(id));
  return tiles;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOVER_SHOW_KINDS, HOVER_SHOW_GRAPHS, hoverShowDefaults, mergeHoverShow, hoverShowWith, hoverShowGraph, hoverShowIds, hoverShowTiles };
} else {
  window.HOVER_SHOW_KINDS = HOVER_SHOW_KINDS;
  window.HOVER_SHOW_GRAPHS = HOVER_SHOW_GRAPHS;
  window.hoverShowDefaults = hoverShowDefaults;
  window.mergeHoverShow = mergeHoverShow;
  window.hoverShowWith = hoverShowWith;
  window.hoverShowGraph = hoverShowGraph;
  window.hoverShowIds = hoverShowIds;
  window.hoverShowTiles = hoverShowTiles;
}
