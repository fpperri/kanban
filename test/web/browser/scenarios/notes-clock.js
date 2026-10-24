'use strict';
// A notes palette left open reads the clock when it writes, on the notes board. The date and time
// fields start on Today and Now, which Enter works out when it is pressed; a date or time picked
// or typed is used as it is. The page's clock is the one days.js keeps (window.kanbanDays.setClock),
// so the scenario moves it past midnight and on and never waits on real time. The palette is opened at
// 23:58 on Wed 21 Oct 2026; the clock moves to 00:03 on the 22nd, and a note written then lands on
// the 22nd at 00:03, not on the 21st at 23:58. The preview and the Day range follow the clock when the
// page becomes visible again. Then a date is picked in the date picker and a time in the time menu:
// the clock moves on and the note lands on the picked date and time, also when the picked values
// equal today and now; the Today and Now buttons put the fields back; an hour of the Calendar opens
// the fields on its own day and time.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// openNotes, state.

const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const q = (sel) => `document.querySelector(${JSON.stringify(`#notes-palette ${sel}`)})`;
const clockAt = (y, m, d, h, min) => `window.kanbanDays.setClock(()=>new Date(${y},${m - 1},${d},${h},${min},10))`;
const shown = `document.dispatchEvent(new Event('visibilitychange'))`;
const written = (target, text, day, at) => `state.logbook.notes.some((n)=>n.target===${JSON.stringify(target)}&&n.note===${JSON.stringify(text)}&&n.day===${JSON.stringify(day)}&&n.at===${JSON.stringify(at)})`;

