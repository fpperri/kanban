'use strict';
// The 3D Hierarchy's walk, on the notes board (the plan board with a logbook, so the notes palette can be
// opened over it). Held, W moves the camera's target along the ground the way the camera faces, S back,
// A to the left and D to the right; the tilt, the turn and the distance stay. Two keys together move
// diagonally. The walk stops when the key comes up and when the window loses focus. The keys never move
// the camera while a field has focus, with Ctrl held (Ctrl+S), nor on a note row of the notes palette,
// where a and d keep acting on the note. The Flow draws no 3D Hierarchy, and a walk key there does nothing.
//
// Every key is a real Input.dispatchKeyEvent; a held key is its keyDown alone, its keyUp sent once the
// camera has moved far enough. The camera is read off the view's root (data-cam: turn, tilt, distance,
// then the target's x, y, z). The loss of focus is the window's blur event.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): openNotes.

const { keyEvents } = require('../harness');

const ROOT = `document.querySelector('#graph-view .graph-3d')`;
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
    // The camera once it has stopped: the same reading twice, a few frames apart.
    const settled = async () => {
      let last = null;
      for (let i = 0; i < 60; i++) {
        const now = await cam();
        if (now && last && JSON.stringify(now) === JSON.stringify(last)) return now;
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
    // Holds `keys` until the target has moved a tenth of the distance, then lets them up.
    const walk = async (keys) => {
      const from = await settled();
      for (const k of keys) await down(k);
      const went = await waitFor(`(()=>{const c=${CAM};return !!c&&Math.hypot(c.tx-(${from.tx}),c.tz-(${from.tz}))>${from.dist * 0.1}})()`, 6000);
      for (const k of keys) await up(k);
      const { a: to, still: stopped } = await still();
      const dx = to.tx - from.tx, dz = to.tz - from.tz, len = Math.hypot(dx, dz) || 1;
      return { from, to, went, stopped, dir: [dx / len, dz / len], kept: to.theta === from.theta && to.phi === from.phi && to.dist === from.dist && to.ty === from.ty };
    };
    // The ground's directions for the camera's turn theta (graph3dBasis): ahead, as [x, z], and to the right.
    const ahead = (theta) => [-Math.sin(theta), -Math.cos(theta)];
    const right = (theta) => [Math.cos(theta), -Math.sin(theta)];
    const along = (d, v) => d[0] * v[0] + d[1] * v[1];
    const unchanged = async (what, act) => {
      const before = await settled();
      await act();
      await sleep(400);
      const after = await settled();
      check(what, JSON.stringify(before) === JSON.stringify(after), { before, after });
    };

    await open('/?view=graph&graph=hierarchy&in3d=1');
    check('the 3D Hierarchy is drawn', await waitFor(`(()=>{const r=${ROOT};return !!r&&!r.classList.contains('graph-3d-loading')&&!!r.querySelector('canvas.graph-3d-canvas')&&!!r.dataset.cam})()`, 20000));
    const top = await settled();
    check('it opens straight above, north up', top && top.phi === 0 && top.theta === 0, top);

    // Straight above, north up: W moves the target toward the top of the stage, S back, A left, D right.
    const w = await walk(['w']);
    check('held, W moves the target ahead: toward the top of the stage seen straight above', w.went && along(w.dir, ahead(w.from.theta)) > 0.99, w);
    check('W keeps the tilt, the turn and the distance: a pan, not an orbit', w.kept, w);
    check('the walk stops when the key comes up', w.stopped, w);
    const s = await walk(['s']);
    check('held, S moves the target back', s.went && s.stopped && s.kept && along(s.dir, ahead(s.from.theta)) < -0.99, s);
    const a = await walk(['a']);
    check('held, A moves the target to the left', a.went && a.stopped && a.kept && along(a.dir, right(a.from.theta)) < -0.99, a);
    const d = await walk(['d']);
    check('held, D moves the target to the right', d.went && d.stopped && d.kept && along(d.dir, right(d.from.theta)) > 0.99, d);

    // Tilted and turned by a right drag: ahead is the way the camera faces, along the ground.
    const area = await ev(`(()=>{const r=document.querySelector('#graph-view .graph-main').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
    const spot = { x: area.l + 120, y: area.b - 140 };
    await mouse('mouseMoved', spot.x, spot.y, { button: 'none' });
    await mouse('mousePressed', spot.x, spot.y, { button: 'right' });
    for (let k = 1; k <= 8; k++) await mouse('mouseMoved', spot.x + 15 * k, spot.y - 12 * k, { button: 'right', buttons: 2 });
    await mouse('mouseReleased', spot.x + 120, spot.y - 96, { button: 'right' });
    await key('Escape');
    const tilted = await settled();
    check('a right drag tilts and turns the camera', tilted.phi > 0.2 && Math.abs(tilted.theta) > 0.2, tilted);
    const wt = await walk(['w']);
    check('tilted and turned, W moves the target along the ground the way the camera faces, the tilt, turn and distance kept',
      wt.went && wt.stopped && wt.kept && along(wt.dir, ahead(wt.from.theta)) > 0.99, wt);
    const wd = await walk(['w', 'd']);
    const diag = [(ahead(wd.from.theta)[0] + right(wd.from.theta)[0]) / Math.SQRT2, (ahead(wd.from.theta)[1] + right(wd.from.theta)[1]) / Math.SQRT2];
    check('W and D together move diagonally, ahead and to the right', wd.went && wd.stopped && wd.kept && along(wd.dir, diag) > 0.99, wd);

    // The window losing focus stops the walk, the key still down.
    const lost = await settled();
    await down('d');
    const going = await waitFor(`(()=>{const c=${CAM};return !!c&&Math.hypot(c.tx-(${lost.tx}),c.tz-(${lost.tz}))>${lost.dist * 0.05}})()`, 6000);
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
    await unchanged('d on a note row moves no camera', () => key('d'));
    check('d on a note row asks to delete the note', await waitFor(`(()=>{const s=document.querySelector('#notes-palette .np-sure');return !!s&&s.textContent==='Sure?'})()`, 2500));
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
