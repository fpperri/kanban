'use strict';
// The Web built with the board inside, as a downloaded file (the artifact skill's build): one HTML file
// opened from disk with no server in its way, whose saves are answered by route over the board in the
// page and queued in browser storage. Files are built from three boards (the fixture, plan and todos boards)
// and opened in the one browser. The first draws the Board, Calendar, Gantt, Map and Graph; a card
// dropped on Doing shows there at once and the header reads 1 queued, and after a reload it is still
// there and still 1 queued; a card that waits on others is refused with the toast the desk gives, and
// the page source refuses it with the desk's own 422 message; Copy changes copies a payload whose header
// names the board and the Base and whose records hold { method, path, body }. The second file shows none
// of the first's queued changes and queues its own; each file keeps only its own. Each step waits on what
// the page shows, never on a fixed sleep. Booting the page here is also the proof that every store runs in a
// browser, the one thing the Node tests cannot show.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): state.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');
const { makeRoute } = require('../../../../plugin/skills/web/scripts/route');
const { VIEWS } = require('./smoke');

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const NAME = `document.getElementById('project-name').textContent`;
const PILL = `(()=>{const p=document.getElementById('queued-pill');return p.classList.contains('hidden')?'':p.textContent})()`;
const TOAST = `document.getElementById('toast').textContent`;
const column = (id, col) => `!!document.querySelector('#board .column[data-col="${col}"] .card-el[data-id="${id}"]')`;
const DRAWN = `document.querySelectorAll('#board .column .card-el').length>0`;

