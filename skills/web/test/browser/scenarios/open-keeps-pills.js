'use strict';
// Opening a card changes no filter, on the plan board. With the review pill on, a plain click
// on the one card it leaves opens that card in the Board, the Map, the Gantt and the Calendar,
// and the box still holds review:, the pill is still on, and the view behind the card details
// shows the same card; closing the card with Esc leaves all of that as it was. In the Board a
// second pill on (Shift+click) and a click on its card leaves both pills and the box as they
// were. A click that only selects a card (the Board set to selects in the preferences) still takes
// the pill out of the box, and so does a plain click on a dot in the Graph, which selects; in the
// Graph, Enter on a focused dot opens the card and leaves the pill and the box. Each step waits
// on the page, never on a fixed sleep; a "nothing happened" check waits two animation frames.
//
// Cards 9 and 10 are dated today through the board's own API, so the Calendar and the Gantt draw
// them (the runner puts the board's cards back before the next scenario). Card 10 awaits review
// and card 9 is blocked, and they are the only cards the two pills leave.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectionState.

const VIEWS = ['board', 'map', 'gantt', 'calendar'];
const CONTAINERS = { board: '#board', map: '#map-view', gantt: '#gantt-view', calendar: '#calendar-view', graph: '#graph-view' };
const DATED = [9, 10];
const REVIEW_CARD = 10;
const BLOCKED_CARD = 9;

