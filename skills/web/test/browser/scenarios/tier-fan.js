'use strict';
// The tier fan, drawn. In Tiers the plan board draws a band for each tier of its
// hierarchy (goal, strategy, objective, epic), tier 1 nearest the centre, then a
// ring for each depth that holds a card without a tier, and the loose cards
// without a tier sit in the Unnested block outside the fan. The fan goes all the
// way round the centre but for a narrow seam at the top, where the band captions
// (name and count) stand one above another, neighbours on opposite sides of it.
// Around the dots the fan also draws a guide arc for each band, a divider between
// sectors, a caption for the loose cards that have a tier, outside the rim, and
// the block's title and a caption for each of its columns. No two captions
// overlap, at the first draw or after Fit. The fixture board has no hierarchy,
// so its rings follow depth and no caption names a tier. The malformed board's
// hierarchy lists a name twice in two cases, and Tiers still draws each tier once.
// The harness closes the scenario with the console-error check, which covers all
// three boards.
//
// A dot is read where it is drawn: the translate of its node. The band edges are
// read from the Graph's own layout (graphCur), so "outside every band" is
// measured against the band and not against a dot of it. A caption is read from
// its two tspans, the name and the count, and its x and y.
//
// What each board's cards are is written out by hand from the fixtures, and
// skills/web/test/browser-tier-fan-scenario.test.js holds the lists to the real
// board readers and the Graph model over each board's own cards.
//
// The plan board's live cards are 1 to 18 and 22 to 29, and 19 to 21 are
// archived. Cards 1 and 25 are goals (25 is nested under the epic 22, against
// the hierarchy), 2 and 26 strategies, 7 the objective and 22 the epic. Cards 3
// to 6, 8, 23 and 24 are nested and have no tier (a story and a task among them),
// at depths 1, 1, 1, 1, 2, 4 and 5. Every other live card has no parent and no
// children. Card 26 is the one loose card with a tier. Card 1's type has the star
// icon and card 14's type an icon name that is not one.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur.

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const CASES = {
  plan: {
    tiers: [[1, 25], [2, 26], [7], [22]],
    tierNames: ['goal', 'strategy', 'objective', 'epic'],
    depths: [[3, 4, 5, 6], [8], [23], [24]],
    depthNames: ['depth 1', 'depth 2', 'depth 4', 'depth 5'],
    block: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 27, 28, 29],
    blockColumns: { backlog: [11, 14, 18, 28], todo: [10, 13, 17, 27], doing: [9, 15], done: [12, 16, 29] },
    archived: [19, 20, 21],
    archivedBlock: [20, 21],
    looseTier: [26],
    starCard: 1,
    unknownIconCard: 14,
    extraLoose: { title: 'Plan the second objective', type: 'objective', status: 'todo' },
  },
  fixture: {
    depths: [[1], [2, 3, 4, 5, 6], [7, 8]],
    depthNames: ['roots', 'depth 1', 'depth 2'],
    block: range(9, 18),
  },
  malformed: {
    tiers: [[1], [2]],
    tierNames: ['goal', 'epic'],
    depths: [[3]],
    block: [4],
  },
};

// id -> { x, y } of every dot in the Graph, null where a translate is not a number.
const DOTS = `(()=>{const out={};for(const n of document.querySelectorAll('#graph-view .graph-node')){const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform')||'');out[n.dataset.id]=m?{x:Number(m[1]),y:Number(m[2])}:null}return out})()`;

// The outer edge of every tier band, tier 1 first, and of the last band of all.
const BAND_EDGES = `(()=>{const bands=graphCur.layout.bands;return {tiers:bands.filter((b)=>b.slice.kind==='tier').map((b)=>b.r1),outer:bands.length?bands[bands.length-1].r1:0}})()`;

