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
// the header says "Tell Claude: apply the tray" beside Copy changes; in browser storage it does not. Each step waits on what the page shows, never on a
// fixed sleep.

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
      const load = async (query = '') => {
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
      check('the board load names the artifact as its source', (await ev(`window.kanbanSourceInUse.request('GET','/api/board').then((r)=>JSON.stringify(r.json.source))`)) === JSON.stringify({ kind: 'artifact', queued: 0 }));
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

      // with the database answering null the same page queues in browser storage
      check('with use("db") answering null the page opens', await load('?nodb=1'));
      check('it shows none of the stand-in\'s changes', (await ev(PILL)) === '' && (await ev(column('7', 'todo'))), await ev(PILL));
      check('the board load names a page as its source', (await ev(`window.kanbanSourceInUse.request('GET','/api/board').then((r)=>r.json.source.kind)`)) === 'page');
      await drop('7', 'done');
      check('it queues its own move', await waitFor(`${column('7', 'done')}&&${PILL}==='1 queued'`, 6000), await ev(PILL));
      check('a tray in browser storage has no line telling Claude to apply it, only Copy changes', (await ev(HINT)) === '' && (await ev(COPY_SHOWN)));
      check('in browser storage', (await trayKeys()) === 1);
      check('and not in the database', Object.keys(await standIn()).length === 1);

      // another device writes a document: the open page hears it
      check('the page opens on the database again', await load());
      check('it still shows only the stand-in\'s own change', (await waitFor(`${PILL}==='1 queued'&&${column('7', 'doing')}`, 6000)));
      await ev(`window.__standinRemote('phone-1',{id:'phone-1',at:'2099-01-01T00:00:00.000Z',device:'phone',change:{method:'PATCH',path:'/api/cards/7',body:{status:'done'}}})`);
      check('a change written by another device shows in the header without a reload', await waitFor(`${PILL}==='2 queued'`, 8000), await ev(PILL));
      check('and on the board', await waitFor(column('7', 'done'), 8000));

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
