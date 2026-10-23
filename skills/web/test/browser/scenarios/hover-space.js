'use strict';
// Space takes the hover, on the plan board. With a card hovered, else focused, Space writes the sets On hover show
// ticks for it into the search box as alternatives (`dlinks:7 | hlinks:7`), and never turns isolate on, though typing
// the same text does on the Board. Shift+Space adds the card's terms to what the box holds as one more alternative,
// and an empty box takes them as a plain Space does. With no card hovered or focused, and in a text field, Space
// keeps its job (a line hovered in the Graph writes its cards: scenarios/graph-line-hover.js). Ctrl+Space is the key that selects the focused dot in the Graph.
//
// The Board. The pointer on card 7 (a mouseover on its tile, the event the page's hover listens to) and a real Space
// press leave `dlinks:7 | hlinks:7` in the box, isolate off, and the cards that text names (7, its parent 2, the
// card 8 that waits for it and its child 22) wearing the selected look, with every card still drawn and none
// selected. Shift+Space on card 3 adds `dlinks:3 | hlinks:3`; Space on it alone replaces the box; Shift+Space on an
// empty box writes the same as Space. A key that finds no card hovered leaves the box as it was, and in the box
// itself Space types a space. With a query typed first (`#7`, which turns isolate on in the Board) Shift+Space adds
// to it and isolate stays on. A set ticked in the panel is written as well, in the panel's order.
//
// The Graph. Space on a hovered dot writes the same text, which the Graph takes as the typed search: with the pointer
// gone the dot and its one-hop relations are lit, isolate still off. Ctrl+Space on a focused dot selects its card
// only, and Space on it again is the write once more. The Flow reads its own choice, `dlinks` alone.
//
// The plan board's live cards are 1 to 18 and 22 to 29. Each step waits on the page, never on a fixed sleep. Keys go
// through the runner's helper, a real key press; the pointer is the mouseover or mouseout the page listens to and
// the focus a focus() on the element.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur, hoveredId, isolateNow, selectedIds.

const CASES = {
  board: {
    first: 7,
    firstText: 'dlinks:7 | hlinks:7',
    firstLit: [2, 7, 8, 22],
    second: 3,
    secondText: 'dlinks:3 | hlinks:3',
    secondLit: [1, 3, 4, 6],
    addedText: 'dlinks:7 | hlinks:7 | dlinks:3 | hlinks:3',
    addedLit: [1, 2, 3, 4, 6, 7, 8, 22],
    typed: '#7',
    typedAdded: '#7 | dlinks:7 | hlinks:7',
    ticked: 'hpath',
    tickedText: 'hpath:7 | dlinks:7 | hlinks:7',
  },
  graph: { dot: 2, text: 'dlinks:2 | hlinks:2', lit: [1, 2, 6, 7, 8], focused: 7, focusedText: 'dlinks:7 | hlinks:7' },
  flow: { dot: 3, text: 'dlinks:3' },
};

