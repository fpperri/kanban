'use strict';
// The tier fan's option row, on the plan board. In Tiers an option row stands in the option panel
// beside the fan, shown with every option built and no toggle of its own (the panel is what hides it;
// view-panel's), and absent in the Flow, whose row holds the Dependencies switch alone.
// It holds Lines (folded, brackets, chain, all, off), Dependencies (on, off), Order
// (status, rank), Names (relevant, all, none; fan-names's) and Unnested (outermost, off, depth 0,
// table; tier-fan-unnested's), one button of each pressed. Each lines mode and the dependencies switch
// redraw the fan with the number of lines the model predicts (graphFanLines, read from
// the page) and the number worked out by hand for the board; the order seats the
// siblings of a sector another way and moves no card to another ring. A reload keeps the
// options, and another board keeps its own. A press on the row, or a drag
// that starts on it, does not pan the canvas, does not clear a selection (nor does a
// double click on the row's own space). A view the person has not moved stays where it was
// after a press of an option, Order included, the fan neither re-fitted nor rescaled.
// The next poll still refreshes the board,
// with the pressed option still focused after it. A poll is one call of the page's own
// tick, the way the Graph scenario makes it, after a check that the focused option does
// not hold it.
//
// A press is a real click at the centre of the element, as a person makes it, and every
// wait is on the page, never on a fixed sleep; a "nothing happened" check waits two
// animation frames.
//
// The plan board's live cards are 1 to 18 and 22 to 29 (19 to 21 are archived). Eleven of
// them have a parent: 2 to 6 under card 1, 7 and 8 under 2, 22 under 7, 23 and 25 under 22
// and 24 under 23. The children of card 1 are one chain (4 waits for 3, and 6 waits for 2,
// 3 and 5), whose ends are 4 and 6; 8 waits for 7, so 8 is the end of its chain; every
// other child is alone in its chain, so is an end. Chain draws seven parent lines (4, 6, 8,
// 22, 23, 24 and 25). Folded draws the same seven: no parent has two such children on one
// ring (card 25 is a goal, and sits in a band of its own). Six cards wait for a drawn card:
// 4, 6 (three times), 8 and 27. Cards 30 and 31, added under card 7 through the board's
// API, are two children alone on one ring (depth 0, as are the cards 3 to 6, 8 and 23) beside
// the epic 22, so folded draws one counted line for them and the seven others, and its label
// reads 2. Brackets draw one bracket over each parent's children on a ring: over cards 3 to 6
// (label 4) and, with cards 30 and 31 added, over those two (label 2), with a plain line to each
// of the other children, eight parent lines and, with the two added, nine.
//
// Page globals this scenario reads (listed in skills/web/test/browser-globals.test.js):
// graphCur, graphFanLines, graphLoadOptions, selectedIds, isDragging, boardControlFocused,
// autoRefreshTick.

const {
  DOTS, SWEEP, DRAWN, TIERS_PRESSED, turned, pickLayout, layoutIs, hasDot,
} = require('./tier-fan');

const CASES = {
  plan: {
    parentLines: { folded: 7, brackets: 8, chain: 7, all: 11, off: 0 },
    waits: 6,
    defaults: { lines: 'folded', dependencies: 'on', order: 'status', names: 'relevant', unnested: 'outermost' },
    values: { lines: ['folded', 'brackets', 'chain', 'all', 'off'], dependencies: ['on', 'off'], order: ['status', 'rank'], names: ['relevant', 'all', 'none'], unnested: ['outermost', 'off', 'depth 0', 'table'] },
    labels: ['Lines', 'Dependencies', 'Order', 'Names', 'Unnested'],
    // The children of card 1 and the order each option seats them in, first seat first.
    siblings: [2, 3, 4, 5, 6],
    seats: { status: [2, 3, 6, 4, 5], rank: [2, 3, 4, 5, 6] },
    // Two children of card 7, with the lines each mode draws once they are there.
    added: [{ title: 'Port the first table', parent: 7, status: 'todo' }, { title: 'Port the second table', parent: 7, status: 'todo' }],
    withAdded: { folded: 8, brackets: 9, chain: 9, all: 13, off: 0 },
    addedIds: [30, 31],
    pollCard: { title: 'Check the poll after a press', status: 'todo' },
    pollId: 32,
    candidates: [3, 5, 12, 14],
  },
};

