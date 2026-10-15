'use strict';
// The search panel, on the plan board: the toggle opens and closes the panel and
// says which, the header is as tall either way, and focusing the box opens nothing.
// The panel lists the built-in pills, blocked, review and waiting, each with a count
// taken before the search box, so turning one pill on leaves the others' counts as
// they were, and a status pill that is off takes its cards out of them. The pills
// follow the status pills' rules. On the Board a click on a pill puts its query in the
// box, shows only its cards and selects them (the card menu's bulk popup counts them);
// a click on it again clears the box; a click on a second pill, with Shift or without,
// grows the box to "review: | blocked:" and selects both sets, and a click on it again
// takes it out and leaves the first. A right-click solos a pill, so the box holds its
// query alone and the other pills are off, and a right-click on the soloed pill turns
// every pill off. With the panel closed Esc outside the box takes the added pill back
// out of the box, and the next Esc clears it. A pill is on, and announced as pressed, while its
// query is the anchor or an addition, and typing in the box turns it off. A closed
// panel shows a chip counting what is on, named for a screen reader. Tab reaches the
// toggle, the fold control and every pill, and Enter and Space act as a click. Esc
// closes the suggestion list first, then the panel, then clears the box: with focus in
// the box the text stays through the first two presses (the browser's own Esc, which
// clears a search field, is stopped for them) and focus stays in the box, and with
// focus on a pill the panel closes and focus goes back to the toggle. A focused pill keeps its focus across a poll and
// its count changes under it. A click on the toggle, the fold control or the panel's
// empty space never clears a card selection, and a double click on the Board's empty
// space does. In the Graph a click on a pill lights its
// cards, a done one included, and hides nothing, and with the Done status pill off the
// done cards leave the counts. The preference "Pill section starts folded", set in the
// preferences sheet, folds the section after a reload.
//
// The plan board's live cards are 1 to 18 and 22 to 29. Card 9 is blocked, card 10
// awaits review, and cards 4, 6 and 8 wait for a card that is not done. Card 12 is
// done and carries no sticker, so the scenario gives it a review sticker through the
// board's own API (each scenario starts from the board as it was): a done card that a
// pill counts. CASES holds these sets, and skills/web/test/browser-search-panel-
// scenario.test.js holds them to the search module and the pill list over the plan
// board's own cards. Each step waits on the page, never on a fixed sleep; a "nothing
// happened" check waits two animation frames. Keys go through the runner's key helper,
// a real key press, and a Shift+click is a real click with the Shift modifier.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectedIds, autoRefreshTick.

const { NOT_EMPTY } = require('./empty-space');

const CASES = {
  stickered: 12,
  before: { blocked: [9], review: [10], waiting: [4, 6, 8] },
  counts: { blocked: 1, review: 2, waiting: 3 },
  review: [10, 12],
  both: [9, 10, 12],
  blocked: [9],
  waiting: [4, 6, 8],
  waitingReview: [4, 6, 8, 10, 12],
  lonePatched: 3,
  patchedCounts: { blocked: 2, review: 2, waiting: 3 },
  doneOffCounts: { blocked: 2, review: 1, waiting: 3 },
};

