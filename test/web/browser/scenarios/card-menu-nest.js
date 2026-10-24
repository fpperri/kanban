'use strict';
// The card menu with its entries in groups, on the notes board (the plan board with a logbook, so Add
// note... is in it). A right-click on a card opens the menu as Peek, Add note... (with the key n as a
// muted hint), Add child..., a separator, the Edit and Explore rows (Group is out: the board keeps no
// groups), Add to selection, a separator and Archive, Restore and Delete, with every group's panel shut.
// Hovering a row opens its panel beside it after a moment; a pointer that crosses another row on its way
// to the open panel keeps it; a click on a row opens a panel at once. Down and Up move the highlight,
// Right opens a panel and highlights its first entry, Left puts the highlight back on its row and shuts
// the panel, and Esc shuts the panel first and the menu second. A menu opened at the right edge of the
// window opens its panel on the left of the row. Explore holds a third level: Path and Tree are rows
// that open Hierarchy and Dependency, by hover, click and the keys (Right and Enter open, Left and Esc
// close that panel alone), and at phone width a tap opens it in place and a second tap shuts it.
// Each step waits on the page; the fixed pauses prove that something did NOT happen.

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
    const { ev, open, waitFor, key, mouse, click, rightClick, check, sleep, shot, send } = page;
    const menuUp = () => waitFor(MENU_UP, 3000);
    const menuGone = () => waitFor(`!(${MENU_UP})`, 2500);
    const boardReady = () => waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000);
    const hoverAt = (x, y) => mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 });
    const hover = async (sel) => { const p = await ev(rect(sel)); await hoverAt(p.x, p.y); };
    const clickOn = async (sel, extra = {}) => { const p = await ev(rect(sel)); await click(p.x, p.y, extra); };
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
    check('the panel holds Path and Tree, and no Isolate outside the selection', await ev(`[...${PANEL('ctx-explore')}.querySelectorAll('button')].filter((b)=>b.getBoundingClientRect().height>0).map((b)=>b.id).join()`) === 'ctx-path,ctx-tree');
    check('Path and Tree are rows that open a menu, shut to start, with the triangle after them', await ev(`['ctx-path','ctx-tree'].every((id)=>{const b=document.getElementById(id);return b.getAttribute('aria-haspopup')==='menu'&&b.getAttribute('aria-expanded')==='false'&&getComputedStyle(b,'::after').content.includes('▸')})`));

    // --- the third level: hover opens a panel beside its row ------------------------------------------------------------
    await hover('#ctx-path');
    check('hovering Path opens its panel and Explore stays open', await waitFor(`${OPEN('ctx-path')}&&${OPEN('ctx-explore')}`, 2500));
    const pathRow = await ev(rect('#ctx-path'));
    const pathPanel = await ev(rect('#ctx-path + .ctx-sub-panel'));
    check('the third panel is beside the row, on the right, level with it', pathPanel.l >= pathRow.r - 2 && Math.abs(pathPanel.t - pathRow.t) <= 8, JSON.stringify({ pathRow, pathPanel }));
    check('and holds Hierarchy and Dependency', await ev(`[...${PANEL('ctx-path')}.querySelectorAll('button')].map((b)=>b.textContent.trim()).join('|')`) === 'Hierarchy|Dependency');
    await shot('path-panel');
    const treeRow = await ev(rect('#ctx-tree'));
    const dpathEntry = await ev(rect('#ctx-dpath'));
    await hoverAt(pathRow.x, pathRow.y);
    await hoverAt(treeRow.x + 10, treeRow.y);
    await hoverAt((treeRow.x + dpathEntry.x) / 2, (treeRow.y + dpathEntry.y) / 2);
    await hoverAt(dpathEntry.x, dpathEntry.y);
    await sleep(700);
    check('a diagonal move toward the Path panel across the Tree row keeps the Path panel', await ev(OPEN('ctx-path')) && await ev(SHUT('ctx-tree')));
    await hover('#ctx-tree');
    check('resting on Tree swaps the third panel for its own, and Explore stays open', await waitFor(`${OPEN('ctx-tree')}&&${SHUT('ctx-path')}&&${OPEN('ctx-explore')}`, 3000));
    check('Tree holds Hierarchy and Dependency too', await ev(`[...${PANEL('ctx-tree')}.querySelectorAll('button')].map((b)=>b.id).join()`) === 'ctx-htree,ctx-dtree');
    await hover('#ctx-add');
    check('resting on a plain entry of the menu shuts the third panel and Explore with it', await waitFor(`${SHUT('ctx-tree')}&&${SHUT('ctx-explore')}`, 3000));
    await clickOn('#ctx-explore');
    await waitFor(OPEN('ctx-explore'), 2500);
    await clickOn('#ctx-path');
    check('a click on Path opens its panel at once', await waitFor(OPEN('ctx-path'), 2500) && await ev(MENU_UP));
    await hoverAt(5, 5);
    check('an entry in the third panel is clicked as it always was: Dependency writes dpath:7 into the search box and shuts the menu', await (async () => { await clickOn('#ctx-dpath'); return menuGone(); })() && await waitFor(`document.getElementById('search-input').value==='dpath:7'`, 3000));

    // --- the keyboard ------------------------------------------------------------------------------------------------------
    await open('/?view=board'); // the search the pick wrote would narrow the board the next menu opens on
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

    // --- the keyboard, at the third level ----------------------------------------------------------------------------------
    check('the menu opens once more', await menuOnCard('7') && await ev(SHUT('ctx-explore')));
    for (let i = 0; i < 5; i++) await key('ArrowDown');
    check('five Downs reach the Explore row', await waitFor(`${ACTIVE}==='ctx-explore'`, 2000), await ev(ACTIVE));
    await key('ArrowRight');
    check('Right opens Explore and highlights Path, its first entry', await waitFor(`${OPEN('ctx-explore')}&&${ACTIVE}==='ctx-path'`, 2500), await ev(ACTIVE));
    await key('ArrowRight');
    check('Right on Path opens its panel and highlights Hierarchy', await waitFor(`${OPEN('ctx-path')}&&${OPEN('ctx-explore')}&&${ACTIVE}==='ctx-hpath'`, 2500), await ev(ACTIVE));
    await key('ArrowDown');
    check('Down inside the third panel moves to Dependency', await waitFor(`${ACTIVE}==='ctx-dpath'`, 2000), await ev(ACTIVE));
    await key('ArrowDown');
    check('and wraps inside the panel, never out of it', await waitFor(`${ACTIVE}==='ctx-hpath'&&${OPEN('ctx-path')}`, 2000), await ev(ACTIVE));
    await key('End');
    check('End goes to the last entry of the third level', await waitFor(`${ACTIVE}==='ctx-dpath'`, 2000), await ev(ACTIVE));
    await key('ArrowLeft');
    check('Left shuts the third panel alone and puts the highlight back on Path', await waitFor(`${SHUT('ctx-path')}&&${OPEN('ctx-explore')}&&${ACTIVE}==='ctx-path'`, 2500), await ev(ACTIVE));
    await key('ArrowDown');
    check('Down on Path reaches Tree', await waitFor(`${ACTIVE}==='ctx-tree'`, 2000), await ev(ACTIVE));
    await key('Enter');
    check('Enter on Tree opens its panel and highlights Hierarchy', await waitFor(`${OPEN('ctx-tree')}&&${ACTIVE}==='ctx-htree'`, 2500), await ev(ACTIVE));
    await ev(`document.getElementById('ctx-tree').focus()`);
    await key('ArrowLeft');
    check('Left on Tree, whose panel is open, shuts that panel and keeps the highlight on Tree', await waitFor(`${SHUT('ctx-tree')}&&${OPEN('ctx-explore')}&&${ACTIVE}==='ctx-tree'`, 2500) && await ev(MENU_UP), await ev(ACTIVE));
    await key('Enter');
    await waitFor(`${OPEN('ctx-tree')}&&${ACTIVE}==='ctx-htree'`, 2500);
    await key('Escape');
    check('the first Esc shuts the third panel and leaves Explore up', await waitFor(`${SHUT('ctx-tree')}&&${OPEN('ctx-explore')}&&${ACTIVE}==='ctx-tree'`, 2500) && await ev(MENU_UP), await ev(ACTIVE));
    await key('Escape');
    check('the second Esc shuts Explore and the menu stays up', await waitFor(`${SHUT('ctx-explore')}&&${ACTIVE}==='ctx-explore'`, 2500) && await ev(MENU_UP), await ev(ACTIVE));
    await key('Escape');
    check('the third Esc closes the menu', await menuGone());

    // --- a menu at the right edge opens its panel on the left ----------------------------------------------------------------
    const width = await ev('innerWidth');
    check('a menu opened at the right edge of the window', await (async () => { await rightClick('#board .card-el[data-id="7"]', { x: width - 12, y: 260 }); return menuUp(); })());
    await clickOn('#ctx-edit');
    check('opens its panel on the left of the row', await waitFor(OPEN('ctx-edit'), 2500) && await ev(`${PANEL('ctx-edit')}.getBoundingClientRect().right<=document.getElementById('ctx-edit').getBoundingClientRect().left+2`));
    await shot('panel-flipped');
    await key('Escape');
    await key('Escape');
    check('Esc twice closes it', await menuGone());

    // --- a Shift pick adds the term to the box as one more alternative ---------------------------------------------------------
    await open('/?view=board');
    await boardReady();
    await hoverAt(5, 5);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`, 3000);
    await menuOnCard('7');
    await clickOn('#ctx-explore');
    await waitFor(OPEN('ctx-explore'), 2500);
    await clickOn('#ctx-tree');
    await waitFor(OPEN('ctx-tree'), 2500);
    await clickOn('#ctx-htree');
    check('a plain pick writes its term into the box', await boxIs('htree:7') && await menuGone());
    await menuOnCard('8');
    await clickOn('#ctx-explore');
    await waitFor(OPEN('ctx-explore'), 2500);
    await clickOn('#ctx-path');
    await waitFor(OPEN('ctx-path'), 2500);
    await hover('#ctx-dpath');
    check('each item says in its tooltip that Shift adds to the search', await ev(`['ctx-hpath','ctx-htree','ctx-dpath','ctx-dtree'].every((id)=>/Shift: add to the search$/.test(document.getElementById(id).title))`));
    await clickOn('#ctx-dpath', { modifiers: 8 });
    check('a Shift+click adds its term as one more alternative, as typed, and shuts the menu', await boxIs('htree:7 | dpath:8') && await menuGone());
    await menuOnCard('8');
    for (let i = 0; i < 5; i++) await key('ArrowDown');
    await waitFor(`${ACTIVE}==='ctx-explore'`, 2000);
    await key('ArrowRight');
    await key('ArrowRight');
    await waitFor(`${ACTIVE}==='ctx-hpath'`, 2500);
    await key('Enter', { shift: true });
    check('Shift+Enter on the focused item does the same', await boxIs('htree:7 | dpath:8 | hpath:8') && await menuGone(), await ev(`document.getElementById('search-input').value`));
    check('and isolate follows the Board as typing does: the picks it wrote are its isolate text', await ev(`isolateNow()!==null`));

    // --- at phone width a tap opens a panel in place, at every level --------------------------------------------------------
    await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false });
    await open('/?view=graph');
    check('the Graph is drawn at phone width', await waitFor(`!!document.querySelector('#graph-view .card-el[data-id="7"]')`, 10000));
    await rightClick('#graph-view .card-el[data-id="7"]');
    check('a right-click on a card opens the menu at phone width', await menuUp());
    await clickOn('#ctx-explore');
    check('a tap on Explore opens its panel under its row', await waitFor(OPEN('ctx-explore'), 2500) && await ev(`${PANEL('ctx-explore')}.getBoundingClientRect().top>=document.getElementById('ctx-explore').getBoundingClientRect().bottom-2`));
    await clickOn('#ctx-path');
    check('a tap on Path opens its panel in place, under its row and indented', await waitFor(OPEN('ctx-path'), 2500) && await ev(`${PANEL('ctx-path')}.getBoundingClientRect().top>=document.getElementById('ctx-path').getBoundingClientRect().bottom-2&&${PANEL('ctx-path')}.getBoundingClientRect().left>document.getElementById('ctx-path').getBoundingClientRect().left`));
    await shot('phone-path');
    await clickOn('#ctx-path');
    check('a second tap on Path shuts its panel and leaves Explore open', await waitFor(`${SHUT('ctx-path')}&&${OPEN('ctx-explore')}`, 2500));
    await clickOn('#ctx-tree');
    await waitFor(OPEN('ctx-tree'), 2500);
    await clickOn('#ctx-htree');
    check('a tap on Hierarchy in Tree writes htree:7 into the search box and shuts the menu', await menuGone() && await waitFor(`document.getElementById('search-input').value==='htree:7'`, 3000));
    await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
  },
};
