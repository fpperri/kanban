'use strict';
// The search panel's slice section, on the plan board, whose hierarchy is goal, strategy,
// objective, epic: it starts folded, and unfolded it lists the four tiers in hierarchy order,
// each with its type's icon and a count that is what the Board shows for that slice, then the
// depths. A click outside the run grows it, a click on an end drops that end, a click inside
// the run that is not an end changes nothing, a click on a run of one brings every slice back
// and writes no term, and a right-click keeps only that slice; each writes the slice: term the
// Board cuts by. A term typed by hand shows at once as the entries in the run, and each entry's
// name states its label, its count and whether it is in the run. The context-menu key and
// Shift+F10 on a focused entry each keep only that slice. Tab reaches the fold control and every
// entry, and Enter and Space act as a click. The keys [ ] { } move the run's ends on the Board
// and in the Calendar, with the search panel open and with it shut, and do nothing with focus in
// the search box or while a card menu, a dialog, the notifications panel or the preferences
// sheet is up. In the Graph, with tags:ui | #12 typed, a run set from the section leaves the
// cards outside it undrawn and lights, of the cards drawn, only the matches. With the panel shut
// the chip counts a run. The preferences sheet's "Slice section starts folded" is on to start,
// and unchecked it unfolds the section after a reload. Today's fixture board, with no hierarchy,
// lists depths only; the malformed board lists each tier once, then the depths, with no console
// error (the harness closes the scenario with that check).
//
// What each step shows is written down in CASES, and
// test/web/browser-slice-section.test.js holds those lists to the slices module, the
// search module and the run arithmetic over each board's own cards, so a wrong expectation
// fails in the unit suite and not only in a browser.
//
// The plan board's live cards are 1 to 18 and 22 to 29; its goals are cards 1 and 25, its
// strategies 2 and 26, its objective 7 and its epic 22. The card dated in 2031 (28) and the one
// dated in 2020 (29) both sit at depth 0, so the Calendar draws one of them once the run
// takes depth 0 in, and none before. Cards 11 and 17 carry the ui tag, and card 12 is at
// depth 0 too. A depth counts from the nearest tier card down: cards 3 to 6, 8 and 23 sit right
// under a goal, a strategy or the epic, so they are depth 0 as well, and the one card under
// them, 24, is depth 1. Each step waits on the page, never on a fixed sleep; a "nothing happened" check
// waits two animation frames. Keys go through the runner's key helper, a real key press.

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const without = (list, drop) => list.filter((id) => !drop.includes(id));

const LIVE = [...range(1, 18), ...range(22, 29)];
const DEPTH_ZERO = [...range(9, 18), 27, 28, 29, 3, 4, 5, 6, 8, 23].sort((a, b) => a - b);

