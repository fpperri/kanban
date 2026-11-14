'use strict';
// The running 3D Hierarchy: its state (`hier`, one at a time, graph3dCur), its life from three.js's load to
// its teardown, the frame loop, and what the Graph calls (graph3dShow, graph3dRelease and the rest). The
// camera, the ground, the marks, the input and the compass are graph-3d-camera.js, -ground.js, -marks.js,
// -input.js and -compass.js; the pure helpers, the tuning and the 3D options' defaults are graph-3d.js.

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

// A new 3D Hierarchy, not yet drawn. It outlives the Graph's draws (every poll and selection rebuilds the
// 2D marks): graph3dShowPlan takes the new marks and plan and keeps the camera and the shape.
function graph3dCreate() {
  graph3dLoadOptions();
  const root = document.createElement('div');
  root.className = 'graph-3d';
  const label = document.createElement('p');
  label.className = 'graph-3d-label';
  label.title = GRAPH3D_HELP;
  label.setAttribute('aria-live', 'polite');
  root.appendChild(label);
  const pivotMark = document.createElement('span');
  pivotMark.className = 'graph-3d-pivot';
  pivotMark.dataset.on = '0';
  pivotMark.setAttribute('aria-hidden', 'true');
  root.appendChild(pivotMark);
  const hier = {
    root, label, pivotMark, pivotAt: null, compass: null, dial: null, north: null,
    gone: false, T: null, renderer: null, scene: null, camera: null,
    ground: [], groundKey: '', groundAt: '', view: null, overlay: null, links: [], farLinks: [], captions: [], rim: 100, outer: 0,
    names: null, namesMode: '',
    shape: 'disc', morph: null,
    cam: { theta: 0, phi: 0, dist: 1000, tx: 0, ty: 0, tz: 0 }, framed: false, fly: null, lastF: null,
    raf: 0, w: 1, h: 1, cw: 1, ch: 1, ox: 0, oy: 0, order: '',
    drag: null, pointers: new Map(), pressed: null, pinch: null, right: null, rightTimer: 0, replaying: false, ro: null,
    zoom: null, coast: null, walk: new Set(), turn: new Set(), tick: 0, vis: [], kHome: 1, hint: true, hintTimer: 0, empty: false, dprWatch: null,
    fitDist: 0, idSide: new Map(), armed: true, quietAt: null,
    theme: 0, groundRgb: { r: 0, g: 0, b: 0, a: 1 }, inks: new WeakMap(), painted: new WeakMap(), parts: new WeakMap(), shadows: new Map(),
    bg: null, scheme: null, themeWatch: null, onTheme: null, compassAt: '',
  };
  root.appendChild(graph3dBuildCompass(hier));
  graph3dPaintLabel(hier);
  hier.hintTimer = setTimeout(() => graph3dEndHint(hier), GRAPH3D_HINT_MS);
  graph3dWireInput(hier);
  window.addEventListener('keydown', graph3dOnKey, true);
  window.addEventListener('keyup', graph3dOnKeyUp, true); // key-guard: exempt (only lets go of a walk or turn key held down, wherever the focus is)
  window.addEventListener('blur', graph3dOnBlur);
  // The colours are read off the stylesheet, so a change of theme (the system's or the page's own
  // data-theme) reads them again: the ground's, the marks' inks and the shadows'.
  hier.onTheme = () => graph3dOnTheme(hier);
  hier.scheme = matchMedia('(prefers-color-scheme: dark)');
  hier.scheme.addEventListener('change', hier.onTheme);
  hier.themeWatch = new MutationObserver(hier.onTheme);
  hier.themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return hier;
}

// The 3D options (GRAPH3D_OPTIONS) are the board `graph3dOptionsBoard`'s, read from this browser
// (graph3dLoadOptions) the first time the board's 3D Hierarchy or its panel section is drawn.
let graph3dOptionsBoard = null;

function graph3dOptionsKey() {
  return storageKey(state.projectName, 'graph.3d');
}

function graph3dSetOptions(options) {
  for (const k of Object.keys(options)) GRAPH3D_OPTIONS[k] = options[k];
}

// The board's 3D options as this browser keeps them, merged with the defaults (graph3dMergeOptions), so a
// value this version does not offer, or storage that refuses, reads as the default. Read once per board.
function graph3dLoadOptions() {
  if (graph3dOptionsBoard === state.projectName) return;
  graph3dOptionsBoard = state.projectName;
  let saved = null;
  try {
    const raw = localStorage.getItem(graph3dOptionsKey());
    if (raw) saved = JSON.parse(raw);
  } catch (e) { saved = null; }
  graph3dSetOptions(graph3dMergeOptions(saved));
}

