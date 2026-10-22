'use strict';
// The tier fan's Unnested option: where the cards with no parent, no children and no tier
// are drawn, one of four modes in the option row, kept for the board in the browser. The Graph
// opens with outermost.
//   outermost  one ring outside every depth ring, grouped by status in the board's order
//              (archived cards last), under an `unnested` caption on the seam, level with the
//              ring, after the captions of the bands; its tip counts the cards and names no slice.
//   off        the cards are not drawn, and neither is any relation to a card that is.
//   depth 0    on the depth 0 ring, between the tier bands and depth 1, in a sector of their
//              own; the ring's caption is the depth 0 band's, depth 0, and counts them with the
//              nested cards of that depth.
//   table      the Unnested block outside the rim, a column for each status (tier-fan's checks).
// In every mode the view frames what is drawn, at the first draw after a press and after Fit,
// the whole circle with it, and no two captions overlap, the unnested caption's text clear of
// every dot. A selection reaches only the cards the Graph draws, so a card that is off leaves
// it and comes back with the card. A reload keeps the mode, another board keeps its own, and
// the Flow draws every card whatever the option says.
//
// A press is a real click at the centre of the element, as a person makes it, and every wait
// is on the page, never on a fixed sleep.
//
// The plan board's live cards are 1 to 18 and 22 to 29 (19 to 21 are archived). Thirteen of
// them have no parent, no children and no tier: 9 to 18 and 27 to 29. By status they are
// backlog 11, 14, 18 and 28, todo 10, 13, 17 and 27, doing 9 and 15, done 12, 16 and 29; the
// archived cards 20 and 21 are two more, last. Card 27 waits for card 5, the one relation that
// joins an unnested card to another. Cards 3 to 6, 8 and 23 are at depth 0 (right under a tier card) and card 24 at depth 1. The fixture board's cards 9
// to 18 are its unnested cards; the malformed board's card 4 is its one. The fixture board has
// no hierarchy, so its rings follow depth and the ring of unnested cards comes after them.
//
// skills/web/test/browser-tier-fan-unnested-scenario.test.js holds these lists to the Graph
// model over each board's own cards, and runs the scenario against a stand-in page.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur, selectedIds.

const {
  DOTS, BAND_EDGES, FAN_MARKS, SECTORS, SWEEP, CIRCLE, RECTS, TIERS_PRESSED, DRAWN, ARCHIVE_PILL, FIT, ZOOM_IN, FITTED, ZOOMED,
  layoutIs, pickLayout, dotsAre, hasDot, turned, overlapping, outsideStage, circleOutside,
} = require('./tier-fan');
const {
  optionButton, ROW_STATE, ROW_SHOWN, pressedIs, SELECTED, dotPoint,
} = require('./tier-fan-options');

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const CASES = {
  plan: {
    modes: ['outermost', 'off', 'depth 0', 'table'],
    live: [...range(1, 18), ...range(22, 29)],
    // The unnested cards in the order the ring seats them, from the left of the seam round: by status in the board's order.
    ring: [11, 14, 18, 28, 10, 13, 17, 27, 9, 15, 12, 16, 29],
    split: ['backlog 4', 'todo 4', 'doing 2', 'done 3'],
    archived: [20, 21],
    depthZero: [3, 4, 5, 6, 8, 23],
    depthOne: [24],
    wait: { from: 5, to: 27 },
    picked: 27,
    tierCount: 4,
  },
  fixture: { live: range(1, 18), ring: range(9, 18) },
  malformed: { live: range(1, 4), ring: [4] },
};

// The lines the page draws that have one of `ids` at an end.
const linesTouching = (ids) => `graphCur.lines.filter((l)=>${JSON.stringify(ids.map(String))}.some((id)=>id===l.from||id===l.to)).length`;
// The Unnested row of the option row, with its buttons.
const UNNESTED_ROW = `(()=>{const s=${ROW_STATE};return s&&s.groups.find((g)=>g.label==='Unnested')||null})()`;

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a, b) => sameList(a.slice().sort(), b.slice().sort());

