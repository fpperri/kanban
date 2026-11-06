'use strict';
// Focus and the contrast marks that depend on the cascade, on the plan board. Tab walks the focusable controls of
// the Board, the Map and the Graph with real key presses, and each stop shows a ring: a solid outline of 2px or
// more, or, on a field, the accent border it, or the box around it, wears when focused. A walk ends only when Tab
// comes round to its first stop again, so a focus a poll dropped fails it instead of cutting it short. Folding a
// column keeps focus on its toggle, whether the fold is made from the keyboard (Enter, then Space, on the toggle
// that Tab reached) or by a click, and through the poll that draws the board again: the toggle the page draws is
// the one that holds focus, with its ring. The details, focused by script as a form closes, show
// no ring, while the controls inside them still do. The cascade is read
// from the page's own stylesheet in both themes, on probes drawn the way the views draw them: the node for a
// parent on another board is dashed in muted ink, a parent line to it has a dash of its own and is not dimmed, the
// gantt's today line and an archived Graph dot are not dimmed, and an archived done dot still shows the selected,
// hovered and focused strokes. Each step waits on the page, never on a fixed sleep. Keys go through the runner's key helper,
// a real key press.

const MAX_STOPS = 400;

const ACTIVE = `document.activeElement`;
const RING = `(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const c=getComputedStyle(e);`
  + `const field=/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName);`
  + `const probe=document.createElement('i');probe.style.color='var(--accent)';document.body.appendChild(probe);const accent=getComputedStyle(probe).color;probe.remove();`
  + `const outline=c.outlineStyle!=='none'&&c.outlineStyle!=='hidden'&&parseFloat(c.outlineWidth)>=2&&c.outlineColor!=='rgba(0, 0, 0, 0)';`
  + `const wears=(n)=>getComputedStyle(n).borderTopColor===accent;`
  + `const border=field&&c.outlineStyle==='none'&&(wears(e)||(!!e.parentElement&&wears(e.parentElement)));`
  + `const name=e.getAttribute('aria-label')||e.getAttribute('data-id')||e.getAttribute('data-col')||e.getAttribute('data-caption')||(e.textContent||'').trim().slice(0,24);`
  + `const cls=String(e.getAttribute('class')||'');`
  + `return {tag:e.tagName.toLowerCase(),cls:cls.slice(0,60),id:e.id,sig:e.tagName+'|'+cls+'|'+e.id+'|'+name,outline,border,ok:outline||border}})()`;
const TOGGLE_FOCUSED = `(()=>{const e=document.activeElement;return !!e&&e.classList.contains('column-toggle')})()`;
const toggleOf = (col) => `[...document.querySelectorAll('#board .column-toggle')].find((b)=>b.dataset.col===${JSON.stringify(col)})`;

// The theme's colour for a token, as the page computes it.
const COLOUR = `(tok)=>{const p=document.createElement('i');p.style.color='var('+tok+')';document.body.appendChild(p);const c=getComputedStyle(p).color;p.remove();return c}`;

