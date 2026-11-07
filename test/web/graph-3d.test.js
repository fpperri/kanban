const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  graph3dPathPoints, graph3dPlace, graph3dMorph, graph3dNextShape, graph3dShapeName,
  graph3dWantedIn, graph3dAddressFor, graph3dRim, graph3dOuter, graph3dFar, graph3dSplitFar,
  graph3dPick, graph3dTopDown, graph3dCloseFade, graph3dMarkScale, graph3dMaxTilt, graph3dRayHit,
  graph3dSnap, graph3dNearest, graph3dCoast, graph3dLineWidth, graph3dLabelScale, graph3dBasis,
  graph3dFit, graph3dFacing, graph3dKinOf, graph3dSoftCap, graph3dDomeBack, graph3dShapeFar, graph3dSideTilt, graph3dPaintOrder, graph3dRestack,
  graph3dDragMode, graph3dRgb, graph3dMix, graph3dShare, graph3dCompass, graph3dNorthUp,
  graph3dRound2, graph3dEase, graph3dMenuVerdict, GRAPH3D_UNLIT, GRAPH3D_THREE_SRC,
} = require('../../plugin/skills/web/web/graph-3d');
const { pageFiles, VENDORED } = require('../../plugin/skills/web/scripts/server');

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('a path of lines samples to its corners, each M starting a piece of its own', () => {
  const pieces = graph3dPathPoints('M0 0L10 0L10 10M50 50L60 50', 100);
  assert.strictEqual(pieces.length, 2);
  assert.deepStrictEqual(pieces[0][0], [0, 0]);
  assert.deepStrictEqual(pieces[0][pieces[0].length - 1], [10, 10]);
  assert.deepStrictEqual(pieces[1], [[50, 50], [60, 50]]);
});

test('a long line is split into steps no longer than asked, so it can bend on a curved shape', () => {
  const [line] = graph3dPathPoints('M0 0L100 0', 10);
  assert.strictEqual(line.length, 11);
  for (let i = 1; i < line.length; i++) assert.ok(line[i][0] - line[i - 1][0] <= 10 + 1e-9);
});

test('an arc samples along its circle: every point at the arc radius from the centre, the sweep the long way round when asked', () => {
  const r = 100;
  const [arc] = graph3dPathPoints(`M${r} 0A${r} ${r} 0 1 0 ${-r} 0`, 5);
  for (const [x, y] of arc) assert.ok(near(Math.hypot(x, y), r, 1e-6), `${x},${y}`);
  assert.ok(near(arc[arc.length - 1][0], -r) && near(arc[arc.length - 1][1], 0, 1e-6));
  const [full] = graph3dPathPoints(`M${r} 0A${r} ${r} 0 1 0 ${-r} 0A${r} ${r} 0 1 0 ${r} 0Z`, 5);
  assert.ok(near(full[full.length - 1][0], r) && near(full[full.length - 1][1], 0, 1e-6), 'the two halves close the circle');
  assert.ok(full.some(([, y]) => y < -50) && full.some(([, y]) => y > 50), 'both halves are drawn');
});

test('a quadratic curve starts and ends at its ends and bends toward its control point', () => {
  const [q] = graph3dPathPoints('M0 0Q50 100 100 0', 5);
  assert.deepStrictEqual(q[0], [0, 0]);
  assert.ok(near(q[q.length - 1][0], 100) && near(q[q.length - 1][1], 0));
  assert.ok(Math.max(...q.map((p) => p[1])) > 40);
});

test('the disc is the 2D layout on a flat plane: x stays x, y becomes depth, height 0', () => {
  assert.deepStrictEqual(graph3dPlace('disc', 30, -40, 200), [30, 0, -40]);
});

const nearAll = (a, b, eps = 0.01) => a.length === b.length && a.every((v, k) => near(v, b[k], eps));

test('the half sphere is a dome: the centre its top where the disc has it, the rim lowered by its radius, the bearing kept, nothing above', () => {
  const rim = 200;
  assert.ok(nearAll(graph3dPlace('half', 0, 0, rim), [0, 0, 0]), 'the centre is the top, on the disc plane');
  assert.ok(nearAll(graph3dPlace('half', rim, 0, rim), [200, -200, 0]), 'the rim, a right angle down from the top');
  assert.ok(nearAll(graph3dPlace('half', 0, 100, rim), [0, -58.58, 141.42]), 'half way out, 45 degrees down; the bearing toward +y stays +z');
  assert.ok(nearAll(graph3dPlace('half', 0, 260, rim), [0, -200, 260]), 'past the rim, the plane the dome stands on');
  for (const [x, y] of [[0, 0], [30, -170], [-120, 90], [199, 1], [400, 400]]) {
    assert.ok(graph3dPlace('half', x, y, rim)[1] <= 1e-9, `nothing above the disc plane: ${x} ${y}`);
  }
});

