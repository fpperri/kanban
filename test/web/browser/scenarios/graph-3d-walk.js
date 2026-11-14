'use strict';
// The 3D Hierarchy's walk, on the notes board (the plan board with a logbook, so the notes palette can be
// opened over it). Held, W and S fly the camera ahead and back along where it looks (the eye and the target
// together, so looking straight down W goes down toward the ground), A and D slide it to the left and to
// the right, level; the tilt, the turn and the distance to the target stay. W with D goes ahead and to the
// right at once. A move stops when the key comes up and when the window loses focus.
// Shift and a right drag looks round from where the camera stands: its position stays while its heading changes. The
// keys never move the camera while a field has focus, with Ctrl held (Ctrl+S), nor on a note row of the
// notes palette, where a and d keep acting on the note. The Flow draws no 3D Hierarchy, and a walk key there
// does nothing.
//
// Every key is a real Input.dispatchKeyEvent; a held key is its keyDown alone, its keyUp sent once the
// camera has moved far enough. The camera is read off the view's root (data-cam: turn, tilt, distance,
// then the target's x, y, z). The loss of focus is the window's blur event.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): openNotes.

const { keyEvents } = require('../harness');

const ROOT = `document.querySelector('#graph-view .graph-3d')`;
const SHIFT = 8;
const CAM = `(()=>{const r=${ROOT};if(!r||!r.dataset.cam)return null;const [theta,phi,dist,tx,ty,tz]=r.dataset.cam.split(',').map(Number);return {theta,phi,dist,tx,ty,tz}})()`;
const PAL_UP = `(()=>{const p=document.getElementById('notes-palette');return !!p&&!p.classList.contains('hidden')})()`;
const FOCUS_NOTE = `(()=>{const r=document.querySelector('#notes-palette .np-note');if(r)r.focus();return !!r&&document.activeElement===r})()`;

