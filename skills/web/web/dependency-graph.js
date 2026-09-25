'use strict';
// Pure graph-builder + layered-layout math for the dependency map view.
// No DOM here — same dual-environment pattern as search.js/column-*.js:
// loaded as a plain <script> in the browser (app.js calls these as bare
// globals) AND required directly by node --test.
//
// Edge convention: an edge A -> B means "B waits for A" (B has A in its
// waiting_for). The snapshot's embedded map (build_editor.py) mirrors this
// same direction, so the two views read the same graph the same way.
//
// The waiting/blocked predicates come from waiting-blocked.js (the
// one shared home) — in Node via require, in the browser off window, where
// waiting-blocked.js loads first (app.html order). Namespace object rather
// than destructured consts, same shared-scope reasoning as gantt-model's CAL.
const WB = (typeof module !== 'undefined' && module.exports)
  ? require('./waiting-blocked')
  : window;

// The node carries precomputed gate flags:
// `waiting` (some waiting_for dep not done — the amber stroke) and `blocked`
// (the manual sticker — the red pill), with `blockedReason` riding along for
// the pill's tooltip.
function cardToNode(c, waiting) {
  return {
    id: c.id, title: c.title, status: c.status, archived: !!c.archived, epic: !!c.epic,
    priority: c.priority || '', waiting: !!waiting,
    blocked: WB.isBlockedValue(c.blocked), blockedReason: WB.blockedReason(c.blocked),
    prompt: c.prompt || null, // lets the map label fall back to it (cardTitleDisplay)
  };
}

// Same derived-waiting rule as the board's own isWaiting() (app.js) — both
// are thin wrappers over the shared unresolvedWaits; byId is the caller's
// own full active+archived lookup (waiting is location-independent).
function isCardWaiting(c, byId) {
  return WB.unresolvedWaits(c.waiting_for, byId).length > 0;
}

