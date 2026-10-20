'use strict';
// The Statuses section at the top of the search panel, at 1440 on the plan board: on the Gantt a tap on
// Done in the section changes the view and holds through the 5-second refresh with focus still on the
// pill; the Calendar, the Map and the Graph each show their own state (Archive on for the Map); a
// right-click solos; with every status off the section still shows and one tap brings cards back; on
// the Board the section is hidden; a tap and a right-click leave a selection unchanged.

const WIDTH = 1440;
const REFRESH_MS = 6000;

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, centre, click, rightClick, check, sleep } = page;
    const SECTION = `document.getElementById('search-statuses-section')`;
    const pillSel = (col) => `#search-statuses .status-pill[data-col="${col}"]`;
    const pressed = `JSON.stringify([...document.querySelectorAll('#search-statuses .status-pill')].filter((b)=>b.getAttribute('aria-pressed')==='true').map((b)=>b.dataset.col))`;
    const sameJson = (expr, wanted) => `${expr}===${JSON.stringify(JSON.stringify(wanted))}`;
    const toggleBtn = { gantt: 'gantt-toggle-btn', calendar: 'calendar-toggle-btn', map: 'map-toggle-btn', graph: 'graph-toggle-btn' };
    const COLUMNS = ['backlog', 'todo', 'doing', 'done'];

    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
    await open('/');
    check('the Board draws at 1440', await waitFor(`innerWidth===${WIDTH}&&document.querySelectorAll('#board .column .card-el').length>0`, 10000), await ev('innerWidth'));
    check('on the Board the Statuses section is hidden', await waitFor(`${SECTION}.classList.contains('hidden')`));

    const showView = async (view) => {
      await ev(`document.getElementById('${toggleBtn[view]}').click()`);
      return waitFor(`!${SECTION}.classList.contains('hidden')&&document.querySelectorAll('#search-statuses .status-pill').length>0`, 10000);
    };
    const openPanel = async () => {
      await ev(`document.getElementById('search-input').focus()`);
      return waitFor(`!document.getElementById('search-panel').classList.contains('hidden')`);
    };
    const tapPill = async (col) => { const p = await centre(pillSel(col)); await click(p.x, p.y); };

    check('the Gantt shows the section', await showView('gantt'));
    check('the panel opens with the Statuses section first and open', await openPanel()
      && await ev(`document.querySelector('#search-panel .search-section').id==='search-statuses-section'&&document.getElementById('search-statuses-fold').getAttribute('aria-expanded')==='true'`));
    check('the Gantt\'s section holds every status and Archive, Archive off to start',
      await waitFor(sameJson(pressed, COLUMNS), 5000), await ev(pressed));

    await ev(`setSelection({ anchor: cardPart([...shownCardIds()][0]), additions: [] }, [...shownCardIds()][0])`);
    const selectionBefore = await ev(`JSON.stringify([...selectedIds])`);

    await tapPill('done');
    check('a tap on Done in the section switches it off, and the Gantt holds no pill of its own',
      await waitFor(`document.querySelector(${JSON.stringify(pillSel('done'))}).getAttribute('aria-pressed')==='false'&&!document.querySelector('#gantt-view .status-pill')`, 5000));
    await sleep(REFRESH_MS);
    check('it holds through the 5-second refresh, focus still on the pill',
      await ev(`document.querySelector(${JSON.stringify(pillSel('done'))}).getAttribute('aria-pressed')==='false'&&document.activeElement===document.querySelector(${JSON.stringify(pillSel('done'))})`));

    await rightClick(pillSel('doing'));
    check('a right-click solos the status', await waitFor(sameJson(pressed, ['doing']), 5000), await ev(pressed));
    await rightClick(pillSel('doing'));
    check('a right-click on the soloed one restores every status', await waitFor(sameJson(pressed, [...COLUMNS, 'archive']), 5000), await ev(pressed));
    check('a tap and a right-click left the selection unchanged', await ev(`JSON.stringify([...selectedIds])`) === selectionBefore, await ev(`JSON.stringify([...selectedIds])`));

    for (const col of [...COLUMNS, 'archive']) {
      if (await ev(`document.querySelector(${JSON.stringify(pillSel(col))}).getAttribute('aria-pressed')==='true'`)) await tapPill(col);
    }
    check('with every status off the section still shows every pill',
      await waitFor(`${sameJson(pressed, [])}&&document.querySelectorAll('#search-statuses .status-pill').length===${COLUMNS.length + 1}&&!${SECTION}.classList.contains('hidden')`, 5000), await ev(pressed));
    await tapPill('todo');
    check('one tap brings cards back', await waitFor(`${sameJson(pressed, ['todo'])}&&document.querySelectorAll('#gantt-view .gantt-bar').length>0`, 5000), await ev(pressed));
    await rightClick(pillSel('todo'));
    await waitFor(sameJson(pressed, [...COLUMNS, 'archive']), 5000);

    check('the Calendar shows its own state', await showView('calendar')
      && await waitFor(sameJson(pressed, COLUMNS), 5000), await ev(pressed));
    check('the Map shows its own state, Archive on', await showView('map')
      && await waitFor(sameJson(pressed, [...COLUMNS, 'archive']), 5000), await ev(pressed));
    check('the Graph shows its own state', await showView('graph')
      && await waitFor(sameJson(pressed, COLUMNS), 5000), await ev(pressed));

    await ev(`document.getElementById('graph-toggle-btn').click()`);
    check('back on the Board the section is hidden', await waitFor(`${SECTION}.classList.contains('hidden')`, 5000));
  },
};
