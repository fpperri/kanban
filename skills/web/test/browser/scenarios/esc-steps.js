'use strict';
// Esc steps the selection back one stage at a time, on the plan board. In the
// Graph, after a click and two Shift+clicks, the first Esc leaves only the anchor
// and the second clears the selection. On the Board, after Ctrl+clicks on three
// cards, the first Esc leaves the first card and the second clears the selection.
// With text in the search box and a selection, focus in the box opens its
// suggestion menu, and that menu takes the first Esc: it closes and the selection
// and the box text are untouched. The next Esc clears the box and keeps the selection. Esc with
// focus outside the box steps the selection back and leaves the box text as it
// was; with the selection gone, the next Esc outside the box clears the box, and a `slice:` run
// goes the same way, so repeated Esc ends on an empty box. Each step waits on the page, never on a fixed sleep. Escape goes through
// the runner's key helper, a real key press; a card's dot is found by its class
// and clicked only where it is the topmost thing, and a Board card at a point
// that is not a cue, a button or a bar.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// selectedIds, selectionState.

module.exports = {
  name: 'esc-steps',
  board: 'plan',
  async run(page) {
    const { ev, send, open, waitFor, click, key, check } = page;
    const picked = () => ev(`[...selectedIds].map(Number).sort((a,b)=>a-b)`);
    const parts = () => ev(`(()=>{const s=selectionState.selection;return {anchor:s.anchor&&Number(s.anchor.id),additions:s.additions.map((p)=>Number(p.id))}})()`);
    const sameIds = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const sorted = (...ids) => ids.slice().sort((a, b) => a - b);
    const hasSelection = (n) => waitFor(`selectedIds.size===${n}`);
    const noCardOpen = () => ev(`!/card=\\d+/.test(location.search)`);
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const MENU_OPEN = `(()=>{const m=document.querySelector('#search-input ~ .combobox-menu');return !!m&&!m.hidden})()`;
    // Focus the box afresh with the caret after its text, so its focus handler runs and the menu opens the same way every time.
    const focusBoxAtEnd = () => ev(`(()=>{const i=document.getElementById('search-input');i.blur();i.setSelectionRange(i.value.length,i.value.length);i.focus()})()`);
    const escape = () => key('Escape');

    // The centre of a card's dot in the Graph, or null when another dot covers it.
    const dotPoint = (id) => ev(`(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`);
    const clickDot = async (id, extra = {}) => {
      const p = await dotPoint(id);
      if (!p) throw new Error(`no clickable point on the dot of card ${id}`);
      await click(p.x, p.y, extra);
    };

    // A point on a Board card that is not a cue, a button or a roll-up bar, so the click is a click on the card itself.
    const cardPoint = (id) => ev(`(()=>{const el=document.querySelector('#board .card-el[data-id="${id}"]');if(!el)return null;el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();const skip='.card-assignee, .tag, .blocked-pill, .review-pill, .rollup, button, a, input, select';for(const fy of [0.5,0.35,0.65,0.25,0.75])for(let fx=0.1;fx<0.95;fx+=0.1){const x=r.left+r.width*fx,y=r.top+r.height*fy;const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.card-el')===el&&!hit.closest(skip))return {x,y}}return null})()`);
    const clickCard = async (id, extra = {}) => {
      const p = await cardPoint(id);
      if (!p) throw new Error(`no clickable point on Board card ${id}`);
      await click(p.x, p.y, extra);
    };
    const boardIds = () => ev(`[...new Set([...document.querySelectorAll('#board .card-el')].map((e)=>Number(e.dataset.id)))]`);
    const lit = () => ev(`[...document.querySelectorAll('.graph-node.selected')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`);

    // --- the Graph: a click and two Shift+clicks, then Esc twice ---------------------------------
    await open('/?view=graph');
    check('the Graph draws the plan board', await waitFor(`document.querySelectorAll('.graph-node').length>3`, 10000));
    const nodeIds = await ev(`[...document.querySelectorAll('.graph-node')].map((n)=>Number(n.dataset.id))`);
    const clickable = [];
    for (const id of nodeIds) if (clickable.length < 3 && await dotPoint(id)) clickable.push(id);
    check('three cards can be clicked without another dot in the way', clickable.length === 3, clickable);
    const [a, b, c] = clickable;

    await clickDot(a);
    await hasSelection(1);
    await clickDot(b, { modifiers: 8 });
    await hasSelection(2);
    await clickDot(c, { modifiers: 8 });
    check('a click and two Shift+clicks select three cards, the clicked card the anchor', await hasSelection(3) && sameIds(await picked(), sorted(a, b, c)) && sameIds(await parts(), { anchor: a, additions: [b, c] }), await parts());

    await escape();
    check('the first Esc in the Graph leaves only the anchor selected', await hasSelection(1) && sameIds(await picked(), [a]) && sameIds(await lit(), [a]) && sameIds(await parts(), { anchor: a, additions: [] }), { picked: await picked(), lit: await lit(), parts: await parts() });
    await escape();
    check('the second Esc in the Graph clears the selection', await hasSelection(0) && sameIds(await lit(), []) && sameIds(await parts(), { anchor: null, additions: [] }), { lit: await lit(), parts: await parts() });

    // --- the Board: three Ctrl+clicks, then Esc twice -----------------------------------------------
    await open('/?view=board');
    check('the Board draws the plan board', await waitFor(`document.querySelectorAll('#board .card-el').length>3`, 10000));
    const everything = await boardIds();
    const [first, second, third] = everything;
    await clickCard(first, { modifiers: 2 });
    await hasSelection(1);
    await clickCard(second, { modifiers: 2 });
    await hasSelection(2);
    await clickCard(third, { modifiers: 2 });
    check('Ctrl+clicks on three cards select them, the first the anchor', await hasSelection(3) && sameIds(await picked(), sorted(first, second, third)) && sameIds(await parts(), { anchor: first, additions: [second, third] }), await parts());

    await escape();
    check('the first Esc on the Board leaves the first card selected', await hasSelection(1) && sameIds(await picked(), [first]) && sameIds(await parts(), { anchor: first, additions: [] }), { picked: await picked(), parts: await parts() });
    await escape();
    check('the second Esc on the Board clears the selection', await hasSelection(0) && sameIds(await parts(), { anchor: null, additions: [] }), await parts());

    // --- the search box: Esc in the box clears it, Esc outside it steps the selection ------------------
    // The panel opens when the box is focused, hangs over the first cards and takes an Esc of its own, so the
    // arrow switches it off here; the search-panel scenario holds the panel and its place in the Esc chain.
    await ev(`(()=>{const t=document.getElementById('search-panel-toggle');if(t.getAttribute('aria-pressed')==='true')t.click()})()`);
    await ev(`document.getElementById('search-input').focus()`);
    await send('Input.insertText', { text: 'zephyr' });
    await waitFor(`document.getElementById('search-input').value==='zephyr'`);
    const shown = await boardIds();
    const [x, y, z] = shown;
    await clickCard(x, { modifiers: 2 });
    await hasSelection(1);
    await clickCard(y, { modifiers: 2 });
    await hasSelection(2);
    await clickCard(z, { modifiers: 2 });
    check('a search narrows the Board and three of its cards are selected', shown.length >= 3 && shown.length < everything.length && await hasSelection(3) && sameIds(await picked(), sorted(x, y, z)) && (await boxText()) === 'zephyr', { shown, picked: await picked(), box: await boxText() });

    await focusBoxAtEnd();
    check('focus in the box holding text opens its suggestion menu', await waitFor(MENU_OPEN), { open: await ev(MENU_OPEN), box: await boxText() });
    await escape();
    // An open menu takes the first Esc. A search field also clears itself on Esc by the browser's own default, which the menu's Esc stops, so the box still holds its text.
    check('the first Esc in the search box closes the suggestion menu, keeps the selection and keeps the box text', await waitFor(`!(${MENU_OPEN})`) && sameIds(await picked(), sorted(x, y, z)) && sameIds(await parts(), { anchor: x, additions: [y, z] }) && (await boxText()) === 'zephyr', { open: await ev(MENU_OPEN), picked: await picked(), parts: await parts(), box: await boxText() });
    await escape();
    check('the next Esc in the search box clears the box and keeps the selection', await waitFor(`document.getElementById('search-input').value===''`) && sameIds(await picked(), sorted(x, y, z)) && sameIds(await parts(), { anchor: x, additions: [y, z] }), { box: await boxText(), picked: await picked(), parts: await parts() });

    await focusBoxAtEnd();
    await send('Input.insertText', { text: 'zephyr' });
    await waitFor(`document.getElementById('search-input').value==='zephyr'`);
    await ev(`document.activeElement.blur()`);
    check('the box has text again and focus has left it', (await boxText()) === 'zephyr' && await ev(`document.activeElement!==document.getElementById('search-input')`));
    await escape();
    check('Esc with focus outside the search box steps the selection back and leaves the box text as it was', await hasSelection(1) && sameIds(await picked(), [x]) && sameIds(await parts(), { anchor: x, additions: [] }) && (await boxText()) === 'zephyr', { box: await boxText(), picked: await picked(), parts: await parts() });
    await escape();
    check('the next Esc outside the box drops the anchor and leaves the box text', await hasSelection(0) && sameIds(await parts(), { anchor: null, additions: [] }) && (await boxText()) === 'zephyr', { box: await boxText(), parts: await parts() });
    await escape();
    check('with nothing selected, the next Esc outside the box clears the box', await waitFor(`document.getElementById('search-input').value===''`) && await hasSelection(0), { box: await boxText(), picked: await picked() });

    await focusBoxAtEnd();
    await send('Input.insertText', { text: 'slice:goal' });
    await waitFor(`document.getElementById('search-input').value==='slice:goal'`);
    await ev(`document.activeElement.blur()`);
    check('a slice: run is in the box and focus has left it', (await boxText()) === 'slice:goal' && await ev(`document.activeElement!==document.getElementById('search-input')`));
    await escape();
    check('Esc outside the box clears a slice: run too, and the page is back to its whole board', await waitFor(`document.getElementById('search-input').value===''`) && await waitFor(`new Set([...document.querySelectorAll('#board .card-el')].map((e)=>e.dataset.id)).size>=${everything.length}`), { box: await boxText(), shown: (await boardIds()).length, everything: everything.length });
    check('none of those clicks opened a card', await noCardOpen());
  },
};