// Probes drawn with the classes the views give their parts, read in the cascade, in the theme the page is in.
const PROBES = `(()=>{const colour=${COLOUR};const NS='http://www.w3.org/2000/svg';
  const host=document.createElement('div');host.id='contrast-probe';document.body.appendChild(host);
  const svg=document.createElementNS(NS,'svg');host.appendChild(svg);
  const node=(cls)=>{const g=document.createElementNS(NS,'g');g.setAttribute('class','map-node '+cls);const r=document.createElementNS(NS,'rect');g.appendChild(r);const t=document.createElementNS(NS,'text');t.setAttribute('class','map-node-title map-node-title--prompt-fallback');g.appendChild(t);svg.appendChild(g);return g};
  const stroke=(g)=>getComputedStyle(g.querySelector('rect')).stroke;
  const dashed=(g)=>getComputedStyle(g.querySelector('rect')).strokeDasharray!=='none';
  const plain=node('external');
  const liveEdge=document.createElementNS(NS,'path');liveEdge.setAttribute('class','map-edge');svg.appendChild(liveEdge);
  const parentExternal=document.createElementNS(NS,'path');parentExternal.setAttribute('class','map-edge map-parent-line external-edge');svg.appendChild(parentExternal);
  const parentLive=document.createElementNS(NS,'path');parentLive.setAttribute('class','map-edge map-parent-line');svg.appendChild(parentLive);
  const dash=(e)=>getComputedStyle(e).strokeDasharray;
  const doneDot=(state)=>{const g=document.createElementNS(NS,'g');g.setAttribute('class','graph-node status-todo is-done archived '+state);const c=document.createElementNS(NS,'circle');c.setAttribute('class','graph-dot');g.appendChild(c);svg.appendChild(g);return c};
  const sel=doneDot('selected'),hov=doneDot('hover-highlight');
  const today=document.createElement('div');today.className='gantt-today-line';host.appendChild(today);
  const gnode=document.createElementNS(NS,'g');gnode.setAttribute('class','graph-node status-todo archived');const dot=document.createElementNS(NS,'circle');dot.setAttribute('class','graph-dot');gnode.appendChild(dot);svg.appendChild(gnode);
  const done=document.createElementNS(NS,'g');done.setAttribute('class','graph-node status-todo is-done archived');const ddot=document.createElementNS(NS,'circle');ddot.setAttribute('class','graph-dot');done.appendChild(ddot);svg.appendChild(done);
  const out={
    plain:stroke(plain),plainDashed:dashed(plain),mut:colour('--mut'),
    liveEdgeOpacity:getComputedStyle(liveEdge).strokeOpacity,liveEdgeDash:getComputedStyle(liveEdge).strokeDasharray,
    today:getComputedStyle(today).opacity,
    archivedOpacity:getComputedStyle(gnode).opacity,archivedDash:getComputedStyle(dot).strokeDasharray,archivedFill:getComputedStyle(dot).fill,todoTok:colour('--st-todo'),
    doneStroke:getComputedStyle(ddot).stroke,doneDash:getComputedStyle(ddot).strokeDasharray,
    parentExternalDash:dash(parentExternal),parentLiveDash:dash(parentLive),parentExternalOpacity:getComputedStyle(parentExternal).strokeOpacity,
    doneSelected:getComputedStyle(sel).stroke,doneHover:getComputedStyle(hov).stroke,accent:colour('--accent'),ink:colour('--ink')
  };
  host.remove();return JSON.stringify(out)})()`;

// An archived done dot that holds real keyboard focus: drawn the way the Graph draws a node (focusable, no outline of
// its own), focused after a key press so the page is in keyboard modality, and read in the cascade.
const FOCUS_DOT = `(()=>{const NS='http://www.w3.org/2000/svg';const host=document.createElement('div');host.id='contrast-focus-probe';document.body.appendChild(host);
  const svg=document.createElementNS(NS,'svg');host.appendChild(svg);
  const g=document.createElementNS(NS,'g');g.setAttribute('class','graph-node status-todo is-done archived');g.setAttribute('tabindex','0');
  const c=document.createElementNS(NS,'circle');c.setAttribute('class','graph-dot');g.appendChild(c);svg.appendChild(g);
  g.focus();const cs=getComputedStyle(c);
  const probe=document.createElement('i');probe.style.color='var(--accent)';document.body.appendChild(probe);const accent=getComputedStyle(probe).color;probe.remove();
  const out={focused:document.activeElement===g,visible:g.matches(':focus-visible'),stroke:cs.stroke,accent};
  host.remove();return JSON.stringify(out)})()`;

