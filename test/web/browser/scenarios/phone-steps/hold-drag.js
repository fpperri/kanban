'use strict';
// Hold and drag on the Board at the phone layout. With touch on, 390 px wide and short enough for the
// longest status to run past the screen: a finger held 500 ms on a tile and then moved adds every tile
// it passes over to the selection, the tile held first, and the list does not scroll during that touch.
// The tiles are painted selected as the finger reaches them, in the elements already on the page, and
// the board is drawn once, when the finger lifts: no menu opens and the tiles stay selected. A second
// hold and drag in a row works as the first. A touch without a hold scrolls the list and swipes
// between statuses as before, and a hold and a quick sideways drag is no swipe.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): isDragging,
// pinnedLitId, renderBoard, selectedIds, selectionState, state.

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

    // The status with the most cards: the finger needs a few tiles to pass, and the list has to run past the screen.
    const fullest = () => ev(`(()=>{const n={};for(const c of state.active)n[c.status]=(n[c.status]||0)+1;return Object.entries(n).sort((x,y)=>y[1]-x[1])[0][0]})()`);
    const showTab = async (col) => {
      const at = await tabOf(col);
      await tap(page, at.x, at.y);
      return waitFor(`${shown}===${JSON.stringify(col)}`, 4000);
    };

    // --- the Board -------------------------------------------------------------------------------------
    // A short phone, so that the longest status runs past the bottom of the screen and the list has somewhere to scroll.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: SHORT_PHONE_HEIGHT, deviceScaleFactor: 1, mobile: true });
    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    const best = { col: await fullest() };
    check('the Board on the status with the most cards', await showTab(best.col), best);
    check('it shows four tiles whole', (await wholeTiles()).length >= 4, (await wholeTiles()).length);
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
    // A tile no hold has been on yet: the light a hold leaves pinned on its card would answer the wait for this hold at once.
    const [, s1] = await wholeTiles();
    const picksBefore = await ev(picked);
    await holdDrag(page, { x: s1.x, y: s1.y }, [{ x: s1.x - 150, y: s1.y }], { until: held(s1.id) });
    await realWait(300);
    check('a hold and a sideways drag does not swipe to the next status', await ev(shown) === best.col, await ev(shown));
    check('and it changes nothing it was not asked to', await ev(picked) === picksBefore, await ev(picked));

    // --- a swipe without a hold still swipes ------------------------------------------------------------
    const first = await ev(shown);
    const mid = await wholeTiles();
    await swipe(page, { x: mid[0].x + 80, y: mid[0].y }, { x: mid[0].x - 120, y: mid[0].y });
    check('a swipe without a hold still moves to the next status', await waitFor(`${shown}!==${JSON.stringify(first)}`, 4000), await ev(shown));
  },
};
