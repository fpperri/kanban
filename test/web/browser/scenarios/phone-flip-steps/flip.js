'use strict';
// A window crossing the phone width line 390, 800, 390 with no reload: the status tabs come back
// with the same active status, and the view bar is back.

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    const tabs = `[...document.querySelectorAll('#board-tabs .board-tab')]`;
    const selected = `${tabs}.filter((t) => t.getAttribute('aria-selected')==='true').map((t) => t.dataset.col)`;
    const barShown = `(()=>{const b=document.getElementById('view-bar');const r=b.getBoundingClientRect();return getComputedStyle(b).display!=='none'&&r.width>0&&r.height>0})()`;
    const resize = (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });

    await open('/');
    check('at 390 the status tabs and the view bar show', await waitFor(`innerWidth===390&&${tabs}.length>1&&${barShown}`, 10000));
    const second = await ev(`${tabs}[1].dataset.col`);
    await ev(`document.querySelector('#board-tabs .board-tab[data-col="${second}"]').click()`);
    check('a status tab is chosen', await waitFor(`JSON.stringify(${selected})===JSON.stringify(['${second}'])`), await ev(selected));
    await ev(`window.__noReload=true`);

    await resize(800);
    check('at 800 the tabs and the view bar are gone', await waitFor(`innerWidth===800&&${tabs}.length===0&&!(${barShown})`, 10000));
    await resize(390);
    check('back at 390 the tabs are back with the same active status and the view bar shows', await waitFor(`innerWidth===390&&JSON.stringify(${selected})===JSON.stringify(['${second}'])&&${barShown}`, 10000), await ev(selected));
    check('the page was not reloaded', await ev(`window.__noReload===true`));
  },
};
