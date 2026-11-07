'use strict';
// The 3D Hierarchy: the Graph's Hierarchy drawn on a shape the camera turns round. The Graph hands
// it the same plan it draws in 2D (graphPlan, graph-model.js), with every filter, search, option,
// status, type mark, selection and lighting already applied, and this file only puts that plan on
// the shape:
//
// - the dots, rings, ids, names, lines, counts and captions are the 2D drawing's own SVG marks
//   (graphDrawPlan), each moved every frame to where the camera sees its point, so they keep their
//   classes and every gesture of the 2D Graph (hover, click, double click, the card menu); their
//   colours are mixed into the ground here, by depth and lighting (graph3dMix), never made see-through;
// - the tier washes, the guide rings, the dividers and the block's frame are drawn by three.js on the
//   shape itself, in the colours the app's stylesheet gives the 2D marks.
//
// The shape is the disc (the 2D layout, flat), the half sphere (the disc's centre sunk into a bowl
// under the rim) or the sphere (the same to 180 degrees); G steps it with a short morph. A left drag
// pans, a right drag or a Shift+left drag orbits, the wheel zooms toward the pointer; one finger
// orbits and a pinch zooms. F frames the selection, H everything. 3D is on while the address says
// in3d=1 (the 3D button by Hierarchy | Flow writes it). three.js (r160's classic build, vendored) is
// loaded the first time 3D is on. The pure helpers are required by node --test; the rest is browser only.

const GRAPH3D_SHAPE_LIST = ['disc', 'half', 'sphere'];
const GRAPH3D_SHAPE_NAMES = { disc: 'disc', half: 'half sphere', sphere: 'sphere' };
// On the sphere the rim stands a little short of the far pole, so the outermost ring stays a ring.
const GRAPH3D_SPHERE_REACH = 1.08;

// The points of an SVG path, as pieces (one for each M) of [x, y], no two points farther apart than
// `step` along a line, an arc or a curve, so a line can bend with the shape it is drawn on. Reads the
// commands the Graph's plan writes (M L H V A Q C Z, absolute or relative).
function graph3dPathPoints(d, step) {
  const gap = step > 0 ? step : 6;
  const tokens = String(d || '').match(/[MmLlHhVvAaQqCcZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const pieces = [];
  let cur = null;
  let x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0;
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  const num = () => Number(tokens[i++]);
  const start = (nx, ny) => {
    cur = [[nx, ny]];
    pieces.push(cur);
    x = sx = nx;
    y = sy = ny;
  };
  const lineTo = (nx, ny) => {
    if (!cur) start(x, y);
    if (nx === x && ny === y) return;
    const n = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y) / gap));
    for (let k = 1; k < n; k++) cur.push([x + ((nx - x) * k) / n, y + ((ny - y) * k) / n]);
    cur.push([nx, ny]);
    x = nx;
    y = ny;
  };
  const curve = (at, length, nx, ny) => {
    if (!cur) start(x, y);
    const n = Math.max(2, Math.ceil(length / gap));
    for (let k = 1; k < n; k++) cur.push(at(k / n));
    cur.push([nx, ny]);
    x = nx;
    y = ny;
  };
  const arcTo = (rx0, ry0, rot, large, sweep, nx, ny) => {
    let rx = Math.abs(rx0), ry = Math.abs(ry0);
    if (!rx || !ry || (nx === x && ny === y)) { lineTo(nx, ny); return; }
    const phi = (rot * Math.PI) / 180;
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x - nx) / 2, dy = (y - ny) / 2;
    const x1 = cos * dx + sin * dy;
    const y1 = -sin * dx + cos * dy;
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
    const top = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const bottom = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    let coef = bottom ? Math.sqrt(Math.max(0, top / bottom)) : 0;
    if (!!large === !!sweep) coef = -coef;
    const cxp = (coef * rx * y1) / ry;
    const cyp = (-coef * ry * x1) / rx;
    const cx = cos * cxp - sin * cyp + (x + nx) / 2;
    const cy = sin * cxp + cos * cyp + (y + ny) / 2;
    const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
    let dt = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    else if (sweep && dt < 0) dt += 2 * Math.PI;
    curve((f) => {
      const t = t1 + dt * f;
      return [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
    }, Math.abs(dt) * Math.max(rx, ry), nx, ny);
  };
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        start(num() + ox, num() + oy);
        cmd = rel ? 'l' : 'L';
        break;
      case 'L': lineTo(num() + ox, num() + oy); break;
      case 'H': lineTo(num() + ox, y); break;
      case 'V': lineTo(x, num() + oy); break;
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
        arcTo(rx, ry, rot, large, sweep, num() + ox, num() + oy);
        break;
      }
      case 'Q': {
        const qx = num() + ox, qy = num() + oy, nx = num() + ox, ny = num() + oy;
        const x0 = x, y0 = y;
        curve((t) => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * qx + t * t * nx, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * qy + t * t * ny],
          Math.hypot(qx - x0, qy - y0) + Math.hypot(nx - qx, ny - qy), nx, ny);
        break;
      }
      case 'C': {
        const ax = num() + ox, ay = num() + oy, bx = num() + ox, by = num() + oy, nx = num() + ox, ny = num() + oy;
        const x0 = x, y0 = y;
        const bez = (p0, p1, p2, p3, t) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3;
        curve((t) => [bez(x0, ax, bx, nx, t), bez(y0, ay, by, ny, t)],
          Math.hypot(ax - x0, ay - y0) + Math.hypot(bx - ax, by - ay) + Math.hypot(nx - bx, ny - by), nx, ny);
        break;
      }
      case 'Z':
        lineTo(sx, sy);
        cmd = '';
        break;
      default:
        i++;
    }
  }
  return pieces.filter((p) => p.length > 1);
}

// Where the 2D point (x, y) of the layout (its centre at 0 0) stands on a shape, as [x, y, z] with y
// up: the disc keeps it on the plane; the half sphere and the sphere keep its bearing and turn its
// distance from the centre into an angle from the bottom pole, to 90 degrees at the rim for the half
// (whose sphere has the rim's radius, so the rim stays where the disc has it) and to 180 for the
// sphere. Past the rim the half stays on the plane, so nothing stands above the disc. The sphere
// reaches a little past `outer` (graph3dOuter), when given, so a card past the rim, as an Unnested
// table's are, keeps a place of its own short of the far pole.
function graph3dPlace(shape, x, y, rim, outer) {
  if (shape !== 'half' && shape !== 'sphere') return [x, 0, y];
  const r = Math.hypot(x, y);
  const b = Math.atan2(y, x);
  if (shape === 'half') {
    if (r >= rim) return [Math.cos(b) * r, 0, Math.sin(b) * r];
    const phi = (r / rim) * (Math.PI / 2);
    const rho = rim * Math.sin(phi);
    return [Math.cos(b) * rho, -rim * Math.cos(phi), Math.sin(b) * rho];
  }
  const reach = Math.max(rim, outer || 0) * GRAPH3D_SPHERE_REACH;
  const radius = reach / 2;
  const phi = Math.min(1, r / reach) * Math.PI;
  const rho = radius * Math.sin(phi);
  return [Math.cos(b) * rho, -radius * Math.cos(phi), Math.sin(b) * rho];
}

