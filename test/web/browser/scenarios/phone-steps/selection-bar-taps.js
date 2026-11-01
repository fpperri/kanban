'use strict';
// The selection bar keeps up with the taps of every view, and nothing it does happens inside a double tap.
// On a 390 px phone with touch. In the Graph, which paints a tap in place and never draws the board again, a
// tap on a dot raises the bar reading 1 selected, a tap on a second dot reads 2 selected, a tap that takes one
// out lowers the count, and the last one out takes the bar away: each change comes one double-tap window after
// the tap that made it, not at once, and not with the 5 s poll. On the Board, on a short screen so the Todo list
// scrolls, a double tap on the last card of the list, where the bar would rise, opens the card and puts the
// selection back, and the bar never rises: the second tap lands on the card, not on the bar. A double tap on the
// only selected card of the list scrolled to its end opens that card, and the bar neither goes nor moves the
// list under the finger. The step leaves the board as it found it.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): DOUBLE_CLICK_MS, graphCur, selectedIds.

const { tap, doubleTap, outwaitDoubleTap } = require('../../steps');
const { ASK_UP } = require('../../ask');

// A log of the bar in the page: each click that reaches the document, each time the bar goes up or away,
// and each time its count is written, with the time it happened. Run again, it empties the log.
const WATCH = `(()=>{if(window.__barWatching){window.__barLog=[];return true}window.__barWatching=true;const bar=document.getElementById('selection-bar');const count=document.getElementById('selection-bar-count');window.__barLog=[];`
  + `new MutationObserver(()=>window.__barLog.push({at:performance.now(),kind:'bar',up:!bar.classList.contains('hidden')})).observe(bar,{attributes:true,attributeFilter:['class']});`
  + `new MutationObserver(()=>window.__barLog.push({at:performance.now(),kind:'count',text:count.textContent})).observe(count,{childList:true,characterData:true,subtree:true});`
  + `document.addEventListener('click',()=>window.__barLog.push({at:performance.now(),kind:'click'}),true);return true})()`;

