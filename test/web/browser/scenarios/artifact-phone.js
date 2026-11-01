'use strict';
// The Board artifact on a 390 px phone, with touch: the file the artifact skill's build makes over the fixture board,
// opened from disk with no server in its way and a window.confirm that answers no, as a sandboxed viewer's does. Three
// taps on Todo cards select them and show the selection bar; Archive on the bar asks in the page, opens the package
// popup, and archives the three: the header reads 3 queued, the tray holds three archive changes (one POST per card,
// in the order they were selected), the selection is empty and the bar has gone. No native confirm() was raised.
// Each step waits on what the page shows, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds, state.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');
const { tap } = require('../steps');
const { askUp, askGone, askText, askYes, refuseNativeConfirm, nativeConfirmsSeen } = require('../ask');

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const PILL = `(()=>{const p=document.getElementById('queued-pill');return p.classList.contains('hidden')?'':p.textContent})()`;

module.exports = {
  name: 'artifact-phone',
  board: 'fixture',
  timeoutMs: 100000,
  async run(page) {
    const { ev, waitFor, check, send } = page;
    const IDS = [10, 13, 17];
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); if (!p) throw new Error(`nothing matches ${sel}`); await tap(page, p.x, p.y); };
    const BAR_SHOWN = `getComputedStyle(document.getElementById('selection-bar')).display!=='none'`;

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-phone-'));
    try {
      const dir = materialize('fixture', path.join(root, 'board-fixture', '.kanban'));
      const { html } = buildPage({ boardDir: dir });
      const file = path.join(root, 'fixture.html');
      fs.writeFileSync(file, html);
      const url = fileUrl(file);

      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const load = async () => {
        await ev(`window.askBeforeLeaving&&window.removeEventListener('beforeunload',window.askBeforeLeaving)`);
        await send('Page.navigate', { url });
        return waitFor(`document.readyState==='complete'&&document.getElementById('project-name').textContent==='fixture'&&document.querySelectorAll('#board .column .card-el').length>0`, 15000);
      };
      await load();
      await ev('localStorage.clear()');
      check('the built file opens on a phone and draws the Board', await load());
      check('nothing is queued yet', (await ev(PILL)) === '');
      await refuseNativeConfirm(page);

      await tapOn('.board-tab[data-col="todo"]');
      check('the Todo tab shows the cards the scenario selects', await waitFor(IDS.map((id) => `!!document.querySelector(${JSON.stringify(titleOf(id))})`).join('&&'), 5000));
      check('there is no selection bar yet', !(await ev(BAR_SHOWN)));
      for (const id of IDS) await tapOn(titleOf(id));
      check('three taps select three cards', await waitFor(`[...selectedIds].map(Number).sort((a,b)=>a-b).join()===${JSON.stringify(IDS.join())}`, 3000));
      check('the bar shows, reading 3 selected', await waitFor(`${BAR_SHOWN}&&document.getElementById('selection-bar-count').textContent==='3 selected'`, 3000));

      await tapOn('#selection-bar-archive');
      const asked = (await askUp(page)) ? await askText(page) : null;
      check('Archive asks in the page, where the viewer\'s confirm() would have said no', asked === 'Archive 3 card(s)? (moves their files to archived/)', asked);
      await askYes(page);
      check('then the package popup opens', await askGone(page) && await waitFor(`!document.getElementById('bulk-archive').classList.contains('hidden')`, 3000));
      await tapOn('#bulk-archive-apply');
      check('the three cards leave the Board for the archive', await waitFor(`${IDS.map((id) => `state.archived.some((c)=>String(c.id)==='${id}')`).join('&&')}&&${IDS.map((id) => `!document.querySelector(${JSON.stringify(titleOf(id))})`).join('&&')}`, 8000));
      check('the header reads 3 queued', await waitFor(`${PILL}==='3 queued'`, 6000), await ev(PILL));
      const records = await ev(`JSON.stringify(window.kanbanSourceInUse.records().map((r)=>[r.change.method,r.change.path]))`);
      check('the tray holds three archive changes, one per card, in the order they were selected', records === JSON.stringify(IDS.map((id) => ['POST', `/api/cards/${id}/archive`])), records);
      check('the selection is empty and the bar has gone', await waitFor(`selectedIds.size===0&&!(${BAR_SHOWN})`, 3000));
      check('no native confirm() was raised', (await nativeConfirmsSeen(page)) === 0, await nativeConfirmsSeen(page));
      await ev(`window.askBeforeLeaving&&window.removeEventListener('beforeunload',window.askBeforeLeaving)`);
    } finally {
      try { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); } catch (e) { /* the scenario is over; the next one's start turns touch off */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
