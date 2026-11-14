'use strict';
// The 3D Hierarchy's pure helpers and its tuning: the shapes, the camera's geometry, the paint and the
// label picking. The browser part is graph-3d-view.js and the files it names; node --test requires this one.

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
// distance from the centre into an angle down from the top pole, so the centre, the cards of the
// highest level, is the top: to 90 degrees at the rim for the half, a dome whose top is the disc's
// centre and whose rim, of the rim's radius, is lowered by as much (graph3dCentre), so nothing stands
// above the disc; to 180 for the sphere. Past the rim the half stays on the plane the dome stands on.
// The sphere reaches a little past `outer` (graph3dOuter), when given, so a card past the rim, as an
// Unnested table's are, keeps a place of its own short of the bottom pole.
// The pole limits (`poles`, else the 3D options' of the shape, GRAPH3D_OPTIONS): `top`, the angle down from
// the top pole the centre stands at, and `ring`, the angle the outermost ring stands at (null: 90 degrees on
// the dome, rim / reach of the way round on the sphere); between them the angle grows linearly with the
// distance from the centre (graph3dPoleAngle). Left at their defaults, every point stands exactly where it
// did before the limits.
function graph3dPlace(shape, x, y, rim, outer, poles) {
  if (shape !== 'half' && shape !== 'sphere') return [x, 0, y];
  const r = Math.hypot(x, y);
  const b = Math.atan2(y, x);
  const pl = poles || GRAPH3D_OPTIONS.poles[shape];
  const plain = pl.top === 0 && pl.ring == null;
  if (shape === 'half') {
    if (r >= rim) return [Math.cos(b) * r, -rim, Math.sin(b) * r];
    const phi = plain ? (r / rim) * (Math.PI / 2) : graph3dPoleAngle(r, rim, rim, pl.top, pl.ring == null ? Math.PI / 2 : pl.ring);
    const rho = rim * Math.sin(phi);
    return [Math.cos(b) * rho, rim * Math.cos(phi) - rim, Math.sin(b) * rho];
  }
  const reach = Math.max(rim, outer || 0) * GRAPH3D_SPHERE_REACH;
  const radius = reach / 2;
  const phi = plain ? Math.min(1, r / reach) * Math.PI : graph3dPoleAngle(r, rim, reach, pl.top, pl.ring == null ? (rim / reach) * Math.PI : pl.ring);
  const rho = radius * Math.sin(phi);
  return [Math.cos(b) * rho, radius * Math.cos(phi), Math.sin(b) * rho];
}

// The angle down from the top pole a point `r` from the plan's centre stands at: `top` at the centre and
// `ring` at the rim, linearly between; past the rim on to the bottom pole at `reach` (the sphere's), never past it.
function graph3dPoleAngle(r, rim, reach, top, ring) {
  if (r <= rim) return top + (Math.max(0, r) / rim) * (ring - top);
  if (!(reach > rim)) return ring;
  return ring + Math.min(1, (r - rim) / (reach - rim)) * (Math.PI - ring);
}

// The pole limits a shape draws with when none are set: the centre at the top pole and the rim where it always was.
function graph3dPoleDefaults(shape, rim, outer) {
  if (shape === 'half') return { top: 0, ring: Math.PI / 2 };
  return { top: 0, ring: (rim / (Math.max(rim, outer || 0) * GRAPH3D_SPHERE_REACH)) * Math.PI };
}

// A mark's scale with the mark size option `m`: 0 the scale it is seen at in the world, 1 the
// constant `screen` scale whatever its distance, linearly between; then grown by the mark scale option `k`
// (1, the default, leaves it as it is).
function graph3dBlendScale(world, screen, m, k = 1) {
  const s = world + (screen - world) * Math.min(1, Math.max(0, m || 0));
  return k === 1 ? s : s * k;
}

