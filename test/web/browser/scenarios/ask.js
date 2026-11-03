'use strict';
// The speedbump's question (ask-ui.js) in a browser at desk width, on the fixture board, where the browser's
// confirm() is replaced with a no that counts its calls and none is raised. Clearing a notification and
// clearing all of them ask over the notifications popup: the question draws above it, Esc answers no and the
// popup stays, a yes moves the entry to archived/notifications.md. Closing the New card form with a title typed
// asks over the form: Tab stays on the question's own buttons and Ctrl+S saves nothing behind it, a second Esc
// while the question is up answers no and does not ask again, a click outside the dialog once the double-click
// window has passed answers no, and the red button discards the form. Dropping a card that is not done on the
// Archive column asks the count and a no leaves the card where it was. Each step waits on the page, never on
// a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): DOUBLE_CLICK_MS, askState, state.

const fs = require('fs');
const path = require('path');
const { ASK_REACHABLE, askUp, askGone, askText, askYes, askNo, refuseNativeConfirm, nativeConfirmsSeen } = require('../ask');

const NOTIFICATIONS = [
  '- id: 1', '  at: 2026-11-01T09:00:00', '  from: "scenario"', '  level: info',
  '  message: "The nightly run finished and left a long report that goes on past fifty characters of text"', '  read: false',
  '- id: 2', '  at: 2026-11-01T09:05:00', '  from: "scenario"', '  level: info', '  message: "Short one"', '  read: false', '',
].join('\n');

