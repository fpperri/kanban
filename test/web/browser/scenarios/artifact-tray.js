'use strict';
// The tray screen of the Web built with the board inside, as a downloaded file: the header's "N queued" pill
// opens the tray, a side panel on a desktop-sized window and a bottom sheet on a phone-sized one. One
// plain-words row per queued change ("moved #7 to doing"), each with a Remove. Removing a row that nothing
// else names takes that change only; one that made a card other changes name asks first, in the sheet, how
// many go with it, and Keep leaves everything. Discard all asks first and Keep leaves the tray as it was. The
// file shows Copy changes and Save as file and no "Tell Claude" line; Save as file hands over the change
// payload as a text file named for the board. Esc closes the tray and focus goes back to the pill, and an
// emptied tray closes itself. The Board artifact's half (the Tell Claude line, a refused change with its
// reason) is in the artifact-db scenario. Each step waits on what the page shows, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): loadBoard.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const NAME = `document.getElementById('project-name').textContent`;
const PILL = `(()=>{const p=document.getElementById('queued-pill');return p.classList.contains('hidden')?'':p.textContent})()`;
const column = (id, col) => `!!document.querySelector('#board .column[data-col="${col}"] .card-el[data-id="${id}"]')`;
const DRAWN = `document.querySelectorAll('#board .column .card-el').length>0`;
const OPEN = `!document.getElementById('tray-sheet').classList.contains('hidden')`;
const SETTLED = `document.getElementById('tray-panel').getAnimations().length===0`;
const WORDS = `[...document.querySelectorAll('#tray-list .tray-row .tray-words')].map((e)=>e.textContent)`;
const SHOWN = (id) => `(()=>{const e=document.getElementById(${JSON.stringify(id)});return !!e&&e.offsetParent!==null})()`;
const ASKING = `!document.getElementById('tray-confirm').classList.contains('hidden')`;
const RECT = `(()=>{const r=document.getElementById('tray-panel').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,w:innerWidth,h:innerHeight}})()`;
const saveRequest = (body) => `window.kanbanSourceInUse.request(${JSON.stringify(body.method)},${JSON.stringify(body.path)},${JSON.stringify(body.body)}).then((r)=>r.status)`;

