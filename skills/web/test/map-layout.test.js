const { test } = require('node:test');
const assert = require('node:assert');
const { layoutMap } = require('../web/map-layout');
const { buildDependencyGraph, mapFrames } = require('../web/dependency-graph');

// Fixed, round-number sizes for every hand-computed test below — never the
// real MAP_NODE_W/H app.js uses, so the arithmetic stays easy to check by
// hand: card 100x40, a 10px gap everywhere, 10px padding, a 20px title bar.
const SIZES = { nodeW: 100, nodeH: 40, gapX: 10, gapY: 10, pad: 10, titleH: 20 };

// --- a card with no epic -----------------------------------------------

test('a single plain card (no frames, no edges) sits at (pad,pad), canvas sized around it', () => {
  const out = layoutMap({ ids: [1], edges: [], frames: [], sizes: SIZES, maxWidth: 1200 });
  assert.deepStrictEqual(out, {
    width: 120, height: 60, // pad*2 + card (100x40)
    nodes: [{ id: 1, x: 10, y: 10, w: 100, h: 40 }],
    frames: [],
    edges: [],
    drawOrder: [{ id: 1, x: 10, y: 10, w: 100, h: 40 }],
  });
});

// --- one epic frame with a chain inside ---------------------------------

test('one epic frame holds its whole chain (both members, not just the terminal), sized content+padding+title bar', () => {
  const ids = [10, 11, 12];
  const edges = [
    { from: 11, to: 12, kind: 'dep', fromGhost: false, toGhost: false },
    { from: 12, to: 10, kind: 'epic', fromGhost: false, toGhost: false }, // membership — never drawn, never sized
  ];
  const frames = [{ epicId: 10, memberIds: [11, 12], ghost: false, missing: false, parentFrameId: null }];
  const out = layoutMap({ ids, edges, frames, sizes: SIZES, maxWidth: 1200 });

  // Frame content: 11 at (0,0), 12 at (0,50) (40 card + 10 gap) inside the
  // frame — width 100, height 90 — so the outer frame is 100+2*10=120 wide,
  // 20(title)+90+2*10=130 tall, and the frame itself is the sole top-level
  // unit, placed at the canvas's own (pad,pad) = (10,10).
  assert.deepStrictEqual(out.frames, [{ epicId: 10, x: 10, y: 10, w: 120, h: 130, titleH: 20 }]);
  // Members land at the frame's (contentOffsetX=pad, contentOffsetY=title+pad)
  // = (10,30) plus their own local position within the frame.
  assert.deepStrictEqual(out.nodes, [
    { id: 11, x: 20, y: 40, w: 100, h: 40 },
    { id: 12, x: 20, y: 90, w: 100, h: 40 },
  ]);
  assert.strictEqual(out.width, 140); // pad*2 + 120
  assert.strictEqual(out.height, 150); // pad*2 + 130
  // The chain's dep edge is the only drawn edge; the membership edge never appears.
  assert.strictEqual(out.edges.length, 1);
  assert.deepStrictEqual(out.edges[0], {
    from: 11, to: 12, kind: 'dep', fromGhost: false, toGhost: false,
    x1: 70, y1: 80, x2: 70, y2: 90, back: false,
  });
});

// --- membership edges are never drawn -----------------------------------

test('a kind:"epic" edge never appears in the drawn edges, with or without a matching frame', () => {
  const out = layoutMap({
    ids: [1, 2],
    edges: [{ from: 1, to: 2, kind: 'epic', fromGhost: false, toGhost: false }],
    frames: [{ epicId: 2, memberIds: [1], ghost: false, missing: false, parentFrameId: null }],
    sizes: SIZES, maxWidth: 1200,
  });
  assert.deepStrictEqual(out.edges, []);
});

// --- an epic's own dependency attaches to its frame ----------------------