module.exports = {
  async run(page) {
    const { ev, send, open, waitFor, check, shot } = page;

    const picked = `[...selectedIds].map(Number).sort((a,b)=>a-b).join()`;
    const BAR = `document.getElementById('selection-bar')`;
    const barShown = `getComputedStyle(${BAR}).display!=='none'&&!${BAR}.classList.contains('hidden')&&${BAR}.getBoundingClientRect().height>0`;
    const barReads = (text) => waitFor(`${barShown}&&document.getElementById('selection-bar-count').textContent===${JSON.stringify(text)}`, 3000);
    const barGone = () => waitFor(`!(${barShown})`, 3000);
    const pickedIs = (ids) => waitFor(`${picked}===${JSON.stringify(ids.join())}`, 3000);
    const rectOf = (expr) => ev(`(()=>{const r=(${expr}).getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height,x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const pointOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    const tapOn = async (sel) => { const p = await pointOf(sel); if (!p) throw new Error(`nothing matches ${sel}`); await tap(page, p.x, p.y); };
    let windowMs = null; // the page's own number, read once a page is open
    // How long after the latest click the bar last changed in the way `kind` says: null when it never did.
    const lagOf = (kind) => ev(`(()=>{const log=window.__barLog;let i=log.length-1;while(i>=0&&log[i].kind!==${JSON.stringify(kind)})i--;if(i<0)return null;let j=i;while(j>=0&&log[j].kind!=='click')j--;return j<0?null:log[i].at-log[j].at})()`);
    const barWentUp = () => ev(`window.__barLog.some((e)=>e.kind==='bar'&&e.up)`);
    const barWentAway = () => ev(`window.__barLog.some((e)=>e.kind==='bar'&&!e.up)`);
    const waited = (lag) => lag !== null && lag >= windowMs - 20;
    const phoneBoard = async () => {
      await open('/');
      check('the Board draws', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=3`, 10000));
      await tapOn('.board-tab[data-col="todo"]');
      check('the Todo tab shows its cards', await waitFor(`document.querySelectorAll('#board .column .card-el').length>=5`, 5000));
      await ev(WATCH);
    };

    // --- the Graph --------------------------------------------------------------------------------------
    await open('/?view=graph');
    check('the Graph draws', await waitFor(`document.querySelectorAll('#graph-view .graph-node').length>1`, 10000));
    windowMs = await ev('DOUBLE_CLICK_MS');
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
    await ev(WATCH);

    await tap(page, first.x, first.y);
    check('a tap on a dot selects its card at once', await pickedIs([first.id]), await ev(picked));
    check('and the bar rises reading 1 selected', await barReads('1 selected'));
    check('one double-tap window after the tap, not at once', waited(await lagOf('bar')), String(await lagOf('bar')));
    await outwaitDoubleTap();
    await tap(page, second.x, second.y);
    check('a tap on a second dot adds it', await pickedIs(ids), await ev(picked));
    check('and the bar reads 2 selected', await barReads('2 selected'));
    check('again one window after the tap', waited(await lagOf('count')), String(await lagOf('count')));
    await shot('graph-bar');
    await outwaitDoubleTap();
    await tap(page, second.x, second.y);
    check('a tap on a selected dot takes it out', await pickedIs([first.id]), await ev(picked));
    check('and the bar reads 1 selected again', await barReads('1 selected'));
    check('one window after the tap', waited(await lagOf('count')), String(await lagOf('count')));
    await outwaitDoubleTap();
    await tap(page, first.x, first.y);
    check('the last dot out empties the selection', await pickedIs([]), await ev(picked));
    check('and the bar goes with it', await barGone());
    check('one window after the tap', waited(await lagOf('bar')), String(await lagOf('bar')));

    // --- a double tap on the last card of the list, where the bar would rise ---------------------------------
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 560, deviceScaleFactor: 1, mobile: true });
    await phoneBoard();
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
    check('the last card of the list stands where the bar rose', last !== null && last === lastOfList && y >= bar.t && y <= bar.b, JSON.stringify({ x, y, last, lastOfList, bar }));

    await ev(WATCH);
    const historyBefore = await ev('history.length');
    await doubleTap(page, x, y);
    check('a double tap on it opens the card', await waitFor(`new URLSearchParams(location.search).get('card')==='${last}'&&!document.querySelector('#detail-modal').classList.contains('hidden')`, 3000), await ev('location.search'));
    check('the selection is as it was before the first tap', await pickedIs([]), await ev(picked));
    await page.sleep(windowMs + 200);
    check('and the bar never rose, not for a moment', !(await barWentUp()) && !(await ev(barShown)), JSON.stringify(await ev('window.__barLog')));
    check('no question was asked', !(await ev(ASK_UP)));
    check('and the card opened once', (await ev('history.length')) === historyBefore + 1, await ev('history.length'));
    check('nothing was archived', await ev(`state.archived.every((c)=>String(c.id)!=='${last}')`));
    await shot('double-tap-at-the-foot');

    // --- a double tap on the only selected card, the list scrolled to its end ---------------------------------
    await phoneBoard();
    const lastCard = await ev(`(()=>{const cards=document.querySelectorAll('#board .column .card-el');return cards[cards.length-1].dataset.id})()`);
    await tapOn(cardTitle(lastCard));
    check('a tap on the last card selects it', await pickedIs([Number(lastCard)]), await ev(picked));
    check('and the bar rises', await barReads('1 selected'));
    await ev(`(()=>{const l=document.querySelector('#board .column .column-cards');l.scrollTop=l.scrollHeight;return true})()`);
    const scrolled = await ev(`document.querySelector('#board .column .column-cards').scrollTop`);
    check('the list is scrolled to its end, with the bar up', scrolled > 0, String(scrolled));
    const card = await rectOf(`document.querySelector(${JSON.stringify(cardTitle(lastCard))})`);
    const under = await ev(`(()=>{const hit=document.elementFromPoint(${card.x},${card.y});const el=hit&&hit.closest('.card-el');return el?el.dataset.id:null})()`);
    check('the last card is the one under the point to tap, above the bar', under === lastCard && card.b <= (await rectOf(BAR)).t + 1.5, JSON.stringify({ under, lastCard, card }));
    await outwaitDoubleTap();
    await ev(WATCH);
    const listTop = () => ev(`document.querySelector('#board .column .column-cards').scrollTop`);
    const scrollBefore = await listTop();
    await doubleTap(page, card.x, card.y);
    check('a double tap on it opens that card', await waitFor(`new URLSearchParams(location.search).get('card')==='${lastCard}'&&!document.querySelector('#detail-modal').classList.contains('hidden')`, 3000), await ev('location.search'));
    check('the card is selected again, as before the first tap', await pickedIs([Number(lastCard)]), await ev(picked));
    await page.sleep(windowMs + 200);
    check('the bar did not go away, not for a moment, and still reads 1 selected', !(await barWentAway()) && await ev(`${barShown}&&document.getElementById('selection-bar-count').textContent==='1 selected'`), JSON.stringify(await ev('window.__barLog')));
    check('and the list did not move under the finger', (await listTop()) === scrollBefore, `${scrollBefore} -> ${await listTop()}`);
  },
};
