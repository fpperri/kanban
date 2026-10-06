'use strict';
// Pure rules for what the map draws from a board's relations: which parent
// lines, which cards share a graph, in what order a row reads, where cards and
// lines fall, and the words over a graph. No DOM, no storage and no other module
// on purpose: the snapshot embeds this file's source verbatim, where nothing
// else is loaded. Same dual-environment pattern as nesting.js / search.js.

// Every Map option and what it may be set to, the default first.
const MAP_OPTION_VALUES = Object.freeze({
  parentLines: Object.freeze(['chain', 'all', 'off']),
  depLines: Object.freeze(['on', 'off']),
  group: Object.freeze(['tree', 'one']),
  parent: Object.freeze(['below', 'above']),
  align: Object.freeze(['center', 'left']),
  order: Object.freeze(['status', 'layout']),
  relayout: Object.freeze(['keep', 'reflow']),
  cards: Object.freeze(['rich', 'plain']),
});

const MAP_OPTION_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.entries(MAP_OPTION_VALUES).map(([key, values]) => [key, values[0]]),
));

// Saved options from an older or hand-edited store: keep what this version
// still offers, default the rest.
function mergeMapOptions(saved) {
  const own = saved !== null && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const merged = {};
  for (const key of Object.keys(MAP_OPTION_VALUES)) {
    const value = Object.prototype.hasOwnProperty.call(own, key) ? own[key] : undefined;
    merged[key] = MAP_OPTION_VALUES[key].includes(value) ? value : MAP_OPTION_DEFAULTS[key];
  }
  return merged;
}

function mapRelJoin(ids, touching) {
  const root = new Map(ids.map((id) => [id, id]));
  const find = (x) => {
    while (root.get(x) !== x) { root.set(x, root.get(root.get(x))); x = root.get(x); }
    return x;
  };
  for (const [a, b] of touching) {
    if (!root.has(a) || !root.has(b)) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) root.set(rb, ra);
  }
  const sets = new Map();
  for (const id of ids) {
    const r = find(id);
    if (!sets.has(r)) sets.set(r, []);
    sets.get(r).push(id);
  }
  return [...sets.values()];
}

// The children whose parent line the map draws when it draws chain ends.
// `children` is every card whose parent is a card on the board:
// { id, parent, waitsOn: [ids] }. Only a dependency between two children of the
// same parent counts, and it is read on the whole board, so a search or a status
// pill never moves a line. Per chain of siblings joined by such dependencies:
//   below: the children no sibling waits for (the chain's last cards)
//   above: the children that wait for no sibling (the chain's first cards)
// A child with no dependency to or from a sibling is a chain of one: both. A
// chain that loops has no end, so all of it takes the line and no parent is left
// bare. Returns Map child id -> { below, above }.
function mapParentLineEnds(children) {
  const family = new Map();
  for (const child of children) {
    if (!family.has(child.parent)) family.set(child.parent, []);
    family.get(child.parent).push(child);
  }
  const ends = new Map();
  for (const siblings of family.values()) {
    const ids = siblings.map((m) => m.id);
    const idSet = new Set(ids);
    const waits = new Map(siblings.map((m) => [m.id, [...new Set(m.waitsOn || [])].filter((d) => d !== m.id && idSet.has(d))]));
    const waitedFor = new Set([...waits.values()].flat());
    const touching = [...waits].flatMap(([id, deps]) => deps.map((d) => [id, d]));
    for (const chain of mapRelJoin(ids, touching)) {
      const last = chain.filter((id) => !waitedFor.has(id));
      const first = chain.filter((id) => !waits.get(id).length);
      const lastSet = new Set(last.length ? last : chain);
      const firstSet = new Set(first.length ? first : chain);
      for (const id of chain) ends.set(id, { below: lastSet.has(id), above: firstSet.has(id) });
    }
  }
  return ends;
}

// A pair with no `ends` points at a stub (a parent on another board, or an id
// with no card): a stub has no sibling chain to read, so every child keeps its line.
function mapPairDrawn(pair, parentLines, parentAbove) {
  if (parentLines === 'all') return true;
  if (parentLines !== 'chain') return false;
  return !pair.ends || (parentAbove ? pair.ends.above : pair.ends.below);
}

