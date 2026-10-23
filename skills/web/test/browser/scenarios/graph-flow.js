'use strict';
// The Graph's Flow, on the plan board. The toolbar at the top right has a Hierarchy | Flow choice, Hierarchy
// (the tier fan, with its layouts and options) pressed. Flow lays the board out by its dependencies in
// columns, with the Dependencies switch beside it, frontier or all, and the Lanes switch, off at first:
//   frontier  done (faded, first), ready now, 1 step, 2 steps ..., loop; only dependencies not done count.
//   all       waits for nothing, chain 1, chain 2 ...; done dependencies count.
// Cards with no dependency either way sit in a strip below the columns, with a count. The arrows run from
// the card waited for to the card that waits, and there are no parent lines. A dot keeps its status colour
// and its type mark. Search lighting, the status pills, slice:, isolate, selection, the card menu and the
// zoom work as in Hierarchy, a lone card lighting with its dependencies. Lanes on puts each card with a
// dependency in the lane of its nearest parent with a tier, else its root: under a header with that card's
// type mark, tier, #id title, cards and ready cards, which is that card's node (click, Shift/Ctrl-click, double click,
// Enter, Ctrl+Space, hover, focus, the card menu and the lighting act on it as on its dot, and the two select together),
// and the columns stand across the lanes. The choice and the switches are kept for the board in the browser
// and in the address (graph=, deps=, lanes=), the address winning on a load; and the panel works as the
// phone's bottom sheet.
//
// The lanes of the plan board: card 1 (a goal) holds 2, 3, 4, 5 and 6, card 2 (a strategy) holds 7 and 8,
// and card 27 has no parent and is its own lane. Frontier puts the lane of card 1 first (cards 2 and 3 are
// ready), then card 2's and 27's in outline order; all keeps the outline order.
//
// A press is a real click at the centre of the element, as a person makes it, and every wait is on the
// page, never on a fixed sleep.
//
// The plan board's live cards are 1 to 18 and 22 to 29. Seven of them are joined by a wait: 4 waits for 3;
// 6 for 2, 3 and 5; 8 for 7; 27 for 5 (card 18 waits for a card that is not on the board). Card 5 is done, so
// frontier has it alone in the done column, the cards waiting for nothing open (2, 3, 7) and 27, whose only
// dependency is done, in ready now, and 4, 6 and 8 one step on. All counts the done dependency: 2, 3, 5 and 7
// wait for nothing, 4, 6, 8 and 27 are chain 1. The other eighteen cards have no dependency either way. Card 3
// has a parent (card 1), which the Hierarchy lights with it and the Flow does not.
//
// skills/web/test/browser-graph-flow-scenario.test.js holds these lists to the Flow layout over the plan
// board's own cards, so a wrong expectation fails in the unit suite and not only in a browser.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur, selectedIds, autoRefreshTick.

const CASES = {
  plan: {
    frontier: {
      heads: ['done · 1', 'ready now · 4', '1 step · 3', 'no dependency either way · 18 cards'],
      columns: [[5], [2, 3, 7, 27], [4, 6, 8]],
    },
    all: {
      heads: ['waits for nothing · 4', 'chain 1 · 4', 'no dependency either way · 18 cards'],
      columns: [[2, 3, 5, 7], [4, 6, 8, 27]],
    },
    strip: 18,
    lanes: {
      ids: [[2, 3, 4, 5, 6], [7, 8], [27]],
      headers: [
        { id: 1, text: 'goal · #1 Zephyr platform migration · 5 cards · 2 ready', mark: '#a371f7' },
        { id: 2, text: 'strategy · #2 Move the zephyr data layer · 2 cards · 1 ready', mark: '' },
        { id: 27, text: '#27 Ship once the audit is closed · 1 card · 1 ready', mark: '' },
      ],
      frontier: ['done · 1', 'ready now · 4', '1 step · 3', 'no open dependency · 18 cards'],
      all: ['waits for nothing · 4', 'chain 1 · 4', 'no dependency either way · 18 cards'],
    },
    arrows: ['2>6', '3>4', '3>6', '5>27', '5>6', '7>8'],
    dots: 26,
    done: 5,
    typed: 7,
    lone: { card: 3, lit: [3, 4, 6] },
    // A lane header acts as its card's dot: card 27 waits for 5 and is the card of its own lane; card 2 is the card of the second lane.
    head: { card: 27, other: 2, lit: [5, 27] },
    // The cards of docs: tag, one in the done column and one in the strip.
    search: { query: 'tags:docs', lit: [5, 10] },
    // Hiding the done cards with the Done pill: card 5 is gone and 27 has no dependency drawn; the strip loses
    // the done cards 12, 16 and 29 and gains 27.
    withoutDone: { frontier: { heads: ['ready now · 3', '1 step · 3', 'no dependency either way · 16 cards'], columns: [[2, 3, 7], [4, 6, 8]] }, strip: 16, dots: 22 },
    cut: { query: 'slice:goal..objective', draws: [1, 2, 7, 25, 26] },
    isolated: { text: '#3 | #4 | #6', heads: ['ready now · 1', '1 step · 2'], columns: [[3], [4, 6]], arrows: ['3>4', '3>6'], draws: [3, 4, 6] },
    // Three cards added through the board's API: A and B wait for each other, C waits for A. Frontier puts all
    // three in the loop column, last. All puts the loop with the cards that wait for nothing (nothing outside it
    // is waited for), and C one chain on, with 4, 6, 8 and 27.
    loop: {
      frontier: ['loop · 3'],
      all: ['waits for nothing · 6', 'chain 1 · 5'],
    },
  },
};

