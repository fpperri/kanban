'use strict';
// "On hover show", on the plan board. The search panel has six checkboxes, one per set (dtree, htree, dpath, hpath,
// dlinks, hlinks), and hovering or focusing a card lights the union of the ticked sets for it in every view: the
// Board gives each card of the union the hover look, the Graph lights them with the rest dimmed and keeps the hover
// ring on the hovered card alone. The choice is kept per board and per graph kind: the Hierarchy ticks dlinks and
// hlinks at first, the Flow the same, and every view that is not the Flow reads the Hierarchy's. Each step
// waits on the page, never on a fixed sleep, and the pointer is a mouseover or mouseout on the card or its dot
// and the focus a focus() on it, which are the events the page's hover listens to; a checkbox is pressed with
// click(), which toggles it and fires the change the page listens to.
//
// What each choice lights is written down in CASES, and skills/web/test/browser-hover-show-scenario.test.js holds
// those lists to the sets over the plan board's own cards, so a wrong expectation fails in the unit suite and not
// only in a browser.
//
// The plan board's live cards are 1 to 18 and 22 to 29; cards 19 to 21 are archived and neither the Board nor the
// Graph draw them. Card 7 has a parent (2), a child (22) and a card waiting for it (8); card 2 is the parent of 7
// and 8 (and of the archived 19) and card 6 waits for it; card 3 has a parent (1), and 4 and 6 wait for it, which the
// Flow draws as dependencies and not as parent lines.
//
// The Graph's side panel has the same six as toggles under On hover (graph-view.js), in the Hierarchy and the Flow,
// editing the one choice the search panel edits. The last steps press them on the plan board's card 7: the toggles
// show the kept choice, three presses while the dot is hovered light the union of dtree and hpath at once, the search
// panel's boxes show the same two, and Space writes them in the panel's order; the Flow's toggles show the Flow's own.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// hoveredId, graphCur.

const CASES = {
  kinds: ['dtree', 'htree', 'dpath', 'hpath', 'dlinks', 'hlinks'],
  // How the six stand in both places: two columns by three rows read across, the h sets left, the d sets right.
  grid: ['hlinks', 'dlinks', 'hpath', 'dpath', 'htree', 'dtree'],
  hierarchy: ['dlinks', 'hlinks'],
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
  // In the Flow, card 3: the dependencies and the parent at first, then the dependencies alone when hlinks is unticked
  // there; the Hierarchy's own choice (hlinks alone, from the Board's steps) lights the parent and the card.
  flow: { card: 3, kinds: ['dlinks', 'hlinks'], defaults: [1, 3, 4, 6], noHlinks: { kinds: ['dlinks'], lit: [3, 4, 6] }, hierarchy: [1, 3] },
  // In the Hierarchy's side panel, card 7: the choice kept so far (hlinks alone) lights its parent and child; pressing
  // hlinks off and hpath and dtree on lights the union of the two, and Space writes their terms.
  sidebar: { card: 7, before: { kinds: ['hlinks'], lit: [2, 7, 22] }, press: ['hlinks', 'hpath', 'dtree'], after: { kinds: ['dtree', 'hpath'], lit: [1, 2, 7, 8, 22, 23, 24, 25] }, text: 'dtree:7 | hpath:7' },
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
    const NOTE = `document.getElementById('search-hover-for').textContent`;
    const PANEL_OPEN = `!document.getElementById('search-panel').classList.contains('hidden')&&document.getElementById('search-panel').getBoundingClientRect().height>0`;
    const CARD = (id) => `#board .card-el[data-id="${id}"]`;
    const DOT = (id) => `.graph-node:not(.graph-flow-lane-head)[data-id="${id}"]`;

    const over = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`);
    const out = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`);
    const tilesAre = (ids) => listIs(TILES, ids);
    const nodesAre = (ids) => listIs(NODES, ids);
    const tickedAre = (kinds) => listIs(TICKED, kinds);
    const tick = (kind) => ev(`document.querySelector('#search-hover [data-hover-kind="${kind}"]').click()`);
    const sideAre = (kinds) => listIs(SIDE_TICKED, kinds);
    const sidePress = (kind) => ev(`${SIDE}.find((b)=>b.dataset.val==='${kind}').click()`);
    const noteIs = (text) => waitFor(`${NOTE}===${JSON.stringify(text)}`);
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
    check('the panel has the six sets, dlinks and hlinks ticked, and says the choice is the Hierarchy\'s and the other views\'',
      await waitFor(`document.querySelectorAll('#search-hover [data-hover-kind]').length===${CASES.kinds.length}`)
        && await tickedAre(CASES.hierarchy) && await noteIs('Hierarchy and the other views'));
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

    // --- the choice is kept for the board, and the Flow keeps its own ----------------------------------------------------
    check('the Board draws the plan board again after a reload', await onBoard());
    check('the choice is still there after a reload', await openPanel() && await tickedAre(CASES.board.hlinksAlone.kinds));
    await over(CARD(card));
    check('and it lights what it did', await tilesAre(CASES.board.hlinksAlone.lit));
    await out(CARD(card));

    check('the Flow draws the plan board', await inFlow());
    check('the Flow has its own choice, dlinks and hlinks, whatever the Hierarchy ticks, and the panel says so',
      await openPanel() && await tickedAre(CASES.flow.kinds) && await noteIs('Flow'));
    await over(DOT(CASES.flow.card));
    check('in the Flow, hovering a dot lights it, the cards its dependencies join to it and its parent',
      await nodesAre(CASES.flow.defaults) && await waitFor(DIMMED));
    await tick('hlinks');
    check('unticking hlinks in the Flow lights the dependencies alone, with the dot still hovered',
      await tickedAre(CASES.flow.noHlinks.kinds) && await nodesAre(CASES.flow.noHlinks.lit));
    await out(DOT(CASES.flow.card));
    await waitFor(`hoveredId===null`);

    check('the Hierarchy draws again', await inGraph('&graph=hierarchy'));
    check('the Hierarchy still holds its own choice, and the panel says so', await openPanel() && await tickedAre(CASES.board.hlinksAlone.kinds) && await noteIs('Hierarchy and the other views'));
    await over(DOT(CASES.flow.card));
    check('and its hover lights the parent and the card, not the dependencies', await nodesAre(CASES.flow.hierarchy));
    await out(DOT(CASES.flow.card));
    await waitFor(`hoveredId===null`);

    check('the Flow draws once more after a reload', await inFlow());
    check('the Flow keeps the choice made there', await openPanel() && await tickedAre(CASES.flow.noHlinks.kinds));

    check('the Board draws after the Graph last showed the Flow', await onBoard());
    check('and still reads the Hierarchy\'s choice, not the Flow\'s', await openPanel() && await tickedAre(CASES.board.hlinksAlone.kinds));

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
    check('its side panel shows the Flow\'s own choice', await waitFor(`${SIDE}.length===${CASES.kinds.length}`) && await sideAre(CASES.flow.noHlinks.kinds));
  },
};
