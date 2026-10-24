'use strict';
// Groups, on the groups board (the plan board with a groups folder: iterations I1 and I2, a workflow
// W1 with a subtype DW1, a loose group _1, a file nested too deep, and one note on I2) and, for the
// board that keeps none, the plan board. A card wears up to two group badges and +N for the rest, with
// the dates and the type path as a tooltip; a badge opens the palette on its group, on its Group tab,
// which edits the name, the dates, auto_join and extra keys, takes members out, and fills the search
// box with the group's cards. A note written on a group lands on it. The right-click menu adds the
// selection to a group, makes a group from it, and, for a note on several cards, asks for a group they
// all share, or offers to make one, or to write the note on each card. group:, group:<id or name>
// and -group: narrow the board. Each step waits on the page, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// state, selectedIds, toast (the page's #toast element, by its id), writeSearch.

const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const q = (sel) => `document.querySelector(${JSON.stringify(`#notes-palette ${sel}`)})`;
const DLG = `document.getElementById('group-dialog')`;
const DLG_UP = `!${DLG}.classList.contains('hidden')`;
const DLG_GONE = `${DLG}.classList.contains('hidden')`;
const GROUPS = `state.groups.list`;
const group = (id) => `${GROUPS}.find((g)=>g.id===${JSON.stringify(id)})`;
const cardsOf = (id) => `(${group(id)}||{cards:[]}).cards.join()`;
const CHIP = `(()=>{const c=${q('.np-chip')};return c&&!c.hidden?${q('.np-chip-text')}.textContent:''})()`;
const BOARD_IDS = `[...document.querySelectorAll('#board .card-el')].map((e)=>e.dataset.id).sort((a,b)=>a-b).join()`;
const badgesOf = (id) => `[...document.querySelectorAll('#board .card-el[data-id="${id}"] .group-badge')].map((b)=>b.textContent)`;

