'use strict';
// What a Snapshot carries and what the page refuses (the artifact skill's build, opened from disk). The
// groups board is built with the query `#3 | #5`, so two live cards come along and the archive and every
// other card stay out. The header says the query. The loose group _1 lists cards 5 and 17; 17 is left out
// and the group still shows two members, 17 as an id with no card behind it. A group's delete popup
// starts with every option unticked. The gear shows locked with "a desk job" on a feature page (Logbook)
// and on a page with no feature (Types), and a settings save queues nothing. Opening the notifications
// asks to mark them read, which the page refuses: the toast says so, the notification stays unread and
// the tray stays empty. A second file, built from the images board, draws every picture of card 25 as its
// alt text, with no request for a picture it does not hold. Each step waits on what the page shows,
// never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): state.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const NAME = `document.getElementById('project-name').textContent`;
const PILL = `(()=>{const p=document.getElementById('queued-pill');return p.classList.contains('hidden')?'':p.textContent})()`;
const TOAST = `document.getElementById('toast').textContent`;
const QUERY = `(()=>{const q=document.getElementById('snapshot-query');return q.classList.contains('hidden')?'':q.textContent})()`;
const DRAWN = `document.querySelectorAll('#board .column .card-el').length>0`;
const TRAYS = `Object.keys(localStorage).filter((k)=>k.startsWith('kanban-tray:')).length`;
const press = (sel) => `(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`;
const pageText = (sel) => `(document.querySelector(${JSON.stringify(sel)})||{textContent:''}).textContent`;

