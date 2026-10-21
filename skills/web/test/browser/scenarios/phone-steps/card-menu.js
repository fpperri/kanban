'use strict';
// The card menu on a phone. Its groups, Edit and Explore, open their panel inline, under their row and
// in the menu's own width, instead of beside it; a tap on the row opens it, a second tap shuts it, and
// a tap on an entry in it does what the entry does.

const { tap } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check, rightClick } = page;
    const MENU = `document.getElementById('context-menu')`;
    const PANEL = `document.getElementById('ctx-edit').parentElement.querySelector('.ctx-sub-panel')`;
    const drawn = `getComputedStyle(${PANEL}).display!=='none'`;
    const rectOf = (expr) => ev(`(()=>{const r=(${expr}).getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,x:r.left+r.width/2,y:r.top+r.height/2}})()`);

    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    await rightClick('#board .column .card-el');
    check('a right-click on a card opens the menu with its groups shut', await waitFor(`!${MENU}.classList.contains('hidden')`, 3000) && !(await ev(drawn)));

    const row = await rectOf(`document.getElementById('ctx-edit')`);
    await tap(page, row.x, row.y);
    check('a tap on the Edit row opens its panel', await waitFor(drawn, 3000) && await ev(`document.getElementById('ctx-edit').getAttribute('aria-expanded')`) === 'true');
    const panel = await rectOf(PANEL);
    const menu = await rectOf(MENU);
    check('the panel is inline: under its row, inside the menu\'s width and on the screen', panel.t >= row.b - 2 && panel.l >= menu.l && panel.r <= menu.r + 1 && panel.r <= (await ev('innerWidth')), JSON.stringify({ row, panel, menu }));
    check('the entries below the row moved down to make room for it', (await rectOf(`document.getElementById('ctx-explore')`)).t >= panel.b - 2);

    await tap(page, row.x, row.y);
    check('a second tap on the row shuts the panel', await waitFor(`!(${drawn})`, 3000));

    await tap(page, row.x, row.y);
    await waitFor(drawn, 3000);
    const entry = await rectOf(`document.getElementById('ctx-priority')`);
    await tap(page, entry.x, entry.y);
    check('a tap on Set priority... in the panel opens its popup and shuts the menu', await waitFor(`!document.getElementById('bulk-single').classList.contains('hidden')&&${MENU}.classList.contains('hidden')`, 3000));
  },
};
