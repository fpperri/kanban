'use strict';
// The gear in the header and the preferences sheet it opens, on the fixture
// board: the sheet opens and closes (Esc, a click outside, the close button,
// each handing focus back to the gear), it traps no Tab, it holds the poll and
// the single-key shortcuts still, and a click inside it leaves a selection be.
// Then each setting does its work in the real page: a Board, Map or Calendar set
// to selects, the roll-up bar mode shared with a click on a bar, and whether
// archived leaves count as done in the Board tile, the Map's rich row and the
// card detail. Choices are kept in the browser and never reach the board's files.
// Cards 1 and 2 are parents: card 2 has leaves 7 and 8 and the archived, done
// leaf 19, so with archived leaves counted it totals 3 and card 1 totals 7.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// selectedIds, autoRefreshTick.

const fs = require('fs');
const path = require('path');

module.exports = {
  name: 'preferences',
  board: 'fixture',
  timeoutMs: 100000,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, check } = page;

    const sheetOpen = `!document.getElementById('prefs-sheet').classList.contains('hidden')`;
    const sheetShut = `document.getElementById('prefs-sheet').classList.contains('hidden')`;
    const gearFocused = `document.activeElement===document.getElementById('prefs-btn')`;
    const hasCard = (id) => `/[?&]card=${id}(&|$)/.test(location.search)`;
    const noCard = '!/card=\\d+/.test(location.search)';
    const opt = (pref, value, view) => `#prefs-sheet .prefs-opt[data-pref="${pref}"]${view ? `[data-view="${view}"]` : ''}[data-value="${value}"]`;
    const pressed = (sel) => `document.querySelector(${JSON.stringify(sel)}).getAttribute('aria-pressed')==='true'`;
    const archivedBox = `document.getElementById('prefs-archived-done')`;
    // Where Tab leaves the sheet: the last of its controls in the page's own order, so a row added at the end of the sheet moves it.
    const lastControl = `(()=>{const c=[...document.querySelectorAll('#prefs-sheet button:not([disabled]), #prefs-sheet input:not([disabled]), #prefs-sheet select:not([disabled]), #prefs-sheet textarea:not([disabled])')];return c[c.length-1]})()`;

    const clickOn = async (sel) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const doubleClick = async (x, y) => {
      await click(x, y, { clickCount: 1 });
      await click(x, y, { clickCount: 2 });
    };
    // Loads a page cold and waits on what it shows; the stale flag keeps the page being left from answering for the new one.
    const goto = async (target, ready) => {
      await ev(`window.__stale=true`);
      await open(target);
      await waitFor(`window.__stale!==true`, 10000);
      return waitFor(ready, 10000);
    };
    // The sheet slides in; its controls hold still, and a click lands on them, only once the animation has ended.
    const openSheet = async () => {
      await clickOn('#prefs-btn');
      if (!(await waitFor(sheetOpen, 2500))) return false;
      return waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 2500);
    };
    const closeWithEscape = async () => {
      await key('Escape');
      return waitFor(sheetShut, 2500);
    };
    const choose = async (sel) => {
      await clickOn(sel);
      return waitFor(pressed(sel), 2500);
    };
    const setAndClose = async (sel) => {
      await openSheet();
      const chosen = await choose(sel);
      await closeWithEscape();
      return chosen;
    };

    // A point on the card that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (sel) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    const pointOn = async (sel) => {
      const p = await cardPoint(sel);
      if (!p) throw new Error(`no clickable point on ${sel}`);
      return p;
    };
    const tile = (id) => `#board .card-el[data-id="${id}"]`;
    const showBoard = () => goto('/', `!!document.querySelector(${JSON.stringify(tile(3))})&&!!document.querySelector(${JSON.stringify(`${tile(2)} .rollup`)})`);
    const barSum = (sel) => ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)});if(!r)return null;return [...r.querySelectorAll('.rollup-seg[data-n]')].reduce((n,s)=>n+Number(s.dataset.n),0)})()`);
    const showDetail = (id) => goto(`/?card=${id}`, `!document.getElementById('detail-rollup').classList.contains('hidden')`);
    const scope = () => ev(`(document.querySelector('#detail-rollup .rollup-scope')||{textContent:''}).textContent`);
    const detailTotal = () => ev(`(document.querySelector('#detail-rollup .rollup-total')||{textContent:''}).textContent`);

    // The board's own files as they are, read from the folder the server reports; compared again after the choices below.
    const snapshot = (dir) => {
      const out = {};
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else out[path.relative(dir, p)] = `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p, 'utf8')}`;
        }
      };
      walk(dir);
      return out;
    };
    const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => a[f] !== b[f]);

    // --- the sheet opens and closes -------------------------------------------------------
    check('the board draws card 3', await showBoard());
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const filesBefore = snapshot(boardDir);

    check('the gear opens the sheet', await openSheet());
    check('the gear says it is expanded', await ev(`document.getElementById('prefs-btn').getAttribute('aria-expanded')==='true'`));
    check('Esc closes the sheet and focus returns to the gear', await closeWithEscape() && await ev(gearFocused));

    await openSheet();
    const outside = await ev(`(()=>{const e=document.elementFromPoint(60,500);return e&&e.id==='prefs-sheet'?{x:60,y:500}:null})()`);
    check('the backdrop is the element left of the sheet', !!outside, outside);
    await click(outside.x, outside.y);
    check('a click outside closes the sheet and focus returns to the gear', await waitFor(sheetShut, 2500) && await ev(gearFocused));

    await openSheet();
    await clickOn('#prefs-close');
    check('the close button closes the sheet and focus returns to the gear', await waitFor(sheetShut, 2500) && await ev(gearFocused));

    // --- no Tab trap ----------------------------------------------------------------------
    await openSheet();
    await ev(`${lastControl}.focus()`);
    await key('Tab');
    check('Tab from the last control of the sheet moves focus out of the sheet', await waitFor(`!document.getElementById('prefs-sheet').contains(document.activeElement)`, 2500), await ev(`document.activeElement&&(document.activeElement.id||document.activeElement.tagName)`));
    await closeWithEscape();

    // --- the poll and the single-key shortcuts stand still under the sheet ------------------------
    check('the page counts as visible, so a poll is never skipped for being hidden', await ev(`document.visibilityState==='visible'`), await ev(`document.visibilityState`));
    await ev(`document.querySelector(${JSON.stringify(tile(3))}).__probe=1`);
    await openSheet();
    await ev(`(async()=>{await autoRefreshTick();await autoRefreshTick();})()`);
    check('while the sheet is open, a poll does not rebuild under it', await ev(`document.querySelector(${JSON.stringify(tile(3))}).__probe===1`));
    await closeWithEscape();
    await ev(`(async()=>{await autoRefreshTick();})()`);
    check('with the sheet closed the same poll rebuilds the board', await waitFor(`document.querySelector(${JSON.stringify(tile(3))}).__probe!==1`, 2500));

    const pressKey = async (name, code, vk, modifiers = 0) => {
      const k = { key: name, code, windowsVirtualKeyCode: vk, modifiers };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    };
    const lastKey = () => ev(`(()=>{const l=window.__keyLog||[];return l.length?l[l.length-1]:null})()`);
    const searchFocused = () => ev(`document.activeElement===document.getElementById('search-input')`);
    await ev(`(()=>{window.__keyLog=[];window.addEventListener('keydown',(e)=>{window.__keyLog.push({key:e.key,ctrl:e.ctrlKey,prevented:e.defaultPrevented})})})()`);
    await openSheet();
    await pressKey('/', 'Slash', 191);
    const slash = await lastKey();
    check('while the sheet is open, / does nothing', slash.key === '/' && slash.prevented === false && !(await searchFocused()), slash);
    await pressKey('f', 'KeyF', 70, 2);
    const chord = await lastKey();
    check('while the sheet is open, Ctrl+F does nothing', chord.ctrl === true && chord.prevented === false && !(await searchFocused()) && await ev(`document.getElementById('search-input').value===''`), chord);
    await closeWithEscape();

    // --- a click inside the sheet leaves a selection as it was ------------------------------------
    await showBoard();
    const three = await pointOn(tile(3));
    await click(three.x, three.y, { modifiers: 2 });
    check('a Ctrl+click selects card 3', await waitFor(`selectedIds.size===1&&selectedIds.has('3')`));
    await openSheet();
    check('opening the sheet from the gear leaves the selection', await ev(`selectedIds.size===1&&selectedIds.has('3')`));
    await clickOn('#prefs-title');
    await clickOn('#prefs-sheet .prefs-hint');
    await clickOn(opt('click', 'opens', 'board'));
    check('a click inside the sheet leaves the card selection as it was', await ev(`selectedIds.size===1&&selectedIds.has('3')`), await ev('[...selectedIds]'));
    await closeWithEscape();

    // --- the Board set to selects ---------------------------------------------------------------
    check('the Board can be set to selects in the sheet', await setAndClose(opt('click', 'selects', 'board')));
    await showBoard();
    const plain = await pointOn(tile(3));
    await click(plain.x, plain.y);
    check('in a Board set to selects a plain click selects a card without opening it', await waitFor(`selectedIds.size===1&&selectedIds.has('3')`) && await ev(noCard), await ev('location.search'));
    const again = await pointOn(tile(3));
    await doubleClick(again.x, again.y);
    check('and a double click opens it', await waitFor(hasCard(3), 3000), await ev('location.search'));
    check('and opening it leaves the card selected', await ev(`selectedIds.size===1&&selectedIds.has('3')`), await ev('[...selectedIds]'));
    await key('Escape');
    await waitFor(noCard, 2500);

    await showBoard();
    check('a reload keeps the choice: the sheet shows the Board at selects', await openSheet() && await ev(pressed(opt('click', 'selects', 'board'))));
    await closeWithEscape();
    const afterReload = await pointOn(tile(3));
    await click(afterReload.x, afterReload.y);
    check('and a plain click still selects without opening', await waitFor(`selectedIds.size===1&&selectedIds.has('3')`) && await ev(noCard));
    check('the choice is kept in the browser, under the board\'s own entry', await ev(`JSON.parse(localStorage.getItem('kanban.fixture.prefs')).click.board==='selects'`));
    const filesAfter = snapshot(boardDir);
    check('no file in the board\'s directory changes', changed(filesBefore, filesAfter).length === 0, changed(filesBefore, filesAfter));

    // --- the Map set to selects ------------------------------------------------------------------
    await openSheet();
    check('the Map can be set to selects in the sheet', await choose(opt('click', 'selects', 'map')));
    await closeWithEscape();
    const mapNode = '#map-view .card-el[data-id="3"]';
    check('the Map draws card 3', await goto('/?view=map', `!!document.querySelector(${JSON.stringify(mapNode)})`));
    await ev(`document.querySelector(${JSON.stringify(mapNode)}).focus()`);
    check('card 3 holds the focus', await ev(`document.activeElement===document.querySelector(${JSON.stringify(mapNode)})`));
    await key('Enter');
    check('in a Map set to selects, Enter on a focused card opens it', await waitFor(hasCard(3), 3000), await ev('location.search'));
    await key('Escape');
    await waitFor(noCard, 2500);

    // --- the Calendar set to selects ----------------------------------------------------------------
    const today = await ev(`(()=>{const d=new Date();const p=(n)=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())})()`);
    const dated = await ev(`fetch('/api/cards/3',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({start_date:${JSON.stringify(today)},end_date:${JSON.stringify(today)}})}).then((r)=>r.status)`);
    check('card 3 is dated today for the Calendar', dated === 200, dated);
    const cardCount = () => ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.active.length+d.archived.length)`);
    const cardsBefore = await cardCount();
    const chip = '#calendar-view .card-el[data-id="3"]';
    await goto('/?view=calendar', `!!document.querySelector(${JSON.stringify(chip)})`);
    await openSheet();
    check('the Calendar can be set to selects in the sheet', await choose(opt('click', 'selects', 'calendar')));
    await closeWithEscape();
    const chipPoint = await pointOn(chip);
    await doubleClick(chipPoint.x, chipPoint.y);
    check('in a Calendar set to selects, a double click on a card opens it', await waitFor(hasCard(3), 3000), await ev('location.search'));
    check('and creates no card: the new-card form stays shut and the board holds the same cards', await ev(`document.getElementById('modal').classList.contains('hidden')`) && (await cardCount()) === cardsBefore);
    await key('Escape');
    await waitFor(noCard, 2500);

    // --- the roll-up bar mode, shared with a click on a bar -----------------------------------------
    const sums = async () => ({ two: await barSum(`${tile(2)} .rollup`), one: await barSum(`${tile(1)} .rollup`) });
    await showBoard();
    const byDefault = await sums();
    check('by default the parent above the archived leaf counts that leaf as done', byDefault.two === 3 && byDefault.one === 7, byDefault);
    check('by default the bar is collapsed', await ev(`document.querySelectorAll('.rollup .rollup-bar:not(.thin)').length===0&&document.querySelectorAll('.rollup .rollup-bar.thin').length>0`));

    await openSheet();
    check('the sheet shows the bar collapsed and archived leaves counted', await ev(pressed(opt('bar', 'collapsed'))) && await ev(`${archivedBox}.checked===true`));
    await choose(opt('bar', 'open'));
    check('setting the bar to open in the sheet opens every roll-up bar', await waitFor(`document.querySelectorAll('.rollup .rollup-bar.thin').length===0&&document.querySelectorAll('.rollup .rollup-counts').length>0`));
    await choose(opt('bar', 'collapsed'));
    check('setting the bar to collapsed in the sheet collapses every roll-up bar', await waitFor(`document.querySelectorAll('.rollup .rollup-counts').length===0&&document.querySelectorAll('.rollup .rollup-bar.thin').length>0`));
    await closeWithEscape();
    await clickOn(`${tile(2)} .rollup`);
    check('a click on a bar opens every bar and does not open the card', await waitFor(`document.querySelectorAll('.rollup .rollup-counts').length>0`) && await ev(noCard));
    await openSheet();
    check('and flips the sheet\'s control back', await ev(pressed(opt('bar', 'open'))) && await ev(`!(${pressed(opt('bar', 'collapsed'))})`));
    await closeWithEscape();

    // --- archived leaves count as done, or are left out ----------------------------------------------------
    check('the card detail counts archived leaves, and its scope line says so', await showDetail(2) && (await scope()).includes('Archived leaves count as done.') && (await detailTotal()) === '3', await scope());
    const mapBar = '#map-view .card-el[data-id="2"] .rollup';
    check('the Map\'s rich row counts them too', await goto('/?view=map', `!!document.querySelector(${JSON.stringify(mapBar)})`) && (await barSum(mapBar)) === 3, await barSum(mapBar));

    await showBoard();
    await openSheet();
    await clickOn('#prefs-archived-done');
    check('turning the toggle off leaves the archived leaf out of the Board tile', await waitFor(`${archivedBox}.checked===false`) && await waitFor(`document.querySelector(${JSON.stringify(`${tile(2)} .rollup-seg[data-n]`)})!==null`) && (await sums()).two === 2 && (await sums()).one === 6, await sums());
    await closeWithEscape();
    check('and out of the Map\'s rich row', await goto('/?view=map', `!!document.querySelector(${JSON.stringify(mapBar)})`) && (await barSum(mapBar)) === 2, await barSum(mapBar));
    check('and out of the card detail, whose scope line says archived leaves are left out', await showDetail(2) && (await scope()).includes('Archived leaves are left out.') && (await detailTotal()) === '2', await scope());
    await key('Escape');
    await waitFor(noCard, 2500);
    check('a reload keeps the choice: the Board tile still leaves the leaf out and the sheet shows the toggle off', await showBoard() && (await sums()).two === 2 && await openSheet() && await ev(`${archivedBox}.checked===false`));
    await closeWithEscape();

    // --- a browser that still holds the old rollup.archived key ----------------------------------------------
    await ev(`(()=>{localStorage.removeItem('kanban.fixture.prefs');localStorage.setItem('kanban.fixture.rollup.archived','false')})()`);
    check('with rollup.archived saved as false, the Board tile counts the archived leaf as done', await showBoard() && (await sums()).two === 3 && (await sums()).one === 7, await sums());
    check('and the sheet shows the toggle on', await openSheet() && await ev(`${archivedBox}.checked===true`));
    await closeWithEscape();
  },
};
