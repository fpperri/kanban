'use strict';
// Select all shown on a 390 px phone, with touch. With the Todo tab open and an empty box the search
// panel has no such button. A query for the done cards brings it, reading how many live cards the search
// matches in every status (the Todo tab draws none of them; the archive is a location and is left out),
// the same with Isolate on and off, 44 px tall inside the screen. A tap on it selects them all, the bar
// rises reading the same number, and Archive on the bar archives them and asks about the same number:
// three taps from the query, none on a card. The step leaves the board as it found it: the archived
// cards are restored.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): api, loadBoard, selectedIds, state.

const { tap } = require('../../steps');
const { askUp, refuseNativeConfirm, nativeConfirmsSeen } = require('../../ask');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check, shot } = page;

    const BUTTON = `document.getElementById('search-select-all')`;
    const BAR = `document.getElementById('selection-bar')`;
    const buttonShown = `!${BUTTON}.classList.contains('hidden')&&${BUTTON}.getBoundingClientRect().height>0`;
    const picked = `[...selectedIds].map(Number).sort((a,b)=>a-b).join()`;
    const barShown = `getComputedStyle(${BAR}).display!=='none'&&!${BAR}.classList.contains('hidden')&&${BAR}.getBoundingClientRect().height>0`;
    const TYPE = (text) => `(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); if (!p) throw new Error(`nothing matches ${sel}`); await tap(page, p.x, p.y); };
    const label = () => ev(`${BUTTON}.textContent`);
    const doneCards = `state.active.filter((c)=>c.status==='done')`;
    const isolated = () => ev(`document.getElementById('isolate-switch').getAttribute('aria-checked')==='true'`);

    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await tapOn('.board-tab[data-col="todo"]');
    check('the Todo tab is open', await waitFor(`document.querySelector('#board-tabs .board-tab[aria-selected="true"]').dataset.col==='todo'`, 3000));

    await tapOn('#search-btn');
    check('the search field opens with the panel under it', await waitFor(`!document.getElementById('search-panel').classList.contains('hidden')`, 3000));
    check('with an empty box the panel has no Select all shown', !(await ev(buttonShown)));

    // --- a query brings it, with the count of every status ---------------------------------------------
    await ev(TYPE('status:done'));
    const expected = await ev(`${doneCards}.length`);
    const ids = await ev(`${doneCards}.map((c)=>Number(c.id)).sort((a,b)=>a-b).join()`);
    check('the fixture has live done cards and archived ones', expected >= 3 && (await ev(`state.archived.some((c)=>c.status==='done')`)), String(expected));
    check('a query brings the button, reading how many live cards the search matches, the archived ones left out', await waitFor(buttonShown, 3000) && (await label()) === `Select all shown (${expected})`, await label());
    check('the open tab draws none of them: the count is the match, not the cards drawn', await ev(`[...document.querySelectorAll('#board .card-el')].every((el)=>!(${JSON.stringify(ids)}.split(',').includes(el.dataset.id)))`));
    check('typing turned Isolate on', await isolated());

    const [w, h] = await ev(`[innerWidth, innerHeight]`);
    const r = await ev(`(()=>{const r=${BUTTON}.getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,h:r.height}})()`);
    check('it is 44 px tall and inside the screen', r.h >= 44 && r.l >= 0 && r.r <= w && r.t >= 0 && r.b <= h, JSON.stringify(r));
    await shot('button');

    await tapOn('#isolate-switch');
    check('with Isolate off the count is the same', !(await isolated()) && (await label()) === `Select all shown (${expected})`, await label());
    await tapOn('#isolate-switch');
    check('and with it on again', (await isolated()) && (await label()) === `Select all shown (${expected})`, await label());

    // --- the tap selects them all ----------------------------------------------------------------------
    await tapOn('#search-select-all');
    check('a tap on it selects every live done card, whichever tab is open', await waitFor(`${picked}===${JSON.stringify(ids)}`, 3000), await ev(picked));
    check('the box keeps its query', (await ev(`document.getElementById('search-input').value`)) === 'status:done');
    check('the bar rises reading the same number', await waitFor(`${barShown}&&document.getElementById('selection-bar-count').textContent===${JSON.stringify(`${expected} selected`)}`, 3000), await ev(`document.getElementById('selection-bar-count').textContent`));
    await shot('selected');

    // --- Archive on the bar ----------------------------------------------------------------------------
    await refuseNativeConfirm(page);
    const live = ids.split(',').map(Number);
    await tapOn('#selection-bar-archive');
    check('every card is done, so there is no first question, and the package popup asks about the number the button and the bar read', !(await askUp(page)) && await waitFor(`!document.getElementById('bulk-archive').classList.contains('hidden')&&document.getElementById('bulk-archive-title').textContent===${JSON.stringify(`Archive ${live.length} card(s)`)}`, 3000));
    await tapOn('#bulk-archive-apply');
    check('the done cards leave the Board for the archive', await waitFor(live.map((id) => `state.archived.some((c)=>String(c.id)==='${id}')`).join('&&') + '&&' + live.map((id) => `!state.active.some((c)=>String(c.id)==='${id}')`).join('&&'), 8000));
    check('the selection is empty afterwards and the bar has gone', await waitFor(`${picked}===''&&!(${barShown})`, 3000), await ev(picked));
    check('no native confirm() was raised', (await nativeConfirmsSeen(page)) === 0);
    for (const id of live) await ev(`api('POST','/api/cards/${id}/restore').then(()=>true)`);
    await ev(`loadBoard().then(()=>true)`);
    check('the step puts the cards back', await waitFor(live.map((id) => `state.active.some((c)=>String(c.id)==='${id}')`).join('&&'), 5000));
  },
};