const PANEL = '#graph-view .view-panel';
const KIND = (k) => `#graph-view .graph-kind-btn[data-graph-kind=${k}]`;
const DEPS = (v) => `#graph-view .graph-option-btn[data-key=deps][data-val=${v}]`;
const LANES = (v) => `#graph-view .graph-option-btn[data-key=lanes][data-val=${v}]`;
const frames = `new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`;

const DOT_IDS = `[...new Set([...document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)')].map((n)=>Number(n.dataset.id)))].sort((a,b)=>a-b)`;
const HEADS = `[...document.querySelectorAll('#graph-view .graph-flow-colhead, #graph-view .graph-flow-striphead')].map((t)=>t.textContent)`;
const LANE_HEADS = `[...document.querySelectorAll('#graph-view .graph-flow-lane-head')].map((h)=>({id:Number(h.dataset.id),text:h.querySelector('.graph-flow-lanehead-text').textContent,mark:(()=>{const m=h.querySelector('.graph-flow-icon');return m?(m.dataset.typeColor||''):null})()}))`;
// The lanes as the page drew them, top to bottom: the dots (by id) inside each frame, where its header sits,
// and the x of each dot, so the columns can be held to stand across the lanes.
const LANE_FRAMES = `(()=>{const at=(n)=>{const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform')||'');return m?{x:Number(m[1]),y:Number(m[2])}:null};`
  + `const dots=[...document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)')].map((n)=>({id:Number(n.dataset.id),...at(n)}));`
  + `const heads=[...document.querySelectorAll('#graph-view .graph-flow-lane-head')].map((h)=>({id:Number(h.dataset.id),...at(h)}));`
  + `const lanes=[...document.querySelectorAll('#graph-view .graph-flow-lane')].map((r,i)=>{const x=Number(r.getAttribute('x')),w=Number(r.getAttribute('width')),y=Number(r.getAttribute('y')),h=Number(r.getAttribute('height'));`
  + `return {x,y,w,h,ids:dots.filter((d)=>d.x>x&&d.x<x+w&&d.y>y&&d.y<y+h).map((d)=>d.id).sort((a,b)=>a-b),head:heads[i]?{inside:heads[i].x>=x&&heads[i].x<x+w&&heads[i].y>y&&heads[i].y<y+h}:null}});`
  + `return {lanes,x:Object.fromEntries(dots.map((d)=>[d.id,Math.round(d.x*100)/100]))}})()`;
const kindIs = (k) => `graphCur.kind==='${k}'&&document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)').length>0`;
const pressed = (sel) => `(()=>{const b=document.querySelector('${sel}');return !!b&&b.getAttribute('aria-pressed')==='true'})()`;
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The frames the page drew for the columns, left to right: their x range in the Graph's world and the
// dots (by id) whose centre lies in it, read off the elements.
const COLUMNS = `(()=>{const at=(n)=>{const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform')||'');return m?{x:Number(m[1]),y:Number(m[2])}:null};`
  + `const dots=[...document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)')].map((n)=>({id:Number(n.dataset.id),...at(n)}));`
  + `return [...document.querySelectorAll('#graph-view .graph-flow-col')].map((r)=>{const x=Number(r.getAttribute('x')),w=Number(r.getAttribute('width')),y=Number(r.getAttribute('y')),h=Number(r.getAttribute('height'));`
  + `return {x,w,y,h,ids:dots.filter((d)=>d.x>x&&d.x<x+w&&d.y>y&&d.y<y+h).map((d)=>d.id).sort((a,b)=>a-b)}})})()`;
// The strip's frame, the ids inside it and the lowest edge of the columns.
const STRIP = `(()=>{const at=(n)=>{const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform')||'');return m?{x:Number(m[1]),y:Number(m[2])}:null};`
  + `const r=document.querySelector('#graph-view .graph-flow-strip');if(!r)return null;const x=Number(r.getAttribute('x')),y=Number(r.getAttribute('y')),w=Number(r.getAttribute('width')),h=Number(r.getAttribute('height'));`
  + `const ids=[...document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)')].map((n)=>({id:Number(n.dataset.id),...at(n)})).filter((d)=>d.x>x&&d.x<x+w&&d.y>y&&d.y<y+h).map((d)=>d.id);`
  + `const cols=[...document.querySelectorAll('#graph-view .graph-flow-col')].map((c)=>Number(c.getAttribute('y'))+Number(c.getAttribute('height')));return {y,count:ids.length,below:cols.every((b)=>y>b)}})()`;
// The arrows as the page lights them and draws them: from>to for each, and whether each path leaves the dot of
// the card waited for and ends at the dot of the card that waits, with its head.
const ARROWS = `(()=>{const at=(id)=>{const n=document.querySelector('#graph-view .graph-node:not(.graph-flow-lane-head)[data-id="'+id+'"]');const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform')||'');return {x:Number(m[1]),y:Number(m[2])}};`
  + `const els=[...document.querySelectorAll('#graph-view .graph-link')];return graphCur.plan.links.map((l,i)=>{const a=at(l.from),b=at(l.to);const nums=els[i].getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g).map(Number);`
  + `return {pair:l.from+'>'+l.to,kind:l.kind,head:els[i].hasAttribute('marker-end'),parentLine:els[i].classList.contains('graph-link-parent'),leaves:Math.abs(nums[0]-a.x)<0.1&&Math.abs(nums[1]-a.y)<0.1,arrives:nums[nums.length-2]<b.x&&nums[nums.length-2]>b.x-30&&Math.abs(nums[nums.length-1]-b.y)<0.1}}).sort((p,q)=>p.pair<q.pair?-1:1)})()`;
