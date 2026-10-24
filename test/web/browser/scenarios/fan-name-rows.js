'use strict';
// Where the tier fan's names sit, on the plan board with names on all. A parent, a card with a
// child drawn, is named beside its ring; every other card in a row outside the rim, joined to its
// dot by a leader; with the table choice, the Unnested block's cards in a list above the block.
// A name is never tilted and keeps its size on screen at any zoom: its height on screen is the
// same at Fit and two zoom presses in, and the text is drawn at 11px. A named card whose name
// found room shows it, one with no room keeps its id label, so the names shown are the names the
// page placed (graphCur.names), and no two of them overlap on screen. A zoom places the names
// again once it settles; a pan, which keeps the zoom, places nothing; a poll that brings a card
// places again and the new card is placed or left unnamed; a poll that brings nothing new draws
// the fan again and places nothing. With names on none no leader is drawn, before a click on a
// dot or after it. The malformed board places its names under outermost and table. The harness
// closes the scenario with the console-error check, which covers both boards.
//
// Shots: names-all (the plan board at Fit, names on all) and names-table (the same with the
// Unnested block).
//
// skills/web/test/browser-fan-name-rows-scenario.test.js answers these expressions from the
// real placement over the real boards, and varies the page so a check that could never fail
// is caught.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur, graphLoadOptions, graphSetOption, autoRefreshTick.

const {
  DRAWN, TIERS_PRESSED, ZOOM_IN, FIT, FITTED, TABLE_DRAWN, hasDot,
} = require('./tier-fan');
const { TICK, CANVAS_SPACE, SELECTED, createCard, dotPoint } = require('./tier-fan-options');

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const CASES = {
  plan: {
    live: [...range(1, 18), ...range(22, 29)],
    parents: [1, 2, 7, 22, 23],
    added: { title: 'Name the new card', status: 'todo' },
    addedId: 30,
    // Cards to click under names none, the first that is under no other dot.
    picks: [5, 3, 12, 14],
  },
  malformed: { live: range(1, 4) },
};

const NODES = `[...document.querySelectorAll('#graph-view .graph-node')]`;
const nameIn = (n) => `${n}.querySelector('.graph-node-name')`;
const shownIn = (n) => `(()=>{const t=${nameIn(n)};return !!t&&getComputedStyle(t).display!=='none'})()`;
// The page placed the names at the zoom it shows: none queued, none stale.
const SETTLED = `!!graphCur&&!!graphCur.names&&graphCur.names.k===graphCur.view.k`;
const PLACED = `[...graphCur.names.placed.keys()].map(Number).sort((a,b)=>a-b)`;
const KINDS = `(()=>{const out={};for(const p of graphCur.names.placed.values())out[p.kind]=(out[p.kind]||0)+1;return out})()`;
// The cards whose name shows, as a person sees it, in order.
const SHOWN = `${NODES}.filter((n)=>${shownIn('n')}).map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`;
const SHOWN_IS_PLACED = `JSON.stringify(${SHOWN})===JSON.stringify(${PLACED})`;
// Every card has exactly one name, a text with no markup in it, and one leader, a path.
const ONE_EACH = `${NODES}.length>0&&${NODES}.every((n)=>{const t=n.querySelectorAll('.graph-node-name');const l=n.querySelectorAll('.graph-node-leader');`
  + `return t.length===1&&t[0].tagName.toLowerCase()==='text'&&t[0].children.length===0&&l.length===1&&l[0].tagName.toLowerCase()==='path'})`;
// Each shown name's box on screen: as wide as its text is drawn, and as high as the size it is
// drawn at (`h` is the height of the line box, which also holds the font's room above and below
// the letters, so rows of names one line apart share a pixel or two of it).
const RECTS = `${NODES}.filter((n)=>${shownIn('n')}).map((n)=>{const t=${nameIn('n')};const b=t.getBoundingClientRect();`
  + `const em=parseFloat(getComputedStyle(t).fontSize)*t.getScreenCTM().a;const mid=(b.top+b.bottom)/2;`
  + `return {id:Number(n.dataset.id),l:b.left,t:mid-em/2,r:b.right,b:mid+em/2,h:b.height}})`;
// The pairs of shown names whose boxes share more than a pixel each way.
const OVERLAPS = `(()=>{const r=${RECTS};const out=[];for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){const a=r[i],b=r[j];`
  + `if(a.l<b.r-1&&b.l<a.r-1&&a.t<b.b-1&&b.t<a.b-1)out.push([a.id,b.id])}return out})()`;
