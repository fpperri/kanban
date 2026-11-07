'use strict';
// The 3D Hierarchy's marks (graph-3d-view.js holds its state, `hier`): the 2D drawing's own SVG dots,
// rings, ids, names, lines, counts and captions, moved each frame to where the camera sees their point,
// painted in their colour mixed into the ground by depth, the far side and the lighting, and kept apart.

function graph3dProject(hier, p, v) {
  v.set(p[0], p[1], p[2]).applyMatrix4(hier.camera.matrixWorldInverse);
  const z = -v.z;
  if (z < hier.camera.near) return null;
  v.applyMatrix4(hier.camera.projectionMatrix);
  return [((v.x + 1) / 2) * hier.cw - hier.ox, ((1 - v.y) / 2) * hier.ch - hier.oy, z];
}

// How many times its 2D size a mark at depth z is seen.
function graph3dScaleAt(hier, z) {
  return hier.h / (2 * GRAPH3D_TAN_HALF_FOV * z);
}

// The marks of a new draw: the captions with their points on the plan, and under each dot its contact
// shadow (graph3dPlaceShadows shapes it), filled with a soft round gradient of its own, so each can be as
// dark as its mark is kept (--graph-3d-shadow, app.css). A dot's tip, the 2D drawing's title, moves to the
// stage's own tooltip (graphShowTip), which a pointer resting on a moving mark finds more readily.
function graph3dTakeMarks(hier, drawn, plan) {
  const holders = [...plan.captions];
  if (plan.looseCaption) holders.push(plan.looseCaption);
  if (plan.block) holders.push(plan.block.title, ...plan.block.columns.map((col) => col.caption));
  const capEls = drawn.world.querySelectorAll('text.graph-caption, text.graph-block-title, text.graph-block-caption');
  hier.captions = holders.map((c, k) => ({ x: c.x, y: c.y, el: capEls[k] })).filter((c) => c.el)
    .map((c) => Object.assign(c, { names: [...c.el.querySelectorAll('.graph-caption-name')] }));
  let defs = drawn.svg.querySelector('defs.graph-3d-shadows');
  if (!defs) {
    defs = graphEl('defs', null, 'graph-3d-shadows');
    drawn.svg.insertBefore(defs, drawn.svg.firstChild);
  }
  hier.shadows = new Map();
  plan.nodes.forEach((n, k) => {
    const g = drawn.nodeEls.get(n.id);
    if (!g) return;
    const title = g.querySelector('title');
    if (title) { g.setAttribute('data-tip', title.textContent); title.remove(); }
    const id = `graph-3d-shadow-${k}`;
    let grad = defs.querySelector(`#${id}`);
    if (!grad) {
      grad = graphEl('radialGradient', { id });
      for (const [offset, part] of [['0', 'core'], ['0.55', 'mid'], ['1', 'edge']]) grad.appendChild(graphEl('stop', { offset }, `graph-3d-shadow-${part}`));
      defs.appendChild(grad);
    }
    let el = g.firstChild;
    if (!(el && el.classList && el.classList.contains('graph-3d-shadow'))) {
      el = graphEl('ellipse', { fill: `url(#${id})` }, 'graph-3d-shadow');
      g.insertBefore(el, g.firstChild);
    }
    hier.shadows.set(n.id, { el, grad, dark: null });
  });
}

// A mark's ink is the colour its 2D rule gives it, which app.css hands the 3D Hierarchy as --graph-3d-ink
// (a dot's is its card's colour); it is read once for each theme. The mark is painted with that ink mixed
// into the ground (--graph-3d-paint), so a state the stylesheet paints over it (a focused caption) still wins.
function graph3dMarkInk(hier, el, dot) {
  const had = hier.inks.get(el);
  if (had && had.theme === hier.theme) return had.rgb;
  const cs = getComputedStyle(dot ? el.parentNode : el);
  const rgb = graph3dRgb(dot ? cs.color : cs.getPropertyValue('--graph-3d-ink'));
  hier.inks.set(el, { theme: hier.theme, rgb });
  return rgb;
}