const OPTION_LABEL = '#graph-view .graph-options .graph-option-label';
const ROW = '#graph-view .graph-options:not(.graph-flow-options)';
const optionButton = (key, val) => `#graph-view .graph-option-btn[data-key="${key}"][data-val="${val}"]`;

// The row as the page has it: whether it keeps the selection, how many fold toggles it holds (none),
// and each option with its buttons. null when the row is not there.
const ROW_STATE = `(()=>{const row=document.querySelector('${ROW}');if(!row)return null;`
  + `const groups=[...row.querySelectorAll('.graph-option')].map((g)=>({label:g.querySelector('.graph-option-label').textContent,title:g.title,`
  + `buttons:[...g.querySelectorAll('.graph-option-btn')].map((b)=>({key:b.dataset.key,val:b.dataset.val,text:b.textContent,pressed:b.getAttribute('aria-pressed')==='true',active:b.classList.contains('active'),`
  + `keeps:b.hasAttribute('data-keeps-selection'),holds:b.hasAttribute('data-holds-poll')}))}));`
  + `return {keeps:row.hasAttribute('data-keeps-selection'),toggles:row.querySelectorAll('.map-section-toggle').length,inPanel:!!row.closest('.view-panel'),groups}})()`;

// The lines on the stage, by kind, and the labels of the counted ones; and the same as the
// model predicts for the options the page holds.
const LINE_COUNTS = `(()=>{const q=(s)=>document.querySelectorAll('#graph-view '+s).length;return {all:q('.graph-link'),parent:q('.graph-link-parent'),counted:q('.graph-link-counted'),`
  + `wait:q('.graph-link-wait'),labels:[...document.querySelectorAll('#graph-view .graph-link-count')].map((e)=>e.textContent)}})()`;
const PREDICTED = `(()=>{const lines=graphFanLines(graphCur.model,graphCur.layout.places,graphLoadOptions());return {all:lines.length,parent:lines.filter((l)=>l.kind==='parent').length,`
  + `counted:lines.filter((l)=>!!l.kids).length,wait:lines.filter((l)=>l.kind==='wait').length,labels:lines.filter((l)=>!!l.kids).map((l)=>String(l.count))}})()`;
// Each bracket on the stage as the brackets mode draws it: one arc from the smallest angle of its
// children to the largest, a tick to each child and one stem, so 'M' pieces for the stem, the arc and
// each child, and a single 'A'. The function runs in the page (its source is the expression) and in the
// stand-in page's tests.
function bracketsDrawn(cur, lines) {
  const same = (a, b) => Math.abs(Math.sin((a - b) / 2)) < 0.005;
  return cur.lines.filter((l) => l.count !== undefined).map((l) => {
    const kids = lines.find((x) => x.kids && x.from === l.from && x.count === l.count).kids.map((id) => cur.layout.polar.get(id).a);
    const m = /^M[-\d.e]+ [-\d.e]+L[-\d.e]+ [-\d.e]+M([-\d.e]+) ([-\d.e]+)A[-\d.e]+ [-\d.e]+ 0 \d 1 ([-\d.e]+) ([-\d.e]+)/.exec(l.d);
    return {
      from: l.from,
      count: l.count,
      ok: !!m && same(Math.atan2(Number(m[2]), Number(m[1])), Math.min(...kids)) && same(Math.atan2(Number(m[4]), Number(m[3])), Math.max(...kids))
        && (l.d.match(/A/g) || []).length === 1 && (l.d.match(/M/g) || []).length === 2 + kids.length,
    };
  });
}
const BRACKETS_DRAWN = `(${bracketsDrawn.toString()})(graphCur,graphFanLines(graphCur.model,graphCur.layout.places,graphLoadOptions()))`;
// The lines the page's lighting reaches are the lines it drew: one element for each.
const DRAWN_LINES = `graphCur.lines.length===document.querySelectorAll('#graph-view .graph-link').length`;

