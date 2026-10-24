'use strict';
// The m key steps through the pills, on the plan board. Each press turns on the next pill
// alone, as a right-click on it would: the box holds its query alone, the Board leaves the
// cards the pill counts, and they are the selection. The order is the panel's: off, then
// blocked, review and waiting, then the board's own pills (next and assignee:@human), then
// one pill per tag, then off again. The next-up tag holds the query of the next pill, so it
// is the same step and the walk goes past it. Shift+m runs the same walk backwards, and
// starts from off at the last pill. The first two presses are made with the panel closed,
// where the chip names the pill that is on, in its accessible name and in its hover text, and
// says isolated, since a pill turns isolate on in every view but the Graph (where the chip counts
// the one pill); the rest are made with the panel open, where exactly one button is
// pressed (the next pill's two buttons, which hold one query, together) and the pill is
// shown even when it sits behind the "+2 more" button, which then reads "fewer". After the
// last pill m turns every pill off and brings every card back, and the next m starts over.
// The key does nothing with focus in the search box (it types an m), with Ctrl or Alt
// held, with a card menu, the preferences sheet or a dialog up. In the Map, the Gantt, the
// Calendar and the Graph the key writes the same query and the chip counts it.
//
// The plan board's live cards are 1 to 18 and 22 to 29, with the pills its config gives;
// the board-pills scenario holds the counts, and this one reuses them. CASES holds the
// walk, and skills/web/test/browser-pill-step-scenario.test.js holds it to the pill list's
// own step (pillStep in web/pills.js) over the board's own config and cards. Each step
// waits on the page, never on a fixed sleep; a "nothing happened" check waits two
// animation frames. Keys go through the runner's key helper, a real key press.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectedIds.

const { CASES: BOARD_PILLS } = require('./board-pills');

const BUILT_INS = BOARD_PILLS.builtIns;
// The tag pill that holds the next pill's query: the walk makes one stop for the two.
const SAME_QUERY = 'next-up';
const WALK = [...BUILT_INS, ...BOARD_PILLS.own, ...[...BOARD_PILLS.shownTags, ...BOARD_PILLS.restTags].filter((tag) => tag !== SAME_QUERY)];
const queryOf = (label) => (BUILT_INS.includes(label) ? `${label}:` : BOARD_PILLS.queries[label]);

const CASES = {
  walk: WALK,
  queries: Object.fromEntries(WALK.map((label) => [label, queryOf(label)])),
  counts: BOARD_PILLS.counts,
  // The pill buttons that are on at a step: the next pill and the next-up tag hold one query.
  on: Object.fromEntries(WALK.map((label) => [label, label === 'next' ? ['next', SAME_QUERY] : [label]])),
  behindButton: BOARD_PILLS.restTags,
  closedSteps: 2,
  views: ['map', 'gantt', 'calendar', 'graph'],
  card: 5,
};