test('an epic\'s own outgoing dep edge attaches to the BOTTOM-CENTER of its frame (leaving)', () => {
  const ids = [10, 11, 20];
  const edges = [{ from: 10, to: 20, kind: 'dep', fromGhost: false, toGhost: false }]; // 20 waits on the epic itself
  const frames = [{ epicId: 10, memberIds: [11], ghost: false, missing: false, parentFrameId: null }];
  const out = layoutMap({ ids, edges, frames, sizes: SIZES, maxWidth: 1200 });

  assert.deepStrictEqual(out.frames, [{ epicId: 10, x: 10, y: 10, w: 120, h: 80, titleH: 20 }]);
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 11), { id: 11, x: 20, y: 40, w: 100, h: 40 });
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 20), { id: 20, x: 20, y: 100, w: 100, h: 40 });
  assert.strictEqual(out.edges.length, 1);
  const e = out.edges[0];
  // Frame is x:10,w:120 -> center x=70; leaving = the frame's own bottom, y=10+80=90.
  assert.strictEqual(e.x1, 70);
  assert.strictEqual(e.y1, 90);
  assert.strictEqual(e.x2, 70); // arriving edge is centered on card 20 too here
  assert.strictEqual(e.y2, 100); // top of card 20
  assert.strictEqual(e.back, false);
});

test('a member waiting on its own enclosing epic arrives ABOVE where the edge leaves — back:true, bows sideways instead of hiding behind the card', () => {
  // The frame's leaving point (bottom-center, below every member's row) sits
  // lower on the page than the member's own top — even though the FRAME's
  // own top (its title bar) is well above the member too. A box-top-vs-box-top
  // comparison would call this forward; only the actual anchor points get it
  // right.
  const ids = [10, 1, 2];
  const edges = [{ from: 10, to: 1, kind: 'dep', fromGhost: false, toGhost: false }]; // 1 waits on its own epic
  const frames = [{ epicId: 10, memberIds: [1, 2], ghost: false, missing: false, parentFrameId: null }];
  const out = layoutMap({ ids, edges, frames, sizes: SIZES, maxWidth: 1200 });

  assert.deepStrictEqual(out.frames, [{ epicId: 10, x: 10, y: 10, w: 230, h: 80, titleH: 20 }]);
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 1), { id: 1, x: 20, y: 40, w: 100, h: 40 });
  assert.strictEqual(out.edges.length, 1);
  const e = out.edges[0];
  assert.strictEqual(e.x1, 125); // frame center: x=10,w=230
  assert.strictEqual(e.y1, 90); // frame's own bottom: y=10+80
  assert.strictEqual(e.x2, 70); // card 1's center
  assert.strictEqual(e.y2, 40); // card 1's top — ABOVE the leaving point (90)
  assert.strictEqual(e.back, true);
});

// --- back-ness is topological, not geometric -----------------------------

test('an epic waiting on its own member is NOT a back edge — the member finishing before its epic is the normal case, not a cycle', () => {
  // The member (11) sits INSIDE the frame, so its bottom anchor (leaving
  // point for this edge) is always below the frame's own top anchor
  // (arriving point) — geometrically indistinguishable from the pinned
  // "member waits on its own epic" case above, which IS a real cycle. Only
  // topology (member finishes before its epic, same direction as this edge)
  // tells them apart.
  const ids = [10, 11];
  const edges = [{ from: 11, to: 10, kind: 'dep', fromGhost: false, toGhost: false }]; // 10 waits on its own member 11
  const frames = [{ epicId: 10, memberIds: [11], ghost: false, missing: false, parentFrameId: null }];
  const out = layoutMap({ ids, edges, frames, sizes: SIZES, maxWidth: 1200 });

  assert.deepStrictEqual(out.frames, [{ epicId: 10, x: 10, y: 10, w: 120, h: 80, titleH: 20 }]);
  assert.deepStrictEqual(out.nodes, [{ id: 11, x: 20, y: 40, w: 100, h: 40 }]);
  assert.strictEqual(out.edges.length, 1);
  const e = out.edges[0];
  assert.strictEqual(e.x1, 70); // card 11's center
  assert.strictEqual(e.y1, 80); // card 11's bottom
  assert.strictEqual(e.x2, 70); // frame's center: x=10,w=120
  assert.strictEqual(e.y2, 10); // frame's own top — ABOVE the leaving point (80), same geometry as the cycle case
  assert.strictEqual(e.back, false, 'no real cycle: member-before-epic (implicit) and member-before-epic (this edge) agree');
});

