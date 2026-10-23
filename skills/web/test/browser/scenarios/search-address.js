'use strict';
// The address follows the search box, on the fixture board: the address's q is
// replaced as the box changes and never pushed, so typing adds no history entry,
// and a reload or a copied link opens with the same search. Card history keeps
// working with the query in the address: opening a card is one step carrying
// both card and q, and Back and Forward leave the box alone and bring the entry
// they land on in line with it. A query typed on the Board, put there by a pill or opened from a
// link turns isolate on, so `isolate=1` stands beside q there; a text written to the box by a menu item
// turns nothing on, and the Graph, where typing lights, never carries it.
//
// Alt+Left and Alt+Right are browser shortcuts that a headless page is never
// sent, so Back and Forward are the same history traversal, through
// history.back() and history.forward(). Every wait is on the address or the
// box, never on a timer. The sets are the fixture's own: `zephyr` matches cards
// 1, 2, 7 and 11.

module.exports = {
  name: 'search-address',
  board: 'fixture',
  async run(page) {
    const { ev, send, open, waitFor, check } = page;
    const liveIds = Array.from({ length: 18 }, (_, i) => i + 1);
    const zephyrIds = [1, 2, 7, 11];
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boardShows = (wanted, ms) => waitFor(`JSON.stringify([...document.querySelectorAll('#board .card-el')].map((e) => Number(e.dataset.id)).sort((a, b) => a - b))===${JSON.stringify(JSON.stringify(wanted))}`, ms);
    const shownNow = () => ev(`[...document.querySelectorAll('#board .card-el')].map((e) => Number(e.dataset.id)).sort((a, b) => a - b)`);
    const addressParams = () => ev(`Object.fromEntries(new URLSearchParams(location.search))`);
    // The address holds exactly these parameters, no more and no fewer.
    const addressHas = (expected) => waitFor(`(()=>{const p=new URLSearchParams(location.search);const want=${JSON.stringify(expected)};return Object.keys(want).every((k)=>p.get(k)===want[k])&&[...p.keys()].every((k)=>k in want)})()`);
    const entryCount = () => ev(`history.length`);
    const typeKeys = async (text) => { for (const ch of text) await send('Input.insertText', { text: ch }); };
    const focusBoxAtEnd = () => ev(`(()=>{const i=document.getElementById('search-input');i.focus();i.setSelectionRange(i.value.length,i.value.length)})()`);
    const selectBoxText = () => ev(`(()=>{const i=document.getElementById('search-input');i.focus();i.select()})()`);
    const detailShown = (on) => waitFor(`document.getElementById('detail-modal').classList.contains('hidden')===${on ? 'false' : 'true'}`, 5000);
    const openTile = (id) => ev(`document.querySelector('#board .card-el[data-id="${id}"]').click()`);
    // Page.reload answers as soon as the reload starts, and the old document lives on until the new one commits, so a wait
    // taken straight after it can be answered by the page being left. A marker set on the old document is not on the
    // new one, so waiting for it to be gone is waiting for the reload itself.
    const reload = async () => {
      await ev(`window.__beforeReload = true`);
      await send('Page.reload');
      if (!(await waitFor(`window.__beforeReload === undefined`, 10000))) throw new Error('the page did not reload');
    };

    await open('/?view=board');
    await boardShows(liveIds, 10000);
    const entriesBeforeTyping = await entryCount();
    await focusBoxAtEnd();
    await typeKeys('zephyr');
    check('typing zephyr puts it in the address as q and keeps view', await addressHas({ view: 'board', q: 'zephyr', isolate: '1' }), await addressParams());
    check('the browser history does not grow while typing', (await entryCount()) === entriesBeforeTyping, { before: entriesBeforeTyping, now: await entryCount() });
    check('and the board shows the matches', await boardShows(zephyrIds), await shownNow());

    await reload();
    check('after a reload the box holds zephyr and the board shows only its matches', (await waitFor(`document.getElementById('search-input').value==='zephyr'`, 10000)) && (await boardShows(zephyrIds)), { box: await boxText(), shown: await shownNow() });
    check('and the reload left the address as it was', await addressHas({ view: 'board', q: 'zephyr', isolate: '1' }), await addressParams());

    await ev(`document.getElementById('search-clear-btn').click()`);
    check('clearing the box drops q from the address and keeps view', await addressHas({ view: 'board' }), await addressParams());
    check('and the history still did not grow', (await entryCount()) === entriesBeforeTyping, await entryCount());

    // Typing a # and then anything but digits strips the #, so a person cannot type this query in one go; the writer
    // can put it in the box, as the isolate switch will.
    const compound = '#12 | (tags:"next-up" status:doing)';
    await ev(`writeSearch(${JSON.stringify(compound)}, 'menu')`);
    check('a compound query reaches the address whole, with no fragment', (await waitFor(`new URLSearchParams(location.search).get('q')===${JSON.stringify(compound)}`)) && !(await ev(`location.hash`)), await addressParams());
    await reload();
    check('a box holding #12 | (tags:"next-up" status:doing) comes back unchanged after a reload', (await waitFor(`document.getElementById('search-input').value===${JSON.stringify(compound)}`, 10000)) && (await addressHas({ view: 'board', q: compound, isolate: '1' })), { box: await boxText(), address: await addressParams() });

    await open('/?q=zephyr&view=graph');
    check('a link opened with q and view=graph shows the graph and the query', (await waitFor(`document.querySelectorAll('.graph-node').length>0`, 10000)) && (await boxText()) === 'zephyr', { box: await boxText() });
    check('and keeps the parameters of the link, the Graph writing graph=hierarchy beside them', await addressHas({ q: 'zephyr', view: 'graph', graph: 'hierarchy' }), await addressParams());
    await focusBoxAtEnd();
    await typeKeys('x');
    check('one more keystroke makes q equal the box and keeps view', (await waitFor(`document.getElementById('search-input').value==='zephyrx'`)) && (await addressHas({ q: 'zephyrx', view: 'graph', graph: 'hierarchy' })), { box: await boxText(), address: await addressParams() });

    await open('/?q=zephyr');
    await boardShows(zephyrIds, 10000);
    const entriesBeforeOpen = await entryCount();
    await openTile(1);
    check('opening a card with a query in the box adds one history step carrying card and q', (await detailShown(true)) && (await addressHas({ q: 'zephyr', isolate: '1', card: '1' })) && (await entryCount()) === entriesBeforeOpen + 1, { address: await addressParams(), before: entriesBeforeOpen, now: await entryCount() });
    await ev(`history.back()`);
    check('going Back closes the card and the box keeps the query', (await detailShown(false)) && (await addressHas({ q: 'zephyr', isolate: '1' })) && (await boxText()) === 'zephyr', { box: await boxText(), address: await addressParams() });
    await ev(`history.forward()`);
    check('going Forward reopens it and the box keeps the query', (await detailShown(true)) && (await addressHas({ q: 'zephyr', isolate: '1', card: '1' })) && (await boxText()) === 'zephyr', { box: await boxText(), address: await addressParams() });
    check('and the traversal added no entry', (await entryCount()) === entriesBeforeOpen + 1, await entryCount());

    await open('/?q=zephyr');
    await boardShows(zephyrIds, 10000);
    await openTile(1);
    await detailShown(true);
    await ev(`document.getElementById('detail-close').click()`);
    check('closing the card is a step without card and with q', (await detailShown(false)) && (await addressHas({ q: 'zephyr', isolate: '1' })));
    await selectBoxText();
    await typeKeys('draft');
    check('a new query typed after the close reaches the address', (await waitFor(`document.getElementById('search-input').value==='draft'`)) && (await addressHas({ q: 'draft', isolate: '1' })), { box: await boxText(), address: await addressParams() });
    const entriesBeforeBack = await entryCount();
    await ev(`history.back()`);
    check('Back reopens the card, the box keeps the new query, and q in the address equals the box', (await detailShown(true)) && (await addressHas({ q: 'draft', isolate: '1', card: '1' })) && (await boxText()) === 'draft', { box: await boxText(), address: await addressParams() });
    check('the entry Back landed on was replaced, not added to', (await entryCount()) === entriesBeforeBack, { before: entriesBeforeBack, now: await entryCount() });
  },
};
