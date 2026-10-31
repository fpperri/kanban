'use strict';
// The Web built with the board inside, as a downloaded file (the artifact skill's build): one HTML file
// opened from disk with no server in its way, whose saves are answered by route over the board in the
// page and queued in browser storage. Files are built from three boards (the fixture, plan and todos boards)
// and opened in the one browser. The first draws the Board, Calendar, Gantt, Map and Graph; a card
// dropped on Doing shows there at once and the header reads 1 queued, and after a reload it is still
// there and still 1 queued; a card that waits on others is refused with the toast the desk gives, and
// the page source refuses it with the desk's own 422 message; Copy changes copies a payload whose header
// names the board and the Base and whose records hold { method, path, body }. Refresh reads "Board as of
// <time>" and tapping it says to ask Claude to apply and rebuild, without reloading; leaving the page asks
// while queued changes have not been copied (the page's askBeforeLeaving, handed a stand-in event, prevents it), and stops asking
// once Copy changes has put them on the clipboard, and asks again after the next change, one folded into a todo list's queued change as well. The second file shows none
// of the first's queued changes and queues its own; each file keeps only its own. Each step waits on what
// the page shows, never on a fixed sleep. Booting the page here is also the proof that every store runs in a
// browser, the one thing the Node tests cannot show. On the todos file, an item added, a tick and a move in
// one list leave 1 queued: one whole-list save carrying the list as the page shows it and the version of the
// list at build time; it survives a reload, and the apply writes the list as the page showed it.
//
// A fourth file, built from the notes board, makes a card in the page: its tile reads n1 with a new mark and a
// dashed outline, a child of n1 and a note on it both queue, a reload shows all three under the same ids, and
// applying the copied payload to the board gives the card a real id and puts it in the child's parent and the
// note's target. Removing n1 from the queue asks first, naming the 2 more queued changes that name it, and
// takes all three out of the page.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): askBeforeLeaving, state, todosUi.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');
const { makeRoute } = require('../../../../plugin/skills/web/scripts/route');
const { applyTray, parseTray } = require('../../../../plugin/skills/web/scripts/apply-tray');
const { VIEWS } = require('./smoke');

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const NAME = `document.getElementById('project-name').textContent`;
const PILL = `(()=>{const p=document.getElementById('queued-pill');return p.classList.contains('hidden')?'':p.textContent})()`;
const TOAST = `document.getElementById('toast').textContent`;
const column = (id, col) => `!!document.querySelector('#board .column[data-col="${col}"] .card-el[data-id="${id}"]')`;
const LIST_READY = `(()=>{const a=document.querySelector('#notes-palette .td-add');return !!a&&!a.disabled})()`;
const LIST_TEXTS = `[...document.querySelectorAll('#notes-palette .td-row')].map((r)=>r.querySelector('.td-text')?r.querySelector('.td-text').textContent:'(editing)')`;
const DRAWN = `document.querySelectorAll('#board .column .card-el').length>0`;