module.exports = {
  name: 'tier-fan-unnested',
  board: 'plan',
  alsoBoards: ['fixture', 'malformed'],
  timeoutMs: 120000,
  CASES,
  linesTouching,
  UNNESTED_ROW,
  async run(page) {
    const { ev, open, waitFor, centre, click, check, shot } = page;
    const plan = CASES.plan;

    const load = async (key) => {
      await ev('window.__stale=true');
      await open('/?view=graph', key);
      await waitFor('!window.__stale', 10000);
      return waitFor(`${DRAWN}&&${TIERS_PRESSED}`, 10000);
    };
    const pressOn = async (sel) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const shown = () => waitFor(ROW_SHOWN, 6000);
    const press = async (mode) => {
      await pressOn(optionButton('unnested', mode));
      return waitFor(pressedIs('unnested', mode), 6000);
    };
    const radius = (all, id) => (all[id] ? Math.hypot(all[id].x, all[id].y) : NaN);
    const radii = (all, ids) => ids.map((id) => radius(all, id));
    const finite = (list) => list.every((x) => Number.isFinite(x));
    const onOneRing = (all, ids) => {
      const rs = radii(all, ids);
      return finite(rs) && Math.max(...rs) - Math.min(...rs) < 0.5;
    };
    const seatsOf = (all, sweep, ids) => ids.slice().sort((a, b) => turned(all[b], sweep) - turned(all[a], sweep));
    const named = (m, name) => m.captions.filter((c) => c.name === name);
    const guideRadius = (d) => Number(/A(-?[\d.]+)/.exec(d)[1]);
    const framed = async (label) => {
      const first = await ev(RECTS);
      check(`${label}: the view frames every dot, every caption and the Unnested block`, !!first && outsideStage(first).length === 0, first && outsideStage(first));
      check(`${label}: the view frames the whole circle`, circleOutside(await ev(CIRCLE)).length === 0, await ev(CIRCLE));
      check(`${label}: no two captions overlap`, !!first && overlapping(first.captions).length === 0, first && overlapping(first.captions));
      await ev(ZOOM_IN);
      await ev(ZOOM_IN);
      await waitFor(ZOOMED);
      await ev(FIT);
      await waitFor(FITTED);
      const fitted = await ev(RECTS);
      check(`${label}: after Fit every dot, every caption and the Unnested block lie inside the canvas`, !!fitted && outsideStage(fitted).length === 0, fitted && outsideStage(fitted));
      check(`${label}: after Fit the whole circle lies inside the canvas and no two captions overlap`,
        circleOutside(await ev(CIRCLE)).length === 0 && !!fitted && overlapping(fitted.captions).length === 0, fitted && overlapping(fitted.captions));
      return fitted;
    };
    // The text of the caption `unnested` is clear of every dot of the ring.
    const clearOfDots = (rects, ids) => {
      const cap = rects.captions.find((c) => c.text === 'unnested');
      if (!cap) return false;
      return rects.dots.filter((d) => ids.includes(Number(d.id))).every((d) => d.r <= cap.l + 1 || d.l >= cap.r - 1 || d.b <= cap.t + 1 || d.t >= cap.b - 1);
    };
    const live = (ids) => dotsAre(ids);
    const others = (all, ids) => Object.keys(all).map(Number).filter((id) => !ids.includes(id));

    // --- the row offers the four modes, outermost marked at first ----------------------------------
    check('plan: the Graph draws in Tiers', await load('plan'));
    check('plan: the option row is shown', await shown());
    await ev(FIT);
    const row = await ev(UNNESTED_ROW);
    check('plan: the option row offers Unnested with off, outermost, depth 0 and table, outermost marked at first',
      !!row && sameSet(row.buttons.map((b) => b.val), plan.modes) && sameList(row.buttons.filter((b) => b.pressed).map((b) => b.val), ['outermost'])
      && row.buttons.every((b) => b.active === b.pressed && b.keeps === true && b.holds === false && b.text === b.val) && row.title.length > 20, row);

    // --- outermost: one ring outside every depth ring, grouped by status, under an unnested caption ---
    const everyCard = await waitFor(live(plan.live), 6000);
    let all = await ev(DOTS);
    let sweep = await ev(SWEEP);
    let marks = await ev(FAN_MARKS);
    check('plan outermost: every live card is drawn and no dot position is NaN', everyCard && finite(Object.values(all).flatMap((p) => (p ? [p.x, p.y] : [NaN]))), Object.keys(all));
    check('plan outermost: the unnested cards sit on one ring', onOneRing(all, plan.ring), radii(all, plan.ring));
    check('plan outermost: and it is outside every other dot', Math.min(...radii(all, plan.ring)) > Math.max(...radii(all, others(all, plan.ring))), { ring: radii(all, plan.ring) });
    check('plan outermost: grouped by status in the board\'s order, from the left of the seam round', sameList(seatsOf(all, sweep, plan.ring), plan.ring), seatsOf(all, sweep, plan.ring));
    check('plan outermost: no dot of the ring stands on the seam', plan.ring.every((id) => turned(all[id], sweep) <= sweep.from + 1e-6), sweep);
    const ringCaption = named(marks, 'unnested');
    check('plan outermost: one caption, unnested, counts the cards, after the captions of the bands, level with the ring on the seam',
      ringCaption.length === 1 && ringCaption[0].count === plan.ring.length && ringCaption[0].kind === 'unnested' && marks.captions[marks.captions.length - 1] === ringCaption[0]
      && ringCaption[0].y < 0 && Math.abs(ringCaption[0].x) < 20 && Math.abs(-ringCaption[0].y - radius(all, plan.ring[0])) < 1, marks.captions);
    check('plan outermost: there is no Unnested block', marks.block === null && named(marks, 'Unnested').length === 0, marks.block);
    check('plan outermost: a guide arc runs through the ring, and there is one for each ring the layout has',
      marks.guides.some((d) => Math.abs(guideRadius(d) - radius(all, plan.ring[0])) < 1) && marks.guides.length === await ev('graphCur.layout.rings.length'), marks.guides.map(guideRadius));
    const ringed = await framed('plan outermost');
    check('plan outermost: the caption\'s text is clear of every dot of the ring', !!ringed && clearOfDots(ringed, plan.ring), ringed && ringed.captions);
    check('plan outermost: the one relation that joins an unnested card to another is drawn', await ev(linesTouching(plan.ring)) === 1, await ev(linesTouching(plan.ring)));
    await shot('tier-fan-unnested-outermost');

    // --- the Archive pill brings the archived cards onto the ring, last ---------------------------------
    await ev(ARCHIVE_PILL);
    check('plan outermost: the Archive pill draws the archived cards', await waitFor(plan.archived.map(hasDot).join('&&')), Object.keys(await ev(DOTS)));
    all = await ev(DOTS);
    sweep = await ev(SWEEP);
    marks = await ev(FAN_MARKS);
    const withArchive = plan.ring.concat(plan.archived);
    check('plan outermost: with the Archive pill on, the archived unnested cards are on the ring, after the others', onOneRing(all, withArchive)
      && sameList(seatsOf(all, sweep, withArchive), withArchive) && (named(marks, 'unnested')[0] || {}).count === withArchive.length, seatsOf(all, sweep, withArchive));
    await ev(ARCHIVE_PILL);
    check('plan outermost: and the Archive pill off takes them away again', await waitFor(live(plan.live)), Object.keys(await ev(DOTS)));

    // --- off ---------------------------------------------------------------------------------------------
    await press('off');
    const kept = plan.live.filter((id) => !plan.ring.includes(id));
    check('plan off: the unnested cards are not drawn: every other live card is', await waitFor(live(kept), 6000), Object.keys(await ev(DOTS)));
    marks = await ev(FAN_MARKS);
    check('plan off: no relation to a card that is drawn is drawn: no line has an unnested card at an end', await ev(linesTouching(plan.ring)) === 0, await ev(linesTouching(plan.ring)));
    check('plan off: there is no unnested caption and no block', named(marks, 'unnested').length === 0 && marks.block === null, marks.captions);
    check('plan off: the lines the page lights are the lines it drew', await ev('graphCur.lines.length===document.querySelectorAll(\'#graph-view .graph-link\').length'));
    await framed('plan off');

    // --- depth 0 -----------------------------------------------------------------------------------------
    await press('depth 0');
    check('plan depth 0: every live card is drawn again', await waitFor(live(plan.live), 6000), Object.keys(await ev(DOTS)));
    all = await ev(DOTS);
    marks = await ev(FAN_MARKS);
    const edges = await ev(BAND_EDGES);
    const sectors = await ev(SECTORS);
    check('plan depth 0: the unnested cards sit on one ring with the nested cards of depth 0, outside the tier bands and inside depth 1',
      onOneRing(all, plan.ring.concat(plan.depthZero)) && Math.min(...radii(all, plan.ring)) > edges.tiers[plan.tierCount - 1] && Math.max(...radii(all, plan.ring)) < Math.min(...radii(all, plan.depthOne)),
      { ring: radii(all, plan.ring), edges, depthOne: radii(all, plan.depthOne) });
    const own = sectors.filter((s) => s.kind === 'unnested');
    check('plan depth 0: they share a sector of their own', own.length === 1 && sameSet(own[0].tops, plan.ring), sectors);
    const roots = named(marks, 'depth 0');
    check('plan depth 0: the ring is the depth 0 band, its caption depth 0 counts them and the nested cards of that depth, and nothing is captioned unnested',
      roots.length === 1 && roots[0].count === plan.ring.length + plan.depthZero.length && roots[0].kind === 'depth' && named(marks, 'unnested').length === 0 && marks.block === null, marks.captions);
    check('plan depth 0: the relation of card 27 to card 5 is drawn', await ev(linesTouching(plan.ring)) === 1, await ev(linesTouching(plan.ring)));
    await framed('plan depth 0');
    await shot('tier-fan-unnested-depth-0');

    // --- table ---------------------------------------------------------------------------------------------
    await press('table');
    check('plan table: every live card is drawn', await waitFor(live(plan.live), 6000), Object.keys(await ev(DOTS)));
    all = await ev(DOTS);
    marks = await ev(FAN_MARKS);
    const outer = (await ev(BAND_EDGES)).outer;
    check('plan table: the Unnested block is back, titled Unnested and counting the cards, outside the rim, and nothing is captioned unnested',
      !!marks.block && !!marks.block.title && marks.block.title.name === 'Unnested' && marks.block.title.count === plan.ring.length && named(marks, 'unnested').length === 0
      && Math.min(...radii(all, plan.ring)) > outer, { block: marks.block, outer });
    check('plan table: the block has a column for each status, its tip counting the cards', !!marks.block && sameList(marks.block.captions.map((c) => c.name), ['backlog', 'todo', 'doing', 'done'])
      && sameList(marks.block.captions.map((c) => c.count), [4, 4, 2, 3]), marks.block);
    await framed('plan table');
    await shot('tier-fan-unnested-table');

    // --- a selection reaches only the cards the Graph draws -------------------------------------------------
    await press('outermost');
    await waitFor(live(plan.live), 6000);
    const dot = await ev(dotPoint(plan.picked));
    check('plan: a dot of the ring is there to pick', !!dot);
    if (dot) {
      await click(dot.x, dot.y);
      check('plan outermost: a click on it selects it', await waitFor(`${SELECTED}.length===1&&${SELECTED}[0]===${plan.picked}`, 4000), await ev(SELECTED));
      await press('off');
      check('plan off: the card is out of the Graph, so out of the selection', await waitFor(`${SELECTED}.length===0`, 4000), await ev(SELECTED));
      await press('outermost');
      check('plan outermost: it comes back with the card, selected as it was', await waitFor(`${SELECTED}.length===1&&${SELECTED}[0]===${plan.picked}`, 4000), await ev(SELECTED));
    }

    // --- the mode is kept for the board; the Flow draws every card -------------------------------------
    await press('off');
    await load('plan');
    await waitFor(ROW_SHOWN, 6000);
    check('plan: a reload keeps the mode: off is pressed and the unnested cards are not drawn', await waitFor(pressedIs('unnested', 'off'), 6000) && await waitFor(live(kept), 6000), await ev(UNNESTED_ROW));
    await ev(pickLayout('flow'));
    await waitFor(layoutIs('flow'), 10000);
    check('plan: the Flow, which has no such option, draws every live card whatever the mode', await waitFor(live(plan.live), 6000), Object.keys(await ev(DOTS)));
    await ev(pickLayout('tiers'));
    await waitFor(layoutIs('tiers'), 10000);
    check('plan: and Tiers draws it again as it was chosen', await waitFor(live(kept), 6000));
    await press('outermost');

    // --- the fixture board has no hierarchy: its rings follow depth and the unnested ring is outside them ----
    const fixture = CASES.fixture;
    check('fixture: the Graph draws in Tiers', await load('fixture'));
    check('fixture: another board has chosen nothing: its row is shown and offers outermost', await shown());
    const fixtureRow = await ev(UNNESTED_ROW);
    check('fixture: and outermost is the mode pressed', !!fixtureRow && sameList(fixtureRow.buttons.filter((b) => b.pressed).map((b) => b.val), ['outermost']), fixtureRow);
    all = await ev(DOTS);
    marks = await ev(FAN_MARKS);
    check('fixture: the unnested cards sit on one ring outside every other dot', onOneRing(all, fixture.ring)
      && Math.min(...radii(all, fixture.ring)) > Math.max(...radii(all, others(all, fixture.ring))), radii(all, fixture.ring));
    const fixtureCaption = named(marks, 'unnested');
    check('fixture: and the ring is captioned unnested, after the depth captions, counting them', fixtureCaption.length === 1 && fixtureCaption[0].count === fixture.ring.length
      && marks.captions[marks.captions.length - 1] === fixtureCaption[0] && marks.captions.slice(0, -1).every((c) => c.kind === 'depth'), marks.captions);
    const fixtureRects = await framed('fixture outermost');
    check('fixture outermost: the caption\'s text is clear of every dot of the ring', !!fixtureRects && clearOfDots(fixtureRects, fixture.ring));

    // --- the malformed board: one unnested card, a ring of one --------------------------------------------------
    const malformed = CASES.malformed;
    check('malformed: the Graph draws in Tiers', await load('malformed'));
    all = await ev(DOTS);
    marks = await ev(FAN_MARKS);
    check('malformed: the one unnested card is on a ring of its own, outside the others, with its caption',
      finite(radii(all, malformed.ring)) && Math.min(...radii(all, malformed.ring)) > Math.max(...radii(all, others(all, malformed.ring)))
      && named(marks, 'unnested').length === 1 && named(marks, 'unnested')[0].count === 1, { all, captions: marks.captions });
    await framed('malformed outermost');
  },
};
