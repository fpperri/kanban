'use strict';
// The card menu on the fixture board. A right-click on a card outside the
// selection opens a menu for that card alone, led by Peek and Add to selection,
// and leaves the selection as it was, in every view; Peek opens the details
// without touching the selection; Add to selection adds the card; the bulk
// entries act on the menu's subject (Set priority); Explore's Path and Tree, each by Hierarchy or
// Dependency, add one part for the right-clicked card and leave the search box alone, and are in
// every card's menu whatever the subject (a card inside a lit path included, and the card details'
// own menu, which is for the open card); Archive and Delete name the count of
// a selection that holds a tree part. Add child... opens the New card form under the card, the heading
// and the Parent field saying so, and saving it writes a card whose file says `parent: <id>`
// and leaves the parent's file as it was; with the Parent cleared it is a root card. The fixture's own sets: card 4's
// hierarchy path is 1, 4 and its hierarchy tree is 1 to 8 (19 is archived); its dependency path is 3, 4 and its
// dependency tree 2, 3, 4, 6. Cards 1, 3 and 4 are dated
// today so the Calendar and the Gantt draw them (the runner puts the board's
// cards back before the next scenario). Each step waits on the page, never on a
// fixed sleep; the menu is opened by the runner's right-click helper.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectedIds, selectionState, state.

const fs = require('fs');