test('the sphere wraps the same way to 180 degrees: the centre the top pole, the rim down toward the bottom one', () => {
  const rim = 200;
  const radius = (rim * 1.08) / 2;
  assert.ok(nearAll(graph3dPlace('sphere', 0, 0, rim), [0, 108, 0]), 'the centre is the top pole');
  assert.ok(nearAll(graph3dPlace('sphere', -radius, 0, rim), [-108, 0, 0]), 'half the reach out, the equator');
  assert.ok(nearAll(graph3dPlace('sphere', 0, 54, rim), [0, 76.37, 76.37]), 'a quarter out, 45 degrees down');
  assert.ok(nearAll(graph3dPlace('sphere', -rim, 0, rim), [-24.91, -105.09, 0]), 'the rim near the bottom pole, keeping its bearing');
});

test('a morph runs from one shape to the next: at 0 the first, at 1 the second', () => {
  const a = graph3dMorph('disc', 'half', 0, 50, 60, 200);
  const b = graph3dMorph('disc', 'half', 1, 50, 60, 200);
  assert.deepStrictEqual(a, graph3dPlace('disc', 50, 60, 200));
  assert.deepStrictEqual(b.map((v) => Math.round(v * 1e6)), graph3dPlace('half', 50, 60, 200).map((v) => Math.round(v * 1e6)));
});

test('G steps disc, half sphere, sphere and back to disc, each with the name the label shows', () => {
  assert.strictEqual(graph3dNextShape('disc'), 'half');
  assert.strictEqual(graph3dNextShape('half'), 'sphere');
  assert.strictEqual(graph3dNextShape('sphere'), 'disc');
  assert.strictEqual(graph3dNextShape('nonsense'), 'disc');
  assert.deepStrictEqual(['disc', 'half', 'sphere'].map(graph3dShapeName), ['disc', 'half sphere', 'sphere']);
});

test('3D is on when the address says in3d=1, and the toggle writes it in or takes it out, keeping the rest', () => {
  assert.strictEqual(graph3dWantedIn('?graph=hierarchy&in3d=1'), true);
  assert.strictEqual(graph3dWantedIn('?graph=hierarchy'), false);
  assert.strictEqual(graph3dWantedIn('?in3d=0'), false);
  assert.strictEqual(graph3dAddressFor('?graph=hierarchy', true), '?graph=hierarchy&in3d=1');
  assert.strictEqual(graph3dAddressFor('?graph=hierarchy&in3d=1', false), '?graph=hierarchy');
  assert.strictEqual(graph3dAddressFor('?in3d=1', false), '');
  assert.strictEqual(graph3dAddressFor('?in3d=1', true), null, 'nothing to write when it already says so');
});

test('the rim is the outermost ring the fan draws, a block of unnested cards left out', () => {
  const plan = {
    nodes: [{ id: 'a', x: 0, y: 90, reach: 5 }, { id: 'b', x: 900, y: 900, reach: 5 }],
    tints: [{ d: 'M120 0A120 120 0 1 0 -120 0A120 120 0 1 0 120 0ZM60 0A60 60 0 1 0 -60 0A60 60 0 1 0 60 0Z' }],
    guides: [{ d: 'M0 150A150 150 0 1 0 0 -150' }],
    block: { columns: [{ ids: ['b'] }] },
  };
  assert.ok(near(graph3dRim(plan), 150, 1e-6));
});

test('the sphere reaches past the outermost thing drawn: cards of an Unnested table beyond the rim keep apart, short of the bottom pole', () => {
  const rim = 200;
  const plan = {
    nodes: [{ id: 'a', x: 0, y: 90, reach: 5 }, { id: 'b', x: 400, y: 300, reach: 5 }, { id: 'c', x: 430, y: 300, reach: 5 }],
    tints: [], guides: [], block: { x: 380, y: 280, w: 100, h: 60, columns: [{ ids: ['b', 'c'] }] },
  };
  const outer = graph3dOuter(plan);
  assert.ok(near(outer, Math.hypot(480, 340), 1e-6), "the block's far corner");
  const b = graph3dPlace('sphere', 400, 300, rim, outer);
  const c = graph3dPlace('sphere', 430, 300, rim, outer);
  assert.ok(Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]) > 1, 'two cards of the table stay two places');
  const radius = (outer * 1.08) / 2;
  assert.ok(b[1] > -radius + 1 && c[1] > -radius + 1, 'neither sits on the bottom pole');
  assert.deepStrictEqual(graph3dPlace('sphere', 0, 90, rim, 0), graph3dPlace('sphere', 0, 90, rim), 'no block: the rim alone');
});

test('on the sphere a point is on the far side when the camera sees the back of the sphere there', () => {
  const eye = [0, 0, 1000];
  assert.strictEqual(graph3dFar([0, 0, 100], eye), false, 'facing the camera');
  assert.strictEqual(graph3dFar([0, 0, -100], eye), true, 'behind the centre');
  assert.strictEqual(graph3dFar([98, 0, 20], eye), false, 'just short of the edge as seen');
  assert.strictEqual(graph3dFar([100, 0, 0], eye), true, 'the side at right angles is past the edge from a camera this near');
});

