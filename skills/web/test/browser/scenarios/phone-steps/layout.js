'use strict';
// The whole layout at 390 by 844 with touch, on each of the five views: the page does not scroll
// sideways (scrollWidth equals clientWidth), and the header is one row, on the Calendar and the Gantt
// with the date range shown in it.

const READY = {
  board: `document.querySelectorAll('#board .column .card-el').length>0`,
  calendar: `!document.getElementById('calendar-view').classList.contains('hidden')&&document.querySelectorAll('#calendar-view .cal-day').length>=28`,
  gantt: `!document.getElementById('gantt-view').classList.contains('hidden')&&document.querySelectorAll('#gantt-view .gantt-body, #gantt-view .gantt-empty').length>0`,
  map: `!document.getElementById('map-view').classList.contains('hidden')&&document.querySelectorAll('#map-view .map-node, #map-view .card-el').length>0`,
  graph: `!document.getElementById('graph-view').classList.contains('hidden')&&document.querySelectorAll('#graph-view .graph-node').length>0`,
};

const SIDEWAYS = `(()=>{const d=document.documentElement;return {scrollWidth:d.scrollWidth,clientWidth:d.clientWidth}})()`;

const HEADER_ROW = `(()=>{
  const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
  const shown = (el) => !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
  const kids = [document.querySelector('h1'), document.getElementById('new-btn'), document.getElementById('search-btn'), document.getElementById('notif-btn'), document.getElementById('more-btn'), document.getElementById('header-date')].filter(shown);
  const m = kids.map(mid);
  const h = document.querySelector('header').getBoundingClientRect();
  const more = document.getElementById('more-btn').getBoundingClientRect();
  return { count: kids.length, oneRow: Math.max(...m) - Math.min(...m) < 6, gap: Math.round(h.bottom - more.bottom), date: shown(document.getElementById('header-date')) };
})()`;

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    await open('/');
    for (const view of ['board', 'calendar', 'gantt', 'map', 'graph']) {
      if (view !== 'board') await ev(`document.getElementById('${view}-toggle-btn').click()`);
      check(`the ${view} draws`, await waitFor(READY[view], 10000));
      const side = await ev(SIDEWAYS);
      check(`the ${view} does not scroll sideways`, side.scrollWidth === side.clientWidth, side);
      const row = await ev(HEADER_ROW);
      check(`the header is one row on the ${view}`, row.oneRow && row.gap < 20, row);
      if (view === 'calendar' || view === 'gantt') {
        check(`the ${view} shows the date range in the header, on that row`, row.date && row.count >= 5, row);
      }
    }
  },
};
