'use strict';
// The 3D Hierarchy's turn, on the notes board (the plan board with a logbook, so the notes palette can be
// opened over it). Held, Q turns the view left round the point the camera looks at and E turns it right; the
// tilt, the distance and that point stay, and the compass turns with the camera. The turn stops when the key
// comes up and when the window loses focus; Q and E together cancel; Q turns while W walks. The keys never
// turn the camera while a field has focus, with Ctrl held, on a note row of the notes palette (where e edits
// the note), nor with a card's details open, where e opens the card's edit form. The 2D Hierarchy and the
// Flow draw no 3D Hierarchy, and Q and E there do nothing.
//
// Every key is a real Input.dispatchKeyEvent; a held key is its keyDown alone, its keyUp sent once the
// camera has turned far enough. The camera is read off the view's root (data-cam: turn, tilt, distance,
// then the target's x, y, z). The loss of focus is the window's blur event.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): openNotes, openCard, state, graphCur.

const { keyEvents } = require('../harness');

const ROOT = `document.querySelector('#graph-view .graph-3d')`;
const CAM = `(()=>{const r=${ROOT};if(!r||!r.dataset.cam)return null;const [theta,phi,dist,tx,ty,tz]=r.dataset.cam.split(',').map(Number);return {theta,phi,dist,tx,ty,tz}})()`;
const COMPASS = `(()=>{const d=${ROOT}&&${ROOT}.querySelector('.graph-3d-compass-dial');const m=d&&/rotate\\(([-\\d.e]+)\\)/.exec(d.getAttribute('transform'));return m?Number(m[1]):null})()`;
const PAL_UP = `(()=>{const p=document.getElementById('notes-palette');return !!p&&!p.classList.contains('hidden')})()`;
const FOCUS_NOTE = `(()=>{const r=document.querySelector('#notes-palette .np-note');if(r)r.focus();return !!r&&document.activeElement===r})()`;
const SHOWN = (id) => `(()=>{const m=document.getElementById('${id}');return !!m&&!m.classList.contains('hidden')})()`;

