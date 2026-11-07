'use strict';
// "On hover show": which of the six sets (dtree, htree, dpath, hpath, dlinks, hlinks; explore-sets.js)
// a hover or a keyboard focus on a card lights, and which side of the card each relation is cut to. The
// choice is one record per board, kept in the browser and the same in every view, the Flow included:
// the six sets ticked, the Hierarchy toggle (above&below, above, below) that cuts the h sets, and the
// Dependencies toggle (before&after, before, after) that cuts the d sets. Pure, no DOM, the
// dual-environment pattern of explore-sets.js, which this reads the sets from: loaded as a plain
// <script> in the browser and required directly by node --test.
//
// The defaults are dlinks and hlinks with both sides on &: what the Hierarchy lit before the choice existed, a card with
// the cards one line away over parent and waiting_for. The card is in every set of it, so a union with any set ticked holds it;
// nothing ticked holds nothing, which dims nothing in the Graph.
const HS_SETS = (typeof module !== 'undefined' && module.exports) ? require('./explore-sets') : window;

const HOVER_SHOW_KINDS = ['dtree', 'htree', 'dpath', 'hpath', 'dlinks', 'hlinks'];
// How the six are laid out wherever they are shown, two columns by three rows read across: the h sets on the
// left, the d sets on the right, links, then path, then tree. Only the display: the stored list and the terms
// Space writes keep HOVER_SHOW_KINDS' order.
const HOVER_SHOW_GRID = ['hlinks', 'dlinks', 'hpath', 'dpath', 'htree', 'dtree'];
// The states each toggle steps through, the & state first: it is where the choice starts.
const HOVER_SHOW_SIDES = { hierarchy: HS_SETS.HIERARCHY_SIDES.slice(), dependencies: HS_SETS.DEPENDENCY_SIDES.slice() };
const HOVER_SHOW_DEFAULT_KINDS = ['dlinks', 'hlinks'];

function hoverShowDefaults() {
  return { kinds: HOVER_SHOW_DEFAULT_KINDS.slice(), hierarchy: HOVER_SHOW_SIDES.hierarchy[0], dependencies: HOVER_SHOW_SIDES.dependencies[0] };
}

// A list of sets as the panel keeps it: only the six, each once, in HOVER_SHOW_KINDS' order.
function hoverShowList(value) {
  return HOVER_SHOW_KINDS.filter((kind) => Array.isArray(value) && value.includes(kind));
}

// What a browser stored for a board (the text, or the value parsed from it). The record is the sets ticked
// ({ kinds }) and the two sides; a list that is there is kept, an empty one included, and a side that is not
// one of its toggle's three reads as the & side. The record from before the sides ({ hierarchy: [...],
// flow: [...] }, a list for each kind of Graph) reads as its Hierarchy list with both sides on &, and its
// Flow list is let go. Anything else reads as the defaults.
function mergeHoverShow(saved) {
  let own = saved;
  if (typeof own === 'string') {
    try { own = JSON.parse(own); } catch (e) { own = null; }
  }
  if (own === null || typeof own !== 'object' || Array.isArray(own)) own = {};
  const merged = hoverShowDefaults();
  if (Array.isArray(own.kinds)) merged.kinds = hoverShowList(own.kinds);
  else if (Array.isArray(own.hierarchy)) merged.kinds = hoverShowList(own.hierarchy);
  for (const toggle of Object.keys(HOVER_SHOW_SIDES)) {
    if (HOVER_SHOW_SIDES[toggle].includes(own[toggle])) merged[toggle] = own[toggle];
  }
  return merged;
}

// The choice with one set ticked or unticked; the argument is not touched.
function hoverShowWith(shown, kind, on) {
  const next = mergeHoverShow(shown);
  if (!HOVER_SHOW_KINDS.includes(kind)) return next;
  const kept = next.kinds.filter((k) => k !== kind);
  next.kinds = hoverShowList(on ? kept.concat(kind) : kept);
  return next;
}

// The choice with one toggle ('hierarchy' or 'dependencies') on its next state, the third one round to the first.
function hoverShowStep(shown, toggle) {
  const next = mergeHoverShow(shown);
  const states = HOVER_SHOW_SIDES[toggle];
  if (!states) return next;
  next[toggle] = states[(states.indexOf(next[toggle]) + 1) % states.length];
  return next;
}

// The two sides of a choice, as hoverShowIds and hoverShowTerms read them.
function hoverShowSides(shown) {
  const { hierarchy, dependencies } = mergeHoverShow(shown);
  return { hierarchy, dependencies };
}

// The side a set is cut to: the h sets take the Hierarchy's, the d sets the Dependencies'. `sides` is
// { hierarchy, dependencies }; a side left out is the & side, both.
function hoverShowSide(kind, sides) {
  const side = sides && sides[kind.startsWith('h') ? 'hierarchy' : 'dependencies'];
  return side === undefined || side === null || side === '' ? '' : String(side);
}

// The union of the ticked sets for the card, as the ids the sets give. `cards` is the whole board, archived
// cards included, and `ctx` is what the sets read the board's name from, as the search module is handed them.
function hoverShowIds(kinds, cards, id, ctx, sides) {
  const union = new Set();
  for (const kind of hoverShowList(kinds)) for (const found of HS_SETS[`${kind}Ids`](cards, id, ctx, hoverShowSide(kind, sides))) union.add(found);
  return union;
}

// The cards that take the hover look outside the Graph (the Graph lights its set by dimming the rest, and
// its hover ring stays on the hovered card): the hovered card, which always takes it, and the ticked sets.
// null when nothing is hovered.
function hoverShowTiles(kinds, cards, id, ctx, sides) {
  if (id === null || id === undefined) return null;
  const tiles = hoverShowIds(kinds, cards, id, ctx, sides);
  tiles.add(String(id));
  return tiles;
}

// The terms Space writes for a card: one per ticked set, as alternatives, in HOVER_SHOW_KINDS' order
// (`dlinks:12 | hlinks:12`), and empty when none is ticked. `key` is the card's id as the search
// writes it (`12`, or `kanban#12` on a board with prefixed ids). A set cut to one side says it
// (`htree:12:below`); the & side is no suffix, as it is no cut.
function hoverShowTerms(kinds, key, sides) {
  return hoverShowList(kinds).map((kind) => {
    const side = hoverShowSide(kind, sides);
    return side === '' || side.includes('&') ? `${kind}:${key}` : `${kind}:${key}:${side}`;
  }).join(' | ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOVER_SHOW_KINDS, HOVER_SHOW_GRID, HOVER_SHOW_SIDES, hoverShowDefaults, mergeHoverShow, hoverShowWith, hoverShowStep, hoverShowSides, hoverShowIds, hoverShowTiles, hoverShowTerms };
} else {
  window.HOVER_SHOW_KINDS = HOVER_SHOW_KINDS;
  window.HOVER_SHOW_GRID = HOVER_SHOW_GRID;
  window.HOVER_SHOW_SIDES = HOVER_SHOW_SIDES;
  window.hoverShowDefaults = hoverShowDefaults;
  window.mergeHoverShow = mergeHoverShow;
  window.hoverShowWith = hoverShowWith;
  window.hoverShowStep = hoverShowStep;
  window.hoverShowSides = hoverShowSides;
  window.hoverShowIds = hoverShowIds;
  window.hoverShowTiles = hoverShowTiles;
  window.hoverShowTerms = hoverShowTerms;
}
