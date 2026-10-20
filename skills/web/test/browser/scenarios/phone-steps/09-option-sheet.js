'use strict';
// Under 760 px the Graph's option panel opens as a bottom sheet over the lower part of the view:
// full width, anchored to the view's bottom, no taller than about half of it, nothing dimmed behind
// it, so the drawing above stays visible while an option is picked. Its close button closes it.

const view = '#graph-view';
const panel = `${view} .view-panel`;

module.exports = {
  async run(page) {
    const { ev, open, waitFor, centre, click, check } = page;
    await open('/?view=graph');
    check('the Graph draws', await waitFor(`!!document.querySelector('${view} .graph-stage svg, ${view} .graph-canvas')`, 10000));
    const toggle = await centre(`${view} .view-panel-toggle`);
    await click(toggle.x, toggle.y);
    check('the icon button opens the panel', await waitFor(`!!document.querySelector('${panel}')`));
    const m = await ev(`(()=>{const v=document.querySelector('${view}').getBoundingClientRect();const p=document.querySelector('${panel}').getBoundingClientRect();`
      + `const s=document.querySelector('${view} .graph-stage').getBoundingClientRect();`
      + `const above=document.elementFromPoint(s.left+s.width/2,s.top+4);`
      + `return {pb:p.bottom,vb:v.bottom,pw:p.width,vw:v.width,ph:p.height,vh:v.height,pt:p.top,st:s.top,aboveInStage:!!(above&&above.closest('${view} .graph-stage')),`
      + `backdrop:!!document.querySelector('.backdrop, .view-panel-backdrop, [class*="backdrop"]')}})()`);
    check('the open panel\'s bottom equals the view\'s bottom', Math.abs(m.pb - m.vb) <= 1, m);
    check('its width equals the view\'s', Math.abs(m.pw - m.vw) <= 1, m);
    check('its height is at most 55% of the view', m.ph <= m.vh * 0.55, m);
    check('the drawing above it is visible, and nothing is dimmed', m.pt > m.st && m.aboveInStage && !m.backdrop, m);
    const close = await centre(`${panel} .view-panel-close`);
    await click(close.x, close.y);
    check('the close button closes it', await waitFor(`!document.querySelector('${panel}')`));
  },
};
