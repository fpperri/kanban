'use strict';
// Focus and the contrast marks that depend on the cascade, on the plan board. Tab walks the Board's focusable
// controls with real key presses, and each stop shows a ring: a solid outline of 2px or more, or, on a field,
// the accent border it, or the box around it, wears when focused. Folding a column keeps focus on its toggle, whether the
// fold is made from the keyboard (Enter, then Space, on the toggle that Tab reached) or by a click: the page
// draws the board again, and the toggle it draws is the one that holds focus, with its ring. The cascade is read
// from the page's own stylesheet in both themes, on probes drawn the way the views draw them: a ghost stub keeps
// the amber of a waiting card and the red of a high-priority one over its dashes, an edge to a ghost is dashed and
// not dimmed, a parent line to a ghost has a dash of its own, the gantt's today line and an archived Graph dot are
// not dimmed, an archived done dot still shows the selected, hovered and focused strokes, and the fallback title on a
// ghost stub is not dimmed. Each step waits on the page, never on a fixed sleep. Keys go through the runner's key helper,
// a real key press.

const MAX_STOPS = 150;

const ACTIVE = `document.activeElement`;
const RING = `(()=>{const e=document.activeElement;if(!e||e===document.body)return null;const c=getComputedStyle(e);`
  + `const field=/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName);`
  + `const probe=document.createElement('i');probe.style.color='var(--accent)';document.body.appendChild(probe);const accent=getComputedStyle(probe).color;probe.remove();`
  + `const outline=c.outlineStyle!=='none'&&c.outlineStyle!=='hidden'&&parseFloat(c.outlineWidth)>=2&&c.outlineColor!=='rgba(0, 0, 0, 0)';`
  + `const wears=(n)=>getComputedStyle(n).borderTopColor===accent;`
  + `const border=field&&c.outlineStyle==='none'&&(wears(e)||(!!e.parentElement&&wears(e.parentElement)));`
  + `return {tag:e.tagName.toLowerCase(),cls:String(e.getAttribute('class')||'').slice(0,60),id:e.id,outline,border,ok:outline||border}})()`;
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
  const plain=node('ghost'),waiting=node('ghost waiting'),high=node('ghost high'),both=node('ghost high waiting'),live=node('waiting');
  const edge=document.createElementNS(NS,'path');edge.setAttribute('class','map-edge ghost-edge');svg.appendChild(edge);
  const liveEdge=document.createElementNS(NS,'path');liveEdge.setAttribute('class','map-edge');svg.appendChild(liveEdge);
  const parentGhost=document.createElementNS(NS,'path');parentGhost.setAttribute('class','map-edge map-parent-line ghost-edge');svg.appendChild(parentGhost);
  const parentLive=document.createElementNS(NS,'path');parentLive.setAttribute('class','map-edge map-parent-line');svg.appendChild(parentLive);
  const dash=(e)=>getComputedStyle(e).strokeDasharray;
  const doneDot=(state)=>{const g=document.createElementNS(NS,'g');g.setAttribute('class','graph-node status-todo is-done archived '+state);const c=document.createElementNS(NS,'circle');c.setAttribute('class','graph-dot');g.appendChild(c);svg.appendChild(g);return c};
  const sel=doneDot('selected'),hov=doneDot('hover-highlight');
  const today=document.createElement('div');today.className='gantt-today-line';host.appendChild(today);
  const gnode=document.createElementNS(NS,'g');gnode.setAttribute('class','graph-node status-todo archived');const dot=document.createElementNS(NS,'circle');dot.setAttribute('class','graph-dot');gnode.appendChild(dot);svg.appendChild(gnode);
  const done=document.createElementNS(NS,'g');done.setAttribute('class','graph-node status-todo is-done archived');const ddot=document.createElementNS(NS,'circle');ddot.setAttribute('class','graph-dot');done.appendChild(ddot);svg.appendChild(done);
  const out={
    plain:stroke(plain),plainDashed:dashed(plain),mut:colour('--mut'),
    waiting:stroke(waiting),waitingDashed:dashed(waiting),waitingTok:colour('--id-waiting'),
    high:stroke(high),highDashed:dashed(high),highTok:colour('--id-high'),
    both:stroke(both),
    live:stroke(live),
    title:getComputedStyle(plain.querySelector('text')).fillOpacity,
    edgeOpacity:getComputedStyle(edge).strokeOpacity,edgeDash:getComputedStyle(edge).strokeDasharray,edgeStroke:getComputedStyle(edge).stroke,
    liveEdgeOpacity:getComputedStyle(liveEdge).strokeOpacity,liveEdgeDash:getComputedStyle(liveEdge).strokeDasharray,
    today:getComputedStyle(today).opacity,
    archivedOpacity:getComputedStyle(gnode).opacity,archivedDash:getComputedStyle(dot).strokeDasharray,archivedFill:getComputedStyle(dot).fill,todoTok:colour('--st-todo'),
    doneStroke:getComputedStyle(ddot).stroke,doneDash:getComputedStyle(ddot).strokeDasharray,
    parentGhostDash:dash(parentGhost),parentLiveDash:dash(parentLive),parentGhostOpacity:getComputedStyle(parentGhost).strokeOpacity,
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

    // --- Tab shows a ring on every stop ---
    await open('/?view=board');
    check('the board is drawn', await waitFor(ready, 10000));
    await ev(`document.activeElement&&document.activeElement.blur()`);
    const stops = [];
    for (let i = 0; i < MAX_STOPS; i++) {
      await key('Tab');
      await frames();
      const ring = await ev(RING);
      if (!ring) break;
      stops.push(ring);
    }
    check('Tab reaches the board\'s controls', stops.length >= 20, stops.length);
    const bare = stops.filter((s) => !s.ok);
    check('every Tab stop shows a ring', bare.length === 0, bare.slice(0, 6));
    check('a Tab stop on a button or link rings with an outline, not a border', stops.filter((s) => /^(button|a)$/.test(s.tag)).every((s) => s.outline));

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
    await key(' ');
    check('Space on the toggle unfolds the column and focus stays', await waitFor(`(()=>{const b=${toggleOf(col)};return !!b&&b.getAttribute('aria-expanded')==='${before && before.expanded}'&&document.activeElement===b})()`, 5000), await state());
    check('a click on the toggle folds it and focus stays on it', await (async () => {
      await click(`#board .column-toggle[data-col=${JSON.stringify(col)}]`);
      return waitFor(`(()=>{const b=${toggleOf(col)};return !!b&&b.getAttribute('aria-expanded')!=='${before && before.expanded}'&&document.activeElement===b})()`, 5000);
    })(), await state());
    await click(`#board .column-toggle[data-col=${JSON.stringify(col)}]`);
    await waitFor(`(()=>{const b=${toggleOf(col)};return !!b&&b.getAttribute('aria-expanded')==='${before && before.expanded}'})()`, 5000);

    // --- the marks, in each theme ---
    for (const theme of ['light', 'dark']) {
      await ev(`document.documentElement.setAttribute('data-theme','${theme}')`);
      const p = JSON.parse(await ev(PROBES));
      const at = (what) => `${theme}: ${what}`;
      check(at('a ghost stub is dashed, in muted ink, a mark'), p.plain === p.mut && p.plainDashed, p);
      check(at('a waiting ghost stub keeps the waiting stroke over its dashes'), p.waiting === p.waitingTok && p.waitingDashed, p);
      check(at('a high-priority ghost stub keeps the high stroke over its dashes'), p.high === p.highTok && p.highDashed, p);
      check(at('a ghost stub that is both reads waiting, as a live node does'), p.both === p.waitingTok && p.live === p.waitingTok, p);
      check(at('the fallback title on a ghost stub is not dimmed'), p.title === '1', p.title);
      check(at('an edge to a ghost is dashed, in muted ink, and not dimmed'), p.edgeOpacity === '1' && p.edgeDash !== 'none' && p.edgeStroke === p.mut, p);
      check(at('a live edge is not dimmed or dashed'), p.liveEdgeOpacity === '1' && p.liveEdgeDash === 'none', p);
      check(at('the gantt today line is not dimmed'), p.today === '1', p.today);
      check(at('an archived Graph dot is not dimmed, keeps its status fill, and wears a dashed ring'), p.archivedOpacity === '1' && p.archivedDash !== 'none' && p.archivedFill === p.todoTok, p);
      check(at('an archived done dot keeps its hollow solid-colour ring, dashed'), p.doneDash !== 'none' && p.doneStroke === p.todoTok, p);
      check(at('an archived done dot that is selected wears the accent, and one that is hovered the ink'), p.doneSelected === p.accent && p.doneHover === p.ink, p);
      check(at('a parent line to a ghost is dashed in a dash of its own, and not dimmed'), p.parentGhostDash !== 'none' && p.parentGhostDash !== p.parentLiveDash && p.parentGhostDash !== p.edgeDash && p.parentGhostOpacity === '1', p);
      check(at('a live parent line keeps its own dash'), p.parentLiveDash !== 'none' && p.parentLiveDash !== p.liveEdgeDash, p);
      await key('Tab');
      const f = JSON.parse(await ev(FOCUS_DOT));
      check(at('an archived done dot that holds keyboard focus wears the accent: its ring is its only focus cue'), f.focused && f.visible && f.stroke === f.accent, f);
    }
    await ev(`document.documentElement.removeAttribute('data-theme')`);
  },
};
