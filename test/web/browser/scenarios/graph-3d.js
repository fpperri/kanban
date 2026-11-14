'use strict';
// The Graph's Hierarchy in 3D, on the plan board (it has a hierarchy, so the fan has tier bands).
// The 3D button beside Hierarchy | Flow turns it on: the address says in3d=1, three.js draws the
// ground on a canvas that covers the stage, and the 2D drawing's own marks are moved to where the
// camera sees them. Opened straight above on the disc, every dot stands within 2 px of where the
// 2D Hierarchy drew it. G steps the shape (disc, half sphere, sphere and round). With the mouse a
// left drag pans (the camera's target moves, its tilt and turn stay); a right drag spins the shape round its
// own vertical axis across (the axis keeps its place on screen to the pixel, and a cross marks it while it
// spins) and tilts the camera up and down, and opens no menu; Shift and a right drag looks round from where
// the camera stands (its heading changes, its position does not), and a Shift+right press opens no menu, with
// a drag or without; the wheel flies it toward the pointer; a left click on a dot selects its
// card, a double click opens it, and a right click on it, with no drag, opens the card menu. The
// browser asks for that menu when the right button goes up on Windows and when it goes down on Linux
// and the Mac; the second order is played here by a contextmenu event sent while the button is held,
// and still the menu opens only once the button is up without a drag, and never after a drag. The
// compass in the corner turns with the camera, and a press on it turns the view back north up from
// straight above. The Flow and the Board take the scene down and
// the Hierarchy brings 3D back (the address still says in3d=1). Turning 3D off takes the scene down:
// the 2D drawing is back, the address drops in3d, and no animation frame of the 3D Hierarchy is left waiting.
//
// Every gesture is a real input event (Input.dispatchMouseEvent, Input.dispatchKeyEvent). The
// camera is read off the view's root (data-cam: turn, tilt, distance, then the target's x, y, z)
// and the shape off data-shape. The frames the 3D Hierarchy asks for are counted by wrapping
// requestAnimationFrame before 3D is turned on: a request whose stack names a graph-3d file counts,
// and one that ran or was cancelled no longer waits. WebGL runs on SwiftShader in headless Chrome
// (the runner's flags allow it).
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// selectedIds, isDragging, hideContextMenu, currentDetailId, closeCard, setView, graph3dCur, graph3dRequest,
// graph3dScreenOf, graph3dShapeAxis.

