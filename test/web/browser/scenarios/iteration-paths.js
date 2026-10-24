'use strict';
// The logbook and scratchpad paths that name the iteration (docs/adr/0019), on the iterlog board (the
// groups board whose logbook: is logbook/<iteration> and scratchpad: is .pads/<iteration>; card 7 is in
// the iteration I2, 2026-10-12 to 2026-10-23). A note written for a day inside the iteration lands in the
// iteration's folder, named as its group file is; one for a day outside it lands in the folder with the
// segment dropped; the note the board already had there stays listed, and a card's notes list shows both
// days. A scratchpad for a card in an iteration is written in that iteration's folder and reads back from
// it. The gear's path for the logbook is the path as written. Each step waits on the page or on the
// file, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): state.

const fs = require('fs');
const path = require('path');

const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const SECTIONS = `[...document.querySelectorAll('#notes-palette .np-ngroup')].map((g)=>[g.dataset.day,g.dataset.target,g.querySelectorAll('.np-note').length].join('|'))`;
const send = (method, url, body) => `fetch(${JSON.stringify(url)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(body)})}).then((r)=>r.json().then((j)=>({status:r.status,json:j})))`;

module.exports = {
  name: 'iteration-paths',
  board: 'iterlog',
  timeoutMs: 60000,
  async run(page) {
    const { ev, open, waitFor, centre, click, check } = page;
    const boardReady = (ms) => waitFor(`document.querySelectorAll('#board .card-el').length>20`, ms || 10000);

    await open('/?view=board');
    check('iteration-paths: the board is drawn with the logbook path as written and the note it already had', await boardReady() && await ev(`state.logbook&&state.logbook.folder==='logbook/<iteration>'&&state.logbook.notes.length===1`));
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);

    const inside = await ev(send('POST', '/api/notes', { day: '2026-10-16', target: '7', at: '10:00', note: 'inside the iteration' }));
    const outside = await ev(send('POST', '/api/notes', { day: '2026-11-20', target: '7', at: '10:00', note: 'outside every iteration' }));
    check('iteration-paths: both notes are written', inside.status === 201 && outside.status === 201, JSON.stringify([inside, outside]));
    check('iteration-paths: the note inside the iteration is in the iteration\'s folder', fs.existsSync(path.join(boardDir, 'logbook', 'I0002.zephyr-2', '2026.10.16.0007.logbook.md')));
    check('iteration-paths: the note outside every iteration is in the folder with the segment dropped', fs.existsSync(path.join(boardDir, 'logbook', '2026.11.20.0007.logbook.md')));
    check('iteration-paths: the notes name the file they are in', inside.json.note.file === 'I0002.zephyr-2/2026.10.16.0007.logbook.md' && outside.json.note.file === '2026.11.20.0007.logbook.md', JSON.stringify([inside.json.note.file, outside.json.note.file]));

    await open('/?view=board');
    check('iteration-paths: the board lists all three notes', await boardReady() && await waitFor(`state.logbook.notes.length===3`, 4000));
    check('iteration-paths: card 7 wears the count of its two notes', await waitFor(`document.querySelector('#board .card-el[data-id="7"] .card-notes').textContent==='2'`, 4000));
    const count = await centre('#board .card-el[data-id="7"] .card-notes');
    await click(count.x, count.y);
    check('iteration-paths: the card\'s notes list shows both days, newest first', await waitFor(PAL_UP, 3000) && await waitFor(`JSON.stringify(${SECTIONS})===${JSON.stringify(JSON.stringify(['2026-11-20|7|1', '2026-10-16|7|1']))}`, 3000), await ev(SECTIONS));

    const pad = await ev(send('PUT', '/api/scratchpad/7', { body: 'iteration page' }));
    check('iteration-paths: a card\'s scratchpad is written in its iteration\'s folder', pad.status === 200 && fs.existsSync(path.join(boardDir, '.pads', 'I0002.zephyr-2', '0007.scratchpad.md')), JSON.stringify(pad));
    check('iteration-paths: the page names the folder it sits in and reads back from there', pad.json.pad.folder === '.pads/I0002.zephyr-2' && await ev(`fetch('/api/scratchpad/7').then((r)=>r.json()).then((d)=>d.pad.body)`) === 'iteration page');
    check('iteration-paths: the board payload lists the page', await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.scratchpad.folder==='.pads/<iteration>'&&d.scratchpad.targets.includes('7'))`));

    check('iteration-paths: the gear\'s path for the logbook is the path as written', await ev(`/logbook[\\\\/]<iteration>$/.test(state.settings.paths.logbook)`), await ev(`state.settings.paths.logbook`));
  },
};
