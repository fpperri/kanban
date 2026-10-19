'use strict';
// The notes palette, on the notes board (the plan board with a logbook: notes on cards 7, 22
// and 3 and on nothing) and, for the board that keeps no logbook, the plan board. The count a
// card with notes wears opens its notes, newest day first, each with its time (and its author
// when it is not the human); the filter field narrows them and leaves the note box alone. n on
// the hovered card, on the one selected card and on nothing, and the right-click Add note...,
// open the palette aimed at a card, and with nothing aimed at it starts on the card last noted.
// Enter writes the note at the time field's time, keeps the palette open and clears the box;
// Shift+Enter starts a new line; a leading HH:MM, the untimed tick and a leading - each set the
// time, and the preview line says exactly what Enter will write; a bare #22 then Enter aims the
// palette at that card and Backspace on the empty box clears the chip. e, a and d d work on a
// listed note: edit its text and time, assign it to another card, delete it. Keys typed in the
// palette reach none of the board's own shortcuts. With no logbook line nothing shows and n says
// why. Each step waits on the page, never on a fixed sleep.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// state, selectedIds, hoveredId, toast (the page's #toast element, by its id).

const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const q = (sel) => `document.querySelector(${JSON.stringify(`#notes-palette ${sel}`)})`;
const CHIP = `(()=>{const c=${q('.np-chip')};return c&&!c.hidden?${q('.np-chip-text')}.textContent:''})()`;
const PREVIEW = `${q('.np-prev-text')}.textContent`;
const BOX = `${q('.np-input')}.value`;
const SECTIONS = `[...document.querySelectorAll('#notes-palette .np-ngroup')].map((g)=>[g.dataset.day,g.dataset.target,g.querySelectorAll('.np-note').length].join('|'))`;
const ROW_TEXTS = `[...document.querySelectorAll('#notes-palette .np-note')].map((r)=>r.querySelector('.np-note-text').textContent)`;
const TODAY = `(()=>{const d=new Date();const p=(n)=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())})()`;
const NOTES = `state.logbook.notes`;
const notesOf = (target) => `${NOTES}.filter((n)=>n.target===${JSON.stringify(target)}).map((n)=>[n.day===${TODAY}?'today':n.day,n.at,n.by,n.note].join('|')).sort()`;