module.exports = {
  name: 'groups',
  board: 'groups',
  alsoBoards: ['plan', 'groupsonly'],
  timeoutMs: 110000,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, rightClick, check, shot } = page;
    const boardReady = (ms) => waitFor(`document.querySelectorAll('#board .card-el').length>20`, ms || 10000);
    const palUp = (ms) => waitFor(PAL_UP, ms || 3000);
    const dlgUp = (ms) => waitFor(DLG_UP, ms || 3000);
    const setField = (sel, value) => ev(`(()=>{const i=document.querySelector(${JSON.stringify(sel)});i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    const press = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
    const mouseClick = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      await click(p.x, p.y);
    };
    // Esc clears a card chip before it closes the palette: press it until the palette is gone.
    const closePalette = async () => {
      for (let i = 0; i < 3; i++) {
        await key('Escape');
        if (await waitFor(PAL_GONE, i < 2 ? 700 : 2500)) return true;
      }
      return false;
    };
    const selectCards = async (ids) => {
      const [first, ...rest] = ids;
      const p = await centre(`#board .card-el[data-id="${first}"] .card-title`);
      await click(p.x, p.y, { modifiers: 2 });
      for (const id of rest) {
        const r = await centre(`#board .card-el[data-id="${id}"] .card-title`);
        await click(r.x, r.y, { modifiers: 2 });
      }
      return waitFor(`[...selectedIds].sort().join()===${JSON.stringify([...ids].sort().join())}`, 3000);
    };
    const menuUp = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    const search = async (text) => {
      await ev(`writeSearch(${JSON.stringify(text)}, 'typing')`);
      return waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`, 2000);
    };

    // --- the board that keeps no groups: nothing shows ----------------------------------------------------------
    await open('/?view=board', 'plan');
    check('plan: the board is drawn', await boardReady());
    check('plan: the payload carries no groups and no card wears a badge', await ev(`state.groups===null&&document.querySelectorAll('.group-badge').length===0`));
    await rightClick('#board .card-el[data-id="7"]');
    check('plan: the card menu has neither group entry', await menuUp() && await ev(`['ctx-group-add','ctx-group-make'].every((id)=>document.getElementById(id).classList.contains('hidden'))`));
    await key('Escape');
    await search('group:');
    check('plan: group: finds no card where there are no groups', await waitFor(`${BOARD_IDS}===''`, 3000));

    // --- groups on, notes off: a badge still opens the group, on its Group tab alone -----------------------------
    await open('/?view=board', 'groupsonly');
    check('groupsonly: the board is drawn with groups and no logbook', await boardReady() && await ev(`state.logbook===null&&state.groups&&${GROUPS}.length===5`));
    check('groupsonly: a card still wears its badge and no note count', await ev(`document.querySelectorAll('#board .card-el[data-id="3"] .group-badge').length===1&&document.querySelectorAll('.card-notes').length===0`));
    await rightClick('#board .card-el[data-id="3"]');
    check('groupsonly: the menu has Add to group... and no Add note...', await menuUp() && await ev(`!document.getElementById('ctx-group-add').classList.contains('hidden')&&document.getElementById('ctx-note').classList.contains('hidden')`));
    await key('Escape');
    const lone = await centre('#board .card-el[data-id="3"] .group-badge');
    await click(lone.x, lone.y);
    check('groupsonly: a badge opens the palette on the group, with no tab row', await palUp() && await ev(CHIP) === '#I2 zephyr-2' && await ev(`getComputedStyle(${q('.np-tabs')}).display==='none'`), await ev(CHIP));
    check('groupsonly: the Group tab is what it shows, and + Note is off', await ev(`!!${q('.gp-form')}&&${q('.gp-note')}.disabled&&getComputedStyle(${q('.np-input')}).display==='none'`));
    check('groupsonly: Esc closes the palette', await closePalette());

    // --- the badges ------------------------------------------------------------------------------------------------
    await open('/?view=board');
    check('groups: the board is drawn with its groups', await boardReady() && await ev(`state.groups&&${GROUPS}.length===5`));
    check('groups: the file nested too deep is reported and the rest read', await ev(`state.groups.skipped.length===1&&/X0001/.test(state.groups.skipped[0].file)`));
    check('groups: a card in one group wears one badge', await waitFor(`JSON.stringify(${badgesOf('3')})===JSON.stringify(['#I2 zephyr-2'])`, 4000), await ev(badgesOf('3')));
    check('groups: a card in three groups wears two badges and +1', await ev(`JSON.stringify(${badgesOf('7')})===JSON.stringify(['#DW1 schema-diff-review','#I2 zephyr-2'])`) && await ev(`document.querySelector('#board .card-el[data-id="7"] .group-more').textContent==='+1'`), await ev(badgesOf('7')));
    check('groups: the +1 names the group it hides', await ev(`document.querySelector('#board .card-el[data-id="7"] .group-more').title==='#W1 orders-cutover'`));
    check('groups: a card in no group wears none', await ev(`document.querySelectorAll('#board .card-el[data-id="1"] .group-badge').length===0`));
    check('groups: the tooltip gives the dates, then the type path', await ev(`document.querySelector('#board .card-el[data-id="3"] .group-badge').title==='2026-10-12 to 2026-10-23 · iteration'`));
    check('groups: a group in a subtype folder shows its path', await ev(`document.querySelector('#board .card-el[data-id="7"] .group-badge[data-group-id="DW1"]').title==='workflow/dynamic'`));
    check('groups: a loose group shows (no type)', await ev(`document.querySelector('#board .card-el[data-id="17"] .group-badge').title==='(no type)'`));

    // --- a badge opens the palette on the group's tab ---------------------------------------------------------------
    const badge = await centre('#board .card-el[data-id="3"] .group-badge');
    await click(badge.x, badge.y);
    check('groups: a click on a badge opens the palette on that group', await palUp() && await ev(CHIP) === '#I2 zephyr-2', await ev(CHIP));
    check('groups: on its Group tab, beside the Notes tab', await waitFor(`${q('.np-tab.on')}.dataset.tab==='group'&&[...document.querySelectorAll('#notes-palette .np-tab')].map((t)=>t.dataset.tab).join()==='notes,group'`, 2500));
    check('groups: the time field, the note box, the preview and the filter are not shown on the Group tab', await ev(`['.np-when','.np-input','.np-prev','.np-filter-row'].every((s)=>getComputedStyle(document.querySelector('#notes-palette '+s)).display==='none')`));
    await shot('group-tab');
    check('groups: the tab shows the name, the dates, auto_join and the extra key', await ev(`(()=>{const p=${q('.gp')};const t=[...p.querySelectorAll('input[type="text"]')].map((i)=>i.value);return t[0]==='zephyr-2'&&t.includes('@human')&&p.querySelector('.date-field input').value==='2026-10-12'&&p.querySelector('input[type="checkbox"]').checked})()`));
    check('groups: it lists the six members', await ev(`${q('.gp-members')}.querySelectorAll('li[data-member]').length===6`));
    check('groups: and the type path and the file', await ev(`${q('.gp-chip')}.textContent==='iteration'&&${q('.gp-path')}.textContent==='.groups/iteration/I0002.zephyr-2.md'`));

    // --- editing the group ----------------------------------------------------------------------------------------------
    await setField('#notes-palette .gp-form input[type="text"]', 'zephyr-two');
    check('groups: the tab has no native date input and a picker button beside each date', await ev(`!${q('input[type="date"]')}&&${q('.gp-form')}.querySelectorAll('.date-field .date-pick-btn').length===2`));
    await mouseClick('#notes-palette .gp-form .date-field:last-of-type .date-pick-btn');
    check('groups: the end date button opens the day picker on its month, with no time row', await waitFor(`!!document.querySelector('.date-picker-pop')&&!document.querySelector('.date-picker-pop').hidden&&document.querySelector('.dp-day.selected').dataset.day==='2026-10-23'&&!document.querySelector('.date-picker-time')`, 2500));
    await mouseClick('.date-picker-pop .dp-day[data-day="2026-10-25"]');
    check('groups: picking a day fills the field, closes the picker and leaves the palette up', await ev(`${q('.gp-form .date-field:last-of-type input')}.value==='2026-10-25'&&document.querySelector('.date-picker-pop').hidden`) && await ev(PAL_UP));
    await ev(`(()=>{const k=${q('input[aria-label="New key"]')};k.value='sprint';const v=${q('input[aria-label="New value"]')};v.value='two';return true})()`);
    await mouseClick('#notes-palette .gp-save');
    check('groups: Save changes the name, the end date and adds a key', await waitFor(`${group('I2')}.name==='zephyr-two'&&${group('I2')}.end_date==='2026-10-25'&&${group('I2')}.extra.sprint==='two'&&${group('I2')}.extra.owner==='@human'`, 4000), await ev(`JSON.stringify(${group('I2')})`));
    check('groups: the badges follow the new name', await waitFor(`JSON.stringify(${badgesOf('3')})===JSON.stringify(['#I2 zephyr-two'])`, 4000), await ev(badgesOf('3')));
    check('groups: the chip follows it too', await waitFor(`${CHIP}==='#I2 zephyr-two'`, 3000), await ev(CHIP));
    await setField('#notes-palette .gp-form input[type="text"]', '   ');
    await mouseClick('#notes-palette .gp-save');
    check('groups: a blank name is refused and changes nothing', await waitFor(`/short name/.test(document.getElementById('toast').textContent)`, 2000) && await ev(`${group('I2')}.name==='zephyr-two'`));
    await setField('#notes-palette .gp-form input[type="text"]', 'zephyr-two');
    check('groups: a list-valued extra key is shown as written, read only', await ev(`${q('.gp-extra-raw[data-key="milestones"]')}.textContent==='milestones:\\n  - design freeze\\n  - cutover'&&!${q('input[aria-label="milestones"]')}`));
    await setField('#notes-palette input[aria-label="owner"]', '');
    await mouseClick('#notes-palette .gp-save');
    check('groups: clearing a field empties the value and keeps the key', await waitFor(`'owner' in ${group('I2')}.extra&&${group('I2')}.extra.owner===''&&${group('I2')}.extra.sprint==='two'`, 4000), await ev(`JSON.stringify(${group('I2')}.extra)`));
    check('groups: the list-valued key is untouched by the save', await ev(`${group('I2')}.extra_raw.milestones==='milestones:\\n  - design freeze\\n  - cutover'`));
    await mouseClick('#notes-palette .gp-extra-rm[data-key="sprint"]');
    check('groups: a remove control takes the key out of the file', await waitFor(`!('sprint' in ${group('I2')}.extra)&&'owner' in ${group('I2')}.extra`, 4000), await ev(`JSON.stringify(${group('I2')}.extra)`));

    // --- taking a member out ---------------------------------------------------------------------------------------------
    await mouseClick('#notes-palette .gp-members li[data-member="24"] .gp-member-rm');
    check('groups: the x takes a member out of the group', await waitFor(`${cardsOf('I2')}==='3,7,15,22,23'`, 4000), await ev(cardsOf('I2')));
    check('groups: and the member leaves the list', await waitFor(`!${q('.gp-members li[data-member="24"]')}&&${q('.gp-members')}.querySelectorAll('li[data-member]').length===5`, 3000));
    check('groups: the card loses that badge and keeps the other one', await waitFor(`JSON.stringify(${badgesOf('24')})===JSON.stringify(['#W1 orders-cutover'])`, 4000), await ev(badgesOf('24')));

    // --- a note on the group lands on it ------------------------------------------------------------------------------------
    await mouseClick('#notes-palette .gp-note');
    check('groups: + Note goes to the Notes tab, still on the group', await waitFor(`${q('.np-tab.on')}.dataset.tab==='notes'&&${CHIP}==='#I2 zephyr-two'&&!${q('.np-input')}.hidden`, 2500));
    check('groups: the group\'s notes are listed, the one on the group first', await waitFor(`${q('.np-ngroup')}.dataset.target==='I2'`, 2500));
    await ev(`(()=>{const i=${q('.np-input')};i.value='ship the checklist';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return true})()`);
    await key('Enter');
    check('groups: a note written there lands on the group', await waitFor(`state.logbook.notes.some((n)=>n.target==='I2'&&n.note==='ship the checklist'&&/^\\d{4}\\.\\d\\d\\.\\d\\d\\.I0002\\.logbook\\.md$/.test(n.file))`, 4000));
    check('groups: the palette stays open on the group', await ev(`${PAL_UP}&&${CHIP}==='#I2 zephyr-two'`));

    // --- Show this group's cards -----------------------------------------------------------------------------------------------
    await mouseClick('#notes-palette .np-tab[data-tab="group"]');
    check('groups: the Group tab is back', await waitFor(`${q('.np-tab.on')}.dataset.tab==='group'`, 2000));
    await mouseClick('#notes-palette .gp-show');
    check('groups: Show this group\'s cards fills the search box with group:<id>', await waitFor(`document.getElementById('search-input').value==='group:I2'`, 2500));
    check('groups: the board narrows to the group\'s cards and the palette closes', await waitFor(`${BOARD_IDS}==='3,7,15,22,23'`, 3000) && await ev(PAL_GONE), await ev(BOARD_IDS));

    // --- the search terms ---------------------------------------------------------------------------------------------------------
    await search('group:orders-cutover');
    check('groups: group:<name> finds a group\'s cards by its name', await waitFor(`${BOARD_IDS}==='7,22,23,24'`, 3000), await ev(BOARD_IDS));
    await search('group:DW1');
    check('groups: group:<id> finds them by its id', await waitFor(`${BOARD_IDS}==='7,15'`, 3000), await ev(BOARD_IDS));
    await search('group:');
    check('groups: a bare group: finds every card that is in a group', await waitFor(`${BOARD_IDS}==='2,3,5,7,8,15,17,22,23,24'`, 3000), await ev(BOARD_IDS));
    await search('-group:');
    check('groups: -group: finds the cards that are in none', await waitFor(`!${BOARD_IDS}.split(',').some((id)=>['2','3','5','7','8','15','17','22','23','24'].includes(id))&&${BOARD_IDS}.split(',').length>10`, 3000), await ev(BOARD_IDS));
    await search('-group:I2 group:');
    check('groups: -group:<id> takes a group\'s cards out of the rest', await waitFor(`${BOARD_IDS}==='2,5,8,17,24'`, 3000), await ev(BOARD_IDS));
    await search('');
    check('groups: clearing the box brings every card back', await waitFor(`${BOARD_IDS}.split(',').length>20`, 3000));

    // --- Add to group... ---------------------------------------------------------------------------------------------------------------
    await rightClick('#board .card-el[data-id="1"]');
    check('groups: the menu of one card has Add to group... and no Make a group', await menuUp() && await ev(`!document.getElementById('ctx-group-add').classList.contains('hidden')&&document.getElementById('ctx-group-make').classList.contains('hidden')`));
    await press('#ctx-group-add');
    check('groups: Add to group... lists the board\'s groups by type path', await dlgUp() && await ev(`[...document.querySelectorAll('#group-dialog .pick-btn')].map((b)=>b.dataset.groupId).sort().join()==='DW1,I1,I2,W1,_1'`) && await ev(`[...document.querySelectorAll('#group-dialog .group-folder')].map((h)=>h.textContent).join()==='(no type),iteration,workflow,workflow/dynamic'`));
    await shot('add-to-group');
    check('groups: a group that does not hold the card is open to it', await ev(`['I1','I2','W1','DW1','_1'].every((id)=>!document.querySelector('#group-dialog .pick-btn[data-group-id="'+id+'"]').disabled)`));
    await key('Escape');
    check('groups: Esc closes the dialog and adds nothing', await waitFor(`${DLG_GONE}`, 2500) && await ev(`${cardsOf('W1')}==='7,22,23,24'`));
    await rightClick('#board .card-el[data-id="1"]');
    await menuUp();
    await press('#ctx-group-add');
    await dlgUp();
    await press('#group-dialog .pick-btn[data-group-id="W1"]');
    check('groups: a click adds the card to that group', await waitFor(`${cardsOf('W1')}==='1,7,22,23,24'`, 4000) && await waitFor(`${DLG_GONE}`, 2000), await ev(cardsOf('W1')));
    check('groups: and the card wears the badge', await waitFor(`JSON.stringify(${badgesOf('1')})===JSON.stringify(['#W1 orders-cutover'])`, 4000), await ev(badgesOf('1')));

    // --- Make a group from them... ---------------------------------------------------------------------------------------------------
    check('groups: two cards are selected', await selectCards(['8', '10']));
    await rightClick('#board .card-el[data-id="10"]');
    check('groups: the menu of a selection has Make a group from them...', await menuUp() && await ev(`!document.getElementById('ctx-group-make').classList.contains('hidden')`));
    await press('#ctx-group-make');
    check('groups: it opens the group form with the cards in it', await dlgUp() && await ev(`document.getElementById('group-dialog-title').textContent==='New group'&&[...document.querySelectorAll('#group-dialog .group-chip')].map((c)=>c.textContent.split(' ')[0]).join()==='#8,#10'`));
    await shot('group-form');
    await press('#group-dialog .group-submit');
    check('groups: a form with no name says so and makes nothing', await ev(`!document.querySelector('#group-dialog .group-error').hidden&&/short name/.test(document.querySelector('#group-dialog .group-error').textContent)`) && await ev(`${GROUPS}.length===5`));
    await setField('#gf-name', 'spring-clean');
    await setField('#gf-folder', 'iteration');
    check('groups: the folder says which prefix the id starts with', await ev(`/starts with I;/.test(document.querySelector('#group-dialog .bulk-hint').textContent)`));
    check('groups: the form has no native date input and a picker button beside each date', await ev(`!document.querySelector('#group-dialog input[type="date"]')&&document.querySelectorAll('#group-dialog .date-field .date-pick-btn').length===2`));
    await setField('#gf-start', '2026-11-02');
    await mouseClick('#group-dialog .date-pick-btn[data-date-input="gf-start"]');
    check('groups: the picker over the form opens on the typed date', await waitFor(`!document.querySelector('.date-picker-pop').hidden&&document.querySelector('.dp-day.selected').dataset.day==='2026-11-02'`, 2500));
    await mouseClick('.date-picker-pop .dp-day[data-day="2026-11-03"]');
    check('groups: picking a day fills the start date', await ev(`document.getElementById('gf-start').value==='2026-11-03'`));
    await setField('#gf-end', '2026-11-13');
    check('groups: auto_join is on offer once both dates are in', await ev(`!document.getElementById('gf-auto').disabled&&document.getElementById('gf-auto').checked`));
    await ev(`document.querySelector('#group-dialog .group-form').requestSubmit()`);
    check('groups: Create makes the group in its folder, with the id the counter gives and the two cards', await waitFor(`${group('I3')}&&${cardsOf('I3')}==='8,10'&&${group('I3')}.folder==='iteration'&&${group('I3')}.name==='spring-clean'&&${group('I3')}.auto_join===true&&${group('I3')}.start_date==='2026-11-03'`, 4000), await ev(`JSON.stringify(${GROUPS}.map((g)=>g.id))`));
    check('groups: the dialog closes and the cards wear the badge', await waitFor(`${DLG_GONE}`, 2000) && await waitFor(`JSON.stringify(${badgesOf('10')})===JSON.stringify(['#I3 spring-clean'])`, 4000), await ev(badgesOf('10')));

    // --- Add note... on several cards ----------------------------------------------------------------------------------------------------
    await open('/?view=board');
    check('groups: the board is drawn again', await boardReady());
    check('groups: two cards of one group are selected', await selectCards(['3', '15']));
    await rightClick('#board .card-el[data-id="15"]');
    check('groups: the menu of a selection has Add note...', await menuUp() && await ev(`!document.getElementById('ctx-note').classList.contains('hidden')`));
    await press('#ctx-note');
    check('groups: it asks which group the note goes on, listing the groups that hold both', await dlgUp() && await ev(`document.getElementById('group-dialog-title').textContent==='Add a note to 2 cards'&&[...document.querySelectorAll('#group-dialog .pick-btn.strong')].map((b)=>b.dataset.groupId).join()==='I2'`) && await ev(`/Which group does the note go on/.test(document.getElementById('group-dialog-body').textContent)`));
    check('groups: and offers Make a group from them... and Add the note to each card', await ev(`['make','each'].every((c)=>!!document.querySelector('#group-dialog .pick-btn[data-choice="'+c+'"]'))`));
    await shot('ask-note');
    await press('#group-dialog .pick-btn[data-group-id="I2"]');
    check('groups: picking the group opens the palette on it', await waitFor(`${DLG_GONE}`, 2000) && await palUp() && await ev(CHIP) === '#I2 zephyr-two', await ev(CHIP));
    check('groups: on its Notes tab, ready to write', await waitFor(`${q('.np-tab.on')}.dataset.tab==='notes'&&!${q('.np-input')}.hidden`, 2500));
    check('groups: Esc closes the palette', await closePalette());
    await ev(`document.body.focus()`);

    await open('/?view=board');
    check('groups: the board is drawn once more', await boardReady());
    check('groups: two cards of no shared group are selected', await selectCards(['2', '10']));
    await rightClick('#board .card-el[data-id="10"]');
    await menuUp();
    await press('#ctx-note');
    check('groups: the question says they are not grouped together', await dlgUp() && await ev(`/aren.t grouped together/.test(document.getElementById('group-dialog-body').textContent)&&document.querySelectorAll('#group-dialog .pick-btn.strong').length===0`));
    await press('#group-dialog .pick-btn[data-choice="each"]');
    check('groups: Add the note to each card opens the palette on both cards', await waitFor(`${DLG_GONE}`, 2000) && await palUp() && await ev(CHIP) === 'each of 2 cards', await ev(CHIP));
    check('groups: the preview says one note goes on each', await waitFor(`/on each of 2 cards \\(#2, #10\\)/.test(${q('.np-prev-text')}.textContent)`, 2500), await ev(`${q('.np-prev-text')}.textContent`));
    await ev(`(()=>{const t=${q('.np-time')};t.value='09:30';t.dispatchEvent(new Event('input',{bubbles:true}));const i=${q('.np-input')};i.value='checked both';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return true})()`);
    await key('Enter');
    check('groups: Enter writes the note on each card', await waitFor(`['2','10'].every((id)=>state.logbook.notes.some((n)=>n.target===id&&n.note==='checked both'&&n.at==='09:30'))`, 5000), await ev(`JSON.stringify(state.logbook.notes.filter((n)=>n.note==='checked both'))`));
    check('groups: the palette stays open, with the box empty', await ev(`${PAL_UP}&&${q('.np-input')}.value===''`));
    check('groups: Esc closes the palette', await closePalette());
    await ev(`document.body.focus()`);

    await open('/?view=board');
    check('groups: the board is drawn for the last time', await boardReady());
    check('groups: two cards of no shared group are selected again', await selectCards(['2', '10']));
    await rightClick('#board .card-el[data-id="10"]');
    await menuUp();
    await press('#ctx-note');
    await dlgUp();
    await press('#group-dialog .pick-btn[data-choice="make"]');
    check('groups: Make a group from them... in the question opens the form with both cards', await dlgUp() && await ev(`document.getElementById('group-dialog-title').textContent==='New group'&&document.querySelectorAll('#group-dialog .group-chip').length===2`));
    await setField('#gf-name', 'pair');
    await ev(`document.querySelector('#group-dialog .group-form').requestSubmit()`);
    check('groups: the loose group takes the id the underscore counter gives', await waitFor(`${group('_2')}&&${cardsOf('_2')}==='2,10'`, 4000), await ev(`JSON.stringify(${GROUPS}.map((g)=>g.id))`));
    check('groups: and the palette opens on the new group, ready for the note', await waitFor(`${DLG_GONE}`, 2000) && await palUp() && await ev(CHIP) === '#_2 pair', await ev(CHIP));
    await closePalette();
  },
};
