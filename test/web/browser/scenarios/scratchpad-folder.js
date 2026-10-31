'use strict';
// The Scratchpad tab with a file explorer beside the editor, on the padfolder board (a scratchpad: path
// that holds <card>, and card 7's own folder: its page with two refs, plan.md with a picture, build.log,
// notes.txt, shot.png, blob.bin and sub/deep.txt). The explorer is a column left of the editor, both
// running to the foot of the tab; each row is one line (icon, name, size) with the date and the whole name
// in its title; the page is first and selected when the tab opens, its refs one line under the header.
// Choosing a text file opens it in the same box the page uses (any extension), saved with Ctrl+Enter, each
// file keeping its own unsaved text while the selection moves between them; a .md has Preview and the
// others Edit only; a picture shows in the editor's place and a binary file shows its name and size with
// Copy path in the header. A text file's row has a menu (right-click) with Rename (in place), Move to...
// and Delete (after "Sure?"); the page's row has none, and a picture's or a binary file's has Copy path
// only. New file and New folder open a name field in the list. Unsaved text follows a rename and leaves
// with a delete; a save over a file changed on disk is a conflict with Reload, kept on that file when it
// arrives after the selection moved on; the menu of a file still loading is off. Under 600px of tab width
// the explorer is one line above the editor and opens over it. Screenshots (--shots) are taken at the
// palette's usual width, full screen at 1920 by 1080 and at 390 wide. Each step waits on the page or on the
// file, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): state, scratchUi.

const fs = require('fs');
const path = require('path');

const PAL = `document.getElementById('notes-palette')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const BOX = `document.querySelector('#notes-palette .sp-text')`;
const READY = `(()=>{const t=${BOX};return !!t&&!t.disabled})()`;
const NAME = `(document.querySelector('#notes-palette .sp-name')||{textContent:''}).textContent`;
const WHERE = `(document.querySelector('#notes-palette .sp-head-l .sp-path')||{textContent:''}).textContent`;
const NAMES = `[...document.querySelectorAll('#notes-palette .spf-row .spf-name')].map((n)=>n.textContent).join()`;
const SELECTED = `[...document.querySelectorAll('#notes-palette .spf-row.on')].map((r)=>r.dataset.path).join()`;
const row = (p) => `#notes-palette .spf-row[data-path="${p}"]`;
const VIEWER = `document.querySelector('#notes-palette .sp-viewer')`;
const STATUS = `document.querySelector('#notes-palette .sp-status').textContent`;
const PREVIEW = `document.querySelector('#notes-palette .sp-preview')`;
const MENU = `document.querySelector('.np-menu')`;
const ACTS = `[...document.querySelectorAll('.np-menu button')].map((b)=>b.dataset.act+(b.disabled?'(off)':'')).join()`;
const act = (name) => `.np-menu button[data-act="${name}"]`;
const PAGE = '0007.scratchpad.md';

