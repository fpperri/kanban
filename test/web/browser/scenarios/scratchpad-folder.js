'use strict';
// The Scratchpad tab with a folder beside the editor, on the padfolder board (a scratchpad: path that holds
// <card>, and card 7's own folder: its page, plan.md with a picture, build.log, notes.txt, shot.png,
// blob.bin and sub/deep.txt). The list is a column left of the editor, with the page first and selected;
// choosing a text file opens it in the same box the page uses (any extension), saved with Ctrl+Enter,
// each file keeping its own unsaved text while the selection moves between them; a .md has Preview and
// the others Edit only; a picture shows in the editor's place and a binary file shows its name, size and
// Copy path; Rename or move and Delete (after "Sure?") act on the selected file and are off for the page;
// New file opens the new file ready to type; unsaved text follows a rename and leaves with a delete; a save
// over a file changed on disk is a conflict with Reload, kept on that file when it arrives after the
// selection moved on;
// under 600px of tab width the list sits above the editor. Each step waits on the page or on the file,
// never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): state, scratchUi.

const fs = require('fs');
const path = require('path');

const PAL = `document.getElementById('notes-palette')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const BOX = `document.querySelector('#notes-palette .sp-text')`;
const READY = `(()=>{const t=${BOX};return !!t&&!t.disabled})()`;
const PATH = `(document.querySelector('#notes-palette .sp-path')||{textContent:''}).textContent`;
const NAMES = `[...document.querySelectorAll('#notes-palette .spf-row:not(.spf-up) .spf-name')].map((n)=>n.textContent).join()`;
const SELECTED = `[...document.querySelectorAll('#notes-palette .spf-row.on')].map((r)=>r.dataset.path).join()`;
const row = (p) => `#notes-palette .spf-row[data-path="${p}"]`;
const VIEWER = `document.querySelector('#notes-palette .sp-viewer')`;
const STATUS = `document.querySelector('#notes-palette .sp-status').textContent`;
const PREVIEW = `document.querySelector('#notes-palette .sp-preview')`;
const PAGE = '0007.scratchpad.md';

