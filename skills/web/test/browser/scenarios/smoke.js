'use strict';
// Every view, on the plan board and on the malformed board, with the page code
// as it stands. A board that carries keys this page does not know (a hierarchy,
// pills, type icons, some of them broken) must still load and draw, so that a
// board written for a newer plugin opens on an older one. The harness closes
// the scenario with the console-error check, which covers both boards.
//
// Each view is loaded cold from its deep link, then waited for on what the page
// shows: its container visible and something drawn in it.

const { BOARDS } = require('../boards');

const shown = (id) => `!document.getElementById('${id}').classList.contains('hidden')`;

const VIEWS = [
  { view: 'board', ready: `${shown('board')}&&document.querySelectorAll('#board .column .card-el').length>0` },
  { view: 'map', ready: `${shown('map-view')}&&document.querySelectorAll('#map-view .map-node, #map-view .card-el').length>0` },
  { view: 'calendar', ready: `${shown('calendar-view')}&&document.querySelectorAll('#calendar-view .cal-day').length>=28` },
  { view: 'gantt', ready: `${shown('gantt-view')}&&document.querySelectorAll('#gantt-view .gantt-body, #gantt-view .gantt-empty').length>0` },
  { view: 'graph', ready: `${shown('graph-view')}&&document.querySelectorAll('#graph-view .graph-node').length>0` },
];

const [PRIMARY, ...ALSO] = ['plan', 'malformed'];

module.exports = {
  name: 'smoke',
  board: PRIMARY,
  alsoBoards: ALSO,
  VIEWS,
  async run(page) {
    for (const key of [PRIMARY, ...ALSO]) {
      for (const { view, ready } of VIEWS) {
        await page.open(`/?view=${view}`, key);
        const drawn = await page.waitFor(ready, 10000);
        page.check(`${key}: the ${view} view renders`, drawn, drawn ? undefined : await page.ev('location.href'));
        if (view === 'board') {
          const served = await page.ev(`document.getElementById('project-name').textContent`);
          page.check(`${key}: the page is serving the ${key} board`, served === BOARDS[key].name, served);
        }
      }
    }
  },
};
