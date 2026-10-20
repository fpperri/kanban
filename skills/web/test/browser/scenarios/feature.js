'use strict';
// The whole notes and groups feature on one board, the feature board: the groups board with a scratchpad,
// the iteration dropdown and a goal with a prefixed id, G11, listed by the running iteration I2 (beside the
// plain card 11, which is a different card). One card, G11, is walked through every part of it in the order a
// person meets them: its prefixed id (distinct from #11, found by its whole id), a note written from the card
// menu's palette, the note's chip on the Calendar, its group badge and the Group tab it opens, the iteration
// dropdown narrowing the Board and keeping its pick, the Scratchpad tab of the card, the gear's pages for the
// logbook, the scratchpad, the groups and the prefixes, and last a delete whose popup offers the card's
// logbook and scratchpad, both ticked, taking the card, its notes, its page and its place in the iteration
// together. Each step waits on the page or on the file, never on a fixed sleep.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// state, calendarAnchor, localTodayStr, renderBoard, renderCalendarView, autoRefreshTick, writeSearch.

const fs = require('fs');
const path = require('path');

const ID = 'G11';
const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const q = (sel) => `document.querySelector(${JSON.stringify(`#notes-palette ${sel}`)})`;
const CHIP = `(()=>{const c=${q('.np-chip')};return c&&!c.hidden?${q('.np-chip-text')}.textContent:''})()`;
const TABS = `[...document.querySelectorAll('#notes-palette .np-tab')].map((b)=>b.textContent+(b.classList.contains('on')?'*':'')).join()`;
const SEL = `document.getElementById('iter-select')`;
const BOARD_IDS = `[...new Set([...document.querySelectorAll('#board .card-el')].map((e)=>e.dataset.id))].sort().join()`;
const TEXT = `document.querySelector('#notes-palette .sp-text')`;
const READY = `(()=>{const t=${TEXT};return !!t&&!t.disabled})()`;
const PATH = `(document.querySelector('#notes-palette .sp-path')||{textContent:''}).textContent`;
const SECTIONS = `[...document.querySelectorAll('#notes-palette .np-ngroup')].map((g)=>[g.dataset.day,g.dataset.target,g.querySelectorAll('.np-note').length].join('|')).join()`;
const TODAY = `(()=>{const d=new Date();const p=(n)=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())})()`;
const DLG = `document.getElementById('group-dialog')`;
const DLG_UP = `!${DLG}.classList.contains('hidden')`;
const DLG_GONE = `${DLG}.classList.contains('hidden')`;
const BODY = `document.getElementById('group-dialog-body')`;
const boxes = `[...${BODY}.querySelectorAll('input[data-del]')].map((i)=>i.dataset.del+':'+i.checked).join()`;
const live = (id) => `state.active.some((c)=>c.id===${JSON.stringify(id)})`;
const notesOf = (target) => `state.logbook.notes.filter((n)=>n.target===${JSON.stringify(target)}).length`;
const group = (id) => `state.groups.list.find((g)=>g.id===${JSON.stringify(id)})`;
const targets = `JSON.stringify(state.scratchpad&&state.scratchpad.targets)`;
const SHEET = `document.getElementById('prefs-sheet')`;
const pageTitle = `(document.getElementById('prefs-page-title')||{textContent:''}).textContent`;
const menuState = (page) => `(()=>{const b=document.querySelector('.prefs-menu-item[data-page="${page}"]');const s=b&&b.querySelector('.prefs-menu-state');return s?s.textContent:null})()`;
const rows = `[...document.querySelectorAll('#prefs-board-page .prefs-table tbody tr')].map((r)=>[...r.children].map((c)=>c.textContent))`;
const NOTE_TEXT = 'cutover reliability reviewed with the team';