module.exports = {
  name: 'search-panel',
  board: 'plan',
  timeoutMs: 120000,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, rightClick, check } = page;
    const sameIds = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const idsExpr = (expr) => `JSON.stringify(${expr})`;
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const picked = () => ev(`[...selectedIds].sort((a,b)=>a-b)`);
    const pickedIs = (ids) => waitFor(`${idsExpr(`[...selectedIds].sort((a,b)=>a-b)`)}===${JSON.stringify(JSON.stringify(ids))}`);
    const SHOWN = `[...new Set([...document.querySelectorAll('#board .card-el')].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b)`;
    const shown = () => ev(SHOWN);
    const shownIs = (ids) => waitFor(`${idsExpr(SHOWN)}===${JSON.stringify(JSON.stringify(ids))}`);
    const PANEL = `document.getElementById('search-panel')`;
    const TOGGLE = `document.getElementById('search-panel-toggle')`;
    const panelOpen = `!${PANEL}.classList.contains('hidden')&&${PANEL}.getBoundingClientRect().height>0`;
    const panelShut = `${PANEL}.classList.contains('hidden')`;
    const headerHeight = () => ev(`document.querySelector('header').offsetHeight`);
    const pillSel = (name) => `#search-pills .query-pill[data-pill-key="${name}"]`;
    const pillPressed = (name) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(pillSel(name))});return !!b&&b.getAttribute('aria-pressed')==='true'&&b.classList.contains('on')})()`);
    const pillShut = (name) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(pillSel(name))});return !!b&&b.getAttribute('aria-pressed')==='false'&&!b.classList.contains('on')})()`);
    // The plan board's config gives it pills of its own after these three (the board-pills scenario drives them), so what is read here is the three built-ins.
    const BUILT_IN_KEYS = JSON.stringify(['blocked', 'review', 'waiting']);
    const BUILT_IN_ONLY = `.filter((b)=>${BUILT_IN_KEYS}.includes(b.dataset.pillKey))`;
    const countsExpr = `JSON.stringify(Object.fromEntries([...document.querySelectorAll('#search-pills .query-pill')]${BUILT_IN_ONLY}.map((b)=>[b.dataset.pillKey,Number(b.querySelector('.query-pill-count').textContent)])))`;
    const counts = async () => JSON.parse(await ev(countsExpr));
    const countsAre = (want) => waitFor(`${countsExpr}===${JSON.stringify(JSON.stringify(want))}`);
    const order = () => ev(`[...document.querySelectorAll('#search-pills .query-pill')]${BUILT_IN_ONLY}.map((b)=>b.dataset.pillKey)`);
    const chip = () => ev(`(()=>{const c=document.getElementById('search-chip');return {hidden:c.classList.contains('hidden')||c.getBoundingClientRect().width===0,text:c.textContent,name:c.getAttribute('aria-label')||''}})()`);
    const focusId = () => ev(`document.activeElement&&(document.activeElement.id||document.activeElement.dataset.pillKey||document.activeElement.tagName)`);
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const MENU_OPEN = `(()=>{const m=document.querySelector('#search-input ~ .combobox-menu');return !!m&&!m.hidden})()`;
    const BULK_LIST_OPEN = `(()=>{const m=document.querySelector('#bulk-single-input ~ .combobox-menu');return !!m&&!m.hidden})()`;
    const BULK_POPUP_OPEN = `!document.getElementById('bulk-single').classList.contains('hidden')`;

    const clickOn = async (sel, extra = {}) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y, extra);
    };
    const openPanel = async () => {
      if (!(await ev(panelOpen))) await clickOn('#search-panel-toggle');
      return waitFor(panelOpen);
    };
    const closePanel = async () => {
      if (await ev(panelOpen)) await clickOn('#search-panel-toggle');
      return waitFor(panelShut);
    };
    const clearBox = async () => {
      await ev(`document.getElementById('search-clear-btn').click()`);
      return boxIs('');
    };
    const focusBoxAtEnd = () => ev(`(()=>{const i=document.getElementById('search-input');i.blur();i.setSelectionRange(i.value.length,i.value.length);i.focus()})()`);
    // A card is only clicked at a point where it is the topmost thing and not one of its own cues, buttons or bars.
    const cardPoint = (id) => ev(`(()=>{const el=document.querySelector('#board .card-el[data-id="${id}"]');if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    // The lowest and rightmost point of the Board that is on no card, control, text field or popup, by the page's own list.
    const emptyPoint = () => ev(`(()=>{const root=document.getElementById('board');const r=root.getBoundingClientRect();for(let y=Math.min(r.bottom,innerHeight)-8;y>Math.max(r.top,0);y-=8)for(let x=Math.min(r.right,innerWidth)-8;x>Math.max(r.left,0);x-=8){const e=document.elementFromPoint(x,y);if(e&&root.contains(e)&&!e.closest(${JSON.stringify(NOT_EMPTY)}))return {x,y}}return null})()`);
    const clickCard = async (id, extra = {}) => {
      const p = await cardPoint(id);
      if (!p) throw new Error(`no clickable point on Board card ${id}`);
      await click(p.x, p.y, extra);
    };
    // The board's own API, from the page: gives a card a sticker and answers the status.
    const patchCard = (id, changes) => ev(`fetch('/api/cards/${id}',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(changes)})}).then((r)=>r.status)`);
    // Loads a page cold; the stale flag keeps the page being left from answering for the new one.
    const goto = async (target, ready) => {
      await ev(`window.__stale=true`);
      await open(target);
      await waitFor(`window.__stale!==true`, 10000);
      return waitFor(ready, 10000);
    };
    const boardReady = `document.querySelectorAll('#board .card-el').length>20`;

    // --- the plan board, with one done card carrying a sticker -------------------------------
    check('the Board draws the plan board', await goto('/', boardReady));
    check('a done card is given a review sticker through the board\'s API', (await patchCard(CASES.stickered, { review: 'look once more' })) === 200);
    check('the Board draws the plan board again', await goto('/', boardReady));
    const liveIds = await shown();

    // --- closed to start, and focusing the box opens nothing ---------------------------------
    check('the panel starts closed and no chip is shown', await ev(panelShut) && (await chip()).hidden);
    await ev(`document.getElementById('search-input').focus()`);
    await waitFor(`document.activeElement===document.getElementById('search-input')`);
    await frames();
    check('focusing the search box does not open the panel', await ev(panelShut) && (await ev(`document.activeElement===document.getElementById('search-input')`)));
    await ev(`document.activeElement.blur()`);

    // --- the toggle opens and closes the panel, and the header keeps its height ----------------
    const heightShut = await headerHeight();
    check('the toggle says it is collapsed', await ev(`${TOGGLE}.getAttribute('aria-expanded')==='false'`));
    await clickOn('#search-panel-toggle');
    check('the toggle opens the panel and says it is expanded', await waitFor(panelOpen) && await ev(`${TOGGLE}.getAttribute('aria-expanded')==='true'`));
    check('the header is as tall with the panel open as shut', (await headerHeight()) === heightShut, { shut: heightShut, open: await headerHeight() });
    await clickOn('#search-panel-toggle');
    check('the toggle closes it again and says it is collapsed', await waitFor(panelShut) && await ev(`${TOGGLE}.getAttribute('aria-expanded')==='false'`));
    check('the header is as tall again', (await headerHeight()) === heightShut);

    // --- the pills and their counts ----------------------------------------------------------
    await openPanel();
    check('the panel lists blocked, review and waiting, in that order', sameIds(await order(), ['blocked', 'review', 'waiting']) && await ev(`[...document.querySelectorAll('#search-pills .query-pill')].slice(0, 3).map((b)=>b.dataset.pillKey).join()==='blocked,review,waiting'`), await order());
    check('each pill counts its cards, a done one included', await countsAre(CASES.counts), await counts());

    // --- a click on a pill, on the Board ---------------------------------------------------------
    await clickOn(pillSel('review'));
    check('a click on review puts review: in the box', await boxIs('review:'), await boxText());
    check('the Board shows only the review cards', await shownIs(CASES.review), await shown());
    check('the review cards are the selection, and the bulk targets', await pickedIs(CASES.review), await picked());
    check('turning review on leaves the blocked and waiting counts as they were', await countsAre(CASES.counts), await counts());
    check('the pill is on and announced as pressed', await pillPressed('review') && await pillShut('blocked') && await pillShut('waiting'));
    await rightClick(`#board .card-el[data-id="${CASES.review[0]}"]`);
    check('a right-click on a selected card opens the card menu', await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`));
    await ev(`document.getElementById('ctx-assign').click()`);
    check('the bulk popup counts the selected cards', await waitFor(`document.getElementById('bulk-single-title').textContent==='Assign ${CASES.review.length} card(s)'`), await ev(`document.getElementById('bulk-single-title').textContent`));
    // The popup's value box is an assignee combobox that opens its list as the popup focuses it, and an open list takes the first Esc, as the search box's does.
    check('the bulk popup has its assignee suggestion list open', await waitFor(BULK_LIST_OPEN));
    await key('Escape');
    check('the first Esc closes that suggestion list and leaves the bulk popup open', await waitFor(`!(${BULK_LIST_OPEN})`) && await ev(BULK_POPUP_OPEN) && await ev(panelOpen));
    await key('Escape');
    check('the next Esc closes the bulk popup, before the panel, which stays open', await waitFor(`!(${BULK_POPUP_OPEN})`) && await ev(panelOpen));

    await clickOn(pillSel('review'));
    check('a click on review again clears the box', await boxIs(''), await boxText());
    check('a second click on review empties the selection', await pickedIs([]), await picked());
    check('a second click on review turns the pill off', await pillShut('review'));
    check('a second click on review brings every card back to the Board', await shownIs(liveIds));

// --- a click on a second pill, with Shift or without ---------------------------------------------
    await clickOn(pillSel('review'));
    await boxIs('review:');
    await clickOn(pillSel('blocked'));
    check('a click on blocked turns it on beside review: the box holds both and both pills are on', await boxIs('review: | blocked:') && await pillPressed('review') && await pillPressed('blocked'), await boxText());
    check('a click on blocked selects both sets and the Board shows both', await shownIs(CASES.both) && await pickedIs(CASES.both), await picked());
    check('the counts have not moved after a plain click', await countsAre(CASES.counts));
    await clickOn(pillSel('blocked'));
    check('a click on blocked again turns it off and returns the box to "review:"', await boxIs('review:') && await pillShut('blocked') && await pillPressed('review'), await boxText());
    check('a click on blocked again leaves the review cards selected and shown', await pickedIs(CASES.review) && await shownIs(CASES.review));
    await clickOn(pillSel('blocked'), { modifiers: 8 });
    check('Shift+click on blocked grows the box to "review: | blocked:"', await boxIs('review: | blocked:'), await boxText());
    check('the Board shows both sets and selects them', await shownIs(CASES.both) && await pickedIs(CASES.both), await picked());
    check('both pills are on', await pillPressed('review') && await pillPressed('blocked'));
    check('the counts have not moved', await countsAre(CASES.counts));
    await clickOn(pillSel('blocked'), { modifiers: 8 });
    check('Shift+click on blocked does what a click does: it turns blocked off and leaves review on', await boxIs('review:') && await pillShut('blocked') && await pillPressed('review'), await boxText());
    check('Shift+click on blocked again returns the selection to the review cards and turns blocked off', await pickedIs(CASES.review) && await shownIs(CASES.review) && await pillShut('blocked'));
    await clickOn(pillSel('review'));
    check('a click on the only pill that is on clears the box', await boxIs('') && await pillShut('review') && await pickedIs([]), await boxText());

    // --- a right-click solos a pill ---------------------------------------------------------------------
    await rightClick(pillSel('review'));
    check('a right-click on review puts review: in the box and selects its cards', await boxIs('review:') && await pickedIs(CASES.review) && await shownIs(CASES.review));
    check('the browser\'s own menu did not open over the pill', await ev(`document.getElementById('context-menu').classList.contains('hidden')`));
    await clickOn(pillSel('blocked'));
    await boxIs('review: | blocked:');
    await clickOn(pillSel('waiting'));
    check('a click on waiting turns it on beside the others: the box holds all three', await boxIs('review: | blocked: | waiting:') && await pillPressed('review') && await pillPressed('blocked') && await pillPressed('waiting'), await boxText());
    await rightClick(pillSel('blocked'));
    check('a right-click on blocked solos it: the box holds blocked: alone and the other pills are off', await boxIs('blocked:') && await pillPressed('blocked') && await pillShut('review') && await pillShut('waiting'), await boxText());
    check('a right-click on blocked leaves its cards the selection and the only ones shown', await pickedIs(CASES.blocked) && await shownIs(CASES.blocked), await picked());
    await rightClick(pillSel('blocked'));
    check('a right-click on the soloed pill turns every pill off and empties the box', await boxIs('') && await pillShut('blocked') && await pillShut('review') && await pillShut('waiting'), await boxText());
    check('a right-click on the soloed pill empties the selection and brings every card back', await pickedIs([]) && await shownIs(liveIds));

    // --- Esc with the panel closed takes the added pill out, then the anchor ------------------------------------
    await clickOn(pillSel('review'));
    await boxIs('review:');
    await clickOn(pillSel('blocked'), { modifiers: 8 });
    await boxIs('review: | blocked:');
    await closePanel();
    check('with the panel closed the chip counts the two pills on and names them', !(await chip()).hidden && (await chip()).text === '2' && /blocked/.test((await chip()).name) && /review/.test((await chip()).name), await chip());
    check('focus is on the toggle, outside the box', await ev(`document.activeElement===${TOGGLE}`));
    await key('Escape');
    check('Esc with focus outside the box returns the box to "review:"', await boxIs('review:') && await pickedIs(CASES.review), await boxText());
    check('the chip counts one', (await chip()).text === '1' && /review/.test((await chip()).name) && !(await chip()).hidden, await chip());
    await key('Escape');
    check('the next Esc clears the box', await boxIs('') && await pickedIs([]) && await shownIs(liveIds), await boxText());
    check('with nothing on there is no chip', (await chip()).hidden);

    // --- typing turns a pill off ---------------------------------------------------------------------------------------
    await openPanel();
    await clickOn(pillSel('review'));
    await boxIs('review:');
    check('review is pressed while its query is the anchor', await pillPressed('review'));
    await ev(`(()=>{const i=document.getElementById('search-input');i.focus();i.setSelectionRange(i.value.length,i.value.length)})()`);
    await send('Input.insertText', { text: 'x' });
    check('typing in the box turns the pill off', await boxIs('review:x') && await waitFor(`document.querySelector(${JSON.stringify(pillSel('review'))}).getAttribute('aria-pressed')==='false'`) && await pickedIs([]), await boxText());
    await clearBox();

    // --- the keyboard: Tab, Enter and Space ---------------------------------------------------------------------------------
    await closePanel();
    await ev(`document.getElementById('search-input').focus()`);
    await key('Tab');
    check('Tab from the box reaches the toggle', (await focusId()) === 'search-panel-toggle', await focusId());
    await key('Enter');
    check('Enter on the toggle opens the panel', await waitFor(panelOpen));
    const reached = [];
    for (let i = 0; i < 4; i++) { await key('Tab'); reached.push(await focusId()); }
    check('Tab goes on to the fold control and the three built-in pills, in order', sameIds(reached, ['search-pills-fold', 'blocked', 'review', 'waiting']), reached);
    await key('Enter');
    check('Enter on a pill acts as a click', await boxIs('waiting:') && await pickedIs(CASES.waiting), await boxText());
    check('the pill keeps focus after Enter', (await focusId()) === 'waiting', await focusId());
    await key('Tab', { shift: true });
    await key(' ');
    check('Space on a pill acts as a click too: it turns review on beside waiting', await boxIs('waiting: | review:') && await pickedIs(CASES.waitingReview), await boxText());
    check('the pill keeps focus after Space', (await focusId()) === 'review', await focusId());
    await key('Tab', { shift: true });
    await key('Tab', { shift: true });
    check('Shift+Tab goes back to the fold control', (await focusId()) === 'search-pills-fold', await focusId());
    await key('Enter');
    check('Enter on the fold control folds the section', await waitFor(`document.getElementById('search-pills').classList.contains('hidden')&&document.getElementById('search-pills-fold').getAttribute('aria-expanded')==='false'`));
    await key(' ');
    check('Space on it unfolds the section', await waitFor(`!document.getElementById('search-pills').classList.contains('hidden')&&document.getElementById('search-pills-fold').getAttribute('aria-expanded')==='true'`));
    await clearBox();

    // --- Esc: the suggestion list, then the panel, then the box ------------------------------------------------------------------------
    await openPanel();
    await ev(`document.getElementById('search-input').focus()`);
    await send('Input.insertText', { text: 'zephyr' });
    await boxIs('zephyr');
    await focusBoxAtEnd();
    check('focus in the box holding text opens its suggestion list, with the panel open', await waitFor(MENU_OPEN) && await ev(panelOpen));
    await key('Escape');
    check('the first Esc closes the suggestion list, leaves the panel open and the box holding its text', await waitFor(`!(${MENU_OPEN})`) && await ev(panelOpen) && (await boxText()) === 'zephyr', await boxText());
    await key('Escape');
    check('the second Esc closes the panel, keeps the text and leaves focus in the box', await waitFor(panelShut) && (await boxText()) === 'zephyr' && await ev(`document.activeElement===document.getElementById('search-input')`), { box: await boxText(), focus: await focusId() });
    await key('Escape');
    check('the third Esc, with focus in the box, clears it', await boxIs(''), await boxText());
    await openPanel();
    await ev(`document.querySelector(${JSON.stringify(pillSel('review'))}).focus()`);
    await key('Escape');
    check('Esc with focus on a pill closes the panel and puts focus back on the toggle', await waitFor(panelShut) && await ev(`document.activeElement===${TOGGLE}`), await focusId());

    // --- a click on the toggle, the fold control or the panel\'s empty space keeps a selection ---------------------------------------------------
    const [first, second] = liveIds.filter((id) => ![9, 10, 12].includes(id));
    await clickCard(first, { modifiers: 2 });
    await clickCard(second, { modifiers: 2 });
    check('two cards are selected with Ctrl+click', await pickedIs([first, second].sort((a, b) => a - b)), await picked());
    await clickOn('#search-panel-toggle');
    await waitFor(panelOpen);
    check('a click on the toggle leaves the selection', await pickedIs([first, second].sort((a, b) => a - b)), await picked());
    await clickOn('#search-pills-fold');
    check('a click on the fold control leaves the selection', await pickedIs([first, second].sort((a, b) => a - b)), await picked());
    await clickOn('#search-pills-fold');
    const empty = await ev(`(()=>{const p=${PANEL};const r=p.getBoundingClientRect();const x=r.left+4,y=r.top+4;return document.elementFromPoint(x,y)===p?{x,y}:null})()`);
    check('the panel has empty space at its corner', !!empty, empty);
    if (empty) await click(empty.x, empty.y);
    check('a click on the panel\'s empty space leaves the selection', await pickedIs([first, second].sort((a, b) => a - b)) && await ev(panelOpen), await picked());
    await closePanel();

    // --- a focused pill keeps focus across a poll, and its count changes in place ------------------------------------------------------------------
    await clearBox();
    const away = await emptyPoint();
    check('the Board has empty space to double-click', !!away, away);
    if (away) {
      await click(away.x, away.y, { clickCount: 1 });
      await click(away.x, away.y, { clickCount: 2 });
    }
    check('a double click on empty space on the Board drops the selection', await pickedIs([]));
    await openPanel();
    await ev(`(()=>{const b=document.querySelector(${JSON.stringify(pillSel('blocked'))});window.__pill=b;b.focus()})()`);
    check('the blocked pill has focus', (await focusId()) === 'blocked');
    check('a card is blocked through the board\'s API', (await patchCard(CASES.lonePatched, { blocked: 'waiting on the vendor' })) === 200);
    await ev(`autoRefreshTick()`);
    check('the poll updates the blocked count in place', await countsAre(CASES.patchedCounts), await counts());
    check('the pill that had focus is the same element and has it still', await ev(`document.activeElement===window.__pill&&document.contains(window.__pill)`));

    // --- the Graph: a click lights, hides nothing, and the Done pill takes done cards out of the counts -------------------------------------------------
    await closePanel();
    check('the Graph draws the plan board', await goto('/?view=graph', `document.querySelectorAll('.graph-node').length>20`));
    const dots = await ev(`document.querySelectorAll('.graph-node').length`);
    await openPanel();
    check('the pills count the same cards in the Graph', await countsAre(CASES.patchedCounts), await counts());
    await clickOn(pillSel('review'));
    const LIT = `[...document.querySelectorAll('.graph-node.graph-near')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`;
    check('a click on review lights the review cards, a done one included', await waitFor(`${idsExpr(LIT)}===${JSON.stringify(JSON.stringify(CASES.review))}`), await ev(LIT));
    check('a click on review in the Graph dims the rest', await ev(`document.querySelector('.graph-canvas').classList.contains('graph-dim')`));
    check('a click on review in the Graph hides no dot', (await ev(`document.querySelectorAll('.graph-node').length`)) === dots);
    check('the box holds the pill\'s query', (await boxText()) === 'review:');
    await ev(`document.querySelector('.graph-filter-toggle[data-col="done"]').click()`);
    check('with the Done status pill off, the done cards leave the pill counts', await countsAre(CASES.doneOffCounts), await counts());
    check('with the Done status pill off the done review card is no longer lit', await waitFor(`${idsExpr(LIT)}===${JSON.stringify(JSON.stringify([CASES.review[0]]))}`), await ev(LIT));

    // --- the preference: the pill section starts folded after a reload -------------------------------------------------------------------------------
    check('the Board draws the plan board once more', await goto('/', boardReady));
    await openPanel();
    check('the pill section starts unfolded by default', await ev(`!document.getElementById('search-pills').classList.contains('hidden')`) && await ev(`document.getElementById('search-pills-fold').getAttribute('aria-expanded')==='true'`));
    await closePanel();
    await clickOn('#prefs-btn');
    await waitFor(`!document.getElementById('prefs-sheet').classList.contains('hidden')`);
    await waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 2500);
    check('the sheet shows "Pill section starts folded" off', await ev(`document.getElementById('prefs-pills-folded').checked===false`));
    await clickOn('#prefs-pills-folded');
    check('the checkbox turns on', await waitFor(`document.getElementById('prefs-pills-folded').checked===true`));
    await key('Escape');
    await waitFor(`document.getElementById('prefs-sheet').classList.contains('hidden')`);
    check('the Board draws the plan board after a reload', await goto('/', boardReady));
    await openPanel();
    check('the pill section starts folded after the reload', await waitFor(`document.getElementById('search-pills').classList.contains('hidden')&&document.getElementById('search-pills-fold').getAttribute('aria-expanded')==='false'`));
    await clickOn('#search-pills-fold');
    check('its fold control still unfolds it for the visit', await waitFor(`!document.getElementById('search-pills').classList.contains('hidden')`));
  },
};