module.exports = {
  name: 'notes',
  board: 'notes',
  alsoBoards: ['plan'],
  timeoutMs: 100000,
  async run(page) {
    const { ev, open, waitFor, centre, click, mouse, key, rightClick, check, shot } = page;
    const boardReady = (ms) => waitFor(`document.querySelectorAll('#board .card-el').length>20`, ms || 10000);
    const palUp = (ms) => waitFor(PAL_UP, ms || 3000);
    const setBox = (text) => ev(`(()=>{const i=${q('.np-input')};i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return true})()`);
    const setTime = (text) => ev(`(()=>{const i=${q('.np-time')};i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const preview = () => ev(PREVIEW);
    const chip = () => ev(CHIP);
    const hoverCard = async (id) => {
      const p = await centre(`#board .card-el[data-id="${id}"] .card-title`);
      await mouse('mouseMoved', p.x, p.y, { button: 'none', clickCount: 0 });
      return waitFor(`hoveredId===${JSON.stringify(id)}`, 2000);
    };
    const closePalette = async () => { await key('Escape'); return waitFor(PAL_GONE, 2500); };
    const noteCount = (id) => ev(`(()=>{const b=document.querySelector('#board .card-el[data-id="${id}"] .card-notes');return b?b.textContent:null})()`);
    const focusedRow = () => ev(`!!document.activeElement&&document.activeElement.classList.contains('np-note')`);
    const rowTextFocused = () => ev(`document.activeElement.querySelector('.np-note-text').textContent`);
    const written = (target, text) => waitFor(`${NOTES}.some((n)=>n.target===${JSON.stringify(target)}&&n.note===${JSON.stringify(text)})`, 4000);

    // --- the board that keeps no logbook: nothing shows, and n says why -------------------------------------
    await open('/?view=board', 'plan');
    check('plan: the board is drawn', await boardReady());
    check('plan: the payload carries no logbook and no card wears a note count', await ev(`state.logbook===null&&document.querySelectorAll('.card-notes').length===0`));
    await key('n');
    check('plan: n says the logbook is off and builds no palette', await waitFor(`/logbook/.test(document.getElementById('toast').textContent)&&!document.getElementById('toast').classList.contains('hidden')`, 2500) && await ev(`!document.getElementById('notes-palette')`));
    await rightClick('#board .card-el[data-id="7"]');
    check('plan: the card menu has no Add note entry', await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500) && await ev(`document.getElementById('ctx-note').classList.contains('hidden')`));
    await key('Escape');

    // --- the count on a card opens its notes -----------------------------------------------------------------
    await open('/?view=board');
    check('notes: the board is drawn with its logbook', await boardReady() && await ev(`state.logbook&&state.logbook.notes.length===6`));
    check('notes: the cards with notes wear their count and no other does', await waitFor(`[...document.querySelectorAll('#board .card-notes')].map((b)=>b.closest('.card-el').dataset.id+':'+b.textContent).sort().join()==='22:1,3:1,7:3'`, 4000));
    const count = await centre('#board .card-el[data-id="7"] .card-notes');
    await click(count.x, count.y);
    check('notes: a click on the count opens the palette aimed at that card', await palUp() && await chip() === '#7 Port the zephyr schema', await chip());
    check('notes: its notes are listed newest day first', JSON.stringify(await ev(SECTIONS)) === JSON.stringify(['2026-10-15|7|2', '2026-10-14|7|1']), await ev(SECTIONS));
    await shot('palette-on-card');
    check('notes: each note shows its time, and an agent\'s its author', await ev(`${q('.np-ngroup .np-note')}.textContent.startsWith('09:30')&&[...document.querySelectorAll('#notes-palette .np-note-by')].map((b)=>b.textContent).filter(Boolean).join()==='@afk'&&document.querySelector('#notes-palette .np-note-time.untimed').textContent==='untimed'`));
    check('notes: with no time given the time field starts at now', await ev(`/^\\d\\d:\\d\\d$/.test(${q('.np-time')}.value)`));

    // --- the filter narrows the list and leaves the note box alone -------------------------------------------
    await setBox('half-typed note');
    await ev(`(()=>{const f=${q('.np-filter')};f.value='enum';f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    check('notes: the filter narrows the list to the notes that match', await waitFor(`${ROW_TEXTS}.length===1&&${ROW_TEXTS}[0].includes('enum renames')`, 2500), await ev(ROW_TEXTS));
    check('notes: and the note box keeps what was typed', await ev(BOX) === 'half-typed note');
    await ev(`(()=>{const f=${q('.np-filter')};f.value='';f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    check('notes: clearing the filter brings every note back', await waitFor(`${ROW_TEXTS}.length===3`, 2500));
    check('notes: Esc closes the palette', await closePalette());

    // --- n on the hovered card, the selected card, and on nothing -------------------------------------------
    check('notes: the pointer rests on card 22', await hoverCard('22'));
    await key('n');
    check('notes: n opens the palette on the hovered card', await palUp() && await chip() === '#22 Cut over the data layer', await chip());
    await closePalette();
    await ev(`document.body.focus()`);
    await mouse('mouseMoved', 5, 5, { button: 'none', clickCount: 0 });
    check('notes: the pointer leaves the cards', await waitFor(`hoveredId===null`, 2000));
    const three = await centre('#board .card-el[data-id="3"] .card-title');
    await click(three.x, three.y, { modifiers: 2 });
    check('notes: card 3 is the one selected card', await waitFor(`[...selectedIds].join()==='3'`, 2500));
    await mouse('mouseMoved', 5, 5, { button: 'none', clickCount: 0 });
    await key('n');
    check('notes: n opens the palette on the one selected card when none is hovered', await palUp() && await chip() === '#3 Write the cutover plan', await chip());
    await closePalette();

    // --- Enter writes at the time field's time and keeps the palette open ------------------------------------
    check('notes: the pointer rests on card 7', await hoverCard('7'));
    await key('n');
    check('notes: n aims the palette at card 7', await palUp() && await chip() === '#7 Port the zephyr schema', await chip());
    await setTime('09:45');
    await setBox('renamed order_state');
    check('notes: the preview line says what Enter will write', await preview() === 'Note at 09:45 on #7 Port the zephyr schema', await preview());
    await key('Enter');
    check('notes: Enter writes the note at the time field\'s time into the card\'s day file', await written('7', 'renamed order_state') && (await ev(notesOf('7'))).some((n) => n === `today|09:45|@human|renamed order_state`), await ev(notesOf('7')));
    check('notes: the palette stays open, the box is empty and the new note is listed first', await ev(`${PAL_UP}&&${BOX}===''`) && await waitFor(`${ROW_TEXTS}[0]==='renamed order_state'`, 3000), await ev(ROW_TEXTS));
    check('notes: the card\'s count went up', await waitFor(`document.querySelector('#board .card-el[data-id="7"] .card-notes').textContent==='4'`, 3000));

    // --- Shift+Enter starts a new line -----------------------------------------------------------------------
    await setBox('first line');
    await key('Enter', { shift: true });
    check('notes: Shift+Enter starts a new line and writes nothing', await ev(BOX) === 'first line\n' && await ev(`${NOTES}.length===7`), await ev(BOX));
    await setBox('first line\nsecond line');
    await key('Enter');
    check('notes: Enter then writes both lines as one note', await written('7', 'first line\nsecond line'));
    check('notes: and the list shows the note on two lines', await waitFor(`${ROW_TEXTS}.includes('first line\\nsecond line')`, 3000), await ev(ROW_TEXTS));

    // --- the line's own time, the untimed tick and a leading dash -------------------------------------------
    await setBox('10:30 line time wins');
    check('notes: a leading HH:MM beats the time field and is cut from the text', await preview() === 'Note at 10:30 on #7 Port the zephyr schema', await preview());
    await key('Enter');
    check('notes: it is written at 10:30 with the text after it', await written('7', 'line time wins') && (await ev(notesOf('7'))).includes('today|10:30|@human|line time wins'));
    await ev(`(()=>{const u=${q('.np-untimed')};u.checked=true;u.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await setBox('ticked untimed');
    check('notes: the untimed tick makes an untimed note and the preview says so', await preview() === 'Untimed note on #7 Port the zephyr schema' && await ev(`${q('.np-time')}.disabled`), await preview());
    await key('Enter');
    check('notes: it is written with no time', await written('7', 'ticked untimed') && (await ev(notesOf('7'))).includes('today||@human|ticked untimed'));
    await ev(`(()=>{const u=${q('.np-untimed')};u.checked=false;u.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await setBox('- dashed untimed');
    check('notes: a leading dash makes an untimed note too', await preview() === 'Untimed note on #7 Port the zephyr schema', await preview());
    await setBox('25:00 not a time');
    check('notes: a time that is not a time is said, not written', await preview() === '25:00 is not a time; a time reads HH:MM.', await preview());
    await key('Enter');
    check('notes: Enter on it writes nothing', await ev(`${NOTES}.length===10`) && await ev(`${BOX}!==''`));
    await setBox('blocked by #22');
    check('notes: a mention later in the text stays text, and the note stays on the chip\'s card', (await preview()).endsWith('on #7 Port the zephyr schema'), await preview());
    await setBox('');

    // --- a bare mention aims the palette; Backspace clears the chip -------------------------------------------
    await setBox('#22');
    check('notes: a bare #22 previews the move, not a note', await preview() === 'Open #22 Cut over the data layer, then type the note', await preview());
    await key('Enter');
    check('notes: Enter aims the palette at card 22 and writes nothing', await waitFor(`${CHIP}==='#22 Cut over the data layer'`, 2500) && await ev(`${BOX}===''&&${NOTES}.length===10`), await chip());
    check('notes: card 22\'s notes are listed', JSON.stringify(await ev(SECTIONS)) === JSON.stringify(['2026-10-15|22|1']), await ev(SECTIONS));
    await key('Backspace');
    check('notes: Backspace on the empty box clears the chip', await waitFor(`${CHIP}===''`, 2500), await chip());
    check('notes: with no chip the notes written today are listed and the card last noted is the target', await ev(`${PREVIEW}.includes('on #7 Port the zephyr schema (last noted)')`) && (await ev(SECTIONS))[0].startsWith(await ev(TODAY)), await preview());
    await setBox('#22 from the line');
    check('notes: a leading mention before the text aims that one note', await preview() === `Note at ${await ev(`${q('.np-time')}.value`)} on #22 Cut over the data layer`, await preview());
    await key('Enter');
    check('notes: it is written on card 22 with the mention cut from its text', await written('22', 'from the line'));

    // --- e, a and d d on a listed note --------------------------------------------------------------------------
    check('notes: Esc closes the palette', await closePalette());
    check('notes: the pointer rests on card 7 again', await hoverCard('7'));
    await key('n');
    check('notes: n reopens it on card 7', await palUp() && await chip() === '#7 Port the zephyr schema');
    await key('ArrowDown');
    check('notes: the down arrow moves into the list, onto its first note', await waitFor(`document.activeElement.classList.contains('np-note')`, 2000) && await rowTextFocused() === 'renamed order_state', await rowTextFocused());
    await ev(`(()=>{const rows=[...document.querySelectorAll('#notes-palette .np-note')];rows.find((r)=>r.querySelector('.np-note-text').textContent==='line time wins').focus()})()`);
    check('notes: a listed note takes focus', await focusedRow() && await rowTextFocused() === 'line time wins');
    await key('i');
    check('notes: i typed on a note goes to the note box, not to the board\'s isolate key', await waitFor(`${BOX}==='i'`, 2500) && await ev(`document.getElementById('search-input').value===''`), await ev(BOX));
    await setBox('');
    await ev(`[...document.querySelectorAll('#notes-palette .np-note')].find((r)=>r.querySelector('.np-note-text').textContent==='line time wins').focus()`);
    await key('e');
    await shot('before-edit');
    check('notes: e opens the note for editing, text and time', await waitFor(`!!${q('.np-edit-text')}&&${q('.np-edit-text')}.value==='line time wins'&&${q('.np-edit-time')}.value==='10:30'`, 2500));
    await ev(`(()=>{const x=${q('.np-edit-text')};x.value='line time lost';const t=${q('.np-edit-time')};t.value='11:05';x.focus()})()`);
    await key('Enter');
    check('notes: Enter saves the new text and the new time', await written('7', 'line time lost') && (await ev(notesOf('7'))).includes('today|11:05|@human|line time lost') && !(await ev(notesOf('7'))).some((n) => n.endsWith('|line time wins')), await ev(notesOf('7')));
    check('notes: the list shows the edited note and no form is left open', await waitFor(`${ROW_TEXTS}.includes('line time lost')&&!${q('.np-edit-text')}`, 3000));
    await ev(`[...document.querySelectorAll('#notes-palette .np-note')].find((r)=>r.querySelector('.np-note-text').textContent==='line time lost').focus()`);
    await key('a');
    await shot('assign-picker');
    check('notes: a opens the picker to move the note', await waitFor(`!!${q('.np-assign-input')}`, 2500));
    await ev(`(()=>{const i=${q('.np-assign-input')};i.value='cut over';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus()})()`);
    check('notes: the picker offers the cards that match what is typed', await waitFor(`[...document.querySelectorAll('#notes-palette .np-assign-item')].some((o)=>o.textContent==='#22 Cut over the data layer')`, 2500));
    await ev(`(()=>{const i=${q('.np-assign-input')};i.value='22 cut';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await key('Enter');
    check('notes: Enter moves the note to card 22, in the same day', await written('22', 'line time lost') && (await ev(notesOf('22'))).includes('today|11:05|@human|line time lost') && !(await ev(notesOf('7'))).some((n) => n.endsWith('|line time lost')), await ev(notesOf('22')));
    check('notes: it leaves card 7\'s list', await waitFor(`!${ROW_TEXTS}.includes('line time lost')`, 3000));
    await ev(`[...document.querySelectorAll('#notes-palette .np-note')].find((r)=>r.querySelector('.np-note-text').textContent==='ticked untimed').focus()`);
    const before = await ev(`${NOTES}.length`);
    await key('d');
    check('notes: the first d only asks', await ev(`${q('.np-act.sure')}.textContent==='Sure?'`) && await ev(`${NOTES}.length`) === before);
    await key('d');
    check('notes: the second d deletes the note', await waitFor(`${NOTES}.length===${before - 1}&&!${NOTES}.some((n)=>n.note==='ticked untimed')`, 4000));
    check('notes: and focus stays in the list', await waitFor(`${PAL_UP}&&${PAL}.contains(document.activeElement)`, 2500));
    await closePalette();

    // --- right-click Add note... -----------------------------------------------------------------------------
    await rightClick('#board .card-el[data-id="3"]');
    check('notes: the card menu has an Add note entry for one card', await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')&&!document.getElementById('ctx-note').classList.contains('hidden')`, 2500));
    await ev(`document.getElementById('ctx-note').click()`);
    check('notes: Add note opens the palette on that card and closes the menu', await palUp() && await chip() === '#3 Write the cutover plan' && await ev(`document.getElementById('context-menu').classList.contains('hidden')`), await chip());
    await ev(`document.activeElement.blur()`);
    check('notes: Esc closes the palette with focus outside it, and leaves the selection alone', await closePalette() && await ev(`[...selectedIds].join()==='3'`));

    // --- with nothing aimed at it, the palette starts on the card last noted, and remembers it across a reload --
    await open('/?view=board');
    check('notes: the board is drawn again', await boardReady());
    await mouse('mouseMoved', 5, 5, { button: 'none', clickCount: 0 });
    await ev(`document.body.focus()`);
    await key('n');
    check('notes: n with nothing hovered or selected opens on the card last noted, after a reload too', await palUp() && await chip() === '' && (await preview()).includes('on #22 Cut over the data layer (last noted)'), await preview());
    check('notes: the day\'s notes are listed when there is no chip', (await ev(SECTIONS)).length >= 1 && (await ev(SECTIONS)).every((s) => s.startsWith('20')));
  },
};
