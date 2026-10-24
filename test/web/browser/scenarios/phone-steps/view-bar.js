'use strict';
// The view bar at the bottom of a 390 px phone: five tabs, a tap on a tab draws that view, a tap on the
// current view stays on it, Board from the Graph goes to the Board, a selection survives a switch, the
// bar sits at the bottom clear of the safe area, and the header's view buttons are gone.

const { tap } = require('../../steps');

const shown = (id) => `(()=>{const e=document.getElementById('${id}');return !!e&&!e.classList.contains('hidden')})()`;
const READY = {
  board: `${shown('board')}&&document.querySelectorAll('#board .column .card-el').length>0`,
  calendar: `${shown('calendar-view')}&&document.querySelectorAll('#calendar-view .cal-day').length>=28`,
  gantt: `${shown('gantt-view')}&&document.querySelectorAll('#gantt-view .gantt-body, #gantt-view .gantt-empty').length>0`,
  map: `${shown('map-view')}&&document.querySelectorAll('#map-view .map-node, #map-view .card-el').length>0`,
  graph: `${shown('graph-view')}&&document.querySelectorAll('#graph-view .graph-node').length>0`,
};

module.exports = {
  async run(page) {
    const { ev, open, waitFor, check } = page;
    const tapTab = async (view) => {
      const r = await ev(`(()=>{const b=document.querySelector('#view-bar [data-view="${view}"]').getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()`);
      await tap(page, r.x, r.y);
    };
    const pressed = `[...document.querySelectorAll('#view-bar [data-view]')].filter((b)=>b.getAttribute('aria-pressed')==='true').map((b)=>b.dataset.view).join()`;

    await open('/');
    check('the Board draws', await waitFor(READY.board, 10000));
    const bar = await ev(`(()=>{const b=document.getElementById('view-bar').getBoundingClientRect();const btns=[...document.querySelectorAll('#view-bar [data-view]')];return {bottom:Math.round(b.bottom),inner:innerHeight,words:btns.map((x)=>x.querySelector('.btn-label').textContent).join(),drawn:btns.every((x)=>!!x.querySelector('.btn-icon svg')),toggles:[...document.querySelectorAll('.actions [data-view-toggle]')].every((t)=>getComputedStyle(t).display==='none')}})()`);
    check('the bar sits at the bottom with five words and icons', bar.bottom === bar.inner && bar.words === 'Board,Calendar,Gantt,Map,Graph' && bar.drawn, bar);
    check('the header\'s view buttons are hidden', bar.toggles, bar);
    const seen = await ev(`[...document.querySelectorAll('#view-bar .btn-label')].map((l)=>{const r=l.getBoundingClientRect();const c=getComputedStyle(l);return {w:Math.round(r.width),h:Math.round(r.height),clip:c.clip}})`);
    check('each of the five words is visible, not clipped to a 1px box', seen.length === 5 && seen.every((s) => s.w > 4 && s.h > 4 && s.clip !== 'rect(0px, 0px, 0px, 0px)'), seen);
    check('the Board is the pressed tab', await ev(pressed) === 'board', await ev(pressed));

    const first = await ev(`(()=>{const c=document.querySelector('#board .card-el');return c?c.dataset.id:null})()`);
    await ev(`setSelection(selectionFromParts([cardPart(${JSON.stringify(first)})]))`);
    for (const view of ['calendar', 'gantt', 'map', 'graph']) {
      await tapTab(view);
      check(`a tap on ${view} draws it and presses its tab`, await waitFor(READY[view], 10000) && await ev(pressed) === view, await ev(pressed));
      const fit = await ev(`(()=>{const v=document.getElementById('${view === 'map' || view === 'graph' ? view + '-view' : view + '-view'}').getBoundingClientRect();const b=document.getElementById('view-bar').getBoundingClientRect();return {over:v.bottom>b.top+1}})()`);
      check(`${view} ends above the bar`, !fit.over, fit);
    }
    check('the selection survived the switches', await ev(`selectedIds.size`) === 1, await ev(`selectedIds.size`));
    await tapTab('graph');
    check('a tap on the current view stays on it', await waitFor(READY.graph, 5000) && await ev(pressed) === 'graph');
    await tapTab('board');
    check('Board from the Graph goes to the Board', await waitFor(READY.board, 10000) && await ev(pressed) === 'board');
    await tapTab('board');
    check('a tap on the Board again stays on the Board', await waitFor(READY.board, 5000) && await ev(pressed) === 'board');
  },
};