module.exports = {
  name: 'card-menu',
  board: 'fixture',
  timeoutMs: 100000,
  async run(page) {
    const { ev, open, waitFor, centre, click, key, rightClick, check } = page;
    const menu = `document.getElementById('context-menu')`;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const cardIn = (container, id) => `${container} .card-el[data-id="${id}"]`;
    const picked = () => ev(`[...selectedIds].map(Number).sort((a,b)=>a-b)`);
    const menuOpen = () => waitFor(`!${menu}.classList.contains('hidden')`);
    const closeMenu = async () => { await key('Escape'); return waitFor(`${menu}.classList.contains('hidden')`, 2500); };
    const lead = () => ev(`[...${menu}.querySelectorAll('button')].filter((b)=>!b.classList.contains('hidden')).slice(0,2).map((b)=>b.textContent.trim())`);
    const entryShown = (id) => ev(`!document.getElementById(${JSON.stringify(id)}).classList.contains('hidden')`);
    const press = (id) => ev(`document.getElementById(${JSON.stringify(id)}).click()`);
    const detailOpen = (id) => waitFor(`!document.getElementById('detail-modal').classList.contains('hidden')&&/[?&]card=${id}(&|$)/.test(location.search)`, 4000);
    const detailClosed = () => waitFor(`document.getElementById('detail-modal').classList.contains('hidden')`, 2500);
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const anchorAndAdditions = () => ev(`(()=>{const s=selectionState.selection;return {anchor:s.anchor&&[s.anchor.kind,s.anchor.id].join(':'),additions:s.additions.map((p)=>[p.kind,p.id].join(':'))}})()`);
    const boardMarks = () => ev(`[...new Set([...document.querySelectorAll('#board .card-el.selected')].map((e)=>Number(e.dataset.id)))].sort((a,b)=>a-b)`);
    const graphMarks = () => ev(`[...document.querySelectorAll('#graph-view .graph-node.selected')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`);
    const priorities = () => ev(`Object.fromEntries(state.active.filter((c)=>[1,3,4].includes(Number(c.id))).map((c)=>[c.id,c.priority]))`);

    // A point on the card that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (sel) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    const clickCard = async (sel, extra = {}) => {
      const p = await cardPoint(sel);
      if (!p) throw new Error(`no clickable point on ${sel}`);
      await click(p.x, p.y, extra);
    };
    const openBoard = async () => {
      await open('/?view=board');
      return waitFor(`!!document.querySelector(${JSON.stringify(cardIn('#board', 4))})`, 10000);
    };
    // The Board with cards 1 and 3 picked by hand: card 1 the anchor, card 3 an addition.
    const selectPair = async () => {
      await openBoard();
      await clickCard(cardIn('#board', 1), { modifiers: 2 });
      await clickCard(cardIn('#board', 3), { modifiers: 2 });
      return waitFor(`selectedIds.size===2`);
    };
    const rightClickOnBoard = async (id) => {
      await rightClick(cardIn('#board', id));
      return menuOpen();
    };
    const setPriority = async (value) => {
      await press('ctx-priority');
      await waitFor(`!document.getElementById('bulk-single').classList.contains('hidden')`);
      await ev(`(()=>{const i=document.getElementById('bulk-single-input');i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
      await press('bulk-single-apply');
    };

    await openBoard();
    const today = await ev(`(()=>{const d=new Date();const p=(n)=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())})()`);
    const dated = await ev(`Promise.all([1,3,4].map((id)=>fetch('/api/cards/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({start_date:${JSON.stringify(today)},end_date:${JSON.stringify(today)}})}).then((r)=>r.status)))`);
    check('cards 1, 3 and 4 are dated today for the Calendar and Gantt right-clicks', dated.every((s) => s === 200), dated);

    // Every view: a right-click on a card outside a two-card selection leads with Peek and Add to selection and changes nothing.
    check('two cards are picked on the Board', await selectPair() && same(await picked(), [1, 3]), await picked());
    await rightClickOnBoard(4);
    check('Board: a right-click on a third card opens a menu led by Peek and Add child…', same(await lead(), ['Peek', 'Add child…']), await lead());
    check('Board: the two cards stay selected', same(await picked(), [1, 3]), await picked());
    check('Board: the menu closes on Escape', await closeMenu());
    for (const [view, container] of [['graph', '#graph-view'], ['map', '#map-view'], ['calendar', '#calendar-view'], ['gantt', '#gantt-view']]) {
      await press(`${view}-toggle-btn`);
      const drawn = await waitFor(`!document.querySelector(${JSON.stringify(container)}).classList.contains('hidden')&&!!document.querySelector(${JSON.stringify(cardIn(container, 4))})`, 10000);
      check(`${view}: the view draws card 4 and the two cards are still selected`, drawn && same(await picked(), [1, 3]), await picked());
      await rightClick(cardIn(container, 4));
      check(`${view}: a right-click on a card outside the selection opens a menu led by Peek and Add child…`, await menuOpen() && same(await lead(), ['Peek', 'Add child…']), await lead());
      check(`${view}: and leaves the selection unchanged`, same(await picked(), [1, 3]) && same(await anchorAndAdditions(), { anchor: 'card:1', additions: ['card:3'] }), await anchorAndAdditions());
      await closeMenu();
    }

    // Peek opens the details and leaves the selection; the details' own menu has no Peek.
    await selectPair();
    await rightClickOnBoard(4);
    await press('ctx-peek');
    check('Peek opens the card details', await detailOpen(4), await ev('location.search'));
    check('and the two cards stay selected while they are open', same(await picked(), [1, 3]), await picked());
    await rightClick('#detail-modal .modal');
    check('the details own right-click menu offers no Peek and still offers Add to selection', await menuOpen() && (await entryShown('ctx-peek')) === false && (await entryShown('ctx-add')) === true, await lead());
    await closeMenu();
    await key('Escape');
    check('Escape closes the details', await detailClosed());
    check('after they close, the same two cards are selected', same(await picked(), [1, 3]), await picked());
    await rightClickOnBoard(4);
    await press('ctx-peek');
    await detailOpen(4);
    const closeButton = await centre('#detail-close');
    await click(closeButton.x, closeButton.y);
    check('closing the details with the X button leaves the same two cards selected', await detailClosed() && same(await picked(), [1, 3]), await picked());

    // Add to selection.
    await rightClickOnBoard(4);
    await press('ctx-add');
    check('Add to selection makes three cards selected', await waitFor(`selectedIds.size===3`) && same(await picked(), [1, 3, 4]), await picked());
    check('and the new card joins after the anchor', same(await anchorAndAdditions(), { anchor: 'card:1', additions: ['card:3', 'card:4'] }), await anchorAndAdditions());
    await openBoard();
    check('with nothing selected, a right-click picks no card', (await ev('selectedIds.size')) === 0);
    await rightClickOnBoard(5);
    await press('ctx-add');
    check('Add to selection with nothing selected selects that one card as the anchor', await waitFor(`selectedIds.size===1`) && same(await picked(), [5]) && same(await anchorAndAdditions(), { anchor: 'card:5', additions: [] }), await anchorAndAdditions());

    // The bulk entries act on the menu's subject.
    await selectPair();
    await rightClickOnBoard(4);
    await setPriority('High');
    check('Board: after a right-click outside a two-card selection, Set priority changes only the right-clicked card', await waitFor(`state.active.find((c)=>c.id==='4').priority==='High'`) && same(await priorities(), { 1: 'Normal', 3: 'Normal', 4: 'High' }), await priorities());
    check('and the two cards are still selected', same(await picked(), [1, 3]), await picked());
    await rightClickOnBoard(3);
    await setPriority('Low');
    check('Board: after a right-click inside a two-card selection, Set priority changes both cards', await waitFor(`state.active.find((c)=>c.id==='1').priority==='Low'`) && same(await priorities(), { 1: 'Low', 3: 'Low', 4: 'High' }), await priorities());

    // The four sets (Explore > Path | Tree > Hierarchy | Dependency) add one part for the right-clicked card and leave the box alone.
    const groupShown = (id) => ev(`!document.getElementById(${JSON.stringify(id)}).closest('.ctx-sub').classList.contains('hidden')`);
    const exploreOffered = async () => (await groupShown('ctx-explore')) && (await groupShown('ctx-path')) && (await groupShown('ctx-tree'));
    await openBoard();
    await rightClickOnBoard(4);
    check('Path and Tree, each with Hierarchy and Dependency, are in the menu for one card', await exploreOffered());
    await press('ctx-dpath');
    check('Dependency path on a card adds its path, marked on the Board', await waitFor(`selectedIds.size===2`) && same(await boardMarks(), [3, 4]), await boardMarks());
    check('and the path is one part of the selection', same(await anchorAndAdditions(), { anchor: 'dpath:4', additions: [] }), await anchorAndAdditions());
    check('and the search box is unchanged after Dependency path', (await boxText()) === '', await boxText());
    await press('graph-toggle-btn');
    check('and the path is lit in the Graph', await waitFor(`document.querySelectorAll('#graph-view .graph-node.selected').length===2`) && same(await graphMarks(), [3, 4]), await graphMarks());

    await openBoard();
    await rightClickOnBoard(4);
    await press('ctx-htree');
    check('Hierarchy tree on a card adds its parent tree, marked on the Board', await waitFor(`selectedIds.size===8`) && same(await boardMarks(), [1, 2, 3, 4, 5, 6, 7, 8]), await boardMarks());
    check('and the tree is one part of the selection', same(await anchorAndAdditions(), { anchor: 'htree:4', additions: [] }), await anchorAndAdditions());
    check('and the search box is unchanged after Hierarchy tree', (await boxText()) === '', await boxText());
    await press('graph-toggle-btn');
    check('and the tree is lit in the Graph', await waitFor(`document.querySelectorAll('#graph-view .graph-node.selected').length===8`) && same(await graphMarks(), [1, 2, 3, 4, 5, 6, 7, 8]), await graphMarks());

    await openBoard();
    await rightClickOnBoard(4);
    await press('ctx-hpath');
    check('Hierarchy path adds the card and its parent, and nothing waiting for it', await waitFor(`selectedIds.size===2`) && same(await boardMarks(), [1, 4]) && same(await anchorAndAdditions(), { anchor: 'hpath:4', additions: [] }), await boardMarks());
    await openBoard();
    await rightClickOnBoard(4);
    await press('ctx-dtree');
    check('Dependency tree adds the cards joined to it by waiting_for alone', await waitFor(`selectedIds.size===4`) && same(await boardMarks(), [2, 3, 4, 6]) && same(await anchorAndAdditions(), { anchor: 'dtree:4', additions: [] }), await boardMarks());

    await selectPair();
    await rightClickOnBoard(3);
    check('Path and Tree are in the menu when its subject is several cards, beside the bulk entries', (await exploreOffered()) && (await entryShown('ctx-assign')));
    await press('ctx-dpath');
    check('and with several cards as the subject the four add the set of the right-clicked card alone', await waitFor(`selectionState.selection.additions.length===2`) && same(await anchorAndAdditions(), { anchor: 'card:1', additions: ['card:3', 'dpath:3'] }), await anchorAndAdditions());

    // A right-click on a card inside a lit path has the path's cards as the subject, and the menu still offers both.
    await openBoard();
    await rightClickOnBoard(4);
    await press('ctx-dpath');
    await waitFor(`selectedIds.size===2`);
    await rightClickOnBoard(3);
    check('a right-click on a card inside a lit path still offers Path and Tree', await menuOpen() && (await exploreOffered()));
    await press('ctx-hpath');
    check('and Hierarchy path adds the path of the card right-clicked, one part, not one for each card of the lit path', await waitFor(`selectionState.selection.additions.length===1`) && same(await anchorAndAdditions(), { anchor: 'dpath:4', additions: ['hpath:3'] }), await anchorAndAdditions());
    check('and the cards it reaches join those the lit path marked', await waitFor(`selectedIds.size===3`) && same(await boardMarks(), [1, 3, 4]), await boardMarks());

    // The card details' own menu is for the open card.
    await openBoard();
    await rightClickOnBoard(4);
    await press('ctx-peek');
    await detailOpen(4);
    await rightClick('#detail-modal .modal');
    check('the details own menu offers Path and Tree too', await menuOpen() && (await exploreOffered()));
    await press('ctx-dtree');
    check('and Dependency tree there is the one of the open card', await waitFor(`selectionState.selection.anchor&&selectionState.selection.anchor.kind==='dtree'`) && same(await anchorAndAdditions(), { anchor: 'dtree:4', additions: [] }), await anchorAndAdditions());
    await key('Escape');
    await detailClosed();

    // Archive and Delete name the resolved count of a selection that holds a tree part. The archive confirmation answers no and Delete opens its popup, closed unanswered, so nothing is archived or deleted.
    await openBoard();
    await ev(`(()=>{window.__asked=[];window.confirm=(m)=>{window.__asked.push(m);return false}})()`);
    await rightClickOnBoard(4);
    await press('ctx-htree');
    await waitFor(`selectedIds.size===8`);
    await rightClickOnBoard(4);
    await press('ctx-archive');
    await rightClickOnBoard(4);
    await press('ctx-delete');
    const asked = await ev('window.__asked');
    check('archiving a selection that holds a tree part names the resolved count', asked[0] === 'Archive 8 card(s)? (moves their files to archived/)', asked);
    check('deleting a selection that holds a tree part names the resolved count in the delete popup', asked.length === 1 && await waitFor(`!document.getElementById('group-dialog').classList.contains('hidden')&&document.getElementById('group-dialog-title').textContent==='Delete 8 cards?'`, 3000), asked);
    await key('Escape');
    await waitFor(`!!document.getElementById('group-dialog').classList.contains('hidden')`, 2500);

    // Add child... opens the New card form under the card; saving writes the child alone.
    const MODAL_UP = `!document.getElementById('modal').classList.contains('hidden')`;
    const fileOf = async (id) => fs.readFileSync(await ev(`fetch('/api/cards/${id}/detail').then((r)=>r.json()).then((d)=>d.path)`), 'utf8');
    const submitChild = (title) => ev(`(()=>{const t=document.getElementById('f-title');t.value=${JSON.stringify(title)};t.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('card-form').requestSubmit();return true})()`);
    await openBoard();
    const parentBefore = await fileOf(5);
    await rightClickOnBoard(5);
    check('Add child... is in the menu for one live card', await entryShown('ctx-child'));
    await press('ctx-child');
    check('Add child... closes the menu and opens the New card form under that card', await waitFor(`${MODAL_UP}&&${menu}.classList.contains('hidden')&&document.getElementById('modal-title').textContent==='New card under #5'&&document.getElementById('f-parent').value==='5'&&document.getElementById('f-id').value===''`, 3000));
    check('and the form starts with the status + New card gives', await ev(`document.getElementById('f-status').value===state.statuses[0]`));
    await submitChild('A child of five');
    check('saving makes the child on the board with the parent set', await waitFor(`state.active.some((c)=>c.title==='A child of five'&&String(c.parent)==='5')`, 5000));
    const childId = await ev(`String(state.active.find((c)=>c.title==='A child of five').id)`);
    check('the file of the child says parent: 5', /^parent: ?5\s*$/m.test(await fileOf(childId)));
    check('and the file of the parent is as it was', (await fileOf(5)) === parentBefore);
    await rightClickOnBoard(5);
    await press('ctx-child');
    await waitFor(`${MODAL_UP}&&document.getElementById('f-parent').value==='5'`, 3000);
    await ev(`(()=>{const p=document.getElementById('f-parent');p.value='';p.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await submitChild('A root by choice');
    check('with the Parent cleared the card is an ordinary root card', await waitFor(`state.active.some((c)=>c.title==='A root by choice'&&c.parent==null)`, 5000));
    await rightClickOnBoard(5);
    check('the menu of a live card still offers it', await entryShown('ctx-child'));
    await closeMenu();
  },
};
