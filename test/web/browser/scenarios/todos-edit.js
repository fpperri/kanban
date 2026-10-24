'use strict';
// The Todos tab's List | Edit | Preview switch, on the todos board (card 7's list beside its scratchpad
// page, its tile wearing 3/4). The count opens the tab on List, the switch over the list. Edit shows the
// list's whole file in the Scratchpad's box, where the list's keys only type; Ctrl+Enter writes the text,
// the file holding exactly it, and the tile's count and the List follow. Preview draws the text as
// Markdown, and Ctrl+Shift+V turns it on and off, back to the mode it came from; full screen, the box and
// the Preview take the height. A save over a list changed on disk is refused with the reason and the text
// stays in the box; the status line says Save again replaces the list and List shows it as it is now, and
// a second save writes it. Text not saved survives a tab switch and a closed palette,
// the tab opening on Edit; a text over the size cap is refused; a card with no list starts Edit empty and
// Save makes the file. Each step waits on the page or on the file, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): state, todosUi.

const fs = require('fs');
const path = require('path');

const PAL = `document.getElementById('notes-palette')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const TABS = `[...document.querySelectorAll('#notes-palette .np-tab')].map((b)=>b.textContent+(b.classList.contains('on')?'*':'')).join()`;
const MODES = `[...document.querySelectorAll('#notes-palette .sp-mode')].map((b)=>b.textContent+(b.getAttribute('aria-pressed')==='true'?'*':'')).join()`;
const MODE = (name) => `#notes-palette .sp-mode[data-mode="${name}"]`;
const BOX = `document.querySelector('#notes-palette .sp-text')`;
const PREVIEW = `document.querySelector('#notes-palette .sp-preview')`;
const ADD = `document.querySelector('#notes-palette .td-add')`;
const READY = `(()=>{const a=${ADD};return !!a&&!a.disabled})()`;
const SEEN = (expr) => `(()=>{const e=${expr};return !!e&&e.getClientRects().length>0})()`; // drawn: neither it nor an ancestor is display: none
const TEXTS = `[...document.querySelectorAll('#notes-palette .td-row')].map((r)=>r.querySelector('.td-text').textContent)`;
const PATH = `(document.querySelector('#notes-palette .td-path')||{textContent:''}).textContent`;
const FOOT = `document.querySelector('#notes-palette .np-foot').textContent`;
const tile = (id) => `(()=>{const b=document.querySelector('#board .card-el[data-id="${id}"] .card-head .card-todos');return b?b.textContent:null})()`;
const toastText = `(document.getElementById('toast')||{textContent:''}).textContent`;
const inPalette = `${PAL}.contains(document.activeElement)&&document.activeElement!==document.body`;

const SAVED = '# Before the handoff\n- [x] check the enum renames\n- [ ] update the changelog\n  - [ ] note the breaking rename\n\nnotes between the items\n- [ ] pasted one\n- [ ] pasted two\n';