const LIT = `[...document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head).graph-near')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`;
const DIMMED = `document.querySelector('#graph-view .graph-canvas').classList.contains('graph-dim')`;
const OPACITY = (id) => `getComputedStyle(document.querySelector('#graph-view .graph-node:not(.graph-flow-lane-head)[data-id="${id}"]')).opacity`;
const STORED = (feature) => `(()=>{const k=Object.keys(localStorage).filter((x)=>x.endsWith('.graph.${feature}'));return k.length===1?localStorage.getItem(k[0]):null})()`;
const SEARCH = `location.search`;
const VIEW_K = `graphCur.view.k`;
const addCard = (card) => `fetch('/api/cards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(card)})}).then((r)=>r.json()).then((c)=>c.id)`;
const setWaits = (id, waits) => `fetch('/api/cards/${id}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({waiting_for:${JSON.stringify(waits)}})}).then((r)=>r.status)`;

const { openPanel, forgetPanelChoice } = require('../panel');

module.exports = {
  name: 'graph-flow',
  board: 'plan',
  alsoBoards: ['fixture'],
  timeoutMs: 120000,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, rightClick, key, check, shot } = page;
    const plan = CASES.plan;

    const load = async (url, boardKey) => {
      await ev('window.__stale=true');
      await open(url, boardKey);
      return waitFor('!window.__stale', 10000);
    };
    const pressOn = async (sel) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const flowDrawn = (deps) => waitFor(`${kindIs('flow')}&&${pressed(KIND('flow'))}&&${pressed(DEPS(deps))}`, 10000);
    const dots = () => ev(DOT_IDS);
    const columns = () => ev(COLUMNS);
    const dotPoint = (id) => ev(`(()=>{const dot=document.querySelector('.graph-node:not(.graph-flow-lane-head)[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node:not(.graph-flow-lane-head)')&&hit.closest('.graph-node:not(.graph-flow-lane-head)').dataset.id==='${id}'?{x,y}:null})()`);
    const clickCard = async (id, extra = {}) => {
      const p = await dotPoint(id);
      if (!p) throw new Error(`no clickable point on the dot of card ${id}`);
      await click(p.x, p.y, extra);
    };
    const litIs = (ids) => waitFor(`${DIMMED}&&JSON.stringify(${LIT})===${JSON.stringify(JSON.stringify(ids))}`);
    const columnsAre = async (spec, heads) => sameList((await columns()).map((c) => c.ids), spec) && sameList(await ev(HEADS), heads);
    const settled = (heads) => waitFor(`JSON.stringify(${HEADS})===${JSON.stringify(JSON.stringify(heads))}`, 8000);

    // --- the choice: Hierarchy first, and unchanged --------------------------------------------------------
    check('plan: the Graph opens in the Hierarchy, the tier fan', await load('/?view=graph', 'plan') && await openPanel(page) && await waitFor(`${kindIs('hierarchy')}&&${pressed(KIND('hierarchy'))}`, 10000));
    const kinds = await ev(`[...document.querySelectorAll('#graph-view .graph-controls .graph-kind-btn')].map((b)=>[b.dataset.graphKind,b.textContent,b.getAttribute('aria-pressed')])`);
    check('plan: the toolbar has the Hierarchy | Flow choice, Hierarchy pressed, and the panel does not', sameList(kinds, [['hierarchy', 'Hierarchy', 'true'], ['flow', 'Flow', 'false']])
      && await ev(`document.querySelectorAll('${PANEL} .graph-kinds').length===0&&document.querySelector('${PANEL}').children[1].classList.contains('graph-zoom')`), kinds);
    check('plan: the Hierarchy offers no layout to pick, keeps its option row, and has no Dependencies switch', await ev(`document.querySelectorAll('${PANEL} .graph-layout-btn').length===0&&document.querySelectorAll('${PANEL} .graph-options').length===1&&document.querySelectorAll('${PANEL} .graph-flow-options').length===0`));
    check('plan: the Hierarchy draws parent lines and no Flow column', await ev(`document.querySelectorAll('#graph-view .graph-link-parent').length>0&&document.querySelectorAll('#graph-view .graph-flow-col').length===0`));
    const hierarchyDots = await dots();
    const hierarchyClasses = await ev(`Object.fromEntries([...document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)')].map((n)=>[n.dataset.id,[...n.classList].filter((c)=>/^status-/.test(c)).join(' ')+'|'+(n.querySelector('path.graph-dot')?'mark':'round')]))`);
    check('plan: the Hierarchy draws every live card', hierarchyDots.length === plan.dots, hierarchyDots.length);
    await shot('graph-flow-hierarchy');

    // --- Flow, frontier by default -------------------------------------------------------------------------
    await pressOn(KIND('flow'));
    check('plan: a press on Flow draws the Flow, frontier pressed, without a reload', await flowDrawn('frontier'));
    check('plan: the panel offers the Dependencies switch, frontier then all, and not the fan option row', await ev(`JSON.stringify([...document.querySelectorAll('${PANEL} .graph-flow-options .graph-option-btn[data-key=deps]')].map((b)=>b.textContent))`) === '["frontier","all"]'
      && await ev(`document.querySelectorAll('${PANEL} .graph-options:not(.graph-flow-options)').length===0&&document.querySelectorAll('${PANEL} .graph-flow-options .graph-option-label')[0].textContent==='Dependencies'`));
    check('plan: the Dependencies buttons keep the selection and do not hold the poll', await ev(`[...document.querySelectorAll('${PANEL} .graph-flow-options .graph-option-btn')].every((b)=>b.hasAttribute('data-keeps-selection')&&!b.hasAttribute('data-holds-poll'))`));
    check('plan: the address says graph=flow and deps=frontier, and the board keeps Flow', await waitFor(`/[?&]graph=flow(&|$)/.test(${SEARCH})&&/[?&]deps=frontier(&|$)/.test(${SEARCH})`)
      && await ev(STORED('layout')) === 'flow', await ev(SEARCH));
    check('plan: the same cards are drawn, each once', sameList(await dots(), hierarchyDots) && (await ev(`document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)').length`)) === plan.dots);
    check('plan: frontier columns: done, ready now, 1 step, and the strip with its count',
      await settled(plan.frontier.heads) && await columnsAre(plan.frontier.columns, plan.frontier.heads), { heads: await ev(HEADS), columns: await columns() });
    const strip = await ev(STRIP);
    check('plan: the strip stands below every column and holds the eighteen cards with no dependency either way', !!strip && strip.below === true && strip.count === plan.strip, strip);
    const cols = await columns();
    check('plan: the columns run left to right and the cards of a column stand inside its frame', cols.every((c, i) => !i || c.x > cols[i - 1].x + cols[i - 1].w));
    const arrows = await ev(ARROWS);
    check('plan: an arrow for each dependency, from the card waited for to the card that waits, with a head, and no parent line',
      sameList(arrows.map((a) => a.pair), plan.arrows) && arrows.every((a) => a.kind === 'wait' && a.head && !a.parentLine && a.leaves && a.arrives), arrows);
    check('plan: no parent line is drawn', await ev(`document.querySelectorAll('#graph-view .graph-link-parent').length===0&&document.querySelectorAll('#graph-view .graph-link').length===${plan.arrows.length}`));
    const flowClasses = await ev(`Object.fromEntries([...document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)')].map((n)=>[n.dataset.id,[...n.classList].filter((c)=>/^status-/.test(c)).join(' ')+'|'+(n.querySelector('path.graph-dot')?'mark':'round')]))`);
    check('plan: a dot keeps its status colour and its type mark', sameList(flowClasses, hierarchyClasses) && flowClasses[plan.typed].endsWith('|mark') && flowClasses[plan.done].startsWith('status-done'), flowClasses[plan.typed]);
    check('plan: in frontier a done card is faded', await ev(`${OPACITY(plan.done)}`) === '0.4' && await ev(`${OPACITY(3)}`) === '1');
    await shot('graph-flow-frontier');

    // --- all -----------------------------------------------------------------------------------------------
    await pressOn(DEPS('all'));
    check('plan: a press on all redraws the Flow, all pressed', await flowDrawn('all'));
    check('plan: all columns: waits for nothing, chain 1, and the strip', await settled(plan.all.heads) && await columnsAre(plan.all.columns, plan.all.heads), { heads: await ev(HEADS), columns: await columns() });
    check('plan: the same arrows join the same cards', sameList((await ev(ARROWS)).map((a) => a.pair), plan.arrows));
    check('plan: in all the done card is not faded', await ev(`${OPACITY(plan.done)}`) === '1');
    check('plan: the address says deps=all and the board keeps it', await waitFor(`/[?&]deps=all(&|$)/.test(${SEARCH})&&/[?&]graph=flow(&|$)/.test(${SEARCH})`) && await ev(STORED('deps')) === 'all', await ev(SEARCH));
    await shot('graph-flow-all');

    // --- lanes -----------------------------------------------------------------------------------------------
    await pressOn(DEPS('frontier'));
    await flowDrawn('frontier');
    check('plan: the panel offers the Lanes switch, off then on, off pressed, and no lane is drawn', await ev(`JSON.stringify([...document.querySelectorAll('${PANEL} .graph-flow-options .graph-option-btn[data-key=lanes]')].map((b)=>[b.textContent,b.getAttribute('aria-pressed')]))`) === '[["off","true"],["on","false"]]'
      && await ev(`document.querySelectorAll('${PANEL} .graph-flow-options .graph-option-label')[1].textContent==='Lanes'&&document.querySelectorAll('#graph-view .graph-flow-lane, #graph-view .graph-flow-lane-head').length===0`));
    await pressOn(LANES('on'));
    check('plan: a press on on draws the lanes, on pressed, the same dots, and the address and the board say lanes', await waitFor(`${kindIs('flow')}&&${pressed(LANES('on'))}&&document.querySelectorAll('#graph-view .graph-flow-lane-head').length===${plan.lanes.headers.length}`, 10000)
      && sameList(await dots(), hierarchyDots) && await waitFor(`/[?&]lanes=1(&|$)/.test(${SEARCH})`) && await ev(STORED('lanes')) === '1', await ev(SEARCH));
    check('plan: the headers lead with the tier, #id title, the cards and the ready cards, in the order of the lanes, ready lanes first',
      sameList(await ev(LANE_HEADS), plan.lanes.headers), await ev(LANE_HEADS));
    check('plan: the mark of the lane card type leads each header, in the colour of the type when it has one', (await ev(LANE_HEADS)).every((h, i) => h.mark === plan.lanes.headers[i].mark));
    check('plan: no column frame is drawn with lanes, and the headings and the strip are', await settled(plan.lanes.frontier) && await ev(`document.querySelectorAll('#graph-view .graph-flow-col').length===0`));
    const framed = await ev(LANE_FRAMES);
    check('plan: each lane frames its cards and its header, top to bottom without overlap, above the strip', sameList(framed.lanes.map((l) => l.ids), plan.lanes.ids) && framed.lanes.every((l, i) => l.head && l.head.inside && (!i || l.y >= framed.lanes[i - 1].y + framed.lanes[i - 1].h))
      && await ev(`(()=>{const l=[...document.querySelectorAll('#graph-view .graph-flow-lane')].at(-1);const s=document.querySelector('#graph-view .graph-flow-strip');return Number(s.getAttribute('y'))>Number(l.getAttribute('y'))+Number(l.getAttribute('height'))})()`), framed.lanes);
    const colX = (ids) => ids.map((id) => framed.x[id]);
    check('plan: the columns stand across the lanes: the cards of a column share one x, and the columns run left to right',
      plan.frontier.columns.every((ids) => new Set(colX(ids)).size === 1) && plan.frontier.columns.every((ids, i) => !i || colX(ids)[0] > colX(plan.frontier.columns[i - 1])[0]), framed.x);
    check('plan: the same arrows join the same cards in lanes', sameList((await ev(ARROWS)).map((a) => a.pair), plan.arrows));
    // --- a header is its card's node ---------------------------------------------------------------------------
    // It wears the dot's classes and data-id, so the click, the menu and the lighting of a dot work on it, and the
    // two light and select together.
    // The pointer rests on the empty corner of the Graph, so no dot under it lights its relations over what a step checks.
    const park = async () => {
      const r = await ev(`(()=>{const r=document.querySelector('#graph-view .graph-canvas').getBoundingClientRect();return {x:r.right-14,y:r.bottom-14}})()`);
      await page.mouse('mouseMoved', r.x, r.y);
      return waitFor(`hoveredId===null`);
    };
    const HEAD = (id) => `#graph-view .graph-flow-lane-head[data-id="${id}"]`;
    const DOT = (id) => `#graph-view .graph-node:not(.graph-flow-lane-head)[data-id="${id}"]`;
    const headPoint = (id) => ev(`(()=>{const t=document.querySelector('${HEAD(id)} .graph-flow-lanehead-text');if(!t)return null;const r=t.getBoundingClientRect();const x=r.left+Math.min(r.width/2,80),y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);const h=hit&&hit.closest('.graph-flow-lane-head');return h&&h.dataset.id==='${id}'?{x,y}:null})()`);
    const clickHead = async (id, extra = {}) => {
      const p = await headPoint(id);
      if (!p) throw new Error(`no clickable point on the header of card ${id}`);
      await click(p.x, p.y, extra);
    };
    const HEAD_LIT = `[...document.querySelectorAll('#graph-view .graph-flow-lane-head.graph-near')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`;
    const SELECTED = `JSON.stringify([...selectedIds].map(Number).sort((a,b)=>a-b))`;
    const bothHave = (id, cls) => ev(`document.querySelector('${HEAD(id)}').classList.contains('${cls}')&&document.querySelector('${DOT(id)}').classList.contains('${cls}')`);
    const MENU = `[...document.querySelectorAll('#context-menu button')].map((b)=>b.id+(b.classList.contains('hidden')?'-':'+')).join()`;
    const menuShown = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`);
    const menuGone = () => waitFor(`document.getElementById('context-menu').classList.contains('hidden')`);
    const cardOpen = (id) => waitFor(`new URLSearchParams(location.search).get('card')==='${id}'`, 3000);
    const cardClosed = async () => { await key('Escape'); return waitFor(`!new URLSearchParams(location.search).has('card')`, 3000); };
    const clearSelection = async () => {
      for (let i = 0; i < 4 && (await ev('selectedIds.size')) > 0; i++) { await key('Escape'); await ev(frames); }
      return waitFor('selectedIds.size===0');
    };
    const { card: hc, other: ho } = plan.head;
    check('plan: a header is a node of its card: a graph-node and card-el with its data-id, a tab stop, the same title as the dot, and the card still has one dot',
      await ev(`(()=>{const hs=[...document.querySelectorAll('#graph-view .graph-flow-lane-head')];return hs.length>0&&hs.every((h)=>{const all=document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)[data-id="'+h.dataset.id+'"]');return h.classList.contains('graph-node')&&h.classList.contains('card-el')&&h.getAttribute('tabindex')==='0'&&all.length===1&&h.querySelector('title').textContent===all[0].querySelector('title').textContent})})()`));
    await park();
    const over = await headPoint(hc);
    await page.mouse('mouseMoved', over.x, over.y);
    check('plan: the pointer on a header lights its card with its dependencies and washes the header and the dot', await waitFor(`hoveredId==='${hc}'`) && await bothHave(hc, 'hover-highlight') && await litIs(plan.head.lit)
      && sameList(await ev(HEAD_LIT), [hc]) && (await ev(`document.querySelector('${HEAD(hc)} title').textContent`)).startsWith(`#${hc} `), { lit: await ev(LIT), heads: await ev(HEAD_LIT) });
    await park();
    check('plan: the pointer leaving puts the lighting out', await waitFor(`!${DIMMED}&&${LIT}.length===0&&${HEAD_LIT}.length===0`));
    await clickHead(hc);
    check('plan: a click on a header selects its card, header and dot together, and lights it with its dependencies', await waitFor(`${SELECTED}==='[${hc}]'`) && await bothHave(hc, 'selected') && await litIs(plan.head.lit) && sameList(await ev(HEAD_LIT), [hc]) && await ev(`document.getElementById('context-menu').classList.contains('hidden')`));
    await clickHead(ho, { modifiers: 8 });
    check('plan: Shift+click on a header adds its card', await waitFor(`${SELECTED}==='[${ho},${hc}]'`) && await bothHave(ho, 'selected') && await bothHave(hc, 'selected'));
    await clickHead(hc, { modifiers: 2 });
    check('plan: Ctrl+click on a header takes its card out, header and dot', await waitFor(`${SELECTED}==='[${ho}]'`) && await bothHave(ho, 'selected') && !(await ev(`document.querySelector('${HEAD(hc)}').classList.contains('selected')||document.querySelector('${DOT(hc)}').classList.contains('selected')`)));
    await clickCard(hc);
    check('plan: a click on the dot selects the header too, and moves it off the other card', await waitFor(`${SELECTED}==='[${hc}]'`) && await bothHave(hc, 'selected') && !(await ev(`document.querySelector('${HEAD(ho)}').classList.contains('selected')`)));
    await clearSelection();
    await park();
    await ev(`document.querySelector('${HEAD(hc)}').focus()`);
    check('plan: focus on a header lights its card as on a dot', await waitFor(`document.activeElement===document.querySelector('${HEAD(hc)}')&&hoveredId==='${hc}'`) && await litIs(plan.head.lit) && sameList(await ev(HEAD_LIT), [hc]));
    await key(' ', { ctrl: true });
    check('plan: Ctrl+Space on a header selects its card', await waitFor(`${SELECTED}==='[${hc}]'`) && await bothHave(hc, 'selected'));
    const refocused = async (sel) => {
      await ev(`window.__was=document.activeElement`);
      await ev(`(async()=>{await autoRefreshTick();})()`);
      return waitFor(`document.activeElement!==window.__was&&document.activeElement===document.querySelector('${sel}')`, 5000);
    };
    check('plan: a poll that draws the Graph again gives the focus back to the header, not to the dot of its card', await refocused(HEAD(hc)));
    await ev(`document.querySelector('${DOT(hc)}').focus()`);
    check('plan: and to the dot, not to the header, when the dot had it', await refocused(DOT(hc)));
    await ev(`document.querySelector('${HEAD(hc)}').focus()`);
    await key('Enter');
    check('plan: Enter on a header opens its card', await cardOpen(hc));
    check('plan: Escape closes the card', await cardClosed());
    await ev(`document.querySelector('${HEAD(ho)}').focus()`);
    await key('Tab');
    const forward = await ev(`document.activeElement!==document.querySelector('${HEAD(ho)}')`);
    await key('Tab', { shift: true });
    check('plan: Tab leaves a header for the next tab stop and Shift+Tab comes back to it', forward && await ev(`document.activeElement===document.querySelector('${HEAD(ho)}')`));
    await clearSelection();
    await park();
    const pt = await headPoint(ho);
    await click(pt.x, pt.y, { clickCount: 1 });
    await click(pt.x, pt.y, { clickCount: 2 });
    check('plan: a double click on a header opens its card', await cardOpen(ho));
    await cardClosed();
    await clearSelection();
    await park();
    await rightClick(HEAD(hc));
    check('plan: a right-click on a header opens the card menu', await menuShown());
    const headMenu = await ev(MENU);
    await key('Escape');
    await menuGone();
    await rightClick(DOT(hc));
    await menuShown();
    check('plan: it is the menu its dot opens, every item with the same state', headMenu === await ev(MENU) && headMenu.length > 0, { headMenu, dotMenu: await ev(MENU) });
    await key('Escape');
    await menuGone();
    await rightClick(HEAD(hc));
    await menuShown();
    await ev(`document.getElementById('ctx-dpath').click()`);
    check('plan: Explore > Dependency path from a header lights the dependency path of its card, header and dot together',
      await waitFor(`selectionState.selection.anchor&&selectionState.selection.anchor.kind==='query'&&/^dpath:/.test(selectionState.selection.anchor.text)`, 3000) && await menuGone() && await bothHave(hc, 'selected'), { selected: await ev(SELECTED) });
    await clearSelection();
    await park();
    await shot('graph-flow-lanes');
    await pressOn(DEPS('all'));
    check('plan: lanes in all: the same lanes in the same order, the headings of all', await flowDrawn('all') && await settled(plan.lanes.all) && sameList(await ev(LANE_HEADS), plan.lanes.headers) && sameList((await ev(LANE_FRAMES)).lanes.map((l) => l.ids), plan.lanes.ids));
    check('plan: a reload with no parameters keeps the lanes for the board', await load('/?view=graph', 'plan') && await flowDrawn('all') && await waitFor(`${pressed(LANES('on'))}&&document.querySelectorAll('#graph-view .graph-flow-lane-head').length===${plan.lanes.headers.length}`, 10000));
    check('plan: a link with lanes=0 opens the Flow without lanes, whatever the board kept', await load('/?view=graph&graph=flow&deps=all&lanes=0', 'plan') && await flowDrawn('all') && await waitFor(`${pressed(LANES('off'))}&&document.querySelectorAll('#graph-view .graph-flow-lane-head').length===0&&document.querySelectorAll('#graph-view .graph-flow-col').length>0`, 10000));
    check('plan: a link only for this load: the board still keeps lanes', await ev(STORED('lanes')) === '1');
    check('plan: a link with lanes=1 opens the lanes', await load('/?view=graph&graph=flow&deps=frontier&lanes=1', 'plan') && await flowDrawn('frontier') && await waitFor(`${pressed(LANES('on'))}&&document.querySelectorAll('#graph-view .graph-flow-lane-head').length===${plan.lanes.headers.length}`, 10000));
    await pressOn(KIND('hierarchy'));
    check('plan: the Hierarchy draws no lane and takes lanes out of the address', await waitFor(`${kindIs('hierarchy')}&&document.querySelectorAll('#graph-view .graph-flow-lane, #graph-view .graph-flow-lane-head').length===0&&!/[?&]lanes=/.test(${SEARCH})`, 10000), await ev(SEARCH));
    await pressOn(KIND('flow'));
    check('plan: the Flow brings the lanes back as they were', await flowDrawn('frontier') && await waitFor(`${pressed(LANES('on'))}&&document.querySelectorAll('#graph-view .graph-flow-lane-head').length===${plan.lanes.headers.length}&&/[?&]lanes=1(&|$)/.test(${SEARCH})`, 10000));
    await pressOn(LANES('off'));
    check('plan: a press on off takes the lanes away, and the board and the address say so', await waitFor(`${pressed(LANES('off'))}&&document.querySelectorAll('#graph-view .graph-flow-lane-head').length===0&&/[?&]lanes=0(&|$)/.test(${SEARCH})`, 10000) && await ev(STORED('lanes')) === '0' && await settled(plan.frontier.heads));

    // --- remembered, and the address ---------------------------------------------------------------------------
    check('plan: a reload with no parameters keeps Flow and all for the board', await load('/?view=graph', 'plan') && await flowDrawn('all') && await settled(plan.all.heads));
    check('plan: and the address says what the board remembered, so a link copied after a reload opens the same picture', await waitFor(`/[?&]graph=flow(&|$)/.test(${SEARCH})&&/[?&]deps=all(&|$)/.test(${SEARCH})&&/[?&]lanes=[01](&|$)/.test(${SEARCH})`, 5000), await ev(SEARCH));
    check('plan: a link with graph=flow and deps=frontier opens the Flow on frontier, whatever the board kept',
      await load('/?view=graph&graph=flow&deps=frontier', 'plan') && await flowDrawn('frontier') && await settled(plan.frontier.heads));
    check('plan: a link with graph=hierarchy opens the Hierarchy', await load('/?view=graph&graph=hierarchy', 'plan') && await waitFor(`${kindIs('hierarchy')}&&${pressed(KIND('hierarchy'))}`, 10000));
    check('plan: a link only for this load: it keeps what the board remembered', await ev(STORED('layout')) === 'flow' && await ev(STORED('deps')) === 'all');
    check('plan: and a plain reload goes back to the board\'s Flow on all', await load('/?view=graph', 'plan') && await flowDrawn('all'));
    await pressOn(DEPS('frontier'));
    check('plan: pressing frontier again is kept and written', await flowDrawn('frontier') && await ev(STORED('deps')) === 'frontier' && await waitFor(`/[?&]deps=frontier(&|$)/.test(${SEARCH})`));

    // --- the gestures of the Graph, as in the Hierarchy -------------------------------------------------------------
    const fitted = await ev(VIEW_K);
    await pressOn(`#graph-view .graph-zoom-btn[data-graph-action=in]`);
    check('plan: Zoom in zooms the Flow', await waitFor(`${VIEW_K}>${fitted}`));
    await pressOn(`#graph-view .graph-zoom-btn[data-graph-action=fit]`);
    check('plan: Fit frames the Flow again', await waitFor(`Math.abs(${VIEW_K}-${fitted})<0.001`));

    await clickCard(plan.lone.card);
    check('plan: a click on a card selects it and lights it with its dependencies, not its parent',
      await litIs(plan.lone.lit) && await waitFor(`JSON.stringify([...selectedIds].map(Number))==='[${plan.lone.card}]'`), { lit: await ev(LIT) });
    check('plan: the lit dependencies are lit arrows', await ev(`document.querySelectorAll('#graph-view .graph-link.graph-near').length`) === 2);
    await clickCard(plan.done, { modifiers: 8 });
    check('plan: Shift+click adds a card to the selection', await waitFor(`JSON.stringify([...selectedIds].map(Number).sort((a,b)=>a-b))==='[3,5]'`));
    await rightClick(`.graph-node:not(.graph-flow-lane-head)[data-id="${plan.lone.card}"]`);
    check('plan: a right-click on a dot opens the card menu', await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`));
    await key('Escape');
    check('plan: Escape closes the card menu', await waitFor(`document.getElementById('context-menu').classList.contains('hidden')`));

    await ev(`document.getElementById('search-clear-btn').click()`);
    await park();
    await ev(`document.getElementById('search-input').focus()`);
    await send('Input.insertText', { text: plan.search.query });
    check('plan: a query typed in the Graph lights its matches, the done card and the loose one, and dims the rest, drawing every dot',
      await litIs(plan.search.lit) && (await dots()).length === plan.dots, { lit: await ev(LIT) });
    await ev(`document.getElementById('search-clear-btn').click()`);
    check('plan: clearing the box removes the dimming', await waitFor(`!${DIMMED}&&${LIT}.length===0`));

    await ev(`document.querySelector('#search-statuses .status-pill[data-col=done]').click()`);
    check('plan: the Done pill takes the done cards out, and card 27, whose dependency went, to the strip',
      await waitFor(`document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)').length===${plan.withoutDone.dots}`)
        && await settled(plan.withoutDone.frontier.heads) && await columnsAre(plan.withoutDone.frontier.columns, plan.withoutDone.frontier.heads), { heads: await ev(HEADS), dots: (await dots()).length });
    await ev(`document.querySelector('#search-statuses .status-pill[data-col=done]').click()`);
    check('plan: the pill again brings them back', await waitFor(`document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)').length===${plan.dots}`) && await settled(plan.frontier.heads));

    await ev(`document.getElementById('search-input').focus()`);
    await send('Input.insertText', { text: plan.cut.query });
    check('plan: a slice: term draws only the cut, none of whose cards waits for another, so all stand in the strip',
      await waitFor(`JSON.stringify(${DOT_IDS})===${JSON.stringify(JSON.stringify(plan.cut.draws))}`) && await settled([`no dependency either way · ${plan.cut.draws.length} cards`]) && (await ev(`document.querySelectorAll('#graph-view .graph-flow-col').length`)) === 0, { dots: await dots(), heads: await ev(HEADS) });
    await ev(`document.getElementById('search-clear-btn').click()`);
    await waitFor(`document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)').length===${plan.dots}`);

    check('plan: isolate draws the isolated cards alone, laid out by the dependencies between them',
      await load(`/?view=graph&q=${encodeURIComponent(plan.isolated.text)}&isolate=1`, 'plan') && await flowDrawn('frontier')
        && await waitFor(`JSON.stringify(${DOT_IDS})===${JSON.stringify(JSON.stringify(plan.isolated.draws))}`) && await settled(plan.isolated.heads)
        && await columnsAre(plan.isolated.columns, plan.isolated.heads) && sameList((await ev(ARROWS)).map((a) => a.pair), plan.isolated.arrows), { dots: await dots(), heads: await ev(HEADS) });

    // --- a dependency loop never hangs the drawing ----------------------------------------------------------------
    await load('/?view=graph', 'plan');
    await flowDrawn('frontier');
    const a = await ev(addCard({ title: 'Loop first', status: 'todo' }));
    const b = await ev(addCard({ title: 'Loop second', status: 'todo', waiting_for: [a] }));
    const c = await ev(addCard({ title: 'Loop behind it', status: 'todo', waiting_for: [a] }));
    check('plan: A waits for B, B for A, and C for A, through the board\'s API', await ev(setWaits(a, [b])) === 200);
    await load('/?view=graph', 'plan');
    check('plan: in frontier the loop and the card behind it stand in the loop column, last', await flowDrawn('frontier') && await settled([...plan.frontier.heads.slice(0, 3), ...plan.loop.frontier, `no dependency either way · ${plan.strip} cards`])
      && sameList((await columns()).at(-1).ids, [a, b, c].map(Number).sort((x, y) => x - y)), { heads: await ev(HEADS), columns: await columns() });
    await pressOn(DEPS('all'));
    const drawnAll = await flowDrawn('all') && await waitFor(`JSON.stringify(${HEADS}.slice(0,2))===${JSON.stringify(JSON.stringify(plan.loop.all))}`);
    const byColumn = (await columns()).map((col) => col.ids);
    check('plan: in all the loop shares one column and the card behind it is one chain on', drawnAll
      && byColumn[0].includes(Number(a)) && byColumn[0].includes(Number(b)) && byColumn[1].includes(Number(c)), { heads: await ev(HEADS), columns: byColumn });
    await shot('graph-flow-loop');

    // --- the other board keeps its own ------------------------------------------------------------------------------
    await forgetPanelChoice(page);
    check('fixture: another board opens in the Hierarchy: the choice is kept for the board', await load('/?view=graph', 'fixture') && await waitFor(`${kindIs('hierarchy')}&&${pressed(KIND('hierarchy'))}`, 10000));

    // --- the phone's bottom sheet ---------------------------------------------------------------------------------------
    await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false });
    check('plan: at phone width a board with a link opens the Flow, the panel closed', await load('/?view=graph&graph=flow&deps=frontier', 'plan')
      && await waitFor(`${kindIs('flow')}&&!document.querySelector('${PANEL}')`, 10000));
    await pressOn('#graph-view .view-panel-toggle');
    check('plan: the toggle opens the panel as a sheet over the Graph, with the switch in it and the choice in the toolbar',
      await waitFor(`!!document.querySelector('${PANEL}')`) && await ev(`(()=>{const p=document.querySelector('${PANEL}');const r=p.getBoundingClientRect();return getComputedStyle(p).position==='absolute'&&r.width>=window.innerWidth*0.8&&r.bottom>=window.innerHeight-200&&!!document.querySelector('#graph-view .graph-controls .graph-kind-btn[data-graph-kind=flow]')&&!p.querySelector('.graph-kinds')&&!!p.querySelector('.graph-option-btn[data-key=deps][data-val=all]')})()`));
    check('plan: the sheet offers the Lanes switch too', await ev(`!!document.querySelector('${PANEL} .graph-option-btn[data-key=lanes][data-val=on]')`));
    await pressOn(`${PANEL} .graph-option-btn[data-key=deps][data-val=all]`);
    // The loop cards added above are still on the board: two more cards wait for nothing and one is chain 1.
    check('plan: a press on all in the sheet redraws the columns', await waitFor(`${kindIs('flow')}&&${pressed(DEPS('all'))}`) && await settled([...plan.loop.all, plan.all.heads.at(-1)]), { heads: await ev(HEADS), search: await ev(SEARCH), sheet: await ev(`JSON.stringify(document.querySelector('${PANEL}').getBoundingClientRect())`) });
    await pressOn(`${PANEL} .graph-option-btn[data-key=lanes][data-val=on]`);
    check('plan: a press on on in the sheet draws the lanes', await waitFor(`${kindIs('flow')}&&${pressed(LANES('on'))}&&document.querySelectorAll('#graph-view .graph-flow-lane-head').length===${plan.lanes.headers.length + 3}`, 10000), await ev(LANE_HEADS));
    await shot('graph-flow-sheet');
    await pressOn('#graph-view .graph-controls .graph-kind-btn[data-graph-kind=hierarchy]');
    check('plan: a press on Hierarchy in the toolbar goes back to the tier fan', await waitFor(`${kindIs('hierarchy')}&&${pressed(KIND('hierarchy'))}`, 10000));
    check('plan: the sheet adds no sideways scroll to the view', await ev(`(()=>{const v=document.querySelector('#graph-view');return v.scrollWidth-v.clientWidth<=1})()`));
    await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
    await ev(frames);
  },
};