const ROW_PRESENT = `!!document.querySelector('${ROW}')`;
const ROW_ABSENT = `!document.querySelector('${ROW}')&&document.querySelectorAll('#graph-view .graph-node').length>0`;
const ROW_SHOWN = `document.querySelectorAll('#graph-view .graph-option-btn').length>0`;
const pressedIs = (key, val) => `(()=>{const b=document.querySelector('${optionButton(key, val)}');return !!b&&b.getAttribute('aria-pressed')==='true'})()`;
// Whether a focused control holds the poll, and one poll tick as the timer makes it.
const HOLDS_POLL = `boardControlFocused()`;
const TICK = `autoRefreshTick()`;
const FOCUSED_OPTION = `(()=>{const e=document.activeElement;return e&&e.classList&&e.classList.contains('graph-option-btn')?e.dataset.key+'='+e.dataset.val:null})()`;

// The Graph's view as the page holds it, and the classes that say a pan is under way.
const VIEW = `(()=>{const v=graphCur.view;return {x:v.x,y:v.y,k:v.k,touched:v.touched,panning:!!document.querySelector('#graph-view .graph-panning'),dragging:isDragging}})()`;
const SELECTED = `[...selectedIds].map(Number).sort((a,b)=>a-b)`;
const frames = `new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`;
const createCard = (card) => `fetch('/api/cards',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(card)})}).then((r)=>r.status)`;

// The centre of a card's dot in the Graph, or null when another dot covers it.
const dotPoint = (id) => `(()=>{const dot=document.querySelector('.graph-node[data-id="${id}"] .graph-dot');if(!dot)return null;const r=dot.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-node')&&hit.closest('.graph-node').dataset.id==='${id}'?{x,y}:null})()`;
// A point on the row that is neither a button nor a label: the row's own space, right of its controls.
const ROW_SPACE = `(()=>{const row=document.querySelector('${ROW}');if(!row)return null;const r=row.getBoundingClientRect();const x=r.right-6,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit===row?{x,y}:null})()`;
// A point on the canvas that is on no dot, near its top left corner.
const CANVAS_SPACE = `(()=>{const svg=document.querySelector('#graph-view .graph-canvas');if(!svg)return null;const r=svg.getBoundingClientRect();const x=r.left+12,y=r.top+12;const hit=document.elementFromPoint(x,y);return hit&&hit.closest('.graph-canvas')&&!hit.closest('.graph-node')?{x,y}:null})()`;

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

