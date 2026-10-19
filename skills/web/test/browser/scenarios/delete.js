'use strict';
// The delete popup, on the groups board (iterations I1 and I2, a workflow W1 with a subtype DW1, a loose
// group _1). Deleting a card opens a popup that says what goes and which groups lose the card; its id
// always leaves every group's list, and "Its logbook" is a box left unticked (unticked, the day files stay
// and read as dangling). A selection of cards is one popup. A group's popup adds "Its member cards", which
// lists what it would delete and names the members another group holds, which it skips. Archiving asks
// nothing: the page's confirm() is replaced here and counted. Each step waits on the page, never on a
// fixed sleep.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// state, selectedIds, autoRefreshTick, toast (the page's #toast element, by its id).

const DLG = `document.getElementById('group-dialog')`;
const DLG_UP = `!${DLG}.classList.contains('hidden')`;
const DLG_GONE = `${DLG}.classList.contains('hidden')`;
const BODY = `document.getElementById('group-dialog-body')`;
const TITLE = `document.getElementById('group-dialog-title').textContent`;
const PAL = `document.getElementById('notes-palette')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const group = (id) => `state.groups.list.find((g)=>g.id===${JSON.stringify(id)})`;
const cardsOf = (id) => `(${group(id)}||{cards:[]}).cards.join()`;
const live = (id) => `state.active.some((c)=>c.id===${JSON.stringify(id)})`;
const notesOf = (target) => `state.logbook.notes.filter((n)=>n.target===${JSON.stringify(target)}).length`;
const boxes = `[...${BODY}.querySelectorAll('input[data-del]')].map((i)=>i.dataset.del+':'+i.checked).join()`;
const lines = `[...${BODY}.querySelectorAll('.bulk-hint')].map((p)=>p.textContent).join(' | ')`;
const rows = `[...${BODY}.querySelectorAll('.del-list li')].map((li)=>li.textContent).join(' | ')`;

module.exports = {
  name: 'delete',
  board: 'groups',
  timeoutMs: 110000,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, rightClick, check, shot } = page;
    const dlgUp = (ms) => waitFor(DLG_UP, ms || 3000);
    const menuUp = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    const press = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
    const note = (target, text) => ev(`fetch('/api/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({day:'2026-10-16',target:${JSON.stringify(target)},at:'09:00',note:${JSON.stringify(text)}})}).then((r)=>r.status)`);
    const refreshed = async (expr) => { await ev(`autoRefreshTick()`); return waitFor(expr, 4000); };
    const deleteFromMenu = async (id) => {
      await rightClick(`#board .card-el[data-id="${id}"]`);
      await menuUp();
      await press('#ctx-delete');
      return dlgUp();
    };

    await open('/?view=board');
    check('delete: the board is drawn with its groups', await waitFor(`document.querySelectorAll('#board .card-el').length>20&&state.groups&&state.groups.list.length===5`, 10000));
    await ev(`window.confirm=()=>{window.__confirms=(window.__confirms||0)+1;return true}`);
    for (const [target, text] of [['3', 'three a'], ['3', 'three b'], ['15', 'fifteen'], ['I1', 'about the iteration'], ['_1', 'about the offsite']]) await note(target, text);
    check('delete: the notes are on the board', await refreshed(`${notesOf('3')}===2&&${notesOf('15')}===1&&${notesOf('I1')}===1`));

    // --- a card: the groups it leaves, the logbook box unticked ----------------------------------------------
    check('delete: Delete on a card opens a popup, not a confirm()', await deleteFromMenu('3') && await ev(`${TITLE}==='Delete #3 Write the cutover plan?'`), await ev(TITLE));
    check('delete: it says the id comes out of the group lists', await ev(`/It comes out of every group's list: #I2 zephyr-2/.test(${lines})`), await ev(lines));
    check('delete: its logbook box counts the notes and is unticked', await ev(`${boxes}==='logbook:false'`) && await ev(`/Its logbook \\(2 notes\\)/.test(${BODY}.textContent)`), await ev(boxes));
    await shot('delete-card');
    await key('Escape');
    check('delete: Esc cancels and deletes nothing', await waitFor(DLG_GONE, 2500) && await ev(`${live('3')}&&${cardsOf('I2')}==='3,7,15,22,23,24'`));
    await deleteFromMenu('3');
    await press('#group-dialog [data-confirm="delete"]');
    check('delete: the card is gone and its id left the group', await refreshed(`!${live('3')}&&${cardsOf('I2')}==='7,15,22,23,24'`), await ev(cardsOf('I2')));
    check('delete: the popup closes and the toast says which group lost it', await waitFor(DLG_GONE, 2500) && await waitFor(`/Deleted #3; out of #I2/.test(document.getElementById('toast').textContent)`, 2500), await ev(`document.getElementById('toast').textContent`));
    check('delete: its logbook stayed, unticked, reading as dangling', await ev(`${notesOf('3')}===2`));

    // --- a card with the logbook ticked ----------------------------------------------------------------------
    await deleteFromMenu('15');
    check('delete: card 15 names both groups that list it', await ev(`/#DW1 schema-diff-review, #I2 zephyr-2/.test(${lines})`), await ev(lines));
    await ev(`${BODY}.querySelector('input[data-del="logbook"]').click()`);
    check('delete: ticking the logbook box ticks it', await ev(`${boxes}==='logbook:true'`));
    await press('#group-dialog [data-confirm="delete"]');
    check('delete: the card and its day files are gone, and both groups let it go', await refreshed(`!${live('15')}&&${notesOf('15')}===0&&${cardsOf('DW1')}==='7'&&${cardsOf('I2')}==='7,22,23,24'`), await ev(`[${cardsOf('DW1')},${cardsOf('I2')},${notesOf('15')}].join(' ')`));

    // --- a selection: one popup ----------------------------------------------------------------------------------
    const first = await centre('#board .card-el[data-id="22"] .card-title');
    await click(first.x, first.y, { modifiers: 2 });
    const second = await centre('#board .card-el[data-id="23"] .card-title');
    await click(second.x, second.y, { modifiers: 2 });
    check('delete: two cards are selected', await waitFor(`[...selectedIds].sort().join()==='22,23'`, 3000));
    await rightClick('#board .card-el[data-id="22"]');
    await menuUp();
    await press('#ctx-delete');
    check('delete: Delete selected opens one popup for both', await dlgUp() && await ev(`${TITLE}==='Delete 2 cards?'&&${BODY}.querySelectorAll('.group-chip').length===2`), await ev(TITLE));
    await press('#group-dialog [data-confirm="delete"]');
    check('delete: both go on the one answer, and the selection clears', await refreshed(`!${live('22')}&&!${live('23')}&&${cardsOf('W1')}==='7,24'`) && await waitFor(`selectedIds.size===0`, 2500), await ev(cardsOf('W1')));

    // --- archiving asks nothing ----------------------------------------------------------------------------------------
    const tile = await centre('#board .card-el[data-id="24"] .card-title');
    await click(tile.x, tile.y);
    await waitFor(`!document.getElementById('detail-modal').classList.contains('hidden')`, 3000);
    await press('#detail-archive-btn');
    check('delete: archiving from the card asks nothing and archives', await refreshed(`state.archived.some((c)=>c.id==='24')`) && await ev(`!window.__confirms`), await ev(`window.__confirms`));

    // --- a group: the member list, the skips ----------------------------------------------------------------------
    const badge = await centre('#board .card-el[data-id="8"] .group-badge');
    await click(badge.x, badge.y);
    check('delete: a badge opens the group on its Group tab', await waitFor(`!!document.querySelector('#notes-palette .gp-delete')`, 3000));
    await press('#notes-palette .gp-delete');
    check('delete: Delete group... opens the popup', await dlgUp() && await ev(`${TITLE}==='Delete group #I1 zephyr-1?'`), await ev(TITLE));
    check('delete: it offers the logbook and the member cards, both unticked', await ev(`${boxes}==='logbook:false,members:false'`), await ev(boxes));
    check('delete: it lists the members: two to delete, one it skips, naming the group that holds it', await ev(`${rows}==='Deletes #2 Move the zephyr data layer | Skips #5 Inventory current services: also in #_1 offsite-prep | Deletes #8 Backfill historic rows'`), await ev(rows));
    await shot('delete-group');
    await ev(`${BODY}.querySelector('input[data-del="logbook"]').click()`);
    await ev(`${BODY}.querySelector('input[data-del="members"]').click()`);
    await press('#group-dialog [data-confirm="delete"]');
    check('delete: the group is gone with its members that no other group holds', await refreshed(`!${group('I1')}&&!${live('2')}&&!${live('8')}&&${live('5')}`), await ev(`[${live('2')},${live('8')},${live('5')}].join(' ')`));
    check('delete: its logbook went and the kept member\'s group still lists it', await ev(`${notesOf('I1')}===0&&${cardsOf('_1')}==='5,17'`));
    check('delete: the toast names what it kept, and the palette closes', await waitFor(`/kept #5 \\(also in #_1\\)/.test(document.getElementById('toast').textContent)`, 2500) && await waitFor(PAL_GONE, 2500), await ev(`document.getElementById('toast').textContent`));

    // --- a group, nothing ticked --------------------------------------------------------------------------------------------
    const loose = await centre('#board .card-el[data-id="17"] .group-badge');
    await click(loose.x, loose.y);
    await waitFor(`!!document.querySelector('#notes-palette .gp-delete')`, 3000);
    await press('#notes-palette .gp-delete');
    await dlgUp();
    await press('#group-dialog [data-confirm="delete"]');
    check('delete: unticked, only the group file goes: its cards and its logbook stay', await refreshed(`!${group('_1')}&&${live('5')}&&${live('17')}&&${notesOf('_1')}===1`), await ev(`[${live('5')},${live('17')},${notesOf('_1')}].join(' ')`));
    check('delete: no confirm() was asked all through', await ev(`!window.__confirms`), await ev(`window.__confirms`));
  },
};