module.exports = {
  name: 'artifact',
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-scenario-'));
    try {
      const built = {};
      for (const key of ['fixture', 'plan', 'todos', 'notes']) {
        const dir = materialize(key, path.join(root, `board-${key}`, '.kanban'));
        const { html, board } = buildPage({ boardDir: dir });
        const file = path.join(root, `${key}.html`);
        fs.writeFileSync(file, html);
        built[key] = { dir, file, board, url: fileUrl(file) };
      }
      // This scenario leaves pages that hold queued changes on purpose; the page's prompt is not what it checks there.
      const stayPut = () => ev(`window.askBeforeLeaving&&window.removeEventListener('beforeunload',window.askBeforeLeaving)`);
      const load = async (key, query = '', ready = DRAWN) => {
        await stayPut();
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
      await stayPut();
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
      check('the two boards keep their queues under two keys', JSON.stringify(await ev(`Object.keys(localStorage).filter((k)=>k.startsWith('kanban-tray:')).sort()`)) === JSON.stringify([`kanban-tray:${built.fixture.board.id}:${built.fixture.board.base}`, `kanban-tray:${built.plan.board.id}:${built.plan.board.base}`].sort()));
      check('the first file still has only its own', await load('fixture') && await waitFor(`${PILL}==='1 queued'&&${column('7', 'doing')}`, 6000));
      check('the second file still has only its own', await load('plan') && await waitFor(`${PILL}==='1 queued'&&${column('7', 'done')}`, 6000));

      // the stores that read files by their bytes run in the browser too: the todo counts on a tile
      await load('todos');
      const counts = await waitFor(`(()=>{const b=document.querySelector('#board .card-el[data-id="7"] .card-head .card-todos');return !!b&&b.textContent==='3/4'})()`, 8000);
      check('a todo list on the todos board counts on the tile of its card, read through the Buffer shim', counts);

      // three edits to one todo list queue as one whole-list save, which the apply lands as the page showed it
      await load('todos');
      await ev('localStorage.clear()');
      check('the todos file opens with no queued change', await load('todos') && (await ev(PILL)) === '');
      await clickOn('#board .card-el[data-id="7"] .card-head .card-todos');
      check('the count opens the Todos tab', await waitFor(LIST_READY, 6000));
      const textsAre = (list, ms) => waitFor(`JSON.stringify(${LIST_TEXTS})===${JSON.stringify(JSON.stringify(list))}`, ms || 8000);
      const idle = () => waitFor('todosUi.pending===0', 8000);
      await ev(`(()=>{const t=document.querySelector('#notes-palette .td-add');t.focus();t.value='write the release note';t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
      await idle();
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      check('edit 1: an added item shows in the list', await textsAre(['check the enum renames', 'run the migration dry run', 'update the changelog', 'note the breaking rename', 'write the release note']));
      check('after the first edit the header reads 1 queued', await waitFor(`${PILL}==='1 queued'`, 6000), await ev(PILL));
      await idle();
      await page.key('ArrowDown');
      await idle();
      await page.key(' ');
      check('edit 2: a ticked item is struck', await waitFor(`document.querySelector('#notes-palette .td-row').classList.contains('done')`, 6000));
      await idle();
      await page.key('ArrowDown', { alt: true });
      check('edit 3: the moved item sits below its sibling', await textsAre(['run the migration dry run', 'check the enum renames', 'update the changelog', 'note the breaking rename', 'write the release note']));
      await idle();
      check('three edits to the list leave 1 queued', (await ev(PILL)) === '1 queued', await ev(PILL));

      const shown = '# Before the handoff\n- [x] run the migration dry run\n- [x] check the enum renames\n- [ ] update the changelog\n  - [ ] note the breaking rename\n- [ ] write the release note\n';
      const trayKey = `kanban-tray:${built.todos.board.id}:${built.todos.board.base}`;
      const trayRecords = async () => JSON.parse(await ev(`localStorage.getItem(${JSON.stringify(trayKey)})`)).records;
      const read = makeRoute(built.todos.dir)('GET', '/api/todos/7').body.todos;
      const queued = await trayRecords();
      check('the tray holds one record for the list', queued.length === 1, JSON.stringify(queued).slice(0, 300));
      check('it is one whole-list save carrying the list as the page showed it and the version read at build time',
        JSON.stringify(queued[0].change) === JSON.stringify({ method: 'PUT', path: '/api/todos/7', body: { text: shown, version: read.version } }), JSON.stringify(queued[0].change).slice(0, 400));

      await stayPut();
      await send('Page.reload');
      check('after a reload the header still reads 1 queued', await waitFor(`${NAME}==='todos'&&${PILL}==='1 queued'`, 15000), await ev(PILL));
      await clickOn('#board .card-el[data-id="7"] .card-head .card-todos');
      check('and the list is as the page showed it', await waitFor(LIST_READY, 6000) && await textsAre(['run the migration dry run', 'check the enum renames', 'update the changelog', 'note the breaking rename', 'write the release note']));

      const applied = applyTray({ dir: built.todos.dir, records: await trayRecords() });
      const onDisk = fs.readFileSync(path.join(built.todos.dir, '.scratchpad', '0007.todo.md'), 'utf8').replace(/\r\n/g, '\n');
      check('the apply writes the list as the page showed it', applied.refused.length === 0 && applied.applied.length === 1 && onDisk === shown, JSON.stringify(applied));

      // a card made in the page has a temporary id that later saves can name
      const TILE = (id) => `#board .card-el[data-id="${id}"]`;
      const RECORDS = `JSON.stringify(window.kanbanSourceInUse.records().map((r)=>[r.temp||null,r.change.method,r.change.path,r.change.body.parent||r.change.body.target||null]))`;
      const MODAL_UP = `!document.getElementById('modal').classList.contains('hidden')`;
      const submitCard = (title) => ev(`(()=>{const t=document.getElementById('f-title');t.value=${JSON.stringify(title)};t.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('card-form').requestSubmit();return true})()`);
      const menuItem = async (id, item) => {
        await page.rightClick(TILE(id));
        await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')&&!document.getElementById(${JSON.stringify(item)}).classList.contains('hidden')`, 3000);
        await ev(`document.getElementById(${JSON.stringify(item)}).click()`);
      };
      await load('notes');
      await ev(`document.getElementById('new-btn').click()`);
      check('the New card form opens in the page', await waitFor(`${MODAL_UP}&&document.getElementById('f-id').value===''`, 3000));
      await submitCard('Made in the page');
      check('the new card shows at once under the id n1', await waitFor(`!!document.querySelector('${TILE('n1')}')`, 6000));
      check('its tile reads n1 with a new mark', await ev(`(()=>{const t=document.querySelector('${TILE('n1')}');return t.querySelector('.card-id').textContent==='n1'&&!!t.querySelector('.new-mark')&&t.querySelector('.new-mark').textContent==='new'})()`));
      check('and a dashed outline', await ev(`getComputedStyle(document.querySelector('${TILE('n1')}')).borderTopStyle==='dashed'`));
      check('a card on the board has neither', await ev(`(()=>{const t=document.querySelector('${TILE('3')}');return !!t&&!t.querySelector('.new-mark')&&getComputedStyle(t).borderTopStyle!=='dashed'&&t.querySelector('.card-id').textContent.startsWith('#')})()`));
      check('the header reads 1 queued', await waitFor(`${PILL}==='1 queued'`, 6000), await ev(PILL));

      await menuItem('n1', 'ctx-child');
      check('Add child... on n1 opens the form under n1', await waitFor(`${MODAL_UP}&&document.getElementById('modal-title').textContent==='New card under #n1'&&document.getElementById('f-parent').value==='n1'`, 3000), await ev(`document.getElementById('modal-title').textContent`));
      await submitCard('A child of n1');
      check('the child shows under the next temporary id with n1 as its parent', await waitFor(`state.active.some((c)=>c.id==='n2'&&c.parent==='n1')`, 6000));
      check('the header reads 2 queued', await waitFor(`${PILL}==='2 queued'`, 6000), await ev(PILL));

      await menuItem('n1', 'ctx-note');
      check('Add note on n1 opens the palette on it', await waitFor(`!document.getElementById('notes-palette').classList.contains('hidden')&&document.querySelector('#notes-palette .np-chip-text').textContent.startsWith('#n1')`, 3000), await ev(`document.querySelector('#notes-palette .np-chip-text').textContent`));
      await ev(`(()=>{const i=document.querySelector('#notes-palette .np-input');i.value='a note on n1';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return true})()`);
      await page.key('Enter');
      check('the note is filed under n1', await waitFor(`state.logbook.notes.some((n)=>n.target==='n1'&&n.note==='a note on n1')`, 6000));
      check('the header reads 3 queued', await waitFor(`${PILL}==='3 queued'`, 6000), await ev(PILL));
      check('the queue holds the card, the child naming n1 and the note naming n1', (await ev(RECORDS)) === JSON.stringify([['n1', 'POST', '/api/cards', null], ['n2', 'POST', '/api/cards', 'n1'], [null, 'POST', '/api/notes', 'n1']]), await ev(RECORDS));
      await ev(`document.querySelector('#notes-palette .np-input').blur()`);
      await page.key('Escape');

      await send('Page.reload');
      check('after a reload the card and its child are still n1 and n2', await waitFor(`${NAME}==='notes'&&!!document.querySelector('${TILE('n1')}')&&!!document.querySelector('${TILE('n2')}')&&state.active.find((c)=>c.id==='n2').parent==='n1'`, 15000));
      check('and the note, and the count', await waitFor(`state.logbook.notes.some((n)=>n.target==='n1')&&${PILL}==='3 queued'`, 6000), await ev(PILL));

      // the apply gives it a real id and puts that id where n1 was named
      const payload = await ev('window.kanbanSourceInUse.payload()');
      const report = applyTray({ dir: built.notes.dir, records: parseTray(payload) });
      check('the apply takes all three saves', report.applied.length === 3 && report.refused.length === 0, JSON.stringify(report));
      const [realParent, realChild] = [report.temp.n1, report.temp.n2];
      check('and gives n1 and n2 real ids of the board', /^\d+$/.test(realParent) && /^\d+$/.test(realChild) && realParent !== realChild, JSON.stringify(report.temp));
      const board = makeRoute(built.notes.dir)('GET', '/api/board').body;
      check('the child on the board has the real id of the card as its parent', board.active.some((c) => c.id === realChild && c.parent === realParent && c.title === 'A child of n1'));
      check('the note is filed under the real id', board.logbook.notes.some((n) => n.target === realParent && n.note === 'a note on n1'));

      // removing n1 from the queue takes what names it along, after a confirm that says how many
      await ev(`document.querySelector('${TILE('n1')}').click()`);
      check('the details of n1 say it is queued and offer to remove it', await waitFor(`!document.getElementById('detail-modal').classList.contains('hidden')&&!document.getElementById('detail-queued').classList.contains('hidden')&&document.getElementById('detail-queued-id').textContent==='n1'`, 4000));
      await ev(`(()=>{window.__asked=[];window.confirm=(m)=>{window.__asked.push(m);return false};return true})()`);
      await ev(`document.getElementById('detail-unqueue-btn').click()`);
      check('the confirm names the 2 more changes that name n1', await waitFor(`window.__asked.length===1`, 3000) && JSON.stringify(await ev('window.__asked')) === JSON.stringify(['Remove n1 from the queue? 2 more queued changes name it and go too.']), JSON.stringify(await ev('window.__asked')));
      check('declining removes nothing', (await ev(PILL)) === '3 queued' && (await ev(`!!document.querySelector('${TILE('n1')}')`)));
      await ev(`window.confirm=(m)=>{window.__asked.push(m);return true}`);
      await ev(`document.getElementById('detail-unqueue-btn').click()`);
      check('accepting takes n1, its child and its note out of the page', await waitFor(`!document.querySelector('${TILE('n1')}')&&!document.querySelector('${TILE('n2')}')&&!state.logbook.notes.some((n)=>n.target==='n1')`, 6000));
      check('and the queue is empty', await waitFor(`${PILL}===''`, 6000), await ev(PILL));
      check('the details have closed', await ev(`document.getElementById('detail-modal').classList.contains('hidden')`));

      // the cue and the leaving guard: Refresh wears the Base, and a queue that was not copied asks before leaving
      const ASKS = `(()=>{const e={defaultPrevented:false,returnValue:'',preventDefault(){this.defaultPrevented=true}};askBeforeLeaving(e);return e.defaultPrevented})()`;
      const REFRESH = `document.querySelector('#refresh-btn .btn-label').textContent`;
      await ev('localStorage.clear()');
      await load('fixture');
      check('a fresh file has no queued change and leaving asks nothing', (await ev(PILL)) === '' && (await ev(ASKS)) === false);
      await drop('7', 'doing');
      check('a move is queued', await waitFor(`${PILL}==='1 queued'`, 6000));
      check('Refresh reads "Board as of <time>"', /^Board as of (\d\d:\d\d|\d{4}-\d\d-\d\d \d\d:\d\d)$/.test(await ev(REFRESH)), await ev(REFRESH));
      check('the phone menu says the same', (await ev(`document.getElementById('more-refresh').textContent`)) === (await ev(REFRESH)));
      await ev(`document.getElementById('refresh-btn').click()`);
      check('tapping it says to ask Claude to apply and rebuild', await waitFor(`/ask claude to apply/i.test(${TOAST})&&/rebuild/i.test(${TOAST})`, 4000), await ev(TOAST));
      check('and the page is as it was', (await ev(PILL)) === '1 queued' && (await ev(column('7', 'doing'))));
      check('no save is in flight, so there is no mark', await ev(`document.getElementById('saving-mark').classList.contains('hidden')`));
      check('leaving asks while a queued change has not been copied', (await ev(ASKS)) === true);
      await ev(`Object.defineProperty(navigator,'clipboard',{value:{writeText:async(t)=>{window.__copied=t}},configurable:true})`);
      await ev(`document.getElementById('copy-changes-btn').click()`);
      check('after Copy changes leaving asks nothing', await waitFor(`typeof window.__copied==='string'&&!(${ASKS})`, 4000));
      await drop('7', 'done');
      check('a change made after the copy asks again', await waitFor(`${PILL}==='2 queued'`, 6000) && (await ev(ASKS)) === true);

      // an edit folded into a todo list's one queued change is still a change since the last copy
      await ev('localStorage.clear()');
      check('the todos file opens with no queued change again', await load('todos') && (await ev(PILL)) === '');
      await clickOn('#board .card-el[data-id="7"] .card-head .card-todos');
      check('the count opens the Todos tab again', await waitFor(LIST_READY, 6000));
      const addItem = async (text) => {
        await ev(`(()=>{const t=document.querySelector('#notes-palette .td-add');t.focus();t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        await idle();
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        return waitFor(`${LIST_TEXTS}.includes(${JSON.stringify(text)})`, 8000);
      };
      check('an item added to the list is queued', await addItem('first copy') && await waitFor(`${PILL}==='1 queued'`, 6000), await ev(PILL));
      await idle();
      check('leaving asks before the list was copied', (await ev(ASKS)) === true);
      await ev(`Object.defineProperty(navigator,'clipboard',{value:{writeText:async(t)=>{window.__copied=t}},configurable:true})`);
      await ev(`document.getElementById('copy-changes-btn').click()`);
      check('after Copy changes leaving asks nothing', await waitFor(`typeof window.__copied==='string'&&!(${ASKS})`, 4000));
      check('another item added to the same list', await addItem('after the copy'));
      await idle();
      check('the list is still one queued change', (await ev(PILL)) === '1 queued', await ev(PILL));
      check('and leaving asks again, the count being the same', (await ev(ASKS)) === true);
      await stayPut();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
