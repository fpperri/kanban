'use strict';
// The tier fan's washes. On the plan board the Graph in Tiers washes each tier band that
// holds a card in its type's colour: goal and epic have a colour in the board's config
// and strategy and objective have none, so they get the neutral wash. Each wash is one
// path across the whole ring of its band, the first mark of the world, so it lies behind
// the lines, the dots and the captions; the depth rings, the Unnested ring and the Unnested
// block get none, and neither do the fixture board (no hierarchy) and the Flow.
// A wash takes no click: a point inside a band that holds no mark is
// the canvas itself, a click there leaves a picked pair of cards as it found them and a
// double click clears them, as on any empty space. A slice: cut and a status pill drop the
// washes of the bands they empty and keep the others. The wash reads in both themes: its
// opacity is the same in each, its colour is the type's own, and a neutral wash is the
// muted token of the theme. The harness closes the scenario with the console-error check.
//
// A wash is read from the page: its tier, the colour the page painted, its computed fill,
// fill opacity and pointer events, and the two radii in its path (the outer circle first).
// The band edges are read from the Graph's own layout (graphCur), the cards' places from the
// translate of their dots.
//
// What the plan board's tiers are is written out by hand from the fixture, and
// skills/web/test/browser-band-tint-scenario.test.js holds the lists to the real board
// readers and the Graph model.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur, selectedIds.

const {
  CASES, DOTS, DRAWN, TIERS_PRESSED, USE_TABLE, TABLE_DRAWN, writeBox, pickLayout, layoutIs,
} = require('./tier-fan');

// Each tier of the plan board: the colour its type has in the fixture's config.yaml (null
// for none) and the colour the page paints, as the browser reports it.
const TIERS = [
  { name: 'goal', color: '#a371f7', fill: 'rgb(163, 113, 247)' },
  { name: 'strategy', color: null, fill: null },
  { name: 'objective', color: null, fill: null },
  { name: 'epic', color: '#d29922', fill: 'rgb(210, 153, 34)' },
];
const OPACITY = 0.13;
const SAMPLES = 120;
const PILL = 'doing';

// Every wash on the page, in the order it is drawn.
const WASHES = `[...document.querySelectorAll('#graph-view .graph-tint')].map((e)=>{const c=getComputedStyle(e);`
  + `return {tier:e.getAttribute('data-tier'),typed:e.getAttribute('data-type-color'),fill:c.fill,opacity:Number(c.fillOpacity),events:c.pointerEvents,`
  + `radii:[...(e.getAttribute('d')||'').matchAll(/M(-?[\\d.]+) 0A/g)].map((m)=>Number(m[1]))}})`;

// The tier names of the washes, as the page draws them.
const WASH_TIERS = `[...document.querySelectorAll('#graph-view .graph-tint')].map((e)=>e.getAttribute('data-tier'))`;
const washesAre = (tiers) => `JSON.stringify(${WASH_TIERS})===${JSON.stringify(JSON.stringify(tiers))}&&document.querySelectorAll('#graph-view .graph-node').length>0`;

// Every band of the layout: the tier it is, its kind (tier, depth or the ring of unnested cards), how many cards it
// holds and its edges.
const BANDS = `graphCur.layout.bands.map((b)=>({tier:b.slice&&b.slice.kind==='tier'?b.slice.name:null,kind:b.slice?b.slice.kind:'ring',count:b.count,r0:b.r0,r1:b.r1}))`;

// Where the washes stand among the marks of the world: the index of the last wash, the
// first mark that is not one, and how many marks there are.
const ORDER = `(()=>{const kids=[...document.querySelector('#graph-view .graph-world').children];`
  + `const tint=kids.map((k,i)=>(k.classList.contains('graph-tint')?i:-1)).filter((i)=>i>=0);`
  + `const other=kids.map((k,i)=>(k.classList.contains('graph-tint')?-1:i)).filter((i)=>i>=0);`
  + `return {washes:tint.length,lastWash:tint.length?tint[tint.length-1]:-1,firstOther:other.length?other[0]:-1,marks:kids.length}})()`;

// Points on the ring of a wash, three radii of the band round the full circle, on the page:
// how many lie on the stage, how many have the wash itself under the pointer, how many have
// the canvas, and the first of those that do (a spot with nothing on it).
const probe = (tier) => `(()=>{const w=[...document.querySelectorAll('#graph-view .graph-tint')].find((e)=>e.getAttribute('data-tier')===${JSON.stringify(tier)});if(!w)return null;`
  + `const canvas=document.querySelector('#graph-view .graph-canvas');const s=canvas.getBoundingClientRect();const v=graphCur.view;`
  + `const [r1,r0]=[...w.getAttribute('d').matchAll(/M(-?[\\d.]+) 0A/g)].map((m)=>Number(m[1]));`
  + `let inside=0,washHit=0,canvasHit=0,spot=null;`
  + `for(const f of [0.25,0.5,0.75])for(let i=0;i<${SAMPLES};i++){const a=i/${SAMPLES}*2*Math.PI;const r=r0+(r1-r0)*f;`
  + `const x=s.left+v.x+Math.cos(a)*r*v.k,y=s.top+v.y+Math.sin(a)*r*v.k;`
  + `if(x<s.left+2||x>s.right-2||y<s.top+2||y>s.bottom-2)continue;inside++;const hit=document.elementFromPoint(x,y);`
  + `if(hit===w)washHit++;else if(hit===canvas){canvasHit++;if(!spot)spot={x,y}}}`
  + `return {inside,washHit,canvasHit,spot}})()`;