// The far side option `far` (the share of its colour the far side keeps) as the two shares the marks are
// painted with: `keep`, taken before the lighting's floor (graph3dShare), never under today's
// GRAPH3D_FAR_KEEP, and `after`, taken after it, so under that share the far side fades with a card lit
// too. At GRAPH3D_FAR_KEEP both are as they were before the option.
function graph3dFarFade(far) {
  return { keep: Math.max(far, GRAPH3D_FAR_KEEP), after: Math.min(1, far / GRAPH3D_FAR_KEEP) };
}

// The 3D options a stored record says (graph3dLoadOptions), each value the record holds as a number within
// its slider's range (GRAPH3D_OPTION_RANGES, the pole angles in radians), every other the default; a ring
// left null keeps the shape's own. Always a fresh object.
function graph3dMergeOptions(saved) {
  const out = JSON.parse(JSON.stringify(GRAPH3D_OPTION_DEFAULTS));
  if (!saved || typeof saved !== 'object') return out;
  const take = (v, [lo, hi], def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  for (const k of ['size', 'scale', 'far', 'lines', 'move', 'spin']) out[k] = take(saved[k], GRAPH3D_OPTION_RANGES[k], out[k]);
  const poles = saved.poles && typeof saved.poles === 'object' ? saved.poles : {};
  for (const shape of ['half', 'sphere']) {
    const p = poles[shape] && typeof poles[shape] === 'object' ? poles[shape] : {};
    const deg = (range) => range.map((v) => (v * Math.PI) / 180);
    out.poles[shape].top = take(p.top, deg(GRAPH3D_OPTION_RANGES.top[shape]), 0);
    out.poles[shape].ring = take(p.ring, deg(GRAPH3D_OPTION_RANGES.ring[shape]), null);
  }
  return out;
}

// The middle of the shape's sphere: the dome's under its top by the rim's radius, the sphere's at 0 0 0.
function graph3dCentre(shape, rim) {
  return shape === 'half' ? [0, -rim, 0] : [0, 0, 0];
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

// Points and directions in the scene, as [x, y, z]: a less b, and a dot b.
function graph3dSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function graph3dDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Where the ray from `from` along the unit vector `dir`, both taken from a sphere's middle, crosses the
// sphere of radius `radius`: the two distances along it, nearer first, or null when it passes by.
function graph3dSphereHits(from, dir, radius) {
  const along = graph3dDot(from, dir);
  const disc = along * along - (graph3dDot(from, from) - radius * radius);
  if (disc < 0) return null;
  return [-along - Math.sqrt(disc), -along + Math.sqrt(disc)];
}

// Where the camera stands: `dist` back from its target along `back`, its basis's (graph3dBasis).
function graph3dEye(target, back, dist) {
  return target.map((v, k) => v + back[k] * dist);
}

// Whether the camera at `eye` sees the point p of the dome (the half sphere inside a rim of radius `rim`)
// from behind, past its edge as seen: the dome's own far side; and, past the rim, a point of the plane the
// dome stands between it and the camera.
function graph3dDomeBack(p, eye, rim) {
  const centre = graph3dCentre('half', rim);
  const point = graph3dSub(p, centre);
  const from = graph3dSub(eye, centre);
  if (Math.hypot(p[0], p[2]) < rim - 1e-6) return graph3dFar(point, from);
  const toEye = graph3dSub(from, point);
  const len = Math.hypot(...toEye);
  if (len < 1e-9) return false;
  const dir = toEye.map((v) => v / len);
  const hits = graph3dSphereHits(point, dir, rim);
  return !!hits && hits.some((t) => t > 1e-6 && t < len && point[1] + dir[1] * t >= 0);
}

// Whether the camera at `eye` sees the point p of the shape from behind: the far side of the sphere and
// of the dome; the disc has none.
function graph3dShapeFar(shape, p, eye, rim) {
  if (shape === 'sphere') return graph3dFar(p, eye);
  if (shape === 'half') return graph3dDomeBack(p, eye, rim);
  return false;
}

// The tilt the dome and the sphere are seen whole at (H, and G from straight above): the side view, or
// less, in steps down to SHAPE_TILT_MIN, the first from which `seesAll` says the innermost ring, the cards
// of the highest level, is all in front. When none is, the side view: the innermost ring can stand so far
// down the sphere that only a view from nearly straight above, where it reads as the disc again, shows
// all of it, and from the side its front half is in front, the rest dimmed behind the top.
const GRAPH3D_SHAPE_TILT_MIN = 0.45;
function graph3dSideTilt(seesAll) {
  for (let k = 0; GRAPH3D_SHAPE_TILT - 0.05 * k > GRAPH3D_SHAPE_TILT_MIN - 1e-9; k++) {
    const phi = Math.round((GRAPH3D_SHAPE_TILT - 0.05 * k) * 100) / 100;
    if (seesAll(phi)) return phi;
  }
  return GRAPH3D_SHAPE_TILT;
}

// A line's pieces cut into the runs on the near side and the runs on the far side (farOf), each run
// keeping the next one's first point, so the two halves meet.
function graph3dSplitFar(pieces, farOf) {
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

// The order the marks are painted in: back to front, the far side (the back of the sphere and of the
// dome) under every near mark however near it stands, and the lit cards last of all.
function graph3dPaintOrder(vis) {
  return vis.slice().sort((a, b) => (a.lit - b.lit) || (b.far - a.far) || b.z - a.z);
}

// The marks `order` (in paint order) put in that order without moving `pressed`, the mark a button is down
// on: the browser sends no click to a mark taken off the page between the press and the release, and a
// mark is taken off to be moved. The ones before it go in front of it, the rest after the last mark.
function graph3dRestack(order, pressed) {
  const at = pressed == null ? -1 : order.indexOf(pressed);
  return { before: order.slice(0, Math.max(at, 0)), after: order.slice(at + 1) };
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
function graph3dCloseFade(s) {
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
// past does not fill the stage, and on the disc and the dome a little smaller as they tilt, so rows seen
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

// How far the camera tilts from straight above: the disc and the dome to nearly edge-on, the sphere
// all the way round to under its far pole.
function graph3dMaxTilt(shape) {
  return shape === 'sphere' ? Math.PI : 1.3;
}

const graph3dSphereRadius = (shape, rim, outer) => (shape === 'half' ? rim : (Math.max(rim, outer || 0) * GRAPH3D_SPHERE_REACH) / 2);

// Where the ray from `o` along `d` (a unit vector) first meets the shape, or null: the plane for the
// disc, and past the half's rim the plane the dome stands on; the dome inside the rim, the near side of
// the sphere.
function graph3dRayHit(shape, o, d, rim, outer) {
  const at = (t) => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const hits = [];
  const floor = shape === 'half' ? -rim : 0;
  const plane = Math.abs(d[1]) > 1e-9 ? (floor - o[1]) / d[1] : -1;
  if (shape !== 'sphere' && plane > 0) {
    const p = at(plane);
    if (shape === 'disc' || Math.hypot(p[0], p[2]) >= rim) hits.push(plane);
  }
  if (shape === 'half' || shape === 'sphere') {
    const centre = graph3dCentre(shape, rim);
    for (const t of graph3dSphereHits(graph3dSub(o, centre), d, graph3dSphereRadius(shape, rim, outer)) || []) {
      if (t > 0 && (shape === 'sphere' || at(t)[1] >= centre[1] - 1e-6)) hits.push(t);
    }
  }
  if (!hits.length) return null;
  return at(Math.min(...hits));
}

// The point p put back on the shape: onto the plane, the dome inside the rim (a point inside it or
// under it goes to the nearest point of the dome above its rim), or the sphere; its very middle to the top.
function graph3dSnap(shape, p, rim, outer) {
  if (shape === 'disc') return [p[0], 0, p[2]];
  if (shape === 'half' && Math.hypot(p[0], p[2]) >= rim) return [p[0], -rim, p[2]];
  const r = graph3dSphereRadius(shape, rim, outer);
  const c = graph3dCentre(shape, rim);
  const q = graph3dSub(p, c);
  if (shape === 'half') q[1] = Math.max(q[1], 0);
  const len = Math.hypot(q[0], q[1], q[2]);
  if (len < 1e-9) return [c[0], c[1] + r, c[2]];
  return [c[0] + (q[0] * r) / len, c[1] + (q[1] * r) / len, c[2] + (q[2] * r) / len];
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

// A released look's speed (px per ms) after another `dt` ms of coasting, or null once it has stopped.
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
function graph3dKinOf(links, id) {
  const me = String(id);
  const out = new Set([me]);
  for (const l of links || []) {
    const kids = (l.kids || [l.to]).map(String);
    if (String(l.from) === me) kids.forEach((k) => out.add(k));
    else if (kids.includes(me) || String(l.to) === me) out.add(String(l.from));
  }
  return out;
}

// What a press starts once it drags: 'pan' for the left button (and the middle one), 'spin' for the
// right one, 'look' for a Shift+right or Shift+left press and a finger; null for any other button. A press
// that never drags is a click: a left click selects, a right one opens the card menu (a Shift+right one none).
function graph3dDragMode({ button, shiftKey, pointerType }) {
  if (pointerType === 'touch') return 'look';
  if ((button === 2 || button === 0) && shiftKey) return 'look';
  if (button === 2) return 'spin';
  if (button === 0 || button === 1) return 'pan';
  return null;
}

// The walk keys, each as [right, up] in the camera's own screen: A left, D right.
const GRAPH3D_WALK_KEYS = {
  'a': [-1, 0],
  'd': [1, 0],
};
// The fly keys, each as the way it moves along where the camera looks: W ahead, S back.
const GRAPH3D_FLY_KEYS = {
  'w': 1,
  's': -1,
};
const GRAPH3D_MOVE_KEYS = Object.assign({}, GRAPH3D_WALK_KEYS, GRAPH3D_FLY_KEYS);

// The key of the table `keys` a keydown or keyup is, whatever its case, or null: with Ctrl, Alt or Meta
// held the letter keeps its own meaning (Ctrl+S saves, Ctrl+E codes the selection in a text box).
function graph3dKeyIn(keys, { key, ctrlKey, altKey, metaKey }) {
  if (ctrlKey || altKey || metaKey || typeof key !== 'string' || key.length !== 1) return null;
  const k = key.toLowerCase();
  return Object.prototype.hasOwnProperty.call(keys, k) ? k : null;
}

// The walk or fly key a keydown or keyup is (w, a, s or d), or null.
function graph3dWalkKey(ev) {
  return graph3dKeyIn(GRAPH3D_MOVE_KEYS, ev);
}

// How far W and S move the camera along where it looks while the keys `held` are down for `dt` ms: the walk's
// own speed (graph3dWalk) for `pace`, ahead positive. W and S together cancel; null when nothing moves.
function graph3dFlyStep(held, pace, dt) {
  let way = 0;
  for (const k of held) way += GRAPH3D_FLY_KEYS[k] || 0;
  return way ? (way * GRAPH3D_WALK * 2 * pace * GRAPH3D_TAN_HALF_FOV * dt) / 1000 : null;
}

// How far the camera moves, as [x, y, z] in the scene, while the walk keys `held` are down for `dt` ms with the
// camera turned `theta` and tilted `phi`: A and D slide it along its right, which is level, as a pan does.
// `pace` is the distance the speed goes by (see graph3dPace), the same share of what the camera sees whatever
// it is. Null when nothing moves.
function graph3dWalk(held, theta, phi, pace, dt) {
  let r = 0, u = 0;
  for (const k of held) { const v = GRAPH3D_WALK_KEYS[k]; if (v) { r += v[0]; u += v[1]; } }
  const len = Math.hypot(r, u);
  if (!len) return null;
  const step = (GRAPH3D_WALK * 2 * pace * GRAPH3D_TAN_HALF_FOV * dt) / 1000 / len;
  const b = graph3dBasis(phi, theta);
  return [0, 1, 2].map((k) => (r * b.right[k] + u * b.up[k]) * step);
}

// What the pace of flying goes by: how far the camera at `eye` is from the nearest point of the shape, so it
// feels the same far out and close among the dots, never under `floor` so it never stalls on the shape.
function graph3dPace(shape, eye, rim, outer, floor) {
  return Math.max(floor, Math.hypot(...graph3dSub(eye, graph3dSnap(shape, eye, rim, outer))));
}

// How far ahead one step of the wheel (or a pinch) flies, from the factor `f` the zoom would have had: a tick
// toward the pointer (f under 1) is a share of the pace ahead, a tick the other way the same back.
function graph3dWheelStep(f, pace) {
  return f > 0 ? (Math.log(f) / Math.log(GRAPH3D_WHEEL)) * (1 - GRAPH3D_WHEEL) * pace : 0;
}

// The turn keys, each as the way it turns the camera round its target: Q to the left (its turn, theta, grows),
// E to the right.
const GRAPH3D_TURN_KEYS = {
  'q': 1,
  'e': -1,
};

// The turn key a keydown or keyup is (q or e), or null.
function graph3dTurnKey(ev) {
  return graph3dKeyIn(GRAPH3D_TURN_KEYS, ev);
}

// How far the camera turns round its target, in radians added to its turn theta, while the turn keys among
// `held` are down for `dt` ms: a steady speed whatever the distance, Q and E together cancelling. Null when
// nothing turns.
function graph3dTurn(held, dt) {
  let way = 0;
  for (const k of held) way += GRAPH3D_TURN_KEYS[k] || 0;
  return way ? (way * GRAPH3D_TURN * dt) / 1000 : null;
}

// The vertical axis a shape turns round, as the point of it the plan's middle stands at: the disc's centre,
// the dome's top, the sphere's top pole; H frames the shape round it, and Q and E spin it (graph3dTurnRound).
function graph3dShapeAxis(shape, rim, outer) {
  const p = graph3dPlace(shape, 0, 0, rim, outer);
  if (shape === 'disc') return p;
  // The top pole, whatever angle the centre is set down from it at.
  return shape === 'half' ? [0, 0, 0] : [0, graph3dSphereRadius(shape, rim, outer), 0];
}

// The camera `cam` looking round from where it stands: turned to `theta` and tilted to `phi` (kept from straight
// down to straight up, short of the poles), its eye not moving and its target swinging round it.
const GRAPH3D_LOOK_MARGIN = 0.02;
function graph3dLook(cam, theta, phi) {
  const eye = graph3dEye([cam.tx, cam.ty, cam.tz], graph3dBasis(cam.phi, cam.theta).back, cam.dist);
  return graph3dTurnRound(cam, eye, theta, Math.min(Math.PI - GRAPH3D_LOOK_MARGIN, Math.max(GRAPH3D_LOOK_MARGIN, phi)));
}

// The tilt pivot: the point of the shapes' vertical axis (x = 0, z = 0) nearest the line of sight of the
// camera `cam`, ahead of its eye; looking straight along the axis, or with that point behind the eye, the
// axis at the target's height.
function graph3dAxisNearest(cam) {
  const back = graph3dBasis(cam.phi, cam.theta).back;
  const eye = graph3dEye([cam.tx, cam.ty, cam.tz], back, cam.dist);
  const f = [-back[0], -back[1], -back[2]];
  const b = f[1], d = graph3dDot(f, eye), e = eye[1];
  const den = 1 - b * b;
  if (den > 1e-4) {
    const s = (b * e - d) / den;
    if (s > 0) return [0, (e - b * d) / den, 0];
  }
  return [0, cam.ty, 0];
}

// A right drag's (or its coast's) step of `dy` px up or down on a stage `h` px high: the camera `cam` tilted
// round the tilt pivot (graph3dAxisNearest) by half a turn for the stage's height, from straight above to
// `max` (a camera a look has tilted past `max` tilts no further, and may come back). The new
// { tx, ty, tz, theta, phi }, or null when the tilt does not change.
function graph3dTiltRound(cam, dy, h, max) {
  const top = Math.max(max, cam.phi);
  const phi = Math.min(top, Math.max(0, cam.phi - (Math.PI * dy) / h));
  if (phi === cam.phi) return null;
  return graph3dTurnRound(cam, graph3dAxisNearest(cam), cam.theta, phi);
}

// The camera `cam` (its target tx ty tz, its turn theta and tilt phi) turned round the scene point `pivot`
// to the turn `theta` and tilt `phi`: the target moves so the pivot keeps its place on the camera's own
// axes, that is, where it stands on screen and how far. At the same tilt that is the camera swung rigidly
// round the vertical line through the pivot. Returns the new { tx, ty, tz, theta, phi }; the distance is
// the camera's own and stays.
function graph3dTurnRound(cam, pivot, theta, phi) {
  const from = graph3dBasis(cam.phi, cam.theta);
  const to = graph3dBasis(phi, theta);
  const d = graph3dSub(pivot, [cam.tx, cam.ty, cam.tz]);
  const r = graph3dDot(d, from.right), u = graph3dDot(d, from.up), b = graph3dDot(d, from.back);
  const at = (k) => pivot[k] - (r * to.right[k] + u * to.up[k] + b * to.back[k]);
  return { tx: at(0), ty: at(1), tz: at(2), theta, phi };
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

// The compass: a dial lying on the plan, seen as the camera sees the plan. Its north is the plan's up
// (the top of the 2D Hierarchy), turned with the camera's turn `theta` and squashed by its tilt `phi`
// (seen from under past a right angle, and never thinner than a sliver, so edge-on it still shows). The
// answer is the dial's SVG transform and where its north tip stands on the screen at radius 1 (x right, y down).
function graph3dCompass(theta, phi) {
  const r = (v) => Math.round(v * 1000) / 1000 + 0;
  const c = Math.cos(phi);
  const squash = (c < 0 ? -1 : 1) * Math.max(0.08, Math.abs(c));
  return {
    dial: `scale(1 ${r(squash)}) rotate(${r((theta * 180) / Math.PI)})`,
    north: [r(Math.sin(theta)), r(-Math.cos(theta) * squash)],
  };
}

// The share of the stage, across (x) and down (y), F's close frame fills with the selection and its kin:
// all but a margin each side of GRAPH3D_CLOSE_MARGIN of that side, at least GRAPH3D_CLOSE_MARGIN_PX.
function graph3dCloseFill(w, h) {
  const fill = (side) => Math.max(0.3, 1 - (2 * Math.max(GRAPH3D_CLOSE_MARGIN_PX, side * GRAPH3D_CLOSE_MARGIN)) / side);
  return { x: fill(w), y: fill(h) };
}

// Whether the camera `a` is still the camera `b` (as hier.cam holds one): nothing has moved it since, past
// the rounding a flight ends on.
function graph3dSameCam(a, b) {
  if (!a || !b) return false;
  return ['theta', 'phi', 'dist', 'tx', 'ty', 'tz'].every((k) => Math.abs(a[k] - b[k]) <= 1e-6 * Math.max(1, Math.abs(b[k])));
}

// The turn the compass eases the camera back to: north up, the whole turn nearest `theta`, so it goes
// the short way round.
function graph3dNorthUp(theta) {
  return Math.round(theta / (2 * Math.PI)) * 2 * Math.PI + 0;
}

// --- the tuning of the browser part ------------------------------------------------------------

const GRAPH3D_FOV = 45;
const GRAPH3D_MORPH_MS = 700;
const GRAPH3D_FLY_MS = 450;
const GRAPH3D_DRAG = 4;
const GRAPH3D_WHEEL = 0.87;
const GRAPH3D_BUTTON_ZOOM = 0.8;
// The walk (W, A, S, D) crosses this much of the stage's height each second, seen straight above.
const GRAPH3D_WALK = 0.7;
// Q and E turn the camera this many radians each second: a quarter turn.
const GRAPH3D_TURN = Math.PI / 2;
// The camera comes no nearer to what it looks at than where a dot there is seen this many times its 2D
// size: just short of its fade (graph3dCloseFade), so the dot it heads for and its neighbours keep their
// colour and the stage around them stays full.
const GRAPH3D_CLOSEST_SCALE = 10;
// At the closest, each further step in leans the camera toward the horizon (the disc and the dome), up to
// this tilt, so the dots around the one it heads for come into view, as in a map that tilts as you dive.
// The padding, in px, of the 2D Graph's own fit (graphFit) the disc opens on.
const GRAPH3D_DISC_FIT_PAD = 60;
// How much of the stage the whole shape fills, each way, when H frames it at a tilt.
const GRAPH3D_SHAPE_FILL = 0.85;
// F and the search box's Enter bring a card to the middle with its kin within this much of the stage,
// and a card alone no nearer than where it is seen at CARD_SCALE times its 2D size.
const GRAPH3D_CARD_FILL = 0.6;
const GRAPH3D_CARD_SCALE = 2.5;
// F again (graph3dFrameSelection) flies close: the selection and its kin fill the stage but for this share of
// each side, and no less than this many px.
const GRAPH3D_CLOSE_MARGIN = 0.09;
const GRAPH3D_CLOSE_MARGIN_PX = 40;
// A wheel step or a pinch eases the camera to where it asked for: this many ms to cover two thirds of the way.
const GRAPH3D_ZOOM_TAU = 40;
// A click this many px off a dot's edge still finds it.
const GRAPH3D_PICK_TOL = 10;
// How far a shape seen whole (H) is tilted when it is the dome or the sphere: from the side, so it reads as one.
const GRAPH3D_SHAPE_TILT = 0.85;
const GRAPH3D_HINT_MS = 8000;
// How much of its colour each mark of the ground lays over the stage, as app.css draws the 2D marks:
// a tier wash, a guide ring, a dashed guide of a nested tier, a divider, the block's frame.
const GRAPH3D_MIX = { wash: 0.13, guide: 0.55, sub: 0.4, divider: 0.6, block: 1 };
// The share of its colour a mark at the back keeps (the rest is the ground), and a mark on the sphere's far side.
const GRAPH3D_DEPTH_FADE = 0.3;
const GRAPH3D_FAR_KEEP = 0.45;
// The 3D options, the sliders of the Graph panel's 3D section (graph3dBuildOptions): the pole limits of the
// dome and the sphere in radians (ring null: the shape's own), the mark size (0 its size in the world, 1 a
// constant size on screen), the mark scale (a factor on that, so marks can grow past today's largest), the share of colour the far side keeps, the share the lines of the dome and the
// sphere keep, and the factors of the move speed (W, A, S, D) and the spin speed (Q, E). By default the
// shapes, the marks and the speeds are as they were before the options, and the far side and the lines of
// the dome and the sphere are fainter, so the side the camera faces reads first. GRAPH3D_OPTIONS holds the board's, kept per browser
// (graph3dLoadOptions).
const GRAPH3D_OPTION_DEFAULTS = { poles: { half: { top: 0, ring: null }, sphere: { top: 0, ring: null } }, size: 0, scale: 1, far: 0.2, lines: 0.5, move: 1, spin: 1 };
// Each slider's range: the pole angles in degrees, per shape; the others as stored.
const GRAPH3D_OPTION_RANGES = {
  top: { half: [0, 75], sphere: [0, 120] },
  ring: { half: [10, 90], sphere: [10, 179] },
  size: [0, 1], scale: [1, 4], far: [0.03, 1], lines: [0.15, 1], move: [0.25, 4], spin: [0.25, 4],
};
const GRAPH3D_OPTIONS = JSON.parse(JSON.stringify(GRAPH3D_OPTION_DEFAULTS));
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
const GRAPH3D_HELP = 'Left drag pans, right drag spins the shape round its own axis and tilts the camera, Shift+right (or Shift+left) drag looks round from where the camera stands, '
  + 'the wheel flies toward the pointer; one finger looks round and a pinch flies. G steps the shape, F frames the selection and F again frames it close, H frames everything; '
  + 'Q and E, held, spin the shape round its own axis; W and S, held, fly ahead and back along where the camera looks; A and D slide sideways.';
const GRAPH3D_COMPASS_TIP = 'Compass: turn the view north up, seen from straight above';
const GRAPH3D_HINT = 'Drag pans · right drag spins · Shift+right drag looks · wheel flies · double click opens · G shape · F wide/close · H home · QE spin · WS fly · AD slide';
// three.js r160, its classic build (the global THREE), vendored and served by this exact path (server.js).
const GRAPH3D_THREE_SRC = '/vendor/three/three.min.js?v=0.160.0';
// The words the corner's label says when three.js did not load (the engine's own message goes to the console).
const GRAPH3D_LOAD_FAILED = 'three.js did not load: the 3D Hierarchy cannot be drawn. Turn 3D off for the 2D Hierarchy.';
const GRAPH3D_TAN_HALF_FOV = Math.tan((GRAPH3D_FOV * Math.PI) / 360);

// A number to two decimals, as the marks' coordinates and the camera's data-cam are written.
function graph3dRound2(v) {
  return Math.round(v * 100) / 100;
}

// The ease of a morph or a flight: slow out, slow in, t and the answer from 0 to 1.
function graph3dEase(t) {
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

// What the stage does with a contextmenu event, given the right press under way (`right`: down, moved,
// held, or null) and whether another drag or a pinch is moving (`dragging`): 'hold' it until the button
// comes up (the menu asked for on the press), 'pass' it to the card menu (a right click with no drag, or
// the keyboard's Menu key), or 'swallow' it (one asked for by a drag, or a second while one is held).
function graph3dMenuVerdict(right, dragging) {
  if (right && right.down) return right.moved || right.held ? 'swallow' : 'hold';
  if (right) return right.moved ? 'swallow' : 'pass';
  return dragging ? 'swallow' : 'pass';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    graph3dPathPoints, graph3dPlace, graph3dMorph, graph3dNextShape, graph3dShapeName,
    graph3dWantedIn, graph3dAddressFor, graph3dRim, graph3dOuter, graph3dFar, graph3dSplitFar,
    graph3dPick, graph3dTopDown, graph3dCloseFade, graph3dMarkScale, graph3dMaxTilt, graph3dRayHit,
    graph3dSnap, graph3dNearest, graph3dCoast, graph3dLineWidth, graph3dLabelScale, graph3dBasis,
    graph3dFit, graph3dFacing, graph3dKinOf, graph3dSoftCap, graph3dCentre, graph3dSphereHits, graph3dEye,
    graph3dDomeBack, graph3dShapeFar, graph3dSideTilt, graph3dPaintOrder,
    graph3dRestack, graph3dDragMode, graph3dRgb, graph3dMix, graph3dShare, graph3dCompass, graph3dNorthUp,
    graph3dRound2, graph3dEase, graph3dMenuVerdict, graph3dWalkKey, graph3dWalk, graph3dFlyStep, graph3dTurnKey, graph3dTurn, graph3dTurnRound, graph3dShapeAxis, graph3dPoleAngle, graph3dPoleDefaults, graph3dBlendScale, graph3dFarFade, graph3dMergeOptions, graph3dAxisNearest, graph3dTiltRound, GRAPH3D_OPTIONS, GRAPH3D_OPTION_DEFAULTS, GRAPH3D_OPTION_RANGES, graph3dLook, graph3dPace, graph3dWheelStep, graph3dCloseFill, graph3dSameCam, GRAPH3D_UNLIT, GRAPH3D_THREE_SRC,
  };
}
