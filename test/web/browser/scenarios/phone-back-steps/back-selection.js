'use strict';
// Android Back on the phone layout steps the selection back as Esc does. With touch on, 390 by 844:
// three cards tapped into the selection make the page keep one history entry of its own, and each
// history.back() takes one step, the additions and then the anchor, the page staying where it is and
// keeping the entry again while something is left. With nothing selected the next Back is the browser's
// and leaves the page. Each wait is for the page's state, never for time, but the entry is kept after
// the double-tap window, which the page's own timer measures in real time.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds.

const { tap, realWait, backOut } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const kept = `!!history.state&&history.state.kanbanBack===true`;
    const stays = `window.__stay===true&&location.pathname==='/'`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); await tap(page, p.x, p.y); };
    const pickedIs = (ids) => waitFor(`${picked}===${JSON.stringify(ids)}`, 3000);
    const back = () => ev('history.back()');
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;

    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await ev('window.__stay=true');
    const ids = await ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0,3).map((e)=>e.dataset.id)`);
    const [a] = ids;
    const all = ids.slice().sort((x, y) => x - y).join();
    const entries = await ev('history.length');
    check('no entry of the page\'s own stands before anything is picked', !(await ev(kept)));

    for (const id of ids) await tapOn(titleOf(id));
    check('three taps select three cards', await pickedIs(all), await ev(picked));
    check('the page keeps one entry of its own', await waitFor(kept, 5000) && await ev('history.length') === entries + 1, await ev('history.length'));

    await back();
    check('a Back drops the additions and leaves the anchor', await pickedIs(a), await ev(picked));
    check('and the page stays', await ev(stays));
    check('and keeps its entry again, there being a selection left', await waitFor(kept, 5000));
    check('without growing the history', await ev('history.length') === entries + 1, await ev('history.length'));

    await back();
    check('the next Back drops the anchor', await pickedIs(''), await ev(picked));
    check('and the page stays', await ev(stays));
    await realWait(700);
    check('with nothing left the entry is not kept again', !(await ev(kept)));

    await backOut(page);
    check('the Back after that is the browser\'s: it leaves the page', await waitFor(`location.href==='about:blank'`, 5000));

    await open('/');
    check('the Board draws again', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await ev('window.__stay=true');
    await tapOn(titleOf(a));
    check('a card is selected again', await pickedIs(a));
    await waitFor(kept, 5000);
    await tapOn(titleOf(a));
    check('a tap that takes it out again empties the selection', await pickedIs(''));
    await backOut(page);
    check('the Back past the entry nothing wants any more leaves the page in one press', await waitFor(`location.href==='about:blank'`, 5000));
  },
};
