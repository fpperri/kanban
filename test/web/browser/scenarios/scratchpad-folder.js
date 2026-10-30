'use strict';
// The Scratchpad tab's folder browser, on the padfolder board (a scratchpad: path that holds <card>, and
// card 7's own folder: its page, plan.md with a picture, build.log, shot.png and sub/deep.txt). The tab
// lists the folder with the page first; a click on a folder lists it with a way back up; a png shows as a
// picture, a .md renders (its own picture loads from beside it), a .log shows as plain text with no edit
// or delete; the page row carries no delete and the server refuses to delete it. A new .txt file is
// created, edited and saved with Ctrl+Enter, renamed into the subfolder, and deleted after a second
// "Sure?" press. Each step waits on the page or on the file, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): state.

const fs = require('fs');
const path = require('path');

const PAL = `document.getElementById('notes-palette')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const READY = `(()=>{const t=document.querySelector('#notes-palette .sp-text');return !!t&&!t.disabled})()`;
const NAMES = `[...document.querySelectorAll('#notes-palette .spf-row:not(.spf-up) .spf-name')].map((n)=>n.textContent).join()`;
const row = (p) => `#notes-palette .spf-row[data-path="${p}"]`;
const VIEW = `document.querySelector('#notes-palette .spf-view')`;

module.exports = {
  name: 'scratchpad-folder',
  board: 'padfolder',
  timeoutMs: 100000,
  expectedErrors: [/status of (403 \(Forbidden\)|409 \(Conflict\)).*\/api\/scratchpad\/7\/file/],
  async run(page) {
    const { ev, open, waitFor, check, rightClick, key, shot } = page;
    const press = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b||b.disabled||b.hidden)return false;b.click();return true})()`);
    const menuUp = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    const typeInto = (sel, text) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});t.focus();t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);

    await open('/?view=board');
    check('scratchpad-folder: the board is drawn with its scratchpad', await waitFor(`document.querySelectorAll('#board .card-el').length>15&&!!state.scratchpad`, 10000));
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const folder = path.join(boardDir, '.pads', '0007.port-the-zephyr-schema');

    await rightClick('#board .card-el[data-id="7"]');
    check('scratchpad-folder: the card menu is up', await menuUp());
    await press('#ctx-scratch');
    check('scratchpad-folder: card 7\'s Scratchpad tab opens', await waitFor(READY, 4000));

    check('scratchpad-folder: the tab lists the card\'s folder, the page first, then the folder, then the files', await waitFor(`${NAMES}==='0007.scratchpad.md,sub/,build.log,plan.md,shot.png'`, 4000), await ev(NAMES));
    check('scratchpad-folder: the page row is tagged and every row shows a size and a date', await ev(`(()=>{const r=document.querySelector(${JSON.stringify(row('0007.scratchpad.md'))});return !!r&&r.dataset.kind==='page'&&!!r.querySelector('.spf-tag')&&[...document.querySelectorAll('#notes-palette .spf-row:not(.spf-up):not(.spf-dir)')].every((x)=>/\\d/.test(x.querySelector('.spf-size').textContent)&&/^\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d$/.test(x.querySelector('.spf-date').textContent))})()`));
    await shot('scratchpad-folder-list');

    // --- a folder opens one level down, with a way back up -------------------------------------------------------------
    await press(row('sub'));
    check('scratchpad-folder: a click on sub lists it, with an up row', await waitFor(`${NAMES}==='deep.txt'&&!!document.querySelector('#notes-palette .spf-up')`, 4000), await ev(NAMES));
    check('scratchpad-folder: the crumbs name the card folder and sub', await ev(`[...document.querySelectorAll('#notes-palette .spf-crumb')].map((b)=>b.textContent).join('/')==='Card folder/sub'`));
    await press('#notes-palette .spf-up');
    check('scratchpad-folder: the up row goes back to the card folder', await waitFor(`${NAMES}==='0007.scratchpad.md,sub/,build.log,plan.md,shot.png'`, 4000));

    // --- what a click shows ----------------------------------------------------------------------------------------------------
    await press(row('shot.png'));
    check('scratchpad-folder: a png shows in the tab as a picture, loaded from the image route', await waitFor(`(()=>{const i=document.querySelector('#notes-palette .spf-img');return !!i&&i.complete&&i.naturalWidth>0&&new URL(i.src).pathname==='/api/cards/7/image'})()`, 8000));
    check('scratchpad-folder: a picture has a Copy path button and no edit, delete or move', await ev(`!!${VIEW}.querySelector('.spf-copy')&&!${VIEW}.querySelector('.spf-edit,.spf-delete,.spf-move')`));
    await press(row('plan.md'));
    check('scratchpad-folder: a .md renders read-only, its own picture loading from beside it', await waitFor(`(()=>{const m=document.querySelector('#notes-palette .spf-md');const i=m&&m.querySelector('img.md-img-pic');return !!m&&!!m.querySelector('h1')&&m.querySelector('h1').textContent==='Plan'&&!!i&&i.complete&&i.naturalWidth>0})()`, 8000));
    check('scratchpad-folder: a .md can be edited, deleted and moved', await ev(`!!${VIEW}.querySelector('.spf-edit')&&!!${VIEW}.querySelector('.spf-delete')&&!!${VIEW}.querySelector('.spf-move')`));
    await shot('scratchpad-folder-markdown');
    await press(row('build.log'));
    check('scratchpad-folder: other text shows plain, and it is view only', await waitFor(`(()=>{const p=document.querySelector('#notes-palette .spf-pre');return !!p&&p.textContent==='build ok\\n'})()`, 4000) && await ev(`!${VIEW}.querySelector('.spf-edit,.spf-delete,.spf-move')&&!!${VIEW}.querySelector('.spf-copy')`));

    // --- the page has no delete here -------------------------------------------------------------------------------------------
    await press(row('0007.scratchpad.md'));
    check('scratchpad-folder: the page row opens no file view, so it has no delete, rename or move', await ev(`!${VIEW}.querySelector('.spf-delete,.spf-move,.spf-edit')`));
    const refused = await ev(`fetch('/api/scratchpad/7/file',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({path:'0007.scratchpad.md'})}).then((r)=>r.status)`);
    check('scratchpad-folder: the server refuses to delete the page too, and the file is still there', refused === 403 && fs.existsSync(path.join(folder, '0007.scratchpad.md')), refused);

    // --- create, edit, save ------------------------------------------------------------------------------------------------------------
    await press('#notes-palette .spf-new-file');
    check('scratchpad-folder: New file asks for a name', await ev(`!document.querySelector('#notes-palette .spf-ask').hidden`));
    await typeInto('#notes-palette .spf-ask-input', 'idea.txt');
    await press('#notes-palette .spf-ask-go');
    check('scratchpad-folder: the new .txt file is made on disk and opens in its box', await waitFor(`!!document.querySelector('#notes-palette .spf-text')`, 4000) && fs.existsSync(path.join(folder, 'idea.txt')));
    check('scratchpad-folder: the list has the new file', await ev(`${NAMES}.includes('idea.txt')`));
    await typeInto('#notes-palette .spf-text', 'first thought\nsecond thought\n');
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: Ctrl+Enter saves it to the file, and the status says so', await waitFor(`!!${VIEW}.querySelector('.spf-pre')&&${VIEW}.querySelector('.spf-status').textContent==='Saved'`, 4000) && fs.readFileSync(path.join(folder, 'idea.txt'), 'utf8') === 'first thought\nsecond thought\n');

    // --- a change on disk since it was read is a conflict ----------------------------------------------------------------------
    await press('#notes-palette .spf-edit');
    check('scratchpad-folder: Edit brings the box back with the text', await waitFor(`(()=>{const t=document.querySelector('#notes-palette .spf-text');return !!t&&t.value==='first thought\\nsecond thought\\n'})()`, 4000));
    fs.writeFileSync(path.join(folder, 'idea.txt'), 'changed elsewhere\n');
    await typeInto('#notes-palette .spf-text', 'mine\n');
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: a save over a file changed since it was read is refused, with Reload offered', await waitFor(`/changed on disk/i.test(${VIEW}.querySelector('.spf-status').textContent)&&!${VIEW}.querySelector('.spf-reload').hidden`, 4000) && fs.readFileSync(path.join(folder, 'idea.txt'), 'utf8') === 'changed elsewhere\n');
    await press('#notes-palette .spf-reload');
    check('scratchpad-folder: Reload shows the file as it is now', await waitFor(`!!${VIEW}.querySelector('.spf-pre')&&${VIEW}.querySelector('.spf-pre').textContent==='changed elsewhere\\n'`, 4000));

    // --- rename into the subfolder, then delete after Sure? ---------------------------------------------------------------------
    await typeInto('#notes-palette .spf-move-input', 'sub/idea.txt');
    await press('#notes-palette .spf-move-go');
    check('scratchpad-folder: renaming to sub/idea.txt moves the file into the subfolder and lists that folder', await waitFor(`${NAMES}.includes('idea.txt')&&!${NAMES}.includes('build.log')`, 4000) && fs.existsSync(path.join(folder, 'sub', 'idea.txt')) && !fs.existsSync(path.join(folder, 'idea.txt')));
    await press('#notes-palette .spf-delete');
    check('scratchpad-folder: the first Delete press asks Sure? and deletes nothing', await ev(`${VIEW}.querySelector('.spf-delete').textContent==='Sure?'`) && fs.existsSync(path.join(folder, 'sub', 'idea.txt')));
    await press('#notes-palette .spf-delete');
    check('scratchpad-folder: the second press deletes the file and the list drops it', await waitFor(`!${NAMES}.includes('idea.txt')`, 4000) && !fs.existsSync(path.join(folder, 'sub', 'idea.txt')));
    check('scratchpad-folder: the page and the other files are untouched', fs.existsSync(path.join(folder, '0007.scratchpad.md')) && fs.existsSync(path.join(folder, 'plan.md')) && fs.existsSync(path.join(folder, 'sub', 'deep.txt')));

    await key('Escape');
    check('scratchpad-folder: Esc closes the palette', await waitFor(PAL_GONE, 3000));
  },
};