module.exports = {
  name: 'feature',
  board: 'feature',
  timeoutMs: 140000,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, rightClick, check, shot } = page;
    const press = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
    const menuUp = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const closePalette = async () => { await key('Escape'); return waitFor(PAL_GONE, 2500); };
    const setToday = (day) => ev(`(()=>{localTodayStr=()=>${JSON.stringify(day)};renderBoard();return true})()`);
    const pick = (value) => ev(`(()=>{const s=${SEL};s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));return s.value===${JSON.stringify(value)}})()`);
    const refreshed = async (expr) => { await ev(`autoRefreshTick()`); return waitFor(expr, 4000); };

    await open('/?view=board');
    check('feature: the board is drawn with its logbook, groups and scratchpad', await waitFor(`document.querySelectorAll('#board .card-el').length>5&&!!state.logbook&&!!state.groups&&!!state.scratchpad`, 10000));
    await pick('');
    check('feature: All cards shows the whole board, whatever iteration the clock says is running', await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 3000));
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const padFile = path.join(boardDir, '.scratchpad', 'G0011.scratchpad.md');

    // --- a prefixed id: the whole id is the identity ----------------------------------------------------------------
    check('feature: the goal G11 is drawn beside the plain card 11, two cards', await ev(`!!document.querySelector('#board .card-el[data-id="G11"]')&&!!document.querySelector('#board .card-el[data-id="11"]')`));
    check('feature: it wears its whole id', await ev(`document.querySelector('#board .card-el[data-id="G11"] .card-id').textContent.includes('G11')`), await ev(`document.querySelector('#board .card-el[data-id="G11"]').innerText`));
    await ev(`writeSearch('#G11', 'typing')`);
    check('feature: the search #G11 finds that card alone, not #11', await waitFor(`${BOARD_IDS}==='G11'`, 3000), await ev(BOARD_IDS));
    await ev(`writeSearch('', 'typing')`);
    check('feature: clearing the box brings the board back', await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 3000));

    // --- a note from the palette -------------------------------------------------------------------------------------------
    await rightClick(`#board .card-el[data-id="${ID}"]`);
    check('feature: the card menu offers Add note', await menuUp() && await ev(`!document.getElementById('ctx-note').classList.contains('hidden')`));
    await press('#ctx-note');
    check('feature: the palette opens aimed at #G11', await waitFor(PAL_UP, 3000) && await ev(CHIP) === '#G11 Keep the zephyr cutover reliable', await ev(CHIP));
    await ev(`(()=>{const i=${q('.np-input')};i.value=${JSON.stringify(NOTE_TEXT)};i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return true})()`);
    await key('Enter');
    check('feature: Enter writes the note on the whole id and the card wears its count', await waitFor(`${notesOf(ID)}===1`, 4000) && await waitFor(`(document.querySelector('#board .card-el[data-id="G11"] .card-notes')||{}).textContent==='1'`, 3000), await ev(notesOf(ID)));
    check('feature: and the day file is named for G0011', fs.readdirSync(path.join(boardDir, 'logbook')).some((f) => /\.G0011\.logbook\.md$/.test(f)), fs.readdirSync(path.join(boardDir, 'logbook')).join());
    await shot('feature-note');
    check('feature: Esc closes the palette', await closePalette());

    // --- the note on the Calendar ----------------------------------------------------------------------------------------
    await open('/?view=calendar');
    await waitFor(`document.querySelectorAll('#calendar-view .cal-subview-btn').length===4`, 10000);
    await ev(`document.querySelector('#calendar-view [data-subview="week"]').click()`);
    await waitFor(`document.querySelectorAll('#calendar-view .cal-tg-col').length===7`, 10000);
    await ev(`(()=>{calendarAnchor=localTodayStr();renderCalendarView()})()`);
    check('feature: the Calendar draws the note as a chip with the whole id and the first words', await waitFor(`[...document.querySelectorAll('#calendar-view .cal-note')].some((c)=>c.textContent.includes('#G11')&&c.textContent.includes('cutover reliability'))`, 5000), await ev(`[...document.querySelectorAll('#calendar-view .cal-note')].map((c)=>c.textContent).join('|')`));
    check('feature: its tooltip names the card and the full text', await ev(`[...document.querySelectorAll('#calendar-view .cal-note')].some((c)=>c.title.includes('#G11 Keep the zephyr cutover reliable')&&c.title.endsWith(${JSON.stringify(NOTE_TEXT)}))`));
    await ev(`(()=>{const c=[...document.querySelectorAll('#calendar-view .cal-note')].find((x)=>x.textContent.includes('#G11'));c.scrollIntoView({block:'center'});return true})()`);
    await shot('feature-calendar');
    await press(`#calendar-view .cal-note[title*="#G11"]`);
    check('feature: the chip opens the palette on its half hour, headed by the card', await waitFor(PAL_UP, 3000) && /\d\d:\d\d$/.test(await ev(CHIP)) && await ev(SECTIONS) === `${await ev(TODAY)}|G11|1`, await ev(CHIP));
    await closePalette();

    // --- the group badge and the Group tab ---------------------------------------------------------------------------------
    await open('/?view=board');
    await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000);
    check('feature: G11 wears the badge of the iteration that lists it', await ev(`[...document.querySelectorAll('#board .card-el[data-id="G11"] .group-badge')].map((b)=>b.textContent).join()`) === '#I2 zephyr-2', await ev(`[...document.querySelectorAll('#board .card-el[data-id="G11"] .group-badge')].map((b)=>b.textContent).join()`));
    await clickOn(`#board .card-el[data-id="${ID}"] .group-badge`);
    check('feature: the badge opens the group on its Group tab, with Notes and Scratchpad beside it', await waitFor(`!!document.querySelector('#notes-palette .gp')`, 3000) && await ev(TABS) === 'Notes,Group*,Scratchpad', await ev(TABS));
    check('feature: the group is zephyr-2 and lists G11 among its cards', await ev(`${group('I2')}.cards.includes('G11')&&!!document.querySelector('#notes-palette .gp[data-group-id="I2"]')`));
    await shot('feature-group-tab');
    await closePalette();

    // --- the iteration dropdown --------------------------------------------------------------------------------------------
    await ev(`localStorage.removeItem('kanban.feature.iteration')`);
    await open('/?view=board');
    await waitFor(`document.querySelectorAll('#board .card-el').length>5`, 10000);
    await setToday('2026-10-15');
    check('feature: the iteration dropdown shows and opens on the running iteration', await waitFor(`!${SEL}.hidden`, 3000) && await ev(`${SEL}.value==='I2'`), await ev(`${SEL}.value`));
    check('feature: the Board then shows the iteration\'s cards, G11 among them', await waitFor(`${BOARD_IDS}===${JSON.stringify(['15', '22', '23', '24', '3', '7', 'G11'].sort().join())}`, 3000), await ev(BOARD_IDS));
    check('feature: picking the other iteration takes G11 off the Board', await pick('I1') && await waitFor(`!document.querySelector('#board .card-el[data-id="G11"]')`, 3000));
    check('feature: picking All cards brings it back', await pick('') && await waitFor(`!!document.querySelector('#board .card-el[data-id="G11"]')`, 3000));
    await pick('I2');
    await shot('feature-iteration');

    // --- the scratchpad tab ----------------------------------------------------------------------------------------------------
    await rightClick(`#board .card-el[data-id="${ID}"]`);
    await menuUp();
    await press('#ctx-scratch');
    check('feature: the card menu opens its Scratchpad tab, page not written yet', await waitFor(READY, 4000) && await ev(TABS) === 'Notes,Scratchpad*' && await ev(`${PATH}==='.scratchpad/G0011.scratchpad.md (not written yet)'`), await ev(PATH));
    await ev(`(()=>{const t=${TEXT};t.focus();t.value='list the cutover risks';t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await key('Enter', { ctrl: true });
    check('feature: Ctrl+Enter writes the page and the board lists the target', await waitFor(`${targets}==='["7","G11","I2"]'`, 4000) && fs.existsSync(padFile), await ev(targets));
    check('feature: the file holds what was typed', fs.readFileSync(padFile, 'utf8').replace(/\r\n/g, '\n').endsWith('list the cutover risks'));
    await shot('feature-scratchpad');
    await closePalette();

    // --- the gear's pages ------------------------------------------------------------------------------------------------------
    await clickOn('#prefs-btn');
    check('feature: the gear opens its sheet', await waitFor(`!${SHEET}.classList.contains('hidden')`, 2500) && await waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 2500));
    const pages = await ev(`[...document.querySelectorAll('#prefs-board-menu .prefs-menu-item')].map((b)=>b.firstChild.textContent)`);
    check('feature: This board lists Logbook, Scratchpad, Groups, Prefixes and Counters', pages.join() === 'Logbook,Scratchpad,Groups,Prefixes,Counters', pages);
    check('feature: the menu says logbook on, scratchpad on and groups on', await ev(menuState('board:logbook')) === 'on' && await ev(menuState('board:scratchpad')) === 'on' && /^on/.test(await ev(menuState('board:groups'))), [await ev(menuState('board:logbook')), await ev(menuState('board:scratchpad')), await ev(menuState('board:groups'))]);
    await clickOn('.prefs-menu-item[data-page="board:groups"]');
    check('feature: the Groups page has Iterations on, as the board declares', await waitFor(`${pageTitle}==='Groups'`, 2500) && await ev(`document.querySelector('.prefs-opt[data-switch="iterations"][data-value="on"]').getAttribute('aria-pressed')==='true'`));
    await clickOn('.prefs-menu-item[data-page="board:prefixes"]');
    const prefixRows = await waitFor(`${pageTitle}==='Prefixes'`, 2500) && await ev(rows);
    check('feature: the Prefixes page lists G for the goal type and the group folders', Array.isArray(prefixRows) && prefixRows.length === 5 && prefixRows.some((r) => r[0] === 'G' && r[1] === 'card type goal') && prefixRows.some((r) => r[0] === 'I' && r[1] === '.groups/iteration/'), prefixRows);
    await clickOn('.prefs-menu-item[data-page="board:counters"]');
    const counterRows = await waitFor(`${pageTitle}==='Counters'`, 2500) && await ev(rows);
    check('feature: the Counters page lists the goal counter beside the groups\'', Array.isArray(counterRows) && counterRows.some((r) => r.join() === 'G,12') && counterRows.some((r) => r.join() === 'I,3'), counterRows);
    await key('Escape');
    check('feature: Esc closes the sheet', await waitFor(`${SHEET}.classList.contains('hidden')`, 2500));

    // --- a delete, with its boxes ------------------------------------------------------------------------------------------------
    await rightClick(`#board .card-el[data-id="${ID}"]`);
    await menuUp();
    await press('#ctx-delete');
    check('feature: Delete opens the popup for the whole id', await waitFor(DLG_UP, 3000) && await ev(`document.getElementById('group-dialog-title').textContent==='Delete #G11 Keep the zephyr cutover reliable?'`), await ev(`document.getElementById('group-dialog-title').textContent`));
    check('feature: it says the id comes out of the iteration\'s list', await ev(`/It comes out of every group's list: #I2 zephyr-2/.test(${BODY}.textContent)`), await ev(`${BODY}.textContent`));
    check('feature: it offers the card\'s logbook and its scratchpad, both unticked', await ev(boxes) === 'logbook:false,scratchpad:false', await ev(boxes));
    await ev(`${BODY}.querySelector('input[data-del="logbook"]').click()`);
    await ev(`${BODY}.querySelector('input[data-del="scratchpad"]').click()`);
    check('feature: ticking both ticks them', await ev(boxes) === 'logbook:true,scratchpad:true', await ev(boxes));
    await shot('feature-delete');
    await press('#group-dialog [data-confirm="delete"]');
    check('feature: the card is gone and the iteration let it go', await refreshed(`!${live(ID)}&&!${group('I2')}.cards.includes('G11')`), await ev(`${group('I2')}.cards.join()`));
    check('feature: its notes and its scratchpad went with it', await refreshed(`${notesOf(ID)}===0&&${targets}==='["7","I2"]'`) && !fs.existsSync(padFile), await ev(targets));
    check('feature: the plain card 11 is untouched', await ev(live('11')));
    check('feature: the popup closed and the toast says what went', await waitFor(DLG_GONE, 2500) && await waitFor(`/Deleted #G11/.test(document.getElementById('toast').textContent)`, 2500), await ev(`document.getElementById('toast').textContent`));
  },
};
