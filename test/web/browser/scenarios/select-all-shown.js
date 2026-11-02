'use strict';
// Select all shown at the desk, on the fixture board. With the box empty the search panel has no such
// button; a click into the box opens the panel, and a query for the done cards brings the button, reading
// how many live done cards the Board shows (the Archive column is folded to start, so the archived done
// cards are not among them). A click on it selects them all, the box keeps its query, and the right-click
// menu on one of them is the menu of them all: Archive selected opens the package popup for exactly those
// cards and archives them. The scenario puts the archived cards back. The phone's flow, with the bar in
// place of the menu, is the phone scenario's select-all-shown step.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): api, loadBoard, selectedIds, state.

module.exports = {
  name: 'select-all-shown',
  board: 'fixture',
  async run(page) {
    const { ev, open, waitFor, click, centre, rightClick, check } = page;

    const BUTTON = `document.getElementById('search-select-all')`;
    const shown = `!${BUTTON}.classList.contains('hidden')&&${BUTTON}.getBoundingClientRect().height>0`;
    const picked = `[...selectedIds].map(Number).sort((a,b)=>a-b).join()`;
    const TYPE = (text) => `(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;
    const clickOn = async (sel) => { const p = await centre(sel); if (!p) throw new Error(`nothing matches ${sel}`); await click(p.x, p.y); };

    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .card-el').length>0`, 10000));
    await clickOn('#search-input');
    check('a click into the box opens the panel', await waitFor(`!document.getElementById('search-panel').classList.contains('hidden')`, 3000));
    check('with an empty box it has no Select all shown', !(await ev(shown)));

    await ev(TYPE('status:done'));
    const live = await ev(`state.active.filter((c)=>c.status==='done').map((c)=>Number(c.id)).sort((a,b)=>a-b)`);
    check('the fixture has live done cards, and archived ones the Board folds away', live.length >= 3 && (await ev(`state.archived.some((c)=>c.status==='done')`)), live.join());
    check('a query brings the button, counting the done cards the Board shows', await waitFor(shown, 3000) && (await ev(`${BUTTON}.textContent`)) === `Select all shown (${live.length})`, await ev(`${BUTTON}.textContent`));

    await clickOn('#search-select-all');
    check('a click on it selects every done card the Board shows', await waitFor(`${picked}===${JSON.stringify(live.join())}`, 3000), await ev(picked));
    check('the box keeps its query', (await ev(`document.getElementById('search-input').value`)) === 'status:done');

    await rightClick(`#board .card-el[data-id="${live[0]}"]`);
    check('the right-click menu on one of them is the menu of them all', await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')&&menuSubject.ids.length===${live.length}`, 3000), await ev(`menuSubject.ids.join()`));
    await ev(`document.getElementById('ctx-archive').click()`);
    check('Archive selected opens the package popup for them all', await waitFor(`!document.getElementById('bulk-archive').classList.contains('hidden')&&document.getElementById('bulk-archive-title').textContent===${JSON.stringify(`Archive ${live.length} card(s)`)}`, 3000));
    await clickOn('#bulk-archive-apply');
    check('and archives them', await waitFor(live.map((id) => `state.archived.some((c)=>String(c.id)==='${id}')`).join('&&') + '&&' + live.map((id) => `!state.active.some((c)=>String(c.id)==='${id}')`).join('&&'), 8000));
    for (const id of live) await ev(`api('POST','/api/cards/${id}/restore').then(()=>true)`);
    await ev(`loadBoard().then(()=>true)`);
    check('the scenario puts the cards back', await waitFor(live.map((id) => `state.active.some((c)=>String(c.id)==='${id}')`).join('&&'), 5000));
  },
};
