'use strict';
// The tier fan's Names option and the l key, on the plan board. The option row's Names holds
// relevant, all and none, relevant pressed by default. A name is a plain label of a card:
// every card of the fan has exactly one, and the page names the ones the setting names
// (graphFanNames). On the plan board relevant names the five parents from the highest
// altitude down (the fan is above the small size), all names every card and none names none,
// each the number the model predicts, so each choice changes the number drawn. A card named
// shows its title as text. The l key steps relevant, all, none and back to relevant while the
// Graph shows Tiers, and shows the setting in the footer line of the Graph. It goes through the
// shared key guard: with focus in the search box l is typed and the setting stays, with a card
// menu, the notifications panel or the preferences sheet up it does nothing, and with the search
// panel open and focus outside the box it steps the setting. In the Flow and outside the
// Graph it does nothing. An option that has focus keeps it through a step. A reload keeps the
// choice and another board keeps its own. With names on all, a zoom, a pan and a poll leave
// exactly one name label for each card. A click on a card names it and the cards it lights, the
// relations of a lone card among them, and a second card added to the selection names those
// two and not their relations. The malformed board draws its names in every setting. The harness
// closes the scenario with the console-error check, which covers all three boards.
//
// A card is named when its node has the graph-named class, which the page gives the cards the
// setting names. Whether a named card's name found room, and where it sits, is fan-name-rows's:
// a card with no room keeps its id label. A name cut to its room ends in an ellipsis.
//
// The plan board's live cards are 1 to 18 and 22 to 29. Its parents, the cards with a child, are
// 1, 2, 7, 22 and 23 (altitudes 5, 4, 3, 2 and 1). Card 5 is a child of card 1 that waits for
// nothing, is waited for by 6 and 27; card 3 is a child of card 1 that is waited for by 4 and 6.
// The fixture board has no hierarchy and 18 live cards, a fan at or below the small size, where
// relevant names every card; the malformed board has four.
// skills/web/test/browser-fan-names-scenario.test.js holds these lists to the real board readers
// and the Graph model over each board's own cards.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur, graphFanNames, graphLoadOptions, selectedIds.

const { DRAWN, TIERS_PRESSED, BLUR, ZOOM_IN, pickLayout, layoutIs, hasDot } = require('./tier-fan');
const {
  ROW_SHOWN, optionButton, pressedIs, TICK, FOCUSED_OPTION, CANVAS_SPACE, SELECTED, createCard, dotPoint,
} = require('./tier-fan-options');

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const CASES = {
  plan: {
    live: [...range(1, 18), ...range(22, 29)],
    parents: [1, 2, 7, 22, 23],
    // The cards a lone click on a card lights besides itself, from the board's own relations.
    picks: [{ id: 5, related: [1, 6, 27] }, { id: 3, related: [1, 4, 6] }],
    // Cards to add to the selection with Shift, the first that is under no other dot.
    extras: [6, 4, 12, 14],
    title: { id: 1, text: '#1 Zephyr platform migration' },
    added: { title: 'Name the new card', status: 'todo' },
    addedId: 30,
    values: ['relevant', 'all', 'none'],
    steps: ['all', 'none', 'relevant'],
  },
  fixture: { live: range(1, 18) },
  malformed: { live: range(1, 4) },
};

