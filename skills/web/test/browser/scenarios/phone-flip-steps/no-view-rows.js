'use strict';
// At 1440 on the plan board the Map, the Calendar and the Gantt hold no status pill: their pills live
// only in the search panel's Statuses section, and the Map's bar keeps only its option button.

const WIDTH = 1440;

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
    await open('/');
    check('the Board draws at 1440', await waitFor(`innerWidth===${WIDTH}&&document.querySelectorAll('#board .column .card-el').length>0`, 10000), await ev('innerWidth'));
    const noPill = (view) => `document.querySelectorAll('#${view}-view .status-pill, #${view}-view [class*="-filter-toggle"], #${view}-view [class*="-filter-row"]').length===0`;
    for (const view of ['map', 'calendar', 'gantt']) {
      await ev(`document.getElementById('${view}-toggle-btn').click()`);
      check(`the ${view} view is drawn`, await waitFor(`!document.getElementById('${view}-view').classList.contains('hidden')&&document.getElementById('${view}-view').children.length>0`, 10000));
      check(`#${view}-view holds no status pill`, await ev(noPill(view)));
      check(`the Statuses section still holds the pills over the ${view}`, await ev(`document.querySelectorAll('#search-statuses .status-pill').length>0`));
      if (view === 'map') check('the Map\'s bar holds only the option button', await ev(`[...document.querySelectorAll('#map-view .view-bar > *')].map((e)=>e.className).join()==='view-panel-toggle'`));
      await ev(`document.getElementById('${view}-toggle-btn').click()`);
    }
  },
};
