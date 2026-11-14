'use strict';
// The 3D Hierarchy's input (graph-3d-view.js holds its state, `hier`): a press drags to pan or look round
// (graph3dDragMode), a click selects and a double click opens, a right click opens the card menu, the
// wheel and a pinch zoom, the keys g, f and h, the walk keys w, a, s and d held and the turn keys q and e held.

function graph3dEndDrag(hier, moved) {
  hier.root.classList.remove('graph-3d-dragging');
  if (!moved) return;
  isDragging = false;
  graphSwallowNextClick();
}

function graph3dStartPinch(hier) {
  const [a, b] = [...hier.pointers.values()];
  if (hier.drag) { const d = hier.drag; hier.drag = null; graph3dEndDrag(hier, d.moved); }
  hier.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  isDragging = true;
  graph3dQuietHover(hier);
}

// The right button looks round when it drags and opens the card menu when it does not. The browser asks
// for the menu when the button goes down on some systems and when it comes up on others, so while the
// button is down its contextmenu is held back (hier.right.held) and sent again once the button comes up
// without a drag; after a drag the one that may still come is swallowed (graph3dMenuVerdict).
function graph3dForgetRight(hier) {
  clearTimeout(hier.rightTimer);
  hier.rightTimer = 0;
  hier.right = null;
}

function graph3dRightUp(hier) {
  const r = hier.right;
  if (!r || !r.down) return;
  r.down = false;
  if (r.moved || !r.held) {
    clearTimeout(hier.rightTimer);
    hier.rightTimer = setTimeout(() => graph3dForgetRight(hier), GRAPH3D_MENU_HOLD_MS);
    return;
  }
  graph3dForgetRight(hier);
  const target = r.held.target.isConnected ? r.held.target : document.elementFromPoint(r.held.x, r.held.y);
  if (!target) return;
  hier.replaying = true;
  try {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.held.x, clientY: r.held.y, view: window }));
  } finally { hier.replaying = false; }
}

function graph3dOnContextMenu(hier, e) {
  if (hier.replaying) return;
  const r = hier.right;
  const verdict = graph3dMenuVerdict(r, !!((hier.drag && hier.drag.moved) || hier.pinch));
  if (r && !r.down) graph3dForgetRight(hier);
  if (verdict === 'pass') return;
  if (verdict === 'hold') r.held = { target: e.target, x: e.clientX, y: e.clientY };
  e.preventDefault();
  e.stopPropagation();
}

function graph3dOnPointerDown(hier, e) {
  // The 2D Graph's own pan and pinch (wireGraphView) stay out of the 3D Hierarchy, and a press on the
  // compass is the compass's.
  e.stopPropagation();
  if (!hier.renderer || hier.compass.contains(e.target) || (hier.protoBar && hier.protoBar.contains(e.target))) return;
  hier.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  // The card the button is down on keeps its place in the page until the button is up (graph3dOrderDots).
  hier.pressed = e.target.closest ? e.target.closest('.graph-node') : null;
  hier.spin = null;
  // A press with the camera still (a tap, a click) lets the pointer light again.
  if (!hier.armed && !graph3dMoving(hier)) hier.armed = true;
  graph3dEndHint(hier);
  if (e.pointerType === 'touch' && hier.pointers.size === 2) { graph3dStartPinch(hier); return; }
  if (hier.drag || hier.pinch) return;
  if (e.pointerType !== 'touch' && e.button === 2) {
    graph3dForgetRight(hier);
    // A Shift+right press looks round and opens no menu, with a drag or without: as if it had dragged.
    hier.right = { down: true, moved: !!e.shiftKey, held: null };
  }
  const mode = graph3dDragMode(e);
  if (!mode) return;
  hier.drag = { id: e.pointerId, mode, button: e.button, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, trail: [] };
}