test('a cycle made only by lifting — a member\'s OWN edge to an outsider must not fabricate a cycle for an unrelated sibling edge to the frame', () => {
  // 11 and 12 are both members of epic 10. 11->12 (12 waits on 11) and
  // 11->20 (20 waits on 11) are real edges off the CHAIN-INTERNAL member 11;
  // 20->10 (10 waits on 20) is a real edge off the epic itself. Lifted to the
  // top level, 11->20 becomes frame10->20 (since 11's top-level container is
  // frame 10) — which, read naively, conflicts with the direct 20->10 edge
  // and looks like a 2-cycle between the frame and 20. But no single node is
  // actually part of a cycle: the true order is 11, then {12, 20} in either
  // order, then 10 (12 is the epic's terminal member, so it — not 11 —
  // gates the epic's own completion). 20->10 must stay forward.
  const ids = [10, 11, 12, 20];
  const edges = [
    { from: 20, to: 10, kind: 'dep', fromGhost: false, toGhost: false }, // 10 waits on 20
    { from: 11, to: 12, kind: 'dep', fromGhost: false, toGhost: false }, // 12 waits on 11 (chain-internal)
    { from: 11, to: 20, kind: 'dep', fromGhost: false, toGhost: false }, // 20 waits on 11
  ];
  const frames = [{ epicId: 10, memberIds: [11, 12], ghost: false, missing: false, parentFrameId: null }];
  const out = layoutMap({ ids, edges, frames, sizes: SIZES, maxWidth: 1200 });

  assert.deepStrictEqual(out.frames, [{ epicId: 10, x: 10, y: 10, w: 120, h: 130, titleH: 20 }]);
  assert.deepStrictEqual(out.nodes, [
    { id: 11, x: 20, y: 40, w: 100, h: 40 },
    { id: 12, x: 20, y: 90, w: 100, h: 40 },
    { id: 20, x: 20, y: 150, w: 100, h: 40 },
  ]);
  assert.strictEqual(out.width, 140);
  assert.strictEqual(out.height, 200);
  assert.deepStrictEqual(out.edges, [
    {
      from: 20, to: 10, kind: 'dep', fromGhost: false, toGhost: false,
      x1: 70, y1: 190, x2: 70, y2: 10, back: false, // the edge under test — must NOT be flagged back
    },
    {
      from: 11, to: 12, kind: 'dep', fromGhost: false, toGhost: false,
      x1: 70, y1: 80, x2: 70, y2: 90, back: false,
    },
    {
      from: 11, to: 20, kind: 'dep', fromGhost: false, toGhost: false,
      x1: 70, y1: 80, x2: 70, y2: 150, back: false,
    },
  ]);
});

// --- a cross-frame dependency --------------------------------------------

