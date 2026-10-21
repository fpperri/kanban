'use strict';
// The gear's Types page and the editable Prefixes page, on the plan board (a hierarchy of goal,
// strategy, objective, epic; story, task and bug among the other types). Every change saves at
// once, one whole list, and every byte of config.yaml outside that list stays: a move rewrites the
// hierarchy line, a rename the types block only (the hierarchy keeps naming the old word, which
// shows as a warning chip and one bullet saying what and why), an icon, a color, an add and a
// remove each the types block. The Types switch writes typesOn and removes it. A config.yaml
// edited by hand after the page read it refuses the save, says so in one bullet and reads again.
// Prefixes are added and removed behind a confirm, with the what-and-why note and a warning for a
// prefix naming a type the list does not have. Every This board page shows the path it reads with a
// Copy button; the Logbook page of this board, switched off, shows none. Each step waits on the
// page or on the file, never on a fixed sleep.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js): state, settingsUi.

const fs = require('fs');
const path = require('path');

const SHEET_UP = `!document.getElementById('prefs-sheet').classList.contains('hidden')`;
const item = (page) => `.prefs-menu-item[data-page="${page}"]`;
const names = (area) => `[...document.querySelectorAll('#prefs-board-page ul[data-area="${area}"] > li')].map((li)=>li.dataset.type).join()`;
const fk = (key) => `[data-fk="${key}"]`;
const bullets = `[...document.querySelectorAll('#prefs-board-page .prefs-bullets li')].map((li)=>li.textContent)`;
const focusedKey = `(document.activeElement&&document.activeElement.dataset&&document.activeElement.dataset.fk)||''`;