module.exports = {
  name: 'todos-edit',
  board: 'todos',
  timeoutMs: 90000,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, rightClick, check, shot } = page;
    const press = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const typeInto = (text) => ev(`(()=>{const t=${BOX};t.focus();t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const modesAre = (want, ms) => waitFor(`${MODES}===${JSON.stringify(want)}`, ms || 2500);
    const closePalette = async () => {
      for (let i = 0; i < 3; i++) {
        await key('Escape');
        if (await waitFor(PAL_GONE, i < 2 ? 700 : 2500)) return true;
      }
      return false;
    };
    const openCount = async (id) => {
      await clickOn(`#board .card-el[data-id="${id}"] .card-head .card-todos`);
      return waitFor(READY, 4000);
    };

    await open('/?view=board', 'todos');
    check('todos-edit: the board is drawn with its todo lists', await waitFor(`document.querySelectorAll('#board .card-el').length>20&&!!state.todos`, 10000));
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const file = (name) => path.join(boardDir, '.scratchpad', name);
    const onDisk = (name) => (fs.existsSync(file(name)) ? fs.readFileSync(file(name), 'utf8') : null);
    const onFile = async (name, text, ms) => {
      const end = Date.now() + page.scaled(ms || 8000);
      while (Date.now() < end) {
        if (onDisk(name) === text) return true;
        await page.sleep(50);
      }
      return false;
    };
    const first = onDisk('0007.todo.md');

    // --- the switch: List, as it was ----------------------------------------------------------------------------
    check('todos-edit: the count opens the Todos tab', await openCount('7') && await ev(TABS) === 'Notes,Scratchpad,Todos*', await ev(TABS));
    check('todos-edit: a List | Edit | Preview switch sits over the list, List on', await ev(MODES) === 'List*,Edit,Preview' && await ev(SEEN(ADD)) && !(await ev(SEEN(BOX))) && !(await ev(SEEN(PREVIEW))), await ev(MODES));
    check('todos-edit: Preview shows its key beside its name, and names it for assistive technology', await ev(`(()=>{const b=document.querySelector(${JSON.stringify(MODE('preview'))});return b.dataset.key==='Ctrl+Shift+V'&&getComputedStyle(b,'::after').content==='"Ctrl+Shift+V" / ""'&&b.getAttribute('aria-keyshortcuts')==='Control+Shift+V Meta+Shift+V'})()`));

    // --- Edit: the whole file, where the list's keys only type ------------------------------------------------------
    await clickOn(MODE('edit'));
    check('todos-edit: Edit shows the whole file in the box, with the focus, and the list is hidden', await modesAre('List,Edit*,Preview') && await waitFor(SEEN(BOX), 2500)
      && await ev(`${BOX}.value===${JSON.stringify(first)}&&document.activeElement===${BOX}`) && !(await ev(SEEN(ADD))), await ev(`${BOX}.value`));
    check('todos-edit: the foot names the keys of Edit', await ev(`/save/.test(${FOOT})&&/preview/.test(${FOOT})&&!/tick/.test(${FOOT})`), await ev(FOOT));
    await ev(`(()=>{const t=${BOX};t.setSelectionRange(t.value.length,t.value.length);return true})()`);
    for (const k of [' ', 'd', 'd', 'e', 'c', 't']) await key(k);
    check('todos-edit: the list\'s keys and t type into the box and do nothing else', await waitFor(`${BOX}.value.endsWith(' ddect')`, 2500)
      && await ev(`todosUi.pending===0&&${TABS}==='Notes,Scratchpad,Todos*'`) && onDisk('0007.todo.md') === first, await ev(`${BOX}.value.slice(-12)`));
    await shot('todos-edit');

    await typeInto(SAVED);
    await key('Enter', { ctrl: true });
    check('todos-edit: Ctrl+Enter writes the file with exactly the text in the box', await onFile('0007.todo.md', SAVED), onDisk('0007.todo.md'));
    check('todos-edit: the box says Saved and the tile counts the new list, 4/5', await waitFor(`document.querySelector('#notes-palette .sp-status').textContent==='Saved'`, 4000)
      && await waitFor(`${tile('7')}==='4/5'`, 4000), await ev(tile('7')));

    // --- Preview and Ctrl+Shift+V ---------------------------------------------------------------------------------------
    await key('v', { ctrl: true, shift: true });
    check('todos-edit: Ctrl+Shift+V in the box shows Preview, the file drawn as Markdown, and the palette keeps the focus', await modesAre('List,Edit,Preview*')
      && await waitFor(`!!${PREVIEW}.querySelector('h1')&&${PREVIEW}.querySelectorAll('li').length===5`, 2500) && !(await ev(SEEN(BOX))) && await ev(inPalette),
    await ev(`${PREVIEW}.innerHTML.slice(0,200)`));
    await shot('todos-preview');
    await key('v', { ctrl: true, shift: true });
    check('todos-edit: Ctrl+Shift+V again goes back to Edit, the focus in the box at the end of its text', await modesAre('List,Edit*,Preview')
      && await waitFor(`document.activeElement===${BOX}&&${BOX}.selectionStart===${BOX}.value.length`, 2500));
    await clickOn(MODE('list'));
    check('todos-edit: List shows the list as saved, the box that adds with the focus', await modesAre('List*,Edit,Preview')
      && await ev(`JSON.stringify(${TEXTS})`) === JSON.stringify(['check the enum renames', 'update the changelog', 'note the breaking rename', 'pasted one', 'pasted two'])
      && await ev(`document.activeElement===${ADD}`), await ev(`JSON.stringify(${TEXTS})`));
    await key('v', { ctrl: true, shift: true });
    check('todos-edit: from List, Ctrl+Shift+V shows Preview, and the foot says it goes back to the list', await modesAre('List,Edit,Preview*') && await ev(`/list/.test(${FOOT})`), await ev(FOOT));
    await key('v', { ctrl: true, shift: true });
    check('todos-edit: and again it is back on List', await modesAre('List*,Edit,Preview') && await waitFor(`document.activeElement===${ADD}`, 2500));

    // --- full screen gives the box and the Preview the height ------------------------------------------------------------
    const FS_ON = `${PAL}.classList.contains('fullscreen')`;
    const FILLS = (expr) => `(()=>{const b=document.querySelector('#notes-palette .np-body').getBoundingClientRect();const e=${expr}.getBoundingClientRect();const bar=document.querySelector('#notes-palette .td > .sp-bar').getBoundingClientRect();return e.height>300&&b.bottom-bar.bottom<=24&&b.bottom-bar.bottom>=0&&bar.top>=e.bottom})()`;
    await clickOn(MODE('edit'));
    await press('#notes-fullscreen-btn');
    check('todos-edit: full screen, the box takes the height with the Save row at the foot', await waitFor(FS_ON, 2500) && await waitFor(FILLS(BOX), 2500));
    await clickOn(MODE('preview'));
    check('todos-edit: and so does the Preview', await waitFor(FILLS(PREVIEW), 2500));
    await press('#notes-fullscreen-btn');
    check('todos-edit: the button leaves full screen', await waitFor(`!(${FS_ON})`, 2500));

    // --- a save over a list changed on disk ----------------------------------------------------------------------------
    await clickOn(MODE('edit'));
    await typeInto(`${SAVED}- [ ] typed in Edit\n`);
    const byHand = `${SAVED}- [ ] added by an agent\n`;
    fs.writeFileSync(file('0007.todo.md'), byHand);
    await press('#notes-palette .td > .sp-bar .sp-save');
    check('todos-edit: a save over a list changed on disk is refused with the reason', await waitFor(`/changed on disk/.test(${toastText})`, 4000), await ev(toastText));
    check('todos-edit: the server answered 409', await page.expectRefusedRequest(409, '/api/todos/7'));
    check('todos-edit: nothing was written and the text stays in the box', onDisk('0007.todo.md') === byHand && await ev(`${BOX}.value.endsWith('typed in Edit\\n')`));
    const CLASH = 'The list changed on disk. Save again to replace it with this text; List shows it as it is now.';
    check('todos-edit: the status line says Save again replaces the list, and that List shows it as it is now', await waitFor(`document.querySelector('#notes-palette .sp-status').textContent===${JSON.stringify(CLASH)}`, 2500),
      await ev(`document.querySelector('#notes-palette .sp-status').textContent`));
    await press('#notes-palette .td > .sp-bar .sp-save');
    check('todos-edit: a second save writes it over the list it was told of', await onFile('0007.todo.md', `${SAVED}- [ ] typed in Edit\n`), onDisk('0007.todo.md'));

    // --- unsaved text survives a tab switch and a closed palette -----------------------------------------------------------
    await typeInto('not saved yet');
    await key('2', { alt: true });
    check('todos-edit: Alt+2 goes to the Scratchpad tab', await waitFor(`${TABS}==='Notes,Scratchpad*,Todos'`, 2500), await ev(TABS));
    await key('3', { alt: true });
    check('todos-edit: back on Todos, the tab opens on Edit with the text not saved', await waitFor(`${TABS}==='Notes,Scratchpad,Todos*'`, 2500)
      && await modesAre('List,Edit*,Preview', 4000) && await waitFor(`${BOX}.value==='not saved yet'&&!${BOX}.disabled`, 4000));
    check('todos-edit: Esc closes the palette', await closePalette());
    check('todos-edit: reopened, the text not saved is still there', await openCount('7') && await modesAre('List,Edit*,Preview') && await ev(`${BOX}.value==='not saved yet'`));
    check('todos-edit: and the file still holds the saved list', onDisk('0007.todo.md') === `${SAVED}- [ ] typed in Edit\n`);

    // --- a text over the size cap -------------------------------------------------------------------------------------------
    await typeInto('x'.repeat(300001));
    await press('#notes-palette .td > .sp-bar .sp-save');
    check('todos-edit: a text over the size cap is refused with the reason', await waitFor(`/too long/.test(${toastText})`, 4000), await ev(toastText));
    check('todos-edit: the server answered 413', await page.expectRefusedRequest(413, '/api/todos/7'));
    check('todos-edit: nothing was written', onDisk('0007.todo.md') === `${SAVED}- [ ] typed in Edit\n` && await ev(`${BOX}.value.length===300001`));
    await closePalette();

    // --- a card with no list: Edit starts empty and Save makes the file --------------------------------------------------
    await rightClick('#board .card-el[data-id="22"]');
    await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    await press('#ctx-todos');
    check('todos-edit: card 22 has no list yet', await waitFor(READY, 4000) && await ev(PATH) === '.scratchpad/0022.todo.md (not written yet)', await ev(PATH));
    await clickOn(MODE('edit'));
    check('todos-edit: its Edit starts empty', await modesAre('List,Edit*,Preview') && await ev(`${BOX}.value===''`));
    await typeInto('- [ ] first for twenty-two\n');
    await press('#notes-palette .td > .sp-bar .sp-save');
    check('todos-edit: Save makes the file in the folder, with the text', await onFile('0022.todo.md', '- [ ] first for twenty-two\n'), onDisk('0022.todo.md'));
    check('todos-edit: the path no longer says not written yet, and the tile wears 1/1', await waitFor(`${PATH}==='.scratchpad/0022.todo.md'`, 4000) && await waitFor(`${tile('22')}==='1/1'`, 4000), await ev(tile('22')));
    await closePalette();
  },
};
