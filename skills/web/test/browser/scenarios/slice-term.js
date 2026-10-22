'use strict';
// The slice: search term cuts every view to the same cards. On the plan board,
// whose hierarchy is goal, strategy, objective, epic, the cut goal..objective
// keeps the five cards of those three tiers on the Board, the Map and the Graph,
// and the Gantt lists, and the Calendar draws, none of the dated cards, which all sit
// outside it. On today's fixture board, which has no hierarchy, slice:1 keeps the
// depth-1 cards. On the malformed board, whose hierarchy lists goal and epic
// twice in mixed case, a cut by either name keeps that tier's card. The harness
// closes the scenario with the console-error check, which covers the malformed
// board's cuts.
//
// What each cut shows is written down in CASES, and
// skills/web/test/browser-slice-term.test.js holds those lists to the search module
// over each board's own cards, so a wrong expectation fails in the unit suite and
// not only in a browser.
//
// The search box also suggests what a slice: term can say: typing slice: opens a list of
// the board's slices, the tiers in hierarchy order and then the depths down to the deepest card,
// and pressing a row completes the term, which cuts as one typed by hand. On the plan
// board, pressing slice:strategy keeps the two strategy cards, then typing the dots lists
// the slices as the second end, and pressing slice:strategy..objective keeps the
// strategy and objective cards. The list and its rows are the combobox's own, a real
// press on a row writes the box, and what each list holds is in CASES.plan.suggest.
//
// The plan board's live cards are 1 to 18 and 22 to 29. Its goal cards are 1 and
// 25, its strategies 2 and 26, its objective 7. Only cards 28 and 29, both tasks
// with no parent, carry dates (in 2031 and 2020), so slice:0 keeps both of them
// among the depth-0 cards, and the cut keeps neither. The fixture board's live
// cards are 1 to 18, and cards 2 to 6 are the ones under the root card 1. The
// malformed board's live cards are 1 to 4: card 1 is typed Goal, card 2 epic.

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const CUT = 'slice:goal..objective';

const CASES = {
  plan: {
    live: [...range(1, 18), ...range(22, 29)],
    cut: { query: CUT, shows: [1, 2, 7, 25, 26] },
    depthZero: { query: 'slice:0', datedShows: [28, 29] },
    suggest: {
      typed: 'slice:',
      labels: ['slice:goal', 'slice:strategy', 'slice:objective', 'slice:epic', 'slice:0', 'slice:1'],
      first: { pick: 'slice:strategy', shows: [2, 26] },
      second: {
        typed: '..',
        labels: ['slice:strategy..goal', 'slice:strategy..strategy', 'slice:strategy..objective', 'slice:strategy..epic', 'slice:strategy..0', 'slice:strategy..1'],
        pick: 'slice:strategy..objective',
        shows: [2, 7, 26],
      },
    },
  },
  fixture: {
    live: range(1, 18),
    query: 'slice:1',
    shows: [2, 3, 4, 5, 6],
  },
  malformed: {
    live: range(1, 4),
    tier: { query: 'slice:goal', shows: [1] },
    other: { query: 'slice:EPIC', shows: [2] },
    run: { query: 'slice:goal..epic', shows: [1, 2] },
  },
};

// What each view draws a card as. A cut is read off these, so each names only
// real cards: the Map's stubs for cards a filter hid are not card-el. A card in
// the Map with some relation is a map-node, and one with none is a tile in the
// No relations row, so the Map is read off card-el alone. The Gantt lists a row in
// its gutter for every dated card, but draws the card's bar only inside a window
// that is cut to 180 days around today when the dated cards lie further apart, and
// the plan board's two (2020 and 2031) hold neither, so the Gantt is read off the rows.
const SELECTORS = {
  board: '#board .card-el',
  map: '#map-view .card-el',
  gantt: '#gantt-view .gantt-label[data-id]',
  calendar: '#calendar-view .cal-chip[data-id]',
  graph: '#graph-view .graph-node',
};

