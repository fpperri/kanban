'use strict';
// The selection bar follows the width line, not touch: with a mouse at 390 two clicks on cards select them and the
// bar shows reading 2 selected; the window widened to 800 draws no bar and keeps no room for one, and the two
// cards stay selected; narrowed again the bar is back with the same count. No reload.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds.

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, centre, click, check } = page;
    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const BAR = `document.getElementById('selection-bar')`;
    const resize = (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    const clickCard = async (n) => {
      const sel = `#board .column .card-el:nth-of-type(${n}) .card-title`;
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`);
      const p = await centre(sel);
      await click(p.x, p.y);
    };
    const drawn = `getComputedStyle(${BAR}).display!=='none'&&${BAR}.getBoundingClientRect().height>0`;

    await open('/');
    check('at 390 the Board draws', await waitFor(`innerWidth===390&&document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await ev(`window.__noReload=true`);
    check('with nothing selected the bar is not drawn', !(await ev(drawn)));
    await clickCard(1);
    await clickCard(2);
    check('two clicks select two cards', await waitFor(`selectedIds.size===2`, 3000), await ev(picked));
    check('the bar is drawn, reading 2 selected', await waitFor(`${drawn}&&document.getElementById('selection-bar-count').textContent==='2 selected'`, 3000));

    await resize(800);
    check('at 800 the bar is not drawn, with two cards still selected', await waitFor(`innerWidth===800&&!(${drawn})`, 10000) && await ev(`selectedIds.size===2`), await ev(picked));
    check('and no room is kept for it', (await ev(`getComputedStyle(document.documentElement).getPropertyValue('--selection-bar-h').trim()`)) === '');

    await resize(390);
    check('back at 390 the bar is drawn again with the same count', await waitFor(`innerWidth===390&&${drawn}&&document.getElementById('selection-bar-count').textContent==='2 selected'`, 10000));
    check('the page was not reloaded', await ev(`window.__noReload===true`));
  },
};