test('a line splits into its near runs and its far runs, each run sharing its end with the next so nothing gaps', () => {
  const pts = [[0], [1], [2], [3], [4], [5]];
  const farOf = (p) => p[0] >= 2 && p[0] <= 3;
  const { near: n, far } = graph3dSplitFar([pts], farOf);
  assert.deepStrictEqual(n, [[[0], [1], [2]], [[3], [4], [5]]]);
  assert.deepStrictEqual(far, [[[1], [2], [3], [4]]]);
  const all = graph3dSplitFar([[[0], [1]]], () => false);
  assert.deepStrictEqual(all, { near: [[[0], [1]]], far: [] });
});

test('labels are kept in turn: one that meets a label already kept or a blocker not its own is dropped, a forced one always stays', () => {
  const box = (x, y) => ({ x0: x, x1: x + 20, y0: y, y1: y + 10 });
  const shown = graph3dPick([
    { key: 'near', boxes: [box(0, 0)] },
    { key: 'stacked', boxes: [box(10, 5)] },
    { key: 'apart', boxes: [box(100, 0)] },
    { key: 'sel', boxes: [box(5, 2)], force: true },
    { key: 'own', boxes: [box(200, 0)], own: 'dot1' },
    { key: 'covered', boxes: [box(300, 0)], own: 'dot9' },
  ], [{ key: 'dot1', box: box(205, 0) }, { key: 'dot2', box: box(305, 2) }]);
  assert.deepStrictEqual([...shown.keys()].sort(), ['apart', 'near', 'own', 'sel']);
});

test('a label tries its boxes in turn: a name with no room falls back to the id in its place, and a forced one takes its last box', () => {
  const box = (x, w) => ({ x0: x, x1: x + w, y0: 0, y1: 10 });
  const shown = graph3dPick([
    { key: 'a', boxes: [box(0, 30)] },
    { key: 'b', boxes: [box(12, 60), box(32, 8)] },
    { key: 'c', boxes: [box(5, 60), box(5, 8)], force: true },
    { key: 'd', boxes: [box(15, 60), box(15, 8)] },
  ]);
  assert.strictEqual(shown.get('a'), 0);
  assert.strictEqual(shown.get('b'), 1, 'the name meets a, the id beside it has room');
  assert.strictEqual(shown.get('c'), 1, 'forced: the id, though it meets a');
  assert.strictEqual(shown.has('d'), false);
});

test("a card's label may lie over a dot on the far side of the sphere; a caption may not", () => {
  const box = (x) => ({ x0: x, x1: x + 20, y0: 0, y1: 10 });
  const shown = graph3dPick([
    { key: 'id', boxes: [box(0)], own: 'mine', overFar: true },
    { key: 'caption', boxes: [box(100)] },
  ], [{ key: 'back', far: true, box: box(5) }, { key: 'back2', far: true, box: box(105) }]);
  assert.deepStrictEqual([...shown.keys()], ['id']);
});

test('the camera looks straight down only with no tilt and no turn, whole turns included', () => {
  assert.strictEqual(graph3dTopDown({ phi: 0, theta: 0 }), true);
  assert.strictEqual(graph3dTopDown({ phi: 0, theta: 2 * Math.PI }), true);
  assert.strictEqual(graph3dTopDown({ phi: 0.3, theta: 0 }), false);
  assert.strictEqual(graph3dTopDown({ phi: 0, theta: 0.5 }), false);
});