module.exports = {
  name: 'graph-3d-walk',
  board: 'notes',
  timeoutMs: 120000,
  async run(page) {
    const { ev, open, waitFor, key, check, send, mouse, sleep } = page;
    const cam = () => ev(CAM);
    // The camera once it has stopped.
    const settled = async () => {
      // Six equal reads in a row, about half a second: the readout is rounded to two
      // places, so the slow end of a coast can read the same twice and still be moving.
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
    // Still: the camera settled and the same a while later.
    const still = async () => {
      const a = await settled();
      await sleep(400);
      const b = await cam();
      return { a, b, still: JSON.stringify(a) === JSON.stringify(b) };
    };
    const down = (k, mods) => send('Input.dispatchKeyEvent', keyEvents(k, mods)[0]);
    const up = (k, mods) => send('Input.dispatchKeyEvent', keyEvents(k, mods)[1]);
    // Where the camera stands, from its target, its turn, its tilt and its distance (graph3dBasis).
    const eyeOf = (c) => [c.tx + Math.sin(c.phi) * Math.sin(c.theta) * c.dist, c.ty + Math.cos(c.phi) * c.dist, c.tz + Math.sin(c.phi) * Math.cos(c.theta) * c.dist];
    // Holds `keys` until the camera has moved a tenth of the distance, then lets them up.
    const walk = async (keys) => {
      const from = await settled();
      for (const k of keys) await down(k);
      const went = await waitFor(`(()=>{const c=${CAM};return !!c&&Math.hypot(c.tx-(${from.tx}),c.ty-(${from.ty}),c.tz-(${from.tz}))>${from.dist * 0.1}})()`, 6000);
      for (const k of keys) await up(k);
      const { a: to, still: stopped } = await still();
      const d = [to.tx - from.tx, to.ty - from.ty, to.tz - from.tz], len = Math.hypot(...d) || 1;
      return { from, to, went, stopped, dir: d.map((v) => v / len), kept: to.theta === from.theta && to.phi === from.phi && to.dist === from.dist };
    };
    // Where the camera looks and its right (graph3dBasis); the right is level.
    const ahead = (c) => [-Math.sin(c.phi) * Math.sin(c.theta), -Math.cos(c.phi), -Math.sin(c.phi) * Math.cos(c.theta)];
    const right = (c) => [Math.cos(c.theta), 0, -Math.sin(c.theta)];
    const along = (d, v) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    // `then` runs straight after the key, before the camera is read again: a mark the key
    // shows for a few seconds (the notes palette's Sure?) is checked while it is still up.
    const unchanged = async (what, act, then) => {
      const before = await settled();
      await act();
      if (then) await then();
      await sleep(400);
      const after = await settled();
      check(what, JSON.stringify(before) === JSON.stringify(after), { before, after });
    };

    await open('/?view=graph&graph=hierarchy&in3d=1');
    check('the 3D Hierarchy is drawn', await waitFor(`(()=>{const r=${ROOT};return !!r&&!r.classList.contains('graph-3d-loading')&&!!r.querySelector('canvas.graph-3d-canvas')&&!!r.dataset.cam})()`, 20000));
    const top = await settled();
    check('it opens straight above, north up', top && top.phi === 0 && top.theta === 0, top);

    // Straight above, north up: W flies down toward the ground, S back up, A left, D right.
    const w = await walk(['w']);
    check('looking straight down, W flies the camera down, along where it looks', w.went && along(w.dir, ahead(w.from)) > 0.99 && w.dir[1] < -0.99, w);
    check('W keeps the tilt, the turn and the distance to the target: it flies, never closing in on the target', w.kept, w);
    check('the flight stops when the key comes up', w.stopped, w);
    const s = await walk(['s']);
    check('looking straight down, S flies it back up', s.went && s.stopped && s.kept && along(s.dir, ahead(s.from)) < -0.99, s);
    const a = await walk(['a']);
    check('held, A moves the camera to the left, level', a.went && a.stopped && a.kept && along(a.dir, right(a.from)) < -0.99, a);
    const d = await walk(['d']);
    check('held, D moves the camera to the right, level', d.went && d.stopped && d.kept && along(d.dir, right(d.from)) > 0.99, d);

    // Looked round by Shift and a right drag: the camera stays where it stands and its heading changes.
    const area = await ev(`(()=>{const r=document.querySelector('#graph-view .graph-main').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
    const spot = { x: area.l + 120, y: area.b - 60 };
    const dragUp = async (px) => {
      await mouse('mouseMoved', spot.x, spot.y, { button: 'none', modifiers: SHIFT });
      await mouse('mousePressed', spot.x, spot.y, { button: 'right', modifiers: SHIFT });
      for (let k = 1; k <= 8; k++) await mouse('mouseMoved', spot.x + 15 * k, spot.y - (px * k) / 8, { button: 'right', buttons: 2, modifiers: SHIFT });
      // Held still past the coast's 80 ms window before the release, so no coast carries the look on: the tilt the
      // drag leaves is the drag's own, the same on a slow machine as on a fast one.
      await sleep(250);
      await mouse('mouseReleased', spot.x + 120, spot.y - px, { button: 'right', modifiers: SHIFT });
      check('Shift and a right drag opens no menu', await ev(`document.getElementById('context-menu').classList.contains('hidden')`));
    };
    const level = await settled();
    await dragUp(0.35 * (area.b - area.t));
    const looked = await settled();
    const e0 = eyeOf(level), e1 = eyeOf(looked);
    check('Shift and a right drag turns and tilts the camera', looked.phi > 0.2 && Math.abs(looked.theta) > 0.2, looked);
    check('Shift and a right drag keeps the camera where it stands: its position does not move, its target swings round it',
      Math.hypot(e1[0] - e0[0], e1[1] - e0[1], e1[2] - e0[2]) < level.dist * 0.015 && Math.hypot(looked.tx - level.tx, looked.ty - level.ty, looked.tz - level.tz) > 20, { level, looked, e0, e1 });
    check('the look leaves the camera looking near the horizon', Math.abs(looked.phi - Math.PI / 2) < 0.6, looked);
    const wt = await walk(['w']);
    check('looking near the horizon, W flies the camera ahead along where it looks, the tilt, turn and distance kept',
      wt.went && wt.stopped && wt.kept && along(wt.dir, ahead(wt.from)) > 0.99, wt);
    const wd = await walk(['w', 'd']);
    const diag = ahead(wd.from).map((v, k) => (v + right(wd.from)[k]) / Math.SQRT2);
    check('W and D together go ahead and to the right at once', wd.went && wd.stopped && wd.kept && along(wd.dir, diag) > 0.99, wd);

    // Looking far up, W flies up along where the camera looks, S back down.
    await dragUp(0.45 * (area.b - area.t));
    const up1 = await settled();
    check('a long look up looks above the horizon', up1.phi > Math.PI / 2 + 0.2 && up1.phi < Math.PI, up1);
    const wu = await walk(['w']);
    check('looking far up, W flies the camera up along where it looks', wu.went && wu.stopped && wu.kept && along(wu.dir, ahead(wu.from)) > 0.99 && wu.dir[1] > 0.1, wu);
    const sd = await walk(['s']);
    check('looking far up, S flies it back', sd.went && sd.stopped && along(sd.dir, ahead(sd.from)) < -0.99, sd);
    const ad = await walk(['a']);
    check('A stays level however the camera looks', ad.went && ad.stopped && Math.abs(eyeOf(ad.to)[1] - eyeOf(ad.from)[1]) < 0.5, ad);

    // The window losing focus stops the walk, the key still down.
    const lost = await settled();
    await down('d');
    const going = await waitFor(`(()=>{const c=${CAM};return !!c&&Math.hypot(c.tx-(${lost.tx}),c.ty-(${lost.ty}),c.tz-(${lost.tz}))>${lost.dist * 0.05}})()`, 6000);
    await ev(`window.dispatchEvent(new Event('blur'))`);
    const blurred = await still();
    await up('d');
    check('the walk stops when the window loses focus, the key still down', going && blurred.still, blurred);

    // In a field the keys type and the camera stays.
    await key('/');
    check('/ puts the focus in the search box', await waitFor(`document.activeElement&&document.activeElement.id==='search-input'`, 2500));
    await unchanged('W held in the search box types, and the camera stays', async () => { await down('w'); await sleep(300); await up('w'); });
    check('the w went into the search box', await ev(`document.getElementById('search-input').value`) === 'w', await ev(`document.getElementById('search-input').value`));
    await key('Escape');
    await ev(`document.activeElement.blur()`);

    // With Ctrl, S keeps its own meaning.
    await unchanged('Ctrl+S does not move the camera', async () => { await down('s', { ctrl: true }); await sleep(300); await up('s', { ctrl: true }); });

    // On a note row of the notes palette, a and d act on the note and the camera stays.
    await ev(`openNotes({ target: '7' })`);
    check('the notes palette opens on card 7 over the 3D Hierarchy', await waitFor(`${PAL_UP}&&document.querySelectorAll('#notes-palette .np-note').length>0`, 3000));
    check('a note row takes the focus', await ev(FOCUS_NOTE));
    await unchanged('d on a note row moves no camera', () => key('d'), async () =>
      check('d on a note row asks to delete the note', await waitFor(`(()=>{const s=document.querySelector('#notes-palette .np-sure');return !!s&&s.textContent==='Sure?'})()`, 2500)));
    check('a note row takes the focus again', await ev(FOCUS_NOTE));
    await unchanged('a on a note row moves no camera', () => key('a'));
    check('a on a note row opens the picker to move the note', await waitFor(`!!document.querySelector('#notes-palette .np-assign-input')`, 2500));
    for (let i = 0; i < 4 && await ev(PAL_UP); i++) { await key('Escape'); await sleep(150); }
    check('the notes palette closes', await waitFor(`!${PAL_UP}`, 2500));

    // The Flow draws no 3D Hierarchy: a walk key there does nothing.
    await ev(`document.querySelector('.graph-kind-btn[data-graph-kind=flow]').click()`);
    check('the Flow takes the 3D scene down', await waitFor(`!${ROOT}`, 5000));
    await down('w');
    await sleep(300);
    await up('w');
    check('a walk key in the Flow leaves no 3D scene and no error', await ev(`!${ROOT}`));
  },
};