module.exports = {
  name: 'slice-term',
  board: 'plan',
  alsoBoards: ['fixture', 'malformed'],
  timeoutMs: 60000,
  CASES,
  SELECTORS,
  async run(page) {
    const { ev, send, open, waitFor, check, shot, click } = page;

    // A page that is being left still answers for a moment after the navigation
    // starts, so a wait on the new page would read the old one. The old page is
    // marked, and the new one is the first without the mark.
    const load = async (url, key) => {
      await ev('window.__stale=true');
      await open(url, key);
      return waitFor('!window.__stale', 10000);
    };
    const write = (text) => ev(`(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const idsExpr = (selector) => `JSON.stringify([...new Set([...document.querySelectorAll(${JSON.stringify(selector)})].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b))`;
    const shows = (selector, wanted, ms) => waitFor(`${idsExpr(selector)}===${JSON.stringify(JSON.stringify(wanted))}`, ms);
    const shownNow = (selector) => ev(idsExpr(selector));
    const drawn = (selector) => waitFor(`document.querySelectorAll(${JSON.stringify(selector)}).length>0`, 10000);

    const { board: BOARD, map: MAP, gantt: GANTT, calendar: CALENDAR, graph: GRAPH } = SELECTORS;

    // The search box's list: the rows the combobox draws under the box while it is open.
    const ROWS = `JSON.stringify([...document.querySelectorAll('#search-input ~ .combobox-menu:not([hidden]) .combobox-item')].map((e)=>e.textContent))`;
    const rowsAre = (labels) => waitFor(`${ROWS}===${JSON.stringify(JSON.stringify(labels))}`, 10000);
    const rowsNow = () => ev(ROWS);
    const boxNow = () => ev(`document.getElementById('search-input').value`);
    const typeInBox = (text) => send('Input.insertText', { text });
    // A real press on the row: the combobox takes the press itself, and keeps the focus in the box.
    const pressRow = async (label) => {
      const at = await ev(`(()=>{const e=[...document.querySelectorAll('#search-input ~ .combobox-menu .combobox-item')].find((x)=>x.textContent===${JSON.stringify(label)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      if (at === null) throw new Error(`the list has no row ${label}`);
      await click(at.x, at.y);
    };

    // --- the plan board, one view after another -----------------------------------------------
    const plan = CASES.plan;
    await load('/', 'plan');
    check('plan: the Board shows every live card before any cut', await shows(BOARD, plan.live, 10000), await shownNow(BOARD));
    await write(plan.cut.query);
    check('plan: slice:goal..objective on the Board shows only the goal, strategy and objective cards', await shows(BOARD, plan.cut.shows), await shownNow(BOARD));
    await shot('slice-board');

    await load('/?view=map', 'plan');
    check('plan: the Map draws cards before any cut', await drawn(MAP));
    await write(plan.cut.query);
    check('plan: the Map shows the same cards under the cut', await shows(MAP, plan.cut.shows), await shownNow(MAP));
    await shot('slice-map');

    await load('/?view=gantt', 'plan');
    await write(plan.depthZero.query);
    check('plan: slice:0 lists both dated cards on the Gantt', await shows(GANTT, plan.depthZero.datedShows, 10000), await shownNow(GANTT));
    await write(plan.cut.query);
    check('plan: the cut lists none of them on the Gantt', await shows(GANTT, []), await shownNow(GANTT));

    await load(`/?view=calendar&q=${encodeURIComponent(plan.depthZero.query)}`, 'plan');
    check('plan: slice:0 draws a dated card on the Calendar', await drawn(CALENDAR));
    await write(plan.cut.query);
    check('plan: the cut draws none of them on the Calendar', await shows(CALENDAR, []), await shownNow(CALENDAR));

    await load('/?view=graph', 'plan');
    check('plan: the Graph draws dots before any cut', await drawn(GRAPH));
    await write(plan.cut.query);
    check('plan: the Graph draws no dot outside the cut', await shows(GRAPH, plan.cut.shows), await shownNow(GRAPH));
    await shot('slice-graph');

    // --- the suggestions: the list after slice: and after .., and a row pressed -----------------------
    const suggest = plan.suggest;
    await load('/', 'plan');
    check('plan: the Board shows every live card before the box is typed in', await shows(BOARD, plan.live, 10000), await shownNow(BOARD));
    await ev(`document.getElementById('search-input').focus()`);
    await typeInBox(suggest.typed);
    check('plan: typing slice: lists the slices of the board, the tiers in hierarchy order and then the depths', await rowsAre(suggest.labels), await rowsNow());
    await shot('slice-suggest');
    await pressRow(suggest.first.pick);
    check('plan: pressing slice:strategy writes it in the box and shuts the list', await waitFor(`document.getElementById('search-input').value===${JSON.stringify(suggest.first.pick)}`) && await rowsAre([]), await boxNow());
    check('plan: the Board then keeps only the strategy cards', await shows(BOARD, suggest.first.shows), await shownNow(BOARD));
    await typeInBox(suggest.second.typed);
    check('plan: typing the dots after it lists the slices as the second end of the cut', await rowsAre(suggest.second.labels), await rowsNow());
    await pressRow(suggest.second.pick);
    check('plan: pressing slice:strategy..objective writes the whole cut in the box', await waitFor(`document.getElementById('search-input').value===${JSON.stringify(suggest.second.pick)}`), await boxNow());
    check('plan: the Board then keeps the strategy and objective cards', await shows(BOARD, suggest.second.shows), await shownNow(BOARD));

    // --- today's fixture board: no hierarchy, so a slice is a depth ------------------------------
    const fixture = CASES.fixture;
    await load('/', 'fixture');
    check('fixture: the Board shows every live card before any cut', await shows(BOARD, fixture.live, 10000), await shownNow(BOARD));
    await write(fixture.query);
    check('fixture: slice:1 keeps only the depth-1 cards', await shows(BOARD, fixture.shows), await shownNow(BOARD));

    // --- the malformed board: a tier listed twice in mixed case ----------------------------------
    const malformed = CASES.malformed;
    await load('/', 'malformed');
    check('malformed: the Board shows every live card before any cut', await shows(BOARD, malformed.live, 10000), await shownNow(BOARD));
    await write(malformed.tier.query);
    check('malformed: slice:goal keeps the card of the tier the board lists as Goal and goal', await shows(BOARD, malformed.tier.shows), await shownNow(BOARD));
    await write(malformed.other.query);
    check('malformed: slice:EPIC keeps the card of the tier the board lists as Epic and EPIC', await shows(BOARD, malformed.other.shows), await shownNow(BOARD));
    await write(malformed.run.query);
    check('malformed: slice:goal..epic keeps the cards of both tiers', await shows(BOARD, malformed.run.shows), await shownNow(BOARD));
  },
};