// Each shown name's height on screen and the size its text is drawn at on screen, by card.
const HEIGHTS = `(()=>{const out={};for(const n of ${NODES}){if(!${shownIn('n')})continue;const t=${nameIn('n')};const m=t.getScreenCTM();`
  + `out[n.dataset.id]={h:t.getBoundingClientRect().height,px:parseFloat(getComputedStyle(t).fontSize)*m.a}}return out})()`;
// No name is tilted: nothing turns it, from its own attributes, its style or any group above it.
const UPRIGHT = `[...document.querySelectorAll('#graph-view .graph-node-name')].every((t)=>{const m=t.getScreenCTM();`
  + `return !!m&&Math.abs(m.b)<1e-6&&Math.abs(m.c)<1e-6&&m.a>0&&m.d>0&&!t.hasAttribute('transform')&&!t.hasAttribute('rotate')&&getComputedStyle(t).transform==='none'})`;
// The leaders drawn: a path with something in it, or one the stylesheet shows.
const LEADERS_DRAWN = `[...document.querySelectorAll('#graph-view .graph-node-leader')].filter((l)=>(l.getAttribute('d')||'')!==''||getComputedStyle(l).display!=='none').length`;
// The cards whose leader shows are the cards placed in a row or a list.
const LEADERS_ARE_CALLED = `JSON.stringify(${NODES}.filter((n)=>{const l=n.querySelector('.graph-node-leader');return !!l&&getComputedStyle(l).display!=='none'&&(l.getAttribute('d')||'')!==''})`
  + `.map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b))===JSON.stringify([...graphCur.names.placed].filter(([,p])=>!!p.leader).map(([id])=>Number(id)).sort((a,b)=>a-b))`;
// Every shown name of an Unnested block card sits above the block's frame, and there is one.
const BLOCK_ABOVE = `(()=>{const f=document.querySelector('#graph-view .graph-block-frame');if(!f||!graphCur.plan.block)return false;const top=f.getBoundingClientRect().top;`
  + `const ids=new Set(graphCur.plan.block.columns.flatMap((c)=>c.ids));const own=${NODES}.filter((n)=>ids.has(n.dataset.id)&&${shownIn('n')});`
  + `return own.length>0&&own.every((n)=>${nameIn('n')}.getBoundingClientRect().bottom<=top+0.5)})()`;
// The placement as it is now, kept to compare with the next one, and the drawn fan likewise.
const KEEP = `(window.__names=graphCur.names,true)`;
const KEPT = `graphCur.names===window.__names`;
const MARK_DRAWN = `(window.__drawn=document.querySelector('#graph-view .graph-node'),true)`;
const REDRAWN = `!!document.querySelector('#graph-view .graph-node')&&document.querySelector('#graph-view .graph-node')!==window.__drawn`;
const ZOOM = `graphCur.view.k`;
const VIEW_AT = `({x:graphCur.view.x,y:graphCur.view.y,k:graphCur.view.k})`;
const namesAre = (value) => `graphLoadOptions().names===${JSON.stringify(value)}`;
const useNames = (value) => `graphSetOption('names',${JSON.stringify(value)})`;
const USE_TABLE = `graphSetOption('unnested','table')`;
const PLACED_OR_UNNAMED = (id) => `graphCur.names.placed.has('${id}')||graphCur.names.unnamed.includes('${id}')`;
const frames = `new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`;

// Over the cards shown at both zoom levels: the most a name's height on screen moved, and every
// height and text size on screen.
const heightsHold = (a, b) => {
  const both = Object.keys(a).filter((id) => b[id]);
  const moved = both.length ? Math.max(...both.map((id) => Math.abs(a[id].h - b[id].h))) : Infinity;
  const all = [...Object.values(a), ...Object.values(b)];
  return {
    both: both.length, moved, sizes: all.every((x) => x.h >= 11 && x.h <= 17), px: all.every((x) => Math.abs(x.px - 11) < 0.05),
  };
};

const { openPanel } = require('../panel');

