'use strict';
// The phone header, on the plan board and on the feature board at 390 by 844 with touch: the board
// name, New card, the view buttons, the bell and More share one row, and the name ellipsises without
// wrapping; More lists exactly the items the desktop header shows for the board, and its Refresh
// reloads the board; a stale cue that is shown sits inside the header, on the same row. The search
// bar sits on its own row under the top row.

const ROW = `(()=>{
  const r = (el) => el.getBoundingClientRect();
  const top = [document.querySelector('h1'), document.getElementById('new-btn'), document.getElementById('notif-btn'), document.getElementById('more-btn')];
  const boxes = top.map(r);
  const mid = boxes.map((b) => (b.top + b.bottom) / 2);
  const h1 = getComputedStyle(document.querySelector('h1'));
  return {
    count: top.length,
    sameRow: Math.max(...mid) - Math.min(...mid) < 6,
    inside: boxes.every((b) => b.left >= 0 && b.right <= innerWidth),
    ellipsis: h1.textOverflow === 'ellipsis' && h1.whiteSpace === 'nowrap',
    below: r(document.querySelector('.search-bar')).top >= Math.max(...boxes.map((b) => b.bottom)) - 1,
    wide: r(document.querySelector('.search-bar')).width > innerWidth - 40,
    noWrap: document.documentElement.scrollWidth <= innerWidth,
  };
})()`;

const DESKTOP_ITEMS = `(()=>{
  const items = ['prefs', 'refresh', 'copy'];
  if (!document.getElementById('home-link').classList.contains('hidden')) items.push('home');
  if (!document.getElementById('iter-select').hidden) items.push('iteration');
  return items.join();
})()`;

const MENU_ITEMS = `(()=>{
  const nodes = { prefs: 'more-prefs', refresh: 'more-refresh', copy: 'more-copy', home: 'more-home', iteration: 'more-iter' };
  return Object.keys(nodes).filter((k) => !document.getElementById(nodes[k]).classList.contains('hidden')).join();
})()`;

const MENU_OPEN = `!document.getElementById('more-menu').classList.contains('hidden')`;

module.exports = {
  async run(page) {
    for (const [board, name] of [[undefined, 'plan'], ['feature', 'feature']]) {
      const { ev, open, waitFor, check } = page;
      await open('/', board);
      check(`${name}: the Board draws`, await waitFor(`document.querySelectorAll('#board .column').length===1&&document.querySelectorAll('#board-tabs .board-tab').length>0`, 10000));
      const row = await ev(ROW);
      check(`${name}: the name, New card, the bell and More share one row inside the window`, row.count === 4 && row.sameRow && row.inside, JSON.stringify(row));
      check(`${name}: the name ellipsises without wrapping and the page does not scroll sideways`, row.ellipsis && row.noWrap, JSON.stringify(row));
      check(`${name}: the search bar is on its own full-width row under the top row`, row.below && row.wide, JSON.stringify(row));

      await ev(`document.getElementById('more-btn').click()`);
      check(`${name}: More opens its menu`, await waitFor(MENU_OPEN, 2000));
      const shown = await ev(MENU_ITEMS);
      check(`${name}: More shows exactly the items the desktop header shows`, shown === await ev(DESKTOP_ITEMS), `${shown} against ${await ev(DESKTOP_ITEMS)}`);

      await ev(`window.__loads=0;const f=window.fetch;window.fetch=(...a)=>{window.__loads++;return f(...a)};true`);
      await ev(`document.getElementById('more-refresh').click()`);
      check(`${name}: Refresh in More reloads the board and closes the menu`, await waitFor(`window.__loads>0&&!(${MENU_OPEN})`, 5000));

      await ev(`document.getElementById('stale-indicator').classList.remove('hidden')`);
      const stale = await ev(`(()=>{const h=document.querySelector('header').getBoundingClientRect();const s=document.getElementById('stale-indicator').getBoundingClientRect();const m=document.getElementById('more-btn').getBoundingClientRect();return {inside:document.querySelector('header').contains(document.getElementById('stale-indicator'))&&s.width>0&&s.top>=h.top&&s.bottom<=h.bottom,sameRow:Math.abs((s.top+s.bottom)/2-(m.top+m.bottom)/2)<6}})()`);
      check(`${name}: a shown stale cue is inside the header, on the top row`, stale.inside && stale.sameRow, JSON.stringify(stale));
    }
  },
};