// What the fan draws around its dots, as the page has it: each caption (its name,
// count, kind and place), every guide arc's path, every divider's ends, the caption
// of the loose cards with a tier, and the Unnested block (its frame, its title and
// the caption of each column). A caption is { name, count, kind, x, y }.
const FAN_MARKS = `(()=>{const q=(s)=>[...document.querySelectorAll('#graph-view '+s)];`
  + `const cap=(el)=>{const t=[...el.querySelectorAll('tspan')].map((s)=>s.textContent);return {name:t[0],count:Number(t[1]),kind:el.getAttribute('data-kind')||'',x:parseFloat(el.getAttribute('x')),y:parseFloat(el.getAttribute('y'))}};`
  + `const frame=q('.graph-block-frame')[0];const title=q('.graph-block-title')[0];const loose=q('.graph-loose-caption')[0];`
  + `return {captions:q('.graph-caption:not(.graph-loose-caption)').map(cap),guides:q('.graph-guide').map((g)=>g.getAttribute('d')),`
  + `dividers:q('.graph-divider').map((l)=>['x1','y1','x2','y2'].map((k)=>parseFloat(l.getAttribute(k)))),loose:loose?cap(loose):null,`
  + `block:frame?{x:parseFloat(frame.getAttribute('x')),y:parseFloat(frame.getAttribute('y')),w:parseFloat(frame.getAttribute('width')),h:parseFloat(frame.getAttribute('height')),`
  + `title:title?cap(title):null,captions:q('.graph-block-caption').map(cap)}:null}})()`;

// The sectors of the fan, as the layout has them: { kind, tops, from, to } in radians,
// turning from the left of the seam round to its right (`from` the larger), and the
// sweep they share, { from, to }.
const SECTORS = `graphCur.layout.sectors.map((s)=>({kind:s.kind,tops:s.tops,from:s.from,to:s.to}))`;
const SWEEP = `({from:graphCur.layout.fan.from,to:graphCur.layout.fan.to})`;

// Where everything sits on screen: the stage, each dot, each caption and the block's frame.
const RECTS = `(()=>{const r=(e)=>{const b=e.getBoundingClientRect();return {l:b.left,t:b.top,r:b.right,b:b.bottom}};const svg=document.querySelector('#graph-view .graph-canvas');if(!svg)return null;`
  + `const q=(s)=>[...document.querySelectorAll('#graph-view '+s)];const frame=q('.graph-block-frame')[0];`
  + `return {stage:r(svg),dots:q('.graph-node').map((e)=>Object.assign({id:e.dataset.id},r(e))),`
  + `captions:q('.graph-caption,.graph-block-title,.graph-block-caption').map((e)=>Object.assign({text:e.textContent},r(e))),block:frame?r(frame):null}})()`;

// The ends of the outermost guide arc as the page has them on screen, with the stage:
// the left, right, top and bottom of the circle the fan is drawn on.
const CIRCLE = `(()=>{const v=graphCur.view;const s=document.querySelector('#graph-view .graph-canvas').getBoundingClientRect();`
  + `const R=Math.max(...graphCur.layout.rings.map((r)=>r.r));const at=(x,y)=>({x:s.left+v.x+x*v.k,y:s.top+v.y+y*v.k});`
  + `return {stage:{l:s.left,t:s.top,r:s.right,b:s.bottom},points:[at(-R,0),at(R,0),at(0,-R),at(0,R)]}})()`;

const TIERS_PRESSED = `(document.querySelector('.graph-layout-btn[aria-pressed=true]')||{dataset:{}}).dataset.layout==='tiers'`;
const DRAWN = `document.querySelectorAll('#graph-view .graph-node').length>0`;
const ARCHIVE_PILL = `document.querySelector('.graph-filter-toggle[data-col=archive]').click()`;
const FIT = `document.querySelector('.graph-zoom-btn[data-graph-action=fit]').click()`;
const ZOOM_IN = `document.querySelector('.graph-zoom-btn[data-graph-action=in]').click()`;
const FITTED = `graphCur.view.touched===false`;
const ZOOMED = `graphCur.view.touched===true`;
const layoutIs = (name) => `(document.querySelector('.graph-layout-btn[aria-pressed=true]')||{dataset:{}}).dataset.layout==='${name}'&&document.querySelectorAll('#graph-view .graph-node').length>0`;
const pickLayout = (name) => `document.querySelector('.graph-layout-btn[data-layout=${name}]').click()`;
const addLoose = (card) => `fetch('/api/cards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(card)})}).then((r)=>r.status)`;
const hasDot = (id) => `!!document.querySelector('#graph-view .graph-node[data-id="${id}"]')`;

