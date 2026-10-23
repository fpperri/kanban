'use strict';
// Hovering a line in the Graph, on the plan board. A pointer over a drawn line lights that line and the
// cards at its ends and dims the rest, as a card's hover dims it, in the Hierarchy and in the Flow:
//   parent line   the line, the parent and the child.
//   dependency    the line and its two cards.
//   bracket       the whole bracket, its parent and every child it holds.
// A line is thin, so each has a wider invisible stroke (.graph-link-hit) that takes the pointer; the
// scenario finds a point along the stroke where it is the topmost thing, so a dot lying over a line
// cannot fail a check for the wrong reason. A card under the pointer wins over the line beneath it, the
// line being drawn under the dots, and leaving a line brings back what was lit before: here a lone
// card's relations. The lit line is drawn above the other lines while it is lit. A line has no click.
//
// The plan board's Hierarchy, with Lines all and Group brackets, draws card 1 over its children 2 (a
// strategy), 3, 4, 5 and 6: 3 to 6 on one ring, so one bracket, and a plain line to card 2. Card 7
// (under 2) has a parent line to 2 and a dependency line to card 8, which also has the parent 2. The
// Flow draws the dependency lines alone.
//
// skills/web/test/browser-line-hover-scenario.test.js holds these lists to the Graph model over the plan
// board's own cards, so a wrong expectation fails in the unit suite and not only in a browser.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js): graphCur.

const CASES = {
  hierarchy: {
    parent: { from: '1', to: '2', lit: [1, 2] },
    bracket: { from: '1', kids: [3, 4, 5, 6], lit: [1, 3, 4, 5, 6] },
    dependency: { from: '7', to: '8', lit: [7, 8] },
  },
  flow: {
    dependency: { from: '7', to: '8', lit: [7, 8] },
  },
  // A card the line runs into: its own hover wins over the line under it.
  card: { id: 2, lit: [1, 2, 6, 7, 8], line: { from: '1', to: '2' } },
  // A lone card picked first, and what leaving a line brings back.
  lone: { id: 3, lit: [1, 3, 4, 6] },
};

const LIT_NODES = `[...document.querySelectorAll('.graph-node.graph-near')].map((n)=>Number(n.dataset.id)).sort((a,b)=>a-b)`;
const LIT_LINKS = `graphCur.linkEls.map((el,i)=>el.classList.contains('graph-near')?i:-1).filter((i)=>i>=0)`;
const DIMMED = `document.querySelector('.graph-canvas').classList.contains('graph-dim')`;
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The index of the line the plan draws between two cards (a bracket by its parent alone).
const LINE = (from, to, bracket) => `graphCur.plan.links.findIndex((l)=>${bracket ? `l.count!==undefined&&l.from==='${from}'` : `l.from==='${from}'&&l.to==='${to}'&&l.count===undefined`})`;

// A point on the line's hit stroke, in the page's pixels, where that stroke is what the pointer finds.
const POINT = (index) => `(()=>{const hit=graphCur.hitEls[${index}];if(!hit)return null;const len=hit.getTotalLength();const m=hit.getScreenCTM();`
  + `for(let t=0.04;t<0.97;t+=0.01){const q=hit.getPointAtLength(len*t);const x=q.x*m.a+q.y*m.c+m.e;const y=q.x*m.b+q.y*m.d+m.f;`
  + `if(x>2&&y>2&&x<innerWidth-2&&y<innerHeight-2&&document.elementFromPoint(x,y)===hit)return {x,y}}return null})()`;
// Whether the line at the index is drawn after every other line, and so above them.
const ON_TOP = (index) => `(()=>{const me=graphCur.linkEls[${index}];return graphCur.linkEls.every((el,i)=>i===${index}||!!(el.compareDocumentPosition(me)&Node.DOCUMENT_POSITION_FOLLOWING))})()`;
const IN_PLACE = `(()=>{const els=[...document.querySelectorAll('.graph-link')];return els.length===graphCur.linkEls.length&&els.every((el,i)=>el===graphCur.linkEls[i])})()`;