module.exports = {
  name: 'fan-name-rows',
  board: 'plan',
  alsoBoards: ['malformed'],
  timeoutMs: 60000,
  CASES,
  SETTLED,
  PLACED,
  KINDS,
  SHOWN,
  SHOWN_IS_PLACED,
  ONE_EACH,
  RECTS,
  OVERLAPS,
  HEIGHTS,
  UPRIGHT,
  LEADERS_DRAWN,
  LEADERS_ARE_CALLED,
  BLOCK_ABOVE,
  KEEP,
  KEPT,
  MARK_DRAWN,
  REDRAWN,
  ZOOM,
  VIEW_AT,
  USE_TABLE,
  namesAre,
  useNames,
  PLACED_OR_UNNAMED,
  heightsHold,
  async run(page) {
    const {
      ev, open, waitFor, check, shot, mouse, click,
    } = page;
    const plan = CASES.plan;

    // A page that is being left still answers for a moment after the navigation starts, so a wait
    // on the new page would read the old one. The old page is marked, and the new one is the first
    // without the mark.
    const load = async (boardKey) => {
      await ev('window.__stale=true');
      await open('/?view=graph', boardKey);
      await waitFor('!window.__stale', 10000);
      await openPanel(page);
      return waitFor(`${DRAWN}&&${TIERS_PRESSED}`, 10000);
    };
    const frame = () => ev(frames);
    const settled = () => waitFor(SETTLED, 6000);
    // What every check of a drawn fan reads: one name and one leader for each card, the names
    // shown the names placed, the leaders shown the ones placed in a row or a list, none of the
    // names over another.
    const state = async () => ({
      one: await ev(ONE_EACH), shownIsPlaced: await ev(SHOWN_IS_PLACED), called: await ev(LEADERS_ARE_CALLED), overlaps: await ev(OVERLAPS),
    });
    const sound = (s) => s.one && s.shownIsPlaced && s.called && s.overlaps.length === 0;
    const detail = async () => ({ ...(await state()), shown: await ev(SHOWN), placed: await ev(PLACED) });

    // --- names on all, at Fit -----------------------------------------------------------------------
    check('plan: the Graph draws in Tiers', await load('plan'));
    await ev(useNames('all'));
    check('plan: names on all, placed at the zoom shown', await waitFor(namesAre('all'), 4000) && await settled(), await ev(VIEW_AT));
    const kinds = await ev(KINDS);
    check('plan: parents are named beside their rings and other cards in rows', (kinds.beside || 0) > 0 && (kinds.row || 0) > 0, kinds);
    const placed = await ev(PLACED);
    check('plan: the five parents are among the names placed', plan.parents.every((id) => placed.includes(id)), placed);
    check('plan: at Fit, every card has one name and one leader, the names shown are the names placed, and none overlaps another', sound(await state()), await detail());
    check('plan: a leader is drawn for each name in a row', (await ev(LEADERS_DRAWN)) === (kinds.row || 0) + (kinds.list || 0), { drawn: await ev(LEADERS_DRAWN), kinds });
    check('plan: no name is rotated', await ev(UPRIGHT));
    await shot('names-all');
    const atFit = await ev(HEIGHTS);
    const k0 = await ev(ZOOM);

    // --- a zoom places again once it settles; the height on screen holds -------------------------------
    await ev(ZOOM_IN);
    await ev(ZOOM_IN);
    check('plan: two zoom presses zoom in more than 1.4 times', await waitFor(`${ZOOM}>${k0}*1.4`, 4000), { from: k0, to: await ev(ZOOM) });
    check('plan: once the zoom settles the names are placed again at it', await settled(), await ev(VIEW_AT));
    const zoomed = await ev(HEIGHTS);
    const held = heightsHold(atFit, zoomed);
    check('plan: names keep their on-screen height at two zoom levels', held.both >= 5 && held.moved <= 0.5 && held.sizes, held);
    check('plan: and their text is drawn at 11px on screen at both', held.px, held);
    check('plan: no name is rotated, zoomed in', await ev(UPRIGHT));
    check('plan: after the zoom, one name and one leader for each card, the names shown are the names placed, none over another', sound(await state()), await detail());

    // --- a pan places nothing ------------------------------------------------------------------------------
    await ev(KEEP);
    const before = await ev(VIEW_AT);
    const bare = await ev(CANVAS_SPACE);
    check('plan: the canvas has empty space to drag from', !!bare);
    if (bare) {
      await mouse('mousePressed', bare.x, bare.y);
      await mouse('mouseMoved', bare.x + 40, bare.y + 30, { buttons: 1 });
      await mouse('mouseMoved', bare.x + 90, bare.y + 60, { buttons: 1 });
      await mouse('mouseReleased', bare.x + 90, bare.y + 60);
      await frame();
      const after = await ev(VIEW_AT);
      check('plan: the drag pans the view and keeps the zoom', after.x !== before.x && after.k === before.k, { before, after });
      check('plan: a pan places nothing: the placement is the one before it', await ev(KEPT) && await ev(SETTLED));
      check('plan: after the pan, one name and one leader for each card, the names shown are the names placed, none over another', sound(await state()), await detail());
    }

    // --- a poll ------------------------------------------------------------------------------------------------
    check('plan: a card is added through the board\'s API', (await ev(createCard(plan.added))) === 201);
    await ev(KEEP);
    await ev(MARK_DRAWN);
    await ev(TICK);
    check('plan: the next poll draws it', await waitFor(hasDot(plan.addedId), 8000));
    check('plan: and places the names again, the new card placed or left with its id label', await settled() && !(await ev(KEPT)) && await ev(PLACED_OR_UNNAMED(plan.addedId)), await ev(PLACED));
    check('plan: after the poll, one name and one leader for each card, the names shown are the names placed, none over another', sound(await state()), await detail());
    await ev(KEEP);
    await ev(MARK_DRAWN);
    await ev(TICK);
    await frame();
    check('plan: a poll with nothing new draws the fan again and places nothing', await ev(REDRAWN) && await ev(KEPT) && await ev(SETTLED));
    check('plan: and after it, one name and one leader for each card, the names shown are the names placed, none over another', sound(await state()), await detail());

    // --- the Unnested block's names sit above it ---------------------------------------------------------------
    await ev(USE_TABLE);
    check('plan: with the table choice the Unnested block is drawn', await waitFor(TABLE_DRAWN, 6000));
    await ev(FIT);
    check('plan: Fit frames it, and the names are placed at the new zoom', await waitFor(FITTED, 4000) && await settled(), await ev(VIEW_AT));
    check('plan: the block\'s names sit in a list above it', await ev(BLOCK_ABOVE) && ((await ev(KINDS)).list || 0) > 0, await ev(KINDS));
    check('plan: with the block, one name and one leader for each card, the names shown are the names placed, none over another', sound(await state()), await detail());
    check('plan: no name is rotated, with the block', await ev(UPRIGHT));
    await shot('names-table');

    // --- names on none: no leader ----------------------------------------------------------------------------
    await ev(useNames('none'));
    check('plan: with names on none, no name shows and no leader is drawn', await waitFor(namesAre('none'), 4000) && await settled()
      && (await ev(SHOWN)).length === 0 && (await ev(LEADERS_DRAWN)) === 0, { shown: await ev(SHOWN), leaders: await ev(LEADERS_DRAWN) });
    let at = null;
    let pick = null;
    for (const id of plan.picks) {
      at = await ev(dotPoint(id));
      if (at) { pick = id; break; }
    }
    check('plan: a dot is there to click', !!pick, plan.picks);
    if (pick) {
      await click(at.x, at.y);
      check('plan: a click on it selects it', await waitFor(`${SELECTED}.length===1&&${SELECTED}[0]===${pick}`, 4000), await ev(SELECTED));
      await frame();
      check('plan: and with the card selected, under none still no leader is drawn', (await ev(LEADERS_DRAWN)) === 0, await ev(LEADERS_DRAWN));
    }

    // --- the malformed board ------------------------------------------------------------------------------------
    check('malformed: the Graph draws in Tiers', await load('malformed'));
    await ev(useNames('all'));
    check('malformed: names on all are placed', await waitFor(namesAre('all'), 4000) && await settled(), await ev(VIEW_AT));
    check('malformed: one name and one leader for each card, the names shown are the names placed, none over another', sound(await state()), await detail());
    check('malformed: every card is named or keeps its id label', (await ev(`${PLACED}.length+graphCur.names.unnamed.length`)) === CASES.malformed.live.length, await ev(PLACED));
    await ev(USE_TABLE);
    check('malformed: with the table choice the Unnested block is drawn', await waitFor(TABLE_DRAWN, 6000));
    await ev(FIT);
    check('malformed: Fit frames it, and the names are placed at the new zoom', await waitFor(FITTED, 4000) && await settled(), await ev(VIEW_AT));
    check('malformed: with the block, one name and one leader for each card, the names shown are the names placed, none over another', sound(await state()), await detail());
  },
};
