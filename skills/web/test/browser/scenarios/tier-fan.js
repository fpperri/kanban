'use strict';
// The tier fan, drawn. In Tiers the plan board draws a band for each tier of its
// hierarchy (goal, strategy, objective, epic), tier 1 nearest the centre, then a
// ring for each depth that holds a card without a tier, and the loose cards
// without a tier sit in the Unnested block outside the fan. The fixture board has
// no hierarchy, so its rings follow depth. The malformed board's hierarchy lists
// a name twice in two cases, and Tiers still draws. The harness closes the
// scenario with the console-error check, which covers all three boards.
//
// A dot is read where it is drawn: the translate of its node. The band edges are
// read from the Graph's own layout (graphCur), so "outside every band" is
// measured against the band and not against a dot of it.
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
// children.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur.

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const CASES = {
  plan: {
    tiers: [[1, 25], [2, 26], [7], [22]],
    depths: [[3, 4, 5, 6], [8], [23], [24]],
    block: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 27, 28, 29],
    archived: [19, 20, 21],
  },
  fixture: {
    depths: [[1], [2, 3, 4, 5, 6], [7, 8]],
    block: range(9, 18),
  },
  malformed: {
    tiers: [[1], [2]],
    depths: [[3]],
    block: [4],
  },
};

// id -> { x, y } of every dot in the Graph, null where a translate is not a number.
const DOTS = `(()=>{const out={};for(const n of document.querySelectorAll('#graph-view .graph-node')){const m=/translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(n.getAttribute('transform')||'');out[n.dataset.id]=m?{x:Number(m[1]),y:Number(m[2])}:null}return out})()`;

// The outer edge of every tier band, tier 1 first, and of the last band of all.
const BAND_EDGES = `(()=>{const bands=graphCur.layout.bands;return {tiers:bands.filter((b)=>b.slice.kind==='tier').map((b)=>b.r1),outer:bands.length?bands[bands.length-1].r1:0}})()`;

const TIERS_PRESSED = `(document.querySelector('.graph-layout-btn[aria-pressed=true]')||{dataset:{}}).dataset.layout==='tiers'`;
const DRAWN = `document.querySelectorAll('#graph-view .graph-node').length>0`;
const ARCHIVE_PILL = `document.querySelector('.graph-filter-toggle[data-col=archive]').click()`;

module.exports = {
  name: 'tier-fan',
  board: 'plan',
  alsoBoards: ['fixture', 'malformed'],
  timeoutMs: 60000,
  CASES,
  DOTS,
  BAND_EDGES,
  TIERS_PRESSED,
  DRAWN,
  ARCHIVE_PILL,
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
    const ofDot = (all, id) => (all[id] ? Math.hypot(all[id].x, all[id].y) : NaN);
    const finite = (all) => Object.values(all).every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    const radii = (all, ids) => ids.map((id) => ofDot(all, id));
    const apart = (list) => list.every((x) => Number.isFinite(x));

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
      await shot('tier-fan-plan');

      await ev(ARCHIVE_PILL);
      check('plan: the Archive pill draws the archived cards', await waitFor(`${[19, 20, 21].map((id) => `!!document.querySelector('#graph-view .graph-node[data-id="${id}"]')`).join('&&')}`), Object.keys(await dots()));
      check('plan: and no dot position is NaN with them', finite(await dots()));
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
    }
  },
};