module.exports = {
  name: 'tier-fan-options',
  board: 'plan',
  alsoBoards: ['fixture'],
  timeoutMs: 120000,
  CASES,
  OPTION_LABEL,
  optionButton,
  ROW_STATE,
  LINE_COUNTS,
  PREDICTED,
  BRACKETS_DRAWN,
  bracketsDrawn,
  DRAWN_LINES,
  ROW_PRESENT,
  ROW_ABSENT,
  ROW_SHOWN,
  pressedIs,
  HOLDS_POLL,
  TICK,
  FOCUSED_OPTION,
  VIEW,
  SELECTED,
  ROW_SPACE,
  CANVAS_SPACE,
  createCard,
  dotPoint,
  async run(page) {
    const { ev, open, waitFor, centre, mouse, click, check, shot } = page;
    const plan = CASES.plan;

    // A page that is being left still answers for a moment after the navigation starts,
    // so a wait on the new page would read the old one. The old page is marked, and the
    // new one is the first without the mark.
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
    const doubleClickAt = async (p) => {
      await click(p.x, p.y, { clickCount: 1 });
      await click(p.x, p.y, { clickCount: 2 });
    };
    const rowState = () => ev(ROW_STATE);
    const counts = () => ev(LINE_COUNTS);
    const predicted = () => ev(PREDICTED);
    const pressed = (state) => (state ? state.groups.map((g) => g.buttons.filter((b) => b.pressed).map((b) => b.val)) : null);
    const setOption = async (key, val) => {
      await pressOn(optionButton(key, val));
      return waitFor(pressedIs(key, val), 6000);
    };
    // The lines the stage holds once a mode is drawn: the numbers wait on the page's own count.
    const settledOn = async (parent, wait) => waitFor(`(()=>{const q=(s)=>document.querySelectorAll('#graph-view '+s).length;return q('.graph-link-parent')===${parent}&&q('.graph-link-wait')===${wait}})()`, 6000);
    const seatOrder = (dots, sweep, ids) => ids.slice().sort((a, b) => turned(dots[b], sweep) - turned(dots[a], sweep));

    // --- the row: only in Tiers, shown on the first open -------------------------------------
    check('plan: the Graph draws in Tiers', await load('plan'));
    check('plan: the option row stands in the option panel, with Tiers', await waitFor(ROW_PRESENT, 6000));
    let state = await rowState();
    check('plan: the row is shown on the first open: every option is built, in the panel, with no toggle of its own',
      !!state && state.groups.length === 5 && state.toggles === 0 && state.inPanel === true && await ev(ROW_SHOWN), state);
    check('plan: the row keeps the selection', !!state && state.keeps === true, state);
    for (const other of ['flow']) {
      await ev(pickLayout(other));
      await waitFor(layoutIs(other), 10000);
      check(`plan: the ${other} has none of the fan's option row`, await waitFor(ROW_ABSENT, 6000), await rowState());
    }
    await ev(pickLayout('tiers'));
    await waitFor(layoutIs('tiers'), 10000);
    check('plan: back in Tiers the row is back', await waitFor(ROW_SHOWN, 6000), await rowState());

    // --- what it holds -------------------------------------------------------------------------
    state = await rowState();
    check('plan: the row holds Lines, Dependencies, Order, Names and Unnested, each with its values in words, the first of each pressed',
      !!state && sameList(state.groups.map((g) => g.label), plan.labels)
      && state.groups.every((g, i) => sameList(g.buttons.map((b) => b.val), plan.values[Object.keys(plan.values)[i]]) && sameList(g.buttons.map((b) => b.text), g.buttons.map((b) => b.val)))
      && sameList(state.groups.map((g) => g.buttons.filter((b) => b.pressed).map((b) => b.val).join()), Object.values(plan.defaults))
      && state.groups.every((g) => g.buttons.every((b) => b.active === b.pressed)), state);
    check('plan: every button of the row keeps the selection and none holds the poll',
      !!state && state.groups.every((g) => g.title.length > 20 && g.buttons.every((b) => b.keeps === true && b.holds === false)), state);
    check('plan: the lines drawn are the lines the model predicts for the defaults, and the page lights the lines it drew',
      same(await counts(), await predicted()) && await ev(DRAWN_LINES), { drawn: await counts(), predicted: await predicted() });
    const first = await counts();
    check('plan: folded draws the seven parent lines of the board and its six arrows, and no counted line',
      first.parent === plan.parentLines.folded && first.wait === plan.waits && first.counted === 0 && first.labels.length === 0, first);
    await shot('tier-fan-options-open');

    // --- each lines mode redraws the fan with the lines the model predicts --------------------
    const before = await ev(DOTS);
    for (const mode of ['all', 'chain', 'off', 'brackets', 'folded']) {
      const pressedOk = await setOption('lines', mode);
      await settledOn(plan.parentLines[mode], plan.waits);
      const drawn = await counts();
      const model = await predicted();
      check(`plan: lines ${mode} draws ${plan.parentLines[mode]} parent lines, the number the model predicts, and keeps the arrows`,
        pressedOk && drawn.parent === plan.parentLines[mode] && drawn.wait === plan.waits && same(drawn, model) && await ev(DRAWN_LINES), { drawn, model });
    }
    check('plan: a lines option moves no card', JSON.stringify(await ev(DOTS)) === JSON.stringify(before));

    // --- the dependencies switch ----------------------------------------------------------------
    await setOption('dependencies', 'off');
    await settledOn(plan.parentLines.folded, 0);
    const noArrows = await counts();
    check('plan: dependencies off draws no arrow and keeps the parent lines, as the model predicts',
      noArrows.wait === 0 && noArrows.parent === plan.parentLines.folded && same(noArrows, await predicted()), noArrows);
    await setOption('dependencies', 'on');
    await settledOn(plan.parentLines.folded, plan.waits);
    check('plan: dependencies on draws the arrows again', (await counts()).wait === plan.waits, await counts());

    // --- the order ---------------------------------------------------------------------------------
    const sweep = await ev(SWEEP);
    const byStatus = await ev(DOTS);
    check('plan: order status, the default, seats the children of card 1 doing, todo, backlog, done, ties in the outline\'s order',
      sameList(seatOrder(byStatus, sweep, plan.siblings), plan.seats.status), seatOrder(byStatus, sweep, plan.siblings));
    await setOption('order', 'rank');
    const byRank = await ev(DOTS);
    check('plan: order rank seats them in the outline\'s own order', sameList(seatOrder(byRank, sweep, plan.siblings), plan.seats.rank), seatOrder(byRank, sweep, plan.siblings));
    const ids = Object.keys(byRank);
    check('plan: the order moves siblings and nothing else: every card stays on its own ring',
      sameList(Object.keys(byStatus), ids) && ids.every((id) => Math.abs(Math.hypot(byRank[id].x, byRank[id].y) - Math.hypot(byStatus[id].x, byStatus[id].y)) < 0.5), { byStatus, byRank });
    await setOption('order', 'status');

    // --- a counted line: two children of card 7 on one ring -------------------------------------
    const created = [];
    for (const card of plan.added) created.push(await ev(createCard(card)));
    check('plan: two children are added under card 7', created.every((s) => s === 201), created);
    await load('plan');
    await waitFor(plan.addedIds.map(hasDot).join('&&'), 10000);
    for (const mode of ['folded', 'brackets', 'chain', 'all', 'off']) {
      await setOption('lines', mode);
      await settledOn(plan.withAdded[mode], plan.waits);
      const drawn = await counts();
      const model = await predicted();
      check(`plan: with the two children added, lines ${mode} draws ${plan.withAdded[mode]} parent lines, as the model predicts`,
        drawn.parent === plan.withAdded[mode] && same(drawn, model), { drawn, model });
    }
    await setOption('lines', 'folded');
    await settledOn(plan.withAdded.folded, plan.waits);
    const counted = await counts();
    check('plan: folded draws the two children on one counted line, whose label reads 2, one line of one count',
      counted.counted === 1 && sameList(counted.labels, ['2']), counted);
    await shot('tier-fan-options-counted');
    await setOption('lines', 'brackets');
    await settledOn(plan.withAdded.brackets, plan.waits);
    const bracketed = await counts();
    check('plan: brackets draw the four children of card 1 on one bracket reading 4 and the two of card 7 on one reading 2, and nothing else counted',
      bracketed.counted === 2 && sameList(bracketed.labels.slice().sort(), ['2', '4']), bracketed);
    const arcs = await ev(BRACKETS_DRAWN);
    check('plan: and each bracket is one arc from its first child to its last, a tick to each child and one stem',
      Array.isArray(arcs) && arcs.length === 2 && arcs.every((a) => a.ok), arcs);
    await shot('tier-fan-options-brackets');

    // --- the options are kept ---------------------------------------------------------
    await setOption('lines', 'chain');
    await setOption('order', 'rank');
    await load('plan');
    await waitFor(ROW_SHOWN, 6000);
    state = await rowState();
    check('plan: a reload keeps the options: chain, on, rank, relevant, outermost',
      !!state && sameList(pressed(state).map((p) => p.join()), ['chain', 'on', 'rank', 'relevant', plan.defaults.unnested]), state);
    await settledOn(plan.withAdded.chain, plan.waits);
    check('plan: and draws what they say', (await counts()).parent === plan.withAdded.chain, await counts());
    check('fixture: another board starts with the defaults, whatever the plan board chose', await load('fixture') && await waitFor(ROW_SHOWN, 6000), await rowState());
    state = await rowState();
    check('fixture: and its own choices are the defaults', !!state && sameList(pressed(state).map((p) => p.join()), Object.values(plan.defaults)), state);
    await load('plan');
    await waitFor(ROW_SHOWN, 6000);
    state = await rowState();
    check('plan: back on the plan board its choices are as they were left', !!state && sameList(pressed(state).map((p) => p.join()), ['chain', 'on', 'rank', 'relevant', plan.defaults.unnested]), state);

    // --- a press does not pan, and does not clear the selection -------------------------------------
    let target = null;
    let dot = null;
    for (const id of plan.candidates) {
      dot = await ev(dotPoint(id));
      if (dot) { target = id; break; }
    }
    check('plan: a dot is there to pick', !!dot, plan.candidates);
    if (dot) {
      await click(dot.x, dot.y);
      check('plan: a click on a dot selects it', await waitFor(`${SELECTED}.length===1&&${SELECTED}[0]===${target}`, 4000), await ev(SELECTED));
      const view = await ev(VIEW);
      for (const [key, val] of [['lines', 'all'], ['dependencies', 'off'], ['lines', 'folded'], ['dependencies', 'on'], ['order', 'status'], ['order', 'rank']]) await setOption(key, val);
      await ev(frames);
      check('plan: pressing options leaves the selection as it was', sameList(await ev(SELECTED), [target]), await ev(SELECTED));
      const after = await ev(VIEW);
      check('plan: and does not pan or zoom the canvas', after.x === view.x && after.y === view.y && after.k === view.k && after.touched === view.touched && after.panning === false && after.dragging === false, { view, after });

      // A press that starts on the row and is dragged is not a pan of the canvas.
      const label = await centre(OPTION_LABEL);
      check('plan: the row has a label to press on', !!label);
      if (label) {
        await mouse('mousePressed', label.x, label.y);
        await mouse('mouseMoved', label.x + 70, label.y + 50, { buttons: 1 });
        await mouse('mouseMoved', label.x + 140, label.y + 90, { buttons: 1 });
        const midway = await ev(VIEW);
        await mouse('mouseReleased', label.x + 140, label.y + 90);
        await ev(frames);
        const dragged = await ev(VIEW);
        check('plan: a drag that starts on the row does not pan the canvas', dragged.x === view.x && dragged.y === view.y && midway.panning === false && dragged.touched === view.touched, { view, midway, dragged });
        check('plan: and does not clear the selection', sameList(await ev(SELECTED), [target]), await ev(SELECTED));
      }
      const space = await ev(ROW_SPACE);
      check('plan: the row has space of its own to double click on', !!space);
      if (space) {
        await doubleClickAt(space);
        await ev(frames);
        check('plan: a double click on the space of the row leaves the selection', sameList(await ev(SELECTED), [target]), await ev(SELECTED));
      }
      // The same drag from the empty canvas does pan it, so the check above can fail.
      const bare = await ev(CANVAS_SPACE);
      check('plan: the canvas has empty space to drag from', !!bare);
      if (bare) {
        await mouse('mousePressed', bare.x, bare.y);
        await mouse('mouseMoved', bare.x + 40, bare.y + 30, { buttons: 1 });
        await mouse('mouseMoved', bare.x + 90, bare.y + 60, { buttons: 1 });
        await mouse('mouseReleased', bare.x + 90, bare.y + 60);
        const panned = await ev(VIEW);
        check('plan: the same drag from the empty canvas does pan it', panned.touched === true && (panned.x !== view.x || panned.y !== view.y), { view, panned });
      }
    }

    // --- Order on a view framed on the first draw ---------------------------------------------------
    // Order seats the siblings of a sector another way, the same cards on the same rings, and does not
    // frame the fan again.
    await load('plan');
    await waitFor(ROW_SHOWN, 6000);
    await ev(frames);
    const framed = await ev(VIEW);
    check('plan: the page reloaded frames the fan untouched', framed.touched === false, framed);
    for (const val of ['status', 'rank']) {
      await setOption('order', val);
      await ev(frames);
      const ordered = await ev(VIEW);
      check(`plan: pressing Order ${val} leaves the view where the fit put it`, ordered.x === framed.x && ordered.y === framed.y && ordered.k === framed.k && ordered.touched === false && ordered.panning === false, { framed, ordered });
    }

    // --- the next poll still refreshes the board ------------------------------------------------------
    await setOption('lines', 'all');
    check('plan: after a press the option keeps focus', await waitFor(`${FOCUSED_OPTION}==='lines=all'`, 4000), await ev(FOCUSED_OPTION));
    const made = await ev(createCard(plan.pollCard));
    check('plan: a card is added through the board\'s API', made === 201, made);
    check('plan: a focused option does not hold the poll', (await ev(HOLDS_POLL)) === false, await ev(HOLDS_POLL));
    await ev(TICK);
    check('plan: the next poll draws it, with no reload and nothing pressed since', await waitFor(hasDot(plan.pollId), 8000), await ev(DOTS));
    check('plan: and the option is still focused after the poll', (await ev(FOCUSED_OPTION)) === 'lines=all', await ev(FOCUSED_OPTION));
  },
};
