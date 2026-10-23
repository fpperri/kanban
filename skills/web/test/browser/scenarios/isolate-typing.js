'use strict';
// Typing isolates, on the fixture board. Outside the Graph the search box hides what it does not match only
// while isolate is on, and a query the person makes (typing, a pill, a cue, a ?q= link) turns isolate on in a
// view whose Typing isolates checkbox is ticked: every view but the Graph, to start. With isolate off the box
// lights its matches with the selected look and hides nothing.
//
// The Board. Typing `zephyr` turns isolate on: the switch says on and the Board shows the four zephyr cards
// alone. The panel is shut and Esc with focus outside the box turns isolate off, which leaves the text in the
// box: the Board shows every card again and the four wear the selected look, though no card is selected. The i
// key then isolates that lit query as it stands, and the clear button ends it. The links: a ?q= link into the
// Board opens isolated, and into the Graph opens lighting, with isolate off and every dot drawn.
//
// The switch between views. A query typed on the Board isolates it; the Graph, whose checkbox is unticked, lights
// it, and back on the Board it isolates again, since each view follows its own checkbox on every switch.
//
// The Graph. Typing lights the matches and dims the rest, with isolate off and every dot drawn. Ticking the
// Graph's checkbox makes the same typing isolate: only the matches are drawn.
//
// The checkboxes. The panel's foot holds one for each view, the Graph's unticked. Unticking the Board's is kept
// per board in the browser, survives a reload, and makes typing on the Board light its matches, with isolate off.
//
// The zephyr cards are 1, 2, 7 and 11 of the fixture board's 18 live cards. Each step waits on the page, never
// on a fixed sleep. Keys and clicks go through the runner's helpers, a real key press and a real mouse click.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// isolateNow, selectedIds.

const CASES = {
  query: 'zephyr',
  cards: [1, 2, 7, 11],
  boards: ['fixture'],
  // The checkboxes, in the order the panel's foot lists the views, with the choice each starts at.
  checkboxes: [['board', true], ['calendar', true], ['gantt', true], ['map', true], ['graph', false]],
};

