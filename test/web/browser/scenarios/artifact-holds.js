'use strict';
// A page says what archive it holds. The fixture board has three archived cards. Three files are built from
// it: with no archive, with two of the three (query `#19 | #20`, archive on), and with all three. In the Gantt
// the Archive pill of the first reads "not in this page", is announced as disabled, and pressing it leaves the
// view's filter and its stored copy as they were; the second reads "2 of 3" and works; the third reads as the
// desk's pill does. On the Board, the Archive column says the same at desk width, and the Archive tab at 390 px
// wide, with the words visible in the text (not in a title) and inside the screen. Each step waits on what the
// page shows, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): setView, state, loadMapStatusFilter,
// loadGanttStatusFilter, loadBoard.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const NAME = `document.getElementById('project-name').textContent`;
const PILL = `document.querySelector('#search-statuses .status-pill[data-col=archive]')`;
const PILL_TEXT = `(()=>{const p=${PILL};return p?p.textContent.replace(/\\s+/g,' ').trim():''})()`;
const STORED = `JSON.stringify(Object.keys(localStorage).sort().map((k)=>[k,localStorage.getItem(k)]))`;
const HEADER_TEXT = `(()=>{const h=document.querySelector('#board .column[data-col=archive] .column-header');return h?h.textContent.replace(/\\s+/g,' ').trim():''})()`;
const COL = "#board .column[data-col=archive]";
const STRIP = (words, count) => `(()=>{const c=document.querySelector('${COL}');if(!c||!c.classList.contains('collapsed'))return false;const t=c.querySelector('.column-toggle');return c.title.includes(${JSON.stringify(words)})&&t.getAttribute('aria-label').includes(${JSON.stringify(words)})&&c.querySelector('.column-count').textContent===${JSON.stringify(count)}})()`;
const FITS = (sel, inScreen = true) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;const r=e.getBoundingClientRect();return (${inScreen}?r.left>=0&&r.right<=window.innerWidth:true)&&e.scrollWidth<=e.clientWidth+1})()`;

module.exports = {
  name: 'artifact-holds',
  board: 'fixture',
  timeoutMs: 120000,
  async run(page) {
    const { ev, waitFor, check, send } = page;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-holds-'));
    try {
      const dir = materialize('fixture', path.join(root, 'board-fixture', '.kanban'));
      const built = {};
      for (const [key, options] of [['none', {}], ['part', { archive: true, query: '#19 | #20' }], ['whole', { archive: true }]]) {
        const file = path.join(root, `${key}.html`);
        fs.writeFileSync(file, buildPage({ boardDir: dir, ...options }).html);
        built[key] = fileUrl(file);
      }
      const load = async (key) => {
        await ev(`window.askBeforeLeaving&&window.removeEventListener('beforeunload',window.askBeforeLeaving)`);
        await send('Page.navigate', { url: built[key] });
        return waitFor(`document.readyState==='complete'&&${NAME}==='fixture'&&document.querySelectorAll('#board .column .card-el').length>0`, 15000);
      };
      const wide = () => send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

      await wide();
      check('the page with no archive opens', await load('none'));
      await ev('localStorage.clear()');
      check('and holds no archived card', await ev(`state.archived.length===0`));
      await ev(`setView('gantt')`);
      check('the Gantt draws its Archive pill', await waitFor(`!!${PILL}`, 6000));
      check('it says it is not in this page, in its text', await waitFor(`/not in this page/.test(${PILL_TEXT})`, 6000), await ev(PILL_TEXT));
      check('it is announced as disabled and not as pressed', await ev(`${PILL}.getAttribute('aria-disabled')==='true'&&!${PILL}.hasAttribute('aria-pressed')&&!${PILL}.classList.contains('off')`));
      const before = await ev(`JSON.stringify(loadGanttStatusFilter())+${STORED}`);
      await ev(`${PILL}.click()`);
      await ev(`${PILL}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
      check('pressing it, or right-clicking it, changes neither the filter nor what is stored', (await ev(`JSON.stringify(loadGanttStatusFilter())+${STORED}`)) === before);
      check('the other status pills carry no note', await ev(`[...document.querySelectorAll('#search-statuses .status-pill:not([data-col=archive])')].every((p)=>!p.querySelector('.pill-note').textContent&&!p.hasAttribute('aria-disabled'))`));
      await ev(`setView('map')`);
      check('the Map draws its Archive pill, which says it is not in this page', await waitFor(`!!${PILL}&&/not in this page/.test(${PILL_TEXT})`, 6000), await ev(PILL_TEXT));
      const mapBefore = await ev(`JSON.stringify(loadMapStatusFilter())+${STORED}`);
      await ev(`${PILL}.click()`);
      await ev(`${PILL}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
      check('pressing it in the Map changes neither the filter nor what is stored', (await ev(`JSON.stringify(loadMapStatusFilter())+${STORED}`)) === mapBefore);
      await ev(`setView('board')`);
      check('the collapsed Archive strip says it is not in this page, not a bare 0', await waitFor(STRIP('not in this page', 'not in this page'), 6000), await ev(`document.querySelector('${COL}').title+'|'+document.querySelector('${COL} .column-count').textContent`));
      await ev(`document.querySelector('#board .column[data-col=archive] .column-toggle').getAttribute('aria-expanded')==='false'&&document.querySelector('#board .column[data-col=archive] .column-toggle').click()`);
      check('the Archive column says the same in its header', await waitFor(`/not in this page/.test(${HEADER_TEXT})`, 6000), await ev(HEADER_TEXT));
      check('and the header offers no sort of nothing', await ev(`!document.querySelector('#board .column[data-col=archive] .column-sort-field')`));
      check('the header words fit the column', await ev(FITS('#board .column[data-col=archive] .column-header', false)));

      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      const tab = `document.querySelector('#board-tabs .board-tab[data-col=archive]')`;
      check('on the phone the Archive tab says it too', await waitFor(`!!${tab}&&/not in this page/.test(${tab}.textContent)`, 6000), await ev(`(${tab}||{textContent:''}).textContent`));
      await ev(`${tab}.click()`);
      check('the Archive status shows its words in the column header on the phone', await waitFor(`/not in this page/.test(${HEADER_TEXT})`, 6000));
      check('and they sit inside the screen', await ev(FITS('#board .column[data-col=archive] .column-header')));
      await ev(`setView('gantt')`);
      check('on the phone the pill says it as well, inside the screen', await waitFor(`/not in this page/.test(${PILL_TEXT})`, 6000) && await ev(`${PILL}.getBoundingClientRect().right<=window.innerWidth`));

      await ev(`setView('board')`);
      await wide();
      check('the page with part of the archive opens', await load('part'));
      check('it holds two archived cards', await ev(`state.archived.length===2`));
      await ev(`setView('gantt')`);
      check('its Archive pill gives the count', await waitFor(`/2 of 3/.test(${PILL_TEXT})`, 6000), await ev(PILL_TEXT));
      check('and is a working pill', await ev(`!${PILL}.hasAttribute('aria-disabled')&&${PILL}.getAttribute('aria-pressed')==='false'`));
      await ev(`${PILL}.click()`);
      check('pressing it switches the archive on', await waitFor(`${PILL}.getAttribute('aria-pressed')==='true'`, 6000));
      await ev(`${PILL}.click()`);
      await ev(`setView('map')`);
      check('the Map pill gives the count and shows the archive to start', await waitFor(`!!${PILL}&&/2 of 3/.test(${PILL_TEXT})&&${PILL}.getAttribute('aria-pressed')==='true'`, 6000), await ev(PILL_TEXT));
      await ev(`${PILL}.click()`);
      check('pressing it in the Map switches the archive off', await waitFor(`${PILL}.getAttribute('aria-pressed')==='false'`, 6000));
      await ev(`${PILL}.click()`);
      await ev(`setView('board')`);
      await ev(`document.querySelector('${COL} .column-toggle').getAttribute('aria-expanded')==='true'&&document.querySelector('${COL} .column-toggle').click()`);
      check('the collapsed Archive strip gives the count', await waitFor(STRIP('2 of 3', '2 of 3'), 6000), await ev(`document.querySelector('${COL}').title+'|'+document.querySelector('${COL} .column-count').textContent`));
      await ev(`document.querySelector('#board .column[data-col=archive] .column-toggle').getAttribute('aria-expanded')==='false'&&document.querySelector('#board .column[data-col=archive] .column-toggle').click()`);
      check('the Archive column gives the count', await waitFor(`/2 of 3/.test(${HEADER_TEXT})`, 6000), await ev(HEADER_TEXT));
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      check('the phone tab gives it too', await waitFor(`/2 of 3/.test(document.querySelector('#board-tabs .board-tab[data-col=archive]').textContent)`, 6000));

      await wide();
      await ev('localStorage.clear()');
      check('the page with the whole archive opens', await load('whole'));
      check('it holds all three archived cards', await ev(`state.archived.length===3`));
      check('and the Archive column counts them as the desk does', await ev(`document.querySelector('#board .column[data-col=archive] .column-count').textContent==='3'`));
      await ev(`setView('gantt')`);
      check('its Archive pill carries no note and works', await waitFor(`!!${PILL}`, 6000) && await ev(`${PILL}.querySelector('.pill-note').textContent===''&&${PILL}.getAttribute('aria-pressed')==='false'&&!${PILL}.hasAttribute('aria-disabled')`));
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await ev(`setView('board')`);
      check('and its phone tab counts three', await waitFor(`(()=>{const t=document.querySelector('#board-tabs .board-tab[data-col=archive]');return !!t&&t.querySelector('.board-tab-count').textContent==='3'})()`, 6000));
      await wide();
      await ev('localStorage.clear()');
      check('the page with no archive opens once more', await load('none'));
      check('it holds no archived card and its Archive pill is not in this page', await ev(`state.archived.length===0`) && await ev(`setView('gantt'),true`) && await waitFor(`/not in this page/.test(${PILL_TEXT})`, 6000));
      const archived = await ev(`window.kanbanSourceInUse.request('POST','/api/cards/7/archive').then((r)=>r.status)`);
      check('archiving card 7 in the page is queued', archived < 300 && await ev('loadBoard().then(()=>true)') && await waitFor(`state.archived.length===1`, 6000), archived);
      check('the Gantt pill now counts it, of the total with it added', await waitFor(`/1 of 4/.test(${PILL_TEXT})`, 6000), await ev(PILL_TEXT));
      check('and is a working pill, announced as not pressed in the Gantt, which starts without the archive', await ev(`!${PILL}.hasAttribute('aria-disabled')&&${PILL}.getAttribute('aria-pressed')==='false'`));
      await ev(`${PILL}.click()`);
      check('pressing it switches the archive on', await waitFor(`${PILL}.getAttribute('aria-pressed')==='true'`, 6000));
      await ev(`setView('map')`);
      const NODE = `document.querySelector('.map-node:not(.ghost)[data-id="7"]')`;
      check('the Map draws the archived card while the pill is on', await waitFor(`!!${PILL}&&/1 of 4/.test(${PILL_TEXT})&&!!${NODE}`, 6000), await ev(PILL_TEXT));
      await ev(`${PILL}.click()`);
      check('pressing the Map pill switches the archive off', await waitFor(`${PILL}.getAttribute('aria-pressed')==='false'`, 6000));
      check('and the archived card is no longer drawn', await waitFor(`!${NODE}`, 6000));
      await ev(`setView('board')`);
      await ev(`document.querySelector('${COL} .column-toggle').getAttribute('aria-expanded')==='true'&&document.querySelector('${COL} .column-toggle').click()`);
      check('the collapsed Archive strip reads the count', await waitFor(STRIP('1 of 4', '1 of 4'), 6000), await ev(`document.querySelector('${COL}').title+'|'+document.querySelector('${COL} .column-count').textContent`));
      await ev(`document.querySelector('#board .column[data-col=archive] .column-toggle').getAttribute('aria-expanded')==='false'&&document.querySelector('#board .column[data-col=archive] .column-toggle').click()`);
      check('the Archive column reads it in its header', await waitFor(`/1 of 4/.test(${HEADER_TEXT})`, 6000), await ev(HEADER_TEXT));
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      check('the phone tab reads it', await waitFor(`/1 of 4/.test(document.querySelector('#board-tabs .board-tab[data-col=archive]').textContent)`, 6000));
      await wide();
      await ev(`document.getElementById('queued-pill').click()`);
      check('the tray opens', await waitFor(`!document.getElementById('tray-sheet').classList.contains('hidden')`, 4000));
      await ev(`document.querySelector('#tray-list .tray-row:first-child .tray-remove').click()`);
      check('removing the archive from the tray takes the count back to none', await waitFor(`state.archived.length===0`, 6000));
      await ev(`document.getElementById('tray-sheet').classList.contains('hidden')||document.getElementById('tray-close').click()`);
      await ev(`setView('map')`);
      check('and the Map pill is not in this page again', await waitFor(`!!${PILL}&&/not in this page/.test(${PILL_TEXT})&&${PILL}.getAttribute('aria-disabled')==='true'`, 6000), await ev(PILL_TEXT));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