module.exports = {
  name: 'artifact-tray',
  board: 'fixture',
  timeoutMs: 100000,
  async run(page) {
    const { ev, waitFor, check, send, centre, click, shot } = page;
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-tray-scenario-'));
    try {
      const dir = materialize('fixture', path.join(root, 'board', '.kanban'));
      const { html } = buildPage({ boardDir: dir });
      const file = path.join(root, 'fixture.html');
      fs.writeFileSync(file, html);
      const url = fileUrl(file);
      // This scenario leaves pages that hold queued changes on purpose; the page's prompt is not what it checks.
      const stayPut = () => ev(`window.askBeforeLeaving&&window.removeEventListener('beforeunload',window.askBeforeLeaving)`);
      const load = async () => {
        await stayPut();
        await send('Page.navigate', { url });
        return waitFor(`document.readyState==='complete'&&${NAME}==='fixture'&&${DRAWN}`, 15000);
      };
      const queue = async (saves) => {
        for (const save of saves) {
          if ((await ev(saveRequest(save))) >= 300) throw new Error(`the page refused ${JSON.stringify(save)}`);
        }
        await ev('loadBoard().then(()=>true)');
      };
      const MOVE_7 = { method: 'PATCH', path: '/api/cards/7', body: { status: 'doing' } };
      const MOVE_3 = { method: 'PATCH', path: '/api/cards/3', body: { status: 'doing' } };
      const MAKE = [
        { method: 'POST', path: '/api/cards', body: { title: 'Made in the page' } },
        { method: 'POST', path: '/api/cards', body: { title: 'Child of n1', parent: 'n1' } },
      ];
      const openTray = async () => {
        await clickOn('#queued-pill');
        return waitFor(`${OPEN}&&${SETTLED}`, 4000);
      };
      const rowButton = (words, label) => `[...document.querySelectorAll('#tray-list .tray-row')].find((r)=>r.querySelector('.tray-words').textContent===${JSON.stringify(words)}).querySelector(${JSON.stringify(label)})`;

      // a clean browser storage for the file origin, whichever scenario ran before
      await load();
      await ev('localStorage.clear()');
      check('the file opens and the pill is hidden with nothing queued', await load() && (await ev(PILL)) === '');
      check('the tray is shut', !(await ev(OPEN)));

      // a desktop-sized window: a side panel
      await queue([MOVE_7, ...MAKE]);
      check('the pill reads 3 queued', await waitFor(`${PILL}==='3 queued'`, 6000), await ev(PILL));
      check('the pill is a button that is not yet expanded', await ev(`(()=>{const p=document.getElementById('queued-pill');return p.tagName==='BUTTON'&&p.getAttribute('aria-expanded')==='false'})()`));
      check('the pill opens the tray', await openTray());
      check('and is marked expanded', await ev(`document.getElementById('queued-pill').getAttribute('aria-expanded')`) === 'true');
      const side = await ev(RECT);
      await shot('desktop-open');
      check('on a desktop-sized window the tray is a side panel at the right edge, the height of the window', side.right === side.w && side.left > side.w / 2 && side.top === 0 && side.height === side.h, JSON.stringify(side));
      check('it says how many are queued', (await ev(`document.getElementById('tray-count').textContent`)) === '3 queued');
      check('it holds one plain-words row per change, in the order made', JSON.stringify(await ev(WORDS)) === JSON.stringify(['moved #7 to doing', 'created card n1 "Made in the page"', 'created card n2 "Child of n1"']), JSON.stringify(await ev(WORDS)));
      check('each row has a Remove', (await ev(`document.querySelectorAll('#tray-list .tray-row .tray-remove').length`)) === 3);
      check('the file shows Copy changes and Save as file', await ev(SHOWN('copy-changes-btn')) && await ev(SHOWN('save-changes-btn')));
      check('and no "Tell Claude" line, which is the Board artifact\'s', !(await ev(SHOWN('apply-hint'))));
      check('Discard all is there', await ev(SHOWN('discard-changes-btn')));

      // Copy changes and Save as file hand over the same payload
      await ev(`Object.defineProperty(navigator,'clipboard',{value:{writeText:async(t)=>{window.__copied=t}},configurable:true})`);
      await clickOn('#copy-changes-btn');
      check('Copy changes puts the payload on the clipboard', await waitFor(`typeof window.__copied==='string'`, 4000));
      await ev(`(()=>{window.__saved=null;HTMLAnchorElement.prototype.click=function(){window.__saved={download:this.download,href:this.href};};return true})()`);
      await clickOn('#save-changes-btn');
      check('Save as file offers a text file named for the board', await waitFor(`!!window.__saved`, 4000) && (await ev('window.__saved.download')) === 'kanban-changes-fixture.txt', JSON.stringify(await ev('window.__saved')));
      const saved = await ev(`fetch(window.__saved.href).then((r)=>r.text())`);
      check('and holding the same payload Copy changes took', saved === `${await ev('window.__copied')}\n`, saved.slice(0, 120));
      check('after them leaving the page asks nothing', await ev(`(()=>{const e={defaultPrevented:false,returnValue:'',preventDefault(){this.defaultPrevented=true}};askBeforeLeaving(e);return e.defaultPrevented})()`) === false);

      // removing one row takes that change only
      await clickOn('#tray-list .tray-row:first-child .tray-remove');
      check('removing the move takes that row and no other', await waitFor(`JSON.stringify(${WORDS})===${JSON.stringify(JSON.stringify(['created card n1 "Made in the page"', 'created card n2 "Child of n1"']))}`, 6000), JSON.stringify(await ev(WORDS)));
      check('with no question asked', !(await ev(ASKING)));
      check('the pill reads 2 queued and the tray stays open', await waitFor(`${PILL}==='2 queued'&&${OPEN}`, 6000), await ev(PILL));
      check('and card 7 is back in Todo on the board', await waitFor(column('7', 'todo'), 6000));
      check('the cards made in the page are still there', await ev(`!!document.querySelector('#board .card-el[data-id="n1"]')&&!!document.querySelector('#board .card-el[data-id="n2"]')`));

      // a change other changes name asks first, and Keep leaves everything
      await clickOn('#tray-list .tray-row:first-child .tray-remove');
      check('removing the card n1 asks in the tray, naming how many go with it', await waitFor(ASKING, 4000) && (await ev(`document.getElementById('tray-confirm-text').textContent`)) === 'Remove "created card n1 "Made in the page""? 1 more queued change names it and goes too.', await ev(`document.getElementById('tray-confirm-text').textContent`));
      check('and removes nothing yet', (await ev(PILL)) === '2 queued' && (await ev(WORDS)).length === 2);
      await clickOn('#tray-confirm-no');
      check('Keep closes the question and leaves both changes', await waitFor(`!(${ASKING})`, 4000) && (await ev(WORDS)).length === 2);
      await clickOn('#tray-list .tray-row:first-child .tray-remove');
      check('asked again', await waitFor(ASKING, 4000));
      await page.key('Escape');
      check('Esc steps back from the question, leaving the tray open', await waitFor(`!(${ASKING})&&${OPEN}`, 4000));
      await clickOn('#tray-list .tray-row:first-child .tray-remove');
      await waitFor(ASKING, 4000);
      await clickOn('#tray-confirm-yes');
      check('confirming takes the card and the change that names it out of the page', await waitFor(`${PILL}===''&&!document.querySelector('#board .card-el[data-id="n1"]')&&!document.querySelector('#board .card-el[data-id="n2"]')`, 6000), await ev(PILL));
      check('an emptied tray closes itself', await waitFor(`!(${OPEN})`, 4000));
      check('and the pill is gone with the count', (await ev(PILL)) === '');

      // Discard all asks first
      await queue([MOVE_7, MOVE_3]);
      check('two changes are queued again', await waitFor(`${PILL}==='2 queued'`, 6000), await ev(PILL));
      check('the tray opens again', await openTray());
      await clickOn('#discard-changes-btn');
      check('Discard all asks, naming the count', await waitFor(ASKING, 4000) && (await ev(`document.getElementById('tray-confirm-text').textContent`)).startsWith('Discard all 2 queued changes?'), await ev(`document.getElementById('tray-confirm-text').textContent`));
      check('and discards nothing yet', (await ev(PILL)) === '2 queued' && (await ev(column('7', 'doing'))));
      await clickOn('#tray-confirm-no');
      check('Keep leaves the tray as it was', await waitFor(`!(${ASKING})`, 4000) && (await ev(PILL)) === '2 queued' && (await ev(WORDS)).length === 2);
      await clickOn('#discard-changes-btn');
      await waitFor(ASKING, 4000);
      await clickOn('#tray-confirm-yes');
      check('Discard all empties the tray, closes it and shows the board as it was built', await waitFor(`${PILL}===''&&!(${OPEN})&&${column('7', 'todo')}&&${column('3', 'todo')}`, 6000), await ev(PILL));
      await stayPut();
      await send('Page.reload');
      check('after a reload nothing is queued', await waitFor(`${NAME}==='fixture'&&${DRAWN}&&${PILL}===''`, 15000));

      // Esc closes the tray and hands focus back to the pill
      await queue([MOVE_7]);
      await waitFor(`${PILL}==='1 queued'`, 6000);
      check('the tray opens on one change', await openTray() && (await ev(`document.getElementById('tray-count').textContent`)) === '1 queued');
      await page.key('Escape');
      check('Esc closes it', await waitFor(`!(${OPEN})`, 4000));
      check('and focus goes back to the pill', await ev(`document.activeElement===document.getElementById('queued-pill')`));
      check('a click outside the panel closes it too', await openTray() && await ev(`(()=>{document.getElementById('tray-sheet').click();return true})()`) && await waitFor(`!(${OPEN})`, 4000));

      // a phone-sized window: a bottom sheet
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      try {
        check('on a phone-sized window the pill is in the header, whole', await waitFor(`(()=>{const p=document.getElementById('queued-pill');const r=p.getBoundingClientRect();return p.offsetParent!==null&&r.left>=0&&r.right<=innerWidth})()`, 4000), await ev(`JSON.stringify(document.getElementById('queued-pill').getBoundingClientRect())`));
        check('and opens the tray', await openTray());
        const sheet = await ev(RECT);
        await shot('phone-open');
        check('as a bottom sheet: the width of the window, its lower edge on the window\'s, open above', sheet.width === sheet.w && sheet.bottom === sheet.h && sheet.top > 0 && sheet.height < sheet.h * 0.8, JSON.stringify(sheet));
        check('with its row and its buttons inside the window', await ev(`[...document.querySelectorAll('#tray-list .tray-row, #tray-panel .tray-foot button:not(.hidden)')].every((e)=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})`));
        check('the row reads as on the desktop', JSON.stringify(await ev(WORDS)) === JSON.stringify(['moved #7 to doing']));
        await clickOn('#tray-close');
        check('the close button closes it', await waitFor(`!(${OPEN})`, 4000));
      } finally {
        await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
      }
      await stayPut();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