module.exports = {
  name: 'types-page',
  board: 'plan',
  timeoutMs: 110000,
  // the conflict step makes the server answer 409 on purpose, which the browser logs
  expectedErrors: [/status of 409 \(Conflict\)/],
  async run(page) {
    const { ev, send, waitFor, centre, click, check } = page;
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    await page.open('/');
    await waitFor(`document.querySelectorAll('#board .card-el').length>5`, 10000);
    const boardDir = await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.boardDir)`);
    const configPath = path.join(boardDir, 'config.yaml');
    const config = () => fs.readFileSync(configPath, 'utf8').replace(/\r\n/g, '\n');
    const waitConfig = async (pred, ms = 4000) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (pred(config())) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };
    const settled = () => waitFor(`settingsUi.sending===0`, 4000);
    const typeInto = async (sel, text) => {
      await clickOn(sel);
      await ev(`document.querySelector(${JSON.stringify(sel)}).select()`);
      await send('Input.insertText', { text });
      await page.key('Tab');
    };
    const original = config();

    await clickOn('#prefs-btn');
    await waitFor(SHEET_UP, 2500);
    await waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 2500);
    const boardPages = await ev(`[...document.querySelectorAll('#prefs-board-menu .prefs-menu-item')].map((b)=>b.firstChild.textContent).join()`);
    check('This board lists Logbook, Scratchpad, Groups, Types, Prefixes and Counters in that order', boardPages === 'Logbook,Scratchpad,Groups,Types,Prefixes,Counters', boardPages);

    // --- the Types page --------------------------------------------------------------------------
    await clickOn(item('board:types'));
    await waitFor(names('hierarchy') + `.length>0`, 3000);
    check('the Hierarchy area lists the hierarchy in order and Other types the rest', await ev(names('hierarchy')) === 'goal,strategy,objective,epic' && await ev(names('other')) === 'story,task,bug', [await ev(names('hierarchy')), await ev(names('other'))]);
    check('the page shows the path it reads, absolute, with a Copy button', await ev(`(document.querySelector('#prefs-board-page .prefs-pathtext')||{textContent:''}).textContent`) === configPath && await ev(`!!document.querySelector('#prefs-board-page .prefs-copy')`));
    await ev(`window.__copied=null;navigator.clipboard.writeText=async (t)=>{window.__copied=t}`);
    await clickOn('#prefs-board-page .prefs-copy');
    check('Copy puts the path on the clipboard and says Copied', await waitFor(`window.__copied===${JSON.stringify(configPath)}&&document.querySelector('#prefs-board-page .prefs-copy').textContent==='Copied'`, 2500));
    check('the areas are lists and each row has labelled buttons', await ev(`document.querySelectorAll('#prefs-board-page ul.types-list').length===2&&[...document.querySelectorAll('#prefs-board-page .types-act')].every((b)=>b.tagName==='BUTTON'&&!!b.getAttribute('aria-label'))`));
    check('a row with a prefix names it, read only, with a link to the Prefixes page', await ev(`!document.querySelector('#prefs-board-page li[data-type="goal"] .types-prefix input')&&/Prefix|No prefix/.test(document.querySelector('#prefs-board-page li[data-type="goal"] .types-prefix').textContent)`));
    check('the first row cannot move up and the last cannot move down', await ev(`document.querySelector('#prefs-board-page ${fk('act:goal:up')}').disabled&&document.querySelector('#prefs-board-page ${fk('act:epic:down')}').disabled`));

    await clickOn(`#prefs-board-page ${fk('act:goal:down')}`);
    check('Down on goal rewrites the hierarchy line and nothing else', await waitConfig((c) => c === original.replace('hierarchy: [goal, strategy, objective, epic]', 'hierarchy: [strategy, goal, objective, epic]')), config());
    await settled();
    check('the hierarchy area follows and focus stays on the same button', await waitFor(`${names('hierarchy')}==='strategy,goal,objective,epic'`, 3000) && await waitFor(`${focusedKey}==='act:goal:down'`, 2000), await ev(focusedKey));

    await clickOn(`#prefs-board-page ${fk('act:story:move')}`);
    check('To Hierarchy appends the type to the hierarchy line', await waitConfig((c) => c.includes('hierarchy: [strategy, goal, objective, epic, story]')));
    await settled();
    await clickOn(`#prefs-board-page ${fk('act:story:move')}`);
    check('To Other types takes it out again', await waitConfig((c) => c.includes('hierarchy: [strategy, goal, objective, epic]\n')));
    await settled();

    // an icon, a color
    await clickOn(`#prefs-board-page li[data-type="story"] .types-icon[data-icon="square"]`);
    check('an icon button writes the icon in the types block', await waitConfig((c) => /- name: story\n    icon: square\n/.test(c)));
    await settled();
    await typeInto('#prefs-board-page li[data-type="task"] .types-hex', '#112233');
    check('a hex color writes the color in the types block', await waitConfig((c) => /- name: task\n    color: "#112233"\n/.test(c)));
    await settled();
    await typeInto('#prefs-board-page li[data-type="task"] .types-hex', 'red');
    check('a color that is not hex is refused on the page, under its row, and the file is as it was', await waitFor(`!!document.querySelector('#prefs-board-page li[data-type="task"] .prefs-error')`, 3000) && /- name: task\n    color: "#112233"/.test(config()));
    await settled();
    await clickOn(`#prefs-board-page li[data-type="task"] ${fk('swatch:task:#3fb950')}`);
    check('a swatch writes the color in the types block, and the page has no native color input', await waitConfig((c) => /- name: task\n    color: "#3fb950"\n/.test(c)) && await ev(`!document.querySelector('#prefs-board-page input[type=color]')`));
    await settled();

    // rename: the types block only, with its leftovers shown
    const beforeRename = config();
    await typeInto('#prefs-board-page li[data-type="epic"] .types-name', 'saga');
    check('renaming epic to saga rewrites the types block only: the hierarchy line still says epic', await waitConfig((c) => c.includes('- name: saga') && !c.includes('- name: epic') && c.includes('hierarchy: [strategy, goal, objective, epic]')));
    await settled();
    const hierarchyLine = (c) => c.split('\n').find((l) => l.startsWith('hierarchy:'));
    check('the hierarchy line is byte for byte what it was', hierarchyLine(config()) === hierarchyLine(beforeRename));
    check('epic shows as a warning chip in the Hierarchy area', await waitFor(`!!document.querySelector('#prefs-board-page li[data-type="epic"] .types-chip-warn')`, 3000));
    const notes = await ev(bullets);
    check('one bullet says epic is still in the hierarchy and why', notes.some((t) => /^`epic` is still in the hierarchy\. Why: .*type list/.test(t)), notes);
    check('renaming does not lose the color and the icon of the type', /- name: saga\n(?:    color: "[^"]*"\n)?    icon: square\n/.test(config()));

    // remove, with the confirm
    await ev(`window.confirm=()=>false`);
    await clickOn(`#prefs-board-page ${fk('act:bug:remove')}`);
    check('Remove on a type cards use asks first, and no keeps it', await settled() === true && config().includes('- name: bug'));
    await ev(`window.confirm=()=>true`);
    await clickOn(`#prefs-board-page ${fk('act:bug:remove')}`);
    check('yes removes it from the types block alone', await waitConfig((c) => !/- name: bug/.test(c) && c.includes('hierarchy:')));
    await settled();
    check('the removed type is among the words found on cards, with its count', await waitFor(`/bug/.test((document.querySelector('#prefs-board-page .types-found')||{textContent:''}).textContent)`, 3000));
    await clickOn(`#prefs-board-page .types-found ${fk('found:bug')}`);
    check('Add on a word found on cards puts it back in the types block', await waitConfig((c) => /- bug\n/.test(c) || /- name: bug\n/.test(c)));
    await settled();

    // Add type
    await typeInto('#pf-newType', 'chore');
    await clickOn(fk('save:newType'));
    check('Add type appends a name to the types block', await waitConfig((c) => /- chore\n/.test(c)));
    await settled();

    // the Types switch
    await clickOn('.prefs-opt[data-switch="typesOn"][data-value="off"]');
    check('Types off writes typesOn: false', await waitConfig((c) => /^typesOn: false$/m.test(c)));
    await settled();
    check('the page holds types as off', await waitFor(`state.typesOn===false&&/off/.test(document.querySelector(${JSON.stringify(item('board:types'))}).textContent)`, 3000));
    await clickOn('.prefs-opt[data-switch="typesOn"][data-value="on"]');
    check('Types on removes the line', await waitConfig((c) => !/typesOn/.test(c)));
    await settled();

    // a hand edit after the page read the file
    const handEdit = `${config()}# edited by hand\n`;
    fs.writeFileSync(configPath, handEdit);
    await clickOn(`#prefs-board-page ${fk('act:goal:up')}`);
    check('a save after the file changed on disk is refused: one bullet says nothing was saved and why', await waitFor(`${bullets}.some((t)=>/^config\\.yaml changed on disk after this page read it, so nothing was saved\\. Why: /.test(t))`, 4000));
    check('and the file is as it was written by hand', config() === handEdit);
    await settled();
    await clickOn(`#prefs-board-page ${fk('act:goal:up')}`);
    check('the page read it again, so the same save now goes through', await waitConfig((c) => /hierarchy: \[goal, strategy, objective, epic\]/.test(c)));
    await settled();

    // --- the Prefixes page ------------------------------------------------------------------------
    await clickOn(item('board:prefixes'));
    await waitFor(`!!document.getElementById('pf-newPrefix')`, 3000);
    check('the Prefixes page shows the same path and the what-and-why note', await ev(`(document.querySelector('#prefs-board-page .prefs-pathtext')||{textContent:''}).textContent`) === configPath
      && (await ev(bullets))[0].startsWith('Changing a prefix changes only the ids given from then on. Why: '));
    await ev(`window.confirm=()=>false`);
    await typeInto('#pf-newPrefix', 'T');
    await typeInto('#pf-newTarget', 'task');
    await clickOn(fk('prefix:new:add'));
    check('Add prefix asks first, and no writes nothing', await settled() === true && !config().includes('prefixes:'));
    await ev(`window.confirm=()=>true`);
    await typeInto('#pf-newPrefix', 'T');
    await typeInto('#pf-newTarget', 'task');
    await clickOn(fk('prefix:new:add'));
    check('yes writes a prefixes block', await waitConfig((c) => /\nprefixes:\n  T: task\n/.test(c)));
    await settled();
    await typeInto('#pf-newPrefix', 'Z');
    await typeInto('#pf-newTarget', 'ghost');
    await clickOn(fk('prefix:new:add'));
    check('a prefix naming a type the list does not have shows one warning bullet', await waitFor(`${bullets}.some((t)=>/^The prefix \`Z\` still names \`ghost\`, which is not a listed type\\. Why: /.test(t))`, 4000));
    await clickOn(fk('prefix:Z:remove'));
    check('Remove on a prefix asks and rewrites the block without it', await waitConfig((c) => /\nprefixes:\n  T: task\n/.test(c) && !c.includes('ghost')));
    await settled();
    check('a Types row shows the prefix the block gives its type', (await ev(`(async()=>{document.querySelector(${JSON.stringify(item('board:types'))}).click();return true})()`)) && await waitFor(`/Prefix T/.test(document.querySelector('#prefs-board-page li[data-type="task"] .types-prefix').textContent)`, 3000));

    // --- the paths of the other pages ---------------------------------------------------------------
    await clickOn(item('board:counters'));
    check('Counters shows the config path', await waitFor(`(document.querySelector('#prefs-board-page .prefs-pathtext')||{textContent:''}).textContent===${JSON.stringify(configPath)}`, 3000));
    await clickOn(item('board:logbook'));
    check('a feature that is off shows no path: this board has no logbook', await waitFor(`document.getElementById('prefs-page-title').textContent==='Logbook'`, 3000) && await ev(`!document.querySelector('#prefs-board-page .prefs-pathbar')`));
  },
};
