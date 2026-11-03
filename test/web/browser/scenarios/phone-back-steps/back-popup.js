'use strict';
// Android Back on the phone layout closes a popup first, as Esc does, and leaves the selection under it.
// With touch on, 390 by 844: two cards tapped into the selection, and Status on the selection bar opens
// Set status...; one history.back() closes it, the selection stands and the page keeps its entry again,
// and the Back after steps the selection. Archive on the bar asks in the page: a Back answers the question
// no, the cards are not archived, and the Back after steps the selection. Each wait is for the page's state.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds, state.

const { tap, outwaitDoubleTap, backOut } = require('../../steps');
const { askUp, askGone, askText } = require('../../ask');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const kept = `!!history.state&&history.state.kanbanBack===true`;
    const stays = `window.__stay===true&&location.pathname==='/'`;
    const popupUp = `!document.getElementById('bulk-status').classList.contains('hidden')`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); if (!p) throw new Error(`nothing matches ${sel}`); await tap(page, p.x, p.y); };
    const back = () => ev('history.back()');
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const start = async (what) => {
      await open('/');
      check(`${what}: the Board draws`, await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
      await ev('window.__stay=true');
      const [a, b] = await ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0,2).map((e)=>e.dataset.id)`);
      await tapOn(titleOf(a));
      await outwaitDoubleTap();
      await tapOn(titleOf(b));
      const both = [a, b].sort((x, y) => x - y).join();
      check(`${what}: two taps select two cards`, await waitFor(`${picked}===${JSON.stringify(both)}`, 3000), await ev(picked));
      check(`${what}: the page keeps an entry of its own`, await waitFor(kept, 5000));
      return { a, b, both };
    };

    // --- Status on the bar opens a popup; Back closes it ------------------------------------------
    let { a, both } = await start('Status');
    const entries = await ev('history.length');
    await tapOn('#selection-bar-status');
    check('Status on the bar opens Set status...', await waitFor(popupUp, 3000));

    await back();
    check('a Back closes the popup', await waitFor(`!(${popupUp})`, 3000));
    check('the selection stands', await ev(`${picked}===${JSON.stringify(both)}`), await ev(picked));
    check('the page stays and is on its entry again, with no entry added', await ev(stays) && await waitFor(kept, 5000) && await ev('history.length') === entries, await ev('history.length'));

    await back();
    check('the next Back drops the additions and leaves the anchor', await waitFor(`${picked}===${JSON.stringify(a)}`, 3000), await ev(picked));
    check('and the page stays', await ev(stays));
    await back();
    check('the Back after drops the anchor', await waitFor(`${picked}===''`, 3000) && await ev(stays));
    await backOut(page);
    check('and the Back after that leaves the page', await waitFor(`location.href==='about:blank'`, 5000));

    // --- Archive on the bar asks in the page; Back answers it no -------------------------------------
    ({ a, both } = await start('Archive'));
    const before = await ev(`state.active.length`);
    await tapOn('#selection-bar-archive');
    check('Archive on the bar asks in the page', await askUp(page), await ev(`document.getElementById('ask').className`));
    check('the question names the cards', /^Archive 2 card\(s\)\?/.test(await askText(page)), await askText(page));

    await back();
    check('a Back answers the question no: it closes', await askGone(page));
    check('nothing was archived', await ev(`state.active.length`) === before, await ev(`state.active.length`));
    check('the selection stands', await ev(`${picked}===${JSON.stringify(both)}`), await ev(picked));
    check('the package popup did not open', await ev(`document.getElementById('bulk-archive').classList.contains('hidden')`));
    check('the page stays and is on its entry again', await ev(stays) && await waitFor(kept, 5000));

    await back();
    check('the next Back steps the selection back', await waitFor(`${picked}===${JSON.stringify(a)}`, 3000) && await ev(stays), await ev(picked));
  },
};
