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
// palette at that card and Backspace on the empty box clears the chip. Ctrl+F in an empty note box with no card aimed puts # there, and the id typed after it narrows the list to that card until the # is erased; with a draft in the box it leaves it alone. e, a and d d work on a
// listed note: edit its text and time, assign it to another card, delete it. Keys typed in the
// palette reach none of the board's own shortcuts, and Esc closes it from the filter field too. The
// subject row's date and card picker retarget the note (a note written to another day lands in that
// day's file), and the range row limits the list to a day, 3 days, a week or a month: a card opens
// on All and still lists its notes from several days.
// e with a card's details open opens its edit form with the focus in the title, and the palette over the details keeps its e, on a note row too. Esc and Ctrl+S in that form return to the details; a New card form closes to the board.
// With no logbook line nothing shows and n says why. Each step waits on the page, never on a fixed
// sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// state, selectedIds, hoveredId, noteClock, toast (the page's #toast element, by its id).

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
    // Esc clears a card chip before it closes the palette: press it until the palette is gone.
    const closePalette = async () => {
      for (let i = 0; i < 3; i++) {
        await key('Escape');
        if (await waitFor(PAL_GONE, i < 2 ? 700 : 2500)) return true;
      }
      return false;
    };
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
    check('notes: each note shows its time and its author, the human\'s too', await ev(`${q('.np-ngroup .np-note')}.textContent.startsWith('09:30')&&[...document.querySelectorAll('#notes-palette .np-note-by')].map((b)=>b.textContent).join()==='@human,@afk,@human'&&document.querySelector('#notes-palette .np-note-time.untimed').textContent==='untimed'`));
    check('notes: with no time given the time field starts on Now', await ev(`${q('.np-time')}.value`) === 'Now');

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

    // --- the author switch and by:@handle narrow the list; a note written here stays ---------------------------
    const BY_BTNS = `[...document.querySelectorAll('#notes-palette .np-by-btn[data-by]')].map((b)=>b.textContent+(b.getAttribute('aria-pressed')==='true'?'*':''))`;
    const setFilter = (text) => ev(`(()=>{const f=${q('.np-filter')};f.value=${JSON.stringify(text)};f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const pickBy = async (by) => { const p = await centre(`#notes-palette .np-by-btn[data-by="${by}"]`); await click(p.x, p.y); };
    const isRows = (texts, ms) => waitFor(`JSON.stringify(${ROW_TEXTS}.slice().sort())===${JSON.stringify(JSON.stringify(texts.slice().sort()))}`, ms || 2500);
    check('notes: the filter row holds an All, Human and AI switch, All pressed', JSON.stringify(await ev(BY_BTNS)) === JSON.stringify(['All*', 'Human', 'AI']), await ev(BY_BTNS));
    await pickBy('ai');
    check('notes: AI lists the notes of the other authors, and the note written here stays', await isRows(['schema diff reviewed, two enum renames left', 'renamed order_state']), await ev(ROW_TEXTS));
    await shot('palette-author-switch');
    check('notes: the pressed button follows', JSON.stringify(await ev(BY_BTNS)) === JSON.stringify(['All', 'Human', 'AI*']), await ev(BY_BTNS));
    await pickBy('human');
    check('notes: Human lists only the human authors\' notes', await waitFor(`${ROW_TEXTS}.length===3&&!${ROW_TEXTS}.some((t)=>t.includes('enum renames'))`, 2500), await ev(ROW_TEXTS));
    await pickBy('all');
    check('notes: All lists every note again', await waitFor(`${ROW_TEXTS}.length===4`, 2500));
    await setFilter('by:@afk');
    check('notes: by:@afk narrows to that handle, and the note written here stays', await isRows(['schema diff reviewed, two enum renames left', 'renamed order_state']), await ev(ROW_TEXTS));
    await setFilter('by:@afk nomatchword');
    check('notes: by:@afk with another filter word narrows by both, the fresh note still listed', await isRows(['renamed order_state']), await ev(ROW_TEXTS));
    await pickBy('human');
    await setFilter('by:@afk');
    check('notes: by:@afk with the Human switch lists no matching note, only the fresh one', await isRows(['renamed order_state']), await ev(ROW_TEXTS));
    await pickBy('all');
    await setFilter('');
    check('notes: the switch back on All with an empty filter lists every note', await waitFor(`${ROW_TEXTS}.length===4`, 2500));
    await ev(`${q('.np-input')}.focus()`);

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
    check('notes: a leading mention before the text aims that one note', /^Note at \d\d:\d\d on #22 Cut over the data layer$/.test(await preview()), await preview());
    await key('Enter');
    check('notes: it is written on card 22 with the mention cut from its text', await written('22', 'from the line'));

    // --- Ctrl+F in an empty note box with no card aimed puts # there, and an id narrows the list ---------------
    const TARGETS = `[...new Set([...document.querySelectorAll('#notes-palette .np-ngroup')].map((g)=>g.dataset.target))].sort().join()`;
    const BOX_CARET = `${q('.np-input')}.selectionStart+','+${q('.np-input')}.selectionEnd`;
    check('notes: with no card aimed the list holds the notes of cards 22 and 7', await waitFor(`${TARGETS}==='22,7'&&${CHIP}===''&&${BOX}===''`, 3000), await ev(TARGETS));
    await key('f', { ctrl: true });
    check('notes: Ctrl+F puts # in the empty note box with the caret after it and the list unchanged', await waitFor(`${BOX}==='#'&&${BOX_CARET}==='1,1'`, 2500) && await ev(TARGETS) === '22,7', await ev(BOX));
    await key('2');
    await key('2');
    check('notes: typing 22 narrows the list to card 22, as it is typed', await waitFor(`${BOX}==='#22'&&${TARGETS}==='22'`, 2500), await ev(TARGETS));
    check('notes: the filter field is left alone', await ev(`${q('.np-filter')}.value===''`));
    await key('Backspace');
    await key('Backspace');
    await key('Backspace');
    check('notes: erasing the # puts the whole list back', await waitFor(`${BOX}===''&&${TARGETS}==='22,7'`, 2500), await ev(TARGETS));
    await key('f', { ctrl: true });
    await key('2');
    await key('2');
    await key('Enter');
    check('notes: Enter on # and an id aims the palette at that card', await waitFor(`${CHIP}==='#22 Cut over the data layer'&&${BOX}===''`, 2500), await chip());
    await key('Backspace');
    check('notes: Backspace on the empty box clears the chip again', await waitFor(`${CHIP}===''`, 2500));
    await setBox('a draft');
    await key('f', { ctrl: true });
    check('notes: with a draft in the box Ctrl+F leaves the draft untouched', await ev(`${BOX}==='a draft'&&${TARGETS}==='22,7'`), await ev(BOX));
    await setBox('');

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
    check('notes: i typed on a note goes to the note box, not to the board\'s isolate key', await waitFor(`${BOX}==='i'`, 2500) && await ev(`!/i$/.test(document.getElementById('search-input').value)&&document.getElementById('isolate-switch').getAttribute('aria-checked')==='false'`), await ev(BOX));
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
    await closePalette();

    // --- Now is worked out when Enter is pressed, and a time the person typed stays -----------------------------
    await ev(`noteClock=()=>'10:11'`);
    check('notes: the pointer rests on card 7 again', await hoverCard('7'));
    await key('n');
    check('notes: the time field opens on Now', await palUp() && await ev(`${q('.np-time')}.value`) === 'Now');
    await ev(`noteClock=()=>'10:12'`);
    await setBox('followed the clock');
    check('notes: the preview says the time of now', await preview() === 'Note at 10:12 on #7 Port the zephyr schema', await preview());
    await key('Enter');
    check('notes: the note is written at the time of Enter, not the time the palette opened', await written('7', 'followed the clock') && (await ev(notesOf('7'))).includes('today|10:12|@human|followed the clock'), await ev(notesOf('7')));
    check('notes: and the field is still on Now after the write', await ev(`${q('.np-time')}.value`) === 'Now', await ev(`${q('.np-time')}.value`));
    await setTime('08:05');
    await ev(`noteClock=()=>'10:13'`);
    await setBox('typed a time');
    await key('Enter');
    check('notes: a note is written at the typed time', await written('7', 'typed a time') && (await ev(notesOf('7'))).includes('today|08:05|@human|typed a time'), await ev(notesOf('7')));
    check('notes: and a time the person typed stays after the write', await ev(`${q('.np-time')}.value`) === '08:05');

    // --- the Grouped | Timeline switch -------------------------------------------------------------------------
    const LAYOUT_BTNS = `[...document.querySelectorAll('#notes-palette .np-layout-slot .np-by-btn')].map((b)=>b.textContent+(b.getAttribute('aria-pressed')==='true'?'*':''))`;
    const pickLayout = async (layout) => { const p = await centre(`#notes-palette .np-by-btn[data-layout="${layout}"]`); await click(p.x, p.y); };
    check('notes: the filter row holds a Grouped and Timeline switch, Grouped pressed', JSON.stringify(await ev(LAYOUT_BTNS)) === JSON.stringify(['Grouped*', 'Timeline']), await ev(LAYOUT_BTNS));
    const rowsBefore = await ev(ROW_TEXTS);
    await pickLayout('timeline');
    check('notes: Timeline presses its button and lists the same notes', await waitFor(`JSON.stringify(${LAYOUT_BTNS})===${JSON.stringify(JSON.stringify(['Grouped', 'Timeline*']))}`, 2500) && (await ev(ROW_TEXTS)).length === rowsBefore.length, await ev(LAYOUT_BTNS));
    await shot('palette-timeline');
    check('notes: it is a flat list, one block per day, newest day first', await ev(`(()=>{const g=[...document.querySelectorAll('#notes-palette .np-ngroup')];const days=g.map((x)=>x.dataset.day);return g.length>=2&&g.every((x)=>x.classList.contains('np-tgroup'))&&days.every((d,i)=>i===0||days[i-1]>d)})()`));
    check('notes: inside a day the timed notes come in time order and the untimed ones last', await ev(`[...document.querySelectorAll('#notes-palette .np-tgroup')].every((g)=>{const t=[...g.querySelectorAll('.np-note-time')].map((e)=>e.classList.contains('untimed')?'99:99':e.textContent);return t.every((v,i)=>i===0||t[i-1]<=v)})`));
    check('notes: every row names its card', await ev(`[...document.querySelectorAll('#notes-palette .np-note')].every((r)=>r.querySelector('.np-note-card').textContent==='#7 Port the zephyr schema')`));
    await ev(`${q('.np-input')}.focus()`);
    await key('ArrowDown');
    check('notes: the down arrow still moves from the note box into the list', await waitFor(`document.activeElement.classList.contains('np-note')`, 2000));
    await ev(`(()=>{const f=${q('.np-filter')};f.value='enum';f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    check('notes: the filter narrows the flat list too', await waitFor(`${ROW_TEXTS}.includes('schema diff reviewed, two enum renames left')&&${ROW_TEXTS}.length<${rowsBefore.length}`, 2500), await ev(ROW_TEXTS)); // the notes written in this palette stay listed, as they do past any filter
    await ev(`${q('.np-filter')}.focus()`);
    check('notes: the filter field has the focus and holds its text', await ev(`document.activeElement===${q('.np-filter')}&&${q('.np-filter')}.value==='enum'`));
    check('notes: Esc in the filter field closes the palette at once, text and all', await closePalette());
    await open('/?view=board');
    check('notes: the board is drawn again after a reload', await boardReady());
    check('notes: the pointer rests on card 7 once more', await hoverCard('7'));
    await key('n');
    check('notes: the board remembers Timeline across a reload', await palUp() && JSON.stringify(await ev(LAYOUT_BTNS)) === JSON.stringify(['Grouped', 'Timeline*']), await ev(LAYOUT_BTNS));
    await pickLayout('grouped');
    check('notes: Grouped brings the sections back', await waitFor(`document.querySelectorAll('#notes-palette .np-tgroup').length===0&&document.querySelectorAll('#notes-palette .np-ngroup').length>=2`, 2500));
    await closePalette();

    // --- the card picker, the date and the range ---------------------------------------------------------------------
    const PICK = q('.np-pick-input');
    const DATE = q('.np-date');
    const PICK_MENU = `[...document.querySelectorAll('.np-pick-menu .combobox-item')].map((e)=>e.textContent)`;
    const RANGE_BTNS = `[...document.querySelectorAll('#notes-palette .np-range-slot .np-by-btn')].map((b)=>b.textContent+(b.getAttribute('aria-pressed')==='true'?'*':''))`;
    const RANGE_LABEL = `document.querySelector('#notes-palette .np-range-label').textContent`;
    const DAYS = `[...document.querySelectorAll('#notes-palette .np-ngroup')].map((g)=>g.dataset.day)`;
    const pickRange = async (mode) => { const p = await centre(`#notes-palette .np-range-slot .np-by-btn[data-range="${mode}"]`); await click(p.x, p.y); };
    const stepRange = async (dir) => { const p = await centre(`#notes-palette .np-range-step[data-step="${dir}"]`); await click(p.x, p.y); };
    const chooseCard = async (text) => {
      // A screenshot or any lost focus shuts the menu (the combobox closes on blur), and a focus that was never lost opens nothing: blur, then focus, and wait for the row to be drawn.
      await ev(`${PICK}.blur();${PICK}.focus()`);
      if (!(await waitFor(`[...document.querySelectorAll('.np-pick-menu .combobox-item')].some((x)=>x.textContent===${JSON.stringify(text)}&&x.getBoundingClientRect().width>0)`, 2500))) return false;
      const at = await ev(`(()=>{const e=[...document.querySelectorAll('.np-pick-menu .combobox-item')].find((x)=>x.textContent===${JSON.stringify(text)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      await mouse('mouseMoved', at.x, at.y, { button: 'none', clickCount: 0 });
      await click(at.x, at.y);
      return true;
    };
    check('notes: the pointer rests on card 7 for the picker', await hoverCard('7'));
    await key('n');
    check('notes: n opens the palette on card 7', await palUp() && await chip() === '#7 Port the zephyr schema', await chip());
    check('notes: a card opens on All, so its notes from several days are all listed', JSON.stringify(await ev(RANGE_BTNS)) === JSON.stringify(['All*', 'Month', 'Week', '3 days', 'Day']) && (await ev(DAYS)).includes('2026-10-15') && (await ev(DAYS)).includes('2026-10-14'), JSON.stringify(await ev(DAYS)));
    check('notes: the date starts on Today, beside the time', await ev(`${DATE}.value`) === 'Today');
    check('notes: the picker names the card', await ev(`${PICK}.value`) === '#7 Port the zephyr schema');
    await setBox('kept text');
    check('notes: the picker\'s menu lists no card first and then the cards', await (async () => { await ev(`${PICK}.focus()`); return waitFor(`${PICK_MENU}[0]==='no card'&&${PICK_MENU}.includes('#22 Cut over the data layer')&&${PICK_MENU}.includes('#7 Port the zephyr schema')`, 2500); })(), JSON.stringify(await ev(PICK_MENU)));
    await shot('card-picker');
    check('notes: choosing #22 aims the palette at it, as a bare #22 and Enter does', await chooseCard('#22 Cut over the data layer') && await waitFor(`${CHIP}==='#22 Cut over the data layer'`, 2500), await chip());
    check('notes: the picker names the new card, the note box keeps what was typed, and card 22\'s notes are listed', await ev(`${PICK}.value`) === '#22 Cut over the data layer' && await ev(BOX) === 'kept text' && (await ev(SECTIONS)).includes('2026-10-15|22|1') && (await ev(SECTIONS)).every((g) => g.split('|')[1] === '22'), JSON.stringify(await ev(SECTIONS)));
    check('notes: and the preview line says the card', (await preview()).endsWith('on #22 Cut over the data layer'), await preview());
    await setBox('#7 the line wins');
    check('notes: a #7 typed at the start of the note wins over the picker, and the preview says so', (await preview()).endsWith('on #7 Port the zephyr schema'), await preview());
    await setBox('kept text');
    await ev(`(()=>{const f=${PICK};f.focus();f.value='3';f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await key('Enter');
    check('notes: a card id typed in the picker aims the palette on Enter, as a choice from its menu does', await waitFor(`${CHIP}==='#3 Write the cutover plan'`, 2500) && await ev(BOX) === 'kept text', await chip());
    check('notes: choosing no card makes the note about nothing', await chooseCard('no card') && await waitFor(`${PICK}.value==='no card'`, 2500) && (await preview()).endsWith('on no card'), await preview());
    await setBox('');
    await ev(`(()=>{const d=${DATE};d.value='2026-10-12';d.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await setBox('written to another day');
    check('notes: the preview names the day when it is not today', (await preview()).includes('Mon 12'), await preview());
    await key('Enter');
    check('notes: Enter writes the note to the day in the date field, in that day\'s file', await waitFor(`${NOTES}.some((n)=>n.day==='2026-10-12'&&n.target===''&&n.note==='written to another day'&&/2026\\.10\\.12/.test(n.file))`, 4000), JSON.stringify(await ev(`${NOTES}.filter((n)=>n.note==='written to another day')`)));
    check('notes: the date stays for the next note', await ev(`${DATE}.value`) === '2026-10-12');
    await ev(`(()=>{const u=${q('.np-untimed')};u.checked=true;u.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await setBox('no time on the same day');
    await key('Enter');
    check('notes: the untimed tick drops the time and keeps that day', await waitFor(`${NOTES}.some((n)=>n.day==='2026-10-12'&&!n.at&&n.note==='no time on the same day')`, 4000));
    check('notes: Esc closes the palette', await closePalette());
    await ev(`openNotes({ kind: 'card-notes', id: '7', day: '2026-10-15' })`);
    check('notes: card 7 again, on All', await palUp() && JSON.stringify(await ev(RANGE_BTNS)) === JSON.stringify(['All*', 'Month', 'Week', '3 days', 'Day']) && await ev(RANGE_LABEL) === 'All dates');
    check('notes: with All the previous and next buttons are off', await ev(`[...document.querySelectorAll('#notes-palette .np-range-step')].every((b)=>b.disabled)`));
    await pickRange('week');
    check('notes: Week lists that card\'s notes from 12 to 18 October only', await waitFor(`${RANGE_LABEL}==='12–18 Oct'`, 2500) && JSON.stringify(await ev(DAYS)) === JSON.stringify(['2026-10-15', '2026-10-14']), JSON.stringify(await ev(DAYS)));
    await shot('palette-range-week');
    await pickRange('day');
    check('notes: Day lists the notes of 15 October', await waitFor(`${RANGE_LABEL}==='Thu 15 Oct'`, 2500) && JSON.stringify(await ev(DAYS)) === JSON.stringify(['2026-10-15']), JSON.stringify(await ev(DAYS)));
    await stepRange(-1);
    check('notes: the previous button steps to 14 October', await waitFor(`${RANGE_LABEL}==='Wed 14 Oct'`, 2500) && JSON.stringify(await ev(DAYS)) === JSON.stringify(['2026-10-14']), JSON.stringify(await ev(DAYS)));
    await stepRange(1);
    await stepRange(1);
    check('notes: the next button reaches a day with no note, and the list says so', await waitFor(`${RANGE_LABEL}==='Fri 16 Oct'`, 2500) && await ev(`!!document.querySelector('#notes-palette .np-empty')&&/No notes in Fri 16 Oct yet\\./.test(document.querySelector('#notes-palette .np-empty').textContent)`));
    await pickRange('all');
    check('notes: All brings every day back', await waitFor(`${DAYS}.includes('2026-10-14')&&${DAYS}.includes('2026-10-15')`, 2500));
    check('notes: Esc closes the palette', await closePalette());
    await ev(`openNotes({ kind: 'card-notes', id: '7' })`);
    check('notes: the range is set again each time the palette opens: All', await palUp() && JSON.stringify(await ev(RANGE_BTNS)) === JSON.stringify(['All*', 'Month', 'Week', '3 days', 'Day']));
    check('notes: Esc closes the palette', await closePalette());

    // --- the note boxes grow with their text -----------------------------------------------------------------------
    const BOX_H = `${q('.np-input')}.getBoundingClientRect().height`;
    const CAP = `Math.min(innerHeight*0.4, 12*parseFloat(getComputedStyle(${q('.np-input')}).lineHeight)+parseFloat(getComputedStyle(${q('.np-input')}).paddingTop)+parseFloat(getComputedStyle(${q('.np-input')}).paddingBottom)+2)`;
    const heightIs = (cmp, ms) => waitFor(cmp, ms || 2500);
    check('notes: the pointer rests on card 7 for the next palette', await hoverCard('7'));
    await key('n');
    check('notes: n opens the palette on card 7', await palUp() && await chip() === '#7 Port the zephyr schema', await chip());
    await setBox('');
    const oneLine = await ev(BOX_H);
    check('notes: the note box starts one line high', oneLine > 20 && oneLine < 50, String(oneLine));
    check('notes: and has no resize grip', await ev(`getComputedStyle(${q('.np-input')}).resize`) === 'none');
    await setBox('one\ntwo\nthree\nfour\nfive');
    check('notes: five typed lines make it about five lines high', await heightIs(`${BOX_H}>${oneLine}*3`), String(await ev(BOX_H)));
    await setBox('x'.repeat(400));
    check('notes: a long line that wraps grows it too', await heightIs(`${BOX_H}>${oneLine}*2`), String(await ev(BOX_H)));
    await setBox('line\n'.repeat(60));
    check('notes: past the cap (12 lines or 40% of the window) it stops growing and scrolls inside', await heightIs(`${BOX_H}<=${CAP}+1`) && await ev(`${q('.np-input')}.scrollHeight>${q('.np-input')}.clientHeight`), String(await ev(BOX_H)));
    await setBox('one\ntwo');
    check('notes: deleting text shrinks it again', await heightIs(`${BOX_H}<${oneLine}*3&&${BOX_H}>${oneLine}*1.5`), String(await ev(BOX_H)));
    await setBox('');
    check('notes: and an empty box is one line again', await heightIs(`Math.abs(${BOX_H}-${oneLine})<1`), String(await ev(BOX_H)));
    await ev(`[...document.querySelectorAll('#notes-palette .np-note')].find((r)=>r.querySelector('.np-note-text').textContent==='first line\\nsecond line').focus()`);
    await key('e');
    const EDIT_H = `${q('.np-edit-text')}.getBoundingClientRect().height`;
    const editText = (text) => ev(`(()=>{const x=${q('.np-edit-text')};x.value=${JSON.stringify(text)};x.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    check('notes: e opens the two-line note for editing', await waitFor(`!!${q('.np-edit-text')}&&${q('.np-edit-text')}.value==='first line\\nsecond line'`, 2500));
    const twoLines = await ev(EDIT_H);
    check('notes: the edit box is sized to its two lines at once, with no resize grip', twoLines > 30 && await ev(`getComputedStyle(${q('.np-edit-text')}).resize`) === 'none', String(twoLines));
    await editText('line\n'.repeat(60));
    check('notes: the edit box stops at the cap and scrolls inside', await waitFor(`${EDIT_H}>${twoLines}&&${EDIT_H}<=innerHeight*0.4+1&&${q('.np-edit-text')}.scrollHeight>${q('.np-edit-text')}.clientHeight`, 2500), String(await ev(EDIT_H)));
    await editText('short');
    check('notes: and shrinks below two lines when the text does', await waitFor(`${EDIT_H}<${twoLines}-5`, 2500), String(await ev(EDIT_H)));
    await key('Escape');
    check('notes: Esc cancels the edit and leaves the palette up', await waitFor(`!${q('.np-edit-text')}`, 2500) && await ev(PAL_UP));
    await closePalette();

    // --- Esc clears the card chip before it closes the palette -------------------------------------------------------
    const ESC_HINT = `[...document.querySelectorAll('#notes-palette .np-foot kbd')].find((k)=>k.textContent==='Esc').parentElement.textContent.replace('Esc','').trim()`;
    await ev(`openNotes({ kind: 'card-notes', id: '7' })`);
    check('notes: a palette aimed at a card says Esc clears the chip', await palUp() && await chip() === '#7 Port the zephyr schema' && await ev(ESC_HINT) === 'clear the chip', await ev(ESC_HINT));
    await key('Escape');
    check('notes: Esc clears the chip, exactly as the backspace does, and the palette stays up on Day, today', await waitFor(`${CHIP}===''`, 2500) && await ev(PAL_UP) && JSON.stringify(await ev(RANGE_BTNS)) === JSON.stringify(['All', 'Month', 'Week', '3 days', 'Day*']), JSON.stringify(await ev(RANGE_BTNS)));
    check('notes: with no chip the footer says Esc closes', await ev(ESC_HINT) === 'close', await ev(ESC_HINT));
    await key('Escape');
    check('notes: the next Esc closes the palette', await waitFor(PAL_GONE, 2500));
    await ev(`openNotes({ kind: 'card-notes', id: '7' })`);
    await ev(`${q('.np-filter')}.focus()`);
    await key('Escape');
    check('notes: Esc in the filter field closes the palette at once, chip and all', await waitFor(PAL_GONE, 2500));

    // --- Tab and the Markdown keys in the note box ---------------------------------------------------------------
    const IN_BOX = `document.activeElement===${q('.np-input')}`;
    check('notes: the pointer rests on card 7 for the next palette', await hoverCard('7'));
    await key('n');
    check('notes: n opens the palette on card 7', await palUp() && await chip() === '#7 Port the zephyr schema', await chip());
    await setBox('word');
    await ev(`${q('.np-input')}.setSelectionRange(0,4)`);
    await key('b', { ctrl: true });
    check('notes: Ctrl+B wraps the selected word in the note box, and keeps it selected', await waitFor(`${BOX}==='**word**'&&${q('.np-input')}.selectionStart===2&&${q('.np-input')}.selectionEnd===6`, 2500), await ev(BOX));
    check('notes: the box still has the focus, and the preview line follows the new text', await ev(IN_BOX) && (await preview()).includes('on #7'));
    await key('b', { ctrl: true });
    check('notes: Ctrl+B on the wrapped word takes the stars off again', await waitFor(`${BOX}==='word'`, 2500), await ev(BOX));
    await setBox('');
    await key('Tab');
    check('notes: Tab in the note box indents two spaces and focus stays in the box', await waitFor(`${BOX}==='  '`, 2500) && await ev(IN_BOX), await ev(BOX));
    await key('Tab', { shift: true });
    check('notes: Shift+Tab takes them off again', await waitFor(`${BOX}===''`, 2500) && await ev(IN_BOX), await ev(BOX));
    await key('m', { ctrl: true });
    check('notes: Ctrl+M switches Tab to moving focus, and a hint says so', await waitFor(`!!document.getElementById('text-edit-hint')&&!document.getElementById('text-edit-hint').hidden`, 2500));
    await key('Tab');
    check('notes: Tab then leaves the note box, and the box is as it was', await waitFor(`!(${IN_BOX})`, 2500) && await ev(BOX) === '');
    await ev(`${q('.np-input')}.focus()`);
    await key('m', { ctrl: true });
    await key('Tab');
    check('notes: Ctrl+M again and Tab indents', await waitFor(`${BOX}==='  '`, 2500) && await ev(IN_BOX), await ev(BOX));
    await setBox('');
    await closePalette();

    // --- n with the card details open notes that card ----------------------------------------------------------
    const DETAIL_UP = `!document.getElementById('detail-modal').classList.contains('hidden')`;
    const DETAIL_SHUT = `document.getElementById('detail-modal').classList.contains('hidden')`;
    const title7 = await centre('#board .card-el[data-id="7"] .card-title');
    await click(title7.x, title7.y);
    check('notes: a click on card 7 opens its details', await waitFor(`${DETAIL_UP}&&document.getElementById('detail-title').textContent.startsWith('#7')`, 4000));
    await ev(`(()=>{hoveredId='22';if(document.activeElement)document.activeElement.blur()})()`);
    await key('n');
    check('notes: n with the details open opens the palette on the open card, whatever is hovered behind them', await palUp() && await chip() === '#7 Port the zephyr schema', await chip());
    check('notes: the palette draws above the details', await ev(`(()=>{const r=${PAL}.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+12);return !!e&&${PAL}.contains(e)})()`));
    await key('Escape');
    check('notes: the first Esc clears the card chip and leaves the palette and the details up', await waitFor(`${CHIP}===''`, 2500) && await ev(PAL_UP) && await ev(DETAIL_UP), await chip());
    await key('Escape');
    check('notes: the next Esc closes the palette and leaves the details open', await waitFor(PAL_GONE, 2500) && await ev(DETAIL_UP));
    await key('Escape');
    check('notes: the one after that closes the details, as it does today', await waitFor(DETAIL_SHUT, 2500));

    // --- e with the card details open edits that card; the palette over them keeps its e ------------------------
    const FORM_UP = `!document.getElementById('modal').classList.contains('hidden')`;
    const FORM_SHUT = `document.getElementById('modal').classList.contains('hidden')`;
    await click(title7.x, title7.y);
    check('notes: card 7\'s details open again', await waitFor(`${DETAIL_UP}&&document.getElementById('detail-title').textContent.startsWith('#7')`, 4000));
    check('notes: the details\' Edit button names the key', await ev(`document.getElementById('detail-edit-btn').title==='Edit card fields (e)'`));
    await ev(`(()=>{if(document.activeElement)document.activeElement.blur()})()`);
    await key('n');
    check('notes: n opens the palette over the details', await palUp() && await chip() === '#7 Port the zephyr schema', await chip());
    await key('e');
    check('notes: e in the palette\'s box types an e: it neither edits the card nor leaves the palette', await waitFor(`${BOX}==='e'`, 2500) && await ev(FORM_SHUT) && await ev(DETAIL_UP) && await ev(PAL_UP), await ev(BOX));
    await setBox('');
    await key('ArrowDown');
    check('notes: the down arrow moves onto a note of card 7, with the details still behind', await waitFor(`document.activeElement.classList.contains('np-note')`, 2000) && await ev(DETAIL_UP));
    await key('e');
    check('notes: e on a note row edits the note and does not open the edit form of the card', await waitFor(`!!${q('.np-edit-text')}`, 2500) && await ev(FORM_SHUT) && await ev(DETAIL_UP) && await ev(PAL_UP));
    await key('Escape');
    check('notes: Esc leaves the note edit and the palette stays up over the details', await waitFor(`!${q('.np-edit-text')}`, 2500) && await ev(PAL_UP) && await ev(DETAIL_UP));
    await key('Escape');
    await key('Escape');
    check('notes: the palette closes and leaves the details up', await waitFor(PAL_GONE, 2500) && await ev(DETAIL_UP));
    await ev(`(()=>{if(document.activeElement)document.activeElement.blur()})()`);
    await key('e');
    check('notes: e then opens the card\'s edit form and puts the details away', await waitFor(`${FORM_UP}&&${DETAIL_SHUT}&&document.getElementById('modal-title').textContent==='Edit #7'`, 3000), await ev(`document.getElementById('modal-title').textContent`));
    check('notes: the title field of the form has the focus and the key typed nothing in it', await ev(`document.activeElement===document.getElementById('f-title')&&document.getElementById('f-title').value==='Port the zephyr schema'`), await ev(`document.activeElement.id+'|'+document.getElementById('f-title').value`));
    const DETAIL_FOCUSED = `document.activeElement===document.querySelector('#detail-modal .modal')`;
    const ON_CARD_7 = `(new URLSearchParams(location.search).get('card')==='7')`;
    await key('Escape');
    check('notes: Esc leaves the edit form and returns to the details of card 7, with the focus on them and the address still naming the card', await waitFor(`${FORM_SHUT}&&${DETAIL_UP}&&${DETAIL_FOCUSED}&&${ON_CARD_7}&&document.getElementById('detail-title').textContent.startsWith('#7')`, 3000), await ev(`location.search+'|'+document.activeElement.className`));
    await key('e');
    check('notes: e opens the form again from the returned details', await waitFor(`${FORM_UP}&&${DETAIL_SHUT}`, 3000));
    await ev(`(()=>{const t=document.getElementById('f-title');t.value='Port the zephyr schema, reviewed';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await key('s', { ctrl: true });
    check('notes: Ctrl+S saves and returns to the details, showing what was saved, with the card still open', await waitFor(`${FORM_SHUT}&&${DETAIL_UP}&&${DETAIL_FOCUSED}&&${ON_CARD_7}&&document.getElementById('detail-title').textContent==='#7 Port the zephyr schema, reviewed'`, 5000), await ev(`document.getElementById('detail-title').textContent`));
    await key('Escape');
    check('notes: Esc on the returned details closes the card, as it does today', await waitFor(`${DETAIL_SHUT}&&!${ON_CARD_7}`, 3000), await ev('location.search'));
    await ev(`document.getElementById('new-btn').click()`);
    check('notes: New card opens a form that comes from no details', await waitFor(`${FORM_UP}&&${DETAIL_SHUT}`, 3000));
    await key('Escape');
    check('notes: Esc on it closes it and shows no details', await waitFor(FORM_SHUT, 2500) && await ev(DETAIL_SHUT));

    // --- the palette goes full screen, as the card details do ----------------------------------------------------
    const FS_BTN = `document.getElementById('notes-fullscreen-btn')`;
    const FS_ON = `${PAL}.classList.contains('fullscreen')`;
    const FILLS = `(()=>{const r=${PAL}.getBoundingClientRect();return r.left===0&&r.top===0&&Math.round(r.width)===window.innerWidth&&Math.round(r.height)===window.innerHeight})()`;
    await ev(`openNotes({ kind: 'card-notes', id: '7' })`);
    check('notes: the palette header has the full screen button, expanded to begin with', await palUp() && await ev(`${FS_BTN}.title==='Expand to full screen'&&${FS_BTN}.getAttribute('aria-pressed')==='false'&&!(${FS_ON})`));
    const fsBtn = await centre('#notes-fullscreen-btn');
    await click(fsBtn.x, fsBtn.y);
    check('notes: the button fills the window with the palette and turns into Exit full screen', await waitFor(`${FS_ON}&&${FS_BTN}.title==='Exit full screen'&&${FS_BTN}.getAttribute('aria-pressed')==='true'`, 2500) && await ev(FILLS));
    check('notes: the list takes the height the bars leave, down to the footer', await ev(`(()=>{const b=${q('.np-body')}.getBoundingClientRect();const f=${q('.np-foot')}.getBoundingClientRect();return Math.abs(b.bottom-f.top)<=1&&b.height>200})()`));
    check('notes: the choice is kept for the board', await ev(`JSON.parse(localStorage.getItem('kanban.'+state.projectName+'.modal.fullscreen')).notes===true`));
    await shot('palette-fullscreen');
    await setBox('kept');
    const noteTotal = await ev(`${NOTES}.length`);
    await key('Enter', { alt: true });
    check('notes: Alt+Enter in the note box leaves full screen, writes no note and keeps the box and its focus', await waitFor(`!(${FS_ON})`, 2500) && await ev(BOX) === 'kept' && await ev(`document.activeElement===${q('.np-input')}`) && await ev(`${NOTES}.length===${noteTotal}`));
    await key('Enter', { alt: true });
    check('notes: Alt+Enter again goes full screen', await waitFor(`${FS_ON}`, 2500) && await ev(FILLS));
    await closePalette();
    await ev(`openNotes({ kind: 'card-notes', id: '22' })`);
    check('notes: a palette opened again opens full screen', await palUp() && await ev(`${FS_ON}&&${FS_BTN}.getAttribute('aria-pressed')==='true'`));
    await key('Escape');
    check('notes: Esc behaves as it did on a full screen palette', await waitFor(`${CHIP}===''`, 2500) && await ev(PAL_UP));
    await closePalette();
    const title3 = await centre('#board .card-el[data-id="3"] .card-title');
    await click(title3.x, title3.y);
    check('notes: card 3 opens its details', await waitFor(`${DETAIL_UP}&&document.getElementById('detail-title').textContent.startsWith('#3')`, 4000));
    await ev(`document.activeElement&&document.activeElement.blur()`);
    await key('n');
    check('notes: n over the details opens the full screen palette', await palUp() && await ev(FS_ON));
    await key('Enter', { alt: true });
    check('notes: Alt+Enter over the details toggles the palette and leaves the details as they were', await waitFor(`!(${FS_ON})`, 2500) && await ev(`!document.querySelector('#detail-modal .modal').classList.contains('fullscreen')`));
    await key('Escape');
    await key('Escape');
    await key('Escape');
    check('notes: Esc closes the chip, the palette, then the details', await waitFor(`${PAL_GONE}&&${DETAIL_SHUT}`, 3500));
  },
};