function graph3dSaveOptions() {
  try { localStorage.setItem(graph3dOptionsKey(), JSON.stringify(GRAPH3D_OPTIONS)); }
  catch (e) { /* storage unavailable: the options just won't persist this session */ }
}

// Reset: the defaults again, and nothing kept for the board.
function graph3dResetOptions() {
  try { localStorage.removeItem(graph3dOptionsKey()); }
  catch (e) { /* storage unavailable: nothing was kept */ }
  graph3dSetOptions(graph3dMergeOptions(null));
}

// The sliders of the 3D section for `shape`, each with the value it shows and what a move of it sets. The
// pole sliders, the far side and the line strength are the dome's and the sphere's, and stand disabled on
// the disc. The ring stays at least 5 degrees under the centre.
const GRAPH3D_DEG = Math.PI / 180;
function graph3dOptionSliders(shape) {
  const hier = graph3dCur;
  const bent = shape === 'half' || shape === 'sphere';
  const R = GRAPH3D_OPTION_RANGES;
  const def = bent && hier ? graph3dPoleDefaults(shape, hier.rim, hier.outer) : { top: 0, ring: Math.PI / 2 };
  const poles = bent ? GRAPH3D_OPTIONS.poles[shape] : { top: 0, ring: null };
  const deg = (r) => r[bent ? shape : 'half'];
  const gap = 5 * GRAPH3D_DEG;
  const ringMax = deg(R.ring)[1] * GRAPH3D_DEG;
  const pct = (key) => ({ min: R[key][0] * 100, max: R[key][1] * 100, step: 1, unit: '%',
    get: () => Math.round(GRAPH3D_OPTIONS[key] * 100), set: (v) => { GRAPH3D_OPTIONS[key] = v / 100; } });
  const times = (key) => ({ min: R[key][0], max: R[key][1], step: 0.05, unit: '×',
    get: () => GRAPH3D_OPTIONS[key], set: (v) => { GRAPH3D_OPTIONS[key] = v; } });
  return [
    { key: 'top', label: 'Centre below the top pole', unit: '°', min: deg(R.top)[0], max: deg(R.top)[1], step: 1, off: !bent,
      get: () => Math.round(poles.top / GRAPH3D_DEG),
      set: (v) => {
        poles.top = v * GRAPH3D_DEG;
        if ((poles.ring == null ? def.ring : poles.ring) < poles.top + gap) poles.ring = Math.min(ringMax, poles.top + gap);
      } },
    { key: 'ring', label: 'Outermost ring down to', unit: '°', min: deg(R.ring)[0], max: deg(R.ring)[1], step: 1, off: !bent,
      get: () => Math.round((poles.ring == null ? def.ring : poles.ring) / GRAPH3D_DEG),
      set: (v) => { poles.ring = Math.max(v * GRAPH3D_DEG, poles.top + gap); } },
    Object.assign({ key: 'size', label: 'Mark size: world to screen' }, pct('size')),
    Object.assign({ key: 'scale', label: 'Mark scale' }, times('scale')),
    Object.assign({ key: 'far', label: 'Far side kept', off: !bent }, pct('far')),
    Object.assign({ key: 'lines', label: 'Line strength', off: !bent }, pct('lines')),
    Object.assign({ key: 'move', label: 'Move speed (W A S D)' }, times('move')),
    Object.assign({ key: 'spin', label: 'Spin speed (Q E)' }, times('spin')),
  ];
}

// The Graph panel's 3D section (graphBuildPanel), while 3D is on: the 3D options as sliders that change the
// scene as they move and are kept per board in this browser, and a Reset that sets them back. It follows
// the shape (graph3dRepaintOptions).
function graph3dBuildOptions() {
  graph3dLoadOptions();
  const box = document.createElement('div');
  box.className = 'graph-3d-options';
  box.dataset.keepsSelection = '';
  graph3dPaintOptions(box);
  return box;
}