function graph3dPaintMark(hier, el, share, dot) {
  const ink = el && graph3dMarkInk(hier, el, dot);
  if (!ink) return;
  const paint = graph3dMix(ink, hier.groundRgb, share);
  if (hier.painted.get(el) === paint) return;
  hier.painted.set(el, paint);
  el.style.setProperty('--graph-3d-paint', paint);
}

function graph3dPaintNode(hier, g, share) {
  let parts = hier.parts.get(g);
  if (!parts) {
    parts = [...g.querySelectorAll('.graph-kids-ring, .graph-flag-ring, .graph-node-id, .graph-node-name')];
    hier.parts.set(g, parts);
  }
  graph3dPaintMark(hier, g.querySelector('.graph-dot'), share, true);
  for (const el of parts) graph3dPaintMark(hier, el, share);
}

// One frame of the marks: the dots, their shadows and paint order, the lines and counts, the captions,
// then the labels kept apart.
function graph3dPlaceMarks(hier) {
  const { drawn } = hier.view;
  drawn.world.removeAttribute('transform');
  const sphere = hier.shape === 'sphere' && !hier.morph;
  const bowl = hier.shape === 'half' && !hier.morph;
  const e = hier.camera.position;
  const eye = [e.x, e.y, e.z];
  const dimmed = drawn.svg.classList.contains('graph-dim');
  const f = {
    v: new hier.T.Vector3(),
    bent: sphere || bowl,
    top: graph3dTopDown(hier.cam),
    focus: document.activeElement,
    // The far side: the sphere's back, and the bowl's wall where the camera sees it from outside.
    isFar: (p) => (sphere && graph3dFar(p, eye)) || (bowl && graph3dBowlBack(p, eye, hier.rim)),
    // A card the lighting leaves unlit (graphLightCards) keeps less again, but never less than its floor.
    unlitIf: (el, kind) => (dimmed && !el.classList.contains('graph-near') ? GRAPH3D_UNLIT[kind] : null),
    dimmed,
  };
  const vis = graph3dPlaceDots(hier, f);
  graph3dPlaceShadows(hier, f, vis);
  graph3dOrderDots(hier, f, vis);
  const texts = graph3dPlaceLines(hier, f, vis);
  graph3dPlaceCaptions(hier, f, texts);
  if (hier.shape === 'disc' && !hier.morph && f.top && vis.length) graph3dPlaceNamesAsIn2D(hier, vis[0].s);
  else graph3dPlaceLabels(hier, vis, texts);
}