// A point on its way from one shape to the next, `t` from 0 to 1.
function graph3dMorph(from, to, t, x, y, rim, outer) {
  const a = graph3dPlace(from, x, y, rim, outer);
  if (t <= 0) return a;
  const b = graph3dPlace(to, x, y, rim, outer);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function graph3dNextShape(shape) {
  const i = GRAPH3D_SHAPE_LIST.indexOf(shape);
  return GRAPH3D_SHAPE_LIST[i < 0 ? 0 : (i + 1) % GRAPH3D_SHAPE_LIST.length];
}

function graph3dShapeName(shape) {
  return GRAPH3D_SHAPE_NAMES[shape] || shape;
}

function graph3dWantedIn(search) {
  try { return new URLSearchParams(search || '').get('in3d') === '1'; } catch (e) { return false; }
}

// The address once 3D is `on`: in3d=1 written in or taken out, the rest kept. The search string
// ("?..." or "" when nothing is left), or null when the address already says it.
function graph3dAddressFor(search, on) {
  const params = new URLSearchParams(search || '');
  if ((params.get('in3d') === '1') === !!on) return null;
  if (on) params.set('in3d', '1');
  else params.delete('in3d');
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// The outermost ring the fan draws: its dots (with their marks), its washes and its guide rings. The
// cards of the Unnested block stand outside the fan and are left out.
function graph3dRim(plan) {
  const out = new Set();
  for (const col of (plan.block && plan.block.columns) || []) for (const id of col.ids || []) out.add(id);
  let rim = 0;
  for (const n of plan.nodes || []) if (!out.has(n.id)) rim = Math.max(rim, Math.hypot(n.x, n.y) + (n.reach || 0));
  for (const mark of (plan.tints || []).concat(plan.guides || [])) {
    for (const piece of graph3dPathPoints(mark.d, 40)) for (const [x, y] of piece) rim = Math.max(rim, Math.hypot(x, y));
  }
  return rim || 100;
}

// The farthest from the centre anything of the plan stands: every dot, the Unnested block's included,
// and the block's corners.
function graph3dOuter(plan) {
  let out = 0;
  for (const n of plan.nodes || []) out = Math.max(out, Math.hypot(n.x, n.y) + (n.reach || 0));
  const b = plan.block;
  if (b && Number.isFinite(b.w)) for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) out = Math.max(out, Math.hypot(x, y));
  return out;
}

// Whether the camera at `eye` sees the point p of the sphere (centred at 0 0 0) from behind: the far side.
function graph3dFar(p, eye) {
  return p[0] * (eye[0] - p[0]) + p[1] * (eye[1] - p[1]) + p[2] * (eye[2] - p[2]) < 0;
}

// Whether the camera at `eye` sees the point p of the bowl (the half sphere's wall under a rim of radius
// `rim`) from outside, through the wall: the bowl's own far side. The plane past the rim has none.
function graph3dBowlBack(p, eye, rim) {
  if (!(p[1] < -1e-6) || Math.hypot(p[0], p[2]) >= rim - 1e-6) return false;
  return p[0] * (eye[0] - p[0]) + p[1] * (eye[1] - p[1]) + p[2] * (eye[2] - p[2]) > 0;
}

// A line's pieces cut into the runs on the near side and the runs on the far side (farOf), each run
// keeping the next one's first point, so the two halves meet.
function graph3dSplit(pieces, farOf) {
  const out = { near: [], far: [] };
  for (const piece of pieces) {
    let run = null;
    let side = null;
    piece.forEach((p, i) => {
      const s = farOf(p) ? 'far' : 'near';
      if (s !== side) {
        if (run) { run.push(p); if (run.length > 1) out[side].push(run); }
        run = i > 0 ? [piece[i - 1], p] : [p];
        side = s;
      } else run.push(p);
    });
    if (run && run.length > 1) out[side].push(run);
  }
  return out;
}

// Which labels show, taken in turn (the first the most wanted). Each label tries its boxes in turn (a
// name, then the id in its place) and takes the first that meets no label already shown and no blocker
// but its own (`own`, the key of its dot), nor, unless it may lie over the far side (`overFar`), a blocker
// marked `far`; a forced one takes its last box when none has room. A label with a depth (`z`) may lie
// over a dot well behind its own (BEHIND times as far), as a nearer thing is seen in front of a farther;
// a label painted under the near side (`under`, the far side's) only over a far dot well behind its own.
// The answer maps each label shown to the index of the box it took.
const GRAPH3D_BEHIND = 1.1;
function graph3dPick(items, blockers) {
  const meets = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const behind = (it, b) => it.z > 0 && b.z > it.z * GRAPH3D_BEHIND;
  const fits = (it, box) => !kept.some((b) => meets(b, box)) && !(blockers || []).some((b) => b.key !== it.own && !(b.far && it.overFar) && !(behind(it, b) && (b.far || !it.under)) && meets(b.box, box));
  const kept = [];
  const shown = new Map();
  for (const it of items) {
    const boxes = it.boxes || [];
    let k = boxes.findIndex((box) => fits(it, box));
    if (k < 0 && it.force && boxes.length) k = boxes.length - 1;
    if (k < 0) continue;
    kept.push(boxes[k]);
    shown.set(it.key, k);
  }
  return shown;
}

// The order the marks are painted in: back to front, the far side (the sphere's back, the bowl's wall seen
// through) under every near mark however near it stands, and the lit cards last of all.
function graph3dPaintOrder(vis) {
  return vis.slice().sort((a, b) => (a.lit - b.lit) || (b.far - a.far) || b.z - a.z);
}

// Whether the camera looks straight down on the plan with its x to the right: the picture the 2D view has.
function graph3dTopDown(cam) {
  const turn = Math.abs(cam.theta) % (2 * Math.PI);
  return Math.abs(cam.phi) < 0.01 && Math.min(turn, 2 * Math.PI - turn) < 0.01;
}

// A mark the camera comes close to (s, its perspective scale) fades into the ground, from FADE_FROM to
// FADE_TO, and is gone nearer than that: the share of its colour it keeps, 0 when not drawn.
const GRAPH3D_FADE_FROM = 12;
const GRAPH3D_FADE_TO = 30;
function graph3dKeep(s) {
  if (s <= GRAPH3D_FADE_FROM) return 1;
  if (s >= GRAPH3D_FADE_TO) return 0;
  return 1 - (s - GRAPH3D_FADE_FROM) / (GRAPH3D_FADE_TO - GRAPH3D_FADE_FROM);
}

// v as it is up to `knee`, then bending toward `cap` without reaching it, so of two values past the knee
// the larger stays larger however far past (a soft knee rather than a clamp): half way there at v = cap.
function graph3dSoftCap(v, knee, cap) {
  if (!(cap > knee)) return Math.min(v, cap);
  if (v <= knee) return v;
  const x = (v - knee) / (cap - knee);
  return knee + (cap - knee) * (x / (1 + x));
}

// The scale a mark is drawn at: its perspective scale bending toward MARK_CAP, so a dot the camera flies
// past does not fill the stage, and on the disc and the bowl a little smaller as they tilt, so rows seen
// low do not stack. Straight above it is the perspective scale itself, the 2D view's zoom.
// A mark nearer than what the camera looks at (`ref`, its scale) grows toward no more than NEAR_CAP times
// that, so the front of the sphere or of a tilted disc does not balloon over its neighbours. The bend
// starts at 0.6 of the cap, or at `ref` when that is short of the cap, so straight above a mark is drawn at
// the 2D zoom, and a nearer mark is always drawn the larger.
const GRAPH3D_MARK_CAP = 3;
const GRAPH3D_NEAR_CAP = 1.6;
function graph3dMarkScale(s, phi, shape, ref) {
  const cap = Math.min(GRAPH3D_MARK_CAP, ref > 0 ? GRAPH3D_NEAR_CAP * ref : Infinity);
  const k = graph3dSoftCap(s, ref > 0 && ref < cap ? Math.max(0.6 * cap, ref) : 0.6 * cap, cap);
  if (shape === 'sphere') return k;
  return k * (0.55 + 0.45 * Math.cos(Math.min(Math.abs(phi), Math.PI / 2)));
}

// How far the camera tilts from straight above: the disc and the bowl to nearly edge-on, the sphere
// all the way round to under its far pole.
function graph3dMaxTilt(shape) {
  return shape === 'sphere' ? Math.PI : 1.3;
}

const graph3dSphereRadius = (shape, rim, outer) => (shape === 'half' ? rim : (Math.max(rim, outer || 0) * GRAPH3D_SPHERE_REACH) / 2);

// Where the ray from `o` along `d` (a unit vector) first meets the shape, or null: the plane for the
// disc and past the half's rim, the bowl under the rim, the near side of the sphere.
function graph3dRayHit(shape, o, d, rim, outer) {
  const at = (t) => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const hits = [];
  const plane = Math.abs(d[1]) > 1e-9 ? -o[1] / d[1] : -1;
  if (shape !== 'sphere' && plane > 0) {
    const p = at(plane);
    if (shape === 'disc' || Math.hypot(p[0], p[2]) >= rim) hits.push(plane);
  }
  if (shape === 'half' || shape === 'sphere') {
    const r = graph3dSphereRadius(shape, rim, outer);
    const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
    const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
    const disc = b * b - c;
    if (disc >= 0) {
      for (const t of [-b - Math.sqrt(disc), -b + Math.sqrt(disc)]) {
        if (t > 0 && (shape === 'sphere' || at(t)[1] <= 1e-6)) hits.push(t);
      }
    }
  }
  if (!hits.length) return null;
  return at(Math.min(...hits));
}

// The point p put back on the shape: onto the plane, the bowl under the rim, or the sphere.
function graph3dSnap(shape, p, rim, outer) {
  if (shape === 'disc' || (shape === 'half' && Math.hypot(p[0], p[2]) >= rim)) return [p[0], 0, p[2]];
  const r = graph3dSphereRadius(shape, rim, outer);
  const q = shape === 'half' ? [p[0], Math.min(p[1], 0), p[2]] : p.slice();
  const len = Math.hypot(q[0], q[1], q[2]);
  if (len < 1e-9) return [0, -r, 0];
  return [(q[0] * r) / len, (q[1] * r) / len, (q[2] * r) / len];
}

// The dot a pointer at (x, y) means: of the dots (screen centre x y, radius r, depth z) whose edge is
// within `tol` px, the one nearest the camera, or null.
function graph3dNearest(vis, x, y, tol) {
  let best = null;
  for (const o of vis) {
    const off = Math.hypot(o.x - x, o.y - y) - o.r;
    if (off > tol) continue;
    if (!best || o.z < best.z || (o.z === best.z && off < best.off)) best = { id: o.id, z: o.z, off };
  }
  return best ? best.id : null;
}

// A released orbit's speed (px per ms) after another `dt` ms of coasting, or null once it has stopped.
function graph3dCoast(v, dt) {
  const k = 0.9 ** (dt / 16.7);
  const vx = v.vx * k, vy = v.vy * k;
  return Math.hypot(vx, vy) * 16.7 < 0.05 ? null : { vx, vy };
}

// A line is as wide as the dots at its ends are seen (sk, their mean scale) against the home zoom
// (kHome), from 0.75 times its 2D width and bending toward 1.8 past 1.3: exactly that width straight above at home.
function graph3dLineWidth(sk, kHome) {
  if (!(kHome > 0) || !(sk > 0)) return 1;
  return Math.max(0.75, graph3dSoftCap(sk / kHome, 1.3, 1.8));
}

// A label is as large as its dot is near (s, its perspective scale) against what the camera looks at
// (ref), and as much again as the camera has come in past the fitted view (`grow`, from 1): 0.8 to 1.5
// times its 2D size, bending toward 1.5 past 1.2, and exactly 1 from straight above.
function graph3dLabelScale(s, ref, topDown, grow) {
  if (topDown || !(ref > 0) || !(s > 0)) return 1;
  return Math.max(0.8, graph3dSoftCap((s / ref) * Math.max(1, grow || 1), 1.2, 1.5));
}

// The camera's right, up and back (toward the camera) at tilt phi and turn theta, as applyCamera turns it.
function graph3dBasis(phi, theta) {
  const sp = Math.sin(phi), cp = Math.cos(phi), s = Math.sin(theta), c = Math.cos(theta);
  return { right: [c, 0, -s], up: [-cp * s, sp, -cp * c], back: [sp * s, cp, sp * c] };
}

// How far back from `target` a camera turned as `b` stands to see every point within `fill` of the stage
// each way (tanH, tanV: the tangents of half its field of view), and the move of the target (`shift`,
// in the scene) that puts the points in the middle; with `held`, the target stays in the middle.
function graph3dFit(points, target, b, tanH, tanV, fill, held) {
  const f = fill > 0 ? fill : 0.85;
  const dot = (d, v) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
  const rel = points.map((p) => {
    const d = [p[0] - target[0], p[1] - target[1], p[2] - target[2]];
    return [dot(d, b.right), dot(d, b.up), dot(d, b.back)];
  });
  let sx = 0, sy = 0;
  const need = () => {
    let dist = 0;
    for (const [x, y, z] of rel) dist = Math.max(dist, z + Math.abs(x - sx) / (f * tanH), z + Math.abs(y - sy) / (f * tanV));
    return dist;
  };
  let dist = need();
  for (let i = 0; i < 6 && rel.length && !held; i++) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y, z] of rel) {
      const depth = Math.max(1e-6, dist - z);
      x0 = Math.min(x0, (x - sx) / depth); x1 = Math.max(x1, (x - sx) / depth);
      y0 = Math.min(y0, (y - sy) / depth); y1 = Math.max(y1, (y - sy) / depth);
    }
    sx += ((x0 + x1) / 2) * dist;
    sy += ((y0 + y1) / 2) * dist;
    dist = need();
  }
  return { dist, shift: [0, 1, 2].map((k) => b.right[k] * sx + b.up[k] * sy) };
}

// The tilt and turn from which the camera sees the point p of the sphere face on (along its outward
// normal), the turn the one nearest `theta`, so the camera goes the short way round; at a pole the turn stays.
function graph3dFacing(p, theta) {
  const len = Math.hypot(p[0], p[1], p[2]);
  if (len < 1e-9) return null;
  const phi = Math.acos(Math.max(-1, Math.min(1, p[1] / len)));
  if (Math.hypot(p[0], p[2]) < 1e-9 * len) return { phi, theta };
  let t = Math.atan2(p[0], p[2]);
  t += Math.round((theta - t) / (2 * Math.PI)) * 2 * Math.PI;
  return { phi, theta: t };
}

// A card and the cards the plan's lines join it to (its parent, its children, what it waits on), as ids in text.
function graph3dKin(links, id) {
  const me = String(id);
  const out = new Set([me]);
  for (const l of links || []) {
    const kids = (l.kids || [l.to]).map(String);
    if (String(l.from) === me) kids.forEach((k) => out.add(k));
    else if (kids.includes(me) || String(l.to) === me) out.add(String(l.from));
  }
  return out;
}

// What a press starts once it drags: 'pan' for the left button (and the middle one), 'orbit' for the
// right one, a Shift+left press and a finger; null for any other button. A press that never drags is
// a click: a left click selects, a right one opens the card menu.
function graph3dDragMode({ button, shiftKey, pointerType }) {
  if (pointerType === 'touch') return 'orbit';
  if (button === 2 || (button === 0 && shiftKey)) return 'orbit';
  if (button === 0 || button === 1) return 'pan';
  return null;
}

