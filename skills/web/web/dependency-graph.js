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
// The one place a card's parent is resolved, so the map reads `parent` the way
// the outline does.
const NEST = (typeof module !== 'undefined' && module.exports)
  ? require('./nesting')
  : window;
// Which children end a family's sibling chain, for the parent lines the map draws.
const MAPREL = (typeof module !== 'undefined' && module.exports)
  ? require('./map-relations')
  : window;

// The node carries precomputed gate flags:
// `waiting` (some waiting_for dep not done — the amber stroke) and `blocked`
// (the manual sticker — the red pill), with `blockedReason` riding along for
// the pill's tooltip.
function cardToNode(c, waiting) {
  return {
    id: c.id, title: c.title, status: c.status, archived: !!c.archived,
    priority: c.priority || '', waiting: !!waiting,
    blocked: WB.isBlockedValue(c.blocked), blockedReason: WB.blockedReason(c.blocked),
    prompt: c.prompt || null, // lets the map label fall back to it (cardTitleDisplay)
  };
}

// The stub for an id no card answers to: a stale waiting_for or parent.
function missingNode(id) {
  return { id, title: null, status: null, archived: false, priority: '', waiting: false, blocked: false, blockedReason: '', missing: true };
}

// Same derived-waiting rule as the board's own isWaiting() (app.js) — both
// are thin wrappers over the shared unresolvedWaits; byId is the caller's
// own full active+archived lookup (waiting is location-independent).
function isCardWaiting(c, byId) {
  return WB.unresolvedWaits(c.waiting_for, byId).length > 0;
}

