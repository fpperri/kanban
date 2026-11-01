'use strict';
// A long press on a card at the phone layout. With touch on, 390 by 844: a finger held 500 ms on a
// card lights it and the sets On hover show ticks, and lifted in place opens the card menu, once,
// whether or not the browser fires a contextmenu of its own. The click the lift would make does
// nothing. The light outlives the menu: a tap outside the open menu only closes it, and the next tap
// ends the light and does its job. Select lit (N) adds the lit cards the view shows. A finger that
// moves before the hold is a scroll or a swipe; one that moves after it opens no menu, and on the
// Gantt it still moves the dates. It runs on the Board, the Map, the Gantt, the Calendar and the Graph.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): ganttDayPxLive, isDragging,
// menuSubject, pinnedLitId, selectedIds, showContextMenu, state.

const { tap, swipe, holdDown, moveHeld, liftUp, realWait, longPress, outwaitPressEcho, outwaitDoubleTap } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const MENU = `document.getElementById('context-menu')`;
    const menuOpen = `!${MENU}.classList.contains('hidden')`;
    const noCard = `!new URLSearchParams(location.search).has('card')`;
    // The page has noticed the hold: the light is pinned to the card. The hover can light a card too, so the light itself says nothing about the hold.
    const held = (id) => `pinnedLitId===${JSON.stringify(String(id))}`;
    const lit = (id) => `!!document.querySelector('.card-el.hover-highlight[data-id="${id}"]')`;
    const litIds = `[...new Set([...document.querySelectorAll('.card-el.hover-highlight')].map((e)=>e.dataset.id))].sort((a,b)=>a-b).join()`;
    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); await tap(page, p.x, p.y); };
    // How many times the page has opened the card menu since this was last called.
    const countMenus = () => ev(`(()=>{if(window.__menus===undefined){const o=showContextMenu;window.showContextMenu=function(...a){window.__menus++;return o.apply(this,a)}}window.__menus=0;return true})()`);
    const menus = () => ev('window.__menus');
    const subject = () => ev(`({ids:menuSubject.ids.map(String).join(),clicked:String(menuSubject.clicked),inSelection:menuSubject.inSelection,lit:(menuSubject.lit||[]).map(String).join()})`);
    // The browser's own contextmenu on a card, as Android fires one during a hold; true when the page held it back.
    const nativeMenu = (sel) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});const r=el.getBoundingClientRect();const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2});el.dispatchEvent(e);return e.defaultPrevented})()`);
    // The click a browser makes under a finger that lifts, when it makes one.
    const liftClick = (sel) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));return true})()`);
    const tapTab = async (col) => {
      const r = await ev(`(()=>{const t=document.querySelector('#board-tabs .board-tab[data-col="${col}"]');t.scrollIntoView({inline:'center',block:'nearest'});const b=t.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
      await tap(page, r.x, r.y);
      return waitFor(`JSON.stringify([...document.querySelectorAll('#board .column')].map((c)=>c.dataset.col))===JSON.stringify(['${col}'])`, 4000);
    };
    // A card the open menu does not cover, with the point to tap it at.
    const cardOutsideMenu = () => ev(`(()=>{const m=document.getElementById('context-menu').getBoundingClientRect();for(const el of document.querySelectorAll('#board .column .card-el')){const t=el.querySelector('.card-title');if(!t)continue;const r=t.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;if(y<=0||y>=innerHeight||x<=0||x>=innerWidth)continue;if(x>=m.left&&x<=m.right&&y>=m.top&&y<=m.bottom)continue;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el)return {id:el.dataset.id,x,y}}return null})()`);
    // A point on the Board that is no card, no control: the empty space under or between the tiles.
    const emptyPoint = () => ev(`(()=>{for(let y=740;y>300;y-=20){const e=document.elementFromPoint(195,y);if(e&&e.closest('#board')&&!e.closest('.card-el,button,a,input,select,#board-tabs'))return {x:195,y}}return null})()`);

    const two = '#board .column .card-el[data-id="2"]';
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const boardOnDoing = async () => {
      await open('/');
      if (!await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000)) return false;
      return tapTab('doing');
    };

    // --- the Board -------------------------------------------------------------------------------------
    check('the Board draws on the doing tab', await boardOnDoing());
    await countMenus();
    // 2 is the parent of 7, 8 and the archived 19, has 1 for a parent and is waited for by 6; 9 and 15 are linked to nothing.
    const [lone, other] = ['9', '15'];
    check('the doing tab holds the card with relations and two without', await ev(`['2','${lone}','${other}'].every((id)=>!!document.querySelector('#board .column .card-el[data-id="'+id+'"]'))`));
    const at = await pointOf(titleOf(2));

    await holdDown(page, at.x, at.y);
    check('holding a card 500 ms lights it and the cards it is linked to that the Board shows', await waitFor(held(2), 4000) && await ev(litIds) === '1,2', await ev(litIds));
    check('and the menu waits for the lift', await ev(`!(${menuOpen})`) && await menus() === 0);
    await liftUp(page);
    check('lifting in place opens the card menu for that card', await waitFor(menuOpen, 4000) && JSON.stringify(await subject()).includes('"clicked":"2"'), await subject());
    check('exactly once', await menus() === 1, await menus());
    check('the menu is the card\'s: for the card alone', (await subject()).ids === '2' && (await subject()).inSelection === false);

    await liftClick(titleOf(2));
    check('the click the lift would make does nothing else: no card opens, none is selected', await ev(`${noCard}&&${picked}===''`), await ev(`location.search+'|'+${picked}`));
    check('and the menu stays open with the light on', await ev(`${menuOpen}&&${lit(2)}`));

    await outwaitPressEcho();
    const under = await cardOutsideMenu();
    check('a card stands outside the open menu', !!under);
    await tap(page, under.x, under.y);
    check('a tap on a card outside the open menu only closes the menu', await waitFor(`!(${menuOpen})`, 3000) && await ev(`${noCard}&&${picked}===''`), await ev(`location.search+'|'+${picked}`));
    check('and closing the menu leaves the light on', await ev(lit(2)) && await ev(lit(1)), await ev(litIds));
    await tapOn(titleOf(other));
    check('the next tap does its job: it selects the card', await waitFor(`${picked}===${JSON.stringify(other)}`, 3000), await ev(picked));
    check('and ends the light', await ev(`!(${lit(2)})`), await ev(litIds));

    // The light, ended by a tap on empty space, and nothing else
    await holdDown(page, at.x, at.y);
    await waitFor(held(2), 4000);
    await liftUp(page);
    await waitFor(menuOpen, 4000);
    await outwaitPressEcho();
    const empty = await emptyPoint();
    check('the Board has a point that is neither card nor control', !!empty);
    await tap(page, empty.x, empty.y);
    check('a tap on empty space closes the menu', await waitFor(`!(${menuOpen})`, 3000));
    check('and the light stays', await ev(lit(2)));
    await outwaitDoubleTap(); // two taps in a row on empty space are a double tap, which clears the selection
    await tap(page, empty.x, empty.y);
    check('the next one ends the light and only the light: the selection stays', await waitFor(`!(${lit(2)})`, 3000) && await ev(`${picked}===${JSON.stringify(other)}`), await ev(`${litIds}+'|'+${picked}`));

    // The menu of a selected card is the batch's
    await outwaitPressEcho();
    await tapOn(titleOf(lone));
    await waitFor(`${picked}.split(',').length===2`, 3000);
    const picks = await ev(picked);
    const o = await pointOf(titleOf(lone));
    await countMenus();
    await longPress(page, o.x, o.y, { until: held(lone) });
    check('a long press on a selected card opens the menu for the selection', await waitFor(menuOpen, 4000) && (await subject()).inSelection === true && (await subject()).ids.split(',').sort((a, b) => a - b).join() === picks, await subject());
    await ev(`hideContextMenu()`);

    // --- Android's own contextmenu ---------------------------------------------------------------------
    check('the Board again, with nothing selected', await boardOnDoing());
    await countMenus();
    const c = await pointOf(titleOf(2));
    await holdDown(page, c.x, c.y);
    await waitFor(held(2), 4000);
    check('a contextmenu during the hold is held back and opens nothing', await nativeMenu(two) === true && await menus() === 0 && await ev(`!(${menuOpen})`));
    await liftUp(page);
    check('the lift opens the menu', await waitFor(menuOpen, 4000));
    check('and a contextmenu after the lift opens nothing more: the menu opened once', await nativeMenu(two) === true && await menus() === 1, await menus());

    // --- Select lit ------------------------------------------------------------------------------------
    await outwaitPressEcho();
    const entry = await ev(`(()=>{const b=document.getElementById('ctx-lit');return {shown:!b.classList.contains('hidden'),text:b.textContent}})()`);
    check('the menu offers Select lit (6): the card, its parent, its three children and the card waiting for it', entry.shown && entry.text === 'Select lit (6)', { entry, subject: await subject() });
    await tapOn('#ctx-lit');
    check('Select lit adds them to the selection and shuts the menu', await waitFor(`${picked}==='1,2,6,7,8,19'&&!(${menuOpen})`, 3000), await ev(`${picked}+'|'+(${menuOpen})`));
    check('and the light stays', await ev(lit(2)));

    // The count is the lit cards the view shows
    check('the Board again, a search showing three of the five', await boardOnDoing());
    await ev(`(()=>{const i=document.getElementById('search-input');i.value='#2 | #1 | #7';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    check('the search narrows the Board', await waitFor(`document.querySelectorAll('${two}').length===1&&!document.querySelector('#board .column .card-el[data-id="${lone}"]')`, 4000));
    const n = await pointOf(titleOf(2));
    await longPress(page, n.x, n.y, { until: held(2) });
    check('Select lit counts the lit cards the view shows', await waitFor(`document.getElementById('ctx-lit').textContent==='Select lit (3)'`, 4000), await ev(`document.getElementById('ctx-lit').textContent`));
    await ev(`hideContextMenu()`);

    // --- a card with no relations has no Select lit -----------------------------------------------------
    check('the Board once more', await boardOnDoing());
    const alone = await pointOf(titleOf(lone));
    await longPress(page, alone.x, alone.y, { until: held(lone) });
    check('a card with nothing linked to it has no Select lit', await waitFor(menuOpen, 4000) && await ev(`document.getElementById('ctx-lit').classList.contains('hidden')`), await ev(`({lit:${litIds},text:document.getElementById('ctx-lit').textContent})`));
    await ev(`hideContextMenu()`);

    // --- a finger that moves ------------------------------------------------------------------------
    check('the Board for the moving finger', await boardOnDoing());
    await countMenus();
    const m = await pointOf(titleOf(2));
    await holdDown(page, m.x, m.y);
    await moveHeld(page, m.x, m.y - 40);
    await realWait(800);
    await liftUp(page);
    check('a finger that moves more than 10 px before the hold lights nothing and opens nothing', await ev(`${litIds}===''`) && await menus() === 0 && await ev(`!(${menuOpen})`), await ev(litIds));

    const m2 = await pointOf(titleOf(2));
    await holdDown(page, m2.x, m2.y);
    await waitFor(held(2), 4000);
    await moveHeld(page, m2.x, m2.y + 30);
    await liftUp(page);
    await realWait(300);
    check('a finger that moves after the hold keeps the light and opens no menu', await ev(lit(2)) && await menus() === 0 && await ev(`!(${menuOpen})`), await menus());

    const before = await ev(`[...document.querySelectorAll('#board-tabs .board-tab')].filter((t)=>t.getAttribute('aria-selected')==='true').map((t)=>t.dataset.col).join()`);
    const s = await pointOf(titleOf(2));
    await swipe(page, { x: s.x + 80, y: s.y }, { x: s.x - 120, y: s.y });
    check('a swipe between statuses still works', await waitFor(`[...document.querySelectorAll('#board-tabs .board-tab')].filter((t)=>t.getAttribute('aria-selected')==='true').map((t)=>t.dataset.col).join()!==${JSON.stringify(before)}`, 4000));
    check('and lights nothing', await ev(`${litIds}===''`) && await menus() === 0);

    // --- the other views -----------------------------------------------------------------------------
    const view = async (name, ready, target, { query = null, wait = null } = {}) => {
      await open(`/?view=${name}`);
      check(`${name}: the view draws`, await waitFor(ready, 10000));
      if (query) {
        await ev(`(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(query)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        check(`${name}: the search shows the card`, await waitFor(`!!document.querySelector(${JSON.stringify(target)})`, 10000));
      }
      if (wait) await wait();
      await countMenus();
      const id = await ev(`document.querySelector(${JSON.stringify(target)}).closest('.card-el').dataset.id`);
      const p = await pointOf(target);
      await holdDown(page, p.x, p.y);
      check(`${name}: a hold lights the card`, await waitFor(held(id), 4000) && await ev(lit(id)), await ev(litIds));
      check(`${name}: and opens no menu yet`, await ev(`!(${menuOpen})`) && await menus() === 0);
      await liftUp(page);
      check(`${name}: the lift opens the card menu for it, once`, await waitFor(menuOpen, 4000) && (await subject()).clicked === id && await menus() === 1, await subject());
      check(`${name}: with the card not selected`, await ev(`${picked}===''`) && await ev(noCard));
      await liftClick(target);
      check(`${name}: the click the lift would make does nothing else`, await ev(`${picked}===''&&${noCard}&&${menuOpen}`));
      await ev(`hideContextMenu()`);
      return id;
    };
    const graphSettled = async () => {
      let was = null;
      for (let i = 0; i < 40; i++) {
        const now = await ev(`JSON.stringify([graphCur.view.k,[...document.querySelectorAll('#graph-view .graph-node')].slice(0,3).map((n)=>n.getBoundingClientRect().left)])`);
        if (now === was) return;
        was = now;
        await page.sleep(200);
      }
    };

    await view('map', `document.querySelectorAll('#map-view .card-el').length>0`, '#map-view .card-el');
    await view('gantt', `document.querySelectorAll('#gantt-view .gantt-label').length>0`, '#gantt-view .gantt-bar[data-id="28"]', { query: 'centennial' });
    await view('calendar', `document.querySelectorAll('#calendar-view .cal-day').length>=28`, '#calendar-view .cal-chip[data-id="28"]', { query: 'centennial' });
    await view('graph', `!!graphCur&&document.querySelectorAll('#graph-view .graph-node').length>0`, '#graph-view .graph-node[data-id="2"] .graph-dot', { wait: graphSettled });
    check('graph: the rest of the Graph dims and the linked cards stay lit', await ev(`!!document.querySelector('#graph-view svg.graph-dim')&&!!document.querySelector('#graph-view .graph-node[data-id="1"].graph-near')`));

    // --- the Gantt: a finger that moves after the hold still moves the dates ---------------------------
    await open('/?view=gantt');
    check('the Gantt draws again', await waitFor(`document.querySelectorAll('#gantt-view .gantt-label').length>0`, 10000));
    await ev(`(()=>{const i=document.getElementById('search-input');i.value='centennial';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const bar = '#gantt-view .gantt-bar[data-id="28"]';
    check('the bar shows', await waitFor(`!!document.querySelector('${bar}')`, 10000));
    await countMenus();
    const dates = () => ev(`(()=>{const c=state.active.find((k)=>String(k.id)==='28');return [c.start_date,c.end_date,c.due_date].join('|')})()`);
    const datesBefore = await dates();
    const px = await ev('ganttDayPxLive');
    const g = await pointOf(bar);
    await holdDown(page, g.x, g.y);
    await waitFor(held(28), 4000);
    for (let i = 1; i <= 4; i++) await moveHeld(page, g.x + (px * 2 * i) / 4, g.y);
    check('the bar follows the finger after the hold', await waitFor('isDragging===true', 3000));
    await liftUp(page);
    check('lifting after the move opens no menu', await menus() === 0 && await ev(`!(${menuOpen})`));
    check('and the dates moved', await waitFor(`(()=>{const c=state.active.find((k)=>String(k.id)==='28');return [c.start_date,c.end_date,c.due_date].join('|')!==${JSON.stringify(datesBefore)}})()`, 6000), await dates());
    check('the poll guard is released', await waitFor('isDragging===false', 3000));
    const moved = await pointOf(bar);
    await swipe(page, { x: moved.x, y: moved.y }, { x: moved.x - px * 2, y: moved.y }, { steps: 4 });
    check('the same bar dragged back restores them', await waitFor(`(()=>{const c=state.active.find((k)=>String(k.id)==='28');return [c.start_date,c.end_date,c.due_date].join('|')===${JSON.stringify(datesBefore)}})()`, 6000), await dates());
  },
};
