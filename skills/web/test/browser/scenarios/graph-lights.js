'use strict';
// What the Graph lights, on the plan board: a selection lights and the rest dims,
// a lone card lights with its one-hop relations, a search typed in the Graph is
// the anchor and lights its matches instead of hiding the rest, and what clears
// it. A click on a card writes the selection into the box (`#id`, or the typed
// query and the card side by side) with isolate off, so the box says what is picked. A lit dot wears .graph-near under a .graph-dim canvas, a dim one is drawn
// at the opacity the stylesheet gives it. Each step waits on the page, never on
// a fixed sleep. A card's dot is found by its class, and a card is only clicked
// where its dot is the topmost thing, so two dots drawn over one another cannot
// fail a check for the wrong reason.
//
// What each query lights, and the relations of the cards the scenario clicks,
// are written down in CASES and LONE, and skills/web/test/browser-graph-lights.test.js
// holds those lists to the search module and the Graph model over the plan
// board's own cards, so a wrong expectation fails in the unit suite and not only
// in a browser.
//
// The plan board's live cards are 1 to 18 and 22 to 29. Cards 5 and 10 carry the
// docs tag, and card 5 is done. Card 7 alone carries the security tag, and it has
// relations (a parent, a child, a wait), so lighting it alone is not lighting a
// card with none. Cards 1, 2, 7, 25 and 26 are the goal, strategy and objective
// cards, so slice:goal..objective is those five, and card 7 is the one among them
// that carries the security tag.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// hoveredId, isolateNow, selectedIds.

const CASES = {
  docs: { query: 'tags:docs', lit: [5, 10], done: 5 },
  one: { query: 'tags:security', lit: [7], relations: [2, 8, 22] },
  cut: { query: 'slice:goal..objective tags:security', draws: [1, 2, 7, 25, 26], lit: [7] },
};

// The cards the scenario may click for a lone card, each with the cards that
// light with it. The first whose dot is clear of the others is the one clicked.
const LONE = {
  2: [1, 2, 6, 7, 8],
  22: [7, 22, 23, 25],
  3: [1, 3, 4, 6],
  23: [22, 23, 24],
};

