'use strict';
// The icons a card's working material wears, on the todos board (notes, a todo list and a scratchpad page
// for card 7, the note written by this scenario, a page and a list for group I2, nothing for card 22) and the scratchpad board (a page, no
// todos: line). Card 7's tile wears the note icon, the todo icon with 3/4 and the scratchpad icon, in that
// order, and each opens its own tab; a card with none wears none and its tile is as tall as a card's with
// the icons off. The scratchpad board draws no todo icon. The card details wear the same icons in their
// header. Each step waits on the page, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): state, currentDetailId, notesUi, loadBoard, openCard, closeCard.

const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const ACTIVE_TAB = `(()=>{const b=document.querySelector('#notes-palette .np-tab.on');return b?b.textContent:null})()`;
const kit = (scope, id) => `[...document.querySelectorAll('${scope.replace('ID', id)}')].map((b)=>b.classList.contains('card-notes')?'notes':b.classList.contains('card-todos')?'todos':b.classList.contains('card-scratch')?'scratch':'?').join()`;
const head = (id) => `#board .card-el[data-id="${id}"] .card-head .np-trigger`;
const height = (id) => `document.querySelector('#board .card-el[data-id="${id}"] .card-head').getBoundingClientRect().height`;

const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'kit-icons',
  board: 'todos',
  alsoBoards: ['scratchpad'],
  timeoutMs: 90000,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, check } = page;
    const boardReady = () => waitFor(`document.querySelectorAll('#board .card-el').length>20&&!!state`, 10000);
    const closePalette = async () => {
      for (let i = 0; i < 3; i++) {
        await key('Escape');
        if (await waitFor(PAL_GONE, i < 2 ? 700 : 2500)) return true;
      }
      return false;
    };
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };

    await open('/?view=board', 'scratchpad');
    check('scratchpad board: the board is drawn', await boardReady());
    const noTodos = await ev(`document.querySelectorAll('#board .card-todos').length`);
    check('scratchpad board: no todo icon shows with no todos: line', noTodos === 0, noTodos);
    const padOnly = await ev(kit(head('ID'), '7'));
    check('scratchpad board: card 7 wears the scratchpad icon after its notes', /scratch$/.test(padOnly) && !/todos/.test(padOnly), padOnly);

    await open('/?view=board', 'todos');
    check('todos board: the board is drawn with its todo lists', await boardReady() && await waitFor(`!!state.todos`, 4000));
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    fs.writeFileSync(path.join(boardDir, 'logbook', '2026.10.15.0007.logbook.md'), '---\nentries:\n  - at: "16:30"\n    by: "@human"\n    note: seven needs a look\n---\n');
    await ev(`loadBoard()`);
    check('todos board: card 7 has a note now', await waitFor(`document.querySelectorAll('#board .card-el[data-id="7"] .card-head .card-notes').length===1`, 6000));
    const order = await ev(kit(head('ID'), '7'));
    check('todos board: card 7 wears notes, todos, scratchpad in that order', order === 'notes,todos,scratch', order);
    const none = await ev(kit(head('ID'), '22'));
    check('todos board: a card with none wears none', none === '', none);
    const counts = await ev(`(()=>{const b=document.querySelector('#board .card-el[data-id="7"] .card-head .card-todos');return b?b.textContent:null})()`);
    check('todos board: the todo icon keeps its number', counts === '3/4', counts);
    const h7 = await ev(height('7'));
    const h22 = await ev(height('22'));
    check('todos board: the icons add no height to the tile head', Math.abs(h7 - h22) < 1, `${h7} ${h22}`);

    for (const [cls, tab] of [['card-notes', 'Notes'], ['card-todos', 'Todos'], ['card-scratch', 'Scratchpad']]) {
      await clickOn(`#board .card-el[data-id="7"] .card-head .${cls}`);
      check(`todos board: the ${cls} icon opens the ${tab} tab`, await waitFor(PAL_UP, 4000) && await waitFor(`${ACTIVE_TAB}===${JSON.stringify(tab)}`, 4000), await ev(ACTIVE_TAB));
      check(`todos board: the palette closes after ${tab}`, await closePalette());
    }

    await ev(`openCard('7')`);
    check('todos board: the card details wear the same three icons in their header', await waitFor(`document.querySelectorAll('#detail-kit .np-trigger').length===3`, 4000) && await ev(kit('#detail-kit .np-trigger', '7')) === 'notes,todos,scratch', await ev(kit('#detail-kit .np-trigger', '7')));
    await ev(`closeCard()`);

    const badgeKit = `[...document.querySelectorAll('#board .card-el[data-id="3"] .card-groups .np-trigger:not(.group-badge)')].map((b)=>b.classList.contains('card-notes')?'notes':b.classList.contains('card-todos')?'todos':b.classList.contains('card-scratch')?'scratch':'?').join()`;
    check('todos board: the badge of the group of card 3 wears notes, todos, scratchpad in that order', await ev(badgeKit) === 'notes,todos,scratch', await ev(badgeKit));
    for (const [cls, tab] of [['card-notes', 'Group'], ['card-todos', 'Todos'], ['card-scratch', 'Scratchpad']]) {
      await clickOn(`#board .card-el[data-id="3"] .card-groups .${cls}`);
      check(`todos board: the badge's ${cls} icon opens the group's ${tab} tab`, await waitFor(PAL_UP, 4000) && await waitFor(`${ACTIVE_TAB}===${JSON.stringify(tab)}&&notesUi.sub.kind==='group'`, 4000), await ev(ACTIVE_TAB));
      check(`todos board: the palette closes after the badge's ${tab}`, await closePalette());
    }

    await ev(`openCard('22')`);
    check('details: card 22 opens with no icon in its header', await waitFor(`document.querySelectorAll('#detail-modal:not(.hidden)').length===1&&currentDetailId==='22'`, 4000) && await ev(`document.querySelectorAll('#detail-kit .np-trigger').length`) === 0);
    await ev(`fetch('/api/scratchpad/22',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({body:'a page'})}).then((r)=>r.status)`);
    await ev(`loadBoard()`);
    check('details: a page saved while they are open shows its icon without reopening', await waitFor(`document.querySelectorAll('#detail-kit .card-scratch').length===1`, 6000));
    await ev(`closeCard()`);
  },
};
