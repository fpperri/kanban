'use strict';
// The iteration dropdown, on the iterations board (the groups board with `iterations: true`): zephyr-1
// and zephyr-2 are its iterations and zephyr-2 runs on the day the scenario sets (2026-10-15, by
// replacing the page's own idea of today, so the scenario does not depend on the clock). The dropdown
// opens on the running iteration, a pick narrows Board, Calendar, Gantt, Map and Graph on top of the
// search box without writing it, the pick is kept across a reload, "New iteration..." opens the group
// form with zephyr-3 and the dates continuing at the same length, and the Calendar shades the picked
// iteration's days and moves to its first when the pick is made, not when the page loads; a kept pick
// yields to the running iteration once the iteration it was kept under has ended. The groups board, with no iterations line, has no dropdown.
//
// The iterations board dates card 3 (in zephyr-2) and card 5 (in zephyr-1) in the same week, so the Gantt and
// the Calendar have one card to draw for each pick.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// state, calendarAnchor, localTodayStr, renderBoard, writeSearch.

const SEL = `document.getElementById('iter-select')`;
const BOARD_IDS = `[...document.querySelectorAll('#board .card-el')].map((e)=>e.dataset.id).sort((a,b)=>a-b).join()`;
const DLG = `document.getElementById('group-dialog')`;
const DLG_UP = `!${DLG}.classList.contains('hidden')`;
const DLG_GONE = `${DLG}.classList.contains('hidden')`;
const KEY = `kanban.iterations.iteration`;
const drawn = (sel) => `[...new Set([...document.querySelectorAll(${JSON.stringify(sel)})].map((e)=>e.dataset.id))].sort((a,b)=>a-b).join()`;
const I2_CARDS = '3,7,15,22,23,24';