const BOX = `document.getElementById('search-input')`;
const NODES = `[...document.querySelectorAll('#graph-view .graph-node')]`;
// The ids of the cards named, in order, and how many labels the stage holds.
const NAMED = `${NODES}.filter((n)=>n.classList.contains('graph-named')).map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`;
const LABEL_COUNT = `document.querySelectorAll('#graph-view .graph-node-name').length`;
const NODE_COUNT = `document.querySelectorAll('#graph-view .graph-node').length`;
// Every card has exactly one label, and each is a text (an SVG text, never markup).
const LABELS_ONE = `${NODES}.length>0&&${NODES}.every((n)=>{const l=n.querySelectorAll('.graph-node-name');return l.length===1&&l[0].tagName.toLowerCase()==='text'&&l[0].children.length===0})`;
const SETTING = `graphLoadOptions().names`;
const namedAre = (ids) => `JSON.stringify(${NAMED})===${JSON.stringify(JSON.stringify(ids.slice().sort((a, b) => a - b)))}`;
const settingIs = (value) => `${SETTING}===${JSON.stringify(value)}`;
// What the model names on the cards drawn when nothing is selected, for a setting.
const predicted = (mode) => `[...graphFanNames(graphCur.model,${JSON.stringify(mode)},{selectedIds:new Set(),loneCardId:null})].map(Number).sort((a,b)=>a-b)`;
const NAMED_ARE_PREDICTED = (mode) => `JSON.stringify(${NAMED})===JSON.stringify(${predicted(mode)})`;
const nameOf = (id) => `(()=>{const t=document.querySelector('#graph-view .graph-node[data-id="${id}"] .graph-node-name');return t?t.textContent:null})()`;
const KEY_LINE = `(()=>{const k=document.querySelector('#graph-view .graph-key');return k?k.textContent:null})()`;
const keyLineSays = (value) => `(()=>{const k=document.querySelector('#graph-view .graph-key');return !!k&&k.textContent.endsWith(${JSON.stringify(`l steps the names: ${value}`)})})()`;
// The Names group of the row as the page has it, null while the row is not there or has none.
const NAMES_GROUP = `(()=>{const g=[...document.querySelectorAll('#graph-view .graph-options .graph-option')].find((x)=>x.querySelector('.graph-option-label').textContent==='Names');`
  + `if(!g)return null;return {title:g.title,buttons:[...g.querySelectorAll('.graph-option-btn')].map((b)=>({key:b.dataset.key,val:b.dataset.val,text:b.textContent,pressed:b.getAttribute('aria-pressed')==='true',active:b.classList.contains('active'),`
  + `keeps:b.hasAttribute('data-keeps-selection'),holds:b.hasAttribute('data-holds-poll')}))}})()`;
const PANEL = `document.getElementById('search-panel')`;
const PANEL_OPEN = `!${PANEL}.classList.contains('hidden')&&${PANEL}.getBoundingClientRect().height>0`;
const MENU_UP = `!document.getElementById('context-menu').classList.contains('hidden')`;
const MENU_SHUT = `document.getElementById('context-menu').classList.contains('hidden')`;
const NOTIFICATIONS_UP = `!document.getElementById('notif-modal').classList.contains('hidden')`;
const NOTIFICATIONS_SHUT = `document.getElementById('notif-modal').classList.contains('hidden')`;
const SHEET_UP = `!document.getElementById('prefs-sheet').classList.contains('hidden')`;
const SHEET_SHUT = `document.getElementById('prefs-sheet').classList.contains('hidden')`;
const BOARD_READY = `document.querySelectorAll('#board .card-el').length>20`;
const frames = `new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`;
const boxIs = (text) => `${BOX}.value===${JSON.stringify(text)}`;
const CLEAR_BOX = `document.getElementById('search-clear-btn').click()`;
const FOCUS_BOX = `${BOX}.focus()`;
const CANVAS_DRAGGED = `graphCur.view.touched===true`;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A name shows a card's id and title whole, or a start of it with an ellipsis when its room is shorter; the id is always whole.
const showsTitle = (shown, title) => typeof shown === 'string' && (shown === title || (shown.length > 1 && shown.endsWith('…') && title.startsWith(shown.slice(0, -1))));
const sorted = (ids) => ids.slice().sort((a, b) => a - b);
const union = (...lists) => sorted([...new Set(lists.flat())]);

const { openPanel } = require('../panel');

