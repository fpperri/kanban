'use strict';
// A two-finger pinch zooms the Map. The Map redraws at the new size once the fingers lift, no card opens, and one finger
// still scrolls it.

const { pinch, swipe } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    await open('/?view=map');
    check('the Map draws on the phone', await waitFor(`document.querySelectorAll('#map-view .map-canvas').length>0&&document.querySelectorAll('#map-view .map-trees .map-canvas').length===document.querySelectorAll('#map-view .map-canvas').length`, 10000));
    const drawnWidth = () => ev(`document.querySelector('#map-view .map-canvas').getBoundingClientRect().width`);
    const before = await drawnWidth();
    const centre = await ev(`(() => { const m = document.querySelector('#map-view .map-main').getBoundingClientRect(); const c = document.querySelector('#map-view .map-canvas').getBoundingClientRect(); const l = Math.max(m.left, c.left), r = Math.min(m.right, c.right), t = Math.max(m.top, c.top), b = Math.min(m.bottom, c.bottom); return { x: Math.round((l + r) / 2), y: Math.round((t + b) / 2) }; })()`);
    const selected = () => ev(`document.querySelectorAll('.card-el.selected').length+'/'+document.querySelectorAll('.modal:not(.hidden), #detail-modal:not(.hidden)').length`);
    const quiet = await selected();

    await pinch(page, centre, { from: 80, to: 200 });
    check('a pinch outward draws the Map larger once the fingers lift', await waitFor(`document.querySelector('#map-view .map-canvas').getBoundingClientRect().width>${before}*1.2`), { before, after: await drawnWidth() });
    check('and the pinch left the transform cleared', await ev(`!document.querySelector('#map-view .map-trees').style.transform`));
    check('and opened no card and selected none', (await selected()) === quiet, await selected());

    const after = await drawnWidth();
    await pinch(page, centre, { from: 200, to: 80 });
    check('a pinch inward draws it smaller again', await waitFor(`document.querySelector('#map-view .map-canvas').getBoundingClientRect().width<${after}*0.8`), { after, now: await drawnWidth() });

    const scrollAt = () => ev(`(() => { const m = document.querySelector('#map-view .map-main'); return m.scrollLeft + ',' + m.scrollTop; })()`);
    const start = await scrollAt();
    await swipe(page, { x: centre.x + 60, y: centre.y + 60 }, { x: centre.x - 60, y: centre.y - 60 });
    check('one finger still scrolls the Map', await waitFor(`(() => { const m = document.querySelector('#map-view .map-main'); return m.scrollLeft + ',' + m.scrollTop; })()!==${JSON.stringify(start)}`), { start, now: await scrollAt() });
    check('and that drag opened no card', (await selected()) === quiet, await selected());
  },
};
