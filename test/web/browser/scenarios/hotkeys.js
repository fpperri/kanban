'use strict';
// The preferences sheet's Hotkeys section and the ? key, on the plan board. With nothing up and
// nobody typing, ? opens the sheet at its Hotkeys section, which is on screen inside the sheet,
// and the list holds a row for each key the page answers: the key, what it does, and for n, the
// slice keys, m, i and p the state it is in (names, slice, pill, isolate and panel on focus), each
// at its default to start. ? does nothing with the sheet already up, with focus in the search box
// (where it is typed), with a dialog, a card menu or the notifications panel up, and the browser's
// own response to the key is stopped only where the page acted. Esc closes the sheet and hands
// focus back to the gear. The state is the page's: p turns the panel's switch off, [ cuts the run
// of slices, m turns the first pill on and i turns isolate on (the Board is set to light what a pill
// matches, since a Board that isolates by itself would have m turn isolate on), and the next ? shows each; n in
// the Graph steps the names and the setting survives a reload. While the sheet is up, a click on
// its panel-on-focus checkbox changes that row at once. The list sits inside the sheet without
// widening it, one key element for each key label.
//
// The rows and their states the sheet should draw are read from hotkeys.js; CASES holds the states the
// keys leave behind, and test/web/browser-hotkeys-scenario.test.js holds those to hotkeys.js, so a
// wrong expectation fails in the unit suite and not only in a browser. Each step waits on the
// page, never on a fixed sleep; a "nothing happened" check waits two animation frames. Keys go
// through the runner's key helper, a real key press (? is Shift with the slash key, as a US
// keyboard types it), and each key is also logged as the window saw it, after the page's own
// handlers, so "does nothing" means the page read the key and let it be.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// graphLoadOptions.

const { HOTKEYS, hotkeyRows } = require('../../../../plugin/skills/web/web/hotkeys');

// What each key that has a state reads before anything is changed comes from the list in hotkeys.js, so a
// new key is checked without an edit here; hotkeys-sheet.test.js and hotkeys-docs.test.js pin the texts.
const DEFAULTS = Object.fromEntries(hotkeyRows({}).filter((r) => r.state).map((r) => [r.id, r.state]));

const CASES = { defaults: DEFAULTS, afterKeys: { panel: 'panel on focus: off', pill: 'pill: blocked', isolate: 'isolate: on' }, names: 'names: all' };

const SHEET_UP = `!document.getElementById('prefs-sheet').classList.contains('hidden')`;
const SHEET_SHUT = `document.getElementById('prefs-sheet').classList.contains('hidden')`;
const SHEET_SETTLED = `document.querySelector('.prefs-sheet').getAnimations().length===0`;
const GEAR_FOCUSED = `document.activeElement===document.getElementById('prefs-btn')`;
const GEAR_EXPANDED = `document.getElementById('prefs-btn').getAttribute('aria-expanded')`;
const MENU_UP = `!document.getElementById('context-menu').classList.contains('hidden')`;
const MENU_SHUT = `document.getElementById('context-menu').classList.contains('hidden')`;
const DIALOG_UP = `!document.getElementById('detail-modal').classList.contains('hidden')`;
const DIALOG_SHUT = `document.getElementById('detail-modal').classList.contains('hidden')`;
const NOTIFICATIONS_UP = `!document.getElementById('notif-modal').classList.contains('hidden')`;
const NOTIFICATIONS_SHUT = `document.getElementById('notif-modal').classList.contains('hidden')`;
const BOARD_READY = `document.querySelectorAll('#board .card-el').length>20`;
const BOX = `document.getElementById('search-input')`;

const ROWS = `[...document.querySelectorAll('#hotkeys-list > li.hotkey-row')]`;
const ROW_IDS = `${ROWS}.map((r)=>r.dataset.hotkey)`;
const WHATS = `${ROWS}.map((r)=>{const w=r.querySelector('.hotkey-what');return w?w.textContent.trim():''})`;
const STATES = `(()=>{const o={};for(const r of ${ROWS}){const s=r.querySelector('.hotkey-state');if(s)o[r.dataset.hotkey]=s.textContent}return o})()`;
const STATE_OF = (id) => `(()=>{const s=document.querySelector('#hotkeys-list .hotkey-row[data-hotkey="${id}"] .hotkey-state');return s?s.textContent:null})()`;
// Where the Hotkeys heading is in the sheet: drawn, inside the sheet's box, on the page the sheet opened on.
const HEADING_IN_VIEW = `(()=>{const sheet=document.querySelector('.prefs-sheet');const h=document.getElementById('prefs-hotkeys-title').getBoundingClientRect();const s=sheet.getBoundingClientRect();`
  + `const page=document.querySelector('.prefs-page[data-page="browser:hotkeys"]');return !!page&&!page.hidden&&h.height>0&&h.top>=s.top-1&&h.bottom<=s.bottom})()`;
