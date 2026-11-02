'use strict';
// Android Back and the Archive question over the card details on the phone layout. With touch on, 390 by
// 844: a double tap opens a card, Archive on its details asks in the page, and one history.back() answers
// the question no and leaves the details open. The Back after closes the details; with a card selected
// first, the Back after that steps the selection, and without one it leaves the page. Each wait is for the
// page's state.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds, state.

const { tap, doubleTap, outwaitDoubleTap, backOut } = require('../../steps');
const { askUp, askGone } = require('../../ask');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const kept = `!!history.state&&history.state.kanbanBack===true`;
    const stays = `window.__stay===true&&location.pathname==='/'`;
    const detailUp = `!document.querySelector('#detail-modal').classList.contains('hidden')&&new URLSearchParams(location.search).has('card')`;
    const detailShut = `document.querySelector('#detail-modal').classList.contains('hidden')&&!new URLSearchParams(location.search).has('card')`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); if (!p) throw new Error(`nothing matches ${sel}`); await tap(page, p.x, p.y); };
    const back = () => ev('history.back()');
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const start = async (what) => {
      await open('/');
      check(`${what}: the Board draws`, await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
      await ev('window.__stay=true');
      return ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0,3).map((e)=>e.dataset.id)`);
    };
    const askOverDetails = async (what, id) => {
      const p = await pointOf(titleOf(id));
      await outwaitDoubleTap();
      await doubleTap(page, p.x, p.y);
      check(`${what}: a double tap opens the card`, await waitFor(detailUp, 3000));
      await tapOn('#detail-archive-btn');
      check(`${what}: Archive on the details asks in the page`, await askUp(page));
      check(`${what}: the page keeps an entry of its own for the question`, await waitFor(kept, 5000));
    };

    // --- nothing selected: the question, the details, then the page ----------------------------------
    let [, , c] = await start('with nothing selected');
    const before = await ev('state.active.length');
    await askOverDetails('with nothing selected', c);
    await back();
    check('a Back answers the question no', await askGone(page));
    check('the card stays open and is not archived', await ev(detailUp) && await ev('state.active.length') === before && await ev(stays));
    await back();
    check('the Back after closes the details', await waitFor(detailShut, 3000) && await ev(stays));
    await backOut(page);
    check('and the Back after that leaves the page', await waitFor(`location.href==='about:blank'`, 5000));

    // --- a selection behind the details ----------------------------------------------------------------
    let a;
    [a, , c] = await start('with a selection');
    await tapOn(titleOf(a));
    check('a tap selects a card', await waitFor(`${picked}===${JSON.stringify(a)}`, 3000));
    await askOverDetails('with a selection', c);
    await back();
    check('a Back answers the question no', await askGone(page));
    check('the card stays open and the selection stands', await ev(detailUp) && await ev(`${picked}===${JSON.stringify(a)}`) && await ev(stays));
    await back();
    check('the Back after closes the details', await waitFor(detailShut, 3000) && await ev(stays));
    check('and the selection stands', await ev(`${picked}===${JSON.stringify(a)}`));
    await back();
    check('the Back after steps the selection', await waitFor(`${picked}===''`, 3000) && await ev(stays), await ev(picked));
    await backOut(page);
    check('and the Back after that leaves the page', await waitFor(`location.href==='about:blank'`, 5000));
  },
};