module.exports = {
  name: 'pill-step',
  board: 'plan',
  timeoutMs: 120000,
  CASES,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, rightClick, check } = page;
    const idsExpr = (expr) => `JSON.stringify(${expr})`;
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const SHOWN = `[...new Set([...document.querySelectorAll('#board .card-el')].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b)`;
    const shown = () => ev(SHOWN);
    const PANEL = `document.getElementById('search-panel')`;
    const panelOpen = `!${PANEL}.classList.contains('hidden')&&${PANEL}.getBoundingClientRect().height>0`;
    const panelShut = `${PANEL}.classList.contains('hidden')`;
    const MENU_UP = `!document.getElementById('context-menu').classList.contains('hidden')`;
    const SHEET_OPEN = `!document.getElementById('prefs-sheet').classList.contains('hidden')`;
    const SHEET_SHUT = `document.getElementById('prefs-sheet').classList.contains('hidden')`;
    const DIALOG_OPEN = `!document.getElementById('detail-modal').classList.contains('hidden')`;
    const DIALOG_SHUT = `document.getElementById('detail-modal').classList.contains('hidden')`;
    const PRESSED = `[...document.querySelectorAll('#search-pills .query-pill')].filter((b)=>b.getAttribute('aria-pressed')==='true').map((b)=>b.querySelector('.query-pill-label').textContent)`;
    const pressedAre = (labels) => waitFor(`${idsExpr(PRESSED)}===${JSON.stringify(JSON.stringify(labels))}`);
    const pressed = () => ev(PRESSED);
    const chip = () => ev(`(()=>{const c=document.getElementById('search-chip');return {hidden:c.classList.contains('hidden')||c.getBoundingClientRect().width===0,text:c.textContent,name:c.getAttribute('aria-label')||'',title:c.title}})()`);
    // Where the pill isolates the chip reads isolated and counts isolate beside the pill in its name; in the Graph it counts the pill alone.
    const chipShows = async (label, isolated = true) => {
      const c = await chip();
      const name = isolated ? `2 on: ${label}, isolated` : `1 on: ${label}`;
      return !c.hidden && c.text === (isolated ? 'isolated' : '1') && c.name === name && c.title === name;
    };
    const chipHidden = async () => (await chip()).hidden;
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const MORE_TEXT = `(()=>{const m=document.querySelector('#search-pills .query-pill-more');return m?m.textContent:null})()`;
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
    const boardReady = `document.querySelectorAll('#board .card-el').length>20`;
    const viewReady = (view) => `!document.getElementById('${view}-view').classList.contains('hidden')`;
    const m = () => key('m');
    const shiftM = () => key('M', { shift: true });
    // The panel opens when the box is focused, and stays open when focus leaves it, so the key is pressed with focus on nothing.
    const openPanelAndLeave = async () => {
      await ev(`document.getElementById('search-input').focus()`);
      await waitFor(panelOpen);
      await ev(`document.activeElement.blur()`);
    };

    // One step of the walk landed on `label`: the box holds its query alone, the Board leaves the cards the pill counts and they
    // are the selection, and what shows which pill is on agrees (the chip with the panel closed, the buttons with it open).
    const landed = async (name, label, panelIsOpen) => {
      const count = CASES.counts[label];
      const wrote = await boxIs(CASES.queries[label]);
      const left = await waitFor(`${SHOWN}.length===${count}&&selectedIds.size===${count}`);
      const shows = panelIsOpen
        ? await pressedAre(CASES.on[label]) && await ev(`${PANEL}.getBoundingClientRect().height>0`) && await chipHidden()
        : await chipShows(label);
      const behind = !panelIsOpen || !CASES.behindButton.includes(label) || (await ev(MORE_TEXT)) === 'fewer';
      check(name, wrote && left && shows && behind, { box: await boxText(), shown: (await shown()).length, pressed: await pressed(), chip: await chip(), more: await ev(MORE_TEXT) });
    };
    const allOff = async (name, liveCount, panelIsOpen) => {
      const wrote = await boxIs('');
      const back = await waitFor(`${SHOWN}.length===${liveCount}&&selectedIds.size===0`);
      const shows = panelIsOpen ? await pressedAre([]) : true;
      check(name, wrote && back && shows && await chipHidden(), { box: await boxText(), shown: (await shown()).length, pressed: await pressed(), chip: await chip() });
    };

    // --- the walk forward, off to off ----------------------------------------------------------------------
    check('the Board draws the plan board', await goto('/', boardReady));
    const liveCount = (await shown()).length;
    await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    check('the panel starts closed, the box is empty and no chip shows', await ev(panelShut) && (await boxText()) === '' && await chipHidden());
    for (const [at, label] of CASES.walk.entries()) {
      if (at === CASES.closedSteps) await openPanelAndLeave();
      await m();
      await landed(`m turns on the ${label} pill alone`, label, at >= CASES.closedSteps);
    }
    await m();
    await allOff('after the last pill, m turns every pill off and brings every card back', liveCount, true);
    await m();
    await landed('the next m starts over at the first pill', CASES.walk[0], true);

    // --- and backwards -----------------------------------------------------------------------------------------
    await shiftM();
    await allOff('Shift+m before the first pill turns every pill off', liveCount, true);
    for (const label of [...CASES.walk].reverse()) {
      await shiftM();
      await landed(`Shift+m turns on the ${label} pill alone`, label, true);
    }
    await shiftM();
    await allOff('Shift+m before the first pill turns every pill off, and the walk is where it began', liveCount, true);

    // --- where it does nothing ---------------------------------------------------------------------------------------
    await ev(`document.getElementById('search-input').focus()`);
    await key('m');
    check('m typed in the search box is a letter and no pill turns on', await boxIs('m') && await pressedAre([]), await boxText());
    await clearBox();
    await ev(`document.activeElement.blur()`);
    await key('m', { ctrl: true });
    await key('m', { alt: true });
    await frames();
    check('m with Ctrl or Alt held does nothing', (await boxText()) === '' && await pressedAre([]));
    await rightClick('#board .card-el');
    check('a right-click on a card opens its menu', await waitFor(MENU_UP));
    await key('m');
    await frames();
    check('with a card menu up, m does nothing', (await boxText()) === '' && await ev(MENU_UP) && await pressedAre([]));
    await key('Escape');
    check('Esc closes the card menu', await waitFor(`!(${MENU_UP})`));
    const prefs = await centre('#prefs-btn');
    if (!prefs) throw new Error('nothing matches #prefs-btn');
    await click(prefs.x, prefs.y);
    await waitFor(SHEET_OPEN);
    await key('m');
    await frames();
    check('with the preferences sheet up, m does nothing', (await boxText()) === '' && await ev(SHEET_OPEN));
    await key('Escape');
    check('Esc closes the preferences sheet', await waitFor(SHEET_SHUT));
    check('a card opens in its dialog from its address', await goto(`/?card=${CASES.card}`, DIALOG_OPEN));
    await ev(`document.getElementById('detail-close').focus()`);
    await key('m');
    await frames();
    check('with a dialog up, m does nothing', (await boxText()) === '' && await ev(DIALOG_OPEN) && await chipHidden());
    await key('Escape');
    check('Esc closes the dialog', await waitFor(DIALOG_SHUT));

    // --- the other views ------------------------------------------------------------------------------------------------
    for (const view of CASES.views) {
      check(`the ${view} draws the plan board`, await goto(`/?view=${view}`, viewReady(view)));
      await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
      await m();
      check(`${view}: m writes the first pill's query and the chip counts it`, await boxIs(CASES.queries[CASES.walk[0]]) && await chipShows(CASES.walk[0], view !== 'graph'), { box: await boxText(), chip: await chip() });
      await m();
      check(`${view}: m again writes the next pill's query alone`, await boxIs(CASES.queries[CASES.walk[1]]) && await chipShows(CASES.walk[1], view !== 'graph'), { box: await boxText(), chip: await chip() });
      if (view === 'graph') check('the Graph dims what the pill leaves out', await waitFor(`document.querySelector('.graph-canvas').classList.contains('graph-dim')`));
      await shiftM();
      await shiftM();
      check(`${view}: Shift+m back past the first pill turns every pill off and the chip goes`, await boxIs('') && await chipHidden(), { box: await boxText(), chip: await chip() });
    }
  },
};
