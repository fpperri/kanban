'use strict';
// Pure model + layouts for the graph view: which cards are drawn, how they
// relate (parent / wait relations), and where each one sits under three
// layouts (tiers, status, force). No DOM, no canvas, no clock, no randomness:
// the same cards always give the same positions, so the 5-second poll re-render
// can reuse them. Same dual-environment pattern as gantt-model.js: unit-testable
// from node --test AND loaded as a plain <script> in the browser (app.js calls
// these as bare globals).
//
// Sibling modules are reached through namespace objects rather than top-level
// destructured consts: every web/*.js shares ONE browser global scope, so a
// second top-level binding of a name another script owns kills the later file.
const GRAPH_NEST = (typeof module !== 'undefined' && module.exports)
  ? require('./nesting')
  : window;
const GRAPH_WB = (typeof module !== 'undefined' && module.exports)
  ? require('./waiting-blocked')
  : window;
const GRAPH_COLS = (typeof module !== 'undefined' && module.exports)
  ? require('./column-state')
  : window;
const GRAPH_ICONS = (typeof module !== 'undefined' && module.exports)
  ? require('./type-icons')
  : window;
const GRAPH_SEARCH = (typeof module !== 'undefined' && module.exports)
  ? require('./search')
  : window;
const GRAPH_SLICES = (typeof module !== 'undefined' && module.exports)
  ? require('./slices')
  : window;
const GRAPH_MAPREL = (typeof module !== 'undefined' && module.exports)
  ? require('./map-relations')
  : window;
const GRAPH_TYPES = (typeof module !== 'undefined' && module.exports)
  ? require('./type-badge')
  : window;

const GRAPH_LAYOUTS = ['tiers', 'force', 'status'];

function mergeGraphLayout(saved) {
  return GRAPH_LAYOUTS.includes(saved) ? saved : 'tiers';
}

// The tier fan's option row: each option and what it may be set to, the default
// first. A new option is one more entry here, its label in graph-view.js.
//   lines         which parent lines the fan draws: folded (chain ends only, and a
//                 parent's other children on one ring share one counted line), chain
//                 (a line to every chain end, as the Map draws them), all (a line to
//                 every child) or off.
//   dependencies  the dashed arrows for waiting_for: on or off.
//   order         how siblings are ordered within a sector, the way the Map orders
//                 its rows: by status (doing, todo, backlog, ..., done, archived) or
//                 by rank, the outline's own order.
//   names         which cards carry their title: relevant (the selection
//                 and what it lights, then parents from the highest altitude down, up to
//                 a cap; every card on a small fan), all or none (graphFanNames).
//   unnested      where the cards with no parent, no children and no tier are drawn:
//                 outermost (one ring outside every depth ring, grouped by status, under
//                 an `unnested` caption), off (not drawn, and no relation to a drawn card
//                 is), depth 0 (on the depth 0 ring, in a sector of their own) or table
//                 (the Unnested block outside the rim, a column for each status).
const GRAPH_FAN_OPTION_VALUES = Object.freeze({
  lines: Object.freeze(['folded', 'chain', 'all', 'off']),
  dependencies: Object.freeze(['on', 'off']),
  order: Object.freeze(['status', 'rank']),
  names: Object.freeze(['relevant', 'all', 'none']),
  unnested: Object.freeze(['outermost', 'off', 'depth 0', 'table']),
});

const GRAPH_FAN_OPTION_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.entries(GRAPH_FAN_OPTION_VALUES).map(([key, values]) => [key, values[0]]),
));

// What a browser stored for a board, from an older or hand-edited store: keep what
// this version still offers, read the rest as its default.
function mergeGraphFanOptions(saved) {
  const own = saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const merged = {};
  for (const key of Object.keys(GRAPH_FAN_OPTION_VALUES)) {
    const value = Object.prototype.hasOwnProperty.call(own, key) ? own[key] : undefined;
    merged[key] = GRAPH_FAN_OPTION_VALUES[key].includes(value) ? value : GRAPH_FAN_OPTION_DEFAULTS[key];
  }
  return merged;
}

// --- model ---------------------------------------------------------------------
// Which cards have a parent or children on the board, and the rows of siblings, read
// on the whole pool.
function graphNesting(whole, pool, ctx) {
  const nested = new Set();
  const siblings = [];
  const parentIn = new Map();
  for (const c of whole) {
    const pid = GRAPH_NEST.localParentId(c, ctx);
    if (pid !== null && pid !== c.id && pool.has(pid)) {
      nested.add(c.id);
      nested.add(pid);
      parentIn.set(c.id, pid);
      siblings.push({ id: c.id, parent: pid, waitsOn: (c.waiting_for || []).map(Number) });
    }
  }
  return { nested, siblings, parentIn };
}

// The cards with no parent, no children and no tier: their slice is a depth, and a card
// with no relative is at depth 0.
function graphUnnestedOf(whole, nested, slices) {
  return new Set(whole.filter((c) => !nested.has(c.id) && slices.byId.get(c.id).kind === 'depth').map((c) => c.id));
}

// The board `cards` as every reading of it starts from it (live and archived, whatever
// any view draws): the cards by id, their list, the slice of each and the nesting.
function graphBoardOf(cards, opts) {
  const ctx = (opts && opts.ctx) || null;
  const hierarchy = (opts && opts.hierarchy) || (ctx && ctx.hierarchy) || [];
  const pool = new Map();
  for (const c of cards || []) if (!pool.has(c.id)) pool.set(c.id, c);
  const whole = [...pool.values()];
  const slices = GRAPH_SLICES.sliceCards(whole, hierarchy, GRAPH_NEST.depthMap(whole, ctx));
  return { ctx, pool, whole, slices, nesting: graphNesting(whole, pool, ctx) };
}

// The ids of those cards on the board `cards`: the cards the tier fan's Unnested option
// takes out when it is off.
function graphUnnestedIds(cards, opts) {
  const board = graphBoardOf(cards, opts);
  return graphUnnestedOf(board.whole, board.nesting.nested, board.slices);
}

