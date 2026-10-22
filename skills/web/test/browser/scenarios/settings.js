'use strict';
// The gear's sheet, This board half, on the groups board (logbook, groups, prefixes, counters; no
// iterations). The sheet lists This browser and This board; at 760 px and wider the menu and a page
// sit side by side, below that the menu drills down to a page with a back button, and Esc steps back
// before it closes. The board's pages write config.yaml one line at a time: the Logbook switch
// removes and writes back its line and every other line is as it was, a folder inside the board saves
// and one outside is refused with its text still in the field, Groups off leaves the iterations line
// (ignored without groups) and Iterations on needs Groups, idDigits is saved and shown in the example file name, and a folder
// written by hand outside the board shows locked with its controls standing still. Each step waits
// on the page or on the file, never on a fixed sleep.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js): settingsBoardPages, settingsRenderBoard, settingsUi, state.

const fs = require('fs');
const path = require('path');

const SHEET = `document.getElementById('prefs-sheet')`;
const SHEET_UP = `!${SHEET}.classList.contains('hidden')`;
const SHEET_SHUT = `${SHEET}.classList.contains('hidden')`;
const GEAR_FOCUSED = `document.activeElement===document.getElementById('prefs-btn')`;
const item = (page) => `.prefs-menu-item[data-page="${page}"]`;
const shown = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0})()`;
const pageTitle = `(document.getElementById('prefs-page-title')||{textContent:''}).textContent`;
const switchOn = (key) => `(()=>{const b=document.querySelector('.prefs-opt[data-switch="${key}"][data-value="on"]');return !!b&&b.getAttribute('aria-pressed')==='true'})()`;
const switchOff = (key) => `(()=>{const b=document.querySelector('.prefs-opt[data-switch="${key}"][data-value="off"]');return !!b&&b.getAttribute('aria-pressed')==='true'})()`;
const switchDisabled = (key) => `(()=>{const b=document.querySelector('.prefs-opt[data-switch="${key}"][data-value="on"]');return !!b&&b.disabled})()`;
const field = (key) => `document.getElementById('pf-${key}')`;
const errorText = `(()=>{const e=document.querySelector('#prefs-board-page .prefs-error');return e?e.textContent:''})()`;
const menuState = (page) => `(()=>{const b=document.querySelector(${JSON.stringify(item(page))});const s=b&&b.querySelector('.prefs-menu-state');return s?s.textContent:null})()`;
const rows = `[...document.querySelectorAll('#prefs-board-page .prefs-table tbody tr')].map((r)=>[...r.children].map((c)=>c.textContent))`;

module.exports = {
  name: 'settings',
  board: 'groups',
  timeoutMs: 100000,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, check } = page;
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const settled = () => waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 2500);
    const openSheet = async () => {
      await clickOn('#prefs-btn');
      if (!(await waitFor(SHEET_UP, 2500))) return false;
      return settled();
    };
    const goPage = async (id) => {
      await clickOn(item(id));
      return waitFor(`document.querySelector(${JSON.stringify(item(id))}).getAttribute('aria-current')==='page'`, 2500);
    };
    const metrics = (width) => send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.open('/');
    await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000);
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const configPath = path.join(boardDir, 'config.yaml');
    const config = () => fs.readFileSync(configPath, 'utf8');
    const lines = () => config().split(/\r?\n/);
    const has = (line) => lines().includes(line);
    const waitConfig = async (pred, ms = 4000) => {
      const until = Date.now() + page.scaled(ms);
      while (Date.now() < until) {
        if (pred(config().replace(/\r?\n/g, '\n'))) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };
    const type = async (key_, text) => {
      await clickOn(`#pf-${key_}`);
      await ev(`${field(key_)}.select()`);
      await send('Input.insertText', { text });
    };
    const save = async (key_) => {
      await clickOn(`[data-fk="save:${key_}"]`);
      await waitFor(`settingsUi.sending===0`, 4000);
    };

    const original = config();
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    check('the groups board has a logbook, groups and no iterations to start', has('logbook: logbook') && has('groups: .groups') && !original.includes('iterations:'));

    // --- the sheet, wide ---------------------------------------------------------------------
    check('the board is drawn', await ev(`document.querySelectorAll('#board .card-el').length>20`));
    check('the gear opens the sheet', await openSheet());
    const sections = await ev(`[...document.querySelectorAll('.prefs-section h3')].map((h)=>h.textContent)`);
    check('the menu has This browser and This board', sections.join() === 'This browser,This board', sections);
    const boardPages = await ev(`({ shown: [...document.querySelectorAll('#prefs-board-menu .prefs-menu-item')].map((b)=>b.firstChild.textContent), listed: settingsBoardPages.map((p)=>p.title) })`);
    // The pages and their order are pinned in todos-wiring.test.js, scratchpad-page.test.js and settings-page.test.js; this proves the menu renders the table.
    check('This board lists the pages settingsBoardPages holds, in its order', boardPages.listed.length > 0 && boardPages.shown.join() === boardPages.listed.join(), boardPages);
    check('the menu says the logbook is on and the groups on with how many were found', await ev(menuState('board:logbook')) === 'on' && /^on · \d+$/.test(await ev(menuState('board:groups'))), [await ev(menuState('board:logbook')), await ev(menuState('board:groups'))]);
    check('the sheet is wide, with the menu and a page side by side', await ev(`document.getElementById('prefs-panel').classList.contains('is-split')`)
      && await ev(shown('#prefs-menu')) && await ev(shown('.prefs-page[data-page="browser:prefs"]'))
      && await ev(`document.getElementById('prefs-menu').getBoundingClientRect().right<=document.getElementById('prefs-pages').getBoundingClientRect().left+1`));
    check('no back button shows beside the menu', !(await ev(shown('#prefs-back'))));
    check('This browser\'s Preferences page is the first showing', await ev(`document.querySelector(${JSON.stringify(item('browser:prefs'))}).getAttribute('aria-current')==='page'`));
    check('the plain-click choices still work on the sheet', await ev(shown('.prefs-opt[data-pref="click"][data-view="board"][data-value="opens"]')));

    // --- Logbook ---------------------------------------------------------------------------
    await goPage('board:logbook');
    check('the Logbook page names itself and shows the switch on with its folder', await ev(pageTitle) === 'Logbook' && await ev(switchOn('logbook')) && await ev(`${field('logbook')}.value`) === 'logbook');
    await clickOn('.prefs-opt[data-switch="logbook"][data-value="off"]');
    check('switching the logbook off removes its line and no other byte of config.yaml changes', await waitConfig((c) => !c.includes('logbook:')) && config() === original.replace(`logbook: logbook${eol}`, ''), config());
    check('the page shows it off and the menu says so', await waitFor(switchOff('logbook'), 3000) && await ev(menuState('board:logbook')) === 'off');
    check('the board no longer holds a logbook', await ev(`state.logbook===null`));
    await clickOn('.prefs-opt[data-switch="logbook"][data-value="on"]');
    check('switching it on writes the line back with the folder', await waitConfig((c) => c.includes('logbook: logbook\n')));
    const others = (text) => text.split(/\r?\n/).filter((l) => l !== 'logbook: logbook');
    check('every other line is as it was', others(config()).join('|') === others(original).join('|') && has('logbook: logbook'));
    check('the page shows it on', await waitFor(switchOn('logbook'), 3000) && await ev(`state.logbook!==null&&state.logbook.folder==='logbook'`));

    await type('logbook', 'notes/day');
    await save('logbook');
    check('a folder inside the board saves and changes only the line', await waitConfig((c) => c.includes('logbook: notes/day\n')) && has('groups: .groups'));
    const beforeRefusal = config();
    await type('logbook', 'half-typed');
    await ev(`settingsRenderBoard()`);
    check('a render while a folder is being typed keeps the typed text in the field', await ev(`${field('logbook')}.value`) === 'half-typed');
    await type('logbook', '../outside');
    await save('logbook');
    check('a folder outside the board is refused on the page, under the field', await waitFor(`${errorText}.length>0`, 3000) && /outside the board/.test(await ev(errorText)), await ev(errorText));
    check('the refused text is still in the field and config.yaml is untouched', await ev(`${field('logbook')}.value`) === '../outside' && config() === beforeRefusal);

    // --- Groups ----------------------------------------------------------------------------
    await goPage('board:groups');
    check('the Groups page shows the switch on, the folder, Iterations off and the groups found', await ev(pageTitle) === 'Groups' && await ev(switchOn('groups')) && await ev(`${field('groups')}.value`) === '.groups'
      && await ev(switchOff('iterations')) && await ev(`document.querySelectorAll('#prefs-board-page .pick-btn').length`) === await ev(`state.groups.list.length`));
    const foundTitle = await ev(`[...document.querySelectorAll('#prefs-board-page .prefs-label')].map((l)=>l.textContent).find((t)=>t.startsWith('Groups found'))`);
    check('the groups found are counted', foundTitle === `Groups found (${await ev('state.groups.list.length')})`, foundTitle);
    await clickOn('.prefs-opt[data-switch="iterations"][data-value="on"]');
    check('Iterations on writes iterations: true below the groups line', await waitConfig((c) => /\ngroups: \.groups\niterations: true\n/.test(c)));
    check('the page shows Iterations on', await waitFor(switchOn('iterations'), 3000));
    await clickOn('.prefs-opt[data-switch="groups"][data-value="off"]');
    check('Groups off removes the groups line and leaves the iterations line', await waitConfig((c) => !c.includes('groups:') && c.includes('iterations: true')));
    check('the page says groups are off and Iterations cannot be switched on', await waitFor(`${switchOff('groups')}&&${switchDisabled('iterations')}`, 3000) && await ev(`state.groups===null`));
    check('the prefixes block and the counters were not touched by it', has('prefixes:') && has('  _: .groups') && has('counters: { I: 3, W: 2, DW: 2 }'));
    await clickOn('.prefs-opt[data-switch="groups"][data-value="on"]');
    check('Groups on writes the line back and the groups are found again', await waitConfig((c) => c.includes('groups: .groups\n')) && await waitFor(`state.groups!==null&&state.groups.list.length>0`, 3000));
    check('Iterations is on again, as its line says', config().includes('iterations: true') && await waitFor(switchOn('iterations'), 3000));

    // --- the groups found open the group ---------------------------------------------------------
    const firstGroup = await ev(`document.querySelector('#prefs-board-page .pick-btn').dataset.groupId`);
    await clickOn('#prefs-board-page .pick-btn');
    check('a group found closes the sheet and opens that group in the palette', await waitFor(SHEET_SHUT, 2500) && await waitFor(`!document.getElementById('notes-palette').classList.contains('hidden')&&!!document.querySelector('#notes-palette .gp[data-group-id="${firstGroup}"]')`, 3000), firstGroup);
    await key('Escape');
    await waitFor(`document.getElementById('notes-palette').classList.contains('hidden')`, 2500);

    // --- Prefixes and Counters ----------------------------------------------------------------------
    await openSheet();
    await goPage('board:prefixes');
    const prefixRows = await ev(`[...document.querySelectorAll('#prefs-board-page .prefs-table tbody tr')].map((r)=>[...r.querySelectorAll('input')].map((i)=>i.value).concat(r.children[2].textContent))`);
    check('the Prefixes page lists the prefixes: block, one row each, in fields', prefixRows.length === 5 && prefixRows.some((r) => r[0] === 'G' && r[1] === 'goal' && r[2] === 'card type goal') && prefixRows.some((r) => r[0] === 'I' && r[2] === '.groups/iteration/'), prefixRows);
    check('each prefix row has its two fields and a Remove: the table is editable now', await ev(`[...document.querySelectorAll('#prefs-board-page .prefs-table tbody tr')].every((r)=>r.querySelectorAll('input').length===2&&r.querySelectorAll('button').length===1)`));
    check('the page says what a prefix change does and why, in one bullet', (await ev(`[...document.querySelectorAll('#prefs-board-page .prefs-bullets li')].map((li)=>li.textContent)`))[0].startsWith('Changing a prefix changes only the ids given from then on. Why: '));
    check('the page names config.yaml with a Copy button', await ev(`!!document.querySelector('#prefs-board-page .prefs-pathbar .prefs-copy')&&/config\.yaml$/.test(document.querySelector('#prefs-board-page .prefs-pathtext').textContent)`));
    check('idDigits is a field with the example file name', await ev(`${field('idDigits')}.value`) === '4' && /0007\./.test(await ev(`document.querySelector('#prefs-board-page').textContent`)));
    await type('idDigits', '7');
    await save('idDigits');
    check('idDigits saves one line, below nextId', await waitConfig((c) => /\nnextId: 30\nidDigits: 7\n/.test(c)));
    check('the example shows the new width', await waitFor(`/0000007\\./.test(document.querySelector('#prefs-board-page').textContent)`, 3000));
    await type('idDigits', '99');
    await save('idDigits');
    check('an idDigits the server refuses is shown, and the line stays', await waitFor(`${errorText}.length>0`, 3000) && has('idDigits: 7'), await ev(errorText));
    await goPage('board:counters');
    const counterRows = await ev(rows);
    check('the Counters page lists nextId and the counters, read only', counterRows[0].join() === 'nextId,30' && counterRows.some((r) => r.join() === 'I,3') && counterRows.length === 4
      && await ev(`document.querySelectorAll('#prefs-board-page input, #prefs-board-page .prefs-opt').length`) === 0, counterRows);

    // --- Esc and focus ---------------------------------------------------------------------------
    await key('Escape');
    check('on a wide sheet Esc closes it and hands focus to the gear', await waitFor(SHEET_SHUT, 2500) && await ev(GEAR_FOCUSED));
    await openSheet();
    check('the sheet opens again on the page it had', await ev(`document.querySelector(${JSON.stringify(item('board:counters'))}).getAttribute('aria-current')==='page'`));
    await key('Escape');
    await waitFor(SHEET_SHUT, 2500);

    // --- a folder set by hand outside the board is locked ------------------------------------------------
    const handWritten = config().replace(/^logbook: .*$/m, 'logbook: ../elsewhere');
    fs.writeFileSync(configPath, handWritten);
    await page.open('/');
    await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000);
    await openSheet();
    await goPage('board:logbook');
    check('a folder outside the board shows locked with the reason, its switch and field standing still', await waitFor(`${switchDisabled('logbook')}`, 3000) && await ev(`${field('logbook')}.disabled`) === true
      && /outside the board/.test(await ev(`document.querySelector('#prefs-board-page .prefs-note').textContent`)) && await ev(`${field('logbook')}.value`) === '../elsewhere');
    check('the menu says it is locked', await ev(menuState('board:logbook')) === 'on · locked');
    check('and the hand-written line is read as it stands: the board keeps the logbook', await ev(`state.logbook!==null&&state.logbook.folder==='../elsewhere'`));
    check('config.yaml is as it was written by hand', config() === handWritten);
    await key('Escape');
    await waitFor(SHEET_SHUT, 2500);

    // --- the sheet, narrow ---------------------------------------------------------------------------
    await metrics(400);
    const openNarrow = async () => {
      await clickOn('#more-btn');
      await clickOn('#more-prefs');
      return (await waitFor(SHEET_UP, 2500)) && settled();
    };
    await openNarrow();
    check('a narrow sheet shows the menu alone, with no page and no back button', await ev(`document.getElementById('prefs-panel').classList.contains('is-drill')`)
      && await ev(shown('#prefs-menu')) && !(await ev(shown('#prefs-pages'))) && !(await ev(shown('#prefs-back'))));
    await clickOn(item('board:prefixes'));
    check('a menu item drills down: the page shows with a back button and the menu is gone', await waitFor(shown('#prefs-back'), 2500) && await ev(pageTitle) === 'Prefixes' && !(await ev(shown('#prefs-menu'))));
    check('focus is on the back button', await ev(`document.activeElement===document.getElementById('prefs-back')`));
    await key('Escape');
    check('Esc steps back to the menu, and the sheet stays open', await waitFor(`${shown('#prefs-menu')}&&!${'(' + shown('#prefs-pages') + ')'}`, 2500) && await ev(SHEET_UP));
    check('focus is back on the item that opened the page', await ev(`document.activeElement===document.querySelector(${JSON.stringify(item('board:prefixes'))})`));
    await key('Escape');
    check('a second Esc closes the sheet and hands focus to More, the gear being hidden', await waitFor(SHEET_SHUT, 2500) && await ev(`document.activeElement===document.getElementById('more-btn')`));
    await openNarrow();
    await clickOn(item('browser:hotkeys'));
    await waitFor(shown('#prefs-back'), 2500);
    await clickOn('#prefs-back');
    check('the back button does what Esc does', await waitFor(`${shown('#prefs-menu')}&&!(${shown('#prefs-pages')})`, 2500));
    await metrics(1800);
    check('widening the window shows the menu and a page again', await waitFor(`${shown('#prefs-menu')}&&${shown('#prefs-pages')}`, 2500));
    await key('Escape');
    await waitFor(SHEET_SHUT, 2500);
  },
};