// Each dot where the camera sees it, at the scale it is seen, with its label's scale, painted by depth; a dot
// the camera has come too close to is not drawn. Sets on `f` the depth range and the share of colour by depth
// (f.keepOf), and answers the dots drawn.
function graph3dPlaceDots(hier, f) {
  const { drawn, plan } = hier.view;
  // What the camera looks at is seen at `ref`: a mark nearer than that is drawn larger (to NEAR_CAP)
  // and so is its label (graph3dLabelScale); straight above every mark is at `ref`.
  const ref = graph3dScaleAt(hier, hier.cam.dist);
  const grow = hier.fitDist > 0 ? hier.fitDist / hier.cam.dist : 1;
  // A lit card (hovered, selected, focused, or lit by a hover, an isolate or a search) keeps its colour
  // and its label on the sphere's far side and at the back.
  const litOf = (g) => g.classList.contains('selected') || g.classList.contains('hover-highlight') || g === f.focus
    || (f.dimmed && g.classList.contains('graph-near'));
  const vis = [];
  let sum = 0;
  let zmin = Infinity, zmax = -Infinity;
  let inView = 0;
  for (const n of plan.nodes) {
    const g = drawn.nodeEls.get(n.id);
    if (!g) continue;
    const p = graph3dAt(hier, n.x, n.y);
    const q = graph3dProject(hier, p, f.v);
    const close = q ? graph3dCloseFade(graph3dScaleAt(hier, q[2])) : 0;
    if (!close) { g.classList.add('graph-3d-off'); continue; }
    g.classList.remove('graph-3d-off');
    const raw = graph3dScaleAt(hier, q[2]);
    const s = Math.round(graph3dMarkScale(raw, hier.cam.phi, hier.shape, ref) * 10000) / 10000;
    g.setAttribute('transform', `translate(${graph3dRound2(q[0])} ${graph3dRound2(q[1])}) scale(${s})`);
    g.style.setProperty('--graph-k', String(s));
    const ls = Math.round(graph3dLabelScale(raw, ref, f.top, grow) * 1000) / 1000;
    g.style.setProperty('--graph-3d-s', String(ls));
    const lit = litOf(g);
    const far = f.isFar(p) && !lit;
    g.classList.toggle('graph-3d-far', far);
    vis.push({ n, g, x: q[0], y: q[1], z: q[2], s, far, close, ls, lit });
    sum += s;
    zmin = Math.min(zmin, q[2]);
    zmax = Math.max(zmax, q[2]);
    if (q[0] > 0 && q[0] < hier.w && q[1] > 0 && q[1] < hier.h) inView++;
  }
  // Depth: the farther a mark, the more of the ground it takes, up to DEPTH_FADE at the back, and the
  // ground's lines the same by the fog; the far side of the sphere takes FAR_KEEP more. Straight above
  // every mark is as near as the next, so nothing changes from the 2D picture.
  const span = zmax - zmin;
  const deep = span > 1 && !f.top;
  f.zmax = zmax;
  f.keepOf = (z, far, close, lit) => (deep && !lit ? 1 - (GRAPH3D_DEPTH_FADE * (z - zmin)) / span : 1) * (far ? GRAPH3D_FAR_KEEP : 1) * close;
  for (const o of vis) {
    o.keep = f.keepOf(o.z, o.far, o.close, o.lit);
    o.unlit = f.unlitIf(o.g, 'node');
    graph3dPaintNode(hier, o.g, graph3dShare(o.keep, o.unlit));
  }
  if (hier.scene.fog) {
    const sp = Math.sin(Math.min(Math.PI / 2, Math.max(0, hier.cam.phi)));
    const mix = hier.shape === 'sphere' ? GRAPH3D_DEPTH_FADE : Math.max(GRAPH3D_DEPTH_FADE, GRAPH3D_GROUND_FOG * sp);
    hier.scene.fog.near = deep ? zmin : 1e9;
    hier.scene.fog.far = deep ? zmin + span / mix : 1e9 + 1;
  }
  hier.vis = vis.map((o) => ({ id: o.n.id, x: o.x, y: o.y, z: o.z, r: (o.n.reach || o.n.r || 5) * o.s }));
  const empty = vis.length > 0 && inView === 0 || !vis.length;
  if (empty !== hier.empty) { hier.empty = empty; graph3dPaintLabel(hier); }
  const k = vis.length ? sum / vis.length : 1;
  drawn.svg.classList.toggle('graph-labels-all', graphLabelsAll(k));
  return vis;
}

// A mark's contact shadow: tilted, on the disc and the bowl, a mark stands on the ground as a ball would, its
// shadow under it and showing below it, as dark as the mark is kept; nothing from straight above or on the sphere.
function graph3dPlaceShadows(hier, f, vis) {
  const phi = Math.min(Math.PI / 2, Math.max(0, hier.cam.phi));
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const m = hier.morph;
  const round = m ? (m.from === 'sphere' ? 1 - m.e : m.to === 'sphere' ? m.e : 0) : hier.shape === 'sphere' ? 1 : 0;
  const shade = f.top ? 0 : (1 - round) * sp;
  for (const o of vis) {
    const sh = hier.shadows.get(o.n.id);
    if (!sh) continue;
    const dark = shade > 0 && !o.far ? Math.round(GRAPH3D_SHADOW * shade * o.keep * (o.unlit ? o.unlit.dim : 1) * 1000) / 1000 : 0;
    if (sh.dark !== dark) { sh.dark = dark; sh.grad.style.setProperty('--graph-3d-shadow', String(dark)); }
    if (!dark) continue;
    const r = o.n.reach || o.n.r || 5;
    sh.el.setAttribute('cy', graph3dRound2(r * (1.1 * sp + 0.1)));
    sh.el.setAttribute('rx', graph3dRound2(1.2 * r));
    sh.el.setAttribute('ry', graph3dRound2(Math.max(0.4 * r, 1.15 * r * cp)));
  }
}

