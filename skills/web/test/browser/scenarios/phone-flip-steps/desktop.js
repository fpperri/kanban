'use strict';
// The Web at 1440 by 900: the Statuses section is in the search panel, and the (i) and the floating
// option buttons are present. No phone part is displayed: the status tabs, the view bar, the card
// back button, the span cycle buttons, the header date, the More button and the phone search button.

const WIDTH = 1440;

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
    await open('/');
    check('the Board draws at 1440', await waitFor(`innerWidth===${WIDTH}&&document.querySelectorAll('#board .column .card-el').length>0`, 10000), await ev('innerWidth'));
    const displayed = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e)=>{const r=e.getBoundingClientRect();return getComputedStyle(e).display!=='none'&&r.width>0&&r.height>0}).length`;
    const PARTS = ['#board-tabs', '#view-bar', '#detail-back-btn', '.cal-span-cycle', '#header-date', '#more-btn', '#search-btn'];
    const noPhone = async (where) => {
      for (const sel of PARTS) check(`${where}: ${sel} is not displayed`, await ev(displayed(sel)) === 0, await ev(displayed(sel)));
    };
    await noPhone('Board');
    for (const view of ['calendar', 'gantt', 'map', 'graph']) {
      await ev(`document.getElementById('${view}-toggle-btn').click()`);
      check(`the ${view} is drawn`, await waitFor(`!document.getElementById('${view}-view').classList.contains('hidden')&&document.getElementById('${view}-view').children.length>0`, 10000));
      check(`${view}: the Statuses section is in the search panel`, await ev(`!!document.querySelector('#search-panel #search-statuses-section #search-statuses .status-pill')`));
      await noPhone(view);
      if (view === 'map' || view === 'graph') {
        check(`the ${view} has its option button`, await ev(`document.querySelectorAll('#${view}-view .view-panel-toggle').length>0`));
      }
      if (view === 'graph') check('the Graph has its (i)', await ev(`document.querySelectorAll('#graph-view .graph-info-toggle').length>0`));
      await ev(`document.getElementById('${view}-toggle-btn').click()`);
    }
  },
};