test('a dependency between members of two DIFFERENT frames lifts to connect the frames at the top level, but draws card-to-card', () => {
  const ids = [100, 101, 200, 201];
  const edges = [{ from: 201, to: 101, kind: 'dep', fromGhost: false, toGhost: false }]; // 101 waits on 201
  const frames = [
    { epicId: 100, memberIds: [101], ghost: false, missing: false, parentFrameId: null },
    { epicId: 200, memberIds: [201], ghost: false, missing: false, parentFrameId: null },
  ];
  const out = layoutMap({ ids, edges, frames, sizes: SIZES, maxWidth: 1200 });

  // The lifted edge (200->100) makes them one connected component: frame200
  // (the blocker) lands in layer 0, frame100 (the waiter) in layer 1, below it.
  assert.deepStrictEqual(out.frames.find((f) => f.epicId === 200), { epicId: 200, x: 10, y: 10, w: 120, h: 80, titleH: 20 });
  assert.deepStrictEqual(out.frames.find((f) => f.epicId === 100), { epicId: 100, x: 10, y: 100, w: 120, h: 80, titleH: 20 });
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 201), { id: 201, x: 20, y: 40, w: 100, h: 40 });
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 101), { id: 101, x: 20, y: 130, w: 100, h: 40 });
  // The DRAWN edge still runs card-to-card (201's own box -> 101's own box),
  // crossing the frame border in between, not epic-to-epic.
  assert.strictEqual(out.edges.length, 1);
  assert.deepStrictEqual(out.edges[0], {
    from: 201, to: 101, kind: 'dep', fromGhost: false, toGhost: false,
    x1: 70, y1: 80, x2: 70, y2: 130, back: false,
  });
});

// --- a hidden epic / a dangling parent: ghost & missing frames lay out identically ---

test('a ghost frame (epic filtered out) lays out exactly like any other frame — geometry ignores the flag', () => {
  const out = layoutMap({
    ids: [10, 11], edges: [], sizes: SIZES, maxWidth: 1200,
    frames: [{ epicId: 10, memberIds: [11], ghost: true, missing: false, parentFrameId: null }],
  });
  assert.deepStrictEqual(out.frames, [{ epicId: 10, x: 10, y: 10, w: 120, h: 80, titleH: 20 }]);
  assert.deepStrictEqual(out.nodes, [{ id: 11, x: 20, y: 40, w: 100, h: 40 }]);
});

test('a missing frame (dangling parent id, no real epic card) lays out exactly like any other frame', () => {
  const out = layoutMap({
    ids: [99, 5], edges: [], sizes: SIZES, maxWidth: 1200,
    frames: [{ epicId: 99, memberIds: [5], ghost: false, missing: true, parentFrameId: null }],
  });
  assert.deepStrictEqual(out.frames, [{ epicId: 99, x: 10, y: 10, w: 120, h: 80, titleH: 20 }]);
  assert.deepStrictEqual(out.nodes, [{ id: 5, x: 20, y: 40, w: 100, h: 40 }]);
});

// --- nesting --------------------------------------------------------------

test('a frame nested inside another frame offsets by the outer frame\'s own content origin', () => {
  const ids = [1, 2, 3];
  const frames = [
    { epicId: 1, memberIds: [2], ghost: false, missing: false, parentFrameId: null },
    { epicId: 2, memberIds: [3], ghost: false, missing: false, parentFrameId: 1 },
  ];
  const out = layoutMap({ ids, edges: [], frames, sizes: SIZES, maxWidth: 1200 });

  assert.deepStrictEqual(out.frames.find((f) => f.epicId === 1), { epicId: 1, x: 10, y: 10, w: 140, h: 120, titleH: 20 });
  assert.deepStrictEqual(out.frames.find((f) => f.epicId === 2), { epicId: 2, x: 20, y: 40, w: 120, h: 80, titleH: 20 });
  assert.deepStrictEqual(out.nodes, [{ id: 3, x: 30, y: 70, w: 100, h: 40 }]);
  assert.strictEqual(out.width, 160);
  assert.strictEqual(out.height, 140);
});

