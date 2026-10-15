'use strict';
// What a click and a double click on empty space do, in each view, on the fixture
// board. Two cards are picked with Ctrl+click (the Graph's dots too), then a single
// click on empty space must leave both picked, and a double click there must clear
// them. In the Calendar the empty space that is clicked is the weekday header; a
// double click on a day cell already means something, so there it opens the new-card
// form and the selection stays. A pill's query is an anchor too: with the review
// pill on, a single click on empty space leaves the box, the chip and the anchor,
// and a double click takes the query out of the box, turns the chip off and shows
// every card again. A search typed in the Graph is the anchor there, and a double
// click on the empty Graph clears the box. Each step waits on the page, never on a
// fixed sleep; a "nothing happened" check waits two animation frames. A double click
// is two real clicks, the second with a click count of 2, as the browser sends it.
//
// Cards 3 and 6 are dated today through the board's own API, so the Calendar and the
// Gantt draw them as well (the runner puts the board's cards back before the next
// scenario). Card 10 awaits review, so the review pill is on one card.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectedIds, selectionState.

const VIEWS = ['board', 'map', 'gantt', 'calendar', 'graph'];
const CONTAINERS = { board: '#board', map: '#map-view', gantt: '#gantt-view', calendar: '#calendar-view', graph: '#graph-view' };
const DATED = [3, 6];
const TYPED = 'zephyr';

// What a double click does not clear on: the same list the page keeps (onClickAway).
const NOT_EMPTY = '.card-el, .graph-node, [data-tip], button, input, select, a, textarea, [data-keeps-selection], .modal-backdrop, .context-menu';