const CASES = {
  plan: {
    live: LIVE,
    keys: ['t:goal', 't:strategy', 't:objective', 't:epic', 'd:0', 'd:1'],
    labels: ['goal', 'strategy', 'objective', 'epic', 'depth 0', 'depth 1'],
    counts: [2, 2, 1, 1, 19, 1],
    icons: ['★', '⬢', '◆', '■', '', ''],
    cards: { goal: [1, 25], strategy: [2, 26], objective: [7], epic: [22], 'depth 0': DEPTH_ZERO, 'depth 1': [24] },
    steps: [
      { name: 'a click on goal, which is in the run as the top end, drops it', gesture: 'click', key: 't:goal', term: 'slice:strategy..', shows: without(LIVE, [1, 25]), pressed: 5 },
      { name: 'a click on depth 1, now the bottom end, drops it and writes both ends', gesture: 'click', key: 'd:1', term: 'slice:strategy..0', shows: without(LIVE, [1, 25, 24]), pressed: 4 },
      { name: 'a click on goal, outside the run, grows the run to it and leaves the open top end', gesture: 'click', key: 't:goal', term: 'slice:..0', shows: without(LIVE, [24]), pressed: 5 },
      { name: 'a click on objective, inside the run and not an end, changes nothing', gesture: 'click', key: 't:objective', term: 'slice:..0', shows: without(LIVE, [24]), pressed: 5 },
      { name: 'a right-click on epic keeps only that slice', gesture: 'right-click', key: 't:epic', term: 'slice:epic', shows: [22], pressed: 1 },
      { name: 'a click on epic, a run of one, brings every slice back and writes no term', gesture: 'click', key: 't:epic', term: '', shows: LIVE, pressed: 6 },
      { name: 'a right-click on depth 1 keeps only that depth', gesture: 'right-click', key: 'd:1', term: 'slice:1', shows: [24], pressed: 1 },
    ],
    typed: { query: 'slice:objective..epic', pressed: ['objective', 'epic'], inName: 'objective, 1 card, in the run', outName: 'goal, 2 cards, not in the run', unknown: 'slice:nosuch' },
    menuKey: { key: 't:strategy', term: 'slice:strategy', shows: [2, 26] },
    shiftF10: { key: 'd:1', term: 'slice:1', shows: [24] },
    keyboard: { enterKey: 't:goal', afterEnter: 'slice:strategy..', afterSpace: '' },
    sweep: {
      start: 'slice:objective..epic',
      before: [7, 22],
      afterClose: { term: 'slice:objective..0', shows: [7, 22, ...DEPTH_ZERO].sort((a, b) => a - b) },
      afterOpen: { term: 'slice:strategy..0', shows: [2, 7, 22, 26, ...DEPTH_ZERO].sort((a, b) => a - b) },
      dated: [28, 29],
    },
    graph: { query: 'tags:ui | #12', lit: [11, 12, 17], term: '(tags:ui | #12) slice:0', draws: DEPTH_ZERO },
    chip: { term: 'slice:goal..epic', name: '1 on: slice goal..epic' },
  },
  fixture: {
    labels: ['depth 0', 'depth 1', 'depth 2'],
    counts: [11, 5, 2],
  },
  malformed: {
    labels: ['Goal', 'Epic', 'depth 0'],
    counts: [1, 1, 2],
    icons: ['', '★', ''],
  },
};

const plural = (n) => (n === 1 ? 'card' : 'cards');

