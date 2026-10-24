'use strict';
// The Calendar and the Gantt jump to the nearest match, on the plan board. That
// board has two dated cards: card 29, in February 2020, and card 28 ("Plan the
// centennial review"), which runs 2 to 20 June 2031 with a due date on the 25th.
// A query that matches card 28 alone leaves no match in the month the views open
// on, so the view moves to June 2031.
//
// Nothing here names a month of today's date: the views open on the page's own
// current month, read from the page, and every wait is on what the page shows (a
// view's title), never on a pause. The query is written the way a person types it:
// the box gets its text and an input event.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// autoRefreshTick.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const QUERY = 'centennial';
const MATCH_MONTH = 'June 2031';

// "June 2031" for month index 5 of 2031; an index past 11 or below 0 rolls the year.
const monthName = (year, monthIndex) => `${MONTHS[((monthIndex % 12) + 12) % 12]} ${year + Math.floor(monthIndex / 12)}`;

module.exports = {
  name: 'calendar-jump',
  board: 'plan',
  timeoutMs: 60000,
  async run(page) {
    const { ev, open, waitFor, check, shot } = page;

    // A page that is being left still answers for a moment after the navigation
    // starts, so a wait on the new page's box would read the old one. The old page
    // is marked, and the new one is the first without the mark.
    const load = async (url) => {
      await ev('window.__stale=true');
      await open(url);
      return waitFor('!window.__stale', 10000);
    };
    const titleOf = (view) => ev(`((document.querySelector('#${view}-view .cal-title')||{}).textContent||'')`);
    const titleIs = (view, text, ms) => waitFor(`((document.querySelector('#${view}-view .cal-title')||{}).textContent||'')===${JSON.stringify(text)}`, ms);
    const write = (text) => ev(`(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const press = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`, 10000);
    const shown = (id) => `!document.getElementById('${id}').classList.contains('hidden')`;
    const calendarDrawn = `${shown('calendar-view')}&&document.querySelectorAll('#calendar-view .cal-day').length>=28`;
    const ganttDrawn = `${shown('gantt-view')}&&document.querySelectorAll('#gantt-view .gantt-body, #gantt-view .gantt-empty').length>0`;

    // The poll repaints the view from scratch. A mark put on the title before it is
    // gone afterwards, so the check that the month was kept is not made on a view
    // the poll never touched.
    const pollRepaints = async (view) => {
      await ev(`document.querySelector('#${view}-view .cal-title').dataset.probe='1'`);
      await ev(`(async()=>{await autoRefreshTick();})()`);
      return waitFor(`!document.querySelector('#${view}-view .cal-title[data-probe]')`);
    };

    // --- the Calendar, month view, on the page's own current month ---------------------------------
    await load('/?view=calendar');
    check('the Calendar opens', await waitFor(calendarDrawn, 10000));
    const [year, monthIndex] = await ev(`(()=>{const d=new Date();return [d.getFullYear(),d.getMonth()]})()`);
    const thisMonth = monthName(year, monthIndex);
    check('the Calendar\'s month view opens on the page\'s own current month', await titleIs('calendar', thisMonth), await titleOf('calendar'));

    await write(QUERY);
    check('a query that matches only the card dated in 2031 moves the Calendar to that card\'s month', await titleIs('calendar', MATCH_MONTH), await titleOf('calendar'));
    check('and the card is drawn there', await waitFor(`!!document.querySelector('#calendar-view .cal-chip[data-id="28"]')`));
    await shot('calendar-jumped');

    // --- after a jump the Calendar pages as usual, and a poll keeps the paged month ---------------------
    await press('#cal-next-btn');
    check('after a jump, next pages one month on', await titleIs('calendar', monthName(2031, 6)), await titleOf('calendar'));
    await press('#cal-prev-btn');
    await press('#cal-prev-btn');
    check('and previous pages back', await titleIs('calendar', monthName(2031, 4)), await titleOf('calendar'));
    check('a poll repaints the Calendar', await pollRepaints('calendar'));
    check('and keeps the paged month', (await titleOf('calendar')) === monthName(2031, 4), await titleOf('calendar'));

    // --- entering the Calendar with the query already in the box -------------------------------------------
    await load(`/?view=board&q=${QUERY}`);
    check('the box holds the query on the Board', await boxIs(QUERY));
    await press('#calendar-toggle-btn');
    check('entering the Calendar with that query already in the box shows the 2031 month', await titleIs('calendar', MATCH_MONTH), await titleOf('calendar'));

    await load(`/?view=calendar&q=${QUERY}`);
    check('a link into the Calendar with the query shows the 2031 month', await titleIs('calendar', MATCH_MONTH, 10000), await titleOf('calendar'));

    // --- the Gantt: the All sub-view never moves, a sized sub-view does --------------------------------------
    await load('/?view=gantt');
    check('the Gantt opens', await waitFor(ganttDrawn, 10000));
    check('the Gantt opens on its All sub-view', await titleIs('gantt', 'All dated cards'), await titleOf('gantt'));
    await write(QUERY);
    check('the query is in the box', await boxIs(QUERY));
    await press('#gantt-view .cal-subview-btn[data-subview="month"]');
    check('the All sub-view did not move: its Month sub-view opens on the page\'s own current month', await titleIs('gantt', thisMonth), await titleOf('gantt'));

    await write('');
    await write(QUERY);
    check('a query that matches only the card dated in 2031 moves the Gantt\'s month sub-view to that card\'s month', await titleIs('gantt', MATCH_MONTH), await titleOf('gantt'));
    check('and the card\'s bar is drawn there', await waitFor(`!!document.querySelector('#gantt-view .gantt-bar[data-id="28"]')`));
    await shot('gantt-jumped');

    await press('#gantt-next-btn');
    check('after a jump, the Gantt\'s next pages one month on', await titleIs('gantt', monthName(2031, 6)), await titleOf('gantt'));
    await press('#gantt-prev-btn');
    await press('#gantt-prev-btn');
    check('and previous pages back', await titleIs('gantt', monthName(2031, 4)), await titleOf('gantt'));
    check('a poll repaints the Gantt', await pollRepaints('gantt'));
    check('and keeps the paged month', (await titleOf('gantt')) === monthName(2031, 4), await titleOf('gantt'));

    // --- entering the Gantt, which now remembers its Month sub-view --------------------------------------------
    await load(`/?view=board&q=${QUERY}`);
    check('the box holds the query on the Board again', await boxIs(QUERY));
    await press('#gantt-toggle-btn');
    check('entering the Gantt with that query already in the box shows the 2031 month', await titleIs('gantt', MATCH_MONTH), await titleOf('gantt'));
  },
};
