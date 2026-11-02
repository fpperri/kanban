'use strict';
// A double tap on empty space clears the selection at the phone layout, as a double click on empty space
// does at the desk. With touch on, 390 by 844: a single tap on empty space leaves the selection, a
// double tap clears it, on the Board and on the Calendar's weekday row; on the Calendar a double tap on
// an empty day cell opens the new-card form, as a double click does, and leaves the selection alone.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): cardPart, selectedIds,
// selectionFromParts, selectionState, setSelection.

const { tap, doubleTap, outwaitDoubleTap } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;

    const picked = `[...selectedIds].map(String).sort((a,b)=>a-b).join()`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); await tap(page, p.x, p.y); };
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const tapTab = async (col) => {
      const r = await ev(`(()=>{const t=document.querySelector('#board-tabs .board-tab[data-col="${col}"]');t.scrollIntoView({inline:'center',block:'nearest'});const b=t.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
      await tap(page, r.x, r.y);
      return waitFor(`JSON.stringify([...document.querySelectorAll('#board .column')].map((c)=>c.dataset.col))===JSON.stringify(['${col}'])`, 4000);
    };
    // A point on the Board that is no card, no control: the empty space under or between the tiles.
    const emptyPoint = () => ev(`(()=>{for(let y=740;y>300;y-=20){const e=document.elementFromPoint(195,y);if(e&&e.closest('#board')&&!e.closest('.card-el,button,a,input,select,#board-tabs'))return {x:195,y}}return null})()`);
    // The weekday row of the Calendar: the empty space of a view where a double tap on a day makes a card.
    const weekdayPoint = () => ev(`(()=>{const h=document.querySelector('#calendar-view .cal-dow');if(!h)return null;const r=h.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&!hit.closest('.card-el, button, a, input, select, .cal-day')?{x,y}:null})()`);
    const dayCellPoint = () => ev(`(()=>{for(const cell of document.querySelectorAll('#calendar-view .cal-day')){cell.scrollIntoView({block:'center'});const r=cell.getBoundingClientRect();if(r.width===0||r.bottom>innerHeight)continue;for(const x of [r.left+6,r.left+r.width/2,r.right-6]){const y=r.bottom-6;if(document.elementFromPoint(x,y)===cell)return {x,y}}}return null})()`);
    const formOpen = `!document.getElementById('modal').classList.contains('hidden')`;

    // --- the Board ---------------------------------------------------------------------------------
    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 10000));
    check('the doing tab shows', await tapTab('doing'));
    const [a, b] = await ev(`[...document.querySelectorAll('#board .column .card-el')].slice(0,2).map((e)=>e.dataset.id)`);
    const both = [a, b].sort((x, y) => x - y).join();
    await tapOn(titleOf(a));
    await outwaitDoubleTap();
    await tapOn(titleOf(b));
    check('two taps select two cards', await waitFor(`${picked}===${JSON.stringify(both)}`, 3000), await ev(picked));

    const empty = await emptyPoint();
    check('the Board has a point that is neither card nor control', !!empty);
    await outwaitDoubleTap();
    await tap(page, empty.x, empty.y);
    await frames();
    check('a single tap on empty space leaves the selection', await ev(`${picked}===${JSON.stringify(both)}`), await ev(picked));
    await outwaitDoubleTap();
    await doubleTap(page, empty.x, empty.y);
    check('a double tap on empty space clears it', await waitFor(`${picked}===''&&selectionState.selection.anchor===null`, 3000), await ev(picked));

    // --- the Calendar -------------------------------------------------------------------------------
    // The Calendar shows the dated cards only; the selection holds its parts whichever cards a view shows,
    // so the parts are what is counted here.
    const parts = `selectionState.selection.additions.length+(selectionState.selection.anchor?1:0)`;
    await ev(`setSelection(selectionFromParts([cardPart(${JSON.stringify(a)}), cardPart(${JSON.stringify(b)})]))`);
    check('two cards are selected again', await waitFor(`${picked}===${JSON.stringify(both)}`, 3000), await ev(picked));
    const bar = await pointOf('#view-bar [data-view="calendar"]');
    await tap(page, bar.x, bar.y);
    check('the Calendar draws', await waitFor(`document.querySelectorAll('#calendar-view .cal-day').length>=28`, 10000));
    check('with the selection kept', await ev(`${parts}===2`), await ev(parts));

    const cell = await dayCellPoint();
    check('a day cell has a spot with no chip over it', !!cell, cell);
    await outwaitDoubleTap();
    await doubleTap(page, cell.x, cell.y);
    check('a double tap on an empty day opens the new-card form', await waitFor(formOpen, 3000));
    check('and leaves the selection', await ev(`${parts}===2`), await ev(parts));
    await ev(`document.getElementById('modal-close').click()`);
    check('the form closes', await waitFor(`!(${formOpen})`, 3000));

    const week = await weekdayPoint();
    check('the weekday row is empty space', !!week, week);
    await outwaitDoubleTap();
    await doubleTap(page, week.x, week.y);
    check('a double tap on empty space clears the selection', await waitFor(`${parts}===0`, 3000), await ev(parts));
  },
};
