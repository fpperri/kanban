'use strict';
// A window crossing the phone width line 390, 800, 390 on the Calendar and the Gantt: under the line the
// header slot shows the date range and the view's own title is hidden; from 760 px the view's title shows
// and the slot does not.

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    const shown = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e&&e.offsetWidth>0})()`;
    for (const view of ['calendar', 'gantt']) {
      await ev(`document.querySelector('#${view}-toggle-btn').click()`);
      for (const [width, phone] of [[390, true], [800, false], [390, true]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
        check(`the ${view} at ${width}: header slot ${phone ? 'shows' : 'hidden'}, title in the view's row ${phone ? 'hidden' : 'shows'}`,
          await waitFor(`innerWidth===${width}&&${shown('#header-date')}===${phone}&&${shown(`#${view}-view .cal-title`)}===${!phone}`, 10000),
          await ev('innerWidth'));
      }
    }
  },
};
