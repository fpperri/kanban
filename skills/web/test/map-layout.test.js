const { test } = require('node:test');
const assert = require('node:assert');
const { layoutMap } = require('../web/map-layout');

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
