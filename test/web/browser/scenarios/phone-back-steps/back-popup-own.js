'use strict';
// Android Back on the phone layout closes the popups that take Esc in a listener of their own, as Esc
// does, and leaves the selection under them. On the feature board, with touch on, 390 by 844: two cards
// tapped into the selection, and More, Group, Make a group from them opens the group dialog; its date
// button opens the date picker over it. One history.back() closes the picker alone and leaves the dialog,
// the next closes the dialog, the selection stands through both and the page keeps its entry, and the Back
// after steps the selection. Then, with one card selected, More, Add note opens the notes palette for it: a
// Back clears its chip and leaves it up, the next closes it, and the Back after steps the selection. Each
// wait is for the page's state.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds, notesUi.

const { tap, outwaitDoubleTap, backOut } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const kept = `!!history.state&&history.state.kanbanBack===true`;
    const stays = `window.__stay===true&&location.pathname==='/'`;
    const menuOpen = `!document.getElementById('context-menu').classList.contains('hidden')`;
    const dialogUp = `!document.getElementById('group-dialog').classList.contains('hidden')`;
    const pickerUp = `(()=>{const p=document.querySelector('.date-picker-pop');return !!p&&!p.hidden})()`;
    const paletteUp = `(()=>{const p=document.getElementById('notes-palette');return !!p&&!p.classList.contains('hidden')})()`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); if (!p) throw new Error(`nothing matches ${sel}`); await tap(page, p.x, p.y); };
    const back = () => ev('history.back()');
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const start = async (what, count = 2) => {
      await open('/', 'feature');
      check(`${what}: the Board draws`, await waitFor(`document.querySelectorAll('#board .column .card-el').length>=2`, 10000));
      await ev('window.__stay=true');
      const [a, b] = await ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0,2).map((e)=>e.dataset.id)`);
      await tapOn(titleOf(a));
      if (count === 2) {
        await outwaitDoubleTap();
        await tapOn(titleOf(b));
      }
      const both = (count === 2 ? [a, b] : [a]).sort((x, y) => x - y).join();
      check(`${what}: ${count === 1 ? 'a tap selects a card' : 'two taps select two cards'}`, await waitFor(`${picked}===${JSON.stringify(both)}`, 3000), await ev(picked));
      check(`${what}: the page keeps an entry of its own`, await waitFor(kept, 5000));
      await outwaitDoubleTap();
      return { a, both };
    };
    const steps = async (what, a) => {
      await back();
      check(`${what}: the next Back drops the additions and leaves the anchor`, await waitFor(`${picked}===${JSON.stringify(a)}`, 3000) && await ev(stays), await ev(picked));
    };

    // --- the group dialog, and the date picker over it ---------------------------------------------
    let { a, both } = await start('group dialog');
    const entries = await ev('history.length');
    await tapOn('#selection-bar-more');
    check('More opens the card menu', await waitFor(menuOpen, 3000));
    await tapOn('#ctx-group');
    check('Group opens its panel', await waitFor(`getComputedStyle(document.getElementById('ctx-group-make')).display!=='none'`, 3000));
    await tapOn('#ctx-group-make');
    check('Make a group from them opens the dialog', await waitFor(dialogUp, 3000));
    await tapOn('#group-dialog .date-pick-btn');
    check('its date button opens the date picker over it', await waitFor(pickerUp, 3000));

    await back();
    check('a Back closes the date picker alone', await waitFor(`!(${pickerUp})`, 3000) && await ev(dialogUp));
    check('the selection stands, the page stays and is on its entry again', await ev(`${picked}===${JSON.stringify(both)}`) && await ev(stays) && await waitFor(kept, 5000), await ev(picked));

    await back();
    check('the next Back closes the group dialog', await waitFor(`!(${dialogUp})`, 3000) && await ev(`!(${pickerUp})`));
    check('the selection stands and no entry was added', await ev(`${picked}===${JSON.stringify(both)}`) && await ev(stays) && await waitFor(kept, 5000) && await ev('history.length') === entries, await ev('history.length'));
    await steps('group dialog', a);
    await back();
    check('the Back after drops the anchor', await waitFor(`${picked}===''`, 3000) && await ev(stays));
    await backOut(page);
    check('and the Back after that leaves the page', await waitFor(`location.href==='about:blank'`, 5000));

    // --- the notes palette ---------------------------------------------------------------------------
    ({ a, both } = await start('notes palette', 1));
    await tapOn('#selection-bar-more');
    check('More opens the card menu', await waitFor(menuOpen, 3000));
    await tapOn('#ctx-note');
    check('Add note opens the palette for the card', await waitFor(paletteUp, 3000) && await ev(`notesUi.sub.kind==='card'`), await ev(`JSON.stringify(notesUi.sub)`));

    await back();
    check('a Back clears the palette\'s chip and leaves it up', await waitFor(`notesUi.sub!==null&&notesUi.sub.kind==='none'`, 3000) && await ev(paletteUp), await ev(`JSON.stringify(notesUi.sub)`));
    check('the selection stands and the page is on its entry again', await ev(`${picked}===${JSON.stringify(both)}`) && await ev(stays) && await waitFor(kept, 5000), await ev(picked));

    await back();
    check('the next Back closes the palette', await waitFor(`notesUi.sub===null`, 3000) && await ev(`!(${paletteUp})`));
    check('the selection stands, the page stays and keeps its entry', await ev(`${picked}===${JSON.stringify(both)}`) && await ev(stays) && await waitFor(kept, 5000), await ev(picked));
    await back();
    check('the Back after drops the anchor', await waitFor(`${picked}===''`, 3000) && await ev(stays));
  },
};