module.exports = {
  name: 'focus',
  board: 'plan',
  timeoutMs: 120000,
  async run(page) {
    const { ev, open, waitFor, key, centre, click: clickAt, check } = page;
    const click = async (sel) => { const p = await centre(sel); await clickAt(p.x, p.y); };
    const ready = `document.querySelectorAll('#board .column').length>0&&document.querySelectorAll('#board .card-el').length>0`;
    const frames = () => ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))`);

    // --- Tab shows a ring on every stop, in the Board, the Map and the Graph ---
    // The walk ends at the page's end: focus leaves for the browser (the body holds it), and the next Tab comes back
    // to the first stop. Anything else, a focus a poll dropped among it, is not an end and fails the walk.
    const walk = async (view, drawn) => {
      await open(`/?view=${view}`);
      const up = await waitFor(drawn, 10000);
      await ev(`document.activeElement&&document.activeElement.blur()`);
      const stops = [];
      let wrapped = false;
      for (let i = 0; i < MAX_STOPS; i++) {
        await key('Tab');
        await frames();
        const ring = await ev(RING);
        if (!ring) {
          await key('Tab');
          await frames();
          const first = await ev(RING);
          wrapped = !!first && stops.length > 0 && first.sig === stops[0].sig;
          break;
        }
        stops.push(ring);
      }
      return { up, stops, wrapped };
    };
    const views = [
      ['board', 'Board', ready],
      ['map', 'Map', `document.querySelectorAll('#map-view .map-node').length>0`],
      ['graph', 'Graph', `document.querySelectorAll('#graph-view .graph-node').length>0&&document.querySelectorAll('#graph-view .graph-caption[tabindex]').length>0`],
    ];
    for (const [view, label, drawn] of views) {
      const { up, stops, wrapped } = await walk(view, drawn);
      check(`the ${label} is drawn`, up);
      check(`Tab reaches the ${label}'s controls`, stops.length >= 20, stops.length);
      check(`the ${label} walk ends where it began: the last stop is followed by the page's end, then the first stop`, wrapped, stops.length);
      const bare = stops.filter((s) => !s.ok);
      check(`every Tab stop of the ${label} shows a ring`, bare.length === 0, bare.slice(0, 6));
      check(`a Tab stop on a button or link of the ${label} rings with an outline, not a border`, stops.filter((s) => /^(button|a)$/.test(s.tag)).every((s) => s.outline));
      if (view === 'graph') {
        const captions = stops.filter((s) => /graph-caption/.test(s.cls));
        check('the Graph walk stops on its captions, and each shows the page ring', captions.length > 0 && captions.every((s) => s.outline), captions.slice(0, 3));
      }
    }

    // --- folding a column keeps focus on its toggle ---
    await open('/?view=board');
    await waitFor(ready, 10000);
    await ev(`document.activeElement&&document.activeElement.blur()`);
    let reached = false;
    for (let i = 0; i < MAX_STOPS && !reached; i++) {
      await key('Tab');
      reached = await ev(TOGGLE_FOCUSED);
    }
    check('Tab reaches a column toggle', reached);
    const col = await ev(`${ACTIVE}.dataset.col`);
    const state = () => ev(`(()=>{const b=${toggleOf(col)};return b?{expanded:b.getAttribute('aria-expanded'),focused:document.activeElement===b,connected:b.isConnected}:null})()`);
    const before = await state();
    await key('Enter');
    check('Enter on the toggle folds the column', await waitFor(`(()=>{const b=${toggleOf(col)};return !!b&&b.getAttribute('aria-expanded')==='${before && before.expanded === 'true' ? 'false' : 'true'}'})()`, 5000), await state());
    check('after the fold from the keyboard, focus is on that column\'s toggle', await waitFor(`document.activeElement===${toggleOf(col)}`, 3000), await ev(`(${ACTIVE}.className||${ACTIVE}.tagName)`));
    const ring = await ev(RING);
    check('and the toggle shows its ring', !!ring && ring.ok && ring.outline, ring);
    // The poll draws the board again, a few seconds after the fold in real use: a mark on the toggle is gone once it has.
    await ev(`${toggleOf(col)}.dataset.probe='1'`);
    await ev(`(async()=>{await autoRefreshTick();})()`);
    check('a poll draws the board again', await waitFor(`(()=>{const b=${toggleOf(col)};return !!b&&!b.dataset.probe})()`, 5000));
    const afterPoll = await ev(RING);
    check('and focus is still on that column\'s toggle, with its ring', (await ev(`document.activeElement===${toggleOf(col)}`)) && !!afterPoll && afterPoll.outline, afterPoll);
    await key(' ');
    check('Space on the toggle unfolds the column and focus stays', await waitFor(`(()=>{const b=${toggleOf(col)};return !!b&&b.getAttribute('aria-expanded')==='${before && before.expanded}'&&document.activeElement===b})()`, 5000), await state());
    check('a click on the toggle folds it and focus stays on it', await (async () => {
      await click(`#board .column-toggle[data-col=${JSON.stringify(col)}]`);
      return waitFor(`(()=>{const b=${toggleOf(col)};return !!b&&b.getAttribute('aria-expanded')!=='${before && before.expanded}'&&document.activeElement===b})()`, 5000);
    })(), await state());
    await click(`#board .column-toggle[data-col=${JSON.stringify(col)}]`);
    await waitFor(`(()=>{const b=${toggleOf(col)};return !!b&&b.getAttribute('aria-expanded')==='${before && before.expanded}'})()`, 5000);

    // --- the popup the page focuses by script shows no ring, its controls do ---
    // The details are focused by script when the form that was opened from them closes (returnToDetails). The page is in
    // keyboard modality (a Tab went before it), so :focus-visible matches the popup: only the rule for a tabindex of -1
    // keeps the page ring off a container that is not a control.
    await open('/?view=graph');
    await waitFor(`document.querySelectorAll('#graph-view .graph-node').length>0`, 10000);
    await key('Tab');
    await ev(`document.querySelector('#graph-view .graph-node').focus()`);
    await key('Enter');
    check('Enter on a focused card in the Graph opens its details', await waitFor(`!document.getElementById('detail-modal').classList.contains('hidden')`, 5000));
    await ev(`document.getElementById('detail-edit-btn').click()`);
    check('Edit opens the form', await waitFor(`!document.getElementById('modal').classList.contains('hidden')`, 5000));
    await ev(`document.getElementById('modal-close').click()`);
    check('closing the form returns focus to the details popup', await waitFor(`(()=>{const e=document.activeElement;return !!e&&e.matches('.detail-modal')})()`, 5000), await ev(`(${ACTIVE}.className||${ACTIVE}.tagName)`));
    const popup = JSON.parse(await ev(`(()=>{const e=document.activeElement;const c=getComputedStyle(e);return JSON.stringify({visible:e.matches(':focus-visible'),outline:c.outlineStyle})})()`));
    check('the popup is focus-visible and shows no ring of its own', popup.visible && popup.outline === 'none', popup);
    let inside = null;
    for (let i = 0; i < 20 && !inside; i++) {
      await key('Tab');
      await frames();
      if (await ev(`!!${ACTIVE}.closest('.detail-modal')&&!${ACTIVE}.matches('.detail-modal')`)) inside = await ev(RING);
    }
    check('a control inside the popup still shows the page ring', !!inside && inside.ok && inside.outline, inside);
    await key('Escape');
    await waitFor(`document.getElementById('detail-modal').classList.contains('hidden')`, 5000);

    // --- the card menu's items show the page ring ---
    // A menu item cued focus with a wash alone, far under 3:1. The menu opens on a right click and keeps the keyboard.
    await open('/?view=board');
    await waitFor(ready, 10000);
    await key('Tab');
    await ev(`document.activeElement&&document.activeElement.blur()`);
    await page.rightClick('#board .card-el');
    check('a right click on a card opens the card menu', await waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 5000));
    const menuStops = [];
    for (let i = 0; i < 8; i++) {
      await key('Tab');
      await frames();
      const r = await ev(`(()=>{const e=document.activeElement;if(!e||!e.closest('#context-menu')||e.id==='context-menu')return null;const c=getComputedStyle(e);return {id:e.id,visible:e.matches(':focus-visible'),outlineStyle:c.outlineStyle,width:parseFloat(c.outlineWidth),colour:c.outlineColor,offset:parseFloat(c.outlineOffset),ring:${RING}}})()`);
      if (r) menuStops.push(r);
    }
    check('Tab reaches the items of the card menu', menuStops.length >= 3, menuStops);
    const bareItems = menuStops.filter((s) => !(s.visible && s.ring && s.ring.outline && s.outlineStyle === 'solid'));
    check('every card menu item Tab reaches shows a ring: a solid outline of 2px or more', bareItems.length === 0, bareItems.slice(0, 4));
    check('the ring of a menu item sits inside its box, so the menu does not clip it', menuStops.every((s) => s.offset < 0), menuStops.map((s) => s.offset));
    await key('Escape');
    await waitFor(`document.getElementById('context-menu').classList.contains('hidden')`, 5000);

    // --- the marks, in each theme ---
    for (const theme of ['light', 'dark']) {
      await ev(`document.documentElement.setAttribute('data-theme','${theme}')`);
      const p = JSON.parse(await ev(PROBES));
      const at = (what) => `${theme}: ${what}`;
      check(at('the node for a parent on another board is dashed, in muted ink, a mark'), p.plain === p.mut && p.plainDashed, p);
      check(at('a live edge is not dimmed or dashed'), p.liveEdgeOpacity === '1' && p.liveEdgeDash === 'none', p);
      check(at('the gantt today line is not dimmed'), p.today === '1', p.today);
      check(at('an archived Graph dot is not dimmed, keeps its status fill, and wears a dashed ring'), p.archivedOpacity === '1' && p.archivedDash !== 'none' && p.archivedFill === p.todoTok, p);
      check(at('an archived done dot keeps its hollow solid-colour ring, dashed'), p.doneDash !== 'none' && p.doneStroke === p.todoTok, p);
      check(at('an archived done dot that is selected wears the accent, and one that is hovered the ink'), p.doneSelected === p.accent && p.doneHover === p.ink, p);
      check(at('a parent line to a parent on another board is dashed in a dash of its own, and not dimmed'), p.parentExternalDash !== 'none' && p.parentExternalDash !== p.parentLiveDash && p.parentExternalOpacity === '1', p);
      check(at('a live parent line keeps its own dash'), p.parentLiveDash !== 'none' && p.parentLiveDash !== p.liveEdgeDash, p);
      await key('Tab');
      const f = JSON.parse(await ev(FOCUS_DOT));
      check(at('an archived done dot that holds keyboard focus wears the accent: its ring is its only focus cue'), f.focused && f.visible && f.stroke === f.accent, f);
    }
    await ev(`document.documentElement.removeAttribute('data-theme')`);
  },
};
