'use strict';
// The 3D options, on the plan board: the sliders of the Graph panel's 3D section while the 3D Hierarchy shows.
// The section is named for the shape; on the disc the pole limits, the far side and the line strength stand
// disabled. Each slider changes the scene: the mark size and the mark scale change how big a dot is drawn,
// the pole limits move the dots on the half sphere and the sphere, the far side kept and the line strength
// change the colour the far side and the lines are painted, and the move and spin speeds change how far a
// held D slides and a held Q spins in the same time. Let go, a slider gives the focus back, so the keys work
// at once. Picking a dot and F still hit cards after a pole change. The options are kept per board in this
// browser (localStorage, kanban.<board>.graph.3d) and survive a reload; Reset sets them back and forgets
// them, and after a reload the disc seen from straight above is again within 2 px of the 2D Hierarchy.
//
// A slider is set by a real click on its track (Input.dispatchMouseEvent), at a share of its width; the value
// it took is read back. Keys are real Input.dispatchKeyEvent; a held key is its keyDown alone.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds, graph3dCur.

const { keyEvents } = require('../harness');
const { openPanel } = require('../panel');

const ROOT = `document.querySelector('#graph-view .graph-3d')`;
const CAM = `(()=>{const r=${ROOT};if(!r||!r.dataset.cam)return null;const [theta,phi,dist,tx,ty,tz]=r.dataset.cam.split(',').map(Number);return {theta,phi,dist,tx,ty,tz}})()`;
const DOTS = `(()=>{const o={};for(const g of document.querySelectorAll('#graph-view .graph-node')){const d=g.querySelector('.graph-dot');if(!d||getComputedStyle(g).display==='none')continue;const r=d.getBoundingClientRect();o[g.dataset.id]={x:r.left+r.width/2,y:r.top+r.height/2}}return o})()`;
// The mean width a near dot is drawn at, in px.
const DOT_W = `(()=>{const w=[...${ROOT}.querySelectorAll('.graph-node:not(.graph-3d-off):not(.graph-3d-far) .graph-dot')].map((d)=>d.getBoundingClientRect().width);return w.reduce((a,v)=>a+v,0)/Math.max(1,w.length)})()`;
// The paints of the marks on the far side, and of the lines, as one string each.
const PAINT = (sel) => `[...${ROOT}.querySelectorAll(${JSON.stringify(sel)})].map((e)=>e.style.getPropertyValue('--graph-3d-paint')).join('|')`;
const FAR_PAINT = PAINT('.graph-node.graph-3d-far [style*="--graph-3d-paint"]');
const LINE_PAINT = PAINT('path[style*="--graph-3d-paint"]:not(.graph-link-hit)');
const SLIDER = (k) => `document.querySelector('.graph-3d-options input[data-graph3d-option="${k}"]')`;
const VALUES = `Object.fromEntries([...document.querySelectorAll('.graph-3d-options input[data-graph3d-option]')].map((i)=>[i.dataset.graph3dOption,Number(i.value)]))`;
const KEPT = `Object.keys(localStorage).filter((k)=>/^kanban\\..*\\.graph\\.3d$/.test(k))`;
const MIDDLE_DOT = `(()=>{const s=${ROOT}.getBoundingClientRect();let best=null;for(const g of ${ROOT}.querySelectorAll('.graph-node')){if(g.classList.contains('graph-3d-off')||g.classList.contains('graph-3d-far'))continue;const r=g.querySelector('.graph-dot').getBoundingClientRect();const p={id:g.dataset.id,x:r.left+r.width/2,y:r.top+r.height/2};const d=Math.hypot(p.x-(s.left+s.right)/2,p.y-(s.top+s.bottom)/2);if(r.width>4&&(!best||d<best.d))best={...p,d}}return best})()`;