module.exports = {
  name: 'fan-names',
  board: 'plan',
  alsoBoards: ['fixture', 'malformed'],
  timeoutMs: 120000,
  CASES,
  NAMED,
  LABEL_COUNT,
  NODE_COUNT,
  LABELS_ONE,
  SETTING,
  KEY_LINE,
  NAMES_GROUP,
  PANEL_OPEN,
  MENU_UP,
  MENU_SHUT,
  NOTIFICATIONS_UP,
  NOTIFICATIONS_SHUT,
  SHEET_UP,
  SHEET_SHUT,
  BOARD_READY,
  CLEAR_BOX,
  FOCUS_BOX,
  CANVAS_DRAGGED,
  settingIs,
  predicted,
  NAMED_ARE_PREDICTED,
  keyLineSays,
  boxIs,
  async run(page) {
    const { ev, open, waitFor, centre, click, mouse, key, rightClick, check } = page;
    const plan = CASES.plan;

    // A page that is being left still answers for a moment after the navigation starts, so a wait
    // on the new page would read the old one. The old page is marked, and the new one is the first
    // without the mark.
    const load = async (boardKey, url = '/?view=graph') => {
      await ev('window.__stale=true');
      await open(url, boardKey);
      await waitFor('!window.__stale', 10000);
      if (!url.includes('view=graph')) return waitFor(BOARD_READY, 10000);
      await openPanel(page);
      return waitFor(`${DRAWN}&&${TIERS_PRESSED}`, 10000);
    };
    const pressOn = async (sel) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const frame = () => ev(frames);
    const blur = () => ev(BLUR);
    const named = () => ev(NAMED);
    const setting = () => ev(SETTING);
    // A press of an option button, waiting on the button to read pressed.
    const choose = async (value) => {
      await pressOn(optionButton('names', value));
      return waitFor(pressedIs('names', value), 6000);
    };
    // The key l pressed with nothing focused, and the setting it should arrive at.
    const step = async (to) => {
      await blur();
      await key('l');
      return waitFor(settingIs(to), 4000);
    };
    const settles = async (ids) => waitFor(namedAre(ids), 6000);
    // The key walked to a setting that is not the next one: l pressed until the setting is there.
    const walkTo = async (to) => {
      await blur();
      for (let i = 0; i < plan.values.length && (await setting()) !== to; i++) {
        const before = await setting();
        await key('l');
        await waitFor(`${SETTING}!==${JSON.stringify(before)}`, 4000);
      }
      return (await setting()) === to;
    };
    const everyCard = async (live) => ({ labels: await ev(LABEL_COUNT), nodes: await ev(NODE_COUNT), live: live.length });

    // --- the row: Names with its three values, relevant on ----------------------------------------
    check('plan: the Graph draws in Tiers', await load('plan'));
    check('plan: every card of the fan has exactly one name label, text only', await ev(LABELS_ONE), { labels: await ev(LABEL_COUNT), nodes: await ev(NODE_COUNT) });
    check('plan: the plan board draws its 26 live cards', (await ev(NODE_COUNT)) === plan.live.length, await ev(NODE_COUNT));
    check('plan: the row is shown in the panel', await waitFor(ROW_SHOWN, 6000));
    const group = await ev(NAMES_GROUP);
    check('plan: the row shows Names with relevant, all and none, in words', !!group && same(group.buttons.map((b) => [b.key, b.val, b.text]), plan.values.map((v) => ['names', v, v])), group);
    check('plan: relevant is on by default, and only relevant', !!group && same(group.buttons.filter((b) => b.pressed).map((b) => b.val), ['relevant']) && group.buttons.every((b) => b.active === b.pressed), group);
    check('plan: every Names button keeps the selection and none holds the poll', !!group && group.title.length > 20 && group.buttons.every((b) => b.keeps === true && b.holds === false), group);
    check('plan: the footer line of the Graph says the l key steps the names, and which is on', await waitFor(keyLineSays('relevant'), 4000), await ev(KEY_LINE));

    // --- each choice changes the number of names drawn --------------------------------------------
    check('plan: relevant, the default, names the five parents and no leaf', await settles(plan.parents), await named());
    check('plan: and they are the names the model predicts', await ev(NAMED_ARE_PREDICTED('relevant')), { drawn: await named(), predicted: await ev(predicted('relevant')) });
    const counts = {};
    counts.relevant = (await named()).length;
    check('plan: all is pressed and names every card', await choose('all') && await settles(plan.live), await named());
    counts.all = (await named()).length;
    check('plan: and they are the names the model predicts', await ev(NAMED_ARE_PREDICTED('all')), { drawn: await named(), predicted: await ev(predicted('all')) });
    check('plan: a named card shows its title', showsTitle(await ev(nameOf(plan.title.id)), plan.title.text), await ev(nameOf(plan.title.id)));
    check('plan: and the footer line follows', await waitFor(keyLineSays('all'), 4000), await ev(KEY_LINE));
    check('plan: none is pressed and names no card', await choose('none') && await settles([]), await named());
    counts.none = (await named()).length;
    check('plan: and the labels are still one for each card, shown or not', await ev(LABELS_ONE) && (await ev(LABEL_COUNT)) === plan.live.length, await everyCard(plan.live));
    check('plan: each Names choice changes the number of drawn names', counts.relevant === plan.parents.length && counts.all === plan.live.length && counts.none === 0, counts);
    check('plan: relevant is pressed again and names the parents again', await choose('relevant') && await settles(plan.parents), await named());

    // --- the l key ---------------------------------------------------------------------------------------
    await blur();
    const walked = [];
    for (const to of plan.steps) {
      const reached = await step(to);
      walked.push(to);
      const shown = to === 'all' ? plan.live : to === 'none' ? [] : plan.parents;
      check(`plan: l steps the names to ${to}, and the row, the labels and the footer line agree`,
        reached && await settles(shown) && await waitFor(pressedIs('names', to), 4000) && await waitFor(keyLineSays(to), 4000), { setting: await setting(), named: await named() });
    }
    check('plan: three presses of l walked all, none and back to relevant', same(walked, ['all', 'none', 'relevant']) && (await setting()) === 'relevant', walked);

    // An option that has focus is rebuilt by the step and gets focus back, as after a press: the
    // same option, found again by its key and value, so focus stays on all while the setting moves
    // on to none and the row shows none pressed.
    await pressOn(optionButton('names', 'all'));
    check('plan: after a press the option keeps focus', await waitFor(`${FOCUSED_OPTION}==='names=all'`, 4000), await ev(FOCUSED_OPTION));
    await key('l');
    check('plan: l with focus on an option steps the setting, and the option keeps focus',
      await waitFor(settingIs('none'), 4000) && await waitFor(pressedIs('names', 'none'), 4000) && await waitFor(`${FOCUSED_OPTION}==='names=all'`, 4000),
      { setting: await setting(), focused: await ev(FOCUSED_OPTION) });
    await key('l');
    await waitFor(settingIs('relevant'), 4000);
    check('plan: and l goes on from there: none is followed by relevant', (await setting()) === 'relevant' && await settles(plan.parents), await setting());

    // --- where l does nothing --------------------------------------------------------------------------------
    await blur();
    await ev(FOCUS_BOX);
    const typedOver = await setting();
    await key('l');
    check('plan: with focus in the search box, l is typed and the setting stays', await waitFor(boxIs('l'), 4000) && (await setting()) === typedOver, { box: await ev(`${BOX}.value`), setting: await setting() });
    await ev(CLEAR_BOX);
    await waitFor(boxIs(''), 4000);
    await blur();
    check('plan: the search panel is open with focus outside the box', await waitFor(PANEL_OPEN, 4000));
    await key('l');
    check('plan: with the search panel open and focus outside the box, l steps the setting', await waitFor(settingIs('all'), 4000), await setting());
    await key('l');
    await key('l');
    await waitFor(settingIs('relevant'), 4000);
    check('plan: and goes on round to relevant', (await setting()) === 'relevant', await setting());
    await ev(`document.getElementById('search-panel-toggle').click()`);
    await frame();

    // A press of l that must change nothing: the setting is read before and after, so a key that
    // stepped three times behind three surfaces and came round to where it began is still caught.
    const nothingHappens = async (stillThere) => {
      const before = await setting();
      await key('l');
      await frame();
      return (await setting()) === before && (!stillThere || await ev(stillThere));
    };
    await rightClick('#graph-view .graph-node');
    check('plan: a right-click on a card opens its menu', await waitFor(MENU_UP, 4000));
    check('plan: with a card menu open, l does nothing', await nothingHappens(MENU_UP), await setting());
    await key('Escape');
    check('plan: Esc closes the card menu', await waitFor(MENU_SHUT, 4000));

    await pressOn('#notif-btn');
    check('plan: the notifications panel opens', await waitFor(NOTIFICATIONS_UP, 4000));
    check('plan: with the notifications panel open, l does nothing', await nothingHappens(NOTIFICATIONS_UP), await setting());
    await key('Escape');
    check('plan: Esc closes the notifications panel', await waitFor(NOTIFICATIONS_SHUT, 4000));

    await pressOn('#prefs-btn');
    check('plan: the preferences sheet opens', await waitFor(SHEET_UP, 4000));
    check('plan: with the preferences sheet open, l does nothing', await nothingHappens(SHEET_UP), await setting());
    await key('Escape');
    check('plan: Esc closes the preferences sheet', await waitFor(SHEET_SHUT, 4000));

    await blur();
    const held = await setting();
    await key('l', { ctrl: true });
    await key('l', { alt: true });
    await frame();
    check('plan: l with Ctrl or Alt held does nothing', (await setting()) === held, await setting());

    for (const other of ['flow']) {
      await ev(pickLayout(other));
      await waitFor(layoutIs(other), 10000);
      await blur();
      check(`plan: in the ${other}, l does nothing`, await nothingHappens(), await setting());
    }
    await ev(pickLayout('tiers'));
    await waitFor(layoutIs('tiers'), 10000);
    check('plan: back in Tiers the names are the parents, as they were', await settles(plan.parents), await named());
    check('plan: the Board draws the plan board', await load('plan', '/?view=board'));
    await blur();
    check('plan: outside the Graph, on the Board, l does nothing and the setting stays', await nothingHappens(), await setting());

    // --- kept for the board ------------------------------------------------------------------------------------
    await load('plan');
    await step('all');
    await step('none');
    await load('plan');
    await waitFor(ROW_SHOWN, 6000);
    check('plan: a reload keeps the Names choice: none, in the row and in the labels', await waitFor(pressedIs('names', 'none'), 6000) && await settles([]), { setting: await setting(), named: await named() });
    check('fixture: the Graph draws in Tiers', await load('fixture'));
    check('fixture: another board starts at relevant, whatever the plan board chose', (await setting()) === 'relevant', await setting());
    check('fixture: and on a fan at or below the small size relevant names every card', await settles(CASES.fixture.live), await named());
    await step('all');
    await load('plan');
    check('plan: back on the plan board its choice is as it was left', (await setting()) === 'none' && await settles([]), await setting());
    await load('fixture');
    check('fixture: and the fixture board keeps its own', (await setting()) === 'all', await setting());

    // --- a zoom, a pan and a poll leave one name for each card ----------------------------------------------------
    await load('plan');
    check('plan: with names on all every card is named', await walkTo('all') && await settles(plan.live), await named());
    await ev(ZOOM_IN);
    await waitFor(`graphCur.view.touched===true`, 4000);
    await frame();
    check('plan: after a zoom there is exactly one name for each card', await ev(LABELS_ONE) && await ev(namedAre(plan.live)) && (await ev(LABEL_COUNT)) === plan.live.length, await everyCard(plan.live));
    const bare = await ev(CANVAS_SPACE);
    check('plan: the canvas has empty space to drag from', !!bare);
    if (bare) {
      await mouse('mousePressed', bare.x, bare.y);
      await mouse('mouseMoved', bare.x + 40, bare.y + 30, { buttons: 1 });
      await mouse('mouseMoved', bare.x + 90, bare.y + 60, { buttons: 1 });
      await mouse('mouseReleased', bare.x + 90, bare.y + 60);
      await frame();
      check('plan: after a pan there is exactly one name for each card', await ev(LABELS_ONE) && await ev(namedAre(plan.live)) && (await ev(LABEL_COUNT)) === plan.live.length, await everyCard(plan.live));
    }
    check('plan: a card is added through the board\'s API', (await ev(createCard(plan.added))) === 201);
    await ev(TICK);
    check('plan: the next poll draws it', await waitFor(hasDot(plan.addedId), 8000));
    check('plan: and after the poll there is still exactly one name for each card, the new one named', await waitFor(namedAre([...plan.live, plan.addedId]), 6000) && await ev(LABELS_ONE) && (await ev(LABEL_COUNT)) === plan.live.length + 1, await everyCard([...plan.live, plan.addedId]));
    await ev(TICK);
    await frame();
    check('plan: and after another poll with nothing new, the same', await ev(LABELS_ONE) && await ev(namedAre([...plan.live, plan.addedId])) && (await ev(LABEL_COUNT)) === plan.live.length + 1, await everyCard([...plan.live, plan.addedId]));

    // --- a selection is named, and what it lights -------------------------------------------------------------------
    await load('plan');
    check('plan: relevant again, for the selection', await walkTo('relevant') && await settles(plan.parents), await named());
    let pick = null;
    let at = null;
    for (const candidate of plan.picks) {
      at = await ev(dotPoint(candidate.id));
      if (at) { pick = candidate; break; }
    }
    check('plan: a dot is there to pick', !!pick, plan.picks);
    if (pick) {
      await click(at.x, at.y);
      check('plan: a click on a dot selects it', await waitFor(`${SELECTED}.length===1&&${SELECTED}[0]===${pick.id}`, 4000), await ev(SELECTED));
      check('plan: a lone card is named with the cards it lights and the parents, painted in place', await settles(union([pick.id], pick.related, plan.parents)), { named: await named(), want: union([pick.id], pick.related, plan.parents) });
      let extra = null;
      let there = null;
      for (const id of plan.extras.filter((x) => x !== pick.id)) {
        there = await ev(dotPoint(id));
        if (there) { extra = id; break; }
      }
      check('plan: a second dot is there to add', !!extra, plan.extras);
      if (extra) {
        await click(there.x, there.y, { modifiers: 8 });
        check('plan: Shift+click adds it to the selection', await waitFor(`${SELECTED}.length===2`, 4000), await ev(SELECTED));
        check('plan: two cards named with the parents, and not their relations', await settles(union([pick.id, extra], plan.parents)), { named: await named(), want: union([pick.id, extra], plan.parents) });
      }
    }

    // --- the malformed board draws its names ------------------------------------------------------------------------
    check('malformed: the Graph draws in Tiers', await load('malformed'));
    check('malformed: relevant names the four cards of a small fan, as the model says', await ev(LABELS_ONE) && await ev(NAMED_ARE_PREDICTED('relevant')) && await settles(CASES.malformed.live), await named());
    await step('all');
    check('malformed: all names every card, as the model says', await ev(NAMED_ARE_PREDICTED('all')) && await settles(CASES.malformed.live), await named());
    await step('none');
    check('malformed: none names no card, as the model says', await ev(NAMED_ARE_PREDICTED('none')) && await settles([]), await named());
    check('malformed: and the labels are still one for each card', await ev(LABELS_ONE) && (await ev(LABEL_COUNT)) === CASES.malformed.live.length, await everyCard(CASES.malformed.live));
  },
};
