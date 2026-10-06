'use strict';
// Pure rules for what the map draws from a board's relations: which parent
// lines, which cards share a graph, in what order a row reads, and which cards
// have no relation at all. No DOM, no storage and no other module on purpose:
// the snapshot embeds this file's source verbatim, where nothing else is
// loaded. Same dual-environment pattern as nesting.js / search.js.

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

const MAP_OPTION_DEFAULTS = Object.freeze({
  parentLines: 'chain',
  depLines: 'on',
  group: 'tree',
  parent: 'below',
  align: 'center',
  order: 'status',
  relayout: 'keep',
  cards: 'rich',
});

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

// Groups ids into connected sets given pairs of ids that touch.
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
// `members` is every card whose parent is a card on the board:
// { id, parent, waitsOn: [ids] }. Only a dependency between two children of the
// same parent counts, and it is read on the whole board, so a search or a status
// pill never moves a line. Per web of siblings joined by such dependencies:
//   below: the children no sibling waits for (the web's last cards)
//   above: the children that wait for no sibling (the web's first cards)
// A child with no dependency to or from a sibling is a web of one: both. A web
// that loops has no end, so all of it takes the line and no parent is left bare.
// Returns Map child id -> { below, above }.
function mapParentLineEnds(members) {
  const family = new Map();
  for (const m of members) {
    if (!family.has(m.parent)) family.set(m.parent, []);
    family.get(m.parent).push(m);
  }
  const ends = new Map();
  for (const siblings of family.values()) {
    const ids = siblings.map((m) => m.id);
    const idSet = new Set(ids);
    const waits = new Map(siblings.map((m) => [m.id, [...new Set(m.waitsOn || [])].filter((d) => d !== m.id && idSet.has(d))]));
    const waitedFor = new Set([...waits.values()].flat());
    const touching = [...waits].flatMap(([id, deps]) => deps.map((d) => [id, d]));
    for (const web of mapRelJoin(ids, touching)) {
      const last = web.filter((id) => !waitedFor.has(id));
      const first = web.filter((id) => !waits.get(id).length);
      const lastSet = new Set(last.length ? last : web);
      const firstSet = new Set(first.length ? first : web);
      for (const id of web) ends.set(id, { below: lastSet.has(id), above: firstSet.has(id) });
    }
  }
  return ends;
}

// Whether the pair's parent line is drawn. A pair with no `ends` points at a
// stub (a parent on another board, or an id with no card): a stub has no sibling
// chain to read, so every child keeps its line.
function mapPairDrawn(pair, parentLines, parentAbove) {
  if (parentLines === 'all') return true;
  if (parentLines !== 'chain') return false;
  return !pair.ends || (parentAbove ? pair.ends.above : pair.ends.below);
}

// The edges that place cards in rows. A parent sits after its children when
// below and before them when above. A pair already joined by a dependency in
// either direction adds nothing: the dependency places it, and a second edge
// could turn one relation into a loop.
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
// relation joins, so a line toggle never moves a card out of its graph; a card
// nothing touches is in `noRelations`. Layout keep places cards by every relation,
// reflow by the ones drawn. Trees come biggest first, then by lowest card.
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
function mapStatusRank(node, isStub, statuses) {
  if (isStub) return 1000;
  if (node.archived) return 900;
  const status = String(node.status || '').toLowerCase();
  const head = ['doing', 'todo', 'backlog'].indexOf(status);
  if (head >= 0) return head;
  if (status === 'done') return 800;
  const live = statuses.map((s) => String(s).toLowerCase());
  const at = live.indexOf(status);
  return 3 + (at >= 0 ? at : live.length);
}

// One row of a graph, left to right. `order` is 'status' (by mapStatusRank, ties
// in the order given) or 'layout' (as given). `graph` is { nodes, ghosts }.
function mapOrderRow(ids, graph, order, statuses) {
  if (order !== 'status') return ids.slice();
  const nodeOf = new Map(graph.nodes.map((n) => [n.id, n]));
  const stubs = new Set(graph.ghosts.map((g) => g.id));
  const rank = (id) => (nodeOf.has(id) ? mapStatusRank(nodeOf.get(id), stubs.has(id), statuses || []) : 1000);
  return ids.map((id, i) => ({ id, i, r: rank(id) })).sort((a, b) => (a.r - b.r) || (a.i - b.i)).map((k) => k.id);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MAP_OPTION_VALUES, MAP_OPTION_DEFAULTS, mergeMapOptions, mapParentLineEnds, mapShapeRelations, mapOrderRow };
} else {
  window.MAP_OPTION_VALUES = MAP_OPTION_VALUES;
  window.MAP_OPTION_DEFAULTS = MAP_OPTION_DEFAULTS;
  window.mergeMapOptions = mergeMapOptions;
  window.mapParentLineEnds = mapParentLineEnds;
  window.mapShapeRelations = mapShapeRelations;
  window.mapOrderRow = mapOrderRow;
}
