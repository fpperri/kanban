'use strict';
// The Web built with the board inside, as a Board artifact: the page keeps its tray in the artifact's
// database. The runner has no artifact to open, so a stand-in `window.claude` is put in the page before its
// scripts run: `claude.use("db")` answers the collection calls the tray makes (get, doc set and delete,
// onSnapshot) over a store kept in the file origin's browser storage, so it outlives a reload as the
// artifact's database does, and `claude.use("user")` answers null. `?nodb` makes `use("db")` answer null.
// A card dropped on Doing is written at once as one document in the collection `tray` holding
// { method, path, body }, the header reads 1 queued and nothing goes to the browser-storage tray; after a
// reload the card is still in Doing, read back from the stand-in. With `use("db")` answering null the same page
// queues in browser storage instead and shows none of the stand-in's changes. A document another device
// writes into the stand-in shows in the header and on the board without a reload, and the documents
// Claude deletes after an apply take the count to 0. While the tray is in the database and holds a change,
// the tray (opened by the header's pill) says "Tell Claude: apply the tray" above Copy changes and offers no
// Save as file; in browser storage it has no such line and offers Save as file. A change the apply refused shows
// in the tray with its reason, and removing it deletes its document. A card made on another device is removed from its details through the tray's own question, with no window.confirm, and its documents are deleted. Each step waits on what the page shows,
// never on a fixed sleep.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const NAME = `document.getElementById('project-name').textContent`;
const PILL = `(()=>{const p=document.getElementById('queued-pill');return p.classList.contains('hidden')?'':p.textContent})()`;
const HINT = `(()=>{const h=document.getElementById('apply-hint');return !h||h.classList.contains('hidden')?'':h.textContent})()`;
const COPY_SHOWN = `!document.getElementById('copy-changes-btn').classList.contains('hidden')`;
const SHOWN = (id) => `(()=>{const e=document.getElementById(${JSON.stringify(id)});return !!e&&e.offsetParent!==null})()`;
const OPEN = `!document.getElementById('tray-sheet').classList.contains('hidden')`;
const ROWS = `JSON.stringify([...document.querySelectorAll('#tray-list .tray-row')].map((r)=>[r.querySelector('.tray-words').textContent,r.querySelector('.tray-reason')?r.querySelector('.tray-reason').textContent:null]))`;
const column = (id, col) => `!!document.querySelector('#board .column[data-col="${col}"] .card-el[data-id="${id}"]')`;
const DRAWN = `document.querySelectorAll('#board .column .card-el').length>0`;
const STORE = '__standin_db';

const STAND_IN = `(function () {
  var KEY = ${JSON.stringify(STORE)};
  var listeners = [];
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function write(o) { localStorage.setItem(KEY, JSON.stringify(o)); }
  function snap() {
    var o = read();
    var ids = Object.keys(o).sort();
    return { docs: ids.map(function (id) { return { id: id, exists: true, data: function () { return JSON.parse(JSON.stringify(o[id])); } }; }), size: ids.length, empty: !ids.length };
  }
  function tell() { listeners.slice().forEach(function (fn) { fn(snap()); }); }
  var db = {
    collection: function (name) {
      if (name !== 'tray') throw new Error('the tray uses the collection tray, not ' + name);
      return {
        get: function () { return Promise.resolve(snap()); },
        onSnapshot: function (fn) { listeners.push(fn); return function () {}; },
        doc: function (id) {
          return {
            set: function (data) { var o = read(); o[id] = JSON.parse(JSON.stringify(data)); write(o); tell(); return Promise.resolve(); },
            delete: function () { var o = read(); delete o[id]; write(o); tell(); return Promise.resolve(); }
          };
        }
      };
    }
  };
  window.claude = { use: function (name) { return Promise.resolve(name === 'db' && location.search.indexOf('nodb') < 0 ? db : null); } };
  window.__standinRemote = function (id, record) { var o = read(); o[id] = record; write(o); tell(); };
  window.__standinClear = function () { write({}); tell(); };
})();`;

