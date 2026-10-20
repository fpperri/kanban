'use strict';
// The scratchpad, on the scratchpad board (the groups board with a scratchpad: line, a page for card 7
// with three refs and one for group I2) and the scratchonly board (scratchpads on, the logbook off).
// The card menu's Scratchpad... opens the palette on a Scratchpad tab beside Notes: the file's path, its
// refs (a mention among them is a chip), and a multi-line box; Ctrl+Enter or Save writes the body and the
// refs stay in the file; unsaved text survives a tab switch; a card with no page says it is not written
// yet and Save writes it. A group's palette gets the tab after its Group tab and a Scratchpad button
// there. The gear's Scratchpad page switches the feature and its line returns between the logbook's and
// the groups'; the pages stay on disk when it is off. Deleting a card or a group offers "Its scratchpad",
// unticked: unticked the page stays, ticked it goes. With the logbook off a card opens on its scratchpad
// alone. Each step waits on the page or on the file, never on a fixed sleep.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js): state.

const fs = require('fs');
const path = require('path');

const PAL = `document.getElementById('notes-palette')`;
const PAL_UP = `!!${PAL}&&!${PAL}.classList.contains('hidden')`;
const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
const TABS = `[...document.querySelectorAll('#notes-palette .np-tab')].map((b)=>b.textContent+(b.classList.contains('on')?'*':'')).join()`;
const TEXT = `document.querySelector('#notes-palette .sp-text')`;
const READY = `(()=>{const t=${TEXT};return !!t&&!t.disabled})()`;
const PATH = `(document.querySelector('#notes-palette .sp-path')||{textContent:''}).textContent`;
const REFS = `[...document.querySelectorAll('#notes-palette .sp-ref-list li')].map((li)=>li.textContent).join(' | ')`;
const DLG = `document.getElementById('group-dialog')`;
const DLG_UP = `!${DLG}.classList.contains('hidden')`;
const DLG_GONE = `${DLG}.classList.contains('hidden')`;
const BODY = `document.getElementById('group-dialog-body')`;
const boxes = `[...${BODY}.querySelectorAll('input[data-del]')].map((i)=>i.dataset.del+':'+i.checked).join()`;
const live = (id) => `state.active.some((c)=>c.id===${JSON.stringify(id)})`;
const targets = `JSON.stringify(state.scratchpad&&state.scratchpad.targets)`;
const pad = (id) => `fetch('/api/scratchpad/${id}').then((r)=>r.json()).then((d)=>d.pad)`;

