'use strict';
// A board's own pills, in the search panel. On the plan board the panel lists blocked,
// review and waiting, then the pills its config gives (a labelled one, an unlabelled
// one, and `tags:*`), then one pill per tag, sorted. The plan board has ten distinct
// tags, so eight show and a "+2 more" button stands for the rest: a click on it
// reveals the other two (and reads "fewer") and a click on it again folds them back.
// A click on the grill pill puts tags:"grill" in the box and shows the grill card on
// the Board and not the grilling card, because a value pill matches its value exactly;
// a click on it again clears the box, and a click on a second pill (Shift held or not: Shift+click
// is a plain click) grows the box to "anchor | pill". Turning a pill on leaves every pill's count as it was. With the box
// empty every board pill's count is the number of cards its query leaves on the Board.
// A focused value pill keeps its focus across a poll, and its count changes under it.
// The malformed board's panel lists the built-ins and only the two pills its config
// reader keeps, and today's fixture board, which has no `pills:`, lists only the three
// built-ins and no next-up pill (next up is a pill a board defines). The runner's own
// console-error check closes the scenario, so the malformed board is also held to
// drawing its panel without an error.
//
// The plan board's live cards are 1 to 18 and 22 to 29, with the tags and assignees
// its card files give. CASES holds what the panel lists and counts, and
// skills/web/test/browser-board-pills-scenario.test.js holds them to the search module
// and the pill list over the board's own cards and config. Each step waits on the page,
// never on a fixed sleep. Keys and clicks go through the runner's helpers, and a
// Shift+click is a real click with the Shift modifier.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// autoRefreshTick, selectedIds.

const BUILT_INS = ['blocked', 'review', 'waiting'];
// The plan board's tags, sorted, each with the cards that hold it. They are spelled in
// capitals and lowered below: a bare lower-case api in this file would read, to the
// page-globals guard (browser-globals.test.js), as the page's own api function.
const TAG_COUNTS = { API: 1, DATA: 1, DOCS: 2, GRILL: 1, GRILLING: 1, INFRA: 1, 'NEXT-UP': 2, RELEASE: 1, SECURITY: 1, UI: 2 };
const TAGS = Object.keys(TAG_COUNTS).map((name) => name.toLowerCase());
const SHOWN_TAGS = TAGS.slice(0, 8);
const REST_TAGS = TAGS.slice(8);
const fromTags = (make) => Object.fromEntries(Object.keys(TAG_COUNTS).map((name) => [name.toLowerCase(), make(name.toLowerCase(), TAG_COUNTS[name])]));

const CASES = {
  builtIns: BUILT_INS,
  own: ['next', 'assignee:@human'],
  shownTags: SHOWN_TAGS,
  restTags: REST_TAGS,
  closed: [...BUILT_INS, 'next', 'assignee:@human', ...SHOWN_TAGS, '[+2 more]'],
  open: [...BUILT_INS, 'next', 'assignee:@human', ...SHOWN_TAGS, ...REST_TAGS, '[fewer]'],
  // The count each pill shows with every status pill on and the box empty.
  counts: { blocked: 1, review: 1, waiting: 3, next: 2, 'assignee:@human': 21, ...fromTags((tag, count) => count) },
  // The query each board pill writes to the box.
  queries: { next: 'tags:"next-up"', 'assignee:@human': 'assignee:@human', ...fromTags((tag) => `tags:"${tag}"`) },
  grill: [8],
  grilling: 13,
  grillPatched: 14,
  grillPatchedCount: 2,
  next: [3, 17],
  malformed: {
    labels: [...BUILT_INS, 'tags', 'assignee:@human'],
    counts: { blocked: 0, review: 0, waiting: 1, tags: 1, 'assignee:@human': 4 },
  },
  fixture: { labels: BUILT_INS },
};

