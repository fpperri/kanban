'use strict';
// The todo lists, on the todos board (the scratchpad board with todos: naming the scratchpad's own
// folder, a list for card 7 beside its scratchpad page and one for group I2) and on the scratchpad board
// (no todos: line, so nothing of it shows). The tile of card 7 wears 3/4, the badge of card 3's group
// 1/1. The count opens the palette on a Todos tab after Notes and Scratchpad: the file, the items nested
// and struck when ticked, and the line that is not an item muted. The box adds an item (Enter), Down
// moves onto the rows, Space ticks, e edits in place, c adds a child under the row, Alt+Down moves it
// among its siblings, Tab and Shift+Tab indent and outdent it (focus stays on the row) and d twice deletes it; every change is on the file at once and the scratchpad page
// beside it is not touched. A hand edit shows when the board refreshes, and a change made over a list
// that moved on disk is refused and says so. t opens the tab for the hovered card, the card menu has a
// Todos... entry, a group opens its list on a fourth tab (Alt+4), the gear has a Todos page, and the
// delete popup offers the list unticked: ticked it goes and the scratchpad stays. Each step waits on
// the page or on the file, never on a fixed sleep.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js): state, hoveredId,
// autoRefreshTick, todosUi.

const fs = require('fs');
const path = require('path');

const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const TABS = `[...document.querySelectorAll('#notes-palette .np-tab')].map((b)=>b.textContent+(b.classList.contains('on')?'*':'')).join()`;
const ROWS = `[...document.querySelectorAll('#notes-palette .td-row')]`;
const TEXTS = `${ROWS}.map((r)=>r.querySelector('.td-text')?r.querySelector('.td-text').textContent:'(editing)')`;
const PLAIN = `[...document.querySelectorAll('#notes-palette .td-plain')].map((r)=>r.textContent)`;
const PATH = `(document.querySelector('#notes-palette .td-path')||{textContent:''}).textContent`;
const ADD = `document.querySelector('#notes-palette .td-add')`;
const READY = `(()=>{const a=${ADD};return !!a&&!a.disabled})()`;
const FOCUS_ROW = `(()=>{const a=document.activeElement;return a&&a.classList.contains('td-row')?a.querySelector('.td-text')?a.querySelector('.td-text').textContent:'(editing)':null})()`;
const DLG = `document.getElementById('group-dialog')`;
const BODY = `document.getElementById('group-dialog-body')`;
const boxes = `[...${BODY}.querySelectorAll('input[data-del]')].map((i)=>i.dataset.del+':'+i.checked).join()`;
const live = (id) => `state.active.some((c)=>c.id===${JSON.stringify(id)})`;
const tile = (id) => `(()=>{const b=document.querySelector('#board .card-el[data-id="${id}"] .card-head .card-todos');return b?b.textContent:null})()`;
const badge = (id) => `(()=>{const b=document.querySelector('#board .card-el[data-id="${id}"] .card-groups .card-todos');return b?b.textContent:null})()`;
const toastText = `(document.getElementById('toast')||{textContent:''}).textContent`;