const ROOT = `document.querySelector('#graph-view .graph-3d')`;
// A dot's middle on the screen, for every dot drawn, by card id.
const DOTS = `(()=>{const o={};for(const g of document.querySelectorAll('#graph-view .graph-node')){const d=g.querySelector('.graph-dot');if(!d||getComputedStyle(g).display==='none')continue;const r=d.getBoundingClientRect();o[g.dataset.id]={x:r.left+r.width/2,y:r.top+r.height/2}}return o})()`;
// The dot drawn nearest the middle of the stage, on the near side and large enough to press, leaving out `skip`.
const MIDDLE_DOT = (skip) => `(()=>{const s=${ROOT}.getBoundingClientRect();let best=null;for(const g of ${ROOT}.querySelectorAll('.graph-node')){if(g.dataset.id===${JSON.stringify(skip)}||g.classList.contains('graph-3d-off')||g.classList.contains('graph-3d-far'))continue;const r=g.querySelector('.graph-dot').getBoundingClientRect();const p={id:g.dataset.id,x:r.left+r.width/2,y:r.top+r.height/2};const d=Math.hypot(p.x-(s.left+s.right)/2,p.y-(s.top+s.bottom)/2);if(r.width>4&&(!best||d<best.d))best={...p,d}}return best})()`;
const COMPASS = `${ROOT}.querySelector('.graph-3d-compass-dial').getAttribute('transform')`;
// A contextmenu event at a point, as Linux and the Mac send one when the right button goes down.
const MENU_AT = (x, y) => `document.elementFromPoint(${x},${y}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,buttons:2,clientX:${x},clientY:${y},view:window}))`;
// The cards of the fan's innermost ring (the highest level) and its outermost: how many, how far from the
// camera on average (the depths the frame drew), and whether every innermost dot is drawn in the stage on
// the near side.
const TOP = `(()=>{const h=graph3dCur;const r=(n)=>Math.hypot(n.x,n.y);const z=new Map(h.vis.map((o)=>[o.id,o.z]));const fan=h.view.plan.nodes.filter((n)=>r(n)<h.rim&&z.has(n.id));const r0=Math.min(...fan.map(r)),r1=Math.max(...fan.map(r));const inner=fan.filter((n)=>r(n)<=r0+1),outer=fan.filter((n)=>r(n)>=r1-1);const mean=(ns)=>ns.reduce((a,n)=>a+z.get(n.id),0)/ns.length;const s=${ROOT}.getBoundingClientRect();const shown=inner.every((n)=>{const g=${ROOT}.querySelector('.graph-node[data-id="'+n.id+'"]');if(g.classList.contains('graph-3d-far'))return false;const b=g.querySelector('.graph-dot').getBoundingClientRect();const x=b.left+b.width/2,y=b.top+b.height/2;return x>s.left&&x<s.right&&y>s.top&&y<s.bottom});return {inner:inner.length,outer:outer.length,zInner:Math.round(mean(inner)),zOuter:Math.round(mean(outer)),shown}})()`;
const CAM = `(()=>{const r=${ROOT};if(!r||!r.dataset.cam)return null;const [theta,phi,dist,tx,ty,tz]=r.dataset.cam.split(',').map(Number);return {theta,phi,dist,tx,ty,tz}})()`;
// Where the shape's own vertical axis (the point H frames) stands on the page.
const AXIS = `(()=>{const h=graph3dCur;const s=graph3dScreenOf(h,graph3dShapeAxis(h.shape,h.rim,h.outer));const r=h.root.getBoundingClientRect();return s&&{x:r.left+s.x,y:r.top+s.y}})()`;
const CROSS_ON = `${ROOT}.querySelector('.graph-3d-pivot').dataset.on==='1'`;
const SHIFT = 8;
const FRAMES = `(()=>{const raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);const f=window.__graph3dFrames={pending:new Set(),asked:0};`
  + `window.requestAnimationFrame=(cb)=>{const mine=/graph-3d(-[a-z]+)?\\.js/.test(new Error().stack||'');let id=0;id=raf((t)=>{f.pending.delete(id);cb(t)});if(mine){f.pending.add(id);f.asked++}return id};`
  + `window.cancelAnimationFrame=(id)=>{f.pending.delete(id);caf(id)};return true})()`;