// Build the node/edge/ghost-stub set for the dependency edges from the full card list
// (active + archived — waiting is location-independent, same as the board's
// own isWaiting() check) and the ids currently matching the search box
// (`visibleIds`: a Set, or null/undefined meaning "no active query — every
// card is visible", mirroring search.js's own "empty query matches
// everything"). `ctx` is the nesting context ({ board }), which reads a parent
// written as this board's own name. The map draws buildRelationsGraph (below),
// whose No relations row is not this `isolated` list; the tree: and path: terms
// walk this edge set.
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
// Parent edges: a child card's `parent: <parent-id>`
// becomes a child->parent edge with `kind: 'parent'` (waiting_for edges carry
// `kind: 'dep'`). The parent lays out BELOW its children, not above them: under
// the map's "down = completes later" convention a parent is the end of the work
// under it, and above them it read as a false prerequisite. Its status is still
// the human's call. Nesting is not sequencing: it feeds the layered layout
// and gets the same ghost-stub courtesy, but it never makes anyone `waiting`
// and — deliberately — does NOT count for the isolated row. "No
// dependencies" means no SEQUENCING deps, so a parent whose only edges are
// parent edges appears in the graph AND the detached row. A self-parent is
// nonsense and adds no edge; a dangling parent id ghosts as missing, same
// as a dangling dep.
function buildDependencyGraph(cards, visibleIds, ctx) {
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
  // Parent edges run ALONG a chain of children instead of fanning from every
  // child. `nonTerminal` collects, per parent, the children some OTHER child of
  // the same parent waits on — their work continues inside the parent, so they
  // get no direct edge; only the chain's terminals (nothing downstream inside
  // the parent, a chainless child being its own one-card chain) get one into
  // the parent. Computed on the FULL board, like waiting — a search filter must
  // not reroute parent edges.
  const parentOf = (id) => {
    const card = byId.get(id);
    const parent = card ? NEST.localParentId(card, ctx) : null;
    return parent !== null && parent !== card.id ? parent : null;
  };
  const nonTerminal = new Set(); // `${parentId}:${childId}`
  for (const c of cards) {
    if (parentOf(c.id) == null) continue;
    for (const depId of c.waiting_for || []) {
      if (parentOf(depId) === parentOf(c.id)) nonTerminal.add(`${parentOf(c.id)}:${depId}`);
    }
  }
  // Two passes: every dep edge lands before any parent edge, so the
  // sequencing-wins-the-pair check below sees the whole dep set — the parent's
  // own waiting_for lives on a DIFFERENT card than the child's parent field.
  // A dep edge between two children of the SAME parent is flagged `siblingChain`
  // (set only when true, so edge shapes elsewhere stay untouched) — it's
  // still a real, gate-enforced dependency, just one the map draws exactly
  // like any other edge (no special treatment). Mixed and cross-parent edges
  // stay plain too.
  for (const c of cards) {
    for (const depId of c.waiting_for || []) {
      addEdge(depId, c.id, 'dep');
      const e = edges[edges.length - 1];
      if (e && e.from === depId && e.to === c.id && parentOf(depId) != null && parentOf(depId) === parentOf(c.id)) {
        e.siblingChain = true;
      }
    }
  }
  for (const c of cards) {
    // Parent edge, terminal child -> parent (a parent lays out below its
    // children). A parent on another board adds no edge; self-parent adds
    // nothing. When the pair already has a dep edge IN EITHER DIRECTION (the
    // card waits on its parent, or the parent waits on the card), sequencing
    // wins the pair: same-direction overlap would add a redundant second
    // edge over a real dependency, and opposite-direction overlap would
    // fabricate a 2-cycle (a back-edge bow for a relation that isn't
    // circular).
    const parent = parentOf(c.id);
    if (parent !== null
        && !nonTerminal.has(`${parent}:${c.id}`)
        && !seenEdges.has(`${parent}->${c.id}:dep`) && !seenEdges.has(`${c.id}->${parent}:dep`)) {
      addEdge(c.id, parent, 'parent');
    }
  }

  const ghosts = [...ghostIds].filter((id) => !nodeIds.has(id))
    .sort((a, b) => a - b)
    .map((id) => (byId.has(id) ? cardToNode(byId.get(id), isCardWaiting(byId.get(id), byId))
      : missingNode(id)));

  // The isolated row is keyed off SEQUENCING edges only, while the
  // layered graph lays out every node touched by ANY edge (`participants`) —
  // a node whose only edges are parent edges joins the graph and the row
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
// adjacency — the exact edge set (waiting_for + parent edges, with its
// sequencing-wins-the-pair/nonTerminal suppression already applied) that the
// map's graph is built from (parent edges shape layout but draw no line).
// Neither function re-derives waiting_for/parent iteration.
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
function buildAdjacency(cards, ctx) {
  const { edges } = buildDependencyGraph(cards, null, ctx);
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

function treeIds(cards, rawId, ctx) {
  const id = Number(rawId);
  if (!cards.some((c) => c.id === id)) return new Set();
  const { forward, backward } = buildAdjacency(cards, ctx);
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

function pathIds(cards, rawId, ctx) {
  const id = Number(rawId);
  if (!cards.some((c) => c.id === id)) return new Set();
  const { forward, backward } = buildAdjacency(cards, ctx);
  const visited = new Set([id]);
  walkFrom(id, forward, visited); // descendants (downstream)
  walkFrom(id, backward, visited); // ancestors (upstream)
  return visited;
}

// Every relation the map can draw, for the cards in `visibleIds` (null = all):
// the dependency edges of buildDependencyGraph, plus one pair per immediate
// parent and child, never a grandparent and grandchild. Pairs are not parent
// edges: map-relations.js decides which become lines and how they shape the
// layout. A pair keeps an edge's ghost-stub courtesy (a hidden end is a dimmed
// stub, an id with no card a "not found" one) and a parent on another board is
// one stub per mention, with an id below zero that no card can have. `ends`
// (see mapParentLineEnds) is read on the whole board, so a filter never moves a
// line; a pair into a stub has none.
function buildRelationsGraph(cards, visibleIds, ctx) {
  const base = buildDependencyGraph(cards, visibleIds, ctx);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const isVisible = (id) => byId.has(id) && (!visibleIds || visibleIds.has(id));
  const members = [];
  for (const c of cards) {
    const parent = NEST.localParentId(c, ctx);
    if (parent !== null && parent !== c.id && byId.has(parent)) members.push({ id: c.id, parent, waitsOn: c.waiting_for });
  }
  const ends = MAPREL.mapParentLineEnds(members);

  const ghosts = base.ghosts.slice();
  const ghostIds = new Set(ghosts.map((g) => g.id));
  const ensureGhost = (id) => {
    if (isVisible(id) || ghostIds.has(id)) return;
    ghostIds.add(id);
    const card = byId.get(id);
    ghosts.push(card ? cardToNode(card, isCardWaiting(card, byId)) : missingNode(id));
  };
  const external = new Map();
  const externalStub = (ref) => {
    if (!external.has(ref)) {
      const id = -(external.size + 1);
      external.set(ref, id);
      ghosts.push(Object.assign(missingNode(id), { external: ref }));
    }
    return external.get(ref);
  };

  const pairs = [];
  for (const c of cards) {
    const parsed = NEST.parseParent(c.parent, ctx && ctx.board);
    if (!parsed || (parsed.local && parsed.id === c.id)) continue;
    if (!parsed.local) {
      if (isVisible(c.id)) pairs.push({ child: c.id, parent: externalStub(`${parsed.board}#${parsed.id}`), ends: null });
      continue;
    }
    if (!isVisible(c.id) && !isVisible(parsed.id)) continue;
    ensureGhost(c.id);
    ensureGhost(parsed.id);
    pairs.push({ child: c.id, parent: parsed.id, ends: ends.get(c.id) || null });
  }
  return { nodes: base.nodes, ghosts, edges: base.edges.filter((e) => e.kind === 'dep'), pairs };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildDependencyGraph, buildRelationsGraph, layerNodes, treeIds, pathIds };
} else {
  window.buildDependencyGraph = buildDependencyGraph;
  window.buildRelationsGraph = buildRelationsGraph;
  window.layerNodes = layerNodes;
  window.treeIds = treeIds;
  window.pathIds = pathIds;
}
