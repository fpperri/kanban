'use strict';
// The 3D Hierarchy's camera (graph-3d-view.js holds its state, `hier`): where it stands, the flights that
// frame the shape or a card, the zoom toward the pointer, the orbit and the pan, and the change of shape.

function graph3dApplyCamera(hier) {
  const T = hier.T;
  const c = hier.cam;
  hier.camera.quaternion.setFromEuler(new T.Euler(c.phi - Math.PI / 2, c.theta, 0, 'YXZ'));
  const back = new T.Vector3(0, 0, 1).applyQuaternion(hier.camera.quaternion);
  hier.camera.position.set(c.tx + back.x * c.dist, c.ty + back.y * c.dist, c.tz + back.z * c.dist);
  hier.camera.near = Math.max(0.5, c.dist / 400);
  hier.camera.far = Math.max(hier.rim * 40, c.dist * 10);
  hier.camera.updateProjectionMatrix();
  hier.camera.updateMatrixWorld(true);
  hier.root.dataset.cam = [c.theta, c.phi, c.dist, c.tx, c.ty, c.tz].map(graph3dRound2).join(',');
  graph3dPaintCompass(hier);
}

// The camera on the move (a drag, a coast, a flight, a zoom, a morph) lights nothing under the pointer and
// shows no tip: the pointer's light and its tip go out when it starts (a card the focus is on keeps its
// light), and come back on the next move of the pointer once the camera has stopped (graph3dRearm).
function graph3dMoving(hier) {
  return !!(hier.drag && hier.drag.moved) || !!hier.pinch || !!hier.spin || !!hier.fly || !!hier.zoom || !!hier.morph;
}

function graph3dQuietHover(hier) {
  if (!hier.armed) return;
  hier.armed = false;
  graphHideTip();
  const focus = document.activeElement;
  const held = focus && focus.closest && focus.closest('.graph-node');
  if (hoveredId != null && !(held && held.dataset.id === hoveredId)) setHoveredId(null);
  graphSettleFocus();
}

function graph3dRearm(hier, e) {
  hier.armed = true;
  const g = e.target && e.target.closest ? e.target.closest('.graph-node') : null;
  if (!g || !hier.root.contains(g)) return;
  setHoveredId(g.dataset.id);
  graphSettleFocus();
  if (g.hasAttribute('data-tip')) graphShowTip(g);
}

function graph3dFlyTo(hier, to, now) {
  const c = hier.cam;
  if (!now) graph3dQuietHover(hier);
  graphHideTip();
  hier.zoom = null;
  hier.spin = null;
  if (now) { Object.assign(c, to); hier.fly = null; graph3dRequest(hier); return; }
  hier.fly = { from: Object.assign({}, c), to: Object.assign({}, c, to), t0: performance.now(), ms: GRAPH3D_FLY_MS };
  graph3dRequest(hier);
}

// The points that stand for the whole shape as it is now: every dot, the block's corners, the rim, and the
// body of the bowl and of the sphere, in the scene.
function graph3dFitPoints(hier) {
  const { plan } = hier.view;
  const pts = plan.nodes.map((n) => [n.x, n.y]);
  if (plan.block) { const b = plan.block; pts.push([b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]); }
  const reach = hier.shape === 'sphere' ? Math.max(hier.rim, hier.outer || 0) * GRAPH3D_SPHERE_REACH : hier.rim;
  const rings = hier.shape === 'sphere' ? [0.25, 0.5, 0.75, hier.rim / reach] : hier.shape === 'half' ? [0.5, 1] : [1];
  for (const f of rings) {
    for (let k = 0; k < 32; k++) pts.push([Math.cos((k / 32) * 2 * Math.PI) * reach * f, Math.sin((k / 32) * 2 * Math.PI) * reach * f]);
  }
  if (hier.shape === 'half') pts.push([0, 0]);
  return pts.map(([x, y]) => graph3dPlace(hier.shape, x, y, hier.rim, hier.outer));
}

// The middle of the box round points in the scene.
function graph3dMiddle(points) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
}