function graph3dPaintOptions(box) {
  const shape = graph3dCur ? graph3dCur.shape : 'disc';
  box.textContent = '';
  const head = document.createElement('p');
  head.className = 'graph-3d-options-head';
  const title = document.createElement('span');
  title.className = 'graph-option-label';
  title.textContent = `3D: ${graph3dShapeName(shape)}`;
  head.appendChild(title);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'graph-3d-options-reset';
  reset.textContent = 'Reset';
  reset.title = 'Set the 3D options back to their defaults';
  reset.addEventListener('click', (e) => {
    e.stopPropagation();
    graph3dResetOptions();
    graph3dOptionsChanged();
    graph3dPaintOptions(box);
  });
  head.appendChild(reset);
  box.appendChild(head);
  for (const sl of graph3dOptionSliders(shape)) {
    const row = document.createElement('label');
    row.className = 'graph-3d-option';
    const name = document.createElement('span');
    name.className = 'graph-option-label';
    name.textContent = sl.label;
    const out = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.dataset.graph3dOption = sl.key;
    input.min = String(sl.min); input.max = String(sl.max); input.step = String(sl.step);
    input.value = String(sl.get());
    input.disabled = !!sl.off;
    out.textContent = `${sl.get()}${sl.unit}`;
    input.addEventListener('input', () => {
      sl.set(Number(input.value));
      out.textContent = `${sl.get()}${sl.unit}`;
      graph3dSaveOptions();
      graph3dOptionsChanged();
    });
    // Let go after a drag or a click, the slider gives the focus back, so W, A, S, D, Q and E work at once;
    // the arrow keys still move a slider that took the focus from the keyboard.
    input.addEventListener('pointerup', () => input.blur());
    row.appendChild(name);
    row.appendChild(out);
    row.appendChild(input);
    box.appendChild(row);
  }
}

// The 3D section shown again for the shape the 3D Hierarchy is on now.
function graph3dRepaintOptions() {
  const box = document.querySelector('.graph-3d-options');
  if (box) graph3dPaintOptions(box);
}

// An option changed: the ground is placed again and the next frame drawn.
function graph3dOptionsChanged() {
  const hier = graph3dCur;
  if (!hier) return;
  hier.groundAt = '';
  hier.painted = new WeakMap();
  for (const g of hier.ground) g.painted = '';
  graph3dRequest(hier);
}

function graph3dReady(hier) {
  return !!(hier.renderer && hier.view);
}

function graph3dVisible(hier) {
  return hier.root.isConnected && hier.root.getClientRects().length > 0;
}

// The first seconds, or until the first gesture, the label names the gestures; then the shape and its keys.
function graph3dPaintLabel(hier) {
  hier.label.textContent = hier.hint ? GRAPH3D_HINT
    : `${graph3dShapeName(hier.shape)} · G shape · F wide/close · H home · QE spin · WS fly · AD slide${hier.empty ? ' · nothing in view: H brings it back' : ''}`;
  hier.root.dataset.shape = hier.shape;
}

function graph3dEndHint(hier) {
  if (!hier.hint) return;
  hier.hint = false;
  clearTimeout(hier.hintTimer);
  graph3dPaintLabel(hier);
}

function graph3dRequest(hier) {
  if (hier.gone || hier.raf || !hier.renderer) return;
  hier.raf = requestAnimationFrame(() => graph3dFrame(hier));
}

// The canvas reaches past the stage to the Graph's frame (app.css), so the ground runs to the edge;
// the camera keeps the stage's own picture (setViewOffset), so a point lands where the 2D Hierarchy has it.
function graph3dMeasure(hier) {
  hier.w = Math.max(1, hier.root.clientWidth || 800);
  hier.h = Math.max(1, hier.root.clientHeight || 600);
  if (!hier.renderer) return;
  const r = hier.root.getBoundingClientRect();
  const k = hier.renderer.domElement.getBoundingClientRect();
  hier.cw = Math.max(1, Math.round(k.width) || hier.w);
  hier.ch = Math.max(1, Math.round(k.height) || hier.h);
  hier.ox = Math.round(r.left - k.left) || 0;
  hier.oy = Math.round(r.top - k.top) || 0;
  hier.renderer.setPixelRatio(window.devicePixelRatio || 1);
  hier.renderer.setSize(hier.cw, hier.ch, false);
  hier.camera.aspect = hier.w / hier.h;
  hier.camera.setViewOffset(hier.w, hier.h, -hier.ox, -hier.oy, hier.cw, hier.ch);
  hier.camera.updateProjectionMatrix();
}

// The point of the plan (x, y) where the shape stands now, mid-morph included.
function graph3dAt(hier, x, y) {
  const m = hier.morph;
  return m ? graph3dMorph(m.from, m.to, m.e, x, y, hier.rim, hier.outer) : graph3dPlace(hier.shape, x, y, hier.rim, hier.outer);
}

