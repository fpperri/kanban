'use strict';
// The Graph's Hierarchy in 3D, on the plan board (it has a hierarchy, so the fan has tier bands).
// The 3D button beside Hierarchy | Flow turns it on: the address says in3d=1, three.js draws the
// ground on a canvas that covers the stage, and the 2D drawing's own marks are moved to where the
// camera sees them. Opened straight above on the disc, every dot stands within 2 px of where the
// 2D Hierarchy drew it. G steps the shape (disc, half sphere, sphere and round). With the mouse a
// left drag pans (the camera's target moves, its tilt and turn stay) and a right drag orbits (the
// tilt or the turn changes) and opens no menu; a left click on a dot selects its card and a right
// click on it, with no drag, opens the card menu. Turning 3D off takes the scene down: the 2D
// drawing is back, the address drops in3d, and no animation frame of the 3D view is left waiting.
//
// Every gesture is a real input event (Input.dispatchMouseEvent, Input.dispatchKeyEvent). The
// camera is read off the view's root (data-cam: turn, tilt, distance, then the target's x, y, z)
// and the shape off data-shape. The frames the 3D view asks for are counted by wrapping
// requestAnimationFrame before 3D is turned on: a request whose stack names graph-3d.js counts,
// and one that ran or was cancelled no longer waits. WebGL runs on SwiftShader in headless Chrome
// (the runner's flags allow it).
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// selectedIds, isDragging, hideContextMenu.

const ROOT = `document.querySelector('#graph-view .graph-3d')`;
// A dot's middle on the screen, for every dot drawn, by card id.
const DOTS = `(()=>{const o={};for(const g of document.querySelectorAll('#graph-view .graph-node')){const d=g.querySelector('.graph-dot');if(!d||getComputedStyle(g).display==='none')continue;const r=d.getBoundingClientRect();o[g.dataset.id]={x:r.left+r.width/2,y:r.top+r.height/2}}return o})()`;
const CAM = `(()=>{const r=${ROOT};if(!r||!r.dataset.cam)return null;const [theta,phi,dist,tx,ty,tz]=r.dataset.cam.split(',').map(Number);return {theta,phi,dist,tx,ty,tz}})()`;
const FRAMES = `(()=>{const raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);const f=window.__graph3dFrames={pending:new Set(),asked:0};`
  + `window.requestAnimationFrame=(cb)=>{const mine=/graph-3d\\.js/.test(new Error().stack||'');let id=0;id=raf((t)=>{f.pending.delete(id);cb(t)});if(mine){f.pending.add(id);f.asked++}return id};`
  + `window.cancelAnimationFrame=(id)=>{f.pending.delete(id);caf(id)};return true})()`;

module.exports = {
  name: 'graph-3d',
  board: 'plan',
  timeoutMs: 120000,
  async run(page) {
    const { ev, open, waitFor, centre, mouse, click, key, check, shot } = page;
    const menu = `document.getElementById('context-menu')`;
    const cam = () => ev(CAM);
    // The camera once it has stopped: the same reading twice, a few frames apart.
    const settled = async () => {
      let last = null;
      for (let i = 0; i < 60; i++) {
        const now = await cam();
        if (now && last && JSON.stringify(now) === JSON.stringify(last)) return now;
        last = now;
        await page.sleep(80);
      }
      return last;
    };
    const stageRect = () => ev(`(()=>{const r=document.querySelector('#graph-view .graph-main').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
    const drag = async (from, to, button) => {
      const buttons = button === 'right' ? 2 : 1;
      await mouse('mouseMoved', from.x, from.y, { button: 'none' });
      await mouse('mousePressed', from.x, from.y, { button });
      for (let k = 1; k <= 8; k++) {
        await mouse('mouseMoved', from.x + ((to.x - from.x) * k) / 8, from.y + ((to.y - from.y) * k) / 8, { button, buttons });
      }
      await mouse('mouseReleased', to.x, to.y, { button });
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
    const above = await ev(DOTS);
    const ids = Object.keys(flat);
    const off = ids.map((id) => ({ id, d: above[id] ? Math.hypot(above[id].x - flat[id].x, above[id].y - flat[id].y) : Infinity })).filter((o) => o.d > 2);
    check('from straight above every dot stands within 2 px of the 2D Hierarchy', ids.length > 20 && off.length === 0, off.slice(0, 5));
    await shot('3d-top');

    // A left drag on the ground pans: the target moves, the tilt and the turn stay.
    const area = await stageRect();
    const spot = { x: area.r - 60, y: area.b - 60 };
    await drag(spot, { x: spot.x - 160, y: spot.y - 90 }, 'left');
    const panned = await settled();
    check('a left drag pans: the target moves, the tilt and the turn stay', panned.phi === top.phi && panned.theta === top.theta && Math.hypot(panned.tx - top.tx, panned.tz - top.tz) > 20, { top, panned });
    check('a drag leaves isDragging off once it ends', await waitFor('isDragging===false'));

    // A right drag orbits, and opens no card menu.
    await drag(spot, { x: spot.x - 120, y: spot.y - 140 }, 'right');
    const turned = await settled();
    check('a right drag orbits: the tilt and the turn change', turned.phi > 0.2 && Math.abs(turned.theta - panned.theta) > 0.2, { panned, turned });
    await page.sleep(400);
    check('a right drag opens no menu', await ev(`${menu}.classList.contains('hidden')`));
    await shot('3d-tilted');

    // G steps the shape: the half sphere, the sphere, and back to the disc.
    for (const shape of ['half', 'sphere', 'disc']) {
      await key('g');
      check(`G steps the shape to ${shape}`, await waitFor(`${ROOT}.dataset.shape===${JSON.stringify(shape)}`, 3000));
      await settled();
      if (shape !== 'disc') await shot(`3d-${shape}`);
    }

    // H frames everything again; a left click on a dot selects its card, a right click on it opens the menu.
    await key('h');
    await settled();
    const target = await ev(`(()=>{const s=${ROOT}.getBoundingClientRect();let best=null;for(const g of ${ROOT}.querySelectorAll('.graph-node')){if(g.classList.contains('graph-3d-off')||g.classList.contains('graph-3d-far'))continue;const r=g.querySelector('.graph-dot').getBoundingClientRect();const p={id:g.dataset.id,x:r.left+r.width/2,y:r.top+r.height/2};const d=Math.hypot(p.x-(s.left+s.right)/2,p.y-(s.top+s.bottom)/2);if(r.width>4&&(!best||d<best.d))best={...p,d}}return best})()`);
    check('a dot is drawn near the middle of the stage', !!target, target);
    await ev(`selectedIds.clear()`);
    await mouse('mouseMoved', target.x, target.y, { button: 'none' });
    await click(target.x, target.y);
    check('a left click on a dot selects its card', await waitFor(`selectedIds.size===1&&selectedIds.has(${JSON.stringify(target.id)})`, 3000), await ev(`[...selectedIds]`));
    await settled();
    await shot('3d-selected');
    await ev(`hideContextMenu()`);
    const dot = await ev(`(()=>{const g=${ROOT}.querySelector('.graph-node[data-id="${target.id}"] .graph-dot');const r=g.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await mouse('mousePressed', dot.x, dot.y, { button: 'right' });
    await mouse('mouseReleased', dot.x, dot.y, { button: 'right' });
    check('a right click on a dot, with no drag, opens the card menu', await waitFor(`!${menu}.classList.contains('hidden')`, 3000));
    await key('Escape');
    await waitFor(`${menu}.classList.contains('hidden')`, 2500);

    // 3D off: the 2D drawing is back and the 3D view leaves no frame waiting.
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