// A colour as the stylesheet gives it (#rgb, #rrggbb, rgb() or rgba()), as { r, g, b, a }, or null.
function graph3dRgb(text) {
  const s = String(text || '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (p.length < 3 || p.slice(0, 3).some((v) => !Number.isFinite(v))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1 };
}

// `ink` laid over `ground` keeping `share` of it (0 the ground, 1 the ink; an ink that is itself partly
// see-through keeps that much less), as the rgb() the page paints: a mark dimmed by depth, the far side
// or the lighting is a colour, never a see-through one, since near and far marks overlap in 3D.
function graph3dMix(ink, ground, share) {
  const a = Math.max(0, Math.min(1, share)) * (ink.a == null ? 1 : ink.a);
  const ch = (k) => Math.round(ground[k] + (ink[k] - ground[k]) * a);
  return `rgb(${ch('r')}, ${ch('g')}, ${ch('b')})`;
}

// The share of its colour a mark keeps: what depth and the far side leave it (`keep`), times what the
// lighting leaves a mark it does not light (`dim`), but never under the lighting's `floor`, so the rest
// of the graph stays legible round what is lit. `unlit` is null for a lit mark.
const GRAPH3D_UNLIT = {
  node: { dim: 0.4, floor: 0.28 },
  link: { dim: 0.25, floor: 0.16 },
  count: { dim: 0.4, floor: 0.28 },
};
function graph3dShare(keep, unlit) {
  return unlit ? Math.max(unlit.floor, keep * unlit.dim) : keep;
}

// --- the browser -------------------------------------------------------------------------------

const GRAPH3D_FOV = 45;
const GRAPH3D_MORPH_MS = 700;
const GRAPH3D_FLY_MS = 450;
const GRAPH3D_DRAG = 4;
const GRAPH3D_WHEEL = 0.87;
const GRAPH3D_BUTTON_ZOOM = 0.8;
// The camera comes no nearer to what it looks at than where a dot there is seen this many times its 2D
// size: just short of its fade (graph3dKeep), so the dot it heads for and its neighbours keep their
// colour and the stage around them stays full.
const GRAPH3D_CLOSEST_SCALE = 10;
// At the closest, each further step in leans the camera toward the horizon (the disc and the bowl), up to
// this tilt, so the dots around the one it heads for come into view, as in a map that tilts as you dive.
const GRAPH3D_SKIM_TILT = 1.05;
const GRAPH3D_FIT_PAD = 60;
// How much of the stage the whole shape fills, each way, when H frames it at a tilt.
const GRAPH3D_FILL = 0.85;
// F and the search box's Enter bring a card to the middle with its kin within this much of the stage,
// and a card alone no nearer than where it is seen at CARD_SCALE times its 2D size.
const GRAPH3D_CARD_FILL = 0.6;
const GRAPH3D_CARD_SCALE = 2.5;
// A wheel step or a pinch eases the camera to where it asked for: this many ms to cover two thirds of the way.
const GRAPH3D_ZOOM_TAU = 40;
// A click this many px off a dot's edge still finds it.
const GRAPH3D_PICK_TOL = 10;
// How far a shape seen whole (H) is tilted when it is the bowl or the sphere: from the side, so it reads as one.
const GRAPH3D_SHAPE_TILT = 0.85;
const GRAPH3D_HINT_MS = 8000;
// How much of its colour each mark of the ground lays over the stage, as app.css draws the 2D marks:
// a tier wash, a guide ring, a dashed guide of a nested tier, a divider, the block's frame.
const GRAPH3D_MIX = { wash: 0.13, guide: 0.55, sub: 0.4, divider: 0.6, block: 1 };
// The share of its colour a mark at the back keeps (the rest is the ground), and a mark on the sphere's far side.
const GRAPH3D_DEPTH_FADE = 0.3;
const GRAPH3D_FAR_KEEP = 0.45;
// Tilted, the ground's own lines and washes go further into it toward the back than the marks do, up to
// this much at edge-on: the plane recedes as a surface does.
const GRAPH3D_GROUND_FOG = 0.55;
// The floor under the disc: lifted toward the guide rings' colour by this much at edge-on, nothing from
// straight above, so tilted the plane reads as a surface with a soft edge.
const GRAPH3D_FLOOR_LIFT = 0.35;
// How dark a mark's contact shadow is at its middle, tilted edge-on (it fades to nothing at its edge).
const GRAPH3D_SHADOW = 0.8;
// A right press that opened no menu (a drag, or one whose menu the browser has not asked for yet) stops
// holding back the browser's contextmenu after this long.
const GRAPH3D_MENU_HOLD_MS = 600;
const GRAPH3D_HELP = 'Left drag pans, right drag or Shift+left drag orbits, the wheel zooms toward the pointer; one finger orbits and a pinch zooms. G steps the shape, F frames the selection, H frames everything.';
const GRAPH3D_HINT = 'Drag pans · right drag orbits · wheel zooms · double click opens · G shape · F frame · H home';
// three.js r160, its classic build (the global THREE), vendored and served by this exact path (server.js).
const GRAPH3D_THREE_SRC = '/vendor/three/three.min.js?v=0.160.0';
let graph3dCur = null;
let graph3dThreeLoad = null;

function graph3dWanted() {
  return graph3dWantedIn(location.search);
}

function graph3dSetWanted(on) {
  const search = graph3dAddressFor(location.search, on);
  if (search == null) return;
  try { history.replaceState(history.state, '', location.pathname + search + location.hash); } catch (e) { /* the address lags until the next press */ }
}

// three.js, asked for once: the first time 3D is on. A load that fails is asked for again next time.
function graph3dLoadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!graph3dThreeLoad) {
    graph3dThreeLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GRAPH3D_THREE_SRC;
      s.onload = () => resolve(window.THREE);
      s.onerror = () => { graph3dThreeLoad = null; reject(new Error('three.js did not load')); };
      document.head.appendChild(s);
    });
  }
  return graph3dThreeLoad;
}

const graph3dR = (v) => Math.round(v * 100) / 100;