// cards is the whole pool (active + archived). visibleIds narrows what is
// DRAWN; waits still resolve against the full pool so a card waiting on a
// hidden card still reads waiting. A parent link exists only when the parent is
// a drawn card on this board; otherwise the card is a root of the drawn trees.
// Nodes come back in outline order (parents before children, siblings by
// rank): that is the view's DOM order and defines shift-click range selection.
// opts.types is the board's `types:` list; a node whose type has an icon there
// carries that icon's name as its shape, every other node is a circle.
// opts.hierarchy is the board's hierarchy (type names, top first; ctx.hierarchy
// when not given). Which slice a card is in, and whether it is nested at all, is
// read from the whole pool, never from the drawn cards: a card whose parent is
// hidden or archived keeps its depth and so its slice. Each node carries its
// slice's index on the board's axis (`sliceIndex`) and `nested` (it has a parent
// or children somewhere on the board); the model carries the axis. Each node also
// carries `chainEnd` (the Map's reading of whether it is the end of its chain of
// siblings) and `chained` (a dependency joins it to a sibling), both read from the
// whole pool, for the tier fan's lines (graphFanLines).
// opts.unnested is the tier fan's Unnested option: with 'off' the cards that are
// unnested (no parent, no children) and have no tier are not drawn, and neither is
// any relation that joined one to a drawn card. Any other value draws them.
function graphBuild(cards, opts) {
  const visibleIds = (opts && opts.visibleIds) || null;
  const types = (opts && opts.types) || null;
  const { ctx, pool, whole, slices, nesting } = graphBoardOf(cards, opts);
  const { nested, siblings, parentIn } = nesting;
  const leftOut = opts && opts.unnested === 'off' ? graphUnnestedOf(whole, nested, slices) : null;
  const drawn = new Map();
  for (const c of pool.values()) if ((!visibleIds || visibleIds.has(c.id)) && !(leftOut && leftOut.has(c.id))) drawn.set(c.id, c);
  // The sibling chains, read on the whole board like the slices: hiding a card with a
  // status pill or a search never moves a parent line. `chainEnd` is the Map's own reading of
  // where a child's chain meets its parent (mapParentLineEnds, the children no sibling
  // waits for); `chained` is a child that has a dependency to or from a sibling, a second
  // read because `ends` marks a child alone and every member of a looping chain the same way.
  const ends = GRAPH_MAPREL.mapParentLineEnds(siblings);
  const chained = new Set();
  for (const s of siblings) {
    for (const dep of s.waitsOn) {
      if (dep !== s.id && parentIn.get(dep) === s.parent) { chained.add(s.id); chained.add(dep); }
    }
  }

  const parentOf = new Map();
  for (const c of drawn.values()) {
    const pid = GRAPH_NEST.localParentId(c, ctx);
    if (pid !== null && drawn.has(pid)) parentOf.set(c.id, pid);
  }

  // Each card has at most one parent, so a loop is a cycle of a functional
  // graph: the member with the smallest id becomes the root.
  const state = new Map();
  for (const id of [...drawn.keys()].sort((a, b) => a - b)) {
    if (state.has(id)) continue;
    const path = [];
    let cur = id;
    while (cur !== undefined && !state.has(cur)) {
      state.set(cur, 1);
      path.push(cur);
      cur = parentOf.get(cur);
    }
    if (cur !== undefined && state.get(cur) === 1) {
      const loop = path.slice(path.indexOf(cur));
      parentOf.delete(Math.min(...loop));
    }
    for (const p of path) state.set(p, 2);
  }

  const shaped = [...drawn.values()].map((c) => ({
    ...c, parent: parentOf.has(c.id) ? parentOf.get(c.id) : null,
  }));
  const order = GRAPH_NEST.outlineOrder(shaped, ctx).ids;

  const links = [];
  const seen = new Set();
  const addLink = (from, to, kind) => {
    const key = `${from}>${to}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ from, to, kind });
  };
  const nodes = [];
  const byId = new Map();
  for (const id of order) {
    const card = drawn.get(id);
    const parentId = parentOf.has(id) ? parentOf.get(id) : null;
    const parent = parentId === null ? null : byId.get(parentId);
    const waits = (card.waiting_for || []).map(Number);
    const node = {
      id,
      card,
      status: card.status,
      shape: GRAPH_ICONS.typeIconOf(card.type, types) || 'circle',
      archived: !!card.archived,
      blocked: GRAPH_WB.isBlockedValue(card.blocked),
      review: GRAPH_WB.isReviewValue(card.review),
      waiting: GRAPH_WB.unresolvedWaits(card.waiting_for, pool).length > 0,
      deg: 0,
      kids: 0,
      depth: parent ? parent.depth + 1 : 0,
      rootId: parent ? parent.rootId : id,
      parentId,
      sliceIndex: slices.byId.get(id).index,
      nested: nested.has(id),
      chainEnd: ends.has(id) ? ends.get(id).below : true,
      chained: chained.has(id),
    };
    nodes.push(node);
    byId.set(id, node);
    if (parentId !== null) addLink(parentId, id, 'parent');
    // Heads draw at a link's end: a wait runs from the card waited for to the card that waits.
    for (const w of waits) if (w !== id && drawn.has(w)) addLink(w, id, 'wait');
  }
  for (const l of links) {
    byId.get(l.from).deg++;
    byId.get(l.to).deg++;
    if (l.kind === 'parent') byId.get(l.from).kids++;
  }
  const index = GRAPH_NEST.rollupIndex(whole, ctx);
  const altitude = new Map(nodes.map((n) => [n.id, index.altitudeOf(n.id)]));
  return { nodes, links, byId, axis: slices.axis, altitude };
}

function graphRadius(node) {
  return 4 + Math.sqrt(node.deg + (node.kids ? 2 : 0)) * 3;
}

function graphNeighbours(model, id) {
  const out = new Set([id]);
  for (const l of model.links) {
    if (l.from === id) out.add(l.to);
    if (l.to === id) out.add(l.from);
  }
  return out;
}

// --- lighting ------------------------------------------------------------------
// The Graph dims everything but what is lit. One lighting drives the dimming whoever
// asks: the pointer on a card, a lone card picked by a click, a selection, a typed
// query's matches. A lighting is { nodes: Set of card ids, links: Set of indexes
// into the lines drawn } or null when there is nothing to light, which dims nothing.
// The lines drawn are the plan's links; with no list they are model.links.

// The cards among `ids` that the Graph draws, and the lines that run between two of
// them. `lines` is the list of lines the view draws (the plan's links, each with a
// `from` and a `to`), and the indexes name the lines in it; with no list the relations
// of the model stand for the lines. A counted line has the parent at both ends, so it
// is lit whenever its parent is.
function graphLit(model, ids, lines) {
  const nodes = new Set();
  for (const id of ids || []) if (model.byId.has(id)) nodes.add(id);
  if (!nodes.size) return null;
  const links = new Set();
  (lines || model.links).forEach((l, i) => {
    if (nodes.has(l.from) && nodes.has(l.to)) links.add(i);
  });
  return { nodes, links };
}

// What a query typed in the Graph does, as one decision: which cards it hides
// and which it lights. `match` is the page's shared match result for the box
// ({ terms, ids }, ids null when there is no query). A typed query is the anchor
// of the selection, so it lights exactly its matches, done cards included, and
// hides nothing: visibleIds is null, the way graphVisibleIds reads "draw
// everything". The one exception is a slice: term that stands on its own in the
// query, as it does in every other view: it hides the cards outside its cut, and
// the rest of the query lights inside the cut (litIds is null when nothing else
// is left to light). A slice: term under | or in a bracket of alternatives is
// only a term to match, so it lights and hides nothing; a bracket that holds one
// alternative is spliced into the query by the parser, so it counts as on its own.
// The cut is the search module's, over the whole board (`pool`, live and
// archived) and the board's hierarchy (in `ctx`), so a card sits in the same slice
// whatever the view draws. Isolate, which shows only the selection, changes this
// decision and nothing else: `opts.isolated` makes the whole query a cut, as it is in
// every other view. The box then holds the isolate text, so the cards it matches (the
// slice: term's cut among them) are the ones drawn and the ones lit, and a query that
// matches nothing draws nothing. With no query there is nothing to isolate, so nothing
// is hidden.
function graphQueryEffect(match, pool, ctx, { isolated = false } = {}) {
  const ids = match && match.ids ? match.ids : null;
  const terms = (match && match.terms) || [];
  if (isolated && ids) return { visibleIds: ids, litIds: ids };
  const slices = terms.filter((t) => t && t.field === 'slice');
  if (!ids || !slices.length) return { visibleIds: null, litIds: ids };
  if (!pool) throw new Error('graphQueryEffect: a slice: term needs the board to cut');
  const cut = new Set(GRAPH_SEARCH.filterCards(pool, slices, ctx).map((c) => c.id));
  return { visibleIds: cut, litIds: slices.length < terms.length ? ids : null };
}

// What the Graph lights when the pointer is not on a card. A lone card picked by
// a click lights with its one-hop relations, as hovering it does; any other
// selection, a typed query's matches included, lights its own cards and the lines
// between them, so a query that matches one card lights that card alone.
// `loneCardId` is the selection's one card part, or null.
function graphRestLit(model, { selectedIds, loneCardId }, lines) {
  if (loneCardId !== null && loneCardId !== undefined && model.byId.has(loneCardId)) return graphLit(model, graphNeighbours(model, loneCardId), lines);
  return graphLit(model, selectedIds, lines);
}

// --- the tier fan's names --------------------------------------------------------
// Which cards carry their title. A pure function of the model, so the
// page and the tests ask the same question. Relevant names what is lit when the pointer
// is on no card (graphRestLit): the selection, a typed query's or a pill's matches among
// it, and a lone card's one-hop relations, always, however many. It then names parents
// while the named set is under the cap, the highest altitude first (the glossary's: the
// layers of cards below a card on the board, blind to type), ties by id. A fan of the small size
// or fewer cards names every card. All names every card and none names none. Names are
// plain labels; where one sits is graph-names.js's business, and the layout never reads
// the setting (it is in neither the signature nor the cache key). At most 24 names, except
// for the selection's and its lit cards; a fan of 24 cards or fewer names every card.
const GRAPH_FAN_NAMES_CAP = 24;
const GRAPH_FAN_NAMES_SMALL = 24;
const GRAPH_FAN_NAME_CHARS = 38;

// A card's altitude is the layers of cards below it on the board, whatever the Graph draws
// (the glossary's, and the badge on a tile): the model carries it from graphBuild, which reads
// every card of the board. A model built by hand with no such map falls back to the cards
// drawn: nodes come parents before children, so one pass from the last node to the first has
// every child's altitude before its parent's.
function graphFanAltitudes(model) {
  if (model.altitude) return model.altitude;
  const altitude = new Map(model.nodes.map((n) => [n.id, 0]));
  for (let i = model.nodes.length - 1; i >= 0; i--) {
    const n = model.nodes[i];
    if (n.parentId !== null && altitude.has(n.parentId)) altitude.set(n.parentId, Math.max(altitude.get(n.parentId), altitude.get(n.id) + 1));
  }
  return altitude;
}

function graphFanNames(model, names, { selectedIds, loneCardId } = {}) {
  const mode = GRAPH_FAN_OPTION_VALUES.names.includes(names) ? names : GRAPH_FAN_OPTION_DEFAULTS.names;
  if (mode === 'none') return new Set();
  if (mode === 'all' || model.nodes.length <= GRAPH_FAN_NAMES_SMALL) return new Set(model.nodes.map((n) => n.id));
  const lit = graphRestLit(model, { selectedIds, loneCardId });
  const named = new Set(lit ? lit.nodes : []);
  const altitude = graphFanAltitudes(model);
  const parents = model.nodes.filter((n) => altitude.get(n.id) > 0)
    .sort((a, b) => altitude.get(b.id) - altitude.get(a.id) || a.id - b.id);
  for (const n of parents) {
    if (named.size >= GRAPH_FAN_NAMES_CAP) break;
    named.add(n.id);
  }
  return named;
}

// The value the n key sets next: relevant, all, none, and round to relevant. A value the
// row does not offer steps from the default.
function graphFanNextNames(current) {
  const values = GRAPH_FAN_OPTION_VALUES.names;
  const from = values.includes(current) ? current : GRAPH_FAN_OPTION_DEFAULTS.names;
  return values[(values.indexOf(from) + 1) % values.length];
}

// The text a name shows: the card's title on one line, cut with an ellipsis past the room a
// name has, or the card's number when it has no title. Text only: the page sets it as text.
function graphFanNameText(title, id) {
  const text = String(title === null || title === undefined ? '' : title).replace(/\s+/g, ' ').trim();
  if (!text) return `#${id}`;
  const chars = Array.from(text);
  return chars.length > GRAPH_FAN_NAME_CHARS ? `${chars.slice(0, GRAPH_FAN_NAME_CHARS - 1).join('').trimEnd()}…` : text;
}

// --- layout plumbing -----------------------------------------------------------

function graphFinish(model, pos, rings, spokes, titles, extra) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (ax, ay, bx, by) => {
    x0 = Math.min(x0, ax); y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx); y1 = Math.max(y1, by);
  };
  for (const n of model.nodes) {
    const p = pos.get(n.id);
    const r = graphRadius(n);
    grow(p.x - r, p.y - r, p.x + r, p.y + r);
  }
  const fan = extra && extra.fan;
  for (const r of rings) {
    if (fan) grow(-r.r, -r.r, r.r, r.r);
    else grow(r.cx - r.r, -r.r, r.cx + r.r, r.r);
  }
  for (const t of titles) grow(t.x, t.y - 16, t.x + 80, t.y + 4);
  const { boxes, ...kept } = extra || {};
  for (const b of boxes || []) grow(b.x0, b.y0, b.x1, b.y1);
  const block = kept.block;
  if (block) grow(block.x, block.y, block.x + block.w, block.y + block.h);
  const bounds = Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
  return { pos, rings, spokes, titles, bounds, ...kept };
}

