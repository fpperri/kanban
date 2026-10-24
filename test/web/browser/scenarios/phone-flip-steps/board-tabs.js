'use strict';
// A window crossing the phone width line 390, 800, 390: the status tabs come back with the same
// active status, and at 800 every column shows.

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    const tabs = `[...document.querySelectorAll('#board-tabs .board-tab')]`;
    const shown = `[...document.querySelectorAll('#board .column')].map((c) => c.dataset.col)`;
    const selected = `${tabs}.filter((t) => t.getAttribute('aria-selected')==='true').map((t) => t.dataset.col)`;
    const resize = (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });

    await open('/');
    check('at 390 the tabs show and one status shows', await waitFor(`innerWidth===390&&${tabs}.length>1&&(${shown}).length===1`, 10000), await ev(shown));
    const second = await ev(`${tabs}[1].dataset.col`);
    await ev(`document.querySelector('#board-tabs .board-tab[data-col="${second}"]').click()`);
    check('a tab is chosen', await waitFor(`JSON.stringify(${selected})===JSON.stringify(['${second}'])`), await ev(selected));

    await resize(800);
    check('at 800 the columns show', await waitFor(`innerWidth===800&&(${shown}).length>2&&${tabs}.length===0`, 10000), await ev(shown));

    await resize(390);
    check('back at 390 the tabs are back with the same active status', await waitFor(`innerWidth===390&&JSON.stringify(${selected})===JSON.stringify(['${second}'])&&JSON.stringify(${shown})===JSON.stringify(['${second}'])`, 10000), await ev(`({sel:${selected},shown:${shown}})`));
  },
};
