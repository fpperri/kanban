'use strict';
// The selection bar on a 390 px phone, with touch. It is not there with nothing selected. Three taps on
// Todo cards show it above the view bar reading "3 selected"; it covers neither the view bar (which keeps
// its place, and a tap on it still reaches it) nor the last card of the list (the list scrolled to its end
// stops at the bar's top). Clear empties the selection and the bar goes. Archive asks, opens the package
// popup, and archives the three: the bar goes with the selection. Status opens Set status... for the
// selection, 44 px tall buttons inside the screen; a tap on Backlog moves the cards, the selection and the
// bar stay and read the same count. More opens the card menu for the whole selection above the bar, with
// no Peek, and Set status... is in its Edit group. The step leaves the board as it found it: the archived
// cards are restored and the moved cards go back to Todo.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): api, loadBoard, selectedIds, state.

const { tap } = require('../../steps');
const { askUp, askGone, askText, askYes, refuseNativeConfirm, nativeConfirmsSeen } = require('../../ask');

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check, shot } = page;

    const IDS = [10, 13, 17];
    const picked = `[...selectedIds].map(Number).sort((a,b)=>a-b).join()`;
    const BAR = `document.getElementById('selection-bar')`;
    const barShown = `getComputedStyle(${BAR}).display!=='none'&&!${BAR}.classList.contains('hidden')&&${BAR}.getBoundingClientRect().height>0`;
    const rectOf = (expr) => ev(`(()=>{const r=(${expr}).getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height,x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); if (!p) throw new Error(`nothing matches ${sel}`); await tap(page, p.x, p.y); };
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const pickedIs = (ids) => waitFor(`${picked}===${JSON.stringify(ids.join())}`, 3000);
    const barReads = (text) => waitFor(`${barShown}&&document.getElementById('selection-bar-count').textContent===${JSON.stringify(text)}`, 3000);
    const barGone = () => waitFor(`!(${barShown})`, 3000);
    const inScreen = (r, w, h) => r.l >= -0.5 && r.t >= -0.5 && r.r <= w + 0.5 && r.b <= h + 0.5;
    const statusOf = (id) => ev(`state.active.find((c)=>String(c.id)==='${id}').status`);

    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await tapOn('.board-tab[data-col="todo"]');
    check('the Todo tab shows the cards the step selects', await waitFor(IDS.map((id) => `!!document.querySelector(${JSON.stringify(titleOf(id))})`).join('&&'), 5000));

    check('with nothing selected there is no bar', !(await ev(barShown)), await ev(`getComputedStyle(${BAR}).display`));
    check('and no room is kept for it', (await ev(`getComputedStyle(document.documentElement).getPropertyValue('--selection-bar-h').trim()`)) === '0px');

    // --- the bar appears with the count, above the view bar, covering nothing --------------------------
    for (const id of IDS) await tapOn(titleOf(id));
    check('three taps select three cards', await pickedIs(IDS), await ev(picked));
    check('the bar shows, reading 3 selected', await barReads('3 selected'), await ev(`document.getElementById('selection-bar-count').textContent`));
    await shot('bar');

    const [w, h] = await ev(`[innerWidth, innerHeight]`);
    const bar = await rectOf(BAR);
    const viewBar = await rectOf(`document.getElementById('view-bar')`);
    check('it is on the screen, as wide as it', inScreen(bar, w, h) && bar.l <= 0.5 && bar.r >= w - 0.5, JSON.stringify(bar));
    check('it stands right on top of the view bar and does not cover it', Math.abs(bar.b - viewBar.t) <= 1.5, JSON.stringify({ bar, viewBar }));
    check('the view bar is where it was, at the foot of the screen', Math.abs(viewBar.b - h) <= 1.5 && viewBar.h >= 40, JSON.stringify(viewBar));
    check('a tap on the view bar still reaches it', await ev(`document.elementFromPoint(${viewBar.x},${viewBar.y}).closest('#view-bar')!==null`));
    check('the bar is tall enough for a thumb and its four buttons fit on one row', bar.h >= 44 && await ev(`[...${BAR}.querySelectorAll('button')].every((b)=>{const r=b.getBoundingClientRect();return r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.top>=${BAR}.getBoundingClientRect().top-1&&r.bottom<=${BAR}.getBoundingClientRect().bottom+1})`));
    check('the buttons read Clear, Archive, Status and More', (await ev(`[...${BAR}.querySelectorAll('button')].map((b)=>b.textContent.trim()).join('|')`)) === 'Clear|Archive|Status|More');
    await ev(`(()=>{const l=document.querySelector('#board .column .column-cards');l.scrollTop=l.scrollHeight;return true})()`);
    const board = await rectOf(`document.getElementById('board')`);
    const last = await ev(`(()=>{const cards=[...document.querySelectorAll('#board .column .column-cards .card-el')];const r=cards[cards.length-1].getBoundingClientRect();return {t:r.top,b:r.bottom}})()`);
    check('the Board ends above the bar, so it covers no list', board.b <= bar.t + 1.5, JSON.stringify({ board, bar }));
    check('the list scrolled to its end shows its last card in full above the bar', last.b <= bar.t + 1.5 && last.t >= 0, JSON.stringify({ last, bar }));

    // --- Clear ------------------------------------------------------------------------------------------
    await tapOn('#selection-bar-clear');
    check('Clear empties the selection', await pickedIs([]), await ev(picked));
    check('and the bar goes, with the room it kept', await barGone() && (await ev(`getComputedStyle(document.documentElement).getPropertyValue('--selection-bar-h').trim()`)) === '0px');

    // --- Archive ----------------------------------------------------------------------------------------
    await refuseNativeConfirm(page);
    for (const id of IDS) await tapOn(titleOf(id));
    await barReads('3 selected');
    await tapOn('#selection-bar-archive');
    const asked = (await askUp(page)) ? await askText(page) : null;
    check('Archive asks in the page, naming the three cards', asked === 'Archive 3 card(s)? (moves their files to archived/)', asked);
    await askYes(page);
    check('then the package popup opens', await askGone(page) && await waitFor(`!document.getElementById('bulk-archive').classList.contains('hidden')&&document.getElementById('bulk-archive-title').textContent==='Archive 3 card(s)'`, 3000));
    await tapOn('#bulk-archive-apply');
    check('the three cards leave the Board for the archive', await waitFor(`${IDS.map((id) => `state.archived.some((c)=>String(c.id)==='${id}')`).join('&&')}&&${IDS.map((id) => `!document.querySelector(${JSON.stringify(titleOf(id))})`).join('&&')}`, 8000));
    check('the selection is empty afterwards and the bar has gone', await pickedIs([]) && await barGone());
    check('no native confirm() was raised', (await nativeConfirmsSeen(page)) === 0);
    for (const id of IDS) await ev(`api('POST','/api/cards/${id}/restore').then(()=>true)`);
    await ev(`loadBoard().then(()=>true)`);
    check('the step puts the cards back', await waitFor(IDS.map((id) => `!!document.querySelector(${JSON.stringify(titleOf(id))})`).join('&&'), 5000));

    // --- Status -----------------------------------------------------------------------------------------
    const pair = [13, 17];
    for (const id of pair) await tapOn(titleOf(id));
    await barReads('2 selected');
    await tapOn('#selection-bar-status');
    check('Status opens Set status... for the two cards', await waitFor(`!document.getElementById('bulk-status').classList.contains('hidden')&&document.getElementById('bulk-status-title').textContent==='Set status on 2 card(s)'`, 3000));
    check('it lists the board\'s four statuses, not Archive', (await ev(`[...document.querySelectorAll('#bulk-status-list button')].map((b)=>b.dataset.status).join()`)) === 'backlog,todo,doing,done');
    await shot('status-popup');
    const choices = await ev(`[...document.querySelectorAll('#bulk-status-list button')].map((b)=>{const r=b.getBoundingClientRect();return {h:r.height,l:r.left,r:r.right,t:r.top,b:r.bottom}})`);
    check('each is 44 px tall and inside the screen', choices.every((r) => r.h >= 44 && inScreen({ l: r.l, r: r.r, t: r.t, b: r.b }, w, h)), JSON.stringify(choices));
    await tapOn('#bulk-status-list button[data-status="backlog"]');
    check('a tap on Backlog moves both cards there', await waitFor(`state.active.find((c)=>String(c.id)==='13').status==='backlog'&&state.active.find((c)=>String(c.id)==='17').status==='backlog'`, 6000), `${await statusOf(13)} ${await statusOf(17)}`);
    check('and closes the popup', await ev(`document.getElementById('bulk-status').classList.contains('hidden')`));
    check('the selection stays, and so does the bar and its count', await pickedIs(pair) && await barReads('2 selected'), await ev(picked));
    for (const id of pair) await ev(`api('PATCH','/api/cards/${id}',{status:'todo'}).then(()=>true)`);
    await ev(`loadBoard().then(()=>true)`);

    // --- More -------------------------------------------------------------------------------------------
    await tapOn('#selection-bar-more');
    const MENU = `document.getElementById('context-menu')`;
    check('More opens the card menu', await waitFor(`!${MENU}.classList.contains('hidden')`, 3000));
    const menu = await rectOf(MENU);
    const bar2 = await rectOf(BAR);
    check('it rises from the bar: inside the screen and above it', inScreen(menu, w, h) && menu.b <= bar2.t + 0.5, JSON.stringify({ menu, bar2 }));
    await shot('more-menu');
    check('it is the menu of the whole selection: no Peek, no Add to selection', await ev(`document.getElementById('ctx-peek').classList.contains('hidden')&&document.getElementById('ctx-add').classList.contains('hidden')`));
    await tapOn('#ctx-edit');
    check('the Edit group opens under its row with Set status... first', await waitFor(`getComputedStyle(document.getElementById('ctx-status')).display!=='none'&&document.querySelector('#ctx-edit-panel button').id==='ctx-status'`, 3000));
    const inside = await rectOf(`document.getElementById('ctx-status')`);
    check('and the group grew upward: the menu still ends above the bar and stays inside the screen', await ev(`${MENU}.getBoundingClientRect().bottom`) <= bar2.t + 0.5 && inScreen(await rectOf(MENU), w, h) && inside.h > 0, JSON.stringify(await rectOf(MENU)));
    await tapOn('#ctx-status');
    check('Set status... opens its popup for the two cards and shuts the menu', await waitFor(`!document.getElementById('bulk-status').classList.contains('hidden')&&document.getElementById('bulk-status-title').textContent==='Set status on 2 card(s)'&&${MENU}.classList.contains('hidden')`, 3000));
    await tapOn('#bulk-status-close');
    check('closing it moves nothing and keeps the selection', await waitFor(`document.getElementById('bulk-status').classList.contains('hidden')`, 3000) && await ev(`${picked}===${JSON.stringify(pair.join())}`) && (await statusOf(13)) === 'todo');
    await tapOn('#selection-bar-more');
    await waitFor(`!${MENU}.classList.contains('hidden')`, 3000);
    await tapOn('#selection-bar-more');
    check('a second tap on More closes the menu', await waitFor(`${MENU}.classList.contains('hidden')`, 3000));
  },
};