// One frame: the zoom, the walk, the turn, the coast, the morph and the flight moved on by the time since the last, then the
// camera, the ground and the marks; another frame is asked for while any is still on its way.
function graph3dFrame(hier) {
  hier.raf = 0;
  if (hier.gone || !hier.view) return;
  const now = performance.now();
  const dt = Math.min(64, Math.max(1, now - (hier.tick || now - 16)));
  hier.tick = now;
  let more = false;
  if (hier.zoom) {
    const a = 1 - Math.exp(-dt / GRAPH3D_ZOOM_TAU);
    const c = hier.cam, z = hier.zoom;
    for (const k of ['tx', 'ty', 'tz', 'dist', 'phi']) c[k] += (z[k] - c[k]) * a;
    if (Math.abs(z.dist - c.dist) < z.dist * 0.002 && Math.hypot(z.tx - c.tx, z.ty - c.ty, z.tz - c.tz) < 0.05 && Math.abs(z.phi - c.phi) < 0.002) {
      Object.assign(c, z);
      hier.zoom = null;
    } else more = true;
  }
  if (hier.walk.size) {
    const pace = graph3dPaceOf(hier);
    const step = graph3dWalk(hier.walk, hier.cam.theta, hier.cam.phi, pace, dt * GRAPH3D_OPTIONS.move);
    if (step) {
      for (const c of hier.zoom ? [hier.cam, hier.zoom] : [hier.cam]) { c.tx += step[0]; c.ty += step[1]; c.tz += step[2]; }
      more = true;
    }
    const ahead = graph3dFlyStep(hier.walk, pace, dt * GRAPH3D_OPTIONS.move);
    if (ahead) {
      graph3dFlyBy(hier, ahead);
      more = true;
    }
  }
  if (hier.turn.size) {
    const turn = graph3dTurn(hier.turn, dt * GRAPH3D_OPTIONS.spin);
    if (turn) {
      graph3dSpin(hier, turn);
      more = true;
    }
  }
  if (hier.coast) {
    const spins = hier.coast.spins;
    if (spins) graph3dSpinDragBy(hier, hier.coast.vx * dt, hier.coast.vy * dt);
    else graph3dLookBy(hier, hier.coast.vx * dt, hier.coast.vy * dt);
    hier.coast = graph3dCoast(hier.coast, dt);
    if (hier.coast && spins) hier.coast.spins = true;
    if (hier.coast) more = true;
  }
  if (hier.morph) {
    const t = Math.min(1, (now - hier.morph.t0) / GRAPH3D_MORPH_MS);
    hier.morph.e = graph3dEase(t);
    if (t >= 1) hier.morph = null;
    else more = true;
  }
  if (hier.fly) {
    const t = Math.min(1, (now - hier.fly.t0) / hier.fly.ms);
    const e = graph3dEase(t);
    for (const k of ['tx', 'ty', 'tz', 'dist', 'theta', 'phi']) hier.cam[k] = hier.fly.from[k] + (hier.fly.to[k] - hier.fly.from[k]) * e;
    if (t >= 1) hier.fly = null;
    else more = true;
  }
  graph3dApplyCamera(hier);
  graph3dPaintPivot(hier);
  graph3dPlaceGround(hier);
  graph3dPlaceMarks(hier);
  graph3dPaintGround(hier);
  hier.renderer.render(hier.scene, hier.camera);
  if (more) graph3dRequest(hier);
  else hier.tick = 0;
}

function graph3dInit(hier, T) {
  hier.T = T;
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'graph-3d-canvas';
  hier.root.insertBefore(renderer.domElement, hier.root.firstChild);
  hier.renderer = renderer;
  hier.scene = new T.Scene();
  hier.camera = new T.PerspectiveCamera(GRAPH3D_FOV, 1, 1, 100000);
  hier.scene.fog = new T.Fog(0x000000, 1e9, 1e9 + 1);
  hier.ro = new ResizeObserver(() => { graph3dMeasure(hier); graph3dRequest(hier); });
  hier.ro.observe(hier.root);
  graph3dWatchDpr(hier);
}

// A window moved to a screen of another pixel ratio draws the ground at that ratio.
function graph3dWatchDpr(hier) {
  if (hier.gone) return;
  const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  const on = () => {
    mq.removeEventListener('change', on);
    hier.dprWatch = null;
    if (hier.gone || !hier.renderer) return;
    graph3dMeasure(hier);
    graph3dRequest(hier);
    graph3dWatchDpr(hier);
  };
  mq.addEventListener('change', on);
  hier.dprWatch = { mq, on };
}