module.exports = {
  name: 'graph-3d-turn',
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
    const kept = (a, b) => a.phi === b.phi && a.dist === b.dist && a.tx === b.tx && a.ty === b.ty && a.tz === b.tz;
    // Holds `k` until the camera has turned 0.3 rad, then lets it up.
    const turn = async (k) => {
      const from = await settled();
      await down(k);
      const went = await waitFor(`(()=>{const c=${CAM};return !!c&&Math.abs(c.theta-(${from.theta}))>0.3})()`, 6000);
      await up(k);
      const { a: to, still: stopped } = await still();
      return { from, to, went, stopped, by: to.theta - from.theta, kept: kept(from, to) };
    };
    const unchanged = async (what, act) => {
      const before = await settled();
      await act();
      await sleep(400);
      const after = await settled();
      check(what, JSON.stringify(before) === JSON.stringify(after), { before, after });
    };

    await open('/?view=graph&graph=hierarchy&in3d=1');
    check('the 3D Hierarchy is drawn', await waitFor(`(()=>{const r=${ROOT};return !!r&&!r.classList.contains('graph-3d-loading')&&!!r.querySelector('canvas.graph-3d-canvas')&&!!r.dataset.cam})()`, 20000));

    // Tilted by a right drag first, so the turn is seen to keep the tilt.
    const area = await ev(`(()=>{const r=document.querySelector('#graph-view .graph-main').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
    const spot = { x: area.l + 120, y: area.b - 140 };
    await mouse('mouseMoved', spot.x, spot.y, { button: 'none' });
    await mouse('mousePressed', spot.x, spot.y, { button: 'right' });
    for (let k = 1; k <= 8; k++) await mouse('mouseMoved', spot.x, spot.y - 12 * k, { button: 'right', buttons: 2 });
    await mouse('mouseReleased', spot.x, spot.y - 96, { button: 'right' });
    await key('Escape');
    const tilted = await settled();
    check('a right drag tilts the camera', tilted.phi > 0.2, tilted);

    const q = await turn('q');
    check('held, Q turns the view left: the camera\'s turn grows', q.went && q.by > 0.3, q);
    check('Q keeps the tilt, the distance and the point the camera looks at', q.kept, q);
    check('the turn stops when Q comes up', q.stopped, q);
    const dial = await ev(COMPASS);
    check('the compass turns with the camera', dial !== null && Math.abs(dial - (q.to.theta * 180) / Math.PI) < 1, { dial, theta: q.to.theta });
    const e = await turn('e');
    check('held, E turns the view right: the camera\'s turn shrinks', e.went && e.by < -0.3, e);
    check('E keeps the tilt, the distance and the point, and stops when it comes up', e.kept && e.stopped, e);

    // Q and E together cancel: read from once both are down to before either comes up, since the moment
    // between the two keyDowns turns the camera as Q alone does.
    await settled();
    await down('q');
    await down('e');
    const held = await settled();
    await sleep(500);
    const heldLater = await cam();
    await up('e');
    await up('q');
    check('Q and E held together turn nothing', JSON.stringify(held) === JSON.stringify(heldLater), { held, heldLater });

    // Q turns while W walks.
    const from = await settled();
    await down('w');
    await down('q');
    const both = await waitFor(`(()=>{const c=${CAM};return !!c&&Math.abs(c.theta-(${from.theta}))>0.3&&Math.hypot(c.tx-(${from.tx}),c.tz-(${from.tz}))>${from.dist * 0.05}})()`, 6000);
    await up('q');
    await up('w');
    const walked = await still();
    const to = walked.a;
    check('Q with W held turns the camera while it walks, the tilt and the distance kept',
      both && to.theta > from.theta + 0.3 && Math.hypot(to.tx - from.tx, to.tz - from.tz) > 0 && to.phi === from.phi && to.dist === from.dist && walked.still, { from, to });

    // The window losing focus stops the turn, the key still down.
    const lost = await settled();
    await down('e');
    const going = await waitFor(`(()=>{const c=${CAM};return !!c&&Math.abs(c.theta-(${lost.theta}))>0.15})()`, 6000);
    await ev(`window.dispatchEvent(new Event('blur'))`);
    const blurred = await still();
    await up('e');
    check('the turn stops when the window loses focus, the key still down', going && blurred.still, blurred);

    // In a field the keys type and the camera stays.
    await key('/');
    check('/ puts the focus in the search box', await waitFor(`document.activeElement&&document.activeElement.id==='search-input'`, 2500));
    await unchanged('Q and E held in the search box type, and the camera stays', async () => {
      await down('q'); await sleep(200); await up('q');
      await down('e'); await sleep(200); await up('e');
    });
    check('the q and the e went into the search box', await ev(`document.getElementById('search-input').value`) === 'qe', await ev(`document.getElementById('search-input').value`));
    await key('Escape');
    await ev(`document.activeElement.blur()`);
    await waitFor(`document.getElementById('search-input').value===''`, 2500);

    // With Ctrl, E keeps its own meaning.
    await unchanged('Ctrl+E does not turn the camera', async () => { await down('e', { ctrl: true }); await sleep(300); await up('e', { ctrl: true }); });

    // On a note row of the notes palette, e edits the note and the camera stays.
    await ev(`openNotes({ target: '7' })`);
    check('the notes palette opens on card 7 over the 3D Hierarchy', await waitFor(`${PAL_UP}&&document.querySelectorAll('#notes-palette .np-note').length>0`, 3000));
    check('a note row takes the focus', await ev(FOCUS_NOTE));
    await unchanged('e on a note row turns no camera', () => key('e'));
    check('e on a note row edits the note', await waitFor(`!!document.querySelector('#notes-palette .np-edit-text')`, 2500));
    for (let i = 0; i < 4 && await ev(PAL_UP); i++) { await key('Escape'); await sleep(150); }
    check('the notes palette closes', await waitFor(`!${PAL_UP}`, 2500));

    // With a card's details open, E opens its edit form and Q turns nothing.
    await ev(`openCard('7')`);
    check('card 7\'s details open over the 3D Hierarchy', await waitFor(SHOWN('detail-modal'), 3000));
    await unchanged('Q held with the details open turns no camera', async () => { await down('q'); await sleep(300); await up('q'); });
    await unchanged('e with the details open turns no camera', () => key('e'));
    const title = await ev(`(state.active.find((c)=>String(c.id)==='7')||{}).title`);
    check('e with the details open opens the card\'s edit form, the focus in its title, no e typed',
      await waitFor(`${SHOWN('modal')}&&!${SHOWN('detail-modal')}&&document.activeElement&&document.activeElement.id==='f-title'`, 2500)
        && await ev(`document.getElementById('f-title').value`) === title,
      { title, value: await ev(`document.getElementById('f-title').value`) });
    await key('Escape');
    check('Esc leaves the edit form for the details', await waitFor(`!${SHOWN('modal')}&&${SHOWN('detail-modal')}`, 2500));
    await key('Escape');
    check('Esc closes the details', await waitFor(`!${SHOWN('detail-modal')}`, 2500));
    const after = await turn('q');
    check('with the details closed, Q turns again', after.went && after.by > 0.3 && after.kept && after.stopped, after);

    // The 2D Hierarchy draws no 3D Hierarchy: Q and E there move nothing.
    await ev(`document.querySelector('.graph-kinds .graph-3d-btn').click()`);
    check('the 3D button takes the 3D scene down for the 2D Hierarchy', await waitFor(`!${ROOT}&&!!document.querySelector('#graph-view svg')`, 5000));
    const flat = await ev(`JSON.stringify(graphCur&&graphCur.view)`);
    await down('q'); await sleep(300); await up('q');
    await down('e'); await sleep(300); await up('e');
    check('Q and E in the 2D Hierarchy leave no 3D scene and move nothing', await ev(`!${ROOT}`) && await ev(`JSON.stringify(graphCur&&graphCur.view)`) === flat);

    // The Flow draws no 3D Hierarchy either.
    await ev(`document.querySelector('.graph-kind-btn[data-graph-kind=flow]').click()`);
    check('the Flow shows', await waitFor(`!!document.querySelector('.graph-kind-btn[data-graph-kind=flow][aria-pressed=true]')||(graphCur&&graphCur.kind==='flow')`, 5000));
    await down('q'); await sleep(300); await up('q');
    check('a turn key in the Flow leaves no 3D scene and no error', await ev(`!${ROOT}`));
  },
};
