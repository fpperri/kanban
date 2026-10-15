'use strict';
// Isolate, on the plan board: the switch at the foot of the search panel and the i key show only
// the selection, in every view. Four parts, each from a cold page.
//
// The Graph. A plain click on one loose card, a Shift+click on another, Dependency path on card 4
// from its menu and a Shift+click on the grill pill build a selection of an anchor and three
// additions. The switch writes `#a | #b | path:4 | tags:"grill"` into the box, and only the cards
// of that selection are drawn (the two cards, the path 1, 3 and 4, and the grill card 8). The
// switch reports on to assistive technology. The first Esc closes the panel; with the panel
// closed the chip says isolated. A click on a shown card moves the anchor and leaves the box and
// the shown cards; a click and a double click on the empty Graph leave the selection and the box;
// Esc, with focus outside the box, turns isolate off and every card is drawn again.
//
// The views. Three Ctrl+clicks on the Board pick two loose cards and the card dated in June 2031
// (28), and the i key writes `#17 | #14 | #28`. The Board, the Map and the Graph show those three
// cards; the Gantt lists the dated one; the Calendar, entered with isolate on, jumps to the month of
// the 2031 card and draws it. With only the 2031 card picked and the Calendar showing the page's own
// current month, the i key jumps it to June 2031.
// A keystroke typed after isolating one card keeps the text's leading # (`#28x`).
//
// The box's text and Esc. A search typed in the box (`zephyr`) narrows the Board, and two of its
// cards are picked. The switch writes `#1 | #2`; the first Esc closes the panel and leaves isolate
// on, the second turns it off and the box holds `zephyr` again. The i key, then Esc with focus
// outside the box, does the same; the next Esc drops the addition. The switch clicked off gives
// the text back. Tab reaches the switch from the last pill, and Enter and Space flip it. A double
// click on the switch leaves the selection. i typed in the box is a letter, and with a card menu
// up it does nothing.
//
// The poll. With the grill pill on and isolated, a tag given to card 14 through the board's API
// makes that card appear on the Board after the next poll.
//
// The plan board's live cards are 1 to 18 and 22 to 29. CASES holds what the scenario relies on
// (the path of card 4, the grill pill's cards, the cards the Gantt lists, the zephyr cards), and
// skills/web/test/browser-isolate-scenario.test.js holds it to the search module over the board's
// own cards and config. The cards the scenario clicks in the Graph are the first two of CASES.loose
// that no other dot covers, so the expected set is worked out from them. Each step waits on the
// page, never on a fixed sleep; a "nothing happened" check waits two animation frames. Keys and
// clicks go through the runner's helpers, a real key press and a real mouse click (Shift is 8 and
// Ctrl is 2).
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// autoRefreshTick, selectedIds, selectionState.

const { SELECTORS } = require('./slice-term');