// The shape of every dot, as the type-icons scenario reads it.
const { DOT_SHAPES } = require('./type-icons');

// Every number in a path or on a line is a finite one.
const NUMBER = /-?\d+(?:\.\d+)?(?:e-?\d+)?/g;
const finitePath = (d) => typeof d === 'string' && !/NaN|Infinity|undefined/.test(d) && (d.match(NUMBER) || []).length >= 4 && (d.match(NUMBER) || []).every((n) => Number.isFinite(Number(n)));
const finiteCap = (c) => !!c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.count) && typeof c.name === 'string' && c.name !== '';
const finiteMarks = (m) => !!m && m.guides.length > 0 && m.guides.every(finitePath)
  && m.dividers.every((l) => l.length === 4 && l.every(Number.isFinite)) && m.captions.length > 0 && m.captions.every(finiteCap)
  && (!m.loose || finiteCap(m.loose)) && (!m.block || (finiteCap(m.block.title) && m.block.captions.every(finiteCap)
    && [m.block.x, m.block.y, m.block.w, m.block.h].every(Number.isFinite)));

// The angle of a dot's place, turned as the sweep turns: from its `to` up to its `from`.
const turned = (p, sweep) => {
  const a = Math.atan2(p.y, p.x);
  return a < sweep.to - 1e-9 ? a + 2 * Math.PI : a;
};
const QUARTERS = (all, ids) => [...new Set(ids.filter((id) => all[id]).map((id) => `${all[id].x < 0 ? 'left' : 'right'} ${all[id].y < 0 ? 'top' : 'bottom'}`))].sort();

// Two captions on screen overlap when their boxes share more than a pixel.
const overlapping = (captions) => {
  const out = [];
  for (let i = 0; i < captions.length; i++) {
    for (let j = i + 1; j < captions.length; j++) {
      const a = captions[i];
      const b = captions[j];
      if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) out.push(`${a.text} and ${b.text}`);
    }
  }
  return out;
};

// The circle's four ends and the stage they have to lie in.
const circleOutside = (c) => (c ? c.points.filter((p) => p.x < c.stage.l || p.x > c.stage.r || p.y < c.stage.t || p.y > c.stage.b) : [{}]);

// A guide arc's radius: the first number after the A of its path.
const guideRadii = (guides) => guides.map((d) => Number(/A(-?[\d.]+)/.exec(d)[1]));

// Everything that lies outside the stage, by name.
function outsideStage(r, slack = 1) {
  const out = [];
  const inside = (b) => b.l >= r.stage.l - slack && b.t >= r.stage.t - slack && b.r <= r.stage.r + slack && b.b <= r.stage.b + slack;
  for (const d of r.dots) if (!inside(d)) out.push(`dot ${d.id}`);
  for (const c of r.captions) if (!inside(c)) out.push(`caption ${c.text}`);
  if (r.block && !inside(r.block)) out.push('the Unnested block');
  return out;
}