module.exports = {
  name: 'graph-3d-options',
  board: 'plan',
  timeoutMs: 150000,
  async run(page) {
    const { ev, open, waitFor, mouse, click, key, check, send, sleep, shot } = page;
    const cam = () => ev(CAM);
    const settled = async () => {
      // Six equal reads in a row: the readout is rounded to two places, so the slow end of a coast can read
      // the same twice and still be moving.
      let last = null, same = 0;
      for (let i = 0; i < 80; i++) {
        const now = await cam();
        same = now && last && JSON.stringify(now) === JSON.stringify(last) ? same + 1 : 0;
        if (same >= 5) return now;
        last = now;
        await sleep(80);
      }
      return last;
    };
    const drawn = `(()=>{const r=${ROOT};return !!r&&!r.classList.contains('graph-3d-loading')&&!!r.querySelector('canvas.graph-3d-canvas')&&!!r.dataset.cam})()`;
    // A click on the slider's track at `share` of its width; the value it took.
    const slide = async (k, share) => {
      const r = await ev(`(()=>{const i=${SLIDER(k)};i.scrollIntoView({block:'center'});const b=i.getBoundingClientRect();return {l:b.left,t:b.top,w:b.width,h:b.height,off:i.disabled}})()`);
      const x = r.l + 8 + (r.w - 16) * share, y = r.t + r.h / 2;
      await mouse('mouseMoved', x, y, { button: 'none' });
      await click(x, y);
      await sleep(250);
      return ev(`Number(${SLIDER(k)}.value)`);
    };
    const changed = async (what, read, act) => {
      const before = await read();
      await act();
      const ok = await waitFor(`(${read.expr})!==${JSON.stringify(before)}`, 3000);
      check(what, ok, { before, after: await read() });
    };
    const reader = (expr) => Object.assign(() => ev(expr), { expr });
    const down = (k) => send('Input.dispatchKeyEvent', keyEvents(k)[0]);
    const up = (k) => send('Input.dispatchKeyEvent', keyEvents(k)[1]);
    // How far a key held for `ms` moves the target, and how far it turns the camera.
    const hold = async (k, ms) => {
      const a = await settled();
      await down(k);
      await sleep(ms);
      await up(k);
      const b = await settled();
      return { slid: Math.hypot(b.tx - a.tx, b.ty - a.ty, b.tz - a.tz) / a.dist, spun: Math.abs(b.theta - a.theta) };
    };

    // The 2D Hierarchy first, with the panel open, for the picture from straight above.
    await open('/?view=graph&graph=hierarchy');
    check('the Graph panel opens', await openPanel(page));
    check('the 2D Hierarchy draws', await waitFor(`document.querySelectorAll('#graph-view .graph-stage .graph-node').length>20&&!${ROOT}`, 10000));
    check('the 2D Hierarchy has no 3D section', await ev(`!document.querySelector('.graph-3d-options')`));
    await sleep(300);
    const flat = await ev(DOTS);
    await ev(`document.querySelector('.graph-kinds .graph-3d-btn').click()`);
    check('3D draws', await waitFor(drawn, 20000));
    check('the panel has a 3D section named for the disc, with a Reset', await waitFor(`(()=>{const b=document.querySelector('.graph-3d-options');return !!b&&/Disc/i.test(b.querySelector('.graph-3d-options-head').textContent)&&!!b.querySelector('.graph-3d-options-reset')})()`, 5000));
    const defaults = await ev(VALUES);
    check('on the disc the pole limits, the far side and the line strength stand disabled; the rest do not',
      await ev(`['top','ring','far','lines'].every((k)=>document.querySelector('.graph-3d-options input[data-graph3d-option="'+k+'"]').disabled)&&!['size','scale','move','spin'].some((k)=>document.querySelector('.graph-3d-options input[data-graph3d-option="'+k+'"]').disabled)`), defaults);
    check('nothing is kept for the board before a slider moves', (await ev(KEPT)).length === 0);
    await settled();
    const homeW = await ev(DOT_W);

    // The move speed and the spin speed: the same hold goes further at the top of the slider. Let go, the
    // slider gives the focus back, so D and Q act at once.
    const slow = await hold('d', 700);
    const moveTop = await slide('move', 1);
    check('the move speed slider takes a value over 1', moveTop > 3, moveTop);
    check('let go, the slider gives the focus back', await ev(`document.activeElement===document.body||!document.activeElement||document.activeElement.tagName!=='INPUT'`));
    const fast = await hold('d', 700);
    check('at the top of the move speed, a held D slides much further in the same time', fast.slid > 2 * slow.slid, { slow, fast });
    const spinSlow = await hold('q', 700);
    await slide('spin', 1);
    const spinFast = await hold('q', 700);
    check('at the top of the spin speed, a held Q spins much further in the same time', spinFast.spun > 2 * spinSlow.spun, { spinSlow, spinFast });
    await key('h');
    await settled();

    // The mark size and the mark scale, seen from far away: wheeled out, the dots are small; the size toward the
    // screen and the scale draw them bigger.
    const stage = await ev(`(()=>{const r=${ROOT}.getBoundingClientRect();return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}})()`);
    for (let i = 0; i < 3; i++) await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: stage.x, y: stage.y, deltaX: 0, deltaY: 600 });
    await settled();
    const farW = await ev(DOT_W);
    check('wheeled out, the dots are drawn smaller', farW < homeW * 0.8, { homeW, farW });
    await slide('size', 1);
    await settled();
    const sizedW = await ev(DOT_W);
    check('the mark size at the screen end draws far dots bigger', sizedW > farW * 1.2, { farW, sizedW });
    await slide('scale', 1);
    await settled();
    const scaledW = await ev(DOT_W);
    check('the mark scale at its top draws the dots well past their size before', scaledW > sizedW * 2.5, { sizedW, scaledW });
    await shot('options-marks');
    await key('h');
    await settled();

    // The half sphere and the sphere: the pole limits move the dots, the far side kept and the line strength
    // repaint the far side and the lines.
    await key('g');
    check('G steps to the half sphere and the section follows', await waitFor(`${ROOT}.dataset.shape==='half'&&/half/i.test(document.querySelector('.graph-3d-options-head').textContent)&&!${SLIDER('top')}.disabled`, 4000));
    await settled();
    await changed('the centre below the top pole moves the dots of the half sphere', reader(`JSON.stringify(${DOTS})`), () => slide('top', 0.5));
    await key('g');
    check('G steps to the sphere', await waitFor(`${ROOT}.dataset.shape==='sphere'&&/sphere/i.test(document.querySelector('.graph-3d-options-head').textContent)`, 4000));
    await settled();
    await changed('the centre below the top pole moves the dots of the sphere', reader(`JSON.stringify(${DOTS})`), () => slide('top', 0.3));
    await settled();
    await changed('the outermost ring moves the dots of the sphere', reader(`JSON.stringify(${DOTS})`), () => slide('ring', 0.4));
    await key('h');
    await settled();
    check('the sphere has a far side to paint', (await ev(FAR_PAINT)).length > 0);
    await changed('the far side kept repaints the far side', reader(FAR_PAINT), () => slide('far', 0.05));
    await changed('the line strength repaints the lines', reader(LINE_PAINT), () => slide('lines', 0.1));
    await shot('options-sphere');

    // After the pole change a click on a dot still selects its card and F brings it to the middle.
    await settled();
    const pick = await ev(MIDDLE_DOT);
    check('a dot is drawn near the middle of the sphere', !!pick, pick);
    await ev(`selectedIds.clear()`);
    await mouse('mouseMoved', pick.x, pick.y, { button: 'none' });
    await click(pick.x, pick.y);
    check('after a pole change a click on a dot selects its card', await waitFor(`selectedIds.size===1&&selectedIds.has(${JSON.stringify(pick.id)})`, 3000), { pick, sel: await ev(`[...selectedIds]`) });
    await key('f');
    await settled();
    const gap = await ev(`(()=>{const d=${ROOT}.querySelector('.graph-node[data-id="${pick.id}"] .graph-dot').getBoundingClientRect();const s=${ROOT}.getBoundingClientRect();return Math.round(Math.hypot(d.left+d.width/2-(s.left+s.right)/2,d.top+d.height/2-(s.top+s.bottom)/2))})()`);
    check('after a pole change F brings the selected card to the middle', gap < 30, { gap });
    await ev(`selectedIds.clear()`);

    // Kept per board in this browser: a reload shows every slider where it was left.
    const set = await ev(VALUES);
    check('the options are kept for the board in this browser', (await ev(KEPT)).length === 1, await ev(KEPT));
    await open('/?view=graph&graph=hierarchy&in3d=1');
    check('3D draws again after the reload', await waitFor(drawn, 20000));
    check('the 3D section stands again', await waitFor(`!!document.querySelector('.graph-3d-options')`, 5000));
    const back = await ev(VALUES);
    check('after a reload the speeds, the mark size and the mark scale are where they were left',
      ['move', 'spin', 'size', 'scale'].every((k) => back[k] === set[k]), { set, back });
    await key('g');
    await key('g');
    check('back on the sphere', await waitFor(`${ROOT}.dataset.shape==='sphere'&&!${SLIDER('top')}.disabled`, 4000));
    const sphereBack = await ev(VALUES);
    check('after a reload the sphere\'s pole limits, far side and line strength are where they were left',
      ['top', 'ring', 'far', 'lines'].every((k) => sphereBack[k] === set[k]), { set, sphereBack });
    await key('g');
    check('back on the disc', await waitFor(`${ROOT}.dataset.shape==='disc'`, 4000));
    await key('h');
    await settled();
    check('after a reload the mark scale still draws the dots bigger', await ev(DOT_W) > homeW * 2, { homeW, now: await ev(DOT_W) });

    // Reset: the defaults, nothing kept, and the disc from straight above is the 2D picture again.
    await ev(`document.querySelector('.graph-3d-options-reset').scrollIntoView({block:'center'})`);
    const reset = await page.centre('.graph-3d-options-reset');
    await click(reset.x, reset.y);
    check('Reset sets every slider back to its default', await waitFor(`JSON.stringify(${VALUES})===${JSON.stringify(JSON.stringify(defaults))}`, 3000), { defaults, now: await ev(VALUES) });
    check('Reset forgets what was kept for the board', (await ev(KEPT)).length === 0, await ev(KEPT));
    await open('/?view=graph&graph=hierarchy&in3d=1');
    check('3D draws again after a reload', await waitFor(drawn, 20000));
    const top = await settled();
    check('it opens on the disc from straight above', top.phi === 0 && top.theta === 0, top);
    check('after Reset and a reload every slider is at its default', await waitFor(`!!document.querySelector('.graph-3d-options')&&JSON.stringify(${VALUES})===${JSON.stringify(JSON.stringify(defaults))}`, 5000));
    await sleep(300);
    const above = await ev(DOTS);
    const off = Object.keys(flat).map((id) => ({ id, d: above[id] ? Math.hypot(above[id].x - flat[id].x, above[id].y - flat[id].y) : Infinity })).filter((o) => o.d > 2);
    check('after Reset, from straight above every dot stands within 2 px of the 2D Hierarchy', Object.keys(flat).length > 20 && off.length === 0, off.slice(0, 5));
    check('after Reset the dots are drawn their own size again', Math.abs(await ev(DOT_W) - homeW) < 0.5, { homeW, now: await ev(DOT_W) });
  },
};
