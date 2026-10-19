'use strict';
// How a selection grows in the Graph, on the plan board: a click makes a card the
// anchor of a new selection, Shift or Ctrl adds one card or takes it out, a pan
// keeps the selection, a click on the empty Graph leaves it and a double click there
// clears it, and the cards picked
// are the cards the Board shows as selected after a view switch and a poll. Each
// step waits on the page, never on a fixed sleep. A card's dot is found by its
// class, and a card is only clicked where its dot is the topmost thing, so two
// dots drawn over one another cannot fail a check for the wrong reason.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectedIds, selectionState, autoRefreshTick.

module.exports = {
  name: 'selection',
  board: 'plan',
  async run(page) {
    const { ev, open, waitFor, mouse, click, check } = page;
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const picked = () => ev(`[...selectedIds].map(Number).sort((a,b)=>a-b)`);
    const lit = () => ev(`[...document.querySelectorAll('.graph-node.selected')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`);
    const parts = () => ev(`(()=>{const s=selectionState.selection;return {anchor:s.anchor&&Number(s.anchor.id),additions:s.additions.map((p)=>Number(p.id))}})()`);
    const sameIds = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const sorted = (...ids) => ids.slice().sort((a, b) => a - b);
    const hasSelection = (n) => waitFor(`selectedIds.size===${n}`);

    // The centre of a card's dot, or null when another dot covers it.
    const dotPoint = (id) => ev(`(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`);
    const clickCard = async (id, extra = {}) => {
      const p = await dotPoint(id);
      if (!p) throw new Error(`no clickable point on the dot of card ${id}`);
      await click(p.x, p.y, extra);
    };
    const noCardOpen = () => ev(`!/card=\\d+/.test(location.search)`);

    await open('/?view=graph');
    check('the Graph draws the plan board', await waitFor(`document.querySelectorAll('.graph-node').length>3`, 10000));
    const ids = await ev(`[...document.querySelectorAll('.graph-node')].map((n)=>Number(n.dataset.id))`);
    const clickable = [];
    for (const id of ids) if (clickable.length < 3 && await dotPoint(id)) clickable.push(id);
    check('three cards can be clicked without another dot in the way', clickable.length === 3, clickable);
    const [a, b, c] = clickable;

    await clickCard(a);
    check('a click on a card selects that card alone and makes it the anchor', await hasSelection(1) && sameIds(await picked(), [a]) && sameIds(await lit(), [a]) && sameIds(await parts(), { anchor: a, additions: [] }), { picked: await picked(), parts: await parts() });

    await clickCard(b, { modifiers: 8 });
    check('Shift+click on a second card adds exactly that card', await hasSelection(2) && sameIds(await picked(), sorted(a, b)) && sameIds(await lit(), sorted(a, b)), await picked());
    check('the first card picked is the anchor and the second is an addition', sameIds(await parts(), { anchor: a, additions: [b] }), await parts());

    await clickCard(b, { modifiers: 8 });
    check('Shift+click on the added card takes it out and leaves the anchor', await hasSelection(1) && sameIds(await picked(), [a]) && sameIds(await lit(), [a]) && sameIds(await parts(), { anchor: a, additions: [] }), await parts());

    await clickCard(b, { modifiers: 2 });
    const added = await hasSelection(2) && sameIds(await picked(), sorted(a, b));
    await clickCard(b, { modifiers: 2 });
    check('Ctrl+click does the same as Shift+click: it adds one card and takes it out', added && await hasSelection(1) && sameIds(await picked(), [a]), await picked());

    await clickCard(b, { modifiers: 8 });
    await hasSelection(2);
    await clickCard(c);
    check('a click on another card starts a new selection holding that card alone', await hasSelection(1) && sameIds(await picked(), [c]) && sameIds(await lit(), [c]) && sameIds(await parts(), { anchor: c, additions: [] }), { picked: await picked(), parts: await parts() });

    const rect = await ev(`(()=>{const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {r:r.right,b:r.bottom}})()`);
    const bg = { x: rect.r - 14, y: rect.b - 14 };
    check('the empty corner of the Graph is not a card', await ev(`!document.elementFromPoint(${bg.x},${bg.y}).closest('.card-el')`));
    await mouse('mousePressed', bg.x, bg.y);
    await mouse('mouseMoved', bg.x - 40, bg.y - 20, { buttons: 1 });
    await mouse('mouseMoved', bg.x - 120, bg.y - 60, { buttons: 1 });
    await mouse('mouseReleased', bg.x - 120, bg.y - 60);
    await waitFor(`isDragging===false`);
    check('a pan keeps the selection', sameIds(await picked(), [c]) && sameIds(await parts(), { anchor: c, additions: [] }), await picked());

    await click(bg.x, bg.y);
    await frames();
    check('a click on the empty Graph leaves the selection', sameIds(await picked(), [c]) && sameIds(await lit(), [c]) && sameIds(await parts(), { anchor: c, additions: [] }), await parts());
    await click(bg.x, bg.y, { clickCount: 1 });
    await click(bg.x, bg.y, { clickCount: 2 });
    check('a double click on the empty Graph clears the selection', await hasSelection(0) && sameIds(await lit(), []) && sameIds(await parts(), { anchor: null, additions: [] }), await parts());

    await clickCard(a);
    await hasSelection(1);
    await clickCard(b, { modifiers: 8 });
    await hasSelection(2);
    await ev(`document.getElementById('graph-toggle-btn').click()`);
    check('the Board shows after the view switch', await waitFor(`!document.getElementById('board').classList.contains('hidden')&&document.querySelectorAll('#board .card-el').length>0`));
    const onBoard = () => ev(`[...new Set([...document.querySelectorAll('#board .card-el.selected')].map((e)=>Number(e.dataset.id)))].sort((x,y)=>x-y)`);
    check('two cards picked in the Graph with Shift show as selected on the Board after a view switch', sameIds(await onBoard(), sorted(a, b)) && sameIds(await picked(), sorted(a, b)), { board: await onBoard(), picked: await picked() });

    await ev(`window.__tile=document.querySelector('#board .card-el[data-id="${a}"]')`);
    await ev(`(async()=>{await autoRefreshTick()})()`);
    check('the poll repainted the Board', await waitFor(`document.querySelector('#board .card-el[data-id="${a}"]')!==window.__tile`));
    check('and the two cards are still selected after the poll', sameIds(await onBoard(), sorted(a, b)) && sameIds(await picked(), sorted(a, b)) && sameIds(await parts(), { anchor: a, additions: [b] }), { board: await onBoard(), parts: await parts() });
    check('none of those clicks opened a card', await noCardOpen());
  },
};