module.exports = {
  name: 'iterations',
  board: 'iterations',
  alsoBoards: ['groups'],
  timeoutMs: 90000,
  async run(page) {
    const { ev, open, waitFor, key, check, shot } = page;
    const boardReady = (ms, least = 5) => waitFor(`document.querySelectorAll('#board .card-el').length>${least}`, ms || 10000);
    const setToday = (day) => ev(`(()=>{localTodayStr=()=>${JSON.stringify(day)};renderBoard();return true})()`);
    const pick = (value) => ev(`(()=>{const s=${SEL};s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));return s.value===${JSON.stringify(value)}})()`);
    const search = async (text) => {
      await ev(`writeSearch(${JSON.stringify(text)}, 'typing')`);
      return waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`, 2000);
    };

    // --- a board with no iterations line has no dropdown ---------------------------------------------------------
    await open('/?view=board', 'groups');
    check('groups: the board is drawn with groups', await boardReady() && await ev(`state.groups&&state.groups.list.length===5`));
    check('groups: no iterations line, no dropdown', await ev(`${SEL}.hidden&&state.iterations===false`));

    // --- it opens on the running iteration ---------------------------------------------------------------------------
    await open('/?view=board');
    check('iterations: the board is drawn', await boardReady());
    await setToday('2026-10-15');
    check('iterations: the dropdown shows', await waitFor(`!${SEL}.hidden`, 3000));
    const labels = JSON.stringify(['|All cards', 'I2|#I2 zephyr-2 · 2026-10-12 to 2026-10-23 · running', 'I1|#I1 zephyr-1 · 2026-09-28 to 2026-10-09', '__new|New iteration…']);
    check('iterations: All cards, the iterations newest first with their dates, New iteration...', await ev(`JSON.stringify([...${SEL}.options].map((o)=>o.value+'|'+o.textContent))===${JSON.stringify(labels)}`), await ev(`[...${SEL}.options].map((o)=>o.value+'|'+o.textContent).join(' / ')`));
    check('iterations: it opens on the running iteration', await ev(`${SEL}.value==='I2'`));
    check('iterations: the Board shows only its cards', await waitFor(`${BOARD_IDS}===${JSON.stringify(I2_CARDS)}`, 3000), await ev(BOARD_IDS));
    check('iterations: the search box is empty', await ev(`document.getElementById('search-input').value===''`));
    await shot('iteration-board');

    // --- it narrows on top of the search box, never writing it ------------------------------------------------------
    await search('#7');
    check('iterations: a search inside the iteration finds its card', await waitFor(`${BOARD_IDS}==='7'`, 3000), await ev(BOARD_IDS));
    await search('#2');
    check('iterations: a search that matches a card outside the iteration finds nothing', await waitFor(`${BOARD_IDS}===''`, 3000), await ev(BOARD_IDS));
    await search('');
    check('iterations: clearing the box brings the iteration\'s cards back', await waitFor(`${BOARD_IDS}===${JSON.stringify(I2_CARDS)}`, 3000), await ev(BOARD_IDS));

    // --- All cards, another iteration, and the pick kept in this browser ---------------------------------------------
    check('iterations: picking All cards', await pick(''));
    check('iterations: shows every card again', await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 3000));
    check('iterations: and the box is still empty', await ev(`document.getElementById('search-input').value===''`));
    check('iterations: picking zephyr-1', await pick('I1'));
    check('iterations: shows its cards', await waitFor(`(()=>{const cut=state.groups.list.find((g)=>g.id==='I1').cards;const live=state.active.filter((c)=>cut.includes(c.id)).map((c)=>c.id).sort((a,b)=>a-b).join();return live.length>0&&${BOARD_IDS}===live})()`, 3000), await ev(BOARD_IDS));
    check('iterations: the choice is kept in this browser', await ev(`localStorage.getItem(${JSON.stringify(KEY)})==='{"pick":"I1","under":"I2"}'`), await ev(`String(localStorage.getItem(${JSON.stringify(KEY)}))`));
    await open('/?view=board');
    check('iterations: after a reload the board is drawn', await boardReady(10000, 0));
    await setToday('2026-10-15');
    check('iterations: it opens on the kept choice, not the running iteration', await ev(`${SEL}.value==='I1'`));
    await setToday('2026-10-25');
    check('iterations: once the iteration it was kept under has ended, the kept choice yields', await waitFor(`${SEL}.value===''`, 3000), await ev(`${SEL}.value`));
    await setToday('2026-10-15');

    // --- every view is narrowed ----------------------------------------------------------------------------------------------
    check('iterations: picking zephyr-2', await pick('I2'));
    const views = [
      ['map', '#map-view .card-el'],
      ['gantt', '#gantt-view .card-el', '3'],
      ['calendar', '#calendar-view .card-el', '3'],
      ['graph', '#graph-view .graph-node'],
    ];
    for (const [view, sel, only] of views) {
      await open(`/?view=${view}`);
      await waitFor(`document.querySelectorAll(${JSON.stringify(sel)}).length>0`, 8000);
      await setToday('2026-10-15');
      const ids = await ev(drawn(sel));
      const ok = await ev(`(()=>{const cut=new Set(${JSON.stringify(I2_CARDS)}.split(','));const ids=${JSON.stringify(ids)}.split(',').filter(Boolean);return ids.length>0&&ids.every((id)=>cut.has(id))})()`);
      check(`iterations: the ${view} draws only the iteration's cards`, ok && (only === undefined || ids === only), ids);
    }

    // --- the Calendar shades the iteration and opens on its first week -----------------------------------------------------
    await open('/?view=calendar');
    await waitFor(`document.querySelectorAll('#calendar-view .cal-day').length>20`, 8000);
    await setToday('2026-10-15');
    check('iterations: the Calendar does not jump to the iteration on load', await ev(`calendarAnchor!=='2026-10-12'`), await ev(`String(calendarAnchor)`));
    const shadedDays = `[...document.querySelectorAll('#calendar-view .cal-day.in-iteration')].map((e)=>e.dataset.day).sort()`;
    check('iterations: and shades its twelve days, no others', await waitFor(`(()=>{const d=${shadedDays};return d.length===12&&d[0]==='2026-10-12'&&d[11]==='2026-10-23'})()`, 3000), await ev(`${shadedDays}.join()`));
    await shot('iteration-calendar');
    check('iterations: picking All cards shades nothing', await pick('') && await waitFor(`document.querySelectorAll('#calendar-view .in-iteration').length===0`, 3000));
    check('iterations: picking zephyr-2 moves the Calendar to its first day', await pick('I2') && await waitFor(`calendarAnchor==='2026-10-12'`, 3000), await ev(`String(calendarAnchor)`));
    check('iterations: picking zephyr-1 moves the Calendar to its first day', await pick('I1') && await waitFor(`calendarAnchor==='2026-09-28'`, 3000), await ev(`String(calendarAnchor)`));

    // --- New iteration... ------------------------------------------------------------------------------------------------------------
    await open('/?view=board');
    check('iterations: the board is drawn again', await boardReady(10000, 0));
    await setToday('2026-10-15');
    check('iterations: picking zephyr-2 once more', await pick('I2'));
    check('iterations: New iteration... opens the group form', await pick('__new') === false && await waitFor(DLG_UP, 3000));
    check('iterations: the form is for an iteration, with the name bumped', await ev(`document.getElementById('group-dialog-title').textContent==='New iteration'&&document.getElementById('gf-name').value==='zephyr-3'&&document.getElementById('gf-folder').value==='iteration'`));
    check('iterations: the dates continue at the same length', await ev(`document.getElementById('gf-start').value==='2026-10-24'&&document.getElementById('gf-end').value==='2026-11-04'`));
    check('iterations: auto_join is on', await ev(`document.getElementById('gf-auto').checked&&!document.getElementById('gf-auto').disabled`));
    check('iterations: the pick is still zephyr-2', await ev(`${SEL}.value==='I2'`));
    await shot('new-iteration');
    await key('Escape');
    check('iterations: Esc closes the form and makes nothing', await waitFor(DLG_GONE, 2500) && await ev(`state.groups.list.length===5`));
    check('iterations: New iteration... again', await pick('__new') === false && await waitFor(DLG_UP, 3000));
    await ev(`document.querySelector('#group-dialog .group-form').requestSubmit()`);
    check('iterations: Create makes zephyr-3 in the iteration folder with auto_join', await waitFor(`(()=>{const g=state.groups.list.find((x)=>x.id==='I3');return !!g&&g.folder==='iteration'&&g.name==='zephyr-3'&&g.auto_join===true&&g.start_date==='2026-10-24'&&g.end_date==='2026-11-04'})()`, 4000), await ev(`JSON.stringify(state.groups.list.map((g)=>g.id))`));
    check('iterations: it tops the dropdown, and the pick is still zephyr-2', await waitFor(`${SEL}.options[1].value==='I3'&&${SEL}.value==='I2'`, 4000), await ev(`[...${SEL}.options].map((o)=>o.value).join()+' '+${SEL}.value`));
    check('iterations: zephyr-2 membership is untouched', await ev(`state.groups.list.find((g)=>g.id==='I2').cards.join()===${JSON.stringify(I2_CARDS)}`));
  },
};