module.exports = {
  name: 'notes-clock',
  board: 'notes',
  timeoutMs: 80000,
  async run(page) {
    const { ev, open, waitFor, key, check } = page;
    const setBox = (text) => ev(`(()=>{const i=${q('.np-input')};i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return true})()`);
    const fieldsAre = (day, time) => waitFor(`${q('.np-date')}.value===${JSON.stringify(day)}&&${q('.np-time')}.value===${JSON.stringify(time)}`, 4000);
    const previewIs = (text) => waitFor(`${q('.np-prev-text')}.textContent===${JSON.stringify(text)}`, 4000);
    const rangeIs = (text) => waitFor(`${q('.np-range-label')}.textContent===${JSON.stringify(text)}`, 4000);
    const setField = (sel, text) => ev(`(()=>{const f=${q(sel)};f.value=${JSON.stringify(text)};f.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const pressed = () => ev(`[${q('.np-today-btn')},${q('.np-now-btn')}].map((b)=>b.getAttribute('aria-pressed')).join()`);
    const press = (button) => ev(`${q(button)}.click()`);
    // The date picker's own grid: open it from the field's button and pick a day of the month it shows.
    const pickDay = async (day) => {
      await press('.np-date-btn');
      if (!(await waitFor(`!!document.querySelector('.date-picker-pop .dp-day[data-day="${day}"]')`, 3000))) return false;
      await ev(`document.querySelector('.date-picker-pop .dp-day[data-day="${day}"]').click()`);
      return waitFor(`${q('.np-date')}.value===${JSON.stringify(day)}`, 3000);
    };
    // The time menu: focus the field and choose a row, as the combobox's own rows are chosen (on mousedown).
    const pickTime = async (time) => {
      await ev(`(()=>{const t=${q('.np-time')};t.blur();t.focus()})()`);
      const rows = `[...document.querySelectorAll('.np-time-menu .combobox-item')]`;
      if (!(await waitFor(`${rows}.some((r)=>r.textContent===${JSON.stringify(time)})`, 3000))) return false;
      await ev(`${rows}.find((r)=>r.textContent===${JSON.stringify(time)}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))`);
      return waitFor(`${q('.np-time')}.value===${JSON.stringify(time)}`, 3000);
    };

    await open('/?view=board');
    check('notes-clock: the board is drawn with its logbook', await waitFor(`document.querySelectorAll('#board .card-el').length>20&&state.logbook&&state.logbook.notes.length===6`, 10000));
    await ev(clockAt(2026, 10, 21, 23, 58));
    await ev(`openNotes({})`);
    check('notes-clock: the palette opens with the date on Today and the time on Now', await waitFor(PAL_UP, 3000) && await fieldsAre('Today', 'Now') && await pressed() === 'true,true', await pressed());
    check('notes-clock: its Day range is the clock\'s day', await rangeIs('Wed 21 Oct'));

    // --- the clock moves past midnight and Enter writes the new day and time --------------------------------
    await ev(clockAt(2026, 10, 22, 0, 3));
    await setBox('#7 after midnight');
    check('notes-clock: the preview says the time of now', await previewIs('Note at 00:03 on #7 Port the zephyr schema'));
    await key('Enter');
    check('notes-clock: Enter writes the note on the 22nd at 00:03, not on the 21st at 23:58', await waitFor(written('7', 'after midnight', '2026-10-22', '00:03'), 5000));
    check('notes-clock: and the fields are still on Today and Now', await fieldsAre('Today', 'Now'));

    // --- the preview and the range follow the clock when the page is shown again -------------------------------
    await setBox('#7 once more');
    await ev(clockAt(2026, 10, 22, 0, 9));
    await ev(shown);
    check('notes-clock: the preview moves to the minute of now', await previewIs('Note at 00:09 on #7 Port the zephyr schema'));
    check('notes-clock: the Day range moved to the new today with the clock', await rangeIs('Thu 22 Oct'));
    await ev(clockAt(2026, 10, 23, 0, 1));
    await ev(shown);
    check('notes-clock: across midnight the preview and the Day range move to the new day', await previewIs('Note at 00:01 on #7 Port the zephyr schema') && await rangeIs('Fri 23 Oct'));

    // --- a date and a time picked are used as picked -------------------------------------------------------------
    check('notes-clock: a day picked in the date picker fills the date field', await pickDay('2026-10-14') && await pressed() === 'false,true', await pressed());
    check('notes-clock: a time picked in the time menu fills the time field', await pickTime('09:30') && await pressed() === 'false,false', await pressed());
    await ev(clockAt(2026, 10, 24, 6, 0));
    await ev(shown);
    check('notes-clock: the picked day and time stay while the clock moves, and the preview names them', await fieldsAre('2026-10-14', '09:30') && await previewIs('Note at 09:30, Wed 14, on #7 Port the zephyr schema'));
    await setBox('#7 once more'); // the picker left the focus in the date field
    await key('Enter');
    check('notes-clock: Enter writes the picked date and time', await waitFor(written('7', 'once more', '2026-10-14', '09:30'), 5000) && await fieldsAre('2026-10-14', '09:30'));

    // --- Today and Now put the fields back ---------------------------------------------------------------------------
    await setBox('#7 back on the clock');
    await ev(clockAt(2026, 10, 25, 12, 0));
    await press('.np-today-btn');
    await press('.np-now-btn');
    check('notes-clock: the Today and Now buttons put the fields back', await fieldsAre('Today', 'Now') && await pressed() === 'true,true', await pressed());
    await setBox('#7 back on the clock');
    await key('Enter');
    check('notes-clock: Enter then writes the day and time of the moment', await waitFor(written('7', 'back on the clock', '2026-10-25', '12:00'), 5000));

    // --- a picked value equal to today and now is still the picked value -------------------------------------
    await setField('.np-date', '2026-10-25');
    await setField('.np-time', '12:00');
    await setBox('#7 equal to now');
    await ev(clockAt(2026, 10, 26, 1, 0));
    await key('Enter');
    check('notes-clock: a value picked equal to today and now is not worked out again at Enter', await waitFor(written('7', 'equal to now', '2026-10-25', '12:00'), 5000));

    // --- an hour of the Calendar opens the fields on its own day and time -----------------------------------------
    await ev(`openNotes({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 })`);
    check('notes-clock: opened on an hour of another day, the fields start there', await fieldsAre('2026-10-14', '09:00'));
    await ev(clockAt(2026, 10, 27, 12, 0));
    await ev(shown);
    await setBox('#7 in the hour');
    await key('Enter');
    check('notes-clock: the hour keeps its day and time after the clock moved on', await waitFor(written('7', 'in the hour', '2026-10-14', '09:00'), 5000) && await fieldsAre('2026-10-14', '09:00'));
  },
};