// Back to front, the far side under the near side, the lit cards last, so a selected or hovered card is
// never under a nearer dimmed one and a mark seen through the bowl's wall never over one inside it.
function graph3dOrderDots(hier, f, vis) {
  const { drawn } = hier.view;
  const order = graph3dPaintOrder(vis);
  const key = order.map((o) => o.n.id).join(' ');
  if (key === hier.order) return;
  hier.order = key;
  // Moving a mark in the page takes its focus away (the card the search box's Enter went to), so it is given back.
  const had = f.focus && drawn.world.contains(f.focus) ? f.focus : null;
  const pressed = hier.pressed && hier.pressed.parentNode === drawn.world ? hier.pressed : null;
  const { before, after } = graph3dRestack(order.map((o) => o.g), pressed);
  for (const g of before) drawn.world.insertBefore(g, pressed);
  for (const g of after) drawn.world.appendChild(g);
  if (had && document.activeElement !== had) had.focus({ preventScroll: true });
}

// The plan's points along `runs` as an SVG path where the camera sees them, lifting the pen past the camera.
function graph3dPathOf(hier, f, runs) {
  let d = '';
  for (const piece of runs) {
    let pen = false;
    for (const [x, y] of piece) {
      const q = graph3dProject(hier, graph3dAt(hier, x, y), f.v);
      if (!q) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${graph3dRound2(q[0])} ${graph3dRound2(q[1])}`;
      pen = true;
    }
  }
  return d;
}

// Each line bent with the shape, as wide and as far into the ground as the dots at its ends are seen, and
// its count where the camera sees its point. On the sphere and the bowl a line is cut where it goes round
// to the far side: the far runs are drawn by a copy of the line just under it, darkened as the far dots
// are. Answers the counts drawn, for the labels to keep apart.
function graph3dPlaceLines(hier, f, vis) {
  const { drawn, plan } = hier.view;
  const texts = [];
  const byId = new Map(vis.map((o) => [o.n.id, o]));
  plan.links.forEach((l, i) => {
    let lineLs = 1;
    let lineKeep = 1;
    const pieces = hier.links[i] || [];
    const split = f.bent ? graph3dSplitFar(pieces, (pt) => f.isFar(graph3dAt(hier, pt[0], pt[1]))) : { near: pieces, far: [] };
    const el = drawn.linkEls[i];
    const d = graph3dPathOf(hier, f, split.near);
    if (el) {
      el.setAttribute('d', d);
      const ends = [l.from].concat(l.kids || [l.to]).map((id) => byId.get(id)).filter(Boolean);
      const sk = ends.length ? ends.reduce((a, o) => a + o.s, 0) / ends.length : hier.kHome;
      const z = ends.length ? ends.reduce((a, o) => a + o.z, 0) / ends.length : f.zmax;
      el.style.setProperty('--graph-3d-w', String(Math.round(graph3dLineWidth(sk, hier.kHome) * 1000) / 1000));
      lineKeep = f.keepOf(z, false, 1, false);
      graph3dPaintMark(hier, el, graph3dShare(lineKeep, f.unlitIf(el, 'link')));
      if (ends.length) lineLs = Math.round((ends.reduce((a, o) => a + o.ls, 0) / ends.length) * 1000) / 1000;
    }
    if (drawn.hitEls[i]) drawn.hitEls[i].setAttribute('d', split.far.length ? graph3dPathOf(hier, f, pieces) : d);
    if (el) graph3dFarLink(hier, i, el, split.far.length ? graph3dPathOf(hier, f, split.far) : '', f.unlitIf(el, 'link'));
    const count = drawn.countEls[i];
    if (count && l.label) {
      const p = graph3dAt(hier, l.label.x, l.label.y);
      const q = graph3dProject(hier, p, f.v);
      const far = f.isFar(p);
      count.classList.toggle('graph-3d-off', !q || far);
      if (q) {
        count.setAttribute('x', graph3dRound2(q[0]));
        count.setAttribute('y', graph3dRound2(q[1]));
        count.style.setProperty('--graph-3d-s', String(lineLs));
        graph3dPaintMark(hier, count, graph3dShare(lineKeep, el ? f.unlitIf(el, 'count') : null));
        if (!far) texts.push({ el: count, x: q[0], y: q[1], anchor: 'middle', middle: true, size: 11 * lineLs });
      }
    }
  });
  return texts;
}

// The copy of line i that draws its runs on the far side (d), under the line itself; emptied when it has none.
function graph3dFarLink(hier, i, el, d, unlit) {
  let f = hier.farLinks[i];
  if (!d) { if (f) f.setAttribute('d', ''); return; }
  if (!f) {
    f = el.cloneNode(false);
    f.removeAttribute('marker-end');
    hier.farLinks[i] = f;
  }
  if (f.nextSibling !== el) el.parentNode.insertBefore(f, el);
  f.setAttribute('class', `${el.getAttribute('class')} graph-3d-far`);
  graph3dPaintMark(hier, f, graph3dShare(GRAPH3D_FAR_KEEP, unlit));
  f.style.setProperty('--graph-3d-w', el.style.getPropertyValue('--graph-3d-w') || '1');
  f.setAttribute('d', d);
}

// The captions (a tier's, the Unnested block's title and columns) where the camera sees their point,
// added to `texts` for the labels to keep apart.
function graph3dPlaceCaptions(hier, f, texts) {
  for (const c of hier.captions) {
    const p = graph3dAt(hier, c.x, c.y);
    const q = graph3dProject(hier, p, f.v);
    c.el.classList.toggle('graph-3d-off', !q);
    c.el.classList.toggle('graph-3d-far', !!q && f.isFar(p));
    if (!q) continue;
    c.el.setAttribute('x', graph3dRound2(q[0]));
    c.el.setAttribute('y', graph3dRound2(q[1]));
    const title = c.el.classList.contains('graph-block-title');
    texts.push({ el: c.el, x: q[0], y: q[1], anchor: c.el.getAttribute('text-anchor') || 'start', middle: c.el.hasAttribute('dy'), size: title ? 13 : 11, bold: title });
    const keep = f.keepOf(q[2], f.isFar(p), 1, false);
    graph3dPaintMark(hier, c.el, keep);
    for (const name of c.names) graph3dPaintMark(hier, name, keep);
  }
}

// The cards that carry their names: the 2D Graph's own choice (graphFanNames), which follows the selection.
function graph3dNamedNow(hier) {
  return graphFanNames(hier.view.model, graphLoadOptions().names, { selectedIds, loneCardId: graphLoneCardId() });
}

// A card's id beside its dot: on the right, where 2D has it (straight above at 2D's own offset, `o`
// absent), else 3 px past the dot as drawn (o: its mark scale s and label scale ls) on the right, the
// left or under it, whichever has room.
function graph3dPlaceId(hier, n, g, slot, o) {
  const gap = o ? n.reach + (3 * o.ls) / o.s : n.reach + 3;
  const x = slot === 'below' || slot === 'above' ? 0 : slot === 'left' ? -gap : gap;
  const off = o ? n.reach + (3 + 7 * o.ls) / o.s : 0;
  const y = slot === 'below' ? off : slot === 'above' ? -off : 0;
  const key = `${graph3dRound2(x)} ${graph3dRound2(y)} ${slot}`;
  if (hier.idSide.get(n.id) === key) return;
  hier.idSide.set(n.id, key);
  const id = g.querySelector('.graph-node-id');
  if (!id) return;
  id.setAttribute('x', graph3dRound2(x));
  if (y) id.setAttribute('y', graph3dRound2(y));
  else id.removeAttribute('y');
  id.setAttribute('text-anchor', slot === 'below' || slot === 'above' ? 'middle' : slot === 'left' ? 'end' : 'start');
}

// Straight down on the disc the picture is the 2D Hierarchy's, so the names go where it puts them
// (graphNamesPlace, graph-names.js, at the scale the camera sees the plane at), leaders and rows included.
function graph3dPlaceNamesAsIn2D(hier, k) {
  const { plan, layout, drawn, model } = hier.view;
  const named = graph3dNamedNow(hier);
  const lit = graphRestLit(model, { selectedIds, loneCardId: graphLoneCardId() }, plan.links);
  const input = {
    plan, rim: graphNamesRim(layout), named, keep: lit ? lit.nodes : [], k: Math.round(k * 10000) / 10000,
    labelsAll: drawn.svg.classList.contains('graph-labels-all'), measure: graphMeasureName, font: graphNamesFont(),
  };
  const key = graphNamesKey(input);
  if (!hier.names || hier.names.key !== key) hier.names = { key, result: graphNamesPlace(input) };
  const names = hier.names.result;
  hier.namesMode = 'top';
  for (const n of plan.nodes) {
    const g = drawn.nodeEls.get(n.id);
    const els = drawn.nameEls.get(n.id);
    if (!g) continue;
    g.classList.remove('graph-3d-noid');
    graph3dPlaceId(hier, n, g, 'right');
    if (!els) continue;
    const p = names ? names.placed.get(n.id) : null;
    g.classList.toggle('graph-named', named.has(n.id));
    g.classList.toggle('graph-placed', !!p);
    g.classList.toggle('graph-called', !!(p && p.leader));
    els.text.textContent = p ? p.text : n.name;
    els.text.setAttribute('x', p ? graph3dRound2(p.x - n.x) : n.reach + 3);
    els.text.setAttribute('y', p ? graph3dRound2(p.y - n.y) : 0);
    els.text.setAttribute('text-anchor', p ? p.anchor : 'start');
    els.leader.setAttribute('d', p && p.leader ? p.leader.d : '');
  }
}

// Tilted, turned, bent or flown into, each frame keeps the labels apart (graph3dPick): the hovered
// card and the selection first, then the largest as drawn (the nearest). A card's name goes beside its
// dot where it meets no other label and no dot as near as its own, else its id does, on the right, the
// left or under it; an id with no room is not shown, nor are a link's count or a caption that would sit
// on any dot or a label. A label may lie over a dot well behind its own. Each label is as large as its
// dot is near (--graph-3d-s). The ids of the far side come last, where room is left.
function graph3dPlaceLabels(hier, vis, texts) {
  const { plan, drawn } = hier.view;
  const named = graph3dNamedNow(hier);
  if (hier.namesMode !== 'tilt') {
    hier.namesMode = 'tilt';
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
  const rank = (o) => (o.g.classList.contains('hover-highlight') ? 4 : 0) + (o.g.classList.contains('selected') ? 2 : 0)
    + (dim && o.g.classList.contains('graph-near') ? 1 : 0);
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
    const w = graphMeasureName(String(o.n.id)) * o.ls;
    const gap = o.n.reach * o.s + 3 * o.ls;
    return [line(o.x + gap, w, o.y, o.ls), line(o.x - gap - w, w, o.y, o.ls), line(o.x - w / 2, w, o.y + o.n.reach * o.s + 3 + 7 * o.ls, o.ls)];
  };
  for (const o of near) {
    const boxes = [];
    const kind = [];
    if (named.has(o.n.id) && o.n.name) {
      const box = line(o.x + (o.n.reach + 3) * o.s, graphMeasureName(o.n.name) * o.ls, o.y, o.ls);
      if (box.x1 < hier.w && box.y0 > 0 && box.y1 < hier.h) { boxes.push(box); kind.push('name'); }
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
    const w = graphMeasureName(t.el.textContent, t.size, t.bold);
    const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
    const box = t.middle ? line(x0, w, t.y, t.size / 11) : { x0, x1: x0 + w, y0: t.y - t.size, y1: t.y + 3 };
    items.push({ key: `text ${i}`, boxes: [box] });
  });
  for (const o of back) {
    // Painted under the near side, a far id lies over no near dot, and over a far one only well behind it;
    // it may also stand above its dot, where the near side often leaves room.
    const w = graphMeasureName(String(o.n.id)) * o.ls;
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
    if (kind && kind !== 'name') graph3dPlaceId(hier, o.n, o.g, kind, o);
  }
  texts.forEach((t, i) => { if (!shown.has(`text ${i}`)) t.el.classList.add('graph-3d-off'); });
}