module.exports = {
  name: 'artifact-db',
  board: 'fixture',
  timeoutMs: 100000,
  async run(page) {
    const { ev, waitFor, check, send } = page;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-db-scenario-'));
    let injected = null;
    try {
      const dir = materialize('fixture', path.join(root, 'board', '.kanban'));
      const { html } = buildPage({ boardDir: dir });
      const file = path.join(root, 'fixture.html');
      fs.writeFileSync(file, html);
      const url = fileUrl(file);

      injected = (await send('Page.addScriptToEvaluateOnNewDocument', { source: STAND_IN })).identifier;
      // This scenario leaves a page that holds a copied-for-nobody change on purpose; the page's prompt is not what it checks.
      const stayPut = () => ev(`window.askBeforeLeaving&&window.removeEventListener('beforeunload',window.askBeforeLeaving)`);
      const load = async (query = '') => {
        await stayPut();
        await send('Page.navigate', { url: url + query });
        return waitFor(`document.readyState==='complete'&&${NAME}==='fixture'&&${DRAWN}`, 15000);
      };
      const drop = (id, col) => ev(`(()=>{const card=document.querySelector('#board .card[data-id="${id}"]');const col=document.querySelector('#board .column[data-col="${col}"]');if(!card||!col)return false;const dt=new DataTransfer();const fire=(type,el)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientY:col.getBoundingClientRect().top+8}));fire('dragstart',card);fire('dragover',col);fire('drop',col);fire('dragend',card);return true})()`);
      const standIn = async () => JSON.parse((await ev(`localStorage.getItem(${JSON.stringify(STORE)})||'{}'`)) || '{}');
      const trayKeys = () => ev(`Object.keys(localStorage).filter((k)=>k.startsWith('kanban-tray:')).length`);

      // a clean browser storage for the file origin, whichever scenario ran before
      await load();
      await ev('localStorage.clear()');

      check('the page opens with the stand-in database and draws the board', await load());
      check('the board load names the artifact as its source', (await ev(`window.kanbanSourceInUse.request('GET','/api/board').then((r)=>JSON.stringify([r.json.source.kind,r.json.source.queued]))`)) === JSON.stringify(['artifact', 0]));
      check('the header shows no queued count yet', (await ev(PILL)) === '');
      check('and no line telling Claude to apply the tray', (await ev(HINT)) === '');
      check('card 7 starts in Todo', await ev(column('7', 'todo')));

      // a move is written at once as one document
      await drop('7', 'doing');
      check('a card dropped on Doing shows there at once', await waitFor(column('7', 'doing'), 6000));
      check('the header reads 1 queued', await waitFor(`${PILL}==='1 queued'`, 6000), await ev(PILL));
      check('the header says to tell Claude: apply the tray', await waitFor(`${HINT}==='Tell Claude: apply the tray'`, 6000), await ev(HINT));
      check('Copy changes stays beside it as the fallback', await ev(COPY_SHOWN));
      const docs = await standIn();
      const ids = Object.keys(docs);
      check('one document is in the collection tray', ids.length === 1, JSON.stringify(ids));
      const doc = docs[ids[0]] || {};
      check('it holds { method, path, body }', JSON.stringify(doc.change) === JSON.stringify({ method: 'PATCH', path: '/api/cards/7', body: { status: 'doing' } }), JSON.stringify(doc));
      check('it names its id, its time and its device', doc.id === ids[0] && /^\d{4}-\d{2}-\d{2}T/.test(doc.at || '') && typeof doc.device === 'string' && doc.id.startsWith(`${doc.device}-`), JSON.stringify(doc));
      check('nothing went to the browser-storage tray', (await trayKeys()) === 0);

      // a reload reads it back from the stand-in
      await send('Page.reload');
      check('after a reload the card is still in Doing', await waitFor(`${NAME}==='fixture'&&${column('7', 'doing')}`, 15000));
      check('and the header still reads 1 queued', await waitFor(`${PILL}==='1 queued'`, 6000), await ev(PILL));
      check('and still says to tell Claude: apply the tray', await waitFor(`${HINT}==='Tell Claude: apply the tray'`, 6000), await ev(HINT));
      check('the reload wrote nothing more', Object.keys(await standIn()).length === 1);

      // the tray of a Board artifact: the line, Copy changes, no Save as file
      await ev(`document.getElementById('queued-pill').click()`);
      check('the pill opens the tray', await waitFor(OPEN, 4000));
      check('the tray says "Tell Claude: apply the tray"', await ev(SHOWN('apply-hint')) && (await ev(`document.getElementById('apply-hint').textContent`)) === 'Tell Claude: apply the tray');
      check('with Copy changes kept as the fallback', await ev(SHOWN('copy-changes-btn')));
      check('and no Save as file, which belongs to the downloaded file', !(await ev(SHOWN('save-changes-btn'))));
      check('its one row reads in plain words', (await ev(ROWS)) === JSON.stringify([['moved #7 to doing', null]]), await ev(ROWS));
      await page.key('Escape');
      check('Esc closes it', await waitFor(`!(${OPEN})`, 4000));

      // with the database answering null the same page queues in browser storage
      check('with use("db") answering null the page opens', await load('?nodb=1'));
      check('it shows none of the stand-in\'s changes', (await ev(PILL)) === '' && (await ev(column('7', 'todo'))), await ev(PILL));
      check('the board load names a page as its source', (await ev(`window.kanbanSourceInUse.request('GET','/api/board').then((r)=>r.json.source.kind)`)) === 'page');
      await drop('7', 'done');
      check('it queues its own move', await waitFor(`${column('7', 'done')}&&${PILL}==='1 queued'`, 6000), await ev(PILL));
      check('a tray in browser storage has no line telling Claude to apply it, only Copy changes', (await ev(HINT)) === '' && (await ev(COPY_SHOWN)));
      check('in browser storage', (await trayKeys()) === 1);
      await ev(`document.getElementById('queued-pill').click()`);
      check('its tray offers Save as file and Copy changes and no "Tell Claude" line', await waitFor(OPEN, 4000) && await ev(SHOWN('save-changes-btn')) && await ev(SHOWN('copy-changes-btn')) && !(await ev(SHOWN('apply-hint'))));
      await page.key('Escape');
      await waitFor(`!(${OPEN})`, 4000);
      check('and not in the database', Object.keys(await standIn()).length === 1);

      // another device writes a document: the open page hears it
      check('the page opens on the database again', await load());
      check('it still shows only the stand-in\'s own change', (await waitFor(`${PILL}==='1 queued'&&${column('7', 'doing')}`, 6000)));
      await ev(`window.__standinRemote('phone-1',{id:'phone-1',at:'2099-01-01T00:00:00.000Z',device:'phone',change:{method:'PATCH',path:'/api/cards/7',body:{status:'done'}}})`);
      check('a change written by another device shows in the header without a reload', await waitFor(`${PILL}==='2 queued'`, 8000), await ev(PILL));
      check('and on the board', await waitFor(column('7', 'done'), 8000));

      // a change the apply refused shows with its reason, and Remove deletes its document
      await ev(`window.__standinRemote('phone-1',{id:'phone-1',at:'2099-01-01T00:00:00.000Z',device:'phone',change:{method:'PATCH',path:'/api/cards/7',body:{status:'done'}},refused:'priority changed at the desk since'})`);
      await ev(`document.getElementById('queued-pill').click()`);
      check('the tray opens on both changes', await waitFor(`${OPEN}&&document.querySelectorAll('#tray-list .tray-row').length===2`, 8000), await ev(ROWS));
      check('the refused one shows its reason', (await ev(ROWS)) === JSON.stringify([['moved #7 to doing', null], ['moved #7 to done', 'Refused: priority changed at the desk since']]), await ev(ROWS));
      await ev(`document.querySelectorAll('#tray-list .tray-row')[1].querySelector('.tray-remove').click()`);
      check('Remove takes the refused row out of the tray', await waitFor(`${PILL}==='1 queued'&&document.querySelectorAll('#tray-list .tray-row').length===1`, 8000), await ev(PILL));
      check('and deletes its document from the database', !('phone-1' in (await standIn())), JSON.stringify(Object.keys(await standIn())));
      await page.key('Escape');
      await waitFor(`!(${OPEN})`, 4000);

      // a card made on another device: its details remove it through the tray's own question, where a sandboxed host's confirm would say no
      const TILE = (id) => `#board .card-el[data-id="${id}"]`;
      const ASK = `document.getElementById('tray-confirm-text').textContent`;
      await ev(`window.__standinRemote('phone-2',{id:'phone-2',at:'2099-01-02T00:00:00.000Z',device:'phone',change:{method:'POST',path:'/api/cards',body:{title:'Made on the phone',status:'todo'}},temp:'n1'})`);
      await ev(`window.__standinRemote('phone-3',{id:'phone-3',at:'2099-01-02T00:00:01.000Z',device:'phone',change:{method:'PATCH',path:'/api/cards/n1',body:{status:'doing'}},before:{status:'todo'}})`);
      check('a card made on the phone shows as n1', await waitFor(`${PILL}==='3 queued'&&!!document.querySelector('${TILE('n1')}')`, 8000), await ev(PILL));
      await ev(`(()=>{window.__asked=[];window.confirm=(m)=>{window.__asked.push(m);return false};return true})()`);
      await ev(`document.querySelector('${TILE('n1')}').click()`);
      check('its details offer to remove it from the tray', await waitFor(`!document.getElementById('detail-modal').classList.contains('hidden')&&!document.getElementById('detail-queued').classList.contains('hidden')`, 4000));
      await ev(`document.getElementById('detail-unqueue-btn').click()`);
      check('the tray opens and asks, naming the 1 more change that names it', await waitFor(`${OPEN}&&!document.getElementById('tray-confirm').classList.contains('hidden')`, 4000) && /1 more queued change names it and goes too\.$/.test(await ev(ASK)), await ev(ASK));
      check('and no window.confirm was raised', (await ev('window.__asked.length')) === 0);
      await ev(`document.getElementById('tray-confirm-yes').click()`);
      check('Remove takes the card out of the page and its details close', await waitFor(`!document.querySelector('${TILE('n1')}')&&document.getElementById('detail-modal').classList.contains('hidden')`, 8000));
      check('and its two documents out of the database', await waitFor(`${PILL}==='1 queued'`, 8000) && !('phone-2' in (await standIn())) && !('phone-3' in (await standIn())), JSON.stringify(Object.keys(await standIn())));
      await page.key('Escape');
      await waitFor(`!(${OPEN})`, 4000);

      // Claude applies the tray and deletes the documents
      await ev('window.__standinClear()');
      check('when the documents are deleted the header shows no count', await waitFor(`${PILL}===''`, 8000), await ev(PILL));
      check('and the line telling Claude to apply the tray goes', await waitFor(`${HINT}===''`, 8000), await ev(HINT));
    } finally {
      if (injected) { try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected }); } catch (e) { /* the scenario is over */ } }
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