module.exports = {
  name: 'open-keeps-pills',
  board: 'plan',
  timeoutMs: 120000,
  VIEWS,
  DATED,
  REVIEW_CARD,
  BLOCKED_CARD,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, check } = page;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const hasCard = (id) => `/[?&]card=${id}(&|$)/.test(location.search)`;
    const noCard = '!/card=\\d+/.test(location.search)';
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const anchor = () => ev(`(()=>{const a=selectionState.selection.anchor;return a?{kind:a.kind,text:a.text||null,source:a.source||null,id:a.id||null}:null})()`);
    const additions = () => ev(`selectionState.selection.additions.map((p)=>p.text||null)`);
    const cardIds = (container) => ev(`[...new Set([...document.querySelectorAll('${container} .card-el')].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b)`);
    const cardsAre = (container, ids) => waitFor(`JSON.stringify([...new Set([...document.querySelectorAll('${container} .card-el')].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b))===${JSON.stringify(JSON.stringify(ids))}`);
    const PANEL = `document.getElementById('search-panel')`;
    const panelOpen = `!${PANEL}.classList.contains('hidden')&&${PANEL}.getBoundingClientRect().height>0`;
    const pillSel = (name) => `#search-pills .query-pill[data-pill-key="${name}"]`;
    const panelShut = `${PANEL}.classList.contains('hidden')`;
    // The panel is shut for every click on a card, so the chip in the box is what counts the pills that are on.
    const chip = () => ev(`(()=>{const c=document.getElementById('search-chip');return {hidden:c.classList.contains('hidden')||c.getBoundingClientRect().width===0,text:c.textContent}})()`);
    const pillsOn = async (n) => { const c = await chip(); return !c.hidden && c.text === String(n); };
    const noPillOn = async () => (await chip()).hidden;
    const patchCard = (id, changes) => ev(`fetch('/api/cards/${id}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(changes)})}).then((r)=>r.status)`);
    const clickOn = async (sel, extra = {}) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y, extra);
    };
    // A point on a card that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (container, id) => ev(`(()=>{const el=document.querySelector('${container} .card-el[data-id="${id}"]');if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    // The centre of a card's dot in the Graph, or null when another dot covers it.
    const dotPoint = (id) => ev(`(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`);
    const ready = {
      board: `document.querySelectorAll('#board .card-el').length>20`,
      map: `document.querySelectorAll('#map-view .card-el').length>3`,
      gantt: `document.querySelectorAll('#gantt-view .card-el').length>=2`,
      calendar: `document.querySelectorAll('#calendar-view .card-el').length>=2`,
      graph: `document.querySelectorAll('#graph-view .graph-node').length>3`,
    };
    // Loads a page cold; the stale flag keeps the page being left from answering for the new one.
    const goto = async (target, readyExpr) => {
      await ev(`window.__stale=true`);
      await open(target);
      await waitFor(`window.__stale!==true`, 10000);
      return waitFor(readyExpr, 10000);
    };
    const SWITCH_OFF = `document.getElementById('search-panel-toggle').getAttribute('aria-pressed')==='false'`;
    // The panel opens when the box is focused while the switch (the arrow) is on, which is how a board starts. A click
    // on the arrow would switch it off, so the arrow is clicked only when the switch is already off: that turns it on and opens the panel.
    const openPanel = async () => {
      if (!(await ev(panelOpen))) {
        if (await ev(SWITCH_OFF)) await clickOn('#search-panel-toggle');
        else await ev(`document.getElementById('search-input').focus()`);
      }
      return waitFor(panelOpen);
    };
    // A click on the arrow, with the switch on, shuts the panel and switches it off.
    const closePanel = async () => {
      await clickOn('#search-panel-toggle');
      return waitFor(panelShut);
    };
    const pillIsAnchor = async (text) => {
      const a = await anchor();
      return !!a && a.kind === 'query' && a.text === text && a.source === null;
    };

    const today = await ev(`(()=>{const d=new Date();const p=(n)=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())})()`);
    check('the Board draws the plan board', await goto('/', ready.board));
    for (const id of DATED) {
      check(`card ${id} is dated today for the Calendar and the Gantt`, (await patchCard(id, { start_date: today, end_date: today })) === 200);
    }

    // --- a plain click that opens a card, with the review pill on, in each view -----------------------
    for (const view of VIEWS) {
      const container = CONTAINERS[view];
      check(`the ${view} draws its cards`, await goto(`/?view=${view}`, ready[view]));
      await openPanel();
      await clickOn(pillSel('review'));
      check(`${view}: a click on the review pill puts review: in the box and makes it the anchor`, await boxIs('review:') && await pillIsAnchor('review:'), await anchor());
      check(`${view}: the view shows the one card the pill leaves`, await cardsAre(container, [REVIEW_CARD]), await cardIds(container));
      check(`${view}: the panel closes and its chip counts the pill`, await closePanel() && await pillsOn(1), await chip());
      const p = await cardPoint(container, REVIEW_CARD);
      check(`${view}: the review card has a point to click`, !!p, p);
      await click(p.x, p.y);
      check(`${view}: a plain click on the card opens it`, await waitFor(hasCard(REVIEW_CARD), 3000), await ev('location.search'));
      await frames();
      check(`${view}: the box still holds review:`, (await boxText()) === 'review:', await boxText());
      check(`${view}: the review pill is still on, and still the anchor`, await pillsOn(1) && await pillIsAnchor('review:'), await anchor());
      check(`${view}: the view behind the card shows the same card`, same(await cardIds(container), [REVIEW_CARD]), await cardIds(container));
      await key('Escape');
      check(`${view}: Esc closes the card`, await waitFor(noCard, 2500), await ev('location.search'));
      await frames();
      check(`${view}: closing the card leaves the box as it was`, (await boxText()) === 'review:', await boxText());
      check(`${view}: closing the card leaves the pill on, still the anchor`, await pillsOn(1) && await pillIsAnchor('review:'), await anchor());
      check(`${view}: closing the card leaves the view showing the same card`, same(await cardIds(container), [REVIEW_CARD]), await cardIds(container));
    }

    // --- two pills on: both stay, and so does the box ---------------------------------------------------
    check('the Board draws the plan board for two pills', await goto('/?view=board', ready.board));
    await openPanel();
    await clickOn(pillSel('review'));
    await boxIs('review:');
    await clickOn(pillSel('blocked'), { modifiers: 8 });
    check('a Shift+click on the blocked pill grows the box to "review: | blocked:"', await boxIs('review: | blocked:'), await boxText());
    const both = [BLOCKED_CARD, REVIEW_CARD].sort((a, b) => a - b);
    check('the Board shows the two cards the pills leave', await cardsAre('#board', both), await cardIds('#board'));
    check('the panel closes and its chip counts the two pills', await closePanel() && await pillsOn(2), await chip());
    const blockedPoint = await cardPoint('#board', BLOCKED_CARD);
    check('the blocked card has a point to click', !!blockedPoint, blockedPoint);
    await click(blockedPoint.x, blockedPoint.y);
    check('a plain click on the blocked card opens it', await waitFor(hasCard(BLOCKED_CARD), 3000), await ev('location.search'));
    await frames();
    check('both pills stay on, the first the anchor and the second an addition', await pillsOn(2) && await pillIsAnchor('review:') && same(await additions(), ['blocked:']), { anchor: await anchor(), additions: await additions() });
    check('the box still holds both queries', (await boxText()) === 'review: | blocked:', await boxText());
    check('the Board behind the card shows the same two cards', same(await cardIds('#board'), both), await cardIds('#board'));
    await key('Escape');
    await waitFor(noCard, 2500);
    await frames();
    check('closing the card leaves both pills on and the box as it was', await pillsOn(2) && (await boxText()) === 'review: | blocked:', await boxText());

    // --- a click that only selects still takes the pill out of the box ---------------------------------------
    await ev(`localStorage.setItem('kanban.plan.prefs', JSON.stringify({click:{board:'selects'}}))`);
    check('the Board draws the plan board set to selects', await goto('/?view=board', ready.board));
    await openPanel();
    await clickOn(pillSel('review'));
    await boxIs('review:');
    await cardsAre('#board', [REVIEW_CARD]);
    await closePanel();
    const selectPoint = await cardPoint('#board', REVIEW_CARD);
    check('the review card has a point to click in the Board set to selects', !!selectPoint, selectPoint);
    await click(selectPoint.x, selectPoint.y);
    check('a plain click in a Board set to selects selects the card and opens nothing', await waitFor(`selectionState.selection.anchor&&selectionState.selection.anchor.kind==='card'&&selectionState.selection.anchor.id===${REVIEW_CARD}`) && await ev(noCard), await anchor());
    check('and it takes the pill\'s query out of the box', await boxIs(''), await boxText());
    check('and the pill is off in the Board', await noPillOn());
    await ev(`localStorage.removeItem('kanban.plan.prefs')`);

    // --- the Graph: Enter opens and changes nothing, a plain click on a dot selects and drops the pill ----------
    check('the Graph draws the plan board', await goto('/?view=graph', ready.graph));
    await openPanel();
    await clickOn(pillSel('review'));
    check('in the Graph a click on the review pill puts review: in the box and makes it the anchor', await boxIs('review:') && await pillIsAnchor('review:'), await anchor());
    check('the panel closes and its chip counts the pill', await closePanel() && await pillsOn(1), await chip());
    await ev(`document.querySelector('#graph-view .graph-node[data-id="${REVIEW_CARD}"]').focus()`);
    check('the review card\'s dot holds the focus', await ev(`document.activeElement===document.querySelector('#graph-view .graph-node[data-id="${REVIEW_CARD}"]')`));
    await key('Enter');
    check('in the Graph, Enter on a focused dot opens the card', await waitFor(hasCard(REVIEW_CARD), 3000), await ev('location.search'));
    await frames();
    check('and leaves the box, the pill and the anchor as they were', (await boxText()) === 'review:' && await pillsOn(1) && await pillIsAnchor('review:'), { box: await boxText(), anchor: await anchor() });
    await key('Escape');
    check('Esc closes the card and the pill is still on', await waitFor(noCard, 2500) && (await boxText()) === 'review:' && await pillsOn(1), await boxText());
    const dot = await dotPoint(REVIEW_CARD);
    check('the review card\'s dot has a point to click', !!dot, dot);
    await click(dot.x, dot.y);
    check('a plain click on the dot selects the card and opens nothing', await waitFor(`selectionState.selection.anchor&&selectionState.selection.anchor.kind==='card'&&selectionState.selection.anchor.id===${REVIEW_CARD}`) && await ev(noCard), await anchor());
    check('and takes the pill\'s query out of the box', await boxIs(''), await boxText());
    check('and the pill is off in the Graph', await noPillOn());
  },
};