function graph3dOnPointerMove(hier, e) {
  const last = hier.quietAt;
  hier.quietAt = { x: e.clientX, y: e.clientY };
  const stirred = last && Math.hypot(e.clientX - last.x, e.clientY - last.y) > 0.5;
  if (!hier.armed && !graph3dMoving(hier) && e.pointerType !== 'touch' && stirred) graph3dRearm(hier, e);
  if (hier.pointers.has(e.pointerId)) hier.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (hier.pinch) {
    if (hier.pointers.size < 2) return;
    const [a, b] = [...hier.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const rect = hier.root.getBoundingClientRect();
    graph3dZoomAt(hier, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top, hier.pinch.d / d);
    hier.pinch.d = d;
    return;
  }
  const d = hier.drag;
  if (!d || d.id !== e.pointerId) return;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) <= GRAPH3D_DRAG) return;
    d.moved = true;
    if (d.button === 2 && hier.right) hier.right.moved = true;
    isDragging = true;
    hier.root.classList.add('graph-3d-dragging');
    try { hier.root.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer can't be captured */ }
    graph3dQuietHover(hier);
  }
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  d.x = e.clientX;
  d.y = e.clientY;
  if (d.mode === 'look' || d.mode === 'orbit') {
    if (d.mode === 'orbit') graph3dOrbitBy(hier, dx, dy);
    else graph3dLookBy(hier, dx, dy);
    const t = performance.now();
    d.trail.push({ t, dx, dy });
    while (d.trail.length && t - d.trail[0].t > 80) d.trail.shift();
  } else graph3dPan(hier, dx, dy);
  hier.fly = null;
  hier.zoom = null;
  graph3dRequest(hier);
}

function graph3dOnPointerEnd(hier, e) {
  hier.pointers.delete(e.pointerId);
  if (!hier.pointers.size) hier.pressed = null;
  if (hier.pinch) {
    if (hier.pointers.size < 2) {
      hier.pinch = null;
      isDragging = false;
      graphSwallowNextClick();
    }
    return;
  }
  const d = hier.drag;
  if (!d || d.id !== e.pointerId) return;
  hier.drag = null;
  graph3dEndDrag(hier, d.moved);
  if (d.button === 2) {
    if (e.type === 'pointerup') graph3dRightUp(hier);
    else graph3dForgetRight(hier);
  }
  // A released look coasts on at the speed of its last 80 ms, then slows to a stop.
  const t = performance.now();
  const trail = d.moved && (d.mode === 'look' || d.mode === 'orbit') && e.type === 'pointerup' ? d.trail.filter((m) => t - m.t <= 80) : [];
  if (trail.length > 1) {
    const span = Math.max(16, t - trail[0].t);
    const sx = trail.reduce((a, m) => a + m.dx, 0), sy = trail.reduce((a, m) => a + m.dy, 0);
    const coast = graph3dCoast({ vx: sx / span, vy: sy / span }, 0);
    hier.spin = coast && Object.assign(coast, { orbit: d.mode === 'orbit' });
    hier.tick = 0;
  }
  graph3dRequest(hier);
}

// The dot a click a little off a dot means, or null on a mark of its own or the corner's controls.
function graph3dNearDot(hier, e) {
  if (e.target.closest && e.target.closest('.graph-node, .graph-caption, .graph-block-title, .graph-block-caption, .graph-3d-label, .graph-3d-compass, .graph-3d-proto')) return null;
  const rect = hier.root.getBoundingClientRect();
  return graph3dNearest(hier.vis, e.clientX - rect.left, e.clientY - rect.top, GRAPH3D_PICK_TOL);
}

// A click or a double click a little off a dot means that dot; a double click on empty ground frames
// everything. Told by the second click's count rather than by dblclick: the first click may redraw the
// marks (a selection's light going out), and the browser fires no dblclick across two elements.
function graph3dOnClick(hier, e) {
  if (!graph3dReady(hier) || e.button !== 0) return;
  const id = graph3dNearDot(hier, e);
  if (id == null) {
    if (e.detail === 2 && e.target.closest && e.target.closest('.graph-canvas') && !e.target.closest('.graph-node')) graph3dFrameAll(hier, false, true);
    return;
  }
  if (e.detail === 2) return;
  hideContextMenu();
  graphClickNode(String(id), e);
}

// A double click opens the card it is on, or the dot it is a little off: told by the second press's count
// and opened once its click is through, as the 2D Graph's dblclick does. The first click may redraw the
// marks (a selection), and the browser then fires no dblclick, so the 2D Graph's own is not waited for.
function graph3dOnMouseUp(hier, e) {
  if (!graph3dReady(hier) || e.button !== 0 || e.detail !== 2) return;
  const node = e.target.closest && e.target.closest('.graph-node');
  const id = node ? node.dataset.id : graph3dNearDot(hier, e);
  if (id == null) return;
  if (!graphDblClickOpens({ shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, phone: onPhoneLayout() })) return;
  setTimeout(() => { if (!hier.gone) openCard(String(id)); }, 0);
}