module.exports = {
  name: 'todos',
  board: 'todos',
  alsoBoards: ['scratchpad'],
  timeoutMs: 110000,
  async run(page) {
    const { ev, open, waitFor, centre, click, mouse, key, rightClick, check, shot } = page;
    const press = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
    const boardReady = (ms) => waitFor(`document.querySelectorAll('#board .card-el').length>20&&!!state`, ms || 10000);
    const menuUp = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    const closePalette = async () => {
      for (let i = 0; i < 3; i++) {
        await key('Escape');
        if (await waitFor(PAL_GONE, i < 2 ? 700 : 2500)) return true;
      }
      return false;
    };
    const hoverCard = async (id) => {
      const p = await centre(`#board .card-el[data-id="${id}"] .card-title`);
      await mouse('mouseMoved', p.x, p.y, { button: 'none', clickCount: 0 });
      return waitFor(`hoveredId===${JSON.stringify(id)}`, 2000);
    };
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const typeIn = (sel, text) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});t.focus();t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const texts = () => ev(TEXTS);
    const textsAre = (list, ms) => waitFor(`JSON.stringify(${TEXTS})===${JSON.stringify(JSON.stringify(list))}`, ms || 4000);
    const focusIs = (text, ms) => waitFor(`${FOCUS_ROW}===${JSON.stringify(text)}`, ms || 2500);
    const openTodosOf = async (id) => {
      await rightClick(`#board .card-el[data-id="${id}"]`);
      if (!(await menuUp())) return false;
      await press('#ctx-todos');
      return waitFor(READY, 4000);
    };

    // --- the board with no todos: line: nothing of it shows ---------------------------------------------------
    await open('/?view=board', 'scratchpad');
    check('scratchpad board: the board is drawn with no todo lists', await boardReady() && await ev(`state.todos===null&&document.querySelectorAll('.card-todos').length===0`));
    check('scratchpad board: the pointer rests on card 7', await hoverCard('7'));
    await key('t');
    check('scratchpad board: t says todo lists are off and opens nothing', await waitFor(`/Todo lists are off/.test(${toastText})`, 2500) && await ev(PAL_GONE));
    await rightClick('#board .card-el[data-id="7"]');
    check('scratchpad board: the card menu has no Todos…', await menuUp() && await ev(`document.getElementById('ctx-todos').classList.contains('hidden')&&!document.getElementById('ctx-scratch').classList.contains('hidden')`));
    await key('Escape');

    // --- the todos board: the counts ------------------------------------------------------------------------------
    await open('/?view=board', 'todos');
    check('todos: the board is drawn with its todo lists', await boardReady() && await waitFor(`!!state.todos`, 4000));
    const stateJson = await ev(`JSON.stringify(state.todos)`);
    check('todos: the payload names the folder, the ids that have a list and their open and total', stateJson === '{"folder":".scratchpad","targets":["7","I2"],"counts":{"7":{"open":3,"total":4},"I2":{"open":1,"total":1}}}', stateJson);
    check('todos: card 7\'s tile wears 3/4 and the badge of its group wears 1/1', await ev(tile('7')) === '3/4' && await ev(badge('3')) === '1/1', `${await ev(tile('7'))} ${await ev(badge('3'))}`);
    check('todos: a card with no list wears no count', await ev(tile('22')) === null);
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const file = (name) => path.join(boardDir, '.scratchpad', name);
    const todoFile = () => fs.readFileSync(file('0007.todo.md'), 'utf8').replace(/\r\n/g, '\n');
    const onFile = async (text, ms) => {
      const end = Date.now() + (ms || 4000);
      while (Date.now() < end) {
        if (todoFile() === text) return true;
        await page.sleep(50);
      }
      return false;
    };
    const scratchBefore = fs.readFileSync(file('0007.scratchpad.md'), 'utf8');

    // --- the count opens the tab -----------------------------------------------------------------------------------
    await clickOn('#board .card-el[data-id="7"] .card-head .card-todos');
    check('todos: clicking the count opens the palette on the Todos tab, last of three', await waitFor(READY, 4000) && await ev(TABS) === 'Notes,Scratchpad,Todos*', await ev(TABS));
    check('todos: it shows the file beside the scratchpad\'s, in the folder both name', await ev(PATH) === '.scratchpad/0007.todo.md', await ev(PATH));
    check('todos: the items are listed with their children, and the line that is not an item is muted and read only', JSON.stringify(await texts()) === '["check the enum renames","run the migration dry run","update the changelog","note the breaking rename"]'
      && JSON.stringify(await ev(PLAIN)) === '["# Before the handoff"]'
      && await ev(`!document.querySelector('#notes-palette .td-plain').querySelector('button,input')&&document.querySelector('#notes-palette .td-plain').classList.contains('np-muted')`), JSON.stringify(await texts()));
    check('todos: the ticked item is struck and the child is indented', await ev(`${ROWS}[1].classList.contains('done')&&getComputedStyle(${ROWS}[1].querySelector('.td-text')).textDecorationLine==='line-through'&&${ROWS}[3].classList.contains('td-d1')&&${ROWS}[3].querySelector('.td-tick').getBoundingClientRect().left>${ROWS}[2].querySelector('.td-tick').getBoundingClientRect().left`));
    check('todos: the box has the focus', await ev(`document.activeElement===${ADD}`));
    await shot('todos-tab');

    // --- the box adds ----------------------------------------------------------------------------------------------------
    await typeIn('#notes-palette .td-add', 'write the release note');
    await key('Enter');
    check('todos: Enter adds the item at the end of the file, and only that', await onFile('# Before the handoff\n- [ ] check the enum renames\n- [x] run the migration dry run\n- [ ] update the changelog\n  - [ ] note the breaking rename\n- [ ] write the release note\n'), todoFile());
    check('todos: the list shows it, the box is empty with the focus, and the tile reads 4/5', await textsAre(['check the enum renames', 'run the migration dry run', 'update the changelog', 'note the breaking rename', 'write the release note'])
      && await ev(`${ADD}.value===''&&document.activeElement===${ADD}`) && await waitFor(`${tile('7')}==='4/5'`, 4000), await ev(tile('7')));

    // --- the tabs sit side by side, and the scratchpad is untouched ------------------------------------------
    await key('2', { alt: true });
    check('todos: Alt+2 is the Scratchpad tab, whose page reads as it did', await waitFor(`!!document.querySelector('#notes-palette .sp-text')&&document.querySelector('#notes-palette .sp-text').value.startsWith('check the enum renames')`, 4000)
      && await ev(TABS) === 'Notes,Scratchpad*,Todos', await ev(TABS));
    await key('3', { alt: true });
    check('todos: Alt+3 is back on the Todos tab, with the list', await waitFor(READY, 4000) && await ev(TABS) === 'Notes,Scratchpad,Todos*');
    check('todos: the scratchpad page on disk was not touched by any of it', fs.readFileSync(file('0007.scratchpad.md'), 'utf8') === scratchBefore);

    // --- the rows: Down, Space, e ----------------------------------------------------------------------------------------
    await key('ArrowDown');
    check('todos: Down from the box moves onto the first row', await focusIs('check the enum renames'));
    await key(' ');
    check('todos: Space ticks it on the file, the row is struck and the focus stays on it', await onFile('# Before the handoff\n- [x] check the enum renames\n- [x] run the migration dry run\n- [ ] update the changelog\n  - [ ] note the breaking rename\n- [ ] write the release note\n')
      && await waitFor(`${ROWS}[0].classList.contains('done')`, 3000) && await focusIs('check the enum renames'), todoFile());
    check('todos: the tile counts it, 3/5', await waitFor(`${tile('7')}==='3/5'`, 4000), await ev(tile('7')));
    await key(' ');
    check('todos: Space again unticks it', await onFile('# Before the handoff\n- [ ] check the enum renames\n- [x] run the migration dry run\n- [ ] update the changelog\n  - [ ] note the breaking rename\n- [ ] write the release note\n'));
    await key('ArrowDown');
    await key('ArrowDown');
    check('todos: Down steps through the rows', await focusIs('update the changelog'));
    await key('e');
    check('todos: e opens the text in a box in place, with the text and the focus', await waitFor(`!!document.querySelector('#notes-palette .td-edit')&&document.activeElement===document.querySelector('#notes-palette .td-edit')&&document.activeElement.value==='update the changelog'`, 2500));
    await typeIn('#notes-palette .td-edit', 'update the changelog and README');
    await key('Escape');
    check('todos: Esc puts the text back, writes nothing and leaves the palette up', await waitFor(`!document.querySelector('#notes-palette .td-edit')`, 2500) && await ev(PAL_UP) && todoFile().includes('- [ ] update the changelog\n'), todoFile());
    await key('e');
    await typeIn('#notes-palette .td-edit', 'update the changelog and README');
    await key('Enter');
    check('todos: e then Enter writes the new text and nothing else', await onFile('# Before the handoff\n- [ ] check the enum renames\n- [x] run the migration dry run\n- [ ] update the changelog and README\n  - [ ] note the breaking rename\n- [ ] write the release note\n'), todoFile());

    // --- c adds a child, Esc takes the chip off --------------------------------------------------------------------------
    await waitFor(`${FOCUS_ROW}==='update the changelog and README'`, 3000);
    await key('c');
    check('todos: c aims the box under the row: a chip says so and the box has the focus', await waitFor(`!!document.querySelector('#notes-palette .td-under')&&document.activeElement===${ADD}`, 2500) && await ev(`/under: update the changelog and README/.test(document.querySelector('#notes-palette .td-under').textContent)`));
    await typeIn('#notes-palette .td-add', 'link the migration');
    await key('Enter');
    check('todos: Enter adds a child after the existing one, indented', await onFile('# Before the handoff\n- [ ] check the enum renames\n- [x] run the migration dry run\n- [ ] update the changelog and README\n  - [ ] note the breaking rename\n  - [ ] link the migration\n- [ ] write the release note\n'), todoFile());
    await key('Escape');
    check('todos: Esc takes the chip off and leaves the palette up', await waitFor(`!document.querySelector('#notes-palette .td-under')`, 2500) && await ev(PAL_UP));

    // --- Alt+Down moves, d d deletes --------------------------------------------------------------------------------------
    await key('ArrowDown');
    check('todos: Down from the box lands on the first row', await focusIs('check the enum renames'));
    await key('ArrowDown', { alt: true });
    check('todos: Alt+Down moves it below its next sibling on the file, and the focus goes with it', await onFile('# Before the handoff\n- [x] run the migration dry run\n- [ ] check the enum renames\n- [ ] update the changelog and README\n  - [ ] note the breaking rename\n  - [ ] link the migration\n- [ ] write the release note\n')
      && await focusIs('check the enum renames'), todoFile());
    await key('ArrowUp');
    check('todos: Up goes to the row above', await focusIs('run the migration dry run'));
    await key('d');
    check('todos: the first d asks: the button says Sure? and nothing is deleted', await waitFor(`document.activeElement.querySelector('[data-act="delete"]').textContent==='Sure?'`, 2500) && todoFile().includes('run the migration dry run'));
    await key('d');
    check('todos: the second d deletes it from the file', await onFile('# Before the handoff\n- [ ] check the enum renames\n- [ ] update the changelog and README\n  - [ ] note the breaking rename\n  - [ ] link the migration\n- [ ] write the release note\n'), todoFile());
    check('todos: the list follows, and the focus lands on the row in its place', await textsAre(['check the enum renames', 'update the changelog and README', 'note the breaking rename', 'link the migration', 'write the release note']) && await focusIs('check the enum renames'));

    // --- Tab indents, Shift+Tab outdents, and focus stays on the row ------------------------------------------------------
    await key('ArrowDown');
    await key('ArrowDown');
    await key('ArrowDown');
    await key('ArrowDown');
    check('todos: Down reaches the last row', await focusIs('write the release note'));
    await key('Tab');
    check('todos: Tab indents it under the item above, after that item\'s children, and only that line moves', await onFile('# Before the handoff\n- [ ] check the enum renames\n- [ ] update the changelog and README\n  - [ ] note the breaking rename\n  - [ ] link the migration\n  - [ ] write the release note\n'), todoFile());
    check('todos: Tab did not move the focus: it is on the same row, one level in', await focusIs('write the release note') && await waitFor(`document.activeElement.classList.contains('td-d1')`, 2500));
    await key('Tab', { shift: true });
    check('todos: Shift+Tab outdents it again, to just after its parent', await onFile('# Before the handoff\n- [ ] check the enum renames\n- [ ] update the changelog and README\n  - [ ] note the breaking rename\n  - [ ] link the migration\n- [ ] write the release note\n'), todoFile());
    check('todos: the focus is still on the row, back at the top level', await focusIs('write the release note') && await waitFor(`document.activeElement.classList.contains('td-d0')`, 2500));
    await key('Tab', { shift: true });
    check('todos: Shift+Tab at the top level changes nothing and still keeps the focus', await focusIs('write the release note') && todoFile().endsWith('- [ ] link the migration\n- [ ] write the release note\n'));
    await key('ArrowUp');
    await key('ArrowUp');
    await key('ArrowUp');
    await key('ArrowUp');
    check('todos: Up goes back to the first row', await focusIs('check the enum renames'));
    await key('Tab');
    const pendingDone = await waitFor(`todosUi.pending===0`, 4000);
    check('todos: Tab on the first item, which has nothing above it, changes nothing', pendingDone && todoFile().includes('\n- [ ] check the enum renames\n') && await focusIs('check the enum renames'), JSON.stringify([pendingDone, await ev(FOCUS_ROW), todoFile()]));

    // --- a hand edit shows, and a change over a moved list is refused ---------------------------------------------------
    fs.writeFileSync(file('0007.todo.md'), `${todoFile()}- [ ] added by an agent\n`);
    await ev(`autoRefreshTick().then(()=>true)`);
    check('todos: a hand edit shows when the board refreshes', await textsAre(['check the enum renames', 'update the changelog and README', 'note the breaking rename', 'link the migration', 'write the release note', 'added by an agent']), JSON.stringify(await texts()));
    await ev(`document.querySelectorAll('#notes-palette .td-row')[0].focus()`);
    fs.writeFileSync(file('0007.todo.md'), `${todoFile()}- [ ] and another by hand\n`);
    const withHand = todoFile();
    await key(' ');
    check('todos: Space over a list that moved on disk is refused with the reason', await waitFor(`/changed on disk/.test(${toastText})`, 4000), await ev(toastText));
    check('todos: the server answered 409', await page.expectRefusedRequest(409, '/api/todos/7'));
    check('todos: nothing was overwritten, and the list is read again', todoFile() === withHand && await waitFor(`${TEXTS}.includes('and another by hand')`, 4000));
    await key(' ');
    check('todos: the next Space, on the version just read, goes through', await waitFor(`${ROWS}[0].classList.contains('done')`, 4000) && todoFile().includes('- [x] check the enum renames\n'), todoFile());
    check('todos: Esc closes the palette', await closePalette());

    // --- t and the card menu -------------------------------------------------------------------------------------------------
    check('todos: the pointer rests on card 3', await hoverCard('3'));
    await key('t');
    check('todos: t opens the Todos tab of the hovered card, whose list is not written yet', await waitFor(READY, 4000) && await ev(TABS) === 'Notes,Scratchpad,Todos*' && await ev(PATH) === '.scratchpad/0003.todo.md (not written yet)', await ev(PATH));
    check('todos: it says there is nothing yet', await ev(`/No todos yet/.test(document.querySelector('#notes-palette .np-empty').textContent)`));
    check('todos: the palette\'s foot names the keys', await ev(`/add/.test(document.querySelector('#notes-palette .np-foot').textContent)&&/tick/.test(document.querySelector('#notes-palette .np-foot').textContent)&&/move/.test(document.querySelector('#notes-palette .np-foot').textContent)`));
    await closePalette();
    check('todos: the card menu\'s Todos… opens card 22\'s tab', await openTodosOf('22') && await ev(PATH) === '.scratchpad/0022.todo.md (not written yet)', await ev(PATH));
    await closePalette();
    await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);

    // --- a group has the fourth tab ------------------------------------------------------------------------------------------
    const gb = await centre('#board .card-el[data-id="3"] .group-badge');
    await click(gb.x, gb.y);
    check('todos: a group badge opens the group on its Group tab, Todos after Scratchpad', await waitFor(`!!document.querySelector('#notes-palette .gp-scratch')`, 3000) && await ev(TABS) === 'Notes,Group*,Scratchpad,Todos', await ev(TABS));
    await key('4', { alt: true });
    check('todos: Alt+4 is the Todos tab, with the group\'s own list', await waitFor(READY, 4000) && await ev(TABS) === 'Notes,Group,Scratchpad,Todos*' && await ev(PATH) === '.scratchpad/I0002.todo.md' && JSON.stringify(await texts()) === '["confirm the freeze window"]', await ev(PATH));
    await closePalette();
    const gcount = await centre('#board .card-el[data-id="3"] .card-groups .card-todos');
    await click(gcount.x, gcount.y);
    check('todos: clicking the count by a group badge opens the group on its Todos tab', await waitFor(READY, 4000) && await ev(TABS) === 'Notes,Group,Scratchpad,Todos*', await ev(TABS));
    await closePalette();

    // --- the gear's Todos page -------------------------------------------------------------------------------------------------
    await clickOn('#prefs-btn');
    check('todos: the gear opens', await waitFor(`!document.getElementById('prefs-sheet').classList.contains('hidden')`, 2500) && await waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 2500));
    await clickOn('.prefs-menu-item[data-page="board:todos"]');
    check('todos: the Todos page shows the switch on and the folder, which may be the scratchpad\'s', await waitFor(`(document.getElementById('prefs-page-title')||{}).textContent==='Todos'`, 2500)
      && await ev(`document.querySelector('.prefs-opt[data-switch="todos"][data-value="on"]').getAttribute('aria-pressed')==='true'`) && await ev(`document.getElementById('pf-todos').value==='.scratchpad'`));
    await key('Escape');
    await waitFor(`document.getElementById('prefs-sheet').classList.contains('hidden')`, 2500);

    // --- delete: the box is unticked, ticked it takes the list and not the scratchpad -------------------------------------------
    await rightClick('#board .card-el[data-id="7"]');
    await menuUp();
    await press('#ctx-delete');
    check('todos: Delete on card 7 offers its scratchpad and its todo list, unticked', await waitFor(`!${DLG}.classList.contains('hidden')`, 3000) && await ev(boxes) === 'scratchpad:false,todos:false' && await ev(`/Its todo list/.test(${BODY}.textContent)`), await ev(boxes));
    await shot('todos-delete');
    await ev(`${BODY}.querySelector('input[data-del="todos"]').click()`);
    await press('#group-dialog [data-confirm="delete"]');
    check('todos: ticked, the card and its todo list go and the scratchpad page stays', await waitFor(`!${live('7')}&&${tile('7')}===null`, 4000) && !fs.existsSync(file('0007.todo.md')) && fs.existsSync(file('0007.scratchpad.md')));
    check('todos: the toast says so', await waitFor(`/deleted 1 todo list/.test(${toastText})`, 2500), await ev(toastText));
    check('todos: the board no longer lists it', await waitFor(`JSON.stringify(state.todos.targets)==='["I2"]'`, 4000), await ev(`JSON.stringify(state.todos.targets)`));
  },
};