// --- layout: the tier fan ------------------------------------------------------
// graphFanPlace is the one place a card's band, sector and block are decided:
// pure, from the model alone, in one pass over the nodes in outline order
// (parents before children), so a chain of any depth costs no stack. What it
// answers for each drawn card, as { band, sub, sector, block }:
//   band    the card's slice on the board's axis, read from the whole board, so a
//           hidden or archived parent never moves a card. A card nested against
//           the hierarchy (a tier 1 card under the lowest tier) is in its own
//           tier's band.
//   sub     the ring inside a tier's band: how many cards above it on its thread
//           are in the same slice, so a card never shares a ring with its parent.
//   sector  the tree it belongs to, an index into `sectors`: a root and the cards
//           nested under it, in outline order, then one sector for the unnested cards
//           that have a tier, then (under the Unnested option's depth 0) one for the
//           unnested cards with no tier. null for a card in the block.
//   block   the status column of the unnested card with no tier, which the Unnested
//           block draws as a column and the outermost ring as a stretch of the ring.
//           null under depth 0, where the card is on the depth 0 ring.
// A card is unnested when it has no parent and no children on the whole board,
// drawn or not, so hiding its relatives never moves it. The sector of kind 'loose'
// holds the unnested cards that have a tier, the one of kind 'unnested' those with no
// tier that depth 0 puts on the ring. `bands` lists
// the bands that are drawn: every tier, empty ones too, then only the depths
// that hold a card without a tier that is not in the block (a depth with none
// has no ring). `columns` are the block's columns in the board's status order,
// archived cards last. The Unnested option (opts.unnested, GRAPH_FAN_OPTION_VALUES)
// decides one thing here: with depth 0 the unnested cards with no tier are ordinary
// depth 0 cards, on the depth 0 ring, in a sector of their own, and there are no
// columns; every other value gives them a block place.
function graphFanPlace(model, opts) {
  const { nodes, axis } = model;
  const tierCount = axis.filter((s) => s.kind === 'tier').length;
  const statuses = GRAPH_COLS.liveStatuses(opts && opts.statuses);
  const onRing = mergeGraphFanOptions(opts).unnested === 'depth 0';
  const places = new Map();
  const sectors = [];
  const sectorOfRoot = new Map();
  const unnestedTiered = [];
  const unnestedOnRing = [];
  const rows = axis.map(() => ({ count: 0, maxSub: 0 }));
  const live = new Map(statuses.map((s) => [s, []]));
  const archived = [];
  const above = new Array(axis.length).fill(0);
  const stack = [];
  for (const n of nodes) {
    while (stack.length && (n.parentId === null || stack[stack.length - 1].id !== n.parentId)) above[stack.pop().sliceIndex]--;
    const place = { band: n.sliceIndex, sub: above[n.sliceIndex], sector: null, block: null };
    places.set(n.id, place);
    stack.push(n);
    above[n.sliceIndex]++;
    const unnestedNoTier = !n.nested && n.sliceIndex >= tierCount;
    if (unnestedNoTier && !onRing) {
      place.sub = 0;
      if (n.archived) { place.block = 'archived'; archived.push(n.id); }
      else {
        place.block = GRAPH_COLS.columnForStatus(n.status, statuses);
        live.get(place.block).push(n.id);
      }
      continue;
    }
    if (unnestedNoTier) unnestedOnRing.push(n.id);
    else if (!n.nested) unnestedTiered.push(n.id);
    else {
      if (n.parentId === null) {
        sectorOfRoot.set(n.id, sectors.length);
        sectors.push({ kind: 'tree', rootId: n.id, tops: [n.id], leaves: 0 });
      }
      place.sector = sectorOfRoot.get(n.rootId);
    }
    const row = rows[n.sliceIndex];
    row.count++;
    row.maxSub = Math.max(row.maxSub, place.sub);
  }
  if (unnestedTiered.length) {
    for (const id of unnestedTiered) places.get(id).sector = sectors.length;
    sectors.push({ kind: 'loose', rootId: null, tops: unnestedTiered, leaves: unnestedTiered.length });
  }
  if (unnestedOnRing.length) {
    for (const id of unnestedOnRing) places.get(id).sector = sectors.length;
    sectors.push({ kind: 'unnested', rootId: null, tops: unnestedOnRing, leaves: unnestedOnRing.length });
  }
  const leaves = new Map();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const own = leaves.get(nodes[i].id) || 1;
    leaves.set(nodes[i].id, own);
    if (nodes[i].parentId !== null) leaves.set(nodes[i].parentId, (leaves.get(nodes[i].parentId) || 0) + own);
  }
  for (const s of sectors) if (s.kind === 'tree') s.leaves = leaves.get(s.rootId);

  const bands = [];
  axis.forEach((slice, index) => {
    if (slice.kind === 'depth' && !rows[index].count) return;
    bands.push({ slice, index, count: rows[index].count, subs: rows[index].count ? rows[index].maxSub + 1 : 0 });
  });
  const columns = statuses.filter((s) => live.get(s).length).map((s) => ({ label: s, ids: live.get(s) }));
  if (archived.length) columns.push({ label: 'archived', ids: archived });
  return { places, bands, sectors, columns };
}

// --- the tier fan's lines ------------------------------------------------------
// Which lines the fan draws under its options (GRAPH_FAN_OPTION_VALUES), decided
// from the model and the places of graphFanPlace alone, so a line option never moves
// a card to another band. The model keeps every relation; this list is what is drawn,
// in the order of model.links, and the view, the lighting and the tests all read it.
// A line is { from, to, kind, link } for one relation (`link` indexes model.links), or,
// for the counted line of the folded mode, { from: parent, to: parent, kind: 'parent',
// link: null, kids, count }: one line for the children `kids` of one parent that sit on
// one ring, both its ends the parent, so it lights whenever its parent does.
//   all      a line to every child.
//   chain    a line to every chain end (node.chainEnd, the Map's reading): the child no
//            sibling waits for, and every child with no dependency to a sibling. A child
//            in the middle or at the start of a chain has none.
//   folded   the chain ends as chain draws them, but a chain end that is alone (a chain
//            of one: no dependency to or from a sibling) shares one counted line with
//            the parent's other such children on its ring; one that is alone on its ring
//            keeps its own line, and so does an end in a real chain.
//   off      no parent line.
// Dependencies on draws a line for each wait, from the card waited for to the card that
// waits; off draws none.
function graphFanLines(model, places, fan) {
  const o = mergeGraphFanOptions(fan);
  const lines = [];
  const groups = new Map();
  model.links.forEach((l, link) => {
    if (l.kind === 'wait') {
      if (o.dependencies === 'on') lines.push({ from: l.from, to: l.to, kind: 'wait', link });
      return;
    }
    if (o.lines === 'off') return;
    const child = model.byId.get(l.to);
    if (o.lines !== 'all' && !child.chainEnd) return;
    if (o.lines === 'folded' && !child.chained) {
      const place = places.get(l.to);
      const key = `${l.from}|${place.band}:${place.sub}`;
      if (groups.has(key)) { groups.get(key).kids.push(l.to); return; }
      const line = { from: l.from, to: l.to, kind: 'parent', link };
      groups.set(key, { line, kids: [l.to] });
      lines.push(line);
      return;
    }
    lines.push({ from: l.from, to: l.to, kind: 'parent', link });
  });
  for (const g of groups.values()) {
    if (g.kids.length > 1) Object.assign(g.line, { to: g.line.from, link: null, kids: g.kids, count: g.kids.length });
  }
  return lines;
}

// --- layout: tiers -------------------------------------------------------------
// The tier fan. The apex is the origin and the fan goes all the way round it but for
// a narrow seam straight up (the screen's y runs down, so up is -y), from
// GRAPH_FAN_FROM, just left of the seam, turning counter-clockwise (its angle falling)
// through the left, the bottom and the right to GRAPH_FAN_TO, just right of it. That
// is more than a half turn, so an angle read back from a position (atan2) has to be
// brought into the range from GRAPH_FAN_TO up to GRAPH_FAN_FROM before it is compared
// with a sector's. The captions of the bands stand on the seam, where no card is.
// Bands run from the apex out in the order of the board's axis (graphFanPlace): a
// band for each tier, tier 1 innermost, then a ring for each depth that holds a card
// without a tier.
// A band is a stretch of radius; the dots of a band sit on its rings (a tier
// whose cards nest in one another has a ring for each level). Each tree takes a
// sector of the fan, its share the sum of what its cards need, and a card sits at
// the middle of the stretch its own subtree is given, so a parent is between its
// children. What a card needs is the angle that spaces its mark from its
// neighbours' on its ring; when the sectors would need more angle than the fan
// has, every radius grows to give it, so no two dots on a ring ever touch.
// Loose cards with no tier are drawn as the Unnested option says: on one ring outside every
// band (outermost, the default: graphFanRing), on the depth 0 ring in a sector of their own
// (depth 0: graphFanPlace), in the Unnested block outside the rim (table), or not at all (off,
// where graphBuild leaves them out of the model).
//
// The layout answers more than positions, for whatever draws bands, captions and
// the block's frame: `bands` ({ index, slice, count, subs, r0, r1, rings }),
// `sectors` ({ kind, rootId, tops, leaves, from, to } in radians, `from` the larger),
// `block` ({ x, y, w, h, top, base, count, columns: [{ label, ids, count, x, w }] },
// columns relative to the block; null under outermost, which has a ring instead, as a band with
// no `slice`, last in `bands`), `captions` (the caption of each band, with its
// side of the seam, and what its tip says: the `count`, the `split` by status and the
// slice: `term`), `looseCaption` (the caption of the loose cards with a tier, its
// `split` and the `box` it takes), `fan` ({ from, to }) and `textScale` (the scale the
// captions are spaced for, see graphFanScale). `rings` are the circles drawn through the rows
// of dots, and `spokes` the dividers between sectors. The bounds Fit frames hold the
// dots, the whole circle the rings make, the captions on the seam, the loose caption
// and the block. graphPlan turns all of it into marks:
// guide arcs, captions, dividers and the block's frame, title and column captions. A
// caption shows a name and nothing else; its count, the split of the cards by status and
// the slice: term to type for the band stand in its tip (graphFanTip), which the view
// shows on hover or focus.
// Every pass below walks the nodes in outline order, forwards or back, never recursing.

