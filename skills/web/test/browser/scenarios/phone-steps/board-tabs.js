'use strict';
// The Board on a 390 px phone: a strip of status tabs with counts, Archive last, and one status's
// cards at a time. A tap on a tab changes the status, a reload brings it back, a search narrows the
// counts to shown/total, and the page does not scroll sideways.

const { tap } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    const tabs = `[...document.querySelectorAll('#board-tabs .board-tab')]`;
    const shown = `[...document.querySelectorAll('#board .column')].map((c) => c.dataset.col)`;
    const selected = `${tabs}.filter((t) => t.getAttribute('aria-selected')==='true').map((t) => t.dataset.col)`;
    const counts = `${tabs}.map((t) => t.querySelector('.board-tab-count').textContent)`;
    const tapTab = async (col) => {
      const r = await ev(`(()=>{const b=document.querySelector('#board-tabs .board-tab[data-col="${col}"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
      await tap(page, r.x, r.y);
    };

    await open('/');
    check('the tabs show with counts and one status shows', await waitFor(`${tabs}.length>1&&${counts}.every((c)=>/^\d+$/.test(c))&&(${shown}).length===1&&document.querySelectorAll('#board .column .card-el').length>0`, 10000), await ev(`({tabs:${tabs}.length,shown:${shown}})`));
    check('Archive is the last tab', await ev(`${tabs}.pop().dataset.col`) === 'archive');
    check('the first status is the chosen one', JSON.stringify(await ev(shown)) === JSON.stringify(await ev(`[${tabs}[0].dataset.col]`)), await ev(selected));

    const second = await ev(`${tabs}[1].dataset.col`);
    await tapTab(second);
    check('a tap on a tab changes the status', await waitFor(`JSON.stringify(${shown})===JSON.stringify(['${second}'])&&JSON.stringify(${selected})===JSON.stringify(['${second}'])`), await ev(shown));

    await send('Page.reload');
    check('a reload brings the tab back', await waitFor(`JSON.stringify(${shown})===JSON.stringify(['${second}'])`, 10000), await ev(shown));

    await tapTab('archive');
    check('Archive can be chosen', await waitFor(`JSON.stringify(${shown})===JSON.stringify(['archive'])`), await ev(shown));

    await ev(`(()=>{const i=document.getElementById('search-input');i.value='the';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    check('a search narrows the counts to shown/total', await waitFor(`${counts}.every((c)=>/^\d+\/\d+$/.test(c))`, 10000), await ev(counts));

    check('the page does not scroll sideways', await ev(`document.documentElement.scrollWidth<=innerWidth`), await ev(`({sw:document.documentElement.scrollWidth,iw:innerWidth})`));
  },
};