// One running 3D view. It outlives the Graph's draws (every poll and selection rebuilds the 2D marks):
// show() takes the new marks and plan and keeps the camera and the shape.
function graph3dCreate() {
  const root = document.createElement('div');
  root.className = 'graph-3d';
  const label = document.createElement('p');
  label.className = 'graph-3d-label';
  label.title = GRAPH3D_HELP;
  label.setAttribute('aria-live', 'polite');
  root.appendChild(label);
  const st = {
    gone: false, T: null, renderer: null, scene: null, camera: null,
    ground: [], groundKey: '', groundAt: '', view: null, overlay: null, links: [], farLinks: [], captions: [], rim: 100, outer: 0,
    names: null, namesMode: '',
    shape: 'disc', morph: null,
    cam: { theta: 0, phi: 0, dist: 1000, tx: 0, ty: 0, tz: 0 }, framed: false, fly: null,
    raf: 0, w: 1, h: 1, cw: 1, ch: 1, ox: 0, oy: 0, order: '', drag: null, pointers: new Map(), pinch: null, right: null, rightTimer: 0, replaying: false, ro: null,
    zoom: null, spin: null, tick: 0, vis: [], kHome: 1, hint: true, hintTimer: 0, empty: false, dprWatch: null,
    fitted: false, fitDist: 0, idSide: new Map(), armed: true, quietAt: null,
    theme: 0, groundRgb: { r: 0, g: 0, b: 0, a: 1 }, inks: new WeakMap(), painted: new WeakMap(), parts: new WeakMap(), shadows: new Map(),
  };

  // The first seconds, or until the first gesture, the label names the gestures; then the shape and its keys.
  const paintLabel = () => {
    label.textContent = st.hint ? GRAPH3D_HINT
      : `${graph3dShapeName(st.shape)} · G shape · F frame · H home${st.empty ? ' · nothing in view: H brings it back' : ''}`;
    root.dataset.shape = st.shape;
  };
  const endHint = () => {
    if (!st.hint) return;
    st.hint = false;
    clearTimeout(st.hintTimer);
    paintLabel();
  };
  paintLabel();
  st.hintTimer = setTimeout(endHint, GRAPH3D_HINT_MS);

  const visible = () => root.isConnected && root.getClientRects().length > 0;

  const request = () => {
    if (st.gone || st.raf || !st.renderer) return;
    st.raf = requestAnimationFrame(frame);
  };

  // The canvas reaches past the stage to the Graph's frame (app.css), so the ground runs to the edge;
  // the camera keeps the stage's own picture (setViewOffset), so a point lands where the 2D view has it.
  const measure = () => {
    st.w = Math.max(1, root.clientWidth || 800);
    st.h = Math.max(1, root.clientHeight || 600);
    if (!st.renderer) return;
    const canvas = st.renderer.domElement;
    const r = root.getBoundingClientRect();
    const k = canvas.getBoundingClientRect();
    st.cw = Math.max(1, Math.round(k.width) || st.w);
    st.ch = Math.max(1, Math.round(k.height) || st.h);
    st.ox = Math.round(r.left - k.left) || 0;
    st.oy = Math.round(r.top - k.top) || 0;
    st.renderer.setPixelRatio(window.devicePixelRatio || 1);
    st.renderer.setSize(st.cw, st.ch, false);
    st.camera.aspect = st.w / st.h;
    st.camera.setViewOffset(st.w, st.h, -st.ox, -st.oy, st.cw, st.ch);
    st.camera.updateProjectionMatrix();
  };

  // The point of the plan (x, y) where the shape stands now, mid-morph included.
  const at = (x, y) => (st.morph
    ? graph3dMorph(st.morph.from, st.morph.to, st.morph.e, x, y, st.rim, st.outer)
    : graph3dPlace(st.shape, x, y, st.rim, st.outer));

  const applyCamera = () => {
    const T = st.T;
    const c = st.cam;
    st.camera.quaternion.setFromEuler(new T.Euler(c.phi - Math.PI / 2, c.theta, 0, 'YXZ'));
    const back = new T.Vector3(0, 0, 1).applyQuaternion(st.camera.quaternion);
    st.camera.position.set(c.tx + back.x * c.dist, c.ty + back.y * c.dist, c.tz + back.z * c.dist);
    st.camera.near = Math.max(0.5, c.dist / 400);
    st.camera.far = Math.max(st.rim * 40, c.dist * 10);
    st.camera.updateProjectionMatrix();
    st.camera.updateMatrixWorld(true);
    root.dataset.cam = `${graph3dR(c.theta)},${graph3dR(c.phi)},${graph3dR(c.dist)},${graph3dR(c.tx)},${graph3dR(c.ty)},${graph3dR(c.tz)}`;
  };

  // --- the ground: washes, guides, dividers and the block's frame, on the shape ------------------

  // Each mark is drawn solid, in its colour mixed into the stage's ground by as much of it as the 2D
  // mark lays over the ground (GRAPH3D_MIX): a dimmed mark is a colour, never a see-through one.
  const groundOf = () => {
    for (let el = root; el && el.nodeType === 1; el = el.parentElement) {
      const c = graph3dRgb(getComputedStyle(el).backgroundColor);
      if (c && c.a > 0) return c;
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  };
  const inkOf = (el, prop, mix, bg) => {
    const c = (el && graph3dRgb(getComputedStyle(el)[prop])) || { r: 136, g: 136, b: 136, a: 1 };
    return new st.T.Color().setStyle(graph3dMix(c, bg, mix));
  };
  const mixOf = (kind, dashed) => (kind === 'guide' && dashed ? GRAPH3D_MIX.sub : GRAPH3D_MIX[kind]);

  const disposeGround = () => {
    for (const g of st.ground) {
      st.scene.remove(g.obj);
      g.obj.geometry.dispose();
      g.obj.material.dispose();
    }
    st.ground = [];
    st.groundAt = '';
  };

  // Every mark of the ground takes its colour per point (paintGround): its own, or on the sphere's far
  // side mixed further into the ground. `base` is its own colour.
  const lineItem = (pts, el, dashed, kind, index, bg) => {
    const T = st.T;
    const src = new Float32Array(pts.length * 2);
    pts.forEach((p, k) => { src[2 * k] = p[0]; src[2 * k + 1] = p[1]; });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(pts.length * 3), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(pts.length * 3), 3));
    const opts = { color: 0xffffff, vertexColors: true, depthWrite: false };
    const mat = dashed ? new T.LineDashedMaterial(Object.assign({ dashSize: 2, gapSize: 5 }, opts)) : new T.LineBasicMaterial(opts);
    const obj = new T.Line(geo, mat);
    obj.frustumCulled = false;
    st.scene.add(obj);
    st.ground.push({ obj, src, dashed, kind, index, base: inkOf(el, 'stroke', mixOf(kind, dashed), bg), painted: '' });
  };

  // A wash is the ring between its band's two circles, as a mesh of rings and spokes.
  const washItem = (t, el, slot, bg) => {
    const T = st.T;
    const radii = graph3dPathPoints(t.d, 40).map((p) => Math.hypot(p[0][0], p[0][1]));
    if (radii.length < 2) return;
    const r0 = Math.min(...radii), r1 = Math.max(...radii);
    const NA = 160, NR = 6;
    const src = new Float32Array((NR + 1) * (NA + 1) * 2);
    for (let j = 0; j <= NR; j++) {
      const r = r0 + ((r1 - r0) * j) / NR;
      for (let k = 0; k <= NA; k++) {
        const a = (k / NA) * Math.PI * 2;
        const o = (j * (NA + 1) + k) * 2;
        src[o] = Math.cos(a) * r;
        src[o + 1] = Math.sin(a) * r;
      }
    }
    const index = [];
    for (let j = 0; j < NR; j++) {
      for (let k = 0; k < NA; k++) {
        const p = j * (NA + 1) + k;
        const q = p + NA + 1;
        index.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array((NR + 1) * (NA + 1) * 3), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array((NR + 1) * (NA + 1) * 3), 3));
    geo.setIndex(index);
    // A wash hides what is behind it on the sphere (it writes depth), set a hair back so the guide
    // lines lying on it are never cut by it.
    const mat = new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const obj = new T.Mesh(geo, mat);
    obj.frustumCulled = false;
    obj.renderOrder = -1;
    st.scene.add(obj);
    st.ground.push({ obj, src, dashed: false, kind: 'wash', index: slot, base: inkOf(el, 'fill', GRAPH3D_MIX.wash, bg), painted: '' });
  };

  // The body of the bowl and of the sphere: the whole shape as a faint skin over the washes, lit only at
  // its edge as seen (a soft rim in the guide rings' colour) and, in the bowl, a little darker toward the
  // bottom, so the shape reads as a bowl or a ball. The disc has none: from above it stays the 2D picture.
  const bodyItem = (el, bg) => {
    const T = st.T;
    const reach = Math.max(st.rim, st.outer || 0) * GRAPH3D_SPHERE_REACH;
    const NA = 96, NR = 24;
    const src = new Float32Array((NR + 1) * (NA + 1) * 2);
    for (let j = 0; j <= NR; j++) {
      const r = (reach * j) / NR;
      for (let k = 0; k <= NA; k++) {
        const a = (k / NA) * Math.PI * 2;
        const o = (j * (NA + 1) + k) * 2;
        src[o] = Math.cos(a) * r;
        src[o + 1] = Math.sin(a) * r;
      }
    }
    const index = [];
    for (let j = 0; j < NR; j++) {
      for (let k = 0; k < NA; k++) {
        const p = j * (NA + 1) + k;
        const q = p + NA + 1;
        index.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array((NR + 1) * (NA + 1) * 3), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array((NR + 1) * (NA + 1) * 4), 4));
    geo.setIndex(index);
    const mat = new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, side: T.DoubleSide, depthWrite: false, depthTest: false, fog: false });
    const obj = new T.Mesh(geo, mat);
    obj.frustumCulled = false;
    obj.renderOrder = -2;
    st.scene.add(obj);
    st.ground.push({ obj, src, dashed: false, kind: 'body', index: 0, base: inkOf(el, 'stroke', 1, bg), painted: '' });
  };

  // The floor: the disc's plane to a little past its outermost mark, drawn first, in the ground's own colour
  // lifted toward the guide rings' as the camera tilts (paintFloor), fading out at its edge.
  const floorItem = (el, bg) => {
    const T = st.T;
    const R = Math.max(st.rim * 1.12, (st.outer || 0) * 1.04);
    const NA = 96, NR = 12;
    const src = new Float32Array((NR + 1) * (NA + 1) * 2);
    for (let j = 0; j <= NR; j++) {
      const r = (R * j) / NR;
      for (let k = 0; k <= NA; k++) {
        const a = (k / NA) * Math.PI * 2;
        const o = (j * (NA + 1) + k) * 2;
        src[o] = Math.cos(a) * r;
        src[o + 1] = Math.sin(a) * r;
      }
    }
    const index = [];
    for (let j = 0; j < NR; j++) {
      for (let k = 0; k < NA; k++) {
        const p = j * (NA + 1) + k;
        const q = p + NA + 1;
        index.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array((NR + 1) * (NA + 1) * 3), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array((NR + 1) * (NA + 1) * 3), 3));
    geo.setIndex(index);
    const mat = new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: T.DoubleSide, depthWrite: false });
    const obj = new T.Mesh(geo, mat);
    obj.frustumCulled = false;
    obj.renderOrder = -3;
    st.scene.add(obj);
    st.ground.push({ obj, src, dashed: false, kind: 'floor', index: 0, base: inkOf(el, 'stroke', 1, bg), painted: '', reach: R });
  };

  // The contact shadows are the ground darkened, mixed again with each theme.
  const shadowInk = (svg) => svg.style.setProperty('--graph-3d-shadow-ink', graph3dMix({ r: 0, g: 0, b: 0 }, st.groundRgb, 0.7));

  const takeGround = (bg) => {
    st.groundRgb = bg;
    st.bg = new st.T.Color().setStyle(`rgb(${bg.r}, ${bg.g}, ${bg.b})`);
    st.scene.fog.color.copy(st.bg);
  };

  const buildGround = (plan, svg) => {
    disposeGround();
    const bg = groundOf();
    takeGround(bg);
    const tints = svg.querySelectorAll('.graph-tint');
    plan.tints.forEach((t, k) => washItem(t, tints[k], k, bg));
    const guides = svg.querySelectorAll('.graph-guide');
    plan.guides.forEach((g, k) => {
      for (const piece of graph3dPathPoints(g.d, 10)) lineItem(piece, guides[k], g.cls.includes('graph-guide-sub'), 'guide', k, bg);
    });
    const dividers = svg.querySelectorAll('.graph-divider');
    plan.dividers.forEach((d, k) => {
      for (const piece of graph3dPathPoints(`M${d.x1} ${d.y1}L${d.x2} ${d.y2}`, 10)) lineItem(piece, dividers[k], false, 'divider', k, bg);
    });
    if (plan.block) {
      const b = plan.block;
      const frame = svg.querySelector('.graph-block-frame');
      for (const piece of graph3dPathPoints(`M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`, 10)) lineItem(piece, frame, false, 'block', 0, bg);
    }
    bodyItem(guides[0], bg);
    floorItem(guides[0], bg);
  };

  // The colours of the ground follow the stylesheet: read again on every draw, so a theme change carries over.
  const recolourGround = (svg) => {
    const els = { wash: svg.querySelectorAll('.graph-tint'), guide: svg.querySelectorAll('.graph-guide'), divider: svg.querySelectorAll('.graph-divider'), block: svg.querySelectorAll('.graph-block-frame') };
    const bg = groundOf();
    takeGround(bg);
    for (const g of st.ground) {
      if (g.kind === 'body' || g.kind === 'floor') g.base = inkOf(els.guide[0], 'stroke', 1, bg);
      else g.base = inkOf(els[g.kind][g.index], g.kind === 'wash' ? 'fill' : 'stroke', mixOf(g.kind, g.dashed), bg);
      g.painted = '';
    }
  };

  // Each point of the ground in its mark's colour; on the sphere, a point on the far side mixed further
  // into the ground (FAR_KEEP), as the far side's dots are. Away from the sphere the colours do not
  // change with the camera, so they are painted once.
  const paintGround = () => {
    const sphere = st.shape === 'sphere' && !st.morph;
    const bowl = st.shape === 'half' && !st.morph;
    const e = st.camera.position;
    const ex = e.x, ey = e.y, ez = e.z;
    const bg = st.bg;
    for (const g of st.ground) {
      if (g.kind === 'body') { paintBody(g, ex, ey, ez); continue; }
      if (g.kind === 'floor') { paintFloor(g); continue; }
      const key = sphere || bowl ? '' : `flat ${g.base.getHexString()}`;
      if (key && g.painted === key) continue;
      g.painted = key;
      const pos = g.obj.geometry.getAttribute('position').array;
      const attr = g.obj.geometry.getAttribute('color');
      const col = attr.array;
      const b = g.base;
      for (let k = 0; k < col.length / 3; k++) {
        const x = pos[3 * k], y = pos[3 * k + 1], z = pos[3 * k + 2];
        const m = (sphere && x * (ex - x) + y * (ey - y) + z * (ez - z) < 0) || (bowl && graph3dBowlBack([x, y, z], [ex, ey, ez], st.rim)) ? GRAPH3D_FAR_KEEP : 1;
        col[3 * k] = bg.r + (b.r - bg.r) * m;
        col[3 * k + 1] = bg.g + (b.g - bg.g) * m;
        col[3 * k + 2] = bg.b + (b.b - bg.b) * m;
      }
      attr.needsUpdate = true;
    }
  };

  // How much of the disc's flat look the shape has (1 the disc, 0 the bowl and the sphere), mid-morph included.
  const flatness = () => {
    const weight = (shape) => (shape === 'disc' ? 1 : 0);
    return st.morph ? weight(st.morph.from) + (weight(st.morph.to) - weight(st.morph.from)) * st.morph.e : weight(st.shape);
  };

  const paintFloor = (g) => {
    const w = flatness() * Math.sin(Math.min(Math.PI / 2, Math.max(0, st.cam.phi)));
    g.obj.visible = w > 0.001;
    const key = `${Math.round(w * 1000)} ${g.base.getHexString()} ${st.bg.getHexString()}`;
    if (!g.obj.visible || g.painted === key) return;
    g.painted = key;
    const attr = g.obj.geometry.getAttribute('color');
    const col = attr.array;
    const b = g.base, bg = st.bg;
    for (let k = 0; k < col.length / 3; k++) {
      const f = Math.hypot(g.src[2 * k], g.src[2 * k + 1]) / g.reach;
      const t = Math.min(1, Math.max(0, (f - 0.7) / 0.3));
      const a = GRAPH3D_FLOOR_LIFT * w * (1 - t * t * (3 - 2 * t));
      col[3 * k] = bg.r + (b.r - bg.r) * a;
      col[3 * k + 1] = bg.g + (b.g - bg.g) * a;
      col[3 * k + 2] = bg.b + (b.b - bg.b) * a;
    }
    attr.needsUpdate = true;
  };

  const paintBody = (g, ex, ey, ez) => {
    const weight = (shape) => (shape === 'disc' ? 0 : 1);
    const strength = st.morph ? weight(st.morph.from) + (weight(st.morph.to) - weight(st.morph.from)) * st.morph.e : weight(st.shape);
    g.obj.visible = strength > 0.001;
    if (!g.obj.visible) return;
    const bowl = st.shape === 'half' || (st.morph && (st.morph.from === 'half' || st.morph.to === 'half')) && st.shape !== 'sphere';
    const sphere = st.shape === 'sphere' && !st.morph;
    const pos = g.obj.geometry.getAttribute('position').array;
    const attr = g.obj.geometry.getAttribute('color');
    const col = attr.array;
    const b = g.base;
    // A key light from the upper left of the view, so the ball and the bowl have a lit side.
    const L = new st.T.Vector3(-0.45, 0.65, 0.6).normalize().applyQuaternion(st.camera.quaternion);
    for (let k = 0; k < col.length / 4; k++) {
      const x = pos[3 * k], y = pos[3 * k + 1], z = pos[3 * k + 2];
      const len = Math.hypot(x, y, z) || 1;
      let vx = ex - x, vy = ey - y, vz = ez - z;
      const vl = Math.hypot(vx, vy, vz) || 1;
      vx /= vl; vy /= vl; vz /= vl;
      const toward = (x * vx + y * vy + z * vz) / len;
      const facing = Math.abs(toward);
      const rim = (1 - facing) * (1 - facing);
      const lit = Math.max(0, ((Math.sign(toward) || 1) * (x * L.x + y * L.y + z * L.z)) / len);
      const out = bowl && Math.hypot(g.src[2 * k], g.src[2 * k + 1]) > st.rim;
      const far = sphere && x * (ex - x) + y * (ey - y) + z * (ez - z) < 0;
      // The bowl's wall seen from outside stands in front of the marks behind it: a little more glass.
      const glass = st.shape === 'half' && !st.morph && graph3dBowlBack([x, y, z], [ex, ey, ez], st.rim) ? 0.1 : 0;
      const bottom = bowl ? Math.min(1, Math.max(0, -y / st.rim)) : 0;
      const shade = (1 - 0.75 * bottom) * (0.55 + 0.45 * lit);
      col[4 * k] = b.r * shade;
      col[4 * k + 1] = b.g * shade;
      col[4 * k + 2] = b.b * shade;
      col[4 * k + 3] = out || far ? 0 : strength * (0.03 + 0.22 * rim + 0.12 * bottom + 0.15 * lit + glass);
    }
    attr.needsUpdate = true;
  };

  const placeGround = () => {
    const key = st.morph ? `${st.morph.from}>${st.morph.to}@${st.morph.e}@${st.outer}` : `${st.shape}@${st.rim}@${st.outer}`;
    if (key === st.groundAt) return;
    st.groundAt = key;
    for (const g of st.ground) {
      const pos = g.obj.geometry.getAttribute('position');
      const arr = pos.array;
      for (let k = 0; k < g.src.length / 2; k++) {
        const p = at(g.src[2 * k], g.src[2 * k + 1]);
        arr[3 * k] = p[0];
        arr[3 * k + 1] = p[1];
        arr[3 * k + 2] = p[2];
      }
      pos.needsUpdate = true;
      if (g.dashed) g.obj.computeLineDistances();
    }
  };

  // --- the marks: the 2D drawing's own SVG, moved to where the camera sees each point --------------

  const project = (p, v) => {
    v.set(p[0], p[1], p[2]).applyMatrix4(st.camera.matrixWorldInverse);
    const z = -v.z;
    if (z < st.camera.near) return null;
    v.applyMatrix4(st.camera.projectionMatrix);
    return [((v.x + 1) / 2) * st.cw - st.ox, ((1 - v.y) / 2) * st.ch - st.oy, z];
  };
  const scaleAt = (z) => st.h / (2 * Math.tan((GRAPH3D_FOV * Math.PI) / 360) * z);

  // A mark's ink is the colour its 2D rule gives it, which app.css hands the 3D view as --graph-3d-ink (a
  // dot's is its card's colour); it is read once for each theme. The mark is painted with that ink mixed
  // into the ground (--graph-3d-paint), so a state the stylesheet paints over it (a focused caption) still wins.
  const markInk = (el, dot) => {
    const had = st.inks.get(el);
    if (had && had.theme === st.theme) return had.rgb;
    const cs = getComputedStyle(dot ? el.parentNode : el);
    const rgb = graph3dRgb(dot ? cs.color : cs.getPropertyValue('--graph-3d-ink'));
    st.inks.set(el, { theme: st.theme, rgb });
    return rgb;
  };
  const paintMark = (el, share, dot) => {
    const ink = el && markInk(el, dot);
    if (!ink) return;
    const paint = graph3dMix(ink, st.groundRgb, share);
    if (st.painted.get(el) === paint) return;
    st.painted.set(el, paint);
    el.style.setProperty('--graph-3d-paint', paint);
  };
  const paintNode = (g, share) => {
    let parts = st.parts.get(g);
    if (!parts) {
      parts = [...g.querySelectorAll('.graph-kids-ring, .graph-flag-ring, .graph-node-id, .graph-node-name')];
      st.parts.set(g, parts);
    }
    paintMark(g.querySelector('.graph-dot'), share, true);
    for (const el of parts) paintMark(el, share);
  };

  const placeMarks = () => {
    const { drawn, plan } = st.view;
    const T = st.T;
    const v = new T.Vector3();
    drawn.world.removeAttribute('transform');
    const sphere = st.shape === 'sphere' && !st.morph;
    const bowl = st.shape === 'half' && !st.morph;
    const e = st.camera.position;
    const eye = [e.x, e.y, e.z];
    // The far side: the sphere's back, and the bowl's wall where the camera sees it from outside.
    const isFar = (p) => (sphere && graph3dFar(p, eye)) || (bowl && graph3dBowlBack(p, eye, st.rim));
    // What the camera looks at is seen at `ref`: a mark nearer than that is drawn larger (to NEAR_CAP)
    // and so is its label (graph3dLabelScale); straight above every mark is at `ref`.
    const ref = scaleAt(st.cam.dist);
    const top = graph3dTopDown(st.cam);
    const grow = st.fitDist > 0 ? st.fitDist / st.cam.dist : 1;
    // A lit card (hovered, selected, focused, or lit by a hover, an isolate or a search) keeps its colour
    // and its label on the sphere's far side and at the back.
    const dimmed = drawn.svg.classList.contains('graph-dim');
    const focus = document.activeElement;
    const litOf = (g) => g.classList.contains('selected') || g.classList.contains('hover-highlight') || g === focus || (dimmed && g.classList.contains('graph-near'));
    const vis = [];
    let sum = 0;
    let zmin = Infinity, zmax = -Infinity;
    let inView = 0;
    for (const n of plan.nodes) {
      const g = drawn.nodeEls.get(n.id);
      if (!g) continue;
      const p = at(n.x, n.y);
      const q = project(p, v);
      const close = q ? graph3dKeep(scaleAt(q[2])) : 0;
      if (!close) { g.classList.add('graph-3d-off'); continue; }
      g.classList.remove('graph-3d-off');
      const raw = scaleAt(q[2]);
      const s = Math.round(graph3dMarkScale(raw, st.cam.phi, st.shape, ref) * 10000) / 10000;
      g.setAttribute('transform', `translate(${graph3dR(q[0])} ${graph3dR(q[1])}) scale(${s})`);
      g.style.setProperty('--graph-k', String(s));
      const ls = Math.round(graph3dLabelScale(raw, ref, top, grow) * 1000) / 1000;
      g.style.setProperty('--graph-3d-s', String(ls));
      const lit = litOf(g);
      const far = isFar(p) && !lit;
      g.classList.toggle('graph-3d-far', far);
      vis.push({ n, g, x: q[0], y: q[1], z: q[2], s, far, close, ls, lit });
      sum += s;
      zmin = Math.min(zmin, q[2]);
      zmax = Math.max(zmax, q[2]);
      if (q[0] > 0 && q[0] < st.w && q[1] > 0 && q[1] < st.h) inView++;
    }
    // Depth: the farther a mark, the more of the ground it takes, up to DEPTH_FADE at the back, and the
    // ground's lines the same by the fog; the far side of the sphere takes FAR_KEEP more. Straight above
    // every mark is as near as the next, so nothing changes from the 2D picture.
    const span = zmax - zmin;
    const deep = span > 1 && !top;
    const keepOf = (z, far, close, lit) => (deep && !lit ? 1 - (GRAPH3D_DEPTH_FADE * (z - zmin)) / span : 1) * (far ? GRAPH3D_FAR_KEEP : 1) * close;
    // A card the lighting leaves unlit (graphLightCards) keeps less again, but never less than its floor.
    const unlitIf = (el, kind) => (dimmed && !el.classList.contains('graph-near') ? GRAPH3D_UNLIT[kind] : null);
    for (const o of vis) {
      o.keep = keepOf(o.z, o.far, o.close, o.lit);
      o.unlit = unlitIf(o.g, 'node');
      paintNode(o.g, graph3dShare(o.keep, o.unlit));
    }
    const sp = Math.sin(Math.min(Math.PI / 2, Math.max(0, st.cam.phi)));
    const cp = Math.cos(Math.min(Math.PI / 2, Math.max(0, st.cam.phi)));
    if (st.scene.fog) {
      const mix = st.shape === 'sphere' ? GRAPH3D_DEPTH_FADE : Math.max(GRAPH3D_DEPTH_FADE, GRAPH3D_GROUND_FOG * sp);
      st.scene.fog.near = deep ? zmin : 1e9;
      st.scene.fog.far = deep ? zmin + span / mix : 1e9 + 1;
    }
    // A mark's contact shadow (show() gives each its own soft gradient): tilted, on the disc and the bowl, a
    // mark stands on the ground as a ball would, its shadow under it and showing below it, as dark as the mark
    // is kept; nothing from straight above or on the sphere.
    const round = st.morph ? (st.morph.from === 'sphere' ? 1 - st.morph.e : st.morph.to === 'sphere' ? st.morph.e : 0) : st.shape === 'sphere' ? 1 : 0;
    const shade = top ? 0 : (1 - round) * sp;
    for (const o of vis) {
      const sh = st.shadows.get(o.n.id);
      if (!sh) continue;
      const dark = shade > 0 && !o.far ? Math.round(GRAPH3D_SHADOW * shade * o.keep * (o.unlit ? o.unlit.dim : 1) * 1000) / 1000 : 0;
      if (sh.dark !== dark) { sh.dark = dark; sh.grad.style.setProperty('--graph-3d-shadow', String(dark)); }
      if (!dark) continue;
      const r = o.n.reach || o.n.r || 5;
      sh.el.setAttribute('cy', graph3dR(r * (1.1 * sp + 0.1)));
      sh.el.setAttribute('rx', graph3dR(1.2 * r));
      sh.el.setAttribute('ry', graph3dR(Math.max(0.4 * r, 1.15 * r * cp)));
    }
    st.vis = vis.map((o) => ({ id: o.n.id, x: o.x, y: o.y, z: o.z, r: (o.n.reach || o.n.r || 5) * o.s }));
    const empty = vis.length > 0 && inView === 0 || !vis.length;
    if (empty !== st.empty) { st.empty = empty; paintLabel(); }
    // Back to front, the far side under the near side, the lit cards last, so a selected or hovered card is
    // never under a nearer dimmed one and a mark seen through the bowl's wall never over one inside it.
    const order = graph3dPaintOrder(vis);
    const key = order.map((o) => o.n.id).join(' ');
    if (key !== st.order) {
      st.order = key;
      // Moving a mark in the page takes its focus away (the card the search box's Enter went to), so it is given back.
      const had = focus && drawn.world.contains(focus) ? focus : null;
      for (const o of order) drawn.world.appendChild(o.g);
      if (had && document.activeElement !== had) had.focus({ preventScroll: true });
    }
    const k = vis.length ? sum / vis.length : 1;
    drawn.svg.classList.toggle('graph-labels-all', graphLabelsAll(k));

    // A line on the sphere is cut where it goes round to the far side: the far runs are drawn by a
    // copy of the line just under it, darkened as the far dots are.
    const pathOf = (runs) => {
      let d = '';
      for (const piece of runs) {
        let pen = false;
        for (const [x, y] of piece) {
          const q = project(at(x, y), v);
          if (!q) { pen = false; continue; }
          d += `${pen ? 'L' : 'M'}${graph3dR(q[0])} ${graph3dR(q[1])}`;
          pen = true;
        }
      }
      return d;
    };
    const texts = [];
    const byId = new Map(vis.map((o) => [o.n.id, o]));
    plan.links.forEach((l, i) => {
      let lineLs = 1;
      let lineKeep = 1;
      const pieces = st.links[i] || [];
      const split = sphere || bowl ? graph3dSplit(pieces, (pt) => isFar(at(pt[0], pt[1]))) : { near: pieces, far: [] };
      const el = drawn.linkEls[i];
      const d = pathOf(split.near);
      if (el) {
        el.setAttribute('d', d);
        // A line is as wide, and as far into the ground, as the dots at its ends are seen.
        const ends = [l.from].concat(l.kids || [l.to]).map((id) => byId.get(id)).filter(Boolean);
        const sk = ends.length ? ends.reduce((a, o) => a + o.s, 0) / ends.length : st.kHome;
        const z = ends.length ? ends.reduce((a, o) => a + o.z, 0) / ends.length : zmax;
        el.style.setProperty('--graph-3d-w', String(Math.round(graph3dLineWidth(sk, st.kHome) * 1000) / 1000));
        lineKeep = keepOf(z, false, 1, false);
        paintMark(el, graph3dShare(lineKeep, unlitIf(el, 'link')));
        if (ends.length) lineLs = Math.round((ends.reduce((a, o) => a + o.ls, 0) / ends.length) * 1000) / 1000;
      }
      if (drawn.hitEls[i]) drawn.hitEls[i].setAttribute('d', split.far.length ? pathOf(pieces) : d);
      if (el) farLink(i, el, split.far.length ? pathOf(split.far) : '', unlitIf(el, 'link'));
      const count = drawn.countEls[i];
      if (count && l.label) {
        const p = at(l.label.x, l.label.y);
        const q = project(p, v);
        const far = isFar(p);
        count.classList.toggle('graph-3d-off', !q || far);
        if (q) {
          count.setAttribute('x', graph3dR(q[0]));
          count.setAttribute('y', graph3dR(q[1]));
          count.style.setProperty('--graph-3d-s', String(lineLs));
          paintMark(count, graph3dShare(lineKeep, el ? unlitIf(el, 'count') : null));
          if (!far) texts.push({ el: count, x: q[0], y: q[1], anchor: 'middle', middle: true, size: 11 * lineLs });
        }
      }
    });

    for (const c of st.captions) {
      const p = at(c.x, c.y);
      const q = project(p, v);
      c.el.classList.toggle('graph-3d-off', !q);
      c.el.classList.toggle('graph-3d-far', !!q && isFar(p));
      if (!q) continue;
      c.el.setAttribute('x', graph3dR(q[0]));
      c.el.setAttribute('y', graph3dR(q[1]));
      const title = c.el.classList.contains('graph-block-title');
      texts.push({ el: c.el, x: q[0], y: q[1], anchor: c.el.getAttribute('text-anchor') || 'start', middle: c.el.hasAttribute('dy'), size: title ? 13 : 11, bold: title });
      const keep = keepOf(q[2], isFar(p), 1, false);
      paintMark(c.el, keep);
      for (const name of c.names) paintMark(name, keep);
    }

    if (st.shape === 'disc' && !st.morph && top && vis.length) placeNamesAsIn2D(vis[0].s);
    else placeLabels(vis, texts);
  };

  const farLink = (i, el, d, unlit) => {
    let f = st.farLinks[i];
    if (!d) { if (f) f.setAttribute('d', ''); return; }
    if (!f) {
      f = el.cloneNode(false);
      f.removeAttribute('marker-end');
      st.farLinks[i] = f;
    }
    if (f.nextSibling !== el) el.parentNode.insertBefore(f, el);
    f.setAttribute('class', `${el.getAttribute('class')} graph-3d-far`);
    paintMark(f, graph3dShare(GRAPH3D_FAR_KEEP, unlit));
    f.style.setProperty('--graph-3d-w', el.style.getPropertyValue('--graph-3d-w') || '1');
    f.setAttribute('d', d);
  };

  // The cards that carry their names: the 2D Graph's own choice (graphFanNames), which follows the selection.
  const namedNow = () => {
    return graphFanNames(st.view.model, graphLoadOptions().names, { selectedIds, loneCardId: graphLoneCardId() });
  };

  // A card's id beside its dot: on the right, where 2D has it (straight above at 2D's own offset, `o`
  // absent), else 3 px past the dot as drawn (o: its mark scale s and label scale ls) on the right, the
  // left or under it, whichever has room.
  const idSide = (n, g, slot, o) => {
    const gap = o ? n.reach + (3 * o.ls) / o.s : n.reach + 3;
    const x = slot === 'below' || slot === 'above' ? 0 : slot === 'left' ? -gap : gap;
    const off = o ? n.reach + (3 + 7 * o.ls) / o.s : 0;
    const y = slot === 'below' ? off : slot === 'above' ? -off : 0;
    const key = `${graph3dR(x)} ${graph3dR(y)} ${slot}`;
    if (st.idSide.get(n.id) === key) return;
    st.idSide.set(n.id, key);
    const id = g.querySelector('.graph-node-id');
    if (!id) return;
    id.setAttribute('x', graph3dR(x));
    if (y) id.setAttribute('y', graph3dR(y));
    else id.removeAttribute('y');
    id.setAttribute('text-anchor', slot === 'below' || slot === 'above' ? 'middle' : slot === 'left' ? 'end' : 'start');
  };

  const textWidth = (text, size, bold) => graphMeasureName(text, size, bold);

  // Straight down on the disc the picture is the 2D view's, so the names go where the 2D view puts them
  // (graphNamesPlace, graph-names.js, at the scale the camera sees the plane at), leaders and rows included.
  const placeNamesAsIn2D = (k) => {
    const { plan, layout, drawn, model } = st.view;
    const named = namedNow();
    const lit = graphRestLit(model, { selectedIds, loneCardId: graphLoneCardId() }, plan.links);
    const input = {
      plan, rim: graphNamesRim(layout), named, keep: lit ? lit.nodes : [], k: Math.round(k * 10000) / 10000,
      labelsAll: drawn.svg.classList.contains('graph-labels-all'), measure: graphMeasureName, font: graphNamesFont(),
    };
    const key = graphNamesKey(input);
    if (!st.names || st.names.key !== key) st.names = { key, result: graphNamesPlace(input) };
    const names = st.names.result;
    st.namesMode = 'top';
    for (const n of plan.nodes) {
      const g = drawn.nodeEls.get(n.id);
      const els = drawn.nameEls.get(n.id);
      if (!g) continue;
      g.classList.remove('graph-3d-noid');
      idSide(n, g, 'right');
      if (!els) continue;
      const p = names ? names.placed.get(n.id) : null;
      g.classList.toggle('graph-named', named.has(n.id));
      g.classList.toggle('graph-placed', !!p);
      g.classList.toggle('graph-called', !!(p && p.leader));
      els.text.textContent = p ? p.text : n.name;
      els.text.setAttribute('x', p ? graph3dR(p.x - n.x) : n.reach + 3);
      els.text.setAttribute('y', p ? graph3dR(p.y - n.y) : 0);
      els.text.setAttribute('text-anchor', p ? p.anchor : 'start');
      els.leader.setAttribute('d', p && p.leader ? p.leader.d : '');
    }
  };

  // Tilted, turned, bent or flown into, each frame keeps the labels apart (graph3dPick): the hovered
  // card and the selection first, then the largest as drawn (the nearest). A card's name goes beside its
  // dot where it meets no other label and no dot as near as its own, else its id does, on the right, the
  // left or under it; an id with no room is not shown, nor are a link's count or a caption that would sit
  // on any dot or a label. A label may lie over a dot well behind its own. Each label is as large as its
  // dot is near (--graph-3d-s). The ids of the far side come last, where room is left.
  const placeLabels = (vis, texts) => {
    const { plan, drawn } = st.view;
    const named = namedNow();
    if (st.namesMode !== 'tilt') {
      st.namesMode = 'tilt';
      for (const n of plan.nodes) {
        const g = drawn.nodeEls.get(n.id);
        const els = drawn.nameEls.get(n.id);
        if (!g || !els) continue;
        g.classList.remove('graph-called');
        els.text.textContent = n.name;
        els.text.setAttribute('x', n.reach + 3);
        els.text.setAttribute('y', 0);
        els.text.setAttribute('text-anchor', 'start');
        els.leader.setAttribute('d', '');
      }
    }
    const labelsAll = drawn.svg.classList.contains('graph-labels-all');
    const dim = drawn.svg.classList.contains('graph-dim');
    const rank = (o) => (o.g.classList.contains('hover-highlight') ? 4 : 0) + (o.g.classList.contains('selected') ? 2 : 0) + (dim && o.g.classList.contains('graph-near') ? 1 : 0);
    const near = vis.filter((o) => !o.far).sort((a, b) => rank(b) - rank(a) || b.ls - a.ls || b.s - a.s || a.z - b.z);
    const back = vis.filter((o) => o.far).sort((a, b) => a.z - b.z);
    const blockers = vis.map((o) => {
      const r = o.n.reach * o.s + 2;
      return { key: o.n.id, far: o.far, z: o.z, box: { x0: o.x - r, x1: o.x + r, y0: o.y - r, y1: o.y + r } };
    });
    const line = (x0, w, y, k) => ({ x0, x1: x0 + w, y0: y - 7 * k, y1: y + 7 * k });
    const items = [];
    const kinds = new Map();
    const ID_SLOTS = ['right', 'left', 'below'];
    const idBoxes = (o) => {
      const w = textWidth(String(o.n.id)) * o.ls;
      const gap = o.n.reach * o.s + 3 * o.ls;
      return [line(o.x + gap, w, o.y, o.ls), line(o.x - gap - w, w, o.y, o.ls), line(o.x - w / 2, w, o.y + o.n.reach * o.s + 3 + 7 * o.ls, o.ls)];
    };
    for (const o of near) {
      const boxes = [];
      const kind = [];
      if (named.has(o.n.id) && o.n.name) {
        const box = line(o.x + (o.n.reach + 3) * o.s, textWidth(o.n.name) * o.ls, o.y, o.ls);
        if (box.x1 < st.w && box.y0 > 0 && box.y1 < st.h) { boxes.push(box); kind.push('name'); }
      }
      const forced = rank(o) > 0;
      if (labelsAll || forced || o.g.classList.contains('graph-hub') || o.n.reach * o.s > 4) {
        const idb = idBoxes(o);
        boxes.push(...idb);
        kind.push(...ID_SLOTS);
        // A forced label with no room anywhere stands on the right, where 2D has it.
        if (forced) { boxes.push(idb[0]); kind.push('right'); }
      }
      if (boxes.length) { items.push({ key: o.n.id, boxes, force: forced, own: o.n.id, overFar: true, z: o.z }); kinds.set(o.n.id, kind); }
    }
    texts.forEach((t, i) => {
      const w = textWidth(t.el.textContent, t.size, t.bold);
      const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
      const box = t.middle ? line(x0, w, t.y, t.size / 11) : { x0, x1: x0 + w, y0: t.y - t.size, y1: t.y + 3 };
      items.push({ key: `text ${i}`, boxes: [box] });
    });
    for (const o of back) {
      // Painted under the near side, a far id lies over no near dot, and over a far one only well behind it;
      // it may also stand above its dot, where the near side often leaves room.
      const w = textWidth(String(o.n.id)) * o.ls;
      const above = line(o.x - w / 2, w, o.y - o.n.reach * o.s - 3 - 7 * o.ls, o.ls);
      items.push({ key: o.n.id, boxes: [...idBoxes(o), above], own: o.n.id, under: true, z: o.z });
      kinds.set(o.n.id, [...ID_SLOTS, 'above']);
    }
    const shown = graph3dPick(items, blockers);
    for (const o of vis) {
      const took = shown.get(o.n.id);
      const kind = took === undefined ? null : kinds.get(o.n.id)[took];
      o.g.classList.toggle('graph-named', named.has(o.n.id));
      o.g.classList.toggle('graph-placed', kind === 'name');
      o.g.classList.toggle('graph-3d-noid', !kind);
      if (kind && kind !== 'name') idSide(o.n, o.g, kind, o);
    }
    texts.forEach((t, i) => { if (!shown.has(`text ${i}`)) t.el.classList.add('graph-3d-off'); });
  };

  // --- the camera ------------------------------------------------------------------------------

  const fovMin = () => {
    const v = (GRAPH3D_FOV * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(v / 2) * (st.w / st.h));
    return Math.min(v, hfov);
  };

  // The camera on the move (a drag, a coast, a flight, a zoom, a morph) lights nothing under the pointer and
  // shows no tip: the pointer's light and its tip go out when it starts (a card the focus is on keeps its
  // light), and come back on the next move of the pointer once the camera has stopped (rearm).
  const moving = () => !!(st.drag && st.drag.moved) || !!st.pinch || !!st.spin || !!st.fly || !!st.zoom || !!st.morph;
  const quietHover = () => {
    if (!st.armed) return;
    st.armed = false;
    graphHideTip();
    const focus = document.activeElement;
    const held = focus && focus.closest && focus.closest('.graph-node');
    if (hoveredId != null && !(held && held.dataset.id === hoveredId)) setHoveredId(null);
    graphSettleFocus();
  };
  const rearm = (e) => {
    st.armed = true;
    const g = e.target && e.target.closest ? e.target.closest('.graph-node') : null;
    if (!g || !root.contains(g)) return;
    setHoveredId(g.dataset.id);
    graphSettleFocus();
    if (g.hasAttribute('data-tip')) graphShowTip(g);
  };

  const flyTo = (to, now) => {
    const c = st.cam;
    if (!now) quietHover();
    graphHideTip();
    st.zoom = null;
    st.spin = null;
    if (now) { Object.assign(c, to); st.fly = null; request(); return; }
    st.fly = { from: Object.assign({}, c), to: Object.assign({}, c, to), t0: performance.now(), ms: GRAPH3D_FLY_MS };
    request();
  };

  // The points that stand for the whole shape as it is now: every dot, the block's corners, the rim, and the
  // body of the bowl and of the sphere, in the scene.
  const fitPoints = () => {
    const { plan } = st.view;
    const pts = plan.nodes.map((n) => [n.x, n.y]);
    if (plan.block) { const b = plan.block; pts.push([b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]); }
    const reach = st.shape === 'sphere' ? Math.max(st.rim, st.outer || 0) * GRAPH3D_SPHERE_REACH : st.rim;
    const rings = st.shape === 'sphere' ? [0.25, 0.5, 0.75, st.rim / reach] : st.shape === 'half' ? [0.5, 1] : [1];
    for (const f of rings) for (let k = 0; k < 32; k++) pts.push([Math.cos((k / 32) * 2 * Math.PI) * reach * f, Math.sin((k / 32) * 2 * Math.PI) * reach * f]);
    if (st.shape === 'half') pts.push([0, 0]);
    return pts.map(([x, y]) => graph3dPlace(st.shape, x, y, st.rim, st.outer));
  };

  // Where the camera stands to see the whole shape at the tilt phi and turn theta, as big as the stage
  // allows: nearer as the disc tilts and its rows are seen shorter. On the disc it is the 2D Graph's own
  // fit (graphFit) from straight above, so the 3D view opens on the picture the 2D one shows, scaled and
  // moved by as much as the shape's own fit changes from there (graph3dFit).
  const fitView = (phi, theta) => {
    const P = fitPoints();
    const tv = Math.tan((GRAPH3D_FOV * Math.PI) / 360);
    const th = tv * (st.w / st.h);
    const { layout } = st.view;
    if (st.shape === 'disc' && layout && layout.bounds) {
      const fit = graphFit(layout.bounds, st.w, st.h, GRAPH3D_FIT_PAD);
      st.kHome = fit.k;
      const base = [(st.w / 2 - fit.x) / fit.k, 0, (st.h / 2 - fit.y) / fit.k];
      const dist = st.h / (2 * fit.k * tv);
      const above = graph3dFit(P, base, graph3dBasis(0, 0), th, tv, GRAPH3D_FILL);
      const now = graph3dFit(P, base, graph3dBasis(phi, theta), th, tv, GRAPH3D_FILL);
      const m = (k) => base[k] + now.shift[k] - above.shift[k];
      return { tx: m(0), ty: m(1), tz: m(2), dist: above.dist > 0 ? (dist * now.dist) / above.dist : dist, phi, theta };
    }
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of P) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    const fit = graph3dFit(P, c, graph3dBasis(phi, theta), th, tv, GRAPH3D_FILL);
    return { tx: c[0] + fit.shift[0], ty: c[1] + fit.shift[1], tz: c[2] + fit.shift[2], dist: Math.max(60, fit.dist), phi, theta };
  };

  // H: everything, at the tilt the camera has. `side` (H, and a shape seen straight down): the bowl and the
  // sphere from a three-quarter view, where they read as a bowl and a ball rather than as the disc again.
  // Until a zoom or a pan takes over (st.fitted), an orbit keeps the whole shape fitted to the stage.
  const frameAll = (now, side) => {
    let { phi, theta } = st.cam;
    const max = graph3dMaxTilt(st.shape);
    if (side && st.shape !== 'disc') { phi = GRAPH3D_SHAPE_TILT; theta = Math.round(theta / (2 * Math.PI)) * 2 * Math.PI; }
    else if (phi > max) phi = max;
    st.fitted = true;
    const to = fitView(phi, theta);
    st.fitDist = to.dist;
    flyTo(to, now);
  };

  // The cards `ids` (with `focus`, the one the camera looks at, else their middle) brought to the middle of
  // the stage with room round them; on the sphere the camera turns round to see the focus face on, so a
  // card on the far side comes to the front.
  const frameCards = (ids, focus) => {
    const nodes = st.view.plan.nodes.filter((n) => ids.has(String(n.id)));
    if (!nodes.length) return false;
    const P = nodes.map((n) => graph3dPlace(st.shape, n.x, n.y, st.rim, st.outer));
    const main = focus == null ? null : nodes.find((n) => String(n.id) === String(focus));
    let c;
    if (main) c = graph3dPlace(st.shape, main.x, main.y, st.rim, st.outer);
    else {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const p of P) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    }
    const to = { tx: c[0], ty: c[1], tz: c[2], phi: Math.min(st.cam.phi, graph3dMaxTilt(st.shape)), theta: st.cam.theta };
    const face = st.shape === 'sphere' ? graph3dFacing(main ? c : graph3dSnap('sphere', c, st.rim, st.outer), st.cam.theta) : null;
    if (face) Object.assign(to, face);
    const tv = Math.tan((GRAPH3D_FOV * Math.PI) / 360);
    const fit = graph3dFit(P, c, graph3dBasis(to.phi, to.theta), tv * (st.w / st.h), tv, GRAPH3D_CARD_FILL, true);
    to.dist = Math.max(fit.dist, st.h / (2 * tv * GRAPH3D_CARD_SCALE));
    st.fitted = false;
    flyTo(to, false);
    return true;
  };

  // The search box's Enter: the card it found, with its parent and its children round it.
  const centerOn = (id) => {
    frameCards(graph3dKin(st.view.plan.links, id), id);
  };

  // F: the selection (a lone card with its kin), or everything when nothing is selected.
  const frameSelection = () => {
    const sel = [...selectedIds].map(String);
    const ids = sel.length === 1 ? graph3dKin(st.view.plan.links, sel[0]) : new Set(sel);
    if (!frameCards(ids, sel.length === 1 ? sel[0] : null)) frameAll(false);
  };

  // The wheel, a pinch and the zoom buttons: the camera eases (the frame loop) to `st.zoom`, which each
  // step moves on from where the last one asked for. Zooming in heads for what is under the pointer: the
  // dot there (with a click's tolerance) or the shape. At the closest the camera stops coming nearer and
  // skims along the shape toward the pointer, so it passes among the dots rather than through the ground.
  const zoomAt = (px, py, f) => {
    const T = st.T;
    applyCamera();
    const goal = st.zoom || { tx: st.cam.tx, ty: st.cam.ty, tz: st.cam.tz, dist: st.cam.dist, phi: st.cam.phi };
    const ndc = new T.Vector3(((px + st.ox) / st.cw) * 2 - 1, -((py + st.oy) / st.ch) * 2 + 1, 0.5);
    const dir = ndc.unproject(st.camera).sub(st.camera.position).normalize();
    const look = new T.Vector3(0, 0, -1).applyQuaternion(st.camera.quaternion);
    const target = new T.Vector3(goal.tx, goal.ty, goal.tz);
    const eye = st.camera.position;
    const o = [eye.x, eye.y, eye.z];
    const dotId = f < 1 ? graph3dNearest(st.vis, px, py, GRAPH3D_PICK_TOL) : null;
    const dotNode = dotId == null ? null : st.view.plan.nodes.find((n) => n.id === dotId);
    const hit = dotNode ? graph3dPlace(st.shape, dotNode.x, dotNode.y, st.rim, st.outer)
      : f < 1 ? graph3dRayHit(st.shape, o, [dir.x, dir.y, dir.z], st.rim, st.outer) : null;
    const want = goal.dist * f;
    const closest = st.h / (2 * Math.tan((GRAPH3D_FOV * Math.PI) / 360) * GRAPH3D_CLOSEST_SCALE);
    if (hit) {
      target.lerp(new T.Vector3(hit[0], hit[1], hit[2]), 1 - f);
      if (want < closest) {
        const p = graph3dSnap(st.shape, [target.x, target.y, target.z], st.rim, st.outer);
        target.set(p[0], p[1], p[2]);
        if (st.shape !== 'sphere' && goal.phi < GRAPH3D_SKIM_TILT) goal.phi = Math.min(GRAPH3D_SKIM_TILT, goal.phi + 0.12);
      }
      goal.dist = Math.max(closest, want);
    } else if (f < 1) {
      // Toward empty space: nearer, never past the closest, and on the sphere never inside it.
      const inside = st.shape === 'sphere' ? graph3dSphereRadius('sphere', st.rim, st.outer) - target.length() : 0;
      goal.dist = Math.max(closest, inside + closest, want);
    } else {
      const onPlane = eye.clone().addScaledVector(dir, goal.dist / Math.max(0.05, dir.dot(look)));
      target.lerp(onPlane, 1 - f);
      goal.dist = Math.min(want, st.rim * 40);
    }
    goal.tx = target.x; goal.ty = target.y; goal.tz = target.z;
    st.zoom = goal;
    st.fitted = false;
    st.fly = null;
    st.spin = null;
    endHint();
    quietHover();
    request();
  };

  const orbit = (dx, dy) => {
    const c = st.cam;
    c.theta -= (Math.PI * dx) / st.h;
    c.phi = Math.min(graph3dMaxTilt(st.shape), Math.max(0, c.phi - (Math.PI * dy) / st.h));
    if (st.fitted && st.view) { Object.assign(c, fitView(c.phi, c.theta)); st.fitDist = c.dist; }
  };

  const pan = (dx, dy) => {
    const T = st.T;
    const c = st.cam;
    const wpp = (2 * c.dist * Math.tan((GRAPH3D_FOV * Math.PI) / 360)) / st.h;
    const right = new T.Vector3(1, 0, 0).applyQuaternion(st.camera.quaternion);
    const up = new T.Vector3(0, 1, 0).applyQuaternion(st.camera.quaternion);
    c.tx += (-right.x * dx + up.x * dy) * wpp;
    c.ty += (-right.y * dx + up.y * dy) * wpp;
    c.tz += (-right.z * dx + up.z * dy) * wpp;
  };

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

  function frame() {
    st.raf = 0;
    if (st.gone || !st.view) return;
    const now = performance.now();
    const dt = Math.min(64, Math.max(1, now - (st.tick || now - 16)));
    st.tick = now;
    let more = false;
    if (st.zoom) {
      const a = 1 - Math.exp(-dt / GRAPH3D_ZOOM_TAU);
      const c = st.cam, z = st.zoom;
      for (const k of ['tx', 'ty', 'tz', 'dist', 'phi']) c[k] += (z[k] - c[k]) * a;
      if (Math.abs(z.dist - c.dist) < z.dist * 0.002 && Math.hypot(z.tx - c.tx, z.ty - c.ty, z.tz - c.tz) < 0.05 && Math.abs(z.phi - c.phi) < 0.002) {
        Object.assign(c, z);
        st.zoom = null;
      } else more = true;
    }
    if (st.spin) {
      orbit(st.spin.vx * dt, st.spin.vy * dt);
      st.spin = graph3dCoast(st.spin, dt);
      if (st.spin) more = true;
    }
    if (st.morph) {
      const t = Math.min(1, (now - st.morph.t0) / GRAPH3D_MORPH_MS);
      st.morph.e = ease(t);
      if (t >= 1) st.morph = null;
      else more = true;
    }
    if (st.fly) {
      const t = Math.min(1, (now - st.fly.t0) / st.fly.ms);
      const e = ease(t);
      for (const k of ['tx', 'ty', 'tz', 'dist', 'theta', 'phi']) st.cam[k] = st.fly.from[k] + (st.fly.to[k] - st.fly.from[k]) * e;
      if (t >= 1) st.fly = null;
      else more = true;
    }
    applyCamera();
    placeGround();
    placeMarks();
    paintGround();
    st.renderer.render(st.scene, st.camera);
    if (more) request();
    else st.tick = 0;
  }

  const setShape = (shape) => {
    const from = st.shape;
    if (shape === from) return;
    st.morph = { from: st.morph ? st.morph.to : from, to: shape, t0: performance.now(), e: 0 };
    st.shape = shape;
    paintLabel();
    quietHover();
    st.zoom = null;
    st.spin = null;
    frameAll(false, st.cam.phi < 0.3);
    if (st.fly) st.fly.ms = GRAPH3D_MORPH_MS;
    request();
  };

  // --- input -------------------------------------------------------------------------------------

  const endDrag = (moved) => {
    root.classList.remove('graph-3d-dragging');
    if (!moved) return;
    isDragging = false;
    graphSwallowNextClick();
  };

  const startPinch = () => {
    const [a, b] = [...st.pointers.values()];
    if (st.drag) { const d = st.drag; st.drag = null; endDrag(d.moved); }
    st.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    isDragging = true;
    quietHover();
  };

  // The right button orbits when it drags and opens the card menu when it does not. The browser asks
  // for the menu when the button goes down on some systems and when it comes up on others, so while the
  // button is down its contextmenu is held back (st.right.held) and sent again once the button comes up
  // without a drag; after a drag the one that may still come is swallowed. A menu asked for with no
  // right press (the keyboard's Menu key) passes as it is.
  const forgetRight = () => {
    clearTimeout(st.rightTimer);
    st.rightTimer = 0;
    st.right = null;
  };
  const rightUp = () => {
    const r = st.right;
    if (!r || !r.down) return;
    r.down = false;
    if (r.moved || !r.held) {
      clearTimeout(st.rightTimer);
      st.rightTimer = setTimeout(forgetRight, GRAPH3D_MENU_HOLD_MS);
      return;
    }
    forgetRight();
    const at = r.held.target.isConnected ? r.held.target : document.elementFromPoint(r.held.x, r.held.y);
    if (!at) return;
    st.replaying = true;
    try {
      at.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.held.x, clientY: r.held.y, view: window }));
    } finally { st.replaying = false; }
  };

  root.addEventListener('pointerdown', (e) => {
    // The 2D Graph's own pan and pinch (wireGraphView) stay out of the 3D view.
    e.stopPropagation();
    if (!st.renderer) return;
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    st.spin = null;
    // A press with the camera still (a tap, a click) lets the pointer light again.
    if (!st.armed && !moving()) st.armed = true;
    endHint();
    if (e.pointerType === 'touch' && st.pointers.size === 2) { startPinch(); return; }
    if (st.drag || st.pinch) return;
    if (e.pointerType !== 'touch' && e.button === 2) {
      forgetRight();
      st.right = { down: true, moved: false, held: null };
    }
    const mode = graph3dDragMode(e);
    if (!mode) return;
    st.drag = { id: e.pointerId, mode, button: e.button, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, trail: [] };
  });
  // While the camera is quiet (quietHover), the pointer's mouseover and mouseout reach neither the Graph's
  // lighting nor its tip.
  const hush = (e) => { if (!st.armed) e.stopPropagation(); };
  root.addEventListener('mouseover', hush, true);
  root.addEventListener('mouseout', hush, true);
  root.addEventListener('pointermove', (e) => {
    const last = st.quietAt;
    st.quietAt = { x: e.clientX, y: e.clientY };
    if (!st.armed && !moving() && e.pointerType !== 'touch' && last && Math.hypot(e.clientX - last.x, e.clientY - last.y) > 0.5) rearm(e);
    if (st.pointers.has(e.pointerId)) st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pinch) {
      if (st.pointers.size < 2) return;
      const [a, b] = [...st.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const rect = root.getBoundingClientRect();
      zoomAt((a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, st.pinch.d / d);
      st.pinch.d = d;
      return;
    }
    const d = st.drag;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= GRAPH3D_DRAG) return;
      d.moved = true;
      if (d.button === 2 && st.right) st.right.moved = true;
      isDragging = true;
      root.classList.add('graph-3d-dragging');
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer can't be captured */ }
      quietHover();
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.mode === 'orbit') {
      orbit(dx, dy);
      const t = performance.now();
      d.trail.push({ t, dx, dy });
      while (d.trail.length && t - d.trail[0].t > 80) d.trail.shift();
    } else { pan(dx, dy); st.fitted = false; }
    st.fly = null;
    st.zoom = null;
    request();
  });
  const finish = (e) => {
    st.pointers.delete(e.pointerId);
    if (st.pinch) {
      if (st.pointers.size < 2) {
        st.pinch = null;
        isDragging = false;
        graphSwallowNextClick();
      }
      return;
    }
    const d = st.drag;
    if (!d || d.id !== e.pointerId) return;
    st.drag = null;
    endDrag(d.moved);
    if (d.button === 2) {
      if (e.type === 'pointerup') rightUp();
      else forgetRight();
    }
    // A released orbit coasts on at the speed of its last 80 ms, then slows to a stop.
    const t = performance.now();
    const trail = d.moved && d.mode === 'orbit' && e.type === 'pointerup' ? d.trail.filter((m) => t - m.t <= 80) : [];
    if (trail.length > 1) {
      const span = Math.max(16, t - trail[0].t);
      const sx = trail.reduce((a, m) => a + m.dx, 0), sy = trail.reduce((a, m) => a + m.dy, 0);
      st.spin = graph3dCoast({ vx: sx / span, vy: sy / span }, 0);
      st.tick = 0;
      request();
    }
  };
  // A click or a double click a little off a dot means that dot; a double click on empty ground frames
  // everything. Told by the second click's count rather than by dblclick: the first click may redraw the
  // marks (a selection's light going out), and the browser fires no dblclick across two elements.
  const nearDot = (e) => {
    if (e.target.closest && e.target.closest('.graph-node, .graph-caption, .graph-block-title, .graph-block-caption, .graph-3d-label')) return null;
    const rect = root.getBoundingClientRect();
    return graph3dNearest(st.vis, e.clientX - rect.left, e.clientY - rect.top, GRAPH3D_PICK_TOL);
  };
  root.addEventListener('click', (e) => {
    if (!st.renderer || !st.view || e.button !== 0) return;
    const id = nearDot(e);
    if (id == null) {
      if (e.detail === 2 && e.target.closest && e.target.closest('.graph-canvas') && !e.target.closest('.graph-node')) frameAll(false, true);
      return;
    }
    if (e.detail === 2) return;
    hideContextMenu();
    graphClickNode(String(id), e);
  });
  // A double click opens the card it is on, or the dot it is a little off: told by the second press's count
  // and opened once its click is through, as the 2D Graph's dblclick does. The first click may redraw the
  // marks (a selection), and the browser then fires no dblclick, so the 2D Graph's own is not waited for.
  root.addEventListener('mouseup', (e) => {
    if (!st.renderer || !st.view || e.button !== 0 || e.detail !== 2) return;
    const node = e.target.closest && e.target.closest('.graph-node');
    const id = node ? node.dataset.id : nearDot(e);
    if (id == null) return;
    if (!graphDblClickOpens({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, phone: onPhoneLayout() })) return;
    setTimeout(() => { if (!st.gone) openCard(String(id)); }, 0);
  });
  root.addEventListener('dblclick', (e) => { if (st.renderer) e.stopPropagation(); });
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);
  // A touch is captured by the mark it lands on until the drag takes it over; only the root's own loss ends a drag.
  root.addEventListener('lostpointercapture', (e) => { if (e.target === root && st.drag && st.drag.id === e.pointerId && st.drag.moved) finish(e); });
  root.addEventListener('contextmenu', (e) => {
    const r = st.right;
    if (st.replaying || !r) return;
    if (r.down) {
      if (!r.moved && !r.held) r.held = { target: e.target, x: e.clientX, y: e.clientY };
    } else {
      forgetRight();
      if (!r.moved) return;
    }
    e.preventDefault();
    e.stopPropagation();
  });
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!st.renderer) return;
    const rect = root.getBoundingClientRect();
    const steps = Math.max(-4, Math.min(4, e.deltaY / 100)) || Math.sign(e.deltaY);
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, GRAPH3D_WHEEL ** -steps);
  }, { passive: false });

  // --- life ------------------------------------------------------------------------------------

  const init = (T) => {
    st.T = T;
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'graph-3d-canvas';
    root.insertBefore(renderer.domElement, root.firstChild);
    st.renderer = renderer;
    st.scene = new T.Scene();
    st.camera = new T.PerspectiveCamera(GRAPH3D_FOV, 1, 1, 100000);
    st.scene.fog = new T.Fog(0x000000, 1e9, 1e9 + 1);
    st.ro = new ResizeObserver(() => { measure(); request(); });
    st.ro.observe(root);
    watchDpr();
  };

  // A window moved to a screen of another pixel ratio draws the ground at that ratio.
  const watchDpr = () => {
    if (st.gone) return;
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const on = () => {
      mq.removeEventListener('change', on);
      st.dprWatch = null;
      if (st.gone || !st.renderer) return;
      measure();
      request();
      watchDpr();
    };
    mq.addEventListener('change', on);
    st.dprWatch = { mq, on };
  };

  const show = (view) => {
    st.view = view;
    if (st.gone) return;
    if (!st.renderer) {
      root.classList.add('graph-3d-loading');
      graph3dLoadThree().then((T) => {
        if (st.gone || st.renderer) return;
        root.classList.remove('graph-3d-loading');
        init(T);
        show(st.view);
      }).catch((err) => {
        if (st.gone) return;
        label.textContent = String(err && err.message || err);
        console.error('graph3d: three.js failed', err);
      });
      return;
    }
    const { drawn, plan } = view;
    st.rim = graph3dRim(plan);
    st.outer = graph3dOuter(plan);
    st.links = plan.links.map((l) => graph3dPathPoints(l.d, 8));
    st.farLinks = [];
    st.namesMode = '';
    st.idSide = new Map();
    const holders = [...plan.captions];
    if (plan.looseCaption) holders.push(plan.looseCaption);
    if (plan.block) holders.push(plan.block.title, ...plan.block.columns.map((col) => col.caption));
    const capEls = drawn.world.querySelectorAll('text.graph-caption, text.graph-block-title, text.graph-block-caption');
    st.captions = holders.map((c, k) => ({ x: c.x, y: c.y, el: capEls[k] })).filter((c) => c.el)
      .map((c) => Object.assign(c, { names: [...c.el.querySelectorAll('.graph-caption-name')] }));
    // A dot's tip: the 2D drawing's title, shown in the stage's own tooltip (graphShowTip), which a
    // pointer resting on a moving mark finds more readily than the browser's.
    // Each mark gets its contact shadow under it (placeMarks shapes it), filled with a soft round gradient
    // of its own, so each can be as dark as its mark is kept (--graph-3d-shadow, app.css).
    const NS = 'http://www.w3.org/2000/svg';
    let defs = drawn.svg.querySelector('defs.graph-3d-shadows');
    if (!defs) {
      defs = document.createElementNS(NS, 'defs');
      defs.setAttribute('class', 'graph-3d-shadows');
      drawn.svg.insertBefore(defs, drawn.svg.firstChild);
    }
    st.shadows = new Map();
    plan.nodes.forEach((n, k) => {
      const g = drawn.nodeEls.get(n.id);
      if (!g) return;
      const title = g.querySelector('title');
      if (title) { g.setAttribute('data-tip', title.textContent); title.remove(); }
      const id = `graph-3d-shadow-${k}`;
      let grad = defs.querySelector(`#${id}`);
      if (!grad) {
        grad = document.createElementNS(NS, 'radialGradient');
        grad.setAttribute('id', id);
        for (const [at, part] of [['0', 'core'], ['0.55', 'mid'], ['1', 'edge']]) {
          const stop = document.createElementNS(NS, 'stop');
          stop.setAttribute('offset', at);
          stop.setAttribute('class', `graph-3d-shadow-${part}`);
          grad.appendChild(stop);
        }
        defs.appendChild(grad);
      }
      let el = g.firstChild;
      if (!(el && el.classList && el.classList.contains('graph-3d-shadow'))) {
        el = document.createElementNS(NS, 'ellipse');
        el.setAttribute('class', 'graph-3d-shadow');
        el.setAttribute('fill', `url(#${id})`);
        g.insertBefore(el, g.firstChild);
      }
      st.shadows.set(n.id, { el, grad, dark: null });
    });
    if (st.overlay !== drawn.stage) {
      if (st.overlay) st.overlay.remove();
      st.overlay = drawn.stage;
      root.insertBefore(drawn.stage, label);
      st.order = '';
    }
    measure();
    const key = [plan.tints.map((t) => t.d).join(), plan.guides.map((g) => g.d).join(), plan.dividers.map((d) => [d.x1, d.y1, d.x2, d.y2].join()).join(), plan.block ? [plan.block.x, plan.block.y, plan.block.w, plan.block.h].join() : ''].join('|');
    if (key !== st.groundKey) {
      st.groundKey = key;
      buildGround(plan, drawn.svg);
    } else recolourGround(drawn.svg);
    shadowInk(drawn.svg);
    st.groundAt = '';
    if (!st.framed) { st.framed = true; frameAll(true); }
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = 0; }
    frame();
  };

  const destroy = () => {
    if (st.gone) return;
    st.gone = true;
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0;
    clearTimeout(st.hintTimer);
    clearTimeout(st.rightTimer);
    if (st.dprWatch) st.dprWatch.mq.removeEventListener('change', st.dprWatch.on);
    st.dprWatch = null;
    window.removeEventListener('keydown', graph3dOnKey, true);
    st.scheme.removeEventListener('change', onTheme);
    st.themeWatch.disconnect();
    if (st.ro) st.ro.disconnect();
    if ((st.drag && st.drag.moved) || st.pinch) isDragging = false;
    if (st.renderer) {
      disposeGround();
      st.renderer.dispose();
      st.renderer.domElement.remove();
      st.renderer = null;
    }
    root.remove();
  };

  window.addEventListener('keydown', graph3dOnKey, true);
  // The colours are read off the stylesheet, so a change of theme (the system's or the page's own
  // data-theme) reads them again: the ground's, the marks' inks and the shadows'.
  function onTheme() {
    if (st.gone || !st.renderer || !st.view) return;
    st.theme++;
    recolourGround(st.view.drawn.svg);
    shadowInk(st.view.drawn.svg);
    request();
  }
  st.scheme = matchMedia('(prefers-color-scheme: dark)');
  st.scheme.addEventListener('change', onTheme);
  st.themeWatch = new MutationObserver(onTheme);
  st.themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return {
    root,
    show,
    destroy,
    visible,
    key(name) {
      if (!st.renderer || !st.view) return false;
      if (name === 'g') setShape(graph3dNextShape(st.shape));
      else if (name === 'f') frameSelection();
      else if (name === 'h') frameAll(false, true);
      else return false;
      endHint();
      return true;
    },
    centerOn(id) { if (st.renderer && st.view) centerOn(id); },
    repaint: request,
    zoomButton(action) {
      if (!st.renderer || !st.view) return;
      if (action === 'fit') { frameAll(false); return; }
      zoomAt(st.w / 2, st.h / 2, action === 'in' ? GRAPH3D_BUTTON_ZOOM : 1 / GRAPH3D_BUTTON_ZOOM);
    },
  };
}