module.exports = {
  name: 'scratchpad',
  board: 'scratchpad',
  alsoBoards: ['scratchonly'],
  timeoutMs: 110000,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, rightClick, check, shot } = page;
    const press = (sel) => ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return false;b.click();return true})()`);
    const menuUp = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    const typeInto = (text) => ev(`(()=>{const t=${TEXT};t.focus();t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const openPadOf = async (id) => {
      await rightClick(`#board .card-el[data-id="${id}"]`);
      if (!(await menuUp())) return false;
      await press('#ctx-scratch');
      return waitFor(READY, 4000);
    };
    const closePalette = async () => { await key('Escape'); return waitFor(PAL_GONE, 2500); };
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };

    await open('/?view=board');
    check('scratchpad: the board is drawn with its scratchpad', await waitFor(`document.querySelectorAll('#board .card-el').length>20&&!!state.scratchpad`, 10000));
    check('scratchpad: the payload names the folder and the targets that have a page', await ev(`JSON.stringify(state.scratchpad)`) === '{"folder":".scratchpad","targets":["7","I2"]}', await ev(`JSON.stringify(state.scratchpad)`));
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const configPath = path.join(boardDir, 'config.yaml');
    const lines = () => fs.readFileSync(configPath, 'utf8').split(/\r?\n/);

    // --- the card menu opens the Scratchpad tab ------------------------------------------------------------------
    check('scratchpad: the card menu opens card 7\'s page', await openPadOf('7'));
    check('scratchpad: the tabs are Notes and Scratchpad, on Scratchpad', await ev(TABS) === 'Notes,Scratchpad*', await ev(TABS));
    check('scratchpad: it shows the file, three refs, the body, and the box has the focus', await ev(`${PATH}==='.scratchpad/0007.scratchpad.md'`) && await ev(`${REFS}==='src/orders/schema.js | 2026.10.15.I0002.logbook.md | #3'`) && await ev(`${TEXT}.value.startsWith('check the enum renames\\n- orders.status')`) && await ev(`document.activeElement===${TEXT}`), [await ev(PATH), await ev(REFS)]);
    check('scratchpad: a mention among the refs is a chip', await ev(`document.querySelectorAll('#notes-palette .sp-ref-list code.mention').length===1`));
    await shot('scratchpad-tab');

    // --- Ctrl+Enter writes the body and keeps the refs -------------------------------------------------------------------
    await typeInto('check the enum renames\nsecond line');
    await key('Enter', { ctrl: true });
    check('scratchpad: Ctrl+Enter saves, and the box says so', await waitFor(`document.querySelector('#notes-palette .sp-status').textContent==='Saved'`, 4000));
    const saved = await ev(pad('7'));
    check('scratchpad: the file holds the new body and the refs as they were', saved.body === 'check the enum renames\nsecond line' && saved.refs.length === 3, JSON.stringify(saved));
    const onDisk = fs.readFileSync(path.join(boardDir, '.scratchpad', '0007.scratchpad.md'), 'utf8');
    check('scratchpad: the frontmatter is written back as it was', /^---\r?\nrefs:\r?\n  - src\/orders\/schema\.js\r?\n/.test(onDisk) && /\r?\n\r?\ncheck the enum renames\r?\nsecond line$/.test(onDisk), JSON.stringify(onDisk));

    // --- unsaved text survives a tab switch and a closed palette ----------------------------------------------------------
    await typeInto('not saved yet');
    await clickOn('#notes-palette .np-tab[data-tab="notes"]');
    check('scratchpad: the Notes tab shows the notes box', await waitFor(`!document.querySelector('#notes-palette .np-input').hidden&&!${TEXT}`, 2500));
    await clickOn('#notes-palette .np-tab[data-tab="scratch"]');
    check('scratchpad: back on the tab the unsaved text is in the box', await waitFor(READY, 4000) && await ev(`${TEXT}.value==='not saved yet'`));
    check('scratchpad: and the file still holds the saved body', (await ev(pad('7'))).body === 'check the enum renames\nsecond line');
    check('scratchpad: Esc closes the palette', await closePalette());
    check('scratchpad: reopened, the unsaved text is still there', await openPadOf('7') && await ev(`${TEXT}.value==='not saved yet'`));
    await closePalette();

    // --- a card with no page: not written yet, Save writes it ------------------------------------------------------
    check('scratchpad: card 3 has no page yet', await openPadOf('3') && await ev(`${PATH}==='.scratchpad/0003.scratchpad.md (not written yet)'`) && await ev(`/^No refs/.test(document.querySelector('#notes-palette .sp-refs').textContent)`), await ev(PATH));
    await typeInto('jot for card three');
    await press('#notes-palette .sp-save');
    check('scratchpad: Save writes the page and the board lists the target', await waitFor(`${targets}==='["3","7","I2"]'`, 4000) && await ev(`${PATH}==='.scratchpad/0003.scratchpad.md'`), await ev(targets));
    check('scratchpad: the file holds what was typed, and nothing else', (await ev(pad('3'))).body === 'jot for card three');
    await closePalette();

    // --- a group: the tab after Group, and the button on the Group tab -----------------------------------------------
    const badge = await centre('#board .card-el[data-id="3"] .group-badge');
    await click(badge.x, badge.y);
    check('scratchpad: a badge opens the group on its Group tab, with Scratchpad after it', await waitFor(`!!document.querySelector('#notes-palette .gp-scratch')`, 3000) && await ev(TABS) === 'Notes,Group*,Scratchpad', await ev(TABS));
    await press('#notes-palette .gp-scratch');
    check('scratchpad: the Group tab\'s Scratchpad button opens the group\'s page', await waitFor(READY, 4000) && await ev(`${PATH}==='.scratchpad/I0002.scratchpad.md'`) && await ev(`${TEXT}.value==='ask ops about the freeze window\\n'`), await ev(PATH));
    await closePalette();

    // --- the gear's Scratchpad page -----------------------------------------------------------------------------------------
    await clickOn('#prefs-btn');
    check('scratchpad: the gear opens', await waitFor(`!document.getElementById('prefs-sheet').classList.contains('hidden')`, 2500) && await waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 2500));
    await clickOn('.prefs-menu-item[data-page="board:scratchpad"]');
    check('scratchpad: the Scratchpad page shows the switch on and its folder', await waitFor(`(document.getElementById('prefs-page-title')||{}).textContent==='Scratchpad'`, 2500) && await ev(`document.querySelector('.prefs-opt[data-switch="scratchpad"][data-value="on"]').getAttribute('aria-pressed')==='true'`) && await ev(`document.getElementById('pf-scratchpad').value==='.scratchpad'`));
    await clickOn('.prefs-opt[data-switch="scratchpad"][data-value="off"]');
    check('scratchpad: off removes the line and the board shows nothing of it', await waitFor(`state.scratchpad===null&&state.settings.scratchpad.on===false`, 4000) && !lines().some((l) => l.startsWith('scratchpad:')), lines().join('|'));
    check('scratchpad: the pages stay on disk', fs.existsSync(path.join(boardDir, '.scratchpad', '0007.scratchpad.md')) && fs.existsSync(path.join(boardDir, '.scratchpad', '0003.scratchpad.md')));
    await clickOn('.prefs-opt[data-switch="scratchpad"][data-value="on"]');
    check('scratchpad: on writes the line back between the logbook\'s and the groups\'', await waitFor(`!!state.scratchpad`, 4000) && lines().join('|').includes('logbook: logbook|scratchpad: .scratchpad|groups: .groups'), lines().join('|'));
    check('scratchpad: and the pages are listed again', await ev(targets) === '["3","7","I2"]', await ev(targets));
    await key('Escape');
    await waitFor(`document.getElementById('prefs-sheet').classList.contains('hidden')`, 2500);

    // --- delete a group: its page goes only when ticked, its member cards stay ------------------------------------------------
    const holder = await centre('#board .card-el[data-id="3"] .group-badge');
    await click(holder.x, holder.y);
    await waitFor(`!!document.querySelector('#notes-palette .gp-delete')`, 3000);
    await press('#notes-palette .gp-delete');
    check('scratchpad: Delete group offers the logbook, its scratchpad and its member cards, all unticked', await waitFor(DLG_UP, 3000) && await ev(boxes) === 'logbook:false,scratchpad:false,members:false', await ev(boxes));
    await ev(`${BODY}.querySelector('input[data-del="scratchpad"]').click()`);
    await press('#group-dialog [data-confirm="delete"]');
    check('scratchpad: ticked, the group and its page go; the member cards stay', await waitFor(`!state.groups.list.some((g)=>g.id==='I2')&&${targets}==='["3","7"]'`, 4000) && !fs.existsSync(path.join(boardDir, '.scratchpad', 'I0002.scratchpad.md')) && await ev(live('3')), await ev(targets));
    await waitFor(PAL_GONE, 2500);

    // --- delete: the box is unticked, and the page goes only when ticked --------------------------------------------------
    const deleteFromMenu = async (id) => {
      await rightClick(`#board .card-el[data-id="${id}"]`);
      await menuUp();
      await press('#ctx-delete');
      return waitFor(DLG_UP, 3000);
    };
    check('scratchpad: Delete on card 7 offers its scratchpad, unticked', await deleteFromMenu('7') && await ev(boxes) === 'scratchpad:false' && await ev(`/Its scratchpad/.test(${BODY}.textContent)`), await ev(boxes));
    await shot('scratchpad-delete');
    await press('#group-dialog [data-confirm="delete"]');
    check('scratchpad: the card goes and its page stays', await waitFor(`!${live('7')}`, 4000) && (await ev(pad('7'))).exists === true && fs.existsSync(path.join(boardDir, '.scratchpad', '0007.scratchpad.md')));
    check('scratchpad: the board still lists it, dangling', await ev(targets) === '["3","7"]', await ev(targets));
    check('scratchpad: Delete on card 3 offers it too', await waitFor(DLG_GONE, 2500) && await deleteFromMenu('3') && await ev(boxes) === 'scratchpad:false', await ev(boxes));
    await ev(`${BODY}.querySelector('input[data-del="scratchpad"]').click()`);
    await press('#group-dialog [data-confirm="delete"]');
    check('scratchpad: ticked, the card and its page go', await waitFor(`!${live('3')}&&${targets}==='["7"]'`, 4000) && (await ev(pad('3'))).exists === false && !fs.existsSync(path.join(boardDir, '.scratchpad', '0003.scratchpad.md')), await ev(targets));
    check('scratchpad: the toast says so', await waitFor(`/deleted 1 scratchpad/.test(document.getElementById('toast').textContent)`, 2500), await ev(`document.getElementById('toast').textContent`));

    // --- the logbook off: a card opens on its scratchpad alone -------------------------------------------------------------
    await open('/?view=board', 'scratchonly');
    check('scratchonly: the board is drawn with scratchpads on and no logbook', await waitFor(`document.querySelectorAll('#board .card-el').length>20&&!!state.scratchpad&&!state.logbook`, 10000));
    await rightClick('#board .card-el[data-id="7"]');
    check('scratchonly: the card menu has Scratchpad... and no Add note...', await menuUp() && await ev(`!document.getElementById('ctx-scratch').classList.contains('hidden')&&document.getElementById('ctx-note').classList.contains('hidden')`));
    await press('#ctx-scratch');
    check('scratchonly: the palette opens on the card\'s scratchpad alone', await waitFor(READY, 4000) && await ev(`document.querySelector('#notes-palette .np-input').hidden`) && await ev(`${PATH}==='.scratchpad/0007.scratchpad.md (not written yet)'`), await ev(PATH));
    await typeInto('no logbook here');
    await key('Enter', { ctrl: true });
    check('scratchonly: Ctrl+Enter writes it', await waitFor(`${targets}==='["7"]'`, 4000) && (await ev(pad('7'))).body === 'no logbook here');
    await closePalette();
    const gb = await centre('#board .card-el[data-id="3"] .group-badge');
    await click(gb.x, gb.y);
    check('scratchonly: a group has Group and Scratchpad', await waitFor(`!!document.querySelector('#notes-palette .gp-scratch')`, 3000) && await ev(TABS) === 'Group*,Scratchpad', await ev(TABS));
    await closePalette();
  },
};