test('a doubly-nested frame packs its own content within maxWidth minus padding for EVERY level of nesting, not just one', () => {
  // Frame 1 (top level, depth 1) holds frame 2 (depth 2), which holds two
  // plain members (3, 4) side by side. maxWidth 230 gives depth 1 an inner
  // width of 230-10*2=210 (unchanged from a single level of nesting) but
  // depth 2 an inner width of 230-10*2*2=190 — narrow enough that 3 and 4
  // (100 wide each, 210 combined with the gap) must wrap to a second shelf
  // there, even though 210 alone would still have fit under depth 1's own
  // (wider) 210 limit had it not shrunk again for the second level.
  const ids = [1, 2, 3, 4];
  const frames = [
    { epicId: 1, memberIds: [2], ghost: false, missing: false, parentFrameId: null },
    { epicId: 2, memberIds: [3, 4], ghost: false, missing: false, parentFrameId: 1 },
  ];
  const out = layoutMap({ ids, edges: [], frames, sizes: SIZES, maxWidth: 230 });

  assert.deepStrictEqual(out.frames.find((f) => f.epicId === 1), { epicId: 1, x: 10, y: 10, w: 140, h: 170, titleH: 20 });
  // Frame 2 is 120 wide (100 content + pad*2), not 230 (100+10+100 side by
  // side + pad*2) — the two members wrapped instead of sitting side by side.
  assert.deepStrictEqual(out.frames.find((f) => f.epicId === 2), { epicId: 2, x: 20, y: 40, w: 120, h: 130, titleH: 20 });
  assert.deepStrictEqual(out.nodes, [
    { id: 3, x: 30, y: 70, w: 100, h: 40 },
    { id: 4, x: 30, y: 120, w: 100, h: 40 }, // wrapped below 3, not beside it
  ]);
  assert.strictEqual(out.width, 160);
  assert.strictEqual(out.height, 190);
});

// --- a parent cycle: every card drawn exactly once, no hang --------------

test('a parent cycle (mutual epic membership) never hangs and draws every card exactly once', () => {
  // Mirrors dependency-graph.test.js's own cycle fixture: frame1 nests into
  // frame2 (the break mapFrames already made), frame2 stays top-level, and
  // each keeps its OWN leaf on top of the mutual membership.
  const ids = [1, 2, 3, 4];
  const frames = [
    { epicId: 1, memberIds: [2, 3], ghost: false, missing: false, parentFrameId: 2 },
    { epicId: 2, memberIds: [1, 4], ghost: false, missing: false, parentFrameId: null },
  ];
  const out = layoutMap({ ids, edges: [], frames, sizes: SIZES, maxWidth: 1200 });

  const allIds = [...out.nodes.map((n) => n.id), ...out.frames.map((f) => f.epicId)].sort((a, b) => a - b);
  assert.deepStrictEqual(allIds, [1, 2, 3, 4], 'every id appears exactly once — no duplicate, none dropped');

  assert.deepStrictEqual(out.frames.find((f) => f.epicId === 2), { epicId: 2, x: 10, y: 10, w: 250, h: 120, titleH: 20 });
  assert.deepStrictEqual(out.frames.find((f) => f.epicId === 1), { epicId: 1, x: 20, y: 40, w: 120, h: 80, titleH: 20 });
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 3), { id: 3, x: 30, y: 70, w: 100, h: 40 });
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 4), { id: 4, x: 150, y: 40, w: 100, h: 40 });
  assert.strictEqual(out.width, 270);
  assert.strictEqual(out.height, 140);
});

test('a mutual parent cycle with no other leaves demotes the cut-off frame to an ordinary node, not a squeezed empty box', () => {
  // Cards 1{parent:2} and 2{parent:1}, nothing else. The cycle break nests
  // frame1 inside frame2; frame1's only raw member (2) escapes to stay
  // top-level, leaving frame1 with ZERO effective members — requirement 1
  // ("an epic with no members on the map stays an ordinary node") applies.
  const ids = [1, 2];
  const frames = [
    { epicId: 1, memberIds: [2], ghost: false, missing: false, parentFrameId: 2 },
    { epicId: 2, memberIds: [1], ghost: false, missing: false, parentFrameId: null },
  ];
  const out = layoutMap({ ids, edges: [], frames, sizes: SIZES, maxWidth: 1200 });

  // 1 draws as a plain, full-width card (never a titleH x pad*2 sliver).
  assert.deepStrictEqual(out.nodes, [{ id: 1, x: 20, y: 40, w: 100, h: 40 }]);
  // Only 2 is still a frame — holding 1 as its one ordinary-node member.
  assert.deepStrictEqual(out.frames, [{ epicId: 2, x: 10, y: 10, w: 120, h: 80, titleH: 20 }]);
  assert.strictEqual(out.width, 140);
  assert.strictEqual(out.height, 100);
});

