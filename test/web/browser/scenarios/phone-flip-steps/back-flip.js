'use strict';
// Back's step is the phone layout's, and the width line decides it: at 800 a selection and an
// open card menu add no history entry, with no touch; narrowed to 390 the selection standing there has an
// entry of the page's own, and a history.back() steps it back. No reload.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds.

const { realWait } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, rightClick, check } = page;
    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const kept = `!!history.state&&history.state.kanbanBack===true`;
    const menuOpen = `!document.getElementById('context-menu').classList.contains('hidden')`;
    const resize = (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    const cardAt = async (n) => {
      const sel = `#board .column .card-el:nth-of-type(${n}) .card-title`;
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`);
      return centre(sel);
    };

    await open('/');
    check('at 390 the Board draws', await waitFor(`innerWidth===390&&document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await ev('window.__noReload=true');
    await resize(800);
    check('at 800 the Board draws as the desk\'s', await waitFor(`innerWidth===800&&document.querySelectorAll('#board-tabs .board-tab').length===0&&document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    const [a, b] = await ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0,2).map((e)=>e.dataset.id)`);
    const both = [a, b].sort((x, y) => x - y).join();
    const entries = await ev('history.length');

    const first = await cardAt(1);
    await click(first.x, first.y, { modifiers: 2 });
    const second = await cardAt(2);
    await click(second.x, second.y, { modifiers: 2 });
    check('at 800 Ctrl+click selects two cards', await waitFor(`${picked}===${JSON.stringify(both)}`, 3000), await ev(picked));
    await rightClick('#board .column .card-el:nth-of-type(2) .card-title');
    check('and a right-click opens the card menu', await waitFor(menuOpen, 3000));
    await realWait(900);
    check('at 800 the selection and the menu add no history entry', await ev('history.length') === entries && !(await ev(kept)), await ev('history.length'));

    await key('Escape');
    check('Esc closes the menu', await waitFor(`!(${menuOpen})`, 3000));
    await resize(390);
    check('narrowed to 390 the Board is the phone\'s and the selection stands', await waitFor(`innerWidth===390&&document.querySelectorAll('#board-tabs .board-tab').length>1&&${picked}===${JSON.stringify(both)}`, 10000), await ev(picked));
    check('the page keeps an entry of its own for it', await waitFor(kept, 5000) && await ev('history.length') === entries + 1, await ev('history.length'));
    await ev('history.back()');
    check('and a Back steps the selection back, the anchor staying', await waitFor(`${picked}===${JSON.stringify(a)}`, 3000), await ev(picked));
    check('the page was not reloaded', await ev(`window.__noReload===true`));
  },
};
