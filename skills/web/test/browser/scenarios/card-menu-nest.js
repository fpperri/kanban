'use strict';
// The card menu with its entries in groups, on the notes board (the plan board with a logbook, so Add
// note... is in it). A right-click on a card opens the menu as Peek, Add note... (with the key n as a
// muted hint), Add child..., a separator, the Edit and Explore rows (Group is out: the board keeps no
// groups), Add to selection, a separator and Archive, Restore and Delete, with every group's panel shut.
// Hovering a row opens its panel beside it after a moment; a pointer that crosses another row on its way
// to the open panel keeps it; a click on a row opens a panel at once. Down and Up move the highlight,
// Right opens a panel and highlights its first entry, Left puts the highlight back on its row and shuts
// the panel, and Esc shuts the panel first and the menu second. A menu opened at the right edge of the
// window opens its panel on the left of the row. Each step waits on the page; the fixed pauses prove
// that something did NOT happen.

const MENU = `document.getElementById('context-menu')`;
const MENU_UP = `!${MENU}.classList.contains('hidden')`;
const PANEL = (parent) => `document.getElementById('${parent}').parentElement.querySelector('.ctx-sub-panel')`;
const OPEN = (parent) => `getComputedStyle(${PANEL(parent)}).display!=='none'&&document.getElementById('${parent}').getAttribute('aria-expanded')==='true'`;
const SHUT = (parent) => `getComputedStyle(${PANEL(parent)}).display==='none'&&document.getElementById('${parent}').getAttribute('aria-expanded')==='false'`;
const rect = (sel) => `(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,x:r.left+r.width/2,y:r.top+r.height/2}})()`;
const TOP_ROWS = `[...${MENU}.children].filter((c)=>c.getBoundingClientRect().height>0).map((c)=>c.classList.contains('ctx-sep')?'---':(c.classList.contains('ctx-sub')?c.firstElementChild:c).textContent.trim())`;
const ACTIVE = `document.activeElement&&document.activeElement.id`;