// --- a layer orders by barycenter of the previous layer, not by id -------

test('a layer orders by the barycenter of its predecessors, not by id — a node fed from further left sorts first even though its id is higher', () => {
  // Layer 0: 1 (x-center 50), 2 (x-center 160). Layer 1: 10 is fed by BOTH
  // 1 and 2 (barycenter (50+160)/2=105); 20 is fed by 1 alone (barycenter
  // 50). By id, 10 would sort before 20 — by barycenter (the documented
  // rule), 20's lower score puts it FIRST instead.
  const ids = [1, 2, 10, 20];
  const edges = [
    { from: 2, to: 10, kind: 'dep', fromGhost: false, toGhost: false },
    { from: 1, to: 20, kind: 'dep', fromGhost: false, toGhost: false },
    { from: 1, to: 10, kind: 'dep', fromGhost: false, toGhost: false },
  ];
  const out = layoutMap({ ids, edges, frames: [], sizes: SIZES, maxWidth: 1200 });

  assert.deepStrictEqual(out.nodes.find((n) => n.id === 20), { id: 20, x: 10, y: 60, w: 100, h: 40 });
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 10), { id: 10, x: 120, y: 60, w: 100, h: 40 });
  assert.strictEqual(out.width, 230);
  assert.strictEqual(out.height, 110);
});

// --- two unconnected components pack side by side, then wrap -------------

test('unconnected components shelf-pack left to right, wrapping to a second shelf at maxWidth', () => {
  // Three isolated single-card components, each 100 wide; a 250 maxWidth
  // fits exactly two (100 + 10 gap + 100 = 210 <= 250) before the third
  // (210 + 10 + 100 = 320 > 250) wraps.
  const out = layoutMap({ ids: [1, 2, 3], edges: [], frames: [], sizes: SIZES, maxWidth: 250 });
  assert.deepStrictEqual(out.nodes, [
    { id: 1, x: 10, y: 10, w: 100, h: 40 },
    { id: 2, x: 120, y: 10, w: 100, h: 40 }, // right after 1 + gapX
    { id: 3, x: 10, y: 60, w: 100, h: 40 }, // wrapped: shelf 2, y = pad + shelf1Height(40) + gapY(10)
  ]);
  assert.strictEqual(out.width, 230); // pad*2 + 210 (the packed shelf's used width)
  assert.strictEqual(out.height, 110); // pad*2 + 90 (two 40px shelves + one gap)
});

// --- composed pipeline: buildDependencyGraph -> mapFrames -> layoutMap ----
// Every fixture above hand-builds `frames` and always puts the epicId in
// `ids` — that only proves layoutMap is correct GIVEN a well-formed input.
// It can't catch a contract break between the two seams: mapFrames frames
// an epic straight off `byId`/`nodeIds`, independent of whether that epic
// ever made it into graph.participants (the `ids` layoutMap actually
// receives, per app.js's own wiring). These run the real upstream
// functions so a regression in either seam's OWN participants/ghost
// bookkeeping shows up here as a dropped frame, not just downstream.