module.exports = {
  name: 'board-pills',
  board: 'plan',
  alsoBoards: ['malformed', 'fixture'],
  timeoutMs: 120000,
  CASES,
  async run(page) {
    const { ev, open, waitFor, centre, click, check } = page;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const idsExpr = (expr) => `JSON.stringify(${expr})`;
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const SHOWN = `[...new Set([...document.querySelectorAll('#board .card-el')].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b)`;
    const shown = () => ev(SHOWN);
    const shownIs = (ids) => waitFor(`${idsExpr(SHOWN)}===${JSON.stringify(JSON.stringify(ids))}`);
    const PANEL = `document.getElementById('search-panel')`;
    const panelOpen = `!${PANEL}.classList.contains('hidden')&&${PANEL}.getBoundingClientRect().height>0`;
    const SWITCH_OFF = `document.getElementById('search-panel-toggle').getAttribute('aria-pressed')==='false'`;
    // The panel opens when the box is focused while the switch (the arrow) is on, which is how a board starts. A click
    // on the arrow would switch it off, so the arrow is clicked only when the switch is already off: that turns it on and opens the panel.
    const openPanel = async () => {
      if (!(await ev(panelOpen))) {
        if (await ev(SWITCH_OFF)) {
          const p = await centre('#search-panel-toggle');
          if (!p) throw new Error('nothing matches #search-panel-toggle');
          await click(p.x, p.y);
        } else {
          await ev(`document.getElementById('search-input').focus()`);
        }
      }
      return waitFor(panelOpen);
    };

    // What the pill section holds, in order: a pill by its label, a "+N more" button as [its text].
    const ROWS = `[...document.querySelectorAll('#search-pills > *')].map((b)=>b.classList.contains('query-pill-more')?'['+b.textContent+']':b.querySelector('.query-pill-label').textContent)`;
    const rows = () => ev(ROWS);
    const rowsAre = (want) => waitFor(`${idsExpr(ROWS)}===${JSON.stringify(JSON.stringify(want))}`);
    const COUNTS = `Object.fromEntries([...document.querySelectorAll('#search-pills .query-pill')].map((b)=>[b.querySelector('.query-pill-label').textContent,Number(b.querySelector('.query-pill-count').textContent)]))`;
    const counts = () => ev(`JSON.stringify(${COUNTS})`).then(JSON.parse);
    const countsAre = (want) => waitFor(`JSON.stringify(${COUNTS})===${JSON.stringify(JSON.stringify(want))}`);
    // A pill is found by its label, never by a selector that would have to quote its key.
    const PILL = (label) => `[...document.querySelectorAll('#search-pills .query-pill')].find((b)=>b.querySelector('.query-pill-label').textContent===${JSON.stringify(label)})`;
    const pillPoint = (label) => ev(`(()=>{const b=${PILL(label)};if(!b)return null;const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const clickPill = async (label, extra = {}) => {
      const p = await pillPoint(label);
      if (!p) throw new Error(`no pill labelled ${label}`);
      await click(p.x, p.y, extra);
    };
    const pillState = (label) => ev(`(()=>{const b=${PILL(label)};return b?b.getAttribute('aria-pressed')+'/'+b.classList.contains('on'):null})()`);
    const pillIsOn = async (label) => (await pillState(label)) === 'true/true';
    const pillIsOff = async (label) => (await pillState(label)) === 'false/false';
    const MORE = `document.querySelector('#search-pills .query-pill-more')`;
    const clickMore = async () => {
      const p = await ev(`(()=>{const b=${MORE};if(!b)return null;const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      if (!p) throw new Error('there is no more button');
      await click(p.x, p.y);
    };
    // The board's own API, from the page: gives a card tags and answers the status.
    const patchCard = (id, changes) => ev(`fetch('/api/cards/${id}',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(changes)})}).then((r)=>r.status)`);
    // Loads a page cold; the stale flag keeps the page being left from answering for the new one.
    const goto = async (target, ready, boardKey) => {
      await ev(`window.__stale=true`);
      await open(target, boardKey);
      await waitFor(`window.__stale!==true`, 10000);
      return waitFor(ready, 10000);
    };
    const boardReady = `document.querySelectorAll('#board .card-el').length>20`;
    const named = (name) => `document.getElementById('project-name').textContent===${JSON.stringify(name)}&&document.querySelectorAll('#board .card-el').length>0`;

    // --- the plan board: what the panel lists, and the count each pill shows -----------------------
    check('the Board draws the plan board', await goto('/', boardReady));
    const liveIds = await shown();
    await openPanel();
    check('the panel lists blocked, review and waiting, then the board\'s pills, then one pill per tag, eight of them, then "+2 more"', await rowsAre(CASES.closed), await rows());
    const keys = await ev(`[...document.querySelectorAll('#search-pills > *')].map((b)=>b.dataset.pillKey)`);
    check('each button has a key of its own, and the value pills are keyed by field and value', new Set(keys).size === keys.length && keys.includes('value:tags:grill') && keys.includes('more:tags'), keys);
    const closedCounts = Object.fromEntries(Object.entries(CASES.counts).filter(([label]) => CASES.closed.includes(label)));
    check('each pill shows the number of cards its query matches, with the box empty', await countsAre(closedCounts), await counts());
    check('no pill is on to start', await ev(`[...document.querySelectorAll('#search-pills .query-pill')].every((b)=>b.getAttribute('aria-pressed')==='false')`));

    // --- "+2 more" reveals the rest and folds them back ------------------------------------------------
    check('the more button says it is closed', await ev(`${MORE}.getAttribute('aria-expanded')==='false'`));
    await ev(`window.__more=${MORE}`);
    await clickMore();
    check('"+2 more" reveals the other two tag pills, and the button reads "fewer"', await rowsAre(CASES.open), await rows());
    check('the button says it is open, and is the button it was', await ev(`${MORE}.getAttribute('aria-expanded')==='true'&&${MORE}===window.__more`));
    check('every pill shows its count, the revealed ones too', await countsAre(CASES.counts), await counts());
    await clickMore();
    check('"fewer" folds them back: eight tag pills and "+2 more" again', await rowsAre(CASES.closed), await rows());
    check('the button is still the button it was, and says it is closed', await ev(`${MORE}===window.__more&&${MORE}.getAttribute('aria-expanded')==='false'`));
    check('a click on the more button changes neither the box nor the selection', (await boxText()) === '' && await ev(`selectedIds.size===0`));
    await clickMore();
    await rowsAre(CASES.open);

    // --- a click on the grill pill: exact, so the grilling card stays out ------------------------------
    await clickPill('grill');
    check('a click on the grill pill writes tags:"grill" in the box', await boxIs(CASES.queries.grill), await boxText());
    check('the Board shows the grill card', await shownIs(CASES.grill), await shown());
    check('the Board hides the grilling card, which tags:grill would have caught', !(await shown()).includes(CASES.grilling));
    check('the grill pill is on and announced as pressed', await pillIsOn('grill') && await pillIsOff('grilling'));
    check('turning the grill pill on leaves every pill\'s count as it was', await countsAre(CASES.counts), await counts());
    await clickPill('next', { modifiers: 8 });
    check('a Shift+click on the next pill grows the box to "tags:"grill" | tags:"next-up""', await boxIs(`${CASES.queries.grill} | ${CASES.queries.next}`), await boxText());
    check('the Board shows the grill card and the next-up cards', await shownIs([...CASES.grill, ...CASES.next].sort((a, b) => a - b)), await shown());
    check('the next pill is on, and so is the next-up value pill, which writes the same query', await pillIsOn('next') && await pillIsOn('next-up') && await pillIsOn('grill'));
    check('turning the second pill on leaves every pill\'s count as it was', await countsAre(CASES.counts), await counts());
    await clickPill('next');
    check('a click on the next pill takes it out of the box again and leaves the grill pill on', await boxIs(CASES.queries.grill) && await pillIsOn('grill') && await pillIsOff('next'), await boxText());
    await clickPill('grill');
    check('a click on the grill pill again clears the box', await boxIs(''), await boxText());
    check('and brings every card back to the Board', await shownIs(liveIds));
    check('and the grill pill is off', await pillIsOff('grill'));

    // --- with the box empty, each board pill's count is what its query leaves on the Board ---------------
    for (const label of [...CASES.own, ...SHOWN_TAGS, ...REST_TAGS]) {
      const count = CASES.counts[label];
      await clickPill(label);
      const wrote = await boxIs(CASES.queries[label]);
      const left = await waitFor(`${SHOWN}.length===${count}`);
      check(`the ${label} pill shows ${count} and its query leaves ${count} on the Board`, wrote && left, { box: await boxText(), shown: (await shown()).length });
      await clickPill(label);
      await boxIs('');
      await shownIs(liveIds);
    }

    // --- a focused value pill keeps its focus across a poll -------------------------------------------------------
    await ev(`(()=>{const b=${PILL('grill')};window.__pill=b;b.focus()})()`);
    check('the grill pill has focus', await ev(`document.activeElement===window.__pill`));
    check('a card is given the grill tag through the board\'s API', (await patchCard(CASES.grillPatched, { tags: ['grill'] })) === 200);
    await ev(`autoRefreshTick()`);
    check('the poll updates the grill count in place', await waitFor(`Number(${PILL('grill')}.querySelector('.query-pill-count').textContent)===${CASES.grillPatchedCount}`), await counts());
    check('the pill that had focus is the same element and has it still', await ev(`document.activeElement===window.__pill&&document.contains(window.__pill)&&${PILL('grill')}===window.__pill`));
    check('the other pills kept their counts', await ev(`${COUNTS}['grilling']===${CASES.counts.grilling}&&${COUNTS}['next-up']===${CASES.counts['next-up']}`));
    check('the field is still open after the poll', await rowsAre(CASES.open), await rows());

    // --- the malformed board: the built-ins and the entries its reader keeps ------------------------------------------
    check('the malformed board loads', await goto('/', named('malformed'), 'malformed'));
    await openPanel();
    check('the malformed board\'s panel lists the built-ins and the two pills its config reader keeps', await rowsAre(CASES.malformed.labels), await rows());
    check('and counts each one', await countsAre(CASES.malformed.counts), await counts());
    check('and has no more button', await ev(`document.querySelectorAll('#search-pills .query-pill-more').length===0`));

    // --- today's fixture board has no pills: the three built-ins, and no next-up pill --------------------------------------
    check('the fixture board loads', await goto('/', named('fixture'), 'fixture'));
    await openPanel();
    check('the fixture board\'s panel lists only blocked, review and waiting', await rowsAre(CASES.fixture.labels), await rows());
    check('and has no next-up pill, and no more button', await ev(`![...document.querySelectorAll('#search-pills > *')].some((b)=>/next/i.test(b.textContent))&&document.querySelectorAll('#search-pills .query-pill-more').length===0`));
    check('and each of its pills shows a number', await ev(`[...document.querySelectorAll('#search-pills .query-pill-count')].every((c)=>/^\\d+$/.test(c.textContent))`));
    check('the three keys are the built-ins', same(await ev(`[...document.querySelectorAll('#search-pills > *')].map((b)=>b.dataset.pillKey)`), BUILT_INS));
  },
};