module.exports = {
  name: 'tier-fan',
  board: 'plan',
  alsoBoards: ['fixture', 'malformed'],
  timeoutMs: 120000,
  CASES,
  DOTS,
  BAND_EDGES,
  FAN_MARKS,
  SECTORS,
  SWEEP,
  CIRCLE,
  RECTS,
  TIERS_PRESSED,
  DRAWN,
  ARCHIVE_PILL,
  FIT,
  ZOOM_IN,
  FITTED,
  ZOOMED,
  layoutIs,
  pickLayout,
  addLoose,
  hasDot,
  outsideStage,
  overlapping,
  circleOutside,
  turned,
  finiteMarks,
  async run(page) {
    const { ev, open, waitFor, check, shot } = page;

    // A page that is being left still answers for a moment after the navigation
    // starts, so a wait on the new page would read the old one. The old page is
    // marked, and the new one is the first without the mark.
    const load = async (url, key) => {
      await ev('window.__stale=true');
      await open(url, key);
      return waitFor('!window.__stale', 10000);
    };
    const dots = () => ev(DOTS);
    const marks = () => ev(FAN_MARKS);
    const ofDot = (all, id) => (all[id] ? Math.hypot(all[id].x, all[id].y) : NaN);
    const finite = (all) => Object.values(all).every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    const radii = (all, ids) => ids.map((id) => ofDot(all, id));
    const apart = (list) => list.every((x) => Number.isFinite(x));
    const names = (list) => list.map((c) => c.name);
    const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

    // Every group sits on one ring, and each group's ring is farther out than the last.
    const inOrder = (all, groups) => {
      let last = -Infinity;
      for (const ids of groups) {
        const rs = radii(all, ids);
        if (!apart(rs) || Math.max(...rs) - Math.min(...rs) > 0.5 || Math.min(...rs) <= last) return false;
        last = Math.max(...rs);
      }
      return true;
    };
    const openGraph = async (key) => {
      await load('/?view=graph', key);
      const drawn = await waitFor(`${DRAWN}&&${TIERS_PRESSED}`, 10000);
      check(`${key}: the Graph draws in Tiers`, drawn);
      return drawn;
    };
    const pick = async (name) => {
      await ev(pickLayout(name));
      return waitFor(layoutIs(name), 10000);
    };
    // Nothing of the fan is on the page.
    const fanGone = (m) => m.captions.length === 0 && m.guides.length === 0 && m.dividers.length === 0 && m.loose === null && m.block === null;

    // --- the plan board: bands for the tiers, rings for the depths, the Unnested block -------
    const plan = CASES.plan;
    if (await openGraph('plan')) {
      const all = await dots();
      check('plan: no dot position is NaN', finite(all), all);
      check('plan: every live card is drawn, and no archived one', plan.tiers.flat().concat(plan.depths.flat(), plan.block).every((id) => all[id]) && plan.archived.every((id) => !all[id]), Object.keys(all));
      const tiers = plan.tiers.map((ids) => radii(all, ids));
      check('plan: every dot of a tier sits closer to the centre than every dot of the next tier', tiers.every((rs) => apart(rs)) && tiers.slice(1).every((rs, i) => Math.max(...tiers[i]) < Math.min(...rs)), tiers);
      const edges = await ev(BAND_EDGES);
      check('plan: the layout has a band for each of the four tiers', edges.tiers.length === 4 && edges.tiers.every((r, i) => i === 0 || r > edges.tiers[i - 1]), edges);
      const outside = plan.depths.flat().concat(plan.block).map((id) => ofDot(all, id));
      check('plan: the cards with no tier sit outside every tier band', apart(outside) && Math.min(...outside) > edges.tiers[3], { outside, edges });
      check('plan: the nested cards with no tier sit on a ring for each depth, in depth order', inOrder(all, plan.depths), plan.depths.map((ids) => radii(all, ids)));
      const block = radii(all, plan.block);
      check('plan: the Unnested cards sit outside the fan', apart(block) && Math.min(...block) > edges.outer, { block, edges });

      // The captions: a tier that has a card shows its name and count, in hierarchy
      // order from the centre, and one caption for each non-empty depth follows.
      const m = await marks();
      const tierCaps = m.captions.filter((c) => c.kind === 'tier');
      const depthCaps = m.captions.filter((c) => c.kind === 'depth');
      check('plan: each tier that has a card shows one caption with its name and count, in hierarchy order from the centre',
        sameList(names(tierCaps), plan.tierNames) && sameList(tierCaps.map((c) => c.count), plan.tiers.map((ids) => ids.length))
        && tierCaps.every((c, i) => i === 0 || c.y < tierCaps[i - 1].y), tierCaps);
      check('plan: one caption per non-empty depth follows, in depth order', sameList(names(depthCaps), plan.depthNames)
        && sameList(depthCaps.map((c) => c.count), plan.depths.map((ids) => ids.length)) && depthCaps.every((c, i) => c.y < (i ? depthCaps[i - 1].y : (tierCaps[tierCaps.length - 1] || { y: 0 }).y))
        && m.captions.length === tierCaps.length + depthCaps.length, depthCaps);
      check('plan: the captions stand up the seam at the top, neighbours on opposite sides of it',
        m.captions.every((c, i) => c.y < 0 && (i % 2 ? c.x > 0 : c.x < 0) && Math.abs(c.x) < 20), m.captions);

      // The fan goes all the way round the centre but for the seam at the top.
      const sweep = await ev(SWEEP);
      const ringIds = plan.tiers.flat().concat(plan.depths.flat());
      check('plan: the fan sweeps all but a narrow seam of the circle, and its dots are in every quarter of it',
        sweep.from - sweep.to > 1.9 * Math.PI && sweep.from - sweep.to < 2 * Math.PI && QUARTERS(all, ringIds).length === 4, { sweep, quarters: QUARTERS(all, ringIds) });
      check('plan: no dot stands on the seam', ringIds.every((id) => !!all[id] && turned(all[id], sweep) <= sweep.from + 1e-6), ringIds.map((id) => all[id]));
      check('plan: every guide arc, divider and caption has finite coordinates', finiteMarks(m) && m.dividers.length >= 1, m);
      const radiiOfGuides = guideRadii(m.guides);
      check('plan: there is a guide arc for each band, and none is drawn through the cards of the Unnested block',
        m.guides.length >= plan.tiers.length + plan.depths.length
        && plan.block.every((id) => radiiOfGuides.every((r) => Math.abs(ofDot(all, id) - r) > 6)), { radiiOfGuides, block });

      // The sector of loose cards with a tier is one sector, with a caption that counts them.
      const sectors = await ev(SECTORS);
      const looseSectors = sectors.filter((s) => s.kind === 'loose');
      check('plan: the loose cards with a tier share one sector, under a caption that counts them',
        looseSectors.length === 1 && sameList(looseSectors[0].tops, plan.looseTier) && !!m.loose && m.loose.count === plan.looseTier.length
        && m.loose.name === 'Unnested, with a tier', { sectors, loose: m.loose });

      // The Unnested block: a caption for each status, with the cards of that status under it.
      const statuses = Object.keys(plan.blockColumns);
      const b = m.block;
      const captionOf = (id) => (b ? b.captions.filter((c) => c.x <= all[id].x).sort((p, q) => q.x - p.x)[0] : null);
      const underOwn = (status) => plan.blockColumns[status].every((id) => {
        const c = captionOf(id);
        return !!c && c.name === status && all[id].y > c.y && all[id].x >= b.x && all[id].x <= b.x + b.w && all[id].y <= b.y + b.h;
      });
      check('plan: the Unnested block is titled with its count and has a column caption for each status, in the board\'s order',
        !!b && !!b.title && b.title.name === 'Unnested' && b.title.count === plan.block.length && sameList(names(b.captions), statuses)
        && b.captions.every((c, i) => c.count === plan.blockColumns[statuses[i]].length && (i === 0 || c.x > b.captions[i - 1].x)), b);
      check('plan: every loose card without a tier is in the block under the caption for its status', !!b && statuses.every(underOwn), b);
      check('plan: and none of them is on a ring', plan.block.every((id) => radiiOfGuides.every((r) => Math.abs(ofDot(all, id) - r) > 6) && ofDot(all, id) > edges.outer), { block });

      // The star-typed card's dot is a star, the card of the type with an unknown icon is round.
      const shapes = await ev(DOT_SHAPES);
      check('plan: in the fan a star-typed card\'s dot is a star', shapes[plan.starCard] === 'star', shapes[plan.starCard]);
      check('plan: and a card of the unknown-icon type has a round dot', shapes[plan.unknownIconCard] === 'circle', shapes[plan.unknownIconCard]);

      // Fit, and the first draw, frame every dot, every caption and the block.
      const first = await ev(RECTS);
      check('plan: the first draw frames every dot, every caption and the Unnested block', !!first && outsideStage(first).length === 0, first && outsideStage(first));
      check('plan: the first draw frames the whole circle', circleOutside(await ev(CIRCLE)).length === 0, await ev(CIRCLE));
      check('plan: no two captions overlap at the first draw', !!first && overlapping(first.captions).length === 0, first && overlapping(first.captions));
      await ev(ZOOM_IN);
      await ev(ZOOM_IN);
      await waitFor(ZOOMED);
      await ev(FIT);
      await waitFor(FITTED);
      const fitted = await ev(RECTS);
      check('plan: after Fit every dot, every caption and the Unnested block lie inside the canvas', !!fitted && outsideStage(fitted).length === 0, fitted && outsideStage(fitted));
      check('plan: after Fit the whole circle lies inside the canvas', circleOutside(await ev(CIRCLE)).length === 0, await ev(CIRCLE));
      check('plan: no two captions overlap after Fit', !!fitted && overlapping(fitted.captions).length === 0, fitted && overlapping(fitted.captions));
      await shot('tier-fan-plan');

      // Force and Status draw none of it, and Tiers brings it back.
      for (const other of ['force', 'status']) {
        if (await pick(other)) {
          const gone = await marks();
          check(`plan: ${other} draws no arc, caption, divider or block`, fanGone(gone), gone);
        }
      }
      if (await pick('tiers')) {
        const back = await marks();
        check('plan: back in Tiers the arcs, captions, dividers and block are back', sameList(back.guides, m.guides) && sameList(names(back.captions), names(m.captions))
          && back.dividers.length === m.dividers.length && !!back.block && !!back.loose, back);
      }

      // The Archive status pill brings the archived cards: an archived loose card without a tier is in the block's archived column.
      await ev(ARCHIVE_PILL);
      check('plan: the Archive pill draws the archived cards', await waitFor(plan.archived.map(hasDot).join('&&')), Object.keys(await dots()));
      const withArchive = await dots();
      check('plan: and no dot position is NaN with them', finite(withArchive));
      const shown = await marks();
      const archivedCol = shown.block && shown.block.captions[shown.block.captions.length - 1];
      check('plan: with the Archive pill on, an archived loose card without a tier shows in the block\'s archived column',
        !!archivedCol && archivedCol.name === 'archived' && archivedCol.count === plan.archivedBlock.length
        && plan.archivedBlock.every((id) => withArchive[id] && withArchive[id].x >= archivedCol.x && withArchive[id].y > archivedCol.y), shown.block);
      const after = await ev(BAND_EDGES);
      const inBlock = (id) => !!shown.block && withArchive[id].x >= shown.block.x && withArchive[id].x <= shown.block.x + shown.block.w
        && withArchive[id].y >= shown.block.y && withArchive[id].y <= shown.block.y + shown.block.h;
      check('plan: an archived card that is nested stays on its ring and out of the block', plan.archived.filter((id) => !plan.archivedBlock.includes(id))
        .every((id) => withArchive[id] && !inBlock(id) && ofDot(withArchive, id) < after.outer), { shown: shown.block, after });

      // A second loose card with a tier joins the first in the same sector, and the caption counts both.
      const added = await ev(addLoose(plan.extraLoose));
      check('plan: a second loose card with a tier is created', added === 201, added);
      await load('/?view=graph', 'plan');
      await waitFor(`${DRAWN}&&${TIERS_PRESSED}&&document.querySelectorAll('#graph-view .graph-node').length>${Object.keys(withArchive).length}`, 10000);
      const grown = await ev(SECTORS);
      const looseNow = grown.filter((s) => s.kind === 'loose');
      const grownDots = await dots();
      const newId = Object.keys(grownDots).map(Number).find((id) => !withArchive[id]);
      const sweepNow = await ev(SWEEP);
      const inSector = (id, s) => {
        const a = turned(grownDots[id], sweepNow);
        return a <= s.from + 1e-6 && a >= s.to - 1e-6;
      };
      const grownMarks = await marks();
      check('plan: the loose cards with a tier, two now, still share one sector, and its caption counts both',
        looseNow.length === 1 && looseNow[0].tops.length === 2 && looseNow[0].tops.includes(plan.looseTier[0]) && looseNow[0].tops.includes(newId)
        && looseNow[0].tops.every((id) => inSector(id, looseNow[0])) && !!grownMarks.loose && grownMarks.loose.count === 2, { grown, loose: grownMarks.loose });
    }

    // --- the fixture board has no hierarchy: the rings follow depth ------------------------
    const fixture = CASES.fixture;
    if (await openGraph('fixture')) {
      const all = await dots();
      check('fixture: no dot position is NaN', finite(all), all);
      check('fixture: the rings follow depth, one ring for each depth', inOrder(all, fixture.depths), fixture.depths.map((ids) => radii(all, ids)));
      const edges = await ev(BAND_EDGES);
      const block = radii(all, fixture.block);
      check('fixture: the loose cards sit outside the rings', apart(block) && edges.tiers.length === 0 && Math.min(...block) > edges.outer, { block, edges });
      const m = await marks();
      check('fixture: the fan shows depth captions and no tier caption', sameList(names(m.captions), fixture.depthNames)
        && sameList(m.captions.map((c) => c.count), fixture.depths.map((ids) => ids.length)) && m.captions.every((c) => c.kind === 'depth'), m.captions);
      check('fixture: every guide arc, divider and caption has finite coordinates', finiteMarks(m), m);
      const rects = await ev(RECTS);
      check('fixture: the first draw frames every dot, every caption and the Unnested block', !!rects && outsideStage(rects).length === 0, rects && outsideStage(rects));
      check('fixture: the first draw frames the whole circle, and no two captions overlap', circleOutside(await ev(CIRCLE)).length === 0 && !!rects && overlapping(rects.captions).length === 0,
        rects && overlapping(rects.captions));
    }

    // --- the malformed board's hierarchy names two tiers, each twice ------------------------
    const malformed = CASES.malformed;
    if (await openGraph('malformed')) {
      const all = await dots();
      check('malformed: no dot position is NaN', finite(all), all);
      const edges = await ev(BAND_EDGES);
      const tiers = malformed.tiers.map((ids) => radii(all, ids));
      check('malformed: the two tiers are bands, the first nearer the centre', edges.tiers.length === 2 && tiers.every((rs) => apart(rs)) && Math.max(...tiers[0]) < Math.min(...tiers[1]), { tiers, edges });
      const depth = radii(all, malformed.depths[0]);
      check('malformed: the depth ring is outside the tiers and the Unnested card outside the fan', apart(depth) && Math.min(...depth) > edges.tiers[1] && Math.min(...radii(all, malformed.block)) > edges.outer, { depth, edges });
      const m = await marks();
      const tierCaps = m.captions.filter((c) => c.kind === 'tier');
      check('malformed: the fan captions each tier once', sameList(tierCaps.map((c) => c.name.toLowerCase()), malformed.tierNames)
        && sameList(tierCaps.map((c) => c.count), malformed.tiers.map((ids) => ids.length)), tierCaps);
      check('malformed: every guide arc, divider and caption has finite coordinates', finiteMarks(m), m);
    }
  },
};
