'use strict';
// A speedbump on a 390 px phone. The question draws inside the viewport above the edit form, which fills
// the screen, and both its buttons are tall enough to tap and can be reached: a tap on Cancel keeps the
// form with what was typed, and a tap on the red button discards it. The question is the page's own
// (ask-ui.js), not a native confirm(), which is replaced here and counted.

const { tap } = require('../../steps');
const { ASK_REACHABLE, askUp, askGone, askText, refuseNativeConfirm, nativeConfirmsSeen } = require('../../ask');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    const formOpen = `!document.querySelector('#modal').classList.contains('hidden')`;
    const tapSel = async (sel) => {
      const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'center',inline:'center'});const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
      await tap(page, r.x, r.y);
    };
    const box = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {w:Math.round(b.width),h:Math.round(b.height)}})()`);

    await open('/');
    await waitFor(`document.querySelectorAll('#board .card-el').length>0`, 10000);
    await refuseNativeConfirm(page);
    await tapSel('#new-btn');
    check('New card opens the form full screen', await waitFor(formOpen, 3000));
    await ev(`(()=>{const t=document.getElementById('f-title');t.value='Typed on a phone';t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await tapSel('#modal-close');
    check('the close button asks before it drops what was typed', await askUp(page, 3000) && (await askText(page)) === 'Discard unsaved changes to this card?', await askText(page));
    const reach = await ev(ASK_REACHABLE);
    check('the question fits the screen and stands above the full-screen form', reach.fits && reach.onTop, reach);
    check('both buttons and the close button are inside the screen and the top thing at their middle', reach.buttons, reach);
    const yes = await box('#ask-yes');
    const no = await box('#ask-no');
    check('both buttons are at least 44 px tall and as wide as a thumb', yes.h >= 44 && no.h >= 44 && yes.w >= 80 && no.w >= 80, { yes, no });
    await tapSel('#ask-no');
    check('a tap on Cancel closes the question and keeps the form with what was typed', await askGone(page) && await ev(formOpen) && (await ev(`document.getElementById('f-title').value`)) === 'Typed on a phone');
    await tapSel('#modal-close');
    await askUp(page, 3000);
    await tapSel('#ask-yes');
    check('a tap on the red button discards it: the question and the form close', await askGone(page) && await waitFor(`document.querySelector('#modal').classList.contains('hidden')`, 3000));
    check('no native confirm() was raised', (await nativeConfirmsSeen(page)) === 0, await nativeConfirmsSeen(page));
  },
};
