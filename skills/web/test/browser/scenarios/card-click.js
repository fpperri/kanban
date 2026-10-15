'use strict';
// What a click on a card does, in each view, on the fixture board: a plain
// click opens the card in the Board, Map, Gantt and Calendar (and selects it in
// the Graph, which the graph scenario checks); Ctrl or Cmd toggles one card;
// Shift adds a range; a right-click on a card outside the selection opens its
// menu and leaves the selection as it was (card-menu.js drives the menu); a click
// on empty space leaves it and a double click there clears it (empty-space.js drives
// that in every view); the bulk confirmations name
// how many cards they act on; in the Graph, Enter opens the focused card.
// Card 3 sits in the Board and the Map, and is dated today here so the Calendar
// and the Gantt draw it as well (the runner puts the board's cards back before
// the next scenario).
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectedIds.

module.exports = {
  name: 'card-click',
  board: 'fixture',
  async run(page) {
    const { ev, open, waitFor, click, key, rightClick, check } = page;
    const hasCard = (id) => `/[?&]card=${id}(&|$)/.test(location.search)`;
    const noCard = '!/card=\\d+/.test(location.search)';
    const cardIn = (container, id) => `${container} .card-el[data-id="${id}"]`;
    const closeWithEscape = async (doneExpr) => { await key('Escape'); return waitFor(doneExpr, 2500); };
    const selectionSize = (n) => waitFor(`selectedIds.size===${n}`);

    // A point on the card that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (sel) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    const clickCard = async (sel, extra = {}) => {
      const p = await cardPoint(sel);
      if (!p) throw new Error(`no clickable point on ${sel}`);
      await click(p.x, p.y, extra);
    };
    const emptyPoint = () => ev(`(()=>{for(let y=980;y>500;y-=20)for(let x=1580;x>900;x-=40){const e=document.elementFromPoint(x,y);if(e&&!e.closest('.card-el, button, input, select, a, textarea, [data-keeps-selection], .modal-backdrop, .context-menu'))return {x,y}}return null})()`);
    const showView = async (view, container, id) => {
      await open(`/?view=${view}`);
      return waitFor(`!!document.querySelector(${JSON.stringify(cardIn(container, id))})`, 10000);
    };

    const today = await ev(`(()=>{const d=new Date();const p=(n)=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())})()`);
    await open('/');
    await waitFor(`document.querySelectorAll('#board .card-el').length>0`, 10000);
    const dated = await ev(`fetch('/api/cards/3',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({start_date:${JSON.stringify(today)},end_date:${JSON.stringify(today)}})}).then((r)=>r.status)`);
    check('card 3 is dated today for the Calendar and Gantt clicks', dated === 200, dated);

    for (const [view, container] of [['board', '#board'], ['map', '#map-view'], ['calendar', '#calendar-view'], ['gantt', '#gantt-view']]) {
      check(`the ${view} draws card 3`, await showView(view, container, 3));
      await clickCard(cardIn(container, 3));
      check(`a plain click opens the card in the ${view}`, await waitFor(hasCard(3), 3000) && (await ev('selectedIds.size')) === 0, await ev('location.search'));
      await closeWithEscape(noCard);
    }

    await showView('board', '#board', 3);
    const ids = await ev(`[...new Set([...document.querySelectorAll('#board .card-el')].map((e)=>Number(e.dataset.id)))]`);
    const [first, second, third, fourth] = ids;
    await clickCard(cardIn('#board', first), { modifiers: 2 });
    check('Ctrl+click toggles one card in', await selectionSize(1) && await ev(`selectedIds.has(${first})`));
    await clickCard(cardIn('#board', first), { modifiers: 2 });
    check('Ctrl+click on a selected card toggles it out', await selectionSize(0));
    await clickCard(cardIn('#board', first), { modifiers: 4 });
    check('Cmd+click toggles one card in', await selectionSize(1) && await ev(`selectedIds.has(${first})`));
    await clickCard(cardIn('#board', third), { modifiers: 8 });
    check('Shift+click adds the range from the last toggled card', await selectionSize(3) && await ev(`[${first},${second},${third}].every((i)=>selectedIds.has(i))`), await ev('[...selectedIds]'));
    check('none of those clicks opened a card', await ev(noCard));

    await rightClick(cardIn('#board', fourth));
    check('a right-click on a card outside the selection opens its menu and leaves the selection as it was', await selectionSize(3) && await ev(`!selectedIds.has(${fourth})&&[${first},${second},${third}].every((i)=>selectedIds.has(i))&&!document.getElementById('context-menu').classList.contains('hidden')`), await ev('[...selectedIds]'));
    check('Escape closes that menu and keeps the selection', await closeWithEscape(`document.getElementById('context-menu').classList.contains('hidden')`) && (await ev('selectedIds.size')) === 3);
    const away = await emptyPoint();
    await click(away.x, away.y);
    await ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    check('a click on empty space leaves the selection', (await ev('selectedIds.size')) === 3, away);
    await click(away.x, away.y, { clickCount: 1 });
    await click(away.x, away.y, { clickCount: 2 });
    check('a double click on empty space clears the selection', await selectionSize(0), away);

    // The confirmations answer no, so nothing is archived or deleted; what they asked is what is under test.
    await ev(`(()=>{window.__asked=[];window.confirm=(m)=>{window.__asked.push(m);return false}})()`);
    await clickCard(cardIn('#board', 3), { modifiers: 2 });
    await clickCard(cardIn('#board', 6), { modifiers: 2 });
    check('two cards are selected for the bulk confirmations', await selectionSize(2));
    await rightClick(cardIn('#board', 6));
    await ev(`document.getElementById('ctx-archive').click()`);
    await rightClick(cardIn('#board', 6));
    await ev(`document.getElementById('ctx-delete').click()`);
    const asked = await ev('window.__asked');
    check('the archive confirmation names the count', asked[0] === 'Archive 2 card(s)? (moves their files to archived/)', asked);
    check('the delete confirmation names the count', asked[1] === 'Permanently delete 2 card(s)? This cannot be undone.', asked);

    check('the Graph draws card 3', await showView('graph', '#graph-view', 3));
    await ev(`document.querySelector('#graph-view .graph-node').focus()`);
    await key('Enter');
    check('in the Graph, Enter on a focused card opens it', await waitFor(`/card=\\d+/.test(location.search)`, 3000), await ev('location.search'));
  },
};
