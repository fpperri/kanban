'use strict';
// Android Back after a hold and drag on the phone layout steps the selection back as Esc does, through the
// history. With touch on, 390 by 844: a finger held on a tile and dragged up across two more selects the
// three, the page makes the entry of its own that a selection keeps (the lift is the tap it needs), and each
// history.back() pops it: the first drops the tiles passed and leaves the one held, the page staying and
// keeping its entry again, the next drops the one held, and with nothing left the Back after is the browser's
// and leaves the page. No light stands for a Back to drop first: the move that turned the hold into a drag
// ended it. Each wait is for the page's state, never for time.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): pinnedLitId, selectedIds.

const { holdDrag, backOut } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const kept = `!!history.state&&history.state.kanbanBack===true`;
    const stays = `window.__stay===true&&location.pathname==='/'`;
    const held = (id) => `pinnedLitId===${JSON.stringify(String(id))}`;
    const byId = (ids) => ids.map(Number).sort((a, b) => a - b).join();
    const pickedIs = (ids) => waitFor(`${picked}===${JSON.stringify(ids)}`, 3000);
    const back = () => ev('history.back()');
    // The tiles the Board shows whole, in the order they are drawn, each with a point on it a finger can reach.
    const wholeTiles = () => ev(`(()=>{const out=[];for(const el of document.querySelectorAll('#board .column .card-el')){const r=el.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight)continue;const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el)out.push({id:el.dataset.id,x,y})}return out})()`);

    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await ev('window.__stay=true');
    const [t0, t1, t2] = await wholeTiles();
    check('three tiles stand whole on the screen', !!t2, JSON.stringify([t0, t1, t2]));
    const entries = await ev('history.length');
    check('no entry of the page\'s own stands before anything is picked', !(await ev(kept)));

    await holdDrag(page, t2, [t1, t0], { until: held(t2.id) });
    check('a hold on the third tile and a drag up across the two above select all three', await pickedIs(byId([t0.id, t1.id, t2.id])), await ev(picked));
    check('the move that turned the hold into a drag ended the light', await ev('pinnedLitId===null'), await ev('pinnedLitId'));
    check('the page keeps one entry of its own for the selection', await waitFor(kept, 5000) && await ev('history.length') === entries + 1, await ev('history.length'));

    await back();
    check('a Back drops the tiles passed and leaves the one held', await pickedIs(t2.id), await ev(picked));
    check('and the page stays', await ev(stays));
    check('and keeps its entry again, there being a selection left', await waitFor(kept, 5000));
    check('without growing the history', await ev('history.length') === entries + 1, await ev('history.length'));

    await back();
    check('the next Back drops the tile held', await pickedIs(''), await ev(picked));
    check('and the page stays', await ev(stays));
    check('with nothing left the entry is not kept', !(await ev(kept)));

    await backOut(page);
    check('the Back after that is the browser\'s: it leaves the page', await waitFor(`location.href==='about:blank'`, 5000));
  },
};