module.exports = {
  name: 'hover-space',
  board: 'plan',
  timeoutMs: 120000,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, key, check } = page;
    const idsOf = (selector) => `JSON.stringify([...new Set([...document.querySelectorAll(${JSON.stringify(selector)})].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b))`;
    const shows = (selector, ids) => waitFor(`${idsOf(selector)}===${JSON.stringify(JSON.stringify(ids))}`);
    const nowShown = async (selector) => JSON.parse(await ev(idsOf(selector)));
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const BOARD = '#board .card-el';
    const BOARD_LIT = '#board .card-el.selected';
    const DOTS_LIT = '#graph-view .graph-node.graph-near';
    const DOTS_SELECTED = '#graph-view .graph-node.selected';
    const CARD = (id) => `#board .card-el[data-id="${id}"]`;
    const DOT = (id) => `.graph-node:not(.graph-flow-lane-head)[data-id="${id}"]`;
    const SWITCH = `document.getElementById('isolate-switch')`;
    const isolateIs = (on) => waitFor(`${SWITCH}.getAttribute('aria-checked')===${JSON.stringify(String(on))}&&${on ? 'isolateNow()!==null' : 'isolateNow()===null'}`);
    const hoveredIs = (id) => waitFor(id === null ? `hoveredId===null` : `hoveredId==='${id}'`);
    const over = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
    const out = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`);
    const clearBox = async () => {
      await ev(`document.getElementById('search-clear-btn').click()`);
      return boxIs('');
    };
    const blur = () => ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    const typeQuery = async (text) => {
      await ev(`document.getElementById('search-input').focus()`);
      await send('Input.insertText', { text });
      return boxIs(text);
    };
    const goto = async (target, ready) => {
      await ev(`window.__stale=true`);
      await open(target);
      await waitFor(`window.__stale!==true`, 10000);
      return waitFor(ready, 10000);
    };
    const boardReady = `document.querySelectorAll('#board .card-el').length>20`;
    const graphReady = `document.querySelectorAll('#graph-view .graph-node').length>20`;
    const flowReady = `graphCur.kind==='flow'&&document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)').length>0`;
    const c = CASES.board;

    // --- the Board: Space writes the hovered card's sets and leaves isolate as it was ----------------------------------
    check('the Board draws the plan board', await goto('/?view=board', boardReady));
    const live = await nowShown(BOARD);
    await over(CARD(c.first));
    check('the pointer on a card hovers it', await hoveredIs(c.first));
    await key(' ');
    check('Space writes the hovered card\'s ticked sets into the box as alternatives', await boxIs(c.firstText), await boxText());
    check('and isolate stays off, though typing the same text would turn it on in the Board', await isolateIs(false));
    check('the Board draws every card still, and the cards the text names wear the selected look', await shows(BOARD, live) && await shows(BOARD_LIT, c.firstLit), { shown: await nowShown(BOARD), lit: await nowShown(BOARD_LIT) });
    check('and none of them is selected, since a lit card is no selected card', await ev(`selectedIds.size===0`));

    await out(CARD(c.first));
    await hoveredIs(null);
    await over(CARD(c.second));
    await hoveredIs(c.second);
    await key(' ', { shift: true });
    check('Shift+Space on another card adds its terms to what the box holds as more alternatives', await boxIs(c.addedText), await boxText());
    check('and the Board lights both cards\' sets, with isolate still off', await shows(BOARD_LIT, c.addedLit) && await isolateIs(false), await nowShown(BOARD_LIT));
    await key(' ');
    check('Space on a card replaces what the box held', await boxIs(c.secondText) && await shows(BOARD_LIT, c.secondLit), await boxText());
    await clearBox();
    await over(CARD(c.second));
    await hoveredIs(c.second);
    await key(' ', { shift: true });
    check('Shift+Space on an empty box writes what Space does', await boxIs(c.secondText), await boxText());

    // --- Space keeps its job ---------------------------------------------------------------------------------------------
    await out(CARD(c.second));
    await hoveredIs(null);
    await key(' ');
    check('with no card hovered or focused Space leaves the box as it was', await boxIs(c.secondText), await boxText());
    await clearBox();
    await ev(`document.getElementById('search-input').focus()`);
    await over(CARD(c.first));
    check('the pointer on a card hovers it while the box has the focus', await hoveredIs(c.first));
    await key('a');
    await key(' ');
    check('in the search box Space types a space, and the hovered card writes nothing', await waitFor(`document.getElementById('search-input').value==='a '`), await boxText());
    await clearBox();
    await blur();
    await out(CARD(c.first));

    // --- a query typed first, and a set ticked in the panel --------------------------------------------------------------
    await typeQuery(c.typed);
    check('a query typed on the Board turns isolate on', await isolateIs(true));
    await blur();
    await over(CARD(c.first));
    await hoveredIs(c.first);
    await key(' ', { shift: true });
    check('Shift+Space adds the card\'s terms to the typed query as more alternatives, and isolate stays on', await boxIs(c.typedAdded) && await isolateIs(true), await boxText());
    await clearBox();
    await out(CARD(c.first));
    await hoveredIs(null);
    await ev(`document.getElementById('search-input').focus()`);
    await waitFor(`!document.getElementById('search-panel').classList.contains('hidden')&&document.getElementById('search-panel').getBoundingClientRect().height>0`);
    await ev(`document.querySelector('#search-hover [data-hover-kind="${c.ticked}"]').click()`);
    await waitFor(`document.querySelector('#search-hover [data-hover-kind="${c.ticked}"]').checked`);
    await blur();
    await over(CARD(c.first));
    await hoveredIs(c.first);
    await key(' ');
    check('a set ticked in the panel is written too, in the panel\'s order', await boxIs(c.tickedText), await boxText());
    await out(CARD(c.first));
    await clearBox();
    await ev(`document.getElementById('search-input').focus()`);
    await ev(`document.querySelector('#search-hover [data-hover-kind="${c.ticked}"]').click()`);
    await waitFor(`!document.querySelector('#search-hover [data-hover-kind="${c.ticked}"]').checked`);
    await blur();

    // --- the Graph: the same text is the typed search, and Ctrl+Space selects --------------------------------------------
    const g = CASES.graph;
    check('the Graph draws the plan board', await goto('/?view=graph', graphReady));
    await over(DOT(g.dot));
    check('the pointer on a dot hovers its card', await hoveredIs(g.dot));
    await key(' ');
    check('Space on a hovered dot writes the same text', await boxIs(g.text), await boxText());
    await out(DOT(g.dot));
    await hoveredIs(null);
    check('the Graph lights what the text names, as a typed search, with isolate off', await shows(DOTS_LIT, g.lit) && await isolateIs(false), await nowShown(DOTS_LIT));
    await ev(`document.querySelector(${JSON.stringify(DOT(g.focused))}).focus()`);
    check('focus on a dot counts as hover', await hoveredIs(g.focused));
    await key(' ', { ctrl: true });
    check('Ctrl+Space on a focused dot selects its card alone', await waitFor(`JSON.stringify([...selectedIds].map(Number))===${JSON.stringify(JSON.stringify([g.focused]))}`) && await shows(DOTS_SELECTED, [g.focused]), await nowShown(DOTS_SELECTED));
    await ev(`document.querySelector(${JSON.stringify(DOT(g.focused))}).focus()`);
    await hoveredIs(g.focused);
    await key(' ');
    check('and Space on it is the write again, with the focused card standing for the hover', await boxIs(g.focusedText), await boxText());

    // --- the Flow reads its own choice -----------------------------------------------------------------------------------
    check('the Flow draws the plan board', await goto('/?view=graph&graph=flow', flowReady));
    await over(DOT(CASES.flow.dot));
    await hoveredIs(CASES.flow.dot);
    await key(' ');
    check('in the Flow Space writes its own choice, dlinks alone', await boxIs(CASES.flow.text), await boxText());
  },
};
