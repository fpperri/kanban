'use strict';
// Isolate from the menus and the empty canvas, and the link that carries it, on the plan board.
// Five parts, each from a cold page.
//
// The Board. Two Ctrl+clicks pick two loose cards. A right-click on a card inside the selection
// opens the menu that acts on the selection, and it offers Isolate; a right-click on a card outside
// it offers Peek and Add to selection and no Isolate. Choosing Isolate with a real click writes
// `#a | #b` into the box, the Board shows only the two, the switch is on, and the address gains
// `isolate=1` beside `q`. The browser's history does not grow, and the menu reads Turn isolate off
// while it is on; choosing that gives the box the picked cards the clicks had written and the address
// `isolate=0` beside `q`, since the box lights them.
//
// The Graph and the Map. With the two cards picked on the Board, the view is switched. In the Graph
// a right-click on a card outside the selection offers no Isolate and one inside it does, and
// choosing it draws only the two. A right-click on the empty canvas, at a point that is no dot, link
// or control, is kept from opening the browser's own menu and opens a menu of Isolate alone, which
// reads Turn isolate off while it is on; choosing it turns isolate off and every dot is drawn again,
// and choosing Isolate from it turns it on with no dot dimmed. The Map's empty canvas opens that menu
// too, and choosing it shows only the two cards.
//
// The reload. The Board is set to light what is typed (its Typing isolates off, since a Board that isolates
// by itself has the search isolate on its own). The two cards are picked and a search is typed over the box
// they wrote, so it lights its cards, and the cards are isolated from a card's menu, so the box holds
// `#a | #b` and remembers the search. A reload keeps the switch on, the box
// text, the address and the chip that says isolated, and the Board shows the two. Turning isolate off
// afterwards gives the search back and takes the parameter out of the address. Opening a card while
// isolated is one history step that carries q and isolate, and Back keeps both.
//
// The link. The isolated link, opened with the browser's storage cleared, draws only the isolated
// set in the Graph with no dot dimmed, and shows only that set on the Board; in that fresh browser
// turning isolate off leaves the box empty and takes both parameters out of the address. A link with
// the isolate parameter and no query opens with isolate off.
//
// The plan board's live cards are 1 to 18 and 22 to 29. CASES holds what the scenario relies on, and
// skills/web/test/browser-isolate-link-scenario.test.js holds it to the search module over the
// board's own cards. Each step waits on the page, never on a fixed sleep. Keys and clicks go through
// the runner's helpers, a real key press and a real mouse click (Ctrl is 2); a right-click is the
// runner's synthetic contextmenu event, or, on empty canvas, one dispatched at the point so that it can
// be asked whether the page kept the browser's own menu from opening.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js): selectedIds.

const { SELECTORS } = require('./slice-term');

const CASES = {
  // Two live loose cards, with no parent, child or wait, the scenario picks; and a third it right-clicks outside them.
  picked: [17, 14],
  outside: 15,
  // The search the Board part keeps, the cards it narrows the Board to, and the two it picks.
  zephyr: { query: 'zephyr', cards: [1, 2, 7, 11], picked: [1, 2] },
};