module.exports = {
  name: 'scratchpad-folder',
  board: 'padfolder',
  timeoutMs: 120000,
  expectedErrors: [/status of (403 \(Forbidden\)|409 \(Conflict\)).*\/api\/scratchpad\/7\/file/],
  async run(page) {
    const { ev, open, waitFor, check, rightClick, key, shot, send, sleep } = page;
    const press = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b||b.disabled||b.hidden)return false;b.click();return true})()`);
    const menuUp = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    const typeInto = (sel, text) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});t.focus();t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const select = async (rel, expectName) => {
      await press(row(rel));
      return waitFor(`${NAME}===${JSON.stringify(expectName === undefined ? rel.split('/').pop() : expectName)}&&(${READY}||!!${VIEWER}&&!${VIEWER}.hidden)`, 6000);
    };
    const menuOn = async (rel) => {
      await rightClick(row(rel));
      return waitFor(`!!${MENU}`, 3000);
    };
    const closeMenu = async () => { await key('Escape'); return waitFor(`!${MENU}`, 2000); };
    const metrics = (width, height, mobile) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: !!mobile });

    await open('/?view=board');
    check('scratchpad-folder: the board is drawn with its scratchpad', await waitFor(`document.querySelectorAll('#board .card-el').length>15&&!!state.scratchpad`, 10000));
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const folder = path.join(boardDir, '.pads', '0007.port-the-zephyr-schema');
    const onDisk = (name) => fs.readFileSync(path.join(folder, name), 'utf8');

    await rightClick('#board .card-el[data-id="7"]');
    check('scratchpad-folder: the card menu is up', await menuUp());
    await press('#ctx-scratch');
    check('scratchpad-folder: card 7\'s Scratchpad tab opens', await waitFor(READY, 4000));

    // --- the explorer beside the editor, the page selected ---------------------------------------------------------------------------
    check('scratchpad-folder: the list shows the page first, then the folder, then the files', await waitFor(`${NAMES}==='${PAGE},sub/,blob.bin,build.log,notes.txt,plan.md,shot.png'`, 4000), await ev(NAMES));
    check('scratchpad-folder: the page is selected and named in the header, its folder beside it with no doubled slash', await ev(`${SELECTED}===${JSON.stringify(PAGE)}&&${NAME}===${JSON.stringify(PAGE)}&&!/\\/\\//.test(${WHERE})&&${WHERE}.length>0`), [await ev(SELECTED), await ev(NAME), await ev(WHERE)]);
    check('scratchpad-folder: the page\'s refs are one compact line under the header', await ev(`(()=>{const r=document.querySelector('#notes-palette .sp-refs');const items=r.querySelectorAll('li');return !r.hidden&&items.length===2&&Math.abs(items[0].getBoundingClientRect().top-items[1].getBoundingClientRect().top)<4})()`));
    const PAGE_TEXT = await ev(`${BOX}.value`);
    check('scratchpad-folder: the page\'s text is in the box', PAGE_TEXT.startsWith('check the enum renames'), PAGE_TEXT);
    check('scratchpad-folder: the list is a column of 13 to 18rem left of the editor, and both reach the foot of the tab', await ev(`(()=>{const l=document.querySelector('#notes-palette .spf').getBoundingClientRect();const m=document.querySelector('#notes-palette .sp-main').getBoundingClientRect();const em=parseFloat(getComputedStyle(document.documentElement).fontSize);const sp=document.querySelector('#notes-palette .sp-split').getBoundingClientRect();return l.right<=m.left+1&&l.width>=12.5*em&&l.width<=18.5*em&&Math.abs(l.bottom-sp.bottom)<3&&Math.abs(m.bottom-sp.bottom)<3&&Math.abs(l.top-m.top)<8})()`));
    check('scratchpad-folder: every row is one line, the name not wrapped', await ev(`[...document.querySelectorAll('#notes-palette .spf-row')].every((r)=>r.getBoundingClientRect().height<30)`));
    check('scratchpad-folder: a row\'s title holds the whole name, the size and the date', await ev(`/^notes\\.txt\\n\\d+ B\\n\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d$/.test(document.querySelector(${JSON.stringify(row('notes.txt'))}).title)`));
    check('scratchpad-folder: the editor box is tall: at least 12rem', await ev(`${BOX}.getBoundingClientRect().height>=12*parseFloat(getComputedStyle(document.body).fontSize)`));
    await shot('scratchpad-folder-usual');

    // --- the page has no menu; a picture and a binary file have Copy path only ---------------------------------------------------
    await rightClick(row(PAGE));
    await sleep(400);
    check('scratchpad-folder: the row of the page opens no menu', await ev(`!${MENU}`));
    check('scratchpad-folder: a picture\'s row offers Copy path only', await menuOn('shot.png') && await ev(`${ACTS}==='copy'`) && await closeMenu());
    check('scratchpad-folder: a binary file\'s row offers Copy path only', await menuOn('blob.bin') && await ev(`${ACTS}==='copy'`) && await closeMenu());
    check('scratchpad-folder: a text file\'s row offers Rename, Move to and Delete, and the Menu key opens it too', await menuOn('notes.txt') && await ev(`${ACTS}==='rename,move,remove'`) && await closeMenu());
    await ev(`document.querySelector(${JSON.stringify(row('notes.txt'))}).focus()`);
    await key('F10', { shift: true });
    check('scratchpad-folder: Shift+F10 on a focused row opens its menu', await waitFor(`!!${MENU}`, 3000) && await ev(`${ACTS}==='rename,move,remove'`) && await closeMenu());

    // --- a text file opens in the same box ------------------------------------------------------------------------------------------------
    check('scratchpad-folder: choosing notes.txt puts it in the box, names it, and hides the page\'s refs', await select('notes.txt') && await ev(`${BOX}.value==='first note\\n'&&${SELECTED}==='notes.txt'&&document.querySelector('#notes-palette .sp-refs').hidden`));
    check('scratchpad-folder: a .txt has Edit only: its Preview is off', await ev(`document.querySelector('#notes-palette .sp-mode:last-child').disabled`));
    await typeInto('#notes-palette .sp-text', 'edited note\n');
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: Ctrl+Enter saves the file and the status says so', await waitFor(`${STATUS}==='Saved'`, 4000) && onDisk('notes.txt') === 'edited note\n');
    check('scratchpad-folder: the page was not touched by that save', onDisk(PAGE).includes('check the enum renames') && onDisk(PAGE).startsWith('---'));

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

    // --- the explorer folds away: the editor takes the width; the selection, draft and conflict stay -------------------------------
    const FOLD = `document.querySelector('#notes-palette .spf-fold')`;
    const UNFOLD = `document.querySelector('#notes-palette .sp-unfold')`;
    const LIST_SHOWN = `getComputedStyle(document.querySelector('#notes-palette .spf')).display!=='none'`;
    const WIDE = `(()=>{const sp=document.querySelector('#notes-palette .sp-split').getBoundingClientRect();const m=document.querySelector('#notes-palette .sp-main').getBoundingClientRect();return Math.abs(m.width-sp.width)<=4&&Math.abs(m.left-sp.left)<=4})()`;
    await typeInto('#notes-palette .sp-text', 'fold draft');
    check('scratchpad-folder: the explorer\'s fold button is a small arrow with a title, and says it is expanded', await ev(`${FOLD}.textContent==='‹'&&${FOLD}.title==='Hide the file list'&&${FOLD}.getAttribute('aria-expanded')==='true'&&getComputedStyle(${FOLD}).display!=='none'`));
    check('scratchpad-folder: the Files button is not shown while the explorer is', await ev(`getComputedStyle(${UNFOLD}).display==='none'&&${UNFOLD}.getAttribute('aria-expanded')==='false'`));
    await shot('scratchpad-folder-unfolded');
    await press('#notes-palette .spf-fold');
    check('scratchpad-folder: folded, the list is gone and the editor takes the tab\'s full width', await waitFor(`!(${LIST_SHOWN})&&${WIDE}`, 3000));
    check('scratchpad-folder: folded, Files › starts the header line, says collapsed, and the open file\'s name stays', await ev(`(()=>{const u=${UNFOLD};const n=document.querySelector('#notes-palette .sp-name');return getComputedStyle(u).display!=='none'&&u.textContent==='Files ›'&&u.title==='Show the file list'&&u.getAttribute('aria-expanded')==='false'&&n.textContent==='notes.txt'&&u.getBoundingClientRect().right<=n.getBoundingClientRect().left+1&&Math.abs(u.getBoundingClientRect().top-n.getBoundingClientRect().top)<10})()`));
    check('scratchpad-folder: folding keeps the keyboard on the Files button, and the box keeps its draft', await ev(`document.activeElement===${UNFOLD}&&${BOX}.value==='fold draft'`));
    await shot('scratchpad-folder-folded');
    await press('#notes-palette .sp-unfold');
    check('scratchpad-folder: unfolded, the same folder and file are selected and the draft is still in the box', await waitFor(`${LIST_SHOWN}&&${FOLD}.getAttribute('aria-expanded')==='true'&&${SELECTED}==='notes.txt'&&${NAME}==='notes.txt'&&${BOX}.value==='fold draft'&&document.activeElement===${FOLD}`, 3000));
    await ev(`${FOLD}.focus()`);
    await key('Enter');
    check('scratchpad-folder: Enter on the fold button folds the list', await waitFor(`!(${LIST_SHOWN})&&${UNFOLD}.getAttribute('aria-expanded')==='false'`, 3000));
    await key(' ');
    check('scratchpad-folder: Space on the Files button brings it back', await waitFor(`${LIST_SHOWN}&&${FOLD}.getAttribute('aria-expanded')==='true'&&${SELECTED}==='notes.txt'`, 3000));
    await typeInto('#notes-palette .sp-text', 'edited note\n');
    await press('#notes-palette .spf-fold');
    await waitFor(`!(${LIST_SHOWN})`, 3000);
    await open('/?view=board');
    await waitFor(`document.querySelectorAll('#board .card-el').length>15&&!!state.scratchpad`, 10000);
    await rightClick('#board .card-el[data-id="7"]');
    await menuUp();
    await press('#ctx-scratch');
    check('scratchpad-folder: after a reload the explorer is still folded', await waitFor(`${READY}&&!(${LIST_SHOWN})&&${WIDE}&&${UNFOLD}.getAttribute('aria-expanded')==='false'&&${FOLD}.getAttribute('aria-expanded')==='false'`, 6000));
    await press('#notes-palette .sp-unfold');
    check('scratchpad-folder: unfolding again leaves it open, and open is what is kept', await waitFor(`${LIST_SHOWN}&&${SELECTED}===${JSON.stringify(PAGE)}`, 3000) && await ev(`localStorage.getItem('kanban.padfolder.scratchpad.folded')===null`));

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

    // --- full screen: both run to the foot of the window, the box takes all the height ----------------------------------------
    await metrics(1920, 1080);
    await press('#notes-fullscreen-btn');
    check('scratchpad-folder: full screen, the list and the editor fill the tab to the foot of the window', await waitFor(`(()=>{const p=${PAL}.getBoundingClientRect();const l=document.querySelector('#notes-palette .spf-list').getBoundingClientRect();const m=${PREVIEW}.getBoundingClientRect();return ${PAL}.classList.contains('fullscreen')&&p.height>=1070&&window.innerHeight-l.bottom<80&&window.innerHeight-m.bottom<80&&m.height>600})()`, 4000), await ev(`JSON.stringify([window.innerHeight,document.querySelector('#notes-palette .spf-list').getBoundingClientRect().bottom,${PREVIEW}.getBoundingClientRect().bottom])`));
    check('scratchpad-folder: full screen, the header is one line', await ev(`document.querySelector('#notes-palette .sp-head').getBoundingClientRect().height<40`));
    await shot('scratchpad-folder-fullscreen');
    await press('#notes-palette .spf-fold');
    check('scratchpad-folder: full screen, folded, the editor has the whole tab width', await waitFor(`!(${LIST_SHOWN})&&${WIDE}&&${PREVIEW}.getBoundingClientRect().width>1800`, 3000));
    await shot('scratchpad-folder-fullscreen-folded');
    await press('#notes-palette .sp-unfold');
    await waitFor(`${LIST_SHOWN}`, 3000);
    await press('#notes-palette .sp-mode:first-child');
    check('scratchpad-folder: full screen, the Edit box takes the height too', await waitFor(`${BOX}.getBoundingClientRect().height>600`, 3000));
    await press('#notes-fullscreen-btn');
    await metrics(1800, 1000);
    check('scratchpad-folder: back to the palette', await waitFor(`!${PAL}.classList.contains('fullscreen')`, 3000));

    // --- a picture and a binary file show in the editor's place ---------------------------------------------------------------
    check('scratchpad-folder: a png shows in the editor\'s place as a picture', await select('shot.png') && await waitFor(`(()=>{const i=${VIEWER}.querySelector('.spf-img');return !!i&&i.complete&&i.naturalWidth>0&&new URL(i.src).pathname==='/api/cards/7/image'})()`, 8000) && await ev(`document.querySelector('#notes-palette .md-edit').hidden`));
    check('scratchpad-folder: a picture has Copy path in the header and no Save', await ev(`!document.querySelector('#notes-palette .sp-copy').disabled&&document.querySelector('#notes-palette .sp-head-r').hidden`));
    check('scratchpad-folder: a binary file shows its name, size and Copy path, and no box', await select('blob.bin') && await ev(`/\\d+ B/.test(${VIEWER}.textContent)&&!${VIEWER}.querySelector('img')&&!document.querySelector('#notes-palette .sp-copy').disabled&&document.querySelector('#notes-palette .md-edit').hidden`));
    await shot('scratchpad-folder-binary');

    // --- Rename in place, Move to, Delete from the row's menu; unsaved text follows a rename and leaves with a delete ------------
    const newFile = async (name) => {
      await press('#notes-palette .spf-new-file');
      await typeInto('#notes-palette .spf-ask-input', name);
      await key('Enter');
      return waitFor(`${NAME}==='${name}.md'&&${READY}&&document.activeElement===${BOX}`, 6000);
    };
    const removeFile = async (rel, name) => {
      if (!(await menuOn(rel))) return false;
      await press(act('remove'));
      if (!(await ev(`${MENU}.querySelector('[data-act="remove"]').textContent==='Sure?'`))) return false;
      await press(act('remove'));
      return waitFor(`!${NAMES}.split(',').includes(${JSON.stringify(name)})&&!${MENU}`, 6000);
    };
    check('scratchpad-folder: + File opens a name field in the list, and Esc cancels it', await (async () => {
      await press('#notes-palette .spf-new-file');
      const up = await waitFor(`!!document.querySelector('#notes-palette .spf-list .spf-ask-input')`, 2000);
      await key('Escape');
      return up && await waitFor(`!document.querySelector('#notes-palette .spf-ask-input')`, 2000) && !(await ev(PAL_GONE));
    })());
    check('scratchpad-folder: a new a.md opens, its box focused', await newFile('a'));
    await typeInto('#notes-palette .sp-text', 'draft for a');
    check('scratchpad-folder: Rename edits the name in place in the row', await menuOn('a.md') && await press(act('rename')) && await waitFor(`!!document.querySelector('#notes-palette .spf-row .spf-rename')&&document.activeElement.classList.contains('spf-rename')`, 3000));
    await typeInto('#notes-palette .spf-rename', 'b.md');
    await key('Enter');
    check('scratchpad-folder: renamed to b.md, the file shows b.md with the unsaved text carried to it', await waitFor(`${NAME}==='b.md'&&${SELECTED}==='b.md'&&${BOX}.value==='draft for a'`, 6000) && fs.existsSync(path.join(folder, 'b.md')) && !fs.existsSync(path.join(folder, 'a.md')));
    check('scratchpad-folder: a new a.md then opens empty, with no draft of the old a.md', await newFile('a') && await ev(`${BOX}.value===''`));
    check('scratchpad-folder: Esc in the rename field leaves the name', await menuOn('a.md') && await press(act('rename')) && await waitFor(`!!document.querySelector('.spf-rename')`, 3000) && await (async () => { await typeInto('#notes-palette .spf-rename', 'zzz.md'); await key('Escape'); return waitFor(`!document.querySelector('.spf-rename')&&${NAMES}.includes('a.md')`, 2000); })() && !fs.existsSync(path.join(folder, 'zzz.md')));
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

    // --- the menu of a file that is loading is off ---------------------------------------------------------------------------------
    await ev(`(()=>{window.__gate=new Promise((r)=>{window.__open=r});window.__fetch2=window.fetch;const f=window.fetch;window.fetch=(u,o)=>(!(o&&o.method)&&/\\/file\\?path=/.test(String(u))?window.__gate.then(()=>f(u,o)):f(u,o));return true})()`);
    await press(row('b.md'));
    check('scratchpad-folder: while b.md loads, its menu is open but Rename, Move to and Delete are off', await menuOn('b.md') && await ev(`${ACTS}==='rename(off),move(off),remove(off)'`) && await closeMenu());
    await ev(`(()=>{window.__open();window.fetch=window.__fetch2;return true})()`);
    check('scratchpad-folder: once b.md has loaded its menu is on', await waitFor(`${NAME}==='b.md'&&${READY}`, 6000) && await menuOn('b.md') && await ev(`${ACTS}==='rename,move,remove'`) && await closeMenu());

    // --- the drafts leave with a delete, and the test files go -------------------------------------------------------------------
    check('scratchpad-folder: deleting b.md (Sure? then again) goes back to the page', await removeFile('b.md', 'b.md') && await waitFor(`${NAME}===${JSON.stringify(PAGE)}&&${READY}`, 4000));
    check('scratchpad-folder: a new b.md opens empty: the old draft went with the delete', await newFile('b') && await ev(`${BOX}.value===''`));
    check('scratchpad-folder: b.md is deleted again', await removeFile('b.md', 'b.md'));
    check('scratchpad-folder: a.md is deleted from its row while another file is selected', await select('notes.txt') && await removeFile('a.md', 'a.md') && await ev(`${NAME}==='notes.txt'`));

    // --- a new file opens ready to type; a change on disk is a conflict --------------------------------------------------------
    check('scratchpad-folder: + File makes idea.md on disk, selects it, and its box has the focus', await newFile('idea') && fs.existsSync(path.join(folder, 'idea.md')));
    await typeInto('#notes-palette .sp-text', '# Idea\n');
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: the new file saves', await waitFor(`${STATUS}==='Saved'`, 4000) && onDisk('idea.md') === '# Idea\n');
    fs.writeFileSync(path.join(folder, 'idea.md'), 'changed elsewhere\n');
    await typeInto('#notes-palette .sp-text', 'mine\n');
    await key('Enter', { ctrl: true });
    check('scratchpad-folder: a save over a file changed since it was read is a conflict, with Reload', await waitFor(`/changed on disk/i.test(${STATUS})&&!document.querySelector('#notes-palette .sp-reload').hidden`, 4000) && onDisk('idea.md') === 'changed elsewhere\n');
    await press('#notes-palette .sp-reload');
    check('scratchpad-folder: Reload shows the file as it is now', await waitFor(`${BOX}.value==='changed elsewhere\\n'&&document.querySelector('#notes-palette .sp-reload').hidden`, 4000));

    // --- Move to lists the parent and the subfolders of the folder shown; Delete after Sure? -----------------------------------------
    check('scratchpad-folder: Move to lists the subfolders of the folder shown', await menuOn('idea.md') && await press(act('move')) && await waitFor(`${ACTS}==='d0'`, 3000) && await ev(`document.querySelector('.np-menu button').textContent==='sub/'`));
    await press(act('d0'));
    check('scratchpad-folder: choosing sub/ moves the file into it and it stays selected', await waitFor(`!${NAMES}.split(',').includes('idea.md')&&${SELECTED}===''&&${NAME}==='idea.md'`, 6000) && fs.existsSync(path.join(folder, 'sub', 'idea.md')) && !fs.existsSync(path.join(folder, 'idea.md')));
    await press(row('sub'));
    check('scratchpad-folder: the folder sub opens, with a breadcrumb back and idea.md in it', await waitFor(`${NAMES}==='deep.txt,idea.md'&&[...document.querySelectorAll('#notes-palette .spf-crumb')].map((b)=>b.textContent).join('/')==='card folder/sub'`, 4000) && await ev(`${SELECTED}==='sub/idea.md'`));
    check('scratchpad-folder: Move to there offers the parent', await menuOn('sub/idea.md') && await press(act('move')) && await waitFor(`${ACTS}==='d0'`, 3000) && await ev(`document.querySelector('.np-menu button').textContent==='.. (up)'`) && await closeMenu());
    check('scratchpad-folder: deleting the selected idea.md goes back to the page', await removeFile('sub/idea.md', 'idea.md') && await waitFor(`${NAME}===${JSON.stringify(PAGE)}&&${READY}`, 4000) && !fs.existsSync(path.join(folder, 'sub', 'idea.md')));
    const refused = await ev(`fetch('/api/scratchpad/7/file',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({path:'${PAGE}',version:'v'})}).then((r)=>r.status)`);
    check('scratchpad-folder: the server refuses to delete the page, and it is still there', refused === 403 && fs.existsSync(path.join(folder, PAGE)), refused);
    await press('#notes-palette .spf-crumb[data-path=""]');
    check('scratchpad-folder: a click on the card folder crumb goes back up', await waitFor(`${NAMES}.startsWith('${PAGE},sub/')`, 4000));
    await press('#notes-palette .spf-new-folder');
    await typeInto('#notes-palette .spf-ask-input', 'shots');
    await key('Enter');
    check('scratchpad-folder: + Folder makes shots on disk and lists it', await waitFor(`${NAMES}.includes('shots/')`, 4000) && fs.statSync(path.join(folder, 'shots')).isDirectory());
    fs.rmdirSync(path.join(folder, 'shots'));

    // --- under 600px of tab width the explorer is one line above the editor ---------------------------------------------------
    await ev(`(()=>{document.querySelector('#notes-palette .sp-cq').style.width='420px';return true})()`);
    check('scratchpad-folder: in a narrow tab the explorer is a line above the editor, naming the selected file', await waitFor(`(()=>{const l=document.querySelector('#notes-palette .spf-pick').getBoundingClientRect();const m=document.querySelector('#notes-palette .sp-main').getBoundingClientRect();return l.width>0&&l.bottom<=m.top+1&&document.querySelector('#notes-palette .spf-pick-name').textContent===${JSON.stringify(PAGE)}&&getComputedStyle(document.querySelector('#notes-palette .spf-panel')).display==='none'})()`, 3000));
    await press('#notes-palette .spf-pick');
    check('scratchpad-folder: its arrow opens the list over the editor', await waitFor(`getComputedStyle(document.querySelector('#notes-palette .spf-panel')).display==='flex'&&document.querySelector('#notes-palette .spf-panel').getBoundingClientRect().top<document.querySelector('#notes-palette .sp-main').getBoundingClientRect().top+80`, 3000));
    await press(row('notes.txt'));
    check('scratchpad-folder: choosing a file there shuts the list and names it on the line', await waitFor(`${NAME}==='notes.txt'&&getComputedStyle(document.querySelector('#notes-palette .spf-panel')).display==='none'&&document.querySelector('#notes-palette .spf-pick-name').textContent==='notes.txt'`, 4000));
    await ev(`(()=>{document.querySelector('#notes-palette .sp-cq').style.width='';return true})()`);

    // --- a phone: 390 wide, nothing runs off the side ---------------------------------------------------------------------------------
    await metrics(390, 844, true);
    check('scratchpad-folder: at 390 wide the tab is full screen with the explorer on one line', await waitFor(`${PAL}.classList.contains('fullscreen')&&getComputedStyle(document.querySelector('#notes-palette .spf-pick')).display!=='none'`, 4000));
    check('scratchpad-folder: at 390 wide nothing runs off the side', await ev(`(()=>{const b=document.querySelector('#notes-palette .np-body');return document.documentElement.scrollWidth<=window.innerWidth&&b.scrollWidth<=b.clientWidth+1})()`));
    check('scratchpad-folder: at 390 wide the editor keeps the height', await ev(`document.querySelector('#notes-palette .sp-main').getBoundingClientRect().height>300`));
    await shot('scratchpad-folder-phone');
    await press('#notes-palette .spf-pick');
    check('scratchpad-folder: at 390 wide the list opens over the editor and fits', await waitFor(`(()=>{const r=document.querySelector('#notes-palette .spf-panel').getBoundingClientRect();return getComputedStyle(document.querySelector('#notes-palette .spf-panel')).display==='flex'&&r.right<=window.innerWidth&&r.left>=0})()`, 3000));
    await shot('scratchpad-folder-phone-list');
    await press('#notes-palette .spf-pick');
    await metrics(1800, 1000);

    check('scratchpad-folder: the other files and the page are as they were', onDisk('notes.txt') === 'edited note\n' && onDisk(PAGE).includes('check the enum renames') && fs.existsSync(path.join(folder, 'sub', 'deep.txt')));
    await key('Escape');
    check('scratchpad-folder: Esc closes the palette', await waitFor(PAL_GONE, 3000));
  },
};
