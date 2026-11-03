'use strict';
// The Calendar's Each note mode, on the calnotes board in its week of 12 to 18 October 2026. Grouped
// is the default and draws a count bubble for two or more notes in a half hour; Each note draws every
// note as its own chip and lets an hour grow to hold the most notes any shown day has in it, the same
// height in every column. Two notes are added to Thursday 15's two between 10:00 and 10:59, so that hour is
// 80px, and card 3 a block from 09:00 to 11:00 across it. The stretched hours line up across the
// columns, the block's bottom sits at 11:00 on the stretched scale, and a drag of the block lands on
// the time under the pointer (a straight 40px-an-hour line would land an hour late). Two notes given
// a duration in the palette on Friday, from 10:00 for 2h and from 10:30 for 1h, are blocks side by side in
// both states, on the stretched scale in Each note, and grow no hour. The choice is
// kept per board in this browser and Grouped brings the 40px hours back.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// state, calendarAnchor, renderCalendarView.

const COL = (day) => `document.querySelector('#calendar-view .cal-tg-col[data-day="${day}"]')`;
const NOTES_BTN = `document.getElementById('cal-notes-btn')`;
const SCROLL = `document.querySelector('#calendar-view .cal-tg-scroll')`;

module.exports = {
  name: 'notes-calendar-each',
  board: 'calnotes',
  timeoutMs: 100000,
  async run(page) {
    const { ev, open, waitFor, click, mouse, key, check, shot } = page;
    const showWeek = async () => {
      await open('/?view=calendar');
      await waitFor(`document.querySelectorAll('#calendar-view .cal-subview-btn').length===4`, 10000);
      await ev(`document.querySelector('#calendar-view [data-subview="week"]').click()`);
      await waitFor(`document.querySelectorAll('#calendar-view .cal-tg-col').length===7`, 10000);
      await ev(`(()=>{calendarAnchor='2026-10-15';renderCalendarView()})()`);
      return waitFor(`document.querySelector('#calendar-view .cal-title').textContent.includes('2026')&&!!${COL('2026-10-15')}`, 5000);
    };
    const press = async (js) => {
      const p = await ev(`(()=>{const e=${js};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      if (!p) return false;
      await click(p.x, p.y);
      return true;
    };
    const colHeight = (day) => ev(`${COL(day)}.getBoundingClientRect().height`);
    const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
    const block = (from, to) => `${COL('2026-10-16')}.querySelector('.cal-note-block[data-range="2026-10-16|${from}|${to}"]')`;
    const placeOf = (js) => ev(`(()=>{const b=${js};return b?[parseFloat(b.style.top),parseFloat(b.style.height)]:null})()`);
    // Every note element of Friday's strip against every other: 'ok' when no two share any of the page.
    const SIDE_BY_SIDE = `(()=>{const rs=[...${COL('2026-10-16')}.querySelectorAll('.cal-note')].map((e)=>e.getBoundingClientRect());if(rs.length<2)return 'missing';for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){const a=rs[i],b=rs[j];if(a.left<b.right-0.5&&b.left<a.right-0.5&&a.top<b.bottom-0.5&&b.top<a.bottom-0.5)return 'overlap '+i+' '+j}return 'ok'})()`;

    await open('/?view=calendar');
    for (const at of ['10:15', '10:30']) {
      const made = await ev(`fetch('/api/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({day:'2026-10-15',target:'7',at:${JSON.stringify(at)},note:'extra ${at}'})}).then((r)=>r.status)`);
      check(`each: a note at ${at} is written on Thursday`, made === 201, String(made));
    }
    const dated = await ev(`fetch('/api/cards/3',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({start_date:'2026-10-15T09:00',end_date:'2026-10-15T11:00'})}).then((r)=>r.status)`);
    check('each: card 3 is given a block from 09:00 to 11:00 on Thursday', dated === 200, String(dated));

    // --- Grouped is the default and is today's 40px hour ----------------------------------------------------------
    check('each: the week is drawn', await showWeek() && await waitFor(`!!${COL('2026-10-15')}.querySelector('.cal-timeblock[data-id="3"]')`, 5000));
    check('each: the Notes button starts grouped: pressed, saying Grouped Notes', await ev(`${NOTES_BTN}.getAttribute('aria-pressed')==='true'&&${NOTES_BTN}.textContent==='Grouped Notes'`));
    check('each: Grouped shows a count bubble and every column is 960px', await ev(`document.querySelectorAll('#calendar-view .cal-note-bubble').length>0`) && near(await colHeight('2026-10-15'), 960) && near(await colHeight('2026-10-16'), 960));
    check('each: the block spans two 40px hours', await ev(`(()=>{const b=${COL('2026-10-15')}.querySelector('.cal-timeblock[data-id="3"]');return Math.round(parseFloat(b.style.top))===360&&Math.round(parseFloat(b.style.height))===78})()`));

    // --- two ranges made in the palette on Friday, the second inside the first ------------------------------------
    const PAL = `document.getElementById('notes-palette')`;
    const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
    const field = (sel) => `document.querySelector('#notes-palette ${sel}')`;
    const setField = (sel, value) => ev(`(()=>{const f=${field(sel)};f.value=${JSON.stringify(value)};f.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const writeRange = async (at, length, text) => {
      await setField('.np-time', at);
      await setField('.np-duration', length);
      await setField('.np-input', text);
      await ev(`${field('.np-input')}.focus()`);
      await key('Enter');
      return waitFor(`state.logbook.notes.some((n)=>n.day==='2026-10-16'&&n.note===${JSON.stringify(text)}&&n.at===${JSON.stringify(at)}&&n.duration===${JSON.stringify(length)})`, 4000);
    };
    const spot = await ev(`(()=>{${SCROLL}.scrollTop=${10 * 40 - 120};const r=${COL('2026-10-16')}.getBoundingClientRect();return {x:r.left+r.width*0.25,y:r.top+${10 * 40 + 10}}})()`);
    await click(spot.x, spot.y);
    check('each: a click on Friday\'s empty 10:00 opens the notes palette', await waitFor(`!(${PAL_GONE})`, 3000));
    check('each: a note from 10:00 with a typed 2h is written on Friday', await writeRange('10:00', '2h', 'a morning on the cutover'));
    check('each: and one from 10:30 with 1h, inside it', await writeRange('10:30', '1h', 'paired inside it'));
    await setField('.np-duration', '');
    for (let i = 0; i < 3 && !(await ev(PAL_GONE)); i++) { await key('Escape'); await waitFor(PAL_GONE, 1500); }
    check('each: Esc closes the palette', await ev(PAL_GONE));
    check('each: Grouped draws the 2h range as a block from the 10:00 line to the 12:00 line', await waitFor(`!!${block(600, 720)}&&!!${block(630, 690)}`, 4000) && JSON.stringify(await placeOf(block(600, 720))) === '[401,78]', JSON.stringify(await placeOf(block(600, 720))));
    check('each: and the one inside it from the 10:30 line to the 11:30 line', JSON.stringify(await placeOf(block(630, 690))) === '[421,38]', JSON.stringify(await placeOf(block(630, 690))));
    check('each: the two blocks are side by side, neither covering the other', await ev(SIDE_BY_SIDE) === 'ok', await ev(SIDE_BY_SIDE));
    await ev(`${SCROLL}.scrollTop=${8 * 40}`);
    await shot('grouped-ranges');

    // --- Each note --------------------------------------------------------------------------------------------------
    await ev(`(()=>{const sh=new CSSStyleSheet();sh.replaceSync('#calendar-view .cal-tg-scroll{max-height:340px!important}');document.adoptedStyleSheets=[...document.adoptedStyleSheets,sh]})()`);
    await ev(`${SCROLL}.scrollTop=560`);
    check('each: the grid is scrolled to 14:00 before the switch', await waitFor(`${SCROLL}.scrollTop===560`, 3000));
    check('each: a press hides the notes: the button says Notes, unpressed', await press(NOTES_BTN) && await waitFor(`${NOTES_BTN}.getAttribute('aria-pressed')==='false'&&${NOTES_BTN}.textContent==='Notes'&&document.querySelectorAll('#calendar-view .cal-note').length===0`, 3000));
    check('each: and the scroll still keeps its time with no notes', await ev(`(()=>{const l=document.querySelectorAll('#calendar-view .cal-tg-hour')[14];return Math.abs(parseFloat(l.style.top)-${SCROLL}.scrollTop)<=3})()`));
    check('each: the next press shows every note as its own chip: Notes, pressed', await press(NOTES_BTN) && await waitFor(`${NOTES_BTN}.getAttribute('aria-pressed')==='true'&&${NOTES_BTN}.textContent==='Notes'&&document.querySelectorAll('#calendar-view .cal-note-chip').length>0`, 3000));
    check('each: the scroll keeps its time: 14:00 is still at the top of the grid', await ev(`(()=>{const l=document.querySelectorAll('#calendar-view .cal-tg-hour')[14];return Math.abs(parseFloat(l.style.top)-${SCROLL}.scrollTop)<=3})()`), await ev(`${SCROLL}.scrollTop`));
    check('each: no note is in a count bubble and every note is its own chip', await ev(`document.querySelectorAll('#calendar-view .cal-note-bubble').length===0&&${COL('2026-10-15')}.querySelectorAll('.cal-note-chip').length===7`));
    check('each: the choice is kept for this board in this browser', await ev(`localStorage.getItem('kanban.'+state.projectName+'.calendar.notesMode')==='each'`));
    check('each: the four notes of hour 10 are stacked 20px apart from the hour line', await ev(`(()=>{const col=${COL('2026-10-15')};const top=[...col.querySelectorAll('.cal-note-chip')].filter((c)=>/^#7extra|^#22|^#3/.test(c.textContent)).map((c)=>parseFloat(c.style.top)).sort((a,b)=>a-b);return top.length===4&&top.every((t,i)=>t===400+1+i*20)})()`));
    check('each: the busiest hour grew to 80px, so every column is 1000px', near(await colHeight('2026-10-15'), 1000) && near(await colHeight('2026-10-16'), 1000) && near(await colHeight('2026-10-13'), 1000));
    check('each: the same hour is the same height and place in every column (the note at 11:00 on Tuesday sits under 10 AM\'s 80px)', await ev(`(()=>{const c=${COL('2026-10-13')}.querySelector('.cal-note-chip');return !!c&&parseFloat(c.style.top)===481})()`));
    check('each: the hour labels follow the scale', await ev(`(()=>{const l=[...document.querySelectorAll('#calendar-view .cal-tg-hour')];return l.length===24&&l[10].style.top==='400px'&&l[11].style.top==='480px'&&l[12].style.top==='520px'})()`));
    check('each: the card block spans the two hours on the stretched scale', await ev(`(()=>{const b=${COL('2026-10-15')}.querySelector('.cal-timeblock[data-id="3"]');return Math.round(parseFloat(b.style.top))===360&&Math.round(parseFloat(b.style.height))===118})()`));
    check('each: Friday\'s 2h block runs from the 10:00 line to the 12:00 line on the stretched scale', JSON.stringify(await placeOf(block(600, 720))) === '[401,118]', JSON.stringify(await placeOf(block(600, 720))));
    check('each: and the one inside it from 10:30 to 11:30, halfway down the 80px hour', JSON.stringify(await placeOf(block(630, 690))) === '[441,58]', JSON.stringify(await placeOf(block(630, 690))));
    check('each: the ranges across hours 10 and 11 grow neither: 11:00 is still 40px tall', await ev(`(()=>{const l=[...document.querySelectorAll('#calendar-view .cal-tg-hour')];return l[11].style.top==='480px'&&l[12].style.top==='520px'})()`));
    check('each: and Friday\'s blocks are still side by side', await ev(SIDE_BY_SIDE) === 'ok', await ev(SIDE_BY_SIDE));
    await ev(`${SCROLL}.scrollTop=300`);
    await shot('each-note');

    // --- a drag lands on the time under the pointer -----------------------------------------------------------------
    const at = (min) => ev(`(()=>{const col=${COL('2026-10-15')};const sc=${SCROLL};const r=col.getBoundingClientRect();const hs=[...document.querySelectorAll('#calendar-view .cal-tg-hour')].map((l)=>parseFloat(l.style.top));const h=Math.floor(${min}/60);const next=h<23?hs[h+1]:col.offsetHeight;const y=hs[h]+(${min}-h*60)/60*(next-hs[h]);return {x:r.left+r.width*0.12,y:r.top+y}})()`);
    const from = await at(9 * 60 + 30);
    const to = await at(13 * 60 + 30);
    check('each: the pointer starts on the block, at 09:30', await ev(`(()=>{const e=document.elementFromPoint(${from.x},${from.y});return !!e&&!!e.closest('.cal-timeblock[data-id="3"]')})()`), JSON.stringify(from));
    await mouse('mouseMoved', from.x, from.y, { button: 'none', clickCount: 0 });
    await mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', from.x, from.y + ((to.y - from.y) * i) / 8, { buttons: 1 });
    await mouse('mouseReleased', to.x, to.y);
    check('each: dragged from 09:30 to 13:30 the block starts at 13:00, not an hour later', await waitFor(`(state.active.find((c)=>c.id==='3')||{}).start_date==='2026-10-15T13:00'`, 5000), await ev(`(state.active.find((c)=>c.id==='3')||{}).start_date`));
    check('each: and ends at 15:00', await ev(`(state.active.find((c)=>c.id==='3')||{}).end_date`) === '2026-10-15T15:00');

    // --- a chip is moved from its own time, not from the place it is stacked at ----------------------------------------
    // "extra 10:15" is the third chip of the 80px hour 10, stacked at 10:30 on the scale. A press at the pointer's
    // 10:38 lands on it, so the grab offset is 10:15 - 10:38 = -23 minutes whatever the stack says; let go with the
    // pointer at 11:40, the note starts at 11:40 - 23 minutes = 11:17, which the 15-minute grid takes to 11:15.
    const grab = await at(10 * 60 + 38);
    const chipX = await ev(`(()=>{const c=[...${COL('2026-10-15')}.querySelectorAll('.cal-note-chip')].find((e)=>e.textContent.includes('extra 10:15'));const r=c.getBoundingClientRect();return r.left+r.width/2})()`);
    const drop = await at(11 * 60 + 40);
    check('each: the pointer starts on the chip of the note at 10:15', await ev(`(()=>{const e=document.elementFromPoint(${chipX},${grab.y});return !!e&&!!e.closest('.cal-note-chip')&&e.closest('.cal-note-chip').textContent.includes('extra 10:15')})()`), JSON.stringify([chipX, grab]));
    await mouse('mouseMoved', chipX, grab.y, { button: 'none', clickCount: 0 });
    await mouse('mousePressed', chipX, grab.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', chipX, grab.y + ((drop.y - grab.y) * i) / 8, { buttons: 1 });
    await mouse('mouseReleased', chipX, drop.y);
    check('each: the note at 10:15, grabbed at 10:38 and let go at 11:40, is written at 11:15', await waitFor(`state.logbook.notes.some((n)=>n.note==='extra 10:15'&&n.day==='2026-10-15'&&n.at==='11:15')`, 5000), await ev(`JSON.stringify(state.logbook.notes.filter((n)=>n.note==='extra 10:15'))`));
    check('each: the Calendar draws it again with three notes in hour 10, so the hour is 60px and every column 980px', await waitFor(`Math.abs(${COL('2026-10-15')}.getBoundingClientRect().height-980)<=1.5`, 4000) && await ev(PAL_GONE));

    // --- Grouped brings the 40px hours back ------------------------------------------------------------------------
    check('each: the week is drawn again', await showWeek());
    check('each: the board opens with every note its own chip, as it was left', await ev(`${NOTES_BTN}.textContent==='Notes'&&${NOTES_BTN}.getAttribute('aria-pressed')==='true'&&document.querySelectorAll('#calendar-view .cal-note-bubble').length===0`));
    check('each: the next press is Grouped Notes, with the bubbles and the 960px columns back', await press(NOTES_BTN) && await waitFor(`${NOTES_BTN}.textContent==='Grouped Notes'&&document.querySelectorAll('#calendar-view .cal-note-bubble').length>0`, 3000) && near(await colHeight('2026-10-15'), 960));
    check('each: and forgets the mode', await ev(`localStorage.getItem('kanban.'+state.projectName+'.calendar.notesMode')===null`));
    check('each: one more press hides the notes, and the one after shows every note again', await press(NOTES_BTN) && await waitFor(`${NOTES_BTN}.getAttribute('aria-pressed')==='false'`, 3000) && await press(NOTES_BTN) && await waitFor(`${NOTES_BTN}.textContent==='Notes'&&${NOTES_BTN}.getAttribute('aria-pressed')==='true'&&document.querySelectorAll('#calendar-view .cal-note-bubble').length===0`, 3000));
  },
};