// G steps the shape, F frames the selection, H frames everything: through the key guard, so never while
// a field has focus or a menu or dialog is up, and only while the 3D view is on the page.
function graph3dOnKey(e) {
  if (keyGuardOff(document)) return;
  const cur = graph3dCur;
  if (!cur || !e.key || e.ctrlKey || e.metaKey || e.altKey || e.repeat || !cur.visible()) return;
  let name = null;
  if (e.key.toLowerCase() === 'g') name = 'g';
  else if (e.key.toLowerCase() === 'f') name = 'f';
  else if (e.key.toLowerCase() === 'h') name = 'h';
  if (name && cur.key(name)) e.preventDefault();
}

// The Graph's Hierarchy in 3D, in `main` in place of its 2D drawing: `view` = { drawn (graphDrawPlan's
// marks), plan, layout, model }. The view outlives the Graph's draws, keeping its camera and its shape.
function graph3dShow(main, view) {
  if (!graph3dCur) graph3dCur = graph3dCreate();
  main.appendChild(graph3dCur.root);
  graph3dCur.show(view);
}

function graph3dRelease() {
  if (!graph3dCur) return;
  const cur = graph3dCur;
  graph3dCur = null;
  cur.destroy();
}

function graph3dZoomButton(action) {
  if (graph3dCur) graph3dCur.zoomButton(action);
}