// Build the node/edge/ghost-stub set for the map from the full card list
// (active + archived — waiting is location-independent, same as the board's
// own isWaiting() check) and the ids currently matching the search box
// (`visibleIds`: a Set, or null/undefined meaning "no active query — every
// card is visible", mirroring search.js's own "empty query matches
// everything").
//
// Design decisions:
// - An edge with NEITHER endpoint visible is dropped entirely — only
//   matching cards are "the slice you're looking at"; an edge floating
//   between two invisible cards has nothing on-screen to anchor it to.
// - An edge with exactly one endpoint hidden keeps the edge and turns the
//   hidden endpoint into a dimmed ghost stub — in EITHER direction (a hidden
//   dep of a visible card, or a hidden card that waits on a visible one):
//   "a hidden dep is exactly what you're looking for," and the same
//   courtesy applies symmetrically.
// - A waiting_for id with no matching card at all (stale/deleted reference)
//   still gets a ghost stub, marked `missing: true`, rather than silently
//   vanishing.
// - Isolated cards (no waiting_for edge in either direction) are reported
//   separately so the caller can render them in a detached cluster instead
//   of mixing them into the layered graph.
//
// Epic membership edges: a child card's `parent: <epic-id>`
// becomes a child->epic edge with `kind: 'epic'` (waiting_for edges carry
// `kind: 'dep'`). The epic is the SINK, not the root — an epic is done only
// when its children are done, so under the map's "down = completes later"
// convention it lays out BELOW its children (a 2026-07-13 design review
// flipped the original epic-on-top build: epic-as-container read as a false
// prerequisite). Membership is not sequencing: it feeds the layered layout
// and gets the same ghost-stub courtesy, but it never makes anyone `waiting`
// and — deliberately — does NOT count for the isolated row. "No
// dependencies" means no SEQUENCING deps, so an epic whose only edges are
// membership appears in the graph AND the detached row. A self-parent is
// nonsense and adds no edge; a dangling parent id ghosts as missing, same
// as a dangling dep.
function buildDependencyGraph(cards, visibleIds) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  // A ghost placeholder from a dangling reference has no card behind it, so
  // "visible" must require actual existence — not just query-membership —
  // or an unfiltered board would wrongly treat a stale id as a real node.
  const isVisible = (id) => byId.has(id) && (!visibleIds || visibleIds.has(id));

  const nodes = cards.filter((c) => isVisible(c.id)).map((c) => cardToNode(c, isCardWaiting(c, byId)));
  const nodeIds = new Set(nodes.map((n) => n.id));

  const seenEdges = new Set();
  const edges = [];
  const ghostIds = new Set();
  // One shared endpoint-visibility rule for both edge kinds: drop when neither
  // endpoint is on screen, ghost a hidden-but-real endpoint, ghost a missing id.
  const addEdge = (from, to, kind) => {
    const key = `${from}->${to}:${kind}`;
    if (seenEdges.has(key)) return; // de-dupe a repeated entry
    const fromVisible = isVisible(from);
    const toVisible = isVisible(to);
    if (!fromVisible && !toVisible) return;
    seenEdges.add(key);
    if (!fromVisible) ghostIds.add(from);
    if (!toVisible) ghostIds.add(to);
    edges.push({ from, to, kind, fromGhost: !fromVisible, toGhost: !toVisible });
  };
  // The epic's color flows ALONG the
  // chain instead of fanning from every member. `nonTerminal` collects, per
  // epic, the members some OTHER member of the same epic waits on — their
  // work continues inside the epic, so they get no direct hop; only the
  // chain's terminals (nothing downstream inside the epic, a chainless
  // member being its own one-card chain) hop into the sink. Computed on the
  // FULL board, like waiting — a search filter must not reroute membership.
  const parentOf = (id) => {
    const card = byId.get(id);
    return card && card.parent != null && card.parent !== card.id ? card.parent : null;
  };
  const nonTerminal = new Set(); // `${epicId}:${memberId}`
  for (const c of cards) {
    if (parentOf(c.id) == null) continue;
    for (const depId of c.waiting_for || []) {
      if (parentOf(depId) === parentOf(c.id)) nonTerminal.add(`${parentOf(c.id)}:${depId}`);
    }
  }
  // Two passes: every dep edge lands before any membership edge, so the
  // sequencing-wins-the-pair check below sees the whole dep set — the epic's
  // own waiting_for lives on a DIFFERENT card than the child's parent field.
  // A dep edge between two members of the SAME epic is flagged `epicChain`
  // (set only when true, so edge shapes elsewhere stay untouched): the view
  // draws it solid orange — a real, gate-enforced dependency, tinted to show
  // whose work it carries. Mixed and cross-epic edges stay plain.
  for (const c of cards) {
    for (const depId of c.waiting_for || []) {
      addEdge(depId, c.id, 'dep');
      const e = edges[edges.length - 1];
      if (e && e.from === depId && e.to === c.id && parentOf(depId) != null && parentOf(depId) === parentOf(c.id)) {
        e.epicChain = true;
      }
    }
  }
  for (const c of cards) {
    // Membership edge, terminal member -> epic (the epic is the
    // sink; it closes last). `parent` is a single id; self-parent adds
    // nothing. When the pair already has a dep edge IN EITHER DIRECTION (the
    // card waits on its epic, or the epic waits on the card), sequencing
    // wins the pair: same-direction overlap would draw orange over grey and
    // hide a real dependency, and opposite-direction overlap would fabricate
    // a 2-cycle (a back-edge bow for a relation that isn't circular).
    if (c.parent != null && c.parent !== c.id
        && !nonTerminal.has(`${c.parent}:${c.id}`)
        && !seenEdges.has(`${c.parent}->${c.id}:dep`) && !seenEdges.has(`${c.id}->${c.parent}:dep`)) {
      addEdge(c.id, c.parent, 'epic');
    }
  }

  const ghosts = [...ghostIds].filter((id) => !nodeIds.has(id))
    .sort((a, b) => a - b)
    .map((id) => (byId.has(id) ? cardToNode(byId.get(id), isCardWaiting(byId.get(id), byId))
      : { id, title: null, status: null, archived: false, epic: false, priority: '', waiting: false, blocked: false, blockedReason: '', missing: true }));

  // The isolated row is keyed off SEQUENCING edges only, while the
  // layered graph lays out every node touched by ANY edge (`participants`) —
  // a node whose only edges are epic membership joins the graph and the row
  // both. Both derivations live here, in the pure module, so their different
  // kind-keying stays unit-pinned rather than re-derived in the view.
  const touchedByDep = new Set();
  const touchedByAny = new Set();
  for (const e of edges) {
    touchedByAny.add(e.from); touchedByAny.add(e.to);
    if (e.kind === 'dep') { touchedByDep.add(e.from); touchedByDep.add(e.to); }
  }
  const isolated = nodes.filter((n) => !touchedByDep.has(n.id)).map((n) => n.id);
  const participants = nodes.filter((n) => touchedByAny.has(n.id)).map((n) => n.id)
    .concat(ghosts.map((g) => g.id));

  return { nodes, edges, ghosts, isolated, participants };
}

