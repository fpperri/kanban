'use strict';
// The Graph view on the fixture board, which has no hierarchy: the Hierarchy | Flow choice,
// pan/zoom, selection, search, reload. A card's dot is found by
// its class, so a later dot that is not a circle cannot fail a check for the
// wrong reason.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectedIds, isDragging, hoveredId, graphCur, autoRefreshTick, renderGraphView.
//
// A click on the empty canvas leaves the selection and a double click on it clears it,
// so a step that wants the selection gone makes the double click: two real clicks, the
// second with a click count of 2. A Ctrl+click on a picked dot takes it out again.

// The query typed in the Graph, and the cards it lights on the fixture board: three
// match by title and one by its title is done (card 12). Card 19 matches too and is
// archived, so it is not drawn. skills/web/test/browser-graph-lights.test.js holds
// the list to the search module over the board's own cards.
const LIGHT = { query: 'renew | zephyr', lit: [1, 2, 7, 11, 12], done: 12 };

const { openPanel } = require('../panel');

module.exports = {
  name: 'graph',
  board: 'fixture',
  timeoutMs: 100000,
  LIGHT,
  async run(page) {
    const { ev, send, open, waitFor, centre, mouse, click, shot, check } = page;
    const sleep = page.sleep;
    const world = () => ev(`(()=>{const w=document.querySelector('.graph-world');if(!w)return null;const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\) scale\\(([-\\d.e]+)\\)/.exec(w.getAttribute('transform'));return m?{x:+m[1],y:+m[2],k:+m[3]}:{raw:w.getAttribute('transform')}})()`);
    const waitWorld = async (pred, ms = 4000) => {
      const t0 = Date.now();
      let w = await world();
      while (Date.now() - t0 < page.scaled(ms)) {
        w = await world();
        if (w && pred(w)) return w;
        await sleep(40);
      }
      return w;
    };
    const stats = () => ev(`(()=>({nodes:document.querySelectorAll('.graph-node').length,links:document.querySelectorAll('.graph-link').length,bad:[...document.querySelectorAll('#graph-view [transform],#graph-view [d],#graph-view .graph-dot,#graph-view .graph-kids-ring,#graph-view .graph-flag-ring')].filter(e=>/NaN|Infinity|undefined/.test((e.getAttribute('transform')||'')+(e.getAttribute('d')||'')+(e.getAttribute('r')||'')+(e.getAttribute('cx')||''))).length,layout:(document.querySelector('.graph-kind-btn[aria-pressed=true]')||{dataset:{}}).dataset.graphKind,count:(document.querySelector('.graph-count')||{}).textContent,archivePill:(document.querySelector('.graph-filter-toggle[data-col=archive]')||{getAttribute(){return null}}).getAttribute('aria-pressed')}))()`);
    const layoutIs = (l) => `(document.querySelector('.graph-kind-btn[aria-pressed=true]')||{dataset:{}}).dataset.graphKind===${JSON.stringify(l)}&&document.querySelectorAll('.graph-node').length>0`;
    const pickLayout = async (l) => {
      await ev(`document.querySelector('.graph-kind-btn[data-graph-kind=${l}]').click()`);
      return waitFor(layoutIs(l));
    };
    const nodeCount = () => ev(`document.querySelectorAll('.graph-node').length`);
    const snap = () => ev(`(()=>{const o={};for(const n of document.querySelectorAll('.graph-node')){const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform'));o[n.dataset.id]={x:+m[1],y:+m[2]}}return o})()`);
    const search = async (v) => ev(`(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);

    await open('/?view=graph');
    check('graph renders after deep link ?view=graph', await waitFor(`document.querySelectorAll('.graph-node').length>0`, 10000));
    await openPanel(page);
    await waitFor(layoutIs('hierarchy'));
    let s = await stats();
    check('default graph is the Hierarchy', s.layout === 'hierarchy', s);
    check('no NaN/Infinity in drawn geometry', s.bad === 0, s.bad);
    check('every node is card-el with data-id', await ev(`[...document.querySelectorAll('.graph-node')].every(n=>n.classList.contains('card-el')&&/^\\d+$/.test(n.dataset.id))`));
    check('graph container visible and board hidden', await ev(`!document.getElementById('graph-view').classList.contains('hidden')&&document.getElementById('board').classList.contains('hidden')`));
    check('toggle button reads Board view and is pressed', await ev(`(()=>{const b=document.getElementById('graph-toggle-btn');return b.getAttribute('aria-pressed')==='true'&&/Board view/.test(b.textContent)})()`));
    const tiersNodes = s.nodes;
    await shot('tiers');

    await ev(`document.querySelector('#search-statuses .status-pill[data-col=archive]').click()`);
    await waitFor(`document.querySelectorAll('.graph-node').length>${tiersNodes}`);
    s = await stats();
    check('archive pill adds archived cards', s.nodes > tiersNodes && s.bad === 0, { before: tiersNodes, after: s.nodes });
    await shot('tiers-archive');
    await ev(`document.querySelector('#search-statuses .status-pill[data-col=archive]').click()`);
    await waitFor(`document.querySelectorAll('.graph-node').length===${tiersNodes}`);

    const hub = await ev(`(()=>{let best=null;for(const n of document.querySelectorAll('.graph-node')){const sc=n.classList.contains('graph-hub')?1:0;if(!best||sc>best.sc)best={sc,id:n.dataset.id};}return best&&best.id})()`);
    await ev(`document.querySelector('.graph-node[data-id="${hub}"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
    check('hover dims the graph and marks neighbours', await ev(`document.querySelector('.graph-canvas').classList.contains('graph-dim')&&document.querySelectorAll('.graph-near').length>=1`));
    await shot('hover');
    await ev(`document.querySelector('.graph-node[data-id="${hub}"]').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`);
    check('mouseout clears the focus', await ev(`!document.querySelector('.graph-canvas').classList.contains('graph-dim')&&document.querySelectorAll('.graph-near').length===0`));

    const w0 = await world();
    const pt = await centre('.graph-stage');
    const rect = await ev(`(()=>{const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}})()`);
    const bg = { x: rect.r - 14, y: rect.b - 14 };
    check('background pixel is not a node', await ev(`!document.elementFromPoint(${bg.x},${bg.y}).closest('.card-el')`));
    const first = await ev(`document.querySelector('.graph-node').dataset.id`);
    const dotSel = `.graph-node[data-id="${first}"] .graph-dot`;
    let nc = await centre(dotSel);
    await click(nc.x, nc.y, { modifiers: 2 });
    await waitFor(`selectedIds.size>=1`);
    const sel1 = await ev(`selectedIds.size`);
    await mouse('mousePressed', bg.x, bg.y); await mouse('mouseMoved', bg.x - 40, bg.y - 20, { buttons: 1 });
    check('isDragging is set mid-pan', await ev(`isDragging===true`));
    await mouse('mouseMoved', bg.x - 120, bg.y - 60, { buttons: 1 }); await mouse('mouseReleased', bg.x - 120, bg.y - 60);
    const w1 = await waitWorld((w) => Math.abs((w.x - w0.x) + 120) < 3 && Math.abs((w.y - w0.y) + 60) < 3);
    check('drag pans the world', Math.abs((w1.x - w0.x) + 120) < 3 && Math.abs((w1.y - w0.y) + 60) < 3, { w0, w1 });
    check('isDragging cleared after the pan', await waitFor(`isDragging===false`));
    const selAfterPan = await ev(`selectedIds.size`);
    check('a pan does not clear the selection (phantom click swallowed)', selAfterPan === sel1 && sel1 >= 1, { sel1, after: selAfterPan });
    await click(bg.x, bg.y, { clickCount: 1 });
    await click(bg.x, bg.y, { clickCount: 2 });
    check('a double click on the empty canvas after a pan clears the selection', await waitFor(`selectedIds.size===0`));

    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pt.x, y: pt.y, deltaX: 0, deltaY: -240 });
    const w2 = await waitWorld((w) => w.k > w1.k);
    check('wheel zooms in', w2.k > w1.k, { k1: w1.k, k2: w2.k });
    await ev(`document.querySelector('.graph-zoom-btn[data-graph-action=out]').click()`);
    const w3 = await waitWorld((w) => w.k < w2.k);
    check('zoom out button zooms out', w3.k < w2.k, { k2: w2.k, k3: w3.k });
    await ev(`document.querySelector('.graph-zoom-btn[data-graph-action=fit]').click()`);
    const w4 = await waitWorld((w) => Math.abs(w.k - w0.k) < 0.02);
    check('Fit restores the fitted view', Math.abs(w4.k - w0.k) < 0.02, { w0, w4 });
    await shot('after-fit');
    nc = await centre(dotSel);
    await click(nc.x, nc.y, { modifiers: 2 });
    await waitFor(`selectedIds.size>=1`);
    const selBefore = await ev(`selectedIds.size`);
    const zin = await centre('.graph-zoom-btn[data-graph-action=in]');
    const kFit = (await world()).k;
    await click(zin.x, zin.y);
    await waitWorld((w) => w.k > kFit);
    const selAfterZoom = await ev(`selectedIds.size`);
    check('clicking a zoom button keeps a multi-selection', selBefore >= 1 && selAfterZoom === selBefore, { selBefore, now: selAfterZoom });
    const wz = await world();
    await ev(`document.querySelector('.graph-kind-btn[aria-pressed=true]').click()`);
    const wz2 = await world();
    check('clicking the pressed graph choice keeps the zoomed view', wz.k > kFit && Math.abs(wz.k - wz2.k) < 1e-6 && Math.abs(wz.x - wz2.x) < 0.5, { kFit, wz, wz2 });
    check('a zoom-button click does not leave focus on a poll-blocking control', await ev(`!document.activeElement.classList.contains('graph-zoom-btn')`));
    await ev(`document.querySelector('.graph-zoom-btn[data-graph-action=fit]').click()`);
    await waitWorld((w) => Math.abs(w.k - w0.k) < 0.02);

    nc = await centre(dotSel);
    await click(nc.x, nc.y);
    await waitFor(`selectedIds.size===1`);
    await sleep(250);
    const url0 = await ev(`location.search`);
    check('plain click selects and does NOT open the card', !/card=\d+/.test(url0) && (await ev(`selectedIds.size`)) === 1 && (await ev(`document.querySelectorAll('.graph-node.selected').length`)) === 1, { url0 });
    check('a selected card keeps its relations lit', await ev(`document.querySelector('.graph-canvas').classList.contains('graph-dim')&&document.querySelectorAll('.graph-node.graph-near').length>=1`));
    await mouse('mouseMoved', bg.x, bg.y);
    const hoverGone = await waitFor(`hoveredId===null`);
    check('the selection focus survives the pointer leaving', hoverGone && await ev(`document.querySelector('.graph-canvas').classList.contains('graph-dim')`));
    await shot('selected');
    await click(nc.x, nc.y, { clickCount: 1 });
    await click(nc.x, nc.y, { clickCount: 2 });
    const opened = await waitFor(`/card=\\d+/.test(location.search)`, 2500);
    check('double click opens the card (URL gains card=)', opened, await ev(`location.search`));
    await shot('detail-open');
    await page.key('Escape');
    await waitFor(`!/card=\\d+/.test(location.search)`, 2000);
    await click(bg.x, bg.y);
    await ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    check('clicking empty canvas leaves the selection', (await ev(`selectedIds.size`)) >= 1);
    await click(bg.x, bg.y, { clickCount: 1 });
    await click(bg.x, bg.y, { clickCount: 2 });
    check('double-clicking empty canvas clears the selection', await waitFor(`selectedIds.size===0`));

    const nBefore = await nodeCount();
    await search(LIGHT.query);
    const litIds = `JSON.stringify([...document.querySelectorAll('.graph-node.graph-near')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b))`;
    const litNow = await waitFor(`document.querySelector('.graph-canvas').classList.contains('graph-dim')&&${litIds}===${JSON.stringify(JSON.stringify(LIGHT.lit))}`);
    const restDim = await ev(`(()=>{const off=[...document.querySelectorAll('.graph-node')].filter((n)=>!n.classList.contains('graph-near'));return off.length>0&&off.every((n)=>getComputedStyle(n).opacity==='0.15')})()`);
    const nSearch = await nodeCount();
    check('a query typed in the Graph keeps every dot, lights its matches, a done one included, and dims the rest', litNow && restDim && nSearch === nBefore && LIGHT.lit.includes(LIGHT.done), { nBefore, nSearch, lit: await ev(litIds) });
    await search('');
    check('clearing search restores the graph', await waitFor(`document.querySelectorAll('.graph-node').length===${nBefore}&&!document.querySelector('.graph-canvas').classList.contains('graph-dim')&&document.querySelectorAll('.graph-node.graph-near').length===0`));

    const hubInfo = await ev(`(()=>{let best=null;for(const n of graphCur.model.nodes){if(!best||n.deg>best.deg)best=n}return {id:best.id}})()`);
    const tp0 = await snap();
    const tw0 = await world();
    const tc = await centre(`.graph-node[data-id="${hubInfo.id}"] .graph-dot`);
    await mouse('mousePressed', tc.x, tc.y); await mouse('mouseMoved', tc.x + 60, tc.y + 30, { buttons: 1 }); await mouse('mouseMoved', tc.x + 120, tc.y + 60, { buttons: 1 }); await mouse('mouseReleased', tc.x + 120, tc.y + 60);
    await sleep(150);
    const tp1 = await snap();
    const tw1 = await world();
    check('in Tiers a card does not drag and the view does not pan from it', Math.hypot(tp1[hubInfo.id].x - tp0[hubInfo.id].x, tp1[hubInfo.id].y - tp0[hubInfo.id].y) < 0.01 && Math.abs(tw1.x - tw0.x) < 0.5, { tw0, tw1 });
    await mouse('mousePressed', bg.x, bg.y); await mouse('mouseMoved', bg.x - 90, bg.y - 40, { buttons: 1 }); await mouse('mouseReleased', bg.x - 90, bg.y - 40);
    await waitFor(`isDragging===false`);
    const wp = await world();
    await ev(`(async()=>{await autoRefreshTick();await autoRefreshTick();})()`);
    await sleep(100);
    const wq = await world();
    check('the 5s poll keeps the user pan', Math.abs(wp.x - wq.x) < 0.5 && Math.abs(wp.k - wq.k) < 1e-6, { wp, wq });

    await pickLayout('flow');
    await send('Page.reload');
    await waitFor(layoutIs('flow'), 10000);
    s = await stats();
    check('layout choice survives a reload (view.mode + graph.layout)', s.layout === 'flow' && s.nodes > 0, s);

    await ev(`document.getElementById('graph-toggle-btn').click()`);
    check('toggle returns to the board', await waitFor(`document.getElementById('graph-view').classList.contains('hidden')&&!document.getElementById('board').classList.contains('hidden')`));

    await open('/?view=graph');
    await waitFor(`document.querySelectorAll('.graph-node').length>0`, 10000);
    await pickLayout('hierarchy');
    if (page.shotsOn) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      await sleep(300);
      await shot('dark-tiers');
      await pickLayout('flow');
      await shot('dark-flow');
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
      await sleep(300);
      await shot('light-flow');
      await pickLayout('hierarchy');
      await shot('light-tiers');
    }
    await ev(`(()=>{for(let i=0;i<5;i++)renderGraphView();return 1})()`);
  },
};