const GRAPH_FAN_SEAM = 8 * Math.PI / 180;
const GRAPH_FAN_FROM = Math.PI * 1.5 - GRAPH_FAN_SEAM;
const GRAPH_FAN_TO = -Math.PI / 2 + GRAPH_FAN_SEAM;
const GRAPH_FAN_GAP = 5 * Math.PI / 180;
const GRAPH_FAN_R0 = 60;
const GRAPH_FAN_PITCH = 56;
const GRAPH_FAN_EMPTY = 20;
const GRAPH_FAN_MARK_GAP = 8;
const GRAPH_FAN_CLEAR = 30;
const GRAPH_FAN_BLOCK_PITCH = 22;
const GRAPH_FAN_BLOCK_ROWS = 10;
const GRAPH_FAN_BLOCK_TOP = 36;
const GRAPH_FAN_BLOCK_HEAD = 42;
const GRAPH_FAN_BLOCK_BASE = 8;
const GRAPH_FAN_BLOCK_PAD = 12;
const GRAPH_FAN_BLOCK_COLUMN = 56;
const GRAPH_FAN_BLOCK_NAME = 'Unnested';
const GRAPH_FAN_LOOSE_NAME = 'Unnested, with a tier';
const GRAPH_FAN_RING_NAME = 'unnested';
const GRAPH_FAN_RING_GAP = 14;
const GRAPH_FAN_LOOSE_GAP = 10;
const GRAPH_FAN_LOOSE_STEP = 2 * Math.PI / 180;

// The captions are text at a fixed size on screen, so the layout cannot know how
// wide one comes out in the world: that depends on how far Fit zooms out, which
// depends on the size of the fan. It spaces them for the scale Fit gives a fan of
// this size on a stage GRAPH_FAN_REF_PX tall (graphFanScale, 1 at most), measuring
// text in screen pixels: a character takes GRAPH_FAN_CAPTION_CHAR, a line
// GRAPH_FAN_CAPTION_LINE. Fit then adds its own padding on top.
const GRAPH_FAN_REF_PX = 560;
const GRAPH_FAN_CAPTION_CHAR = 7;
const GRAPH_FAN_CAPTION_PAD = 6;
const GRAPH_FAN_CAPTION_LINE = 14;
const GRAPH_FAN_SEAM_PAD = 4;
const GRAPH_FAN_CAPTION_DY = '0.35em';
const GRAPH_FAN_DIVIDER_IN = 20;
const GRAPH_FAN_DIVIDER_CLEAR = 9;
const GRAPH_FAN_BUS_IN = 27;
const GRAPH_FAN_BUS_LABEL = 14;

// How far the widest outline an icon can draw reaches from its centre, in dot
// radii. Marks are spaced for it whatever icon a card has, so an icon moves no dot
// and editing one does not redraw the fan.
const GRAPH_FAN_REACH = Math.max(1, ...GRAPH_ICONS.TYPE_ICON_NAMES.map((name) => GRAPH_ICONS.typeIconReach(name, 10) / 10));

function graphFanLabel(band) {
  if (!band.slice) return GRAPH_FAN_RING_NAME;
  if (band.slice.kind === 'tier') return band.slice.name;
  return `depth ${band.slice.depth}`;
}

// The scale the layout spaces its captions for: what Fit gives a fan this big on a
// stage GRAPH_FAN_REF_PX tall, and no more than 1 (a small fan is not zoomed in
// for it). A fan with no band, the block alone, is at 1.
function graphFanScale(outer) {
  return outer > 0 ? Math.min(1, GRAPH_FAN_REF_PX / (2 * (outer + GRAPH_FAN_CLEAR))) : 1;
}

function graphFanCaptionWidth(name, scale, size = 11) {
  return ((String(name).length * GRAPH_FAN_CAPTION_CHAR + GRAPH_FAN_CAPTION_PAD) * size) / (11 * scale);
}