test('composed: an in-epic cycle (no terminal member, so no membership edge at all) still places the epic frame and both members — not a blank canvas', () => {
  const cards = [
    { id: 10, title: 'epic', status: 'doing', epic: true, waiting_for: [] },
    { id: 11, title: 'a', status: 'todo', parent: 10, waiting_for: [12] },
    { id: 12, title: 'b', status: 'todo', parent: 10, waiting_for: [11] },
  ];
  const g = buildDependencyGraph(cards, null);
  const frames = mapFrames(cards, g);
  const out = layoutMap({ ids: g.participants, edges: g.edges, frames, sizes: SIZES, maxWidth: 1200 });

  // Every participant (10, 11, 12) is drawn exactly once, as a node or a frame.
  const drawnIds = [...out.nodes.map((n) => n.id), ...out.frames.map((f) => f.epicId)].sort((a, b) => a - b);
  assert.deepStrictEqual(drawnIds, [10, 11, 12]);
  assert.strictEqual(out.frames.length, 1);
  assert.strictEqual(out.frames[0].epicId, 10);
  assert.deepStrictEqual(out.nodes.map((n) => n.id).sort((a, b) => a - b), [11, 12]);
  assert.strictEqual(out.edges.length, 2, 'both halves of the mutual wait draw');
});

test('composed: a search that ghosts the epic but keeps a member visible still places the ghost frame around it — not an empty SVG', () => {
  const cards = [
    { id: 10, title: 'the epic', status: 'doing', epic: true, waiting_for: [] },
    { id: 11, title: 'child a', status: 'todo', parent: 10, waiting_for: [] },
    { id: 12, title: 'child b', status: 'todo', parent: 10, waiting_for: [11] },
  ];
  const g = buildDependencyGraph(cards, new Set([11])); // only 11 matches the search
  const frames = mapFrames(cards, g);
  const out = layoutMap({ ids: g.participants, edges: g.edges, frames, sizes: SIZES, maxWidth: 1200 });

  const drawnIds = [...out.nodes.map((n) => n.id), ...out.frames.map((f) => f.epicId)].sort((a, b) => a - b);
  assert.deepStrictEqual(drawnIds, [10, 11, 12]);
  assert.strictEqual(out.frames.length, 1);
  assert.strictEqual(out.frames[0].epicId, 10);
  assert.deepStrictEqual(out.nodes.map((n) => n.id).sort((a, b) => a - b), [11, 12], 'the matched card (11) is still drawn, inside its ghosted epic');
});

test('shelf packing orders by AREA first, not by lowest id — a bigger component with a higher minId still lands on the first shelf slot', () => {
  // Component A: card 1 alone (100x40, area 4000, minId 1).
  // Component B: a 2-card chain 5->6 (100x90, area 9000, minId 5) — bigger,
  // but its lowest id is higher. Area-first puts B on the LEFT despite that.
  const ids = [1, 5, 6];
  const edges = [{ from: 5, to: 6, kind: 'dep', fromGhost: false, toGhost: false }];
  const out = layoutMap({ ids, edges, frames: [], sizes: SIZES, maxWidth: 1200 });

  assert.deepStrictEqual(out.nodes.find((n) => n.id === 5), { id: 5, x: 10, y: 10, w: 100, h: 40 });
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 6), { id: 6, x: 10, y: 60, w: 100, h: 40 });
  assert.deepStrictEqual(out.nodes.find((n) => n.id === 1), { id: 1, x: 120, y: 10, w: 100, h: 40 });
  assert.strictEqual(out.width, 230);
  assert.strictEqual(out.height, 110);
});

// --- duplicate participant ids are one unit, not two ----------------------

test('a duplicate id in `ids` (e.g. an active and archived copy sharing a number) draws once, at the position a clean list would give it', () => {
  const out = layoutMap({ ids: [1, 1], edges: [], frames: [], sizes: SIZES, maxWidth: 1200 });
  assert.deepStrictEqual(out, {
    width: 120, height: 60,
    nodes: [{ id: 1, x: 10, y: 10, w: 100, h: 40 }],
    frames: [],
    edges: [],
    drawOrder: [{ id: 1, x: 10, y: 10, w: 100, h: 40 }],
  });
});

