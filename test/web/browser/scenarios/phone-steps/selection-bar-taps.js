'use strict';
// The selection bar keeps up with the taps of every view, and a double tap that lands on it still opens
// the card. On a 390 px phone with touch. In the Graph, which paints a tap in place and never draws the
// board again, a tap on a dot raises the bar reading 1 selected, a tap on a second dot reads 2 selected,
// a tap that takes one out lowers the count, and the last one out takes the bar away: each is read the
// moment the selection reads right, not after a wait, since the 5 s poll would draw the bar in time. On the Board, on a
// short screen so the Todo list scrolls, the last card of the list sits where the bar will rise: a double
// tap on it, at the place of the bar's Archive button, opens the card and puts the selection back, the
// bar goes, and no question is asked. The step leaves the board as it found it.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): graphCur, selectedIds.

const { tap, doubleTap, outwaitDoubleTap } = require('../../steps');
const { ASK_UP } = require('../../ask');

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check, shot } = page;

    const picked = `[...selectedIds].map(Number).sort((a,b)=>a-b).join()`;
    const BAR = `document.getElementById('selection-bar')`;
    const barShown = `getComputedStyle(${BAR}).display!=='none'&&!${BAR}.classList.contains('hidden')&&${BAR}.getBoundingClientRect().height>0`;
    const barReads = (text) => waitFor(`${barShown}&&document.getElementById('selection-bar-count').textContent===${JSON.stringify(text)}`, 3000);
    const barGone = () => waitFor(`!(${barShown})`, 3000);
    const barNow = (text) => ev(`${barShown}&&document.getElementById('selection-bar-count').textContent===${JSON.stringify(text)}`);
    const pickedIs = (ids) => waitFor(`${picked}===${JSON.stringify(ids.join())}`, 3000);
    const rectOf = (expr) => ev(`(()=>{const r=(${expr}).getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height,x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); if (!p) throw new Error(`nothing matches ${sel}`); await tap(page, p.x, p.y); };

    // --- the Graph --------------------------------------------------------------------------------------
    await open('/?view=graph');
    check('the Graph draws', await waitFor(`document.querySelectorAll('#graph-view .graph-node').length>1`, 10000));
    // The Graph lays itself out for a moment after it draws; a tap on a dot that is still moving misses it.
    let was = null;
    for (let i = 0; i < 40; i++) {
      const now = await ev(`JSON.stringify([graphCur.view.k,[...document.querySelectorAll('#graph-view .graph-node')].slice(0,3).map((n)=>n.getBoundingClientRect().left)])`);
      if (now === was) break;
      was = now;
      await page.sleep(200);
    }
    // Two dots high on the screen and apart, each the topmost thing at its centre, so neither lies under the bar.
    const dots = await ev(`(()=>{const out=[];for(const n of document.querySelectorAll('#graph-view .graph-node')){const r=n.querySelector('.graph-dot').getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;if(r.width<=0||x<12||x>innerWidth-12||y<150||y>innerHeight*0.5)continue;const hit=document.elementFromPoint(x,y);if(!hit||!hit.closest('.graph-node')||hit.closest('.graph-node')!==n)continue;if(out.every((o)=>Math.hypot(o.x-x,o.y-y)>60))out.push({id:Number(n.dataset.id),x,y});if(out.length===2)break}return out})()`);
    check('two dots stand clear of the foot of the screen', dots.length === 2, JSON.stringify(dots));
    const [first, second] = dots;
    const ids = [first.id, second.id].sort((a, b) => a - b);
    check('with nothing selected there is no bar', !(await ev(barShown)));

    await tap(page, first.x, first.y);
    const countNow = () => ev(`document.getElementById('selection-bar-count').textContent+(${barShown}?' shown':' hidden')`);
    check('a tap on a dot selects its card', await pickedIs([first.id]), await ev(picked));
    check('and the bar is up reading 1 selected, as the selection is', await barNow('1 selected'), await countNow());
    await outwaitDoubleTap();
    await tap(page, second.x, second.y);
    check('a tap on a second dot adds it', await pickedIs(ids), await ev(picked));
    check('and the bar reads 2 selected, as the selection does', await barNow('2 selected'), await countNow());
    await shot('graph-bar');
    await outwaitDoubleTap();
    await tap(page, second.x, second.y);
    check('a tap on a selected dot takes it out', await pickedIs([first.id]), await ev(picked));
    check('and the bar reads 1 selected again', await barNow('1 selected'), await countNow());
    await outwaitDoubleTap();
    await tap(page, first.x, first.y);
    check('the last dot out empties the selection', await pickedIs([]), await ev(picked));
    check('and the bar is gone with it', !(await ev(barShown)), await countNow());

    // --- a double tap that lands on the bar -------------------------------------------------------------
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 560, deviceScaleFactor: 1, mobile: true });
    await open('/');
    check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
    await tapOn('.board-tab[data-col="todo"]');
    check('the Todo tab shows its cards', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=5`, 5000));
    const cardTitle = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const top = await ev(`document.querySelector('#board .column .card-el').dataset.id`);

    // Where the bar's Archive button is, learned from a real first tap, then put away again.
    await tapOn(cardTitle(top));
    check('a tap on a card raises the bar', await barReads('1 selected'));
    const archive = await rectOf(`document.getElementById('selection-bar-archive')`);
    const bar = await rectOf(BAR);
    await tapOn('#selection-bar-clear');
    check('Clear puts the bar away', await pickedIs([]) && await barGone());
    await outwaitDoubleTap();

    await ev(`(()=>{const l=document.querySelector('#board .column .column-cards');l.scrollTop=l.scrollHeight;return true})()`);
    const viewBar = await rectOf(`document.getElementById('view-bar')`);
    const y = viewBar.t - 26;
    const x = archive.x;
    const last = await ev(`(()=>{const hit=document.elementFromPoint(${x},${y});const el=hit&&hit.closest('.card-el');return el?el.dataset.id:null})()`);
    const lastOfList = await ev(`(()=>{const cards=document.querySelectorAll('#board .column .card-el');return cards[cards.length-1].dataset.id})()`);
    check('the last card of the list stands where the bar will rise', last !== null && last === lastOfList && y >= bar.t && y <= bar.b, JSON.stringify({ x, y, last, lastOfList, bar }));

    const historyBefore = await ev('history.length');
    await doubleTap(page, x, y);
    check('a double tap on it opens the card', await waitFor(`new URLSearchParams(location.search).get('card')==='${last}'&&!document.querySelector('#detail-modal').classList.contains('hidden')`, 3000), await ev('location.search'));
    check('the selection is as it was before the first tap, and the bar is gone', await pickedIs([]) && await barGone(), await ev(picked));
    check('no question was asked', !(await ev(ASK_UP)));
    check('and the card opened once', (await ev('history.length')) === historyBefore + 1, await ev('history.length'));
    check('nothing was archived', await ev(`state.archived.every((c)=>String(c.id)!=='${last}')`));
    await shot('double-tap-on-bar');
  },
};
