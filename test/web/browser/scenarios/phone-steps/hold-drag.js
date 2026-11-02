'use strict';
// Hold and drag on the Board at the phone layout. With touch on, 390 px wide and short enough for the
// longest status to run past the screen: a finger held 500 ms on a tile and then moved adds every tile
// it passes over to the selection, the tile held first, and the list does not scroll during that touch.
// The tiles are painted selected as the finger reaches them, in the elements already on the page, and
// the board is drawn once, when the finger lifts: no menu opens and the tiles stay selected. A second
// hold and drag in a row works as the first. A touch without a hold scrolls the list and swipes
// between statuses as before, and a hold and a quick sideways drag is no swipe. A hold and drag on the
// Map selects nothing.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): isDragging,
// pinnedLitId, renderBoard, selectedIds, selectionState.

const { tap, swipe, holdDrag, realWait } = require('../../steps');

const SHORT_PHONE_HEIGHT = 620;

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const MENU = `document.getElementById('context-menu')`;
    const menuOpen = `!${MENU}.classList.contains('hidden')`;
    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const inOrder = `(()=>{const s=selectionState.selection;return [s.anchor].concat(s.additions).filter(Boolean).map((p)=>String(p.id)).join()})()`;
    const held = (id) => `pinnedLitId===${JSON.stringify(String(id))}`;
    const shown = `[...document.querySelectorAll('#board .column')].map((c)=>c.dataset.col).join()`;
    const noCard = `!new URLSearchParams(location.search).has('card')`;
    // The list as the finger scrolls it: the page, the board and every column's own scroller.
    const scrolled = `[document.scrollingElement.scrollTop,document.getElementById('board').scrollTop].concat([...document.querySelectorAll('#board .column-cards')].map((e)=>e.scrollTop)).join()`;
    // The tiles the Board shows whole between its top and the view bar, in the order they are drawn, each with a point on it a finger can reach.
    const wholeTiles = () => ev(`(()=>{const b=document.getElementById('board').getBoundingClientRect();const bar=document.getElementById('view-bar').getBoundingClientRect();const out=[];for(const el of document.querySelectorAll('#board .column .card-el')){const r=el.getBoundingClientRect();if(r.top<b.top||r.bottom>bar.top)continue;const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el)out.push({id:el.dataset.id,x,y})}return out})()`);
    // A mark on every tile now drawn: a tile that still has it was not drawn again.
    const markTiles = () => ev(`(()=>{document.querySelectorAll('#board .card-el').forEach((e)=>{e.__held=true});return true})()`);
    const stillMarked = (id) => `(()=>{const e=document.querySelector('#board .column .card-el[data-id="${id}"]');return !!e&&e.__held===true})()`;
    const looksSelected = (id) => `!!document.querySelector('#board .column .card-el.selected[data-id="${id}"]')`;
    const countRenders = () => ev(`(()=>{window.__renders=0;const o=renderBoard;window.renderBoard=function(...a){window.__renders++;return o.apply(this,a)};return true})()`);
    const renders = () => ev('window.__renders');
    const tabOf = (col) => ev(`(()=>{const t=document.querySelector('#board-tabs .board-tab[data-col="${col}"]');if(!t)return null;t.scrollIntoView({inline:'center',block:'nearest'});const b=t.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);

    // The tab with the most tiles on screen: the finger needs a few tiles to pass.
    const richestTab = async () => {
      const cols = await ev(`[...document.querySelectorAll('#board-tabs .board-tab')].map((t)=>t.dataset.col)`);
      let best = null;
      for (const col of cols) {
        const at = await tabOf(col);
        await tap(page, at.x, at.y);
        await waitFor(`${shown}===${JSON.stringify(col)}`, 4000);
        const n = (await wholeTiles()).length;
        if (!best || n > best.n) best = { col, n };
      }
      return best;
    };
    const boardOn = async (col) => {
      await open('/');
      if (!await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000)) return false;
      const at = await tabOf(col);
      await tap(page, at.x, at.y);
      return waitFor(`${shown}===${JSON.stringify(col)}`, 4000);
    };

    // --- the Board -------------------------------------------------------------------------------------
    // A short phone, so that the longest status runs past the bottom of the screen and the list has somewhere to scroll.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: SHORT_PHONE_HEIGHT, deviceScaleFactor: 1, mobile: true });
    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    const best = await richestTab();
    check('a status shows four tiles whole', best.n >= 4, best);
    check('the Board on that status', await boardOn(best.col));
    const [t0, , , t3] = await wholeTiles();

    // The list scrolls under a plain drag: what hold and drag must not do.
    const idle = await ev(scrolled);
    await swipe(page, { x: t0.x, y: t3.y }, { x: t0.x, y: t0.y - 20 });
    await realWait(400);
    const wasScrollable = await ev(scrolled) !== idle;
    check('a touch without a hold scrolls the list as before', wasScrollable, { idle, now: await ev(scrolled) });
    check('and selects nothing', await ev(`${picked}===''`));
    if (wasScrollable) {
      await ev(`(()=>{document.scrollingElement.scrollTop=0;document.getElementById('board').scrollTop=0;document.querySelectorAll('#board .column-cards').forEach((e)=>{e.scrollTop=0});return true})()`);
      await realWait(300);
    }
    const [h0, h1, h2, h3] = await wholeTiles();
    check('the same tiles are on screen again', [h0, h1, h2, h3].every(Boolean) && h0.id === t0.id, { t0, h0 });
    await countRenders();
    await markTiles();
    const rest = await ev(scrolled);

    // The hold on the third tile, the drag up across the two above it, and the state with the finger still down.
    // Up is the way that scrolls this list when the browser is left to the touch: the list starts at its top.
    const order = [h2.id, h1.id, h0.id];
    const byId = (list) => list.slice().sort((x, y) => x - y).join();
    let during = null;
    await holdDrag(page, { x: h2.x, y: h2.y }, [{ x: h1.x, y: h1.y }, { x: h0.x, y: h0.y }], {
      until: held(h2.id),
      whileHeld: async () => {
        await waitFor(`${picked}===${JSON.stringify(byId(order))}`, 4000);
        during = {
          picked: await ev(picked),
          order: await ev(inOrder),
          painted: await ev(`[${looksSelected(h0.id)},${looksSelected(h1.id)},${looksSelected(h2.id)},${looksSelected(h3.id)}]`),
          same: await ev(`[${stillMarked(h0.id)},${stillMarked(h1.id)},${stillMarked(h2.id)}]`),
          renders: await renders(),
          dragging: await ev('isDragging'),
          scrolled: await ev(scrolled),
          menu: await ev(menuOpen),
        };
      },
    });
    check('moving the finger after the hold adds every tile it passes over to the selection', during.picked === byId(order), during);
    check('the tile held first, then the tiles in the order passed', during.order === order.join(), during.order);
    check('the tiles are painted selected while the finger is down, and the one not passed is not', JSON.stringify(during.painted) === '[true,true,true,false]', during.painted);
    check('in the tiles already on the page: nothing was drawn again for a card', JSON.stringify(during.same) === '[true,true,true]' && during.renders === 0, during);
    check('the poll is kept out for the length of the drag', during.dragging === true);
    check('the list did not scroll during that touch', during.scrolled === rest, { rest, scrolled: during.scrolled });
    check('and the menu waits: a drag opens none', during.menu === false);

    await realWait(300); // the menu would open on the lift, and the click after it
    check('lifting ends it with no menu', await ev(`!(${menuOpen})`));
    check('the tiles stay selected', await ev(picked) === byId(order), await ev(picked));
    check('the lift drew the board once', await renders() === 1, await renders());
    check('and the tiles drawn then are painted selected', JSON.stringify(await ev(`[${looksSelected(h0.id)},${looksSelected(h1.id)},${looksSelected(h2.id)},${looksSelected(h3.id)}]`)) === '[true,true,true,false]');
    check('the poll guard is released', await ev('isDragging') === false);
    check('the search box says what is picked', await ev(`document.getElementById('search-input').value`) === order.map((id) => `#${id}`).join(' | '), await ev(`document.getElementById('search-input').value`));
    check('no card was opened', await ev(noCard));

    // The status does not change under a hold and drag, whatever its direction
    check('the Board stays on its status', await ev(shown) === best.col, await ev(shown));

    // --- a second hold and drag, with no reload between, adds to what is selected --------------------------
    // The browser decides at the touchstart whether the moves after it can be cancelled, from the handlers it
    // knows then: a second hold and drag in a row is the one that shows a handler bound with the touch instead of with the page.
    const [, , , k3] = await wholeTiles();
    await holdDrag(page, { x: k3.x, y: k3.y }, [{ x: h2.x, y: h2.y }, { x: k3.x, y: k3.y }], { until: held(k3.id) });
    const all = byId([...order, k3.id]);
    check('a second hold and drag adds to the selection, and a tile passed twice stays in once', await waitFor(`${picked}===${JSON.stringify(all)}`, 3000), await ev(picked));
    check('the first selection came first', (await ev(inOrder)).startsWith(order.join()), await ev(inOrder));
    check('and the list did not scroll under it either', await ev(scrolled) === rest, await ev(scrolled));

    // --- sideways, quickly: no swipe -------------------------------------------------------------------
    // The hold takes over half a second and the swipe is read under 700 ms, so a hold and a quick sideways drag is the case the swipe could take.
    check('the Board again', await boardOn(best.col));
    const [s0] = await wholeTiles();
    await holdDrag(page, { x: s0.x, y: s0.y }, [{ x: s0.x - 150, y: s0.y }], { until: held(s0.id) });
    await realWait(300);
    check('a hold and a sideways drag does not swipe to the next status', await ev(shown) === best.col, await ev(shown));
    check('and it selects the tile held', await ev(picked) === String(s0.id), await ev(picked));

    // --- a swipe without a hold still swipes ------------------------------------------------------------
    const first = await ev(shown);
    const mid = await wholeTiles();
    await swipe(page, { x: mid[0].x + 80, y: mid[0].y }, { x: mid[0].x - 120, y: mid[0].y });
    check('a swipe without a hold still moves to the next status', await waitFor(`${shown}!==${JSON.stringify(first)}`, 4000), await ev(shown));

    // --- the Map: a hold and drag there selects nothing ------------------------------------------------
    await open('/?view=map');
    check('the Map draws', await waitFor(`document.querySelectorAll('#map-view .card-el').length>1`, 10000));
    const nodes = await ev(`[...document.querySelectorAll('#map-view .card-el')].slice(0,2).map((e)=>{e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {id:e.dataset.id,x:r.left+r.width/2,y:r.top+r.height/2}})`);
    await holdDrag(page, { x: nodes[0].x, y: nodes[0].y }, [{ x: nodes[1].x, y: nodes[1].y }], { until: held(nodes[0].id) });
    await realWait(300);
    check('a hold and drag on the Map selects no card', await ev(`${picked}===''`) && await ev(noCard), await ev(picked));
  },
};
