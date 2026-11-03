'use strict';
// Android Back on the phone layout closes the card menu a long press opened, then drops the light, then
// steps the selection back, one step per history.back(), the page staying where it is. With a card in
// the selection and with none: the light alone keeps the page's entry. An open panel of the menu (Explore)
// closes alone, before the menu. Each wait is for the page's state.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): pinnedLitId, selectedIds.

const { tap, holdDown, liftUp, backOut } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const kept = `!!history.state&&history.state.kanbanBack===true`;
    const stays = `window.__stay===true&&location.pathname==='/'`;
    const menuOpen = `!document.getElementById('context-menu').classList.contains('hidden')`;
    const held = (id) => `pinnedLitId===${JSON.stringify(String(id))}`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); await tap(page, p.x, p.y); };
    const back = () => ev('history.back()');
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const longPressOn = async (id) => {
      const p = await pointOf(titleOf(id));
      await holdDown(page, p.x, p.y);
      const lit = await waitFor(held(id), 4000);
      await liftUp(page);
      return lit && await waitFor(menuOpen, 4000);
    };
    const start = async (what) => {
      await open('/');
      check(`${what}: the Board draws`, await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
      await ev('window.__stay=true');
      return ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0,2).map((e)=>e.dataset.id)`);
    };

    // --- a selection, a light and a menu ----------------------------------------------------------
    const [a, b] = await start('with a selection');
    await tapOn(titleOf(a));
    check('a tap selects a card', await waitFor(`${picked}===${JSON.stringify(a)}`, 3000));
    check('a long press on another lights it and opens its menu', await longPressOn(b));
    check('the page keeps an entry of its own', await waitFor(kept, 5000));
    const entries = await ev('history.length');

    await back();
    check('a Back closes the menu', await waitFor(`!(${menuOpen})`, 3000));
    check('and leaves the light and the selection', await ev(`${held(b)}&&${picked}===${JSON.stringify(a)}`), await ev(`pinnedLitId+'|'+${picked}`));
    check('the page stays and is on its entry again, which the page went forward to: no entry was added', await ev(stays) && await waitFor(kept, 5000) && await ev('history.length') === entries, await ev('history.length'));

    await back();
    check('the next Back drops the light', await waitFor(`pinnedLitId===null`, 3000));
    check('and leaves the selection', await ev(`${picked}===${JSON.stringify(a)}`), await ev(picked));
    check('the page stays and is on its entry again, with no entry added', await ev(stays) && await waitFor(kept, 5000) && await ev('history.length') === entries, await ev('history.length'));

    await back();
    check('the next Back steps the selection back', await waitFor(`${picked}===''`, 3000));
    check('the page stays', await ev(stays));

    await backOut(page);
    check('and the Back after that is the browser\'s: it leaves the page', await waitFor(`location.href==='about:blank'`, 5000));

    // --- a light and a menu alone -----------------------------------------------------------------
    const [c] = await start('with nothing selected');
    check('a long press lights a card and opens its menu', await longPressOn(c));
    check('the page keeps an entry of its own for the light', await waitFor(kept, 5000));
    const explore = `document.getElementById('ctx-explore').closest('.ctx-sub').classList.contains('open')`;
    await tapOn('#ctx-explore');
    check('a tap on Explore opens its panel', await waitFor(explore, 3000));
    await back();
    check('a Back closes the panel alone: the menu and the light stand', await waitFor(`!(${explore})`, 3000) && await ev(`${menuOpen}&&${held(c)}`));
    check('the page stays and keeps its entry again', await ev(stays) && await waitFor(kept, 5000));
    await back();
    check('a Back closes the menu', await waitFor(`!(${menuOpen})`, 3000) && await ev(held(c)));
    check('the page stays and keeps its entry again', await ev(stays) && await waitFor(kept, 5000));
    await back();
    check('the next Back drops the light', await waitFor(`pinnedLitId===null`, 3000) && await ev(stays));

    await backOut(page);
    check('and the Back after that leaves the page', await waitFor(`location.href==='about:blank'`, 5000));
  },
};
