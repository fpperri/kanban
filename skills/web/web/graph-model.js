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

const GRAPH_LAYOUTS = ['tiers', 'force', 'status'];

function mergeGraphLayout(saved) {
  return GRAPH_LAYOUTS.includes(saved) ? saved : 'tiers';
}

// --- model ---------------------------------------------------------------------
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
// or children somewhere on the board); the model carries the axis.

function graphBuild(cards, opts) {
  const ctx = (opts && opts.ctx) || null;
  const visibleIds = (opts && opts.visibleIds) || null;
  const types = (opts && opts.types) || null;
  const hierarchy = (opts && opts.hierarchy) || (ctx && ctx.hierarchy) || [];
  const pool = new Map();
  for (const c of cards || []) if (!pool.has(c.id)) pool.set(c.id, c);
  const drawn = new Map();
  for (const c of pool.values()) if (!visibleIds || visibleIds.has(c.id)) drawn.set(c.id, c);

  const whole = [...pool.values()];
  const slices = GRAPH_SLICES.sliceCards(whole, hierarchy, GRAPH_NEST.depthMap(whole, ctx));
  const nested = new Set();
  for (const c of whole) {
    const pid = GRAPH_NEST.localParentId(c, ctx);
    if (pid !== null && pid !== c.id && pool.has(pid)) { nested.add(c.id); nested.add(pid); }
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
  return { nodes, links, byId, axis: slices.axis };
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
// into model.links } or null when there is nothing to light, which dims nothing.

// The cards among `ids` that the Graph draws, and the relations that run between
// two of them.
function graphLit(model, ids) {
  const nodes = new Set();
  for (const id of ids || []) if (model.byId.has(id)) nodes.add(id);
  if (!nodes.size) return null;
  const links = new Set();
  model.links.forEach((l, i) => {
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
// whatever the view draws. Isolate, which shows only the lit cards, changes this
// decision and nothing else.
function graphQueryEffect(match, pool, ctx) {
  const ids = match && match.ids ? match.ids : null;
  const terms = (match && match.terms) || [];
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
function graphRestLit(model, { selectedIds, loneCardId }) {
  if (loneCardId !== null && loneCardId !== undefined && model.byId.has(loneCardId)) return graphLit(model, graphNeighbours(model, loneCardId));
  return graphLit(model, selectedIds);
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
    // A fan's rings are arcs, from the flat edge on the left round to the fan's right edge.
    if (fan) grow(-r.r, 0, r.r * Math.cos(fan.to), r.r);
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
//           nested under it, in outline order, then one sector for the loose cards
//           that have a tier. null for a card in the block.
//   block   the status column of the Unnested block, for a loose card with no tier.
// A card is loose when it is unnested on the whole board: no parent and no
// children, drawn or not, so hiding its relatives never moves it. `bands` lists
// the bands that are drawn: every tier, empty ones too, then only the depths
// that hold a card without a tier that is not in the block (a depth with none
// has no ring). `columns` are the block's columns in the board's status order,
// archived cards last.
function graphFanPlace(model, opts) {
  const { nodes, axis } = model;
  const tierCount = axis.filter((s) => s.kind === 'tier').length;
  const statuses = GRAPH_COLS.liveStatuses(opts && opts.statuses);
  const places = new Map();
  const sectors = [];
  const sectorOfRoot = new Map();
  const loose = [];
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
    if (!n.nested && n.sliceIndex >= tierCount) {
      place.sub = 0;
      if (n.archived) { place.block = 'archived'; archived.push(n.id); }
      else {
        place.block = GRAPH_COLS.columnForStatus(n.status, statuses);
        live.get(place.block).push(n.id);
      }
      continue;
    }
    if (!n.nested) loose.push(n.id);
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
  if (loose.length) {
    for (const id of loose) places.get(id).sector = sectors.length;
    sectors.push({ kind: 'loose', rootId: null, tops: loose, leaves: loose.length });
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

// --- layout: tiers -------------------------------------------------------------
// The tier fan. The apex is the origin and the fan opens downward, from
// GRAPH_FAN_FROM on the left round to GRAPH_FAN_TO on the right. Bands run from the
// apex out in the order of the board's axis (graphFanPlace): a band for each tier,
// tier 1 innermost, then a ring for each depth that holds a card without a tier.
// A band is a stretch of radius; the dots of a band sit on its rings (a tier
// whose cards nest in one another has a ring for each level). Each tree takes a
// sector of the fan, its share the sum of what its cards need, and a card sits at
// the middle of the stretch its own subtree is given, so a parent is between its
// children. What a card needs is the angle that spaces its mark from its
// neighbours' on its ring; when the sectors would need more angle than the fan
// has, every radius grows to give it, so no two dots on a ring ever touch.
// Loose cards with no tier sit in the Unnested block outside the rim.
//
// The layout answers more than positions, for whatever draws bands, captions and
// the block's frame: `bands` ({ index, slice, count, subs, r0, r1, rings }),
// `sectors` ({ kind, rootId, tops, leaves, from, to } in radians, `from` the left
// edge), `block` ({ x, y, w, h, count, columns: [{ label, ids, count, x, w }] },
// columns relative to the block), `captions` (the caption of each band, with its
// row), `looseCaption` (the caption of the loose cards with a tier) and `fan`
// ({ from, to }). `rings` are the circles drawn through the rows of dots, and
// `spokes` the dividers between sectors. The bounds Fit frames hold the dots, the
// arcs the rings make (the fan only, not the full circle), the captions above the
// flat edge, the loose caption and the block. graphPlan turns all of it into marks:
// guide arcs, captions, dividers and the block's frame, title and column captions.
// Every pass below walks the nodes in outline order, forwards or back, never recursing.

const GRAPH_FAN_FROM = 172 * Math.PI / 180;
const GRAPH_FAN_TO = 8 * Math.PI / 180;
const GRAPH_FAN_GAP = 5 * Math.PI / 180;
const GRAPH_FAN_R0 = 60;
const GRAPH_FAN_PITCH = 56;
const GRAPH_FAN_EMPTY = 20;
const GRAPH_FAN_MARK_GAP = 8;
const GRAPH_FAN_CLEAR = 30;
const GRAPH_FAN_BLOCK_PITCH = 22;
const GRAPH_FAN_BLOCK_ROWS = 10;
const GRAPH_FAN_BLOCK_TOP = 36;
const GRAPH_FAN_BLOCK_PAD = 12;
const GRAPH_FAN_BLOCK_COLUMN = 56;
const GRAPH_FAN_BLOCK_NAME = 'Unnested';
const GRAPH_FAN_LOOSE_NAME = 'Unnested, with a tier';
const GRAPH_FAN_LOOSE_ROOM = 20;

// The captions are text at a fixed size on screen, so the layout cannot know how
// wide one comes out in the world. It spaces them for a nominal scale: a character
// takes GRAPH_FAN_CAPTION_CHAR world units, and the two rows above the flat edge
// take GRAPH_FAN_CAPTION_ROOM. Fit then adds its own padding on top.
const GRAPH_FAN_CAPTION_CHAR = 7;
const GRAPH_FAN_CAPTION_PAD = 6;
const GRAPH_FAN_CAPTION_ROOM = 34;
const GRAPH_FAN_CAPTION_DY = ['-0.8em', '-2.3em'];
const GRAPH_FAN_DIVIDER_IN = 20;
const GRAPH_FAN_DIVIDER_CLEAR = 9;

// How far the widest outline an icon can draw reaches from its centre, in dot
// radii. Marks are spaced for it whatever icon a card has, so an icon moves no dot
// and editing one does not redraw the fan.
const GRAPH_FAN_REACH = Math.max(1, ...GRAPH_ICONS.TYPE_ICON_NAMES.map((name) => GRAPH_ICONS.typeIconReach(name, 10) / 10));

function graphFanLabel(band) {
  if (band.slice.kind === 'tier') return band.slice.name;
  return band.slice.depth === 0 ? 'roots' : `depth ${band.slice.depth}`;
}

function graphFanCaptionWidth(name, count) {
  return (String(name).length + 1 + String(count).length) * GRAPH_FAN_CAPTION_CHAR + GRAPH_FAN_CAPTION_PAD;
}

// The caption of each band, on the fan's flat edge above the band's first ring, in
// axis order, with its name and the number of cards on its rings. Neighbours
// alternate between two rows so they never touch. A band nobody is in has a muted
// caption too, but only when it clears the captions on its row: thin empty bands are
// closer together than a caption is wide, and a band with a card is never left out.
function graphFanCaptions(bands) {
  const items = bands.map((b, i) => {
    const name = graphFanLabel(b);
    return {
      band: b.index, name, count: b.count, kind: b.slice.kind, muted: !b.count, row: i % 2,
      x: -b.rings[0], w: graphFanCaptionWidth(name, b.count),
    };
  });
  const taken = [[], []];
  const clear = (it) => taken[it.row].every((t) => it.x + it.w / 2 <= t.x - t.w / 2 || t.x + t.w / 2 <= it.x - it.w / 2);
  const kept = new Set();
  for (const muted of [false, true]) {
    for (const it of items) {
      if (it.muted !== muted || (muted && !clear(it))) continue;
      kept.add(it);
      taken[it.row].push(it);
    }
  }
  return items.filter((it) => kept.has(it));
}

// The caption of the sector of loose cards with a tier: its name and the number of
// cards, standing above the outermost of them and running away from the fan, which
// is empty there. null when no loose card has a tier.
function graphFanLooseCaption(model, sectors, pos) {
  const loose = sectors.find((s) => s.kind === 'loose');
  if (!loose) return null;
  let far = null;
  for (const id of loose.tops) {
    const p = pos.get(id);
    const out = Math.hypot(p.x, p.y);
    if (!far || out > far.out) far = { id, p, out };
  }
  const reach = graphRadius(model.byId.get(far.id)) * GRAPH_FAN_REACH;
  return {
    name: GRAPH_FAN_LOOSE_NAME, count: loose.tops.length, x: far.p.x, y: far.p.y - reach - 3, dy: '-0.3em',
    w: graphFanCaptionWidth(GRAPH_FAN_LOOSE_NAME, loose.tops.length),
  };
}

// The Unnested block: a column for each status that holds a card, its dots in rows
// of ten, under a row of captions (the status and its count) and the block's title
// (Unnested and its count). The header is GRAPH_FAN_BLOCK_TOP tall and its text hangs
// up from the bottom of it, so it never meets the dots at any zoom. A column is as
// wide as its dots or its caption, and the block as wide as its title. Placed in the
// corner the fan leaves free, clear of the rim; with no fan, centred.
function graphFanBlock(columns, outer, pos) {
  if (!columns.length) return null;
  let x = 0;
  let rows = 0;
  let count = 0;
  const cols = columns.map((c) => {
    const dots = Math.ceil(c.ids.length / GRAPH_FAN_BLOCK_ROWS) * GRAPH_FAN_BLOCK_PITCH + GRAPH_FAN_BLOCK_PAD;
    const w = Math.max(dots, GRAPH_FAN_BLOCK_COLUMN, graphFanCaptionWidth(c.label, c.ids.length));
    const col = { label: c.label, ids: c.ids, count: c.ids.length, x, w };
    x += w;
    count += c.ids.length;
    rows = Math.max(rows, Math.min(GRAPH_FAN_BLOCK_ROWS, c.ids.length));
    return col;
  });
  const w = Math.max(x, graphFanCaptionWidth(GRAPH_FAN_BLOCK_NAME, count));
  const h = GRAPH_FAN_BLOCK_TOP + rows * GRAPH_FAN_BLOCK_PITCH + GRAPH_FAN_BLOCK_PAD;
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
        y: by + GRAPH_FAN_BLOCK_TOP + ((i % GRAPH_FAN_BLOCK_ROWS) + 0.5) * GRAPH_FAN_BLOCK_PITCH,
      });
    });
  }
  return { x: bx, y: by, w, h, count, columns: cols };
}

function graphLayoutTiers(model, opts) {
  const { nodes } = model;
  const fan = graphFanPlace(model, opts);
  const { places } = fan;

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
  let at = 0;
  const sectors = fan.sectors.map((s) => {
    const left = GRAPH_FAN_FROM - at;
    for (const id of s.tops) {
      const w = span.get(id) * scale;
      seat(id, at, w);
      at += w;
    }
    const placed = { ...s, from: left, to: GRAPH_FAN_FROM - at };
    at += gap;
    return placed;
  });
  for (const n of nodes) {
    if (n.parentId === null || places.get(n.id).sector === null) continue;
    const w = (width.get(n.parentId) * span.get(n.id)) / span.get(n.parentId);
    const start = next.get(n.parentId);
    next.set(n.parentId, start + w);
    seat(n.id, start, w);
  }

  const pos = new Map();
  for (const n of nodes) {
    if (places.get(n.id).sector === null) continue;
    const ang = GRAPH_FAN_FROM - (from.get(n.id) + width.get(n.id) / 2);
    const rad = ringOf(n.id) * grow;
    pos.set(n.id, { x: Math.cos(ang) * rad, y: Math.sin(ang) * rad });
  }

  const grown = bands.map((b) => ({
    index: b.index,
    slice: b.slice,
    count: b.count,
    subs: b.subs,
    r0: b.r0 * grow,
    r1: b.r1 * grow,
    rings: b.subs
      ? Array.from({ length: b.subs }, (_, k) => (b.r0 + (k + 0.5) * GRAPH_FAN_PITCH) * grow)
      : [(b.r0 + GRAPH_FAN_EMPTY / 2) * grow],
  }));
  const rings = grown.flatMap((b) => b.rings.map((ring, k) => ({
    cx: 0, r: ring, label: k ? `${graphFanLabel(b)} ${k + 1}` : graphFanLabel(b),
  })));
  const outer = grown.length ? grown[grown.length - 1].r1 : 0;
  const spokes = sectors.slice(0, -1).map((s) => ({ angle: s.to - gap / 2, r1: outer + GRAPH_FAN_CLEAR }));
  const block = graphFanBlock(fan.columns, outer, pos);
  const captions = graphFanCaptions(grown);
  const looseCaption = graphFanLooseCaption(model, sectors, pos);
  const boxes = captions.map((c) => ({ x0: c.x - c.w / 2, y0: -GRAPH_FAN_CAPTION_ROOM, x1: c.x + c.w / 2, y1: 0 }));
  if (looseCaption) boxes.push({ x0: looseCaption.x, y0: looseCaption.y - GRAPH_FAN_LOOSE_ROOM, x1: looseCaption.x + looseCaption.w, y1: looseCaption.y });
  return graphFinish(model, pos, rings, spokes, [], {
    bands: grown, sectors, block, fan: { from: GRAPH_FAN_FROM, to: GRAPH_FAN_TO }, places, captions, looseCaption, boxes,
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
// hierarchy's tiers. Force and Status do not read them.
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
  if (fan) key.push(model.axis.filter((s) => s.kind === 'tier').map((s) => s.name).join(','));
  return key.join('|');
}

function graphLayoutCacheClear() {
  graphCache.clear();
}

function graphLayout(model, kind, opts) {
  const which = mergeGraphLayout(kind);
  const key = graphSignature(model, which, opts);
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
// view. null means "draw everything".

function graphVisibleIds(pool, searchIds, filter, statuses) {
  const statusIds = GRAPH_COLS.mapFilterVisibleIds(pool, filter, statuses);
  return GRAPH_COLS.intersectVisibleIds(searchIds || null, statusIds);
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

// A faint arc through each ring of each band, from the flat edge on the left round to
// the fan's right edge: one for the band, at its first ring, and a lighter one for
// each further ring of a tier whose cards nest in one another (`sub`). A band nobody
// is in has one thin ring, drawn fainter.
function graphFanGuides(layout) {
  const end = layout.fan.to;
  return layout.bands.flatMap((b) => b.rings.map((r, k) => ({
    band: b.index,
    sub: k > 0,
    d: `M${graphRound(-r)} 0A${graphRound(r)} ${graphRound(r)} 0 0 0 ${graphRound(Math.cos(end) * r)} ${graphRound(Math.sin(end) * r)}`,
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
// world. Text hangs up from a baseline GRAPH_FAN_BLOCK_TOP minus 8 below the block's
// top; the title stands one and a half of its own heights above the captions.
function graphFanBlockPlan(block) {
  if (!block) return null;
  const base = graphRound(block.y + GRAPH_FAN_BLOCK_TOP - 8);
  return {
    x: graphRound(block.x), y: graphRound(block.y), w: graphRound(block.w), h: graphRound(block.h), cls: 'graph-block-frame',
    title: {
      name: GRAPH_FAN_BLOCK_NAME, count: block.count, x: graphRound(block.x + GRAPH_FAN_BLOCK_PAD / 2), y: base, dy: '-1.5em', cls: 'graph-block-title',
    },
    columns: block.columns.map((c) => ({
      label: c.label,
      count: c.count,
      ids: c.ids.slice(),
      x: graphRound(block.x + c.x),
      w: graphRound(c.w),
      caption: { name: c.label, count: c.count, x: graphRound(block.x + c.x + GRAPH_FAN_BLOCK_PAD / 2), y: base, cls: 'graph-block-caption' },
    })),
  };
}

function graphPlan(model, layout, opts) {
  const o = opts || {};
  const selected = o.selectedIds || new Set();
  const statusClass = o.statusClass || ((s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const titleOf = o.titleOf || ((c) => c.title || '');
  const kind = graphKindOf(layout, o.kind);
  const { clumpOf } = graphClumps(layout, kind);

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
    };
  });

  const paths = graphLinkPaths(model, layout, kind);
  const links = model.links.map((l, i) => {
    const cross = kind === 'status' && clumpOf(model.byId.get(l.from)) !== clumpOf(model.byId.get(l.to));
    const cls = `graph-link graph-link-${l.kind}${cross ? ' graph-link-cross' : ''}`;
    return { from: l.from, to: l.to, kind: l.kind, d: paths[i], cls, arrow: l.kind === 'wait' };
  });

  // The tier fan draws its bands as guide arcs and captions instead of full rings.
  const fan = kind === 'tiers' && layout.bands ? layout : null;
  const rings = fan ? [] : layout.rings.map((r) => ({ cx: graphRound(r.cx), r: graphRound(r.r), label: r.label, cls: 'graph-ring' }));
  const guides = fan ? graphFanGuides(fan) : [];
  const dividers = fan ? graphFanDividers(model, fan) : [];
  const block = fan ? graphFanBlockPlan(fan.block) : null;
  const looseCaption = fan && fan.looseCaption ? {
    name: fan.looseCaption.name, count: fan.looseCaption.count, x: graphRound(fan.looseCaption.x), y: graphRound(fan.looseCaption.y),
    dy: fan.looseCaption.dy, cls: 'graph-caption graph-loose-caption',
  } : null;
  const captions = fan ? fan.captions.map((c) => ({
    band: c.band, name: c.name, count: c.count, kind: c.kind, muted: c.muted, row: c.row,
    x: graphRound(c.x), y: 0, dy: GRAPH_FAN_CAPTION_DY[c.row],
    cls: c.muted ? 'graph-caption graph-caption-muted' : 'graph-caption',
  })) : [];
  const titles = layout.titles.map((t) => ({ x: graphRound(t.x), y: graphRound(t.y), text: t.text }));
  return { nodes, links, rings, titles, guides, captions, dividers, block, looseCaption };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GRAPH_LAYOUTS, mergeGraphLayout,
    graphBuild, graphRadius, graphNeighbours, graphLit, graphQueryEffect, graphRestLit,
    graphFanPlace, graphLayoutTiers, graphLayoutStatus, graphLayoutForce,
    graphForceSim, graphForceStep, graphForcePositions, graphWithPositions, graphLinkPaths,
    graphLayout, graphSignature, graphLayoutCacheClear, graphFit,
    graphVisibleIds, graphZoomAt, graphPlan,
  };
} else {
  window.GRAPH_LAYOUTS = GRAPH_LAYOUTS;
  window.mergeGraphLayout = mergeGraphLayout;
  window.graphBuild = graphBuild;
  window.graphRadius = graphRadius;
  window.graphNeighbours = graphNeighbours;
  window.graphLit = graphLit;
  window.graphQueryEffect = graphQueryEffect;
  window.graphRestLit = graphRestLit;
  window.graphFanPlace = graphFanPlace;
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
}