// A pair already joined by a dependency in either direction adds no edge: the
// dependency places it, and a second edge could turn one relation into a loop.
function mapLayoutEdges(edges, pairs, parentAbove) {
  const out = edges.slice();
  const joined = new Set(edges.flatMap((e) => [`${e.from}>${e.to}`, `${e.to}>${e.from}`]));
  for (const { child, parent } of pairs) {
    if (joined.has(`${child}>${parent}`)) continue;
    out.push(parentAbove ? { from: parent, to: child, kind: 'parent' } : { from: child, to: parent, kind: 'parent' });
  }
  return out;
}

// The cards a graph's heading names: those that are not a child of another card
// in the graph; a graph made of dependencies alone, those that wait for no card
// in it. A loop has none, so it names its lowest card.
function mapGraphRoots(nodes, pairs, edges) {
  const inGraph = new Set(nodes.map((n) => n.id));
  const roots = pairs.length
    ? nodes.filter((n) => !pairs.some((p) => p.child === n.id && inGraph.has(p.parent)))
    : nodes.filter((n) => !edges.some((e) => e.to === n.id));
  return (roots.length ? roots : nodes.slice(0, 1)).map((n) => n.id);
}

// What the map draws for the relations `rel` ({ nodes, ghosts, edges, pairs }, see
// buildRelationsGraph) under `options` (see MAP_OPTION_VALUES). A card is in a
// graph when any relation touches it, drawn or not, and a tree is every card any
// relation joins, so a line toggle never moves a card out of its graph. Layout
// keep places cards by every relation, reflow by the ones drawn. Trees come
// biggest first, then by lowest card.
function mapShapeRelations(rel, options) {
  const o = mergeMapOptions(options);
  const above = o.parent === 'above';
  const lines = rel.pairs.filter((pair) => mapPairDrawn(pair, o.parentLines, above));
  const edges = o.depLines === 'off' ? [] : rel.edges;
  const layoutEdges = o.relayout === 'reflow' ? mapLayoutEdges(edges, lines, above) : mapLayoutEdges(rel.edges, rel.pairs, above);

  const touched = new Set();
  for (const e of rel.edges) { touched.add(e.from); touched.add(e.to); }
  for (const p of rel.pairs) { touched.add(p.child); touched.add(p.parent); }
  const byId = (a, b) => a.id - b.id;
  const nodes = rel.nodes.filter((n) => touched.has(n.id)).sort(byId);
  const ghosts = rel.ghosts.filter((g) => touched.has(g.id)).sort(byId);
  const everyId = nodes.concat(ghosts).map((n) => n.id).sort((a, b) => a - b);

  const joined = o.group === 'tree'
    ? mapRelJoin(everyId, rel.edges.map((e) => [e.from, e.to]).concat(rel.pairs.map((p) => [p.child, p.parent])))
    : [everyId];
  const graphs = joined.filter((ids) => ids.length).map((ids) => {
    const inGraph = new Set(ids);
    const own = (list, end) => list.filter((x) => inGraph.has(x[end]));
    const gNodes = nodes.filter((n) => inGraph.has(n.id));
    return {
      ids: ids.slice().sort((a, b) => a - b),
      nodes: gNodes,
      ghosts: ghosts.filter((g) => inGraph.has(g.id)),
      roots: mapGraphRoots(gNodes, own(rel.pairs, 'child'), own(rel.edges, 'from')),
      edges: own(edges, 'from'),
      lines: own(lines, 'child'),
      layoutEdges: own(layoutEdges, 'from'),
    };
  });
  graphs.sort((a, b) => (b.nodes.length - a.nodes.length) || (b.ghosts.length - a.ghosts.length)
    || (a.ids[0] - b.ids[0]));
  return { graphs, noRelations: rel.nodes.filter((n) => !touched.has(n.id)).map((n) => n.id) };
}

// How near the reader's attention a card sits, lowest first: doing, todo,
// backlog, any other live status in the board's column order (one the board does
// not list after those), done, archived, and last the stubs.
const MAP_RANK_DONE = 800;
const MAP_RANK_ARCHIVED = 900;
const MAP_RANK_STUB = 1000;