module.exports = {
  name: 'graph-lights',
  board: 'plan',
  timeoutMs: 90000,
  CASES,
  LONE,
  async run(page) {
    const { ev, send, open, waitFor, mouse, click, key, check } = page;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const sorted = (...ids) => ids.slice().sort((a, b) => a - b);
    const idsOf = (expr) => `JSON.stringify(${expr})`;
    const LIT = `[...document.querySelectorAll('.graph-node.graph-near')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`;
    const DIMMED = `document.querySelector('.graph-canvas').classList.contains('graph-dim')`;
    const lit = () => ev(LIT);
    const litIs = (ids) => waitFor(`${DIMMED}&&${idsOf(LIT)}===${JSON.stringify(JSON.stringify(ids))}`);
    const undimmed = () => waitFor(`!${DIMMED}&&document.querySelectorAll('.graph-node.graph-near').length===0`);
    const restIsDim = () => ev(`(()=>{const off=[...document.querySelectorAll('.graph-node')].filter((n)=>!n.classList.contains('graph-near'));return off.length>0&&off.every((n)=>getComputedStyle(n).opacity==='0.15')})()`);
    const pickedIs = (ids) => waitFor(`${idsOf(`[...selectedIds].map(Number).sort((a,b)=>a-b)`)}===${JSON.stringify(JSON.stringify(ids))}`);
    const dotCount = () => ev(`document.querySelectorAll('.graph-node').length`);
    const litLinks = () => ev(`document.querySelectorAll('.graph-link.graph-near').length`);
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const menuOpen = () => ev(`!!document.querySelector('.search-bar .combobox-menu:not([hidden])')`);

    // The centre of a card's dot, or null when another dot covers it.
    const dotPoint = (id) => ev(`(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`);
    const clickCard = async (id, extra = {}) => {
      const p = await dotPoint(id);
      if (!p) throw new Error(`no clickable point on the dot of card ${id}`);
      await click(p.x, p.y, extra);
    };
    const clickable = async (ids, n) => {
      const out = [];
      for (const id of ids) {
        if (out.length === n) break;
        if (await dotPoint(id)) out.push(id);
      }
      return out;
    };

    await open('/?view=graph');
    check('the Graph draws the plan board', await waitFor(`document.querySelectorAll('.graph-node').length>20`, 10000));
    const total = await dotCount();
    const ids = await ev(`[...document.querySelectorAll('.graph-node')].map((n)=>Number(n.dataset.id))`);
    const rect = await ev(`(()=>{const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {r:r.right,b:r.bottom}})()`);
    const bg = { x: rect.r - 14, y: rect.b - 14 };
    check('the empty corner of the Graph is not a card', await ev(`!document.elementFromPoint(${bg.x},${bg.y}).closest('.card-el')`));
    // The panel opens when the box is focused and hangs over the top of the Graph, where a dot may lie, and takes
    // an Esc of its own, so the arrow switches it off here; the search-panel scenario holds the panel itself.
    await ev(`(()=>{const t=document.getElementById('search-panel-toggle');if(t.getAttribute('aria-pressed')==='true')t.click()})()`);

    // Back to a Graph with nothing typed and nothing selected, lit by nothing, and the
    // pointer on the empty corner, so no dot under it lights its relations over what
    // a later step checks.
    const reset = async () => {
      await ev(`document.getElementById('search-clear-btn').click()`);
      await mouse('mouseMoved', bg.x, bg.y);
      await waitFor(`hoveredId===null`);
      await click(bg.x, bg.y);
      return undimmed();
    };
    // Types a query as a person does, into the focused box.
    const typeQuery = async (text) => {
      await reset();
      await ev(`document.getElementById('search-input').focus()`);
      await send('Input.insertText', { text });
    };

    const three = await clickable(ids, 3);
    check('three cards can be clicked without another dot in the way', three.length === 3, three);
    const [a, b, c] = three;
    await clickCard(a);
    await clickCard(b, { modifiers: 8 });
    await clickCard(c, { modifiers: 8 });
    check('a selection of three cards built with Shift+click lights exactly those three and dims the rest',
      await litIs(sorted(a, b, c)) && await pickedIs(sorted(a, b, c)) && await restIsDim(), { lit: await lit() });

    await reset();
    const lone = (await clickable(Object.keys(LONE).map(Number), 1))[0];
    check('a card with relations can be clicked without another dot in the way', lone !== undefined);
    await clickCard(lone);
    check('a click on one card lights it and its one-hop relations, and only that card is selected',
      await litIs(sorted(...LONE[lone])) && await pickedIs([lone])
        && await ev(`document.querySelectorAll('.graph-node.selected').length`) === 1 && await restIsDim(), { lone, lit: await lit() });

    await typeQuery(CASES.docs.query);
    check('a query typed in the Graph keeps every dot and lights its matches, a done one included, and dims the rest',
      await litIs(sorted(...CASES.docs.lit)) && (await dotCount()) === total && await restIsDim() && CASES.docs.lit.includes(CASES.docs.done),
      { lit: await lit(), dots: await dotCount(), total });

    await ev(`document.getElementById('search-clear-btn').click()`);
    check('clearing the box removes the dimming', await boxIs('') && await undimmed() && (await dotCount()) === total);

    await typeQuery(CASES.one.query);
    check('a typed query that matches one card lights that card alone, without its relations',
      await litIs(sorted(...CASES.one.lit)) && (await litLinks()) === 0 && await pickedIs(sorted(...CASES.one.lit)), { lit: await lit() });

    await typeQuery(CASES.cut.query);
    const DOTS = `[...new Set([...document.querySelectorAll('.graph-node')].map((n)=>Number(n.dataset.id)))].sort((a,b)=>a-b)`;
    check('a slice: term typed in the Graph hides the dots outside its cut, and the rest of the query lights inside the cut and dims the rest',
      await waitFor(`${idsOf(DOTS)}===${JSON.stringify(JSON.stringify(CASES.cut.draws))}`) && await litIs(sorted(...CASES.cut.lit)) && await restIsDim(), { lit: await lit(), dots: await ev(DOTS) });

    await typeQuery(CASES.docs.query);
    await litIs(sorted(...CASES.docs.lit));
    await clickCard(lone);
    check('after a typed query, a plain click on a card shows the card in the box and lights only that card and its relations',
      await boxIs(`#${lone}`) && await litIs(sorted(...LONE[lone])) && await pickedIs([lone]), { box: await boxText(), lit: await lit() });

    await typeQuery(CASES.docs.query);
    await litIs(sorted(...CASES.docs.lit));
    const unlit = (await clickable(ids.filter((id) => !CASES.docs.lit.includes(id)), 1))[0];
    await clickCard(unlit, { modifiers: 8 });
    check('after a typed query, Shift+click on an unlit card adds it: the box shows the query and the card, and the matches and the card light',
      await litIs(sorted(...CASES.docs.lit, unlit)) && await boxIs(`${CASES.docs.query} | #${unlit}`) && await pickedIs(sorted(...CASES.docs.lit, unlit)), { unlit, box: await boxText(), lit: await lit() });

    for (const inBox of [true, false]) {
      await typeQuery(CASES.docs.query);
      await litIs(sorted(...CASES.docs.lit));
      const menu = await menuOpen();
      if (!inBox) await ev(`document.getElementById('search-input').blur()`);
      await key('Escape');
      check(`with a typed query as the only part, Esc clears the box and the dimming, with focus ${inBox ? 'in the box' : 'outside it'}`,
        await boxIs('') && await undimmed() && !menu && await pickedIs([]), { menu });
    }

    await typeQuery(CASES.docs.query);
    await litIs(sorted(...CASES.docs.lit));
    await click(bg.x, bg.y, { clickCount: 1 });
    await click(bg.x, bg.y, { clickCount: 2 });
    check('with a typed query lit, a double click on the empty canvas clears the box and the dimming', await boxIs('') && await undimmed() && await pickedIs([]), { box: await boxText() });

    await typeQuery(CASES.docs.query);
    await litIs(sorted(...CASES.docs.lit));
    await ev(`document.querySelector('.graph-node[data-id="${lone}"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
    const hovered = await litIs(sorted(...LONE[lone]));
    await ev(`document.querySelector('.graph-node[data-id="${lone}"]').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`);
    check('hovering a dot lights its relations for a moment, and moving off brings back the lit selection', hovered && await litIs(sorted(...CASES.docs.lit)), { lit: await lit() });

    await ev(`document.getElementById('graph-toggle-btn').click()`);
    await waitFor(`!document.getElementById('board').classList.contains('hidden')`);
    // The Board hides what the box does not match only while isolate is on, and a switch writes nothing, so it is off: the Board
    // shows every card and the matches wear the selected look, though none is a selected card.
    const BOARD_IDS = `[...new Set([...document.querySelectorAll('#board .card-el')].map((e)=>Number(e.dataset.id)))].sort((x,y)=>x-y)`;
    const LIT_ON_BOARD = `${idsOf(`[...new Set([...document.querySelectorAll('#board .card-el.selected')].map((e)=>Number(e.dataset.id)))].sort((x,y)=>x-y)`)}===${JSON.stringify(JSON.stringify(sorted(...CASES.docs.lit)))}`;
    check('after typing a query in the Graph and switching to the Board, the Board lights the matches with the selected look and hides no card',
      await waitFor(LIT_ON_BOARD) && (await ev(`${BOARD_IDS}.length`)) > CASES.docs.lit.length && (await boxText()) === CASES.docs.query && await ev(`isolateNow()===null`), { box: await boxText(), shown: await ev(BOARD_IDS) });
    check('and nothing is selected, so a bulk action has no cards to act on', await pickedIs([]));

    await ev(`document.getElementById('graph-toggle-btn').click()`);
    await waitFor(`!document.getElementById('graph-view').classList.contains('hidden')`);
    check('back in the Graph with the box unchanged and nothing selected, the matches light again',
      (await boxText()) === CASES.docs.query && await litIs(sorted(...CASES.docs.lit)) && same(await lit(), sorted(...CASES.docs.lit)), { lit: await lit() });
  },
};