function graph3dOnWheel(hier, e) {
  e.preventDefault();
  e.stopPropagation();
  if (!hier.renderer) return;
  const rect = hier.root.getBoundingClientRect();
  const steps = Math.max(-4, Math.min(4, e.deltaY / 100)) || Math.sign(e.deltaY);
  graph3dZoomAt(hier, e.clientX - rect.left, e.clientY - rect.top, GRAPH3D_WHEEL ** -steps);
}

function graph3dWireInput(hier) {
  const root = hier.root;
  root.addEventListener('pointerdown', (e) => graph3dOnPointerDown(hier, e));
  // While the camera is quiet (graph3dQuietHover), the pointer's mouseover and mouseout reach neither the
  // Graph's lighting nor its tip.
  const hush = (e) => { if (!hier.armed) e.stopPropagation(); };
  root.addEventListener('mouseover', hush, true);
  root.addEventListener('mouseout', hush, true);
  root.addEventListener('pointermove', (e) => graph3dOnPointerMove(hier, e));
  root.addEventListener('pointerup', (e) => graph3dOnPointerEnd(hier, e));
  root.addEventListener('pointercancel', (e) => graph3dOnPointerEnd(hier, e));
  // A touch is captured by the mark it lands on until the drag takes it over; only the root's own loss ends a drag.
  root.addEventListener('lostpointercapture', (e) => {
    if (e.target === root && hier.drag && hier.drag.id === e.pointerId && hier.drag.moved) graph3dOnPointerEnd(hier, e);
  });
  root.addEventListener('click', (e) => graph3dOnClick(hier, e));
  root.addEventListener('mouseup', (e) => graph3dOnMouseUp(hier, e));
  root.addEventListener('dblclick', (e) => { if (hier.renderer) e.stopPropagation(); });
  root.addEventListener('contextmenu', (e) => graph3dOnContextMenu(hier, e));
  root.addEventListener('wheel', (e) => graph3dOnWheel(hier, e), { passive: false });
}

// G steps the shape, F frames the selection, H frames everything, W, A, S and D held walk the camera and Q
// and E held turn it (graph3dHoldKey): through the key guard, so never while a field has focus or a menu or
// dialog is up, and only while the 3D Hierarchy is on the page. The card details are such a dialog, so with
// them open E is theirs and edits the card (onDetailEditKey, app.js). The held keys stay off on the notes
// palette, whose note and todo rows read a, d and e.
function graph3dOnKey(e) {
  if (keyGuardOff(document)) return;
  const hier = graph3dCur;
  if (!hier || !e.key || e.ctrlKey || e.metaKey || e.altKey || !graph3dVisible(hier) || !graph3dReady(hier)) return;
  const held = graph3dHeldKey(hier, e);
  if (held) {
    if (e.target && e.target.closest && e.target.closest('#notes-palette')) return;
    graph3dHoldKey(hier, held.set, held.key);
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  if (e.key.toLowerCase() === 'g') graph3dSetShape(hier, graph3dNextShape(hier.shape));
  else if (e.key.toLowerCase() === 'f') graph3dFrameSelection(hier);
  else if (e.key.toLowerCase() === 'h') graph3dFrameAll(hier, false, true);
  else return;
  graph3dEndHint(hier);
  e.preventDefault();
}

// The walk key (into hier.walk) or turn key (into hier.turn) a keydown or keyup is, as { set, key }, or null.
function graph3dHeldKey(hier, e) {
  const walk = graph3dWalkKey(e);
  if (walk) return { set: hier.walk, key: walk };
  const turn = graph3dTurnKey(e);
  return turn ? { set: hier.turn, key: turn } : null;
}

// A walk or turn key coming up lets go of it wherever the focus is, and the window losing focus lets go of them all.
function graph3dOnKeyUp(e) {
  const hier = graph3dCur;
  const held = hier && graph3dHeldKey(hier, { key: e.key });
  if (held) graph3dLetGoKey(hier, held.set, held.key);
}

function graph3dOnBlur() {
  if (!graph3dCur) return;
  graph3dLetGoKey(graph3dCur, graph3dCur.walk, null);
  graph3dLetGoKey(graph3dCur, graph3dCur.turn, null);
}