// The cards of a band, a ring or the block by status, in the board's order with the
// archived ones last: [[status, number], ...], only the statuses that hold a card. A
// status the board does not list is filed under its first column, as the board does.
function graphFanSplit(model, ids, statuses) {
  const counts = new Map();
  for (const id of ids) {
    const n = model.byId.get(id);
    const label = n.archived ? 'archived' : GRAPH_COLS.columnForStatus(n.status, statuses);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return statuses.concat('archived').filter((s) => counts.has(s)).map((s) => [s, counts.get(s)]);
}

// What a caption's tip says: the number of cards, the split by status when there is a
// card to split, and the term a reader types to cut to it (null when the caption is
// not a slice). The words are the tip's, so the view only shows them.
function graphFanTip(count, split, term) {
  const lines = [`${count} card${count === 1 ? '' : 's'}`];
  if (count > 0 && split.length) lines.push(split.map(([status, n]) => `${status} ${n}`).join(' · '));
  return { lines, term: term || null };
}

// The slice: term that cuts to a slice, as the search box writes it, so a caption and
// the box never disagree about what a slice is called.
function graphFanTerm(slice) {
  return GRAPH_SEARCH.searchTermText('slice', slice.kind === 'tier' ? slice.name : slice.depth);
}

// Where a tooltip of `size` ({ w, h }) stands on a stage of `stage` ({ w, h }) for the
// mark it is about, `anchor` ({ x0, y0, x1, y1 }), all in the stage's own pixels: under
// the mark, its left edge on the mark's, `gap` away; above the mark when there is no
// room under it; and always whole on the stage, or at its corner when it is bigger.
function graphTipAt(anchor, stage, size, gap) {
  let y = anchor.y1 + gap;
  if (y + size.h > stage.h) y = anchor.y0 - gap - size.h;
  return {
    x: Math.max(0, Math.min(anchor.x0, stage.w - size.w)),
    y: Math.max(0, Math.min(y, stage.h - size.h)),
  };
}

// The caption of each band, up the seam at the top of the fan, level with the band's
// first ring, in axis order, with its name; the number of cards on its rings, their
// split by status and the slice: term go with it for the tip. The
// text runs away from the seam, and neighbours take opposite sides of it, so they
// never touch whatever the zoom. A band nobody is in has a muted caption too, but
// only when it clears the captions on its side by a line: thin empty bands are closer
// together than that, and a band with a card is never left out.
function graphFanCaptions(bands, scale) {
  const line = GRAPH_FAN_CAPTION_LINE / scale;
  const pad = GRAPH_FAN_SEAM_PAD / scale;
  const items = bands.map((b, i) => {
    const name = graphFanLabel(b);
    const right = i % 2 === 1;
    return {
      band: b.index, name, count: b.count, split: b.split, term: b.slice ? graphFanTerm(b.slice) : null, kind: b.slice ? b.slice.kind : GRAPH_FAN_RING_NAME, muted: !b.count,
      side: right ? 'right' : 'left', anchor: right ? 'start' : 'end',
      x: right ? pad : -pad, y: -b.rings[0], w: graphFanCaptionWidth(name, scale), h: line,
    };
  });
  const taken = { left: [], right: [] };
  const clear = (it) => taken[it.side].every((t) => Math.abs(it.y - t.y) >= line);
  const kept = new Set();
  for (const muted of [false, true]) {
    for (const it of items) {
      if (it.muted !== muted || (muted && !clear(it))) continue;
      kept.add(it);
      taken[it.side].push(it);
    }
  }
  return items.filter((it) => kept.has(it));
}

function graphFanMeets(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

// The caption of the sector of loose cards with a tier: its name, standing outside the
// rim in the direction of the middle of the sector, with the number of its cards and
// their `split` by status for the tip. On
// the sides its text runs away from the fan, and above or below the fan it is
// centred over or under its point. When that would land on the Unnested block it
// takes the nearest direction inside the sector that does not. null when no loose
// card has a tier. `box` is the room it takes, in the world.
function graphFanLooseCaption(sectors, outer, scale, block, splitOf) {
  const loose = sectors.find((s) => s.kind === 'loose');
  if (!loose) return null;
  const count = loose.tops.length;
  const split = splitOf(loose.tops);
  const w = graphFanCaptionWidth(GRAPH_FAN_LOOSE_NAME, scale);
  const h = GRAPH_FAN_CAPTION_LINE / scale;
  const reach = outer + GRAPH_FAN_LOOSE_GAP / scale;
  const at = (angle) => {
    const side = Math.cos(angle);
    const x = side * reach;
    const y = Math.sin(angle) * reach;
    const anchor = side > 0.35 ? 'start' : side < -0.35 ? 'end' : 'middle';
    let dy = GRAPH_FAN_CAPTION_DY;
    let y0 = y - h / 2;
    if (anchor === 'middle') {
      dy = y < 0 ? '-0.3em' : '1em';
      y0 = y < 0 ? y - h : y;
    }
    const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    return { name: GRAPH_FAN_LOOSE_NAME, count, split, x, y, dy, anchor, w, box: { x0, y0, x1: x0 + w, y1: y0 + h } };
  };
  const mid = (loose.from + loose.to) / 2;
  const tries = [mid];
  for (let d = GRAPH_FAN_LOOSE_STEP; d <= (loose.from - loose.to) / 2; d += GRAPH_FAN_LOOSE_STEP) tries.push(mid + d, mid - d);
  const frame = block && { x0: block.x, y0: block.y, x1: block.x + block.w, y1: block.y + block.h };
  return (frame && tries.map(at).find((c) => !graphFanMeets(c.box, frame))) || at(mid);
}

// The Unnested block: a column for each status that holds a card, its dots in rows
// of ten, under a row of captions (the status) and the block's title (Unnested); the
// counts are in their tips. The header is tall enough for its text at any zoom
// (graphFanScale), and the text hangs up from the bottom of it, so it never meets
// the dots. A column is as wide as its dots or its caption, and the block as wide as
// its title. Placed in the corner the fan leaves free, clear of the rim; with no fan,
// centred.
function graphFanBlock(columns, outer, scale, pos) {
  if (!columns.length) return null;
  let x = 0;
  let rows = 0;
  let count = 0;
  const cols = columns.map((c) => {
    const dots = Math.ceil(c.ids.length / GRAPH_FAN_BLOCK_ROWS) * GRAPH_FAN_BLOCK_PITCH + GRAPH_FAN_BLOCK_PAD;
    const w = Math.max(dots, GRAPH_FAN_BLOCK_COLUMN, graphFanCaptionWidth(c.label, scale));
    const col = { label: c.label, ids: c.ids, count: c.ids.length, x, w };
    x += w;
    count += c.ids.length;
    rows = Math.max(rows, Math.min(GRAPH_FAN_BLOCK_ROWS, c.ids.length));
    return col;
  });
  const w = Math.max(x, graphFanCaptionWidth(GRAPH_FAN_BLOCK_NAME, scale, 13));
  const top = Math.max(GRAPH_FAN_BLOCK_TOP, GRAPH_FAN_BLOCK_HEAD / scale);
  const h = top + rows * GRAPH_FAN_BLOCK_PITCH + GRAPH_FAN_BLOCK_PAD;
  let bx = -w / 2;
  let by = 0;
  if (outer > 0) {
    by = Math.max(0, outer - h);
    const clear = outer + GRAPH_FAN_CLEAR;
    bx = by < clear ? Math.sqrt(clear * clear - by * by) : 0;
  }
  for (const col of cols) {
    col.ids.forEach((id, i) => {
      pos.set(id, {
        x: bx + col.x + GRAPH_FAN_BLOCK_PAD / 2 + (Math.floor(i / GRAPH_FAN_BLOCK_ROWS) + 0.5) * GRAPH_FAN_BLOCK_PITCH,
        y: by + top + ((i % GRAPH_FAN_BLOCK_ROWS) + 0.5) * GRAPH_FAN_BLOCK_PITCH,
      });
    });
  }
  return { x: bx, y: by, w, h, top, base: top - GRAPH_FAN_BLOCK_BASE / scale, count, columns: cols };
}

// The outermost ring of the Unnested option: the loose cards with no tier (`columns`, the
// block's columns in the board's status order, archived last) on one ring outside the
// radius `inner`, grouped by status, a little room between one group and the next. Each
// card takes the stretch of the ring its mark needs, and the stretches are spread over
// the whole of the fan's sweep, so a ring with few cards is not bunched at one end. The
// ring is as far out as its cards need to keep a dot apart, and its caption stands on the
// seam like the bands' do, so the sweep leaves it room: the caption's width and a dot's
// reach on each side of the seam. That width depends on the scale Fit gives the fan, which
// depends on how far out the ring is (graphFanScale), so the radius is settled in a few
// passes; each only pushes it out. Positions go to `pos` and `polar`; the answer is the
// ring as a band (`slice` null), to stand last among the bands.
function graphFanRing(model, columns, inner, split, pos, polar) {
  const ids = columns.flatMap((c) => c.ids);
  const seats = [];
  let need = 0;
  let reach = 0;
  columns.forEach((c, k) => {
    if (k) need += GRAPH_FAN_RING_GAP;
    for (const id of c.ids) {
      const dot = graphRadius(model.byId.get(id)) * GRAPH_FAN_REACH;
      const w = 2 * dot + GRAPH_FAN_MARK_GAP;
      seats.push({ id, at: need + w / 2 });
      need += w;
      reach = Math.max(reach, dot);
    }
  });
  const base = inner + GRAPH_FAN_PITCH / 2;
  const clearance = (r) => {
    const scale = graphFanScale(r + GRAPH_FAN_PITCH / 2);
    return graphFanCaptionWidth(GRAPH_FAN_RING_NAME, scale) + (GRAPH_FAN_SEAM_PAD + GRAPH_FAN_MARK_GAP) / scale + reach;
  };
  let r = base;
  for (let pass = 0; pass < 4; pass++) {
    const gap = clearance(r);
    r = Math.max(base, need / (2 * Math.PI - 2 * GRAPH_FAN_SEAM), (need + 2 * gap) / (2 * Math.PI));
  }
  const half = Math.max(GRAPH_FAN_SEAM, clearance(r) / r);
  const from = Math.PI * 1.5 - half;
  const span = 2 * Math.PI - 2 * half;
  for (const s of seats) {
    const a = from - (s.at / need) * span;
    pos.set(s.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
    polar.set(s.id, { a, r });
  }
  return {
    index: null, slice: null, count: ids.length, split: split(ids), subs: 1, r0: inner, r1: r + GRAPH_FAN_PITCH / 2, rings: [r],
  };
}

function graphLayoutTiers(model, opts) {
  const { nodes } = model;
  const fan = graphFanPlace(model, opts);
  const { places } = fan;
  const statuses = GRAPH_COLS.liveStatuses(opts && opts.statuses);
  const splitOf = (ids) => graphFanSplit(model, ids, statuses);
  const inBand = new Map(fan.bands.map((b) => [b.index, []]));
  for (const n of nodes) if (places.get(n.id).block === null) inBand.get(places.get(n.id).band).push(n.id);

  // Bands at the size they start with, from the apex out; `grow` below scales them.
  const bands = [];
  let r = GRAPH_FAN_R0;
  for (const b of fan.bands) {
    const r0 = r;
    r += b.subs ? b.subs * GRAPH_FAN_PITCH : GRAPH_FAN_EMPTY;
    bands.push({ ...b, r0, r1: r });
  }
  const bandAt = new Map(bands.map((b) => [b.index, b]));
  const ringOf = (id) => {
    const p = places.get(id);
    return bandAt.get(p.band).r0 + (p.sub + 0.5) * GRAPH_FAN_PITCH;
  };

  // What each card needs of the fan, in radians at the starting size: the angle
  // that spaces its mark from its neighbours' on its ring, or what its children
  // need together when that is more. Children come after parents in outline order,
  // so walking back finishes every child before its parent.
  const span = new Map();
  const below = new Map();
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (places.get(n.id).sector === null) continue;
    const own = (2 * graphRadius(n) * GRAPH_FAN_REACH + GRAPH_FAN_MARK_GAP) / ringOf(n.id);
    const need = Math.max(own, below.get(n.id) || 0);
    span.set(n.id, need);
    if (n.parentId !== null) below.set(n.parentId, (below.get(n.parentId) || 0) + need);
  }
  const needed = fan.sectors.reduce((sum, s) => sum + s.tops.reduce((t, id) => t + span.get(id), 0), 0);
  const gap = fan.sectors.length > 1 ? Math.min(GRAPH_FAN_GAP, (GRAPH_FAN_FROM - GRAPH_FAN_TO) / (3 * fan.sectors.length)) : 0;
  const free = GRAPH_FAN_FROM - GRAPH_FAN_TO - gap * Math.max(0, fan.sectors.length - 1);
  const scale = needed ? free / needed : 0;
  const grow = needed > free ? needed / free : 1;

  // The stretch of the fan each card is given, measured from the left edge: a
  // sector's cards one after another, then each card's children inside its own
  // stretch, centred, in outline order.
  const from = new Map();
  const width = new Map();
  const next = new Map();
  const seat = (id, at, w) => {
    from.set(id, at);
    width.set(id, w);
    next.set(id, at + (w - (w * (below.get(id) || 0)) / span.get(id)) / 2);
  };
  // Siblings are seated in the order the option asks for, the way the Map orders its
  // rows: by status, or by rank, which is the outline's own order. The order moves a
  // card along its own stretch only, so no card changes its band, ring or sector.
  const how = mergeGraphFanOptions(opts).order === 'status' ? 'status' : 'layout';
  const sort = (ids) => GRAPH_MAPREL.mapOrderRow(ids, { nodes: ids.map((id) => model.byId.get(id)) }, how, statuses);
  const kidsOf = new Map();
  for (const n of nodes) {
    if (n.parentId === null || places.get(n.id).sector === null) continue;
    if (!kidsOf.has(n.parentId)) kidsOf.set(n.parentId, []);
    kidsOf.get(n.parentId).push(n.id);
  }
  let at = 0;
  const sectors = fan.sectors.map((s) => {
    const left = GRAPH_FAN_FROM - at;
    const tops = s.kind === 'tree' ? s.tops : sort(s.tops);
    for (const id of tops) {
      const w = span.get(id) * scale;
      seat(id, at, w);
      at += w;
    }
    const placed = { ...s, tops, from: left, to: GRAPH_FAN_FROM - at };
    at += gap;
    return placed;
  });
  for (const n of nodes) {
    if (!kidsOf.has(n.id)) continue;
    for (const id of sort(kidsOf.get(n.id))) {
      const w = (width.get(n.id) * span.get(id)) / span.get(n.id);
      const start = next.get(n.id);
      next.set(n.id, start + w);
      seat(id, start, w);
    }
  }

  const pos = new Map();
  const polar = new Map();
  for (const n of nodes) {
    if (places.get(n.id).sector === null) continue;
    const ang = GRAPH_FAN_FROM - (from.get(n.id) + width.get(n.id) / 2);
    const rad = ringOf(n.id) * grow;
    pos.set(n.id, { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
    polar.set(n.id, { a: ang, r: rad });
  }

  const grown = bands.map((b) => ({
    index: b.index,
    slice: b.slice,
    count: b.count,
    split: splitOf(inBand.get(b.index)),
    subs: b.subs,
    r0: b.r0 * grow,
    r1: b.r1 * grow,
    rings: b.subs
      ? Array.from({ length: b.subs }, (_, k) => (b.r0 + (k + 0.5) * GRAPH_FAN_PITCH) * grow)
      : [(b.r0 + GRAPH_FAN_EMPTY / 2) * grow],
  }));
  const ring = mergeGraphFanOptions(opts).unnested === 'outermost' && fan.columns.length
    ? graphFanRing(model, fan.columns, grown.length ? grown[grown.length - 1].r1 : GRAPH_FAN_R0, splitOf, pos, polar)
    : null;
  if (ring) grown.push(ring);
  const rings = grown.flatMap((b) => b.rings.map((r, k) => ({
    cx: 0, r, label: k ? `${graphFanLabel(b)} ${k + 1}` : graphFanLabel(b),
  })));
  const outer = grown.length ? grown[grown.length - 1].r1 : 0;
  const spokes = sectors.slice(0, -1).map((s) => ({ angle: s.to - gap / 2, r1: outer + GRAPH_FAN_CLEAR }));
  const captionScale = graphFanScale(outer);
  const block = ring ? null : graphFanBlock(fan.columns, outer, captionScale, pos);
  const captions = graphFanCaptions(grown, captionScale);
  const looseCaption = graphFanLooseCaption(sectors, outer, captionScale, block, splitOf);
  const boxes = captions.map((c) => ({
    x0: c.side === 'right' ? c.x : c.x - c.w, y0: c.y - c.h / 2, x1: c.side === 'right' ? c.x + c.w : c.x, y1: c.y + c.h / 2,
  }));
  if (looseCaption) boxes.push(looseCaption.box);
  return graphFinish(model, pos, rings, spokes, [], {
    bands: grown, sectors, block, fan: { from: GRAPH_FAN_FROM, to: GRAPH_FAN_TO }, places, polar, captions, looseCaption, boxes, textScale: captionScale,
  });
}

// --- layout: status ------------------------------------------------------------
// Rings run inside out in REVERSE column order (done innermost, backlog
// outermost). A ring is a set of tracks: when its cards fit the first track
// with room to spare they spread around the full circle, otherwise a full track
// spills to the next one out.

const GRAPH_STATUS_START = 48;
const GRAPH_STATUS_GAP = 34;
const GRAPH_CLUMP_SEP = 90;
const GRAPH_TRACK_TWIST = 0.35;

function graphLayoutStatus(model, opts) {
  const statuses = GRAPH_COLS.liveStatuses(opts && opts.statuses);
  const order = statuses.slice().reverse();
  const ringOf = (n) => GRAPH_COLS.columnForStatus(n.status, statuses);
  const live = model.nodes.filter((n) => !n.archived);
  const archived = model.nodes.filter((n) => n.archived);
  const groups = [{ title: 'live', nodes: live }];
  if (archived.length) groups.push({ title: 'archive', nodes: archived });

  for (const g of groups) {
    g.rings = [];
    g.local = new Map();
    let r = GRAPH_STATUS_START;
    for (const s of order) {
      const ns = g.nodes.filter((n) => ringOf(n) === s)
        .sort((p, q) => p.rootId - q.rootId || p.id - q.id);
      const th = ns.length ? Math.max(...ns.map((n) => 2 * graphRadius(n))) + 6 : 0;
      const circ = Math.PI * 2 * r;
      const widths = ns.map((n) => 2 * graphRadius(n) + 4);
      const sum = widths.reduce((x, y) => x + y, 0);
      const spread = ns.length && sum <= circ * 0.98 ? (circ - sum) / ns.length : 0;
      let track = r;
      let used = 0;
      let ti = 0;
      ns.forEach((n, i) => {
        const w = widths[i];
        if (!spread && used > 0 && used + w > Math.PI * 2 * track) {
          track += th;
          used = 0;
          ti++;
        }
        const ang = -Math.PI / 2 + (used + w / 2 + spread * (i + 0.5)) / track + ti * GRAPH_TRACK_TWIST;
        used += w;
        g.local.set(n.id, { x: Math.cos(ang) * track, y: Math.sin(ang) * track });
      });
      g.rings.push({ r, status: s, count: ns.length });
      r = (ns.length ? track + th / 2 : r) + GRAPH_STATUS_GAP;
    }
    g.R = r;
  }

  const total = groups.reduce((s, g) => s + 2 * g.R, 0) + GRAPH_CLUMP_SEP * (groups.length - 1);
  let x = -total / 2;
  const pos = new Map();
  const rings = [];
  const titles = [];
  for (const g of groups) {
    const cx = x + g.R;
    x += 2 * g.R + GRAPH_CLUMP_SEP;
    for (const [id, p] of g.local) pos.set(id, { x: cx + p.x, y: p.y });
    for (const rg of g.rings) {
      rings.push({ cx, r: rg.r, label: `${rg.status} (${rg.count})`, status: rg.status, count: rg.count });
    }
    if (groups.length > 1) titles.push({ x: cx - 24, y: -g.R - 14, text: g.title });
  }
  return graphFinish(model, pos, rings, [], titles);
}

// --- layout: force -------------------------------------------------------------

const GRAPH_GOLDEN = 2.399963229728653;

function graphForceIterations(n) {
  return n <= 150 ? 300 : n <= 400 ? 150 : n <= 1000 ? 80 : n <= 2000 ? 40 : 20;
}

// seed (Map id -> {x, y}) starts the nodes where they are drawn instead of on
// the golden spiral, so a drag continues from what is on screen.
function graphForceSim(model, seed) {
  const nodes = model.nodes.filter((n) => n.deg > 0).sort((a, b) => a.id - b.id);
  const n = nodes.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const at = new Map();
  nodes.forEach((node, i) => {
    at.set(node.id, i);
    const s = seed && seed.get(node.id);
    px[i] = s ? s.x : Math.cos(i * GRAPH_GOLDEN) * 12 * Math.sqrt(i);
    py[i] = s ? s.y : Math.sin(i * GRAPH_GOLDEN) * 12 * Math.sqrt(i);
  });
  const springs = model.links.map((l) => ({ a: at.get(l.from), b: at.get(l.to), want: l.kind === 'parent' ? 55 : 90 }));
  return { nodes, n, px, py, vx, vy, at, springs, iterations: graphForceIterations(n) };
}

function graphForceStep(sim, alpha, pin) {
  const { n, px, py, vx, vy, springs } = sim;
  const pi = pin && sim.at.has(pin.id) ? sim.at.get(pin.id) : -1;
  if (pi >= 0) { px[pi] = pin.x; py[pi] = pin.y; vx[pi] = 0; vy[pi] = 0; }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = px[j] - px[i];
      let dy = py[j] - py[i];
      const d2 = dx * dx + dy * dy + 0.01;
      if (d2 > 90000) continue;
      const f = 1800 / d2 * alpha;
      const d = Math.sqrt(d2);
      dx /= d;
      dy /= d;
      vx[i] -= dx * f; vy[i] -= dy * f;
      vx[j] += dx * f; vy[j] += dy * f;
    }
  }
  for (const s of springs) {
    const dx = px[s.b] - px[s.a];
    const dy = py[s.b] - py[s.a];
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - s.want) * 0.04 * alpha;
    vx[s.a] += dx / d * f; vy[s.a] += dy / d * f;
    vx[s.b] -= dx / d * f; vy[s.b] -= dy / d * f;
  }
  for (let i = 0; i < n; i++) {
    vx[i] -= px[i] * 0.004 * alpha;
    vy[i] -= py[i] * 0.004 * alpha;
    vx[i] *= 0.6; vy[i] *= 0.6;
    px[i] += vx[i]; py[i] += vy[i];
  }
  if (pi >= 0) { px[pi] = pin.x; py[pi] = pin.y; vx[pi] = 0; vy[pi] = 0; }
}

function graphForcePositions(sim) {
  const pos = new Map();
  sim.nodes.forEach((node, i) => pos.set(node.id, { x: sim.px[i], y: sim.py[i] }));
  return pos;
}

function graphLayoutForce(model) {
  const sim = graphForceSim(model);
  const loose = model.nodes.filter((n) => n.deg === 0).sort((a, b) => a.id - b.id);
  let alpha = 1;
  for (let it = 0; it < sim.iterations; it++) {
    graphForceStep(sim, alpha, null);
    alpha *= 0.985;
  }
  const pos = graphForcePositions(sim);
  let far = 0;
  sim.nodes.forEach((node, i) => {
    far = Math.max(far, Math.hypot(sim.px[i], sim.py[i]) + graphRadius(node));
  });
  const many = loose.length > 16;
  let base = far + 60;
  if (many) base = Math.max(base, loose.length * 1.6);
  loose.forEach((node, i) => {
    const ang = -Math.PI / 2 + Math.PI * 2 * (i + 0.5) / loose.length;
    const rad = base + (many && i % 2 ? 24 : 0);
    pos.set(node.id, { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
  });
  return graphFinish(model, pos, [], [], []);
}

// A new layout with some cards moved (a dragged arrangement): layouts are
// shared through the memo, so the input is never touched.
function graphWithPositions(layout, model, overrides) {
  const pos = new Map(layout.pos);
  for (const [id, p] of overrides) if (pos.has(id)) pos.set(id, { x: p.x, y: p.y });
  return graphFinish(model, pos, layout.rings, layout.spokes, layout.titles);
}

// --- dispatcher + memo ---------------------------------------------------------
// Keyed by what decides positions: node ids, statuses, archived flags, links,
// kind and the statuses list. Not blocked/review, which only change colour.

// The tier fan places a card by its slice, which its type, the hierarchy and the
// whole board's nesting decide, so the Tiers key holds each card's type (without
// regard to case, as a tier does), its slice and whether it is nested, and the
// hierarchy's tiers. Force and Status do not read them. The signature is also what the
// view compares to re-fit an untouched view, so it holds what the cards and the hierarchy
// decide, and the Unnested option, which changes what Fit frames; the order of the
// siblings, which moves dots along their sector and no card to another ring, is added to
// the layout's cache key only (graphLayoutKey).
const GRAPH_CACHE_MAX = 8;
const graphCache = new Map();

function graphTypeKey(type) {
  return typeof type === 'string' ? type.trim().toLowerCase() : '';
}

function graphSignature(model, kind, opts) {
  const fan = kind === 'tiers';
  const nodes = model.nodes.map((n) => {
    const base = `${n.id}:${n.status}:${n.archived ? 1 : 0}`;
    return fan ? `${base}:${graphTypeKey(n.card.type)}:${n.sliceIndex}:${n.nested ? 1 : 0}` : base;
  }).join(',');
  const links = model.links.map((l) => `${l.from}>${l.to}${l.kind === 'wait' ? 'w' : 'p'}`).join(',');
  const statuses = ((opts && opts.statuses) || []).join(',');
  const key = [kind, statuses, nodes, links];
  if (fan) {
    key.push(model.axis.filter((s) => s.kind === 'tier').map((s) => s.name).join(','));
    key.push(mergeGraphFanOptions(opts).unnested);
  }
  return key.join('|');
}

function graphLayoutKey(model, kind, opts) {
  const key = graphSignature(model, kind, opts);
  return kind === 'tiers' ? `${key}|${mergeGraphFanOptions(opts).order}` : key;
}

function graphLayoutCacheClear() {
  graphCache.clear();
}

function graphLayout(model, kind, opts) {
  const which = mergeGraphLayout(kind);
  const key = graphLayoutKey(model, which, opts);
  if (graphCache.has(key)) return graphCache.get(key);
  const layout = which === 'status' ? graphLayoutStatus(model, opts)
    : which === 'force' ? graphLayoutForce(model)
      : graphLayoutTiers(model, opts);
  graphCache.set(key, layout);
  if (graphCache.size > GRAPH_CACHE_MAX) graphCache.delete(graphCache.keys().next().value);
  return layout;
}

// --- view fit ------------------------------------------------------------------
// screen = world * k + {x, y}; bounds centred, scale capped at maxK.

function graphFit(bounds, width, height, pad = 60, maxK = 2.5) {
  const w = Math.max(1, bounds.x1 - bounds.x0);
  const h = Math.max(1, bounds.y1 - bounds.y0);
  let k = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h, maxK);
  if (!Number.isFinite(k) || k <= 0) k = 0.01;
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  return { x: width / 2 - cx * k, y: height / 2 - cy * k, k };
}

// --- visible ids + zoom --------------------------------------------------------
// The status pills and the search compose by intersection, like every other
// view. null means "draw everything". `leftOut` is a set of cards the layout does not
// draw whatever they match (the Tiers layout's Unnested off, graphUnnestedIds): they
// are taken out of what is left, so null becomes every other card.

function graphVisibleIds(pool, searchIds, filter, statuses, leftOut) {
  const statusIds = GRAPH_COLS.mapFilterVisibleIds(pool, filter, statuses);
  const ids = GRAPH_COLS.intersectVisibleIds(searchIds || null, statusIds);
  if (!leftOut || !leftOut.size) return ids;
  return new Set(pool.filter((c) => (!ids || ids.has(c.id)) && !leftOut.has(c.id)).map((c) => c.id));
}

function graphZoomAt(view, px, py, factor, min = 0.1, max = 8) {
  const k = Math.min(max, Math.max(min, view.k * factor));
  const s = k / view.k;
  return { x: px - (px - view.x) * s, y: py - (py - view.y) * s, k };
}

// --- render plan ---------------------------------------------------------------
// Plain data the view turns into SVG: no DOM here. Nodes keep model order
// (outline order), which is the DOM order and so the shift-click range order.
// A node of a type with an icon carries the outline `d` its dot is drawn in
// (a circle node has none: the view draws the round dot), and its `reach`, how
// far that shape goes from the centre. The child ring, the flag ring and the id
// label are placed from the reach, so they clear every corner of every shape.
// The links are the lines drawn. The tier fan, given its options as `opts.fan`
// (GRAPH_FAN_OPTION_VALUES), draws the lines graphFanLines lists, some of them
// counted lines drawn as a bus; every other layout, and a fan given no options,
// draws a line for each relation of the model.

const graphRound = (v) => Math.round(v * 100) / 100;

function graphKindOf(layout, kind) {
  if (kind) return kind;
  if (layout.rings.some((r) => r.status !== undefined)) return 'status';
  if (layout.bands) return 'tiers';
  return layout.rings.length > 0 || layout.spokes.length > 0 ? 'tiers' : 'force';
}

function graphClumps(layout, kind) {
  const centres = [];
  if (kind === 'status') for (const r of layout.rings) if (!centres.includes(r.cx)) centres.push(r.cx);
  if (!centres.length) centres.push(0);
  // Status layout: live cards sit in the first clump, archived ones in the second.
  return { centres, clumpOf: (n) => (kind === 'status' && n.archived && centres.length > 1 ? 1 : 0) };
}

// One path string per model.links entry, in order. Wait links stop at the
// target's rim so the arrow head is not buried under the dot.
function graphLinkPaths(model, layout, kind) {
  const curved = layout.rings.length > 0 || layout.spokes.length > 0;
  const { centres, clumpOf } = graphClumps(layout, graphKindOf(layout, kind));
  return model.links.map((l) => {
    const b = model.byId.get(l.to);
    const pa = layout.pos.get(l.from);
    const pb = layout.pos.get(l.to);
    const head = `M${graphRound(pa.x)} ${graphRound(pa.y)}`;
    if (l.kind === 'wait') {
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy) || 1;
      const trim = graphRadius(b) + 2;
      return `${head}L${graphRound(pb.x - (dx / dist) * trim)} ${graphRound(pb.y - (dy / dist) * trim)}`;
    }
    if (curved) {
      const qx = graphRound((pa.x + pb.x) / 2 * 0.8 + centres[clumpOf(b)] * 0.2);
      const qy = graphRound((pa.y + pb.y) / 2 * 0.8);
      return `${head}Q${qx} ${qy} ${graphRound(pb.x)} ${graphRound(pb.y)}`;
    }
    return `${head}L${graphRound(pb.x)} ${graphRound(pb.y)}`;
  });
}

// A faint arc through each ring of each band, from one side of the seam the long way
// round to the other: one for the band, at its first ring, and a lighter one for each
// further ring of a tier whose cards nest in one another (`sub`). A band nobody is in
// has one thin ring, drawn fainter.
function graphFanGuides(layout) {
  const { from, to } = layout.fan;
  return layout.bands.flatMap((b) => b.rings.map((r, k) => ({
    band: b.index,
    sub: k > 0,
    d: `M${graphRound(Math.cos(from) * r)} ${graphRound(Math.sin(from) * r)}A${graphRound(r)} ${graphRound(r)} 0 1 0 ${graphRound(Math.cos(to) * r)} ${graphRound(Math.sin(to) * r)}`,
    cls: `graph-guide${b.count ? '' : ' graph-guide-empty'}${k ? ' graph-guide-sub' : ''}`,
  })));
}

// The divider between each pair of neighbouring sectors, along the middle of the gap
// between them: from a little inside the first band out to the cards of the two
// sectors it parts, no farther. It stops short of any mark that stands on it (a card
// wider than its stretch, or one dragged onto it), so a divider never cuts a dot, and
// carries on beyond.
function graphFanDividers(model, layout) {
  if (!layout.spokes.length) return [];
  const bandAt = new Map(layout.bands.map((b) => [b.index, b]));
  const marks = [];
  for (const n of model.nodes) {
    const p = layout.places.get(n.id);
    if (p.sector === null) continue;
    const at = layout.pos.get(n.id);
    const band = bandAt.get(p.band);
    marks.push({
      x: at.x, y: at.y, sector: p.sector,
      reach: Math.hypot(at.x, at.y) + (band.r1 - band.r0) / band.rings.length / 2,
      clear: graphRadius(n) * GRAPH_FAN_REACH + 6 + GRAPH_FAN_DIVIDER_CLEAR,
    });
  }
  const inner = Math.max(0, layout.bands[0].r0 - GRAPH_FAN_DIVIDER_IN);
  const out = [];
  layout.spokes.forEach((s, i) => {
    const ux = Math.cos(s.angle);
    const uy = Math.sin(s.angle);
    const far = Math.max(...marks.filter((m) => m.sector === i || m.sector === i + 1).map((m) => m.reach));
    const cuts = [];
    for (const m of marks) {
      const along = m.x * ux + m.y * uy;
      const off = Math.abs(m.x * uy - m.y * ux);
      if (off < m.clear) {
        const half = Math.sqrt(m.clear * m.clear - off * off);
        cuts.push([along - half, along + half]);
      }
    }
    cuts.sort((p, q) => p[0] - q[0]);
    let from = inner;
    for (const cut of cuts.concat([[far, far]])) {
      const to = Math.min(far, cut[0]);
      if (to - from > 4) {
        out.push({ x1: graphRound(ux * from), y1: graphRound(uy * from), x2: graphRound(ux * to), y2: graphRound(uy * to) });
      }
      from = Math.max(from, cut[1]);
    }
  });
  return out;
}

// The block as marks: its frame, its title and the caption of each column, in the
// world. Text hangs up from a baseline near the bottom of the header (`base` below
// the block's top); the title stands one and a half of its own heights above the
// captions. All of it starts at its x. `pitch` is the room each dot takes, for the names
// listed above the block (graph-names.js).
function graphFanBlockPlan(block) {
  if (!block) return null;
  const base = graphRound(block.y + block.base);
  return {
    x: graphRound(block.x), y: graphRound(block.y), w: graphRound(block.w), h: graphRound(block.h), pitch: GRAPH_FAN_BLOCK_PITCH, cls: 'graph-block-frame',
    title: {
      name: GRAPH_FAN_BLOCK_NAME, count: block.count, x: graphRound(block.x + GRAPH_FAN_BLOCK_PAD / 2), y: base, dy: '-1.5em', anchor: 'start', cls: 'graph-block-title',
      tip: graphFanTip(block.count, block.columns.map((c) => [c.label, c.count]), null),
    },
    columns: block.columns.map((c) => ({
      label: c.label,
      count: c.count,
      ids: c.ids.slice(),
      x: graphRound(block.x + c.x),
      w: graphRound(c.w),
      caption: {
        name: c.label, count: c.count, x: graphRound(block.x + c.x + GRAPH_FAN_BLOCK_PAD / 2), y: base, anchor: 'start', cls: 'graph-block-caption',
        tip: graphFanTip(c.count, [], null),
      },
    })),
  };
}

// The counted line of the folded mode, drawn as a bus: out from the parent along its
// own ray to an arc just inside the ring its children sit on (GRAPH_FAN_BUS_IN short of
// it), one arc through the angles of the parent and every child, and a tick from the arc
// out to each child. All of it is one path of apart pieces, so a child's mark covers the
// end of its tick. The label with the count sits on the arc, half way between the parent
// and the nearest child's angle (the one place the stem does not run through), knocked
// out of the line by the text's own halo. The children are on one ring, so one radius
// serves them all.
function graphFanBus(layout, line) {
  const at = (r, a) => `${graphRound(Math.cos(a) * r)} ${graphRound(Math.sin(a) * r)}`;
  const parent = layout.polar.get(line.from);
  const kids = line.kids.map((id) => layout.polar.get(id));
  const ring = kids[0].r;
  const out = ring > parent.r ? 1 : -1;
  const turn = ring - out * GRAPH_FAN_BUS_IN;
  const angles = kids.map((k) => k.a).concat(parent.a).sort((x, y) => x - y);
  const lo = angles[0];
  const hi = angles[angles.length - 1];
  let d = `M${at(parent.r, parent.a)}L${at(turn, parent.a)}`;
  if (hi - lo > 1e-6) d += `M${at(turn, lo)}A${graphRound(turn)} ${graphRound(turn)} 0 ${hi - lo > Math.PI ? 1 : 0} 1 ${at(turn, hi)}`;
  for (const k of kids) d += `M${at(turn, k.a)}L${at(k.r, k.a)}`;
  const mids = [];
  for (let i = 1; i < angles.length; i++) {
    if ((angles[i] - angles[i - 1]) * turn > GRAPH_FAN_BUS_LABEL) mids.push((angles[i] + angles[i - 1]) / 2);
  }
  mids.sort((x, y) => Math.abs(x - parent.a) - Math.abs(y - parent.a));
  const where = mids.length ? mids[0] : parent.a;
  return {
    d,
    label: { x: graphRound(Math.cos(where) * turn), y: graphRound(Math.sin(where) * turn), text: String(line.count) },
  };
}

// The wash of each tier band that holds a card: one entry for each, in tier order, with the
// tier's name and the colour its type has in the board's `types` ('' when it has none). A
// wash is the whole ring of its band, between the band's edges, as one path of two circles
// the view fills even-odd, so the middle is left bare.
function graphFanTints(layout, types) {
  const circle = (r) => `M${r} 0A${r} ${r} 0 1 0 ${-r} 0A${r} ${r} 0 1 0 ${r} 0Z`;
  return layout.bands.filter((b) => b.slice && b.slice.kind === 'tier' && b.count).map((b) => ({
    band: b.index,
    tier: b.slice.name,
    color: GRAPH_TYPES.typeColor(b.slice.name, types),
    d: circle(graphRound(b.r1)) + circle(graphRound(b.r0)),
    cls: 'graph-tint',
  }));
}

function graphPlan(model, layout, opts) {
  const o = opts || {};
  const selected = o.selectedIds || new Set();
  const statusClass = o.statusClass || ((s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const titleOf = o.titleOf || ((c) => c.title || '');
  const kind = graphKindOf(layout, o.kind);
  const { clumpOf } = graphClumps(layout, kind);
  // The tier fan names cards by its Names option; with no option row (Force, Status, a plan
  // given no options) no card is named and none carries a name.
  const named = kind === 'tiers' && o.fan
    ? graphFanNames(model, o.fan.names, { selectedIds: selected, loneCardId: o.loneCardId })
    : null;

  const nodes = model.nodes.map((n) => {
    const p = layout.pos.get(n.id);
    const cls = ['graph-node', 'card-el', `status-${statusClass(n.status)}`];
    if (selected.has(n.id)) cls.push('selected');
    if (o.hoveredId != null && o.hoveredId === n.id) cls.push('hover-highlight');
    if (n.archived) cls.push('archived');
    if (n.status === 'done') cls.push('is-done');
    if (n.kids > 0) cls.push('has-kids');
    if (n.blocked) cls.push('is-blocked');
    if (n.waiting) cls.push('is-waiting');
    if (n.review) cls.push('is-review');
    if (n.deg >= 3) cls.push('graph-hub');
    if (n.deg === 0) cls.push('is-loose');
    if (named && named.has(n.id)) cls.push('graph-named');
    const r = graphRadius(n);
    const iconed = n.shape !== undefined && n.shape !== 'circle';
    const reach = iconed ? GRAPH_ICONS.typeIconReach(n.shape, r) : r;
    const ring = (extra) => (iconed ? graphRound(reach + extra) : r + extra);
    return {
      id: n.id,
      x: graphRound(p.x),
      y: graphRound(p.y),
      r,
      shape: iconed ? n.shape : 'circle',
      d: iconed ? GRAPH_ICONS.typeIconOutline(n.shape, r) : '',
      reach,
      kidsRing: ring(3),
      flagRing: ring(n.kids > 0 ? 6 : 3),
      cls: cls.join(' '),
      title: `#${n.id} ${titleOf(n.card)} (${n.status}${n.archived ? ', archived' : ''})`,
      ...(named ? { name: graphFanNameText(titleOf(n.card), n.id) } : {}),
    };
  });

  // The tier fan draws its bands as guide arcs and captions instead of full rings, and
  // draws the lines its options ask for (graphFanLines); every other layout, and a fan
  // given no options, draws each relation.
  const fan = kind === 'tiers' && layout.bands ? layout : null;
  const paths = graphLinkPaths(model, layout, kind);
  const drawn = fan && o.fan
    ? graphFanLines(model, fan.places, o.fan)
    : model.links.map((l, i) => ({ from: l.from, to: l.to, kind: l.kind, link: i }));
  const links = drawn.map((line) => {
    if (line.kids) {
      const bus = graphFanBus(fan, line);
      return {
        from: line.from, to: line.to, kind: 'parent', d: bus.d, cls: 'graph-link graph-link-parent graph-link-counted', arrow: false, count: line.count, label: bus.label,
      };
    }
    const l = model.links[line.link];
    const cross = kind === 'status' && clumpOf(model.byId.get(l.from)) !== clumpOf(model.byId.get(l.to));
    const cls = `graph-link graph-link-${l.kind}${cross ? ' graph-link-cross' : ''}`;
    return { from: l.from, to: l.to, kind: l.kind, d: paths[line.link], cls, arrow: l.kind === 'wait' };
  });

  const rings = fan ? [] : layout.rings.map((r) => ({ cx: graphRound(r.cx), r: graphRound(r.r), label: r.label, cls: 'graph-ring' }));
  const guides = fan ? graphFanGuides(fan) : [];
  const dividers = fan ? graphFanDividers(model, fan) : [];
  const tints = fan ? graphFanTints(fan, o.types) : [];
  const block = fan ? graphFanBlockPlan(fan.block) : null;
  const looseCaption = fan && fan.looseCaption ? {
    name: fan.looseCaption.name, count: fan.looseCaption.count, x: graphRound(fan.looseCaption.x), y: graphRound(fan.looseCaption.y),
    dy: fan.looseCaption.dy, anchor: fan.looseCaption.anchor, cls: 'graph-caption graph-loose-caption',
    tip: graphFanTip(fan.looseCaption.count, fan.looseCaption.split, null),
  } : null;
  const captions = fan ? fan.captions.map((c) => ({
    band: c.band, name: c.name, count: c.count, kind: c.kind, muted: c.muted, side: c.side,
    x: graphRound(c.x), y: graphRound(c.y), dy: GRAPH_FAN_CAPTION_DY, anchor: c.anchor,
    cls: c.muted ? 'graph-caption graph-caption-muted' : 'graph-caption',
    tip: graphFanTip(c.count, c.split, c.term),
  })) : [];
  const titles = layout.titles.map((t) => ({ x: graphRound(t.x), y: graphRound(t.y), text: t.text }));
  return { nodes, links, rings, titles, guides, tints, captions, dividers, block, looseCaption };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GRAPH_LAYOUTS, mergeGraphLayout,
    GRAPH_FAN_OPTION_VALUES, GRAPH_FAN_OPTION_DEFAULTS, mergeGraphFanOptions,
    GRAPH_FAN_NAMES_CAP, GRAPH_FAN_NAMES_SMALL,
    graphBuild, graphUnnestedIds, graphRadius, graphNeighbours, graphLit, graphQueryEffect, graphRestLit,
    graphFanNames, graphFanNextNames, graphFanNameText,
    graphFanPlace, graphFanLines, graphLayoutTiers, graphLayoutStatus, graphLayoutForce,
    graphForceSim, graphForceStep, graphForcePositions, graphWithPositions, graphLinkPaths,
    graphLayout, graphSignature, graphLayoutCacheClear, graphFit,
    graphVisibleIds, graphZoomAt, graphPlan, graphTipAt,
  };
} else {
  window.GRAPH_LAYOUTS = GRAPH_LAYOUTS;
  window.mergeGraphLayout = mergeGraphLayout;
  window.GRAPH_FAN_OPTION_VALUES = GRAPH_FAN_OPTION_VALUES;
  window.GRAPH_FAN_OPTION_DEFAULTS = GRAPH_FAN_OPTION_DEFAULTS;
  window.mergeGraphFanOptions = mergeGraphFanOptions;
  window.graphBuild = graphBuild;
  window.graphUnnestedIds = graphUnnestedIds;
  window.graphRadius = graphRadius;
  window.graphNeighbours = graphNeighbours;
  window.graphLit = graphLit;
  window.graphQueryEffect = graphQueryEffect;
  window.graphRestLit = graphRestLit;
  window.GRAPH_FAN_NAMES_CAP = GRAPH_FAN_NAMES_CAP;
  window.GRAPH_FAN_NAMES_SMALL = GRAPH_FAN_NAMES_SMALL;
  window.graphFanNames = graphFanNames;
  window.graphFanNextNames = graphFanNextNames;
  window.graphFanPlace = graphFanPlace;
  window.graphFanLines = graphFanLines;
  window.graphLayoutTiers = graphLayoutTiers;
  window.graphLayoutStatus = graphLayoutStatus;
  window.graphLayoutForce = graphLayoutForce;
  window.graphForceSim = graphForceSim;
  window.graphForceStep = graphForceStep;
  window.graphForcePositions = graphForcePositions;
  window.graphWithPositions = graphWithPositions;
  window.graphLinkPaths = graphLinkPaths;
  window.graphLayout = graphLayout;
  window.graphSignature = graphSignature;
  window.graphLayoutCacheClear = graphLayoutCacheClear;
  window.graphFit = graphFit;
  window.graphVisibleIds = graphVisibleIds;
  window.graphZoomAt = graphZoomAt;
  window.graphPlan = graphPlan;
  window.graphTipAt = graphTipAt;
}
