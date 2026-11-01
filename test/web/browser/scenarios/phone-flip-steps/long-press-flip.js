'use strict';
// The long press is the width line, not touch: at 390 a held card lights and opens its menu; the window
// widened to 800 with the same finger on it, a hold lights nothing and opens nothing; narrowed again it
// does once more. The open menu follows the line the same way: with a mouse at 800 a click on a card
// outside it opens the card and closes the menu, as it always did, and at 390 the same click only closes
// the menu. No reload.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): pinnedLitId,
// selectedIds, showContextMenu.

const { longPress, holdDown, liftUp, realWait } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, rightClick, check } = page;
    const MENU = `document.getElementById('context-menu')`;
    const menuOpen = `!${MENU}.classList.contains('hidden')`;
    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const lit = `document.querySelectorAll('.card-el.hover-highlight').length`;
    const held = (id) => `pinnedLitId===${JSON.stringify(String(id))}`;
    const hasCard = `new URLSearchParams(location.search).has('card')&&!document.querySelector('#detail-modal').classList.contains('hidden')`;
    const resize = (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false });
    const touch = (on) => send('Emulation.setTouchEmulationEnabled', on ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    const countMenus = () => ev(`(()=>{if(window.__menus===undefined){const o=showContextMenu;window.showContextMenu=function(...a){window.__menus++;return o.apply(this,a)}}window.__menus=0;return true})()`);
    const menus = () => ev('window.__menus');
    const titleOf = (n) => `#board .column .card-el:nth-of-type(${n}) .card-title`;
    // A card the open menu does not cover, with the point to click it at.
    const cardOutsideMenu = () => ev(`(()=>{const m=document.getElementById('context-menu').getBoundingClientRect();for(const el of document.querySelectorAll('#board .column .card-el')){const t=el.querySelector('.card-title');if(!t)continue;const r=t.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;if(y<=0||y>=innerHeight||x<=0||x>=innerWidth)continue;if(x>=m.left&&x<=m.right&&y>=m.top&&y<=m.bottom)continue;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el)return {id:el.dataset.id,x,y}}return null})()`);
    const pointOf = async (sel) => { await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); return centre(sel); };

    await open('/');
    check('at 390 the Board draws', await waitFor(`innerWidth===390&&document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await ev(`window.__noReload=true`);
    await countMenus();
    const first = await ev(`document.querySelector('#board .column .card-el').dataset.id`);

    await touch(true);
    const p1 = await pointOf(titleOf(1));
    await longPress(page, p1.x, p1.y, { until: held(first) });
    check('at 390 a hold lights the card and the lift opens its menu', await waitFor(`${menuOpen}&&${lit}>0`, 4000) && await menus() === 1, await menus());
    await ev(`hideContextMenu()`);

    await resize(800);
    check('at 800 the Board draws as the desk\'s', await waitFor(`innerWidth===800&&document.querySelectorAll('#board-tabs .board-tab').length===0&&document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await countMenus();
    const p2 = await pointOf(titleOf(1));
    await holdDown(page, p2.x, p2.y);
    await realWait(900);
    check('at 800 a hold lights nothing', await ev(`${lit}===0`), await ev(lit));
    await liftUp(page);
    await realWait(300);
    check('and its lift opens no menu', await menus() === 0 && await ev(`!(${menuOpen})`));
    check('the lift is a click, which opens the card as at the desk', await waitFor(hasCard, 3000), await ev('location.search'));
    await touch(false);
    await key('Escape');
    check('Esc closes the card', await waitFor(`!(${hasCard})`, 3000));

    await rightClick(titleOf(1));
    check('at 800 a right-click opens the menu', await waitFor(menuOpen, 3000));
    const p4 = await cardOutsideMenu();
    check('a card stands outside the menu', !!p4);
    await click(p4.x, p4.y);
    check('and a click on it closes the menu and does what a click does: it opens the card', await waitFor(`!(${menuOpen})&&(${hasCard})`, 3000), await ev(`JSON.stringify({search:location.search,menu:${menuOpen},modalHidden:document.querySelector('#detail-modal').classList.contains('hidden')})`));
    await key('Escape');
    await waitFor(`!(${hasCard})`, 3000);

    await resize(390);
    check('back at 390 the Board is the phone\'s', await waitFor(`innerWidth===390&&document.querySelectorAll('#board-tabs .board-tab').length>1&&document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await ev(`hideContextMenu()`);
    await rightClick(titleOf(1));
    check('at 390 a right-click opens the menu', await waitFor(menuOpen, 3000));
    const free = await cardOutsideMenu();
    check('a card stands outside the menu', !!free);
    await click(free.x, free.y);
    check('and a click on it only closes the menu: it selects and opens nothing', await waitFor(`!(${menuOpen})`, 3000) && await ev(`${picked}===''&&!(${hasCard})`), await ev(`${picked}+'|'+location.search`));
    await touch(true);
    const p5 = await pointOf(titleOf(1));
    await countMenus();
    await longPress(page, p5.x, p5.y, { until: held(first) });
    check('narrowed again, a hold opens the menu once more', await waitFor(menuOpen, 4000) && await menus() === 1, await menus());
    check('the page was not reloaded', await ev(`window.__noReload===true`));
  },
};
