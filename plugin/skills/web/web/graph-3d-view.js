'use strict';
// The running 3D Hierarchy: its state (`hier`, one at a time, graph3dCur), its life from three.js's load to
// its teardown, the frame loop, and what the Graph calls (graph3dShow, graph3dRelease and the rest). The
// camera, the ground, the marks, the input and the compass are graph-3d-camera.js, -ground.js, -marks.js,
// -input.js and -compass.js; the pure helpers and the tuning are graph-3d.js.

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
  const root = document.createElement('div');
  root.className = 'graph-3d';
  const label = document.createElement('p');
  label.className = 'graph-3d-label';
  label.title = GRAPH3D_HELP;
  label.setAttribute('aria-live', 'polite');
  root.appendChild(label);
  const hier = {
    root, label, compass: null, dial: null, north: null,
    gone: false, T: null, renderer: null, scene: null, camera: null,
    ground: [], groundKey: '', groundAt: '', view: null, overlay: null, links: [], farLinks: [], captions: [], rim: 100, outer: 0,
    names: null, namesMode: '',
    shape: 'disc', morph: null,
    cam: { theta: 0, phi: 0, dist: 1000, tx: 0, ty: 0, tz: 0 }, framed: false, fly: null,
    raf: 0, w: 1, h: 1, cw: 1, ch: 1, ox: 0, oy: 0, order: '',
    drag: null, pointers: new Map(), pressed: null, pinch: null, right: null, rightTimer: 0, replaying: false, ro: null,
    zoom: null, spin: null, walk: new Set(), turn: new Set(), tick: 0, vis: [], kHome: 1, hint: true, hintTimer: 0, empty: false, dprWatch: null,
    fitted: false, fitDist: 0, idSide: new Map(), armed: true, quietAt: null,
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

function graph3dReady(hier) {
  return !!(hier.renderer && hier.view);
}

function graph3dVisible(hier) {
  return hier.root.isConnected && hier.root.getClientRects().length > 0;
}

// The first seconds, or until the first gesture, the label names the gestures; then the shape and its keys.
function graph3dPaintLabel(hier) {
  hier.label.textContent = hier.hint ? GRAPH3D_HINT
    : `${graph3dShapeName(hier.shape)} · G shape · F frame · H home · WASD move · QE turn${hier.empty ? ' · nothing in view: H brings it back' : ''}`;
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
    const step = graph3dWalk(hier.walk, hier.cam.theta, hier.cam.dist, dt);
    if (step) {
      for (const c of hier.zoom ? [hier.cam, hier.zoom] : [hier.cam]) { c.tx += step[0]; c.tz += step[1]; }
      more = true;
    }
  }
  if (hier.turn.size) {
    const turn = graph3dTurn(hier.turn, dt);
    if (turn) {
      hier.cam.theta += turn;
      more = true;
    }
  }
  if (hier.spin) {
    graph3dOrbit(hier, hier.spin.vx * dt, hier.spin.vy * dt);
    hier.spin = graph3dCoast(hier.spin, dt);
    if (hier.spin) more = true;
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