module.exports = {
  name: 'card-menu-nest',
  board: 'notes',
  timeoutMs: 80000,
  async run(page) {
    const { ev, open, waitFor, key, mouse, click, rightClick, check, sleep, shot } = page;
    const menuUp = () => waitFor(MENU_UP, 3000);
    const menuGone = () => waitFor(`!(${MENU_UP})`, 2500);
    const boardReady = () => waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000);
    const hoverAt = (x, y) => mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 });
    const hover = async (sel) => { const p = await ev(rect(sel)); await hoverAt(p.x, p.y); };
    const clickOn = async (sel) => { const p = await ev(rect(sel)); await click(p.x, p.y); };
    const menuOnCard = async (id, point) => {
      await rightClick(`#board .card-el[data-id="${id}"]`, point);
      return menuUp();
    };

    await open('/?view=board');
    check('the board is drawn', await boardReady());
    await hoverAt(5, 5);

    // --- the menu, with its panels shut ------------------------------------------------------------------------
    check('a right-click on a card opens the menu', await menuOnCard('7'));
    const rows = await ev(TOP_ROWS);
    check('it reads Peek, Add note..., Add child..., Edit, Explore, Add to selection and the three below, with a separator above Edit and another above Archive', JSON.stringify(rows) === JSON.stringify(['Peek', 'Add note…', 'Add child…', '---', 'Edit', 'Explore', 'Add to selection', '---', 'Archive selected', 'Restore selected', 'Delete selected']), JSON.stringify(rows));
    check('every group row says it opens a menu and starts shut, with a triangle drawn after it', await ev(`['ctx-edit','ctx-explore'].every((id)=>{const b=document.getElementById(id);return b.getAttribute('aria-haspopup')==='menu'&&b.getAttribute('aria-expanded')==='false'&&getComputedStyle(b,'::after').content.includes('▸')})`));
    check('and their panels are not drawn', await ev(`['ctx-edit','ctx-explore'].every((id)=>document.getElementById(id).parentElement.querySelector('.ctx-sub-panel').getBoundingClientRect().height===0)`));
    check('Add note... shows the key n, muted, at its right edge, and no other entry shows a key', await ev(`(()=>{const n=document.getElementById('ctx-note');const after=getComputedStyle(n,'::after');return /^"n"/.test(after.content)&&n.textContent==='Add note…'&&[...${MENU}.querySelectorAll('button')].filter((b)=>/^"n"/.test(getComputedStyle(b,'::after').content)).length===1})()`));
    check('Delete is the last entry of the menu, and not in a group', await ev(`${MENU}.lastElementChild.id==='ctx-delete'`));
    await shot('menu-groups');

    // --- hover opens a panel beside its row ---------------------------------------------------------------------
    await hover('#ctx-edit');
    check('hovering the Edit row opens its panel', await waitFor(OPEN('ctx-edit'), 2500));
    const edit = await ev(rect('#ctx-edit'));
    const panel = await ev(rect('#ctx-edit + .ctx-sub-panel'));
    check('the panel is beside the row, on the right, level with it', panel.l >= edit.r - 2 && Math.abs(panel.t - edit.t) <= 8, JSON.stringify({ edit, panel }));
    check('and holds Assign..., Set priority..., Edit tags... and Schedule...', await ev(`[...${PANEL('ctx-edit')}.querySelectorAll('button')].map((b)=>b.textContent.trim()).join('|')`) === 'Assign…|Set priority…|Edit tags…|Schedule…');
    await shot('edit-panel');

    // --- a diagonal move toward the open panel, across the Explore row, keeps it ---------------------------------
    const explore = await ev(rect('#ctx-explore'));
    const target = await ev(rect('#ctx-schedule'));
    const from = { x: edit.x, y: edit.y };
    const via = { x: explore.x + 10, y: explore.y };
    await hoverAt(from.x, from.y);
    await hoverAt(via.x, via.y);
    await hoverAt((via.x + target.x) / 2, (via.y + target.y) / 2);
    await hoverAt(target.x, target.y);
    await sleep(700);
    check('the Edit panel is still open after the pointer crossed the Explore row to reach it', await ev(OPEN('ctx-edit')) && await ev(SHUT('ctx-explore')));

    // --- resting on another row switches, and a plain entry closes ------------------------------------------------
    await hover('#ctx-explore');
    check('resting on the Explore row swaps the panel for its own', await waitFor(`${OPEN('ctx-explore')}&&${SHUT('ctx-edit')}`, 3000));
    await hover('#ctx-add');
    check('resting on a plain entry closes the open panel', await waitFor(SHUT('ctx-explore'), 3000));

    // --- a click opens a panel at once ------------------------------------------------------------------------------
    await clickOn('#ctx-explore');
    check('a click on the Explore row opens its panel and the menu stays up', await waitFor(OPEN('ctx-explore'), 2500) && await ev(MENU_UP));
    check('the panel holds the dependency tree and path, and no Isolate outside the selection', await ev(`[...${PANEL('ctx-explore')}.querySelectorAll('button')].filter((b)=>b.getBoundingClientRect().height>0).map((b)=>b.id).join()`) === 'ctx-tree,ctx-path');
    await hoverAt(5, 5);
    check('an entry in a panel is clicked as it always was: Dependency path adds the card\'s path to the selection and shuts the menu', await (async () => { await clickOn('#ctx-path'); return menuGone(); })() && await waitFor(`selectionState.selection.anchor&&selectionState.selection.anchor.kind==='path'`, 3000));

    // --- the keyboard ------------------------------------------------------------------------------------------------------
    await open('/?view=board'); // the path just added to the selection would turn the next menu into a selection's
    check('the board is drawn again with nothing selected', await boardReady() && await ev('selectedIds.size===0'));
    await hoverAt(5, 5);
    check('the menu opens again, with every panel shut', await menuOnCard('7') && await ev(SHUT('ctx-edit')) && await ev(SHUT('ctx-explore')));
    check('the menu has the focus', await ev(`document.activeElement===${MENU}`));
    await key('ArrowDown');
    check('Down highlights the first entry, Peek', await waitFor(`${ACTIVE}==='ctx-peek'`, 2000), await ev(ACTIVE));
    for (let i = 0; i < 3; i++) await key('ArrowDown');
    check('three more Downs reach the Edit row, past Add note... and Add child...', await waitFor(`${ACTIVE}==='ctx-edit'`, 2000), await ev(ACTIVE));
    await key('ArrowRight');
    check('Right opens the Edit panel and highlights its first entry', await waitFor(`${OPEN('ctx-edit')}&&${ACTIVE}==='ctx-assign'`, 2500), await ev(ACTIVE));
    await key('ArrowDown');
    check('Down inside the panel moves to the next entry', await waitFor(`${ACTIVE}==='ctx-priority'`, 2000), await ev(ACTIVE));
    await key('ArrowLeft');
    check('Left shuts the panel and puts the highlight back on its row', await waitFor(`${SHUT('ctx-edit')}&&${ACTIVE}==='ctx-edit'`, 2500), await ev(ACTIVE));
    await key('Enter');
    check('Enter on the row opens the panel too', await waitFor(`${OPEN('ctx-edit')}&&${ACTIVE}==='ctx-assign'`, 2500), await ev(ACTIVE));
    await key('Escape');
    check('the first Esc shuts the panel and leaves the menu up', await waitFor(`${SHUT('ctx-edit')}&&${ACTIVE}==='ctx-edit'`, 2500) && await ev(MENU_UP));
    await key('Escape');
    check('the second Esc closes the menu', await menuGone());

    // --- a menu at the right edge opens its panel on the left ----------------------------------------------------------------
    const width = await ev('innerWidth');
    check('a menu opened at the right edge of the window', await (async () => { await rightClick('#board .card-el[data-id="7"]', { x: width - 12, y: 260 }); return menuUp(); })());
    await clickOn('#ctx-edit');
    check('opens its panel on the left of the row', await waitFor(OPEN('ctx-edit'), 2500) && await ev(`${PANEL('ctx-edit')}.getBoundingClientRect().right<=document.getElementById('ctx-edit').getBoundingClientRect().left+2`));
    await shot('panel-flipped');
    await key('Escape');
    await key('Escape');
    check('Esc twice closes it', await menuGone());
  },
};