test('a duplicate id mixed with a distinct one lays out as if the duplicate were never repeated — no inflated row width, no off-centre shift', () => {
  // Without a dedupe, the repeated 1 counts twice in its component's own row
  // (a component of ONE box measures as if it were two 100-wide boxes plus a
  // gap — 210 wide), shifting id 1's own final position off to where the
  // (nonexistent) second box would sit, and shifting id 2's shelf slot over
  // by the same phantom width. Deduped, this is exactly the plain two-card
  // shelf-pack case (id 1 at pad, id 2 right after it + gapX).
  const out = layoutMap({ ids: [1, 2, 1], edges: [], frames: [], sizes: SIZES, maxWidth: 1200 });
  assert.deepStrictEqual(out.nodes, [
    { id: 1, x: 10, y: 10, w: 100, h: 40 },
    { id: 2, x: 120, y: 10, w: 100, h: 40 },
  ]);
  assert.strictEqual(out.width, 230);
  assert.strictEqual(out.height, 60);
});

// --- draw order interleaves cards and frame title bars ---------------------

test('drawOrder puts a frame\'s title bar ahead of a plain card sitting below it, even though frames are computed in a separate pass', () => {
  // Frame 1 (a single member, 2) sits on the first (top) shelf; card 3, an
  // unrelated single-card component, is forced to the second shelf below it
  // by a narrow maxWidth. Concatenating "every node, then every frame" (the
  // two separate output arrays' own order) would put 2 and 3 ahead of frame
  // 1's title bar even though the title bar is the topmost thing on the
  // canvas — drawOrder must sort by position instead of by which array a
  // unit came from.
  const ids = [1, 2, 3];
  const frames = [{ epicId: 1, memberIds: [2], ghost: false, missing: false, parentFrameId: null }];
  const out = layoutMap({ ids, edges: [], frames, sizes: SIZES, maxWidth: 200 });

  assert.deepStrictEqual(out.frames, [{ epicId: 1, x: 10, y: 10, w: 120, h: 80, titleH: 20 }]);
  assert.deepStrictEqual(out.nodes, [
    { id: 2, x: 20, y: 40, w: 100, h: 40 },
    { id: 3, x: 10, y: 100, w: 100, h: 40 }, // wrapped to the second shelf, below the frame
  ]);
  assert.deepStrictEqual(out.drawOrder, [
    { id: 1, x: 10, y: 10, w: 120, h: 20 }, // the frame's TITLE BAR (titleH, not the frame's full height) — topmost, first
    { id: 2, x: 20, y: 40, w: 100, h: 40 },
    { id: 3, x: 10, y: 100, w: 100, h: 40 },
  ]);
});

test('drawOrder breaks a tie on the same row by x, left to right', () => {
  // Reuses the existing shelf-pack fixture: ids 1 and 2 share the same y
  // (10) on the first shelf, with 1 to the left of 2 — drawOrder must keep
  // that left-to-right order rather than falling back to array order or id.
  const out = layoutMap({ ids: [1, 2, 3], edges: [], frames: [], sizes: SIZES, maxWidth: 250 });
  assert.deepStrictEqual(out.drawOrder, [
    { id: 1, x: 10, y: 10, w: 100, h: 40 },
    { id: 2, x: 120, y: 10, w: 100, h: 40 },
    { id: 3, x: 10, y: 60, w: 100, h: 40 },
  ]);
});

// --- determinism -----------------------------------------------------------

test('layoutMap is deterministic — same input, same output, across repeated calls', () => {
  const ids = [100, 101, 200, 201];
  const edges = [{ from: 201, to: 101, kind: 'dep', fromGhost: false, toGhost: false }];
  const frames = [
    { epicId: 100, memberIds: [101], ghost: false, missing: false, parentFrameId: null },
    { epicId: 200, memberIds: [201], ghost: false, missing: false, parentFrameId: null },
  ];
  const a = layoutMap({ ids, edges, frames, sizes: SIZES, maxWidth: 1200 });
  const b = layoutMap({ ids, edges, frames, sizes: SIZES, maxWidth: 1200 });
  assert.deepStrictEqual(a, b);
});