test('the page serves every 3D Hierarchy file before the Graph, and the Graph draws in 3D only its Hierarchy under in3d=1', () => {
  const served = pageFiles(read('app.html'));
  const files = fs.readdirSync(WEB).filter((f) => /^graph-3d(-[a-z]+)?\.js$/.test(f));
  assert.deepStrictEqual(files.sort(), ['graph-3d-camera.js', 'graph-3d-compass.js', 'graph-3d-ground.js', 'graph-3d-input.js', 'graph-3d-marks.js', 'graph-3d-view.js', 'graph-3d.js']);
  for (const f of files) {
    assert.ok(served.includes(f), f);
    assert.ok(served.indexOf(f) < served.indexOf('graph-view.js'), f);
  }
  const src = read('graph-view.js');
  assert.match(src, /const in3d = kind === 'hierarchy' && graph3dWanted\(\) && plan\.nodes\.length > 0;/);
  assert.match(src, /if \(kind === 'hierarchy'\) \{\s+const b = graphButton\('graph-3d-btn'/, 'the 3D button stands by the Hierarchy alone');
});

test('three.js is asked for at the vendored, version-pinned path the server serves, and only once 3D is on', () => {
  const m = /^\/vendor\/(three\/three\.min\.js)\?v=([\d.]+)$/.exec(GRAPH3D_THREE_SRC);
  assert.ok(m, GRAPH3D_THREE_SRC);
  assert.ok(VENDORED.includes(m[1]));
  const revision = fs.readFileSync(path.join(WEB, 'vendor', 'three', 'three.min.js'), 'utf8').match(/"use strict";const e="(\d+)"/);
  assert.ok(revision, 'the vendored build names its revision');
  assert.strictEqual(m[2], `0.${revision[1]}.0`, 'the pinned version is the vendored revision');
  assert.ok(!pageFiles(read('app.html')).some((f) => /three/.test(f)), 'the page does not name it');
});

test('a left drag pans and a right drag orbits; Shift+left and a finger orbit; the middle button pans', () => {
  assert.strictEqual(graph3dDragMode({ button: 0, shiftKey: false, pointerType: 'mouse' }), 'pan');
  assert.strictEqual(graph3dDragMode({ button: 2, shiftKey: false, pointerType: 'mouse' }), 'orbit');
  assert.strictEqual(graph3dDragMode({ button: 0, shiftKey: true, pointerType: 'mouse' }), 'orbit');
  assert.strictEqual(graph3dDragMode({ button: 2, shiftKey: true, pointerType: 'mouse' }), 'orbit');
  assert.strictEqual(graph3dDragMode({ button: 1, shiftKey: false, pointerType: 'mouse' }), 'pan');
  assert.strictEqual(graph3dDragMode({ button: 0, shiftKey: false, pointerType: 'touch' }), 'orbit', 'one finger orbits');
  assert.strictEqual(graph3dDragMode({ button: 0, shiftKey: false, pointerType: 'pen' }), 'pan', 'a pen is a mouse');
  assert.strictEqual(graph3dDragMode({ button: 3, shiftKey: false, pointerType: 'mouse' }), null);
});

test('a right press holds back the menu the browser asks for on the press, and lets it through once the button is up with no drag', () => {
  const press = { down: true, moved: false, held: null };
  assert.strictEqual(graph3dMenuVerdict(press, false), 'hold', 'Linux and the Mac ask on the press');
  assert.strictEqual(graph3dMenuVerdict({ down: true, moved: false, held: { x: 1, y: 1 } }, false), 'swallow', 'a second while one is held');
  assert.strictEqual(graph3dMenuVerdict({ down: false, moved: false, held: null }, false), 'pass', 'Windows asks on the release');
  assert.strictEqual(graph3dMenuVerdict(null, false), 'pass', 'the keyboard\'s Menu key');
});

test('a right drag never opens the card menu, on the press, on the release or after it', () => {
  assert.strictEqual(graph3dMenuVerdict({ down: true, moved: true, held: null }, false), 'swallow');
  assert.strictEqual(graph3dMenuVerdict({ down: false, moved: true, held: null }, false), 'swallow');
});

test('a menu asked for by a right button pressed during a left pan or a pinch is swallowed', () => {
  assert.strictEqual(graph3dMenuVerdict(null, true), 'swallow');
});

test('a morph or a flight eases out and in, from 0 to 1 through the middle', () => {
  assert.strictEqual(graph3dEase(0), 0);
  assert.strictEqual(graph3dEase(0.5), 0.5);
  assert.strictEqual(graph3dEase(1), 1);
  assert.ok(graph3dEase(0.1) < 0.1 && graph3dEase(0.9) > 0.9);
});

test('coordinates are written to two decimals', () => {
  assert.strictEqual(graph3dRound2(1.23456), 1.23);
  assert.strictEqual(graph3dRound2(-7.891), -7.89);
  assert.strictEqual(String(graph3dRound2(12)), '12');
});

test('a colour is read as the stylesheet writes it: #rgb, #rrggbb, rgb() and rgba()', () => {
  assert.deepStrictEqual(graph3dRgb('#906001'), { r: 144, g: 96, b: 1, a: 1 });
  assert.deepStrictEqual(graph3dRgb(' #fff '), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepStrictEqual(graph3dRgb('rgb(31, 30, 29)'), { r: 31, g: 30, b: 29, a: 1 });
  assert.deepStrictEqual(graph3dRgb('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepStrictEqual(graph3dRgb('rgb(1 2 3 / 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  for (const no of ['', 'transparent', 'currentcolor', '#12345', 'rgb(1, 2)', null]) assert.strictEqual(graph3dRgb(no), null, String(no));
});

test('a mark dimmed in 3D is its ink mixed into the ground, a colour and never a see-through one', () => {
  const ink = { r: 200, g: 100, b: 0 };
  const ground = { r: 0, g: 0, b: 100 };
  assert.strictEqual(graph3dMix(ink, ground, 1), 'rgb(200, 100, 0)', 'kept whole: the ink');
  assert.strictEqual(graph3dMix(ink, ground, 0), 'rgb(0, 0, 100)', 'kept none: the ground');
  assert.strictEqual(graph3dMix(ink, ground, 0.5), 'rgb(100, 50, 50)');
  assert.strictEqual(graph3dMix(ink, ground, 2), 'rgb(200, 100, 0)', 'never past the ink');
  assert.strictEqual(graph3dMix({ ...ink, a: 0.5 }, ground, 1), 'rgb(100, 50, 50)', 'an ink that is itself half see-through keeps half');
});

test('a mark the lighting leaves unlit keeps less of its colour, but never less than its floor; a lit one keeps what depth leaves it', () => {
  assert.strictEqual(graph3dShare(0.8, null), 0.8);
  assert.ok(near(graph3dShare(1, GRAPH3D_UNLIT.node), 0.4));
  assert.strictEqual(graph3dShare(0.3, GRAPH3D_UNLIT.node), GRAPH3D_UNLIT.node.floor, 'at the back and unlit: the floor');
  assert.ok(GRAPH3D_UNLIT.link.dim < GRAPH3D_UNLIT.node.dim, 'an unlit line goes further into the ground than an unlit card, as in 2D');
  assert.deepStrictEqual(GRAPH3D_UNLIT.count, GRAPH3D_UNLIT.node, "a line's count dims as a card does");
});

test('a mark fades into the ground as the camera comes close and is gone only past that, never popping', () => {
  assert.strictEqual(graph3dCloseFade(1), 1, 'at an ordinary distance it keeps its colour');
  assert.strictEqual(graph3dCloseFade(12), 1);
  const mid = graph3dCloseFade(21);
  assert.ok(mid > 0.4 && mid < 0.6, `half way through the fade: ${mid}`);
  assert.ok(graph3dCloseFade(29) > 0 && graph3dCloseFade(29) < 0.1);
  assert.strictEqual(graph3dCloseFade(31), 0, 'nearer than that it is not drawn');
});

test('a mark is drawn at its perspective size up to a cap, and smaller as the disc tilts, unchanged from straight above', () => {
  assert.strictEqual(graph3dMarkScale(1.2, 0, 'disc'), 1.2, 'straight above: the 2D size');
  const close = graph3dMarkScale(9, 0, 'disc');
  assert.ok(close < 3 && close > 2.6, `close up the mark bends toward its cap: ${close}`);
  const low = graph3dMarkScale(1, 1.3, 'disc');
  assert.ok(low < 0.8 && low >= 0.55, `tilted low, smaller: ${low}`);
  assert.strictEqual(graph3dMarkScale(1, 1.3, 'sphere'), 1, 'the sphere has no one tilt');
});

test('a mark near the camera grows no more than 1.6 times the size of what the camera looks at, unchanged from straight above', () => {
  assert.strictEqual(graph3dMarkScale(0.6, 0, 'disc', 0.6), 0.6, 'as near as the focus: its own size');
  const held = graph3dMarkScale(1.8, 0.9, 'sphere', 0.6);
  assert.ok(held < 0.96 && held > 0.85, `three times nearer: held toward 1.6 times: ${held}`);
  assert.strictEqual(graph3dMarkScale(0.3, 0.9, 'sphere', 0.6), 0.3, 'farther: its own size');
});

test("a line is as wide as its ends' dots are seen against the home zoom, within 0.75 to 1.8 times its 2D width", () => {
  assert.strictEqual(graph3dLineWidth(0.6, 0.6), 1, 'at the home zoom: the 2D width');
  assert.ok(Math.abs(graph3dLineWidth(0.72, 0.6) - 1.2) < 1e-9, 'nearer: wider');
  const wide = graph3dLineWidth(3, 0.6);
  assert.ok(wide < 1.8 && wide > 1.7, `held toward 1.8: ${wide}`);
  assert.strictEqual(graph3dLineWidth(0.1, 0.6), 0.75, 'held at 0.75');
  assert.strictEqual(graph3dLineWidth(0.5, 0), 1, 'no home zoom yet: the 2D width');
});

test('a label is as large as its dot is near against what the camera looks at, 0.8 to 1.5 times, exactly 1 straight above', () => {
  assert.strictEqual(graph3dLabelScale(0.9, 0.6, true), 1, 'straight above: the 2D size');
  assert.ok(Math.abs(graph3dLabelScale(0.72, 0.6, false) - 1.2) < 1e-9);
  const big = graph3dLabelScale(3, 0.6, false);
  assert.ok(big < 1.5 && big > 1.45, `held toward 1.5: ${big}`);
  assert.strictEqual(graph3dLabelScale(0.1, 0.6, false), 0.8);
});

test('zoomed in past the fitted view the labels grow together, up to 1.5 times, still never from straight above', () => {
  assert.strictEqual(graph3dLabelScale(0.6, 0.6, false, 1.2), 1.2, 'as near as the focus, the zoom in on it');
  const grown = graph3dLabelScale(0.6, 0.6, false, 3);
  assert.ok(grown < 1.5 && grown > 1.4, `held toward 1.5: ${grown}`);
  assert.strictEqual(graph3dLabelScale(0.6, 0.6, true, 3), 1, 'straight above: the 2D size');
  assert.ok(Math.abs(graph3dLabelScale(0.6, 0.6, false, 0.5) - 1) < 1e-9, 'farther out than the fit: no smaller for that');
});

test("the camera's right, up and back: straight above, x right and the plan's y down the stage; always a right-handed frame", () => {
  const b = graph3dBasis(0, 0);
  assert.deepStrictEqual(b.right.map((v) => v + 0), [1, 0, 0]);
  assert.deepStrictEqual(b.up.map((v) => Math.round(v) + 0), [0, 0, -1]);
  assert.deepStrictEqual(b.back.map((v) => Math.round(v) + 0), [0, 1, 0]);
  for (const [phi, theta] of [[0.7, 0.4], [2.5, -1.2]]) {
    const { right: r, up: u, back: k } = graph3dBasis(phi, theta);
    const cross = [r[1] * u[2] - r[2] * u[1], r[2] * u[0] - r[0] * u[2], r[0] * u[1] - r[1] * u[0]];
    cross.forEach((v, i) => assert.ok(near(v, k[i]), `right x up = back at ${phi} ${theta}`));
  }
});

test('a fit stands the camera back just far enough to see every point within the fill, and moves the target to the middle', () => {
  const tan = Math.tan(Math.PI / 8);
  const square = [[-100, 0, -100], [100, 0, -100], [100, 0, 100], [-100, 0, 100]];
  const top = graph3dFit(square, [0, 0, 0], graph3dBasis(0, 0), tan, tan, 0.85);
  assert.ok(near(top.dist, 100 / (0.85 * tan), 1e-6), `straight above: ${top.dist}`);
  top.shift.forEach((v) => assert.ok(near(v, 0, 1e-6)));
  const off = graph3dFit(square.map(([x, y, z]) => [x + 50, y, z]), [0, 0, 0], graph3dBasis(0, 0), tan, tan, 0.85);
  assert.ok(near(off.shift[0], 50, 1e-3), `the target moves to the points' middle: ${off.shift[0]}`);
  assert.ok(near(off.dist, top.dist, 1e-3));
  const tilted = graph3dFit(square, [0, 0, 0], graph3dBasis(1.2, 0), tan * 2, tan, 0.85);
  const topWide = graph3dFit(square, [0, 0, 0], graph3dBasis(0, 0), tan * 2, tan, 0.85);
  assert.ok(tilted.dist < topWide.dist, `tilted, the plan is seen shorter, so the camera comes nearer: ${tilted.dist} < ${topWide.dist}`);
});

test('a fit that keeps its target in the middle stands back far enough for the farthest side', () => {
  const tan = Math.tan(Math.PI / 8);
  const pts = [[0, 0, 0], [100, 0, 0], [-20, 0, 0]];
  const held = graph3dFit(pts, [0, 0, 0], graph3dBasis(0, 0), tan, tan, 0.5, true);
  assert.ok(near(held.dist, 100 / (0.5 * tan), 1e-6), `the farther side decides: ${held.dist}`);
  held.shift.forEach((v) => assert.ok(near(v, 0)));
});

test('the camera faces a point of the sphere along its outward normal, turning the short way round', () => {
  const side = graph3dFacing([10, 0, 0], 0);
  assert.ok(near(side.phi, Math.PI / 2) && near(side.theta, Math.PI / 2));
  assert.ok(near(graph3dFacing([0, -10, 0], 0.3).phi, Math.PI), 'the bottom pole from under');
  assert.strictEqual(graph3dFacing([0, -10, 0], 0.3).theta, 0.3, 'at a pole the turn stays');
  const wrapped = graph3dFacing([10, 0, 0], 4 * Math.PI);
  assert.ok(near(wrapped.theta, 4 * Math.PI + Math.PI / 2), `whole turns kept: ${wrapped.theta}`);
  assert.strictEqual(graph3dFacing([0, 0, 0], 0), null);
});

test('a card and the cards its lines join it to: its parent, its children, the cards it waits on', () => {
  const links = [{ from: 1, to: 2, kids: [2, 3] }, { from: 5, to: 1 }, { from: 2, to: 9 }];
  assert.deepStrictEqual([...graph3dKinOf(links, 1)].sort(), ['1', '2', '3', '5']);
  assert.deepStrictEqual([...graph3dKinOf(links, 3)].sort(), ['1', '3']);
});

test('the disc and the half sphere tilt no further than nearly edge-on; the sphere turns all the way under', () => {
  assert.ok(graph3dMaxTilt('disc') < Math.PI / 2 && graph3dMaxTilt('disc') > 1.1);
  assert.strictEqual(graph3dMaxTilt('half'), graph3dMaxTilt('disc'));
  assert.strictEqual(graph3dMaxTilt('sphere'), Math.PI);
});

test('a ray from the camera meets the shape where the pointer is: the plane, the dome inside the rim, the near side of the sphere', () => {
  const rim = 100;
  const down = graph3dRayHit('disc', [10, 50, 20], [0, -1, 0], rim);
  assert.deepStrictEqual(down.map(Math.round), [10, 0, 20]);
  assert.strictEqual(graph3dRayHit('disc', [0, 50, 0], [0, 1, 0], rim), null, 'looking away: no hit');
  assert.ok(nearAll(graph3dRayHit('half', [0, 50, 0], [0, -1, 0], rim), [0, 0, 0]), 'straight down on the top of the dome');
  assert.ok(nearAll(graph3dRayHit('half', [50, 50, 0], [0, -1, 0], rim), [50, -13.4, 0]), 'on its side, not on what is under it');
  assert.ok(nearAll(graph3dRayHit('half', [150, 50, 0], [0, -1, 0], rim), [150, -100, 0]), 'past the rim, the plane the dome stands on');
  assert.ok(nearAll(graph3dRayHit('half', [0, -50, 500], [0, 0, -1], rim), [0, -50, 86.6]), 'from the side, its near side');
  const ball = graph3dRayHit('sphere', [0, 0, 500], [0, 0, -1], rim, 0);
  const radius = (rim * 1.08) / 2;
  assert.ok(Math.abs(ball[2] - radius) < 1e-6, 'the near side, not the far one');
});

test('a point is put back on the shape: the plane, the dome inside the rim, the sphere', () => {
  assert.deepStrictEqual(graph3dSnap('disc', [3, 7, 4], 100), [3, 0, 4]);
  const ball = graph3dSnap('sphere', [0, 10, 0], 100, 0);
  assert.ok(Math.abs(Math.hypot(...ball) - 54) < 1e-6);
  assert.ok(nearAll(graph3dSnap('sphere', [0, 0, 0], 100, 0), [0, 54, 0]), 'its middle goes to the top pole');
  assert.ok(nearAll(graph3dSnap('half', [0, 10, 0], 100), [0, 0, 0]), 'over the centre, the top of the dome');
  assert.ok(nearAll(graph3dSnap('half', [0, -60, 0], 100), [0, 0, 0]), 'inside it, under the top, the top');
  assert.ok(nearAll(graph3dSnap('half', [30, -150, 0], 100), [100, -100, 0]), 'under its rim, the rim');
  assert.ok(nearAll(graph3dSnap('half', [150, -3, 0], 100), [150, -100, 0]), 'past the rim, the plane');
});

test('a click a little off a small dot still finds it, the one nearer the camera first; one far from every dot finds none', () => {
  const vis = [
    { id: 'a', x: 100, y: 100, r: 4, z: 500 },
    { id: 'b', x: 112, y: 100, r: 4, z: 300 },
    { id: 'c', x: 300, y: 300, r: 4, z: 100 },
  ];
  assert.strictEqual(graph3dNearest(vis, 106, 100, 10), 'b', 'both in reach: the nearer the camera');
  assert.strictEqual(graph3dNearest(vis, 92, 100, 10), 'a');
  assert.strictEqual(graph3dNearest(vis, 200, 200, 10), null);
});

test('a released orbit coasts and slows to a stop', () => {
  let v = { vx: 1, vy: -0.5 };
  let steps = 0;
  while (v && steps < 1000) { v = graph3dCoast(v, 16); steps++; }
  assert.strictEqual(v, null);
  assert.ok(steps > 10 && steps < 120, `stops in ${steps} frames`);
});

test('near their caps a mark, a line and a label still grow with nearness: a soft knee, not a clamp', () => {
  assert.strictEqual(graph3dSoftCap(1, 1.8, 3), 1, 'below the knee: as it is');
  assert.ok(graph3dSoftCap(50, 1.8, 3) <= 3, 'never past the cap');
  const ss = [2, 2.5, 3, 4, 6, 9];
  for (let i = 1; i < ss.length; i++) {
    assert.ok(graph3dMarkScale(ss[i], 0.6, 'disc') > graph3dMarkScale(ss[i - 1], 0.6, 'disc'), `a mark at ${ss[i]} is drawn larger than one at ${ss[i - 1]}`);
    assert.ok(graph3dMarkScale(ss[i] / 3, 0.6, 'sphere', 0.5) > graph3dMarkScale(ss[i - 1] / 3, 0.6, 'sphere', 0.5), 'and past the near cap too');
    assert.ok(graph3dLineWidth(ss[i] / 2, 1) > graph3dLineWidth(ss[i - 1] / 2, 1), 'a line nearer is wider');
    assert.ok(graph3dLabelScale(ss[i] / 2, 1, false) > graph3dLabelScale(ss[i - 1] / 2, 1, false), 'a label nearer is larger');
  }
  assert.strictEqual(graph3dMarkScale(0.8, 0, 'disc', 0.8), 0.8, 'straight above at the focus: the 2D size');
  assert.strictEqual(graph3dMarkScale(2.4, 0, 'disc', 2.4), 2.4, 'zoomed in from above: still the 2D size');
  const deep = [5, 8, 10, 14].map((s) => graph3dMarkScale(s, 1.05, 'disc', 10));
  for (let i = 1; i < deep.length; i++) assert.ok(deep[i] > deep[i - 1] + 0.01, `closest zoom (focus at 10 times, past the cap): nearer still larger, ${deep.join(' ')}`);
});

test("a card's label may lie over a dot well behind its own, never over one as near", () => {
  const box = (x) => ({ x0: x, x1: x + 20, y0: 0, y1: 10 });
  const shown = graph3dPick([
    { key: 'front', boxes: [box(0)], own: 'a', z: 100 },
    { key: 'level', boxes: [box(100)], own: 'b', z: 100 },
    { key: 'flat', boxes: [box(200)], own: 'c' },
  ], [{ key: 'deep', z: 150, box: box(5) }, { key: 'beside', z: 105, box: box(105) }, { key: 'deep2', z: 150, box: box(205) }]);
  assert.deepStrictEqual([...shown.keys()], ['front']);
});

test("the dome's far side: its back, seen from outside past its edge; never the plane past the rim", () => {
  const rim = 100;
  const above = [0, 500, 0];
  assert.strictEqual(graph3dDomeBack([0, 0, 0], above, rim), false, 'the top seen from above');
  assert.strictEqual(graph3dDomeBack([86.6, -50, 0], above, rim), false, 'its side seen from above');
  const low = [0, -60, 400];
  assert.strictEqual(graph3dDomeBack([0, -50, 86.6], low, rim), false, 'the side facing a low camera');
  assert.strictEqual(graph3dDomeBack([0, -50, -86.6], low, rim), true, 'the side away from it, behind the dome');
  assert.strictEqual(graph3dDomeBack([0, -100, -150], low, rim), false, 'past the rim: the plane');
});

test('a point is on the far side by its shape: the back of the sphere and of the dome, never on the disc', () => {
  const eye = [0, 0, 1000];
  assert.strictEqual(graph3dShapeFar('sphere', [0, 0, -100], eye, 100), true);
  assert.strictEqual(graph3dShapeFar('sphere', [0, 0, 100], eye, 100), false);
  assert.strictEqual(graph3dShapeFar('half', [0, -50, -86.6], [0, -60, 400], 100), true);
  assert.strictEqual(graph3dShapeFar('half', [0, -50, 86.6], [0, -60, 400], 100), false);
  assert.strictEqual(graph3dShapeFar('disc', [0, 0, -100], eye, 100), false);
});

test('the dome and the sphere seen whole stand at the steepest tilt, up to the side view, from which the innermost ring is all in front', () => {
  assert.strictEqual(graph3dSideTilt(() => true), 0.85, 'nothing hidden: the side view');
  assert.ok(near(graph3dSideTilt((phi) => phi <= 0.52), 0.5), 'the steepest tilt that hides none, in steps of 0.05');
  assert.strictEqual(graph3dSideTilt(() => false), 0.25, 'hidden from every tilt: the least one tried');
});

test('marks are painted back to front, the far side under every near mark however near, the lit last', () => {
  const order = graph3dPaintOrder([
    { id: 'near-back', z: 300, far: false, lit: false },
    { id: 'glass', z: 100, far: true, lit: false },
    { id: 'near-front', z: 200, far: false, lit: false },
    { id: 'lit', z: 400, far: false, lit: true },
    { id: 'back', z: 500, far: true, lit: false },
  ]).map((o) => o.id);
  assert.deepStrictEqual(order, ['back', 'glass', 'near-back', 'near-front', 'lit']);
});

test('the marks are put in paint order around a pressed one, which stays where it is', () => {
  assert.deepStrictEqual(graph3dRestack(['a', 'b', 'p', 'c'], 'p'), { before: ['a', 'b'], after: ['c'] });
  assert.deepStrictEqual(graph3dRestack(['p', 'a', 'b'], 'p'), { before: [], after: ['a', 'b'] }, 'pressed first');
  assert.deepStrictEqual(graph3dRestack(['a', 'b', 'p'], 'p'), { before: ['a', 'b'], after: [] }, 'pressed and lit, so last');
  assert.deepStrictEqual(graph3dRestack(['a', 'b'], null), { before: [], after: ['a', 'b'] }, 'nothing pressed: every mark is put at the end');
  assert.deepStrictEqual(graph3dRestack(['a', 'b'], 'q'), { before: [], after: ['a', 'b'] }, 'a pressed mark that is not drawn');
});

test("a far side's label, painted under the near side, keeps off every near dot and off a far dot as near as its own", () => {
  const box = (x) => ({ x0: x, x1: x + 20, y0: 0, y1: 10 });
  const shown = graph3dPick([
    { key: 'on-near', boxes: [box(0)], own: 'a', under: true, z: 100 },
    { key: 'on-far-level', boxes: [box(100)], own: 'b', under: true, z: 100 },
    { key: 'on-far-deep', boxes: [box(200)], own: 'c', under: true, z: 100 },
  ], [
    { key: 'near', z: 300, box: box(5) },
    { key: 'far-level', far: true, z: 105, box: box(105) },
    { key: 'far-deep', far: true, z: 300, box: box(205) },
  ]);
  assert.deepStrictEqual([...shown.keys()], ['on-far-deep']);
});

test("the compass's dial turns with the camera and is squashed by its tilt, its north the 2D Hierarchy's top", () => {
  assert.deepStrictEqual(graph3dCompass(0, 0), { dial: 'scale(1 1) rotate(0)', north: [0, -1] }, 'straight above, north up: the 2D picture');
  assert.deepStrictEqual(graph3dCompass(Math.PI / 2, 0).north, [1, 0], 'a quarter turn: north to the right');
  assert.deepStrictEqual(graph3dCompass(0, Math.PI / 3), { dial: 'scale(1 0.5) rotate(0)', north: [0, -0.5] }, 'tilted, the dial is seen shorter');
  assert.deepStrictEqual(graph3dCompass(0, Math.PI / 2).north, [0, -0.08], 'edge-on, a sliver still shows');
  assert.deepStrictEqual(graph3dCompass(0, Math.PI), { dial: 'scale(1 -1) rotate(0)', north: [0, 1] }, 'from under the sphere, seen mirrored');
});

test('the compass turns the camera back to north up the short way round, whole turns kept', () => {
  assert.strictEqual(graph3dNorthUp(0.4), 0);
  assert.strictEqual(graph3dNorthUp(-0.4), 0);
  assert.ok(near(graph3dNorthUp(5.9), 2 * Math.PI), 'nearly a whole turn: on to the next north');
  assert.ok(near(graph3dNorthUp(-7), -2 * Math.PI));
});
