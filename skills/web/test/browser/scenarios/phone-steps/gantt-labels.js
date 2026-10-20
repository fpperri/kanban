'use strict';
// The Gantt's label column on a phone (390 by 844, touch on): ids with their status dots, a gutter
// 64 to 96 px wide, a status heading that is not clipped, the bar's title kept, and a tap on an id
// opens the card. Above the width line (800) the gutter is 200 px with full labels. The plan board's
// two dated cards (28 and 29) are the Gantt's All sub-view.

const { tap } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    const drawn = `document.querySelectorAll('#gantt-view .gantt-label').length>0`;
    const gutterWidth = `document.querySelector('#gantt-view .gantt-gutter').getBoundingClientRect().width`;
    await open('/?view=gantt');
    check('the Gantt draws at 390', await waitFor(`innerWidth===390&&${drawn}`, 10000), await ev('innerWidth'));

    const w = await ev(gutterWidth);
    check('the gutter is 64 to 96 px wide', w >= 64 && w <= 96, w);
    check('each label shows its id and a status dot', await ev(`[...document.querySelectorAll('#gantt-view .gantt-label')].every(l=>l.querySelector('.gantt-label-id')&&l.querySelector('.status-dot'))`));
    check('the label title is hidden', await ev(`[...document.querySelectorAll('#gantt-view .gantt-label-title')].every(t=>getComputedStyle(t).display==='none')`));
    check('a status heading is not clipped', await ev(`[...document.querySelectorAll('#gantt-view .gantt-gutter .gantt-group-row')].every(h=>h.scrollWidth<=h.clientWidth||getComputedStyle(h).overflow==='visible')`));
    check('a status heading reads in full, running on past the gutter', await ev(`(()=>{const h=document.querySelector('#gantt-view .gantt-gutter .gantt-group-row');if(!h)return false;const r=document.createRange();r.selectNodeContents(h);const b=r.getBoundingClientRect();return b.width>0&&b.right>h.parentElement.getBoundingClientRect().left&&b.width>=h.textContent.trim().length*3})()`));
    check('a bar keeps its title', await ev(`[...document.querySelectorAll('#gantt-view .gantt-bar-text')].some(t=>t.textContent.trim().length>2)`));

    const p = await ev(`(()=>{const l=document.querySelector('#gantt-view .gantt-label[data-id="28"] .gantt-label-id');if(!l)return null;l.scrollIntoView({block:'center'});const r=l.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    check('card 28 has an id in the label column', !!p, p);
    if (p) {
      await tap(page, p.x, p.y);
      check('a tap on an id opens its card', await waitFor(`/[?&]card=28\b/.test(location.search)||!!document.querySelector('.modal-backdrop, .detail')`, 5000), await ev('location.search'));
    }

    await open('/?view=gantt');
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 844, deviceScaleFactor: 1, mobile: false });
    check('above 760 px the gutter is 200 px', await waitFor(`innerWidth===800&&Math.round(${gutterWidth})===200`, 10000), await ev(gutterWidth));
    check('and the labels show their titles', await ev(`[...document.querySelectorAll('#gantt-view .gantt-label-title')].every(t=>getComputedStyle(t).display!=='none')`));
  },
};
