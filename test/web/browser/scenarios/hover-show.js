'use strict';
// "On hover show", on the plan board. The search panel has six checkboxes, one per set (dtree, htree, dpath, hpath,
// dlinks, hlinks), and hovering or focusing a card lights the union of the ticked sets for it in every view: the
// Board gives each card of the union the hover look, the Graph lights them with the rest dimmed and keeps the hover
// ring on the hovered card alone. The choice is kept per board and is one for every view, the Flow included: dlinks
// and hlinks are ticked at first, with the Hierarchy and Dependencies toggles on their & states. Each step
// waits on the page, never on a fixed sleep, and the pointer is a mouseover or mouseout on the card or its dot
// and the focus a focus() on it, which are the events the page's hover listens to; a checkbox is pressed with
// click(), which toggles it and fires the change the page listens to.
//
// What each choice lights is written down in CASES, and test/web/browser-hover-show-scenario.test.js holds
// those lists to the sets over the plan board's own cards, so a wrong expectation fails in the unit suite and not
// only in a browser.
//
// The plan board's live cards are 1 to 18 and 22 to 29; cards 19 to 21 are archived and neither the Board nor the
// Graph draw them. Card 7 has a parent (2), a child (22) and a card waiting for it (8); card 2 is the parent of 7
// and 8 (and of the archived 19) and card 6 waits for it; card 3 has a parent (1), and 4 and 6 wait for it, which the
// Flow draws as dependencies and not as parent lines.
//
// The Graph's side panel has the same six as toggles under On hover (graph-view.js), in the Hierarchy and the Flow,
// editing the one choice the search panel edits. The steps after the Flow press them on the plan board's card 7: the
// toggles show the kept choice, three presses while the dot is hovered light the union of dtree and hpath at once, the
// search panel's boxes show the same two, and Space writes them in the panel's order; the Flow's toggles show the same.
// The last steps work the Hierarchy and Dependencies toggles: one clicked in the search panel shows in the Graph's
// panel and the other way round, a hover lights the cut set, Space writes the sides into the terms, and Isolate on the
// Board hides every card the hover did not light.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// hoveredId, graphCur.

const CASES = {
  kinds: ['dtree', 'htree', 'dpath', 'hpath', 'dlinks', 'hlinks'],
  // How the six stand in both places: two columns by three rows read across, the h sets left, the d sets right.
  grid: ['hlinks', 'dlinks', 'hpath', 'dpath', 'htree', 'dtree'],
  start: ['dlinks', 'hlinks'],
  // Both toggles on their & states at first.
  startSides: ['above&below', 'before&after'],
  // On the Board, card 7, with what each choice of the Hierarchy lights among the cards the Board draws.
  board: {
    card: 7,
    defaults: [2, 7, 8, 22],
    plusHpath: { kinds: ['hpath', 'dlinks', 'hlinks'], lit: [1, 2, 7, 8, 22, 23, 24, 25] },
    hpathAlone: { kinds: ['hpath'], lit: [1, 2, 7, 22, 23, 24, 25] },
    none: [7],
    hlinksAlone: { kinds: ['hlinks'], lit: [2, 7, 22] },
  },
  // In the Hierarchy, with nothing chosen yet: card 2 lights with what it lit before the choice existed.
  graph: { card: 2, defaults: [1, 2, 6, 7, 8] },
  // In the Flow, card 3, with the choice the Board's steps left (hlinks alone): the parent and the card. Ticking dlinks
  // there lights the dependencies and the parent, unticking hlinks leaves the dependencies alone; the Hierarchy then reads
  // that same choice, and ticking hlinks and unticking dlinks there puts hlinks alone back for the Flow to read.
  flow: { card: 3, kept: { kinds: ['hlinks'], lit: [1, 3] }, plusDlinks: { kinds: ['dlinks', 'hlinks'], lit: [1, 3, 4, 6] }, dlinksAlone: { kinds: ['dlinks'], lit: [3, 4, 6] } },
  // In the Hierarchy's side panel, card 7: the choice kept so far (hlinks alone) lights its parent and child; pressing
  // hlinks off and hpath and dtree on lights the union of the two, and Space writes their terms.
  sidebar: { card: 7, before: { kinds: ['hlinks'], lit: [2, 7, 22] }, press: ['hlinks', 'hpath', 'dtree'], after: { kinds: ['dtree', 'hpath'], lit: [1, 2, 7, 8, 22, 23, 24, 25] }, text: 'dtree:7 | hpath:7' },
  // The toggles, card 7, with dtree and hpath ticked: the search panel's Hierarchy toggle clicked once reads above in
  // both panels, the Graph's clicked once more reads below in both, and its Dependencies toggle clicked once reads before
  // in both. Below and before light the card and what is nested under it, minus what waits behind it (card 8).
  sides: {
    card: 7,
    kinds: ['dtree', 'hpath'],
    searchHierarchy: 'above',
    graphHierarchy: 'below',
    graphDependencies: 'before',
    lit: [7, 22, 23, 24, 25],
    text: 'dtree:7:before | hpath:7:below',
  },
};

