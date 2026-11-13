'use strict';
// The notes palette as a side dock, on the notes board in the runner's 1800 px window. From 760 px up the
// open palette is a full-height panel on the right under the header, and the board is given the room: no
// column or card sits behind it, a click on the board leaves it up, and a note is written from it. Its
// full screen button switches the palette to full screen and back; Esc closes it from either. In the dock
// the toolbar is dropdowns (a switch where the line has the room, as full screen has); the hint line and
// the subject line show only while focus is in the note bar; the Today and Now fields show a reset only
// while they say something else. A phone is phone-steps/notes-palette.js.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// openNotes, state.

const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const q = (sel) => `document.querySelector(${JSON.stringify(`#notes-palette ${sel}`)})`;
const RECT = (el) => `(()=>{const r=${el}.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}})()`;
const SHOWN = (sel) => `(()=>{const e=${q(sel)};return !!e&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0})()`;
const FS_ON = `${PAL}.classList.contains('fullscreen')`;
const DOCKED = `document.body.classList.contains('notes-docked')`;
const BOARD = `document.getElementById('board')`;

module.exports = {
  name: 'notes-dock',
  board: 'notes',
  timeoutMs: 90000,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, check, shot } = page;
    const palUp = (ms) => waitFor(PAL_UP, ms || 3000);
    const setBox = (text) => ev(`(()=>{const i=${q('.np-input')};i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return true})()`);
    const closePalette = async () => {
      for (let i = 0; i < 3; i++) {
        await key('Escape');
        if (await waitFor(PAL_GONE, i < 2 ? 700 : 2500)) return true;
      }
      return false;
    };
    const toggleFs = async () => { const b = await centre('#notes-fullscreen-btn'); await click(b.x, b.y); };

    await open('/', 'notes');
    check('dock: the Board draws', await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000));
    const before = await ev(RECT(BOARD));
    await ev(`openNotes({ kind: 'card-notes', id: '7' })`);
    check('dock: the palette opens, on the dock and not full screen', await palUp() && await ev(`!(${FS_ON})&&${DOCKED}`));

    // --- the dock's place and the board's room --------------------------------------------------------
    const dock = await ev(RECT(PAL));
    const header = await ev(RECT(`document.querySelector('header')`));
    const win = await ev(`({w:innerWidth,h:innerHeight})`);
    check('dock: it is docked on the right edge and runs to the bottom', Math.abs(dock.r - win.w) <= 1 && Math.abs(dock.b - win.h) <= 1, dock);
    check('dock: it is under the header', dock.t >= header.b - 1, { dock, header });
    check('dock: it is 340 to 480 px wide', dock.w >= 340 && dock.w <= 480, dock.w);
    const board = await ev(RECT(BOARD));
    check('dock: the board shrinks to make room: it ends where the dock begins, and is narrower than it was', board.r <= dock.l + 1 && board.w < before.w, { board, dock, before });
    check('dock: no card is behind the dock', await ev(`[...document.querySelectorAll('#board .card-el')].every((c)=>{const r=c.getBoundingClientRect();return r.width===0||r.right<=${dock.l}+1})`));
    await shot('dock-open');

    // --- the board stays in use ------------------------------------------------------------------------
    const head = await centre('#board .column-header');
    await click(head.x, head.y);
    check('dock: a click on the board leaves the dock open', await ev(PAL_UP) && await ev(DOCKED));

    // --- writing from the dock -------------------------------------------------------------------------
    await setBox('written from the dock');
    await key('Enter');
    check('dock: Enter writes the note, and the box is empty for the next', await waitFor(`state.logbook.notes.some((n)=>n.target==='7'&&n.note==='written from the dock')&&${q('.np-input')}.value===''`, 5000));
    check('dock: the dock stays up and lists the new note', await ev(PAL_UP) && await waitFor(`[...document.querySelectorAll('#notes-palette .np-note-text')].some((e)=>e.textContent==='written from the dock')`, 3000));

    // --- the compact top -------------------------------------------------------------------------------
    check('dock: the switches are dropdowns on the dock\'s narrow toolbar, not button groups', await ev(`${SHOWN('.np-sel-layout')}&&${SHOWN('.np-sel-by')}&&${SHOWN('.np-sel-range')}&&!${SHOWN('.np-layout-slot')}&&!${SHOWN('.np-who-slot')}&&!${SHOWN('.np-range-slot')}`));
    check('dock: the filter, the dropdowns and the step buttons are one line', await ev(`(()=>{const c=['.np-filter','.np-sel-layout','.np-sel-by','.np-sel-range','.np-range-step'].map((s)=>{const r=document.querySelector('#notes-palette '+s).getBoundingClientRect();return (r.top+r.bottom)/2});return Math.max(...c)-Math.min(...c)<=3})()`));
    check('dock: the box is pinned at the bottom: the list ends where the note bar begins', await ev(`(()=>{const b=${q('.np-body')}.getBoundingClientRect();const bar=${q('.np-bar')}.getBoundingClientRect();return Math.abs(b.bottom-bar.top)<=1&&bar.bottom<=innerHeight})()`));
    check('dock: with focus in the box the hint line shows, and the subject line above the box', await ev(`document.activeElement===${q('.np-input')}`) && await ev(SHOWN('.np-prev')) && await ev(SHOWN('.np-subject-row')) && await ev(`${q('.np-subject-row')}.getBoundingClientRect().bottom<=${q('.np-input')}.getBoundingClientRect().top`));
    await ev(`${q('.np-filter')}.focus()`);
    check('dock: with the focus in the filter, both go', await waitFor(`!${SHOWN('.np-prev')}&&!${SHOWN('.np-subject-row')}`, 3000));
    await ev(`${q('.np-input')}.focus()`);
    check('dock: and come back with the focus', await waitFor(`${SHOWN('.np-prev')}&&${SHOWN('.np-subject-row')}`, 3000));
    check('dock: Today and Now show no button while the fields say Today and Now', !(await ev(SHOWN('.np-today-btn'))) && !(await ev(SHOWN('.np-now-btn'))));
    await ev(`(()=>{const f=${q('.np-date')};f.value='2026-10-14';f.dispatchEvent(new Event('input',{bubbles:true}));const t=${q('.np-time')};t.value='09:00';t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    check('dock: a picked day and time show their reset', await waitFor(`${SHOWN('.np-today-btn')}&&${SHOWN('.np-now-btn')}`, 3000));
    const reset = await centre('.np-today-btn');
    await click(reset.x, reset.y);
    check('dock: the reset puts Today back and goes', await waitFor(`${q('.np-date')}.value==='Today'&&!${SHOWN('.np-today-btn')}`, 3000));

    // --- full screen and back ---------------------------------------------------------------------------
    check('dock: the dock has the full screen button', await ev(SHOWN('#notes-fullscreen-btn')));
    await toggleFs();
    check('full: the button makes it full screen, and the board is no longer docked beside it', await waitFor(`${FS_ON}&&!${DOCKED}`, 2500) && await ev(`(()=>{const r=${PAL}.getBoundingClientRect();return r.left===0&&r.top===0&&Math.round(r.width)===innerWidth&&Math.round(r.height)===innerHeight})()`));
    check('full: the switches are buttons where the line has the room, and the dropdowns go', await ev(`${SHOWN('.np-layout-slot')}&&${SHOWN('.np-who-slot')}&&${SHOWN('.np-range-slot')}&&!${SHOWN('.np-sel-by')}&&!${SHOWN('.np-sel-range')}`));
    check('full: the note box is still at the bottom', await ev(`(()=>{const b=${q('.np-body')}.getBoundingClientRect();const bar=${q('.np-bar')}.getBoundingClientRect();return Math.abs(b.bottom-bar.top)<=1&&bar.bottom<=innerHeight})()`));
    await shot('dock-fullscreen');
    await toggleFs();
    check('full: the button again goes back to the dock', await waitFor(`!(${FS_ON})&&${DOCKED}`, 2500));
    const again = await ev(RECT(PAL));
    check('full: the dock is where it was', Math.abs(again.l - dock.l) <= 1 && Math.abs(again.t - dock.t) <= 1 && Math.abs(again.b - dock.b) <= 1, again);

    // --- Esc ---------------------------------------------------------------------------------------------
    check('esc: Esc closes the dock', await closePalette());
    check('esc: and the board has its room back', await waitFor(`!${DOCKED}`, 2500) && Math.abs((await ev(RECT(BOARD))).w - before.w) <= 1);
    await ev(`openNotes({ kind: 'card-notes', id: '7' })`);
    await palUp();
    await toggleFs();
    check('esc: full screen again', await waitFor(FS_ON, 2500));
    check('esc: Esc closes it from full screen too', await closePalette());
  },
};