function mapStatusRank(node, statuses) {
  if (node.archived) return MAP_RANK_ARCHIVED;
  const status = String(node.status || '').toLowerCase();
  const head = ['doing', 'todo', 'backlog'].indexOf(status);
  if (head >= 0) return head;
  if (status === 'done') return MAP_RANK_DONE;
  const live = statuses.map((s) => String(s).toLowerCase());
  const at = live.indexOf(status);
  return 3 + (at >= 0 ? at : live.length);
}

// A card that is not one of the graph's `nodes` is a stub and goes last. Ties
// keep the order given, which is the layout's.
function mapOrderRow(ids, graph, order, statuses) {
  if (order !== 'status') return ids.slice();
  const nodeOf = new Map(graph.nodes.map((n) => [n.id, n]));
  const rank = (id) => (nodeOf.has(id) ? mapStatusRank(nodeOf.get(id), statuses || []) : MAP_RANK_STUB);
  return ids.map((id, i) => ({ id, i, r: rank(id) })).sort((a, b) => (a.r - b.r) || (a.i - b.i)).map((k) => k.id);
}

// Where the cards and lines fall is the same on both surfaces; only the size of
// a card differs, so each passes its own `dims` { nodeW, nodeH, gapX, gapY, pad }.

// Rows of cards down the page, each as tall as its tallest card. `rows` is layer
// -> ids left to right, `heights` id -> card height. Align center sits each row in
// the middle of the widest one. Returns each card's box and the bottom edge.
function mapRowPositions(rows, heights, align, dims) {
  const rowWidth = (count) => count * (dims.nodeW + dims.gapX) - dims.gapX;
  const count = rows.size ? Math.max(...rows.keys()) + 1 : 0;
  let widest = 0;
  for (const ids of rows.values()) widest = Math.max(widest, rowWidth(ids.length));
  const pos = new Map();
  let y = dims.pad;
  for (let l = 0; l < count; l++) {
    const ids = rows.get(l) || [];
    const shift = align === 'center' ? (widest - rowWidth(ids.length)) / 2 : 0;
    ids.forEach((id, i) => {
      const x = dims.pad + shift + i * (dims.nodeW + dims.gapX);
      pos.set(id, { x, y, cx: x + dims.nodeW / 2, h: heights.get(id) });
    });
    y += (ids.length ? Math.max(...ids.map((id) => heights.get(id))) : dims.nodeH) + dims.gapY;
  }
  return { pos, bottom: y - dims.gapY };
}

const MAP_LINE_NUDGE = 9;
const MAP_LINE_BOW = 0.65;
const MAP_PORT_FIRST = 0.14;
const MAP_PORT_SPAN = 0.72;

