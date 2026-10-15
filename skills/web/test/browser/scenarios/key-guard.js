'use strict';
// The single-key shortcuts and the key guard they share (key-guard.js), on the
// fixture board: `/` and Ctrl+F with nothing open, in a text field, under a
// dialog and under a card menu. The card menu is opened by the runner's
// right-click helper. The key events carry no text, so a `/` is read by the
// page and not typed.

module.exports = {
  name: 'key-guard',
  board: 'fixture',
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    const search = async (v) => ev(`(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);

    // The single-key shortcuts share one key guard (key-guard.js). `/` is off while a field has focus and while a card
    // menu, a dialog, the notifications panel or the preferences sheet is open; Ctrl+F reads only the surface check, so it
    // still works from a text field. Each check logs the key as the window saw it, after the page's own handlers ran, so
    // "does nothing" means the page read the key and declined it, not that the key never arrived.
    const pressKey = async (key, code, vk, modifiers = 0) => {
      const k = { key, code, windowsVirtualKeyCode: vk, modifiers };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    };
    const slash = () => pressKey('/', 'Slash', 191);
    const ctrlF = () => pressKey('f', 'KeyF', 70, 2);
    const lastKey = () => ev(`(()=>{const l=window.__keyLog||[];return l.length?l[l.length-1]:null})()`);
    const searchFocused = () => ev(`document.activeElement===document.getElementById('search-input')`);
    const closeWithEscape = async (hiddenExpr) => {
      await pressKey('Escape', 'Escape', 27);
      return waitFor(hiddenExpr, 2500);
    };

    await open('/');
    await waitFor(`document.querySelectorAll('.card-el').length>0`, 10000);
    await ev(`(()=>{window.__keyLog=[];window.addEventListener('keydown',(e)=>{window.__keyLog.push({key:e.key,ctrl:e.ctrlKey,prevented:e.defaultPrevented})});document.activeElement&&document.activeElement.blur&&document.activeElement.blur()})()`);

    await slash();
    check('with nothing open, / focuses the search box', await searchFocused() && (await lastKey()).prevented === true);
    await ev(`document.activeElement.blur()`);

    await ev(`(()=>{const i=document.createElement('input');i.id='kg-probe';document.body.appendChild(i);i.focus()})()`);
    await slash();
    const typed = await lastKey();
    check('in a text field outside any dialog, / is left to the field', typed.key === '/' && typed.prevented === false && await ev(`document.activeElement.id==='kg-probe'`), typed);
    await ctrlF();
    const chord = await lastKey();
    check('Ctrl+F in a text field outside any dialog still focuses the search box', await searchFocused() && await ev(`document.getElementById('search-input').value==='#'`) && chord.ctrl === true && chord.prevented === true, chord);
    await search('');
    await ev(`(()=>{const p=document.getElementById('kg-probe');if(p)p.remove();document.activeElement.blur()})()`);

    await open('/?card=5');
    await waitFor(`!document.getElementById('detail-modal').classList.contains('hidden')`, 10000);
    await ev(`(()=>{window.__keyLog=[];window.addEventListener('keydown',(e)=>{window.__keyLog.push({key:e.key,ctrl:e.ctrlKey,prevented:e.defaultPrevented})});document.getElementById('detail-close').focus()})()`);
    await slash();
    const underDialog = await lastKey();
    check('with a dialog open, / leaves focus in the dialog', underDialog.key === '/' && underDialog.prevented === false && !(await searchFocused()) && await ev(`document.getElementById('detail-modal').contains(document.activeElement)`), underDialog);
    await ctrlF();
    const chordUnderDialog = await lastKey();
    check('with a dialog open, Ctrl+F leaves the browser find bar alone', chordUnderDialog.ctrl === true && chordUnderDialog.prevented === false && !(await searchFocused()) && await ev(`document.getElementById('search-input').value===''`), chordUnderDialog);
    check('Escape closes the dialog', await closeWithEscape(`document.getElementById('detail-modal').classList.contains('hidden')`));

    await page.rightClick('#board .card-el');
    check('a right-click on a card opens its menu', await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`));
    await ev(`document.activeElement.blur()`);
    await slash();
    const underMenu = await lastKey();
    check('with a card menu open, / does nothing', underMenu.key === '/' && underMenu.prevented === false && !(await searchFocused()) && await ev(`!document.getElementById('context-menu').classList.contains('hidden')`), underMenu);
    await ctrlF();
    const chordUnderMenu = await lastKey();
    check('with a card menu open, Ctrl+F leaves the browser find bar alone', chordUnderMenu.ctrl === true && chordUnderMenu.prevented === false && !(await searchFocused()), chordUnderMenu);
    check('Escape closes the card menu', await closeWithEscape(`document.getElementById('context-menu').classList.contains('hidden')`));
  },
};
