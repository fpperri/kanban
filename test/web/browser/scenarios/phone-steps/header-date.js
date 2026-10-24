'use strict';
// The Calendar's and the Gantt's date range on a 390 px phone: the header shows it in the row of the board
// name, the view's own row is one line (also on the feature board in Week with Notes shown), and a switch to
// the Board leaves the slot empty. From 760 px the view's title shows and the header slot does not.

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    const SLOT = `document.getElementById('header-date')`;
    const slotText = `(${SLOT}.textContent||'').trim()`;
    const titleOf = (view) => `((document.querySelector('#${view}-view .cal-title')||{}).textContent||'').trim()`;
    const shown = (el) => `(${el}.offsetWidth>0&&${el}.offsetHeight>0)`;
    const sameRow = (view) => `(()=>{
      const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
      const kids = [...document.querySelector('#${view}-view .cal-controls').children].filter((el) => el.offsetWidth > 0);
      const m = kids.map(mid);
      return { count: kids.length, oneLine: Math.max(...m) - Math.min(...m) < 6, withName: Math.abs(mid(document.querySelector('h1')) - mid(${SLOT})) < 6 };
    })()`;
    const spanTo = async (view, label) => {
      for (let i = 0; i < 6; i++) {
        if (await ev(`((document.querySelector('#${view}-view .cal-span-cycle')||{}).textContent||'').split(String.fromCharCode(8635))[0].trim()===${JSON.stringify(label)}`)) return true;
        await ev(`document.querySelector('#${view}-view .cal-span-cycle').click()`);
        await waitFor(`!!document.querySelector('#${view}-view .cal-span-cycle')`, 3000);
      }
      return false;
    };

    for (const [board, name] of [[undefined, 'plan'], ['feature', 'feature']]) {
      await open('/', board);
      check(`${name}: the Board draws`, await waitFor(`document.querySelectorAll('#board .column').length>0`, 10000));
      check(`${name}: on the Board the slot is empty and hidden`, await ev(`${slotText}===''&&!${shown(SLOT)}`));

      for (const view of ['calendar', 'gantt']) {
        await ev(`document.getElementById('${view}-toggle-btn').click()`);
        check(`${name}: the ${view} puts its date range in the header`, await waitFor(`${slotText}!==''&&${slotText}===${titleOf(view)}&&${shown(SLOT)}`, 10000), `${await ev(slotText)} | ${await ev(titleOf(view))}`);
        check(`${name}: the ${view} title in the view's row is hidden`, await ev(`!${shown(`document.querySelector('#${view}-view .cal-title')`)}`));
        for (const span of view === 'gantt' ? ['Month', 'Week', 'All'] : ['Week', 'Month']) {
          check(`${name}: the ${view} reaches ${span}`, await spanTo(view, span));
          check(`${name}: on ${span} the header shows the span's date range`, await waitFor(`${slotText}!==''&&${slotText}===${titleOf(view)}`, 5000), `${await ev(slotText)} | ${await ev(titleOf(view))}`);
          const row = await ev(sameRow(view));
          check(`${name}: on ${span} the date range is in the row of the board name`, row.withName, JSON.stringify(row));
          check(`${name}: on ${span} the ${view}'s own row is one line`, row.oneLine, JSON.stringify(row));
        }
        if (view === 'calendar') {
          check(`${name}: the Calendar reaches Week`, await spanTo('calendar', 'Week'));
          const notes = await ev(`document.getElementById('cal-notes-btn')`);
          if (notes) {
            if (!(await ev(`document.getElementById('cal-notes-btn').getAttribute('aria-pressed')==='true'`))) await ev(`document.getElementById('cal-notes-btn').click()`);
            check(`${name}: Notes are shown`, await waitFor(`document.getElementById('cal-notes-btn').getAttribute('aria-pressed')==='true'`, 5000));
            const row = await ev(sameRow('calendar'));
            check(`${name}: the Calendar's row is one line on Week with Notes shown`, row.oneLine, JSON.stringify(row));
          }
        }
        await ev(`document.getElementById('${view}-toggle-btn').click()`);
        check(`${name}: back on the Board the slot is empty and hidden`, await waitFor(`${slotText}===''&&!${shown(SLOT)}`, 5000));
      }
    }
  },
};
