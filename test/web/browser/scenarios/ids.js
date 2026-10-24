'use strict';
// Ids with a prefix, end to end, on the ids board: plain cards 3, 7, 9 and 10 beside the
// goals G3, G4 and G10, the loose card _12 and the deep-work card DW845 (and an archived G2).
// The whole id is the identity, so #3 and #G3 are two cards everywhere the page keys a
// card: the Board's columns, sorted plain numbers first and then each prefix by its number;
// the waiting badges; the search box; the selection; the card popup and its ?card= link, a
// mention chip and the list of children; the Graph. Through the board's API: the
// doing gate resolves a waiting_for entry by its whole id, a new card takes the prefix its type
// declares and its own counter, a type change leaves the id alone, and a reorder moves a card
// among the children of G3. The board's config declares prefixes G for goal and DW for
// deep-work, a counter for each, and idDigits 4.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectedIds.

// The live cards in the order of the id rule: plain numbers, then each prefix by its number.
const LIVE = ['3', '7', '9', '10', 'DW845', 'G3', 'G4', 'G10', '_12'];

// The Board's columns as the default sort lays them out: priority first, then the id rule, with
// the ranked children of G3 (7, G10, _12) ahead of the cards without a rank.
const COLUMNS = {
  backlog: ['9', '10'],
  todo: ['7', 'G10', '_12', '3', 'DW845', 'G4'],
  doing: ['G3'],
  done: [],
};
// The todo column once it is sorted by id: plain numbers, then each prefix by its number.
const TODO_BY_ID = ['3', '7', 'DW845', 'G4', 'G10', '_12'];

const CASES = {
  live: LIVE,
  columns: COLUMNS,
  todoById: TODO_BY_ID,
  waiting: { G4: '#G3', DW845: '#G3, #3' },
  search: [
    { query: '#G3', shows: ['G3'] },
    { query: '#3', shows: ['3'] },
    { query: '#7', shows: ['7'] },
    { query: 'id:_12', shows: ['_12'] },
    { query: '#DW845', shows: ['DW845'] },
    { query: 'ids#G10', shows: ['G10'] },
    { query: '#G3 | #3', shows: ['3', 'G3'] },
  ],
  children: ['7', 'G10', '_12'],
};

const byId = (a, b) => LIVE.indexOf(a) - LIVE.indexOf(b);