module.exports = {
  name: 'empty-space',
  board: 'fixture',
  timeoutMs: 120000,
  VIEWS,
  CONTAINERS,
  DATED,
  TYPED,
  NOT_EMPTY,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, check } = page;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const sorted = (...ids) => ids.slice().sort((a, b) => a - b);
    const picked = () => ev(`[...selectedIds].sort((a,b)=>a-b)`);
    const pickedIs = (ids) => waitFor(`JSON.stringify([...selectedIds].sort((a,b)=>a-b))===${JSON.stringify(JSON.stringify(ids))}`);
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const anchor = () => ev(`(()=>{const a=selectionState.selection.anchor;return a?{kind:a.kind,text:a.text||null,source:a.source||null,id:a.id||null}:null})()`);
    const anchorText = async () => ((await anchor()) || {}).text;
    const anchorSource = async () => ((await anchor()) || {}).source;
    const noAnchor = () => waitFor(`selectionState.selection.anchor===null&&selectionState.selection.additions.length===0`);
    const chip = () => ev(`(()=>{const c=document.getElementById('search-chip');return {hidden:c.classList.contains('hidden')||c.getBoundingClientRect().width===0,text:c.textContent}})()`);
    const doubleClick = async (x, y) => {
      await click(x, y, { clickCount: 1 });
      await click(x, y, { clickCount: 2 });
    };
    const clickOn = async (sel, extra = {}) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y, extra);
    };
    const cardIds = (container) => ev(`[...new Set([...document.querySelectorAll('${container} .card-el')].map((e)=>Number(e.dataset.id)))]`);
    // A point on a card that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (container, id) => ev(`(()=>{const el=document.querySelector('${container} .card-el[data-id="${id}"]');if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    // The centre of a card's dot in the Graph, or null when another dot covers it.
    const dotPoint = (id) => ev(`(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`);
    const pointOn = (view, id) => (view === 'graph' ? dotPoint(id) : cardPoint(CONTAINERS[view], id));
    const ctrlClickCard = async (view, id) => {
      const p = await pointOn(view, id);
      if (!p) throw new Error(`no clickable point on card ${id} in the ${view}`);
      await click(p.x, p.y, { modifiers: 2 });
    };
    const twoCards = async (view) => {
      const found = [];
      for (const id of await cardIds(CONTAINERS[view])) {
        if (found.length === 2) break;
        if (await pointOn(view, id)) found.push(id);
      }
      return found;
    };
    // The lowest and rightmost point inside the view that is on no card, control, text field or popup.
    const emptyPoint = (container) => ev(`(()=>{const root=document.querySelector(${JSON.stringify(container)});if(!root)return null;const r=root.getBoundingClientRect();for(let y=Math.min(r.bottom,innerHeight)-12;y>Math.max(r.top,0);y-=16)for(let x=Math.min(r.right,innerWidth)-12;x>Math.max(r.left,0);x-=24){const e=document.elementFromPoint(x,y);if(e&&root.contains(e)&&!e.closest(${JSON.stringify(NOT_EMPTY)}))return {x,y}}return null})()`);
    // The weekday header of the Calendar's month grid: empty space where a double click creates nothing.
    const weekdayPoint = () => ev(`(()=>{const h=document.querySelector('#calendar-view .cal-dow');if(!h)return null;const r=h.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&!hit.closest(${JSON.stringify(NOT_EMPTY)})&&!hit.closest('.cal-day, .cal-tg-allday-cell, .cal-tg-col')?{x,y}:null})()`);
    // A spot on a day cell that is the cell itself, with no chip over it.
    const dayCellPoint = () => ev(`(()=>{for(const cell of document.querySelectorAll('#calendar-view .cal-day')){cell.scrollIntoView({block:'center'});const r=cell.getBoundingClientRect();if(r.width===0||r.bottom>innerHeight)continue;for(const x of [r.left+6,r.left+r.width/2,r.right-6]){const y=r.bottom-6;if(document.elementFromPoint(x,y)===cell)return {x,y}}}return null})()`);
    const graphCorner = () => ev(`(()=>{const r=document.querySelector('.graph-canvas').getBoundingClientRect();const x=r.right-14,y=r.bottom-14;const hit=document.elementFromPoint(x,y);return hit&&!hit.closest(${JSON.stringify(NOT_EMPTY)})?{x,y}:null})()`);
    const patchCard = (id, changes) => ev(`fetch('/api/cards/${id}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(changes)})}).then((r)=>r.status)`);
    const ready = {
      board: `document.querySelectorAll('#board .card-el').length>3`,
      map: `document.querySelectorAll('#map-view .card-el').length>3`,
      gantt: `document.querySelectorAll('#gantt-view .card-el').length>=2`,
      calendar: `document.querySelectorAll('#calendar-view .card-el').length>=2`,
      graph: `document.querySelectorAll('#graph-view .graph-node').length>3`,
    };
    const NEW_CARD_FORM_OPEN = `!document.getElementById('modal').classList.contains('hidden')`;
    const NEW_CARD_FORM_SHUT = `document.getElementById('modal').classList.contains('hidden')`;
    const PANEL = `document.getElementById('search-panel')`;
    const panelOpen = `!${PANEL}.classList.contains('hidden')&&${PANEL}.getBoundingClientRect().height>0`;
    const panelShut = `${PANEL}.classList.contains('hidden')`;
    const pillSel = (name) => `#search-pills .query-pill[data-pill-key="${name}"]`;

    const today = await ev(`(()=>{const d=new Date();const p=(n)=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())})()`);
    await open('/');
    await waitFor(ready.board, 10000);
    for (const id of DATED) {
      check(`card ${id} is dated today for the Calendar and the Gantt`, (await patchCard(id, { start_date: today, end_date: today })) === 200);
    }

    // --- two cards picked, then a click and a double click on empty space, in each view ------------
    for (const view of VIEWS) {
      await open(`/?view=${view}`);
      check(`the ${view} draws its cards`, await waitFor(ready[view], 10000));
      const [a, b] = await twoCards(view);
      check(`${view}: two cards can be clicked`, Number.isInteger(a) && Number.isInteger(b), { a, b });
      await ctrlClickCard(view, a);
      await ctrlClickCard(view, b);
      check(`${view}: Ctrl+click picks the two cards`, await pickedIs(sorted(a, b)), await picked());
      const away = view === 'calendar' ? await weekdayPoint() : view === 'graph' ? await graphCorner() : await emptyPoint(CONTAINERS[view]);
      check(`${view}: there is empty space to click`, !!away, away);
      await click(away.x, away.y);
      await frames();
      check(`${view}: a click on empty space leaves the selection`, same(await picked(), sorted(a, b)), await picked());
      await doubleClick(away.x, away.y);
      check(`${view}: a double click on empty space clears the selection`, await pickedIs([]) && await noAnchor(), { picked: await picked(), anchor: await anchor() });

      if (view === 'calendar') {
        await ctrlClickCard(view, a);
        await ctrlClickCard(view, b);
        await pickedIs(sorted(a, b));
        const cell = await dayCellPoint();
        check('calendar: a day cell has a spot with no chip over it', !!cell, cell);
        await doubleClick(cell.x, cell.y);
        check('calendar: a double click on a day cell opens the new-card form and leaves the selection', await waitFor(NEW_CARD_FORM_OPEN, 3000) && same(await picked(), sorted(a, b)), await picked());
        await ev(`window.confirm=()=>true`);
        await key('Escape');
        check('calendar: Esc closes the form and the selection is still there', await waitFor(NEW_CARD_FORM_SHUT, 3000) && same(await picked(), sorted(a, b)), await picked());
      }
    }

    // --- a pill's query is an anchor: the double click takes it out of the box and turns the chip off ---
    await open('/?view=board');
    await waitFor(ready.board, 10000);
    const shownBefore = (await cardIds('#board')).length;
    await ev(`document.getElementById('search-input').focus()`);
    check('the panel opens', await waitFor(panelOpen));
    await clickOn(pillSel('review'));
    check('a click on the review pill puts review: in the box and makes it the anchor', await boxIs('review:') && (await anchorText()) === 'review:', await anchor());
    // The arrow is the panel's switch: a click on it, with the switch on, closes the panel and switches it off.
    await clickOn('#search-panel-toggle');
    check('the panel closes and its chip counts the pill', await waitFor(panelShut) && !(await chip()).hidden && (await chip()).text === '1', await chip());
    const shownWithPill = (await cardIds('#board')).length;
    check('the Board shows fewer cards with the pill on', shownWithPill > 0 && shownWithPill < shownBefore, { shownBefore, shownWithPill });
    const pillAway = await emptyPoint(CONTAINERS.board);
    check('the Board has empty space to click with the pill on', !!pillAway, pillAway);
    await click(pillAway.x, pillAway.y);
    await frames();
    check('a click on empty space leaves the pill\'s query in the box, its chip on and the anchor', (await boxText()) === 'review:' && !(await chip()).hidden && (await anchorText()) === 'review:', { box: await boxText(), chip: await chip(), anchor: await anchor() });
    await doubleClick(pillAway.x, pillAway.y);
    check('a double click on empty space takes the pill\'s query out of the box and the anchor with it', await boxIs('') && await noAnchor(), { box: await boxText(), anchor: await anchor() });
    check('and the chip goes off', await waitFor(`document.getElementById('search-chip').classList.contains('hidden')`) && (await chip()).hidden, await chip());
    check('and the Board shows every card again', await waitFor(`new Set([...document.querySelectorAll('#board .card-el')].map((e)=>e.dataset.id)).size===${shownBefore}`), { shownBefore });

    // --- a search typed in the Graph is the anchor there ----------------------------------------------
    await open('/?view=graph');
    await waitFor(ready.graph, 10000);
    await ev(`document.getElementById('search-input').focus()`);
    await send('Input.insertText', { text: TYPED });
    check('a search typed in the Graph is the anchor of the selection', await boxIs(TYPED) && await waitFor(`selectionState.selection.anchor&&selectionState.selection.anchor.source==='typing'&&selectedIds.size>0`), await anchor());
    const lit = await picked();
    const corner = await graphCorner();
    check('the Graph has empty space to click with a search typed', !!corner, corner);
    await click(corner.x, corner.y);
    await frames();
    check('a click on the empty Graph leaves the typed search, its anchor and the cards it selects', (await boxText()) === TYPED && same(await picked(), lit) && (await anchorSource()) === 'typing', { box: await boxText(), picked: await picked() });
    await doubleClick(corner.x, corner.y);
    check('a double click on the empty Graph clears the typed search and the anchor', await boxIs('') && await noAnchor() && await pickedIs([]), { box: await boxText(), anchor: await anchor() });
  },
};