const { openPanel: openSidePanel, unfoldSearchSection } = require('../panel');

module.exports = {
  name: 'hover-show',
  board: 'plan',
  timeoutMs: 120000,
  CASES,
  async run(page) {
    const { ev, open, waitFor, key, check } = page;
    const idsOf = (expr) => `JSON.stringify(${expr})`;
    const listIs = (expr, ids) => waitFor(`${idsOf(expr)}===${JSON.stringify(JSON.stringify(ids))}`);
    const TILES = `[...new Set([...document.querySelectorAll('#board .card-el.hover-highlight')].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b)`;
    const NODES = `[...document.querySelectorAll('.graph-node.graph-near:not(.graph-flow-lane-head)')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`;
    const RING = `[...new Set([...document.querySelectorAll('#graph-view .graph-node.hover-highlight')].map((n)=>Number(n.dataset.id)))].sort((a,b)=>a-b)`;
    const DIMMED = `document.querySelector('.graph-canvas').classList.contains('graph-dim')`;
    const KIND_ORDER = JSON.stringify(CASES.kinds);
    const byKindOrder = (expr) => `${expr}.sort((a,b)=>${KIND_ORDER}.indexOf(a)-${KIND_ORDER}.indexOf(b))`;
    const BOXES = `[...document.querySelectorAll('#search-hover [data-hover-kind]')]`;
    const TICKED = byKindOrder(`${BOXES}.filter((b)=>b.checked).map((b)=>b.dataset.hoverKind)`);
    const GRID_SHAPE = (els) => `(()=>{const r=${els}.map((e)=>e.getBoundingClientRect());return r.length===6&&[0,1,2].every((i)=>Math.abs(r[2*i].top-r[2*i+1].top)<2&&r[2*i].left<r[2*i+1].left&&(i===0||(r[2*i].top>r[2*i-2].top+2&&Math.abs(r[2*i].left-r[0].left)<2)))})()`;
    const SIDE = `[...document.querySelectorAll('#graph-view .graph-option-btn[data-key="hover"]')]`;
    const SIDE_TICKED = byKindOrder(`${SIDE}.filter((b)=>b.getAttribute('aria-pressed')==='true').map((b)=>b.dataset.val)`);
    const SEARCH_SIDE = (toggle) => `document.querySelector('#search-hover [data-hover-side="${toggle}"]')`;
    const GRAPH_SIDE = (toggle) => `document.querySelector('#graph-view .graph-option-btn[data-key="hover-side"][data-val="${toggle}"]')`;
    const PANEL_OPEN = `!document.getElementById('search-panel').classList.contains('hidden')&&document.getElementById('search-panel').getBoundingClientRect().height>0`;
    const CARD = (id) => `#board .card-el[data-id="${id}"]`;
    const DOT = (id) => `.graph-node:not(.graph-flow-lane-head)[data-id="${id}"]`;

    const over = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
    const out = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`);
    const tilesAre = (ids) => listIs(TILES, ids);
    const tilesShown = (ids) => listIs(`[...new Set([...document.querySelectorAll('#board .card-el')].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b)`, ids);
    const nodesAre = (ids) => listIs(NODES, ids);
    const tickedAre = (kinds) => listIs(TICKED, kinds);
    const tick = (kind) => ev(`document.querySelector('#search-hover [data-hover-kind="${kind}"]').click()`);
    const sideAre = (kinds) => listIs(SIDE_TICKED, kinds);
    const sidePress = (kind) => ev(`${SIDE}.find((b)=>b.dataset.val==='${kind}').click()`);
    const searchSideIs = (toggle, label) => waitFor(`${SEARCH_SIDE(toggle)}.textContent===${JSON.stringify(label)}`);
    const graphSideIs = (toggle, label) => waitFor(`${GRAPH_SIDE(toggle)}.textContent===${JSON.stringify(label)}`);
    const searchSideClick = (toggle) => ev(`${SEARCH_SIDE(toggle)}.click()`);
    const graphSideClick = (toggle) => ev(`${GRAPH_SIDE(toggle)}.click()`);
    const openPanel = async () => {
      await ev(`document.getElementById('search-input').focus()`);
      await waitFor(PANEL_OPEN);
      return unfoldSearchSection(page, 'hover');
    };
    const onBoard = async () => {
      await open('/?view=board');
      return waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000);
    };
    const inGraph = async (query) => {
      await open(`/?view=graph${query}`);
      return waitFor(`document.querySelectorAll('.graph-node').length>20`, 10000);
    };
    const inFlow = async () => {
      await open('/?view=graph&graph=flow');
      return waitFor(`graphCur.kind==='flow'&&document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)').length>0`, 10000);
    };

    // --- the Hierarchy, with nothing chosen yet: hover lights what it lit before ---------------------------------------
    check('the Graph draws the plan board', await inGraph(''));
    await over(DOT(CASES.graph.card));
    check('in the Hierarchy, with nothing chosen, hovering a dot lights it and its one-hop relations and dims the rest',
      await nodesAre(CASES.graph.defaults) && await waitFor(DIMMED));
    check('and the hover ring stays on the hovered dot alone', await listIs(RING, [CASES.graph.card]));
    await out(DOT(CASES.graph.card));
    check('moving off clears the dimming', await waitFor(`!${DIMMED}&&document.querySelectorAll('.graph-node.graph-near').length===0&&hoveredId===null`));

    // --- the Board: the hover look on every card of the union -----------------------------------------------------------
    check('the Board draws the plan board', await onBoard());
    check('the panel opens with the box focused', await openPanel());
    check('the panel has the six sets, dlinks and hlinks ticked, and the Hierarchy and Dependencies toggles on their & states',
      await waitFor(`document.querySelectorAll('#search-hover [data-hover-kind]').length===${CASES.kinds.length}`)
        && await tickedAre(CASES.start) && await searchSideIs('hierarchy', CASES.startSides[0]) && await searchSideIs('dependencies', CASES.startSides[1]));
    check('the six boxes stand in two columns by three rows, the h sets left and the d sets right, links then path then tree',
      await listIs(BOXES + '.map((b)=>b.dataset.hoverKind)', CASES.grid) && await waitFor(GRID_SHAPE(BOXES + '.map((b)=>b.closest("label"))')));
    const card = CASES.board.card;
    await over(CARD(card));
    check('on the Board, with nothing chosen, hovering a card gives it and its one-hop relations the hover look',
      await tilesAre(CASES.board.defaults));
    await out(CARD(card));
    check('leaving the card clears the hover look', await tilesAre([]));

    await over(CARD(card));
    await tilesAre(CASES.board.defaults);
    await tick('hpath');
    check('ticking another set while a card is hovered lights the union of the three at once',
      await tickedAre(CASES.board.plusHpath.kinds) && await tilesAre(CASES.board.plusHpath.lit));
    await tick('dlinks');
    await tick('hlinks');
    check('unticking the other two leaves the set that is still ticked', await tickedAre(CASES.board.hpathAlone.kinds) && await tilesAre(CASES.board.hpathAlone.lit));
    await tick('hpath');
    check('with nothing ticked the hovered card still takes the hover look, and no other', await tickedAre([]) && await tilesAre(CASES.board.none));
    await tick('hlinks');
    check('one set ticked alone lights just that set', await tickedAre(CASES.board.hlinksAlone.kinds) && await tilesAre(CASES.board.hlinksAlone.lit));
    await out(CARD(card));
    await tilesAre([]);

    await ev(`document.querySelector(${JSON.stringify(CARD(card))}).focus()`);
    check('keyboard focus on a card lights the same set', await waitFor(`hoveredId==='${card}'`) && await tilesAre(CASES.board.hlinksAlone.lit));
    await ev(`document.activeElement.blur()`);
    check('and leaving it clears the set', await waitFor(`hoveredId===null`) && await tilesAre([]));

    // --- the choice is kept for the board and is the same in the Flow ----------------------------------------------------------
    check('the Board draws the plan board again after a reload', await onBoard());
    check('the choice is still there after a reload', await openPanel() && await tickedAre(CASES.board.hlinksAlone.kinds));
    await over(CARD(card));
    check('and it lights what it did', await tilesAre(CASES.board.hlinksAlone.lit));
    await out(CARD(card));

    const f = CASES.flow;
    check('the Flow draws the plan board', await inFlow());
    check('the Flow has the choice the Board kept, hlinks alone, and the panel does not say whose it is',
      await openPanel() && await tickedAre(f.kept.kinds) && await waitFor(`document.getElementById('search-hover-for')===null`));
    await over(DOT(f.card));
    check('in the Flow, hovering a dot lights it and its parent, as the kept choice says',
      await nodesAre(f.kept.lit) && await waitFor(DIMMED));
    await tick('dlinks');
    check('ticking dlinks in the Flow lights the dependencies and the parent, with the dot still hovered',
      await tickedAre(f.plusDlinks.kinds) && await nodesAre(f.plusDlinks.lit));
    await tick('hlinks');
    check('unticking hlinks in the Flow lights the dependencies alone',
      await tickedAre(f.dlinksAlone.kinds) && await nodesAre(f.dlinksAlone.lit));
    await out(DOT(f.card));
    await waitFor(`hoveredId===null`);

    check('the Hierarchy draws', await inGraph('&graph=hierarchy'));
    check('the Hierarchy reads the choice made in the Flow', await openPanel() && await tickedAre(f.dlinksAlone.kinds));
    await over(DOT(f.card));
    check('and its hover lights the dependencies alone', await nodesAre(f.dlinksAlone.lit));
    await tick('hlinks');
    await tick('dlinks');
    check('ticking hlinks and unticking dlinks in the Hierarchy puts hlinks alone back, lighting the parent and the card',
      await tickedAre(f.kept.kinds) && await nodesAre(f.kept.lit));
    await out(DOT(f.card));
    await waitFor(`hoveredId===null`);

    check('the Flow draws once more after a reload', await inFlow());
    check('the Flow keeps the choice made in the Hierarchy', await openPanel() && await tickedAre(f.kept.kinds));

    check('the Board draws after the Graph last showed the Flow', await onBoard());
    check('and reads the same choice', await openPanel() && await tickedAre(CASES.board.hlinksAlone.kinds));

    // --- the Graph's side panel edits the same choice ---------------------------------------------------------------------
    const side = CASES.sidebar;
    check('the Hierarchy draws the plan board', await inGraph('&graph=hierarchy'));
    check('the side panel starts closed and the toggle opens it', await openSidePanel(page));
    check('its side panel has the six sets under On hover, and shows the choice kept for the Hierarchy',
      await waitFor(`${SIDE}.length===${CASES.kinds.length}`) && await sideAre(side.before.kinds));
    check('the side panel toggles stand in the same grid: two columns by three rows, the h sets left and the d sets right',
      await listIs(SIDE + '.map((b)=>b.dataset.val)', CASES.grid) && await waitFor(GRID_SHAPE(SIDE)));
    await over(DOT(side.card));
    check('with the dot hovered the choice lights what it did', await nodesAre(side.before.lit));
    for (const kind of side.press) await sidePress(kind);
    check('three presses in the side panel make the choice dtree and hpath, and light their union with the dot still hovered, no reload and no new hover',
      await sideAre(side.after.kinds) && await nodesAre(side.after.lit));
    await out(DOT(side.card));
    await waitFor(`hoveredId===null`);
    check('the search panel shows the same two sets ticked', await openPanel() && await tickedAre(side.after.kinds));
    await ev(`document.activeElement.blur()`);
    await over(DOT(side.card));
    check('a new hover lights the union', await waitFor(`hoveredId==='${side.card}'`) && await nodesAre(side.after.lit));
    await key(' ');
    check('Space writes the ticked terms in the panel\'s order', await waitFor(`document.getElementById('search-input').value===${JSON.stringify(side.text)}`));
    await out(DOT(side.card));
    await waitFor(`hoveredId===null`);

    check('the Flow draws the plan board once more', await inFlow() && await openSidePanel(page));
    check('its side panel shows the same choice, dtree and hpath', await waitFor(`${SIDE}.length===${CASES.kinds.length}`) && await sideAre(side.after.kinds));

    // --- the Hierarchy and Dependencies toggles ------------------------------------------------------------------------------
    const sd = CASES.sides;
    check('the Hierarchy draws the plan board with its side panel open', await inGraph('&graph=hierarchy') && await openSidePanel(page));
    check('both panels show the toggles on their & states, with the sets ticked',
      await openPanel() && await searchSideIs('hierarchy', CASES.startSides[0]) && await graphSideIs('hierarchy', CASES.startSides[0])
        && await searchSideIs('dependencies', CASES.startSides[1]) && await graphSideIs('dependencies', CASES.startSides[1]) && await tickedAre(sd.kinds));
    check('the toggles are buttons with their state in their accessible name',
      await waitFor(`${GRAPH_SIDE('hierarchy')}.getAttribute('aria-label')==='Hierarchy: ${CASES.startSides[0]}'&&${SEARCH_SIDE('dependencies')}.getAttribute('aria-label')==='Dependencies: ${CASES.startSides[1]}'`));
    await searchSideClick('hierarchy');
    check('a click on the search panel\'s Hierarchy toggle reads above there and in the Graph\'s panel', await searchSideIs('hierarchy', sd.searchHierarchy) && await graphSideIs('hierarchy', sd.searchHierarchy));
    await graphSideClick('hierarchy');
    check('a click on the Graph\'s Hierarchy toggle reads below in both', await graphSideIs('hierarchy', sd.graphHierarchy) && await searchSideIs('hierarchy', sd.graphHierarchy));
    await graphSideClick('dependencies');
    check('a click on the Graph\'s Dependencies toggle reads before in both, and the Hierarchy\'s stays', await graphSideIs('dependencies', sd.graphDependencies) && await searchSideIs('dependencies', sd.graphDependencies) && await graphSideIs('hierarchy', sd.graphHierarchy));
    await over(DOT(sd.card));
    check('a hover lights the cut set: the card and what is nested under it, not what waits behind it', await nodesAre(sd.lit) && await waitFor(DIMMED));
    await key(' ');
    check('Space writes the sides into the terms', await waitFor(`document.getElementById('search-input').value===${JSON.stringify(sd.text)}`));
    await out(DOT(sd.card));
    await waitFor(`hoveredId===null`);

    check('the Board draws the plan board after a reload', await onBoard());
    check('the toggles kept their sides', await openPanel() && await searchSideIs('hierarchy', sd.graphHierarchy) && await searchSideIs('dependencies', sd.graphDependencies));
    await ev(`document.activeElement.blur()`);
    await over(CARD(sd.card));
    check('on the Board the hover look is on the cut set', await tilesAre(sd.lit));
    await key(' ');
    check('Space writes the same terms there', await waitFor(`document.getElementById('search-input').value===${JSON.stringify(sd.text)}`));
    await ev(`document.getElementById('isolate-switch').click()`);
    check('Isolate hides every card the hover did not light', await tilesShown(sd.lit));
  },
};
