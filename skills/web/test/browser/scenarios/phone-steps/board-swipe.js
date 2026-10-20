'use strict';
// The Board on a 390 px phone: a sideways swipe moves to the neighbouring status and a vertical drag
// does not, a card is never natively draggable, and New card opens its form on the status tab being
// read (closed without saving).

const { tap, swipe } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    const shown = `[...document.querySelectorAll('#board .column')].map((c) => c.dataset.col)`;
    const tabs = `[...document.querySelectorAll('#board-tabs .board-tab')]`;
    const centre = await (async () => {
      await open('/');
      await waitFor(`(${shown}).length===1&&document.querySelectorAll('#board .column .card-el').length>0`, 10000);
      return ev(`(()=>{const b=document.getElementById('board').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+Math.min(b.height/2,300)}})()`);
    })();
    const first = (await ev(shown))[0];
    const second = await ev(`${tabs}[1].dataset.col`);

    check('a card is not draggable at 390', await ev(`[...document.querySelectorAll('#board .card')].every((c)=>c.draggable===false)`));

    await swipe(page, { x: centre.x, y: centre.y + 100 }, { x: centre.x, y: centre.y - 100 });
    check('a vertical drag does not change the status', JSON.stringify(await ev(shown)) === JSON.stringify([first]), await ev(shown));

    await swipe(page, { x: centre.x + 100, y: centre.y }, { x: centre.x - 100, y: centre.y });
    check('a swipe left shows the next status', await waitFor(`JSON.stringify(${shown})===JSON.stringify(['${second}'])`), await ev(shown));

    await swipe(page, { x: centre.x - 100, y: centre.y }, { x: centre.x + 100, y: centre.y });
    check('a swipe right shows the previous status', await waitFor(`JSON.stringify(${shown})===JSON.stringify(['${first}'])`), await ev(shown));

    await swipe(page, { x: centre.x - 100, y: centre.y }, { x: centre.x + 100, y: centre.y });
    check('the first status does not wrap', JSON.stringify(await ev(shown)) === JSON.stringify([first]), await ev(shown));

    await swipe(page, { x: centre.x + 100, y: centre.y }, { x: centre.x - 100, y: centre.y });
    await waitFor(`JSON.stringify(${shown})===JSON.stringify(['${second}'])`);
    const r = await ev(`(()=>{const b=document.getElementById('new-btn').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
    await tap(page, r.x, r.y);
    check('New card opens the form on the active status', await waitFor(`!document.getElementById('modal').classList.contains('hidden')&&document.getElementById('f-status').value==='${second}'`), await ev(`document.getElementById('f-status').value`));
    await ev(`document.getElementById('modal-close').click()`);
    check('the form closes without saving', await waitFor(`document.getElementById('modal').classList.contains('hidden')`));
  },
};
