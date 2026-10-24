'use strict';
// Editing on a 390 px phone. The edit form fills the viewport and every field is 16 px, so typing
// never zooms the page. Saving an edit opened from a card brings the card back, on the status tab of
// its new status, and back from it lands on that tab. A ?card= link opens the card full screen with
// its status tab active behind it. A refused move to doing keeps the form open and says why.

const { tap } = require('../../steps');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check, expectRefusedRequest } = page;
    const cardOpen = (id) => `!document.querySelector('#detail-modal').classList.contains('hidden')&&new URLSearchParams(location.search).get('card')==='${id}'`;
    const formOpen = `!document.querySelector('#modal').classList.contains('hidden')`;
    const tabs = `[...document.querySelectorAll('#board-tabs .board-tab')].filter((t)=>t.getAttribute('aria-selected')==='true').map((t)=>t.dataset.col)`;
    const tapSel = async (sel) => {
      const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'center',inline:'center'});const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
      await tap(page, r.x, r.y);
    };
    const setStatus = (col) => ev(`(()=>{const s=document.querySelector('#f-status');s.value=${JSON.stringify(col)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);

    await open('/?card=7');
    check('a ?card= link opens the card full screen', await waitFor(cardOpen(7), 10000), await ev('location.search'));
    const box = await ev(`(()=>{const r=document.querySelector('#detail-modal .detail-modal').getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight}})()`);
    check('the card fills the viewport', box.l === 0 && box.t === 0 && box.w === box.iw && box.h === box.ih, box);
    check('its status tab is active behind it', JSON.stringify(await ev(tabs)) === JSON.stringify(['todo']), await ev(tabs));

    await tapSel('#detail-edit-btn');
    check('Edit opens the form', await waitFor(formOpen, 3000));
    const form = await ev(`(()=>{const r=document.querySelector('#card-form').getBoundingClientRect();return {l:r.left,t:r.top,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight}})()`);
    check('the edit form fills the viewport', form.l === 0 && form.t === 0 && form.w === form.iw && form.h === form.ih, form);
    const sizes = await ev(`[...document.querySelectorAll('#card-form input, #card-form select, #card-form textarea')].map((e)=>getComputedStyle(e).fontSize)`);
    check('every input, select and textarea computes to 16 px', sizes.length > 0 && sizes.every((s) => s === '16px'), JSON.stringify([...new Set(sizes)]));

    await setStatus('backlog');
    await tapSel('#modal-save');
    check('Save reopens the card', await waitFor(`${cardOpen(7)}&&document.querySelector('#modal').classList.contains('hidden')`, 5000), await ev('location.search'));
    check('with its new status as the active tab behind it', await waitFor(`JSON.stringify(${tabs})===JSON.stringify(['backlog'])`, 3000), await ev(tabs));
    await tapSel('#detail-back-btn');
    check('back closes the card', await waitFor(`document.querySelector('#detail-modal').classList.contains('hidden')`, 3000));
    check('and lands on that tab', JSON.stringify(await ev(tabs)) === JSON.stringify(['backlog']), await ev(tabs));

    await ev('history.back()');
    check('the card opens again', await waitFor(cardOpen(7), 3000));
    await tapSel('#detail-edit-btn');
    check('Edit opens the form again', await waitFor(formOpen, 3000));
    await setStatus('todo');
    await tapSel('#modal-save');
    check('the card goes back to todo and reopens', await waitFor(`${cardOpen(7)}&&JSON.stringify(${tabs})===JSON.stringify(['todo'])`, 5000), await ev(tabs));

    await open('/?card=4');
    check('a card waiting on another opens', await waitFor(cardOpen(4), 10000));
    await tapSel('#detail-edit-btn');
    check('its form opens', await waitFor(formOpen, 3000));
    await setStatus('doing');
    await tapSel('#modal-save');
    check('a refused move to doing shows the server\'s reason in the toast', await waitFor(`/Can't set doing — waiting on #3/.test(document.getElementById('toast').textContent)`, 5000), await ev(`document.getElementById('toast').textContent`));
    check('and the form stays open', await ev(formOpen));
    check("the refusal was the server's 422 on that card, which the scenario's console check does not count", await expectRefusedRequest(422, '/api/cards/4'));
  },
};
