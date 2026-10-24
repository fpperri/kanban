'use strict';
// The Statuses section on a 390 px phone, on the Calendar: its pills are at least 44 px tall, the open
// panel fits the screen and scrolls inside, a status switched there holds through the 5-second refresh,
// and the section is hidden on the Board. With a status off and the panel closed the search chip shows
// the count; with the Status section starts folded preference on, the section opens folded.

const { tap, refreshNow } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    const SECTION = `document.getElementById('search-statuses-section')`;
    const pillSel = (col) => `#search-statuses .status-pill[data-col="${col}"]`;
    const pressed = (col) => `document.querySelector(${JSON.stringify(pillSel(col))}).getAttribute('aria-pressed')`;
    const openPanel = async () => {
      const r = await ev(`(()=>{const b=document.getElementById('search-btn').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
      await tap(page, r.x, r.y);
      await ev(`document.getElementById('search-input').focus()`);
      return waitFor(`!document.getElementById('search-panel').classList.contains('hidden')`, 5000);
    };
    const tapPill = async (col) => {
      const r = await ev(`(()=>{const b=document.querySelector(${JSON.stringify(pillSel(col))}).getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
      await tap(page, r.x, r.y);
    };

    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    check('on the Board the section is hidden', await ev(`${SECTION}.classList.contains('hidden')`));

    await ev(`document.getElementById('calendar-toggle-btn').click()`);
    check('the Calendar shows the section', await waitFor(`!${SECTION}.classList.contains('hidden')&&document.querySelectorAll('#search-statuses .status-pill').length>0`, 10000));
    await openPanel();
    check('the panel is open', await waitFor(`!document.getElementById('search-panel').classList.contains('hidden')`));
    const pillHeights = await ev(`JSON.stringify([...document.querySelectorAll('#search-statuses .status-pill')].map((b)=>Math.round(b.getBoundingClientRect().height)))`);
    check('every status pill is at least 44 px tall', await ev(`[...document.querySelectorAll('#search-statuses .status-pill')].every((b)=>b.getBoundingClientRect().height>=44)`), pillHeights);
    const panel = await ev(`(()=>{const p=document.getElementById('search-panel');const r=p.getBoundingClientRect();return {bottom:Math.round(r.bottom),ih:innerHeight,scrolls:getComputedStyle(p).overflowY}})()`);
    check('the open panel fits the screen and scrolls inside', panel.bottom <= panel.ih && /auto|scroll/.test(panel.scrolls), JSON.stringify(panel));

    await tapPill('done');
    check('a tap on Done switches it', await waitFor(`${pressed('done')}==='false'`, 5000));
    check('the board refreshes', await refreshNow(page));
    check('it holds through the 5-second refresh', await ev(`${pressed('done')}==='false'`));

    await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    check('with a status off and the panel closed the chip shows the count', await waitFor(`(()=>{const c=document.getElementById('search-chip');return !c.classList.contains('hidden')&&c.textContent==='1'})()`, 5000), await ev(`document.getElementById('search-chip').textContent`));

    const prefsKey = `kanban.${await ev('state.projectName')}.prefs`;
    await ev(`localStorage.setItem(${JSON.stringify(prefsKey)}, JSON.stringify({ statusesFolded: true }))`);
    await send('Page.reload');
    check('the Calendar is back after the reload', await waitFor(`!${SECTION}.classList.contains('hidden')`, 10000));
    await openPanel();
    check('with the preference on the section opens folded', await waitFor(`document.getElementById('search-statuses').classList.contains('hidden')&&document.getElementById('search-statuses-fold').getAttribute('aria-expanded')==='false'`, 5000));

    await ev(`document.getElementById('calendar-toggle-btn').click()`);
    check('back on the Board the section is hidden', await waitFor(`${SECTION}.classList.contains('hidden')`, 5000));
  },
};
