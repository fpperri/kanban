'use strict';
// A click that selects writes the selection into the search box, on the plan board. With isolate off the
// box shows the selection as the text Isolate would write for it (`#34`, `#34 | #36`), the run of
// `slice:` terms it holds kept, and the write turns isolate on for no one and never makes the box a typed
// search. Two parts, each from a cold page.
//
// The Board. A Ctrl+click on a card shows `#a` in the box and a second adds `#b` as an alternative, with
// every card still on the Board and the two lit. A Ctrl+click on a picked card takes it out and the box
// shows what is left; a plain click that opens a card leaves the box as it was; the last card out empties
// the box. A `slice:` cut typed in the box hides the Board down to its cards, and the clicks write the
// cards before it and keep it, and taking the last one out leaves the cut alone. Add to selection, from a
// card's menu, shows its card; with a second card Ctrl+clicked in, Esc steps the box down with the
// selection, the additions first and then the anchor.
//
// The Graph. A plain click on a dot shows the card, Shift+click adds one and Ctrl+click on a picked dot
// takes it out, the parts staying cards. A search typed in the Graph is its typed anchor: Shift+click on a
// dot it does not light writes the dot beside the query and the query stays the anchor, and leaving the Graph
// for the Board then writes the picked card alone and leaves the search behind.
//
// The plan board's live cards are 1 to 18 and 22 to 29. Cards 5 and 10 carry the docs tag, and cards 1, 2, 7,
// 25 and 26 are the goal, strategy and objective cards, so slice:goal..objective is those five.
// skills/web/test/browser-box-mirror-scenario.test.js holds CASES to the search module over the board's own
// cards. Each step waits on the page, never on a fixed sleep; a "nothing happened" check waits two animation
// frames. Keys and clicks go through the runner's helpers, a real key press and a real mouse click (Shift is 8
// and Ctrl is 2); a card's dot is clicked only where it is the topmost thing.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// hoveredId, isolateNow, selectedIds, selectionState.

const CASES = {
  cut: { query: 'slice:goal..objective', cards: [1, 2, 7, 25, 26] },
  docs: { query: 'tags:docs', lit: [5, 10] },
};