// Assign a top-down layer index (0 = topmost / least-waited-on) to every id
// that participates in at least one edge, via Kahn's algorithm — with a
// deterministic cycle-break: when no remaining node has in-degree 0 (a
// cycle), force the lowest remaining id into the current layer rather than
// waiting forever for an in-degree that can never reach 0. `remaining`
// strictly shrinks by at least one id every outer-loop iteration (the normal
// path removes every ready node, the cycle-break path removes exactly one),
// so this always terminates in O(V+E) regardless of how many/how large the
// cycles are — the map must never hang on a cycle.
function layerNodes(nodeIds, edges) {
  const remaining = new Set(nodeIds);
  const inDegree = new Map(nodeIds.map((id) => [id, 0]));
  const successors = new Map(nodeIds.map((id) => [id, []]));
  for (const { from, to } of edges) {
    if (from === to) continue; // self-loop: no layering constraint, drawn separately as a back-edge
    if (!remaining.has(from) || !remaining.has(to)) continue;
    successors.get(from).push(to);
    inDegree.set(to, inDegree.get(to) + 1);
  }

  const layer = new Map();
  let current = 0;
  while (remaining.size) {
    let ready = [...remaining].filter((id) => inDegree.get(id) === 0);
    if (!ready.length) ready = [Math.min(...remaining)]; // break a cycle deterministically (lowest id)
    ready.sort((a, b) => a - b);
    for (const id of ready) { layer.set(id, current); remaining.delete(id); }
    for (const id of ready) {
      for (const succ of successors.get(id)) {
        if (remaining.has(succ)) inDegree.set(succ, inDegree.get(succ) - 1);
      }
    }
    current++;
  }
  return layer;
}

// "Dependency tree" (connected component) and "Dependency path"
// (directed cone) for the tree:<id> / path:<id> search terms. Both reuse
// buildDependencyGraph(cards, null).edges as their ONLY source of truth for
// adjacency — the exact edge set (waiting_for + membership, with its
// sequencing-wins-the-pair/nonTerminal suppression already applied) that the
// map draws. Neither function re-derives
// waiting_for/parent iteration.
//
// - treeIds: undirected flood-fill (the connected component) — "everything
//   this card's dependency web touches, in either direction."
// - pathIds: directed cone — everything transitively upstream (ancestors,
//   walking `to->from` backward) UNION everything transitively downstream
//   (descendants, walking `from->to` forward) UNION the card itself. A
//   sibling that shares an ancestor/descendant with the id but isn't itself
//   reachable FROM/TO the id is excluded — this is what makes path: a
//   narrower cone than tree:'s whole component.
//
// Both: unknown/non-numeric id -> empty Set (no error, by design);
// an isolated card (no edges at all) resolves to a one-element Set (itself);
// visited-set BFS makes both cycle-safe (never hangs, mirrors layerNodes'
// own cycle tolerance).
function buildAdjacency(cards) {
  const { edges } = buildDependencyGraph(cards, null);
  const forward = new Map(); // from -> Set(to)
  const backward = new Map(); // to -> Set(from)
  for (const { from, to } of edges) {
    if (!forward.has(from)) forward.set(from, new Set());
    forward.get(from).add(to);
    if (!backward.has(to)) backward.set(to, new Set());
    backward.get(to).add(from);
  }
  return { forward, backward };
}

function walkFrom(start, adjacency, visited) {
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adjacency.get(cur) || []) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
}

function treeIds(cards, rawId) {
  const id = Number(rawId);
  if (!cards.some((c) => c.id === id)) return new Set();
  const { forward, backward } = buildAdjacency(cards);
  const visited = new Set([id]);
  // Undirected: a single BFS over the union of both directions' neighbors
  // at each step reaches the whole component regardless of edge direction.
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    const neighbors = new Set([...(forward.get(cur) || []), ...(backward.get(cur) || [])]);
    for (const next of neighbors) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return visited;
}

function pathIds(cards, rawId) {
  const id = Number(rawId);
  if (!cards.some((c) => c.id === id)) return new Set();
  const { forward, backward } = buildAdjacency(cards);
  const visited = new Set([id]);
  walkFrom(id, forward, visited); // descendants (downstream)
  walkFrom(id, backward, visited); // ancestors (upstream)
  return visited;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildDependencyGraph, layerNodes, treeIds, pathIds };
} else {
  window.buildDependencyGraph = buildDependencyGraph;
  window.layerNodes = layerNodes;
  window.treeIds = treeIds;
  window.pathIds = pathIds;
}