module.exports = {
  name: 'graph-line-hover',
  board: 'plan',
  timeoutMs: 90000,
  CASES,
  async run(page) {
    const { ev, open, waitFor, mouse, click, check } = page;

    const load = async (url) => {
      await ev('window.__stale=true');
      await open(url);
      return waitFor('!window.__stale', 10000);
    };
    const litIs = (ids) => waitFor(`${DIMMED}&&JSON.stringify(${LIT_NODES})===${JSON.stringify(JSON.stringify(ids))}`);
    const undimmed = () => waitFor(`!${DIMMED}&&document.querySelectorAll('.graph-node.graph-near').length===0`);
    const restIsDim = () => ev(`(()=>{const off=[...document.querySelectorAll('.graph-node')].filter((n)=>!n.classList.contains('graph-near'));return off.length>0&&off.every((n)=>getComputedStyle(n).opacity==='0.15')})()`);
    // The Flow fades its done cards on its own, below the dimming, so the rest there is dimmer than half.
    const restIsFaded = () => ev(`(()=>{const off=[...document.querySelectorAll('.graph-node')].filter((n)=>!n.classList.contains('graph-near'));return off.length>0&&off.every((n)=>parseFloat(getComputedStyle(n).opacity)<=0.4)})()`);
    const dotPoint = (id) => ev(`(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`);

    // The line between two cards is hovered at a point where its stroke is topmost. Answers the point.
    const hover = async (index) => {
      const p = await ev(POINT(index));
      if (!p) throw new Error(`no point of line ${index} where its hit stroke is topmost`);
      await mouse('mouseMoved', p.x, p.y);
      return p;
    };

    await load('/?view=graph');
    check('the Hierarchy draws the plan board with a line to hover', await waitFor(`document.querySelectorAll('.graph-node').length>20&&graphCur.kind==='hierarchy'`, 10000));
    const rect = await ev(`(()=>{const r=document.querySelector('.graph-canvas').getBoundingClientRect();return {r:r.right,b:r.bottom}})()`);
    const bg = { x: rect.r - 14, y: rect.b - 14 };
    check('the empty corner of the Graph is not a card', await ev(`!document.elementFromPoint(${bg.x},${bg.y}).closest('.card-el')`));
    await ev(`(()=>{const t=document.getElementById('search-panel-toggle');if(t.getAttribute('aria-pressed')==='true')t.click()})()`);
    const away = async () => { await mouse('mouseMoved', bg.x, bg.y); };

    check('every line has a hit stroke wider than the line, and none of them can be tabbed to',
      await ev(`graphCur.hitEls.length===graphCur.plan.links.length&&graphCur.hitEls.every((h)=>parseFloat(getComputedStyle(h).strokeWidth)===8&&getComputedStyle(h).pointerEvents==='stroke'&&!h.hasAttribute('tabindex'))`));

    const kinds = [['parent', 'a parent line', false], ['bracket', 'a bracket', true], ['dependency', 'a dependency line', false]];
    for (const [key, what, bracket] of kinds) {
      const c = CASES.hierarchy[key];
      const index = await ev(LINE(c.from, c.to, bracket));
      check(`the plan draws ${what} the scenario hovers`, index >= 0, { c, index });
      await hover(index);
      check(`in the Hierarchy, the pointer on ${what} lights exactly its cards and the line, and dims the rest`,
        await litIs(c.lit) && sameList(await ev(LIT_LINKS), [index]) && await restIsDim(), { lit: await ev(LIT_NODES), links: await ev(LIT_LINKS) });
      check(`and ${what} is drawn above every other line while it is lit`, await ev(ON_TOP(index)));
      await away();
      check(`leaving ${what} undims the Graph and puts the line back among the others`, await undimmed() && await ev(IN_PLACE));
    }

    // A card the line runs into wins over it: the line is drawn under the dots.
    const c = CASES.card;
    const lineIndex = await ev(LINE(c.line.from, c.line.to, false));
    const dot = await dotPoint(c.id);
    check('a dot the plan board draws over a line can be hovered', dot !== null && lineIndex >= 0, { dot, lineIndex });
    check('and the line lies under it: the hit stroke is in the stack at the pointer, below the dot',
      await ev(`(()=>{const stack=document.elementsFromPoint(${dot.x},${dot.y});const at=stack.findIndex((e)=>e.classList.contains('graph-link-hit')&&e.dataset.link==='${lineIndex}');return at>0&&!!stack[0].closest('.graph-node')})()`));
    await mouse('mouseMoved', dot.x, dot.y);
    check('the pointer on that dot lights the card\'s relations as a card\'s hover does, not the line\'s two cards',
      await litIs(c.lit) && await restIsDim(), { lit: await ev(LIT_NODES) });
    await away();
    check('moving off it undims the Graph', await undimmed());

    // Leaving a line brings back what was lit before: a lone card's relations.
    const lone = CASES.lone;
    const dep = CASES.hierarchy.dependency;
    const depIndex = await ev(LINE(dep.from, dep.to, false));
    const lonePoint = await dotPoint(lone.id);
    if (!lonePoint) throw new Error(`no clickable point on the dot of card ${lone.id}`);
    await click(lonePoint.x, lonePoint.y);
    check('a click on a card lights it and its relations', await litIs(lone.lit));
    await hover(depIndex);
    check('the pointer on a line lights the line\'s cards in place of the card\'s relations', await litIs(dep.lit) && sameList(await ev(LIT_LINKS), [depIndex]));
    await away();
    check('and leaving the line brings the card\'s relations back', await litIs(lone.lit));

    // A click on a line is not a click on a card: it selects nothing.
    await hover(depIndex);
    const p = await ev(POINT(depIndex));
    await click(p.x, p.y);
    check('a click on a line acts as a click on empty canvas does: it leaves the picked card picked, selects nothing more and opens nothing',
      await ev(`[...selectedIds].map(String).join()==='${lone.id}'`) && await ev(`document.getElementById('detail-modal').classList.contains('hidden')`));

    // The Flow draws the dependencies alone.
    await load('/?view=graph&graph=flow&deps=frontier&lanes=0');
    check('the Flow draws the plan board', await waitFor(`graphCur.kind==='flow'&&document.querySelectorAll('.graph-node').length>20`, 10000));
    const f = CASES.flow.dependency;
    const flowIndex = await ev(LINE(f.from, f.to, false));
    check('the Flow draws the dependency line the scenario hovers', flowIndex >= 0, flowIndex);
    await hover(flowIndex);
    check('in the Flow, the pointer on a dependency line lights exactly its two cards and the line, and dims the rest',
      await litIs(f.lit) && sameList(await ev(LIT_LINKS), [flowIndex]) && await restIsFaded(), { lit: await ev(LIT_NODES), links: await ev(LIT_LINKS) });
    check('and it is drawn above every other line while it is lit', await ev(ON_TOP(flowIndex)));
    await away();
    check('leaving it undims the Flow', await undimmed() && await ev(IN_PLACE));
  },
};
