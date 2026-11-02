'use strict';
// Android Back and the card's details on the phone layout. The details' history steps work as they do
// without a selection: Back closes the card, then leaves the page. With a selection they work in both
// orders: a selection and then a card, where Back closes the card and the Back after steps the selection;
// and a card and then a selection made from the details' own menu, where Back closes a menu first and
// then the card, whatever the selection behind it. Each wait is for the page's state.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds.

const { tap, doubleTap, outwaitDoubleTap, realWait, backOut } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const kept = `!!history.state&&history.state.kanbanBack===true`;
    const stays = `window.__stay===true&&location.pathname==='/'`;
    const menuOpen = `!document.getElementById('context-menu').classList.contains('hidden')`;
    const detailUp = `!document.querySelector('#detail-modal').classList.contains('hidden')&&new URLSearchParams(location.search).has('card')`;
    const detailShut = `document.querySelector('#detail-modal').classList.contains('hidden')&&!new URLSearchParams(location.search).has('card')`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); await tap(page, p.x, p.y); };
    const doubleTapOn = async (sel) => { const p = await pointOf(sel); await outwaitDoubleTap(); await doubleTap(page, p.x, p.y); };
    const back = () => ev('history.back()');
    // A real press of the right button on the details: the browser counts it as a user activation, which
    // a contextmenu event dispatched from the page is not, and the page makes its entry only after one.
    const detailsMenu = async () => {
      const p = await pointOf('#detail-modal .modal');
      await page.mouse('mousePressed', p.x, p.y, { button: 'right', buttons: 2 });
      await page.mouse('mouseReleased', p.x, p.y, { button: 'right', buttons: 2 });
    };
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const start = async (what) => {
      await open('/');
      check(`${what}: the Board draws`, await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
      await ev('window.__stay=true');
      return ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0,3).map((e)=>e.dataset.id)`);
    };

    // --- nothing selected: as it always was -------------------------------------------------------
    let [a, , c] = await start('with nothing selected');
    await doubleTapOn(titleOf(c));
    check('a double tap opens the card', await waitFor(detailUp, 3000));
    await back();
    check('a Back closes the card', await waitFor(detailShut, 3000) && await ev(stays));
    await backOut(page);
    check('and the Back after that leaves the page', await waitFor(`location.href==='about:blank'`, 5000));

    // --- a selection, then a card -----------------------------------------------------------------
    [a, , c] = await start('with a selection first');
    await tapOn(titleOf(a));
    check('a tap selects a card', await waitFor(`${picked}===${JSON.stringify(a)}`, 3000));
    check('the page keeps an entry of its own', await waitFor(kept, 5000));
    const steps = await ev('history.length');
    await doubleTapOn(titleOf(c));
    check('a double tap opens another card', await waitFor(detailUp, 3000));
    check('and leaves the selection', await ev(`${picked}===${JSON.stringify(a)}`));
    check('the card adds its step to the history, and nothing else', await ev('history.length') === steps + 1, await ev('history.length'));
    await back();
    check('a Back closes the card', await waitFor(detailShut, 3000) && await ev(stays));
    check('and leaves the selection', await ev(`${picked}===${JSON.stringify(a)}`));
    check('the entry is the page\'s own again', await waitFor(kept, 5000));
    await back();
    check('the Back after steps the selection back', await waitFor(`${picked}===''`, 3000) && await ev(stays));
    await backOut(page);
    check('and the Back after that leaves the page', await waitFor(`location.href==='about:blank'`, 5000));

    // --- a card, then a selection from the details' menu --------------------------------------------
    [, , c] = await start('with a card first');
    await doubleTapOn(titleOf(c));
    check('a double tap opens the card', await waitFor(detailUp, 3000));
    await detailsMenu();
    check('the details\' menu opens', await waitFor(menuOpen, 3000));
    check('the page keeps an entry of its own for it', await waitFor(kept, 5000));
    await back();
    check('a Back closes the menu and not the card', await waitFor(`!(${menuOpen})`, 3000) && await ev(detailUp));
    await realWait(700);
    check('no entry is kept with nothing but the card open', !(await ev(kept)));
    await detailsMenu();
    check('the menu opens again', await waitFor(menuOpen, 3000));
    check('and the press that opened it, the first since the Back, makes the page\'s entry', await waitFor(kept, 5000));
    const add = await pointOf('#ctx-add');
    await tap(page, add.x, add.y);
    check('Add to selection puts the card in the selection and closes the menu', await waitFor(`${picked}===${JSON.stringify(c)}&&!(${menuOpen})`, 3000), await ev(picked));
    await back();
    check('a Back closes the card, not the selection behind it', await waitFor(detailShut, 3000) && await ev(stays));
    check('the selection stands', await ev(`${picked}===${JSON.stringify(c)}`));
    check('and has an entry of the page\'s own', await waitFor(kept, 5000));
    await back();
    check('the Back after steps the selection back', await waitFor(`${picked}===''`, 3000) && await ev(stays));
    await backOut(page);
    check('and the Back after that leaves the page', await waitFor(`location.href==='about:blank'`, 5000));
  },
};