module.exports = {
  name: 'box-mirror',
  board: 'plan',
  timeoutMs: 90000,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, mouse, click, key, rightClick, check } = page;
    const sorted = (...ids) => ids.slice().sort((a, b) => a - b);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const idsOf = (selector) => `JSON.stringify([...new Set([...document.querySelectorAll(${JSON.stringify(selector)})].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b))`;
    const shows = (selector, ids) => waitFor(`${idsOf(selector)}===${JSON.stringify(JSON.stringify(ids))}`);
    const nowShown = async (selector) => JSON.parse(await ev(idsOf(selector)));
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const pickedIs = (ids) => waitFor(`JSON.stringify([...selectedIds].map(Number).sort((a,b)=>a-b))===${JSON.stringify(JSON.stringify(ids))}`);
    const isolateOff = () => ev(`isolateNow()===null`);
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const PARTS = `(()=>{const s=selectionState.selection;return {anchor:s.anchor&&[s.anchor.kind,s.anchor.source||''].join(':'),additions:s.additions.map((p)=>p.kind)}})()`;
    const parts = () => ev(PARTS);
    const noCardOpen = `!/card=\\d+/.test(location.search)`;
    const hasCard = (id) => `/[?&]card=${id}(&|$)/.test(location.search)`;
    const clearBox = async () => {
      await ev(`document.getElementById('search-clear-btn').click()`);
      return boxIs('');
    };
    const goto = async (target, ready) => {
      await ev(`window.__stale=true`);
      await open(target);
      await waitFor(`window.__stale!==true`, 10000);
      return waitFor(ready, 10000);
    };
    // The panel opens when the box is focused, hangs over the first cards and takes an Esc of its own, so the
    // arrow switches it off here; the search-panel scenario holds the panel itself.
    const panelOff = () => ev(`(()=>{const t=document.getElementById('search-panel-toggle');if(t.getAttribute('aria-pressed')==='true')t.click()})()`);
    const typeIn = async (text) => {
      await ev(`document.getElementById('search-input').focus()`);
      await send('Input.insertText', { text });
      await boxIs(text);
      return ev(`document.activeElement.blur()`);
    };

    // A point on a Board card that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (id) => ev(`(()=>{const el=document.querySelector('#board .card-el[data-id="${id}"]');if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    const clickCard = async (id, extra = {}) => {
      const p = await cardPoint(id);
      if (!p) throw new Error(`no clickable point on Board card ${id}`);
      await click(p.x, p.y, extra);
    };
    // The centre of a card's dot in the Graph, or null when another dot covers it.
    const dotPoint = (id) => ev(`(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`);
    const clickDot = async (id, extra = {}) => {
      const p = await dotPoint(id);
      if (!p) throw new Error(`no clickable point on the dot of card ${id}`);
      await click(p.x, p.y, extra);
    };
    const press = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`);
    const boardReady = `document.querySelectorAll('#board .card-el').length>3`;
    const graphReady = `document.querySelectorAll('#graph-view .graph-node').length>3`;
    const BOARD = '#board .card-el';
    const BOARD_LIT = '#board .card-el.selected';
    const LIT_DOTS = '#graph-view .graph-node.graph-near';

    // --- the Board: Ctrl+clicks, a plain click that opens, a cut, Add to selection and Esc --------------------------
    check('the Board draws the plan board', await goto('/?view=board', boardReady));
    await panelOff();
    const everything = await nowShown(BOARD);
    const [first, second, third] = everything;
    check('the Board has three cards to click', everything.length > 3 && [first, second, third].every(Number.isInteger), everything);

    await clickCard(first, { modifiers: 2 });
    check('a Ctrl+click on the Board shows the card in the box, and isolate stays off', await boxIs(`#${first}`) && await pickedIs([first]) && await isolateOff(), { box: await boxText(), picked: await ev(`[...selectedIds]`) });
    await clickCard(second, { modifiers: 2 });
    check('the next Ctrl+click adds its card as an alternative', await boxIs(`#${first} | #${second}`) && await pickedIs(sorted(first, second)), await boxText());
    check('every card is still on the Board and the two picked ones are lit', await shows(BOARD, everything) && await shows(BOARD_LIT, sorted(first, second)), { shown: await nowShown(BOARD), lit: await nowShown(BOARD_LIT) });
    const made = await parts();
    check('the parts are the cards the clicks made, not a typed search', same(made, { anchor: 'card:', additions: ['card'] }), made);

    await clickCard(first, { modifiers: 2 });
    check('a Ctrl+click on a picked card takes it out, and the box shows what is left', await boxIs(`#${second}`) && await pickedIs([second]), { box: await boxText() });
    await clickCard(third);
    check('a plain click on another card opens it', await waitFor(hasCard(third), 3000), await ev(`location.search`));
    check('and writes nothing to the box', (await boxText()) === `#${second}` && await isolateOff(), await boxText());
    await key('Escape');
    check('Esc closes the card', await waitFor(noCardOpen, 2500));
    await clearBox();
    await clickCard(second, { modifiers: 2 });
    await boxIs(`#${second}`);
    await clickCard(second, { modifiers: 2 });
    check('the last card taken out empties the box', await boxIs('') && await pickedIs([]), await boxText());

    await typeIn(CASES.cut.query);
    check('a slice: cut typed in the box hides the Board down to its cards, with isolate off', await shows(BOARD, CASES.cut.cards) && await isolateOff(), await nowShown(BOARD));
    const [c1, c2] = CASES.cut.cards;
    await clickCard(c1, { modifiers: 2 });
    check('a click writes its card before the cut', await boxIs(`#${c1} ${CASES.cut.query}`), await boxText());
    await clickCard(c2, { modifiers: 2 });
    check('and the next adds its card, the cut kept after both', await boxIs(`(#${c1} | #${c2}) ${CASES.cut.query}`) && await shows(BOARD, CASES.cut.cards), await boxText());
    await clickCard(c1, { modifiers: 2 });
    await clickCard(c2, { modifiers: 2 });
    check('taking both out leaves the box its cut alone', await boxIs(CASES.cut.query) && await pickedIs([]) && await shows(BOARD, CASES.cut.cards), await boxText());
    await clearBox();
    check('the clear button brings every card back', await shows(BOARD, everything), await nowShown(BOARD));

    await rightClick(`#board .card-el[data-id="${third}"]`);
    await press('ctx-add');
    check('Add to selection from a card\'s menu shows the card in the box', await boxIs(`#${third}`) && await pickedIs([third]) && await isolateOff(), { box: await boxText(), picked: await ev(`[...selectedIds]`) });
    await clickCard(first, { modifiers: 2 });
    await boxIs(`#${third} | #${first}`);
    await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    await key('Escape');
    check('the first Esc drops the addition and the box follows, leaving the anchor', await pickedIs([third]) && await boxIs(`#${third}`), { box: await boxText(), picked: await ev(`[...selectedIds]`) });
    await key('Escape');
    check('the next Esc drops the anchor and the box is empty', await pickedIs([]) && await boxIs(''), { box: await boxText(), picked: await ev(`[...selectedIds]`) });
    check('no card is open at the end of the Board part', await ev(noCardOpen));

    // --- the Graph: a click, Shift and Ctrl, then a typed search and the way back to the Board ---------------------------------
    check('the Graph draws the plan board', await goto('/?view=graph', graphReady));
    await panelOff();
    const nodeIds = await ev(`[...new Set([...document.querySelectorAll('.graph-node')].map((n)=>Number(n.dataset.id)))]`);
    const clickable = [];
    for (const id of nodeIds) if (clickable.length < 3 && await dotPoint(id)) clickable.push(id);
    check('three cards can be clicked without another dot in the way', clickable.length === 3, clickable);
    const [a, b, c] = clickable;

    await clickDot(a);
    check('a plain click on a dot shows the card in the box, with isolate off', await boxIs(`#${a}`) && await pickedIs([a]) && await isolateOff(), { box: await boxText() });
    await clickDot(b, { modifiers: 8 });
    check('Shift+click adds the next card as an alternative, and every part is a card', await boxIs(`#${a} | #${b}`) && await pickedIs(sorted(a, b)) && same(await parts(), { anchor: 'card:', additions: ['card'] }), { box: await boxText(), parts: await parts() });
    await clickDot(a, { modifiers: 2 });
    check('Ctrl+click on a picked dot takes it out, and the box shows what is left', await boxIs(`#${b}`) && await pickedIs([b]), { box: await boxText() });
    await clickDot(c);
    check('a plain click on another dot replaces the box with that card', await boxIs(`#${c}`) && await pickedIs([c]), { box: await boxText() });

    await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    await key('Escape');
    check('Esc drops the card and empties the box, so the search starts from a clean Graph', await pickedIs([]) && await boxIs(''), { box: await boxText() });
    // The pointer is still on the dot just clicked, and a hovered card lights its On hover show sets over a
    // typed search, so it goes to the empty corner of the canvas before the query is typed.
    const corner = await ev(`(()=>{const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {x:r.right-14,y:r.bottom-14}})()`);
    await mouse('mouseMoved', corner.x, corner.y);
    await waitFor(`hoveredId===null`);
    await typeIn(CASES.docs.query);
    check('a search typed in the Graph lights its matches and is the typed anchor', await shows(LIT_DOTS, CASES.docs.lit) && same((await parts()).anchor, 'query:typing'), await parts());
    let unlit = null;
    for (const id of nodeIds) if (unlit === null && !CASES.docs.lit.includes(id) && await dotPoint(id)) unlit = id;
    check('a dot the search does not light can be clicked', unlit !== null, nodeIds);
    await clickDot(unlit, { modifiers: 8 });
    check('Shift+click on it writes the card beside the query, which stays the typed anchor', await boxIs(`${CASES.docs.query} | #${unlit}`) && same(await parts(), { anchor: 'query:typing', additions: ['card'] }), { box: await boxText(), parts: await parts() });
    await frames();
    check('and isolate is still off', await isolateOff());

    await press('graph-toggle-btn');
    check('the Board shows after the switch', await waitFor(`!document.getElementById('board').classList.contains('hidden')&&document.querySelectorAll('#board .card-el').length>0`, 10000));
    check('leaving the Graph writes the card picked beside the search alone, and the search stays behind', await boxIs(`#${unlit}`) && await pickedIs([unlit]) && await isolateOff(), { box: await boxText(), picked: await ev(`[...selectedIds]`) });
  },
};
