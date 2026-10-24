'use strict';
// The notes on the Calendar, on the calnotes board (the notes board with two more notes) in its week
// view of 12 to 18 October 2026, and on the plan board, which keeps no logbook. A note shows as a chip
// at its half hour, right of the card blocks: the card's id and the first words, and the full text as
// its tooltip. Two or more notes in a half hour show as one count bubble, and a day's untimed notes
// as one "N untimed" box in its all-day row. Each opens the notes palette, on that half hour or on
// that day's untimed notes. A click on an empty hour opens it set to that hour, a bare #22 then
// Enter keeps the hour's time, and a double click there still makes a card and opens no palette. The
// Notes switch in the toolbar hides and shows the layer, and its choice is kept across a reload. A
// divider on each strip's left edge sets the strip's width for every day at once, by a drag (held
// between 44px and the column less 24px), by Left and Right on the focused divider and back to the
// default by a double click; the width is kept per board and neither a drag nor a double click on it
// opens the palette or a card form. n on the Week view opens the palette on that week, and with the
// pointer on a day's column on that day. The plan board draws no switch and no note. Each step waits on the page; the one fixed pause proves
// that the palette did NOT open.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// state, calendarAnchor, renderCalendarView.

const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const q = (sel) => `document.querySelector(${JSON.stringify(`#notes-palette ${sel}`)})`;
const CHIP = `(()=>{const c=${q('.np-chip')};return c&&!c.hidden?${q('.np-chip-text')}.textContent:''})()`;
const SECTIONS = `[...document.querySelectorAll('#notes-palette .np-ngroup')].map((g)=>[g.dataset.day,g.dataset.target,g.querySelectorAll('.np-note').length].join('|')).sort()`;
const slotEl = (day, fromMin) => `#calendar-view .cal-note[data-slot="${day}|${fromMin}"]`;
const layerCount = `document.querySelectorAll('#calendar-view .cal-note').length`;

