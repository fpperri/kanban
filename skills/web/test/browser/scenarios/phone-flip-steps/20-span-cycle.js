'use strict';
// A window crossing the phone width line 390, 800, 390 on the Calendar and the Gantt: under the line the
// span cycle button shows and the span switch is hidden; from 760 px the full span switch shows and the
// cycle button does not.

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    const shown = (view, cls) => `(()=>{const e=document.querySelector('#${view}-view ${cls}');return !!e&&e.offsetWidth>0})()`;
    for (const view of ['calendar', 'gantt']) {
      await ev(`document.querySelector('#${view}-toggle-btn').click()`);
      for (const [width, cycle] of [[390, true], [800, false], [390, true]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
        check(`the ${view} at ${width}: cycle button ${cycle ? 'shows' : 'hidden'}, span switch ${cycle ? 'hidden' : 'shows'}`,
          await waitFor(`innerWidth===${width}&&${shown(view, '.cal-span-cycle')}===${cycle}&&${shown(view, '.cal-subview-switch')}===${!cycle}`, 10000),
          await ev('innerWidth'));
      }
    }
  },
};