module.exports = {
  name: 'isolate-link',
  board: 'plan',
  timeoutMs: 100000,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, rightClick, check, shot } = page;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const sorted = (...ids) => [...new Set(ids)].sort((a, b) => a - b);
    const idsOf = (selector) => `JSON.stringify([...new Set([...document.querySelectorAll(${JSON.stringify(selector)})].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b))`;
    const shows = (selector, ids, ms) => waitFor(`${idsOf(selector)}===${JSON.stringify(JSON.stringify(ids))}`, ms);
    const nowShown = (selector) => ev(idsOf(selector));
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const pickedIs = (ids) => waitFor(`JSON.stringify([...selectedIds].map(Number).sort((a,b)=>a-b))===${JSON.stringify(JSON.stringify(ids))}`);
    const goto = async (target, ready) => {
      await ev(`window.__stale=true`);
      await open(target);
      await waitFor(`window.__stale!==true`, 10000);
      return waitFor(ready, 10000);
    };
    const boardReady = `document.querySelectorAll('#board .card-el').length>20`;
    const graphReady = `document.querySelectorAll('#graph-view .graph-node').length>20`;
    const mapReady = `!!document.querySelector('#map-view .map-canvas')&&document.querySelectorAll('#map-view .card-el').length>0`;
    const SWITCH = `document.getElementById('isolate-switch')`;
    const switchIs = (on) => waitFor(`${SWITCH}.getAttribute('aria-checked')===${JSON.stringify(String(on))}`);
    const chip = () => ev(`(()=>{const c=document.getElementById('search-chip');return {hidden:c.classList.contains('hidden')||c.getBoundingClientRect().width===0,text:c.textContent}})()`);
    const chipSaysIsolated = async () => {
      const c = await chip();
      return !c.hidden && c.text === 'isolated';
    };
    const MENU = `document.getElementById('context-menu')`;
    const MENU_UP = `!${MENU}.classList.contains('hidden')`;
    const menuUp = () => waitFor(MENU_UP);
    const menuGone = () => waitFor(`!(${MENU_UP})`, 2500);
    const ENTRY = `document.getElementById('ctx-isolate')`;
    const offered = () => ev(`!${ENTRY}.classList.contains('hidden')&&!${ENTRY}.closest('.ctx-sub').classList.contains('hidden')`);
    const entryLabel = () => ev(`${ENTRY}.textContent.trim()`);
    const visibleEntries = () => ev(`[...${MENU}.querySelectorAll('button')].filter((b)=>b.getBoundingClientRect().width>0).map((b)=>b.id)`);
    // The entries a card's menu always has at the top level, though its groups are shut: Edit, Explore, Archive and Delete.
    const hasCardEntries = async () => { const ids = await visibleEntries(); return ['ctx-edit', 'ctx-explore', 'ctx-archive', 'ctx-delete'].every((id) => ids.includes(id)); };
    const lead = () => ev(`[...${MENU}.querySelectorAll('button')].filter((b)=>b.getBoundingClientRect().width>0).slice(0,2).map((b)=>b.textContent.trim())`);
    const escape = () => key('Escape');
    const closeMenu = async () => { await escape(); return menuGone(); };
    const clickOn = async (selector, extra = {}) => {
      const p = await centre(selector);
      if (!p) throw new Error(`nothing matches ${selector}`);
      await click(p.x, p.y, extra);
    };
    // Isolate sits in the Explore group of a card's menu: the group is opened by a click on its row first; in the empty canvas's menu its panel is drawn in place.
    const choose = async () => {
      if (!(await ev(`${ENTRY}.getBoundingClientRect().width>0`))) await clickOn('#ctx-explore');
      return clickOn('#ctx-isolate');
    };
    const press = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`);
    const viewShown = (container) => `!document.querySelector(${JSON.stringify(container)}).classList.contains('hidden')`;
    const blur = () => ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    const focusBoxAtEnd = () => ev(`(()=>{const i=document.getElementById('search-input');i.blur();i.setSelectionRange(i.value.length,i.value.length);i.focus()})()`);
    // Types over whatever the box holds, as a person does with the text selected.
    const typeOver = async (text) => {
      await focusBoxAtEnd();
      await ev(`document.getElementById('search-input').select()`);
      await send('Input.insertText', { text });
    };
    const addressParams = () => ev(`Object.fromEntries(new URLSearchParams(location.search))`);
    const addressHas = (expected) => waitFor(`(()=>{const p=new URLSearchParams(location.search);const want=${JSON.stringify(expected)};return Object.keys(want).every((k)=>p.get(k)===want[k])&&[...p.keys()].every((k)=>k in want)})()`);
    const entryCount = () => ev(`history.length`);
    // Page.reload answers as soon as the reload starts, and the old document lives on until the new one commits, so a
    // marker set on the old document is waited on to be gone.
    const reload = async () => {
      await ev(`window.__beforeReload = true`);
      await send('Page.reload');
      if (!(await waitFor(`window.__beforeReload === undefined`, 10000))) throw new Error('the page did not reload');
    };
    // A browser with nothing stored: the page is left, the origin's storage is cleared, and the link is opened cold.
    const openFresh = async (link, ready) => {
      const origin = await ev(`location.origin`);
      await send('Page.navigate', { url: 'about:blank' });
      await send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
      await open(link);
      return waitFor(ready, 10000);
    };

    // A Board tile's point that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (id) => ev(`(()=>{const el=document.querySelector('#board .card-el[data-id="${id}"]');if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    const clickTile = async (id, extra = {}) => {
      const p = await cardPoint(id);
      if (!p) throw new Error(`no clickable point on Board card ${id}`);
      await click(p.x, p.y, extra);
    };
    const pickOnBoard = async (ids) => {
      for (const id of ids) await clickTile(id, { modifiers: 2 });
      return pickedIs(sorted(...ids));
    };
    // A point of a canvas that holds no card, dot, node, link or control, and the answer to a right-click dispatched there:
    // whether the page kept the browser's own menu from opening.
    const emptyPoint = (canvas) => ev(`(()=>{for(const c of document.querySelectorAll(${JSON.stringify(canvas)})){const r=c.getBoundingClientRect();const x0=Math.max(r.left,0),x1=Math.min(r.right,innerWidth),y0=Math.max(r.top,0),y1=Math.min(r.bottom,innerHeight);if(x1<=x0||y1<=y0)continue;for(let fy=0.95;fy>0.05;fy-=0.1)for(let fx=0.95;fx>0.05;fx-=0.1){const x=x0+(x1-x0)*fx,y=y0+(y1-y0)*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest(${JSON.stringify(canvas)})&&!hit.closest('.card-el, .graph-node, .map-node, a, button, input, select, textarea'))return {x,y}}}return null})()`);
    const rightClickKept = (p) => ev(`(()=>{const el=document.elementFromPoint(${p.x},${p.y});return !el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,buttons:2,clientX:${p.x},clientY:${p.y},view:window}))})()`);
    const dotsDrawn = `new Set([...document.querySelectorAll('#graph-view .graph-node')].map((n)=>n.dataset.id)).size`;
    // No card is dimmed when every dot drawn is at full strength: a canvas that lights the selection wears the dimming class even when
    // everything drawn is lit, so the class says nothing, and what a dot looks like does.
    const notDimmed = `(()=>{const d=[...document.querySelectorAll('#graph-view .graph-node')];return d.length>0&&d.every((n)=>getComputedStyle(n).opacity==='1')})()`;
    const [a, b] = CASES.picked;
    const wanted = sorted(a, b);
    const wantedText = `#${a} | #${b}`;
    const isolatedParams = (extra = {}) => ({ ...extra, q: wantedText, isolate: '1' });

    // --- the Board: a card's menu ---------------------------------------------------------------------------------------
    check('the Board draws the plan board', await goto('/?view=board', boardReady));
    check('two Ctrl+clicks pick two loose cards', await pickOnBoard([a, b]));
    const entries = await entryCount();
    await rightClick(`#board .card-el[data-id="${CASES.outside}"]`);
    check('a right-click on a card outside the selection opens a menu led by Peek and Add child…', await menuUp() && same(await lead(), ['Peek', 'Add child…']), await lead());
    check('and that menu does not offer Isolate', (await offered()) === false);
    check('with the selection as it was', await pickedIs(wanted));
    check('Esc closes the menu', await closeMenu());
    await rightClick(`#board .card-el[data-id="${a}"]`);
    check('a right-click on a card inside the selection of two opens the menu', await menuUp());
    check('and that menu offers Isolate, as Isolate', await offered() && (await entryLabel()) === 'Isolate', await entryLabel());
    check('with every other entry of the card menu still in it', await hasCardEntries(), await visibleEntries());
    await shot('isolate-menu-board');
    await choose();
    check('choosing it writes the selection into the box, as the switch does', await boxIs(wantedText), await boxText());
    check('the menu closes, the switch is on and the selection is as it was', await menuGone() && await switchIs(true) && await pickedIs(wanted));
    check('the Board shows only the two cards', await shows(SELECTORS.board, wanted), await nowShown(SELECTORS.board));
    check('the address carries the isolate parameter beside q', await addressHas({ view: 'board', ...isolatedParams() }), await addressParams());
    check('and turning isolate on added no browser-history entry', (await entryCount()) === entries, { before: entries, now: await entryCount() });
    check('with the panel closed, the chip says isolated', await chipSaysIsolated(), await chip());
    await rightClick(`#board .card-el[data-id="${a}"]`);
    check('while isolate is on, the same menu reads Turn isolate off', await menuUp() && await offered() && (await entryLabel()) === 'Turn isolate off', await entryLabel());
    await choose();
    check('choosing it turns isolate off, and the box holds the picked cards again, as the clicks wrote them', await switchIs(false) && await boxIs(wantedText) && await menuGone(), await boxText());
    check('the address says isolate=0 beside q, since the box lights the cards, and the history did not grow', await addressHas({ view: 'board', q: wantedText, isolate: '0' }) && (await entryCount()) === entries, { address: await addressParams(), now: await entryCount() });
    check('the Board shows its cards again', await waitFor(boardReady));

    // --- the Graph: a card's menu, and the empty canvas --------------------------------------------------------------------
    check('the Board is up again for the Graph part', await goto('/?view=board', boardReady));
    await pickOnBoard([a, b]);
    await press('graph-toggle-btn');
    check('the Graph is up, with the selection kept', await waitFor(viewShown('#graph-view')) && await waitFor(graphReady) && await pickedIs(wanted));
    const total = await ev(dotsDrawn);
    await rightClick(`#graph-view .card-el[data-id="${CASES.outside}"]`);
    check('Graph: a right-click on a card outside the selection opens its menu with no Isolate', await menuUp() && (await offered()) === false && same(await lead(), ['Peek', 'Add child…']), await lead());
    check('Graph: Esc closes it', await closeMenu());
    await rightClick(`#graph-view .card-el[data-id="${a}"]`);
    check('Graph: a right-click on a card inside the selection of two offers Isolate', await menuUp() && await offered() && (await entryLabel()) === 'Isolate', await entryLabel());
    await choose();
    check('Graph: choosing it turns isolate on, with the box holding the two cards', await switchIs(true) && await boxIs(wantedText), await boxText());
    check('Graph: only the two cards are drawn', await shows(SELECTORS.graph, wanted), await nowShown(SELECTORS.graph));
    const canvas = '#graph-view .graph-canvas';
    const spot = await emptyPoint(canvas);
    check('the Graph has a point of empty canvas to right-click', !!spot, spot);
    check('a right-click on the empty Graph canvas is kept from opening the browser\'s own menu', await rightClickKept(spot));
    check('and opens a menu with Turn isolate off alone, since isolate is on', await menuUp() && same(await visibleEntries(), ['ctx-isolate']) && (await entryLabel()) === 'Turn isolate off', await visibleEntries());
    await shot('isolate-menu-canvas');
    await choose();
    check('choosing it turns isolate off, and every dot is drawn again', await switchIs(false) && await waitFor(`${dotsDrawn}===${total}`), { dots: await ev(dotsDrawn), total });
    check('with the two cards still selected', await pickedIs(wanted));
    check('and the menu closed', await menuGone());
    // Isolate is off, so every dot is drawn, the card outside the selection among them: isolated, the Graph draws no such card to right-click.
    await rightClick(`#graph-view .card-el[data-id="${CASES.outside}"]`);
    check('the menu of a card outside the selection, opened after the canvas menu, has every entry again, and still no Isolate', await menuUp() && (await visibleEntries()).length > 5 && (await offered()) === false && same(await lead(), ['Peek', 'Add child…']), await visibleEntries());
    await closeMenu();
    const spotAgain = await emptyPoint(canvas);
    check('the empty canvas right-click is kept from the browser again', !!spotAgain && await rightClickKept(spotAgain), spotAgain);
    check('and opens a menu with Isolate alone, as Isolate, over the Graph', await menuUp() && same(await visibleEntries(), ['ctx-isolate']) && (await entryLabel()) === 'Isolate', await visibleEntries());
    await choose();
    check('choosing it turns isolate on, and only the two cards are drawn', await switchIs(true) && await shows(SELECTORS.graph, wanted), await nowShown(SELECTORS.graph));
    check('with no dot dimmed', await ev(notDimmed));
    await rightClick(`#graph-view .card-el[data-id="${a}"]`);
    check('the menu of a card inside the selection, opened after the canvas menu, has every entry again, and reads Turn isolate off', await menuUp() && await hasCardEntries() && await offered() && (await entryLabel()) === 'Turn isolate off', await visibleEntries());
    await closeMenu();

    // --- the Map: the empty canvas -----------------------------------------------------------------------------------------------
    check('the Board is up again for the Map part', await goto('/?view=board', boardReady));
    await pickOnBoard([a, b]);
    await press('map-toggle-btn');
    check('the Map is up, with the selection kept', await waitFor(viewShown('#map-view')) && await waitFor(mapReady) && await pickedIs(wanted));
    const mapSpot = await emptyPoint('#map-view .map-canvas');
    check('the Map has a point of empty canvas to right-click', !!mapSpot, mapSpot);
    check('a right-click on the empty Map canvas is kept from opening the browser\'s own menu', await rightClickKept(mapSpot));
    check('and opens a menu with Isolate alone, as Isolate, over the Map', await menuUp() && same(await visibleEntries(), ['ctx-isolate']) && (await entryLabel()) === 'Isolate', await visibleEntries());
    await choose();
    check('choosing it turns isolate on, and the Map shows only the two cards', await switchIs(true) && await shows(SELECTORS.map, wanted, 10000), await nowShown(SELECTORS.map));

    // --- the reload, and the text from before isolating ----------------------------------------------------------------------------
    const [one, two] = CASES.zephyr.picked;
    const pickedText = `#${one} | #${two}`;
    await ev(`localStorage.setItem('kanban.plan.typing.isolates', JSON.stringify({board:false}))`);
    check('the Board is up for the reload part', await goto('/?view=board', boardReady));
    const liveBoard = JSON.parse(await nowShown(SELECTORS.board));
    await pickOnBoard(CASES.zephyr.picked);
    await typeOver(CASES.zephyr.query);
    check('a search lights the zephyr cards and leaves every card on the Board, and the two are still picked', await boxIs(CASES.zephyr.query) && await shows(SELECTORS.board, liveBoard) && await pickedIs(sorted(...CASES.zephyr.picked)), await nowShown(SELECTORS.board));
    await blur();
    await rightClick(`#board .card-el[data-id="${one}"]`);
    await menuUp();
    await choose();
    check('isolating from a card\'s menu writes the two cards, and the Board shows only them', await boxIs(pickedText) && await switchIs(true) && await shows(SELECTORS.board, sorted(one, two)), await boxText());
    check('the address carries q and isolate', await addressHas({ view: 'board', q: pickedText, isolate: '1' }), await addressParams());
    await reload();
    check('after a reload the switch is on and the box holds the isolate text', await switchIs(true) && await boxIs(pickedText), await boxText());
    check('and the address is as it was', await addressHas({ view: 'board', q: pickedText, isolate: '1' }), await addressParams());
    check('and the chip says isolated, and the Board shows only the two', await chipSaysIsolated() && await shows(SELECTORS.board, sorted(one, two)), await chip());
    await press('isolate-switch');
    check('after the reload, turning isolate off gives back the search from before isolating', await switchIs(false) && await boxIs(CASES.zephyr.query), await boxText());
    check('and takes the isolate parameter out of the address, since this Board lights what is typed and opens a search lit without one', await addressHas({ view: 'board', q: CASES.zephyr.query }), await addressParams());
    check('and the Board shows every card again, the search lighting its cards', await shows(SELECTORS.board, liveBoard), await nowShown(SELECTORS.board));

    // --- a card's history step keeps the parameter ------------------------------------------------------------------------------------
    await pickOnBoard(CASES.zephyr.picked);
    await press('isolate-switch');
    check('isolate is on again for the history step', await switchIs(true) && await boxIs(pickedText), await boxText());
    const before = await entryCount();
    await ev(`document.querySelector('#board .card-el[data-id="${one}"]').click()`);
    check('opening a card while isolated adds one history step carrying card, q and isolate', await addressHas({ view: 'board', q: pickedText, isolate: '1', card: String(one) }) && (await entryCount()) === before + 1, { address: await addressParams(), before, now: await entryCount() });
    await ev(`history.back()`);
    check('Back closes the card and keeps q and isolate', await addressHas({ view: 'board', q: pickedText, isolate: '1' }) && await switchIs(true) && (await boxText()) === pickedText, await addressParams());

    // --- the link, opened in a browser with nothing stored ----------------------------------------------------------------------------------
    const link = (view) => `/?q=${encodeURIComponent(pickedText)}&isolate=1&view=${view}`;
    check('the isolated link opens the Graph in a browser with nothing stored', await openFresh(link('graph'), `document.querySelectorAll('#graph-view .graph-node').length>0`));
    check('the Graph draws only the isolated set', await shows(SELECTORS.graph, sorted(one, two), 10000), await nowShown(SELECTORS.graph));
    check('with no dimmed card', await ev(notDimmed));
    check('the switch is on, the box holds the isolate text and the chip says isolated', await switchIs(true) && await boxIs(pickedText) && await chipSaysIsolated(), await boxText());
    check('the isolated link opens the Board in a browser with nothing stored', await openFresh(link('board'), `document.querySelectorAll('#board .card-el').length>0`));
    check('the Board shows only the isolated set', await shows(SELECTORS.board, sorted(one, two), 10000), await nowShown(SELECTORS.board));
    check('the switch is on in that fresh browser', await switchIs(true));
    await press('isolate-switch');
    check('in that fresh browser turning isolate off leaves the box empty', await switchIs(false) && await boxIs(''), await boxText());
    check('the address has neither parameter, and the Board shows every card again', await addressHas({ view: 'board' }) && await waitFor(boardReady), await addressParams());

    // --- a link with the parameter and no query ---------------------------------------------------------------------------------------------
    check('a link with the isolate parameter and no query opens the Board', await goto('/?isolate=1&view=board', boardReady));
    check('isolate is off, the box is empty and the chip is quiet', await switchIs(false) && (await boxText()) === '' && !(await chipSaysIsolated()), { box: await boxText(), chip: await chip() });
    check('and the address has lost the isolate parameter, with nothing typed', await addressHas({ view: 'board' }), await addressParams());
  },
};