module.exports = {
  name: 'artifact',
  board: 'fixture',
  timeoutMs: 100000,
  async run(page) {
    const { ev, waitFor, check, send } = page;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-scenario-'));
    try {
      const built = {};
      for (const key of ['fixture', 'plan', 'todos']) {
        const dir = materialize(key, path.join(root, `board-${key}`, '.kanban'));
        const { html, board } = buildPage({ boardDir: dir });
        const file = path.join(root, `${key}.html`);
        fs.writeFileSync(file, html);
        built[key] = { dir, file, board, url: fileUrl(file) };
      }
      const load = async (key, query = '', ready = DRAWN) => {
        await send('Page.navigate', { url: built[key].url + query });
        return waitFor(`document.readyState==='complete'&&${NAME}===${JSON.stringify(key)}&&${ready}`, 15000);
      };
      const drop = (id, col) => ev(`(()=>{const card=document.querySelector('#board .card[data-id="${id}"]');const col=document.querySelector('#board .column[data-col="${col}"]');if(!card||!col)return false;const dt=new DataTransfer();const fire=(type,el)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientY:col.getBoundingClientRect().top+8}));fire('dragstart',card);fire('dragover',col);fire('drop',col);fire('dragend',card);return true})()`);

      // a clean browser storage for the file origin, whichever scenario ran before
      await load('fixture');
      await ev('localStorage.clear()');

      // the fixture file opens and draws every view with no server
      check('the file opens from disk and draws the board', await load('fixture'));
      check('it is the fixture board', (await ev(NAME)) === 'fixture');
      check('it was opened as a file', (await ev('location.protocol')) === 'file:');
      check('nothing in the page asked a server for the board', (await ev(`performance.getEntriesByType('resource').filter((e)=>e.name.includes('/api/')).length`)) === 0);
      check('the header shows no queued count yet', (await ev(PILL)) === '');
      for (const { view, ready } of VIEWS) {
        const drawn = await load('fixture', `?view=${view}`, ready);
        check(`the ${view} view renders in the file`, drawn, drawn ? undefined : await ev('location.href'));
      }

      // a move shows at once and is counted
      await load('fixture');
      check('card 7 starts in Todo', await ev(column('7', 'todo')));
      await drop('7', 'doing');
      check('a card dropped on Doing shows there at once', await waitFor(column('7', 'doing'), 6000));
      check('the header reads 1 queued', await waitFor(`${PILL}==='1 queued'`, 6000), await ev(PILL));

      // a reload replays the queue
      await send('Page.reload');
      check('after a reload the card is still in Doing', await waitFor(`${NAME}==='fixture'&&${column('7', 'doing')}`, 15000));
      check('and the header still reads 1 queued', await waitFor(`${PILL}==='1 queued'`, 6000), await ev(PILL));

      // the doing gate: refused in the page as it is at the desk
      const desk = makeRoute(built.fixture.dir)('PATCH', '/api/cards/6', { status: 'doing' });
      check('the desk refuses a card that waits on others (the reference)', desk.status === 422 && /waiting/i.test(desk.body.error), JSON.stringify(desk.body));
      await drop('6', 'doing');
      check('the drop is refused with the toast the desk shows', await waitFor(`/^#6 is waiting on #2 \\(doing\\), #3 \\(todo\\) — can't move to doing\\.$/.test(${TOAST})`, 6000), await ev(TOAST));
      check('the card stays in Todo', await ev(column('6', 'todo')));
      const refused = await ev(`window.kanbanSourceInUse.request('PATCH','/api/cards/6',{status:'doing'}).then((r)=>JSON.stringify({status:r.status,error:r.json&&r.json.error}))`);
      check('the page source refuses the same save with the desk\'s own status and message', refused === JSON.stringify({ status: 422, error: desk.body.error }), refused);
      check('a refused save is not queued', (await ev(PILL)) === '1 queued', await ev(PILL));

      // Copy changes
      await ev(`Object.defineProperty(navigator,'clipboard',{value:{writeText:async(t)=>{window.__copied=t}},configurable:true})`);
      await ev(`document.getElementById('copy-changes-btn').click()`);
      check('Copy changes puts the payload on the clipboard', await waitFor(`typeof window.__copied==='string'`, 4000));
      const copied = (await ev('window.__copied')) || '';
      const [head, ...rest] = copied.split('\n');
      check('its header names the board, the Base and the count', head === `Apply kanban changes (board "fixture", base ${built.fixture.board.base}, 1 change):`, head);
      let records = null;
      try { records = JSON.parse(rest.join('\n')); } catch (e) { /* checked below */ }
      check('its records hold { method, path, body }', !!records && records.length === 1 && JSON.stringify(records[0].change) === JSON.stringify({ method: 'PATCH', path: '/api/cards/7', body: { status: 'doing' } }), rest.join('\n').slice(0, 200));

      // a second file, built from another board, shares the browser and none of the queue
      check('the second file opens', await load('plan'));
      check('it shows none of the first file\'s queued changes', (await ev(PILL)) === '' && (await ev(column('7', 'todo'))), await ev(PILL));
      await drop('7', 'done');
      check('it queues its own move', await waitFor(`${column('7', 'done')}&&${PILL}==='1 queued'`, 6000), await ev(PILL));
      check('the two boards keep their queues under two keys', JSON.stringify(await ev(`Object.keys(localStorage).filter((k)=>k.startsWith('kanban-tray:')).sort()`)) === JSON.stringify([`kanban-tray:${built.fixture.board.id}`, `kanban-tray:${built.plan.board.id}`].sort()));
      check('the first file still has only its own', await load('fixture') && await waitFor(`${PILL}==='1 queued'&&${column('7', 'doing')}`, 6000));
      check('the second file still has only its own', await load('plan') && await waitFor(`${PILL}==='1 queued'&&${column('7', 'done')}`, 6000));

      // the stores that read files by their bytes run in the browser too: the todo counts on a tile
      await load('todos');
      const counts = await waitFor(`(()=>{const b=document.querySelector('#board .card-el[data-id="7"] .card-head .card-todos');return !!b&&b.textContent==='3/4'})()`, 8000);
      check('a todo list on the todos board counts on the tile of its card, read through the Buffer shim', counts);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
