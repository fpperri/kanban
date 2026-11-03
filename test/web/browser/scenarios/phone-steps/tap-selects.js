'use strict';
// A tap on a card at the phone layout selects it, and a double tap opens it. With touch on, 390 by 844,
// default preferences: a tap adds a card to the selection, a tap on a selected card takes it out, and
// a double tap opens the card and leaves the selection and its range start as they were before the
// first tap. It runs in the Board, the Map, the Gantt, the Calendar and the Graph. The preferences
// sheet shows A tap on a card instead of the desk's click rows, and a view set to opens opens on a
// tap as it always did. A browser that saved opens for every desk click still selects on a tap. A
// tag still searches. Each second tap on one card waits out the browser's double-tap window first, so
// it is a second tap and not a double tap.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds, selectionState.

const { tap, doubleTap, outwaitDoubleTap } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const hasCard = (id) => `new URLSearchParams(location.search).get('card')==='${id}'&&!document.querySelector('#detail-modal').classList.contains('hidden')`;
    const noCard = `!new URLSearchParams(location.search).has('card')`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); await tap(page, p.x, p.y); };
    const doubleTapOn = async (sel) => { const p = await pointOf(sel); await outwaitDoubleTap(); await doubleTap(page, p.x, p.y); };
    const pickedIs = (ids) => waitFor(`${picked}===${JSON.stringify(ids)}`, 3000);
    // The page keeps an entry of its own in the tab's history while a selection stands, marked in its history state, and takes it off once nothing wants it, each on its own timer.
    const kept = `!!history.state&&history.state.kanbanBack===true`;
    // Where the tab stands in its history. A card opened once moves it by one step, whether or not an entry of the page's own came and went before: the length of the history does not say, for an entry taken off stays ahead of the tab until the next step replaces it.
    const stepNow = () => ev('navigation.currentEntry.index');
    const closeCard = async () => {
      await tapOn('#detail-back-btn');
      return waitFor(`document.querySelector('#detail-modal').classList.contains('hidden')&&${noCard}`, 3000);
    };
    // The Graph lays itself out for a moment after it draws; a tap on a dot that is still moving misses it.
    const graphSettled = async () => {
      let was = null;
      for (let i = 0; i < 40; i++) {
        const now = await ev(`JSON.stringify([graphCur.view.k,[...document.querySelectorAll('#graph-view .graph-node')].slice(0,3).map((n)=>n.getBoundingClientRect().left)])`);
        if (now === was) return;
        was = now;
        await page.sleep(200);
      }
    };
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;

    // --- the Board ---------------------------------------------------------------------------------
    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    const [a, b, c] = await ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0,3).map((e)=>e.dataset.id)`);

    await tapOn(titleOf(a));
    check('a tap on a card selects it', await pickedIs(a), await ev(picked));
    check('and opens nothing', await ev(`${noCard}&&document.querySelector('#detail-modal').classList.contains('hidden')`));
    await tapOn(titleOf(b));
    check('a tap on a second card adds it to the selection', await pickedIs([a, b].sort((x, y) => x - y).join()), await ev(picked));
    await outwaitDoubleTap();
    await tapOn(titleOf(a));
    check('a second tap on a selected card takes it out', await pickedIs(b), await ev(picked));
    check('and the card stays closed', await ev(noCard));

    const before = await ev(`({ids:${picked},rangeStart:String(selectionState.rangeStart)})`);
    check('the page keeps an entry of its own for the selection', await waitFor(kept, 5000));
    const stepBefore = await stepNow();
    await doubleTapOn(titleOf(c));
    check('a double tap opens the card', await waitFor(hasCard(c), 3000), await ev('location.search'));
    check('and leaves the selection and its range start as they were before the first tap', JSON.stringify(await ev(`({ids:${picked},rangeStart:String(selectionState.rangeStart)})`)) === JSON.stringify(before), await ev(`({ids:${picked},rangeStart:String(selectionState.rangeStart)})`));
    check('the card opened once: one step in the history', await stepNow() === stepBefore + 1, await stepNow());
    check('closing the card leaves the selection as it was', await closeCard() && await ev(`${picked}===${JSON.stringify(before.ids)}`));

    const tag = await ev(`(()=>{const t=[...document.querySelectorAll('#board .column .card-el .tag')][0];return t?t.textContent:null})()`);
    if (tag) {
      const before2 = await ev(picked);
      await tapOn('#board .column .card-el .tag');
      check('a tap on a tag still searches for it', await waitFor(`document.getElementById('search-input').value.includes(${JSON.stringify(`tags:${tag}`)})`, 3000), await ev(`document.getElementById('search-input').value`));
      check('and selects no card', await ev(`${picked}===${JSON.stringify(before2)}`));
    }

    // --- the other views -----------------------------------------------------------------------------
    const view = async (name, ready, target, query) => {
      await open(`/?view=${name}`);
      check(`${name}: the view draws`, await waitFor(ready, 10000));
      if (query) {
        await ev(`(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(query)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        check(`${name}: the search shows the card`, await waitFor(`!!document.querySelector(${JSON.stringify(target)})`, 10000));
      }
      if (name === 'graph') await graphSettled();
      const id = await ev(`document.querySelector(${JSON.stringify(target)}).closest('.card-el').dataset.id`);
      await tapOn(target);
      check(`${name}: a tap selects the card`, await pickedIs(id), await ev(picked));
      check(`${name}: and opens nothing`, await ev(noCard));
      check(`${name}: the page keeps an entry of its own for the selection`, await waitFor(kept, 5000));
      await outwaitDoubleTap();
      await tapOn(target);
      check(`${name}: a second tap takes it out`, await pickedIs(''), await ev(picked));
      check(`${name}: and the page takes its entry off`, await waitFor(`!(${kept})`, 5000));
      const steps = await stepNow();
      await doubleTapOn(target);
      check(`${name}: a double tap opens the card`, await waitFor(hasCard(id), 3000), await ev('location.search'));
      check(`${name}: and leaves the selection as it was before the first tap`, await ev(`${picked}===''`), await ev(picked));
      check(`${name}: and opens it once`, await stepNow() === steps + 1, await stepNow());
    };
    await view('map', `document.querySelectorAll('#map-view .card-el').length>0`, '#map-view .card-el');
    await view('gantt', `document.querySelectorAll('#gantt-view .gantt-label').length>0`, '#gantt-view .gantt-label[data-id="28"] .gantt-label-id', 'centennial');
    await view('calendar', `document.querySelectorAll('#calendar-view .cal-day').length>=28`, '#calendar-view .cal-chip[data-id="28"]', 'centennial');
    await view('graph', `document.querySelectorAll('#graph-view .graph-node').length>0`, '#graph-view .graph-node[data-id="1"] .graph-dot');

    // --- the preferences sheet ------------------------------------------------------------------------
    await open('/');
    check('the Board draws again', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await ev(`document.getElementById('more-btn').click()`);
    await ev(`document.getElementById('more-prefs').click()`);
    await ev(`(()=>{const i=document.querySelector('.prefs-menu-item[data-page="browser:prefs"]');if(i)i.click()})()`);
    const shownBox = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'})()`;
    check('the sheet shows A tap on a card', await waitFor(shownBox('.prefs-phone-group'), 3000));
    await waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 3000);
    check('and not the desk\'s A plain click on a card', await ev(`!(${shownBox('.prefs-desk-group')})`));
    const rows = await ev(`[...document.querySelectorAll('.prefs-phone-group .prefs-row')].map((r)=>r.querySelector('.prefs-label').textContent+':'+[...r.querySelectorAll('.prefs-opt')].map((b)=>b.dataset.value+(b.getAttribute('aria-pressed')==='true'?'*':'')+(b.disabled?'!':'')).join('/')).join(' ')`);
    check('it has a row per view, selects chosen, the Graph fixed', rows === 'Board:opens/selects* Map:opens/selects* Gantt:opens/selects* Calendar:opens/selects* Graph:selects*!', rows);
    await tapOn('.prefs-phone-group .prefs-opt[data-view="board"][data-value="opens"]');
    check('a tap on opens chooses it for the Board', await waitFor(`document.querySelector('.prefs-phone-group .prefs-opt[data-view="board"][data-value="opens"]').getAttribute('aria-pressed')==='true'`, 3000));
    check('and stores it apart from the desk\'s clicks', await ev(`(()=>{const p=JSON.parse(localStorage.getItem(storageKey(state.projectName,'prefs')));return p.tap.board==='opens'&&p.click.board==='opens'&&p.tap.map==='selects'})()`));
    await tapOn('#prefs-close');
    check('the sheet closes', await waitFor(`document.getElementById('prefs-sheet').classList.contains('hidden')`, 3000));
    await tapOn(titleOf(a));
    check('with opens chosen a tap on a card opens it as it does today', await waitFor(hasCard(a), 3000), await ev('location.search'));
    check('and selects nothing', await ev(`${picked}===''`));
    await closeCard();

    // --- a browser that saved opens for every desk click ----------------------------------------------
    await ev(`localStorage.setItem(storageKey(state.projectName,'prefs'), JSON.stringify({click:{board:'opens',map:'opens',gantt:'opens',calendar:'opens',graph:'selects'},archivedDone:true}))`);
    await open('/');
    check('the Board draws for the saved browser', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await tapOn(titleOf(a));
    check('a saved opens for the desk click leaves the phone selecting on a tap', await pickedIs(a) && await ev(noCard), await ev(picked));
  },
};
