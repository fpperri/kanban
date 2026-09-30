const { test } = require('node:test');
const assert = require('node:assert');
const { buildDependencyGraph, layerNodes, treeIds, pathIds } = require('../web/dependency-graph');

// --- buildDependencyGraph ---------------------------------------------------

const CARDS = [
  { id: 1, title: 'Root A', status: 'done', waiting_for: [], archived: false },
  { id: 2, title: 'Blocked by 1', status: 'todo', waiting_for: [1], archived: false },
  { id: 3, title: 'Blocked by 2', status: 'doing', waiting_for: [2], archived: false },
  { id: 4, title: 'Isolated', status: 'backlog', waiting_for: [], archived: false },
  { id: 5, title: 'Archived blocker', status: 'done', waiting_for: [], archived: true },
  { id: 6, title: 'Blocked by archived', status: 'todo', waiting_for: [5], archived: false },
];

test('no active filter (visibleIds null): every card is a full node, every waiting_for is a plain edge, no ghosts', () => {
  const g = buildDependencyGraph(CARDS, null);
  assert.deepStrictEqual(g.nodes.map((n) => n.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(
    g.edges.map((e) => [e.from, e.to]).sort(),
    [[1, 2], [2, 3], [5, 6]].sort(),
  );
  assert.ok(g.edges.every((e) => !e.fromGhost && !e.toGhost));
  assert.deepStrictEqual(g.ghosts, []);
  assert.deepStrictEqual(g.isolated, [4]);
});

test('archived cards are included as full nodes (archive is a location, not exclusion — matches board isWaiting semantics)', () => {
  const g = buildDependencyGraph(CARDS, null);
  const five = g.nodes.find((n) => n.id === 5);
  assert.ok(five);
  assert.strictEqual(five.archived, true);
});

test('nodes carry the epic flag as a boolean — set, unset, and ghost stubs alike', () => {
  const cards = [
    { id: 1, title: 'Epic Root', status: 'todo', waiting_for: [], archived: false, epic: true },
    { id: 2, title: 'Plain', status: 'todo', waiting_for: [1, 9], archived: false },
  ];
  const g = buildDependencyGraph(cards, null);
  assert.strictEqual(g.nodes.find((n) => n.id === 1).epic, true);
  assert.strictEqual(g.nodes.find((n) => n.id === 2).epic, false, 'missing flag defaults false, always a boolean');
  // A hidden epic ghosts with its flag (buildMapSvg dims it either way); a
  // dangling-id stub has no card behind it — never epic.
  const filtered = buildDependencyGraph(cards, new Set([2]));
  assert.strictEqual(filtered.ghosts.find((gh) => gh.id === 1).epic, true);
  assert.strictEqual(filtered.ghosts.find((gh) => gh.id === 9).epic, false);
});

test('nodes carry the raw priority string, defaulting to "" when unset — classification into high/low stays app.js\'s job (priorityBadge)', () => {
  const cards = [
    { id: 1, title: 'Hot', status: 'todo', waiting_for: [], archived: false, priority: 'High' },
    { id: 2, title: 'No priority set', status: 'todo', waiting_for: [], archived: false },
  ];
  const g = buildDependencyGraph(cards, null);
  assert.strictEqual(g.nodes.find((n) => n.id === 1).priority, 'High');
  assert.strictEqual(g.nodes.find((n) => n.id === 2).priority, '', 'missing priority defaults to the empty string, always a string');
});

test('nodes carry a computed `waiting` boolean — true only while a waiting_for target is not done (mirrors app.js isWaiting())', () => {
  const cards = [
    { id: 1, title: 'Not done dep', status: 'todo', waiting_for: [], archived: false },
    { id: 2, title: 'Done dep', status: 'done', waiting_for: [], archived: false },
    { id: 3, title: 'Waiting on 1 (not done)', status: 'todo', waiting_for: [1], archived: false },
    { id: 4, title: 'Waiting only on 2 (done)', status: 'todo', waiting_for: [2], archived: false },
    { id: 5, title: 'No deps', status: 'todo', waiting_for: [], archived: false },
  ];
  const g = buildDependencyGraph(cards, null);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  assert.strictEqual(byId.get(3).waiting, true, 'waiting on a not-done card');
  assert.strictEqual(byId.get(4).waiting, false, 'its only dep is done — no waiting treatment left');
  assert.strictEqual(byId.get(5).waiting, false, 'no waiting_for at all');
});

test('nodes carry the manual sticker as `blocked` + `blockedReason` — the shared predicate, not the edges', () => {
  const cards = [
    { id: 1, title: 'Stickered', status: 'todo', waiting_for: [], archived: false, blocked: 'legal sign-off pending' },
    { id: 2, title: 'Bare true', status: 'todo', waiting_for: [], archived: false, blocked: 'true' },
    { id: 3, title: 'Cleared', status: 'todo', waiting_for: [], archived: false, blocked: 'false' },
    { id: 4, title: 'Junk', status: 'todo', waiting_for: [], archived: false, blocked: '!!!' },
    { id: 5, title: 'No sticker', status: 'todo', waiting_for: [], archived: false },
  ];
  const g = buildDependencyGraph(cards, null);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  assert.strictEqual(byId.get(1).blocked, true);
  assert.strictEqual(byId.get(1).blockedReason, 'legal sign-off pending');
  assert.strictEqual(byId.get(2).blocked, true, 'YAML true — blocked, reason unspecified');
  assert.strictEqual(byId.get(2).blockedReason, '');
  assert.strictEqual(byId.get(3).blocked, false, 'YAML false — not blocked');
  assert.strictEqual(byId.get(4).blocked, false, 'no alphanumeric character — not a valid sticker');
  assert.strictEqual(byId.get(5).blocked, false);
  assert.strictEqual(byId.get(1).waiting, false, 'the sticker never leaks into the waiting flag');
});

test('a hidden dep still resolves `waiting` on the visible waiting card, same as isWaiting() — waiting is location/visibility-independent', () => {
  const cards = [
    { id: 1, title: 'Hidden dep', status: 'todo', waiting_for: [], archived: false },
    { id: 2, title: 'Waiting on 1', status: 'todo', waiting_for: [1], archived: false },
  ];
  const g = buildDependencyGraph(cards, new Set([2])); // 1 is hidden by the filter, ghosts in
  assert.strictEqual(g.nodes.find((n) => n.id === 2).waiting, true, 'the visible card still reads waiting even though its dep is only a ghost');
});

test('a ghost stub for a real (non-dangling) card carries its priority and waiting flag too — only the fully-missing stub defaults both', () => {
  const cards = [
    { id: 1, title: 'Hidden hot dep', status: 'todo', waiting_for: [], archived: false, priority: 'High' },
    { id: 2, title: 'Visible, waiting on 1', status: 'todo', waiting_for: [1], archived: false },
  ];
  const g = buildDependencyGraph(cards, new Set([2]));
  const ghost1 = g.ghosts.find((gh) => gh.id === 1);
  assert.strictEqual(ghost1.priority, 'High');
  assert.strictEqual(ghost1.waiting, false, 'card 1 has no waiting_for of its own');
});

test('a hidden BLOCKER (search hides card 1, keeps 2/3/4) becomes a dimmed ghost stub; the edge is kept, not dropped', () => {
  const visible = new Set([2, 3, 4]);
  const g = buildDependencyGraph(CARDS, visible);
  assert.deepStrictEqual(g.nodes.map((n) => n.id).sort((a, b) => a - b), [2, 3, 4]);
  const edge12 = g.edges.find((e) => e.from === 1 && e.to === 2);
  assert.ok(edge12, 'edge to the hidden blocker survives as a stub edge, not dropped');
  assert.strictEqual(edge12.fromGhost, true);
  assert.strictEqual(edge12.toGhost, false);
  const ghost1 = g.ghosts.find((gh) => gh.id === 1);
  assert.ok(ghost1);
  assert.strictEqual(ghost1.title, 'Root A');
  assert.strictEqual(ghost1.missing, undefined);
});

test('a hidden BLOCKED card also becomes a ghost stub (symmetric — the courtesy is not one-directional)', () => {
  // visible = {1, 4}: card 2 (blocked by 1) is hidden.
  const g = buildDependencyGraph(CARDS, new Set([1, 4]));
  const edge12 = g.edges.find((e) => e.from === 1 && e.to === 2);
  assert.ok(edge12);
  assert.strictEqual(edge12.fromGhost, false);
  assert.strictEqual(edge12.toGhost, true);
  assert.ok(g.ghosts.find((gh) => gh.id === 2));
});

test('an edge with NEITHER endpoint visible is dropped entirely, not rendered as a double-ghost floating edge', () => {
  // visible = {2, 3, 4}: edge 5 -> 6 has neither endpoint visible.
  const g = buildDependencyGraph(CARDS, new Set([2, 3, 4]));
  assert.strictEqual(g.edges.some((e) => e.from === 5 && e.to === 6), false);
  assert.strictEqual(g.ghosts.some((gh) => gh.id === 5), false);
  assert.strictEqual(g.ghosts.some((gh) => gh.id === 6), false);
});

test('clearing the search (visibleIds null) restores the full graph, including previously-dropped edges', () => {
  const filtered = buildDependencyGraph(CARDS, new Set([2, 3, 4]));
  assert.strictEqual(filtered.edges.some((e) => e.from === 5 && e.to === 6), false);
  const cleared = buildDependencyGraph(CARDS, null);
  assert.ok(cleared.edges.some((e) => e.from === 5 && e.to === 6));
});

test('a stale/dangling waiting_for id (references a card that no longer exists) still gets a ghost stub, marked missing', () => {
  const cards = [{ id: 10, title: 'Orphan blocker ref', status: 'todo', waiting_for: [999], archived: false }];
  const g = buildDependencyGraph(cards, null);
  assert.strictEqual(g.edges.length, 1);
  assert.deepStrictEqual(g.edges[0], { from: 999, to: 10, kind: 'dep', fromGhost: true, toGhost: false });
  assert.deepStrictEqual(g.ghosts, [{ id: 999, title: null, status: null, archived: false, epic: false, priority: '', waiting: false, blocked: false, blockedReason: '', missing: true }]); // epic joined the node shape; priority/waiting joined it; blocked/blockedReason = the manual sticker
});

test('a duplicate waiting_for entry collapses to a single edge', () => {
  const cards = [
    { id: 1, title: 'A', status: 'done', waiting_for: [], archived: false },
    { id: 2, title: 'B', status: 'todo', waiting_for: [1, 1], archived: false },
  ];
  const g = buildDependencyGraph(cards, null);
  assert.strictEqual(g.edges.length, 1);
});

test('a card with no dependencies in either direction is isolated', () => {
  const g = buildDependencyGraph(CARDS, null);
  assert.deepStrictEqual(g.isolated, [4]);
});

// Reported bug — "a card not blocked by anyone but that BLOCKS
// others may land in the map's 'No dependencies' row instead of the graph."
// Investigated: the isolation predicate (touchedIds, above) adds BOTH e.from
// and e.to for every surviving edge, so a blocker with an empty waiting_for
// (card 1, "Root A") is touched — and therefore never isolated — the instant
// it has ANY outgoing edge, full stop; it doesn't matter whether the blocked
// endpoint is itself visible, ghosted, or (per the two cases below) hidden by
// a status-filter/search composition. Exhaustively verified over every
// subset of CARDS' visibleIds (64 combinations) plus 500 randomized graphs
// composed through the real mapFilterVisibleIds + intersectVisibleIds
// pipeline (column-state.js): no composition reproduces the report. This
// pins the correct behavior rather than a bug fix; no product code changed.
test('an unblocked card (empty waiting_for) that blocks another card is NEVER isolated — even when the filter hides every card it blocks, ghost-stubbing them instead', () => {
  // visible = {1, 4}: hides 2 (directly blocked by 1) and 3 (transitively).
  const g = buildDependencyGraph(CARDS, new Set([1, 4]));
  assert.ok(g.nodes.some((n) => n.id === 1), 'the blocker itself is still a real graph node');
  assert.strictEqual(g.isolated.includes(1), false, 'must never fall into the detached "No dependencies" row');
  const edge12 = g.edges.find((e) => e.from === 1 && e.to === 2);
  assert.ok(edge12, 'its outgoing edge survives as a ghost-stub edge, not dropped');
  assert.strictEqual(edge12.toGhost, true);
  assert.ok(g.ghosts.find((gh) => gh.id === 2), 'the hidden blocked card ghosts in — it does not orphan the blocker');
});

test('archived blocker variant: card 5 blocks archived-adjacent card 6; hiding 6 alone still keeps 5 out of isolated', () => {
  // visible = {1, 4, 5}: hides 2, 3, 6 — 5's only edge (5 -> 6) is now a ghost stub.
  const g = buildDependencyGraph(CARDS, new Set([1, 4, 5]));
  assert.strictEqual(g.isolated.includes(5), false);
  const edge56 = g.edges.find((e) => e.from === 5 && e.to === 6);
  assert.ok(edge56);
  assert.strictEqual(edge56.toGhost, true);
});

test('a self-referencing waiting_for (a card blocking itself) is not reported isolated — it does have an edge, just a degenerate one', () => {
  const cards = [{ id: 7, title: 'Self-blocked', status: 'todo', waiting_for: [7], archived: false }];
  const g = buildDependencyGraph(cards, null);
  assert.deepStrictEqual(g.edges, [{ from: 7, to: 7, kind: 'dep', fromGhost: false, toGhost: false }]);
  assert.deepStrictEqual(g.isolated, []);
});

test('an empty card list yields an empty graph, no throw', () => {
  assert.deepStrictEqual(buildDependencyGraph([], null), { nodes: [], edges: [], ghosts: [], isolated: [], participants: [] });
});

// --- layerNodes --------------------------------------------------------------

test('layerNodes on a simple chain assigns strictly increasing layers root to leaf', () => {
  const layer = layerNodes([1, 2, 3], [{ from: 1, to: 2 }, { from: 2, to: 3 }]);
  assert.strictEqual(layer.get(1), 0);
  assert.strictEqual(layer.get(2), 1);
  assert.strictEqual(layer.get(3), 2);
});

test('layerNodes on a diamond (1 blocks 2 and 3, both block 4) puts 4 after both its blockers', () => {
  const layer = layerNodes([1, 2, 3, 4], [
    { from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 3, to: 4 },
  ]);
  assert.strictEqual(layer.get(1), 0);
  assert.strictEqual(layer.get(2), 1);
  assert.strictEqual(layer.get(3), 1);
  assert.strictEqual(layer.get(4), 2);
});

test('layerNodes on an unconnected node (no edges at all) assigns layer 0 without throwing', () => {
  const layer = layerNodes([1], []);
  assert.strictEqual(layer.get(1), 0);
});

test('layerNodes on a 2-cycle (1 blocks 2, 2 blocks 1) terminates and assigns every node a layer — does not hang', () => {
  const layer = layerNodes([1, 2], [{ from: 1, to: 2 }, { from: 2, to: 1 }]);
  assert.strictEqual(layer.size, 2);
  assert.strictEqual(layer.get(1), 0); // deterministic cycle-break picks the lowest remaining id
  assert.strictEqual(layer.get(2), 1);
});

test('layerNodes on a 3-node cycle (1->2->3->1) terminates with three distinct layers — does not hang', () => {
  const layer = layerNodes([1, 2, 3], [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 1 }]);
  assert.strictEqual(layer.size, 3);
  assert.deepStrictEqual([...layer.values()].sort((a, b) => a - b), [0, 1, 2]);
});

test('layerNodes on a self-loop-only node assigns layer 0 (the loop imposes no ordering constraint)', () => {
  const layer = layerNodes([1], [{ from: 1, to: 1 }]);
  assert.strictEqual(layer.get(1), 0);
});

test('layerNodes on a larger graph with an embedded cycle still terminates and layers every node', () => {
  // 1 -> 2 -> 3 -> 2 (cycle between 2/3), and 1 -> 4 (a separate clean branch).
  const layer = layerNodes([1, 2, 3, 4], [
    { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 2 }, { from: 1, to: 4 },
  ]);
  assert.strictEqual(layer.size, 4);
  assert.strictEqual(layer.get(1), 0);
  assert.ok(layer.get(2) < layer.get(3) || layer.get(3) < layer.get(2)); // both assigned, some order
});

// --- epic membership edges (children carry `parent: <epic-id>`) ----

const epicBoard = [
  { id: 10, title: 'the epic', status: 'doing', epic: true, waiting_for: [] },
  { id: 11, title: 'child a', status: 'todo', parent: 10, waiting_for: [] },
  { id: 12, title: 'child b', status: 'todo', parent: 10, waiting_for: [11] },
];

test('only TERMINAL members hop to the epic — the chain flows card to card, one dashed edge into the sink', () => {
  // 11 -> 12 is the chain; 12 is the terminal (no member waits on it), so
  // only 12 hops to the epic. 11's work reaches the epic THROUGH the chain.
  const g = buildDependencyGraph(epicBoard, null);
  const epicEdges = g.edges.filter((e) => e.kind === 'epic');
  assert.deepStrictEqual(epicEdges.map((e) => `${e.from}->${e.to}`), ['12->10']);
  const depEdges = g.edges.filter((e) => e.kind === 'dep');
  assert.deepStrictEqual(depEdges.map((e) => `${e.from}->${e.to}`), ['11->12']);
});

test('an intra-epic dep edge is flagged epicChain (both endpoints share the parent); mixed edges are not', () => {
  const g = buildDependencyGraph([
    { id: 10, title: 'epic', status: 'doing', epic: true, waiting_for: [] },
    { id: 11, title: 'member a', status: 'todo', parent: 10, waiting_for: [] },
    { id: 12, title: 'member b', status: 'todo', parent: 10, waiting_for: [11, 30] },
    { id: 30, title: 'outsider', status: 'todo', waiting_for: [11] },
  ], null);
  const flags = Object.fromEntries(g.edges.filter((e) => e.kind === 'dep').map((e) => [`${e.from}->${e.to}`, !!e.epicChain]));
  assert.deepStrictEqual(flags, {
    '11->12': true,   // member -> member, same epic: the chain wears the color
    '30->12': false,  // outsider -> member: plain grey
    '11->30': false,  // member -> outsider: plain grey
  });
});

test('a chainless member is its own terminal — it keeps a direct membership hop, nothing orphans silently', () => {
  const g = buildDependencyGraph([
    { id: 10, title: 'epic', status: 'doing', epic: true, waiting_for: [] },
    { id: 11, title: 'stray note', status: 'todo', parent: 10, waiting_for: [] },
  ], null);
  assert.deepStrictEqual(g.edges.map((e) => `${e.from}->${e.to}:${e.kind}`), ['11->10:epic']);
});

test('terminality is computed on the FULL board — a search-hidden downstream member still absorbs the upstream hop', () => {
  // 12 (hidden) waits on 11: 11 is NOT terminal even though its downstream is filtered out.
  const g = buildDependencyGraph(epicBoard, new Set([10, 11]));
  const epicEdges = g.edges.filter((e) => e.kind === 'epic');
  assert.deepStrictEqual(epicEdges.map((e) => `${e.from}->${e.to}:${e.fromGhost}`), ['12->10:true']);
});

test('an epic with only membership edges joins the graph AND stays in the no-dependencies row — isolated is keyed off dep edges only', () => {
  const g = buildDependencyGraph(epicBoard, null);
  // the epic participates in edges, so the layered graph will lay it out...
  assert.ok(g.edges.some((e) => e.to === 10));
  // ...but "No dependencies" means no SEQUENCING deps, so it still lists there
  assert.deepStrictEqual(g.isolated, [10]);
  // the children ride dep edges (11->12), so neither is isolated
  assert.ok(!g.isolated.includes(11) && !g.isolated.includes(12));
});

test('parent does not make anyone waiting — membership is not sequencing', () => {
  const g = buildDependencyGraph(epicBoard, null);
  const epicNode = g.nodes.find((n) => n.id === 10);
  const childA = g.nodes.find((n) => n.id === 11);
  assert.strictEqual(epicNode.waiting, false);
  assert.strictEqual(childA.waiting, false); // parent: 10 (not done) imposes nothing
  const childB = g.nodes.find((n) => n.id === 12);
  assert.strictEqual(childB.waiting, true); // waiting_for: [11] still does
});

test('a dangling parent id renders a missing ghost stub, same courtesy as waiting_for', () => {
  const g = buildDependencyGraph([{ id: 5, title: 'orphan', status: 'todo', parent: 99, waiting_for: [] }], null);
  assert.deepStrictEqual(g.ghosts.map((gh) => [gh.id, gh.missing]), [[99, true]]);
  assert.deepStrictEqual(g.edges.map((e) => `${e.from}->${e.to}:${e.kind}:${e.toGhost}`), ['5->99:epic:true']);
});

test('a search-hidden epic ghosts into its visible terminal\'s graph', () => {
  const g = buildDependencyGraph(epicBoard, new Set([12])); // 12 is the terminal; epic 10 hidden
  assert.deepStrictEqual(g.edges.filter((e) => e.kind === 'epic').map((e) => `${e.from}->${e.to}:${e.toGhost}`), ['12->10:true']);
  assert.ok(g.ghosts.some((gh) => gh.id === 10 && !gh.missing));
});

test('layerNodes puts the epic BELOW its children — the epic closes last, so it sinks', () => {
  const g = buildDependencyGraph(epicBoard, null);
  const ids = new Set(); g.edges.forEach((e) => { ids.add(e.from); ids.add(e.to); });
  const layer = layerNodes([...ids], g.edges);
  assert.ok(layer.get(10) > layer.get(11) && layer.get(10) > layer.get(12));
});

test('a self-parent adds no edge (nonsense membership); parent null/absent adds nothing', () => {
  const g = buildDependencyGraph([
    { id: 1, title: 'plain', status: 'todo', waiting_for: [] },
    { id: 2, title: 'self', status: 'todo', parent: 2, waiting_for: [] },
  ], null);
  assert.deepStrictEqual(g.edges, []);
  assert.deepStrictEqual(g.isolated, [1, 2]);
});

test('sequencing wins the UNORDERED pair: a dep edge between child and epic in either direction suppresses the membership edge', () => {
  // child waits on its epic — opposite-direction overlap would fabricate a 2-cycle
  const a = buildDependencyGraph([
    { id: 10, title: 'epic', status: 'doing', epic: true, waiting_for: [] },
    { id: 11, title: 'child+dep', status: 'todo', parent: 10, waiting_for: [10] },
  ], null);
  assert.deepStrictEqual(a.edges.map((e) => `${e.from}->${e.to}:${e.kind}`), ['10->11:dep']);
  // epic waits on its child (the natural wayfinder shape) — same-direction
  // overlap would draw orange over grey. Cross-card: the dep lives on the
  // EPIC's waiting_for, the membership on the CHILD's parent — the two-pass
  // edge build is what lets this suppression see it.
  const b = buildDependencyGraph([
    { id: 10, title: 'epic', status: 'doing', epic: true, waiting_for: [11] },
    { id: 11, title: 'child', status: 'todo', parent: 10, waiting_for: [] },
  ], null);
  assert.deepStrictEqual(b.edges.map((e) => `${e.from}->${e.to}:${e.kind}`), ['11->10:dep']);
});

test('participants: any-edge-touched nodes + ghosts, in the pure module — epic in both participants and isolated', () => {
  const g = buildDependencyGraph([
    { id: 10, title: 'epic', status: 'doing', epic: true, waiting_for: [] },
    { id: 11, title: 'child', status: 'todo', parent: 10, waiting_for: [] },
    { id: 12, title: 'loner', status: 'todo', waiting_for: [] },
  ], null);
  assert.deepStrictEqual(g.participants, [10, 11]);
  assert.deepStrictEqual(g.isolated, [10, 11, 12]); // no dep edges anywhere — all three
});

// --- treeIds (connected component) / pathIds (directed cone) -------

test('treeIds: an isolated card (no edges) is a component of one — itself', () => {
  assert.deepStrictEqual(treeIds(CARDS, 4), new Set([4]));
});

test('pathIds: an isolated card (no edges) is a cone of one — itself', () => {
  assert.deepStrictEqual(pathIds(CARDS, 4), new Set([4]));
});

test('treeIds/pathIds: an unknown id matches nothing — empty set, no error', () => {
  assert.deepStrictEqual(treeIds(CARDS, 999), new Set());
  assert.deepStrictEqual(pathIds(CARDS, 999), new Set());
});

test('treeIds/pathIds: non-numeric garbage id also resolves to an empty set, no throw', () => {
  assert.deepStrictEqual(treeIds(CARDS, 'abc'), new Set());
  assert.deepStrictEqual(pathIds(CARDS, 'abc'), new Set());
});

test('treeIds/pathIds accept a numeric-string id (as tree:<id>/path:<id> pass through from search.js), same result as a number', () => {
  assert.deepStrictEqual(treeIds(CARDS, '3'), treeIds(CARDS, 3));
  assert.deepStrictEqual(pathIds(CARDS, '3'), pathIds(CARDS, 3));
});

test('treeIds: the whole chain 1->2->3 is one component from any member', () => {
  assert.deepStrictEqual(treeIds(CARDS, 1), new Set([1, 2, 3]));
  assert.deepStrictEqual(treeIds(CARDS, 2), new Set([1, 2, 3]));
  assert.deepStrictEqual(treeIds(CARDS, 3), new Set([1, 2, 3]));
});

test('treeIds spans an archived member — archive is a location, not exclusion, same as buildDependencyGraph', () => {
  assert.deepStrictEqual(treeIds(CARDS, 6), new Set([5, 6]));
});

test('cone vs component divergence: pathIds excludes a sibling branch that tree includes (a fork with no directed relation to the id)', () => {
  const fork = [
    { id: 1, title: 'root', status: 'done', waiting_for: [] },
    { id: 2, title: 'branch B', status: 'todo', waiting_for: [1] },
    { id: 3, title: 'branch C', status: 'todo', waiting_for: [1] },
  ];
  // treeIds(2): the whole component, including sibling branch C.
  assert.deepStrictEqual(treeIds(fork, 2), new Set([1, 2, 3]));
  // pathIds(2): only 2's own ancestors (1) — sibling 3 is neither upstream
  // nor downstream of 2, so the cone excludes it.
  assert.deepStrictEqual(pathIds(fork, 2), new Set([1, 2]));
});

test('pathIds: membership edge direction — the epic sink is downstream of a member (walking forward from the member reaches its epic)', () => {
  // epicBoard: 11 -> 12 (dep), 12 -> 10 (epic, terminal-only hop)
  assert.deepStrictEqual(pathIds(epicBoard, 11), new Set([11, 12, 10]));
});

test('pathIds on an epic pulls in all member chains upstream (walking backward from the epic reaches every member transitively)', () => {
  assert.deepStrictEqual(pathIds(epicBoard, 10), new Set([10, 12, 11]));
});

test('treeIds on an epic is the same whole component as any member (undirected)', () => {
  assert.deepStrictEqual(treeIds(epicBoard, 10), new Set([10, 11, 12]));
});

test('pathIds/treeIds respect membership-edge suppression — a suppressed membership edge (sequencing wins the pair) never appears in traversal', () => {
  const board = [
    { id: 10, title: 'epic', status: 'doing', epic: true, waiting_for: [] },
    { id: 11, title: 'child+dep', status: 'todo', parent: 10, waiting_for: [10] },
    { id: 20, title: 'unrelated', status: 'todo', waiting_for: [] },
  ];
  // Only the dep edge 10->11 survives (the membership edge is suppressed);
  // 20 shares no edge with either, so it's excluded from both traversals.
  assert.deepStrictEqual(treeIds(board, 10), new Set([10, 11]));
  assert.deepStrictEqual(pathIds(board, 11), new Set([11, 10]));
});

test('treeIds/pathIds tolerate a cycle without hanging (2-cycle via waiting_for)', () => {
  const cyclic = [
    { id: 1, title: 'A', status: 'todo', waiting_for: [2] },
    { id: 2, title: 'B', status: 'todo', waiting_for: [1] },
  ];
  assert.deepStrictEqual(treeIds(cyclic, 1), new Set([1, 2]));
  assert.deepStrictEqual(pathIds(cyclic, 1), new Set([1, 2]));
});

test('treeIds/pathIds tolerate a self-referencing waiting_for without hanging', () => {
  const selfRef = [{ id: 7, title: 'Self-blocked', status: 'todo', waiting_for: [7] }];
  assert.deepStrictEqual(treeIds(selfRef, 7), new Set([7]));
  assert.deepStrictEqual(pathIds(selfRef, 7), new Set([7]));
});

// the map node needs `prompt` so its own label can fall
// back to it exactly like every other view (cardTitleDisplay, card-title.js).
test('cardToNode carries prompt through onto the built node, same as title/status/epic', () => {
  const withPrompt = [{ id: 8, title: '', prompt: 'summarize the PR', status: 'backlog', waiting_for: [], archived: false }];
  const g = buildDependencyGraph(withPrompt, null);
  const node = g.nodes.find((n) => n.id === 8);
  assert.strictEqual(node.prompt, 'summarize the PR');
});