module.exports = {
  name: 'ask',
  board: 'fixture',
  timeoutMs: 100000,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, check } = page;
    const clickOn = async (sel) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const popupUp = `!document.getElementById('notif-modal').classList.contains('hidden')`;
    const formUp = `!document.getElementById('modal').classList.contains('hidden')`;
    const notices = () => ev(`state.notifications.length`);
    const dialogsUp = () => ev(`document.querySelectorAll('#ask:not(.hidden)').length`);

    await open('/');
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    fs.writeFileSync(path.join(boardDir, 'notifications.md'), NOTIFICATIONS);
    await open('/');
    await waitFor(`document.querySelectorAll('#board .card-el').length>5&&state.notifications.length===2`, 10000);
    await refuseNativeConfirm(page);

    // --- clearing notifications, over the notifications popup ---------------------------------------------------
    await clickOn('#notif-btn');
    check('the notifications popup lists the two entries', await waitFor(`${popupUp}&&document.querySelectorAll('#notif-list .notif-delete').length===2`, 4000));
    await clickOn('#notif-list .notif-delete');
    check('clearing one asks in the page, naming it', await askUp(page) && /^Clear notification ".+"\? It moves to archived\/notifications\.md\.$/.test(await askText(page)), await askText(page));
    const overPopup = await ev(ASK_REACHABLE);
    check('the question is drawn above the notifications popup, and both its buttons can be reached', overPopup.onTop && overPopup.buttons && overPopup.fits, overPopup);
    await key('Escape');
    check('Esc answers no: the question goes, the popup stays and the entry stays', await askGone(page) && await ev(popupUp) && (await notices()) === 2);
    await clickOn('#notif-list .notif-delete');
    await askUp(page);
    await askNo(page);
    check('Cancel keeps the entry', await askGone(page) && (await notices()) === 2 && !fs.existsSync(path.join(boardDir, 'archived', 'notifications.md')));
    await clickOn('#notif-list .notif-delete');
    await askUp(page);
    check('the red button says Clear', await ev(`document.getElementById('ask-yes').textContent`) === 'Clear');
    await askYes(page);
    check('a yes clears it, and the entry is in archived/notifications.md', await waitFor(`state.notifications.length===1`, 4000) && fs.existsSync(path.join(boardDir, 'archived', 'notifications.md')));
    await clickOn('#notif-clear-btn');
    check('Clear all asks with the count', await askUp(page) && (await askText(page)) === 'Clear all 1 notification(s)? They move to archived/notifications.md.', await askText(page));
    await askNo(page);
    check('Cancel keeps the last entry', await askGone(page) && (await notices()) === 1);
    await clickOn('#notif-clear-btn');
    await askUp(page);
    await askYes(page);
    check('a yes clears them all', await waitFor(`state.notifications.length===0`, 4000));
    await clickOn('#notif-close');
    check('the popup closes', await waitFor(`!${popupUp}`, 3000));

    // --- Discard unsaved changes, over the edit form -----------------------------------------------------------------
    await clickOn('#new-btn');
    check('the New card form opens', await waitFor(formUp, 3000));
    await ev(`(()=>{const t=document.getElementById('f-title');t.value='Typed at the desk';t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await key('Escape');
    check('Esc asks before it drops what was typed', await askUp(page) && (await askText(page)) === 'Discard unsaved changes to this card?', await askText(page));
    const overForm = await ev(ASK_REACHABLE);
    check('the question is drawn above the form, and both its buttons can be reached', overForm.onTop && overForm.buttons && overForm.fits, overForm);
    await ev(`(()=>{window.__submits=0;const f=document.getElementById('card-form');const o=f.requestSubmit.bind(f);f.requestSubmit=()=>{window.__submits++;return o()};return true})()`);
    const inAsk = `!!document.activeElement&&!!document.activeElement.closest('#ask')`;
    let kept = true;
    for (let i = 0; i < 4; i++) { await key('Tab'); kept = kept && await ev(inAsk); }
    await key('Tab', { shift: true });
    check('Tab and Shift+Tab keep the focus on the question\'s own buttons', kept && await ev(inAsk), await ev('document.activeElement.id||document.activeElement.tagName'));
    await key('s', { ctrl: true });
    check('Ctrl+S saves nothing behind the question', await ev('window.__submits') === 0 && await ev(formUp) && await askUp(page), await ev('window.__submits'));
    await key('Escape');
    check('a second Esc answers no: no second question is stacked, and the form stays with what was typed', await askGone(page) && (await dialogsUp()) === 0 && await ev(formUp) && (await ev(`document.getElementById('f-title').value`)) === 'Typed at the desk');
    await key('Escape');
    await askUp(page);
    await waitFor('askState.openedAt>0&&performance.now()-askState.openedAt>=DOUBLE_CLICK_MS', 3000); // a click on the backdrop in the double-click window after the ask opened is ignored
    await click(4, 4);
    check('a click outside the dialog answers no', await askGone(page) && await ev(formUp));
    await clickOn('#modal-close');
    check('the close button asks the same question', await askUp(page) && (await askText(page)) === 'Discard unsaved changes to this card?');
    check('the red button says Discard', await ev(`document.getElementById('ask-yes').textContent`) === 'Discard');
    await askYes(page);
    check('a yes discards the form', await askGone(page) && await waitFor(`!${formUp}`, 3000));

    // --- the drop that asks ------------------------------------------------------------------------------------------------
    const drop = (id, col) => ev(`(()=>{const card=document.querySelector('#board .card-el[data-id="${id}"]');const col=document.querySelector('#board .column[data-col="${col}"]');if(!card||!col)return false;const dt=new DataTransfer();const fire=(type,el)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientY:col.getBoundingClientRect().top+8}));fire('dragstart',card);fire('dragover',col);fire('drop',col);fire('dragend',card);return true})()`);
    check('card 7 is dropped on the Archive column', await drop('7', 'archive'));
    check('the drop asks the count in the page', await askUp(page) && (await askText(page)) === 'Archive 1 card(s)? (moves their files to archived/)', await askText(page));
    await askNo(page);
    check('a no leaves the card where it was', await askGone(page) && await ev(`state.active.some((c)=>c.id==='7')&&!state.archived.some((c)=>c.id==='7')`));
    await drop('7', 'archive');
    await askUp(page);
    await askYes(page);
    check('a yes archives it', await waitFor(`state.archived.some((c)=>c.id==='7')`, 5000));

    check('no native confirm() was raised', (await nativeConfirmsSeen(page)) === 0, await nativeConfirmsSeen(page));
  },
};