// A draw of the Graph: its marks and plan (`view`), shown with the camera and the shape kept. The first
// waits for three.js.
function graph3dShowPlan(hier, view) {
  hier.view = view;
  if (hier.gone) return;
  if (!hier.renderer) {
    hier.root.classList.add('graph-3d-loading');
    graph3dLoadThree().then((T) => {
      if (hier.gone || hier.renderer) return;
      hier.root.classList.remove('graph-3d-loading');
      graph3dInit(hier, T);
      graph3dShowPlan(hier, hier.view);
    }).catch((err) => {
      if (hier.gone) return;
      hier.label.textContent = GRAPH3D_LOAD_FAILED;
      console.error('graph3d: three.js failed', err);
    });
    return;
  }
  const { drawn, plan } = view;
  hier.rim = graph3dRim(plan);
  hier.outer = graph3dOuter(plan);
  hier.links = plan.links.map((l) => graph3dPathPoints(l.d, 8));
  hier.farLinks = [];
  hier.namesMode = '';
  hier.idSide = new Map();
  graph3dTakeMarks(hier, drawn, plan);
  if (hier.overlay !== drawn.stage) {
    if (hier.overlay) hier.overlay.remove();
    hier.overlay = drawn.stage;
    hier.root.insertBefore(drawn.stage, hier.label);
    hier.order = '';
  }
  graph3dMeasure(hier);
  const key = [
    plan.tints.map((t) => t.d).join(),
    plan.guides.map((g) => g.d).join(),
    plan.dividers.map((d) => [d.x1, d.y1, d.x2, d.y2].join()).join(),
    plan.block ? [plan.block.x, plan.block.y, plan.block.w, plan.block.h].join() : '',
  ].join('|');
  if (key !== hier.groundKey) {
    hier.groundKey = key;
    graph3dBuildGround(hier, plan, drawn.svg);
  } else graph3dRecolourGround(hier, drawn.svg);
  graph3dShadowInk(hier, drawn.svg);
  hier.groundAt = '';
  if (!hier.framed) { hier.framed = true; graph3dFrameAll(hier, true); }
  if (hier.raf) { cancelAnimationFrame(hier.raf); hier.raf = 0; }
  graph3dFrame(hier);
}

function graph3dOnTheme(hier) {
  if (hier.gone || !graph3dReady(hier)) return;
  hier.theme++;
  graph3dRecolourGround(hier, hier.view.drawn.svg);
  graph3dShadowInk(hier, hier.view.drawn.svg);
  graph3dRequest(hier);
}

function graph3dDestroy(hier) {
  if (hier.gone) return;
  hier.gone = true;
  if (hier.raf) cancelAnimationFrame(hier.raf);
  hier.raf = 0;
  clearTimeout(hier.hintTimer);
  clearTimeout(hier.rightTimer);
  if (hier.dprWatch) hier.dprWatch.mq.removeEventListener('change', hier.dprWatch.on);
  hier.dprWatch = null;
  window.removeEventListener('keydown', graph3dOnKey, true);
  window.removeEventListener('keyup', graph3dOnKeyUp, true);
  window.removeEventListener('blur', graph3dOnBlur);
  hier.scheme.removeEventListener('change', hier.onTheme);
  hier.themeWatch.disconnect();
  if (hier.ro) hier.ro.disconnect();
  if ((hier.drag && hier.drag.moved) || hier.pinch) isDragging = false;
  if (hier.renderer) {
    graph3dDisposeGround(hier);
    hier.renderer.dispose();
    hier.renderer.domElement.remove();
    hier.renderer = null;
  }
  hier.root.remove();
}

// --- what the Graph calls ----------------------------------------------------------------------

// The Graph's Hierarchy in 3D, in `main` in place of its 2D drawing: `view` = { drawn (graphDrawPlan's
// marks), plan, layout, model }. The 3D Hierarchy outlives the Graph's draws, keeping its camera and shape.
function graph3dShow(main, view) {
  if (!graph3dCur) graph3dCur = graph3dCreate();
  main.appendChild(graph3dCur.root);
  graph3dShowPlan(graph3dCur, view);
}

function graph3dRelease() {
  if (!graph3dCur) return;
  const hier = graph3dCur;
  graph3dCur = null;
  graph3dDestroy(hier);
}

function graph3dZoomButton(action) {
  const hier = graph3dCur;
  if (!hier || !graph3dReady(hier)) return;
  if (action === 'fit') graph3dFrameAll(hier, false);
  else graph3dZoomAt(hier, hier.w / 2, hier.h / 2, action === 'in' ? GRAPH3D_BUTTON_ZOOM : 1 / GRAPH3D_BUTTON_ZOOM);
}

function graph3dCenterOn(id) {
  if (graph3dCur && graph3dReady(graph3dCur)) graph3dCenterCard(graph3dCur, id);
}

// The marks again, next frame: the 2D Graph's name painting (graphPaintNames) and lighting ask this in 3D.
function graph3dRepaint() {
  if (graph3dCur) graph3dRequest(graph3dCur);
}
