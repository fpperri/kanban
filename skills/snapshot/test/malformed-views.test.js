const { test } = require('node:test');
const assert = require('node:assert');
const { byClass } = require('./page-harness');
const { withBuiltBoard } = require('./search-table');

// The malformed board carries a hierarchy, pills and type icons that are broken in places. The
// page draws every one of its four tabs from the cards it does have: the Board, the Map, the
// Gantt and the Calendar each show them, and nothing is logged as an error or a warning. The
// snapshot has no Graph view, so there is no fifth tab to draw. The other tests of the malformed
// board read the Board and the panel; this one reads the three tabs that were only run at load.

const quiet = () => {
  const logged = [];
  const record = (level) => (...args) => logged.push([level, ...args.map(String)]);
  return { logged, spy: { log: () => {}, info: () => {}, debug: () => {}, warn: record('warn'), error: record('error') } };
};

const shown = (page, id) => page.byId(id).style.display !== 'none';
const text = (node) => node.all().map((n) => n.textContent || '').join(' ');

test('the tabs are the Board, the Map, the Gantt and the Calendar, and the page has no Graph tab', () => {
  withBuiltBoard('malformed', (page, dir, html) => {
    const markup = html.slice(0, html.indexOf('<script>'));
    const tabs = [...markup.matchAll(/<button[^>]* data-view="([a-z]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(tabs, ['board', 'map', 'gantt', 'calendar']);
  });
});

test('the Map draws the malformed board: its status pills, its legend and the cards that relate', () => {
  const { logged, spy } = quiet();
  withBuiltBoard('malformed', (page) => {
    page.run('switchView("map")');
    assert.ok(shown(page, 'mapview'));
    const view = page.byId('mapview');
    assert.strictEqual(byClass(view, 'pillrow').length, 1, 'the status pills');
    assert.strictEqual(byClass(view, 'map-legend').length, 1, 'the legend');
    assert.ok(!text(view).includes('No cards to show'), 'it is not the empty Map');
    const labels = byClass(view, 'mnode').map((g) => byClass(g, 'mid')[0].textContent).sort();
    assert.deepStrictEqual(labels, ['#1', '#2', '#3'], 'the cards joined by a parent or a dependency line');
    assert.ok(byClass(view, 'map-title').length >= 1, 'a heading over its graphs');
    page.run('renderMap()');
    assert.strictEqual(byClass(page.byId('mapview'), 'mnode').length, 3, 'drawn again after the page is built');
  }, { console: spy });
  assert.deepStrictEqual(logged, [], 'nothing logged as an error or a warning');
});

test('the Gantt draws the malformed board: its status pills and the one dated card', () => {
  const { logged, spy } = quiet();
  withBuiltBoard('malformed', (page) => {
    page.run('switchView("gantt")');
    assert.ok(shown(page, 'ganttview'));
    const view = page.byId('ganttview');
    assert.strictEqual(byClass(view, 'pillrow').length, 1, 'the status pills');
    assert.ok(!text(view).includes('No dated cards to chart'), 'a dated card is charted');
    assert.ok(text(view).includes('#4'), 'card 4, the only one with a start date');
    page.run('renderGantt()');
    assert.ok(text(page.byId('ganttview')).includes('#4'), 'drawn again after the page is built');
  }, { console: spy });
  assert.deepStrictEqual(logged, [], 'nothing logged as an error or a warning');
});

test('the Calendar draws the malformed board: a month of days, and card 4 on its start date', () => {
  const { logged, spy } = quiet();
  withBuiltBoard('malformed', (page) => {
    page.run('switchView("calendar")');
    assert.ok(shown(page, 'calview'));
    assert.ok(byClass(page.byId('calview'), 'cal-cell').length >= 28, 'a month of days');
    assert.strictEqual(byClass(page.byId('calview'), 'pillrow').length, 1, 'the status pills');
    page.run('calY = 2030; calM = 0; renderCalendar()');
    const chips = byClass(page.byId('calview'), 'cal-chip').map((c) => c.textContent);
    assert.ok(chips.includes('#4'), `card 4 on January 2030: ${chips.join(' ')}`);
  }, { console: spy });
  assert.deepStrictEqual(logged, [], 'nothing logged as an error or a warning');
});

test('switching through every tab and back to the Board leaves the Board drawn', () => {
  const { logged, spy } = quiet();
  withBuiltBoard('malformed', (page) => {
    for (const view of ['map', 'gantt', 'calendar', 'board']) page.run(`switchView(${JSON.stringify(view)})`);
    assert.ok(shown(page, 'boardview'));
    const ids = page.byId('board').all().filter((n) => n.classList.contains('card')).map((n) => Number(n.dataset.card)).sort();
    assert.deepStrictEqual(ids, [1, 2, 3, 4], 'every live card is drawn');
  }, { console: spy });
  assert.deepStrictEqual(logged, [], 'nothing logged as an error or a warning');
});