function graph3dCenterOn(id) {
  if (graph3dCur) graph3dCur.centerOn(id);
}

// The marks again, next frame: the 2D Graph's name painting (graphPaintNames) asks this in 3D.
function graph3dRepaint() {
  if (graph3dCur) graph3dCur.repaint();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    graph3dPathPoints, graph3dPlace, graph3dMorph, graph3dNextShape, graph3dShapeName,
    graph3dWantedIn, graph3dAddressFor, graph3dRim, graph3dOuter, graph3dFar, graph3dSplit,
    graph3dPick, graph3dTopDown, graph3dKeep, graph3dMarkScale, graph3dMaxTilt, graph3dRayHit,
    graph3dSnap, graph3dNearest, graph3dCoast, graph3dLineWidth, graph3dLabelScale, graph3dBasis,
    graph3dFit, graph3dFacing, graph3dKin, graph3dSoftCap, graph3dBowlBack, graph3dPaintOrder,
    graph3dDragMode, graph3dRgb, graph3dMix, graph3dShare, GRAPH3D_UNLIT, GRAPH3D_THREE_SRC,
  };
} else {
  window.graph3dWanted = graph3dWanted;
  window.graph3dSetWanted = graph3dSetWanted;
  window.graph3dShow = graph3dShow;
  window.graph3dRelease = graph3dRelease;
  window.graph3dZoomButton = graph3dZoomButton;
  window.graph3dCenterOn = graph3dCenterOn;
  window.graph3dRepaint = graph3dRepaint;
}