module.exports = {
  name: 'scratchpad-folder',
  board: 'padfolder',
  timeoutMs: 120000,
  expectedErrors: [/status of (403 \(Forbidden\)|409 \(Conflict\)).*\/api\/scratchpad\/7\/file/],
  async run(page) {
    const { ev, open, waitFor, check, rightClick, key, shot } = page;
    const press = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b||b.disabled||b.hidden)return false;b.click();return true})()`);
    const menuUp = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    const typeInto = (sel, text) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});t.focus();t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const select = async (rel, expectPath) => {
      await press(row(rel));
      return waitFor(`${PATH}===${JSON.stringify(expectPath === undefined ? rel : expectPath)}&&(${READY}||!!${VIEWER}&&!${VIEWER}.hidden)`, 6000);
    };

    await open('/?view=board');
    check('scratchpad-folder: the board is drawn with its scratchpad', await waitFor(`document.querySelectorAll('#board .card-el').length>15&&!!state.scratchpad`, 10000));
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const folder = path.join(boardDir, '.pads', '0007.port-the-zephyr-schema');
    const onDisk = (name) => fs.readFileSync(path.join(folder, name), 'utf8');

    await rightClick('#board .card-el[data-id="7"]');
    check('scratchpad-folder: the card menu is up', await menuUp());
    await press('#ctx-scratch');
    check('scratchpad-folder: card 7\'s Scratchpad tab opens', await waitFor(READY, 4000));

    // --- the list beside the editor, the page selected ------------------------------------------------------------------------------
    check('scratchpad-folder: the list shows the page first, then the folder, then the files', await waitFor(`${NAMES}==='${PAGE},sub/,blob.bin,build.log,notes.txt,plan.md,shot.png'`, 4000), await ev(NAMES));
    check('scratchpad-folder: the page is selected, named in the header, with its refs showing', await ev(`${SELECTED}===${JSON.stringify(PAGE)}&&${PATH}.endsWith(${JSON.stringify(PAGE)})&&!document.querySelector('#notes-palette .sp-refs').hidden`), [await ev(SELECTED), await ev(PATH)]);
    const PAGE_TEXT = await ev(`${BOX}.value`);
    check('scratchpad-folder: the page\'s text is in the box', PAGE_TEXT.startsWith('check the enum renames'), PAGE_TEXT);
    check('scratchpad-folder: at the palette\'s width the list is a column left of the editor', await ev(`(()=>{const l=document.querySelector('#notes-palette .spf').getBoundingClientRect();const m=document.querySelector('#notes-palette .sp-main').getBoundingClientRect();return l.right<=m.left+1&&l.width<m.width&&Math.abs(l.top-m.top)<8})()`));
    check('scratchpad-folder: Delete, and Rename or move, are off for the page', await ev(`document.querySelector('#notes-palette .spf-delete').disabled&&document.querySelector('#notes-palette .spf-move-go').disabled`));
    await shot('scratchpad-folder-page');

    // --- a text file opens in the same box -----------------------------------------------------------------------------------------------
    check('scratchpad-folder: choosing notes.txt puts it in the box, names it, and hides the page\'s refs', await select('notes.txt') && await ev(`${BOX}.value==='first note\\n'&&${SELECTED}==='notes.txt'&&document.querySelector('#notes-palette .sp-refs').hidden`));
    check('scratchpad-folder: a .txt has Edit only: its Preview is off', await ev(`document.querySelector('#notes-palette .sp-mode:last-child').disabled`));
    await typeInto('#notes-palette .sp-text', 'edited note\n');
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: Ctrl+Enter saves the file and the status says so', await waitFor(`${STATUS}==='Saved'`, 4000) && onDisk('notes.txt') === 'edited note\n');
    check('scratchpad-folder: the page was not touched by that save', onDisk(PAGE).startsWith('check the enum renames'));

    // --- each file keeps its own unsaved text while the selection moves ---------------------------------------------------------
    await typeInto('#notes-palette .sp-text', 'draft in notes');
    await select(PAGE);
    check('scratchpad-folder: back on the page, its box holds the page\'s text', await ev(`${BOX}.value===${JSON.stringify(PAGE_TEXT)}`));
    await typeInto('#notes-palette .sp-text', 'draft in the page');
    await select('notes.txt');
    check('scratchpad-folder: notes.txt gets its own draft back', await ev(`${BOX}.value==='draft in notes'`));
    await select(PAGE);
    check('scratchpad-folder: and the page its own', await ev(`${BOX}.value==='draft in the page'`));
    await typeInto('#notes-palette .sp-text', PAGE_TEXT);
    await select('notes.txt');
    await typeInto('#notes-palette .sp-text', 'edited note\n');

    // --- another extension: a .log opens, edits and saves --------------------------------------------------------------------------
    check('scratchpad-folder: choosing build.log opens it in the box', await select('build.log') && await ev(`${BOX}.value==='build ok\\n'`));
    await typeInto('#notes-palette .sp-text', 'build ok\nbuild again\n');
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: the .log is saved to its file', await waitFor(`${STATUS}==='Saved'`, 4000) && onDisk('build.log') === 'build ok\nbuild again\n');

    // --- Markdown has Preview ---------------------------------------------------------------------------------------------------------------
    check('scratchpad-folder: choosing plan.md opens it, with Preview on', await select('plan.md') && await ev(`!document.querySelector('#notes-palette .sp-mode:last-child').disabled`));
    await press('#notes-palette .sp-mode:last-child');
    check('scratchpad-folder: Preview renders it, its own picture loading from beside it', await waitFor(`(()=>{const v=${PREVIEW};const i=v&&v.querySelector('img.md-img-pic');return !!v&&!v.hidden&&!!v.querySelector('h1')&&v.querySelector('h1').textContent==='Plan'&&!!i&&i.complete&&i.naturalWidth>0})()`, 8000));
    await shot('scratchpad-folder-markdown');
    await press('#notes-palette .sp-mode:first-child');

    // --- a picture and a binary file show in the editor's place ---------------------------------------------------------------
    check('scratchpad-folder: a png shows in the editor\'s place as a picture', await select('shot.png') && await waitFor(`(()=>{const i=${VIEWER}.querySelector('.spf-img');return !!i&&i.complete&&i.naturalWidth>0&&new URL(i.src).pathname==='/api/cards/7/image'})()`, 8000) && await ev(`document.querySelector('#notes-palette .md-edit').hidden`));
    check('scratchpad-folder: a picture has Copy path and no Delete', await ev(`!!${VIEWER}.querySelector('.spf-copy')&&document.querySelector('#notes-palette .spf-delete').disabled`));
    check('scratchpad-folder: a binary file shows its name, size and Copy path, and no box', await select('blob.bin') && await ev(`${VIEWER}.querySelector('.spf-file-name').textContent==='blob.bin'&&/B$/.test(${VIEWER}.querySelector('.np-muted').textContent)&&!!${VIEWER}.querySelector('.spf-copy')&&!${VIEWER}.querySelector('img')&&document.querySelector('#notes-palette .md-edit').hidden`));
    await shot('scratchpad-folder-binary');

    // --- unsaved text follows a rename and leaves with a delete -----------------------------------------------------------------
    const newFile = async (name) => {
      await press('#notes-palette .spf-new-file');
      await typeInto('#notes-palette .spf-ask-input', name);
      await press('#notes-palette .spf-ask-go');
      return waitFor(`${PATH}==='${name}.md'&&${READY}&&document.activeElement===${BOX}`, 6000);
    };
    const removeSelected = async (names) => {
      await press('#notes-palette .spf-delete');
      await press('#notes-palette .spf-delete');
      return waitFor(`${PATH}.endsWith(${JSON.stringify(PAGE)})&&${READY}&&!${NAMES}.includes(${JSON.stringify(names)})`, 6000);
    };
    check('scratchpad-folder: a new a.md opens', await newFile('a'));
    await typeInto('#notes-palette .sp-text', 'draft for a');
    await typeInto('#notes-palette .spf-move-input', 'b.md');
    await press('#notes-palette .spf-move-go');
    check('scratchpad-folder: renamed to b.md, the file shows b.md with the unsaved text carried to it', await waitFor(`${PATH}==='b.md'&&${SELECTED}==='b.md'&&${BOX}.value==='draft for a'`, 6000) && fs.existsSync(path.join(folder, 'b.md')) && !fs.existsSync(path.join(folder, 'a.md')));
    check('scratchpad-folder: a new a.md then opens empty, with no draft of the old a.md', await newFile('a') && await ev(`${BOX}.value===''`));
    await select('b.md');
    check('scratchpad-folder: b.md still holds its draft after the switch', await ev(`${BOX}.value==='draft for a'`));

    // --- a conflict that arrives after the selection moved on stays with its file --------------------------------------------
    await select('a.md');
    fs.writeFileSync(path.join(folder, 'a.md'), 'disk change\n');
    await typeInto('#notes-palette .sp-text', 'mine for a');
    await ev(`(()=>{window.__done=false;window.__held=new Promise((r)=>{window.__release=r});window.__fetch=window.fetch;const f=window.fetch;window.fetch=(u,o)=>(o&&o.method==='PUT'&&String(u).includes('/file')?window.__held.then(()=>f(u,o)).then((r)=>{window.__done=true;return r}):f(u,o));return true})()`);
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: the save is on its way', await waitFor(`scratchUi.saving===true`, 3000));
    check('scratchpad-folder: the selection moves to notes.txt while it is', await select('notes.txt'));
    await ev(`(()=>{window.__release();window.fetch=window.__fetch;return true})()`);
    check('scratchpad-folder: the conflict arrives', await waitFor(`window.__done===true&&scratchUi.saving===false`, 6000));
    check('scratchpad-folder: notes.txt shows no Reload and no conflict', await ev(`document.querySelector('#notes-palette .sp-reload').hidden&&${STATUS}===''`));
    await select('a.md');
    check('scratchpad-folder: a.md, selected again, shows the conflict, its Reload and its unsaved text', await ev(`!document.querySelector('#notes-palette .sp-reload').hidden&&/changed on disk/i.test(${STATUS})&&${BOX}.value==='mine for a'`));
    check('scratchpad-folder: the file on disk is still the other session text', onDisk('a.md') === 'disk change\n');
    await press('#notes-palette .sp-reload');
    check('scratchpad-folder: Reload shows a.md as it is on disk', await waitFor(`${BOX}.value==='disk change\\n'&&document.querySelector('#notes-palette .sp-reload').hidden`, 4000));

    // --- Rename and Delete wait for a file that is loading -------------------------------------------------------------------------
    await ev(`(()=>{window.__gate=new Promise((r)=>{window.__open=r});window.__fetch2=window.fetch;const f=window.fetch;window.fetch=(u,o)=>(!(o&&o.method)&&/\\/file\\?path=/.test(String(u))?window.__gate.then(()=>f(u,o)):f(u,o));return true})()`);
    await press(row('b.md'));
    check('scratchpad-folder: while b.md loads, Delete and Rename or move are off', await ev(`document.querySelector('#notes-palette .spf-delete').disabled&&document.querySelector('#notes-palette .spf-move-go').disabled&&document.querySelector('#notes-palette .spf-move-input').disabled`));
    await ev(`(()=>{window.__open();window.fetch=window.__fetch2;return true})()`);
    check('scratchpad-folder: once b.md has loaded they are on', await waitFor(`${PATH}==='b.md'&&${READY}&&!document.querySelector('#notes-palette .spf-delete').disabled`, 6000));

    // --- the drafts leave with a delete, and the test files go -------------------------------------------------------------------
    check('scratchpad-folder: deleting b.md goes back to the page', await removeSelected('b.md'));
    check('scratchpad-folder: a new b.md opens empty: the old draft went with the delete', await newFile('b') && await ev(`${BOX}.value===''`));
    check('scratchpad-folder: b.md is deleted again', await removeSelected('b.md'));
    await select('a.md');
    check('scratchpad-folder: a.md is deleted', await removeSelected('a.md'));

    // --- a new file opens ready to type; a change on disk is a conflict --------------------------------------------------------
    await press('#notes-palette .spf-new-file');
    await typeInto('#notes-palette .spf-ask-input', 'idea');
    await press('#notes-palette .spf-ask-go');
    check('scratchpad-folder: New file makes idea.md on disk, selects it, and its box has the focus', await waitFor(`${PATH}==='idea.md'&&${READY}&&document.activeElement===${BOX}`, 6000) && fs.existsSync(path.join(folder, 'idea.md')));
    await typeInto('#notes-palette .sp-text', '# Idea\n');
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: the new file saves', await waitFor(`${STATUS}==='Saved'`, 4000) && onDisk('idea.md') === '# Idea\n');
    fs.writeFileSync(path.join(folder, 'idea.md'), 'changed elsewhere\n');
    await typeInto('#notes-palette .sp-text', 'mine\n');
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: a save over a file changed since it was read is a conflict, with Reload', await waitFor(`/changed on disk/i.test(${STATUS})&&!document.querySelector('#notes-palette .sp-reload').hidden`, 4000) && onDisk('idea.md') === 'changed elsewhere\n');
    await press('#notes-palette .sp-reload');
    check('scratchpad-folder: Reload shows the file as it is now', await waitFor(`${BOX}.value==='changed elsewhere\\n'&&document.querySelector('#notes-palette .sp-reload').hidden`, 4000));

    // --- rename into the subfolder, then delete after Sure? ------------------------------------------------------------------
    await typeInto('#notes-palette .spf-move-input', 'sub/idea.md');
    await press('#notes-palette .spf-move-go');
    check('scratchpad-folder: Rename or move puts the file in sub, lists that folder and keeps it selected', await waitFor(`${NAMES}==='deep.txt,idea.md'&&${SELECTED}==='sub/idea.md'&&${PATH}==='sub/idea.md'`, 6000) && fs.existsSync(path.join(folder, 'sub', 'idea.md')) && !fs.existsSync(path.join(folder, 'idea.md')));
    await press('#notes-palette .spf-delete');
    check('scratchpad-folder: the first Delete press asks Sure? and deletes nothing', await ev(`document.querySelector('#notes-palette .spf-delete').textContent==='Sure?'`) && fs.existsSync(path.join(folder, 'sub', 'idea.md')));
    await press('#notes-palette .spf-delete');
    check('scratchpad-folder: the second press deletes it, and the editor goes back to the page', await waitFor(`${NAMES}==='deep.txt'&&${PATH}.endsWith(${JSON.stringify(PAGE)})&&${READY}`, 6000) && !fs.existsSync(path.join(folder, 'sub', 'idea.md')));
    const refused = await ev(`fetch('/api/scratchpad/7/file',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({path:'${PAGE}',version:'v'})}).then((r)=>r.status)`);
    check('scratchpad-folder: the server refuses to delete the page, and it is still there', refused === 403 && fs.existsSync(path.join(folder, PAGE)), refused);
    await press('#notes-palette .spf-up');
    check('scratchpad-folder: the up row goes back to the card folder', await waitFor(`${NAMES}.startsWith('${PAGE},sub/')`, 4000));

    // --- under 600px of tab width the list sits above the editor ------------------------------------------------------------
    await ev(`(()=>{document.querySelector('#notes-palette .sp-cq').style.width='420px';return true})()`);
    check('scratchpad-folder: in a narrow tab the list is above the editor', await waitFor(`(()=>{const l=document.querySelector('#notes-palette .spf').getBoundingClientRect();const m=document.querySelector('#notes-palette .sp-main').getBoundingClientRect();return l.bottom<=m.top+1})()`, 3000));
    await shot('scratchpad-folder-narrow');

    check('scratchpad-folder: the other files and the page are as they were', onDisk('notes.txt') === 'edited note\n' && onDisk(PAGE).startsWith('check the enum renames') && fs.existsSync(path.join(folder, 'sub', 'deep.txt')));
    await key('Escape');
    check('scratchpad-folder: Esc closes the palette', await waitFor(PAL_GONE, 3000));
  },
};