module.exports = {
  name: 'ids',
  board: 'ids',
  timeoutMs: 90000,
  CASES,
  async run(page) {
    const { ev, send, open, waitFor, click, key, check } = page;
    const sortedIds = (ids) => ids.slice().sort(byId);
    const ORDER = JSON.stringify(LIVE);
    const shownExpr = `[...new Set([...document.querySelectorAll('#board .card-el')].map((e)=>e.dataset.id))].sort((a,b)=>${ORDER}.indexOf(a)-${ORDER}.indexOf(b))`;
    const shownNow = () => ev(shownExpr);
    const boardShows = (wanted, ms) => waitFor(`JSON.stringify(${shownExpr})===${JSON.stringify(JSON.stringify(wanted))}`, ms);
    const column = (name) => ev(`[...document.querySelectorAll('#board .column[data-col="${name}"] .card-el')].map((e)=>e.dataset.id)`);
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const clearBox = () => ev(`document.getElementById('search-clear-btn').click()`);
    const selected = async () => sortedIds(await ev('[...selectedIds]'));
    // The board's API from the runner, not from the page: a refused request (the gate answers 422) is logged by the
    // page as a console error, and the scenario wants the refusal, not the log.
    const api = async (method, path, body) => {
      const res = await fetch(`${page.base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const title = () => ev(`document.getElementById('detail-title').textContent`);
    const cardParam = () => ev(`new URLSearchParams(location.search).get('card')`);
    const popupClosed = () => waitFor(`document.getElementById('detail-modal').classList.contains('hidden')`, 3000);
    const cardIn = (container, id) => `${container} .card-el[data-id="${id}"]`;

    // A point on the card that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (sel) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    const clickCard = async (sel, extra = {}) => {
      const p = await cardPoint(sel);
      if (!p) throw new Error(`no clickable point on ${sel}`);
      await click(p.x, p.y, extra);
    };

    // --- the Board ------------------------------------------------------------------------------
    await open('/');
    check('the Board shows the nine live cards, #3 and #G3 among them as two cards', await boardShows(LIVE, 10000), await shownNow());
    for (const [name, wanted] of Object.entries(COLUMNS)) {
      check(`the ${name} column lists its cards plain numbers first, then each prefix by its number`, JSON.stringify(await column(name)) === JSON.stringify(wanted), await column(name));
    }
    for (const [id, text] of Object.entries(CASES.waiting)) {
      check(`card ${id} says what it waits on by the whole id`, (await ev(`(document.querySelector('#board .card-el[data-id="${id}"] .waiting-badge')||{}).textContent`)) === `Waiting on: ${text}`, await ev(`(document.querySelector('#board .card-el[data-id="${id}"] .waiting-badge')||{}).textContent`));
    }
    check('the card heads read the whole id', JSON.stringify(await ev(`['G3','3','_12','DW845'].map((id)=>document.querySelector('#board .card-el[data-id="'+id+'"] .card-id').textContent.split(' ')[0])`)) === JSON.stringify(['#G3', '#3', '#_12', '#DW845']), await ev(`[...document.querySelectorAll('#board .card-id')].map((e)=>e.textContent)`));
    await ev(`(()=>{const s=document.querySelector('.column-sort-field[data-col="todo"]');s.value='id';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    check('sorted by id, the todo column reads plain numbers first and then each prefix by its number', await waitFor(`JSON.stringify([...document.querySelectorAll('#board .column[data-col="todo"] .card-el')].map((e)=>e.dataset.id))===${JSON.stringify(JSON.stringify(TODO_BY_ID))}`, 3000), await column('todo'));

    // --- the search box -------------------------------------------------------------------------
    await ev(`document.getElementById('search-input').focus()`);
    for (const { query, shows } of CASES.search) {
      await clearBox();
      await ev(`document.getElementById('search-input').focus()`);
      await send('Input.insertText', { text: query });
      const wanted = sortedIds(shows);
      check(`${query} shows ${wanted.join(' and ')} and nothing else`, await boardShows(wanted) && (await boxText()) === query, await shownNow());
    }
    await clearBox();
    check('the clear button brings every card back', await boardShows(LIVE), await shownNow());

    // --- the selection --------------------------------------------------------------------------
    await clickCard(cardIn('#board', 'G3'), { modifiers: 2 });
    check('Ctrl+click on #G3 selects #G3 alone, not card 3', JSON.stringify(await selected()) === '["G3"]', await selected());
    await clickCard(cardIn('#board', '3'), { modifiers: 2 });
    check('Ctrl+click on #3 adds card 3 beside it', JSON.stringify(await selected()) === '["3","G3"]', await selected());
    await clickCard(cardIn('#board', 'G3'), { modifiers: 2 });
    check('Ctrl+click on #G3 again takes it out and leaves card 3', JSON.stringify(await selected()) === '["3"]', await selected());
    await clickCard(cardIn('#board', '3'), { modifiers: 2 });
    check('and card 3 out leaves nothing', (await ev('selectedIds.size')) === 0);

    // --- the card popup ---------------------------------------------------------------------------
    await clickCard(cardIn('#board', 'G3'));
    check('a click on #G3 opens #G3 and the address names the whole id', await waitFor(`new URLSearchParams(location.search).get('card')==='G3'`, 3000) && (await title()) === '#G3 Goal three', { card: await cardParam(), title: await title() });
    check('its children are the plain card 7, G10 and _12, each a link by its whole id', JSON.stringify(await ev(`[...document.querySelectorAll('#detail-children [data-card-id]')].map((e)=>e.dataset.cardId).sort()`)) === JSON.stringify(CASES.children.slice().sort()), await ev(`document.getElementById('detail-children').textContent`));
    check('the mentions in its body are chips by the whole id, and #a371f7 is no id', JSON.stringify(await ev(`[...document.querySelectorAll('#detail-body [data-card-id]')].map((e)=>e.dataset.cardId)`)) === JSON.stringify(['7', 'G10', '_12']));
    await ev(`document.querySelector('#detail-body [data-card-id="_12"]').click()`);
    check('a click on the chip for _12 opens _12', await waitFor(`document.getElementById('detail-title').textContent==='#_12 Loose twelve'`, 3000) && (await cardParam()) === '_12', { card: await cardParam(), title: await title() });
    check('and _12 names G3 as its parent', await waitFor(`!!document.querySelector('#detail-thread [data-card-id="G3"]')`, 2000), await ev(`document.getElementById('detail-thread').textContent`));
    await key('Escape');
    check('Escape closes the popup', await popupClosed() && (await cardParam()) === null);
    for (const [id, expected] of [['DW845', '#DW845 Deep work'], ['3', '#3 Plain three'], ['_12', '#_12 Loose twelve']]) {
      await open(`/?card=${id}`);
      check(`a link with ?card=${id} opens ${expected}`, await waitFor(`document.getElementById('detail-title').textContent===${JSON.stringify(expected)}`, 5000), await title());
    }
    await open('/?card=g3');
    await waitFor(`document.querySelectorAll('#board .card-el').length>0`, 10000);
    check('a lowercase ?card=g3 is no id and opens nothing', await ev(`document.getElementById('detail-modal').classList.contains('hidden')`));

    // --- the Graph ------------------------------------------------------------------------------
    await open('/?view=graph');
    check('the Graph draws the nine live cards, each dot under its whole id', await waitFor(`JSON.stringify([...new Set([...document.querySelectorAll('#graph-view .graph-node')].map((n)=>n.dataset.id))].sort((a,b)=>${ORDER}.indexOf(a)-${ORDER}.indexOf(b)))===${JSON.stringify(JSON.stringify(LIVE))}`, 10000), await ev(`[...document.querySelectorAll('#graph-view .graph-node')].map((n)=>n.dataset.id)`));
    const dot = await ev(`(()=>{const d=document.querySelector('.graph-node[data-id="G3"] .graph-dot');if(!d)return null;const r=d.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node[data-id="G3"]')?{x,y}:null})()`);
    await click(dot.x, dot.y);
    check('a click on the dot for #G3 selects #G3 alone', JSON.stringify(await selected()) === '["G3"]', await selected());

    // --- the board's API: gate, allocation, type change, reorder ----------------------------------
    await open('/');
    await waitFor(`document.querySelectorAll('#board .card-el').length>0`, 10000);
    const gated = await api('PATCH', '/api/cards/DW845', { status: 'doing' });
    check('DW845 cannot enter doing while G3 and card 3 are not done, and the refusal names both whole ids', gated.status === 422 && JSON.stringify(gated.json.waiting.map((w) => w.id)) === '["G3","3"]', gated);
    check('G3 is moved to done', (await api('PATCH', '/api/cards/G3', { status: 'done' })).status === 200);
    const still = await api('PATCH', '/api/cards/DW845', { status: 'doing' });
    check('with G3 done DW845 still waits for card 3 alone', still.status === 422 && JSON.stringify(still.json.waiting.map((w) => w.id)) === '["3"]', still);
    check('card 3 is moved to done, and then DW845 may enter doing', (await api('PATCH', '/api/cards/3', { status: 'done' })).status === 200 && (await api('PATCH', '/api/cards/DW845', { status: 'doing' })).status === 200);

    const goal = await api('POST', '/api/cards', { title: 'A new goal', type: 'goal' });
    const goal2 = await api('POST', '/api/cards', { title: 'Another goal', type: 'Goal' });
    const dw = await api('POST', '/api/cards', { title: 'More deep work', type: 'deep-work' });
    const plain = await api('POST', '/api/cards', { title: 'A plain card' });
    const untyped = await api('POST', '/api/cards', { title: 'A story', type: 'story' });
    check('a new goal takes the next number of G, the next goal the one after, deep work the DW counter, others the plain counter', [goal, goal2, dw, plain, untyped].map((r) => r.json && r.json.id).join() === 'G11,G12,DW846,13,14', [goal, goal2, dw, plain, untyped].map((r) => r.json && r.json.id));
    const retyped = await api('PATCH', '/api/cards/G11', { type: 'story' });
    check('changing the type of G11 leaves its id', retyped.status === 200 && retyped.json.id === 'G11' && retyped.json.type === 'story', retyped);
    const next = await api('POST', '/api/cards', { title: 'A third goal', type: 'goal' });
    check('and the change takes nothing from the goal counter', next.json.id === 'G13', next);
    await open('/');
    check('the page lists the new cards under their whole ids', await waitFor(`['G11','G12','G13','DW846','13','14'].every((id)=>!!document.querySelector('#board .card-el[data-id="'+id+'"]'))`, 10000), await shownNow());

    const moved = await api('POST', '/api/cards/_12/reorder', { prev: '7', next: 'G10' });
    check('a drop of _12 between 7 and G10 writes rank 15 to _12 alone, and it stays under G3', moved.status === 200 && moved.json.card.id === '_12' && moved.json.card.rank === 15 && moved.json.card.parent === 'G3' && moved.json.renumbered.length === 0, moved);
    const board = await api('GET', '/api/board');
    const order = board.json.active.filter((c) => c.parent === 'G3').sort((a, b) => a.rank - b.rank).map((c) => c.id);
    check('the board lists the children of G3 in the new order', JSON.stringify(order) === '["7","_12","G10"]', order);
  },
};