module.exports = {
  name: 'isolate-typing',
  board: 'fixture',
  timeoutMs: 90000,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, check } = page;
    const idsOf = (selector) => `JSON.stringify([...new Set([...document.querySelectorAll(${JSON.stringify(selector)})].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b))`;
    const shows = (selector, ids, ms) => waitFor(`${idsOf(selector)}===${JSON.stringify(JSON.stringify(ids))}`, ms);
    const nowShown = async (selector) => JSON.parse(await ev(idsOf(selector)));
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const BOARD = '#board .card-el';
    const BOARD_LIT = '#board .card-el.selected';
    const DOTS = '#graph-view .graph-node';
    const DOTS_LIT = '#graph-view .graph-node.graph-near';
    const SWITCH = `document.getElementById('isolate-switch')`;
    const switchIs = (on) => waitFor(`${SWITCH}.getAttribute('aria-checked')===${JSON.stringify(String(on))}`);
    const isolateIs = (on) => waitFor(on ? `isolateNow()!==null` : `isolateNow()===null`);
    const PANEL = `document.getElementById('search-panel')`;
    const panelOpen = `!${PANEL}.classList.contains('hidden')&&${PANEL}.getBoundingClientRect().height>0`;
    const panelShut = `${PANEL}.classList.contains('hidden')`;
    const TOGGLE = `document.getElementById('search-panel-toggle')`;
    const CHECKS = `JSON.stringify([...document.querySelectorAll('#search-typing [data-typing-view]')].map((b)=>[b.dataset.typingView,b.checked]))`;
    const checkboxesAre = (list) => waitFor(`${CHECKS}===${JSON.stringify(JSON.stringify(list))}`);
    const clearBox = async () => {
      await ev(`document.getElementById('search-clear-btn').click()`);
      return boxIs('');
    };
    // The panel opens when the box is focused; text goes in as trusted input, as a person types it.
    const typeQuery = async (text) => {
      await ev(`document.getElementById('search-input').focus()`);
      await send('Input.insertText', { text });
      return boxIs(text);
    };
    const blur = () => ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    // Closing the panel by hand is Esc with focus on the arrow, which leaves the switch on and focus off the box.
    const closePanel = async () => {
      if (await ev(panelOpen)) {
        await ev(`${TOGGLE}.focus()`);
        await key('Escape');
      }
      return waitFor(panelShut);
    };
    const clickOn = async (selector) => {
      const p = await centre(selector);
      if (!p) throw new Error(`nothing matches ${selector}`);
      await click(p.x, p.y);
    };
    const goto = async (target, ready) => {
      await ev(`window.__stale=true`);
      await open(target);
      await waitFor(`window.__stale!==true`, 10000);
      return waitFor(ready, 10000);
    };
    const boardReady = `document.querySelectorAll('#board .card-el').length>=18`;
    const graphReady = `document.querySelectorAll('#graph-view .graph-node').length>=18`;
    const reload = async () => {
      await ev(`window.__beforeReload = true`);
      await send('Page.reload');
      if (!(await waitFor(`window.__beforeReload === undefined`, 10000))) throw new Error('the page did not reload');
    };

    // --- the Board isolates what is typed, and Esc gives the lit query back -----------------------------------
    check('the Board draws the fixture board', await goto('/?view=board', boardReady));
    const live = await nowShown(BOARD);
    check('the panel holds a Typing isolates checkbox for each view, the Graph\'s unticked', await checkboxesAre(CASES.checkboxes), await ev(CHECKS));
    await typeQuery(CASES.query);
    check('typing on the Board turns isolate on: the switch says on and the Board shows the zephyr cards alone', await switchIs(true) && await isolateIs(true) && await shows(BOARD, CASES.cards), await nowShown(BOARD));
    check('and the cards it shows wear no selected look, since isolate hides the rest', (await nowShown(BOARD_LIT)).length === 0, await nowShown(BOARD_LIT));
    await blur();
    await closePanel();
    await key('Escape');
    check('Esc with focus outside the box turns isolate off, and the text stays in the box', await switchIs(false) && await isolateIs(false) && await boxIs(CASES.query), await boxText());
    check('the Board shows every card again and the zephyr cards wear the selected look', await shows(BOARD, live) && await shows(BOARD_LIT, CASES.cards), { shown: await nowShown(BOARD), lit: await nowShown(BOARD_LIT) });
    check('a lit card is no selected card, so a bulk action has nothing to act on', await ev(`selectedIds.size===0`));
    await blur();
    await key('i');
    check('the i key isolates that lit query as it stands: the box keeps its text and the Board shows the zephyr cards alone', await switchIs(true) && await boxIs(CASES.query) && await shows(BOARD, CASES.cards), await nowShown(BOARD));
    await clearBox();
    check('the clear button empties the box and ends isolate, and every card is back', await switchIs(false) && await shows(BOARD, live), await nowShown(BOARD));

    // --- each view follows its own checkbox on every switch ---------------------------------------------------
    const toggleGraph = () => ev(`document.getElementById('graph-toggle-btn').click()`);
    await typeQuery(CASES.query);
    await isolateIs(true);
    await blur();
    await toggleGraph();
    check('going to the Graph lights the typed query: isolate ends, every dot is drawn and the zephyr cards are lit', await waitFor(graphReady) && await isolateIs(false) && await switchIs(false) && await shows(DOTS_LIT, CASES.cards), { lit: await nowShown(DOTS_LIT) });
    check('and the query stays in the box', await boxIs(CASES.query), await boxText());
    await toggleGraph();
    check('back on the Board the typed query isolates again: the switch is on and the Board shows the zephyr cards alone', await waitFor(`!document.getElementById('board').classList.contains('hidden')`) && await isolateIs(true) && await switchIs(true) && await shows(BOARD, CASES.cards), await nowShown(BOARD));
    await clearBox();
    await shows(BOARD, live);

    // --- a ?q= link isolates in the Board, and lights in the Graph ------------------------------------------------
    check('a ?q= link into the Board opens it', await goto(`/?view=board&q=${CASES.query}`, `document.getElementById('search-input').value==='${CASES.query}'&&document.querySelectorAll('#board .card-el').length>0`));
    check('and opens isolated: the switch is on and the Board shows the zephyr cards alone', await switchIs(true) && await shows(BOARD, CASES.cards) && await boxIs(CASES.query), await nowShown(BOARD));
    check('and the address says so', await waitFor(`new URLSearchParams(location.search).get('isolate')==='1'`), await ev(`location.search`));
    check('a ?q= link into the Graph opens it', await goto(`/?view=graph&q=${CASES.query}`, graphReady));
    const dots = await nowShown(DOTS);
    check('and opens lighting: isolate is off, every dot is drawn and the zephyr cards are lit', await switchIs(false) && await isolateIs(false) && await shows(DOTS_LIT, CASES.cards) && dots.length >= 18, { dots, lit: await nowShown(DOTS_LIT) });

    // --- the address the page writes reopens the same picture: isolate=0 reopens lit, though the Board isolates what is typed -------
    check('a link with isolate=0 into the Board opens it', await goto(`/?view=board&q=${CASES.query}&isolate=0`, `document.getElementById('search-input').value==='${CASES.query}'&&document.querySelectorAll('#board .card-el').length>0`));
    check('and opens lit: isolate is off, every card is shown and the zephyr cards wear the selected look', await isolateIs(false) && await switchIs(false) && await shows(BOARD, live) && await shows(BOARD_LIT, CASES.cards), { shown: await nowShown(BOARD), lit: await nowShown(BOARD_LIT) });
    check('and the address stays as it was, isolate=0 beside q', await waitFor(`new URLSearchParams(location.search).get('isolate')==='0'`), await ev(`location.search`));
    await blur();
    await key('i');
    check('the i key isolates it, and the address then says isolate=1', await switchIs(true) && await waitFor(`new URLSearchParams(location.search).get('isolate')==='1'`), await ev(`location.search`));

    // --- the Graph lights what is typed, until its checkbox is ticked ------------------------------------------------
    check('the Graph draws the fixture board', await goto('/?view=graph', graphReady));
    await typeQuery(CASES.query);
    check('typing in the Graph lights the matches and draws every dot, with isolate off', await shows(DOTS_LIT, CASES.cards) && (await nowShown(DOTS)).length === dots.length && await isolateIs(false), { lit: await nowShown(DOTS_LIT) });
    await clickOn('#search-typing [data-typing-view="graph"]');
    check('ticking the Graph\'s checkbox is kept for the view', await checkboxesAre([['board', true], ['calendar', true], ['gantt', true], ['map', true], ['graph', true]]), await ev(CHECKS));
    await clearBox();
    await typeQuery(CASES.query);
    check('typing in the Graph now isolates: the switch says on and only the zephyr cards are drawn', await switchIs(true) && await shows(DOTS, CASES.cards), await nowShown(DOTS));
    await clearBox();
    await clickOn('#search-typing [data-typing-view="graph"]');
    await checkboxesAre(CASES.checkboxes);

    // --- the Board's checkbox, unticked, is kept and makes typing light ---------------------------------------------------------
    check('the Board draws the fixture board again', await goto('/?view=board', boardReady));
    await ev(`document.getElementById('search-input').focus()`);
    await waitFor(panelOpen);
    await clickOn('#search-typing [data-typing-view="board"]');
    check('unticking the Board\'s checkbox shows it unticked', await checkboxesAre([['board', false], ['calendar', true], ['gantt', true], ['map', true], ['graph', false]]), await ev(CHECKS));
    check('and the choice is kept in the browser, under the board\'s own preferences', await ev(`JSON.parse(localStorage.getItem('kanban.fixture.prefs')).typingIsolates.board===false`));
    await reload();
    await waitFor(boardReady, 10000);
    check('after a reload the Board\'s checkbox is still unticked', await checkboxesAre([['board', false], ['calendar', true], ['gantt', true], ['map', true], ['graph', false]]), await ev(CHECKS));
    await typeQuery(CASES.query);
    check('typing on the Board then lights: isolate stays off, every card is shown and the zephyr cards wear the selected look', await isolateIs(false) && await switchIs(false) && await shows(BOARD, live) && await shows(BOARD_LIT, CASES.cards), { shown: await nowShown(BOARD), lit: await nowShown(BOARD_LIT) });
    await clearBox();
    await ev(`localStorage.removeItem('kanban.fixture.prefs')`);
  },
};