module.exports = {
  name: 'graph-3d',
  board: 'plan',
  timeoutMs: 120000,
  async run(page) {
    const { ev, open, waitFor, centre, mouse, click, key, check, shot } = page;
    const menu = `document.getElementById('context-menu')`;
    const cam = () => ev(CAM);
    // The camera once it has stopped: six equal reads in a row, about half a second: the readout is rounded to
    // two places, so the slow end of a coast can read the same twice and still be moving.
    const settled = async () => {
      let last = null, same = 0;
      for (let i = 0; i < 80; i++) {
        const now = await cam();
        same = now && last && JSON.stringify(now) === JSON.stringify(last) ? same + 1 : 0;
        if (same >= 5) return now;
        last = now;
        await page.sleep(80);
      }
      return last;
    };
    const stageRect = () => ev(`(()=>{const r=document.querySelector('#graph-view .graph-main').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
    // `mods` is the CDP modifiers bitmask (SHIFT); `onPress` runs once the button is down, `onHeld` once it has
    // dragged, before it comes up.
    const drag = async (from, to, button, onPress, { mods = 0, onHeld } = {}) => {
      const buttons = button === 'right' ? 2 : 1;
      await mouse('mouseMoved', from.x, from.y, { button: 'none', modifiers: mods });
      await mouse('mousePressed', from.x, from.y, { button, modifiers: mods });
      if (onPress) await onPress();
      for (let k = 1; k <= 8; k++) {
        await mouse('mouseMoved', from.x + ((to.x - from.x) * k) / 8, from.y + ((to.y - from.y) * k) / 8, { button, buttons, modifiers: mods });
      }
      if (onHeld) await onHeld();
      await mouse('mouseReleased', to.x, to.y, { button, modifiers: mods });
    };

    await open('/?view=graph&graph=hierarchy');
    check('the 2D Hierarchy draws', await waitFor(`document.querySelectorAll('#graph-view .graph-stage .graph-node').length>20&&!${ROOT}`, 10000));
    check('the 3D button stands beside Hierarchy | Flow, not pressed', await ev(`(()=>{const b=document.querySelector('.graph-kinds .graph-3d-btn');return !!b&&b.getAttribute('aria-pressed')==='false'&&b.previousElementSibling.dataset.graphKind==='flow'})()`));
    await page.sleep(300);
    const flat = await ev(DOTS);
    await shot('2d');
    check('three.js is not loaded before 3D is on', await ev(`typeof THREE==='undefined'&&![...document.scripts].some((s)=>/three/.test(s.src))`));

    await ev(FRAMES);
    const btn = await centre('.graph-kinds .graph-3d-btn');
    await click(btn.x, btn.y);
    check('the 3D button turns 3D on and the address says in3d=1', await waitFor(`!!${ROOT}&&new URLSearchParams(location.search).get('in3d')==='1'&&document.querySelector('.graph-kinds .graph-3d-btn').getAttribute('aria-pressed')==='true'`, 8000));
    check('three.js loads and the canvas is drawn', await waitFor(`(()=>{const r=${ROOT};return !!r&&!r.classList.contains('graph-3d-loading')&&!!r.querySelector('canvas.graph-3d-canvas')&&!!r.dataset.cam})()`, 20000));
    const fill = await ev(`(()=>{const c=${ROOT}.querySelector('canvas.graph-3d-canvas').getBoundingClientRect();const s=${ROOT}.getBoundingClientRect();return {c:[c.left,c.top,c.right,c.bottom],s:[s.left,s.top,s.right,s.bottom],gl:!!${ROOT}.querySelector('canvas.graph-3d-canvas').getContext('webgl2')||!!${ROOT}.querySelector('canvas.graph-3d-canvas').getContext('webgl')}})()`);
    check('the canvas covers the whole stage', fill.s[2] - fill.s[0] > 400 && fill.s[3] - fill.s[1] > 300 && fill.c[0] <= fill.s[0] && fill.c[1] <= fill.s[1] && fill.c[2] >= fill.s[2] && fill.c[3] >= fill.s[3], fill);
    const top = await settled();
    check('it opens on the disc, straight above', await ev(`${ROOT}.dataset.shape`) === 'disc' && top && top.phi === 0 && top.theta === 0, top);
    check('the compass shows north up, seen from straight above', await ev(COMPASS) === 'scale(1 1) rotate(0)', await ev(COMPASS));
    const above = await ev(DOTS);
    const ids = Object.keys(flat);
    const off = ids.map((id) => ({ id, d: above[id] ? Math.hypot(above[id].x - flat[id].x, above[id].y - flat[id].y) : Infinity })).filter((o) => o.d > 2);
    check('from straight above every dot stands within 2 px of the 2D Hierarchy', ids.length > 20 && off.length === 0, off.slice(0, 5));
    await shot('3d-top');

    // A left drag on the ground pans: the target moves, the tilt and the turn stay.
    const area = await stageRect();
    const spot = { x: area.l + 120, y: area.b - 140 }; // empty ground, clear of the hint and the compass
    await drag(spot, { x: spot.x + 160, y: spot.y - 90 }, 'left');
    const panned = await settled();
    check('a left drag pans: the target moves, the tilt and the turn stay', panned.phi === top.phi && panned.theta === top.theta && Math.hypot(panned.tx - top.tx, panned.tz - top.tz) > 20, { top, panned });
    check('a drag leaves isDragging off once it ends', await waitFor('isDragging===false'));

    // A right drag across spins the shape round its own vertical axis: the turn changes, the tilt and the
    // distance stay, the axis keeps its place on screen to the pixel, a cross marks it while it spins, and no
    // card menu opens.
    const axis0 = await ev(AXIS);
    let crossDuring = false;
    await drag(spot, { x: spot.x + 160, y: spot.y }, 'right', null, { onHeld: async () => { crossDuring = await waitFor(CROSS_ON, 2000); } });
    const spun = await settled();
    const axis1 = await ev(AXIS);
    check('a right drag across spins the shape: the turn changes, the tilt and the distance stay',
      Math.abs(spun.theta - panned.theta) > 0.2 && spun.phi === panned.phi && spun.dist === panned.dist, { panned, spun });
    check('a right drag across spins round the shape\'s axis: the axis does not drift on screen', Math.hypot(axis1.x - axis0.x, axis1.y - axis0.y) < 0.5, { axis0, axis1 });
    check('a cross marks the axis while a right drag spins the shape', crossDuring);
    await page.sleep(400);
    check('a right drag opens no menu', await ev(`${menu}.classList.contains('hidden')`));

    // A right drag up tilts the camera round the shape's axis, at the same distance.
    await drag(spot, { x: spot.x, y: spot.y - 140 }, 'right');
    const tilted = await settled();
    check('a right drag up tilts the camera, the turn and the distance kept', tilted.phi > 0.2 && tilted.theta === spun.theta && tilted.dist === spun.dist, { spun, tilted });
    check('the compass turns and tilts with the camera', await ev(COMPASS) !== 'scale(1 1) rotate(0)', await ev(COMPASS));
    await shot('3d-tilted');

    // Shift and a right drag looks round from where the camera stands, and opens no card menu: the camera's
    // position does not move, its heading (the turn and the tilt) changes.
    await drag(spot, { x: spot.x + 120, y: spot.y - 60 }, 'right', null, { mods: SHIFT });
    const turned = await settled();
    const eyeOf = (c) => [c.tx + Math.sin(c.phi) * Math.sin(c.theta) * c.dist, c.ty + Math.cos(c.phi) * c.dist, c.tz + Math.sin(c.phi) * Math.cos(c.theta) * c.dist];
    const e0 = eyeOf(tilted), e1 = eyeOf(turned);
    check('Shift and a right drag looks round: the tilt and the turn change', Math.abs(turned.phi - tilted.phi) > 0.1 && Math.abs(turned.theta - tilted.theta) > 0.2, { tilted, turned });
    check('Shift and a right drag keeps the camera where it stands', Math.hypot(e1[0] - e0[0], e1[1] - e0[1], e1[2] - e0[2]) < tilted.dist * 0.015 && turned.dist === tilted.dist, { e0, e1 });
    await page.sleep(400);
    check('Shift and a right drag opens no menu', await ev(`${menu}.classList.contains('hidden')`));

    // The same right drag with the menu asked for as the button goes down: still no menu.
    await drag(spot, { x: spot.x + 60, y: spot.y + 40 }, 'right', () => ev(MENU_AT(spot.x, spot.y)));
    await settled();
    await page.sleep(400);
    check('a right drag opens no menu when the browser asks for it as the button goes down', await ev(`${menu}.classList.contains('hidden')`));

    // The right button pressed in the middle of a left pan: the browser fires no pointerdown for it, only the
    // contextmenu, which is swallowed (dispatchEvent answers false), so neither the card menu nor the
    // browser's own opens.
    await mouse('mouseMoved', spot.x, spot.y, { button: 'none' });
    await mouse('mousePressed', spot.x, spot.y, { button: 'left' });
    for (let k = 1; k <= 4; k++) await mouse('mouseMoved', spot.x + 10 * k, spot.y, { button: 'left', buttons: 1 });
    const chordPassed = await ev(MENU_AT(spot.x + 40, spot.y));
    await mouse('mouseReleased', spot.x + 40, spot.y, { button: 'left' });
    await settled();
    await page.sleep(400);
    check('a right press in the middle of a left pan opens no menu, the browser\'s own included', chordPassed === false && await ev(`${menu}.classList.contains('hidden')`), { chordPassed });

    // The compass: north up, looking straight down from where the camera stands.
    const before = await settled();
    const needle = await centre('#graph-view .graph-3d-compass');
    await click(needle.x, needle.y);
    const north = await settled();
    const whole = Math.abs(north.theta / (2 * Math.PI) - Math.round(north.theta / (2 * Math.PI))) < 0.002;
    const eb = eyeOf(before), en = eyeOf(north);
    check('a press on the compass turns the view north up, looking straight down from where the camera stands',
      north.phi === 0 && whole && Math.abs(north.dist - before.dist) < 0.5 && Math.hypot(en[0] - eb[0], en[1] - eb[1], en[2] - eb[2]) < before.dist * 0.015 && await ev(COMPASS) === 'scale(1 1) rotate(0)', { before, north });

    // The wheel flies the camera toward the pointer: along the ray under it, its tilt and its distance to its
    // target kept.
    const aim = { x: area.l + (area.r - area.l) * 0.7, y: area.t + (area.b - area.t) * 0.35 };
    const RAY = `(()=>{const h=graph3dCur,r=h.root.getBoundingClientRect();const v=new h.T.Vector3(((${aim.x}-r.left+h.ox)/h.cw)*2-1,-((${aim.y}-r.top+h.oy)/h.ch)*2+1,0.5).unproject(h.camera).sub(h.camera.position).normalize();return [v.x,v.y,v.z]})()`;
    const ray = await ev(RAY);
    const e2 = eyeOf(north);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: aim.x, y: aim.y, deltaX: 0, deltaY: -300 });
    const flown = await settled();
    const e3 = eyeOf(flown);
    const step = [e3[0] - e2[0], e3[1] - e2[1], e3[2] - e2[2]], len = Math.hypot(...step);
    check('the wheel flies the camera toward the pointer, along the ray under it', len > north.dist * 0.05 && (step[0] * ray[0] + step[1] * ray[1] + step[2] * ray[2]) / len > 0.99 && flown.phi === north.phi && flown.dist === north.dist, { north, flown, ray, step });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: aim.x, y: aim.y, deltaX: 0, deltaY: 300 });
    const flownBack = await settled();
    const e4 = eyeOf(flownBack);
    const out = [e4[0] - e3[0], e4[1] - e3[1], e4[2] - e3[2]], outLen = Math.hypot(...out);
    check('a tick the other way flies it back along the same ray', outLen > 1 && (out[0] * ray[0] + out[1] * ray[1] + out[2] * ray[2]) / outLen < -0.99, { e2, e3, e4 });

    // G steps the shape: the half sphere, the sphere, and back to the disc. The half sphere and the sphere
    // fold with the disc's centre on top: seen as G frames them, the innermost ring is drawn on the near
    // side, nearer the camera than the outermost; a left click on a dot selects its card and F brings it
    // to the middle.
    for (const shape of ['half', 'sphere', 'disc']) {
      await key('g');
      check(`G steps the shape to ${shape}`, await waitFor(`${ROOT}.dataset.shape===${JSON.stringify(shape)}`, 3000));
      await settled();
      if (shape === 'disc') continue;
      await shot(`3d-${shape}`);
      const tops = await ev(TOP);
      check(`the ${shape} has the disc's centre on top: its innermost ring in view, nearer than the outermost`,
        tops.inner > 0 && tops.outer > 0 && tops.shown && tops.zInner < tops.zOuter, tops);
      const pick = await ev(MIDDLE_DOT(null));
      await ev(`selectedIds.clear()`);
      await mouse('mouseMoved', pick.x, pick.y, { button: 'none' });
      await click(pick.x, pick.y);
      check(`a left click on a dot of the ${shape} selects its card`, await waitFor(`selectedIds.size===1&&selectedIds.has(${JSON.stringify(pick.id)})`, 3000), { pick, sel: await ev(`[...selectedIds]`) });
      await key('f');
      await settled();
      const gap = await ev(`(()=>{const d=${ROOT}.querySelector('.graph-node[data-id="${pick.id}"] .graph-dot').getBoundingClientRect();const s=${ROOT}.getBoundingClientRect();return Math.round(Math.hypot(d.left+d.width/2-(s.left+s.right)/2,d.top+d.height/2-(s.top+s.bottom)/2))})()`);
      check(`F brings the selected card of the ${shape} to the middle`, gap < 30, { gap });
      await key('h');
      await settled();
      await ev(`selectedIds.clear()`);
    }

    // H frames everything again; a left click on a dot selects its card, a right click on it opens the menu.
    await key('h');
    await settled();
    const target = await ev(MIDDLE_DOT(null));
    check('a dot is drawn near the middle of the stage', !!target, target);
    await ev(`selectedIds.clear()`);
    await mouse('mouseMoved', target.x, target.y, { button: 'none' });
    await click(target.x, target.y);
    check('a left click on a dot selects its card', await waitFor(`selectedIds.size===1&&selectedIds.has(${JSON.stringify(target.id)})`, 3000), await ev(`[...selectedIds]`));
    await settled();
    await shot('3d-selected');
    // A click while frames are drawn (the camera flying after H, or coasting after an orbit): the press
    // gives the dot the focus, which lights it, and the frame drawn before the button comes up puts it
    // last in the paint order. The browser sends no click to a mark taken off the page between the press
    // and the release, so the pressed dot is never the one moved, and the click selects its card.
    await key('h');
    const other = await ev(MIDDLE_DOT(target.id));
    await mouse('mousePressed', other.x, other.y, { button: 'left' });
    await ev(`(graph3dRequest(graph3dCur),new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
    await mouse('mouseReleased', other.x, other.y, { button: 'left' });
    check('a left click on a dot while the camera flies selects its card', await waitFor(`selectedIds.size===1&&selectedIds.has(${JSON.stringify(other.id)})`, 3000), await ev(`[...selectedIds]`));
    await settled();
    await ev(`hideContextMenu()`);
    const dotOf = (id) => ev(`(()=>{const g=${ROOT}.querySelector('.graph-node[data-id="${id}"] .graph-dot');const r=g.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    let dot = await dotOf(target.id);
    await mouse('mousePressed', dot.x, dot.y, { button: 'right', modifiers: SHIFT });
    await ev(MENU_AT(dot.x, dot.y));
    await mouse('mouseReleased', dot.x, dot.y, { button: 'right', modifiers: SHIFT });
    await page.sleep(400);
    check('a Shift+right click on a dot, with no drag, opens no menu', await ev(`${menu}.classList.contains('hidden')`));
    await mouse('mousePressed', dot.x, dot.y, { button: 'right' });
    await mouse('mouseReleased', dot.x, dot.y, { button: 'right' });
    check('a right click on a dot, with no drag, opens the card menu', await waitFor(`!${menu}.classList.contains('hidden')`, 3000));
    await key('Escape');
    await waitFor(`${menu}.classList.contains('hidden')`, 2500);
    dot = await dotOf(target.id);
    await mouse('mousePressed', dot.x, dot.y, { button: 'right' });
    await ev(MENU_AT(dot.x, dot.y));
    await page.sleep(200);
    const heldBack = await ev(`${menu}.classList.contains('hidden')`);
    await mouse('mouseReleased', dot.x, dot.y, { button: 'right' });
    check('asked for as the button goes down, the menu waits for the button to come up, then opens', heldBack && await waitFor(`!${menu}.classList.contains('hidden')`, 3000), { heldBack });
    await key('Escape');
    await waitFor(`${menu}.classList.contains('hidden')`, 2500);

    // A double click on a dot opens its card.
    dot = await dotOf(target.id);
    await click(dot.x, dot.y, { clickCount: 1 });
    await click(dot.x, dot.y, { clickCount: 2 });
    check('a double click on a dot opens its card', await waitFor(`String(currentDetailId)===${JSON.stringify(target.id)}`, 4000), await ev('currentDetailId'));
    await ev('closeCard()');
    await waitFor('currentDetailId==null', 3000);

    // The Flow and another view take the scene down; the Hierarchy and the Graph bring 3D back.
    const gone = `!${ROOT}&&document.querySelectorAll('canvas.graph-3d-canvas').length===0&&window.__graph3dFrames.pending.size===0`;
    const drawn3d = `(()=>{const r=${ROOT};return !!r&&!!r.querySelector('canvas.graph-3d-canvas')&&!r.classList.contains('graph-3d-loading')})()`;
    await ev(`document.querySelector('.graph-kind-btn[data-graph-kind=flow]').click()`);
    check('the Flow takes the 3D scene down and leaves no frame waiting', await waitFor(`${gone}&&!document.querySelector('.graph-kinds .graph-3d-btn')`, 5000));
    await ev(`document.querySelector('.graph-kind-btn[data-graph-kind=hierarchy]').click()`);
    check('back on the Hierarchy, 3D is drawn again', await waitFor(drawn3d, 10000));
    await ev(`setView('board')`);
    check('another view takes the 3D scene down and leaves no frame waiting', await waitFor(gone, 5000));
    await ev(`setView('graph')`);
    check('back in the Graph, 3D is drawn again', await waitFor(drawn3d, 10000));

    // 3D off: the 2D drawing is back and the 3D Hierarchy leaves no frame waiting.
    const back = await centre('.graph-kinds .graph-3d-btn');
    await click(back.x, back.y);
    check('the 3D button turns 3D off: the 2D drawing is back and the address drops in3d', await waitFor(`!${ROOT}&&!!document.querySelector('#graph-view .graph-stage > svg.graph-canvas')&&new URLSearchParams(location.search).get('in3d')===null`, 5000));
    await page.sleep(300);
    const frames = await ev(`(()=>{const f=window.__graph3dFrames;const asked=f.asked;return {waiting:f.pending.size,asked,canvas:document.querySelectorAll('canvas.graph-3d-canvas').length}})()`);
    await page.sleep(300);
    const later = await ev(`window.__graph3dFrames.asked`);
    check('no 3D animation frame is left waiting, and none is asked for after', frames.asked > 0 && frames.waiting === 0 && later === frames.asked && frames.canvas === 0, { frames, later });
  },
};
