'use strict';
// The Calendar's and the Gantt's span cycle button on a phone: four taps on the Calendar go Month, Week,
// 3 days, Day, Month; five on the Gantt go All, Month, Week, 3 days, Day, All. The button shows the current
// span, and the span switch is hidden.

const { tap } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    const sel = (view) => `#${view}-view .cal-span-cycle`;
    const label = (view) => ev(`((document.querySelector(${JSON.stringify(sel(view))})||{}).textContent||'').split(String.fromCharCode(8635))[0].trim()`);
    const tapCycle = async (view) => {
      const r = await ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel(view))});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await tap(page, r.x, r.y);
    };
    const walk = async (view, spans) => {
      await ev(`document.querySelector('#${view}-toggle-btn').click()`);
      check(`the ${view} shows its span cycle button and not the span switch`, await waitFor(`(()=>{const b=document.querySelector(${JSON.stringify(sel(view))});const s=document.querySelector('#${view}-view .cal-subview-switch');return !!b&&b.offsetWidth>0&&!!s&&s.offsetWidth===0})()`, 10000));
      for (let i = 0; i < spans.length; i++) {
        check(`the ${view} cycle button shows ${spans[i]} after ${i} taps`, await waitFor(`((document.querySelector(${JSON.stringify(sel(view))})||{}).textContent||'').split(String.fromCharCode(8635))[0].trim()===${JSON.stringify(spans[i])}`, 5000), await label(view));
        if (i < spans.length - 1) await tapCycle(view);
      }
    };
    await walk('calendar', ['Month', 'Week', '3 days', 'Day', 'Month']);
    await walk('gantt', ['All', 'Month', 'Week', '3 days', 'Day', 'All']);
  },
};