// The colour of the muted token, as the page has it in the theme on show, written as the browser writes
// a computed colour.
const MUTED = `getComputedStyle(document.documentElement).getPropertyValue('--mut').trim()`;
const rgbOf = (hex) => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return `rgb(${[0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).join(', ')})`;
};

const dotPoint = (id) => `(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();`
  + `const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`;
const STATUS_PILL = `document.querySelector('#search-statuses .status-pill[data-col=${PILL}]').click()`;

module.exports = {
  name: 'band-tint',
  board: 'plan',
  alsoBoards: ['fixture'],
  timeoutMs: 120000,
  TIERS,
  OPACITY,
  SAMPLES,
  PILL,
  WASHES,
  WASH_TIERS,
  BANDS,
  ORDER,
  MUTED,
  probe,
  washesAre,
  rgbOf,
  dotPoint,
  STATUS_PILL,
  async run(page) {
    const { ev, send, open, waitFor, click, check } = page;
    const plan = CASES.plan;
    const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const near = (a, b) => Math.abs(a - b) < 0.02;
    const load = async (url, key) => {
      await ev('window.__stale=true');
      await open(url, key);
      return waitFor('!window.__stale', 10000);
    };
    const openGraph = async (key) => {
      await load('/?view=graph', key);
      return waitFor(`${DRAWN}&&${TIERS_PRESSED}`, 10000);
    };
    const washes = () => ev(WASHES);
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);
    const pickedIs = (ids) => waitFor(`JSON.stringify([...selectedIds].map(Number).sort((a,b)=>a-b))===${JSON.stringify(JSON.stringify(ids.slice().sort((a, b) => a - b)))}`);
    const picked = () => ev(`[...selectedIds].map(Number).sort((a,b)=>a-b)`);
    const colourOf = (w) => TIERS.find((t) => t.name === w.tier) || { color: null, fill: null };

    // --- the plan board: a wash for each tier band that holds a card ---------------------------
    check('plan: the Graph draws in Tiers', await openGraph('plan'));
    const bands = await ev(BANDS);
    const tierBands = bands.filter((b) => b.kind === 'tier');
    check('plan: the layout has a band for each of the four tiers, and depth rings and the ring of unnested cards besides',
      tierBands.length === TIERS.length && bands.some((b) => b.kind === 'depth') && bands[bands.length - 1].kind === 'ring', bands);
    const all = await washes();
    check('plan: one wash for each tier band that holds a card, in tier order, none for a depth ring or the ring of unnested cards',
      sameList(all.map((w) => w.tier), TIERS.map((t) => t.name)) && all.length < bands.length, all);
    check('plan: each wash is the whole ring of its band, between the band\'s inner and outer edge',
      all.length === tierBands.length && all.every((w, i) => w.radii.length === 2 && near(w.radii[0], tierBands[i].r1) && near(w.radii[1], tierBands[i].r0)), { all, tierBands });

    // The colours: the type's own where it has one, the neutral wash where it has none.
    check('plan: the goal and epic washes carry their type\'s configured colour, and strategy and objective carry none',
      all.length === TIERS.length && all.every((w) => w.typed === colourOf(w).color), all.map((w) => [w.tier, w.typed]));
    check('plan: the page paints the goal and epic washes in that colour',
      all.filter((w) => colourOf(w).color).length === 2 && all.filter((w) => colourOf(w).color).every((w) => w.fill === colourOf(w).fill), all.map((w) => [w.tier, w.fill]));
    const muted = rgbOf(await ev(MUTED));
    check('plan: the strategy and objective washes are the neutral wash, in the muted token, and not in another tier\'s colour',
      all.filter((w) => !colourOf(w).color).length === 2 && all.filter((w) => !colourOf(w).color).every((w) => w.fill === muted), { muted, all });
    check('plan: every wash is faint, and takes no pointer', all.length === TIERS.length && all.every((w) => near(w.opacity, OPACITY) && w.events === 'none'), all);

    // Behind everything: the washes are the first marks of the world.
    const order = await ev(ORDER);
    check('plan: the washes are drawn first, before every guide arc, line, dot and caption',
      order.washes === TIERS.length && order.lastWash === TIERS.length - 1 && order.firstOther === TIERS.length && order.marks > order.washes, order);

    // Each wash holds the dots of its tier.
    const dots = await ev(DOTS);
    check('plan: each wash holds every dot of its tier', all.length === TIERS.length && all.every((w, i) => plan.tiers[i].every((id) => {
      const p = dots[id];
      const r = p ? Math.hypot(p.x, p.y) : NaN;
      return r > w.radii[1] && r < w.radii[0];
    })), { all, dots });

    // A wash never takes a click: where a wash lies and nothing else does, the pointer is on the canvas.
    const probes = {};
    for (const t of TIERS) probes[t.name] = await ev(probe(t.name));
    check('plan: the pointer is never on a wash, anywhere in any of the four bands',
      TIERS.every((t) => !!probes[t.name] && probes[t.name].inside > 100 && probes[t.name].washHit === 0), probes);
    check('plan: and each band has spots where the pointer is on the canvas, a click there is on empty space',
      TIERS.every((t) => !!probes[t.name] && probes[t.name].canvasHit >= 10 && !!probes[t.name].spot), probes);

    // A click on a washed spot acts as on empty space: it leaves two picked cards, a double click clears them.
    const found = [];
    for (const id of plan.tiers.flat().concat(plan.depths.flat())) {
      if (found.length === 2) break;
      if (await ev(dotPoint(id))) found.push(id);
    }
    check('plan: two dots can be clicked', found.length === 2, found);
    for (const id of found) {
      const p = await ev(dotPoint(id));
      await click(p.x, p.y, { modifiers: 2 });
    }
    check('plan: Ctrl+click picks the two cards', await pickedIs(found), await picked());
    const spot = probes.strategy && probes.strategy.spot;
    check('plan: there is a washed spot with nothing on it to click', !!spot, probes.strategy);
    if (spot) {
      await click(spot.x, spot.y);
      await frames();
      check('plan: a click on a washed band leaves the selection as it was', sameList(await picked(), found.slice().sort((a, b) => a - b)), await picked());
      await click(spot.x, spot.y, { clickCount: 1 });
      await click(spot.x, spot.y, { clickCount: 2 });
      check('plan: a double click on a washed band clears the selection', await pickedIs([]), await picked());
    }

    // The Unnested option's table puts the loose cards in the block: no wash for it either.
    await ev(USE_TABLE);
    await waitFor(TABLE_DRAWN, 6000);
    check('plan: with the Unnested block drawn, the same four washes stand and the block has none',
      (await waitFor(washesAre(TIERS.map((t) => t.name)), 6000)) && (await ev(`document.querySelectorAll('#graph-view .graph-block-frame').length>0`)), await ev(WASH_TIERS));

    // A slice: cut and a status pill keep the washes of the bands still drawn and drop those of the bands they empty.
    await ev(writeBox('slice:goal'));
    check('plan: slice:goal leaves the goal wash and no other', await waitFor(washesAre(['goal']), 8000), await ev(WASH_TIERS));
    const cut = await washes();
    const cutBands = (await ev(BANDS)).filter((b) => b.kind === 'tier' && b.count);
    check('plan: and the goal wash is on the goal band as the cut leaves it', cut.length === 1 && cutBands.length === 1 && near(cut[0].radii[0], cutBands[0].r1) && near(cut[0].radii[1], cutBands[0].r0), { cut, cutBands });
    await ev(writeBox(''));
    check('plan: clearing the box brings the four washes back', await waitFor(washesAre(TIERS.map((t) => t.name)), 8000), await ev(WASH_TIERS));
    await ev(STATUS_PILL);
    check(`plan: the ${PILL} status pill off drops the epic wash, the epic being the one card ${PILL}, and keeps the others`,
      await waitFor(washesAre(['goal', 'strategy', 'objective']), 8000), await ev(WASH_TIERS));
    await ev(STATUS_PILL);
    check(`plan: the ${PILL} status pill back on brings it back`, await waitFor(washesAre(TIERS.map((t) => t.name)), 8000), await ev(WASH_TIERS));

    // The wash reads in both themes.
    for (const scheme of ['dark', 'light']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await frames();
      const w = await washes();
      const mut = rgbOf(await ev(MUTED));
      check(`plan: in the ${scheme} theme the washes are faint, in the type's own colour or the theme's muted token`,
        w.length === TIERS.length && w.every((x) => near(x.opacity, OPACITY) && x.events === 'none' && x.fill === (colourOf(x).fill || mut)), { mut, w });
    }

    // The Flow draws none.
    for (const layout of ['flow']) {
      await ev(pickLayout(layout));
      await waitFor(layoutIs(layout), 10000);
      check(`plan: the ${layout} draws no wash`, (await ev(WASH_TIERS)).length === 0);
    }
    await ev(pickLayout('tiers'));
    await waitFor(layoutIs('tiers'), 10000);
    check('plan: and Tiers draws the four again', await waitFor(washesAre(TIERS.map((t) => t.name)), 6000), await ev(WASH_TIERS));

    // --- the fixture board has no hierarchy: depth rings only, and no wash ---------------------
    check('fixture: the Graph draws in Tiers', await openGraph('fixture'));
    check('fixture: a board without a hierarchy draws no wash', (await ev(WASH_TIERS)).length === 0 && (await ev(BANDS)).every((b) => b.kind !== 'tier'), await ev(BANDS));
  },
};