module.exports = {
  name: 'slice-section',
  board: 'plan',
  alsoBoards: ['fixture', 'malformed'],
  timeoutMs: 120000,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, rightClick, check } = page;
    const idsExpr = (selector) => `JSON.stringify([...new Set([...document.querySelectorAll(${JSON.stringify(selector)})].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b))`;
    const sameJson = (expr, wanted) => `${expr}===${JSON.stringify(JSON.stringify(wanted))}`;
    const BOARD = '#board .card-el';
    const CALENDAR = '#calendar-view .cal-chip[data-id]';
    const GRAPH = '#graph-view .graph-node';
    const shownIs = (selector, ids, ms) => waitFor(sameJson(idsExpr(selector), ids), ms);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const boxNow = () => ev(`document.getElementById('search-input').value`);
    const write = (text) => ev(`(()=>{const i=document.getElementById('search-input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);

    const PANEL = `document.getElementById('search-panel')`;
    const TOGGLE = `document.getElementById('search-panel-toggle')`;
    const panelOpen = `!${PANEL}.classList.contains('hidden')&&${PANEL}.getBoundingClientRect().height>0`;
    const panelShut = `${PANEL}.classList.contains('hidden')`;
    const SWITCH_ON = `${TOGGLE}.getAttribute('aria-pressed')==='true'`;
    const SECTION = `document.getElementById('search-slices')`;
    const FOLD = `document.getElementById('search-slices-fold')`;
    const sectionShown = `!${SECTION}.classList.contains('hidden')&&${SECTION}.getBoundingClientRect().height>0`;
    const sectionFolded = `${SECTION}.classList.contains('hidden')&&${FOLD}.getAttribute('aria-expanded')==='false'`;
    const entrySel = (entryKey) => `#search-slices .slice-entry[data-slice-key="${entryKey}"]`;
    const ENTRY_ROWS = `[...document.querySelectorAll('#search-slices .slice-entry')]`;
    const LIST = `JSON.stringify(${ENTRY_ROWS}.map((b)=>[b.querySelector('.slice-entry-label').textContent,Number(b.querySelector('.slice-entry-count').textContent),b.querySelector('.slice-entry-icon').textContent]))`;
    const PRESSED = `${ENTRY_ROWS}.filter((b)=>b.getAttribute('aria-pressed')==='true'&&b.classList.contains('on')).map((b)=>b.querySelector('.slice-entry-label').textContent)`;
    const NAMES = `JSON.stringify(${ENTRY_ROWS}.map((b)=>b.getAttribute('aria-label')))`;
    const FOCUS_NOW = `(()=>{const a=document.activeElement;return a?(a.id||a.dataset.sliceKey||a.tagName):''})()`;
    const chip = () => ev(`(()=>{const c=document.getElementById('search-chip');return {hidden:c.classList.contains('hidden')||c.getBoundingClientRect().width===0,text:c.textContent,name:c.getAttribute('aria-label')||''}})()`);

    const clickOn = async (sel, extra = {}) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y, extra);
    };
    const goto = async (target, ready, boardKey) => {
      await ev('window.__stale=true');
      await open(target, boardKey);
      await waitFor('window.__stale!==true', 10000);
      return waitFor(ready, 10000);
    };
    const boardReady = `document.querySelectorAll('${BOARD}').length>3`;
    // The panel opens on focus while the switch is on, the default, and shuts with the switch off.
    // Either way no field keeps the focus, so a key is read by the page and not typed.
    const setPanel = async (wanted) => {
      if (wanted) {
        if (!(await ev(SWITCH_ON))) await clickOn('#search-panel-toggle');
        else await ev(`document.getElementById('search-input').focus()`);
        await waitFor(panelOpen);
      } else {
        if (await ev(SWITCH_ON)) await clickOn('#search-panel-toggle');
        await waitFor(panelShut);
      }
      return ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    };
    const unfold = async () => {
      if (!(await ev(sectionShown))) await clickOn('#search-slices-fold');
      return waitFor(sectionShown);
    };
    const gesture = async (kind, entryKey) => {
      if (kind === 'right-click') await rightClick(entrySel(entryKey));
      else await clickOn(entrySel(entryKey));
    };
    const focusEntry = (entryKey) => ev(`document.querySelector(${JSON.stringify(entrySel(entryKey))}).focus()`);
    const names = (cases, counts, on) => cases.labels.map((label, i) => `${label}, ${counts[i]} ${plural(counts[i])}, ${on[i] ? 'in the run' : 'not in the run'}`);

    // --- the plan board: folded to start, then the list ---------------------------------------------------
    const plan = CASES.plan;
    check('the Board draws the plan board', await goto('/', boardReady));
    await ev(`document.getElementById('search-input').focus()`);
    check('focusing the box opens the panel', await waitFor(panelOpen));
    check('the slice section starts folded: its entries are out of sight and its fold control says so', await waitFor(sectionFolded));
    await clickOn('#search-slices-fold');
    check('the fold control unfolds it, and says so', await waitFor(sectionShown) && await ev(`${FOLD}.getAttribute('aria-expanded')==='true'`));
    check('the section lists the four tiers in hierarchy order, then the depths, each with its icon and its count',
      await waitFor(sameJson(LIST, plan.labels.map((label, i) => [label, plan.counts[i], plan.icons[i]]))), await ev(LIST));
    check('every slice is in the run to start, and the box holds no term', await waitFor(sameJson(`JSON.stringify(${PRESSED})`, plan.labels)) && await boxIs(''));
    check('each entry\'s name states its label, its count and that it is in the run',
      await waitFor(sameJson(NAMES, names(plan, plan.counts, plan.labels.map(() => true)))), await ev(NAMES));
    check('the entries are buttons of their own, and none holds the poll', await ev(`${ENTRY_ROWS}.length===${plan.keys.length}&&${ENTRY_ROWS}.every((b)=>b.tagName==='BUTTON'&&b.type==='button'&&!b.classList.contains('query-pill')&&b.hasAttribute('data-keeps-selection')&&!b.hasAttribute('data-holds-poll'))`));
    for (const [at, entryKey] of plan.keys.entries()) {
      const label = plan.labels[at];
      if (!plan.cards[label].length) continue;
      await rightClick(entrySel(entryKey));
      check(`${label}: the Board shows the slice's cards, as many as its count says`,
        await shownIs(BOARD, plan.cards[label]) && await waitFor(`Number(document.querySelector(${JSON.stringify(`${entrySel(entryKey)} .slice-entry-count`)}).textContent)===JSON.parse(${idsExpr(BOARD)}).length`), await ev(idsExpr(BOARD)));
    }
    await write('');
    await waitFor(`${PRESSED}.length===${plan.keys.length}`);

    // --- clicks and right-clicks write the term the Board cuts by -------------------------------------------
    for (const step of plan.steps) {
      await gesture(step.gesture, step.key);
      check(`${step.name}: the box holds ${step.term || 'no term'}`, await boxIs(step.term), await boxNow());
      check(`${step.name}: the Board shows the cards inside the run`, await shownIs(BOARD, step.shows), await ev(idsExpr(BOARD)));
      check(`${step.name}: ${step.pressed} entries are pressed`, await waitFor(`${PRESSED}.length===${step.pressed}`));
    }
    check('every entry\'s count is as it was after those cuts: a run never zeroes the entries needed to grow it again', await waitFor(sameJson(LIST, plan.labels.map((label, i) => [label, plan.counts[i], plan.icons[i]]))));

    // --- a term typed by hand updates which entries are pressed ---------------------------------------------
    await write(plan.typed.query);
    check('a slice: term typed by hand shows as the entries in the run', await waitFor(sameJson(`JSON.stringify(${PRESSED})`, plan.typed.pressed)), await ev(`JSON.stringify(${PRESSED})`));
    check('an entry in the run says so in its name, and one outside it says that', await waitFor(`${ENTRY_ROWS}.some((b)=>b.getAttribute('aria-label')===${JSON.stringify(plan.typed.inName)})&&${ENTRY_ROWS}.some((b)=>b.getAttribute('aria-label')===${JSON.stringify(plan.typed.outName)})`), await ev(NAMES));
    await write(plan.typed.unknown);
    check('a single unknown slice name cuts nothing, so every entry shows as pressed', await waitFor(`${PRESSED}.length===${plan.keys.length}`));
    await write('');

    // --- the context-menu key and Shift+F10 on a focused entry ----------------------------------------------
    await focusEntry(plan.menuKey.key);
    await key('ContextMenu');
    check('the context-menu key on a focused entry keeps only that slice', await boxIs(plan.menuKey.term) && await shownIs(BOARD, plan.menuKey.shows), await boxNow());
    await write('');
    await focusEntry(plan.shiftF10.key);
    await key('F10', { shift: true });
    check('Shift+F10 on a focused entry keeps only that slice', await boxIs(plan.shiftF10.term) && await shownIs(BOARD, plan.shiftF10.shows), await boxNow());
    await write('');
    await waitFor(`${PRESSED}.length===${plan.keys.length}`);

    // --- Tab reaches the fold control and every entry, Enter and Space act as a click ------------------------
    await ev(`${TOGGLE}.focus()`);
    const seen = [];
    for (let i = 0; i < plan.keys.length + 3; i++) {
      await key('Tab');
      seen.push(await ev(FOCUS_NOW));
    }
    check('Tab reaches the Isolate switch beside the box, then the fold control, then every entry in order, then the pill section\'s fold control', JSON.stringify(seen) === JSON.stringify(['isolate-switch', 'search-slices-fold', ...plan.keys, 'search-pills-fold']), seen);
    await focusEntry(plan.keyboard.enterKey);
    await key('Enter');
    check('Enter on a focused entry acts as a click', await boxIs(plan.keyboard.afterEnter), await boxNow());
    await focusEntry(plan.keyboard.enterKey);
    await key(' ');
    check('Space on a focused entry acts as a click', await boxIs(plan.keyboard.afterSpace), await boxNow());

    // --- the keys [ ] { }: the Board and the Calendar, the panel open and shut ---------------------------------
    const sweep = plan.sweep;
    for (const view of ['board', 'calendar']) {
      for (const panelOn of [true, false]) {
        const where = `${view}, panel ${panelOn ? 'open' : 'shut'}`;
        const url = view === 'board' ? '/' : `/?view=calendar&q=${encodeURIComponent('slice:0')}`;
        await goto(url, view === 'board' ? boardReady : `document.querySelectorAll('${CALENDAR}').length>0`);
        await write(sweep.start);
        if (view === 'board') check(`${where}: the run objective..epic shows its two cards`, await shownIs(BOARD, sweep.before));
        else check(`${where}: the Calendar draws no dated card while the run leaves out depth 0`, await shownIs(CALENDAR, []));
        await setPanel(panelOn);
        await key(']');
        check(`${where}: ] moves the bottom of the run down`, await boxIs(sweep.afterClose.term), await boxNow());
        if (view === 'board') check(`${where}: ] brings depth 0 into the Board`, await shownIs(BOARD, sweep.afterClose.shows));
        else check(`${where}: ] brings a dated card at depth 0 into the Calendar`, await waitFor(`(()=>{const ids=JSON.parse(${idsExpr(CALENDAR)});return ids.length>0&&ids.every((id)=>${JSON.stringify(sweep.dated)}.includes(id))})()`));
        await key('{', { shift: true });
        check(`${where}: { moves the top of the run up`, await boxIs(sweep.afterOpen.term), await boxNow());
        if (view === 'board') check(`${where}: { brings the strategy cards into the Board`, await shownIs(BOARD, sweep.afterOpen.shows));
        if (panelOn) check(`${where}: the entries follow the keys`, await waitFor(`${PRESSED}.length===${plan.labels.indexOf('depth 0') - plan.labels.indexOf('strategy') + 1}`));
      }
    }

    // --- the keys do nothing while someone types, or a popup is up ---------------------------------------------
    await goto('/', boardReady);
    await write(sweep.start);
    await setPanel(true);
    await ev(`document.getElementById('search-input').focus()`);
    await key(']');
    check('with focus in the search box, ] is typed and moves no run', await boxIs(`${sweep.start}]`) && await ev(`document.activeElement===document.getElementById('search-input')`), await boxNow());
    await write(sweep.start);
    await ev(`document.activeElement.blur()`);
    const card = plan.cards.objective[0];
    await rightClick(`#board .card-el[data-id="${card}"]`);
    check('a card menu opens', await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`));
    await key(']');
    await key('{', { shift: true });
    check('with a card menu up, the keys leave the run as it was', await frames() && await boxIs(sweep.start), await boxNow());
    await key('Escape');
    check('Esc closes the card menu', await waitFor(`document.getElementById('context-menu').classList.contains('hidden')`));
    await goto(`/?card=${card}`, `!document.getElementById('detail-modal').classList.contains('hidden')`);
    check('a card opens its dialog', await waitFor(`!document.getElementById('detail-modal').classList.contains('hidden')`));
    await write(sweep.start);
    await key(']');
    check('with a dialog open, the keys leave the run as it was', await frames() && await boxIs(sweep.start), await boxNow());
    await key('Escape');
    check('Esc closes the dialog', await waitFor(`document.getElementById('detail-modal').classList.contains('hidden')`));
    await clickOn('#notif-btn');
    check('the notifications panel opens', await waitFor(`!document.getElementById('notif-modal').classList.contains('hidden')`));
    await key(']');
    check('with the notifications panel open, the keys leave the run as it was', await frames() && await boxIs(sweep.start), await boxNow());
    await key('Escape');
    check('Esc closes the notifications panel', await waitFor(`document.getElementById('notif-modal').classList.contains('hidden')`));
    await clickOn('#prefs-btn');
    check('the preferences sheet opens', await waitFor(`!document.getElementById('prefs-sheet').classList.contains('hidden')`));
    await key(']');
    check('with the preferences sheet open, the keys leave the run as it was', await frames() && await boxIs(sweep.start), await boxNow());
    await key('Escape');
    check('Esc closes the preferences sheet', await waitFor(`document.getElementById('prefs-sheet').classList.contains('hidden')`));
    await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    await key(']');
    check('and with everything shut again, ] moves the run', await boxIs(sweep.afterClose.term), await boxNow());

    // --- the chip counts a run when the panel is shut ---------------------------------------------------------------
    await write(plan.chip.term);
    await setPanel(false);
    const counted = await chip();
    check('with the panel shut and a run on, the chip counts it and names it', counted.hidden === false && counted.text === '1' && counted.name === plan.chip.name, counted);
    await write('');
    check('with no run the chip is gone', await waitFor(`document.getElementById('search-chip').classList.contains('hidden')`));
    await setPanel(true);

    // --- the Graph: a run set from the section hides, the rest of the query lights --------------------------------
    const graph = plan.graph;
    await goto('/?view=graph', `document.querySelectorAll('${GRAPH}').length>20`);
    await ev(`document.getElementById('search-input').focus()`);
    await waitFor(panelOpen);
    await unfold();
    await ev(`document.getElementById('search-input').focus()`);
    await send('Input.insertText', { text: graph.query });
    const LIT = `JSON.stringify([...document.querySelectorAll('.graph-node.graph-near')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b))`;
    check('typed in the Graph, tags:ui | #12 lights its matches and hides nothing', await waitFor(sameJson(LIT, graph.lit)) && await waitFor(`document.querySelectorAll('${GRAPH}').length>20`), await ev(LIT));
    await rightClick(entrySel('d:0'));
    check('a run set from the section writes the term at the top level, around the typed query', await boxIs(graph.term), await boxNow());
    check('the cards outside the run are undrawn', await shownIs(GRAPH, graph.draws), await ev(idsExpr(GRAPH)));
    check('of the cards drawn, only the matches light', await waitFor(sameJson(LIT, graph.lit)) && await waitFor(`document.querySelector('.graph-canvas').classList.contains('graph-dim')`), await ev(LIT));

    // --- the preferences sheet's setting -------------------------------------------------------------------------------
    await goto('/', boardReady);
    await clickOn('#prefs-btn');
    await waitFor(`!document.getElementById('prefs-sheet').classList.contains('hidden')`);
    await waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 2500);
    check('the sheet shows "Slice section starts folded" on', await ev(`document.getElementById('prefs-slices-folded').checked===true`));
    await clickOn('#prefs-slices-folded');
    check('unchecking it unfolds the section for the next visit', await waitFor(`document.getElementById('prefs-slices-folded').checked===false`));
    await key('Escape');
    await waitFor(`document.getElementById('prefs-sheet').classList.contains('hidden')`);
    await goto('/', boardReady);
    await ev(`document.getElementById('search-input').focus()`);
    check('after a reload the section starts unfolded', await waitFor(panelOpen) && await waitFor(sectionShown) && await ev(`${FOLD}.getAttribute('aria-expanded')==='true'`));

    // --- today's fixture board: no hierarchy, so depths only ---------------------------------------------------------------
    const fixture = CASES.fixture;
    await goto('/', boardReady, 'fixture');
    await ev(`document.getElementById('search-input').focus()`);
    await waitFor(panelOpen);
    await unfold();
    check('fixture: the section lists depths only', await waitFor(sameJson(`JSON.stringify(${ENTRY_ROWS}.map((b)=>[b.querySelector('.slice-entry-label').textContent,Number(b.querySelector('.slice-entry-count').textContent)]))`, fixture.labels.map((label, i) => [label, fixture.counts[i]]))), await ev(LIST));

    // --- the malformed board: each tier once, then the depths ----------------------------------------------------------------
    const malformed = CASES.malformed;
    await goto('/', 'document.querySelectorAll(\'#board .card-el\').length>1', 'malformed');
    await ev(`document.getElementById('search-input').focus()`);
    await waitFor(panelOpen);
    await unfold();
    check('malformed: the section lists each tier once, then the depths', await waitFor(sameJson(LIST, malformed.labels.map((label, i) => [label, malformed.counts[i], malformed.icons[i]]))), await ev(LIST));
  },
};
