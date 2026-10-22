'use strict';
// The Graph's Flow, on the plan board. The option panel opens with a Hierarchy | Flow choice, Hierarchy
// (the tier fan, with its layouts and options) pressed. Flow lays the board out by its dependencies in
// columns, with the Dependencies switch beside it, frontier or all, and no lanes yet:
//   frontier  done (faded, first), ready now, 1 step, 2 steps ..., loop; only dependencies not done count.
//   all       waits for nothing, chain 1, chain 2 ...; done dependencies count.
// Cards with no dependency either way sit in a strip below the columns, with a count. The arrows run from
// the card waited for to the card that waits, and there are no parent lines. A dot keeps its status colour
// and its type mark. Search lighting, the status pills, slice:, isolate, selection, the card menu and the
// zoom work as in Hierarchy, a lone card lighting with its dependencies. The choice and the switch are kept
// for the board in the browser and in the address (graph=, deps=), the address winning on a load; and the
// panel works as the phone's bottom sheet.
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
// graphCur, selectedIds.

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
    arrows: ['2>6', '3>4', '3>6', '5>27', '5>6', '7>8'],
    dots: 26,
    done: 5,
    typed: 7,
    lone: { card: 3, lit: [3, 4, 6] },
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
const frames = `new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`;

const DOT_IDS = `[...new Set([...document.querySelectorAll('#graph-view .graph-node')].map((n)=>Number(n.dataset.id)))].sort((a,b)=>a-b)`;
const HEADS = `[...document.querySelectorAll('#graph-view .graph-flow-colhead, #graph-view .graph-flow-striphead')].map((t)=>t.textContent)`;
const kindIs = (k) => `graphCur.kind==='${k}'&&document.querySelectorAll('#graph-view .graph-node').length>0`;
const pressed = (sel) => `(()=>{const b=document.querySelector('${sel}');return !!b&&b.getAttribute('aria-pressed')==='true'})()`;
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The frames the page drew for the columns, left to right: their x range in the Graph's world and the
// dots (by id) whose centre lies in it, read off the elements.
const COLUMNS = `(()=>{const at=(n)=>{const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform')||'');return m?{x:Number(m[1]),y:Number(m[2])}:null};`
  + `const dots=[...document.querySelectorAll('#graph-view .graph-node')].map((n)=>({id:Number(n.dataset.id),...at(n)}));`
  + `return [...document.querySelectorAll('#graph-view .graph-flow-col')].map((r)=>{const x=Number(r.getAttribute('x')),w=Number(r.getAttribute('width')),y=Number(r.getAttribute('y')),h=Number(r.getAttribute('height'));`
  + `return {x,w,y,h,ids:dots.filter((d)=>d.x>x&&d.x<x+w&&d.y>y&&d.y<y+h).map((d)=>d.id).sort((a,b)=>a-b)}})})()`;
// The strip's frame, the ids inside it and the lowest edge of the columns.
const STRIP = `(()=>{const at=(n)=>{const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform')||'');return m?{x:Number(m[1]),y:Number(m[2])}:null};`
  + `const r=document.querySelector('#graph-view .graph-flow-strip');if(!r)return null;const x=Number(r.getAttribute('x')),y=Number(r.getAttribute('y')),w=Number(r.getAttribute('width')),h=Number(r.getAttribute('height'));`
  + `const ids=[...document.querySelectorAll('#graph-view .graph-node')].map((n)=>({id:Number(n.dataset.id),...at(n)})).filter((d)=>d.x>x&&d.x<x+w&&d.y>y&&d.y<y+h).map((d)=>d.id);`
  + `const cols=[...document.querySelectorAll('#graph-view .graph-flow-col')].map((c)=>Number(c.getAttribute('y'))+Number(c.getAttribute('height')));return {y,count:ids.length,below:cols.every((b)=>y>b)}})()`;