module.exports = {
  name: 'artifact-snapshot',
  board: 'groups',
  timeoutMs: 100000,
  async run(page) {
    const { ev, waitFor, check, send } = page;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-snapshot-'));
    try {
      const groups = materialize('groups', path.join(root, 'board-groups', '.kanban'));
      fs.writeFileSync(path.join(groups, 'notifications.md'), '- id: 1\n  at: 2026-10-30T10:00:00\n  from: "workflow:#3"\n  level: info\n  message: "Card #3 closed."\n  read: false\n');
      const images = materialize('images', path.join(root, 'board-images', '.kanban'));
      const built = {};
      for (const [key, dir, options] of [['groups', groups, { query: '#3 | #5' }], ['images', images, {}]]) {
        const { html } = buildPage({ boardDir: dir, ...options });
        const file = path.join(root, `${key}.html`);
        fs.writeFileSync(file, html);
        built[key] = fileUrl(file);
      }
      const load = async (key, query = '', ready = DRAWN) => {
        await send('Page.navigate', { url: built[key] + query });
        return waitFor(`document.readyState==='complete'&&${NAME}===${JSON.stringify(key)}&&${ready}`, 15000);
      };

      await load('groups');
      await ev('localStorage.clear()');

      // the query picks the cards, and the header says it
      check('the file opens and draws the board', await load('groups'));
      check('only the two cards the query names are in the page, and no archived card', await ev(`state.active.map((c)=>c.id).sort().join()==='3,5'&&state.archived.length===0`), await ev(`state.active.map((c)=>c.id).join()`));
      check('the header shows the query', (await ev(QUERY)) === '#3 | #5 · live cards only', await ev(QUERY));
      check('a card the query left out is not on the board', await ev(`document.querySelectorAll('#board .card-el[data-id="7"]').length===0&&document.querySelectorAll('#board .card-el[data-id="3"]').length===1`));

      // a group counts the member the query left out
      check('card 5 wears its loose group\'s badge', await waitFor(`!!document.querySelector('#board .card-el[data-id="5"] .group-badge[data-group-id="_1"]')`, 6000));
      await ev(press('#board .card-el[data-id="5"] .group-badge[data-group-id="_1"]'));
      check('the badge opens the group', await waitFor(`!!document.querySelector('#notes-palette .gp-members')`, 6000));
      const members = `[...document.querySelectorAll('#notes-palette .gp-sub')].map((p)=>p.textContent).find((t)=>/^Members/.test(t))`;
      check('the group shows 2 members', (await ev(members)) === 'Members (2)', await ev(members));
      check('and lists the card it carries and the id it does not', await ev(`[...document.querySelectorAll('#notes-palette .gp-members li[data-member]')].map((li)=>li.dataset.member).join()==='5,17'`));

      // every delete option starts unticked
      await ev(press('#notes-palette .gp-delete'));
      check('Delete group opens the delete popup', await waitFor(`!document.getElementById('group-dialog').classList.contains('hidden')`, 6000));
      const boxes = `[...document.querySelectorAll('#group-dialog-body input[data-del]')]`;
      check('the popup offers its options', await ev(`${boxes}.length>0`), await ev(`${boxes}.length`));
      check('every delete option starts unticked', await ev(`${boxes}.every((i)=>!i.checked)`), await ev(`${boxes}.map((i)=>i.dataset.del+':'+i.checked).join()`));
      await ev(press('#group-dialog button:not(.del-confirm)'));
      check('Cancel closes the popup and deletes nothing', await waitFor(`document.getElementById('group-dialog').classList.contains('hidden')`, 4000) && await ev(`state.groups.list.some((g)=>g.id==='_1')`));
      check('nothing was queued', (await ev(PILL)) === '' && (await ev(TRAYS)) === 0);

      // the gear is locked
      await send('Page.reload');
      check('the page is back after a reload', await waitFor(`${NAME}==='groups'&&${DRAWN}`, 15000));
      await ev(press('#prefs-btn'));
      check('the gear opens', await waitFor(`!document.getElementById('prefs-sheet').classList.contains('hidden')`, 6000));
      const pageButton = (title) => `(()=>{const b=[...document.querySelectorAll('#prefs-board-menu button')].find((x)=>x.textContent.includes(${JSON.stringify(title)}));if(!b)return false;b.click();return true})()`;
      check('the Logbook page opens', await waitFor(pageButton('Logbook'), 6000) && await waitFor(`/Logbook/.test(${pageText('#prefs-board-page .prefs-page-title')})`, 6000));
      check('it shows locked with "a desk job"', await waitFor(`/Locked\\. a desk job \\(logbook: logbook\\)/.test(${pageText('#prefs-board-page')})`, 6000), await ev(pageText('#prefs-board-page')));
      check('and its switch and folder stand still', await ev(`[...document.querySelectorAll('#prefs-board-page .prefs-opt, #prefs-board-page input[type="text"], #prefs-board-page button[type="submit"]')].every((el)=>el.disabled)`));
      check('the Types page opens', await waitFor(pageButton('Types'), 6000) && await waitFor(`/Types/.test(${pageText('#prefs-board-page .prefs-page-title')})`, 6000));
      check('it says "a desk job" too', await waitFor(`!!document.querySelector('#prefs-board-page .prefs-desk-lock')&&/Locked\\. a desk job/.test(${pageText('#prefs-board-page .prefs-desk-lock')})`, 6000), await ev(pageText('#prefs-board-page')));
      const saved = await ev(`window.kanbanSourceInUse.request('POST','/api/config',{key:'logbook',value:'other'}).then((r)=>JSON.stringify({status:r.status,error:r.json&&r.json.error}))`);
      check('a settings save answers locked, with "a desk job"', /"status":403/.test(saved) && /a desk job/.test(saved), saved);
      check('and queues nothing', (await ev(PILL)) === '' && (await ev(TRAYS)) === 0);
      await ev(press('#prefs-close'));
      await send('Page.reload');
      check('the page is back after the gear', await waitFor(`${NAME}==='groups'&&${DRAWN}`, 15000));

      // notifications are read-only
      check('the notification is unread', await ev(`state.notifications.length===1&&state.notifications[0].read===false`));
      await ev(press('#notif-btn'));
      check('opening the notifications asks to mark them read, which the page refuses with a toast', await waitFor(`/^Mark-read failed: .*a desk job/.test(${TOAST})`, 6000), await ev(TOAST));
      check('the notification stays unread', await ev(`state.notifications[0].read===false`));
      check('and nothing is queued', (await ev(PILL)) === '' && (await ev(TRAYS)) === 0);

      // pictures show their alt text
      check('the images file opens on card 25', await load('images', '?card=25', `!!document.querySelector('#detail-body p')`));
      const labels = `[...document.querySelectorAll('#detail-body .md-img-alt')].map((e)=>e.textContent).join('|')`;
      check('every picture of the body is its alt text', (await ev(labels)) === 'A good picture|A vector picture|A missing picture', await ev(labels));
      check('no picture is left in the body, and none was asked for', await ev(`document.querySelectorAll('#detail-body img').length===0&&!performance.getEntriesByType('resource').some((e)=>e.name.includes('/image'))`));
      check('the text after the pictures is drawn', await ev(`/After the pictures\\./.test(document.getElementById('detail-body').textContent)`));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};