module.exports = {
  name: 'notes-calendar',
  board: 'calnotes',
  alsoBoards: ['plan'],
  timeoutMs: 100000,
  async run(page) {
    const { ev, open, waitFor, centre, click, mouse, key, check, shot, sleep } = page;
    const palUp = (ms) => waitFor(PAL_UP, ms || 3000);
    // Esc clears a card chip before it closes the palette: press it until the palette is gone.
    const closePalette = async () => {
      for (let i = 0; i < 3; i++) {
        await key('Escape');
        if (await waitFor(PAL_GONE, i < 2 ? 700 : 2500)) return true;
      }
      return false;
    };
    const weekDrawn = (ms) => waitFor(`document.querySelectorAll('#calendar-view .cal-tg-col').length===7`, ms || 10000);
    const showWeek = async () => {
      await open('/?view=calendar');
      await waitFor(`document.querySelectorAll('#calendar-view .cal-subview-btn').length===4`, 10000);
      await ev(`document.querySelector('#calendar-view [data-subview="week"]').click()`);
      await weekDrawn();
      await ev(`(()=>{calendarAnchor='2026-10-15';renderCalendarView()})()`);
      return waitFor(`document.querySelector('#calendar-view .cal-title').textContent.includes('2026')&&document.querySelector('#calendar-view .cal-tg-col[data-day="2026-10-15"]')`, 5000);
    };
    const press = async (selector) => {
      const p = await centre(selector);
      if (!p) return false;
      await click(p.x, p.y);
      return true;
    };
    // The page point of an hour in a day's column, scrolled into the grid's view first.
    const hourPoint = async (day, hour, minute = 30) => ev(`(()=>{const col=document.querySelector('#calendar-view .cal-tg-col[data-day="${day}"]');const sc=document.querySelector('#calendar-view .cal-tg-scroll');const want=${hour}*40+${minute}*40/60;sc.scrollTop=Math.max(0,want-120);const r=col.getBoundingClientRect();return {x:r.left+r.width*0.25,y:r.top+want}})()`);

    // --- the plan board keeps no logbook: no switch, no note -------------------------------------------------
    await open('/?view=calendar', 'plan');
    await waitFor(`document.querySelectorAll('#calendar-view .cal-subview-btn').length===4`, 10000);
    await ev(`document.querySelector('#calendar-view [data-subview="week"]').click()`);
    check('plan: the week view is drawn', await weekDrawn());
    check('plan: it has no Notes switch and draws no note', await ev(`!document.getElementById('cal-notes-btn')&&${layerCount}===0`));

    // --- the week of 12 to 18 October on the board that keeps a logbook ---------------------------------------
    check('calnotes: the week is drawn', await showWeek());
    check('calnotes: the Notes switch is on and says so', await ev(`(()=>{const b=document.getElementById('cal-notes-btn');return !!b&&b.getAttribute('aria-pressed')==='true'&&b.textContent==='Notes'})()`));
    check('calnotes: a lone note is a chip at its half hour, in the day it was written', await ev(`!!document.querySelector(${JSON.stringify(slotEl('2026-10-13', 660))}+'.cal-note-chip')&&!!document.querySelector(${JSON.stringify(slotEl('2026-10-15', 570))}+'.cal-note-chip')&&!!document.querySelector(${JSON.stringify(slotEl('2026-10-15', 840))}+'.cal-note-chip')`));
    const chip = (day, from) => ev(`(()=>{const c=document.querySelector(${JSON.stringify(slotEl(day, from))});return c?{text:c.textContent,title:c.title}:null})()`);
    const lone = await chip('2026-10-15', 840);
    check('calnotes: the chip shows the card\'s id and the first words', !!lone && lone.text === '#7schema diff reviewed, two enum renames left', JSON.stringify(lone));
    check('calnotes: its tooltip is the time, the card and the full text', !!lone && lone.title === '14:10 · #7 Port the zephyr schema\nschema diff reviewed, two enum renames left', JSON.stringify(lone));
    check('calnotes: a note with no card shows a note glyph in place of an id', await ev(`(()=>{const c=document.querySelector(${JSON.stringify(slotEl('2026-10-15', 480))});return !!c&&!!c.querySelector('svg')&&!c.querySelector('.cal-note-id')&&c.textContent==='standup ran long'})()`));
    const bubble = await chip('2026-10-15', 600);
    check('calnotes: two notes in one half hour are one count bubble with the cards they are about', !!bubble && bubble.text === '2#22 #3' && await ev(`document.querySelector(${JSON.stringify(slotEl('2026-10-15', 600))}).classList.contains('cal-note-bubble')`), JSON.stringify(bubble));
    check('calnotes: and its tooltip counts them and lists each', !!bubble && bubble.title.startsWith('2 notes, 10:00–10:30: #22, #3\n') && bubble.title.includes('10:00 #22 cutover window agreed') && bubble.title.includes('10:10 #3 cutover window needs a second look'), JSON.stringify(bubble));
    check('calnotes: a day with untimed notes has one box saying how many, in its all-day row', await ev(`(()=>{const boxes=[...document.querySelectorAll('#calendar-view .cal-tg-allday .cal-note-untimed')];return boxes.length===1&&boxes[0].dataset.untimed==='2026-10-14'&&boxes[0].textContent==='2 untimed'})()`));
    check('calnotes: a day without them has none, and the timed notes sit in the hour grid, not the all-day row', await ev(`document.querySelectorAll('#calendar-view .cal-tg-allday .cal-note-chip,#calendar-view .cal-tg-allday .cal-note-bubble').length===0&&document.querySelectorAll('#calendar-view .cal-tg-col .cal-note-untimed').length===0`));
    check('calnotes: a day with timed notes keeps a strip for them, so the card blocks leave it free', await ev(`(()=>{const col=document.querySelector('#calendar-view .cal-tg-col[data-day="2026-10-15"]');const other=document.querySelector('#calendar-view .cal-tg-col[data-day="2026-10-16"]');return col.classList.contains('has-notes')&&!other.classList.contains('has-notes')})()`));
    const dated = await ev(`fetch('/api/cards/3',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({start_date:'2026-10-15T09:00',end_date:'2026-10-15T11:00'})}).then((r)=>r.status)`);
    check('calnotes: card 3 is given a two-hour block on Thursday', dated === 200, String(dated));
    check('calnotes: the week is drawn again with it', await showWeek() && await waitFor(`!!document.querySelector('#calendar-view .cal-tg-col[data-day="2026-10-15"] .cal-timeblock[data-id="3"]')`, 5000));
    check('calnotes: a card block ends where the notes strip begins, on a day with notes', await ev(`(()=>{const col=document.querySelector('#calendar-view .cal-tg-col[data-day="2026-10-15"]');const block=col.querySelector('.cal-timeblock[data-id="3"]').getBoundingClientRect();const note=col.querySelector('.cal-note').getBoundingClientRect();return block.width>20&&block.right<=note.left+1})()`));
    await ev(`document.querySelector('#calendar-view .cal-tg-scroll').scrollTop=${9 * 40}`);
    await shot('week-with-notes');

    // --- each one opens the palette ---------------------------------------------------------------------------
    await press(slotEl('2026-10-15', 570));
    check('calnotes: a chip opens the palette on its note\'s card, at the chip\'s time', await palUp() && await ev(CHIP) === '#7 Port the zephyr schema · Thu 15 09:30', await ev(CHIP));
    check('calnotes: with the notes of that card, headed by day', JSON.stringify(await ev(SECTIONS)) === JSON.stringify(['2026-10-14|7|1', '2026-10-15|7|2']), await ev(SECTIONS));
    check('calnotes: and the time field starts at the chip\'s time', await ev(`${q('.np-time')}.value`) === '09:30');
    check('calnotes: Esc closes the palette, which would cover the next one', await closePalette());
    await press(slotEl('2026-10-15', 600));
    check('calnotes: a count bubble opens it on that half hour', await waitFor(`${CHIP}==='Thu 15 10:00'`, 3000), await ev(CHIP));
    check('calnotes: with both notes, headed by their cards', JSON.stringify(await ev(SECTIONS)) === JSON.stringify(['2026-10-15|22|1', '2026-10-15|3|1']), await ev(SECTIONS));
    check('calnotes: Esc closes it again', await closePalette());
    await press('#calendar-view .cal-note-untimed');
    check('calnotes: the untimed box opens it on that day\'s untimed notes', await waitFor(`${CHIP}==='Wed 14 untimed'`, 3000) && await ev(`${q('.np-untimed')}.checked`), await ev(CHIP));
    check('calnotes: with both of them', JSON.stringify(await ev(SECTIONS)) === JSON.stringify(['2026-10-14|3|1', '2026-10-14|7|1']), await ev(SECTIONS));
    check('calnotes: Esc closes the palette', await closePalette());

    // --- an empty hour opens the palette set to that time -------------------------------------------------------
    const spot = await hourPoint('2026-10-16', 10);
    check('calnotes: the point is on the empty part of Friday\'s column', await ev(`(()=>{const e=document.elementFromPoint(${spot.x},${spot.y});return !!e&&e.classList.contains('cal-tg-col')&&e.dataset.day==='2026-10-16'})()`), JSON.stringify(spot));
    await click(spot.x, spot.y);
    check('calnotes: a click on an empty hour opens the palette on that hour', await palUp(2500) && await ev(CHIP) === 'Fri 16 10:00', await ev(CHIP));
    check('calnotes: with the time field set to the hour', await ev(`${q('.np-time')}.value`) === '10:00');
    await ev(`(()=>{const i=${q('.np-input')};i.value='#22';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus()})()`);
    await key('Enter');
    check('calnotes: #22 then Enter aims the palette at card 22 and keeps that time', await waitFor(`${CHIP}==='#22 Cut over the data layer · Fri 16 10:00'`, 2500) && await ev(`${q('.np-time')}.value`) === '10:00', await ev(CHIP));
    await ev(`(()=>{const i=${q('.np-input')};i.value='checked the window';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus()})()`);
    await key('Enter');
    check('calnotes: the note is written on card 22 on Friday at 10:00', await waitFor(`state.logbook.notes.some((n)=>n.day==='2026-10-16'&&n.at==='10:00'&&n.target==='22'&&n.note==='checked the window')`, 4000));
    check('calnotes: a palette opened on a slot keeps the slot\'s time after the write', await ev(`${q('.np-time')}.value`) === '10:00');
    check('calnotes: and the Calendar draws it as a chip at that half hour', await waitFor(`!!document.querySelector(${JSON.stringify(slotEl('2026-10-16', 600) + '.cal-note-chip')})`, 4000));
    check('calnotes: Esc closes the palette again', await closePalette());

    // --- a double click on an empty hour still makes a card, and opens no palette -----------------------------------
    const dbl = await hourPoint('2026-10-17', 15);
    await click(dbl.x, dbl.y, { clickCount: 2 });
    check('calnotes: a double click on an empty hour opens the new card form', await waitFor(`!document.getElementById('modal').classList.contains('hidden')`, 3000));
    await sleep(600);
    check('calnotes: and no palette follows it', await ev(PAL_GONE));
    await key('Escape');
    check('calnotes: Esc closes the form', await waitFor(`document.getElementById('modal').classList.contains('hidden')`, 3000));

    // --- the divider on the notes strip -----------------------------------------------------------------------------
    check('calnotes: the week is drawn again before the divider is tried', await showWeek());
    const COL = (day) => `document.querySelector('#calendar-view .cal-tg-col[data-day="${day}"]')`;
    const DIVIDER = (day) => `${COL(day)}.querySelector('.cal-note-divider')`;
    const STORED = `localStorage.getItem('kanban.'+state.projectName+'.calendar.notesWidth')`;
    const stripOf = (day) => ev(`(()=>{const c=${COL(day)}.getBoundingClientRect();const d=${DIVIDER(day)}.getBoundingClientRect();return Math.round(c.right-(d.left+d.width/2))})()`);
    const colWidth = (day) => ev(`${COL(day)}.getBoundingClientRect().width`);
    const chipWidth = (day) => ev(`${COL(day)}.querySelector('.cal-note-chip').getBoundingClientRect().width`);
    const dividerPoint = (day) => ev(`(()=>{const d=${DIVIDER(day)}.getBoundingClientRect();const s=document.querySelector('#calendar-view .cal-tg-scroll').getBoundingClientRect();return {x:d.left+d.width/2,y:s.top+120}})()`);
    const near = (a, b, slack = 3) => Math.abs(a - b) <= slack;
    const dragDivider = async (day, dx) => {
      const p = await dividerPoint(day);
      await mouse('mouseMoved', p.x, p.y, { button: 'none', clickCount: 0 });
      await mouse('mousePressed', p.x, p.y);
      for (let i = 1; i <= 6; i++) await mouse('mouseMoved', p.x + (dx * i) / 6, p.y, { buttons: 1 });
      await mouse('mouseReleased', p.x + dx, p.y);
    };
    check('calnotes: every day that keeps a notes strip has a divider on its left edge (Friday does since the note written there), and a day without has none', await ev(`(()=>{const strips=document.querySelectorAll('#calendar-view .cal-tg-col.has-notes');return strips.length>=3&&document.querySelectorAll('#calendar-view .cal-note-divider').length===strips.length&&[...strips].every((c)=>c.querySelectorAll('.cal-note-divider').length===1)})()&&!!${DIVIDER('2026-10-13')}&&!!${DIVIDER('2026-10-15')}&&!${COL('2026-10-17')}.querySelector('.cal-note-divider')`));
    check('calnotes: each divider names its day and reports its width as a percentage of the column', await ev(`(()=>{const d=${DIVIDER('2026-10-15')};return d.getAttribute('aria-label')==='Width of the notes on Thu 15'&&Number(d.getAttribute('aria-valuenow'))>Number(d.getAttribute('aria-valuemin'))-1&&Number(d.getAttribute('aria-valuenow'))<=Number(d.getAttribute('aria-valuemax'))&&Number(d.getAttribute('aria-valuemax'))<100})()`));
    check('calnotes: the divider is a focusable separator whose title says what it does', await ev(`(()=>{const d=${DIVIDER('2026-10-15')};return d.getAttribute('role')==='separator'&&d.tabIndex===0&&/Drag/.test(d.title)&&/Double-click/.test(d.title)&&/arrow/.test(d.title)})()`));
    const first = await stripOf('2026-10-15');
    check('calnotes: the strip starts at its default width, 44px to 170px', first >= 44 && first <= 171, String(first));
    const chip0 = await chipWidth('2026-10-15');
    await dragDivider('2026-10-15', -60);
    check('calnotes: dragging the divider left widens the strip', await waitFor(`Math.abs((()=>{const c=${COL('2026-10-15')}.getBoundingClientRect();const d=${DIVIDER('2026-10-15')}.getBoundingClientRect();return c.right-(d.left+d.width/2)})()-${first + 60})<=3`, 3000), String(await stripOf('2026-10-15')));
    check('calnotes: every day column took the same width at once', near(await stripOf('2026-10-13'), first + 60), String(await stripOf('2026-10-13')));
    check('calnotes: and the chips are wider by as much', near(await chipWidth('2026-10-15'), chip0 + 60, 4), `${chip0} -> ${await chipWidth('2026-10-15')}`);
    await shot('week-notes-widened');
    await sleep(600);
    check('calnotes: the drag opened no palette and no card form', await ev(PAL_GONE) && await ev(`document.getElementById('modal').classList.contains('hidden')`));
    check('calnotes: the width is kept for the board', near(Number(await ev(STORED)), first + 60), String(await ev(STORED)));
    check('calnotes: and a reload draws the week with it', await showWeek() && near(await stripOf('2026-10-15'), first + 60), String(await stripOf('2026-10-15')));
    await dragDivider('2026-10-15', 900);
    check('calnotes: dragged right past the minimum the strip stops at 44px', await waitFor(`Math.abs((()=>{const c=${COL('2026-10-15')}.getBoundingClientRect();const d=${DIVIDER('2026-10-15')}.getBoundingClientRect();return c.right-(d.left+d.width/2)})()-44)<=2`, 3000), String(await stripOf('2026-10-15')));
    await dragDivider('2026-10-15', -900);
    const wide = await colWidth('2026-10-15');
    check('calnotes: dragged left past the column the card blocks keep a 24px sliver', near(await stripOf('2026-10-15'), wide - 24, 3), `${await stripOf('2026-10-15')} of ${wide}`);
    check('calnotes: the chips still read, with the card blocks squeezed beside them', await chipWidth('2026-10-15') > wide - 40);
    await shot('week-notes-widest');
    await ev(`${DIVIDER('2026-10-15')}.focus()`);
    await key('ArrowRight');
    check('calnotes: Right on the focused divider narrows the strip a step', await waitFor(`Math.abs((()=>{const c=${COL('2026-10-15')}.getBoundingClientRect();const d=${DIVIDER('2026-10-15')}.getBoundingClientRect();return c.right-(d.left+d.width/2)})()-${wide - 24 - 8})<=3`, 3000), String(await stripOf('2026-10-15')));
    check('calnotes: the divider keeps its focus through the step', await ev(`document.activeElement===${DIVIDER('2026-10-15')}`));
    await key('ArrowLeft');
    check('calnotes: Left widens it a step', await waitFor(`Math.abs((()=>{const c=${COL('2026-10-15')}.getBoundingClientRect();const d=${DIVIDER('2026-10-15')}.getBoundingClientRect();return c.right-(d.left+d.width/2)})()-${wide - 24})<=3`, 3000), String(await stripOf('2026-10-15')));
    const dp = await dividerPoint('2026-10-15');
    await click(dp.x, dp.y, { clickCount: 2 });
    check('calnotes: a double click on the divider goes back to the default width', await waitFor(`(()=>{const c=${COL('2026-10-15')}.getBoundingClientRect();const d=${DIVIDER('2026-10-15')}.getBoundingClientRect();const s=c.right-(d.left+d.width/2);return s>=44&&s<=171})()`, 3000) && await ev(`${STORED}===null`), String(await stripOf('2026-10-15')));
    await sleep(600);
    check('calnotes: and made no card form and opened no palette', await ev(`document.getElementById('modal').classList.contains('hidden')`) && await ev(PAL_GONE));

    // --- n on the Calendar opens the palette on the Calendar's range ----------------------------------------------------
    const RANGE_BTNS = `[...document.querySelectorAll('#notes-palette .np-range-slot .np-by-btn')].map((b)=>b.textContent+(b.getAttribute('aria-pressed')==='true'?'*':''))`;
    const RANGE_LABEL = `document.querySelector('#notes-palette .np-range-label').textContent`;
    const IN_WEEK = `state.logbook.notes.filter((n)=>n.day>='2026-10-12'&&n.day<='2026-10-18').length`;
    check('calnotes: the week is drawn again before n is tried', await showWeek());
    await mouse('mouseMoved', 5, 5, { button: 'none', clickCount: 0 });
    await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    await key('n');
    check('calnotes: n on the Week view, the pointer on no day, opens the palette on Week', await palUp() && JSON.stringify(await ev(RANGE_BTNS)) === JSON.stringify(['All', 'Month', 'Week*', '3 days', 'Day']), JSON.stringify(await ev(RANGE_BTNS)));
    check('calnotes: with the range of the week on screen, 12 to 18 October', await ev(RANGE_LABEL) === '12–18 Oct', await ev(RANGE_LABEL));
    check('calnotes: and lists that week\'s notes, of every card', await ev(`document.querySelectorAll('#notes-palette .np-note').length===${IN_WEEK}`) && await ev(IN_WEEK) >= 6, `${await ev(`document.querySelectorAll('#notes-palette .np-note').length`)} of ${await ev(IN_WEEK)}`);
    check('calnotes: it is no card\'s: the picker names the card last noted or none, and the box is empty', await ev(`!document.querySelector('#notes-palette .np-chip')||document.querySelector('#notes-palette .np-chip').hidden`));
    await shot('palette-week-range');
    check('calnotes: Esc closes the palette', await closePalette());
    const friday = await hourPoint('2026-10-16', 10);
    await mouse('mouseMoved', friday.x, friday.y, { button: 'none', clickCount: 0 });
    await key('n');
    check('calnotes: n with the pointer on Friday\'s column opens the palette on Day, that Friday', await palUp() && JSON.stringify(await ev(RANGE_BTNS)) === JSON.stringify(['All', 'Month', 'Week', '3 days', 'Day*']) && await ev(RANGE_LABEL) === 'Fri 16 Oct', await ev(RANGE_LABEL));
    check('calnotes: the pointer sets the range only: the note still goes to today', await ev(`${q('.np-date')}.value`) === 'Today');
    check('calnotes: Esc closes it again', await closePalette());
    await mouse('mouseMoved', 5, 5, { button: 'none', clickCount: 0 });

    // --- the Notes switch ------------------------------------------------------------------------------------------
    await press('#cal-notes-btn');
    check('calnotes: the Notes switch hides every chip, bubble and box', await waitFor(`${layerCount}===0`, 3000) && await ev(`document.getElementById('cal-notes-btn').getAttribute('aria-pressed')==='false'`));
    check('calnotes: and the card blocks have the whole column again', await ev(`document.querySelectorAll('#calendar-view .cal-tg-col.has-notes').length===0`));
    const quiet = await hourPoint('2026-10-16', 10);
    await click(quiet.x, quiet.y);
    await sleep(600);
    check('calnotes: with the layer hidden a click on an empty hour opens no palette', await ev(PAL_GONE));
    check('calnotes: a reload keeps the switch off', await showWeek() && await ev(`document.getElementById('cal-notes-btn').getAttribute('aria-pressed')==='false'&&${layerCount}===0`));
    await press('#cal-notes-btn');
    check('calnotes: pressed again it shows the layer', await waitFor(`${layerCount}>=6`, 3000) && await ev(`document.getElementById('cal-notes-btn').getAttribute('aria-pressed')==='true'`));
    await press('[data-subview="month"]');
    check('calnotes: the month view has no Notes switch and no note', await waitFor(`document.querySelectorAll('#calendar-view .cal-day').length>=28`, 5000) && await ev(`!document.getElementById('cal-notes-btn')&&${layerCount}===0`));
    await mouse('mouseMoved', 5, 5, { button: 'none', clickCount: 0 });
  },
};