// One dashed line per drawn pair in `graph.lines`, as a path and whether it is
// dimmed (an end is a stub). It runs child to parent when the parent sits below
// and parent to child when above, so the dot goes on the parent's end, which has
// no arrowhead. A line that would lie on a solid arrow is nudged aside, one that
// runs against the layout bows out to the side like a back edge, and a parent with
// three or more lines spreads where they meet it. `maxX` is how far a bow reaches.
function mapParentLinePaths(graph, pos, layer, parentSits, dims) {
  const above = parentSits === 'above';
  const stubIds = new Set(graph.ghosts.map((g) => g.id));
  const byParent = new Map();
  for (const l of graph.lines) {
    if (!byParent.has(l.parent)) byParent.set(l.parent, []);
    byParent.get(l.parent).push(l);
  }
  const portX = new Map();
  for (const [pid, list] of byParent) {
    const parent = pos.get(pid);
    if (!parent || list.length < 3) continue;
    const sorted = list.slice().sort((a, b) => (pos.get(a.child) || parent).cx - (pos.get(b.child) || parent).cx);
    sorted.forEach((l, i) => portX.set(l, Math.round((parent.x + dims.nodeW * (MAP_PORT_FIRST + MAP_PORT_SPAN * i / (sorted.length - 1))) * 100) / 100));
  }
  const bow = dims.nodeW * MAP_LINE_BOW;
  const depLeaves = new Set(graph.edges.map((e) => e.from));
  const depArrives = new Set(graph.edges.map((e) => e.to));
  const paths = [];
  let maxX = 0;
  for (const l of graph.lines) {
    if (!pos.get(l.parent) || !pos.get(l.child)) continue;
    const fromId = above ? l.parent : l.child;
    const toId = above ? l.child : l.parent;
    const from = pos.get(fromId);
    const to = pos.get(toId);
    const back = (layer.get(toId) || 0) <= (layer.get(fromId) || 0);
    const x1 = from.cx + (depLeaves.has(fromId) ? MAP_LINE_NUDGE : 0);
    const x2 = to.cx + (depArrives.has(toId) ? MAP_LINE_NUDGE : 0);
    const y1 = from.y + from.h;
    const y2 = to.y;
    const midY = (y1 + y2) / 2;
    let d;
    if (portX.has(l) && !back) {
      const px1 = above ? portX.get(l) : x1;
      const px2 = above ? x2 : portX.get(l);
      d = `M${px1},${y1} C${px1},${midY} ${px2},${midY} ${px2},${y2}`;
    } else if (back) {
      maxX = Math.max(maxX, x1 + bow, x2 + bow);
      d = `M${x1},${y1} C${x1 + bow},${y1} ${x2 + bow},${y2} ${x2},${y2}`;
    } else {
      d = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
    }
    paths.push({ d, dimmed: stubIds.has(l.child) || stubIds.has(l.parent) });
  }
  return { paths, maxX };
}

// A rich card's rows under its title: a meta row (type, altitude, blocked) and
// a roll-up bar `barH` tall, in that order, with `dims` { top, metaH, barGap,
// bottom, bareH }. A card with neither is `bareH`, no taller than its title needs.
function mapRichBox(hasMeta, hasBar, barH, dims) {
  let end = dims.top;
  if (hasMeta) end += dims.metaH;
  const barY = hasBar ? (hasMeta ? end + dims.barGap : end) : 0;
  if (hasBar) end = barY + barH;
  return { metaY: dims.top, barY, barH: hasBar ? barH : 0, h: hasMeta || hasBar ? end + dims.bottom : dims.bareH };
}

function mapPlural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function mapGraphCounts(graph) {
  const stubs = graph.ghosts.length ? ` + ${mapPlural(graph.ghosts.length, 'stub')}` : '';
  return mapPlural(graph.nodes.length, 'card') + stubs;
}

function mapGraphsLabel(graphs, group) {
  const cards = mapPlural(graphs.reduce((sum, g) => sum + g.nodes.length, 0), 'card');
  return group === 'tree' ? `Relation trees (${mapPlural(graphs.length, 'tree')}, ${cards})` : `Relations graph (${cards})`;
}

// The heading over one tree: up to three roots, each with the title `titleOf`
// gives it, then how many more there are.
function mapRootsText(graph, titleOf) {
  const named = graph.roots.slice(0, 3).map((id) => `#${id} ${titleOf(id)}`).join(' · ');
  return graph.roots.length > 3 ? `${named} +${graph.roots.length - 3} more` : named;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAP_OPTION_VALUES, MAP_OPTION_DEFAULTS, mergeMapOptions, mapParentLineEnds, mapShapeRelations, mapOrderRow,
    mapRowPositions, mapParentLinePaths, mapRichBox, mapPlural, mapGraphCounts, mapGraphsLabel, mapRootsText,
  };
} else {
  window.MAP_OPTION_VALUES = MAP_OPTION_VALUES;
  window.MAP_OPTION_DEFAULTS = MAP_OPTION_DEFAULTS;
  window.mergeMapOptions = mergeMapOptions;
  window.mapParentLineEnds = mapParentLineEnds;
  window.mapShapeRelations = mapShapeRelations;
  window.mapOrderRow = mapOrderRow;
  window.mapRowPositions = mapRowPositions;
  window.mapParentLinePaths = mapParentLinePaths;
  window.mapRichBox = mapRichBox;
  window.mapPlural = mapPlural;
  window.mapGraphCounts = mapGraphCounts;
  window.mapGraphsLabel = mapGraphsLabel;
  window.mapRootsText = mapRootsText;
}
