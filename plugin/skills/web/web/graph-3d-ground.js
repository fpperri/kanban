'use strict';
// The 3D Hierarchy's ground, drawn by three.js on the shape (graph-3d-view.js holds its state, `hier`):
// the tier washes, the guide rings, the dividers, the block's frame, the body of the dome and of the
// sphere, and the floor under the disc. Each is drawn solid, in its colour mixed into the stage's ground
// by as much of it as the 2D mark lays over the ground (GRAPH3D_MIX): a dimmed mark is a colour, never a
// see-through one.

function graph3dGroundOf(hier) {
  for (let el = hier.root; el && el.nodeType === 1; el = el.parentElement) {
    const c = graph3dRgb(getComputedStyle(el).backgroundColor);
    if (c && c.a > 0) return c;
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function graph3dInkOf(hier, el, prop, mix, bg) {
  const c = (el && graph3dRgb(getComputedStyle(el)[prop])) || { r: 136, g: 136, b: 136, a: 1 };
  return new hier.T.Color().setStyle(graph3dMix(c, bg, mix));
}

function graph3dMixOf(kind, dashed) {
  return kind === 'guide' && dashed ? GRAPH3D_MIX.sub : GRAPH3D_MIX[kind];
}

function graph3dDisposeGround(hier) {
  for (const g of hier.ground) {
    hier.scene.remove(g.obj);
    g.obj.geometry.dispose();
    g.obj.material.dispose();
  }
  hier.ground = [];
  hier.groundAt = '';
}

// Every mark of the ground takes its colour per point (graph3dPaintGround): its own, or on the sphere's
// far side mixed further into the ground. `base` is its own colour.
function graph3dLineItem(hier, pts, el, dashed, kind, index, bg) {
  const T = hier.T;
  const src = new Float32Array(pts.length * 2);
  pts.forEach((p, k) => { src[2 * k] = p[0]; src[2 * k + 1] = p[1]; });
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(new Float32Array(pts.length * 3), 3));
  geo.setAttribute('color', new T.BufferAttribute(new Float32Array(pts.length * 3), 3));
  const opts = { color: 0xffffff, vertexColors: true, depthWrite: false };
  const mat = dashed ? new T.LineDashedMaterial(Object.assign({ dashSize: 2, gapSize: 5 }, opts)) : new T.LineBasicMaterial(opts);
  const obj = new T.Line(geo, mat);
  obj.frustumCulled = false;
  hier.scene.add(obj);
  hier.ground.push({ obj, src, dashed, kind, index, base: graph3dInkOf(hier, el, 'stroke', graph3dMixOf(kind, dashed), bg), painted: '' });
}

// A flat ring from radius r0 to r1 as a mesh of `rings` rings and `spokes` spokes, its points kept on the
// plan in `src` (graph3dPlaceGround puts them on the shape), a colour of `channels` numbers per point.
function graph3dRingMesh(hier, r0, r1, spokes, rings, channels, material, order) {
  const T = hier.T;
  const count = (rings + 1) * (spokes + 1);
  const src = new Float32Array(count * 2);
  for (let j = 0; j <= rings; j++) {
    const r = r0 + ((r1 - r0) * j) / rings;
    for (let k = 0; k <= spokes; k++) {
      const a = (k / spokes) * Math.PI * 2;
      const o = (j * (spokes + 1) + k) * 2;
      src[o] = Math.cos(a) * r;
      src[o + 1] = Math.sin(a) * r;
    }
  }
  const index = [];
  for (let j = 0; j < rings; j++) {
    for (let k = 0; k < spokes; k++) {
      const p = j * (spokes + 1) + k;
      const q = p + spokes + 1;
      index.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('color', new T.BufferAttribute(new Float32Array(count * channels), channels));
  geo.setIndex(index);
  const obj = new T.Mesh(geo, new T.MeshBasicMaterial(Object.assign({ color: 0xffffff, vertexColors: true, side: T.DoubleSide }, material)));
  obj.frustumCulled = false;
  obj.renderOrder = order;
  hier.scene.add(obj);
  return { obj, src };
}

// A wash is the ring between its band's two circles. It hides what is behind it on the sphere (it writes
// depth), set a hair back so the guide lines lying on it are never cut by it.
function graph3dWashItem(hier, t, el, slot, bg) {
  const radii = graph3dPathPoints(t.d, 40).map((p) => Math.hypot(p[0][0], p[0][1]));
  if (radii.length < 2) return;
  const { obj, src } = graph3dRingMesh(hier, Math.min(...radii), Math.max(...radii), 160, 6, 3,
    { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }, -1);
  hier.ground.push({ obj, src, dashed: false, kind: 'wash', index: slot, base: graph3dInkOf(hier, el, 'fill', GRAPH3D_MIX.wash, bg), painted: '' });
}

// The body of the dome and of the sphere: the whole shape as a faint skin over the washes, lit only at
// its edge as seen (a soft rim in the guide rings' colour) and, on the dome, a little darker toward its
// foot, so the shape reads as a dome or a ball. The disc has none: from above it stays the 2D picture.
function graph3dBodyItem(hier, el, bg) {
  const reach = Math.max(hier.rim, hier.outer || 0) * GRAPH3D_SPHERE_REACH;
  const { obj, src } = graph3dRingMesh(hier, 0, reach, 96, 24, 4, { transparent: true, depthWrite: false, depthTest: false, fog: false }, -2);
  hier.ground.push({ obj, src, dashed: false, kind: 'body', index: 0, base: graph3dInkOf(hier, el, 'stroke', 1, bg), painted: '' });
}

// The floor: the disc's plane to a little past its outermost mark, drawn first, in the ground's own colour
// lifted toward the guide rings' as the camera tilts (graph3dPaintFloor), fading out at its edge.
function graph3dFloorItem(hier, el, bg) {
  const R = Math.max(hier.rim * 1.12, (hier.outer || 0) * 1.04);
  const { obj, src } = graph3dRingMesh(hier, 0, R, 96, 12, 3, { depthWrite: false }, -3);
  hier.ground.push({ obj, src, dashed: false, kind: 'floor', index: 0, base: graph3dInkOf(hier, el, 'stroke', 1, bg), painted: '', reach: R });
}

// The contact shadows are the ground darkened, mixed again with each theme.
function graph3dShadowInk(hier, svg) {
  svg.style.setProperty('--graph-3d-shadow-ink', graph3dMix({ r: 0, g: 0, b: 0 }, hier.groundRgb, 0.7));
}

function graph3dTakeGround(hier, bg) {
  hier.groundRgb = bg;
  hier.bg = new hier.T.Color().setStyle(`rgb(${bg.r}, ${bg.g}, ${bg.b})`);
  hier.scene.fog.color.copy(hier.bg);
}

function graph3dBuildGround(hier, plan, svg) {
  graph3dDisposeGround(hier);
  const bg = graph3dGroundOf(hier);
  graph3dTakeGround(hier, bg);
  const tints = svg.querySelectorAll('.graph-tint');
  plan.tints.forEach((t, k) => graph3dWashItem(hier, t, tints[k], k, bg));
  const guides = svg.querySelectorAll('.graph-guide');
  plan.guides.forEach((g, k) => {
    const sub = g.cls.includes('graph-guide-sub');
    for (const piece of graph3dPathPoints(g.d, 10)) graph3dLineItem(hier, piece, guides[k], sub, 'guide', k, bg);
  });
  const dividers = svg.querySelectorAll('.graph-divider');
  plan.dividers.forEach((d, k) => {
    for (const piece of graph3dPathPoints(`M${d.x1} ${d.y1}L${d.x2} ${d.y2}`, 10)) graph3dLineItem(hier, piece, dividers[k], false, 'divider', k, bg);
  });
  if (plan.block) {
    const b = plan.block;
    const frame = svg.querySelector('.graph-block-frame');
    for (const piece of graph3dPathPoints(`M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`, 10)) graph3dLineItem(hier, piece, frame, false, 'block', 0, bg);
  }
  graph3dBodyItem(hier, guides[0], bg);
  graph3dFloorItem(hier, guides[0], bg);
}

// The colours of the ground follow the stylesheet: read again on every draw, so a theme change carries over.
function graph3dRecolourGround(hier, svg) {
  const els = {
    wash: svg.querySelectorAll('.graph-tint'),
    guide: svg.querySelectorAll('.graph-guide'),
    divider: svg.querySelectorAll('.graph-divider'),
    block: svg.querySelectorAll('.graph-block-frame'),
  };
  const bg = graph3dGroundOf(hier);
  graph3dTakeGround(hier, bg);
  for (const g of hier.ground) {
    if (g.kind === 'body' || g.kind === 'floor') g.base = graph3dInkOf(hier, els.guide[0], 'stroke', 1, bg);
    else g.base = graph3dInkOf(hier, els[g.kind][g.index], g.kind === 'wash' ? 'fill' : 'stroke', graph3dMixOf(g.kind, g.dashed), bg);
    g.painted = '';
  }
}

// Each point of the ground in its mark's colour; on the sphere, a point on the far side mixed further
// into the ground (FAR_KEEP), as the far side's dots are. Away from the sphere the colours do not
// change with the camera, so they are painted once.
function graph3dPaintGround(hier) {
  const sphere = hier.shape === 'sphere' && !hier.morph;
  const dome = hier.shape === 'half' && !hier.morph;
  const e = hier.camera.position;
  const ex = e.x, ey = e.y, ez = e.z;
  const bg = hier.bg;
  for (const g of hier.ground) {
    if (g.kind === 'body') { graph3dPaintBody(hier, g, ex, ey, ez); continue; }
    if (g.kind === 'floor') { graph3dPaintFloor(hier, g); continue; }
    const key = sphere || dome ? '' : `flat ${g.base.getHexString()}`;
    if (key && g.painted === key) continue;
    g.painted = key;
    const pos = g.obj.geometry.getAttribute('position').array;
    const attr = g.obj.geometry.getAttribute('color');
    const col = attr.array;
    const b = g.base;
    for (let k = 0; k < col.length / 3; k++) {
      const x = pos[3 * k], y = pos[3 * k + 1], z = pos[3 * k + 2];
      const back = (sphere && x * (ex - x) + y * (ey - y) + z * (ez - z) < 0)
        || (dome && graph3dDomeBack([x, y, z], [ex, ey, ez], hier.rim));
      const m = back ? GRAPH3D_OPTIONS.far : 1;
      col[3 * k] = bg.r + (b.r - bg.r) * m;
      col[3 * k + 1] = bg.g + (b.g - bg.g) * m;
      col[3 * k + 2] = bg.b + (b.b - bg.b) * m;
    }
    attr.needsUpdate = true;
  }
}

// How much of a shape's look the shape has now: `weight` of the shape, mid-morph the way between.
function graph3dShapeWeight(hier, weight) {
  return hier.morph ? weight(hier.morph.from) + (weight(hier.morph.to) - weight(hier.morph.from)) * hier.morph.e : weight(hier.shape);
}

function graph3dPaintFloor(hier, g) {
  const flat = graph3dShapeWeight(hier, (shape) => (shape === 'disc' ? 1 : 0));
  const w = flat * Math.sin(Math.min(Math.PI / 2, Math.max(0, hier.cam.phi)));
  g.obj.visible = w > 0.001;
  const key = `${Math.round(w * 1000)} ${g.base.getHexString()} ${hier.bg.getHexString()}`;
  if (!g.obj.visible || g.painted === key) return;
  g.painted = key;
  const attr = g.obj.geometry.getAttribute('color');
  const col = attr.array;
  const b = g.base, bg = hier.bg;
  for (let k = 0; k < col.length / 3; k++) {
    const f = Math.hypot(g.src[2 * k], g.src[2 * k + 1]) / g.reach;
    const t = Math.min(1, Math.max(0, (f - 0.7) / 0.3));
    const a = GRAPH3D_FLOOR_LIFT * w * (1 - t * t * (3 - 2 * t));
    col[3 * k] = bg.r + (b.r - bg.r) * a;
    col[3 * k + 1] = bg.g + (b.g - bg.g) * a;
    col[3 * k + 2] = bg.b + (b.b - bg.b) * a;
  }
  attr.needsUpdate = true;
}

function graph3dPaintBody(hier, g, ex, ey, ez) {
  const strength = graph3dShapeWeight(hier, (shape) => (shape === 'disc' ? 0 : 1));
  g.obj.visible = strength > 0.001;
  if (!g.obj.visible) return;
  // The dome's own look (no skin past the rim, darker toward its foot): on the half sphere, and on a morph
  // to or from it unless the morph is bound for the sphere.
  const morphHalf = !!hier.morph && (hier.morph.from === 'half' || hier.morph.to === 'half');
  const dome = hier.shape === 'half' || (morphHalf && hier.shape !== 'sphere');
  const round = (hier.shape === 'sphere' || hier.shape === 'half') && !hier.morph;
  // The middle of the shape's sphere, which the skin's points face away from: mid-morph, the way between.
  const cy = graph3dShapeWeight(hier, (shape) => graph3dCentre(shape, hier.rim)[1]);
  const pos = g.obj.geometry.getAttribute('position').array;
  const attr = g.obj.geometry.getAttribute('color');
  const col = attr.array;
  const b = g.base;
  // A key light from the upper left of the view, so the ball and the dome have a lit side.
  const L = new hier.T.Vector3(-0.45, 0.65, 0.6).normalize().applyQuaternion(hier.camera.quaternion);
  for (let k = 0; k < col.length / 4; k++) {
    const x = pos[3 * k], y = pos[3 * k + 1], z = pos[3 * k + 2];
    const ny = y - cy;
    const len = Math.hypot(x, ny, z) || 1;
    let vx = ex - x, vy = ey - y, vz = ez - z;
    const vl = Math.hypot(vx, vy, vz) || 1;
    vx /= vl; vy /= vl; vz /= vl;
    const toward = (x * vx + ny * vy + z * vz) / len;
    const facing = Math.abs(toward);
    const rim = (1 - facing) * (1 - facing);
    const lit = Math.max(0, ((Math.sign(toward) || 1) * (x * L.x + ny * L.y + z * L.z)) / len);
    const out = dome && Math.hypot(g.src[2 * k], g.src[2 * k + 1]) > hier.rim;
    const far = round && x * vx + ny * vy + z * vz < 0;
    const bottom = dome ? Math.min(1, Math.max(0, -y / hier.rim)) : 0;
    const shade = (1 - 0.75 * bottom) * (0.55 + 0.45 * lit);
    col[4 * k] = b.r * shade;
    col[4 * k + 1] = b.g * shade;
    col[4 * k + 2] = b.b * shade;
    col[4 * k + 3] = out || far ? 0 : strength * (0.03 + 0.22 * rim + 0.12 * bottom + 0.15 * lit);
  }
  attr.needsUpdate = true;
}

// The ground's points on the shape as it stands now, mid-morph included; moved only when the shape changes.
function graph3dPlaceGround(hier) {
  const key = (hier.morph ? `${hier.morph.from}>${hier.morph.to}@${hier.morph.e}@${hier.outer}` : `${hier.shape}@${hier.rim}@${hier.outer}`)
    + JSON.stringify(GRAPH3D_OPTIONS.poles);
  if (key === hier.groundAt) return;
  hier.groundAt = key;
  for (const g of hier.ground) {
    const pos = g.obj.geometry.getAttribute('position');
    const arr = pos.array;
    for (let k = 0; k < g.src.length / 2; k++) {
      const p = graph3dAt(hier, g.src[2 * k], g.src[2 * k + 1]);
      arr[3 * k] = p[0];
      arr[3 * k + 1] = p[1];
      arr[3 * k + 2] = p[2];
    }
    pos.needsUpdate = true;
    if (g.dashed) g.obj.computeLineDistances();
  }
}
