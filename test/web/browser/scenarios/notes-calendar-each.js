'use strict';
// The Calendar's Each note mode, on the calnotes board in its week of 12 to 18 October 2026. Grouped
// is the default and draws a count bubble for two or more notes in a half hour; Each note draws every
// note as its own chip and lets an hour grow to hold the most notes any shown day has in it, the same
// height in every column. Two notes are added to Thursday 15's two between 10:00 and 10:59, so that hour is
// 80px, and card 3 a block from 09:00 to 11:00 across it. The stretched hours line up across the
// columns, the block's bottom sits at 11:00 on the stretched scale, and a drag of the block lands on
// the time under the pointer (a straight 40px-an-hour line would land an hour late). The choice is
// kept per board in this browser and Grouped brings the 40px hours back.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// state, calendarAnchor, renderCalendarView.

const COL = (day) => `document.querySelector('#calendar-view .cal-tg-col[data-day="${day}"]')`;
const MODE_BTN = (m) => `document.querySelector('#calendar-view [data-notes-mode="${m}"]')`;
const SCROLL = `document.querySelector('#calendar-view .cal-tg-scroll')`;

module.exports = {
  name: 'notes-calendar-each',
  board: 'calnotes',
  timeoutMs: 100000,
  async run(page) {
    const { ev, open, waitFor, click, mouse, check, shot } = page;
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

    await open('/?view=calendar');
    for (const at of ['10:15', '10:30']) {
      const made = await ev(`fetch('/api/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({day:'2026-10-15',target:'7',at:${JSON.stringify(at)},note:'extra ${at}'})}).then((r)=>r.status)`);
      check(`each: a note at ${at} is written on Thursday`, made === 201, String(made));
    }
    const dated = await ev(`fetch('/api/cards/3',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({start_date:'2026-10-15T09:00',end_date:'2026-10-15T11:00'})}).then((r)=>r.status)`);
    check('each: card 3 is given a block from 09:00 to 11:00 on Thursday', dated === 200, String(dated));

    // --- Grouped is the default and is today's 40px hour ----------------------------------------------------------
    check('each: the week is drawn', await showWeek() && await waitFor(`!!${COL('2026-10-15')}.querySelector('.cal-timeblock[data-id="3"]')`, 5000));
    check('each: Grouped is pressed and Each note is not', await ev(`${MODE_BTN('grouped')}.getAttribute('aria-pressed')==='true'&&${MODE_BTN('each')}.getAttribute('aria-pressed')==='false'`));
    check('each: Grouped shows a count bubble and every column is 960px', await ev(`document.querySelectorAll('#calendar-view .cal-note-bubble').length>0`) && near(await colHeight('2026-10-15'), 960) && near(await colHeight('2026-10-16'), 960));
    check('each: the block spans two 40px hours', await ev(`(()=>{const b=${COL('2026-10-15')}.querySelector('.cal-timeblock[data-id="3"]');return Math.round(parseFloat(b.style.top))===360&&Math.round(parseFloat(b.style.height))===78})()`));

    // --- Each note --------------------------------------------------------------------------------------------------
    await ev(`(()=>{const sh=new CSSStyleSheet();sh.replaceSync('#calendar-view .cal-tg-scroll{max-height:340px!important}');document.adoptedStyleSheets=[...document.adoptedStyleSheets,sh]})()`);
    await ev(`${SCROLL}.scrollTop=560`);
    check('each: the grid is scrolled to 14:00 before the switch', await waitFor(`${SCROLL}.scrollTop===560`, 3000));
    check('each: pressing Each note redraws the week', await press(MODE_BTN('each')) && await waitFor(`${MODE_BTN('each')}.getAttribute('aria-pressed')==='true'`, 3000));
    check('each: the scroll keeps its time: 14:00 is still at the top of the grid', await ev(`(()=>{const l=document.querySelectorAll('#calendar-view .cal-tg-hour')[14];return Math.abs(parseFloat(l.style.top)-${SCROLL}.scrollTop)<=3})()`), await ev(`${SCROLL}.scrollTop`));
    check('each: no note is in a count bubble and every note is its own chip', await ev(`document.querySelectorAll('#calendar-view .cal-note-bubble').length===0&&${COL('2026-10-15')}.querySelectorAll('.cal-note-chip').length===7`));
    check('each: the choice is kept for this board in this browser', await ev(`localStorage.getItem('kanban.'+state.projectName+'.calendar.notesMode')==='each'`));
    check('each: the four notes of hour 10 are stacked 20px apart from the hour line', await ev(`(()=>{const col=${COL('2026-10-15')};const top=[...col.querySelectorAll('.cal-note-chip')].filter((c)=>/^#7extra|^#22|^#3/.test(c.textContent)).map((c)=>parseFloat(c.style.top)).sort((a,b)=>a-b);return top.length===4&&top.every((t,i)=>t===400+1+i*20)})()`));
    check('each: the busiest hour grew to 80px, so every column is 1000px', near(await colHeight('2026-10-15'), 1000) && near(await colHeight('2026-10-16'), 1000) && near(await colHeight('2026-10-13'), 1000));
    check('each: the same hour is the same height and place in every column (the note at 11:00 on Tuesday sits under 10 AM\'s 80px)', await ev(`(()=>{const c=${COL('2026-10-13')}.querySelector('.cal-note-chip');return !!c&&parseFloat(c.style.top)===481})()`));
    check('each: the hour labels follow the scale', await ev(`(()=>{const l=[...document.querySelectorAll('#calendar-view .cal-tg-hour')];return l.length===24&&l[10].style.top==='400px'&&l[11].style.top==='480px'&&l[12].style.top==='520px'})()`));
    check('each: the card block spans the two hours on the stretched scale', await ev(`(()=>{const b=${COL('2026-10-15')}.querySelector('.cal-timeblock[data-id="3"]');return Math.round(parseFloat(b.style.top))===360&&Math.round(parseFloat(b.style.height))===118})()`));
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

    // --- Grouped brings the 40px hours back ------------------------------------------------------------------------
    check('each: the week is drawn again', await showWeek());
    check('each: the board opens in Each note, as it was left', await ev(`${MODE_BTN('each')}.getAttribute('aria-pressed')==='true'`));
    check('each: pressing Grouped puts the bubbles and the 960px columns back', await press(MODE_BTN('grouped')) && await waitFor(`document.querySelectorAll('#calendar-view .cal-note-bubble').length>0`, 3000) && near(await colHeight('2026-10-15'), 960));
    check('each: and forgets the choice', await ev(`localStorage.getItem('kanban.'+state.projectName+'.calendar.notesMode')===null`));
  },
};
