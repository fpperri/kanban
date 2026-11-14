'use strict';
// Space over a focused control, on the plan board, with real input only: a mouse click leaves the focus on the
// button it pressed, and a card the pointer is on then beats that button. Space writes the card's sets into the
// search box and the button is not pressed again; with no card hovered the focused button keeps Space and presses.
//
// The 2D Hierarchy. A click on the side panel's On hover hpath option ticks it and keeps the focus on it; with the
// pointer on no dot, Space presses the option and hpath is unticked. Clicked again, then the pointer on a dot and
// Space write `hpath:<id> | dlinks:<id> | hlinks:<id>` and leave hpath ticked; Shift+Space on another dot, the option
// focused again, adds its terms. In the search box Space types a space, a dot hovered or not.
//
// The 3D Hierarchy. A click on the 3D button turns it on and leaves the focus on that button; the pointer on a dot and
// Space write the dot's terms, and 3D stays on. A click on the hpath option unticks it; the pointer on a dot and Space
// write the dot's terms without hpath, and hpath stays unticked.
//
// Every press, click and pointer move goes through Input.dispatchMouseEvent and Input.dispatchKeyEvent. Each step waits
// on the page, never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// hoveredId, graph3dCur.

const OPTION = (val) => `#graph-view .graph-option-btn[data-key="hover"][data-val="${val}"]`;
// The dots whose middle the pointer reaches: the topmost element there is the dot's own mark, a 3D dot on the near
// side and drawn large enough to aim at. Card ids, nearest the middle of the stage first.
const REACHABLE = `(()=>{const s=document.querySelector('#graph-view .graph-main').getBoundingClientRect();const out=[];`
  + `for(const g of document.querySelectorAll('#graph-view .graph-node:not(.graph-flow-lane-head)')){if(g.classList.contains('graph-3d-off')||g.classList.contains('graph-3d-far'))continue;`
  + `const d=g.querySelector('.graph-dot');if(!d||getComputedStyle(g).display==='none')continue;const r=d.getBoundingClientRect();if(r.width<5)continue;`
  + `const x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);if(!hit||hit.closest('.graph-node')!==g)continue;`
  + `out.push({id:g.dataset.id,x,y,d:Math.hypot(x-(s.left+s.right)/2,y-(s.top+s.bottom)/2)})}return out.sort((a,b)=>a.d-b.d)})()`;
// The 3D dots on the near side and large enough to aim at, nearest the middle of the stage first. The 3D Hierarchy
// draws its marks over the canvas, but a mark's own shapes may not be what elementFromPoint names, so no hit test.
const REACHABLE_3D = `(()=>{const root=document.querySelector('#graph-view .graph-3d');const s=root.getBoundingClientRect();const out=[];`
  + `for(const g of root.querySelectorAll('.graph-node')){if(g.classList.contains('graph-3d-off')||g.classList.contains('graph-3d-far'))continue;`
  + `const r=g.querySelector('.graph-dot').getBoundingClientRect();if(r.width<=4)continue;const x=r.left+r.width/2,y=r.top+r.height/2;`
  + `out.push({id:g.dataset.id,x,y,d:Math.hypot(x-(s.left+s.right)/2,y-(s.top+s.bottom)/2)})}return out.sort((a,b)=>a.d-b.d)})()`;
const CAM = `(()=>{const r=document.querySelector('#graph-view .graph-3d');return r&&r.dataset.cam||null})()`;
// A spot in the stage with no dot under it.
const EMPTY_SPOT = `(()=>{const s=document.querySelector('#graph-view .graph-main').getBoundingClientRect();`
  + `for(let y=s.top+10;y<s.bottom-10;y+=17)for(let x=s.left+10;x<s.right-10;x+=17){const e=document.elementFromPoint(x,y);if(e&&!e.closest('.graph-node')&&!e.closest('.graph-line, .graph-edge, button, .view-panel'))return {x,y}}return null})()`;