// Where the camera stands to see the whole shape at the tilt phi and turn theta, as big as the stage
// allows: nearer as the disc tilts and its rows are seen shorter. On the disc it is the 2D Graph's own
// fit (graphFit) from straight above, so the 3D Hierarchy opens on the picture the 2D one shows, scaled
// and moved by as much as the shape's own fit changes from there (graph3dFit).
function graph3dFitView(hier, phi, theta) {
  const P = graph3dFitPoints(hier);
  const tv = GRAPH3D_TAN_HALF_FOV;
  const th = tv * (hier.w / hier.h);
  const { layout } = hier.view;
  if (hier.shape === 'disc' && layout && layout.bounds) {
    const fit = graphFit(layout.bounds, hier.w, hier.h, GRAPH3D_DISC_FIT_PAD);
    hier.kHome = fit.k;
    const base = [(hier.w / 2 - fit.x) / fit.k, 0, (hier.h / 2 - fit.y) / fit.k];
    const dist = hier.h / (2 * fit.k * tv);
    const above = graph3dFit(P, base, graph3dBasis(0, 0), th, tv, GRAPH3D_SHAPE_FILL);
    const now = graph3dFit(P, base, graph3dBasis(phi, theta), th, tv, GRAPH3D_SHAPE_FILL);
    const m = (k) => base[k] + now.shift[k] - above.shift[k];
    return { tx: m(0), ty: m(1), tz: m(2), dist: above.dist > 0 ? (dist * now.dist) / above.dist : dist, phi, theta };
  }
  const c = graph3dMiddle(P);
  const fit = graph3dFit(P, c, graph3dBasis(phi, theta), th, tv, GRAPH3D_SHAPE_FILL);
  return { tx: c[0] + fit.shift[0], ty: c[1] + fit.shift[1], tz: c[2] + fit.shift[2], dist: Math.max(60, fit.dist), phi, theta };
}

// H: everything, at the tilt the camera has. `side` (H, and a shape seen straight down): the bowl and the
// sphere from a three-quarter view, where they read as a bowl and a ball rather than as the disc again.
// Until a zoom or a pan takes over (hier.fitted), an orbit keeps the whole shape fitted to the stage.
function graph3dFrameAll(hier, now, side) {
  let { phi, theta } = hier.cam;
  const max = graph3dMaxTilt(hier.shape);
  if (side && hier.shape !== 'disc') { phi = GRAPH3D_SHAPE_TILT; theta = graph3dNorthUp(theta); }
  else if (phi > max) phi = max;
  hier.fitted = true;
  const to = graph3dFitView(hier, phi, theta);
  hier.fitDist = to.dist;
  graph3dFlyTo(hier, to, now);
}

// The cards `ids` (with `focus`, the one the camera looks at, else their middle) brought to the middle of
// the stage with room round them; on the sphere the camera turns round to see the focus face on, so a
// card on the far side comes to the front.
function graph3dFrameCards(hier, ids, focus) {
  const nodes = hier.view.plan.nodes.filter((n) => ids.has(String(n.id)));
  if (!nodes.length) return false;
  const P = nodes.map((n) => graph3dPlace(hier.shape, n.x, n.y, hier.rim, hier.outer));
  const main = focus == null ? null : nodes.find((n) => String(n.id) === String(focus));
  const c = main ? graph3dPlace(hier.shape, main.x, main.y, hier.rim, hier.outer) : graph3dMiddle(P);
  const to = { tx: c[0], ty: c[1], tz: c[2], phi: Math.min(hier.cam.phi, graph3dMaxTilt(hier.shape)), theta: hier.cam.theta };
  const face = hier.shape === 'sphere' ? graph3dFacing(main ? c : graph3dSnap('sphere', c, hier.rim, hier.outer), hier.cam.theta) : null;
  if (face) Object.assign(to, face);
  const tv = GRAPH3D_TAN_HALF_FOV;
  const fit = graph3dFit(P, c, graph3dBasis(to.phi, to.theta), tv * (hier.w / hier.h), tv, GRAPH3D_CARD_FILL, true);
  to.dist = Math.max(fit.dist, hier.h / (2 * tv * GRAPH3D_CARD_SCALE));
  hier.fitted = false;
  graph3dFlyTo(hier, to, false);
  return true;
}

// The search box's Enter: the card it found, with its parent and its children round it.
function graph3dCenterCard(hier, id) {
  graph3dFrameCards(hier, graph3dKinOf(hier.view.plan.links, id), id);
}

// F: the selection (a lone card with its kin), or everything when nothing is selected.
function graph3dFrameSelection(hier) {
  const sel = [...selectedIds].map(String);
  const ids = sel.length === 1 ? graph3dKinOf(hier.view.plan.links, sel[0]) : new Set(sel);
  if (!graph3dFrameCards(hier, ids, sel.length === 1 ? sel[0] : null)) graph3dFrameAll(hier, false);
}