// The arrows as the page lights them and draws them: from>to for each, and whether each path leaves the dot of
// the card waited for and ends at the dot of the card that waits, with its head.
const ARROWS = `(()=>{const at=(id)=>{const n=document.querySelector('#graph-view .graph-node[data-id="'+id+'"]');const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform')||'');return {x:Number(m[1]),y:Number(m[2])}};`
  + `const els=[...document.querySelectorAll('#graph-view .graph-link')];return graphCur.plan.links.map((l,i)=>{const a=at(l.from),b=at(l.to);const nums=els[i].getAttribute('d').match(/-?\\d+(?:\\.\\d+)?/g).map(Number);`
  + `return {pair:l.from+'>'+l.to,kind:l.kind,head:els[i].hasAttribute('marker-end'),parentLine:els[i].classList.contains('graph-link-parent'),leaves:Math.abs(nums[0]-a.x)<0.1&&Math.abs(nums[1]-a.y)<0.1,arrives:nums[nums.length-2]<b.x&&nums[nums.length-2]>b.x-30&&Math.abs(nums[nums.length-1]-b.y)<0.1}}).sort((p,q)=>p.pair<q.pair?-1:1)})()`;
const LIT = `[...document.querySelectorAll('#graph-view .graph-node.graph-near')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`;
const DIMMED = `document.querySelector('#graph-view .graph-canvas').classList.contains('graph-dim')`;
const OPACITY = (id) => `getComputedStyle(document.querySelector('#graph-view .graph-node[data-id="${id}"]')).opacity`;
const STORED = (feature) => `(()=>{const k=Object.keys(localStorage).filter((x)=>x.endsWith('.graph.${feature}'));return k.length===1?localStorage.getItem(k[0]):null})()`;
const SEARCH = `location.search`;
const VIEW_K = `graphCur.view.k`;
const addCard = (card) => `fetch('/api/cards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(card)})}).then((r)=>r.json()).then((c)=>c.id)`;
const setWaits = (id, waits) => `fetch('/api/cards/${id}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({waiting_for:${JSON.stringify(waits)}})}).then((r)=>r.status)`;

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
    const dotPoint = (id) => ev(`(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`);
    const clickCard = async (id, extra = {}) => {
      const p = await dotPoint(id);
      if (!p) throw new Error(`no clickable point on the dot of card ${id}`);
      await click(p.x, p.y, extra);
    };
    const litIs = (ids) => waitFor(`${DIMMED}&&JSON.stringify(${LIT})===${JSON.stringify(JSON.stringify(ids))}`);
    const columnsAre = async (spec, heads) => sameList((await columns()).map((c) => c.ids), spec) && sameList(await ev(HEADS), heads);
    const settled = (heads) => waitFor(`JSON.stringify(${HEADS})===${JSON.stringify(JSON.stringify(heads))}`, 8000);

    // --- the choice: Hierarchy first, and unchanged --------------------------------------------------------
    check('plan: the Graph opens in the Hierarchy, the tier fan', await load('/?view=graph', 'plan') && await waitFor(`${kindIs('tiers')}&&${pressed(KIND('hierarchy'))}`, 10000));
    const kinds = await ev(`[...document.querySelectorAll('#graph-view .view-panel .graph-kind-btn')].map((b)=>[b.dataset.graphKind,b.textContent,b.getAttribute('aria-pressed')])`);
    check('plan: the option panel opens with the Hierarchy | Flow choice, Hierarchy pressed', sameList(kinds, [['hierarchy', 'Hierarchy', 'true'], ['flow', 'Flow', 'false']])
      && await ev(`document.querySelector('${PANEL}').children[1].classList.contains('graph-kinds')`), kinds);
    check('plan: the Hierarchy offers no layout to pick, keeps its option row, and has no Dependencies switch', await ev(`document.querySelectorAll('${PANEL} .graph-layout-btn').length===0&&document.querySelectorAll('${PANEL} .graph-options').length===1&&document.querySelectorAll('${PANEL} .graph-flow-options').length===0`));
    check('plan: the Hierarchy draws parent lines and no Flow column', await ev(`document.querySelectorAll('#graph-view .graph-link-parent').length>0&&document.querySelectorAll('#graph-view .graph-flow-col').length===0`));
    const hierarchyDots = await dots();
    const hierarchyClasses = await ev(`Object.fromEntries([...document.querySelectorAll('#graph-view .graph-node')].map((n)=>[n.dataset.id,[...n.classList].filter((c)=>/^status-/.test(c)).join(' ')+'|'+(n.querySelector('path.graph-dot')?'mark':'round')]))`);
    check('plan: the Hierarchy draws every live card', hierarchyDots.length === plan.dots, hierarchyDots.length);
    await shot('graph-flow-hierarchy');

    // --- Flow, frontier by default -------------------------------------------------------------------------
    await pressOn(KIND('flow'));
    check('plan: a press on Flow draws the Flow, frontier pressed, without a reload', await flowDrawn('frontier'));
    check('plan: the panel offers the Dependencies switch, frontier then all, and not the fan\'s option row', await ev(`JSON.stringify([...document.querySelectorAll('${PANEL} .graph-flow-options .graph-option-btn')].map((b)=>b.textContent))`) === '["frontier","all"]'
      && await ev(`document.querySelectorAll('${PANEL} .graph-options:not(.graph-flow-options)').length===0&&document.querySelectorAll('${PANEL} .graph-flow-options .graph-option-label')[0].textContent==='Dependencies'`));
    check('plan: the Dependencies buttons keep the selection and do not hold the poll', await ev(`[...document.querySelectorAll('${PANEL} .graph-flow-options .graph-option-btn')].every((b)=>b.hasAttribute('data-keeps-selection')&&!b.hasAttribute('data-holds-poll'))`));
    check('plan: the address says graph=flow and deps=frontier, and the board keeps Flow', await waitFor(`/[?&]graph=flow(&|$)/.test(${SEARCH})&&/[?&]deps=frontier(&|$)/.test(${SEARCH})`)
      && await ev(STORED('layout')) === 'flow', await ev(SEARCH));
    check('plan: the same cards are drawn, each once', sameList(await dots(), hierarchyDots) && (await ev(`document.querySelectorAll('#graph-view .graph-node').length`)) === plan.dots);
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
    const flowClasses = await ev(`Object.fromEntries([...document.querySelectorAll('#graph-view .graph-node')].map((n)=>[n.dataset.id,[...n.classList].filter((c)=>/^status-/.test(c)).join(' ')+'|'+(n.querySelector('path.graph-dot')?'mark':'round')]))`);
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

    // --- remembered, and the address ---------------------------------------------------------------------------
    check('plan: a reload with no parameters keeps Flow and all for the board', await load('/?view=graph', 'plan') && await flowDrawn('all') && await settled(plan.all.heads));
    check('plan: a link with graph=flow and deps=frontier opens the Flow on frontier, whatever the board kept',
      await load('/?view=graph&graph=flow&deps=frontier', 'plan') && await flowDrawn('frontier') && await settled(plan.frontier.heads));
    check('plan: a link with graph=hierarchy opens the Hierarchy', await load('/?view=graph&graph=hierarchy', 'plan') && await waitFor(`${kindIs('tiers')}&&${pressed(KIND('hierarchy'))}`, 10000));
    check('plan: a link only for this load: it keeps what the board remembered', await ev(STORED('layout')) === 'flow' && await ev(STORED('deps')) === 'all');
    check('plan: and a plain reload goes back to the board\'s Flow on all', await load('/?view=graph', 'plan') && await flowDrawn('all'));
    await pressOn(DEPS('frontier'));
    check('plan: pressing frontier again is kept and written', await flowDrawn('frontier') && await ev(STORED('deps')) === 'frontier' && await waitFor(`/[?&]deps=frontier(&|$)/.test(${SEARCH})`));

    // --- the gestures of the Graph, as in the Hierarchy -------------------------------------------------------------
    // The pointer rests on the empty corner of the Graph, so no dot under it lights its relations over what a step checks.
    const park = async () => {
      const r = await ev(`(()=>{const r=document.querySelector('#graph-view .graph-canvas').getBoundingClientRect();return {x:r.right-14,y:r.bottom-14}})()`);
      await page.mouse('mouseMoved', r.x, r.y);
      return waitFor(`hoveredId===null`);
    };
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
    await rightClick(`.graph-node[data-id="${plan.lone.card}"]`);
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
      await waitFor(`document.querySelectorAll('#graph-view .graph-node').length===${plan.withoutDone.dots}`)
        && await settled(plan.withoutDone.frontier.heads) && await columnsAre(plan.withoutDone.frontier.columns, plan.withoutDone.frontier.heads), { heads: await ev(HEADS), dots: (await dots()).length });
    await ev(`document.querySelector('#search-statuses .status-pill[data-col=done]').click()`);
    check('plan: the pill again brings them back', await waitFor(`document.querySelectorAll('#graph-view .graph-node').length===${plan.dots}`) && await settled(plan.frontier.heads));

    await ev(`document.getElementById('search-input').focus()`);
    await send('Input.insertText', { text: plan.cut.query });
    check('plan: a slice: term draws only the cut, none of whose cards waits for another, so all stand in the strip',
      await waitFor(`JSON.stringify(${DOT_IDS})===${JSON.stringify(JSON.stringify(plan.cut.draws))}`) && await settled([`no dependency either way · ${plan.cut.draws.length} cards`]) && (await ev(`document.querySelectorAll('#graph-view .graph-flow-col').length`)) === 0, { dots: await dots(), heads: await ev(HEADS) });
    await ev(`document.getElementById('search-clear-btn').click()`);
    await waitFor(`document.querySelectorAll('#graph-view .graph-node').length===${plan.dots}`);

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
    check('fixture: another board opens in the Hierarchy: the choice is kept for the board', await load('/?view=graph', 'fixture') && await waitFor(`${kindIs('tiers')}&&${pressed(KIND('hierarchy'))}`, 10000));

    // --- the phone's bottom sheet ---------------------------------------------------------------------------------------
    await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false });
    check('plan: at phone width a board with a link opens the Flow, the panel closed', await load('/?view=graph&graph=flow&deps=frontier', 'plan')
      && await waitFor(`${kindIs('flow')}&&!document.querySelector('${PANEL}')`, 10000));
    await pressOn('#graph-view .view-panel-toggle');
    check('plan: the toggle opens the panel as a sheet over the Graph, with the choice and the switch in it',
      await waitFor(`!!document.querySelector('${PANEL}')`) && await ev(`(()=>{const p=document.querySelector('${PANEL}');const r=p.getBoundingClientRect();return getComputedStyle(p).position==='absolute'&&r.width>=window.innerWidth*0.8&&r.bottom>=window.innerHeight-200&&!!p.querySelector('.graph-kind-btn[data-graph-kind=flow]')&&!!p.querySelector('.graph-option-btn[data-key=deps][data-val=all]')})()`));
    await pressOn(`${PANEL} .graph-option-btn[data-key=deps][data-val=all]`);
    // The loop cards added above are still on the board: two more cards wait for nothing and one is chain 1.
    check('plan: a press on all in the sheet redraws the columns', await waitFor(`${kindIs('flow')}&&${pressed(DEPS('all'))}`) && await settled([...plan.loop.all, plan.all.heads.at(-1)]), { heads: await ev(HEADS), search: await ev(SEARCH), sheet: await ev(`JSON.stringify(document.querySelector('${PANEL}').getBoundingClientRect())`) });
    await shot('graph-flow-sheet');
    await pressOn(`${PANEL} .graph-kind-btn[data-graph-kind=hierarchy]`);
    check('plan: a press on Hierarchy in the sheet goes back to the tier fan', await waitFor(`${kindIs('tiers')}&&${pressed(KIND('hierarchy'))}`, 10000));
    check('plan: the sheet adds no sideways scroll to the view', await ev(`(()=>{const v=document.querySelector('#graph-view');return v.scrollWidth-v.clientWidth<=1})()`));
    await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
    await ev(frames);
  },
};
