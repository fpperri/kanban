'use strict';
// The Graph's top on a 390 px phone: the drawing starts right under the header, the (i) and the
// option button float in its top-right corner, and the (i) shows and hides the count and the key.

module.exports = {
  async run(page) {
    const { ev, open, waitFor, centre, click, check } = page;
    await open('/?view=graph');
    check('the Graph draws at phone width', await waitFor(`!!graphCur&&document.querySelectorAll('.graph-node').length>0`, 10000));
    const rects = await ev(`(()=>{const g=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {t:r.top,b:r.bottom,r:r.right,l:r.left,h:r.height}};return {main:g('#graph-view .graph-main'),stage:g('#graph-view .graph-stage'),info:g('#graph-view .graph-info-toggle'),panel:g('#graph-view .view-panel-toggle')}})()`);
    check('the (i) and the option button sit in the drawing\'s top-right corner', !!rects.info && !!rects.panel && rects.main.r - rects.panel.r < 40 && rects.panel.t - rects.main.t < 50 && rects.info.r <= rects.panel.l + 1, rects);
    check('the drawing starts right under the top: no row above the stage', rects.stage.t - rects.main.t < 4, rects);
    const shown = () => ev(`document.querySelector('#graph-view .graph-info').getBoundingClientRect().height>0`);
    check('the count and the key are hidden by default', !(await shown()));
    const c = await centre('#graph-view .graph-info-toggle');
    await click(c.x, c.y);
    check('the (i) shows the count and the key', await waitFor(`document.querySelector('#graph-view .graph-info').getBoundingClientRect().height>0`, 4000));
    const c2 = await centre('#graph-view .graph-info-toggle');
    await click(c2.x, c2.y);
    check('the (i) hides them again', await waitFor(`document.querySelector('#graph-view .graph-info').getBoundingClientRect().height===0`, 4000));
  },
};
