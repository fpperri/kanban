'use strict';
// A window crossing the phone width line 390, 800, 390: the Board still draws at each width.

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    const drawn = `document.querySelectorAll('#board .column .card-el').length>0`;
    await open('/');
    check('the Board draws at 390', await waitFor(`innerWidth===390&&${drawn}`, 10000), await ev('innerWidth'));
    for (const width of [800, 390]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
      check(`the Board still draws at ${width}`, await waitFor(`innerWidth===${width}&&${drawn}`, 10000), await ev('innerWidth'));
    }
  },
};