const CASES = {
  // Loose cards of the plan board, with no parent, child or wait, that the Graph may have to click.
  loose: [17, 14, 15, 13, 12, 11, 10, 9, 16],
  pathOf: 4,
  pathCards: [1, 3, 4],
  pill: { label: 'grill', query: 'tags:"grill"', cards: [8] },
  // The Board narrowed by `zephyr`, and the two of its cards the scenario picks.
  zephyr: { query: 'zephyr', cards: [1, 2, 7, 11], picked: [1, 2] },
  // The cards the views section picks (two loose cards and the card dated in 2031), what the Gantt and
  // the Calendar draw of them, and the month the Calendar jumps to.
  dated: { picked: [17, 14, 28], gantt: [28], calendar: [28], month: 'June 2031', card: 28 },
  // The card that gets the grill tag through the API, which carries no tag yet.
  tagged: 14,
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

module.exports = {
  name: 'isolate',
  board: 'plan',
  timeoutMs: 120000,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, centre, mouse, click, key, rightClick, check, shot } = page;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const sorted = (...ids) => [...new Set(ids)].sort((a, b) => a - b);
    const idsOf = (selector) => `JSON.stringify([...new Set([...document.querySelectorAll(${JSON.stringify(selector)})].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b))`;
    const shows = (selector, ids, ms) => waitFor(`${idsOf(selector)}===${JSON.stringify(JSON.stringify(ids))}`, ms);
    const nowShown = (selector) => ev(idsOf(selector));
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const pickedIs = (ids) => waitFor(`JSON.stringify([...selectedIds].sort((a,b)=>a-b))===${JSON.stringify(JSON.stringify(ids))}`);
    const pickedSize = (n) => waitFor(`selectedIds.size===${n}`);
    const parts = () => ev(`(()=>{const s=selectionState.selection;const name=(p)=>p.kind==='query'?'query:'+p.text:p.kind+':'+p.id;return {anchor:s.anchor&&name(s.anchor),additions:s.additions.map(name)}})()`);
    const goto = async (target, ready) => {
      await ev(`window.__stale=true`);
      await open(target);
      await waitFor(`window.__stale!==true`, 10000);
      return waitFor(ready, 10000);
    };
    const boardReady = `document.querySelectorAll('#board .card-el').length>20`;
    const SWITCH = `document.getElementById('isolate-switch')`;
    const switchIs = (on) => waitFor(`${SWITCH}.getAttribute('aria-checked')===${JSON.stringify(String(on))}`);
    const PANEL = `document.getElementById('search-panel')`;
    const panelOpen = `!${PANEL}.classList.contains('hidden')&&${PANEL}.getBoundingClientRect().height>0`;
    const panelShut = `${PANEL}.classList.contains('hidden')`;
    // The panel opens when the box is focused, so the box is blurred first and focused afresh. The box is then
    // blurred again: that closes the suggestion list, which would hang over the panel's foot, and leaves the
    // panel open.
    const openPanel = async () => {
      await ev(`(()=>{const i=document.getElementById('search-input');i.blur();i.focus()})()`);
      const opened = await waitFor(panelOpen);
      await ev(`document.getElementById('search-input').blur()`);
      return opened && await waitFor(panelOpen);
    };
    const focusBoxAtEnd = () => ev(`(()=>{const i=document.getElementById('search-input');i.blur();i.setSelectionRange(i.value.length,i.value.length);i.focus()})()`);
    const blur = () => ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    const focusId = () => ev(`document.activeElement&&document.activeElement.id`);
    const clickOn = async (selector, extra = {}) => {
      const p = await centre(selector);
      if (!p) throw new Error(`nothing matches ${selector}`);
      await click(p.x, p.y, extra);
    };
    const pillSel = (label) => `#search-pills .query-pill[data-pill-key="value:tags:${label}"]`;
    const chip = () => ev(`(()=>{const c=document.getElementById('search-chip');return {hidden:c.classList.contains('hidden')||c.getBoundingClientRect().width===0,text:c.textContent,name:c.getAttribute('aria-label')||'',title:c.title}})()`);
    const chipSaysIsolated = async () => {
      const c = await chip();
      return !c.hidden && c.text === 'isolated' && /isolated/.test(c.name) && /isolated/.test(c.title);
    };
    const chipHidden = async () => (await chip()).hidden;
    const MENU_UP = `!document.getElementById('context-menu').classList.contains('hidden')`;
    const escape = () => key('Escape');
    const patchCard = (id, changes) => ev(`fetch('/api/cards/${id}',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(changes)})}).then((r)=>r.status)`);

    // A Board tile's point that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (id) => ev(`(()=>{const el=document.querySelector('#board .card-el[data-id="${id}"]');if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    const clickTile = async (id, extra = {}) => {
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
    const monthName = (year, monthIndex) => `${MONTHS[((monthIndex % 12) + 12) % 12]} ${year + Math.floor(monthIndex / 12)}`;
    const titleIs = (view, text, ms) => waitFor(`((document.querySelector('#${view}-view .cal-title')||{}).textContent||'')===${JSON.stringify(text)}`, ms);
    const titleOf = (view) => ev(`((document.querySelector('#${view}-view .cal-title')||{}).textContent||'')`);
    const press = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`);
    const viewShown = (container) => `!document.querySelector(${JSON.stringify(container)}).classList.contains('hidden')`;

    // --- the Graph: an anchor, a Shift+click, a path and a pill, then the switch -------------------------
    check('the Graph draws the plan board', await goto('/?view=graph', `document.querySelectorAll('.graph-node').length>20`));
    const total = await ev(`new Set([...document.querySelectorAll('.graph-node')].map((n)=>n.dataset.id)).size`);
    const rect = await ev(`(()=>{const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {r:r.right,b:r.bottom}})()`);
    const bg = { x: rect.r - 14, y: rect.b - 14 };
    check('the empty corner of the Graph is not a card', await ev(`!document.elementFromPoint(${bg.x},${bg.y}).closest('.card-el')`));
    const clickable = [];
    for (const id of CASES.loose) if (clickable.length < 2 && await dotPoint(id)) clickable.push(id);
    check('two loose cards can be clicked without another dot in the way', clickable.length === 2, clickable);
    const [a, b] = clickable;
    const wanted = sorted(a, b, ...CASES.pathCards, ...CASES.pill.cards);
    const wantedText = `#${a} | #${b} | path:${CASES.pathOf} | ${CASES.pill.query}`;

    await clickDot(a);
    await clickDot(b, { modifiers: 8 });
    await rightClick(`#graph-view .card-el[data-id="${CASES.pathOf}"]`);
    check('a right-click on a card in the Graph opens its menu', await waitFor(MENU_UP));
    await press('ctx-path');
    check('Dependency path adds the path to the selection', await pickedSize(2 + CASES.pathCards.length), await ev(`[...selectedIds]`));
    await openPanel();
    await clickOn(pillSel(CASES.pill.label), { modifiers: 8 });
    check('a Shift+click on the grill pill adds its card, and the box stays as it was, empty', await pickedIs(wanted) && (await boxText()) === '', { picked: await ev(`[...selectedIds]`), box: await boxText() });
    check('the selection is the anchor card, then the second card, the path and the pill', same(await parts(), { anchor: `card:${a}`, additions: [`card:${b}`, `path:${CASES.pathOf}`, `query:${CASES.pill.query}`] }), await parts());
    check('the switch is off to start and reports it', await switchIs(false) && (await ev(`${SWITCH}.getAttribute('role')`)) === 'switch');

    await clickOn('#isolate-switch');
    check('the switch writes the selection into the box, each part by what it names', await boxIs(wantedText), await boxText());
    check('only the cards of the selection are drawn in the Graph', await shows(SELECTORS.graph, wanted), await nowShown(SELECTORS.graph));
    check('with isolate on, the switch reports on to assistive technology', await switchIs(true));
    check('and the selection is as it was', await pickedIs(wanted));
    await shot('isolate-graph');
    await escape();
    check('the first Esc closes the panel, and leaves isolate on, the box and the cards as they were', await waitFor(panelShut) && await switchIs(true) && (await boxText()) === wantedText && await shows(SELECTORS.graph, wanted));
    check('with the panel closed, the chip says isolated', await chipSaysIsolated(), await chip());

    // A click on a shown card moves the anchor and leaves the box and the shown cards. The first shown dot with a clear point is clicked.
    let moved = null;
    for (const id of wanted) if (moved === null && await dotPoint(id)) moved = id;
    check('a shown card can be clicked without another dot in the way', moved !== null, wanted);
    await clickDot(moved);
    check('a click on a shown card makes it the anchor and drops the additions', await pickedIs([moved]) && same(await parts(), { anchor: `card:${moved}`, additions: [] }), await parts());
    check('and leaves the box text and the shown cards as they were', (await boxText()) === wantedText && await shows(SELECTORS.graph, wanted) && await switchIs(true), { box: await boxText(), shown: await nowShown(SELECTORS.graph) });
    await mouse('mouseMoved', bg.x, bg.y);
    await click(bg.x, bg.y);
    await frames();
    check('a click on the empty Graph leaves the selection, the box and the shown cards', await pickedIs([moved]) && (await boxText()) === wantedText && await shows(SELECTORS.graph, wanted));
    await click(bg.x, bg.y, { clickCount: 2 });
    await frames();
    check('and so does a double click on the empty Graph', await pickedIs([moved]) && (await boxText()) === wantedText && await shows(SELECTORS.graph, wanted) && await switchIs(true), { picked: await ev(`[...selectedIds]`), box: await boxText() });

    await blur();
    await escape();
    check('Esc with focus outside the box turns isolate off, and every card is drawn again', await switchIs(false) && await waitFor(`new Set([...document.querySelectorAll('.graph-node')].map((n)=>n.dataset.id)).size===${total}`), { box: await boxText(), dots: await ev(`document.querySelectorAll('.graph-node').length`) });
    check('and gives the box back its earlier text, which was empty, leaving the anchor where the click put it', (await boxText()) === '' && await pickedIs([moved]) && await chipHidden(), { box: await boxText(), chip: await chip() });

    // --- the views, with the i key ------------------------------------------------------------------
    check('the Board draws the plan board', await goto('/?view=board', boardReady));
    for (const id of CASES.dated.picked) await clickTile(id, { modifiers: 2 });
    check('three Ctrl+clicks pick the loose card and the two dated cards', await pickedIs(sorted(...CASES.dated.picked)) && same((await parts()).anchor, `card:${CASES.dated.picked[0]}`), await parts());
    await blur();
    await key('i');
    const datedText = CASES.dated.picked.map((id) => `#${id}`).join(' | ');
    check('the i key writes the selection into the box', await boxIs(datedText) && await switchIs(true), await boxText());
    check('the Board shows only those cards', await shows(SELECTORS.board, sorted(...CASES.dated.picked)), await nowShown(SELECTORS.board));
    check('the chip says isolated with the panel closed', await chipSaysIsolated(), await chip());
    for (const [view, container, selector, wantedIds] of [
      ['map', '#map-view', SELECTORS.map, sorted(...CASES.dated.picked)],
      ['gantt', '#gantt-view', SELECTORS.gantt, sorted(...CASES.dated.gantt)],
      ['calendar', '#calendar-view', SELECTORS.calendar, sorted(...CASES.dated.calendar)],
      ['graph', '#graph-view', SELECTORS.graph, sorted(...CASES.dated.picked)],
    ]) {
      await press(`${view}-toggle-btn`);
      check(`${view}: the view is up`, await waitFor(viewShown(container), 10000));
      if (view === 'calendar') check('the Calendar, entered with isolate on, jumps to the month of the card dated in 2031', await titleIs('calendar', CASES.dated.month), await titleOf('calendar'));
      check(`${view}: only the isolated cards are drawn`, await shows(selector, wantedIds, 10000), await nowShown(selector));
      check(`${view}: the selection, the box and the switch are as they were`, await pickedIs(sorted(...CASES.dated.picked)) && (await boxText()) === datedText && await switchIs(true));
    }
    await press('graph-toggle-btn');
    check('the Board shows the same cards after the round', await waitFor(viewShown('#board')) && await shows(SELECTORS.board, sorted(...CASES.dated.picked)), await nowShown(SELECTORS.board));
    await key('i');
    check('the i key turns isolate off, and the Board has every live card again', await boxIs('') && await switchIs(false) && await waitFor(`document.querySelectorAll('#board .card-el').length>20`));

    // --- the Calendar jumps to the isolated card's month, from the Calendar ----------------------------------------
    check('the Board draws the plan board again', await goto('/?view=board', boardReady));
    await clickTile(CASES.dated.card, { modifiers: 2 });
    await pickedIs([CASES.dated.card]);
    await press('calendar-toggle-btn');
    const [year, monthIndex] = await ev(`(()=>{const d=new Date();return [d.getFullYear(),d.getMonth()]})()`);
    check('the Calendar opens on the page\'s own current month, whatever is selected', await titleIs('calendar', monthName(year, monthIndex)), await titleOf('calendar'));
    await blur();
    await key('i');
    check('isolating the card dated in 2031, in the Calendar\'s month view, jumps to its month', await titleIs('calendar', CASES.dated.month), await titleOf('calendar'));
    check('and the card is drawn there', await shows(SELECTORS.calendar, [CASES.dated.card]), await nowShown(SELECTORS.calendar));
    await shot('isolate-calendar');

    // --- a keystroke typed after isolating one card keeps the leading # -------------------------------------------
    check('the Board draws the plan board once more', await goto('/?view=board', boardReady));
    await clickTile(CASES.dated.card, { modifiers: 2 });
    await pickedIs([CASES.dated.card]);
    await blur();
    await key('i');
    check('one card isolated is written as #id alone', await boxIs(`#${CASES.dated.card}`), await boxText());
    await focusBoxAtEnd();
    await key('x');
    check('a keystroke typed at the end of the box keeps the text\'s leading #', await boxIs(`#${CASES.dated.card}x`), await boxText());

    // --- the box's text, and Esc ------------------------------------------------------------------------------------
    check('the Board draws the plan board for the Esc steps', await goto('/?view=board', boardReady));
    for (const id of CASES.zephyr.picked) await clickTile(id, { modifiers: 2 });
    check('two cards are picked on the Board', await pickedIs(sorted(...CASES.zephyr.picked)));
    await focusBoxAtEnd();
    await send('Input.insertText', { text: CASES.zephyr.query });
    check('a search narrows the Board to the zephyr cards', await boxIs(CASES.zephyr.query) && await shows(SELECTORS.board, sorted(...CASES.zephyr.cards)), await nowShown(SELECTORS.board));
    check('the panel is open, and the picked cards are still picked', await waitFor(panelOpen) && await pickedIs(sorted(...CASES.zephyr.picked)));
    await blur();
    const pickedText = CASES.zephyr.picked.map((id) => `#${id}`).join(' | ');
    await clickOn('#isolate-switch');
    check('the switch writes the two cards, and the Board shows only them', await boxIs(pickedText) && await shows(SELECTORS.board, sorted(...CASES.zephyr.picked)), await boxText());
    await escape();
    check('with the panel open and isolate on, the first Esc closes the panel and leaves isolate on', await waitFor(panelShut) && await switchIs(true) && (await boxText()) === pickedText);
    await escape();
    check('the second Esc turns isolate off and gives the box back the text it held', await switchIs(false) && await boxIs(CASES.zephyr.query) && await shows(SELECTORS.board, sorted(...CASES.zephyr.cards)), await boxText());
    check('and the two cards are still picked', await pickedIs(sorted(...CASES.zephyr.picked)));

    await key('i');
    check('the i key turns it on again', await switchIs(true) && await boxIs(pickedText));
    await blur();
    await escape();
    check('Esc with focus outside the box turns isolate off and gives the box back its earlier text', await switchIs(false) && await boxIs(CASES.zephyr.query), await boxText());
    await escape();
    check('after isolate is off, a second Esc drops the additions and leaves the anchor', await pickedIs([CASES.zephyr.picked[0]]) && same(await parts(), { anchor: `card:${CASES.zephyr.picked[0]}`, additions: [] }) && (await boxText()) === CASES.zephyr.query, await parts());

    await clickTile(CASES.zephyr.picked[1], { modifiers: 2 });
    await pickedIs(sorted(...CASES.zephyr.picked));
    await openPanel();
    await clickOn('#isolate-switch');
    check('the switch writes the cards again', await boxIs(pickedText) && await switchIs(true));
    await clickOn('#isolate-switch');
    check('turning the switch off gives the box back its earlier text', await boxIs(CASES.zephyr.query) && await switchIs(false), await boxText());

    // --- the keyboard: Tab, Enter and Space, and a double click -----------------------------------------------------
    await openPanel();
    await ev(`(()=>{const b=document.querySelectorAll('#search-pills button');b[b.length-1].focus()})()`);
    await key('Tab');
    check('Tab from the last pill reaches the switch', (await focusId()) === 'isolate-switch', await focusId());
    await key('Enter');
    check('Enter on the switch turns isolate on', await switchIs(true) && await boxIs(pickedText), await boxText());
    await key(' ');
    check('Space on the switch turns it off', await switchIs(false) && await boxIs(CASES.zephyr.query), await boxText());
    check('the switch keeps focus through both', (await focusId()) === 'isolate-switch', await focusId());
    await clickOn('#isolate-switch');
    await switchIs(true);
    await clickOn('#isolate-switch', { clickCount: 2 });
    check('a click on the switch, even the second of a double click, never clears the selection', await switchIs(false) && await boxIs(CASES.zephyr.query) && await pickedIs(sorted(...CASES.zephyr.picked)) && same((await parts()).anchor, `card:${CASES.zephyr.picked[0]}`), await parts());

    // --- where i does nothing ----------------------------------------------------------------------------------------
    await focusBoxAtEnd();
    await key('i');
    check('i typed in the search box is a letter and does not touch isolate', await boxIs(`${CASES.zephyr.query}i`) && await switchIs(false), await boxText());
    await ev(`document.getElementById('search-clear-btn').click()`);
    await boxIs('');
    await blur();
    await rightClick(`#board .card-el[data-id="${CASES.zephyr.picked[0]}"]`);
    check('a right-click on a card opens its menu', await waitFor(MENU_UP));
    await key('i');
    await frames();
    check('with a card menu up, i does nothing', await switchIs(false) && await ev(MENU_UP) && (await boxText()) === '');
    await escape();
    check('Esc closes the card menu', await waitFor(`!(${MENU_UP})`));
    await key('i', { ctrl: true });
    await key('i', { alt: true });
    await frames();
    check('i with Ctrl or Alt held does nothing', await switchIs(false) && (await boxText()) === '');

    // --- the poll -----------------------------------------------------------------------------------------------------
    check('the Board draws the plan board before the poll', await goto('/?view=board', boardReady));
    await openPanel();
    await clickOn(pillSel(CASES.pill.label));
    check('the grill pill narrows the Board to its card', await boxIs(CASES.pill.query) && await shows(SELECTORS.board, sorted(...CASES.pill.cards)), await boxText());
    await clickOn('#isolate-switch');
    check('isolated, the Board shows the same card, and the switch is on', await switchIs(true) && await shows(SELECTORS.board, sorted(...CASES.pill.cards)));
    check('a card is given the grill tag through the board\'s API', (await patchCard(CASES.tagged, { tags: [CASES.pill.label] })) === 200);
    await ev(`(async()=>{await autoRefreshTick();})()`);
    check('the card appears on the Board after the next poll, and the box is as it was', await shows(SELECTORS.board, sorted(...CASES.pill.cards, CASES.tagged)) && (await boxText()) === CASES.pill.query, await nowShown(SELECTORS.board));
  },
};