// The wheel, a pinch and the zoom buttons: the camera eases (the frame loop) to `hier.zoom`, which each
// step moves on from where the last one asked for. Zooming in heads for what is under the pointer: the
// dot there (with a click's tolerance) or the shape. At the closest the camera stops coming nearer and
// skims along the shape toward the pointer, so it passes among the dots rather than through the ground.
function graph3dZoomAt(hier, px, py, f) {
  const T = hier.T;
  graph3dApplyCamera(hier);
  const goal = hier.zoom || { tx: hier.cam.tx, ty: hier.cam.ty, tz: hier.cam.tz, dist: hier.cam.dist, phi: hier.cam.phi };
  const ndc = new T.Vector3(((px + hier.ox) / hier.cw) * 2 - 1, -((py + hier.oy) / hier.ch) * 2 + 1, 0.5);
  const dir = ndc.unproject(hier.camera).sub(hier.camera.position).normalize();
  const look = new T.Vector3(0, 0, -1).applyQuaternion(hier.camera.quaternion);
  const target = new T.Vector3(goal.tx, goal.ty, goal.tz);
  const eye = hier.camera.position;
  const o = [eye.x, eye.y, eye.z];
  const dotId = f < 1 ? graph3dNearest(hier.vis, px, py, GRAPH3D_PICK_TOL) : null;
  const dotNode = dotId == null ? null : hier.view.plan.nodes.find((n) => n.id === dotId);
  const hit = dotNode ? graph3dPlace(hier.shape, dotNode.x, dotNode.y, hier.rim, hier.outer)
    : f < 1 ? graph3dRayHit(hier.shape, o, [dir.x, dir.y, dir.z], hier.rim, hier.outer) : null;
  const want = goal.dist * f;
  const closest = hier.h / (2 * GRAPH3D_TAN_HALF_FOV * GRAPH3D_CLOSEST_SCALE);
  if (hit) {
    target.lerp(new T.Vector3(hit[0], hit[1], hit[2]), 1 - f);
    if (want < closest) {
      const p = graph3dSnap(hier.shape, [target.x, target.y, target.z], hier.rim, hier.outer);
      target.set(p[0], p[1], p[2]);
      if (hier.shape !== 'sphere' && goal.phi < GRAPH3D_SKIM_TILT) goal.phi = Math.min(GRAPH3D_SKIM_TILT, goal.phi + 0.12);
    }
    goal.dist = Math.max(closest, want);
  } else if (f < 1) {
    // Toward empty space: nearer, never past the closest, and on the sphere never inside it.
    const inside = hier.shape === 'sphere' ? graph3dSphereRadius('sphere', hier.rim, hier.outer) - target.length() : 0;
    goal.dist = Math.max(closest, inside + closest, want);
  } else {
    const onPlane = eye.clone().addScaledVector(dir, goal.dist / Math.max(0.05, dir.dot(look)));
    target.lerp(onPlane, 1 - f);
    goal.dist = Math.min(want, hier.rim * 40);
  }
  goal.tx = target.x; goal.ty = target.y; goal.tz = target.z;
  hier.zoom = goal;
  hier.fitted = false;
  hier.fly = null;
  hier.spin = null;
  graph3dEndHint(hier);
  graph3dQuietHover(hier);
  graph3dRequest(hier);
}

function graph3dOrbit(hier, dx, dy) {
  const c = hier.cam;
  c.theta -= (Math.PI * dx) / hier.h;
  c.phi = Math.min(graph3dMaxTilt(hier.shape), Math.max(0, c.phi - (Math.PI * dy) / hier.h));
  if (hier.fitted && hier.view) { Object.assign(c, graph3dFitView(hier, c.phi, c.theta)); hier.fitDist = c.dist; }
}

function graph3dPan(hier, dx, dy) {
  const T = hier.T;
  const c = hier.cam;
  const wpp = (2 * c.dist * GRAPH3D_TAN_HALF_FOV) / hier.h;
  const right = new T.Vector3(1, 0, 0).applyQuaternion(hier.camera.quaternion);
  const up = new T.Vector3(0, 1, 0).applyQuaternion(hier.camera.quaternion);
  c.tx += (-right.x * dx + up.x * dy) * wpp;
  c.ty += (-right.y * dx + up.y * dy) * wpp;
  c.tz += (-right.z * dx + up.z * dy) * wpp;
}

// G: the next shape, morphed into while the camera flies to frame it.
function graph3dSetShape(hier, shape) {
  const from = hier.shape;
  if (shape === from) return;
  hier.morph = { from: hier.morph ? hier.morph.to : from, to: shape, t0: performance.now(), e: 0 };
  hier.shape = shape;
  graph3dPaintLabel(hier);
  graph3dQuietHover(hier);
  hier.zoom = null;
  hier.spin = null;
  graph3dFrameAll(hier, false, hier.cam.phi < 0.3);
  if (hier.fly) hier.fly.ms = GRAPH3D_MORPH_MS;
  graph3dRequest(hier);
}
