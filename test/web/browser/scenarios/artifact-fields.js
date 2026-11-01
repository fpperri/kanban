'use strict';
// A downloaded file of the Web with the board inside queues an edit as only the fields it changed. The edit
// form sends the whole card; editing only the title in the page leaves one queued change that holds the title
// alone and the title the page had (its before value). The apply then lands that edit on a board whose
// priority the desk changed since the build, and refuses it on one whose title the desk changed, saying
// "changed at the desk since". A record the apply refused, once it rides into a page built afterwards, is
// counted apart (the header reads "1 queued, 1 refused"), carries its reason on hover and does not change
// what the board shows. Each step waits on what the page shows, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): askBeforeLeaving.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');
const { makeRoute } = require('../../../../plugin/skills/web/scripts/route');
const { applyTray } = require('../../../../plugin/skills/web/scripts/apply-tray');

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const NAME = `document.getElementById('project-name').textContent`;
const PILL = `(()=>{const p=document.getElementById('queued-pill');return p.classList.contains('hidden')?'':p.textContent})()`;
const DRAWN = `document.querySelectorAll('#board .column .card-el').length>0`;
const MODAL_UP = `!document.getElementById('modal').classList.contains('hidden')`;
const TILE = (id) => `#board .card-el[data-id="${id}"]`;
const TITLE = (id) => `(()=>{const t=document.querySelector('${TILE(id)} .card-title');return t?t.textContent.trim():null})()`;

module.exports = {
  name: 'artifact-fields',
  board: 'fixture',
  timeoutMs: 100000,
  async run(page) {
    const { ev, waitFor, check, send, centre, click } = page;
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-fields-'));
    try {
      const dir = materialize('fixture', path.join(root, 'board', '.kanban'));
      const { html, board } = buildPage({ boardDir: dir });
      const file = path.join(root, 'fixture.html');
      fs.writeFileSync(file, html);
      const trayKey = `kanban-tray:${board.id}:${board.base}`;
      const stayPut = () => ev(`window.askBeforeLeaving&&window.removeEventListener('beforeunload',window.askBeforeLeaving)`);
      const load = async () => {
        await stayPut();
        await send('Page.navigate', { url: fileUrl(file) });
        return waitFor(`document.readyState==='complete'&&${NAME}==='fixture'&&${DRAWN}`, 15000);
      };
      const records = async () => JSON.parse((await ev(`localStorage.getItem(${JSON.stringify(trayKey)})`)) || '{"records":[]}').records;

      await load();
      await ev('localStorage.clear()');
      check('the file opens', await load());
      const was = await ev(TITLE('7'));
      check('card 7 has a title on its tile', typeof was === 'string' && was.length > 0, String(was));

      // edit the title alone in the form
      await clickOn(TILE('7'));
      check('the card opens', await waitFor(`!document.getElementById('detail-modal').classList.contains('hidden')`, 6000));
      await ev(`document.getElementById('detail-edit-btn').click()`);
      check('the edit form opens on card 7', await waitFor(`${MODAL_UP}&&document.getElementById('f-id').value==='7'`, 4000));
      const renamed = `${was} (renamed on the phone)`;
      await ev(`(()=>{const t=document.getElementById('f-title');t.value=${JSON.stringify(renamed)};t.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('card-form').requestSubmit();return true})()`);
      check('the new title shows on the tile', await waitFor(`${TITLE('7')}===${JSON.stringify(renamed)}`, 6000), await ev(TITLE('7')));
      check('the header reads 1 queued', await waitFor(`${PILL}==='1 queued'`, 6000), await ev(PILL));

      const queued = await records();
      check('one change is queued', queued.length === 1, JSON.stringify(queued).slice(0, 300));
      check('it holds the title alone', JSON.stringify(Object.keys(queued[0].change.body)) === JSON.stringify(['title']) && queued[0].change.body.title === renamed, JSON.stringify(queued[0].change));
      check('and the title the page had, as its before value', JSON.stringify(queued[0].before) === JSON.stringify({ title: was }), JSON.stringify(queued[0].before));

      // the desk changed the priority since the build: the title edit still lands
      const deskOnly = makeRoute(dir);
      check('the desk sets card 7 to High (the reference)', deskOnly('PATCH', '/api/cards/7', { priority: 'High' }).status === 200);
      const landed = applyTray({ dir, records: queued });
      const after = makeRoute(dir)('GET', '/api/board').body.active.find((c) => String(c.id) === '7');
      check('the apply lands the title edit', landed.refused.length === 0 && landed.applied.length === 1 && after.title === renamed, JSON.stringify(landed));
      check('and keeps the desk\'s priority', after.priority === 'High', String(after.priority));

      // the desk changed the title since the build: the edit is refused
      const dir2 = materialize('fixture', path.join(root, 'board2', '.kanban'));
      check('the desk renames card 7 (the reference)', makeRoute(dir2)('PATCH', '/api/cards/7', { title: 'Renamed at the desk' }).status === 200);
      const refused = applyTray({ dir: dir2, records: queued });
      check('the apply refuses the edit with "changed at the desk since"', refused.applied.length === 0 && refused.refused.length === 1 && /title changed at the desk since/.test(refused.refused[0].reason), JSON.stringify(refused));

      // the refused record rides into a page built afterwards
      const reason = refused.refused[0].reason;
      await ev(`(()=>{const k=${JSON.stringify(trayKey)};const t=JSON.parse(localStorage.getItem(k));t.records[0].refused=${JSON.stringify(reason)};localStorage.setItem(k,JSON.stringify(t));return true})()`);
      check('the page opens again', await load());
      check('the header counts the refused record apart', await waitFor(`${PILL}==='1 queued, 1 refused'`, 6000), await ev(PILL));
      check('its reason is on the count', await ev(`document.getElementById('queued-pill').title.includes(${JSON.stringify(reason)})`));
      check('the board does not show the change the apply kept out', (await ev(TITLE('7'))) === was, await ev(TITLE('7')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