module.exports = {
  name: 'space-over-focus',
  board: 'plan',
  timeoutMs: 120000,
  async run(page) {
    const { ev, open, waitFor, centre, mouse, click, key, check } = page;
    const boxText = () => ev(`document.getElementById('search-input').value`);
    const boxIs = (text) => waitFor(`document.getElementById('search-input').value===${JSON.stringify(text)}`);
    const pressedIs = (val, on) => waitFor(`document.querySelector(${JSON.stringify(OPTION(val))}).getAttribute('aria-pressed')===${JSON.stringify(String(on))}`);
    const focusOn = (sel) => waitFor(`document.activeElement===document.querySelector(${JSON.stringify(sel)})`);
    const hoveredIs = (id) => waitFor(id === null ? `hoveredId===null` : `hoveredId===${JSON.stringify(String(id))}`);
    const clickOn = async (sel) => {
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await mouse('mouseMoved', p.x, p.y, { button: 'none' });
      await click(p.x, p.y);
    };
    // The pointer brought onto a dot in two moves, the second a few px on, as a hand does: the 3D Hierarchy hovers
    // only once the pointer stirs.
    const pointAt = async (dot) => {
      await mouse('mouseMoved', dot.x - 3, dot.y - 3, { button: 'none' });
      await mouse('mouseMoved', dot.x, dot.y, { button: 'none' });
      return hoveredIs(dot.id);
    };
    const panelOpen = async () => {
      if (await ev(`!!document.querySelector(${JSON.stringify(OPTION('hpath'))})`)) return true;
      await clickOn('#graph-view .graph-controls .view-panel-toggle');
      return waitFor(`!!document.querySelector(${JSON.stringify(OPTION('hpath'))})`);
    };
    const terms = (id) => `hpath:${id} | dlinks:${id} | hlinks:${id}`;
    const clearBox = async () => {
      await clickOn('#search-clear-btn');
      await boxIs('');
      await ev(`document.activeElement&&document.activeElement.blur&&document.activeElement.blur()`);
    };

    // The camera once it has stopped: the same reading twice, a few frames apart.
    const settled = async () => {
      let last = null;
      for (let i = 0; i < 60; i++) {
        const now = await ev(CAM);
        if (now && now === last) return true;
        last = now;
        await page.sleep(80);
      }
      return false;
    };

    // --- the 2D Hierarchy: with no card hovered a focused option keeps Space ----------------------------------------------
    await open('/?view=graph');
    check('the Graph draws the plan board', await waitFor(`document.querySelectorAll('#graph-view .graph-node').length>20`, 10000));
    check('the side panel offers the On hover options', await panelOpen());
    check('hpath is not ticked to start', await pressedIs('hpath', false));
    await clickOn(OPTION('hpath'));
    check('a click on the hpath option ticks it', await pressedIs('hpath', true));
    check('and leaves the focus on it', await focusOn(OPTION('hpath')));
    const spot = await ev(EMPTY_SPOT);
    check('the stage has a spot with no dot', !!spot);
    await mouse('mouseMoved', spot.x, spot.y, { button: 'none' });
    check('the pointer off every dot hovers no card', await hoveredIs(null), await ev(`hoveredId`));
    await key(' ');
    check('with no card hovered Space presses the focused option: hpath is unticked', await pressedIs('hpath', false));
    check('and the box is left empty', await boxIs(''), await boxText());

    // --- the 2D Hierarchy: a hovered card beats the focused option ------------------------------------------------------
    await clickOn(OPTION('hpath'));
    check('a click on the hpath option ticks it again and leaves the focus on it', await pressedIs('hpath', true) && await focusOn(OPTION('hpath')));
    const dots = await ev(REACHABLE);
    check('the pointer can reach two dots', dots.length >= 2, dots.length);
    const [first, second] = dots;
    check('the pointer on a dot hovers its card', await pointAt(first), await ev(`hoveredId`));
    await key(' ');
    check('Space writes the hovered card\'s sets, the focused option\'s hpath among them', await boxIs(terms(first.id)), await boxText());
    check('and the option is not pressed again: hpath stays ticked', await pressedIs('hpath', true));
    await clickOn(OPTION('hpath'));
    await clickOn(OPTION('hpath'));
    check('two more clicks leave hpath ticked and the focus on the option', await pressedIs('hpath', true) && await focusOn(OPTION('hpath')));
    await pointAt(second);
    await key(' ', { shift: true });
    check('Shift+Space on another dot over the focused option adds its terms', await boxIs(`${terms(first.id)} | ${terms(second.id)}`), await boxText());
    check('and hpath still ticked', await pressedIs('hpath', true));

    // --- the search box keeps Space -------------------------------------------------------------------------------------
    await clearBox();
    await clickOn('#search-input');
    check('a click puts the focus in the search box', await focusOn('#search-input'));
    await key('a');
    const reach = await ev(REACHABLE);
    if (reach.length) await pointAt(reach[0]);
    check('a dot under the pointer is hovered while the box has the focus', reach.length > 0 && await ev(`hoveredId!==null`));
    await key(' ');
    check('in the search box Space types a space, the hovered card writes nothing', await boxIs('a '), await boxText());
    await clearBox();

    // --- the 3D Hierarchy -----------------------------------------------------------------------------------------------
    await clickOn('#graph-view .graph-3d-btn');
    check('a click on the 3D button turns the 3D Hierarchy on', await waitFor(`!!document.querySelector('#graph-view .graph-3d')&&new URLSearchParams(location.search).get('in3d')==='1'&&!!graph3dCur`, 15000));
    check('and the 3D button has the focus', await waitFor(`!!document.activeElement&&!!document.activeElement.closest('.graph-3d-btn')`), await ev(`document.activeElement&&document.activeElement.className`));
    check('the 3D camera settles', await settled());
    const dots3d = await ev(REACHABLE_3D);
    check('the pointer can reach a dot in 3D', dots3d.length > 0, dots3d.length);
    check('the pointer on a 3D dot hovers its card', await pointAt(dots3d[0]), await ev(`hoveredId`));
    await key(' ');
    check('3D: Space over the focused 3D button writes the hovered card\'s sets', await boxIs(terms(dots3d[0].id)), await boxText());
    check('3D: and the 3D button is not pressed again: 3D stays on', await ev(`!!document.querySelector('#graph-view .graph-3d')&&new URLSearchParams(location.search).get('in3d')==='1'`));
    await clearBox();

    check('3D: the side panel offers the On hover options', await panelOpen());
    await clickOn(OPTION('hpath'));
    check('3D: a click on the hpath option unticks it and keeps the focus', await pressedIs('hpath', false) && await focusOn(OPTION('hpath')));
    await settled();
    const again = await ev(REACHABLE_3D);
    await mouse('mouseMoved', spot.x, spot.y, { button: 'none' });
    check('3D: the pointer on a dot hovers its card', again.length > 0 && await pointAt(again[0]), await ev(`hoveredId`));
    await key(' ');
    check('3D: Space over the focused option writes the hovered card\'s sets, hpath no longer among them', await boxIs(`dlinks:${again[0].id} | hlinks:${again[0].id}`), await boxText());
    check('3D: and hpath stays unticked', await pressedIs('hpath', false));
  },
};