const NOT_WIDER = `(()=>{const sheet=document.querySelector('.prefs-sheet');return sheet.scrollWidth<=sheet.clientWidth})()`;
const KEYS_DRAWN = `${ROWS}.every((r)=>r.querySelectorAll('.hotkey-key').length>0&&[...r.querySelectorAll('.hotkey-key')].every((k)=>k.tagName.toLowerCase()==='kbd'&&k.getBoundingClientRect().width>0))`;
const LAST_KEY = `(()=>{const l=window.__keyLog||[];return l.length?l[l.length-1]:null})()`;
const SLICE_TERM = `(()=>{const m=${BOX}.value.match(/(?:^|\\s)slice:(\\S+)/);return m?m[1]:null})()`;

module.exports = {
  name: 'hotkeys',
  board: 'plan',
  timeoutMs: 100000,
  CASES,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, check } = page;

    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const questionMark = () => key('?', { shift: true });
    const lastKey = () => ev(LAST_KEY);
    const states = () => ev(STATES);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    // Loads a page cold and waits on what it shows; the stale flag keeps the page being left from answering for the new one.
    const goto = async (target, ready) => {
      await ev(`window.__stale=true`);
      await open(target);
      await waitFor(`window.__stale!==true`, 10000);
      const ok = await waitFor(ready, 10000);
      await ev(`(()=>{window.__keyLog=[];window.addEventListener('keydown',(e)=>{window.__keyLog.push({key:e.key,prevented:e.defaultPrevented})});document.activeElement&&document.activeElement.blur&&document.activeElement.blur()})()`);
      return ok;
    };
    const openSheetByKey = async () => {
      await questionMark();
      if (!(await waitFor(SHEET_UP, 2500))) return false;
      return waitFor(SHEET_SETTLED, 2500);
    };
    const closeWithEscape = async () => {
      await key('Escape');
      return waitFor(SHEET_SHUT, 2500);
    };
    // ? pressed where it should do nothing: the page read it, let it be, and left the sheet shut.
    const questionMarkIgnored = async () => {
      await questionMark();
      await frames();
      const logged = await lastKey();
      return !!logged && logged.key === '?' && logged.prevented === false && await ev(SHEET_SHUT);
    };

    // --- ? opens the sheet on its Hotkeys page --------------------------------------------------------------
    check('the plan board is drawn', await goto('/', BOARD_READY));
    await questionMark();
    check('with nothing open and nobody typing, ? opens the preferences sheet', await waitFor(SHEET_UP, 2500));
    await waitFor(SHEET_SETTLED, 2500);
    const opened = await lastKey();
    check('the page stopped the browser\'s own response to ?, and the gear says the sheet is open', !!opened && opened.key === '?' && opened.prevented === true && await ev(GEAR_EXPANDED) === 'true', opened);
    check('the sheet shows its Hotkeys page, with the heading inside the sheet', await ev(HEADING_IN_VIEW));

    // --- what the list holds -------------------------------------------------------------------------------
    check('the sheet draws one row for each entry of the list, in its order', same(await ev(ROW_IDS), HOTKEYS.map((h) => h.id)), await ev(ROW_IDS));
    check('every row is a list item of the Hotkeys list, with a key element drawn for each key label', await ev(KEYS_DRAWN) && await ev(`document.querySelectorAll('#hotkeys-list > li').length===${ROWS}.length`));
    const whats = await ev(WHATS);
    check('every row says what its key does', whats.length > 0 && whats.every((w) => w.length > 8), whats);
    check('the list does not widen the sheet', await ev(NOT_WIDER));
    check('before anything is changed each key that has a state shows its default', same(await states(), CASES.defaults), await states());

    // --- ? with the sheet up does nothing; Esc closes it -------------------------------------------------------
    await questionMark();
    await frames();
    const again = await lastKey();
    check('with the sheet up, ? does nothing', !!again && again.key === '?' && again.prevented === false && await ev(SHEET_UP), again);
    check('Escape closes the sheet and hands focus back to the gear', await closeWithEscape() && await waitFor(GEAR_FOCUSED, 2500));

    // --- ? is typed in the search box, and does nothing under a dialog, a card menu or the notifications panel ----
    await key('/');
    check('/ puts focus in the search box', await waitFor(`document.activeElement===${BOX}`, 2500));
    await questionMark();
    await frames();
    check('with focus in the search box, ? is typed there and the sheet stays shut', await ev(`${BOX}.value==='?'`) && await ev(SHEET_SHUT));
    await ev(`document.getElementById('search-clear-btn').click()`);
    check('the box is cleared', await waitFor(`${BOX}.value===''`, 2500));
    await ev(`document.activeElement.blur()`);

    check('the page opens on a card', await goto('/?card=5', DIALOG_UP));
    check('with a dialog up, ? does nothing', await questionMarkIgnored() && await ev(DIALOG_UP));
    await key('Escape');
    check('Escape closes the dialog', await waitFor(DIALOG_SHUT, 2500));

    check('the plan board is drawn again', await goto('/', BOARD_READY));
    await page.rightClick('#board .card-el');
    check('a right-click on a card opens its menu', await waitFor(MENU_UP, 2500));
    await ev(`document.activeElement.blur()`);
    check('with a card menu up, ? does nothing', await questionMarkIgnored() && await ev(MENU_UP));
    await key('Escape');
    check('Escape closes the card menu', await waitFor(MENU_SHUT, 2500));

    const bell = await centre('#notif-btn');
    if (!bell) throw new Error('nothing matches #notif-btn');
    await click(bell.x, bell.y);
    check('the notifications panel opens', await waitFor(NOTIFICATIONS_UP, 2500));
    await ev(`document.activeElement.blur()`);
    check('with the notifications panel up, ? does nothing', await questionMarkIgnored() && await ev(NOTIFICATIONS_UP));
    await key('Escape');
    check('Escape closes the notifications panel', await waitFor(NOTIFICATIONS_SHUT, 2500));

    // --- the state is the page's: the keys change it, the next ? shows it ----------------------------------------
    await ev(`localStorage.setItem('kanban.plan.typing.isolates', JSON.stringify({board:false}))`);
    check('the plan board is drawn for the Graph', await goto('/', BOARD_READY));
    await ev(`document.getElementById('graph-toggle-btn').click()`);
    check('the Graph is drawn', await waitFor(`!document.getElementById('graph-view').classList.contains('hidden')&&document.querySelectorAll('#graph-view .graph-node').length>0`, 10000));
    await key('l');
    check('l steps the names in the Graph', await waitFor(`graphLoadOptions().names==='all'`, 2500));
    check('the sheet shows the names the Graph now draws', await openSheetByKey() && await ev(STATE_OF('names')) === CASES.names, await ev(STATE_OF('names')));
    await closeWithEscape();
    check('the plan board is drawn after a reload', await goto('/', `document.querySelectorAll('#graph-view .graph-node').length>0`));
    check('after a reload the sheet still shows the names the board kept', await openSheetByKey() && await ev(STATE_OF('names')) === CASES.names, await ev(STATE_OF('names')));
    await closeWithEscape();

    await ev(`document.getElementById('graph-toggle-btn').click()`);
    check('the Board is drawn again', await waitFor(`!document.getElementById('board').classList.contains('hidden')&&document.getElementById('graph-view').classList.contains('hidden')`, 10000));
    await key('p');
    check('p turns the panel\'s switch off', await waitFor(`document.getElementById('search-panel-toggle').getAttribute('aria-pressed')==='false'`, 2500));
    await key('[');
    check('[ cuts the run of slices', await waitFor(`${SLICE_TERM}!==null`, 2500));
    const term = await ev(SLICE_TERM);
    await key('m');
    check('m turns the first pill on', await waitFor(`${BOX}.value.includes('blocked:')`, 2500));
    check('the sheet shows the panel switched off, the pill on, the cut and isolate off', await openSheetByKey()
      && await ev(STATE_OF('panel')) === CASES.afterKeys.panel
      && await ev(STATE_OF('pill')) === CASES.afterKeys.pill
      && await ev(STATE_OF('slice')) === `slice: ${term}`
      && await ev(STATE_OF('isolate')) === DEFAULTS.isolate, await states());
    await closeWithEscape();
    await key('i');
    check('i turns isolate on', await waitFor(`document.getElementById('isolate-switch').getAttribute('aria-checked')==='true'`, 2500));
    check('the sheet shows isolate on', await openSheetByKey() && await ev(STATE_OF('isolate')) === CASES.afterKeys.isolate, await states());

    // --- a change made in the sheet shows in the list at once -------------------------------------------------------
    // ? opened the Hotkeys page, so the Preferences page is brought up to click the checkbox on it; the list keeps drawing behind.
    const toPrefs = await centre('.prefs-menu-item[data-page="browser:prefs"]');
    if (!toPrefs) throw new Error('nothing matches the Preferences menu item');
    await click(toPrefs.x, toPrefs.y);
    await waitFor(`!document.querySelector('.prefs-page[data-page="browser:prefs"]').hidden`, 2500);
    await ev(`document.getElementById('prefs-panel-on-focus').scrollIntoView({block:'center'})`);
    const box = await centre('#prefs-panel-on-focus');
    if (!box) throw new Error('nothing matches #prefs-panel-on-focus');
    await click(box.x, box.y);
    check('choosing that the panel opens on focus changes its row at once', await waitFor(`${STATE_OF('panel')}===${JSON.stringify(DEFAULTS.panel)}`, 2500), await states());
    await click(box.x, box.y);
    check('and choosing it again changes the row back', await waitFor(`${STATE_OF('panel')}===${JSON.stringify(CASES.afterKeys.panel)}`, 2500), await states());
    check('Escape closes the sheet', await closeWithEscape());
    await ev(`localStorage.removeItem('kanban.plan.prefs')`);
    await ev(`localStorage.removeItem('kanban.plan.typing.isolates')`);
  },
};
